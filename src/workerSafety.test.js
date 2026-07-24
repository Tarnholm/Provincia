// @vitest-environment node
//
// STATIC worker-safety guard for src/saveCrackWorker.js.
//
// WHY THIS EXISTS
// ---------------
// v0.9.1417 moved the AI analysis into the crack worker but left a
// `require("electron")` (the old file picker) in the extracted module. The
// packaged app then answered every analysis with:
//     Cannot find module 'electron'
//     Require stack: app.asar/src/aiMovementRun.js  ← app.asar/src/saveCrackWorker.js
//
// A RUNTIME test cannot catch this in development: `electron` is present in
// node_modules here, so require() succeeds and merely returns the CLI path
// string. It only fails in the packaged app, where a worker thread has no
// Electron bindings. So the guard has to be STATIC — walk the worker's require
// graph and assert nothing in it reaches for Electron (or other main-process-
// only bindings).
//
// Scope: local `./` requires only, followed transitively. Bare-package requires
// (fs, path, worker_threads, node built-ins) are fine in a worker.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Bindings that exist ONLY on the Electron main thread. Requiring any of these
// anywhere in the worker's graph breaks the packaged app.
const FORBIDDEN = [
  { rx: /require\(\s*["']electron["']\s*\)/, what: 'require("electron")' },
  { rx: /\bBrowserWindow\b/, what: "BrowserWindow" },
  { rx: /\bipcMain\b/, what: "ipcMain" },
  { rx: /\bdialog\.show/, what: "dialog.show*" },
  { rx: /\bapp\.getPath\s*\(/, what: "app.getPath()" },
];

function collectGraph(entry) {
  const seen = new Set();
  const stack = [entry];
  const files = [];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !fs.existsSync(f)) continue;
    seen.add(f);
    const src = fs.readFileSync(f, "utf8");
    files.push({ file: f, src });
    // follow LOCAL requires only — bare packages are node built-ins/deps
    for (const m of src.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
      let target = path.resolve(path.dirname(f), m[1]);
      if (!/\.[cm]?js$/.test(target)) target += ".js";
      stack.push(target);
    }
  }
  return files;
}

describe("saveCrackWorker require graph is worker-safe", () => {
  const graph = collectGraph(path.join(__dirname, "saveCrackWorker.js"));

  it("reaches every module it needs (sanity: the graph isn't trivially empty)", () => {
    const names = graph.map((g) => path.basename(g.file));
    expect(names).toContain("saveCrackWorker.js");
    // the AI pipeline and the save cracker are the heavy things it runs
    expect(names).toContain("aiMovementRun.js");
    expect(names).toContain("saveCracker.js");
    expect(graph.length).toBeGreaterThan(3);
  });

  it("contains no Electron / main-process-only bindings anywhere in the graph", () => {
    const offences = [];
    for (const { file, src } of graph) {
      // strip line and block comments so documentation about the bug doesn't trip the guard
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const { rx, what } of FORBIDDEN) {
        if (rx.test(code)) offences.push(`${path.basename(file)} uses ${what}`);
      }
    }
    expect(offences, "worker graph must not touch Electron — it has no bindings in the packaged app").toEqual([]);
  });
});
