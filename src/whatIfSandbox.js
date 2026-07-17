// src/whatIfSandbox.js — "what-if" balance sandbox (2026-07-17).
//
// Balance experiments WITHOUT touching the mod: apply a hypothetical EDB/EDU
// text tweak in a SHADOW copy of the mod's economy-relevant files, run the
// turn-1 economy model (src/econBaseline.js buildEconSnapshot) against the
// shadow, and diff every faction against the unmodified current state.
//
// The real mod dir is READ ONLY to this module — every write goes to a
// temp shadow dir (<base>/provincia-whatif-<hash>/), never into modDataDir.
//
// ---------------------------------------------------------------------------
// COPIED FILE SET (verified 2026-07-17 by tracing every path.join(modDataDir,…)
// that buildEconSnapshot reaches — growthEval.js, incomeModel.js, recruitPool.js,
// traitEffects.js, descrStratGeneral helpers):
//
//   export_descr_buildings.txt          incomeModel parseEDBIncome + growthEval parseEDB
//   export_descr_unit.txt               recruitPool.parseUnitStats (army upkeep, EDU law)
//   export_descr_character_traits.txt   incomeModel EDCT command cache + traitEffects (governor squalor/effects)
//   export_descr_ancillaries.txt        traitEffects (optional — existsSync-guarded)
//   descr_sm_resources.txt              incomeModel.parseResourceValues (trade values)
//   descr_sm_factions.txt               growthEval.parseFactionGroups (EDB `factions {}` clause eval)
//   descr_cultures.txt                  growthEval squalor tier bases
//   world/maps/base/descr_regions.txt   region→city map, farms, hidden resources
//   world/maps/base/map_regions.tga     region coords / adjacency / ports
//   world/maps/base/map_ground_types.tga  incomeModel.seaPortDistDepth (sea-lane BFS)
//   world/maps/base/map.rwm             frontier + landing-frontier trade graphs (+ map version byte)
//   world/maps/campaign/imperial_campaign/*.txt
//                                       descr_strat.txt (roster/settlements/resources) — REQUIRED —
//                                       plus the whole-dir *.txt scan incomeModel.parseProtectorates
//                                       does for become_protector scripts
//   original_overrides/resource_quantity/world/maps/campaign/imperial_campaign/descr_strat.txt
//                                       incomeModel's optional resource-quantity override (existsSync-guarded)
//
// Everything except EDB + descr_strat + descr_regions + map_regions.tga is
// optional (the models existsSync-guard or try/catch those reads) — missing
// optional files are simply not copied.
//
// CACHE SAFETY: the shadow dir is a DISTINCT path, so incomeModel's
// path-keyed caches (frontier graph, coords, map version — all built from
// files the sandbox never edits) stay valid, and growthEval/recruitPool's
// mtime-keyed parse caches refresh automatically when a reused shadow is
// re-copied after the real mod changed. The real-mod snapshot side reuses the
// module caches warmed by previous runs, so runWhatIf's baseline pass is fast
// after the first run in a process.
//
// CJS, requireable from the main process.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

// Files the sandbox may edit — the hypothetical-tweak surface.
const EDITABLE_FILES = ["export_descr_buildings.txt", "export_descr_unit.txt"];

// Static single-file copy set (relative paths, POSIX-style; joined per-OS).
// required:true files must exist in the source mod or createShadow errors.
const STATIC_FILES = [
  { rel: "export_descr_buildings.txt", required: true },
  { rel: "export_descr_unit.txt", required: true },
  { rel: "export_descr_character_traits.txt", required: false },
  { rel: "export_descr_ancillaries.txt", required: false },
  { rel: "descr_sm_resources.txt", required: false },
  { rel: "descr_sm_factions.txt", required: false },
  { rel: "descr_cultures.txt", required: false },
  { rel: "world/maps/base/descr_regions.txt", required: true },
  { rel: "world/maps/base/map_regions.tga", required: true },
  { rel: "world/maps/base/map_ground_types.tga", required: false },
  { rel: "world/maps/base/map.rwm", required: false },
  { rel: "original_overrides/resource_quantity/world/maps/campaign/imperial_campaign/descr_strat.txt", required: false },
];

