// Save-file picker + save-directory listing IPC handlers (select-save-files,
// select-save-file, list-saves, get-latest-save-mtime) and the findLatestSave
// helper, extracted verbatim from main.js (2026-07-17). findLatestSave is
// exported and required back by main.js (reparseLatestSave + save-watch-start
// still call it). dialog is injected via deps. Logic unchanged.
"use strict";
const fs = require("fs");
const path = require("path");
const { isEndAutosave } = require("./saveDiff.js");

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

function registerSaveListHandlers(ipcMain, { dialog }) {

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
}

module.exports = { registerSaveListHandlers, findLatestSave };
