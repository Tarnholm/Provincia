// dig-siege-spain-newrecords.js
// Find what is STRUCTURALLY NEW in the SIEGE save vs PRE, ignoring re-salted
// UUIDs/pointers. Strategy: sliding-window content fingerprint.
//   - Tokenize each file into records is hard; instead, take every 8-byte
//     window that is "structured" (not the session stamp, not 0xff/0x00 runs)
//     and see which 16-byte sequences in SIEGE never appear ANYWHERE in PRE.
//   - Specifically hunt for siege-equipment chain names and order strings.
// Also: the +73 block's three u32s -> trace each across BOTH files to identify
//   which is besieger-army, which is settlement, which is the salted self-id.

const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const pre   = fs.readFileSync(DIR + "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav");
const siege = fs.readFileSync(DIR + "save_Autosave   Spain   Turn 4 besiged corduba.sav");

// 1) ASCII tokens (chain/order names) present in SIEGE but not PRE.
function asciiTokens(buf) {
  const set = new Map();
  let cur = "", start = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if ((b >= 0x61 && b <= 0x7a) || b === 0x5f || (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a)) {
      if (cur === "") start = i; cur += String.fromCharCode(b);
    } else {
      if (cur.length >= 5) set.set(cur, (set.get(cur) || 0) + 1);
      cur = "";
    }
  }
  return set;
}
const preTok = asciiTokens(pre), siTok = asciiTokens(siege);
const newToks = [];
for (const [t, c] of siTok) {
  const pc = preTok.get(t) || 0;
  if (c > pc) newToks.push([t, pc, c]);
}
newToks.sort((a, b) => (b[2] - b[1]) - (a[2] - a[1]));
console.log("=== ASCII tokens more frequent / new in SIEGE (top 40) ===");
for (const [t, pc, c] of newToks.slice(0, 40)) {
  if (/siege|sap|ram|ladder|tower|assault|besieg|surrender|starv|order|attack|defend|garrison/i.test(t) || c - pc >= 1)
    console.log(`  "${t}"  PRE=${pc} SIEGE=${c}`);
}

// 2) +73 block u32s
const off = 0x4790b;
const u1 = siege.readUInt32LE(off + 1), u5 = siege.readUInt32LE(off + 5), u9 = siege.readUInt32LE(off + 9);
function count(buf, v) { const t = Buffer.alloc(4); t.writeUInt32LE(v >>> 0); let p = 0, c = 0; const at = []; while ((p = buf.indexOf(t, p)) !== -1) { c++; if (at.length < 12) at.push(p); p++; } return { c, at }; }
console.log("\n=== +73 block u32 trace ===");
for (const [n, v] of [["u32@+1", u1], ["u32@+5", u5], ["u32@+9", u9]]) {
  const cp = count(pre, v), cs = count(siege, v);
  console.log(`  ${n}=0x${v.toString(16)}  PRE count=${cp.c}  SIEGE count=${cs.c}`);
  console.log(`     SIEGE at: ${cs.at.map(h => "0x" + h.toString(16)).join(", ")}`);
}

// 3) The siege block had u16@+66=529 and after-tail '0d 00 00 00 64 00 00 00 64'.
//    Dump +66..+120 to look for besieger faction id / turn counter.
function hexAscii(b, o, n) {
  const out = [];
  for (let r = 0; r < n; r += 16) {
    const row = []; let asc = "";
    for (let i = 0; i < 16 && r + i < n; i++) { const x = b[o + r + i]; row.push(x.toString(16).padStart(2, "0")); asc += (x >= 32 && x < 127) ? String.fromCharCode(x) : "."; }
    out.push(`  0x${(o + r).toString(16)}: ${row.join(" ").padEnd(48)}  ${asc}`);
  }
  return out.join("\n");
}
console.log("\n=== siege block full (0x4790b .. +160) ===");
console.log(hexAscii(siege, off, 160));
