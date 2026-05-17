// Targeted hypothesis: war declaration sets a diplomatic attitude byte/u16/u32
// to RTW's AT_WAR enum value (600 = 0x258). Search for bytes that changed to
// 600 (or any standard attitude enum: 0, 100, 200, 400, 600) between peace
// and war saves.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const war = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 besiged corduba.sav'));

const ATTITUDE_VALUES = [0, 100, 200, 400, 600, -10];

// Build a list of byte positions where the value CHANGED in-place
// (no shift) — same offset, different byte. Then check if the new value
// looks like an attitude enum.
// Since the files have different sizes, we'll align using the front match,
// find the divergence point, then walk through positions checking for
// in-place differences within the first N bytes (where files still align).

// Find first diff
let firstDiff = -1;
for (let i = 0; i < Math.min(peace.length, war.length); i++) {
  if (peace[i] !== war[i]) { firstDiff = i; break; }
}
console.log('First diff: 0x' + firstDiff.toString(16));

// Up to firstDiff bytes are identical. After that, files diverge.
// For ANY in-place comparison to be meaningful, we need to find regions
// where peace and war are aligned. The simplest case: peace[N] != war[N]
// but peace[N+k] == war[N+k] for some small k — those are in-place flips.

// Scan the first 0x10000 bytes (header zone) for in-place byte diffs
console.log('\n=== In-place byte changes in header zone (first 0x10000) ===');
console.log('Look for changes to/from standard attitude values: 0, 100, 200, 400, 600, -10');
let inplaceCount = 0;
const inplaceList = [];
for (let i = 0; i < 0x10000; i++) {
  if (peace[i] !== war[i]) {
    inplaceCount++;
    if (inplaceList.length < 200) inplaceList.push(i);
  }
}
console.log('Total in-place diffs in 0..0x10000: ' + inplaceCount);

// For each in-place position, check if reading as i32 / i16 / u16 / u32
// gives an attitude-enum value
console.log('\n=== In-place positions, checking attitude-enum candidates ===');
let foundAttitudeChange = 0;
for (const i of inplaceList) {
  // Check if the i32 around the change is an attitude value
  for (const align of [0, -1, -2, -3]) {
    const p = i + align;
    if (p < 0 || p + 4 > Math.min(peace.length, war.length)) continue;
    const pPeace = peace.readInt32LE(p);
    const pWar = war.readInt32LE(p);
    if (pPeace === pWar) continue;
    // Check if either is an attitude value
    if (ATTITUDE_VALUES.includes(pPeace) && ATTITUDE_VALUES.includes(pWar)) {
      console.log('  i32@0x' + p.toString(16) + ': ' + pPeace + ' → ' + pWar + '  (BOTH attitude!)');
      foundAttitudeChange++;
    } else if (ATTITUDE_VALUES.includes(pWar) && Math.abs(pPeace) < 1000) {
      console.log('  i32@0x' + p.toString(16) + ': ' + pPeace + ' → ' + pWar + '  (war side is attitude)');
      foundAttitudeChange++;
    }
  }
  // Also check i16
  for (const align of [0, -1]) {
    const p = i + align;
    if (p < 0 || p + 2 > Math.min(peace.length, war.length)) continue;
    const pPeace = peace.readInt16LE(p);
    const pWar = war.readInt16LE(p);
    if (pPeace === pWar) continue;
    if (ATTITUDE_VALUES.includes(pPeace) && ATTITUDE_VALUES.includes(pWar)) {
      console.log('  i16@0x' + p.toString(16) + ': ' + pPeace + ' → ' + pWar + '  (i16 attitudes!)');
      foundAttitudeChange++;
    }
  }
}
console.log('\nAttitude-value changes found: ' + foundAttitudeChange);

// Direct hunt: search the ENTIRE war save for newly-appeared 0x258 (600 = AT_WAR)
// values at positions where peace had a different value.
console.log('\n=== All positions where peace[i..i+4] is some attitude → war is AT_WAR (600) ===');
const minLen = Math.min(peace.length, war.length);
for (let i = 0; i < minLen - 4; i++) {
  if (war.readInt32LE(i) === 600) {
    const pv = peace.readInt32LE(i);
    if (pv === 600) continue;  // already 600
    if (ATTITUDE_VALUES.includes(pv) || (pv >= 0 && pv <= 700)) {
      console.log('  i32@0x' + i.toString(16) + ': peace=' + pv + ' → war=600 (AT_WAR)');
    }
  }
}
