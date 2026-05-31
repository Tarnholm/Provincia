// verify s7 global (ALL settlements, not just player) at T1 vs T3
"use strict";
const fs = require("fs");
const path = require("path");
const { parseSettlementFields } = require("../src/settlementFieldsParser.js");
const { findAllSettlementMarkers } = require("../src/buildingParser.js");
const D = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
for (const fn of ["save_Carthage1.sav", "save_carthage2.sav", "save_carthage3.sav", "save_julii1.sav", "save_julii3.sav"]) {
  const p = path.join(D, fn);
  if (!fs.existsSync(p)) { console.log("missing", fn); continue; }
  const buf = fs.readFileSync(p);
  const f = parseSettlementFields(buf, findAllSettlementMarkers(buf));
  const tot = Object.keys(f).length;
  const s7 = Object.values(f).filter((x) => x.order.startTransientBonus > 0).length;
  const s14 = Object.values(f).filter((x) => x.order.taxAdminLine > 0).length;
  console.log(`${fn.padEnd(22)} settlements=${tot}  s7>0=${s7}  s14>0=${s14}`);
}
