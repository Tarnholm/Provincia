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
