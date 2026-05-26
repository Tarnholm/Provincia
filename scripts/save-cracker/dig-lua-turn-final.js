// dig-lua-turn-final.js
//
// FINAL: absolute turn = u32 at (end-of-"descr_strat.txt"-UTF16 + 5), 0-based.
// Layout after the mod-path string in the header:
//   <u32 backPtr> 01 <u32 turn0based> <i32 year> 00000000 <i32 year> ...
// display turn = turn0based + 1 ; year is signed (negative = BC).
//
// Validate turn across the full known-turn corpus and decode the year field at
// +9 (the i32 after the turn). Cross-check that year tracks turn (~2 turns/yr
// early, 1 turn/yr later in vanilla RTW).

const fs = require("fs");
const path = require("path");

const SAVES_DIR =
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const anchor = Buffer.from("descr_strat", "utf16le");

function readTurnAndYear(buf) {
  const region = buf.slice(0, 0x10000);
  let pos = -1, last = -1;
  while ((pos = region.indexOf(anchor, last + 1)) !== -1) last = pos;
  if (last < 0) return null;
  // end of UTF-16 printable run
  let end = last;
  while (end + 2 <= buf.length) {
    const lo = buf[end], hi = buf[end + 1];
    if (hi === 0 && lo >= 0x20 && lo <= 0x7e) end += 2;
    else break;
  }
  const backPtr = buf.readUInt32LE(end);     // +0
  const marker = buf[end + 4];               // +4  (expect 0x01)
  const turn0 = buf.readUInt32LE(end + 5);   // +5  0-based turn
  const year = buf.readInt32LE(end + 9);     // +9  signed campaign year
  return { anchorEnd: end, backPtr, marker, turn0, year };
}

const KNOWN = [
  ["save_t0.sav", null], ["save_t1.sav", null], ["save_t2.sav", null],
  ["save_t3.sav", null], ["save_t4.sav", null], ["save_t5.sav", null],
  ["save_t6.sav", null], ["save_t7.sav", null],
  ["save_17-05-2026   Spain   Turn 1.sav", 1],
  ["save_17-05-2026   Spain   Turn 1 move spy.sav", 1],
  ["save_17-05-2026   Spain   Turn 1move diplomat and army.sav", 1],
  ["save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav", 2],
  ["save_Autosave   Spain   Turn 3 inflitrated city with spy..sav", 3],
  ["save_Autosave   Spain   Turn 3 End.sav", 3],
  ["save_Autosave   Spain   Turn 4 Start.sav", 4],
  ["save_Autosave   Spain   Turn 4.sav", 4],
  ["save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav", 4],
  ["save_Autosave   Spain   Turn 4 besiged corduba.sav", 4],
  ["save_arretium pre retrained..sav", null],
  ["save_arretium retrained turn 2.sav", 2],
  ["save_arretium turn 2 new unit queued.sav", 2],
  ["save_arretium turn 3.sav", 3],
  ["save_arretium turn 4.sav", 4],
  ["save_Autosave   Carthage   Turn 1 End.sav", 1],
  ["save_Autosave   Carthage   Turn 2 Start.sav", 2],
  ["save_Autosave   Carthage   Turn 2.sav", 2],
  ["save_Autosave   Republic of Rome   Turn 2.sav", 2],
  ["save_Autosave   Republic of Rome   Turn 4 End.sav", 4],
  ["save_Autosave   Republic of Rome   Turn 5 Start.sav", 5],
  ["save_Autosave   Dummies   Turn 7 End.sav", 7],
  ["save_Autosave   Dummies   Turn 8 Start.sav", 8],
  ["save_Autosave   Dummies   Turn 8.sav", 8],
  ["save_Autosave   Antigonid Kingdom   Turn 1.sav", 1],
  ["save_Autosave   Seleucid Empire   Turn 1.sav", 1],
  ["save_macedon t0.sav", null],
  ["save_Seleucids t0.sav", null],
  ["save_t4 adoption.sav", 4],
  ["save_t5 adoption.sav", 5],
];

console.log("display | turn0 | turn0+1 | match | year | marker | anchorEnd | file");
console.log("--------|-------|---------|-------|------|--------|-----------|-----");
let checked = 0, ok = 0;
for (const [file, disp] of KNOWN) {
  const full = path.join(SAVES_DIR, file);
  if (!fs.existsSync(full)) { console.log(`(missing) ${file}`); continue; }
  const buf = fs.readFileSync(full);
  const r = readTurnAndYear(buf);
  if (!r) { console.log(`NO-ANCHOR ${file}`); continue; }
  let m = "";
  if (disp != null) {
    checked++;
    if (r.turn0 + 1 === disp) { ok++; m = "OK"; }
    else m = "FAIL";
  }
  const yearStr = r.year < 0 ? `${-r.year} BC` : `${r.year} AD`;
  console.log(
    `${String(disp ?? "?").padStart(7)} | ${String(r.turn0).padStart(5)} | ${String(r.turn0 + 1).padStart(7)} | ${m.padEnd(5)} | ${yearStr.padStart(7)} | 0x${r.marker.toString(16).padStart(2,"0")} | 0x${r.anchorEnd.toString(16).padStart(5)} | ${file}`
  );
}
console.log(`\nturn0+1 == display: ${ok}/${checked}`);

// Turn-vs-year for player t0..t7 (vanilla cadence check).
console.log("\nPlayer t0..t7 turn0 / year:");
for (let i = 0; i <= 7; i++) {
  const f = `save_t${i}.sav`;
  const full = path.join(SAVES_DIR, f);
  if (!fs.existsSync(full)) continue;
  const r = readTurnAndYear(fs.readFileSync(full));
  console.log(`  ${f}: turn0=${r.turn0} year=${r.year < 0 ? -r.year + " BC" : r.year + " AD"}`);
}
