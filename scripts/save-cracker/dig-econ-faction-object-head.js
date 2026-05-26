// dig-econ-faction-object-head.js
// REFRAME: registry `count` = serialization VERSION, not field count. FACTION
// object (id 12, ver 1) embeds FACTION_ECONOMICS (id 91, ver 36) + ECONOMICS_DATA
// (id 7, ver 4). The class-100 record (parseFactionTreasuries anchor, +8==100) is
// the FACTION object's CORE. Treasury at +0 & +180. The economics breakdown must be
// embedded. The post-diplo region churns, BUT economics could be embedded BEFORE the
// diplomacy block isn't true (we dumped +0..+332, only treasury/regions/meta there).
//
// New hypothesis: the income BREAKDOWN is a separate FACTION_ECONOMICS object the
// FACTION points to via a UUID/pointer. The two self-pointers at +24 and +40 (==pos+24,
// pos+40) suggest sub-object anchors. Inspect the values right after them and the
// region BEFORE +0 (could be the prev sub-object's tail). Dump [-256..+52] in detail
// and resolve any pointer-looking u32 (value in [bodyStart..fileLen]) to see what it
// references.
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

// For T1 only: walk backwards from +0 looking for the previous record boundary
// (a self-ptr u32==its own offset, like +24/+40 pattern, or a class-tag).
const t = "T1", buf = bufs[t], base = pr[t].offset;
console.log(`[T1] player FACTION record core @0x${base.toString(16)}`);
console.log(`self-ptrs: +24 -> 0x${buf.readUInt32LE(base+24).toString(16)} (==base+24? ${buf.readUInt32LE(base+24)===base+24}); +40 -> 0x${buf.readUInt32LE(base+40).toString(16)} (==base+40? ${buf.readUInt32LE(base+40)===base+40})`);

console.log("\n=== scan [-512..0] for self-pointers (u32==own offset) marking sub-object starts ===");
for (let k = -512; k < 0; k += 4) {
  const off = base + k;
  if (off < 0) continue;
  const v = buf.readUInt32LE(off);
  if (v === off) console.log(`  self-ptr @${k} (0x${off.toString(16)})  value=0x${v.toString(16)}`);
}

console.log("\n=== [-256..+52] i32 / f32 / ptr-resolve for all 4 turns ===");
const FILELEN = Math.min(...turns.map(t=>bufs[t].length));
for (let k = -256; k <= 52; k += 4) {
  const vals = turns.map(t => {
    const off = pr[t].offset + k;
    return (off>=0 && off+4<=bufs[t].length) ? bufs[t].readInt32LE(off) : null;
  });
  if (vals.some(v=>v===null)) continue;
  const varies = new Set(vals).size>1;
  // pointer? value in [0x3000 .. fileLen] AND aligned
  const u0 = vals[0]>>>0;
  const looksPtr = u0 > 0x3000 && u0 < FILELEN;
  const selfRel = (k>=0) && turns.every((t,i)=> (vals[i]>>>0) === (pr[t].offset + k));
  const mark = (selfRel?" SELF-PTR":"") + (looksPtr&&!selfRel?" ptr?":"") + (varies?" v":"");
  console.log(`  +${String(k).padStart(4)} : ${vals.map(v=>String(v).padStart(11)).join(" ")}${mark}`);
}
