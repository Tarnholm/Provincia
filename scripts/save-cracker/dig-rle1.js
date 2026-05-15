// dig-rle1.js — Session 40 probe.
// Walk the 1.86MB block at ~0x1f4847b that starts with magic f0 0a af f0
// records. Confirm 239 records, get each record's byte range. Compare
// record sizes & start positions across multiple saves.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const SAVES = [
  "save_1.2.sav",
  "save_2.2.sav",
  "save_3.2.sav",
  "save_4.2.sav",
  "save_5.2.sav",
  "save_6.2.sav",
  "save_8.2.sav",
  "save_9.2.sav",
];

const MAGIC = Buffer.from([0xf0, 0x0a, 0xaf, 0xf0]);

function findAllMagic(buf, hint = 0) {
  const offsets = [];
  let p = hint;
  while (true) {
    const i = buf.indexOf(MAGIC, p);
    if (i < 0) break;
    offsets.push(i);
    p = i + 4;
  }
  return offsets;
}

// Per session 17: layout is
//   record start (selfPtr) at  magic - 8
//   width  u32 at magic + 4   (1020)
//   height u32 at magic + 8   (700)
//   payload starts magic + 12
function classifyRecord(buf, magicOff) {
  if (magicOff + 12 > buf.length) return null;
  const w = buf.readUInt32LE(magicOff + 4);
  const h = buf.readUInt32LE(magicOff + 8);
  const selfPtrA = magicOff - 8 >= 0 ? buf.readUInt32LE(magicOff - 8) : null;
  const selfPtrB = magicOff - 4 >= 0 ? buf.readUInt32LE(magicOff - 4) : null;
  return {
    magicOff,
    selfPtrA,
    selfPtrB,
    w,
    h,
    recordStart: magicOff - 8,
  };
}

function describeSave(name) {
  const fp = path.join(SAVE_DIR, name);
  const buf = fs.readFileSync(fp);
  const hint = 0x1f00000;
  const offsets = findAllMagic(buf, hint);
  const records = offsets.map(o => classifyRecord(buf, o)).filter(Boolean);
  return { name, size: buf.length, buf, records };
}

const results = SAVES.map(describeSave);

console.log("=== Save record summary ===");
for (const r of results) {
  console.log(`${r.name.padEnd(14)} size=${r.size} magic-count=${r.records.length} first=${r.records[0] ? "0x" + r.records[0].magicOff.toString(16) : "none"} last=${r.records.at(-1) ? "0x" + r.records.at(-1).magicOff.toString(16) : "none"}`);
}

// Confirm width/height stable
const wHist = new Map();
const hHist = new Map();
for (const r of results) {
  for (const rec of r.records) {
    wHist.set(rec.w, (wHist.get(rec.w) || 0) + 1);
    hHist.set(rec.h, (hHist.get(rec.h) || 0) + 1);
  }
}
console.log("\n=== width / height across all records, all saves ===");
console.log("w hist:", [...wHist.entries()]);
console.log("h hist:", [...hHist.entries()]);

// Compute per-record gap sizes (magic-to-magic) for save_1.2
const ref = results[0];
const gaps = [];
for (let i = 0; i < ref.records.length - 1; i++) {
  gaps.push(ref.records[i + 1].magicOff - ref.records[i].magicOff);
}
console.log(`\n=== save_1.2 first 30 magic-to-magic gaps ===`);
console.log(gaps.slice(0, 30).map(g => g.toString()).join(" "));
console.log(`\n=== save_1.2 last 30 magic-to-magic gaps ===`);
console.log(gaps.slice(-30).map(g => g.toString()).join(" "));

// Summary stats
gaps.sort((a, b) => a - b);
const tot = gaps.reduce((a, b) => a + b, 0);
console.log(`\nsave_1.2: gaps n=${gaps.length} min=${gaps[0]} max=${gaps.at(-1)} med=${gaps[Math.floor(gaps.length / 2)]} mean=${(tot / gaps.length).toFixed(1)}`);

