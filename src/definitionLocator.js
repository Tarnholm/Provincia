// definitionLocator.js — "Where is this defined?" (2026-07-16). Given an
// entity name (unit type, building/level/chain, region, settlement, faction,
// trait, resource, or localized-text token), scan the mod's core text files
// and return every line that defines or references it, with absolute file
// path + 1-based line + trimmed preview, classified by kind.
//
// Encoding: RTW data files are latin1; text/*.txt localization files are
// UTF-16 (BOM-detected, LE or BE) with a UTF-8 fallback when no BOM.
//
// Matching: case-insensitive. Whole-token matches (query not butted against
// [A-Za-z0-9_] on either side — spaces inside multi-word unit names are fine)
// are preferred; when a query produces ZERO token hits the result falls back
// to substring hits, each flagged `fuzzy: true`. Hits are capped at 200.
//
// Performance: files are line-scanned once and the split line arrays (plus a
// lowercased shadow for fast substring probing) are cached per
// (path, mtimeMs, size) in a module Map — repeated queries against a 10MB
// traits file do not re-read or re-split it. The cache is exported so
// main.js's clear-mod-caches can clear it if it is ever wired there.
//
// Multi-file resolution goes through modPathResolver (getEdbSourceFiles /
// findRelatedModDirs) so layered mods like RIS (submod dirs, override /
// original_overrides sibling data dirs) are all searched, and a mod that
// lacks a file falls back to the detected vanilla RTW:R install.
"use strict";

const fs = require("fs");
const path = require("path");
const { getEdbSourceFiles, findRelatedModDirs } = require("./modPathResolver.js");

const MAX_HITS = 200;
const PREVIEW_MAX = 160;

// ---------------------------------------------------------------------------
// Cached line reading with encoding detection.
// ---------------------------------------------------------------------------

// abs path -> { mtimeMs, size, lines, lower }
const _lineCache = new Map();

function _decodeBuffer(buf, isTextFile) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString("utf16le", 2); // UTF-16LE BOM
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16BE BOM — copy before swap16 (swap mutates in place).
    return Buffer.from(buf.subarray(2)).swap16().toString("utf16le");
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString("utf8", 3); // UTF-8 BOM
  }
  // No BOM: text/*.txt are usually UTF-16 with BOM; without one, data files
  // are latin1 (RTW's native encoding). For BOM-less text files utf8 is the
  // safer guess, latin1 for everything else.
  return buf.toString(isTextFile ? "utf8" : "latin1");
}

function getFileLines(absPath, isTextFile) {
  let st;
  try { st = fs.statSync(absPath); } catch { return null; }
  if (!st.isFile()) return null;
  const cached = _lineCache.get(absPath);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached;
  let buf;
  try { buf = fs.readFileSync(absPath); } catch { return null; }
  const text = _decodeBuffer(buf, !!isTextFile);
  const lines = text.split(/\r\n|\r|\n/);
  const lower = lines.map((l) => l.toLowerCase());
  const entry = { mtimeMs: st.mtimeMs, size: st.size, lines, lower };
  _lineCache.set(absPath, entry);
  return entry;
}

function clearDefinitionLocatorCache() { _lineCache.clear(); }

// ---------------------------------------------------------------------------
// Per-file line-kind classifiers. Each returns a stateful fn(line) -> kind
// so formats with positional structure (descr_regions, descr_strat
// settlement blocks) classify correctly. Kinds:
//   edu-type | edb-building | edb-recruit | strat-settlement |
//   regions-region | strat-resource | text-string | trait | generic
// ---------------------------------------------------------------------------

function classifierEdu() {
  return (line) => {
    if (/^\s*type\s/.test(line)) return "edu-type";
    if (/^\s*dictionary\s/.test(line)) return "edu-type";
    return "generic";
  };
}

