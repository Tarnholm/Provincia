// dig-section-walker6.js — sample some "unknown" sections to see what they are.

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

function isSection(p, maxEnd) {
  if (p + 8 > maxEnd) return false;
  if (buf.readUInt32LE(p) !== p) return false;
  const sz = buf.readUInt32LE(p + 4);
  if (sz < 16 || p + sz > maxEnd) return false;
  return true;
}
function walkSequential(start, end, max = 100000) {
  const found = [];
  for (let p = start; p + 8 <= end; p += 4) {
    if (!isSection(p, end)) continue;
    found.push({ off: p, size: buf.readUInt32LE(p + 4) });
  }
  found.sort((a, b) => a.off - b.off || b.size - a.size);
  const accepted = [];
  let lastEnd = start;
  for (const s of found) {
    if (s.off < lastEnd) continue;
    accepted.push(s);
    lastEnd = s.off + s.size;
    if (accepted.length >= max) break;
  }
  return accepted;
}

const SB = { off: 0xf88637, size: 16287291 };
const sbKid = walkSequential(SB.off + 8, SB.off + SB.size, 1)[0];
const inner = walkSequential(sbKid.off + 8, sbKid.off + sbKid.size);

// Sample sizes
const sizes = inner.map(s => s.size).sort((a, b) => a - b);
console.log(`Inner section sizes: min=${sizes[0]} max=${sizes[sizes.length-1]} median=${sizes[Math.floor(sizes.length/2)]}`);

// Dump payload of first 5 sections
console.log(`\nFirst 5 inner sections:`);
for (let i = 0; i < 5; i++) {
  const s = inner[i];
  console.log(`  [${i}] @0x${s.off.toString(16)} size=${s.size}`);
  // First 96 bytes of payload
  let bytes = "";
  for (let j = 0; j < Math.min(96, s.size - 8); j++) {
    bytes += buf[s.off + 8 + j].toString(16).padStart(2, '0') + ' ';
  }
  let asc = "";
  for (let j = 0; j < Math.min(96, s.size - 8); j++) {
    const c = buf[s.off + 8 + j];
    asc += (c >= 0x20 && c < 0x7f) ? String.fromCharCode(c) : '.';
  }
  console.log(`    bytes: ${bytes}`);
  console.log(`    ascii: "${asc}"`);
}

// Recurse into largest section to look for settlements
console.log(`\nTop 10 largest inner sections:`);
const top = [...inner].sort((a, b) => b.size - a.size).slice(0, 10);
for (const s of top) {
  const sub = walkSequential(s.off + 8, s.off + s.size, 5000);
  console.log(`  0x${s.off.toString(16)} sz=${s.size} subkids=${sub.length}`);
}

// Look for the "Corfinium" UTF-16LE string and trace it
const corf = Buffer.from("C\x00o\x00r\x00f\x00i\x00n\x00", 'binary');
let p = 0, c = 0;
const corfHits = [];
while ((p = buf.indexOf(corf, p)) >= 0) {
  corfHits.push(p);
  p++;
  c++;
}
console.log(`\n"Corfinium" UTF-16LE hits: ${corfHits.length}`);
for (const h of corfHits.slice(0, 5)) console.log(`  @0x${h.toString(16)}`);

// What section contains 0xf8ad48 (the first one)
const first = corfHits[0];
console.log(`\nFirst "Corfinium" at 0x${first.toString(16)} — searching for owning section:`);
// Walk backwards looking for self-pointer that contains this
for (let back = first; back > first - 4096; back--) {
  if (back % 4) continue;
  if (buf.readUInt32LE(back) === back) {
    const sz = buf.readUInt32LE(back + 4);
    if (sz >= 16 && back + sz > first && back + sz <= buf.length) {
      console.log(`  Containing section: 0x${back.toString(16)} sz=${sz} (Corfinium at relative +${first - back})`);
      break;
    }
  }
}
