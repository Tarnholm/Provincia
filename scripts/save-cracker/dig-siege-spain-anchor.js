// dig-siege-spain-anchor.js
// Deep dive on the single +73 siege block (0x4790b) and the Corduba settlement
// record. Goal: anchor the besieger/turns/equipment fields.

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

// ---- 1. context around the +73 block at 0x4790b in SIEGE ----
console.log("=== SIEGE: 0x100 before .. block .. 0x100 after (0x4790b) ===");
console.log(hexAscii(siege, 0x4790b - 0x100, 0x100 + 73 + 0x100));

// What's at the same byte-region in PRE? Since the block is an INSERTION, the
// PRE bytes after the common point shift. Find the common prefix up to here.
console.log("\n=== PRE: same absolute offset region for comparison ===");
console.log(hexAscii(pre, 0x4790b - 0x100, 0x100 + 73 + 0x100));

// ---- 2. The block's three u32 'uuid' components ----
const off = 0x4790b;
console.log("\n=== block field breakdown @0x4790b ===");
console.log("  +0  u8 flag       =", siege[off]);
console.log("  +1  u32           =", siege.readUInt32LE(off + 1), "(0x" + siege.readUInt32LE(off + 1).toString(16) + ")");
console.log("  +5  u32           =", siege.readUInt32LE(off + 5), "(0x" + siege.readUInt32LE(off + 5).toString(16) + ")");
console.log("  +9  u32           =", siege.readUInt32LE(off + 9), "(0x" + siege.readUInt32LE(off + 9).toString(16) + ")");
console.log("  +66 u16           =", siege.readUInt16LE(off + 66));
console.log("  +66 as 2x u8      =", siege[off + 66], siege[off + 67]);

// ---- 3. Where do the three u32s appear ELSEWHERE in SIEGE? (uuid links) ----
function findU32(buf, v, maxHits = 30) {
  const t = Buffer.alloc(4); t.writeUInt32LE(v >>> 0);
  const a = []; let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1 && a.length < maxHits) { a.push(p); p++; }
  return a;
}
for (const [name, v] of [["u32@+1", siege.readUInt32LE(off + 1)], ["u32@+5", siege.readUInt32LE(off + 5)], ["u32@+9", siege.readUInt32LE(off + 9)]]) {
  const hits = findU32(siege, v);
  console.log(`\n${name} = 0x${v.toString(16)} appears ${hits.length} times:`, hits.map(h => "0x" + h.toString(16)).join(", "));
}

// ---- 4. Corduba settlement record diff (PRE vs SIEGE) ----
// Corduba marker: PRE 0x242cc, SIEGE 0x242d0 (only +4 shift before it).
// Diff a wide window around Corduba; report runs of differing bytes.
const corPre = 0x242cc, corSi = 0x242d0;
const shift = corSi - corPre; // 4
console.log(`\n=== Corduba record diff (PRE@0x${corPre.toString(16)} vs SIEGE@0x${corSi.toString(16)}, shift=${shift}) ===`);
// The settlement RECORD for Corduba is the chain-data BETWEEN previous marker
// and Corduba's marker (buildingParser model). But siege flags on a settlement
// usually sit in the settlement's own stats block AFTER the name. Scan both
// directions: name-256 .. name+2000, comparing PRE[x] vs SIEGE[x+shift].
let runs = [];
let cur = null;
for (let dx = -256; dx < 3000; dx++) {
  const a = pre[corPre + dx];
  const b = siege[corSi + dx];
  if (a !== b) {
    if (cur && dx === cur.endDx + 1) cur.endDx = dx;
    else { cur = { startDx: dx, endDx: dx }; runs.push(cur); }
  }
}
console.log(`differing runs in Corduba window (PRE vs SIEGE+shift): ${runs.length}`);
for (const r of runs.slice(0, 40)) {
  const len = r.endDx - r.startDx + 1;
  const pa = pre.slice(corPre + r.startDx, corPre + r.endDx + 1).toString("hex");
  const sb = siege.slice(corSi + r.startDx, corSi + r.endDx + 1).toString("hex");
  console.log(`  dx ${r.startDx}..${r.endDx} (len ${len})  PRE=[${pa}]  SIEGE=[${sb}]`);
}
