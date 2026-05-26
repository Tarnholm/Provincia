// Proper section type registry reader — UPPERCASE ASCIIZ names + u32 count

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

function readRegistry(buf) {
  // Layout per entry: [u32 count][ASCIIZ name]
  // Registry starts with WORLD_MAP count u32 at 0x566 then "WORLD_MAP\0" at 0x56a
  let p = 0x500;
  // Find the first plausible entry: a u32 followed by uppercase ASCIIZ
  while (p < 0xf00) {
    const count = buf.readUInt32LE(p);
    if (count > 0 && count < 100000) {
      const nameStart = p + 4;
      if (buf[nameStart] >= 0x41 && buf[nameStart] <= 0x5a) {
        const nameEnd = buf.indexOf(0x00, nameStart);
        if (nameEnd !== -1 && nameEnd < nameStart + 60) {
          const name = buf.slice(nameStart, nameEnd).toString('latin1');
          if (/^[A-Z][A-Z_0-9]*$/.test(name)) {
            break;
          }
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
    types.push({ id: types.length, name, count, off: p });
    p = nameEnd + 1;
  }
  return types;
}

const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));
const types = readRegistry(T1);
console.log('Section type registry (Spain T1): ' + types.length + ' types');
for (const t of types) {
  console.log('  ' + t.id.toString().padStart(3) + ': ' + t.name.padEnd(50) + ' count=' + t.count + '  @0x' + t.off.toString(16));
}

// Find sections with name-related keywords
console.log('\n=== Faction-economy-treasury related types ===');
for (const t of types) {
  if (/FACTION|ECONOMIC|TREASURY|EMPIRE|GOV|FINANCE/.test(t.name)) {
    console.log('  ID ' + t.id + ': ' + t.name + ' count=' + t.count);
  }
}

// Now compare to other saves to see if registry shifts
console.log('\n=== Same on Alexander T11 save ===');
const T11A = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));
const typesA = readRegistry(T11A);
console.log('Alexander registry has ' + typesA.length + ' types');
// Diff
console.log('Differences in counts vs Spain T1:');
for (let i = 0; i < Math.max(types.length, typesA.length); i++) {
  const a = types[i];
  const b = typesA[i];
  if (!a || !b) {
    console.log('  ID ' + i + ': missing in ' + (!a ? 'Spain' : 'Alexander'));
    continue;
  }
  if (a.name !== b.name) console.log('  ID ' + i + ': name differs Spain="' + a.name + '" Alex="' + b.name + '"');
  else if (a.count !== b.count) console.log('  ID ' + i + ': ' + a.name + ' Spain=' + a.count + ' Alex=' + b.count);
}
