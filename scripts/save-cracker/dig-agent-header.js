// dig-agent-header.js — inspect header / mod path of the Spain saves
const fs = require("fs");
const { parseHeader, parseModInfo } = require("../../src/saveCrackerExtras.js");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const saves = [
  "save_17-05-2026   Spain   Turn 1 move spy.sav",
  "save_17-05-2026   Spain   Turn 1move diplomat and army.sav",
];
for (const name of saves) {
  const buf = fs.readFileSync(SAVE_DIR + name);
  const h = parseHeader(buf);
  const m = parseModInfo(buf);
  console.log(`\n=== ${name} ===`);
  console.log("header:", JSON.stringify(h));
  console.log("mod:", JSON.stringify(m));
}
