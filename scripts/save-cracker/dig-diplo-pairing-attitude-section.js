// dig-diplo-pairing-attitude-section.js
//
// Last check: DIPLOMATIC_ATTITUDE (registry id=1, count=3). Could these 3
// top-level records be a global attitude/relationship matrix that names the
// faction pairs? Locate likely DIPLOMATIC_ATTITUDE records and inspect.
//
// Also confirm the marker count (40) vs FACTION_ECONOMICS count (36) and
// whether 4 extra markers are nested (armies/characters reusing the marker).

const fs = require('fs');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav';
const buf = fs.readFileSync(SAVE);
const DIPLO_MARKER = 0x39240005;

function hex(s){return Array.from(s).map(x=>x.toString(16).padStart(2,'0')).join(' ');}
function ascii(s){return Array.from(s).map(x=>(x>=0x20&&x<0x7f)?String.fromCharCode(x):'.').join('');}

// All diplo markers in whole file with their record-count
const all = [];
for (let p = 0; p < buf.length - 8; p++) {
  if (buf.readUInt32LE(p) === DIPLO_MARKER) {
    const c = buf.readUInt32LE(p + 4);
    if (c <= 400) { all.push({ at: p, count: c }); }
  }
}
console.log('total DIPLO_MARKER occurrences in whole file:', all.length);
// Cluster by 1MB
const byMB = new Map();
for (const m of all) { const k = m.at >>> 20; byMB.set(k, (byMB.get(k)||0)+1); }
console.log('marker distribution by 1MB region:');
for (const [k,c] of [...byMB.entries()].sort((a,b)=>a[0]-b[0])) console.log(`  0x${(k<<20).toString(16)}: ${c}`);

// The marker is generic (used by faction econ AND possibly other records).
// Show the 5 markers OUTSIDE the faction-econ zone (0x1538df0..0x17d0000).
console.log('\n=== Markers outside faction-econ zone ===');
for (const m of all) {
  if (m.at < 0x1538df0 || m.at > 0x17d0000) {
    console.log(`  @0x${m.at.toString(16)} count=${m.count}`);
  }
}

// Inspect bytes around the FIRST few markers in low regions (these may be the
// DIPLOMATIC_ATTITUDE / builder records, not faction econ).
console.log('\n=== Context of first 3 low-region markers ===');
let shown = 0;
for (const m of all) {
  if (m.at > 0x1000000) break;
  console.log(`-- marker @0x${m.at.toString(16)} count=${m.count} --`);
  for (let r = -16; r < 48 + m.count*16 && r < 96; r += 16) {
    const s = buf.slice(m.at + r, m.at + r + 16);
    console.log(`  ${(r<0?'-':'+')}${String(Math.abs(r)).padStart(2)} ${hex(s).padEnd(48)} ${ascii(s)}`);
  }
  if (++shown >= 3) break;
}
