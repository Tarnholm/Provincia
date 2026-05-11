// dig-occupy1.js
// Locate Uria settlement records in save_9.1 (pre-enslave), save_10.1 (post-enslave),
// save_11.1 (Brundisium captured), save_12.1 (exterminate Uria). Also locate Brundisium
// in save_10.1 (pre-capture) and save_11.1 (post-capture/occupy).

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function load(name) {
  return fs.readFileSync(path.join(SAVE_DIR, name));
}

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

function findByName(markers, name) {
  return markers.filter(m => m.name === name);
}

const saves = ["save_9.1.sav", "save_10.1.sav", "save_11.1.sav", "save_12.1.sav"];
const results = {};
for (const s of saves) {
  const buf = load(s);
  const markers = findAllSettlementMarkers(buf);
  results[s] = {
    size: buf.length,
    totalMarkers: markers.length,
    uria: findByName(markers, "Uria"),
    brundisium: findByName(markers, "Brundisium"),
    tarentum: findByName(markers, "Tarentum"),
  };
}

for (const [name, r] of Object.entries(results)) {
  console.log(`=== ${name} (${r.size} bytes, ${r.totalMarkers} markers) ===`);
  console.log(`  Uria:        ${r.uria.map(u => "0x" + u.offset.toString(16)).join(", ") || "NONE"}`);
  console.log(`  Brundisium:  ${r.brundisium.map(u => "0x" + u.offset.toString(16)).join(", ") || "NONE"}`);
  console.log(`  Tarentum:    ${r.tarentum.map(u => "0x" + u.offset.toString(16)).join(", ") || "NONE"}`);
}
