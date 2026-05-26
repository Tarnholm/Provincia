// dig-reputation-03-vanilla-recs.js
// Vanilla class-100 faction-record parser. Signature: u32(i+8)==100,
// u32(i+12)==1, u32(i+16)==0, u32(i+20)==0, selfptr@+24==i+24,
// selfptr@+40==i+40. (+44 varies 0/5/8 in vanilla, not 6.)
//
// Read regionCount, regionIds, faction_id (midblock+99), ai (midblock+135),
// turnStart treasury, and find the diplomacy marker. Survey across Spain turns.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const DIPLO_MARKER = 0x39240005;

const SAVES = {
  T1:      'save_17-05-2026   Spain   Turn 1.sav',
  T2trade: 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav',
  T3end:   'save_Autosave   Spain   Turn 3 End.sav',
  T4start: 'save_Autosave   Spain   Turn 4 Start.sav',
  T4war:   'save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav',
  T4:      'save_Autosave   Spain   Turn 4.sav',
};

function parseRecs(buf) {
  const out = [];
  for (let i = 0; i + 96 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    if (i + 244 + 4 * regions + 4 > buf.length) continue;
    const treasury = buf.readInt32LE(i);
    const midBase = i + 92 + 4 * regions;
    const turnStart = buf.readInt32LE(midBase);
    const factionId = buf.readUInt8(midBase + 99);
    const ai = buf.readUInt8(midBase + 135);
    const regionIds = [];
    for (let r = 0; r < regions; r++) regionIds.push(buf.readUInt32LE(i + 52 + r * 4));
    // Look for diplo marker at expected offset
    const expDiplo = i + 244 + 4 * regions;
    let diploOk = false, diploCount = 0;
    if (expDiplo + 8 <= buf.length && buf.readUInt32LE(expDiplo) === DIPLO_MARKER) {
      diploOk = true; diploCount = buf.readUInt32LE(expDiplo + 4);
    }
    out.push({ i, treasury, turnStart, regions, factionId, ai, regionIds, midBase, expDiplo, diploOk, diploCount, p44: buf.readUInt32LE(i+44) });
  }
  return out;
}

for (const [tag, file] of Object.entries(SAVES)) {
  const full = path.join(BASE, file);
  if (!fs.existsSync(full)) { console.log(`[${tag}] MISSING`); continue; }
  const buf = fs.readFileSync(full);
  const recs = parseRecs(buf);
  console.log(`\n=== ${tag}  size=${buf.length}  records=${recs.length} ===`);
  for (const r of recs) {
    console.log(`  @0x${r.i.toString(16).padStart(6,'0')} fid=${String(r.factionId).padStart(3)} ai=${String(r.ai).padStart(3)} reg=${String(r.regions).padStart(2)} treas=${String(r.treasury).padStart(7)} turnStart=${String(r.turnStart).padStart(7)} +44=${r.p44} diplo=${r.diploOk?('y#'+r.diploCount):'n'} regs=[${r.regionIds.slice(0,6).join(',')}]`);
  }
}
