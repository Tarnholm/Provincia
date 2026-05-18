const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const target = "greek general";
let p = 0, found = 0;
while ((p = buf.indexOf(target, p)) !== -1 && found < 5) {
  // Dump 8 bytes before and 32 after
  const start = Math.max(0, p - 8);
  const end = Math.min(buf.length, p + target.length + 32);
  const hex = [];
  const ascii = [];
  for (let i = start; i < end; i++) {
    hex.push(buf[i].toString(16).padStart(2, "0"));
    ascii.push(buf[i] >= 0x20 && buf[i] < 0x7f ? String.fromCharCode(buf[i]) : ".");
  }
  console.log(`occurrence ${found + 1} at 0x${p.toString(16)}:`);
  console.log("  hex:", hex.join(" "));
  console.log("  asc:", ascii.join(" "));
  console.log("  (16 = target start)");
  p += target.length;
  found++;
}
