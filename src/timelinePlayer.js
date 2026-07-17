// src/timelinePlayer.js
//
// Campaign Timeline Player — pure frame-building helpers (2026-07-17).
// No DOM, no React, no Electron: operates on plain {width, height, data}
// image objects so it runs identically in the renderer and under vitest
// (Node has no ImageData; the panel wraps the returned object in a real
// ImageData before putImageData).
//
// The renderer's `regions` map is keyed by rgbKey "r,g,b" — each region is
// painted in that unique color on the ORIGINAL region-color offscreen canvas.
// A timeline row's ownership (`_ownerByCity`, city → factionId) therefore
// recolors the whole map in ONE pixel pass: precompute rgbKey → ownerColor
// once per frame (≈200 regions), then walk the pixels once.
//
// No-fabrication rule: a region whose owner the save doesn't name (and the
// caller's fallback doesn't either) renders DARK GRAY — never a guessed
// faction color. Non-region pixels (sea, map border) keep their original
// color untouched.

// Dark gray for "owner unknown / unowned" regions.
export const UNKNOWN_OWNER_COLOR = [56, 56, 60];

// ── faction color resolution ────────────────────────────────────────────────
// App.js holds factionColors as { factionId: { primary: [r,g,b], secondary: [r,g,b] } }
// (ids lowercase). Accept a few adjacent shapes defensively — [r,g,b] directly,
// {r,g,b} objects, and "#rrggbb" strings — so parser drift doesn't blank the map.
function toRgbTriplet(v) {
  if (v == null) return null;
  if (Array.isArray(v) && v.length >= 3 && typeof v[0] === "number") {
    return [v[0] & 255, v[1] & 255, v[2] & 255];
  }
  if (typeof v === "string") {
    const m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
    if (m) {
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v.trim());
    if (rgb) return [+rgb[1] & 255, +rgb[2] & 255, +rgb[3] & 255];
    return null;
  }
  if (typeof v === "object") {
    if (typeof v.r === "number" && typeof v.g === "number" && typeof v.b === "number") {
      return [v.r & 255, v.g & 255, v.b & 255];
    }
  }
  return null;
}

export function resolveFactionColor(factionColors, factionId) {
  if (!factionColors || !factionId) return null;
  const entry =
    factionColors[factionId] !== undefined
      ? factionColors[factionId]
      : factionColors[String(factionId).toLowerCase()];
  if (entry == null) return null;
  // Provincia shape first: { primary, secondary }.
  return toRgbTriplet(entry.primary) || toRgbTriplet(entry);
}

// ── ownership lookup ────────────────────────────────────────────────────────
// ownerByCity keys are the save's settlement names; App matches them to
// regions[key].city verbatim (see rgbToOwnerMap in App.js). Exact match first,
// then a case-insensitive fallback so a casing mismatch degrades gracefully
// instead of graying a region out.
function buildLowerOwnerIndex(ownerByCity) {
  const idx = new Map();
  for (const [city, fac] of Object.entries(ownerByCity)) {
    if (typeof fac === "string" && fac) idx.set(String(city).toLowerCase(), fac);
  }
  return idx;
}

export function ownerForRegion(regionEntry, ownerByCity, lowerIndex, fallbackOwnerFor, rgbKey) {
  if (regionEntry && regionEntry.city != null && ownerByCity) {
    const exact = ownerByCity[regionEntry.city];
    if (typeof exact === "string" && exact) return exact;
    const loose = lowerIndex && lowerIndex.get(String(regionEntry.city).toLowerCase());
    if (loose) return loose;
  }
  if (typeof fallbackOwnerFor === "function") {
    const f = fallbackOwnerFor(regionEntry, rgbKey);
    if (typeof f === "string" && f) return f;
  }
  return null; // unknown → dark gray at paint time
}

