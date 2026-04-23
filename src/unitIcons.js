// src/unitIcons.js
//
// Lazy loader + cache for unit portraits pulled from the mod/game install.
// Small square cards live at `data/ui/units/<faction>/#<unit>.tga`; the
// larger info-panel variant at `data/ui/unit_info/<faction>/<unit>_info.tga`.
// main.js's resolve-unit-card IPC handles both with the same lookup.

"use strict";

import TGA from "./tga.js";

const cache = new Map();
const inflight = new Map();

function pixelsToBlobUrl({ width, height, pixels }) {
  const rowMajor = new Uint8ClampedArray(pixels);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(width, height);
  img.data.set(rowMajor);
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), "image/png");
  });
}

export function loadUnitIcon(modDataDir, faction, unitName) {
  if (!faction || !unitName) return Promise.resolve(null);
  const key = `${faction}|${unitName}`;
  if (cache.has(key)) {
    const v = cache.get(key);
    return Promise.resolve(v === "none" ? null : v);
  }
  if (inflight.has(key)) return inflight.get(key);
  const api = window.electronAPI;
  if (!api?.resolveUnitCard) return Promise.resolve(null);
  const p = (async () => {
    try {
      const res = await api.resolveUnitCard(modDataDir, faction, unitName);
      if (!res || !res.buffer) {
        cache.set(key, "none");
        return null;
      }
      let tga;
      try { tga = new TGA(new Uint8Array(res.buffer)); }
      catch { cache.set(key, "none"); return null; }
      if (!tga.width || !tga.height || !tga.pixels) { cache.set(key, "none"); return null; }
      const url = await pixelsToBlobUrl({ width: tga.width, height: tga.height, pixels: tga.pixels });
      cache.set(key, url || "none");
      return url || null;
    } catch {
      cache.set(key, "none");
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function getCachedUnitIcon(faction, unitName) {
  if (!faction || !unitName) return null;
  const v = cache.get(`${faction}|${unitName}`);
  return v === "none" || !v ? null : v;
}

export function prefetchUnitIcons(modDataDir, triples, onLoaded) {
  for (const [faction, unitName] of triples) {
    if (!faction || !unitName) continue;
    const key = `${faction}|${unitName}`;
    if (cache.has(key) || inflight.has(key)) continue;
    loadUnitIcon(modDataDir, faction, unitName).then(() => { if (onLoaded) onLoaded(); });
  }
}
