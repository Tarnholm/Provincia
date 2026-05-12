// Check what's at 0xf8465e in all 4 saves. Also check save_4.2 (diplomat moved).

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const files = ['save_1.2.sav', 'save_2.2.sav', 'save_3.2.sav', 'save_4.2.sav'];
const bufs = files.map(f => fs.readFileSync(path.join(SAVE_DIR, f)));

function hexLines(buf, start, end) {
  let out = [];
  for (let p = start; p < end; p += 16) {
    const slice = buf.slice(p, Math.min(end, p+16));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ');
    const ascii = Array.from(slice).map(b => (b>=0x20 && b<0x7f) ? String.fromCharCode(b) : '.').join('');
    out.push(`    0x${p.toString(16).padStart(8,'0')}: ${hex.padEnd(48)} | ${ascii}`);
  }
  return out.join('\n');
}

// save_1.2 has NO queue. save_2.2 has wall queue. save_3.2 has levies queue.
// What's the alignment? Find a stable anchor — the `fc fc fc fc` marker
// at +4 in each record. Then re-align.

// In save_1.2 (no queue), the byte after [4 random bytes] [fc fc fc fc]
// should be the "next" record (just the start of building-chain entries).

// Search for the fc-fc-fc-fc marker preceded by 4 bytes, in each save
function findFCFC(buf) {
  const targets = [];
  for (let p = 0xf84600; p < 0xf84800; p++) {
    if (buf[p]===0xfc && buf[p+1]===0xfc && buf[p+2]===0xfc && buf[p+3]===0xfc) {
      targets.push(p);
    }
  }
  return targets;
}

for (let i = 0; i < bufs.length; i++) {
  console.log(`${files[i]}: fc-fc-fc-fc markers in [0xf84600..0xf84800]: ${findFCFC(bufs[i]).map(p => '0x'+p.toString(16)).join(' ')}`);
}

// Dump 0xf84600..0xf84800 in each save
for (let i = 0; i < bufs.length; i++) {
  console.log(`\n=== ${files[i]} 0xf84600..0xf84740 ===`);
  console.log(hexLines(bufs[i], 0xf84600, 0xf84740));
}
