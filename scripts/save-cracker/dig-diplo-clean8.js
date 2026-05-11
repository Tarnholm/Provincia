// Session 32 step 8: Find the lua-footer id_<faction> entries in save_1.1.sav.
// These map faction names to faction-id integers. We need id_romans_julii and id_messapians.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));

// Lua footer: per RESEARCH session 23, around 0x210f4d4..0x21153ae.
// Search for "id_" prefix as ASCII (with high-bit clear, regular printable).
console.log(`Searching for "id_<faction>" strings...`);

// Use a regex pattern: look for sequences of `id_` followed by [a-z_]+ followed by ` = ` and digits.
const big = a.toString('latin1');

const re = /id_[a-z_]+\s*=\s*-?\d+/g;
const matches = big.match(re) || [];
const unique = [...new Set(matches)];
console.log(`Total id_ matches: ${matches.length}, unique: ${unique.length}`);
for (const m of unique.slice(0, 80)) console.log(`  ${m}`);

// Also locate the lua footer's start to print it for context.
const fooStart = big.indexOf('id_romans_julii');
console.log(`\nid_romans_julii first found at offset 0x${fooStart.toString(16)}`);
if (fooStart > 0) {
  // Print 4KB around the lua footer.
  const start = Math.max(0, fooStart - 512);
  const end = Math.min(big.length, fooStart + 4096);
  console.log(`Footer excerpt (0x${start.toString(16)}..0x${end.toString(16)}):`);
  console.log(big.slice(start, end));
}