const CAMPAIGN_REL = "world/maps/campaign/imperial_campaign";
const MANIFEST_NAME = ".provincia-whatif-manifest.json";

const toAbs = (modDataDir, rel) => path.join(modDataDir, ...rel.split("/"));

// Enumerate the source files the economy model needs, as
// [{ rel, abs, mtimeMs, size }]. Missing optional files are skipped; a missing
// required file returns { error }.
function listNeededSources(modDataDir) {
  const out = [];
  const missing = [];
  for (const f of STATIC_FILES) {
    const abs = toAbs(modDataDir, f.rel);
    let st = null;
    try { st = fs.statSync(abs); } catch { /* missing */ }
    if (st && st.isFile()) out.push({ rel: f.rel, abs, mtimeMs: st.mtimeMs, size: st.size });
    else if (f.required) missing.push(f.rel);
  }
  // Whole-dir *.txt scan mirrors incomeModel.parseProtectorates (it readdirs
  // this dir and reads every .txt).
  const campDir = toAbs(modDataDir, CAMPAIGN_REL);
  let stratSeen = false;
  try {
    for (const f of fs.readdirSync(campDir)) {
      if (!/\.txt$/i.test(f)) continue;
      const abs = path.join(campDir, f);
      let st = null;
      try { st = fs.statSync(abs); } catch { continue; }
      if (!st.isFile()) continue;
      if (/^descr_strat\.txt$/i.test(f)) stratSeen = true;
      out.push({ rel: CAMPAIGN_REL + "/" + f, abs, mtimeMs: st.mtimeMs, size: st.size });
    }
  } catch { /* dir missing → handled below */ }
  if (!stratSeen) missing.push(CAMPAIGN_REL + "/descr_strat.txt");
  if (missing.length) return { error: "required mod files missing: " + missing.join(", ") };
  return { files: out };
}

// Deterministic shadow-dir hash: same modDataDir + same edits → same dir.
// (Source CONTENT is deliberately not hashed — reuse is decided by comparing
// stored vs current mtime/size in the manifest, per-file.)
function shadowHash(modDataDir, edits) {
  const norm = path.resolve(String(modDataDir)).toLowerCase();
  const key = JSON.stringify({ modDataDir: norm, edits: edits || [] });
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 16);
}

// Validate + normalize one edit spec. Returns { error } or the normalized edit.
function normalizeEdit(e, i) {
  if (!e || typeof e !== "object") return { error: `edit ${i}: not an object` };
  const file = String(e.file || "");
  if (!EDITABLE_FILES.includes(file)) {
    return { error: `edit ${i}: file must be one of ${EDITABLE_FILES.join(" | ")} (got "${file}")` };
  }
  if (typeof e.find !== "string" || e.find === "") return { error: `edit ${i} (${file}): "find" must be a non-empty string` };
  if (typeof e.replace !== "string") return { error: `edit ${i} (${file}): "replace" must be a string` };
  return {
    file,
    find: e.find,
    replace: e.replace,
    isRegex: e.isRegex === true,          // default false
    all: e.all !== false,                 // default true
  };
}

// Apply one edit to a latin1 text. Returns { text, matches } or { error }.
function applyEditToText(text, edit) {
  if (edit.isRegex) {
    let re;
    try { re = new RegExp(edit.find, "g"); } catch (e) {
      return { error: "invalid regex: " + ((e && e.message) || String(e)) };
    }
    const matches = [...text.matchAll(re)].length;
    if (!matches) return { text, matches: 0 };
    if (edit.all) return { text: text.replace(re, edit.replace), matches };
    let first;
    try { first = new RegExp(edit.find); } catch (e) { return { error: "invalid regex: " + ((e && e.message) || String(e)) }; }
    return { text: text.replace(first, edit.replace), matches };
  }
  // Literal find.
  const parts = text.split(edit.find);
  const matches = parts.length - 1;
  if (!matches) return { text, matches: 0 };
  if (edit.all) return { text: parts.join(edit.replace), matches };
  const idx = text.indexOf(edit.find);
  return { text: text.slice(0, idx) + edit.replace + text.slice(idx + edit.find.length), matches };
}

