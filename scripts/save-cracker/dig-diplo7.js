// dig-diplo7.js — identify the 10 majors in rome10 by region list fingerprint.
//
// For each major faction record in rome10, dump (a) treasury, (b) first 8
// region IDs of the region list at +52, (c) any nearby cstring within ±2KB
// that might identify the faction.

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

function findMajors(buf, fortyFour) {
  const out = [];
  for (let i = 0x3000; i + 56 < buf.length; i += 4) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== fortyFour) continue;
    out.push(i);
  }
  return out;
}

function regionList(buf, off) {
  const N = buf.readUInt32LE(off + 48);
  const regions = [];
  for (let i = 0; i < N; i++) regions.push(buf.readUInt32LE(off + 52 + i*4));
  return { N, regions };
}

const majors = findMajors(buf, 6).sort((a, b) => a - b);
const minors = findMajors(buf, 8).sort((a, b) => a - b);
console.log(`Majors=${majors.length}, Minors=${minors.length}`);

// Get faction culture cstrings nearby (looking for things like "carthaginian", "egyptian")
function nearestCulture(buf, off, range = 4000) {
  const cultures = ['roman', 'carthaginian', 'egyptian', 'eastern', 'greek_cities', 'greek', 'barbarian', 'parthian', 'macedon', 'pontus', 'gauls', 'germans', 'britons', 'armenia', 'dacia', 'numidia', 'scythia', 'spain', 'thrace', 'slave'];
  const hits = [];
  // Search forward up to range
  for (const c of cultures) {
    const tag = Buffer.from(c, 'utf8');
    let p = off;
    while (true) {
      const idx = buf.indexOf(tag, p);
      if (idx < 0 || idx > off + range) break;
      const before = buf[idx - 1];
      const after = buf[idx + c.length];
      // Want it as cstring or length-prefixed
      if ((before === c.length || before === 0) && (after === 0 || after === 0x0a)) {
        hits.push({ c, off: idx });
      }
      p = idx + 1;
    }
  }
  return hits.slice(0, 5);
}

console.log("\nMajors:");
for (const o of majors) {
  const rl = regionList(buf, o);
  const culs = nearestCulture(buf, o, 3000);
  console.log(`  0x${o.toString(16)} treasury=${buf.readInt32LE(o)} N=${rl.N} regions[0..7]=${rl.regions.slice(0,8).join(',')}`);
  if (culs.length) console.log(`    nearby cultures: ${culs.map(h => h.c+'@+'+(h.off-o)).join(', ')}`);
}

console.log("\nFirst 10 Minors:");
for (const o of minors.slice(0, 10)) {
  const rl = regionList(buf, o);
  console.log(`  0x${o.toString(16)} treasury=${buf.readInt32LE(o)} N=${rl.N}`);
}
