// Session 32 step 9: brute-force find any 'messapians' or 'julii' substring in save_1.1.
// Print context. Also print all 16-byte ASCII runs to find a lua-footer-like section.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const big = a.toString('latin1');

function findAll(needle) {
  const positions = [];
  let idx = 0;
  while (true) {
    const p = big.indexOf(needle, idx);
    if (p < 0) break;
    positions.push(p);
    idx = p + 1;
  }
  return positions;
}

for (const needle of ['messapians', 'julii', 'romans_julii', 'romans']) {
  const ps = findAll(needle);
  console.log(`"${needle}" found at ${ps.length} positions`);
  for (const p of ps.slice(0, 10)) {
    const ctx = big.slice(Math.max(0, p - 24), Math.min(big.length, p + 60)).replace(/[^\x20-\x7e]/g, '.');
    console.log(`  0x${p.toString(16)}: ${ctx}`);
  }
}
