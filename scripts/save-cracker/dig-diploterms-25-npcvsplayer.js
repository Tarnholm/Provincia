// dig-diploterms-25-npcvsplayer.js
// Reconcile NPC-zone class vs player-zone class. Hypothesis: NPC zones encode
// the SAME relation but the player zone has attitude=5 (engine doesn't compute
// player's mood) while NPC zones carry real attitude 0-4. Test whether class has
// the SAME meaning in both by checking: does the player's trade partner (class2)
// also appear as class2 somewhere, and is NPC class2 = war or trade?
//
// Decisive test: SLAVE is at war with ALL. In the Carthage-player RIS save, which
// has 219 NPC zones, the slave NPC zone should have ALL entries = "war" class.
"use strict";
const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const MARKER = 0x39240005;

function findZonesByFid(buf) {
  const seen = new Map();
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count > 250) continue;
    const fid = buf[i - 53];
    const entries = [];
    let ok = true;
    for (let k = 0; k < count; k++) { const o=i+8+k*16; if(o+16>buf.length){ok=false;break;} entries.push({class_:buf.readUInt32LE(o+4),attitude:buf.readUInt32LE(o+8),tag:buf.readUInt32LE(o+12)}); }
    if (!ok) continue;
    if(!seen.has(fid)||seen.get(fid).count<count) seen.set(fid, {fid,count,entries});
  }
  return seen;
}

// VANILLA Spain T1: slave fid=20 NPC zone (slave at war w/ all 20).
const buf = fs.readFileSync(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1.sav"));
const z = findZonesByFid(buf);
const slave = z.get(20);
console.log("VANILLA Spain T1 SLAVE NPC zone (slave at war with all factions):");
const ch = {}, ah = {};
for (const e of slave.entries) { ch[e.class_]=(ch[e.class_]||0)+1; ah[e.attitude]=(ah[e.attitude]||0)+1; }
console.log(`  count=${slave.count} class=${JSON.stringify(ch)} attitude=${JSON.stringify(ah)}`);
console.log(`  -> slave is at war with EVERYONE; if class2=war, class should be ~all 2. It's NOT (${JSON.stringify(ch)}).`);
console.log(`  -> CONCLUSION: NPC-zone class is NOT a war flag either.\n`);

// What DOES correlate? slave zone has 30 entries but only 20 factions + slave.
// The extra 10 = rebel sub-groups. Let me reconsider: maybe each NPC zone entry
// is one MET faction and class encodes the relation TYPE from that faction's POV.
// For slave (everyone wars it), its OWN view of others should be uniform war.
// The mixed values suggest the entries are NOT 'slave's relations' but something
// indexed differently. Print attitude per class for slave:
console.log("SLAVE entries (class:attitude pairs):");
const pairs = slave.entries.map(e=>`c${e.class_}a${e.attitude}`).sort();
console.log("  " + pairs.join(" "));

// Compare: the player's (spain) own relation to slave. Spain is at war w/ slave.
// Spain's player zone has uuids 40,52,62,50 all class5 (except 62=trade).
// So Spain's war-with-slave does NOT appear as an entry in spain's player zone!
console.log("\nSpain player zone (tag=0) has only 4 entries (met factions w/ deals or notable):");
const sp = z.get(18);
console.log("  " + sp.entries.map(e=>`c${e.class_}a${e.attitude}`).join(" "));
console.log("  -> war-with-slave is NOT listed. So the player zone lists DEALS, not wars.");
