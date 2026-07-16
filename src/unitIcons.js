// src/unitIcons.js
//
// Lazy loader + cache for unit portraits pulled from the mod/game install.
// Small square cards live at `data/ui/units/<faction>/#<unit>.tga`; the
// larger info-panel variant at `data/ui/unit_info/<faction>/<unit>_info.tga`.
// main.js's resolve-unit-card IPC handles both with the same lookup.

"use strict";

import TGA from "./tga.js";
import { decodePngInWorker } from "./buildingIcons.js";

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
  // Decode each unique source file once (aliased factions share card files),
  // then give every key its own object URL.
  const byPath = new Map(); // path → { buffer, items }
  const noArt = [];
  for (let i = 0; i < req.length; i++) {
    const item = res && res[i];
    const r = req[i];
    if (item && item.buffer && item.path) {
      let g = byPath.get(item.path);
      if (!g) { g = { buffer: item.buffer, items: [] }; byPath.set(item.path, g); }
      g.items.push(r);
    } else {
      noArt.push(r);
    }
  }
  const decodeOne = async (buffer) => {
    try {
      const workerP = decodePngInWorker(buffer);
      if (workerP) {
        const png = await Promise.race([workerP, new Promise((r2) => setTimeout(() => r2(undefined), 4000))]);
        return png ? new Blob([png], { type: "image/png" }) : null;
      }
      // Main-thread fallback (no Worker/OffscreenCanvas support).
      let tga = null;
      try { tga = new TGA(new Uint8Array(buffer)); } catch { tga = null; }
      if (!tga || !tga.width || !tga.height || !tga.pixels) return null;
      const url = await pixelsToBlobUrl({ width: tga.width, height: tga.height, pixels: tga.pixels });
      return url ? { __url: url } : null; // already a URL on this path
    } catch { return null; }
  };
  await Promise.all([...byPath.values()].map(async (g) => {
    const blob = await decodeOne(g.buffer);
    for (const r of g.items) {
      const url = blob ? (blob.__url || URL.createObjectURL(blob)) : null;
      cache.set(r.key, url || "none");
      inflight.delete(r.key);
      r._resolve(url || null);
    }
  }));
  for (const r of noArt) {
    cache.set(r.key, "none");
    inflight.delete(r.key);
    r._resolve(null);
  }
  return req.length;
}
