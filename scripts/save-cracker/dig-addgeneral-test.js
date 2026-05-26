// Test the add-general backend end-to-end against the real RIS data files.
const fs = require("fs");
const G = require("C:/dev/Provincia/src/descrStratGeneral.js");

const DS = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const NAMES = "C:/RIS/RIS/data/text/names.txt";
const LOOKUP = "C:/RIS/RIS/data/descr_names_lookup.txt";

const names = G.parseNamesTxt(fs.readFileSync(NAMES, "utf16le"));
const lookup = G.parseLookup(fs.readFileSync(LOOKUP, "utf8"));
const parsed = G.parseDescrStrat(fs.readFileSync(DS, "utf8"));
console.log(`names tokens=${names.tokenToDisplay.size} lookup tokens=${lookup.size} factions=${parsed.factions.length}`);

const fac = parsed.factions.find((f) => f.name === "romans_julii");
console.log(`\n${fac.name}: chars=${fac.characters.length} charRecs=${fac.characterRecords.length} relatives=${fac.relatives.length} generalUnit="${fac.generalUnit}" sampleLeaderXY=${fac.characters.find(c=>c.leader)?.x},${fac.characters.find(c=>c.leader)?.y}`);
const pools = G.buildPools(fac, names);
console.log(`pools: male=${pools.maleFirst.length} female=${pools.femaleFirst.length} families=${pools.families.length}`);
console.log(`  male sample: ${pools.maleFirst.slice(0, 8).join(", ")}`);
console.log(`  female sample: ${pools.femaleFirst.slice(0, 8).join(", ")}`);
console.log(`  families sample: ${pools.families.slice(0, 5).map(f => f.display).join(", ")}`);
console.log(`existing duplicates in faction: ${JSON.stringify(G.findDuplicateNames(fac))}`);

// Compose: a NEW family line "Gaius <NewSurname>" with wife + 1 son + 1 daughter.
const leader = fac.characters.find(c => c.leader);
const newSurname = pools.families[3].display; // reuse a valid culture surname for the new line
const sel = {
  factionName: "romans_julii", x: leader.x, y: leader.y,
  general: { firstDisplay: "Gaius", age: 32 },
  familyName: newSurname,           // new line (no familyToken => resolves a free surname token)
  wife: { firstDisplay: pools.femaleFirst[0], age: 28 },
  children: [
    { firstDisplay: "Marcus", gender: "son", age: 8 },
    { firstDisplay: pools.femaleFirst[1], gender: "daughter", age: 5 },
  ],
};
const res = G.composeAddGeneral(parsed, names, sel);
console.log(`\n=== composed add-general ===`);
console.log(JSON.stringify(res.summary, null, 1));
console.log(`namesAppend: ${JSON.stringify(res.namesAppend)}`);

// Show the inserted character block + family def (find by scanning the new lines near the faction)
const newText = res.lines.join("\n");
const idx = newText.indexOf(res.summary.relativeLine);
console.log(`\n--- relative line: ${res.summary.relativeLine}`);

// ROUND-TRIP: re-parse the edited text; the faction must now have +1 character,
// the new general must be present with a unique full key, and no new duplicates.
const reparsed = G.parseDescrStrat(newText);
const rf = reparsed.factions.find((f) => f.name === "romans_julii");
console.log(`\n=== round-trip ===`);
console.log(`chars ${fac.characters.length} -> ${rf.characters.length} (+${rf.characters.length - fac.characters.length})`);
const dupAfter = G.findDuplicateNames(rf);
console.log(`duplicates after add: ${dupAfter.length === 0 ? "NONE ✓" : JSON.stringify(dupAfter)}`);
// every token used in the new character must be valid (in lookup OR minted)
const minted = new Set(res.lookupAppend);
const genChar = rf.characters.find(c => c.line >= fac.firstCharLine && c.firstTok && c.famTok && !fac.characters.some(o => o.line === c.line && o.firstTok === c.firstTok));
const checkTok = (t) => lookup.has(t) || minted.has(t) || names.tokenToDisplay.has(t);
const allNewToks = [genChar?.firstTok, genChar?.famTok].filter(Boolean);
console.log(`new general tokens valid: ${allNewToks.every(checkTok) ? "YES ✓" : "NO ✗"} (${allNewToks.join(", ")})`);
console.log(`mints to add: names.txt += ${res.namesAppend.map(n=>`{${n.token}}${n.display}`).join(", ")||"(none)"}; lookup += ${res.lookupAppend.join(", ")||"(none)"}`);
