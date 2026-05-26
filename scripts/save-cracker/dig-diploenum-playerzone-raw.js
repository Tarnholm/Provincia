// dig-diploenum-playerzone-raw.js
//
// Dump the raw 16-byte entries of the att==5 (player) zone, and also dump the
// 64 bytes BEFORE the marker, to understand the player-zone structure and why
// macedon's antigonid player zone is degenerate (mostly class5) while
// seleucid's was rich. Maybe the player's real diplomacy lives in a DIFFERENT
// structure (e.g. the player faction record elsewhere), and the att5 zone is
// just a discovered-factions list.
//
// Usage: node dig-diploenum-playerzone-raw.js [savePath]

"use strict";
const fs = require("fs");
const path = require("path");
const SAVE_DEFAULT =
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const DESCR_SM_FACTIONS = "C:/RIS/RIS/data/descr_sm_factions.txt";
const savePath = process.argv[2] || SAVE_DEFAULT;
const MARKER = 0x39240005;

function parseFactionOrder(text) {
  const order = []; let cur = null, depth = 0, inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim(); if (s.startsWith(";")) continue;
    const prev = depth; for (const ch of s) { if (ch === "{") depth++; if (ch === "}") depth--; }
    if (inBlock && depth === 0) { cur = null; inBlock = false; }
    if (prev === 0 && depth === 0) { const m = s.match(/^"([^"]+)"\s*:/); if (m && m[1].toLowerCase() !== "factions") cur = m[1].toLowerCase(); }
    if (cur && prev === 0 && depth === 1) { inBlock = true; if (!order.includes(cur)) order.push(cur); }
  }
  return order;
}

const buf = fs.readFileSync(savePath);
const fo = parseFactionOrder(fs.readFileSync(DESCR_SM_FACTIONS, "utf8"));

// Find the att5 (player) zone.
let player = null;
for (let i = 53; i + 8 < buf.length; i++) {
  if (buf.readUInt32LE(i) !== MARKER) continue;
  const count = buf.readUInt32LE(i + 4); if (count === 0 || count > 200) continue;
  const fid = buf[i - 53]; if (fid >= fo.length) continue; const name = fo[fid]; if (!name) continue;
  let att5 = false;
  for (let k = 0; k < count; k++) { const o = i + 8 + k * 16; if (o + 16 > buf.length) break; if (buf.readUInt32LE(o + 8) === 5) { att5 = true; break; } }
  if (att5) { player = { off: i, fid, name, count }; break; }
}
if (!player) { console.log("no att5 zone"); process.exit(0); }
console.log(`SAVE: ${path.basename(savePath)}`);
console.log(`PLAYER zone: ${player.name} (fid=${player.fid}) @0x${player.off.toString(16)} count=${player.count}`);

// Dump 80 bytes before marker.
const pre = player.off - 80;
let hex = "";
for (let i = pre; i < player.off; i++) hex += buf[i].toString(16).padStart(2, "0") + " ";
console.log(`\n[80 bytes before marker @0x${pre.toString(16)}]:\n${hex}`);
console.log(`marker byte[-53] (faction id) = ${buf[player.off - 53]} (${fo[buf[player.off - 53]]})`);

// Dump first 40 entries.
console.log(`\nEntries (uuid, class, att, tag):`);
for (let k = 0; k < Math.min(player.count, 120); k++) {
  const o = player.off + 8 + k * 16;
  const uuid = buf.readUInt32LE(o), cls = buf.readUInt32LE(o + 4), att = buf.readUInt32LE(o + 8), tag = buf.readUInt32LE(o + 12);
  if (cls !== 5) console.log(`  [${k}] uuid=${uuid} class=${cls} att=${att} tag=0x${tag.toString(16)}  <-- non-neutral`);
}
// count non-neutral
let nonNeutral = 0;
for (let k = 0; k < player.count; k++) { const o = player.off + 8 + k * 16; if (buf.readUInt32LE(o + 4) !== 5) nonNeutral++; }
console.log(`\nnon-class5 entries: ${nonNeutral} / ${player.count}`);

// Also: search for OTHER markers near the player faction record that might
// hold real diplomacy. The player record sits BEFORE the 23 majors. Look for
// the player's faction record region: scan a window for any structure with
// the player's allies. We instead just report whether a SECOND zone exists
// for this fid anywhere using a different marker variant nearby.
console.log(`\n(Player faction's REAL diplomacy may live in the separate player faction record, not this zone.)`);
