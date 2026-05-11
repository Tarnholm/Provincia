// Session 26 — CONFIRMED schema: post-string i32le = signed calendar year (BC negative, CE positive).
// Decode all per-event records: [string][i32 calendar_year][u32 type1][u32 type2][u32 idA][u32 idB][...]

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const START = 0x846d1, END = 0xa8beb;

// Re-enumerate strings
const strings = [];
for (let o = START; o < END - 4; ) {
  const lenP1 = buf.readUInt16LE(o);
  if (lenP1 > 2 && lenP1 < 128 && o + 2 + lenP1 <= END) {
    let s = '', ok = true;
    for (let j = 0; j < lenP1 - 1; j++) {
      const c = buf[o + 2 + j];
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
      s += String.fromCharCode(c);
    }
    if (ok && buf[o + 2 + lenP1 - 1] === 0) {
      strings.push({off: o, str: s, len: lenP1, post: o + 2 + lenP1});
      o += 2 + lenP1;
      continue;
    }
  }
  o++;
}

// Print decoded post-string fields for each NAMED event (not the "volcano"/"eruption" header strings)
// Test hypothesis: post-string = [i32 year][u32 a][u32 b][u32 idA][u32 idB][u32 ...]
console.log('=== Per-event named-string decode: [i32 year][u32 type1][u32 type2][u32 idA][u32 idB] ===');
const namedSet = new Set([
  'eruption_at_etna_140','eruption_at_etna_135','eruption_at_etna_126','eruption_at_etna_122',
  'eruption_at_etna_49','eruption_at_etna_44','eruption_at_etna_36','eruption_at_etna_32',
  'eruption_at_etna_10_20_ce','eruption_at_etna_38_40_ce','eruption_at_etna_generic',
  'eruption_at_methana','eruption_at_vulcano_183','eruption_at_vulcano_126',
  'eruption_at_vulcano_91','eruption_at_ischia_91','eruption_at_santorini_197',
  'eruption_at_santorini_46_ce','earthquake_at_santorini','earthquake_in_rhodes',
  'earthquake_in_iberia','flood_in_rome_241',
  'pyramids_and_sphinx','pharos','colossus','temple','statue','gardens','mausoleum',
]);

let hits = 0, misses = 0;
const decoded = [];
for (const s of strings) {
  if (!namedSet.has(s.str)) continue;
  const o = s.post;
  if (o + 20 > END) continue;
  const year = buf.readInt32LE(o);
  const a = buf.readUInt32LE(o + 4);
  const b = buf.readUInt32LE(o + 8);
  const idA = buf.readUInt32LE(o + 12);
  const idB = buf.readUInt32LE(o + 16);
  decoded.push({str: s.str, year, a, b, idA, idB, off: s.off, post: o});
}

// Verify year matches the name
console.log('Decoded named events:');
const yearFromName = {
  'eruption_at_etna_140': -140, 'eruption_at_etna_135': -135, 'eruption_at_etna_126': -126,
  'eruption_at_etna_122': -122, 'eruption_at_etna_49': -49, 'eruption_at_etna_44': -44,
  'eruption_at_etna_36': -36, 'eruption_at_etna_32': -32,
  'eruption_at_etna_10_20_ce': 10, 'eruption_at_etna_38_40_ce': 38,
  'eruption_at_vulcano_183': -183, 'eruption_at_vulcano_126': -126, 'eruption_at_vulcano_91': -91,
  'eruption_at_ischia_91': -91, 'eruption_at_santorini_197': -197,
  'eruption_at_santorini_46_ce': 46, 'flood_in_rome_241': -241,
};
let yearMatches = 0, yearCheckable = 0;
for (const d of decoded) {
  const expected = yearFromName[d.str];
  let chk = '';
  if (expected !== undefined) {
    yearCheckable++;
    if (d.year === expected) { chk = ' ✓ year-match'; yearMatches++; }
    else chk = ' ✗ (expected year=' + expected + ')';
  }
  console.log('  "' + d.str.padEnd(28) + '" year=' + d.year.toString().padStart(5) + ' a=' + d.a + ' b=' + d.b + ' idA=' + d.idA + ' idB=' + d.idB + chk);
}
console.log('\nYear self-consistency:', yearMatches + '/' + yearCheckable, 'matches');

