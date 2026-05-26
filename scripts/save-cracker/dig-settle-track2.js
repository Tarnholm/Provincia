// dig-settle-track2.js
//
// Track a settlement's 583-block across MANY saves (turn sequence). For each
// dx in the block, print the value at each save so we can see which fields move
// monotonically with growth (pop, income, growth-counter), which toggle (tax),
// and which are static (creator, level, UUID).
//
// Only prints dx rows where the value CHANGES across at least one save pair,
// to keep output focused. Reads u8, u16, u32 per dx.
//
// Usage: node dig-settle-track2.js <settlementName> "saveA" "saveB" ...

"use strict";
const { loadSave, findStatsBlock } = require("./dig-settle-lib.js");

const name = process.argv[2];
const saves = process.argv.slice(3);
const blocks = saves.map((s) => {
  const buf = loadSave(s);
  const sb = findStatsBlock(buf, name);
  return { label: s.replace(/save_|\.sav/g, "").slice(0, 28), buf, sb };
});

const valid = blocks.filter((b) => b.sb);
if (valid.length < 2) { console.log("need >=2 valid blocks; got", valid.length); process.exit(1); }

console.log(`=== ${name} ===`);
for (const b of blocks) {
  if (b.sb) console.log(`  ${b.label}: namePos=0x${b.sb.namePos.toString(16)} creator=${b.sb.creator} lvl=${b.sb.level} tax=${b.sb.tax} PO=${b.sb.po} inc=${b.sb.income} pop=${b.sb.pop}`);
  else console.log(`  ${b.label}: <no block>`);
}

// For each dx, gather u32 across saves; print if it varies.
console.log("\ndx\t" + valid.map((b) => b.label.slice(0, 14)).join("\t") + "\t(type)");
for (let dx = -584; dx <= -1; dx++) {
  const u32s = valid.map((b) => {
    const o = b.sb.namePos + dx;
    return (o >= 0 && o + 4 <= b.buf.length) ? b.buf.readUInt32LE(o) : null;
  });
  const u8s = valid.map((b) => {
    const o = b.sb.namePos + dx;
    return (o >= 0 && o < b.buf.length) ? b.buf[o] : null;
  });
  const varies32 = new Set(u32s).size > 1;
  const varies8 = new Set(u8s).size > 1;
  if (!varies32 && !varies8) continue;
  // Decide whether to show as u8 or u32 (if u32 monotonic-ish and large show u32)
  console.log(`${dx}\t` + u32s.join("\t") + `\t[u8: ${u8s.join(",")}]`);
}
