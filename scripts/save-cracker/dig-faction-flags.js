// Investigate the 21-entry u32 arrays at 0xe80 and 0xed8.
// Hypothesis: per-faction player flag (0=player, 1=AI).

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));

const T_FILES = {};
for (const f of allFiles) {
  for (const t of [1, 2, 3, 4]) {
    if (f.includes('Turn ' + t)) {
      if (!T_FILES[t]) T_FILES[t] = fs.readFileSync(path.join(BASE, f));
      break;
    }
  }
}

const buf = T_FILES[4];

console.log('=== Array 1 at 0xe80 (21 entries × u32) ===');
for (let i = 0; i < 21; i++) {
  console.log('  index ' + String(i).padStart(2) + ': ' + buf.readUInt32LE(0xe80 + i * 4));
}

console.log('\n=== Array 2 at 0xed8 (21 entries × u32) ===');
for (let i = 0; i < 21; i++) {
  console.log('  index ' + String(i).padStart(2) + ': ' + buf.readUInt32LE(0xed8 + i * 4));
}

// What if there are MORE arrays of this type? Look for the pattern
console.log('\n=== Find more 21×u32 arrays of mostly-1s in 0..0x2000 ===');
for (let start = 0x100; start < 0x2000; start += 4) {
  let onesCount = 0;
  let zerosCount = 0;
  let validRun = 0;
  for (let i = 0; i < 21; i++) {
    const v = buf.readUInt32LE(start + i * 4);
    if (v === 0) zerosCount++;
    else if (v === 1) onesCount++;
    else break;
    validRun++;
  }
  if (validRun === 21 && onesCount >= 15 && zerosCount >= 1 && zerosCount <= 5) {
    console.log('  Array at 0x' + start.toString(16) + ': ' + onesCount + ' ones, ' + zerosCount + ' zeros');
    // Show indices of zeros
    for (let i = 0; i < 21; i++) {
      const v = buf.readUInt32LE(start + i * 4);
      if (v === 0) console.log('    zero at index ' + i);
    }
  }
}

// Now compare these arrays across turns. If they encode game state
// (player faction, faction alive flags, etc.), they should be STABLE
// across turns (unless faction destroyed).
console.log('\n=== Compare array 0xe80 across T1→T4 ===');
for (let i = 0; i < 21; i++) {
  const vals = [1, 2, 3, 4].filter(t => T_FILES[t]).map(t => T_FILES[t].readUInt32LE(0xe80 + i * 4));
  if (new Set(vals).size > 1) {
    console.log('  index ' + i + ': T1-T4 = [' + vals.join(', ') + ']');
  }
}
console.log('\n=== Compare array 0xed8 across T1→T4 ===');
for (let i = 0; i < 21; i++) {
  const vals = [1, 2, 3, 4].filter(t => T_FILES[t]).map(t => T_FILES[t].readUInt32LE(0xed8 + i * 4));
  if (new Set(vals).size > 1) {
    console.log('  index ' + i + ': T1-T4 = [' + vals.join(', ') + ']');
  }
}
