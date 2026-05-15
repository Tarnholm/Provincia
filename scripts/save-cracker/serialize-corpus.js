// serialize-corpus.js — corpus round-trip driver for serialize.js.
//
// For each *.sav under the user's saves folder, spawn `node serialize.js
// <path>`, parse stdout, and tabulate the byte-identical result. For any
// non-identical save, dump 64 B of context around the first differing
// offset so the failure can be triaged.
//
// Usage: node serialize-corpus.js
//
// Output: per-file table + summary.

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SAVES_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const SERIALIZE = path.join(__dirname, "serialize.js");

function listSaves(dir) {
  return fs.readdirSync(dir)
    .filter(n => n.toLowerCase().endsWith(".sav"))
    .map(n => path.join(dir, n))
    .sort();
}

function parseStdout(out) {
  const r = { inputSize: -1, outputSize: -1, identical: null, firstDiff: -1, diffSegment: null };
  const mIn   = out.match(/input size:\s+(\d+)\s+bytes/);
  if (mIn)  r.inputSize  = +mIn[1];
  const mOut  = out.match(/output size:\s+(\d+)\s+bytes/);
  if (mOut) r.outputSize = +mOut[1];
  const mId   = out.match(/byte-identical:\s+(YES|NO)/);
  if (mId)  r.identical  = mId[1] === "YES";
  const mDiff = out.match(/first diff offset:\s+0x[0-9a-f]+\s+\((\d+)\)/);
  if (mDiff) r.firstDiff = +mDiff[1];
  const mSeg  = out.match(/diff segment:\s+(.+?)\s+\[0x[0-9a-f]+\.\.0x[0-9a-f]+\)/);
  if (mSeg) r.diffSegment = mSeg[1].trim();
  return r;
}

function hex(buf, off, len) {
  const end = Math.min(buf.length, off + len);
  const slice = buf.slice(Math.max(0, off), end);
  const parts = [];
  for (const b of slice) parts.push(b.toString(16).padStart(2, "0"));
  return parts.join(" ");
}

function main() {
  const saves = listSaves(SAVES_DIR);
  console.log(`Found ${saves.length} save files in ${SAVES_DIR}\n`);

  const results = [];
  for (const sav of saves) {
    const name = path.basename(sav);
    const t0 = Date.now();
    process.stdout.write(`[${(results.length + 1).toString().padStart(2)}/${saves.length}] ${name} ... `);
    const proc = spawnSync(process.execPath, [SERIALIZE, sav], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const dt = Date.now() - t0;
    const out = (proc.stdout || "") + (proc.stderr || "");
    const parsed = parseStdout(out);
    parsed.name = name;
    parsed.path = sav;
    parsed.elapsedMs = dt;
    parsed.exitCode = proc.status;
    parsed.rawTail = out.length > 4000 ? out.slice(-4000) : out;
    results.push(parsed);
    const tag = parsed.identical === true  ? "PASS"
              : parsed.identical === false ? "FAIL"
              : "ERR";
    const detail = parsed.identical === false
      ? ` @ 0x${parsed.firstDiff.toString(16)} (${parsed.diffSegment || "?"})`
      : "";
    console.log(`${tag}  ${parsed.inputSize >= 0 ? (parsed.inputSize/1048576).toFixed(2)+"MB" : "??"}  ${dt}ms${detail}`);
  }

  // Per-fail context dumps.
  const fails = results.filter(r => r.identical !== true);
  if (fails.length > 0) {
    console.log("\n=== FAILURE CONTEXT (64 B around first diff offset) ===");
    for (const f of fails) {
      console.log(`\n--- ${f.name} ---`);
      if (f.identical === null) {
        console.log(`  serialize.js did not complete (exit ${f.exitCode}). Last output:\n${f.rawTail.split(/\r?\n/).slice(-20).map(s => "    " + s).join("\n")}`);
        continue;
      }
      console.log(`  size in/out:   ${f.inputSize} / ${f.outputSize}`);
      console.log(`  first diff:    0x${f.firstDiff.toString(16)} (${f.firstDiff})`);
      console.log(`  diff segment:  ${f.diffSegment || "(unknown)"}`);

      // Re-read input + recompute output buffer using serialize.js as a module.
      try {
        const buf = fs.readFileSync(f.path);
        // We don't have a clean module API; re-run serialize.js capturing nothing
        // additional. The first-diff offset is already correct. Show input hex
        // around it (input-only — we can't get output bytes without re-running
        // serialize.js as a library; the input context alone usually pinpoints
        // the structural drift).
        const start = Math.max(0, f.firstDiff - 16);
        console.log(`  input  [-16..+48]: ${hex(buf, start, 64)}`);
        // Find the segment owner for context.
        // (Already reported via stdout parse.)
      } catch (e) {
        console.log(`  (could not re-read input for hex dump: ${e.message})`);
      }
    }
  }

  // Summary table.
  console.log("\n=== SUMMARY TABLE ===");
  console.log("file                                                    size     status   firstDiff       segment");
  console.log("------------------------------------------------------- -------- -------- --------------- ------------------------------");
  for (const r of results) {
    const sz = r.inputSize >= 0 ? (r.inputSize/1048576).toFixed(2) + "MB" : "??";
    const st = r.identical === true ? "PASS" : r.identical === false ? "FAIL" : "ERR";
    const fd = r.identical === false ? `0x${r.firstDiff.toString(16)}` : "-";
    const sg = r.identical === false ? (r.diffSegment || "?") : "-";
    const nm = r.name.length > 55 ? r.name.slice(0, 52) + "..." : r.name.padEnd(55);
    console.log(`${nm.padEnd(55)} ${sz.padEnd(8)} ${st.padEnd(8)} ${fd.padEnd(15)} ${sg}`);
  }

  const pass = results.filter(r => r.identical === true).length;
  const fail = results.filter(r => r.identical === false).length;
  const err  = results.filter(r => r.identical === null).length;
  console.log(`\nTotal: ${results.length}  PASS: ${pass}  FAIL: ${fail}  ERR: ${err}`);

  // Failure summaries grouped by segment.
  if (fails.length > 0) {
    const bySeg = new Map();
    for (const f of fails) {
      const k = f.diffSegment || (f.identical === null ? "(crash)" : "(unknown)");
      if (!bySeg.has(k)) bySeg.set(k, []);
      bySeg.get(k).push(f.name);
    }
    console.log("\nFailures grouped by blamed section:");
    for (const [seg, names] of bySeg.entries()) {
      console.log(`  ${seg}:  ${names.length}`);
      for (const n of names) console.log(`    - ${n}`);
    }
  }
}

main();
