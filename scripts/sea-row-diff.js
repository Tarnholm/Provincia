// ROW-LEVEL diff: model (governors ON) vs the 2026-07-05 per-route ground truth.
// Prints per-town row matches/mismatches + a summary score. Exact-for-all target:
// every GT row matched by a model row (same partner, same kind, same value) and
// no extra model rows. Run: node scripts/sea-row-diff.js
const fs = require("fs");
const path = require("path");
process.env.TRADE_DEBUG = "1"; global.__TDBG = [];
const im = require("../src/incomeModel.js");
const MOD = "C:\\RIS\\RIS\\data";
const SAVE = process.env.GT_SAVE || "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_05-07-2026   Republic of Rome   Turn 1.sav";
const GT = require("./ris-rome-perroute-gt-2026-07-05.json").towns;
const cs = require("../src/calibSaveOpts.js").buildCalibSaveOpts(MOD, SAVE);
const gov = (cs.opts && cs.opts.govEffectByCity) || {};
const opts = { isPlayer: true, govEffectByCity: gov };
if (cs.opts && cs.opts.popByCity) opts.popByCity = cs.opts.popByCity;
const B = im.computeTurn1Budget(MOD, "romans_julii", {}, opts);
if (B.error) { console.log("ERR", B.error); process.exit(1); }
// region -> city map from descr_regions
const dg = require("../src/descrStratGeneral.js");
const regTxt = fs.readFileSync(path.join(MOD, "world", "maps", "base", "descr_regions.txt"), "utf8");
const r2c = (dg.parseDescrRegions(regTxt) || {}).regionToCity || {};
const norm = s => String(s || "").toLowerCase().replace(/[ _]/g, "");
const cityOf = reg => norm(r2c[reg] || reg);
// model rows per town
const modelRows = {};
for (const r of global.__TDBG) {
  const t = norm(r.from);
  (modelRows[t] = modelRows[t] || []).push(r);
}
const totals = {}; for (const s of B.settlements) totals[norm(s.settlement)] = Math.round(s.trade);
let rowErr = 0, rowN = 0, rowExact = 0, missing = 0, phantom = 0;
for (const town in GT) {
  const t = norm(town);
  const gt = GT[town];
  const mrows = (modelRows[t] || []).slice();
  const mt = totals[t];
  console.log(`\n=== ${town}  model=${mt} actual=${gt.total} ${mt === gt.total ? "TOTAL=" : "TOTAL " + (mt - gt.total > 0 ? "+" : "") + (mt - gt.total)} ===`);
  // expand model rows into (partnerCity, kind, value) rows
  const mexp = [];
  for (const r of mrows) {
    const pc = cityOf(r.toRegion);
    if (r.kind === "land") { if (r.exp) mexp.push({ p: pc, kind: "land", v: r.exp, used: false }); }
    else {
      if (r.exp) mexp.push({ p: pc, kind: "sea_exp", v: r.exp, used: false });
      if (r.imp) mexp.push({ p: pc, kind: "sea_imp", v: r.imp, used: false });
    }
  }
  for (const g of gt.rows) {
    const gp = norm(g.partner);
    rowN++;
    // match by partner+kind first, then partner-only
    let m = mexp.find(x => !x.used && x.p === gp && x.kind === g.kind);
    if (!m) m = mexp.find(x => !x.used && x.p === gp && g.kind !== "land" && x.kind !== "land");
    if (!m) { missing++; rowErr += g.v; console.log(`  MISSING ${g.kind.padEnd(7)} ${g.partner.padEnd(14)} actual=${g.v} (no model row)`); continue; }
    m.used = true;
    const d = m.v - g.v; rowErr += Math.abs(d); if (d === 0) rowExact++;
    console.log(`  ${d === 0 ? "  =   " : "DIFF  "}${g.kind.padEnd(7)} ${g.partner.padEnd(14)} model=${String(m.v).padStart(4)} actual=${String(g.v).padStart(4)}${d !== 0 ? " Δ" + (d > 0 ? "+" : "") + d : ""}${m.kind !== g.kind ? "  [model kind " + m.kind + "]" : ""}`);
  }
  for (const m of mexp) if (!m.used && m.v > 0) { phantom++; rowErr += m.v; console.log(`  PHANTOM ${m.kind.padEnd(7)} ${m.p.padEnd(14)} model=${m.v} (no such row in game)`); }
}
console.log(`\n==== ROW SCORE: err=${rowErr}  exactRows=${rowExact}/${rowN}  missing=${missing} phantom=${phantom} ====`);
