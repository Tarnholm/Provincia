// dig-siege-spain-corduba.js
// Anchored siege diff on the controlled Spain saves.
//  - Find "Settlement Under Siege" UTF-16 event frame + surrounding bytes.
//  - Find Corduba settlement marker in PRE and SIEGE, diff a +/- window.
//  - Hunt the +73-byte siege block (01 + uuid + 53 zeros + u16) in SIEGE
//    that is ABSENT in PRE -> that block IS the siege record; report its uuid
//    and try to map the uuid to the besieger army/faction.

const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const PRE   = "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav";
const SIEGE = "save_Autosave   Spain   Turn 4 besiged corduba.sav";
const pre   = fs.readFileSync(DIR + PRE);
const siege = fs.readFileSync(DIR + SIEGE);

function hexAscii(buf, off, n) {
  const lines = [];
  for (let r = 0; r < n; r += 16) {
    const row = []; let asc = "";
    for (let i = 0; i < 16 && r + i < n; i++) {
      const b = buf[off + r + i];
      row.push(b.toString(16).padStart(2, "0"));
      asc += (b >= 32 && b < 127) ? String.fromCharCode(b) : ".";
    }
    lines.push(`  0x${(off + r).toString(16)}: ${row.join(" ").padEnd(48)}  ${asc}`);
  }
  return lines.join("\n");
}
function u16le(s) { const t = Buffer.alloc(s.length * 2); for (let i = 0; i < s.length; i++) t.writeUInt16LE(s.charCodeAt(i), i * 2); return t; }

// ---- 1. "Settlement Under Siege" event frame ----
const sus = siege.indexOf(u16le("Settlement Under Siege"));
console.log(`"Settlement Under Siege" UTF-16 @0x${sus.toString(16)}`);
if (sus >= 0) {
  console.log("--- 160 bytes BEFORE the string ---");
  console.log(hexAscii(siege, sus - 160, 160));
  console.log("--- the string + 256 bytes AFTER ---");
  console.log(hexAscii(siege, sus, 256));
}

// ---- 2. Corduba marker windows ----
function findMarker(buf, name) {
  const t = Buffer.concat([Buffer.from([0x01, name.length, 0x00]), u16le(name), Buffer.from([0, 0])]);
  const a = []; let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) { a.push(p); p++; }
  // also flag byte 0x00
  const t2 = Buffer.concat([Buffer.from([0x00, name.length, 0x00]), u16le(name), Buffer.from([0, 0])]);
  p = 0; while ((p = buf.indexOf(t2, p)) !== -1) { a.push(p); p++; }
  return a;
}
const corPre = findMarker(pre, "Corduba");
const corSi  = findMarker(siege, "Corduba");
console.log(`\nCorduba PRE  : ${corPre.map(o => "0x" + o.toString(16)).join(", ")}`);
console.log(`Corduba SIEGE: ${corSi.map(o => "0x" + o.toString(16)).join(", ")}`);

// ---- 3. Hunt +73-byte siege blocks present in SIEGE but absent in PRE ----
function siegeBlocks(buf) {
  const out = [];
  for (let off = 0; off + 73 <= buf.length; off++) {
    if (buf[off] !== 0x01) continue;
    let nz = 0; for (let k = 1; k <= 12; k++) if (buf[off + k] !== 0) nz++;
    if (nz < 8) continue;
    let z = true; for (let k = 13; k <= 65; k++) if (buf[off + k] !== 0) { z = false; break; }
    if (!z) continue;
    const v = buf.readUInt16LE(off + 66);
    if (v === 0) continue;
    let tz = true; for (let k = 68; k <= 72; k++) if (buf[off + k] !== 0) { tz = false; break; }
    if (!tz) continue;
    out.push({ off, uuid: buf.slice(off + 1, off + 13).toString("hex"), u16: v });
  }
  return out;
}
const sbPre = siegeBlocks(pre);
const sbSi  = siegeBlocks(siege);
console.log(`\n+73 siege-like blocks: PRE=${sbPre.length} SIEGE=${sbSi.length}`);
const preUuids = new Set(sbPre.map(b => b.uuid));
const onlySiege = sbSi.filter(b => !preUuids.has(b.uuid));
console.log(`blocks present in SIEGE but not PRE: ${onlySiege.length}`);
for (const b of onlySiege.slice(0, 20)) {
  console.log(`  0x${b.off.toString(16)} uuid=${b.uuid} u16@+66=${b.u16}`);
}
// Show all SIEGE blocks too (the predicate may be too loose -> many; show counts)
console.log("\nAll SIEGE blocks (first 20):");
for (const b of sbSi.slice(0, 20)) console.log(`  0x${b.off.toString(16)} uuid=${b.uuid} u16=${b.u16}`);
