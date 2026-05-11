// Now that we know x,y are u16le with y at x+14, scan the baseline for ALL
// (x,y) pairs that match descr_strat character coordinates. Each hit pinpoints
// a character record's position field. The cluster of hits in a tight offset
// range = the character records array.
import fs from "node:fs";
import path from "node:path";

const a = fs.readFileSync("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1turnstart.sav");
const stratText = fs.readFileSync("C:/RIS/_submods/RIS_Classic/data/world/maps/campaign/ris_classic/descr_strat.txt", "utf-8");

// Extract all character (name, x, y) from descr_strat
const characters = [];
let curFaction = null;
for (const line of stratText.split(/\r?\n/)) {
  const fm = line.match(/^faction\s+(\w+)/);
  if (fm) { curFaction = fm[1]; continue; }
  const cm = line.match(/^character[,\s]\s*([^,]+),.+?x\s+(-?\d+)\s*,\s*y\s+(-?\d+)/);
  if (cm) characters.push({ faction: curFaction, name: cm[1].trim(), descrX: parseInt(cm[2]), descrY: parseInt(cm[3]) });
}
console.log(`extracted ${characters.length} characters with coords from descr_strat`);

// We measured Rome Remastered coords are descr_strat * ~2.1. Try multiple scale factors.
// Actually: Azes descr_strat=(439,306) → in-game=(921,643). Scale = 921/439 = 2.0979..
// Try descrX*K + offset for K in a small set, but we know Azes is exact at scale 2.0979
// — that doesn't quite divide cleanly. So coordinate transform is more complex.
// Better: just search for known integer pairs. We don't know the exact transform without
// querying each character in-game, but the differential method already gave us Azes.

// Approach: search for the value pair (X, Y) where Y is u16le at offset+14 from X.
// Restrict to plausible map ranges (X in [50, 4000], Y in [50, 2000]).
const recordCandidates = [];
for (let i = 0; i + 16 <= a.length; i++) {
  const x = a.readUInt16LE(i);
  if (x < 50 || x > 4000) continue;
  const y = a.readUInt16LE(i + 14);
  if (y < 50 || y > 2000) continue;
  // Filter further: the bytes immediately around shouldn't be all zero
  // (would mean this is just zero-padded space, not a real record)
  let nonZero = 0;
  for (let k = -8; k <= 24; k++) if (a[i + k] !== 0) nonZero++;
  if (nonZero < 8) continue;
  recordCandidates.push({ offset: i, x, y });
}
console.log(`candidate (X@O, Y@O+14) pairs in plausible map range: ${recordCandidates.length}`);
console.log(`(noisy — the (x,y)-at-+14 pattern is common; we need additional filters)\n`);

// Cluster candidates by offset range (consecutive ones likely form an array)
const sorted = recordCandidates.sort((a, b) => a.offset - b.offset);
let cur = null;
const clusters = [];
for (const c of sorted) {
  if (!cur || c.offset - cur.last > 2048) {
    if (cur && cur.entries.length >= 2) clusters.push(cur);
    cur = { entries: [c], last: c.offset, start: c.offset };
  } else {
    cur.entries.push(c);
    cur.last = c.offset;
  }
}
if (cur && cur.entries.length >= 2) clusters.push(cur);

clusters.sort((a, b) => b.entries.length - a.entries.length);
console.log(`top 10 clusters (likely character record arrays):`);
for (const c of clusters.slice(0, 10)) {
  console.log(`  @0x${c.start.toString(16).padStart(8,"0")}-0x${c.last.toString(16).padStart(8,"0")}  ${c.entries.length} candidates  span ${(c.last-c.start).toLocaleString()}B`);
  // Show stride between consecutive entries
  for (let i = 1; i < Math.min(c.entries.length, 6); i++) {
    const stride = c.entries[i].offset - c.entries[i - 1].offset;
    console.log(`    @0x${c.entries[i].offset.toString(16)}  X=${c.entries[i].x},Y=${c.entries[i].y}  stride from prev=${stride}`);
  }
}

// Specifically check: is 0x2d53b in any cluster?
const azesOff = 0x2d53b;
for (const c of clusters.slice(0, 20)) {
  if (azesOff >= c.start - 1024 && azesOff <= c.last + 1024) {
    console.log(`\n** Azes cluster: starts @0x${c.start.toString(16)}, contains ${c.entries.length} candidates **`);
    // Look at the immediate neighbors of Azes
    const azIdx = c.entries.findIndex(e => e.offset === azesOff);
    if (azIdx >= 0) {
      const before = c.entries.slice(Math.max(0, azIdx - 3), azIdx);
      const after = c.entries.slice(azIdx + 1, azIdx + 5);
      console.log(`  Azes is at array index ${azIdx} of cluster:`);
      for (const e of before) console.log(`    BEFORE @0x${e.offset.toString(16)}  X=${e.x},Y=${e.y}`);
      console.log(`    AZES   @0x${azesOff.toString(16)}  X=921,Y=643`);
      for (const e of after) console.log(`    AFTER  @0x${e.offset.toString(16)}  X=${e.x},Y=${e.y}`);
    }
    break;
  }
}
