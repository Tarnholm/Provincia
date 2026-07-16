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

// Run the live-load save parse (parseSaveData) in a worker so it doesn't block
// the main thread (~1.6s per reload). Streams progress stages back to onProgress
// and replays the parse's [perf]/[diplomacy]/… diagnostics into provincia.log.
// Rejects on worker failure so the caller can fall back to the synchronous
// parse. See src/parseSaveDataWorker.js.
function parseSaveDataInWorker(savePath, saveBuf, onProgress) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, "src", "parseSaveDataWorker.js");
    let worker;
    try { worker = new Worker(workerPath); }
    catch (e) { reject(e); return; }
    worker.on("message", (msg) => {
      if (!msg) return;
      if (msg.type === "progress") { try { if (onProgress) onProgress({ stage: msg.stage }); } catch { /* */ } return; }
      // type === "done"
      worker.terminate();
      if (Array.isArray(msg.logs)) { for (const line of msg.logs) { try { _writeLog(line); } catch { /* */ } } }
      if (msg.ok) resolve(msg.result);
      else reject(new Error(msg.error || "parse worker failed"));
    });
    worker.once("error", (err) => { worker.terminate(); reject(err); });
    // Pass CURRENT mod-state snapshots (stable during a parse) + KNOWN_BUILDINGS
    // as an array (worker rebuilds the Set). Prefer savePath so the worker
    // re-reads from the OS cache rather than us cloning the 34 MB buffer across.
    worker.postMessage({
      savePath: savePath || null,
      saveBuf: savePath ? null : saveBuf,
      knownBuildings: Array.from(KNOWN_BUILDINGS),
      modAiByFaction: modAiByFaction || {},
      modAiPersonalityOrder: modAiPersonalityOrder || [],
      modFactionOrder: modFactionOrder || [],
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
// Timestamped single-line write for direct callers. _writeLog is raw (the
// console hook adds its own stamp+newline); handlers that logged through
// _writeLog directly produced unstamped lines mashed together on one line,
// which made the 0.9.1268 renderer-freeze forensics needlessly painful.
function _logLine(str) {
  try {
    _writeLog(`[${new Date().toISOString().slice(11, 23)}] ${str}\n`);
    _flushLog();
  } catch {}
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

// 0.9.1269: forensic trail for renderer freezes. The preload reports every
// click/dblclick (a short target label) via 'ui-action'; we keep the last 15
// here in main — OUTSIDE the renderer — so when the renderer hangs or dies we
// can log what the user actually did right before. The 2026-07-15 freeze was
// undiagnosable because the renderer's console (our only click trail) froze
// with it.
const _lastUiActions = [];
function formatLastUiActions() {
  if (_lastUiActions.length === 0) return "(none recorded)";
  return _lastUiActions
    .map((a) => `${new Date(a.ts).toISOString().slice(11, 19)} ${a.label}`)
    .join(" → ");
}
try {
  ipcMain.on("ui-action", (_event, label) => {
    _lastUiActions.push({ ts: Date.now(), label: String(label || "?").slice(0, 80) });
    if (_lastUiActions.length > 15) _lastUiActions.shift();
  });
} catch {}

// Logging IPC handlers — see src/logHandlers.js. Inject the log internals via a
// wrapper + getter so a later _writeLog/_logPath reassignment is still seen.
const { registerLogHandlers } = require("./src/logHandlers.js");
registerLogHandlers(ipcMain, { writeLog: (s) => _writeLog(s), getLogPath: () => _logPath, shell });
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
const { loadModData } = require("./src/modDataLoader.js");
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
        _charInitCache.clear(); // mod changed on disk → next characters-init re-parses
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

// characters-init parse cache (2026-07-16). The renderer's init effect fires
// characters-init several times per boot as its inputs settle (icons dir,
// campaign labels, slot switches) — 6 identical full parses of the mod
// (2MB descr_strat, EDB, 4669 names, traits) were observed per launch, each
// blocking the main process. The parse is pure per (dir, on-disk content), so
// cache the summary per dir and skip re-parses until a watched mod file
// actually changes (fs.watch clears the cache) or a direct load refreshes it.
const _charInitCache = new Map(); // modDataDir → __summary

function loadModCharacterData(modDataDir) {
  activeModDataDir = modDataDir;
  try { setupModWatcher(modDataDir); } catch (e) { console.warn("[mod-watch] setup failed:", e && e.message); }
  // Heavy parsing lives in src/modDataLoader.js (returns the mod-state object);
  // assign it onto the module vars the handlers read. Behaviour unchanged.
  const s = loadModData(modDataDir, { buildInitialOwnership, findRelatedModDirs, getIconSearchRoots });
  _charInitCache.set(modDataDir, s.__summary); // direct parses refresh the cache too
  ({
    modAiByFaction, modAiPersonalityOrder, modAncillaryData, modAncillaryNames,
    modBuildingChains, modChainCategories, modChainMaxLevels, modDescrStratCharByName,
    modDescrStratCharactersByRegion, modDescrStratCharsByFirstName, modDescrStratSurnames,
    modFactionCultures, modFactionDisplayMap, modFactionDisplayNames, modFactionOrder,
    modNameLookup, modTraitCharacters, modTraitEpithets, modTraitExcludeCultures,
    modTraitHidden, modTraitLevels, modTraitNames, modUnitOfficerCounts,
    modDescrStratFamilies, modHomelandsByFaction, modInitialCreatorByCity,
    modInitialOwnerByCity, modRegionToCity,
  } = s);
  return s.__summary; // the mod-load summary the caller logs
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
module.exports = {
  parseCharactersAndUnits,
  loadModCharacterData,
  // TEST-ONLY hook: point the active-mod dir at a throwaway sandbox so the
  // file-writing handlers can be driven without touching the real mod. Never
  // called in production. Returns the previous value so tests can restore it.
  __setActiveModDataDir: (d) => { const prev = activeModDataDir; activeModDataDir = d; return prev; },
};

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
    _logLine(`[renderer-gone] reason=${details && details.reason} exitCode=${details && details.exitCode} — attempting reload`);
    _logLine(`[renderer-gone] last UI actions: ${formatLastUiActions()}`);
    if (_appQuitting || win.isDestroyed()) return;
    const now = Date.now();
    if (now - _reloadWindowStart > 60000) { _reloadWindowStart = now; _rendererReloads = 0; }
    _rendererReloads++;
    if (_rendererReloads > 3) {
      _logLine(`[renderer-gone] ${_rendererReloads} reloads in <60s — giving up auto-reload (likely a deterministic crash)`);
      return;
    }
    // Small delay lets the crashed process fully tear down before reloading.
    setTimeout(() => { try { if (!win.isDestroyed()) win.reload(); } catch {} }, 400);
  });
  // 0.9.1269: AUTO-RECOVER from a PERMANENTLY hung renderer, not just a dead
  // one. On 2026-07-15 an infinite loop in the renderer froze the whole UI and
  // it stayed frozen overnight — 'unresponsive' fired, we logged it and did
  // nothing, and every click (Dev button, version label…) was silently eaten
  // until the renderer eventually died on its own. A long sync parse can
  // legitimately look unresponsive for a few seconds, so give it a generous
  // 45s to recover ('responsive' cancels the timer); past that it's a hang,
  // not a parse. forcefullyCrashRenderer() then fires render-process-gone,
  // whose handler above reloads the window (with its 3-strikes loop guard).
  let _unresponsiveSince = null;
  let _unresponsiveKillTimer = null;
  win.webContents.on("unresponsive", () => {
    if (!_unresponsiveSince) _unresponsiveSince = Date.now();
    _logLine(`[renderer-unresponsive] webContents reported unresponsive — auto-recover in 45s unless it comes back`);
    _logLine(`[renderer-unresponsive] last UI actions: ${formatLastUiActions()}`);
    _captureHangStack(); // log WHERE the renderer is stuck (hoisted; defined below)
    if (_unresponsiveKillTimer) return;
    _unresponsiveKillTimer = setTimeout(() => {
      _unresponsiveKillTimer = null;
      if (_appQuitting || win.isDestroyed()) return;
      const stuckFor = Math.round((Date.now() - _unresponsiveSince) / 1000);
      _unresponsiveSince = null;
      _logLine(`[renderer-unresponsive] still stuck after ${stuckFor}s — force-killing renderer to trigger auto-reload`);
      try { win.webContents.forcefullyCrashRenderer(); } catch (e) { _logLine(`[renderer-unresponsive] force-kill failed: ${e && e.message}`); }
    }, 45000);
  });
  win.webContents.on("responsive", () => {
    if (_unresponsiveKillTimer) { clearTimeout(_unresponsiveKillTimer); _unresponsiveKillTimer = null; }
    const stuck = _unresponsiveSince ? ` after ${Math.round((Date.now() - _unresponsiveSince) / 1000)}s` : "";
    _unresponsiveSince = null;
    _stackCaptured = false; // next hang episode gets its own stack
    _logLine(`[renderer-responsive] recovered${stuck}`);
  });
  // Second hang trigger: Electron's 'unresponsive' event is INPUT-driven — it
  // only fires while the user is actively clicking the hung window (verified
  // against a synthetic 240s main-thread loop: zero events without real input).
  // So an unattended hang would never trip the recovery above. This ping does:
  // executeJavaScript("1") every 15s; while the renderer main thread is stuck
  // the promise simply never settles, and after 8 unanswered pings (~2 min —
  // far beyond any legit sync work now that parses run in workers) we
  // force-kill the renderer, which lands in the render-process-gone reload
  // path. Rejections (navigation, reload in flight) are NOT counted as misses.
  // When a hang is detected, capture the renderer's actual JS stack via the
  // built-in CDP debugger and log it — the 2026-07-15 freeze was
  // unattributable because nothing recorded WHERE the renderer was stuck.
  //
  // The session MUST be pre-armed (attach + Debugger.enable) while the
  // renderer is healthy: Debugger.pause interrupts a spinning main thread
  // only on an already-enabled session (verified against a synthetic busy
  // loop — lazy attach, Debugger.enable-on-demand and the sampling profiler
  // all queue behind the hung main thread and never respond).
  const _dbg = win.webContents.debugger;
  function _armHangDebugger() {
    try {
      if (!_dbg.isAttached()) _dbg.attach("1.3");
      _dbg.sendCommand("Debugger.enable").catch(() => {});
    } catch (e) {
      // e.g. DevTools already attached in a dev run — stack capture degrades
      // gracefully to "not available"; the watchdog reload still works.
      _logLine(`[renderer-hang-stack] pre-arm failed: ${e && e.message}`);
    }
  }
  // scriptId → url map so logged frames name their bundle file (callFrames
  // carry no url of their own — the 2026-07-16 hang hunt burned time on
  // "fn@?:line:col" frames that couldn't be sourcemap-resolved to a chunk).
  const _dbgScripts = new Map();
  _dbg.on("message", (_e, method, params) => {
    if (method === "Debugger.scriptParsed") {
      if (params && params.scriptId) _dbgScripts.set(params.scriptId, (params.url || "").split("/").pop() || "(inline)");
      return;
    }
    if (method !== "Debugger.paused") return;
    const frames = (params && params.callFrames) || [];
    const s = frames.slice(0, 15).map((f) => {
      const loc = f.location || {};
      const file = _dbgScripts.get(loc.scriptId) || (f.url || "?").split("/").pop() || "?";
      return `${f.functionName || "(anon)"}@${file}:${loc.lineNumber}:${loc.columnNumber}`;
    }).join(" <- ");
    _logLine(`[renderer-hang-stack] ${s || "(empty stack)"}`);
    _dbg.sendCommand("Debugger.resume").catch(() => {});
  });
  _dbg.on("detach", (_e, reason) => {
    _logLine(`[renderer-hang-stack] debugger detached (${reason}) — re-arming on next load`);
  });
  // (Re-)arm on every load: the session dies with the renderer process when
  // the watchdog force-kills it, and did-finish-load covers boot + reloads.
  win.webContents.on("did-finish-load", () => { if (!_appQuitting && !win.isDestroyed()) _armHangDebugger(); });
  _armHangDebugger();
  let _stackCaptured = false;
  function _captureHangStack() {
    if (_stackCaptured) return; // once per hang episode
    _stackCaptured = true;
    // Three samples 2s apart: identical leaf frames = a tight loop; moving
    // frames = a long-but-progressing task. One sample can't tell them apart.
    let n = 0;
    const sampleOnce = () => {
      try {
        if (!_dbg.isAttached()) { _logLine("[renderer-hang-stack] debugger not attached — no stack available"); return; }
        // The paused event handler above logs the stack and resumes.
        _dbg.sendCommand("Debugger.pause").catch((e) => _logLine(`[renderer-hang-stack] pause failed: ${e && e.message}`));
      } catch (e) {
        _logLine(`[renderer-hang-stack] capture failed: ${e && e.message}`);
        return;
      }
      n += 1;
      if (n < 3) setTimeout(sampleOnce, 2000);
    };
    sampleOnce();
  }
  let _pingMisses = 0;
  let _pingBusy = false;
  const _pingTimer = setInterval(() => {
    if (_appQuitting || win.isDestroyed()) return;
    if (_pingBusy) {
      _pingMisses++;
      if (_pingMisses === 2) _captureHangStack(); // ~30s stuck: log WHERE
      if (_pingMisses >= 8) {
        _pingMisses = 0;
        _pingBusy = false;
        _logLine("[renderer-ping] renderer hasn't answered for ~2 min — force-killing it to trigger auto-reload");
        _logLine(`[renderer-ping] last UI actions: ${formatLastUiActions()}`);
        try { win.webContents.forcefullyCrashRenderer(); } catch (e) { _logLine(`[renderer-ping] force-kill failed: ${e && e.message}`); }
      }
      return;
    }
    _pingBusy = true;
    try {
      win.webContents.executeJavaScript("1", true)
        .then(() => { _pingBusy = false; _pingMisses = 0; _stackCaptured = false; })
        .catch(() => { _pingBusy = false; });
    } catch { _pingBusy = false; }
  }, 15000);
  if (_pingTimer.unref) _pingTimer.unref();
  win.on("closed", () => clearInterval(_pingTimer));

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
// Folder-import & icon-directory discovery IPC handlers (scan-folder,
// select-folder, find-faction-icons-dir, read-faction-icon, get-vanilla-icons-dir)
// — see src/folderImportHandlers.js.
const { registerFolderImportHandlers } = require("./src/folderImportHandlers.js");
registerFolderImportHandlers(ipcMain, {
  dialog, consentStore, scanFolderForCampaigns, addConsentedRoot, getVanillaDataDir,
});

// IPC: the vanilla imperial-campaign descr_strat.txt text, read live from the
// install — so the playable-nations editor shows VANILLA factions on Slot 1.
// Vanilla RTW:R game-data read handlers — see src/vanillaDataHandlers.js.
const { registerVanillaDataHandlers } = require("./src/vanillaDataHandlers.js");
registerVanillaDataHandlers(ipcMain, { getVanillaDataDir });

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
// modDataDir → unit-ownership map (also carries __dictionary per type). Shared
// by get-unit-description / get-unit-ownership and cleared by clear-mod-caches,
// so it lives here in main.js (was accidentally swept into buildingInfoHandlers
// during the EDB-query extraction — regression fixed 2026-07-15).
const _unitOwnershipCache = new Map();
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
// descr_strat / mod editing + backup IPC handlers — see src/modEditingHandlers.js.
const { registerModEditingHandlers } = require("./src/modEditingHandlers.js");
registerModEditingHandlers(ipcMain, {
  getActiveModDataDir: () => activeModDataDir,
  getModExportDir: () => _modExportDir,
  getModDescrStratFamilies: () => modDescrStratFamilies,
  _writeLog: (s) => _writeLog(s),
  buildStartingArmiesFromMod, getVanillaDataDir, loadModCharacterData,
  loadPortraitMapping, resolvePortraitPool, modOut,
});
// Trait/ancillary/portrait icon-resolution handlers — see src/portraitHandlers.js.
const { registerPortraitHandlers } = require("./src/portraitHandlers.js");
registerPortraitHandlers(ipcMain, { getVanillaDataDir, loadPortraitMapping, resolvePortraitPool });

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
const _chainLevelsCache = new Map();
// Building/unit EDB+EDU query handlers — see src/buildingInfoHandlers.js.
const { registerBuildingInfoHandlers } = require("./src/buildingInfoHandlers.js");
registerBuildingInfoHandlers(ipcMain, { getEdbSourceFiles, getMergedTextDictionary, findRelatedModDirs, getIconSearchRoots, _buildingStatsCache, _chainLevelsCache });
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

// Cache instances also cleared by clear-mod-caches — declared here in main.js
// as single instances and injected into the icon/building/unit handlers module
// (moving any of these into that module would break clear-mod-caches).
const _unitStatsCache = new Map();
const _unitUpkeepMapCache = new Map();
const _buildingRecruitsCache = new Map();
const _buildingDisplayCache = makeLRU(16); // modDataDir → parsed map
const _iconDirCache = require("./src/iconDirCache.js").createIconDirCache(fs);
const _uiBuildingsCache = makeLRU(16);
// Building/unit info + icon-resolution IPC handlers — see src/iconHandlers.js.
const { registerIconHandlers } = require("./src/iconHandlers.js");
registerIconHandlers(ipcMain, { _unitOwnershipCache, _unitStatsCache, _unitUpkeepMapCache, _buildingRecruitsCache, _buildingDisplayCache, _iconDirCache, _uiBuildingsCache, getEdbSourceFiles, findRelatedModDirs, getIconSearchRoots, nativeImage, getActiveModDataDir: () => activeModDataDir });

// IPC: read file as text (contained: only inside dialog-consented roots —
// see the consent-store block above scan-folder)
// Generic file I/O IPC handlers (read-file, read-file-binary, read/write-
// autosaves, save-file-as, save-file, write-binary-file, copy-file,
// read-campaign-file, save/read-user-file) — see src/fileHandlers.js.
const { registerFileHandlers } = require("./src/fileHandlers.js");
registerFileHandlers(ipcMain, { app, dialog, isConsentedPath, appRoot: __dirname });

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

// IPC: unified save cracker. Anywhere in the app that wants per-faction data
// (regions, treasury, characters, diplomacy) should call this — NOT reach into
// saveCrackerExtras directly, which has fields that look right but are wrong
// (regionCount returns 4 for Carthage when ownerByCity correctly shows 41).
// Returns { header, playerFaction, factions, settlements, characters, diplomacy, ownerByCity, _stats }.
// Save-analysis / economy / army / vision / trade IPC handlers — see src/saveAnalysisHandlers.js.
const { registerSaveAnalysisHandlers } = require("./src/saveAnalysisHandlers.js");
registerSaveAnalysisHandlers(ipcMain, { _writeLog: (s) => _writeLog(s), getLastSaveBuf: () => lastSaveBuf });

// IPC: get app version
// App/system info + log-folder picker IPC handlers — see src/systemHandlers.js.
const { registerSystemHandlers } = require("./src/systemHandlers.js");
registerSystemHandlers(ipcMain, { app, dialog });

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

// Save-file binary parser — heavy logic in src/parseSaveData.js; bound here to the
// shared KNOWN_BUILDINGS set + mod-state getters so the callers stay unchanged.
const { makeParseSaveData } = require("./src/parseSaveData.js");
const parseSaveDataSync = makeParseSaveData({
  KNOWN_BUILDINGS,
  getModAiByFaction: () => modAiByFaction,
  getModAiPersonalityOrder: () => modAiPersonalityOrder,
  getModFactionOrder: () => modFactionOrder,
});
// parseSaveData runs the ~1.6s live-load parse in a worker thread (off the main
// thread, so a turn no longer freezes the window) with an AUTOMATIC fall back to
// the synchronous parse on any worker failure — same signature, same result, so
// the two call sites (reparseLatestSave + save-watch-start) are unchanged.
function parseSaveData(filePath, onProgress, providedBuf) {
  return parseSaveDataInWorker(filePath, providedBuf, onProgress).catch((e) => {
    _writeLog(`[parse] worker fallback (${e && e.message}) — parsing on main thread`);
    return parseSaveDataSync(filePath, onProgress, providedBuf);
  });
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
    // Skip the full re-parse (and the save-snapshot re-emit, which the first
    // load already did with identical data) when this dir is already loaded
    // and no watched mod file has changed since. The renderer fires this
    // several times per boot as its inputs settle.
    const cached = activeModDataDir === modDataDir ? _charInitCache.get(modDataDir) : null;
    if (cached && cached.ok) {
      console.log(`[characters] init cache hit for ${modDataDir} — skipping re-parse`);
      return cached;
    }
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

    // Cache the FULL response (incl. saveModSync) so a cache-hit return is
    // byte-identical to what the first load told the renderer.
    _charInitCache.set(modDataDir, { ok: true, ...info });
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