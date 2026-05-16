// Sample the 9.5 MB tile-attribute zone (0x00800000..0x01180000) — session 99
// confirmed it's "static map data" but the inventory tool shows it contains
// massive ASCII-rich subzones. Identify what content is there.

const fs = require('fs');

const A = fs.readFileSync('C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav');

const START = 0x00800000;
const END   = 0x01180000;

// Find all length-prefixed ASCIIZ strings
function tryAsciizPstr16(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 4 || lenP1 > 200) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { off, str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

// Find UTF-16 pstr16
function tryUtf16Pstr(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenChars = buf.readUInt16LE(off);
  if (lenChars < 3 || lenChars > 80) return null;
  if (off + 2 + lenChars * 2 > buf.length) return null;
  const chars = [];
  for (let j = 0; j < lenChars; j++) {
    const c = buf.readUInt16LE(off + 2 + j * 2);
    if (c < 0x20 || c > 0x7e) return null;
    chars.push(String.fromCharCode(c));
  }
  return { off, str: chars.join(''), totalLen: 2 + lenChars * 2 };
}

const strings = [];
for (let p = START; p < END - 4; p++) {
  const r = tryAsciizPstr16(A, p);
  if (r && /^[A-Za-z][A-Za-z _0-9/.()-]*$/.test(r.str)) {
    strings.push({ ...r, kind: 'ascii' });
  }
  const r2 = tryUtf16Pstr(A, p);
  if (r2 && /^[A-Z][A-Za-z _0-9/-]*$/.test(r2.str)) {
    strings.push({ ...r2, kind: 'utf16' });
  }
}
console.log('Found ' + strings.length + ' length-prefixed strings in zone (' + ((END-START)/1024/1024).toFixed(1) + ' MB)');

// Categorize: ASCII strings starting with common patterns
const buckets = new Map();
for (const s of strings) {
  let bucket = 'OTHER';
  if (/^merc\s/.test(s.str)) bucket = 'merc unit';
  else if (/^(roman|greek|carthaginian|egyptian|barbarian|celt|eastern|nomad|seleucid|antigonid)/i.test(s.str)) bucket = 'faction-name prefix';
  else if (/\b(town|city|village|settlement|fortress|outpost)\b/i.test(s.str)) bucket = 'settlement class';
  else if (/^[a-z][a-z_]*_(palace|temple|wall|gate|barracks|workshop|forum|mine|farm|port|road|dock|sewers|baths|stables|library|odeon|theatre|amphitheater|hospital|garrison|market|trader|colony|brewery|shipwright|mill|aqueduct|gov\d|mic_\d|gov\d|colony_\d|olive|wine|salted_fish)/i.test(s.str)) bucket = 'building name';
  else if (/^[a-z][a-z_0-9]*_(naked|spearmen|hoplites|cavalry|infantry|peltasts|archers|slingers|swordsmen|nobles|warriors|guards|charioteers|elephants|royal|bodyguards|veterans|heavy|light|levies|leves|aspis|skirmishers|hypaspists|sarissa|companion|hetairoi|ephebes|thureophoroi)$/i.test(s.str)) bucket = 'unit name';
  else if (s.kind === 'utf16') bucket = 'utf16 (region/display)';
  buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
}
console.log('\nBuckets:');
for (const [b, c] of Array.from(buckets.entries()).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + String(c).padStart(5) + '  ' + b);
}

// First 100 strings of each kind
console.log('\n=== First 30 strings ===');
for (const s of strings.slice(0, 30)) {
  console.log('  0x' + s.off.toString(16).padStart(7, '0') + '  (' + s.kind + ') "' + s.str + '"');
}

// Spaced sample
console.log('\n=== Strings at 0x900000, 0xa00000, 0xb00000, 0xc00000, 0xd00000, 0xe00000, 0xf00000, 0x1000000, 0x1100000 ===');
for (const mark of [0x900000, 0xa00000, 0xb00000, 0xc00000, 0xd00000, 0xe00000, 0xf00000, 0x1000000, 0x1100000]) {
  // Find closest string after this offset
  const s = strings.find(s => s.off >= mark);
  if (s) console.log('  at 0x' + s.off.toString(16) + '  (' + s.kind + ') "' + s.str + '"');
}

// Look for section grammar within this zone
let secs = 0;
for (let p = START; p + 4 <= END; p++) {
  if (A.readUInt32LE(p) === p) secs++;
}
console.log('\nSection self-pointers in zone: ' + secs + ' (~1 every ' + Math.round((END-START)/secs) + ' bytes)');
