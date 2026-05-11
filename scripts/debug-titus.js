// Find Titus characters in save_13.1 - check if they're flagged dead.
const fs = require('fs');
const path = require('path');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_13.1.sav';
const MOD = 'C:/RIS/RIS/data';

const { findCharacterRecords } = require('C:/dev/Provincia/src/characterParser.js');
const { findUnitRecords } = require('C:/dev/Provincia/src/unitParser.js');

const buf = fs.readFileSync(SAVE);
const nameLookup = fs.readFileSync(path.join(MOD, 'descr_names_lookup.txt'),'utf8').split(/\r?\n/).map(s=>s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, 'export_descr_character_traits.txt'),'utf8').split(/\r?\n/)) {
  const m=line.match(/^Trait\s+(\S+)/); if(m) traitNames.push(m[1]);
}

function parseWorldObjectPositions(buf) {
  const map = new Map();
  for (let N = 24; N < buf.length - 8; N++) {
    if (buf.readUInt32LE(N - 12) !== 6) continue;
    if (buf.readUInt32LE(N - 4) !== N - 4) continue;
    const x = buf.readUInt32LE(N), y = buf.readUInt32LE(N + 4);
    if (x < 0 || x > 1100 || y < 0 || y > 800) continue;
    const uuid = buf.readUInt32LE(N - 8);
    if (uuid === 0) continue;
    map.set(uuid, { x, y });
  }
  return map;
}

const chars = findCharacterRecords(buf, nameLookup, traitNames, null);
const units = findUnitRecords(buf);
const positions = parseWorldObjectPositions(buf);

const tituses = chars.filter(c => c.firstName === "Titus");
console.log("Titus chars in save_13.1:", tituses.length);
for (const t of tituses) {
  const pos = positions.get(t.secondaryUuid);
  const hasUnit = units.some(u => u.commanderUuid === t.secondaryUuid);
  console.log(`  uuid=0x${(t.secondaryUuid||0).toString(16).padStart(8,'0')} ${t.firstName} ${t.lastName || ''} faction=${t.faction || '?'} isDead=${t.isDead} pos=${pos ? `(${pos.x},${pos.y})` : '(none)'} hasUnit=${hasUnit}`);
}

// Brundisium area check (x=343, y=386 per Aulus)
console.log("\nCharacters near Brundisium (within 5 tiles of 343,386):");
for (const c of chars) {
  const pos = positions.get(c.secondaryUuid);
  if (!pos) continue;
  if (Math.abs(pos.x - 343) > 5 || Math.abs(pos.y - 386) > 5) continue;
  console.log(`  ${c.firstName} ${c.lastName || ''} faction=${c.faction || '?'} pos=(${pos.x},${pos.y}) isDead=${c.isDead}`);
}
