// Re-align with session 11's schema.
// In session 11, the 53-byte construction queue block is INSERTED before
// core_building (NOT default_set) in Pella. It's 53 bytes between
// "default_set sub-record trailer" and "core_building sub-record".
//
// In our save, the "queue block" appears RIGHT AFTER the default_set chain
// entry's data — i.e. between default_set and hinterland_region.
// In Alexander mod, hinterland_region doesn't exist (the first chain after
// default_set is core_building). So this IS the same construction queue block.

// Session 11 schema (53 bytes):
//   +0   u32  CHAIN_ID
//   +4   u32  0
//   +8   8 zeros
//   +16  u32  1
//   +20  u32  0
//   +24  u32  runtime_ptr
//   +28  u32  runtime_ptr
//   +32  u32  1
//   +36  u32  0
//   +40  u32  CHAIN_ID (dup)
//   +44  u32  0
//   +48  u32  level / turns (= 2 in session 11)
//   +52  trailing 12-16 bytes with CHAIN_ID a 3rd time + flags

// But this doesn't match the 106-byte body I see. Let me re-investigate.
// In our save, default_set BODY (52 bytes baseline + queue entry):
// The first 52 bytes of body in save_1.2 LOOKS LIKE THE EMPTY QUEUE BLOCK!
// header: 5a 46 f8 00 [hash] fc fc fc fc [1d 01 00 00 94 01 00 00]
//                                          ^this is the chain header itself
// then the queue entry data follows.

// New interpretation:
// The default_set chain entry is a STUB (size 52 bytes regardless of queue
// state). It uses a [u32 self_ptr][u32 hash][fc fc fc fc][...] entry format
// like the other chain entries. The QUEUE BLOCK is INSERTED BETWEEN the
// default_set entry and the next entry (hinterland_region) when active.

// Let me re-read save_1.2 more carefully:
const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_1.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_2.2.sav'));
const C = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));

// In save_1.2 (no queue), the body between default_set and hinterland_region is 53 bytes.
// If the queue block is 53 bytes when ACTIVE and 0 bytes when INACTIVE, then save_1.2's
// 53-byte body is the (always-present) header of default_set's chain entry.
// save_2.2's 106-byte body = 53-byte chain header + 53-byte queue block ✓
// save_3.2's 88-byte body = 53-byte chain header + 35-byte queue block ✓

// Verify: save_1.2 body's first 53 bytes == save_2.2 body's first 53 bytes (modulo hash)
const a1 = A.slice(A.indexOf(Buffer.from('default_set\0'), 0xf84600, 'latin1') + 12,
                   A.indexOf(Buffer.from('hinterland_region\0'), 0xf84600, 'latin1') - 10);
const a2 = B.slice(B.indexOf(Buffer.from('default_set\0'), 0xf84600, 'latin1') + 12,
                   B.indexOf(Buffer.from('hinterland_region\0'), 0xf84600, 'latin1') - 10);
const a3 = C.slice(C.indexOf(Buffer.from('default_set\0'), 0xf84600, 'latin1') + 12,
                   C.indexOf(Buffer.from('hinterland_region\0'), 0xf84600, 'latin1') - 10);

// Are the first 53 bytes identical (modulo hash bytes +4..+7) in all 3?
let mismatch = [];
for (let i = 0; i < 53; i++) {
  if (a1[i] !== a2[i] || a1[i] !== a3[i]) {
    mismatch.push({ i, a1: a1[i], a2: a2[i], a3: a3[i] });
  }
}
console.log(`First 53 bytes — differences (ignoring hash at +4..+7):`);
for (const m of mismatch) {
  console.log(`  +${m.i}: a1=0x${m.a1.toString(16)} a2=0x${m.a2.toString(16)} a3=0x${m.a3.toString(16)}`);
}

// Now look at the queue BLOCK (bytes 53.. in each)
console.log(`\nsave_1.2 queue block: ${a1.length - 53} bytes (empty)`);
console.log(`save_2.2 queue block: ${a2.length - 53} bytes (wall)`);
console.log(`save_3.2 queue block: ${a3.length - 53} bytes (levies)`);

// Print save_2.2 queue block
console.log('\nWall queue (53 bytes):');
for (let i = 53; i < a2.length; i++) {
  process.stdout.write(`${i.toString().padStart(3)}:${a2[i].toString(16).padStart(2,'0')} `);
  if ((i - 53) % 8 === 7) console.log();
}
console.log();

console.log('\nLevies queue (35 bytes):');
for (let i = 53; i < a3.length; i++) {
  process.stdout.write(`${i.toString().padStart(3)}:${a3[i].toString(16).padStart(2,'0')} `);
  if ((i - 53) % 8 === 7) console.log();
}
console.log();
