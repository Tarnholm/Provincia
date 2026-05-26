// Verify what (firstName, lastName, faction) v1 produces for Antigonos
// vs what the renderer's mapToChar would use for the same character.
const fs = require("fs");
const { findCharacterRecords } = require("C:/dev/Provincia/src/characterParser.js");

const buf = fs.readFileSync("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav");
const nameLookup = fs.readFileSync("C:/RIS/RIS/data/descr_names_lookup.txt", "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = ["__nontrait__"];
for (const line of fs.readFileSync("C:/RIS/RIS/data/export_descr_character_traits.txt", "utf8").split(/\r?\n/)) {
  const m = line.match(/^Trait\s+(\S+)/);
  if (m) traitNames.push(m[1]);
}

const v1 = findCharacterRecords(buf, nameLookup, traitNames, null);
const antigonos = v1.find(c => /antigonos/i.test(c.firstName));
console.log(`v1 Antigonos: firstName=${JSON.stringify(antigonos.firstName)} lastName=${JSON.stringify(antigonos.lastName)} faction=${JSON.stringify(antigonos.faction)} cmd=${antigonos.command} inf=${antigonos.influence} mgmt=${antigonos.management}`);
const writeKey = `${antigonos.firstName || ""}|${(antigonos.lastName || "").replace(/_/g, " ")}|${antigonos.faction || ""}`.toLowerCase();
console.log(`WRITE key: "${writeKey}"`);
// Renderer side: descr_strat-derived `g` would have g.firstName="AntigonosB", g.faction="macedon"
const readKey = `AntigonosB|${"".replace(/_/g, " ")}|macedon`.toLowerCase();
console.log(`READ  key: "${readKey}"`);
console.log(`MATCH? ${writeKey === readKey}`);