function classifierEdb() {
  return (line) => {
    if (/^\s*recruit\s/.test(line)) return "edb-recruit";
    if (/^\s*building\s/.test(line)) return "edb-building";
    if (/^\s*levels\s/.test(line)) return "edb-building";
    return "generic";
  };
}

// descr_regions blocks: a non-indented, non-comment line is a region name;
// the FIRST indented line after it is the settlement (city) name. Both get
// kind regions-region; the remaining indented lines (creator, rebels, RGB,
// hidden-resource tags, farm level, religions) are generic references.
function classifierRegions() {
  let expectCity = false;
  return (line) => {
    const t = line.trim();
    if (!t || t.startsWith(";")) return "generic";
    if (!/^\s/.test(line)) { expectCity = true; return "regions-region"; }
    if (expectCity) { expectCity = false; return "regions-region"; }
    return "generic";
  };
}

// descr_strat: `resource` lines are strat-resource; every line inside a
// `settlement { ... }` block (level, region, building types, …) is
// strat-settlement. faction/character/other top-level lines are generic.
function classifierStrat() {
  let inSettlement = false;
  let depth = 0;
  let pendingSettlement = false;
  return (line) => {
    const t = line.trim();
    if (/^resource\b/.test(t)) return "strat-resource";
    if (/^settlement\b/.test(t)) { pendingSettlement = true; return "strat-settlement"; }
    let kind = "generic";
    if (inSettlement || (pendingSettlement && t.startsWith("{"))) kind = "strat-settlement";
    // Brace bookkeeping AFTER classifying so the closing `}` still counts.
    for (const ch of t) {
      if (ch === "{") {
        if (pendingSettlement) { inSettlement = true; pendingSettlement = false; }
        if (inSettlement) depth++;
      } else if (ch === "}") {
        if (inSettlement) { depth--; if (depth <= 0) { inSettlement = false; depth = 0; } }
      }
    }
    if (pendingSettlement && t && !t.startsWith("{") && !/^settlement\b/.test(t)) pendingSettlement = false;
    return kind;
  };
}

function classifierTraits() {
  return (line) => {
    if (/^\s*Trait\s/.test(line)) return "trait";
    if (/^\s*(AntiTraits|Affects|NoGoingBackLevel)\s/.test(line)) return "trait";
    return "generic";
  };
}

// ---------------------------------------------------------------------------
// Search targets. Each rel path resolved through getEdbSourceFiles so mod
// layering + vanilla fallback match the rest of the app.
// ---------------------------------------------------------------------------

const TARGETS = [
  { rel: "export_descr_unit.txt", make: classifierEdu },
  { rel: "export_descr_buildings.txt", make: classifierEdb },
  { rel: "world/maps/base/descr_regions.txt", make: classifierRegions },
  { rel: "world/maps/campaign/imperial_campaign/descr_strat.txt", make: classifierStrat },
  { rel: "export_descr_character_traits.txt", make: classifierTraits },
];

