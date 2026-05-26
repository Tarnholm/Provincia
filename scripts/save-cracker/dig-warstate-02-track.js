// The game restores war on load => war IS persisted. Prior diff was battle-
// contaminated. Track the PLAYER zone (tag=0) entries across the Spain sequence
// (pre-trade -> trade -> war) to see what flips when war is declared. af98 found
// trade flipped Carthage's entry (uuid=62) from class 5->2; what does WAR do?
const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const SEQ = [
  ["T1 (pre-trade)",       "save_17-05-2026   Spain   Turn 1.sav"],
  ["T1 move diplomat",     "save_17-05-2026   Spain   Turn 1move diplomat and army.sav"],
  ["T2 TRADE w/ carthage",  "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav"],
  ["T3 End (pre-war)",     "save_Autosave   Spain   Turn 3 End.sav"],
  ["T4 Start (pre-war)",   "save_Autosave   Spain   Turn 4 Start.sav"],
  ["T4 DECLARE WAR",       "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"],
  ["T4 besieged",          "save_Autosave   Spain   Turn 4 besiged .sav"],
  ["T4 (settled)",         "save_Autosave   Spain   Turn 4.sav"],
];
const MARKER = 0x39240005;

function playerZone(buf) {
  // Find the zone whose first entry tag(+12)==0 => the player's own perspective.
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 200) continue;
    if (i + 8 + 16 > buf.length) continue;
    if (buf.readUInt32LE(i + 8 + 12) !== 0) continue; // tag==0 only
    const entries = [];
    let ok = true;
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16; if (o + 16 > buf.length) { ok = false; break; }
      entries.push({ uuid: buf.readUInt32LE(o), class_: buf.readUInt32LE(o+4), att: buf.readUInt32LE(o+8), tag: buf.readUInt32LE(o+12) });
    }
    if (ok) return { marker: i, count, entries, fid: buf.readUInt32LE(i - 53), rev: buf.readUInt32LE(i - 4) };
  }
  return null;
}

const snaps = [];
for (const [label, name] of SEQ) {
  let buf; try { buf = fs.readFileSync(DIR + name); } catch { console.log(`skip ${label}`); continue; }
  const z = playerZone(buf);
  if (!z) { console.log(`${label}: NO player zone`); continue; }
  snaps.push({ label, z });
}

// Build a per-uuid timeline of class across snapshots.
const allUuids = new Set();
for (const s of snaps) for (const e of s.z.entries) allUuids.add(e.uuid);

console.log("player zone summary per save (fid / count / rev-counter@M-4 / class histogram):");
for (const s of snaps) {
  const ch = {}; for (const e of s.z.entries) ch[e.class_] = (ch[e.class_]||0)+1;
  console.log(`  ${s.label.padEnd(22)} fid=${s.z.fid} count=${s.z.count} rev=${s.z.rev}  class=${JSON.stringify(ch)}`);
}

// Show ONLY uuids whose class CHANGES across the sequence (the interesting ones).
console.log("\nentries whose class CHANGES across the sequence (uuid: class-per-save):");
const labels = snaps.map(s => s.label);
console.log("  uuid".padEnd(10) + labels.map(l => l.slice(0,10).padEnd(11)).join(""));
for (const uuid of [...allUuids].sort((a,b)=>a-b)) {
  const row = snaps.map(s => {
    const e = s.z.entries.find(x => x.uuid === uuid);
    return e ? `c${e.class_}` : "-";
  });
  if (new Set(row.filter(x=>x!=="-")).size > 1 || row.includes("-")) {  // changed or appeared/disappeared
    console.log("  " + String(uuid).padEnd(8) + row.map(r => r.padEnd(11)).join(""));
  }
}
