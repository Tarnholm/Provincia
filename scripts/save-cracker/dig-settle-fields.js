// dig-settle-fields.js — read curated u32 fields across N saves (uses shared lib)
// Usage: node dig-settle-fields.js <name> "<saveA>" "<saveB>" ...
"use strict";
const { loadSave, findStatsBlock } = require("./dig-settle-lib");

const name = process.argv[2];
const saveArgs = process.argv.slice(3);
const FIELDS = [-583, -571, -562, -540, -536, -535, -534, -532, -528, -524,
  -520, -516, -512, -508, -504, -500, -496, -448, -447, -444, -440, -436, -435,
  -432, -316, -315, -312, -311, -227, -224, -223, -135, -131, -127, -123, -116,
  -115, -95, -84, -83, -80, -79, -68, -64, -63, -52, -48, -47, -36, -35, -32];

const blocks = saveArgs.map(s => { const buf = loadSave(s); return { label: s.replace(/^.*save_/, "").replace(/\.sav$/, "").slice(0, 22), buf, sb: findStatsBlock(buf, name) }; });

console.log(`=== ${name} u32 fields across saves ===`);
for (const blk of blocks) {
  if (!blk.sb) { console.log(`  [${blk.label}] NOT FOUND`); continue; }
  console.log(`  [${blk.label}] np=${blk.sb.namePos} score=${blk.sb.score} creator=${blk.sb.creator} lvl=${blk.sb.level} tax=${blk.sb.tax} PO=${blk.sb.po} income=${blk.sb.income} pop=${blk.sb.pop}`);
}
console.log("\ndx\t" + blocks.map((_, i) => "s" + i).join("\t"));
for (const dx of FIELDS) {
  const vals = blocks.map(blk => blk.sb ? blk.buf.readUInt32LE(blk.sb.namePos + dx) : "x");
  console.log(`${dx}\t${vals.join("\t")}`);
}
