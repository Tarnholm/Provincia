// dig-econ-registry-full.js
// Dump the ENTIRE 106-type registry with id, count, name. Determine what `count`
// means (field-count? sub-record count? version?). Pay attention to FACTION (id?),
// FACTION_ECONOMICS (91, count 36), ECONOMICS_DATA (count 4), and any *ECON* type.
const fs = require("fs");
const path = require("path");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const buf = fs.readFileSync(path.join(BASE, "save_macedon t0.sav"));

let p = 0x3310;
const types = [];
while (true) {
  const count = buf.readUInt32LE(p);
  const ns = p + 4;
  const end = buf.indexOf(0, ns);
  if (end === -1 || end > ns + 60) break;
  const name = buf.slice(ns, end).toString("latin1");
  if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
  types.push({ id: types.length, offset: p, name, count });
  p = end + 1;
}
console.log(`registry: ${types.length} types @0x3310..0x${p.toString(16)}\n`);
for (const t of types) {
  const mark = /ECON|FACTION|TREAS|INCOME|MONEY|FINANC|TAX|TRADE/.test(t.name) ? "  <<<" : "";
  console.log(`  id=${String(t.id).padStart(3)} count=${String(t.count).padStart(6)} ${t.name}${mark}`);
}
