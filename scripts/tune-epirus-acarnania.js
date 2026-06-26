// Tune sea trade for Epirus + Acarnanian League ONLY (user directive 2026-06-22: ignore the julii/carthage corpus).
const fs = require("fs");
const im = require("../src/incomeModel.js");
const cs = require("../src/calibSaveOpts.js");
const MOD = "C:/RIS/RIS/data";
const SDIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const rtext = fs.readFileSync(MOD + "/world/maps/base/descr_regions.txt", "latin1").split(/\r?\n/);
const r2s = {}; for (let i = 0; i < rtext.length; i++) { if (/^[A-Za-z]/.test(rtext[i]) && rtext[i + 1] && /^\t\S/.test(rtext[i + 1])) r2s[rtext[i].trim()] = rtext[i + 1].trim(); }

const SAVES = { epirus: "save_22-06-2026   Epirus   Turn 1.sav", acarnania: "save_22-06-2026   Acarnanian League   Turn 1.sav" };
const GAME = {
  epirus: { Ambrakia: 401, Phoinike: 264, Korkyra: 211, Kichyros: 315, Passaron: 83, Dodona: 28, "Antigoneia-Chaonia": 47, Orikon: 10, Atintanopolis: 14 },
  acarnania: { Stratos: 431, Oiniadai: 567, Leukas: 684 },
};
// per-route ground truth (from in-game scrolls). L=land, S=sea
const ROUTES = {
  Ambrakia: "Leukas 341(S) | Stratos 36(L) | Kichyros 24(L)",
  Stratos: "Kichyros 256+34(S) | Phoinike 27(S) | Oiniadai 30(L) | Thermon 17(L)",
  Leukas: "Oiniadai 497+82(S) | Stratos 36 | Ambrakia 69(imp,S)",
  Oiniadai: "Stratos 30 | Thermon 27 | Leukas 510(S)",
};
const opts = {}, br = {};
for (const f in SAVES) { const b = cs.buildCalibSaveOpts(MOD, SDIR + SAVES[f]); opts[f] = b.opts || {}; br[f] = {}; const sb = b.setBracketByCity || {}; for (const c in sb) if (sb[c] && sb[c] !== "normal") br[f][c] = sb[c]; }

function run(f, detail) {
  global.__TDBG = []; process.env.TRADE_DEBUG = "1";
  const B = im.computeTurn1Budget(MOD, f, br[f], { isPlayer: true, ...opts[f] });
  let e = 0; const rows = [];
  for (const k in GAME[f]) { const x = B.settlements.find(z => z.settlement === k); const m = x ? Math.round(x.trade) : 0; e += Math.abs(m - GAME[f][k]); rows.push(k.padEnd(20) + " model=" + String(m).padStart(4) + " game=" + String(GAME[f][k]).padStart(4) + (Math.abs(m - GAME[f][k]) > 3 ? "  Δ" + (m - GAME[f][k]) : "")); }
  if (detail) {
    rows.forEach(r => console.log("   " + r));
    for (const name in ROUTES) {
      const lanes = global.__TDBG.filter(r => r.from === name);
      if (!lanes.length) continue;
      const mm = {}; for (const r of lanes) { const to = r2s[r.toRegion] || r.toRegion; mm[to] = mm[to] || { e: 0, i: 0 }; mm[to].e += Math.round(r.exp || 0); mm[to].i += Math.round(r.imp || 0); }
      console.log("   " + name + " sea-lanes: " + Object.keys(mm).map(t => t + "(e" + mm[t].e + "/i" + mm[t].i + ")").join(" ") + "   [GAME " + ROUTES[name] + "]");
    }
  }
  return e;
}
const K = process.argv.includes("--seaK") ? Number(process.argv[process.argv.indexOf("--seaK") + 1]) : null;
if (K) im.CALIB.seaK_LF = K;
const PE = process.argv.includes("--popExp") ? Number(process.argv[process.argv.indexOf("--popExp") + 1]) : null;
if (PE) im.CALIB.seaPopExp = PE;
const FR = process.argv.includes("--frac") ? Number(process.argv[process.argv.indexOf("--frac") + 1]) : null;
if (FR != null) im.CALIB.seaImportFrac = FR;
if (process.argv.includes("--popsum")) im.CALIB.seaPopSum = true;
const PM = process.argv.includes("--popmode") ? process.argv[process.argv.indexOf("--popmode") + 1] : null;
if (PM) im.CALIB.seaPopMode = PM;
const detail = process.argv.includes("-d");
const E = run("epirus", detail), A = run("acarnania", detail);
console.log("seaK=" + im.CALIB.seaK_LF + "  EPIRUS=" + E + "  ACARNANIA=" + A + "  TOTAL=" + (E + A));
