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
  const coords = descrGen.buildRegionCoords(fs.readFileSync(tgaPath), rgbToRegion);
  const val = { mtime, coords, regionToCity };
  _coordCache.set(key, val);
  return val;
}

function registerFactionTransferHandlers(ipcMain, { getActiveModDataDir, getModExportDir, modOut, _writeLog } = {}) {
  const log = typeof _writeLog === "function" ? _writeLog : () => { };

  // Resolve both campaigns for a mod dir. `campaign` picks one when a mod has
  // several (RIS_Light ships ris_light and ris_light_2).
  function resolve(modDataDir, campaign) {
    const camps = campaignsIn(modDataDir);
    if (!camps.length) return { error: "no campaign with a descr_strat.txt in this mod" };
    const target = (campaign && camps.find((c) => c.name === campaign)) || camps[0];
    return { camps, target, source: baseModOf(modDataDir, target.strat) };
  }

  // ── what can be woken here, and from where ──────────────────────────────
  ipcMain.handle("faction-transfer-scan", async (_e, modDataDir, campaign) => {
    try {
      const dir = modDataDir || getActiveModDataDir();
      if (!dir) return { error: "no mod loaded" };
      const r = resolve(dir, campaign);
      if (r.error) return r;
      const targetText = fs.readFileSync(r.target.strat, "latin1");
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

      const targetText = fs.readFileSync(r.target.strat, "latin1");
      const sourceText = fs.readFileSync(r.source.strat, "latin1");
      const here = ft.readFactionRoster(targetText, faction);
      const there = ft.readFactionRoster(sourceText, faction);
      if (!here) return { error: `${faction} has no block in ${r.target.name}` };
      if (!there) return { error: `${faction} has no block in the source campaign` };

      const owners = ft.settlementOwners(targetText);
      const { coords, regionToCity } = mapCoords(dir);
      const srcMap = mapCoords(r.source.modDataDir);

      // Its source towns that exist here — the suggestion — plus every other
      // town on this map, so the user can pick freely.
      const suggested = new Set();
      for (const s of there.settlements) {
        if (owners[s.region]) { suggested.add(s.region); continue; }
        // same settlement NAME under a different region name (the maps were redrawn)
        const city = srcMap.regionToCity[s.region];
        if (!city) continue;
        const hereRegion = Object.keys(owners).find((rg) => regionToCity[rg] === city);
        if (hereRegion) suggested.add(hereRegion);
      }
      const settlements = Object.entries(owners).map(([region, o]) => ({
        region, city: regionToCity[region] || region, level: o.level, owner: o.faction,
        suggested: suggested.has(region), x: (coords[region] || {}).x ?? null, y: (coords[region] || {}).y ?? null,
      })).sort((a, b) => (b.suggested - a.suggested) || a.city.localeCompare(b.city));

      return {
        faction,
        target: { campaign: r.target.name, dormant: here.dormant, settlements: here.settlements.length, denari: here.denari },
        source: { campaign: r.source.campaign, denari: there.denari, aiLabel: there.aiLabel },
        roster: {
          characters: there.characters.map((c) => ({ name: c.name, kind: c.kind, role: c.role, age: c.age, units: c.unitCount, army: c.army, homeRegion: null })),
          family: there.family.map((f) => ({ name: f.name, gender: f.gender, age: f.age, alive: f.alive })),
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
      const r = resolve(dir, campaign);
      if (r.error) return r;
      const targetText = fs.readFileSync(r.target.strat, "latin1");
      const sourceText = r.source ? fs.readFileSync(r.source.strat, "latin1") : null;

      // Characters land on the tile of the town the user chose for them, or of
      // the faction's first new town — a coordinate from THIS map, never the
      // source's.
      const { coords } = mapCoords(dir);
      const settlements = Array.isArray(choice.settlements) ? choice.settlements : [];
      const fallback = settlements.map((rg) => coords[rg]).find(Boolean) || null;
      const placements = {};
      for (const name of (choice.characters || [])) {
        const at = (choice.placements || {})[name];
        const c = (at && at.region && coords[at.region]) || (at && at.x != null ? at : null) || fallback;
        if (!c) return { error: `no tile on this map for "${name}" — choose at least one settlement first` };
        placements[name] = { x: c.x, y: c.y };
      }

      const plan = ft.planFactionImport({
        targetText, sourceText, faction,
        settlements, characters: choice.characters || [], family: choice.family || [],
        placements, denari: choice.denari ?? null,
      });
      if (plan.errors.length) return { error: plan.errors[0], warnings: plan.warnings };
      if (choice.dryRun) return { ok: true, dryRun: true, summary: plan.summary, warnings: plan.warnings };

      const exportDir = typeof getModExportDir === "function" ? getModExportDir() : null;
      const outPath = exportDir && typeof modOut === "function" ? modOut(r.target.strat) : r.target.strat;
      const w = safeWrite.safeWriteModFile(r.target.strat, plan.text, "latin1", { outPath });
      log(`[faction-transfer] woke ${faction} in ${r.target.name}: ${plan.summary.settlements.length} settlement(s), ` +
        `${plan.summary.characters.length} character(s), ${plan.summary.family.length} family; ` +
        (w.exported ? `exported to ${w.path}` : `backup ${w.backupStamp}`));
      return { ok: true, summary: plan.summary, warnings: plan.warnings, path: w.path, exported: w.exported, backupStamp: w.backupStamp };
    } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  });
}

module.exports = { registerFactionTransferHandlers, campaignsIn, baseModOf, mapCoords };
