/**
 * Helper for submitting Provincia's installer to Microsoft's false-positive
 * reporting form. MS does not expose an API — this script locates the latest
 * installer in dist/, computes SHA256, opens the submission form in a browser,
 * and prints the exact values to paste.
 *
 * Usage: npm run submit-fp
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const DIST_DIR = path.resolve(__dirname, "..", "dist");
const FORM_URL = "https://www.microsoft.com/en-us/wdsi/filesubmission";

function findLatestInstaller() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`[submit-fp] dist/ not found — run "npm run dist" first`);
    process.exit(1);
  }
  const candidates = fs.readdirSync(DIST_DIR)
    .filter(f => /\.(exe|msi|appx)$/i.test(f) && !f.includes(".blockmap"))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(DIST_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!candidates.length) {
    console.error(`[submit-fp] no installer found in ${DIST_DIR}`);
    process.exit(1);
  }
  return path.join(DIST_DIR, candidates[0].name);
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function openUrl(url) {
  const cmd = process.platform === "win32" ? `start "" "${url}"`
            : process.platform === "darwin" ? `open "${url}"`
            : `xdg-open "${url}"`;
  try { execSync(cmd, { stdio: "ignore", shell: true }); }
  catch { /* user can copy-paste instead */ }
}

const pkg = require("../package.json");
const installer = findLatestInstaller();
const size = fs.statSync(installer).size;
const hash = sha256(installer);

console.log("─".repeat(70));
console.log("Microsoft false-positive submission — Provincia");
console.log("─".repeat(70));
console.log(`Installer : ${installer}`);
console.log(`Size      : ${(size / 1024 / 1024).toFixed(2)} MB`);
console.log(`SHA-256   : ${hash}`);
console.log(`Version   : ${pkg.version}`);
console.log("");
console.log("Opening Microsoft's submission form in your browser…");
console.log(`(${FORM_URL})`);
console.log("");
console.log("On the form, select:");
console.log("  • Product     : Microsoft Defender Antivirus");
console.log("  • Detection   : Incorrect detection (should not be flagged)");
console.log("  • File        : upload the installer above");
console.log("  • Definition  : let the form auto-fill from the upload");
console.log("");
console.log("Suggested 'Additional information' blurb:");
console.log("─".repeat(70));
console.log(`Provincia v${pkg.version} is an Electron desktop app for viewing`);
console.log(`Rome: Total War mod data (strategy map visualiser). It is an`);
console.log(`unsigned indie build; please whitelist the SHA-256 above.`);
console.log(`No network activity beyond local-file reads and optional`);
console.log(`Rome Remastered save/log parsing.`);
console.log("─".repeat(70));
console.log("");
console.log("After submission, Microsoft usually clears benign builds within");
console.log("24-48h. Resubmit on every new version (hash changes → new review).");

openUrl(FORM_URL);
