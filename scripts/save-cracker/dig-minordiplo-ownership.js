// dig-minordiplo-ownership.js — Session 175 (2026-05-22)
//
// GOAL: For EVERY 0x39240005 diplomacy marker in a save (not just the 23
// major class-100 records), determine the OWNING faction so the app can show
// live war/ally/ceasefire COUNTS for every faction (roman_senate, carthage,
// romans_julii, pergamon, all minors), not just the 23 majors.
//
// KNOWN: majors store faction_id at record.offset + 191 + 4N and the diplo
// marker at record.offset + 244 + 4N  =>  factionId byte = markerOffset - 53.
// TEST: does markerOffset-53 (or a nearby fixed offset) also give a valid
// descr_sm_factions index for the ~197 MINOR diplomacy zones?
//
// Usage: node dig-minordiplo-ownership.js [seleucids|macedon]

"use strict";

const fs = require("fs");

const WHICH = (process.argv[2] || "seleucids").toLowerCase();
const SAVES = {
  seleucids: "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav",
  macedon: "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav",
};
const SAVE = SAVES[WHICH] || SAVES.seleucids;
const SMFAC = "C:/RIS/RIS/data/descr_sm_factions.txt";

console.log("=== dig-minordiplo-ownership ===");
console.log("Save:", SAVE);
const buf = fs.readFileSync(SAVE);
console.log("Size:", buf.length, "bytes");

// ---- descr_sm_factions declaration order ----
function parseSmFactions(file) {
  const txt = fs.readFileSync(file, "utf8");
  const order = [];
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) {
      const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/);
      if (cm) { order.push(cur); cur = null; }
    }
  }
  return order;
}
const smFactions = parseSmFactions(SMFAC);
console.log("descr_sm_factions count:", smFactions.length);
console.log("first 12:", smFactions.slice(0, 12).map((f, i) => i + "=" + f).join(", "));
console.log("");

// ---- 1. Find the 23 MAJOR records via strict signature (ground truth) ----
function findMajorRecords(buf) {
  const out = [];
  for (let i = 0; i + 96 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    if (i + 244 + 4 * regions + 4 > buf.length) continue;
    const midBase = i + 92 + 4 * regions;
    out.push({
      offset: i,
      regionCount: regions,
      factionId: buf.readUInt8(midBase + 99),
      markerOffset: i + 244 + 4 * regions,
    });
  }
  return out;
}
const majors = findMajorRecords(buf);
console.log("Major (strict-signature) records:", majors.length);

// Sanity: verify marker is present and factionId = buf[markerOffset-53]
let majorOk = 0;
for (const m of majors) {
  const markOk = buf.readUInt32LE(m.markerOffset) === 0x39240005;
  const fidBack = buf[m.markerOffset - 53];
  if (markOk && fidBack === m.factionId) majorOk++;
}
console.log("Majors where marker present & buf[markerOffset-53]===factionId:", majorOk + "/" + majors.length);
const majorMarkerSet = new Set(majors.map(m => m.markerOffset));
console.log("");

// ---- 2. Find ALL diplo markers in the save ----
const MARKER = Buffer.from([0x05, 0x00, 0x24, 0x39]);
const markers = [];
let p = 0;
while ((p = buf.indexOf(MARKER, p)) !== -1) {
  // Must have a sane relation count right after
  const count = buf.readUInt32LE(p + 4);
  markers.push({ at: p, count, valid: count <= 200 });
  p += 4;
}
console.log("Total 0x39240005 markers:", markers.length);
console.log("  with valid count(<=200):", markers.filter(m => m.valid).length);
console.log("  that are MAJOR records:", markers.filter(m => majorMarkerSet.has(m.at)).length);
console.log("  that are MINOR (non-major):", markers.filter(m => !majorMarkerSet.has(m.at)).length);
console.log("");

// ---- 3. TEST candidate fixed offsets back from the marker for a faction id ----
// For each candidate "delta" we read buf[markerOffset - delta] as a u8 and
// check it against the known major factionIds. The best delta is the one that
// (a) reproduces ALL 23 major factionIds AND (b) yields in-range distinct
// values for the minor zones.
console.log("=== Testing fixed u8 offsets back from marker (validated against majors) ===");
const N = smFactions.length;
const deltaResults = [];
for (let delta = 1; delta <= 80; delta++) {
  let majorMatch = 0;
  for (const m of majors) {
    if (m.markerOffset - delta < 0) continue;
    if (buf[m.markerOffset - delta] === m.factionId) majorMatch++;
  }
  // Only deltas that perfectly reproduce majors are interesting.
  if (majorMatch === majors.length) {
    // Now check minor zones in-range coverage
    let minorInRange = 0, minorTotal = 0;
    for (const mk of markers) {
      if (majorMarkerSet.has(mk.at)) continue;
      if (!mk.valid) continue;
      minorTotal++;
      if (mk.at - delta < 0) continue;
      const v = buf[mk.at - delta];
      if (v < N) minorInRange++;
    }
    deltaResults.push({ delta, majorMatch, minorInRange, minorTotal });
  }
}
if (deltaResults.length === 0) {
  console.log("NO fixed u8 delta reproduces all 23 majors. (factionId is not at a fixed offset back from marker.)");
} else {
  for (const d of deltaResults) {
    console.log(`  delta=${d.delta} (markerOffset-${d.delta}): majors ${d.majorMatch}/${majors.length}, minors in-range ${d.minorInRange}/${d.minorTotal}`);
  }
}
console.log("");

