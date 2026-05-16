// Probe the first vanilla Rome (Imperial Campaign, no mods) save.
// Test all per-campaign offsets and structural patterns from RIS/Alex.

const fs = require('fs');

const PATH = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_17-05-2026   Spain   Turn 1.sav';
const buf = fs.readFileSync(PATH);

console.log('=== Header probe ===');
console.log('Size:', buf.length, '(' + (buf.length / 1024 / 1024).toFixed(2) + ' MB)');
console.log('Magic (u16@0): 0x' + buf.readUInt16LE(0).toString(16) + ' (RIS Remastered = 0x70a, classic = 0x704)');

// Campaign name at 0x3a (Remastered) or 0x36 (classic)
function readPstr16Utf16(buf, off) {
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 60) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x7e) return null;
    chars.push(String.fromCharCode(c));
  }
  return chars.join('');
}
console.log('Campaign name@0x3a:', JSON.stringify(readPstr16Utf16(buf, 0x3a)));

// Test year offsets
console.log('\n=== Year field hunt (vanilla Rome starts year -270) ===');
const yearCandidates = [0x44e7, 0x504, 0x3328, 0x44e3, 0x4400, 0x4500];
for (const off of yearCandidates) {
  if (off + 4 > buf.length) continue;
  const v = buf.readInt32LE(off);
  const u = buf.readUInt32LE(off);
  console.log('  @0x' + off.toString(16) + ': i32=' + v + '  u32=' + u);
}
// Whole-file scan for -270 (= 0xfffffef2)
console.log('\nScan for i32 == -270:');
for (let p = 0; p < 0x5000; p += 4) {
  if (buf.readInt32LE(p) === -270) {
    console.log('  i32@0x' + p.toString(16) + ' = -270 (year candidate)');
  }
}

// Test event counter offsets
console.log('\n=== Event counter hunt ===');
const ctrCandidates = [0x43f8, 0xefd, 0x504];
for (const off of ctrCandidates) {
  if (off + 4 > buf.length) continue;
  console.log('  u32@0x' + off.toString(16) + ' = ' + buf.readUInt32LE(off));
}

// Turn counter candidates
console.log('\n=== Turn counter hunt (Turn 1 → raw value 0) ===');
const turnCandidates = [0x44e3, 0xef9, 0x4500, 0x4400, 0x4480, 0x44a0];
for (const off of turnCandidates) {
  if (off + 4 > buf.length) continue;
  console.log('  u32@0x' + off.toString(16) + ' = ' + buf.readUInt32LE(off));
}

// Major-faction record count (class=100 pattern)
console.log('\n=== Major-faction record count (class=100 at +8 pattern from session 5) ===');
const majors = [];
for (let i = 0; i + 64 < buf.length; i++) {
  if (buf.readUInt32LE(i + 8) !== 100) continue;
  if (buf.readUInt32LE(i + 12) !== 1) continue;
  if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
  if (buf.readUInt32LE(i + 24) !== i + 24) continue;
  if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
  if (buf.readUInt32LE(i + 40) !== i + 40) continue;
  if (buf.readUInt32LE(i + 44) !== 6) continue;
  const regions = buf.readUInt32LE(i + 48);
  if (regions > 200) continue;
  majors.push({ pos: i, treasury: buf.readInt32LE(i), regions });
  i = Math.min(buf.length - 64, i + 92 + 4 * regions);
}
console.log('Found ' + majors.length + ' major-faction records');
for (const m of majors) {
  console.log('  pos=0x' + m.pos.toString(16) + '  treasury=' + m.treasury + '  regions=' + m.regions + '  factionTag=0x' + buf.readUInt32LE(m.pos + 28).toString(16));
}

// Test session-111 hypothesis: player factionTag should appear at 0x3c2a in header
console.log('\n=== Session-111 player-header-entry test ===');
if (majors[0]) {
  const tag = buf.readUInt32LE(majors[0].pos + 28);
  console.log('Major[0] factionTag = 0x' + tag.toString(16));
  // Scan all occurrences in the header zone (0..0x5000)
  console.log('Looking for major[0] factionTag in 0..0x5000:');
  let count = 0;
  for (let p = 0; p + 4 <= 0x5000; p++) {
    if (buf.readUInt32LE(p) === tag) {
      console.log('  found at 0x' + p.toString(16));
      count++;
    }
  }
  console.log('Total in header zone:', count);
}

// Find UTF-16 "Spain" if it appears
function findUtf16(buf, str) {
  const needle = Buffer.from([...str].flatMap(c => [c.charCodeAt(0), 0]));
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(needle, p)) !== -1) { hits.push(p); p++; }
  return hits;
}
console.log('\n=== "Spain" UTF-16 occurrences ===');
console.log('  in vanilla Rome save:', findUtf16(buf, 'Spain').slice(0, 5).map(o => '0x' + o.toString(16)));
console.log('  ASCII "spain":');
let p = 0;
const asc = Buffer.from('spain');
const ascHits = [];
while ((p = buf.indexOf(asc, p)) !== -1) { ascHits.push(p); p++; if (ascHits.length > 5) break; }
console.log('   ', ascHits.slice(0, 5).map(o => '0x' + o.toString(16)));
