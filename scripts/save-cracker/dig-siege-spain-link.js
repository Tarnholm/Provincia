// dig-siege-spain-link.js
// Decode the single +73 siege block at 0x4790b in the Spain "besiged corduba"
// save and resolve its three u32 links:
//   +1  selfUuid  (siege-record's own id, SIEGE-only)
//   +5  link A
//   +9  link B  (= 0xe0307644)
// Identify which link is the BESIEGING army and which is the BESIEGED settlement
// by looking at the CONTEXT of every occurrence (nearby ASCII strings / markers).

const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const pre   = fs.readFileSync(DIR + "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav");
const siege = fs.readFileSync(DIR + "save_Autosave   Spain   Turn 4 besiged corduba.sav");
const siegeA= fs.readFileSync(DIR + "save_Autosave   Spain   Turn 4 besiged .sav");

function hexAscii(b, o, n) {
  const out = [];
  for (let r = 0; r < n; r += 16) {
    const row = []; let asc = "";
    for (let i = 0; i < 16 && r + i < n && o+r+i < b.length; i++) { const x = b[o + r + i]; row.push(x.toString(16).padStart(2, "0")); asc += (x >= 32 && x < 127) ? String.fromCharCode(x) : "."; }
    out.push(`  0x${(o + r).toString(16)}: ${row.join(" ").padEnd(48)}  ${asc}`);
  }
  return out.join("\n");
}
function u32occ(buf, v) { const t = Buffer.alloc(4); t.writeUInt32LE(v >>> 0); const a=[]; let p=0; while ((p=buf.indexOf(t,p))!==-1){a.push(p);p++;} return a; }
// Nearest preceding ASCII pstr16 (latin1) name within `back` bytes.
function nearestAscii(buf, at, back=400) {
  let best = null;
  for (let i = Math.max(0, at-back); i < at; i++) {
    const ln = buf.readUInt16LE(i);
    if (ln < 4 || ln > 64) continue;
    const ns=i+2, ne=ns+ln-1;
    if (ne >= buf.length || buf[ne] !== 0) continue;
    let ok=true,s="";
    for (let k=ns;k<ne;k++){const c=buf[k]; if(c<0x20||c>0x7e){ok=false;break;} s+=String.fromCharCode(c);}
    if (!ok) continue;
    if (!/[a-zA-Z]/.test(s)) continue;
    best = { at:i, s, dist: at-i };
  }
  return best;
}
// Nearest preceding UTF-16 settlement-style name (UpperCase first char) within back bytes.
function nearestUtf16(buf, at, back=600) {
  let best=null;
  for (let i = Math.max(0, at-back); i < at; i++) {
    if (buf[i+1] !== 0) continue;
    const c0 = buf[i];
    if (c0 < 0x41 || c0 > 0x5a) continue;
    // count run of ascii utf16
    let s="", j=i;
    while (j+1 < buf.length) { const lo=buf[j],hi=buf[j+1]; if(hi!==0||lo<0x20||lo>0x7e) break; s+=String.fromCharCode(lo); j+=2; }
    if (s.length >= 4 && s.length <= 24) best = { at:i, s, dist: at-i };
  }
  return best;
}

const off = 0x4790b;
const u1 = siege.readUInt32LE(off+1);
const u5 = siege.readUInt32LE(off+5);
const u9 = siege.readUInt32LE(off+9);
console.log("=== +73 siege block field map (corduba SIEGE) ===");
console.log(hexAscii(siege, off, 80));
console.log(`\n  +1 selfUuid = 0x${u1.toString(16)}`);
console.log(`  +5 linkA    = 0x${u5.toString(16)}`);
console.log(`  +9 linkB    = 0x${u9.toString(16)}`);
console.log(`  +66 u16     = ${siege.readUInt16LE(off+66)}`);
// values found in trailer region 0x4794d..
console.log(`  +66 u8s     = ${[...siege.slice(off+66, off+80)].map(b=>b.toString(16).padStart(2,'0')).join(' ')}`);

for (const [name, v] of [["linkA(+5)", u5], ["linkB(+9)", u9]]) {
  console.log(`\n=== ${name} = 0x${v.toString(16)} occurrences in SIEGE ===`);
  for (const at of u32occ(siege, v)) {
    const a = nearestAscii(siege, at, 300);
    const u = nearestUtf16(siege, at, 700);
    console.log(`  0x${at.toString(16)}  asciiNear=${a?`"${a.s}"@-${a.dist}`:"-"}  utf16Near=${u?`"${u.s}"@-${u.dist}`:"-"}`);
  }
}

// Look at the trailer right after the +73 zero-run. Block: off+13..off+65 zeros,
// then off+66 = 11 02; off+72.. 0d 00 00 00 64 00 00 00 64. Decode as fields.
console.log("\n=== trailer decode (off+64 .. off+96) ===");
for (let dx=64; dx<=96; dx+=4) {
  console.log(`  +${dx}: u32=${siege.readUInt32LE(off+dx)}  (bytes ${[...siege.slice(off+dx,off+dx+4)].map(b=>b.toString(16).padStart(2,'0')).join(' ')})`);
}

// Cross-check the SECOND siege save (besiged .sav, earlier autosave).
console.log("\n\n############ besiged .sav (SIEGE-A) cross-check ############");
function siegeBlocks(buf) {
  const out = [];
  for (let o = 0; o + 73 <= buf.length; o++) {
    if (buf[o] !== 0x01) continue;
    let nz=0; for (let k=1;k<=12;k++) if (buf[o+k]!==0) nz++;
    if (nz < 8) continue;
    let z=true; for (let k=13;k<=65;k++) if (buf[o+k]!==0){z=false;break;}
    if (!z) continue;
    if (buf.readUInt16LE(o+66) === 0) continue;
    let tz=true; for (let k=68;k<=71;k++) if (buf[o+k]!==0){tz=false;break;}
    if (!tz) continue;
    out.push(o);
  }
  return out;
}
for (const [lbl, buf] of [["besiged corduba", siege], ["besiged (A)", siegeA], ["PRE", pre]]) {
  const blks = siegeBlocks(buf);
  console.log(`\n${lbl}: ${blks.length} siege block(s)`);
  for (const b of blks) {
    console.log(`  @0x${b.toString(16)}  +1=0x${buf.readUInt32LE(b+1).toString(16)} +5=0x${buf.readUInt32LE(b+5).toString(16)} +9=0x${buf.readUInt32LE(b+9).toString(16)}  trailer=${[...buf.slice(b+64,b+80)].map(x=>x.toString(16).padStart(2,'0')).join(' ')}`);
  }
}
