// For each hastati position in NEXT_TURN, scan multiple offsets to find the
// unit where all 122 soldiers have UNIFORM stat bytes (= the retrained one
// with weapon+1 + armor+1).

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BEFORE = fs.readFileSync(path.join(BASE_R, 'save_before armor upgrade queue.sav'));
const NEXT_T = fs.readFileSync(path.join(BASE_R, 'save_next turn, armour upgraded..sav'));

function findAllAscii(buf, str) {
  const target = Buffer.from(str + '\0', 'ascii');
  const positions = [];
  let p = 0;
  while (true) {
    const idx = buf.indexOf(target, p);
    if (idx === -1) break;
    positions.push(idx);
    p = idx + 1;
  }
  return positions;
}

const hastatiNext = findAllAscii(NEXT_T, 'roman hastati early');
const hastatiBefore = findAllAscii(BEFORE, 'roman hastati early');

// For each hastati in NEXT_T, scan offsets 50-500 looking for a position where ALL 122
// soldiers have the same byte value at stride 9 (and that value is non-zero, e.g. 0x04).
function findUniformStatOffset(buf, nameOff, soldierCount) {
  const candidates = [];
  for (let off = 50; off < 500; off++) {
    let allSame = true;
    let val = buf[nameOff + off];
    if (val === 0) continue; // skip all-zero
    if (val === 0xff) continue; // skip padding
    for (let i = 1; i < soldierCount; i++) {
      if (buf[nameOff + off + i * 9] !== val) { allSame = false; break; }
    }
    if (allSame) candidates.push({ off, val });
  }
  return candidates;
}

console.log('=== Scan each hastati in NEXT_TURN for uniform stat-byte offsets ===');
for (let i = 0; i < Math.min(hastatiNext.length, 15); i++) {
  const p = hastatiNext[i];
  const cands = findUniformStatOffset(NEXT_T, p, 122);
  if (cands.length > 0) {
    console.log('\n  Hastati ' + i + ' @ 0x' + p.toString(16) + ': ' + cands.length + ' uniform offsets');
    for (const c of cands.slice(0, 10)) {
      console.log('    offset +' + c.off + ': all 122 soldiers = 0x' + c.val.toString(16));
    }
  }
}

// Same check on BEFORE
console.log('\n\n=== Scan each hastati in BEFORE save for uniform stat-byte offsets ===');
for (let i = 0; i < Math.min(hastatiBefore.length, 15); i++) {
  const p = hastatiBefore[i];
  const cands = findUniformStatOffset(BEFORE, p, 122);
  if (cands.length > 0) {
    console.log('\n  Hastati ' + i + ' @ 0x' + p.toString(16) + ': ' + cands.length + ' uniform offsets');
    for (const c of cands.slice(0, 10)) {
      console.log('    offset +' + c.off + ': all 122 soldiers = 0x' + c.val.toString(16));
    }
  }
}
