// dig-econ-fingerprint-section.js
// Robust section locator. The 23 major-faction treasuries form a UNIQUE
// fingerprint per save (e.g. T2: antigonid=16833, ptolemaic=24105, seleucid=32032,
// bactria=20641, parni=8087, ...). If a separate FACTION_ECONOMICS array exists, one
// of its 36 fields per record should equal (or correlate with) treasury/income.
//
// Approach: take the ordered list of class-100 treasuries (in record order). Scan
// the whole body for any offset O and stride S where reading i32 at O + k*S for
// k=0..22 reproduces that exact ordered list. That uniquely identifies a parallel
// per-faction array (the econ section) and its stride. Then we know S = econ
// record size and can decode all 36 fields by walking each column.

const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav" };

for (const [tag, f] of Object.entries(FILES)) {
  const buf = fs.readFileSync(path.join(BASE, f));
  const recs = parseFactionTreasuries(buf);
  // record order = the order parseFactionTreasuries returns them (= body order)
  const treas = recs.map(r => r.treasury);
  console.log(`\n===== [${tag}] ${recs.length} class-100 records, treasuries in body order =====`);
  console.log("  " + treas.join(", "));

  // Build an index of every offset whose i32 == treas[0]
  const first = treas[0];
  const t0 = Buffer.alloc(4); t0.writeInt32LE(first);
  const starts = [];
  let p = 0;
  while ((p = buf.indexOf(t0, p)) !== -1) { starts.push(p); p++; }
  console.log(`  treas[0]=${first} appears ${starts.length} times`);

  // For each start, try strides. Require reproducing >=8 of the next treasuries
  // in order at constant stride.
  const found = [];
  for (const O of starts) {
    // try strides from 4 up to 4096
    for (let S = 4; S <= 4096; S += 4) {
      let good = 1;
      for (let k = 1; k < treas.length; k++) {
        const off = O + k * S;
        if (off + 4 > buf.length) { good = -1; break; }
        if (buf.readInt32LE(off) === treas[k]) good++;
        else break;
      }
      if (good >= 6) found.push({ O, S, good });
    }
  }
  found.sort((a, b) => b.good - a.good);
  if (found.length === 0) {
    console.log("  NO parallel treasury array found (treasury is NOT replicated in a separate per-faction econ array)");
  } else {
    console.log(`  FOUND ${found.length} candidate arrays:`);
    for (const c of found.slice(0, 10)) {
      console.log(`    O=0x${c.O.toString(16)} stride=${c.S} matched=${c.good}/${treas.length}`);
    }
  }
}
