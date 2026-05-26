// Find UNIT records (type IDs 79=UNIT, 45=UNIT_SHIP, 95=UNIT_ARTILLERY) via
// section walker, then diff T11/T12 to find weapon_lvl / experience bytes.

const fs = require('fs');
const path = require('path');

const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const T11 = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));
const T12 = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 12 retrained and upgraded units.sav'));

function readRegistry(buf) {
  let p = 0x500;
  while (p < 0xf00) {
    const count = buf.readUInt32LE(p);
    if (count > 0 && count < 100000) {
      const nameStart = p + 4;
      if (buf[nameStart] >= 0x41 && buf[nameStart] <= 0x5a) {
        const nameEnd = buf.indexOf(0x00, nameStart);
        if (nameEnd !== -1 && nameEnd < nameStart + 60) {
          const name = buf.slice(nameStart, nameEnd).toString('latin1');
          if (/^[A-Z][A-Z_0-9]*$/.test(name)) break;
        }
      }
    }
    p++;
  }
  const types = [];
  while (p < buf.length - 5) {
    const count = buf.readUInt32LE(p);
    if (count > 100000) break;
    const nameStart = p + 4;
    const nameEnd = buf.indexOf(0x00, nameStart);
    if (nameEnd === -1 || nameEnd > nameStart + 60) break;
    const name = buf.slice(nameStart, nameEnd).toString('latin1');
    if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
    types.push({ id: types.length, name, count });
    p = nameEnd + 1;
  }
  return types;
}

const types11 = readRegistry(T11);
const types12 = readRegistry(T12);
console.log('Alexander T11 registry:');
for (const t of types11) {
  if (/UNIT|SOLDIER|ARMY/.test(t.name)) console.log('  ID ' + t.id + ': ' + t.name + ' count=' + t.count);
}
console.log('\nAlexander T12 registry (diffs):');
for (let i = 0; i < types12.length; i++) {
  if (types12[i].count !== types11[i].count) {
    console.log('  ID ' + i + ': ' + types12[i].name + ' T11=' + types11[i].count + ' T12=' + types12[i].count);
  }
}

// Now look for SECTIONS in the body with the TAW invariant {u32 offset==pos, u32 size}
function findTawSections(buf, fromOff, toOff) {
  const sections = [];
  for (let p = fromOff; p < toOff - 8; p += 4) {
    const v = buf.readUInt32LE(p);
    if (v === p) {
      const size = buf.readUInt32LE(p + 4);
      if (size > 16 && size < 0x100000 && p + size <= buf.length) {
        sections.push({ off: p, size });
      }
    }
  }
  return sections;
}

const s11 = findTawSections(T11, 0x3000, T11.length);
const s12 = findTawSections(T12, 0x3000, T12.length);
console.log('\nT11 TAW sections: ' + s11.length);
console.log('T12 TAW sections: ' + s12.length);

// Find SECTION SIZE histograms — sections of same size are likely records of same type
const sizeHist11 = {};
for (const s of s11) sizeHist11[s.size] = (sizeHist11[s.size] || 0) + 1;
console.log('\nT11 section size distribution (top 20 most common):');
const sortedSizes = Object.entries(sizeHist11).sort((a, b) => b[1] - a[1]);
for (const [size, count] of sortedSizes.slice(0, 20)) {
  console.log('  size=' + size + ': ' + count + ' sections');
}

// FACTION_ECONOMICS count=36 — find sections that occur EXACTLY 36 times
console.log('\n=== Section sizes occurring exactly ~36 times (FACTION_ECONOMICS candidate) ===');
for (const [size, count] of sortedSizes) {
  if (count >= 30 && count <= 50) console.log('  size=' + size + ': ' + count + ' sections');
}

// UNIT count=? — for Alexander it's much smaller
console.log('\n=== Per-faction records candidates (count 20-50) ===');
for (const [size, count] of sortedSizes) {
  if (count >= 20 && count <= 50) console.log('  size=' + size + ': ' + count + ' sections');
}
