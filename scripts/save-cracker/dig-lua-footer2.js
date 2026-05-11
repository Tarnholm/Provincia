// Session 23: lua footer #2 — extract full counter list with values, categorize.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);

const footerStart = 0x210f4d4;
const counterTableStart = 0x210f56f;
const counterTableEnd = 0x2110a23;

// Lua counter records: each [u32 nameLen × 2][UTF-16LE name][u32 value]
// Actually session 14 said "[u32 nameLen × 2][UTF-16LE name][u32 value]" — but more typically it's
// [u32 nameLen][UTF-16LE name][u32 value]. Let me parse.

function parseLuaCounters(start, end) {
  const records = [];
  let p = start;
  while (p < end - 8) {
    // try [u32 nameLen][N×UTF-16LE chars][u32 value]
    const nameLen = buf.readUInt32LE(p);
    if (nameLen > 0 && nameLen < 100 && p + 4 + nameLen * 2 + 4 <= end) {
      let s = '';
      let valid = true;
      for (let i = 0; i < nameLen; i++) {
        const lo = buf[p + 4 + i*2], hi = buf[p + 4 + i*2 + 1];
        if (hi !== 0 || lo < 0x20 || lo > 0x7e) { valid = false; break; }
        s += String.fromCharCode(lo);
      }
      if (valid) {
        const valOff = p + 4 + nameLen * 2;
        const v = buf.readUInt32LE(valOff);
        const v32f = buf.readFloatLE(valOff);
        records.push({ off: p, name: s, value: v, valueFloat: v32f });
        p = valOff + 4;
        continue;
      }
    }
    p++;
  }
  return records;
}

const recs = parseLuaCounters(counterTableStart, counterTableEnd);
console.log(`Parsed ${recs.length} lua counter records.`);

// Categorize
const cat = {
  factionId: [],
  rebellion: [],
  reformBattle: [],
  reformSettlement: [],
  reformReady: [],
  capital: [],
  setup: [],
  other: []
};
for (const r of recs) {
  if (/^id_/.test(r.name)) cat.factionId.push(r);
  else if (/[Rr]ebellion_/.test(r.name)) cat.rebellion.push(r);
  else if (/_reform_battle_counter$/.test(r.name)) cat.reformBattle.push(r);
  else if (/_reform_settlement/.test(r.name)) cat.reformSettlement.push(r);
  else if (/_reform_ready/.test(r.name) || /_reform$/i.test(r.name) || /Reform/.test(r.name)) cat.reformReady.push(r);
  else if (/capital/.test(r.name)) cat.capital.push(r);
  else if (/setup|game_reloaded|first_time/.test(r.name)) cat.setup.push(r);
  else cat.other.push(r);
}

console.log(`\nCategory counts:`);
for (const [k, v] of Object.entries(cat)) console.log(`  ${k}: ${v.length}`);

console.log(`\n=== id_faction table (first 30, showing value) ===`);
for (const r of cat.factionId.slice(0, 30)) console.log(`  ${r.name.padEnd(30)} = ${r.value}`);
console.log(`  ... (${cat.factionId.length} total)`);

console.log(`\n=== Rebellion counters ===`);
for (const r of cat.rebellion) console.log(`  ${r.name.padEnd(40)} = ${r.value}`);

console.log(`\n=== Reform battle counters (first 20) ===`);
for (const r of cat.reformBattle.slice(0, 20)) console.log(`  ${r.name.padEnd(50)} = ${r.value}`);
console.log(`  ... (${cat.reformBattle.length} total)`);

console.log(`\n=== Reform settlement counters ===`);
for (const r of cat.reformSettlement) console.log(`  ${r.name.padEnd(50)} = ${r.value}`);

console.log(`\n=== Reform "ready" / "Reform" flags ===`);
for (const r of cat.reformReady) console.log(`  ${r.name.padEnd(50)} = ${r.value}`);

console.log(`\n=== Capital ===`);
for (const r of cat.capital) console.log(`  ${r.name.padEnd(40)} = ${r.value}`);

console.log(`\n=== Setup flags ===`);
for (const r of cat.setup) console.log(`  ${r.name.padEnd(40)} = ${r.value}`);

console.log(`\n=== Other ===`);
for (const r of cat.other) console.log(`  ${r.name.padEnd(40)} = ${r.value}`);

// Check footer's first 0x9b bytes for section structure (header + script path)
console.log(`\n=== Footer header 0x210f4d4..0x210f56f (path + section) ===`);
for (let off = 0x210f4d4; off < 0x210f56f; off += 16) {
  const slice = buf.subarray(off, off + 16);
  const hex = slice.toString('hex').match(/.{2}/g).join(' ');
  const ascii = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log(`  0x${off.toString(16)}: ${hex}  ${ascii}`);
}

// (d) Tile-coord trail array starts at 0x2110a24 — count chunks via the chunk-N structure
const tileStart = 0x2110a24;
const tileEnd = 0x21153ae;
console.log(`\n=== Tile-coord trail array 0x${tileStart.toString(16)}..0x${tileEnd.toString(16)} ===`);
let pp = tileStart;
let chunkCount = 0, totalRecords = 0;
let zeroPairChunks = 0, nonzeroPairChunks = 0;
while (pp < tileEnd - 4) {
  const N = buf.readUInt32LE(pp);
  if (N === 0 || N > 1000) break;
  pp += 4;
  for (let i = 0; i < N && pp + 6 <= tileEnd; i++) {
    const selfPtr = buf.readUInt32LE(pp);
    const pairCount = buf.readUInt16LE(pp + 4);
    if (pairCount > 100) { pp = tileEnd; break; }
    pp += 6 + pairCount * 8;
    totalRecords++;
    if (pairCount === 0) zeroPairChunks++; else nonzeroPairChunks++;
  }
  chunkCount++;
}
console.log(`Chunks: ${chunkCount}`);
console.log(`Total records: ${totalRecords}`);
console.log(`  Empty-pair (pairCount=0): ${zeroPairChunks}`);
console.log(`  Non-empty pairs: ${nonzeroPairChunks}`);
