// save-to-descr-strat.js — convert a save file into a new descr_strat.txt
// for the "Continue Campaign as New Campaign" feature.
//
// CONCEPT: the engine's entity registry tops out at 65,536 entries. We can't
// shrink an existing save (see scripts/save-cracker/SESSION-2026-05-27-RESUME.md
// for why the splice path doesn't work). But a NEW campaign starts with the
// registry at zero. If we extract the current ownership + buildings +
// characters + armies from a save and write them as a fresh descr_strat, the
// user gets to keep all their progress while restarting the entity counter.
//
// MVP — this iteration covers:
//   * Per-faction settlements with their buildings
//   * Treasury (placeholder for now)
//   * Faction header lines
//
// NOT YET covered (gaps to identify and crack):
//   * Settlement level (village..huge_city) — not extracted from save yet
//   * Characters (generals, family members, traits, ages, positions)
//   * Armies (commanders, units, exp/armour/weapon upgrades, positions)
//   * Diplomatic relations
//   * Per-settlement religion
//   * Faction-creator field (for rebel-default)
//   * year_founded / population values
//
// Usage:  node scripts/save-to-descr-strat.js <save-path> [output-path]
//   Defaults: output = derived/<savename>.descr_strat.txt

"use strict";
const fs = require("fs");
const path = require("path");

const { parseSettlements } = require("../src/buildingParser.js");
const { resolveCurrentOwners } = require("../src/saveOwnershipParser.js");
const { buildInitialOwnership, parseDescrRegions, findDescrRegions } =
  require("../src/ownershipParser.js");

const SCRIPT_DIR = __dirname;
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const BUNDLED_MOD = path.join(PROJECT_ROOT, "bundled-mod", "data");

// ── EDB chain levels ────────────────────────────────────────────────────────
// Maps chain name (e.g. "core_building") → [level0Name, level1Name, ...]
// so we can convert numeric save levels to descr_strat names ("governors_house",
// "governors_villa", "proconsuls_palace", ...).
function loadChainLevels(modDataDir) {
  const stripComments = (line) => {
    const i = line.indexOf(";");
    return i >= 0 ? line.slice(0, i) : line;
  };
  const candidates = [
    path.join(modDataDir, "export_descr_buildings.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "export_descr_buildings.txt"),
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
        if (levels.length > 0) map[curChain] = levels;
        curChain = null;
      }
    }
    if (Object.keys(map).length > 0) return map;
  }
  return {};
}

// ── descr_strat faction list (with AI types) ────────────────────────────────
// We need the `faction X, ai_Y` lines verbatim so the output matches what
// the engine expects. Pull them from the bundled descr_strat as-is.
function loadFactionDeclarations(stratPath) {
  const text = fs.readFileSync(stratPath, "utf8");
  const lines = text.split(/\r?\n/);
  const out = {};   // faction_id → { aiLine, denari, superfaction }
  let curFac = null;
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const fm = line.match(/^faction\s+([A-Za-z0-9_]+)\s*(?:,\s*(.+))?$/);
    if (fm) {
      curFac = fm[1];
      out[curFac] = { aiType: fm[2] || "default", denari: 0, superfaction: null };
      continue;
    }
    if (!curFac) continue;
    const dm = line.match(/^denari\s+(-?\d+)/);
    if (dm) { out[curFac].denari = parseInt(dm[1], 10); continue; }
    const sm = line.match(/^superfaction\s+(\w+)/);
    if (sm) { out[curFac].superfaction = sm[1]; continue; }
    if (line === "settlement") { curFac = null; } // stop on first settlement
  }
  return out;
}

// ── settlement → region name (for `region <RegionName>` in descr_strat) ────
function loadSettlementToRegion(modDataDir) {
  const regionsPath = findDescrRegions(modDataDir, "imperial_campaign");
  if (!regionsPath) return {};
  const regionToSettlement = parseDescrRegions(regionsPath);
  const settlementToRegion = {};
  for (const [region, settlement] of Object.entries(regionToSettlement)) {
    settlementToRegion[settlement] = region;
  }
  return settlementToRegion;
}

