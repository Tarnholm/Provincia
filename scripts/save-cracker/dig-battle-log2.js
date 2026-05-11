// Search for battle-history records.
// In Macedon T97 (late campaign), there must be many famous battles.
// Look for sections containing tile coords (X, Y both in 1..1500) + small ints + turn numbers.

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 97.sav');

console.log('save size:', buf.length);

// Find all top-level self-pointing sections, look for non-character_paths ones
let p = 0x3a00;
const sections = [];
while (p + 8 <= buf.length) {
  let found = false;
  for (let scan = 0; scan < 10000 && p + scan + 8 <= buf.length; scan++) {
    const c = p + scan;
    const sp = buf.readUInt32LE(c);
    if (sp !== c) continue;
    const sz = buf.readUInt32LE(c + 4);
    if (sz < 16 || c + sz > buf.length) continue;
    sections.push({ off: c, sz, gap: scan });
    p = c + sz;
    found = true;
    break;
  }
  if (!found) break;
}
console.log('top-level sections found:', sections.length);
for (const s of sections.slice(0, 10)) {
  console.log(' 0x' + s.off.toString(16), 'size:', s.sz, 'gap:', s.gap, 'peek:', buf.slice(s.off+8, s.off+32).toString('hex'));
}

// Find body root (largest)
const root = sections.find(s => s.sz > 100000) || sections[0];
console.log('body root selected: 0x' + root.off.toString(16), 'size:', root.sz);

// Walk children
const rootEnd = root.off + root.sz;
let pp = root.off + 8;
const kids = [];
while (pp + 8 <= rootEnd) {
  const sp = buf.readUInt32LE(pp);
  if (sp !== pp) { pp += 4; continue; }
  const sz = buf.readUInt32LE(pp + 4);
  if (sz < 8 || pp + sz > rootEnd) { pp += 4; continue; }
  kids.push({ off: pp, sz });
  pp += sz;
}
console.log('body root direct kids:', kids.length);
kids.sort((a,b) => b.sz - a.sz);
console.log('top 30 by size:');
for (const k of kids.slice(0, 30)) {
  console.log(' 0x' + k.off.toString(16), 'size:', k.sz.toString().padStart(8), 'peek:', buf.slice(k.off+8, k.off+40).toString('hex'));
}

// For each kid, classify its shape: does it look like CHARACTER_PATHS, or something else?
// CHARACTER_PATHS structure (per session 12): payload starts with [size_field][count][X_first][Y_first][...]
// Let me check if there's a kid with a different shape - e.g., short header followed by repeated 16-byte structs
function isCharPathsLike(kid) {
  // payload starts at kid.off + 8
  // standard char_paths: u32 size-something, u32 count, u32 X (1..1500), u32 Y (1..1500)
  const sz2 = buf.readUInt32LE(kid.off + 8);
  if (sz2 > kid.sz) return false;
  const count = buf.readUInt32LE(kid.off + 12);
  const x = buf.readUInt32LE(kid.off + 16);
  if (x < 1 || x > 1500) return false;
  const y = buf.readUInt32LE(kid.off + 20);
  if (y < 1 || y > 1500) return false;
  return true;
}
const nonCharPaths = kids.filter(k => !isCharPathsLike(k));
console.log('non-char-paths kids:', nonCharPaths.length);
for (const k of nonCharPaths.slice(0, 30)) {
  console.log(' 0x' + k.off.toString(16), 'size:', k.sz.toString().padStart(8), 'peek:', buf.slice(k.off+8, k.off+48).toString('hex'));
}
