// dig-portrait-string.js — V2 parser finds portrait paths embedded as
// pstr16 strings in the save. Confirm same approach works for our T0
// Macedon save: scan near each "greek general" role for "data/.../tga.dds"
// pstr16 strings.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const positions = [];
let p = 0;
while ((p = buf.indexOf(ROLE_STR, p)) !== -1) {
  positions.push(p + 2);
  p += ROLE_STR.length;
}
console.log(`role strings: ${positions.length}`);

// For each character record, scan 2KB after the role string for pstr16
// ASCII strings that look like portrait paths.
function scanForPstr16Strings(start, end) {
  const found = [];
  for (let i = start; i < end - 2 && i < buf.length - 2; i++) {
    const len = u16(i);
    if (len < 8 || len > 200) continue;
    if (i + 2 + len > buf.length) continue;
    let s = "";
    let ok = true;
    for (let k = 0; k < len - 1; k++) {
      const b = buf[i + 2 + k];
      if (b < 0x20 || b > 0x7e) { ok = false; break; }
      s += String.fromCharCode(b);
    }
    if (!ok) continue;
    if (buf[i + 2 + len - 1] !== 0) continue;
    if (!s.includes("/") || !s.includes(".tga")) continue;
    found.push({ at: i, s });
  }
  return found;
}

let withPortraits = 0;
const samples = [];
for (const r of positions.slice(0, 20)) {
  const hits = scanForPstr16Strings(r, r + 4000);
  if (hits.length > 0) withPortraits++;
  samples.push({ r, hits });
}
console.log(`characters with portrait-like strings within 4KB: ${withPortraits}/20`);
for (const s of samples.slice(0, 6)) {
  console.log(`\nat 0x${s.r.toString(16)}:`);
  for (const h of s.hits.slice(0, 4)) {
    console.log(`  +${(h.at - s.r).toString().padStart(5)} : "${h.s}"`);
  }
}
