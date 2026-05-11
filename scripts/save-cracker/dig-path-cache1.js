// dig-path-cache1.js — Confirm per-field-army path-cache hypothesis.
//
// Session 23 found 122 non-empty trails in the lua-footer tile-coord array,
// matching the 123 field-army count in tail.
//
// Method:
//   1. Re-extract the 123 field-army records from tail (session 22's decode)
//      → get their (X,Y) settlement coords (from settlement name + region lookup)
//      OR from the in-record position fields.
//   2. Parse the lua-footer tile-trail array (same as session 23).
//   3. For each non-empty trail, get its (X,Y) pairs.
//   4. Check: does each trail's first pair match a field-army's settlement coord?

const fs = require("fs");
const SAVE_ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE_ROME10);

// Field-army tail block bounds per sessions 22 and 23
const FIELD_ARMY_START = 0x1f10c72;
const FIELD_ARMY_END = 0x1f43688;
// Settlement-model block per session 16: 0x1f47809..0x1f8f9bc
// Lua footer tile trail per session 14: 0x2110a24..0x21153ae (EOF)
const TRAIL_START = 0x2110a24;

// ── 1. Extract field-army records ─────────────────────────────────────────
// Schema per session 22:
//   [u16 nameLen][ASCII unit name][0xee][8B hash][8B uuid][4B 0x0001012c][4B 0x01]
//   [u16 settLen][UTF-16LE settlement name][4B 0xffffffff]
//   [44B header][N×9B soldiers][0xff padding]

function isAsciiUnit(b) { return (b>=0x20 && b<=0x7e); }

function findFieldArmyRecords(buf, start, end) {
  const records = [];
  let p = start;
  let scanFails = 0;
  while (p + 32 < end) {
    const lenU16 = buf.readUInt16LE(p);
    if (lenU16 < 3 || lenU16 > 40) { p++; continue; }
    if (p + 2 + lenU16 > end) { p++; continue; }
    // Test: is following ASCII text?
    let ok = true;
    let allLower = true;
    for (let i = 0; i < lenU16; i++) {
      const b = buf[p + 2 + i];
      if (!isAsciiUnit(b)) { ok = false; break; }
      if (b < 0x61 && b !== 0x20) allLower = false; // unit names are usually lower-case
    }
    if (!ok) { p++; continue; }
    // Must end with 0xee byte right after
    if (buf[p + 2 + lenU16] !== 0xee) { p++; continue; }
    const name = buf.slice(p + 2, p + 2 + lenU16).toString("ascii");
    // Must look like a unit name (some space and >1 word, or single word)
    if (!/^[a-z]/.test(name)) { p++; continue; }
    // Hash, uuid, constants
    const hashStart = p + 2 + lenU16 + 1;
    const hash = buf.slice(hashStart, hashStart + 8);
    const uuid = buf.slice(hashStart + 8, hashStart + 16);
    const tag = buf.readUInt32LE(hashStart + 16);
    const constField = buf.readUInt32LE(hashStart + 20);
    if (tag !== 0x0001012c) { p++; continue; }
    // Settlement name UTF-16LE
    const settLenOff = hashStart + 24;
    const settLen = buf.readUInt16LE(settLenOff);
    if (settLen > 60 || settLen < 1) { p++; continue; }
    const settBytesEnd = settLenOff + 2 + settLen * 2;
    if (settBytesEnd + 4 > end) { p++; continue; }
    let settOk = true;
    for (let i = 0; i < settLen; i++) {
      const c = buf.readUInt16LE(settLenOff + 2 + i * 2);
      if (c < 0x20 || c > 0x7e) { settOk = false; break; }
    }
    if (!settOk) { p++; continue; }
    const sett = buf.slice(settLenOff + 2, settBytesEnd).toString("utf16le");
    const term = buf.readUInt32LE(settBytesEnd);
    if (term !== 0xffffffff) { p++; continue; }

    // Now persistent header begins:
    const hdrStart = settBytesEnd + 4;
    const u32_0 = buf.readUInt32LE(hdrStart);          // 0xffffffff
    const f32_pos1 = buf.readFloatLE(hdrStart + 4);
    const f32_pos2 = buf.readFloatLE(hdrStart + 8);
    const soldierCurr = buf.readUInt32LE(hdrStart + 12);
    const soldierMax = buf.readUInt32LE(hdrStart + 16);

    records.push({
      off: p, name, hash, uuid, sett,
      hdrStart,
      pos1: f32_pos1, pos2: f32_pos2,
      soldierCurr, soldierMax,
    });

    // Skip past header + soldiers + padding for next find
    // 44 byte header + N × 9 byte soldier records
    const soldierStart = hdrStart + 44;
    const soldierEnd = soldierStart + soldierCurr * 9;
    // Skip past 0xff padding
    let q = soldierEnd;
    while (q < end && buf[q] === 0xff) q++;
    if (q > soldierEnd) p = q; else p = soldierEnd;
  }
  return records;
}

