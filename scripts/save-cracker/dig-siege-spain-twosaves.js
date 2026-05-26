// dig-siege-spain-twosaves.js
// Compare BOTH Spain siege autosaves against PRE, and find the siege block in
// each by anchoring on the army UNIT strings (which survive UUID re-salt),
// not on absolute offset. Determine what "besiged .sav" (the earlier autosave)
// actually contains — it may be a DIFFERENT siege or pre-establishment.

const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const pre    = fs.readFileSync(DIR + "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav");
const cor    = fs.readFileSync(DIR + "save_Autosave   Spain   Turn 4 besiged corduba.sav");
const besA   = fs.readFileSync(DIR + "save_Autosave   Spain   Turn 4 besiged .sav");
const final  = fs.readFileSync(DIR + "save_Autosave   Spain   Turn 4.sav");

function hexAscii(b, o, n) {
  const out = [];
  for (let r = 0; r < n; r += 16) {
    const row = []; let asc = "";
    for (let i = 0; i < 16 && r + i < n && o+r+i<b.length; i++) { const x = b[o + r + i]; row.push(x.toString(16).padStart(2, "0")); asc += (x >= 32 && x < 127) ? String.fromCharCode(x) : "."; }
    out.push(`  0x${(o + r).toString(16)}: ${row.join(" ").padEnd(48)}  ${asc}`);
  }
  return out.join("\n");
}
function u16le(s){const t=Buffer.alloc(s.length*2);for(let i=0;i<s.length;i++)t.writeUInt16LE(s.charCodeAt(i),i*2);return t;}

// Event-log "Settlement Under Siege" + the preceding besieged-settlement name.
function siegeEvents(buf, label) {
  console.log(`\n=== ${label}: "Settlement Under Siege" events ===`);
  const T = u16le("Settlement Under Siege");
  let p = 0, n=0;
  while ((p = buf.indexOf(T, p)) !== -1) {
    n++;
    // back up to find the settlement name (UTF-16, before the SUS string)
    // pattern from corduba: [07 00][07 00] then name "Corduba" then [16 00] then SUS
    // settlement name is ~ 2 + namelen*2 + 2 before SUS
    let nameStr = "";
    for (let back = 6; back < 60; back += 2) {
      const lenAt = p - back;
      if (lenAt < 0) break;
      const ln = buf.readUInt16LE(lenAt);
      if (ln >= 4 && ln <= 24 && lenAt + 2 + ln*2 <= p) {
        let s="",ok=true;
        for (let i=0;i<ln;i++){const lo=buf[lenAt+2+i*2],hi=buf[lenAt+2+i*2+1];if(hi!==0||lo<0x20||lo>0x7e){ok=false;break;}s+=String.fromCharCode(lo);}
        if (ok && /^[A-Z]/.test(s)) { nameStr = s; }
      }
    }
    console.log(`  SUS@0x${p.toString(16)}  besieged="${nameStr}"`);
    p += 2;
  }
  if (n===0) console.log("  (none)");
}
siegeEvents(cor,  "besiged corduba");
siegeEvents(besA, "besiged (A)");
siegeEvents(final,"Turn 4 (final)");
siegeEvents(pre,  "PRE");

// Generic siege-block finder: 0x01 then 3 u32 then 53 zero, allow trailer var.
function findSiegeBlocks(buf) {
  const out = [];
  for (let o = 0x10000; o + 90 <= buf.length; o++) {
    if (buf[o] !== 0x01) continue;
    const a=buf.readUInt32LE(o+1), b=buf.readUInt32LE(o+5), c=buf.readUInt32LE(o+9);
    if (a===0||b===0||c===0) continue;
    if (a===0xffffffff||b===0xffffffff||c===0xffffffff) continue;
    // 53 zero bytes after the 3 uuids (o+13 .. o+65)
    let z=true; for (let k=13;k<=65;k++) if (buf[o+k]!==0){z=false;break;}
    if (!z) continue;
    // require some non-zero structure in trailer 66..95
    let nz=0; for (let k=66;k<=95;k++) if (buf[o+k]!==0) nz++;
    if (nz < 2 || nz > 16) continue;
    out.push({o,a,b,c});
  }
  return out;
}
for (const [lbl, buf] of [["besiged corduba", cor], ["besiged (A)", besA], ["Turn4 final", final], ["PRE", pre]]) {
  const blks = findSiegeBlocks(buf);
  console.log(`\n=== ${lbl}: generic siege blocks = ${blks.length} ===`);
  for (const x of blks.slice(0,8)) {
    console.log(`  @0x${x.o.toString(16)} self=0x${x.a.toString(16)} linkA=0x${x.b.toString(16)} army=0x${x.c.toString(16)}`);
    console.log(hexAscii(buf, x.o, 96));
  }
}
