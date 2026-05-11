// dig-path-cache2.js — Test alternative hypothesis: trail chunks are PER-FACTION,
// records-within-chunk are per-character (army leader).
// Confirm by checking if non-empty-trail coords are all in main settlement zone
// (= settlements faction is targeting). And/or match the field-army tail's settlement
// → resolve the settlement name → (X,Y) via main settlement zone records.

const fs = require("fs");
const buf = fs.readFileSync("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav");

// ── Re-extract field-army records (session 22 pattern) ──
const FIELD_ARMY_START = 0x1f10c72;
const FIELD_ARMY_END = 0x1f43688;

function findUnitRecords() {
  const records = [];
  for (let p = FIELD_ARMY_START; p + 2 < FIELD_ARMY_END; p++) {
    const len = buf.readUInt16LE(p);
    if (len < 4 || len > 50) continue;
    if (p + 2 + len > FIELD_ARMY_END) continue;
    const s = buf.slice(p + 2, p + 2 + len).toString('ascii');
    if (!/^[a-z][a-z ]+[a-z]\0?$/.test(s)) continue;
    records.push({ off: p, len, name: s.replace(/\0$/, '') });
  }
  return records;
}

function parseUnit(r, nextOff) {
  const nameEnd = r.off + 2 + r.len;
  // Find settlement name within (nameEnd, nextOff)
  for (let p = nameEnd; p + 4 < nextOff; p++) {
    const sl = buf.readUInt16LE(p);
    if (sl < 3 || sl > 30) continue;
    if (p + 2 + sl * 2 > nextOff) continue;
    let ok = true;
    for (let i = 0; i < sl; i++) {
      const c = buf.readUInt16LE(p + 2 + i * 2);
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
    }
    if (!ok) continue;
    const sett = buf.slice(p + 2, p + 2 + sl * 2).toString("utf16le");
    if (!/^[A-Z]/.test(sett)) continue;
    return { nameEnd, settOff: p, settLen: sl, settName: sett };
  }
  return { nameEnd };
}

const units = findUnitRecords();
const parsed = [];
for (let i = 0; i < units.length; i++) {
  const r = units[i];
  const next = i + 1 < units.length ? units[i + 1].off : FIELD_ARMY_END;
  const info = parseUnit(r, next);
  parsed.push({ ...r, ...info });
}
const validUnits = parsed.filter(p => p.settName);
console.log(`Total parsed field-army records: ${validUnits.length}`);

// Distinct settlement names
const settlements = new Set(validUnits.map(p => p.settName));
console.log(`Distinct settlements referenced: ${settlements.size}`);
console.log(`Settlements: ${[...settlements].join(", ")}`);

// ── Parse trail array ──
const TRAIL_START = 0x2110a24;
function parseTrail(start) {
  const chunks = [];
  let p = start;
  while (p + 4 < buf.length) {
    const N = buf.readUInt32LE(p);
    if (N === 0) { p += 4; continue; }
    if (N > 200) break;
    const chunkStart = p;
    p += 4;
    const recs = [];
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
      recs.push({ off: selfPtr, pairCount, pairs });
    }
    if (!valid) { p = chunkStart; break; }
    chunks.push({ start: chunkStart, N, records: recs });
  }
  return { chunks, endOffset: p };
}

const trail = parseTrail(TRAIL_START);
console.log(`\n${trail.chunks.length} chunks parsed`);

// Per chunk: count non-empty trails
const chunkStats = trail.chunks.map((c, i) => {
  const nonEmpty = c.records.filter(r => r.pairCount > 0).length;
  const totalPairs = c.records.reduce((s, r) => s + r.pairCount, 0);
  // collect unique coords
  const coords = new Set();
  for (const r of c.records) {
    for (const p of r.pairs) coords.add(`${p.x},${p.y}`);
  }
  return { idx: i, N: c.N, recCount: c.records.length, nonEmpty, totalPairs, distinctCoords: coords.size };
});

// First 20 chunks
console.log(`\n--- First 25 chunks (idx, N, recCount, nonEmpty, totalPairs, distinctCoords) ---`);
for (const s of chunkStats.slice(0, 25)) {
  console.log(`  chunk[${s.idx.toString().padStart(3)}] N=${s.N.toString().padStart(3)} recs=${s.recCount.toString().padStart(3)} nonEmpty=${s.nonEmpty.toString().padStart(3)} totalPairs=${s.totalPairs.toString().padStart(3)} distinctCoords=${s.distinctCoords}`);
}

