// ★ RIS SEA-LAW DERIVATION PROOF (2026-07-05, row-exact crack).
// Independently re-derives the law from raw mod data against the 18 known turn-1 flows of the
// per-route ground truth (ris-rome-perroute-gt-2026-07-05.json) WITHOUT going through the model's
// lane machinery. Asserts all 18 exact and prints the feasible windows that pin each constant:
//
//   displayed export = ceil( M_X · 800 · (0.1·fastSqrt(popX+popY) + cargoFull + B) · gate / dNav )
//   import row at partner = ceil(0.2 × that value)
//   M_X = 1 + tradePct_X/10 + govTrading_X/100 (additive; Rome's +10% governor at FULL coefficient)
//   gate: own/SPQR/rights 1.0, plain foreign 0.5;  B = 1.0 (window 0.998..1.001); coef exactly 0.1.
//
// The four "sea_imp" rows at Venusia/Canusium/Arpi/Locri are those towns' OWN one-way exports
// (52/22/39/43 land exactly on the export law with their own M) — the scroll shows one-way lanes
// in the import column; they are NOT 0.2× tariffs (no law reaches the needed 2.7-4.4× gates).
// Run: node scripts/fit-law.js
const im = require("../src/incomeModel.js");
const MOD = "C:\\RIS\\RIS\\data";
const lfg = im.landingFrontierGraph(MOD);
const { ownerOfRegion, popOfRegion } = im.tradePartnerCtx(MOD);
const { qty: GQ, rawValues: RV } = im.tradeQtyMapsByRegion(MOD);
const pct = {};
for (const f of new Set(Object.values(ownerOfRegion))) {
  if (f === "slave") continue;
  try { const F = im.computeIncomeFeatures(MOD, f); for (const s of (F.settlements || [])) pct[s.region] = s.tradePct || 0; } catch {}
}
const fsq = (x) => { const b = new ArrayBuffer(4), f = new Float32Array(b), i = new Int32Array(b); f[0] = x; i[0] = (((i[0] + 0xc0800000) | 0) >> 1) + 0x3f800000; return f[0]; };
const dOf = (X, Y) => { const e = (lfg[X] || []).find(z => z.region === Y); return e ? e.dist : null; };
const cargo = (X, Y) => { const a = GQ[X] || {}, b = GQ[Y] || {}; let c = 0; for (const r in a) if (!(r in b)) c += a[r] * (RV[r] || 0); return c; };
// [exporterRegion, importerRegion, gate, kind, observed]  kind: exp = ceil(v)=obs | imp = ceil(0.2v)=obs
// gate 1.0 = own faction or trade rights (alliance 199 / become_protector — lucanians ARE a scripted
// protectorate of Rome, which is why Grumentum→Neapolis prices at 1.0); 0.5 = plain foreign.
const FLOWS = [
  ["Roma", "Latium_Novum", 1.0, "exp", 489, "gov"],       // Rome's +10% trading governor (save)
  ["Roma", "Campania", 1.0, "exp", 288, "gov"],           // 287.98 — the ceil-display upper pin
  ["Latium_Novum", "Roma", 1.0, "exp", 183],              // Δ vs Roma→LatN = exactly cargo Δ ⇒ pin=popX+popY
  ["Etruria_Meridionalis", "Latium", 1.0, "exp", 207],    // full cargo incl silver (no skip)
  ["Parthenope", "Latium_Novum", 1.0, "exp", 126],
  ["Etruria_Septentrionalis", "Etruria_Meridionalis", 1.0, "exp", 41], // Pisae→Cosa (own beats nearer foreign)
  ["Etruria_Occidentalis", "Roma", 1.0, "exp", 49],       // Volaterrae→Rome
  ["Ager_Gallicus", "Histria", 0.5, "exp", 48],           // foreign 0.500 pin #1
  ["Metapontion", "Chonia", 1.0, "exp", 81],              // raw dNav 46.1 (no nav-ratio floor)
  ["Peucetia", "Issa", 0.5, "exp", 52],                   // Venusia's one-way export (import-column row)
  ["Kanysion", "Issa", 0.5, "exp", 22],
  ["Daunia", "Issa", 0.5, "exp", 39],
  ["Lokroi_Epizephyrioi", "Chonia", 1.0, "exp", 43],      // Locri's one-way export to Petelia
  ["Campania", "Roma", 1.0, "imp", 67],                   // Rome's import = ceil(0.2×334.5)
  ["Chonia", "Metapontion", 1.0, "imp", 34],
  ["Lucania", "Parthenope", 1.0, "imp", 15],              // lucanians = scripted protectorate ⇒ 1.0
  ["Ingaunia", "Etruria_Septentrionalis", 0.5, "imp", 13],// foreign 0.500 pin #2
  ["Corsica", "Etruria_Occidentalis", 0.5, "imp", 16],    // foreign 0.500 pin #3
];
function evalAll(B, coef, govC) {
  let exact = 0; const rows = [];
  for (const [X, Y, gate, kind, obs, flag] of FLOWS) {
    const d = dOf(X, Y);
    const pin = (popOfRegion[X] || 1500) + (popOfRegion[Y] || 1500);
    const M = Math.max(0, 1 + (pct[X] || 0) / 10 + (flag === "gov" ? 0.1 * govC : 0));
    const v = M * 800 * (coef * fsq(pin) + cargo(X, Y) + B) * gate / d;
    const shown = kind === "exp" ? Math.ceil(v) : Math.ceil(0.2 * v);
    if (shown === obs) exact++;
    rows.push({ X, Y, kind, obs, shown, v: +v.toFixed(3), ok: shown === obs });
  }
  return { exact, rows };
}
const R = evalAll(1.0, 0.1, 1.0);
for (const r of R.rows) console.log(`${r.ok ? "  =  " : " XX  "}${r.X.padEnd(25)} -> ${r.Y.padEnd(25)} ${r.kind} obs=${String(r.obs).padStart(3)} model=${String(r.shown).padStart(3)} v=${r.v}`);
console.log(`\nEXACT: ${R.exact}/${FLOWS.length} at B=1.0 coef=0.1 govC=1.0 (ceil display)`);
let lo = null, hi = null;
for (let B = 0.5; B <= 1.5005; B += 0.001) if (evalAll(B, 0.1, 1.0).exact === FLOWS.length) { if (lo == null) lo = B; hi = B; }
console.log(`full-exact B window: ${lo && lo.toFixed(3)} .. ${hi && hi.toFixed(3)} (pins the flat base term at 1.0)`);
if (R.exact !== FLOWS.length) { console.error("REGRESSION: law no longer 18/18"); process.exit(1); }
