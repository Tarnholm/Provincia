// dig-met-08-carthagezone.js
// The t0..t7 campaign player is CARTHAGE (fid=4). Earlier scripts assumed the
// "player zone" is the one whose first entry tag==0 — but that found a count=1
// 'dummies' zone, not carthage. So re-examine: dump EVERY 0x39240005 zone owned
// by carthage (fid byte at marker-53 == 4) in full, and show its class
// histogram + entries. Then track carthage's zone count + class-5 count across
// the whole t0..t7 progression. If class-5 == "met", it should be small at T0
// and grow.
"use strict";
const fs = require("fs");
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
function loadOrder(p) { const t = fs.readFileSync(p, "utf8"); const o = []; let c = null; for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/); if (m) { c = m[1]; continue; } if (c) { const cm = l.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { o.push(c); c = null; } } } return o; }
const order = loadOrder(RIS_FACTIONS);
const TARGET = process.env.FID != null ? Number(process.env.FID) : order.indexOf("carthage");

function allZonesForFid(buf, fid) {
  const MARKER = 0x39240005;
  const out = [];
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 250) continue;
    if (buf[i - 53] !== fid) continue;
    const ch = {}; const entries = []; let ok = true;
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16;
      if (o + 16 > buf.length) { ok = false; break; }
      const uuid = buf.readUInt32LE(o), cls = buf.readUInt32LE(o + 4), att = buf.readUInt32LE(o + 8), tag = buf.readUInt32LE(o + 12);
      ch[cls] = (ch[cls] || 0) + 1;
      entries.push({ uuid, cls, att, tag });
    }
    if (!ok) continue;
    out.push({ off: i, count, ch, entries });
  }
  return out;
}

const saves = process.argv.slice(2);
console.log(`TARGET fid=${TARGET} (${order[TARGET]})\n`);
for (const s of saves) {
  const buf = fs.readFileSync(SAVES_DIR + s);
  const zones = allZonesForFid(buf, TARGET);
  console.log(`### ${s}: ${zones.length} zone(s) for fid ${TARGET}`);
  for (const z of zones) {
    console.log(`  @0x${z.off.toString(16)} count=${z.count} classHist=${JSON.stringify(z.ch)}`);
    // tags present
    const tagHist = {};
    for (const e of z.entries) tagHist["0x" + e.tag.toString(16)] = (tagHist["0x" + e.tag.toString(16)] || 0) + 1;
    console.log(`     tagHist=${JSON.stringify(tagHist)}`);
  }
}
