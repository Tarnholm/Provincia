// dig-siege-turn12.js
// Check Tarentum's defenses chain HP across save_7 (Tarentum not sieged), save_8 (Tarentum just sieged), save_9 (Tarentum siege ended).

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

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
      out.push({ offset: i, name, blockEnd: se + 2 });
    }
  }
  return out;
}

function findChain(buf, prevSettlementEnd, settlementOff, chainName) {
  for (let i = prevSettlementEnd; i < settlementOff - 8; i++) {
    const ln = buf.readUInt16LE(i);
    if (ln !== chainName.length + 1) continue;
    if (buf.slice(i + 2, i + 2 + chainName.length).toString("ascii") !== chainName) continue;
    if (buf[i + 2 + chainName.length] !== 0) continue;
    return i;
  }
  return -1;
}

for (const s of ["save_7.1.sav", "save_8.1.sav", "save_9.1.sav"]) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s));
  const markers = findAllSettlementMarkers(buf);
  console.log(`\n${s}:`);
  for (const name of ["Brundisium", "Tarentum"]) {
    const idx = markers.findIndex(m => m.name === name);
    if (idx < 0) { console.log(`  ${name}: NOT FOUND`); continue; }
    const set = markers[idx];
    const prev = markers[idx - 1];
    const defOff = findChain(buf, prev.blockEnd, set.offset, "defenses");
    if (defOff > 0) {
      // HP is at +0x28 from chain record's name start. Chain record starts at defOff.
      // Per buildingParser, healthAbs = i + name.length + 32 where i = chain record start.
      // chainName="defenses", length=8, so healthAbs = defOff + 8 + 32 = defOff + 40
      const hp = buf[defOff + 8 + 32];
      console.log(`  ${name} defenses @ 0x${defOff.toString(16)} hp=${hp}`);
      console.log(`    bytes [defOff..defOff+64]: ${buf.slice(defOff, defOff + 64).toString("hex")}`);
    }
  }
}
