// v4: Wide sweep. For every byte offset r-256..r+512 (across all 109
// "greek general" characters), compute uniqueness and whether all values
// fit in 0..187 (greek pool size). Report top candidates.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u8 = (o) => buf[o];
const u16 = (o) => buf[o] | (buf[o + 1] << 8);

const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const positions = [];
let p = 0;
while ((p = buf.indexOf(ROLE_STR, p)) !== -1) {
  positions.push(p + 2);
  p += ROLE_STR.length;
}

const records = positions.filter(r => r - 512 >= 0 && r + 1024 < buf.length);
console.log(`records: ${records.length}`);

// Bucket: each offset → array of values across records
const sweepMin = -256, sweepMax = 1024;
const byteCands = []; // {off, unique, allInPool, vals}
const u16Cands = [];

for (let off = sweepMin; off <= sweepMax; off++) {
  const vals = records.map(r => u8(r + off));
  const unique = new Set(vals).size;
  const inPool = vals.every(v => v >= 0 && v <= 187);
  if (inPool && unique >= 50) {
    byteCands.push({ off, unique, vals });
  }
}
for (let off = sweepMin; off <= sweepMax - 1; off++) {
  const vals = records.map(r => u16(r + off));
  const unique = new Set(vals).size;
  const inPool = vals.every(v => v >= 0 && v <= 478); // roman pool max
  if (inPool && unique >= 50) {
    u16Cands.push({ off, unique, vals });
  }
}

console.log(`\nU8 candidates (unique >= 50, all values 0..187):`);
for (const c of byteCands.slice(0, 20)) {
  console.log(`  off=${c.off >= 0 ? "+" : ""}${c.off}  unique=${c.unique}/${records.length}  first10: [${c.vals.slice(0, 10).join(",")}]`);
}
console.log(`\nU16 candidates (unique >= 50, all values 0..478):`);
for (const c of u16Cands.slice(0, 20)) {
  console.log(`  off=${c.off >= 0 ? "+" : ""}${c.off}  unique=${c.unique}/${records.length}  first10: [${c.vals.slice(0, 10).join(",")}]`);
}

console.log(`\n(total u8 candidates: ${byteCands.length}, u16 candidates: ${u16Cands.length})`);
