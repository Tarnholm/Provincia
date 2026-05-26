// dig-econ-DECODE-SUMMARY.js
// =====================================================================
// FACTION ECONOMY HISTORY BLOCK — consolidated decode + validation.
// =====================================================================
// LOCATION (per faction, found via parseFactionTreasuries class-100 record):
//   * Walk backward from the FACTION core record offset; the FIRST u32 that
//     equals its own offset (self-pointer) is the econ-history object header.
//     Call it `o0`. There are actually TWO adjacent self-ptrs (o0-4 and o0)
//     forming the object framing; o0 begins the payload we use.
//   * Region BEFORE o0 is a static [3,<hash>,0,0] UUID pool (identical every
//     turn) — not economics.
//   * Region from o0 .. core holds the economy history.
//
// LAYOUT (i32, little-endian) from o0:
//   [0]  selfptr (== o0)
//   [1]  turnSerial  (1,2,3,... == game turn number; also == #history blocks)
//   then `turnSerial` BLOCKS of 23 i32 each (one appended per game turn):
//        block.f0   large ~33k    (aggregate KPI; ~population/economy size)
//        block.f1   large, rises  (cumulative aggregate; pop/trade-ish)
//        block.f3   mid, monotonic up  (cumulative stat — never decreases)
//        block.f5   sparse small  (event-ish)
//        block.f8   sparse spike  (event-ish, e.g. recruit/retrain turn)
//        block.f9   small, rises  (cumulative-ish stat)
//        block.f11  round steps   (tax/maintenance base, multiple of 50)
//        block.f12  large ~33k    (aggregate KPI, drifts)
//        block.f13  MONEY per completed turn (treasury checkpoint; ~treasury
//                   minus a small amount). 0 for the CURRENT (last) block
//                   until that turn completes.
//        block.f22  mid           (aggregate stat)
//        f2,f4,f6,f7,f10,f14..f21 = 0 in observed saves
//   [end] trailer marker (1 i32) = per-faction STABLE hash (UUID); same value
//         every turn within a campaign -> use to track a faction across saves.
//
// PROVEN (8-turn Republic-of-Rome trajectory + 4-turn arretium + macedon/seleucid t0):
//   * Structure validated 23/23 records on every save (stride 23 divides evenly).
//   * #blocks == turnSerial == game turn, +1 block per turn, old blocks immutable.
//   * Treasury & NET income are NOT in this block. Treasury = record +0 (and +180
//     copy). Net income = treasury(+0) delta across saves; NOT a stored field.
//   * f13 is a per-turn money checkpoint that tracks treasury within ~0.3-2%.
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

function ordinal0(buf, core){for(let off=core-4;off>=core-60000;off-=4){if(off<0)break;if(buf.readUInt32LE(off)===off)return off;}return -1;}
function parseEconHistory(buf, core){
  const start=ordinal0(buf,core); if(start<0) return null;
  const f=[]; for(let o=start;o+4<=core;o+=4) f.push(buf.readInt32LE(o));
  const selfptr=f[0], turnSerial=f[1], marker=f[f.length-1];
  const body=f.slice(2,f.length-1); const S=23;
  if(body.length%S) return {start,selfptr,turnSerial,marker,ok:false,bodyLen:body.length};
  const blocks=[]; for(let b=0;b<body.length/S;b++) blocks.push(body.slice(b*S,(b+1)*S));
  return {start,selfptr,turnSerial,marker,blocks,ok:true};
}

function show(file, pickFid){
  const p=path.join(BASE,file); if(!fs.existsSync(p)){console.log(`MISSING ${file}`);return;}
  const buf=fs.readFileSync(p); const recs=parseFactionTreasuries(buf);
  console.log(`\n### ${file} — ${recs.length} faction records`);
  let okAll=0;
  for(const r of recs){ const h=parseEconHistory(buf,r.offset); if(h&&h.ok) okAll++; }
  console.log(`  stride-23 validity: ${okAll}/${recs.length}`);
  // show the requested faction in detail
  const r=recs.find(x=>x.factionId===pickFid)||recs[0];
  const h=parseEconHistory(buf,r.offset);
  console.log(`  faction fid=${r.factionId} treasury(+0)=${r.treasury} marker=${h.marker} turnSerial=${h.turnSerial} blocks=${h.blocks.length}`);
  console.log(`  f13 timeline: [${h.blocks.map(b=>b[13]).join(", ")}]`);
}

show("save_t7.sav", 5);
show("save_arretium turn 4.sav", 5);
show("save_macedon t0.sav", 0);
show("save_Seleucids t0.sav", 5);

// API the app could use:
module.exports = { ordinal0, parseEconHistory };