console.log("Extracting field-army records...");
const armies = findFieldArmyRecords(buf, FIELD_ARMY_START, FIELD_ARMY_END);
console.log(`Field-army records found: ${armies.length}`);
console.log(`First few:`);
for (let i = 0; i < Math.min(5, armies.length); i++) {
  const a = armies[i];
  console.log(`  [${i}] off=0x${a.off.toString(16)} name="${a.name}" sett="${a.sett}" pos=(${a.pos1.toFixed(2)},${a.pos2.toFixed(2)}) soldiers=${a.soldierCurr}/${a.soldierMax}`);
  console.log(`       hash=${a.hash.toString("hex")} uuid=${a.uuid.toString("hex")}`);
}

// pos1/pos2 likely the tile coord as float. Check if all are in valid range
const validPosArmies = armies.filter(a => a.pos1 > 0 && a.pos1 < 1500 && a.pos2 > 0 && a.pos2 < 1500);
console.log(`\nArmies with valid pos1/pos2 in (0..1500): ${validPosArmies.length} / ${armies.length}`);

// Position range
if (validPosArmies.length > 0) {
  const p1s = validPosArmies.map(a => a.pos1);
  const p2s = validPosArmies.map(a => a.pos2);
  console.log(`pos1 range: [${Math.min(...p1s).toFixed(2)} .. ${Math.max(...p1s).toFixed(2)}]`);
  console.log(`pos2 range: [${Math.min(...p2s).toFixed(2)} .. ${Math.max(...p2s).toFixed(2)}]`);
}

// ── 2. Parse the lua-footer tile-trail array ─────────────────────────────
function parseTrail(buf, trailStart) {
  const chunks = [];
  let p = trailStart;
  while (p + 4 < buf.length) {
    const N = buf.readUInt32LE(p);
    if (N === 0) { p += 4; continue; }
    if (N > 200) break;
    const chunkStart = p;
    p += 4;
    const records = [];
    let valid = true;
    for (let i = 0; i < N; i++) {
      if (p + 6 > buf.length) { valid = false; break; }
      const selfPtr = buf.readUInt32LE(p);
      const pairCount = buf.readUInt16LE(p + 4);
      if (selfPtr !== p) { valid = false; break; }
      if (pairCount > 100) { valid = false; break; }
      const pairs = [];
      p += 6;
      for (let j = 0; j < pairCount; j++) {
        if (p + 8 > buf.length) { valid = false; break; }
        const x = buf.readUInt32LE(p);
        const y = buf.readUInt32LE(p + 4);
        pairs.push({ x, y });
        p += 8;
      }
      if (!valid) break;
      records.push({ off: selfPtr, pairCount, pairs });
    }
    if (!valid) { p = chunkStart; break; }
    chunks.push({ start: chunkStart, N, records });
  }
  return { chunks, endOffset: p };
}

console.log("\nParsing trail array...");
const trail = parseTrail(buf, TRAIL_START);
console.log(`Total chunks: ${trail.chunks.length}, endOffset 0x${trail.endOffset.toString(16)} (file end 0x${buf.length.toString(16)})`);

const allTrailRecs = [];
for (const c of trail.chunks) for (const r of c.records) allTrailRecs.push(r);
console.log(`Total trail records: ${allTrailRecs.length}`);
const nonEmptyTrails = allTrailRecs.filter(r => r.pairCount > 0);
console.log(`Non-empty trails: ${nonEmptyTrails.length}`);

// PairCount histogram
const pcHist = {};
for (const r of allTrailRecs) pcHist[r.pairCount] = (pcHist[r.pairCount] || 0) + 1;
console.log("PairCount histogram:");
for (const [pc, c] of Object.entries(pcHist).sort((a,b) => +a[0] - +b[0])) console.log(`  pc=${pc}: ${c}`);

// ── 3. Cross-check: does each non-empty trail's first pair match a field-army position? ───
// Build a set of (x,y) for armies
const armyCoords = validPosArmies.map(a => ({
  x: Math.round(a.pos1), y: Math.round(a.pos2), name: a.name, sett: a.sett,
}));
const armyCoordSet = new Set(armyCoords.map(a => `${a.x},${a.y}`));

let matchCount = 0;
const matchedTrails = [];
const unmatchedTrails = [];
for (const r of nonEmptyTrails) {
  const first = r.pairs[0];
  const k = `${first.x},${first.y}`;
  if (armyCoordSet.has(k)) {
    matchCount++;
    matchedTrails.push({ ...r, first });
  } else {
    unmatchedTrails.push({ ...r, first });
  }
}
console.log(`\nNon-empty trails whose first pair matches a field-army (x,y): ${matchCount}/${nonEmptyTrails.length}`);

// Examine a few non-empty trails to see what their pairs look like
console.log(`\n--- First 15 non-empty trails ---`);
for (let i = 0; i < Math.min(15, nonEmptyTrails.length); i++) {
  const r = nonEmptyTrails[i];
  const pairs = r.pairs.map(p => `(${p.x},${p.y})`).join(" → ");
  console.log(`  trail[${i}] @0x${r.off.toString(16)} pc=${r.pairCount}: ${pairs}`);
}

// Sample 10 field-army positions
console.log(`\n--- First 15 field-army positions ---`);
for (let i = 0; i < Math.min(15, validPosArmies.length); i++) {
  const a = validPosArmies[i];
  console.log(`  army[${i}] (${Math.round(a.pos1)},${Math.round(a.pos2)}) "${a.name}" sett="${a.sett}"`);
}
