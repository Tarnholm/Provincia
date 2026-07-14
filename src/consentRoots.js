// Dialog-consented read-root store (2026-07-15), extracted from main.js so the
// policy is unit-testable without electron. See main.js for the threat model:
// the generic read-file/read-file-binary IPC may only read inside folders the
// user picked via the select-folder dialog — this session or a previous one
// (the renderer persists its last import folder and re-scans it on launch).
//
// Pure logic: the store is constructed with { storePath, fs } so tests can
// inject a temp dir. Windows-case-insensitive containment via pathSafety.
"use strict";

const path = require("path");
const pathSafety = require("./pathSafety.js");

function createConsentStore({ storePath, fs }) {
  let list = null;              // lazily-loaded roots
  let hadStoreAtStartup = null; // whether the file existed at first load

  function load() {
    if (list) return list;
    let roots = [];
    hadStoreAtStartup = fs.existsSync(storePath);
    if (hadStoreAtStartup) {
      try {
        roots = JSON.parse(fs.readFileSync(storePath, "utf8")).filter((r) => typeof r === "string");
      } catch { roots = []; }
    }
    list = roots;
    return roots;
  }

  function add(dir) {
    const roots = load();
    const norm = path.resolve(String(dir));
    if (!roots.some((r) => path.resolve(r).toLowerCase() === norm.toLowerCase())) {
      roots.push(norm);
      try { fs.writeFileSync(storePath, JSON.stringify(roots, null, 2), "utf8"); } catch { /* persist best-effort */ }
    }
  }

  // True when `p` is a consented root or inside one.
  function isConsented(p) {
    return pathSafety.isInsideAny(load(), p);
  }

  // Grandfather rule for scan-folder: on the first launch where the store file
  // didn't exist yet, the only scan callers are the app's own saved-import
  // restore paths — consent them (which creates the store, ending the window).
  // Once a store exists at startup, consent is strict. Returns true when the
  // scan may proceed.
  function allowScan(dir) {
    load();
    if (!hadStoreAtStartup) { add(dir); return true; }
    return isConsented(dir);
  }

  return {
    add,
    isConsented,
    allowScan,
    get hadStoreAtStartup() { load(); return hadStoreAtStartup; },
    get roots() { return [...load()]; },
  };
}

module.exports = { createConsentStore };
