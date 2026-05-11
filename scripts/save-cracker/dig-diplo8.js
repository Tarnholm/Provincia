// dig-diplo8.js — locate diplomacy table inside the player's faction record.
//
// The player faction record is at offset 0x15af6a4 (Romans Julii, 7500 starting
// treasury, 30 regions) in save_rome10. The 10 majors should ALL contain a
// table of small-int "diplomacy state" values, one per other faction.
//
// Strategy: scan the trailing data after +52+4N looking for any run of bytes
// in the 0..10 range of length ~10 or ~20 (close to the number of total
// factions in the campaign).

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const SAVE_ROR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";
const buf = fs.readFileSync(SAVE);
const bufRoR = fs.readFileSync(SAVE_ROR);

function findMajors(buf) {
  const out = [];
  for (let i = 0x3000; i + 56 < buf.length; i += 4) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    out.push(i);
  }
  return out.sort((a, b) => a - b);
}

const majors = findMajors(buf);
const majorsR = findMajors(bufRoR);
console.log(`rome10 majors: ${majors.length}`);
console.log(`RoR Turn 1 majors: ${majorsR.length}`);

// Identify player record (first major after sort = lowest offset). Player
// faction record always at index 0 per session 5 docs.
const playerR10 = majors[0]; // 0x157af18 r=22 treasury=10000
const playerRoR = majorsR[0];
console.log(`\nplayerR10: 0x${playerR10.toString(16)} treasury=${buf.readInt32LE(playerR10)} N=${buf.readUInt32LE(playerR10+48)}`);
console.log(`playerRoR: 0x${playerRoR.toString(16)} treasury=${bufRoR.readInt32LE(playerRoR)} N=${bufRoR.readUInt32LE(playerRoR+48)}`);

// Compute end-of-region-list
function regionListEnd(buf, off) {
  return off + 52 + 4 * buf.readUInt32LE(off + 48);
}

const rlR10 = regionListEnd(buf, playerR10);
const rlRoR = regionListEnd(bufRoR, playerRoR);
console.log(`region list ends: rome10=0x${rlR10.toString(16)} RoR=0x${rlRoR.toString(16)}`);

// Dump the first 256 bytes after the region list
function dumpHex(buf, start, len, anchor=0) {
  let out = "";
  for (let i = 0; i < len; i += 16) {
    out += `+${(start - anchor + i).toString().padStart(5)}: `;
    for (let j = 0; j < 16 && i+j < len; j++) {
      out += buf[start+i+j].toString(16).padStart(2,'0') + " ";
    }
    out += "  ";
    for (let j = 0; j < 16 && i+j < len; j++) {
      const c = buf[start+i+j];
      out += (c >= 0x20 && c < 0x7f) ? String.fromCharCode(c) : ".";
    }
    out += "\n";
  }
  return out;
}

console.log("\nrome10 player record (after region list):");
console.log(dumpHex(buf, rlR10, 512, playerR10));
console.log("\nRoR Turn 1 player record (after region list):");
console.log(dumpHex(bufRoR, rlRoR, 512, playerRoR));
