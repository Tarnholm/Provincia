// Check Aulus's world-object positions in save_3.
const fs = require('fs');
const path = require('path');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav';

const buf = fs.readFileSync(SAVE);

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
console.log("Total world-object positions:", positions.size);

// Aulus Gabinius secondaryUuid in save_3 was 0xa77c10f (from earlier debug).
console.log("\nAulus Gabinius (0xa77c10f):");
const aulusPos = positions.get(0xa77c10f);
if (aulusPos) console.log("  position:", aulusPos);
else console.log("  NO POSITION RECORD");

// Look for ALL records with the same x/y range as Uria's settlement tile
// Uria's coords are roughly... let me check by finding all positions at
// the same spot as Aulus.
if (aulusPos) {
  console.log("\nAll uuids at (" + aulusPos.x + ", " + aulusPos.y + "):");
  for (const [uuid, pos] of positions) {
    if (pos.x === aulusPos.x && pos.y === aulusPos.y) {
      console.log("  uuid=0x" + uuid.toString(16) + " pos=", pos);
    }
  }
}

// Check Taras coords: rough Aulus starting was (337, 385) per descr_strat → TGA conversion
console.log("\nUuids near Taras settlement (337, 385):");
for (const [uuid, pos] of positions) {
  if (Math.abs(pos.x - 337) <= 2 && Math.abs(pos.y - 385) <= 2) {
    console.log("  uuid=0x" + uuid.toString(16) + " pos=", pos);
  }
}
