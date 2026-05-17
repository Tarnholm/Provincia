// Build the position-in-block → block-index mapping via symmetry.
// Every diplomatic relation is bidirectional, so Block A pos P ↔ Block B pos Q.
// If multiple block-pairs share an attitude (e.g., 4 Romans all ALLIED with
// each other), we can solve for the position-faction mapping.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

const PREAMBLE = Buffer.from([
  0x08, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x0d, 0x00, 0x00, 0x00,
  0xc8, 0x00, 0x00, 0x00,
]);

function findAllRecords(buf) {
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(PREAMBLE, p)) !== -1) {
    const aOff = p + 20;
    if (aOff + 16 > buf.length) { p++; continue; }
    const v = buf.readInt32LE(aOff);
    if ([0, 100, 200, 400, 600, -10].includes(v)) {
      hits.push({
        recordAt: aOff,
        attitude: v,
        state: buf.readInt32LE(aOff + 4),
        counter: buf.readInt32LE(aOff + 8),
        fourth: buf.readInt32LE(aOff + 12),
      });
    }
    p++;
  }
  return hits;
}

const records = findAllRecords(peace);
const BLOCK_SIZE = 19;
const NUM_BLOCKS = 20;

// Block has 19 positions. Each position refers to ONE of the OTHER 19 blocks.
// Define a permutation π: position_in_block → block_index_referenced.
// Crucially, π might differ per block (different blocks list factions in
// different relative orders), OR it might be a global function with the
// own-block skipped.
//
// Hypothesis: π is GLOBAL — position-in-block 0 always refers to faction 0,
// except in block 0 itself where it's skipped and shifted.

// Convention check: if block N is "tracking" factions, the position P could be:
//   (a) faction-index P, with own-block skipped (so position N in block N is
//       missing and positions > N are shifted down by 1)
//   (b) faction-index based on a fixed canonical order, possibly NOT the
//       block order

// Let's check hypothesis (a): for block B, position P should map to faction
// f(B, P) = P if P < B else P + 1.

// Verify with the Spain↔Carthage flip:
//   Block 7 position 12: f(7, 12) = 12+1=13 (since 12 >= 7)  → faction 13
//   Block 17 position 12: f(17, 12) = 12 (since 12 < 17)    → faction 12

// If block 7 is Carthage and the entry refers to Spain → faction 13 = Spain
// If block 17 is Spain and the entry refers to Carthage → faction 12 = Carthage

// But Carthage at faction 12 contradicts "block 7 = Carthage". So hypothesis (a)
// doesn't work, OR Spain↔Carthage are at block-indices 7 and 17 in some
// canonical mapping that doesn't equal faction-index.

// Let me try the inverse: if position-12 in BOTH blocks refers to a single
// other faction, then... wait, the two flipped records can't both refer to
// the same OTHER faction — they're the two SIDES of the relation.

// CORRECT model:
//   Block A position P encodes A's relation to faction X(A, P)
//   Block B position Q encodes B's relation to faction Y(B, Q)
//   For the bidirectional pair Block A ↔ Block B to be encoded, we need:
//     X(A, P) = B  AND  Y(B, Q) = A
//
// So for block 7 ↔ block 17 (Spain↔Carthage):
//   X(7, 12) = 17 (block 7's position 12 refers to block 17)
//   Y(17, 12) = 7 (block 17's position 12 refers to block 7)
//
// So the mapping function takes (block_index, position) and returns the
// referenced block_index. With hypothesis (a) [skip-own-shift]:
//   X(7, 12) = 12+1 = 13 (because 12 >= 7), not 17. ✗
//
// Hypothesis fails. So position-mapping is NOT skip-and-shift.

// Let me try the inverse: position P in block N refers to "block at distance P"
// or something more complex.

// Build the symmetric-pair adjacency: for each block B and position P, find
// another (B', P') such that swapping them yields the same attitude. The
// resulting graph should reveal the position mapping.

console.log('=== Symmetric pair search ===');
// For each ALLIED (attitude=0) entry, find another ALLIED entry in a
// different block with similar (counter, fourth) values — those are the
// symmetric pair.
const alliedRecords = [];
for (let b = 0; b < NUM_BLOCKS; b++) {
  for (let p = 0; p < BLOCK_SIZE; p++) {
    const idx = b * BLOCK_SIZE + p;
    if (idx >= records.length) break;
    if (records[idx].attitude === 0) {
      alliedRecords.push({ block: b, pos: p, idx, ...records[idx] });
    }
  }
}
console.log('Total ALLIED records:', alliedRecords.length);
for (const a of alliedRecords) {
  console.log('  block ' + a.block + ' pos ' + a.pos + '  counter=' + a.counter + '  fourth=' + a.fourth);
}

// Group ALLIED entries by (counter, fourth) — symmetric pairs likely
// share these values
const groups = new Map();
for (const a of alliedRecords) {
  const k = a.counter + '/' + a.fourth;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(a);
}
console.log('\nGrouped by (counter, fourth):');
for (const [k, list] of groups) {
  console.log('  (' + k + '): ' + list.length + ' records');
  for (const r of list) console.log('    block ' + r.block + ' pos ' + r.pos);
}

// In vanilla RTW, the 4 Roman factions are mutually ALLIED. So we expect
// 4×3 = 12 records. Let me see if the "counter=54, fourth=200" group
// matches a 12-record set with block 0-3 patterns.
//
// The blocks 0-3 contain 3+2+3+4 = 12 ALLIED records — but actually each
// of the 12 should pair symmetrically.

