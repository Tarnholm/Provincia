// Build a faction-record walker by locating the section type ID for faction records,
// then for each faction record look for treasury candidates at stable RELATIVE offsets.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

// Section type registry sits at 0x500..0xde0
function readSectionRegistry(buf) {
  const types = [];
  let p = 0x500;
  while (p < 0xe00) {
    // Each entry: ASCIIZ name + u32 count
    const nameEnd = buf.indexOf(0x00, p);
    if (nameEnd === -1 || nameEnd > p + 60) break;
    const name = buf.slice(p, nameEnd).toString('latin1');
    if (!/^[a-z_][a-z_0-9]*$/.test(name)) break;
    const count = buf.readUInt32LE(nameEnd + 1);
    types.push({ id: types.length, name, count, off: p });
    p = nameEnd + 5;
  }
  return types;
}

// Test against Spain T1 first
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));
const types = readSectionRegistry(T1);
console.log('Section type registry (Spain T1, ' + types.length + ' types):');
for (const t of types) console.log('  ' + t.id.toString().padStart(3) + ': ' + t.name.padEnd(40) + ' count=' + t.count);

// Look for faction-related type names
console.log('\n=== Faction-related types ===');
const factionTypes = types.filter(t => /faction|gov|treasury|empire/.test(t.name));
for (const t of factionTypes) console.log('  ID ' + t.id + ': ' + t.name + ' (count=' + t.count + ')');
