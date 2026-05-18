// CRACK: per-character portrait pool linkage.
//
// Each character's "extended record" (354-byte block at 0x171301b + N*354
// in this save) has a u32 portrait UUID at +280. The portrait pool has
// entries of the form:
//   [...other data...][u32 portrait_uuid][pstr16 cards path][pstr16 portraits path]
// The character's +280 matches the portrait_uuid prefix. The pstr16 portrait
// path starts ~72-74 bytes BEFORE the portrait_uuid occurrence in the pool.
//
// Algorithm per character:
//   1. Find extended record (search for ownUuid as u32 before role string)
//   2. Read u32 at record+280 → portrait_uuid
//   3. Scan portrait section for the portrait_uuid u32
//   4. From each match, look back ~72-74 bytes for a pstr16 portrait path

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

// Build greek-general roster
const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const roster = [];
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
  roster.push({ role: r, ownUuid: own, region, age });
}
console.log(`generals: ${roster.length}`);

// Helper: find a u32 value in the save before a given upper bound
function findU32Before(value, beforeOff, startOff = 0x1500000) {
  const b = Buffer.alloc(4); b.writeUInt32LE(value);
  let p = startOff;
  while ((p = buf.indexOf(b, p)) !== -1) {
    if (p >= beforeOff) return -1;
    return p;
  }
  return -1;
}

// Helper: find all occurrences of a u32 value in save
function findAllU32(value) {
  const b = Buffer.alloc(4); b.writeUInt32LE(value);
  const out = []; let p = 0;
  while ((p = buf.indexOf(b, p)) !== -1) { out.push(p); p += 4; }
  return out;
}

// Helper: scan backward from offset for a pstr16 portrait path
function findPortraitBefore(off, maxBack = 100) {
  for (let i = off - 4; i >= Math.max(0, off - maxBack); i--) {
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
    return { at: i, s };
  }
  return null;
}

let matched = 0;
const failures = [];
console.log("\nextracting portraits for all chars:");
for (const c of roster) {
  // 1. Find extended record (back-ref of own_uuid before role string)
  const extOff = findU32Before(c.ownUuid, c.role);
  if (extOff < 0) {
    failures.push({ ...c, reason: "no_ext_record" });
    continue;
  }
  // 2. Read +280 = portrait_uuid
  const pUuid = u32(extOff + 280);
  if (pUuid === 0 || pUuid === 0xffffffff) {
    failures.push({ ...c, reason: "bad_portrait_uuid", pUuid });
    continue;
  }
  // 3. Search save for the portrait UUID. Among matches, find the one
  //    that has a pstr16 portrait path immediately before it.
  const occs = findAllU32(pUuid);
  let bestPortrait = null;
  for (const occ of occs) {
    const pp = findPortraitBefore(occ, 100);
    if (pp) { bestPortrait = pp; break; }
  }
  if (!bestPortrait) {
    failures.push({ ...c, reason: "no_portrait_near_uuid", pUuid, occCount: occs.length });
    continue;
  }
  matched++;
  if (matched <= 30) {
    const num = bestPortrait.s.match(/(\d+)\.tga/)?.[1] || "??";
    console.log(`  ${c.region.padEnd(22)} age=${c.age.toString().padStart(2)} own=${c.ownUuid.toString(16).padStart(8, '0')}  +280=${pUuid.toString(16).padStart(8, '0')}  #${num.padStart(3)}  ${bestPortrait.s.split('/').slice(-3).join('/')}`);
  }
}

console.log(`\nmatched: ${matched}/${roster.length}`);
console.log(`failures: ${failures.length}`);
for (const f of failures.slice(0, 10)) {
  console.log(`  ${f.region} age ${f.age} own=${f.ownUuid.toString(16)} reason=${f.reason}`);
}

// Check portrait uniqueness
const portraitCount = new Map();
// Re-extract (slightly redundant but to count uniqueness)
let unique = 0;
const used = new Map();
for (const c of roster) {
  const extOff = findU32Before(c.ownUuid, c.role);
  if (extOff < 0) continue;
  const pUuid = u32(extOff + 280);
  const occs = findAllU32(pUuid);
  for (const occ of occs) {
    const pp = findPortraitBefore(occ, 100);
    if (pp) {
      const num = pp.s.match(/(\d+)\.tga/)?.[1];
      const key = `${pp.s.match(/(young|old|dead)/)?.[1]}/${num}`;
      used.set(key, (used.get(key) || 0) + 1);
      break;
    }
  }
}
const dupes = [...used.entries()].filter(([k, v]) => v > 1);
console.log(`\nunique portraits assigned: ${used.size}, with ${dupes.length} portraits used more than once`);
for (const [k, v] of dupes.slice(0, 5)) console.log(`  ${k}: ${v} chars`);
