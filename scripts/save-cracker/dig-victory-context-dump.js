// dig-victory-context-dump.js
// Hex/u32 dump around a given offset so we can see what wraps the region-ID
// arrays (count prefix, faction owner, take_regions integer, outlive list).
// Research/diagnostics only.

const fs = require("fs");
const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const file = process.argv[2] || "save_macedon t0.sav";
const off = parseInt(process.argv[3] || "0x1538e24", 16);
const back = parseInt(process.argv[4] || "64", 10);
const fwd = parseInt(process.argv[5] || "320", 10);
const buf = fs.readFileSync(SAVES + file);
console.log(`=== ${file} — dump around 0x${off.toString(16)} (back ${back}, fwd ${fwd}) ===\n`);

const start = off - back;
for (let p = start; p < off + fwd; p += 4) {
  const v = buf.readUInt32LE(p);
  const i = buf.readInt32LE(p);
  const bytes = [...buf.slice(p, p + 4)].map(b => b.toString(16).padStart(2, "0")).join(" ");
  const ascii = [...buf.slice(p, p + 4)].map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
  const marker = p === off ? "  <== off" : "";
  console.log(`  0x${p.toString(16).padStart(7, "0")}  ${bytes}  u32=${String(v).padStart(10)}  i32=${String(i).padStart(11)}  '${ascii}'${marker}`);
}
