// Shared path-containment helpers for the Electron main process (2026-07-15).
//
// These enforce that renderer-supplied file paths/names stay inside an allowed
// base directory. They were duplicated as `resolveInside` (main.js) and
// `insideProject` (main-scripts.js); extracting them here removes the drift
// risk and — crucially — makes them unit-testable without loading `electron`
// (this module depends only on `path`). main.js / main-scripts.js keep their
// original wrapper names, delegating here.
//
// SECURITY NOTE: containment is the whole point — do not "simplify" the
// `startsWith(base + sep)` guard into a bare `startsWith(base)`, which would
// let `/data-evil` pass for base `/data`.
"use strict";

const path = require("path");

// Resolve `name` under `baseDir`, returning the absolute path only if it lands
// STRICTLY inside baseDir (the base dir itself is rejected). Blocks `..`
// traversal and absolute-path escapes. Returns null on escape.
function containedPath(baseDir, name) {
  const base = path.resolve(String(baseDir));
  const resolved = path.resolve(base, String(name == null ? "" : name));
  return resolved.startsWith(base + path.sep) ? resolved : null;
}

// True when `p` is one of `roots` or lives inside one. Case-insensitive to
// match Windows filesystem semantics (the app's target platform). Used for the
// dialog-consented read-root allowlist.
function isInsideAny(roots, p) {
  if (!p || !Array.isArray(roots)) return false;
  const resolved = path.resolve(String(p)).toLowerCase();
  for (const r of roots) {
    if (r == null) continue;
    const base = path.resolve(String(r)).toLowerCase();
    if (resolved === base || resolved.startsWith(base + path.sep)) return true;
  }
  return false;
}

// A safe single path SEGMENT (e.g. a user-typed profile name): non-empty, not
// "." / "..", no separators, no absolute/drive prefix. Returns the name, or
// null if unsafe. Blocks the traversal that let a profile name escape its dir.
function safeSegment(name) {
  const s = String(name == null ? "" : name).trim();
  if (!s || s === "." || s === "..") return null;
  if (/[\\/]/.test(s) || path.isAbsolute(s)) return null;
  if (s !== path.basename(s)) return null;
  return s;
}

module.exports = { containedPath, isInsideAny, safeSegment };
