// Folder-import & icon-directory discovery IPC handlers extracted from main.js.
//
//   registerFolderImportHandlers(ipcMain, {
//     dialog, consentStore, scanFolderForCampaigns, addConsentedRoot, getVanillaDataDir,
//   })
//
// These handlers locate things on disk: mod/campaign folders the user picks
// (scan-folder, select-folder), a mod's faction-icons directory
// (find-faction-icons-dir), a single faction-icon TGA (read-faction-icon), and
// the detected vanilla install's faction-icons dir (get-vanilla-icons-dir).
// select-folder remembers the last picked directory internally (lastImportDir)
// — nothing outside these handlers reads it — and registers the picked root as
// consented so read-file may later read inside it.
const fs = require("fs");
const path = require("path");

function registerFolderImportHandlers(ipcMain, deps) {
  const { dialog, consentStore, scanFolderForCampaigns, addConsentedRoot, getVanillaDataDir } = deps;

  let lastImportDir = null;

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
}

module.exports = { registerFolderImportHandlers };
