// dig-econ-subrecord-walk.js
// The region BEFORE the FACTION core holds a structured economics block: a series of
// sub-records each beginning with a self-pointer (u32 == own offset). In T1 these were
// at faction-8, faction-104, faction-108, faction-128 ... Walk ALL self-pointers in a
// wide window before the FACTION core, per-turn (each turn has its OWN offsets), group
// them into sub-records by the gap between consecutive self-ptrs, and dump each
// sub-record's i32 fields. Align sub-records across turns by their ORDINAL (Nth self-ptr
// before the core) so churning offsets don't break the comparison.
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };
const PLAYER_FID = 5;
const turns = ["T1", "T2", "T3", "T4"];

const bufs = {}, pr = {};
for (const t of turns) {
  bufs[t] = fs.readFileSync(path.join(BASE, FILES[t]));
  const recs = parseFactionTreasuries(bufs[t]);
  pr[t] = recs.find(r => r.factionId === PLAYER_FID && r.treasury === GROUND[t]);
}

// Collect self-pointers in [core-3000, core] per turn.
function selfPtrs(buf, core, span) {
  const out = [];
  for (let off = core - span; off < core; off += 4) {
    if (off < 0) continue;
    if (buf.readUInt32LE(off) === off) out.push(off);
  }
  return out;
}

const SPAN = 4000;
const sp = {};
for (const t of turns) sp[t] = selfPtrs(bufs[t], pr[t].offset, SPAN);
for (const t of turns) console.log(`[${t}] ${sp[t].length} self-ptrs before core; nearest gaps: ${sp[t].slice(-12).map((o,i,a)=> i? (o-a[i-1]):"-").join(",")}`);

// The self-ptrs nearest the core: print their offset deltas from core, per turn.
console.log("\n=== nearest 16 self-ptrs as delta-from-core (per turn) ===");
for (const t of turns) {
  const deltas = sp[t].slice(-16).map(o => o - pr[t].offset);
  console.log(`  [${t}] ${deltas.join(" ")}`);
}

// Dump each of the nearest N self-ptr sub-records. A sub-record = bytes from this
// self-ptr to the NEXT self-ptr (or core). Print i32 fields, aligned by ordinal.
const N = 12;
console.log(`\n=== nearest ${N} sub-records (ordinal 0 = closest to core), i32 fields per turn ===`);
for (let ord = 0; ord < N; ord++) {
  console.log(`\n--- sub-record ordinal ${ord} (the ${ord+1}th self-ptr before core) ---`);
  for (const t of turns) {
    const list = sp[t];
    if (list.length < ord + 1) { console.log(`  [${t}] (none)`); continue; }
    const start = list[list.length - 1 - ord];
    const next = (ord === 0) ? pr[t].offset : list[list.length - ord];
    const len = next - start;
    const fields = [];
    for (let o = start; o + 4 <= next && o + 4 <= bufs[t].length; o += 4) fields.push(bufs[t].readInt32LE(o));
    console.log(`  [${t}] @0x${start.toString(16)} (Δcore=${start-pr[t].offset}) len=${len}: ${fields.map(f=>String(f)).join(" ")}`);
  }
}
