// Probe how default_set appears in the Rome-dir saves vs Alexander-dir saves.
// The survey's marker `\x0c\x00default_set\x00` matched Alex saves but not the
// macedon t0 / Antigonid Rome-dir saves. Find the actual byte context.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const ALEX_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';

function probe(dir, file) {
  const buf = fs.readFileSync(path.join(dir, file));
  const asciiCount = countAll(buf, Buffer.from('default_set', 'ascii'));
  const markerCount = countAll(buf, Buffer.from('\x0c\x00default_set\x00', 'latin1'));
  console.log(`\n${file}`);
  console.log(`  size=${buf.length}  'default_set' ascii hits=${asciiCount}  '[0c 00]default_set[00]' hits=${markerCount}`);
  // Show context of the first 3 ascii hits
  let p = 0, shown = 0;
  while ((p = buf.indexOf(Buffer.from('default_set', 'ascii'), p)) !== -1 && shown < 3) {
    const pre = Array.from(buf.slice(p - 4, p)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const post = Array.from(buf.slice(p + 11, p + 14)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`  @0x${p.toString(16)}  pre=[${pre}]  "default_set"  post=[${post}]`);
    p++; shown++;
  }
}

function countAll(buf, target) {
  let c = 0, p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) { c++; p++; }
  return c;
}

probe(SAVE_DIR, 'save_macedon t0.sav');
probe(SAVE_DIR, 'save_Autosave   Antigonid Kingdom   Turn 1.sav');
probe(ALEX_DIR, 'save_17-05-2026   Macedon   Turn 1.sav');
