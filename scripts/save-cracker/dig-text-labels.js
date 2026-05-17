// Search the entire save for ASCII strings that might be field labels:
//   treasury, denarii, income, kings_purse, etc.
// Some game saves store fields with name + value tuples.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

const LABELS = ['treasury', 'denarii', 'income', 'tax', 'wealth', 'gold',
  'purse', 'kings_purse', 'starting_money', 'money', 'farming', 'mining',
  'trade', 'fertility', 'population', 'pop', 'public_order', 'happiness',
  'religion', 'culture', 'reputation', 'rank'];

function findStr(buf, str) {
  const target = Buffer.from(str);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

console.log('=== ASCII label search ===');
for (const label of LABELS) {
  const hits = findStr(buf, label);
  if (hits.length > 0 && hits.length < 30) {
    console.log('  "' + label + '": ' + hits.length + ' hits at ' + hits.slice(0, 8).map(h => '0x' + h.toString(16)).join(', '));
  } else if (hits.length > 0) {
    console.log('  "' + label + '": ' + hits.length + ' hits (showing first 3): ' + hits.slice(0, 3).map(h => '0x' + h.toString(16)).join(', '));
  }
}

// Search the LATE file (past 0x100000) for ASCII strings — different sections
console.log('\n=== ASCII strings in 0x100000..end (4+ chars) ===');
let p = 0x100000;
let hits = 0;
while (p < buf.length && hits < 60) {
  const c = buf[p];
  if (c < 0x20 || c > 0x7e) { p++; continue; }
  let q = p;
  while (q < buf.length && buf[q] >= 0x20 && buf[q] <= 0x7e) q++;
  const len = q - p;
  if (len >= 8) {
    const s = buf.slice(p, q).toString('latin1');
    if (/^[a-zA-Z][a-zA-Z_0-9 ]+$/.test(s)) {
      console.log('  0x' + p.toString(16) + ' (' + len + '): "' + s + '"');
      hits++;
    }
  }
  p = q + 1;
}
