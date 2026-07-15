// Logging IPC handlers, extracted from main.js (2026-07-15). register(ipcMain,
// { writeLog, getLogPath, shell }) wires them. The log internals (_writeLog /
// _logPath) stay in main.js's logging section and are injected via a wrapper +
// getter so a later reassignment is still seen. Logic unchanged.
"use strict";
const fs = require("fs");

function registerLogHandlers(ipcMain, { writeLog, getLogPath, shell }) {
  // Receive renderer log lines and append them to the same durable log file.
  ipcMain.handle("log-message", async (_event, level, text) => {
    try {
      const stamp = new Date().toISOString().slice(11, 23);
      writeLog(`[${stamp}] [RENDERER-${(level || "log").toUpperCase()}] ${text}\n`);
    } catch {}
  });

  // Return the log file path (renderer shows it to the user).
  ipcMain.handle("get-log-path", () => getLogPath());

  // Open the log file's containing folder in the OS file manager.
  ipcMain.handle("reveal-log-file", () => {
    try {
      const p = getLogPath();
      if (p && fs.existsSync(p)) shell.showItemInFolder(p);
      return true;
    } catch { return false; }
  });
}

module.exports = { registerLogHandlers };
