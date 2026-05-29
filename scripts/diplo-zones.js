"use strict";
const fs = require("fs");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Julii turn7.sav";
const SM   = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const buf  = fs.readFileSync(SAVE);

const smOrder = [];
for (const line of fs.readFileSync(SM, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\t"([a-z_0-9]+)":/);
  if (m) smOrder.push(m[1]);
}

const zones = xtras.parseAllFactionDiplomacy(buf, smOrder);
console.log(`zones found: ${Object.keys(zones).length}`);
console.log("\nJulii zone:", JSON.stringify(zones.romans_julii, null, 2));
console.log("\nExpected from screenshot: 1 ally, 10 trade, 7 protectorate, 1 enemy (war is elsewhere)");

// Manually re-parse Julii's zone to inspect every entry, since the existing
// function buckets them with the OLD (wrong) class enum. Find Julii's marker
// directly — fid=0 should be Julii in smOrder.
console.log("\n=== Julii zone raw entries ===");
const MARKER = 0x39240005;
for (let i = 53; i + 8 < buf.length; i++) {
  if (buf.readUInt32LE(i) !== MARKER) continue;
  if (buf[i - 53] !== 0) continue; // fid 0 = romans_julii
  const count = buf.readUInt32LE(i + 4);
  if (count === 0 || count > 200) continue;
  // Validate first entry's tag — player zone has tag=0
  const firstTag = buf.readUInt32LE(i + 8 + 12);
  console.log(`\nfound Julii zone @ ${i}: count=${count} firstTag=0x${firstTag.toString(16)}`);
  const byClass = {};
  for (let k = 0; k < count; k++) {
    const o = i + 8 + k * 16;
    if (o + 16 > buf.length) break;
    const e = {
      uuid: buf.readUInt32LE(o),
      class_: buf.readUInt32LE(o + 4),
      attitude: buf.readUInt32LE(o + 8),
      tag: buf.readUInt32LE(o + 12),
    };
    byClass[e.class_] = (byClass[e.class_] || 0) + 1;
  }
  console.log(`  class breakdown:`, byClass);
  console.log(`  Per the comment: class 1=ALLIANCE, 2=TRADE, 4=LOCKED/protectorate, 5=met-no-deal`);
  // don't break — print every zone with fid=0
}

console.log("\n=== ALL zones (any fid) — count distribution ===");
{
  const all = [];
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 200) continue;
    const fid = buf[i - 53];
    all.push({ off: i, fid, count, name: smOrder[fid] || `?${fid}` });
  }
  // Top 20 zones by count
  all.sort((a, b) => b.count - a.count);
  console.log("top 20 zones by count:");
  for (const z of all.slice(0, 20)) console.log(`  off=${z.off} fid=${z.fid} (${z.name}) count=${z.count}`);

  // All Julii (fid=0) zones
  const julii = all.filter(z => z.fid === 0).sort((a, b) => b.count - a.count);
  console.log(`\nAll fid=0 zones: ${julii.length}`);
  for (const z of julii.slice(0, 10)) console.log(`  off=${z.off} count=${z.count}`);
}
