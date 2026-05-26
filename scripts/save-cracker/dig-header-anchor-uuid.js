// dig-header-anchor-uuid.js
// (1) Robust turn-counter anchor: examine the structure right before the turn
//     counter in BOTH modded (0x44e3, after descr_strat path) and vanilla
//     (Spain 0xfb0) saves, to find a common preceding marker.
// (2) Decode what 0x04 (so-called campaignUuid) groups: t0+Carthage share it,
//     Macedon+Seleucid share it. What's common to those?
// (3) Decode 0x28-0x2f (genuine per-campaign hash) + 0x30 (timestamp).

const fs = require('fs');
const path = require('path');
const S = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
function load(name) { return fs.readFileSync(path.join(S, name)); }
function dump(buf, start, end) {
  for (let off = start; off < end; off += 16) {
    const len = Math.min(16, end - off);
    const sl = buf.slice(off, off + len);
    const hex = Array.from(sl).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(sl).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log('  0x' + off.toString(16) + ': ' + hex.padEnd(48) + ' |' + asc + '|');
  }
}

// ── PART 1: turn-counter neighborhood, modded vs vanilla ──
console.log('=== Turn counter neighborhood ===');
console.log('\n-- t0 (modded), turn u32 @ 0x44e3, show 0x44d8..0x4500 --');
dump(load('save_t0.sav'), 0x44d8, 0x4500);
console.log('\n-- Spain-T1 (vanilla), turn u32 @ 0xfb0, show 0xfa0..0xfd0 --');
dump(load('save_17-05-2026   Spain   Turn 1.sav'), 0xfa0, 0xfd0);

// In both, what precedes the turn? Look for a stable preceding u32 marker.
// modded: bytes at 0x44e0 = `00 00 01 00 00 00 00` -> the `01 00 00 00` at 0x44e2? then turn at +1?
// Actually turn u32 is at 0x44e3. Byte at 0x44e2 = 01. Let's check what's at turn-4..turn-1 in both.
console.log('\nBytes turn-8..turn+8:');
const tm = load('save_t0.sav'); const tv = load('save_17-05-2026   Spain   Turn 1.sav');
console.log('  t0   :', Array.from(tm.slice(0x44e3 - 8, 0x44e3 + 8)).map(x => x.toString(16).padStart(2, '0')).join(' '));
console.log('  Spain:', Array.from(tv.slice(0xfb0 - 8, 0xfb0 + 8)).map(x => x.toString(16).padStart(2, '0')).join(' '));

// ── PART 2: what does 0x04 group? ──
console.log('\n\n=== 0x04 grouping analysis ===');
const all = [
  ['t0',        'save_t0.sav'],
  ['t0end',     'save_t0justbeforeturnend.sav'],
  ['Carthage',  'save_Autosave   Carthage   Turn 1 End.sav'],
  ['Macedon',   'save_macedon t0.sav'],
  ['Seleucid',  'save_Seleucids t0.sav'],
  ['Spain',     'save_17-05-2026   Spain   Turn 1.sav'],
  ['Arretium',  'save_arretium pre retrained..sav'],
  ['Rome',      'save_Autosave   Republic of Rome   Turn 2.sav'],
  ['Antigonid', 'save_Autosave   Antigonid Kingdom   Turn 1.sav'],
];
console.log('save        0x04(uuid)   0x28-2f(hash)              0x30(ts)     0x14   0x18');
for (const [tag, fn] of all) {
  const b = load(fn);
  const u04 = b.readUInt32LE(0x04).toString(16).padStart(8, '0');
  const h28 = Array.from(b.slice(0x28, 0x30)).map(x => x.toString(16).padStart(2, '0')).join('');
  const ts = b.readUInt32LE(0x30);
  const tsDate = new Date(ts * 1000).toISOString();
  console.log('  ' + tag.padEnd(10) + ' ' + u04 + '  ' + h28 + '  ' + ts + ' (' + tsDate + ')');
}

// Hypothesis: 0x04 = a hash of the mod/content set (so vanilla-modded campaigns
// from the same descr_strat share it). t0+Carthage share -> same mod setup?
// Macedon+Seleucid share -> same mod setup (RIS?). Print which have descr_strat mod path.
console.log('\n0x04 vs mod-path presence:');
for (const [tag, fn] of all) {
  const b = load(fn);
  const hasPath = b.indexOf(Buffer.from('d\0e\0s\0c\0r\0_\0s\0t\0r\0a\0t\0', 'binary')) >= 0;
  const modName = (() => {
    // mod display name pstr16 at ~0x326d
    const off = 0x326d;
    const n = b.readUInt16LE(off);
    if (n < 2 || n > 200) return '(none)';
    let s = '';
    for (let i = 0; i < n; i++) { const c = b[off + 2 + i * 2]; if (c < 0x20 || c > 0x7e) return '(bin)'; s += String.fromCharCode(c); }
    return s;
  })();
  console.log('  ' + tag.padEnd(10) + ' 0x04=' + b.readUInt32LE(0x04).toString(16).padStart(8, '0') + '  hasStratPath=' + hasPath + '  modDisplay@0x326d="' + modName + '"');
}
