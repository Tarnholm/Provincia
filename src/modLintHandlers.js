// Mod-lint IPC handler (2026-07-17). Registers "lint-mod": parse-time
// consistency checks across the mod's core files (EDB resource tokens vs
// descr_sm_resources/descr_regions, descr_strat + EDB recruit units vs EDU,
// building_present targets, dead hidden_resource conditions). The lint module
// is lazy-require()d inside the handler like the other handler files, so a
// parse-time error in it surfaces as an { error } reply instead of killing
// startup registration.
"use strict";

function registerModLintHandlers(ipcMain) {
  ipcMain.handle("lint-mod", async (event, modDataDir) => {
    try {
      if (!modDataDir || typeof modDataDir !== "string") return { error: "lint-mod: no mod data directory given" };
      const { lintMod } = require("./modLint.js");
      return lintMod(modDataDir);
    } catch (e) {
      return { error: "lint-mod failed: " + (e && e.message ? e.message : String(e)) };
    }
  });
}

module.exports = { registerModLintHandlers };
