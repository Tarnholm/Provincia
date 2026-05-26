// dig-econ-rome-block.js
// Dump the full stats block before "Rome"'s marker to locate income & owner.
// Rome (player capital region) should have a sizeable per-turn income.
const fs = require("fs");
const path = require("path");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

function marker(buf, name) {
  const pre = Buffer.alloc(3); pre[0] = 0x01; pre.writeUInt16LE(name.length, 1);
  const body = Buffer.alloc(name.length * 2);
  for (let i = 0; i < name.length; i++) body[i*2] = name.charCodeAt(i);
  return buf.indexOf(Buffer.concat([pre, body]));
}

const files = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const bufs = {}; for (const [t,f] of Object.entries(files)) bufs[t] = fs.readFileSync(path.join(BASE, f));

// For Rome, dump name-700..name as u32, showing all 4 turns where value varies.
for (const city of ["Rome", "Arretium"]) {
  console.log(`\n========== ${city} ==========`);
  const m = {}; for (const t of ["T1","T2","T3","T4"]) m[t] = marker(bufs[t], city) + 1;
  console.log("namePos: " + Object.entries(m).map(([t,p])=>`${t}=0x${p.toString(16)}`).join(" "));
  for (let d = -700; d <= 0; d += 4) {
    const vals = ["T1","T2","T3","T4"].map(t => {
      const off = m[t] + d; return (off>=0 && off+4<=bufs[t].length) ? bufs[t].readUInt32LE(off) : null;
    });
    if (vals.some(v=>v===null)) continue;
    if (vals.every(v=>v===0)) continue;
    const varies = new Set(vals).size > 1;
    // Only show plausibly economic (nonzero, < 200000) OR varying
    const econ = vals.some(v=>v>0 && v<200000);
    if (!econ && !varies) continue;
    console.log(`  name${String(d).padStart(4)} : ${vals.map(v=>String(v).padStart(8)).join(" ")}${varies?"  <==varies":""}`);
  }
}
