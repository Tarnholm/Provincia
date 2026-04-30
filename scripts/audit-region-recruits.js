// Cross-faction × region audit: for every region with a known descr_strat
// owner, simulate the recruit filter (mirroring App.js) and report:
//   - regions where 0 recruit lines pass
//   - sample of recruits that pass per faction × region
//
// This is a STATIC audit using bundled JSON + the live RIS EDB. It does NOT
// run the actual app; it reproduces the filter logic and surfaces likely
// false negatives.

const fs = require("fs");
const path = require("path");

const PUBLIC = path.resolve(__dirname, "..", "public");
const MOD = "C:/RIS/RIS/data";

const regions = require(path.join(PUBLIC, "regions_large.json"));
const buildings = require(path.join(PUBLIC, "descr_strat_buildings_large.json"));

// Build settlement → faction map (from buildings JSON which mirrors descr_strat).
const ownerByCity = {};
for (const f of buildings) for (const s of (f.settlements || [])) ownerByCity[s.region] = f.faction;
// region → buildings list
const buildingsByRegion = {};
for (const f of buildings) for (const s of (f.settlements || [])) buildingsByRegion[s.region] = s.buildings || [];

// Parse EDB recruit lines + aliases (mirror main.js's parser).
const edbText = fs.readFileSync(path.join(MOD, "export_descr_buildings.txt"), "utf8");
const stripComments = (line) => { const i = line.indexOf(";"); return i >= 0 ? line.slice(0, i) : line; };
const lines = edbText.split(/\r?\n/);

// Aliases.
const aliases = {};
{
  let curAlias = null, curReq = "";
  for (const raw of lines) {
    const r = stripComments(raw).trim();
    if (!r) continue;
    const am = r.match(/^alias\s+(\w+)/);
    if (am) { curAlias = am[1]; curReq = ""; continue; }
    if (curAlias) {
      const rm = r.match(/^requires\s+(.+)$/);
      if (rm) curReq = rm[1].trim();
      if (r === "}") {
        if (curReq) {
          const branches = curReq.split(/\s+or\s+/);
          const out2 = [];
          for (const b of branches) {
            const m2 = b.match(/building_present_min_level\s+(\S+)\s+(\S+)/);
            if (m2) out2.push({ chain: m2[1], level: m2[2] });
          }
          if (out2.length > 0) aliases[curAlias] = out2;
        }
        curAlias = null; curReq = "";
      }
    }
  }
}

// Building chain levels (min sample). Static fallback — RIS uses long lists,
// but for satisfaction we just need to know that any built level >= required
// level. Because we only have JSON's level NAMES (not order), use simple
// equality-or-higher-by-string-id heuristic. For accuracy we'd need the EDB
// chain order; here we approximate with "if the chain is built at any level,
// assume tier_min works."
function hasMinLevel(builtList, chain, _level) {
  return builtList.some(b => b.type === chain);
}
function evalTier(tok, builtList) {
  const branches = aliases[tok];
  if (!branches) return false;
  return branches.some(({ chain, level }) => hasMinLevel(builtList, chain, level));
}

// Parse recruit lines per chain/level.
const recruits = {}; // chain → level → [{unit, factions, requires}]
{
  let curChain = null, curLevel = null, inCapability = false, depth = 0;
  for (const raw of lines) {
    const line = stripComments(raw).trim();
    if (!line) continue;
    const cm = line.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    if (cm) { curChain = cm[1]; curLevel = null; inCapability = false; depth = 0; continue; }
    if (!curChain) continue;
    const lm = line.match(/^([a-z_][a-z0-9_]*(?:\+\d+)?)\s+requires\b/);
    if (lm && !inCapability) {
      curLevel = lm[1];
      if (!recruits[curChain]) recruits[curChain] = {};
      if (!recruits[curChain][curLevel]) recruits[curChain][curLevel] = [];
      continue;
    }
    if (line === "capability" && curLevel) { inCapability = true; continue; }
    if (inCapability) {
      if (line.startsWith("{")) { depth++; continue; }
      if (line.startsWith("}")) { depth--; if (depth <= 0) { inCapability = false; depth = 0; } continue; }
      const rm = line.match(/^recruit\s+"([^"]+)"/);
      if (rm) {
        const fm = line.match(/requires\s+factions\s*\{\s*([^}]*)\}/);
        const factions = fm ? fm[1].split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : null;
        const ridx = line.indexOf("requires");
        const requires = ridx >= 0 ? line.slice(ridx + "requires".length).trim() : null;
        recruits[curChain][curLevel].push({ unit: rm[1], factions, requires });
      }
    }
  }
}

// EDU ownership.
const eduText = fs.readFileSync(path.join(MOD, "export_descr_unit.txt"), "utf8");
const ownership = {};
{
  let cur = null;
  for (const raw of eduText.split(/\r?\n/)) {
    const line = stripComments(raw).trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^type\s+(.+)$/))) { cur = m[1].trim(); continue; }
    if (!cur) continue;
    if ((m = line.match(/^ownership\s+(.+)$/))) {
      ownership[cur] = m[1].split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      cur = null;
    }
  }
}

