// Find body root by locating end of registry + finding first valid
// section header {u32 ptr==pos, u32 size}.
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

// Walk past registry
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
console.log(`registry ends at 0x${p.toString(16)}`);
console.log(`first 32 bytes after registry:`);
for (let off = p; off < p + 64; off += 16) {
  let hex = "", asc = "";
  for (let i = 0; i < 16; i++) {
    const b = buf[off + i];
    hex += b.toString(16).padStart(2, "0") + " ";
    asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
  }
  console.log(`  0x${off.toString(16)}: ${hex.padEnd(48)} | ${asc}`);
}

// Find first self-pointer after registry — that's the body root
console.log("\nfirst self-pointers after registry:");
let count = 0;
for (let q = p; q < p + 0x2000 && count < 20; q++) {
  if (q + 4 > buf.length) break;
  if (buf.readUInt32LE(q) === q) {
    const size = buf.readUInt32LE(q + 4);
    console.log(`  0x${q.toString(16)}  +4=u32 0x${size.toString(16)} (=${size})`);
    count++;
  }
}
