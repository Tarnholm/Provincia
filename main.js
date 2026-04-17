// main.js
const { app, BrowserWindow, session, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");

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
    "img-src 'self' data:",
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
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
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
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select mod folder or campaign folder",
  });
  if (result.canceled || !result.filePaths.length) return null;
  const dir = result.filePaths[0];

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

// ── Live log watcher for Rome Remastered ──────────────────────────────────
// Watches message_log.txt and campaign_ai_log.txt, tails new lines, sends to renderer.
let logWatcher = null;
let logWatcherAI = null;
let logOffset = 0;
let logOffsetAI = 0;
let logPollInterval = null;

ipcMain.handle("log-watch-start", async (_event, logDir) => {
  // Stop any existing watcher
  if (logPollInterval) { clearInterval(logPollInterval); logPollInterval = null; }

  const msgPath = path.join(logDir, "message_log.txt");
  const aiPath = path.join(logDir, "campaign_ai_log.txt");

  if (!fs.existsSync(msgPath)) return { error: "message_log.txt not found in " + logDir };

  // Start from current end of file (only watch new lines)
  try { logOffset = fs.statSync(msgPath).size; } catch { logOffset = 0; }
  try { logOffsetAI = fs.statSync(aiPath).size; } catch { logOffsetAI = 0; }

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
        if (text.trim()) win.webContents.send("log-lines", { source: "message", text });
      } else if (stat.size < logOffset) {
        // File was truncated (new campaign started) — reset and notify
        logOffset = 0;
        win.webContents.send("log-lines", { source: "reset", text: "" });
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

function parseSaveData(filePath) {
  const data = fs.readFileSync(filePath);
  const len = data.length;

  // ── 1. Parse building records ──
  // Format: [uint16LE nameLen] [ascii name] [\0] [4-byte hash] [uint32LE level]
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
  const settlements = [];
  for (let i = 0; i < len - 10; i++) {
    if (data[i] === 0x01) {
      const r = readUtf16Name(data, i + 1, len);
      if (r) settlements.push({ offset: i, name: r.name });
    }
  }

  // ── 3. Associate buildings with nearest preceding settlement (within 3000 bytes) ──
  const buildingsByCity = {};
  for (const b of buildingRecords) {
    let bestName = null, bestDist = Infinity;
    for (const s of settlements) {
      const dist = b.offset - s.offset;
      if (dist > 0 && dist < 3000 && dist < bestDist) {
        bestDist = dist;
        bestName = s.name;
      }
    }
    if (bestName) {
      if (!buildingsByCity[bestName]) buildingsByCity[bestName] = {};
      buildingsByCity[bestName][b.name] = { level: b.level, health: b.health };
    }
  }

  // ── 4. Parse unit/army records ──
  // Format: [\x01\x00] [uint16LE nameLen] [ascii unit name with spaces] [\0]
  //         [bytes...] [uint8 regionLen] [\x00] [UTF-16LE region] [\xff\xff\xff\xff]
  //         [4 bytes] [4 bytes float] [uint32 soldiers] [uint32 maxSoldiers]
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
                      const ra = strEnd;
                      if (ra + 20 <= len && data[ra] === 0xff && data[ra + 1] === 0xff &&
                          data[ra + 2] === 0xff && data[ra + 3] === 0xff) {
                        const s = data.readUInt32LE(ra + 12);
                        const m = data.readUInt32LE(ra + 16);
                        if (s <= 2000 && m <= 2000) {
                          soldiers = s;
                          maxSoldiers = m;
                        }
                      }
                      break;
                    }
                  }
                }
              }
              if (region) {
                unitRecords.push({ unit: unitName, region, soldiers, max: maxSoldiers });
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
  const armies = {};
  for (const u of unitRecords) {
    if (!armies[u.region]) armies[u.region] = [];
    armies[u.region].push({ unit: u.unit, soldiers: u.soldiers, max: u.max });
  }

  return { buildings: buildingsByCity, armies };
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

  return events;
}

let lastSaveData = null;
let lastSaveFile = null;
let activeSaveDir = null;

function findLatestAutosave(saveDir) {
  try {
    const files = fs.readdirSync(saveDir)
      .filter(f => f.startsWith("save_Autosave") && f.endsWith(".sav"));
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

ipcMain.handle("save-watch-start", async (_event, saveDir) => {
  console.log("[save-watch] start:", saveDir, "exists:", fs.existsSync(saveDir));
  if (!fs.existsSync(saveDir)) return { error: "Save directory not found: " + saveDir };
  activeSaveDir = saveDir;

  // Parse latest autosave as baseline and send initial snapshot
  const latestFile = findLatestAutosave(saveDir);
  console.log("[save-watch] latest autosave:", latestFile);
  if (latestFile) {
    try {
      lastSaveData = parseSaveData(path.join(saveDir, latestFile));
      lastSaveFile = latestFile;
      const bCount = Object.keys(lastSaveData.buildings || {}).length;
      const aCount = Object.keys(lastSaveData.armies || {}).length;
      console.log("[save-watch] parsed:", bCount, "settlements with buildings,", aCount, "regions with armies");
      // Send initial snapshot after a short delay so the renderer's listener is ready
    } catch (e) {
      console.error("[save-watch] parse error:", e.message);
      lastSaveData = null;
      lastSaveFile = null;
    }
  }

  // Return initial data directly so the renderer doesn't depend on IPC event timing
  return { ok: true, saveDir, baseline: lastSaveFile, initialData: lastSaveData };
});

// Called by the renderer when a turn end is detected from logs.
// Waits briefly for the autosave to be written, then parses and diffs.
ipcMain.handle("save-check-now", async () => {
  if (!activeSaveDir) return { ok: false, reason: "no save dir" };
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return { ok: false };

  // Small delay — the autosave may still be writing when the log line appears
  await new Promise(r => setTimeout(r, 2000));

  const latestFile = findLatestAutosave(activeSaveDir);
  if (!latestFile || latestFile === lastSaveFile) return { ok: true, unchanged: true };

  try {
    const newData = parseSaveData(path.join(activeSaveDir, latestFile));
    if (lastSaveData) {
      const events = diffSaveData(lastSaveData, newData);
      if (events.length > 0) {
        win.webContents.send("save-events", { file: latestFile, events });
      }
    }
    win.webContents.send("save-snapshot", { file: latestFile, data: newData });
    lastSaveData = newData;
    lastSaveFile = latestFile;
    return { ok: true, file: latestFile };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("save-watch-stop", async () => {
  activeSaveDir = null;
  lastSaveData = null;
  lastSaveFile = null;
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

function sendUpdateEvent(channel, payload) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

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
  autoUpdater.quitAndInstall();
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