const { contextBridge, ipcRenderer } = require("electron");

// 0.9.1269: freeze forensics — report every click/dblclick target to the main
// process (which keeps the last 15). When the renderer hangs or crashes, main
// logs this trail, so "what did the user click right before the freeze?" is
// answerable from provincia.log. Lives in the preload (not App.js) so it works
// from the very first paint and survives renderer-side refactors.
window.addEventListener("DOMContentLoaded", () => {
  const describe = (el) => {
    if (!el || !el.tagName) return "?";
    const btn = el.closest ? el.closest("button") : null;
    const t = btn || el;
    const label =
      (t.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40) ||
      t.getAttribute?.("title") ||
      t.getAttribute?.("data-anim-id") ||
      "";
    return `<${t.tagName.toLowerCase()}${t.className && typeof t.className === "string" ? "." + t.className.split(/\s+/)[0] : ""}>${label ? ` "${label}"` : ""}`;
  };
  for (const type of ["click", "dblclick"]) {
    window.addEventListener(
      type,
      (e) => {
        try { ipcRenderer.send("ui-action", `${type} ${describe(e.target)}`); } catch {}
      },
      { capture: true, passive: true }
    );
  }
});

contextBridge.exposeInMainWorld("electronAPI", {
  // Open the embedded Settlement Processor (Scripts) window (dev pill).
  openScriptsWindow: () => ipcRenderer.invoke("sps:open-window"),
  // Open a config file in the Scripts window's Monaco editor and (if
  // searchText given) scroll to the first match. Opens the Scripts window
  // on demand. Used by "Open in editor" buttons in the main app.
  scriptsJumpTo: (fileName, searchText, line) => ipcRenderer.invoke("sps:jump-to", fileName, searchText, line),
  // X-Ref scan: "where is this used?" Returns { byFile: { fileName: [{line, text}] }, totalMatches }.
  xrefFind: (name) => ipcRenderer.invoke("sps:xref-find", name),
  // Mod-validation: returns { summary, danglingChains, danglingLevels, stratErrors, missingLocale, orphanedChains }.
  validateMod: (dataDir) => ipcRenderer.invoke("sps:validate-mod", dataDir),
  // Portrait coverage audit — per-culture data/ui/<culture>/portraits/portraits/
  // {young,old} presence + file count. Returns { cultures: [...], summary, error }.
  validatePortraits: (dataDir) => ipcRenderer.invoke("sps:validate-portraits", dataDir),
  // Multi-section mod-data validators against live dataDir. Returns
  // { namelistEmpty, namelistSingle, stratTraitRefs, stratAncillaryRefs,
  //   stratUnitRefs, factionCulture } — each with `issues` + `error`.
  validateModExtra: (dataDir) => ipcRenderer.invoke("sps:validate-mod-extra", dataDir),
  // Per-faction captain banner file coverage: each faction needs
  // captain_portrait_<X>.tga.dds + captain_card_<X>.tga (+ rebel variants).
  // Missing files cause record.m_card_path.is_valid() Failed crashes.
  validateCaptainBanners: (dataDir) => ipcRenderer.invoke("sps:validate-captain-banners", dataDir),
  // Auto-fix: seed missing captain banner files from a same-culture donor
  // faction. Returns { copied: N, copies: [...], noDonor: [...], error }.
  autofixCaptainBanners: (dataDir) => ipcRenderer.invoke("sps:autofix-captain-banners", dataDir),
  // descr_regions consistency: regions in strat not in regions file, settlement
  // mismatches, duplicate tile colors, orphan regions.
  validateDescrRegions: (dataDir) => ipcRenderer.invoke("sps:validate-descr-regions", dataDir),
  // Region scrolls: every settlement should carry
  // `building { type hinterland_region region_base }`. Returns
  // { missing: [{region, line}], total, error }.
  validateRegionScrolls: (dataDir) => ipcRenderer.invoke("sps:validate-region-scrolls", dataDir),
  // descr_sm_factions structural completeness per faction.
  validateSmFactions: (dataDir) => ipcRenderer.invoke("sps:validate-sm-factions", dataDir),
  // Auto-fix: seed missing data/ui/<target>/portraits/portraits/young|old
  // dirs by copying tgas from any culture that has them populated.
  autofixPortraits: (dataDir) => ipcRenderer.invoke("sps:autofix-portraits", dataDir),
  // AOR coverage report: { aors: [{name, count}, ...], error }. Sorted by
  // descending region count. Renderer compares against its own primary/
  // secondary maps to surface uncovered tags.
  aorCoverage: (dataDir) => ipcRenderer.invoke("sps:aor-coverage", dataDir),
  // EDB hidden_resource cross-ref vs descr_regions.
  validateEdbResources: (dataDir) => ipcRenderer.invoke("sps:validate-edb-resources", dataDir),
  // Building constructed-image coverage per culture, plus auto-fix that
  // copies the base image to the _constructed slot.
  validateBuildingImages: (dataDir) => ipcRenderer.invoke("sps:validate-building-images", dataDir),
  autofixBuildingImages: (dataDir) => ipcRenderer.invoke("sps:autofix-building-images", dataDir),
  // Mercenary / unit type localization coverage.
  validateUnitLocalization: (dataDir) => ipcRenderer.invoke("sps:validate-unit-localization", dataDir),
  // Per-faction unit image coverage + cross-faction auto-fix.
  validateUnitImages: (dataDir) => ipcRenderer.invoke("sps:validate-unit-images", dataDir),
  autofixUnitImages: (dataDir) => ipcRenderer.invoke("sps:autofix-unit-images", dataDir),
  // Reads RTW's message_log.txt and counts known cosmetic / engine-internal
  // patterns + extracts undefined script toggles + missing localised strings.
  scanLogWarnings: (logPath) => ipcRenderer.invoke("sps:scan-log-warnings", logPath),
  // Texture power-of-2 dimension check across ancillary + building TGAs.
  validateTextureDimensions: (dataDir) => ipcRenderer.invoke("sps:validate-texture-dimensions", dataDir),
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
  // Submod drift checker: pick a submod folder + scan it for stale overrides of the base mod.
  selectSubmodFolder: () => ipcRenderer.invoke("select-submod-folder"),
  scanSubmodDrift: (baseDir, submodDir) => ipcRenderer.invoke("scan-submod-drift", baseDir, submodDir),
  // Export-instead-of-overwrite: when given a folder, subsequent "Save to Mod"
  // writes are redirected under it (the live mod is left untouched). Pass null
  // to turn it off (back to in-place overwrite). Returns { ok, dir }.
  setModExportDir: (dir) => ipcRenderer.invoke("set-mod-export-dir", dir),
  // Scan a known path WITHOUT a dialog. Used to auto-reimport on launch
  // from the last-imported location.
  scanFolder: (dir) => ipcRenderer.invoke("scan-folder", dir),
  readFile: (filePath) => ipcRenderer.invoke("read-file", filePath),
  readFileBinary: (filePath) => ipcRenderer.invoke("read-file-binary", filePath),
  saveFile: (name, content) => ipcRenderer.invoke("save-file", name, content),
  // User-chosen path via Save As dialog. Returns the saved path or null on cancel.
  saveFileAs: (defaultName, content, filterDesc, filterExts) =>
    ipcRenderer.invoke("save-file-as", defaultName, content, filterDesc, filterExts),
  // Unified save cracker — call this instead of touching saveCrackerExtras
  // directly. Returns { header, playerFaction, factions:{[name]:{treasury,regionCount,...,diplomacy}}, settlements, characters, _stats }
  // or { error } on failure.
  crackSave: (savePath, modDataDir) => ipcRenderer.invoke("crack-save", savePath, modDataDir),
  // Financial Overview economy breakdown (src/economyParser.parseFinancialOverview):
  // { byFaction:{ [name]:{ income:{farming,mining,trade,merchants,taxes,other,total},
  // expenditure:{wages,army_upkeep,recruitment,construction,other,total}, net, treasury,
  // estimatedNextTurn } }, playerFaction, turn } or { error }. The REAL stored in-game
  // numbers. Computed on demand per save-file change (cracks the save).
  getSaveEconomy: (savePath, modDataDir) => ipcRenderer.invoke("get-save-economy", savePath, modDataDir),
  // Army-setup analysis for one faction: descr_strat army + upkeep + balance,
  // recruitable pool (full RIS gating), retraining. { faction, denari, armyUpkeep,
  // characters, settlements, summary } or { error }.
  getArmySetup: (faction, modDataDir, floor) => ipcRenderer.invoke("get-army-setup", faction, modDataDir, floor),
  getCampaignFactions: (modDataDir) => ipcRenderer.invoke("get-campaign-factions", modDataDir),
  getSavePlayerBudget: (savePath) => ipcRenderer.invoke("get-save-player-budget", savePath),
  getAllFactionBudgets: (savePath, modDataDir, playerHint) => ipcRenderer.invoke("get-all-faction-budgets", savePath, modDataDir, playerHint),
  getOptimalTaxes: (savePath, modDataDir, playerHint, economyPath) => ipcRenderer.invoke("get-optimal-taxes", savePath, modDataDir, playerHint, economyPath),
  getStratTaxPlan: (modDataDir, faction, savePath) => ipcRenderer.invoke("get-strat-tax-plan", modDataDir, faction, savePath),
  getTurn1Budget: (modDataDir, faction, savePath, asAI, taxH, corr, humanDifficulty) => ipcRenderer.invoke("get-turn1-budget", modDataDir, faction, savePath, asAI, taxH, corr, humanDifficulty),
  getMercenaryPools: (modDataDir) => ipcRenderer.invoke("get-mercenary-pools", modDataDir),
  getFactionMetrics: (modDataDir, faction) => ipcRenderer.invoke("get-faction-metrics", modDataDir, faction),
  getFactionReligions: (modDataDir) => ipcRenderer.invoke("get-faction-religions", modDataDir),
  analyzeAiMovement: (logPath, modDataDir, savePath) => ipcRenderer.invoke("analyze-ai-movement", logPath, modDataDir, savePath),
  pickAiSaveFile: () => ipcRenderer.invoke("pick-ai-save-file"),
  saveAiBaseline: (result, label) => ipcRenderer.invoke("save-ai-baseline", result, label),
  exportAiReport: (result, suggestedName) => ipcRenderer.invoke("export-ai-report", result, suggestedName),
  onAiMovementProgress: (handler) => {
    const fn = (_e, prog) => handler(prog);
    ipcRenderer.on("ai-movement-progress", fn);
    return () => ipcRenderer.removeListener("ai-movement-progress", fn);
  },
  listAiBaselines: () => ipcRenderer.invoke("list-ai-baselines"),
  compareAiBaseline: (baselineFile, result) => ipcRenderer.invoke("compare-ai-baseline", baselineFile, result),
  deleteAiBaseline: (baselineFile) => ipcRenderer.invoke("delete-ai-baseline", baselineFile),
  addRegionToMercPool: (modDataDir, poolName, region) => ipcRenderer.invoke("add-region-to-merc-pool", modDataDir, poolName, region),
  applyArmySwap: (modDataDir, faction, character, oldUnit, newUnit) => ipcRenderer.invoke("apply-army-swap", modDataDir, faction, character, oldUnit, newUnit),
  applyAddGarrison: (modDataDir, faction, settlementName, unitName) => ipcRenderer.invoke("apply-add-garrison", modDataDir, faction, settlementName, unitName),
  applyAddArmyUnits: (modDataDir, faction, character, unitNames) => ipcRenderer.invoke("apply-add-army-units", modDataDir, faction, character, unitNames),
  applyReplaceGarrison: (modDataDir, faction, settlementName, removeUnits, addUnits) => ipcRenderer.invoke("apply-replace-garrison", modDataDir, faction, settlementName, removeUnits, addUnits),
  applyUpgradeFix: (modDataDir, faction, character, opts) => ipcRenderer.invoke("apply-upgrade-fix", modDataDir, faction, character, opts),
  // Per-faction fog-of-war / explored map (corrected 1020×700 grid). Returns
  // { faction, width:1020, height:700, grid: Uint8Array(714000), coverage, exploredCount }
  // or { error }. Record→faction matched robustly by settlement coverage.
  getFactionVision: (savePath, modDataDir, factionName) => ipcRenderer.invoke("get-faction-vision", savePath, modDataDir, factionName),
  // Dev autosave history persisted to a userData file (survives restart; too
  // big for localStorage). readAutosaves → { autosaves:[...] }; writeAutosaves(json).
  readAutosaves: () => ipcRenderer.invoke("read-autosaves"),
  writeAutosaves: (json) => ipcRenderer.invoke("write-autosaves", json),
  // Resolvable faction list for the fog picker: { factions: [{faction, explored}] }
  // — only factions whose vision record resolves from this save (no rebels/slave/
  // all-seeing/empty), so every dropdown option is guaranteed to work.
  getVisionFactionList: (savePath, modDataDir) => ipcRenderer.invoke("get-vision-faction-list", savePath, modDataDir),
  // Trade-network derivation (src/tradeNetwork.js). Returns { trade: { settlements:
  // { name: { faction, landPartners[], seaPartners[], partners[], tradeScoreHypothesis,
  // topPartnersHypothesis[] } } }, ... } or { error }. Pass savePath=null to reuse the
  // live watcher's in-memory save buffer. Computed on demand (slow: walks the map TGA).
  crackTradeNetwork: (savePath, modDataDir, campaign) => ipcRenderer.invoke("crack-trade-network", savePath, modDataDir, campaign),
  // Campaign-timeline scan (UI batch 2). Cracks every .sav under `dir`, sorts by
  // cracked turn, returns { scanned, errors, campaigns:[{player, saves, turns[],
  // deltas[]}] } or { error }. opts = { faction?, allCampaigns? }. Heavy/on-demand.
  scanSavesTimeline: (dir, modDataDir, opts) => ipcRenderer.invoke("scan-saves-timeline", dir, modDataDir, opts),
  writeBinaryFile: (name, dataBuf) => ipcRenderer.invoke("write-binary-file", name, dataBuf),
  copyFile: (src, destName) => ipcRenderer.invoke("copy-file", src, destName),
  readCampaignFile: (name) => ipcRenderer.invoke("read-campaign-file", name),
  addgenGetData: () => ipcRenderer.invoke("addgen-get-data"),
  addgenApply: (selection) => ipcRenderer.invoke("addgen-apply", selection),
  getLiveStartingArmies: (modDataDir, campaignDir) => ipcRenderer.invoke("get-live-starting-armies", modDataDir, campaignDir),
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
  getVanillaIconsDir: () => ipcRenderer.invoke("get-vanilla-icons-dir"),
  readVanillaStrat: () => ipcRenderer.invoke("read-vanilla-strat"),
  readVanillaSmFactions: () => ipcRenderer.invoke("read-vanilla-sm-factions"),
  getVanillaFactionDisplayNames: () => ipcRenderer.invoke("get-vanilla-faction-display-names"),
  resolveBuildingIcon: (modDataDir, culture, levelName, chainName) =>
    ipcRenderer.invoke("resolve-building-icon", modDataDir, culture, levelName, chainName),
  resolveBuildingIconsBulk: (modDataDir, list) =>
    ipcRenderer.invoke("resolve-building-icons-bulk", modDataDir, list),
  resolveBuildingBanner: (modDataDir, culture, levelName, chainName) =>
    ipcRenderer.invoke("resolve-building-banner", modDataDir, culture, levelName, chainName),
  replaceBuildingIcon: (modDataDir, culture, levelName, chainName, sourceFile) =>
    ipcRenderer.invoke("replace-building-icon", modDataDir, culture, levelName, chainName, sourceFile),
  revertBuildingIcon: (destPath, backupPath) =>
    ipcRenderer.invoke("revert-building-icon", destPath, backupPath),
  resolveUnitCard: (modDataDir, faction, unitName, dictionary) =>
    ipcRenderer.invoke("resolve-unit-card", modDataDir, faction, unitName, dictionary),
  resolveUnitCardsBulk: (modDataDir, items) =>
    ipcRenderer.invoke("resolve-unit-cards-bulk", modDataDir, items),
  iconCachePutBulk: (items) => ipcRenderer.invoke("icon-cache-put-bulk", items),
  iconCachePruneUnder: (dir) => ipcRenderer.invoke("icon-cache-prune-under", dir),
  getMineProspects: (modDataDir) => ipcRenderer.invoke("get-mine-prospects", modDataDir),
  getRegionAdjacency: (modDataDir) => ipcRenderer.invoke("get-region-adjacency", modDataDir),
  getTradeLanes: (modDataDir) => ipcRenderer.invoke("get-trade-lanes", modDataDir),
  getRoadRegions: (modDataDir) => ipcRenderer.invoke("get-road-regions", modDataDir),
  laneCacheGet: (modDataDir, kind, sig) => ipcRenderer.invoke("lane-cache-get", modDataDir, kind, sig),
  laneCacheSet: (modDataDir, kind, sig, geom) => ipcRenderer.invoke("lane-cache-set", modDataDir, kind, sig, geom),
  explainSettlementIncome: (modDataDir, faction, region) =>
    ipcRenderer.invoke("explain-settlement-income", modDataDir, faction, region),
  econBaselineCapture: (modDataDir, name) => ipcRenderer.invoke("econ-baseline-capture", modDataDir, name),
  econBaselineList: () => ipcRenderer.invoke("econ-baseline-list"),
  econBaselineDiff: (modDataDir, name, thresholdPct) => ipcRenderer.invoke("econ-baseline-diff", modDataDir, name, thresholdPct),
  exportHtmlReport: (html, suggestedName) => ipcRenderer.invoke("export-html-report", html, suggestedName),
  previewHtmlReport: (html) => ipcRenderer.invoke("preview-html-report", html),
  compareSaves: (modDataDir, savePathA, savePathB) => ipcRenderer.invoke("compare-saves", modDataDir, savePathA, savePathB),
  analyzeCampaign: (modDataDir, saveDirOrTimeline) => ipcRenderer.invoke("analyze-campaign", modDataDir, saveDirOrTimeline),
  rankBuildOrder: (modDataDir, faction, region) => ipcRenderer.invoke("rank-build-order", modDataDir, faction, region),
  lintMod: (modDataDir) => ipcRenderer.invoke("lint-mod", modDataDir),
  projectPopulation: (modDataDir, faction, turns) => ipcRenderer.invoke("project-population", modDataDir, faction, turns),
  locateDefinition: (modDataDir, query) => ipcRenderer.invoke("locate-definition", modDataDir, query),
  runWhatIf: (modDataDir, edits, thresholdPct) => ipcRenderer.invoke("run-what-if", modDataDir, edits, thresholdPct),
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
  factoryReset: () => ipcRenderer.invoke("factory-reset"),
  getModFileMtimes: (modDataDir) => ipcRenderer.invoke("get-mod-file-mtimes", modDataDir),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  // Save file watcher
  saveWatchStart: (saveDir, pinnedSave) => ipcRenderer.invoke("save-watch-start", saveDir, pinnedSave || null),
  getLatestSaveMtime: (saveDir) => ipcRenderer.invoke("get-latest-save-mtime", saveDir),
  listSaves: (saveDir) => ipcRenderer.invoke("list-saves", saveDir),
  selectSaveFile: (saveDir) => ipcRenderer.invoke("select-save-file", saveDir),
  selectSaveFiles: (saveDir) => ipcRenderer.invoke("select-save-files", saveDir),
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
