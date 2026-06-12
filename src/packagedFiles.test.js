// Packaged-files guard (2026-06-12, v0.9.1096 regression).
//
// electron-builder's build.files in package.json enumerates main-process src
// modules ONE BY ONE. v0.9.1095 shipped with src/calibSaveOpts.js required from
// the get-turn1-budget handler but ABSENT from that list → "Cannot find module"
// in the packaged app on every calibration-save budget request, and the renderer
// dropped the error reply silently → the budget panel sat on "computing…"
// forever. Tests all passed (they run from the repo, where the file exists).
//
// This test closes the gap structurally: every `require("./src/X.js")` reachable
// from the packaged main-process entry files — transitively through same-dir
// requires inside src/ — must appear in build.files. A new src module that is
// required but not packaged fails CI instead of failing in production.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const packagedSrc = new Set(
  (pkg.build.files || []).filter(f => typeof f === "string" && f.startsWith("src/")).map(f => f.replace(/\\/g, "/"))
);

// Entry files packaged at the app root (must themselves be in build.files).
const ENTRIES = ["main.js", "preload.js", "main-scripts.js", "preload-scripts.js"];

function srcRequiresOf(file) {
  // String-literal requires only — dynamic requires can't be statically checked.
  const text = fs.readFileSync(file, "utf8");
  const out = new Set();
  // From root-level files: require("./src/X.js")
  for (const m of text.matchAll(/require\(\s*["']\.\/src\/([\w.-]+\.js)["']\s*\)/g)) out.add("src/" + m[1]);
  // From inside src/: require("./X.js") (src modules require siblings relatively)
  if (path.dirname(file) === path.join(ROOT, "src")) {
    for (const m of text.matchAll(/require\(\s*["']\.\/([\w.-]+\.js)["']\s*\)/g)) out.add("src/" + m[1]);
  }
  return out;
}

describe("electron-builder build.files covers every main-process src require", () => {
  it("lists all transitively required src modules (v0.9.1095: calibSaveOpts.js was missing)", () => {
    const needed = new Set();
    const queue = [];
    for (const e of ENTRIES) {
      const p = path.join(ROOT, e);
      if (fs.existsSync(p)) for (const r of srcRequiresOf(p)) { if (!needed.has(r)) { needed.add(r); queue.push(r); } }
    }
    while (queue.length) {
      const rel = queue.pop();
      const p = path.join(ROOT, rel);
      if (!fs.existsSync(p)) continue; // missing-on-disk is caught below
      for (const r of srcRequiresOf(p)) if (!needed.has(r)) { needed.add(r); queue.push(r); }
    }
    expect(needed.size).toBeGreaterThan(10); // sanity: the scan actually found the require graph
    const missingFromFiles = [...needed].filter(r => !packagedSrc.has(r) && !r.endsWith(".test.js")).sort();
    expect(missingFromFiles, `required by the main process but NOT in package.json build.files — the packaged app will throw "Cannot find module" (this is exactly how v0.9.1095 broke with src/calibSaveOpts.js)`).toEqual([]);
    const missingOnDisk = [...needed].filter(r => !fs.existsSync(path.join(ROOT, r))).sort();
    expect(missingOnDisk, "required but the file does not exist in the repo").toEqual([]);
  });

  it("every src entry in build.files exists on disk", () => {
    const gone = [...packagedSrc].filter(r => !fs.existsSync(path.join(ROOT, r))).sort();
    expect(gone, "build.files lists src files that no longer exist (electron-builder would fail or silently skip)").toEqual([]);
  });
});
