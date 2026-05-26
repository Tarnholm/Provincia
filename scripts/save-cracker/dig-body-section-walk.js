// Walk the save body starting from ~0x3bad and find section boundaries.
// RTW save bodies typically have: [u32 type_id (matches registry)][section_data...]
// Or [u32 count][records...] per type.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));

// Re-read section registry to know type IDs
function readRegistry(buf) {
  let p = 0x500;
  while (p < 0xf00) {
    const count = buf.readUInt32LE(p);
    if (count > 0 && count < 100000) {
      const nameStart = p + 4;
      if (buf[nameStart] >= 0x41 && buf[nameStart] <= 0x5a) {
        const end = buf.indexOf(0x00, nameStart);
        if (end !== -1 && /^[A-Z][A-Z_0-9]*$/.test(buf.slice(nameStart, end).toString('latin1'))) break;
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

const types = readRegistry(T1);
console.log('Registry has ' + types.length + ' types');

// Body root is around 0x3bad per memory.
// Layout hypothesis: at 0x3bad+, there's a sequence of sections, each starting with
// the section's TYPE_ID as a u32.
// Scan from 0x3bad forward for u32 values that match KNOWN section IDs.

const knownIds = new Set(types.map(t => t.id));
console.log('Known type IDs: 0..' + (types.length - 1));

// Find all u32 values in body that match a known type ID
console.log('\n=== Scan 0x3bad..0x10000 for u32 = known type ID ===');
const idHits = [];
for (let p = 0x3bad; p < 0x10000; p += 4) {
  const v = T1.readUInt32LE(p);
  if (knownIds.has(v) && v < 106) {
    // Skip too-common values that would appear as random data
    if (v < 5) continue;  // very low IDs are noise
    idHits.push({ off: p, id: v, name: types[v].name });
  }
}
console.log('Found ' + idHits.length + ' u32 matches');
// Show the unique types found
const idCounts = {};
for (const h of idHits) idCounts[h.id] = (idCounts[h.id] || 0) + 1;
console.log('ID hit distribution:');
for (const [id, count] of Object.entries(idCounts).sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log('  ID ' + id + ' (' + types[id].name + '): ' + count + ' hits');
}

// Specifically: where does type ID 91 (FACTION_ECONOMICS) appear early in body?
console.log('\n=== Type 91 (FACTION_ECONOMICS) early hits ===');
const t91 = idHits.filter(h => h.id === 91);
for (const h of t91.slice(0, 20)) {
  // What follows? Show 16 bytes after
  const after = Array.from(T1.slice(h.off + 4, h.off + 20)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  // Could be [u32 count of records] follows the type id
  const followingU32 = T1.readUInt32LE(h.off + 4);
  console.log('  0x' + h.off.toString(16) + '  next u32=' + followingU32 + '  [' + after + ']');
}
