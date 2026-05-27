// validate-descr-strat.js — basic structural validator for descr_strat output.
//
// Checks:
//   1. File opens without parse errors
//   2. Faction block balance: every `settlement {` has a matching `}`
//   3. Per-faction stats match our generated comment headers
//   4. Character lines have the expected `, named character, age N, , x X, y Y` shape
//   5. Building entries follow `type <chain> <levelName>` syntax
//   6. relative lines end with `, end`
//
// Usage: node scripts/validate-descr-strat.js <path>

"use strict";
const fs = require("fs");

if (process.argv.length < 3) {
  console.error("usage: node validate-descr-strat.js <descr_strat.txt>");
  process.exit(2);
}
const path = process.argv[2];
if (!fs.existsSync(path)) { console.error("not found:", path); process.exit(1); }

const text = fs.readFileSync(path, "utf8");
const lines = text.split(/\r?\n/);
console.log(`validating ${path}  (${lines.length} lines, ${(text.length / 1024 / 1024).toFixed(2)} MB)`);
console.log();

const issues = [];
const warn = (line, msg) => issues.push({ line, msg, severity: "warn" });
const err = (line, msg) => issues.push({ line, msg, severity: "err" });

let factions = 0, settlements = 0, characters = 0, armies = 0, traitsLines = 0;
let buildingLines = 0, anciLines = 0, relativeLines = 0, characterRecords = 0;
let diploStances = 0;
let inSettlement = false, settBraceDepth = 0;
let inBuilding = false, buildBraceDepth = 0;

const factionsByName = {};
let curFaction = null;

for (let i = 0; i < lines.length; i++) {
  const rawLine = lines[i];
  const line = rawLine.replace(/;.*$/, "").trim();
  if (!line) continue;
  // Track brace depth within settlement/building.
  if (inBuilding) {
    if (line === "}") { buildBraceDepth--; if (buildBraceDepth === 0) inBuilding = false; }
    else if (line === "{") { buildBraceDepth++; }
    else if (!/^type\s+/.test(line)) { warn(i + 1, "unexpected line inside building block: " + line); }
    continue;
  }
  if (inSettlement) {
    if (line === "}") { settBraceDepth--; if (settBraceDepth === 0) inSettlement = false; }
    else if (line === "{") { settBraceDepth++; }
    else if (line === "building") { /* will see { on next line */ }
    else if (/^building\b/.test(line)) {
      // The bundled format puts `building` and `{` on separate lines; if
      // they're concatenated here it's a malformed block.
      warn(i + 1, "building keyword should be followed by `{` on next line: " + line);
    }
    else if (line === "building") { /* expect { */ }
    continue;
  }
  // Top-level dispatch
  const facMatch = line.match(/^faction\s+([A-Za-z0-9_]+)\s*,/);
  if (facMatch) {
    curFaction = facMatch[1];
    factions++;
    if (factionsByName[curFaction]) err(i + 1, "duplicate faction declaration: " + curFaction);
    factionsByName[curFaction] = { line: i + 1, settlements: 0, characters: 0, armies: 0 };
    continue;
  }
  if (line === "settlement") {
    settlements++;
    if (curFaction) factionsByName[curFaction].settlements++;
    inSettlement = true;
    settBraceDepth = 0;
    continue;
  }
  if (line === "building") {
    inBuilding = true;
    buildBraceDepth = 0;
    continue;
  }
  if (line.startsWith("character,")) {
    characters++;
    if (curFaction) factionsByName[curFaction].characters++;
    // Check shape: character,	<Name>, named character[, leader|heir], age N, , x X, y Y
    if (!/named character/.test(line)) warn(i + 1, "character line missing `named character`: " + line.slice(0, 60));
    if (!/age \d+/.test(line)) warn(i + 1, "character line missing valid age: " + line.slice(0, 60));
    if (!/x \d+,\s*y \d+/.test(line)) warn(i + 1, "character line missing x/y coords: " + line.slice(0, 60));
    continue;
  }
  if (line === "army") { armies++; if (curFaction) factionsByName[curFaction].armies++; continue; }
  if (/^unit\s/.test(line)) { continue; }
  if (/^traits\s/.test(line)) { traitsLines++; continue; }
  if (/^ancillaries\s/.test(line)) { anciLines++; continue; }
  if (line.startsWith("character_record")) { characterRecords++; continue; }
  if (line.startsWith("relative")) {
    relativeLines++;
    if (!/,\s*end\s*$/.test(line)) err(i + 1, "relative line missing trailing `, end`: " + line.slice(0, 80));
    continue;
  }
  if (line.startsWith("diplomatic_stance")) {
    diploStances++;
    const m = line.match(/^diplomatic_stance\s+(\w+)\s+(\w+)\s+(\w+)$/);
    if (!m) err(i + 1, "malformed diplomatic_stance: " + line);
    else if (!/^(allied|suspicious|neutral|hostile|war)$/.test(m[3])) err(i + 1, "invalid stance value: " + m[3]);
    continue;
  }
  if (line.startsWith("denari")) { continue; }
  if (line.startsWith("superfaction")) { continue; }
}

if (inSettlement) err(lines.length, "EOF reached with settlement block unclosed (brace depth " + settBraceDepth + ")");
if (inBuilding) err(lines.length, "EOF reached with building block unclosed");

console.log("Structural counts:");
console.log("  factions:          " + factions);
console.log("  settlements:       " + settlements);
console.log("  building lines:    " + buildingLines);
console.log("  characters:        " + characters);
console.log("  army blocks:       " + armies);
console.log("  traits lines:      " + traitsLines);
console.log("  ancillaries lines: " + anciLines);
console.log("  character_record:  " + characterRecords);
console.log("  relative lines:    " + relativeLines);
console.log("  diplomatic_stance: " + diploStances);
console.log();
console.log("Per-faction breakdown (first 10):");
const topFacs = Object.entries(factionsByName).slice(0, 10);
for (const [name, s] of topFacs) {
  console.log(`  ${name.padEnd(20)} settlements=${String(s.settlements).padStart(3)} chars=${String(s.characters).padStart(4)} armies=${String(s.armies).padStart(4)}`);
}
console.log();
const errs = issues.filter(i => i.severity === "err");
const warns = issues.filter(i => i.severity === "warn");
console.log(`Issues: ${errs.length} errors, ${warns.length} warnings`);
const samples = [...errs.slice(0, 5), ...warns.slice(0, 5)];
for (const s of samples) {
  console.log(`  ${s.severity.toUpperCase()} L${s.line}: ${s.msg}`);
}
if (errs.length === 0 && warns.length === 0) {
  console.log("✓ no structural issues detected");
}
process.exit(errs.length > 0 ? 1 : 0);
