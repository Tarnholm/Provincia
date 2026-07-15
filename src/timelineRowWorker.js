// Worker thread that cracks ONE save for the Campaign Timeline scan and returns
// its extracted row. scan-saves-timeline used to crack every save serially on
// the Electron main thread — a folder of N saves froze the app for N × ~6s
// (minutes for a real autosave folder). The handler now fans these workers out
// across CPU cores, so the scan is both non-blocking AND ~cores× faster.
//
// Uses the SAME crackSave + extractRow as the CLI/buildTimeline, so each row is
// identical to the serial path; the handler feeds the rows into the shared
// assembleTimeline for grouping/sorting.
//
// Communication:
//   in:  { savePath, mod, factionOverride }
//   out: { ok: true, row } | { ok: false, error, file }

"use strict";

const fs = require("fs");
const path = require("path");
const { parentPort } = require("worker_threads");
const { crackSave } = require("./saveCracker.js");
const { extractRow } = require("../scripts/campaign-timeline.js");

parentPort.on("message", (payload) => {
  const { savePath, mod, factionOverride } = payload;
  try {
    const cracked = crackSave(fs.readFileSync(savePath), mod);
    const row = extractRow(cracked, savePath, factionOverride);
    parentPort.postMessage({ ok: true, row });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err), file: path.basename(savePath) });
  }
});
