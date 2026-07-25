// @vitest-environment node
//
// END-TO-END guard for the AI Movement Lab, run against the REAL reference
// files the user supplied (a 346MB campaign_ai_log.txt and a 44MB turn-102
// save) through the ACTUAL production path: src/saveCrackWorker.js in a real
// worker thread.
//
// WHY THIS EXISTS
// ---------------
// v0.9.1417 moved the analysis into a worker for responsiveness, but left a
// `require("electron")` (the file picker) inside the extracted module. A worker
// has no Electron bindings, so the packaged app answered every analysis with
// "Cannot find module 'electron'". Unit tests passed — they imported the pure
// analyser directly and never went through the worker. Only exercising the real
// worker with real files catches that class of bug (module resolution, payload
// shape, structured-clone limits, worker-unsafe requires).
//
// It also pins the real-data numbers, so a parser regression that silently
// stops finding things fails here instead of shipping.
//
// SKIPS CLEANLY when the reference files aren't on this machine (other devs,
// CI) — the assertions only run where the data exists.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(__dirname, "saveCrackWorker.js");

const REF_DIR = "C:/dev/log test files";
const REF_LOG = path.join(REF_DIR, "campaign_ai_log.txt");
const REF_SAVE = path.join(REF_DIR, "save_Autosave   Dummies   Turn 102 Start.sav");
const MOD_DIR = "C:/RIS/RIS/data";
const haveRefs = fs.existsSync(REF_LOG) && fs.existsSync(REF_SAVE) && fs.existsSync(MOD_DIR);

function runWorker(payload, timeoutMs = 120000, collectProgress = null) {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER);
    const timer = setTimeout(() => { w.terminate(); reject(new Error("worker timed out")); }, timeoutMs);
    w.on("message", (msg) => {
      // advisory progress notes arrive before the final reply and must not settle it
      if (msg && msg.progress) { if (collectProgress) collectProgress.push(msg.progress); return; }
      clearTimeout(timer); w.terminate(); resolve(msg);
    });
    w.once("error", (err) => { clearTimeout(timer); w.terminate(); reject(err); });
    w.postMessage(payload);
  });
}

