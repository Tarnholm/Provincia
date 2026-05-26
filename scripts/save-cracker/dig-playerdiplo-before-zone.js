// The AI/diplo block is likely BEFORE the player's diplo marker.
// Map backward: look at the structure preceding markerOff. Find where the
// player record begins. Look for the class-100-equivalent or a header.
const fs = require("fs");
const {
  parseFactionTreasuries,
  identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = {
  seleucid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav",
  antigonid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav",
};
const MARKER = 0x39240005;

function hexdump(buf, start, len) {
  let out = "";
  for (let i = 0; i < len; i += 16) {
    const off = start + i;
    let hex = "", asc = "";
    for (let j = 0; j < 16 && i + j < len; j++) {
      const b = buf[off + j];
      hex += b.toString(16).padStart(2, "0") + " ";
      asc += (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".";
    }
    out += `0x${off.toString(16)}: ${hex.padEnd(48)} ${asc}\n`;
  }
  return out;
}

for (const [label, path] of Object.entries(SAVES)) {
  const buf = fs.readFileSync(path);
  const recs = parseFactionTreasuries(buf);
  const player = identifyPlayerFactionFromSave(buf, recs);
  const firstMajor = recs[0].offset;
  let markerOff = -1;
  for (let i = 0; i + 8 < firstMajor; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const cnt = buf.readUInt32LE(i + 4);
    if (cnt > 0 && cnt <= 250) { markerOff = i; break; }
  }
  console.log(`\n===== ${label} (${player}) markerOff=0x${markerOff.toString(16)} =====`);
  // Dump 256 bytes BEFORE the marker
  console.log(`--- 256 bytes before diplo marker ---`);
  console.log(hexdump(buf, markerOff - 256, 256));
  console.log(`--- marker + first 2 entries ---`);
  console.log(hexdump(buf, markerOff, 48));
}
