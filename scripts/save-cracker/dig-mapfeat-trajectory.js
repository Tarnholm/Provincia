// dig-mapfeat-trajectory.js
// Read registry counts for map-feature section types across a whole save
// trajectory. If forts/watchtowers are stored as top-level records, their
// registry count grows turn over turn. If counts are static, the records are
// nested (per-faction) and we must dig the body instead.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function readRegistry(buf) {
  let p = -1;
  for (let scan = 0x100; scan < 0x10000; scan++) {
    const count = buf.readUInt32LE(scan);
    if (count > 0 && count < 100000) {
      const nameStart = scan + 4;
      if (buf[nameStart] >= 0x41 && buf[nameStart] <= 0x5a) {
        const end = buf.indexOf(0x00, nameStart);
        if (end !== -1 && end < nameStart + 60) {
          const nm = buf.slice(nameStart, end).toString("latin1");
          if (/^[A-Z][A-Z_0-9]*$/.test(nm) && nm.length >= 3) {
            let q = end + 1, ok = 0;
            for (let k = 0; k < 3; k++) {
              const c2 = buf.readUInt32LE(q);
              const ns2 = q + 4;
              const e2 = buf.indexOf(0x00, ns2);
              if (e2 === -1 || e2 > ns2 + 60) break;
              const nm2 = buf.slice(ns2, e2).toString("latin1");
              if (!/^[A-Z][A-Z_0-9]*$/.test(nm2)) break;
              ok++; q = e2 + 1;
            }
            if (ok >= 2) { p = scan; break; }
          }
        }
      }
    }
  }
  if (p < 0) return new Map();
  const types = new Map();
  while (true) {
    const count = buf.readUInt32LE(p);
    const nameStart = p + 4;
    const end = buf.indexOf(0x00, nameStart);
    if (end === -1 || end > nameStart + 60) break;
    const name = buf.slice(nameStart, end).toString("latin1");
    if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
    types.set(name, count);
    p = end + 1;
  }
  return types;
}

// trajectories to inspect
const trajectories = {
  "Dummies (t0..t7)": [
    "save_t0.sav", "save_t1.sav", "save_t2.sav", "save_t3.sav",
    "save_t4.sav", "save_t5.sav", "save_t6.sav", "save_t7.sav",
  ],
  "Spain (T1..T4)": [
    "save_17-05-2026   Spain   Turn 1.sav",
    "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav",
    "save_Autosave   Spain   Turn 3 End.sav",
    "save_Autosave   Spain   Turn 4.sav",
  ],
};

const WATCH = [
  "FORT", "FORT_MANAGER", "FORT_SHROUD",
  "WATCHTOWER", "WATCHTOWER_MANAGER", "WATCHTOWER_SHROUD",
  "ROAD", "ROAD_MANAGER", "PORT", "PORT_MANAGER",
  "STRATEGY_MAP_POSITION", "POSITION", "STRATEGY_MAP",
  "FOG_OF_WAR_TABLE", "AMBIENT_OBJECT", "LANDMARK_MANAGER",
  "WORLD_MAP", "SIEGE", "SIEGE_ENGINE_QUEUE_ITEM",
];

for (const [label, files] of Object.entries(trajectories)) {
  console.log(`\n=================== ${label} ===================`);
  const cols = [];
  for (const f of files) {
    const fp = path.join(SAVE_DIR, f);
    if (!fs.existsSync(fp)) { console.log(`(missing ${f})`); continue; }
    cols.push({ f, reg: readRegistry(fs.readFileSync(fp)) });
  }
  // header
  const hdr = "TYPE".padEnd(28) + cols.map((c, i) => `s${i}`.padStart(6)).join("");
  console.log(hdr);
  console.log("file index legend:");
  cols.forEach((c, i) => console.log(`   s${i} = ${c.f}`));
  console.log("");
  for (const name of WATCH) {
    const row = name.padEnd(28) + cols.map(c => String(c.reg.get(name) ?? "-").padStart(6)).join("");
    // mark if any change
    const vals = cols.map(c => c.reg.get(name)).filter(v => v != null);
    const changed = vals.length > 1 && new Set(vals).size > 1;
    console.log(row + (changed ? "   <== VARIES" : ""));
  }
}
