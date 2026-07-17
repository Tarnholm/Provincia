// Save-to-save Compare IPC handler. register(ipcMain, deps) wires
// "compare-saves": crack TWO saves (earlier, later) in src/saveCompareWorker.js
// worker threads, summarize each (all-faction treasuries/units, ownerByCity,
// per-settlement population), then diff via src/saveCompare.js.
//
// The two cracks run SEQUENTIALLY on purpose: a full crack holds a 30-45 MB
// save buffer plus the cracked object; two at once doubles peak memory for a
// few seconds of saved wall clock on an explicitly user-initiated action.
//
// Worker-infra failure (spawn/'error') falls back to a synchronous main-thread
// crack — same convention as saveAnalysisHandlers — so a broken worker path is
// slower, never a regression. A PER-SAVE crack failure (bad file) is a real
// error and is returned as { error }.
//
// deps: { _writeLog } (optional logger, same shape main.js passes the other
// register* modules).
"use strict";
const fs = require("fs");
const path = require("path");
const { Worker } = require("worker_threads");
const { summarizeForCompare, diffSaveSummaries } = require("./saveCompare.js");

const COMPARE_WORKER_PATH = path.join(__dirname, "saveCompareWorker.js");

function registerSaveCompareHandlers(ipcMain, deps = {}) {
  const _writeLog = typeof deps._writeLog === "function" ? deps._writeLog : () => {};

  // Crack + summarize ONE save in a worker. Resolves the summary; rejects with
  // { infra: true } on worker-infra failure (caller falls back to sync) or a
  // plain Error on a per-save crack failure (caller surfaces it).
  const summarizeInWorker = (savePath, modDataDir) => new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(COMPARE_WORKER_PATH); }
    catch (e) { e.infra = true; reject(e); return; }
    worker.once("message", (msg) => {
      worker.terminate();
      if (msg && msg.ok) resolve(msg.summary);
      else reject(new Error((msg && msg.error ? msg.error : "compare worker returned no result") + (msg && msg.file ? " (" + msg.file + ")" : "")));
    });
    worker.once("error", (err) => { worker.terminate(); err.infra = true; reject(err); });
    worker.postMessage({ savePath, modDataDir });
  });

  // Synchronous fallback (blocks the main thread ~5s per save — only used when
  // the worker infrastructure itself failed to start).
  const summarizeSync = (savePath, modDataDir) => {
    const { crackSave } = require("./saveCracker.js");
    const cracked = crackSave(fs.readFileSync(savePath), modDataDir);
    const summary = summarizeForCompare(cracked);
    summary.file = path.basename(savePath);
    summary.path = savePath;
    return summary;
  };

  const summarizeOne = async (savePath, modDataDir) => {
    try {
      return await summarizeInWorker(savePath, modDataDir);
    } catch (err) {
      if (!err || !err.infra) throw err; // real crack failure — surface it
      _writeLog("[compare-saves] worker infra failed (" + (err.message || err) + ") — falling back to synchronous crack");
      return summarizeSync(savePath, modDataDir);
    }
  };

  // IPC: compare-saves(modDataDir, savePathA, savePathB) — A is the earlier
  // save, B the later one. Returns the diffSaveSummaries result or { error }.
  ipcMain.handle("compare-saves", async (_event, modDataDir, savePathA, savePathB) => {
    try {
      if (!modDataDir) return { error: "No mod data directory — load a mod first." };
      if (!savePathA || !savePathB) return { error: "Pick both saves before comparing." };
      for (const p of [savePathA, savePathB]) {
        if (!fs.existsSync(p)) return { error: "Save file not found: " + p };
      }
      const t0 = Date.now();
      _writeLog("[compare-saves] cracking A: " + path.basename(savePathA));
      const sumA = await summarizeOne(savePathA, modDataDir);
      _writeLog("[compare-saves] cracking B: " + path.basename(savePathB));
      const sumB = await summarizeOne(savePathB, modDataDir);
      const result = diffSaveSummaries(sumA, sumB);
      _writeLog("[compare-saves] done in " + (Date.now() - t0) + "ms — "
        + result.flips.length + " flips, " + result.factionRows.length + " faction rows, "
        + result.popRows.length + " pop rows" + (result.meta.identical ? " (identical)" : ""));
      return result;
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      _writeLog("[compare-saves] FAILED: " + msg);
      return { error: msg };
    }
  });
}

module.exports = { registerSaveCompareHandlers };
