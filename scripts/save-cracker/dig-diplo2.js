// dig-diplo2.js — session 7 follow-up to dig-diplo1.js.
//
// Verifies session 6's 9-byte diplomacy-array hypothesis by walking back from
// the 0xff-filler terminator (instead of session 6's hard-coded +6306 offset).
// Result: the array is 124 records long for Sparta (not 26), and it is NOT
// per-pair diplomatic state — see RESEARCH.md "session 7" for the full retraction.
//
// Outputs the histogram of `state` bytes across many saves so the reader can
// see that within-turn saves (savestartsparta, save_1.x, save_2.x) share an
// identical 124-record array, while turn-boundary saves (save_1turnstart,
// save_1turnchange) carry a different one — i.e. this array is a per-turn-end
// recomputed structure, not a real-time diplomacy state matrix.

const fs = require('fs');
const path = require('path');
const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';

function isValidRec(buf, p) {
  return p + 9 <= buf.length
    && buf[p] <= 7
    && buf[p+4] === 0x04
    && buf[p+5] === 0 && buf[p+6] === 0 && buf[p+7] === 0 && buf[p+8] === 0;
}
function walkBack(buf, end) {
  let c = end - 9;
  while (c >= 0 && isValidRec(buf, c)) c -= 9;
  return c + 9;
}

function analyze(file) {
  const buf = fs.readFileSync(path.join(SAVES, file));
  const o = buf.indexOf(Buffer.from('captain_card_sparta.tga', 'utf8'));
  if (o < 0) return { file, status: 'no-sparta' };
  // Find the terminator: state<=7 + 8x 0xff followed by big 0xff filler
  let term = -1;
  for (let i = o + 5000; i < o + 9000 && i + 100 < buf.length; i++) {
    if (buf[i] > 7) continue;
    if (buf[i+1] !== 0xff || buf[i+8] !== 0xff) continue;
    let ff = 0; for (let j = 0; j < 100; j++) if (buf[i+9+j] === 0xff) ff++;
    if (ff > 80) { term = i; break; }
  }
  if (term < 0) return { file, status: 'no-term' };
  const start = walkBack(buf, term);
  const N = (term - start) / 9;
  const cb = buf[start - 1];
  const hist = {};
  for (let i = 0; i < N; i++) {
    const s = buf[start + i*9];
    hist[s] = (hist[s] || 0) + 1;
  }
  return { file, start: '0x'+start.toString(16), N, countByte: cb, hist };
}

const FILES = [
  'save_savestartsparta.sav',
  'save_1.1.sav',
  'save_1.2.sav',
  'save_1.3.sav',
  'save_2.0.sav',
  'save_2.1.sav',
  'save_2.2.sav',
  'save_Autosave   Sparta   Turn 4 End.sav',
  'save_1turnstart.sav',
  'save_1turnchange.sav',
  'save_rome5..sav',
  'save_rome10.sav',
];
console.log('Sparta-anchor 9-byte stride array across save corpus:');
console.log('=====================================================');
for (const f of FILES) {
  console.log(JSON.stringify(analyze(f)));
}
