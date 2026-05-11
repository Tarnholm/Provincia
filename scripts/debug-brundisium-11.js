// Check what save_11.1 says about Brundisium's owner + Titus + Aulus position.
const fs = require('fs');
const path = require('path');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_11.1.sav';
const MOD = 'C:/RIS/RIS/data';

const { findCharacterRecords } = require('C:/dev/Provincia/src/characterParser.js');
const { findUnitRecords } = require('C:/dev/Provincia/src/unitParser.js');
const { resolveCurrentOwners, findSettlementGovernors } = require('C:/dev/Provincia/src/saveOwnershipParser.js');
const { findAllSettlementMarkers, buildInitialOwnership } = require('C:/dev/Provincia/src/buildingParser.js');

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

const setts = findAllSettlementMarkers(buf);
const govByCity = findSettlementGovernors(buf, setts);
const positions = parseWorldObjectPositions(buf);
const chars = findCharacterRecords(buf, nameLookup, traitNames, null);
const units = findUnitRecords(buf);

// Find Brundisium's governor
console.log("Brundisium governor uuid:", govByCity["Brundisium"]?.toString(16));
const brundGov = chars.find(c => c.secondaryUuid === govByCity["Brundisium"]);
if (brundGov) console.log("  governor:", brundGov.firstName, brundGov.lastName);

// Find any Titus character
const tituses = chars.filter(c => c.firstName === "Titus");
console.log("\nTitus chars:", tituses.length);
for (const t of tituses) {
  const pos = positions.get(t.secondaryUuid);
  console.log(`  uuid=0x${t.secondaryUuid.toString(16)} ${t.firstName} ${t.lastName || ""} pos=${pos ? `(${pos.x},${pos.y})` : "(none)"} dead=${t.isDead}`);
}

// Find Aulus (the player's Roman)
const aulus = chars.find(c => c.firstName === "Aulus" && c.lastName === "Gabinius");
if (aulus) {
  const pos = positions.get(aulus.secondaryUuid);
  console.log("\nAulus Gabinius pos:", pos);
}

// Find any unit in Calabria region (where Brundisium is)
const calabriaUnits = units.filter(u => u.region === "Calabria");
console.log("\nUnits in Calabria region:", calabriaUnits.length);
calabriaUnits.slice(0, 10).forEach(u => console.log("  " + u.name + " cmd=0x" + (u.commanderUuid||0).toString(16)));
