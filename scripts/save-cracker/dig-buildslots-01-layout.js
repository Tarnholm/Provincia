// dig-buildslots-01-layout.js
// GOAL: nail the per-building entry layout in a settlement's default_set list,
// focusing on the LEVEL byte. Cross-validate building chain names against the
// RIS export_descr_buildings.txt and map the level index -> level name.
//
// Approach (default_set model, per dig-buildings-final.js):
//   - find every "default_set" pstr16-ASCIIZ marker
//   - locate the settlement UTF-16 name 18 bytes before the marker
//   - the building list begins at marker + 14 + 61 (trailer)
//   - each building entry: pstr16-ASCIIZ chain name + ~78-byte trailer
//
// This script DUMPS the full trailer bytes for the FIRST few settlements so we
// can pinpoint where the level index lives, then auto-detects the level byte by
// matching against EDB level counts.

const fs = require('fs');
const path = require('path');

const SAVE_BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const SAVE = path.join(SAVE_BASE, 'save_macedon t0.sav');
const EDB = 'C:\\RIS\\RIS\\data\\export_descr_buildings.txt';

// ---- EDB chain -> levels --------------------------------------------------
function loadEdb() {
  const txt = fs.readFileSync(EDB, 'latin1');
  const lines = txt.split(/\r?\n/);
  let cur = null;
  const chains = {};
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, '');
    let m = line.match(/^building\s+(\w+)/);
    if (m) { cur = m[1]; chains[cur] = []; continue; }
    m = line.match(/^\s+levels\s+(.+)$/);
    if (m && cur) chains[cur] = m[1].trim().split(/\s+/).filter(Boolean);
  }
  return chains;
}
const CHAINS = loadEdb();
const CHAIN_SET = new Set(Object.keys(CHAINS));

// ---- buffer helpers -------------------------------------------------------
const buf = fs.readFileSync(SAVE);

function readPstr16Utf16(b, off) {
  if (off + 2 > b.length) return null;
  const len = b.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > b.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = b.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x024F) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

function readPstr16Asciiz(b, off) {
  if (off + 2 > b.length) return null;
  const lenP1 = b.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (off + 2 + lenP1 > b.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = b[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (b[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: b.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

function findPstr16Asciiz(b, str) {
  const len = str.length + 1;
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16LE(len, 0);
  const target = Buffer.concat([prefix, Buffer.from(str + '\0')]);
  const hits = [];
  let p = 0;
  while ((p = b.indexOf(target, p)) !== -1) { hits.push(p); p++; }
  return hits;
}

function hex(b, off, n) {
  return Array.from(b.slice(off, off + n)).map(x => x.toString(16).padStart(2, '0')).join(' ');
}

// ---- locate settlements ---------------------------------------------------
const defSets = findPstr16Asciiz(buf, 'default_set');
console.log('default_set markers: ' + defSets.length);

// Build settlement list = first default_set after each settlement name
const settlements = [];
const seenNames = new Set();
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -50; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16(buf, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  if (nameOff === -1) continue;
  const nm = readPstr16Utf16(buf, nameOff).str;
  // Only the FIRST default_set per settlement marks the record start.
  if (seenNames.has(nameOff)) continue;
  seenNames.add(nameOff);
  settlements.push({ name: nm, nameOff, firstDs: ds });
}
console.log('Settlements (by unique name offset): ' + settlements.length);

// ---- For first 4 settlements, dump building entries + full 80-byte trailer
console.log('\n=== RAW BUILDING ENTRY DUMP (first 4 settlements) ===');
for (let s = 0; s < Math.min(4, settlements.length); s++) {
  const st = settlements[s];
  const next = s + 1 < settlements.length ? settlements[s + 1].nameOff : buf.length;
  console.log('\n### ' + st.name + '  nameOff=0x' + st.nameOff.toString(16) + '  firstDs=0x' + st.firstDs.toString(16));

  // Find ALL default_set markers within this settlement's span
  const localDs = defSets.filter(d => d >= st.firstDs && d < next);
  console.log('  default_set sub-lists in record: ' + localDs.length + '  @ ' + localDs.map(d => '0x' + d.toString(16)).join(', '));

  // Walk the LAST default_set list
  const lastDs = localDs[localDs.length - 1];
  let p = lastDs + 14 + 61;
  const end = next;
  let count = 0;
  while (p < end - 4 && count < 40) {
    const r = readPstr16Asciiz(buf, p);
    if (!r) { p++; continue; }
    if (r.str === 'default_set') break;
    if (!/^[a-z_][a-z_0-9]*$/.test(r.str) || r.str.length < 3) { p++; continue; }
    const isChain = CHAIN_SET.has(r.str);
    const dataStart = p + r.totalLen;
    // dump 12 bytes of trailer
    console.log('  0x' + p.toString(16) + '  ' + (isChain ? '[CHAIN] ' : '[??]    ') +
      r.str.padEnd(26) + ' EDB-levels=' + (CHAINS[r.str] ? CHAINS[r.str].length : '-') +
      '  trailer: ' + hex(buf, dataStart, 12));
    p = dataStart + 78;
    count++;
  }
}
