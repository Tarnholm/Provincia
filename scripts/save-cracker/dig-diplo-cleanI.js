// Session 32 step I: investigate the stretch targets.
// 1. Substitution-event cluster at 0xa8e13..0xaa9e8 (~50 single-byte tweaks)
// 2. The 1-byte insertion/deletion pattern at 0xf846e0+ that contributes the size delta.
// 3. The 0x455c 4-byte change.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const b = fs.readFileSync(path.join(SAVES, 'save_2.1.sav'));

function dump(buf, start, len, label) {
  console.log(`--- ${label} @ 0x${start.toString(16)} (${len} bytes) ---`);
  for (let i = 0; i < len; i += 16) {
    const off = start + i;
    const slice = buf.slice(off, Math.min(off + 16, start + len));
    const hexs = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const asciis = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log(`  ${off.toString(16).padStart(8, '0')}: ${hexs.padEnd(48)} ${asciis}`);
  }
}

// 1. 0x455c — show context.
console.log('=== AREA: 0x455c (4-byte change) ===');
dump(a, 0x4550, 64, 'A');
dump(b, 0x4550, 64, 'B');
// At 0x455c, 4 bytes: A=8b 2e 2b 25, B=30 4d 0a 4d.

// 2. The 1-byte cluster at 0xa8e10..0xaa9e0 area. This is BEFORE the matrix at 0xf8fd2.
// All 1-byte changes were at fixed offsets (no shift). Print first few and check pattern.
console.log('\n=== AREA: 0xa8e10 cluster (single-byte changes) ===');
dump(a, 0xa8e00, 64, 'A');
dump(b, 0xa8e00, 64, 'B');
console.log('\n=== AREA: 0xa9040..0xa9070 ===');
dump(a, 0xa9040, 80, 'A');
dump(b, 0xa9040, 80, 'B');

// 3. The 1-byte insertion/deletion pattern at 0xf846e0+. Note these have delta=+1 (B has extra byte).
// We have ~600+ events of this form. Look at the structure.
console.log('\n=== AREA: 0xf846e0 (per-region insertion of "03"?) ===');
// In dig-diplo-clean4, we saw: at 0xf846e0, B inserted byte 0x03; at 0xf847ce, A had 0xff (B deleted it).
// Distance: 0xf847ce - 0xf846e0 = 238 bytes!! Almost matches stride 239 — but not exactly.

// Wait: the file region 0xf846a0+ contains "and_region.ZBN" + "core_building." strings (from earlier dump).
// Suggests this is the per-region building data section.

// Check: does this region's stride match 239?
console.log('Insertion offsets: 0xf846e0, 0xf84818, 0xf8494e, 0xf84a94, 0xf84bd0, 0xf84d01...');
const ins = [0xf846e0, 0xf84818, 0xf8494e, 0xf84a94, 0xf84bd0, 0xf84d01, 0xf84e3a, 0xf84f74, 0xf850a5];
for (let i = 1; i < ins.length; i++) console.log(`  delta = ${ins[i] - ins[i-1]}`);

// Also the deletion offsets (in A) should be similarly spaced.
const del = [0xf847ce, 0xf84906, 0xf84a3c, 0xf84b82, 0xf84cbe, 0xf84def];
for (let i = 1; i < del.length; i++) console.log(`  del delta = ${del[i] - del[i-1]}`);
