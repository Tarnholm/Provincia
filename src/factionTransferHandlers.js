// IPC for waking a dormant faction on a campaign map (the ☥ Bring In a Faction
// tool). The text work is src/factionTransfer.js; this locates the two
// campaigns, resolves map tiles for character placement, and writes the result.
//
// SOURCE vs TARGET. The target is the campaign the app has loaded — a submod
// like RIS_Light, whose map is its own (422 regions against the main mod's
// 1,312). The source is the mod that submod sits on, found the same way the
// analysis overlay finds it (src/modPathResolver.js findRelatedModDirs), so a
// roster comes from the main mod without the user pointing at it.
//
// FACTIONS ALREADY ON THE MAP get the same treatment (2026-10-16): the roster
// marks the towns they hold and the people already here, and characters
// stand in one of their own towns when no new one is chosen.
//
// Campaign folders are NOT always imperial_campaign — RIS_Light's is
// `ris_light`, RIS_Classic's `ris_classic` — so both sides are discovered by
// scanning world/maps/campaign/*/descr_strat.txt rather than guessing names.
"use strict";
const fs = require("fs");
const path = require("path");

const ft = require("./factionTransfer.js");
const descrGen = require("./descrStratGeneral.js");
const { findRelatedModDirs } = require("./modPathResolver.js");
const safeWrite = require("./safeModWrite.js");
const freeTiles = require("./freeTiles.js");
const sc = require("./settlementCompare.js");
const { readBuildingCatalogue, requiresBlocks } = require("./buildingCatalogue.js");
const { parseFactionCultures } = require("./culturePenalty.js");

const CAMPAIGN_REL = ["world", "maps", "campaign"];

// Every campaign in a mod dir: [{ name, strat }].
function campaignsIn(modDataDir) {
  const dir = path.join(modDataDir, ...CAMPAIGN_REL);
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
  const out = [];
  for (const name of names) {
    const strat = path.join(dir, name, "descr_strat.txt");
    if (fs.existsSync(strat)) out.push({ name, strat });
  }
  return out;
}

// The roster source: the FULLEST campaign among the mods related to this one.
//
// Not simply "the first related dir": findRelatedModDirs walks up and scans
// siblings, so for RIS_Light it offers RIS_Classic — another submod, smaller
// than Light itself. The main mod is the one with the most settlements on its
// map (RIS 1,306 against Light's 422 and Classic's 160), which is exactly the
// property that makes it worth taking a roster from. Ties never matter: a
// candidate with fewer settlements than the target is rejected outright.
function countSettlements(file) {
  try { return (fs.readFileSync(file, "latin1").match(/^settlement\s*$/gm) || []).length; }
  catch { return 0; }
}

function baseModOf(modDataDir, targetStrat) {
  let related = [];
  try { related = findRelatedModDirs(modDataDir, path.join(...CAMPAIGN_REL)) || []; } catch { return null; }
  const me = path.resolve(modDataDir);
  const mine = targetStrat ? countSettlements(targetStrat) : 0;
  const candidates = [];
  for (const dir of related) {
    if (path.resolve(dir) === me) continue;
    for (const c of campaignsIn(dir)) {
      const settlements = countSettlements(c.strat);
      if (settlements > mine) candidates.push({ modDataDir: dir, campaign: c.name, strat: c.strat, settlements });
    }
  }
  // Ties are normal and must not be settled by directory order: RIS_Four_Romans
  // is a full copy of the main mod and matches it settlement for settlement
  // (1,306 each). Prefer the mod that does NOT sit under a _submods-style
  // folder, then the shallower path. The runners-up travel back as
  // `alternatives` so the caller can offer a different source.
  const inSubmodFolder = (p) => String(p).replace(/\\/g, "/").split("/").some((seg) => /^_/.test(seg) || /^submods$/i.test(seg));
  candidates.sort((a, b) =>
    (b.settlements - a.settlements) ||
    (inSubmodFolder(a.modDataDir) - inSubmodFolder(b.modDataDir)) ||
    (a.modDataDir.length - b.modDataDir.length));
  const best = candidates[0] || null;
  if (best) best.alternatives = candidates.slice(1, 6).map((c) => ({ modDataDir: c.modDataDir, campaign: c.campaign, settlements: c.settlements }));
  return best;
}

