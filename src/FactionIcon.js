import React, { useEffect, useState } from "react";
import TGA from "./tga";

// Cache for converted TGA → data URLs so we don't re-read each render
const tgaCache = {};

// Fetch + decode the icon at iconPath (e.g. "faction_icons/romans_julii.tga")
// and populate the module-level tgaCache so a later <FactionIcon> mount renders
// instantly. Call this during splash to preload.
export function preloadIcon(iconPath) {
  const url = (process.env.PUBLIC_URL || "./") + "/" + iconPath;
  if (tgaCache[url]) return Promise.resolve();
  return fetch(url)
    .then(r => r.ok ? r.arrayBuffer() : null)
    .then(buf => { if (buf) decodeTgaToDataUrl(buf, url); })
    .catch(() => {});
}

// Decode a TGA ArrayBuffer to a PNG data URL using canvas. Cached by key.
function decodeTgaToDataUrl(buf, cacheKey) {
  try {
    const arr = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf);
    const tga = new TGA(arr);
    const imageData = tga.getImageData();
    const canvas = document.createElement("canvas");
    canvas.width = tga.width; canvas.height = tga.height;
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    if (cacheKey) tgaCache[cacheKey] = dataUrl;
    return dataUrl;
  } catch { return null; }
}

// Renders a faction icon. Tries mod folder TGA first, falls back to the bundled
// copy (TGA decoded to PNG, or plain PNG if iconPath ends in .png).
export default function FactionIcon({ iconPath, alt = "", size = 84, tightCrop = false, modIconsDir }) {
  const [src, setSrc] = useState(null);
  const bundledUrl = (process.env.PUBLIC_URL || "./") + "/" + iconPath;
  const factionName = iconPath.replace("faction_icons/", "").replace(/\.(png|tga)$/, "");
  const isBundledTga = iconPath.endsWith(".tga");

  useEffect(() => {
    // Bundled fallback: if the faction-specific TGA isn't present, try the
    // generic slave.tga (used by dummy/placeholder factions).
    const bundledSlaveUrl = (process.env.PUBLIC_URL || "./") + "/faction_icons/slave.tga";
    const loadBundledSlave = () => {
      if (tgaCache[bundledSlaveUrl]) { setSrc(tgaCache[bundledSlaveUrl]); return; }
      fetch(bundledSlaveUrl)
        .then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`)))
        .then(buf => setSrc(decodeTgaToDataUrl(buf, bundledSlaveUrl)))
        .catch(() => setSrc(null));
    };

    if (!modIconsDir) {
      // No mod dir → use bundled asset
      if (!isBundledTga) { setSrc(bundledUrl); return; }
      // Bundled TGA — decode once, cache, display as PNG data URL
      if (tgaCache[bundledUrl]) { setSrc(tgaCache[bundledUrl]); return; }
      fetch(bundledUrl)
        .then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`)))
        .then(buf => {
          const dataUrl = decodeTgaToDataUrl(buf, bundledUrl);
          if (dataUrl) setSrc(dataUrl);
          else loadBundledSlave();
        })
        .catch(() => loadBundledSlave());
      return;
    }
    // Normalize path separators
    const dir = modIconsDir.replace(/\\/g, "/");
    const tgaPath = dir + "/" + factionName + ".tga";
    const cacheKey = tgaPath;

    if (tgaCache[cacheKey]) { setSrc(tgaCache[cacheKey]); return; }

    const api = window.electronAPI;
    // Use the generic binary file reader (same one that works for map TGA files)
    const reader = api?.readFactionIcon || api?.readFileBinary;
    if (!reader) { setSrc(bundledUrl); return; }

    reader(tgaPath).then(buf => {
      if (!buf) {
        // Try mod folder's slave.tga; if that's missing, fall back to bundled slave.
        const fallbackPath = dir + "/slave.tga";
        if (tgaCache[fallbackPath]) { setSrc(tgaCache[fallbackPath]); return; }
        reader(fallbackPath).then(fbuf => {
          if (!fbuf) { loadBundledSlave(); return; }
          const dataUrl = decodeTgaToDataUrl(fbuf, fallbackPath);
          if (dataUrl) setSrc(dataUrl);
          else loadBundledSlave();
        }).catch(() => loadBundledSlave());
        return;
      }
      try {
        const arr = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf);
        const tga = new TGA(arr);
        const imageData = tga.getImageData();
        const canvas = document.createElement("canvas");
        canvas.width = tga.width;
        canvas.height = tga.height;
        const ctx = canvas.getContext("2d");
        ctx.putImageData(imageData, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");
        tgaCache[cacheKey] = dataUrl;
        setSrc(dataUrl);
      } catch (e) {
        console.warn("Failed to decode faction icon TGA:", tgaPath, e);
        setSrc(bundledUrl);
      }
    }).catch(() => setSrc(bundledUrl));
  }, [modIconsDir, factionName, bundledUrl, isBundledTga]);

  // No source yet (loading) or failed — show placeholder
  if (!src) return (
    <div style={{ width: size, height: size, borderRadius: 6, background: "rgba(80,80,80,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: size * 0.3, color: "#888" }}>{alt?.[0]?.toUpperCase() || "?"}</span>
    </div>
  );

  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      style={{
        display: "block",
        width: size,
        height: size,
        objectFit: tightCrop ? "cover" : "contain",
        borderRadius: 6,
        background: "transparent"
      }}
      draggable={false}
      onError={() => setSrc(null)}
    />
  );
}