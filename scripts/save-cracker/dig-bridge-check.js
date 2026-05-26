// Verify whether v1.secondaryUuid matches cracker.bodyguardUuid for the
// same character. The cracker reads bgUuid at idx + roleLen + 5 after the
// role string.
const fs = require("fs");
const path = require("path");
const savePath = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traits = [];
for (const m of fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8").matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traits.push(m[1]);
const { findCharacterRecords } = require("../../src/characterParser.js");
const sce = require("../../src/saveCrackerExtras.js");
const buf = fs.readFileSync(savePath);
const v1Records = findCharacterRecords(buf, names, traits, null);
const crackerChars = sce.parseCharacterExtras(buf);

// Collect bgUuids from cracker
const bgSet = new Set();
for (const c of crackerChars) if (c.bodyguardUuid) bgSet.add(c.bodyguardUuid);
console.log(`cracker bodyguardUuids: ${bgSet.size}`);

const secSet = new Set();
for (const v of v1Records) if (v.secondaryUuid && v.secondaryUuid !== 0xffffffff) secSet.add(v.secondaryUuid);
console.log(`v1 secondaryUuids: ${secSet.size}`);

let inter = 0;
for (const s of secSet) if (bgSet.has(s)) inter++;
console.log(`Intersection: ${inter}`);

// Sample to see actual values
const v1Sample = v1Records.filter(c => c.firstName === "AntigonosB" || c.firstName === "DemetriosC" || c.firstName === "Halkyoneus");
const ccSample = crackerChars.slice(0, 5);
console.log("\nv1 samples:");
for (const v of v1Sample) console.log(`  ${v.firstName}: secondaryUuid=${v.secondaryUuid} (0x${v.secondaryUuid?.toString(16)})`);
console.log("\nCracker samples:");
for (const c of ccSample) console.log(`  role=${c.role} region=${c.region}: ownUuid=${c.ownUuid} (0x${c.ownUuid?.toString(16)}), bgUuid=${c.bodyguardUuid} (0x${c.bodyguardUuid?.toString(16)})`);
