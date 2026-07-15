// App/system-info IPC handlers, extracted from main.js (2026-07-15) as the
// first domain module. register(ipcMain, { app, dialog }) wires the handlers;
// logic is unchanged. Kept small + dependency-injected so it's covered by the
// mainHandlers harness test (which asserts these channels + their behavior).
"use strict";

function registerSystemHandlers(ipcMain, { app, dialog }) {
  ipcMain.handle("get-app-version", () => app.getVersion());

  ipcMain.handle("get-user-data-path", () => app.getPath("userData"));

  // Platform-specific app data paths, for the renderer's save/mod auto-detection.
  ipcMain.handle("get-app-paths", () => {
    return {
      home: app.getPath("home"),
      appData: app.getPath("appData"),       // Roaming on Windows, ~/Library/Application Support on Mac
      localAppData: process.env.LOCALAPPDATA || null,  // Windows only
      platform: process.platform,
    };
  });

  // Simple folder picker (used to point Live mode at the RTW logs directory).
  ipcMain.handle("select-log-folder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Rome Remastered logs folder (contains message_log.txt)",
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
}

module.exports = { registerSystemHandlers };
