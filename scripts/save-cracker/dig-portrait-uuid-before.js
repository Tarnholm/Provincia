// Check the 64 bytes BEFORE each portrait pstr16 for a u32 that matches
// a character's own_uuid. If found, that's the back-pointer from the
// portrait string to its character.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const ownUuids = new Set();
const charByUuid = new Map();
let p = 0;
while ((p = buf.indexOf(ROLE_STR, p)) !== -1) {
  const r = p + 2;
  p += ROLE_STR.length;
  if (u16(r + 35) < 1 || u16(r + 35) > 32) continue;
  const own = u32(r + 15);
  if (own === 0 || own === 0xffffffff) continue;
  ownUuids.add(own);
  charByUuid.set(own, { role: r, ownUuid: own });
}
console.log(`unique ownUuids: ${ownUuids.size}`);

// Find pairs only — match cards followed by portraits with same NNN
const pairs = [];
let lastCards = null;
for (let i = 0; i < buf.length - 200; i++) {
  const len = u16(i);
  if (len < 8 || len > 200) continue;
  let s = "", ok = true;
  for (let k = 0; k < len - 1; k++) {
    const b = buf[i + 2 + k];
    if (b < 0x20 || b > 0x7e) { ok = false; break; }
    s += String.fromCharCode(b);
  }
  if (!ok || buf[i + 2 + len - 1] !== 0) continue;
  if (!s.startsWith("data/ui/") || !s.includes("/portraits/")) { continue; }
  if (s.includes("/cards/")) {
    lastCards = { at: i, s };
  } else if (s.includes("/portraits/") && lastCards) {
    pairs.push({ cards: lastCards, fulls: { at: i, s } });
    lastCards = null;
  }
  i += 1 + len;
}
console.log(`pairs: ${pairs.length}`);

// For each pair, scan -128..-1 bytes before "cards" pstr16 for own_uuid
const offsetVotes = {};
let found = 0;
for (const pair of pairs) {
  for (let off = -128; off <= -1; off++) {
    if (pair.cards.at + off < 0 || pair.cards.at + off + 4 > buf.length) continue;
    const v = u32(pair.cards.at + off);
    if (ownUuids.has(v)) {
      offsetVotes[off] = (offsetVotes[off] || 0) + 1;
      found++;
      break;
    }
  }
}
console.log(`pairs whose preceding bytes contain a char ownUuid: ${found}/${pairs.length}`);
console.log("offset distribution (vote = pair count):");
for (const [off, ct] of Object.entries(offsetVotes).sort((a,b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  off=${off.padStart(5)}: ${ct}`);
}
