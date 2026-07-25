// Worker thread that runs the heavy save cracks OFF the Electron main thread,
// so loading a save no longer freezes the app for several seconds. Two modes:
//
//   mode "economy": crackSave(economyOnly) + parseFinancialOverview → the
//                   Financial Overview object the economy panel needs.
//   mode "trade":   computeTradeNetwork → the trade-network object.
//
// Both cracks are self-contained (buffer + modDataDir in, plain object out) —
// they touch no main-process state — which is exactly why they move cleanly to
// a worker. The worker reads the save file itself when given a savePath (so the
// 30-45 MB file read AND the parse both stay off the main thread); for the
// live-watch path it receives the already-in-memory buffer instead.
//
// Communication:
//   in:  { mode, savePath?, saveBuf?, modDataDir, campaign? }
//   out: { ok: true, result, logs } | { ok: false, error }
//
// `logs` carries the crack's own [trade]/[diplo] diagnostics (emitted via
// console.log inside the parsers) back to the main thread, which replays them
// into provincia.log — otherwise they'd vanish (a worker's console is not the
// main thread's log-capturing console).

"use strict";

const fs = require("fs");
const { parentPort } = require("worker_threads");

parentPort.on("message", async (payload) => {
  // Capture the parsers' console.log diagnostics so the main thread can persist
  // them to provincia.log. Restored in finally so a throw can't leak the patch.
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => { try { logs.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" ")); } catch { /* logging must never throw */ } };
  try {
    const { mode, savePath, saveBuf, modDataDir, campaign, preCracked } = payload;
    // postMessage delivers Buffers as Uint8Array on the worker side — wrap back
    // into a real Buffer so the byte-reading parsers work.
    // The aiMovement mode never touches `buf` — it opens the log itself and
    // (optionally) reads the save inside runAiMovementAnalysis. Reading it here
    // too would duplicate a 44MB read, and would make a save MANDATORY, which
    // is wrong for scripting_log.txt: those are static data-file errors that
    // need no save at all.
    const needsSave = mode !== "aiMovement";
    let buf;
    if (needsSave) {
      if (savePath && fs.existsSync(savePath)) {
        buf = fs.readFileSync(savePath);
      } else if (saveBuf) {
        buf = Buffer.isBuffer(saveBuf) ? saveBuf : Buffer.from(saveBuf.buffer, saveBuf.byteOffset, saveBuf.byteLength);
      } else {
        throw new Error("no save buffer available");
      }
    }

    let result;
    if (mode === "economy") {
      // Do the tradeOnly crack (a SUPERSET that serves BOTH panels — it keeps
      // diplomacy, which economyOnly drops) and return BOTH the crack and the
      // Financial Overview. The handler caches this crack in-flight so the trade
      // panel, which fires on the same save load, reuses it instead of re-cracking.
      const { crackSave } = require("./saveCracker.js");
      const { parseFinancialOverview } = require("./economyParser.js");
      const cracked = crackSave(buf, modDataDir, { tradeOnly: true });
      result = { cr: cracked, economy: parseFinancialOverview(buf, cracked) };
    } else if (mode === "trade") {
      // preCracked: reuse the economy panel's shared tradeOnly crack when present,
      // skipping this worker's own ~3s re-crack.
      const { computeTradeNetwork } = require("./tradeNetwork.js");
      result = computeTradeNetwork(buf, modDataDir, campaign ? { campaign } : {}, preCracked || null);
    } else if (mode === "aiMovement") {
      // Full AI-log analysis (+ optional save cross-reference and mod-file
      // audit). Runs here because the save crack alone blocks ~12s — on the
      // main thread that froze the UI and the mouse (user report 2026-07-25).
      const { runAiMovementAnalysis } = require("./aiMovementRun.js");
      // Progress messages are distinguishable from the final reply by having no
      // `ok` field, so the parent's once("message") handler ignores them.
      result = await runAiMovementAnalysis(payload, (p2) => {
        try { parentPort.postMessage({ progress: p2 }); } catch { /* progress is advisory */ }
      });
    } else {
      throw new Error("unknown save-worker mode: " + mode);
    }

    console.log = origLog;
    parentPort.postMessage({ ok: true, result, logs });
  } catch (err) {
    console.log = origLog;
    parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err), logs });
  }
});
