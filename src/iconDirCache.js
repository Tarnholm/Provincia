// Directory-listing cache for building-icon resolution, extracted from main.js
// (2026-07-15). The icon resolver probes the same ~40 candidate dirs for EVERY
// icon; using fs.existsSync per candidate file meant hundreds of thousands of
// syscalls when warming ~900 icons — the startup icon-lag bottleneck on Windows
// (where existsSync is slow). Instead each dir is readdir'd ONCE and file
// lookups are answered from an in-memory Map<lowercased name → actual name>.
// Windows filesystems are case-insensitive, so this matches the resolver's
// multiple-casing attempts exactly, and returns the ACTUAL on-disk name so the
// caller can read the file.
//
// Constructed with an `fs` (createIconDirCache(fs)) so it's unit-testable
// against a temp dir. main.js wires a singleton over node's fs.
"use strict";

function createIconDirCache(fs) {
  const listing = new Map(); // dirPath → Map(lowerName → actualName) | null (dir absent)

  // The cached filename Map for a dir (readdir once). null if the dir is
  // missing / not a directory.
  function files(dir) {
    if (listing.has(dir)) return listing.get(dir);
    let m = null;
    try {
      const names = fs.readdirSync(dir);
      m = new Map();
      for (const n of names) m.set(n.toLowerCase(), n);
    } catch { m = null; } // ENOENT / not a dir → treated as absent
    listing.set(dir, m);
    return m;
  }

  // Case-insensitively resolve `fn` in `dir` to its actual on-disk filename,
  // or null if the dir or file is absent.
  function resolve(dir, fn) {
    const m = files(dir);
    if (!m) return null;
    return m.get(String(fn).toLowerCase()) || null;
  }

  // Invalidate one dir (after writing an icon there) or all (dir == null).
  function clear(dir) {
    if (dir == null) { listing.clear(); return; }
    listing.delete(dir);
  }

  return { files, resolve, clear };
}

module.exports = { createIconDirCache };
