// Which window this renderer is: the main window, or the second map window
// (main.js createWindow("map"); the preload reads the flag from argv).
//
// Both windows share one localStorage (same file:// origin), and the app keeps
// its map mode, overlays and panel positions there. Left alone, switching the
// map mode on one screen would rewrite the other's saved settings. So the map
// window gets a copy-on-write view: it READS the main window's values until it
// sets its own, and everything it writes goes under its own prefix. It opens
// looking like the main window and remembers its own choices from then on.
//
// Imported FIRST in index.js, so the swap is in place before any module reads
// localStorage at load time.

export const WINDOW_ROLE = (typeof window !== "undefined" && window.electronAPI?.windowRole) || "main";
export const IS_MAP_WINDOW = WINDOW_ROLE === "map";

export const MAP_STORAGE_PREFIX = "provincia.map2:";
const REMOVED = "\u0000removed";

// Which campaign is loaded, where it was imported from, and which game folders
// live mode reads belong to the MAIN window: the map window follows them and
// its own writes to them are dropped (each launch re-stamps lastImport_*, and
// a copy would pin the map window to an old import).
export const isSharedKey = (k) =>
  k.startsWith("lastImport_") || k === "mapCampaign" || k === "importedCampaign" ||
  k === "liveLogDir" || k === "liveSaveDir";

export function createOverlayStorage(real, prefix = MAP_STORAGE_PREFIX) {
  const own = (k) => prefix + String(k);
  const keys = () => {
    const out = new Set();
    for (let i = 0; i < real.length; i++) {
      const k = real.key(i);
      if (k == null) continue;
      if (k.startsWith(prefix)) {
        const base = k.slice(prefix.length);
        if (real.getItem(k) === REMOVED) out.delete(base); else out.add(base);
      } else if (real.getItem(own(k)) !== REMOVED) {
        out.add(k);
      }
    }
    return [...out];
  };
  return {
    getItem(k) {
      const v = real.getItem(own(k));
      if (v === REMOVED) return null;
      return v !== null ? v : real.getItem(String(k));
    },
    setItem(k, v) {
      if (isSharedKey(String(k))) return;
      const val = String(v);
      // The app re-persists every setting on mount. Writing what the main
      // window already has keeps NO copy, so the key goes on following the
      // main window (and big caches aren't stored twice).
      if (real.getItem(String(k)) === val) { real.removeItem(own(k)); return; }
      real.setItem(own(k), val);
    },
    removeItem(k) {
      if (isSharedKey(String(k))) return;
      // A tombstone, so the main window's value doesn't show through again.
      if (real.getItem(String(k)) !== null) real.setItem(own(k), REMOVED);
      else real.removeItem(own(k));
    },
    // Clears the map window's own settings only; it then mirrors the main window.
    clear() {
      const mine = [];
      for (let i = 0; i < real.length; i++) {
        const k = real.key(i);
        if (k && k.startsWith(prefix)) mine.push(k);
      }
      mine.forEach((k) => real.removeItem(k));
    },
    key(i) { const all = keys(); return i >= 0 && i < all.length ? all[i] : null; },
    get length() { return keys().length; },
  };
}

if (IS_MAP_WINDOW) {
  try {
    const overlay = createOverlayStorage(window.localStorage);
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => overlay });
  } catch (e) {
    // Without the swap the map window still works; its settings are then shared.
    console.warn("[map-window] localStorage overlay failed:", e && e.message);
  }
}