function readManifest(shadowDir) {
  try { return JSON.parse(fs.readFileSync(path.join(shadowDir, MANIFEST_NAME), "utf8")); }
  catch { return null; }
}

// Create (or reuse) a shadow modDataDir with `edits` applied.
// Returns { shadowDir, applied: [{ file, matches }], errors: [{ file, find, message }], reused }
// or { error } for structural failures (bad edit spec, missing required files).
// opts.baseDir — override the temp base (Electron callers may pass
// app.getPath("temp"); defaults to os.tmpdir()).
function createShadow(modDataDir, edits, opts) {
  if (!modDataDir) return { error: "modDataDir required" };
  const realDir = path.resolve(String(modDataDir));
  if (!fs.existsSync(realDir)) return { error: "modDataDir not found: " + realDir };

  // Normalize/validate edits up front — a malformed spec is a hard error.
  const normEdits = [];
  for (let i = 0; i < (edits || []).length; i++) {
    const n = normalizeEdit(edits[i], i);
    if (n.error) return { error: n.error };
    normEdits.push(n);
  }

  const src = listNeededSources(realDir);
  if (src.error) return { error: src.error };

  const baseDir = (opts && opts.baseDir) ? path.resolve(String(opts.baseDir)) : os.tmpdir();
  const shadowDir = path.join(baseDir, "provincia-whatif-" + shadowHash(realDir, normEdits));

  // Safety: the shadow must never coincide with (or live inside) the real mod.
  const rel = path.relative(realDir, shadowDir);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    return { error: "refusing to shadow into the real mod dir: " + shadowDir };
  }

  // Reuse: same hash dir + manifest lists the same source files with unchanged
  // mtime/size → skip the whole copy+edit pass and return the stored result.
  const manifest = readManifest(shadowDir);
  if (manifest && Array.isArray(manifest.sources) && Array.isArray(manifest.applied)) {
    const cur = new Map(src.files.map(f => [f.rel, f]));
    const fresh =
      manifest.sources.length === cur.size &&
      manifest.sources.every(s => {
        const c = cur.get(s.rel);
        return c && c.mtimeMs === s.mtimeMs && c.size === s.size;
      });
    if (fresh) {
      return {
        shadowDir,
        applied: manifest.applied,
        errors: Array.isArray(manifest.errors) ? manifest.errors : [],
        reused: true,
      };
    }
  }

  // Copy the needed set, preserving relative paths.
  fs.mkdirSync(shadowDir, { recursive: true });
  for (const f of src.files) {
    const dest = toAbs(shadowDir, f.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.abs, dest);            // reads real mod, writes shadow only
  }

  // Apply edits to the SHADOW copies (latin1 — the RTW text encoding, and what
  // every parser in this codebase reads these files as).
  const applied = [];
  const errors = [];
  // Group per file so multiple edits to one file do a single read/write.
  const byFile = new Map();
  for (const e of normEdits) {
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file).push(e);
  }
  for (const [file, list] of byFile) {
    const p = toAbs(shadowDir, file);
    let text = fs.readFileSync(p, "latin1");
    let dirty = false;
    for (const e of list) {
      const r = applyEditToText(text, e);
      if (r.error) { errors.push({ file, find: e.find, message: r.error }); continue; }
      if (r.matches === 0) {
        // Zero matches = surfaced error, not a silent no-op run.
        errors.push({ file, find: e.find, message: `"${e.find.slice(0, 120)}" matched nothing in ${file}` });
        continue;
      }
      text = r.text; dirty = true;
      applied.push({ file, matches: r.matches });
    }
    if (dirty) fs.writeFileSync(p, text, "latin1");
  }

  fs.writeFileSync(path.join(shadowDir, MANIFEST_NAME), JSON.stringify({
    at: new Date().toISOString(),
    modDataDir: realDir,
    edits: normEdits,
    sources: src.files.map(f => ({ rel: f.rel, mtimeMs: f.mtimeMs, size: f.size })),
    applied,
    errors,
  }, null, 2));

  return { shadowDir, applied, errors, reused: false };
}

