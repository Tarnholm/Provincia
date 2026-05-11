#!/usr/bin/env node
// Find what settlement the market at 0x111c8 belongs to.
// And verify the damage field by checking ALL building sub-records (barracks, missiles, market, etc.).

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_notdamagedturn1.sav'));
const B = fs.readFileSync(path.join(dir, 'save_damagedturn1.sav'));

// Find settlement name immediately before market[1] @ 0x111c8
console.log('Settlement names (UTF-16LE) in vicinity of 0x111c8:');
for (let i = 0; i < 0x111c8; i++) {
  if (A[i] === 0x01 && A[i+1] >= 3 && A[i+1] < 30 && A[i+2] === 0) {
    const len = A.readUInt16LE(i + 1);
    if (len >= 3 && len <= 30) {
      let s = '';
      let ok = true;
      for (let j = 0; j < len; j++) {
        const c = A.readUInt16LE(i + 3 + j * 2);
        if (c < 0x20 || c > 0x7e) { ok = false; break; }
        s += String.fromCharCode(c);
      }
      if (ok && /^[A-Z][a-z]/.test(s)) {
        console.log(`  0x${i.toString(16)}: "${s}" (Δ from market[1]: ${0x111c8 - i})`);
      }
    }
  }
}

// Check ALL building sub-records for damage diffs
console.log('\n=== Building sub-record damage check (notdamaged vs damaged) ===');
const subrecNames = ['core_building', 'defenses', 'barracks', 'missiles', 'market', 'health',
                     'port_buildings', 'hinterland_farms', 'hinterland_roads', 'theatres',
                     'temple_of_governors', 'temple_of_one_god', 'despotic_law', 'academic',
                     'equestrian', 'default_set'];
for (const name of subrecNames) {
  const cstr = Buffer.from(name + '\0');
  let pos = 0;
  const aVals = [];
  while ((pos = A.indexOf(cstr, pos)) !== -1) {
    // Check the byte at known damage offset
    // From context: cstring at pos, then null, then bytes at pos + len + 1..
    // 0x111ec is at market@0x111c5 + 39 = pos + 39. But "market" is 6 chars, so pos+0..5='market', pos+6=null
    // The damage byte sits at pos + 39 (= pos + 6 + 33).
    // After cstring: [u32 some-ptr][u32 some-id][... maybe more ...][u32 level=4][u32 damage=100]
    // Compute relative offset of the damage byte for each: name length differs.
    // Actually let's check pos+33+len from pos+1 since cstring starts at pos.
    // Hmm. Let me re-examine: "market\0" is 7 bytes (6+1). At pos+6 is null. The damage byte is at 0x111ec - 0x111c5 = 39.
    // "market" cstring at 0x111c5, null at 0x111cb. 0x111ec - 0x111cb = 33 bytes past the null.
    // So damage byte is at: pos + nameLen + 1 + 33 = pos + nameLen + 34.
    // For "market" (6 chars): pos + 40. But 0x111c5 + 40 = 0x111ed. That's off by 1 from 0x111ec (= 0x111c5 + 39).
    // So actually damage byte = pos + 6 + 33 = pos + nameLen + 33. Confirm by trying pos + nameLen + 33.
    const damageOff = pos + name.length + 33;
    if (damageOff < A.length) {
      aVals.push({ pos, dPos: damageOff, val: A[damageOff], bval: B[damageOff] });
    }
    pos += 1;
  }
  if (aVals.length > 0) {
    let diffCount = 0;
    for (const v of aVals) {
      if (v.val !== v.bval) {
        diffCount++;
        console.log(`  ${name}[ ${aVals.indexOf(v)} ] @ 0x${v.pos.toString(16)}: dPos=0x${v.dPos.toString(16)} A=${v.val} B=${v.bval}`);
      }
    }
    if (diffCount === 0) {
      // Show distribution
      const histA = {};
      for (const v of aVals) {
        histA[v.val] = (histA[v.val] || 0) + 1;
      }
      console.log(`  ${name}: ${aVals.length} total, no diffs. histogram of damage byte: ${JSON.stringify(histA)}`);
    }
  }
}
