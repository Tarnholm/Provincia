// Comprehensive header decoder. Walk every known and suspected field.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const saves = [
  { name: 'PRE',       path: path.join(BASE_R, 'save_arretium pre retrained..sav') },
  { name: 'QUEUE',     path: path.join(BASE_R, 'save_arretium queued retrain.sav') },
  { name: 'POST',      path: path.join(BASE_R, 'save_arretium retrained turn 2.sav') },
  { name: 'Spain-T1',  path: path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav') },
  { name: 'Alex-T1',   path: path.join(BASE_A, 'save_17-05-2026   Macedon   Turn 1.sav') },
];

const bufs = saves.map(s => ({ name: s.name, buf: fs.readFileSync(s.path) }));

function readPstr16UTF16(buf, off) {
  if (off + 2 > buf.length) return null;
  const chars = buf.readUInt16LE(off);
  if (chars < 1 || chars > 500) return null;
  if (off + 2 + chars * 2 > buf.length) return null;
  let s = '';
  for (let i = 0; i < chars; i++) {
    const lo = buf[off + 2 + i * 2], hi = buf[off + 2 + i * 2 + 1];
    if (hi !== 0 || lo < 0x09) return null;
    if (lo > 0x7e) return null;
    s += String.fromCharCode(lo);
  }
  return { str: s, totalLen: 2 + chars * 2 };
}

function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 500) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

// Decode every save's header step by step
for (const b of bufs) {
  console.log('\n========================================');
  console.log('  SAVE: ' + b.name + ' (size ' + b.buf.length + ')');
  console.log('========================================');

  const buf = b.buf;

  // 1. Magic
  console.log('Magic @0x00: 0x' + buf.readUInt32LE(0).toString(16).padStart(8, '0') + ' (expected 0x0000070a)');

  // 2. 4-byte field at +4 — campaign UUID?
  console.log('Field @0x04: 0x' + buf.readUInt32LE(4).toString(16).padStart(8, '0') + ' (campaign instance UUID — same across saves of same campaign)');

  // 3-onwards: walk to find next interesting bytes
  // 0x14, 0x18: 0x0400 each
  console.log('u32 @0x14: ' + buf.readUInt32LE(0x14) + ' (constant 1024)');
  console.log('u32 @0x18: ' + buf.readUInt32LE(0x18) + ' (constant 1024)');
  console.log('u32 @0x1c: 0x' + buf.readUInt32LE(0x1c).toString(16) + ' (flag, varies per campaign type)');
  console.log('u32 @0x20: ' + buf.readUInt32LE(0x20) + ' (save format version 7?)');

  // 0x24, 0x28, 0x2c: 3x u32 hash bytes
  console.log('Hash @0x24..0x2f: ' + Array.from(buf.slice(0x24, 0x30)).map(b => b.toString(16).padStart(2, '0')).join(''));

  // 0x30, 0x34, 0x38: more fields
  console.log('u32 @0x30: 0x' + buf.readUInt32LE(0x30).toString(16) + ' (varies — maybe timestamp?)');
  console.log('u32 @0x34: 0x' + buf.readUInt32LE(0x34).toString(16) + ' (0x0002aa85 in all = 174725)');

  // 0x38: u16 (high half always 0), then 0x3a = campaign-name length
  console.log('u16 @0x38: 0x' + buf.readUInt16LE(0x38).toString(16) + ' (high part)');
  const campLen = buf.readUInt16LE(0x3a);
  console.log('u16 @0x3a: ' + campLen + ' (CAMPAIGN NAME length in chars)');

  // Read campaign name as UTF-16 LE
  let campName = '';
  for (let i = 0; i < campLen; i++) {
    const c = buf.readUInt16LE(0x3c + i * 2);
    campName += String.fromCharCode(c);
  }
  console.log('Campaign @0x3c (UTF-16): "' + campName + '"');

  // After campaign name, the next 16 bytes are CONSTANT
  const afterCamp = 0x3c + campLen * 2;
  console.log('After campaign @0x' + afterCamp.toString(16) + ':');
  console.log('  u32: 0x' + buf.readUInt32LE(afterCamp).toString(16) + ' (likely sentinel 0x80000000 / -∞ float)');
  console.log('  u32: ' + buf.readUInt32LE(afterCamp + 4) + ' (0x140 = 320)');
  console.log('  u32: ' + buf.readUInt32LE(afterCamp + 8));
  console.log('  u32: 0x' + buf.readUInt32LE(afterCamp + 12).toString(16) + ' (looks like another constant)');

  // Now walk forward looking for the next strings (player name, save name, etc.)
  console.log('\nStrings found in 0x60..0x500:');
  let p = afterCamp + 16;
  let found = 0;
  while (p < 0x500 && found < 10) {
    const a = readPstr16Asciiz(buf, p);
    const u = readPstr16UTF16(buf, p);
    if (a && a.str.length >= 3) {
      console.log('  0x' + p.toString(16) + ' ASCIIZ "' + a.str + '" (' + a.str.length + ' chars)');
      p += a.totalLen;
      found++;
      continue;
    }
    if (u && u.str.length >= 3 && /^[\x20-\x7e]+$/.test(u.str)) {
      console.log('  0x' + p.toString(16) + ' UTF-16 "' + u.str + '" (' + u.str.length + ' chars)');
      p += u.totalLen;
      found++;
      continue;
    }
    p++;
  }
}

// Now do the same for the MOD PATH region (~0x43f8)
console.log('\n\n========================================');
console.log('  MOD PATH REGION DECODE');
console.log('========================================');
for (const b of bufs) {
  console.log('\n--- ' + b.name + ' ---');
  // The 4 bytes at 0x43f8 and the path starting around 0x43fc
  console.log('Bytes @0x43f8 (4-byte hash/size?): 0x' + b.buf.readUInt32LE(0x43f8).toString(16));
  // Path starts at 0x43fc with u16 length + UTF-16 string (per our hypothesis)
  const pathChars = b.buf.readUInt16LE(0x43fc);
  console.log('Path length @0x43fc: ' + pathChars + ' chars');
  if (pathChars > 0 && pathChars < 500) {
    let pathStr = '';
    for (let i = 0; i < pathChars; i++) {
      const c = b.buf.readUInt16LE(0x43fe + i * 2);
      pathStr += String.fromCharCode(c);
    }
    console.log('Path: "' + pathStr + '"');
    // What's right AFTER the path?
    const afterPath = 0x43fe + pathChars * 2;
    console.log('After path @0x' + afterPath.toString(16) + ':');
    for (let i = 0; i < 64; i += 4) {
      const v = b.buf.readUInt32LE(afterPath + i);
      console.log('  +' + i + ': 0x' + v.toString(16).padStart(8, '0'));
    }
    // Look for the NEXT path/string
    let p = afterPath;
    let n = 0;
    while (p < afterPath + 2000 && n < 5) {
      const u = readPstr16UTF16(b.buf, p);
      if (u && u.str.length >= 5 && /^[\x20-\x7e]+$/.test(u.str)) {
        console.log('  Next path @0x' + p.toString(16) + ': "' + u.str + '" (' + u.str.length + ' chars)');
        p += u.totalLen;
        n++;
        continue;
      }
      p++;
    }
  }
}
