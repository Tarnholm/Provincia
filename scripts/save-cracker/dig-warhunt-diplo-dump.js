// dig-warhunt-diplo-dump.js
// For the cross-validating records (seleucid record in macedon save; antigonid
// record in seleucid save) dump the full diplo zone + a hexdump of the bytes
// AFTER the diplo zone (the trailer that follows count×16 entries) up to the
// next record. War may live in a SEPARATE structure right after the agreements
// zone, still inside the faction record.
"use strict";
const fs = require("fs");
const {
  parseFactionTreasuries,
  identifyFactionRecordOwners,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";

function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8");
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(RIS_FACTIONS);

function hexdump(buf, start, len, label) {
  console.log(`  --- ${label} (0x${start.toString(16)}, ${len} bytes) ---`);
  for (let r = 0; r < len; r += 16) {
    const o = start + r;
    if (o >= buf.length) break;
    const slice = buf.slice(o, Math.min(o + 16, buf.length));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
    console.log(`  0x${o.toString(16).padStart(8, "0")}  ${hex.padEnd(48)}  ${asc}`);
  }
}

function dumpRecord(buf, recs, owners, targetName) {
  const idx = owners.findIndex(o => o.factionName === targetName);
  if (idx < 0) { console.log(`  (no record for ${targetName})`); return; }
  const r = recs[idx];
  const diploOff = r.offset + 244 + 4 * r.regionCount;
  const marker = buf.readUInt32LE(diploOff);
  console.log(`\n  RECORD ${idx} = ${targetName}  offset=0x${r.offset.toString(16)} regions=${r.regionCount} factionId=${r.factionId}`);
  console.log(`  diplo marker @0x${diploOff.toString(16)} = 0x${marker.toString(16)} (expect 0x39240005)`);
  if (marker !== 0x39240005) { console.log("  marker mismatch!"); return; }
  const count = buf.readUInt32LE(diploOff + 4);
  console.log(`  diplo entry count = ${count}`);
  for (let k = 0; k < count; k++) {
    const o = diploOff + 8 + k * 16;
    console.log(`    [${k}] uuid=${buf.readUInt32LE(o)} class=${buf.readUInt32LE(o+4)} attitude=${buf.readUInt32LE(o+8)} tag=0x${buf.readUInt32LE(o+12).toString(16)}`);
  }
  const afterZone = diploOff + 8 + count * 16;
  const nextRecOff = (idx + 1 < recs.length) ? recs[idx + 1].offset : buf.length;
  console.log(`  zone ends at 0x${afterZone.toString(16)}, next record at 0x${nextRecOff.toString(16)} (gap ${nextRecOff - afterZone} bytes)`);
  // Dump the trailer after the agreements zone (up to 512 bytes or next record)
  const dumpLen = Math.min(512, nextRecOff - afterZone);
  hexdump(buf, afterZone, dumpLen, `${targetName} trailer after diplo zone`);
}

const cases = [
  { save: "save_macedon t0.sav", record: "seleucid", note: "seleucid should be at war with bithynia(46),seleucid_rebels(235),seleucid_rebels2(236)" },
  { save: "save_Seleucids t0.sav", record: "antigonid", note: "antigonid should be at war with epirus(98),galatians(102)" },
];

for (const c of cases) {
  const path = SAVES_DIR + c.save;
  const buf = fs.readFileSync(path);
  console.log(`\n\n===================== ${c.save} =====================`);
  console.log(`NOTE: ${c.note}`);
  const recs = parseFactionTreasuries(buf);
  const owners = identifyFactionRecordOwners(buf, recs, order);
  dumpRecord(buf, recs, owners, c.record);
}
