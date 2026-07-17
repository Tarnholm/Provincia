// Worker thread that cracks ONE save for the save-to-save Compare panel and
// returns its compact compare summary. Mirrors src/timelineRowWorker.js — the
// timeline row is player-faction-scoped, but the compare needs ALL factions'
// treasuries/units plus per-settlement population, so this worker runs the FULL
// crackSave (~5s on a 34 MB save — exactly why it must stay off the Electron
// main thread) and immediately boils the huge cracked object down to the small
// summarizeForCompare shape, so only kilobytes cross the postMessage boundary.
//
// Communication:
//   in:  { savePath, modDataDir }
//   out: { ok: true, summary } | { ok: false, error, file }
"use strict";

const fs = require("fs");
const path = require("path");
const { parentPort } = require("worker_threads");
const { crackSave } = require("./saveCracker.js");
const { summarizeForCompare } = require("./saveCompare.js");

parentPort.on("message", (payload) => {
  const { savePath, modDataDir } = payload;
  try {
    const cracked = crackSave(fs.readFileSync(savePath), modDataDir);
    const summary = summarizeForCompare(cracked);
    summary.file = path.basename(savePath);
    summary.path = savePath;
    parentPort.postMessage({ ok: true, summary });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err), file: path.basename(savePath) });
  }
});