// region → tile on THIS map, for placing characters brought from another one.
const _coordCache = new Map(); // modDataDir → { mtime, coords, regionToCity }
function mapCoords(modDataDir) {
  const base = path.join(modDataDir, "world", "maps", "base");
  const regPath = path.join(base, "descr_regions.txt");
  const tgaPath = path.join(base, "map_regions.tga");
  if (!fs.existsSync(regPath) || !fs.existsSync(tgaPath)) return { coords: {}, regionToCity: {} };
  const key = modDataDir;
  const mtime = Math.max(fs.statSync(regPath).mtimeMs, fs.statSync(tgaPath).mtimeMs);
  const hit = _coordCache.get(key);
  if (hit && hit.mtime === mtime) return hit;
  const { regionToCity, rgbToRegion } = descrGen.parseDescrRegions(fs.readFileSync(regPath, "utf8"));
  const tgaBuf = fs.readFileSync(tgaPath);
  const coords = descrGen.buildRegionCoords(tgaBuf, rgbToRegion);
  // the terrain behind free-tile placement, decoded on first use
  let tiles;
  const tileMap = () => {
    if (tiles !== undefined) return tiles;
    const groundPath = path.join(base, "map_ground_types.tga"), featPath = path.join(base, "map_features.tga");
    tiles = fs.existsSync(groundPath) ? freeTiles.makeTileMap({
      regions: descrGen.tgaToRaw(tgaBuf),
      ground: descrGen.tgaToRaw(fs.readFileSync(groundPath)),
      features: fs.existsSync(featPath) ? descrGen.tgaToRaw(fs.readFileSync(featPath)) : null,
      rgbToRegion,
    }) : null;
    return tiles;
  };
  const val = { mtime, coords, regionToCity, tileMap };
  _coordCache.set(key, val);
  return val;
}

// Each character on its own tile: the leader in the town, everyone else on the
// nearest free tile (src/freeTiles.js). `chars` = [{ name, role, kind, region }].
// Occupancy is read from `stratText` — pass the text AFTER the rebels have left
// the towns being taken, or the leader finds his own town occupied.
function placeOnMap(modDataDir, stratText, chars) {
  const { coords, regionToCity, tileMap } = mapCoords(modDataDir);
  const tiles = tileMap();
  if (!tiles) return { errors: ["this map has no map_ground_types.tga — cannot tell a free tile from a mountain"], placements: {}, notes: [] };
  const occupied = ft.characterTiles(stratText).map((c) => c.x + "," + c.y);
  return freeTiles.placeCharacters({ tiles, towns: coords, cityOf: regionToCity, occupied, chars });
}

// ── Compare Settlements: what the base mod knows about buildings ─────────
// A submod ships no EDB or descr_sm_factions of its own (RIS_Light, Classic),
// so each is read from the first of the two mods that has it.
const _fileCache = new Map(); // path → { mtime, value }
function cachedRead(file, parse) {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const hit = _fileCache.get(file);
    if (hit && hit.mtime === mtime) return hit.value;
    const value = parse(fs.readFileSync(file, "utf8"));
    _fileCache.set(file, { mtime, value });
    return value;
  } catch { return null; }
}
function firstExisting(dirs, rel) {
  for (const d of dirs) { if (!d) continue; const f = path.join(d, rel); if (fs.existsSync(f)) return f; }
  return null;
}
function buildingContext(targetDir, sourceDir) {
  const edb = firstExisting([targetDir, sourceDir], "export_descr_buildings.txt");
  const sm = firstExisting([targetDir, sourceDir], "descr_sm_factions.txt");
  return {
    catalogue: (edb && cachedRead(edb, readBuildingCatalogue)) || readBuildingCatalogue(""),
    cultureOf: (sm && (cachedRead(sm, parseFactionCultures) || {}).cultureOf) || {},
  };
}
// descr_regions per region: { city, tags:Set } — the 5th field is the tag list
// (Etruria / Arretium / romans_julii / Etruscans / 157 198 13 / aor_etruscan, …).
function regionInfo(modDataDir) {
  const f = path.join(modDataDir, "world", "maps", "base", "descr_regions.txt");
  return cachedRead(f, (text) => {
    const out = {};
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const name = lines[i];
      if (!name || !/^[A-Za-z]/.test(name)) continue;
      const fields = [];
      for (let j = i + 1; j < lines.length && fields.length < 5; j++) {
        if (/^[A-Za-z]/.test(lines[j])) break; // the next region
        const t = lines[j].trim();
        if (!t || t.startsWith(";")) continue;
        fields.push(t.replace(/\s*;.*$/, ""));
      }
      if (fields.length >= 4) out[name.trim()] = { city: fields[0], tags: new Set((fields[4] || "").split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)) };
    }
    return out;
  }) || {};
}

