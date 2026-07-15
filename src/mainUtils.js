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

module.exports = { gameTextCRLF, hashName, makeLRU };
