// dig-upkeep3.js — session 9
//
// Findings so far:
//   - Player record has dual-buffered finance aggregates:
//     +1000/+1016/+1032 = this-turn (computed at start)
//     +1152/+1168/+1184 = last-turn (snapshot)
//   - For Romans Julii (player idx 0): rome1..6 have +1000=459, +1016=1537, +1032=1792
//     then rome7..9 (turn 6 start): +1000=974, +1016=967, +1032=229 (new values)
//                                      +1152=459, +1168=1537, +1184=1792 (old values copied)
//
// But: these offsets are ONLY clean for the player record. AI records (Carthage idx 1)
// have entirely different layouts. The post-region-list trailing data is variable.
//
// HYPOTHESIS: the trailing data structure differs by faction-class (player vs AI vs cultural).
// Each faction has its own internal record sub-sections with varying sizes.
//
// New strategy:
//   1. Dump raw bytes around +1000 in player record (rome5) - look for marker/length prefix
//   2. Compare player records ACROSS DIFFERENT CAMPAIGNS (rome=Romans, savestartsparta=Sparta).
//      Both should have the same "player faction layout" if there is one.
//   3. Try to read +1000..+1032 as a single struct: maybe `[count][cost][?][income1][income2][income3]`

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

function load(name) {
  const fn = path.join(SAVES, `save_${name}.sav`);
  const buf = fs.readFileSync(fn);
  return { name, buf, recs: findMajorRecords(buf) };
}

function hexDump(buf, off, len) {
  const out = [];
  for (let i = 0; i < len; i += 16) {
    const slice = buf.slice(off + i, Math.min(off + i + 16, buf.length));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
    out.push(`  +${(i + (off - rec_anchor)).toString().padStart(5)}: ${hex.padEnd(48)} | ${ascii}`);
  }
  return out.join('\n');
}

const r5 = load("rome5.");
const r7 = load("rome7");

const playerR5 = r5.recs[0];
const playerR7 = r7.recs[0];

// Region list ends at +52 + 35*4 = +192. Treasury snapshot at +(92+4*35) = +232.
// So after region list and treasury snapshot, the trailing data starts ~+236.

console.log("=== Player rec (Romans Julii) hex dump from +900 to +1200, rome5 ===");
let rec_anchor = playerR5.pos;
console.log(hexDump(r5.buf, playerR5.pos + 900, 320));

console.log("\n=== Player rec (Romans Julii) hex dump from +900 to +1200, rome7 ===");
rec_anchor = playerR7.pos;
console.log(hexDump(r7.buf, playerR7.pos + 900, 320));

console.log("\n=== Player rec (Romans Julii) hex dump from +200 to +880, rome5 ===");
rec_anchor = playerR5.pos;
console.log(hexDump(r5.buf, playerR5.pos + 200, 680));

console.log("\n=== Player rec (Romans Julii) hex dump from +200 to +880, rome7 ===");
rec_anchor = playerR7.pos;
console.log(hexDump(r7.buf, playerR7.pos + 200, 680));
