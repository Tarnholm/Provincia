// Verify the ancillary boundary. trEnd = traitsStart + traitCount*8 (after the
// last REAL trait, now confirmed). Ancillaries + portrait pstr16 follow. Does
// the current parser ([u16 pad][u16 id] from trEnd) capture all of them, or
// drop the first? Test both readings against the ancillary name list.
const fs = require("fs");
const cp = require("C:/dev/Provincia/src/characterParser.js");

const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const traitNames = [], ancNames = [], nameLookup = [];
for (const l of fs.readFileSync("C:/RIS/RIS/data/export_descr_character_traits.txt","utf8").split(/\r?\n/)){const m=l.match(/^Trait\s+(\S+)/);if(m)traitNames.push(m[1]);}
for (const l of fs.readFileSync("C:/RIS/RIS/data/export_descr_ancillaries.txt","utf8").split(/\r?\n/)){const m=l.match(/^Ancillary\s+(\S+)/);if(m)ancNames.push(m[1]);}
for (const l of fs.readFileSync("C:/RIS/RIS/data/text/names.txt","utf16le").split(/\r?\n/)){const m=l.replace(/^﻿/,"").match(/^\{[^}]+\}(.+)$/);if(m)nameLookup.push(m[1].trim());}

const buf = fs.readFileSync(SAVE);
const chars = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
const okAnc = (id) => id >= 0 && id < ancNames.length && !!ancNames[id];

function layout(c) {
  for (const [tcOff, tsOff] of [[302,308],[298,304]]) {
    if (c.offset + tsOff + 8 > buf.length) continue;
    const tc = buf.readUInt16LE(c.offset + tcOff);
    if (c.traits && c.traits.length && buf.readUInt32LE(c.offset+tsOff) === c.traits[0].id && tc>=1 && tc<=64) return { tc, tsOff };
  }
  return null;
}

let withAnc = chars.filter(c => c.ancillaries && c.ancillaries.length > 0).slice(0, 10);
console.log(`chars with ancillaries (current parse): ${chars.filter(c=>c.ancillaries&&c.ancillaries.length).length}`);
for (const c of withAnc) {
  const ly = layout(c); if (!ly) continue;
  const trEnd = c.offset + ly.tsOff + ly.tc * 8;
  // find "data/" within 200 bytes
  let dataPos = -1;
  for (let i = -8; i < 200; i++) { if (buf[trEnd+i]===0x64&&buf[trEnd+i+1]===0x61&&buf[trEnd+i+2]===0x74&&buf[trEnd+i+3]===0x61&&buf[trEnd+i+4]===0x2f){dataPos=i;break;} }
  // CURRENT parser reading: u16 ids at trEnd+2 + i*4, count = (dataPos-4)/4
  const curIds = [];
  if (dataPos > 0) { const n=(dataPos-4)/4|0; for(let i=0;i<n;i++) curIds.push(buf.readUInt16LE(trEnd + i*4 + 2)); }
  // ALT (ancil agent): u32 ids at trEnd-2 + i*4, count@trEnd-4
  const altCount = buf.readUInt16LE(trEnd - 4);
  const altIds = []; if (altCount>=1&&altCount<=12) for(let i=0;i<altCount;i++) altIds.push(buf.readUInt32LE(trEnd - 2 + i*4));
  const fmt = (ids) => ids.map(id => `${id}${okAnc(id)?`(${ancNames[id]})`:"✗"}`).join(",");
  console.log(`\n@0x${c.offset.toString(16)} tc=${ly.tc} dataPos=+${dataPos} curParse=[${c.ancillaries.map(a=>a.id).join(",")}]`);
  console.log(`  CURRENT(u16@trEnd+2): [${fmt(curIds)}]  allValid=${curIds.length>0&&curIds.every(okAnc)}`);
  console.log(`  ALT(u32@trEnd-2,cnt@trEnd-4=${altCount}): [${fmt(altIds)}]  allValid=${altIds.length>0&&altIds.every(okAnc)}`);
  // raw bytes trEnd-4 .. trEnd+ (dataPos)
  const hx=[];for(let i=-4;i<Math.min(dataPos>0?dataPos:24, 28);i++)hx.push(buf[trEnd+i].toString(16).padStart(2,"0"));
  console.log(`  bytes trEnd-4..: ${hx.join(" ")}`);
}
