// Walk backward from a known stride-364 self-pointer until the stride
// breaks — that's the start of the character pool.
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const KNOWN = 0x1514037;
const STRIDE = 364;

// Walk back
let cur = KNOWN;
let count = 0;
while (true) {
  const next = cur - STRIDE;
  if (next < 0) break;
  if (buf.readUInt32LE(next) !== next) break;
  cur = next;
  count++;
}
console.log(`stride-364 array start: 0x${cur.toString(16)}`);
console.log(`from-known walked: ${count} records back`);

// Walk forward
let cur2 = KNOWN;
let count2 = 0;
while (true) {
  const next = cur2 + STRIDE;
  if (next + 4 >= buf.length) break;
  if (buf.readUInt32LE(next) !== next) break;
  cur2 = next;
  count2++;
}
console.log(`stride-364 array end (last self-ptr): 0x${cur2.toString(16)}`);
console.log(`from-known walked: ${count2} records forward`);

const arrayStart = cur;
const arrayEndPtr = cur2;
const totalRecords = count + count2 + 1;
const arrayEnd = arrayEndPtr + STRIDE; // approximate end
const arraySize = arrayEnd - arrayStart;
console.log(`\nTotal: ${totalRecords} records, ${arraySize.toLocaleString()} bytes (${(arraySize/1024).toFixed(1)} KB)`);

// Dump bytes BEFORE the array start (looking for a header with record count)
console.log("\n=== 128 bytes BEFORE array start (header) ===");
for (let off = arrayStart - 128; off < arrayStart; off += 16) {
  let hex = "", asc = "";
  for (let i = 0; i < 16; i++) {
    const b = buf[off + i];
    hex += b.toString(16).padStart(2, "0") + " ";
    asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
  }
  console.log(`  0x${off.toString(16)}: ${hex.padEnd(48)} | ${asc}`);
}

// Look for u32 = totalRecords nearby
console.log(`\nlook for u32 = ${totalRecords} or close in 1KB before array start:`);
for (let p = arrayStart - 1024; p < arrayStart; p++) {
  const v = buf.readUInt32LE(p);
  if (v >= totalRecords - 10 && v <= totalRecords + 10) {
    console.log(`  0x${p.toString(16)}: ${v}`);
  }
}

// Now read field +12 (own UUID) of first 10 records to see what they hold
console.log(`\n=== first 10 records (record_pos, +12 u32 = own UUID hypothesis) ===`);
let p = arrayStart;
for (let i = 0; i < 10 && p + STRIDE < buf.length; i++, p += STRIDE) {
  const selfPtr = buf.readUInt32LE(p);
  const ownUuid = buf.readUInt32LE(p + 12);
  const next4 = buf.readUInt32LE(p + 4);
  const next8 = buf.readUInt32LE(p + 8);
  console.log(`  rec ${i} @ 0x${p.toString(16)}: self=0x${selfPtr.toString(16)} +4=0x${next4.toString(16).padStart(8,'0')} +8=0x${next8.toString(16).padStart(8,'0')} +12=0x${ownUuid.toString(16).padStart(8,'0')}`);
}
