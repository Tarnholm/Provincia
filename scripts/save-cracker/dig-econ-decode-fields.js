// dig-econ-decode-fields.js
// We have the per-turn economy history fully aligned (stride 23 i32, header
// [selfptr,turnSerial], trailer marker 414337867). Each turn appends ONE block.
// Blocks repeat across turns (T2.b0==T3.b0==T4.b0), confirming they are
// per-turn historical snapshots. Goal: identify which block corresponds to the
// "current displayed" turn and decode each field against ground truth.
//
// Ground truth (treasury at SAVE time; net = delta from prev turn):
//   T1=10000  T2=16833(+6833)  T3=18271(+1438)  T4=19693(+1422)
//   gross settlement income reported: T1=6347 T2=6339 T3=6338 T4=6539
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };
const PLAYER_FID = 5;
const turns = ["T1", "T2", "T3", "T4"];

function ordinal0(buf, core) {
  for (let off = core - 4; off >= core - 4000; off -= 4) {
    if (off < 0) break;
    if (buf.readUInt32LE(off) === off) return off;
  }
  return -1;
}
function blocksFor(buf, core) {
  const start = ordinal0(buf, core);
  const fields = [];
  for (let o = start; o + 4 <= core; o += 4) fields.push(buf.readInt32LE(o));
  const body = fields.slice(2, fields.length - 1);
  const STRIDE = 23, n = body.length / STRIDE;
  const blocks = [];
  for (let b = 0; b < n; b++) blocks.push(body.slice(b*STRIDE, (b+1)*STRIDE));
  return { start, serial: fields[1], blocks, marker: fields[fields.length-1] };
}

const data = {};
for (const t of turns) {
  const buf = fs.readFileSync(path.join(BASE, FILES[t]));
  const recs = parseFactionTreasuries(buf);
  const pr = recs.find(r => r.factionId === PLAYER_FID && r.treasury === GROUND[t]);
  data[t] = blocksFor(buf, pr.offset);
  data[t].treasury = pr.treasury;
}

console.log("=== block counts & serials ===");
for (const t of turns) console.log(`  ${t}: ${data[t].blocks.length} blocks, serial=${data[t].serial}, treasury=${data[t].treasury}, marker=${data[t].marker}`);

// The LAST block in each turn = that turn's record (most recent). Pull it out.
console.log("\n=== LAST block per turn (the 'current turn' snapshot) field-by-field ===");
const NF = 23;
console.log("field | " + turns.map(t=>t.padStart(10)).join(" "));
for (let f = 0; f < NF; f++) {
  const row = turns.map(t => {
    const blk = data[t].blocks[data[t].blocks.length - 1];
    return String(blk[f]).padStart(10);
  });
  console.log(`  f${String(f).padStart(2)} | ${row.join(" ")}`);
}

// Also: the SECOND-to-last block (== previous turn's "current") for cross-check.
console.log("\n=== for each field, derive candidate meaning vs ground truth ===");
const treas = turns.map(t=>GROUND[t]);
const net   = [null, 6833, 1438, 1422];
const gross = [6347,6339,6338,6539];
for (let f = 0; f < NF; f++) {
  const last = turns.map(t => data[t].blocks[data[t].blocks.length-1][f]);
  // deltas of last across turns
  const d = [null];
  for (let i=1;i<4;i++) d.push(last[i]-last[i-1]);
  const tags = [];
  if (turns.every((t,i)=> last[i]===treas[i])) tags.push("==TREASURY");
  if (d[1]===net[1]&&d[2]===net[2]&&d[3]===net[3]) tags.push("DELTA==NET");
  if (turns.every((t,i)=> last[i]===gross[i])) tags.push("==GROSS");
  if (turns.every((t,i)=> last[i]===-gross[i])) tags.push("==-GROSS");
  console.log(`  f${String(f).padStart(2)} last=[${last.join(",")}]  Δ=[${d.slice(1).join(",")}] ${tags.join(" ")}`);
}

// Hypothesis tests on the structured fields. f0,f1,f3,f9,f11,f12,f13,f22 are the
// non-zero movers. Test arithmetic relationships:
console.log("\n=== arithmetic relationship probes (LAST block) ===");
for (const t of turns) {
  const b = data[t].blocks[data[t].blocks.length-1];
  console.log(`  ${t}: treasury=${GROUND[t]}  f0=${b[0]} f1=${b[1]} f3=${b[3]} f5=${b[5]} f8=${b[8]} f9=${b[9]} f11=${b[11]} f12=${b[12]} f13=${b[13]} f22=${b[22]}`);
  console.log(`       f0-f1=${b[0]-b[1]}  f12-f0=${b[12]-b[0]}  f1-f3=${b[1]-b[3]}  f1+f13=${b[1]+b[13]}  f1-f9=${b[1]-b[9]}`);
}
