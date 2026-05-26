// dig-ancil-canonical.js — research/diagnostic ONLY
// Final: express the ancillary block in RECORD-RELATIVE offsets and show
// the relationship to traitCount, so the layout can be documented precisely.
//
// FINDINGS so far:
//   trEnd      = recordStart + tsOff + traitCount*8   (existing parser's value)
//   ancCount   = u16 @ (trEnd - 4)
//   ancId[k]   = u32 @ (trEnd - 2 + k*4),  k = 0..ancCount-1
//   portLen    = u16 @ (trEnd - 2 + ancCount*4)   (start of portrait ASCII)
//
// Equivalent record-relative form (the REAL trait list is traitCount-1 entries;
// the last 8-byte "slot" the parser counts is actually [terminator u16=??][...]):
//   The ancillary COUNT lives in the low u16 of the slot the parser treats as
//   trait #(traitCount-1)'s LEVEL field. i.e. count is at:
//     recordStart + tsOff + (traitCount-1)*8 + 4   == trEnd - 4.   ✓
//
// Show this for AntigonosB plus prove the "real trait count" = traitCount-1
// matches the descr_strat trait list length.

const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/RIS/RIS/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const SAVE = "save_macedon t0.sav";

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitNames.push(tm[1]);
}
const ancNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_ancillaries.txt"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^Ancillary\s+(\S+)/); if (m) ancNames.push(m[1]);
}

const buf = fs.readFileSync(path.join(SAVES, SAVE));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
const recByTile = new Map();
for (const r of recs) if (r.tileX != null) recByTile.set(`${r.tileX},${r.tileY}`, r);

// AntigonosB
const r = recByTile.get("393,391");
const layoutA = !!r.lastName;
const tsOff = layoutA ? 308 : 304;
const tcOff = layoutA ? 302 : 298;
const tc = buf.readUInt16LE(r.offset + tcOff);
const trEnd = r.offset + tsOff + tc * 8;
console.log(`AntigonosB layout=${layoutA?"A":"B"}`);
console.log(`  traitCount field (u16 @ rec+${tcOff}) = ${tc}`);
console.log(`  tsOff(traitsStart) = ${tsOff}`);
console.log(`  trEnd = rec+${tsOff}+${tc}*8 = rec+${tsOff + tc*8}  (0x${trEnd.toString(16)})`);
console.log(`  ancCount @ trEnd-4 (rec+${tsOff + tc*8 - 4}) = ${buf.readUInt16LE(trEnd-4)}`);
const cnt = buf.readUInt16LE(trEnd-4);
for (let k=0;k<cnt;k++){
  const o=(trEnd-2)+k*4;
  const id=buf.readUInt32LE(o);
  console.log(`    ancId[${k}] @ trEnd-2+${k}*4 (rec+${o-r.offset}) u32 = ${id} = ${ancNames[id]}`);
}
console.log(`  portrait len u16 @ trEnd-2+${cnt}*4 (rec+${(trEnd-2+cnt*4)-r.offset}) = ${buf.readUInt16LE(trEnd-2+cnt*4)}`);

// Prove "displayed trait count" = traitCount - 1 by listing the parser's traits.
console.log(`\n  parser reported ${r.traits.length} traits (loop runs tc-1=${tc-1} iters):`);
console.log(`    first 3: ${r.traits.slice(0,3).map(t=>t.name).join(", ")}`);
console.log(`    last 3:  ${r.traits.slice(-3).map(t=>t.name).join(", ")}`);

// Cross-save spot check: does the SAME layout decode another save's leader?
const OTHER = "save_Seleucids t0.sav";
try {
  const b2 = fs.readFileSync(path.join(SAVES, OTHER));
  const r2 = cp.findCharacterRecords(b2, nameLookup, traitNames, null);
  let ok=0, tot=0;
  for (const c of r2) {
    const la=!!c.lastName; const ts=la?308:304; const tco=la?302:298;
    const t=b2.readUInt16LE(c.offset+tco); if(t<1) continue;
    const te=c.offset+ts+t*8; if(te-4<0||te+64>b2.length) continue;
    const cc=b2.readUInt16LE(te-4); if(cc<1||cc>16) continue;
    tot++; let good=true;
    for(let k=0;k<cc;k++){const id=b2.readUInt32LE(te-2+k*4); if(id>=ancNames.length||!ancNames[id]){good=false;break;}}
    const pl=b2.readUInt16LE(te-2+cc*4); if(pl<10||pl>200) good=false;
    if(good) ok++;
  }
  console.log(`\nCross-save (${OTHER}): records with ancCount>0 = ${tot}, fully-resolving = ${ok} (${(ok/tot*100).toFixed(1)}%)`);
} catch(e){ console.log("\n(cross-save skipped: "+e.message+")"); }
