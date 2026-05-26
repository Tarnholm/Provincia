// dig-econ-registry-format.js
// Determine the EXACT registry format: is the leading u32 a total-type count
// (making each subsequent count a field-count, with the reader off-by-one), or
// is each [count][name] a faithful pair? Dump raw bytes around 0x3310 and the
// FACTION_ECONOMICS entry. Then test whether the body holds 36 contiguous
// econ records by looking for a section length / array near a plausible anchor.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

function hex(o, n) {
  return Array.from(buf.slice(o, o + n)).map(b => b.toString(16).padStart(2, "0")).join(" ");
}

// Show 32 bytes BEFORE 0x3310 to see if there's a standalone type-count u32.
console.log("bytes 0x32f0..0x3340:");
for (let o = 0x32f0; o < 0x3340; o += 16) {
  console.log(`  0x${o.toString(16)}: ${hex(o, 16)}`);
}
console.log(`\nu32 @0x3310 = ${buf.readUInt32LE(0x3310)}  (this is what reader calls WORLD_MAP's count)`);
console.log(`u32 @0x330c = ${buf.readUInt32LE(0x330c)}`);
console.log(`u32 @0x3308 = ${buf.readUInt32LE(0x3308)}`);

// Walk registry, record each entry's offset so we can find FACTION_ECONOMICS raw.
let p = 0x3310;
const types = [];
while (true) {
  const count = buf.readUInt32LE(p);
  const nameStart = p + 4;
  const end = buf.indexOf(0x00, nameStart);
  if (end === -1 || end > nameStart + 60) break;
  const name = buf.slice(nameStart, end).toString("latin1");
  if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
  types.push({ id: types.length, offset: p, name, count });
  p = end + 1;
}
console.log(`\nregistry: ${types.length} types, ends at 0x${p.toString(16)}`);
const fe = types.find(t => t.name === "FACTION_ECONOMICS");
console.log(`FACTION_ECONOMICS: id=${fe.id} count=${fe.count} @0x${fe.offset.toString(16)}`);
console.log(`  raw: ${hex(fe.offset, 4)} | ${buf.slice(fe.offset + 4, buf.indexOf(0, fe.offset + 4)).toString("latin1")}`);

// Print what's right after registry (0x3328ish) — the HST section per memory.
console.log(`\nbytes right after registry (0x${p.toString(16)}):`);
for (let o = p; o < p + 64; o += 16) console.log(`  0x${o.toString(16)}: ${hex(o, 16)}`);

// Hypothesis check: the registry count for a type = how many of those objects
// are serialized. Print counts that == 36 or near the faction populations.
console.log("\ntypes with count in [20..60] (candidates for per-faction arrays):");
for (const t of types) if (t.count >= 20 && t.count <= 60) console.log(`  id=${t.id} ${t.name} count=${t.count}`);
