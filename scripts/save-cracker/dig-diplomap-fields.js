// dig-diplomap-fields.js
//
// Pin down exact field boundaries in the preamble + footer.
//
// From dig-diplomap-structure.js the preamble (marker-64..marker) shows a
// repeating self-pointer / sub-record pattern. Decode it as u32 fields and
// check which are self-pointers (== absolute offset) so we know the record
// grammar, not just byte volatility.
//
// Also classify the footer: 0xef(=239) appears at footer+0 for 219/220 zones.
// 239 happens to be the number of factions. Test whether 0xef is a SECTION /
// next-record tag vs a faction-count constant, and whether footer+4 0x1e(=30)
// is a registry type id.
//
// Usage: node dig-diplomap-fields.js [savePath]
"use strict";
const fs = require("fs");
const path = require("path");
const SAVES = {
  seleucid: "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav",
  macedon: "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav",
};
const DESCR_SM_FACTIONS = "C:/RIS/RIS/data/descr_sm_factions.txt";
const MARKER = 0x39240005;

function parseFactionOrder(text) {
  const order = []; let cur = null, depth = 0, inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim(); if (s.startsWith(";")) continue;
    const prev = depth; for (const ch of s) { if (ch === "{") depth++; if (ch === "}") depth--; }
    if (inBlock && depth === 0) { cur = null; inBlock = false; }
    if (prev === 0 && depth === 0) { const m = s.match(/^"([^"]+)"\s*:/); if (m && m[1].toLowerCase() !== "factions") cur = m[1].toLowerCase(); }
    if (cur && prev === 0 && depth === 1) { inBlock = true; if (!order.includes(cur)) order.push(cur); }
  }
  return order;
}

function findZones(buf, fo) {
  const zones = [];
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 200) continue;
    const end = i + 8 + count * 16;
    if (end > buf.length) continue;
    zones.push({ off: i, count, fid: buf[i - 53], name: (buf[i-53] < fo.length ? fo[buf[i-53]] : "?"), entriesEnd: end });
  }
  return zones;
}

