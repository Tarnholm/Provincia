const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Open the embedded Settlement Processor (Scripts) window (dev pill).
  openScriptsWindow: () => ipcRenderer.invoke("sps:open-window"),
  // Open a config file in the Scripts window's Monaco editor and (if
  // searchText given) scroll to the first match. Opens the Scripts window
  // on demand. Used by "Open in editor" buttons in the main app.
  scriptsJumpTo: (fileName, searchText, line) => ipcRenderer.invoke("sps:jump-to", fileName, searchText, line),
  // X-Ref scan: "where is this used?" Returns { byFile: { fileName: [{line, text}] }, totalMatches }.
  xrefFind: (name) => ipcRenderer.invoke("sps:xref-find", name),
  // Mac dev-pill button: load the bundled RIS subset + sample save so the
  // app works without the game installed. Returns { ok, dataDir, saveDir,
  // saveFile, campaign }.
  macLoadBundledDemo: () => ipcRenderer.invoke("mac-load-bundled-demo"),
  // Expose process.platform once at load — used by the dev pill to show the
  // Mac button only on darwin.
  platform: process.platform,
  // Victory-conditions helper: region-list CSV in → region,owner_faction CSV out.
  vcRegionOwnersCsv: (modDataDir, campaign) => ipcRenderer.invoke("vc-region-owners-csv", modDataDir, campaign),
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  readFile: (filePath) => ipcRenderer.invoke("read-file", filePath),
  readFileBinary: (filePath) => ipcRenderer.invoke("read-file-binary", filePath),
  saveFile: (name, content) => ipcRenderer.invoke("save-file", name, content),
  writeBinaryFile: (name, dataBuf) => ipcRenderer.invoke("write-binary-file", name, dataBuf),
  copyFile: (src, destName) => ipcRenderer.invoke("copy-file", src, destName),
  readCampaignFile: (name) => ipcRenderer.invoke("read-campaign-file", name),
  addgenGetData: () => ipcRenderer.invoke("addgen-get-data"),
  addgenApply: (selection) => ipcRenderer.invoke("addgen-apply", selection),
  getUserDataPath: () => ipcRenderer.invoke("get-user-data-path"),
  saveUserFile: (name, content) => ipcRenderer.invoke("save-user-file", name, content),
  readUserFile: (name) => ipcRenderer.invoke("read-user-file", name),
  // Live log watcher
  getAppPaths: () => ipcRenderer.invoke("get-app-paths"),
  selectLogFolder: () => ipcRenderer.invoke("select-log-folder"),
  logWatchStart: (logDir) => ipcRenderer.invoke("log-watch-start", logDir),
  logWatchStop: () => ipcRenderer.invoke("log-watch-stop"),
  logWatchReset: () => ipcRenderer.invoke("log-watch-reset"),
  logReadFull: (logDir) => ipcRenderer.invoke("log-read-full", logDir),
  onLogLines: (callback) => {
    ipcRenderer.on("log-lines", (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("log-lines");
  },
  onLiveCharMoves: (callback) => {
    ipcRenderer.on("live-char-moves", (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("live-char-moves");
  },
  // Fired when a watched mod file changes on disk (e.g. Manipula saving
  // export_descr_buildings.txt) so the renderer can hot-reload that data.
  onModFileChanged: (callback) => {
    ipcRenderer.on("mod-file-changed", (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("mod-file-changed");
  },
  findFactionIconsDir: (modDir) => ipcRenderer.invoke("find-faction-icons-dir", modDir),
  readFactionIcon: (filePath) => ipcRenderer.invoke("read-faction-icon", filePath),
  resolveBuildingIcon: (modDataDir, culture, levelName, chainName) =>
    ipcRenderer.invoke("resolve-building-icon", modDataDir, culture, levelName, chainName),
  resolveBuildingBanner: (modDataDir, culture, levelName, chainName) =>
    ipcRenderer.invoke("resolve-building-banner", modDataDir, culture, levelName, chainName),
  replaceBuildingIcon: (modDataDir, culture, levelName, chainName, sourceFile) =>
    ipcRenderer.invoke("replace-building-icon", modDataDir, culture, levelName, chainName, sourceFile),
  revertBuildingIcon: (destPath, backupPath) =>
    ipcRenderer.invoke("revert-building-icon", destPath, backupPath),
  resolveUnitCard: (modDataDir, faction, unitName, dictionary) =>
    ipcRenderer.invoke("resolve-unit-card", modDataDir, faction, unitName, dictionary),
  resolveUnitInfo: (modDataDir, faction, unitName, dictionary) =>
    ipcRenderer.invoke("resolve-unit-info", modDataDir, faction, unitName, dictionary),
  getBuildingDisplayNames: (modDataDir) =>
    ipcRenderer.invoke("get-building-display-names", modDataDir),
  getBuildingChainLevels: (modDataDir) =>
    ipcRenderer.invoke("get-building-chain-levels", modDataDir),
  getBuildingRecruits: (modDataDir) =>
    ipcRenderer.invoke("get-building-recruits", modDataDir),
  getUnitOwnership: (modDataDir) =>
    ipcRenderer.invoke("get-unit-ownership", modDataDir),
  getUnitStats: (modDataDir, unitName) =>
    ipcRenderer.invoke("get-unit-stats", modDataDir, unitName),
  getUnitDescription: (modDataDir, unitName) =>
    ipcRenderer.invoke("get-unit-description", modDataDir, unitName),
  getBuildingDescription: (modDataDir, levelName, chainName, culture) =>
    ipcRenderer.invoke("get-building-description", modDataDir, levelName, chainName, culture),
  getBuildingStats: (modDataDir, levelName, chainName) =>
    ipcRenderer.invoke("get-building-stats", modDataDir, levelName, chainName),
  clearModCaches: () => ipcRenderer.invoke("clear-mod-caches"),
  getModFileMtimes: (modDataDir) => ipcRenderer.invoke("get-mod-file-mtimes", modDataDir),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  // Save file watcher
  saveWatchStart: (saveDir, pinnedSave) => ipcRenderer.invoke("save-watch-start", saveDir, pinnedSave || null),
  getLatestSaveMtime: (saveDir) => ipcRenderer.invoke("get-latest-save-mtime", saveDir),
  listSaves: (saveDir) => ipcRenderer.invoke("list-saves", saveDir),
  selectSaveFile: (saveDir) => ipcRenderer.invoke("select-save-file", saveDir),
  calibrateFromSave: (savePath) => ipcRenderer.invoke("calibrate-from-save", savePath),
  saveWatchStop: () => ipcRenderer.invoke("save-watch-stop"),
  saveCheckNow: () => ipcRenderer.invoke("save-check-now"),
  // Character/unit extraction — initialize once the mod data directory is known.
  charactersInit: (modDataDir) => ipcRenderer.invoke("characters-init", modDataDir),
  getTraitData: () => ipcRenderer.invoke("get-trait-data"),
  updateCharacterTraits: (firstName, faction, traits) => ipcRenderer.invoke("update-character-traits", firstName, faction, traits),
  updateCharacterPosition: (faction, oldX, oldY, newX, newY) => ipcRenderer.invoke("update-character-position", faction, oldX, oldY, newX, newY),
  updateCharacterFields: (firstName, faction, fields) => ipcRenderer.invoke("update-character-fields", firstName, faction, fields),
  relocateGarrison: (faction, region, newX, newY) => ipcRenderer.invoke("relocate-garrison", faction, region, newX, newY),
  renameCharacter: (faction, oldFirst, newFirst) => ipcRenderer.invoke("rename-character", faction, oldFirst, newFirst),
  updateArmyUnits: (faction, locator, units) => ipcRenderer.invoke("update-army-units", faction, locator, units),
  backupModFiles: () => ipcRenderer.invoke("backup-mod-files"),
  listModBackups: () => ipcRenderer.invoke("list-mod-backups"),
  restoreModBackup: (stamp) => ipcRenderer.invoke("restore-mod-backup", stamp || null),
  getCoreAttitudes: () => ipcRenderer.invoke("get-core-attitudes"),
  updateCoreAttitudes: (edits) => ipcRenderer.invoke("update-core-attitudes", edits),
  updateCharacterAncillaries: (firstName, faction, ancillaries) => ipcRenderer.invoke("update-character-ancillaries", firstName, faction, ancillaries),
  updateRegionBuildings: (regionName, buildings) => ipcRenderer.invoke("update-region-buildings", regionName, buildings),
  getBuildingCatalogue: () => ipcRenderer.invoke("get-building-catalogue"),
  resolveTraitIcon: (modDataDir, culture, levelName) => ipcRenderer.invoke("resolve-trait-icon", modDataDir, culture, levelName),
  resolveAncillaryIcon: (modDataDir, ancillaryName) => ipcRenderer.invoke("resolve-ancillary-icon", modDataDir, ancillaryName),
  getStartingCharacters: () => ipcRenderer.invoke("get-starting-characters"),
  getDescrStratFamilies: () => ipcRenderer.invoke("get-descr-strat-families"),
  resolvePortrait: (modDataDir, culture, slot, charContext) => ipcRenderer.invoke("resolve-portrait", modDataDir, culture, slot, charContext || null),
  getInitialOwnership: () => ipcRenderer.invoke("get-initial-ownership"),
  getInitialCreators: () => ipcRenderer.invoke("get-initial-creators"),
  getModHomelands: () => ipcRenderer.invoke("get-mod-homelands"),
  writeActiveModFile: (relPath, content) => ipcRenderer.invoke("write-active-mod-file", relPath, content),
  getRebelFactions: (modDataDir) => ipcRenderer.invoke("get-rebel-factions", modDataDir),
  findEdbChain: (modDataDir, chainName) => ipcRenderer.invoke("find-edb-chain", modDataDir, chainName),
  findEduType: (modDataDir, unitType) => ipcRenderer.invoke("find-edu-type", modDataDir, unitType),
  openSourceFile: (filePath, line) => ipcRenderer.invoke("open-source-file", filePath, line),
  getFactionDisplayMap: () => ipcRenderer.invoke("faction-display-map"),
  getFactionDisplayNames: (modDataDir, campaign) => ipcRenderer.invoke("faction-display-names", modDataDir, campaign),
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
  onSaveProgress: (callback) => {
    ipcRenderer.on("save-progress", (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("save-progress");
  },
  // Auto-updater
  updaterCheck: () => ipcRenderer.invoke("updater-check"),
  updaterQuitAndInstall: () => ipcRenderer.invoke("updater-quit-and-install"),
  getUpdateStatus: () => ipcRenderer.invoke("get-update-status"),
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update-status", (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("update-status");
  },
  isElectron: true,
});
