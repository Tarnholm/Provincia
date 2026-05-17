// Verify +456 = income per turn. Per-settlement income in vanilla:
//   Village: 20-100, Town: 100-300, City: 300-1000+
// Also try other promising fields (+360, +500, +536).
// Fix walker to handle more settlements.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

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

function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
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
  settlements.push({ name: readPstr16Utf16(buf, nameOff).str, defSet: ds, nameOff });
}

function walkBuildings(s, nextNameOff) {
  let p = s.defSet + 14 + 61;
  while (p < nextNameOff) {
    const r = readPstr16Asciiz(buf, p);
    if (!r) break;
    if (!/^[a-z_]/.test(r.str) || r.str.length < 4) break;
    p += r.totalLen + 78;
  }
  while (p < buf.length && buf[p] === 0xff) p++;
  return p;
}

const results = [];
for (let i = 0; i < settlements.length; i++) {
  const nextOff = i + 1 < settlements.length ? settlements[i+1].nameOff : buf.length;
  results.push({ ...settlements[i], statsStart: walkBuildings(settlements[i], nextOff) });
}
for (let i = 1; i < results.length; i++) {
  results[i].statsBlockStart = results[i-1].statsStart;
  results[i].statsBlockSize = results[i].nameOff - results[i].statsBlockStart;
  results[i].facId = buf.readUInt32LE(results[i].statsBlockStart);
}

// Anchor on FACT-ID being plausible (0-25), not on block size
const VALID = results.filter(r => r.facId !== undefined && r.facId < 25);
console.log('Valid settlements (fac<25): ' + VALID.length);

// Now also fix: for invalid block sizes, use OFFSET FROM nameOff backwards
// since size = 583 is the most common, assume blockStart = nameOff - 583
const FORCED = results.slice(1).map(r => ({
  ...r,
  forcedStart: r.nameOff - 583,
  forcedFac: buf.readUInt32LE(r.nameOff - 583),
}));
console.log('Forced-583 candidates with fac<25: ' + FORCED.filter(r => r.forcedFac < 25).length);

// Print verification table
const SAMPLES = ['Rome', 'Carthago_Nova', 'Asturica', 'Tarentum', 'Croton', 'Caralis', 'Palma', 'Thapsus',
  'Memphis', 'Athens', 'Capua', 'Lilybaeum', 'Carthage', 'Damascus'];
console.log('\n=== Stats fields by settlement (forced-583 walker) ===');
console.log('settlement       fac  +12 (lvl)  +40        +60 (sml)  +148 (PO)  +220       +360       +456       +548 (POP)');
for (const target of SAMPLES) {
  const s = FORCED.find(x => x.name === target);
  if (!s) { console.log('  ' + target.padEnd(15) + ' [not found]'); continue; }
  if (s.forcedFac >= 25) { console.log('  ' + target.padEnd(15) + ' [bad fac=' + s.forcedFac + ']'); continue; }
  const fields = [12, 40, 60, 148, 220, 360, 456, 548].map(off => buf.readUInt32LE(s.forcedStart + off));
  console.log('  ' + target.padEnd(15) + ' ' + String(s.forcedFac).padStart(3) +
    fields.map(v => '  ' + String(v > 100000 ? '0x' + v.toString(16).slice(-7) : v).padStart(8)).join(''));
}

// Group settlements by faction and look at +148 (public order) distribution
console.log('\n=== Per-faction summary (forced-583 walker) ===');
const byFac = {};
for (const s of FORCED) {
  if (s.forcedFac >= 25) continue;
  if (!byFac[s.forcedFac]) byFac[s.forcedFac] = [];
  byFac[s.forcedFac].push({
    name: s.name,
    pop: buf.readUInt32LE(s.forcedStart + 548),
    po: buf.readUInt32LE(s.forcedStart + 148),
    income: buf.readUInt32LE(s.forcedStart + 456),
  });
}
for (const [fac, sts] of Object.entries(byFac).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
  console.log('  fac=' + fac + ': ' + sts.length + ' settlements');
  for (const s of sts) {
    console.log('    ' + s.name.padEnd(20) + ' pop=' + String(s.pop).padStart(6) + ' PO=' + String(s.po).padStart(4) + ' inc=' + String(s.income).padStart(5));
  }
}
