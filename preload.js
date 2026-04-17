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
  findFactionIconsDir: (modDir) => ipcRenderer.invoke("find-faction-icons-dir", modDir),
  readFactionIcon: (filePath) => ipcRenderer.invoke("read-faction-icon", filePath),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  // Save file watcher
  saveWatchStart: (saveDir) => ipcRenderer.invoke("save-watch-start", saveDir),
  saveWatchStop: () => ipcRenderer.invoke("save-watch-stop"),
  saveCheckNow: () => ipcRenderer.invoke("save-check-now"),
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
