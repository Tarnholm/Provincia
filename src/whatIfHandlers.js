// src/whatIfHandlers.js — IPC handler for the what-if balance sandbox
// (2026-07-17). Pattern follows src/econBaselineHandlers.js: CJS main-process
// module, registerWhatIfHandlers(ipcMain[, deps]).
//
// "run-what-if" (modDataDir, edits, thresholdPct)
//     edits = [{ file: "export_descr_buildings.txt" | "export_descr_unit.txt",
//                find, replace, isRegex?, all? }]
//     → { applied: [{ file, matches }], rows, added, removed, baselineMs,
//         shadowMs, factionsCompared, reused, shadowDir } or { error, … }.
//     The real mod dir is never written — edits land in a temp shadow copy
//     (see src/whatIfSandbox.js for the copied file set and reuse rules).
//     Long-running (two full-roster economy snapshots; first run on a big mod
//     is ~30-60s, warm reruns much faster) — the renderer should show a busy
//     state (WhatIfPanel does).

const { runWhatIf } = require("./whatIfSandbox.js");

function registerWhatIfHandlers(ipcMain, deps) {
  ipcMain.handle("run-what-if", async (_event, modDataDir, edits, thresholdPct) => {
    try {
      if (!modDataDir) return { error: "modDataDir required" };
      if (!Array.isArray(edits) || !edits.length) return { error: "at least one edit required" };
      // Prefer Electron's per-user temp for the shadow base when available;
      // whatIfSandbox falls back to os.tmpdir() on its own otherwise.
      let baseDir;
      try { baseDir = deps && deps.app && deps.app.getPath("temp"); } catch { /* os.tmpdir fallback */ }
      return runWhatIf(modDataDir, edits, thresholdPct, baseDir ? { baseDir } : undefined);
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  });
}

module.exports = { registerWhatIfHandlers };
