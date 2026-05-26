// Relax the parseFactionTreasuries signature progressively to find
// the 13 missing FACTION_ECONOMICS records (registry says 36, we find 23).
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

// Baseline (parseFactionTreasuries): +12=1, +16=0, +20=0, +24=self, +32=0, +36=0, +40=self, +44=6, +8=100
// Relax: drop +44=6 (allow other small constants) and +8=100 (allow other classes)

function scanWithRelaxation(constraints) {
  const out = [];
  for (let i = 0; i + 96 < buf.length; i += 1) {
    if (constraints.requireV12 && buf.readUInt32LE(i + 12) !== 1) continue;
    if (constraints.requireZero1620 && (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0)) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (constraints.requireZero3236 && (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0)) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    const v44 = buf.readUInt32LE(i + 44);
    const v48 = buf.readUInt32LE(i + 48);
    const v8 = buf.readUInt32LE(i + 8);
    const v0 = buf.readInt32LE(i);
    out.push({ offset: i, treasury: v0, v8, v12: buf.readUInt32LE(i + 12), v44, v48 });
  }
  return out;
}

console.log("=== A: ALL records with both self-pointers (no other constraints) ===");
const all = scanWithRelaxation({});
console.log(`found ${all.length} records`);

// Distribution of +8 and +44 values
const v8dist = new Map();
const v44dist = new Map();
for (const r of all) {
  v8dist.set(r.v8, (v8dist.get(r.v8) || 0) + 1);
  v44dist.set(r.v44, (v44dist.get(r.v44) || 0) + 1);
}
console.log("\n+8 distribution (top 20):");
for (const [k, v] of Array.from(v8dist.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  v8=${k.toString().padStart(8)} (0x${k.toString(16)}) : ${v}`);
}
console.log("\n+44 distribution (top 20):");
for (const [k, v] of Array.from(v44dist.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  v44=${k.toString().padStart(8)} (0x${k.toString(16)}) : ${v}`);
}

// Look for records with +8 != 100 and +12 == 1 (probably econ-like)
console.log("\n=== B: +12=1, +24/+40 self-ptr, ANY +8 ===");
const b = scanWithRelaxation({ requireV12: true });
console.log(`found ${b.length} records`);
const classCounts = new Map();
for (const r of b) classCounts.set(r.v8, (classCounts.get(r.v8) || 0) + 1);
console.log("classes:");
for (const [k, v] of Array.from(classCounts.entries()).sort((a, b) => b[1] - a[1])) {
  console.log(`  +8=${k.toString().padStart(4)} (0x${k.toString(16).padStart(4,'0')}) : ${v}`);
}

// Look for records JUST AFTER the 23 known major records (within next 1 MB)
const known23End = 0x017b0e34;
console.log(`\n=== C: relax v44 — known records end at 0x${known23End.toString(16)}; what's after? ===`);
const afterMajor = b.filter(r => r.offset > known23End && r.offset < known23End + 1024 * 1024 * 5);
console.log(`${afterMajor.length} records with self-ptr pair + v12=1 in the 5MB after last major record:`);
for (const r of afterMajor.slice(0, 20)) {
  console.log(`  0x${r.offset.toString(16)}  v0(t?)=${r.treasury}  v8=${r.v8}  v44=${r.v44}  v48=${r.v48}`);
}
