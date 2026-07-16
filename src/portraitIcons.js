// src/portraitIcons.js
//
// Lazy loader + cache for character portraits.
//
// Two flavours of source data:
//   1. Static family-slot TGAs at `data/ui/<culture>/portraits/family/*.tga`
//      (wife / son / daughter / general fallback). Decoded via tga.js.
//   2. Per-character general portraits from the RTW pool at
//      `data/ui/<culture>/portraits/portraits/<age>/generals/NNN.tga.dds`,
//      picked by a hash of the character name (main.js does the picking).
//      These are LZ4-frame-compressed DDS with DXT1 texture data — decoded
//      via portraitDecoder.js.
// Mod dir is searched first, then vanilla.

"use strict";

import TGA from "./tga.js";
import { decodeRtwPortraitBytes } from "./portraitDecoder.js";
import { queueCachePut } from "./buildingIcons.js";

const cache = new Map();    // cacheKey -> blobUrl | "none"
const inflight = new Map(); // cacheKey -> Promise

function makeKey(culture, slot, charContext) {
  const base = `${String(culture).toLowerCase()}|${slot}`;
  if (slot === "general" && charContext) {
    // savePath is the most-specific identifier when present (engine-assigned
    // portrait from the loaded save); use it as the cache key so two
    // same-named characters with different save portraits don't collide.
    if (charContext.savePath) return `${base}|savepath:${charContext.savePath}`;
    if (charContext.name) {
      return `${base}|${charContext.name}|${charContext.lastName || ""}|${charContext.faction || ""}|${charContext.age || ""}`;
    }
  }
  return base;
}

async function pixelsToBlobUrl({ width, height, pixels }, cachePath) {
  const rowMajor = new Uint8ClampedArray(pixels);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(width, height);
  img.data.set(rowMajor);
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((b) => {
      if (b && cachePath) {
        // Persist the freshly decoded PNG so the next launch skips the
        // DDS/TGA decode for this portrait entirely (2026-07-16).
        b.arrayBuffer().then((ab) => queueCachePut(cachePath, ab)).catch(() => {});
      }
      resolve(b ? URL.createObjectURL(b) : null);
    }, "image/png");
  });
}

export function loadPortrait(modDataDir, culture, slot, charContext) {
  if (!culture || !slot) return Promise.resolve(null);
  const key = makeKey(culture, slot, charContext);
  if (cache.has(key)) {
    const v = cache.get(key);
    return Promise.resolve(v === "none" ? null : v);
  }
  if (inflight.has(key)) return inflight.get(key);
  const api = window.electronAPI;
  if (!api?.resolvePortrait) return Promise.resolve(null);
  const p = (async () => {
    try {
      const res = await api.resolvePortrait(modDataDir, culture, slot, charContext || null);
      if (!res || !res.ok || (!res.buffer && !res.png)) {
        cache.set(key, "none");
        return null;
      }
      // Persistent-cache hit: pre-decoded PNG bytes — no DDS/TGA decode.
      if (res.png) {
        const url = URL.createObjectURL(new Blob([res.png], { type: "image/png" }));
        cache.set(key, url || "none");
        return url || null;
      }
      let width, height, pixels;
      if (res.encoded === "rtw-tga-dds") {
        try {
          const decoded = decodeRtwPortraitBytes(new Uint8Array(res.buffer));
          width = decoded.width;
          height = decoded.height;
          pixels = decoded.rgba;
        } catch (e) {
          console.warn("[portraitIcons] DDS decode failed", res.path, e?.message);
          cache.set(key, "none");
          return null;
        }
      } else {
        let tga;
        try {
          tga = new TGA(new Uint8Array(res.buffer));
        } catch {
          cache.set(key, "none");
          return null;
        }
        if (!tga.width || !tga.height || !tga.pixels) {
          cache.set(key, "none");
          return null;
        }
        width = tga.width;
        height = tga.height;
        pixels = tga.pixels;
      }
      const url = await pixelsToBlobUrl({ width, height, pixels }, res.path || null);
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

export function getCachedPortrait(culture, slot, charContext) {
  if (!culture || !slot) return null;
  const v = cache.get(makeKey(culture, slot, charContext));
  return v === "none" || !v ? null : v;
}
