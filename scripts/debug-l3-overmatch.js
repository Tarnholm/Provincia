"use strict";
const fs = require("fs");
const xtras = require("../src/saveCrackerExtras.js");

const MACEDON = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
if (!fs.existsSync(MACEDON)) { console.log("no macedon T0 save"); process.exit(0); }
const buf = fs.readFileSync(MACEDON);

const records = xtras.parseFactionTreasuries(buf);
console.log(`total records: ${records.length}`);

// Group by what we know about each
const byKnowledge = {};
for (const r of records) {
  const bucket = r.knowledgeSize > 200 ? `TypeA(${r.knowledgeSize})` : `TypeB(${r.knowledgeSize})`;
  byKnowledge[bucket] = (byKnowledge[bucket] || 0) + 1;
}
console.log("by knowledgeSize:");
for (const [k, n] of Object.entries(byKnowledge).sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${k}: ${n}`);
}

// Print top 30 records (largest knowledge first)
console.log("\ntop 30 records by knowledge:");
records.sort((a,b) => b.knowledgeSize - a.knowledgeSize);
for (const r of records.slice(0, 30)) {
  console.log(`  off=${r.offset}  knowledge=${r.knowledgeSize}  treasury=${r.treasury}  fid=${r.factionId}`);
}

// Print smallest 30 (likely false positives or Type B baseline)
console.log("\nsmallest 30 records by knowledge:");
records.sort((a,b) => a.knowledgeSize - b.knowledgeSize);
for (const r of records.slice(0, 30)) {
  console.log(`  off=${r.offset}  knowledge=${r.knowledgeSize}  treasury=${r.treasury}  fid=${r.factionId}`);
}
