// dig-charpath-legs.js
// Final interpretation: the path record is a MULTI-LEG waypoint route.
//   record: [u8 legCount][ leg* ]  where each leg = [u32 count][count*(u32 x,u32 y)]
//   ...then a trailing [u8 ??][u8 ??] before the next record anchor.
// Validate: legCount byte == number of legs actually present; each leg is
// chebyshev-adjacent; legN.dest == legN+1.src (continuous route).
import fs from "node:fs";
import path from "node:path";
import { hex } from "./loader.js";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const spy = fs.readFileSync(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1 move spy.sav"));
const dip = fs.readFileSync(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1move diplomat and army.sav"));

function readLeg(buf, o) {
  if (o + 4 > buf.length) return null;
  const count = buf.readUInt32LE(o);
  if (count < 1 || count > 200 || o + 4 + count * 8 > buf.length) return null;
  const pts = [];
  for (let i = 0; i < count; i++) {
    const b = o + 4 + i * 8;
    const x = buf.readUInt32LE(b), y = buf.readUInt32LE(b + 4);
    if (x > 1000 || y > 1000) return null;
    pts.push([x, y]);
  }
  // adjacency
  for (let i = 1; i < count; i++) {
    const dx = Math.abs(pts[i][0]-pts[i-1][0]), dy = Math.abs(pts[i][1]-pts[i-1][1]);
    if (dx > 1 || dy > 1) return null;
  }
  return { count, pts, end: o + 4 + count * 8 };
}

// record = [u8 legCount][legCount legs][trailing]
function readRecord(buf, o) {
  const legCount = buf.readUInt8(o);
  if (legCount < 1 || legCount > 8) return null;
  let p = o + 1;
  const legs = [];
  for (let k = 0; k < legCount; k++) {
    const leg = readLeg(buf, p);
    if (!leg) break;
    legs.push(leg);
    p = leg.end;
  }
  return { legCount, legs, end: p, trailing: hex(buf, p, 6) };
}

function show(buf, off, label) {
  console.log(`\n=== ${label}  record@0x${off.toString(16)} ===`);
  const r = readRecord(buf, off);
  console.log(`legCount byte = ${r.legCount}, legs parsed = ${r.legs.length}  -> match=${r.legCount===r.legs.length}`);
  let continuous = true;
  r.legs.forEach((leg, i) => {
    const src = leg.pts[0], dst = leg.pts[leg.count-1];
    console.log(`  leg${i}: count=${leg.count} (${src[0]},${src[1]})->(${dst[0]},${dst[1]})  ${leg.pts.map(p=>`(${p[0]},${p[1]})`).join(" ")}`);
    if (i>0) {
      const prevDst = r.legs[i-1].pts[r.legs[i-1].count-1];
      if (prevDst[0]!==src[0] || prevDst[1]!==src[1]) continuous=false;
    }
  });
  if (r.legs.length>1) console.log(`  legs form continuous route (legN.dest==legN+1.src)? ${continuous}`);
  console.log(`  FINAL DESTINATION = (${r.legs[r.legs.length-1].pts.slice(-1)[0].join(",")})`);
  console.log(`  record bytes 0x${off.toString(16)}..0x${r.end.toString(16)} (${r.end-off}b); trailing: ${r.trailing}`);
}

show(spy, 0x3ba46, "SPY (spy save)");
show(dip, 0x3b936, "ARMY (dip save)");
show(dip, 0x3ba26, "DIPLOMAT (dip save)");
show(dip, 0x3bad2, "SPY-copy (dip save)");