// How many chunks have nonEmpty > 0?
const activeChunks = chunkStats.filter(s => s.nonEmpty > 0);
console.log(`\nChunks with at least 1 non-empty trail: ${activeChunks.length}/${chunkStats.length}`);
const totalNonEmpty = chunkStats.reduce((s, x) => s + x.nonEmpty, 0);
console.log(`Total non-empty trails across all chunks: ${totalNonEmpty}`);

// Hypothesis: maybe each non-empty trail's coord = a tile a faction has armies/intent at.
// Cross-check trail coords (the (X,Y) pairs) against the settlement-model block's 201 (X,Y) coords:
// Get distinct trail-pair coord set
const trailCoords = new Set();
for (const c of trail.chunks) for (const r of c.records) for (const p of r.pairs) trailCoords.add(`${p.x},${p.y}`);
console.log(`\nDistinct (X,Y) coords used in trail pairs: ${trailCoords.size}`);

// Load settlement-model block coords
function isModelChar(b) { return (b>=0x41&&b<=0x5a)||(b>=0x61&&b<=0x7a)||(b>=0x30&&b<=0x39)||b===0x5f; }
const knownModels = new Set([
  "W_hellenistic_Large_Town","W_hellenistic_Large_City","Celtic_Large_Town",
  "W_hellenistic_City","Eastern_Large_Town","Illyrian_Large_Town",
  "W_hellenistic_Town","Celtic_City","W_hellenistic_Huge_City",
  "Carthaginian_Huge_City","Carthaginian_Large_Town","Eastern_City",
  "Germanic_Large_Town","Nomad_Large_Town","Eastern_Town","Eastern_Huge_City",
  "Carthaginian_City","Egyptian_Large_Town","Celtic_Town","Carthaginian_Town",
  "Egyptian_Town","Illyrian_Town","Germanic_Town","Nomad_Town",
]);
const modelCoords = new Set();
for (let p = 0x1f43000; p + 2 < 0x1f95000; p++) {
  const lp1 = buf.readUInt16LE(p);
  if (lp1 < 9 || lp1 > 30) continue;
  if (p + 2 + lp1 > 0x1f95000) continue;
  const sl = lp1 - 1;
  let ok = true;
  for (let i = 0; i < sl; i++) if (!isModelChar(buf[p + 2 + i])) { ok = false; break; }
  if (!ok) continue;
  if (buf[p + 2 + sl] !== 0) continue;
  const nm = buf.slice(p + 2, p + 2 + sl).toString("ascii");
  if (!knownModels.has(nm)) continue;
  const postName = p + 2 + lp1;
  const tag = buf.readUInt32LE(postName);
  if (tag !== 27 && tag !== 29 && tag !== 31) { p = postName - 1; continue; }
  const x = buf.readUInt32LE(postName + 4);
  const y = buf.readUInt32LE(postName + 8);
  modelCoords.add(`${x},${y}`);
  p = postName - 1;
}
console.log(`Distinct settlement-model coords (rome10): ${modelCoords.size}`);

// Intersection
const trailInModel = [...trailCoords].filter(c => modelCoords.has(c));
const modelInTrail = [...modelCoords].filter(c => trailCoords.has(c));
console.log(`Trail coords that ARE in model coord set: ${trailInModel.length}`);
console.log(`Model coords that ARE in trail coord set: ${modelInTrail.length}`);
console.log(`\nFirst 20 trail coords IN model set (= faction intent targets settlements):`);
for (const c of trailInModel.slice(0, 20)) console.log(`  (${c})`);

console.log(`\nFirst 20 trail coords NOT in model set (= field tiles, not settlements):`);
const nonSettleTrails = [...trailCoords].filter(c => !modelCoords.has(c));
for (const c of nonSettleTrails.slice(0, 20)) console.log(`  (${c})`);

// Examine chunk[0]: per session 16 this is the player Romans Julii faction with N=104 records.
// Look at its non-empty trails:
console.log(`\n--- chunk[0] non-empty trails ---`);
const ch0 = trail.chunks[0];
for (let i = 0; i < ch0.records.length; i++) {
  const r = ch0.records[i];
  if (r.pairCount === 0) continue;
  const pairs = r.pairs.map(p => `(${p.x},${p.y})${modelCoords.has(`${p.x},${p.y}`) ? "[S]" : ""}`).join(" → ");
  console.log(`  rec[${i}] @0x${r.off.toString(16)} pc=${r.pairCount}: ${pairs}`);
}
