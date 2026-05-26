"use strict";
const fs = require("fs");
const D = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
// args: <saveKey> <startHex> <lenHex>
const KEYS = {
  T2: "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav",
  T3End: "save_Autosave   Spain   Turn 3 End.sav",
  T4Start: "save_Autosave   Spain   Turn 4 Start.sav",
  declare: "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav",
  besieged: "save_Autosave   Spain   Turn 4 besiged .sav",
  T4: "save_Autosave   Spain   Turn 4.sav",
  macedon: "save_macedon t0.sav",
  seleucid: "save_Seleucids t0.sav",
};
const buf = fs.readFileSync(D + KEYS[process.argv[2]]);
const start = parseInt(process.argv[3], 16);
const len = parseInt(process.argv[4] || "0x100", 16);
for (let r = 0; r < len; r += 16) {
  const o = start + r; const sl = buf.slice(o, o + 16);
  const hex = Array.from(sl).map(x => x.toString(16).padStart(2, "0")).join(" ");
  const asc = Array.from(sl).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : ".").join("");
  const u = []; for (let j = 0; j + 4 <= sl.length; j += 4) u.push(sl.readUInt32LE(j));
  console.log("0x" + o.toString(16) + "  " + hex + "  " + asc + "  [" + u.join(",") + "]");
}
