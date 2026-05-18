// Find all "extended character record" instances by searching for any
// of the 109 greek-general ownUuids preceded by enough context to be a
// record start, and following with the +16/+20 ffff pattern. Map each
// to its nearest portrait pair.

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
  const age = u32(regionEnd + 12);
  charByUuid.set(own, { role: r, ownUuid: own, region, age });
}
console.log(`greek generals: ${charByUuid.size}`);

// For each greek general ownUuid, find ALL its occurrences in the save,
// and check if any look like an extended-record start (followed by long
// run of 0xff bytes typical of the unused-relatives slots).
function findAllOccurrences(uuid) {
  const results = [];
  // Encode uuid LE as 4 bytes for search
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(uuid);
  let p = 0;
  while ((p = buf.indexOf(bytes, p)) !== -1) {
    results.push(p);
    p += 4;
  }
  return results;
}

// Find all portrait pstr16 positions
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
console.log(`portrait strings: ${portraits.length}`);

// For each char's FIRST occurrence (back-ref position), find nearest portrait pair before it
function nearestPortraitsBefore(off, maxDist) {
  const results = portraits.filter(p => p.at < off && p.at >= off - maxDist);
  // Group by pair: cards followed by portraits with same NNN
  return results;
}

// Walk all greek generals: get the FIRST back-ref position (excluding the
// role-anchored record itself), find nearest portrait pair BEFORE it.
let matched = 0;
const links = [];
for (const c of charByUuid.values()) {
  const all = findAllOccurrences(c.ownUuid);
  // The role-anchored record has ownUuid at role+15. Filter that out.
  const backRefs = all.filter(p => p !== c.role + 15);
  if (backRefs.length === 0) continue;
  const ref = backRefs[0]; // earliest
  // Find pstr16 portrait paths in [ref-3000, ref]
  const nearby = nearestPortraitsBefore(ref, 3000);
  // Pick the LAST one (closest to back-ref)
  const cards = nearby.filter(p => p.s.includes("/cards/"));
  const fulls = nearby.filter(p => p.s.includes("/portraits/") && !p.s.includes("/cards/"));
  if (cards.length === 0 || fulls.length === 0) continue;
  const card = cards[cards.length - 1];
  const full = fulls[fulls.length - 1];
  // Verify same NNN
  const cardN = card.s.match(/(\d+)\.tga/)?.[1];
  const fullN = full.s.match(/(\d+)\.tga/)?.[1];
  if (cardN !== fullN) {
    // Mismatch — maybe cards/old/X + portraits/dead/X (dead variant)
    // Both should still be the same N. Check.
  }
  matched++;
  links.push({ char: c, ref, cardDelta: card.at - ref, card: card.s, full: full.s });
}
console.log(`\nlinked: ${matched}/${charByUuid.size}`);

// Show first 30 links
for (const l of links.slice(0, 30)) {
  const num = l.card.match(/(\d+)\.tga/)?.[1] || "??";
  console.log(`  ${l.char.region.padEnd(20)} age=${l.char.age.toString().padStart(2)} own=${l.char.ownUuid.toString(16).padStart(8,'0')}  #${num.padStart(3)}  delta=${l.cardDelta}  paths: ${l.card.split("/").slice(-3).join("/")} | ${l.full.split("/").slice(-3).join("/")}`);
}

// Check if all chars get a unique portrait
const used = new Map();
for (const l of links) {
  const num = l.card.match(/(\d+)\.tga/)?.[1];
  if (!used.has(num)) used.set(num, 0);
  used.set(num, used.get(num) + 1);
}
console.log("\nportrait number frequency (top 5 most repeated):");
const sorted = [...used.entries()].sort((a, b) => b[1] - a[1]);
for (const [num, ct] of sorted.slice(0, 5)) console.log(`  #${num}: used by ${ct} chars`);
