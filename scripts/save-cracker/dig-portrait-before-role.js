// V2 parser finds portrait paths AFTER the trait block within each character
// record. The role string (anchored search) might be a DIFFERENT field within
// the same record, located after the portraits. So scan BACKWARDS from each
// role string for the nearest portrait pair — that's likely the same char's.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);

// Find every portrait-path pstr16 in the save and index them by offset.
const portraits = [];
for (let i = 0; i < buf.length - 200; i++) {
  const len = u16(i);
  if (len < 8 || len > 200) continue;
  let s = "", ok = true;
  for (let k = 0; k < len - 1; k++) {
    const b = buf[i + 2 + k];
    if (b < 0x20 || b > 0x7e) { ok = false; break; }
    s += String.fromCharCode(b);
  }
  if (!ok) continue;
  if (buf[i + 2 + len - 1] !== 0) continue;
  if (!s.startsWith("data/ui/") || !s.includes("/portraits/")) continue;
  portraits.push({ at: i, len, s });
  i += 1 + len; // advance
}
console.log(`portrait strings in save: ${portraits.length}`);

// Find all "greek general" role strings.
const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const roleAt = [];
let p = 0;
while ((p = buf.indexOf(ROLE_STR, p)) !== -1) {
  roleAt.push(p + 2);
  p += ROLE_STR.length;
}

// For each role string, find the closest portrait pair BEFORE it (in same record)
// and report the distance.
console.log(`\nrole strings: ${roleAt.length}`);
console.log("\nFirst 15 chars: distance from role string to preceding portrait pair");
let lastP = -1;
for (let i = 0; i < 15 && i < roleAt.length; i++) {
  const r = roleAt[i];
  // Find the largest portrait offset < r
  let nearest = null;
  for (const pr of portraits) {
    if (pr.at >= r) break;
    nearest = pr;
  }
  if (!nearest) continue;
  console.log(`  role at 0x${r.toString(16).padStart(7,'0')}  nearest portrait at 0x${nearest.at.toString(16)} (delta=${r - nearest.at})  "${nearest.s}"`);
}

// Try the reverse: for each role string, look in the 8KB BEFORE it for ALL portrait paths
console.log("\nFor first 5 chars: all portrait paths within 8KB before the role:");
for (let i = 0; i < 5 && i < roleAt.length; i++) {
  const r = roleAt[i];
  const hits = portraits.filter(pr => pr.at >= r - 8192 && pr.at < r);
  console.log(`  role at 0x${r.toString(16)}: ${hits.length} portrait(s) in [r-8192, r)`);
  for (const h of hits) console.log(`    -${(r - h.at).toString().padStart(5)}: "${h.s}"`);
}
