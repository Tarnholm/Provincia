// Final check: in NEXT_TURN, find units where MULTIPLE bytes of each soldier record
// are uniformly non-zero (= weapon + armor + exp upgrades).

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
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

const unitTypes = ['roman hastati early', 'roman principes early', 'roman triarii early',
                   'roman equites early', 'roman leves', 'roman rorarii', 'aor etruscan spearmen'];

for (const type of unitTypes) {
  const positions = findAllAscii(NEXT_T, type);
  console.log('\n=== ' + type + ' (' + positions.length + ' occurrences) ===');
  // For each occurrence, check if at any offset there are MULTIPLE uniform stat bytes
  // (= upgraded unit with weapon + armor + maybe exp)
  for (let idx = 0; idx < Math.min(positions.length, 25); idx++) {
    const p = positions[idx];
    // Look for offsets where stride-9 reads have a uniform "stat-like" value (1-15 typically)
    // Detect a CLUSTER: 2+ consecutive byte positions where stride-9 reads are all same
    const cands = [];
    for (let off = 50; off < 500; off++) {
      const v = NEXT_T[p + off];
      if (v === 0 || v > 15) continue;  // stat values are small
      // Check that stride-9 reads at this offset are all same value
      let allSame = true;
      for (let i = 1; i < 50; i++) {  // check 50 soldiers for speed
        if (NEXT_T[p + off + i * 9] !== v) { allSame = false; break; }
      }
      if (allSame) cands.push({ off, val: v });
    }
    if (cands.length >= 2) {
      // Group by val
      const byVal = {};
      for (const c of cands) {
        if (!byVal[c.val]) byVal[c.val] = [];
        byVal[c.val].push(c.off);
      }
      // Look for sets where we have BOTH a constant byte at one offset AND another constant byte at +1
      // (= weapon and armor next to each other)
      // Show all unique values
      console.log('  unit ' + idx + ' @ 0x' + p.toString(16) + ' uniform-stat positions:');
      for (const [v, offs] of Object.entries(byVal)) {
        console.log('    value 0x' + parseInt(v).toString(16) + ': ' + offs.length + ' offsets, first 8: [' + offs.slice(0, 8).join(',') + ']');
      }
    }
  }
}
