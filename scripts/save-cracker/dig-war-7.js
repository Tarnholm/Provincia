// Set-based comparison: find character records (identified by their full
// portrait-path string + nearby UUID) that exist in peace but NOT war.
// These are the records that REALLY got eliminated by the war declaration.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const war = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 besiged corduba.sav'));

// Find all length-prefixed ASCII strings of form "data/ui/.../portraits/..."
// Each such string anchors a character record. Pair card_X.tga and
// portrait_X.tga that occur close together — they identify one character.
function findCharCardPortraitPairs(buf) {
  const out = [];
  // Find all "data/ui/...captain_card_*.tga" and "data/ui/...captain_portrait_*.tga"
  // by scanning ASCII strings. Also look for general_card_/general_portrait_.
  const re = /(captain|general)_(card|portrait)_([a-z_]+)\.tga/;
  const cardOf = new Map(); // fingerprint -> { off, string }
  for (let i = 0; i < buf.length - 50; i++) {
    // Find "data/ui/" start
    if (buf[i] !== 0x64 || buf[i+1] !== 0x61 || buf[i+2] !== 0x74 || buf[i+3] !== 0x61) continue;
    if (buf[i+4] !== 0x2f) continue;
    if (buf[i+5] !== 0x75 || buf[i+6] !== 0x69 || buf[i+7] !== 0x2f) continue;
    // Read up to 80 chars
    let end = i;
    while (end < i + 100 && end < buf.length && buf[end] >= 0x20 && buf[end] < 0x7f) end++;
    if (buf[end] !== 0) continue;  // need null terminator
    const s = buf.slice(i, end).toString('latin1');
    const m = s.match(re);
    if (m) {
      out.push({ off: i, str: s, type: m[2], faction: m[3] });
    }
  }
  return out;
}

const peaceRecs = findCharCardPortraitPairs(peace);
const warRecs = findCharCardPortraitPairs(war);
console.log('Peace records:', peaceRecs.length);
console.log('War records:  ', warRecs.length);
console.log('Δ:', warRecs.length - peaceRecs.length);

// Count by (type, faction)
function group(arr) {
  const out = new Map();
  for (const r of arr) {
    const k = r.type + '_' + r.faction;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}
const peaceG = group(peaceRecs);
const warG = group(warRecs);

console.log('\n=== Grouped by (type, faction) ===');
console.log('type_faction'.padEnd(40) + '  peace  war  diff');
const allKeys = new Set([...peaceG.keys(), ...warG.keys()]);
const changed = [];
for (const k of allKeys) {
  const p = peaceG.get(k)?.length || 0;
  const w = warG.get(k)?.length || 0;
  const d = w - p;
  if (d !== 0) {
    console.log(k.padEnd(40) + '  ' + String(p).padStart(5) + '  ' + String(w).padStart(3) + '  ' + (d > 0 ? '+' : '') + d + '  <-- CHANGED');
    changed.push(k);
  } else {
    console.log(k.padEnd(40) + '  ' + String(p).padStart(5) + '  ' + String(w).padStart(3));
  }
}

// For changed categories, dump all positions in peace and war
console.log('\n=== Changed category positions ===');
for (const k of changed) {
  console.log('\n--- ' + k + ' ---');
  console.log('Peace:');
  for (const r of (peaceG.get(k) || [])) {
    console.log('  0x' + r.off.toString(16) + '  "' + r.str + '"');
  }
  console.log('War:');
  for (const r of (warG.get(k) || [])) {
    console.log('  0x' + r.off.toString(16) + '  "' + r.str + '"');
  }
}

// For the changed categories, isolate the records that vanished.
// Each character record has a portrait path + nearby UUID. The character
// UUID is likely at offset -4 from the portrait path start (a u32 we can
// read).
// Strategy: collect (faction, type, neighborhood_uuid) tuples for each save.
// Records present in peace but not in war are the eliminated characters.

// But the captain portraits are STATIC paths shared across many characters.
// The UNIQUE identifier is the per-character UUID stored near the portrait.
// So the right fingerprint is (portrait_path, surrounding_uuid).

console.log('\n=== Build (path + UUID) fingerprints for changed categories ===');
function fingerprintRec(buf, r) {
  // Look 8 bytes before and 32 bytes after the path for the UUID
  const before = r.off - 8;
  const after = r.off + r.str.length + 1;
  const u32a = before >= 0 ? buf.readUInt32LE(before) : 0;
  const u32b = after + 4 <= buf.length ? buf.readUInt32LE(after) : 0;
  const u32c = after + 8 <= buf.length ? buf.readUInt32LE(after + 4) : 0;
  return { off: r.off, str: r.str, u32before: u32a, u32after0: u32b, u32after4: u32c };
}

for (const k of changed) {
  console.log('\nCategory: ' + k);
  console.log('Peace records with fingerprints:');
  for (const r of (peaceG.get(k) || [])) {
    const fp = fingerprintRec(peace, r);
    console.log('  0x' + r.off.toString(16) + '  pre-u32=0x' + fp.u32before.toString(16) + '  after-u32=0x' + fp.u32after0.toString(16) + '  after+4=0x' + fp.u32after4.toString(16));
  }
  console.log('War records with fingerprints:');
  for (const r of (warG.get(k) || [])) {
    const fp = fingerprintRec(war, r);
    console.log('  0x' + r.off.toString(16) + '  pre-u32=0x' + fp.u32before.toString(16) + '  after-u32=0x' + fp.u32after0.toString(16) + '  after+4=0x' + fp.u32after4.toString(16));
  }
}