// ── frame builder ───────────────────────────────────────────────────────────
// baseImageData: { width, height, data: Uint8ClampedArray } — the ORIGINAL
//   region-color pixels (each region painted in its unique rgb key).
// regions: { "r,g,b": { region, city, faction, ... } }
// ownerByCity: { city: factionId } for ONE timeline row (may be null/empty).
// factionColors: { factionId: { primary: [r,g,b], ... } }
// fallbackOwnerFor: optional (regionEntry, rgbKey) => factionId | null, used
//   when the row doesn't name an owner for that region's city.
//
// Returns a NEW { width, height, data } (never mutates the base). Alpha is
// copied from the base so transparent margins stay transparent.
export function buildOwnershipFrame(baseImageData, regions, ownerByCity, factionColors, fallbackOwnerFor) {
  const { width, height, data } = baseImageData;
  const out = new Uint8ClampedArray(data.length);
  const own = ownerByCity || {};
  const lowerIndex = buildLowerOwnerIndex(own);

  // rgbKey (packed int) → [r,g,b] to paint. Built ONCE per frame.
  const colorByKey = new Map();
  for (const [rgbKey, entry] of Object.entries(regions || {})) {
    const parts = rgbKey.split(",");
    if (parts.length !== 3) continue;
    const packed = ((parts[0] & 255) << 16) | ((parts[1] & 255) << 8) | (parts[2] & 255);
    const owner = ownerForRegion(entry, own, lowerIndex, fallbackOwnerFor, rgbKey);
    const col = (owner && resolveFactionColor(factionColors, owner)) || UNKNOWN_OWNER_COLOR;
    colorByKey.set(packed, col);
  }

  // Single pixel pass. Non-region pixels (sea, borders) keep original color.
  for (let i = 0; i < data.length; i += 4) {
    const packed = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    const col = colorByKey.get(packed);
    if (col) {
      out[i] = col[0];
      out[i + 1] = col[1];
      out[i + 2] = col[2];
    } else {
      out[i] = data[i];
      out[i + 1] = data[i + 1];
      out[i + 2] = data[i + 2];
    }
    out[i + 3] = data[i + 3];
  }
  return { width, height, data: out };
}

// ── cache keys ──────────────────────────────────────────────────────────────
// Stable identity for one built frame: campaign index + row index within it.
// (The panel clears its whole cache whenever the timeline object identity,
// regions, or factionColors change, so indices are sufficient inside one scan.)
export function frameCacheKey(campaignIdx, rowIdx) {
  return `c${campaignIdx | 0}:r${rowIdx | 0}`;
}

// ── downscale (nearest-neighbor) ────────────────────────────────────────────
// Reduce a region-color base image to at most maxWidth, preserving EXACT
// pixel values (nearest sampling — never interpolate: blended pixels would no
// longer match any region rgb key). Returns the input untouched when already
// small enough. Recoloring at reduced res keeps per-frame cost ~constant even
// for mods with oversized map_regions images.
export function downscaleNearest(baseImageData, maxWidth) {
  const { width, height, data } = baseImageData;
  if (!maxWidth || width <= maxWidth) return baseImageData;
  const scale = maxWidth / width;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const si = (sy * width + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return { width: w, height: h, data: out };
}

// ── legend helper ───────────────────────────────────────────────────────────
// Top factions by settlement count for one turn's ownership map.
export function topFactionsForTurn(ownerByCity, limit = 10) {
  const counts = new Map();
  for (const fac of Object.values(ownerByCity || {})) {
    if (typeof fac === "string" && fac) counts.set(fac, (counts.get(fac) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([faction, count]) => ({ faction, count }))
    .sort((a, b) => b.count - a.count || a.faction.localeCompare(b.faction))
    .slice(0, limit);
}

// The scan payload historically stripped _ownerByCity (finalizeTimeline in
// saveAnalysisHandlers.js); the wiring keeps it. Accept either spelling.
export function rowOwnership(row) {
  if (!row) return null;
  const o = row._ownerByCity || row.ownerByCity;
  return o && typeof o === "object" && Object.keys(o).length > 0 ? o : null;
}
