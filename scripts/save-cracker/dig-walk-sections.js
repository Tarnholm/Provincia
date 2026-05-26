// Walk through the save body section-by-section. Each section appears
// to start with {u32 self_ptr=pos, u32 size}. Walk by size to enumerate
// sections in registry order.
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

// Read registry to know section names and counts
let p = 0x3310;
const types = [];
while (true) {
  const count = buf.readUInt32LE(p);
  const nameStart = p + 4;
  const end = buf.indexOf(0x00, nameStart);
  if (end === -1 || end > nameStart + 60) break;
  const name = buf.slice(nameStart, end).toString('latin1');
  if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
  types.push({ id: types.length, name, count });
  p = end + 1;
}
const REGISTRY_END = p;
console.log(`registry ends at 0x${REGISTRY_END.toString(16)} with ${types.length} types`);

// Try different increment strategies
const candidates = [
  { name: "size only", inc: (s) => s },
  { name: "size + 8 (header)", inc: (s) => s + 8 },
  { name: "size + 4", inc: (s) => s + 4 },
];

for (const cand of candidates) {
  console.log(`\n=== strategy: ${cand.name} ===`);
  let cur = 0x3b99;
  let sectionIdx = 0;
  let maxIter = 10;
  while (cur + 8 < buf.length && maxIter-- > 0) {
    const selfPtr = buf.readUInt32LE(cur);
    const size = buf.readUInt32LE(cur + 4);
    const isSelfPtr = selfPtr === cur;
    const typeName = sectionIdx < types.length ? types[sectionIdx].name : "(?)";
    const typeCount = sectionIdx < types.length ? types[sectionIdx].count : 0;
    console.log(`  section ${sectionIdx.toString().padStart(3)}: 0x${cur.toString(16).padStart(8,'0')}  self?${isSelfPtr}  size=${size.toLocaleString().padStart(12)}  type=${typeName} (count=${typeCount})`);
    if (!isSelfPtr) {
      console.log(`  ** stopped`);
      break;
    }
    if (size < 8 || size > 50_000_000) break;
    cur += cand.inc(size);
    sectionIdx++;
  }
}

// Find the NEXT self-pointer after the end of WORLD_MAP
console.log("\n=== next self-pointers after 0x633bb3 ===");
let count = 0;
for (let q = 0x633bb3; q < buf.length && count < 10; q++) {
  if (q + 4 > buf.length) break;
  if (buf.readUInt32LE(q) === q) {
    const size = buf.readUInt32LE(q + 4);
    console.log(`  0x${q.toString(16)}  +4=size=0x${size.toString(16)} (=${size}) — distance from 0x633bb3: ${q - 0x633bb3}`);
    count++;
  }
}
