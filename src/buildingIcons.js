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
// Decoded-blob cache keyed by SOURCE FILE PATH (2026-07-15). Icon resolution
// collapses many (culture,level) keys onto the same file (e.g. 20+ cultures
// fall back to the same #roman_*.tga), so the whole-map warm-up was decoding +
// PNG-encoding the identical image dozens of times — the startup bottleneck.
// Decode each unique file ONCE to a Blob here; every cache key that resolves to
// it gets its own object URL from the shared Blob (revoking one key's URL never
// touches the Blob or other keys' URLs, so icon-replace stays correct).
const pathToBlob = new Map(); // resolvedPath → Blob | "none"

// ── Worker pool for off-main-thread icon decode (2026-07-15) ──────────────
// Each worker does the FULL TGA→PNG pipeline (decode + OffscreenCanvas encode)
// off the main thread, so N icons decode in PARALLEL across cores during the
// startup warm-up instead of the single main thread doing all ~900 serially
// (the startup icon-lag). Falls back to main-thread decode if workers can't be
// created (older/edge environments).
// Pool width (2026-07-16, "use more cores at launch"): cores-2 leaves the
// main/renderer threads breathing room, capped at 12 — beyond that the IPC
// fetch side becomes the bottleneck, not decode. Old cap of 6 left half a
// modern CPU idle during the splash warm-up.
const _ICON_WORKER_COUNT = Math.min(12, Math.max(2, ((typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4) - 2));
let _iconWorkers = null;      // Worker[] | null(=use main thread)
let _iconWorkersTried = false;
let _iconRR = 0;              // round-robin index
let _iconReqId = 0;
const _iconPending = new Map(); // reqId → resolve(pngArrayBuffer | null)

function ensureIconWorkers() {
  if (_iconWorkersTried) return _iconWorkers;
  _iconWorkersTried = true;
  try {
    if (typeof Worker !== "function" || typeof OffscreenCanvas === "undefined") {
      console.log(`[icon-workers] main-thread fallback (Worker=${typeof Worker}, OffscreenCanvas=${typeof OffscreenCanvas})`);
      return (_iconWorkers = null);
    }
    const url = ((import.meta.env && import.meta.env.BASE_URL) || "") + "/icon-decode-worker.js";
    const ws = [];
    for (let i = 0; i < _ICON_WORKER_COUNT; i++) {
      const w = new Worker(url);
      w.onmessage = (ev) => {
        const { id, ok, png } = ev.data || {};
        const r = _iconPending.get(id);
        if (!r) return;
        _iconPending.delete(id);
        r(ok && png ? png : null);
      };
      w.onerror = (e) => { console.warn("[icon-workers] worker error:", e && (e.message || e.filename || "?")); };
      ws.push(w);
    }
    console.log(`[icon-workers] decode pool: ${ws.length} workers`);
    _iconWorkers = ws;
  } catch (e) { console.warn("[icon-workers] pool creation FAILED → main thread:", e && e.message); _iconWorkers = null; }
  return _iconWorkers;
}

// Decode a TGA ArrayBuffer to a PNG ArrayBuffer on a pool worker. The buffer is
// TRANSFERRED (zero-copy). Resolves null on decode failure. Returns null
// synchronously if no worker pool (caller then decodes on the main thread).
// Exported for unitIcons' bulk warm-up (2026-07-16) — one shared pool.
export function decodePngInWorker(buffer) {
  const ws = ensureIconWorkers();
  if (!ws) return null;
  const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const id = ++_iconReqId;
  const w = ws[_iconRR++ % ws.length];
  return new Promise((resolve) => {
    _iconPending.set(id, resolve);
    try { w.postMessage({ id, buffer: ab }, [ab]); }
    catch (e) { console.warn("[icon-workers] postMessage failed:", e && e.message); _iconPending.delete(id); resolve(null); }
  });
}

function pixelsToBlob({ width, height, pixels }) {
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
    canvas.toBlob((b) => resolve(b || null), "image/png");
  });
}

function pixelsToBlobUrl(args) {
  return pixelsToBlob(args).then((b) => (b ? URL.createObjectURL(b) : null));
}

