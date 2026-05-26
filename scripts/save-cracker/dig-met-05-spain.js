// dig-met-05-spain.js
// Vanilla Spain campaign (small saves) with the VANILLA faction order. Test:
//  (1) player zone class-5 ("met") count + growth across T1..T4
//  (2) matrix counter/att fields growth (using vanilla order N)
// Spain meets Carthage during this run (declares war on T4), so if "met" is
// tracked it should change between a pre-contact and post-contact save.
"use strict";
const fs = require("fs");
const VANILLA = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Total War ROME REMASTERED\\Contents\\Resources\\Data\\data\\descr_sm_factions.txt";
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
function loadOrder(p){const t=fs.readFileSync(p,"utf8");const o=[];let c=null;for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(m){c=m[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o;}
const order = loadOrder(VANILLA);
const N = order.length;
console.log(`vanilla faction order: N=${N}  [0..5]=${order.slice(0,6).join(",")}`);

function playerZone(buf) {
  const MARKER = 0x39240005;
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 250) continue;
    if (i + 24 > buf.length) continue;
    if (buf.readUInt32LE(i + 20) !== 0) continue; // first entry tag==0
    const ch = {}; const entries = [];
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16;
      const cls = buf.readUInt32LE(o + 4);
      ch[cls] = (ch[cls] || 0) + 1;
      entries.push({ uuid: buf.readUInt32LE(o), cls, att: buf.readUInt32LE(o + 8) });
    }
    return { off: i, count, fid: buf[i - 53], ch, entries };
  }
  return null;
}

// vanilla matrix locator (stride ~115)
function locate(buf) {
  const limit = Math.min(buf.length - 64, 0x400000);
  for (let p = 0x4000; p < limit; p++) {
    if (buf.readUInt32LE(p) !== 0) continue;
    const key = buf.readUInt32LE(p + 4);
    if (key < 1 || key > 64) continue;
    if (buf.readUInt32LE(p + 8) !== 200) continue;
    if (buf.readUInt32LE(p + 16) !== 2) continue;
    for (let s = 80; s <= 200; s++) {
      if (p + s + 12 >= buf.length) break;
      if (buf.readUInt32LE(p + s) === 0 && buf.readUInt32LE(p + s + 4) === key && buf.readUInt32LE(p + s + 8) === 200) {
        // verify run
        let good = 0;
        for (let k = 0; k < N + 2; k++) { const o = p + k * s; if (o + 12 >= buf.length) break; if (buf.readUInt32LE(o) === 0 && buf.readUInt32LE(o + 4) === key && buf.readUInt32LE(o + 8) === 200) good++; else break; }
        if (good >= N) return { cellStart: p, stride: s, key };
      }
    }
  }
  return null;
}

const saves = process.argv.slice(2);
for (const s of saves) {
  const buf = fs.readFileSync(SAVES_DIR + s);
  const z = playerZone(buf);
  console.log(`\n### ${s} size=${buf.length}`);
  if (z) {
    const nm = z.fid < N ? order[z.fid] : `#${z.fid}`;
    console.log(`player zone fid=${z.fid}(${nm}) count=${z.count} classHist=${JSON.stringify(z.ch)}`);
    console.log(`  entries: ` + z.entries.map(e => `${e.uuid}/c${e.cls}`).join("  "));
  } else console.log("no player zone");
  const loc = locate(buf);
  if (loc) {
    // calibrate C by symmetry
    const att = (idx) => { const o = loc.cellStart + idx * loc.stride + 12; return o + 4 <= buf.length ? buf.readUInt32LE(o) : null; };
    let bestC = 0, best = -1;
    for (let C = -3; C <= 3; C++) { let sym = 0, tot = 0; for (let A = 1; A < N; A++) for (let B = A + 1; B < N; B++) { const v1 = att(A * N + B + C), v2 = att(B * N + A + C); if (v1 == null || v2 == null) continue; tot++; if (v1 === v2) sym++; } const sc = tot ? sym / tot : 0; if (sc > best) { best = sc; bestC = C; } }
    const C = bestC;
    const cell = (idx) => { const o = loc.cellStart + idx * loc.stride; return o + 24 <= buf.length ? { att: buf.readUInt32LE(o + 12), flag: buf.readUInt32LE(o + 16), ctr: buf.readUInt32LE(o + 20) } : null; };
    const aH = {}, fH = {}, cH = {};
    for (let A = 0; A < N; A++) for (let B = 0; B < N; B++) { if (A === B) continue; const c = cell(A * N + B + C); if (!c) continue; aH[c.att] = (aH[c.att] || 0) + 1; fH[c.flag] = (fH[c.flag] || 0) + 1; cH[c.ctr] = (cH[c.ctr] || 0) + 1; }
    const top = (h) => Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join("  ");
    console.log(`  matrix stride=${loc.stride} C=${C} sym=${best.toFixed(3)}  att[${top(aH)}] flag[${top(fH)}] ctr[${top(cH)}]`);
  } else console.log("  matrix not found");
}
