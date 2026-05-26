// dig-mapfeat-7fff.js
// The 354-byte coord record marks a map position with x@+8, y@+12, 0x7fff@+16.
// Map features (forts/watchtowers) likely reuse the same (x, y, 0x7fff) position
// primitive. Count and locate every place where a u32 0x7fff (or u16 0x7fff)
// is preceded by two plausible tile coords. Compare t0 vs t7: feature placements
// should APPEAR in the late save.
//
// We treat a candidate as: at offset O, value == 0x7fff (u32 LE), and the two
// u32 before it (O-8 = x, O-4 = y) are small positive ints (0 < v < 1000),
// the typical RTW strat-tile range.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function scan(buf, { coordMax = 1024 } = {}) {
  const hits = [];
  for (let o = 8; o + 4 <= buf.length; o++) {
    if (buf.readUInt32LE(o) !== 0x7fff) continue;
    const x = buf.readUInt32LE(o - 8);
    const y = buf.readUInt32LE(o - 4);
    if (x > 0 && x < coordMax && y > 0 && y < coordMax) {
      hits.push({ markerOff: o, x, y });
    }
  }
  return hits;
}

const files = process.argv.slice(2);
if (files.length === 0) files.push("save_t0.sav", "save_t7.sav");

const perFile = {};
for (const f of files) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, f));
  const hits = scan(buf);
  perFile[f] = hits;
  console.log(`${f.padEnd(46)} ${buf.length.toLocaleString().padStart(12)} bytes  ->  ${hits.length} (x,y,0x7fff) triples`);
}

// Distribution of marker offsets by 1MB bucket for the first vs last file
const first = files[0], last = files[files.length - 1];
console.log(`\nOffset distribution (1MB buckets) — count of triples per region`);
console.log(`bucketMB    ${first.slice(0, 14).padEnd(16)} ${last.slice(0, 14)}`);
const bucket = (hits) => {
  const m = {};
  for (const h of hits) { const b = Math.floor(h.markerOff / (1024 * 1024)); m[b] = (m[b] || 0) + 1; }
  return m;
};
const bf = bucket(perFile[first]), bl = bucket(perFile[last]);
const allB = new Set([...Object.keys(bf), ...Object.keys(bl)].map(Number));
for (const b of [...allB].sort((a, c) => a - c)) {
  console.log(`  ${String(b).padStart(3)} MB    ${String(bf[b] ?? 0).padStart(14)} ${String(bl[b] ?? 0).padStart(14)}`);
}
