// dig-header-cross.js
// Since 0x00-0x500 is STATIC per campaign (no per-turn variation), classify
// cross-campaign differences to find campaign-config / player-faction fields.
// Also: where does the TURN/YEAR counter actually live? Scan the body for a
// u32 that increments by 1 across t0..t7.

const fs = require('fs');
const path = require('path');
const S = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
function load(name) { return fs.readFileSync(path.join(S, name)); }

const cross = [
  ['t0',        'save_t0.sav'],            // player faction = ? (julii? known via descr_strat)
  ['Spain',     'save_17-05-2026   Spain   Turn 1.sav'],
  ['Macedon',   'save_macedon t0.sav'],
  ['Seleucid',  'save_Seleucids t0.sav'],
  ['Rome',      'save_Autosave   Republic of Rome   Turn 2.sav'],
  ['Carthage',  'save_Autosave   Carthage   Turn 1 End.sav'],
  ['Antigonid', 'save_Autosave   Antigonid Kingdom   Turn 1.sav'],
];
const bufs = cross.map(([tag, fn]) => ({ tag, buf: load(fn) }));

const LIMIT = 0x500;
console.log('=== Cross-campaign VARYING bytes 0x00-0x500 ===');
console.log('tags: ' + bufs.map(b => b.tag).join(' | '));
for (let off = 0; off < LIMIT; off++) {
  const vals = bufs.map(b => off < b.buf.length ? b.buf[off] : -1);
  if (new Set(vals).size > 1) {
    console.log('  0x' + off.toString(16).padStart(3, '0') + ': ' + vals.map(x => x.toString(16).padStart(2, '0')).join(' '));
  }
}

// u32 view of the varying region (aligned), to spot UUIDs/ids
console.log('\n=== Cross-campaign u32 (LE) view 0x00-0x60 (aligned) ===');
for (let off = 0; off < 0x60; off += 4) {
  const vals = bufs.map(b => b.buf.readUInt32LE(off));
  const tag = new Set(vals).size > 1 ? ' *VAR*' : '';
  console.log('  0x' + off.toString(16).padStart(2, '0') + ': ' + vals.map(v => '0x' + v.toString(16).padStart(8, '0')).join(' ') + tag);
}

// Faction-config region: where does the player faction id live? The 53-byte
// faction-config records start at the 12 34 de 0a marker. Player faction is
// known: t0=Julii (vanilla imperial campaign default), Spain=spain,
// Macedon=macedon, Seleucid=seleucid, Rome=romans (some), Carthage=carthage,
// Antigonid=antigonid. Find a byte in 0x60..marker or in records that == player idx.
console.log('\n\n=== Faction-config marker + surrounding region per campaign ===');
const MK = Buffer.from([0x12, 0x34, 0xde, 0x0a]);
for (const b of bufs) {
  const nameLen = b.buf.readUInt16LE(0x3a);
  const nameEnd = 0x3c + nameLen * 2;
  const first = b.buf.indexOf(MK);
  const fc = b.buf.readUInt32LE(first + 4); // faction count
  console.log('\n--- ' + b.tag + ' (nameEnd=0x' + nameEnd.toString(16) + ', firstMarker=0x' + first.toString(16) + ', factionCount=' + fc + ') ---');
  // dump bytes from nameEnd to first marker (the gap)
  const gapHex = Array.from(b.buf.slice(nameEnd, first)).map(x => x.toString(16).padStart(2, '0')).join(' ');
  console.log('  gap nameEnd..marker: ' + gapHex);
}
