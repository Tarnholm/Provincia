// Investigate whether the +280 byte is actually the portrait UUID.
// Faster version: pre-build pstr-end-offset map once.
const fs = require("fs");
const buf = fs.readFileSync("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav");

const u16 = (o) => buf.readUInt16LE(o);
const u32 = (o) => buf.readUInt32LE(o);

// Build greek-general roster
const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const roster = [];
let p = 0;
while ((p = buf.indexOf(ROLE_STR, p)) !== -1) {
  const r = p + 2;
  p += ROLE_STR.length;
  const ownUuid = u32(r + 15);
  if (ownUuid === 0 || ownUuid === 0xffffffff) continue;
  const rl = u16(r + 35);
  if (rl < 1 || rl > 32) continue;
  let region = "";
  for (let i = 0; i < rl; i++) region += String.fromCharCode(u16(r + 37 + 2 * i));
  const regionEnd = r + 37 + 2 * rl;
  const age = u32(regionEnd + 12);
  roster.push({ role: r, ownUuid, region, age });
}
console.log(`greek generals: ${roster.length}`);

// Find ext records once
function findExt(ownUuid, beforeOff) {
  const b = Buffer.alloc(4); b.writeUInt32LE(ownUuid);
  const pos = buf.indexOf(b, 0x1500000);
  return pos >= 0 && pos < beforeOff ? pos : -1;
}

// Index pstr16 paths by END offset for fast back-scan
const pstrByEnd = new Map();
for (let i = 0x1000; i + 200 < buf.length; i++) {
  const len = u16(i);
  if (len < 8 || len > 200) continue;
  if (buf[i + 2 + len - 1] !== 0) continue;
  let ok = true;
  for (let k = 0; k < len - 1; k++) {
    const b = buf[i + 2 + k];
    if (b < 0x20 || b > 0x7e) { ok = false; break; }
  }
  if (!ok) continue;
  const s = buf.slice(i + 2, i + 2 + len - 1).toString("latin1");
  if (!/\/greek\/portraits\/cards\/[a-z]+\/generals\/\d+\.tga/.test(s)) continue;
  pstrByEnd.set(i + 2 + len, s);
}
console.log(`greek cards pstrs in save: ${pstrByEnd.size}`);

// For each char, for each offset, resolve & track uniqueness
const offsetsToTry = [264, 268, 272, 276, 280, 284, 288];
const offsetStats = {};
for (const off of offsetsToTry) offsetStats[off] = new Map(); // ownUuid → path

// Cache uuid → resolved path globally per offset
function resolveUuid(uuid) {
  const target = Buffer.alloc(4); target.writeUInt32LE(uuid);
  let pos = 0;
  while ((pos = buf.indexOf(target, pos)) !== -1) {
    // Scan back 100 bytes for pstr end
    for (let end = pos; end >= Math.max(0, pos - 100); end--) {
      if (pstrByEnd.has(end)) return pstrByEnd.get(end);
    }
    pos += 1;
    if (pos > 0x4000000) break; // safety
  }
  return null;
}

const uuidCache = new Map();
function cachedResolve(uuid) {
  if (uuidCache.has(uuid)) return uuidCache.get(uuid);
  const r = resolveUuid(uuid);
  uuidCache.set(uuid, r);
  return r;
}

console.log("\nPer-char analysis (first 20):");
for (const c of roster.slice(0, 20)) {
  const extOff = findExt(c.ownUuid, c.role);
  if (extOff < 0) { console.log(`  ${c.region} — no ext`); continue; }
  const row = [c.region.padEnd(20), `age=${c.age}`, `own=${c.ownUuid.toString(16).padStart(8, '0')}`];
  for (const off of offsetsToTry) {
    if (extOff + off + 4 > buf.length) { row.push(`+${off}=oob`); continue; }
    const uuid = u32(extOff + off);
    if (uuid === 0 || uuid === 0xffffffff) { row.push(`+${off}=-`); continue; }
    const path = cachedResolve(uuid);
    const num = path ? (path.match(/(\d+)\.tga/)?.[1] || '?') : 'X';
    row.push(`+${off}=${num}`);
    offsetStats[off].set(c.ownUuid, path);
  }
  console.log("  " + row.join("  "));
}

console.log("\nFor all chars:");
for (const c of roster) {
  const extOff = findExt(c.ownUuid, c.role);
  if (extOff < 0) continue;
  for (const off of offsetsToTry) {
    if (extOff + off + 4 > buf.length) continue;
    const uuid = u32(extOff + off);
    if (uuid === 0 || uuid === 0xffffffff) continue;
    const path = cachedResolve(uuid);
    if (path) offsetStats[off].set(c.ownUuid, path);
  }
}

console.log("\nUniqueness per offset:");
for (const off of offsetsToTry) {
  const m = offsetStats[off];
  const uniquePaths = new Set([...m.values()]);
  console.log(`  +${off}: ${m.size}/${roster.length} resolved, ${uniquePaths.size} unique paths`);
}
