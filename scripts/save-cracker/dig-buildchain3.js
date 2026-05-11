// dig-buildchain3.js — Specifically analyze core_building sub-records.
// For each settlement, the core_building sub-record's payload should encode current building level
// (small_village, large_village, town, large_town, etc.) or actual building IDs.
//
// Compare across all core_building sub-records in a save.

const fs = require("fs");
const path = require("path");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-49-17-100Z";
const F = "0010_save_saveturn1start.sav";

const buf = fs.readFileSync(path.join(ARCHIVE, F));

// Find all 'core_building' sub-record positions
function findAll(buf, tok) {
  const out = [];
  const t = Buffer.from(tok);
  let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) {
    if (p - 2 >= 0 && buf.readUInt16LE(p - 2) === tok.length + 1 && buf[p + tok.length] === 0) {
      out.push(p);
    }
    p += 1;
  }
  return out;
}

const hits = findAll(buf, "core_building");
console.log(`core_building hits: ${hits.length}`);

// Dump each as: payload bytes 0..40 after the null terminator
const distinctPatterns = new Map();
for (let i = 0; i < hits.length; i++) {
  const payloadStart = hits[i] + "core_building".length + 1;
  const hex = [];
  for (let j = 0; j < 40; j++) hex.push(buf[payloadStart + j].toString(16).padStart(2, "0"));
  // Show: first 4 (hash) | next byte (level?) | next 20 (constant?) | next bytes
  const hash = hex.slice(0, 4).join(" ");
  const lvl = hex[4];
  const const20 = hex.slice(5, 25).join(" ");
  const post = hex.slice(25, 40).join(" ");
  const k = `${lvl}|${const20}|${post}`;
  distinctPatterns.set(k, (distinctPatterns.get(k) || 0) + 1);
}

console.log(`\nDistinct payload patterns (excluding hash u32):`);
const sorted = [...distinctPatterns.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, c] of sorted) {
  console.log(`  ${c}× ${k}`);
}

// Now: hypothesis check. The `01 StTeEnRtEsD\\RCeosno` pattern might be just constant bytes (e.g. a
// memory address from the engine's BuildingLevel structure that gets serialized). What about the FIRST
// byte after the hash? Distribution:
console.log(`\n+5 byte (after hash) distribution:`);
const d5 = new Map();
for (const off of hits) {
  const payloadStart = off + "core_building".length + 1;
  const b = buf[payloadStart + 4];
  d5.set(b, (d5.get(b) || 0) + 1);
}
for (const [v, c] of [...d5.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  payload+4=${v}: ${c}`);
}

// Now check default_set sub-records — these have a completely different payload (fc fc fc fc filler)
console.log(`\ndefault_set sub-records (the SETTLEMENT-level header, not building chain):`);
const defaultSetHits = findAll(buf, "default_set");
for (let i = 0; i < Math.min(5, defaultSetHits.length); i++) {
  const payloadStart = defaultSetHits[i] + "default_set".length + 1;
  const hex = [];
  for (let j = 0; j < 48; j++) hex.push(buf[payloadStart + j].toString(16).padStart(2, "0"));
  console.log(`  @0x${defaultSetHits[i].toString(16)}: ${hex.slice(0, 16).join(" ")}`);
  console.log(`         ${" ".repeat(8)} ${hex.slice(16, 32).join(" ")}`);
  console.log(`         ${" ".repeat(8)} ${hex.slice(32, 48).join(" ")}`);
}

// And the u32 BEFORE default_set is NOT a self-ptr — it's the parent's pointer
// (the settlement record's plan-set linkage). Let me look at bytes -32..-1
console.log(`\ndefault_set context (preceding 32 bytes):`);
for (let i = 0; i < 3; i++) {
  const off = defaultSetHits[i];
  const pre = [];
  for (let j = -32; j < 16; j++) pre.push(buf[off + j].toString(16).padStart(2, "0"));
  console.log(`  @0x${off.toString(16)} pre 32+16 bytes:`);
  console.log(`     pre:  ${pre.slice(0, 16).join(" ")}`);
  console.log(`     pre:  ${pre.slice(16, 32).join(" ")}`);
  console.log(`     nm:   ${pre.slice(32, 48).join(" ")}`);
}