describe("AI Movement Lab — real log + save through the real worker", () => {
  it.runIf(haveRefs)("analyses the 346MB AI log + turn-102 save without any worker-unsafe require", async () => {
    const msg = await runWorker({
      mode: "aiMovement",
      logPath: REF_LOG,
      modDataDir: MOD_DIR,
      savePath: REF_SAVE,
    });

    // The exact failure mode that shipped in 1417: the worker rejected because
    // the module chain pulled in Electron. Assert the worker SUCCEEDED first,
    // surfacing its error message if not.
    expect(msg.ok, `worker failed: ${msg.error}`).toBe(true);
    const r = msg.result;
    expect(r.error, `analysis returned an error: ${r.error}`).toBeUndefined();

    // ── log side (campaign_ai_log) ──
    expect(r.logKind).toBe("campaign_ai");
    expect(r.usable).toBe(true);
    expect(r.emptyReason).toBeNull();
    expect(r.totalTurns).toBeGreaterThan(40);         // 51 turn blocks
    expect(r.lines).toBeGreaterThan(4_000_000);       // 4.39M lines
    expect(r.findings.length).toBeGreaterThan(4000);  // 5592
    for (const kind of ["stuck_mission", "assign_churn", "campaign_stall", "aborted_hotspot", "abandoned", "rich_but_stalled"]) {
      expect(r.findingCounts[kind], `expected ${kind} findings`).toBeGreaterThan(0);
    }

    // ── save cross-reference ──
    expect(r.save, "save cross-reference missing").toBeTruthy();
    expect(r.save.turn).toBe(102);
    expect(r.save.confirmedNeverArrived).toBeGreaterThan(500);  // 1207
    expect(r.save.impossibleCampaigns).toBeGreaterThan(200);    // 402
    expect(r.save.orphanedArmies).toBeGreaterThan(500);         // 1140

    // ── mod-file audit ──
    expect(r.modLeads.length).toBeGreaterThan(200);             // 677
    const files = new Set(r.modLeads.map((l) => l.file));
    // leads must point at real, editable mod files
    expect([...files].some((f) => f.includes("feral_descr_ai_personality.txt"))).toBe(true);
    expect([...files].some((f) => f.includes("descr_strat.txt"))).toBe(true);

    // ── map_ground_types.tga ──
    // The palette must cover the whole file (it does: exactly 14 colours on the
    // RIS map), and mission targets must resolve THROUGH the settlement→region
    // map — keyed by region alone only 15 of 6,399 findings resolve.
    expect(r.terrainError).toBeUndefined();
    expect(r.terrainWorld.regions).toBe(1311);
    expect(r.terrainWorld.scale).toBeCloseTo(2, 1);   // 2041×1401 vs 1020×700
    expect(r.terrainUnknownColours).toBeUndefined();  // 100% palette coverage
    expect(r.findings.filter((f) => f.terrain).length).toBeGreaterThan(1000);
    const terr = r.modLeads.filter((l) => l.file === "map_ground_types.tga");
    expect(terr.length).toBeGreaterThan(5);
    for (const l of terr) {
      expect(l.evidence).toMatch(/land px/);          // always show the sample size
      expect(l.faction).not.toBe("?");                // never a bare "?" bucket
    }
    // every annotated difficulty must be a real 0-100 score
    for (const f of r.findings) {
      if (!f.terrain) continue;
      expect(f.terrain.difficulty).toBeGreaterThanOrEqual(0);
      expect(f.terrain.difficulty).toBeLessThanOrEqual(100);
    }

    // ── STRENGTH SCALE ──
    // The most structural number the Lab produces: what the AI demands against
    // what the map's factions can field. Both sides must be men-equivalent, which
    // is why the log's allocated-strength values line up with the save's soldier
    // counts (alloc 27,183 vs Ptolemaic's 28,246).
    expect(r.askDistribution).toBeTruthy();
    expect(r.askDistribution.targets).toBeGreaterThan(500);        // 1,117
    expect(r.strengthScale).toBeTruthy();
    expect(r.strengthScale.askMedian).toBeGreaterThan(5000);       // 23,902
    expect(r.strengthScale.menMedian).toBeGreaterThan(100);        // 1,480 — sane, not a broken parse
    expect(r.strengthScale.menMedian).toBeLessThan(20000);
    expect(r.strengthScale.totalMen).toBeGreaterThan(100000);      // 443,099
    expect(r.strengthScale.factions).toBeGreaterThan(50);          // 125
    expect(r.strengthScale.ratio).toBeGreaterThan(4);              // 16.1x
    // only a handful of factions can meet the median ask — that IS the finding
    expect(r.strengthScale.factionsAbleToMeetMedianAsk).toBeLessThan(r.strengthScale.factions * 0.25);
    // it must be the FIRST lead, since it reframes all the per-faction ones
    expect(r.modLeads[0].faction).toBe("all (map scale)");
    expect(r.modLeads[0].issue).toMatch(/THE REQUIREMENTS DO NOT FIT THIS MAP/);
    expect(r.modLeads[0].evidence).toMatch(/ACS_DEFEND_\*\) postures excluded/);

    // ── LAND REACHABILITY ──
    // The flood fill must reproduce real geography: one continental mass holding
    // the great majority of regions, with Britain, Ireland, Sicily, Crete,
    // Cyprus and the Aegean islands separate. And the falsifier must have RUN and
    // found nothing — a model that excludes nobody because it tested nobody is
    // worthless, so the contradiction count and the exclusion count are both
    // asserted at zero while verdicts are non-zero.
    expect(r.reachability).toBeTruthy();
    expect(r.reachability.components).toBeGreaterThan(500);      // 2,176
    expect(r.reachability.mainlandRegions).toBeGreaterThan(800); // 1,017 of 1,311
    expect(r.reachability.mainlandRegions).toBeLessThan(1311);   // …but NOT all of them
    expect(r.reachability.contradictions).toBe(0);
    expect(r.reachability.excludedFactions).toBe(0);
    expect(r.reachability.verdicts).toBeGreaterThan(10);         // 37
    // THE POINT OF THE FALSIFIER: it must actually have examined something.
    // v0.9.1431 reported "no contradictions" while examining NOTHING, because it
    // assumed a nested {faction:{region:n}} shape where buildSaveFacts emits a
    // flat "faction|Region" map. 816 pairs get checked on this save.
    expect(r.reachability.falsifierTested, "the falsifier examined nothing — it is not really checking the model").toBeGreaterThan(100);
    expect(r.reachability.reliable).toBe(true);
    // and the save's per-faction ship counts must be reported as UNusable, since
    // naval units carry no faction (all 50 land under "?")
    expect(r.reachability.navalFactionKnown).toBe(false);

    const noRoute = r.findings.filter((f) => f.noLandRoute);
    expect(noRoute.length).toBe(r.reachability.verdicts);
    for (const f of noRoute) expect(f.verdict).toMatch(/^NO LAND ROUTE — /);
    // the reference log's champion stuck mission: Ariston of Chios was ordered to
    // Erythrai in 50 of 51 turns. Chios is an island; Erythrai is in mainland
    // Mimas. If this ever stops being caught, the fill has broken.
    const ariston = noRoute.find((f) => /Ariston/.test(f.name || ""));
    expect(ariston, "Ariston of Chios → Erythrai should be proven unreachable").toBeTruthy();
    expect(ariston.faction).toBe("chios");
    expect(ariston.verdict).toMatch(/Mimas shares no walkable land/);
    // The naval clause must come from descr_strat.txt, not from the save. Chios
    // DOES start with an admiral — v0.9.1431 claimed the opposite for all 14 of
    // these factions because it trusted the save's faction-less ship counts.
    expect(ariston.verdict).toMatch(/descr_strat gives it 1 starting admiral/);
    const hasFleet = noRoute.filter((f) => /starting admiral\(s\), so this needs/.test(f.verdict));
    const noFleet = noRoute.filter((f) => /no starting admiral/.test(f.verdict));
    expect(hasFleet.length, "some of these factions DO start with a fleet and still never embark").toBeGreaterThan(0);
    expect(noFleet.length + hasFleet.length).toBe(noRoute.length);

    // the world-level starting_action_points lead: RIS runs 128 against vanilla's
    // 80, and the file's own comment names 99 as the value where the AI stops
    // leaving cities undefended — which is the symptom this log is full of.
    const ap = r.modLeads.find((l) => l.file === "descr_character.txt");
    expect(ap, "expected the starting_action_points lead").toBeTruthy();
    expect(ap.key).toBe("starting_action_points 128");
    expect(ap.evidence).toMatch(/128 vs 80 in vanilla/);
    // the inline comment's quote must be attached to 99, never to 124
    expect(ap.suggestion).toMatch(/says of 99:/);
    for (const l of r.modLeads) {
      expect(l.faction, "lead without a faction").toBeTruthy();
      expect(l.file, "lead without a file to edit").toBeTruthy();
      expect(l.suggestion, "lead without a suggestion").toBeTruthy();
    }

    // ── the result must survive structured clone (it already crossed the
    //    worker boundary to get here) and stay renderable: no NaN/undefined
    //    leaking into the fields the panel prints.
    for (const f of r.findings.slice(0, 200)) {
      expect(typeof f.kind).toBe("string");
      expect(typeof f.detail).toBe("string");
      expect(Number.isNaN(f.severity)).toBe(false);
    }
  }, 180000);

  it.runIf(haveRefs)("classifies impossible campaigns as recruitment- or income-blocked", async () => {
    const msg = await runWorker({ mode: "aiMovement", logPath: REF_LOG, modDataDir: MOD_DIR, savePath: REF_SAVE });
    expect(msg.ok).toBe(true);
    const imp = msg.result.findings.filter((f) => f.impossible);
    expect(imp.length).toBeGreaterThan(200);
    // every impossible campaign must be attributed to a cause — an unclassified
    // one means the mic/tier read silently failed
    for (const f of imp) expect(["recruitment", "income"]).toContain(f.blockedBy);
  }, 180000);

  it.runIf(haveRefs)("reports the user's live warnings-only message_log as unusable, not as 'clean'", async () => {
    const live = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/logs/message_log.txt";
    if (!fs.existsSync(live)) return;
    const msg = await runWorker({ mode: "aiMovement", logPath: live, modDataDir: MOD_DIR, savePath: REF_SAVE });
    expect(msg.ok).toBe(true);
    const r = msg.result;
    expect(r.usable).toBe(false);
    expect(r.emptyReason).toMatch(/no movement events/);
    // and the save banner must be suppressed rather than showing zeroes
    expect(r.save).toBeUndefined();
  }, 120000);
});