function _escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Rel path for display: relative to the queried mod data dir when the file
// is under it; otherwise from the last "data" path segment (vanilla install
// or sibling override dirs) so rows stay readable.
function _displayRel(absFile, modDataDir) {
  try {
    const rel = path.relative(modDataDir, absFile);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel.replace(/\\/g, "/");
  } catch {}
  const norm = absFile.replace(/\\/g, "/");
  const i = norm.toLowerCase().lastIndexOf("/data/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

// Enumerate text/*.txt across all related mod dirs. Localized duplicates
// (export_units_mac_de.txt etc.) are scanned LAST so, under the hit cap, the
// primary English files win the budget.
function _textFiles(modDataDir) {
  const dirs = findRelatedModDirs(modDataDir, "text");
  const primary = [];
  const localized = [];
  for (const d of dirs) {
    const textDir = path.join(d, "text");
    let entries = [];
    try { entries = fs.readdirSync(textDir); } catch { continue; }
    for (const name of entries) {
      if (!/\.txt$/i.test(name)) continue;
      const abs = path.join(textDir, name);
      (/_mac_[a-z_]+\.txt$/i.test(name) ? localized : primary).push(abs);
    }
  }
  primary.sort();
  localized.sort();
  return primary.concat(localized);
}

// ---------------------------------------------------------------------------
// locateDefinition
// ---------------------------------------------------------------------------

/**
 * @param {string} modDataDir absolute mod `data` dir
 * @param {string} query entity name to locate
 * @returns {{ query: string, kindGuesses: string[], hits: Array<{file:string, rel:string, line:number, kind:string, preview:string, fuzzy?:boolean}>, truncated: boolean, elapsedMs: number }}
 */
function locateDefinition(modDataDir, query) {
  const t0 = Date.now();
  const q = String(query == null ? "" : query).trim();
  if (!modDataDir || !q) {
    return { query: q, kindGuesses: [], hits: [], truncated: false, elapsedMs: 0 };
  }
  const qLower = q.toLowerCase();
  const tokenRe = new RegExp("(?<![A-Za-z0-9_])" + _escapeRegExp(q) + "(?![A-Za-z0-9_])", "i");

  const exact = [];
  const fuzzy = [];

  const scanFile = (absFile, makeClassifier, isTextFile) => {
    if (exact.length >= MAX_HITS) return;
    const entry = getFileLines(absFile, isTextFile);
    if (!entry) return;
    const { lines, lower } = entry;
    const classify = isTextFile ? null : makeClassifier();
    const rel = _displayRel(absFile, modDataDir);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Text files: kinds don't need per-line state, but data files do —
      // the classifier must see EVERY line to keep block state correct.
      const kind = isTextFile ? "text-string" : classify(line);
      if (!lower[i].includes(qLower)) continue;
      let isExact;
      if (isTextFile) {
        // Localization entries: `{token}Display text`. Exact = a {token}
        // equal to the query; substring-in-token or in display text = fuzzy.
        isExact = new RegExp("\\{\\s*" + _escapeRegExp(q) + "\\s*\\}", "i").test(line);
      } else {
        isExact = tokenRe.test(line);
      }
      if (isExact) {
        exact.push({ file: absFile, rel, line: i + 1, kind, preview: line.trim().slice(0, PREVIEW_MAX) });
        if (exact.length >= MAX_HITS) return;
      } else if (fuzzy.length < MAX_HITS) {
        fuzzy.push({ file: absFile, rel, line: i + 1, kind, preview: line.trim().slice(0, PREVIEW_MAX), fuzzy: true });
      }
    }
  };

  const seen = new Set();
  for (const target of TARGETS) {
    for (const absFile of getEdbSourceFiles(modDataDir, target.rel)) {
      const key = path.resolve(absFile).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      scanFile(absFile, target.make, false);
      if (exact.length >= MAX_HITS) break;
    }
    if (exact.length >= MAX_HITS) break;
  }
  if (exact.length < MAX_HITS) {
    for (const absFile of _textFiles(modDataDir)) {
      const key = path.resolve(absFile).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      scanFile(absFile, null, true);
      if (exact.length >= MAX_HITS) break;
    }
  }

  const hits = exact.length > 0 ? exact : fuzzy;
  const truncated = hits.length >= MAX_HITS;

  // Kind guesses: distinct kinds among the hits, most-frequent first,
  // "generic" always last (it never beats a specific kind as a guess).
  const counts = new Map();
  for (const h of hits) counts.set(h.kind, (counts.get(h.kind) || 0) + 1);
  const kindGuesses = [...counts.keys()].sort((a, b) => {
    if (a === "generic") return 1;
    if (b === "generic") return -1;
    return counts.get(b) - counts.get(a);
  });

  return { query: q, kindGuesses, hits, truncated, elapsedMs: Date.now() - t0 };
}

module.exports = {
  locateDefinition,
  clearDefinitionLocatorCache,
  _lineCache, // exported by reference — for clear-mod-caches wiring + tests
};
