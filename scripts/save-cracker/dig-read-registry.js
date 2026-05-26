// Read the section type registry from Macedon T0 RIS save.
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

function readRegistry(buf) {
  let p = 0x100;
  // Scan forward for first valid {count u32, ASCII uppercase name terminated with null}
  while (p < 0x10000) {
    const count = buf.readUInt32LE(p);
    if (count > 0 && count < 100000) {
      const nameStart = p + 4;
      if (buf[nameStart] >= 0x41 && buf[nameStart] <= 0x5a) {
        const end = buf.indexOf(0x00, nameStart);
        if (end !== -1 && end > nameStart && end < nameStart + 60) {
          const name = buf.slice(nameStart, end).toString('latin1');
          if (/^[A-Z][A-Z_0-9]*$/.test(name)) break;
        }
      }
    }
    p++;
  }
  console.log(`registry starts at 0x${p.toString(16)}`);
  const types = [];
  while (true) {
    const count = buf.readUInt32LE(p);
    const nameStart = p + 4;
    const end = buf.indexOf(0x00, nameStart);
    if (end === -1 || end > nameStart + 60) break;
    const name = buf.slice(nameStart, end).toString('latin1');
    if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
    types.push({ id: types.length, offset: p, name, count });
    p = end + 1;
  }
  return types;
}

const types = readRegistry(buf);
console.log(`${types.length} section types\n`);
for (const t of types) {
  console.log(`  ID ${t.id.toString().padStart(3)}: ${t.name.padEnd(35)} count=${t.count.toString().padStart(8)}`);
}
