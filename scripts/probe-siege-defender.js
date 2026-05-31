// probe-siege-defender.js — dump target-side siege block + tval for each active siege.
//
// Besieger predicate (CONFIRMED, findings-siege-2026-05-30):
//   b[p+4]==0 && b[p+5]==1 && u32(p)==u32(p+14) && u32(p+18)==0
//   armyUUID=u32(p), siegeID=u32(p+6), turnsRemaining=u32(p+22)
// Target side: the siegeID appears a 2nd time inside the besieged settlement
//   record as `01 [siegeID:u32] [tval:u32]`. At the target occurrence T of the
//   4-byte siegeID, b[T-1] should be 0x01 and the tval is u32(T+4).
//
// Usage: node scripts/probe-siege-defender.js <save.sav> [<save2.sav>]

"use strict";
const fs = require("fs");
const path = require("path");
const { parseSieges } = require("../src/siegeParser.js");

function u32(b, o) { return b.readUInt32LE(o); }
function hex(b, o, n) {
  const out = [];
  for (let i = 0; i < n && o + i < b.length; i++) out.push(b[o + i].toString(16).padStart(2, "0"));
  return out.join(" ");
}

function analyze(file) {
  const buf = fs.readFileSync(file);
  const sieges = parseSieges(buf, []);
  console.log(`\n=== ${path.basename(file)}  (${(buf.length / 1e6).toFixed(1)} MB) — ${sieges.length} sieges ===`);
  const rows = [];
  for (const s of sieges) {
    const needle = Buffer.alloc(4); needle.writeUInt32LE(s.siegeId);
    const locs = []; let i = 0;
    while ((i = buf.indexOf(needle, i)) !== -1) { locs.push(i); i++; }
    const targetLocs = locs.filter((l) => Math.abs(l - s.offset) > 64);
    for (const T of targetLocs) {
      const pre = T >= 1 ? buf[T - 1] : -1;
      const tval = (T + 8 <= buf.length) ? u32(buf, T + 4) : null;
      rows.push({
        army: s.besiegerArmyUuid >>> 0,
        siegeId: s.siegeId >>> 0,
        turnsRemaining: s.turnsRemaining,
        bOffset: s.offset,
        tLoc: T,
        preByte: pre,
        is01: pre === 0x01,
        tval,
        ctx: hex(buf, Math.max(0, T - 4), 24),
      });
    }
  }
  for (const r of rows) {
    console.log(
      `army=${r.army.toString(16).padStart(8, "0")} siege=${r.siegeId.toString(16).padStart(8, "0")} ` +
      `turnsRem=${r.turnsRemaining} tLoc=${r.tLoc} pre=${r.preByte === -1 ? "?" : r.preByte.toString(16).padStart(2, "0")}${r.is01 ? "*" : ""} ` +
      `tval=${r.tval}  ctx[T-4..]=${r.ctx}`
    );
  }
  return { file, sieges, rows, buf };
}

const files = process.argv.slice(2);
const results = files.map(analyze);

if (results.length === 2) {
  const [A, B] = results;
  const byIdB = new Map();
  for (const r of B.rows) byIdB.set(r.siegeId, r);
  console.log(`\n--- cross-turn match by siegeId (${path.basename(A.file)} -> ${path.basename(B.file)}) ---`);
  let matches = 0;
  for (const ra of A.rows) {
    const rb = byIdB.get(ra.siegeId);
    if (!rb) continue;
    matches++;
    console.log(
      `siege=${ra.siegeId.toString(16).padStart(8, "0")} army=${ra.army.toString(16).padStart(8, "0")}  ` +
      `turnsRem ${ra.turnsRemaining}->${rb.turnsRemaining}   tval ${ra.tval}->${rb.tval}` +
      (ra.tval !== rb.tval ? `  [DELTA ${rb.tval - ra.tval}]` : "  [same]")
    );
  }
  console.log(`matched ${matches} sieges by siegeId across both saves`);

  const byArmyB = new Map();
  for (const r of B.rows) byArmyB.set(r.army, r);
  console.log(`\n--- cross-turn match by besieger armyUUID ---`);
  let am = 0;
  for (const ra of A.rows) {
    const rb = byArmyB.get(ra.army);
    if (!rb) continue;
    am++;
    console.log(
      `army=${ra.army.toString(16).padStart(8, "0")}  siege ${ra.siegeId.toString(16)}->${rb.siegeId.toString(16)}  ` +
      `turnsRem ${ra.turnsRemaining}->${rb.turnsRemaining}   tval ${ra.tval}->${rb.tval}` +
      (ra.tval !== rb.tval ? `  [DELTA ${rb.tval - ra.tval}]` : "  [same]")
    );
  }
  console.log(`matched ${am} sieges by armyUUID across both saves`);
}