// Examine the "idA" and "idB" — are these region IDs / settlement IDs?
console.log('\n=== Year+region cross-tab for volcanoes ===');
// Etna is in Sicily; Vulcano + Ischia are Italian islands; Methana is Greece; Santorini is Greek
// If idA / idB are region IDs, etna_xxx all should share the same idA
const etnaRecs = decoded.filter(d=>d.str.startsWith('eruption_at_etna'));
const vulcRecs = decoded.filter(d=>d.str.startsWith('eruption_at_vulcano'));
const santRecs = decoded.filter(d=>d.str.startsWith('eruption_at_santorini') || d.str==='earthquake_at_santorini');
console.log('Etna events: idA values = ' + [...new Set(etnaRecs.map(d=>d.idA))].join(','));
console.log('Etna events: idB values = ' + [...new Set(etnaRecs.map(d=>d.idB))].join(','));
console.log('Vulcano events: idA = ' + [...new Set(vulcRecs.map(d=>d.idA))].join(','));
console.log('Vulcano events: idB = ' + [...new Set(vulcRecs.map(d=>d.idB))].join(','));
console.log('Santorini events: idA = ' + [...new Set(santRecs.map(d=>d.idA))].join(','));
console.log('Santorini events: idB = ' + [...new Set(santRecs.map(d=>d.idB))].join(','));

// Now look at the bytes BEFORE the first named string ("volcano" appears 25 times preceding eruptions)
// "volcano" -> followed by length-prefixed eruption_at_*; that pairing is the header
console.log('\n=== Pre-string "volcano/earthquake/flood" header structure ===');
// First "volcano" is at 0x846e6, preceded by 0x846d1 header
// Examine bytes between strings
const lookup = {};
strings.forEach((s,i)=>lookup[s.off]=i);
strings.forEach((s,i)=>{
  if (i===0) return;
  const prev = strings[i-1];
  const gapStart = prev.off + 2 + prev.len;
  const gapEnd = s.off;
  const gapLen = gapEnd - gapStart;
  if (i<10 || gapLen > 30) {
    const slice = buf.subarray(gapStart, gapEnd);
    const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
    console.log('  prev="' + prev.str + '" -> next="' + s.str + '" gap=' + gapLen + ': ' + hex);
  }
});

// Hex-dump bytes for the 7 wonders
console.log('\n=== 7 wonders: post-string bytes (32) ===');
['pyramids_and_sphinx','pharos','colossus','temple','statue','gardens','mausoleum'].forEach(name=>{
  const s = strings.find(x=>x.str===name);
  if (!s) return;
  const slice = buf.subarray(s.post, Math.min(s.post+32, END));
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  "' + name + '" post=0x' + s.post.toString(16) + ': ' + hex);
});

// Also: bytes before "volcano" at offset 0x846d1 (table-header)
console.log('\n=== Table header (0x846d1..0x846e6 = first 21 bytes before "volcano") ===');
const headerBytes = buf.subarray(0x846d1, 0x846e6);
console.log('  ' + Array.from(headerBytes).map(b=>b.toString(16).padStart(2,'0')).join(' '));
// 02 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00
// Looks like [u32 0x02][u32 0][u32 0x01][u32 0][u32 0]

// Now: the table has 73 strings but only 33 unique, and only ~22 named events.
// The 22 named events probably consume ~22 * 30 bytes = 660 bytes
// The 7 wonders consume the wonder block ~7 * ?
// But the table is 149 KB. Where's the rest?
console.log('\n=== Total table size accounting ===');
console.log('Total bytes:', END - START);
const lastStrEnd = strings[strings.length-1].post + 32;
console.log('Last string end (approx):', '0x' + lastStrEnd.toString(16));
console.log('Bytes after last string:', END - lastStrEnd, '(= ' + ((100*(END-lastStrEnd))/(END-START)).toFixed(1) + '%)');
// Dump first 256 bytes of the post-string tail
console.log('\n=== Bytes after last string (first 256) ===');
for (let o = lastStrEnd; o < Math.min(lastStrEnd + 256, END); o += 16) {
  const slice = buf.subarray(o, Math.min(o + 16, END));
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(b=>(b>=0x20&&b<0x7f)?String.fromCharCode(b):'.').join('');
  console.log('  0x' + o.toString(16) + ': ' + hex + '  ' + ascii);
}
