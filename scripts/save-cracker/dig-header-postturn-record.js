// dig-header-postturn-record.js
// Decode the record AFTER the turn counter (the "campaign date / options" block)
// and the fixed header fields 0x08-0x20, to label difficulty / seed / options.
// Compare across campaigns to separate constants from config.

const fs = require('fs');
const path = require('path');
const S = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
function load(n) { return fs.readFileSync(path.join(S, n)); }

const STRAT = Buffer.from('d\0e\0s\0c\0r\0_\0s\0t\0r\0a\0t\0.\0t\0x\0t\0', 'binary');
function turnOffOf(buf) { const i = buf.indexOf(STRAT); return i < 0 ? -1 : i + STRAT.length + 5; }

const saves = [
  ['t0', 'save_t0.sav'],
  ['Spain', 'save_17-05-2026   Spain   Turn 1.sav'],
  ['Macedon', 'save_macedon t0.sav'],
  ['Seleucid', 'save_Seleucids t0.sav'],
  ['Rome', 'save_Autosave   Republic of Rome   Turn 2.sav'],
  ['Carthage', 'save_Autosave   Carthage   Turn 1 End.sav'],
  ['Antigonid', 'save_Autosave   Antigonid Kingdom   Turn 1.sav'],
];
const bufs = saves.map(([tag, fn]) => ({ tag, buf: load(fn), to: turnOffOf(load(fn)) }));

console.log('=== Post-turn record: u32 fields turnOff+4 .. turnOff+120 (cross-campaign) ===');
console.log('   (turn u32 is at turnOff; we list following u32s to find date/options)');
for (let k = 4; k <= 120; k += 4) {
  const vals = bufs.map(b => b.buf.readInt32LE(b.to + k));
  const uniq = new Set(vals.map(v => v >>> 0));
  const tag = uniq.size > 1 ? ' *VAR*' : '';
  console.log('  +' + k.toString().padStart(3) + ': ' + vals.map(v => (v >>> 0).toString(16).padStart(8, '0')).join(' ') + tag);
}

// Fixed header fields 0x08-0x20: are 0x14/0x18 (=0x400) and others constant?
console.log('\n=== Header fixed fields 0x08-0x24 (cross-campaign) ===');
for (let off = 0x08; off < 0x24; off += 4) {
  const vals = bufs.map(b => b.buf.readUInt32LE(off));
  const tag = new Set(vals).size > 1 ? ' *VAR*' : ' (const)';
  console.log('  0x' + off.toString(16) + ': ' + vals.map(v => '0x' + v.toString(16).padStart(8, '0')).join(' ') + tag);
}

// Difficulty: campaign + battle difficulty are usually small ints (0-4). They are
// chosen at new-game and constant per campaign. Search the post-turn record window
// (turnOff .. turnOff+400) for bytes in 0..4 that differ across campaigns
// (different players may pick different difficulty — these t0 saves are all RIS
// from the user; may all be same difficulty though). Just list small-int bytes.
console.log('\n=== Small-int (0..5) bytes in turnOff+8 .. turnOff+300 that VARY across campaigns (difficulty candidates) ===');
let n = 0;
for (let k = 8; k <= 300; k++) {
  const vals = bufs.map(b => b.buf[b.to + k]);
  if (vals.some(v => v > 5)) continue;
  if (new Set(vals).size === 1) continue;
  n++;
  if (n <= 40) console.log('  +' + k + ': ' + vals.map((v, i) => bufs[i].tag.slice(0, 3) + '=' + v).join(' '));
}
console.log('Total varying small-int bytes in window: ' + n);
