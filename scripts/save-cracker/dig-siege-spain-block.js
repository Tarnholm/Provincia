// dig-siege-spain-block.js
// The +73 siege flag sits inside an army/character record region. Map the
// whole record: who owns it (besieger or defender?), what the UUIDs link to,
// and re-diff this exact record between PRE and SIEGE (aligning on the army's
// own stable UUID, not on absolute offset).

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
function findBytes(buf, hexstr, max = 40) {
  const t = Buffer.from(hexstr, "hex"); const a = []; let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1 && a.length < max) { a.push(p); p++; }
  return a;
}

// The army UUID = e0307644 (LE) = 0xe0307644. It tags the besieging/defending
// army the siege block belongs to. Find its record in BOTH saves and dump.
const ARMY_UUID_LE = "447630e0"; // bytes as they appear
console.log("=== army UUID 44 76 30 e0 occurrences ===");
console.log("PRE  :", findBytes(pre, ARMY_UUID_LE).map(h => "0x" + h.toString(16)).join(", "));
console.log("SIEGE:", findBytes(siege, ARMY_UUID_LE).map(h => "0x" + h.toString(16)).join(", "));

// Dump the army record region in PRE (no siege block) — the "carthaginian
// general's cavalry early" record. In SIEGE it's near 0x4799b. In PRE the
// same string is at 0x4796b-ish (shifted -73-? ). Find the string in both.
function findStr(buf, s) {
  const a = []; let p = 0; const t = Buffer.from(s, "latin1");
  while ((p = buf.indexOf(t, p)) !== -1) { a.push(p); p++; }
  return a;
}
const sName = "carthaginian general's cavalry early";
const preStr = findStr(pre, sName);
const siStr  = findStr(siege, sName);
console.log(`\n"${sName}"`);
console.log("PRE  :", preStr.map(h => "0x" + h.toString(16)).join(", "));
console.log("SIEGE:", siStr.map(h => "0x" + h.toString(16)).join(", "));

// Align the two records on the string and diff backwards/forwards.
if (preStr.length && siStr.length) {
  const pBase = preStr[0], sBase = siStr[0];
  console.log(`\n=== record-aligned diff around army string (PRE@0x${pBase.toString(16)} vs SIEGE@0x${sBase.toString(16)}) ===`);
  let runs = [], cur = null;
  for (let dx = -260; dx < 200; dx++) {
    const a = pre[pBase + dx], b = siege[sBase + dx];
    if (a !== b) { if (cur && dx === cur.e + 1) cur.e = dx; else { cur = { s: dx, e: dx }; runs.push(cur); } }
  }
  for (const r of runs) {
    const len = r.e - r.s + 1;
    const pa = pre.slice(pBase + r.s, pBase + r.e + 1).toString("hex");
    const sb = siege.slice(sBase + r.s, sBase + r.e + 1).toString("hex");
    console.log(`  dx ${r.s}..${r.e} (len ${len})  PRE=[${pa}]  SIEGE=[${sb}]`);
  }
  console.log("\n--- PRE record (string-260 .. string+120) ---");
  console.log(hexAscii(pre, pBase - 260, 380));
  console.log("\n--- SIEGE record (string-260 .. string+120) ---");
  console.log(hexAscii(siege, sBase - 260, 380));
}

// u16@+66=529. Is 529 a meaningful count? 0d 00 00 00 64 00 00 00 64 at +86..
// Let me list the 16 bytes right after the 73-block tail in SIEGE.
console.log("\n=== bytes after the 73-block tail (0x4790b+73 = 0x47954) ===");
console.log(hexAscii(siege, 0x47954, 48));
