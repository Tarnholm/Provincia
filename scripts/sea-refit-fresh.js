// Re-fit the RIS sea law against the FRESH governor-aware per-route corpus (2026-07-05 save).
// Scores model (governors applied) per-town total vs the scroll totals; sweeps popX+popY
// constants + gate mode. Vanilla must stay 25/25 exact.
const im = require("../src/incomeModel.js");
const MOD = "C:\\RIS\\RIS\\data";
const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_05-07-2026   Republic of Rome   Turn 1.sav";
// FRESH gov-aware totals from the in-game scrolls
const FRESH = {
  Cosa: 415, Metapontum: 159, Neapolis: 221, Pisae: 77, Volaterrae: 104,
  Sena_Gallica: 72, Epizephyrian_Locri: 53, Venusia: 193, Canusium: 32, Arpi: 94,
};
const norm = s => s.toLowerCase().replace(/[ _]/g, "");
const FN = {}; for (const k in FRESH) FN[norm(k)] = FRESH[k];
// vanilla regression gate (unchanged constants)
const Vv = "C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/data";
const GTv = { macedon:{Thessalonica:186,Bylazora:52,Larissa:35,Corinth:12}, romans_julii:{Arretium:215,Ariminum:90}, seleucid:{Seleucia:40,Sardis:39,Tarsus:135,Antioch:492,Damascus:84,Hatra:107}, greek_cities:{Sparta:8,Pergamum:14,Rhodes:128,Syracuse:131,Thermon:3}, carthage:{Carthage:267,Thapsus:42,Lilybaeum:52,Corduba:97,Palma:0,Caralis:0}, pontus:{Sinope:177,Mazaka:99} };
function vanillaErr(){ let e=0; for(const f in GTv){ const B=im.computeTurn1Budget(Vv,f,{},{isPlayer:true,govEffectByCity:{}}); for(const k in GTv[f]){ const x=B.settlements.find(z=>z.settlement===k); const m=x?Math.round(x.trade):0; e+=Math.abs(m-GTv[f][k]); } } return e; }

const cs = require("../src/calibSaveOpts.js").buildCalibSaveOpts(MOD, SAVE);
const gov = (cs.opts && cs.opts.govEffectByCity) || {};
const popBy = (cs.opts && cs.opts.popByCity) || null;
function risFreshErr(){
  const opts = { isPlayer: true, govEffectByCity: gov }; if (popBy) opts.popByCity = popBy;
  const B = im.computeTurn1Budget(MOD, "romans_julii", {}, opts);
  const M = {}; for (const s of B.settlements) M[norm(s.settlement)] = Math.round(s.trade);
  let e=0,n=0,ex=0; const off=[];
  for (const k in FN){ const m=M[k]; if(m==null||!isFinite(m))continue; const d=m-FN[k]; e+=Math.abs(d); n++; if(d===0)ex++; else off.push(`${k}${d>0?"+":""}${d}`);}
  return {e,n,ex,off};
}

// baseline (shipped popX-only) vs candidate configs
const results = [];
for (const pinsum of [false, true]) {
  for (const clean of [false, true]) {
    for (const coef of [0.10, 0.107]) {
      for (const base of pinsum ? [1.5,2,2.5,3,3.5] : [5.15]) {
        global.__SEA_PINSUM_RIS = pinsum; global.__SEA_CLEAN_GATES = clean;
        global.__SEA_COEF_RIS = coef; global.__SEA_BASE_RIS = pinsum ? base : null;
        if (!pinsum) { global.__SEA_COEF_RIS = null; }
        const ve = vanillaErr(); if (ve !== 0) continue;
        const r = risFreshErr();
        results.push({ pinsum, clean, coef: pinsum?coef:"-", base: pinsum?base:"-", err: r.e, exact: `${r.ex}/${r.n}`, off: r.off });
      }
    }
  }
}
results.sort((a,b)=>a.err-b.err);
console.log("FRESH gov-aware corpus (11 towns). Top configs (vanilla 25/25 held):");
for (const r of results.slice(0,10)) console.log(`  pinsum=${r.pinsum} clean=${r.clean} coef=${r.coef} base=${r.base}  err=${r.err} exact=${r.exact}`);
console.log("\nBEST off:", JSON.stringify(results[0].off));
// also show shipped (pinsum off) for reference
const ship = results.filter(r=>!r.pinsum).sort((a,b)=>a.err-b.err)[0];
if (ship) console.log("Best pinsum=OFF (shipped-style):", `err=${ship.err} exact=${ship.exact}`, JSON.stringify(ship.off));
