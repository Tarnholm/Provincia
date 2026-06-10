// dig-upkeep9.js — session 9
//
// Goal: identify the 12-record stride-354 array. Coordinates (X,Y) suggest these are
// map-positioned entities. The +0/+4 self-ptr followed by `6` size matches the major
// faction record's pattern, suggesting these are sub-faction records inside the player.
//
// Hypotheses to test:
//   - Per-army records (Romans Julii has 12 armies in rome5)
//   - Per-region records (some sub-region overlay)
//   - Per-character/general records
//   - Per-construction-target records (the 12 buildings being constructed?)
//
// Look at what precedes the run for a count byte / header.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findMajorRecords(buf) {
  const hits = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regionCount = buf.readUInt32LE(i + 48);
    if (regionCount > 200) continue;
    const treasury = buf.readInt32LE(i);
    hits.push({ pos: i, treasury, regionCount });
  }
  return hits;
}

function findTripleAnchors(buf, start, end) {
  const out = [];
  for (let i = start; i + 20 < end; i++) {
    if (buf.readUInt32LE(i) !== i) continue;
    if (buf.readUInt32LE(i + 4) !== i + 4) continue;
    if (buf.readUInt32LE(i + 16) !== i + 16) continue;
    out.push(i);
  }
  return out;
}

function getStrideRun(anchors, stride, minLen) {
  let i = 0;
  while (i < anchors.length) {
    let j = i;
    while (j + 1 < anchors.length && anchors[j + 1] - anchors[j] === stride) j++;
    if (j - i + 1 >= minLen) return { start: anchors[i], end: anchors[j], count: j - i + 1 };
    i = j + 1;
  }
  return null;
}

const r5 = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));
const r7 = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));
const recs5 = findMajorRecords(r5);
const recs7 = findMajorRecords(r7);
const p5 = recs5[0], p7 = recs7[0];
const an5 = findTripleAnchors(r5, p5.pos, recs5[1].pos);
const an7 = findTripleAnchors(r7, p7.pos, recs7[1].pos);
const run5 = getStrideRun(an5, 354, 4);
const run7 = getStrideRun(an7, 354, 4);

// Print 64 bytes BEFORE the start of run5 - look for count byte
console.log("=== rome5: 96 bytes BEFORE the 12-record array start at 0x" + run5.start.toString(16) + " ===");
for (let i = 0; i < 96; i += 16) {
  const slice = r5.slice(run5.start - 96 + i, run5.start - 96 + i + 16);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(slice).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
  console.log(`  ${(run5.start - 96 + i).toString(16)}: ${hex} | ${ascii}`);
}

// 8 bytes immediately preceding the run
console.log("\nrome5 u32 at run.start - 4:", r5.readUInt32LE(run5.start - 4));
console.log("rome5 u32 at run.start - 8:", r5.readUInt32LE(run5.start - 8));
console.log("rome5 u32 at run.start - 12:", r5.readUInt32LE(run5.start - 12));
console.log("rome5 u32 at run.start - 16:", r5.readUInt32LE(run5.start - 16));

console.log("\nrome7 u32 at run.start - 4:", r7.readUInt32LE(run7.start - 4));
console.log("rome7 u32 at run.start - 8:", r7.readUInt32LE(run7.start - 8));
console.log("rome7 u32 at run.start - 12:", r7.readUInt32LE(run7.start - 12));
console.log("rome7 u32 at run.start - 16:", r7.readUInt32LE(run7.start - 16));

// Now look at what comes AFTER the run in rome5
console.log("\n=== rome5: 96 bytes AFTER the 12-record array end at 0x" + (run5.end + 354).toString(16) + " ===");
const endOfRun5 = run5.end + 354;
for (let i = 0; i < 96; i += 16) {
  const slice = r5.slice(endOfRun5 + i, endOfRun5 + i + 16);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(slice).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
  console.log(`  ${(endOfRun5 + i).toString(16)}: ${hex} | ${ascii}`);
}

// Now: Do the Roman Julii's player armies / generals match these 12 coordinates?
// Roman Julii's known characters at rome5 turn 5: cross-check with character parser
const cp = require("../../src/characterParser.js");
const MOD = "C:/RIS/RIS/data";
const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitNames.push(tm[1]);
}

const allChars = cp.findCharacterRecords(r5, nameLookup, traitNames, null);
// Filter to roman_julii faction position records (via X,Y proximity to record coords list)
const recCoords5 = [];
for (let i = 0; i < 12; i++) {
  const pos = run5.start + i * 354;
  const x = r5.readUInt32LE(pos + 20);
  const y = r5.readUInt32LE(pos + 24);
  recCoords5.push({ x, y });
}
console.log("\n=== Coords of the 12 records in rome5 ===");
for (let i = 0; i < recCoords5.length; i++) {
  console.log(`  rec ${i}: (${recCoords5[i].x}, ${recCoords5[i].y})`);
}

console.log(`\n=== All characters in rome5 with X,Y matching one of the 12 records ===`);
// Note: characterParser gives x,y for field-army characters
let matched = 0;
const allMatches = [];
for (const c of allChars) {
  for (const rc of recCoords5) {
    if (c.x === rc.x && c.y === rc.y) {
      matched++;
      allMatches.push({ name: c.firstName + " " + (c.lastName || ""), uuid: c.primaryUuid, x: c.x, y: c.y });
    }
  }
}
console.log(`Match count: ${matched}`);
for (const m of allMatches.slice(0, 30)) {
  console.log(`  ${m.name} @ (${m.x}, ${m.y}) uuid=${m.uuid}`);
}

// Look at SETTLEMENT positions: Roman cities have known coords from session 3.
// Rome at (285, 404), Arretium (278, 427), Pisae (263, 431), Volaterrae...
// None of the 12 records match those.
console.log("\n=== Checking if rec coords match known settlement positions ===");
// Roman cities from descr_strat would be at specific positions
// Quick check: do (270, 302) match anything Roman? Look at descr_strat resources at those coords
// Just print for now and we can correlate later.