// Compare record counts across saves
const refCount = ref.records.length;
const allMatch = results.every(r => r.records.length === refCount);
console.log(`\nAll saves have ${refCount} records? ${allMatch}`);

// For each save pair-of-interest, list per-record SIZE diffs
function recordSize(rec, nextRec, fileSize) {
  const end = nextRec ? nextRec.recordStart : null;
  return end !== null ? end - rec.recordStart : null;
}

function sizesOf(save) {
  const sizes = [];
  for (let i = 0; i < save.records.length; i++) {
    const r = save.records[i];
    const next = save.records[i + 1];
    sizes.push(recordSize(r, next, save.size));
  }
  return sizes;
}

const allSizes = results.map(sizesOf);

// Find indices where sizes differ between any two saves
console.log("\n=== records whose SIZE differs between any two saves ===");
const N = refCount;
let diffSizeCount = 0;
const sizeDiffsByRec = [];
for (let i = 0; i < N; i++) {
  const sizes = allSizes.map(s => s[i]);
  const set = new Set(sizes);
  if (set.size > 1) {
    diffSizeCount++;
    sizeDiffsByRec.push({ rec: i, sizes });
  }
}
console.log(`records differing in size: ${diffSizeCount} / ${N}`);
for (const d of sizeDiffsByRec.slice(0, 20)) {
  console.log(`  rec ${d.rec}: ${d.sizes.join(" ")}`);
}
if (sizeDiffsByRec.length > 20) console.log(`  ... ${sizeDiffsByRec.length - 20} more`);

// Now find which records have changed BYTES between specific save pairs.
// Compare same-index records ONLY where sizes match; otherwise mark as
// "size changed".
function recordBytes(save, idx) {
  const r = save.records[idx];
  const next = save.records[idx + 1];
  const end = next ? next.recordStart : null;
  if (end === null) return null;
  return save.buf.subarray(r.recordStart, end);
}

function compare(a, b, label) {
  console.log(`\n=== ${label}: ${a.name} vs ${b.name} ===`);
  let sizeChanged = 0;
  let bytesIdentical = 0;
  let bytesChanged = 0;
  const changed = [];
  for (let i = 0; i < N; i++) {
    const ba = recordBytes(a, i);
    const bb = recordBytes(b, i);
    if (!ba || !bb) continue;
    if (ba.length !== bb.length) {
      sizeChanged++;
      changed.push({ i, kind: "size", la: ba.length, lb: bb.length });
      continue;
    }
    let diffs = 0;
    for (let k = 0; k < ba.length; k++) {
      if (ba[k] !== bb[k]) diffs++;
    }
    if (diffs === 0) bytesIdentical++;
    else {
      bytesChanged++;
      changed.push({ i, kind: "bytes", diffs, len: ba.length });
    }
  }
  console.log(`  identical=${bytesIdentical} bytes-changed=${bytesChanged} size-changed=${sizeChanged}`);
  for (const c of changed.slice(0, 25)) {
    if (c.kind === "size") console.log(`    rec ${c.i}: SIZE ${c.la} → ${c.lb}`);
    else console.log(`    rec ${c.i}: BYTES diffs=${c.diffs}/${c.len}`);
  }
  if (changed.length > 25) console.log(`    ... ${changed.length - 25} more`);
  return changed;
}

// Pairs of interest
function find(name) {
  return results.find(r => r.name === name);
}
compare(find("save_1.2.sav"), find("save_2.2.sav"), "BUILDING QUEUED (Roma stone_wall)");
compare(find("save_1.2.sav"), find("save_3.2.sav"), "LEVIES QUEUED (Roma)");
compare(find("save_1.2.sav"), find("save_4.2.sav"), "QUEUE CLEARED (back to T1)");
compare(find("save_5.2.sav"), find("save_6.2.sav"), "SHIP MOVED");
compare(find("save_8.2.sav"), find("save_9.2.sav"), "TOGGLE_FOW");
