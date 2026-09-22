// IPC for creating a genuinely NEW faction (the ☥ New Faction tool). Waking a
// dormant one is the neighbouring tool (src/factionTransferHandlers.js); this
// one mints a faction the mod has never had, by cloning a donor across the
// files the engine demands and then giving it a home in a campaign.
//
// Which files are MANDATORY was settled by measuring the installed mod rather
// than guessing: for each candidate, does every one of the mod's declared
// factions appear in it? Seven do — descr_sm_factions, descr_character,
// descr_model_strat, descr_banners, feral_descr_ai_personality,
// descr_win_conditions and the campaign's descr_strat. Recruitment
// (export_descr_buildings) is NOT among them: four RIS factions have no entry
// at all and still exist, which is why it is a picker rather than a step.
//
// The text work is src/newFaction.js; this resolves paths, reads with the right
// encoding (expanded_bi.txt is UTF-16LE, everything else latin1), copies art,
// and writes every file through the one door in src/safeModWrite.js so each
// gets a stamped backup and an atomic rename.
"use strict";
const fs = require("fs");
const path = require("path");

const nf = require("./newFaction.js");
const ft = require("./factionTransfer.js");
const safeWrite = require("./safeModWrite.js");
const { campaignsIn, mapCoords } = require("./factionTransferHandlers.js");

// 239 is where RIS sits and no vanilla-engine mod is known to go past it.
// Treated as a warning, not a wall: this is not a RIS-only tool and the ceiling
// is the engine's, not Provincia's, so the user is told and decides.
const FACTION_CAP = 239;

const REL = {
  smFactions: "descr_sm_factions.txt",
  character: "descr_character.txt",
  modelStrat: "descr_model_strat.txt",
  banners: "descr_banners.txt",
  aiPersonality: "feral_descr_ai_personality.txt",
  namelists: "descr_namelists.txt",
  edb: "export_descr_buildings.txt",
  expandedText: path.join("text", "expanded_bi.txt"),
};
const ENC = { expandedText: "utf16le" };

function readIf(file, enc) {
  try { return fs.existsSync(file) ? fs.readFileSync(file, enc || "latin1") : null; } catch { return null; }
}

// Every file the plan may touch, plus where each lives, for one mod + campaign.
function gather(modDataDir, campaignStrat) {
  const paths = {};
  for (const [key, rel] of Object.entries(REL)) paths[key] = path.join(modDataDir, rel);
  paths.winConditions = path.join(path.dirname(campaignStrat), "descr_win_conditions.txt");
  paths.strat = campaignStrat;
  const files = {};
  for (const [key, p] of Object.entries(paths)) {
    const text = readIf(p, ENC[key]);
    if (text != null) files[key] = text;
  }
  return { paths, files };
}

// An art file may live in the mod or be inherited from the base game, so a
// source is looked for in the mod first and then in each fallback root. A
// missing source is a warning, never a failure — the faction still works, it
// just shows the donor's or a blank texture until the art is supplied.
function resolveArt(rel, roots) {
  for (const root of roots) {
    const p = path.join(root, rel.replace(/^data[\\/]/i, ""));
    if (fs.existsSync(p)) return p;
    const q = path.join(root, rel);
    if (fs.existsSync(q)) return q;
  }
  return null;
}

