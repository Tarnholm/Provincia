const fs = require("fs");
const { parseFactionTreasuries, identifyPlayerFactionFromSave } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const treas = parseFactionTreasuries(buf);
console.log("major-faction records:", treas.length);
const player = identifyPlayerFactionFromSave(buf, treas);
console.log("identified player faction from save:", player);
