// Each 53-byte faction-config record has many unexplored bytes.
// Find the records and dump them. Compare to known starting treasuries
// (from descr_strat) for each faction in RIS Macedon T0.
const fs = require("fs");
const {
  parseHeader,
  parseFactionDiscoveredBitmask,
  parseFactionConfigRecords,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const hdr = parseHeader(buf);
const bm = parseFactionDiscoveredBitmask(buf, hdr);
const cfg = parseFactionConfigRecords(buf, hdr, bm);

console.log(`config records: ${cfg.factionCount}, first at 0x${cfg.firstMarker.toString(16)}, recordSize=${cfg.recordSize}`);

// Dump first 5 records' full 53 bytes
for (let i = 0; i < 5; i++) {
  const ofs = cfg.firstMarker + i * cfg.recordSize;
  console.log(`\nrec ${i} @ 0x${ofs.toString(16)} factionIndex=${cfg.records[i].factionIndex}:`);
  for (let line = 0; line < 53; line += 16) {
    let hex = "", asc = "";
    for (let j = 0; j < 16 && line + j < 53; j++) {
      const b = buf[ofs + line + j];
      hex += b.toString(16).padStart(2, "0") + " ";
      asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
    }
    console.log(`  +${line.toString().padStart(2)}: ${hex.padEnd(48)} | ${asc}`);
  }
}

// Try reading u32 values at every offset within each record — look for
// values in plausible treasury range (1000-100000)
console.log("\n=== u32 values at each offset across all records (looking for treasury pattern) ===");
const offsetValues = [];
for (let off = 0; off + 4 <= 53; off++) {
  const values = [];
  for (let i = 0; i < cfg.factionCount; i++) {
    const baseOff = cfg.firstMarker + i * cfg.recordSize;
    values.push(buf.readUInt32LE(baseOff + off));
  }
  // Check if these look like treasury values (mostly in 1000-100000 range)
  const inRange = values.filter(v => v >= 1000 && v <= 100000).length;
  const allSame = new Set(values).size === 1;
  const allZero = values.every(v => v === 0);
  offsetValues.push({ off, values, inRange, allSame, allZero });
}

for (const o of offsetValues) {
  if (o.allZero) continue;
  if (o.allSame) {
    console.log(`+${o.off.toString().padStart(2)}: all same = ${o.values[0]} (0x${o.values[0].toString(16)})`);
  } else if (o.inRange > cfg.factionCount * 0.5) {
    console.log(`+${o.off.toString().padStart(2)}: ${o.inRange}/${cfg.factionCount} in treasury range — sample: ${o.values.slice(0, 10).join(", ")}`);
  } else {
    // Just show first 10 values
    console.log(`+${o.off.toString().padStart(2)}: ${o.values.slice(0, 10).map(v => v.toString(16)).join(", ")}`);
  }
}
