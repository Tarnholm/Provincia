// Submod-drift IPC handlers (2026-07-17). register(ipcMain, { dialog }) wires
// two channels for the Submod Drift panel:
//   select-submod-folder — directory picker, returns the chosen path or null
//   scan-submod-drift    — scanSubmodDrift(baseDir, submodDir) or { error }
// The scan itself lives in src/submodDrift.js (pure, hermetically tested);
// this module is the thin main-process shell in the registerXHandlers pattern.
"use strict";

function registerSubmodDriftHandlers(ipcMain, { dialog }) {
  ipcMain.handle("select-submod-folder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select submod data folder (overlays the base mod's data/)",
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("scan-submod-drift", async (_event, baseDir, submodDir) => {
    try {
      if (!baseDir || !submodDir) return { error: "baseDir + submodDir required" };
      const { scanSubmodDrift } = require("./submodDrift.js");
      return scanSubmodDrift(baseDir, submodDir);
    } catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    }
  });
}

module.exports = { registerSubmodDriftHandlers };