describe("progress reporting", () => {
  it.runIf(haveRefs)("streams phase notes while working, without disturbing the final result", async () => {
    const notes = [];
    const msg = await runWorker(
      { mode: "aiMovement", logPath: REF_LOG, modDataDir: MOD_DIR, savePath: REF_SAVE },
      180000, notes
    );
    expect(msg.ok, `worker failed: ${msg.error}`).toBe(true);
    // the run still returns everything
    expect(msg.result.findings.length).toBeGreaterThan(4000);
    // and it told us what it was doing along the way
    expect(notes.length).toBeGreaterThan(5);
    const phases = new Set(notes.map((n) => n.phase));
    expect(phases.has("log")).toBe(true);
    expect(phases.has("save")).toBe(true);
    for (const n of notes) {
      expect(typeof n.phase).toBe("string");
      expect(typeof n.detail).toBe("string");
    }
  }, 240000);
});

// ── scripting_log.txt ─────────────────────────────────────────────────────────
// A third log kind, and the only one that needs no save: the engine's own errors
// in the mod's data files. Pinned against the user's live log so a regex or
// detection regression shows up here rather than silently reporting "clean".
describe("scripting_log.txt — the engine's own mod-file errors", () => {
  const LIVE_SCRIPT = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/logs/scripting_log.txt";
  const haveScript = fs.existsSync(LIVE_SCRIPT) && fs.existsSync(MOD_DIR);

  it.runIf(haveScript)("analyses it WITHOUT a save and resolves each error against the mod files", async () => {
    // deliberately no savePath: these are static data-file bugs. The worker used
    // to demand a save buffer up front, which made this mode impossible.
    const msg = await runWorker({ mode: "aiMovement", logPath: LIVE_SCRIPT, modDataDir: MOD_DIR });
    expect(msg.ok, `worker failed: ${msg.error}`).toBe(true);
    const r = msg.result;
    expect(r.error).toBeUndefined();
    expect(r.logKind).toBe("scripting");
    expect(r.usable).toBe(true);
    expect(r.lines).toBeGreaterThan(90000);        // 93,673
    expect(r.save).toBeUndefined();                // no save asked for, none claimed

    // 13 real errors out of 93,673 lines — the log's 13,000+ ordinary [FAILED]
    // condition checks must NOT be in here.
    expect(r.findings.length).toBeGreaterThan(8);
    expect(r.findings.length).toBeLessThan(60);
    for (const f of r.findings) expect(["script_error", "script_runtime_error"]).toContain(f.kind);

    // the files the engine actually complained about
    const files = new Set(r.findings.map((f) => f.file).filter(Boolean));
    for (const want of ["descr_formations_ai.txt", "descr_senate.txt", "descr_strat.txt"]) {
      expect([...files], `expected an error in ${want}`).toContain(want);
    }
    // paths are reduced to basenames — never the modder's Q:\Feral build path
    for (const f of r.findings) if (f.file) expect(f.file).not.toMatch(/[\\/]/);

    // ── leads: every one must name a file, a key and a suggestion ──
    expect(r.modLeads.length).toBeGreaterThan(5);
    expect(r.auditError).toBeUndefined();
    for (const l of r.modLeads) {
      expect(l.file).toBeTruthy();
      expect(l.key).toBeTruthy();
      expect(l.suggestion).toBeTruthy();
      expect(l.evidence).toBeTruthy();
    }
    // the senate rename is fully resolvable from the files, so it must be resolved
    const aedile = r.modLeads.find((l) => l.key === "Aedile_tenure");
    expect(aedile, "the dead Aedile_tenure reference should be reported").toBeTruthy();
    expect(aedile.suggestion).toMatch(/PlebeianAedile_tenure|CuruleAedile_tenure/);
    expect(aedile.evidence).toMatch(/offices that DO exist/);
  }, 120000);
});
