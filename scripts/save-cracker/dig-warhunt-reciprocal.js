// dig-warhunt-reciprocal.js
// Antigonid is at war with epirus, galatians. Antigonid's att=4 entries have
// uuids 765,768,927,784,881,855,794. Do epirus's / galatians' zones contain
// att=4 entries? And do their uuids relate? Also: how many att=4 entries does
// each warring faction have vs its ground-truth war count?
"use strict";
const fs = require("fs");
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const REL = "C:/dev/Provincia/public/faction_relationships_large.json";

function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8"); const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(RIS_FACTIONS);
const rels = JSON.parse(fs.readFileSync(REL, "utf8"));
function warsOf(f) { return (rels[f] || []).filter(r => r.kind === "war").map(r => r.to); }

const MARKER = 0x39240005;
function collectZonesByFid(buf) {
  const byFid = new Map();
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 200) continue;
    const fid = buf[i - 53];
    if (fid >= order.length) continue;
    let ok = true; const entries = [];
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16;
      if (o + 16 > buf.length) { ok = false; break; }
      entries.push({ uuid: buf.readUInt32LE(o), cls: buf.readUInt32LE(o + 4), att: buf.readUInt32LE(o + 8), tag: buf.readUInt32LE(o + 12) });
    }
    if (!ok) continue;
    if (!byFid.has(fid) || byFid.get(fid).count < count) byFid.set(fid, { fid, off: i, count, entries });
  }
  return byFid;
}

const save = process.argv[2] || "save_Seleucids t0.sav";
const buf = fs.readFileSync(SAVES_DIR + save);
const byFid = collectZonesByFid(buf);

// For every faction WITH a war in ground-truth that also has a zone, compare
// att=4 count to war count.
console.log(`${save}: ${byFid.size} zones\n`);
console.log("faction          fid  zone? att4  cls? || GTwars");
let exactMatches = 0, total = 0;
for (let fid = 0; fid < order.length; fid++) {
  const name = order[fid];
  const w = warsOf(name);
  const z = byFid.get(fid);
  if (!z && w.length === 0) continue;
  if (w.length === 0 && z) continue; // skip non-war factions to reduce noise
  total++;
  const att4 = z ? z.entries.filter(e => e.att === 4).length : 0;
  const att3 = z ? z.entries.filter(e => e.att === 3).length : 0;
  const match = att4 === w.length ? "  <== EXACT" : "";
  if (att4 === w.length) exactMatches++;
  console.log(`${name.padEnd(16)} ${String(fid).padStart(3)}  ${z ? "Y" : "n"}     ${String(att4).padStart(3)}  att3=${att3} || ${w.length} [${w.join(",")}]${match}`);
}
console.log(`\natt4==warCount exact matches: ${exactMatches}/${total}`);
