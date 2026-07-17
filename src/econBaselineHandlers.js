// src/econBaselineHandlers.js — IPC handlers for the economy regression
// baseline feature (2026-07-17). Pattern follows src/saveAnalysisHandlers.js:
// CJS main-process module, registerEconBaselineHandlers(ipcMain, { app }).
//
// Baselines are stored as JSON under <userData>/econ-baselines/<safe-name>.json
// (userData via app.getPath("userData") — per-user, survives app updates).
//
// Handlers:
//   "econ-baseline-capture" (modDataDir, name)
//       → builds a full snapshot (see src/econBaseline.js for the metric),
//         stamps the capture date, writes the file, returns a summary
//         { name, at, factions, errors, file } or { error }.
//   "econ-baseline-list" ()
//       → [{ name, at, factions }] sorted newest-first, or { error }.
//   "econ-baseline-diff" (modDataDir, name, thresholdPct)
//       → { rows, added, removed, baselineAt, baselineModDataDir,
//           factionsCompared } or { error }.

const fs = require("fs");
const path = require("path");
const { buildEconSnapshot, diffEconSnapshots } = require("./econBaseline.js");

// File-system-safe baseline name: keep [a-zA-Z0-9._-], collapse the rest to _,
// trim to 64 chars, never empty. Also guards against path traversal since the
// result contains no separators.
function safeBaselineName(name) {
  const s = String(name == null ? "" : name).trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")            // no dot-files / hidden names
    .slice(0, 64);
  return s || "baseline";
}

function registerEconBaselineHandlers(ipcMain, { app }) {
  const baselineDir = () => path.join(app.getPath("userData"), "econ-baselines");

  ipcMain.handle("econ-baseline-capture", async (_event, modDataDir, name) => {
    try {
      if (!modDataDir) return { error: "modDataDir required" };
      const snap = buildEconSnapshot(modDataDir);
      if (snap.error) return { error: snap.error };
      snap.at = new Date().toISOString();
      const safe = safeBaselineName(name);
      const dir = baselineDir();
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, safe + ".json");
      fs.writeFileSync(file, JSON.stringify(snap, null, 2));
      return {
        name: safe,
        at: snap.at,
        factions: Object.keys(snap.factions).length,
        errors: snap.errors ? Object.keys(snap.errors).length : 0,
        file,
      };
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  });

  ipcMain.handle("econ-baseline-list", async () => {
    try {
      const dir = baselineDir();
      if (!fs.existsSync(dir)) return [];
      const out = [];
      for (const f of fs.readdirSync(dir)) {
        if (!/\.json$/i.test(f)) continue;
        try {
          const snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
          out.push({
            name: f.replace(/\.json$/i, ""),
            at: snap.at || null,
            factions: snap.factions ? Object.keys(snap.factions).length : 0,
          });
        } catch { /* unparseable file — skip, don't fail the whole list */ }
      }
      out.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
      return out;
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  });

  ipcMain.handle("econ-baseline-diff", async (_event, modDataDir, name, thresholdPct) => {
    try {
      if (!modDataDir) return { error: "modDataDir required" };
      const file = path.join(baselineDir(), safeBaselineName(name) + ".json");
      if (!fs.existsSync(file)) return { error: "baseline not found: " + safeBaselineName(name) };
      const baseline = JSON.parse(fs.readFileSync(file, "utf8"));
      const current = buildEconSnapshot(modDataDir);
      if (current.error) return { error: current.error };
      const d = diffEconSnapshots(current, baseline, thresholdPct);
      return {
        rows: d.rows,
        added: d.added,
        removed: d.removed,
        baselineAt: baseline.at || null,
        baselineModDataDir: baseline.modDataDir || null,
        factionsCompared: Object.keys(current.factions).length,
      };
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  });
}

module.exports = { registerEconBaselineHandlers, safeBaselineName };
