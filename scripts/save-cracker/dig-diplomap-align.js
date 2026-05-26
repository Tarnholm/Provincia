// dig-diplomap-align.js
//
// Lock down the IMMEDIATE pre-marker grammar (aligned to the marker, reading
// backward in u32 steps) and confirm the footer self-pointer header.
//
// The marker is at offset M. The preamble's meaningful fields are the ones
// directly abutting the marker. Read M-16, M-12, M-8, M-4 as u32 (4-aligned to
// the marker) so we see the real field values, then verify across all zones
// which of these are constant.
//
// Also: footer M+8+16*count has u0==footerOffset (self-ptr). Verify this is a
// generic "next sub-record" header by checking u0==its own offset for EVERY
// zone, and decode u1 (the value after the self-ptr).
//
// Usage: node dig-diplomap-align.js
"use strict";
const fs = require("fs");
const path = require("path");
const SAVES = {
  seleucid: "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav",
  macedon: "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav",
};
const DESCR_SM_FACTIONS = "C:/RIS/RIS/data/descr_sm_factions.txt";
const MARKER = 0x39240005;
function parseFactionOrder(text){const order=[];let cur=null,depth=0,inBlock=false;for(const raw of text.split(/\r?\n/)){const s=raw.trim();if(s.startsWith(";"))continue;const prev=depth;for(const ch of s){if(ch==="{")depth++;if(ch==="}")depth--;}if(inBlock&&depth===0){cur=null;inBlock=false;}if(prev===0&&depth===0){const m=s.match(/^"([^"]+)"\s*:/);if(m&&m[1].toLowerCase()!=="factions")cur=m[1].toLowerCase();}if(cur&&prev===0&&depth===1){inBlock=true;if(!order.includes(cur))order.push(cur);}}return order;}
function findZones(buf,fo){const z=[];for(let i=53;i+8<buf.length;i++){if(buf.readUInt32LE(i)!==MARKER)continue;const c=buf.readUInt32LE(i+4);if(c===0||c>200)continue;const end=i+8+c*16;if(end>buf.length)continue;z.push({off:i,count:c,fid:buf[i-53],name:(buf[i-53]<fo.length?fo[buf[i-53]]:"?"),entriesEnd:end});}return z;}

function run(savePath,fo){
  const buf=fs.readFileSync(savePath);
  const zones=findZones(buf,fo);
  console.log(`\n=== ${path.basename(savePath)} ===`);

  // marker-aligned backward fields (M-4, M-8, M-12, M-16): which are constant?
  console.log(`-- marker-aligned u32 fields (M-N) constant check across ${zones.length} zones --`);
  for (const rel of [-16, -12, -8, -4]) {
    const m = new Map();
    for (const z of zones) { const v = buf.readUInt32LE(z.off + rel); m.set(v, (m.get(v)||0)+1); }
    const sorted=[...m.entries()].sort((a,b)=>b[1]-a[1]);
    console.log(`   M${rel}: ${m.size} distinct -> ${sorted.slice(0,6).map(([v,c])=>`0x${v.toString(16)}:${c}`).join("  ")}${m.size>6?" ...":""}`);
  }

  // footer self-pointer verification: u0 == footerOffset for all zones?
  let selfPtr=0, notSelf=0; const u1map=new Map();
  for (const z of zones) {
    const f=z.entriesEnd; if (f+8>buf.length){notSelf++;continue;}
    const u0=buf.readUInt32LE(f), u1=buf.readUInt32LE(f+4);
    if (u0===f) selfPtr++; else notSelf++;
    u1map.set(u1,(u1map.get(u1)||0)+1);
  }
  console.log(`-- FOOTER u0==footerOffset (self-ptr): ${selfPtr}/${zones.length}; u1 values: ${[...u1map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([v,c])=>`${v}:${c}`).join("  ")}`);

  // What is at footer for the 219 zones that AREN'T self-ptr? (the structure
  // shows ef 00 00 00 ef 00 00 00 = two u32=239). Re-derive: maybe count==1
  // single-entry zones share their footer with the next record differently.
  // Bucket footer-u0 by whether it's self-ptr, and correlate with count.
  let selfByCount=new Map(), efByCount=new Map();
  for (const z of zones){
    const f=z.entriesEnd; if(f+8>buf.length)continue;
    const u0=buf.readUInt32LE(f);
    if(u0===f) selfByCount.set(z.count,(selfByCount.get(z.count)||0)+1);
    else if(u0===239) efByCount.set(z.count,(efByCount.get(z.count)||0)+1);
  }
  console.log(`   self-ptr footer counts by zone.count: ${[...selfByCount.entries()].sort((a,b)=>a[0]-b[0]).map(([c,n])=>`cnt${c}:${n}`).join(" ")}`);
  console.log(`   ef(239) footer counts by zone.count: ${[...efByCount.entries()].sort((a,b)=>a[0]-b[0]).slice(0,8).map(([c,n])=>`cnt${c}:${n}`).join(" ")} ...`);

  // The ONE self-ptr footer is the player zone (largest). Confirm:
  const playerZone = zones.find(z=>{const f=z.entriesEnd; return f+4<=buf.length && buf.readUInt32LE(f)===f;});
  if (playerZone) console.log(`   self-ptr-footer zone = ${playerZone.name}(fid${playerZone.fid}) count=${playerZone.count}  <-- this is the PLAYER zone (att5/tag0)`);

  // Distinguish PLAYER zone (tag==0, att==5) from NPC zones (tag=0x10101).
  // Count zones whose entries are ALL tag0 vs all tag0x10101.
  let allTag0=0, allTag1=0, mixed=0;
  for (const z of zones){
    let t0=0,t1=0; for(let k=0;k<z.count;k++){const t=buf.readUInt32LE(z.off+8+k*16+12); if(t===0)t0++; else if(t===0x10101)t1++;}
    if(t0===z.count)allTag0++; else if(t1===z.count)allTag1++; else mixed++;
  }
  console.log(`-- zone tag homogeneity: allTag0(player-style)=${allTag0}  allTag0x10101(npc-style)=${allTag1}  mixed=${mixed}`);
}
const fo=parseFactionOrder(fs.readFileSync(DESCR_SM_FACTIONS,"utf8"));
for(const k of Object.keys(SAVES)) if(fs.existsSync(SAVES[k])) run(SAVES[k],fo);
