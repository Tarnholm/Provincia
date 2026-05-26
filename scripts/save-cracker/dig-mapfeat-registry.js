// dig-mapfeat-registry.js
// Dump the section-type registry from early (t0) and late (t7) "Dummies" saves.
// Map features (forts, watchtowers, roads) get built over turns; the registry's
// per-type counts may grow. Compare counts side-by-side to spot the section
// that holds dynamic map features.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function readRegistry(buf) {
  // Scan a wide window for the registry start: a [u32 count][ASCIIZ UPPER name] run.
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
            // require a couple consecutive entries to confirm a real table
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
  if (p < 0) return { start: -1, types: [] };
  const start = p;
  const types = [];
  while (true) {
    const count = buf.readUInt32LE(p);
    const nameStart = p + 4;
    const end = buf.indexOf(0x00, nameStart);
    if (end === -1 || end > nameStart + 60) break;
    const name = buf.slice(nameStart, end).toString("latin1");
    if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
    types.push({ id: types.length, name, count });
    p = end + 1;
  }
  return { start, end: p, types };
}

const earlyName = process.argv[2] || "save_t0.sav";
const lateName = process.argv[3] || "save_t7.sav";
const early = fs.readFileSync(path.join(SAVE_DIR, earlyName));
const late = fs.readFileSync(path.join(SAVE_DIR, lateName));

const re = readRegistry(early);
const rl = readRegistry(late);

console.log(`EARLY ${earlyName}: ${early.length.toLocaleString()} bytes, registry @0x${re.start.toString(16)}..0x${re.end.toString(16)}, ${re.types.length} types`);
console.log(`LATE  ${lateName}: ${late.length.toLocaleString()} bytes, registry @0x${rl.start.toString(16)}..0x${rl.end.toString(16)}, ${rl.types.length} types`);
console.log("");

// Build name->count maps
const me = new Map(re.types.map(t => [t.name, t.count]));
const ml = new Map(rl.types.map(t => [t.name, t.count]));
const allNames = new Set([...me.keys(), ...ml.keys()]);

console.log("ID  NAME                              t0     t7    Δ");
console.log("--- --------------------------------- ------ ------ ------");
// print in late order (canonical id)
const ordered = rl.types.length >= re.types.length ? rl.types : re.types;
for (const t of ordered) {
  const c0 = me.get(t.name);
  const c7 = ml.get(t.name);
  const d = (c0 != null && c7 != null) ? (c7 - c0) : "?";
  const star = (typeof d === "number" && d !== 0) ? "  <== CHANGED" : "";
  console.log(
    `${String(t.id).padStart(3)} ${t.name.padEnd(33)} ${String(c0 ?? "-").padStart(6)} ${String(c7 ?? "-").padStart(6)} ${String(d).padStart(6)}${star}`
  );
}

// Names present in only one
for (const nm of allNames) {
  if (!me.has(nm)) console.log(`  ONLY-IN-LATE: ${nm} = ${ml.get(nm)}`);
  if (!ml.has(nm)) console.log(`  ONLY-IN-EARLY: ${nm} = ${me.get(nm)}`);
}

// Flag any names that look map-feature-ish
console.log("\nName matches for fort/tower/road/bridge/border/overlay:");
for (const t of ordered) {
  if (/FORT|TOWER|WATCH|ROAD|BRIDGE|BORDER|OVERLAY|FEATURE|RALLY|FOG|MAP/i.test(t.name)) {
    console.log(`   ${t.name}  t0=${me.get(t.name)} t7=${ml.get(t.name)}`);
  }
}
