// Check what character region the +32 byte insert at 0x1504eb9 belongs to.
// Also check whether it's still there in save_1.2 vs save_4.2 (would mean it's a
// post-end-turn AI change or move-related).

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const buf1 = fs.readFileSync(path.join(SAVE_DIR, 'save_1.2.sav'));
const buf2 = fs.readFileSync(path.join(SAVE_DIR, 'save_2.2.sav'));
const buf3 = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));
const buf4 = fs.readFileSync(path.join(SAVE_DIR, 'save_4.2.sav'));

// Find first occurrence of "data/ui/roman/portraits/cards/young/generals/284.tga"
// in each save
const portrait = Buffer.from('data/ui/roman/portraits/cards/young/generals/284.tga');
for (const [name, buf] of [['save_1', buf1], ['save_2', buf2], ['save_3', buf3], ['save_4', buf4]]) {
  const idx = buf.indexOf(portrait);
  console.log(`${name}: '...generals/284.tga' at 0x${idx.toString(16)}`);
}

// In save_4 the portrait is at 0x1504ebf
// Show 256 bytes BEFORE the portrait in all 4 saves
console.log();
const portraitOff = {};
for (const [name, buf] of [['save_1', buf1], ['save_2', buf2], ['save_3', buf3], ['save_4', buf4]]) {
  const idx = buf.indexOf(portrait);
  portraitOff[name] = idx;
}

// In save_1 the portrait is at... let me find it.
// Show bytes [portrait-256..portrait] in each save
for (const [name, buf] of [['save_1', buf1], ['save_4', buf4]]) {
  const idx = portraitOff[name];
  console.log(`\n=== ${name} bytes [0x${(idx-128).toString(16)}..0x${idx.toString(16)}] (immediately before portrait '284.tga') ===`);
  for (let p = idx-128; p < idx; p += 16) {
    const slice = buf.slice(p, Math.min(idx, p+16));
    const hex = Array.from(slice).map(x => x.toString(16).padStart(2,'0')).join(' ');
    const asc = Array.from(slice).map(x => (x>=0x20 && x<0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log(`    0x${p.toString(16).padStart(8,'0')}: ${hex.padEnd(48)} | ${asc}`);
  }
}

// Then identify the diplomat's record. Diplomat in RTW has a character record with
// a name. We don't know the diplomat's name but he could be "Marcus" or any Roman name.
// Roman diplomats use the portraits/diplomats subfolder.
const diplomatPortrait = Buffer.from('data/ui/roman/portraits/cards/young/diplomats');
for (const [name, buf] of [['save_1', buf1], ['save_4', buf4]]) {
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(diplomatPortrait, p)) !== -1) { hits.push(p); p++; }
  console.log(`${name}: diplomat-portrait hits: ${hits.length}: ${hits.map(h => '0x'+h.toString(16)).join(' ')}`);
}
