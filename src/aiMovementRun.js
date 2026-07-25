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
    // ── STRENGTH SCALE ─────────────────────────────────────────────────────────
    // What the AI DEMANDS of a campaign, against what it BELIEVES it has spare.
    //
    // BOTH SIDES MUST BE IN THE ENGINE'S OWN UNIT. An earlier version of this
    // compared the requirement against the save's SOLDIER COUNTS and reported a
    // 16x gap — wrong, because "strength" is a derived metric, not a headcount.
    // The engine's own `ltgd: army strength N, free army strength N` lines settle
    // it: across 124 pairable factions the strength/men ratio is p25 21.8,
    // median 32.7, p75 59.6, with 76% inside 2x of the median. Ptolemaic reports
    // 589,755 strength against 28,246 soldiers. The one coincidence that made the
    // old comparison look sound (an `allocated str 27,183` line sitting near
    // Ptolemaic's 28,246 men) was exactly that — a coincidence.
    //
    // So the comparison is requirement vs the AI's own FREE strength: what it
    // considers available for offence, which is the number it weighs against a
    // campaign's requirement.
    if (result.askDistribution && result.ltgdStrength) {
      const freeStrengthVals = Object.entries(result.ltgdStrength)
        .filter(([f, e]) => f !== "?" && e && e.avgFree > 0)
        .map(([, e]) => e.avgFree)
        .sort((a, b) => a - b);
      if (freeStrengthVals.length >= 20) {
        const q = (pp) => freeStrengthVals[Math.min(freeStrengthVals.length - 1, Math.floor(freeStrengthVals.length * pp))];
        const medianFree = q(0.5);
        const ask = result.askDistribution;
        // Headcounts are kept for context but clearly labelled as a DIFFERENT
        // unit, so nobody repeats the mistake of dividing one by the other.
        const menVals = Object.values(facts.menByFaction || {}).filter((n) => n > 0).sort((a, b) => a - b);
        result.strengthScale = {
          unit: "engine strength points (NOT men — roughly 33x a headcount)",
          askTargets: ask.targets, askMedian: ask.median, askP75: ask.p75, askP95: ask.p95, askMax: ask.max,
          factions: freeStrengthVals.length,
          freeMedian: medianFree, freeP25: q(0.25), freeP75: q(0.75), freeMax: freeStrengthVals[freeStrengthVals.length - 1],
          factionsAbleToMeetMedianAsk: freeStrengthVals.filter((n) => n >= ask.median).length,
          ratio: medianFree ? +(ask.median / medianFree).toFixed(2) : null,
          // context only, in a different unit
          menMedian: menVals.length ? menVals[Math.floor(menVals.length / 2)] : null,
          totalMen: menVals.reduce((a, b) => a + b, 0),
        };
        const S2 = result.strengthScale;
        _log(`[ai-movement] strength scale: median offensive requirement ${ask.median.toLocaleString()} vs median faction FREE strength ` +
          `${medianFree.toLocaleString()} (${S2.ratio}x) — ${S2.factionsAbleToMeetMedianAsk} of ${S2.factions} factions can meet it. ` +
          `Both figures are engine strength points, not men.`);
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
      // ── PROVENANCE FIRST: is this log paired with a save from the same moment? ──
      // Everything below cross-references the two, so the strength of that pairing
      // qualifies all of it. On the reference data the log covers turns 1-51 and the
      // save is turn 102 — the world had as long again to change as the log observed.
      try {
        const { logStartsAtCampaignStart, logSaveAlignment, sameCampaignCheck, provenanceLeads } = require("./aiProvenance.js");
        // Settlements per faction as the SAVE has them, for the same-campaign test.
        const saveCounts = {};
        for (const fx of Object.values(facts.ownerByCity || {})) {
          const k = String(fx).toLowerCase();
          saveCounts[k] = (saveCounts[k] || 0) + 1;
        }
        const same = sameCampaignCheck({ factionHealth: result.factionHealth, saveCounts });
        const startsAt = logStartsAtCampaignStart({ factionHealth: result.factionHealth, startCounts });
        const alignment = logSaveAlignment({
          logTurns: result.totalTurns,
          saveTurn: save && save.turn,
          startsAtTurn1: !!(startsAt && startsAt.startsAtTurn1),
        });
        if (alignment) {
          result.provenance = { ...alignment, opening: startsAt, sameCampaign: same };
          // Held rather than unshifted here: the expansion lead below ALSO unshifts
          // itself, so anything placed first now gets displaced. Applied after every
          // other lead source, because a caveat that appears below the finding it
          // qualifies has already failed at its job.
          result._provenanceLeads = provenanceLeads(alignment, same);
          _log(`[ai-movement] provenance: log turns 1-${alignment.logTurns}, save turn ${alignment.saveTurn}, ` +
            `gap ${alignment.gapTurns}, confidence ${alignment.confidence}` +
            (startsAt ? ` (opening state matched ${startsAt.matched}/${startsAt.compared} factions)` : ""));
        }
      } catch (e) { _log(`[ai-movement] provenance check skipped: ${e && e.message}`); }

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

      // ── WORLD-LEVEL: how far the AI's demands sit above its spare strength ──
      // Reported as a proportion, in the engine's own unit, with the share of
      // factions that fall short. An earlier version of this claimed a 16x gap by
      // dividing strength points by soldier counts; that was a unit error.
      if (result.strengthScale && result.strengthScale.factions >= 20) {
        const S = result.strengthScale;
        const shortPct = Math.round((1 - S.factionsAbleToMeetMedianAsk / S.factions) * 100);
        // Only worth a lead when most factions genuinely fall short. A requirement
        // the majority can meet is not a structural problem.
        if (shortPct >= 50) {
          result.modLeads.unshift({
            severity: 3,
            faction: "all (map scale)",
            file: "descr_strat.txt (starting armies) + export_descr_buildings.txt (recruitment)",
            key: `median requirement ${S.askMedian.toLocaleString()} vs median free strength ${S.freeMedian.toLocaleString()}`,
            issue:
              `${shortPct}% OF FACTIONS CANNOT MEET A TYPICAL CAMPAIGN'S REQUIREMENT. Across ${S.askTargets.toLocaleString()} targets the median ` +
              `offensive requirement is ${S.askMedian.toLocaleString()} strength; the median faction reports ${S.freeMedian.toLocaleString()} FREE strength ` +
              `(${S.ratio}x). Only ${S.factionsAbleToMeetMedianAsk} of ${S.factions} factions clear it, and the lower quartile sits at ${S.freeP25.toLocaleString()}.`,
            suggestion:
              `The requirement is not absurd — it is close to what a typical faction has spare — so the gap is closable, which the earlier ` +
              `framing of this finding wrongly suggested it was not. The levers are thicker starting forces in descr_strat.txt and faster access to ` +
              `mid-tier troops (the mic ladder's settlement_min gates in export_descr_buildings.txt). Re-measure this ratio afterwards; the ` +
              `before/after tab compares two runs per-turn.`,
            evidence:
              `requirement median ${S.askMedian.toLocaleString()} / p75 ${S.askP75.toLocaleString()} / p95 ${S.askP95.toLocaleString()} · ` +
              `free strength p25 ${S.freeP25.toLocaleString()} / median ${S.freeMedian.toLocaleString()} / p75 ${S.freeP75.toLocaleString()} / max ${S.freeMax.toLocaleString()} · ` +
              `BOTH in engine strength points, taken from the AI's own \`ltgd: free army strength\` reports — NOT soldier counts, which run about 33x smaller · ` +
              `defensive (ACS_DEFEND_*) postures excluded from the requirement, since those read as frontier totals` +
              (S.askByDefenders
                ? ` · median requirement by defending units: ` + S.askByDefenders.map((b) => `${b.lo}-${b.hi === null ? "+" : b.hi}→${b.medianAsk.toLocaleString()}`).join(", ")
                : ``),
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
        // FAILED CONSOLE COMMANDS — the campaign script's own commands, rejected by
        // the engine. These arrive in the AI log because the console shares the file,
        // and they are the only findings here that name a script LINE, so they are
        // worth resolving even though nothing else in this path is script-related.
        try {
          const { auditFailedConsoleCommands } = require("./aiScriptAudit.js");
          const scriptPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "RIS_Campaign_Script.txt");
          let campaignScript = null;
          try { campaignScript = fs.readFileSync(scriptPath, "latin1"); } catch { /* no script → no lead, by design */ }
          const cl = auditFailedConsoleCommands({ failures: result.failedConsoleCommands, campaignScript });
          if (cl.length) {
            result.modLeads = result.modLeads.concat(cl);
            _log(`[ai-movement] failed console commands: ${cl.length} lead(s) from ${(result.failedConsoleCommands || []).length} distinct command(s)`);
          }
        } catch (e) { _log(`[ai-movement] console-command audit skipped: ${e && e.message}`); }

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

    // LAST, so nothing can displace it: if the log and save describe different
    // moments, that caveat belongs above every finding that pairs the two.
    if (result._provenanceLeads && result._provenanceLeads.length) {
      result.modLeads = result._provenanceLeads.concat(result.modLeads || []);
    }
    delete result._provenanceLeads;
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
  // Set when a compressed log was unpacked to a temp dir, so it can be removed
  // however the run ends — a 107MB extract must not be left behind.
  let unpacked = null;
  try {
    // The file picker stays on the main thread (Electron isn't available in a
    // worker), so the caller always hands us a resolved path.
    let p = logPath;
    if (!p) return { error: "no log path supplied" };
    if (!fs.existsSync(p)) return { error: "log not found: " + p };
    // The crash reporter ships its campaign_ai_log extract as .txt.xz — that is the
    // only way a 330MB log fits an attachment. Unpack it here so a report can be
    // dropped straight in, instead of stopping one step short and asking the user
    // to find a 7-Zip first. .gz uses Node's zlib; .xz uses the Python runtime
    // Provincia already bundles (Node has no xz).
    if (unpacked === null && /\.(gz|xz|lzma)$/i.test(p)) {
      const { openMaybeCompressed } = require("./logDecompress.js");
      _prog("log", "unpacking the compressed log");
      const got = openMaybeCompressed(p, { log: _log });
      if (got.error) return { error: got.error };
      if (got.pending) await got.pending;      // the .gz path streams
      unpacked = got.temp;
      p = got.path;
      _log(`[ai-movement] unpacked ${path.basename(logPath)} -> ${path.basename(p)}`);
    }
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
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  } finally {
    if (unpacked) { require("./logDecompress.js").cleanup(unpacked); _log(`[ai-movement] removed the unpacked temp copy`); }
  }
}
module.exports = { runAiMovementAnalysis };
