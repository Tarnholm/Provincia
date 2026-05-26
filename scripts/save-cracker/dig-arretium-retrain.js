// Three Arretium saves around a retrain experiment:
//   PRE  = end of T1, no queue yet
//   QUEUE = end of T1, retrain queued (waiting for end-turn)
//   POST = start of T2, retrain completed
//
// Goal:
//   1. Verify queue insertion in PRE→QUEUE diff (~53 byte block per my prior finding)
//   2. Find which fields changed in QUEUE→POST near Arretium (the unit getting retrained)
//   3. Locate the per-soldier records (weapon/armor/exp/parent_uuid)

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const PRE = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));
const QUEUE = fs.readFileSync(path.join(BASE_R, 'save_arretium queued retrain.sav'));
const POST = fs.readFileSync(path.join(BASE_R, 'save_arretium retrained turn 2.sav'));

console.log('File sizes:');
console.log('  PRE:   ' + PRE.length);
console.log('  QUEUE: ' + QUEUE.length + ' (Δ=' + (QUEUE.length - PRE.length) + ' from PRE)');
console.log('  POST:  ' + POST.length + ' (Δ=' + (POST.length - QUEUE.length) + ' from QUEUE)');

function findUtf16All(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
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

const arrPre = findUtf16All(PRE, 'Arretium');
const arrQueue = findUtf16All(QUEUE, 'Arretium');
const arrPost = findUtf16All(POST, 'Arretium');
console.log('\n"Arretium" positions:');
console.log('  PRE:   ' + arrPre.map(p => '0x' + p.toString(16)).join(', '));
console.log('  QUEUE: ' + arrQueue.map(p => '0x' + p.toString(16)).join(', '));
console.log('  POST:  ' + arrPost.map(p => '0x' + p.toString(16)).join(', '));

// Settlement record name is usually the FIRST occurrence (others are mentions in
// events, character locations, etc.)
const namePre = arrPre[0];
const nameQueue = arrQueue[0];
const namePost = arrPost[0];

// Read stats block to confirm Arretium is what we expect
function readStats(buf, namePos) {
  if (namePos === undefined || namePos < 583) return null;
  return {
    creator: buf.readInt32LE(namePos - 583),
    level: buf.readInt32LE(namePos - 571),
    tax: buf[namePos - 562],
    PO: buf.readInt32LE(namePos - 435),
    income: buf.readInt32LE(namePos - 127),
    population: buf.readInt32LE(namePos - 35),
  };
}

console.log('\nArretium stats block:');
console.log('  PRE:   ', JSON.stringify(readStats(PRE, namePre)));
console.log('  QUEUE: ', JSON.stringify(readStats(QUEUE, nameQueue)));
console.log('  POST:  ', JSON.stringify(readStats(POST, namePost)));

// PRE -> QUEUE diff in Arretium settlement record (-583 to +500 from name)
console.log('\n=== PRE → QUEUE diff in Arretium record (±500 bytes from name) ===');
const dxPreQueue = nameQueue - namePre;
console.log('Arretium name shifted by ' + dxPreQueue + ' bytes (PRE→QUEUE)');
// If shift is 0, we can do direct byte diff
let diffCount = 0;
for (let dx = -700; dx <= 500 && diffCount < 40; dx++) {
  const v1 = PRE[namePre + dx];
  const v2 = QUEUE[nameQueue + dx];
  if (v1 !== v2) {
    console.log('  dx=' + dx.toString().padStart(5) + ': PRE=' + v1 + '  QUEUE=' + v2);
    diffCount++;
  }
}

// QUEUE -> POST diff (the retrain completion)
console.log('\n=== QUEUE → POST diff in Arretium record (±500 bytes from name) ===');
const dxQueuePost = namePost - nameQueue;
console.log('Arretium name shifted by ' + dxQueuePost + ' bytes (QUEUE→POST)');
diffCount = 0;
for (let dx = -700; dx <= 500 && diffCount < 40; dx++) {
  const v1 = QUEUE[nameQueue + dx];
  const v2 = POST[namePost + dx];
  if (v1 !== v2) {
    console.log('  dx=' + dx.toString().padStart(5) + ': QUEUE=' + v1 + '  POST=' + v2);
    diffCount++;
  }
}
