// scripts/ris-trade-test.js — RIS sea-trade calibration harness.
// Prints one JSON line: {vanillaOk, vanillaErr, vanillaExact, risErr, risExact, risBaseline, risOff}.
//   vanillaOk MUST be true (vanilla 25/25, err 0) for any RIS change to be VALID.
//   risErr is the metric to reduce (307 = the current shipped baseline; lower is better).
// Run with the sandbox DISABLED (it reads C:/RIS and C:/Program Files):
//   node scripts/ris-trade-test.js
const im = require("../src/incomeModel.js");

// ---- VANILLA regression gate (map 0x78) ----
const Vv = "C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/data";
const GTv = {
  macedon: { Thessalonica: 186, Bylazora: 52, Larissa: 35, Corinth: 12 },
  romans_julii: { Arretium: 215, Ariminum: 90 },
  seleucid: { Seleucia: 40, Sardis: 39, Tarsus: 135, Antioch: 492, Damascus: 84, Hatra: 107 },
  greek_cities: { Sparta: 8, Pergamum: 14, Rhodes: 128, Syracuse: 131, Thermon: 3 },
  carthage: { Carthage: 267, Thapsus: 42, Lilybaeum: 52, Corduba: 97, Palma: 0, Caralis: 0 },
  pontus: { Sinope: 177, Mazaka: 99 },
};
let vErr = 0, vExact = 0, vN = 0;
for (const f in GTv) {
  const B = im.computeTurn1Budget(Vv, f, {}, { isPlayer: true, govEffectByCity: {} });
  for (const k in GTv[f]) {
    const x = B.settlements.find(z => z.settlement === k);
    const m = x ? Math.round(x.trade) : 0;
    vErr += Math.abs(m - GTv[f][k]); vN++; if (m === GTv[f][k]) vExact++;
  }
}

// ---- RIS Rome corpus (map 0x7b), gov-OFF ----
const V = "C:/RIS/RIS/data";
const GTtot = require("./ris-rome-trade-gt.json");
const norm = s => s.toLowerCase().replace(/[ _]/g, "");
const GT = {}; for (const k in GTtot) GT[norm(k)] = GTtot[k];
const B = im.computeTurn1Budget(V, "romans_julii", {}, { isPlayer: true, govEffectByCity: {} });
const M = {}; for (const s of B.settlements) M[norm(s.settlement)] = Math.round(s.trade);
let rErr = 0, rExact = 0, rN = 0; const off = [];
for (const k in GT) {
  const m = M[k]; if (m == null || !isFinite(m)) continue;
  const d = m - GT[k]; rErr += Math.abs(d); rN++; if (d === 0) rExact++;
  if (d !== 0) off.push(`${k}:${m}/${GT[k]}${d > 0 ? "+" : ""}${d}`);
}

console.log(JSON.stringify({
  vanillaOk: vErr === 0, vanillaErr: vErr, vanillaExact: `${vExact}/${vN}`,
  risErr: rErr, risExact: `${rExact}/${rN}`, risBaseline: 307, risOff: off,
}));
if (vErr !== 0) process.exit(2);
