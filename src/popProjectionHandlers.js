// Population-projection IPC handler (2026-07-17). Wires "project-population"
// → src/popProjection.js projectPopulation(modDataDir, faction, turns).
// register(ipcMain) — no deps needed; the projection module reads the mod
// files itself (growthEval + poModel + descr_cultures). Errors are returned
// as { error } (never thrown across IPC) so the renderer can render them —
// the 0.9.1096 hang taught us a silently-dropped IPC error freezes panels.
"use strict";

function registerPopProjectionHandlers(ipcMain) {
  ipcMain.handle("project-population", async (_event, modDataDir, faction, turns) => {
    try {
      if (!modDataDir) return { error: "no mod data dir given" };
      if (!faction) return { error: "no faction given" };
      const { projectPopulation } = require("./popProjection.js");
      return projectPopulation(String(modDataDir), String(faction), turns);
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  });
}

module.exports = { registerPopProjectionHandlers };
