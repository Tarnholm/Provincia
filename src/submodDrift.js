// Submod drift checker (2026-07-17). RTW:R teams layer "submod" folders over a
// base mod: any file at the same relative path OVERRIDES the base copy. A stale
// override silently shadows base-mod updates (real incident: a submod's old
// text/expanded_bi.txt lacked new string tokens → in-game "Could not find
// string 'mine_from_coal_ga' in expanded string table!").
//
// scanSubmodDrift(baseDataDir, submodDataDir) walks the submod dir recursively
// and, for every file that ALSO exists in the base dir (an override), compares
// mtimes and content (sha1) to classify it:
//   sameContent — byte-identical to base (harmless duplicate)
//   stale       — submod copy OLDER than base AND content differs (the danger
//                 case: the base mod moved on and the submod shadows it)
//   danger      — the file is on the known-risky list (symptom string attached)
// Path matching is case-insensitive (Windows mod folders mix casing freely);
// each relative path segment is resolved against a cached directory listing so
// the scan also behaves on case-sensitive filesystems.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Directories never worth descending into.
const SKIP_DIRS = new Set([".git", ".svn", ".hg", ".vs", "node_modules", "__pycache__", "$recycle.bin"]);

// Known-risky override files (normalized: forward slashes, lowercase) → symptom
// the team will actually see in-game when the override goes stale.
const DANGER_FILES = {
  "text/expanded_bi.txt":
    "Missing new string tokens → 'Could not find string' script error; other strings silently fall back to vanilla",
  "world/maps/base/descr_regions.txt":
    "Stale region tags → mine income silently drops to zero; delete map.rwm (mod + Feral VFS) after updating",
  "descr_sm_resources.txt":
    "Undeclared hidden-resource classes → fatal 'unrecognised resource class' at Building DB init",
  "export_descr_buildings.txt":
    "Base-mod balance/building changes silently reverted",
  "export_descr_unit.txt":
    "Base-mod balance/building changes silently reverted",
  "text/strat.txt":
    "UI labels revert (cosmetic)",
};

// Forward-slash + lowercase for matching; display keeps the submod's casing.
const normRel = (rel) => rel.split(path.sep).join("/");

// Case-insensitive path resolver against rootDir. Resolves each segment via a
// cached readdir listing (one readdir per directory for the whole scan) so
// "Text/Expanded_BI.TXT" finds "text/expanded_bi.txt" on any filesystem.
// Returns the actual absolute path, or null if any segment is missing.
function makeCaseInsensitiveResolver(rootDir) {
  const listCache = new Map(); // abs dir → Map(lowerName → actualName) | null
  const listing = (dir) => {
    let m = listCache.get(dir);
    if (m === undefined) {
      try {
        m = new Map();
        for (const name of fs.readdirSync(dir)) m.set(name.toLowerCase(), name);
      } catch { m = null; }
      listCache.set(dir, m);
    }
    return m;
  };
  return (segments) => {
    let dir = rootDir;
    for (const seg of segments) {
      const m = listing(dir);
      if (!m) return null;
      const actual = m.get(seg.toLowerCase());
      if (actual === undefined) return null;
      dir = path.join(dir, actual);
    }
    return dir;
  };
}

function sha1File(p) {
  return crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
}

// Recursively list all FILES under dir as relative-segment arrays.
function walkFiles(dir, segments, out, errors) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { errors.push({ rel: segments.join("/") || ".", error: e && e.message ? e.message : String(e) }); return; }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name.toLowerCase())) continue;
      walkFiles(path.join(dir, ent.name), segments.concat(ent.name), out, errors);
    } else if (ent.isFile()) {
      out.push(segments.concat(ent.name));
    } // symlinks/others skipped — mod data folders are plain files
  }
}

function scanSubmodDrift(baseDataDir, submodDataDir) {
  if (!baseDataDir || !submodDataDir) throw new Error("baseDataDir + submodDataDir required");
  for (const [label, d] of [["base", baseDataDir], ["submod", submodDataDir]]) {
    let st;
    try { st = fs.statSync(d); } catch { st = null; }
    if (!st || !st.isDirectory()) throw new Error(`${label} dir not found or not a directory: ${d}`);
  }

  const resolveInBase = makeCaseInsensitiveResolver(baseDataDir);
  const errors = [];
  const fileSegs = [];
  walkFiles(submodDataDir, [], fileSegs, errors);

  const overrides = [];
  for (const segs of fileSegs) {
    const rel = normRel(segs.join(path.sep));
    const basePath = resolveInBase(segs);
    if (!basePath) continue; // submod-only file — not an override, nothing shadowed
    let baseStat, subStat;
    const subPath = path.join(submodDataDir, ...segs);
    try {
      baseStat = fs.statSync(basePath);
      subStat = fs.statSync(subPath);
      if (!baseStat.isFile()) continue; // rel path is a dir in base — not an override
    } catch (e) { errors.push({ rel, error: e && e.message ? e.message : String(e) }); continue; }

    let sameContent;
    try {
      // size differs → content differs, skip the hash (cheap fast-path)
      sameContent = baseStat.size === subStat.size && sha1File(basePath) === sha1File(subPath);
    } catch (e) { errors.push({ rel, error: e && e.message ? e.message : String(e) }); continue; }

    const baseMtime = baseStat.mtimeMs;
    const submodMtime = subStat.mtimeMs;
    overrides.push({
      rel,
      baseMtime,
      submodMtime,
      sameContent,
      stale: submodMtime < baseMtime && !sameContent,
      danger: DANGER_FILES[rel.toLowerCase()] || null,
    });
  }

  // Deterministic worst-first order: danger+stale, danger, stale, differing, identical.
  const rank = (o) => (o.danger && o.stale) ? 0 : o.danger ? 1 : o.stale ? 2 : !o.sameContent ? 3 : 4;
  overrides.sort((a, b) => (rank(a) - rank(b)) || a.rel.localeCompare(b.rel));

  const summary = {
    submodFiles: fileSegs.length,
    overrides: overrides.length,
    identical: overrides.filter(o => o.sameContent).length,
    differing: overrides.filter(o => !o.sameContent).length,
    stale: overrides.filter(o => o.stale).length,
    danger: overrides.filter(o => o.danger).length,
    dangerStale: overrides.filter(o => o.danger && o.stale).length,
  };
  return { overrides, summary, errors };
}

module.exports = { scanSubmodDrift, DANGER_FILES };
