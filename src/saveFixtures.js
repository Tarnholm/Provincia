// Test-only helper: locate the real-save fixtures and what they are expected to
// contain.  Not shipped (nothing in the main process requires it) — same shape
// as src/modSandbox.js and src/mainIpcHarness.js.
//
// The .sav files are gitignored (35-45 MB each, public repo), so they exist only
// where somebody has run `node scripts/build-save-fixtures.js`. Everywhere else
// the tests must SKIP — visibly, never by quietly passing.
//
// The saves predate the current mod. `expect` therefore holds what each parser
// produced when the fixture was accepted, recorded in the manifest beside it;
// a test compares against that, never against today's C:/RIS.
"use strict";
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "scripts", "save-fixtures", "feral");
const MANIFEST = path.join(DIR, "manifest.json");

let manifest = null;
function load() {
  if (manifest) return manifest;
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); }
  catch { manifest = { fixtures: {} }; }
  return manifest;
}

// → { path, expect } when the fixture is on disk, else null (caller skips).
function fixture(name) {
  const p = path.join(DIR, name);
  if (!fs.existsSync(p)) return null;
  const entry = load().fixtures[name];
  if (!entry) throw new Error(`${name} is present but missing from manifest.json — re-run: node scripts/build-save-fixtures.js`);
  return { path: p, expect: entry.expect, sha256: entry.sha256, source: entry.source };
}

// Several at once; null unless ALL are present.
function fixtures(...names) {
  const out = names.map(fixture);
  return out.every(Boolean) ? out : null;
}

const read = (f) => fs.readFileSync(f.path);

module.exports = { fixture, fixtures, read, DIR, MANIFEST };
