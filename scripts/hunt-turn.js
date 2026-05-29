"use strict";
// Hunt for the turn number (=7) in the Julii T7 save by comparing it against
// the same player's Turn 6 End autosave. Whatever 4-byte field is 7 in one
// save and 6 in the other at the same offset is our candidate. We then
// validate against the Turn 1 save (should be 1) and the Dummies T20 save
// (should be 20).
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const T7   = path.join(SAVE_DIR, "save_Julii turn7.sav");
const T6   = path.join(SAVE_DIR, "save_Autosave   Republic of Rome   Turn 6 End.sav");
const T7S  = path.join(SAVE_DIR, "save_Autosave   Republic of Rome   Turn 7 Start.sav");
const T1   = path.join(SAVE_DIR, "save_Autosave   Republic of Rome   Turn 1.sav");
const T20  = path.join(SAVE_DIR, "save_Autosave   Dummies   Turn 20 End.sav");

function load(p) {
  try { return fs.readFileSync(p); } catch { return null; }
}

const a = load(T7);
const b = load(T6);
if (!a || !b) { console.log("missing save:", !a ? "T7" : "T6"); process.exit(1); }

console.log(`T7 size: ${a.length}, T6 size: ${b.length}`);
const limit = Math.min(a.length, b.length) - 4;

// Pass 1: unaligned, find every offset where T7 reads 7 AND T6 reads 6 as a u32.
const candidates = [];
for (let i = 0; i < limit; i += 1) {
  const va = a.readUInt32LE(i);
  if (va !== 7) continue;
  const vb = b.readUInt32LE(i);
  if (vb === 6) candidates.push(i);
}
console.log(`pass 1 (unaligned, T7==7 && T6==6): ${candidates.length} candidates`);

// Pass 2: validate against Turn 1 (must read 1) and Turn 20 (must read 20).
const t1 = load(T1);
const t20 = load(T20);
const t7s = load(T7S);
const filtered = [];
for (const off of candidates) {
  const v1 = t1 && off + 4 <= t1.length ? t1.readUInt32LE(off) : null;
  const v20 = t20 && off + 4 <= t20.length ? t20.readUInt32LE(off) : null;
  if (v1 === 1 && v20 === 20) {
    filtered.push({ off, v1, v20, v7s: t7s && off + 4 <= t7s.length ? t7s.readUInt32LE(off) : null,
                    ctx: a.slice(Math.max(0, off - 16), off + 16).toString("hex") });
  }
}
console.log(`pass 2 (also T1==1 && T20==20 at exact same offset): ${filtered.length} survivors`);
console.log(filtered.slice(0, 10));

// Different game-state versions / different player factions probably shift the
// turn field. Try matching turn at a stable RELATIVE offset — relative to the
// last byte of the "imperial_campaign" string (which is in the header).
function findCampaignNameEnd(buf) {
  // Header parse: name length at 0x3a (UTF-16LE), then ASCII bytes follow as
  // chars-interleaved-with-NULs. From the earlier crackSave output we saw
  // nameEnd: 94 — match that header layout.
  const len = buf.readUInt16LE(0x3a);
  return 0x3c + len * 2;
}
// Find offsets where T7 == 7 AND T6 == 6 AND T7S in {6,7}. Same-size-ish
// saves (T7=38MB, T6=37MB, T7S=38MB) keep most structures aligned. T1 is
// much smaller (34MB) so structures shift — skip it from primary filter.
{
  const cands = [];
  for (let i = 0; i + 4 < a.length && i + 4 < b.length && i + 4 < t7s.length; i += 1) {
    if (a.readUInt32LE(i) !== 7) continue;
    if (b.readUInt32LE(i) !== 6) continue;
    const vs = t7s.readUInt32LE(i);
    if (vs !== 7 && vs !== 6) continue;
    cands.push({ off: i, v7s: vs });
  }
  console.log(`\nT7=7 & T6=6 & T7S∈{6,7}: ${cands.length}`);
  for (const c of cands.slice(0, 20)) {
    const ctx = a.slice(Math.max(0, c.off - 16), c.off + 16).toString("hex");
    console.log(`  off=${c.off} v7s=${c.v7s} ctx=${ctx}`);
  }
}

// Validate candidates by cross-referencing T20 (turn=20). Search T20 for the
// same surrounding-context pattern minus the turn cell.
console.log("\n=== validate candidates against T20 (expect 20) ===");
{
  const T7off = [29742906, 35050714, 35054216, 37259581];
  for (const off of T7off) {
    const before = a.slice(off - 16, off);
    const after  = a.slice(off + 4, off + 20);
    // Find before+u32(20)+after in T20
    const probe  = Buffer.concat([before, Buffer.from([20,0,0,0]), after]);
    const idx    = t20.indexOf(probe);
    // Also try the same 16-bytes-before pattern alone in T20 and read u32 at +16
    const idxBefore = t20.indexOf(before);
    const tBefore16 = idxBefore !== -1 && idxBefore + 16 + 4 <= t20.length
      ? t20.readUInt32LE(idxBefore + 16) : null;
    console.log(`  T7 off=${off}: T20 full-match=${idx !== -1 ? idx : "no"}  byBefore16-match @${idxBefore} reads u32=${tBefore16}`);
  }
}

// Script declares persistent_counter `turn_number` — find it by name.
console.log("\n=== persistent counter 'turn_number' ===");
const NAME = Buffer.from("turn_number", "ascii");
for (const [n, buf, expected] of [
  ["T7  ", a, 7], ["T6  ", b, 6], ["T1  ", t1, 1], ["T20 ", t20, 20], ["T7S ", t7s, 7]
]) {
  if (!buf) continue;
  const hits = [];
  let pos = 0;
  while ((pos = buf.indexOf(NAME, pos)) !== -1) { hits.push(pos); pos += NAME.length; }
  for (const h of hits.slice(0, 3)) {
    // Try the 4-32 bytes after the name as a u32 — common script-counter layouts.
    const tail = [];
    for (let k = 0; k < 8; k++) {
      const o = h + NAME.length + k;
      if (o + 4 > buf.length) break;
      tail.push(`+${k}=${buf.readUInt32LE(o)}`);
    }
    console.log(`${n} hit@${h}  expected=${expected}  ${tail.join(" ")}`);
  }
  if (!hits.length) console.log(`${n} NOT FOUND`);
}

console.log("\n=== relative to nameEnd ===");
for (const [name, buf, expected] of [
  ["T7  ", a, 7], ["T6  ", b, 6], ["T1  ", t1, 1], ["T20 ", t20, 20], ["T7S ", t7s, 7]
]) {
  if (!buf) continue;
  const end = findCampaignNameEnd(buf);
  // dump u32s for the 64 bytes after the campaign name
  const u32s = [];
  for (let k = 0; k < 16; k++) {
    if (end + k * 4 + 4 > buf.length) break;
    u32s.push(buf.readUInt32LE(end + k * 4));
  }
  console.log(`${name} nameEnd=${end} u32s after:`, u32s.join(" "));
}
