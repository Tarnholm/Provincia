// src/unitIcons.js
//
// Lazy loader + cache for unit portraits pulled from the mod/game install.
// Small square cards live at `data/ui/units/<faction>/#<unit>.tga`; the
// larger info-panel variant at `data/ui/unit_info/<faction>/<unit>_info.tga`.
// main.js's resolve-unit-card IPC handles both with the same lookup.

"use strict";

import TGA from "./tga.js";
import { decodePngInWorker, queueCachePut, flushCachePuts, warmStats } from "./buildingIcons.js";

const cache = new Map();
const inflight = new Map();
// Decode each unique source FILE once, ever (2026-07-16): the recruit warm-up
// requests the same unit's card under dozens of faction keys ("all"-ownership
// units × every map owner), and each key resolves to the same TGA. Keys SHARE
// one object URL per file (pathToUrl) — 100k keys cost 100k Map entries, not
// 100k decodes or 100k URLs.
const pathToBlob = new Map(); // resolved path → Blob | "none"
const pathToUrl = new Map();  // resolved path → object URL | "none"
// (cache write-back queue lives in buildingIcons.js — shared via import)

function pixelsToBlob({ width, height, pixels }) {
  const rowMajor = new Uint8ClampedArray(pixels);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(width, height);
  img.data.set(rowMajor);
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b || null), "image/png");
  });
}
function pixelsToBlobUrl(args) {
  return pixelsToBlob(args).then((b) => (b ? URL.createObjectURL(b) : null));
}

export function loadUnitIcon(modDataDir, faction, unitName, dictionary) {
  if (!faction || !unitName) return Promise.resolve(null);
  const key = `${modDataDir || ""}|${faction}|${unitName}`; // dir-aware: vanilla & mod cards don't collide
  if (cache.has(key)) {
    const v = cache.get(key);
    return Promise.resolve(v === "none" ? null : v);
  }
  if (inflight.has(key)) return inflight.get(key);
  const api = window.electronAPI;
  if (!api?.resolveUnitCard) return Promise.resolve(null);
  const p = (async () => {
    try {
      const res = await api.resolveUnitCard(modDataDir, faction, unitName, dictionary);
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

export function getCachedUnitIcon(modDataDir, faction, unitName) {
  if (!faction || !unitName) return null;
  const v = cache.get(`${modDataDir || ""}|${faction}|${unitName}`);
  return v === "none" || !v ? null : v;
}

export function prefetchUnitIcons(modDataDir, triples, onLoaded) {
  for (const triple of triples) {
    const [faction, unitName, dictionary] = triple;
    if (!faction || !unitName) continue;
    const key = `${modDataDir || ""}|${faction}|${unitName}`;
    if (cache.has(key) || inflight.has(key)) continue;
    loadUnitIcon(modDataDir, faction, unitName, dictionary).then(() => { if (onLoaded) onLoaded(); });
  }
}

// BULK warm-up (2026-07-16, splash unit-card pass): resolve a batch of unit
// cards in ONE IPC round-trip and decode them on the shared icon worker pool
// (buildingIcons' pool) — the per-icon IPC hop + main-thread decode is why
// unit cards popped in blank while scrolling. Populates the SAME cache the
// single loader uses, so getCachedUnitIcon/loadUnitIcon see the results.
// Returns the number of icons actually NEWLY requested (0 = all cached), so
// callers can skip redraw bumps on all-cached calls — same contract as
// prefetchBuildingIconsBulk. Falls back to per-icon prefetch without the IPC.
export async function prefetchUnitIconsBulk(modDataDir, triples) {
  const api = window.electronAPI;
  if (!api?.resolveUnitCardsBulk) {
    let fresh = 0;
    await Promise.all(triples.map(([faction, unitName, dictionary]) => {
      if (!faction || !unitName) return null;
      const key = `${modDataDir || ""}|${faction}|${unitName}`;
      if (cache.has(key) || inflight.has(key)) return null;
      fresh += 1;
      return loadUnitIcon(modDataDir, faction, unitName, dictionary);
    }));
    return fresh;
  }
  // Only request icons not already cached/inflight; mark them inflight so a
  // concurrent single-load doesn't duplicate the work.
  const req = [];
  for (const [faction, unitName, dictionary] of triples) {
    if (!faction || !unitName) continue;
    const key = `${modDataDir || ""}|${faction}|${unitName}`;
    if (cache.has(key) || inflight.has(key)) continue;
    const p = new Promise((res) => { req.push({ faction, unit: unitName, dictionary: dictionary || null, key, _resolve: res }); });
    inflight.set(key, p);
  }
  if (req.length === 0) return 0;
  let res;
  try {
    res = await api.resolveUnitCardsBulk(modDataDir, req.map((r) => ({ faction: r.faction, unit: r.unit, dictionary: r.dictionary })));
  } catch {
    res = null;
  }
  // v2 response: { items: (fileIndex|null)[], files: [{path, png?|buffer?}] }
  // — each unique file's bytes arrive ONCE per chunk; png means the
  // persistent cache already had it (no decode needed).
  const files = (res && Array.isArray(res.files)) ? res.files : [];
  const itemIdx = (res && Array.isArray(res.items)) ? res.items : [];
  // One shared object URL per file path, ever.
  const urlForFile = async (f) => {
    if (!f || !f.path) return null;
    if (pathToUrl.has(f.path)) {
      const u = pathToUrl.get(f.path);
      return u === "none" ? null : u;
    }
    let blob = pathToBlob.get(f.path) || null;
    if (!blob) {
      if (f.png) {
        warmStats.unit.cached += 1;
        blob = new Blob([f.png], { type: "image/png" });
      } else if (f.buffer) {
        warmStats.unit.decoded += 1;
        try {
          const workerP = decodePngInWorker(f.buffer);
          if (workerP) {
            const png = await Promise.race([workerP, new Promise((r2) => setTimeout(() => r2(undefined), 4000))]);
            if (png) {
              blob = new Blob([png], { type: "image/png" });
              queueCachePut(f.path, png); // persist for the next launch
            }
          } else {
            let tga = null;
            try { tga = new TGA(new Uint8Array(f.buffer)); } catch { tga = null; }
            if (tga && tga.width && tga.height && tga.pixels) {
              blob = await pixelsToBlob({ width: tga.width, height: tga.height, pixels: tga.pixels });
              if (blob) blob.arrayBuffer().then((ab) => queueCachePut(f.path, ab)).catch(() => {});
            }
          }
        } catch { blob = null; }
      }
      pathToBlob.set(f.path, blob || "none");
    }
    if (blob === "none" || !blob) { pathToUrl.set(f.path, "none"); return null; }
    const url = URL.createObjectURL(blob);
    pathToUrl.set(f.path, url);
    return url;
  };
  const urls = await Promise.all(files.map(urlForFile));
  for (let i = 0; i < req.length; i++) {
    const r = req[i];
    const ix = itemIdx[i];
    const url = (ix != null && ix >= 0) ? urls[ix] : null;
    cache.set(r.key, url || "none");
    inflight.delete(r.key);
    r._resolve(url);
  }
  flushCachePuts();
  return req.length;
}
