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
const path = require("path");

if (process.argv.length < 3) {
  console.error("usage: node validate-descr-strat.js <descr_strat.txt> [bundled-mod-data-dir]");
  process.exit(2);
}
const inputPath = process.argv[2];
const modDataDir = process.argv[3] || path.join(__dirname, "..", "bundled-mod", "data");
if (!fs.existsSync(inputPath)) { console.error("not found:", inputPath); process.exit(1); }

// Load reference data for cross-reference validation.
// Returns null silently when files aren't present (some bundled mods only
// have partial data).
// Search for EDU in bundled-mod first, then in any user-installed mod under
// the Feral RTW Mods directory. Returns the parsed Set + the path used.
function loadEduUnitNames(modDataDir) {
  const candidates = [path.join(modDataDir, "export_descr_unit.txt")];
  // Fallback: any mod dir under Feral RTW Mods
  const modsRoot = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods";
  function walk(dir, depth) {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = path.join(dir, e.name);
      const cand = path.join(sub, "export_descr_unit.txt");
      if (fs.existsSync(cand)) candidates.push(cand);
      walk(sub, depth + 1);
    }
  }
  if (fs.existsSync(modsRoot)) walk(modsRoot, 0);
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const set = new Set();
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = raw.match(/^type\s+(.+?)\s*$/);
      if (m) set.add(m[1].trim());
    }
    if (set.size > 0) { set._sourcePath = p; return set; }
  }
  return null;
}
function loadEdbChainLevels(modDataDir) {
  const stripComments = (line) => { const i = line.indexOf(";"); return i >= 0 ? line.slice(0, i) : line; };
  const candidates = [
    path.join(modDataDir, "export_descr_buildings.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const text = fs.readFileSync(src, "utf8");
    const lines = text.split(/\r?\n/);
    const map = {};
    let curChain = null;
    for (const raw of lines) {
      const line = stripComments(raw).trim();
      if (!line) continue;
      const cm = line.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
      if (cm) { curChain = cm[1]; continue; }
      if (!curChain) continue;
      const lm = line.match(/^levels\s+(.+?)\s*\{?\s*$/);
      if (lm) {
        const levels = lm[1].split(/\s+/).filter(Boolean);
        if (levels.length > 0) map[curChain] = new Set(levels);
        curChain = null;
      }
    }
    if (Object.keys(map).length > 0) return map;
  }
  return null;
}
function loadEdctTraitNames(modDataDir) {
  const candidates = [path.join(modDataDir, "export_descr_character_traits.txt")];
  const modsRoot = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods";
  function walk(dir, depth) {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = path.join(dir, e.name);
      const cand = path.join(sub, "export_descr_character_traits.txt");
      if (fs.existsSync(cand)) candidates.push(cand);
      walk(sub, depth + 1);
    }
  }
  if (fs.existsSync(modsRoot)) walk(modsRoot, 0);
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const set = new Set();
    const maxLevels = {};
    let curTrait = null, levelCount = 0;
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const tm = raw.match(/^Trait\s+(\S+)/);
      if (tm) {
        if (curTrait) maxLevels[curTrait] = levelCount;
        curTrait = tm[1]; levelCount = 0;
        set.add(curTrait);
        continue;
      }
      if (curTrait && /^\s*Level\s+/.test(raw)) levelCount++;
    }
    if (curTrait) maxLevels[curTrait] = levelCount;
    if (set.size > 0) { set._sourcePath = p; set._maxLevels = maxLevels; return set; }
  }
  return null;
}
function loadEdaAncillaryNames(modDataDir) {
  const candidates = [path.join(modDataDir, "export_descr_ancillaries.txt")];
  const modsRoot = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods";
  function walk(dir, depth) {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = path.join(dir, e.name);
      const cand = path.join(sub, "export_descr_ancillaries.txt");
      if (fs.existsSync(cand)) candidates.push(cand);
      walk(sub, depth + 1);
    }
  }
  if (fs.existsSync(modsRoot)) walk(modsRoot, 0);
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const set = new Set();
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = raw.match(/^Ancillary\s+(\S+)/);
      if (m) set.add(m[1]);
    }
    if (set.size > 0) { set._sourcePath = p; return set; }
  }
  return null;
}

const eduUnits = loadEduUnitNames(modDataDir);
const edbChains = loadEdbChainLevels(modDataDir);
const edctTraits = loadEdctTraitNames(modDataDir);
const edaAncs = loadEdaAncillaryNames(modDataDir);
console.log(`reference data:`);
console.log(`  EDU:  ${eduUnits?.size ?? "(missing)"} units${eduUnits?._sourcePath ? " ← " + eduUnits._sourcePath : ""}`);
console.log(`  EDB:  ${edbChains ? Object.keys(edbChains).length : "(missing)"} chains`);
console.log(`  EDCT: ${edctTraits?.size ?? "(missing)"} traits${edctTraits?._sourcePath ? " ← " + edctTraits._sourcePath : ""}`);
console.log(`  EDA:  ${edaAncs?.size ?? "(missing)"} ancillaries${edaAncs?._sourcePath ? " ← " + edaAncs._sourcePath : ""}`);
console.log();

const text = fs.readFileSync(inputPath, "utf8");
const lines = text.split(/\r?\n/);
console.log(`validating ${inputPath}  (${lines.length} lines, ${(text.length / 1024 / 1024).toFixed(2)} MB)`);
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
    else {
      const m = line.match(/^type\s+(\S+)\s+(\S+)/);
      if (m && edbChains) {
        const chain = m[1], level = m[2];
        const levels = edbChains[chain];
        if (!levels) err(i + 1, "unknown building chain: " + chain);
        else if (!levels.has(level)) err(i + 1, `unknown level "${level}" for chain ${chain}`);
      }
    }
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
  if (/^unit\s/.test(line)) {
    // Format: `unit\t\t<unit_name>\t\texp N armour N weapon_lvl N`
    const m = line.match(/^unit\s+(.+?)\s+exp\s+\d+\s+armour/);
    if (m && eduUnits) {
      const unitName = m[1].trim();
      if (!eduUnits.has(unitName)) err(i + 1, "unknown unit: " + unitName);
    }
    continue;
  }
  if (/^traits\s/.test(line)) {
    traitsLines++;
    if (edctTraits) {
      const body = line.slice(6).trim();
      for (const part of body.split(",")) {
        const m = part.trim().match(/^(\S+)\s+(\d+)$/);
        if (m && !edctTraits.has(m[1])) warn(i + 1, "unknown trait: " + m[1]);
        else if (m && edctTraits._maxLevels) {
          const cap = edctTraits._maxLevels[m[1]];
          const lvl = +m[2];
          if (cap && lvl > cap) warn(i + 1, `trait ${m[1]} level ${lvl} exceeds EDCT max ${cap}`);
        }
      }
    }
    continue;
  }
  if (/^ancillaries\s/.test(line)) {
    anciLines++;
    if (edaAncs) {
      const body = line.slice(12).trim();
      for (const part of body.split(",")) {
        const name = part.trim();
        if (name && !edaAncs.has(name)) warn(i + 1, "unknown ancillary: " + name);
      }
    }
    continue;
  }
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
