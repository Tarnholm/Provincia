// AI Movement analysis pipeline (2026-07-25) — extracted from the IPC handler
// so it can run inside src/saveCrackWorker.js instead of on the Electron main
// thread. Cracking the 45MB reference save takes ~12s and streaming a 346MB
// campaign_ai_log another ~1.7s; doing that on the main thread froze the whole
// UI (mouse included) for the duration — the user hit exactly that. Everything
// here is self-contained (paths in, plain object out), which is what makes it
// safe to move to a worker.
//
// Returns the finished analysis result, plus `logs` (diagnostic lines the
// caller replays into provincia.log, since a worker's console isn't captured).
"use strict";
const fs = require("fs");
const path = require("path");
async function _correlateSave(result, savePath, modDataDir, _log, _prog) {
  if (!savePath) return;
  // Nothing was parsed out of the log → a banner of zeroes would read as
  // "all clear" rather than "no data". Skip it and let the panel explain.
  if (result.usable === false) return;
  try {
    if (!fs.existsSync(savePath)) { result.saveError = "save not found: " + savePath; return; }
    const { crackSave } = require("./saveCracker.js");
    const { correlateWithSave, buildSaveFacts } = require("./aiMovementAnalyzer.js");
    const t0 = Date.now();
    if (_prog) _prog("save", "reading the save file");
    const save = crackSave(await fs.promises.readFile(savePath), modDataDir || null, {});
    // settlement → region name, so "did they reach the target's region?" works
    let regionOfSettlement = {};
    try {
      const dg = require("./descrStratGeneral.js");
      const { regionToCity } = dg.parseDescrRegions(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "utf8"));
      for (const [region, city] of Object.entries(regionToCity || {})) if (city) regionOfSettlement[city] = region;
    } catch { /* verdicts still work off ownerByCity alone */ }
    const facts = buildSaveFacts(save, regionOfSettlement);
    result.findings = correlateWithSave(result.findings, facts);
    result.save = {
      path: savePath, turn: facts.turn,
      navalWorld: facts.navalWorld, sieges: facts.sieges,
      factionsWithUnits: Object.keys(facts.unitsByFaction).length,
      ms: Date.now() - t0,
    };
    // headline counts the user cares about
    const sm = result.findings.filter((f) => /NEVER arrived/.test(f.verdict || ""));
    const imp = result.findings.filter((f) => f.impossible);
    result.save.confirmedNeverArrived = sm.length;
    result.save.impossibleCampaigns = imp.length;
    result.save.orphanedArmies = result.findings.filter((f) => f.orphaned).length;
    // ── STRENGTH SCALE ────────────────────────────────────────────────────────
    // The single most structural number in the whole analysis: what the AI asks
    // for, against what the factions on this map can actually field. Per-faction
    // leads can only ever say "this one is poor"; this says whether the
    // requirements suit the states that exist at all.
    //
    // Both sides are men-equivalent — cross-checked on the reference data, where
    // the log's `allocated str 27,183` lines up with Ptolemaic's 28,246 soldiers
    // in the save, and unit sizes there are a sane 64 men at the median.
    if (result.askDistribution) {
      const menVals = Object.values(facts.menByFaction || {}).filter((n) => n > 0).sort((a, b) => a - b);
      if (menVals.length) {
        const q = (pp) => menVals[Math.min(menVals.length - 1, Math.floor(menVals.length * pp))];
        const medianMen = q(0.5);
        const ask = result.askDistribution;
        result.strengthScale = {
          askTargets: ask.targets, askMedian: ask.median, askP75: ask.p75, askP95: ask.p95, askMax: ask.max,
          factions: menVals.length,
          menMedian: medianMen, menP75: q(0.75), menMax: menVals[menVals.length - 1],
          totalMen: menVals.reduce((a, b) => a + b, 0),
          // how many factions could field the MEDIAN ask at all
          factionsAbleToMeetMedianAsk: menVals.filter((n) => n >= ask.median).length,
          ratio: medianMen ? +(ask.median / medianMen).toFixed(1) : null,
        };
        _log(`[ai-movement] strength scale: median offensive ask ${ask.median.toLocaleString()} vs median faction ${medianMen.toLocaleString()} men ` +
          `(${result.strengthScale.ratio}×); only ${result.strengthScale.factionsAbleToMeetMedianAsk} of ${menVals.length} factions could field the median ask`);
      }
    }

    // ── DID THE AI ACTUALLY GET ANYWHERE? ─────────────────────────────────────
    // Everything else in the Lab measures attempts. This measures the outcome, by
    // comparing descr_strat's starting ownership against the save's.
    try {
      const { expansionReport } = require("./aiExpansion.js");
      const gv3 = require("./growthEval.js");
      const st = gv3.parseStrat(path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"));
      const startCounts = {};
      for (const [fac, v] of Object.entries(st || {})) {
        const n = (v && v.settlements ? v.settlements.length : 0);
        if (n) startCounts[String(fac).toLowerCase()] = n;
      }
      const exp = expansionReport({ startCounts, nowOwnerByCity: facts.ownerByCity });
      if (exp) {
        result.expansion = exp;
        _log(`[ai-movement] expansion: independents ${exp.rebelBefore}→${exp.rebelAfter} (${exp.rebelDelta >= 0 ? "+" : ""}${exp.rebelDelta}), ` +
          `${exp.factions} real factions net ${exp.netNonRebel >= 0 ? "+" : ""}${exp.netNonRebel}, ${exp.wipedOut} wiped out` +
          (exp.comparable ? "" : ` — NOT COMPARABLE (${exp.divergencePct}% count divergence)`));
      }
    } catch (e) { result.expansionError = e && e.message ? e.message : String(e); }

    // Mod-file audit: turn the findings into file-level leads (which file, which
    // key, what to change) using the AI-relevant mod files the user named.
    try {
      const { auditModFiles } = require("./aiModFileAudit.js");
      if (_prog) _prog("audit", "auditing the mod files");
      const rd = (rel, enc) => { try { return fs.readFileSync(path.join(modDataDir, rel), enc || "latin1"); } catch { return null; } };
      // Resource endowment per faction (descr_sm_resources trade values ×
      // descr_strat resource placements), via the app's verified parsers.
      let resourceWealth = {};
      try {
        const { factionResourceWealth } = require("./aiModFileAudit.js");
        const im = require("./incomeModel.js");
        const gv = require("./growthEval.js");
        resourceWealth = factionResourceWealth({
          ownerByCity: facts.ownerByCity,
          regionOfSettlement: regionOfSettlement,
          resourceValues: im.parseResourceValues(modDataDir) || {},
          resourcesByRegion: gv.parseResources(path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt")) || {},
        });
      } catch { /* leads still work without resource evidence */ }
      // Farm endowment per faction — explains WHY its settlements stay small,
      // which is the upstream cause of the settlement-tier lock.
      let farmWealth = {};
      try {
        const { factionFarmWealth } = require("./aiModFileAudit.js");
        const gv2 = require("./growthEval.js");
        const { byRegion } = gv2.parseRegions(modDataDir);
        const farmByRegion = {};
        for (const [reg, r] of Object.entries(byRegion || {})) if (r && r.farmN != null) farmByRegion[reg] = r.farmN;
        farmWealth = factionFarmWealth({ ownerByCity: facts.ownerByCity, regionOfSettlement, farmByRegion });
      } catch { /* leads still work without farm evidence */ }
      const audit = auditModFiles({
        farmWealth,
        findings: result.findings,
        saveFacts: facts,
        resourceWealth,
        economy: result.economy || {},
        buildAppetite: result.buildAppetite || {},
        files: {
          aiPersonality: rd("feral_descr_ai_personality.txt"),
          strat: rd(path.join("world", "maps", "campaign", "imperial_campaign", "descr_strat.txt")),
          smFactions: rd("descr_sm_factions.txt"),
          edu: rd("export_descr_unit.txt"),
          edb: rd("export_descr_buildings.txt"),
          character: rd("descr_character.txt"),
        },
      });
      result.modLeads = audit.leads;
      result.factionProfiles = audit.factions;

      // ── WORLD-LEVEL: the strength-scale mismatch ────────────────────────────
      // Put first because it reframes every per-faction lead below it. If almost
      // no faction on the map could field the median requirement, then "this
      // faction is poor" is a symptom of the map's shape, not of that faction.
      if (result.strengthScale && result.strengthScale.factions > 20) {
        const S = result.strengthScale;
        const ableePct = Math.round((S.factionsAbleToMeetMedianAsk / S.factions) * 100);
        // Only raise it when the gap is large AND few factions can meet it —
        // a 4x gap that most factions clear anyway is not a structural problem.
        if (S.ratio >= 4 && ableePct <= 25) {
          result.modLeads.unshift({
            severity: 3,
            faction: "all (map scale)",
            file: "descr_strat.txt (faction count / starting armies)",
            key: `median ask ${S.askMedian.toLocaleString()} vs median faction ${S.menMedian.toLocaleString()} men`,
            issue:
              `THE REQUIREMENTS DO NOT FIT THIS MAP. Across ${S.askTargets.toLocaleString()} targets the AI's median offensive requirement is ` +
              `${S.askMedian.toLocaleString()} men, but the median faction fields ${S.menMedian.toLocaleString()} — a factor of ${S.ratio}. ` +
              `Only ${S.factionsAbleToMeetMedianAsk} of ${S.factions} factions could field the median requirement at all, and it is ` +
              `${((S.askMedian / S.totalMen) * 100).toFixed(1)}% of every soldier on the map.`,
            suggestion:
              `This is the structural reason campaigns gather forever and never launch, and it sits upstream of every per-faction lead below. ` +
              `The requirement itself is computed by the engine, so the levers are on this side: fewer and larger factions, or substantially ` +
              `thicker starting forces in descr_strat.txt. Raising one small faction's economy cannot close a ${S.ratio}× gap.`,
            evidence:
              `ask percentiles median ${S.askMedian.toLocaleString()} / p75 ${S.askP75.toLocaleString()} / p95 ${S.askP95.toLocaleString()} · ` +
              `faction men median ${S.menMedian.toLocaleString()} / p75 ${S.menP75.toLocaleString()} / max ${S.menMax.toLocaleString()} · ` +
              `${S.totalMen.toLocaleString()} men total across ${S.factions} factions · defensive (ACS_DEFEND_*) postures excluded from the ask, ` +
              `since those read as frontier totals rather than one stack`,
          });
        }
      }

      // Inserted AFTER the scale lead so it lands ABOVE it: "conquest is not
      // working" is the observation a reader should meet first, and the strength
      // gap immediately below is the explanation for it.
      try {
        const { expansionLeads } = require("./aiExpansion.js");
        const el = expansionLeads(result.expansion);
        if (el.length) result.modLeads = el.concat(result.modLeads);
      } catch { /* the report still stands without a lead */ }
      // ── map_ground_types.tga: can the ground the AI is ordered across even be
      // walked? The other files say whether a faction CAN raise the troops; this
      // one says whether the route exists. Annotates movement findings with the
      // target region's terrain and adds leads where failures cluster on ground
      // far harder than the map's own median.
      try {
        if (_prog) _prog("audit", "reading map_ground_types.tga");
        const { regionTerrain, terrainLeads } = require("./aiTerrainAudit.js");
        const dg2 = require("./descrStratGeneral.js");
        const parsers2 = await import("./parsers.js"); // ESM
        const base = path.join(modDataDir, "world", "maps", "base");
        const groundTga = dg2.tgaToRaw(fs.readFileSync(path.join(base, "map_ground_types.tga")));
        const regionTga = dg2.tgaToRaw(fs.readFileSync(path.join(base, "map_regions.tga")));
        const rmap = parsers2.parseDescrRegions(fs.readFileSync(path.join(base, "descr_regions.txt"), "latin1"));
        const colToRegion = {};
        for (const [rgbKey, v] of Object.entries(rmap || {})) if (v && v.region) colToRegion[rgbKey] = v.region;
        const terrain = regionTerrain({ groundTga, regionTga, colToRegion });
        if (terrain) {
          const tl = terrainLeads({ findings: result.findings, terrain, regionOfSettlement });
          result.modLeads = result.modLeads.concat(tl.leads);
          result.terrainWorld = terrain.world;
          if (terrain.unknownColours.length) result.terrainUnknownColours = terrain.unknownColours.slice(0, 8);
          _log(`[ai-movement] terrain: ${terrain.world.regions} regions, median difficulty ${terrain.world.medianDifficulty}%, ${tl.annotated} findings annotated, ${tl.leads.length} leads`);
        }
        // LAND REACHABILITY — the definitive version of the same question. A
        // flood fill over walkable ground says whether a route exists at all,
        // and the save falsifies the model if it is wrong about this map.
        const { landComponents, reachabilityVerdicts } = require("./aiTerrainAudit.js");
        const comps = landComponents({ groundTga, regionTga, colToRegion });
        if (comps) {
          // Starting admirals come from descr_strat.txt, NOT from the save: naval
          // units in the save carry no faction, so a save-derived per-faction ship
          // count is all "?" and would assert nothing (see navalFactionKnown).
          let startingAdmirals = null;
          try {
            const { parseStratFactions } = require("./aiModFileAudit.js");
            const stratTxt = rd(path.join("world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"));
            if (stratTxt) {
              startingAdmirals = {};
              for (const [fac, v] of Object.entries(parseStratFactions(stratTxt) || {})) {
                startingAdmirals[String(fac).toLowerCase()] = v.admirals || 0;
              }
            }
          } catch { /* the verdict simply omits the naval clause */ }

          const rv = reachabilityVerdicts({
            findings: result.findings, components: comps,
            ownerByCity: facts.ownerByCity, regionOfSettlement,
            startingAdmirals,
            unitsByFactionRegion: facts.unitsByFactionRegion || null,
          });
          result.reachability = {
            components: comps.components, mainlandRegions: comps.mainlandRegions,
            walkablePx: comps.walkablePx, verdicts: rv.verdicts,
            reliable: rv.reliable, contradictions: rv.contradictions.length,
            excludedFactions: rv.excluded.length,
            // how many (faction, region) pairs the falsifier actually examined —
            // "found nothing" and "looked at nothing" must not read the same
            falsifierTested: rv.tested,
            navalFactionKnown: facts.navalFactionKnown,
          };
          // Leads are published per surviving faction — a model that is wrong
          // about one strait is not thereby wrong about Britain.
          result.modLeads = result.modLeads.concat(rv.leads);
          _log(`[ai-movement] reachability: ${comps.components} land components (mainland holds ${comps.mainlandRegions} regions), ` +
            `${rv.verdicts} orders proven to have NO land route, ${rv.leads.length} leads; ` +
            `falsifier examined ${rv.tested} (faction, region) pair(s)` +
            (rv.excluded.length ? ` and EXCLUDED ${rv.excluded.length} faction(s): ${rv.excluded.slice(0, 5).join(", ")}` : " with no contradictions"));
        }
      } catch (e) { result.terrainError = e && e.message ? e.message : String(e); }
      _log(`[ai-movement] mod-file audit: ${audit.leads.length} leads across ${Object.keys(audit.factions).length} factions`);
    } catch (e) { result.auditError = e && e.message ? e.message : String(e); }
    _log(`[ai-movement] correlated with ${path.basename(savePath)} (turn ${facts.turn}): ${sm.length} confirmed-never-arrived, ${imp.length} impossible campaigns, ${result.save.orphanedArmies} orphaned armies, in ${result.save.ms}ms`);
  } catch (e) {
    result.saveError = e && e.message ? e.message : String(e);
  }
}
// IPC: AI Movement Analyzer (2026-07-24) — parse a message_log.txt (live dir,
// archived, or downloaded from the RIS Discord telemetry) into per-army
// movement traces + pathing pathology findings (stuck / oscillation /
// never-arrives / flee-loop), for tuning the mod's AI. Pure analysis lives in
// src/aiMovementAnalyzer.js; this handler adds file access, an Open-dialog
// when no path is given, and strat-tile → region-name mapping so findings say
// "near Roma", not "(283,402)".
async function runAiMovementAnalysis({ logPath, modDataDir, savePath }, onProgress) {
  const _logs = [];
  const _log = (line) => { try { _logs.push(String(line)); } catch { /* never throw from logging */ } };
  // Progress is advisory only — the analysis must never fail because a
  // progress consumer threw or wasn't supplied.
  const _prog = (phase, detail) => { try { if (onProgress) onProgress({ phase, detail }); } catch { /* ignore */ } };
  try {
    // The file picker stays on the main thread (Electron isn't available in a
    // worker), so the caller always hands us a resolved path.
    const p = logPath;
    if (!p) return { error: "no log path supplied" };
    if (!fs.existsSync(p)) return { error: "log not found: " + p };
    // ── campaign_ai_log? (decision log, can be 300MB+ telemetry) → STREAM ──
    // Detect by content, not filename: read the first 4KB and look for the
    // engine's own banner / "AI:" prefix density.
    {
      const fd = fs.openSync(p, "r");
      const head = Buffer.alloc(4096);
      const n = fs.readSync(fd, head, 0, 4096, 0);
      fs.closeSync(fd);
      const headStr = head.slice(0, n).toString("latin1");
      // ── scripting_log.txt? → the engine's own parse/runtime complaints about
      // the mod's data files. Highest-confidence signal in the Lab: every entry
      // names a file and a line, so nothing has to be inferred. Detected by the
      // two line shapes that only this log produces.
      const isScriptLog = /^\s*Script Error in /m.test(headStr) ||
        /^\s*\([^)]*\.txt::\d+\) Executing command /m.test(headStr);
      if (isScriptLog) {
        _prog("log", "streaming the scripting log");
        const readline = require("readline");
        const { createScriptLogAnalyzer } = require("./aiMovementAnalyzer.js");
        const an = createScriptLogAnalyzer();
        const t0 = Date.now();
        await new Promise((resolve, reject) => {
          const rl = readline.createInterface({ input: fs.createReadStream(p, { encoding: "latin1" }), crlfDelay: Infinity });
          let _n = 0;
          rl.on("line", (line) => {
            an.feedLine(line);
            if ((++_n % 250000) === 0) _prog("log", "reading the scripting log - " + _n.toLocaleString() + " lines");
          });
          rl.on("close", resolve);
          rl.on("error", reject);
        });
        const result = an.finish();
        result.ms = Date.now() - t0;
        result.logPath = p;
        result.logBytes = fs.statSync(p).size;
        // Cross-check the errors against the mod files so each one arrives with
        // a resolved fix where the files can prove it. No save needed — these
        // are static data-file bugs, not behaviour.
        try {
          if (modDataDir) {
            _prog("audit", "resolving the errors against the mod files");
            const { auditScriptErrors } = require("./aiScriptAudit.js");
            const rd = (rel) => { try { return fs.readFileSync(path.join(modDataDir, rel), "latin1"); } catch { return null; } };
            const audit = auditScriptErrors({
              findings: result.findings,
              files: {
                senate: rd("descr_senate.txt"),
                formationsAi: rd("descr_formations_ai.txt"),
                traits: rd("export_descr_character_traits.txt"),
              },
            });
            result.modLeads = audit.leads;
            _log(`[ai-movement] script audit: ${audit.leads.length} leads from ${result.findings.length} engine errors`);
          }
        } catch (e) { result.auditError = e && e.message ? e.message : String(e); }
        _log(`[ai-movement] ${path.basename(p)} (scripting): ${result.lines.toLocaleString()} lines, ${result.findings.length} engine errors in ${result.ms}ms`);
        return result;
      }
      const isAiLog = headStr.includes("campaign ai log start") ||
        (headStr.match(/^AI:/gm) || []).length > 5;
      if (isAiLog) {
        _prog("log", "streaming the AI decision log");
        const readline = require("readline");
        const { createAiDecisionAnalyzer } = require("./aiMovementAnalyzer.js");
        const an = createAiDecisionAnalyzer();
        const t0 = Date.now();
        await new Promise((resolve, reject) => {
          const rl = readline.createInterface({ input: fs.createReadStream(p, { encoding: "latin1" }), crlfDelay: Infinity });
          let _n = 0;
          rl.on("line", (line) => {
            an.feedLine(line);
            // one update per 250k lines keeps the channel quiet on a 4M-line log
            if ((++_n % 250000) === 0) _prog("log", "reading the AI log - " + _n.toLocaleString() + " lines");
          });
          rl.on("close", resolve);
          rl.on("error", reject);
        });
        const result = an.finish();
        result.ms = Date.now() - t0;
        result.logPath = p;
        result.logBytes = fs.statSync(p).size;
        _prog("save", "cross-referencing the save (the slow part)");
    await _correlateSave(result, savePath, modDataDir, _log, _prog);
        _log(`[ai-movement] ${path.basename(p)} (campaign_ai, ${(result.logBytes / 1048576).toFixed(0)}MB): ${result.lines.toLocaleString()} lines, ${result.findings.length} findings in ${result.ms}ms`);
        return result;
      }
    }
    _prog("log", "reading the movement log");
    const text = await fs.promises.readFile(p, "utf8");
    // strat tile → region name: map_regions pixel (x, H-1-y), RLE-safe reader.
    let regionAt = null;
    try {
      if (modDataDir) {
        const dg = require("./descrStratGeneral.js");
        const parsers = await import("./parsers.js"); // ESM (same pattern as startingArmiesBuilder)
        const tga = dg.tgaToRaw(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "map_regions.tga")));
        const regionsMap = parsers.parseDescrRegions(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "latin1"));
        const colToRegion = {};
        for (const [rgbKey, r] of Object.entries(regionsMap || {})) {
          if (r && r.region) colToRegion[rgbKey] = r.region;
        }
        const topDown = (tga.desc & 0x20) !== 0;
        regionAt = (sx, sy) => {
          const by = topDown ? sy : (tga.H - 1 - sy);
          if (sx < 0 || sx >= tga.W || by < 0 || by >= tga.H) return null;
          // spiral out a little: army tiles are often ON black settlement px
          for (let rad = 0; rad <= 2; rad++) {
            for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
              const nx = sx + dx, ny = by + dy;
              if (nx < 0 || nx >= tga.W || ny < 0 || ny >= tga.H) continue;
              const i = (ny * tga.W + nx) * 3;
              const key = tga.raw[i + 2] + "," + tga.raw[i + 1] + "," + tga.raw[i];
              const reg = colToRegion[key];
              if (reg) return reg;
            }
          }
          return null;
        };
      }
    } catch { /* findings still useful without region names */ }
    const { analyzeMovementLog } = require("./aiMovementAnalyzer.js");
    const t0 = Date.now();
    const result = analyzeMovementLog(text, { regionAt });
    result.ms = Date.now() - t0;
    result.logPath = p;
    result.logBytes = Buffer.byteLength(text);
    await _correlateSave(result, savePath, modDataDir, _log);
    _log(`[ai-movement] ${path.basename(p)}: ${result.moveLines} moves, ${result.armies} armies, ${result.findings.length} findings in ${result.ms}ms`);
    return result;
  } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
}
module.exports = { runAiMovementAnalysis };
