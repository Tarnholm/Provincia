// Re-fit the sea EXPORT law on CLEAN exports only. Classify each truth route as
// export vs import-shadow via the /5 law (using both Carthaginian panels), keep exports,
// pair with model lane features, refit log-linear (truth-weighted). Output new beta.
process.env.TRADE_DEBUG = "1";
const fs = require("fs");
const { crackSave } = require("./src/saveCracker.js");
const te = require("./src/traitEffects.js");
const im = require("./src/incomeModel.js");
const MOD = "C:/RIS/RIS/data";
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Carthage   Turn 1.sav";
const TRUTH = require("./docs/carthage-screenshots-truth.json");
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const own = new Set(TRUTH.settlements.map(s => norm(s.name)));
const rowsAB = {};
for (const tw of TRUTH.settlements) for (const rt of tw.routes) (rowsAB[norm(tw.name) + "|" + norm(rt.partner)] = rowsAB[norm(tw.name) + "|" + norm(rt.partner)] || []).push(rt.value);

// classify: a value v in A->B is EXPORT if B->A has ~v/5; IMPORT if B->A has ~5v; else unknown
function classify(A, B, v) {
  const back = rowsAB[B + "|" + A] || [];
  if (back.some(x => Math.abs(x - v / 5) <= 1.5)) return "exp";
  if (back.some(x => Math.abs(x - v * 5) <= Math.max(2, v * 5 * 0.1))) return "imp";
  return "unk";
}
const cr = crackSave(fs.readFileSync(SAVE), MOD);
const gov = te.govEffectByCityFromSave(cr, te.parseTraitEffects(MOD), MOD);
global.__TDBG = [];
const B = im.computeTurn1Budget(MOD, "carthage", null, { govEffectByCity: gov });
const regToSet = {}; for (const s of B.settlements) regToSet[norm(s.region)] = s.settlement;
const modelRows = {};
for (const r of global.__TDBG) { const toSet = regToSet[norm(r.toRegion)] || r.toRegion; (modelRows[norm(r.from) + "|" + norm(toSet)] = modelRows[norm(r.from) + "|" + norm(toSet)] || []).push(r); }

const P = [];
const cls = { exp: 0, imp: 0, unk: 0 };
for (const tw of TRUTH.settlements) for (const rt of tw.routes) {
  const A = norm(tw.name), Bp = norm(rt.partner);
  const c = own.has(Bp) ? classify(A, Bp, rt.value) : "unk";
  cls[c]++;
  if (c !== "exp") continue;                         // CLEAN: confirmed exports only
  const m = (modelRows[A + "|" + Bp] || []);
  const lane = m.find(x => x.kind === "sea") || m[0];
  if (!lane || lane.kind !== "sea" || lane.cargo <= 0) continue;
  P.push({ from: tw.name, to: rt.partner, cargo: +lane.cargo, d: lane.d, popF: lane.popFrom || 1500, popT: lane.popTo || 1500, tPct: lane.tradePctF, truth: Math.max(1, rt.value) });
}
console.log("route classes:", cls, " | clean sea exports paired:", P.length);

function fitOLS(X, y, w) {
  const n = X.length, p = X[0].length; w = w || X.map(() => 1);
  const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  for (let i = 0; i < n; i++) { const wi = w[i]; for (let a = 0; a < p; a++) { b[a] += wi * X[i][a] * y[i]; for (let c = 0; c < p; c++) A[a][c] += wi * X[i][a] * X[i][c]; } }
  const M = A.map((r, i) => r.concat(b[i]));
  for (let col = 0; col < p; col++) { let piv = col; for (let r = col + 1; r < p; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;[M[col], M[piv]] = [M[piv], M[col]]; const d = M[col][col] || 1e-9; for (let c = col; c <= p; c++) M[col][c] /= d; for (let r = 0; r < p; r++) if (r !== col) { const f = M[r][col]; for (let c = col; c <= p; c++) M[r][c] -= f * M[col][c]; } }
  return M.map(r => r[p]);
}
const feats = (r) => [1, Math.log(r.cargo), r.tPct, Math.log(r.popF), Math.log(r.d), Math.log(r.popT)];
const beta = fitOLS(P.map(feats), P.map(r => Math.log(r.truth)), P.map(r => r.truth));
console.log("CLEAN beta [1,log(cargo),tPct,log(popF),log(d),log(popT)]:\n ", beta.map(b => b.toFixed(4)));
const pred = (r) => Math.exp(feats(r).reduce((s, f, i) => s + f * beta[i], 0));
let sae = 0, sat = 0, sp = 0; const yb = P.reduce((a, r) => a + Math.log(r.truth), 0) / P.length; let ss = 0, st = 0;
for (const r of P) { const ph = pred(r); sae += Math.abs(ph - r.truth); sat += r.truth; sp += ph; ss += (Math.log(r.truth) - Math.log(ph)) ** 2; st += (Math.log(r.truth) - yb) ** 2; }
console.log(`R2(log) ${(1 - ss / st).toFixed(3)}  MAE ${(sae / P.length).toFixed(1)}  sumPred/sumTruth ${(sp / sat).toFixed(3)}`);
console.log("\nfrom->to                       cargo d  popF  truth pred");
for (const r of P.sort((a, b) => b.truth - a.truth)) console.log(`${(r.from + "->" + r.to).padEnd(30)} ${String(r.cargo).padEnd(5)} ${String(r.d).padEnd(2)} ${String(r.popF).padEnd(5)} ${String(r.truth).padEnd(5)} ${pred(r).toFixed(0)}`);
