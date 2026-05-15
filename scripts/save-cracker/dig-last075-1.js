// dig-last075-1.js — Session 68: characterize the remaining 0.75% (483 runs).
//
// We re-run cover.js, parse the captured stdout to extract the top-10 from
// human output isn't enough. Instead: re-invoke cover.js's logic by
// requiring its source, but cover.js has no exports. The cleanest path is
// to fork cover.js: copy it to a sibling file, swap the report block to
// emit JSON to a file, then read the file here.

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SAVE_PATH = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const TMP_JS  = path.join(__dirname, "_cover_emit_runtime.js");
const TMP_OUT = path.join(__dirname, "_cover_unknowns.json");

const cover = fs.readFileSync(path.join(__dirname, "cover.js"), "utf8");

// Insert: just before the final console.log walks, write JSON of `unknowns`
// to TMP_OUT and exit immediately. We anchor on the unique string
// `=== Top 10 largest UNKNOWN runs ===` which appears once.
const ANCHOR = "console.log(\"\\n=== Top 10 largest UNKNOWN runs ===\");";
const REPL = `require("fs").writeFileSync(${JSON.stringify(TMP_OUT)}, JSON.stringify({size, unknowns}));process.exit(0);`;
if (cover.indexOf(ANCHOR) < 0) {
  throw new Error("anchor not found in cover.js");
}
const patched = cover.replace(ANCHOR, REPL);
fs.writeFileSync(TMP_JS, patched);

console.log("running patched cover.js...");
execSync(`node "${TMP_JS}" "${SAVE_PATH}"`, { stdio: "inherit", maxBuffer: 256 * 1024 * 1024 });
const data = JSON.parse(fs.readFileSync(TMP_OUT, "utf8"));
fs.unlinkSync(TMP_JS);
fs.unlinkSync(TMP_OUT);

const { size, unknowns } = data;
console.log(`\ntotal file: ${size}`);
console.log(`unknown runs: ${unknowns.length}`);
console.log(`unknown bytes: ${unknowns.reduce((s, u) => s + u.bytes, 0)}\n`);

// Size buckets.
const buckets = {
  "100-200":   [],
  "200-500":   [],
  "500-1000":  [],
  "1000-3000": [],
  "3000-6500": [],
  "6500+":     [],
};
for (const u of unknowns) {
  if (u.bytes < 200)      buckets["100-200"].push(u);
  else if (u.bytes < 500) buckets["200-500"].push(u);
  else if (u.bytes < 1000) buckets["500-1000"].push(u);
  else if (u.bytes < 3000) buckets["1000-3000"].push(u);
  else if (u.bytes < 6500) buckets["3000-6500"].push(u);
  else                     buckets["6500+"].push(u);
}
console.log("=== Size buckets ===");
for (const k of Object.keys(buckets)) {
  const arr = buckets[k];
  const total = arr.reduce((s, u) => s + u.bytes, 0);
  console.log(`  ${k.padEnd(12)} ${arr.length.toString().padStart(4)} runs   ${total.toString().padStart(8)} bytes`);
}

const buf = fs.readFileSync(SAVE_PATH);

function preview(u, n = 48) {
  const end = Math.min(u.end, u.start + n);
  const slice = buf.slice(u.start, end);
  const hex = [...slice].map(b => b.toString(16).padStart(2, "0")).join(" ");
  const ascii = [...slice].map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
  return { hex, ascii };
}

function classify(u) {
  const slice = buf.slice(u.start, u.end);
  let zeros = 0, ffs = 0, ascii = 0;
  for (const b of slice) {
    if (b === 0) zeros++;
    else if (b === 0xff) ffs++;
    if ((b >= 0x20 && b < 0x7f)) ascii++;
  }
  return {
    zeroPct: (zeros / slice.length * 100).toFixed(1),
    ffPct:   (ffs   / slice.length * 100).toFixed(1),
    asciiPct:(ascii / slice.length * 100).toFixed(1),
  };
}

