// Try wider strides (200-800 bytes per FACTION_ECONOMICS record) and allow
// treasury at any offset (0..40) within the record.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));
const T2 = fs.readFileSync(path.join(BASE_R, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'));

const TREASURY_SPAIN_T1 = 2500;
const TREASURY_SPAIN_T2 = 3840;

// All positions where T1=2500 AND T2=3840 at SAME offset (these are Spain's actual treasury fields)
const spainTreasuryOffsets = [];
const minLen = Math.min(T1.length, T2.length);
for (let p = 0; p < minLen - 4; p++) {
  if (T1.readUInt32LE(p) === 2500 && T2.readUInt32LE(p) === 3840) {
    spainTreasuryOffsets.push(p);
  }
}
console.log('Spain treasury offsets (T1=2500 AND T2=3840 at same offset): ' + spainTreasuryOffsets.length);
for (const p of spainTreasuryOffsets) console.log('  0x' + p.toString(16));

// For each such offset, also find OTHER offsets in the same file that look like other
// faction treasuries. Their differences from Spain's offset = record stride.
console.log('\n=== For each Spain treasury offset, find candidate record-stride patterns ===');
for (const sp of spainTreasuryOffsets) {
  // Look at nearby u32 values that look like treasuries (in T1=[50..50000], T2=[50..50000])
  // and where T2 - T1 is in reasonable income range (-500..3000 — some lose money, most gain).
  const others = [];
  for (let p = sp - 20000; p < sp + 20000; p += 4) {
    if (p === sp) continue;
    if (p < 0 || p + 4 > minLen) continue;
    const v1 = T1.readUInt32LE(p);
    const v2 = T2.readUInt32LE(p);
    if (v1 < 50 || v1 > 100000) continue;
    if (v2 < 50 || v2 > 100000) continue;
    const d = v2 - v1;
    if (Math.abs(d) > 5000) continue;
    if (v1 % 256 === 0 && v2 % 256 === 0) continue;
    others.push({ off: p, dx: p - sp, v1, v2, d });
  }
  console.log('\nSpain treasury @ 0x' + sp.toString(16) + ': ' + others.length + ' nearby treasury-like u32s');
  // Group by stride (dx mod possible sizes)
  // Show first 20
  for (const o of others.slice(0, 30)) {
    console.log('  dx=' + o.dx.toString().padStart(6) + '  @0x' + o.off.toString(16) + '  T1=' + o.v1 + ' T2=' + o.v2 + ' Δ=' + (o.d >= 0 ? '+' : '') + o.d);
  }
}
