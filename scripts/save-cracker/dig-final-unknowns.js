"use strict";
// dig-final-unknowns.js — list every UNKNOWN segment after serialize.js
// claims, dump first/last 32 B, and characterize each (zeros/ff/mixed).
const fs = require("fs");
const path = require("path");

const SAVE_PATH = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";

// Reuse the exact enumerator from serialize.js via require.
const serializePath = path.resolve(__dirname, "serialize.js");
// We need to extract enumerateClaims + buildSegments without running main().
// serialize.js calls main() at the bottom unconditionally — read it and eval
// only the function defs by stripping the trailing main() call.
const src = fs.readFileSync(serializePath, "utf8");
const stripped = src.replace(/\n\s*main\(\);\s*$/m, "\n");
const wrapper = `(function(module, exports){\n${stripped}\nmodule.exports = { enumerateClaims, buildSegments };\n})`;
const mod = { exports: {} };
const fn = eval(wrapper);
fn(mod, mod.exports);
const { enumerateClaims, buildSegments } = mod.exports;

const buf = fs.readFileSync(SAVE_PATH);
const claims = enumerateClaims(buf);
const segs = buildSegments(claims, buf.length);
const unknowns = segs.filter(s => s.name === "UNKNOWN");
console.log(`Total UNKNOWN segments: ${unknowns.length}, total bytes: ${unknowns.reduce((a,s)=>a+(s.end-s.start),0)}`);
console.log("");

function hex(b) {
  return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join(" ");
}

for (const s of unknowns) {
  const len = s.end - s.start;
  const slice = buf.slice(s.start, s.end);
  let zeros = 0, ffs = 0;
  for (const b of slice) {
    if (b === 0x00) zeros++;
    else if (b === 0xff) ffs++;
  }
  const zPct = (zeros / len * 100).toFixed(1);
  const fPct = (ffs / len * 100).toFixed(1);
  const head = hex(slice.slice(0, Math.min(32, len)));
  const tail = len > 64 ? "..." + hex(slice.slice(-32)) : "";
  let kind = "mixed";
  if (zeros === len) kind = "ALL-ZERO";
  else if (ffs === len) kind = "ALL-FF";
  else if (zeros + ffs === len) kind = "ZERO+FF";
  console.log(`[0x${s.start.toString(16)}..0x${s.end.toString(16)}) len=${len} z=${zPct}% f=${fPct}% kind=${kind}`);
  console.log(`  head: ${head}`);
  if (tail) console.log(`  tail: ${tail}`);
}
