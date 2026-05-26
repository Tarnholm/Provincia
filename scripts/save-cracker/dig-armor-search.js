// Find armor upgrade by finding a unit in BEFORE that had ONLY weapon at 0x04 (one position)
// vs same unit in NEXT_TURN with TWO uniform 0x04 positions.

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

// For each unit type and each instance, check how MANY byte positions have uniform 0x04
// at stride 9 across 60 soldiers.
function countUniform04(buf, p, n = 60) {
  let count = 0;
  const offs = [];
  for (let off = 50; off < 500; off++) {
    const v = buf[p + off];
    if (v !== 0x04) continue;
    let same = true;
    for (let i = 1; i < n; i++) {
      if (buf[p + off + i * 9] !== 0x04) { same = false; break; }
    }
    if (same) { count++; offs.push(off); }
  }
  return { count, offs };
}

const unitTypes = ['roman hastati early', 'roman principes early', 'roman triarii early',
                   'roman equites early', 'roman leves', 'roman rorarii', 'aor etruscan spearmen'];

console.log('Counting uniform-0x04 byte positions per unit in BEFORE vs NEXT_TURN.');
console.log('Diff = NEXT - BEFORE. A unit that gained armor should have +9 to +20 more uniform-0x04 positions.');
console.log();
for (const type of unitTypes) {
  const posBefore = findAllAscii(BEFORE, type);
  const posNext = findAllAscii(NEXT_T, type);
  console.log('--- ' + type + ' ---');
  for (let i = 0; i < Math.min(posBefore.length, posNext.length, 25); i++) {
    const b = countUniform04(BEFORE, posBefore[i]);
    const n = countUniform04(NEXT_T, posNext[i]);
    const diff = n.count - b.count;
    const tag = diff > 5 ? '  ← UPGRADED!' : (diff < -5 ? '  ← LOST?' : '');
    console.log('  unit ' + i + ': BEFORE=' + b.count + ' NEXT=' + n.count + ' diff=' + (diff > 0 ? '+' : '') + diff + tag);
    if (Math.abs(diff) > 5) {
      console.log('     BEFORE positions: [' + b.offs.slice(0, 10).join(',') + ']');
      console.log('     NEXT positions:   [' + n.offs.slice(0, 10).join(',') + ']');
    }
  }
}
