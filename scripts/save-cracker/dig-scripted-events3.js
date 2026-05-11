// Session 26 — Decode rest of scripted-events table beyond named strings.
// Strings end at 0xa8bf5. Where does the 149KB go?
// 0x846d1..0xa8beb = 148762 bytes; strings consume ~2.5KB. Where's the rest?
// Wait — End=0xa8beb. Last string "mausoleum" ends at 0xa8bf5? That's beyond END.
// Re-check bounds.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const START = 0x846d1, END = 0xa8beb;

// Find ALL ASCII strings (not just length-prefixed) by linear scan
const allRuns = [];
let runStart = -1;
for (let o = START; o < END; o++) {
  const b = buf[o];
  if (b >= 0x20 && b <= 0x7e) {
    if (runStart === -1) runStart = o;
  } else {
    if (runStart !== -1 && o - runStart >= 4) {
      const s = buf.toString('latin1', runStart, o);
      allRuns.push({start: runStart, end: o, str: s});
    }
    runStart = -1;
  }
}
if (runStart !== -1 && (END - runStart) >= 4) {
  allRuns.push({start: runStart, end: END, str: buf.toString('latin1', runStart, END)});
}
console.log('Total ASCII runs (>=4 chars):', allRuns.length);
console.log('First 30:');
allRuns.slice(0,30).forEach(r=>console.log('  0x' + r.start.toString(16) + ': "' + r.str + '"'));

// The table is mostly NOT strings — it's metadata records.
// Look at distribution of bytes by offset ranges
// Total = 148762 bytes
// Volcano/eruption/earthquake/flood records are at the START
// 7 wonders appear LATER in the table near the end

// Find offset of last named-string
const named = allRuns.filter(r=>r.str.length >= 5);
console.log('Last 10 named runs:');
named.slice(-10).forEach(r=>console.log('  0x' + r.start.toString(16) + ' "' + r.str + '"'));

// Find where the actual table ends — perhaps the bulk is AFTER the wonder strings
// And contains additional per-event-counter records
const lastNamedEnd = named[named.length-1].end;
console.log('\nLast named run ends at 0x' + lastNamedEnd.toString(16) + ', table END at 0x' + END.toString(16));
console.log('Trailing region: ' + (END - lastNamedEnd) + ' bytes');

// Find where the FIRST named run starts in the table
const firstNamed = named[0];
console.log('First named run starts at 0x' + firstNamed.start.toString(16));
console.log('Leading region: ' + (firstNamed.start - START) + ' bytes');

// IMPORTANT: examine the LEADING bytes before "volcano" (0x846d1..0x846e8)
// And the TRAILING bytes after "mausoleum"
console.log('\n=== Leading bytes 0x846d1..0x84800 (300 bytes) ===');
for (let o = START; o < Math.min(START + 304, END); o += 16) {
  const slice = buf.subarray(o, Math.min(o + 16, END));
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(b=>(b>=0x20&&b<0x7f)?String.fromCharCode(b):'.').join('');
  console.log('  0x' + o.toString(16) + ': ' + hex + '  ' + ascii);
}

// Where is the bulk of the 149KB? Strings occupy ~2.5KB total.
// 146KB of binary records.
// Let me find where the FIRST volcano cluster ends and what follows
let lastVolEnd = 0;
for (const r of named) {
  if (r.str.startsWith('eruption_at') || r.str.startsWith('earthquake_') || r.str.startsWith('flood')) lastVolEnd = r.end;
}
console.log('\nLast volcanic/earthquake/flood string ends at 0x' + lastVolEnd.toString(16));

// Skip past lastVolEnd and dump 256 bytes
console.log('\n=== 256 bytes after last named-event string (0x' + lastVolEnd.toString(16) + ') ===');
for (let o = lastVolEnd; o < Math.min(lastVolEnd + 256, END); o += 16) {
  const slice = buf.subarray(o, Math.min(o + 16, END));
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(b=>(b>=0x20&&b<0x7f)?String.fromCharCode(b):'.').join('');
  console.log('  0x' + o.toString(16) + ': ' + hex + '  ' + ascii);
}

// Now: WHERE does the bulk of 149KB live? Check byte ranges
console.log('\n=== Byte-entropy by 8KB block ===');
for (let block = 0; block < Math.ceil((END-START)/8192); block++) {
  const o0 = START + block*8192;
  const o1 = Math.min(o0 + 8192, END);
  let z = 0, ff = 0, other = 0;
  for (let o = o0; o < o1; o++) {
    if (buf[o]===0) z++;
    else if (buf[o]===0xff) ff++;
    else other++;
  }
  console.log('  0x' + o0.toString(16).padStart(7,'0') + '..0x' + o1.toString(16).padStart(7,'0') + ': zeros=' + z + ' 0xff=' + ff + ' other=' + other);
}

// CRITICAL: maybe most of the 149KB is just 0x00 + 0xff padding, only ~10KB has data
// Where do the "wonder" strings appear in the table? near the end
const wonderRuns = named.filter(r=>['pyramids_and_sphinx','pharos','colossus','temple','statue','gardens','mausoleum'].includes(r.str));
wonderRuns.forEach(r=>console.log('  wonder "' + r.str + '" at 0x' + r.start.toString(16)));

// What about middle of table — is it just padding?
// Print sparse view: every 4KB
console.log('\n=== Bytes at 4KB intervals (8 bytes each) ===');
for (let o = START; o < END; o += 4096) {
  const slice = buf.subarray(o, o + 16);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  0x' + o.toString(16) + ': ' + hex);
}
