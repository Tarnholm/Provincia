// dig-warhunt-record-crosssave.js
// Antigonid appears as an NPC record in BOTH turn-0 saves (macedon: player is
// antigonid so it should NOT... wait it IS rec1 there too). Compare a faction's
// full record across the two saves. If the war structure is static config it
// should be byte-identical (modulo absolute self-pointers). We compare the
// record CONTENT with self-pointers normalized to relative.
//
// Better target: ptolemaic appears in BOTH saves with 84 diplo entries and a
// known war set (egypt,cyrene,kush,ptolemaic_rebels). seleucid appears only in
// macedon; antigonid only in seleucid (as the relevant player-absent record).
// We'll compare ptolemaic + antigonid records across both saves.
"use strict";
const fs = require("fs");
const {
  parseFactionTreasuries,
  identifyFactionRecordOwners,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";

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

function getRecord(save, name) {
  const buf = fs.readFileSync(SAVES_DIR + save);
  const recs = parseFactionTreasuries(buf);
  const owners = identifyFactionRecordOwners(buf, recs, order);
  const idx = owners.findIndex(o => o.factionName === name);
  if (idx < 0) return null;
  const r = recs[idx];
  const next = idx + 1 < recs.length ? recs[idx + 1].offset : buf.length;
  return { buf, r, idx, next, len: next - r.offset };
}

// Normalize: copy record bytes, zero out any u32 that equals an absolute file
// offset within [recStart, recStart+len] (self-pointers) by subtracting recStart.
function normalize(buf, start, len) {
  const out = Buffer.alloc(len);
  buf.copy(out, 0, start, start + len);
  for (let o = 0; o + 4 <= len; o += 1) {
    const v = out.readUInt32LE(o);
    if (v >= start && v < start + len) out.writeUInt32LE(v - start, o);
  }
  return out;
}

for (const name of ["antigonid", "ptolemaic"]) {
  const a = getRecord("save_macedon t0.sav", name);
  const b = getRecord("save_Seleucids t0.sav", name);
  console.log(`\n===== ${name} =====`);
  if (!a || !b) { console.log("  missing in one save"); continue; }
  console.log(`  macedon: idx=${a.idx} off=0x${a.r.offset.toString(16)} regions=${a.r.regionCount} len=${a.len}`);
  console.log(`  seleuc : idx=${b.idx} off=0x${b.r.offset.toString(16)} regions=${b.r.regionCount} len=${b.len}`);
  if (a.r.regionCount !== b.r.regionCount) { console.log("  regionCount differs -> region set differs, can't byte-compare easily"); }
  const cmpLen = Math.min(a.len, b.len);
  const na = normalize(a.buf, a.r.offset, cmpLen);
  const nb = normalize(b.buf, b.r.offset, cmpLen);
  let diffs = 0; const diffRanges = [];
  let runStart = -1;
  for (let o = 0; o < cmpLen; o++) {
    if (na[o] !== nb[o]) {
      diffs++;
      if (runStart < 0) runStart = o;
    } else {
      if (runStart >= 0) { diffRanges.push([runStart, o - 1]); runStart = -1; }
    }
  }
  if (runStart >= 0) diffRanges.push([runStart, cmpLen - 1]);
  console.log(`  cmpLen=${cmpLen} diffBytes=${diffs} diffRanges=${diffRanges.length}`);
  // Show first 20 diff ranges with relative offset + the diplo zone boundary
  const diploRel = 244 + 4 * a.r.regionCount;
  console.log(`  diplo zone starts at rel +${diploRel} (0x${diploRel.toString(16)})`);
  for (const [s, e] of diffRanges.slice(0, 30)) {
    console.log(`    diff rel +${s}..+${e} (${e - s + 1}B) ${s >= diploRel ? "[in/after diplo]" : "[before diplo]"}`);
  }
}
