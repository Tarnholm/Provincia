// dig-siege-spain-truearmy.js
// The +73 siege block in 'corduba' sits at 0x4790b, right before the army
// record copy at 0x47999. In besiged(A) the matching army copy is at 0x47950.
// Dump besiged(A) around 0x47950 - 0x100 to see if a (different) siege block
// exists, and dump corduba around 0x47999-0x110 for the exact 1:1 comparison.
// Also: classify the besieging army's faction by the captain banner / unit
// culture, and resolve linkA(0x722344b) -> which settlement record.

const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const cor  = fs.readFileSync(DIR + "save_Autosave   Spain   Turn 4 besiged corduba.sav");
const besA = fs.readFileSync(DIR + "save_Autosave   Spain   Turn 4 besiged .sav");

function hexAscii(b, o, n) {
  const out = [];
  for (let r = 0; r < n; r += 16) {
    const row = []; let asc = "";
    for (let i = 0; i < 16 && r + i < n && o+r+i<b.length; i++) { const x = b[o + r + i]; row.push(x.toString(16).padStart(2, "0")); asc += (x >= 32 && x < 127) ? String.fromCharCode(x) : "."; }
    out.push(`  0x${(o + r).toString(16)}: ${row.join(" ").padEnd(48)}  ${asc}`);
  }
  return out.join("\n");
}

// The "true" besieger army copy in corduba is at 0x47999. In besiged(A) it's
// at 0x47950 (from earlier scan). Dump both with a 0x110 back window.
console.log("=== corduba: army@0x47999, back 0x130 ===");
console.log(hexAscii(cor, 0x47999 - 0x130, 0x130 + 0x20));
console.log("\n=== besiged(A): army@0x47950, back 0x130 ===");
console.log(hexAscii(besA, 0x47950 - 0x130, 0x130 + 0x20));

// linkA = 0x722344b. In SIEGE it was nearest "hinterland_farms"/"Palma"/"Baliares".
// That doesn't look like Corduba. Re-resolve: scan for the settlement whose
// region-record/settlement-record holds 0x722344b. Also resolve the besieged
// settlement properly: find Corduba marker and read its nearby UUID, then check
// if it equals self/linkA/army.
function u16le(s){const t=Buffer.alloc(s.length*2);for(let i=0;i<s.length;i++)t.writeUInt16LE(s.charCodeAt(i),i*2);return t;}
function findMarker(buf, name) {
  for (const flag of [0x01,0x00]) {
    const t = Buffer.concat([Buffer.from([flag,name.length,0]), u16le(name), Buffer.from([0,0])]);
    const p = buf.indexOf(t); if (p!==-1) return p;
  }
  return -1;
}
const cordubaM = findMarker(cor, "Corduba");
console.log(`\nCorduba marker @0x${cordubaM.toString(16)}`);
console.log("Corduba marker context (name-32 .. name+200):");
console.log(hexAscii(cor, cordubaM-32, 232));

// Where does the besieging army UUID 0xe0307644 sit relative to Corduba marker?
function u32occ(buf, v){const t=Buffer.alloc(4);t.writeUInt32LE(v>>>0);const a=[];let p=0;while((p=buf.indexOf(t,p))!==-1){a.push(p);p++;}return a;}
console.log("\narmy UUID 0xe0307644 occurrences (corduba):", u32occ(cor, 0xe0307644).map(h=>"0x"+h.toString(16)).join(", "));
console.log("self UUID 0x7f124d5c occurrences (corduba):", u32occ(cor, 0x7f124d5c).map(h=>"0x"+h.toString(16)).join(", "));
console.log("linkA    0x0722344b occurrences (corduba):", u32occ(cor, 0x0722344b).map(h=>"0x"+h.toString(16)).join(", "));
