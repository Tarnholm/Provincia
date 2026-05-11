// dig-trade9.js — confirm the "hinterland_roads" finding. List all
// hinterland_roads occurrences in rome6 vs rome7. If trade-route-related,
// the count should diverge between rome6 and rome7 (more or fewer entries
// after the messapian wipeout).
//
// Also check Brundisium and other Roman cities for the same pattern.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const a = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const b = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));

function countToken(buf, tok) {
  const tokB = Buffer.from(tok);
  let p = 0, count = 0;
  while ((p = buf.indexOf(tokB, p)) !== -1) { count++; p += 1; }
  return count;
}

for (const tok of ["hinterland_region", "hinterland_roads", "hinterland_port",
                   "core_building", "governmentA", "governmentB", "governmentC", "governmentD",
                   "port_buildings", "military_industrial_complex", "town_walls",
                   "default_set", "messapian", "calabrian", "salentinian",
                   "roman_general"]) {
  const ca = countToken(a, tok);
  const cb = countToken(b, tok);
  if (ca !== cb || ca > 0) {
    console.log(`  ${tok.padEnd(35)}: rome6=${String(ca).padStart(4)}  rome7=${String(cb).padStart(4)}  delta=${cb-ca}`);
  }
}

// Now also: are hinterland_roads positions correlated with settlements that have
// roads? Let me find all hinterland_roads positions in rome7 and which
// settlement name each precedes.
function findAll(buf, tok) {
  const tokB = Buffer.from(tok);
  const out = [];
  let p = 0;
  while ((p = buf.indexOf(tokB, p)) !== -1) { out.push(p); p += 1; }
  return out;
}

const hr_a = findAll(a, "hinterland_roads");
const hr_b = findAll(b, "hinterland_roads");
console.log(`\nhinterland_roads: rome6=${hr_a.length}  rome7=${hr_b.length}`);

// For each hinterland_roads position in rome7, look BACKWARD for the nearest
// preceding settlement name (UTF-16LE city name).
function findNearestCityNameBefore(buf, anchor) {
  // settlement name is preceded by marker 0x01 + u16 len, name in UTF-16LE.
  // Look for the byte pattern [01 LEN_LO LEN_HI ...] preceding anchor.
  // City names range 3-20 chars.
  for (let i = anchor - 4; i > Math.max(0, anchor - 4000); i--) {
    if (buf[i] === 0x01 && buf[i + 1] >= 3 && buf[i + 1] <= 25 && buf[i + 2] === 0) {
      const len = buf.readUInt16LE(i + 1);
      // Verify it's UTF-16LE ASCII chars
      let ok = true;
      const chars = [];
      for (let k = 0; k < len; k++) {
        const c = buf.readUInt16LE(i + 3 + k * 2);
        if (c < 0x20 || c > 0x7e) { ok = false; break; }
        chars.push(String.fromCharCode(c));
      }
      if (ok) return { pos: i, name: chars.join(""), nameStart: i + 3, dist: anchor - i };
    }
  }
  return null;
}

console.log(`\nrome7 hinterland_roads positions and nearest preceding city:`);
let printed = 0;
for (const p of hr_b.slice(0, 40)) {
  const ctx = findNearestCityNameBefore(b, p);
  if (ctx) console.log(`  0x${p.toString(16)}  → city='${ctx.name}'  dist=${ctx.dist}`);
  else console.log(`  0x${p.toString(16)}  → no city found`);
  if (++printed > 20) break;
}

console.log(`\nrome6 hinterland_roads positions and nearest preceding city:`);
printed = 0;
for (const p of hr_a.slice(0, 40)) {
  const ctx = findNearestCityNameBefore(a, p);
  if (ctx) console.log(`  0x${p.toString(16)}  → city='${ctx.name}'  dist=${ctx.dist}`);
  else console.log(`  0x${p.toString(16)}  → no city found`);
  if (++printed > 20) break;
}
