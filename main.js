// main.js
const { app, BrowserWindow, Menu, session, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { Worker } = require("worker_threads");
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
let _logStream = null;
let _logPath = null;
function initLogging() {
  try {
    _logPath = path.join(app.getPath("userData"), "provincia.log");
    const prev = _logPath + ".prev";
    try { if (fs.existsSync(_logPath)) fs.renameSync(_logPath, prev); } catch {}
    _logStream = fs.createWriteStream(_logPath, { flags: "a" });
    _logStream.write(`\n=== Provincia v${app.getVersion()} launched ${new Date().toISOString()} ===\n`);
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
        try { if (_logStream) _logStream.write(fmt(lvl.toUpperCase(), args)); } catch {}
        orig(...args);
      };
    }
    process.on("uncaughtException", (err) => {
      console.error("UNCAUGHT EXCEPTION:", err);
    });
    process.on("unhandledRejection", (err) => {
      console.error("UNHANDLED REJECTION:", err);
    });
  } catch (e) {
    // If logging fails, don't kill the app.
  }
}
initLogging();

// IPC: receive log messages from the renderer and write to the same log.
ipcMain.handle("log-message", async (_event, level, text) => {
  try {
    if (_logStream) {
      const stamp = new Date().toISOString().slice(11, 23);
      _logStream.write(`[${stamp}] [RENDERER-${(level || "log").toUpperCase()}] ${text}\n`);
    }
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
const { findCharacterRecords, findCharacterRegion } = require("./src/characterParser.js");
const { findScriptedCharacters: findCharsV2 } = require("./src/characterParserV2.js");
const { parseLine: parseLogLineV2 } = require("./src/messageLogParser.js");
const { findUnitRecords } = require("./src/unitParser.js");
const { parseSettlements } = require("./src/buildingParser.js");
const { buildInitialOwnership } = require("./src/ownershipParser.js");
const { resolveCurrentOwners, findSettlementGovernors } = require("./src/saveOwnershipParser.js");
const { findAllSettlementMarkers } = require("./src/buildingParser.js");
const { findFactionRecords, summarizeFactionArray } = require("./src/factionRecordParser.js");
const { findLuaCounters, indexCountersByName } = require("./src/luaCounterParser.js");

// Cache for mod data (names_lookup, traits, surnames). Populated lazily when
// the renderer calls "characters-init" with the mod data directory.
let modNameLookup = null;
// Bounded LRU for parser caches keyed by `${modDataDir}|...`. Without a
// bound the cache grows every time the user switches mods (each path is a
// unique key, parsed result is held forever). 16 entries is plenty —
// covers vanilla + Alexander + a handful of mod variants.
function makeLRU(limit) {
  const m = new Map();
  return {
    has: (k) => m.has(k),
    get: (k) => {
      if (!m.has(k)) return undefined;
      const v = m.get(k);
      m.delete(k); m.set(k, v); // touch
      return v;
    },
    set: (k, v) => {
      if (m.has(k)) m.delete(k);
      m.set(k, v);
      while (m.size > limit) {
        const oldest = m.keys().next().value;
        m.delete(oldest);
      }
    },
  };
}
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
let modDescrStratCharsByFirstName = null; // "firstName" → [{ x, y, lastName, faction }, ...] (multi-faction lookup)
let modUnitOfficerCounts = null; // { unitName: officerCount } from EDU — added to in-save soldier counts to match in-game UI
let modBuildingChains = null;
let modChainMaxLevels = null; // { chainName: number_of_levels } from EDB
let modChainCategories = null; // { chainName: "trade" | "government" | ... } from EDB `icon` field
let modFactionDisplayMap = null; // { lowercase display name → internal faction id }
let modFactionDisplayNames = null; // { internal faction id → display name } — used in UI
let modFactionCultures = null; // { factionId: cultureFolderName } — "roman", "greek", "barbarian", etc.
let modInitialOwnerByCity = null; // { settlementName → factionId } from descr_strat (turn 0 ground truth)
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
// Ancillary names indexed by id (0-based), loaded from
// export_descr_ancillaries.txt. ID 0 = labrys_maker, ID 1 = saffron_merchant,
// ... 1092 entries in RIS imperial. Decoded by save-cracker session 6:
// ancillary IDs sit inline in the character record between the trait block
// and portrait paths as [u16=0, u16=ancId] pairs.
let modAncillaryNames = null;

function loadModCharacterData(modDataDir) {
  const nameLookupPath = path.join(modDataDir, "descr_names_lookup.txt");
  const traitsPath = path.join(modDataDir, "export_descr_character_traits.txt");
  const ancillariesPath = path.join(modDataDir, "export_descr_ancillaries.txt");
  const edbPath = path.join(modDataDir, "export_descr_buildings.txt");
  const descrStratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
  if (!fs.existsSync(nameLookupPath) || !fs.existsSync(traitsPath)) {
    throw new Error("Mod character data files missing in " + modDataDir);
  }
  // Optional: ancillaries. If missing, ancillary names just render as `#<id>`.
  modAncillaryNames = [];
  if (fs.existsSync(ancillariesPath)) {
    const lines = fs.readFileSync(ancillariesPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^Ancillary\s+(\S+)/);
      if (m) modAncillaryNames.push(m[1]);
    }
  }
  modNameLookup = fs.readFileSync(nameLookupPath, "utf8").split(/\r?\n/).map(s => s.trim());
  modTraitNames = [];
  // While we walk the traits file we ALSO collect Trait → [{ level, epithetKey }]
  // pairs. The first pass through the file gives us the trait→key skeleton;
  // a second pass on text/export_vnvs.txt fills in epithetKey → text.
  modTraitEpithets = {};
  {
    const lines = fs.readFileSync(traitsPath, "utf8").split(/\r?\n/);
    let curTrait = null;
    let curLevel = null;     // level name (e.g. "Roman_Conqueror_Messapians")
    let curLevelIdx = 0;     // 1-indexed level position within current trait
    for (const line of lines) {
      const tm = line.match(/^Trait\s+(\S+)/);
      if (tm) {
        curTrait = tm[1];
        curLevel = null;
        curLevelIdx = 0;
        modTraitNames.push(curTrait);
        continue;
      }
      const lm = line.match(/^\s*Level\s+(\S+)/);
      if (lm) {
        curLevel = lm[1];
        curLevelIdx++;
        continue;
      }
      const em = line.match(/^\s*Epithet\s+(\S+)/);
      if (em && curTrait && curLevel) {
        if (!modTraitEpithets[curTrait]) modTraitEpithets[curTrait] = [];
        modTraitEpithets[curTrait].push({ level: curLevelIdx, levelName: curLevel, key: em[1], text: null });
      }
    }
  }
  // Resolve epithet keys → text by scanning text/export_vnvs.txt. The file
  // is UTF-16 LE; entries look like `{Roman_Conqueror_Messapians_epithet_desc}\tMessapivs`.
  {
    const vnvsPath = path.join(modDataDir, "text", "export_vnvs.txt");
    if (fs.existsSync(vnvsPath)) {
      const buf3 = fs.readFileSync(vnvsPath);
      const text = (buf3[0] === 0xff && buf3[1] === 0xfe) ? buf3.toString("utf16le", 2) : buf3.toString("utf8");
      const keyToText = new Map();
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\{([^}]+)\}\s*(.+?)\s*$/);
        if (m) keyToText.set(m[1], m[2]);
      }
      for (const trait of Object.keys(modTraitEpithets)) {
        for (const entry of modTraitEpithets[trait]) {
          if (keyToText.has(entry.key)) entry.text = keyToText.get(entry.key);
        }
        // Drop entries with no resolvable text (rare — typo'd keys).
        modTraitEpithets[trait] = modTraitEpithets[trait].filter(e => e.text);
        if (modTraitEpithets[trait].length === 0) delete modTraitEpithets[trait];
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
      const charMatch = line.match(/^character\s+([^,]+?),\s*([^,]+?),.*?\bx\s+(\d+),\s*y\s+(\d+)/);
      if (charMatch) {
        const nameField = charMatch[1].trim();
        const headerRest = charMatch[0]; // entire matched header
        const [first, ...rest] = nameField.split(/\s+/);
        const lastName = rest.join(" ") || null;
        if (lastName) modDescrStratSurnames.add(lastName);
        const x = parseInt(charMatch[3]);
        const y = parseInt(charMatch[4]);
        const ageMatch = /\bage\s+(\d+)/.exec(headerRest);
        const ageVal = ageMatch ? parseInt(ageMatch[1]) : null;
        const tags = [];
        if (/\bleader\b/i.test(headerRest)) tags.push("leader");
        if (/\bheir\b/i.test(headerRest)) tags.push("heir");
        if (/\bnamed character\b/i.test(headerRest)) tags.push("named");
        const charSubType = (charMatch[2] || "").trim().toLowerCase();
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
          traits: [],
          ancillaries: [],
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
  modDescrStratCharactersByRegion = { byCoord: fullCharRecords };
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
            curFaction = null;
          }
        }
      }
    } catch (e) { console.warn("[sm_factions]", src, e.message); }
  }

  // Build initial settlement ownership from descr_regions + descr_strat.
  // This is the turn-0 ground truth; conquests during play are not captured
  // by this map (see PROGRESS_LOG Round 21).
  try {
    const own = buildInitialOwnership(modDataDir);
    modInitialOwnerByCity = own.ownerByCity;
    if (own.error) console.warn("[mod-load] ownership:", own.error);
  } catch (e) {
    console.warn("[mod-load] ownership parse failed:", e.message);
    modInitialOwnerByCity = {};
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
function parseWorldObjectPositions(buf) {
  const map = new Map();
  for (let N = 24; N < buf.length - 8; N++) {
    if (buf.readUInt32LE(N - 12) !== 6) continue;
    if (buf.readUInt32LE(N - 4) !== N - 4) continue;
    const x = buf.readUInt32LE(N);
    // Bounds raised 2026-05-09: RIS imperial map is 1020x700, vanilla RTW
    // ~200x150. Old bounds rejected 99.6% of legit position records on
    // imperial-campaign saves, hiding most armies from the map.
    if (x < 0 || x > 1100) continue;
    const y = buf.readUInt32LE(N + 4);
    if (y < 0 || y > 800) continue;
    const uuid = buf.readUInt32LE(N - 8);
    if (uuid === 0) continue;
    map.set(uuid, { x, y });
  }
  return map;
}

// Read the current in-game year directly from the save header.
// Confirmed across the Alex-campaign archive: file offset 3972 is an int32
// signed year (negative for BC). Offset 3968 is the turn counter (turn-1)
// in the same header block. We prefer reading the year directly because
// it's stored by the engine and works for any campaign configuration.
function readCurrentYearFromSave(saveBuf) {
  if (saveBuf.length < 3976) return null;
  const year = saveBuf.readInt32LE(3972);
  // Sanity-check: within plausible BC range for RTW campaigns
  if (year < -2000 || year > 3000) return null;
  return year;
}

function readTurnFromSave(saveBuf) {
  if (saveBuf.length < 3972) return null;
  const turnCounter = saveBuf.readUInt32LE(3968);
  if (turnCounter > 10000) return null;
  return turnCounter + 1; // displayed turn number
}

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
    c.region = regionByCommanderUuid.get(c.secondaryUuid) || null;
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
  // Faction-block markers: every faction's character/unit run in the save
  // is preceded by a `captain_card_<faction>.tga` ASCII path. Each unit's
  // file offset tells us which faction's block it sits in, and therefore
  // which faction commands the army it's part of.
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

function createWindow() {
  // Drop Electron's default File/Edit/View/Window menu — the app's UI is
  // self-contained and doesn't need it. Done at app level (vs per-window) so
  // child windows (e.g. devtools detach) inherit. Useful shortcuts that
  // the menu provided (devtools, reload, fullscreen) still work via the
  // default accelerators in dev; release builds intentionally lose them.
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.setMenuBarVisibility(false);

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
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select mod folder or campaign folder",
    defaultPath: lastImportDir || undefined,
  });
  if (result.canceled || !result.filePaths.length) return null;
  const dir = result.filePaths[0];
  lastImportDir = dir;

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

