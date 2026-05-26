// dig-pop-locate.js
//
// Foundation script for the population-dynamics crack.
// 1. Locate all settlement name markers (via the same heuristic as
//    buildingParser.findAllSettlementMarkers).
// 2. For each settlement, read the known stats-block fields at name-relative
//    offsets (creator -583, level -571, tax -562, PO -435, income -127, pop -35).
// 3. Dump a window of the full stats block (name-600 .. name) as u32 grid so we
//    can eyeball candidate growth fields.
//
// Validates the reference_settlement_stats_block memory on the Spain save and
// prints a per-settlement table.
import { loadSave, hex } from "./loader.js";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const file = process.argv[2] || "save_17-05-2026   Spain   Turn 1.sav";
const s = loadSave(path.join(SAVE_DIR, file));
const buf = s.buf;
console.log(`file: ${file}  size: ${buf.length.toLocaleString()}`);

// --- settlement marker locator (mirror buildingParser) ---
function findAllSettlementMarkers(buf) {
  const out = [];
  for (let i = 0; i < buf.length - 30; i++) {
    const flag = buf[i];
    if (flag !== 0x01 && flag !== 0x00) continue;
    const nc = buf[i + 1];
    if (nc < 3 || nc > 32 || buf[i + 2] !== 0) continue;
    const se = i + 3 + nc * 2;
    if (se + 2 > buf.length || buf[se] !== 0 || buf[se + 1] !== 0) continue;
    let ok = true, name = "";
    for (let j = i + 3; j < se; j += 2) {
      const lo = buf[j], hi = buf[j + 1];
      if (hi !== 0 || lo < 0x20 || lo > 0x7e) { ok = false; break; }
      name += String.fromCharCode(lo);
    }
    if (ok && name[0] >= "A" && name[0] <= "Z") {
      // namePos = the UTF-16 char start = i+3. Memory offsets are dx from "name"
      // = the UTF-16 char start position.
      out.push({ markerStart: i, namePos: i + 3, name, blockEnd: se + 2 });
    }
  }
  return out;
}

const settlements = findAllSettlementMarkers(buf);
console.log(`settlement markers found: ${settlements.length}\n`);

// Known cities for Spain to anchor.
const ANCHOR = new Set(["Corduba", "Numantia", "Asturica", "Scallabis", "Osca",
  "Carthago", "Carthago Nova", "Caralis", "Lilybaeum", "Panormus"]);

function rd(dx, namePos) {
  const o = namePos + dx;
  if (o < 0 || o + 4 > buf.length) return null;
  return buf.readUInt32LE(o);
}

const KNOWN = {
  "creator(-583)": -583,
  "level(-571)": -571,
  "tax(-562,u8)": -562,
  "PO(-435)": -435,
  "income(-127)": -127,
  "pop(-35)": -35,
};

console.log("ALL markers (name, level@-571, pop@-35):");
for (const st of settlements) {
  const lvl = rd(-571, st.namePos);
  const pop = rd(-35, st.namePos);
  console.log(`  0x${st.namePos.toString(16).padStart(7,"0")}  ${st.name.padEnd(18)} lvl=${lvl}  pop=${pop}`);
}
