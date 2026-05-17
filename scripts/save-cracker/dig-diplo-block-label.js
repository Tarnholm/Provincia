// Try to label diplomatic blocks by their attitude patterns.
//
// Known facts:
//   - Diplomatic table at 0xcff0..0x1943f
//   - 380 records, 20 blocks × 19 records
//   - 16-byte format: attitude, initiator_state, counter, value
//   - Spain↔Carthage were at record indices 145 and 335 of 380
//   - Block 7 and Block 17 = Spain or Carthage
//
// Approach: in vanilla 270 BC, certain factions are PRE-AT-WAR:
//   - All Roman factions vs rebels and barbarians (Gauls, Germans, Britons)
//   - Roman Senate is at_war with all 3 other Roman factions ? (no, Civil War)
//   - Many factions start neutral with most others
//
// Each block has 19 relations (to the other 19 non-rebel factions).
// Block characteristic: per-block AT_WAR count + per-block ALLIED count.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

// Parse all 380 records
const PREAMBLE = Buffer.from([0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x0d, 0, 0, 0, 0xc8, 0, 0, 0]);
function findAllRecords() {
  const records = [];
  let p = 0xcff0;
  while (p < 0x1943f) {
    if (p + 36 > buf.length) break;
    // Check if preamble matches
    let preMatch = true;
    for (let i = 0; i < 20; i++) {
      if (buf[p + i] !== PREAMBLE[i]) { preMatch = false; break; }
    }
    if (preMatch) {
      const attitude = buf.readInt32LE(p + 20);
      const initiator = buf.readInt32LE(p + 24);
      const counter = buf.readInt32LE(p + 28);
      const value = buf.readInt32LE(p + 32);
      records.push({ off: p, attitude, initiator, counter, value });
      p += 115;  // record stride
    } else {
      p++;
    }
  }
  return records;
}

const records = findAllRecords();
console.log('Total diplomatic records: ' + records.length);

if (records.length !== 380) {
  console.log('Unexpected count, expected 380');
}

// Split into 20 blocks of 19 relations each
const BLOCK_SIZE = 19;
const blocks = [];
for (let b = 0; b < 20; b++) {
  blocks.push(records.slice(b * BLOCK_SIZE, (b + 1) * BLOCK_SIZE));
}

// For each block, characterize:
//   - # of AT_WAR (attitude=600)
//   - # of ALLIED (attitude=0)
//   - # of NEUTRAL (attitude=200)
//   - any positions where the OTHER side declared on us (initiator=0)
console.log('\n=== Block characterization ===');
console.log('block  AT_WAR  ALLIED  NEUTRAL  recipient_of_war  declarer_of_war');
for (let b = 0; b < 20; b++) {
  const block = blocks[b];
  let atWar = 0, allied = 0, neutral = 0;
  let recipientOfWar = 0, declarerOfWar = 0;
  for (const r of block) {
    if (r.attitude === 600) {
      atWar++;
      if (r.initiator === 0) recipientOfWar++;
      else if (r.initiator === 1) declarerOfWar++;
    } else if (r.attitude === 0) allied++;
    else if (r.attitude === 200) neutral++;
  }
  console.log('  ' + String(b).padStart(2) + '    ' + String(atWar).padStart(3) + '     ' + String(allied).padStart(3) +
    '      ' + String(neutral).padStart(3) + '         ' + String(recipientOfWar).padStart(3) +
    '              ' + String(declarerOfWar).padStart(3));
}

// Spain is the player and DECLARED WAR on Carthage at T4. So Spain's block has initiator=1 for one relation.
// Carthage's block has initiator=0 for one relation (received the war declaration).
console.log('\n=== Blocks with declarer_of_war > 0 (= declared war on someone) ===');
for (let b = 0; b < 20; b++) {
  const block = blocks[b];
  for (let i = 0; i < block.length; i++) {
    if (block[i].attitude === 600 && block[i].initiator === 1) {
      console.log('  Block ' + b + ' relation ' + i + ': DECLARED war on someone (counter=' + block[i].counter + ', value=' + block[i].value + ')');
    }
  }
}
console.log('\n=== Blocks with recipient_of_war > 0 (= had war declared on them) ===');
for (let b = 0; b < 20; b++) {
  const block = blocks[b];
  for (let i = 0; i < block.length; i++) {
    if (block[i].attitude === 600 && block[i].initiator === 0) {
      console.log('  Block ' + b + ' relation ' + i + ': RECEIVED war declaration (counter=' + block[i].counter + ', value=' + block[i].value + ')');
    }
  }
}
