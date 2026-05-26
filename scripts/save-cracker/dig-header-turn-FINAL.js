// dig-header-turn-FINAL.js
// AUTHORITATIVE turn-counter locator + full validation.
// Anchor: UTF-16 "descr_strat.txt" (present in BOTH vanilla and modded saves).
// Layout right after the path chars:
//   <u32 sizePrefix> 0x01 <turn:u32 LE> f2 fe ff ff 02 00 00 00 f2 fe ff ff ...
// turn u32 = (pathEnd) + 5.

const fs = require('fs');
const path = require('path');
const S = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
function load(n) { return fs.readFileSync(path.join(S, n)); }

const STRAT = Buffer.from('d\0e\0s\0c\0r\0_\0s\0t\0r\0a\0t\0.\0t\0x\0t\0', 'binary');
function readTurn(buf) {
  const idx = buf.indexOf(STRAT);
  if (idx < 0) return null;
  const pathEnd = idx + STRAT.length;
  const turnOff = pathEnd + 5;
  if (turnOff + 4 > buf.length) return null;
  // sanity: the 0x01 tag at pathEnd+4, trailer f2 fe ff ff at turnOff+4
  const tagOk = buf[pathEnd + 4] === 0x01;
  const trailerOk = buf[turnOff + 4] === 0xf2 && buf[turnOff + 5] === 0xfe &&
                    buf[turnOff + 6] === 0xff && buf[turnOff + 7] === 0xff;
  return { turnOff, turn: buf.readUInt32LE(turnOff), tagOk, trailerOk, sizePrefix: buf.readUInt32LE(pathEnd) };
}

const everything = [
  ['t0', 0, 'save_t0.sav'], ['t0end', 0, 'save_t0justbeforeturnend.sav'],
  ['t1', 1, 'save_t1.sav'], ['t2', 2, 'save_t2.sav'], ['t3', 3, 'save_t3.sav'],
  ['t4', 4, 'save_t4.sav'], ['t5', 5, 'save_t5.sav'], ['t6', 6, 'save_t6.sav'], ['t7', 7, 'save_t7.sav'],
  ['Sp-T1', 0, 'save_17-05-2026   Spain   Turn 1.sav'],  // manual at turn 1 start -> ctr 0
  ['Sp-T2(auto)', 1, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'],
  ['Sp-T3(auto)', 2, 'save_Autosave   Spain   Turn 3 End.sav'],
  ['Sp-T4(auto)', 3, 'save_Autosave   Spain   Turn 4 Start.sav'],
  ['Ar-T1', 0, 'save_arretium pre retrained..sav'],
  ['Ar-T2(auto)', 1, 'save_arretium retrained turn 2.sav'],
  ['Ar-T3', 2, 'save_arretium turn 3.sav'],
  ['Ar-T4', 3, 'save_arretium turn 4.sav'],
  ['Ca-T1E(auto)', 0, 'save_Autosave   Carthage   Turn 1 End.sav'],
  ['Ca-T2S(auto)', 1, 'save_Autosave   Carthage   Turn 2 Start.sav'],
  ['Ca-T2(auto)', 1, 'save_Autosave   Carthage   Turn 2.sav'],
  ['Ro-T2(auto)', 1, 'save_Autosave   Republic of Rome   Turn 2.sav'],
  ['Ro-T4E(auto)', 3, 'save_Autosave   Republic of Rome   Turn 4 End.sav'],
  ['Ro-T5S(auto)', 4, 'save_Autosave   Republic of Rome   Turn 5 Start.sav'],
  ['Du-T7E(auto)', 6, 'save_Autosave   Dummies   Turn 7 End.sav'],
  ['Du-T8S(auto)', 7, 'save_Autosave   Dummies   Turn 8 Start.sav'],
  ['Du-T8(auto)', 7, 'save_Autosave   Dummies   Turn 8.sav'],
  ['Macedon', 0, 'save_macedon t0.sav'],
  ['Seleucid', 0, 'save_Seleucids t0.sav'],
  ['Antigonid(auto)', 0, 'save_Autosave   Antigonid Kingdom   Turn 1.sav'],
];

console.log('=== AUTHORITATIVE turn counter (descr_strat.txt + 5) ===');
let pass = 0, total = 0;
for (const [tag, expCtr, fn] of everything) {
  const buf = load(fn);
  const r = readTurn(buf);
  total++;
  if (!r) { console.log('  ' + tag.padEnd(16) + ' NO descr_strat.txt'); continue; }
  const ok = r.turn === expCtr;
  if (ok) pass++;
  console.log('  ' + tag.padEnd(16) + ' turnOff=0x' + r.turnOff.toString(16).padStart(5, '0') +
    ' turn=' + r.turn + ' exp=' + expCtr + ' tag01=' + r.tagOk + ' trailer=' + r.trailerOk + (ok ? '  OK' : '  <-- DIFF'));
}
console.log('\nPassed ' + pass + '/' + total + '  (autosaves store the just-completed turn = filename-1)');