// Remove a shadow dir. Guarded to only ever delete dirs this module created
// (basename must carry the provincia-whatif- prefix).
function cleanupShadow(shadowDir) {
  if (!shadowDir) return false;
  const p = path.resolve(String(shadowDir));
  if (!path.basename(p).startsWith("provincia-whatif-")) return false;
  try { fs.rmSync(p, { recursive: true, force: true }); return true; } catch { return false; }
}

// Full what-if run: snapshot the REAL mod (baseline), materialize the shadow
// with edits, snapshot the SHADOW, diff shadow-vs-real. Positive deltaPct =
// the hypothetical value went UP vs the current mod.
// Returns { applied, shadowDir, reused, rows, added, removed, baselineMs,
//           shadowMs, factionsCompared, snapshotErrors } or
//         { error, applied?, errors? }.
// This is a MODEL-ONLY estimate (the turn-1 economy model, not the game).
function runWhatIf(modDataDir, edits, thresholdPct, opts) {
  const { buildEconSnapshot, diffEconSnapshots } = require("./econBaseline.js");
  if (!modDataDir) return { error: "modDataDir required" };
  if (!Array.isArray(edits) || !edits.length) return { error: "at least one edit required" };

  const shadow = createShadow(modDataDir, edits, opts);
  if (shadow.error) return { error: shadow.error };
  if (shadow.errors && shadow.errors.length) {
    // Don't run the model on a shadow whose edits didn't land — the diff would
    // silently read as "no change".
    return {
      error: "edit(s) matched nothing — fix the find text: "
        + shadow.errors.map(e => e.file + ": " + e.message).join(" | "),
      applied: shadow.applied,
      errors: shadow.errors,
      shadowDir: shadow.shadowDir,
    };
  }

  const t0 = Date.now();
  const baseline = buildEconSnapshot(modDataDir);     // real mod — benefits from warm module caches
  const baselineMs = Date.now() - t0;
  if (baseline.error) return { error: "baseline snapshot failed: " + baseline.error, applied: shadow.applied };

  const t1 = Date.now();
  const hypo = buildEconSnapshot(shadow.shadowDir);   // shadow — distinct path, own caches
  const shadowMs = Date.now() - t1;
  if (hypo.error) return { error: "shadow snapshot failed: " + hypo.error, applied: shadow.applied };

  // current = hypothetical (shadow), baseline = real current state.
  const d = diffEconSnapshots(hypo, baseline, thresholdPct);
  const snapshotErrors =
    (baseline.errors ? Object.keys(baseline.errors).length : 0)
    + (hypo.errors ? Object.keys(hypo.errors).length : 0);
  return {
    applied: shadow.applied,
    shadowDir: shadow.shadowDir,
    reused: !!shadow.reused,
    rows: d.rows,
    added: d.added,
    removed: d.removed,
    baselineMs,
    shadowMs,
    factionsCompared: Object.keys(hypo.factions).length,
    snapshotErrors,
  };
}

module.exports = {
  createShadow,
  cleanupShadow,
  runWhatIf,
  // exported for tests / callers that want the details:
  listNeededSources,
  applyEditToText,
  shadowHash,
  EDITABLE_FILES,
  STATIC_FILES,
  CAMPAIGN_REL,
  MANIFEST_NAME,
};
