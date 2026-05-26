// dig-met-04-zonegrowth.js
// Track EVERY faction's diplomacy-zone class-5 ("met-no-deal") count across a
// turn progression of the SAME campaign. If class-5 == met set, an exploring
// faction's class-5 count should grow turn over turn. We key zones by their
// owning factionId (byte at marker-53) and report count + class-5 count.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
function loadOrder(p){const t=fs.readFileSync(p,"utf8");const o=[];let c=null;for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(m){c=m[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o;}
const order = loadOrder(RIS_FACTIONS);

function zonesByFid(buf) {
  const MARKER = 0x39240005;
  const map = new Map(); // fid -> {count, c5, classHist}
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 250) continue;
    const fid = buf[i - 53];
    let c5 = 0, ok = true;
    const ch = {};
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16;
      if (o + 16 > buf.length) { ok = false; break; }
      const cls = buf.readUInt32LE(o + 4);
      ch[cls] = (ch[cls] || 0) + 1;
      if (cls === 5) c5++;
    }
    if (!ok) continue;
    // keep highest-count zone per fid
    const prev = map.get(fid);
    if (!prev || prev.count < count) map.set(fid, { count, c5, ch, off: i });
  }
  return map;
}

const saves = process.argv.slice(2);
const perFid = new Map(); // fid -> [{save, count, c5}]
for (const s of saves) {
  const buf = fs.readFileSync(SAVES_DIR + s);
  const zb = zonesByFid(buf);
  for (const [fid, z] of zb) {
    if (!perFid.has(fid)) perFid.set(fid, []);
    perFid.get(fid).push({ save: s, count: z.count, c5: z.c5 });
  }
}

// Report factions whose count or c5 CHANGED across the progression.
console.log(`progression: ${saves.join("  ->  ")}\n`);
const fids = [...perFid.keys()].sort((a, b) => a - b);
let changed = 0;
for (const fid of fids) {
  const seq = perFid.get(fid);
  if (seq.length < 2) continue;
  const counts = seq.map(x => x.count);
  const c5s = seq.map(x => x.c5);
  const countChanged = new Set(counts).size > 1;
  const c5Changed = new Set(c5s).size > 1;
  if (countChanged || c5Changed) {
    changed++;
    const nm = fid < order.length ? order[fid] : `#${fid}`;
    console.log(`fid=${String(fid).padStart(3)} ${nm.padEnd(20)} count: ${counts.join(" -> ")}   c5(met?): ${c5s.join(" -> ")}`);
  }
}
console.log(`\n${changed} factions changed count/c5; ${fids.length} total tracked.`);
