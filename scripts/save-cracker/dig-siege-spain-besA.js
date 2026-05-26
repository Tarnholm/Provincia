// dig-siege-spain-besA.js
// besiged (A) is exactly 73 bytes SMALLER than besiged corduba but BOTH have a
// "Settlement Under Siege: Corduba" event. Anchor on the besieging army unit
// string ("carthaginian general's cavalry early") and see whether the +73
// siege block is present in besiged(A) right before it.

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
function findStr(buf, s) { const a=[]; let p=0; const t=Buffer.from(s,"latin1"); while ((p=buf.indexOf(t,p))!==-1){a.push(p);p++;} return a; }

const NAME = "carthaginian general's cavalry early";
const cAt = findStr(cor, NAME);
const aAt = findStr(besA, NAME);
console.log(`"${NAME}"`);
console.log("  corduba:", cAt.map(h=>"0x"+h.toString(16)).join(", "));
console.log("  besA   :", aAt.map(h=>"0x"+h.toString(16)).join(", "));

// In corduba the army record string is at 0x4799b and the +73 block at 0x4790b
// (string - 0x90). Anchor besA on its string and dump the same back-window.
if (aAt.length) {
  const aBase = aAt[0];
  console.log(`\n=== besiged(A): army-string back-window (str-0x110 .. str+0x60) ===`);
  console.log(hexAscii(besA, aBase - 0x110, 0x110 + 0x60));
}
if (cAt.length) {
  const cBase = cAt[0];
  console.log(`\n=== besiged corduba: army-string back-window (str-0x110 .. str+0x60) ===`);
  console.log(hexAscii(cor, cBase - 0x110, 0x110 + 0x60));
}

// Record-aligned diff on the army string: compare cor[cBase+dx] vs besA[aBase+dx]
if (cAt.length && aAt.length) {
  const cBase = cAt[0], aBase = aAt[0];
  console.log(`\n=== anchored diff (cor@0x${cBase.toString(16)} vs besA@0x${aBase.toString(16)}) over dx -300..+200 ===`);
  const runs=[]; let cur=null;
  for (let dx=-300; dx<200; dx++) {
    const a = cor[cBase+dx], b = besA[aBase+dx];
    if (a!==b) { if (cur && dx===cur.e+1) cur.e=dx; else {cur={s:dx,e:dx};runs.push(cur);} }
  }
  for (const r of runs) {
    const len=r.e-r.s+1;
    const ca=cor.slice(cBase+r.s,cBase+r.e+1).toString("hex");
    const ab=besA.slice(aBase+r.s,aBase+r.e+1).toString("hex");
    console.log(`  dx ${r.s}..${r.e} (${len})  cor=[${ca}] besA=[${ab}]`);
  }
}
