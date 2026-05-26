// dig-econ-crossval-blocks.js
// Validate the ordinal-0 per-turn econ-history block structure (header
// [selfptr,turnSerial], N blocks of 23 i32, trailer marker) on:
//   (a) all 4 arretium turns for the PLAYER, and a couple AI factions
//   (b) macedon t0 and seleucid t0 (different campaigns)
// Confirm: trailer marker constant?  block count == turn number?  stride 23?
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

function ordinal0(buf, core){for(let off=core-4;off>=core-20000;off-=4){if(off<0)break;if(buf.readUInt32LE(off)===off)return off;}return -1;}
function parseBlock(buf, core){
  const start = ordinal0(buf, core);
  if (start<0) return null;
  const f=[];
  for(let o=start;o+4<=core;o+=4) f.push(buf.readInt32LE(o));
  const selfptr=f[0], turnSerial=f[1], marker=f[f.length-1];
  const body=f.slice(2, f.length-1);
  const S=23;
  if (body.length % S !== 0) return { start, selfptr, turnSerial, marker, bodyLen: body.length, ok:false };
  const blocks=[];
  for(let b=0;b<body.length/S;b++) blocks.push(body.slice(b*S,(b+1)*S));
  return { start, selfptr, turnSerial, marker, blocks, ok:true };
}

function analyze(file, label) {
  const full = path.join(BASE, file);
  if (!fs.existsSync(full)) { console.log(`\n### ${label}: FILE MISSING (${file})`); return; }
  const buf = fs.readFileSync(full);
  const recs = parseFactionTreasuries(buf);
  console.log(`\n### ${label} (${file}) — ${recs.length} class-100 records`);
  // Sample up to 6 records
  const sample = recs.slice(0, 6);
  for (const r of sample) {
    const pb = parseBlock(buf, r.offset);
    if (!pb) { console.log(`  fid=${r.factionId} treasury=${r.treasury}: no ordinal0`); continue; }
    if (!pb.ok) { console.log(`  fid=${r.factionId} treasury=${r.treasury}: stride23 FAIL bodyLen=${pb.bodyLen} marker=${pb.marker}`); continue; }
    const f13 = pb.blocks.map(b=>b[13]);
    console.log(`  fid=${String(r.factionId).padStart(3)} treasury=${String(r.treasury).padStart(7)} | serial=${pb.turnSerial} blocks=${pb.blocks.length} marker=${pb.marker} | lastBlk f0=${pb.blocks.at(-1)[0]} f1=${pb.blocks.at(-1)[1]} f11=${pb.blocks.at(-1)[11]} f22=${pb.blocks.at(-1)[22]} | f13hist=[${f13.join(",")}]`);
  }
  // marker uniformity across all records
  const markers = new Set();
  let strideOk=0, strideTot=0;
  for (const r of recs) {
    const pb = parseBlock(buf, r.offset);
    if (!pb) continue;
    markers.add(pb.marker); strideTot++;
    if (pb.ok) strideOk++;
  }
  console.log(`  -> markers seen: ${[...markers].join(", ")}  | stride23 ok ${strideOk}/${strideTot}`);
}

analyze("save_arretium pre retrained..sav", "ARRETIUM T1");
analyze("save_arretium turn 4.sav", "ARRETIUM T4");
analyze("save_macedon t0.sav", "MACEDON T0");
analyze("save_Seleucids t0.sav", "SELEUCID T0");
