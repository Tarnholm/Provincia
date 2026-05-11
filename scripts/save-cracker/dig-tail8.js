// dig-tail8.js — Find where actual settlement records end (last UTF-16LE name in
// settlement zone), then see what's between that and 0x1f10c72.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

const settlementZoneStart = 0xf88637;
const settlementZoneEnd = 0x1f10c72;

// Find all UTF-16LE settlement-name patterns: [u16 len][LE utf16] where len > 4 and
// codepoints are printable ASCII.
const utf16names = [];
for (let p = settlementZoneStart; p + 4 < settlementZoneEnd; p += 1) {
  const len = buf.readUInt16LE(p);
  if (len < 4 || len > 40) continue;
  const byteLen = len * 2;
  if (p + 2 + byteLen > settlementZoneEnd) continue;
  // Check codepoints printable
  let ok = true;
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(p + 2 + i * 2);
    if (c < 0x20 || c > 0x7e) { ok = false; break; }
  }
  if (!ok) continue;
  const s = buf.slice(p + 2, p + 2 + byteLen).toString("utf16le");
  if (/^[A-Za-z][A-Za-z0-9_\-]+$/.test(s)) {
    utf16names.push({ off: p, name: s });
  }
}
console.log(`Total UTF-16LE settlement-name candidates: ${utf16names.length}`);
console.log(`First 5: ${utf16names.slice(0, 5).map(h => `${h.name}@0x${h.off.toString(16)}`).join(", ")}`);
console.log(`Last 5: ${utf16names.slice(-5).map(h => `${h.name}@0x${h.off.toString(16)}`).join(", ")}`);

// Show what's between the last settlement name and the tail boundary
const lastName = utf16names[utf16names.length - 1];
const afterLastName = lastName.off + 2 + lastName.name.length * 2;
console.log(`\nLast settlement name "${lastName.name}" ends at 0x${afterLastName.toString(16)}, tail at 0x${settlementZoneEnd.toString(16)}, gap = ${settlementZoneEnd - afterLastName} bytes`);

// Show the gap
console.log(`Hex dump from 0x${afterLastName.toString(16)} to 0x${settlementZoneEnd.toString(16)}:`);
const dumpEnd = Math.min(settlementZoneEnd + 32, afterLastName + 512);
for (let off = afterLastName; off < dumpEnd; off += 16) {
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  const marker = off >= settlementZoneEnd ? " *TAIL*" : "";
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}${marker}`);
}

// Now ALSO: are there UTF-16LE settlement names in the TAIL too?
console.log("\n=== UTF-16LE settlement names in tail (0x1f10c72..EOF) ===");
const utf16tail = [];
for (let p = 0x1f10c72; p + 4 < buf.length; p += 1) {
  const len = buf.readUInt16LE(p);
  if (len < 4 || len > 40) continue;
  const byteLen = len * 2;
  if (p + 2 + byteLen > buf.length) continue;
  let ok = true;
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(p + 2 + i * 2);
    if (c < 0x20 || c > 0x7e) { ok = false; break; }
  }
  if (!ok) continue;
  const s = buf.slice(p + 2, p + 2 + byteLen).toString("utf16le");
  if (/^[A-Za-z][A-Za-z0-9_\-]+$/.test(s)) {
    utf16tail.push({ off: p, name: s });
  }
}
console.log(`Total in tail: ${utf16tail.length}`);
console.log(`First 10: ${utf16tail.slice(0, 10).map(h => `${h.name}@0x${h.off.toString(16)}`).join(", ")}`);
console.log(`Last 10:  ${utf16tail.slice(-10).map(h => `${h.name}@0x${h.off.toString(16)}`).join(", ")}`);

// What about the 0x1f47abd "W_models" area — are those settlements? Probably battle models for them.
// Find unique strings in the W_ area
const wAreaStart = 0x1f47abd;
const wAreaEnd = 0x1f90000;  // approx
console.log("\n=== ASCII strings in W_models area (0x1f47abd..0x1f90000) ===");
const wstrings = [];
let s = -1;
for (let p = wAreaStart; p < wAreaEnd; p++) {
  const b = buf[p];
  if (b >= 0x20 && b <= 0x7e) {
    if (s === -1) s = p;
  } else {
    if (s !== -1 && p - s >= 4) {
      wstrings.push({ off: s, len: p - s, s: buf.slice(s, p).toString("ascii") });
    }
    s = -1;
  }
}
// Unique
const wUnique = new Map();
for (const h of wstrings) {
  if (!wUnique.has(h.s)) wUnique.set(h.s, { count: 0, first: h.off });
  wUnique.get(h.s).count++;
}
console.log(`Unique strings in W_area: ${wUnique.size}, total instances: ${wstrings.length}`);
const top = [...wUnique.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 30);
for (const [s, info] of top) {
  console.log(`  n=${info.count} first@0x${info.first.toString(16)}: ${JSON.stringify(s)}`);
}
