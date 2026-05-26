// dig-siege-spain-smartdiff.js
// The Spain SIEGE save inserted 4 bytes before Corduba (and more elsewhere), so
// almost every "diff" is a pointer/UUID re-salt. Filter those out:
//   - A u32 that equals PRE_val + delta (delta = local insertion size) is a
//     shifted self-pointer -> NOISE.
//   - Per-record UUIDs re-roll every save (salted by session) -> NOISE. We
//     detect these because they sit right before the constant session stamp.
// Report only REAL value changes (counters, flags, enums) near:
//   (a) Corduba settlement record (stats block name-600..name+400)
//   (b) The +73 block host army record.
// Also: scan the WHOLE file for new/removed small structures by comparing
// histograms is overkill; instead, anchor on the besieging army.

const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const pre   = fs.readFileSync(DIR + "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav");
const siege = fs.readFileSync(DIR + "save_Autosave   Spain   Turn 4 besiged corduba.sav");

function hexAscii(b, off, n) {
  const lines = [];
  for (let r = 0; r < n; r += 16) {
    const row = []; let asc = "";
    for (let i = 0; i < 16 && r + i < n; i++) {
      const x = b[off + r + i]; row.push(x.toString(16).padStart(2, "0"));
      asc += (x >= 32 && x < 127) ? String.fromCharCode(x) : ".";
    }
    lines.push(`  0x${(off + r).toString(16)}: ${row.join(" ").padEnd(48)}  ${asc}`);
  }
  return lines.join("\n");
}

// Corduba name pos (flag at 0x242cc/0x242d0; name UTF16 starts +3)
const corPreName = 0x242cc + 3, corSiName = 0x242d0 + 3;

// Classify u32 diffs in a window. window dx relative to name pos.
function classify(preBase, siBase, fromDx, toDx, label) {
  console.log(`\n=== ${label}  (PRE@0x${preBase.toString(16)} SIEGE@0x${siBase.toString(16)}) ===`);
  const interesting = [];
  for (let dx = fromDx; dx <= toDx; dx += 1) {
    const a = pre.readUInt8(preBase + dx);
    const b = siege.readUInt8(siBase + dx);
    if (a === b) continue;
    // Read aligned u32 at this dx (if room)
    let tag = "byte";
    let detail = `${a} -> ${b}`;
    if (preBase + dx + 4 <= pre.length && siBase + dx + 4 <= siege.length) {
      const ua = pre.readUInt32LE(preBase + dx);
      const ub = siege.readUInt32LE(siBase + dx);
      const d = (ub - ua) | 0;
      if (d === 4 || d === -4 || d === 73 || d === -73 || d === 6574 || d === 6501) tag = `ptr(+${d})`;
      detail = `u32 ${ua} -> ${ub} (Δ${ub - ua})`;
    }
    interesting.push({ dx, tag, a, b, detail });
  }
  // Coalesce single-byte runs that look like the +4 ptr shifts (every ~73 bytes one byte ticks)
  // Just print non-ptr ones grouped.
  const real = interesting.filter(x => x.tag !== "ptr(+4)" && x.tag !== "ptr(-4)" && x.tag !== "ptr(+73)" && x.tag !== "ptr(-73)");
  console.log(`  total differing bytes: ${interesting.length}; non-ptr-shift candidates: ${real.length}`);
  // Print byte-diffs where the byte change is SMALL (likely a counter/enum), dedup adjacent
  let last = -99;
  for (const x of interesting) {
    if (Math.abs(x.b - x.a) <= 8 && x.dx - last > 1) {
      console.log(`  dx=${x.dx}: ${x.detail}   [${x.tag}]`);
    }
    last = x.dx;
  }
}

// Corduba stats block + after-name
classify(corPreName, corSiName, -600, -1, "Corduba stats block (before name)");
classify(corPreName, corSiName, 0, 60, "Corduba name + immediate after");

// Dump the Corduba stats block raw in both for eyeballing
console.log("\n=== Corduba stats block raw, PRE (name-120..name+20) ===");
console.log(hexAscii(pre, corPreName - 120, 160));
console.log("\n=== Corduba stats block raw, SIEGE (name-120..name+20) ===");
console.log(hexAscii(siege, corSiName - 120, 160));
