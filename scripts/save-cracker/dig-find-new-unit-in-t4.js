// Find "aor etruscan spearmen" in T4 (where the unit was recruited)
// and look at its soldier records.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T2_QUEUE = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 2 new unit queued.sav'));
const T3 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 3.sav'));
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

function findAllAscii(buf, str) {
  const target = Buffer.from(str + '\0', 'ascii');
  const positions = [];
  let p = 0;
  while (true) {
    const idx = buf.indexOf(target, p);
    if (idx === -1) break;
    positions.push(idx);
    p = idx + 1;
  }
  return positions;
}

function findAscii(buf, str) { return findAllAscii(buf, str); }

const target = 'aor etruscan spearmen';
const t2Hits = findAscii(T2_QUEUE, target);
const t3Hits = findAscii(T3, target);
const t4Hits = findAscii(T4, target);

console.log('"aor etruscan spearmen" hits:');
console.log('  T2_QUEUE: ' + t2Hits.length + ' @ [' + t2Hits.map(p => '0x' + p.toString(16)).join(', ') + ']');
console.log('  T3:       ' + t3Hits.length + ' @ [' + t3Hits.map(p => '0x' + p.toString(16)).join(', ') + ']');
console.log('  T4:       ' + t4Hits.length + ' @ [' + t4Hits.map(p => '0x' + p.toString(16)).join(', ') + ']');

// Each hit gets context dump
for (const h of t4Hits.slice(0, 5)) {
  console.log('\n=== T4 hit @ 0x' + h.toString(16) + ' (context ±64 bytes) ===');
  for (let j = -32; j <= 64; j += 16) {
    const hex = Array.from(T4.slice(h + j, h + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(T4.slice(h + j, h + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    const mark = j === 0 ? '  ← string start' : '';
    console.log('  ' + (j >= 0 ? '+' : '') + j.toString().padStart(4) + ': ' + hex + '  |' + ascii + '|' + mark);
  }
}

// Find ALL the bodyguard unit UUID references (e4 3d 21 89) in T4
const uuid = Buffer.from([0xe4, 0x3d, 0x21, 0x89]);
const t4UuidHits = [];
let p = 0;
while (true) {
  const idx = T4.indexOf(uuid, p);
  if (idx === -1) break;
  t4UuidHits.push(idx);
  p = idx + 1;
}
console.log('\nUUID e4 3d 21 89 hits in T4: ' + t4UuidHits.length);
for (const h of t4UuidHits.slice(0, 10)) console.log('  0x' + h.toString(16));
