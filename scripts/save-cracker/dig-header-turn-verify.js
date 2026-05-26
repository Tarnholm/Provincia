// dig-header-turn-verify.js
// Verify 0x44e3 turn-counter hypothesis across MULTIPLE campaigns + find YEAR.
// Also dump the surrounding region 0x43f0..0x4530 in each save.

const fs = require('fs');
const path = require('path');
const S = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
function load(name) { return fs.readFileSync(path.join(S, name)); }

function dumpRange(buf, start, end) {
  for (let off = start; off < end; off += 16) {
    const len = Math.min(16, end - off);
    const slice = buf.slice(off, off + len);
    const hex = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log('  0x' + off.toString(16) + ': ' + hex.padEnd(48) + ' |' + asc + '|');
  }
}

// expected turn per save (from filename)
const sets = {
  't0..t7': [
    ['t0', 0, 'save_t0.sav'], ['t1', 1, 'save_t1.sav'], ['t2', 2, 'save_t2.sav'],
    ['t3', 3, 'save_t3.sav'], ['t4', 4, 'save_t4.sav'], ['t5', 5, 'save_t5.sav'],
    ['t6', 6, 'save_t6.sav'], ['t7', 7, 'save_t7.sav'],
  ],
  'Spain': [
    ['Sp-T1', 1, 'save_17-05-2026   Spain   Turn 1.sav'],
    ['Sp-T2', 2, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'],
    ['Sp-T3', 3, 'save_Autosave   Spain   Turn 3 End.sav'],
    ['Sp-T4', 4, 'save_Autosave   Spain   Turn 4 Start.sav'],
  ],
  'arretium': [
    ['Ar-PRE(T1)', 1, 'save_arretium pre retrained..sav'],
    ['Ar-QUE(T1)', 1, 'save_arretium queued retrain.sav'],
    ['Ar-T2', 2, 'save_arretium retrained turn 2.sav'],
    ['Ar-T3', 3, 'save_arretium turn 3.sav'],
    ['Ar-T4', 4, 'save_arretium turn 4.sav'],
  ],
  'Carthage': [
    ['Ca-T1E', 1, 'save_Autosave   Carthage   Turn 1 End.sav'],
    ['Ca-T2S', 2, 'save_Autosave   Carthage   Turn 2 Start.sav'],
    ['Ca-T2', 2, 'save_Autosave   Carthage   Turn 2.sav'],
  ],
  'Rome': [
    ['Ro-T2', 2, 'save_Autosave   Republic of Rome   Turn 2.sav'],
    ['Ro-T4E', 4, 'save_Autosave   Republic of Rome   Turn 4 End.sav'],
    ['Ro-T5S', 5, 'save_Autosave   Republic of Rome   Turn 5 Start.sav'],
  ],
  'Dummies': [
    ['Du-T7E', 7, 'save_Autosave   Dummies   Turn 7 End.sav'],
    ['Du-T8S', 8, 'save_Autosave   Dummies   Turn 8 Start.sav'],
    ['Du-T8', 8, 'save_Autosave   Dummies   Turn 8.sav'],
  ],
};

const OFF = 0x44e3;
console.log('=== u32@0x44e3 across all turn sequences (expected = filename turn) ===');
for (const [setName, list] of Object.entries(sets)) {
  console.log('\n--- ' + setName + ' ---');
  for (const [tag, expTurn, fn] of list) {
    const buf = load(fn);
    const v = buf.readUInt32LE(OFF);
    const v8 = buf[OFF];
    const ok = (v === expTurn) ? 'OK==filename' : (v === expTurn - 1 ? '(filename-1)' : (v === expTurn + 1 ? '(filename+1)' : 'MISMATCH'));
    console.log('  ' + tag.padEnd(12) + ' expTurn=' + expTurn + '  u32@0x44e3=' + v + '  u8=' + v8 + '  -> ' + ok);
  }
}

// Dump region around 0x44e3 for a few saves to understand alignment / neighbors
console.log('\n\n=== Region 0x4480..0x4540 in t0, t3, t7, Spain-T1, Macedon ===');
for (const [tag, fn] of [
  ['t0', 'save_t0.sav'], ['t3', 'save_t3.sav'], ['t7', 'save_t7.sav'],
  ['Spain-T1', 'save_17-05-2026   Spain   Turn 1.sav'],
  ['Macedon', 'save_macedon t0.sav'],
]) {
  console.log('\n--- ' + tag + ' ---');
  dumpRange(load(fn), 0x4480, 0x4540);
}