// IPC: read a faction icon TGA file and return as ArrayBuffer
ipcMain.handle("read-faction-icon", async (_event, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch { return null; }
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
function findRtwInstallRoot() {
  const candidates = [
    "C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED",
    "C:/Program Files/Steam/steamapps/common/Total War ROME REMASTERED",
    "D:/Steam/steamapps/common/Total War ROME REMASTERED",
    "D:/SteamLibrary/steamapps/common/Total War ROME REMASTERED",
    "E:/SteamLibrary/steamapps/common/Total War ROME REMASTERED",
    "/Applications/Total War ROME REMASTERED.app/Contents/Resources/Data", // Mac
  ];
  // Parse Steam's libraryfolders.vdf for additional library roots.
  const vdfCandidates = [
    "C:/Program Files (x86)/Steam/steamapps/libraryfolders.vdf",
    "C:/Program Files/Steam/steamapps/libraryfolders.vdf",
  ];
  for (const vdfPath of vdfCandidates) {
    if (!fs.existsSync(vdfPath)) continue;
    try {
      const text = fs.readFileSync(vdfPath, "utf8");
      const re = /"path"\s+"([^"]+)"/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const lib = m[1].replace(/\\\\/g, "/").replace(/\\/g, "/");
        candidates.push(`${lib}/steamapps/common/Total War ROME REMASTERED`);
      }
    } catch {}
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return null;
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
    const entries = {};
    let curKey = null, curBuf = "";
    const flush = () => {
      if (curKey != null) {
        entries[curKey] = curBuf.replace(/\\n/g, "\n").trim();
      }
      curKey = null; curBuf = "";
    };
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*\{([^}]+)\}(.*)$/);
      if (m) {
        flush();
        curKey = m[1].trim();
        curBuf = m[2];
      } else if (curKey != null) {
        curBuf += "\n" + line;
      }
    }
    flush();
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
          const p = val.split(",").map(x => x.trim());
          block.priAttack = parseInt(p[0]);
          block.priCharge = parseInt(p[1]);
          block.priWeapon = p[5] || "";
        } else if (key === "stat_sec") {
          const p = val.split(",").map(x => x.trim());
          if (p[2] && p[2] !== "no") {
            block.secAttack = parseInt(p[0]);
            block.secCharge = parseInt(p[1]);
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

ipcMain.handle("resolve-building-icon", async (_event, modDataDir, culture, levelName, chainName) => {
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
    if (!fs.existsSync(dir)) return null;
    const full = path.join(dir, fn);
    if (!fs.existsSync(full)) return null;
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

// IPC: read file as text
ipcMain.handle("read-file", async (_event, filePath) => {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return null; }
});

// IPC: read file as binary (returns ArrayBuffer via Buffer)
ipcMain.handle("read-file-binary", async (_event, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch { return null; }
});

// On startup: clear stale campaign_data cache when the app version changes.
// This ensures new bundled data takes effect after an update, while preserving
// user-imported data within the same version.
(function clearStaleCampaignCache() {
  const userDir = path.join(app.getPath("userData"), "campaign_data");
  const stampFile = path.join(userDir, ".version_stamp");
  const appVersion = app.getVersion();
  try {
    if (fs.existsSync(stampFile)) {
      const cached = fs.readFileSync(stampFile, "utf8").trim();
      if (cached === appVersion) return; // same version, keep cache
    }
    // Version changed or no stamp — clear the cache
    if (fs.existsSync(userDir)) {
      for (const f of fs.readdirSync(userDir)) {
        try { fs.unlinkSync(path.join(userDir, f)); } catch {}
      }
    }
  } catch {}
})();

// IPC: get the app's user data path for persistent storage
ipcMain.handle("get-user-data-path", () => {
  return app.getPath("userData");
});

// IPC: save a campaign data file. Writes to userData (authoritative store).
// In dev, also mirrors to build/ so the React dev server can fetch it.
// In packaged apps, build/ lives inside the read-only asar — skip it.
ipcMain.handle("save-file", async (_event, name, content) => {
  try {
    const userDir = path.join(app.getPath("userData"), "campaign_data");
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, name), content, "utf8");
    fs.writeFileSync(path.join(userDir, ".version_stamp"), app.getVersion(), "utf8");
    if (!app.isPackaged) {
      try {
        const buildDir = path.join(__dirname, "build");
        fs.writeFileSync(path.join(buildDir, name), content, "utf8");
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
    const buf = Buffer.isBuffer(dataBuf) ? dataBuf : Buffer.from(dataBuf);
    fs.writeFileSync(path.join(userDir, name), buf);
    fs.writeFileSync(path.join(userDir, ".version_stamp"), app.getVersion(), "utf8");
    if (!app.isPackaged) {
      try {
        const buildDir = path.join(__dirname, "build");
        fs.writeFileSync(path.join(buildDir, name), buf);
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
    fs.copyFileSync(src, path.join(userDir, destName));
    fs.writeFileSync(path.join(userDir, ".version_stamp"), app.getVersion(), "utf8");
    if (!app.isPackaged) {
      try {
        const buildDir = path.join(__dirname, "build");
        fs.copyFileSync(src, path.join(buildDir, destName));
      } catch {}
    }
    return true;
  } catch { return false; }
});

// IPC: read a campaign data file — checks userData first, then build/ (bundled fallback)
ipcMain.handle("read-campaign-file", async (_event, name) => {
  const userPath = path.join(app.getPath("userData"), "campaign_data", name);
  if (fs.existsSync(userPath)) {
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
    const filePath = path.join(app.getPath("userData"), name);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
    return true;
  } catch { return false; }
});

// IPC: read a file from the userData directory
ipcMain.handle("read-user-file", async (_event, name) => {
  try {
    const filePath = path.join(app.getPath("userData"), name);
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

// Helper: read a UTF-16LE name at a given position in the buffer.
// Expects [uint8 nchars] [0x00] [nchars * 2 bytes of UTF-16LE] [0x00 0x00].
// Returns { name, end } or null.
function readUtf16Name(data, pos, len) {
  if (pos + 4 >= len) return null;
  const nchars = data[pos];
  if (nchars < 3 || nchars > 32 || data[pos + 1] !== 0x00) return null;
  const strStart = pos + 2;
  const strEnd = strStart + nchars * 2;
  if (strEnd + 2 > len || data[strEnd] !== 0x00 || data[strEnd + 1] !== 0x00) return null;
  let decoded = '';
  for (let j = strStart; j < strEnd; j += 2) {
    const lo = data[j], hi = data[j + 1];
    if (hi !== 0x00 || lo < 0x20 || lo > 0x7e) return null;
    decoded += String.fromCharCode(lo);
  }
  if (decoded[0] < 'A' || decoded[0] > 'Z') return null;
  return { name: decoded, end: strEnd + 2 };
}

async function parseSaveData(filePath, onProgress, providedBuf = null) {
  const _yieldHere = () => new Promise(resolve => setImmediate(resolve));
  const tick = (stage) => { if (onProgress) onProgress({ stage }); };
  // Reuse a buffer the caller already has in hand instead of re-reading
  // the file from disk. On a 30MB save that's ~100-300ms saved per
  // parse — both reparseLatestSave and saveWatchStart had already read
  // the file before calling this, so the duplicate read was pure waste.
  const data = providedBuf || fs.readFileSync(filePath);
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
  const queues = {};
  const knownChains = new Set(['hinterland_region', 'core_building', 'capital_treasury',
    'military_industrial_complex', 'irrigated_farming', 'market', 'port_buildings',
    'textiles_production', 'health', 'hinterland_roads', 'temple_complex_dorian',
    'temple_complex_italic', 'defenses', 'colony', 'highland_pastoralism',
    'olive_cultivation', 'pottery_production', 'smith', 'horse_trainer']);
  for (const s of settlements) {
    // Locate "default_set" ASCII marker within 200 bytes after the settlement name
    const dsIdx = data.indexOf(Buffer.from('default_set', 'ascii'), s.offset);
    if (dsIdx === -1 || dsIdx > s.offset + 200) continue;
    const dsDataStart = dsIdx + 11 + 1;
    // Find end by locating the next known chain record
    let dsEnd = -1;
    for (const cn of knownChains) {
      const n = Buffer.from('\0' + cn + '\0', 'ascii');
      const hit = data.indexOf(n, dsDataStart);
      if (hit !== -1 && hit < dsDataStart + 500) {
        const recordStart = hit + 1 - cn.length - 1 - 2;
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
  try {
    const fr = findFactionRecords(data);
    factionRecords = {
      count: fr.length,
      arraySpan: summarizeFactionArray(fr),
      records: fr,
    };
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
        records.push({ pos: i, treasury, turnStart, regionCount: regions });
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

  return { buildings: buildingsByCity, armies, queues, taxByCity, happinessByCity, populationByCity, incomeByCity, sizeByCity, factionRecords, luaCounters, treasuryByFaction };
}

function diffSaveData(prev, curr) {
  const events = [];

  // Diff buildings
  const prevB = prev.buildings || {};
  const currB = curr.buildings || {};
  const allCities = new Set([...Object.keys(prevB), ...Object.keys(currB)]);
  for (const city of allCities) {
    const b1 = prevB[city] || {};
    const b2 = currB[city] || {};
    // Only report if both are in common settlements (reduce noise)
    if (!prevB[city] || !currB[city]) continue;
    const allBn = new Set([...Object.keys(b1), ...Object.keys(b2)]);
    for (const bn of allBn) {
      const v1 = b1[bn];
      const v2 = b2[bn];
      if (v1 === undefined && v2 !== undefined) {
        events.push({ type: 'building_new', city, building: bn, level: v2.level, health: v2.health });
      } else if (v1 !== undefined && v2 === undefined) {
        events.push({ type: 'building_removed', city, building: bn, prevLevel: v1.level });
      } else if (v1 && v2) {
        if (v1.level !== v2.level && v1.level !== null && v2.level !== null) {
          events.push({ type: 'building_upgrade', city, building: bn, from: v1.level, to: v2.level });
        }
        if (v1.health !== v2.health && v1.health !== null && v2.health !== null) {
          events.push({ type: 'building_damaged', city, building: bn, from: v1.health, to: v2.health });
        }
      }
    }
  }

  // Diff armies — detect movement, new armies, army changes
  const prevA = prev.armies || {};
  const currA = curr.armies || {};
  const allRegions = new Set([...Object.keys(prevA), ...Object.keys(currA)]);
  for (const region of allRegions) {
    const u1 = prevA[region] || [];
    const u2 = currA[region] || [];
    const prevTotal = u1.reduce((s, u) => s + (u.soldiers || 0), 0);
    const currTotal = u2.reduce((s, u) => s + (u.soldiers || 0), 0);
    // New army appeared in region
    if (u1.length === 0 && u2.length > 0) {
      events.push({ type: 'army_arrived', region, units: u2.length, soldiers: currTotal });
    }
    // Army left region
    else if (u1.length > 0 && u2.length === 0) {
      events.push({ type: 'army_left', region, units: u1.length, soldiers: prevTotal });
    }
    // Army size changed significantly (new units added/removed)
    else if (u1.length > 0 && u2.length > 0 && Math.abs(u2.length - u1.length) > 0) {
      events.push({ type: 'army_changed', region, prevUnits: u1.length, units: u2.length,
                     prevSoldiers: prevTotal, soldiers: currTotal });
    }
  }

  // Diff construction queues — an entry that was present then disappeared means the building
  // completed between snapshots. Only reports chains the parser could actually read (ASCII case).
  const prevQ = prev.queues || {};
  const currQ = curr.queues || {};
  const allCities2 = new Set([...Object.keys(prevQ), ...Object.keys(currQ)]);
  for (const city of allCities2) {
    const before = new Set(prevQ[city] || []);
    const after = new Set(currQ[city] || []);
    for (const chain of before) {
      if (!after.has(chain)) {
        events.push({ type: 'building_completed', city, chain });
      }
    }
    for (const chain of after) {
      if (!before.has(chain)) {
        events.push({ type: 'building_queued', city, chain });
      }
    }
  }

  return events;
}

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

// "Turn N End" autosaves carry the state at end-of-player-turn — but RTW
// writes a "Turn N+1 Start" autosave moments later that supersedes it (it's
// the same state plus AI moves). User feedback 2026-05-10: don't auto-load
// both, just take the freshest. Skip End autosaves in auto-detection paths
// (keep them in the picker for manual selection though). Pattern matches:
//   save_Autosave Republic of Rome Turn 5 End.sav   ← skip
//   save_Autosave Republic of Rome Turn 5.sav       ← keep (no End suffix)
//   save_Autosave Republic of Rome Turn 5 Start.sav ← keep
//   save_rome10.sav                                 ← keep (manual)
function isEndAutosave(filename) {
  return /\bAutosave\b.*\bTurn\s+\d+\s+End\b/i.test(filename);
}

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

// Single-flight + tail-coalescing lock for reparses. fs.watch fires bursts
// during multi-MB save writes — even with a 1.5s debounce, a second event
// can arrive while a 5s parse is still running. The previous version
// (0.9.213) just dropped the second event; that left the renderer showing
// stale data after a turn-end save. Now we mark a pending-reparse flag
// and run one more pass when the current one finishes.
let _reparsing = false;
let _reparsePending = false;

async function reparseLatestSave() {
  if (!activeSaveDir) return;
  if (_reparsing) {
    _reparsePending = true;
    console.log("[save-watch] queued (reparse already in progress)");
    return;
  }
  _reparsing = true;
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
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { _reparsing = false; return; }
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
    const saveBuf = fs.readFileSync(full);
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
    emitSaveProgress("Done", 100);
    win.webContents.send("save-snapshot", { file: latestFile, data: newData });
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
        win.webContents.send("live-char-moves", { moves: [], deaths: [], reset: true });
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
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send("save-progress", { stage, pct });
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
      const saveBuf = fs.readFileSync(full);
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
      const saveBuf = lastSaveBuf || fs.readFileSync(full);
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
    return { ok: true, ...info };
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
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
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
  autoUpdater.quitAndInstall(true, true);
  return true;
});

app.whenReady().then(() => {
  applyContentSecurityPolicy();
  createWindow();
  // Run one check on startup (packaged builds only — dev builds would 404)
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(err =>
      console.warn("[updater] startup check failed:", err.message)
    );
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});