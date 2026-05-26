// dig-econ-settlement-breakdown.js
// Decode the per-settlement income-breakdown cluster. Around marker-1186..-1106 a
// group of u32 changed at every turn boundary (Rome -1186=968/1728/1796/1642).
// Map each field by dumping marker-1300..marker-1100 for Rome and Arretium across
// 4 turns. Then test: which fields SUM (across the player's 25 cities) to the net
// income components? The faction-level breakdown = sum of these per category.
const fs = require("fs");
const path = require("path");
const { findAllSettlementMarkers } = require("C:/dev/Provincia/src/buildingParser.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const turns=["T1","T2","T3","T4"];
const bufs={}; for(const t of turns)bufs[t]=fs.readFileSync(path.join(BASE,FILES[t]));
function marker(buf,name){const pre=Buffer.alloc(3);pre[0]=1;pre.writeUInt16LE(name.length,1);const b=Buffer.alloc(name.length*2);for(let i=0;i<name.length;i++)b[i*2]=name.charCodeAt(i);return buf.indexOf(Buffer.concat([pre,b]));}

for (const city of ["Rome","Arretium"]) {
  console.log(`\n========== ${city} income cluster (marker-1300..-1100) ==========`);
  const m={};for(const t of turns)m[t]=marker(bufs[t],city);
  for (let d=-1300;d<=-1100;d+=4){
    const vals=turns.map(t=>bufs[t].readUInt32LE(m[t]+d));
    if (vals.every(v=>v===0))continue;
    if (vals.some(v=>v>5_000_000))continue;
    const varies=new Set(vals).size>1;
    console.log(`  ${String(d).padStart(5)} : ${vals.map(v=>String(v).padStart(7)).join(" ")}${varies?"  *":""}`);
  }
}

// Now sum each candidate offset over ALL player cities (owner=0xe0a15679) per turn.
console.log("\n========== Player-faction SUMS per candidate offset (owner=0xe0a15679) ==========");
console.log("net Δtreasury: T2=+6833 T3=+1438 T4=+1422 ; gross(marker-1586 sum): 6347/6339/6338/6539\n");
const PLAYER_OWNER = 0xe0a15679;
const setsByTurn={}; for(const t of turns)setsByTurn[t]=findAllSettlementMarkers(bufs[t]);
for (let d=-1300;d<=-1100;d+=4){
  const sums=turns.map(t=>{
    let s=0; for(const st of setsByTurn[t]){ const oo=st.offset-1944; if(oo<0)continue; if(bufs[t].readUInt32LE(oo)!==PLAYER_OWNER)continue; const o=st.offset+d; if(o<0||o+4>bufs[t].length)continue; const v=bufs[t].readUInt32LE(o); if(v<5_000_000)s+=v; } return s;
  });
  if (sums.every(v=>v===0))continue;
  console.log(`  marker${String(d).padStart(5)} SUM: ${sums.map(v=>String(v).padStart(8)).join(" ")}`);
}
