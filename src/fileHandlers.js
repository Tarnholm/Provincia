// Generic file I/O IPC handlers extracted from main.js.
//
//   registerFileHandlers(ipcMain, { app, dialog, isConsentedPath, appRoot })
//
// These are the app's low-level read/write channels: reading arbitrary
// (consent-gated) paths, and writing to the userData "campaign_data" store
// and other userData files. Renderer-supplied NAMES are always contained to
// their base dir via containedPath (path-traversal defence) — only the two
// read-file channels accept a full user-picked path, and those are gated by
// isConsentedPath. appRoot is main.js's __dirname (NOT this module's), used to
// mirror writes into build/ during dev; using this module's __dirname here
// would point at src/ and write to the wrong place.
const fs = require("fs");
const path = require("path");
const { gameTextCRLF } = require("./mainUtils.js");
const pathSafety = require("./pathSafety.js");

function registerFileHandlers(ipcMain, deps) {
  const { app, dialog, isConsentedPath, appRoot } = deps;

  // Resolve `name` inside `baseDir`, rejecting path-traversal escapes
  // (e.g. "..\\..\\x" or an absolute path). Returns the absolute path, or
  // null when the joined path lands outside baseDir. Every handler that takes
  // a renderer-supplied file NAME (not a user-picked path) routes through this.
  const resolveInside = (baseDir, name) => pathSafety.containedPath(baseDir, name);
  const campaignDir = () => path.join(app.getPath("userData"), "campaign_data");

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

  // IPC: persist the dev autosave history to a file (not localStorage — 30 full
  // state snapshots blow past the ~5MB localStorage cap). Stored in userData so
  // it survives app restarts and isn't touched by Save/Export.
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

  ipcMain.handle("save-file-as", async (_event, defaultName, content, filterDesc, filterExts) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: filterDesc || "All Files", extensions: filterExts || ["*"] }],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, gameTextCRLF(result.filePath, content), "utf8");
    return result.filePath;
  });

  ipcMain.handle("save-file", async (_event, name, content) => {
    try {
      const userDir = campaignDir();
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
      const dest = resolveInside(userDir, name);
      if (!dest) return false;
      fs.writeFileSync(dest, gameTextCRLF(name, content), "utf8");
      fs.writeFileSync(path.join(userDir, ".version_stamp"), app.getVersion(), "utf8");
      if (!app.isPackaged) {
        try {
          const buildDir = path.join(appRoot, "build");
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
      const userDir = campaignDir();
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
      const dest = resolveInside(userDir, name);
      if (!dest) return false;
      const buf = Buffer.isBuffer(dataBuf) ? dataBuf : Buffer.from(dataBuf);
      fs.writeFileSync(dest, buf);
      fs.writeFileSync(path.join(userDir, ".version_stamp"), app.getVersion(), "utf8");
      if (!app.isPackaged) {
        try {
          const buildDir = path.join(appRoot, "build");
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
      const userDir = campaignDir();
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
      // src may be anywhere (it comes from user-picked mod folders); only the
      // destination NAME is renderer-controlled and must stay inside userDir.
      const dest = resolveInside(userDir, destName);
      if (!dest) return false;
      fs.copyFileSync(src, dest);
      fs.writeFileSync(path.join(userDir, ".version_stamp"), app.getVersion(), "utf8");
      if (!app.isPackaged) {
        try {
          const buildDir = path.join(appRoot, "build");
          const buildDest = resolveInside(buildDir, destName);
          if (buildDest) fs.copyFileSync(src, buildDest);
        } catch {}
      }
      return true;
    } catch { return false; }
  });

  // IPC: read a campaign data file — checks userData first, then build/ (bundled fallback)
  ipcMain.handle("read-campaign-file", async (_event, name) => {
    const userPath = resolveInside(campaignDir(), name);
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
}

module.exports = { registerFileHandlers };
