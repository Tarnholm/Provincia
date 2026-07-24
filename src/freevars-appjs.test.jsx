// @vitest-environment node
//
// UNDEFINED-REFERENCE GUARD for src/App.js.
//
// WHY THIS EXISTS
// ---------------
// v0.9.1398 shipped a crash: the History map-mode legend referenced
// `onScanTimeline` — a leftover *prop name* from when it was a tool panel, but
// in the App component the function is `runTimelineScan`. It was an undefined
// variable that threw a ReferenceError the moment the History legend rendered.
// `vite build` compiled fine (undefined refs are runtime errors), and the
// <App/> render smoke-test only exercises the DEFAULT color mode, so neither
// caught it. The same audit then found the same class in more places:
// `setBattleLedgerSnap` (state deleted in a refactor but still called on every
// live battle event), `diploPairs` and 4 CompareModal props (never defined).
//
// This test runs scripts/check-freevars.cjs over App.js — it AST-parses the
// file and reports every identifier that is REFERENCED but never BOUND
// (declared as a const/let/var/function/param/import) anywhere in the file.
// A name used but never defined = a latent ReferenceError on whatever code
// path reaches it (a legend branch, an event handler, a modal mount).
//
// SOUNDNESS: the checker has no FALSE NEGATIVES for this purpose — a truly
// undefined name can never be in the `bound` set, so it always surfaces here.
// It does have a few benign FALSE POSITIVES (browser globals it doesn't know,
// and a handful of function-local consts the flat-scope walker misses in this
// very large file). Those live in ALLOWED below. The test fails only when a
// NEW free identifier appears outside that set — i.e. a regression like the
// four above. When you add a genuine new global/blind-spot, add it to ALLOWED
// with a note; when the test flags a real name you introduced, it's a bug —
// fix the reference, don't allowlist it.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Known-safe free identifiers. Two kinds only:
//  1) Browser/runtime globals the checker's GLOBALS list doesn't enumerate.
//  2) esbuild/flat-scope blind spots — names that ARE defined in App.js
//     (verified by grep) but the whole-file walker doesn't record as bound.
//     Keep this list SMALL and each entry justified.
const ALLOWED = new Set([
  // browser / runtime globals
  "Audio", "Blob", "Event", "FileReader", "Float32Array", "ImageData",
  "MutationObserver", "Path2D", "ResizeObserver", "Uint8ClampedArray", "Worker",
  "cancelAnimationFrame", "decodeURIComponent", "location", "performance",
  "sessionStorage", "import",
  // function-local consts in renderLegend that the flat walker misses (all
  // defined at src/App.js renderLegend top; verified present, app uses them):
  "collapseArrow", "collapseToggle", "onCollapseClick", "panelStyle",
]);

describe("App.js undefined-reference guard", () => {
  it("has no REFERENCED-but-never-DEFINED identifiers beyond the known-safe set", () => {
    let out = "";
    try {
      out = execFileSync(
        process.execPath,
        [path.join(ROOT, "scripts", "check-freevars.cjs"), path.join(ROOT, "src", "App.js")],
        { cwd: ROOT, encoding: "utf8" }
      );
    } catch (e) {
      // check-freevars exits 1 when it finds free identifiers; its stdout still
      // holds the list, which is exactly what we want to inspect.
      out = (e.stdout || "").toString();
      if (!out) throw e; // a real spawn/parse failure, not just "found frees"
    }
    // Parse the second line: "  name1, name2, ..." (or "  (none)").
    const lines = out.trim().split(/\r?\n/);
    const listLine = (lines[1] || "").trim();
    const free = listLine === "(none)" || listLine === ""
      ? []
      : listLine.split(",").map((s) => s.trim()).filter(Boolean);

    const unexpected = free.filter((n) => !ALLOWED.has(n));
    if (unexpected.length) {
      throw new Error(
        "App.js references identifier(s) that are never defined anywhere — likely a ReferenceError " +
        "waiting on some code path (a legend branch, event handler, or modal mount):\n  " +
        unexpected.join(", ") +
        "\nIf one is a genuine new global or a verified checker blind spot, add it to ALLOWED in " +
        "src/freevars-appjs.test.jsx with a note. Otherwise fix the reference."
      );
    }
    expect(unexpected).toEqual([]);
  }, 30000); // esbuild-transform + acorn-parse of the multi-MB file
});
