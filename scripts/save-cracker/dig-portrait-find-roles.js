const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const roles = [
  "greek general", "greek diplomat", "greek spy", "greek assassin", "greek admiral",
  "greek captain", "greek princess", "greek priest", "greek named",
  "macedon general", "macedon", "general", "diplomat", "spy", "named character",
  "named_character", "leader", "heir", "Antigonus", "Antigonos", "Pyrrhos",
];
for (const r of roles) {
  const pat = Buffer.concat([Buffer.from([r.length, 0]), Buffer.from(r, "ascii")]);
  let c = 0, p = 0, firstAt = -1;
  while ((p = buf.indexOf(pat, p)) !== -1) {
    c++;
    if (firstAt < 0) firstAt = p;
    p += pat.length;
  }
  if (c > 0) console.log(`pstr16 '${r}': ${c} (first at 0x${firstAt.toString(16)})`);
}
console.log("---");
for (const r of ["greek general", "general", "macedon", "Antigonus", "Antigonos"]) {
  let c = 0, p = 0;
  while ((p = buf.indexOf(r, p)) !== -1) { c++; p += r.length; }
  console.log(`raw '${r}': ${c}`);
}
