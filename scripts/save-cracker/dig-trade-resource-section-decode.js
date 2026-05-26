// dig-trade-resource-section-decode.js
// Decode the RESOURCE-family sections. The registry order = serialization order
// of section TYPE BLOCKS in the body. Each type block in the body is itself a
// taw section: [u32 self][u32 size][... count records ...]. We locate the type
// blocks by walking the body and matching the EXPECTED record COUNT from the
// registry against the count field inside each block.
//
// Goal: prove RESOURCE/RESOURCE_HEADER hold resource TYPE DEFINITIONS (global,
// ~20-40 entries) and NOT per-region (375) resource lists.
"use strict";
const fs = require("fs");
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const buf = fs.readFileSync(SAVE);

// Read registry
function readRegistry() {
  for (let s = 0x100; s < 0x10000; s++) {
    let p = s, out = [];
    let first = true, ok = true;
    for (let i = 0; i < 130; i++) {
      if (p + 5 > buf.length) { ok = false; break; }
      const count = buf.readUInt32LE(p);
      let q = p + 4, str = "";
      while (q < buf.length && buf[q] >= 0x20 && buf[q] < 0x7f) { str += String.fromCharCode(buf[q]); q++; }
      if (buf[q] !== 0) break;
      if (!/^[A-Z][A-Z_0-9]*$/.test(str)) break;
      out.push({ id: out.length, count, name: str }); p = q + 1;
    }
    if (out.length > 80) return { start: s, types: out, end: p };
  }
  return null;
}
const reg = readRegistry();
console.log("registry @0x" + reg.start.toString(16), "->0x" + reg.end.toString(16), "types", reg.types.length);
const want = ["RESOURCE", "RESOURCE_HEADER", "RESOURCE_ID", "RESOURCE_MANAGER", "MAP_REGIONS", "ECONOMICS_DATA", "HOLD_REGIONS"];
for (const w of want) {
  const t = reg.types.find(x => x.name === w);
  console.log(`  ${w}: id=${t ? t.id : "?"} count=${t ? t.count : "?"}`);
}

// The campaign-name pstr16 follows the registry. The body root after that.
// Find first ASCII "campaign" pstr to anchor body start.
const campIdx = buf.indexOf(Buffer.from("campaign/", "ascii"), reg.end);
console.log("campaign pstr near body @0x" + (campIdx >= 0 ? campIdx.toString(16) : "?"));

// Walk all self-pointer sections in the whole file, group by interior count.
// For a resource type-definition block we expect a section whose payload begins
// with a u32 count matching the registry count (20 / 6 / 2 / 3).
const sections = [];
for (let p = reg.end; p + 8 <= buf.length; p += 4) {
  if (buf.readUInt32LE(p) !== p) continue;
  const sz = buf.readUInt32LE(p + 4);
  if (sz < 16 || p + sz > buf.length) continue;
  sections.push({ off: p, size: sz });
}
console.log("self-ptr sections total:", sections.length);

// For each interesting registry count, find sections whose payload[0] == count
function findByPayloadCount(c) {
  return sections.filter(s => {
    const v0 = buf.readUInt32LE(s.off + 8);
    const v1 = s.size >= 16 ? buf.readUInt32LE(s.off + 12) : -1;
    return v0 === c || v1 === c;
  });
}
for (const c of [6, 20, 2, 3]) {
  const hits = findByPayloadCount(c);
  console.log(`sections with payload count==${c}:`, hits.length, hits.slice(0, 5).map(h => "0x" + h.off.toString(16)).join(" "));
}

// Search ASCII for resource type names INSIDE the body (if RESOURCE_HEADER stores
// names). Use the RIS resource type list.
const RES = ["gold","silver","pottery","horses","grain","timber","iron","olive_oil","wine","slaves","glass","marble","textiles","purple_dye","incense","silk","wild_animals","hides","tin","copper","lead","amber","elephants","camels","fish","salt","dyes","fruits","perfumes","livestock","pitch","honey","slave_trade","sulphur","stone","flax","hemp","papyrus","spices","coal","gemstones","cotton","dates"];
let nameHits = 0; const found = [];
for (const r of RES) {
  const idx = buf.indexOf(Buffer.from(r + "\0", "ascii"), reg.end);
  if (idx >= 0) { nameHits++; found.push(r + "@0x" + idx.toString(16)); }
}
console.log(`\nresource type-name ASCII strings present in body: ${nameHits}/${RES.length}`);
console.log(found.slice(0, 20).join(" "));
