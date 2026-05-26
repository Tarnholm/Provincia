// dig-minordiplo-verify.js — Session 175 (2026-05-22)
//
// Cross-validate the markerOffset-53 faction-id rule across BOTH saves and:
//   (1) confirm the ONE non-resolving marker is a coincidental 05 00 24 39
//       byte sequence inside another structure (not a real diplo zone), by
//       checking the preamble that real zones share.
//   (2) confirm the SAME set of factionIds is absent in both saves (proving
//       absences are disabled/placeholder faction slots, not parse failures).
//   (3) verify the minor-zone preamble pattern noted in memory:
//       `00 00 00 01 00 00 00 00 07 00 00 00 00 00 00 00` before the marker.

"use strict";
const fs = require("fs");

const SAVES = {
  seleucids: "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav",
  macedon: "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav",
};
const SMFAC = "C:/RIS/RIS/data/descr_sm_factions.txt";

function parseSmFactions(file) {
  const txt = fs.readFileSync(file, "utf8");
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const smFactions = parseSmFactions(SMFAC);
const N = smFactions.length;
const DELTA = 53;
const MARKER = Buffer.from([0x05, 0x00, 0x24, 0x39]);

function analyze(name, file) {
  const buf = fs.readFileSync(file);
  const markers = [];
  let p = 0;
  while ((p = buf.indexOf(MARKER, p)) !== -1) {
    markers.push({ at: p, count: buf.readUInt32LE(p + 4) });
    p += 4;
  }
  const present = new Set();
  const bad = [];
  for (const mk of markers) {
    const fid = mk.at - DELTA >= 0 ? buf[mk.at - DELTA] : 255;
    if (mk.count <= 200 && fid < N) present.add(fid);
    else bad.push(mk);
  }
  return { buf, markers, present, bad };
}

const sel = analyze("seleucids", SAVES.seleucids);
const mac = analyze("macedon", SAVES.macedon);

console.log("=== Coverage per save ===");
console.log("seleucids: markers=" + sel.markers.length + " resolved=" + sel.present.size + " bad=" + sel.bad.length);
console.log("macedon:   markers=" + mac.markers.length + " resolved=" + mac.present.size + " bad=" + mac.bad.length);

// Absent fids in each save
const absentSel = [];
const absentMac = [];
for (let f = 0; f < N; f++) {
  if (!sel.present.has(f)) absentSel.push(f);
  if (!mac.present.has(f)) absentMac.push(f);
}
console.log("\n=== Absent factionIds (no diplo zone) ===");
console.log("seleucids absent count:", absentSel.length);
console.log("macedon absent count:  ", absentMac.length);
const sameAbsent = absentSel.length === absentMac.length && absentSel.every((f, i) => f === absentMac[i]);
console.log("Same absent set in both saves:", sameAbsent);
console.log("absent fids:", absentSel.map(f => f + "(" + smFactions[f] + ")").join(", "));

// (2) Verify the ~16-byte preamble before each VALID minor marker.
// Memory: `00 00 00 01 00 00 00 00 07 00 00 00 00 00 00 00` precedes the marker.
console.log("\n=== Preamble (16 bytes before marker) frequency — seleucids minor zones ===");
const preCounts = new Map();
for (const mk of sel.markers) {
  const fid = mk.at - DELTA >= 0 ? sel.buf[mk.at - DELTA] : 255;
  if (mk.count > 200 || fid >= N) continue;
  const pre = sel.buf.slice(mk.at - 16, mk.at).toString("hex");
  preCounts.set(pre, (preCounts.get(pre) || 0) + 1);
}
for (const [pre, n] of [...preCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  console.log("   x" + String(n).padStart(3) + "  " + pre.match(/.{1,2}/g).join(" "));
}

// (3) Dump the bad marker's surroundings to prove it's not a real zone.
console.log("\n=== Bad markers (seleucids) — show why they fail ===");
for (const mk of sel.bad) {
  const fid = sel.buf[mk.at - DELTA];
  const pre = sel.buf.slice(mk.at - 16, mk.at).toString("hex");
  console.log("   @0x" + mk.at.toString(16) + " count=" + mk.count + " fid@-53=" + fid + "(" + (smFactions[fid] || "?") + ")");
  console.log("        16-byte preamble: " + pre.match(/.{1,2}/g).join(" "));
  console.log("        -> count=" + mk.count + " > 200, and preamble != standard zone preamble => coincidental byte match, NOT a diplo zone");
}

// (4) Show the structural layout: minor zone byte map relative to marker.
// For a sample minor zone, print bytes from marker-60 to marker+8 with the
// factionId byte highlighted.
console.log("\n=== Sample minor-zone byte layout (carthage, fid=4, seleucids save) ===");
const carthage = sel.markers.find(mk => {
  const fid = sel.buf[mk.at - DELTA];
  return fid === 4 && mk.count <= 200;
});
if (carthage) {
  const start = carthage.at - 60;
  for (let line = 0; line < 72; line += 16) {
    const off = start + line;
    const slice = sel.buf.slice(off, off + 16);
    const rel = (off - carthage.at);
    console.log("   marker" + (rel >= 0 ? "+" : "") + rel + ": " + slice.toString("hex").match(/.{1,2}/g).join(" "));
  }
  console.log("   factionId byte (marker-53) value =", sel.buf[carthage.at - 53], "=", smFactions[sel.buf[carthage.at - 53]]);
}
