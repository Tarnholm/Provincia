// scripts/clean-dist-installers.js
//
// Removes stale installer artifacts from dist/ so each build doesn't pile up
// gigabytes of old "Provincia Setup X.Y.Z.exe" files (electron-builder never
// prunes its own output dir).
//
// Used two ways:
//   1. As electron-builder's `beforeBuild` hook (configured in package.json
//      build.beforeBuild) — runs automatically on EVERY build, before the new
//      installer is produced, so deleting all old .exe/.exe.blockmap is safe
//      (only the freshly-built one remains afterward).
//   2. Standalone: `node scripts/clean-dist-installers.js`.
//
// It deletes only installer binaries (*.exe, *.exe.blockmap) — it leaves
// latest.yml (needed for auto-update), builder-debug.yml, and the
// win-unpacked/ working dir alone.

"use strict";
const fs = require("fs");
const path = require("path");

function cleanDistInstallers() {
  const distDir = path.join(__dirname, "..", "dist");
  let removed = 0, bytes = 0;
  try {
    if (!fs.existsSync(distDir)) return { removed, bytes };
    for (const name of fs.readdirSync(distDir)) {
      if (/\.exe$/i.test(name) || /\.exe\.blockmap$/i.test(name)) {
        const full = path.join(distDir, name);
        try {
          const st = fs.statSync(full);
          if (st.isFile()) { bytes += st.size; fs.unlinkSync(full); removed++; }
        } catch { /* ignore individual file errors */ }
      }
    }
  } catch (e) {
    // Never throw from a build hook — a cleanup failure must not break the build.
    console.warn("[clean-dist] skipped:", e && e.message);
  }
  if (removed) {
    console.log(`[clean-dist] removed ${removed} old installer file(s), freed ${(bytes / 1e9).toFixed(2)} GB`);
  }
  return { removed, bytes };
}

// electron-builder beforeBuild hook: must resolve truthy (return true) so the
// normal native-dependency install proceeds. Never reject.
module.exports = async function beforeBuild() {
  cleanDistInstallers();
  return true;
};
module.exports.cleanDistInstallers = cleanDistInstallers;

// Standalone CLI
if (require.main === module) cleanDistInstallers();