for (const k of Object.keys(buckets)) {
  const arr = buckets[k];
  if (arr.length === 0) continue;
  console.log(`\n=== Cluster ${k} (${arr.length} runs) — first 5 examples ===`);
  for (const u of arr.slice(0, 5)) {
    const c = classify(u);
    const p = preview(u, 48);
    console.log(`0x${u.start.toString(16)} (${u.bytes} B)  zero=${c.zeroPct}% ff=${c.ffPct}% ascii=${c.asciiPct}%`);
    console.log(`  HEX:   ${p.hex}`);
    console.log(`  ASCII: ${p.ascii}`);
    const tail = buf.slice(Math.max(u.start, u.end - 32), u.end);
    const tailHex = [...tail].map(b => b.toString(16).padStart(2, "0")).join(" ");
    console.log(`  TAIL:  ${tailHex}`);
  }
}

console.log("\n=== Top-3 largest unknowns (full head+tail) ===");
const top3 = [...unknowns].sort((a, b) => b.bytes - a.bytes).slice(0, 3);
for (const u of top3) {
  console.log(`\n0x${u.start.toString(16)} (${u.bytes} B):`);
  const p = preview(u, 256);
  console.log(`  HEX HEAD: ${p.hex}`);
  console.log(`  ASCII:    ${p.ascii}`);
  const tail = buf.slice(Math.max(u.start, u.end - 96), u.end);
  const tailHex = [...tail].map(b => b.toString(16).padStart(2, "0")).join(" ");
  const tailAsc = [...tail].map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
  console.log(`  TAIL HEX: ${tailHex}`);
  console.log(`  TAIL ASC: ${tailAsc}`);
}

console.log("\n=== Tail signatures (last 8 B) across the 1000-3000 B cluster ===");
const sigCount = new Map();
for (const u of buckets["1000-3000"]) {
  const tail = buf.slice(u.end - 8, u.end);
  const key = [...tail].map(b => b.toString(16).padStart(2, "0")).join(" ");
  sigCount.set(key, (sigCount.get(key) || 0) + 1);
}
const sorted = [...sigCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
for (const [k, v] of sorted) console.log(`  ${v.toString().padStart(4)}x  tail8=${k}`);

console.log("\n=== Head signatures (first 8 B) across the 1000-3000 B cluster ===");
const headCount = new Map();
for (const u of buckets["1000-3000"]) {
  const head = buf.slice(u.start, u.start + 8);
  const key = [...head].map(b => b.toString(16).padStart(2, "0")).join(" ");
  headCount.set(key, (headCount.get(key) || 0) + 1);
}
const sortedHead = [...headCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
for (const [k, v] of sortedHead) console.log(`  ${v.toString().padStart(4)}x  head8=${k}`);

console.log("\n=== Stride between consecutive 1000-3000 B runs ===");
const sortedRuns = buckets["1000-3000"].slice().sort((a, b) => a.start - b.start);
const strides = new Map();
for (let i = 1; i < sortedRuns.length; i++) {
  const s = sortedRuns[i].start - sortedRuns[i-1].start;
  strides.set(s, (strides.get(s) || 0) + 1);
}
const sortedStrides = [...strides.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [k, v] of sortedStrides) console.log(`  ${v.toString().padStart(4)}x  stride=${k}`);

// Also: for the 100-200 cluster — these are the prime padding-sweeper
// candidates. What fraction is >95% zero or >95% FF?
console.log("\n=== Small-run (100-500 B) padding analysis ===");
let smallZeroDom = 0, smallFFDom = 0, smallMixed = 0;
const smallRuns = [...buckets["100-200"], ...buckets["200-500"]];
for (const u of smallRuns) {
  const c = classify(u);
  if (parseFloat(c.zeroPct) >= 95) smallZeroDom++;
  else if (parseFloat(c.ffPct) >= 95) smallFFDom++;
  else smallMixed++;
}
console.log(`  total small runs: ${smallRuns.length}`);
console.log(`  >=95% zero: ${smallZeroDom}`);
console.log(`  >=95% FF:   ${smallFFDom}`);
console.log(`  mixed:      ${smallMixed}`);
