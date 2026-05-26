// dig-econ-search-aitotals.js
// Search for AI faction gross settlement-income totals (distinctive large values)
// to find the FACTION_ECONOMICS section. If the section stores per-faction income,
// these totals (or close) will appear. T1 totals:
//   seleucid 16878, ptolemaic 13260, rebels 15089, carthage 2126, macedon 6832,
//   player(roman) 6347, bactria 2394, epirus 1847, bosporan 1246.
// Also try a range search: for each, find values within +-5% near each other.
const fs = require("fs");
const path = require("path");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const buf = fs.readFileSync(path.join(BASE, "save_arretium pre retrained..sav"));

const TOTALS = { seleucid:16878, ptolemaic:13260, rebels:15089, carthage:2126, macedon:6832, roman:6347, bactria:2394 };
function findAll(buf, v, tol){ const out=[]; for(let p=0x3000;p+4<buf.length;p+=1){const x=buf.readInt32LE(p); if(Math.abs(x-v)<=tol)out.push({p,x});} return out; }

for (const [fac,v] of Object.entries(TOTALS)) {
  const exact = findAll(buf, v, 0);
  console.log(`${fac.padEnd(10)} total=${v}: exact ${exact.length} hits ${exact.slice(0,8).map(h=>"0x"+h.p.toString(16)).join(",")}`);
}

// Better: find a body region where MANY of these totals appear within a small window
// (the econ section would have them clustered, one per faction record).
console.log("\n=== windows (256KB) containing the most distinct faction-total matches (tol=20) ===");
const vals = Object.values(TOTALS);
const allHits = [];
for (let p=0x3000;p+4<buf.length;p+=1){ const x=buf.readInt32LE(p); for(const v of vals){ if(Math.abs(x-v)<=20){ allHits.push({p,v}); break; } } }
console.log(`${allHits.length} total approximate hits across file`);
// bucket into 256KB windows
const W=262144; const buckets=new Map();
for (const h of allHits){ const b=Math.floor(h.p/W); if(!buckets.has(b))buckets.set(b,new Set()); buckets.get(b).add(h.v); }
const ranked=[...buckets.entries()].map(([b,s])=>({b,n:s.size,vals:[...s]})).sort((a,b)=>b.n-a.n);
for (const r of ranked.slice(0,10)) console.log(`  window 0x${(r.b*W).toString(16)}..0x${((r.b+1)*W).toString(16)}: ${r.n} distinct totals [${r.vals.join(",")}]`);