// Faction culture lookup (from descr_sm_factions).
const smText = fs.readFileSync(path.join(MOD, "descr_sm_factions.txt"), "utf8");
const factionCultures = {};
{
  let curFaction = null;
  for (const raw of smText.split(/\r?\n/)) {
    const fm = raw.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { curFaction = fm[1]; continue; }
    if (curFaction) {
      const cm = raw.match(/^\s*"culture":\s*"([a-z_]+)"/);
      if (cm) { factionCultures[curFaction] = cm[1]; curFaction = null; }
    }
  }
}

// Recruit filter — mirrors App.js.
function unitsForRegion(reg) {
  const owner = ownerByCity[reg.region];
  if (!owner) return null;
  const culture = factionCultures[owner] || null;
  const builtList = buildingsByRegion[reg.region] || [];
  if (builtList.length === 0) return [];
  const tagSet = new Set(String(reg.tags || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
  const seen = new Set();
  const result = [];
  for (const b of builtList) {
    const lvls = recruits[b.type];
    if (!lvls) continue;
    for (const lvl of Object.keys(lvls)) {
      for (const rec of lvls[lvl]) {
        if (rec.factions && rec.factions.length > 0
            && !rec.factions.includes("all")
            && !rec.factions.includes(owner)
            && !rec.factions.includes(culture)) continue;
        if (rec.requires) {
          if (/\bmajor_event\b/.test(rec.requires)) continue;
          if (/\bnot\s+is_player\b/.test(rec.requires)) continue;
          const negFacM = rec.requires.match(/not\s+factions\s*\{\s*([^}]*)\}/);
          if (negFacM) {
            const ex = negFacM[1].split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
            if (ex.includes(owner) || ex.includes(culture)) continue;
          }
          // HR
          let hrOk = true;
          for (const m of rec.requires.matchAll(/\bnot\s+hidden_resource\s+(\S+)/g)) {
            if (tagSet.has(m[1].toLowerCase())) { hrOk = false; break; }
          }
          if (!hrOk) continue;
          const positives = rec.requires.replace(/\bnot\s+hidden_resource\s+\S+/g, "");
          for (const m of positives.matchAll(/\bhidden_resource\s+(\S+)/g)) {
            if (!tagSet.has(m[1].toLowerCase())) { hrOk = false; break; }
          }
          if (!hrOk) continue;
          // Tier (positive + negative)
          let ok = true;
          for (const m of rec.requires.matchAll(/(\bnot\s+)?\b(mic_tier|gov_tier|colony_tier|culture_tier)_\d+\b/g)) {
            const negated = !!m[1];
            const tok = m[0].replace(/^not\s+/, "");
            const sat = evalTier(tok, builtList);
            if (negated ? sat : !sat) { ok = false; break; }
          }
          if (!ok) continue;
          // Direct building_present_min_level
          for (const m of rec.requires.matchAll(/(\bnot\s+)?\bbuilding_present_min_level\s+(\S+)\s+(\S+)/g)) {
            const negated = !!m[1];
            const sat = hasMinLevel(builtList, m[2], m[3]);
            if (negated ? sat : !sat) { ok = false; break; }
          }
          if (!ok) continue;
        }
        // EDU
        const owners = ownership[rec.unit];
        if (!owners) continue;
        if (!owners.includes("all") && !owners.includes(owner) && !owners.includes(culture)) continue;
        if (seen.has(rec.unit)) continue;
        seen.add(rec.unit);
        result.push(rec.unit);
      }
    }
  }
  return result;
}

// Run for every region.
let total = 0, withZero = 0;
const zeroOwners = {};
for (const v of Object.values(regions)) {
  if (!v.region) continue;
  const owner = ownerByCity[v.region];
  if (!owner || owner === "slave") continue; // skip rebel
  total++;
  const units = unitsForRegion(v);
  if (!units || units.length === 0) {
    withZero++;
    zeroOwners[owner] = (zeroOwners[owner] || 0) + 1;
  }
}
console.log("regions audited (non-rebel):", total);
console.log("regions with ZERO recruits:", withZero, `(${(withZero / total * 100).toFixed(1)}%)`);
console.log("\nzero-recruit regions by owning faction:");
for (const [f, n] of Object.entries(zeroOwners).sort((a, b) => b[1] - a[1])) {
  console.log("  ", f.padEnd(20), n);
}

// Sample 3 zero-recruit regions for inspection
console.log("\nFirst 5 zero-recruit regions:");
let shown = 0;
for (const v of Object.values(regions)) {
  if (shown >= 5) break;
  if (!v.region) continue;
  const owner = ownerByCity[v.region];
  if (!owner || owner === "slave") continue;
  const units = unitsForRegion(v);
  if (units && units.length === 0) {
    console.log(`  ${v.region} (${v.city}) → owner=${owner}, culture=${factionCultures[owner]}`);
    console.log(`    tags=${v.tags}`);
    console.log(`    buildings=${(buildingsByRegion[v.region] || []).map(b => `${b.type}/${b.level}`).join(", ") || "(none)"}`);
    shown++;
  }
}
