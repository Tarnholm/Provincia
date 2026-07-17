// Persistent PNG icon cache (2026-07-16, "make it all instant — cache it").
//
// Every launch used to re-read + re-decode thousands of TGA/DDS art files
// (unit cards, building icons, portraits) during the warm-up. The renderer
// decodes each unique file to PNG exactly once and ships the bytes back here;
// we persist them under <userData>/icon-png-cache/ keyed by source path +
// mtime. On later launches the bulk resolvers return the cached PNG instead
// of the raw TGA — no decode, smaller IPC payloads, near-instant warm.
//
// Invalidation: an entry is served only while the source file's mtimeMs
// matches what was recorded at store time (mtimes are stat'd once per path
// per session). A changed/removed source file simply misses and re-caches.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app } = require("electron");

let _manifest = null;          // Map srcPathLower → { f: cacheFileName, m: mtimeMs }
let _saveTimer = null;
const _statMemo = new Map();   // srcPathLower → mtimeMs | null (per session)

function cacheDir() {
  return path.join(app.getPath("userData"), "icon-png-cache");
}
function manifestPath() {
  return path.join(cacheDir(), "manifest.json");
}
function loadManifest() {
  if (_manifest) return _manifest;
  _manifest = new Map();
  try {
    const j = JSON.parse(fs.readFileSync(manifestPath(), "utf8"));
    for (const [k, v] of Object.entries(j)) {
      if (v && typeof v.f === "string" && typeof v.m === "number") _manifest.set(k, v);
    }
    console.log(`[icon-png-cache] manifest loaded: ${_manifest.size} entries`);
  } catch { /* first run */ }
  return _manifest;
}
function scheduleSave() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      fs.mkdirSync(cacheDir(), { recursive: true });
      const obj = {};
      for (const [k, v] of _manifest) obj[k] = v;
      fs.writeFileSync(manifestPath(), JSON.stringify(obj));
    } catch (e) { console.warn("[icon-png-cache] manifest save failed:", e && e.message); }
  }, 2000);
}
function srcMtime(srcPath) {
  const key = String(srcPath).toLowerCase();
  if (_statMemo.has(key)) return _statMemo.get(key);
  let mt = null;
  try { mt = fs.statSync(srcPath).mtimeMs; } catch {}
  _statMemo.set(key, mt);
  return mt;
}

// Returns a Node Buffer of cached PNG bytes, or null on miss/stale.
function pngCacheGet(srcPath) {
  if (!srcPath) return null;
  const key = String(srcPath).toLowerCase();
  const entry = loadManifest().get(key);
  if (!entry) return null;
  const mt = srcMtime(srcPath);
  if (mt == null || Math.round(mt) !== Math.round(entry.m)) return null;
  try {
    return fs.readFileSync(path.join(cacheDir(), entry.f));
  } catch { return null; }
}

function pngCachePut(srcPath, pngBuf) {
  if (!srcPath || !pngBuf || !pngBuf.byteLength) return false;
  const mt = srcMtime(srcPath);
  if (mt == null) return false;
  const key = String(srcPath).toLowerCase();
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    const fn = crypto.createHash("sha1").update(key).digest("hex") + ".png";
    fs.writeFileSync(path.join(cacheDir(), fn), Buffer.isBuffer(pngBuf) ? pngBuf : Buffer.from(pngBuf));
    loadManifest().set(key, { f: fn, m: mt });
    scheduleSave();
    return true;
  } catch (e) {
    console.warn("[icon-png-cache] put failed:", srcPath, e && e.message);
    return false;
  }
}

// Drop every entry whose source path lies under dirPrefix — called when a mod
// slot is re-imported from a different folder, so the replaced mod's PNGs
// don't sit on disk forever. Over-pruning is harmless (entries re-cache on
// miss), so shared fallback dirs need no special casing.
function pngCachePruneUnder(dirPrefix) {
  if (!dirPrefix) return 0;
  let prefix = String(dirPrefix).toLowerCase().replace(/\//g, "\\").replace(/\\+$/, "") + "\\";
  const m = loadManifest();
  let removed = 0;
  for (const [key, v] of m) {
    if (key.replace(/\//g, "\\").startsWith(prefix)) {
      m.delete(key);
      removed += 1;
      try { fs.unlinkSync(path.join(cacheDir(), v.f)); } catch {}
    }
  }
  if (removed) {
    scheduleSave();
    console.log(`[icon-png-cache] pruned ${removed} entries under ${dirPrefix}`);
  }
  return removed;
}

// items: [{ path, png: ArrayBuffer }]
function registerPngCacheIpc(ipcMain) {
  ipcMain.handle("icon-cache-put-bulk", async (_event, items) => {
    if (!Array.isArray(items)) return 0;
    let stored = 0;
    for (const it of items) {
      if (it && it.path && it.png && pngCachePut(it.path, Buffer.from(it.png))) stored += 1;
    }
    return stored;
  });
  ipcMain.handle("icon-cache-prune-under", async (_event, dirPrefix) => pngCachePruneUnder(dirPrefix));
}

module.exports = { pngCacheGet, pngCachePut, pngCachePruneUnder, registerPngCacheIpc };
