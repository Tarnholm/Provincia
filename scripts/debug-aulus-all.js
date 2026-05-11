// All Aulus-named Roman characters in save_3 with positions and ages.
const fs = require('fs');
const path = require('path');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav';
const MOD = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data';

const { findCharacterRecords } = require('C:/dev/Provincia/src/characterParser.js');
const buf = fs.readFileSync(SAVE);
const nameLookup = fs.readFileSync(path.join(MOD, 'descr_names_lookup.txt'),'utf8').split(/\r?\n/).map(s=>s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, 'export_descr_character_traits.txt'),'utf8').split(/\r?\n/)) {
  const m=line.match(/^Trait\s+(\S+)/); if(m) traitNames.push(m[1]);
}
const chars = findCharacterRecords(buf, nameLookup, traitNames, null);

function parseWorldObjectPositions(buf) {
  const map = new Map();
  for (let N = 24; N < buf.length - 8; N++) {
    if (buf.readUInt32LE(N - 12) !== 6) continue;
    if (buf.readUInt32LE(N - 4) !== N - 4) continue;
    const x = buf.readUInt32LE(N);
    if (x < 0 || x > 1100) continue;
    const y = buf.readUInt32LE(N + 4);
    if (y < 0 || y > 800) continue;
    const uuid = buf.readUInt32LE(N - 8);
    if (uuid === 0) continue;
    map.set(uuid, { x, y });
  }
  return map;
}
const positions = parseWorldObjectPositions(buf);

console.log("Aulus characters in save_3 (with positions):");
for (const c of chars.filter(c => c.firstName === 'Aulus')) {
  const pos = positions.get(c.secondaryUuid);
  const traits = (c.traits || []).map(t => t.name + (t.level > 0 ? ":" + t.level : "")).slice(0, 5).join(" ");
  console.log("  uuid=0x" + c.secondaryUuid.toString(16).padStart(8, "0"),
    "first=" + c.firstName,
    "last=" + (c.lastName || "(none)"),
    "age=" + (c.age != null ? c.age : "?"),
    "pos=" + (pos ? `(${pos.x},${pos.y})` : "(none)"),
    "traits=", traits);
}
