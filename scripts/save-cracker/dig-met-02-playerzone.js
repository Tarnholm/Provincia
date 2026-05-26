// dig-met-02-playerzone.js
// Decode the PLAYER diplomacy zone (the single tag0 / firstCls=5 zone) in full
// across a turn progression. If the class-5 entries are "met factions", the
// list should be small at T0 and grow with turns. We can't read partner ids
// from the entry's own fields (uuid is a local handle), so we ALSO try to map
// each entry's relationUuid -> a partner by cross-referencing the matrix /
// other zones. First: just dump the raw entries + class histogram + count, and
// see if the count grows turn-over-turn.
"use strict";
const fs = require("fs");
const X = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";

function loadFactionOrder(p) {
  const txt = fs.readFileSync(p, "utf8"); const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(RIS_FACTIONS);

function findPlayerZone(buf) {
  const MARKER = 0x39240005;
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 250) continue;
    // first entry tag (at +12 of entry = i+8+12 = i+20) == 0 marks player zone
    if (i + 8 + 16 > buf.length) continue;
    const firstTag = buf.readUInt32LE(i + 20);
    if (firstTag === 0) {
      return { off: i, count, fid: buf[i - 53] };
    }
  }
  return null;
}

const saves = process.argv.slice(2);
for (const s of saves) {
  const buf = fs.readFileSync(SAVES_DIR + s);
  const z = findPlayerZone(buf);
  if (!z) { console.log(`\n### ${s}: NO player zone`); continue; }
  const nm = z.fid < order.length ? order[z.fid] : `#${z.fid}`;
  console.log(`\n### ${s}`);
  console.log(`player zone @0x${z.off.toString(16)} fid=${z.fid}(${nm}) count=${z.count}`);
  const clsHist = {};
  const entries = [];
  for (let k = 0; k < z.count; k++) {
    const o = z.off + 8 + k * 16;
    const uuid = buf.readUInt32LE(o);
    const cls = buf.readUInt32LE(o + 4);
    const att = buf.readUInt32LE(o + 8);
    const tag = buf.readUInt32LE(o + 12);
    clsHist[cls] = (clsHist[cls] || 0) + 1;
    entries.push({ uuid, cls, att, tag });
  }
  console.log(`class histogram:`, clsHist);
  console.log(`entries:`);
  for (let k = 0; k < entries.length; k++) {
    const e = entries[k];
    console.log(`  [${String(k).padStart(2)}] uuid=${String(e.uuid).padStart(6)} cls=${e.cls} att=${e.att} tag=0x${e.tag.toString(16)}`);
  }
}
