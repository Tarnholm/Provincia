// dig-diplo-F.js — session 108 step F
//
// Final structural question: in the `05 00 24 39` zone, is A a packed
// (factionA, factionB) pair-id? Or is it a turn-stamp / event-id?
//
// Test: across major[0] (player), there's ONE entry with A=1317. If the
// entry represents "Romans' diplomatic standing with faction X" (1 entry =
// 1 relationship), then A=1317 should encode "Rome + X".
//
// But A is monotonically distributed 0..1317 across all entries, with
// almost no repetition. That's consistent with a UUID-per-event scheme,
// not a faction-pair-id.
//
// Look at: does the SUM of (A values mod 256) or (A / 23) reveal a
// faction-id-like distribution?
//
// Also: NPC faction records have a similar structure. Let me check if
// NPC records have a similar marker zone — they might mirror majors.
//
// Usage: node dig-diplo-F.js
"use strict";

const fs = require("fs");
const path = require("path");
const { findFactionRecords } = require("../../src/factionRecordParser");

const root = path.join(__dirname, "fixtures", "feral");
const buf = fs.readFileSync(path.join(root, "save_1.2.sav"));

function readMajor(b) {
  const out = [];
  for (let i = 0; i + 64 < b.length; i += 1) {
    if (b.readUInt32LE(i + 8) !== 100) continue;
    if (b.readUInt32LE(i + 12) !== 1) continue;
    if (b.readUInt32LE(i + 16) !== 0 || b.readUInt32LE(i + 20) !== 0) continue;
    if (b.readUInt32LE(i + 24) !== i + 24) continue;
    if (b.readUInt32LE(i + 32) !== 0 || b.readUInt32LE(i + 36) !== 0) continue;
    if (b.readUInt32LE(i + 40) !== i + 40) continue;
    if (b.readUInt32LE(i + 44) !== 6) continue;
    const regions = b.readUInt32LE(i + 48);
    if (regions > 200) continue;
    out.push({ pos: i, regions });
  }
  return out;
}

const majors = readMajor(buf);

function getEntries(buf, m) {
  const markerOff = m.pos + 244 + 4 * m.regions;
  if (buf[markerOff] !== 0x05 || buf[markerOff + 1] !== 0x00 || buf[markerOff + 2] !== 0x24 || buf[markerOff + 3] !== 0x39) {
    return { count: -1, entries: [] };
  }
  const count = buf.readUInt32LE(markerOff + 4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const off = markerOff + 8 + i * 16;
    entries.push({
      A: buf.readUInt32LE(off),
      B: buf.readUInt32LE(off + 4),
      C: buf.readUInt32LE(off + 8),
      D: buf.readUInt32LE(off + 12),
    });
  }
  return { count, entries, markerOff };
}

// Sum of A values across all majors
const allA = [];
const allEntriesPerMajor = majors.map((m) => getEntries(buf, m));
allEntriesPerMajor.forEach((e) => e.entries.forEach((x) => allA.push(x.A)));

// distribution
const dups = allA.filter((a, i) => allA.indexOf(a) !== i);
console.log(`Total A values: ${allA.length}`);
console.log(`Duplicate A values: ${dups.length} ([${dups.slice(0, 10).join(",")}])`);
console.log(`A range: ${Math.min(...allA)} .. ${Math.max(...allA)}`);

// Mod-23 distribution
const mod23 = {};
allA.forEach((a) => { mod23[a % 23] = (mod23[a % 23] || 0) + 1; });
console.log(`\nA mod 23 distribution:`);
Object.keys(mod23).sort((a, b) => +a - +b).forEach((k) => console.log(`  ${k}: ${mod23[k]}`));

// Mod-256 distribution (does A encode pair?)
const mod256 = {};
allA.forEach((a) => { mod256[a % 256] = (mod256[a % 256] || 0) + 1; });
const top256 = Object.entries(mod256).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log(`\nA mod 256 top:`);
top256.forEach(([k, v]) => console.log(`  ${k}: ${v}`));

// Mod-24 distribution (24 = 23 majors + rebels?)
const mod24 = {};
allA.forEach((a) => { mod24[a % 24] = (mod24[a % 24] || 0) + 1; });
console.log(`\nA mod 24 distribution:`);
Object.keys(mod24).sort((a, b) => +a - +b).forEach((k) => console.log(`  ${k}: ${mod24[k]}`));

// Check NPC faction records for the same marker
const recs = findFactionRecords(buf);
const npcs = recs.filter((r) => r.size > 1024 && r.size < 12000);
console.log(`\nNPC records: ${npcs.length}`);

// Search for `05 00 24 39` inside each NPC record
let npcHits = 0;
const npcMarkerRels = [];
for (const r of npcs) {
  for (let i = r.offset; i + 4 <= r.offset + r.size; i++) {
    if (buf[i] === 0x05 && buf[i + 1] === 0x00 && buf[i + 2] === 0x24 && buf[i + 3] === 0x39) {
      npcHits++;
      if (npcMarkerRels.length < 15) npcMarkerRels.push({ recIdx: recs.indexOf(r), rel: i - r.offset, size: r.size });
      break;
    }
  }
}
console.log(`NPC records containing the marker: ${npcHits}/${npcs.length}`);
console.log(`Sample NPC marker positions:`, npcMarkerRels);

// Now: NPC records are smaller. Do they have a smaller marker zone?
// Show the entry count for NPC[3] (which had a larger record than the
// repeated 8472-byte ones).
if (npcMarkerRels.length > 0) {
  const sample = npcMarkerRels[0];
  const rec = recs[sample.recIdx];
  console.log(`\nNPC record ${sample.recIdx} (pos=0x${rec.offset.toString(16)} size=${rec.size}):`);
  const markerAbs = rec.offset + sample.rel;
  const count = buf.readUInt32LE(markerAbs + 4);
  console.log(`  marker at +${sample.rel}, count=${count}`);
  for (let i = 0; i < Math.min(count, 10); i++) {
    const off = markerAbs + 8 + i * 16;
    console.log(`    [${i}] A=${buf.readUInt32LE(off)} B=${buf.readUInt32LE(off + 4)} C=${buf.readUInt32LE(off + 8)} D=0x${buf.readUInt32LE(off + 12).toString(16)}`);
  }
}
