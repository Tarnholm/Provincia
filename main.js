// main.js
const { app, BrowserWindow, Menu, session, dialog, ipcMain, shell, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { Worker } = require("worker_threads");
const pathSafety = require("./src/pathSafety.js");
const {
  parseWorldObjectPositions,
  parseCharacterMetadataByUuid,
  findDescrStratAnchorEnd, // eslint-disable-line no-unused-vars
  readCurrentYearFromSave,
  readTurnFromSave,
  readUtf16Name,
} = require("./src/saveBinaryReaders.js");
const { encodeTga32BGRA } = require("./src/tgaCodec.js");
const { diffSaveData, isEndAutosave } = require("./src/saveDiff.js");
const { gameTextCRLF, hashName, makeLRU, parseTextDictionary } = require("./src/mainUtils.js");

// RTW:R game TEXT files MUST be written with CRLF line endings. Writing LF
// silently breaks the engine's descr_* parsers ("Expected faction list starting
// with playable" / "Expected start date of campaign") and stops the campaign
// loading. This single chokepoint forces CRLF for every `.txt` write regardless
// of the source file's or caller's line endings; binary/JSON writes pass through
// untouched. Route any game-text writeFileSync through this — never trust the
// caller or a "preserve source EOL" heuristic (that's what kept re-shipping LF).
// gameTextCRLF moved to src/mainUtils.js (pure, imported at top).
const { autoUpdater } = require("electron-updater");

// Spawn the v1-character parser in a worker so it runs in parallel with
// the main thread's parseSaveData. Worker is short-lived (one parse per
// invocation, then terminate) — the spawn cost (~30-50ms) is small
// relative to the ~1-1.5s the byte-by-byte scan saves us.
function findCharsInWorker(saveBuf, nameLookup, traitNames, traitEpithets) {
  return new Promise((resolve, reject) => {
    let workerPath = path.join(__dirname, "src", "charactersWorker.js");
    let worker;
    try { worker = new Worker(workerPath); }
    catch (e) { reject(e); return; }
    worker.once("message", (msg) => {
      worker.terminate();
      if (msg && msg.ok) resolve(msg.characters);
      else reject(new Error(msg && msg.error ? msg.error : "worker failed"));
    });
    worker.once("error", (err) => { worker.terminate(); reject(err); });
    worker.postMessage({ saveBuf, nameLookup, traitNames, traitEpithets });
  });
}

// Same pattern for the buildings parser — runs in parallel with the
// chars worker AND parseSaveData. Worth ~200-400ms off the main-thread
// time on a typical save reload.
function parseBuildingsInWorker(saveBuf) {
  return new Promise((resolve, reject) => {
    let workerPath = path.join(__dirname, "src", "buildingsWorker.js");
    let worker;
    try { worker = new Worker(workerPath); }
    catch (e) { reject(e); return; }
    worker.once("message", (msg) => {
      worker.terminate();
      if (msg && msg.ok) resolve({
        buildingsByCity: msg.buildingsByCity,
        queuedByCity: msg.queuedByCity,
        recruitingByCity: msg.recruitingByCity || {},
        buildingQueueByCity: msg.buildingQueueByCity || {},
      });
      else reject(new Error(msg && msg.error ? msg.error : "worker failed"));
    });
    worker.once("error", (err) => { worker.terminate(); reject(err); });
    // Build the union whitelist on the main thread (it's tiny — a set
    // of chain names) and pass as an array. Worker reconstitutes a Set.
    let whitelist = modBuildingChains;
    if (!whitelist || whitelist.size === 0) {
      whitelist = getBaselineBuildingChains();
    } else {
      const merged = new Set(whitelist);
      for (const k of getBaselineBuildingChains()) merged.add(k);
      whitelist = merged;
    }
    worker.postMessage({
      saveBuf,
      whitelist: Array.from(whitelist),
      maxLevels: modChainMaxLevels || {},
    });
  });
}

// Pin the AppUserModelID so taskbar / Start-Menu pins survive updates.
// NSIS sets the installed shortcut's AppUserModelID from package.json's
// `appId`. Without an explicit call here, the running Electron process
// would register under a default AppUserModelID, mismatched with the
// shortcut — which is what Windows tracks pins against. Setting it to
// the same value on every launch keeps the pin anchored to the new exe
// after an electron-updater reinstall.
if (process.platform === "win32") {
  try { app.setAppUserModelId("com.example.interactive-map"); } catch {}
}

// ── Logging ──────────────────────────────────────────────────────────
// Writes all console output + errors to a log file the user can send.
// Location: <userData>/provincia.log. Reset each app launch (keep last one
// in .prev for crash forensics).
// 0.9.820: logging is DURABLE. We use a synchronous file descriptor
// (fs.writeSync) instead of a buffered createWriteStream, so every line is
// handed to the OS the moment it's logged. That means if the app hangs (e.g.
// the game CTDs mid-AI-run and Provincia's watchers wedge), the log up to the
// hang is already on disk — a buffered stream would lose whatever was still
// sitting in its in-memory buffer. A periodic fsync flushes the OS cache to
// physical disk so the log also survives a hard reboot, and we flush on exit.
let _logFd = null;            // append-mode file descriptor (synchronous)
let _logPath = null;
let _logDirty = false;        // unsynced writes pending an fsync?
let _fsyncTimer = null;
function _writeLog(str) {
  if (_logFd == null) return;
  try { fs.writeSync(_logFd, str); _logDirty = true; } catch {}
}
function _flushLog() {
  if (_logFd != null && _logDirty) {
    try { fs.fsyncSync(_logFd); _logDirty = false; } catch {}
  }
}
function initLogging() {
  try {
    _logPath = path.join(app.getPath("userData"), "provincia.log");
    // Keep the last TWO generations: this launch's `provincia.log` plus the
    // previous run's `provincia.log.prev`. These files live in userData and
    // are NOT touched by reboots — only this rotation clears them, and it
    // only ever discards the run-before-last. So after a crash you always
    // have the crashed session (current) + the run before it (.prev).
    const prev = _logPath + ".prev";
    try { if (fs.existsSync(_logPath)) fs.renameSync(_logPath, prev); } catch {}
    // Open synchronously in append mode; writeSync lands each line in the OS
    // immediately (survives an app-level hang without needing a flush).
    _logFd = fs.openSync(_logPath, "a");
    _writeLog(`\n=== Provincia v${app.getVersion()} launched ${new Date().toISOString()} ===\n`);
    _flushLog();
    const fmt = (level, args) => {
      const stamp = new Date().toISOString().slice(11, 23);
      const text = args.map((a) => {
        if (a instanceof Error) return (a.stack || a.message);
        if (typeof a === "object") { try { return JSON.stringify(a); } catch { return String(a); } }
        return String(a);
      }).join(" ");
      return `[${stamp}] [${level}] ${text}\n`;
    };
    for (const lvl of ["log", "info", "warn", "error"]) {
      const orig = console[lvl].bind(console);
      console[lvl] = (...args) => {
        _writeLog(fmt(lvl.toUpperCase(), args));
        orig(...args);
      };
    }
    // Periodically flush the OS cache to physical disk so the log survives a
    // hard reboot (the user had to power-cycle after a game crash). Cheap: an
    // fsync only fires when there's something dirty. Unref'd so it never keeps
    // the app alive / blocks quit.
    _fsyncTimer = setInterval(_flushLog, 2000);
    if (_fsyncTimer.unref) _fsyncTimer.unref();
    // Final flush on the way out, however we exit.
    process.on("exit", _flushLog);
    process.on("uncaughtException", (err) => {
      console.error("UNCAUGHT EXCEPTION:", err);
      _flushLog();
    });
    process.on("unhandledRejection", (err) => {
      console.error("UNHANDLED REJECTION:", err);
      _flushLog();
    });
  } catch (e) {
    // If logging fails, don't kill the app.
  }
}
initLogging();
// 0.9.865: set true once the app is genuinely quitting (or installing an update)
// so the renderer-crash auto-reload handler doesn't fight a real shutdown.
let _appQuitting = false;
try { app.on("before-quit", () => { _appQuitting = true; _flushLog(); }); } catch {}
try { app.on("will-quit", () => { _appQuitting = true; }); } catch {}

// IPC: receive log messages from the renderer and write to the same log.
ipcMain.handle("log-message", async (_event, level, text) => {
  try {
    const stamp = new Date().toISOString().slice(11, 23);
    _writeLog(`[${stamp}] [RENDERER-${(level || "log").toUpperCase()}] ${text}\n`);
  } catch {}
});

// IPC: return the log file path (renderer can show it to the user).
ipcMain.handle("get-log-path", () => _logPath);

// IPC: open the log file's containing folder in the OS file manager.
ipcMain.handle("reveal-log-file", () => {
  try {
    if (_logPath && fs.existsSync(_logPath)) shell.showItemInFolder(_logPath);
    return true;
  } catch { return false; }
});
// ─────────────────────────────────────────────────────────────────────

// Save-file parsers — decode characters (names, traits, family, region),
// units (army composition, soldier counts), and settlement built-buildings
// from RTW:R save binaries. See calibration/PROGRESS_LOG.md for the reverse
// engineering notes.
const { findCharacterRecords, findCharacterRegion, countDeadPoolRecords } = require("./src/characterParser.js");
const { findScriptedCharacters: findCharsV2 } = require("./src/characterParserV2.js");
const { parseLine: parseLogLineV2 } = require("./src/messageLogParser.js");
const { findUnitRecords } = require("./src/unitParser.js");
const { parseSettlements } = require("./src/buildingParser.js");
const { buildInitialOwnership } = require("./src/ownershipParser.js");
const { resolveCurrentOwners, findSettlementGovernors } = require("./src/saveOwnershipParser.js");
const { findAllSettlementMarkers } = require("./src/buildingParser.js");
const { parseSieges } = require("./src/siegeParser.js");
const { parseSettlementFields } = require("./src/settlementFieldsParser.js");
const { parseLandmarks } = require("./src/landmarkParser.js");
// Live-watch surfacing of already-cracked save data (UI batch 2, 2026-05-31):
//  - event LOG (end-of-turn scroll) → "last turn" diff (src/eventLogParser.js)
//  - event SCHEDULE (disaster / scripted-event table) → list + map markers
//  - faction KNOWLEDGE (per-faction scouting summary) → AI fog readout
const { parseEventLog: cxParseEventLog } = require("./src/eventLogParser.js");
const { buildLastTurnSummary } = require("./src/lastTurnSummary.js");
const { parseEventSchedule: cxParseEventSchedule } = require("./src/eventScheduleParser.js");
const { parseFactionKnowledge: cxParseFactionKnowledge } = require("./src/factionKnowledgeParser.js");
const { findFactionRecords, summarizeFactionArray } = require("./src/factionRecordParser.js");
const { findLuaCounters, indexCountersByName } = require("./src/luaCounterParser.js");
const { buildStartingArmiesFromMod } = require("./src/startingArmiesBuilder.js");
const {
  parseHeader: cxParseHeader,
  parseFactionDiscoveredBitmask: cxParseBitmask,
  parseFactionConfigRecords: cxParseFactionConfig,
  parseModInfo: cxParseModInfo,
  parseCharacterExtras: cxParseCharacterExtras,
  attachMapCoords: cxAttachMapCoords,
  bridgeV1Traits: cxBridgeV1Traits,
  resolvePortraitsByCharacter: cxResolvePortraits,
  parseFactionTreasuries: cxParseTreasuries,
  parseFactionTreasuryHistory: cxParseTreasuryHistory,
  identifyFactionRecordOwners: cxIdentifyRecordOwners,
  identifyPlayerFactionFromSave: cxIdentifyPlayerFromSave,
  parseFactionDiplomacy: cxParseDiplomacy,
  parseAllFactionDiplomacy: cxParseAllDiplomacy,
  parseDiplomacyMatrix: cxParseDiplomacyMatrix,
  buildFamilyTreeMaps: cxBuildFamilyMaps,
  parseReligionByCity: cxParseReligion,
  deriveEngineFactionOrder: cxDeriveEngineOrder,
  countEngineCharacters,
} = require("./src/saveCrackerExtras.js");
const descrGen = require("./src/descrStratGeneral.js");
// App-wide self-check (src/diagnostics.js, pure/read-only). Run once per live
// save-watch load to emit a `[diag]` summary into provincia.log — so the bug
// classes that previously only surfaced in-game (nomad portraits, public-order
// divergence, empty war lists, garrison dup, family under-read, turn/year drift,
// unit mis-attribution) show up in the log on every load. CommonJS module.
const { runDiagnostics: runAppDiagnostics, logDiagnostics: logAppDiagnostics } = require("./src/diagnostics.js");

// Cache for mod data (names_lookup, traits, surnames). Populated lazily when
// the renderer calls "characters-init" with the mod data directory.
let modNameLookup = null;
// Bounded LRU for parser caches keyed by `${modDataDir}|...`. Without a
// bound the cache grows every time the user switches mods (each path is a
// unique key, parsed result is held forever). 16 entries is plenty —
// covers vanilla + Alexander + a handful of mod variants.
// makeLRU moved to src/mainUtils.js (pure, imported at top).
let modTraitNames = null;
let modDescrStratSurnames = null;
let modDescrStratCharByName = null; // "firstName|faction" → { x, y, lastName, faction } from descr_strat
// Per-region map of starting characters with their descr_strat traits /
// ancillaries / age / tags. Populated by loadModCharacterData when a mod
// folder is loaded; exposed to the renderer via IPC so the region panel
// can show generals + traits without a save loaded. Works with any mod
// or vanilla — the parser only depends on the standard descr_strat
// `traits Foo 1, ...` / `ancillaries ...` line shape.
let modDescrStratCharactersByRegion = null;
// Family tree from descr_strat — used when no live save is loaded. Populated
// alongside modDescrStratCharactersByRegion. Layout:
//   { byFaction: { factionId: {
//       members: [ { firstName, lastName, gender, age, alive, tags, role,
//                    isCharacter (true if has its own `character` line) } ],
//       relatives: [ { husband, wife, children: [name, ...] } ]
//     }} }
let modDescrStratFamilies = null;
let modDescrStratCharsByFirstName = null; // "firstName" → [{ x, y, lastName, faction }, ...] (multi-faction lookup)
let modUnitOfficerCounts = null; // { unitName: officerCount } from EDU — added to in-save soldier counts to match in-game UI
let modBuildingChains = null;
let modChainMaxLevels = null; // { chainName: number_of_levels } from EDB
let modChainCategories = null; // { chainName: "trade" | "government" | ... } from EDB `icon` field
// 0.9.465: faction → [homeland_<X>, ...] parsed from EDB `alias <X>_homeland`
// blocks. Used by the Homeland map mode to colour regions by ownership /
// foreign-held / wrong-gov status. Live data from the mod, not the stale
// bundled `homelands.json`.
let modHomelandsByFaction = null;
let modFactionDisplayMap = null; // { lowercase display name → internal faction id }
let modFactionDisplayNames = null; // { internal faction id → display name } — used in UI
let modFactionCultures = null; // { factionId: cultureFolderName } — "roman", "greek", "barbarian", etc.
let modFactionOrder = null; // [factionId, ...] in descr_sm_factions.txt declaration order — index = save's cracked factionId byte
let modAiPersonalityOrder = null; // [personalityName, ...] in feral_descr_ai_personality.txt order — index = save's cracked aiPersonalityIndex byte
let modAiByFaction = null; // { factionName: "ai_<type>" } parsed from descr_strat — authoritative starting AI personality per faction. Used as fallback for save records where the cracked aiPersonalityIndex is missing (sub=8 layout) or wrong.
let modInitialOwnerByCity = null; // { settlementName → factionId } from descr_strat (turn 0 ground truth)
// 0.9.437: per-settlement descr_strat `faction_creator` — the rebel-default
// FOR THAT SETTLEMENT (which faction it joins on rebellion). Distinct from
// `modInitialOwnerByCity` which captures the CURRENT owner (descr_strat's
// parent `faction <id>` block). Loyalist map mode compares this to
// descr_regions field 3 to find settlements whose homelands are loyal.
let modInitialCreatorByCity = null; // { settlementName → factionId }
let modRegionToCity = null; // { regionName → settlementName } from descr_regions — used to bridge save's region-keyed unit data to city-keyed owner data
// Trait → epithet (cognomen) override map. RTW grants an "Epithet" keyword
// at certain trait levels (e.g. RomanConquerorMessapians L2 → "Messapivs").
// The save stores the character's BIRTH surname (e.g. "Gabinius"); the in-
// game UI overrides it with the highest-priority epithet from active traits.
// Without this table the app shows the birth surname while the user sees
// the epithet ("Aulus Gabinius" vs "Aulus Messapivs"). Built from
// export_descr_character_traits.txt + text/export_vnvs.txt.
//   modTraitEpithets[traitName] = [{ level, key, text }, …] in level order
let modTraitEpithets = null;
// Per-level trait data parsed from export_descr_character_traits.txt +
// export_vnvs.txt. Shape: { traitName: [{ levelIdx, levelName, threshold,
// effects: [{ name, value }], desc, effectsDesc }, ...] }. Loaded once
// at mod init and shipped to the renderer so the right-click character
// info panel can show actual trait pictures + effects + descriptions
// instead of just `level N`. (0.9.417)
let modTraitLevels = null;
// 0.9.433: `Hidden` flag per trait from export_descr_character_traits.txt.
// Set when a trait block declares `Hidden`. Engine doesn't show those in
// the in-game character info, so the renderer filters them out unless
// devMode is on.
let modTraitHidden = null;
// 0.9.437: which character-types each trait is allowed on (engine
// `Characters` line — family / admiral / spy / assassin / diplomat / all)
// and which cultures it's forbidden on (engine `ExcludeCultures`).
// Used to filter the Add Trait picker so it only offers options the engine
// would actually accept.
let modTraitCharacters = null;
let modTraitExcludeCultures = null;
// 0.9.434: track the active mod's data dir so trait-edit IPC knows where
// to find descr_strat.txt to patch.
let activeModDataDir = null;
// Export mode: when non-null, all mod-file writes are redirected UNDER this
// folder (preserving the mod-relative path) instead of overwriting the live
// mod in place. Set via the `set-mod-export-dir` IPC from the renderer's
// pending-changes review modal. null = OFF = overwrite the live mod exactly
// as before (the default and the byte-identical no-op path). See modOut().
let _modExportDir = null;
// Redirect a mod-file absolute path to the export dir when export mode is on.
// Returns the path UNCHANGED when export is off (null _modExportDir) or when
// the path is not under the active mod (so non-mod writes are never touched).
// Creates the destination's parent dir on demand so the first write succeeds.
function modOut(absModPath) {
  if (!_modExportDir || !activeModDataDir) return absModPath;
  const rel = path.relative(activeModDataDir, absModPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return absModPath; // not under the mod → leave as-is
  const dest = path.join(_modExportDir, rel);
  try { fs.mkdirSync(path.dirname(dest), { recursive: true }); } catch {}
  return dest;
}
// Ancillary names indexed by id (0-based), loaded from
// export_descr_ancillaries.txt. ID 0 = labrys_maker, ID 1 = saffron_merchant,
// ... 1092 entries in RIS imperial. Decoded by save-cracker session 6:
// ancillary IDs sit inline in the character record between the trait block
// and portrait paths as [u16=0, u16=ancId] pairs.
let modAncillaryNames = null;
// 0.9.420: Per-ancillary metadata parsed from export_descr_ancillaries.txt.
// Shape: { name: { image, descKey, effectsKey, effects: [{name,value}],
// desc, effectsDesc } }. The `image` field is the actual TGA filename
// (without extension) — descr_strat's ancillary name is usually NOT the
// filename (e.g. `Ancillary poet` uses `Image philosopher2.tga`).
let modAncillaryData = null;

// File watcher for external edits to the active mod, so Provincia can hot-reload
// without a manual re-import. The main case is crosstalk with Manipula (the
// recruitment tool), which writes export_descr_buildings.txt in the same mod
// folder. We watch the directory (not the file) so atomic save-and-rename keeps
// firing, and filter by basename. Provincia never writes EDB itself, so there's
// no self-trigger loop.
let modFileWatchers = [];
const modWatchDebounce = {};
const WATCHED_MOD_FILES = ["export_descr_buildings.txt"];
function clearModWatchers() {
  for (const w of modFileWatchers) { try { w.close(); } catch {} }
  modFileWatchers = [];
}
function setupModWatcher(modDataDir) {
  clearModWatchers();
  if (!modDataDir || !fs.existsSync(modDataDir)) return;
  try {
    const w = fs.watch(modDataDir, (_eventType, filename) => {
      if (!filename) return;
      const base = path.basename(String(filename));
      if (!WATCHED_MOD_FILES.includes(base)) return;
      clearTimeout(modWatchDebounce[base]);
      modWatchDebounce[base] = setTimeout(() => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) win.webContents.send("mod-file-changed", { file: base });
        console.log(`[mod-watch] ${base} changed on disk → notified renderer`);
      }, 400);
    });
    modFileWatchers.push(w);
    console.log(`[mod-watch] watching ${modDataDir} for ${WATCHED_MOD_FILES.join(", ")}`);
  } catch (e) {
    console.warn("[mod-watch] failed to watch", modDataDir, e && e.message);
  }
}

function loadModCharacterData(modDataDir) {
  activeModDataDir = modDataDir;
  try { setupModWatcher(modDataDir); } catch (e) { console.warn("[mod-watch] setup failed:", e && e.message); }
  const nameLookupPath = path.join(modDataDir, "descr_names_lookup.txt");
  const traitsPath = path.join(modDataDir, "export_descr_character_traits.txt");
  const ancillariesPath = path.join(modDataDir, "export_descr_ancillaries.txt");
  const edbPath = path.join(modDataDir, "export_descr_buildings.txt");
  const descrStratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
  if (!fs.existsSync(nameLookupPath) || !fs.existsSync(traitsPath)) {
    throw new Error("Mod character data files missing in " + modDataDir);
  }
  // Optional: ancillaries. If missing, ancillary names just render as `#<id>`.
  // 0.9.420: also capture per-ancillary Image, Description, EffectsDescription,
  // and Effect lines so the right-click info panel can render the actual icon
  // file (descr_strat's ancillary name is NOT the image filename — e.g.
  // `Ancillary poet` has `Image philosopher2.tga`) plus the effects + desc.
  modAncillaryNames = [];
  modAncillaryData = {}; // { name: { image, descKey, effectsKey, effects: [{name,value}], excludeCultures, unique } }
  if (fs.existsSync(ancillariesPath)) {
    const lines = fs.readFileSync(ancillariesPath, "utf8").split(/\r?\n/);
    let cur = null;
    for (const line of lines) {
      const m = line.match(/^Ancillary\s+(\S+)/);
      if (m) {
        modAncillaryNames.push(m[1]);
        cur = { image: null, descKey: null, effectsKey: null, effects: [], excludeCultures: null, unique: false };
        modAncillaryData[m[1]] = cur;
        continue;
      }
      if (!cur) continue;
      const im = line.match(/^\s*Image\s+(\S+)/);
      if (im) { cur.image = im[1].replace(/\.tga$/i, ""); continue; }
      const dm = line.match(/^\s*Description\s+(\S+)/);
      if (dm) { cur.descKey = dm[1]; continue; }
      const efdm = line.match(/^\s*EffectsDescription\s+(\S+)/);
      if (efdm) { cur.effectsKey = efdm[1]; continue; }
      const efm = line.match(/^\s*Effect\s+(\S+)\s+(-?\d+)/);
      if (efm) { cur.effects.push({ name: efm[1], value: parseInt(efm[2], 10) }); continue; }
      // 0.9.437: capture engine constraints used by the dev-mode picker.
      const exm = line.match(/^\s*ExcludeCultures\s+(.+?)\s*$/);
      if (exm) { cur.excludeCultures = exm[1].split(/\s*,\s*/).map(s => s.toLowerCase()).filter(Boolean); continue; }
      if (/^\s*Unique\b/.test(line)) { cur.unique = true; continue; }
    }
  }
  modNameLookup = fs.readFileSync(nameLookupPath, "utf8").split(/\r?\n/).map(s => s.trim());
  modTraitNames = [];
  // While we walk the traits file we ALSO collect Trait → [{ level, epithetKey }]
  // pairs. The first pass through the file gives us the trait→key skeleton;
  // a second pass on text/export_vnvs.txt fills in epithetKey → text.
  modTraitEpithets = {};
  // 0.9.417: capture FULL per-level data for the right-click character
  // info panel (description text, effects, threshold). Shape:
  //   modTraitLevels[traitName] = [
  //     { levelIdx, levelName, descKey, effectsKey, gainKey,
  //       threshold, effects: [{ name, value }] }, ...
  //   ]
  // The text keys get resolved against export_vnvs.txt below.
  modTraitLevels = {};
  modTraitHidden = {};
  modTraitCharacters = {};
  modTraitExcludeCultures = {};
  {
    const lines = fs.readFileSync(traitsPath, "utf8").split(/\r?\n/);
    let curTrait = null;
    let curLevel = null;     // level name (e.g. "Roman_Conqueror_Messapians")
    let curLevelIdx = 0;     // 1-indexed level position within current trait
    let curLevelObj = null;
    // 0.9.433: track Hidden flag per trait (engine doesn't surface
    // hidden traits in the in-game character info, so the UI should
    // hide them unless devMode is on).
    let curTraitHidden = false;
    for (const line of lines) {
      const tm = line.match(/^Trait\s+(\S+)/);
      if (tm) {
        curTrait = tm[1];
        curLevel = null;
        curLevelIdx = 0;
        curLevelObj = null;
        curTraitHidden = false;
        modTraitNames.push(curTrait);
        continue;
      }
      if (curTrait && /^\s*Hidden\b/.test(line)) {
        curTraitHidden = true;
        if (!modTraitHidden) modTraitHidden = {};
        modTraitHidden[curTrait] = true;
        continue;
      }
      // 0.9.437: capture engine-enforced constraints so the Add Trait
      // picker can filter out options the engine would reject. Two cared
      // about: `Characters` (which agent types can carry the trait —
      // family / admiral / spy / assassin / diplomat / all) and
      // `ExcludeCultures` (cultures the trait is forbidden on).
      if (curTrait) {
        const chm = line.match(/^\s*Characters\s+(.+?)\s*$/);
        if (chm) {
          modTraitCharacters[curTrait] = chm[1].split(/\s*,\s*/).map(s => s.toLowerCase()).filter(Boolean);
          continue;
        }
        const exm = line.match(/^\s*ExcludeCultures\s+(.+?)\s*$/);
        if (exm) {
          modTraitExcludeCultures[curTrait] = exm[1].split(/\s*,\s*/).map(s => s.toLowerCase()).filter(Boolean);
          continue;
        }
      }
      const lm = line.match(/^\s*Level\s+(\S+)/);
      if (lm) {
        curLevel = lm[1];
        curLevelIdx++;
        curLevelObj = {
          levelIdx: curLevelIdx,
          levelName: curLevel,
          descKey: null,
          effectsKey: null,
          gainKey: null,
          threshold: null,
          effects: [],
          desc: null,    // resolved against export_vnvs.txt
          effectsDesc: null,
        };
        if (!modTraitLevels[curTrait]) modTraitLevels[curTrait] = [];
        modTraitLevels[curTrait].push(curLevelObj);
        continue;
      }
      if (curLevelObj) {
        const dm = line.match(/^\s*Description\s+(\S+)/);
        if (dm) { curLevelObj.descKey = dm[1]; continue; }
        const efdm = line.match(/^\s*EffectsDescription\s+(\S+)/);
        if (efdm) { curLevelObj.effectsKey = efdm[1]; continue; }
        const gm = line.match(/^\s*GainMessage\s+(\S+)/);
        if (gm) { curLevelObj.gainKey = gm[1]; continue; }
        const thm = line.match(/^\s*Threshold\s+(\d+)/);
        if (thm) { curLevelObj.threshold = parseInt(thm[1], 10); continue; }
        const efm = line.match(/^\s*Effect\s+(\S+)\s+(-?\d+)/);
        if (efm) { curLevelObj.effects.push({ name: efm[1], value: parseInt(efm[2], 10) }); continue; }
      }
      const em = line.match(/^\s*Epithet\s+(\S+)/);
      if (em && curTrait && curLevel) {
        if (!modTraitEpithets[curTrait]) modTraitEpithets[curTrait] = [];
        modTraitEpithets[curTrait].push({ level: curLevelIdx, levelName: curLevel, key: em[1], text: null });
      }
    }
  }
  // Resolve description/effects/epithet keys → text by scanning export_vnvs.txt.
  // Two formats coexist:
  //   A) `{key}\ttext`  (same line — used for short labels like epithets)
  //   B) `{key}` then text on the next line  (used for long descriptions)
  // Earlier the parser only handled (A); (B) was silently dropped so
  // trait descriptions never made it to the UI.
  {
    const vnvsPath = path.join(modDataDir, "text", "export_vnvs.txt");
    if (fs.existsSync(vnvsPath)) {
      const buf3 = fs.readFileSync(vnvsPath);
      const text = (buf3[0] === 0xff && buf3[1] === 0xfe) ? buf3.toString("utf16le", 2) : buf3.toString("utf8");
      const keyToText = new Map();
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Same-line variant
        const m = line.match(/^\{([^}]+)\}\s*(.+?)\s*$/);
        if (m) { keyToText.set(m[1], m[2]); continue; }
        // Next-line variant: bare `{key}` then text on next non-empty line
        const mk = line.match(/^\{([^}]+)\}\s*$/);
        if (mk) {
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === "") j++;
          if (j < lines.length && !lines[j].startsWith("{")) {
            keyToText.set(mk[1], lines[j].trim());
          }
        }
      }
      // Resolve epithet keys
      for (const trait of Object.keys(modTraitEpithets)) {
        for (const entry of modTraitEpithets[trait]) {
          if (keyToText.has(entry.key)) entry.text = keyToText.get(entry.key);
        }
        modTraitEpithets[trait] = modTraitEpithets[trait].filter(e => e.text);
        if (modTraitEpithets[trait].length === 0) delete modTraitEpithets[trait];
      }
      // Resolve trait-level keys (descKey, effectsKey)
      for (const trait of Object.keys(modTraitLevels)) {
        for (const lvl of modTraitLevels[trait]) {
          if (lvl.descKey && keyToText.has(lvl.descKey)) lvl.desc = keyToText.get(lvl.descKey);
          if (lvl.effectsKey && keyToText.has(lvl.effectsKey)) lvl.effectsDesc = keyToText.get(lvl.effectsKey);
        }
      }
      // Resolve ancillary description keys (0.9.420)
      if (modAncillaryData) {
        for (const name of Object.keys(modAncillaryData)) {
          const a = modAncillaryData[name];
          if (a.descKey && keyToText.has(a.descKey)) a.desc = keyToText.get(a.descKey);
          if (a.effectsKey && keyToText.has(a.effectsKey)) a.effectsDesc = keyToText.get(a.effectsKey);
        }
      }
    }
  }
  modDescrStratSurnames = new Set();
  modDescrStratCharByName = new Map();
  modDescrStratCharsByFirstName = new Map();
  // Try the configured imperial_campaign path AND the alexander variant.
  // Whichever exists provides character coordinates we can use as a fallback
  // for save records whose own commanderUuid doesn't resolve to a position
  // (typically captains attached to leaderless armies — Adymos at Pella, etc.)
  const descrStratPaths = [
    descrStratPath,
    path.join(modDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  // Collect full character records (with traits + ancillaries + age + tags)
  // alongside the name lookup. We need to track state across lines because
  // traits / ancillaries appear on the lines AFTER the character header.
  const fullCharRecords = [];
  for (const dsPath of descrStratPaths) {
    if (!fs.existsSync(dsPath)) continue;
    let currentFaction = null;
    let currentChar = null; // open record awaiting trait / ancillary lines
    const lines = fs.readFileSync(dsPath, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+$/, "");
      const t = line.trim();
      const factMatch = line.match(/^faction\s+(\S+?),/);
      if (factMatch) { currentFaction = factMatch[1]; currentChar = null; continue; }
      // Vanilla uses `character ` (whitespace), RIS uses `character,` (comma) —
      // accept either separator after the keyword. RIS had 908 character
      // lines silently dropped before this fix (no live generals in the
      // family tree because none were ever parsed).
      const charMatch = line.match(/^character[\s,]+([^,]+?),\s*([^,]+?),.*?\bx\s+(\d+),\s*y\s+(\d+)/);
      if (charMatch) {
        const nameField = charMatch[1].trim();
        const headerRest = charMatch[0]; // entire matched header
        // 0.9.507: skip RIS's sub-faction marker lines (`character
        // sub_faction parni, ...`). Same fix as in bundle-mod-data.js
        // 0.9.506 — these lines don't name a real character, they tag a
        // territory for sub-faction spawning. Without this filter the
        // family tree gets a "sub_faction parni" member with the role
        // string and zero stats, which then surfaces under the in-game
        // commander's slot via name-collision lookups.
        if (/^sub[_\s]faction\b/i.test(nameField)) {
          continue;
        }
        const [first, ...rest] = nameField.split(/\s+/);
        const lastName = rest.join(" ") || null;
        if (lastName) modDescrStratSurnames.add(lastName);
        const x = parseInt(charMatch[3]);
        const y = parseInt(charMatch[4]);
        // Use the FULL line for trailing-field extraction — `charMatch[0]`
        // truncates after `y N`, so e.g. `portrait_index 334` is missed.
        const ageMatch = /\bage\s+(\d+)/.exec(line);
        const ageVal = ageMatch ? parseInt(ageMatch[1]) : null;
        const tags = [];
        if (/\bleader\b/i.test(headerRest)) tags.push("leader");
        if (/\bheir\b/i.test(headerRest)) tags.push("heir");
        if (/\bnamed character\b/i.test(headerRest)) tags.push("named");
        const charSubType = (charMatch[2] || "").trim().toLowerCase();
        // descr_strat optionally specifies the engine's portrait pool index
        // explicitly with `portrait_index N`. Only one character per vanilla
        // descr_strat has this set, but mods (and future-Provincia, once the
        // save byte is cracked) can fill it in for every character.
        const portraitIdxMatch = /\bportrait_index\s+(\d+)/.exec(line);
        const portraitIndex = portraitIdxMatch ? parseInt(portraitIdxMatch[1]) : null;
        // 0.9.421: stats from descr_strat — `command N, influence N,
        // management N, subterfuge N` appear inline on the character line
        // (and sometimes spill onto continuation lines, but rare). Read
        // them so non-live mode has the same stat row as live mode.
        const cmdM = /\bcommand\s+(\d+)/.exec(line);
        const infM = /\binfluence\s+(\d+)/.exec(line);
        const mgmtM = /\bmanagement\s+(\d+)/.exec(line);
        const subM = /\bsubterfuge\s+(\d+)/.exec(line);
        const command = cmdM ? parseInt(cmdM[1]) : null;
        const influence = infM ? parseInt(infM[1]) : null;
        const management = mgmtM ? parseInt(mgmtM[1]) : null;
        const subterfuge = subM ? parseInt(subM[1]) : null;
        const entry = { firstName: first, lastName, x, y, faction: currentFaction };
        const key = first + "|" + (currentFaction || "");
        if (!modDescrStratCharByName.has(key)) modDescrStratCharByName.set(key, entry);
        if (!modDescrStratCharsByFirstName.has(first)) modDescrStratCharsByFirstName.set(first, []);
        modDescrStratCharsByFirstName.get(first).push(entry);
        currentChar = {
          firstName: first, lastName, x, y,
          faction: currentFaction,
          age: ageVal,
          tags,
          charSubType,
          portraitIndex,
          traits: [],
          ancillaries: [],
          command, influence, management, subterfuge,
        };
        fullCharRecords.push(currentChar);
        continue;
      }
      if (!currentChar) continue;
      const tm = /^traits\s+(.+)$/i.exec(t);
      if (tm) {
        const parts = tm[1].split(",").map((p) => p.trim()).filter(Boolean);
        for (const p of parts) {
          const m = /^(\S+)\s+(\d+)$/.exec(p);
          if (m) currentChar.traits.push({ name: m[1], level: parseInt(m[2]) });
          else if (p) currentChar.traits.push({ name: p, level: 1 });
        }
        continue;
      }
      const am = /^ancillaries\s+(.+)$/i.exec(t);
      if (am) {
        const parts = am[1].split(",").map((p) => p.trim()).filter(Boolean);
        for (const p of parts) currentChar.ancillaries.push(p);
        continue;
      }
      // Once we hit `army` or the next `character` line, the current
      // character's metadata is sealed. Leave `currentChar` set so trait
      // and ancillary lines that appear AFTER `army` (rare but seen) are
      // still captured for the same character — they're harmless if the
      // record is overwritten by the next character header.
    }
  }
  // Group full records by region using descr_strat coords + the
  // ownership map's settlement → region lookup if available. The renderer
  // already does its own (X,Y) → region pixel lookup, so we expose the
  // raw list keyed by faction; the renderer joins by coords against
  // startingArmiesByRegion (which already has the same coord→region
  // mapping from the bundled JSON OR from the runtime ownership build).
  // 0.9.422: Estimate stats from trait + ancillary effects when descr_strat
  // didn't set them inline. RIS / vanilla descr_strat doesn't store
  // command/influence/management on the `character` line — the engine
  // derives them at game start from trait Effect lines + base values + tag
  // bonuses (faction leader = +1 to several stats, etc). This sum
  // approximates the in-game values (off by 1-2 because we don't model the
  // engine's base/tag contributions); flag results with _statsEstimated so
  // the UI can distinguish them from live-save reads.
  for (const c of fullCharRecords) {
    if (c.command != null || c.influence != null || c.management != null) continue;
    let cmd = 0, inf = 0, mgmt = 0, sub = 0;
    let touched = false;
    for (const t of c.traits || []) {
      const lvls = modTraitLevels && modTraitLevels[t.name];
      if (!lvls) continue;
      // Engine activates the highest level whose Threshold <= trait points.
      // 0.9.521+: t.points is the raw byte value, t.level is the resolved
      // display level (post-threshold). Use t.points for threshold lookup
      // (falling back to t.level for back-compat with old parser output).
      const pts = t.points != null ? t.points : t.level;
      let chosen = null;
      for (const lvl of lvls) {
        if (lvl.threshold != null && lvl.threshold <= pts) chosen = lvl;
      }
      if (!chosen) chosen = lvls[Math.min(Math.max(0, t.level - 1), lvls.length - 1)];
      if (!chosen) continue;
      for (const e of chosen.effects || []) {
        if (e.name === "Command") { cmd += e.value; touched = true; }
        else if (e.name === "Influence") { inf += e.value; touched = true; }
        else if (e.name === "Management") { mgmt += e.value; touched = true; }
        else if (e.name === "Subterfuge") { sub += e.value; touched = true; }
      }
    }
    for (const ancName of c.ancillaries || []) {
      const data = modAncillaryData && modAncillaryData[ancName];
      if (!data) continue;
      for (const e of data.effects || []) {
        if (e.name === "Command") { cmd += e.value; touched = true; }
        else if (e.name === "Influence") { inf += e.value; touched = true; }
        else if (e.name === "Management") { mgmt += e.value; touched = true; }
        else if (e.name === "Subterfuge") { sub += e.value; touched = true; }
      }
    }
    if (touched) {
      c.command = Math.max(0, cmd);
      c.influence = Math.max(0, inf);
      c.management = Math.max(0, mgmt);
      c.subterfuge = Math.max(0, sub);
      c._statsEstimated = true;
    }
  }
  modDescrStratCharactersByRegion = { byCoord: fullCharRecords };
  // ── Family tree extraction (descr_strat → byFaction) ──
  // Re-scan the same paths capturing `character_record` (wives, children,
  // dead members) and `relative` blocks (the parent/spouse/children graph).
  // This produces the data behind Provincia's mod-data Family Tree view.
  {
    const byFaction = {};
    const upsertFaction = (f) => {
      if (!byFaction[f]) byFaction[f] = { members: [], relatives: [], named: {} };
      return byFaction[f];
    };
    // 0.9.770: key the `named` map by FULL name, not first name. Roman
    // families share praenomina (Gaius, Lucius, Quintus, Gnaeus, Publius,
    // Marcus...), so a first-name-only key collided distinct people. Worse,
    // the character_record merge below then OVERWROTE an adult general's
    // age/gender/alive with a same-praenomen CHILD's values — e.g. the Julii
    // leader Quintus Ogulnius_Gallus (age 60) was clobbered to age 4 by the
    // child "Quintus Iunius_Brutus", dropping 6 of 20 family heads below the
    // age>=16 generals filter (tree showed 14 instead of 20). Full-name keys
    // disambiguate; the relative graph already references full names too.
    // See findings-family-tree-2026-05-31.md.
    const nameKey = (first, last) => `${first}|${(last || "").replace(/_/g, " ")}`;
    // Index named characters (those with `character` lines) so we can
    // merge in their age/tags when they appear in relatives blocks.
    for (const c of fullCharRecords) {
      if (!c.faction) continue;
      const bucket = upsertFaction(c.faction);
      bucket.named[nameKey(c.firstName, c.lastName)] = {
        firstName: c.firstName, lastName: c.lastName,
        age: c.age, alive: true, gender: "male",
        tags: c.tags || [], role: c.charSubType || "named_character",
        isCharacter: true,
        x: c.x, y: c.y,
        faction: c.faction,
        portraitIndex: c.portraitIndex != null ? c.portraitIndex : null,
        traits: c.traits || [],
        ancillaries: c.ancillaries || [],
        // 0.9.421: forward stats. _statsEstimated flag (0.9.422) signals
        // these are summed from trait/ancillary Effect lines, not read
        // from a save — display layer can mark them as approximate.
        command: c.command, influence: c.influence,
        management: c.management, subterfuge: c.subterfuge,
        _statsEstimated: c._statsEstimated || false,
      };
    }
    for (const dsPath of descrStratPaths) {
      if (!fs.existsSync(dsPath)) continue;
      let currentFaction = null;
      const lines = fs.readFileSync(dsPath, "utf8").split(/\r?\n/);
      for (const rawLine of lines) {
        // Strip inline `;` comments (a `;` anywhere starts a comment in
        // descr_strat) BEFORE parsing, so a commented-out tail on a `relative`
        // line — e.g. `…, end;Iolaos, …, end` — isn't read as real family
        // members (it was yielding a bogus "end;Iolaos" card plus stray
        // age-less children). Mirrors the descrStratGeneral.js fix; THIS is the
        // parser behind the mod-data Family Tree view.
        const noComment = rawLine.includes(";") ? rawLine.slice(0, rawLine.indexOf(";")) : rawLine;
        const line = noComment.replace(/\s+$/, "");
        const factMatch = line.match(/^faction\s+(\S+?),/);
        if (factMatch) { currentFaction = factMatch[1]; continue; }
        if (!currentFaction) continue;
        // character_record lines: `character_record Name, gender, command X, influence X, management X, subterfuge X, age X, alive|dead, never_a_leader|...`
        const crMatch = line.match(/^\s*character_record\s+([^,]+?),\s*(male|female)\s*,(.*)$/i);
        if (crMatch) {
          const nameField = crMatch[1].trim();
          const gender = crMatch[2].toLowerCase();
          const rest = crMatch[3];
          const ageM = /\bage\s+(\d+)/.exec(rest);
          const aliveM = /\b(alive|dead)\b/.exec(rest);
          // 0.9.421: also pull command/influence/management/subterfuge so
          // the non-live (descr_strat-only) view matches live-mode stats.
          const cmdM = /\bcommand\s+(\d+)/.exec(rest);
          const infM = /\binfluence\s+(\d+)/.exec(rest);
          const mgmtM = /\bmanagement\s+(\d+)/.exec(rest);
          const subM = /\bsubterfuge\s+(\d+)/.exec(rest);
          const stats = {
            command: cmdM ? parseInt(cmdM[1]) : null,
            influence: infM ? parseInt(infM[1]) : null,
            management: mgmtM ? parseInt(mgmtM[1]) : null,
            subterfuge: subM ? parseInt(subM[1]) : null,
          };
          const [first, ...restName] = nameField.split(/\s+/);
          const lastName = restName.join(" ") || null;
          const bucket = upsertFaction(currentFaction);
          // If this character_record refers to a named character we
          // already recorded, just enrich it. Otherwise add a new member.
          // 0.9.770: match on FULL name. A first-name match let a child's
          // record clobber an adult general who shared the praenomen (see
          // the named-map note above).
          const existing = bucket.named[nameKey(first, lastName)];
          if (existing) {
            if (ageM) existing.age = parseInt(ageM[1]);
            existing.gender = gender;
            existing.alive = aliveM ? aliveM[1] === "alive" : true;
            if (stats.command != null) existing.command = stats.command;
            if (stats.influence != null) existing.influence = stats.influence;
            if (stats.management != null) existing.management = stats.management;
            if (stats.subterfuge != null) existing.subterfuge = stats.subterfuge;
          } else {
            bucket.members.push({
              firstName: first, lastName,
              gender,
              age: ageM ? parseInt(ageM[1]) : null,
              alive: aliveM ? aliveM[1] === "alive" : true,
              tags: [],
              role: "family_member",
              isCharacter: false,
              faction: currentFaction,
              ...stats,
            });
          }
          continue;
        }
        // relative lines: `relative Husband, Wife, Child1, Child2, ... end`
        const relMatch = line.match(/^\s*relative\s+([^,]+?),\s*([^,]+?),\s*(.*)$/);
        if (relMatch) {
          const husband = relMatch[1].trim();
          const wifeField = relMatch[2].trim();
          const wife = (/^none$/i.test(wifeField) ? null : wifeField);
          // Children are comma-separated, terminated by `end`
          const childrenPart = relMatch[3].replace(/\s+end\s*$/i, "");
          const children = childrenPart
            .split(",").map(s => s.trim()).filter(s => s && !/^end$/i.test(s));
          const bucket = upsertFaction(currentFaction);
          bucket.relatives.push({ husband, wife, children });
        }
      }
    }
    // Merge `named` map into members[] for each faction
    for (const f of Object.keys(byFaction)) {
      const bucket = byFaction[f];
      for (const [, c] of Object.entries(bucket.named)) {
        bucket.members.push(c);
      }
      delete bucket.named;
    }
    modDescrStratFamilies = { byFaction };
  }
  // Parse export_descr_unit.txt for officer counts. The save stores only
  // rank-and-file soldiers; the in-game UI shows that count plus any
  // officers/standard-bearers/musicians defined in EDU. Counting `officer`
  // lines per unit type lets us match the in-game number (e.g. Hypaspists:
  // save says 240, EDU has one `officer greek_standard`, so display 241).
  modUnitOfficerCounts = {};
  const eduPath = path.join(modDataDir, "export_descr_unit.txt");
  if (fs.existsSync(eduPath)) {
    const buf2 = fs.readFileSync(eduPath);
    const text = buf2[0] === 0xff && buf2[1] === 0xfe ? buf2.toString("utf16le") : buf2.toString("utf8");
    let curUnit = null, curOfficers = 0;
    const flush = () => {
      if (curUnit) modUnitOfficerCounts[curUnit] = curOfficers;
      curUnit = null; curOfficers = 0;
    };
    for (const rawLine of text.split(/\r?\n/)) {
      const i = rawLine.indexOf(";"); const s = (i >= 0 ? rawLine.slice(0, i) : rawLine).trim();
      if (!s) continue;
      const tm = s.match(/^type\s+(.+)$/);
      if (tm) { flush(); curUnit = tm[1].trim(); continue; }
      if (curUnit && /^officer\s+\S+/.test(s)) curOfficers++;
    }
    flush();
  }
  // Load valid building chain names to filter out event records (volcano,
  // eruption, earthquake, etc.) that share the chain-record binary format.
  // Also extract max-level count per chain (from `levels` line) so the level
  // decoder knows how many levels to consider valid (avoids picking up unrelated
  // uint32 values that happen to be small but are pointers/data).
  modBuildingChains = new Set();
  modChainMaxLevels = {};
  modChainCategories = {};
  if (fs.existsSync(edbPath)) {
    const edbText = fs.readFileSync(edbPath, "utf8");
    const blocks = edbText.split(/^building\s+/m).slice(1);
    for (const b of blocks) {
      const name = b.match(/^(\w+)/)?.[1];
      if (!name) continue;
      modBuildingChains.add(name);
      const levelsLine = b.match(/^\s+levels\s+(.+)/m);
      if (levelsLine) {
        const lvlList = levelsLine[1].trim().split(/\s+/);
        modChainMaxLevels[name] = lvlList.length;
      }
      // RTW EDB declares the build-menu category via `icon <category>`. The
      // game uses `data/ui/building_icons/<category>.tga` as the visual
      // fallback when no per-culture/per-level art exists. Capture it for
      // the icon resolver's final pass.
      const iconLine = b.match(/^\s+icon\s+(\w+)/m);
      if (iconLine) modChainCategories[name] = iconLine[1].toLowerCase();
    }
    // 0.9.465: extract per-faction homeland hidden_resources from EDB
    // `alias <name>_homeland` blocks. Each alias declares which factions
    // it covers + which `homeland_<X>` HR they unlock for. We invert to
    // get faction → Set<homeland_X> for the Homeland map mode. Bundled
    // homelands.json is stale (says antigonid → ["antigonid"] but RIS
    // uses shared `homeland_macedonian` across antigonid/seleucid/
    // ptolemaic) — parsing live keeps it in sync with the mod.
    modHomelandsByFaction = {};
    // EDB alias format:
    //   alias <name>_homeland
    //   {
    //       requires factions { <id1>, <id2>, } and hidden_resource homeland_<X>
    //   }
    // Capture the full `requires …` line (up to newline) so the inner
    // `factions { … }` closing brace is included.
    const aliasRegex = /^alias\s+\S+_homeland\s*\{\s*requires\s+([^\n]+)/gm;
    let am, aliasMatches = 0;
    while ((am = aliasRegex.exec(edbText)) !== null) {
      aliasMatches++;
      const expr = am[1];
      const factionsM = expr.match(/factions\s*\{\s*([^}]*)\}/);
      const hrM = expr.match(/hidden_resource\s+(homeland_\w+)/);
      if (!factionsM || !hrM) continue;
      const factions = factionsM[1].split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
      const hr = hrM[1];
      for (const f of factions) {
        if (!modHomelandsByFaction[f]) modHomelandsByFaction[f] = [];
        if (!modHomelandsByFaction[f].includes(hr)) modHomelandsByFaction[f].push(hr);
      }
    }
    console.log(`[homelands] parsed ${aliasMatches} EDB alias blocks → ${Object.keys(modHomelandsByFaction).length} factions (e.g. antigonid → ${JSON.stringify(modHomelandsByFaction.antigonid || [])})`);
  }
  // Load faction display-name ↔ internal-id mappings.
  // Two sources matter:
  //   - text/campaign_descriptions.txt — `{<CAMPAIGN_PREFIX>_<FACTION>_TITLE}Display`
  //   - text/expanded_bi.txt           — `{<FACTION>}\tDisplay`
  // expanded_bi.txt is the source for in-game faction names (e.g.
  // "The House of Cornelii" for roman_rebels_2). campaign_descriptions only
  // sometimes uses different titles per campaign — used as fallback.
  modFactionDisplayMap = {};   // lowercase display name → internal id
  modFactionDisplayNames = {}; // internal id → display name (for UI)
  // Read expanded_bi.txt from all known installs. Game installs first so
  // mod-specific overrides (read last) take precedence. Within each file we
  // use LAST-WINS — Alexander's `expanded_bi.txt` has an "ALEXANDER TEXT
  // BEGINS HERE" section with overrides (e.g. PARTHIA → "Persia") below the
  // generic BI defaults (PARTHIA → "Parthia"), so the Alexander overrides win.
  // Load order: game install (defaults) → parent mods → submod (wins via last-wins).
  const expandedSources = [];
  for (const root of getIconSearchRoots()) {
    expandedSources.push(path.join(root, "text", "expanded_bi.txt"));
  }
  // Include submod + all parent mods (innermost last so it overrides).
  const relatedForExpanded = findRelatedModDirs
    ? findRelatedModDirs(modDataDir, "text/expanded_bi.txt").reverse()
    : [modDataDir];
  for (const d of relatedForExpanded) {
    expandedSources.push(path.join(d, "text", "expanded_bi.txt"));
  }
  for (const expandedPath of expandedSources) {
    if (!fs.existsSync(expandedPath)) continue;
    const buf = fs.readFileSync(expandedPath);
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      // Match: {FACTION_INTERNAL_ID}<whitespace>Display Name
      // Only accept top-level faction entries — skip _DESCR, EMT_, _LABEL, etc.
      const m = line.match(/^\{([A-Z][A-Z0-9_]*)\}\s*(.+?)\s*$/);
      if (!m) continue;
      const key = m[1];
      if (key.includes("_DESCR") || key.startsWith("EMT_") || key.startsWith("SMW_") ||
          key.endsWith("_LABEL") || key.endsWith("_ORDER") || key.endsWith("_UNREST") ||
          key.endsWith("_TITLE") || key.endsWith("_BODY") || key.endsWith("_MESSAGE")) continue;
      const factionId = key.toLowerCase();
      const display = m[2].trim();
      if (!display || display.length > 60) continue;
      modFactionDisplayMap[display.toLowerCase()] = factionId;
      modFactionDisplayNames[factionId] = display;
    }
  }
  // Fallback: also load campaign_descriptions.txt if expanded_bi missed anything.
  const campDescPath = path.join(modDataDir, "text", "campaign_descriptions.txt");
  if (fs.existsSync(campDescPath)) {
    const buf = fs.readFileSync(campDescPath);
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\{([A-Z_0-9]+)_TITLE\}(.+)$/);
      if (!m) continue;
      const key = m[1];
      const display = m[2].trim();
      // Strip any campaign prefix (IMPERIAL_CAMPAIGN_, ALTERNATE_CAMPAIGN_,
      // RIS_CLASSIC_, RIS_CLASSIC_2_, etc.) — anything ending with the faction id.
      const factionId = key
        .replace(/^[A-Z0-9_]*?(ROMANS_JULII|ROMANS_BRUTII|ROMANS_SCIPII|ROMAN_SENATE|ROMAN_REBELS_[12]|EGYPT|SELEUCID|CARTHAGE|PARTHIA|ARMENIA|PONTUS|GREEK_CITIES|MACEDON|THRACE|DACIA|SCYTHIA|GAULS|BRITONS|GERMANS|SPAIN|NUMIDIA|SLAVE)$/, "$1")
        .toLowerCase();
      if (!modFactionDisplayMap[display.toLowerCase()]) modFactionDisplayMap[display.toLowerCase()] = factionId;
      if (!modFactionDisplayNames[factionId]) modFactionDisplayNames[factionId] = display;
    }
  }
  // Parse descr_sm_factions.txt for faction → culture mapping. The culture
  // name matches the `data/ui/<culture>/buildings/` folder convention
  // (one of: roman, greek, barbarian, carthaginian, egyptian, eastern in
  // vanilla). Used to resolve building icons + culture-specific display
  // names per settlement. Fully dynamic — works for any mod that ships
  // descr_sm_factions.txt.
  modFactionCultures = {};
  // 0.9.527: ordered faction list in descr_sm_factions.txt declaration
  // order. The save's cracked faction_id byte (parseFactionTreasuries) is
  // an INDEX into this order, so it identifies each major-faction record's
  // owner directly — replacing the captain-banner heuristic that misses
  // records with no captains. Populated from the FIRST source that yields
  // a non-empty list (mod overrides game), in lockstep with the culture map.
  modFactionOrder = [];
  // Submod + parent mods first (first-wins — mod overrides game).
  const smFactionSources = [];
  for (const d of (findRelatedModDirs ? findRelatedModDirs(modDataDir, "descr_sm_factions.txt") : [modDataDir])) {
    smFactionSources.push(path.join(d, "descr_sm_factions.txt"));
  }
  for (const root of getIconSearchRoots()) {
    smFactionSources.push(path.join(root, "descr_sm_factions.txt"));
  }
  for (const src of smFactionSources) {
    if (!fs.existsSync(src)) continue;
    try {
      const text = fs.readFileSync(src, "utf8");
      let curFaction = null;
      // Only the FIRST source that actually declares factions seeds the
      // order array; later sources just fill culture gaps. Otherwise a
      // parent-mod file appended after the submod would corrupt the index.
      const seedOrder = modFactionOrder.length === 0;
      for (const line of text.split(/\r?\n/)) {
        // Match `"<faction_id>":` optionally followed by a `;comment`.
        const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
        if (fm) { curFaction = fm[1]; continue; }
        if (curFaction) {
          const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/);
          if (cm) {
            if (!(curFaction in modFactionCultures)) {
              modFactionCultures[curFaction] = cm[1];
            }
            // The culture line marks a REAL faction block (structural keys
            // like "namelists"/"logos" never have a culture), so commit to
            // the order array here — declaration order == faction_id index.
            if (seedOrder) modFactionOrder.push(curFaction);
            curFaction = null;
          }
        }
      }
      if (modFactionOrder.length > 0 && seedOrder) {
        console.log(`[sm_factions] order seeded: ${modFactionOrder.length} factions (idx0=${modFactionOrder[0]})`);
      }
    } catch (e) { console.warn("[sm_factions]", src, e.message); }
  }

  // 0.9.527: parse feral_descr_ai_personality.txt declaration order. The
  // save's cracked aiPersonalityIndex byte (parseFactionTreasuries) indexes
  // into this list, so each major-faction record exposes its AI archetype
  // (ai_rome, ai_carthage, ai_lusitani, …). First non-empty source wins.
  modAiPersonalityOrder = [];
  const aiSources = [];
  for (const d of (findRelatedModDirs ? findRelatedModDirs(modDataDir, "feral_descr_ai_personality.txt") : [modDataDir])) {
    aiSources.push(path.join(d, "feral_descr_ai_personality.txt"));
  }
  for (const root of getIconSearchRoots()) {
    aiSources.push(path.join(root, "feral_descr_ai_personality.txt"));
  }
  for (const src of aiSources) {
    if (!fs.existsSync(src)) continue;
    try {
      const text = fs.readFileSync(src, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*personality\s+([A-Za-z0-9_]+)/);
        if (m) modAiPersonalityOrder.push(m[1]);
      }
      if (modAiPersonalityOrder.length > 0) {
        console.log(`[ai_personality] order seeded: ${modAiPersonalityOrder.length} personalities (idx0=${modAiPersonalityOrder[0]})`);
        break;
      }
    } catch (e) { console.warn("[ai_personality]", src, e.message); }
  }

  // Parse descr_strat for `faction X, ai_Y` → modAiByFaction map. Authoritative
  // starting AI personality per faction; doesn't go stale within a campaign in
  // RTW (engine never reassigns ai_type at runtime — it's static-from-descr_strat).
  // Used as fallback when the save-cracked aiPersonalityIndex is unavailable
  // (sub=8 record layout, ~91% of records on RIS T1017) or wrong.
  modAiByFaction = {};
  try {
    const dsCandidates = [
      path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
      path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "original_overrides", "descr_strat.txt"),
    ];
    if (findRelatedModDirs) {
      for (const d of findRelatedModDirs(modDataDir, "world/maps/campaign/imperial_campaign/descr_strat.txt")) {
        dsCandidates.push(path.join(d, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"));
      }
    }
    let parsedDs = null;
    for (const dsPath of dsCandidates) {
      if (!fs.existsSync(dsPath)) continue;
      try {
        parsedDs = descrGen.parseDescrStrat(fs.readFileSync(dsPath, "utf8"));
        break;
      } catch {}
    }
    if (parsedDs && Array.isArray(parsedDs.factions)) {
      for (const f of parsedDs.factions) {
        if (f.name && f.ai) modAiByFaction[f.name.toLowerCase()] = f.ai;
      }
    }
    console.log(`[ai_personality] descr_strat fallback seeded: ${Object.keys(modAiByFaction).length} factions with ai_<type>`);
  } catch (e) { console.warn("[ai_personality] descr_strat fallback failed:", e.message); }

  // Build initial settlement ownership from descr_regions + descr_strat.
  // This is the turn-0 ground truth; conquests during play are not captured
  // by this map (see PROGRESS_LOG Round 21).
  try {
    const own = buildInitialOwnership(modDataDir);
    modInitialOwnerByCity = own.ownerByCity;
    modInitialCreatorByCity = own.creatorByCity || {};
    if (own.error) console.warn("[mod-load] ownership:", own.error);
    console.log(`[mod-load] ownership owners=${Object.keys(modInitialOwnerByCity).length} creators=${Object.keys(modInitialCreatorByCity).length}`);
  } catch (e) {
    console.warn("[mod-load] ownership parse failed:", e.message);
    modInitialOwnerByCity = {};
    modInitialCreatorByCity = {};
  }
  // Region → city map (descr_regions.txt). The save tags every unit with
  // its REGION; the owner / governor lookups are CITY-keyed. This bridge
  // lets the army-faction re-attribution step turn a unit's region into
  // a settlement and then into an owner.
  try {
    const { findDescrRegions, parseDescrRegions } = require("./src/ownershipParser.js");
    const rPath = findDescrRegions(modDataDir, "imperial_campaign") || findDescrRegions(modDataDir, "ris_classic");
    modRegionToCity = rPath ? parseDescrRegions(rPath) : {};
  } catch (e) {
    console.warn("[mod-load] descr_regions parse failed:", e.message);
    modRegionToCity = {};
  }
  return {
    names: modNameLookup.length,
    traits: modTraitNames.length,
    surnames: modDescrStratSurnames.size,
    chains: modBuildingChains.size,
    factionDisplay: Object.keys(modFactionDisplayMap).length,
    factionDisplayNames: Object.keys(modFactionDisplayNames).length,
    owners: Object.keys(modInitialOwnerByCity || {}).length,
    descrStratCharCount: modDescrStratCharactersByRegion?.byCoord?.length || 0,
  };
}

// Parse characters + units out of a save buffer and attach regions.
// Returns { characters, units, charactersByRegion } or null if mod data not loaded.
// Build a map of worldObjectUuid → {x, y} from the save file's world-object
// records. Pattern at offset N (byte-granular, not word-aligned):
//   N-12: uint32 = 6            (record-type marker)
//   N-8:  uint32 = worldUuid    (matches worldObjectUuid on the character)
//   N-4:  uint32 = N - 4        (self-pointer)
//   N:    uint32 = x (0..200)
//   N+4:  uint32 = y (0..100)
// Discovered by diffing Parmenion (21,45), Alexander (11,49) in Alex turn 1.
// parseWorldObjectPositions, parseCharacterMetadataByUuid,
// findDescrStratAnchorEnd, readCurrentYearFromSave, readTurnFromSave moved to
// src/saveBinaryReaders.js (pure buffer readers, unit-tested). Imported at top.

function parseCharactersAndUnits(saveBuf, precomputedChars = null) {
  if (!modNameLookup || !modTraitNames) return null;
  // v2 parser: finds the scripted-character section reliably. Uses the
  // confirmed record layout (type=3 header, birth year, trait list, etc).
  // This is the primary source for named characters; v1 (below) is kept
  // only for the per-unit-region resolver (findCharacterRegion).
  const charsV2 = findCharsV2(saveBuf, modNameLookup, modTraitNames);
  const currentYear = readCurrentYearFromSave(saveBuf);
  for (const c of charsV2) {
    c.age = currentYear != null && c.birthYear ? currentYear - c.birthYear : null;
  }
  // Captain fallback: characters whose own commanderUuid doesn't resolve to
  // a type-6 position record (typically captains attached to leaderless
  // armies — their position is the army they're stacked with) get filled in
  // from descr_strat by name+faction. At turn 1 this matches exactly; at
  // later turns the live-log overlay corrects positions when the captain
  // moves. Only fills when x/y are null — never overrides a save-derived
  // position.
  if (modDescrStratCharByName && modDescrStratCharByName.size > 0) {
    let filled = 0;
    for (const c of charsV2) {
      if (c.x != null && c.y != null) continue;
      let entry = c.faction ? modDescrStratCharByName.get(c.firstName + "|" + c.faction) : null;
      // Fall back to firstName-only lookup when no faction match — avoids
      // missing chars whose v2 faction tag differs from descr_strat naming.
      if (!entry) {
        const list = modDescrStratCharsByFirstName.get(c.firstName) || [];
        if (list.length === 1) entry = list[0];
        else if (list.length > 1 && c.lastName) entry = list.find(e => e.lastName === c.lastName);
      }
      if (entry) { c.x = entry.x; c.y = entry.y; c.fromDescrStrat = true; filled++; }
    }
    if (filled > 0) console.log("[characters] descr_strat fallback positioned " + filled + " captains");
  }

  // Legacy broad scan (may find a handful of generated/family chars v2 misses).
  // We dedupe by offset below.
  // Use precomputedChars if a worker thread already ran this scan. The
  // worker also applies trait-driven epithets, so when we use it we can
  // skip the epithet pass below.
  const characters = precomputedChars || findCharacterRecords(saveBuf, modNameLookup, modTraitNames, null);
  // 0.9.521: resolve each trait's DISPLAY LEVEL via threshold lookup.
  // characterParser.js reads the raw u16 at trait+4 as `points` (accumulated
  // trait points). The engine's displayed level is computed by walking the
  // trait's level thresholds and picking the highest whose threshold <=
  // points. Without this pass, UI code that shows `t.level` displays the
  // raw points (e.g. "Estates 26" instead of "Estates 2").
  if (modTraitLevels) {
    for (const c of characters) {
      if (!c.traits || c.traits.length === 0) continue;
      for (const t of c.traits) {
        if (typeof t.points !== "number") continue;
        const lvls = modTraitLevels[t.name];
        if (!lvls || lvls.length === 0) continue;
        let displayLevel = 0;
        let chosenName = null;
        for (let i = 0; i < lvls.length; i++) {
          const thr = lvls[i].threshold;
          if (thr != null && t.points >= thr) {
            displayLevel = i + 1;
            chosenName = lvls[i].name || null;
          }
        }
        t.level = displayLevel;
        if (chosenName) t.levelName = chosenName;
      }
    }
  }
  // Apply trait-driven cognomen overrides. (Skipped when chars came
  // from the worker — it does this pass itself.)
  if (!precomputedChars && modTraitEpithets) {
    // RTW's `Epithet` keyword grants either a SURNAME-replacement (a Latin
    // cognomen like "Messapivs", "Africanus") or a NICKNAME ("the
    // Drunkard"). The text content distinguishes them — nicknames start
    // with a leading article ("the ", "der ", etc.). We only override
    // lastName for surname-style epithets; nickname-style ones are
    // appended (with a leading space) so the displayed name reads e.g.
    // "Aulus Gabinius the Drunkard" or "Aulus Messapivs". This matches
    // the in-game UI's display order.
    const isNickname = (s) => /^(the|de|der|le|la|el|il|den|den)\s/i.test(s);
    for (const c of characters) {
      if (!c.traits || c.traits.length === 0) continue;
      let surname = null, nickname = null;
      for (const t of c.traits) {
        const candidates = modTraitEpithets[t.name];
        if (!candidates) continue;
        // Highest-level epithet wins within a trait family. Across
        // families, last one applied wins for nicknames; surnames stack
        // by deepest trait level (more conquests → fancier cognomen).
        let best = null;
        for (const cand of candidates) {
          if (!best || cand.level > best.level) best = cand;
        }
        if (!best) continue;
        if (isNickname(best.text)) nickname = best.text;
        else if (!surname || best.level > (surname.level || 0)) surname = best;
      }
      // Preserve the original (birth) lastName for live-log key
      // matching — the engine emits the birth name even after an
      // epithet trait fires. See charactersWorker.js for the same
      // logic on the worker path.
      if (surname || nickname) {
        c.originalLastName = c.lastName || null;
      }
      if (surname) c.lastName = surname.text;
      if (nickname) c.lastName = (c.lastName ? c.lastName + " " : "") + nickname;
    }
  }
  const worldPositions = parseWorldObjectPositions(saveBuf);
  // Save-direct character metadata (class name + region UTF-16 string),
  // keyed by character secondaryUuid. Used as primary region source — it
  // covers characters without a bodyguard unit (diplomats/spies/captains)
  // that the unit-region fallback below misses.
  const charMetaByUuid = parseCharacterMetadataByUuid(saveBuf);
  // Parse units first so we can build a `commanderUuid → region` index. The
  // legacy `findCharacterRegion()` did a full-buffer indexOf scan PER
  // character (~33s on a 40MB save with 100 characters); the index makes
  // each lookup O(1) and the unit parse runs in ~0.2s.
  const units = findUnitRecords(saveBuf);
  const regionByCommanderUuid = new Map();
  for (const u of units) {
    if (u.commanderUuid && u.region && !regionByCommanderUuid.has(u.commanderUuid)) {
      regionByCommanderUuid.set(u.commanderUuid, u.region);
    }
  }
  for (const c of characters) {
    const meta = c.secondaryUuid ? charMetaByUuid.get(c.secondaryUuid) : null;
    c.characterClass = meta?.className || null;
    c.region = (meta?.regionName) || regionByCommanderUuid.get(c.secondaryUuid) || null;
    // For v1 character records the army-commander UUID is `secondaryUuid`
    // (offset -43 from record start). The earlier code read offset -16,
    // which works for v2 but is junk for v1 — that's why position-on-map
    // was empty for ~50% of v1 chars. Try secondaryUuid first, fall back
    // to a few legacy offsets so any character we identified gets a shot.
    try {
      const candidates = [];
      if (c.secondaryUuid) candidates.push(c.secondaryUuid);
      if (c.primaryUuid) candidates.push(c.primaryUuid);
      if (c.offset >= 16) candidates.push(saveBuf.readUInt32LE(c.offset - 16));
      for (const uuid of candidates) {
        const pos = uuid && worldPositions.get(uuid);
        if (pos) {
          c.worldObjectUuid = uuid;
          c.x = pos.x;
          c.y = pos.y;
          break;
        }
      }
    } catch {}
  }
  // Add officer counts to soldier/maxSoldier so the displayed totals match
  // the in-game UI (the save stores only rank-and-file).
  if (modUnitOfficerCounts) {
    for (const u of units) {
      const o = modUnitOfficerCounts[u.name];
      if (o > 0) {
        if (u.soldiers > 0) u.soldiers += o;
        if (u.maxSoldiers > 0) u.maxSoldiers += o;
      }
    }
  }
  // Faction-block markers: every faction's character/unit run in the save
  // is preceded by a `captain_card_<faction>.tga` ASCII path. Each unit's
  // file offset tells us which faction's block it sits in, and therefore
  // which faction commands the army it's part of.
  // 0.9.774: HOISTED above the charactersByRegion build (was below at
  // ~1825). The v1 faction-tag pass needs to run BEFORE we snapshot each
  // character into charactersByRegion, otherwise the region entries get
  // faction=null and the live commander-info → portrait swap falls back to
  // the bodyguard unit icon (live leader/general portrait bug). factionMarkers
  // / factionAtOffset only depend on saveBuf, so they're safe to define here
  // and remain in scope for the army-labelling loops further down.
  const factionMarkers = (function() {
    const out = [];
    const pattern = Buffer.from("captain_card_", "ascii");
    let p = 0;
    while ((p = saveBuf.indexOf(pattern, p)) !== -1) {
      let end = p + pattern.length;
      let factionName = "";
      while (end < saveBuf.length && saveBuf[end] !== 0x2e /* . */) {
        const b = saveBuf[end];
        if (b < 0x20 || b > 0x7e) break;
        factionName += String.fromCharCode(b);
        end++;
      }
      if (factionName.length > 0 && factionName.length < 30) {
        out.push({ pos: p, faction: factionName });
      }
      p += pattern.length;
    }
    out.sort((a, b) => a.pos - b.pos);
    return out;
  })();
  // Binary search the most recent faction marker preceding `off`.
  const factionAtOffset = (off) => {
    let lo = 0, hi = factionMarkers.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (factionMarkers[mid].pos <= off) lo = mid + 1; else hi = mid;
    }
    return lo > 0 ? factionMarkers[lo - 1].faction : null;
  };
  // 0.9.774: nearest marker AT OR AFTER `off`. The player faction's own
  // character block is written near the TOP of the save — BEFORE the first
  // `captain_card_<faction>.tga` path appears (verified on RIS Republic-of-
  // Rome T1: Quintus/Marcus/Servius at offset ~22,619,662 vs the first
  // marker — itself romans_julii — at 22,627,784). So preceding-marker
  // lookup returns null for them. The block immediately precedes its own
  // faction's first marker, so the nearest FOLLOWING marker is the right
  // attribution. Used ONLY as a fallback when factionAtOffset misses, so
  // it can't override a correctly-preceding marker.
  const factionAtOrAfterOffset = (off) => {
    let lo = 0, hi = factionMarkers.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (factionMarkers[mid].pos < off) lo = mid + 1; else hi = mid;
    }
    return lo < factionMarkers.length ? factionMarkers[lo].faction : null;
  };

  // 0.9.497: tag every v1 character with their faction via the captain_card
  // marker preceding their record. The v1 parser doesn't set c.faction
  // itself, so every char came out faction="" — which broke the stats cache
  // because the cache keys include faction and renderer lookups by
  // `<name>||<faction>` then by `<name>||` missed every char whose name
  // collides with another faction's (e.g. Achaios). Also bridges from v2
  // chars (which DO have faction) by matching primaryUuid as a higher-
  // confidence source. Tag count is logged so we can verify in provincia.log.
  {
    const v2ByPrimaryUuid = new Map();
    for (const c of charsV2) {
      if (c.primaryUuid) v2ByPrimaryUuid.set(c.primaryUuid, c);
    }
    let taggedByV2 = 0, taggedByMarker = 0, taggedByAfter = 0, untagged = 0;
    for (const c of characters) {
      if (c.faction) continue;
      // Prefer v2 match (most authoritative source — v2 picks up the
      // captain_card markers in its own assignFactions pass).
      const v2 = c.primaryUuid && v2ByPrimaryUuid.get(c.primaryUuid);
      if (v2 && v2.faction) { c.faction = v2.faction; taggedByV2++; continue; }
      // Fall back to the captain_card marker preceding this character's
      // file offset — same logic the unit-record path uses.
      if (c.offset != null) {
        const f = factionAtOffset(c.offset);
        if (f) { c.faction = f; taggedByMarker++; continue; }
        // 0.9.774: the player faction's char block precedes ALL markers
        // (see factionAtOrAfterOffset). Use the nearest following marker so
        // the player's own leader/heirs/generals (Quintus/Marcus/Servius on
        // RIS Rome T1) get a faction → culture → real portrait instead of
        // the bodyguard unit icon.
        const fa = factionAtOrAfterOffset(c.offset);
        if (fa) { c.faction = fa; taggedByAfter++; continue; }
      }
      untagged++;
    }
    console.log(`[v1-faction-tag] tagged ${taggedByV2}/${characters.length} via v2 uuid match, ${taggedByMarker} via captain_card marker, ${taggedByAfter} via following marker (pre-first-marker block), ${untagged} still untagged`);
  }

  // Index by region for easy UI consumption
  const charactersByRegion = {};
  for (const c of characters) {
    if (!c.region) continue;
    if (!charactersByRegion[c.region]) charactersByRegion[c.region] = [];
    charactersByRegion[c.region].push({
      firstName: c.firstName,
      lastName: c.lastName,
      // Birth lastName (pre-epithet) — same purpose as in liveArmies. The
      // renderer uses this to match a character by birth name when an
      // epithet trait has renamed lastName. Without it the move-region
      // filter / character-incoming pass can fail when the displayed name
      // changes mid-campaign.
      originalLastName: c.originalLastName || null,
      age: c.age,
      gender: c.gender,
      isLeader: c.isLeader,
      isHeir: c.isHeir,
      isDead: c.isDead,
      // 0.9.774: carry the v1 character's faction into the region entry.
      // saveCharactersByRegion is the PRIMARY source for the live
      // commander-info → bodyguard-swap portrait path (App.js builds the
      // commanderInfo map from c.faction). Before this the v1 entry omitted
      // faction entirely, so every live garrison/field general arrived with
      // faction=null → culture couldn't resolve → portrait fell back to the
      // bodyguard unit icon. The faction-tag pass is hoisted ABOVE this
      // build (see the captain_card marker block) so c.faction is populated
      // by the time we snapshot here.
      faction: c.faction || null,
      // secondaryUuid matches a unit's commanderUuid — used to label armies.
      secondaryUuid: c.secondaryUuid,
      // x,y from the world-object record (may be null for some characters
      // whose worldObjectUuid is stored at a different offset).
      x: c.x ?? null,
      y: c.y ?? null,
      traitCount: c.traits.length,
      keyTraits: c.traits
        .filter(t => /^(Factionleader|Factionheir|Leader_Rating|GoodCommander|GoodAdministrator|NaturalMilitarySkill|PoliticsSkill|Patrician|Senatorial)$/.test(t.name))
        .map(t => ({ name: t.name, level: t.level })),
      // Full trait list (name + level) for the right-click popup. Cheap to
      // ship through IPC (each char has <30 traits typically) and saves a
      // round-trip when the user wants to inspect.
      traits: c.traits.map(t => ({ name: t.name, level: t.level })),
      // Ancillaries — list of { id, name }. Names resolved via the
      // mod's export_descr_ancillaries.txt (ID is the 0-based position
      // of an `Ancillary <name>` declaration). Empty list when the
      // character has none (most do).
      ancillaries: (c.ancillaries || []).map(a => ({
        id: a.id,
        name: (modAncillaryNames && modAncillaryNames[a.id]) || `#${a.id}`,
      })),
      // Clan-head / cognomen link — save-cracker session 8. Most chars
      // have null here; specific ones bound to a Roman gens (e.g. Aulus
      // and Marcus both linked to `Cornelius_Scapula`) carry a real
      // name-lookup index.
      clanHead: c.clanHead ? { name: c.clanHead.name, relType: c.clanHead.relType } : null,
      // Fine-grained age (4-turns-per-year precision) — save-cracker
      // session 4. Engine ticks +64 per turn. The basic `age` field
      // above is the rounded integer; this one is for tooltips that
      // want sub-year precision.
      ageFineQuarter: c.ageFineQuarter || null,
      // Primary uuid for cross-referencing parent→child links — save-
      // cracker session 13 confirmed children's primaryUuids are stored
      // as a 4-slot array at character +54..+66 (LAYOUT_A) / +50..+62
      // (LAYOUT_B). The renderer resolves child names via a global
      // primaryUuid index built from this field.
      primaryUuid: c.primaryUuid || null,
      childUuids: Array.isArray(c.childUuids) ? c.childUuids : [],
      portrait: c.portraits[0] || null,
      // 0.9.775: engine-exact /cards/ portrait, resolved IDENTICALLY to the
      // family tree's v1PortraitsByCoord (see the v1-portrait-bridge block
      // below + src/FamilyTree.js). The raw `portrait` (c.portraits[0]) above
      // can be a generic 000 / a /dead/ stub the forward-scan grabbed; the
      // family tree instead picks the first NON-bad candidate (preferring the
      // large /portraits/portraits/ variant) and rewrites it to the small
      // /cards/ path the unit cards load. The commander/army-card portrait
      // path (App.js commanderInfo → RegionInfo CommanderPortraitImg) was
      // forcing savePath=null (0.9.460) → an arbitrary DJB2 name-hash pick
      // that landed on a wrong-looking face (e.g. Rome's Quintus Ogulnius
      // showing a steppe/Scythian portrait). Attaching the family tree's exact
      // pick here lets the commander card use the SAME per-character portrait
      // the family tree shows; the hash pool stays a pure fallback for chars
      // this resolver can't place. Verified: scripts/probe-commander-portrait-
      // match.js (560/948 Rome chars now match the family tree, 0 mismatches).
      portraitCardsPath: (() => {
        const ports = Array.isArray(c.portraits) ? c.portraits : [];
        const isBadPath = (p) => !p || (!c.isDead && /\/dead\//i.test(p));
        const goodLarge = ports.find((p) => !isBadPath(p) && /\/portraits\/portraits\//i.test(p));
        const goodAny = ports.find((p) => !isBadPath(p));
        const pick = goodLarge || goodAny;
        return pick ? pick.replace(/\/portraits\/portraits\//i, "/portraits/cards/") : null;
      })(),
      // 0.9.420: character stats (command, influence, management, loyalty).
      // Verified against in-game ground truth for Antigonos II Gonatas
      // (Macedon T0 RIS: Command 7, Influence 6, Management 5).
      command: typeof c.command === "number" ? c.command : null,
      influence: typeof c.influence === "number" ? c.influence : null,
      management: typeof c.management === "number" ? c.management : null,
      loyalty: typeof c.loyalty === "number" ? c.loyalty : null,
      // Movement points remaining this turn — f32 at the character's coord/state
      // record +58 (decoded session 101, re-confirmed 2026-06-06 via the
      // stride-354 record decomposition; triple-validated on a controlled 1-tile
      // move: 248.0→239.2). Only field generals commanding an army carry a coord
      // record → governors/family-in-residence are null. The save stores REMAINING
      // only (no per-type max), so the renderer shows MP remaining, flagging
      // "out of moves" when below the ~7.4 cost of one tile. (live-save only)
      mpRemaining: typeof c.mpRemaining === "number" ? c.mpRemaining : null,
      // Pending MOVE ORDER destination tile (CHARACTER_ACTION_DETAILS, cracked
      // 2026-06-06). Live only when the dest is a valid on-map tile != current
      // (idle chars carry stale junk). moveActive = the player's own active
      // short move (flag 0x100); 0x300/0x400 = AI strategic march. (live-save only)
      moveDestX: typeof c.moveDestX === "number" ? c.moveDestX : null,
      moveDestY: typeof c.moveDestY === "number" ? c.moveDestY : null,
      moveActive: !!c.moveActive,
    });
  }
  // Augment with v2 characters that the v1 parser missed. The UI's
  // RegionInfo "Other faction armies" section iterates this map and looks
  // units up via secondaryUuid → unit.commanderUuid. v2's commanderUuid
  // field plays the same role, so we expose it under the secondaryUuid
  // key. Region is inferred from the units this character commands.
  const v1KnownUuids = new Set();
  for (const list of Object.values(charactersByRegion)) {
    for (const c of list) if (c.secondaryUuid) v1KnownUuids.add(c.secondaryUuid);
  }
  // Self-contained stack-marker → unit-region map. Duplicated logic with the
  // main sequential-grouping pass below because that pass runs after this
  // block; we need commander→region resolution here to populate
  // charactersByRegion for captain stacks whose unit records have
  // commanderUuid=null. Each marker [ffffffff][0x15][uuid] sits right before
  // the first unit of its stack; the region of that next-in-offset unit is
  // the commander's region.
  const _markerRegionByUuid = new Map();
  {
    const unitsByOff = units.slice().sort((a, b) => a.offset - b.offset);
    const markers = [];
    for (let p = 0; p + 12 < saveBuf.length; p++) {
      if (saveBuf.readUInt32LE(p) !== 0xffffffff) continue;
      const filler = saveBuf.readUInt32LE(p + 4);
      if (filler < 1 || filler > 256) continue;
      const uuid = saveBuf.readUInt32LE(p + 8);
      if (uuid === 0) continue;
      markers.push({ pos: p, uuid });
    }
    markers.sort((a, b) => a.pos - b.pos);
    for (const m of markers) {
      // binary search for first unit with offset > m.pos
      let lo = 0, hi = unitsByOff.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (unitsByOff[mid].offset <= m.pos) lo = mid + 1; else hi = mid;
      }
      if (lo < unitsByOff.length && unitsByOff[lo].region) {
        if (!_markerRegionByUuid.has(m.uuid)) _markerRegionByUuid.set(m.uuid, unitsByOff[lo].region);
      }
    }
  }
  for (const v2 of charsV2) {
    if (!v2.commanderUuid || v1KnownUuids.has(v2.commanderUuid)) continue;
    // Region lookup: direct (bodyguard unit), fall back to stack-marker.
    const owned = units.find(u => u.commanderUuid === v2.commanderUuid);
    const region = owned?.region || _markerRegionByUuid.get(v2.commanderUuid);
    if (!region) continue;
    if (!charactersByRegion[region]) charactersByRegion[region] = [];
    charactersByRegion[region].push({
      firstName: v2.firstName,
      lastName: v2.lastName,
      age: null,
      gender: v2.gender,
      faction: v2.faction || null,
      isLeader: v2.traits?.some(t => t.name === "Factionleader") || false,
      isHeir: v2.traits?.some(t => t.name === "Factionheir") || false,
      isDead: false,
      secondaryUuid: v2.commanderUuid, // links to unit.commanderUuid
      x: v2.x ?? null,
      y: v2.y ?? null,
      traitCount: v2.traits?.length || 0,
      keyTraits: (v2.traits || [])
        .filter(t => /^(Factionleader|Factionheir|GoodCommander|GoodAdministrator|NaturalMilitarySkill)$/.test(t.name))
        .map(t => ({ name: t.name, level: t.level })),
      portrait: v2.portraits?.[0] || null,
      _fromV2: true,
    });
  }
  // unitsByRegion build is below — MUST run after the sequential grouping
  // pass that sets u.inferredCmd. If built here, every unit ships with
  // inferredCmd=null and the UI's stack separation breaks (which was the
  // actual regression in 0.9.77 where Alexander/Memnon/etc. showed their
  // bodyguards alone while the rest of their stacks piled into Garrison).
  // Also index v2 characters by faction (clean source of scripted chars with
  // birth year → age, full trait list, portraits, coords).
  const v2ByFaction = {};
  for (const c of charsV2) {
    const f = c.faction || "unknown";
    if (!v2ByFaction[f]) v2ByFaction[f] = [];
    v2ByFaction[f].push({
      offset: c.offset,
      firstName: c.firstName,
      lastName: c.lastName || null,
      birthYear: c.birthYear,
      age: c.age,
      gender: c.gender,
      traitCount: c.traitCount,
      traits: c.traits.map(t => ({ id: t.id, name: t.name, level: t.level })),
      portraits: c.portraits,
      x: c.x ?? null,
      y: c.y ?? null,
      worldObjectUuid: c.worldObjectUuid || null,
    });
  }

  // Group units into armies, REGION-BASED.
  //
  // Old approach (sequential): walked units by file offset, opened a new
  // "army" on every commanderUuid, attached subsequent commander-less
  // units to that army only if their region matched. This relied on the
  // file's storage order encoding stack membership — it doesn't on RIS
  // imperial. ~36% of units (2002 of 5573 in athens_t22mid) fell through
  // because their region didn't match the most-recent named-army region
  // (a Roman garrison sitting in Roma after a Frentania field army record
  // was stored ahead of it would get DROPPED). Stack markers `[ff…][0x15]
  // [uuid]` were also looked for but don't appear in RIS-imperial saves.
  //
  // New approach: trust the unit record's own data. Each unit carries its
  // own `commanderUuid` (or null for settlement garrison). Group by:
  //   • commanderUuid != null  →  belongs to that army, full stop
  //   • commanderUuid == null  →  the region's settlement garrison
  // No sequential context. No region-match dance. Each unit ends up
  // exactly where the engine wrote it.
  //
  // This loses the heuristic that "commander-less units after a named
  // army in the same region might be that army's foot units" — but that
  // heuristic was wrong as often as right (a 36% drop rate on RIS), and
  // the real signal lives in the unit record's own commanderUuid byte.
  const unitsByCommander = new Map();
  for (const u of units) {
    if (u.commanderUuid) {
      if (!unitsByCommander.has(u.commanderUuid)) unitsByCommander.set(u.commanderUuid, []);
      unitsByCommander.get(u.commanderUuid).push(u);
      u.inferredCmd = u.commanderUuid;
    }
    // Commander-less: no inferredCmd yet. The next pass attaches them to
    // the most recent preceding general's stack IF the region matches —
    // restoring the file-order foot-unit attribution. Without this pass,
    // every cmd=0 foot unit (legions following a Roman general into
    // enemy territory, garrison defenders inside an enemy-held city,
    // etc.) ended up in the destination region's garrison list — even
    // when they were clearly part of a named field army stored just
    // ahead of them. Tested on save_rome1.sav: the player's invasion
    // stack at Taras (Aulus + 13 roman foot) was pile-driving into the
    // garrison panel, while the Tarentine defenders (Milon + 6 greek
    // foot) were also in there — both stacks fully misattributed.
    //
    // The region-match guard is what makes this safe. The earlier
    // sequential-grouping bug (~36% drop rate on athens_t22mid) was
    // because the rule attached units to the most recent general WITHOUT
    // checking region — so a Roma garrison stored after a Frentania
    // field army got tagged as Frentania's. Requiring region equality
    // pulls only ACTUAL stack members, leaves true settlement garrisons
    // alone (their region differs from any general's region anyway, or
    // there's no preceding general in their region).
  }
  // Pass 2: file-order foot-unit attribution.
  //
  // RTW writes each army's units contiguously in the save (bodyguard
  // first, then foot). So the immediately-preceding cmd!=0 general in
  // file order is almost always the foot's commander.
  //
  // Earlier rule required the general's region to MATCH the foot's
  // region, on the theory that mismatched regions meant the foot were
  // settlement defenders that just happened to be filed after a
  // foreign-region general. In practice the opposite is more common:
  // when a general's army moves mid-turn the engine updates his
  // bodyguard's region tag immediately but the foot's region tag lags
  // (or vice-versa), so a strict region match drops his real foot.
  //
  // Concrete case (save_rome4): user moves new general Marcus into Uria
  // and "grabs" Aulus's army, then moves the merged stack to siege
  // Brundisium. Save state at the moment: Marcus's bodyguard tagged
  // Metapontion, his 13 foot still tagged Taras (Aulus's old region).
  // File order has Marcus's bodyguard immediately before the 13 foot —
  // they ARE his army — but the strict region-match rule rejected
  // them, leaving Marcus's army showing 1 unit and the foot stuck as
  // orphan settlement defenders.
  //
  // New rule: attach foot to the immediately preceding general by file
  // order, full stop. Trade-off: if the engine ever stores a true
  // settlement garrison RIGHT AFTER an unrelated general's record, the
  // garrison would mis-attribute. In practice that ordering is rare —
  // RTW groups units by army and settlements by city.
  {
    const ordered = units.slice().sort((a, b) => a.offset - b.offset);
    let lastCmd = null;
    for (const u of ordered) {
      if (u.commanderUuid) {
        lastCmd = u.commanderUuid;
        continue;
      }
      if (!lastCmd) continue;
      // Skip naval units — they're anonymous fleets handled by the
      // navy-synthesis pass below (each cluster grouped by army_uuid
      // from u32(i-20) → type-4 position record). Without this skip the
      // file-order rule swept naval biremes into the nearest land
      // general's stack (user reported a "24" naval bireme showing
      // inside Aulus's garrison). Both the unit name prefix and the
      // "the sea" region uniquely identify naval units in RTW saves.
      if (/^naval\b/i.test(u.name || "") || u.region === "the sea") continue;
      u.inferredCmd = lastCmd;
      const list = unitsByCommander.get(lastCmd);
      if (list) list.push(u);
    }
  }
  // Build unitsByRegion here, AFTER every unit's inferredCmd has been set,
  // so the payload going to the renderer carries accurate stack linkage.
  const unitsByRegion = {};
  for (const u of units) {
    if (!u.region) continue;
    if (!unitsByRegion[u.region]) unitsByRegion[u.region] = [];
    unitsByRegion[u.region].push({
      name: u.name,
      soldiers: u.soldiers,
      maxSoldiers: u.maxSoldiers,
      commanderUuid: u.commanderUuid,
      inferredCmd: u.inferredCmd || null,
      // Live XP / weapon / armour from the save (save-cracker session 10).
      // Provincia's panel previously seeded these from descr_strat by
      // unit-name FIFO match within region — that missed mid-campaign
      // recruits, multi-recruit name collisions, and just-fought units
      // that gained chevrons. Now they come from the actual unit record.
      xp: u.xp || 0,
      weapon: u.weaponUpgrade || 0,
      armour: u.armourUpgrade || 0,
      // Combined smithy weapon/armor upgrade level (unitParser H+17, CONFIRMED
      // on RIS 2026-06-01). null when unreadable/implausible — never a fake 0.
      upgradeLevel: typeof u.upgradeLevel === "number" ? u.upgradeLevel : null,
      // MP remaining for this unit (f32 at the unit header +4; read for ALL
      // variant-A units 2026-05-31, not just bodyguards). The save stores the
      // CURRENT MP but NOT the per-unit-type max, so the UI can only honestly
      // show "MP remaining" — not a definitive moved/not-moved. null when
      // unreadable (e.g. variant-B layout).
      movementPoints: typeof u.movementPoints === "number" ? u.movementPoints : null,
    });
  }
  // Group characters who share the same army. A character links to an army
  // via whichever of their UUIDs happens to be in unitsByCommander, falling
  // back to (x, y) position. Use the resolved uuid (or "P:x,y") as the key
  // so that character A's commanderUuid and character B's worldObjectUuid
  // pointing to the same uuid yield the same key.
  const armyKey = (c) => {
    if (c.commanderUuid && unitsByCommander.has(c.commanderUuid)) return "U:" + c.commanderUuid;
    if (c.worldObjectUuid && unitsByCommander.has(c.worldObjectUuid)) return "U:" + c.worldObjectUuid;
    if (c.x != null && c.y != null) return "P:" + c.x + "," + c.y;
    return null;
  };
  // Collect characters per armyKey, then pick a leader per group.
  const armyMembers = new Map(); // key → [chars]
  for (const c of charsV2) {
    if (c.x == null || c.y == null) continue;
    const key = armyKey(c);
    if (!key) continue;
    if (!armyMembers.has(key)) armyMembers.set(key, []);
    armyMembers.get(key).push(c);
  }
  // Leader priority:
  //   1. Characters with a Factionleader or Factionheir trait
  //   2. Most traits (real general > passive family member)
  //   3. Lowest file offset (earliest recorded)
  function pickLeader(chars) {
    const isLeader = (c) => c.traits.some(t => t.name === "Factionleader");
    const isHeir   = (c) => c.traits.some(t => t.name === "Factionheir");
    chars.sort((a, b) => {
      const la = isLeader(a) ? 2 : isHeir(a) ? 1 : 0;
      const lb = isLeader(b) ? 2 : isHeir(b) ? 1 : 0;
      if (la !== lb) return lb - la;
      if (a.traitCount !== b.traitCount) return b.traitCount - a.traitCount;
      return a.offset - b.offset;
    });
    return chars;
  }
  const armyMap = new Map();
  for (const [key, members] of armyMembers) {
    const sorted = pickLeader(members.slice());
    const leader = sorted[0];
    const passengers = sorted.slice(1);
    // Resolve units list: commanderUuid first, worldObjectUuid fallback.
    let commandedUnits = [];
    if (leader.commanderUuid && unitsByCommander.has(leader.commanderUuid)) {
      commandedUnits = unitsByCommander.get(leader.commanderUuid);
    } else if (leader.worldObjectUuid && unitsByCommander.has(leader.worldObjectUuid)) {
      commandedUnits = unitsByCommander.get(leader.worldObjectUuid);
    }
    armyMap.set(key, { leader, passengers, units: commandedUnits });
  }
  // Ensure every bodyguard-led army is represented, even if no scripted
  // character matched its commanderUuid. For unmatched ones, place the
  // army at its bodyguard unit's inferred position (via type-6 lookup on
  // commanderUuid). Leader is labeled by faction + region.
  const positions = (function() {
    const m = new Map();
    // Includes type=4 (navy), type=5 (captain land army), type=6 (bodyguard).
    for (let N = 24; N < saveBuf.length - 8; N++) {
      if (saveBuf.readUInt32LE(N - 4) !== N - 4) continue;
      const type = saveBuf.readUInt32LE(N - 12);
      if (type !== 6 && type !== 5 && type !== 4) continue;
      const x = saveBuf.readUInt32LE(N);
      // Bounds raised 2026-05-09 — see parseWorldObjectPositions above.
      if (x < 0 || x > 1100) continue;
      const y = saveBuf.readUInt32LE(N + 4);
      if (y < 0 || y > 800) continue;
      const uuid = saveBuf.readUInt32LE(N - 8);
      if (!uuid) continue;
      // Moved-this-turn flag — save-cracker session 4 CONFIRMED across two
      // independent move-pair diffs. Bit 7 of the byte at N+9 (relative
      // to the x coord) flips from 0 to 1 when the character moves
      // this turn. Lets us mark armies "has moved" / "still has actions"
      // without waiting for the next save snapshot.
      const movedFlag = N + 9 < saveBuf.length ? (saveBuf[N + 9] & 0x80) !== 0 : false;
      if (type === 6 || !m.has(uuid)) m.set(uuid, { x, y, moved: movedFlag });
    }
    return m;
  })();
  // Index v1 characters by their commander UUID (secondaryUuid). On RIS
  // imperial — where charsV2 is empty — this is the ONLY way to put a
  // real name on an army. Without this, every one of the ~1100 RIS armies
  // showed as "(unknown)" on the map, despite the v1 parser knowing each
  // commander's name.
  const v1CharByCmdUuid = new Map();
  for (const c of characters) {
    if (c.secondaryUuid) v1CharByCmdUuid.set(c.secondaryUuid, c);
  }
  for (const [cmdUuid, armyUnits] of unitsByCommander) {
    const key = "U:" + cmdUuid;
    if (armyMap.has(key)) continue;
    // First try a v1 character match — works on RIS imperial.
    const v1 = v1CharByCmdUuid.get(cmdUuid);
    const pos = positions.get(cmdUuid);
    if (!pos && !v1) continue;
    const bodyguard = armyUnits[0];
    // Faction: prefer v1 char's parsed faction (TODO: parser doesn't tag
    // v1 chars with faction yet), else look at the first unit's offset
    // and read the captain_card faction marker preceding it. Falls back
    // to the bodyguard's region's faction (resolveCurrentOwners), then
    // "unknown".
    const factionFromMarker = bodyguard?.offset != null ? factionAtOffset(bodyguard.offset) : null;
    // Label fallback: when no v1 character attaches, label as a captain of
    // the faction that owns the unit-block. Better than "(unknown)" — gives
    // the user a real attribution when the character record isn't decoded.
    const captainLabel = factionFromMarker
      ? `${factionFromMarker.replace(/_/g, " ")} captain`
      : "Captain";
    const leader = {
      firstName: v1?.firstName || captainLabel,
      lastName: v1?.lastName || bodyguard?.region || null,
      // Preserve the BIRTH lastName when a trait epithet renamed the
      // displayed lastName (e.g. Aulus Gabinius → Aulus Messapivs the
      // Wallbreaker after RomanConquerorMessapians + Legendary_Siege_Expert
      // fired). The character parser sets originalLastName before
      // replacing lastName; without this propagation step, the renderer's
      // synth-dedupe falls back to the renamed name and produces a
      // duplicate marker at the descr_strat starting tile.
      originalLastName: v1?.originalLastName || null,
      x: (pos?.x) ?? null,
      y: (pos?.y) ?? null,
      moved: !!(pos && pos.moved),
      faction: factionFromMarker || "unknown",
      offset: v1?.offset || null,
      age: v1?.age,
      gender: v1?.gender,
      traitCount: v1?.traits?.length || 0,
      traits: v1?.traits || [],
      isLeader: v1?.isLeader || false,
      isHeir: v1?.isHeir || false,
      isDead: v1?.isDead || false,
      worldObjectUuid: cmdUuid,
      commanderUuid: cmdUuid,
      primaryUuid: v1?.primaryUuid || null,
    };
    armyMap.set(key, { leader, passengers: [], units: armyUnits });
  }

  const liveArmies = [];
  for (const [, army] of armyMap) {
    const { leader, passengers, units: commandedUnits } = army;
    // The bodyguard unit (first commanded unit) carries f32 movement
    // points at +4 from its commanderUuid. Take it from THIS army's
    // own unit list — not the outer-loop's bodyguard which is out of
    // scope here. (Fixed 0.9.301: silent ReferenceError on this line
    // had been crashing the entire save parser, blanking out
    // saveCharactersByRegion / saveLiveArmies → live merge etc never
    // worked because the data never reached the renderer.)
    const armyBodyguard = commandedUnits[0] || null;
    const unitNames = commandedUnits.map(u => (u.name || "").toLowerCase());
    const isNavy = commandedUnits.length > 0 && unitNames.every(n => /^naval\b/.test(n));
    liveArmies.push({
      faction: leader.faction || "unknown",
      character: leader.lastName ? `${leader.firstName} ${leader.lastName}` : leader.firstName,
      firstName: leader.firstName,
      lastName: leader.lastName || null,
      // Birth-record lastName, preserved when an epithet trait
      // overrode lastName for display. Used by armiesToRender's match
      // cascade so the log's birth-name MOVING_NORMAL events still
      // pair with the save army.
      originalLastName: leader.originalLastName || null,
      role: null,
      age: leader.age,
      birthYear: leader.birthYear,
      gender: leader.gender,
      traits: leader.traits.map(t => ({ name: t.name, level: t.level })),
      x: leader.x,
      y: leader.y,
      armyClass: isNavy ? "navy" : "field",
      // Movement points remaining (raw f32 from the bodyguard unit's +4
      // field). Save-cracker dossier 2026-05-10. The bodyguard's record
      // mirrors the general's MP; we surface it on the army so hover
      // tooltips can show "MP: 231.1" without an extra lookup.
      movementPoints: armyBodyguard?.movementPoints ?? null,
      // Has-moved-this-turn flag — bit 7 of the byte at character-position
      // record +9. Decoded in save-cracker session 4, cross-validated in
      // session 2 (one move pair + one no-move pair). Lets the hover
      // tooltip show "has moved" / "still has actions" without waiting
      // for a save reload.
      moved: !!leader.moved,
      units: commandedUnits.map(u => ({
        name: u.name,
        soldiers: u.soldiers,
        maxSoldiers: u.maxSoldiers,
        region: u.region || null,
        exp: 0,
        // Combined smithy weapon/armor upgrade level (unitParser H+17). null
        // when unreadable — never a fake 0 ([[provincia-no-fallbacks]]).
        upgradeLevel: typeof u.upgradeLevel === "number" ? u.upgradeLevel : null,
        // Per-unit MP remaining (f32 at unit header +4; all variant-A units).
        // Current MP only — the save has no per-type max, so it's labelled as
        // "MP remaining" in the map tooltip, never a definitive moved flag.
        movementPoints: typeof u.movementPoints === "number" ? u.movementPoints : null,
      })),
      // Passengers: family members / other characters stacked in this army.
      passengers: passengers.map(p => ({
        firstName: p.firstName,
        lastName: p.lastName || null,
        age: p.age,
        gender: p.gender,
        traitCount: p.traitCount,
      })),
      worldObjectUuid: leader.worldObjectUuid || null,
      commanderUuid: leader.commanderUuid || null,
      primaryUuid: leader.primaryUuid || null,
    });
  }

  // Anonymous-fleet synthesis. Naval units in the save have commanderUuid=0
  // (RTW stores fleets without binding them to a character via the unit
  // record's commander field). They never enter unitsByCommander, so the
  // main loop above skips them and they never become navy-class liveArmies.
  // Now that unitParser exposes each naval unit's fleetUuid (read from 22
  // bytes before nameLen — verified against save_rome10), group naval
  // units by fleetUuid (with file-order inheritance for multi-ship fleets
  // whose later ships don't repeat the army header) and synthesize one
  // navy entry per fleet, positioned via the matching type-4 world-object
  // position record.
  {
    const navalUnits = units.filter(u => /^naval\b/i.test(u.name || "")).sort((a, b) => a.offset - b.offset);
    // File-order inheritance: each ship's fleetUuid carries forward to the
    // next ship in the same fleet. Only ACCEPT a fleetUuid when it has a
    // matching type-4 position record — the parser reads (i-20) which is
    // garbage for second-ship records (the first ship has the army header,
    // subsequent ships in the same fleet don't), so we'd otherwise reset
    // lastFleet to garbage on the second ship.
    let lastFleet = null;
    const fleetGroups = new Map(); // fleetUuid → [units]
    for (const u of navalUnits) {
      if (u.fleetUuid && positions.has(u.fleetUuid)) lastFleet = u.fleetUuid;
      if (!lastFleet) continue;
      if (!fleetGroups.has(lastFleet)) fleetGroups.set(lastFleet, []);
      fleetGroups.get(lastFleet).push(u);
    }
    for (const [fleetUuid, fleetUnits] of fleetGroups) {
      const pos = positions.get(fleetUuid);
      if (!pos) continue; // no type-4 record, skip
      const bodyguard = fleetUnits[0];
      const factionFromMarker = bodyguard?.offset != null ? factionAtOffset(bodyguard.offset) : null;
      const factionLabel = factionFromMarker
        ? `${factionFromMarker.replace(/_/g, " ")} fleet`
        : "Fleet";
      // Aggregate passenger UUID-prefixes from every ship in this fleet
      // (session 37: each ship records its own boarded passengers in the
      // 12-byte gap before its name string).
      const passengerUuidsSet = new Set();
      for (const u of fleetUnits) {
        if (!Array.isArray(u.passengerUuids)) continue;
        for (const pu of u.passengerUuids) {
          if (pu) passengerUuidsSet.add(pu);
        }
      }
      const passengerUuids = Array.from(passengerUuidsSet);
      liveArmies.push({
        faction: factionFromMarker || "unknown",
        character: factionLabel,
        firstName: factionLabel,
        lastName: null,
        originalLastName: null,
        role: "admiral",
        age: null,
        birthYear: null,
        gender: null,
        traits: [],
        x: pos.x,
        y: pos.y,
        armyClass: "navy",
        units: fleetUnits.map(u => ({
          name: u.name,
          soldiers: u.soldiers,
          maxSoldiers: u.maxSoldiers,
          region: u.region || null,
          exp: 0,
        })),
        passengers: [],
        passengerUuids,
        worldObjectUuid: fleetUuid,
        commanderUuid: fleetUuid,
        primaryUuid: null,
      });
    }
  }

  // Diagnostic for the navy regression. Counts at each pipeline stage —
  // surfaced both to the main-process console (terminal launches) AND
  // attached to the returned save data so the renderer can log it to F12
  // devtools, which is what an installed-from-exe user actually sees.
  const navyDiag = (() => {
    const navalUnits = units.filter(u => /^naval\b/i.test(u.name || ""));
    const navalUnitsWithCmd = navalUnits.filter(u => u.commanderUuid);
    const allShipNames = units.filter(u => /(naval|trireme|bireme|liburn|warship|quinquer|fleet)/i.test(u.name || ""));
    const navyArmies = liveArmies.filter(a => a.armyClass === "navy");
    const sampleShipNames = [...new Set(allShipNames.map(u => u.name))].slice(0, 8);
    const navalNoCmdSample = navalUnits.filter(u => !u.commanderUuid).slice(0, 5).map(u => ({ name: u.name, region: u.region }));
    const out = {
      totalUnits: units.length,
      navalPrefix: navalUnits.length,
      navalPrefixWithCmd: navalUnitsWithCmd.length,
      shipKeywordNames: allShipNames.length,
      liveArmiesTotal: liveArmies.length,
      liveArmiesNavy: navyArmies.length,
      sampleShipNames,
      navalNoCmdSample,
    };
    console.log("[navy-diag]", out);
    return out;
  })();

  // 2026-05-26: entity-budget health counts. The engine's ~65,536 (2^16)
  // pointer registry is shared between live characters and dead-pool dynasty
  // records; long campaigns bloat the dead pool steadily (~8.6/turn) and
  // crash when the cap is approached. Surfacing these in the UI lets the
  // user see where any save sits in that budget.
  //   - aliveCount      = engine CHARACTER records minus the in-place dead
  //                       still in the active block (the signature catches
  //                       both; in-place dead are reported separately).
  //   - deadCount       = per-faction dynasty-pool records (the bloat source).
  //   - inPlaceDeadCount= chars flagged isDead by the v1 parser this turn.
  // Cost: ~50ms (dead scan) + ~350ms (engine walk) on a 70 MB save. Run only
  // at snapshot time — the values flow into renderer state and the UI reads
  // them from there.
  let aliveCount = null, deadCount = null, inPlaceDeadCount = null;
  try {
    inPlaceDeadCount = (characters || []).filter(c => c.isDead).length;
    const engineChars = countEngineCharacters(saveBuf);
    aliveCount = engineChars - inPlaceDeadCount;
    deadCount = countDeadPoolRecords(saveBuf);
    console.log(`[entity-budget] alive=${aliveCount} dead-pool=${deadCount} in-place-dead=${inPlaceDeadCount} engine-chars=${engineChars}`);
  } catch (err) {
    console.warn("[entity-budget] count failed:", err && err.message);
  }

  return {
    characters,
    units,
    charactersByRegion,
    unitsByRegion,
    navyDiag,
    scriptedCharacters: charsV2,
    scriptedByFaction: v2ByFaction,
    liveArmies,
    currentYear,
    currentTurn: readTurnFromSave(saveBuf),
    aliveCount,
    deadCount,
    inPlaceDeadCount,
  };
}

// Parse built buildings per settlement (city name). Uses the inverted block
// model confirmed by the user's mic_1 demolish experiment on 2026-04-20: chain
// records BEFORE a settlement's UTF-16 name belong to THAT settlement.
// Filters to known building chains (loaded from export_descr_buildings.txt)
// to avoid picking up world-event records like volcano/earthquake.
// Separates "built" (full records, 300+ bytes) from "queued" (tiny records,
// ~80 bytes — under-construction placeholders).
// Baseline chain whitelist loaded from the bundled building_levels.json.
// Used as a fallback when modBuildingChains is empty (mod data not loaded yet
// or user pointed to a folder without export_descr_buildings.txt). Without
// this fallback, junk chain records like "l_settlement_besieged" leak into
// the buildings list during early app startup or after a faction switch.
let baselineBuildingChains = null;
function getBaselineBuildingChains() {
  if (baselineBuildingChains) return baselineBuildingChains;
  baselineBuildingChains = new Set();
  const candidates = [
    path.join(__dirname, "build", "building_levels.json"),
    path.join(__dirname, "public", "building_levels.json"),
    path.join(process.resourcesPath || "", "app", "build", "building_levels.json"),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const lvl = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const k of Object.keys(lvl)) baselineBuildingChains.add(k);
      break;
    } catch {}
  }
  return baselineBuildingChains;
}

function parseSettlementBuildings(saveBuf) {
  // Prefer the mod-specific EDB whitelist; fall back to the bundled baseline
  // so junk records (l_settlement_besieged, etc.) never leak into the UI.
  let whitelist = modBuildingChains;
  if (!whitelist || whitelist.size === 0) {
    whitelist = getBaselineBuildingChains();
  } else {
    // Union: bundled baseline + mod-specific. Bundled covers anything the mod
    // forgot to declare; mod adds custom chains. Both should be valid.
    const merged = new Set(whitelist);
    for (const k of getBaselineBuildingChains()) merged.add(k);
    whitelist = merged;
  }
  const { settlements } = parseSettlements(saveBuf, whitelist, modChainMaxLevels);
  const buildingsByCity = {};
  const queuedByCity = {};
  for (const s of settlements) {
    buildingsByCity[s.name] = s.buildings;
    if (s.queued && s.queued.length > 0) queuedByCity[s.name] = s.queued;
  }
  return { buildingsByCity, queuedByCity };
}

// 0.9.774: export the live-save character/unit parser for headless probes
// (scripts/probe-*). This is the parser that builds charactersByRegion for
// the renderer's LIVE-mode commander-info → portrait path — distinct from
// src/saveCracker.js's crackSave. Exporting it lets scripts assert the
// faction/culture propagation fix without spinning up the Electron GUI.
module.exports = { parseCharactersAndUnits, loadModCharacterData };

const isDev = !app.isPackaged;
// Toggle dev server usage (HMR). Set DEV_USE_SERVER=1 to load http://localhost:3000
const useDevServer = isDev && process.env.DEV_USE_SERVER === "1";
const devServerURL = process.env.DEV_SERVER_URL || "http://localhost:3000";

function applyContentSecurityPolicy() {
  // Strict CSP (no unsafe-eval). Keeps warnings away when not using HMR.
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = {
      ...details.responseHeaders,
      "Content-Security-Policy": [csp],
    };
    callback({ responseHeaders: headers });
  });
}

// 0.9.489: window-bounds persistence across app launches (and updates).
// Stored as JSON in `<userData>/window-state.json`. Saved on `close` (final
// position + maximized flag) plus on `move`/`resize` (debounced 500 ms so we
// don't thrash the disk while the user drags). Restored on the next
// `createWindow()` call — including across auto-update reinstalls because
// userData survives the installer overwrite.
const WINDOW_STATE_FILE = "window-state.json";

function readSavedWindowState() {
  try {
    const fp = path.join(app.getPath("userData"), WINDOW_STATE_FILE);
    if (!fs.existsSync(fp)) return null;
    const data = JSON.parse(fs.readFileSync(fp, "utf8"));
    // Sanity checks — reject corrupted / unreasonable values so the window
    // can't open at (-99999, -99999) or 50×50.
    const okNum = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
    if (
      okNum(data.x, -10000, 20000) &&
      okNum(data.y, -10000, 20000) &&
      okNum(data.width, 800, 20000) &&
      okNum(data.height, 600, 20000)
    ) {
      console.log("[window-state] restoring", JSON.stringify(data));
      return data;
    }
    console.warn("[window-state] saved state failed sanity check, ignoring:", JSON.stringify(data));
    return null;
  } catch (e) {
    console.warn("[window-state] read failed:", e.message);
    return null;
  }
}

function saveWindowState(win, restoreTarget) {
  if (!win || win.isDestroyed()) return;
  try {
    const maximized = win.isMaximized();
    // When maximized, capture the pre-maximize bounds via getNormalBounds so
    // un-maximizing on next launch lands the user back at the same place.
    const bounds = maximized ? win.getNormalBounds() : win.getBounds();
    // 0.9.788: the window is RESTORED with useContentSize:true (width/height =
    // the CONTENT area), but we were saving the OUTER bounds — so each relaunch
    // the window grew by the frame/title-bar height. Persist the CONTENT size
    // instead so size is stable; keep x/y as the outer window position to match
    // winOptions.x/y.
    let width = bounds.width, height = bounds.height;
    if (!maximized) {
      try { const cb = win.getContentBounds(); width = cb.width; height = cb.height; } catch {}
    }
    // 0.9.854: ROBUST anti-creep. setContentSize→getContentBounds round-trips a
    // few px on Windows, and with frequent auto-update relaunches the window
    // crept wider every time. The old `userResized` flag was fragile: once the
    // user resized in a session it stuck true, so every later relaunch then
    // persisted the DRIFTED measurement and the creep resumed. Instead: if the
    // measured size is within TOL px of the size we actually restored to
    // (restoreTarget), it's drift — persist the exact restore target. A real
    // resize moves it more than TOL and is saved verbatim. This makes drift
    // impossible regardless of event timing, while honouring deliberate resizes.
    const TOL = 8;
    if (restoreTarget && typeof restoreTarget.width === "number" && typeof restoreTarget.height === "number") {
      if (maximized) {
        // Don't let the pre-maximize size mix outer (getNormalBounds) with the
        // content-size restore — keep the last known good content size.
        width = restoreTarget.width;
        height = restoreTarget.height;
      } else if (Math.abs(width - restoreTarget.width) <= TOL && Math.abs(height - restoreTarget.height) <= TOL) {
        width = restoreTarget.width;
        height = restoreTarget.height;
      }
    }
    const state = {
      x: bounds.x, y: bounds.y, width, height,
      maximized,
      savedAt: Date.now(),
    };
    const fp = path.join(app.getPath("userData"), WINDOW_STATE_FILE);
    fs.writeFileSync(fp, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn("[window-state] write failed:", e.message);
  }
}

function createWindow() {
  // Drop Electron's default File/Edit/View/Window menu — the app's UI is
  // self-contained and doesn't need it. Done at app level (vs per-window) so
  // child windows (e.g. devtools detach) inherit. Useful shortcuts that
  // the menu provided (devtools, reload, fullscreen) still work via the
  // default accelerators in dev; release builds intentionally lose them.
  Menu.setApplicationMenu(null);

  const saved = readSavedWindowState();
  const winOptions = {
    width: saved?.width || 1920,
    height: saved?.height || 1080,
    // useContentSize: width/height refer to the renderer/content area, not
    // the outer window (which would include title bar + frame). Without it
    // the actual canvas the app sees is < 1080p on Windows.
    useContentSize: true,
    minWidth: 1280,
    minHeight: 720,
    autoHideMenuBar: true,
    // Discord-style custom title bar. On macOS keep the normal native frame
    // (titleBarStyle 'default'); on Windows/Linux hide the OS title bar and
    // draw a custom 32px strip in the renderer, while Electron still paints
    // the native min/maximize/close on the RIGHT via titleBarOverlay so window
    // controls keep working. height:32 matches the renderer's TITLEBAR_H.
    titleBarStyle: process.platform === "darwin" ? "default" : "hidden",
    ...(process.platform === "darwin"
      ? {}
      : { titleBarOverlay: { color: "#15181e", symbolColor: "#cfd6e0", height: 32 } }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox on (2026-07-15): preload.js requires only "electron"
      // (contextBridge/ipcRenderer), which the sandboxed preload shim provides.
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  };
  if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
    winOptions.x = saved.x;
    winOptions.y = saved.y;
  }
  const win = new BrowserWindow(winOptions);
  win.setMenuBarVisibility(false);
  if (saved?.maximized) win.maximize();

  // Defense-in-depth: the app never opens child windows or navigates away
  // from its own document — deny window.open and off-app navigation outright.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    const allowed = useDevServer ? url.startsWith(devServerURL) : url.startsWith("file:");
    if (!allowed) e.preventDefault();
  });

  // 0.9.865: AUTO-RECOVER from a dead renderer. When a teammate's game CTDs
  // during a live run, the save-watch thrash (workers timing out → sync
  // fallback → queued reparses) could starve/crash the renderer; its frame got
  // disposed and the window stayed WHITE forever, forcing a PC restart. Electron
  // never reloads a crashed renderer on its own, so do it here: on
  // render-process-gone, reload the window (unless the user is quitting). Guard
  // against a reload loop (a deterministic render crash) — after 3 reloads in a
  // short span, stop and leave it so we don't spin. `unresponsive` is logged but
  // NOT auto-killed (a long sync parse can look unresponsive briefly).
  let _rendererReloads = 0;
  let _reloadWindowStart = 0;
  win.webContents.on("render-process-gone", (_e, details) => {
    try { _writeLog(`[renderer-gone] reason=${details && details.reason} exitCode=${details && details.exitCode} — attempting reload`); } catch {}
    if (_appQuitting || win.isDestroyed()) return;
    const now = Date.now();
    if (now - _reloadWindowStart > 60000) { _reloadWindowStart = now; _rendererReloads = 0; }
    _rendererReloads++;
    if (_rendererReloads > 3) {
      try { _writeLog(`[renderer-gone] ${_rendererReloads} reloads in <60s — giving up auto-reload (likely a deterministic crash)`); } catch {}
      return;
    }
    // Small delay lets the crashed process fully tear down before reloading.
    setTimeout(() => { try { if (!win.isDestroyed()) win.reload(); } catch {} }, 400);
  });
  win.webContents.on("unresponsive", () => { try { _writeLog("[renderer-unresponsive] webContents reported unresponsive (likely a long sync parse) — not killing"); } catch {} });
  win.webContents.on("responsive", () => { try { _writeLog("[renderer-responsive] recovered"); } catch {} });

  // Debounced save on move/resize so we capture position changes that
  // happen while the user is dragging without thrashing the disk. close
  // also writes — that's the authoritative final state.
  let saveTimer = null;
  // 0.9.854: always pass the size we RESTORED to (saved) as the anti-creep
  // reference. saveWindowState snaps to it when the measured size is within a
  // few px (drift) and saves verbatim when the user genuinely resized past the
  // tolerance — so no fragile session flag is needed and the window can't creep.
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveWindowState(win, saved); saveTimer = null; }, 500);
  };
  win.on("move", () => scheduleSave());
  win.on("resize", () => scheduleSave());
  win.on("maximize", () => scheduleSave());
  win.on("unmaximize", () => scheduleSave());
  win.on("close", () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveWindowState(win, saved);
  });

  if (useDevServer) {
    // For CRA/Vite HMR (may need eval) — suppress security warning in dev only
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
    win.loadURL(devServerURL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Load built assets (CRA build output)
    const indexPath = path.join(__dirname, "build", "index.html");
    win.loadFile(indexPath);
  }

}

// IPC: native folder picker — deep-scans a mod root for campaign directories.
// RTW mod structure: data/world/maps/campaign/<name>/ contains per-campaign files,
// data/world/maps/base/ has fallback files, data/ has shared files like descr_sm_factions.txt.
// Returns { dir, campaigns, baseFound, sharedFound } so the renderer can show a picker.
// Sticky starting directories — each picker remembers its own last folder
// separately so that after selecting a save, the import dialog doesn't open
// in the saves directory (Electron/Windows otherwise shares state).
let lastImportDir = null;

// ── Dialog-consented read roots (2026-07-15) ──────────────────────────────
// The generic read-file / read-file-binary IPC used to read ANY path the
// renderer asked for. Audit of the renderer call sites (App.js ×3, all in the
// campaign-import flow) shows every legitimate path comes from a folder the
// user picked via the select-folder dialog — either this session, or a
// previous one (the renderer persists lastImport_*.folder in localStorage and
// re-scans it via scan-folder on launch). So: every dialog pick registers the
// folder as a consented root, persisted in userData; reads and scans outside
// consented roots are refused. One-time migration: on the first launch where
// the store file doesn't exist yet, scan-folder grandfathers the dirs it is
// asked to scan (they can only come from the app's own saved-import restore),
// then the store exists and consent becomes strict.
// Store logic lives in src/consentRoots.js (electron-free, unit-tested in
// consentRoots.test.js); this is just the app-wired singleton.
let _consentStore = null;
function consentStore() {
  if (!_consentStore) {
    const { createConsentStore } = require("./src/consentRoots.js");
    _consentStore = createConsentStore({
      storePath: path.join(app.getPath("userData"), "consented-read-roots.json"),
      fs,
    });
  }
  return _consentStore;
}
function addConsentedRoot(dir) { consentStore().add(dir); }
function isConsentedPath(p) { return consentStore().isConsented(p); }
// Scan a known folder for campaign data — same scan logic as
// select-folder but skips the dialog. Used by auto-reimport on launch.
async function scanFolderForCampaigns(dir) {
  const campaignFiles = ["descr_regions.txt", "descr_strat.txt", "descr_win_conditions.txt", "map_regions.tga"];
  const sharedFiles = ["descr_sm_factions.txt"];
  const allNeeded = [...campaignFiles, ...sharedFiles];
  const dirFiles = new Map();
  const addHit = (dirPath, fileName, filePath) => {
    if (!dirFiles.has(dirPath)) dirFiles.set(dirPath, {});
    dirFiles.get(dirPath)[fileName] = filePath;
  };
  const scan = (dirPath, depth) => {
    if (depth > 7) return;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          for (const n of allNeeded) {
            if (lower === n.toLowerCase()) addHit(dirPath, n, path.join(dirPath, entry.name));
          }
        } else if (entry.isDirectory()) {
          scan(path.join(dirPath, entry.name), depth + 1);
        }
      }
    } catch {}
  };
  scan(dir, 0);
  const campaigns = [];
  let baseFound = {};
  const sharedFound = {};
  for (const [dirPath, files] of dirFiles) {
    const dirName = path.basename(dirPath).toLowerCase();
    if (dirName === "base" && campaignFiles.some(f => files[f])) {
      baseFound = { ...files };
    } else if (files["descr_strat.txt"]) {
      campaigns.push({ name: path.basename(dirPath), dir: dirPath, found: { ...files } });
    }
    for (const sf of sharedFiles) {
      if (files[sf] && !sharedFound[sf]) sharedFound[sf] = files[sf];
    }
  }
  // Merge base files into each campaign (base provides shared descr_regions etc.)
  for (const camp of campaigns) {
    for (const [k, v] of Object.entries(baseFound)) {
      if (!camp.found[k]) camp.found[k] = v;
    }
  }
  return { dir, campaigns, sharedFound };
}

// Scan a known path (no dialog) — used by auto-reimport on launch.
ipcMain.handle("scan-folder", async (_evt, dir) => {
  if (!dir || !fs.existsSync(dir)) return null;
  // allowScan: strict consent check, with a one-time grandfather on the first
  // launch where no store exists (the only callers then are the app's own
  // saved-import restore paths). See src/consentRoots.js + its tests.
  if (!consentStore().allowScan(dir)) {
    console.warn("[consent] scan-folder refused for non-consented dir:", dir);
    return null;
  }
  return await scanFolderForCampaigns(dir);
});

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select mod folder or campaign folder",
    defaultPath: lastImportDir || undefined,
  });
  if (result.canceled || !result.filePaths.length) return null;
  const dir = result.filePaths[0];
  lastImportDir = dir;
  addConsentedRoot(dir); // user picked it — read-file may now read inside it

  const campaignFiles = ["descr_regions.txt", "descr_strat.txt", "descr_win_conditions.txt", "map_regions.tga"];
  const sharedFiles = ["descr_sm_factions.txt"];
  const allNeeded = [...campaignFiles, ...sharedFiles];

  // Collect files per directory
  const dirFiles = new Map(); // dirPath → { fileName: fullPath }
  const addHit = (dirPath, fileName, filePath) => {
    if (!dirFiles.has(dirPath)) dirFiles.set(dirPath, {});
    dirFiles.get(dirPath)[fileName] = filePath;
  };

  const scan = (dirPath, depth) => {
    if (depth > 7) return;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          for (const n of allNeeded) {
            if (lower === n.toLowerCase()) {
              addHit(dirPath, n, path.join(dirPath, entry.name));
            }
          }
        } else if (entry.isDirectory()) {
          scan(path.join(dirPath, entry.name), depth + 1);
        }
      }
    } catch {}
  };
  scan(dir, 0);

  // Identify campaign dirs: must have descr_strat.txt (the defining campaign file)
  const campaigns = [];
  // Identify base dir: named "base" with descr_regions.txt or map_regions.tga
  let baseFound = {};
  // Shared files found anywhere (closest to root wins)
  const sharedFound = {};

  for (const [dirPath, files] of dirFiles) {
    const dirName = path.basename(dirPath).toLowerCase();
    if (dirName === "base" && campaignFiles.some(f => files[f])) {
      baseFound = { ...files };
    } else if (files["descr_strat.txt"]) {
      campaigns.push({ name: path.basename(dirPath), dir: dirPath, found: { ...files } });
    }
    // Collect shared files — prefer shallowest occurrence
    for (const sf of sharedFiles) {
      if (files[sf] && !sharedFound[sf]) {
        sharedFound[sf] = files[sf];
      }
    }
  }

  // Deduplicate campaigns with the same folder name — keep the one with the most files
  const campaignsByName = new Map();
  for (const c of campaigns) {
    const key = c.name.toLowerCase();
    const existing = campaignsByName.get(key);
    if (!existing || Object.keys(c.found).length > Object.keys(existing.found).length) {
      campaignsByName.set(key, c);
    }
  }
  const dedupedCampaigns = [...campaignsByName.values()];

  // For each campaign, fill in missing files from base/ (RTW inheritance)
  for (const c of dedupedCampaigns) {
    for (const f of campaignFiles) {
      if (!c.found[f] && baseFound[f]) c.found[f] = baseFound[f];
    }
    // Attach shared files
    for (const sf of sharedFiles) {
      if (!c.found[sf] && sharedFound[sf]) {
        c.found[sf] = sharedFound[sf];
      }
    }
  }

  return { dir, campaigns: dedupedCampaigns, baseFound, sharedFound };
});

// IPC: find faction icons directory in a mod folder (searches recursively if needed)
ipcMain.handle("find-faction-icons-dir", async (_event, modDir) => {
  if (!modDir || !fs.existsSync(modDir)) return null;
  // Direct paths
  for (const p of [
    path.join(modDir, "data", "ui", "faction_icons"),
    path.join(modDir, "ui", "faction_icons"),
  ]) {
    if (fs.existsSync(p)) return p;
  }
  // Search one level of subdirectories (for when modDir is the Mods root)
  try {
    for (const entry of fs.readdirSync(modDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const sub of ["data/ui/faction_icons", "ui/faction_icons"]) {
        const p = path.join(modDir, entry.name, sub);
        if (fs.existsSync(p)) return p;
      }
    }
  } catch {}
  return null;
});

// IPC: read a faction icon TGA file and return as ArrayBuffer.
// Narrowed (2026-07-15): only existing *.tga files. Faction icons legitimately
// live across many trees (every imported mod + the auto-detected vanilla
// install), so this isn't consent-gated like read-file; the extension guard
// still stops it being a general "read any file's raw bytes" exfil primitive.
ipcMain.handle("read-faction-icon", async (_event, filePath) => {
  try {
    if (!filePath || !/\.tga$/i.test(String(filePath))) return null;
    if (!fs.statSync(filePath).isFile()) return null;
    const buf = fs.readFileSync(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch { return null; }
});

// IPC: the vanilla RTW:R faction_icons directory, read live from the detected
// game install (so vanilla art is NOT bundled into the app). null if the
// install can't be located. The renderer uses it as the icons source for the
// bundled vanilla Slot 1.
ipcMain.handle("get-vanilla-icons-dir", async () => {
  try {
    const dd = getVanillaDataDir();
    if (!dd) return null;
    const iconsDir = path.join(dd, "ui", "faction_icons");
    return fs.existsSync(iconsDir) ? iconsDir : null;
  } catch { return null; }
});

// IPC: the vanilla imperial-campaign descr_strat.txt text, read live from the
// install — so the playable-nations editor shows VANILLA factions on Slot 1.
ipcMain.handle("read-vanilla-strat", async () => {
  try {
    const dd = getVanillaDataDir();
    if (!dd) return null;
    const p = path.join(dd, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
    return fs.existsSync(p) ? fs.readFileSync(p, "latin1") : null;
  } catch { return null; }
});

// IPC: vanilla descr_sm_factions.txt text — gives the bundled vanilla Slot 1 its
// real faction COLOURS (and names), instead of the mod's shared copy.
ipcMain.handle("read-vanilla-sm-factions", async () => {
  try {
    const dd = getVanillaDataDir();
    if (!dd) return null;
    const p = path.join(dd, "descr_sm_factions.txt");
    return fs.existsSync(p) ? fs.readFileSync(p, "latin1") : null;
  } catch { return null; }
});

// IPC: vanilla faction display names ({THRACE} Thrace, …) read from ONLY the
// vanilla text/expanded*.txt — NOT merged with BI/Alexander, whose overrides
// shift the names (Thrace→Dacia etc.) on the vanilla Slot 1.
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

// IPC: resolve a building-chain icon for the currently-loaded mod.
// Given a culture (e.g., "greek", "roman") and a level name (e.g., "odeon",
// "stone_wall"), searches the mod's data/ui/<culture>/buildings/ folder for
// a matching TGA. Falls back to the vanilla RTW:R install and the Alexander
// install when the mod doesn't include the icon.
// Returns { buffer: ArrayBuffer, path: string, mime: "image/x-tga" } or null.
// Locate the RTW:R install root. Tries common Steam install paths first,
// then falls back to the Steam library config to resolve non-default
// library locations (users with Steam on a secondary drive).
// Locate the RTW:R install ROOT (the folder — or Mac .app bundle — that
// contains `Contents/Resources/Data/data`). Auto-detects across:
//   • Windows Steam: common drive letters, the Steam path from the registry,
//     and every library in libraryfolders.vdf (Steam on a secondary drive).
//   • Windows Epic Games.
//   • macOS (Feral): /Applications and ~/Applications.
// Returns a path consumed as `${root}/Contents/Resources/Data/...`, so the
// Mac entry is the .app bundle itself (NOT .../Contents/Resources/Data).
function findRtwInstallRoot() {
  const REL = "Total War ROME REMASTERED";
  // Steam install/library dirs to probe for /steamapps/common/<REL>.
  const steamDirs = [];
  for (const drive of ["C:", "D:", "E:", "F:", "G:", "H:"]) {
    steamDirs.push(`${drive}/Program Files (x86)/Steam`, `${drive}/Program Files/Steam`, `${drive}/Steam`, `${drive}/SteamLibrary`);
  }
  // Steam install dir straight from the Windows registry (catches custom dirs).
  try {
    if (process.platform === "win32") {
      const { execSync } = require("child_process");
      const out = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
      if (m) steamDirs.unshift(m[1].trim().replace(/\\/g, "/"));
    }
  } catch {}
  // Expand each Steam dir's libraryfolders.vdf into extra library roots.
  for (const sdir of [...steamDirs]) {
    const vdfPath = `${sdir}/steamapps/libraryfolders.vdf`;
    try {
      if (!fs.existsSync(vdfPath)) continue;
      const text = fs.readFileSync(vdfPath, "utf8");
      const re = /"path"\s+"([^"]+)"/g;
      let m;
      while ((m = re.exec(text)) !== null) steamDirs.push(m[1].replace(/\\\\/g, "/").replace(/\\/g, "/"));
    } catch {}
  }
  const candidates = [];
  for (const s of steamDirs) candidates.push(`${s}/steamapps/common/${REL}`);
  // Epic Games (Windows).
  for (const drive of ["C:", "D:", "E:"]) {
    candidates.push(`${drive}/Program Files/Epic Games/TotalWarRomeRemastered`);
    candidates.push(`${drive}/Program Files/Epic Games/${REL}`);
  }
  // macOS (Feral) — the .app bundle is the root.
  candidates.push(`/Applications/${REL}.app`);
  if (process.env.HOME) candidates.push(`${process.env.HOME}/Applications/${REL}.app`);
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch {}
  }
  return null;
}

// Cached vanilla RTW:R `…/data` dir (the one containing `ui/`), derived from
// the detected install root. null when no install is found. Logged once so
// provincia.log shows whether the auto-detect succeeded — when portraits/icons
// fail to resolve, this line tells you if it's the vanilla fallback that's
// missing. See [resolve-portrait] NO PORTRAIT diagnostics.
let _vanillaDataDir; // undefined = not computed yet
function getVanillaDataDir() {
  if (_vanillaDataDir !== undefined) return _vanillaDataDir;
  _vanillaDataDir = null;
  try {
    const root = findRtwInstallRoot();
    if (root) {
      const dd = path.join(root, "Contents", "Resources", "Data", "data");
      if (fs.existsSync(dd)) _vanillaDataDir = dd;
    }
  } catch {}
  try { console.log(`[rtw-detect] vanilla RTW:R data dir: ${_vanillaDataDir || "(not found — auto-detect failed; portrait/icon vanilla fallback unavailable)"}`); } catch {}
  return _vanillaDataDir;
}

const ICON_SEARCH_ROOTS = [];
function getIconSearchRoots() {
  if (ICON_SEARCH_ROOTS.length) return ICON_SEARCH_ROOTS;
  const root = findRtwInstallRoot();
  if (!root) return ICON_SEARCH_ROOTS;
  // Always include the vanilla + BI + Alexander game installs if present.
  // Load order matters for last-wins text-file merges (expanded_bi.txt,
  // export_buildings.txt): Alex must come AFTER BI so its expansion-specific
  // overrides (GAULS→Dahae, GERMANS→Illyria, PARTHIA→Persia, etc.) win.
  const base = `${root}/Contents/Resources/Data`;
  const tryAdd = (p) => { try { if (p && fs.existsSync(p)) ICON_SEARCH_ROOTS.push(p); } catch {} };
  tryAdd(`${base}/data`);
  tryAdd(`${base}/bi/data`);
  tryAdd(`${base}/alexander/data`);
  return ICON_SEARCH_ROOTS;
}

// Walk up from a mod data dir looking for "sibling" or "parent" data dirs
// that also contain the target relative file. Handles layered mods like RIS
// where a submod at `.../RIS/_submods/RIS_Classic/data` extends the main mod
// at `.../RIS/RIS/data` — both must be read for display names to resolve.
// Returns an ordered list: innermost/submod first, then parents.
function findRelatedModDirs(modDataDir, relPath) {
  if (!modDataDir) return [];
  const found = new Set();
  const result = [];
  const norm = modDataDir.replace(/\\/g, "/");
  // Add the user-specified dir itself first.
  if (fs.existsSync(path.join(modDataDir, relPath))) {
    result.push(modDataDir);
    found.add(path.resolve(modDataDir));
  }
  // Walk up to 5 levels and scan siblings for `*/data/<relPath>`.
  let cur = norm;
  for (let i = 0; i < 5; i++) {
    const parent = path.dirname(cur);
    if (!parent || parent === cur) break;
    try {
      for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(parent, entry.name, "data");
        const key = path.resolve(candidate);
        if (found.has(key)) continue;
        if (fs.existsSync(path.join(candidate, relPath))) {
          found.add(key);
          result.push(candidate);
        }
      }
    } catch {}
    cur = parent;
  }
  return result;
}

// Total conversions like RIS replace vanilla wholesale; merging vanilla
// EDB/EDU into the source list with last-wins-per-(chain, level) leaks
// vanilla recruits ("hoplite") whenever the mod doesn't redefine the
// exact same chain+level pair. When a mod data dir is provided AND
// contains the requested file, return ONLY the mod sources (mod dir +
// any related submods/parents). Otherwise fall back to vanilla.
function getEdbSourceFiles(modDataDir, relPath) {
  const modDirs = findRelatedModDirs(modDataDir, relPath);
  if (modDirs.length > 0) {
    return modDirs.slice().reverse().map((d) => path.join(d, relPath));
  }
  return getIconSearchRoots().map((r) => path.join(r, relPath));
}

// Parse an RTW localized text file (text/export_units.txt /
// export_buildings.txt). Format: each entry starts with `{key}content`,
// content can span multiple lines until the next `{...}` line. UTF-16LE
// with BOM is the common encoding; falls back to UTF-8.
const _textDictCache = new Map(); // filePath -> { key: text }
function readTextDictionary(filePath) {
  if (_textDictCache.has(filePath)) return _textDictCache.get(filePath);
  if (!filePath || !fs.existsSync(filePath)) {
    _textDictCache.set(filePath, {});
    return {};
  }
  try {
    const buf = fs.readFileSync(filePath);
    let text;
    if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString("utf16le", 2);
    else if (buf[0] === 0xfe && buf[1] === 0xff) text = buf.swap16().toString("utf16le", 2);
    else text = buf.toString("utf8");
    const entries = parseTextDictionary(text); // pure parser in src/mainUtils.js
    _textDictCache.set(filePath, entries);
    return entries;
  } catch (e) {
    console.warn("[textDict]", filePath, e.message);
    _textDictCache.set(filePath, {});
    return {};
  }
}

// Merge text dictionaries from mod + game text files. Mod entries win.
function getMergedTextDictionary(modDataDir, relPath) {
  const sources = getEdbSourceFiles(modDataDir, relPath);
  const merged = {};
  for (const src of sources) {
    const dict = readTextDictionary(src);
    Object.assign(merged, dict);
  }
  return merged;
}

// IPC: return long-form unit description from text/export_units.txt.
// Looks up the EDU `dictionary` key for the given unitName, then fetches
// the matching `{<dict>}`, `{<dict>_descr_short}`, `{<dict>_descr}`
// entries. Returns { displayName, short, long } or null.
ipcMain.handle("get-unit-description", async (_event, modDataDir, unitName) => {
  if (!unitName) return null;
  // 1) Find the dictionary key. Reuse the unit-ownership cache where
  //    possible — it already records the dict per type.
  let dictKey = null;
  const cached = _unitOwnershipCache.get(modDataDir || "");
  if (cached && cached.__dictionary && cached.__dictionary[unitName]) {
    dictKey = cached.__dictionary[unitName];
  } else {
    const sources = getEdbSourceFiles(modDataDir, "export_descr_unit.txt");
    for (const src of sources.slice().reverse()) {
      if (!fs.existsSync(src)) continue;
      try {
        const buf = fs.readFileSync(src);
        const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le", 2) : buf.toString("utf8");
        const escaped = unitName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`^type\\s+${escaped}\\s*$\\s*dictionary\\s+(\\S+)`, "m");
        const m = text.match(re);
        if (m) { dictKey = m[1]; break; }
      } catch {}
    }
  }
  if (!dictKey) return null;
  const dict = getMergedTextDictionary(modDataDir, "text/export_units.txt");
  const out = {
    displayName: dict[dictKey] || null,
    short: dict[dictKey + "_descr_short"] || null,
    long: dict[dictKey + "_descr"] || null,
  };
  if (!out.displayName && !out.short && !out.long) return null;
  return out;
});

// IPC: clear all parse caches (EDB / EDU / display names / cultures /
// stats / descriptions). Used by the "Reload mod data" button so a
// modder can re-edit text files and see the changes without restarting.
// IPC: return the runtime-parsed descr_strat starting characters with
// their traits / ancillaries / age / tags. The renderer uses this when
// no save is loaded so generals' traits are browsable for ANY mod
// (vanilla, RIS, Workshop downloads — not just the dev's bundled mod).
// Returns a flat array keyed by `firstName|faction`; the renderer
// buckets by region via its existing tileToRegion / regionsByPixel
// machinery to avoid duplicating that logic in main.js.
ipcMain.handle("get-starting-characters", async () => {
  if (!modDescrStratCharactersByRegion || !Array.isArray(modDescrStratCharactersByRegion.byCoord)) {
    return { ok: false, characters: [] };
  }
  return { ok: true, characters: modDescrStratCharactersByRegion.byCoord };
});

// IPC: families parsed from descr_strat (`character_record` + `relative`
// lines) — drives the Family Tree view when no live save is loaded.
// IPC: resolve a portrait TGA for a given culture + slot. Slots:
//   "wife", "son", "daughter" — family portraits at
//     data/ui/<culture>/portraits/family/<slot>.tga
//   "general" — generic general portrait at data/ui/<culture>/general_portrait.tga
// Mod dir is searched first, then vanilla. Returns { ok, buffer, path } or { ok:false }.
// Parse a mod's `descr_cultures.txt` to learn each custom culture's
// "portrait mapping" base culture (e.g. RIS's `e_hellenistic` → `greek`,
// `libyan` → `eastern`). Used as the first-choice fallback when the
// requested culture has no portrait pool of its own.
const _portraitMappingCache = new Map(); // modDataDir -> { culture: portraitBase }
function loadPortraitMapping(modDataDir) {
  if (!modDataDir) return {};
  if (_portraitMappingCache.has(modDataDir)) return _portraitMappingCache.get(modDataDir);
  const out = {};
  const culturesPath = path.join(modDataDir, "descr_cultures.txt");
  try {
    if (fs.existsSync(culturesPath)) {
      const text = fs.readFileSync(culturesPath, "utf8");
      const lines = text.split(/\r?\n/);
      let cur = null;
      for (const raw of lines) {
        const headerM = /^\t"([a-z_]+)"\s*:\s*$/.exec(raw);
        if (headerM) { cur = headerM[1].toLowerCase(); continue; }
        const mapM = /"portrait mapping"\s*:\s*"([a-z_]+)"/.exec(raw);
        if (mapM && cur) out[cur] = mapM[1].toLowerCase();
      }
    }
  } catch {}
  _portraitMappingCache.set(modDataDir, out);
  return out;
}

// Resolve the per-character general portrait POOL for a given culture + age
// bucket. Two on-disk layouts exist and we must support both, else mods that
// ship the alternate layout silently fall through to the bodyguard unit icon:
//   (A) vanilla RTW Remastered:  <culture>/portraits/portraits/<bucket>/generals/NNN.tga.dds
//   (B) RIS-style mods:          <culture>/portraits/portraits/<bucket>/NNN.tga        (no generals/ subdir, plain .tga)
// Returns { dir, files, ext } where ext is the actual extension of the pool's
// files (".tga.dds" → LZ4/DXT1 DDS decode in the renderer; ".tga" → plain TGA),
// or null when neither layout has files. Cached per (bucketDir) — the directory
// scan runs once per process. NOTE: the cache key is the BUCKET dir, not the
// generals/ subdir, because the resolver now inspects both.
const _portraitPoolCache = new Map(); // bucketDir -> { dir, files, ext } | null
function resolvePortraitPool(bucketDir) {
  if (_portraitPoolCache.has(bucketDir)) return _portraitPoolCache.get(bucketDir);
  let result = null;
  // (A) vanilla layout: <bucket>/generals/*.tga.dds
  try {
    const generalsDir = path.join(bucketDir, "generals");
    const dds = fs.readdirSync(generalsDir).filter((n) => n.toLowerCase().endsWith(".tga.dds")).sort();
    if (dds.length > 0) result = { dir: generalsDir, files: dds, ext: ".tga.dds" };
  } catch {}
  // (B) mod layout: files directly in <bucket>, .tga (preferred) or .tga.dds.
  if (!result) {
    try {
      const all = fs.readdirSync(bucketDir);
      const dds = all.filter((n) => n.toLowerCase().endsWith(".tga.dds")).sort();
      if (dds.length > 0) {
        result = { dir: bucketDir, files: dds, ext: ".tga.dds" };
      } else {
        const tga = all.filter((n) => n.toLowerCase().endsWith(".tga")).sort();
        if (tga.length > 0) result = { dir: bucketDir, files: tga, ext: ".tga" };
      }
    } catch {}
  }
  _portraitPoolCache.set(bucketDir, result);
  return result;
}

// Deterministic per-character portrait index: DJB2 hash of the character's
// firstName modulo the pool's file count. Same character always picks the
// same portrait, regardless of campaign turn or save reload.
// hashName moved to src/mainUtils.js (pure, imported at top).

// 0.9.417: trait-level data (description, effects, threshold) for the
// right-click character info panel. Renderer fetches once after mod init
// and caches the result locally.
ipcMain.handle("get-trait-data", async () => {
  // 0.9.428: detect which stats the loaded mod actually uses by checking
  // if any trait level OR ancillary has an `Effect <StatName> N` line for
  // it. RIS dropped Loyalty entirely — no trait references it — so the
  // UI should hide that column. Vanilla uses all four. The check generalises
  // to any future mod that drops or renames stats.
  const usesStat = { Command: false, Influence: false, Management: false, Loyalty: false, Subterfuge: false };
  for (const trait of Object.keys(modTraitLevels || {})) {
    for (const lvl of (modTraitLevels[trait] || [])) {
      for (const e of (lvl.effects || [])) {
        if (e.name in usesStat) usesStat[e.name] = true;
      }
    }
  }
  for (const ancName of Object.keys(modAncillaryData || {})) {
    for (const e of (modAncillaryData[ancName].effects || [])) {
      if (e.name in usesStat) usesStat[e.name] = true;
    }
  }
  console.log(`[trait-data] mod uses stats: ${Object.entries(usesStat).filter(([, v]) => v).map(([k]) => k).join(", ") || "(none)"}`);
  return {
    levels: modTraitLevels || {},
    epithets: modTraitEpithets || {},
    ancillaries: modAncillaryData || {},
    usesStat: {
      command: usesStat.Command,
      influence: usesStat.Influence,
      management: usesStat.Management,
      loyalty: usesStat.Loyalty,
      subterfuge: usesStat.Subterfuge,
    },
    // 0.9.433: which traits are flagged `Hidden` in the mod's
    // export_descr_character_traits.txt — the renderer hides them in the
    // character info panel unless devMode is on.
    hidden: modTraitHidden || {},
    // 0.9.437: engine constraints surfaced for the dev-mode picker — the
    // renderer filters the Add Trait list by character agent-type and
    // excluded cultures so users only see options the engine would accept.
    characters: modTraitCharacters || {},
    excludeCultures: modTraitExcludeCultures || {},
  };
});

// Export-instead-of-overwrite toggle. When `dir` is a writable folder, every
// subsequent mod-file write (via modOut) is redirected under it, the live mod
// is left untouched, and post-write backups + re-parses are skipped (the live
// mod didn't change). Pass null to turn export OFF and restore in-place
// overwrite (the default). Validates the folder exists + is writable.
ipcMain.handle("set-mod-export-dir", async (_event, dir) => {
  if (dir == null || dir === "") {
    _modExportDir = null;
    console.log("[mod-export] export mode OFF — writes overwrite the live mod in place");
    return { ok: true, dir: null };
  }
  // Guard against a non-string (e.g. the whole { dir, campaigns } object from
  // select-folder) reaching path.resolve — String(obj) becomes "[object Object]"
  // and resolves to a bogus path. Fail loudly so the caller fixes what it passes.
  if (typeof dir !== "string") {
    console.warn("[mod-export] set-mod-export-dir got non-string:", dir);
    return { ok: false, error: `expected a folder path string, got ${typeof dir}` };
  }
  try {
    const resolved = path.resolve(String(dir));
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return { ok: false, error: `not a folder: ${resolved}` };
    }
    // Probe writability with a throwaway file so we fail loudly up-front
    // rather than mid-Apply.
    const probe = path.join(resolved, ".provincia-export-probe");
    try { fs.writeFileSync(probe, ""); fs.unlinkSync(probe); }
    catch (we) { return { ok: false, error: `folder not writable: ${we.message}` }; }
    _modExportDir = resolved;
    console.log(`[mod-export] export mode ON — mod-file writes redirected under ${resolved}`);
    return { ok: true, dir: resolved };
  } catch (e) {
    console.warn("[mod-export] set-mod-export-dir failed:", e && e.message);
    return { ok: false, error: e.message };
  }
});

// 0.9.434: descr_strat trait editor — rewrite a character's `traits Foo
// 2, Bar 1` line. Used from the dev-mode trait editor in the right-click
// character info panel. Persistent; affects next non-live load. Does NOT
// touch live save data.
ipcMain.handle("update-character-traits", async (_event, firstName, faction, traits) => {
  if (!activeModDataDir) return { ok: false, error: "no active mod" };
  if (!firstName) return { ok: false, error: "missing firstName" };
  if (!Array.isArray(traits)) return { ok: false, error: "traits must be an array" };
  // Try imperial_campaign first, then alex / BI fallbacks (same order as
  // the loader).
  const candidates = [
    path.join(activeModDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(activeModDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(activeModDataDir, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  const dsPath = candidates.find((p) => fs.existsSync(p));
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const lines = text.split(/\r?\n/);
    // Find the `character` line for this firstName + faction. descr_strat
    // groups characters under `faction <id>,` headers, so we track the
    // current faction as we scan.
    const targetFaction = String(faction || "").toLowerCase();
    let curFaction = null;
    let charLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const fm = lines[i].match(/^faction\s+(\S+?),/);
      if (fm) { curFaction = fm[1].toLowerCase(); continue; }
      // Match `character` or `character,` then firstName as first comma-arg.
      const cm = lines[i].match(/^character[\s,]+([^,]+?),/);
      if (cm) {
        const parts = cm[1].trim().split(/\s+/);
        const fn = parts[0];
        if (fn === firstName && (!targetFaction || curFaction === targetFaction)) {
          charLineIdx = i;
          break;
        }
      }
    }
    if (charLineIdx < 0) return { ok: false, error: `character "${firstName}" (faction "${faction}") not found in ${path.basename(dsPath)}` };
    // The `traits …` line typically sits 1-2 lines below the `character`
    // header. Scan ahead until next blank / next character / next army.
    let traitsLineIdx = -1;
    for (let j = charLineIdx + 1; j < Math.min(charLineIdx + 8, lines.length); j++) {
      if (/^\s*traits\b/.test(lines[j])) { traitsLineIdx = j; break; }
      if (/^character[\s,]/.test(lines[j]) || /^army\b/.test(lines[j])) break;
    }
    // Format new traits line. Empty list → drop the existing line entirely.
    const newLine = traits.length > 0
      ? `traits ${traits.map(t => `${t.name} ${t.level}`).join(", ")}`
      : null;
    if (traitsLineIdx >= 0) {
      if (newLine == null) {
        lines.splice(traitsLineIdx, 1);
      } else {
        // Preserve the original indent.
        const indent = lines[traitsLineIdx].match(/^(\s*)/)[1] || "";
        lines[traitsLineIdx] = indent + newLine;
      }
    } else if (newLine != null) {
      // Insert traits line right after the character header.
      lines.splice(charLineIdx + 1, 0, "\t" + newLine);
    }
    // Write back. Preserve line endings as found in the file.
    const usesCRLF = true; // RTW:R game text files are ALWAYS CRLF
    const out = lines.join(usesCRLF ? "\r\n" : "\n");
    fs.writeFileSync(modOut(dsPath), out, "utf8");
    console.log(`[trait-edit] wrote ${traits.length} traits for ${firstName} (faction ${faction || "?"}) to ${path.basename(dsPath)}:${traitsLineIdx >= 0 ? traitsLineIdx + 1 : charLineIdx + 2}${_modExportDir ? " (exported)" : ""}`);
    return { ok: true, file: dsPath, line: traitsLineIdx >= 0 ? traitsLineIdx + 1 : charLineIdx + 2 };
  } catch (e) {
    console.warn(`[trait-edit] failed for ${firstName}: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// Move an existing character's spawn tile in descr_strat. Matched by its
// current (oldX,oldY) within the faction — robust against name/token quirks.
// Used by the map drag-to-move-character feature; staged + applied on Save.
ipcMain.handle("update-character-position", async (_event, faction, oldX, oldY, newX, newY) => {
  if (!activeModDataDir) return { ok: false, error: "no active mod" };
  const candidates = [
    path.join(activeModDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(activeModDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(activeModDataDir, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  const dsPath = candidates.find((p) => fs.existsSync(p));
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const lines = text.split(/\r?\n/);
    const targetFaction = String(faction || "").toLowerCase();
    let curFaction = null, hitIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const fm = lines[i].match(/^faction\s+(\S+?),/);
      if (fm) { curFaction = fm[1].toLowerCase(); continue; }
      if (/^character[\s,]/.test(lines[i])) {
        const cm = lines[i].match(/\bx\s+(-?\d+)\s*,\s*y\s+(-?\d+)/i);
        if (cm && Number(cm[1]) === Number(oldX) && Number(cm[2]) === Number(oldY) && (!targetFaction || curFaction === targetFaction)) {
          hitIdx = i; break;
        }
      }
    }
    if (hitIdx < 0) return { ok: false, error: `no character at (${oldX},${oldY}) in faction "${faction}"` };
    lines[hitIdx] = lines[hitIdx].replace(/\bx\s+-?\d+\s*,\s*y\s+-?\d+/i, `x ${newX}, y ${newY}`);
    const usesCRLF = true; // RTW:R game text files are ALWAYS CRLF
    fs.writeFileSync(modOut(dsPath), lines.join(usesCRLF ? "\r\n" : "\n"), "utf8");
    if (!_modExportDir) { try { loadModCharacterData(activeModDataDir); } catch (e) { console.warn("[char-move] post-write re-parse failed:", e && e.message); } }
    console.log(`[char-move] ${faction} character (${oldX},${oldY}) → (${newX},${newY}) in ${path.basename(dsPath)}:${hitIdx + 1}`);
    return { ok: true, file: dsPath, line: hitIdx + 1 };
  } catch (e) {
    console.warn(`[char-move] failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// Edit an existing starting general's scalar fields (age, leader/heir tag) on
// its descr_strat `character` line. Matched by firstName + faction like the
// trait/ancillary editors. Surgical string edits preserve everything else on
// the line (inline stats, coords, the rest of the name). Staged + applied on Save.
ipcMain.handle("update-character-fields", async (_event, firstName, faction, fields) => {
  if (!activeModDataDir) return { ok: false, error: "no active mod" };
  if (!firstName) return { ok: false, error: "missing firstName" };
  if (!fields || typeof fields !== "object") return { ok: false, error: "missing fields" };
  const candidates = [
    path.join(activeModDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(activeModDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(activeModDataDir, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  const dsPath = candidates.find((p) => fs.existsSync(p));
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const lines = text.split(/\r?\n/);
    const targetFaction = String(faction || "").toLowerCase();
    let curFaction = null, charLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const fm = lines[i].match(/^faction\s+(\S+?),/);
      if (fm) { curFaction = fm[1].toLowerCase(); continue; }
      const cm = lines[i].match(/^character[\s,]+([^,]+?),/);
      if (cm) {
        const fn = cm[1].trim().split(/\s+/)[0];
        if (fn === firstName && (!targetFaction || curFaction === targetFaction)) { charLineIdx = i; break; }
      }
    }
    if (charLineIdx < 0) return { ok: false, error: `character "${firstName}" (faction "${faction}") not found in ${path.basename(dsPath)}` };
    let line = lines[charLineIdx];
    const applied = [];
    if (typeof fields.age === "number" && fields.age > 0 && fields.age < 120) {
      if (/\bage\s+\d+/i.test(line)) { line = line.replace(/\bage\s+\d+/i, `age ${fields.age}`); applied.push(`age=${fields.age}`); }
    }
    if (typeof fields.tag === "string") {
      const tag = fields.tag.toLowerCase();
      // Drop any existing leader/heir token right after `named character,`…
      line = line.replace(/(\bnamed character\s*,\s*)(leader|heir)\s*,\s*/i, "$1");
      // …then re-insert the requested one (empty string = plain general).
      if (tag === "leader" || tag === "heir") {
        line = line.replace(/(\bnamed character\s*,\s*)/i, `$1${tag}, `);
      }
      applied.push(`tag=${tag || "(none)"}`);
    }
    if (!applied.length) return { ok: false, error: "no recognised fields to apply" };
    lines[charLineIdx] = line;
    const usesCRLF = true; // RTW:R game text files are ALWAYS CRLF
    fs.writeFileSync(modOut(dsPath), lines.join(usesCRLF ? "\r\n" : "\n"), "utf8");
    if (!_modExportDir) { try { loadModCharacterData(activeModDataDir); } catch (e) { console.warn("[char-fields] post-write re-parse failed:", e && e.message); } }
    console.log(`[char-fields] ${firstName} (${faction || "?"}): ${applied.join(", ")} in ${path.basename(dsPath)}:${charLineIdx + 1}`);
    return { ok: true, file: dsPath, line: charLineIdx + 1, applied };
  } catch (e) {
    console.warn(`[char-fields] failed for ${firstName}: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// Safety net for the descr_strat editors: back up the campaign text files before
// a Save writes them, and restore the most recent backup on demand. Backs up
// descr_strat.txt + names.txt + descr_names_lookup.txt + descr_win_conditions.txt
// to a single timestamped set; keeps the newest 10 sets (prunes older).
function backupTargets() {
  if (!activeModDataDir) return [];
  const ds = findActiveDescrStratPath();
  const out = [];
  if (ds) {
    out.push(ds);
    out.push(ds.replace(/descr_strat\.txt$/i, "descr_win_conditions.txt"));
  }
  out.push(path.join(activeModDataDir, "text", "names.txt"));
  out.push(path.join(activeModDataDir, "descr_names_lookup.txt"));
  return out.filter((p) => { try { return fs.existsSync(p); } catch { return false; } });
}
ipcMain.handle("backup-mod-files", async () => {
  try {
    const targets = backupTargets();
    if (!targets.length) return { ok: false, error: "no files to back up" };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const p of targets) { try { fs.copyFileSync(p, `${p}.provincia-${stamp}.bak`); } catch {} }
    // Prune: keep newest 10 backup stamps per file.
    for (const p of targets) {
      try {
        const dir = path.dirname(p), base = path.basename(p);
        const baks = fs.readdirSync(dir).filter((f) => f.startsWith(base + ".provincia-") && f.endsWith(".bak")).sort();
        while (baks.length > 10) { try { fs.unlinkSync(path.join(dir, baks.shift())); } catch {} }
      } catch {}
    }
    console.log(`[backup] mod files backed up @ ${stamp} (${targets.length} files)`);
    return { ok: true, stamp, files: targets.length };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("list-mod-backups", async () => {
  try {
    const ds = findActiveDescrStratPath();
    if (!ds) return { ok: false, backups: [] };
    const dir = path.dirname(ds), base = path.basename(ds);
    const stamps = fs.readdirSync(dir)
      .filter((f) => f.startsWith(base + ".provincia-") && f.endsWith(".bak"))
      .map((f) => f.slice((base + ".provincia-").length, -4))
      .sort().reverse();
    return { ok: true, backups: stamps };
  } catch (e) { return { ok: false, error: e.message, backups: [] }; }
});
ipcMain.handle("restore-mod-backup", async (_event, stamp) => {
  try {
    const targets = backupTargets();
    if (!targets.length) return { ok: false, error: "no active mod" };
    // Use the latest stamp if none given.
    let useStamp = stamp;
    if (!useStamp) {
      const ds = findActiveDescrStratPath();
      const dir = path.dirname(ds), base = path.basename(ds);
      const stamps = fs.readdirSync(dir).filter((f) => f.startsWith(base + ".provincia-") && f.endsWith(".bak")).map((f) => f.slice((base + ".provincia-").length, -4)).sort();
      useStamp = stamps[stamps.length - 1];
    }
    if (!useStamp) return { ok: false, error: "no backups found" };
    let restored = 0;
    for (const p of targets) {
      const bak = `${p}.provincia-${useStamp}.bak`;
      if (fs.existsSync(bak)) { try { fs.copyFileSync(bak, p); restored++; } catch {} }
    }
    try { loadModCharacterData(activeModDataDir); } catch {}
    console.log(`[backup] restored ${restored} file(s) from ${useStamp}`);
    return { ok: true, stamp: useStamp, restored };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Relocate a settlement's leaderless `garrisoned_army` out to a field tile as a
// CAPTAIN-led army. Verified vanilla-RR syntax: a captain is `character <Name>,
// general, age 20, , x N, y N` (type `general` = captain, single first name that
// must exist in names.txt) followed by `army` + regular `unit` lines (no general
// bodyguard). We remove the garrisoned_army block from the settlement and emit
// the captain army in the OWNER faction's section (the section the settlement
// sits in — NOT faction_creator). The captain name reuses an existing first name
// from that faction (guaranteed to be in names.txt).
ipcMain.handle("relocate-garrison", async (_event, faction, region, newX, newY) => {
  if (!activeModDataDir) return { ok: false, error: "no active mod" };
  if (!region) return { ok: false, error: "missing region" };
  if (typeof newX !== "number" || typeof newY !== "number") return { ok: false, error: "missing coords" };
  const candidates = [
    path.join(activeModDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(activeModDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(activeModDataDir, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  const dsPath = candidates.find((p) => fs.existsSync(p));
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const usesCRLF = true; // RTW:R game text files are ALWAYS CRLF
    const lines = text.split(/\r?\n/);
    const wantFac = String(faction || "").toLowerCase();
    // Global scan: track the enclosing faction; find the settlement by region
    // that has a garrisoned_army.
    let curFac = null, curFacLine = -1;
    let ownerFacLine = -1, gaLine = -1, unitEnd = -1, ownerFac = null;
    const units = [];
    for (let i = 0; i < lines.length; i++) {
      const fm = lines[i].match(/^faction\s+([a-z_0-9]+)/i);
      if (fm) { curFac = fm[1].toLowerCase(); curFacLine = i; continue; }
      if (/^\s*settlement\s*$/.test(lines[i])) {
        let reg = null, ga = -1, uend = -1; const us = []; let j = i + 1;
        for (; j < lines.length; j++) {
          if (/^\s*\}/.test(lines[j])) break;
          const rm = lines[j].match(/^\s*region\s+(.+?)\s*$/); if (rm) reg = rm[1].trim();
          if (/^\s*garrisoned_army\s*$/.test(lines[j])) {
            ga = j; let k = j + 1;
            while (k < lines.length && /^\s*unit\s+/.test(lines[k])) { us.push(lines[k].replace(/^\s+/, "")); k++; }
            uend = k;
          }
        }
        if (reg === region && ga >= 0 && (!wantFac || curFac === wantFac)) {
          ownerFac = curFac; ownerFacLine = curFacLine; gaLine = ga; unitEnd = uend; units.push(...us); break;
        }
        i = j;
      }
    }
    if (gaLine < 0) return { ok: false, error: `no garrisoned_army found in region "${region}"${faction ? ` (faction ${faction})` : ""}` };
    if (units.length === 0) return { ok: false, error: `garrisoned_army in "${region}" has no units` };
    // Captain name: reuse an existing first name from the owner faction's
    // characters (already present in names.txt, so guaranteed valid).
    let captain = null;
    for (let i = ownerFacLine + 1; i < lines.length; i++) {
      if (/^faction\s/.test(lines[i])) break;
      const cm = lines[i].match(/^character[\s,]+([A-Za-z][A-Za-z_]*)\b/);
      if (cm) { captain = cm[1]; break; }
    }
    if (!captain) captain = "Captain";
    // Remove the garrisoned_army header + its unit lines.
    lines.splice(gaLine, unitEnd - gaLine);
    // Insertion point in the owner faction's section: before its first character
    // (or first settlement, or section end). gaLine > ownerFacLine, so the
    // removal above doesn't shift ownerFacLine.
    let insAt = -1;
    for (let i = ownerFacLine + 1; i < lines.length; i++) {
      if (/^faction\s/.test(lines[i])) { insAt = i; break; }
      if (/^character[\s,]/.test(lines[i])) { insAt = i; break; }
      if (/^\s*settlement\s*$/.test(lines[i])) { insAt = i; break; }
    }
    if (insAt < 0) insAt = ownerFacLine + 1;
    const block = [`character\t${captain}, general, age 20, , x ${newX}, y ${newY}`, "army", ...units, ""];
    lines.splice(insAt, 0, ...block);
    fs.writeFileSync(modOut(dsPath), lines.join(usesCRLF ? "\r\n" : "\n"), "utf8");
    if (!_modExportDir) { try { loadModCharacterData(activeModDataDir); } catch (e) { console.warn("[garrison-relocate] post-write re-parse failed:", e && e.message); } }
    console.log(`[garrison-relocate] ${ownerFac} ${region}: ${units.length} units → captain "${captain}" at (${newX},${newY}) in ${path.basename(dsPath)}`);
    return { ok: true, captain, units: units.length, faction: ownerFac };
  } catch (e) {
    console.warn(`[garrison-relocate] failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// Rename an existing starting character's FIRST name (the family/surname is
// kept). The name appears in descr_strat as a token on the `character` line AND
// in any `relative` line that references the character, so we replace the full
// "<First> <Family>" string everywhere within the character's faction section.
// The new first name must resolve in names.txt — if its token is missing we mint
// `{NewFirst}NewFirst` (sorted insert) + add it to descr_names_lookup, mirroring
// the Add-General writer. Refuses a rename that would duplicate an existing
// "<New> <Family>" in the faction (the engine dislikes identical full names).
ipcMain.handle("rename-character", async (_event, faction, oldFirst, newFirstRaw) => {
  if (!activeModDataDir) return { ok: false, error: "no active mod" };
  if (!oldFirst || !newFirstRaw) return { ok: false, error: "missing name" };
  const newFirst = String(newFirstRaw).trim().replace(/[^A-Za-z0-9_'-]/g, "");
  if (!newFirst) return { ok: false, error: "invalid new name" };
  const dsPath = findActiveDescrStratPath();
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const eol = "\r\n"; // RTW:R game text files are ALWAYS CRLF
    const lines = text.split(/\r?\n/);
    const wantFac = String(faction || "").toLowerCase();
    // Locate the character's faction section.
    let secStart = -1, secEnd = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const fm = lines[i].match(/^faction\s+([a-z_0-9]+)/i);
      if (fm) { if (fm[1].toLowerCase() === wantFac) secStart = i; else if (secStart >= 0) { secEnd = i; break; } }
    }
    if (secStart < 0) return { ok: false, error: `faction "${faction}" not found` };
    // Find the character line + parse its family (surname) token.
    let charIdx = -1, family = null;
    for (let i = secStart; i < secEnd; i++) {
      const cm = lines[i].match(/^character[\s,]+([^,]+),/);
      if (cm) { const parts = cm[1].trim().split(/\s+/); if (parts[0] === oldFirst) { charIdx = i; family = parts.slice(1).join(" ") || null; break; } }
    }
    if (charIdx < 0) return { ok: false, error: `character "${oldFirst}" not found in ${faction}` };
    const oldFull = family ? `${oldFirst} ${family}` : oldFirst;
    const newFull = family ? `${newFirst} ${family}` : newFirst;
    if (oldFull === newFull) return { ok: false, error: "name unchanged" };
    // Reject duplicates: a different character/relative already named newFull.
    for (let i = secStart; i < secEnd; i++) {
      if (i === charIdx) continue;
      const t = lines[i].trim();
      if (/^(character|character_record|relative)\b/.test(t) && t.includes(newFull)) {
        return { ok: false, error: `"${newFull}" already exists in ${faction} — pick a different name` };
      }
    }
    // Replace the full name string everywhere in the section.
    let count = 0;
    for (let i = secStart; i < secEnd; i++) {
      if (lines[i].includes(oldFull)) { lines[i] = lines[i].split(oldFull).join(newFull); count++; }
    }
    // Ensure the new first name is a known names.txt token; mint if missing.
    let minted = false;
    const namesPath = path.join(activeModDataDir, "text", "names.txt");
    const lookupPath = path.join(activeModDataDir, "descr_names_lookup.txt");
    try {
      if (fs.existsSync(namesPath)) {
        const names = descrGen.parseNamesTxt(fs.readFileSync(namesPath, "utf16le"));
        if (!names.tokenToDisplay.has(newFirst)) {
          const nt = fs.readFileSync(namesPath, "utf16le");
          const ntEol = "\r\n"; // RTW:R names.txt (UTF-16LE) is CRLF
          const ntLines = nt.split(/\r?\n/);
          const tokenOf = (l) => { const m = l.match(/^﻿?\{([^}]*)\}/); return m ? m[1].toLowerCase() : null; };
          const tokLc = newFirst.toLowerCase();
          const entry = `{${newFirst}}${newFirst}`;
          let idx = ntLines.findIndex((l) => { const k = tokenOf(l); return k != null && k > tokLc; });
          if (idx < 0) { while (ntLines.length && ntLines[ntLines.length - 1].trim() === "") ntLines.pop(); ntLines.push(entry); }
          else ntLines.splice(idx, 0, entry);
          fs.writeFileSync(modOut(namesPath), ntLines.join(ntEol), "utf16le");
          minted = true;
          if (fs.existsSync(lookupPath)) {
            const lk = fs.readFileSync(lookupPath, "utf8");
            const lkEol = "\r\n"; // RTW:R always CRLF
            const lkLines = lk.split(/\r?\n/);
            if (!lkLines.some((l) => l.trim().toLowerCase() === tokLc)) {
              let li = lkLines.findIndex((l) => l.trim() && l.trim().toLowerCase() > tokLc);
              if (li < 0) { while (lkLines.length && lkLines[lkLines.length - 1].trim() === "") lkLines.pop(); lkLines.push(newFirst); }
              else lkLines.splice(li, 0, newFirst);
              fs.writeFileSync(modOut(lookupPath), lkLines.join(lkEol), "utf8");
            }
          }
        }
      }
    } catch (ne) { console.warn("[char-rename] names.txt update failed:", ne && ne.message); }
    fs.writeFileSync(modOut(dsPath), lines.join(eol), "utf8");
    if (!_modExportDir) { try { loadModCharacterData(activeModDataDir); } catch (e) { console.warn("[char-rename] re-parse failed:", e && e.message); } }
    console.log(`[char-rename] ${faction}: "${oldFull}" → "${newFull}" (${count} line(s)${minted ? ", minted name token" : ""})`);
    return { ok: true, count, minted, newFull };
  } catch (e) {
    console.warn(`[char-rename] failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// Replace the unit list of a starting army block in descr_strat. The army is
// located either by a character's coords (x,y — a general/captain `army` block)
// or by a settlement region (a `garrisoned_army` block). `units` is the FULL new
// list [{name, exp, armour, weapon}] — the caller keeps the bodyguard as unit 0
// for named generals. Unit-line indentation is copied from the block so the file
// style is preserved. Staged + applied on Save.
ipcMain.handle("update-army-units", async (_event, faction, locator, units) => {
  if (!activeModDataDir) return { ok: false, error: "no active mod" };
  if (!Array.isArray(units)) return { ok: false, error: "units must be an array" };
  const dsPath = findActiveDescrStratPath();
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const eol = "\r\n"; // RTW:R game text files are ALWAYS CRLF
    const lines = text.split(/\r?\n/);
    const byRegion = locator && locator.region != null;
    const byCoord = locator && typeof locator.x === "number" && typeof locator.y === "number";
    const byCharacter = locator && typeof locator.character === "string" && locator.character.length > 0;
    if (!byRegion && !byCoord && !byCharacter) return { ok: false, error: "locator needs region, x/y, or character" };
    const wantFac = String(faction || "").toLowerCase();
    let unitStart = -1, unitEnd = -1, indent = "\t";
    // 0.9.652: diagnostic logs for the "garrison block not found" class.
    // Surface faction, locator, units count, dsPath; then for each lookup
    // path (character/coord/region) log whether it matched and at what
    // line. Logs land in %AppData%\Roaming\Provincia\provincia.log.
    console.log(`[army-units] IPC start: faction="${faction}" locator=${JSON.stringify(locator)} units=${units.length} dsPath="${dsPath}"`);
    console.log(`[army-units] flags: byRegion=${byRegion} byCoord=${byCoord} byCharacter=${byCharacter} wantFac="${wantFac}"`);
    // 0.9.651: when locator.character is set (a named bodyguard commander
    // — e.g. Appius), find the character record in the faction's block,
    // then its `army { }` unit lines. Runs BEFORE the region-mode lookup
    // so a "garrison" whose units actually live inside a character army
    // (very common — provincial capitals + every named general) resolves
    // correctly. The region-mode `garrisoned_army` lookup below is the
    // fallback for the leaderless garrison case.
    if (byCharacter) {
      let curFac = null;
      const wantChar = String(locator.character).trim();
      const wantHasSpace = /\s/.test(wantChar);  // full name vs first-name-only
      // 0.9.661: descr_strat uses underscores inside compound family names
      // (e.g. `Fulvius_Flaccus`), while the renderer hands us the display
      // form `"Fulvius Flaccus"`. Compare with underscores-as-spaces both
      // sides so the exact-match disambiguator actually matches.
      const norm = (s) => String(s).toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
      const wantNorm = norm(wantChar);
      let charHeadersInWantFac = 0;
      let charFirstNamesSampled = [];
      // 0.9.659: collect all matches in pass 1 so we can detect ambiguity
      // (RIS has 2 Servius / 3 Manius / etc. in romans_julii alone — a
      // first-name-only match used to silently pick the WRONG character's
      // army, writing the edit to a no-op and returning ok:true). When the
      // locator carries a full "First Last" name we can disambiguate via
      // exact full-name match.
      const matches = [];
      for (let i = 0; i < lines.length; i++) {
        const fm = lines[i].match(/^faction\s+([a-z_0-9]+)/i);
        if (fm) { curFac = fm[1].toLowerCase(); continue; }
        if (wantFac && curFac !== wantFac) continue;
        // descr_strat character header:
        //   regular:     `character\tFirstName Family, named character, ...`
        //   sub_faction: `character\tsub_faction athens,\tEumedes, named character, ...`
        // The sub_faction prefix is optional; the name we want is the first
        // non-`sub_faction` comma-separated field before `named character`.
        const cm = lines[i].match(/^character\s*,?\s*(?:sub_faction\s+\S+\s*,\s*)?([^,]+?)\s*,\s*named character/i);
        if (!cm) continue;
        charHeadersInWantFac++;
        const fullName = cm[1].trim();
        const firstName = fullName.split(/\s+/)[0];
        if (charFirstNamesSampled.length < 12) charFirstNamesSampled.push(firstName);
        const hit = wantHasSpace
          ? norm(fullName) === wantNorm
          : firstName === wantChar;
        if (hit) matches.push({ line: i, fullName, firstName });
      }
      if (matches.length > 1) {
        console.warn(`[army-units] byCharacter AMBIGUOUS: ${matches.length} matches for "${wantChar}" in faction "${wantFac}" — ${matches.map((m) => m.fullName).join(", ")}. Falling through to byCoord / ;Region path so the right army is found.`);
      } else if (matches.length === 1) {
        const i = matches[0].line;
        console.log(`[army-units] character match: line=${i + 1} fullName="${matches[0].fullName}" wantChar="${wantChar}" wantFac="${wantFac}"`);
        // Walk forward to this character's `army` block.
        for (let j = i + 1; j < lines.length && j < i + 40; j++) {
          if (/^character[\s,]/.test(lines[j])) { console.log(`[army-units] hit next character at line ${j + 1}, stopping forward walk`); break; }
          if (/^faction\s+/.test(lines[j])) { console.log(`[army-units] hit next faction at line ${j + 1}, stopping forward walk`); break; }
          if (/^\s*army\b/.test(lines[j])) {
            console.log(`[army-units] found army block at line ${j + 1}`);
            let k = j + 1;
            while (k < lines.length && /^\s*unit\s+/.test(lines[k])) {
              if (unitStart < 0) { unitStart = k; indent = (lines[k].match(/^(\s*)/) || ["", "\t"])[1]; }
              k++;
            }
            unitEnd = k;
            console.log(`[army-units] unit lines: ${unitStart + 1}..${unitEnd} (${unitEnd - unitStart} unit lines)`);
            break;
          }
        }
      }
      if (unitStart < 0 && matches.length === 0) {
        console.warn(`[army-units] byCharacter MISS with faction filter: wantChar="${wantChar}" wantFac="${wantFac}" — found ${charHeadersInWantFac} character headers in that faction. First names sampled: ${JSON.stringify(charFirstNamesSampled)}`);
        // 0.9.653: faction filter sometimes points at the wrong block (e.g.
        // the renderer passes the descr_regions REBEL faction `italics` when
        // a settlement is actually Roman). Retry the same character lookup
        // with NO faction constraint. 0.9.659: collect all matches first so
        // we can fall through on ambiguity instead of writing to the first
        // one we hit.
        let curFac2 = null;
        const matchesAny = [];
        for (let i = 0; i < lines.length; i++) {
          const fm = lines[i].match(/^faction\s+([a-z_0-9]+)/i);
          if (fm) { curFac2 = fm[1].toLowerCase(); continue; }
          const cm = lines[i].match(/^character\s*,?\s*(?:sub_faction\s+\S+\s*,\s*)?([^,]+?)\s*,\s*named character/i);
          if (!cm) continue;
          const fullName = cm[1].trim();
          const firstName = fullName.split(/\s+/)[0];
          const hit = wantHasSpace
            ? norm(fullName) === wantNorm
            : firstName === wantChar;
          if (hit) matchesAny.push({ line: i, fullName, faction: curFac2 });
        }
        if (matchesAny.length > 1) {
          console.warn(`[army-units] no-faction retry AMBIGUOUS: ${matchesAny.length} matches for "${wantChar}" — ${matchesAny.map((m) => `${m.fullName}(${m.faction})`).join(", ")}. Falling through.`);
        } else if (matchesAny.length === 1) {
          const i = matchesAny[0].line;
          console.log(`[army-units] character match (no-faction retry): line=${i + 1} actualFaction="${matchesAny[0].faction}" fullName="${matchesAny[0].fullName}"`);
          for (let j = i + 1; j < lines.length && j < i + 40; j++) {
            if (/^character[\s,]/.test(lines[j])) break;
            if (/^faction\s+/.test(lines[j])) break;
            if (/^\s*army\b/.test(lines[j])) {
              let k = j + 1;
              while (k < lines.length && /^\s*unit\s+/.test(lines[k])) {
                if (unitStart < 0) { unitStart = k; indent = (lines[k].match(/^(\s*)/) || ["", "\t"])[1]; }
                k++;
              }
              unitEnd = k;
              console.log(`[army-units] unit lines (no-faction retry): ${unitStart + 1}..${unitEnd} (${unitEnd - unitStart} unit lines)`);
              break;
            }
          }
        }
      }
    }
    if (unitStart < 0 && byCoord) {
      // Find the character at (x,y) [+ faction], then its `army` block's units.
      let curFac = null;
      for (let i = 0; i < lines.length; i++) {
        const fm = lines[i].match(/^faction\s+([a-z_0-9]+)/i); if (fm) { curFac = fm[1].toLowerCase(); continue; }
        if (/^character[\s,]/.test(lines[i])) {
          const cm = lines[i].match(/\bx\s+(-?\d+)\s*,\s*y\s+(-?\d+)/i);
          if (cm && Number(cm[1]) === Number(locator.x) && Number(cm[2]) === Number(locator.y) && (!wantFac || curFac === wantFac)) {
            // Scan to `army`, then unit lines.
            for (let j = i + 1; j < lines.length && j < i + 12; j++) {
              if (/^\s*army\b/.test(lines[j])) {
                let k = j + 1; while (k < lines.length && /^\s*unit\s+/.test(lines[k])) { if (unitStart < 0) { unitStart = k; indent = (lines[k].match(/^(\s*)/) || ["", "\t"])[1]; } k++; }
                unitEnd = k; break;
              }
              if (/^character[\s,]/.test(lines[j])) break;
            }
            break;
          }
        }
      }
    }
    if (unitStart < 0 && byRegion) {
      // garrisoned_army for region — fallback when character / x,y lookups didn't hit.
      let curFac = null;
      for (let i = 0; i < lines.length; i++) {
        const fm = lines[i].match(/^faction\s+([a-z_0-9]+)/i); if (fm) { curFac = fm[1].toLowerCase(); continue; }
        if (/^\s*settlement\s*$/.test(lines[i])) {
          let reg = null, ga = -1, uend = -1, us = -1, ind = "\t"; let j = i + 1;
          for (; j < lines.length; j++) {
            if (/^\s*\}/.test(lines[j])) break;
            const rm = lines[j].match(/^\s*region\s+(.+?)\s*$/); if (rm) reg = rm[1].trim();
            if (/^\s*garrisoned_army\s*$/.test(lines[j])) { ga = j; let k = j + 1; while (k < lines.length && /^\s*unit\s+/.test(lines[k])) { if (us < 0) { us = k; ind = (lines[k].match(/^(\s*)/) || ["", "\t"])[1]; } k++; } uend = k; }
          }
          if (reg === locator.region && ga >= 0 && (!wantFac || curFac === wantFac)) {
            // If the garrison had units, replace them; else insert right after the header.
            unitStart = us >= 0 ? us : ga + 1; unitEnd = us >= 0 ? uend : ga + 1; indent = ind;
            break;
          }
          i = j;
        }
      }
    }
    if (unitStart < 0 && byRegion) {
      // 0.9.658: ;Region-comment fallback. Most provincial capitals (Reate,
      // Pisae, Maleventum, …) have NO `garrisoned_army` block. Their garrison
      // lives inside a character army marked by a `;<region>` comment line
      // immediately above the `character,` header. RegionInfo also tries to
      // pass `locator.character` for this case, but if the live-save commander
      // resolution missed (no garrisonCommander on the save side, no
      // commanderName on the unit cards), only `locator.region` makes it
      // through and the previous byRegion path bailed silently. Now we read
      // the comment hint, walk to the next character, and edit their army
      // block.
      const wantedReg = String(locator.region).trim();
      const escaped = wantedReg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const commentRe = new RegExp(`^;\\s*${escaped}\\s*$`, "i");
      let curFac = null;
      for (let i = 0; i < lines.length; i++) {
        const fm = lines[i].match(/^faction\s+([a-z_0-9]+)/i);
        if (fm) { curFac = fm[1].toLowerCase(); continue; }
        if (wantFac && curFac !== wantFac) continue;
        if (!commentRe.test(lines[i])) continue;
        // Walk to the next character line within a few rows.
        for (let j = i + 1; j < lines.length && j < i + 6; j++) {
          if (/^character[\s,]/.test(lines[j])) {
            for (let k = j + 1; k < lines.length && k < j + 40; k++) {
              if (/^character[\s,]/.test(lines[k])) break;
              if (/^faction\s+/.test(lines[k])) break;
              if (/^\s*army\b/.test(lines[k])) {
                let m = k + 1;
                while (m < lines.length && /^\s*unit\s+/.test(lines[m])) {
                  if (unitStart < 0) { unitStart = m; indent = (lines[m].match(/^(\s*)/) || ["", "\t"])[1]; }
                  m++;
                }
                unitEnd = m;
                console.log(`[army-units] ;Region fallback: matched ";${wantedReg}" at line ${i + 1}, character at line ${j + 1}, army at line ${k + 1}, units ${unitStart + 1}..${unitEnd} (${unitEnd - unitStart} lines)`);
                break;
              }
            }
            break;
          }
        }
        if (unitStart >= 0) break;
      }
    }
    if (unitStart < 0 && !byRegion) return { ok: false, error: "army block not found" };
    if (unitStart < 0) return { ok: false, error: "garrison block not found" };
    // 0.9.651: accept either shape — pendingArmyUnits from the Recruitable-
    // click path stores {unit, exp, armour, weapon_lvl}; the original
    // ArmyUnitsEditor path stores {name, exp, armour, weapon}. Normalize
    // before formatting so both write valid descr_strat lines.
    const unitName = (u) => u && (u.name || u.unit);
    const unitExp = (u) => (u && (u.exp ?? u.xp)) || 0;
    const unitArm = (u) => (u && u.armour) || 0;
    const unitWep = (u) => (u && (u.weapon ?? u.weapon_lvl)) || 0;
    const fmtUnit = (u) => `${indent}unit\t\t${unitName(u)}\t\t\texp ${unitExp(u)} armour ${unitArm(u)} weapon_lvl ${unitWep(u)}`;
    const newLines = units.filter((u) => unitName(u)).map(fmtUnit);
    lines.splice(unitStart, unitEnd - unitStart, ...newLines);
    fs.writeFileSync(modOut(dsPath), lines.join(eol), "utf8");
    if (!_modExportDir) { try { loadModCharacterData(activeModDataDir); } catch (e) { console.warn("[army-units] re-parse failed:", e && e.message); } }
    console.log(`[army-units] ${faction} ${byCoord ? `@(${locator.x},${locator.y})` : locator.region}: wrote ${newLines.length} unit(s)`);
    return { ok: true, units: newLines.length };
  } catch (e) {
    console.warn(`[army-units] failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// 0.9.550: Add-General feature — read descr_strat + name lists, return per-
// faction culture name pools + families + settlement coord index for the UI.
function findActiveDescrStratPath() {
  if (!activeModDataDir) return null;
  const candidates = [
    path.join(activeModDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(activeModDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(activeModDataDir, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}
ipcMain.handle("addgen-get-data", async () => {
  try {
    if (!activeModDataDir) return { ok: false, error: "no active mod" };
    const dsPath = findActiveDescrStratPath();
    if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
    const namesPath = path.join(activeModDataDir, "text", "names.txt");
    const names = descrGen.parseNamesTxt(fs.readFileSync(namesPath, "utf16le"));
    const parsed = descrGen.parseDescrStrat(fs.readFileSync(dsPath, "utf8"));
    // LIVE culture namelists → so the name dropdowns offer every name registered
    // in descr_namelists.txt for the faction's culture (e.g. greek_men), not just
    // names already used by existing characters. Read fresh each call; best-effort.
    let facNamelists = {}, nlPools = {};
    try {
      const smP = path.join(activeModDataDir, "descr_sm_factions.txt");
      if (fs.existsSync(smP)) facNamelists = descrGen.parseSmFactionNamelists(fs.readFileSync(smP, "utf8"));
      const nlP = path.join(activeModDataDir, "descr_namelists.txt");
      if (fs.existsSync(nlP)) nlPools = descrGen.parseNamelistPools(fs.readFileSync(nlP, "utf8"));
      console.log(`[addgen] namelists: ${Object.keys(facNamelists).length} faction maps, ${Object.keys(nlPools).length} pools`);
    } catch (ne) { console.warn("[addgen] namelist load failed (dropdown = existing names only):", ne && ne.message); }
    const settIdx = descrGen.buildSettlementCoordIndex(parsed);
    const settlements = {};
    for (const [name, v] of settIdx) settlements[name] = { faction: v.faction, x: v.x, y: v.y, hint: v.hint };
    // OWNED settlements per faction (every settlement, by city name + coords) —
    // resolve coords via the map's black settlement pixels + region colours.
    let owned = {};
    try {
      const regPath = path.join(activeModDataDir, "world", "maps", "base", "descr_regions.txt");
      const tgaPath = path.join(activeModDataDir, "world", "maps", "base", "map_regions.tga");
      const { regionToCity, rgbToRegion } = descrGen.parseDescrRegions(fs.readFileSync(regPath, "utf8"));
      const regionCoords = descrGen.buildRegionCoords(fs.readFileSync(tgaPath), rgbToRegion);
      owned = descrGen.factionOwnedSettlements(parsed, regionToCity, regionCoords, settIdx);
      const totalOwned = Object.values(owned).reduce((s, l) => s + l.length, 0);
      const withCoords = Object.values(owned).reduce((s, l) => s + l.filter((x) => x.x != null).length, 0);
      console.log(`[addgen] owned settlements: ${totalOwned} across ${Object.keys(owned).length} factions, ${withCoords} with coords (${Object.keys(regionCoords).length} regions mapped from TGA)`);
    } catch (re) { console.warn("[addgen] owned-settlement resolve failed (falling back to governor index):", re && re.message); }
    const factions = {};
    for (const fac of parsed.factions) {
      const nl = facNamelists[fac.name] || {};
      const extra = { men: nlPools[nl.men] || [], women: nlPools[nl.women] || [] };
      const pools = descrGen.buildPools(fac, names, extra);
      factions[fac.name] = {
        name: fac.name, generalUnit: fac.generalUnit, generalUnits: fac.generalUnits,
        maleFirst: pools.maleFirst, femaleFirst: pools.femaleFirst, families: pools.families,
        usesSurnames: pools.usesSurnames,
        ownedSettlements: owned[fac.name] || [],
        duplicates: descrGen.findDuplicateNames(fac),
      };
    }
    console.log(`[addgen] data: ${Object.keys(factions).length} factions, ${Object.keys(settlements).length} governor-spots, file=${path.basename(dsPath)}`);
    return { ok: true, factions, settlements, file: path.basename(dsPath) };
  } catch (e) { console.warn("[addgen] get-data failed:", e && e.message); return { ok: false, error: e.message }; }
});
ipcMain.handle("addgen-apply", async (_event, selection) => {
  try {
    if (!activeModDataDir) return { ok: false, error: "no active mod" };
    const dsPath = findActiveDescrStratPath();
    if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
    const namesPath = path.join(activeModDataDir, "text", "names.txt");
    const lookupPath = path.join(activeModDataDir, "descr_names_lookup.txt");
    const dsRaw = fs.readFileSync(dsPath, "utf8");
    const eol = "\r\n"; // RTW:R game text files are ALWAYS CRLF
    const names = descrGen.parseNamesTxt(fs.readFileSync(namesPath, "utf16le"));
    const parsed = descrGen.parseDescrStrat(dsRaw);
    // Faction's descr_namelists pools (men/women) so composeAddGeneral can name
    // the general + family from VALID unused namelist entries instead of minting
    // suffixed tokens the game rejects ("Unknown name 'ApollodorosA'!").
    let pools = {};
    try {
      const smP = path.join(activeModDataDir, "descr_sm_factions.txt");
      const nlP = path.join(activeModDataDir, "descr_namelists.txt");
      if (fs.existsSync(smP) && fs.existsSync(nlP)) {
        const facNl = descrGen.parseSmFactionNamelists(fs.readFileSync(smP, "utf8"))[selection.factionName] || {};
        const nlPools = descrGen.parseNamelistPools(fs.readFileSync(nlP, "utf8"));
        pools = { men: nlPools[facNl.men] || [], women: nlPools[facNl.women] || [] };
        console.log(`[addgen] name pools for ${selection.factionName}: ${pools.men.length} men (${facNl.men}), ${pools.women.length} women (${facNl.women})`);
      }
    } catch (pe) { console.warn("[addgen] pool load failed (will fall back to minting):", pe && pe.message); }
    const res = descrGen.composeAddGeneral(parsed, names, selection, pools);
    // In export mode we don't back up the live files (we're not changing
    // them); the timestamped .bak is skipped and backupStamp returns null.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (!_modExportDir) fs.copyFileSync(dsPath, dsPath + "." + stamp + ".bak");
    fs.writeFileSync(modOut(dsPath), res.lines.join(eol), "utf8");
    if (res.namesAppend.length) {
      if (!_modExportDir) fs.copyFileSync(namesPath, namesPath + "." + stamp + ".bak");
      const nt = fs.readFileSync(namesPath, "utf16le");
      const ntEol = "\r\n"; // RTW:R always CRLF
      const ntLines = nt.split(/\r?\n/);
      // names.txt is sorted by token and the {ZZZZZ} entry is an end-marker —
      // appending AFTER it means the engine never reads the new names. Insert
      // each mint in its sorted-by-token position (which lands it before ZZZZZ).
      const tokenOf = (line) => { const m = line.match(/^﻿?\{([^}]*)\}/); return m ? m[1].toLowerCase() : null; };
      for (const n of res.namesAppend) {
        const entry = `{${n.token}}${n.display}`;
        const tokLc = n.token.toLowerCase();
        let idx = ntLines.findIndex((l) => { const k = tokenOf(l); return k != null && k > tokLc; });
        if (idx < 0) { while (ntLines.length && ntLines[ntLines.length - 1].trim() === "") ntLines.pop(); ntLines.push(entry); }
        else ntLines.splice(idx, 0, entry);
      }
      fs.writeFileSync(modOut(namesPath), ntLines.join(ntEol), "utf16le");
    }
    if (res.lookupAppend.length) {
      if (!_modExportDir) fs.copyFileSync(lookupPath, lookupPath + "." + stamp + ".bak");
      const lk = fs.readFileSync(lookupPath, "utf8");
      const lkEol = "\r\n"; // RTW:R always CRLF
      const lkLines = lk.split(/\r?\n/);
      // descr_names_lookup.txt is alphabetically sorted (and ends with ZZZZZ).
      // Insert each token in sorted position so the engine's lookup finds it.
      for (const tok of res.lookupAppend) {
        const tokLc = tok.toLowerCase();
        let idx = lkLines.findIndex((l) => l.trim() && l.trim().toLowerCase() > tokLc);
        if (idx < 0) { while (lkLines.length && lkLines[lkLines.length - 1].trim() === "") lkLines.pop(); lkLines.push(tok); }
        else lkLines.splice(idx, 0, tok);
      }
      fs.writeFileSync(modOut(lookupPath), lkLines.join(lkEol), "utf8");
    }
    // 0.9.869: register minted names in the faction's CULTURE NAMELIST
    // (descr_namelists.txt). RTW validates every descr_strat character name
    // against the faction's men/women namelist — a minted token (e.g.
    // "PhilocharisA") that lives only in names.txt + descr_names_lookup.txt but
    // NOT here makes the campaign fail to start. Group minted tokens by gender.
    if (res.namesAppend.length) {
      try {
        const smP = path.join(activeModDataDir, "descr_sm_factions.txt");
        const nlP = path.join(activeModDataDir, "descr_namelists.txt");
        if (fs.existsSync(smP) && fs.existsSync(nlP)) {
          const facNl = (descrGen.parseSmFactionNamelists(fs.readFileSync(smP, "utf8"))[selection.factionName]) || {};
          const menToks = res.namesAppend.filter((n) => n.gender === "male").map((n) => n.token);
          const womenToks = res.namesAppend.filter((n) => n.gender === "female").map((n) => n.token);
          let nlRaw = fs.readFileSync(nlP, "utf8");
          const nlEol = nlRaw.includes("\r\n") ? "\r\n" : "\n";
          let changed = false;
          if (facNl.men && menToks.length) {
            const upd = descrGen.insertNamelistTokens(nlRaw, facNl.men, menToks, nlEol);
            if (upd) { nlRaw = upd; changed = true; }
          }
          if (facNl.women && womenToks.length) {
            const upd = descrGen.insertNamelistTokens(nlRaw, facNl.women, womenToks, nlEol);
            if (upd) { nlRaw = upd; changed = true; }
          }
          if (changed) {
            if (!_modExportDir) fs.copyFileSync(nlP, nlP + "." + stamp + ".bak");
            fs.writeFileSync(modOut(nlP), gameTextCRLF(nlP, nlRaw), "utf8");
            console.log(`[addgen] registered minted names in descr_namelists.txt — ${menToks.length} male (${facNl.men}), ${womenToks.length} female (${facNl.women})`);
          } else {
            console.warn(`[addgen] descr_namelists NOT updated for ${selection.factionName} (men=${facNl.men} women=${facNl.women}); minted names: ${res.namesAppend.map((n) => n.token + ":" + n.gender).join(", ")} — campaign may reject them`);
          }
        } else {
          console.warn("[addgen] descr_sm_factions.txt / descr_namelists.txt missing — cannot register minted names in the namelist (RTW may reject the new character)");
        }
      } catch (nlErr) { console.warn("[addgen] namelist registration failed:", nlErr && nlErr.message); }
    }
    // Re-parse the mod's descr_strat so the new general shows in the Characters
    // view + Family Tree immediately (these read cached parses). Skip in export
    // mode: the live mod is unchanged, so re-parsing it would discard the edit
    // from the in-memory view.
    if (!_modExportDir) {
      try { loadModCharacterData(activeModDataDir); console.log("[addgen] re-parsed mod character data after write"); }
      catch (e) { console.warn("[addgen] post-write re-parse failed:", e && e.message); }
    }
    console.log(`[addgen] added ${res.summary.general} to ${res.summary.faction} @${selection.x},${selection.y}; minted=[${res.summary.minted.join(",")}]; ${_modExportDir ? `exported under ${_modExportDir}` : `backup ${stamp}`}`);
    return { ok: true, summary: res.summary, backupStamp: _modExportDir ? null : stamp };
  } catch (e) { console.warn("[addgen] apply failed:", e && e.message); return { ok: false, error: e.message }; }
});

// Live starting-armies refresh: re-parse the active mod's descr_strat.txt (+
// map_regions.tga / descr_regions.txt / factions) and return the same
// { region: { garrison, field, settlement } } object the build-time bundle
// writes. Lets the non-live Garrison / Field-armies panel reflect mid-session
// edits (Add General, army-unit Save to Mod) instead of stale bundled data.
// modDataDir defaults to the active mod; campaignDir is the folder under
// world/maps/campaign (imperial_campaign / ris_classic). Returns { error } on
// failure — caller keeps the prior state (no fabricated data).
ipcMain.handle("get-live-starting-armies", async (_event, modDataDir, campaignDir) => {
  try {
    const dir = modDataDir || activeModDataDir;
    if (!dir) return { error: "no active mod" };
    const byRegion = await buildStartingArmiesFromMod(dir, campaignDir);
    if (!byRegion) {
      try { _writeLog(`[starting-armies] live refresh: no data (dir=${dir} campaign=${campaignDir || "auto"})`); } catch {}
      return { error: "starting armies not found" };
    }
    try { _writeLog(`[starting-armies] live refresh: ${Object.keys(byRegion).length} regions (campaign=${campaignDir || "auto"})`); } catch {}
    return byRegion;
  } catch (e) {
    try { _writeLog(`[starting-armies] live refresh failed: ${e && e.message}`); } catch {}
    return { error: e && e.message ? e.message : String(e) };
  }
});

// 0.9.437: descr_strat ancillary editor — rewrite the `ancillaries Foo,
// Bar` line on a character block. Mirrors update-character-traits exactly.
// Persistent; affects next non-live load. Does NOT touch live save data.
ipcMain.handle("update-character-ancillaries", async (_event, firstName, faction, ancillaries) => {
  if (!activeModDataDir) return { ok: false, error: "no active mod" };
  if (!firstName) return { ok: false, error: "missing firstName" };
  if (!Array.isArray(ancillaries)) return { ok: false, error: "ancillaries must be an array" };
  const candidates = [
    path.join(activeModDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(activeModDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(activeModDataDir, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  const dsPath = candidates.find((p) => fs.existsSync(p));
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const lines = text.split(/\r?\n/);
    const targetFaction = String(faction || "").toLowerCase();
    let curFaction = null;
    let charLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const fm = lines[i].match(/^faction\s+(\S+?),/);
      if (fm) { curFaction = fm[1].toLowerCase(); continue; }
      const cm = lines[i].match(/^character[\s,]+([^,]+?),/);
      if (cm) {
        const parts = cm[1].trim().split(/\s+/);
        const fn = parts[0];
        if (fn === firstName && (!targetFaction || curFaction === targetFaction)) {
          charLineIdx = i;
          break;
        }
      }
    }
    if (charLineIdx < 0) return { ok: false, error: `character "${firstName}" (faction "${faction}") not found` };
    // The `ancillaries …` line sits within ~8 lines below the character
    // header (alongside `traits …` and before `army`).
    let ancLineIdx = -1;
    for (let j = charLineIdx + 1; j < Math.min(charLineIdx + 8, lines.length); j++) {
      if (/^\s*ancillaries\b/.test(lines[j])) { ancLineIdx = j; break; }
      if (/^character[\s,]/.test(lines[j]) || /^army\b/.test(lines[j])) break;
    }
    const cleaned = ancillaries.map(a => typeof a === "string" ? a : a?.name).filter(Boolean);
    const newLine = cleaned.length > 0 ? `ancillaries ${cleaned.join(", ")}` : null;
    if (ancLineIdx >= 0) {
      if (newLine == null) {
        lines.splice(ancLineIdx, 1);
      } else {
        const indent = lines[ancLineIdx].match(/^(\s*)/)[1] || "";
        lines[ancLineIdx] = indent + newLine;
      }
    } else if (newLine != null) {
      // Insert just after a `traits` line if present (engine convention),
      // else right after the character header.
      let insertAt = charLineIdx + 1;
      for (let j = charLineIdx + 1; j < Math.min(charLineIdx + 8, lines.length); j++) {
        if (/^\s*traits\b/.test(lines[j])) { insertAt = j + 1; break; }
        if (/^character[\s,]/.test(lines[j]) || /^army\b/.test(lines[j])) break;
      }
      lines.splice(insertAt, 0, "\t" + newLine);
    }
    const usesCRLF = true; // RTW:R game text files are ALWAYS CRLF
    const out = lines.join(usesCRLF ? "\r\n" : "\n");
    fs.writeFileSync(modOut(dsPath), out, "utf8");
    const reportLine = ancLineIdx >= 0 ? ancLineIdx + 1 : charLineIdx + 2;
    console.log(`[ancillary-edit] wrote ${cleaned.length} ancillaries for ${firstName} (faction ${faction || "?"}) to ${path.basename(dsPath)}:${reportLine}`);
    return { ok: true, file: dsPath, line: reportLine };
  } catch (e) {
    console.warn(`[ancillary-edit] failed for ${firstName}: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// 0.9.437: descr_strat region-buildings editor — replace the `building {
// type X Y }` blocks inside the settlement that has `region <RegionName>`.
// Persistent; affects next non-live load. Does NOT touch live save data.
// Input shape: buildings = [{ type: "core_building", level: "village" }, ...]
ipcMain.handle("update-region-buildings", async (_event, regionName, buildings) => {
  if (!activeModDataDir) return { ok: false, error: "no active mod" };
  if (!regionName) return { ok: false, error: "missing regionName" };
  if (!Array.isArray(buildings)) return { ok: false, error: "buildings must be an array" };
  const candidates = [
    path.join(activeModDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(activeModDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(activeModDataDir, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  const dsPath = candidates.find((p) => fs.existsSync(p));
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const lines = text.split(/\r?\n/);
    // Walk settlement blocks. Each settlement is:
    //   settlement
    //   {
    //     level X
    //     region <Name>
    //     ...
    //     building { type CHAIN LEVEL }
    //     building { type ... }
    //   }
    // Find the settlement whose `region` line equals the regionName, then
    // splice out every `building { … }` block within the settlement's
    // braces and write fresh ones at the original first-building position.
    // 0.9.444: brace-depth tracking. The previous parser treated the FIRST
    // `}` inside a settlement as the settlement-closing brace — but every
    // `building { … }` block inside a settlement has its own `}`, so the
    // settlement was being "ended" at the first building's close. Result:
    // the building-range scan saw zero closed blocks (only the orphaned
    // opens), removed nothing, and inserted N new blocks below the orphans.
    // After a few edits, descr_strat looked like the user's corrupted file
    // (107 added `+ building` lines, repeating cores, stray `}`s). We now
    // track brace depth properly: depth 0 = outside braces, depth 1 = inside
    // the settlement, depth ≥2 = inside a building block. A `}` only closes
    // the settlement when depth drops back to 0.
    let settlementLineIdx = -1;
    let braceStart = -1;
    let regionLineIdx = -1;
    let depth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^settlement\b/.test(line)) {
        settlementLineIdx = i;
        braceStart = -1;
        regionLineIdx = -1;
        depth = 0;
        continue;
      }
      if (settlementLineIdx < 0) continue;
      // Count braces on the line (handles single-line `{ ... }` too).
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      if (braceStart < 0 && opens > 0) {
        braceStart = i;
        depth += opens;
        depth -= closes;
        if (depth <= 0) {
          // Pathological: `{}` on a single line w/ no body. Skip.
          settlementLineIdx = -1;
          braceStart = -1;
        }
        continue;
      }
      if (braceStart < 0) continue;
      const rm = line.match(/^\s*region\s+(\S+)/);
      if (rm) regionLineIdx = i;
      depth += opens;
      depth -= closes;
      if (depth > 0) continue; // still inside settlement (incl. inside building blocks)
      // depth === 0 (or below): settlement just closed. Decide if this is the
      // target region.
      const matchesRegion = regionLineIdx >= 0 &&
        (lines[regionLineIdx].match(/^\s*region\s+(\S+)/)?.[1] || "").toLowerCase() === regionName.toLowerCase();
      if (matchesRegion) {
        const blockStart = braceStart;
        const blockEnd = i;
        // Find building block ranges. Use brace depth (relative to the
        // settlement = 1) so a building opens at depth 2 and closes back to
        // depth 1. Records [start, end] inclusive for the building block.
        const buildingRanges = [];
        let bDepth = 1; // we re-walk; settlement's `{` already counted
        let bStart = -1;
        for (let j = blockStart + 1; j < blockEnd; j++) {
          const ln = lines[j];
          const isBuildingHead = /^\s*building\b/.test(ln);
          const o = (ln.match(/\{/g) || []).length;
          const c = (ln.match(/\}/g) || []).length;
          if (isBuildingHead && bDepth === 1 && bStart < 0) bStart = j;
          bDepth += o;
          bDepth -= c;
          if (bStart >= 0 && bDepth === 1 && (c > 0 || o === 0)) {
            // Close occurred and we're back at settlement-level depth.
            if (c > 0) {
              buildingRanges.push([bStart, j]);
              bStart = -1;
            }
          }
        }
        let insertAt;
        let indent;
        if (buildingRanges.length > 0) {
          insertAt = buildingRanges[0][0];
          indent = lines[insertAt].match(/^(\s*)/)[1] || "\t";
        } else {
          insertAt = blockEnd;
          const braceIndent = lines[braceStart].match(/^(\s*)/)[1] || "";
          indent = braceIndent + "\t";
        }
        // Remove building blocks bottom-up so indices stay valid.
        for (let r = buildingRanges.length - 1; r >= 0; r--) {
          const [s, e] = buildingRanges[r];
          lines.splice(s, e - s + 1);
          if (s < insertAt) insertAt -= (e - s + 1);
        }
        const newLines = [];
        for (const b of buildings) {
          const chain = String(b.type || "").trim();
          const level = String(b.level || "").trim();
          if (!chain || !level) continue;
          newLines.push(`${indent}building`);
          newLines.push(`${indent}{`);
          newLines.push(`${indent}\ttype ${chain} ${level}`);
          newLines.push(`${indent}}`);
        }
        lines.splice(insertAt, 0, ...newLines);
        const usesCRLF = true; // RTW:R game text files are ALWAYS CRLF
        const out = lines.join(usesCRLF ? "\r\n" : "\n");
        fs.writeFileSync(modOut(dsPath), out, "utf8");
        console.log(`[building-edit] wrote ${buildings.length} buildings for region "${regionName}" to ${path.basename(dsPath)}:${insertAt + 1} (replaced ${buildingRanges.length} existing blocks)${_modExportDir ? " (exported)" : ""}`);
        return { ok: true, file: dsPath, line: insertAt + 1 };
      }
      // Not our settlement — reset and keep scanning.
      settlementLineIdx = -1;
      braceStart = -1;
      regionLineIdx = -1;
      depth = 0;
    }
    return { ok: false, error: `region "${regionName}" not found in ${path.basename(dsPath)}` };
  } catch (e) {
    console.warn(`[building-edit] failed for region ${regionName}: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// 0.9.437: building catalogue IPC — return the mod's full chain → levels
// map (already parsed in loadModCharacterData via modBuildingChains +
// modChainMaxLevels) plus the level NAMES per chain (buildingLevelsLookup
// is renderer-side; main process needs to re-emit chain → levels here).
// Used by the dev-mode Add Building picker.
ipcMain.handle("get-building-catalogue", async () => {
  if (!activeModDataDir) return { chains: {}, categories: {}, settlementMins: {}, settlementTiers: [], levelRequires: {} };
  const edbPath = path.join(activeModDataDir, "export_descr_buildings.txt");
  if (!fs.existsSync(edbPath)) return { chains: {}, categories: {}, settlementMins: {}, settlementTiers: [], levelRequires: {} };
  try {
    const edbText = fs.readFileSync(edbPath, "utf8");
    const blocks = edbText.split(/^building\s+/m).slice(1);
    const chains = {};            // chainName → [levelName, ...]
    const categories = {};        // chainName → category (icon line)
    // 0.9.441: per-level settlement_min, keyed by `${chain}|${level}` →
    // settlement-tier name (e.g. "village", "town", "large_town", ...). The
    // dev-mode building editor uses this to gate the ⬆ button — you can only
    // upgrade past a level whose settlement_min is met by the settlement's
    // core_building level.
    const settlementMins = {};
    // 0.9.443: raw `requires` expression per level, keyed by `${chain}|${level}`.
    // The renderer side parses this into a structured filter (factions /
    // hidden_resource / resource etc.) so the dev-mode Add Building picker
    // only shows chains the engine would actually accept for the current
    // region. Concatenating multiple `and / or` continuation lines means
    // the renderer gets a single string with the full clause to parse.
    const levelRequires = {};
    // 0.9.600: capture each chain's `tag` (government / temple / civic / port /
    // heavy_ind / …). A settlement holds at most ONE building per tag — the
    // engine enforces it via the `no_other_<tag>` requirement on every tagged
    // building — so the Add-building picker uses this to hide a second building
    // of an already-occupied slot (you must replace, not stack).
    const tags = {};
    for (const b of blocks) {
      const name = b.match(/^(\w+)/)?.[1];
      if (!name) continue;
      const lvLine = b.match(/^\s+levels\s+(.+)/m);
      const chainLevels = lvLine ? lvLine[1].trim().split(/\s+/).filter(Boolean) : [];
      if (chainLevels.length) chains[name] = chainLevels;
      const iconLine = b.match(/^\s+icon\s+(\w+)/m);
      if (iconLine) categories[name] = iconLine[1].toLowerCase();
      const tagLine = b.match(/^\s+tag\s+(\w+)/m);
      if (tagLine) tags[name] = tagLine[1].toLowerCase();
      // Walk the block line-by-line to find each level's settlement_min.
      // EDB structure inside a `building <chain> { ... }` block:
      //   levels lvl1 lvl2 lvl3
      //   { ... }      <- begin levels container
      //   lvl1
      //   {
      //     settlement_min village
      //     ...
      //   }
      //   lvl2
      //   { ... }
      const lvlSet = new Set(chainLevels);
      const blockLines = b.split(/\r?\n/);
      let curLevel = null;
      let curLevelHeader = null;
      for (const ln of blockLines) {
        // Level header. RTW EDB declares each level as either a bare
        // identifier or `<name> requires <expr>` on the same line, e.g.
        //   farms+2
        //   farms+3 requires factions { romans_julii, } and resource grain
        //   level core_building
        // Accept both forms. Level names can include `+`, `-`, digits, etc.
        const lm = ln.match(/^\s*(?:level\s+)?([A-Za-z][A-Za-z0-9_+\-]*)\b/);
        if (lm && lvlSet.has(lm[1])) {
          curLevel = lm[1];
          curLevelHeader = ln;
          // 0.9.443: capture per-level `requires` expression so the picker
          // can hide chains the engine would refuse. We collect the header
          // line PLUS subsequent lines up until the next sibling level so
          // multi-line `requires` clauses are captured. Then parse out the
          // bits we care about (factions / hidden_resource / resource).
          if (!levelRequires[`${name}|${curLevel}`]) levelRequires[`${name}|${curLevel}`] = "";
          // Append everything after the level name (handles `farms requires …`)
          const tail = ln.slice(ln.indexOf(lm[1]) + lm[1].length);
          levelRequires[`${name}|${curLevel}`] += " " + tail;
          continue;
        }
        if (!curLevel) continue;
        const sm = ln.match(/^\s*settlement_min\s+(\S+)/);
        if (sm) {
          settlementMins[`${name}|${curLevel}`] = sm[1].toLowerCase();
          continue;
        }
        // Pick up multi-line `requires` clauses. They typically start with
        // `requires …` on the level header but can continue with `and …`
        // / `or …` lines or appear inside a `capability { … }` block (which
        // we DON'T want to swallow). Be conservative: only pick up top-level
        // lines that look like a requires-clause continuation.
        if (/^\s*requires\s+/.test(ln) || /^\s*and\s+/.test(ln) || /^\s*or\s+/.test(ln)) {
          levelRequires[`${name}|${curLevel}`] += " " + ln.trim();
        }
        // Heuristic block-end: an opening of another top-level directive
        // resets curLevel so we don't bleed settings between sibling levels.
        if (/^\s*levels\s+/.test(ln)) { curLevel = null; curLevelHeader = null; }
      }
    }
    // Ordered settlement tier list — derived from the core_building chain
    // since that IS the settlement-level ladder (village → town → ... →
    // huge_city). UI uses it to compare settlement_min "is >= " requirements.
    const settlementTiers = (chains.core_building || []).slice();
    console.log(`[get-building-catalogue] chains=${Object.keys(chains).length} settlement_min entries=${Object.keys(settlementMins).length} requires entries=${Object.keys(levelRequires).length} tiers=${settlementTiers.length} tags=${Object.keys(tags).length}`);
    return { chains, categories, settlementMins, settlementTiers, levelRequires, tags };
  } catch (e) {
    console.warn(`[get-building-catalogue] failed: ${e.message}`);
    return { chains: {}, categories: {}, settlementMins: {}, settlementTiers: [], levelRequires: {} };
  }
});

// 0.9.418: RTW Remastered ships no per-trait icon files (vanilla RTW had
// `data/ui/<culture>/vnvs/<level_name>.tga` but Remastered bakes trait
// icons into a compiled UI atlas instead — no on-disk path resolves).
// We keep the IPC handler in case a mod adds icons under that path, but
// it's expected to return `{ ok: false }` for stock RTW Remastered.
ipcMain.handle("resolve-trait-icon", async (_event, modDataDir, culture, levelName) => {
  if (!levelName) return { ok: false };
  const VANILLA_DATA = getVanillaDataDir();
  const dataDirs = [modDataDir || null, VANILLA_DATA].filter(Boolean);
  const cultures = [
    String(culture || "").toLowerCase(),
    "roman", "greek", "eastern", "egyptian", "carthaginian", "barbarian",
  ].filter(Boolean);
  for (const dir of dataDirs) {
    for (const c of cultures) {
      const candidate = path.join(dir, "ui", c, "vnvs", `${levelName}.tga`);
      try {
        if (fs.existsSync(candidate)) {
          const buffer = fs.readFileSync(candidate);
          return {
            ok: true,
            buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
            path: candidate,
          };
        }
      } catch {}
    }
  }
  return { ok: false };
});

// 0.9.418: resolve an ancillary icon TGA. RTW Remastered DOES ship these,
// at `data/ui/ancillaries/<ancillary_name>.tga` (one big shared dir, not
// per-culture). Search mod dir first, then vanilla.
ipcMain.handle("resolve-ancillary-icon", async (_event, modDataDir, ancillaryName) => {
  if (!ancillaryName) return { ok: false };
  const VANILLA_DATA = getVanillaDataDir();
  const dirs = [modDataDir || null, VANILLA_DATA].filter(Boolean);
  for (const dir of dirs) {
    for (const sub of ["ancillaries", "ancillaries_cards"]) {
      const candidate = path.join(dir, "ui", sub, `${ancillaryName}.tga`);
      try {
        if (fs.existsSync(candidate)) {
          const buffer = fs.readFileSync(candidate);
          return {
            ok: true,
            buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
            path: candidate,
          };
        }
      } catch {}
    }
  }
  return { ok: false };
});

let _savePathMissLogged = null;
let _hashPickLogged = null;
ipcMain.handle("resolve-portrait", async (_event, modDataDir, culture, slot, charContext) => {
  // 0.9.520: REMOVED the 0.9.517 leader_pic override. leader_pic_<faction>.tga
  // is used by RTW's faction-selection menu, NOT for in-game character
  // portraits. The engine uses the regular portrait pool (greek/old/generals/
  // NNN.tga) for the leader's family-tree/bodyguard card — same as every
  // other char. User-labeled in-game portraits confirmed AntigonosII shows
  // pool portrait 000, not the leader_pic file. Override was making
  // Provincia diverge from the actual game for every faction leader.
  // Crack 2026-05-18 fast-path: if the caller passes an exact save-derived
  // portrait path (`charContext.savePath` like "data/ui/greek/portraits/
  // cards/young/generals/149.tga"), load it directly — no culture mapping
  // or hash needed. This is the in-game-exact portrait.
  if (charContext && charContext.savePath && typeof charContext.savePath === "string") {
    const rel = charContext.savePath.replace(/^\/+/, "");
    // Try mod dir first, then vanilla. The save path is rooted at "data/..."
    // so we strip that prefix to get "ui/..." and prepend each search dir.
    const subPath = rel.replace(/^data\//, "");
    // RIS-layout fallback (0.9.882): the save stores the vanilla
    // "…/portraits/cards/<bucket>/generals/NNN.tga" path, but RIS ships its
    // portraits as "…/portraits/portraits/<bucket>/NNN.tga" — no `cards/` and no
    // `generals/` subdir. Without this rewrite EVERY character whose save path
    // points at the cards/ layout misses the fast-path and falls to a hash-pool
    // face (wrong portrait, sometimes a different-culture-looking one). Try the
    // rewritten path so the character gets their REAL indexed face.
    // Two on-disk layouts host the same indexed pool:
    //   vanilla RTW: …/portraits/portraits/<age>/generals/NNN.tga(.dds)  (KEEPS generals/)
    //   RIS mod:     …/portraits/portraits/<age>/NNN.tga                 (DROPS generals/)
    // The save's index points at the FULL vanilla pool (e.g. roman 249 — RIS's
    // own folder only ships ~130, so without the vanilla path a high index falls
    // to a hash face = wrong portrait). Try the cards→portraits rewrite BOTH with
    // and without the generals/ subdir so the index resolves in whichever pool
    // actually has it (vanilla generals/ first since that's where the index lives).
    const subPathVanilla = subPath.replace(/\/portraits\/cards\//, "/portraits/portraits/");
    const subPathRis = subPathVanilla.replace(/\/generals\//, "/");
    const subPaths = [...new Set([subPath, subPathVanilla, subPathRis])];
    // Also try adding .dds — RTW stores the actual files as .tga.dds, save
    // references them as .tga.
    const VANILLA_DATA = getVanillaDataDir();
    const dataDirs = [
      modDataDir ? modDataDir : null,
      VANILLA_DATA,
    ].filter(Boolean);
    // 0.9.885: try ALL .tga.dds candidates before ANY plain .tga. The game loads
    // .tga.dds portraits and IGNORES loose .tga (RIS ships its roman portraits as
    // .tga, which the engine doesn't use — it falls back to the vanilla .tga.dds
    // pool). So a real mod override (.tga.dds) still wins over vanilla, but RIS's
    // unused .tga roman folder no longer shadows the vanilla face the game shows.
    const dds = [], tga = [];
    for (const d of dataDirs) {
      for (const sp of subPaths) {
        dds.push(path.join(d, sp + ".dds"));
        tga.push(path.join(d, sp));
      }
    }
    const candidates = [...dds, ...tga];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          const buffer = fs.readFileSync(candidate);
          return {
            ok: true,
            buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
            path: candidate,
            encoded: candidate.endsWith(".dds") ? "rtw-tga-dds" : null,
          };
        }
      } catch {}
    }
    // 0.9.449: log fast-path miss once per savePath so we can see which
    // portrait paths the save points at but the filesystem doesn't have.
    // Helps diagnose "wrong portrait" reports — when the fast-path file
    // doesn't exist, we fall through to the deterministic hash pool which
    // can collide across same-firstName chars.
    if (!_savePathMissLogged) _savePathMissLogged = new Set();
    if (!_savePathMissLogged.has(charContext.savePath)) {
      _savePathMissLogged.add(charContext.savePath);
      console.log(`[resolve-portrait] fast-path MISS for savePath="${charContext.savePath}" (name="${charContext.name || ""}" faction="${charContext.faction || ""}") — falling back to hash pool`);
    }
  }
  if (!culture || !slot) return { ok: false };
  const c = String(culture).toLowerCase();
  const s = String(slot).toLowerCase();
  const _vd = getVanillaDataDir();
  const VANILLA_UI = _vd ? path.join(_vd, "ui") : null;
  const dirs = [
    modDataDir ? path.join(modDataDir, "ui") : null,
    VANILLA_UI,
  ].filter(Boolean);
  // Try the requested culture first, then the mod's declared
  // `"portrait mapping"` from descr_cultures.txt (e.g. RIS's `e_hellenistic`
  // → `greek`), then the six vanilla RTW cultures. The portrait mapping is
  // what RTW itself uses for character art when the culture doesn't ship
  // its own pool — without it, e_hellenistic factions would mis-fall-back
  // to roman (alphabetically first) instead of the intended greek base.
  const VANILLA_CULTURES = ["roman", "greek", "eastern", "egyptian", "carthaginian", "barbarian"];
  const mapping = loadPortraitMapping(modDataDir);
  const mappedBase = mapping[c] || null;
  const tryCultures = [c];
  if (mappedBase && mappedBase !== c) tryCultures.push(mappedBase);
  for (const v of VANILLA_CULTURES) {
    if (!tryCultures.includes(v)) tryCultures.push(v);
  }

  // For the "general" slot, prefer the per-character RTW portrait pool
  // (`<culture>/portraits/portraits/{young,old}/generals/NNN.tga.dds`) so
  // each general renders with their own face like the in-game family tree,
  // rather than every general showing the same generic portrait.
  //
  // NOTE: the *real* portrait index is stored in the save and (sometimes)
  // in descr_strat as `portrait_index N`. Until that byte is cracked we
  // fall back to a deterministic DJB2 hash so the same character always
  // gets the same face. The hash includes firstName + lastName + faction
  // so two characters with the same first name don't collide.
  if (s === "general" && charContext && charContext.name) {
    // Explicit index from descr_strat wins outright (vanilla uses this).
    const explicit = (charContext.portraitIndex != null) ? Number(charContext.portraitIndex) | 0 : null;
    const ageNum = charContext.age != null ? Number(charContext.age) : null;
    const ageBucket = (ageNum != null && ageNum >= 35) ? "old" : "young";
    // 0.9.455: hash input KEEPS the 3-element shape (name|lastName|faction)
    // but FORCES lastName to "" regardless of what the caller passed. The
    // 0.9.449 family tree (which user confirmed was correct) hashed with
    // empty lastName → idx 38 for AntigonosB. Garrison live mode was
    // passing the epitheted lastName ("II Gonatas the Kind") → different
    // input → idx 000. By normalising lastName to "" here, both paths
    // produce idx 38 again, matching the user-confirmed correct portrait.
    // The 3-element join shape is preserved so the hash result matches
    // what 0.9.449 produced for the family tree.
    const hashInput = [
      charContext.name,
      "",
      charContext.faction || "",
    ].join("|");
    const nameHash = hashName(hashInput);
    for (const tc of tryCultures) {
      // 0.9.885: pick the BEST pool for this culture across dirs — prefer the
      // .tga.dds pool the engine actually loads over a plain-.tga mod pool it
      // ignores (RIS ships its roman portraits as .tga, which the game doesn't
      // use — it falls back to vanilla's .tga.dds; that .tga pool was shadowing
      // the vanilla face and giving every floored commander a nomadic face).
      // Mod dirs come first, so a real mod .tga.dds override still wins.
      let pool = null;
      for (const d of dirs) {
        const p = resolvePortraitPool(path.join(d, tc, "portraits", "portraits", ageBucket));
        if (!p || p.files.length === 0) continue;
        if (!pool || (pool.ext === ".tga" && p.ext === ".tga.dds")) pool = p;
        if (pool.ext === ".tga.dds") break;
      }
      if (!pool || pool.files.length === 0) continue;
      const files = pool.files;
      // Explicit portrait_index (descr_strat / future save) bypasses the hash.
      // Clamp into the pool's bounds in case the index was written for a
      // different (larger) pool.
      const idx = (explicit != null) ? (explicit % files.length) : (nameHash % files.length);
      const file = files[idx];
      const isVanilla = pool.dir.includes("Total War ROME REMASTERED");
      console.log(`[portrait] hash-pool pick name="${charContext.name}" lastName="${charContext.lastName || ""}" faction="${charContext.faction || ""}" culture=${tc} (requested=${c}) bucket=${ageBucket} ageRaw=${charContext.age} source=${isVanilla ? "VANILLA" : "MOD"} layout=${pool.ext === ".tga.dds" && pool.dir.endsWith("generals") ? "A/generals-dds" : pool.ext === ".tga.dds" ? "B/bucket-dds" : "B/bucket-tga"} → idx=${idx}/${files.length} file=${file} dir="${pool.dir}"`);
      try {
        const buf = fs.readFileSync(path.join(pool.dir, file));
        return {
          ok: true,
          buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          path: path.join(pool.dir, file),
          encoded: pool.ext === ".tga.dds" ? "rtw-tga-dds" : null,
        };
      } catch {}
    }
    // Fall through to the static general_portrait.tga fallback below.
  }

  const candidates = [];
  for (const tc of tryCultures) {
    for (const d of dirs) {
      if (s === "wife" || s === "son" || s === "daughter") {
        candidates.push(path.join(d, tc, "portraits", "family", s + ".tga"));
      } else if (s === "general") {
        // Static fallback if no per-character pool was found. Only roman +
        // barbarian ship this file in vanilla; greek/eastern/etc inherit it.
        candidates.push(path.join(d, tc, "portraits", "general_portrait.tga"));
      }
    }
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const buffer = fs.readFileSync(candidate);
        return { ok: true, buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), path: candidate };
      }
    } catch {}
  }
  // 0.9.821: nothing resolved — no save fast-path, no per-character pool, no
  // static general_portrait.tga. We used to return {ok:false} SILENTLY, so a
  // "generals have no portraits" report showed only the renderer's
  // [bodyguard-swap] FAIL with no way to see WHY. Log the search roots + which
  // actually exist on disk, the cultures tried, and a sample pool path we
  // looked for — so the cause (wrong/partial mod dir, missing vanilla install,
  // unexpected portrait layout) is one grep away. Throttled per culture|slot.
  try {
    if (!global._portraitMissLogged) global._portraitMissLogged = new Set();
    const mk = `${c}|${s}`;
    if (!global._portraitMissLogged.has(mk)) {
      global._portraitMissLogged.add(mk);
      const rootState = dirs.map((d) => `${d}=${fs.existsSync(d) ? "exists" : "MISSING"}`).join("  |  ");
      const samplePool = path.join(dirs[0] || "(no dir)", tryCultures[0] || c, "portraits", "portraits", "young");
      const samplePoolState = `${samplePool}=${fs.existsSync(samplePool) ? "exists" : "MISSING"}`;
      console.log(`[resolve-portrait] NO PORTRAIT for culture="${c}" slot="${s}" — every source empty. tried cultures=[${tryCultures.join(",")}]. roots: ${rootState}. sample pool dir: ${samplePoolState}. modDataDir="${modDataDir || "(none)"}"`);
    }
  } catch {}
  return { ok: false };
});

ipcMain.handle("get-descr-strat-families", async () => {
  if (!modDescrStratFamilies || !modDescrStratFamilies.byFaction) {
    return { ok: false, byFaction: {} };
  }
  return { ok: true, byFaction: modDescrStratFamilies.byFaction };
});

// Diplomacy editor: read all three descr_strat diplomacy values per pair
// (core_attitudes / faction_relationships / faction_agression) →
// byFaction[from][to] = { core, rel, agg } + the full faction list.
ipcMain.handle("get-core-attitudes", async () => {
  try {
    if (!activeModDataDir) return { ok: false };
    const dsPath = findActiveDescrStratPath();
    if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
    const text = fs.readFileSync(dsPath, "utf8");
    const dip = descrGen.parseDiplomacy(text);
    const parsed = descrGen.parseDescrStrat(text);
    const factions = new Set();
    for (const f of parsed.factions) factions.add(f.name.toLowerCase());
    for (const from in dip.byFaction) { factions.add(from); for (const to in dip.byFaction[from]) factions.add(to); }
    return { ok: true, byFaction: dip.byFaction, factions: [...factions].sort(), file: path.basename(dsPath) };
  } catch (e) { console.warn("[diplo-edit] get failed:", e && e.message); return { ok: false, error: e.message }; }
});

// Apply a batch of diplomacy edits (called on Save). edits = [{kind,from,to,value}]
// where kind ∈ core|rel|agg. Updates the matching line in place, or inserts a new
// one after that kind's section (skipping no-op core/rel inserts of 200). Backs up.
ipcMain.handle("update-core-attitudes", async (_event, edits) => {
  try {
    if (!activeModDataDir) return { ok: false, error: "no active mod" };
    if (!Array.isArray(edits) || edits.length === 0) return { ok: true, applied: 0 };
    const dsPath = findActiveDescrStratPath();
    if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
    const text = fs.readFileSync(dsPath, "utf8");
    const eol = "\r\n"; // RTW:R game text files are ALWAYS CRLF
    const lines = text.split(/\r?\n/);
    const dip = descrGen.parseDiplomacy(text);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (!_modExportDir) fs.copyFileSync(dsPath, dsPath + "." + stamp + ".bak");
    const insertsByKind = { core: [], rel: [], agg: [] };
    let applied = 0;
    for (const e of edits) {
      const kind = (e.kind === "rel" || e.kind === "agg") ? e.kind : "core";
      const from = String(e.from).toLowerCase(), to = String(e.to).toLowerCase(), val = parseInt(e.value, 10);
      if (!from || !to || Number.isNaN(val)) continue;
      const key = `${kind}|${from}|${to}`;
      const newLine = descrGen.diploLine(kind, from, to, val);
      if (dip.lineOf[key] != null) { lines[dip.lineOf[key]] = newLine; applied++; }
      else if (!((kind === "core" || kind === "rel") && val === 200)) { insertsByKind[kind].push({ at: dip.lastLine[kind] != null ? dip.lastLine[kind] : lines.length, line: newLine }); applied++; }
    }
    // Insert new lines high index → low so positions stay valid.
    const allInserts = [...insertsByKind.core, ...insertsByKind.rel, ...insertsByKind.agg].sort((a, b) => b.at - a.at);
    for (const ins of allInserts) lines.splice(ins.at + 1, 0, ins.line);
    fs.writeFileSync(modOut(dsPath), lines.join(eol), "utf8");
    console.log(`[diplo-edit] applied ${applied} diplomacy edit(s) to ${path.basename(dsPath)}; ${_modExportDir ? `exported under ${_modExportDir}` : `backup ${stamp}`}`);
    return { ok: true, applied, backupStamp: _modExportDir ? null : stamp };
  } catch (e) { console.warn("[diplo-edit] update failed:", e && e.message); return { ok: false, error: e.message }; }
});

ipcMain.handle("clear-mod-caches", async () => {
  try { _buildingRecruitsCache.clear(); } catch {}
  try { _unitOwnershipCache.clear(); } catch {}
  try { _chainLevelsCache.clear(); } catch {}
  try { _unitStatsCache.clear(); } catch {}
  try { _buildingStatsCache.clear(); } catch {}
  try { _textDictCache.clear(); } catch {}
  try { _factionCultureCache.clear(); } catch {}
  return true;
});

// IPC: wipe all persisted imported mod data + per-mod user files so the app
// falls back to its bundled defaults (vanilla Slot 2 / empty Slot 1) — a "100%
// fresh install" for testing the first-run experience. The renderer clears
// localStorage separately and reloads. Does NOT touch provincia.log.
ipcMain.handle("factory-reset", async () => {
  const ud = app.getPath("userData");
  const removed = [];
  try { fs.rmSync(path.join(ud, "campaign_data"), { recursive: true, force: true }); removed.push("campaign_data/"); } catch {}
  const files = [
    "descr_strat_original.txt", "descr_regions_original.txt",
    "faction_colors.json", "live_history.json", "devAutosaves.json",
    "welcome_version.txt", "onboarding_done.txt",
  ];
  for (const f of files) {
    try { if (fs.existsSync(path.join(ud, f))) { fs.rmSync(path.join(ud, f), { force: true }); removed.push(f); } } catch {}
  }
  try { for (const c of _factionCultureCache ? [_factionCultureCache] : []) c.clear(); } catch {}
  console.log("[factory-reset] removed:", removed.join(", "));
  return { ok: true, removed };
});

// IPC: return mtimes for the mod data files we care about. Renderer
// polls this periodically; if any mtime is newer than what it last
// saw, a "reload mod data" badge flashes so the modder knows their
// edit is unseen by Provincia until they reload.
ipcMain.handle("get-mod-file-mtimes", async (_event, modDataDir) => {
  const files = [
    "export_descr_buildings.txt",
    "export_descr_unit.txt",
    "text/export_units.txt",
    "text/export_buildings.txt",
    "descr_sm_factions.txt",
    "world/maps/base/descr_regions.txt",
  ];
  const out = {};
  const tryFile = (full) => {
    try { return fs.statSync(full).mtimeMs; } catch { return null; }
  };
  for (const rel of files) {
    let mtime = null;
    if (modDataDir) {
      const t = tryFile(path.join(modDataDir, rel));
      if (t != null) mtime = t;
    }
    out[rel] = mtime;
  }
  return out;
});

// IPC: return per-level building stats from export_descr_buildings.txt.
// Parses the block for `building <chainName> { ... <levelName> requires ...
// { ... } }` and pulls out:
//   - cost                — gold to construct
//   - construction        — turns to construct
//   - settlement_min      — min settlement tier
//   - capabilities        — every non-recruit capability line (happiness,
//                           gdp, farming_level, archer_bonus, walls, etc.)
// Recruits live in their own IPC (get-building-recruits) and are excluded
// here so the popup doesn't double-show them.
const _buildingStatsCache = new Map();
ipcMain.handle("get-building-stats", async (_event, modDataDir, levelName, chainName) => {
  if (!levelName || !chainName) return null;
  const cacheKey = (modDataDir || "") + "|" + chainName + "|" + levelName;
  if (_buildingStatsCache.has(cacheKey)) return _buildingStatsCache.get(cacheKey);
  const sources = getEdbSourceFiles(modDataDir, "export_descr_buildings.txt");
  // Mod-first: reverse so the override wins on first match.
  for (const src of sources.slice().reverse()) {
    if (!fs.existsSync(src)) continue;
    let text;
    try {
      const buf = fs.readFileSync(src);
      text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le", 2) : buf.toString("utf8");
    } catch { continue; }
    const lines = text.split(/\r?\n/);
    const stripComments = (s) => { const idx = s.indexOf(";"); return idx >= 0 ? s.slice(0, idx) : s; };
    let i = 0;
    const chainRe = new RegExp(`^\\s*building\\s+${chainName}\\b`);
    while (i < lines.length && !chainRe.test(lines[i])) i++;
    if (i >= lines.length) continue;
    // Capture the chain's `levels` list — the canonical tier ladder.
    let chainLadder = null;
    for (let j = i + 1; j < Math.min(i + 80, lines.length); j++) {
      const t = stripComments(lines[j]).trim();
      if (!t || t === "{" || t === "}") continue;
      const lm = t.match(/^levels\s+(.+)$/);
      if (lm) { chainLadder = lm[1].trim().split(/\s+/).filter(Boolean); break; }
      if (/^building\b/.test(t)) break;
    }
    // Find the level header inside the chain block.
    const levelRe = new RegExp(`^\\s*${levelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+requires\\b`);
    while (i < lines.length && !levelRe.test(lines[i])) i++;
    if (i >= lines.length) continue;
    i++;
    // Walk to the level body's opening brace.
    while (i < lines.length && stripComments(lines[i]).trim() !== "{") i++;
    if (i >= lines.length) continue;
    i++;
    // Extract everything inside the level body using brace balance.
    let depth = 1;
    const body = [];
    while (i < lines.length && depth > 0) {
      const raw = lines[i];
      for (const ch of raw) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      if (depth > 0) body.push(raw);
      i++;
    }
    // Parse the body.
    let cost = null, construction = null, settlementMin = null;
    const capabilities = [];
    const recruits = []; // { unit, requires } — what THIS level adds
    let inCap = false, capDepth = 0;
    // RIS (and most modern RTW mods) use the `dummy <key> bonus N
    // [requires ...]` capability syntax. The engine ignores `dummy`
    // at runtime, but the building browser displays the human string
    // keyed by `<key>` in text/expanded_bi.txt. Resolve those keys
    // server-side so the popup shows what the in-game UI would show.
    const expandedDict = getMergedTextDictionary(modDataDir, "text/expanded_bi.txt");
    for (const raw of body) {
      const s = stripComments(raw).trim();
      if (!s) continue;
      if (!inCap) {
        if (/^capability\b/.test(s)) { inCap = true; capDepth = 0; continue; }
        const cm = s.match(/^cost\s+(\d+)/);
        if (cm) { cost = parseInt(cm[1], 10); continue; }
        const tm = s.match(/^construction\s+(\d+)/);
        if (tm) { construction = parseInt(tm[1], 10); continue; }
        const sm = s.match(/^settlement_min\s+(\S+)/);
        if (sm) { settlementMin = sm[1]; continue; }
      } else {
        for (const ch of s) {
          if (ch === "{") capDepth++;
          else if (ch === "}") { capDepth--; if (capDepth <= 0) { inCap = false; capDepth = 0; } }
        }
        if (s === "{" || s === "}") continue;
        const rm = s.match(/^recruit\s+"([^"]+)"\s*(?:\d+)?(?:\s+requires\s+(.+))?$/);
        if (rm) { recruits.push({ unit: rm[1], requires: rm[2] || null }); continue; }
        // Try to resolve a dummy-capability key against expanded_bi.txt.
        // Format: `dummy <key> bonus <N> [requires ...]`. Some mods also
        // omit `bonus` for boolean-flag style keys.
        const dm = s.match(/^dummy\s+(\S+)(?:\s+bonus\s+(-?\d+))?(?:\s+requires\s+(.+))?$/);
        let resolved = null;
        if (dm) {
          const key = dm[1];
          const bonus = dm[2] != null ? parseInt(dm[2], 10) : null;
          const text = expandedDict[key];
          if (text) {
            resolved = bonus != null ? `${text} (×${bonus})` : text;
          }
        }
        capabilities.push({ raw: s, resolved });
      }
    }
    const tierIndex = chainLadder ? chainLadder.indexOf(levelName) : -1;
    const result = {
      cost, construction, settlementMin,
      capabilities,
      recruits,
      chainLadder,
      tierIndex,
      tierMax: chainLadder ? chainLadder.length : null,
    };
    _buildingStatsCache.set(cacheKey, result);
    return result;
  }
  _buildingStatsCache.set(cacheKey, null);
  return null;
});

// IPC: return long-form building description from text/export_buildings.txt.
// RTW keys these by level NAME with `_desc` / `_desc_short` suffixes (note:
// units use `_descr` / `_descr_short` — buildings drop the second `r`).
// Culture variants are common: `{governors_house_barbarian_desc}` etc., so
// we try `<level>_<culture>` → `<level>` → `<chain>_<culture>` → `<chain>`
// for the displayName, and the `_desc`/`_desc_short` siblings of whichever
// key resolves first. This matches the in-game lookup order.
ipcMain.handle("get-building-description", async (_event, modDataDir, levelName, chainName, culture) => {
  if (!levelName && !chainName) return null;
  const dict = getMergedTextDictionary(modDataDir, "text/export_buildings.txt");
  const candidates = [];
  for (const base of [levelName, chainName].filter(Boolean)) {
    if (culture) candidates.push(base + "_" + culture);
    candidates.push(base);
  }
  for (const key of candidates) {
    const displayName = dict[key];
    const short = dict[key + "_desc_short"];
    const long = dict[key + "_desc"];
    if (displayName || short || long) {
      return { displayName: displayName || null, short: short || null, long: long || null };
    }
  }
  return null;
});

// IPC: return the merged building display-name map from the mod + game
// export_buildings.txt files. Format: { "<levelname>": "Display Name",
// "<levelname>_<culture>": "Culture-Specific Name" }.
// Caller should look up `<level>_<culture>` first, then `<level>`, then the
// bundled fallback.
// IPC: parse export_descr_buildings.txt from the mod + game installs and
// return the chain → [level1, level2, …] map. This is the source of truth
// for building tiers — the `levels` line inside `building <chainName> { … }`
// lists the ladder in order, so the 1-based index is the tier. Last-wins
// merge (mod wins over game; Alex wins over BI wins over vanilla).
const _chainLevelsCache = new Map();
ipcMain.handle("get-building-chain-levels", async (_event, modDataDir) => {
  const cacheKey = modDataDir || "";
  if (_chainLevelsCache.has(cacheKey)) return _chainLevelsCache.get(cacheKey);
  const map = {};
  const sources = getEdbSourceFiles(modDataDir, "export_descr_buildings.txt");
  const stripComments = (line) => {
    // Strip `;...` (comment to EOL) but leave quoted content alone — EDB uses
    // `;` for comments; no multi-line comments to worry about.
    const i = line.indexOf(";");
    return i >= 0 ? line.slice(0, i) : line;
  };
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const buf = fs.readFileSync(src);
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      const lines = text.split(/\r?\n/);
      let curChain = null;
      for (let i = 0; i < lines.length; i++) {
        const raw = stripComments(lines[i]).trim();
        if (!raw) continue;
        // `building <chainName>` begins a new chain block.
        const cm = raw.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
        if (cm) { curChain = cm[1]; continue; }
        if (!curChain) continue;
        // `levels level_a level_b level_c …` — space-separated, optional
        // trailing `{`. Can appear on its own line; sometimes followed by `{`
        // on the next line.
        const lm = raw.match(/^levels\s+(.+?)\s*\{?\s*$/);
        if (lm) {
          const levels = lm[1].split(/\s+/).filter(Boolean);
          if (levels.length > 0) map[curChain] = levels;
          curChain = null; // one levels line per chain
        }
      }
    } catch (e) { console.warn("[chain-levels]", src, e.message); }
  }
  _chainLevelsCache.set(cacheKey, map);
  return map;
});

// IPC: parse export_descr_unit.txt for unit → list of factions that own it.
// Alex's EDB allows units broadly per-building-level, but EDU's ownership
// line is the ground truth for "can this faction actually recruit this unit".
//
// Returns { unitName: [faction, ...] } as before, but also injects a special
// key `__dictionary` mapping unitName → dictionary (icon basename). AOR units
// have type "aor X Y" but icons are keyed by dictionary "X_Y" — the renderer
// uses this to resolve the right icon path.
const _unitOwnershipCache = new Map();
// Locate a building chain in export_descr_buildings.txt and a unit type in
// export_descr_unit.txt. Returns the absolute path + 1-based line number.
// Used by the dev right-click "Show in EDB / EDU" menu items.
function _findInFile(srcPath, regex) {
  if (!srcPath || !fs.existsSync(srcPath)) return null;
  try {
    const buf = fs.readFileSync(srcPath);
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) return { path: srcPath, line: i + 1 };
    }
  } catch {}
  return null;
}
function _firstExisting(modDataDir, fileName) {
  if (modDataDir) {
    const p = path.join(modDataDir, fileName);
    if (fs.existsSync(p)) return p;
  }
  for (const d of (findRelatedModDirs ? findRelatedModDirs(modDataDir, fileName) : [])) {
    const p = path.join(d, fileName);
    if (fs.existsSync(p)) return p;
  }
  for (const root of getIconSearchRoots()) {
    const p = path.join(root, fileName);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
ipcMain.handle("find-edb-chain", async (_event, modDataDir, chainName) => {
  if (!chainName) return null;
  const src = _firstExisting(modDataDir, "export_descr_buildings.txt");
  return _findInFile(src, new RegExp(`^\\s*building\\s+${chainName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "m"))
    || (src ? { path: src, line: 1 } : null);
});
ipcMain.handle("find-edu-type", async (_event, modDataDir, unitType) => {
  if (!unitType) return null;
  const src = _firstExisting(modDataDir, "export_descr_unit.txt");
  // EDU `type` lines aren't quoted; match exactly.
  return _findInFile(src, new RegExp(`^\\s*type\\s+${unitType.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*$`))
    || (src ? { path: src, line: 1 } : null);
});
// Open a source file at a line. Prefers Notepad++ when installed (has line-
// jump via -n<line>), falls back to plain Notepad (no line jump). Both are
// spawned detached so closing them doesn't take Provincia with them.
const _NPP_PATHS = [
  "C:\\Program Files\\Notepad++\\notepad++.exe",
  "C:\\Program Files (x86)\\Notepad++\\notepad++.exe",
];
function _findNotepadPP() {
  for (const p of _NPP_PATHS) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}
ipcMain.handle("open-source-file", async (_event, filePath, line) => {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, reason: "missing" };
  const { spawn } = require("child_process");
  const npp = _findNotepadPP();
  try {
    if (npp) {
      const args = [];
      if (line && Number.isFinite(line)) args.push(`-n${line}`);
      args.push(filePath);
      const child = spawn(npp, args, { detached: true, stdio: "ignore" });
      child.unref();
      return { ok: true, via: "notepad++" };
    }
    // Notepad has no line-jump flag; just open the file.
    const child = spawn("notepad.exe", [filePath], { detached: true, stdio: "ignore" });
    child.unref();
    return { ok: true, via: "notepad" };
  } catch (e) {
    // Last-ditch: hand off to the OS default.
    try { await shell.openPath(filePath); return { ok: true, via: "default" }; }
    catch (e2) { return { ok: false, reason: e.message + " / " + e2.message }; }
  }
});

ipcMain.handle("get-unit-ownership", async (_event, modDataDir) => {
  const cacheKey = modDataDir || "";
  if (_unitOwnershipCache.has(cacheKey)) return _unitOwnershipCache.get(cacheKey);
  const out = {}; // { unitName: [faction, ...] }
  const dictByType = {}; // { unitName: dictionary }
  const sources = getEdbSourceFiles(modDataDir, "export_descr_unit.txt");
  const stripComments = (line) => { const i = line.indexOf(";"); return i >= 0 ? line.slice(0, i) : line; };
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const buf = fs.readFileSync(src);
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      const lines = text.split(/\r?\n/);
      let curUnit = null;
      for (const rawLine of lines) {
        const s = stripComments(rawLine).trim();
        if (!s) continue;
        const tm = s.match(/^type\s+(.+)$/);
        if (tm) { curUnit = tm[1].trim(); continue; }
        if (!curUnit) continue;
        const dm = s.match(/^dictionary\s+(.+)$/);
        if (dm) {
          dictByType[curUnit] = dm[1].trim();
          continue;
        }
        const om = s.match(/^ownership\s+(.+)$/);
        if (om) {
          const owners = om[1].split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
          if (owners.length > 0) out[curUnit] = owners;
          curUnit = null;
        }
      }
    } catch (e) { console.warn("[unit-ownership]", src, e.message); }
  }
  out.__dictionary = dictByType;
  _unitOwnershipCache.set(cacheKey, out);
  return out;
});

// IPC: parse the full stat block for a single unit from
// export_descr_unit.txt. Returns the most useful in-game numbers in a
// flat object so InfoPopup can show them next to the unit-info art.
// Cached per (modDataDir, unitName).
const _unitStatsCache = new Map();
ipcMain.handle("get-unit-stats", async (_event, modDataDir, unitName) => {
  if (!unitName) return null;
  const target = String(unitName).toLowerCase();
  const cacheKey = (modDataDir || "") + "|" + target;
  if (_unitStatsCache.has(cacheKey)) return _unitStatsCache.get(cacheKey);
  const sources = getEdbSourceFiles(modDataDir, "export_descr_unit.txt");
  const stripComments = (line) => { const i = line.indexOf(";"); return i >= 0 ? line.slice(0, i) : line; };
  // Mod-last-wins: keep parsing all sources; the last block found for the
  // target unit name wins (mods override vanilla stats).
  let stats = null;
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const buf = fs.readFileSync(src);
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      const lines = text.split(/\r?\n/);
      let curUnit = null;
      let block = null;
      for (const rawLine of lines) {
        const s = stripComments(rawLine).trim();
        if (!s) continue;
        const tm = s.match(/^type\s+(.+)$/);
        if (tm) {
          if (curUnit === target && block) stats = block;
          curUnit = tm[1].trim().toLowerCase();
          block = (curUnit === target) ? { name: curUnit } : null;
          continue;
        }
        if (!block) continue;
        // Capture the rest of the line after the keyword for each stat.
        const m = s.match(/^(\w+)\s+(.+)$/);
        if (!m) continue;
        const key = m[1].toLowerCase();
        const val = m[2].trim();
        if (key === "soldier") {
          // soldier <type>, <count>, <officers?>, <mass>
          const p = val.split(",").map(x => x.trim());
          block.soldierCount = parseInt(p[1]) || 0;
          block.soldierMass = parseFloat(p[3]) || 0;
        } else if (key === "officer") {
          block.officers = (block.officers || 0) + 1;
        } else if (key === "category") block.category = val;
        else if (key === "class") block.classType = val;
        else if (key === "stat_health") {
          const p = val.split(",").map(x => parseInt(x.trim()));
          block.hp = p[0] || 1;
          block.mountHp = p[1] || 0;
        } else if (key === "stat_pri") {
          // stat_pri <attack>, <charge_bonus>, <missile>, <range>, <ammo>, <weapon_type>, <ap?>, <skill>, <sound>, <delay>
          const p = val.split(",").map(x => x.trim());
          block.priAttack = parseInt(p[0]);
          block.priCharge = parseInt(p[1]);
          block.priMissile = p[2] || "";
          // Range / ammo are only meaningful for missile units; non-missile
          // units leave them as 0 in EDU and we want to render "Missile Range"
          // / "Ammo" bars as empty rather than mid-value bars.
          block.priRange = parseInt(p[3]) || 0;
          block.priAmmo = parseInt(p[4]) || 0;
          block.priWeapon = p[5] || "";
        } else if (key === "stat_sec") {
          const p = val.split(",").map(x => x.trim());
          if (p[2] && p[2] !== "no") {
            block.secAttack = parseInt(p[0]);
            block.secCharge = parseInt(p[1]);
            block.secMissile = p[2] || "";
            block.secRange = parseInt(p[3]) || 0;
            block.secAmmo = parseInt(p[4]) || 0;
            block.secWeapon = p[5] || "";
          }
        } else if (key === "stat_pri_armour") {
          const p = val.split(",").map(x => x.trim());
          block.armour = parseInt(p[0]);
          block.defenseSkill = parseInt(p[1]);
          block.shield = parseInt(p[2]);
        } else if (key === "stat_mental") {
          const p = val.split(",").map(x => x.trim());
          block.morale = parseInt(p[0]);
          block.discipline = p[1] || "";
        } else if (key === "stat_charge_dist") block.chargeDist = parseInt(val);
        else if (key === "stat_cost") {
          const p = val.split(",").map(x => parseInt(x.trim()));
          block.recruitTurns = p[0];
          block.recruitCost = p[1];
          block.upkeep = p[2];
        } else if (key === "stat_food") {
          const p = val.split(",").map(x => parseInt(x.trim()));
          block.foodCost = p[0];
        } else if (key === "stat_stl") {
          // stat_stl <men>,<turns> — replenishment per turn
          block.replenishMen = parseInt((val.split(",")[0] || "0").trim());
        } else if (key === "attributes") block.attributes = val;
        else if (key === "formation") block.formation = val;
        else if (key === "armour_ug_levels") block.armourUpgrades = val;
        else if (key === "weapon_lvl") block.weaponLvl = parseInt(val);
        else if (key === "voice_type") block.voiceType = val;
        else if (key === "category") block.category = val;
        else if (key === "ownership") block.owners = val.split(",").map(x => x.trim());
      }
      if (curUnit === target && block) stats = block;
    } catch (e) { console.warn("[unit-stats]", src, e.message); }
  }
  _unitStatsCache.set(cacheKey, stats);
  return stats;
});

// 0.9.860: bulk EDU upkeep map for the economy/Financial-Overview feature.
// Parses export_descr_unit.txt ONCE into { <unit type name>: upkeep } (the
// stat_cost 3rd field — same value the per-unit get-unit-stats returns as
// block.upkeep). Cached per modDataDir. Used to compute a faction's total
// per-turn unit upkeep = Σ over its units of upkeep[unit.name]. Mod-last-wins
// so RIS overrides vanilla. Returns {} on failure (caller shows "—", never 0).
const _unitUpkeepMapCache = new Map();
function getUnitUpkeepMap(modDataDir) {
  const cacheKey = modDataDir || "";
  if (_unitUpkeepMapCache.has(cacheKey)) return _unitUpkeepMapCache.get(cacheKey);
  const map = {};
  const sources = getEdbSourceFiles(modDataDir, "export_descr_unit.txt");
  const stripComments = (line) => { const i = line.indexOf(";"); return i >= 0 ? line.slice(0, i) : line; };
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const buf = fs.readFileSync(src);
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      let curUnit = null;
      for (const rawLine of text.split(/\r?\n/)) {
        const s = stripComments(rawLine).trim();
        if (!s) continue;
        const tm = s.match(/^type\s+(.+)$/);
        if (tm) { curUnit = tm[1].trim().toLowerCase(); continue; }
        if (!curUnit) continue;
        const cm = s.match(/^stat_cost\s+(.+)$/i);
        if (cm) {
          const p = cm[1].split(",").map((x) => parseInt(x.trim(), 10));
          if (p.length >= 3 && Number.isFinite(p[2])) map[curUnit] = p[2]; // mod-last-wins
        }
      }
    } catch (e) { console.warn("[unit-upkeep-map]", src, e.message); }
  }
  _unitUpkeepMapCache.set(cacheKey, map);
  return map;
}
ipcMain.handle("get-unit-upkeep-map", async (_event, modDataDir) => getUnitUpkeepMap(modDataDir));

// IPC: parse recruit capabilities from EDB. Inside each level's block:
//   <level> requires factions { … } {
//     capability { recruit "unit name" <tier>  [requires factions { … }] }
//   }
// We return {<chainName>: {<levelName>: [{unit, factions?}, …]}} so the
// renderer can intersect the recruit list with the settlement's faction.
const _buildingRecruitsCache = new Map();
ipcMain.handle("get-building-recruits", async (_event, modDataDir) => {
  const cacheKey = modDataDir || "";
  if (_buildingRecruitsCache.has(cacheKey)) return _buildingRecruitsCache.get(cacheKey);
  const out = {};
  const sources = getEdbSourceFiles(modDataDir, "export_descr_buildings.txt");
  const stripComments = (line) => {
    const i = line.indexOf(";");
    return i >= 0 ? line.slice(0, i) : line;
  };
  // Parse ALIAS definitions in EDB so the renderer can evaluate
  // tier-style requirements (mic_tier_2, gov_tier_1, colony_tier_1, etc.)
  // against the city's actually-built buildings instead of blanket-
  // dropping recruits that mention them. Each alias maps to one or more
  // [chain, minLevel] clauses ORed together.
  const aliases = {};
  // LAST-WINS per (chain, level): each source overwrites any recruit list
  // a prior source had for the same chain+level. Crucially this also
  // applies when the mod redefines a level with ZERO recruit lines (RIS
  // strips peasants from governors_villa by leaving the recruit list out
  // entirely) — without that, vanilla's recruits leaked through.
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    const local = {}; // chain → level → [recruits] (may be empty array)
    const definedLevels = new Set(); // "chain|level" the source touched at all
    try {
      const buf = fs.readFileSync(src);
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      const lines = text.split(/\r?\n/);
      // First pass: capture aliases.
      {
        let curAlias = null, curReq = "";
        for (const rawLine of lines) {
          const r = stripComments(rawLine).trim();
          if (!r) continue;
          const am = r.match(/^alias\s+(\w+)/);
          if (am) { curAlias = am[1]; curReq = ""; continue; }
          if (curAlias) {
            const rm = r.match(/^requires\s+(.+)$/);
            if (rm) curReq = rm[1].trim();
            if (r === "}") {
              if (curReq) {
                // Split on `or` — each branch is one OR clause.
                const branches = curReq.split(/\s+or\s+/);
                const out2 = [];
                for (const b of branches) {
                  const m2 = b.match(/building_present_min_level\s+(\S+)\s+(\S+)/);
                  if (m2) { out2.push({ chain: m2[1], level: m2[2] }); continue; }
                  // Bare `building_present X` (no level) — chain at ANY level
                  // satisfies. Captured with level=null, evaluated as wildcard
                  // in the renderer's hasMinLevel.
                  const m3 = b.match(/^\s*building_present\s+(\S+)\s*$/);
                  if (m3) out2.push({ chain: m3[1], level: null });
                }
                if (out2.length > 0) aliases[curAlias] = out2;
              }
              curAlias = null; curReq = "";
            }
          }
        }
      }
      let curChain = null, curLevel = null, inCapability = false, depth = 0;
      for (let i = 0; i < lines.length; i++) {
        const raw = stripComments(lines[i]).trim();
        if (!raw) continue;
        const cm = raw.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
        if (cm) { curChain = cm[1]; curLevel = null; inCapability = false; depth = 0; continue; }
        if (!curChain) continue;
        const lm = raw.match(/^([a-z_][a-z0-9_]*(?:\+\d+)?)\s+requires\b/);
        if (lm && !inCapability) {
          curLevel = lm[1];
          definedLevels.add(curChain + "|" + curLevel);
          if (!local[curChain]) local[curChain] = {};
          if (!local[curChain][curLevel]) local[curChain][curLevel] = [];
          continue;
        }
        if (raw === "capability" && curLevel) { inCapability = true; continue; }
        if (inCapability) {
          if (raw.startsWith("{")) { depth++; continue; }
          if (raw.startsWith("}")) { depth--; if (depth <= 0) { inCapability = false; depth = 0; } continue; }
          const rm = raw.match(/^recruit\s+"([^"]+)"/);
          if (rm) {
            const fm = raw.match(/requires\s+factions\s*\{\s*([^}]*)\}/);
            const factions = fm ? fm[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : null;
            // Capture the FULL requires clause so the renderer can evaluate
            // additional constraints (major_event, hidden_resource, mic_tier_X,
            // etc.) and avoid showing recruits the player can't actually train.
            const ridx = raw.indexOf("requires");
            const requires = ridx >= 0 ? raw.slice(ridx + "requires".length).trim() : null;
            local[curChain][curLevel].push({ unit: rm[1], factions, requires });
          }
        }
      }
    } catch (e) { console.warn("[building-recruits]", src, e.message); continue; }
    // Merge: every (chain, level) the source DEFINED replaces whatever was
    // in `out` — including replacing-with-empty (RIS removes peasants from
    // governors_villa by defining the level with no recruit lines).
    for (const key of definedLevels) {
      const [chain, lvl] = key.split("|");
      if (!out[chain]) out[chain] = {};
      out[chain][lvl] = (local[chain] && local[chain][lvl]) || [];
    }
  }
  // Stash aliases on the recruits object — the renderer pulls both via
  // the same IPC. Using a non-conflicting key (chain names never start
  // with `__`).
  out.__aliases = aliases;
  _buildingRecruitsCache.set(cacheKey, out);
  return out;
});

const _buildingDisplayCache = makeLRU(16); // modDataDir → parsed map
ipcMain.handle("get-building-display-names", async (_event, modDataDir) => {
  const cacheKey = modDataDir || "";
  if (_buildingDisplayCache.has(cacheKey)) return _buildingDisplayCache.get(cacheKey);
  const map = {};
  // Load order matters: LAST source overwrites earlier ones. We want:
  //   game defaults (loaded FIRST, become base) ← parent mod ← submod (LAST = wins)
  // so mod overrides the vanilla/Alexander defaults.
  const sources = [];
  // 1. Game installs first (base defaults).
  for (const root of getIconSearchRoots()) {
    sources.push(path.join(root, "text", "export_buildings.txt"));
  }
  // 2. Then mod dirs. findRelatedModDirs returns innermost-first (submod,
  // then parent). Reverse so submod is loaded LAST and its entries win.
  for (const d of findRelatedModDirs(modDataDir, "text/export_buildings.txt").reverse()) {
    sources.push(path.join(d, "text", "export_buildings.txt"));
  }
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const buf = fs.readFileSync(src);
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\{([^}]+)\}\s*(.+)$/);
        if (!m) continue;
        const key = m[1].trim();
        const value = m[2].trim();
        if (!value) continue;
        if (key.endsWith("_desc") || key.endsWith("_desc_short")) continue;
        // LAST entry in the file wins. Alexander's expanded_bi.txt contains
        // generic defaults at the top and Alexander-specific overrides below
        // an "ALEXANDER TEXT BEGINS HERE" marker — those overrides need to
        // take precedence (PARTHIA → Persia, GERMANS → Illyria, etc.).
        map[key] = value;
      }
    } catch (e) { console.warn("[display-names]", src, e.message); }
  }
  _buildingDisplayCache.set(cacheKey, map);
  return map;
});

// Parse `descr_ui_buildings.txt` — the authoritative file RTW uses for
// icon lookup. Contains a single `lookup_variants { ... }` block with two
// kinds of space-separated pairs inside:
//   1. Culture fallback chain: `<culture_without_art> <fallback_culture>`
//      e.g., `roman eastern` → when roman art missing, try eastern first.
//      Multiple entries per culture define order of preference.
//   2. Level-name alias: `<mod_level> <vanilla_level>`
//      e.g., `temple_of_battle_shrine shrine` → use the `shrine` icon.
// Returned shape: { cultureFallbacks: { roman: [eastern, greek, ...], ... },
//                   levelAliases: { temple_of_battle_shrine: "shrine", ... } }
// Directory-listing cache for icon resolution (2026-07-15). The icon resolver
// probes the same ~40 candidate dirs for EVERY icon; with fs.existsSync per
// candidate file that was hundreds of thousands of syscalls when warming ~900
// icons (the startup icon-lag bottleneck on Windows, where existsSync is slow).
// Instead we readdir each dir ONCE and answer file lookups from an in-memory
// Map<lowercased filename → actual filename> (Windows FS is case-insensitive,
// so this matches the resolver's multi-casing attempts exactly). Cleared for a
// dir after an icon is written there (replace/revert), and wholesale on mod
// switch, so freshly-dropped icons still resolve.
// Singleton over node fs; logic + tests live in src/iconDirCache.js.
const _iconDirCache = require("./src/iconDirCache.js").createIconDirCache(fs);
const iconDirFiles = (dir) => _iconDirCache.files(dir);
const clearIconDirCache = (dir) => _iconDirCache.clear(dir);

const _uiBuildingsCache = makeLRU(16);
function parseDescrUiBuildings(modDataDir) {
  const cacheKey = modDataDir || "";
  if (_uiBuildingsCache.has(cacheKey)) return _uiBuildingsCache.get(cacheKey);
  const sources = [];
  // Vanilla/Alexander first so mod entries override via last-wins.
  for (const root of getIconSearchRoots()) sources.push(path.join(root, "descr_ui_buildings.txt"));
  for (const d of findRelatedModDirs(modDataDir, "descr_ui_buildings.txt").reverse()) {
    sources.push(path.join(d, "descr_ui_buildings.txt"));
  }
  const cultureFallbacks = {};
  const levelAliases = {};
  // Known RTW culture folder names — used to distinguish culture-fallback
  // pairs from level-alias pairs. A pair is a culture fallback only when
  // BOTH tokens are known cultures.
  const CULTURES = new Set([
    "roman", "greek", "eastern", "egyptian", "barbarian", "carthaginian",
    "nomad", "parthian", "scythian", "german",
    "e_hellenistic", "w_hellenistic",
    "anatolian", "arab", "brittonic", "celtiberian", "dacian", "ethiopian",
    "germanic", "iberian", "illyrian", "indian", "iranian", "libyan",
    "thracian",
  ]);
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const text = fs.readFileSync(src, "utf8");
      let inBlock = false;
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/;.*$/, "").trim();
        if (!line) continue;
        if (line === "lookup_variants") { inBlock = true; continue; }
        if (line === "{") continue;
        if (line === "}") { inBlock = false; continue; }
        if (!inBlock) continue;
        const parts = line.split(/\s+/);
        if (parts.length < 2) continue;
        const from = parts[0].toLowerCase();
        const to = parts[1].toLowerCase();
        if (CULTURES.has(from) && CULTURES.has(to)) {
          if (!cultureFallbacks[from]) cultureFallbacks[from] = [];
          if (!cultureFallbacks[from].includes(to)) cultureFallbacks[from].push(to);
        } else {
          levelAliases[from] = to;
        }
      }
    } catch {}
  }
  const result = { cultureFallbacks, levelAliases };
  _uiBuildingsCache.set(cacheKey, result);
  return result;
}

// Core icon resolver (synchronous file lookups). Extracted from the IPC
// handler so the single AND bulk handlers share one implementation. Returns
// { buffer, path, mime } or null.
function resolveBuildingIconCore(modDataDir, culture, levelName, chainName) {
  if (!culture || !levelName) return null;
  const c = String(culture).toLowerCase();
  const l = String(levelName).toLowerCase();
  const { cultureFallbacks, levelAliases } = parseDescrUiBuildings(modDataDir);
  // RTW convention: for chains like `temple_of_zoroaster_shrine`, the game
  // uses a shared icon keyed by the chain suffix (`shrine`) — there is no
  // `#eastern_temple_of_zoroaster_shrine.tga`, only `#eastern_shrine.tga`.
  // Generate progressively shorter suffixes by trimming tokens from the
  // left; the full name is still tried first.
  const levelTokens = l.split("_");
  const levelCandidates = [];
  for (let start = 0; start < levelTokens.length; start++) {
    const suffix = levelTokens.slice(start).join("_");
    if (suffix && !levelCandidates.includes(suffix)) levelCandidates.push(suffix);
  }
  // `descr_ui_buildings.txt` aliases mod level names to vanilla ones
  // (e.g., temple_of_battle_shrine → shrine). Walk the alias chain so
  // transitive aliases resolve.
  if (levelAliases) {
    let cur = l;
    const seen = new Set([cur]);
    for (let i = 0; i < 8; i++) {
      const next = levelAliases[cur];
      if (!next || seen.has(next)) break;
      if (!levelCandidates.includes(next)) levelCandidates.push(next);
      // Also add trimmed suffixes of the alias so `temple_of_battle_shrine`
      // → `shrine` picks up `#<c>_shrine.tga` directly.
      const aliasTokens = next.split("_");
      for (let s = 1; s < aliasTokens.length; s++) {
        const suf = aliasTokens.slice(s).join("_");
        if (suf && !levelCandidates.includes(suf)) levelCandidates.push(suf);
      }
      seen.add(next);
      cur = next;
    }
  }
  // The game ships two TGA variants per building:
  //   - `#<c>_<l>.tga`                (~156×124) — small square icon for UI lists
  //   - `#<c>_<l>_constructed.tga`    (~361×163) — WIDE banner for the detail
  //     panel. Squashed into a 52×52 square, a banner looks wrong.
  // Resolver priority: icons first, THEN banners as a last-resort visual.
  const dirs = [];
  if (modDataDir && fs.existsSync(modDataDir)) {
    dirs.push(path.join(modDataDir, "ui", c, "buildings"));
    dirs.push(path.join(modDataDir, "ui", c, "buildings", "construction"));
    // `plugins/` holds vanilla-era icons that RTW:R never merged into
    // `buildings/` — treasury tiers, aqueducts, shrines, etc.
    dirs.push(path.join(modDataDir, "ui", c, "plugins"));
    // `construction/` (peer of `buildings/`, not the nested one) is where
    // some per-culture icons live. E.g. greek market lives at
    // ui/greek/construction/#greek_market.tga instead of
    // ui/greek/buildings/. Still the same culture's own art — not a
    // cross-culture fallback.
    dirs.push(path.join(modDataDir, "ui", c, "construction"));
  }
  for (const root of getIconSearchRoots()) {
    dirs.push(path.join(root, "ui", c, "buildings"));
    dirs.push(path.join(root, "ui", c, "buildings", "construction"));
    dirs.push(path.join(root, "ui", c, "plugins"));
    dirs.push(path.join(root, "ui", c, "construction"));
  }
  const romanDirs = [];
  if (c !== "roman") {
    if (modDataDir && fs.existsSync(modDataDir)) {
      romanDirs.push(path.join(modDataDir, "ui", "roman", "buildings"));
      romanDirs.push(path.join(modDataDir, "ui", "roman", "buildings", "construction"));
      romanDirs.push(path.join(modDataDir, "ui", "roman", "plugins"));
      romanDirs.push(path.join(modDataDir, "ui", "roman", "construction"));
    }
    for (const root of getIconSearchRoots()) {
      romanDirs.push(path.join(root, "ui", "roman", "buildings"));
      romanDirs.push(path.join(root, "ui", "roman", "buildings", "construction"));
      romanDirs.push(path.join(root, "ui", "roman", "plugins"));
      romanDirs.push(path.join(root, "ui", "roman", "construction"));
    }
  }
  // Cross-culture fallback — use the order declared in
  // `descr_ui_buildings.txt` lookup_variants (e.g., `roman eastern / roman
  // greek / roman egyptian`). This matches the game's own preference order
  // per culture. Falls back to a sensible default if the file is missing.
  const declaredOrder = (cultureFallbacks && cultureFallbacks[c]) || [];
  const FALLBACK_CULTURES = declaredOrder.length ? declaredOrder : [
    "greek", "e_hellenistic", "w_hellenistic", "barbarian", "carthaginian",
    "eastern", "egyptian", "iberian", "celtiberian", "thracian", "dacian",
    "scythian", "iranian", "anatolian", "germanic", "brittonic", "illyrian",
    "arab", "indian", "ethiopian", "libyan",
  ];
  const otherCultureDirs = [];
  for (const oc of FALLBACK_CULTURES) {
    if (oc === c || oc === "roman") continue;
    if (modDataDir && fs.existsSync(modDataDir)) {
      otherCultureDirs.push({ culture: oc, dir: path.join(modDataDir, "ui", oc, "buildings") });
      otherCultureDirs.push({ culture: oc, dir: path.join(modDataDir, "ui", oc, "buildings", "construction") });
      otherCultureDirs.push({ culture: oc, dir: path.join(modDataDir, "ui", oc, "plugins") });
      otherCultureDirs.push({ culture: oc, dir: path.join(modDataDir, "ui", oc, "construction") });
    }
    for (const root of getIconSearchRoots()) {
      otherCultureDirs.push({ culture: oc, dir: path.join(root, "ui", oc, "buildings") });
      otherCultureDirs.push({ culture: oc, dir: path.join(root, "ui", oc, "buildings", "construction") });
      otherCultureDirs.push({ culture: oc, dir: path.join(root, "ui", oc, "plugins") });
      otherCultureDirs.push({ culture: oc, dir: path.join(root, "ui", oc, "construction") });
    }
  }
  // Vanilla ships identical placeholder TGAs under `ui/<non-roman>/plugins/`
  // for chains it doesn't have proper per-culture art for (paved_roads,
  // mines, treasury, roads, etc — all 2567 bytes, same MD5). It also ships
  // small ~78×62 "construction-queue thumbnail" variants under
  // `ui/<non-roman>/construction/` (e.g., #greek_market.tga at 78×62) which
  // look pixelated in a card-sized slot when a 156×124 alternative exists.
  // The `strict` flag rejects both placeholders and undersized thumbnails;
  // it's enabled for per-culture passes (so the roman pass can win with
  // proper artwork) and disabled for roman/wide-banner passes (where the
  // file we find is the only option, even if small).
  const VANILLA_PLACEHOLDER_SIZE = 2567;
  const MIN_CARD_DIMENSION = 100;
  const readTga = (dir, fn, strict) => {
    // Cached directory listing → in-memory membership test (see iconDirFiles).
    const files = iconDirFiles(dir);
    if (!files) return null;
    const actual = files.get(fn.toLowerCase());
    if (!actual) return null;
    const full = path.join(dir, actual);
    try {
      const buf = fs.readFileSync(full);
      if (strict) {
        if (buf.byteLength === VANILLA_PLACEHOLDER_SIZE) return null;
        if (buf.byteLength >= 18) {
          const w = buf.readUInt16LE(12);
          const h = buf.readUInt16LE(14);
          if (w > 0 && h > 0 && w < MIN_CARD_DIMENSION && h < MIN_CARD_DIMENSION) return null;
        }
      }
      return {
        buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        path: full,
        mime: "image/x-tga",
      };
    } catch { return null; }
  };
  // Resolution order is built around two preferences:
  //   1. Specific (per-level) beats generic (per-chain).
  //   2. Square icon (`#<c>_<x>.tga`, ~156×124) beats wide `_constructed`
  //      banner (~361×163). Banners squashed to a square card look stretched.
  // Roman is checked alongside per-culture (not as a last-resort fallback)
  // because mods like RIS often ship the per-level art ONLY under roman/
  // (e.g. `#roman_temple_dorian_1.tga`, `#roman_governors_palace.tga`),
  // and vanilla greek often only ships the wide `_constructed` banner.
  let chainCandidates = [];
  if (chainName) {
    const ch = String(chainName).toLowerCase();
    const chainTokens = ch.split("_");
    for (let start = 0; start < chainTokens.length; start++) {
      const suffix = chainTokens.slice(start).join("_");
      if (suffix && !chainCandidates.includes(suffix)) chainCandidates.push(suffix);
    }
  }
  const tryNames = (names, dirSet, strict) => {
    for (const fn of names) {
      for (const dir of dirSet) {
        const r = readTga(dir, fn, strict);
        if (r) return r;
      }
    }
    return null;
  };
  // Pass 1 — per-culture square icon, strict (skip placeholders and
  // 78×62 thumbnails so the roman pass can serve the proper 156×124 card).
  for (const lc of levelCandidates) {
    const r = tryNames([`#${c}_${lc}.tga`, `#${c.toUpperCase()}_${lc}.tga`, `#${lc}.tga`, `${c}_${lc}.tga`], dirs, true);
    if (r) return r;
  }
  // Pass 2 — roman per-level (non-strict; accept whatever's there since
  // roman is the canonical asset path for missing per-culture art).
  if (c !== "roman" && romanDirs.length) {
    for (const lc of levelCandidates) {
      const r = tryNames([`#roman_${lc}.tga`, `#ROMAN_${lc}.tga`, `roman_${lc}.tga`], romanDirs, false);
      if (r) return r;
    }
  }
  // Pass 3 — per-culture chain icon, strict.
  for (const cc of chainCandidates) {
    const r = tryNames([`#${c}_${cc}.tga`, `#${c.toUpperCase()}_${cc}.tga`, `#${cc}.tga`, `${c}_${cc}.tga`], dirs, true);
    if (r) return r;
  }
  // Pass 4 — roman chain icon (non-strict).
  if (c !== "roman" && romanDirs.length) {
    for (const cc of chainCandidates) {
      const r = tryNames([`#roman_${cc}.tga`, `#ROMAN_${cc}.tga`, `roman_${cc}.tga`], romanDirs, false);
      if (r) return r;
    }
  }
  // Pass 5 — per-culture small/thumbnail icon (non-strict). Accept the
  // 78×62 thumbnail now if no proper card was found anywhere.
  for (const lc of levelCandidates) {
    const r = tryNames([`#${c}_${lc}.tga`, `#${c.toUpperCase()}_${lc}.tga`, `#${lc}.tga`, `${c}_${lc}.tga`], dirs, false);
    if (r) return r;
  }
  for (const cc of chainCandidates) {
    const r = tryNames([`#${c}_${cc}.tga`, `#${c.toUpperCase()}_${cc}.tga`, `#${cc}.tga`, `${c}_${cc}.tga`], dirs, false);
    if (r) return r;
  }
  // Pass 6 — per-culture wide `_constructed` banner.
  for (const lc of levelCandidates) {
    const r = tryNames([`#${c}_${lc}_constructed.tga`], dirs, false);
    if (r) return r;
  }
  // Pass 7 — roman wide `_constructed` banner.
  if (c !== "roman" && romanDirs.length) {
    for (const lc of levelCandidates) {
      const r = tryNames([`#roman_${lc}_constructed.tga`], romanDirs, false);
      if (r) return r;
    }
    for (const cc of chainCandidates) {
      const r = tryNames([`#roman_${cc}_constructed.tga`], romanDirs, false);
      if (r) return r;
    }
  }
  // Per-culture chain `_constructed` as final visual.
  for (const cc of chainCandidates) {
    const r = tryNames([`#${c}_${cc}_constructed.tga`], dirs, false);
    if (r) return r;
  }
  // Final pass — cross-culture lookup. Some chains/levels exist as art
  // ONLY under specific cultures (e.g., #greek_gov1.tga but no roman or
  // italic version). Searches a prioritised list of cultures for the level
  // name, then chain name, then `_constructed` variants. Better than a
  // blank card.
  for (const lc of levelCandidates) {
    for (const { culture: oc, dir } of otherCultureDirs) {
      const r = readTga(dir, `#${oc}_${lc}.tga`, false); if (r) return r;
    }
  }
  for (const cc of chainCandidates) {
    for (const { culture: oc, dir } of otherCultureDirs) {
      const r = readTga(dir, `#${oc}_${cc}.tga`, false); if (r) return r;
    }
  }
  for (const lc of levelCandidates) {
    for (const { culture: oc, dir } of otherCultureDirs) {
      const r = readTga(dir, `#${oc}_${lc}_constructed.tga`, false); if (r) return r;
    }
  }
  // Final fallback — RTW's own generic building card, shown by the game
  // when no per-culture/per-level art exists. 78×62, same dimensions as
  // the per-level card icons. This is what the in-game UI shows for
  // chains like Weavery that ship no building art at all.
  const genericRoots = [];
  if (modDataDir && fs.existsSync(modDataDir)) genericRoots.push(path.join(modDataDir, "ui", "generic"));
  for (const root of getIconSearchRoots()) genericRoots.push(path.join(root, "ui", "generic"));
  for (const dir of genericRoots) {
    const got = readTga(dir, "generic_building.tga", false);
    if (got) return got;
  }
  // Genuinely missing — log via the renderer's MISSING ICON line so they
  // can be added deliberately.
  return null;
}

ipcMain.handle("resolve-building-icon", async (_event, modDataDir, culture, levelName, chainName) =>
  resolveBuildingIconCore(modDataDir, culture, levelName, chainName));

// IPC: resolve MANY building icons in ONE round-trip (2026-07-15). The
// per-icon handler cost one IPC hop each; warming ~900 settlement icons that
// way was the startup icon-lag bottleneck. The renderer chunks its warm list
// and calls this so N icons resolve in one call. `list` = [{culture, level,
// chain}]; returns [{culture, level, buffer|null, path|null}] in the same
// order. Buffers are transferable ArrayBuffers (structured-clone as usual).
ipcMain.handle("resolve-building-icons-bulk", async (_event, modDataDir, list) => {
  if (!Array.isArray(list)) return [];
  const out = new Array(list.length);
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!it || !it.culture || !it.level) { out[i] = null; continue; }
    const r = resolveBuildingIconCore(modDataDir, it.culture, it.level, it.chain || null);
    out[i] = { culture: it.culture, level: it.level, buffer: r ? r.buffer : null, path: r ? r.path : null };
  }
  return out;
});

// IPC: replace a building icon by dropping a PNG / JPG / TGA file onto its
// card in the dev-mode region editor. Resolves the same destination filename
// that `resolve-building-icon` would have read, copies/converts the dropped
// file into place, and backs up the previous TGA to `_backup/`. RTW only
// loads TGA so PNG/JPG are decoded via Electron's nativeImage and re-encoded
// as uncompressed 32-bit BGRA TGAs.
//
// Args:
//   modDataDir   — active mod data dir (where data/ui/<culture>/buildings lives)
//   culture      — building's culture (greek, roman, eastern, ...)
//   levelName    — EDB level (e.g. "city_barracks"), used for filename derivation
//   chainName    — EDB chain name (e.g. "barracks"), used as a fallback suffix
//   sourceFile   — absolute path of the dropped file on disk
//
// Returns: { ok: true, destPath, backupPath } or { ok: false, error }.
// encodeTga32BGRA moved to src/tgaCodec.js (pure, imported at top).

ipcMain.handle("replace-building-icon", async (_event, modDataDir, culture, levelName, chainName, sourceFile) => {
  console.log(`[icon-replace] IPC invoked: culture=${culture} level=${levelName} chain=${chainName || "(none)"} src=${sourceFile || "(none)"}`);
  if (!culture || !levelName || !sourceFile) {
    return { ok: false, error: "missing culture / level / source" };
  }
  if (!fs.existsSync(sourceFile)) {
    return { ok: false, error: `source not found: ${sourceFile}` };
  }
  // The mod's own data/ui/<culture>/buildings/ is the canonical destination
  // — that's where the user wants their replacement to live (so it overrides
  // the Steam fallback). If the mod doesn't have a buildings dir yet, create
  // it. Filename matches whichever variant the resolver was reading.
  const c = String(culture).toLowerCase();
  const l = String(levelName).toLowerCase();
  const ch = chainName ? String(chainName).toLowerCase() : null;
  // Filename candidates (no path) — same order the resolver tries first
  // (per-culture per-level square icon). Whichever filename actually exists
  // in the mod's buildings dir is the one we overwrite; if NONE exist there,
  // we fall back to the engine-canonical `#<c>_<level>.tga` so the new file
  // beats the Steam fallback path.
  const candidates = [
    `#${c}_${l}.tga`,
    `#${c.toUpperCase()}_${l}.tga`,
    `${c}_${l}.tga`,
  ];
  if (ch) {
    candidates.push(`#${c}_${ch}.tga`);
    candidates.push(`${c}_${ch}.tga`);
  }
  if (!modDataDir || !fs.existsSync(modDataDir)) {
    return { ok: false, error: "active mod data dir missing — drop into vanilla Steam install is not allowed" };
  }
  const destDir = path.join(modDataDir, "ui", c, "buildings");
  try { fs.mkdirSync(destDir, { recursive: true }); } catch {}
  // Find existing icon (if any) to back up; otherwise use the canonical name.
  let destFn = null;
  for (const fn of candidates) {
    const full = path.join(destDir, fn);
    if (fs.existsSync(full)) { destFn = fn; break; }
  }
  if (!destFn) destFn = candidates[0]; // engine-canonical fallback
  const destPath = path.join(destDir, destFn);
  // Backup existing icon (if present).
  let backupPath = null;
  if (fs.existsSync(destPath)) {
    try {
      const backupDir = path.join(destDir, "_backup");
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupPath = path.join(backupDir, `${destFn}.bak.${stamp}`);
      fs.copyFileSync(destPath, backupPath);
      console.log(`[icon-replace] backup-saved: ${backupPath}`);
    } catch (e) {
      console.warn(`[icon-replace] backup failed: ${e.message}`);
      // Continue — losing the backup is worse than failing the whole replace,
      // but the user can also just re-drop the original file.
    }
  }
  // Convert source to TGA (or copy directly if already TGA).
  const ext = path.extname(sourceFile).toLowerCase();
  try {
    if (ext === ".tga") {
      fs.copyFileSync(sourceFile, destPath);
      console.log(`[icon-replace] success (tga-copy): ${sourceFile} → ${destPath}`);
    } else if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") {
      // nativeImage decodes PNG/JPG and gives us BGRA via toBitmap().
      const img = nativeImage.createFromPath(sourceFile);
      if (img.isEmpty()) throw new Error("nativeImage decode produced empty image");
      const size = img.getSize();
      if (!size.width || !size.height) throw new Error(`invalid size ${size.width}x${size.height}`);
      const bgra = img.toBitmap(); // BGRA, top-down
      const tga = encodeTga32BGRA(size.width, size.height, bgra);
      fs.writeFileSync(destPath, tga);
      console.log(`[icon-replace] success (png/jpg→tga ${size.width}x${size.height}): ${sourceFile} → ${destPath}`);
    } else {
      return { ok: false, error: `unsupported extension: ${ext} (expected .png / .jpg / .tga)` };
    }
  } catch (e) {
    console.warn(`[icon-replace] failed: ${e.message}`);
    return { ok: false, error: e.message || String(e) };
  }
  clearIconDirCache(path.dirname(destPath)); // new/updated icon → refresh listing cache
  return { ok: true, destPath, backupPath, destFilename: destFn };
});

// IPC: revert a previous icon replacement by restoring the backed-up TGA.
// Called from App.js's revertOnePending when the user removes an icon-replace
// entry from the pending log. If no backup exists, deletes the dropped icon
// so the resolver falls back to the original Steam vanilla file.
ipcMain.handle("revert-building-icon", async (_event, destPath, backupPath) => {
  console.log(`[icon-replace] revert IPC: dest=${destPath || "(none)"} backup=${backupPath || "(none)"}`);
  if (!destPath) return { ok: false, error: "no destination path" };
  // CONTAINMENT (2026-07-15): both paths are a write+delete primitive. They
  // were produced by replace-building-icon, which only ever writes under the
  // active mod's ui tree — so require them to resolve inside activeModDataDir.
  // Without this a compromised renderer could pass any paths to copy/unlink.
  if (!activeModDataDir) return { ok: false, error: "no active mod" };
  const safeDest = pathSafety.containedPath(activeModDataDir, destPath);
  if (!safeDest) { console.warn(`[icon-replace] revert refused (dest outside mod): ${destPath}`); return { ok: false, error: "destination outside the active mod dir" }; }
  const safeBackup = backupPath ? pathSafety.containedPath(activeModDataDir, backupPath) : null;
  if (backupPath && !safeBackup) { console.warn(`[icon-replace] revert refused (backup outside mod): ${backupPath}`); return { ok: false, error: "backup outside the active mod dir" }; }
  try {
    if (safeBackup && fs.existsSync(safeBackup)) {
      fs.copyFileSync(safeBackup, safeDest);
      try { fs.unlinkSync(safeBackup); } catch {}
      clearIconDirCache(path.dirname(safeDest));
      console.log(`[icon-replace] revert-restored: ${safeBackup} → ${safeDest}`);
      return { ok: true, restored: true };
    }
    if (fs.existsSync(safeDest)) {
      fs.unlinkSync(safeDest);
      clearIconDirCache(path.dirname(safeDest));
      console.log(`[icon-replace] revert-deleted (no backup): ${safeDest}`);
      return { ok: true, restored: false, deleted: true };
    }
    return { ok: true, restored: false, deleted: false };
  } catch (e) {
    console.warn(`[icon-replace] revert failed: ${e.message}`);
    return { ok: false, error: e.message || String(e) };
  }
});

// IPC: resolve the WIDE `_constructed` building banner (for the right-click
// info popup). Normal icon resolution picks the small square card — the
// popup wants the big ~361×163 banner shown in-game's info panel. Priority:
//   1. Culture's `#<c>_<level>_constructed.tga`
//   2. Same with progressively shorter suffixes (temple_of_X_shrine → shrine)
//   3. Roman's `_constructed` variant (roman ships the full set)
ipcMain.handle("resolve-building-banner", async (_event, modDataDir, culture, levelName, chainName) => {
  if (!levelName) return null;
  // Default to roman when the caller didn't give us a culture — roman ships
  // the complete building set, so the banner almost always exists there.
  const c = String(culture || "roman").toLowerCase();
  const l = String(levelName).toLowerCase();
  const { cultureFallbacks, levelAliases } = parseDescrUiBuildings(modDataDir);
  const tokens = l.split("_");
  const suffixes = [];
  for (let start = 0; start < tokens.length; start++) {
    const s = tokens.slice(start).join("_");
    if (s && !suffixes.includes(s)) suffixes.push(s);
  }
  // Apply descr_ui_buildings.txt level aliases (temple_of_battle_shrine → shrine).
  if (levelAliases) {
    let cur = l;
    const seen = new Set([cur]);
    for (let i = 0; i < 8; i++) {
      const next = levelAliases[cur];
      if (!next || seen.has(next)) break;
      if (!suffixes.includes(next)) suffixes.push(next);
      const at = next.split("_");
      for (let s = 1; s < at.length; s++) {
        const suf = at.slice(s).join("_");
        if (suf && !suffixes.includes(suf)) suffixes.push(suf);
      }
      seen.add(next);
      cur = next;
    }
  }
  const tryRead = (dir, fn) => {
    if (!fs.existsSync(dir)) return null;
    const full = path.join(dir, fn);
    if (!fs.existsSync(full)) return null;
    try {
      const buf = fs.readFileSync(full);
      return {
        buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        path: full,
        mime: "image/x-tga",
      };
    } catch { return null; }
  };
  const collectDirs = (fac) => {
    const dirs = [];
    if (modDataDir && fs.existsSync(modDataDir)) {
      dirs.push(path.join(modDataDir, "ui", fac, "buildings"));
      dirs.push(path.join(modDataDir, "ui", fac, "buildings", "construction"));
    }
    for (const root of getIconSearchRoots()) {
      dirs.push(path.join(root, "ui", fac, "buildings"));
      dirs.push(path.join(root, "ui", fac, "buildings", "construction"));
    }
    return dirs;
  };
  const dirs = collectDirs(c);
  for (const suf of suffixes) {
    for (const dir of dirs) {
      const r = tryRead(dir, `#${c}_${suf}_constructed.tga`);
      if (r) return r;
    }
  }
  // Culture fallback chain from descr_ui_buildings.txt (roman → eastern,
  // greek, egyptian — or whatever the file declares). Fall back to roman
  // if the file is missing.
  const fallbackCultures = (cultureFallbacks && cultureFallbacks[c]) || (c !== "roman" ? ["roman"] : []);
  for (const fc of fallbackCultures) {
    if (fc === c) continue;
    const rDirs = collectDirs(fc);
    for (const suf of suffixes) {
      for (const dir of rDirs) {
        const r = tryRead(dir, `#${fc}_${suf}_constructed.tga`);
        if (r) return r;
      }
    }
  }
  // Final fallback — RTW's generic `_constructed` banner (360×160) for
  // chains that ship no per-culture art. Matches what the in-game
  // right-click detail panel shows for Weavery etc.
  const genericDirs = [];
  if (modDataDir && fs.existsSync(modDataDir)) genericDirs.push(path.join(modDataDir, "ui", "generic"));
  for (const root of getIconSearchRoots()) genericDirs.push(path.join(root, "ui", "generic"));
  for (const dir of genericDirs) {
    const r = tryRead(dir, "generic_constructed_building.tga");
    if (r) return r;
  }
  return null;
});

// IPC: resolve the LARGE unit info panel (for right-click popup). RTW
// stores these at `data/ui/unit_info/<faction>/<unit>_info.tga` — much
// bigger and more detailed than the small card.
ipcMain.handle("resolve-unit-info", async (_event, modDataDir, faction, unitName, dictionary) => {
  if (!faction || !unitName) return null;
  const f = String(faction).toLowerCase().replace(/\s+/g, "_");
  const scrub = (s) => String(s).toLowerCase().replace(/['"`]/g, "").replace(/\s+/g, "_");
  const uBase = scrub(unitName);
  // Same priority as resolve-unit-card: dictionary > raw type > variants.
  const uVariants = [];
  const pushUnique = (v) => { if (v && !uVariants.includes(v)) uVariants.push(v); };
  if (dictionary) pushUnique(scrub(dictionary));
  pushUnique(uBase);
  for (const v of [...uVariants]) {
    if (/s$/.test(v)) pushUnique(v.slice(0, -1));
    if (v.startsWith("aor_")) pushUnique(v.slice(4));
    if (v.startsWith("merc_")) pushUnique(v.slice(5));
  }
  const factions = [f, "mercs"];
  if (f === "greeks") factions.unshift("greek_cities");
  const dirs = [];
  for (const fac of factions) {
    if (modDataDir && fs.existsSync(modDataDir)) {
      dirs.push(path.join(modDataDir, "ui", "unit_info", fac));
    }
    for (const root of getIconSearchRoots()) {
      dirs.push(path.join(root, "ui", "unit_info", fac));
    }
  }
  for (const uv of uVariants) {
    const fn = `${uv}_info.tga`;
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const full = path.join(dir, fn);
      if (!fs.existsSync(full)) continue;
      try {
        const buf = fs.readFileSync(full);
        return {
          buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          path: full,
          mime: "image/x-tga",
        };
      } catch {}
    }
  }
  // Fallback: scan every faction folder under ui/unit_info/* for any of our
  // _info.tga candidates. Matches the same fallback in resolve-unit-card.
  const fallbackRoots = [];
  if (modDataDir && fs.existsSync(modDataDir)) fallbackRoots.push(modDataDir);
  for (const root of getIconSearchRoots()) fallbackRoots.push(root);
  const fnSet = new Set(uVariants.map(uv => `${uv}_info.tga`));
  for (const root of fallbackRoots) {
    const base = path.join(root, "ui", "unit_info");
    let entries;
    try { entries = fs.readdirSync(base); } catch { continue; }
    for (const facDir of entries) {
      const facPath = path.join(base, facDir);
      try { if (!fs.statSync(facPath).isDirectory()) continue; } catch { continue; }
      for (const fn of fnSet) {
        const full = path.join(facPath, fn);
        if (!fs.existsSync(full)) continue;
        try {
          const buf = fs.readFileSync(full);
          return {
            buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
            path: full,
            mime: "image/x-tga",
          };
        } catch {}
      }
    }
  }
  return null;
});

// IPC: resolve a unit portrait/card tga. RTW ships small cards at
// `data/ui/units/<faction>/#<unit_name>.tga` (spaces → underscores) and
// larger info panels at `data/ui/unit_info/<faction>/<unit_name>_info.tga`.
// Caller passes the unit's faction (from settlement ownership) and name.
// Returns { buffer, path, mime } or null.
ipcMain.handle("resolve-unit-card", async (_event, modDataDir, faction, unitName, dictionary) => {
  if (!faction || !unitName) return null;
  const f = String(faction).toLowerCase().replace(/\s+/g, "_");
  // Strip apostrophes (e.g. "general's" → "generals"), keep word chars and
  // underscores only. RTW TGAs use the scrubbed form.
  const scrub = (s) => String(s).toLowerCase().replace(/['"`]/g, "").replace(/\s+/g, "_");
  const uBase = scrub(unitName);
  // Build name candidates in priority order:
  //   1. EDU dictionary (e.g. "aestian_clubmen") — canonical for icon files,
  //      especially AOR / merc variants whose type starts with "aor "/"merc ".
  //   2. The type-derived form (uBase).
  //   3. Plural-stripped versions of both ("naval biremes" → "naval_bireme").
  //   4. Type-derived with "aor_"/"merc_" prefix stripped, in case dictionary
  //      isn't available but the icon file is keyed without the prefix.
  const uVariants = [];
  const pushUnique = (v) => { if (v && !uVariants.includes(v)) uVariants.push(v); };
  if (dictionary) pushUnique(scrub(dictionary));
  pushUnique(uBase);
  for (const v of [...uVariants]) {
    if (/s$/.test(v)) pushUnique(v.slice(0, -1));
    if (v.startsWith("aor_")) pushUnique(v.slice(4));
    if (v.startsWith("merc_")) pushUnique(v.slice(5));
  }
  const factions = [f];
  // Remastered split some vanilla factions; try a couple of aliases.
  if (f === "greeks") factions.push("greek_cities");
  if (f === "romans_julii" || f === "romans_brutii" || f === "romans_scipii" || f === "romans_senate") factions.push("romans");
  // Mercenary units live under ui/units/mercs/ regardless of who hired them.
  factions.push("mercs");
  const filenames = [];
  for (const uv of uVariants) { filenames.push(`#${uv}.tga`); filenames.push(`${uv}_info.tga`); }
  const dirs = [];
  for (const fac of factions) {
    if (modDataDir && fs.existsSync(modDataDir)) {
      dirs.push(path.join(modDataDir, "ui", "units", fac));
      dirs.push(path.join(modDataDir, "ui", "unit_info", fac));
    }
    for (const root of getIconSearchRoots()) {
      dirs.push(path.join(root, "ui", "units", fac));
      dirs.push(path.join(root, "ui", "unit_info", fac));
    }
  }
  for (const fn of filenames) {
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const full = path.join(dir, fn);
      if (!fs.existsSync(full)) continue;
      try {
        const buf = fs.readFileSync(full);
        return {
          buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          path: full,
          mime: "image/x-tga",
        };
      } catch {}
    }
  }
  // Fallback: brute-force scan every faction folder under ui/units/* and
  // ui/unit_info/* for any of our filename candidates. AOR units often have
  // their icon under a "natural-owner" faction folder (e.g. "aor roman
  // rorarii" → romans_julii/#roman_rorarii.tga) rather than mercs/ or the
  // recruiting faction's folder. The audit script flagged ~700 such combos.
  const fallbackRoots = [];
  if (modDataDir && fs.existsSync(modDataDir)) fallbackRoots.push(modDataDir);
  for (const root of getIconSearchRoots()) fallbackRoots.push(root);
  const fnSet = new Set(filenames);
  for (const root of fallbackRoots) {
    for (const subdir of ["units", "unit_info"]) {
      const base = path.join(root, "ui", subdir);
      let entries;
      try { entries = fs.readdirSync(base); } catch { continue; }
      for (const facDir of entries) {
        const facPath = path.join(base, facDir);
        try { if (!fs.statSync(facPath).isDirectory()) continue; } catch { continue; }
        for (const fn of fnSet) {
          const full = path.join(facPath, fn);
          if (!fs.existsSync(full)) continue;
          try {
            const buf = fs.readFileSync(full);
            return {
              buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
              path: full,
              mime: "image/x-tga",
            };
          } catch {}
        }
      }
    }
  }
  return null;
});

// IPC: read file as text (contained: only inside dialog-consented roots —
// see the consent-store block above scan-folder)
ipcMain.handle("read-file", async (_event, filePath) => {
  if (!isConsentedPath(filePath)) { console.warn("[consent] read-file refused:", filePath); return null; }
  try { return fs.readFileSync(filePath, "utf8"); } catch { return null; }
});

// IPC: read file as binary (returns ArrayBuffer via Buffer; same containment)
ipcMain.handle("read-file-binary", async (_event, filePath) => {
  if (!isConsentedPath(filePath)) { console.warn("[consent] read-file-binary refused:", filePath); return null; }
  try {
    const buf = fs.readFileSync(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch { return null; }
});

// On startup we DELIBERATELY KEEP userData/campaign_data across app-version
// changes. It holds the user's IMPORTED slot data (e.g. the mod they put in
// Slot 2 during onboarding), which MUST survive updates. A previous version
// wiped this whole folder on every version change, so each auto-update emptied
// the imported slot. Bundled data is read from build/ only AFTER userData (see
// the read-campaign-file IPC), so a NON-imported slot still picks up refreshed
// bundled data automatically, while an imported slot correctly keeps the user's
// data. We only refresh the version stamp (nothing is deleted here).
(function stampCampaignDataVersion() {
  try {
    const userDir = path.join(app.getPath("userData"), "campaign_data");
    if (!fs.existsSync(userDir)) return;
    fs.writeFileSync(path.join(userDir, ".version_stamp"), app.getVersion(), "utf8");
  } catch {}
})();

// IPC: get the app's user data path for persistent storage
ipcMain.handle("get-user-data-path", () => {
  return app.getPath("userData");
});

// IPC: persist the dev autosave history to a file (not localStorage — 30 full
// state snapshots blow past the ~5MB localStorage cap). Stored in userData so it
// survives app restarts and isn't touched by Save/Export.
const AUTOSAVE_FILE = () => path.join(app.getPath("userData"), "devAutosaves.json");
ipcMain.handle("read-autosaves", async () => {
  try {
    const fp = AUTOSAVE_FILE();
    if (!fs.existsSync(fp)) return { autosaves: [] };
    const arr = JSON.parse(fs.readFileSync(fp, "utf8"));
    return { autosaves: Array.isArray(arr) ? arr : [] };
  } catch (e) {
    return { autosaves: [], error: e && e.message ? e.message : String(e) };
  }
});
ipcMain.handle("write-autosaves", async (_e, json) => {
  try {
    fs.writeFileSync(AUTOSAVE_FILE(), typeof json === "string" ? json : JSON.stringify(json));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

// IPC: unified save cracker. Anywhere in the app that wants per-faction data
// (regions, treasury, characters, diplomacy) should call this — NOT reach into
// saveCrackerExtras directly, which has fields that look right but are wrong
// (regionCount returns 4 for Carthage when ownerByCity correctly shows 41).
// Returns { header, playerFaction, factions, settlements, characters, diplomacy, ownerByCity, _stats }.
ipcMain.handle("crack-save", async (_event, savePath, modDataDir) => {
  try {
    const { crackSave } = require("./src/saveCracker.js");
    const buf = await fs.promises.readFile(savePath); // async: saves are 30-45 MB — don't block the event loop on I/O
    const cracked = crackSave(buf, modDataDir);
    // 0.9.860: attach the per-faction Financial Overview breakdown (income by
    // category, expenditure by category, net) read from the stored econ-history
    // KPI block. This is the REAL in-game breakdown (matches the Finance & Family
    // panel to the denarius), not a derivation. Failure is non-fatal — the rest
    // of the crack still returns.
    try {
      const { parseFinancialOverview } = require("./src/economyParser.js");
      cracked.economy = parseFinancialOverview(buf, cracked);
      const pf = cracked.economy && cracked.economy.playerFaction;
      const pe = pf && cracked.economy.byFaction ? cracked.economy.byFaction[pf] : null;
      if (pe) _writeLog(`[economy] ${pf} income=${pe.income?.total} expend=${pe.expenditure?.total} net=${pe.net} treasury=${pe.treasury}`);
    } catch (e2) { _writeLog(`[economy] parse failed: ${e2 && e2.message}`); }
    return cracked;
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
});

// 0.9.860: dedicated Financial Overview IPC. Cracks the save and returns ONLY
// the per-faction economy breakdown (income/expenditure by category, net,
// treasury) read from the stored econ-history KPI block — the REAL in-game
// numbers. Decoupled from the live/calibrate pipelines (which use the lighter
// extras parser) so the economy panel can fetch on-demand per save-file change,
// exactly like the trade-network effect. Returns { error } on failure.
ipcMain.handle("get-save-economy", async (_event, savePath, modDataDir) => {
  try {
    if (!savePath) return { error: "no save path" };
    const { crackSave } = require("./src/saveCracker.js");
    const { parseFinancialOverview } = require("./src/economyParser.js");
    const buf = await fs.promises.readFile(savePath); // async: saves are 30-45 MB — don't block the event loop on I/O
    const cracked = crackSave(buf, modDataDir);
    const economy = parseFinancialOverview(buf, cracked);
    const pf = economy && economy.playerFaction;
    const pe = pf && economy.byFaction ? economy.byFaction[pf] : null;
    if (pe) _writeLog(`[economy] ${path.basename(savePath)} ${pf} income=${pe.income?.total} expend=${pe.expenditure?.total} net=${pe.net} treasury=${pe.treasury}`);
    else _writeLog(`[economy] ${path.basename(savePath)} no player-faction economy (pf=${pf})`);
    return economy;
  } catch (e) {
    _writeLog(`[economy] get-save-economy failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: the SAVE'S PLAYER faction budget — read from recs[0], the player's econ
// record (the save is centered on the player; verified recs[0]==player net=-536
// on the Gades save). This is the one faction whose projected income we can read
// reliably from a turn-1 save (general faction attribution is ambiguous).
ipcMain.handle("get-save-player-budget", async (_event, savePath) => {
  try {
    if (!savePath) return { error: "no save path" };
    const buf = await fs.promises.readFile(savePath); // async: saves are 30-45 MB — don't block the event loop on I/O
    const x = require("./src/saveCrackerExtras.js");
    const eco = require("./src/economyParser.js");
    const recs = x.parseFactionTreasuries(buf);
    if (!Array.isArray(recs) || !recs.length) return { error: "no faction records" };
    const b = eco.readFinancialBlock(buf, recs[0].offset);
    const d = b && eco.decodeFinancialBlock(b);
    if (!d || d.net == null) return { error: "could not decode player econ block" };
    return { net: d.net, taxes: d.income && d.income.taxes, income: d.income && d.income.total, army_upkeep: d.expenditure && d.expenditure.army_upkeep, treasury: recs[0].treasury };
  } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: ALL factions' projected income from ONE save (cracked 2026-06-07). The
// econ records are in descr_strat faction order with the player swapped to recs[0];
// returns { byFaction:{name:{net,income:{taxes,total},treasury,...}}, player, confidence }.
ipcMain.handle("get-all-faction-budgets", async (_event, savePath, modDataDir, playerHint) => {
  try {
    if (!savePath || !modDataDir) return { error: "savePath + modDataDir required" };
    const buf = await fs.promises.readFile(savePath); // async: saves are 30-45 MB — don't block the event loop on I/O
    const as = require("./src/armySetup.js");
    const r = as.attributeAllBudgets(buf, modDataDir, playerHint);
    if (r && r.byFaction) _writeLog(`[budgets] ${path.basename(savePath)} player=${r.player} located=${r.playerLocated}${r.hinted ? "(hint)" : ""} confidence=${(r.confidence * 100).toFixed(0)}% (${r.matched}/${r.total})`);
    return r;
  } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: VIRTUAL TAX-SETTER (2026-06-07) — from ONE turn-2+ save, compute the
// optimal tax bracket per settlement for EVERY faction (highest bracket keeping
// population growth ≥ 0, using RTW's hard-coded flat per-bracket growth modifier:
// low +0.5 / normal 0 / high −0.5 / very_high −1.0), plus an estimated net at
// those taxes. Player settlements use the reliable per-settlement tax byte; AI
// ones can read unset. Returns armySetup.optimalTaxPlan().
ipcMain.handle("get-optimal-taxes", async (_event, savePath, modDataDir, playerHint, economyPath) => {
  try {
    if (!savePath || !modDataDir) return { error: "savePath + modDataDir required" };
    const buf = await fs.promises.readFile(savePath); // async: saves are 30-45 MB — don't block the event loop on I/O
    const as = require("./src/armySetup.js");
    const { crackSave } = require("./src/saveCracker.js");
    const cracked = crackSave(buf, modDataDir);
    // USER RULE: turn-2 save = growth ONLY; budget comes from a TURN-1 save.
    let economyBudgets = null;
    if (economyPath && economyPath !== savePath) {
      try { economyBudgets = as.attributeAllBudgets(fs.readFileSync(economyPath), modDataDir, playerHint); }
      catch (e) { _writeLog(`[opt-tax] economy save read failed: ${e && e.message}`); }
    }
    const r = as.optimalTaxPlan(buf, modDataDir, cracked, playerHint, economyBudgets);
    if (r && r.byFaction) {
      const nf = Object.keys(r.byFaction).length;
      const ns = Object.values(r.byFaction).reduce((s, f) => s + (f.totalSettlements || 0), 0);
      _writeLog(`[opt-tax] growth=${path.basename(savePath)} economy=${economyPath ? path.basename(economyPath) : "(same)"} budgetTurn1=${r.budgetTurn1} player=${r.player} located=${r.playerLocated} turnReady=${r.turnReady} factions=${nf} settlements=${ns} dist=low ${r.counts.low}/norm ${r.counts.normal}/high ${r.counts.high}/vhigh ${r.counts.very_high}`);
      if (!r.turnReady) _writeLog(`[opt-tax] WARNING: no growth in save (turn-1?) — optimal-tax plan needs a turn-2+ save`);
    }
    return r;
  } catch (e) { _writeLog(`[opt-tax] failed: ${e && e.message}`); return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: ROUGH strat-only tax plan (2026-06-08) — computes base growth → optimal
// bracket for a faction from descr_strat + descr_regions + EDB ONLY (no save).
// ⚠ ~60% accurate (governor growth/squalor effects + fertility/overcrowding
// coupling are engine-internal and don't decompose from static files — verified).
// The EXACT plan still needs an all-Normal turn-2 save (optimalTaxPlan, 67/67).
ipcMain.handle("get-strat-tax-plan", async (_event, modDataDir, faction, savePath) => {
  try {
    if (!modDataDir) return { error: "modDataDir required" };
    const gm = require("./src/growthModel.js");
    // If a save is supplied, read the per-settlement marker−1528 development value
    // (settlementFields.growthDevValue) and feed it in → far more accurate save-aware
    // growth (~95% within 0.5% / ~89% bracket, all factions) vs the no-save model (~82%).
    let opts;
    if (savePath && fs.existsSync(savePath)) {
      try {
        const { crackSave } = require("./src/saveCracker.js");
        const cr = crackSave(await fs.promises.readFile(savePath), modDataDir);
        const growthDevByCity = {};
        const sf = (cr && cr.settlementFields) || {};
        // committed pops from the calibration save → the tax base tracks the actual
        // campaign state (turn-1 saves equal descr_strat; mid-campaign saves diverge).
        const popByCity = {};
        for (const c of Object.keys(sf)) { const pv = sf[c].committedPopulation; if (pv > 0) popByCity[c] = pv; }
        for (const c of Object.keys(sf)) { const g = sf[c].growthDevValue; if (g != null) growthDevByCity[c] = { v1528: g, v1556: sf[c].growthDevValue2 }; }
        // governor trait growth effects (Farming/Fertility/Health) per settlement
        let govEffectByCity = {};
        try {
          const te = require("./src/traitEffects.js");
          govEffectByCity = te.govEffectByCityFromSave(cr, te.parseTraitEffects(modDataDir), modDataDir);
        } catch (e) { _writeLog(`[strat-tax] governor-trait read failed: ${e && e.message}`); }
        opts = {};
        if (Object.keys(growthDevByCity).length) opts.growthDevByCity = growthDevByCity;
        if (Object.keys(govEffectByCity).length) { opts.govEffectByCity = govEffectByCity; _writeLog(`[strat-tax] ${Object.keys(govEffectByCity).length} governors with growth-affecting traits applied`); }
        if (!Object.keys(opts).length) opts = undefined;
      } catch (e) { _writeLog(`[strat-tax] save read failed (${e && e.message}); using no-save model`); }
    }
    // NO-SAVE governor effects: when there's no loaded save (or its governor read
    // yielded nothing), fall back to the STARTING governors seeded in descr_strat so
    // governor-trait squalor (e.g. Estates) is still applied at game start.
    if (!opts || !opts.govEffectByCity) {
      try {
        const te = require("./src/traitEffects.js");
        const stratGov = te.govEffectByCityFromStrat(modDataDir, te.parseTraitEffects(modDataDir));
        if (Object.keys(stratGov).length) {
          opts = opts || {};
          opts.govEffectByCity = stratGov;
          _writeLog(`[strat-tax] ${Object.keys(stratGov).length} starting governors (descr_strat) with growth-affecting traits applied (no-save)`);
        }
      } catch (e) { _writeLog(`[strat-tax] strat-governor read failed: ${e && e.message}`); }
    }
    const r = gm.computeStratTaxPlan(modDataDir, faction, opts);
    if (r && r.byFaction) {
      const ns = Object.values(r.byFaction).reduce((s, f) => s + (f.settlements ? f.settlements.length : 0), 0);
      const mode = r.saveAware ? "SAVE-AWARE (marker−1528)" : "no-save EDB model";
      _writeLog(`[strat-tax] ${faction || "(all)"}: ${ns} settlements via ${mode}; est ~${Math.round((r.accuracy?.bracketMatch || 0) * 100)}% exact bracket`);
      r.staleWarning = _modCopyWarning(modDataDir);
      if (r.staleWarning) _writeLog(`[strat-tax] STALE-MOD WARNING: ${r.staleWarning}`);
    }
    return r;
  } catch (e) { _writeLog(`[strat-tax] failed: ${e && e.message}`); return { error: e && e.message ? e.message : String(e) }; }
});

// Stale-mod-copy guard (2026-06-10): the user keeps several RIS copies side by side
// (My Mods/RIS, RIS beta, RIS Classic, …). Analyzing one copy while the game runs a
// newer sibling produced phantom "mechanics" twice in one session. If any SIBLING mod
// folder has a NEWER descr_strat than the selected one, surface a warning string.
function _modCopyWarning(modDataDir) {
  try {
    const rel = path.join("world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
    const mine = path.join(modDataDir, rel);
    if (!fs.existsSync(mine)) return null;
    const myTime = fs.statSync(mine).mtimeMs;
    const modRoot = path.dirname(modDataDir);            // .../My Mods/RIS beta
    const family = path.dirname(modRoot);                 // .../My Mods
    const newer = [];
    const me = path.resolve(modDataDir).toLowerCase();
    for (const sib of fs.readdirSync(family)) {
      const p = path.join(family, sib, "data", rel);
      if (path.resolve(family, sib, "data").toLowerCase() === me || !fs.existsSync(p)) continue;
      if (fs.statSync(p).mtimeMs > myTime + 60 * 1000) newer.push(sib);
    }
    if (!newer.length) return null;
    return `Sibling mod folder(s) ${newer.join(", ")} have a NEWER descr_strat than the selected mod — if your campaign runs one of those, the plan is computed from stale files. Point Provincia at the copy the game actually loads.`;
  } catch { return null; }
}

// IPC: STATIC turn-1 budget @ optimal taxes (2026-06-09) — the no-save Army Setup
// unit budget. Brackets come from the validated growth model (save-aware when a
// save is supplied, pure no-save otherwise); income from src/incomeModel.js — the
// turn-1 income model cracked from mod files (taxes 713/town ×(1+EDB taxable%)
// ×bracketMult, farming 73.5×(farmN+farmLevel), mining 50×mine_resource, trade
// land/sea fit, wages 200×named+50×admiral, corruption 6.43×Σdist-to-capital).
// Validated vs the 10-faction turn-1 corpus: median |budget err| 7%, worst 27%.
// Returns computeTurn1Budget() + per-settlement optimalBracket/growth merged in.
ipcMain.handle("get-turn1-budget", async (_event, modDataDir, faction, savePath, asAI, taxH, corr, humanDifficulty) => {
  try {
    if (!modDataDir || !faction) return { error: "modDataDir + faction required" };
    const gm = require("./src/growthModel.js");
    const te = require("./src/traitEffects.js");
    const im = require("./src/incomeModel.js");
    // 1. optimal brackets from the growth model (same path as get-strat-tax-plan).
    // Calibration-save assembly extracted to src/calibSaveOpts.js (2026-06-12,
    // testable). PO anchor: live-verified 2026-06-11 — the save's publicOrder
    // field equals the in-game % exactly (Camerinum 125 / Croton 85 / Rome 210).
    // growthDevByCity (save-aware dev growth) is deliberately NOT passed for
    // bracket planning: it reproduces THIS turn's growth tick, which embeds the
    // harvest roll and seasonal/transient dips (live 2026-06-11: a julii turn with
    // every town at −0.5% @normal dragged the whole plan to low). Brackets come
    // from the no-save model baseline (validated 26/26 vs live turn-1 panels);
    // the calibration save contributes the rolled TRAITS + committed POPS (and
    // the exact PO anchor).
    let opts;
    let poAnchorByCity = null; // { city: { po, bracket } } — EXACT stored PO from the calibration save
    let setBracketByCity = null; // { city: bracket } — the rate the PLAYER SET in-game (save)
    let saveApplied = false, saveError = null;
    if (savePath) {
      const cs = require("./src/calibSaveOpts.js").buildCalibSaveOpts(modDataDir, savePath);
      opts = cs.opts || undefined;
      poAnchorByCity = cs.poAnchorByCity;
      setBracketByCity = cs.setBracketByCity || null;
      saveApplied = cs.saveApplied; saveError = cs.saveError;
      const saveBn = String(savePath).split(/[\\/]/).pop();
      if (saveError) _writeLog(`[turn1-budget] calibration-save issue (${saveError})${saveApplied ? "" : "; using no-save model"}`);
      if (saveApplied) _writeLog(`[turn1-budget] calibration save applied: "${saveBn}" → ${cs.counts.governors} governors, ${cs.counts.pops} pops, ${cs.counts.poAnchors} PO anchors`);
    }
    if (!opts || !opts.govEffectByCity) {
      try {
        const stratGov = te.govEffectByCityFromStrat(modDataDir, te.parseTraitEffects(modDataDir));
        if (Object.keys(stratGov).length) { opts = opts || {}; opts.govEffectByCity = stratGov; }
      } catch {}
    }
    const plan = gm.computeStratTaxPlan(modDataDir, faction, opts);
    const pf = plan && plan.byFaction && plan.byFaction[String(faction).toLowerCase()];
    const bracketByCity = {};
    const growthBySettlement = {};
    if (pf && pf.settlements) for (const s of pf.settlements) {
      const key = s.settlement || s.region;
      if (key && s.optimalBracket) bracketByCity[key] = s.optimalBracket;
      // NOTE (income-goal session): deliberately NO PO-based bracket downgrade here —
      // the team's remedy for low-PO towns is garrison-first (keep the tax bracket,
      // add units: the ⚔+N suggestion), per the live Neapolis decision 2026-06-11.
      growthBySettlement[key] = { optimalBracket: s.optimalBracket, baseGrowthEst: s.baseGrowthEst, borderline: s.borderline };
    }
    // SAVE-SET BRACKETS WIN (2026-06-14): when a calibration save is attached it knows
    // the rate the player actually set per town — show THAT, not the app's "optimal"
    // guess, so save-attached taxes match the game (only the ±5% hidden H roll remains,
    // closed by the optional paste). Falls back to optimal where the save lacks a rate.
    // BRACKET DIAGNOSTIC (2026-06-14): before merging, snapshot the optimal so the log
    // can show, per town, optimal→saveSet→final and flag every override. This is the
    // line that tells us at a glance whether the panel is showing the app's recommended
    // bracket or the rate baked into the attached save (a fresh turn-1 save is all
    // 'normal', which silently overrode the very_high Rome recommendation → 877 not 1318).
    const optimalSnapshot = { ...bracketByCity };
    // DISPLAY THE PLAN, NOT THE FRESH-SAVE DEFAULT (2026-06-15, v0.9.1119). Provincia
    // is a turn-1 PLANNER: the panel must show "set these rates → get this budget", so
    // the displayed per-town bracket AND the income are computed at the RECOMMENDED
    // (optimal) bracket. A calibration save taken at campaign start is all default
    // 'normal' (rates unset) — that default must NOT replace the recommendation, or
    // every town shows Normal and the plan disappears (the v1118 bug: all-normal 9266;
    // and the v1115 gate's asymmetry, which kept the HIGH recs but forced the LOW recs
    // back to normal → a −0.5% town wrongly showed Normal instead of Low, and the
    // faction read 11175). So: optimal drives the display; ONLY a bracket the player
    // ACTIVELY changed from the default (save bracket !== 'normal') overrides it — a
    // deliberate in-game choice the app should respect over its own recommendation.
    // live julii4: pure optimal {vhigh:5 high:1 low:15 norm:5} → taxes 9398, which the
    // game reproduces once those rates are set (the 9215 screenshot was pre-plan).
    // ALL-HUMAN balance mode (humanDifficulty set — "hard" since 2026-07-02, was "normal")
    // measures every faction at its 0-growth-OPTIMAL taxes, so it must NOT honor save-set
    // brackets — with a save attached those are the OTHER factions' AI-set (often Low-for-
    // growth) choices, not the optimal the harness is comparing (this was reading Rome at
    // AI-Low taxes 6810 vs optimal 10465).
    // Other modes keep a player's deliberate in-game tax choice (a non-default save bracket).
    if (setBracketByCity && !humanDifficulty) for (const c of Object.keys(setBracketByCity)) {
      if (setBracketByCity[c] && setBracketByCity[c] !== "normal") bracketByCity[c] = setBracketByCity[c];
    }
    if (pf && pf.settlements) {
      const BR = { low: "low", normal: "norm", high: "high", very_high: "vhigh" };
      const overrides = [];
      const finalDist = {};
      for (const s of pf.settlements) {
        const k = s.settlement || s.region;
        const fin = bracketByCity[k] || "normal";
        finalDist[BR[fin] || fin] = (finalDist[BR[fin] || fin] || 0) + 1;
        const opt = optimalSnapshot[k], set = setBracketByCity && setBracketByCity[k];
        // only an ACTIVELY-set (non-normal) save bracket actually overrides the rec
        if (set && set !== "normal" && opt && set !== opt) overrides.push(`${k}: optimal=${BR[opt] || opt}→player-set=${BR[set] || set}`);
      }
      const distStr = Object.entries(finalDist).map(([b, n]) => `${b}:${n}`).join(" ");
      _writeLog(`[turn1-budget] ${faction}: final brackets {${distStr}} | source=${setBracketByCity ? "OPTIMAL plan (player-set rates override)" : "OPTIMAL (no save)"}`);
      if (overrides.length) _writeLog(`[turn1-budget] ${faction}: save overrode optimal for ${overrides.length} towns → ${overrides.slice(0, 8).join(" | ")}${overrides.length > 8 ? ` | …+${overrides.length - 8}` : ""}`);
    }
    // 2. static income model at those brackets. When a CALIBRATION SAVE is provided,
    // its world-wide governor traits (incl. start-randomized personalities) replace
    // the descr_strat seeds for income too — opts.govEffectByCity came from the
    // save-aware path above.
    // PER-CAMPAIGN TAX CALIBRATION (H lock, 2026-06-12): taxH = { settlement:
    // { h } } from the renderer's pasted live tax readings (persisted per
    // modDir+faction). live = model × H, H quantized 0.05 — see src/taxCalib.js.
    const nTaxH = taxH && typeof taxH === "object" ? Object.keys(taxH).length : 0;
    if (nTaxH) _writeLog(`[turn1-budget] ${faction}: tax calibration applied for ${nTaxH} towns (per-campaign H lock)`);
    // PER-TOWN CORRUPTION CALIBRATION (2026-06-14): corr = { settlement: { corr } }
    // from the renderer's pasted live corruption — reproduced EXACTLY (road/pathfinding
    // distance isn't file-recoverable, but corruption is deterministic per files).
    const nCorr = corr && typeof corr === "object" ? Object.keys(corr).length : 0;
    if (nCorr) _writeLog(`[turn1-budget] ${faction}: corruption calibration applied for ${nCorr} towns`);
    const budget = im.computeTurn1Budget(modDataDir, faction, bracketByCity,
      { ...(opts && opts.govEffectByCity ? { govEffectByCity: opts.govEffectByCity } : {}),
        ...(opts && opts.popByCity ? { popByCity: opts.popByCity } : {}),
        // FIX 2026-07-08: forward the save's real bodyguard sizes so army upkeep is save-aware
        // (denarius-exact). Previously dropped here → the budget always used the no-save formula
        // even with a calibration save attached (army read ~170 low).
        ...(opts && opts.bodyguardUnitsByFaction ? { bodyguardUnitsByFaction: opts.bodyguardUnitsByFaction } : {}),
        ...(opts && opts.cultPenByCity ? { cultPenByCity: opts.cultPenByCity } : {}),
        ...(nTaxH ? { taxHByCity: taxH } : {}),
        ...(nCorr ? { corrByCity: corr } : {}),
        ...(asAI ? { asAI: true, isPlayer: false } : (humanDifficulty ? { humanDifficulty } : {})) });
    if (budget && !budget.error) budget.asAI = !!asAI;
    if (budget && !budget.error) {
      for (const s of budget.settlements) {
        const g = growthBySettlement[s.settlement] || growthBySettlement[s.region];
        if (g) { s.optimalBracket = g.optimalBracket; s.baseGrowthEst = g.baseGrowthEst; s.borderline = g.borderline; }
      }
      // SAVE-AWARE FLAG FIX (2026-06-12): was !!(plan && plan.saveAware) — but
      // plan.saveAware means "growth-dev values used", which has been deliberately
      // FALSE for bracket planning since the 2026-06-11 decoupling, so the budget
      // header claimed "(no save)" forever even though the save's governor traits
      // + committed pops WERE driving the numbers. The flag now reflects actual
      // calibration-save usage; saveWarning surfaces silent crack failures.
      budget.saveAware = saveApplied;
      if (savePath && !saveApplied) budget.saveWarning = "calibration save NOT applied" + (saveError ? ` — ${saveError}` : "");
      budget.growthAccuracy = plan && plan.accuracy;
      // public-order: EXACT anchor from the calibration save when present (stored PO is
      // the in-game % verbatim; bracket deltas rel. to low = 0/−30/−50/−70, live-verified
      // on the Croton/Sena full sweeps 2026-06-11); EXACT COMPONENT MODEL as fallback
      // (cracked 2026-06-12: julii 26-panel corpus — save-aware 26/26 within ±10pp
      // MAE 2.3pp, no-save 24/26 MAE 4.8pp; egypt 80-town component validation).
      try {
        const po = require("./src/poModel.js").computeStartingPO(modDataDir, faction,
          opts && opts.govEffectByCity ? { govEffectByCity: opts.govEffectByCity } : {});
        const POD = { low: 0, normal: -30, high: -50, very_high: -70 };
        let flagged = 0, exactN = 0;
        // Garrison-fix unit recommender: the cheapest GATED garrison-infantry unit (full RIS
        // recruitability via poolForSettlement — never bypass it) that covers a town's men-gap to
        // PO 85. men/unit = EDU soldiers ×4 (HUGE size, matching the garrison law). Shared cache so
        // EDB/EDU/descr_regions parse once for the whole faction, not once per town.
        const _garrCache = {};
        const _recommendGarrisonUnit = (buildings, regionName, menGap) => {
          const rp = require("./src/recruitPool.js");
          const pool = rp.poolForSettlement(modDataDir, faction, buildings, regionName, _garrCache);
          if (!pool || !pool.length) return null;
          const us = rp.parseUnitStats(modDataDir) || {};
          const cands = pool.map(u => ({ unit: u.unit, upkeep: u.upkeep, category: u.category, soldiers: (us[u.unit.toLowerCase()] || {}).soldiers }))
            .filter(u => u.category === "infantry" && u.soldiers && u.upkeep != null && !/general|bodyguard|captain/i.test(u.unit))
            .sort((a, b) => (a.upkeep - b.upkeep) || ((b.soldiers || 0) - (a.soldiers || 0)));
          if (!cands.length) return null;
          const best = cands[0], menPerUnit = best.soldiers * 4;
          const n = Math.max(1, Math.round(menGap / menPerUnit));  // round (not ceil): 1 unit that lands near the band is "good enough"
          return { unit: best.unit, n, soldiers: best.soldiers, menPerUnit, upkeep: best.upkeep, totalUpkeep: n * best.upkeep };
        };
        // GARRISON-REPLACE (slim-to-minimum). A town's STARTING garrison can hold units it can no
        // longer recruit there (mod AOR gating changed) — they can't be retrained. Suggest the
        // leanest RECRUITABLE garrison that keeps PO above the user's no-revolt floor (>70, set
        // 2026-07-01 from the live Neapolis read — NOT the 85 comfort band; 73 is "above 70 so
        // fine"): drop the non-recruitable units, keep the bodyguard + any recruitable ones, add
        // the fewest of a role-matched (dominant dropped cls) recruitable infantry to clear it.
        // Garrison law: PO% = 5·min(16, floor(70·men/pop)); men = EDU soldiers ×4 (HUGE), 80% cap.
        const _armySetup = require("./src/armySetup.js");
        const FLOOR_PO = 70;
        let _descrText = null, _regionToCity = {};
        try { _descrText = fs.readFileSync(_armySetup.findDescrStrat(modDataDir), "latin1"); } catch { }
        try { const dg = require("./src/descrStratGeneral.js"); _regionToCity = (dg.parseDescrRegions(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "utf8")) || {}).regionToCity || {}; } catch { }
        const _menOf = (u, us) => ((us[String(u).toLowerCase()] || {}).soldiers || 0) * 4;
        const _garrPts = (men, pop) => Math.min(16, Math.floor(70 * men / pop));
        const _recommendGarrisonReplace = (s, prow) => {
          if (!_descrText || !prow || !prow.rows || !prow.rows.pop) return null;
          const rp = require("./src/recruitPool.js");
          const garr = _armySetup.getGarrisonUnits(_descrText, faction, s.settlement, _regionToCity);
          if (garr.length < 2) return null;                  // need bodyguard + ≥1 unit
          const pool = rp.poolForSettlement(modDataDir, faction, s.buildings, s.region, _garrCache) || [];
          const us = rp.parseUnitStats(modDataDir) || {};
          const poolSet = new Set(pool.map(u => u.unit.toLowerCase()));
          const rest = garr.slice(1);                        // [0] = general's bodyguard (kept)
          const nonRecruit = rest.filter(u => !poolSet.has(u.toLowerCase()));
          // MONOTONY (user 2026-07-01): a garrison stacked with ≥3 of ONE unit is rebuilt into a
          // diversified set even when every unit is recruitable (e.g. Paestum's 7× roman leves).
          const dupCount = {}; rest.forEach(u => { const k = u.toLowerCase(); dupCount[k] = (dupCount[k] || 0) + 1; });
          const monotonous = Object.values(dupCount).reduce((a, b) => Math.max(a, b), 0) >= 3;
          const pop = prow.rows.pop;
          const base = (s.poAtSet != null ? s.poAtSet : prow.poAt.normal) - prow.rows.garrison;
          const needPts = Math.max(0, Math.min(16, Math.ceil((FLOOR_PO + 1 - base) / 5)));
          const minMen = Math.ceil(needPts * pop / 70);
          const bgMen = prow.rows.men - rest.reduce((a, u) => a + _menOf(u, us), 0);
          // TRIM (user 2026-07-01): fully-recruitable, non-monotonous, but OVER-garrisoned at the
          // town's optimal ("perfect") tax — s.poAtSet already reflects it (a low-growth town gets a
          // LOW bracket → high PO → few units needed). Keep the cheapest units up to the men floor
          // (min 1), suggest dropping the rest. Nothing added.
          if (!nonRecruit.length && !monotonous) {
            // Only trim a town whose BASE public order (at its optimal tax, WITHOUT any garrison)
            // already holds above the no-revolt floor — i.e. genuinely over-provisioned. A town at or
            // below the floor (e.g. Paestum at V.High: base −15, only reaching PO 70 via the capped
            // garrison) is NOT over-garrisoned — it needs every unit (or a tax cut). Never trim it.
            if (base <= FLOOR_PO) return null;
            const items = rest.map((u, idx) => ({ u, idx, up: (us[u.toLowerCase()] || {}).upkeep || 0, m: _menOf(u, us) })).sort((a, b) => a.up - b.up);
            const keepIdx = new Set(); let tmen = bgMen;
            for (const it of items) { if (tmen >= minMen && keepIdx.size >= 1) break; keepIdx.add(it.idx); tmen += it.m; }
            const dropItems = items.filter(it => !keepIdx.has(it.idx));
            if (!dropItems.length) return null;  // sized right — nothing to trim
            const keepUnits = rest.filter((_, idx) => keepIdx.has(idx));
            const finalMenT = bgMen + [...keepIdx].reduce((a, idx) => a + _menOf(rest[idx], us), 0);
            const poAfterT = Math.max(0, Math.min(200, Math.round(base + 5 * _garrPts(finalMenT, pop))));
            return { removeUnits: dropItems.map(it => it.u), addUnits: [], addSummary: [], trim: true, dropCount: dropItems.length, keepUnits, poAfter: poAfterT, upkeepDelta: -dropItems.reduce((a, it) => a + it.up, 0) };
          }
          const toDrop = monotonous ? rest.slice() : nonRecruit;  // rebuild all non-bodyguard when monotonous
          const keptRecruit = monotonous ? [] : rest.filter(u => poolSet.has(u.toLowerCase()));
          const keptMen = bgMen + keptRecruit.reduce((a, u) => a + _menOf(u, us), 0);
          const gapMen = Math.max(0, minMen - keptMen);
          const clsCount = {};
          toDrop.forEach(u => { const c = (us[u.toLowerCase()] || {}).cls; if (c) clsCount[c] = (clsCount[c] || 0) + 1; });
          const domCls = Object.keys(clsCount).sort((a, b) => clsCount[b] - clsCount[a])[0];
          const inf = pool.filter(u => u.category === "infantry" && !/general|bodyguard|captain/i.test(u.unit));
          if (!inf.length) {
            // No recruitable infantry here — an EMPTY pool (no military building) or a cavalry-only
            // pool. Can't offer a replacement, but still FLAG the town so the audit surfaces EVERY
            // settlement with an un-retrainable garrison (user 2026-07-01: "check all settlements").
            const dropUp0 = toDrop.reduce((a, u) => a + ((us[u.toLowerCase()] || {}).upkeep || 0), 0);
            const poAfter0 = Math.max(0, Math.min(200, Math.round(base + 5 * _garrPts(keptMen, pop))));
            const noMil = !(s.buildings || []).some(b => /military_industrial_complex|mic_\d|(^|[:\s])garrison([:\s]|$)/i.test(String(b)));
            return { removeUnits: toDrop, addUnits: [], addSummary: [], noRecruit: true, noMil, dropCount: toDrop.length, keepUnits: keptRecruit, monotonous, poAfter: poAfter0, upkeepDelta: -dropUp0 };
          }
          // DIVERSIFIED replacement (user 2026-07-01: "don't want 7 of the same unit"): round-robin
          // across the DISTINCT recruitable infantry — dominant dropped cls first, then cheapest —
          // adding one at a time until the garrison clears the men floor; always keep ≥1 unit.
          const candidates = inf.slice().sort((a, b) => ((a.cls === domCls ? 0 : 1) - (b.cls === domCls ? 0 : 1)) || ((a.upkeep || 0) - (b.upkeep || 0)));
          const addUnits = [];
          let men = keptMen, gi = 0;
          while ((men < minMen || (!addUnits.length && !keptRecruit.length)) && addUnits.length < 40) {
            const u = candidates[gi % candidates.length];
            addUnits.push(u.unit);
            men += _menOf(u.unit, us);
            gi++;
          }
          const finalMen = keptMen + addUnits.reduce((a, u) => a + _menOf(u, us), 0);
          const poAfter = Math.max(0, Math.min(200, Math.round(base + 5 * _garrPts(finalMen, pop))));
          const dropUp = toDrop.reduce((a, u) => a + ((us[u.toLowerCase()] || {}).upkeep || 0), 0);
          const addUp = addUnits.reduce((a, u) => a + ((us[u.toLowerCase()] || {}).upkeep || 0), 0);
          const grp = new Map(); for (const u of addUnits) grp.set(u, (grp.get(u) || 0) + 1);
          const addSummary = [...grp.entries()].map(([unit, count]) => ({ unit, count }));
          return { removeUnits: toDrop, addUnits, addSummary, dropCount: toDrop.length, keepUnits: keptRecruit, monotonous, poAfter, upkeepDelta: addUp - dropUp };
        };
        for (const s of budget.settlements) {
          const br = s.optimalBracket || "normal";
          // The save's stored PO is exact ONLY for the save's own PLAYER faction; for every
          // OTHER faction the save carries an unreliable value (AI Rome's Paestum read 225 → 155
          // at V.High vs the component model's 65 and the in-game 70 — like governors, the engine
          // doesn't keep a live PO for AI factions). The all-human DETERMINISTIC overview compares
          // every faction on equal footing, so it uses the component model (designed-start PO),
          // never the per-save anchor. Other modes keep the anchor (the player's own save = exact).
          const a = (!humanDifficulty) && poAnchorByCity && (poAnchorByCity[s.settlement] || poAnchorByCity[s.region]);
          if (a) {
            s.poAtSet = a.po - POD[a.bracket] + POD[br];
            s.poAtLow = a.po - POD[a.bracket];
            s.poExact = true; exactN++;
          } else {
            const p = po[s.settlement] || po[s.region];
            if (!p) continue;
            s.poAtSet = p.poAt[br] != null ? p.poAt[br] : p.poAt.normal;
            s.poAtLow = p.poAt.low;
          }
          // Public order is NOT in 5-point steps — the culture penalty can be non-5 (Neapolis 88).
          // Do NOT snap to 5; the save-anchored path carries the EXACT in-game PO. Integer-round
          // only for clean display.
          if (s.poAtSet != null) s.poAtSet = Math.round(s.poAtSet);
          if (s.poAtLow != null) s.poAtLow = Math.round(s.poAtLow);
          // user bands 2026-06-11: 0-74 red, 75-84 orange, 85-99 light green, 100+ dark green.
          s.poRisk = s.poAtSet < 75 ? "red" : s.poAtSet < 85 ? "orange" : s.poAtSet < 100 ? "lightgreen" : "green";
          if (s.poRisk === "red") flagged++;
          // PRIORITY GARRISON SUGGESTION (user 2026-06-11, Neapolis <75 case): red-band
          // towns get a concrete "add ≈N men" fix to reach the 85+ band. EXACT garrison
          // law (2026-06-12): PO% = 5·floor(70·men/pop) → ΔPO per man = 350/pop, 80% cap.
          if ((s.poRisk === "red" || s.poRisk === "orange") && s.pop) {
            const target = 85;
            s.garrisonFixMen = Math.max(40, Math.ceil((target - s.poAtSet) / 350 * s.pop / 10) * 10);
            // name a concrete fix: cheapest gated garrison-infantry unit covering the gap
            try { const gu = _recommendGarrisonUnit(s.buildings, s.region, s.garrisonFixMen); if (gu) { gu.poAfter = Math.min(200, Math.round((s.poAtSet + gu.n * gu.menPerUnit * 350 / s.pop) / 5) * 5); s.garrisonUnit = gu; } } catch { }
          }
          // GARRISON-REPLACE: any town whose starting garrison holds non-recruitable units (mod
          // AOR gating changed). The replace supersedes the add-fix (it sizes the garrison too).
          try { const prow = po[s.settlement] || po[s.region]; const gr = _recommendGarrisonReplace(s, prow); if (gr) { s.garrisonReplace = gr; delete s.garrisonUnit; } } catch { }
        }
        let replaceN = 0; for (const s of budget.settlements) if (s.garrisonReplace) replaceN++;
        if (replaceN) _writeLog(`[turn1-budget] ${faction}: ${replaceN} town(s) have non-recruitable starting garrisons → replace suggestions attached`);
        if (exactN) _writeLog(`[turn1-budget] ${faction}: PO anchored EXACT from calibration save for ${exactN} towns`);
        if (flagged) _writeLog(`[turn1-budget] ${faction}: PO model flags ${flagged} revolt-risk towns (po<100 at set bracket)`);
      } catch (e) { _writeLog(`[turn1-budget] PO model failed (non-fatal): ${e && e.message}`); }
      // SAVE LEDGER (user 2026-07-02, the Rome +5054-vs-+2699 report): when a calibration
      // save is attached, read the faction's OWN econ ledger from it and ship it along —
      // the authoritative in-game net at the save's CURRENT tax rates. The renderer offers
      // it as a one-click budget and uses it to flag a difficulty-mode mismatch (the report
      // was the all-human/Normal mode read on an H/H campaign: ÷0.92 ⇒ ≈ +9% income).
      if (savePath) {
        try {
          const as2 = require("./src/armySetup.js");
          const ab = as2.attributeAllBudgets(await fs.promises.readFile(savePath), modDataDir, null);
          const led = ab && ab.byFaction && ab.byFaction[String(faction).toLowerCase()];
          if (led && Number.isFinite(led.net)) {
            budget.saveLedger = { net: led.net, incomeTotal: led.income && led.income.total, taxes: led.income && led.income.taxes,
              armyUpkeep: led.armyUpkeep, isPlayer: ab.player === String(faction).toLowerCase(), player: ab.player, verified: !!led.verified };
            _writeLog(`[turn1-budget] ${faction}: save ledger net=${led.net} (player=${ab.player}${budget.saveLedger.isPlayer ? ", THIS faction" : ""}) vs model net=${budget.totals && (budget.totals.armyBudget - budget.totals.armyUpkeep)}`);
          }
        } catch (e) { _writeLog(`[turn1-budget] save-ledger read failed (non-fatal): ${e && e.message}`); }
      }
      budget.staleWarning = _modCopyWarning(modDataDir);
      if (budget.staleWarning) _writeLog(`[turn1-budget] STALE-MOD WARNING: ${budget.staleWarning}`);
      const t = budget.totals;
      _writeLog(`[turn1-budget] ${faction}: ${budget.settlements.length} towns tier=${budget.tier} ${budget.saveAware ? "SAVE-AWARE" : "no-save"} | taxes=${t.taxes} farm=${t.farming} mine=${t.mining} trade=${t.trade} → income=${t.income}${t.tributeIn ? ` +tribute=${t.tributeIn}` : ""} − wages=${t.wages} − corruption=${t.corruption} = armyBudget=${t.armyBudget}${t.tributeOut ? ` | PAYS tribute=${t.tributeOut} to suzerain` : ""}`);
    } else _writeLog(`[turn1-budget] ${faction}: FAILED ${budget && budget.error}`);
    return budget;
  } catch (e) { _writeLog(`[turn1-budget] failed: ${e && e.message}`); return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: mercenary pools from descr_mercenaries.txt (2026-06-08) — for the
// Mercenaries map layer. Returns { pools, byRegion:{region:{pools,units}}, poolNames }.
ipcMain.handle("get-mercenary-pools", async (_event, modDataDir) => {
  try {
    if (!modDataDir) return { error: "modDataDir required" };
    const mp = require("./src/mercenaryParser.js");
    const r = mp.parseMercenaries(modDataDir);
    if (r && r.pools) _writeLog(`[mercenaries] ${r.pools.length} pools, ${Object.keys(r.byRegion).length} regions covered`);
    return r;
  } catch (e) { _writeLog(`[mercenaries] failed: ${e && e.message}`); return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: add a region to a mercenary pool (edits descr_mercenaries.txt, CRLF-safe, backup).
ipcMain.handle("add-region-to-merc-pool", async (_event, modDataDir, poolName, region) => {
  try {
    if (!modDataDir || !poolName || !region) return { error: "missing args" };
    const mp = require("./src/mercenaryParser.js");
    const p = mp.findDescrMercenaries(modDataDir);
    if (!p || !fs.existsSync(p)) return { error: "descr_mercenaries.txt not found" };
    const text = fs.readFileSync(p, "latin1");
    const r = mp.addRegionToPool(text, poolName, region);
    if (!r.ok) return { error: r.error, already: !!r.already };
    try { fs.copyFileSync(p, p + ".provincia-bak"); } catch (e) { _writeLog(`[merc-add] backup failed: ${e && e.message}`); }
    fs.writeFileSync(p, r.text, "latin1");
    _writeLog(`[merc-add] added region "${region}" to pool "${poolName}" @line ${r.changedLine} ("${r.before}" → "${r.after}")`);
    return { ok: true, changedLine: r.changedLine, before: r.before, after: r.after, path: p };
  } catch (e) { _writeLog(`[merc-add] failed: ${e && e.message}`); return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: list the current campaign's factions (descr_strat faction lines).
ipcMain.handle("get-campaign-factions", async (_event, modDataDir) => {
  try {
    if (!modDataDir) return { error: "modDataDir required" };
    const as = require("./src/armySetup.js");
    return { factions: as.listCampaignFactions(modDataDir) };
  } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: apply ONE unit swap to descr_strat (army-setup). Surgical single-line swap,
// CRLF preserved, with a timestamped backup of the file first.
ipcMain.handle("apply-army-swap", async (_event, modDataDir, faction, character, oldUnit, newUnit) => {
  try {
    if (!modDataDir || !faction || !character || !oldUnit || !newUnit) return { error: "missing args" };
    const as = require("./src/armySetup.js");
    const p = as.findDescrStrat(modDataDir);
    if (!p || !fs.existsSync(p)) return { error: "descr_strat.txt not found" };
    const text = fs.readFileSync(p, "latin1");
    const r = as.applySwap(text, faction, character, oldUnit, newUnit);
    if (!r.ok) return { error: r.error };
    // backup before writing (single rolling .provincia-bak + a one-shot timestamp)
    try { fs.copyFileSync(p, p + ".provincia-bak"); } catch (e) { _writeLog(`[army-swap] backup failed: ${e && e.message}`); }
    fs.writeFileSync(p, r.text, "latin1");
    _writeLog(`[army-swap] ${faction}/${character}: "${oldUnit}" → "${newUnit}" @line ${r.changedLine}`);
    return { ok: true, changedLine: r.changedLine, before: r.before, after: r.after, path: p };
  } catch (e) {
    _writeLog(`[army-swap] failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: add one unit to a settlement's garrison army in descr_strat (CRLF-safe, backup).
ipcMain.handle("apply-add-garrison", async (_event, modDataDir, faction, settlementName, unitName) => {
  try {
    if (!modDataDir || !faction || !settlementName || !unitName) return { error: "missing args" };
    const as = require("./src/armySetup.js");
    const dg = require("./src/descrStratGeneral.js");
    const p = as.findDescrStrat(modDataDir);
    if (!p || !fs.existsSync(p)) return { error: "descr_strat.txt not found" };
    let regionToCity = {};
    try { const regPath = path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"); regionToCity = (dg.parseDescrRegions(fs.readFileSync(regPath, "utf8")) || {}).regionToCity || {}; } catch { }
    const text = fs.readFileSync(p, "latin1");
    const r = as.applyAddGarrison(text, faction, settlementName, unitName, regionToCity);
    if (!r.ok) return { error: r.error };
    try { fs.copyFileSync(p, p + ".provincia-bak"); } catch (e) { _writeLog(`[add-garrison] backup failed: ${e && e.message}`); }
    fs.writeFileSync(p, r.text, "latin1");
    _writeLog(`[add-garrison] ${faction} ${settlementName}: +1 "${unitName}" @line ${r.insertedAtLine} (${r.anchor})`);
    return { ok: true, insertedAtLine: r.insertedAtLine, anchor: r.anchor, newLine: r.newLine, path: p };
  } catch (e) {
    _writeLog(`[add-garrison] failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: append units to a NAMED CHARACTER's army in descr_strat (spend-headroom
// suggestions; CRLF-safe, backup, 20-unit cap enforced in armySetup).
ipcMain.handle("apply-add-army-units", async (_event, modDataDir, faction, character, unitNames) => {
  try {
    if (!modDataDir || !faction || !character || !Array.isArray(unitNames) || !unitNames.length) return { error: "missing args" };
    const as = require("./src/armySetup.js");
    const p = as.findDescrStrat(modDataDir);
    if (!p || !fs.existsSync(p)) return { error: "descr_strat.txt not found" };
    const text = fs.readFileSync(p, "latin1");
    const r = as.applyAddArmyUnits(text, faction, character, unitNames);
    if (!r.ok) return { error: r.error };
    try { fs.copyFileSync(p, p + ".provincia-bak"); } catch (e) { _writeLog(`[add-army-units] backup failed: ${e && e.message}`); }
    fs.writeFileSync(p, r.text, "latin1");
    _writeLog(`[add-army-units] ${faction}/${character}: +${r.addedCount} unit(s) [${unitNames.slice(0, r.addedCount).join(", ")}] @line ${r.insertedAtLine}${r.capClipped ? ` (CLIPPED from ${r.requested} — 20-unit cap)` : ""}`);
    return { ok: true, addedCount: r.addedCount, capClipped: r.capClipped, insertedAtLine: r.insertedAtLine, path: p };
  } catch (e) {
    _writeLog(`[add-army-units] failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: replace a settlement garrison's non-recruitable units with a recruitable one in
// descr_strat (drop removeUnits — never the bodyguard — add addCount× addUnit; CRLF-safe, backup).
ipcMain.handle("apply-replace-garrison", async (_event, modDataDir, faction, settlementName, removeUnits, addUnits) => {
  try {
    if (!modDataDir || !faction || !settlementName) return { error: "missing args" };
    const as = require("./src/armySetup.js");
    const dg = require("./src/descrStratGeneral.js");
    const p = as.findDescrStrat(modDataDir);
    if (!p || !fs.existsSync(p)) return { error: "descr_strat.txt not found" };
    let regionToCity = {};
    try { const regPath = path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"); regionToCity = (dg.parseDescrRegions(fs.readFileSync(regPath, "utf8")) || {}).regionToCity || {}; } catch { }
    const text = fs.readFileSync(p, "latin1");
    const r = as.applyReplaceGarrison(text, faction, settlementName, removeUnits || [], addUnits || [], regionToCity);
    if (!r.ok) return { error: r.error };
    try { fs.copyFileSync(p, p + ".provincia-bak"); } catch (e) { _writeLog(`[replace-garrison] backup failed: ${e && e.message}`); }
    fs.writeFileSync(p, r.text, "latin1");
    _writeLog(`[replace-garrison] ${faction} ${settlementName}: −${r.removedCount} non-recruitable, +${r.addedCount} unit(s) [${(r.addedLines || []).join(", ")}] (${r.anchor}; lineΔ ${r.lineDelta})`);
    return { ok: true, removedCount: r.removedCount, addedCount: r.addedCount, removedLines: r.removedLines, addedLines: r.addedLines, anchor: r.anchor, path: p };
  } catch (e) {
    _writeLog(`[replace-garrison] failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: zero illegitimate weapon/armour upgrades on a character's army (CRLF-safe, backup).
ipcMain.handle("apply-upgrade-fix", async (_event, modDataDir, faction, character, opts) => {
  try {
    if (!modDataDir || !faction || !character) return { error: "missing args" };
    const as = require("./src/armySetup.js");
    const p = as.findDescrStrat(modDataDir);
    if (!p || !fs.existsSync(p)) return { error: "descr_strat.txt not found" };
    const text = fs.readFileSync(p, "latin1");
    const r = as.applyUpgradeFix(text, faction, character, opts);
    if (!r.ok) return { error: r.error };
    try { fs.copyFileSync(p, p + ".provincia-bak"); } catch (e) { _writeLog(`[upgrade-fix] backup failed: ${e && e.message}`); }
    fs.writeFileSync(p, r.text, "latin1");
    _writeLog(`[upgrade-fix] ${faction}/${character}: zeroed ${r.fixed} unit upgrade line(s)`);
    return { ok: true, fixed: r.fixed };
  } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: army-setup analysis for one faction (2026-06-07) — descr_strat army +
// upkeep + balance, recruitable pool (full RIS gating), retraining availability.
// Budget (virtual tax) is computed in the renderer from saveEconomy. Returns the
// armySetup.analyzeFaction object.
ipcMain.handle("get-army-setup", async (_event, faction, modDataDir, floor) => {
  try {
    if (!faction || !modDataDir) return { error: "faction + modDataDir required" };
    const as = require("./src/armySetup.js");
    const r = as.analyzeFaction(modDataDir, faction, null, typeof floor === "number" ? floor : -500);
    if (r && !r.error) _writeLog(`[army-setup] ${faction}: armyUpkeep=${r.armyUpkeep} units=${r.summary?.totalArmyUnits} pool=${(r.settlements||[]).map(s=>s.pool.length).join("/")} flags=[${(r.summary?.flags||[]).join("; ")}]`);
    else _writeLog(`[army-setup] ${faction}: ${r && r.error}`);
    return r;
  } catch (e) {
    _writeLog(`[army-setup] failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: per-faction fog-of-war / explored map (2026-06-04). Returns the chosen
// faction's ever-explored tile grid (the corrected 1020×700 model — see
// findings-faction-knowledge-entities-2026-06-04.md). Record→faction is
// resolved robustly: engineOrder gives a fast primary pick, then we VERIFY by
// settlement coverage — a faction's own settlements are 100% on its own
// explored grid — and fall back to the best-covering record if the primary
// pick is poor. Self-validating, so it survives engineOrder's high-index
// off-by-one. `coverage` is returned so the UI can flag a weak match.
function readStratFactionOrder(modDataDir) {
  const candidates = [
    path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const text = fs.readFileSync(src, "utf8");
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*faction\s+([a-z_0-9]+)/i);
      if (m && !out.includes(m[1])) out.push(m[1]);
    }
    return out;
  }
  return [];
}
ipcMain.handle("get-faction-vision", async (_event, savePath, modDataDir, factionName) => {
  try {
    if (!savePath || !fs.existsSync(savePath)) return { error: "no save path" };
    if (!factionName) return { error: "no faction" };
    const { findFactionRecords, parseFactionKnowledge } = require("./src/factionKnowledgeParser.js");
    const { deriveEngineFactionOrder } = require("./src/saveCrackerExtras.js");
    const buf = await fs.promises.readFile(savePath); // async: saves are 30-45 MB — don't block the event loop on I/O
    const recs = findFactionRecords(buf);
    if (!recs.length) return { error: "no faction records" };
    const GRID_W = 1020, GRID_H = 700, CELLS = GRID_W * GRID_H;
    const stratOrder = readStratFactionOrder(modDataDir);
    const engineOrder = deriveEngineFactionOrder(stratOrder);
    // Case-insensitive name match against both orders (the renderer may pass a
    // name whose casing differs from descr_strat).
    const ci = (arr, name) => {
      let k = arr.indexOf(name);
      if (k >= 0) return k;
      const low = String(name).toLowerCase();
      return arr.findIndex((x) => x && x.toLowerCase() === low);
    };
    const stratIdx = ci(stratOrder, factionName);
    // F's own settlement tiles (engine linear index) from the global tag-27 set.
    const ownTiles = [];
    if (stratIdx >= 0) {
      const fk = parseFactionKnowledge(buf);
      const seen = new Set();
      for (const r of fk.records || []) {
        for (const t of r.tuples || []) {
          if (t.tag === 27 && t.owner === stratIdx && t.tileX < GRID_W && t.tileY < GRID_H) {
            const li = t.tileY * GRID_W + t.tileX;
            if (!seen.has(li)) { seen.add(li); ownTiles.push(li); }
          }
        }
      }
    }
    const decodeGrid = (rec) => {
      const grid = new Uint8Array(CELLS);
      let gi = 0, i = rec.offset + 0x18, MAX = Math.min(rec.offset + rec.size, buf.length);
      while (i + 2 <= MAX && gi < CELLS) {
        const v = buf[i], c = buf[i + 1];
        if (c === 0) break;
        const lim = Math.min(c, CELLS - gi);
        if (v !== 0) grid.fill(v, gi, gi + lim);
        gi += lim; i += 2;
      }
      return { grid, decoded: gi };
    };
    const coverage = (grid) => {
      if (!ownTiles.length) return -1; // unknown (can't verify)
      let hit = 0;
      for (const li of ownTiles) if (grid[li] > 0) hit++;
      return hit / ownTiles.length;
    };
    // Primary pick via engineOrder (case-insensitive).
    let recIdx = ci(engineOrder, factionName);
    _writeLog(`[fog] request "${factionName}" -> engineIdx=${recIdx} stratIdx=${stratIdx} ownTiles=${ownTiles.length}`);
    let best = null;
    if (recIdx >= 0 && recIdx < recs.length) {
      const d = decodeGrid(recs[recIdx]);
      if (d.decoded >= 100000) best = { idx: recIdx, grid: d.grid, cov: coverage(d.grid), decoded: d.decoded };
    }
    // Robust fallback: if the primary pick can't be verified well, search all
    // records for the one whose grid best covers F's settlements.
    if (ownTiles.length && (!best || best.cov < 0.7)) {
      for (let k = 0; k < recs.length; k++) {
        const d = decodeGrid(recs[k]);
        if (d.decoded < 100000) continue;
        const cov = coverage(d.grid);
        if (!best || cov > best.cov) best = { idx: k, grid: d.grid, cov, decoded: d.decoded };
      }
    }
    if (!best) return { error: "no decodable vision record" };
    let exploredCount = 0;
    for (let k = 0; k < CELLS; k++) if (best.grid[k] > 0) exploredCount++;
    _writeLog(`[fog] ${factionName} rec#${best.idx} cov=${best.cov < 0 ? "n/a" : (100 * best.cov).toFixed(0) + "%"} explored=${exploredCount}`);
    return {
      faction: factionName, width: GRID_W, height: GRID_H,
      grid: Buffer.from(best.grid), coverage: best.cov, exploredCount,
    };
  } catch (e) {
    _writeLog(`[fog] get-faction-vision failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: the faction list for the fog-of-war picker (2026-06-04). Returns ONLY
// factions whose vision record actually resolves from THIS save (engineOrder ↔
// record), with their explored-tile count — so the dropdown can never offer a
// name get-faction-vision can't honour (the prior empty/mismatched-dropdown
// bug). Excludes the rebel/slave records and the all-seeing record (explored ≈
// whole map) and dead/empty factions (explored < 50). Cheap: counts explored
// via the RLE walk without materialising grids.
ipcMain.handle("get-vision-faction-list", async (_event, savePath, modDataDir) => {
  try {
    if (!savePath || !fs.existsSync(savePath)) return { error: "no save path" };
    const { findFactionRecords } = require("./src/factionKnowledgeParser.js");
    const { deriveEngineFactionOrder } = require("./src/saveCrackerExtras.js");
    const buf = await fs.promises.readFile(savePath); // async: saves are 30-45 MB — don't block the event loop on I/O
    const recs = findFactionRecords(buf);
    const GRID_W = 1020, GRID_H = 700, CELLS = GRID_W * GRID_H;
    const stratOrder = readStratFactionOrder(modDataDir);
    const engineOrder = deriveEngineFactionOrder(stratOrder);
    const exploredOf = (rec) => {
      let i = rec.offset + 0x18, MAX = Math.min(rec.offset + rec.size, buf.length), total = 0, exp = 0;
      while (i + 2 <= MAX && total < CELLS) {
        const v = buf[i], c = buf[i + 1];
        if (c === 0) break;
        const lim = Math.min(c, CELLS - total);
        if (v !== 0) exp += lim;
        total += lim; i += 2;
      }
      return { exp, total };
    };
    const out = [];
    for (let i = 0; i < recs.length; i++) {
      const name = engineOrder[i];
      if (!name || /rebel|slave/i.test(name)) continue; // drop rebel/slave slots
      const { exp, total } = exploredOf(recs[i]);
      if (total !== CELLS) continue;                    // not a normal vision record
      if (exp < 50) continue;                           // dead / never-played faction
      if (exp > 0.85 * CELLS) continue;                 // all-seeing record
      out.push({ faction: name, explored: exp });
    }
    out.sort((a, b) => a.faction.localeCompare(b.faction));
    _writeLog(`[fog] faction-list: ${out.length} resolvable factions (of ${recs.length} records)`);
    return { factions: out };
  } catch (e) {
    _writeLog(`[fog] get-vision-faction-list failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: trade-network derivation (src/tradeNetwork.js). DERIVED, not stored in
// the save — computes road/sea connectivity + trade-rights gating to list each
// settlement's trade partners (CONFIRMED structure) plus a relative trade-score
// (HYPOTHESIS, clearly labelled in the UI). Computed on demand per save-file
// change, not on the hot live-watch path (it loads + walks the map TGA, so it's
// too slow to run every snapshot). savePath may be either a full path or, when
// the live watcher is active, omitted to use the last watched save buffer.
ipcMain.handle("crack-trade-network", async (_event, savePath, modDataDir, campaign) => {
  try {
    const { computeTradeNetwork } = require("./src/tradeNetwork.js");
    let buf;
    if (savePath && fs.existsSync(savePath)) {
      buf = await fs.promises.readFile(savePath);
    } else if (lastSaveBuf) {
      buf = lastSaveBuf; // live-watch path: reuse the buffer already in memory
    } else {
      return { error: "no save buffer available" };
    }
    const opts = campaign ? { campaign } : {};
    return computeTradeNetwork(buf, modDataDir, opts);
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: campaign-timeline scan (UI batch 2, feature 3). The app watches ONE
// live save; this scans a chosen folder of saves (e.g. the Feral autosave dir
// or a crash-save bundle), cracks each, sorts by the CRACKED turn number (not
// filename), and returns the per-turn arc + turn-to-turn deltas for the
// dominant (or all) campaign(s). Reuses scripts/campaign-timeline.js's
// buildTimeline + computeDelta verbatim, so the CLI and the in-app view share
// one source of truth — INCLUDING the family chain-break guard (deltas across
// different save chains are flagged, never fabricated). Heavy (cracks every
// save), so it's an explicit on-demand action, never on the hot live path.
ipcMain.handle("scan-saves-timeline", async (_event, dir, modDataDir, opts) => {
  try {
    const { buildTimeline, computeDelta } = require("./scripts/campaign-timeline.js");
    if (!dir || !fs.existsSync(dir)) return { error: "Folder not found: " + dir };
    const factionOverride = opts && opts.faction ? opts.faction : null;
    const allCampaigns = !!(opts && opts.allCampaigns);
    const { campaigns, errors, scanned } = buildTimeline([dir], modDataDir, factionOverride, allCampaigns);
    // Strip the internal-only fields (mirrors campaign-timeline.js --json) and
    // attach per-turn deltas so the renderer doesn't need the parser modules.
    const strip = (r) => { const { _ownerByCity, _diplomacy, _family, ...keep } = r; return keep; };
    return {
      scanned,
      errors,
      campaigns: campaigns.map((c) => ({
        player: c.player,
        saves: c.rows.length,
        turns: c.rows.map(strip),
        deltas: c.rows.slice(1).map((r, i) => ({ fromTurn: c.rows[i].turn, toTurn: r.turn, ...computeDelta(c.rows[i], r) })),
      })),
    };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: save a campaign data file. Writes to userData (authoritative store).
// In dev, also mirrors to build/ so the React dev server can fetch it.
// In packaged apps, build/ lives inside the read-only asar — skip it.
// Save-as dialog wrapper for ad-hoc CSV exports etc. Renderer-driven.
ipcMain.handle("save-file-as", async (_event, defaultName, content, filterDesc, filterExts) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: filterDesc || "All Files", extensions: filterExts || ["*"] }],
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, gameTextCRLF(result.filePath, content), "utf8");
  return result.filePath;
});

// Resolve `name` inside `baseDir`, rejecting path-traversal escapes
// (e.g. "..\\..\\x" or an absolute path). Returns the absolute path, or
// null when the joined path lands outside baseDir. Every IPC handler that
// takes a renderer-supplied file NAME (not a user-picked path) must route
// through this — the renderer only ever passes plain names/subpaths.
function resolveInside(baseDir, name) {
  return pathSafety.containedPath(baseDir, name);
}

ipcMain.handle("save-file", async (_event, name, content) => {
  try {
    const userDir = path.join(app.getPath("userData"), "campaign_data");
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    const dest = resolveInside(userDir, name);
    if (!dest) return false;
    fs.writeFileSync(dest, gameTextCRLF(name, content), "utf8");
    fs.writeFileSync(path.join(userDir, ".version_stamp"), app.getVersion(), "utf8");
    if (!app.isPackaged) {
      try {
        const buildDir = path.join(__dirname, "build");
        const buildDest = resolveInside(buildDir, name);
        if (buildDest) fs.writeFileSync(buildDest, gameTextCRLF(name, content), "utf8");
      } catch {}
    }
    return true;
  } catch { return false; }
});

// IPC: write a binary buffer (Uint8Array) to campaign_data + dev build/.
// Used by the map-paint Save TGA flow to persist edited map_regions.tga.
ipcMain.handle("write-binary-file", async (_event, name, dataBuf) => {
  try {
    const userDir = path.join(app.getPath("userData"), "campaign_data");
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    const dest = resolveInside(userDir, name);
    if (!dest) return false;
    const buf = Buffer.isBuffer(dataBuf) ? dataBuf : Buffer.from(dataBuf);
    fs.writeFileSync(dest, buf);
    fs.writeFileSync(path.join(userDir, ".version_stamp"), app.getVersion(), "utf8");
    if (!app.isPackaged) {
      try {
        const buildDir = path.join(__dirname, "build");
        const buildDest = resolveInside(buildDir, name);
        if (buildDest) fs.writeFileSync(buildDest, buf);
      } catch {}
    }
    return true;
  } catch (e) { console.warn("[write-binary-file]", e.message); return false; }
});

// IPC: copy a binary file to userData (and build/ for dev)
ipcMain.handle("copy-file", async (_event, src, destName) => {
  try {
    const userDir = path.join(app.getPath("userData"), "campaign_data");
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    // src may be anywhere (it comes from user-picked mod folders); only the
    // destination NAME is renderer-controlled and must stay inside userDir.
    const dest = resolveInside(userDir, destName);
    if (!dest) return false;
    fs.copyFileSync(src, dest);
    fs.writeFileSync(path.join(userDir, ".version_stamp"), app.getVersion(), "utf8");
    if (!app.isPackaged) {
      try {
        const buildDir = path.join(__dirname, "build");
        const buildDest = resolveInside(buildDir, destName);
        if (buildDest) fs.copyFileSync(src, buildDest);
      } catch {}
    }
    return true;
  } catch { return false; }
});

// IPC: read a campaign data file — checks userData first, then build/ (bundled fallback)
ipcMain.handle("read-campaign-file", async (_event, name) => {
  const userPath = resolveInside(path.join(app.getPath("userData"), "campaign_data"), name);
  if (userPath && fs.existsSync(userPath)) {
    try {
      if (name.endsWith(".tga") || name.endsWith(".png")) {
        const buf = fs.readFileSync(userPath);
        return { type: "binary", data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
      }
      return { type: "text", data: fs.readFileSync(userPath, "utf8") };
    } catch {}
  }
  return null; // fallback to fetch from build/
});

// IPC: save a file to the userData directory (persists across reloads)
ipcMain.handle("save-user-file", async (_event, name, content) => {
  try {
    const filePath = resolveInside(app.getPath("userData"), name);
    if (!filePath) return false;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, gameTextCRLF(filePath, content), "utf8");
    return true;
  } catch { return false; }
});

// IPC: read a file from the userData directory
ipcMain.handle("read-user-file", async (_event, name) => {
  try {
    const filePath = resolveInside(app.getPath("userData"), name);
    if (!filePath) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch { return null; }
});

// IPC: get app version
ipcMain.handle("get-app-version", () => app.getVersion());

// IPC: get platform-specific app data paths for auto-detection
ipcMain.handle("get-app-paths", () => {
  return {
    home: app.getPath("home"),
    appData: app.getPath("appData"),       // Roaming on Windows, ~/Library/Application Support on Mac
    localAppData: process.env.LOCALAPPDATA || null,  // Windows only
    platform: process.platform,
  };
});

// IPC: simple folder picker (for log directory)
ipcMain.handle("select-log-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select Rome Remastered logs folder (contains message_log.txt)",
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// IPC: pick a specific .sav to pin Live mode to. Opens the system file
// dialog in the given saveDir. Returns just the filename (not full path)
// so the renderer can pass it back to save-watch-start.
// 0.9.424: One-shot calibration parse. Takes a save path, runs the v1 char
// parser to extract `(firstName, lastName, faction, command, influence,
// management, loyalty)` per character, returns the flat list. Doesn't
// touch live-mode state — the renderer caches the result for non-live
// stat lookups.
ipcMain.handle("calibrate-from-save", async (_event, savePath) => {
  if (!savePath) return { ok: false, error: "no path" };
  if (!modNameLookup || !modTraitNames) {
    return { ok: false, error: "mod data not loaded — pick a mod folder first" };
  }
  try {
    const saveBuf = await fs.promises.readFile(savePath);
    const extras = parseCharactersAndUnits(saveBuf, null);
    if (!extras || !extras.characters) return { ok: false, error: "parse returned no characters" };
    const out = [];
    const turn = readTurnFromSave(saveBuf);

    // 0.9.454: re-enabled the v2 coord-portrait bridge with the tighter
    // resolver from 0.9.452. resolvePortraitsByCharacter now uses
    // back-scan-≤100-bytes from each UUID occurrence (not forward-sweep
    // of 60 u32 candidates), so the bridge produces accurate per-char
    // engine portraits instead of all-collapse to 000.tga.
    const coordToV2Portrait = new Map();
    const nameToV2Portrait = new Map();
    let v2CharCount = 0;
    const VALID_COORD = (v) => typeof v === "number" && v > 0 && v < 2048;
    const nameKey = (first, last, faction) => `${String(first || "").toLowerCase()}|${String(last || "").toLowerCase()}|${String(faction || "").toLowerCase()}`;
    try {
      const v2Chars = cxParseCharacterExtras(saveBuf);
      if (v2Chars) {
        cxAttachMapCoords(saveBuf, v2Chars);
        const portraitMap = cxResolvePortraits(saveBuf, v2Chars);
        for (const v2c of v2Chars) {
          const p = portraitMap.get(v2c.ownUuid);
          if (!p || !p.cards) continue;
          // 0.9.510: bridge by name+faction. v1's "primaryUuid" (offset-47)
          // and v2's "primaryUuid" (offset-12) are different binary fields
          // and don't match — confirmed by the v1-faction-tag log showing
          // 0/1287 matches via uuid. Name+faction is the only reliable
          // bridge between the two parsers.
          if (v2c.firstName) {
            nameToV2Portrait.set(nameKey(v2c.firstName, v2c.lastName, v2c.faction), p.cards);
            // Also index without lastName to catch v1's single-name chars.
            nameToV2Portrait.set(nameKey(v2c.firstName, "", v2c.faction), p.cards);
            // And without faction so a v1/v2 faction-tag mismatch still bridges.
            // First-wins so the most-specific entry doesn't get clobbered by ambiguous ones.
            const noFactionKey = nameKey(v2c.firstName, v2c.lastName, "");
            if (!nameToV2Portrait.has(noFactionKey)) nameToV2Portrait.set(noFactionKey, p.cards);
          }
          if (VALID_COORD(v2c.extX) && VALID_COORD(v2c.extY)) {
            const k = `${v2c.extX},${v2c.extY}`;
            if (!coordToV2Portrait.has(k)) coordToV2Portrait.set(k, p.cards);
          }
        }
        v2CharCount = v2Chars.length;
      }
    } catch (err) {
      console.warn("[calibrate] v2 portrait bridge failed:", err && err.message);
    }
    console.log(`[calibrate] v2 portrait bridge: ${nameToV2Portrait.size} name entries, ${coordToV2Portrait.size} coord entries from ${v2CharCount} v2 chars`);

    // 0.9.437: relaxed filter — keep characters with EITHER stats OR a
    // portrait. Previously chars whose stats didn't decode were dropped
    // entirely, which meant the bodyguard-swap portrait fallback never had
    // their entry in the cache. Symptom: Leonides (antigonid governor of
    // Pharsalos) showed bodyguard art + estimated stats even after
    // calibration, because his save record decoded a portrait but not
    // stats. Letting his portrait into the cache fixes the swap; the
    // approximate-stats label stays accurate (and clear) because the
    // entry's command/influence/management/loyalty stay null.
    let droppedNoData = 0;
    let portraitV2Coord = 0;
    let portraitV1Fallback = 0;
    let portraitNone = 0;
    for (const c of extras.characters) {
      const hasStats = !(c.command == null && c.influence == null && c.management == null);
      // 0.9.456 / 0.9.460 disabled v1's c.portraits[0] because of a single
      // case (Demetrios III) where forward-scan picked up an adjacent
      // record's pstr. 0.9.504: re-enabling because:
      //   - v2 doesn't find characters like Achaios at all (no type=3
      //     signature on their record). For those, v1's portrait is the
      //     ONLY save-derived signal we have. Without it, the renderer
      //     falls back to a hash pool that doesn't match in-game.
      //   - The v1 captain-banner filter (in characterParser.js) already
      //     rejects `data/ui/captain_banners/*` paths, which were the
      //     primary contamination class.
      //   - Independent verification on Achaios in both Macedon and
      //     Seleucid saves: same portrait path emitted from his record,
      //     consistent with his in-game face (young/generals/140.tga).
      // If a single cross-contamination case re-surfaces, we can scope
      // the fallback further (e.g. require the path's `culture`
      // component to match the character's faction's culture).
      // 0.9.508: v1's portraits[0] is right for some chars (Achaios →
      // `portraits/young/generals/140.tga`) and wrong for others where the
      // forward scan lands on a generic `cards/<bucket>/generals/000.tga`
      // placeholder (Antigonos II got generic 000 → wrong unit card).
      // v2's uuid-bridged portrait is authoritative when present (same source
      // the family tree uses), but doesn't cover every character. Strategy:
      // if v1 returned a generic 000 path, prefer v2; otherwise keep v1's
      // specific path. Falls back to v2 when v1 has nothing.
      // 0.9.511: v1 returns multiple candidate portraits in c.portraits[].
      // portraits[0] is often the wrong one — for Antigonos II it's a
      // generic `cards/<bucket>/generals/000.tga` placeholder; for Attalos
      // (alive) it's a `/dead/074.tga`. Scan c.portraits[] and prefer the
      // first NON-bad candidate before falling back to the first entry.
      // The v2 uuid/name bridges above (0.9.508 → 0.9.510) didn't fire —
      // cxParseCharacterExtras doesn't return names, and the two parsers'
      // primaryUuid fields are at different binary offsets.
      // 0.9.512: cracker diagnostic confirmed (scripts/diag-portraits.js
      // against save_macedon t0.sav):
      //   - AntigonosB: 1 record; BOTH v1 portraits are generic
      //     `cards/old/generals/000.tga` + `portraits/old/generals/000.tga`.
      //     There is no good v1 portrait — fall through to null so the
      //     bodyguard-swap falls back to the hash pool instead of using
      //     the generic 000 placeholder.
      //   - Attalos: TWO records at 0x15126d4 (portrait=dead/074, stub)
      //     and 0x1b78601 (portrait=young/137, real). Stats are null on
      //     both, traits 21 vs 23 — score tied. Nulling the bad-portrait
      //     stub's portrait makes the real record's good portrait win.
      // 0.9.519: dropped the "/000.tga is generic placeholder" rule. The
      // user's in-game labeled portraits confirmed 000 is a REAL specific
      // portrait (used as antigonid leader's bald+beard face). v1's
      // portrait scan correctly reads each character's NNN from the save;
      // we just need to trust it. Still reject /dead/ paths on alive chars
      // — those are usually the stub-record duplicate v1 sometimes finds.
      const isBadPath = (p) =>
        !p ||
        (!c.isDead && /\/dead\//i.test(p));
      const portraits = Array.isArray(c.portraits) ? c.portraits : [];
      const goodPortrait = portraits.find((p) => !isBadPath(p));
      const chosenPortrait = goodPortrait || null;
      if (goodPortrait) portraitV2Coord++;
      else if (portraits.length > 0) portraitV1Fallback++;
      else portraitNone++;
      // 0.9.453: KEEP every parsed char in the cache, even portrait+stats-
      // less. Previously this filter dropped them, which collapsed the
      // garrison bodyguard-swap to the generic icon for ~282 Macedon chars
      // (the ones who only had portrait, no stats). Symptom: "all garrison
      // cards show the same picture". Bodyguard-swap needs at least an
      // info entry (firstName + faction + age) so its IPC call lands in
      // the hash pool — without an entry it shows the unit icon fallback,
      // which is the same for every char.
      // (The drop is now only for chars with NO name at all, which would
      // give a useless cache entry.)
      if (!c.firstName) { droppedNoData++; continue; }
      // 0.9.494: per-character debug. Logs the parsed values for any
      // character matching a small watchlist of names we know go missing
      // from the cache, so we can see if the parser is producing them at
      // all and what their faction/stats look like in the save.
      const WATCHLIST = new Set(["achaios", "antigonos", "leonides", "omanes"]);
      if (WATCHLIST.has(String(c.firstName || "").toLowerCase())) {
        console.log(`[calibrate-watch] "${c.firstName}" lastName="${c.lastName || ""}" faction="${c.faction || ""}" stats=${c.command}/${c.influence}/${c.management}/${c.loyalty} age=${c.age} portraitsCount=${(c.portraits || []).length}`);
      }
      out.push({
        firstName: c.firstName,
        lastName: c.lastName,
        faction: c.faction,
        command: c.command,
        influence: c.influence,
        management: c.management,
        loyalty: c.loyalty,
        turn,
        // 0.9.429: also cache the engine-assigned portrait path. Lets
        // non-live mode swap bodyguard unit cards for the general's
        // face card without needing to be in live mode.
        // 0.9.445: prefer v2's coord-bridged portraitCardsPath (the
        // engine-exact file the family tree uses); fall back to v1's
        // c.portraits[0] when the coord bridge misses.
        portrait: chosenPortrait,
        // 0.9.451: include age so the non-live bodyguard-swap charContext
        // passes the right age bucket to the IPC. Without this, every
        // garrison commander hashes into the "young" bucket regardless of
        // actual age, picking the wrong file for old generals like
        // antigonid Antigonos II (age 50 → "old" bucket).
        age: typeof c.age === "number" ? c.age : null,
        secondaryUuid: c.secondaryUuid || null,
        // 0.9.503: trait count so the cache builder can prefer the
        // "real" record when two records exist with the same name
        // (e.g. Achaios in Seleucid T0: the parser finds two records,
        // the real one with 21 traits + correct stats and a stub with
        // 0 traits + zero stats). Without this, the second-encountered
        // record overwrote the first.
        traitCount: Array.isArray(c.traits) ? c.traits.length : 0,
      });
    }
    const withPortrait = out.filter(c => c.portrait).length;
    const withStats = out.filter(c => c.command != null || c.influence != null || c.management != null).length;
    console.log(`[calibrate] coverage: ${out.length} cached (${withStats} with stats, ${withPortrait} with portrait, ${droppedNoData} dropped with neither) out of ${extras.characters.length} total`);
    console.log(`[calibrate] portrait source breakdown: v2_coord=${portraitV2Coord} v1_fallback=${portraitV1Fallback} none=${portraitNone}`);
    const samples = out.slice(0, 5).map(c => `${c.firstName}|${c.lastName || ""}|${c.faction || "?"}=${c.command}/${c.influence}/${c.management}/${c.loyalty} portrait=${c.portrait ? c.portrait.slice(c.portrait.lastIndexOf("/") + 1) : "(none)"}`);
    // Also sample a char's raw portraits array to see what v1 produced
    const sampleRaw = extras.characters.slice(0, 3).map(c => `${c.firstName}|portraits=${JSON.stringify(c.portraits || [])}`).join(" | ");
    console.log(`[calibrate] parsed ${out.length}/${extras.characters.length} stat-bearing chars (${withPortrait} with portrait) from ${path.basename(savePath)} (turn ${turn ?? "?"}). Samples: ${samples.join("  |  ")}`);
    console.log(`[calibrate] raw portraits sample: ${sampleRaw}`);
    // 0.9.516: also build the v1PortraitsByCoord bridge here so the family
    // tree can render correct portraits in CALIBRATE mode (not just live
    // save-watch). User reported DemetriosC/Achaios showing v1's portrait in
    // the bodyguard unit card but falling to hash pool in the family tree —
    // because the calibrate IPC response didn't include this bridge.
    const v1PortraitsByCoord = {};
    for (const v of extras.characters) {
      if (v.tileX == null || v.tileY == null) continue;
      const ports = Array.isArray(v.portraits) ? v.portraits : [];
      const isBadPath = (p) =>
        !p ||
        (!v.isDead && /\/dead\//i.test(p));
      const goodLarge = ports.find((p) => !isBadPath(p) && /\/portraits\/portraits\//i.test(p));
      const goodAny = ports.find((p) => !isBadPath(p));
      const pick = goodLarge || goodAny;
      if (!pick) continue;
      const cards = pick.replace(/\/portraits\/portraits\//i, "/portraits/cards/");
      const fulls = pick.replace(/\/portraits\/cards\//i, "/portraits/portraits/");
      v1PortraitsByCoord[`${v.tileX},${v.tileY}`] = { cards, fulls };
    }
    console.log(`[calibrate] v1PortraitsByCoord: ${Object.keys(v1PortraitsByCoord).length} coord entries`);
    // 0.9.532: parse faction-level records here too, so the Wealth panel
    // (treasuries + AI personality + diplomacy) populates from a manual
    // Calibrate — previously these only came from the live save-watch path,
    // so calibrating without RTW running left the panel on descr_strat
    // starting values. Mirrors the parseSaveExtras faction block.
    let factionTreasuries = null, factionRecordOwners = null, factionDiplomacy = null, savePlayerFaction = null, allFactionDiplomacy = null, diplomacyMatrix = null, treasuryHistory = null;
    try {
      factionTreasuries = cxParseTreasuries(saveBuf);
      // Engine-order remap for the +44==8 positional layout (see parseSaveData).
      const calPositional = !!(factionTreasuries && factionTreasuries.length > 30);
      const calEngineOrder = calPositional ? cxDeriveEngineOrder(modFactionOrder) : modFactionOrder;
      if (factionTreasuries && factionTreasuries.length > 0) {
        factionRecordOwners = cxIdentifyRecordOwners(saveBuf, factionTreasuries, calEngineOrder);
        for (const o of factionRecordOwners) {
          const rec = factionTreasuries[o.recordIndex];
          const aiIdx = rec && typeof rec.aiPersonalityIndex === "number" ? rec.aiPersonalityIndex : null;
          o.aiPersonalityIndex = aiIdx;
          // Save-cracked aiPersonalityIndex is unreliable: the sub=8 record
          // layout (~91% of records on RIS T1017) doesn't decode the byte at
          // all (returns null), and the sub=6 layout's +135 offset returns
          // shifted values (ptolemaic reports ai_antigonid, seleucid reports
          // ai_ptolemaic, etc — off by one or worse). Until the layout is
          // re-cracked, prefer the descr_strat-declared `ai_<type>` as the
          // authoritative source (RTW never reassigns at runtime, so this
          // matches in-game behaviour). Save-cracked value is a last resort.
          const facName = (o.factionName || "").toLowerCase();
          const fromDescrStrat = modAiByFaction ? modAiByFaction[facName] : null;
          const fromSave = (modAiPersonalityOrder && aiIdx != null && aiIdx >= 0 && aiIdx < modAiPersonalityOrder.length)
            ? modAiPersonalityOrder[aiIdx] : null;
          o.aiPersonality = fromDescrStrat || fromSave || null;
          o.aiPersonalitySource = fromDescrStrat ? "descr_strat" : (fromSave ? "save" : null);
        }
        savePlayerFaction = cxIdentifyPlayerFromSave(saveBuf, factionTreasuries);
        factionDiplomacy = cxParseDiplomacy(saveBuf, factionTreasuries);
        const named = factionRecordOwners.filter(o => o.factionName).length;
        console.log(`[calibrate] faction records: ${factionTreasuries.length} treasuries, ${named} identified, player="${savePlayerFaction || "?"}"`);
      }
      // 0.9.539: live diplomacy counts for ALL factions (independent of the
      // 23-record set), keyed by faction name.
      allFactionDiplomacy = cxParseAllDiplomacy(saveBuf, modFactionOrder);
      console.log(`[calibrate] all-faction diplomacy: ${allFactionDiplomacy ? Object.keys(allFactionDiplomacy).length : 0} factions`);
      // 0.9.546: the N×N attitude matrix — NAMED live diplomacy (war/ally/
      // hostile per faction pair). The real diplomacy source (the zones above
      // only hold agreement handles). See reference_diplomacy_matrix.
      // The attitude matrix is indexed by descr_sm_factions DECLARATION order and
      // self-calibrates its index offset C from symmetry — so it needs the RAW
      // modFactionOrder, NOT the engine-derived order the record parsers use.
      // Passing the derived order double-applies the rebel-slot shift and
      // mislabels every pair (Macedon decoded as war:none/allied:galatians
      // instead of war:epirus,galatians). Verified vs Macedon T0 ground truth.
      diplomacyMatrix = cxParseDiplomacyMatrix(saveBuf, modFactionOrder);
      if (diplomacyMatrix && diplomacyMatrix._meta) {
        const mt = diplomacyMatrix._meta;
        console.log(`[diplo-matrix] calibrate: located base=0x${mt.base.toString(16)} stride=${mt.stride} N=${mt.N} C=${mt.C} symmetry=${(mt.symmetry*100).toFixed(0)}% warPairs=${mt.warPairs}`);
        const pf = (savePlayerFaction || "").toLowerCase();
        const row = pf && diplomacyMatrix[pf];
        if (row) console.log(`[diplo-matrix] ${pf}: war=[${(row.war||[]).join(", ")}] allied=[${(row.allied||[]).join(", ")}] trade=[${(row.trade||[]).join(", ")}]`);
      } else {
        console.log(`[diplo-matrix] calibrate: NOT located`);
      }
      // 0.9.549: per-faction treasury-over-time history (f13 checkpoints).
      // KEYED BY RECORD POSITION → descr_sm order (modFactionOrder), NOT
      // engineOrder. parseFactionTreasuryHistory indexes factionOrder by the
      // record's array position; engineOrder rotates the first rebel slot to the
      // end, which shifts every faction's history series by one slot (carthage's
      // timeline → "antigonid"). Fixed 2026-05-31 — see findings doc.
      if (factionTreasuries && factionTreasuries.length > 0) {
        treasuryHistory = cxParseTreasuryHistory(saveBuf, factionTreasuries, modFactionOrder);
        console.log(`[treasury-history] calibrate: ${treasuryHistory ? Object.keys(treasuryHistory).length : 0} factions`);
      }
    } catch (fe) { console.warn("[calibrate] faction parse failed:", fe && fe.message); }
    // The Wealth panel consumes `saveTreasuryRecords` in `{records:[{pos,
    // treasury,turnStart,regionCount}]}` shape (same as the live-snapshot
    // `treasuryByFaction`). Map factionTreasuries into that shape so the
    // panel populates from Calibrate exactly as it does from Live mode.
    const treasuryByFaction = (factionTreasuries && factionTreasuries.length > 0)
      ? { records: factionTreasuries.map(r => ({ pos: r.offset, treasury: r.treasury, turnStart: r.turnStartTreasury, regionCount: r.regionCount })) }
      : null;
    // 0.9.826: also parse settlement happiness / public-order from the save so
    // the Public Order (and Happiness) MAP MODES work from a CALIBRATE / pick-
    // save, not just live. Mirrors the live parseSaveData block: scan 0x01
    // settlement markers, read the f32 at marker-30, gated to the campaigns the
    // offset was verified on. See [happiness] notes in parseSaveData.
    let happinessByCity = null;
    try {
      const d = saveBuf;
      const campaignLen = d.length >= 0x40 ? d.readUInt16LE(0x3a) : 0;
      let campaignName = "";
      if (campaignLen > 0 && campaignLen < 64 && 0x3c + campaignLen * 2 <= d.length) {
        for (let i = 0; i < campaignLen; i++) {
          const ch = d.readUInt16LE(0x3c + i * 2);
          if (ch >= 0x20 && ch <= 0x7e) campaignName += String.fromCharCode(ch);
        }
      }
      if (campaignName === "imperial_campaign" || campaignName === "ris_classic") {
        happinessByCity = {};
        for (let i = 0; i < d.length - 10; i++) {
          if (d[i] !== 0x01) continue;
          const r = readUtf16Name(d, i + 1, d.length);
          if (!r) continue;
          const off = i - 30;
          if (off < 0 || off + 4 > d.length) continue;
          const v = d.readFloatLE(off);
          if (Number.isFinite(v) && v >= 0 && v <= 500) happinessByCity[r.name] = v;
        }
      }
    } catch (he) { console.warn("[calibrate] happiness parse failed:", he && he.message); happinessByCity = null; }
    console.log(`[calibrate] happinessByCity: ${happinessByCity ? Object.keys(happinessByCity).length : 0} settlements (campaign-gated)`);
    return {
      ok: true, characters: out, turn, total: extras.characters.length, v1PortraitsByCoord,
      factionTreasuries, factionRecordOwners, factionDiplomacy, savePlayerFaction, treasuryByFaction, allFactionDiplomacy, diplomacyMatrix, treasuryHistory,
      happinessByCity,
    };
  } catch (e) {
    console.warn("[calibrate] failed:", e && e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("select-save-files", async (_event, saveDir) => {
  // Multi-select variant of select-save-file: pick 1+ turn-1 saves so the Army-Setup
  // Balance overview can median each faction's economy across them, smoothing the
  // engine's per-campaign governor-trait randomness. Returns { paths: [...] } or null.
  const normalised = saveDir ? path.normalize(saveDir) : undefined;
  const result = await dialog.showOpenDialog({
    defaultPath: normalised,
    filters: [{ name: "Rome save files", extensions: ["sav"] }],
    properties: ["openFile", "multiSelections"],
    title: "Pick one or more turn-1 saves — the overview medians across them",
  });
  if (result.canceled || !result.filePaths.length) return null;
  return { paths: result.filePaths };
});

ipcMain.handle("select-save-file", async (_event, saveDir) => {
  // Normalise to the platform's path separator — Electron's defaultPath
  // honours mixed slashes on Windows but forward slashes alone sometimes
  // open the wrong directory. path.normalize takes care of it.
  const normalised = saveDir ? path.normalize(saveDir) : undefined;
  const result = await dialog.showOpenDialog({
    defaultPath: normalised,
    filters: [{ name: "Rome save files", extensions: ["sav"] }],
    properties: ["openFile"],
    title: "Pick the save Live mode should track",
  });
  if (result.canceled || !result.filePaths.length) return null;
  const full = result.filePaths[0];
  if (saveDir) {
    const a = path.normalize(full).toLowerCase();
    const b = path.normalize(saveDir).toLowerCase();
    if (!a.startsWith(b)) return { error: "Picked file is outside the saves folder.", path: full };
  }
  return { file: path.basename(full), path: full };
});

// ── Live log watcher for Rome Remastered ──────────────────────────────────
// Watches message_log.txt and campaign_ai_log.txt, tails new lines, sends to renderer.
let logWatcher = null;
let logWatcherAI = null;
let logOffset = 0;
let logOffsetAI = 0;
let logPollInterval = null;
// Current turn index for events (1-based). Increments on each "end round"
// marker encountered while processing message_log lines.
let logPollTurnIdx = 1;

// Track army merges so the leader's MOVING_NORMAL events propagate to
// passengers (lesser generals stacked into the leader's army).
//
// In RTW: when general A walks onto general B's tile and the user accepts
// the merge prompt, the engine emits a `transferring general(A:uuid) unit(uuid)
// from army(A_army) to named general(B:uuid):army(B_army)` line. From that
// point on the engine tracks the merged stack under B's army_uuid, and
// future moves emit MOVING_NORMAL only for B (the leader). A's marker
// goes dark — until the next save snapshot updates A's character record
// with the new (x, y).
//
// Map: leaderCharUuid → array of { charUuid, name, faction } passengers.
// Cleared on log-watch-start (new campaign / fresh attach).
const armyPassengers = new Map();
// Reverse map for fast "is this character a passenger?" lookup, used to
// drop a stale passenger relationship when the same character later
// becomes a passenger of someone else (or the leader of their own stack).
const passengerToLeader = new Map();
// Live unit-flow tracking. Each transfer event in the log either moves
// ONE unit between armies (so its leader chars), or moves a general (with
// their bodyguard unit) between armies. We track the cumulative count of
// units that flowed from one leader to another, then send a snapshot to
// the renderer so the field-army `byCmd` grouping can re-bucket save
// units accordingly.
//
// Why count-based instead of identity-based: the engine's runtime memory
// uuid for a unit (e.g. `8f4f1c10` in the log) has no mapping to a save
// unit (save units are identified by file offset and don't carry a stable
// uuid that matches the runtime pointer). So we can't say "unit X moved
// from save's-Aulus-roster to save's-Marcus-roster" by identity. But we
// CAN say "13 units moved from Aulus's leader-runtime to Marcus's
// leader-runtime", which we then apply by donating 13 generic foot units
// from save-Aulus's roster to save-Marcus's roster on the renderer.
//
// Structure: unitFlow[fromRuntimeCharUuid][toRuntimeCharUuid] = count
const unitFlowFromTo = new Map();
// Who leads each army at any given time. Updated on transfer events.
// Needed to identify the donor character when a unit transfer says
// "from army(A) to named general(Y):army(B)" — Y is explicit, but the
// donor is whoever leads A.
const armyLeaderByArmyUuid = new Map();
// Runtime char uuid → { name } as seen in log events. Lets us attach
// names to flow snapshots so the renderer can match against save chars
// by (firstName, lastName, faction) instead of via the unstable runtime
// uuid → save secondaryUuid bridge. 0.9.271 used a weak first-name-only
// fallback which caused the Uria misattribution flood; tracking the
// full name from the log event itself avoids that class of bug.
const charNameByRuntimeUuid = new Map();
function recordCharName(uuid, name) {
  if (uuid && name && !charNameByRuntimeUuid.has(uuid)) {
    charNameByRuntimeUuid.set(uuid, name);
  }
}
function unitFlowAdd(from, to) {
  if (!from || !to || from === to) return;
  if (!unitFlowFromTo.has(from)) unitFlowFromTo.set(from, new Map());
  const inner = unitFlowFromTo.get(from);
  inner.set(to, (inner.get(to) || 0) + 1);
}
function unitFlowSnapshot() {
  const out = [];
  for (const [from, inner] of unitFlowFromTo) {
    for (const [to, count] of inner) {
      out.push({
        from, to, count,
        fromName: charNameByRuntimeUuid.get(from) || null,
        toName: charNameByRuntimeUuid.get(to) || null,
      });
    }
  }
  return out;
}

// Last seen army_uuid per character. Used to detect SPLITS: when a
// character's MOVING_NORMAL event reports a different army_uuid than we
// last saw, AND we already had passengers attached, it means they split
// off into a new army WITHOUT bringing their passengers along (the
// passengers stay in the old army at the split tile). Per save_rome10's
// log, the BESIEGE-to-Brundisium event for Marcus comes BEFORE the
// `transferring general(Marcus:X) ... to named general(Marcus:X):army(NEW)`
// transfer line — so we can't wait for the self-transfer to fire to clear
// the relationship; we have to read the new army_uuid off the move itself.
const armyUuidByCharUuid = new Map();
function setPassenger(leaderUuid, passengerUuid, passengerName, passengerFaction) {
  if (!leaderUuid || !passengerUuid) return;
  // Self-transfer (movedChar === toCommander) signals a SPLIT: the
  // general is moving themselves into a new empty army. Adding them to
  // their own passenger list would synthesize duplicate move events
  // forever. Skip — the split-detection in detectAndApplySplit already
  // cleared any prior passengers when the move event with the new
  // army_uuid fired.
  if (leaderUuid === passengerUuid) return;
  // Remove the passenger from any prior leader's list.
  const priorLeader = passengerToLeader.get(passengerUuid);
  if (priorLeader && priorLeader !== leaderUuid) {
    const priorList = armyPassengers.get(priorLeader);
    if (priorList) {
      const filtered = priorList.filter(p => p.charUuid !== passengerUuid);
      if (filtered.length) armyPassengers.set(priorLeader, filtered);
      else armyPassengers.delete(priorLeader);
    }
  }
  if (!armyPassengers.has(leaderUuid)) armyPassengers.set(leaderUuid, []);
  const list = armyPassengers.get(leaderUuid);
  if (!list.some(p => p.charUuid === passengerUuid)) {
    list.push({ charUuid: passengerUuid, name: passengerName, faction: passengerFaction });
  }
  passengerToLeader.set(passengerUuid, leaderUuid);
}
function clearPassengers() {
  armyPassengers.clear();
  passengerToLeader.clear();
  armyUuidByCharUuid.clear();
  unitFlowFromTo.clear();
  armyLeaderByArmyUuid.clear();
  charNameByRuntimeUuid.clear();
}
// Called on every character_move BEFORE fanout. If the moving character's
// army_uuid doesn't match the last seen value AND they have passengers,
// they've split off — clear the passenger list so we don't drag the lesser
// general(s) along to the new army's destination. Returns true if a split
// was detected (caller can skip fanout entirely).
function detectAndApplySplit(charUuid, newArmyUuid) {
  if (!charUuid || !newArmyUuid) return false;
  const prev = armyUuidByCharUuid.get(charUuid);
  armyUuidByCharUuid.set(charUuid, newArmyUuid);
  if (!prev || prev === newArmyUuid) return false;
  const passengers = armyPassengers.get(charUuid);
  if (!passengers || passengers.length === 0) return false;
  for (const p of passengers) passengerToLeader.delete(p.charUuid);
  armyPassengers.delete(charUuid);
  return true;
}

// Handle a unit-transfer event for the flow tracker. Pass in the transfer's
// fromArmyUuid, toArmyUuid, the named-general char uuid of the to-army
// (recipient = explicit), and OPTIONALLY the runtime char uuid of the
// general moving for general-transfer events. The donor is `armyLeader[from]`.
function recordUnitTransfer(fromArmyUuid, toArmyUuid, recipientCharUuid, movingGeneralUuid) {
  // Update leader tracking. When a general transfer fires, set the named
  // general as the recipient army's leader (if no one's there yet) AND
  // ensure the moving general was the from-army's leader (so we know
  // who's donating). This handles both merge and split forms.
  if (movingGeneralUuid && fromArmyUuid && !armyLeaderByArmyUuid.has(fromArmyUuid)) {
    armyLeaderByArmyUuid.set(fromArmyUuid, movingGeneralUuid);
  }
  if (recipientCharUuid && toArmyUuid && !armyLeaderByArmyUuid.has(toArmyUuid)) {
    armyLeaderByArmyUuid.set(toArmyUuid, recipientCharUuid);
  }
  const donor = fromArmyUuid ? armyLeaderByArmyUuid.get(fromArmyUuid) : null;
  const recipient = recipientCharUuid || (toArmyUuid ? armyLeaderByArmyUuid.get(toArmyUuid) : null);
  if (donor && recipient && donor !== recipient) unitFlowAdd(donor, recipient);
  // Update leader-after-the-move logic for general-transfer events.
  if (movingGeneralUuid) {
    // If the moving general was the from-army's leader, then they're
    // leaving an army that may now be empty (split, single-general case)
    // OR still have passengers. We can't know without more state — leave
    // armyLeader[from] alone; subsequent transfer events from the same
    // army will re-confirm or update it via the recipient pattern.
    // If self-transfer (moving=recipient), recipient is now the leader
    // of the to-army (already set above).
  }
}

// Reset live-log tracking without restarting the watcher: re-anchor to
// current EOF, drop passenger / flow / position state, tell the renderer
// to clear its live caches. User-triggered "fresh start" — for when
// they've just loaded a save mid-session and want to ignore log entries
// written by the previous game state.
ipcMain.handle("log-watch-reset", async () => {
  if (!logPollInterval) return { ok: false, reason: "log-watch not running" };
  const msgPath = _logPath ? path.dirname(_logPath) : null;
  // We rely on the existing poll's msgPath; that's captured inside the
  // closure of the interval callback (line ~3450). Easier: re-stat the
  // file using the path the watcher most recently saw.
  try {
    // Approximation: bump offset to the current size of message_log.txt.
    // Find the log dir from the running interval: we tracked it via the
    // outer closure variable. Read directly from disk using the env we
    // set at watch-start (stored in module-scope `_lastWatchedLogDir`).
    if (_lastWatchedLogDir) {
      const p = path.join(_lastWatchedLogDir, "message_log.txt");
      logOffset = fs.existsSync(p) ? fs.statSync(p).size : logOffset;
      const ap = path.join(_lastWatchedLogDir, "campaign_ai_log.txt");
      logOffsetAI = fs.existsSync(ap) ? fs.statSync(ap).size : logOffsetAI;
    }
    clearPassengers();
    logPollTurnIdx = 1;
    const winR = BrowserWindow.getAllWindows()[0];
    if (winR) winR.webContents.send("live-char-moves", { moves: [], deaths: [], reset: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

let _lastWatchedLogDir = null;

ipcMain.handle("log-watch-start", async (_event, logDir) => {
  // Stop any existing watcher
  if (logPollInterval) { clearInterval(logPollInterval); logPollInterval = null; }

  const msgPath = path.join(logDir, "message_log.txt");
  const aiPath = path.join(logDir, "campaign_ai_log.txt");

  if (!fs.existsSync(msgPath)) return { error: "message_log.txt not found in " + logDir };
  _lastWatchedLogDir = logDir;

  // Start from current end of file (only watch new lines)
  try { logOffset = fs.statSync(msgPath).size; } catch { logOffset = 0; }
  try { logOffsetAI = fs.statSync(aiPath).size; } catch { logOffsetAI = 0; }

  // Reset turn counter for this fresh watch cycle.
  logPollTurnIdx = 1;
  // Clear passenger tracking from any prior watch cycle.
  clearPassengers();

  // Clear any prior live-position state in the renderer before backfilling.
  // Otherwise stale entries from a previous campaign would mix with the new
  // log's data.
  try {
    const winClear = BrowserWindow.getAllWindows()[0];
    if (winClear) winClear.webContents.send("live-char-moves", { moves: [], deaths: [], reset: true });
  } catch {}

  // Backfill: parse the whole existing log once for character-move events
  // so the renderer has a populated live-positions map right away (user
  // shouldn't have to wait for a new move to happen to see armies in their
  // correct spots).
  try {
    const win0 = BrowserWindow.getAllWindows()[0];
    if (fs.existsSync(msgPath) && win0) {
      const fullText = fs.readFileSync(msgPath, "utf8");
      const moves = [];
      const deaths = [];
      // Tag each event with the turn it happened in. Count "end round"
      // markers to delimit turns. The renderer uses `turn` to filter log
      // events when the user is viewing an older save (avoids showing
      // future positions).
      let backfillTurn = 1;
      for (const line of fullText.split(/\r?\n/)) {
        if (line.startsWith("=================")) {
          if (line.includes("end round")) backfillTurn++;
          continue;
        }
        const ev = parseLogLineV2(line);
        if (!ev) continue;
        if (ev.type === "character_move") {
          // Detect split: if this move's army_uuid differs from what we
          // had recorded, the character moved to a new army without
          // their passengers. Clears the passenger list so the fanout
          // below doesn't fire for ex-passengers.
          detectAndApplySplit(ev.charUuid, ev.armyUuid);
          moves.push({ name: ev.name, faction: ev.faction, role: ev.role, x: ev.toX, y: ev.toY, armyUuid: ev.armyUuid, charUuid: ev.charUuid, turn: backfillTurn });
          // Propagate to passengers: the leader is the one emitting
          // MOVING_NORMAL; lesser generals folded into this stack don't
          // emit their own move event, so synthesize one per passenger.
          const passengers = ev.charUuid ? armyPassengers.get(ev.charUuid) : null;
          if (passengers) {
            for (const p of passengers) {
              moves.push({ name: p.name, faction: p.faction || ev.faction, role: ev.role, x: ev.toX, y: ev.toY, armyUuid: ev.armyUuid, charUuid: p.charUuid, turn: backfillTurn });
            }
          }
        } else if (ev.type === "general_transfer") {
          // Empirically verified against save_rome10's message_log:
          //   `transferring general(Marcus:...) unit(...) from army(A) to named general(Aulus:...):army(B)`
          // After this, Aulus's uuid never appears in another event.
          // Marcus emits BESIEGE for the merged stack's move to Uria.
          // So in this transfer form: the MOVED general (X) is the
          // active mover that keeps emitting MOVING_NORMAL, and the
          // DESTINATION army's named general (Z) is the passive
          // passenger whose marker would otherwise freeze. Don't read
          // intent into Z (governor / faction leader / whatever) —
          // just trust the log: Z stops emitting after the transfer,
          // so we propagate X's moves to Z.
          setPassenger(ev.movedCharUuid, ev.toCommanderUuid, ev.toCommanderName, null);
          // Update the army-uuid tracking so the next MOVING_NORMAL for
          // the moved general doesn't trigger split-detection (the move
          // will use the destination army's uuid, which is the new
          // expected value after a merge). Without this, the merge
          // itself would look like a split — the very next move event's
          // armyUuid differs from the pre-merge tracking value.
          if (ev.movedCharUuid && ev.toArmyUuid) {
            armyUuidByCharUuid.set(ev.movedCharUuid, ev.toArmyUuid);
          }
          recordCharName(ev.movedCharUuid, ev.movedCharName);
          recordCharName(ev.toCommanderUuid, ev.toCommanderName);
          recordUnitTransfer(ev.fromArmyUuid, ev.toArmyUuid, ev.toCommanderUuid, ev.movedCharUuid);
        } else if (ev.type === "unit_transfer") {
          recordCharName(ev.toCommanderUuid, ev.toCommanderName);
          recordUnitTransfer(ev.fromArmyUuid, ev.toArmyUuid, ev.toCommanderUuid, null);
        } else if (ev.type === "fleeing") {
          moves.push({ name: ev.name, faction: ev.faction, role: ev.role, x: ev.toX, y: ev.toY, charUuid: null, turn: backfillTurn });
        } else if (ev.type === "flee_tile" || ev.type === "fleeing_to_settlement") {
          moves.push({ name: ev.name, faction: ev.faction || null, x: ev.x, y: ev.y, armyUuid: ev.armyUuid, charUuid: ev.charUuid, turn: backfillTurn });
        } else if (ev.type === "army_created") {
          moves.push({ name: ev.name, faction: null, x: ev.x, y: ev.y, charUuid: ev.charUuid, turn: backfillTurn });
        } else if (ev.type === "army_dead") {
          deaths.push({ name: ev.commanderName, faction: ev.faction, turn: backfillTurn });
        } else if ((ev.type === "char_death" || ev.type === "char_dying") && !ev.alive) {
          deaths.push({ name: ev.name, faction: ev.faction, turn: backfillTurn });
        } else if (ev.type === "character_deleted") {
          deaths.push({ charUuid: ev.charUuid, turn: backfillTurn });
        }
      }
      // Sync poll-side counter so subsequent delta reads continue from here.
      logPollTurnIdx = backfillTurn;
      if (moves.length > 0 || deaths.length > 0) {
        // Chunk moves; send deaths separately (smaller).
        const CHUNK = 1000;
        for (let i = 0; i < moves.length; i += CHUNK) {
          win0.webContents.send("live-char-moves", { moves: moves.slice(i, i + CHUNK) });
        }
        if (deaths.length > 0) win0.webContents.send("live-char-moves", { moves: [], deaths });
      }
      // Send the unit-flow snapshot after backfill so the renderer can
      // re-bucket save units in the field-army panel before the user
      // interacts. Snapshot is the cumulative {from, to, count} flow built
      // from every transfer event seen so far.
      const flow = unitFlowSnapshot();
      if (flow.length > 0) win0.webContents.send("live-char-moves", { moves: [], unitFlow: flow });
    }
  } catch (e) { console.warn("[log-watch] backfill failed:", e.message); }

  // Poll every 2 seconds for new data
  logPollInterval = setInterval(() => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    // Read new lines from message_log
    try {
      const stat = fs.statSync(msgPath);
      if (stat.size > logOffset) {
        const fd = fs.openSync(msgPath, "r");
        const buf = Buffer.alloc(stat.size - logOffset);
        fs.readSync(fd, buf, 0, buf.length, logOffset);
        fs.closeSync(fd);
        logOffset = stat.size;
        const text = buf.toString("utf8");
        if (text.trim()) {
          win.webContents.send("log-lines", { source: "message", text });
          // Also extract character-move + death events for live tracking.
          const moves = [];
          const deaths = [];
          for (const line of text.split(/\r?\n/)) {
            if (line.startsWith("=================")) {
              if (line.includes("end round")) logPollTurnIdx++;
              continue;
            }
            const ev = parseLogLineV2(line);
            if (!ev) continue;
            const turn = logPollTurnIdx;
            if (ev.type === "character_move") {
              detectAndApplySplit(ev.charUuid, ev.armyUuid);
              moves.push({ name: ev.name, faction: ev.faction, role: ev.role, x: ev.toX, y: ev.toY, armyUuid: ev.armyUuid, charUuid: ev.charUuid, turn });
              const passengers = ev.charUuid ? armyPassengers.get(ev.charUuid) : null;
              if (passengers) {
                for (const p of passengers) {
                  moves.push({ name: p.name, faction: p.faction || ev.faction, role: ev.role, x: ev.toX, y: ev.toY, armyUuid: ev.armyUuid, charUuid: p.charUuid, turn });
                }
              }
            } else if (ev.type === "general_transfer") {
              setPassenger(ev.movedCharUuid, ev.toCommanderUuid, ev.toCommanderName, null);
              if (ev.movedCharUuid && ev.toArmyUuid) {
                armyUuidByCharUuid.set(ev.movedCharUuid, ev.toArmyUuid);
              }
              recordUnitTransfer(ev.fromArmyUuid, ev.toArmyUuid, ev.toCommanderUuid, ev.movedCharUuid);
            } else if (ev.type === "unit_transfer") {
              recordUnitTransfer(ev.fromArmyUuid, ev.toArmyUuid, ev.toCommanderUuid, null);
            } else if (ev.type === "fleeing") {
              moves.push({ name: ev.name, faction: ev.faction, role: ev.role, x: ev.toX, y: ev.toY, charUuid: null, turn });
            } else if (ev.type === "flee_tile" || ev.type === "fleeing_to_settlement") {
              moves.push({ name: ev.name, faction: ev.faction || null, x: ev.x, y: ev.y, armyUuid: ev.armyUuid, charUuid: ev.charUuid, turn });
            } else if (ev.type === "army_created") {
              moves.push({ name: ev.name, faction: null, x: ev.x, y: ev.y, charUuid: ev.charUuid, turn });
            } else if (ev.type === "army_dead") {
              deaths.push({ name: ev.commanderName, faction: ev.faction, turn });
            } else if (ev.type === "char_death" || ev.type === "char_dying") {
              // Treat DYING events as "remove from map" regardless of
              // the death_type flag. DET_ALIVE means the character
              // survived (e.g. captured / exiled rather than killed),
              // but their army was destroyed and they no longer hold a
              // map position — exactly the case the user hit when
              // capturing Brundisium and seeing Titus's marker linger
              // (DET_ALIVE was being filtered out, so the marker stuck
              // until the next save snapshot dropped him).
              deaths.push({ name: ev.name, faction: ev.faction, charUuid: ev.charUuid, turn });
            } else if (ev.type === "character_deleted") {
              deaths.push({ charUuid: ev.charUuid, turn });
            }
          }
          // Always include the latest unit-flow snapshot alongside any
          // move/death batch — it's small and lets the renderer re-bucket
          // units on every live event.
          const flow = unitFlowSnapshot();
          if (moves.length > 0 || deaths.length > 0 || flow.length > 0) {
            win.webContents.send("live-char-moves", { moves, deaths, unitFlow: flow });
          }
        }
      } else if (stat.size < logOffset) {
        // File was truncated (new campaign started) — reset and notify
        logOffset = 0;
        win.webContents.send("log-lines", { source: "reset", text: "" });
        win.webContents.send("live-char-moves", { moves: [], reset: true });
      }
    } catch {}

    // Read new lines from campaign_ai_log
    try {
      if (fs.existsSync(aiPath)) {
        const stat = fs.statSync(aiPath);
        if (stat.size > logOffsetAI) {
          const fd = fs.openSync(aiPath, "r");
          const buf = Buffer.alloc(stat.size - logOffsetAI);
          fs.readSync(fd, buf, 0, buf.length, logOffsetAI);
          fs.closeSync(fd);
          logOffsetAI = stat.size;
          const text = buf.toString("utf8");
          if (text.trim()) win.webContents.send("log-lines", { source: "ai", text });
        } else if (stat.size < logOffsetAI) {
          logOffsetAI = 0;
        }
      }
    } catch {}
  }, 2000);

  return { ok: true, msgPath, aiPath };
});

ipcMain.handle("log-watch-stop", async () => {
  if (logPollInterval) { clearInterval(logPollInterval); logPollInterval = null; }
  return { ok: true };
});

// Allow reading the full log files for initial parse (backfill)
ipcMain.handle("log-read-full", async (_event, logDir) => {
  const msgPath = path.join(logDir, "message_log.txt");
  const aiPath = path.join(logDir, "campaign_ai_log.txt");
  let msg = null, ai = null;
  try { msg = fs.readFileSync(msgPath, "utf8"); } catch {}
  try { ai = fs.readFileSync(aiPath, "utf8"); } catch {}
  // Set offsets to end so watcher only gets new stuff
  try { logOffset = fs.statSync(msgPath).size; } catch {}
  try { logOffsetAI = fs.statSync(aiPath).size; } catch {}
  return { msg, ai };
});

// ── Save file watcher & parser ────────────────────────────────────────────
// Watches the RTW saves directory for new autosave .sav files, parses binary
// save data to extract settlement buildings, and diffs consecutive saves to
// emit building-change events to the renderer.

// Complete list of building chains from export_descr_buildings.txt
const KNOWN_BUILDINGS = new Set([
  'academic','agroforestry','amber_trader','amphitheatres','artisans','autonomous_mint',
  'barracks','camels_trade','capital_treasury','centralized_mint','colony','copper_industry',
  'core_building','dates_cultivation','defenses','despotic_law','dyes_production','equestrian',
  'farms','food_storage','forest_pastoralism','garrison','glass_production',
  'governmentA','governmentB','governmentC','governmentD','grain_imports','grain_industry',
  'harbour','health','hemp_cultivation','herds','hides_industry','highland_pastoralism',
  'hinterland_mines_silver','hinterland_region','hinterland_roads','honey_industry',
  'horse_trainer','hospitals','hunters','incense_trader','iron_industry','irrigated_farming',
  'ivory_trade','jewelry','justice_court','lead_industry','liberation','marble_production',
  'market','marsh_reclamation','military_industrial_complex','mines','missiles',
  'nomadic_pastoralism','olive_cultivation','papyrus_maker','perfumes_industry',
  'pitch_gathering','port_buildings','port_fishing','pottery_production','purple_dye_production',
  'qanat_farming','racing_stadium','rainfed_farming','river_port','salt_production','salted_fish',
  'sedentary_animal_husbandry','shifting_cultivation','siege_engineer','silk_trader',
  'slave_market','smith','spices_trading','stone_quarry','sulphur_industry','taverns',
  'textiles_production','theatres','timber_industry','tin_industry','wetland_pastoralism',
  'wine_industry',
  'temples_of_battle','temples_of_battleforge','temples_of_farming','temples_of_fertility',
  'temples_of_forge','temples_of_fun','temples_of_governors','temples_of_healing',
  'temples_of_horse','temples_of_horse_2','temples_of_hunting','temples_of_justice',
  'temples_of_law','temples_of_leadership','temples_of_love','temples_of_naval',
  'temples_of_one_god','temples_of_trade','temples_of_victory','temples_of_viking',
  'temples_of_violence',
]);
// Add all temple_complex variants
for (const suf of ['aeolian','arab','arcadian','armenian','assyrian','baltic','bithynian',
  'bosporan','cappadocian','carian','caucasian','celtic','cilician','cypriot_greek',
  'dardanian','delmato_pannonian','dorian','egyptian','epirote','ethiopian','germanic',
  'greco_bactrian','iberian','illyrian','indian','indo_greek','ionian','iranian','isaurian',
  'italic','judaean','liburnian','libyan','lycaonian','lycian','lydian','macedonian',
  'mesopotamian','mysian','northwest_greek','paeonian','pamphylian','pamphylian_greek',
  'paphlagonian','phoenician','phrygian','pisidian','scythian','thracian','triballian',
  'venetic']) {
  KNOWN_BUILDINGS.add('temple_complex_' + suf);
}

// readUtf16Name moved to src/saveBinaryReaders.js (pure, imported at top).

async function parseSaveData(filePath, onProgress, providedBuf = null) {
  const _yieldHere = () => new Promise(resolve => setImmediate(resolve));
  // [perf] timing: each tick logs how long the PREVIOUS stage took, so a
  // turn-end parse writes a stage-by-stage breakdown to provincia.log.
  let _tp = process.hrtime.bigint();
  let _lastStage = "start";
  const tick = (stage) => {
    const now = process.hrtime.bigint();
    console.log(`[perf] parseSaveData ${_lastStage}: ${(Number(now - _tp) / 1e6).toFixed(0)}ms`);
    _tp = now; _lastStage = stage;
    if (onProgress) onProgress({ stage });
  };
  // Reuse a buffer the caller already has in hand instead of re-reading
  // the file from disk. On a 30MB save that's ~100-300ms saved per
  // parse — both reparseLatestSave and saveWatchStart had already read
  // the file before calling this, so the duplicate read was pure waste.
  const data = providedBuf || await fs.promises.readFile(filePath);
  const len = data.length;

  // ── 1. Parse building records ──
  // Format: [uint16LE nameLen] [ascii name] [\0] [4-byte hash] [uint32LE level]
  tick("Scanning building records");
  await _yieldHere();
  const buildingRecords = [];
  let pos = 0;
  while (pos < len - 10) {
    const nameLen = data.readUInt16LE(pos);
    if (nameLen >= 4 && nameLen <= 50) {
      const nameStart = pos + 2;
      const nameEnd = nameStart + nameLen - 1;
      if (nameEnd + 1 < len && data[nameEnd] === 0x00) {
        const candidate = data.slice(nameStart, nameEnd);
        let valid = true;
        for (let i = 0; i < candidate.length; i++) {
          const b = candidate[i];
          if (!((b >= 0x61 && b <= 0x7a) || b === 0x5f)) { valid = false; break; }
        }
        if (valid) {
          const name = candidate.toString('ascii');
          if (KNOWN_BUILDINGS.has(name)) {
            const afterNull = nameEnd + 1;
            if (afterNull + 33 <= len) {
              const levelRaw = data.readUInt32LE(afterNull + 4);
              const level = levelRaw < 20 ? levelRaw : null;
              const healthRaw = data.readUInt32LE(afterNull + 29);
              const health = (healthRaw <= 100) ? healthRaw : null;
              buildingRecords.push({ offset: pos, name, level, health });
              pos = nameEnd + 9;
              continue;
            }
          }
        }
      }
    }
    pos++;
  }

  // ── 2. Find settlement names (UTF-16LE, preceded by \x01 [nchars] \x00) ──
  tick("Scanning settlement markers");
  await _yieldHere();
  const settlements = [];
  for (let i = 0; i < len - 10; i++) {
    if (data[i] === 0x01) {
      const r = readUtf16Name(data, i + 1, len);
      if (r) settlements.push({ offset: i, name: r.name });
    }
  }

  // ── 3. Associate buildings with nearest preceding settlement (within 3000 bytes) ──
  // Both buildingRecords and settlements were collected via sequential
  // byte-order scans, so they're already sorted by offset. Two-pointer
  // walk: O(N + M) instead of the original O(N × M) double loop, which
  // was ~39M iterations on a typical 30MB save (30k buildings × 1.3k
  // settlements). Saves several hundred ms on every save parse.
  tick("Linking buildings to settlements");
  await _yieldHere();
  const buildingsByCity = {};
  let sIdx = -1; // index of last settlement whose offset <= current building
  for (const b of buildingRecords) {
    while (sIdx + 1 < settlements.length && settlements[sIdx + 1].offset <= b.offset) {
      sIdx++;
    }
    if (sIdx < 0) continue;
    const s = settlements[sIdx];
    const dist = b.offset - s.offset;
    if (dist <= 0 || dist >= 3000) continue;
    if (!buildingsByCity[s.name]) buildingsByCity[s.name] = {};
    buildingsByCity[s.name][b.name] = { level: b.level, health: b.health };
  }

  // ── 4. Parse unit/army records ──
  // Format: [\x01\x00] [uint16LE nameLen] [ascii unit name with spaces] [\0]
  //         [bytes...] [uint8 regionLen] [\x00] [UTF-16LE region] [\xff\xff\xff\xff]
  //         [4 bytes] [4 bytes float] [uint32 soldiers] [uint32 maxSoldiers]
  tick("Scanning unit records");
  await _yieldHere();
  const unitRecords = [];
  pos = 0;
  while (pos < len - 20) {
    if (data[pos] === 0x01 && data[pos + 1] === 0x00) {
      const nameLen = data.readUInt16LE(pos + 2);
      if (nameLen >= 4 && nameLen <= 60) {
        const ns = pos + 4;
        const ne = ns + nameLen - 1;
        if (ne < len && data[ne] === 0x00) {
          const candidate = data.slice(ns, ne);
          let valid = true;
          for (let i = 0; i < candidate.length; i++) {
            const b = candidate[i];
            if (!((b >= 0x61 && b <= 0x7a) || b === 0x5f || b === 0x20)) { valid = false; break; }
          }
          if (valid) {
            const unitName = candidate.toString('ascii');
            if (!KNOWN_BUILDINGS.has(unitName) && unitName !== 'default_set') {
              // Find UTF-16LE region name within next 30 bytes
              let region = null, soldiers = null, maxSoldiers = null;
              let xp = null, weapon = null, armor = null;
              for (let j = ne + 1; j < Math.min(ne + 30, len - 6); j++) {
                const rl = data.readUInt16LE(j);
                if (rl >= 3 && rl <= 25) {
                  const strStart = j + 2;
                  const strEnd = strStart + rl * 2;
                  if (strEnd + 20 <= len) {
                    let ok = true;
                    let chars = '';
                    for (let k = strStart; k < strEnd; k += 2) {
                      const lo = data[k], hi = data[k + 1];
                      if (hi !== 0 || lo < 0x20 || lo > 0x7e) { ok = false; break; }
                      chars += String.fromCharCode(lo);
                    }
                    if (ok && chars.length > 0 && chars[0] >= 'A' && chars[0] <= 'Z') {
                      region = chars;
                      // After region: [ff ff ff ff] [4 bytes] [float] [uint32 soldiers] [uint32 max]
                      // Then typically chevrons (0-9), weapon upgrade (0-3), armor upgrade (0-3)
                      // as uint8 or uint32 fields in the bytes that follow. Best-effort read.
                      const ra = strEnd;
                      if (ra + 20 <= len && data[ra] === 0xff && data[ra + 1] === 0xff &&
                          data[ra + 2] === 0xff && data[ra + 3] === 0xff) {
                        const s = data.readUInt32LE(ra + 12);
                        const m = data.readUInt32LE(ra + 16);
                        if (s <= 2000 && m <= 2000) {
                          soldiers = s;
                          maxSoldiers = m;
                          // Tentative XP fields: read the three uint32s that follow and
                          // only keep them if they fit the expected ranges (chevrons 0-9,
                          // weapon 0-3, armor 0-3). Out-of-range → null.
                          if (ra + 32 <= len) {
                            const xpVal = data.readUInt32LE(ra + 20);
                            const weapVal = data.readUInt32LE(ra + 24);
                            const armVal = data.readUInt32LE(ra + 28);
                            xp = (xpVal <= 9) ? xpVal : null;
                            weapon = (weapVal <= 3) ? weapVal : null;
                            armor = (armVal <= 3) ? armVal : null;
                          }
                        }
                      }
                      break;
                    }
                  }
                }
              }
              if (region) {
                unitRecords.push({ unit: unitName, region, soldiers, max: maxSoldiers, xp, weapon, armor });
                pos = ne + 1;
                continue;
              }
            }
          }
        }
      }
    }
    pos++;
  }

  // ── 5. Group units by region ──
  tick("Grouping units by region");
  await _yieldHere();
  const armies = {};
  for (const u of unitRecords) {
    if (!armies[u.region]) armies[u.region] = [];
    armies[u.region].push({
      unit: u.unit,
      soldiers: u.soldiers,
      max: u.max,
      xp: u.xp,
      weapon: u.weapon,
      armor: u.armor,
    });
  }

  // ── 6. Parse construction queue from default_set per settlement ──
  // Pattern discovered via v2 calibration: when a building is queued, the save's
  // per-settlement "default_set" chain record contains either:
  //   • an ASCII chain name entry (for chains the settlement didn't have before), or
  //   • a hash entry pointing to one of the settlement's existing chain slots.
  // The ASCII case is unambiguous — we can name the building directly. The hash
  // case requires matching against the settlement's chain slot hashes (future work).
  tick("construction queues + settlement fields");
  const queues = {};
  const knownChains = new Set(['hinterland_region', 'core_building', 'capital_treasury',
    'military_industrial_complex', 'irrigated_farming', 'market', 'port_buildings',
    'textiles_production', 'health', 'hinterland_roads', 'temple_complex_dorian',
    'temple_complex_italic', 'defenses', 'colony', 'highland_pastoralism',
    'olive_cultivation', 'pottery_production', 'smith', 'horse_trainer']);
  // Precompute needles once instead of re-allocating ~20 Buffers per settlement.
  const dsNeedle = Buffer.from('default_set', 'ascii');
  const chainNeedles = [...knownChains].map((cn) => ({ cn, n: Buffer.from('\0' + cn + '\0', 'ascii') }));
  for (const s of settlements) {
    // Locate "default_set" within 200 bytes after the settlement name. Search a
    // BOUNDED window: an unbounded data.indexOf would scan to the end of the
    // 33 MB buffer for any settlement that has no default_set nearby.
    const dsRel = data.subarray(s.offset, Math.min(s.offset + 211, data.length)).indexOf(dsNeedle);
    if (dsRel === -1) continue; // window (211) caps the start at <=200 by construction
    const dsIdx = s.offset + dsRel;
    const dsDataStart = dsIdx + 11 + 1;
    // Find end by locating the next known chain record — but ONLY within the
    // ~500-byte window we actually accept hits from. The previous code did an
    // UNBOUNDED data.indexOf per chain, so every chain absent near a settlement
    // scanned the whole 33 MB buffer: ~1300 settlements × 19 chains = ~26 s of
    // pure waste on every turn-end parse. Bounding it to a subarray view drops
    // this from ~26 s to ~10 ms (verified identical, scripts/bench-defaultset.js).
    let dsEnd = -1;
    const dsWin = data.subarray(dsDataStart, Math.min(dsDataStart + 540, data.length));
    for (const { cn, n } of chainNeedles) {
      const rel = dsWin.indexOf(n);
      if (rel !== -1 && rel < 500) {
        const recordStart = (dsDataStart + rel) + 1 - cn.length - 1 - 2;
        if (dsEnd === -1 || recordStart < dsEnd) dsEnd = recordStart;
      }
    }
    if (dsEnd === -1) dsEnd = dsDataStart + 300;
    // Scan for ASCII chain names inside default_set
    const queue = [];
    for (let p = dsDataStart; p < dsEnd - 4; p++) {
      const ln = data.readUInt16LE(p);
      if (ln < 3 || ln > 40) continue;
      let ok = true;
      for (let i = 0; i < ln - 1; i++) {
        const c = data[p + 2 + i];
        if (!((c >= 0x61 && c <= 0x7a) || c === 0x5f || (c >= 0x30 && c <= 0x39))) { ok = false; break; }
      }
      if (ok && data[p + 2 + ln - 1] === 0x00 && data[p + 2] >= 0x61 && data[p + 2] <= 0x7a) {
        queue.push(data.slice(p + 2, p + 2 + ln - 1).toString('ascii'));
      }
    }
    if (queue.length > 0) queues[s.name] = queue;
  }

  // ── 7. Parse per-settlement tax level ──
  // Confirmed empirically against RIS imperial-campaign Sparta saves
  // (save_2.0/2.1/2.2 with all settlements set to high/very_high/low):
  // the tax byte sits at exactly  settlement_name_offset - 2269  bytes
  // (where settlement.offset is the `\x01` marker — the UTF-16LE string
  // starts 3 bytes later and the tax byte sits 2272 bytes before that
  // string start). Enum: 0=low, 1=normal (default), 2=high, 3=very_high.
  // Validated across 3 cities × 3 enum values = 9 distinct measurements,
  // identical offset every time.
  const TAX_OFFSET = 2269; // bytes BEFORE settlement.offset (the \x01 marker)
  const TAX_LEVELS = ["low", "normal", "high", "very_high"];
  let taxByCity = null;
  // Defensive: gate by header campaign-name. Formula was only verified on
  // RIS imperial campaign saves (magic 0x070a, campaign "imperial_campaign").
  // Wrapped in try/catch so any header anomaly silently skips tax parsing
  // rather than aborting the whole snapshot — avoids a half-parsed state
  // that could surface as a UI hang on the renderer side.
  try {
    const campaignLen = data.length >= 0x40 ? data.readUInt16LE(0x3a) : 0;
    let campaignName = "";
    if (campaignLen > 0 && campaignLen < 64 && 0x3c + campaignLen * 2 <= data.length) {
      for (let i = 0; i < campaignLen; i++) {
        const c = data.readUInt16LE(0x3c + i * 2);
        if (c >= 0x20 && c <= 0x7e) campaignName += String.fromCharCode(c);
      }
    }
    if (campaignName === "imperial_campaign" || campaignName === "ris_classic") {
      taxByCity = {};
      for (const s of settlements) {
        const off = s.offset - TAX_OFFSET;
        if (off < 0 || off >= len) continue;
        const v = data[off];
        if (v >= 0 && v <= 3) taxByCity[s.name] = TAX_LEVELS[v];
      }
    }
  } catch (err) {
    console.warn("[tax] parsing failed, skipping:", err && err.message);
    taxByCity = null;
  }

  // Settlement per-turn income u32 (and cumulative income u32) — sit at
  // tax_byte + 683 and tax_byte + 687 respectively. Per the save-cracker
  // session-3 byte-map: STRONG-confidence, single clean correlation
  // (Rome=902 d/turn dropping to 860 next turn; Sparta=444). Verified on
  // save_rome10: Capua=400, Brundisium=266, Uria=133. Same campaign-name
  // gate as the other settlement fields.
  let incomeByCity = null;
  // Settlement size class enum u8 at tax_byte + 62. CONFIRMED: 0=village,
  // 1=town, 2=large_town, 3=city, 4=large_city, 5=huge_city. Matches
  // descr_strat (Rome=4, Sparta=2). Live value reflects current upgrade
  // tier — useful when the user has upgraded mid-campaign.
  let sizeByCity = null;
  try {
    const campaignLen = data.length >= 0x40 ? data.readUInt16LE(0x3a) : 0;
    let campaignName = "";
    if (campaignLen > 0 && campaignLen < 64 && 0x3c + campaignLen * 2 <= data.length) {
      for (let i = 0; i < campaignLen; i++) {
        const c = data.readUInt16LE(0x3c + i * 2);
        if (c >= 0x20 && c <= 0x7e) campaignName += String.fromCharCode(c);
      }
    }
    if (campaignName === "imperial_campaign" || campaignName === "ris_classic") {
      incomeByCity = {};
      sizeByCity = {};
      const SIZE_LABELS = ["village", "town", "large_town", "city", "large_city", "huge_city"];
      for (const s of settlements) {
        const taxOff = s.offset - TAX_OFFSET;
        if (taxOff < 0) continue;
        if (taxOff + 687 + 4 <= data.length) {
          const perTurn = data.readUInt32LE(taxOff + 683);
          const cumulative = data.readUInt32LE(taxOff + 687);
          // Sanity: RTW settlement income is bounded — 0..50000/turn is
          // reasonable, cumulative up to a few million. Out of range
          // means the offset drifted or the slot is uninitialised.
          if (perTurn <= 50000 && cumulative <= 10_000_000) {
            incomeByCity[s.name] = { perTurn, cumulative };
          }
        }
        if (taxOff + 62 < data.length) {
          const v = data[taxOff + 62];
          if (v >= 0 && v <= 5) sizeByCity[s.name] = SIZE_LABELS[v];
        }
      }
    }
  } catch (err) {
    console.warn("[income/size] parsing failed, skipping:", err && err.message);
    incomeByCity = null;
    sizeByCity = null;
  }

  // Settlement live population u32 — sits at tax_byte + 775 (so
  // settlement.offset - 1494 with TAX_OFFSET=2269). Cross-validated by the
  // save-cracker (session 2): 18/18 across Sparta tax saves match the
  // descr_strat starting pops (3500/1800/1400), and Roma's 9000-pop
  // independently lines up in the Roman saves. Same campaign-name gate
  // as tax. A SECOND pop-shaped u32 lives at tax_byte + 2235 (= settlement
  // .offset - 34) that mostly mirrors the first but diverges at turn
  // boundaries — likely "tax-eligible pop" or a pre-turn snapshot; not
  // surfaced here.
  let populationByCity = null;
  try {
    const campaignLen = data.length >= 0x40 ? data.readUInt16LE(0x3a) : 0;
    let campaignName = "";
    if (campaignLen > 0 && campaignLen < 64 && 0x3c + campaignLen * 2 <= data.length) {
      for (let i = 0; i < campaignLen; i++) {
        const c = data.readUInt16LE(0x3c + i * 2);
        if (c >= 0x20 && c <= 0x7e) campaignName += String.fromCharCode(c);
      }
    }
    if (campaignName === "imperial_campaign" || campaignName === "ris_classic") {
      populationByCity = {};
      for (const s of settlements) {
        const off = s.offset - 1494;
        if (off < 0 || off + 4 > data.length) continue;
        const v = data.readUInt32LE(off);
        // Sanity: settlement pop in RTW ranges 400 (village) to 60000
        // (megalopolis). Clip out-of-range to detect record-layout drift.
        if (Number.isFinite(v) && v >= 100 && v <= 100000) {
          populationByCity[s.name] = v;
        }
      }
    }
  } catch (err) {
    console.warn("[pop] parsing failed, skipping:", err && err.message);
    populationByCity = null;
  }

  // Settlement happiness / public-order f32 — sits at tax_byte + 2239 (so
  // 30 bytes BEFORE the settlement marker on the RIS imperial-campaign
  // layout, since tax_byte = settlement.offset - 2269 and happiness =
  // tax_byte + 2239 = settlement.offset - 30). Triple-validated by the
  // save-cracker against the Sparta tax-triple — the ONLY byte in any
  // settlement record that changes between tax levels. Empirical range
  // observed: 105..195 with a -25-per-tax-level slope. Engine likely
  // clips this to a 0-100% bar on display, but the raw value is what
  // surfaces here. Wrapped in the same campaign-name gate as the tax
  // parsing because the offset was only verified on imperial-campaign.
  let happinessByCity = null;
  try {
    const campaignLen = data.length >= 0x40 ? data.readUInt16LE(0x3a) : 0;
    let campaignName = "";
    if (campaignLen > 0 && campaignLen < 64 && 0x3c + campaignLen * 2 <= data.length) {
      for (let i = 0; i < campaignLen; i++) {
        const c = data.readUInt16LE(0x3c + i * 2);
        if (c >= 0x20 && c <= 0x7e) campaignName += String.fromCharCode(c);
      }
    }
    if (campaignName === "imperial_campaign" || campaignName === "ris_classic") {
      happinessByCity = {};
      for (const s of settlements) {
        const off = s.offset - 30;
        if (off < 0 || off + 4 > data.length) continue;
        const v = data.readFloatLE(off);
        // Sanity: clip to plausible range. Out-of-range means the offset
        // didn't land where we expected (settlement layout drift between
        // engine versions). Skip rather than show garbage.
        if (Number.isFinite(v) && v >= 0 && v <= 500) {
          happinessByCity[s.name] = v;
        }
      }
    }
  } catch (err) {
    console.warn("[happiness] parsing failed, skipping:", err && err.message);
    happinessByCity = null;
  }

  // ── New magic-based decoders (added 2026-05-09 via rtw-sav-parser cracking) ──
  // Faction record array: 239 records starting with `ff 0a af f0` magic.
  // Lua persistent counters: named u32 values (turn_number, id_<faction>, etc.).
  let factionRecords = null;
  let luaCounters = null;
  tick("faction records + exploration");
  let playerExploration = null;
  try {
    const fr = findFactionRecords(data);
    factionRecords = {
      count: fr.length,
      arraySpan: summarizeFactionArray(fr),
      records: fr,
    };
    // Decode the player's ever-explored tile grid + active LOS halo
    // (save-cracker sessions 103 + 105, 2026-05-16). The player faction
    // record is the LARGEST one (~334 KB vs ~6 KB per NPC). After the
    // 24 B header come stride-2 RLE pairs <u8 value><u8 count> that
    // expand row-major to the full 1020×700 strategic-tile grid.
    //
    // CORRECTED 2026-06-04 (findings-faction-knowledge-entities): the grid
    // is 1020 wide × 700 tall, row-major, index = tileY*1020 + tileX in the
    // save's engine tile coords (tileY bottom-up). The old 510×1400 ("half-x,
    // double-y, even-rows-only") interpretation was WRONG — it squashed x 2:1
    // and dropped the right half of every row, so the Explored overlay scored
    // only 2.1% of own settlements on explored tiles. The 1020×700 model
    // scores 100.0% (20728/20738) across the 28-save corpus. The RLE decode
    // itself is unchanged (linear fill); only the grid dims (used by the
    // renderer's sampler) were wrong.
    //
    // Value semantics:
    //   0 = unexplored / never-seen (~99% of tiles)
    //   1 = ever-explored land (settlement tiles are uniformly state 1)
    //   2..24 = vision/recency gradient over explored tiles
    //   count == 0 in an RLE pair is the TERMINATOR. Session 103's
    //   hard-coded end at +0xc264 was wrong — it leaked ASCII bytes
    //   from the trailing settlement-list as fake high tile values.
    if (fr && fr.length > 0) {
      let largest = fr[0];
      for (const r of fr) {
        if ((r.size || 0) > (largest.size || 0)) largest = r;
      }
      const GRID_W = 1020, GRID_H = 700;
      const RLE_START = largest.offset + 0x18;
      const RLE_MAX = Math.min(largest.offset + largest.size, data.length);
      if (largest.size >= 0x18 + 4 && RLE_START < data.length) {
        const grid = new Uint8Array(GRID_W * GRID_H);
        let gi = 0;
        let i = RLE_START;
        while (i + 2 <= RLE_MAX && gi < grid.length) {
          const val = data[i];
          const count = data[i + 1];
          if (count === 0) break; // canonical RLE terminator
          const limit = Math.min(count, grid.length - gi);
          for (let k = 0; k < limit; k++) grid[gi + k] = val;
          gi += limit;
          i += 2;
        }
        if (gi >= 100000) {
          playerExploration = { grid, width: GRID_W, height: GRID_H, decoded: gi };
        }
      }
    }
  } catch (err) { console.warn("[faction-records] parse failed:", err && err.message); }
  try {
    const recs = findLuaCounters(data);
    luaCounters = {
      count: recs.length,
      records: recs,
      byName: Object.fromEntries(recs.map(r => [r.name, r.value])),
    };
  } catch (err) { console.warn("[lua-counters] parse failed:", err && err.message); }

  // Per-faction current treasury (denarii) — CONFIRMED by save-cracker
  // session 5. Major-faction records sit in a flat 23-entry array. Each
  // record has a structural signature:
  //   +0   u32  treasury (signed for bankruptcy)
  //   +8   u32  == 100  (MAJOR-CLASS tag)
  //   +12  u32  == 1    (version)
  //   +24  u32  == self_offset+24
  //   +40  u32  == self_offset+40
  //   +44  u32  == 6
  //   +48  u32  region count N
  //   +(92+4N) u32 start-of-turn treasury snapshot
  // Player is always at index 0; remaining 22 follow descr_strat order
  // with player slot removed. RIS imperial campaign only — gated by
  // campaign-name header check (same as tax/income/pop fields).
  let treasuryByFaction = null;
  try {
    const campaignLen = data.length >= 0x40 ? data.readUInt16LE(0x3a) : 0;
    let campaignName = "";
    if (campaignLen > 0 && campaignLen < 64 && 0x3c + campaignLen * 2 <= data.length) {
      for (let i = 0; i < campaignLen; i++) {
        const c = data.readUInt16LE(0x3c + i * 2);
        if (c >= 0x20 && c <= 0x7e) campaignName += String.fromCharCode(c);
      }
    }
    if (campaignName === "imperial_campaign") {
      // Scan for the structural signature.
      const records = [];
      for (let i = 0; i + 64 < data.length; i += 1) {
        if (data.readUInt32LE(i + 8) !== 100) continue;
        if (data.readUInt32LE(i + 12) !== 1) continue;
        if (data.readUInt32LE(i + 16) !== 0 || data.readUInt32LE(i + 20) !== 0) continue;
        if (data.readUInt32LE(i + 24) !== i + 24) continue;
        if (data.readUInt32LE(i + 32) !== 0 || data.readUInt32LE(i + 36) !== 0) continue;
        if (data.readUInt32LE(i + 40) !== i + 40) continue;
        if (data.readUInt32LE(i + 44) !== 6) continue;
        const regions = data.readUInt32LE(i + 48);
        if (regions > 200) continue;
        const treasury = data.readInt32LE(i);
        const turnStartOff = i + 92 + 4 * regions;
        const turnStart = turnStartOff + 4 <= data.length ? data.readInt32LE(turnStartOff) : null;
        // `regions` here is the record's KNOWLEDGE-SIZE count, not owned
        // regions (canonical: 4 for Carthage T1 when it owns 41) — expose it
        // under the honest name and keep regionCount null so nothing trusts it.
        records.push({ pos: i, treasury, turnStart, knowledgeSize: regions, regionCount: null });
        // Skip ahead by the record's known minimum span to avoid double
        // matching inside the same record.
        i = Math.min(data.length - 64, i + 92 + 4 * regions);
      }
      // Return raw records keyed by scan index — the renderer joins them
      // to faction names using the player-faction state (which lives on
      // that side) and the RIS imperial major-faction descr_strat order.
      treasuryByFaction = { records };
    }
  } catch (err) {
    console.warn("[treasury] parsing failed, skipping:", err && err.message);
    treasuryByFaction = null;
  }

  // ── Short-block settlement stats (added 2026-05-17 via save-cracker) ──
  // Each settlement carries a ~583-byte stats block that ENDS at the UTF-16
  // name. Fields sit at known relative offsets within that block. Validated
  // cross-campaign (Macedon Alex T11 + RIS Spain T1):
  //   tax_rate    u8  at name-562    (0=very_low, 1=low, 2=normal, 3=high, 4=very_high)
  //   level       u32 at name-571    (0=village .. 5=huge_city)
  //   PO          u32 at name-435    (public order %)
  //   income      u32 at name-127    (denarii / turn)
  //   population  u32 at name-35
  //   creator     u32 at name-583    (revolt-to faction; updated to new owner on capture)
  // settlement.offset (the \x01 marker) sits 1 byte BEFORE the UTF-16-len
  // prefix, so name_pos = marker + 1 — translating: tax = marker - 561, etc.
  //
  // TAX ENUM NOTE: Provincia's older long-block parser (marker-2269) uses
  // 4 values 0..3 = low/normal/high/very_high. The short-block byte uses 5
  // values 0..4 = very_low/low/normal/high/very_high. We surface the short
  // path under the same `taxByCity` key, mapped to the same string labels.
  // The short-block path fills in cities the long-block path skipped (e.g.
  // alexander_campaign saves) without changing values where both produced one.
  const SHORT_TAX_LEVELS = ["very_low", "low", "normal", "high", "very_high"];
  const SHORT_SIZE_LABELS = ["village", "town", "large_town", "city", "large_city", "huge_city"];
  try {
    const ensureObj = (v) => (v && typeof v === "object" ? v : {});
    taxByCity = ensureObj(taxByCity);
    populationByCity = ensureObj(populationByCity);
    incomeByCity = ensureObj(incomeByCity);
    sizeByCity = ensureObj(sizeByCity);
    let shortBlockHits = 0;
    for (const s of settlements) {
      const namePos = s.offset + 1;  // findUtf16 returns the nchars byte position
      // Tax rate (single byte, 0..4)
      if (!(s.name in taxByCity)) {
        const taxOff = namePos - 562;
        if (taxOff >= 0 && taxOff < data.length) {
          const v = data[taxOff];
          if (v >= 0 && v <= 4) {
            taxByCity[s.name] = SHORT_TAX_LEVELS[v];
            shortBlockHits++;
          }
        }
      }
      // Population (u32, plausible range 100..100000)
      if (!(s.name in populationByCity)) {
        const popOff = namePos - 35;
        if (popOff >= 0 && popOff + 4 <= data.length) {
          const v = data.readUInt32LE(popOff);
          if (Number.isFinite(v) && v >= 100 && v <= 100000) {
            populationByCity[s.name] = v;
          }
        }
      }
      // Income perTurn (u32, plausible 0..50000 denarii). The short block
      // doesn't carry a cumulative-income twin near this offset, so leave
      // cumulative null where only the short path is available.
      if (!(s.name in incomeByCity)) {
        const incOff = namePos - 127;
        if (incOff >= 0 && incOff + 4 <= data.length) {
          const v = data.readUInt32LE(incOff);
          if (Number.isFinite(v) && v >= 0 && v <= 50000) {
            incomeByCity[s.name] = { perTurn: v, cumulative: null };
          }
        }
      }
      // Settlement level (u32, 0..5)
      if (!(s.name in sizeByCity)) {
        const lvlOff = namePos - 571;
        if (lvlOff >= 0 && lvlOff + 4 <= data.length) {
          const v = data.readUInt32LE(lvlOff);
          if (v >= 0 && v <= 5) sizeByCity[s.name] = SHORT_SIZE_LABELS[v];
        }
      }
    }
    if (shortBlockHits > 0) {
      console.log("[short-block] filled", shortBlockHits, "settlements with short-block tax data");
    }
    // If nothing got populated, drop empty objects back to null so renderer
    // doesn't show empty tax/pop chips for every region.
    if (Object.keys(taxByCity).length === 0) taxByCity = null;
    if (Object.keys(populationByCity).length === 0) populationByCity = null;
    if (Object.keys(incomeByCity).length === 0) incomeByCity = null;
    if (Object.keys(sizeByCity).length === 0) sizeByCity = null;
  } catch (err) {
    console.warn("[short-block] parsing failed, skipping:", err && err.message);
  }

  // ── Save-cracker extras (2026-05-18 batch — header / mod / faction-config /
  //    per-character spouse+age+region) ──
  // Pure-read; each call is cheap and guarded so a corrupt/old save can't break
  // the snapshot.
  let header = null;
  let factionDiscovered = null;
  let factionConfig = null;
  let modInfo = null;
  tick("character extras");
  let characterExtras = null;
  let familyTreeMaps = null;
  let religionByCity = null;
  try { header = cxParseHeader(data); } catch (err) { console.warn("[header] parse failed:", err && err.message); }
  try { if (header) factionDiscovered = cxParseBitmask(data, header); } catch (err) { console.warn("[bitmask] parse failed:", err && err.message); }
  try { if (header && factionDiscovered) factionConfig = cxParseFactionConfig(data, header, factionDiscovered); } catch (err) { console.warn("[faction-config] parse failed:", err && err.message); }
  try { modInfo = cxParseModInfo(data); } catch (err) { console.warn("[mod-info] parse failed:", err && err.message); }
  try {
    characterExtras = cxParseCharacterExtras(data);
    // Attach +288 / +292 map coordinates from the extended record. Lets
    // downstream code bridge save chars to descr_strat character lines by
    // matching (x, y).
    if (characterExtras) cxAttachMapCoords(data, characterExtras);
  } catch (err) { console.warn("[character-extras] parse failed:", err && err.message); }
  // Crack 2026-05-18: each character's portrait is identified by a u32 at
  // +280 of the 354-byte extended record, matched against u32-prefixed
  // entries in the portrait pool. Resolves to the EXACT pstr16 portrait
  // path the in-game family tree displays.
  let portraitByOwnUuid = null;
  try {
    if (characterExtras) {
      const m = cxResolvePortraits(data, characterExtras);
      // Attach per-character portraitPath onto each characterExtras entry
      // for trivial downstream lookup.
      for (const c of characterExtras) {
        const p = m.get(c.ownUuid);
        if (p) {
          c.portraitCardsPath = p.cards;
          c.portraitFullPath = p.fulls;
          c.portraitUuid = p.portraitUuid;
        }
      }
      portraitByOwnUuid = Array.from(m.entries()).map(([uuid, v]) => [uuid, v]);
      console.log(`[portraits] resolved ${m.size}/${characterExtras.length} characters via save UUID linkage`);
    }
  } catch (err) { console.warn("[portraits] resolve failed:", err && err.message); }
  try { religionByCity = cxParseReligion(data, settlements); } catch (err) { console.warn("[religion] parse failed:", err && err.message); }
  // Crack: parse major-faction records to get per-faction treasury + region count.
  // Works on vanilla imperial saves (Macedon T0 yields 23 records, player at idx 0).
  let factionTreasuries = null;
  let factionDiplomacy = null;
  let allFactionDiplomacy = null;
  let diplomacyMatrix = null;
  let treasuryHistory = null;
  let factionRecordOwners = null;
  try {
    factionTreasuries = cxParseTreasuries(data);
    if (factionTreasuries) console.log(`[treasuries] parsed ${factionTreasuries.length} major-faction records`);
  } catch (err) { console.warn("[treasuries] parse failed:", err && err.message); }
  // The +44==8 (Republic of Rome) layout enumerates faction records AND the
  // diplomacy matrix in the ENGINE's faction order (descr order with the index-1
  // rebel slot rotated to the end). Name those POSITIONAL lookups with the engine
  // order. The imperial +44==6 layout uses faction-id bytes (descr index) and
  // needs no remap — detect by record count (≈23 imperial vs ≈239 republic).
  // See memory engine-faction-order-permutation (cracked 2026-05-24).
  const positionalLayout = !!(factionTreasuries && factionTreasuries.length > 30);
  const engineOrder = positionalLayout ? cxDeriveEngineOrder(modFactionOrder) : modFactionOrder;
  if (positionalLayout) console.log(`[faction-order] +44==8 layout — using engine order (rotated) for record/matrix naming`);
  try {
    if (factionTreasuries && factionTreasuries.length > 0) {
      factionRecordOwners = cxIdentifyRecordOwners(data, factionTreasuries, engineOrder);
      // 0.9.527: attach the resolved AI personality archetype to each
      // record. aiPersonalityIndex (cracked) indexes the parsed personality
      // declaration order; expose both the raw index and the human name.
      for (const o of factionRecordOwners) {
        const rec = factionTreasuries[o.recordIndex];
        const aiIdx = rec && typeof rec.aiPersonalityIndex === "number" ? rec.aiPersonalityIndex : null;
        o.aiPersonalityIndex = aiIdx;
        // Prefer descr_strat fallback (see calibrate path for full rationale).
        const facName = (o.factionName || "").toLowerCase();
        const fromDescrStrat = modAiByFaction ? modAiByFaction[facName] : null;
        const fromSave = (modAiPersonalityOrder && aiIdx != null && aiIdx >= 0 && aiIdx < modAiPersonalityOrder.length)
          ? modAiPersonalityOrder[aiIdx] : null;
        o.aiPersonality = fromDescrStrat || fromSave || null;
        o.aiPersonalitySource = fromDescrStrat ? "descr_strat" : (fromSave ? "save" : null);
      }
      const named = factionRecordOwners.filter(o => o.factionName).length;
      const byId = factionRecordOwners.filter(o => o.source === "factionId").length;
      const byBanner = factionRecordOwners.filter(o => o.source === "captainBanner").length;
      const withAi = factionRecordOwners.filter(o => o.aiPersonality).length;
      console.log(`[record-owners] identified ${named}/${factionRecordOwners.length} faction records (factionId=${byId}, captainBanner=${byBanner}); AI personality on ${withAi}`);
    }
  } catch (err) { console.warn("[record-owners] parse failed:", err && err.message); }
  // Identify the player's faction internal name from the save itself —
  // the only captain banner that appears BEFORE the first major NPC
  // record belongs to the player. Works for any campaign/mod since
  // it's purely structural.
  let savePlayerFaction = null;
  try {
    if (factionTreasuries && factionTreasuries.length > 0) {
      savePlayerFaction = cxIdentifyPlayerFromSave(data, factionTreasuries);
      if (savePlayerFaction) console.log(`[player-faction] identified player as "${savePlayerFaction}" from save banner`);
    }
  } catch (err) { console.warn("[player-faction] identify failed:", err && err.message); }
  try {
    if (factionTreasuries && factionTreasuries.length > 0) {
      factionDiplomacy = cxParseDiplomacy(data, factionTreasuries);
      const total = factionDiplomacy.reduce((s, x) => s + (x.relations ? x.relations.length : 0), 0);
      console.log(`[diplomacy] parsed ${total} relations across ${factionDiplomacy.length} factions`);
    }
  } catch (err) { console.warn("[diplomacy] parse failed:", err && err.message); }
  // 0.9.539: live diplomacy COUNTS for EVERY faction (incl. player, senate,
  // carthage, minors) via the ~221 0x39240005 zones, keyed by faction name.
  try {
    allFactionDiplomacy = cxParseAllDiplomacy(data, modFactionOrder);
    const n = allFactionDiplomacy ? Object.keys(allFactionDiplomacy).length : 0;
    console.log(`[diplomacy-all] live counts for ${n} factions`);
  } catch (err) { console.warn("[diplomacy-all] parse failed:", err && err.message); }
  // 0.9.546: NAMED live diplomacy from the N×N attitude matrix (the real
  // diplomacy source — war/ally/hostile per faction PAIR, partner recoverable).
  try {
    // RAW modFactionOrder (NOT engineOrder) — the matrix is descr_sm-indexed and
    // self-calibrates C; the derived engine order would mislabel every pair.
    diplomacyMatrix = cxParseDiplomacyMatrix(data, modFactionOrder);
    if (diplomacyMatrix && diplomacyMatrix._meta) {
      const mt = diplomacyMatrix._meta;
      console.log(`[diplo-matrix] located base=0x${mt.base.toString(16)} stride=${mt.stride} N=${mt.N} C=${mt.C} symmetry=${(mt.symmetry*100).toFixed(0)}% warPairs=${mt.warPairs}`);
      const pf = (savePlayerFaction || "").toLowerCase();
      const row = pf && diplomacyMatrix[pf];
      if (row) console.log(`[diplo-matrix] ${pf}: war=[${(row.war||[]).join(", ")}] allied=[${(row.allied||[]).join(", ")}] trade=[${(row.trade||[]).join(", ")}]`);
    } else {
      console.log(`[diplo-matrix] NOT located`);
    }
  } catch (err) { console.warn("[diplo-matrix] parse failed:", err && err.message); }
  // 0.9.549: per-faction treasury-over-time history (f13 checkpoints).
  // KEYED BY RECORD POSITION → descr_sm order (modFactionOrder), NOT engineOrder.
  // parseFactionTreasuryHistory indexes factionOrder by the record's array
  // position; engineOrder rotates the first rebel slot to the end, shifting every
  // faction's history series by one slot. Fixed 2026-05-31 — see findings doc.
  try {
    if (factionTreasuries && factionTreasuries.length > 0) {
      treasuryHistory = cxParseTreasuryHistory(data, factionTreasuries, modFactionOrder);
      console.log(`[treasury-history] ${treasuryHistory ? Object.keys(treasuryHistory).length : 0} factions`);
    }
  } catch (err) { console.warn("[treasury-history] parse failed:", err && err.message); }
  try {
    if (characterExtras) {
      // v1Chars come from the existing character parser path — wire whatever is
      // available in this scope. If the caller (renderer) doesn't already pass
      // them in, the tree maps will still expose byUuid+spouseOf without children.
      familyTreeMaps = cxBuildFamilyMaps(characterExtras, null);
    }
  } catch (err) { console.warn("[family-tree] build failed:", err && err.message); }

  tick("diplomacy + treasuries + family tree");
  return {
    buildings: buildingsByCity, armies, queues,
    taxByCity, happinessByCity, populationByCity, incomeByCity, sizeByCity,
    factionRecords, luaCounters, treasuryByFaction, playerExploration,
    // ── Cracker extras (additive — old consumers don't break) ──
    saveHeader: header,
    factionDiscovered,
    factionConfig,
    modInfo,
    characterExtras,
    religionByCity,
    factionTreasuries,
    factionRecordOwners,
    savePlayerFaction,
    factionDiplomacy,
    allFactionDiplomacy,
    diplomacyMatrix,
    treasuryHistory,
    familyTreeMaps: familyTreeMaps ? {
      byUuid: Array.from(familyTreeMaps.byUuid.entries()),
      spouseOf: Array.from(familyTreeMaps.spouseOf.entries()),
      childrenOf: Array.from(familyTreeMaps.childrenOf.entries()),
    } : null,
  };
}

// diffSaveData moved to src/saveDiff.js (pure, imported at top).

let lastSaveData = null;
let lastSaveFile = null;
let lastSaveMtime = 0;
// Cache the save buffer between parses so characters-init (which fires
// after mod data loads) doesn't read the same 30MB file from disk a
// second time. Invalidated whenever a new save replaces lastSaveFile.
let lastSaveBuf = null;
let activeSaveDir = null;
let activePinnedSave = null; // exact filename the user chose to track, or null = latest-by-mtime
let saveDirWatcher = null;
let saveDebounceTimer = null;

// isEndAutosave moved to src/saveDiff.js (pure, imported at top).

// Return the most recently modified .sav in saveDir. Includes autosaves AND manual
// saves so mid-turn manual saves also trigger live updates. Skips End-suffixed
// autosaves so the freshly-written "Turn N+1 Start" wins on a tie.
function findLatestSave(saveDir) {
  try {
    const files = fs.readdirSync(saveDir).filter(f => f.endsWith(".sav") && !isEndAutosave(f));
    if (!files.length) return null;
    let latest = null, latestTime = 0;
    for (const f of files) {
      try {
        const stat = fs.statSync(path.join(saveDir, f));
        if (stat.mtimeMs > latestTime) { latestTime = stat.mtimeMs; latest = f; }
      } catch {}
    }
    return latest;
  } catch { return null; }
}

// IPC: list all .sav files in a saves dir, sorted newest first. Used by the
// "Pick save to track" UI so the user can pin a specific save instead of
// following the newest-by-mtime default.
ipcMain.handle("list-saves", (_event, saveDir) => {
  if (!saveDir) return [];
  try {
    const files = fs.readdirSync(saveDir).filter((f) => f.endsWith(".sav"));
    const out = [];
    for (const f of files) {
      try {
        const st = fs.statSync(path.join(saveDir, f));
        out.push({ file: f, mtime: st.mtimeMs, atime: st.atimeMs, size: st.size });
      } catch {}
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  } catch { return []; }
});

// IPC: return { file, mtime } for the newest .sav in saveDir, or null. Used
// by the renderer's auto-detect logic to rank candidate campaign folders.
// Skips End autosaves — see findLatestSave above for rationale.
ipcMain.handle("get-latest-save-mtime", (_event, saveDir) => {
  if (!saveDir) return null;
  try {
    const files = fs.readdirSync(saveDir).filter(f => f.endsWith(".sav") && !isEndAutosave(f));
    if (!files.length) return null;
    let latest = null, latestTime = 0;
    for (const f of files) {
      try {
        const stat = fs.statSync(path.join(saveDir, f));
        if (stat.mtimeMs > latestTime) { latestTime = stat.mtimeMs; latest = f; }
      } catch {}
    }
    return latest ? { file: latest, mtime: latestTime } : null;
  } catch { return null; }
});

// ── UI batch 2 (2026-05-31): surface already-cracked save data on the live
// watch path. Attaches three additive fields to `newData` so they ride the
// existing `save-snapshot` IPC to App.js with NO preload change:
//   • eventLog        — full end-of-turn event-scroll records (eventLogParser)
//   • lastTurnEvents  — diffTurn(prev save's eventLog, this save's eventLog):
//                       what happened during the elapsed turn, grouped by type
//                       and tagged with faction. null when no prior snapshot.
//   • eventSchedule   — disaster / scripted-event table (eventScheduleParser):
//                       list + map-marker source. PENDING = dated after now.
//   • factionKnowledge— per-faction scouting SUMMARY (factionKnowledgeParser):
//                       { perFaction:{name:{knownTiles,knownSettlements}}, ... }
//                       LIGHT only (no per-tile fog overlay — that needs the
//                       tile resolver + map_regions.tga, too heavy per snapshot).
// The faction-order needed for tagging is the descr_strat declaration order
// (engine order = that with the first rebel slot rotated to the end). We read
// it once from the active descr_strat and cache it per modDataDir.
let _stratOrderCache = { dir: null, order: null };
function getStratFactionOrder(modDataDir) {
  if (!modDataDir) return [];
  if (_stratOrderCache.dir === modDataDir && _stratOrderCache.order) return _stratOrderCache.order;
  const candidates = [
    path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  let order = [];
  for (const src of candidates) {
    try {
      if (!fs.existsSync(src)) continue;
      const text = fs.readFileSync(src, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*faction\s+([a-z_0-9]+)/i);
        if (m && !order.includes(m[1])) order.push(m[1]);
      }
      break;
    } catch { /* try next candidate */ }
  }
  _stratOrderCache = { dir: modDataDir, order };
  return order;
}

// Group last-turn diff events into the UI's summary buckets. Each event is
// already tagged with `.faction` (descr_strat order) by parseEventLog. We pass
// through the raw type so the panel can label/icon precisely. Returns null when
// there is no previous snapshot to diff against (UI shows "—").
// Map the live `newData` snapshot into the src/diagnostics.js input shape. Pure
// + read-only — uses the SAME resolved fields the renderer consumes (no
// re-derive). Garrison classification happens in the renderer (App.js applies
// isGarrisonUnit), so it isn't re-run here; the live diag focuses on the classes
// observable from newData alone (portraits, public order, diplomacy, family,
// turn/year, unit attribution). The non-live App.js diag adds the garrison check.
function buildLiveDiagInput(newData, file) {
  // Portraits — the LIVE commander cards resolve from charactersByRegion's
  // portraitCardsPath (the engine-exact /cards/ path; null ⇒ renderer hash pool).
  // We cross-check against the family tree's coord map (v1PortraitsByCoord),
  // skipping colliding coords (the family map collapses those to one char).
  const commandersLive = [];
  let fam = newData.v1PortraitsByCoord || null;
  try {
    const cbr = newData.charactersByRegion || {};
    const coordCount = new Map();
    const onMap = [];
    for (const list of Object.values(cbr)) {
      for (const c of (list || [])) {
        if (!c || c.isDead) continue;
        if (c.x == null || c.y == null) continue;
        if (!c.firstName) continue;
        onMap.push(c);
        const k = `${c.x},${c.y}`;
        coordCount.set(k, (coordCount.get(k) || 0) + 1);
      }
    }
    for (const c of onMap) {
      const coordKey = `${c.x},${c.y}`;
      commandersLive.push({
        name: `${c.firstName}${c.lastName ? " " + String(c.lastName).replace(/_/g, " ") : ""}`,
        faction: c.faction || null,
        savePath: c.portraitCardsPath || null,
        coordKey,
        ambiguousKey: (coordCount.get(coordKey) || 0) > 1,
      });
    }
  } catch (e) { void e; }

  // Faction leader (player). Identify the REAL leader the SAME way the live
  // Family Tree does — the descr_strat member crowned by the `"leader"` tag
  // (modDescrStratFamilies, the data behind the family-tree panel). NOT from the
  // live region characters' `isLeader` flag: the save's name-pool records also
  // carry that flag with no map tile, so a `.find(isLeader)` returns an arbitrary
  // dummy (e.g. "Biggus_Dickus age 16") rather than the leader the user sees.
  let factionLeader = null;
  const pf = newData.savePlayerFaction || newData.playerFaction || null;
  try {
    if (pf && modDescrStratFamilies && modDescrStratFamilies.byFaction) {
      const bucket = modDescrStratFamilies.byFaction[pf]
        || modDescrStratFamilies.byFaction[String(pf).toLowerCase()];
      const members = bucket && Array.isArray(bucket.members) ? bucket.members : [];
      const lead = members.find((m) => m && Array.isArray(m.tags) && m.tags.includes("leader"));
      if (lead) {
        const ln = lead.lastName ? " " + String(lead.lastName).replace(/_/g, " ") : "";
        factionLeader = { name: `${lead.firstName || "?"}${ln}`, age: typeof lead.age === "number" ? lead.age : null, alive: lead.alive !== false };
      }
    }
  } catch (e) { void e; }

  // Public order — the card prefers settlementFields.publicOrder; the legacy
  // `happinessByCity` is the stale-offset value the card would FALL BACK to.
  // Passing it lets the divergence sub-check catch the 40-vs-295 class live.
  const cardHappinessByCity = newData.happinessByCity || null;

  return {
    label: file ? `live: ${path.basename(file)}` : "live",
    commandersLive,
    familyPortraitByKey: fam,
    settlementFields: newData.settlementFields,
    cardHappinessByCity,
    diplomacy: newData.diplomacyMatrix || null,
    playerFaction: pf,
    expectWars: newData.diplomacyMatrix ? true : null,
    family: Array.isArray(newData.family) ? newData.family : (newData.characters && newData.characters.family) || null,
    factionLeader,
    // A leader resolved from descr_strat ⇒ assert it's present + adult (the
    // overwritten-leader / age-4 regression). If none resolved, the check
    // INFO-skips rather than flagging — we never crown an arbitrary member.
    expectLeader: !!factionLeader,
    minFamilyMembers: 3,
    turn: newData.currentTurn != null ? newData.currentTurn : newData.turn,
    currentYear: newData.currentYear != null ? newData.currentYear : null,
    seasonIndex: newData.seasonIndex != null ? newData.seasonIndex : null,
    unitAttribution: newData.unitAttribution || (newData._stats && newData._stats.unitAttribution) || null,
  };
}

// Compute the three additive fields on `newData`. Pure (no IPC). Called from
// BOTH the initial save-watch-start parse and every incremental reparse. The
// `prevEventLog` is the PREVIOUS snapshot's eventLog (held in lastSaveData) so
// we can diff the elapsed turn; pass null on the first load.
function attachLiveSaveExtras(newData, saveBuf, modDataDir, prevEventLog) {
  const stratOrder = getStratFactionOrder(modDataDir);
  // 1. End-of-turn event log + last-turn diff.
  try {
    const eventLog = cxParseEventLog(saveBuf, stratOrder);
    newData.eventLog = eventLog;
    newData.lastTurnEvents = buildLastTurnSummary(prevEventLog, eventLog); // null on first load
    if (newData.lastTurnEvents && newData.lastTurnEvents.length) {
      console.log(`[save-watch] last-turn events: ${newData.lastTurnEvents.length} new (of ${eventLog.length} total in log)`);
    }
  } catch (e) { console.warn("[save-watch] event-log parse failed:", e.message); newData.eventLog = newData.eventLog || []; }
  // 2. Scripted-event / disaster schedule.
  try {
    newData.eventSchedule = cxParseEventSchedule(saveBuf) || null;
    if (newData.eventSchedule) {
      console.log(`[save-watch] event schedule: ${newData.eventSchedule.count} records (${newData.eventSchedule.records.filter(r => r.isRandom).length} runtime-random)`);
    }
  } catch (e) { console.warn("[save-watch] event-schedule parse failed:", e.message); newData.eventSchedule = null; }
  // 3. Per-faction scouting summary (LIGHT — no per-tile overlay).
  try {
    const engineOrder = cxDeriveEngineOrder(stratOrder); // KNOWING faction = engine order
    const fk = cxParseFactionKnowledge(saveBuf, stratOrder); // tuple OWNER = strat order
    const perFaction = {};
    for (const r of fk.records) {
      const name = engineOrder[r.factionIndex];
      if (name) perFaction[name] = { knownTiles: r.tupleCount, knownSettlements: r.fullCount };
    }
    newData.factionKnowledge = { perFaction, factionsWithTail: fk.records.length, totalTuples: fk.totalTuples };
    console.log(`[save-watch] faction knowledge: ${fk.records.length} factions with scouting tails, ${fk.totalTuples} tuples`);
  } catch (e) { console.warn("[save-watch] faction-knowledge parse failed:", e.message); newData.factionKnowledge = null; }
}

// Single-flight + tail-coalescing lock for reparses. fs.watch fires bursts
// during multi-MB save writes — even with a 1.5s debounce, a second event
// can arrive while a 5s parse is still running. The previous version
// (0.9.213) just dropped the second event; that left the renderer showing
// stale data after a turn-end save. Now we mark a pending-reparse flag
// and run one more pass when the current one finishes.
let _reparsing = false;
let _reparsePending = false;
// 0.9.866: save-watch BACKOFF. After 2+ consecutive reparses where a parse
// WORKER times out (the post-game-crash thrash that sync-falls-back, queues, and
// can starve/crash the renderer — see [[provincia-renderer-crash-recovery]]),
// cool down auto-reparsing for a window so a pathological/partial save can't pin
// the CPU or re-crash the renderer in a loop. The counter resets the moment a
// clean reparse (no worker timeout) succeeds; a fresh save (new mtime) after the
// cooldown reparses normally.
let _consecutiveTimeoutReparses = 0;
let _saveWatchCooldownUntil = 0;
let _saveWatchCooldownLogged = false;
const SAVE_WATCH_COOLDOWN_MS = 60000;

// Renderer-liveness guard. After the renderer process crashes (e.g. the game
// CTDs mid-live-run and the OS thrashes — observed 2026-06-02: a 9h live run hit
// renderer OOM → white screen), the BrowserWindow can linger while its web
// frame is disposed. Sending IPC to it throws "Render frame was disposed" and
// every save-watch reparse then spams that error while doing useless work.
// Treat a destroyed window / webContents (or a crashed renderer) as gone.
function getLiveWindow() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return null;
  const wc = win.webContents;
  try {
    if (!wc || wc.isDestroyed() || wc.isCrashed()) return null;
  } catch { return null; }
  return win;
}
// Send to the renderer only if it's alive; never throw if the frame is gone.
function safeSend(channel, payload) {
  const win = getLiveWindow();
  if (!win) return false;
  try { win.webContents.send(channel, payload); return true; }
  catch { return false; }
}

async function reparseLatestSave() {
  if (!activeSaveDir) return;
  // Don't burn a reparse (heavy parse + worker threads) when the renderer is
  // gone — that's the post-game-crash thrash that pinned the machine.
  if (!getLiveWindow()) { _reparsePending = false; return; }
  // 0.9.866: backoff cooldown — skip auto-reparse while cooling down after
  // repeated worker timeouts. A genuinely new save (new mtime) written after the
  // window will reparse on the next event once the cooldown lapses.
  if (_saveWatchCooldownUntil && Date.now() < _saveWatchCooldownUntil) {
    if (!_saveWatchCooldownLogged) {
      _saveWatchCooldownLogged = true;
      try { _writeLog(`[save-watch] in backoff cooldown (~${Math.round((_saveWatchCooldownUntil - Date.now()) / 1000)}s left) — skipping reparse`); } catch {}
    }
    _reparsePending = false;
    return;
  }
  if (_reparsing) {
    _reparsePending = true;
    console.log("[save-watch] queued (reparse already in progress)");
    return;
  }
  _reparsing = true;
  // 0.9.866: set if any parse worker times out this reparse (drives the backoff).
  let hadWorkerTimeout = false;
  // Watchdog: force-clear `_reparsing` after 120s even if the reparse
  // hasn't naturally completed (e.g. a worker hang we haven't accounted
  // for, an unhandled rejection that escaped the try/finally, etc).
  // Without this, a stuck reparse locks the queue forever and every
  // subsequent save event just emits "queued" with no progress.
  // 120s is more than 2x the longest legitimate parse we've observed.
  const watchdog = setTimeout(() => {
    if (_reparsing) {
      console.warn("[save-watch] watchdog: clearing _reparsing after 120s — reparse hung");
      _reparsing = false;
      if (_reparsePending) {
        _reparsePending = false;
        setImmediate(() => { reparseLatestSave().catch(() => {}); });
      }
    }
  }, 120000);
  const win = getLiveWindow();
  if (!win) { _reparsing = false; clearTimeout(watchdog); return; }
  // Pinned save wins: user explicitly chose a specific file to follow.
  // Otherwise fall back to the newest .sav in the directory.
  const latestFile = activePinnedSave || findLatestSave(activeSaveDir);
  if (!latestFile) return;
  const full = path.join(activeSaveDir, latestFile);
  // Skip if same file at same mtime as last parse (avoids redundant work on multi-write bursts).
  try {
    const stat = fs.statSync(full);
    if (latestFile === lastSaveFile && stat.mtimeMs === lastSaveMtime) return;
    lastSaveMtime = stat.mtimeMs;
  } catch { return; }
  try {
    emitSaveProgress("Reading save file", 5);
    await _yield();
    const saveBuf = await fs.promises.readFile(full); // 30-45 MB — async so the event loop keeps serving IPC
    lastSaveBuf = saveBuf;

    // Kick off v1 character scan AND building scan in parallel workers
    // before parseSaveData. Three heavy passes overlap on three cores
    // instead of running sequentially. Each worker falls back to the
    // synchronous path if it fails or if its required mod data is
    // unavailable.
    // 30-second timeout on each worker — if the worker hangs (which
    // we've seen on post-conquest saves), bail to null and let the
    // synchronous fallback take over inside parseCharactersAndUnits.
    // Without this, a stuck worker locks up the entire reparse chain
    // and the renderer never sees the new save. User saw this with
    // save_13.1+ where parses stayed in "queued" forever.
    const withTimeout = (p, ms, name) => Promise.race([
      p,
      new Promise((resolve) => setTimeout(() => {
        hadWorkerTimeout = true;
        console.warn(`[save-watch] ${name} worker timed out after ${ms}ms — falling back to sync`);
        resolve(null);
      }, ms)),
    ]);
    const charsP = (modNameLookup && modTraitNames)
      ? withTimeout(findCharsInWorker(saveBuf, modNameLookup, modTraitNames, modTraitEpithets).catch((e) => {
          console.warn("[save-watch] chars worker failed, falling back to sync:", e.message);
          return null;
        }), 30000, "chars")
      : Promise.resolve(null);
    const buildingsP = withTimeout(parseBuildingsInWorker(saveBuf).catch((e) => {
      console.warn("[save-watch] buildings worker failed, falling back to sync:", e.message);
      return null;
    }), 30000, "buildings");

    const newData = await parseSaveData(full, ({ stage }) => emitSaveProgress(stage, 30), saveBuf);
    if (lastSaveData) {
      const events = diffSaveData(lastSaveData, newData);
      if (events.length > 0) win.webContents.send("save-events", { file: latestFile, events });
    }

    emitSaveProgress("Parsing characters & armies", 50);
    await _yield();
    const precomputedChars = await charsP;
    const extras = parseCharactersAndUnits(saveBuf, precomputedChars);
    if (extras) {
      newData.charactersByRegion = extras.charactersByRegion;
      newData.unitsByRegion = extras.unitsByRegion;
      newData.characterCount = extras.characters.length;
      newData.unitCount = extras.units.length;
      newData.scriptedByFaction = extras.scriptedByFaction;
      newData.currentYear = extras.currentYear;
      newData.currentTurn = extras.currentTurn;
      newData.liveArmies = extras.liveArmies;
      newData.aliveCount = extras.aliveCount;
      newData.deadCount = extras.deadCount;
      newData.inPlaceDeadCount = extras.inPlaceDeadCount;
      // Bridge v1 chars' traits/ancillaries/firstName/lastName onto the
      // role-anchored characterExtras entries via (x, y) coord match.
      // parseCharacterExtras finds RIS chars that v1 misses (different
      // record format), but it can't read trait lists from the role-
      // anchored layout — v1 can, just in a different record. Coord match
      // unites them so right-click character popups show traits.
      try {
        if (newData.characterExtras && extras.characters) {
          const bridged = cxBridgeV1Traits(newData.characterExtras, extras.characters, modAncillaryNames);
          if (bridged > 0) console.log(`[trait-bridge] attached v1 traits to ${bridged}/${newData.characterExtras.length} characterExtras entries`);
        }
      } catch (err) { console.warn("[trait-bridge] failed:", err && err.message); }
      // 0.9.513: build a v1-derived coord→portrait map for the family tree.
      // The cracker's extX/extY (read at +288/+292 of the extended record)
      // are scrambled — diag-portraits.js confirmed against save_macedon t0.sav
      // that every named character's family-tree portrait via cracker disagrees
      // with v1's portrait at the same coord (e.g. DemetriosC at (409,359)
      // gets generic 000 from cracker but specific portrait 032 from v1, and
      // Halkyoneus at (394,374) gets DemetriosC's 032 from cracker because the
      // cracker's coord assignment shifts portraits off-by-one). v1's portrait
      // scan reads the path strings INSIDE the character record, so the
      // (tile, portrait) pairing is structurally tight. Pass this map to the
      // renderer so FamilyTree.js can use it before falling back to the
      // characterExtras coord lookup.
      try {
        if (extras.characters) {
          const v1PortraitsByCoord = {};
          for (const v of extras.characters) {
            if (v.tileX == null || v.tileY == null) continue;
            const ports = Array.isArray(v.portraits) ? v.portraits : [];
            const isBadPath = (p) =>
              !p ||
              (!v.isDead && /\/dead\//i.test(p));
            // Prefer the large /portraits/portraits/ variant for the family
            // tree (it shows the large face); the small /cards/ variant is
            // what unit cards use. Cards path is derived from the chosen one.
            const goodLarge = ports.find((p) => !isBadPath(p) && /\/portraits\/portraits\//i.test(p));
            const goodAny = ports.find((p) => !isBadPath(p));
            const pick = goodLarge || goodAny;
            if (!pick) continue;
            const cards = pick.replace(/\/portraits\/portraits\//i, "/portraits/cards/");
            const fulls = pick.replace(/\/portraits\/cards\//i, "/portraits/portraits/");
            v1PortraitsByCoord[`${v.tileX},${v.tileY}`] = { cards, fulls };
          }
          newData.v1PortraitsByCoord = v1PortraitsByCoord;
          console.log(`[v1-portrait-bridge] built ${Object.keys(v1PortraitsByCoord).length} coord entries from ${extras.characters.length} v1 chars`);
        }
      } catch (err) { console.warn("[v1-portrait-bridge] failed:", err && err.message); }
    }

    emitSaveProgress("Parsing built buildings", 80);
    await _yield();
    try {
      // Worker is almost certainly done by now (it ran in parallel
      // with parseSaveData + chars worker). Falls back to sync if it
      // failed.
      const bRes = (await buildingsP) || parseSettlementBuildings(saveBuf);
      newData.builtBuildingsByCity = bRes.buildingsByCity;
      newData.queuedBuildingsByCity = bRes.queuedByCity;
      newData.recruitingByCity = bRes.recruitingByCity || {};
      newData.buildingQueueByCity = bRes.buildingQueueByCity || {};
    } catch (e) { console.warn("[save-watch] building parse failed:", e.message); }

    if (modInitialOwnerByCity) newData.initialOwnerByCity = modInitialOwnerByCity;
    if (modInitialCreatorByCity) newData.initialCreatorByCity = modInitialCreatorByCity;
    if (modInitialOwnerByCity) {
      emitSaveProgress("Resolving settlement ownership", 90);
      await _yield();
      try {
        const cur = resolveCurrentOwners(saveBuf, modInitialOwnerByCity);
        newData.currentOwnerByCity = cur.ownerByCity;
        newData.ownerOffset = cur.detectedOffset;
        if (cur.error) console.warn("[save-watch] owner resolve:", cur.error);
      } catch (e) { console.warn("[save-watch] owner resolve failed:", e.message); }
      // Settlement governors (governor field at marker - 1940). Cross-reference
      // each uuid against the v1 character pool we already parsed.
      try {
        const setts = findAllSettlementMarkers(saveBuf);
        const govByCity = findSettlementGovernors(saveBuf, setts);
        const charByUuid = new Map();
        for (const c of (extras?.characters || [])) {
          if (c.secondaryUuid) charByUuid.set(c.secondaryUuid, c);
          if (c.primaryUuid && c.primaryUuid !== 0xffffffff) charByUuid.set(c.primaryUuid, c);
        }
        const resolved = {};
        for (const [city, uuid] of Object.entries(govByCity)) {
          const c = charByUuid.get(uuid);
          if (c) {
            resolved[city] = {
              firstName: c.firstName,
              lastName: c.lastName || null,
              age: c.age,
              gender: c.gender,
              isLeader: c.isLeader,
              isHeir: c.isHeir,
              traitCount: c.traits?.length || 0,
              uuid,
            };
          } else {
            resolved[city] = { uuid, unresolved: true };
          }
        }
        newData.governorByCity = resolved;
      } catch (e) { console.warn("[save-watch] governor resolve failed:", e.message); }
      // Re-attribute army factions using the region's current owner.
      // The captain_card_<faction>.tga marker fallback in parseCharacters
      // AndUnits gets EVERY rebel-faction army wrong: rebels (Picentes,
      // Salentinians, etc.) don't have captain_card markers, so the most-
      // recent marker before their unit block is some unrelated faction.
      // The region's CURRENT owner (from currentOwnerByCity) is the
      // authoritative answer for an army standing in its own territory.
      try {
        const own = newData.currentOwnerByCity || {};
        // region → city → owner. modRegionToCity bridges from the save's
        // region-tagged unit records to the city-keyed currentOwnerByCity.
        if (newData.liveArmies && Object.keys(own).length > 0) {
          // Build a fast lookup: governor uuid → city's owner. The
          // captain_card_<faction>.tga marker fallback misattributes
          // some governors (verified: Tarentum's Greek general gets
          // marker captain_card_syracuse.tga but his governing faction
          // is `taras`). When a v1 character IS a settlement governor,
          // their faction should match the settlement owner regardless
          // of which captain_card marker happens to precede them.
          const governorOwnerByUuid = new Map();
          if (newData.governorByCity) {
            for (const [city, g] of Object.entries(newData.governorByCity)) {
              if (!g || !g.uuid) continue;
              const o = own[city];
              if (o) governorOwnerByUuid.set(g.uuid, o);
            }
          }
          for (const army of newData.liveArmies) {
            // Re-attribute when the army's commander is a settlement
            // governor — overrides the captain_card marker which can
            // mis-attribute (e.g. the Tarentum governor's record
            // happens to be preceded by `captain_card_syracuse.tga`
            // but the governor's actual faction is `taras`).
            const cmd = army.commanderUuid;
            if (cmd && governorOwnerByUuid.has(cmd)) {
              army.faction = governorOwnerByUuid.get(cmd);
              continue;
            }
            // Existing rule for the OTHER case: identified v1
            // characters have traits parsed from their record; their
            // captain_card-derived faction is generally accurate for
            // non-governor characters. Skip re-attribution to protect
            // own-faction generals standing inside enemy territory.
            if (army.traits && army.traits.length > 0) continue;
            const region = army.units?.[0]?.region;
            if (!region) continue;
            const city = modRegionToCity?.[region];
            const owner = (city && own[city]) || own[region];
            if (owner) army.faction = owner;
          }
        }
      } catch (e) { console.warn("[save-watch] army-faction re-attribution failed:", e.message); }
    }
    // Active sieges + turns-remaining (cracked 2026-05-30, src/siegeParser.js).
    // Each siege links the besieging army to the besieged settlement via a
    // siege-ID; the besieger record carries a turn counter (resets to 5,
    // decrements each turn, 0 = ripe to fall). Drives the live siege-turns UI.
    try {
      const sgMarkers = findAllSettlementMarkers(saveBuf);
      newData.sieges = parseSieges(saveBuf, sgMarkers);
      if (newData.sieges.length) {
        console.log(`[save-watch] sieges: ${newData.sieges.map(s => `${s.targetSettlement || "?"}=${s.turnsRemaining}t`).join(", ")}`);
      }
    } catch (e) { console.warn("[save-watch] siege parse failed:", e.message); newData.sieges = []; }
    // Per-settlement runtime fields, incl. the CONFIRMED public-order
    // breakdown slots (src/settlementFieldsParser.js, cracked 2026-05-31).
    // Drives the public-order contribution row in the RegionInfo card.
    try {
      const sfMarkers = findAllSettlementMarkers(saveBuf);
      newData.settlementFields = parseSettlementFields(saveBuf, sfMarkers);
    } catch (e) { console.warn("[save-watch] settlement-fields parse failed:", e.message); newData.settlementFields = {}; }
    // The 7 Wonders (LANDMARK_MANAGER, src/landmarkParser.js, cracked 2026-06-06).
    // Static fixed-position records; the renderer resolves each to its region/owner
    // via tileToRegion. Cheap (one indexOf + 7 reads), parsed per snapshot.
    try {
      newData.landmarks = parseLandmarks(saveBuf);
    } catch (e) { console.warn("[save-watch] landmark parse failed:", e.message); newData.landmarks = []; }
    // UI batch 2: event log + last-turn diff, disaster schedule, scouting
    // summary. `lastSaveData` here is still the PREVIOUS snapshot (it's not
    // reassigned to newData until after the send below), so its `.eventLog`
    // is the right "before" set for the turn-elapsed diff.
    attachLiveSaveExtras(newData, saveBuf, activeModDataDir, lastSaveData ? lastSaveData.eventLog : null);
    // [diag] APP SELF-CHECK — one summary per live load/turn into provincia.log.
    // Reads only the already-built newData (no re-derive). Never throws.
    try { logAppDiagnostics(runAppDiagnostics(buildLiveDiagInput(newData, latestFile))); }
    catch (e) { console.warn("[diag] live self-check failed:", e && e.message); }
    emitSaveProgress("Done", 100);
    safeSend("save-snapshot", { file: latestFile, data: newData });
    // Re-anchor live-log tracking to the moment of this save. Save state
    // is authoritative; the log is only useful for events that happened
    // AFTER this save was written. Anything older is either reflected in
    // the save itself (so reading it again is redundant) or belongs to a
    // previous game session (so reading it is wrong). Tell the renderer
    // to drop its live state too. Manual Reset button still available
    // for cases where the user wants to drop state without saving.
    if (logPollInterval && _lastWatchedLogDir) {
      try {
        const lp = path.join(_lastWatchedLogDir, "message_log.txt");
        if (fs.existsSync(lp)) logOffset = fs.statSync(lp).size;
        const ap = path.join(_lastWatchedLogDir, "campaign_ai_log.txt");
        if (fs.existsSync(ap)) logOffsetAI = fs.statSync(ap).size;
        clearPassengers();
        safeSend("live-char-moves", { moves: [], deaths: [], reset: true });
      } catch {}
    }
    lastSaveData = newData;
    lastSaveFile = latestFile;
    console.log("[save-watch] reparsed:", latestFile,
      extras ? `(chars=${extras.characters.length}, units=${extras.units.length})` : "(no char data yet)");
  } catch (e) {
    console.error("[save-watch] reparse error:", e.message, e.stack);
  } finally {
    clearTimeout(watchdog);
    _reparsing = false;
    // 0.9.866: backoff bookkeeping. A reparse whose worker(s) timed out is a
    // thrash signal; 2+ in a row → cool down so we stop sync-falling-back and
    // re-queuing on a pathological save (which can starve/crash the renderer).
    // Any clean reparse clears the streak.
    if (hadWorkerTimeout) {
      _consecutiveTimeoutReparses++;
      if (_consecutiveTimeoutReparses >= 2) {
        _saveWatchCooldownUntil = Date.now() + SAVE_WATCH_COOLDOWN_MS;
        _saveWatchCooldownLogged = false;
        _consecutiveTimeoutReparses = 0;
        try { _writeLog(`[save-watch] ${2}+ consecutive reparses hit a worker timeout — backing off auto-reparse for ${Math.round(SAVE_WATCH_COOLDOWN_MS / 1000)}s to avoid thrashing the CPU/renderer`); } catch {}
      }
    } else {
      _consecutiveTimeoutReparses = 0;
    }
    if (_reparsePending) {
      _reparsePending = false;
      // Defer with setImmediate so the current call frame fully unwinds
      // before the next reparse begins. Prevents recursion-style stack growth
      // when many events queue up during a long parse.
      setImmediate(() => { reparseLatestSave().catch(() => {}); });
    }
  }
}

// Yield to the event loop so queued IPC sends actually flush to the
// renderer between stages. Without this, the main process stays busy in a
// synchronous parse and the user sees a frozen window for tens of seconds.
const _yield = () => new Promise(resolve => setImmediate(resolve));

// Emit a progress update to the renderer's loading banner. `stage` is a
// short user-facing label; `pct` is 0..100 (integer or null).
function emitSaveProgress(stage, pct) {
  safeSend("save-progress", { stage, pct });
}

ipcMain.handle("save-watch-start", async (_event, saveDir, pinnedSave) => {
  console.log("[save-watch] start:", saveDir, "exists:", fs.existsSync(saveDir), "pinned:", pinnedSave || "(none)");
  if (!fs.existsSync(saveDir)) return { error: "Save directory not found: " + saveDir };
  activeSaveDir = saveDir;
  activePinnedSave = pinnedSave || null;

  // Clicking Live = fresh session. Drop any live-log state accumulated
  // before now (passengers, unit-flow, char positions, per-char army uuid
  // tracking). Also re-anchor the log watcher's offset to current EOF so
  // we ignore old game-session entries. User requested this 2026-05-11.
  try {
    clearPassengers();
    if (logPollInterval && _lastWatchedLogDir) {
      const lp = path.join(_lastWatchedLogDir, "message_log.txt");
      if (fs.existsSync(lp)) logOffset = fs.statSync(lp).size;
      const ap = path.join(_lastWatchedLogDir, "campaign_ai_log.txt");
      if (fs.existsSync(ap)) logOffsetAI = fs.statSync(ap).size;
    }
    const winR = BrowserWindow.getAllWindows()[0];
    if (winR) winR.webContents.send("live-char-moves", { moves: [], deaths: [], reset: true });
  } catch {}

  // Parse latest save as baseline and send initial snapshot.
  const latestFile = activePinnedSave || findLatestSave(saveDir);
  console.log("[save-watch] latest save:", latestFile);
  if (latestFile) {
    try {
      const full = path.join(saveDir, latestFile);
      // Run the heavy parse in stages, yielding to the event loop between
      // each one so the renderer's loading banner can actually update. Each
      // stage emits a `save-progress` event with a human-readable label.
      emitSaveProgress("Reading save file", 5);
      await _yield();
      const saveBuf = await fs.promises.readFile(full); // 30-45 MB — async, see reparseLatestSave
      lastSaveBuf = saveBuf;
      try { lastSaveMtime = fs.statSync(full).mtimeMs; } catch {}

      // Kick off v1 char scan + building scan in workers — they run
      // parallel with parseSaveData on separate cores.
      const charsP = (modNameLookup && modTraitNames)
        ? findCharsInWorker(saveBuf, modNameLookup, modTraitNames, modTraitEpithets).catch((e) => {
            console.warn("[save-watch] initial chars worker failed, falling back:", e.message);
            return null;
          })
        : Promise.resolve(null);
      const buildingsP = parseBuildingsInWorker(saveBuf).catch((e) => {
        console.warn("[save-watch] initial buildings worker failed, falling back:", e.message);
        return null;
      });

      lastSaveData = await parseSaveData(full, ({ stage }) => emitSaveProgress(stage, 30), saveBuf);
      lastSaveFile = latestFile;

      emitSaveProgress("Parsing characters & armies", 50);
      await _yield();
      let initialExtras = null;
      try {
        const precomputedChars = await charsP;
        initialExtras = parseCharactersAndUnits(saveBuf, precomputedChars);
        if (initialExtras) {
          lastSaveData.charactersByRegion = initialExtras.charactersByRegion;
          lastSaveData.unitsByRegion = initialExtras.unitsByRegion;
          lastSaveData.characterCount = initialExtras.characters.length;
          lastSaveData.unitCount = initialExtras.units.length;
          lastSaveData.scriptedByFaction = initialExtras.scriptedByFaction;
          lastSaveData.currentYear = initialExtras.currentYear;
          lastSaveData.currentTurn = initialExtras.currentTurn;
          lastSaveData.liveArmies = initialExtras.liveArmies;
          lastSaveData.aliveCount = initialExtras.aliveCount;
          lastSaveData.deadCount = initialExtras.deadCount;
          lastSaveData.inPlaceDeadCount = initialExtras.inPlaceDeadCount;
          try {
            if (lastSaveData.characterExtras && initialExtras.characters) {
              const bridged = cxBridgeV1Traits(lastSaveData.characterExtras, initialExtras.characters, modAncillaryNames);
              if (bridged > 0) console.log(`[trait-bridge] attached v1 traits to ${bridged}/${lastSaveData.characterExtras.length} characterExtras entries`);
            }
          } catch (err) { console.warn("[trait-bridge] failed:", err && err.message); }
        }
      } catch (e) { console.warn("[save-watch] characters/units failed:", e.message); }

      emitSaveProgress("Parsing built buildings", 80);
      await _yield();
      try {
        const bRes = (await buildingsP) || parseSettlementBuildings(saveBuf);
        lastSaveData.builtBuildingsByCity = bRes.buildingsByCity;
        lastSaveData.queuedBuildingsByCity = bRes.queuedByCity;
        lastSaveData.recruitingByCity = bRes.recruitingByCity || {};
        lastSaveData.buildingQueueByCity = bRes.buildingQueueByCity || {};
      } catch (e) { console.warn("[save-watch] settlement buildings failed:", e.message); }

      if (lastSaveData && modInitialOwnerByCity && saveBuf) {
        emitSaveProgress("Resolving settlement ownership", 90);
        await _yield();
        lastSaveData.initialOwnerByCity = modInitialOwnerByCity;
        if (modInitialCreatorByCity) lastSaveData.initialCreatorByCity = modInitialCreatorByCity;
        try {
          const cur = resolveCurrentOwners(saveBuf, modInitialOwnerByCity);
          lastSaveData.currentOwnerByCity = cur.ownerByCity;
          lastSaveData.ownerOffset = cur.detectedOffset;
        } catch (e) { console.warn("[save-watch] initial owner resolve failed:", e.message); }
        try {
          const setts = findAllSettlementMarkers(saveBuf);
          const govByCity = findSettlementGovernors(saveBuf, setts);
          // Use the full parser output (initialExtras.characters) — the
          // flattened charactersByRegion view drops chars that didn't get
          // a region assigned (sec-uuid → unit-region lookup miss), and
          // it lacks primaryUuid keying. Mirror reparseLatestSave's
          // logic so initial and incremental loads pick the same govs.
          const charByUuid = new Map();
          for (const c of (initialExtras?.characters || [])) {
            if (c.secondaryUuid) charByUuid.set(c.secondaryUuid, c);
            if (c.primaryUuid && c.primaryUuid !== 0xffffffff) charByUuid.set(c.primaryUuid, c);
          }
          const resolved = {};
          for (const [city, uuid] of Object.entries(govByCity)) {
            const c = charByUuid.get(uuid);
            if (c) {
              resolved[city] = {
                firstName: c.firstName,
                lastName: c.lastName || null,
                age: c.age,
                gender: c.gender,
                isLeader: c.isLeader,
                isHeir: c.isHeir,
                traitCount: c.traits?.length || 0,
                uuid,
              };
            } else {
              resolved[city] = { uuid, unresolved: true };
            }
          }
          lastSaveData.governorByCity = resolved;
        } catch (e) { console.warn("[save-watch] governor resolve failed:", e.message); }
        // Re-attribute army factions using the region's current owner.
        // Mirror the reparseLatestSave logic — without this on the
        // initial load, captain_card_<faction>.tga marker fallbacks
        // misattribute factions (e.g. Titus's bodyguard at offset
        // 0x1ae4768 reads the most-recent marker `captain_card_massalia`
        // even though he's the messapians faction leader, then the panel
        // filter rejects him as foreign-faction in messapian-held
        // Brundisium and the Garrison ends up empty).
        try {
          const own = lastSaveData.currentOwnerByCity || {};
          if (lastSaveData.liveArmies && Object.keys(own).length > 0) {
            const governorOwnerByUuid = new Map();
            if (lastSaveData.governorByCity) {
              for (const [city, g] of Object.entries(lastSaveData.governorByCity)) {
                if (!g || !g.uuid) continue;
                const o = own[city];
                if (o) governorOwnerByUuid.set(g.uuid, o);
              }
            }
            for (const army of lastSaveData.liveArmies) {
              const cmd = army.commanderUuid;
              if (cmd && governorOwnerByUuid.has(cmd)) {
                army.faction = governorOwnerByUuid.get(cmd);
                continue;
              }
              // Skip identified v1 characters — see reparseLatestSave
              // version for the full rationale.
              if (army.traits && army.traits.length > 0) continue;
              const region = army.units?.[0]?.region;
              if (!region) continue;
              const city = modRegionToCity?.[region];
              const owner = (city && own[city]) || own[region];
              if (owner) army.faction = owner;
            }
          }
        } catch (e) { console.warn("[save-watch] army-faction re-attribution failed:", e.message); }
      }
      // Sieges + per-settlement runtime fields on the INITIAL live load too
      // (the incremental reparse path computed these, but the first snapshot
      // skipped them — so a besieged city / order breakdown only appeared
      // after the user ended a turn). Mirror reparseLatestSave here.
      try {
        const sgMarkers = findAllSettlementMarkers(saveBuf);
        lastSaveData.sieges = parseSieges(saveBuf, sgMarkers);
        lastSaveData.settlementFields = parseSettlementFields(saveBuf, sgMarkers);
      } catch (e) {
        console.warn("[save-watch] initial siege/settlement-fields parse failed:", e.message);
        lastSaveData.sieges = lastSaveData.sieges || [];
        lastSaveData.settlementFields = lastSaveData.settlementFields || {};
      }
      // UI batch 2: event log, disaster schedule, scouting summary. No prior
      // snapshot on the very first load → lastTurnEvents stays null (UI: "—").
      try {
        attachLiveSaveExtras(lastSaveData, saveBuf, activeModDataDir, null);
      } catch (e) { console.warn("[save-watch] initial live-extras failed:", e.message); }
      // [diag] APP SELF-CHECK on the INITIAL live load too (mirrors the
      // incremental-reparse call). One summary into provincia.log per load.
      try { logAppDiagnostics(runAppDiagnostics(buildLiveDiagInput(lastSaveData, lastSaveFile))); }
      catch (e) { console.warn("[diag] initial live self-check failed:", e && e.message); }
      emitSaveProgress("Done", 100);
      const bCount = Object.keys(lastSaveData.buildings || {}).length;
      const aCount = Object.keys(lastSaveData.armies || {}).length;
      const cCount = lastSaveData.characterCount || 0;
      const uCount = lastSaveData.unitCount || 0;
      console.log("[save-watch] parsed:", bCount, "settlements,", aCount, "army regions,", cCount, "characters,", uCount, "units");
    } catch (e) {
      console.error("[save-watch] parse error:", e.message);
      lastSaveData = null;
      lastSaveFile = null;
    }
  }

  // Start fs.watch on the save directory — any .sav written triggers a debounced reparse.
  // This catches both game autosaves (turn transitions) and manual saves, without relying
  // on log-line detection.
  if (saveDirWatcher) { try { saveDirWatcher.close(); } catch {} saveDirWatcher = null; }
  try {
    saveDirWatcher = fs.watch(saveDir, { persistent: false }, (eventType, filename) => {
      if (!filename || !filename.endsWith(".sav")) return;
      // Skip End autosave writes — they fire seconds before the matching
      // "Turn N+1 Start" autosave, and the Start one supersedes them.
      // Without this skip, every turn-transition causes TWO reparses of
      // a ~35MB save in quick succession; the End reparse is wasted work
      // since the Start file lands right after.
      if (isEndAutosave(filename)) return;
      if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
      // 600ms debounce — long enough that RTW finishes its multi-write
      // save burst (the engine truncates+rewrites in a few stages), short
      // enough that the colour flip lands within ~1s of the user pressing
      // save, not three. The reparse-lock + tail-coalescing pass below
      // catches any straggling writes that arrive during the parse.
      saveDebounceTimer = setTimeout(() => { saveDebounceTimer = null; reparseLatestSave(); }, 600);
    });
    console.log("[save-watch] fs.watch started on", saveDir);
  } catch (e) {
    console.warn("[save-watch] fs.watch failed:", e.message);
  }

  return { ok: true, saveDir, baseline: lastSaveFile, initialData: lastSaveData };
});

// Manual trigger — still useful as a belt-and-suspenders path from log turn-end detection.
ipcMain.handle("save-check-now", async () => {
  if (!activeSaveDir) return { ok: false, reason: "no save dir" };
  await new Promise(r => setTimeout(r, 2000));
  reparseLatestSave();
  return { ok: true, file: lastSaveFile };
});

// Load mod-specific name/trait tables so subsequent save parses can decode
// characters. Called by the renderer once the user has selected the mod data
// directory. Idempotent — safe to call multiple times.
// Returns the current faction display-name → internal-id map, so the renderer
// can match "House of Claudii" → romans_julii without filename-pattern tricks.
ipcMain.handle("faction-display-map", async () => {
  return modFactionDisplayMap || {};
});

// Self-contained — parses expanded_bi.txt files from mod + game installs
// so users without a mod selected still get faction display names.
// Also reads campaign_descriptions.txt for campaign-specific names like
// "The House of Claudii" (RIS alternate_campaign) vs "Rome" (imperial).
// Pass the campaign id (e.g., "classic" → "alternate_campaign") so the
// matching campaign's titles override the generic expanded_bi entries.
const _factionDisplayCache = makeLRU(16);
const CAMPAIGN_PREFIX = {
  classic: ["ALTERNATE_CAMPAIGN", "RIS_CLASSIC", "RIS_CLASSIC_2"],
  imperial: ["IMPERIAL_CAMPAIGN"],
};
ipcMain.handle("faction-display-names", async (_event, modDataDir, campaign) => {
  const cacheKey = `${modDataDir || ""}|${campaign || ""}`;
  if (_factionDisplayCache.has(cacheKey)) return _factionDisplayCache.get(cacheKey);
  const map = {};
  const sources = [];
  for (const root of getIconSearchRoots()) {
    sources.push(path.join(root, "text", "expanded_bi.txt"));
  }
  for (const d of findRelatedModDirs(modDataDir, "text/expanded_bi.txt").reverse()) {
    sources.push(path.join(d, "text", "expanded_bi.txt"));
  }
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const buf = fs.readFileSync(src);
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\{([A-Z][A-Z0-9_]*)\}\s*(.+?)\s*$/);
        if (!m) continue;
        const key = m[1];
        if (key.includes("_DESCR") || key.startsWith("EMT_") || key.startsWith("SMW_") ||
            key.endsWith("_LABEL") || key.endsWith("_ORDER") || key.endsWith("_UNREST") ||
            key.endsWith("_TITLE") || key.endsWith("_BODY") || key.endsWith("_MESSAGE")) continue;
        const factionId = key.toLowerCase();
        const display = m[2].trim();
        if (!display || display.length > 60) continue;
        map[factionId] = display;
      }
    } catch {}
  }
  // Layer campaign-specific titles on top so the active campaign's faction
  // names (e.g., "The House of Claudii" in alternate_campaign) override
  // generic ones (e.g., "The Roman Republic" from expanded_bi.txt).
  const prefixes = CAMPAIGN_PREFIX[campaign] || [];
  if (prefixes.length) {
    const campSources = [];
    for (const root of getIconSearchRoots()) {
      campSources.push(path.join(root, "text", "campaign_descriptions.txt"));
    }
    for (const d of findRelatedModDirs(modDataDir, "text/campaign_descriptions.txt").reverse()) {
      campSources.push(path.join(d, "text", "campaign_descriptions.txt"));
    }
    for (const src of campSources) {
      if (!fs.existsSync(src)) continue;
      try {
        const buf = fs.readFileSync(src);
        const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
        for (const line of text.split(/\r?\n/)) {
          const m = line.match(/^\{([A-Z0-9_]+)_TITLE\}(.+?)\s*$/);
          if (!m) continue;
          const key = m[1];
          let factionId = null;
          for (const p of prefixes) {
            if (key.startsWith(p + "_")) {
              factionId = key.slice(p.length + 1).toLowerCase();
              break;
            }
          }
          if (!factionId) continue;
          const display = m[2].trim();
          if (!display || display.length > 60) continue;
          map[factionId] = display;
        }
      } catch {}
    }
  }
  _factionDisplayCache.set(cacheKey, map);
  return map;
});

// IPC: return faction → culture map, merged from mod + vanilla + Alexander.
// Self-contained — doesn't depend on charactersInit having been called.
// Users who haven't selected a mod path still get vanilla + Alexander data.
const _factionCultureCache = makeLRU(16);
ipcMain.handle("faction-cultures", async (_event, modDataDir) => {
  const cacheKey = modDataDir || "";
  if (_factionCultureCache.has(cacheKey)) return _factionCultureCache.get(cacheKey);
  const map = {};
  const sources = [];
  // Mod first (first-wins — mod overrides fallbacks).
  for (const d of findRelatedModDirs(modDataDir, "descr_sm_factions.txt")) {
    sources.push(path.join(d, "descr_sm_factions.txt"));
  }
  // Game install fallbacks.
  for (const root of getIconSearchRoots()) {
    sources.push(path.join(root, "descr_sm_factions.txt"));
  }
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const text = fs.readFileSync(src, "utf8");
      let curFaction = null;
      for (const line of text.split(/\r?\n/)) {
        const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
        if (fm) { curFaction = fm[1]; continue; }
        if (curFaction) {
          const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/);
          if (cm) {
            if (!(curFaction in map)) map[curFaction] = cm[1];
            curFaction = null;
          }
        }
      }
    } catch {}
  }
  _factionCultureCache.set(cacheKey, map);
  // Also update the legacy var so other code paths see it.
  if (!modFactionCultures || Object.keys(modFactionCultures).length === 0) {
    modFactionCultures = map;
  }
  return map;
});

// Expose the turn-0 settlement ownership map (settlementName → factionId)
// to the renderer without needing a save loaded. Without this, the recruit
// evaluator falls back to descr_regions.txt's rebel-default faction, which
// for some regions points to a faction that doesn't actually own the
// settlement at game start (Corsica is rebel-default romans_julii but the
// actual descr_strat owner is corsi). That misresolves ownerId and shows
// the wrong faction's recruits.
ipcMain.handle("get-initial-ownership", async () => {
  return modInitialOwnerByCity || {};
});

// 0.9.437: descr_strat `faction_creator` per settlement — the rebel-default
// recorded by descr_strat. Distinct from the parent-faction current owner
// returned by get-initial-ownership. Loyalist map mode uses this to compare
// against descr_regions field 3 (also a rebel-default).
ipcMain.handle("get-initial-creators", async () => {
  return modInitialCreatorByCity || {};
});

// 0.9.468: write a text file directly into the active mod's data dir.
// Used by the unified pending-changes Apply button for resource /
// population / descr_regions edits — those generate the full file
// content client-side (via patchDescrStrat etc) and we just need to
// persist it. Restricted to a safelist of paths so a misbehaving
// renderer can't write arbitrary mod files.
const WRITE_SAFELIST = new Set([
  "world/maps/campaign/imperial_campaign/descr_strat.txt",
  "world/maps/campaign/alexander/descr_strat.txt",
  "world/maps/campaign/barbarian_invasion/descr_strat.txt",
  "world/maps/campaign/ris_classic/descr_strat.txt",
  "world/maps/base/descr_regions.txt",
  "world/maps/imperial_campaign/descr_regions.txt",
  "world/maps/ris_classic/descr_regions.txt",
  "world/maps/campaign/imperial_campaign/descr_win_conditions.txt",
  "world/maps/campaign/alexander/descr_win_conditions.txt",
]);
ipcMain.handle("write-active-mod-file", async (_event, relPath, content) => {
  if (!activeModDataDir) return { ok: false, error: "no active mod" };
  if (typeof relPath !== "string" || typeof content !== "string") {
    return { ok: false, error: "bad args" };
  }
  const normalised = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!WRITE_SAFELIST.has(normalised)) {
    return { ok: false, error: `path not in safelist: ${normalised}` };
  }
  const full = modOut(path.join(activeModDataDir, normalised));
  try {
    // Ensure parent dir exists (it should, but be defensive)
    fs.mkdirSync(path.dirname(full), { recursive: true });
    // RTW:R game text files MUST be CRLF — force it here so a renderer-side
    // patcher can never ship LF (which silently breaks the game's parser, e.g.
    // "Expected faction list starting with playable"). See gameTextCRLF.
    fs.writeFileSync(full, gameTextCRLF(normalised, content), "utf8");
    console.log(`[write-active-mod-file] wrote ${normalised} (${content.length} bytes)${_modExportDir ? " (exported)" : ""}`);
    return { ok: true, path: full };
  } catch (e) {
    console.warn(`[write-active-mod-file] failed for ${normalised}: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// 0.9.465: live homelands (faction → [homeland_<X>, ...]) parsed from the
// active mod's EDB alias blocks. Used by the Homeland map mode in place
// of the stale bundled `homelands.json`.
ipcMain.handle("get-mod-homelands", async () => {
  return modHomelandsByFaction || {};
});

// Parse descr_rebel_factions.txt → { rebelType: { units: [name, ...], category,
// chance, description } }. Slave-owned settlements without an explicit
// descr_strat garrison spawn rebel garrisons procedurally at game start using
// this file's rebel_type → unit pool mapping (keyed off the region's
// `culture` field in descr_regions, e.g. "Romans" / "Coriosolites").
const _rebelFactionsCache = new Map();
ipcMain.handle("get-rebel-factions", async (_event, modDataDir) => {
  const cacheKey = modDataDir || "";
  if (_rebelFactionsCache.has(cacheKey)) return _rebelFactionsCache.get(cacheKey);
  const out = {};
  const sources = [];
  if (modDataDir && fs.existsSync(modDataDir)) {
    sources.push(path.join(modDataDir, "descr_rebel_factions.txt"));
  }
  for (const root of getIconSearchRoots()) {
    sources.push(path.join(root, "descr_rebel_factions.txt"));
  }
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const buf = fs.readFileSync(src);
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      let cur = null;
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/;.*/, "").trim();
        if (!line) continue;
        let m;
        if ((m = line.match(/^rebel_type\s+(.+)$/))) {
          cur = m[1].trim();
          out[cur] = { units: [], category: null, chance: null, description: cur };
          continue;
        }
        if (!cur) continue;
        if ((m = line.match(/^category\s+(.+)$/))) out[cur].category = m[1].trim();
        else if ((m = line.match(/^chance\s+(\d+)/))) out[cur].chance = parseInt(m[1], 10);
        else if ((m = line.match(/^description\s+(.+)$/))) out[cur].description = m[1].trim();
        else if ((m = line.match(/^unit\s+(.+)$/))) out[cur].units.push(m[1].trim());
      }
      console.log("[rebel-factions] parsed", Object.keys(out).length, "rebel types from", src);
      break; // first source with content wins
    } catch (e) { console.warn("[rebel-factions]", src, e.message); }
  }
  _rebelFactionsCache.set(cacheKey, out);
  return out;
});

ipcMain.handle("characters-init", async (_event, modDataDir) => {
  try {
    const info = loadModCharacterData(modDataDir);
    console.log("[characters] loaded mod data:", info);
    // If we already have a cached save, re-emit the snapshot with the new data
    if (lastSaveData && activeSaveDir && lastSaveFile) {
      const full = path.join(activeSaveDir, lastSaveFile);
      // Reuse the buffer cached by save-watch-start; only re-read from
      // disk if the cache was cleared (e.g. save-watch-stop ran). Saves
      // a 30MB read on the common path where characters-init fires
      // right after save-watch-start.
      const saveBuf = lastSaveBuf || await fs.promises.readFile(full);
      lastSaveBuf = saveBuf;
      // Run the v1 char scan AND building scan in parallel workers.
      const charsP = (modNameLookup && modTraitNames)
        ? findCharsInWorker(saveBuf, modNameLookup, modTraitNames, modTraitEpithets).catch((e) => {
            console.warn("[characters-init] chars worker failed, falling back:", e.message);
            return null;
          })
        : Promise.resolve(null);
      const buildingsP = parseBuildingsInWorker(saveBuf).catch((e) => {
        console.warn("[characters-init] buildings worker failed, falling back:", e.message);
        return null;
      });
      const precomputedChars = await charsP;
      const extras = parseCharactersAndUnits(saveBuf, precomputedChars);
      if (extras) {
        lastSaveData.charactersByRegion = extras.charactersByRegion;
        lastSaveData.unitsByRegion = extras.unitsByRegion;
        lastSaveData.characterCount = extras.characters.length;
        lastSaveData.unitCount = extras.units.length;
        lastSaveData.scriptedByFaction = extras.scriptedByFaction;
        lastSaveData.currentYear = extras.currentYear;
        lastSaveData.currentTurn = extras.currentTurn;
        lastSaveData.liveArmies = extras.liveArmies;
        lastSaveData.aliveCount = extras.aliveCount;
        lastSaveData.deadCount = extras.deadCount;
        lastSaveData.inPlaceDeadCount = extras.inPlaceDeadCount;
        // Same bridge as in save-watch path: copy traits from v1 onto the
        // role-anchored characterExtras entries via (x, y) coord match.
        try {
          if (lastSaveData.characterExtras && extras.characters) {
            const bridged = cxBridgeV1Traits(lastSaveData.characterExtras, extras.characters, modAncillaryNames);
            if (bridged > 0) console.log(`[trait-bridge] attached v1 traits to ${bridged}/${lastSaveData.characterExtras.length} characterExtras entries`);
          }
        } catch (err) { console.warn("[trait-bridge] failed:", err && err.message); }
      }
      // Re-parse buildings now that modBuildingChains (EDB whitelist) is loaded.
      // The first save parse may have happened before mod-init (when the
      // whitelist was null and false positives like "siegeTurnsInSetSiege"
      // could leak through).
      try {
        const bRes = (await buildingsP) || parseSettlementBuildings(saveBuf);
        if (lastSaveData) {
          lastSaveData.builtBuildingsByCity = bRes.buildingsByCity;
          lastSaveData.queuedBuildingsByCity = bRes.queuedByCity;
          lastSaveData.recruitingByCity = bRes.recruitingByCity || {};
          lastSaveData.buildingQueueByCity = bRes.buildingQueueByCity || {};
        }
      } catch (e) { console.warn("[characters-init] building re-parse failed:", e.message); }
      if (lastSaveData && modInitialOwnerByCity) {
        lastSaveData.initialOwnerByCity = modInitialOwnerByCity;
        if (modInitialCreatorByCity) lastSaveData.initialCreatorByCity = modInitialCreatorByCity;
        try {
          const cur = resolveCurrentOwners(saveBuf, modInitialOwnerByCity);
          lastSaveData.currentOwnerByCity = cur.ownerByCity;
          lastSaveData.ownerOffset = cur.detectedOffset;
        } catch (e) { console.warn("[characters-init] owner resolve failed:", e.message); }
      }
      // Re-resolve governors now that extras.characters has been refreshed
      // with the mod-specific name lookup. Without this the initial-load
      // governorByCity (resolved against an empty/incomplete v1 char pool
      // before mod-init) sticks around, leaving cities like Rome marked
      // "(governor — character record not decoded)" even though Quintus
      // is fully decoded after mod-init.
      try {
        const setts = findAllSettlementMarkers(saveBuf);
        const govByCity = findSettlementGovernors(saveBuf, setts);
        const charByUuid = new Map();
        for (const c of (extras?.characters || [])) {
          if (c.secondaryUuid) charByUuid.set(c.secondaryUuid, c);
          if (c.primaryUuid && c.primaryUuid !== 0xffffffff) charByUuid.set(c.primaryUuid, c);
        }
        const resolved = {};
        for (const [city, uuid] of Object.entries(govByCity)) {
          const c = charByUuid.get(uuid);
          if (c) {
            resolved[city] = {
              firstName: c.firstName,
              lastName: c.lastName || null,
              age: c.age,
              gender: c.gender,
              isLeader: c.isLeader,
              isHeir: c.isHeir,
              traitCount: c.traits?.length || 0,
              uuid,
            };
          } else {
            resolved[city] = { uuid, unresolved: true };
          }
        }
        lastSaveData.governorByCity = resolved;
      } catch (e) { console.warn("[characters-init] governor resolve failed:", e.message); }
      // Re-attribute army factions (mirrors reparseLatestSave + the
      // initial saveWatchStart path). The captain_card marker fallback
      // misattributes faction for characters whose bodyguard offset
      // happens to follow another faction's captain_card_<faction>.tga
      // path string in the file — without this re-run after mod-init
      // the panel's faction-equality checks reject them as foreign.
      try {
        const own = lastSaveData.currentOwnerByCity || {};
        if (lastSaveData.liveArmies && Object.keys(own).length > 0) {
          const governorOwnerByUuid = new Map();
          if (lastSaveData.governorByCity) {
            for (const [city, g] of Object.entries(lastSaveData.governorByCity)) {
              if (!g || !g.uuid) continue;
              const o = own[city];
              if (o) governorOwnerByUuid.set(g.uuid, o);
            }
          }
          for (const army of lastSaveData.liveArmies) {
            const cmd = army.commanderUuid;
            if (cmd && governorOwnerByUuid.has(cmd)) {
              army.faction = governorOwnerByUuid.get(cmd);
              continue;
            }
            // Skip identified v1 characters — see reparseLatestSave
            // version for the full rationale.
            if (army.traits && army.traits.length > 0) continue;
            const region = army.units?.[0]?.region;
            if (!region) continue;
            const city = modRegionToCity?.[region];
            const owner = (city && own[city]) || own[region];
            if (owner) army.faction = owner;
          }
        }
      } catch (e) { console.warn("[characters-init] army-faction re-attribution failed:", e.message); }
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.webContents.send("save-snapshot", { file: lastSaveFile, data: lastSaveData });
    }

    // 0.9.635: Save-out-of-sync detector. The save stores INDICES into
    // descr_names_lookup.txt and export_descr_character_traits.txt; if those
    // files changed since the save was made (mod updated, characters
    // renamed, traits reordered) the indices resolve to garbage names and
    // traits. The cleanest signal is the Factionleader trait — every
    // playable faction in descr_strat has exactly one leader, so the save
    // should have roughly the same number of characters tagged with
    // "Factionleader". When trait indices drift, that trait stops resolving
    // and the count collapses. The renderer surfaces a yellow banner.
    try {
      const factionsWithChars = modDescrStratFamilies
        ? Object.values(modDescrStratFamilies.byFaction || {}).filter(b => (b.members || []).length > 0).length
        : 0;
      const chars = (lastSaveData && lastSaveData.charactersByRegion)
        ? Object.values(lastSaveData.charactersByRegion).flat()
        : [];
      // Also accept characterExtras as a fallback (different code path).
      const trAll = chars.length ? chars : (lastSaveData?.characterExtras || []);
      const leaderCount = trAll.filter(c => {
        const ts = c.traits || [];
        return ts.some(t => (typeof t === "string" ? t : t?.name) === "Factionleader");
      }).length;
      const totalChars = trAll.length;
      // Only flag when we have enough signal to be meaningful: real save
      // loaded (>20 chars), real mod loaded (>5 factions), AND the ratio
      // of leaders found to factions expected is below 40%.
      if (totalChars >= 20 && factionsWithChars >= 5 && leaderCount < Math.max(2, factionsWithChars * 0.4)) {
        info.saveModSync = {
          stale: true,
          leadersDetected: leaderCount,
          factionsExpected: factionsWithChars,
          totalChars,
          sampleNames: trAll.slice(0, 8).map(c => c.firstName || c.first || "?").filter(Boolean),
        };
        console.warn(`[save-sync] STALE save likely — ${leaderCount}/${factionsWithChars} Factionleader-tagged chars (${totalChars} total)`);
      } else if (totalChars > 0 && factionsWithChars > 0) {
        info.saveModSync = { stale: false, leadersDetected: leaderCount, factionsExpected: factionsWithChars, totalChars };
      }
    } catch (e) { console.warn("[save-sync] detector failed:", e && e.message); }

    return { ok: true, ...info };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Mac dev-pill button: load the bundled RIS subset + sample save so the app
// works on a machine without the game installed. Returns the resolved paths
// (data dir, save dir, save file, campaign); the renderer wires them up via
// the same flow as a normal mod pick (localStorage + characters-init + reload).
// Assembled by scripts/bundle-mac-demo.js into resources/bundled-mod/ at build.
ipcMain.handle("mac-load-bundled-demo", async () => {
  try {
    const root = app.isPackaged
      ? path.join(process.resourcesPath, "bundled-mod")
      : path.join(__dirname, "bundled-mod");
    const dataDir = path.join(root, "data");
    const saveDir = path.join(root, "saves");
    if (!fs.existsSync(dataDir)) {
      return { ok: false, error: `Bundled mod not found at ${root}. Run \`npm run bundle-mac-demo\` (only available on machines with C:\\RIS\\RIS).` };
    }
    // Pre-load mod data into the main process so the renderer's reload finds it ready.
    try { loadModCharacterData(dataDir); } catch (e) { return { ok: false, error: `loadModCharacterData failed: ${e.message}` }; }
    // Pick the first .sav (bundler writes "sample.sav"); fall back to any .sav.
    let saveFile = null;
    if (fs.existsSync(saveDir)) {
      const savs = fs.readdirSync(saveDir).filter(f => /\.sav$/i.test(f));
      saveFile = savs.includes("sample.sav") ? "sample.sav" : (savs[0] || null);
    }
    console.log(`[mac-bundled] activated: dataDir=${dataDir}  save=${saveFile || "(none)"}`);
    return { ok: true, dataDir, saveDir, saveFile, campaign: "Rome" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("save-watch-stop", async () => {
  if (saveDirWatcher) { try { saveDirWatcher.close(); } catch {} saveDirWatcher = null; }
  if (saveDebounceTimer) { clearTimeout(saveDebounceTimer); saveDebounceTimer = null; }
  activeSaveDir = null;
  lastSaveData = null;
  lastSaveFile = null;
  lastSaveMtime = 0;
  return { ok: true };
});

// ── Auto-update (electron-updater) ──────────────────────────────────────
// Checks the GitHub Releases feed configured under build.publish in package.json.
// Fails silently (with a log line) if there's no network, no feed, or it's a dev run.
// Emits IPC events to the renderer so it can show a toast when an update is available
// or downloaded.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = { info: console.log, warn: console.warn, error: console.error, debug: () => {} };

// Cache the most recent update status so the renderer can query it on mount and recover from
// the race where the main process fires update events before the renderer subscribes.
let lastUpdateStatus = null;
function sendUpdateEvent(channel, payload) {
  if (channel === "update-status") lastUpdateStatus = payload;
  // Broadcast to EVERY window, not just getAllWindows()[0]. With the Scripts
  // child window open, [0] could be that window (which has no updater UI), so
  // the main renderer's watch loop never saw "downloaded" — it polled forever
  // and never auto-installed. Extra windows that don't listen just ignore it.
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win.isDestroyed()) continue;
    const wc = win.webContents;
    // 0.9.865: a window can be alive while its RENDER FRAME is disposed (the
    // renderer crashed — e.g. after a game CTD thrashed it). .send() then throws
    // "Render frame was disposed", which spammed the log during an auto-update
    // download. Skip dead/crashed webContents and swallow the race.
    if (!wc || wc.isDestroyed() || wc.isCrashed()) continue;
    try { wc.send(channel, payload); } catch { /* render frame disposed mid-send — ignore */ }
  }
}

ipcMain.handle("get-update-status", async () => lastUpdateStatus);

autoUpdater.on("update-available", (info) => {
  console.log("[updater] update available:", info.version);
  sendUpdateEvent("update-status", { state: "available", version: info.version });
});
autoUpdater.on("update-not-available", () => {
  sendUpdateEvent("update-status", { state: "none" });
});
autoUpdater.on("download-progress", (p) => {
  sendUpdateEvent("update-status", { state: "downloading", percent: Math.round(p.percent || 0) });
});
autoUpdater.on("update-downloaded", (info) => {
  console.log("[updater] downloaded:", info.version);
  sendUpdateEvent("update-status", { state: "downloaded", version: info.version });
});
autoUpdater.on("error", (err) => {
  console.warn("[updater] error:", err.message);
  sendUpdateEvent("update-status", { state: "error", message: err.message });
});

ipcMain.handle("updater-check", async () => {
  if (!app.isPackaged) return { ok: false, reason: "dev build" };
  try { await autoUpdater.checkForUpdates(); return { ok: true }; }
  catch (e) { return { ok: false, reason: e.message }; }
});

ipcMain.handle("updater-quit-and-install", () => {
  // (isSilent, isForceRunAfter). Silent skips the NSIS wizard entirely
  // (electron-updater passes /S to the installer); force-run-after
  // relaunches Provincia automatically once the install finishes. The
  // first-time installer is unaffected — only the update flow goes silent.
  _appQuitting = true;
  autoUpdater.quitAndInstall(true, true);
  return true;
});

// Victory-conditions helper: pick a CSV/text list of region names, then write a
// CSV mapping each region → the faction that owns it in the mod's descr_strat.txt
// (the settlement-block owner). Region tokens may be comma/newline/semicolon/tab
// separated. Unmatched names are reported as NOT_FOUND so label rows stand out.
ipcMain.handle("vc-region-owners-csv", async (_event, modDataDir, campaign) => {
  try {
    const dataDir = modDataDir || activeModDataDir;
    if (!dataDir) return { error: "No mod loaded — import a mod first." };

    const folder = campaign === "classic" ? "ris_classic" : "imperial_campaign";
    const candidates = [
      path.join(dataDir, "world", "maps", "campaign", folder, "descr_strat.txt"),
      path.join(dataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
      path.join(dataDir, "world", "maps", "campaign", "ris_classic", "descr_strat.txt"),
    ];
    let stratPath = candidates.find((p) => fs.existsSync(p));
    if (!stratPath) {
      const base = path.join(dataDir, "world", "maps", "campaign");
      try {
        for (const d of fs.readdirSync(base, { withFileTypes: true })) {
          if (!d.isDirectory()) continue;
          const p = path.join(base, d.name, "descr_strat.txt");
          if (fs.existsSync(p)) { stratPath = p; break; }
        }
      } catch {}
    }
    if (!stratPath) return { error: "descr_strat.txt not found for this mod." };

    const parent = BrowserWindow.getFocusedWindow() || undefined;
    const inp = await dialog.showOpenDialog(parent, {
      title: "Select region list (CSV / text)",
      filters: [{ name: "CSV / text", extensions: ["csv", "txt"] }, { name: "All files", extensions: ["*"] }],
      properties: ["openFile"],
    });
    if (inp.canceled || !inp.filePaths[0]) return { canceled: true };
    const inputPath = inp.filePaths[0];

    // Parse region tokens (dedupe, preserve order).
    const seen = new Set();
    const regions = [];
    for (const tok of fs.readFileSync(inputPath, "utf8").split(/[\r\n,;\t]+/)) {
      const t = tok.trim();
      if (t && !seen.has(t)) { seen.add(t); regions.push(t); }
    }
    if (regions.length === 0) return { error: "No region names found in that file." };

    // region → owning faction, from descr_strat settlement blocks.
    const ownerByRegion = {}, ownerLower = {};
    {
      let curFaction = null, inSettlement = false;
      for (const line of fs.readFileSync(stratPath, "utf8").split(/\r?\n/)) {
        const s = line.trim();
        if (!s || s.startsWith(";")) continue;
        const fm = s.match(/^faction\s+([^\s,]+)/);
        if (fm) { curFaction = fm[1].toLowerCase(); inSettlement = false; continue; }
        if (s === "settlement") { inSettlement = true; continue; }
        if (inSettlement && /^region\b/.test(s)) {
          const rn = s.replace(/^region\s+/, "").trim();
          if (rn && curFaction) { ownerByRegion[rn] = curFaction; ownerLower[rn.toLowerCase()] = curFaction; }
          inSettlement = false;
        }
      }
    }

    // city → region (from descr_regions.txt) so a list of CITY names resolves too
    // (descr_strat's `region` field holds province names like Faliscia, not the
    // city Falerii). Blocks are 8 lines (region, city, faction, culture, rgb,
    // tags, farm, pop); original RTW adds a 9th (ethnicities) — detect per block
    // so the walk doesn't desync and skip later regions.
    const cityToRegion = {}, cityToRegionLower = {};
    {
      const regCandidates = [
        path.join(dataDir, "world", "maps", "campaign", folder, "descr_regions.txt"),
        path.join(dataDir, "world", "maps", "base", "descr_regions.txt"),
        path.join(dataDir, "world", "maps", "campaign", "imperial_campaign", "descr_regions.txt"),
      ];
      const regPath = regCandidates.find((p) => fs.existsSync(p));
      if (regPath) {
        const L = fs.readFileSync(regPath, "utf8").split(/\r?\n/);
        const isStart = (raw) => {
          if (raw == null || /^\s/.test(raw)) return false;
          const t = raw.trim();
          return !!t && !t.startsWith(";") && /^[A-Za-z][A-Za-z0-9_]*$/.test(t);
        };
        let i = 0;
        while (i < L.length) {
          const t = (L[i] || "").trim();
          if (!t || t.startsWith(";")) { i++; continue; }
          if (i + 7 >= L.length) break;
          const rgb = (L[i + 4] || "").trim().split(/\s+/);
          if (rgb.length !== 3 || !/^\d+$/.test(rgb[0])) { i++; continue; }
          const region = t, city = (L[i + 1] || "").trim();
          if (city) { cityToRegion[city] = region; cityToRegionLower[city.toLowerCase()] = region; }
          const next = L[i + 8];
          const has9 = next != null && !isStart(next) && !!next.trim() && !next.trim().startsWith(";");
          i += has9 ? 9 : 8;
        }
      }
    }

    const resolveOwner = (name) => {
      let o = ownerByRegion[name] || ownerLower[name.toLowerCase()];
      if (o) return o;
      const reg = cityToRegion[name] || cityToRegionLower[name.toLowerCase()];
      if (reg) return ownerByRegion[reg] || ownerLower[reg.toLowerCase()] || null;
      return null;
    };

    const csvCell = (v) => (/[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
    let found = 0, notFound = 0;
    const rows = ["region,owner_faction"];
    for (const r of regions) {
      const owner = resolveOwner(r);
      if (owner) { found++; rows.push(`${csvCell(r)},${csvCell(owner)}`); }
      else { notFound++; rows.push(`${csvCell(r)},NOT_FOUND`); }
    }

    const baseName = path.basename(inputPath).replace(/\.[^.]+$/, "");
    const out = await dialog.showSaveDialog(parent, {
      title: "Save region owners (CSV)",
      defaultPath: path.join(path.dirname(inputPath), `${baseName}_owners.csv`),
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (out.canceled || !out.filePath) return { canceled: true };
    fs.writeFileSync(out.filePath, rows.join("\r\n") + "\r\n", "utf8");

    return { total: regions.length, found, notFound, outputPath: out.filePath };
  } catch (e) {
    return { error: e.message };
  }
});

// Single-instance lock: a second launch would run duplicate save/log watchers
// against the same files and the same provincia.log fd — focus the existing
// window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  applyContentSecurityPolicy();
  createWindow();
  // Embedded Settlement Processor (Scripts) — registers its sps:* IPC handlers
  // and seeds its working dir. getHostMod feeds the mod Provincia has loaded so
  // the Scripts window can auto-source it (Phase E). Required here (post-ready)
  // so its app.getPath('userData') resolves correctly.
  try {
    const { registerScriptSuite } = require("./main-scripts");
    registerScriptSuite({
      getHostMod: () => (activeModDataDir ? { dataDir: activeModDataDir } : null),
    });
  } catch (e) {
    console.warn("[scripts-suite] registration failed:", e && e.message);
  }
  // Run one check on startup (packaged builds only — dev builds would 404)
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(err =>
      console.warn("[updater] startup check failed:", err.message)
    );
    // Re-check periodically so a long-running app picks up releases published
    // AFTER launch (we ship frequently). electron-updater only checked at
    // startup before, so an already-open app never noticed new versions until
    // it was restarted. Downloads in the background (autoDownload); applied on
    // quit (autoInstallOnAppQuit) or via the "Restart & install" banner.
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(err =>
        console.warn("[updater] periodic check failed:", err.message)
      );
    }, 10 * 60 * 1000); // every 10 minutes
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});