// For the bidirectional Roman alliance pairs (e.g., Julii↔Brutii), if
// Block 0 = Julii, Block 1 = Brutii:
//   Julii's pos P refers to Brutii  (one direction)
//   Brutii's pos Q refers to Julii  (other direction)
// Both should be ALLIED.

// Try to solve: what if positions are based on the canonical descr_strat
// order of the OTHER 19 factions? Then position-12 in Block 7 refers to
// the 13th non-self faction in canonical order.

// Specifically, if canonical order is the block order itself, position-12
// in block 7 refers to:
//   positions 0..6 are blocks 0..6 (factions before self)
//   position 7 is SKIPPED (self)
//   positions 7..18 are blocks 8..19 (factions after self)
// So position 12 in block 7 → block (12 + 1) = 13.

// But we said the flipped record at block 7 pos 12 refers to Spain at block 17.
// So either Spain is at block 13 (in block 7's view) or my model is wrong.

// Maybe each block has its OWN canonical order (the engine permutes positions
// per faction for some reason). Or maybe blocks 7 and 17 aren't the Spain↔
// Carthage indices and the order is something else entirely.

// Quick test: what if blocks aren't ordered like factions, but the
// position-12 within each block universally refers to a SPECIFIC faction
// (e.g., position 12 = Carthage in all blocks)?
//
// If position 12 universally = Carthage, then:
//   Block 7 pos 12 = relation between block-7-faction and Carthage
//   Block 17 pos 12 = relation between block-17-faction and Carthage
// But we want BOTH to be Spain↔Carthage. So block-7-faction = Spain and
// block-17-faction = some other faction with simultaneous war with Carthage.
//
// But only 2 records flipped (the two Spain↔Carthage relations). If block-17
// flipped too, then block-17-faction is the one Carthage went to war with —
// which is Spain. So block-17 = Spain.
//
// Then block-7 must also be Spain (since they share position-12 → Carthage)?
// That contradicts (each faction has its own block).

// OK my hypothesis "position 12 = Carthage universally" is wrong.

// New hypothesis: each block IS a faction, and positions 0..18 within each
// block reference some permutation of the OTHER 19 factions. The permutation
// might be the canonical descr_strat order, with the own-faction skipped.
//
// If Spain is at descr_strat position 18 and Carthage at descr_strat position
// some-X, then in BOTH spain and carthage's blocks, position-12 should refer
// to the SAME descr_strat-position-N faction (because position-12 is a fixed
// canonical index).
// But position-12 in Spain's block should refer to Carthage, and position-12
// in Carthage's block should refer to Spain — different factions!
// Contradiction unless position-mapping uses DIFFERENT canonical orders per
// block.

// Easier model: position P in Block N refers to faction at descr_strat-position
// P (skipping descr_strat position N). I.e., shift-after-skip.
// For Block 7, position 12: descr_strat position 12 (since 12 >= 7, shift to
// 13). So position-12 in block-7 refers to descr_strat-position-13 faction.
// For Block 17, position 12: descr_strat position 12 (since 12 < 17, no
// shift). So position-12 in block-17 refers to descr_strat-position-12.
//
// If these BOTH need to be Spain↔Carthage:
//   descr_strat[13] = Spain (referenced by Carthage at block 7)
//   descr_strat[12] = Carthage (referenced by Spain at block 17)
// And block-index = descr_strat position:
//   Block 7 = descr_strat[7] = Carthage
//   Block 17 = descr_strat[17] = Spain
//
// CHECK: Block 7 pos 12 → descr_strat[13] = Spain. Block 17 pos 12 → descr_strat[12] = Carthage.
// But we also said Block 17 = descr_strat[17]. So descr_strat[17] = Spain.
// And Block 7 = descr_strat[7] = Carthage. So descr_strat[7] = Carthage.
//
// CHECK ALSO: descr_strat[12] = Carthage (from block 17 pos 12 → Carthage).
// But descr_strat[7] = Carthage too. Contradiction (Carthage can't be at
// both position 7 and 12).

// So the shift-after-skip model is also wrong.

// Try: position is not based on a canonical ordering. Maybe each block has
// its own RELATIVE positioning where position 0 = "the faction 1 step away",
// position 1 = "2 steps away", etc.

// Actually the simplest explanation: the records are in some FIXED order
// shared across all blocks. Let me check if positions of ALLIED entries
// give a hint:
//   Block 0 ALLIED at positions 0, 1, 18  → 3 factions are at canonical 0, 1, 18
//   Block 1 ALLIED at positions 0, 1      → 2 factions at canonical 0, 1
//   Block 2 ALLIED at positions 0, 1, 2   → 3 factions at canonical 0, 1, 2
//   Block 3 ALLIED at positions 0, 1, 2, 3→ 4 factions at canonical 0, 1, 2, 3
//
// If block 3 has 4 allies at positions 0-3, and these are 4 Romans, then
// block 3 might NOT be a Roman (it sees all 4 Romans as allies). But 4
// Romans + block 3 = 5 factions including a 5th-Roman? Doesn't fit either.

// OR Block 3 has ALLIANCE_FORCED (-10) with one Roman that we're reading as
// just 0. But the original peace data showed attitude=0 for all 4 — so the
// SENATE's -10 alliances would show differently.

// Actually let me look at fourth field for block 3 records:
console.log('\n=== Block 3 records ===');
const b3 = records.slice(3 * 19, 4 * 19);
for (let i = 0; i < b3.length; i++) {
  console.log('  pos ' + i + '  attitude=' + b3[i].attitude + ' state=' + b3[i].state + ' counter=' + b3[i].counter + ' fourth=' + b3[i].fourth);
}