// The same town in the base mod: same region name, else same settlement name.
function matchTowns(targetDir, targetText, sourceDir, sourceText) {
  const here = sc.settlementIndex(targetText), there = sc.settlementIndex(sourceText);
  const hereInfo = regionInfo(targetDir), thereInfo = regionInfo(sourceDir);
  const byRegion = new Map(there.map((s) => [s.region, s]));
  const byCity = new Map();
  for (const s of there) { const c = thereInfo[s.region] && thereInfo[s.region].city; if (c && !byCity.has(c)) byCity.set(c, s); }
  return here.map((h) => {
    const city = (hereInfo[h.region] && hereInfo[h.region].city) || h.region;
    const t = byRegion.get(h.region) || byCity.get(city) || null;
    return { here: h, there: t, city, sourceCity: t ? ((thereInfo[t.region] && thereInfo[t.region].city) || t.region) : null, tags: (hereInfo[h.region] || {}).tags || new Set() };
  });
}

function registerFactionTransferHandlers(ipcMain, { getActiveModDataDir, getModExportDir, modOut, _writeLog } = {}) {
  const log = typeof _writeLog === "function" ? _writeLog : () => { };

  // In export mode edits land in the export copy, so that copy is what the
  // next read must see — reading the live file made a second apply rebuild
  // from the original and silently drop the first.
  const exportOut = (p) => (typeof getModExportDir === "function" && getModExportDir() && typeof modOut === "function" ? modOut(p) : p);
  const readTarget = (p) => fs.readFileSync(safeWrite.editBasePath(p, exportOut(p)), "latin1");

  // Resolve both campaigns for a mod dir. `campaign` picks one when a mod has
  // several (RIS_Light ships ris_light and ris_light_2).
  // `strict` (apply): a named campaign that is not in this mod is an error,
  // never a silent switch to the first one.
  function resolve(modDataDir, campaign, strict) {
    const camps = campaignsIn(modDataDir);
    if (!camps.length) return { error: "no campaign with a descr_strat.txt in this mod" };
    const named = campaign ? camps.find((c) => c.name === campaign) : null;
    if (strict && campaign && !named) return { error: `this mod has no campaign "${campaign}" — reopen the panel` };
    const target = named || camps[0];
    return { camps, target, source: baseModOf(modDataDir, target.strat) };
  }

  // ── what can be woken here, and from where ──────────────────────────────
  ipcMain.handle("faction-transfer-scan", async (_e, modDataDir, campaign) => {
    try {
      const dir = modDataDir || getActiveModDataDir();
      if (!dir) return { error: "no mod loaded" };
      const r = resolve(dir, campaign);
      if (r.error) return r;
      const targetText = readTarget(r.target.strat);
      const owners = ft.settlementOwners(targetText);
      const sourceText = r.source ? fs.readFileSync(r.source.strat, "latin1") : null;

      const blocks = ft.factionBlocks(targetText.split(/\r?\n/));
      const held = {};
      for (const o of Object.values(owners)) held[o.faction] = (held[o.faction] || 0) + 1;
      const factions = blocks.map((b) => {
        const roster = ft.readFactionRoster(targetText, b.faction);
        const inSource = sourceText ? ft.readFactionRoster(sourceText, b.faction) : null;
        return {
          faction: b.faction,
          dormant: !!roster.dormant,
          settlements: held[b.faction] || 0,
          characters: roster.characters.length,
          sourceSettlements: inSource ? inSource.settlements.length : null,
          sourceCharacters: inSource ? inSource.characters.length : null,
        };
      });
      log(`[faction-transfer] ${r.target.name}: ${factions.filter((f) => f.dormant).length} dormant of ${factions.length}` +
        (r.source ? `; roster source ${r.source.modDataDir} (${r.source.campaign}, ${r.source.settlements} settlements)` : "; NO fuller mod found to take a roster from"));
      return {
        target: { modDataDir: dir, campaign: r.target.name, strat: r.target.strat, campaigns: r.camps.map((c) => c.name) },
        source: r.source ? { modDataDir: r.source.modDataDir, campaign: r.source.campaign, settlements: r.source.settlements, alternatives: r.source.alternatives || [] } : null,
        factions,
      };
    } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  });

  // ── one faction: its roster over there, its options over here ───────────
  ipcMain.handle("faction-transfer-roster", async (_e, modDataDir, faction, campaign) => {
    try {
      const dir = modDataDir || getActiveModDataDir();
      if (!dir || !faction) return { error: "modDataDir and faction required" };
      const r = resolve(dir, campaign);
      if (r.error) return r;
      if (!r.source) return { error: "no base mod found to take a roster from — this campaign is not a submod of anything Provincia can see" };

      const targetText = readTarget(r.target.strat);
      const sourceText = fs.readFileSync(r.source.strat, "latin1");
      const here = ft.readFactionRoster(targetText, faction);
      const there = ft.readFactionRoster(sourceText, faction);
      if (!here) return { error: `${faction} has no block in ${r.target.name}` };
      if (!there) return { error: `${faction} has no block in the source campaign` };

      const owners = ft.settlementOwners(targetText);
      const { coords, regionToCity } = mapCoords(dir);
      const srcMap = mapCoords(r.source.modDataDir);

      // Its source towns that exist here — the suggestion — plus every other
      // town on this map, so the user can pick freely. Towns it already holds
      // here are listed as its own, never suggested.
      const fac = String(faction).toLowerCase();
      const suggested = new Set();
      for (const s of there.settlements) {
        if (owners[s.region]) { if (owners[s.region].faction !== fac) suggested.add(s.region); continue; }
        // same settlement NAME under a different region name (the maps were redrawn)
        const city = srcMap.regionToCity[s.region];
        if (!city) continue;
        const hereRegion = Object.keys(owners).find((rg) => regionToCity[rg] === city);
        if (hereRegion && owners[hereRegion].faction !== fac) suggested.add(hereRegion);
      }
      const settlements = Object.entries(owners).map(([region, o]) => ({
        region, city: regionToCity[region] || region, level: o.level, owner: o.faction, own: o.faction === fac,
        suggested: suggested.has(region), x: (coords[region] || {}).x ?? null, y: (coords[region] || {}).y ?? null,
      })).sort((a, b) => (b.suggested - a.suggested) || (a.own - b.own) || a.city.localeCompare(b.city));

      const hereNames = new Set([...here.characters.map((c) => c.name), ...here.family.map((f) => f.name)]);
      const clashes = ft.roleClashes(here, there);
      const holder = (role) => (here.characters.find((c) => c.role === role) || {}).name || null;
      return {
        faction,
        target: {
          campaign: r.target.name, dormant: here.dormant, settlements: here.settlements.length, denari: here.denari,
          characters: here.characters.length, family: here.family.length, leader: holder("leader"), heir: holder("heir"),
        },
        source: { campaign: r.source.campaign, denari: there.denari, aiLabel: there.aiLabel },
        roster: {
          characters: there.characters.map((c) => ({ name: c.name, kind: c.kind, role: c.role, age: c.age, units: c.unitCount, army: c.army, homeRegion: null, here: hereNames.has(c.name), demotedFrom: clashes[c.name] || null })),
          family: there.family.map((f) => ({ name: f.name, gender: f.gender, age: f.age, alive: f.alive, here: hereNames.has(f.name) })),
          relatives: there.relatives.map((x) => ({ names: x.names })),
        },
        settlements,
        suggestedCount: suggested.size,
      };
    } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  });

  // ── do it ───────────────────────────────────────────────────────────────
  ipcMain.handle("faction-transfer-apply", async (_e, modDataDir, faction, choice = {}, campaign) => {
    try {
      const dir = modDataDir || getActiveModDataDir();
      if (!dir || !faction) return { error: "modDataDir and faction required" };
      const r = resolve(dir, campaign, true);
      if (r.error) return r;
      const targetText = readTarget(r.target.strat);
      const sourceText = r.source ? fs.readFileSync(r.source.strat, "latin1") : null;

      // Characters belong to the town the user chose for them, else the town
      // they stand by in the source campaign when the faction holds it here
      // afterwards, else its first new town — coordinates from THIS map, never
      // the source's. The leader stands in the town; everyone else on the
      // nearest free tile of its region (src/freeTiles.js).
      const { coords, regionToCity } = mapCoords(dir);
      const settlements = Array.isArray(choice.settlements) ? choice.settlements : [];
      const roster = sourceText ? ft.readFactionRoster(sourceText, faction) : null;
      // a faction already on the map: its people are never brought twice,
      // and with no new town they gather at one it holds
      const here = ft.readFactionRoster(targetText, faction);
      const hereNames = new Set(here ? [...here.characters.map((c) => c.name), ...here.family.map((f) => f.name)] : []);
      const clashes = ft.roleClashes(here, roster);
      const home = settlements.find((rg) => coords[rg]) || (here ? here.settlements.map((s) => s.region).find((rg) => coords[rg]) : null) || null;
      // the source town nearest each character, carried to this map by region
      // or by settlement name (the submods redrew the regions)
      const ownAfter = new Set([...settlements, ...(here ? here.settlements.map((s) => s.region) : [])]);
      const srcMap = r.source ? mapCoords(r.source.modDataDir) : null;
      const regionOfCity = {};
      for (const [rg, city] of Object.entries(regionToCity)) if (!regionOfCity[city]) regionOfCity[city] = rg;
      const sourceTown = (c) => {
        if (!srcMap || !c || c.x == null || c.y == null) return null;
        let best = null, bestD = Infinity;
        for (const s of roster.settlements) {
          const t = srcMap.coords[s.region];
          if (!t) continue;
          const d = (t.x - c.x) ** 2 + (t.y - c.y) ** 2;
          if (d < bestD) { bestD = d; best = s.region; }
        }
        if (!best) return null;
        const hereRegion = coords[best] ? best : regionOfCity[srcMap.regionToCity[best]];
        return hereRegion && ownAfter.has(hereRegion) && coords[hereRegion] ? hereRegion : null;
      };
      const placements = {}, toPlace = [];
      for (const name of (choice.characters || [])) {
        if (hereNames.has(name)) continue;
        const at = (choice.placements || {})[name];
        if (at && !at.region && at.x != null && at.y != null) { placements[name] = { x: at.x, y: at.y }; continue; }
        const c = roster && roster.characters.find((x) => x.name === name);
        const region = (at && at.region && coords[at.region]) ? at.region : (sourceTown(c) || home);
        if (!region) return { error: `no tile on this map for "${name}" — choose at least one settlement first` };
        // a leader who arrives as a family member does not take the town's tile
        toPlace.push({ name, role: c && !clashes[name] ? c.role : null, kind: c ? c.kind : null, region });
      }
      const placed = placeOnMap(dir, ft.clearRebelsAt(targetText, settlements, coords).text, toPlace);
      if (placed.errors.length) return { error: placed.errors[0] };
      Object.assign(placements, placed.placements);

      const plan = ft.planFactionImport({
        targetText, sourceText, faction,
        settlements, characters: choice.characters || [], family: choice.family || [],
        placements, settlementTiles: coords, denari: choice.denari ?? null,
      });
      if (plan.errors.length) return { error: plan.errors[0], warnings: plan.warnings };
      // "X is placed in R — H has no free tile", once per crowded town
      const crowded = {};
      for (const n of placed.notes) {
        const m = n.match(/^(.+) is placed in \S+ — (\S+) has no free tile$/);
        if (m) (crowded[m[2]] = crowded[m[2]] || []).push(m[1]); else plan.warnings.push(n);
      }
      for (const [town, names] of Object.entries(crowded)) {
        plan.warnings.push(names.length === 1 ? `${names[0]} stands in a neighbouring region — ${town} has no free tile`
          : `${names.length} characters stand in neighbouring regions — ${town} has no free tile left`);
      }
      if (choice.dryRun) return { ok: true, dryRun: true, summary: plan.summary, warnings: plan.warnings };

      const w = safeWrite.safeWriteModFile(r.target.strat, plan.text, "latin1", { outPath: exportOut(r.target.strat) });
      log(`[faction-transfer] ${plan.summary.wasAwake ? "added to" : "woke"} ${faction} in ${r.target.name}: ${plan.summary.settlements.length} settlement(s), ` +
        `${plan.summary.characters.length} character(s), ${plan.summary.family.length} family; ` +
        (w.exported ? `exported to ${w.path}` : `backup ${w.backupStamp}`));
      return { ok: true, summary: plan.summary, warnings: plan.warnings, path: w.path, exported: w.exported, backupStamp: w.backupStamp };
    } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  });

  // ── Compare Settlements (2026-10-16): this map's town vs the base mod's ──
  // Both campaigns resolve exactly as for Bring In a Faction, so RIS_Light and
  // RIS_Classic both compare against the main mod with no setup.
  const loadPair = (modDataDir, campaign, strict) => {
    const dir = modDataDir || getActiveModDataDir();
    if (!dir) return { error: "no mod loaded" };
    const r = resolve(dir, campaign, strict);
    if (r.error) return r;
    if (!r.source) return { error: "no fuller mod found beside this one to compare against" };
    return { dir, r, targetText: readTarget(r.target.strat), sourceText: fs.readFileSync(r.source.strat, "latin1") };
  };
  const blockLines = (text, s) => text.split(/\r?\n/).slice(s.start, s.end);

  ipcMain.handle("settlement-compare-list", async (_e, modDataDir, campaign) => {
    try {
      const p = loadPair(modDataDir, campaign);
      if (p.error) return p;
      const { catalogue } = buildingContext(p.dir, p.r.source.modDataDir);
      const towns = matchTowns(p.dir, p.targetText, p.r.source.modDataDir, p.sourceText).map((m) => {
        const row = { region: m.here.region, city: m.city, owner: m.here.owner, sourceRegion: m.there ? m.there.region : null, sourceCity: m.sourceCity, sourceOwner: m.there ? m.there.owner : null };
        if (!m.there) return row;
        const c = sc.compareSettlement(blockLines(p.targetText, m.here), blockLines(p.sourceText, m.there), catalogue);
        const f = Object.fromEntries(c.fields.map((x) => [x.key, x]));
        return {
          ...row,
          level: f.level ? f.level.here : null, sourceLevel: f.level ? f.level.there : null,
          population: f.population ? +f.population.here : null, sourcePopulation: f.population ? +f.population.there : null,
          buildings: c.buildings.filter((b) => b.here).length, sourceBuildings: c.buildings.filter((b) => b.there).length,
          missing: c.buildings.filter((b) => b.status === "missing").length,
          higher: c.buildings.filter((b) => b.status === "higher_there" || b.status === "different").length,
          onlyHere: c.buildings.filter((b) => b.status === "only_here").length,
          fieldsMore: c.fields.filter((x) => sc.fieldIsMore(x.key, x.here, x.there)).map((x) => x.key),
        };
      });
      return {
        target: { campaign: p.r.target.name },
        source: { campaign: p.r.source.campaign, modDataDir: p.r.source.modDataDir, settlements: p.r.source.settlements },
        towns,
      };
    } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  });

  ipcMain.handle("settlement-compare", async (_e, modDataDir, region, campaign) => {
    try {
      const p = loadPair(modDataDir, campaign);
      if (p.error) return p;
      const m = matchTowns(p.dir, p.targetText, p.r.source.modDataDir, p.sourceText).find((x) => x.here.region === region);
      if (!m) return { error: `no settlement in region "${region}" on this map` };
      if (!m.there) return { error: `${m.city} has no counterpart in ${p.r.source.campaign}` };
      const { catalogue, cultureOf } = buildingContext(p.dir, p.r.source.modDataDir);
      const here = blockLines(p.targetText, m.here), there = blockLines(p.sourceText, m.there);
      const c = sc.compareSettlement(here, there, catalogue);
      // What would stop each main-mod building working in THIS town: the tier it
      // needs, a requires clause this region / owner fails, or a slot (EDB
      // `tag`) another chain already fills here.
      const hereChains = c.buildings.filter((b) => b.here).map((b) => b.chain);
      const checks = {};
      for (const b of c.buildings) {
        if (!b.there) continue;
        const key = `${b.chain}|${b.there}`;
        const slot = catalogue.tags[b.chain];
        checks[b.chain] = {
          settlementMin: b.chain === "core_building" ? null : (catalogue.settlementMins[key] || null),
          // rebels: every level says `not factions { slave }` — that stops them
          // BUILDING, not a descr_strat holding it (main RIS's own rebel towns do)
          requires: requiresBlocks(catalogue.levelRequires[key], { faction: m.here.owner === "slave" ? null : m.here.owner, culture: cultureOf[m.here.owner], tags: m.tags }),
          slotTakenBy: b.status === "missing" && slot ? (hereChains.find((ch) => ch !== b.chain && catalogue.tags[ch] === slot) || null) : null,
        };
      }
      return {
        region: m.here.region, city: m.city, owner: m.here.owner,
        sourceRegion: m.there.region, sourceCity: m.sourceCity, sourceOwner: m.there.owner,
        sourceCampaign: p.r.source.campaign, targetCampaign: p.r.target.name,
        fields: c.fields.map((x) => ({ ...x, more: sc.fieldIsMore(x.key, x.here, x.there) })),
        buildings: c.buildings, checks,
        settlementTiers: catalogue.settlementTiers, levels: sc.LEVELS,
      };
    } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  });

  ipcMain.handle("settlement-compare-apply", async (_e, modDataDir, region, choice = {}, campaign) => {
    try {
      const p = loadPair(modDataDir, campaign, true);
      if (p.error) return p;
      const m = matchTowns(p.dir, p.targetText, p.r.source.modDataDir, p.sourceText).find((x) => x.here.region === region);
      if (!m || !m.there) return { error: `no main-mod counterpart for "${region}"` };
      const plan = sc.planSettlementCopy({ targetText: p.targetText, sourceText: p.sourceText, targetRegion: m.here.region, sourceRegion: m.there.region, choice });
      if (plan.errors.length) return { error: plan.errors[0] };
      if (!plan.changes.length) return { ok: true, changes: [], unchanged: true };
      if (choice.dryRun) return { ok: true, dryRun: true, changes: plan.changes };
      const w = safeWrite.safeWriteModFile(p.r.target.strat, plan.text, "latin1", { outPath: exportOut(p.r.target.strat) });
      log(`[settlement-compare] ${m.city} (${region}) in ${p.r.target.name} from ${p.r.source.campaign}: ${plan.changes.join("; ")}; ` +
        (w.exported ? `exported to ${w.path}` : `backup ${w.backupStamp}`));
      return { ok: true, changes: plan.changes, path: w.path, exported: w.exported, backupStamp: w.backupStamp };
    } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  });
}

module.exports = { registerFactionTransferHandlers, campaignsIn, baseModOf, mapCoords, placeOnMap, matchTowns, regionInfo, buildingContext };
