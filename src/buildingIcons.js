// src/buildingIcons.js
//
// Lazy loader + cache for building icons pulled from the mod/game installation.
// Icons live in `data/ui/<culture>/buildings/` as `.tga` files; main.js searches
// mod-dir first with fallbacks to the vanilla / Alexander game installs.
// We decode TGA on the main thread (no worker, to avoid path issues under
// file://), draw to a canvas, and return a PNG blob-URL suitable for <img src>.

"use strict";

import TGA from "./tga.js";

const cache = new Map();    // `${culture}|${level}` → blobUrl | "none"
const inflight = new Map(); // `${culture}|${level}` → Promise

function pixelsToBlobUrl({ width, height, pixels }) {
  // tga.js already normalises orientation to top-down during parse, so
  // the buffer is row-major with row 0 = top. Don't re-flip.
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

// Get the icon URL for a building level. Returns a blob URL, or null if
// the icon isn't available. Resolves asynchronously; caller should re-render
// when the promise settles.
export function loadBuildingIcon(modDataDir, culture, levelName, chainName) {
  if (!culture || !levelName) return Promise.resolve(null);
  const key = `${culture}|${levelName}`;
  if (cache.has(key)) {
    const v = cache.get(key);
    return Promise.resolve(v === "none" ? null : v);
  }
  if (inflight.has(key)) return inflight.get(key);
  const api = window.electronAPI;
  if (!api?.resolveBuildingIcon) return Promise.resolve(null);
  const p = (async () => {
    try {
      const res = await api.resolveBuildingIcon(modDataDir, culture, levelName, chainName || null);
      if (!res || !res.buffer) {
        console.log("[buildingIcons] NO FILE for", culture, levelName);
        cache.set(key, "none");
        return null;
      }
      console.log("[buildingIcons] loaded", culture, levelName, "from", res.path, "size", res.buffer.byteLength);
      let tga;
      try {
        tga = new TGA(new Uint8Array(res.buffer));
      } catch (e) {
        console.warn("[buildingIcons] TGA decode failed for", culture, levelName, e?.message);
        cache.set(key, "none");
        return null;
      }
      if (!tga.width || !tga.height || !tga.pixels) {
        cache.set(key, "none");
        return null;
      }
      const url = await pixelsToBlobUrl({
        width: tga.width, height: tga.height, pixels: tga.pixels, flags: tga.flags,
      });
      cache.set(key, url || "none");
      return url || null;
    } catch (e) {
      console.warn("[buildingIcons] load failed", culture, levelName, e?.message);
      cache.set(key, "none");
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function getCachedBuildingIcon(culture, levelName) {
  if (!culture || !levelName) return null;
  const v = cache.get(`${culture}|${levelName}`);
  return v === "none" || !v ? null : v;
}

export function prefetchBuildingIcons(modDataDir, triples, onLoaded) {
  // triples: [culture, level, chainName?][]
  for (const t of triples) {
    const [culture, level, chainName] = t;
    if (!culture || !level) continue;
    const key = `${culture}|${level}`;
    if (cache.has(key) || inflight.has(key)) continue;
    loadBuildingIcon(modDataDir, culture, level, chainName).then(() => {
      if (onLoaded) onLoaded();
    });
  }
}
