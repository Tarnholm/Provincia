// Hypothesis: each character occupies a block in the portrait pool that
// looks like:
//   [cards pstr16][portraits pstr16][~600 bytes of char data including own_uuid]
// So the back-ref appears AFTER the pair, in the same 700-byte block.
// Walk through pairs in order; for each pair, look in the FOLLOWING 700
// bytes for any of our 109 char ownUuids. If found, that's the pair's
// owning character.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const charByUuid = new Map();
let p = 0;
while ((p = buf.indexOf(ROLE_STR, p)) !== -1) {
  const r = p + 2;
  p += ROLE_STR.length;
  const rl = u16(r + 35);
  if (rl < 1 || rl > 32) continue;
  const own = u32(r + 15);
  if (own === 0 || own === 0xffffffff) continue;
  let region = "";
  for (let i = 0; i < rl; i++) region += String.fromCharCode(u16(r + 37 + 2 * i));
  const regionEnd = r + 37 + 2 * rl;
  if (u32(regionEnd) !== 0xffffffff) continue;
  const age = u32(regionEnd + 12);
  if (age < 14 || age > 100) continue;
  charByUuid.set(own, { role: r, ownUuid: own, region, age });
}
console.log(`generals: ${charByUuid.size}`);

// Find all pairs (cards followed by portraits)
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
  if (!s.startsWith("data/ui/") || !s.includes("/portraits/")) continue;
  if (s.includes("/cards/")) lastCards = { at: i, s, end: i + 2 + len };
  else if (lastCards) {
    pairs.push({ cards: lastCards, fulls: { at: i, s, end: i + 2 + len } });
    lastCards = null;
  }
  i += 1 + len;
}
console.log(`pairs: ${pairs.length}`);

// For each pair, scan from pair.fulls.end through the next ~3KB for one of
// our char ownUuids. If found, that's the linked character.
const SCAN_BYTES = 3500;
let matched = 0;
const distances = [];
const linked = []; // { pair, char, atDelta }
for (const pair of pairs) {
  const scanFrom = pair.fulls.end;
  const scanTo = Math.min(buf.length - 4, scanFrom + SCAN_BYTES);
  let firstHit = null;
  for (let off = scanFrom; off < scanTo; off++) {
    const v = u32(off);
    if (charByUuid.has(v)) { firstHit = { off, uuid: v }; break; }
  }
  if (firstHit) {
    matched++;
    distances.push(firstHit.off - scanFrom);
    linked.push({ pair, char: charByUuid.get(firstHit.uuid), delta: firstHit.off - scanFrom });
  }
}
console.log(`pairs linked to a general by following-block scan: ${matched}/${pairs.length}`);
if (distances.length) {
  distances.sort((a, b) => a - b);
  console.log(`  delta distribution: min=${distances[0]} median=${distances[Math.floor(distances.length / 2)]} max=${distances[distances.length - 1]}`);
}

// Sample 20 links
console.log("\nFirst 20 linked pairs:");
for (const l of linked.slice(0, 20)) {
  const num = l.pair.fulls.s.match(/(\d+)\.tga/)?.[1] || "??";
  console.log(`  ${l.char.region.padEnd(15)} age=${l.char.age.toString().padStart(2)} own=${l.char.ownUuid.toString(16).padStart(8, '0')}  pair: ${l.pair.cards.s.split("/").slice(-3).join("/")} (#${num})  delta=${l.delta}`);
}

// Count unique chars that got linked
const uniqueChars = new Set(linked.map(l => l.char.ownUuid));
console.log(`\nunique chars linked: ${uniqueChars.size}/${charByUuid.size}`);
