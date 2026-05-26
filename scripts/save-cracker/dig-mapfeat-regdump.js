// dig-mapfeat-regdump.js
// Dump the raw bytes of the registry around the FORT / WATCHTOWER / ROAD entries
// to understand the entry structure. Is the u32 before the name a live instance
// count, a version, or a class id? Show hex context around each target entry.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const f = process.argv[2] || "save_t0.sav";
const buf = fs.readFileSync(path.join(SAVE_DIR, f));

// Find registry start (reuse logic)
function regStart(buf) {
  for (let scan = 0x100; scan < 0x10000; scan++) {
    const count = buf.readUInt32LE(scan);
    if (count > 0 && count < 100000) {
      const ns = scan + 4;
      if (buf[ns] >= 0x41 && buf[ns] <= 0x5a) {
        const end = buf.indexOf(0x00, ns);
        if (end !== -1 && end < ns + 60) {
          const nm = buf.slice(ns, end).toString("latin1");
          if (/^[A-Z][A-Z_0-9]*$/.test(nm) && nm.length >= 3) {
            let q = end + 1, ok = 0;
            for (let k = 0; k < 3; k++) {
              const ns2 = q + 4, e2 = buf.indexOf(0x00, ns2);
              if (e2 === -1 || e2 > ns2 + 60) break;
              if (!/^[A-Z][A-Z_0-9]*$/.test(buf.slice(ns2, e2).toString("latin1"))) break;
              ok++; q = e2 + 1;
            }
            if (ok >= 2) return scan;
          }
        }
      }
    }
  }
  return -1;
}

const start = regStart(buf);
console.log(`${f}: registry @0x${start.toString(16)}`);

// Walk and print each entry with its byte offset, raw count u32, and hex of count
let p = start;
const targets = new Set(["FORT", "FORT_MANAGER", "WATCHTOWER", "WATCHTOWER_MANAGER", "ROAD", "ROAD_MANAGER", "PORT", "SIEGE", "ARMY", "UNIT", "POSITION"]);
let id = 0;
while (true) {
  const count = buf.readUInt32LE(p);
  const ns = p + 4;
  const end = buf.indexOf(0x00, ns);
  if (end === -1 || end > ns + 60) break;
  const name = buf.slice(ns, end).toString("latin1");
  if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
  if (targets.has(name)) {
    const ctx = Array.from(buf.subarray(p, p + 4)).map(x => x.toString(16).padStart(2, "0")).join(" ");
    console.log(`  id ${String(id).padStart(3)}  @0x${p.toString(16).padStart(5,"0")}  count=${String(count).padStart(5)} (${ctx})  ${name}`);
  }
  p = end + 1;
  id++;
}
