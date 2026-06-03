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

async function pixelsToBlobUrl({ width, height, pixels }) {
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

// 0.9.884: parallel cache of the RESOLVED portrait file's index + path, keyed
// the same way as the blob cache. Lets a dev-mode overlay show exactly which
// numbered face Provincia chose so it can be matched against the in-game face.
const metaCache = new Map();
function parsePortraitIndex(p) {
  if (!p) return null;
  const m = String(p).match(/(\d+)\.tga(?:\.dds)?$/i);
  return m ? parseInt(m[1], 10) : null;
}
export function getCachedPortraitMeta(culture, slot, charContext) {
  if (!culture || !slot) return null;
  return metaCache.get(makeKey(culture, slot, charContext)) || null;
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
      if (!res || !res.ok || !res.buffer) {
        cache.set(key, "none");
        return null;
      }
      metaCache.set(key, { index: parsePortraitIndex(res.path), path: res.path });
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
      const url = await pixelsToBlobUrl({ width, height, pixels });
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
