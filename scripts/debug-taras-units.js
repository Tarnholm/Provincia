// What does currentOwnerByCity look like? And does Tarentum show up?
const fs = require("fs");
const path = require("path");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const { resolveCurrentOwners } = require("../src/saveOwnershipParser.js");

const buf = fs.readFileSync(SAVE);

// Need modInitialOwnerByCity. Build a minimal stub from descr_strat by reading the bundled JSON
const bundled = JSON.parse(fs.readFileSync("C:/dev/Provincia/public/starting_armies_large.json", "utf8"));
// Actually resolveCurrentOwners takes a different shape. Let me find what.
const own = resolveCurrentOwners(buf, {});
console.log("error:", own.error);
console.log("detected offset:", own.detectedOffset);
console.log("owners total:", Object.keys(own.ownerByCity).length);
const tarKey = Object.keys(own.ownerByCity).find(k => /tarent|taras/i.test(k));
console.log("Tarentum-ish:", tarKey, "→", own.ownerByCity[tarKey]);
// Show first 20
console.log("\nFirst 20:");
let i = 0;
for (const [k,v] of Object.entries(own.ownerByCity)) { if (i++ >= 20) break; console.log("  ",k,"→",v); }