// ---- 4. If delta=53 works, dump per-marker faction resolution ----
const DELTA = 53;
console.log(`=== Per-marker faction resolution using markerOffset-${DELTA} (u8 -> descr_sm_factions) ===`);
const resolved = [];
for (const mk of markers) {
  const isMajor = majorMarkerSet.has(mk.at);
  const fid = mk.at - DELTA >= 0 ? buf[mk.at - DELTA] : 255;
  const name = fid < N ? smFactions[fid] : "OUT_OF_RANGE(" + fid + ")";
  resolved.push({ at: mk.at, count: mk.count, valid: mk.valid, isMajor, fid, name });
}

// Aggregate: how many resolve to a valid faction
const validResolved = resolved.filter(r => r.valid && r.fid < N);
console.log("Markers resolving to in-range factionId:", validResolved.length + "/" + markers.length);

// Distinct factions covered
const facCount = new Map();
for (const r of validResolved) facCount.set(r.fid, (facCount.get(r.fid) || 0) + 1);
console.log("Distinct factions covered:", facCount.size);

// Duplicates (more than one zone per faction)
const dupes = [...facCount.entries()].filter(([, n]) => n > 1);
console.log("Factions with >1 zone (duplicates):", dupes.length);
for (const [fid, n] of dupes.sort((a, b) => b[1] - a[1])) {
  console.log("   " + (smFactions[fid] || fid).padEnd(20) + " x" + n);
}
console.log("");

// ---- 5. Specifically check the factions of interest ----
const INTEREST = ["roman_senate", "carthage", "romans_julii", "romans_brutii", "romans_scipii", "pergamon", "egypt", "seleucid", "macedon", "parthia", "pontus", "armenia", "dacia", "germans", "gauls", "britons", "spain", "thrace", "scythia", "numidia", "slave"];
console.log("=== Factions of interest — resolution status ===");
for (const fname of INTEREST) {
  const fid = smFactions.indexOf(fname);
  if (fid < 0) { console.log("   " + fname.padEnd(18) + "NOT in descr_sm_factions"); continue; }
  const zones = validResolved.filter(r => r.fid === fid);
  const major = majors.find(m => m.factionId === fid);
  console.log("   " + fname.padEnd(18) + "fid=" + String(fid).padStart(3) +
    " zones=" + zones.length +
    (major ? " [MAJOR]" : " [minor-only]") +
    (zones.length ? " counts=" + zones.map(z => z.count).join(",") : " (NO ZONE FOUND)"));
}
console.log("");

// ---- 6. List every resolved minor zone (sorted by faction) ----
console.log("=== All resolved zones (faction-id -> name, sorted) ===");
const sortedRes = [...validResolved].sort((a, b) => a.fid - b.fid || a.at - b.at);
for (const r of sortedRes) {
  console.log("   0x" + r.at.toString(16).padStart(8, "0") +
    " fid=" + String(r.fid).padStart(3) +
    " " + (smFactions[r.fid] || "?").padEnd(20) +
    " rels=" + String(r.count).padStart(3) +
    (r.isMajor ? " [MAJOR]" : ""));
}
console.log("");

// ---- 7. Out-of-range / invalid markers — dump context for diagnosis ----
const bad = resolved.filter(r => !r.valid || r.fid >= N);
console.log("=== Markers that DON'T resolve (count>200 or fid out of range):", bad.length, "===");
for (const r of bad.slice(0, 25)) {
  const ctxStart = Math.max(0, r.at - 64);
  const slice = buf.slice(ctxStart, r.at + 16);
  console.log("   0x" + r.at.toString(16) + " count=" + r.count + " fid@-53=" + r.fid +
    (r.fid < N ? "(" + smFactions[r.fid] + ")" : "(OOR)"));
  console.log("        -64..+16 hex: " + slice.toString("hex").match(/.{1,8}/g).join(" "));
}
