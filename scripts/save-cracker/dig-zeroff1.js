// dig-zeroff1.js — investigate the "zero-padded + ff ff ff ff terminator"
// unclaimed family in zone [0x154aa4d..0x1c91ea0].
//
// Method: dump first/last 128 bytes of each top unknown run; classify the
// preceding record type; scan for ASCII strings.

"use strict";

const fs = require("fs");
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";

const buf = fs.readFileSync(SAVE);

// Top unknowns reported by cover.js (current run, in target zone)
const targets = [
  [0x154aa4d, 0x154cd4c, 8959],
  [0x16cd599, 0x16cf16e, 7125],
  [0x1a31ba5, 0x1a3328c, 5863],
  [0x1978d12, 0x197a2d9, 5575],
  [0x1c91ea0, 0x1c932d9, 5177],
  [0x173e6a4, 0x173fab1, 5133],
  [0x1955be5, 0x1956f3e, 4953],
  [0x190abfd, 0x190bf26, 4905],
  [0x18037ab, 0x1804962, 4535],
];

function hex(b, n) {
  const out = [];
  for (let i = 0; i < n && i < b.length; i++) out.push(b[i].toString(16).padStart(2, "0"));
  return out.join(" ");
}

function asciiStrings(b, off, len, min = 5) {
  const out = [];
  let cur = "";
  let curStart = -1;
  for (let i = 0; i < len; i++) {
    const c = b[off + i];
    const printable = c >= 0x20 && c <= 0x7e;
    if (printable) {
      if (cur === "") curStart = off + i;
      cur += String.fromCharCode(c);
    } else {
      if (cur.length >= min) out.push([curStart, cur]);
      cur = "";
    }
  }
  if (cur.length >= min) out.push([curStart, cur]);
  return out;
}

function countByte(b, off, len, val) {
  let n = 0;
  for (let i = 0; i < len; i++) if (b[off + i] === val) n++;
  return n;
}

// Check tail bytes for ff ff ff ff pattern
function tailFFTerm(b, end) {
  // Look back from end for last 32 bytes of useful info
  const tail = [];
  for (let i = Math.max(0, end - 32); i < end; i++) tail.push(b[i]);
  return tail.map(x => x.toString(16).padStart(2, "0")).join(" ");
}

// Recognise a faction magic ff 0a af f0 / f0 0a af f0
function isFactionMagic(b, p) {
  return (b[p] === 0xff || b[p] === 0xf0) && b[p+1] === 0x0a && b[p+2] === 0xaf && b[p+3] === 0xf0;
}

console.log(`save size = ${buf.length}\n`);

for (const [start, end, size] of targets) {
  console.log(`\n=== unknown [0x${start.toString(16)}..0x${end.toString(16)}) size=${size} ===`);

  // Histogram
  const zeros = countByte(buf, start, size, 0x00);
  const ffs   = countByte(buf, start, size, 0xff);
  const zPct  = (zeros / size * 100).toFixed(1);
  const fPct  = (ffs   / size * 100).toFixed(1);
  console.log(`histogram: 0x00=${zPct}%  0xff=${fPct}%`);

  // First 128 bytes
  console.log(`first 64B: ${hex(buf.slice(start, start + 64), 64)}`);
  console.log(`bytes 64-128: ${hex(buf.slice(start + 64, start + 128), 64)}`);

  // Last 128 bytes
  console.log(`last 64B:  ${hex(buf.slice(end - 64, end), 64)}`);
  console.log(`tail 32B end:  ${tailFFTerm(buf, end)}`);

  // Is the terminator ff ff ff ff?
  const t = buf.readUInt32LE(end - 4);
  console.log(`u32 at end-4 = 0x${t.toString(16)} (ff-terminator: ${t === 0xffffffff})`);

  // 32 B BEFORE the run — what kind of record preceded it?
  const preStart = Math.max(0, start - 64);
  console.log(`64B BEFORE start:  ${hex(buf.slice(preStart, start), 64)}`);
  // Look for nearest faction magic in the 128B before
  let factionMagicAt = -1;
  for (let p = Math.max(0, start - 256); p < start - 3; p++) {
    if (isFactionMagic(buf, p)) { factionMagicAt = p; break; }
  }
  console.log(`nearest ff/f0 0a af f0 in -256B: ${factionMagicAt >= 0 ? "0x" + factionMagicAt.toString(16) + " (delta -" + (start - factionMagicAt) + ")" : "(none)"}`);

  // ASCII strings >= 5 chars
  const strs = asciiStrings(buf, start, size, 5);
  console.log(`ASCII strings (${strs.length}):`);
  for (const [o, s] of strs.slice(0, 20)) {
    console.log(`  0x${o.toString(16)}: "${s}"`);
  }
  if (strs.length > 20) console.log(`  ...and ${strs.length - 20} more`);
}
