// Sweep the popX+popY re-fit: RIS baseTerm x coef x clean-gates, scored against the
// vanilla (must stay 25/25) + RIS Rome corpora. Prints the best configs.
const im = require("../src/incomeModel.js");
const Vv = "C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/data";
const GTv = {
  macedon: { Thessalonica: 186, Bylazora: 52, Larissa: 35, Corinth: 12 },
  romans_julii: { Arretium: 215, Ariminum: 90 },
  seleucid: { Seleucia: 40, Sardis: 39, Tarsus: 135, Antioch: 492, Damascus: 84, Hatra: 107 },
  greek_cities: { Sparta: 8, Pergamum: 14, Rhodes: 128, Syracuse: 131, Thermon: 3 },
  carthage: { Carthage: 267, Thapsus: 42, Lilybaeum: 52, Corduba: 97, Palma: 0, Caralis: 0 },
  pontus: { Sinope: 177, Mazaka: 99 },
};
const V = "C:/RIS/RIS/data";
const GTtot = require("./ris-rome-trade-gt.json");
const norm = s => s.toLowerCase().replace(/[ _]/g, "");
const GT = {}; for (const k in GTtot) GT[norm(k)] = GTtot[k];

function vanillaErr() {
  let e = 0, n = 0, ex = 0;
  for (const f in GTv) {
    const B = im.computeTurn1Budget(Vv, f, {}, { isPlayer: true, govEffectByCity: {} });
    for (const k in GTv[f]) { const x = B.settlements.find(z => z.settlement === k); const m = x ? Math.round(x.trade) : 0; e += Math.abs(m - GTv[f][k]); n++; if (m === GTv[f][k]) ex++; }
  }
  return { e, ex, n };
}
function risErr() {
  const B = im.computeTurn1Budget(V, "romans_julii", {}, { isPlayer: true, govEffectByCity: {} });
  const M = {}; for (const s of B.settlements) M[norm(s.settlement)] = Math.round(s.trade);
  let e = 0, n = 0, ex = 0; const off = [];
  for (const k in GT) { const m = M[k]; if (m == null || !isFinite(m)) continue; const d = m - GT[k]; e += Math.abs(d); n++; if (d === 0) ex++; else off.push(`${k}${d>0?"+":""}${d}`); }
  return { e, ex, n, off };
}

const results = [];
for (const clean of [false, true]) {
  for (const coef of [0.10, 0.107, 0.11]) {
    for (const base of [0, 1, 1.5, 2, 2.5, 3, 3.5, 4]) {
      global.__SEA_CLEAN_GATES = clean;
      global.__SEA_COEF_RIS = coef;
      global.__SEA_BASE_RIS = base;
      const v = vanillaErr();
      if (v.e !== 0) continue; // vanilla must stay exact
      const r = risErr();
      results.push({ clean, coef, base, risErr: r.e, risExact: `${r.ex}/${r.n}`, off: r.off });
    }
  }
}
results.sort((a, b) => a.risErr - b.risErr);
console.log("Top 8 configs (vanilla 25/25 held):");
for (const r of results.slice(0, 8)) console.log(`  clean=${r.clean} coef=${r.coef} base=${r.base}  risErr=${r.risErr} exact=${r.risExact}`);
console.log("\nBEST:", JSON.stringify(results[0], null, 0).slice(0, 400));
