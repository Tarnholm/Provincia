// Session 28: Enumerate UTF-16LE strings in body-root preamble [0x3b99..0x51b5].
// One-shot dump-and-classify. No hypotheses.

const fs = require('fs');
const path = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(path);

const START = 0x3b99;
const END   = 0x51b5;
const slice = buf.subarray(START, END);

// Scan for UTF-16LE printable runs (every other byte == 0, low byte is printable ASCII).
const strings = [];
let i = 0;
while (i < slice.length - 1) {
  // Find start of a run
  let runStart = i;
  let chars = [];
  while (i < slice.length - 1) {
    const lo = slice[i];
    const hi = slice[i + 1];
    if (hi !== 0) break;
    if (lo < 0x20 || lo > 0x7e) break;
    chars.push(String.fromCharCode(lo));
    i += 2;
  }
  if (chars.length >= 3) {
    strings.push({ off: START + runStart, len: chars.length, s: chars.join('') });
  } else {
    i = runStart + 1; // advance one byte
  }
}

// Print all (no dedup — offsets matter), but mark duplicates by tag.
console.log(`block: 0x${START.toString(16)}..0x${END.toString(16)}  (${END - START} bytes)`);
console.log(`raw string count: ${strings.length}`);
console.log('---');
const seen = new Map();
for (const r of strings) {
  const dup = seen.has(r.s);
  seen.set(r.s, (seen.get(r.s) || 0) + 1);
  console.log(`0x${r.off.toString(16).padStart(4,'0')}  len=${String(r.len).padStart(3)}  ${dup ? '[dup]' : '     '}  ${JSON.stringify(r.s)}`);
}
console.log('---');
console.log('distinct strings: ' + seen.size);
console.log('---');
// Simple classification heuristics
const factionNames = ['romans_julii','romans_brutii','romans_scipii','romans_senate','egypt','seleucid','carthage','parthia','gauls','germans','britons','spain','dacia','thrace','macedon','greek_cities','pontus','armenia','numidia','scythia','slave','saka','sparta','romans'];
const classified = { faction: [], script: [], lua: [], other: [] };
for (const s of seen.keys()) {
  const sl = s.toLowerCase();
  if (factionNames.some(f => sl === f || sl.startsWith(f))) classified.faction.push(s);
  else if (sl.endsWith('.lua') || sl.startsWith('lua_')) classified.lua.push(s);
  else if (sl.includes('script') || sl.startsWith('console_')) classified.script.push(s);
  else classified.other.push(s);
}
console.log('faction-name hits: ' + JSON.stringify(classified.faction));
console.log('lua-ish hits:      ' + JSON.stringify(classified.lua));
console.log('script-ish hits:   ' + JSON.stringify(classified.script));
console.log('other (first 60):  ' + JSON.stringify(classified.other.slice(0,60)));
