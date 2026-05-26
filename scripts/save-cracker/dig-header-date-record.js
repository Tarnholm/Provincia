// dig-header-date-record.js
// The turn counter is at descr_strat-path-end + fixed delta. Anchor it on the
// path string, decode the surrounding record (looks like turn + dates), and
// hunt YEAR. Also handle vanilla (no mod path) saves where the anchor differs.

const fs = require('fs');
const path = require('path');
const S = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
function load(name) { return fs.readFileSync(path.join(S, name)); }

// Find end of the UTF-16 "descr_strat.txt" path (anchor). Returns offset just
// AFTER the final 't' of "descr_strat.txt".
function findStratPathEnd(buf) {
  // search for UTF-16 "descr_strat.txt"
  const needle = Buffer.from('d\0e\0s\0c\0r\0_\0s\0t\0r\0a\0t\0.\0t\0x\0t\0', 'binary');
  const idx = buf.indexOf(needle);
  if (idx < 0) return -1;
  return idx + needle.length;
}

const seqs = {
  't0..t7': [
    ['t0', 0, 'save_t0.sav'], ['t1', 1, 'save_t1.sav'], ['t2', 2, 'save_t2.sav'],
    ['t3', 3, 'save_t3.sav'], ['t4', 4, 'save_t4.sav'], ['t5', 5, 'save_t5.sav'],
    ['t6', 6, 'save_t6.sav'], ['t7', 7, 'save_t7.sav'],
  ],
  'arretium': [
    ['Ar-T1', 1, 'save_arretium pre retrained..sav'],
    ['Ar-T2', 2, 'save_arretium retrained turn 2.sav'],
    ['Ar-T3', 3, 'save_arretium turn 3.sav'],
    ['Ar-T4', 4, 'save_arretium turn 4.sav'],
  ],
  'Carthage': [
    ['Ca-T1E', 1, 'save_Autosave   Carthage   Turn 1 End.sav'],
    ['Ca-T2S', 2, 'save_Autosave   Carthage   Turn 2 Start.sav'],
  ],
  'Rome': [
    ['Ro-T2', 2, 'save_Autosave   Republic of Rome   Turn 2.sav'],
    ['Ro-T4E', 4, 'save_Autosave   Republic of Rome   Turn 4 End.sav'],
    ['Ro-T5S', 5, 'save_Autosave   Republic of Rome   Turn 5 Start.sav'],
  ],
  'Dummies': [
    ['Du-T7E', 7, 'save_Autosave   Dummies   Turn 7 End.sav'],
    ['Du-T8S', 8, 'save_Autosave   Dummies   Turn 8 Start.sav'],
  ],
  'cross-T0/T1': [
    ['Macedon', 0, 'save_macedon t0.sav'],
    ['Seleucid', 0, 'save_Seleucids t0.sav'],
    ['Antigonid', 1, 'save_Autosave   Antigonid Kingdom   Turn 1.sav'],
  ],
};

console.log('=== turn counter anchored at (descr_strat path end + delta) ===');
console.log('For t0 we know turn u32 = pathEnd + delta. t0 pathEnd & turn offset:');
const t0 = load('save_t0.sav');
const t0pe = findStratPathEnd(t0);
console.log('  t0 pathEnd = 0x' + t0pe.toString(16) + ', turn offset 0x44e3 -> delta = ' + (0x44e3 - t0pe));
const DELTA = 0x44e3 - t0pe; // delta from path end to turn u32

for (const [setName, list] of Object.entries(seqs)) {
  console.log('\n--- ' + setName + ' ---');
  for (const [tag, expTurn, fn] of list) {
    const buf = load(fn);
    const pe = findStratPathEnd(buf);
    if (pe < 0) { console.log('  ' + tag.padEnd(12) + ' NO descr_strat path (vanilla save) — anchor fails'); continue; }
    const turnOff = pe + DELTA;
    const turn = buf.readUInt32LE(turnOff);
    console.log('  ' + tag.padEnd(12) + ' pathEnd=0x' + pe.toString(16) + ' turnOff=0x' + turnOff.toString(16) +
      ' turn=' + turn + ' expFile=' + expTurn + (turn === expTurn ? ' OK' : (turn === expTurn - 1 ? ' (file-1)' : ' DIFF')));
  }
}

// Decode the full record after path end for t0..t7: turn + the two `fe ff` longs
console.log('\n\n=== Record after path end (t0..t7): u32 fields turnOff-3 .. turnOff+40 ===');
for (const [tag, expTurn, fn] of seqs['t0..t7']) {
  const buf = load(fn);
  const pe = findStratPathEnd(buf);
  const base = pe + DELTA; // turn u32
  const fields = [];
  for (let k = -3; k <= 40; k += 4) {
    fields.push(buf.readInt32LE(base + k));
  }
  console.log('  ' + tag + ' turn=' + buf.readUInt32LE(base) + '  ints[base-3..+40 step4]: ' + fields.join(' '));
}

// Hunt YEAR: imperial campaign starts 270 BC. Turn length in RR imperial = ?
// (vanilla RTW imperial: 2 turns/year early? Actually summer/winter = 2 turns/year,
//  so year decreases by ~ every 2 turns). Look for an int near the turn that
//  tracks 270,269,... or -270 etc. Scan a window after path end across t0..t7
//  for a value with constant negative/large step correlated to turn.
console.log('\n\n=== YEAR hunt: window pathEnd-8 .. pathEnd+400, find field linear in turn ===');
const tb = seqs['t0..t7'].map(([tag, t, fn]) => ({ tag, turn: t, buf: load(fn), pe: findStratPathEnd(load(fn)) }));
const winStart = -8, winEnd = 400;
for (let d = winStart; d <= winEnd; d++) {
  const vals = tb.map(b => b.buf.readInt32LE(b.pe + d));
  // linear in turn? fit slope from t0->t7
  const slope = (vals[7] - vals[0]) / 7;
  if (!Number.isInteger(slope)) continue;
  if (slope === 0) continue;
  if (Math.abs(slope) > 5) continue; // year step small (0.5/1/2 yr per turn)
  let ok = true;
  for (let i = 0; i < 8; i++) if (vals[i] !== vals[0] + slope * i) { ok = false; break; }
  if (!ok) continue;
  // skip the turn counter itself (slope 1, base 0)
  console.log('  pathEnd' + (d >= 0 ? '+' : '') + d + ' (0x' + (tb[0].pe + d).toString(16) + ') slope=' + slope + '  vals=[' + vals.join(',') + ']');
}