// ── descr_strat emission ────────────────────────────────────────────────────
// One faction block: header + (treasury) + each settlement block.
function emitFactionBlock(facId, decl, settlements, chainLevels) {
  const lines = [];
  lines.push(`faction\t${facId}, ${decl.aiType}`);
  if (decl.superfaction) lines.push(`superfaction ${decl.superfaction}`);
  lines.push(`denari\t${decl.denari || 1000}`);
  for (const s of settlements) {
    lines.push("settlement");
    lines.push("{");
    // TODO: settlement level — not extracted from save yet. Defaulting to large_town
    // because most mid-campaign settlements are at least that tier; will under-
    // report capitals (large_city / huge_city). Cracking this is gap #1.
    lines.push(`\tlevel large_town`);
    lines.push(`\tregion ${s.region || "Unknown"}`);
    lines.push(`\tyear_founded 0`);
    lines.push(`\tpopulation 3000`);    // TODO: extract from save
    lines.push(`\tplan_set default_set`);
    lines.push(`\tfaction_creator ${facId}`);
    for (const b of s.buildings) {
      const levelNames = chainLevels[b.name];
      let levelName;
      if (levelNames && typeof b.level === "number" && b.level >= 0 && b.level < levelNames.length) {
        levelName = levelNames[b.level];
      } else {
        // Fallback: write a placeholder comment so the gap is visible in the output
        levelName = `level_${b.level ?? "?"}`;
      }
      lines.push(`\tbuilding`);
      lines.push(`\t{`);
      lines.push(`\t\ttype ${b.name} ${levelName}`);
      lines.push(`\t}`);
    }
    lines.push("}");
  }
  return lines.join("\n");
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error("usage: node scripts/save-to-descr-strat.js <save-path> [output-path]");
    process.exit(2);
  }
  const savePath = argv[0];
  const outPath = argv[1] || path.join(PROJECT_ROOT, "derived", path.basename(savePath, ".sav") + ".descr_strat.txt");

  if (!fs.existsSync(savePath)) {
    console.error("save not found:", savePath);
    process.exit(1);
  }
  console.log("save:", savePath);
  console.log("bundled mod:", BUNDLED_MOD);
  console.log("output:", outPath);
  console.log();

  // 1. Load mod data for ground truth
  const t0 = Date.now();
  const ownership = buildInitialOwnership(BUNDLED_MOD);
  if (ownership.error) {
    console.error("ownership parser failed:", ownership.error);
    process.exit(1);
  }
  console.log(`[${Date.now() - t0}ms] descr_strat ground truth loaded — ${Object.keys(ownership.ownerByCity).length} settlements`);

  const stratPath = ownership.stratPath;
  const factionDecls = loadFactionDeclarations(stratPath);
  console.log(`[${Date.now() - t0}ms] faction declarations parsed — ${Object.keys(factionDecls).length} factions`);

  const chainLevels = loadChainLevels(BUNDLED_MOD);
  console.log(`[${Date.now() - t0}ms] EDB chain levels parsed — ${Object.keys(chainLevels).length} chains`);

  const settlementToRegion = loadSettlementToRegion(BUNDLED_MOD);
  console.log(`[${Date.now() - t0}ms] settlement→region map — ${Object.keys(settlementToRegion).length} settlements`);

  // 2. Parse the save
  const buf = fs.readFileSync(savePath);
  console.log(`[${Date.now() - t0}ms] save loaded — ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  const parsed = parseSettlements(buf, null, null);  // permissive scan
  console.log(`[${Date.now() - t0}ms] settlements + buildings parsed — ${parsed.settlements.length} settlements`);

  const owners = resolveCurrentOwners(buf, ownership.ownerByCity);
  if (owners.error) {
    console.error("ownership resolution failed:", owners.error);
    process.exit(1);
  }
  console.log(`[${Date.now() - t0}ms] current owners resolved — ${Object.keys(owners.ownerByCity).length} settlements have owners, ${owners.unknownCount} unknown`);
  if (owners.unknownCount > 0) {
    console.log(`  sample unknown:`, owners.sampleUnknown.slice(0, 3));
  }

  // 3. Group settlements by current owner
  const byFaction = {};
  let unowned = 0;
  for (const s of parsed.settlements) {
    const owner = owners.ownerByCity[s.name];
    if (!owner) { unowned++; continue; }
    if (!byFaction[owner]) byFaction[owner] = [];
    byFaction[owner].push({
      ...s,
      region: settlementToRegion[s.name],
    });
  }
  console.log(`[${Date.now() - t0}ms] grouped: ${Object.keys(byFaction).length} factions own settlements, ${unowned} unowned/unresolved`);

  // 4. Per-faction settlement count (sanity check)
  const counts = Object.entries(byFaction).map(([f, ss]) => `${f}=${ss.length}`).sort();
  console.log("settlement count per faction:", counts.slice(0, 12).join(", "), counts.length > 12 ? `... +${counts.length - 12}` : "");

  // 5. Emit per-faction blocks
  const blocks = [];
  blocks.push("; Auto-generated descr_strat from a save file");
  blocks.push("; Source: " + path.basename(savePath));
  blocks.push("; MVP: settlements + buildings only. Characters/armies/diplomacy NOT YET extracted.");
  blocks.push("");
  blocks.push("campaign\timperial_campaign");
  blocks.push("options bi");
  blocks.push("playable");
  // For the prototype, list every faction we have settlements for as playable.
  // The real version should mirror the bundled descr_strat's playable/nonplayable split.
  for (const fac of Object.keys(byFaction)) blocks.push(`\t${fac}`);
  blocks.push("end");
  blocks.push("nonplayable");
  blocks.push("end");
  blocks.push("unlockable");
  blocks.push("end");
  blocks.push("");

  for (const [facId, ss] of Object.entries(byFaction)) {
    const decl = factionDecls[facId];
    if (!decl) {
      console.warn(`  WARNING: no declaration for ${facId} in bundled descr_strat — skipping`);
      continue;
    }
    blocks.push(`;;; ${facId} — ${ss.length} settlements`);
    blocks.push(emitFactionBlock(facId, decl, ss, chainLevels));
    blocks.push("");
  }

  // 6. Write output
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, blocks.join("\n"), "utf8");
  console.log(`\n[${Date.now() - t0}ms] wrote ${outPath}`);
  console.log(`output size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
}

main().catch((e) => {
  console.error("FATAL:", e.stack || e);
  process.exit(1);
});