// Get the icon URL for a building level. Returns a blob URL, or null if
// the icon isn't available. Resolves asynchronously; caller should re-render
// when the promise settles.
export function loadBuildingIcon(modDataDir, culture, levelName, chainName) {
  if (!culture || !levelName) return Promise.resolve(null);
  const key = `${modDataDir || ""}|${culture}|${levelName}`; // dir-aware: vanilla & mod icons don't collide
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
        // Log culture + chain + level so missing icons can be identified
        // and the real TGA path provided instead of a fallback.
        console.log("[buildingIcons] MISSING ICON:", culture, "/", chainName || "?", "/", levelName);
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

export function getCachedBuildingIcon(modDataDir, culture, levelName) {
  if (!culture || !levelName) return null;
  const v = cache.get(`${modDataDir || ""}|${culture}|${levelName}`);
  return v === "none" || !v ? null : v;
}

// Invalidate a single cache slot so the next loadBuildingIcon() refetches
// from main.js — used after a dev-mode icon replacement so the new TGA
// shows up immediately. Revokes the prior blob URL so we don't leak.
export function invalidateBuildingIcon(modDataDir, culture, levelName) {
  if (!culture || !levelName) return;
  const key = `${modDataDir || ""}|${culture}|${levelName}`;
  const v = cache.get(key);
  if (v && v !== "none") {
    try { URL.revokeObjectURL(v); } catch {}
  }
  cache.delete(key);
  inflight.delete(key);
}

export function prefetchBuildingIcons(modDataDir, triples, onLoaded) {
  // triples: [culture, level, chainName?][]
  for (const t of triples) {
    const [culture, level, chainName] = t;
    if (!culture || !level) continue;
    const key = `${modDataDir || ""}|${culture}|${level}`;
    if (cache.has(key) || inflight.has(key)) continue;
    loadBuildingIcon(modDataDir, culture, level, chainName).then(() => {
      if (onLoaded) onLoaded();
    });
  }
}

// BULK warm-up (2026-07-15): resolve a batch of icons in ONE IPC round-trip
// (resolveBuildingIconsBulk) instead of one call each — the per-icon IPC hop
// was the startup bottleneck when warming ~900 settlement icons. Decodes each
// returned TGA buffer to a blob URL and populates the SAME cache the single
// loader uses, so getCachedBuildingIcon/loadBuildingIcon see the results.
// Returns a Promise resolving to the number of icons that were actually
// NEWLY requested (0 when everything was already cached/in flight) — callers
// use this to skip redraw-triggering state bumps on all-cached calls; an
// unconditional bump from getBuildings' render-path prefetch was a perpetual
// re-render loop (2026-07-16 "map lock-up" hunt). `onEach` is called once per
// icon settled (for progress). Falls back to per-icon prefetch if the bulk
// IPC isn't available (older main process).
export async function prefetchBuildingIconsBulk(modDataDir, triples, onEach) {
  const api = window.electronAPI;
  if (!api?.resolveBuildingIconsBulk) {
    // Fallback: fan out to the single loader.
    const fresh = triples.filter(([culture, level]) =>
      culture && level && !cache.has(`${modDataDir || ""}|${culture}|${level}`)).length;
    await Promise.all(triples.map(([culture, level, chainName]) =>
      loadBuildingIcon(modDataDir, culture, level, chainName).then(() => { if (onEach) onEach(); })));
    return fresh;
  }
  // Only request icons not already cached/inflight; mark them inflight so a
  // concurrent single-load doesn't duplicate the work.
  const req = [];
  for (const [culture, level, chain] of triples) {
    if (!culture || !level) continue;
    const key = `${modDataDir || ""}|${culture}|${level}`;
    if (cache.has(key) || inflight.has(key)) continue;
    const p = new Promise((res) => { req.push({ culture, level, chain, key, _resolve: res }); });
    inflight.set(key, p);
  }
  if (req.length === 0) return 0;
  let res;
  try {
    res = await api.resolveBuildingIconsBulk(modDataDir, req.map((r) => ({ culture: r.culture, level: r.level, chain: r.chain || null })));
  } catch {
    res = null;
  }

  // Decode each UNIQUE source file once (pathToBlob), then assign every key
  // that resolves to it its own object URL — so the identical roman-fallback
  // art isn't decoded/encoded 20× across cultures. Returns the shared Blob (or
  // "none") for a path, decoding on first sight.
  const decodePath = async (srcPath, buffer) => {
    if (srcPath && pathToBlob.has(srcPath)) return pathToBlob.get(srcPath);
    let out = "none";
    try {
      const workerP = decodePngInWorker(buffer); // null if no pool → main-thread path
      if (workerP) {
        // OFF-THREAD: worker decodes TGA + encodes PNG in parallel with others.
        const png = await Promise.race([workerP, new Promise((r2) => setTimeout(() => r2(undefined), 4000))]);
        if (png) out = new Blob([png], { type: "image/png" });
        // png === null (worker decode failed) or undefined (timeout) → "none"
      } else {
        // MAIN-THREAD fallback (no OffscreenCanvas/Worker support).
        let tga = null;
        try { tga = new TGA(new Uint8Array(buffer)); } catch { tga = null; }
        if (tga && tga.width && tga.height && tga.pixels) {
          const blob = await Promise.race([
            pixelsToBlob({ width: tga.width, height: tga.height, pixels: tga.pixels }),
            new Promise((r2) => setTimeout(() => r2(null), 3000)),
          ]);
          out = blob || "none";
        }
      }
    } catch { out = "none"; }
    if (srcPath) pathToBlob.set(srcPath, out);
    return out;
  };

  // Group req items by resolved path so each unique file decodes once even
  // within this batch.
  const byPath = new Map(); // path → { buffer, items: [req] }
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

  await Promise.all([...byPath.entries()].map(async ([srcPath, g]) => {
    const blob = await decodePath(srcPath, g.buffer);
    for (const r of g.items) {
      const url = blob === "none" ? "none" : URL.createObjectURL(blob);
      cache.set(r.key, url);
      inflight.delete(r.key);
      r._resolve(url === "none" ? null : url);
      if (onEach) onEach();
    }
  }));
  for (const r of noArt) {
    cache.set(r.key, "none");
    inflight.delete(r.key);
    r._resolve(null);
    if (onEach) onEach();
  }
  return req.length;
}
