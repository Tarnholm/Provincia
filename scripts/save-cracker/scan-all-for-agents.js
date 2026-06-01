"use strict";
const fs = require("fs");
const path = require("path");
const NUL = String.fromCharCode(0);
const dirs = [
  "C:\\dev\\crash-saves-v7.2",
  "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves",
];
function walk(d, out) {
  let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.sav$/i.test(e.name)) out.push(full);
  }
}
const saves = [];
for (const d of dirs) walk(d, saves);
const roles = ["diplomat","spy","assassin","merchant","admiral","princess","witch"];
function cnt(buf, s) { const n = Buffer.from(s, "binary"); let c = 0, p = 0; while ((p = buf.indexOf(n, p)) !== -1) { c++; p += n.length; } return c; }
for (const f of saves) {
  const buf = fs.readFileSync(f);
  const counts = roles.map(r => `${r}=${cnt(buf, r)}/${cnt(buf, " " + r + NUL)}`);
  console.log(path.basename(f).slice(0, 45).padEnd(46), counts.join("  "));
}
