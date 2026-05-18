// Find ALL pstr16 portrait paths in the save. Then look at the bytes
// immediately around each (4 bytes before/after) — likely a UUID or
// char-record back-reference.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

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
  i += len + 1; // skip past
}
console.log(`portrait pstr16 strings: ${portraits.length}`);

// Split by cards vs portraits, by culture, by age, by role
const stats = {};
for (const p of portraits) {
  const m = /^data\/ui\/([a-z_]+)\/portraits\/(cards|portraits)\/(old|young|dead)\/(generals|civilians|rogues|priests)\//.exec(p.s);
  if (!m) continue;
  const key = `${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
  stats[key] = (stats[key] || 0) + 1;
}
for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);

console.log("\nFirst 10 portrait paths + 4 bytes after each:");
for (const p of portraits.slice(0, 10)) {
  const after = p.at + 2 + p.len;
  const next4 = u32(after);
  const prev4 = p.at >= 4 ? u32(p.at - 4) : 0;
  console.log(`  at 0x${p.at.toString(16)}: prev_u32=${prev4.toString(16).padStart(8,'0')}  "${p.s}"  next_u32=${next4.toString(16).padStart(8,'0')}`);
}

console.log("\nLast 6 portrait paths:");
for (const p of portraits.slice(-6)) {
  const after = p.at + 2 + p.len;
  const next4 = u32(after);
  console.log(`  at 0x${p.at.toString(16)}: "${p.s}"  next_u32=${next4.toString(16).padStart(8,'0')}`);
}
