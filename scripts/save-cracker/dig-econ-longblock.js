// dig-econ-longblock.js
// Test main.js's PRIMARY settlement income path: tax_byte = marker - 2269,
// income perTurn = tax_byte + 683. Dump for Rome/Arretium across turns and also
// scan a wide window before each marker to FIND the real per-turn income field
// (Rome capital should be a few hundred to ~1000+ denarii).
const fs = require("fs");
const path = require("path");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
function marker(buf, name){const pre=Buffer.alloc(3);pre[0]=1;pre.writeUInt16LE(name.length,1);const b=Buffer.alloc(name.length*2);for(let i=0;i<name.length;i++)b[i*2]=name.charCodeAt(i);return buf.indexOf(Buffer.concat([pre,b]));}

const files={T1:"save_arretium pre retrained..sav",T2:"save_arretium retrained turn 2.sav",T3:"save_arretium turn 3.sav",T4:"save_arretium turn 4.sav"};
const bufs={};for(const[t,f]of Object.entries(files))bufs[t]=fs.readFileSync(path.join(BASE,f));

for (const city of ["Rome","Arretium","Capua"]) {
  console.log(`\n========== ${city} ==========`);
  const m={};for(const t of ["T1","T2","T3","T4"])m[t]=marker(bufs[t],city);
  console.log("marker: "+Object.entries(m).map(([t,p])=>`${t}=0x${p.toString(16)}`).join(" "));
  // main.js claim: income = (marker-2269)+683 = marker-1586
  for (const d of [-1586, -1582]) {
    const vals=["T1","T2","T3","T4"].map(t=>bufs[t].readUInt32LE(m[t]+d));
    console.log(`  marker${d} (main.js income guess): ${vals.join(" ")}`);
  }
  // Wide scan: find u32 in [50..5000] that DECREASES or changes plausibly across turns,
  // located in the 2500 bytes before the marker.
  console.log(`  -- candidates (u32 in 30..5000, varies across turns) in marker-2600..marker --`);
  const hits=[];
  for (let d=-2600; d<0; d++) {
    const vals=["T1","T2","T3","T4"].map(t=>{const o=m[t]+d;return (o>=0&&o+4<=bufs[t].length)?bufs[t].readUInt32LE(o):null;});
    if (vals.some(v=>v===null))continue;
    if (vals.some(v=>v<30||v>5000))continue;
    if (new Set(vals).size===1)continue;
    hits.push({d,vals});
  }
  for (const h of hits.slice(0,25)) console.log(`    marker${String(h.d).padStart(5)}: ${h.vals.join(" ")}`);
}
