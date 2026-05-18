// Better hypothesis: pairs are followed by character data, and the next
// pair starts a new character. So scan ONLY the bytes between this pair's
// end and the NEXT pair's start. That chunk uniquely belongs to one
// character.

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

// Find pairs
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

// Sort pairs by offset
pairs.sort((a, b) => a.cards.at - b.cards.at);

// For each pair P, the chunk for P's character is [P.fulls.end, P_next.cards.at).
// Scan that chunk for char ownUuid.
let matched = 0;
const linked = [];
for (let i = 0; i < pairs.length; i++) {
  const P = pairs[i];
  const N = i + 1 < pairs.length ? pairs[i + 1] : null;
  const chunkStart = P.fulls.end;
  const chunkEnd = N ? N.cards.at : Math.min(buf.length, chunkStart + 4096);
  let hit = null;
  for (let off = chunkStart; off + 4 <= chunkEnd; off++) {
    const v = u32(off);
    if (charByUuid.has(v)) { hit = { off, uuid: v }; break; }
  }
  if (hit) {
    matched++;
    linked.push({ pair: P, char: charByUuid.get(hit.uuid), delta: hit.off - chunkStart, chunkSize: chunkEnd - chunkStart });
  }
}
console.log(`pairs linked: ${matched}/${pairs.length}`);

// Count unique chars
const uniqueChars = new Set(linked.map(l => l.char.ownUuid));
console.log(`unique chars: ${uniqueChars.size}/${charByUuid.size}`);

console.log("\nFirst 30 linked pairs:");
for (const l of linked.slice(0, 30)) {
  const num = l.pair.fulls.s.match(/(\d+)\.tga/)?.[1] || "??";
  console.log(
    `  ${l.char.region.padEnd(15)} age=${l.char.age.toString().padStart(2)} own=${l.char.ownUuid.toString(16).padStart(8, '0')}` +
    `  pair: ${l.pair.cards.s.split("/").slice(-3).join("/")} #${num}  delta=${l.delta}  chunk=${l.chunkSize}`
  );
}

// Check uniqueness per char
const byChar = new Map();
for (const l of linked) {
  if (!byChar.has(l.char.ownUuid)) byChar.set(l.char.ownUuid, []);
  byChar.get(l.char.ownUuid).push(l);
}
console.log(`\nchars with multiple linked pairs (suggests bad heuristic):`);
let dupes = 0;
for (const [uuid, arr] of byChar) {
  if (arr.length > 1) {
    dupes++;
    if (dupes <= 5) {
      console.log(`  own=${uuid.toString(16)}: ${arr.length} pairs - ${arr.map(l => l.pair.cards.s.match(/(\d+)\.tga/)?.[1]).join(", ")}`);
    }
  }
}
console.log(`total chars with multiple linkages: ${dupes}`);
