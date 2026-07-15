// Vanilla RTW:R game-data read handlers, extracted from main.js (2026-07-15).
// register(ipcMain, { getVanillaDataDir }) wires them. They read the bundled
// vanilla install's files so the bundled vanilla "Slot 1" shows its real
// faction colours + names rather than the loaded mod's shared copies. Logic
// unchanged from the inline handlers.
"use strict";
const fs = require("fs");
const path = require("path");

function registerVanillaDataHandlers(ipcMain, { getVanillaDataDir }) {
  ipcMain.handle("read-vanilla-strat", async () => {
    try {
      const dd = getVanillaDataDir();
      if (!dd) return null;
      const p = path.join(dd, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
      return fs.existsSync(p) ? fs.readFileSync(p, "latin1") : null;
    } catch { return null; }
  });

  // vanilla descr_sm_factions.txt — real faction COLOURS (and names), not the mod's copy.
  ipcMain.handle("read-vanilla-sm-factions", async () => {
    try {
      const dd = getVanillaDataDir();
      if (!dd) return null;
      const p = path.join(dd, "descr_sm_factions.txt");
      return fs.existsSync(p) ? fs.readFileSync(p, "latin1") : null;
    } catch { return null; }
  });

  // vanilla faction display names ({THRACE} Thrace, …) from ONLY vanilla
  // text/expanded*.txt — NOT merged with BI/Alexander overrides (which shift
  // names like Thrace→Dacia on the vanilla Slot 1).
  ipcMain.handle("get-vanilla-faction-display-names", async () => {
    const dd = getVanillaDataDir();
    if (!dd) return {};
    const map = {};
    for (const fname of ["expanded.txt", "expanded_bi.txt"]) { // bi last → its faction names win
      const src = path.join(dd, "text", fname);
      if (!fs.existsSync(src)) continue;
      try {
        const buf = fs.readFileSync(src);
        const text = (buf[0] === 0xff && buf[1] === 0xfe) ? buf.toString("utf16le") : buf.toString("utf8");
        for (const line of text.split(/\r?\n/)) {
          const m = line.match(/^\{([A-Z][A-Z0-9_]*)\}\s*(.+?)\s*$/);
          if (!m) continue;
          const key = m[1];
          if (key.includes("_DESCR") || key.startsWith("EMT_") || key.startsWith("SMW_") ||
              key.endsWith("_LABEL") || key.endsWith("_ORDER") || key.endsWith("_UNREST") ||
              key.endsWith("_TITLE") || key.endsWith("_BODY") || key.endsWith("_MESSAGE")) continue;
          const display = m[2].trim();
          if (!display || display.length > 60) continue;
          map[key.toLowerCase()] = display;
        }
      } catch {}
    }
    return map;
  });
}

module.exports = { registerVanillaDataHandlers };
