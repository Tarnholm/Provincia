// Find each settlement's ACTUAL record start using the section grammar.
// Settlement records have a self-pointer + size header.
// The section before the name starts at name - ~500 bytes typically.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function readPstr16Utf16Extended(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x024F) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

function findPstr16Asciiz(buf, str) {
  const len = str.length + 1;
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16LE(len, 0);
  const target = Buffer.concat([prefix, Buffer.from(str + '\0')]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

const defSets = findPstr16Asciiz(buf, 'default_set');
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -50; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16Extended(buf, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  if (nameOff === -1) continue;
  settlements.push({
    name: readPstr16Utf16Extended(buf, nameOff).str,
    defSet: ds,
    nameOff,
  });
}

// Record START detection: look for a u32 self-pointer pattern.
// Each settlement record begins with a self-pointer.
// Walk back from name and find a u32 that EQUALS its own offset.
console.log('=== Settlement record starts (self-pointer detection) ===');
for (const s of settlements.slice(0, 12)) {
  // Look back up to 700 bytes for a u32 that equals its own offset
  let recordStart = -1;
  for (let p = s.nameOff - 4; p > Math.max(0, s.nameOff - 700); p -= 4) {
    const v = buf.readUInt32LE(p);
    if (v === p) {
      recordStart = p;
      break;
    }
  }
  if (recordStart !== -1) {
    console.log('  ' + s.name.padEnd(20) + ' nameOff=0x' + s.nameOff.toString(16) + ' recordStart=0x' + recordStart.toString(16) + ' size=' + (s.nameOff - recordStart));
  } else {
    console.log('  ' + s.name.padEnd(20) + ' no self-pointer found');
  }
}

// Distance between consecutive settlements = record size
console.log('\n=== Settlement record sizes (gap between consecutive names) ===');
for (let i = 1; i < Math.min(15, settlements.length); i++) {
  const gap = settlements[i].nameOff - settlements[i-1].nameOff;
  console.log('  ' + settlements[i-1].name.padEnd(20) + ' → ' + settlements[i].name.padEnd(20) + ' gap=' + gap);
}

// The gap between names should bound each record.
// For Arretium (first settlement): record ends at next settlement's start
// Record START might be far before the name. Let me dump bytes 200-100 before Arretium's name
console.log('\n=== Bytes before Arretium name (0x19b16) ===');
const arret = settlements[0];
function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}
for (let row = -32; row <= -1; row++) {
  const addr = arret.nameOff + row * 16;
  if (addr < 0) continue;
  console.log('  0x' + addr.toString(16) + ': ' + hex(addr, 16));
}

// Look for the section-grammar pattern: u32 self-ptr + u32 size before each settlement
// Try to find the start by walking back from the name and matching a {u32 self_ptr == pos, u32 size}
// where size matches the gap to the next settlement
console.log('\n=== {u32 self_ptr, u32 size} pattern detection ===');
for (let i = 0; i < Math.min(15, settlements.length); i++) {
  const s = settlements[i];
  const nextNameOff = i + 1 < settlements.length ? settlements[i+1].nameOff : buf.length;
  // The record bounded by self-pointer + size includes the name
  // Look back from name for a position p where:
  //   u32@p == p (self-pointer)
  //   u32@p+4 == some_reasonable_size
  let found = null;
  for (let p = s.nameOff - 8; p > Math.max(0, s.nameOff - 1200); p -= 4) {
    if (buf.readUInt32LE(p) === p) {
      const sz = buf.readUInt32LE(p + 4);
      if (sz > 100 && sz < 5000) {
        found = { recordStart: p, size: sz };
        break;
      }
    }
  }
  if (found) {
    console.log('  ' + s.name.padEnd(20) + ' recordStart=0x' + found.recordStart.toString(16) + ' size=' + found.size);
  }
}
