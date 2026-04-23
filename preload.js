const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  readFile: (filePath) => ipcRenderer.invoke("read-file", filePath),
  readFileBinary: (filePath) => ipcRenderer.invoke("read-file-binary", filePath),
  saveFile: (name, content) => ipcRenderer.invoke("save-file", name, content),
  copyFile: (src, destName) => ipcRenderer.invoke("copy-file", src, destName),
  readCampaignFile: (name) => ipcRenderer.invoke("read-campaign-file", name),
  getUserDataPath: () => ipcRenderer.invoke("get-user-data-path"),
  saveUserFile: (name, content) => ipcRenderer.invoke("save-user-file", name, content),
  readUserFile: (name) => ipcRenderer.invoke("read-user-file", name),
  // Live log watcher
  getAppPaths: () => ipcRenderer.invoke("get-app-paths"),
  selectLogFolder: () => ipcRenderer.invoke("select-log-folder"),
  logWatchStart: (logDir) => ipcRenderer.invoke("log-watch-start", logDir),
  logWatchStop: () => ipcRenderer.invoke("log-watch-stop"),
  logReadFull: (logDir) => ipcRenderer.invoke("log-read-full", logDir),
  onLogLines: (callback) => {
    ipcRenderer.on("log-lines", (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("log-lines");
  },
  onLiveCharMoves: (callback) => {
    ipcRenderer.on("live-char-moves", (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("live-char-moves");
  },
  findFactionIconsDir: (modDir) => ipcRenderer.invoke("find-faction-icons-dir", modDir),
  readFactionIcon: (filePath) => ipcRenderer.invoke("read-faction-icon", filePath),
  resolveBuildingIcon: (modDataDir, culture, levelName, chainName) =>
    ipcRenderer.invoke("resolve-building-icon", modDataDir, culture, levelName, chainName),
  resolveBuildingBanner: (modDataDir, culture, levelName, chainName) =>
    ipcRenderer.invoke("resolve-building-banner", modDataDir, culture, levelName, chainName),
  resolveUnitCard: (modDataDir, faction, unitName) =>
    ipcRenderer.invoke("resolve-unit-card", modDataDir, faction, unitName),
  resolveUnitInfo: (modDataDir, faction, unitName) =>
    ipcRenderer.invoke("resolve-unit-info", modDataDir, faction, unitName),
  getBuildingDisplayNames: (modDataDir) =>
    ipcRenderer.invoke("get-building-display-names", modDataDir),
  getBuildingChainLevels: (modDataDir) =>
    ipcRenderer.invoke("get-building-chain-levels", modDataDir),
  getBuildingRecruits: (modDataDir) =>
    ipcRenderer.invoke("get-building-recruits", modDataDir),
  getUnitOwnership: (modDataDir) =>
    ipcRenderer.invoke("get-unit-ownership", modDataDir),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  // Save file watcher
  saveWatchStart: (saveDir, pinnedSave) => ipcRenderer.invoke("save-watch-start", saveDir, pinnedSave || null),
  getLatestSaveMtime: (saveDir) => ipcRenderer.invoke("get-latest-save-mtime", saveDir),
  listSaves: (saveDir) => ipcRenderer.invoke("list-saves", saveDir),
  selectSaveFile: (saveDir) => ipcRenderer.invoke("select-save-file", saveDir),
  saveWatchStop: () => ipcRenderer.invoke("save-watch-stop"),
  saveCheckNow: () => ipcRenderer.invoke("save-check-now"),
  // Character/unit extraction — initialize once the mod data directory is known.
  charactersInit: (modDataDir) => ipcRenderer.invoke("characters-init", modDataDir),
  getFactionDisplayMap: () => ipcRenderer.invoke("faction-display-map"),
  getFactionDisplayNames: (modDataDir) => ipcRenderer.invoke("faction-display-names", modDataDir),
  getFactionCultures: (modDataDir) => ipcRenderer.invoke("faction-cultures", modDataDir),
  logMessage: (level, text) => ipcRenderer.invoke("log-message", level, text),
  getLogPath: () => ipcRenderer.invoke("get-log-path"),
  revealLogFile: () => ipcRenderer.invoke("reveal-log-file"),
  onSaveEvents: (callback) => {
    ipcRenderer.on("save-events", (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("save-events");
  },
  onSaveSnapshot: (callback) => {
    ipcRenderer.on("save-snapshot", (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("save-snapshot");
  },
  // Auto-updater
  updaterCheck: () => ipcRenderer.invoke("updater-check"),
  updaterQuitAndInstall: () => ipcRenderer.invoke("updater-quit-and-install"),
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update-status", (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("update-status");
  },
  isElectron: true,
});
