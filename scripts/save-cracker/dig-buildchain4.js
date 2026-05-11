// dig-buildchain4.js — Compare saveturn1start (no construction) vs saveturn1construction
// (construction in progress) to find the construction-queue counter / turns-remaining field.

const fs = require("fs");
const path = require("path");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-49-17-100Z";

const startBuf = fs.readFileSync(path.join(ARCHIVE, "0010_save_saveturn1start.sav"));
const constrBuf = fs.readFileSync(path.join(ARCHIVE, "0008_save_saveturn1construction.sav"));
const buildBuf = fs.readFileSync(path.join(ARCHIVE, "0007_save_saveturn1building.sav"));

console.log(`sizes: start=${startBuf.length}, build=${buildBuf.length}, constr=${constrBuf.length}`);

// Find all default_set positions in each save and diff them
function findAll(buf, tok) {
  const out = [];
  const t = Buffer.from(tok);
  let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) {
    if (p - 2 >= 0 && buf.readUInt16LE(p - 2) === tok.length + 1 && buf[p + tok.length] === 0) {
      out.push(p);
    }
    p += 1;
  }
  return out;
}

// The settlement that's under construction: which one?
// Compare the per-settlement sub-records between start and construction.
// We'll look for ANY sub-record byte that changes.
const sH = findAll(startBuf, "default_set");
const cH = findAll(constrBuf, "default_set");
console.log(`start: ${sH.length} default_set, constr: ${cH.length}`);

// Compare default_set payloads at each position pair (assuming same order = same settlement)
const minN = Math.min(sH.length, cH.length);
console.log("\nDiff per default_set:");
for (let i = 0; i < minN; i++) {
  const sP = sH[i] + "default_set".length + 1;
  const cP = cH[i] + "default_set".length + 1;
  let diffCount = 0;
  const diffs = [];
  for (let j = 0; j < 80; j++) {
    if (startBuf[sP + j] !== constrBuf[cP + j]) {
      diffCount++;
      if (diffs.length < 10) diffs.push(`+${j}: 0x${startBuf[sP+j].toString(16)}→0x${constrBuf[cP+j].toString(16)}`);
    }
  }
  if (diffCount > 0) {
    console.log(`  default_set #${i} (start@0x${sH[i].toString(16)}, constr@0x${cH[i].toString(16)}): ${diffCount} diff bytes`);
    for (const d of diffs) console.log(`    ${d}`);
  }
}

// Also look at core_building sub-records
console.log("\nDiff per core_building:");
const sCH = findAll(startBuf, "core_building");
const cCH = findAll(constrBuf, "core_building");
const minN2 = Math.min(sCH.length, cCH.length);
for (let i = 0; i < minN2; i++) {
  const sP = sCH[i] + "core_building".length + 1;
  const cP = cCH[i] + "core_building".length + 1;
  let diffCount = 0;
  const diffs = [];
  for (let j = 0; j < 80; j++) {
    if (startBuf[sP + j] !== constrBuf[cP + j]) {
      diffCount++;
      if (diffs.length < 10) diffs.push(`+${j}: 0x${startBuf[sP+j].toString(16)}→0x${constrBuf[cP+j].toString(16)}`);
    }
  }
  if (diffCount > 0) {
    console.log(`  core_building #${i} (start@0x${sCH[i].toString(16)}, constr@0x${cCH[i].toString(16)}): ${diffCount} diff bytes`);
    for (const d of diffs) console.log(`    ${d}`);
  }
}

// Other sub-records
const SUBNAMES = ["defenses", "barracks", "hinterland_farms", "hinterland_roads", "port_buildings", "theatres"];
for (const sub of SUBNAMES) {
  const sH = findAll(startBuf, sub);
  const cH = findAll(constrBuf, sub);
  const minN = Math.min(sH.length, cH.length);
  for (let i = 0; i < minN; i++) {
    const sP = sH[i] + sub.length + 1;
    const cP = cH[i] + sub.length + 1;
    let diffCount = 0;
    const diffs = [];
    for (let j = 0; j < 80; j++) {
      if (startBuf[sP + j] !== constrBuf[cP + j]) {
        diffCount++;
        if (diffs.length < 12) diffs.push(`+${j}: 0x${startBuf[sP+j].toString(16)}→0x${constrBuf[cP+j].toString(16)}`);
      }
    }
    if (diffCount > 0) {
      console.log(`\n${sub} #${i} (start@0x${sH[i].toString(16)}, constr@0x${cH[i].toString(16)}): ${diffCount} diff bytes`);
      for (const d of diffs) console.log(`    ${d}`);
    }
  }
}
