// Verify the dual-building-list structure hypothesis:
// First list = currently built, Second list = upgrade queue / replacements

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function readPstr16Utf16(buf, off) {
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

function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
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

// Walk settlements, splitting into lists by "default_set" markers
const defSets = findPstr16Asciiz(buf, 'default_set');
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -50; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16(buf, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  if (nameOff !== -1) {
    settlements.push({
      name: readPstr16Utf16(buf, nameOff).str,
      defSet: ds,
      nameOff,
    });
  }
}

// For each settlement, walk forward collecting buildings + their data
function walkBuildings(s, nextNameOff) {
  let p = s.defSet + 14 + 61;
  const end = nextNameOff - 200;
  const lists = [[]];
  let currentList = 0;
  while (p < end) {
    // Check if this is a "default_set" marker (starts new list)
    const ds = readPstr16Asciiz(buf, p);
    if (ds && ds.str === 'default_set') {
      lists.push([]);
      currentList++;
      // After default_set, skip the 61-byte header
      p += ds.totalLen + 61;
      continue;
    }
    const r = readPstr16Asciiz(buf, p);
    if (r && r.str.length >= 4 && /^[a-z_][a-z_0-9]*$/.test(r.str)) {
      const data = buf.slice(p + r.totalLen, p + r.totalLen + 78);
      lists[currentList].push({
        name: r.str,
        tier: data[4],
        culturalFlag: data[76],
        constructionStatus: data[76],
        off: p,
      });
      p += r.totalLen + 78;
    } else {
      p++;
    }
  }
  return lists;
}

const SAMPLES = ['Rome', 'Croton', 'Corinth', 'Jerusalem', 'Sardis', 'Messana'];
console.log('=== Settlements with dual building lists ===');
for (const s of settlements) {
  if (!SAMPLES.includes(s.name)) continue;
  const next = settlements.find(x => x.nameOff > s.nameOff);
  const lists = walkBuildings(s, next ? next.nameOff : buf.length);
  if (lists.length === 1) continue;
  console.log('\n--- ' + s.name + ' (' + lists.length + ' lists) ---');
  for (let i = 0; i < lists.length; i++) {
    console.log('  List ' + i + ' (' + lists[i].length + ' buildings):');
    for (const b of lists[i]) {
      console.log('    ' + b.name.padEnd(25) + ' tier=' + b.tier + ' culturalFlag=' + b.culturalFlag);
    }
  }
}

// Verify: do List 1 buildings have HIGHER tier than List 0 counterparts?
console.log('\n=== Test: List 0 vs List 1 tier comparison ===');
console.log('If List 1 = upgrades, tier(list1) > tier(list0) for shared categories');
for (const s of settlements) {
  if (!SAMPLES.includes(s.name)) continue;
  const next = settlements.find(x => x.nameOff > s.nameOff);
  const lists = walkBuildings(s, next ? next.nameOff : buf.length);
  if (lists.length < 2) continue;
  // Find common categories
  const list0Map = {};
  for (const b of lists[0]) list0Map[b.name] = b.tier;
  let upgrades = 0, downgrades = 0, same = 0;
  for (const b of lists[1]) {
    if (b.name in list0Map) {
      if (b.tier > list0Map[b.name]) upgrades++;
      else if (b.tier < list0Map[b.name]) downgrades++;
      else same++;
    }
  }
  console.log('  ' + s.name + ': upgrades=' + upgrades + ', same=' + same + ', downgrades=' + downgrades);
}
