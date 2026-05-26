// dig-ancil-layout.js — research/diagnostic ONLY (no app code changes)
//
// The validate pass proved the id->name RULE is correct (declaration-order,
// 0-based) but the CURRENT slot-count math drops the FIRST ancillary of every
// list. This script dumps the raw bytes from trait-end to the portrait "data/"
// marker for several known-ground-truth characters so we can decode the exact
// per-character ancillary slot layout (where, how many, what padding).

const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/RIS/RIS/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const SAVE = "save_macedon t0.sav";

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitNames.push(tm[1]);
}
const ancNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_ancillaries.txt"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^Ancillary\s+(\S+)/); if (m) ancNames.push(m[1]);
}

const buf = fs.readFileSync(path.join(SAVES, SAVE));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);

// Bridge by tile to specific ground-truth characters we want to inspect.
// (charName -> {x,y, expected ancs})
const targets = [
  { name: "AntigonosB", x: 393, y: 391, exp: ["poet", "historian", "tutor"] },       // 3 ancs, leader
  { name: "DemetriosC", x: 409, y: 359, exp: ["judge"] },                            // 1 anc, heir
  { name: "Bokros",     x: 399, y: 389, exp: ["drillmaster", "architect"] },          // 2 ancs
  { name: "Eudamidas",  x: 408, y: 344, exp: ["heroic_saviour", "drillmaster"] },     // 2 ancs
  { name: "Sirras",     x: 376, y: 388, exp: ["decorated_hero"] },                    // 1 anc
  { name: "Hikkotimos", x: 394, y: 398, exp: ["priest_of_Herakles"] },               // 1 anc, 4-digit id
  { name: "Halkyoneus", x: 394, y: 374, exp: [] },                                    // 0 ancs (control)
];

const recByTile = new Map();
for (const r of recs) if (r.tileX != null) recByTile.set(`${r.tileX},${r.tileY}`, r);

function hex(b) { return b.toString(16).padStart(2, "0"); }

for (const t of targets) {
  const r = recByTile.get(`${t.x},${t.y}`);
  if (!r) { console.log(`\n### ${t.name} @${t.x},${t.y} — NO RECORD\n`); continue; }
  const layoutA = !!r.lastName; // LAYOUT_A when surnamed
  const tcOff = layoutA ? 302 : 298;
  const tsOff = layoutA ? 308 : 304;
  const tc = buf.readUInt16LE(r.offset + tcOff);
  const trEnd = r.offset + tsOff + tc * 8;
  // Find "data/" marker.
  let dataPos = -1;
  for (let i = 0; i < 260 && trEnd + i + 5 < buf.length; i++) {
    if (buf[trEnd + i] === 0x64 && buf[trEnd + i + 1] === 0x61 && buf[trEnd + i + 2] === 0x74 &&
        buf[trEnd + i + 3] === 0x61 && buf[trEnd + i + 4] === 0x2f) { dataPos = i; break; }
  }
  console.log(`\n### ${t.name} @${t.x},${t.y}  layout=${layoutA ? "A" : "B"}  tc=${tc}  expected=[${t.exp.join(", ")}]`);
  console.log(`    record@0x${r.offset.toString(16)}  trEnd@0x${trEnd.toString(16)}  dataPos(rel)=${dataPos}`);
  // Dump bytes from a few before trEnd to dataPos (which is the length prefix region of portrait).
  const dumpStart = trEnd - 8;
  const dumpEnd = trEnd + (dataPos >= 0 ? dataPos + 2 : 40);
  let row = [];
  for (let p = dumpStart; p < dumpEnd; p++) {
    const rel = p - trEnd;
    row.push((rel === 0 ? "|" : "") + hex(buf[p]));
    if (row.length === 16) { console.log("      " + row.join(" ")); row = []; }
  }
  if (row.length) console.log("      " + row.join(" "));

  // Interpret as u16 pairs starting at trEnd. The portrait length prefix is a
  // u16 right before "data/" (dataPos-2). Walk u16s from trEnd up to dataPos-2.
  if (dataPos >= 2) {
    const ancRegionLen = dataPos - 2; // bytes between trEnd and the portrait length prefix
    console.log(`    ancRegionLen=${ancRegionLen} bytes (=${ancRegionLen/2} u16 slots, =${(ancRegionLen/4)} u32 slots)`);
    // Decode every u16 in the region.
    const u16s = [];
    for (let i = 0; i + 2 <= ancRegionLen; i += 2) u16s.push(buf.readUInt16LE(trEnd + i));
    console.log(`    u16 stream: [${u16s.join(", ")}]`);
    // Hypothesis A (current parser): [u16 pad=0][u16 ancId] pairs, count = (ancRegionLen-2)/4
    // Hypothesis B (off-by-one fix): a u16 COUNT prefix, then ancId u16s? or pairs starting differently.
    // Try interpreting as N = ancRegionLen/4 pairs of (pad,id) with NO trailing sentinel:
    const nPairs = Math.floor(ancRegionLen / 4);
    const idsPaired = [];
    for (let i = 0; i < nPairs; i++) idsPaired.push({ pad: buf.readUInt16LE(trEnd + i*4), id: buf.readUInt16LE(trEnd + i*4 + 2) });
    console.log(`    as ${nPairs} (pad,id) pairs: ` + idsPaired.map(p => `(${p.pad},${p.id}=${ancNames[p.id]||"?"})`).join(" "));
    // Try interpreting region as raw u16 ids skipping zero pads:
    const idsLoose = u16s.map((v,i)=>({v,i})).filter(o=>o.v!==0 && o.v < ancNames.length && ancNames[o.v]);
    console.log(`    non-zero in-range u16s: ` + idsLoose.map(o=>`@${o.i}:${o.v}=${ancNames[o.v]}`).join(" "));
  } else if (dataPos === 0) {
    console.log(`    dataPos=0 -> current parser treats as 0 ancillaries (gap=-2 overlap)`);
  }
}
