// dig-warhunt-array-full.js
// Decode the full attitude-record array via the stable trailer
// `43 02 00 00 00 00 00 00 ff ff ff ff 0e 00 00 00` (579,0,-1,14).
// For each trailer, the record head sits at a fixed negative offset. From the
// dumps: head `<key> c8(200) <attitude> <flag> <counter> <w5>` and the trailer
// is ~0x44 bytes after the attitude. Let's lock the record by anchoring on the
// trailer and reading FIELDS at fixed negative offsets, calibrated from the two
// known flipped records:
//   record A: head=0x11921, trailer=0x11969  => trailer - attitudeField = 0x11969-0x11929 = 0x40
//   So attitude is at trailer-0x40, base at trailer-0x44, key at trailer-0x48.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const save = process.argv[2] || "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav";
const buf = fs.readFileSync(SAVES_DIR + save);

const TRAILER = Buffer.from([0x43,0x02,0x00,0x00, 0x00,0x00,0x00,0x00, 0xff,0xff,0xff,0xff, 0x0e,0x00,0x00,0x00]);
const lo = parseInt(process.argv[3] || "0x10000", 16);
const hi = parseInt(process.argv[4] || "0x1a000", 16);

const trailers = []; let p = lo;
while ((p = buf.indexOf(TRAILER, p)) !== -1 && p < hi) { trailers.push(p); p += 1; }
console.log(`${save}\ntrailers in 0x${lo.toString(16)}..0x${hi.toString(16)}: ${trailers.length}`);

// Fields relative to trailer:
//  key       = trailer - 0x48
//  base      = trailer - 0x44
//  attitude  = trailer - 0x40
//  flag      = trailer - 0x3c
//  counter   = trailer - 0x38
//  w5        = trailer - 0x34
let warCount = 0, hostileCount = 0;
const attHist = {};
const interesting = [];
for (const t of trailers) {
  const key = buf.readInt32LE(t - 0x48);
  const base = buf.readInt32LE(t - 0x44);
  const att = buf.readInt32LE(t - 0x40);
  const flag = buf.readInt32LE(t - 0x3c);
  const counter = buf.readInt32LE(t - 0x38);
  attHist[att] = (attHist[att] || 0) + 1;
  if (att === 600 || att === 850 || att >= 600) warCount++;
  if (att === 400) hostileCount++;
  if (att !== 200 && att !== 0) interesting.push({ t, key, base, att, flag, counter });
}
console.log("attitude histogram:", JSON.stringify(attHist));
console.log(`records with att>=600 (war-ish): ${warCount}, att=400 (hostile): ${hostileCount}`);
console.log("\nNon-{0,200} attitude records:");
for (const r of interesting.slice(0, 40)) {
  console.log(`  trailer@0x${r.t.toString(16)} key=${r.key} base=${r.base} att=${r.att} flag=${r.flag} counter=${r.counter}`);
}
