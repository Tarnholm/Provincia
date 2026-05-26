// dig-diplocat-npcsize.js
// Target #2: Do the 23 NPC major faction records contain a LARGE AI/diplomacy
// "brain" block (like the player's ~50KB block), or only the small diplo zone?
// Measure each record's span = gap to the next record, and characterize the
// region AFTER the diplo zone up to the next record's start.
const fs = require("fs");
const {
  parseFactionTreasuries,
  identifyFactionRecordOwners,
  identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = {
  "macedon t0 (RIS)":   "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav",
  "t0 (vanilla)":       "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_t0.sav",
};
const SM_FACTIONS = "C:/RIS/RIS/data/descr_sm_factions.txt";
const MARKER = 0x39240005;

function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8");
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}

let order = [];
try { order = loadFactionOrder(SM_FACTIONS); } catch {}

for (const [label, path] of Object.entries(SAVES)) {
  let buf;
  try { buf = fs.readFileSync(path); } catch { console.log(`\n### ${label}: NOT FOUND`); continue; }
  const recs = parseFactionTreasuries(buf);
  const owners = identifyFactionRecordOwners(buf, recs, order.length ? order : null);
  const player = identifyPlayerFactionFromSave(buf, recs);
  console.log(`\n############ ${label} ############  player=${player}  records=${recs.length}`);
  console.log("rec  faction              offset       span(toNext)  diploZoneOff  zoneCount  zoneEnd   tailToNext");
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const next = i + 1 < recs.length ? recs[i + 1].offset : null;
    const span = next ? next - r.offset : null;
    const zoneOff = r.offset + 244 + 4 * r.regionCount;
    const isMarker = zoneOff + 8 <= buf.length && buf.readUInt32LE(zoneOff) === MARKER;
    const zoneCount = isMarker ? buf.readUInt32LE(zoneOff + 4) : -1;
    const zoneEnd = isMarker ? zoneOff + 8 + zoneCount * 16 : -1;
    const tail = (next && zoneEnd > 0) ? next - zoneEnd : null;
    const fac = owners[i] ? (owners[i].factionName || "?") : "?";
    console.log(
      `${String(i).padStart(3)}  ${fac.padEnd(20)} 0x${r.offset.toString(16).padStart(8, "0")}  ${String(span).padStart(11)}  0x${zoneOff.toString(16).padStart(8, "0")}  ${String(zoneCount).padStart(6)}  0x${(zoneEnd > 0 ? zoneEnd : 0).toString(16).padStart(8, "0")}  ${String(tail).padStart(8)}`
    );
  }
  // Summarize span distribution
  const spans = [];
  for (let i = 0; i + 1 < recs.length; i++) spans.push(recs[i + 1].offset - recs[i].offset);
  spans.sort((a, b) => a - b);
  console.log(`\n  span min=${spans[0]} max=${spans[spans.length - 1]} median=${spans[spans.length >> 1]}`);
}
