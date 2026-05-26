// dig-victory-registry.js
// Dump the full section-type registry from RIS saves and flag any
// win-condition / outlive / region-count related section types.
// Research/diagnostics only — no app code touched.

const fs = require("fs");
const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

function readRegistry(buf) {
  let p = 0x100;
  while (p < 0x10000) {
    const count = buf.readUInt32LE(p);
    if (count > 0 && count < 100000) {
      const nameStart = p + 4;
      if (buf[nameStart] >= 0x41 && buf[nameStart] <= 0x5a) {
        const end = buf.indexOf(0x00, nameStart);
        if (end !== -1 && end > nameStart && end < nameStart + 60) {
          const name = buf.slice(nameStart, end).toString("latin1");
          if (/^[A-Z][A-Z_0-9]*$/.test(name)) break;
        }
      }
    }
    p++;
  }
  const types = [];
  const start = p;
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
  return { types, start, end: p };
}

const file = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(SAVES + file);
console.log(`=== ${file} (${buf.length} bytes) ===`);
const { types, start, end } = readRegistry(buf);
console.log(`registry @ 0x${start.toString(16)}..0x${end.toString(16)}, ${types.length} types\n`);
for (const t of types) {
  const flag = /WIN|OUTLIVE|VICTOR|REGION|GOAL|CAMPAIGN|HOLD|CONDITION/i.test(t.name) ? "  <<<" : "";
  console.log(`  ID ${String(t.id).padStart(3)} @0x${t.offset.toString(16).padStart(5,"0")}: ${t.name.padEnd(40)} count=${String(t.count).padStart(8)}${flag}`);
}
