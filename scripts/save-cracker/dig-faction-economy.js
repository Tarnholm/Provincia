// Sum per-settlement income per faction. Use that to estimate faction
// total income and infer where treasury might be.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));
const T_FILES = {};
for (const f of allFiles) {
  for (const t of [1, 2, 3, 4]) {
    if (f.includes('Turn ' + t)) {
      if (!T_FILES[t]) T_FILES[t] = fs.readFileSync(path.join(BASE, f));
      break;
    }
  }
}
const buf = T_FILES[4];

function readPstr16Utf16(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x024F) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

function findPstr16Asciiz(buf, str) {
  const len = str.length + 1;
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16LE(len, 0);
  const target = Buffer.concat([prefix, Buffer.from(str + '\0')]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

const defSets = findPstr16Asciiz(buf, 'default_set');
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -50; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16(buf, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  if (nameOff === -1) continue;
  const statsStart = nameOff - 583;  // forced
  const fac = buf.readUInt32LE(statsStart);
  if (fac >= 25) continue;
  settlements.push({
    name: readPstr16Utf16(buf, nameOff).str,
    fac,
    pop: buf.readUInt32LE(statsStart + 548),
    po: buf.readUInt32LE(statsStart + 148),
    inc: buf.readUInt32LE(statsStart + 456),
  });
}

console.log('Valid settlements: ' + settlements.length);

// Per-faction summary
const byFac = {};
for (const s of settlements) {
  if (!byFac[s.fac]) byFac[s.fac] = { count: 0, totalPop: 0, totalInc: 0, settlements: [] };
  byFac[s.fac].count++;
  byFac[s.fac].totalPop += s.pop;
  byFac[s.fac].totalInc += s.inc;
  byFac[s.fac].settlements.push(s.name);
}

console.log('\n=== Per-faction economy ===');
console.log('fac  count  totalPop  totalInc  settlements');
for (const [fac, data] of Object.entries(byFac).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
  console.log('  ' + String(fac).padStart(2) + '   ' + String(data.count).padStart(3) + '   ' +
    String(data.totalPop).padStart(7) + '   ' + String(data.totalInc).padStart(6) + '   ' + data.settlements.slice(0, 4).join(', ') + (data.settlements.length > 4 ? '...' : ''));
}

// Spain's income — should generate ~1927/turn (4 settlements)
// Over 3 turns (T1→T4) Spain accumulates ~5781 denarii (before upkeep)
// Plus starting 5000 = ~10781 with no upkeep
// Net actual treasury at T4 should be around 5000-8000 (after upkeep + spending)

const spainData = byFac[18];
console.log('\n=== Spain economy ===');
console.log('Settlements: ' + spainData.count);
console.log('Total population: ' + spainData.totalPop);
console.log('Total income/turn: ' + spainData.totalInc);
console.log('Estimated treasury at T4: 5000 + (3 × ' + spainData.totalInc + ') - upkeep - spending ≈ ' + (5000 + 3 * spainData.totalInc - 3000) + ' (rough guess)');

// Search file for u32 values close to estimated treasury
const targetVals = [];
for (let v = 3000; v <= 12000; v += 100) targetVals.push(v);

console.log('\n=== Searching file for u32 in 3000-12000 range that VARIES across T1→T4 ===');
const len = Math.min(...Object.values(T_FILES).map(b => b.length));
const candidates = [];
for (let off = 0x100; off < len - 4; off += 4) {
  const vals = [1, 2, 3, 4].map(t => T_FILES[t].readUInt32LE(off));
  if (new Set(vals).size === 1) continue;
  if (vals.some(v => v < 3000 || v > 15000)) continue;
  if (vals.every(v => v % 256 === 0)) continue;
  // Skip fixed-point coords
  if (vals.every(v => v % 64 === 0)) continue;
  candidates.push({ off, vals });
}
console.log('Found ' + candidates.length + ' candidates');
// Sort by smallest Δ
candidates.sort((a, b) => {
  const dA = Math.max(...a.vals) - Math.min(...a.vals);
  const dB = Math.max(...b.vals) - Math.min(...b.vals);
  return dA - dB;
});
for (const c of candidates.slice(0, 20)) {
  console.log('  u32@0x' + c.off.toString(16) + ': [' + c.vals.join(', ') + '] Δ=' + (Math.max(...c.vals) - Math.min(...c.vals)));
}
