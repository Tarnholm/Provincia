// Preload for the Settlement Processor (Scripts) child window.
//
// Exposes `window.api` with the EXACT method names the Suite renderer
// (scripts-suite/renderer.js) already expects, so that renderer is reused
// verbatim. Every channel is namespaced `sps:*` to avoid colliding with
// Provincia's own IPC channels (read-file, select-folder, …) registered on the
// same ipcMain. The Suite's separate updater is intentionally NOT exposed —
// Provincia owns updates.
const { contextBridge, ipcRenderer } = require("electron");

const invoke = (ch, ...args) => ipcRenderer.invoke("sps:" + ch, ...args);
const on = (ch, cb) => {
  const listener = (_e, data) => cb(data);
  ipcRenderer.on("sps:" + ch, listener);
  return () => ipcRenderer.removeListener("sps:" + ch, listener);
};

contextBridge.exposeInMainWorld("api", {
  // Pipeline
  getPipelineSteps: () => invoke("get-pipeline-steps"),
  getProjectRoot: () => invoke("get-project-root"),
  runStep: (stepId, overrides) => invoke("run-step", stepId, overrides || {}),
  runPipeline: (stepIds) => invoke("run-pipeline", stepIds),

  // Config files
  listConfigFiles: () => invoke("list-config-files"),
  readFile: (path) => invoke("read-file", path),
  writeFile: (path, content) => invoke("write-file", path, content),
  saveFileAs: (name, content) => invoke("save-file-as", name, content),

  // Rule Profiles (script snapshots)
  listProfiles: () => invoke("list-profiles"),
  saveProfile: (name, desc) => invoke("save-profile", name, desc),
  loadProfile: (name) => invoke("load-profile", name),
  listScripts: () => invoke("list-scripts"),

  // Comparison
  runComparison: (profileA, profileB, stepIds) => invoke("run-comparison", profileA, profileB, stepIds),

  // Output
  getLatestOutput: () => invoke("get-latest-output"),
  readOutputFile: (path) => invoke("read-output-file", path),
  openFolder: (path) => invoke("open-folder", path),

  // EDB parsing
  parseEdbBuildings: () => invoke("parse-edb-buildings"),

  // Migrate Building Chain picker
  migrateGetData: () => invoke("migrate-get-data"),
  migrateSave: (migrations) => invoke("migrate-save", migrations),
  migratePreview: (mig) => invoke("migrate-preview", mig),

  // Master / building allowlist
  loadAllowlist: () => invoke("load-allowlist"),
  saveAllowlist: (data) => invoke("save-allowlist", data),
  runMaster: () => invoke("run-master"),
  getStratStats: () => invoke("get-strat-stats"),
  resolveBuildingIcon: (modDataDir, culture, levelName, chainName) =>
    invoke("resolve-building-icon", modDataDir, culture, levelName, chainName),

  // Validation
  validateOutput: () => invoke("validate-output"),

  // Mod folder / import
  selectModFolder: () => invoke("select-mod-folder"),
  getModPrefs: () => invoke("get-mod-prefs"),
  loadModFiles: (dataDir, campaign) => invoke("load-mod-files", dataDir, campaign),
  selectParentMod: () => invoke("select-parent-mod"),
  loadParentModFiles: (parentDataDir, missingFiles) => invoke("load-parent-mod-files", parentDataDir, missingFiles),
  saveBackToMod: (dataDir, campaign) => invoke("save-back-to-mod", dataDir, campaign),
  importHiddenResourcesCsv: () => invoke("import-hidden-resources-csv"),
  importCivicList: () => invoke("import-civic-list"),
  checkHiddenResourcesCsv: () => invoke("check-hidden-resources-csv"),
  clearStaleOutput: () => invoke("clear-stale-output"),
  backupConfig: () => invoke("backup-config"),
  restoreConfig: () => invoke("restore-config"),
  chainStratOutput: () => invoke("chain-strat-output"),
  chainRegionsOutput: () => invoke("chain-regions-output"),

  // Provincia integration: the mod Provincia currently has loaded, so the
  // Scripts window can auto-source it instead of asking for a folder.
  getHostMod: () => invoke("get-host-mod"),

  // Streaming events (main → renderer)
  onStepOutput: (cb) => on("step-output", cb),
  onPipelineStepStart: (cb) => on("pipeline-step-start", cb),
  onPipelineStepDone: (cb) => on("pipeline-step-done", cb),
  onComparisonStepDone: (cb) => on("comparison-step-done", cb),
  onComparisonStatus: (cb) => on("comparison-status", cb),
  onMasterOutput: (cb) => on("master-output", cb),
  onMasterDone: (cb) => on("master-done", cb),
});
