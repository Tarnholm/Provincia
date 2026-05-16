// Session 110 follow-up — scan for ALL companion-metadata records.
//
// At 0x01536440 in the halo save we found:
//   +0    u32 = 0xef (239)              ← record-type marker
//   +4    u32 = character UUID
//   +0x18 u16 = strlen N of ASCIIZ class name
//   +0x1a ASCIIZ class string ("roman general")
//   ... gap with embedded UUIDs + a u32 Y coord ...
//   pstr16 UTF-16 region name ("Latium")
//   trailing 0xff 0xff 0xff 0xff + repeated character UUID
//
// Goal: find every such record in the halo save AND the 14 fixture saves;
// extract { uuid, className, regionName }; estimate hit rate (vs. expected
// character count); report any saves where the pattern doesn't hold.

const fs = require('fs');
const path = require('path');

const SAVES = [
  { tag: 'halo_oneman', path: 'C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav' },
  { tag: 'halo_moved',  path: 'C:\\Users\\vtarn\\Downloads\\save_halo_moved.sav..sav' },
];
const FIX = 'C:\\dev\\Provincia\\scripts\\save-cracker\\fixtures\\feral\\';
for (const f of fs.readdirSync(FIX)) {
  if (f.endsWith('.sav')) SAVES.push({ tag: f.replace(/\.sav$/, ''), path: path.join(FIX, f) });
}

function tryReadAsciizPstr16(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 80) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}
function tryReadUtf16Pstr(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenChars = buf.readUInt16LE(off);
  if (lenChars < 2 || lenChars > 60) return null;
  if (off + 2 + lenChars * 2 > buf.length) return null;
  const chars = [];
  for (let j = 0; j < lenChars; j++) {
    const c = buf.readUInt16LE(off + 2 + j * 2);
    if (c < 0x20 || c > 0x7e) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + lenChars * 2 };
}

function findMetadataRecords(buf) {
  // Scan for the `ef 00 00 00 <uuid>` pattern, then walk forward parsing
  // the ASCIIZ class name and looking for a UTF-16 region name within
  // ~80 bytes of the class string.
  const out = [];
  for (let i = 0; i < buf.length - 64; i++) {
    if (buf.readUInt32LE(i) !== 0xef) continue;
    const uuid = buf.readUInt32LE(i + 4);
    if (!uuid || uuid === 0xffffffff) continue;
    // Look for ASCIIZ pstr16 in window i+0x10..i+0x40 (variable due to padding)
    let classStr = null, classEnd = -1;
    for (let p = i + 0x10; p < i + 0x40 && p + 2 < buf.length; p++) {
      const r = tryReadAsciizPstr16(buf, p);
      if (r && r.str.length > 3 && r.str.length < 50 &&
          /^[a-z][a-z _0-9]*[a-z0-9]$/i.test(r.str)) {
        classStr = r.str;
        classEnd = p + r.totalLen;
        break;
      }
    }
    if (!classStr) continue;
    // Look for UTF-16 pstr in window classEnd..classEnd+80
    let regionStr = null;
    for (let p = classEnd; p < classEnd + 80 && p + 2 < buf.length; p++) {
      const r = tryReadUtf16Pstr(buf, p);
      if (r && r.str.length > 2 && r.str.length < 40 &&
          /^[A-Z][A-Za-z _0-9-]*$/.test(r.str)) {
        regionStr = r.str;
        break;
      }
    }
    out.push({ off: i, uuid: '0x' + uuid.toString(16).padStart(8, '0'), className: classStr, regionName: regionStr });
  }
  return out;
}

// Run across all saves
console.log('Scanning', SAVES.length, 'saves for metadata records (ef 00 00 00 + uuid pattern)...\n');
const summary = [];
for (const s of SAVES) {
  if (!fs.existsSync(s.path)) {
    console.log('SKIP', s.tag, '(not found:', s.path + ')');
    continue;
  }
  const buf = fs.readFileSync(s.path);
  const recs = findMetadataRecords(buf);
  const withRegion = recs.filter(r => r.regionName).length;
  const classes = new Set(recs.map(r => r.className));
  const regions = new Set(recs.filter(r => r.regionName).map(r => r.regionName));
  summary.push({ tag: s.tag, total: recs.length, withRegion, classCount: classes.size, regionCount: regions.size });
  console.log(s.tag.padEnd(22), 'total=' + String(recs.length).padStart(4),
              'w/region=' + String(withRegion).padStart(4),
              'classes=' + classes.size, 'regions=' + regions.size);
  if (s.tag === 'halo_oneman' || s.tag === 'save_10_fresh') {
    console.log('  Sample records (first 5):');
    for (const r of recs.slice(0, 5)) {
      console.log('    0x' + r.off.toString(16) + ' uuid=' + r.uuid + ' class="' + r.className + '" region=' + (r.regionName ? '"' + r.regionName + '"' : 'null'));
    }
    if (recs.length > 5) {
      console.log('  Sample records (last 3):');
      for (const r of recs.slice(-3)) {
        console.log('    0x' + r.off.toString(16) + ' uuid=' + r.uuid + ' class="' + r.className + '" region=' + (r.regionName ? '"' + r.regionName + '"' : 'null'));
      }
    }
    // Class histogram
    const classHist = {};
    for (const r of recs) classHist[r.className] = (classHist[r.className] || 0) + 1;
    const sorted = Object.entries(classHist).sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log('  Top classes:');
    for (const [k, v] of sorted) console.log('    ' + v + '× ' + k);
  }
}

console.log('\n=== Summary ===');
console.log('save'.padEnd(22) + ' total  w/region  classes  regions');
for (const s of summary) {
  console.log(s.tag.padEnd(22) + ' ' + String(s.total).padStart(5) + '  ' +
              String(s.withRegion).padStart(8) + '  ' + String(s.classCount).padStart(7) + '  ' + String(s.regionCount).padStart(7));
}