function run(savePath, fo) {
  const buf = fs.readFileSync(savePath);
  const zones = findZones(buf, fo);
  console.log(`\n=== ${path.basename(savePath)} (${zones.length} zones) ===`);

  // --- Decode preamble as u32 fields, mark self-pointers ---
  // Use a non-first, non-player zone (a "minor" with count>=2) so the pattern
  // is the generic one, plus the first(major) for contrast.
  const minor = zones.find(z => z.count >= 2 && z.fid > 30) || zones[1];
  const major = zones[0];
  for (const z of [major, minor]) {
    console.log(`\n-- u32 decode of preamble for ${z.name}(fid${z.fid}) @0x${z.off.toString(16)} count=${z.count} --`);
    for (let rel = -60; rel < 0; rel += 4) {
      const o = z.off + rel;
      if (o < 0) continue;
      const v = buf.readUInt32LE(o);
      let note = "";
      if (v === o) note = "== absolute offset (SELF-PTR)";
      else if (v === o + 4) note = "== offset+4";
      else if (Math.abs(v - z.off) < 0x200 && v > 0x100000) note = `~near marker (marker${v>=z.off?'+':'-'}${Math.abs(v-z.off)})`;
      else if (v < 256) note = "small (count/enum/flag?)";
      console.log(`   rel ${String(rel).padStart(3)} (abs 0x${o.toString(16)}): u32=${v} (0x${v.toString(16)})  ${note}`);
    }
    // The bytes immediately before marker: -13..-1
    console.log(`   bytes [-13..-1]: ${Array.from(buf.slice(z.off-13, z.off)).map(b=>b.toString(16).padStart(2,"0")).join(" ")}`);
  }

  // --- Footer classification: is footer+0 a self-pointer to footer+0? ---
  // From structure run, footer u32@+0 for FIRST zone == footer offset itself
  // (self-ptr) while for minor zones it was 239. Re-examine carefully:
  console.log(`\n-- FOOTER u32 decode (first 4 u32) for several zones --`);
  const footSamples = [zones[0], minor, zones[Math.floor(zones.length/2)], zones[zones.length-1]];
  for (const z of footSamples) {
    const f = z.entriesEnd;
    if (f + 16 > buf.length) continue;
    const u0 = buf.readUInt32LE(f), u1 = buf.readUInt32LE(f+4), u2 = buf.readUInt32LE(f+8), u3 = buf.readUInt32LE(f+12);
    const ptr = (u0 === f) ? "u0==footerOffset(SELF-PTR)" : (Math.abs(u0 - f) < 0x100 && u0 > 0x100000) ? `u0 near footer (footer${u0>=f?'+':'-'}${Math.abs(u0-f)})` : "";
    console.log(`   ${z.name}(fid${z.fid}) footer@0x${f.toString(16)}: u0=${u0}(0x${u0.toString(16)}) u1=${u1} u2=${u2} u3=${u3}  ${ptr}`);
  }

  // --- Is 0xef == faction count, or a registry/section type? ---
  // Count how many zones have footer+0 byte == 0xef and whether the *next*
  // structure is the next faction's record. We test: does footer+12 (=0x1e=30)
  // appear right before some recognizable next-record? Just report the byte
  // window from footer to footer+24 for the minor zone with full hex.
  const f = minor.entriesEnd;
  console.log(`\n-- minor zone footer hex window [footer .. +40] --`);
  console.log(`   ${Array.from(buf.slice(f, f+40)).map(b=>b.toString(16).padStart(2,"0")).join(" ")}`);
  console.log(`   interpretation: u32 ${buf.readUInt32LE(f)} | u32 ${buf.readUInt32LE(f+4)} | u32 ${buf.readUInt32LE(f+8)}(0x${buf.readUInt32LE(f+8).toString(16)}) | u32 ${buf.readUInt32LE(f+12)} | ...`);

  // --- Confirm the marker-to-marker stride for adjacent minor zones, to see
  // if the footer flows directly into the next zone's preamble ---
  console.log(`\n-- adjacent zone gap analysis (distance from one entriesEnd to next marker-64) --`);
  let directFlow = 0;
  for (let i = 0; i + 1 < zones.length; i++) {
    const gap = zones[i+1].off - zones[i].entriesEnd;
    if (i < 6) console.log(`   ${zones[i].name}(${zones[i].count}) end0x${zones[i].entriesEnd.toString(16)} -> next marker 0x${zones[i+1].off.toString(16)}  gap=${gap} bytes`);
  }

  // --- Does uuid order correlate with faction-id order? (flag for partner agent) ---
  // For each zone, see if first entry uuid relates to fid. Quick check: print
  // (fid, first-uuid, sorted?) for the 23 majors (low fid) to let partner agent
  // judge. We DON'T interpret — just surface.
  console.log(`\n-- (FOR PARTNER AGENT) fid vs first/last entry uuid + sortedness, low-fid zones --`);
  const lowFid = zones.filter(z => z.fid < 23).sort((a,b)=>a.fid-b.fid);
  for (const z of lowFid.slice(0, 12)) {
    const first = buf.readUInt32LE(z.off+8);
    const last = buf.readUInt32LE(z.off+8+(z.count-1)*16);
    let sorted = true, prev=-1;
    for (let k=0;k<z.count;k++){const u=buf.readUInt32LE(z.off+8+k*16); if(u<=prev)sorted=false; prev=u;}
    console.log(`   fid=${String(z.fid).padStart(2)} ${z.name.padEnd(14)} count=${String(z.count).padStart(3)} firstUuid=${first} lastUuid=${last} sorted=${sorted}`);
  }
}

const fo = parseFactionOrder(fs.readFileSync(DESCR_SM_FACTIONS, "utf8"));
for (const k of Object.keys(SAVES)) if (fs.existsSync(SAVES[k])) run(SAVES[k], fo);
