// src/landmarkParser.js
//
// The 7 Wonders of the ancient world (LANDMARK_MANAGER, schema version 7) —
// cracked 2026-06-06 (rtw-sav-parser/docs/findings-landmarks-wonders-2026-06-06.md).
//
// The landmark block is a contiguous named-record array (same family as forts):
//   [u16 nameLen][ascii name (trailing \0 counted in len)][u32 tileX][u32 tileY][u32 handle]
// repeated per landmark, with NO inline count. We anchor on the first landmark's
// name string ("pyramids_and_sphinx" in RIS + vanilla) and walk forward until a
// record fails validation. Positions are byte-exact vs descr_strat (verified
// 196/196 across the 28-save corpus); the trailing `handle` is a per-load runtime
// UUID (NOT the owner — ownership is derived from the settlement on the tile).
//
// tileX/tileY are WORLD coords (bottom-up), same space as descr_strat and the
// save's character positions — so a tile→region resolver maps a wonder to its
// region/owner.

"use strict";

// Friendly display names for the canonical RTW wonder tokens. Unknown tokens
// fall back to a title-cased version of the raw token (so a modded landmark
// still shows *something* real, never a fabricated label).
const WONDER_NAMES = {
  pyramids_and_sphinx: "Pyramids & Sphinx",
  pyramids: "Great Pyramids",
  pharos: "Pharos of Alexandria",
  colossus: "Colossus of Rhodes",
  temple: "Temple of Artemis",
  statue: "Statue of Zeus",
  gardens: "Hanging Gardens of Babylon",
  mausoleum: "Mausoleum of Halicarnassus",
};

function titleCase(token) {
  return String(token).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Parse the landmark array from a save buffer. Returns [{ token, name, x, y }]
// (empty array if the block isn't present). `anchorTokens` lets a caller pass
// mod-specific first-landmark names; we try each until one is found.
function parseLandmarks(buf, anchorTokens) {
  if (!buf || buf.length < 32) return [];
  const tokens = anchorTokens && anchorTokens.length
    ? anchorTokens
    : ["pyramids_and_sphinx", "pyramids"];
  let anchor = -1;
  for (const t of tokens) {
    anchor = buf.indexOf(Buffer.from(t, "ascii"));
    if (anchor >= 0) break;
  }
  if (anchor < 2) return [];

  const out = [];
  let p = anchor - 2; // the u16 nameLen sits 2 bytes before the name
  for (let i = 0; i < 12; i++) {
    if (p + 2 > buf.length) break;
    const nlen = buf.readUInt16LE(p);
    if (nlen < 3 || nlen > 40) break;
    const nameStart = p + 2;
    if (nameStart + nlen + 12 > buf.length) break;
    const name = buf.toString("ascii", nameStart, nameStart + nlen).replace(/\0+$/, "");
    // Landmark tokens are lowercase letters + underscores only.
    if (!/^[a-z_]+$/.test(name)) break;
    const after = nameStart + nlen;
    const x = buf.readUInt32LE(after);
    const y = buf.readUInt32LE(after + 4);
    // Sanity: on-map tile (RTW:R maps run to ~1100×750).
    if (x < 1 || x > 1200 || y < 1 || y > 900) break;
    out.push({ token: name, name: WONDER_NAMES[name] || titleCase(name), x, y });
    p = after + 12; // [u32 x][u32 y][u32 handle]
  }
  return out;
}

module.exports = { parseLandmarks, WONDER_NAMES };
