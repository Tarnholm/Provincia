// Widen the search: for each back-ref, find the NEAREST portrait pstr16
// strings BEFORE it (most likely candidate for THIS character).

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

// Find all portrait pstr16 strings
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
  if (!ok || buf[i + 2 + len - 1] !== 0) continue;
  if (!s.startsWith("data/ui/") || !s.includes("/portraits/")) continue;
  portraits.push({ at: i, s });
  i += 1 + len;
}
console.log(`portrait pstr16: ${portraits.length}`);

// Get all back-refs for greek generals
const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const chars = [];
let p = 0;
while ((p = buf.indexOf(ROLE_STR, p)) !== -1) {
  const r = p + 2;
  p += ROLE_STR.length;
  const own = u16(r + 35) >= 1 && u16(r + 35) <= 32 ? u32(r + 15) : 0;
  if (own !== 0) chars.push({ role: r, ownUuid: own });
}

// For each char, find the back-ref (first occurrence of own_uuid before role)
function findUuidBefore(uuid, before) {
  for (let off = 0x1500000; off + 4 <= before; off++) {
    if (u32(off) === uuid) return off;
  }
  return -1;
}

// For each char's back-ref, find the closest portrait pair BEFORE it
// (within 2KB window) and the deltas
const stats = { hits: 0, total: 0 };
const distances = [];
for (const c of chars.slice(0, 30)) {
  stats.total++;
  const ref = findUuidBefore(c.ownUuid, c.role);
  if (ref < 0) continue;

  // Closest portrait BEFORE ref within 2KB
  const cards = portraits.filter(pr => pr.at < ref && pr.at >= ref - 2048 && pr.s.includes("/cards/"));
  const fullsAfter = portraits.filter(pr => pr.at < ref && pr.at >= ref - 2048 && pr.s.includes("/portraits/") && !pr.s.includes("/cards/"));

  // Closest card and full path (last each = nearest to ref)
  const lastCard = cards.length ? cards[cards.length - 1] : null;
  const lastFull = fullsAfter.length ? fullsAfter[fullsAfter.length - 1] : null;

  if (lastCard || lastFull) stats.hits++;
  console.log(
    `char own=${c.ownUuid.toString(16).padStart(8, '0')}  ref=0x${ref.toString(16)}` +
    `  card@${lastCard ? (lastCard.at - ref) : "??"}=${lastCard ? lastCard.s.split("/").slice(-3).join("/") : "(none)"}` +
    `  full@${lastFull ? (lastFull.at - ref) : "??"}=${lastFull ? lastFull.s.split("/").slice(-3).join("/") : "(none)"}`
  );
  if (lastCard) distances.push(lastCard.at - ref);
}
console.log(`\nhits: ${stats.hits}/${stats.total}`);
if (distances.length) {
  distances.sort((a,b) => a - b);
  console.log(`card-to-backref distance: min=${distances[0]} median=${distances[Math.floor(distances.length / 2)]} max=${distances[distances.length - 1]}`);
}
