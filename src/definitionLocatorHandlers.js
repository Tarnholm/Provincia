// Definition-locator IPC handlers (2026-07-16). Registers "locate-definition":
// given (modDataDir, query) returns every mod-file line that defines or
// references the queried entity name (unit type, building chain/level,
// region, settlement, faction, trait, resource, text token) with absolute
// file + 1-based line + preview, classified by kind. Opening the hit in the
// user's editor goes through the EXISTING "open-source-file" IPC in main.js,
// which already accepts a line number (Notepad++ `-n<line>`) — no open-at-
// line handler is needed here.
//
// The locator module is lazy-require()d inside the handler like the other
// handler files, so a parse-time error in it surfaces as an { error } reply
// instead of killing startup registration.
"use strict";

function registerDefinitionLocatorHandlers(ipcMain, deps) {
  ipcMain.handle("locate-definition", async (event, modDataDir, query) => {
    try {
      if (!modDataDir || typeof modDataDir !== "string") {
        return { error: "locate-definition: no mod data directory given" };
      }
      if (!query || typeof query !== "string" || !query.trim()) {
        return { error: "locate-definition: empty query" };
      }
      const { locateDefinition } = require("./definitionLocator.js");
      return locateDefinition(modDataDir, query);
    } catch (e) {
      return { error: "locate-definition failed: " + (e && e.message ? e.message : String(e)) };
    }
  });
}

module.exports = { registerDefinitionLocatorHandlers };