function registerNewFactionHandlers(ipcMain, { getActiveModDataDir, getModExportDir, modOut, getBaseGameDataDir, _writeLog } = {}) {
  const log = typeof _writeLog === "function" ? _writeLog : () => { };

  function resolve(modDataDir, campaign) {
    const camps = campaignsIn(modDataDir);
    if (!camps.length) return { error: "no campaign with a descr_strat.txt in this mod" };
    const target = (campaign && camps.find((c) => c.name === campaign)) || camps[0];
    return { camps, target };
  }

  // ── what is here: donors, campaigns, and how close to the ceiling ────────
  ipcMain.handle("new-faction-scan", async (_e, modDataDir, campaign) => {
    try {
      const dir = modDataDir || getActiveModDataDir();
      if (!dir) return { error: "no mod loaded" };
      const r = resolve(dir, campaign);
      if (r.error) return r;
      const { paths, files } = gather(dir, r.target.strat);
      if (!files.smFactions) return { error: `no ${REL.smFactions} in this mod — nothing to clone a faction from` };

      const entries = nf.listFactions(files.smFactions).map((f) => ({ faction: f }));
      const stratText = files.strat || "";
      const owners = stratText ? ft.settlementOwners(stratText) : {};
      const held = {};
      for (const o of Object.values(owners)) held[o.faction] = (held[o.faction] || 0) + 1;

      const donors = entries.map((e) => {
        const entry = nf.smEntry(files.smFactions, e.faction) || { lines: [] };
        const body = entry.lines.join("\n");
        const get = (k) => (body.match(new RegExp('"' + k + '"\\s*:?\\s*"([^"]+)"')) || [])[1] || null;
        return {
          faction: e.faction,
          culture: get("culture"),
          namelistMen: (body.match(/"men"\s*:?\s*"([^"]+)"/) || [])[1] || null,
          settlements: held[e.faction] || 0,
          inCampaign: !!stratText && new RegExp("^faction\\s+" + e.faction + "\\s*,", "m").test(stratText),
        };
      }).sort((a, b) => a.faction.localeCompare(b.faction));

      const missing = Object.keys(REL).filter((k) => k !== "edb" && k !== "namelists" && !files[k]);
      if (!files.winConditions) missing.push("descr_win_conditions.txt");

      log(`[new-faction] ${dir}: ${donors.length} factions, campaign ${r.target.name}` +
        (missing.length ? `; MISSING ${missing.join(", ")}` : "") +
        (donors.length >= FACTION_CAP ? `; AT/OVER the ${FACTION_CAP} ceiling` : ""));

      return {
        modDataDir: dir,
        campaign: r.target.name,
        campaigns: r.camps.map((c) => c.name),
        donors,
        count: donors.length,
        cap: FACTION_CAP,
        atCap: donors.length >= FACTION_CAP,
        missingFiles: missing,
        haveRecruitment: !!files.edb,
        paths,
      };
    } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  });

  // ── what a given donor offers: names, towns, recruitment ────────────────
  ipcMain.handle("new-faction-donor", async (_e, modDataDir, donor, campaign) => {
    try {
      const dir = modDataDir || getActiveModDataDir();
      if (!dir || !donor) return { error: "modDataDir and donor required" };
      const r = resolve(dir, campaign);
      if (r.error) return r;
      const { files } = gather(dir, r.target.strat);
      const entry = nf.smEntry(files.smFactions || "", donor);
      if (!entry) return { error: `${donor} has no entry in ${REL.smFactions}` };
      const body = entry.lines.join("\n");
      const pool = (body.match(/"men"\s*:?\s*"([^"]+)"/) || [])[1] || null;
      const poolWomen = (body.match(/"women"\s*:?\s*"([^"]+)"/) || [])[1] || null;
      const names = pool && files.namelists ? nf.readNamelist(files.namelists, pool) : [];

      const owners = files.strat ? ft.settlementOwners(files.strat) : {};
      const { coords, regionToCity } = mapCoords(dir);
      const settlements = Object.entries(owners).map(([region, o]) => ({
        region, city: regionToCity[region] || region, level: o.level, owner: o.faction,
        suggested: o.faction === donor,
        x: (coords[region] || {}).x ?? null, y: (coords[region] || {}).y ?? null,
      })).sort((a, b) => (b.suggested - a.suggested) || a.city.localeCompare(b.city));

      const recruit = files.edb ? nf.listRecruitOptions(files.edb, donor) : [];
      const aiLabel = (files.strat && (files.strat.match(new RegExp("^faction\\s+" + donor + "\\s*,\\s*(\\w+)", "m")) || [])[1]) || "ai_barbarian";

      return {
        donor,
        culture: (body.match(/"culture"\s*:?\s*"([^"]+)"/) || [])[1] || null,
        namelists: { men: pool, women: poolWomen },
        names,
        aiLabel,
        settlements,
        recruit: recruit.map((o) => ({ ...o })),
        recruitCount: recruit.length,
      };
    } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  });

  // ── create it ───────────────────────────────────────────────────────────
  // `choice.dryRun` runs the whole plan and writes nothing, which is what the
  // panel's preview uses — so what the user approves is what gets written.
  ipcMain.handle("new-faction-apply", async (_e, modDataDir, choice = {}) => {
    try {
      const dir = modDataDir || getActiveModDataDir();
      if (!dir) return { error: "no mod loaded" };
      const r = resolve(dir, choice.campaign);
      if (r.error) return r;
      const { paths, files } = gather(dir, r.target.strat);

      // 1. the scaffolding: a clone of the donor in every mandatory file
      const plan = nf.planNewFaction({
        files, donor: choice.donor, newId: choice.newId, displayName: choice.displayName,
        description: choice.description, culture: choice.culture, namelists: choice.namelists, colours: choice.colours,
      });
      if (plan.errors.length) return { error: plan.errors[0], warnings: plan.warnings };

      // 2. the campaign: declaration, a town, and the family the engine needs
      const { coords } = mapCoords(dir);
      const wanted = Array.isArray(choice.settlements) ? choice.settlements : [];
      const at = wanted.map((rg) => coords[rg]).find(Boolean) || null;
      const strat = nf.planFactionStratEntry({
        stratText: files.strat, newId: choice.newId, after: choice.donor,
        aiLabel: choice.aiLabel, settlements: wanted,
        leader: choice.leader, heir: choice.heir, at,
        denari: choice.denari ?? 5000, playable: !!choice.playable,
      });
      if (strat.errors.length) return { error: strat.errors[0], warnings: [...plan.warnings, ...strat.warnings] };

      // 3. recruitment, only where the user asked for it
      let rec = { text: files.edb, changed: 0 };
      if (files.edb && (choice.recruitLines || []).length) {
        rec = nf.planRecruitment({ edbText: files.edb, donor: choice.donor, newId: choice.newId, lines: choice.recruitLines });
      }

      const warnings = [...plan.warnings, ...strat.warnings];
      const count = nf.listFactions(files.smFactions).length;
      if (count >= FACTION_CAP) warnings.unshift(`this mod already declares ${count} factions — ${FACTION_CAP} is as far as the engine is known to go, and a ${count + 1}st may not load`);

      // resolve art sources before anything is written, so a preview reports
      // the same missing files the write would hit
      const roots = [dir, typeof getBaseGameDataDir === "function" ? getBaseGameDataDir() : null].filter(Boolean);
      const art = plan.artCopies.map((c) => {
        const from = resolveArt(c.from, roots);
        return { ...c, resolved: from, missing: !from };
      });
      for (const a of art.filter((x) => x.missing)) warnings.push(`art not found: ${a.from} — the new faction will fall back until it is supplied`);

      const summary = {
        ...plan.summary, strat: strat.summary, recruitChanged: rec.changed,
        art: art.length, artMissing: art.filter((a) => a.missing).length,
        files: [...Object.keys(plan.edits), "strat", ...(rec.changed ? ["edb"] : [])],
      };
      if (choice.dryRun) return { ok: true, dryRun: true, summary, warnings, art };

      // 4. write — every file through the one door, each with its own backup
      const exportDir = typeof getModExportDir === "function" ? getModExportDir() : null;
      const out = (p) => (exportDir && typeof modOut === "function" ? modOut(p) : p);
      const written = [];
      const edits = { ...plan.edits, strat: strat.text };
      if (rec.changed) edits.edb = rec.text;
      for (const [key, text] of Object.entries(edits)) {
        const p = paths[key];
        if (!p) continue;
        const w = safeWrite.safeWriteModFile(p, text, ENC[key] || "latin1", { outPath: out(p) });
        written.push({ key, path: w.path, exported: w.exported, backupStamp: w.backupStamp });
      }

      // 5. art, copied under the new faction's names (never overwriting)
      const copied = [];
      for (const a of art) {
        if (a.missing) continue;
        const dest = out(path.join(dir, a.to.replace(/^data[\\/]/i, "")));
        try {
          if (fs.existsSync(dest)) { copied.push({ to: a.to, skipped: "already there" }); continue; }
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(a.resolved, dest);
          copied.push({ to: a.to, from: a.resolved });
        } catch (e) { warnings.push(`could not copy ${a.to}: ${e.message}`); }
      }

      log(`[new-faction] created ${choice.newId} from ${choice.donor} in ${r.target.name}: ` +
        `${written.length} file(s), ${copied.length} art file(s), ${rec.changed} recruitment line(s), ` +
        `${strat.summary.settlements.length} settlement(s), leader ${strat.summary.leader}, heir ${strat.summary.heir}`);

      return { ok: true, summary, warnings, written, copied };
    } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  });
}

module.exports = { registerNewFactionHandlers, gather, FACTION_CAP };
