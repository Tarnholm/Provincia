// Does ANY field of Carthage's entry (uuid=62) in Spain's player zone flip when
// war is declared? Dump the full 16-byte entry across the sequence. Also dump
// the full player-zone region bytes pre-war vs at-war to catch any nearby flip.
const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const SEQ = [
  ["T4 Start (pre-war)",   "save_Autosave   Spain   Turn 4 Start.sav"],
  ["T4 DECLARE WAR",       "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"],
  ["T4 (settled, at war)", "save_Autosave   Spain   Turn 4.sav"],
];
const MARKER = 0x39240005;
function playerZoneOffset(buf) {
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 200) continue;
    if (i + 8 + 16 > buf.length) continue;
    if (buf.readUInt32LE(i + 8 + 12) !== 0) continue;
    return { marker: i, count };
  }
  return null;
}
for (const [label, name] of SEQ) {
  let buf; try { buf = fs.readFileSync(DIR + name); } catch { console.log(`skip ${label}`); continue; }
  const z = playerZoneOffset(buf);
  if (!z) { console.log(`${label}: no zone`); continue; }
  // find uuid=62 entry
  let line = `${label.padEnd(22)} marker=0x${z.marker.toString(16)} `;
  for (let k = 0; k < z.count; k++) {
    const o = z.marker + 8 + k * 16;
    if (buf.readUInt32LE(o) === 62) {
      const bytes = [...buf.slice(o, o + 16)].map(b=>b.toString(16).padStart(2,"0")).join(" ");
      line += `carthage(62): [${bytes}]`;
    }
  }
  console.log(line);
  // Also dump 64 bytes AFTER the last entry (footer) and 32 before marker — any war flag nearby?
  const footer = z.marker + 8 + z.count * 16;
  console.log(`   footer @0x${footer.toString(16)}: ${[...buf.slice(footer, footer+24)].map(b=>b.toString(16).padStart(2,"0")).join(" ")}`);
}
