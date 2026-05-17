// Identify each faction-block by its attitude pattern. Roman factions
// have 3 attitude=0 (ALLIED) entries each. Plus other distinctive patterns
// help identify Carthage, Spain, etc.

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
        preambleAt: p,
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
console.log('Total records:', records.length, '\n');

// Assume 20 blocks × 19 records each = 380
const BLOCK_SIZE = 19;
const BLOCKS = 20;
console.log('Assumed structure: ' + BLOCKS + ' blocks × ' + BLOCK_SIZE + ' records = ' + (BLOCKS * BLOCK_SIZE));

// For each block, report attitude distribution
console.log('\n=== Per-block attitude distribution ===');
console.log('block#  start  end    a=0  a=200  a=400  a=600  total  fingerprint');
for (let b = 0; b < BLOCKS; b++) {
  const start = b * BLOCK_SIZE;
  const end = start + BLOCK_SIZE;
  const slice = records.slice(start, end);
  if (slice.length === 0) break;
  const dist = { 0: 0, 100: 0, 200: 0, 400: 0, 600: 0, '-10': 0 };
  for (const r of slice) dist[r.attitude] = (dist[r.attitude] || 0) + 1;
  const fp = slice.map(r => r.attitude).join('-');
  console.log('  ' + String(b).padStart(2) +
              '     ' + String(start).padStart(3) +
              '   ' + String(end).padStart(3) +
              '   ' + String(dist[0]).padStart(3) +
              '   ' + String(dist[200]).padStart(5) +
              '   ' + String(dist[400]).padStart(5) +
              '   ' + String(dist[600]).padStart(5) +
              '   ' + slice.length +
              '   ' + fp);
}

// Show block boundaries by file offset (look for gaps/transitions)
console.log('\n=== Record positions, grouped by block ===');
for (let b = 0; b < BLOCKS; b++) {
  const start = b * BLOCK_SIZE;
  const end = start + BLOCK_SIZE;
  const slice = records.slice(start, end);
  if (slice.length === 0) break;
  console.log('Block ' + b + ' (' + slice.length + ' records, peace[' + start + '..' + (end-1) + ']):');
  console.log('  first: 0x' + slice[0].recordAt.toString(16) + '  last: 0x' + slice[slice.length-1].recordAt.toString(16));
}

// Spain↔Carthage are at indices 145 and 335. Compute block:
// 145 / 19 = 7.63 → block 7
// 335 / 19 = 17.63 → block 17
console.log('\n=== Spain↔Carthage block analysis ===');
console.log('Record 145 in block ' + Math.floor(145 / BLOCK_SIZE) + ', position-within-block ' + (145 % BLOCK_SIZE));
console.log('Record 335 in block ' + Math.floor(335 / BLOCK_SIZE) + ', position-within-block ' + (335 % BLOCK_SIZE));

// Look at block 7 in detail
console.log('\n=== Block 7 detail (one side of Spain↔Carthage) ===');
const block7 = records.slice(7 * 19, 7 * 19 + 19);
for (let i = 0; i < block7.length; i++) {
  const r = block7[i];
  const isFlipped = (i + 7 * 19 === 145) ? '  <-- FLIPPED' : '';
  console.log('  pos-in-block ' + i + '  attitude=' + r.attitude + '  state=' + r.state + '  counter=' + r.counter + '  fourth=' + r.fourth + isFlipped);
}

console.log('\n=== Block 17 detail (other side of Spain↔Carthage) ===');
const block17 = records.slice(17 * 19, 17 * 19 + 19);
for (let i = 0; i < block17.length; i++) {
  const r = block17[i];
  const isFlipped = (i + 17 * 19 === 335) ? '  <-- FLIPPED' : '';
  console.log('  pos-in-block ' + i + '  attitude=' + r.attitude + '  state=' + r.state + '  counter=' + r.counter + '  fourth=' + r.fourth + isFlipped);
}

// In each block, position-within-block N should refer to "this block's view of
// faction N" (skipping the block's own index). If block 7 is Carthage and
// position 145%19 = 145-133 = 12 refers to Spain, then Spain is at relative
// index 12 from Carthage's block.
// Similarly block 17 position 335-323 = 12 refers to Carthage from Spain's view.
// So in BOTH blocks, the Spain↔Carthage entry is at position-within-block 12.
// That's symmetric — confirms my structural hypothesis.

console.log('\nPosition within block 7 of the flipped record: ' + (145 - 7 * 19));
console.log('Position within block 17 of the flipped record: ' + (335 - 17 * 19));
