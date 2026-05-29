"use strict";
const fs = require("fs");
const path = require("path");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const SAVES = [
  { name: "T7  ", expected: 7,  file: "save_Julii turn7.sav" },
  { name: "T6E ", expected: 6,  file: "save_Autosave   Republic of Rome   Turn 6 End.sav" },
  { name: "T7S ", expected: 7,  file: "save_Autosave   Republic of Rome   Turn 7 Start.sav" },
  { name: "T1  ", expected: 1,  file: "save_Autosave   Republic of Rome   Turn 1.sav" },
  { name: "T20 ", expected: 20, file: "save_Autosave   Dummies   Turn 20 End.sav" },
];

for (const s of SAVES) {
  const p = path.join(SAVE_DIR, s.file);
  if (!fs.existsSync(p)) continue;
  const buf = fs.readFileSync(p);
  const records = xtras.parseFactionTreasuries(buf);
  // For each Type A record, walk back to find econ history start, count blocks
  const players = records.filter(r => r.knowledgeSize > 200).sort((a,b)=>a.offset-b.offset);
  if (!players.length) { console.log(`${s.name} no Type A`); continue; }
  const r = players[0];
  // Walk back from r.offset to find first u32 == its own offset (history header)
  let histStart = -1;
  for (let off = r.offset - 4; off >= r.offset - 100000 && off >= 0; off -= 4) {
    if (buf.readUInt32LE(off) === off) { histStart = off; break; }
  }
  if (histStart < 0) { console.log(`${s.name} no history`); continue; }
  const f = [];
  for (let o = histStart; o + 4 <= r.offset; o += 4) f.push(buf.readInt32LE(o));
  const body = f.slice(2, f.length - 1);
  const S = 23;
  const blocks = body.length / S;
  const series = [];
  if (body.length % S === 0) {
    for (let b = 0; b < blocks; b++) series.push(body[b * S + 13]);
  }
  console.log(`${s.name} expected=${s.expected}  histStart=${histStart}  bodyLen=${body.length} blocks=${blocks}  treasury_series=${JSON.stringify(series)}`);
}
