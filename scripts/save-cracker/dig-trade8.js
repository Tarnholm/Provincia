// dig-trade8.js — find the "road" string that appeared in rome7's Uria region
// and the new "land" hit. These are likely building/feature strings that
// record completed infrastructure.
//
// Also look at the +500..+700 area where the most diffs cluster.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const a = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const b = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));

function findSettlementByName(buf, name) {
  const nameU16 = Buffer.alloc(name.length * 2);
  for (let i = 0; i < name.length; i++) nameU16.writeUInt16LE(name.charCodeAt(i), i * 2);
  let p = 0;
  while ((p = buf.indexOf(nameU16, p)) !== -1) {
    if (p >= 3) {
      const marker = buf.readUInt8(p - 3);
      const len = buf.readUInt16LE(p - 2);
      if (marker === 0x01 && len === name.length) return p;
    }
    p += 1;
  }
  return -1;
}

const uA = findSettlementByName(a, "Uria");
const uB = findSettlementByName(b, "Uria");

// Find "road" near Uria in rome7
function showHits(buf, anchor, label, tokens, range) {
  console.log(`\n## ${label}: anchor=0x${anchor.toString(16)}, range ±${range}`);
  for (const tok of tokens) {
    const tokB = Buffer.from(tok);
    let p = Math.max(0, anchor - range);
    const hits = [];
    while ((p = buf.indexOf(tokB, p)) !== -1 && p < anchor + range) {
      hits.push(p);
      p += 1;
    }
    if (hits.length > 0) {
      console.log(`  '${tok}' (${hits.length} hits):`);
      for (const h of hits) {
        const rel = h - anchor;
        const start = Math.max(0, h - 10);
        const end = Math.min(buf.length, h + 30);
        const ctx = buf.slice(start, end).toString("latin1").replace(/[^\x20-\x7e]/g, ".");
        console.log(`    +${rel.toString().padStart(5)}: ${ctx}`);
      }
    }
  }
}

showHits(a, uA, "Uria rome6", ["road", "land", "trade", "route", "port", "sea"], 3000);
showHits(b, uB, "Uria rome7", ["road", "land", "trade", "route", "port", "sea"], 3000);

// The +500..+699 diff cluster (138 diffs!): show some.
function showRange(buf, label, anchor, start, end) {
  console.log(`\n## ${label}: anchor=0x${anchor.toString(16)}, rel [${start}..${end}]`);
  const slice = buf.slice(anchor + start, anchor + end);
  const hex = slice.toString("hex").match(/.{1,2}/g);
  for (let i = 0; i < hex.length; i += 16) {
    const rel = start + i;
    const hexstr = hex.slice(i, i + 16).join(" ");
    const ascii = Array.from(slice.slice(i, i + 16)).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
    console.log(`  +${rel.toString().padStart(5)}: ${hexstr.padEnd(48)}  ${ascii}`);
  }
}

showRange(a, "Uria rome6 +500..+700", uA, 500, 700);
showRange(b, "Uria rome7 +500..+700", uB, 500, 700);
