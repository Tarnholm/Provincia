// Small, pure main-process utilities extracted from main.js (2026-07-15).
// Zero state, zero I/O — just data transforms. Unit-tested in mainUtils.test.js.
"use strict";

// RTW:R engine TEXT files (descr_*.txt) MUST be CRLF or the parsers break.
// Normalize any content destined for a .txt path to CRLF; pass other content
// (and non-strings) through untouched.
function gameTextCRLF(filePath, content) {
  if (typeof content === "string" && /\.txt$/i.test(String(filePath))) {
    return content.replace(/\r\n?|\n/g, "\r\n");
  }
  return content;
}

// djb2 string hash → unsigned 32-bit. Used to key cache slots by name.
function hashName(name) {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  return h >>> 0;
}

// Bounded LRU map. Parser caches are keyed by `${modDataDir}|...`; without a
// bound they grow unboundedly as the user switches mods (each path is a unique
// key held forever). `get` touches (moves to most-recent); `set` evicts oldest
// past `limit`.
function makeLRU(limit) {
  const m = new Map();
  return {
    has: (k) => m.has(k),
    get: (k) => {
      if (!m.has(k)) return undefined;
      const v = m.get(k);
      m.delete(k); m.set(k, v); // touch → most-recent
      return v;
    },
    set: (k, v) => {
      if (m.has(k)) m.delete(k);
      m.set(k, v);
      while (m.size > limit) {
        const oldest = m.keys().next().value;
        m.delete(oldest);
      }
    },
  };
}

// Parse an RTW `{key}text` dictionary (already decoded to a string) into
// { key: text }. A key line is `{KEY}rest`; subsequent non-key lines continue
// the previous value. `\n` escapes become real newlines; values are trimmed.
// Pure — the file read + BOM/utf16 decode + caching stay in the caller.
function parseTextDictionary(text) {
  const entries = {};
  let curKey = null, curBuf = "";
  const flush = () => {
    if (curKey != null) entries[curKey] = curBuf.replace(/\\n/g, "\n").trim();
    curKey = null; curBuf = "";
  };
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*\{([^}]+)\}(.*)$/);
    if (m) { flush(); curKey = m[1].trim(); curBuf = m[2]; }
    else if (curKey != null) curBuf += "\n" + line;
  }
  flush();
  return entries;
}

module.exports = { gameTextCRLF, hashName, makeLRU, parseTextDictionary };
