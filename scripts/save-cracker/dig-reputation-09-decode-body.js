// dig-reputation-09-decode-body.js
// Decode the vanilla record body so we can (1) identify each faction, and
// (2) understand what +100/+104/+108 and the +124..+158 churn block are.
// Dump rec[0] and rec[7] (the two that flipped war flags) fully as u8 and u32.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const A = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const B = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav'));
const MARKER = 0x39240005;

function findRecs(buf) {
  const out = [];
  for (let i = 0; i + 96 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    let mk = -1;
    for (let o = i + 48; o < Math.min(buf.length - 4, i + 4096); o += 1) {
      if (buf.readUInt32LE(o) === MARKER) { mk = o; break; }
    }
    out.push({ off: i, treasury: buf.readInt32LE(i), marker: mk, p44: buf.readUInt32LE(i+44) });
  }
  return out;
}

const ra = findRecs(A), rb = findRecs(B);

function dumpRec(buf, rec, label) {
  const i = rec.off;
  const end = rec.marker > 0 ? rec.marker : i + 260;
  console.log(`\n############ ${label} @0x${i.toString(16)} treas=${rec.treasury} +44=${rec.p44} marker@+${rec.marker>0?rec.marker-i:'?'} ############`);
  // u32 columns from +44 to marker
  for (let o = 44; o + 4 <= end - i; o += 4) {
    const v = buf.readUInt32LE(i + o);
    const b = [buf[i+o],buf[i+o+1],buf[i+o+2],buf[i+o+3]].map(x=>x.toString(16).padStart(2,'0')).join(' ');
    const small = (v <= 1000) ? `  ==${v}` : '';
    console.log(`  +${String(o).padStart(3)}: ${b}${small}`);
  }
}

// rec[0] is player candidate; rec[7] the war target candidate.
dumpRec(A, ra[0], 'A rec[0]');
dumpRec(B, rb.find(b=>b.treasury===8231), 'B rec[0]');
dumpRec(A, ra[7], 'A rec[7]');
dumpRec(B, rb.find(b=>b.treasury===10385), 'B rec[7]');
