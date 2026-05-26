// dig-religion-block-scan.js
// Use the SAME settlement markers Provincia uses (findAllSettlementMarkers), then
// for chosen distinct-religion settlements, read the documented stats fields AND
// dump the full ~600-byte stats block, looking for the religion data.
//
// RIS has 53 beliefs (descr_beliefs order). A settlement holds a handful of
// non-zero faiths. Candidate encodings to hunt:
//   (a) dense 53×u8 array (sum~100)
//   (b) sparse (belief_idx u8/u32, percent u8/u32) pairs
//   (c) dense block at a FIXED offset from name
//
// Pure read.
const fs = require("fs");
const path = require("path");
const { findAllSettlementMarkers } = require(path.resolve(__dirname, "../../src/buildingParser.js"));

const SAVE = process.argv[3] || "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const NAMES = (process.argv[2] || "Pella,Alexandria,Carthage,Athinai,Roma,Rome").split(",");
const buf = fs.readFileSync(SAVE);

const markers = findAllSettlementMarkers(buf);
console.log("save:", path.basename(SAVE), "markers:", markers.length);

// Index markers by name
const byName = new Map();
for (const m of markers) {
  if (!byName.has(m.name)) byName.set(m.name, []);
  byName.get(m.name).push(m);
}

const SIZE = ["village","town","large_town","city","large_city","huge_city"];

for (const name of NAMES) {
  const list = byName.get(name);
  if (!list) { console.log("\n##### " + name + ": NOT among markers"); continue; }
  for (const m of list) {
    const np = m.offset + 1; // nchars byte
    const get32 = (rel) => (np + rel >= 0 && np + rel + 4 <= buf.length) ? buf.readUInt32LE(np + rel) : -1;
    const level = get32(-571);
    const po = buf[np - 435];
    const income = get32(-127);
    const pop = get32(-35);
    const validBlock = level >= 0 && level <= 5 && pop > 50 && pop < 200000;
    console.log("\n##### " + name + " marker@0x" + m.offset.toString(16) +
      " level=" + level + (SIZE[level] ? "("+SIZE[level]+")" : "") +
      " PO@-435=" + po + " income=" + income + " pop=" + pop +
      (validBlock ? "  [VALID STATS BLOCK]" : "  [stats look off]"));
    if (!validBlock) continue;

    // Scan the stats block (name-600 .. name) for a 53-byte dense run summing ~100.
    console.log("  -- dense 53×u8 sum~100 candidates within [name-600, name] --");
    let found = 0;
    for (let off = np - 600; off + 53 <= np; off++) {
      let sum = 0, nz = 0, ok = true, max = 0, maxi = -1;
      for (let i = 0; i < 53; i++) {
        const b = buf[off + i];
        if (b > 100) { ok = false; break; }
        sum += b; if (b > 0) nz++; if (b > max) { max = b; maxi = i; }
      }
      if (ok && sum >= 90 && sum <= 110 && nz >= 1 && nz <= 10) {
        console.log("     rel=" + (off - np) + " sum=" + sum + " nz=" + nz + " domIdx=" + maxi + "(" + max + ") bytes=[" +
          Array.from(buf.slice(off, off + 53)).map((v, i) => v ? i + ":" + v : null).filter(Boolean).join(",") + "]");
        found++;
        if (found > 6) break;
      }
    }
    if (!found) console.log("     none");

    // Sparse-pair hunt: look for u8 (idx<53) followed by u8 percent, runs whose
    // percents sum ~100. Format guess: [count][ (idx,pct) * count ].
    console.log("  -- sparse [count][(idx_u8,pct_u8)*] candidates --");
    let sfound = 0;
    for (let off = np - 600; off < np - 4; off++) {
      const cnt = buf[off];
      if (cnt < 1 || cnt > 8) continue;
      let sum = 0, ok = true;
      const pairs = [];
      for (let k = 0; k < cnt; k++) {
        const idx = buf[off + 1 + k * 2];
        const pct = buf[off + 2 + k * 2];
        if (idx >= 53 || pct > 100) { ok = false; break; }
        sum += pct; pairs.push(idx + ":" + pct);
      }
      if (ok && sum >= 95 && sum <= 105) {
        console.log("     rel=" + (off - np) + " count=" + cnt + " sum=" + sum + " [" + pairs.join(",") + "]");
        if (++sfound > 6) break;
      }
    }
    if (!sfound) console.log("     none");
  }
}
