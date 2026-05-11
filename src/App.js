import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import RegionInfo, { setBuildingsGetter } from "./RegionInfo";
import { loadBuildingIcon, getCachedBuildingIcon, prefetchBuildingIcons } from "./buildingIcons";
import { getCachedUnitIcon, prefetchUnitIcons } from "./unitIcons";
import InfoPopup from "./InfoPopup";
import FactionIcon, { preloadIcon, preloadModIcon } from "./FactionIcon";
import Tooltip from "./Tooltip";
import "./App.css";
import CustomScrollArea from "./CustomScrollArea";
import "./CustomScrollArea.css";
import TGA from "./tga";
import WelcomeScreen from "./WelcomeScreen";
import UpdateBanner from "./UpdateBanner";
import Toasts from "./Toasts";
import MuteButton from "./MuteButton";
import {
  parseSmFactions,
  parseDescrRegions,
  parseDescrStratFactions,
  parseDescrStratBuildings,
  parseDescrStratResources,
  parseDescrStratArmies,
} from "./parsers";

// Layout constants
const MAP_PADDING = 6;
const PANELS_GAP = 6;
const PANEL_WIDTH = 220;
// Shrinks the map canvas horizontally to free space for the right sidebar
// (Resources panel, Factions tiles, search). Tuned for 1920px default.
const MAP_WIDTH_ADJUST = 120;
const REGIONINFO_HEIGHT = 320;
const ICON_SIZE = 72;
const ICON_GAP = 3;
const ICON_SIDE_PAD = 0;
const SCROLLBAR_GUTTER = 0;
const RIGHT_MIN_WIDTH = 220;
const ICON_DROP_SHADOW =
  "drop-shadow(0 0 1.25px rgba(0,0,0,0.85)) drop-shadow(0 0 2.5px rgba(0,0,0,0.45))";
const SPLASH_MIN_MS = 800;   // tiny floor so splash is briefly visible even on fast loads
const SPLASH_HARD_MAX_MS = 30000; // safety cap if something gets wedged
const THUMB_MIN_PX = Math.round(ICON_SIZE * 0.46);
const SCROLL_SKIN = {
  img: (import.meta.env.BASE_URL || "./") + "/feral_slider_composite.png",
  track: { x: 38, y: 3, w: 21, h: 296 },
  thumb: { x: 341, y: 108, w: 19, h: 84 },
};

// Map variants (kept for localStorage compat but victory is now a colorMode)
const MAP_VARIANTS = {
  starting: { key: "starting", label: "Start" },
};

// Campaign slots — two slots with fixed output file names. Labels are overridden
// at runtime when the user imports a campaign folder.
const DEFAULT_CAMPAIGNS = {
  classic: {
    key: "classic",
    label: "Classic",
    mapFile: "map_regions_classic.tga",
    mapType: "tga",
    mapHeight: 350,
    regionsFile: "regions_classic.json",
    factionsFile: "factions_with_regions_classic.json",
    buildingsFile: "descr_strat_buildings_classic.json",
    winConditionsFile: "descr_win_conditions_classic.txt",
    resourcesFile: "resources_classic.json",
    populationFile: "population_classic.json",
    armiesFile: "armies_classic.json",
  },
  imperial: {
    key: "imperial",
    label: "Imperial Campaign",
    mapFile: "map_regions_large.tga",
    mapType: "tga",
    mapHeight: 700,
    regionsFile: "regions_large.json",
    factionsFile: "factions_with_regions_large.json",
    buildingsFile: "descr_strat_buildings_large.json",
    winConditionsFile: "descr_win_conditions_large.txt",
    resourcesFile: "resources_large.json",
    populationFile: "population_large.json",
    armiesFile: "armies_large.json",
  },
};

// Pretty-print a campaign folder name for display
function formatCampaignName(folderName) {
  return folderName
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function useSystemDarkMode() {
  useEffect(() => {
    const applyTheme = () => {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.body.classList.toggle("dark-mode", isDark);
    };
    applyTheme();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", applyTheme);
    return () => mq.removeEventListener("change", applyTheme);
  }, []);
}
function usePrefersDark() {
  const [isDark, setIsDark] = useState(
    typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => setIsDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDark;
}

// Light-mode contrast fix. The renderer is full of inline `style={{color: "#eee"}}`
// values chosen for the dark theme; on the light parchment surface they read as
// glare. CSS attribute selectors can't catch them because Chromium normalises
// the `style` attribute to `rgb(...)` after React sets it. This hook walks every
// .panel descendant whenever the DOM mutates inside a panel and overrides
// bright inline colours to a near-black, while remembering the original so we
// can restore on dark-mode switch. Saturated accents (gold, faction colours,
// status reds/greens) are left alone — relative-luminance gate.
function useLightModePanelContrast(isDark) {
  useEffect(() => {
    const fix = () => {
      const dark = document.body.classList.contains("dark-mode");
      const panels = document.querySelectorAll(".panel, .panel *");
      for (const el of panels) {
        // Dark-mode restore must run BEFORE the luminance gate. We set the
        // override colour to rgb(26,26,26) in light mode; that's lum=26 which
        // would fail the >130 check below and leave dark text frozen on
        // dark-mode entry. So: in dark mode, if a saved colour exists, just
        // pop it back unconditionally and skip further processing.
        if (dark) {
          if (el.dataset.savedColor) {
            el.style.color = el.dataset.savedColor;
            delete el.dataset.savedColor;
          }
          continue;
        }
        const inline = el.style?.color;
        if (!inline) continue;
        const m = inline.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (!m) continue;
        const r = +m[1], g = +m[2], b = +m[3];
        // Skip saturated (chromatic) colours — only catch greys / off-whites.
        const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
        if (maxC - minC > 35) continue; // chromatic accent — leave alone
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < 130) continue; // already dark — nothing to do
        // Light mode: save original (if we haven't yet) and force near-black.
        if (!el.dataset.savedColor) el.dataset.savedColor = inline;
        if (el.style.color !== "rgb(26, 26, 26)") el.style.color = "#1a1a1a";
      }
    };
    fix();
    // React re-renders panels often (selection, hover, garrison updates, etc.);
    // a MutationObserver scoped to body subtree catches new nodes / inline
    // style changes without us having to thread state into every component.
    const obs = new MutationObserver(fix);
    obs.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ["style", "class"],
    });
    return () => obs.disconnect();
  }, [isDark]);
}

// Lazy singleton TGA worker — spins up on first use, kept alive for campaign switches.
// Falls back to main-thread TGA decoding if worker construction fails (old browsers,
// CSP quirks, etc.). Returns { width, height, data: Uint8ClampedArray }.
let _tgaWorker = null;
let _tgaWorkerMissing = false;
let _tgaReqId = 0;
const _tgaPending = new Map();
async function decodeTgaAsync(buffer) {
  if (!_tgaWorker && !_tgaWorkerMissing) {
    try {
      const url = (import.meta.env.BASE_URL || "") + "/tga-worker.js";
      _tgaWorker = new Worker(url);
      _tgaWorker.onmessage = (ev) => {
        const { id, ok, width, height, pixels, error } = ev.data || {};
        const p = _tgaPending.get(id);
        if (!p) return;
        _tgaPending.delete(id);
        if (ok) p.resolve({ width, height, data: new Uint8ClampedArray(pixels) });
        else p.reject(new Error(error || "worker decode failed"));
      };
      _tgaWorker.onerror = (ev) => {
        _tgaWorkerMissing = true;
        for (const p of _tgaPending.values()) p.reject(new Error(ev.message || "worker error"));
        _tgaPending.clear();
      };
    } catch {
      _tgaWorkerMissing = true;
    }
  }
  if (_tgaWorkerMissing || !_tgaWorker) {
    // Fallback: synchronous decode on main thread
    const tga = new TGA(new Uint8Array(buffer));
    const d = tga.getImageData();
    return { width: tga.width, height: tga.height, data: d.data };
  }
  const id = ++_tgaReqId;
  return new Promise((resolve, reject) => {
    _tgaPending.set(id, { resolve, reject });
    // Transfer the buffer to avoid copying 10 MB+ on large TGAs
    const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    _tgaWorker.postMessage({ id, buffer: ab }, [ab]);
  });
}

async function loadText(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (err) {
    try {
      const w = window;
      if (w && w.process?.versions?.electron && w.require) {
        const fs = w.require("fs");
        const resolved = new URL(url, window.location.href);
        let filePath = decodeURIComponent(resolved.pathname || "");
        if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1);
        return fs.readFileSync(filePath, "utf8");
      }
    } catch {}
    throw err;
  }
}

// Explicit overrides for buildings whose level name doesn't match any icon filename
const SPECIAL_ICON_MAP = {
  "capital_treasury|treasury":       ["#roman_market"],
  "capital_treasury|large_treasury": ["#roman_forum"],
  "capital_treasury|great_treasury": ["#roman_great_forum"],
  "garrison|garrison":               ["#roman_army_barracks"],
  "forest_pastoralism|forest_grazing": ["#roman_agroforestry_1"],
  "nomadic_pastoralism|nomadic_herding":      ["#roman_herds"],
  "nomadic_pastoralism|collective_draw_rights": ["#roman_herds"],
  "dates_cultivation|dates_1":       ["#roman_rotational_grove_fields"],
};

// Priority-ordered candidates: prefer #roman_<level>, then #<level>, then roman_<level>, <level>,
// then the type+level variants, then type-only variants, with # and roman prefixes.
function guessIconNames(type, level) {
  const safe = (s) => (s || "").toString().trim().toLowerCase();
  const t = safe(type);
  const l = safe(level);
  const key = `${t}|${l}`;

  if (SPECIAL_ICON_MAP[key]) return [...SPECIAL_ICON_MAP[key]];

  const variants = [];

  if (l) {
    variants.push(`#roman_${l}`, `#${l}`, `roman_${l}`, `${l}`);
  }
  if (t && l) {
    variants.push(`#roman_${t}_${l}`, `#${t}_${l}`, `roman_${t}_${l}`, `${t}_${l}`);
  }
  if (t) {
    variants.push(`#roman_${t}`, `#${t}`, `roman_${t}`, `${t}`);
  }

  // de-dup while preserving order
  return variants.filter((v, i) => variants.indexOf(v) === i);
}

function prerenderBorderPaths(regions, offscreen, imgSize) {
  const borderPaths = {};
  const coastalRegions = new Set();
  if (!offscreen || !regions) return { borderPaths, coastalRegions };

  const ctxOff = offscreen.getContext("2d", { willReadFrequently: true });
  const data = ctxOff.getImageData(0, 0, imgSize.width, imgSize.height).data;
  const W = imgSize.width;
  const H = imgSize.height;

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // Pass 1: collect border pixel positions per region
  const borderSets = {}; // key → Set<"x,y">

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const isWhite = r === 255 && g === 255 && b === 255;
      const key = `${r},${g},${b}`;

      // White pixel (harbor): belongs to the adjacent region's border
      if (isWhite) {
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = (ny * W + nx) * 4;
          const nKey = `${data[ni]},${data[ni + 1]},${data[ni + 2]}`;
          if (regions[nKey]) {
            if (!borderSets[nKey]) borderSets[nKey] = new Set();
            borderSets[nKey].add(`${x},${y}`);
            coastalRegions.add(nKey);
            break;
          }
        }
        continue;
      }

      if (!regions[key]) continue;

      // Border detection: is this region pixel on the outer edge?
      let isBorder = false;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { isBorder = true; break; }
        const ni = (ny * W + nx) * 4;
        const nr = data[ni], ng = data[ni + 1], nb = data[ni + 2];
        if (nr === r && ng === g && nb === b) continue; // same region
        if (nr === 0 && ng === 0 && nb === 0) {
          // Black: look through — city marker (same region behind) vs real border
          for (const [dx2, dy2] of DIRS) {
            if (dx2 === -dx && dy2 === -dy) continue;
            const mx = nx + dx2, my = ny + dy2;
            if (mx < 0 || my < 0 || mx >= W || my >= H) continue;
            const mi = (my * W + mx) * 4;
            const mr = data[mi], mg = data[mi + 1], mb = data[mi + 2];
            if (mr === r && mg === g && mb === b) continue;
            isBorder = true; break;
          }
        } else {
          isBorder = true;
        }
        if (isBorder) break;
      }

      if (isBorder) {
        if (!borderSets[key]) borderSets[key] = new Set();
        borderSets[key].add(`${x},${y}`);
      }
    }
  }

  // Pass 2: build Path2D — only draw the edge of a border pixel that faces OUTWARD
  // (i.e. the neighbor on that side is not part of the same region)
  for (const key of Object.keys(borderSets)) {
    const set = borderSets[key];
    const [rr, rg, rb] = key.split(",").map(Number);
    const path = new Path2D();

    const isOuter = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return true; // map edge
      const ni = (ny * W + nx) * 4;
      const nr = data[ni], ng = data[ni + 1], nb = data[ni + 2];
      if (nr === rr && ng === rg && nb === rb) return false; // same region color → inner
      if (nr === 255 && ng === 255 && nb === 255 && set.has(`${nx},${ny}`)) return false; // harbor of same region → inner
      return true;
    };

    for (const pos of set) {
      const comma = pos.indexOf(",");
      const x = +pos.slice(0, comma);
      const y = +pos.slice(comma + 1);
      if (isOuter(x, y - 1)) { path.moveTo(x,     y);     path.lineTo(x + 1, y); }
      if (isOuter(x, y + 1)) { path.moveTo(x,     y + 1); path.lineTo(x + 1, y + 1); }
      if (isOuter(x - 1, y)) { path.moveTo(x,     y);     path.lineTo(x,     y + 1); }
      if (isOuter(x + 1, y)) { path.moveTo(x + 1, y);     path.lineTo(x + 1, y + 1); }
    }
    borderPaths[key] = path;
  }

  return { borderPaths, coastalRegions };
}

// Build a single Path2D tracing every edge where culture changes (or hits sea/edge).
// Black border pixels are looked through so same-culture provinces don't get a thick border.
function prerenderGroupBorderPath(regions, offscreen, imgSize, classify) {
  const ctxOff = offscreen.getContext("2d", { willReadFrequently: true });
  const data = ctxOff.getImageData(0, 0, imgSize.width, imgSize.height).data;
  const W = imgSize.width, H = imgSize.height;
  const total = W * H;

  // Pass 1: build a numeric group ID per pixel (0 = no group)
  // This avoids repeated string creation and object lookups in the border scan
  const rgbToGroup = {};  // "r,g,b" → groupId (1-based)
  const groupNames = [null]; // index 0 = no group
  let nextId = 1;
  const groupGrid = new Uint16Array(total);

  for (let idx = 0; idx < total; idx++) {
    const i = idx * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = (r << 16) | (g << 8) | b;
    if (rgbToGroup[key] !== undefined) {
      groupGrid[idx] = rgbToGroup[key];
      continue;
    }
    const rgbStr = `${r},${g},${b}`;
    const reg = regions[rgbStr];
    if (!reg) { rgbToGroup[key] = 0; continue; }
    const group = classify(reg, rgbStr);
    if (!group) { rgbToGroup[key] = 0; continue; }
    // Check if this group name already has an ID
    let gid = groupNames.indexOf(group);
    if (gid === -1) { gid = nextId++; groupNames.push(group); }
    rgbToGroup[key] = gid;
    groupGrid[idx] = gid;
  }

  // Resolve black pixels (0,0,0) — look through to neighbour
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const i = idx * 4;
      if (data[i] !== 0 || data[i+1] !== 0 || data[i+2] !== 0) continue;
      // Try all 4 directions to find a real region behind
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      for (const [dx,dy] of dirs) {
        const nx = x+dx, ny = y+dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) {
          const nid = groupGrid[ny * W + nx];
          if (nid > 0) { groupGrid[idx] = nid; break; }
        }
      }
    }
  }

  // Pass 2: scan for borders using the numeric grid (very fast — no string ops)
  const path = new Path2D();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const g = groupGrid[y * W + x];
      if (g === 0) continue;
      const top    = y > 0     ? groupGrid[(y-1)*W+x] : 0;
      const bottom = y < H-1   ? groupGrid[(y+1)*W+x] : 0;
      const left   = x > 0     ? groupGrid[y*W+(x-1)] : 0;
      const right  = x < W-1   ? groupGrid[y*W+(x+1)] : 0;
      if (top    !== g) { path.moveTo(x, y);     path.lineTo(x+1, y); }
      if (bottom !== g) { path.moveTo(x, y+1);   path.lineTo(x+1, y+1); }
      if (left   !== g) { path.moveTo(x, y);     path.lineTo(x, y+1); }
      if (right  !== g) { path.moveTo(x+1, y);   path.lineTo(x+1, y+1); }
    }
  }

  return path;
}

function prerenderCultureBorderPath(regions, offscreen, imgSize) {
  return prerenderGroupBorderPath(regions, offscreen, imgSize, (r) => r.culture);
}

// Parse victory conditions file
function parseVictoryConditions(text) {
  const lines = text.split(/\r?\n/);
  const result = {};
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("hold_regions")) {
      if (!current) continue;
      const parts = line.replace("hold_regions", "").trim().split(/[\s,]+/).filter(Boolean);
      result[current].hold_regions = parts;
    } else if (line.startsWith("take_regions")) {
      if (!current) continue;
      const num = parseInt(line.replace("take_regions", "").trim(), 10);
      result[current].take_regions = isNaN(num) ? null : num;
    } else {
      current = line;
      result[current] = { hold_regions: [], take_regions: null };
    }
  }
  return result;
}

// Move helper for reordering lists
function moveAtIndex(list, from, to) {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// Resource colors — one distinct color per resource type
const RESOURCE_COLORS = {
  grain:        [230,200, 60], sheep:        [200,220,160], livestock:    [190,160, 90],
  fish:         [ 80,160,220], wine:         [180, 60,120], olive_oil:    [200,200, 80],
  timber:       [100,160, 80], iron:         [140,150,160], gold:         [240,190, 40],
  silver:       [200,210,220], copper:       [190,130, 60], stone:        [170,170,160],
  marble:       [230,230,240], salt:         [220,230,240], honey:        [230,170, 40],
  fruits:       [230,110, 80], spices:       [210, 90, 40], perfumes:     [200,120,200],
  purple_dye:   [140, 60,180], dyes:         [100, 80,200], silk:         [230,160,210],
  cotton:       [240,240,220], flax:         [160,200,120], hemp:         [120,180, 90],
  papyrus:      [190,210,100], amber:        [210,160, 60], gemstones:    [100,180,220],
  glass:        [140,210,230], pottery:      [200,130, 80], pitch:        [ 80, 80, 80],
  coal:         [ 60, 60, 70], sulphur:      [200,200, 50], lead:         [150,150,170],
  tin:          [170,180,190], horses:       [180,120, 70], camels:       [200,160, 90],
  elephants:    [ 90,120, 90], wild_animals: [120, 90, 60], incense:      [210,170,100],
  dates:        [210,160, 60], slave_trade:  [100, 60, 60], slaves:       [ 80, 50, 50],
};

// Religion colors — one per faith
const RELIGION_COLORS = {
  // Greek family — blues
  macedonian:       [  55, 85,185], dorian:           [  80,120,200], ionian:           [ 100,150,220],
  aeolian:          [ 120,160,210], arcadian:         [  90,140,210], epirote:          [  80,100,180],
  northwest_greek:  [  80,130,200], greco_bactrian:   [  55,110,165], indo_greek:       [ 100,130,175],
  bithynian:        [ 110,140,180], cypriot_greek:    [  80,140,205], pamphylian_greek: [  90,150,215],
  // Celtic — vivid forest green; Germanic — amber harvest (clearly distinct)
  celtic:           [  45,185, 75], germanic:         [ 200,155, 45],
  // Baltic/Norse — teal-cyan (cold, northern)
  baltic:           [  55,165,155],
  // Italic/Roman — warm orange
  italic:           [ 205,120, 55],
  // Iberian — earthy brown
  iberian:          [ 160,100, 60],
  // Illyrian/Balkan group
  illyrian:         [ 100,145,120], liburnian:        [  65,145,185],
  delmato_pannonian:[ 145, 65, 85], triballian:       [ 110, 60, 80],
  paeonian:         [ 145, 75,110], dardanian:        [ 120, 80, 50],
  // Thracian — strong red
  thracian:         [ 190, 55, 75],
  // Steppe/Nomadic — purples (distinct shades)
  scythian:         [ 130, 75,160], bosporan:         [ 160, 75,210],
  venetic:          [ 125,110,165],
  // Middle Eastern
  phoenician:       [ 130, 50,170], // Tyrian purple
  arab:             [ 215,170, 50], assyrian:         [ 160, 90, 50],
  mesopotamian:     [ 170,120, 60], judaean:          [ 170,165, 65],
  libyan:           [ 205,185, 75],
  // Egyptian/African
  egyptian:         [ 215,180, 55], ethiopian:        [ 140, 75, 55],
  // Iranian/Caucasian
  iranian:          [ 185,100, 40], armenian:         [ 185, 65, 65],
  caucasian:        [ 130, 90, 50],
  // Indian subcontinent
  indian:           [ 195,130, 50],
  // Anatolian group
  phrygian:         [ 175,100,145], cappadocian:      [ 160,110, 80],
  paphlagonian:     [ 140, 85,140], mysian:           [ 145,130,100],
  lydian:           [ 195,155, 65], carian:           [ 165, 85,100],
  lycian:           [ 110,175,150], pisidian:         [ 150,100, 80],
  lycaonian:        [ 115,155, 80], pamphylian:       [  95,165,175],
  cilician:         [ 120,100,155], isaurian:         [ 145,110, 90],
};

const RELIGION_GROUPS = {
  "Greek": ["macedonian", "dorian", "ionian", "aeolian", "arcadian", "epirote", "northwest_greek", "greco_bactrian", "indo_greek", "bithynian", "cypriot_greek", "pamphylian_greek"],
  "Celtic & Germanic": ["celtic", "germanic", "baltic"],
  "Italic": ["italic"],
  "Iberian": ["iberian"],
  "Illyrian / Balkan": ["illyrian", "liburnian", "delmato_pannonian", "triballian", "paeonian", "dardanian"],
  "Thracian": ["thracian"],
  "Steppe / Nomadic": ["scythian", "bosporan", "venetic"],
  "Middle Eastern": ["phoenician", "arab", "assyrian", "mesopotamian", "judaean", "libyan"],
  "Egyptian / African": ["egyptian", "ethiopian"],
  "Iranian / Caucasian": ["iranian", "armenian", "caucasian"],
  "Indian": ["indian"],
  "Anatolian": ["phrygian", "cappadocian", "paphlagonian", "mysian", "lydian", "carian", "lycian", "pisidian", "lycaonian", "pamphylian", "cilician", "isaurian"],
};
// Build reverse lookup: religion → group name
const RELIGION_TO_GROUP = {};
for (const [group, rels] of Object.entries(RELIGION_GROUPS)) {
  for (const r of rels) RELIGION_TO_GROUP[r] = group;
}

// Culture group classification — uses region tags to assign each culture to a family
const CULTURE_GROUP_TAGS = [
  [["roman", "italic", "sicily"], "Roman / Italic"],
  [["greek_aor", "greek", "crete", "cypriot"], "Greek"],
  [["hellenistic", "macedonian", "ptolemaic", "seleucid"], "Hellenistic"],
  [["gallic", "celtic", "galatian"], "Gallic / Celtic"],
  [["brittonic"], "Brittonic"],
  [["germanic"], "Germanic"],
  [["iberian"], "Iberian"],
  [["illyrian", "southern_illyrian", "liburnian"], "Illyrian"],
  [["thracian_aor", "thracian", "getic", "dacian"], "Thracian / Dacian"],
  [["scythian", "sarmatian", "bosporan", "dahaea"], "Scythian / Steppe"],
  [["carthaginian", "phoenician"], "Phoenician / Carthaginian"],
  [["arab", "syrian"], "Arabian / Syrian"],
  [["egyptian"], "Egyptian"],
  [["ethiopian", "kushite"], "Ethiopian / African"],
  [["libyan", "numidian", "maurian", "garamantian"], "Libyan / Numidian"],
  [["iranian", "persia", "upper_satrapies", "elamite", "media"], "Iranian / Persian"],
  [["armenian", "caucasian", "caucasian_iberian"], "Caucasian"],
  [["indian"], "Indian"],
  [["phrygian", "lydian", "lycian", "cilician", "cappadocian", "paphlagonian", "mysian", "pisidian", "bithynian", "asia_minor", "anatolian", "commagenian"], "Anatolian"],
  [["venedic", "aestian"], "Baltic"],
  [["babylonian", "mesopotamian", "assyrian"], "Mesopotamian"],
  [["judaean"], "Judaean"],
];
// Fallback: check dominant religion tag to infer group
const REL_TO_CULTURE_GROUP = {
  celtic: "Gallic / Celtic", germanic: "Germanic", italic: "Roman / Italic",
  thracian: "Thracian / Dacian", illyrian: "Illyrian", iberian: "Iberian",
  libyan: "Libyan / Numidian", ethiopian: "Ethiopian / African", baltic: "Baltic",
  arab: "Arabian / Syrian", iranian: "Iranian / Persian", indian: "Indian",
  scythian: "Scythian / Steppe", delmato_pannonian: "Illyrian", venetic: "Illyrian",
  phoenician: "Phoenician / Carthaginian", egyptian: "Egyptian", armenian: "Caucasian",
  caucasian: "Caucasian", assyrian: "Mesopotamian", mesopotamian: "Mesopotamian",
  judaean: "Judaean",
};

// Sub-group tags for large culture groups — checked after main group is determined
const CULTURE_SUBGROUPS = {
  "Greek": [
    [["italiote"], "Greek — Italiote"],
    [["sicily"], "Greek — Sicilian"],
    [["crete"], "Greek — Cretan"],
    [["macedonia", "macedonian"], "Greek — Macedonian"],
    [["thessalian"], "Greek — Thessalian"],
    [["epirote"], "Greek — Epirote"],
    [["ionian"], "Greek — Ionian"],
    [["arcadian"], "Greek — Arcadian"],
    [["boiotian"], "Greek — Boeotian"],
    [["athenian"], "Greek — Athenian"],
    [["spartan"], "Greek — Spartan"],
    [["achaian"], "Greek — Achaean"],
    [["asia_minor"], "Greek — Asia Minor"],
    [["bosporan"], "Greek — Bosporan"],
  ],
  "Gallic / Celtic": [
    [["belgica"], "Celtic — Belgae"],
    [["galatian"], "Celtic — Galatian"],
    [["pannonian"], "Celtic — Pannonian"],
    [["brittonic"], "Celtic — Brittonic"],
    [["corsican"], "Celtic — Corsican"],
  ],
  "Scythian / Steppe": [
    [["dahaea"], "Steppe — Dahae"],
    [["bosporan"], "Steppe — Bosporan"],
    [["royal_scythian"], "Steppe — Royal Scythian"],
    [["saka"], "Steppe — Saka"],
    [["sarmatian"], "Steppe — Sarmatian"],
  ],
  "Arabian / Syrian": [
    [["syrian"], "Arabian — Syrian"],
  ],
  "Germanic": [
    [["belgica"], "Germanic — Belgic"],
  ],
};

function classifyCultureGroup(regionData) {
  const tags = (regionData.tags || "").split(/,\s*/).map(t => t.trim().toLowerCase());
  let mainGroup = null;
  for (const [tagList, group] of CULTURE_GROUP_TAGS) {
    for (const tag of tagList) {
      if (tags.includes(tag)) { mainGroup = group; break; }
    }
    if (mainGroup) break;
  }
  if (!mainGroup) {
    let bestRel = null, bestLvl = -1;
    for (const hit of String(regionData.tags || "").matchAll(/\brel_([a-z_]+?)_(\d+)\b/g)) {
      const lvl = parseInt(hit[2], 10);
      if (lvl > bestLvl) { bestRel = hit[1]; bestLvl = lvl; }
    }
    if (bestRel && REL_TO_CULTURE_GROUP[bestRel]) mainGroup = REL_TO_CULTURE_GROUP[bestRel];
    else return { main: "Other", sub: null };
  }
  // Check sub-groups
  const subDefs = CULTURE_SUBGROUPS[mainGroup];
  if (subDefs) {
    for (const [subTags, subLabel] of subDefs) {
      for (const st of subTags) {
        if (tags.includes(st)) return { main: mainGroup, sub: subLabel };
      }
    }
  }
  return { main: mainGroup, sub: null };
}

// Palette for culture/population/farm color modes
// ── Dev map-mode palettes ──────────────────────────────────────────────
const TERRAIN_COLORS = {
  river_valley:                   [179, 234, 220],   // #B3EADC
  floodplains_delta:              [112, 224, 174],   // #70E0AE
  grassland:                      [181, 230,  29],   // #B5E61D
  mountain_valley:                [165, 185, 140],   // muted olive-sage
  forest:                         [ 18,  92,  12],   // #125C0C
  steppe:                         [235, 175,  45],   // orange-yellow
  hills:                          [175, 130,  30],   // dark golden brown
  wetlands:                       [ 85, 160, 115],   // #55A073
  small_islands_and_rocky_coast:  [ 80,  70, 130],   // muted purple-blue
  plateau:                        [136,   0,  21],   // #880015
  karst_terrain:                  [235, 159, 146],   // #EB9F92
  mountains:                      [189, 189, 189],   // #BDBDBD
  desert:                         [239, 242, 128],   // #EFF280
};
const TERRAIN_LABELS = {
  hills: "Hills", mountain_valley: "Mountain Valley", grassland: "Grassland",
  river_valley: "River Valley", mountains: "Mountains", desert: "Desert",
  plateau: "Plateau", forest: "Forest", floodplains_delta: "Floodplains / Delta",
  small_islands_and_rocky_coast: "Small Islands / Rocky Coast",
  wetlands: "Wetlands / Swamps / Marshes", steppe: "Steppe", karst_terrain: "Karst Terrain",
};
const CLIMATE_COLORS = {
  mediterranean:      [225, 235,   0],
  humid_sub_tropical: [100, 220, 100],
  monsoon:            [ 30, 130,  50],
  temperate:          [ 50, 200,  20],
  oceanic:            [120, 255,  50],
  continental:        [ 30, 190, 255],
  dry_sub_tropical:   [240, 210, 160],
  cold_semi_arid:     [250, 200,  50],
  alpine:             [180, 180, 180],
  sub_artic:          [  0, 120, 110],
  tropical:           [ 70, 160, 210],
  hot_semi_arid:      [240, 160,  30],
  arid:               [220,  20,  20],
};
const CLIMATE_LABELS = {
  mediterranean: "Mediterranean", continental: "Continental", oceanic: "Oceanic",
  arid: "Arid", hot_semi_arid: "Hot Semi-arid", cold_semi_arid: "Cold Semi-arid",
  dry_sub_tropical: "Dry Sub-tropical", humid_sub_tropical: "Humid Sub-tropical",
  temperate: "Temperate", alpine: "Alpine", monsoon: "Monsoon",
  sub_artic: "Sub-artic", tropical: "Tropical",
};
const PORT_COLORS = {
  inland: [100, 100, 100],  // Inland (no port tag)
  0: [200,  50,  40],       // No Harbour — red
  1: [230, 150,  40],       // Trading Port — orange
  2: [220, 200,  40],       // Shipwright — yellow
  3: [ 30, 180,  60],       // Dockyards — green
};
const PORT_LABELS = { inland: "Inland (No Port)", 0: "No Harbour (max Trading Port)", 1: "Trading Port (max Shipwright)", 2: "Shipwright (max Dockyards)", 3: "Dockyards" };
const IRRIGATION_COLORS = {
  irrigation_river:   [ 40, 160,  70],
  irrigation_springs: [120, 200, 100],
  irrigation_lake:    [180, 130, 200],
  irrigation_aquifer: [200, 170,  60],
  irrigation_oasis:   [230, 140,  50],
  other:              [150, 150, 130],
  none:               [160, 130, 100],
};
const IRRIGATION_LABELS = {
  irrigation_river: "River", irrigation_springs: "Springs", irrigation_lake: "Lake",
  irrigation_aquifer: "Aquifer", irrigation_oasis: "Oasis", other: "Other", none: "No Irrigation",
};

// Tag-matching helpers for dev map modes
const TERRAIN_TAGS = Object.keys(TERRAIN_COLORS);
const CLIMATE_TAGS = Object.keys(CLIMATE_COLORS);
const IRRIGATION_TAGS = ["irrigation_river", "irrigation_springs", "irrigation_lake", "irrigation_aquifer", "irrigation_oasis"];

function getTagValue(tags, list) {
  const arr = String(tags || "").split(/,\s*/);
  for (const t of arr) { const k = t.trim(); if (list.includes(k)) return k; }
  return null;
}
function getPortLevel(tags) {
  const m = String(tags || "").match(/\bbase_port_level_(\d+)\b/);
  return m ? parseInt(m[1], 10) : null;
}
function hasTag(tags, tag) {
  return String(tags || "").split(/,\s*/).some(t => t.trim() === tag);
}

// Extract hidden-resource tokens from a region's tag list. Hidden resources
// in descr_regions.txt are bare tokens (e.g. "italic", "merc_center", "rome")
// living in the comma-separated tag list alongside terrain/climate/port/etc.
// We strip the known categories and what's left is the hidden-resource set.
const _HR_KNOWN = new Set([
  ...Object.keys(TERRAIN_COLORS),
  ...Object.keys(CLIMATE_COLORS),
  "irrigation_river", "irrigation_springs", "irrigation_lake", "irrigation_aquifer", "irrigation_oasis",
  "rivertrade", "earthquake",
]);
function getHiddenResources(tags) {
  const out = [];
  for (const raw of String(tags || "").split(/,\s*/)) {
    const t = raw.trim();
    if (!t) continue;
    if (_HR_KNOWN.has(t)) continue;
    if (/^Farm\d+$/.test(t)) continue;
    if (/^rel_.*_\d+$/.test(t)) continue;
    if (/^base_port_level_\d+$/.test(t)) continue;
    out.push(t);
  }
  return out;
}

const DEV_COLOR_MODES = new Set(["terrain", "climate", "port_level", "irrigation", "earthquakes", "rivertrade", "hidden_resource"]);

// Parse "dorian 70 italic 30" → [{name:"dorian",pct:70},{name:"italic",pct:30}]
function parseEthnicities(str) {
  if (!str) return [];
  const parts = str.trim().split(/\s+/);
  const result = [];
  for (let i = 0; i < parts.length - 1; i += 2) {
    const pct = parseInt(parts[i + 1], 10);
    if (!isNaN(pct)) result.push({ name: parts[i], pct });
  }
  return result;
}

// Get color for an ethnicity name — uses RELIGION_COLORS since ethnic names match religion keys
function getEthnicityColor(name) {
  if (RELIGION_COLORS[name]) return RELIGION_COLORS[name];
  // Try partial match
  for (const [key, col] of Object.entries(RELIGION_COLORS)) {
    if (key.startsWith(name) || name.startsWith(key)) return col;
  }
  return [128, 128, 128];
}

// Replace/add/remove a tag in a comma-separated tags string
function replaceTag(tags, oldValues, newValue) {
  const arr = String(tags || "").split(/,\s*/).map(t => t.trim()).filter(Boolean);
  const filtered = arr.filter(t => !oldValues.includes(t));
  if (newValue) filtered.push(newValue);
  return filtered.join(", ");
}

// Options per dev mode for the context menu
const DEV_EDIT_OPTIONS = {
  terrain: { tags: TERRAIN_TAGS, labels: TERRAIN_LABELS, colors: TERRAIN_COLORS, title: "Terrain Type" },
  climate: { tags: CLIMATE_TAGS, labels: CLIMATE_LABELS, colors: CLIMATE_COLORS, title: "Climate" },
  port_level: {
    tags: ["base_port_level_0", "base_port_level_1", "base_port_level_2", "base_port_level_3"],
    labels: { base_port_level_0: "No Harbour", base_port_level_1: "Trading Port", base_port_level_2: "Shipwright", base_port_level_3: "Dockyards" },
    colors: { base_port_level_0: PORT_COLORS[0], base_port_level_1: PORT_COLORS[1], base_port_level_2: PORT_COLORS[2], base_port_level_3: PORT_COLORS[3] },
    title: "Port Level",
    includeNone: "Remove Port Tag", noneColor: PORT_COLORS.inland,
  },
  irrigation: {
    tags: IRRIGATION_TAGS,
    labels: IRRIGATION_LABELS,
    colors: IRRIGATION_COLORS,
    title: "Irrigation",
    includeNone: "No Irrigation", noneColor: IRRIGATION_COLORS.none,
  },
  earthquakes: {
    tags: ["earthquake"],
    labels: { earthquake: "Earthquake Zone" },
    colors: { earthquake: [200, 70, 60] },
    title: "Earthquakes",
    includeNone: "No Earthquakes", noneColor: [80, 160, 80],
  },
  rivertrade: {
    tags: ["rivertrade"],
    labels: { rivertrade: "River Trade" },
    colors: { rivertrade: [50, 170, 70] },
    title: "River Trade",
    includeNone: "No River Trade", noneColor: [160, 130, 100],
  },
};


// Move settlement blocks between faction sections per ownerChanges
// ({ regionName: targetFactionId }, case-insensitive). Idempotent — moving
// to the current owner is a no-op. Unknown target factions are dropped with
// a console warning rather than appended to the file.
function applyOwnershipMoves(lines, ownerChanges) {
  const lower = (s) => String(s || "").toLowerCase();
  const changes = {};
  for (const [k, v] of Object.entries(ownerChanges || {})) {
    if (v == null) continue;
    changes[lower(k)] = lower(v);
  }
  if (Object.keys(changes).length === 0) return lines;

  const isFaction = (line) => /^faction\s+\w/.test(line);
  const isSettlementOpen = (line) => /^settlement\s*$/.test(line.trim());
  const preface = [];
  const blocks = [];
  let i = 0;
  while (i < lines.length && !isFaction(lines[i])) { preface.push(lines[i]); i++; }
  while (i < lines.length) {
    const fm = lines[i].match(/^faction\s+(\w+)/);
    if (!fm) { i++; continue; }
    const block = { factionId: lower(fm[1]), headerLines: [lines[i]], settlements: [], tailLines: [] };
    i++;
    while (i < lines.length && !isFaction(lines[i]) && !isSettlementOpen(lines[i])) {
      block.headerLines.push(lines[i]); i++;
    }
    while (i < lines.length && isSettlementOpen(lines[i])) {
      const settLines = [lines[i]]; i++;
      let regionName = null, depth = 0, opened = false;
      while (i < lines.length) {
        settLines.push(lines[i]);
        const rm = lines[i].match(/^\s*region\s+(\S+)/);
        if (rm && !regionName) regionName = rm[1];
        for (const ch of lines[i]) {
          if (ch === "{") { depth++; opened = true; }
          else if (ch === "}") depth--;
        }
        i++;
        if (opened && depth === 0) break;
      }
      block.settlements.push({ regionName, lines: settLines });
    }
    while (i < lines.length && !isFaction(lines[i])) { block.tailLines.push(lines[i]); i++; }
    blocks.push(block);
  }

  const moves = [];
  for (const block of blocks) {
    const keep = [];
    for (const s of block.settlements) {
      const tgt = changes[lower(s.regionName)];
      if (tgt && tgt !== block.factionId) moves.push({ settlement: s, targetFactionId: tgt });
      else keep.push(s);
    }
    block.settlements = keep;
  }
  for (const { settlement, targetFactionId } of moves) {
    const target = blocks.find(b => b.factionId === targetFactionId);
    if (target) target.settlements.push(settlement);
    else console.warn(`patchDescrStrat: target faction "${targetFactionId}" not found in descr_strat for region "${settlement.regionName}"; ownership change dropped.`);
  }

  const out = [];
  out.push(...preface);
  for (const block of blocks) {
    out.push(...block.headerLines);
    for (const s of block.settlements) out.push(...s.lines);
    out.push(...block.tailLines);
  }
  return out;
}

// Patch descr_strat.txt with updated resources, population and/or ownership
function patchDescrStrat(originalText, resourcesData, populationData, dirtyFiles, mapHeight, ownerChanges) {
  const lines = originalText.split(/\r?\n/);
  const out = [];
  const patchResources = dirtyFiles.has("resources");
  const patchPopulation = dirtyFiles.has("population");

  // Pass 1: remove old resource lines, insert new ones at the same location
  let resourceInsertDone = false;
  let firstResourceLine = -1;
  let lastResourceLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*resource\s+/.test(lines[i])) {
      if (firstResourceLine === -1) firstResourceLine = i;
      lastResourceLine = i;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    // Replace resource block
    if (patchResources && firstResourceLine !== -1 && i >= firstResourceLine && i <= lastResourceLine) {
      if (!resourceInsertDone) {
        // Generate new resource lines from resourcesData
        for (const [regionName, entries] of Object.entries(resourcesData)) {
          if (!Array.isArray(entries)) continue;
          for (const res of entries) {
            const type = (res.type + ",").padEnd(24);
            const amount = (String(res.amount || 1) + ",").padEnd(5);
            const x = String(res.x).padStart(5);
            const stratY = mapHeight ? mapHeight - res.y : res.y;
            const y = String(stratY).padStart(5);
            out.push(`resource        ${type}${amount}      ${x},${y}      ; ${regionName}`);
          }
        }
        resourceInsertDone = true;
      }
      // Skip old resource line
      continue;
    }

    // Patch population in settlement blocks
    if (patchPopulation && /^\s+population\s+\d+/.test(lines[i])) {
      // Find the region for this settlement by looking back for a "region" line
      let regionName = null;
      for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
        const m = lines[j].match(/^\s+region\s+(\S+)/);
        if (m) { regionName = m[1]; break; }
      }
      const popVal = regionName ? (populationData[regionName] ?? populationData[regionName.split("-")[0]]) : undefined;
      if (regionName && popVal != null) {
        const indent = lines[i].match(/^(\s+)/)?.[1] || "\t";
        out.push(`${indent}population ${popVal}`);
        continue;
      }
    }

    out.push(lines[i]);
  }

  // If no resource lines existed in original but we have resources to add
  if (patchResources && firstResourceLine === -1 && !resourceInsertDone) {
    // Find the factions section marker and insert before it
    const factionIdx = out.findIndex(l => l.includes("; >>>> start of factions section <<<<"));
    const insertAt = factionIdx !== -1 ? factionIdx : out.length;
    const newLines = [];
    for (const [regionName, entries] of Object.entries(resourcesData)) {
      if (!Array.isArray(entries)) continue;
      for (const res of entries) {
        const type = (res.type + ",").padEnd(24);
        const amount = (String(res.amount || 1) + ",").padEnd(5);
        const x = String(res.x).padStart(5);
        const y = String(res.y).padStart(5);
        newLines.push(`resource        ${type}${amount}      ${x},${y}      ; ${regionName}`);
      }
    }
    out.splice(insertAt, 0, ...newLines);
  }

  const final = ownerChanges && Object.keys(ownerChanges).length > 0
    ? applyOwnershipMoves(out, ownerChanges)
    : out;
  return final.join("\n");
}

// Extract population data from buildings parse result
function extractPopulationData(buildingsData) {
  const pop = {};
  for (const f of buildingsData) {
    for (const s of f.settlements) {
      if (s.region && s.population != null) pop[s.region] = s.population;
    }
  }
  return pop;
}

// List of files the app uses, grouped by source
const FILE_MANIFEST = [
  { id: "descr_regions", label: "descr_regions.txt", description: "Region definitions (regions, cities, cultures, tags, RGB keys)", generates: ["regions_classic.json", "regions_large.json"] },
  { id: "descr_strat", label: "descr_strat.txt", description: "Campaign strategy file (factions, settlements, buildings, armies, population)", generates: ["factions_with_regions.json", "descr_strat_buildings.json", "population.json"] },
  { id: "map_regions", label: "map_regions.tga", description: "Region colour map (TGA image — pixel RGB → region lookup)", generates: [] },
  { id: "descr_win_conditions", label: "descr_win_conditions.txt", description: "Victory conditions per faction", generates: [] },
];

const CULTURE_PALETTE = [
  [220,100,90],[90,160,220],[90,200,110],[220,190,70],[180,90,210],[90,210,200],
  [220,150,70],[150,220,90],[210,90,150],[70,150,210],[170,130,90],[110,210,190],
  [230,130,130],[130,190,230],[130,230,130],[230,210,130],[200,130,220],[130,220,220],
  [230,180,130],[180,230,130],[220,130,180],[130,180,220],[190,160,130],[150,220,210],
  [240,160,100],[100,240,160],[160,100,240],[240,220,100],[100,160,240],[240,100,220],
];

// getColor receives (region, origR, origG, origB) so callers can add per-province variation
function buildColoredCanvas(pixelData, width, height, regions, getColor, upscale) {
  if (pixelData.length !== 4 * width * height) return null;
  const S = upscale || 1;
  const outW = width * S, outH = height * S;
  const d = new Uint8ClampedArray(outW * outH * 4);
  for (let i = 0; i < pixelData.length; i += 4) {
    const srcX = (i / 4) % width, srcY = Math.floor(i / 4 / width);
    const r = pixelData[i], g = pixelData[i + 1], b = pixelData[i + 2];
    const region = regions[`${r},${g},${b}`];
    if (S === 1) {
      if (region) {
        const col = getColor(region, r, g, b, srcX, srcY);
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
      } else {
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = pixelData[i + 3];
      }
    } else {
      // Upscaled: fill SxS block, passing high-res coords to getColor
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const ox = srcX * S + sx, oy = srcY * S + sy;
          const oi = (oy * outW + ox) * 4;
          if (region) {
            const col = getColor(region, r, g, b, ox, oy);
            d[oi] = col[0]; d[oi + 1] = col[1]; d[oi + 2] = col[2]; d[oi + 3] = 255;
          } else {
            d[oi] = r; d[oi + 1] = g; d[oi + 2] = b; d[oi + 3] = pixelData[i + 3];
          }
        }
      }
    }
  }
  const off = document.createElement("canvas");
  off.width = outW; off.height = outH;
  off.getContext("2d").putImageData(new ImageData(d, outW, outH), 0, 0);
  return off;
}

function App() {
  useSystemDarkMode();
  const isDark = usePrefersDark();
  useLightModePanelContrast(isDark);

  const canvasRef = useRef(null);
  const pixelDataRef = useRef(null);
  const bgCanvasRef = useRef(null);
  const bgSourceRef = useRef(null);
  const minimapRef = useRef(null);
  const minimapDragging = useRef(false);
  const splashStartRef = useRef(Date.now());
  const topBarRef = useRef(null);
  const [topBarHeight, setTopBarHeight] = useState(0);

  const [regions, setRegions] = useState({});
  const [regionInfo, setRegionInfo] = useState(null);
  const [lockedRegionInfo, setLockedRegionInfo] = useState(null);
  // Last few region rgb keys the user has locked (most-recent-first, max 5).
  // Powers the "↶ recent" backstack so you can flip between two cities
  // without re-finding them on the map.
  const [recentRegions, setRecentRegions] = useState([]);
  const pushRecentRegion = useCallback((rgbKey) => {
    if (!rgbKey) return;
    setRecentRegions((prev) => {
      const next = [rgbKey, ...prev.filter((k) => k !== rgbKey)];
      return next.slice(0, 5);
    });
  }, []);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [imgSize, setImgSize] = useState({ width: 800, height: 600 });
  const [rightColWidth, setRightColWidth] = useState(610);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState(null);
  const [offscreen, setOffscreen] = useState(null);
  const [coloredOffscreen, setColoredOffscreen] = useState(null);
  const [stripeOverlay, setStripeOverlay] = useState(null);
  const [selectedProvinces, setSelectedProvinces] = useState([]);
  const [borderPaths, setBorderPaths] = useState({});
  const [coastalRegions, setCoastalRegions] = useState(new Set());
  const [cultureBorderPath, setCultureBorderPath] = useState(null);
  const [factionBorderPath, setFactionBorderPath] = useState(null);
  const [showSplash, setShowSplash] = useState(true);
  const [showWelcome, setShowWelcome] = useState(false); // shown after splash, before main UI
  const [welcomeHighlight, setWelcomeHighlight] = useState(null); // which UI element to highlight during onboarding
  const [appVersion, setAppVersion] = useState("0.0.0");
  // Internal package.json version can include a silent iteration segment
  // (e.g. "0.9.2-10") for test builds. displayVersion strips it so the UI
  // uses the stable "0.9.2" label. isTestBuild is true whenever the full
  // version carries that suffix — test builds always fire onboarding so we
  // can verify the welcome flow on every iteration.
  const displayVersion = useMemo(() => {
    const parts = (appVersion || "").split(/[-.]/).filter(p => /^\d+$/.test(p));
    return parts.slice(0, 3).join(".") || appVersion;
  }, [appVersion]);
  const isTestBuild = useMemo(() => (appVersion || "").includes("-"), [appVersion]);
  // Default to "first launch" state so welcome renders immediately; async reads below
  // override once resolved. Keeps welcome from being suppressed by a slow or failed read.
  const [lastSeenVersion, setLastSeenVersion] = useState(() => {
    try { return localStorage.getItem("welcomeLastVersion") || null; } catch { return null; }
  });
  const [onboardingDone, setOnboardingDone] = useState(() => {
    try { return localStorage.getItem("onboardingDone") === "1"; } catch { return false; }
  });
  const welcomeShownOnceRef = useRef(false); // hideSplash is one-shot for welcome firing
  const [assetError, setAssetError] = useState(null);
  const [proceedAnyway, setProceedAnyway] = useState(false);
  const [toasts, setToasts] = useState([]); // [{ id, message, kind, count }]
  // Deduplicate identical toasts: if the same (message, kind) is already
  // visible, bump its count and refresh its expiry instead of pushing a new
  // row. Avoids stacking when the user mashes the version-check button.
  const pushToast = useCallback((message, kind = "error") => {
    setToasts(prev => {
      const existing = prev.find(t => t.message === message && t.kind === kind);
      if (existing) {
        // Refresh expiry on the existing entry; bump the visible counter.
        clearTimeout(existing._dismissTimer);
        existing._dismissTimer = setTimeout(
          () => setToasts(p => p.filter(x => x.id !== existing.id)),
          6000
        );
        return prev.map(t => t === existing ? { ...t, count: (t.count || 1) + 1 } : t);
      }
      const id = Math.random().toString(36).slice(2);
      const entry = { id, message, kind, count: 1 };
      entry._dismissTimer = setTimeout(
        () => setToasts(p => p.filter(t => t.id !== id)),
        6000
      );
      return [...prev, entry];
    });
  }, []);
  const [regionCentroids, setRegionCentroids] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const searchInputRef = useRef(null);
  const [showFactionSummary, setShowFactionSummary] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [devRecoveryPrompt, setDevRecoveryPrompt] = useState(false); // show recovery banner on dev mode enter
  const [showLoadMenu, setShowLoadMenu] = useState(false); // load saves dropdown
  const loadMenuRef = useRef(null);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [settlementLegendCollapsed, setSettlementLegendCollapsed] = useState(false);
  const [resourcePanelCollapsed, setResourcePanelCollapsed] = useState(false);
  const [homelandPanelCollapsed, setHomelandPanelCollapsed] = useState(false);
  const [armyTypesPanelCollapsed, setArmyTypesPanelCollapsed] = useState(false);
  const [resourceSearch, setResourceSearch] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Start each launch unmuted — mute is a transient per-session preference,
  // not persisted across restarts.
  const [audioMuted, setAudioMuted] = useState(false);
  const currentAudioRef = useRef(null); // active <audio> element — mute flips .muted + .volume
  const audioOriginalVolumeRef = useRef(0.7);
  const toggleAudioMuted = useCallback(() => {
    setAudioMuted(m => {
      const next = !m;
      const a = currentAudioRef.current;
      if (a) {
        // Belt-and-braces: some Chromium/Electron combinations have surprised me
        // with .muted only partially silencing WAV playback. Drop volume to 0 too.
        a.muted = next;
        a.volume = next ? 0 : audioOriginalVolumeRef.current;
      }
      return next;
    });
  }, []);
  const [collapsedRelGroups, setCollapsedRelGroups] = useState(() => new Set(Object.keys(RELIGION_GROUPS)));
  const [collapsedCulGroups, setCollapsedCulGroups] = useState(new Set(["__all__"])); // sentinel: start all collapsed
  const [collapsedHrGroups, setCollapsedHrGroups] = useState(new Set(["__all__"])); // hidden-resource groups, start all collapsed
  const [devFlatColors, setDevFlatColors] = useState(false);
  const [devGrid, setDevGrid] = useState(false);
  const [devCultureBorders, setDevCultureBorders] = useState(false);
  const [showSettlementTier, setShowSettlementTier] = useState(false);
  // Persist the Armies-overlay toggle. Defaults to ON — the user's main
  // reason to be in Live mode is seeing where everyone's stacks are; the
  // overlay was off-by-default which buried the feature behind a toggle
  // most users didn't know existed.
  const [showArmies, setShowArmies] = useState(() => {
    try { return localStorage.getItem("showArmies") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("showArmies", showArmies ? "1" : "0"); } catch {}
  }, [showArmies]);
  const [showLabels, setShowLabels] = useState("off"); // "off" | "city" | "region"
  const [cityPixels, setCityPixels] = useState([]); // [{x, y, rgbKey}] — black pixel positions mapped to nearest region
  const [hoveredCity, setHoveredCity] = useState(null); // { city, region, x, y, tier, screenX, screenY }
  const [factionColors, setFactionColors] = useState({}); // { faction: { primary: [r,g,b], secondary: [r,g,b] } }
  const [showFileImport, setShowFileImport] = useState(false);
  const [fileImportDone, setFileImportDone] = useState(false);
  const [importPicker, setImportPicker] = useState(null); // { suffix, campaigns, camp } — shown when multiple campaigns found
  const [devContextMenu, setDevContextMenu] = useState(null); // { x, y, rgbKey, region }
  const [devEditsCount, setDevEditsCount] = useState(0);
  const [devDirtyFiles, setDevDirtyFiles] = useState(new Set());
  const devOrigStratRef = useRef(null); // stores original descr_strat.txt text for patching on export

  // Restore persisted files on startup (Electron only)
  useEffect(() => {
    if (window.electronAPI?.readUserFile) {
      window.electronAPI.readUserFile("descr_strat_original.txt").then(text => {
        if (text) devOrigStratRef.current = text;
      });
      // Read last seen version for welcome/what's-new screen
      window.electronAPI.readUserFile("welcome_version.txt").then(text => {
        setLastSeenVersion(text ? text.trim() : null); // null = first install
      }).catch(() => setLastSeenVersion(null));
      // Onboarding state is tracked separately so a reinstall (which keeps userData)
      // still shows first-run cards if the user has never completed them.
      window.electronAPI.readUserFile("onboarding_done.txt").then(text => {
        setOnboardingDone(!!(text && text.trim()));
      }).catch(() => setOnboardingDone(false));
    } else {
      // Browser fallback
      setLastSeenVersion(localStorage.getItem("welcomeLastVersion") || null);
      setOnboardingDone(localStorage.getItem("onboardingDone") === "1");
    }
    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then(ver => { if (ver) setAppVersion(ver); });
    }
  }, []);

  // Auto-update status listener: surfaces update-available / downloaded / error via toast.
  // Also exposes setUpdateReady so the UI can show a "Restart & install" button.
  const [updateReady, setUpdateReady] = useState(null); // { version } once download finishes
  // 0..100 while electron-updater is downloading the installer in the
  // background; null when no download is in flight. Drives the progress
  // strip next to the version label.
  const [updateDownloadPct, setUpdateDownloadPct] = useState(null);
  // Set when the user clicked the version label to manually check; cleared when the result toast fires.
  // Used so we toast "You're on the latest" ONLY for manual checks (not the silent startup check).
  const manualUpdateCheckRef = useRef(false);
  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return;
    const handle = (s) => {
      if (!s) return;
      if (s.state === "available") {
        pushToast(`Update ${s.version} available — downloading in background.`, "info");
        setUpdateDownloadPct(0);
        manualUpdateCheckRef.current = false;
      } else if (s.state === "downloading") {
        setUpdateDownloadPct(typeof s.percent === "number" ? s.percent : 0);
      } else if (s.state === "downloaded") {
        setUpdateReady({ version: s.version });
        setUpdateDownloadPct(null);
        manualUpdateCheckRef.current = false;
      } else if (s.state === "none") {
        // Only surface "you're on the latest" for manual checks — silent startup checks shouldn't toast.
        if (manualUpdateCheckRef.current) {
          pushToast(`You're on the latest version${appVersion ? ` (v${appVersion})` : ""}.`, "info");
          manualUpdateCheckRef.current = false;
        }
      } else if (s.state === "error") {
        if (manualUpdateCheckRef.current) {
          pushToast(`Update check failed: ${s.message || "(unknown)"}`, "error");
          manualUpdateCheckRef.current = false;
        } else {
          // Auto-check errors are usually noise (placeholder publish feed, no network) — log only.
          console.warn("[updater] error (silenced):", s.message);
        }
      }
    };
    // Pull cached status — recovers from the race where the main process fired update events
    // before this listener attached (the renderer mount happens after autoUpdater.checkForUpdates).
    if (window.electronAPI.getUpdateStatus) {
      window.electronAPI.getUpdateStatus().then((s) => { if (s) handle(s); });
    }
    return window.electronAPI.onUpdateStatus(handle);
  }, [pushToast, appVersion]);

  // Manual update-check trigger from the version label.
  // No "Checking for updates..." toast — the result toast (available /
  // downloaded / on-latest / error) follows immediately and that's enough.
  const onCheckUpdates = useCallback(async () => {
    if (!window.electronAPI?.updaterCheck) return;
    manualUpdateCheckRef.current = true;
    const r = await window.electronAPI.updaterCheck();
    if (r && !r.ok) {
      manualUpdateCheckRef.current = false;
      pushToast(`Update check failed: ${r.reason || "(unknown)"}`, "error");
    }
  }, [pushToast]);
  const markDirty = useCallback((...files) => {
    pushUndoRef.current();
    setDevEditsCount(c => c + 1);
    setDevDirtyFiles(prev => { const s = new Set(prev); files.forEach(f => s.add(f)); return s; });
  }, []);
  const [devDragResource, setDevDragResource] = useState(null); // { regionName, type, mx, my }
  const devDragJustEndedRef = useRef(false);
  const panJustEndedRef = useRef(false);
  const [devBorderPath, setDevBorderPath] = useState(null);
  const devBorderModeRef = useRef(null);

  // Custom campaign labels — persisted in localStorage, overridden on import
  const [campaignLabels, setCampaignLabels] = useState(() => {
    try { return JSON.parse(localStorage.getItem("campaignLabels")) || {}; } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem("campaignLabels", JSON.stringify(campaignLabels)); }, [campaignLabels]);

  // Build CAMPAIGNS from defaults + custom labels
  const CAMPAIGNS = useMemo(() => {
    const result = {};
    for (const [k, v] of Object.entries(DEFAULT_CAMPAIGNS)) {
      result[k] = { ...v, label: campaignLabels[k] || v.label };
    }
    return result;
  }, [campaignLabels]);

  // Map campaign + view mode — persisted in localStorage
  const [mapCampaign, setMapCampaign] = useState(
    () => localStorage.getItem("mapCampaign") || DEFAULT_CAMPAIGNS.imperial.key
  );
  const [mapVariant, setMapVariant] = useState(
    () => localStorage.getItem("mapVariant") || MAP_VARIANTS.starting.key
  );
  const [colorMode, setColorMode] = useState(
    () => localStorage.getItem("colorMode") || "faction"
  );

  // Prevent zooming out past the fitted view
  const minZoom = 1,
    maxZoom = 100;

  const [factionRegionsMap, setFactionRegionsMap] = useState({});
  // Dev mode: { regionName: targetFactionId } — settlement ownership moves
  // queued for export. patchDescrStrat consumes this and physically moves
  // each settlement block into the target faction's section in descr_strat.txt.
  const [factionOwnerChanges, setFactionOwnerChanges] = useState({});
  const [factions, setFactions] = useState([]);
  // Ref mirror so handlers inside effects always see the up-to-date list.
  const factionsRef = useRef(factions);
  useEffect(() => { factionsRef.current = factions; }, [factions]);
  const [selectedFaction, setSelectedFaction] = useState(
    () => localStorage.getItem("selectedFaction") || null
  );
  const [selectedFactions, setSelectedFactions] = useState(
    () => localStorage.getItem("selectedFaction") ? new Set([localStorage.getItem("selectedFaction")]) : new Set()
  );
  // "Pin faction" mode — when on AND a faction is selected, regions
  // outside that faction's territory get heavily greyed rather than just
  // dimmed, so the selected faction's empire reads cleanly. Persists
  // across sessions.
  const [pinFaction, setPinFaction] = useState(() => {
    try { return localStorage.getItem("pinFaction") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("pinFaction", pinFaction ? "1" : "0"); } catch {}
  }, [pinFaction]);

  // Dev "hidden_resource" map mode: which hidden resource to highlight (search box reuses legendSearch)
  const [selectedHiddenResource, setSelectedHiddenResource] = useState(null);
  // Dev-mode inline "Add new HR" input: null = closed, "" or string = open
  const [newHrDraft, setNewHrDraft] = useState(null);
  const [newHrError, setNewHrError] = useState(null);
  // hiddenResourcesList is defined further down — homelandsData is declared
  // after this block and we need it inside that useMemo.

  // Victory conditions
  const [victoryConditions, setVictoryConditions] = useState({});

  const PUBLIC_URL = import.meta.env.BASE_URL || "./";

  // Load a campaign data file: tries userData (persisted imports) first, falls back to bundled fetch.
  const loadCampaignData = useCallback(async (fileName) => {
    if (window.electronAPI?.readCampaignFile) {
      const result = await window.electronAPI.readCampaignFile(fileName);
      if (result && result.type === "text") return { text: result.data };
      if (result && result.type === "binary") return { binary: result.data };
    }
    // Fallback: fetch from bundled public/build
    const res = await fetch(PUBLIC_URL + "/" + fileName);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (fileName.endsWith(".json") || contentType.includes("json")) {
      return { text: await res.text() };
    }
    if (fileName.endsWith(".tga") || fileName.endsWith(".png")) {
      return { binary: await res.arrayBuffer() };
    }
    return { text: await res.text() };
  }, [PUBLIC_URL]);

  const [buildingsData, setBuildingsData] = useState([]);
  const [saveBuildingsData, setSaveBuildingsData] = useState(null); // { city: { building: {level,health} } } from save parser
  const [saveArmiesData, setSaveArmiesData] = useState(null); // { region: [{unit, soldiers, max}] } from save parser
  const [saveQueues, setSaveQueues] = useState(null); // { city: [chainName, ...] } currently-queued buildings from save parser
  const [saveTaxByCity, setSaveTaxByCity] = useState(null); // { city: "low"|"normal"|"high"|"very_high" } from save parser
  const [saveHappinessByCity, setSaveHappinessByCity] = useState(null); // { city: f32 } from save parser (f32 at settlement.offset-30, raw 100..200 scale, see save-cracker dossier 2026-05-10)
  const [savePopulationByCity, setSavePopulationByCity] = useState(null); // { city: u32 } live population from save parser (u32 at settlement.offset-1494, save-cracker session 2)
  const [saveIncomeByCity, setSaveIncomeByCity] = useState(null); // { city: { perTurn, cumulative } } from save parser (u32 at settlement.offset+(683-2269), session 3)
  const [saveSizeByCity, setSaveSizeByCity] = useState(null); // { city: "village"|"town"|"large_town"|"city"|"large_city"|"huge_city" } from save parser (u8 at settlement.offset+(62-2269), session 3)
  const [saveTreasuryRecords, setSaveTreasuryRecords] = useState(null); // { records: [{ pos, treasury, turnStart, regionCount }, ...] } — raw 23 major-faction treasury records from save (session 5)
  const [liveSaveFile, setLiveSaveFile] = useState(null); // filename of the .sav file currently reflected in saveBuildingsData/saveArmiesData
  const [saveCharactersByRegion, setSaveCharactersByRegion] = useState(null); // { region: [character, ...] }
  const [saveScriptedByFaction, setSaveScriptedByFaction] = useState(null); // { faction: [char with x,y, traits, ...] } from v2 parser
  const [saveCurrentYear, setSaveCurrentYear] = useState(null); // current in-game year from save header
  const [saveCurrentTurn, setSaveCurrentTurn] = useState(null); // current turn number from save header
  // Faction-record array (239 records, magic ff 0a af f0). Decoded 2026-05-09
  // by rtw-sav-parser. The array span is the dominant per-turn bloat source —
  // grows ~90 bytes/turn/faction, dwarfing dead-character accumulation.
  const [saveFactionRecords, setSaveFactionRecords] = useState(null);
  // Lua persistent-counter table (115 named entries near EOF). Each is
  // `{ name, value }` from `declare_persistent_counter` plus engine internals.
  const [saveLuaCounters, setSaveLuaCounters] = useState(null);
  // Governor per settlement (settlementName → { firstName, lastName, age, ... }
  // or { uuid, unresolved: true }). Decoded from the per-settlement governor
  // field at marker-1940. Surfaces installed governors in the region panel
  // even when they don't command a bodyguard army (= no unit record links).
  const [saveGovernorByCity, setSaveGovernorByCity] = useState(null);
  // Live-mode parse progress — populated by `save-progress` IPC events.
  // `liveLoading` flips on at click and off when the snapshot lands.
  // `liveLoadingStage` shows the current step ("Parsing characters & armies").
  // We don't show a numeric % anymore — between two emits the main process is
  // genuinely synchronous and the bar would appear stuck. An indeterminate
  // animation + live elapsed-seconds counter conveys "still working" honestly.
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveLoadingStage, setLiveLoadingStage] = useState("");
  const [liveLoadingStartedAt, setLiveLoadingStartedAt] = useState(null);
  const liveLoadingStartedAtRef = useRef(null);
  const [liveLoadingElapsedSec, setLiveLoadingElapsedSec] = useState(0);
  const [saveLoadedAt, setSaveLoadedAt] = useState(null); // wall-clock ms when the last save snapshot landed
  // Tick the elapsed-seconds counter while a parse is in flight. Runs at
  // 250ms cadence — fine enough to feel responsive, sparing on re-renders.
  useEffect(() => {
    if (!liveLoading || !liveLoadingStartedAt) return;
    const id = setInterval(() => {
      setLiveLoadingElapsedSec(Math.floor((Date.now() - liveLoadingStartedAt) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [liveLoading, liveLoadingStartedAt]);
  const [, setNowTick] = useState(0); // force re-render every 30s so the "ago" label updates without a save event
  useEffect(() => {
    if (!saveLoadedAt) return;
    const id = setInterval(() => setNowTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, [saveLoadedAt]);
  const [saveUnitsByRegion, setSaveUnitsByRegion] = useState(null); // { region: [unit, ...] } — from new unit parser
  const [builtBuildingsByCity, setBuiltBuildingsByCity] = useState(null); // { city: [chainName, ...] } — real built buildings from the save
  const [queuedBuildingsByCity, setQueuedBuildingsByCity] = useState(null); // { city: [chainName, ...] } — currently-queued chains, EDB-filtered
  const [initialOwnerByCity, setInitialOwnerByCity] = useState(null); // { city: factionId } — turn-0 ownership from descr_strat
  const [currentOwnerByCity, setCurrentOwnerByCity] = useState(null); // { city: factionId } — current ownership decoded from save
  const [factionDisplayNames, setFactionDisplayNames] = useState(null); // { factionId: displayName } from mod text/expanded_bi.txt
  const [factionCultures, setFactionCultures] = useState(null); // { factionId: cultureFolderName } from descr_sm_factions.txt
  // Bumping this counter invalidates every mod-derived useEffect that
  // includes it as a dependency, so the "Reload mod data" button can
  // re-fetch every parsed file without a full page reload.
  const [modReloadTick, setModReloadTick] = useState(0);
  // Last-seen mtime per file, populated by the mtime poller. When the
  // current mtime exceeds the last-seen, modDataStale becomes true and
  // a small "Reload" pill flashes near the View options.
  const [modDataStale, setModDataStale] = useState(false);
  const [activeSieges, setActiveSieges] = useState({}); // { settlementName: { general, x, y } }
  const [modIconsDir, setModIconsDir] = useState(() => {
    try { return localStorage.getItem("modIconsDir") || null; } catch { return null; }
  });
  // Auto-detect mod icons dir on startup if not set
  useEffect(() => {
    if (modIconsDir) return;
    const api = window.electronAPI;
    if (!api?.findFactionIconsDir || !api?.getAppPaths) return;
    api.getAppPaths().then(async (paths) => {
      const tryDirs = [];
      if (paths.localAppData) {
        // Game's mod directory on Windows
        const modsRoot = paths.localAppData.replace(/\\/g, "/") + "/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Mods/My Mods";
        tryDirs.push(modsRoot);
      }
      if (paths.home) {
        // Mac mod directory
        tryDirs.push(paths.home.replace(/\\/g, "/") + "/Library/Application Support/Feral Interactive/Total War Rome Remastered/VFS/Local/Mods/My Mods");
      }
      for (const dir of tryDirs) {
        const result = await api.findFactionIconsDir(dir);
        if (result) {
          setModIconsDir(result);
          try { localStorage.setItem("modIconsDir", result); } catch {}
          return;
        }
      }
    });
  }, [modIconsDir]);
  // Faction display-name → internal-id map, loaded from the mod's text files
  // (campaign_descriptions.txt). Lets us match "The House of Claudii" in a
  // save filename to the internal `romans_julii` faction key.
  const factionDisplayMapRef = useRef({});

  const [modDataDir, setModDataDir] = useState(null);
  const [iconCacheVersion, setIconCacheVersion] = useState(0);
  const [gameDisplayNames, setGameDisplayNames] = useState(null); // from game's export_buildings.txt (culture-aware)
  // Derive the mod's data directory from modIconsDir and initialize the
  // character/unit parsers in the main process. Idempotent — safe to re-call.
  useEffect(() => {
    if (!modIconsDir) return;
    const api = window.electronAPI;
    if (!api?.charactersInit) return;
    const normalized = modIconsDir.replace(/\\/g, "/");
    const candidates = [];
    const dataIdx = normalized.toLowerCase().lastIndexOf("/data/");
    if (dataIdx !== -1) candidates.push(normalized.slice(0, dataIdx + "/data".length));
    candidates.push(normalized.replace(/\/[^/]+\/?$/, "").replace(/\/ui$/, ""));
    if (candidates[0]) setModDataDir(candidates[0]);
    for (const dir of candidates) {
      api.charactersInit(dir).then(result => {
        if (result?.ok) {
          console.log("[characters] initialized: " + result.names + " names, " + result.traits + " traits, " + result.surnames + " surnames, " + result.chains + " chains, " + result.factionDisplay + " faction display names");
          // Pull the descr_strat-derived turn-0 settlement ownership map so
          // recruit evaluation has a real owner per city (without needing a
          // save loaded). Otherwise we fall back to descr_regions' rebel-
          // default faction, which doesn't necessarily match the strat owner.
          if (api.getInitialOwnership) {
            api.getInitialOwnership().then(map => {
              if (map && Object.keys(map).length) {
                setInitialOwnerByCity(map);
                console.log("[ownership] loaded initial owner map, entries:", Object.keys(map).length);
              }
            }).catch(() => {});
          }
          if (api.getRebelFactions) {
            api.getRebelFactions(dir).then(map => {
              if (map && Object.keys(map).length) {
                setRebelFactions(map);
                console.log("[rebel-factions] loaded, types:", Object.keys(map).length);
              }
            }).catch(() => {});
          }
          // Pull descr_strat starting characters (with traits/ancillaries/
          // age/tags) for non-live mode. This is what makes generals'
          // traits browsable in any mod — vanilla, RIS, or a workshop
          // download — without relying on the bundled JSON.
          if (api.getStartingCharacters) {
            api.getStartingCharacters().then(res => {
              if (res?.ok && Array.isArray(res.characters) && res.characters.length) {
                setStartingCharactersFromMod(res.characters);
                console.log("[starting-chars] loaded from descr_strat:", res.characters.length);
              }
            }).catch(() => {});
          }
          // Fetch the faction display map too
          if (api.getFactionDisplayMap) {
            api.getFactionDisplayMap().then(map => {
              factionDisplayMapRef.current = map || {};
              console.log("[faction] loaded display map, entries:", Object.keys(map || {}).length);
            });
          }
          if (api.getFactionDisplayNames) {
            api.getFactionDisplayNames(dir, mapCampaign).then(map => {
              setFactionDisplayNames(map || {});
              console.log("[faction] loaded display names, entries:", Object.keys(map || {}).length);
            });
          }
          if (api.getFactionCultures) {
            // Pass the current mod's dir so RIS (or any mod) gets its 200+
            // faction→culture entries merged in. Without modDataDir the IPC
            // falls back to vanilla+BI+Alexander only (~41 total) and the
            // region panel throws 'NO CULTURE for X' for every modded faction.
            api.getFactionCultures(dir).then(map => {
              setFactionCultures(map || {});
              console.log("[faction] loaded cultures, entries:", Object.keys(map || {}).length);
            });
          }
        }
      }).catch(() => {});
    }
  }, [modIconsDir]);

  // Load culture-aware building display names AND faction→culture map from
  // the game/mod. Must run independently of modIconsDir so users playing
  // vanilla or Alexander (without a mod) still get proper names/cultures.
  useEffect(() => {
    const api = window.electronAPI;
    if (api?.getBuildingDisplayNames) {
      api.getBuildingDisplayNames(modDataDir || null).then((map) => {
        if (map) {
          console.log("[display-names] loaded, entries:", Object.keys(map).length,
            "modDataDir:", modDataDir || "(none)",
            "sample_farms+2:", JSON.stringify(map["farms+2"]),
            "sample_farms+2_greek:", JSON.stringify(map["farms+2_greek"]),
            "sample_forum_greek:", JSON.stringify(map["forum_greek"]));
          setGameDisplayNames(map);
        }
      }).catch((e) => console.warn("[display-names] load failed:", e?.message));
    }
    if (api?.getBuildingChainLevels) {
      api.getBuildingChainLevels(modDataDir || null).then((map) => {
        if (map && Object.keys(map).length > 0) {
          console.log("[chain-levels] parsed export_descr_buildings.txt, chains:", Object.keys(map).length,
            "sample_barracks:", JSON.stringify(map.barracks),
            "sample_caravans:", JSON.stringify(map.caravans),
            "sample_hinterland_farms:", JSON.stringify(map.hinterland_farms));
          setBuildingLevelsLookup(map);
        } else {
          console.warn("[chain-levels] IPC returned empty map — likely game install not detected, falling back to bundled");
        }
      }).catch((e) => console.warn("[chain-levels] load failed:", e?.message));
    }
    if (api?.getBuildingRecruits) {
      api.getBuildingRecruits(modDataDir || null).then((map) => {
        if (map && Object.keys(map).length > 0) {
          console.log("[building-recruits] parsed EDB, chains with recruits:", Object.keys(map).length);
          setBuildingRecruits(map);
        }
      }).catch((e) => console.warn("[building-recruits] load failed:", e?.message));
    }
    if (api?.getUnitOwnership) {
      api.getUnitOwnership(modDataDir || null).then((map) => {
        if (map && Object.keys(map).length > 0) {
          console.log("[unit-ownership] parsed EDU, units:", Object.keys(map).length);
          setUnitOwnership(map);
        }
      }).catch((e) => console.warn("[unit-ownership] load failed:", e?.message));
    }
    if (api?.getFactionCultures) {
      api.getFactionCultures(modDataDir || null).then((map) => {
        if (map && Object.keys(map).length > 0) setFactionCultures(map);
      }).catch(() => {});
    }
    if (api?.getFactionDisplayNames) {
      api.getFactionDisplayNames(modDataDir || null, mapCampaign).then((map) => {
        if (map && Object.keys(map).length > 0) setFactionDisplayNames(map);
      }).catch(() => {});
    }
    // Re-fetching means we just consumed the latest disk state — clear
    // the stale flag so the badge stops nagging until the next disk edit.
    setModDataStale(false);
  }, [modDataDir, mapCampaign, modReloadTick]);

  // Poll mod-file mtimes every 4 seconds. If any tracked file's mtime
  // exceeds what we last saw, surface the "Reload mod data" badge so
  // the modder knows their disk edit is unseen by Provincia. Cleared
  // after a manual reload (above) or on initial first-poll baseline.
  useEffect(() => {
    if (!modDataDir) return;
    const api = window.electronAPI;
    if (!api?.getModFileMtimes) return;
    let cancelled = false;
    let lastSeen = null; // { rel: mtime }
    const tick = async () => {
      try {
        const cur = await api.getModFileMtimes(modDataDir);
        if (cancelled || !cur) return;
        if (lastSeen) {
          for (const k of Object.keys(cur)) {
            if (cur[k] != null && lastSeen[k] != null && cur[k] > lastSeen[k]) {
              setModDataStale(true);
              break;
            }
          }
        }
        lastSeen = cur;
      } catch {}
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [modDataDir, modReloadTick]);

  const [buildingLevelsLookup, setBuildingLevelsLookup] = useState(null); // { chain: [level0Name, level1Name, ...] }
  const [buildingRecruits, setBuildingRecruits] = useState(null); // { chain: { level: [{unit, factions?}, ...] } }
  const [unitOwnership, setUnitOwnership] = useState(null); // { unitName: [faction, ...] } — from export_descr_unit.txt
  // { rebelType: { units: [name, ...], category, chance, description } } from
  // descr_rebel_factions.txt. Used to surface the procedural rebel garrison
  // pool for slave-owned settlements that have no explicit descr_strat army.
  const [rebelFactions, setRebelFactions] = useState(null);
  const [infoPopup, setInfoPopup] = useState(null); // { type, faction, name, chainName?, culture?, label? }
  const [buildingDisplayNames, setBuildingDisplayNames] = useState(null); // { levelName: "Display Name" }
  // Load building lookups on mount.
  // NOTE: in Electron with file:// protocol, BASE_URL is "./" and the old
  // `BASE_URL + "/" + name` pattern produced URLs like ".//building_levels.json"
  // that file:// rejected in some configurations — leaving the lookups null and
  // upgrades unable to resolve. Use loadCampaignData (same path other JSONs use)
  // for reliability.
  useEffect(() => {
    // Bundled JSONs only fill in when the runtime EDB parse (getBuildingChainLevels
    // in the [modDataDir] effect) doesn't yield data — e.g. the game install
    // isn't detected. Never overwrite an already-populated lookup.
    loadCampaignData("building_levels.json")
      .then(r => setBuildingLevelsLookup(prev => prev && Object.keys(prev).length > 0 ? prev : JSON.parse(r.text)))
      .catch(e => pushToast(`Failed to load building level data (${e.message}). Building upgrades will show raw names.`));
    loadCampaignData("building_display_names.json")
      .then(r => setBuildingDisplayNames(JSON.parse(r.text)))
      .catch(e => pushToast(`Failed to load building display names (${e.message}). Buildings will show technical names.`));
  }, [loadCampaignData, pushToast]);
  const [resourcesData, setResourcesData] = useState({});
  const [resourceImages, setResourceImages] = useState({});
  // null = all shown; Set<string> = only those types shown
  const [resourceFilter, setResourceFilter] = useState(null);
  const [armiesData, setArmiesData] = useState([]);
  const [startingArmiesByRegion, setStartingArmiesByRegion] = useState({}); // { region: [{character, x, y, units: [{name, exp}]}] } — from descr_strat
  // Runtime-parsed descr_strat character records (with traits, ancillaries,
  // age, tags) for the currently-loaded mod. Set by `get-starting-characters`
  // IPC after `charactersInit`. Used by the non-live `characters` prop so
  // generals' traits are browsable WITHOUT a save loaded, in ANY mod or
  // vanilla — not just the dev's bundled mod. Flat array keyed by
  // firstName+faction; the renderer groups by region via tileToRegion.
  const [startingCharactersFromMod, setStartingCharactersFromMod] = useState(null);
  const [saveLiveArmies, setSaveLiveArmies] = useState(null); // [{faction, character, x, y, armyClass, units}] from save parser
  // Live-log character positions — authoritative for turn-by-turn moves.
  const liveCharPositions = useRef(new Map());
  // charUuids that the live log has reported as dead (DYING / death_type
  // events). Used to hide their save-derived army markers immediately
  // instead of waiting for the next save snapshot to write the death.
  // Common case: defender wiped during a siege resolution — without
  // this, the slain general's marker lingers until the save updates.
  const liveDeadCharUuids = useRef(new Set());
  // Cumulative unit-flow snapshot streamed from main.js whenever a transfer
  // event (general_transfer or unit_transfer) fires. Each entry is
  // { from: runtimeCharUuid, to: runtimeCharUuid, count: N }. The renderer
  // resolves runtime char uuids to save char uuids by name (via
  // liveCharPositions where the engine emitted the full name on a move
  // event, paired with saveCharactersByRegion for the save secondary uuid),
  // then re-buckets `count` units from save-from-char to save-to-char in
  // the field-army panel. Count-based instead of identity-based because
  // the engine's runtime unit uuids have no stable mapping to save units.
  const liveUnitFlow = useRef([]);
  // Settlement names (lowercase) whose entire garrison was wiped by a
  // successful assault. The losing faction's units inside the settlement
  // (tagged unit.region === <settlement>) get dropped from
  // liveUnitsByRegion + the Characters panel until the next save refresh.
  // Defenders parked OUTSIDE the settlement aren't affected — they're in
  // a different region tag and can survive a siege battle per RTW rules.
  const liveAssaultWipedSettlements = useRef(new Set());
  // Mirror of saveCharactersByRegion accessible from the live-event handler
  // (which is inside a useEffect whose deps don't include
  // saveCharactersByRegion — closure capture would be stale). Used to map
  // a runtime memory uuid in the log (e.g. Titus's `14f47c40`) back to
  // the save's stored secondaryUuid by matching name+faction, so the
  // existing dead-uuid filter in armiesToRender can drop the save's
  // stale army entry without waiting for a save refresh.
  const saveCharactersByRegionRef = useRef(null);
  const [liveCharPositionsVersion, setLiveCharPositionsVersion] = useState(0);
  // User toggle: whether to override save positions with live-log positions.
  // Default ON (pixel-accurate for live play). Turn off when reviewing old
  // saves — the log might be from a later turn than the save, which would
  // show "future" positions.
  const [useLiveOverride, setUseLiveOverride] = useState(() => {
    try { return localStorage.getItem("useLiveOverride") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("useLiveOverride", useLiveOverride ? "1" : "0"); } catch {}
  }, [useLiveOverride]);
  // Final army list for rendering: live save armies if present, else starting
  // armies from descr_strat. Apply garrison classification using cityPixels
  // (black-pixel positions on map_regions.tga that mark settlements).
  // Also overlay positions from live log-moves — those are pixel-accurate
  // truth straight from the engine.
  const armiesToRender = useMemo(() => {
    const src = saveLiveArmies && saveLiveArmies.length > 0 ? saveLiveArmies : armiesData;
    if (!src || src.length === 0) return [];
    // Drop armies whose commander has died per the live log, even
    // though the save still has them alive. Covers the post-siege
    // "defender wiped, save hasn't updated yet" case where Titus's
    // marker would otherwise linger until the next autosave.
    const deadUuids = liveDeadCharUuids.current;
    const isDeadCmd = (uuid) => {
      if (!uuid || deadUuids.size === 0) return false;
      const hex = uuid.toString(16).padStart(8, "0");
      return deadUuids.has(hex);
    };
    // Build a quick Set of "x,y" strings for all settlement tiles.
    // CRITICAL: cityPixels uses TOP-DOWN visual coords (canvas getImageData
    // order), but army positions from the save's type-6 records and
    // descr_strat are BOTTOM-UP world coords. Flip cityPixels.y to world
    // coords so the .has() comparison actually matches. Earlier rule
    // compared coords across mismatched axes — only ~10 armies happened
    // to land at coincidental matches. Now Titus at world (343, 386)
    // correctly matches Brundisium's city pixel.
    const settlementTiles = new Set();
    const H_world = imgSize.height;
    for (const cp of (cityPixels || [])) {
      const worldY = (H_world - 1) - cp.y;
      settlementTiles.add(`${cp.x},${worldY}`);
    }
    const livePos = liveCharPositions.current;
    // Track which live-position keys we've used (so we can add un-matched
    // log-only entries as synthetic armies at the end). Skip all live-log
    // processing if user has disabled the override.
    const matchedKeys = new Set();
    const useLive = useLiveOverride;
    // charUuid → { key, entry } — built lazily on first use inside the
    // match loop. O(1) lookups for Tier 0 / Tier 0.5 instead of the
    // O(livePos) linear scan that hung the app on busy saves.
    let liveByCharUuid = null;
    // If the loaded save is from an older turn than the log's tail, only
    // apply log events whose turn is <= save turn. Prevents "future"
    // positions leaking into a historical save view. saveCurrentTurn is
    // null until the save is loaded — in that case no filter is applied.
    const maxTurn = (saveCurrentTurn != null) ? saveCurrentTurn : Infinity;
    const inTurn = (e) => (e.turn || 0) <= maxTurn;
    const result = src.map(a => {
      // Try to upgrade (x, y) from live log events. Key lookup tries
      // (firstName, lastNameStub, faction) then (firstName, "", faction).
      let x = a.x, y = a.y;
      const faction = (a.faction || "").toLowerCase();
      const first = (a.firstName || (a.character || "").split(" ")[0] || "").toLowerCase();
      // Use originalLastName when an epithet trait replaced lastName.
      // Engine logs continue emitting the BIRTH name in MOVING_NORMAL
      // events even after a trait grants a cognomen, so matching has
      // to happen on the birth-record value (e.g. Marcus's epithet
      // override changed his lastName from "Livius_Drusus" to
      // "Messapivs", but the log still says "Marcus Livius Drusus" on
      // every move).
      const matchLastName = a.originalLastName || a.lastName || "";
      const lastStub = matchLastName.toLowerCase().replace(/[_]/g, "").split(/\s+/)[0] || "";
      // Primary: exact match on (firstName|lastNameStub|faction).
      // Fallback 1: any entry with same firstName and faction (different lastName).
      // Fallback 2: (for unknown-faction armies) any entry with same firstName.
      let liveEntry = null;
      let matchedKey = null;
      if (useLive) {
        // Build a charUuid → entry index ONCE per memo run instead of
        // scanning livePos linearly inside each army's match loop. The
        // earlier per-army scan was O(armies × livePos), which combined
        // with my 0.9.235 Tier 0.5 made the app hang on saves with many
        // armies + active log streaming.
        if (!liveByCharUuid) {
          liveByCharUuid = new Map();
          for (const [k, v] of livePos) {
            if (v.charUuid) liveByCharUuid.set(v.charUuid, { key: k, entry: v });
          }
        }
        // Tier 0: primaryUuid → log charUuid.
        if (a.primaryUuid) {
          const hit = liveByCharUuid.get(a.primaryUuid.toString(16).padStart(8, "0"));
          if (hit && inTurn(hit.entry)) { liveEntry = hit.entry; matchedKey = hit.key; }
        }
        // Tier 0.5: commanderUuid → log charUuid (covers characters the
        // v1 parser misses — their saveLiveArmies entry has no
        // primaryUuid but the unit-record cmd field IS the engine's
        // character id, which is what the log emits as charUuid).
        if (!liveEntry && a.commanderUuid) {
          const hit = liveByCharUuid.get(a.commanderUuid.toString(16).padStart(8, "0"));
          if (hit && inTurn(hit.entry)) { liveEntry = hit.entry; matchedKey = hit.key; }
        }
        const fullKey = first + "|" + lastStub + "|" + faction;
        if (!liveEntry) {
          const primary = livePos.get(fullKey);
          if (primary && inTurn(primary)) { liveEntry = primary; matchedKey = fullKey; }
        }
        // Tier 2 (firstName + faction prefix) is OFF by default. It used
        // to fire whenever the save's lastName didn't exactly match the
        // log's, but in factions with many same-firstName generals
        // (Roman families have ~5 active "Marcus" characters at any
        // time) it eagerly mis-matched: the first "marcus|*|romans_julii"
        // key in livePos got applied to EVERY save Marcus, dragging
        // unrelated heirs and consuls onto the moving general's tile.
        // Only fire it when the save army has NO lastName at all (i.e.
        // a placeholder firstName like "romans_julii captain") AND there
        // is EXACTLY ONE candidate key starting with that firstName in
        // the same faction. Same conservative rule for the unknown-
        // faction Tier 3 fallback.
        const isPlaceholderName = !lastStub || /\s/.test(first); // "romans_julii captain", etc.
        if (!liveEntry && isPlaceholderName && faction) {
          let candidate = null, candidateKey = null, candidateCount = 0;
          for (const [k, v] of livePos) {
            if (k.startsWith(first + "|") && k.endsWith("|" + faction) && inTurn(v)) {
              candidate = v; candidateKey = k; candidateCount++;
              if (candidateCount > 1) break;
            }
          }
          if (candidateCount === 1) { liveEntry = candidate; matchedKey = candidateKey; }
        }
        if (!liveEntry && isPlaceholderName && (!faction || faction === "unknown") && first) {
          let candidate = null, candidateKey = null, candidateCount = 0;
          for (const [k, v] of livePos) {
            if (k.startsWith(first + "|") && inTurn(v)) {
              candidate = v; candidateKey = k; candidateCount++;
              if (candidateCount > 1) break;
            }
          }
          if (candidateCount === 1) { liveEntry = candidate; matchedKey = candidateKey; }
        }
        if (matchedKey) matchedKeys.add(matchedKey);
      }
      if (liveEntry) { x = liveEntry.x; y = liveEntry.y; }
      let armyClass = a.armyClass || "field";
      // Upgrade classification from log role if we have it.
      if (liveEntry && liveEntry.role === "admiral") armyClass = "navy";
      else if (armyClass === "field" && settlementTiles.has(`${x},${y}`)) {
        armyClass = "garrison";
      } else if (liveEntry && armyClass === "garrison" && !settlementTiles.has(`${x},${y}`)) {
        // A garrison that's moved out of its settlement is now a field army.
        // Only apply this flip when we have a live position (save-time
        // classifications are trusted as-is).
        armyClass = "field";
      }
      return { ...a, x, y, armyClass, liveTracked: !!liveEntry };
    });
    // Pass 2: proximity-based position fix-up. If the match cascade
    // missed a save-army ↔ log entry pair (e.g. name spelling drift,
    // uuid encoding mismatch), but a same-faction same-firstName log
    // entry is within 2 tiles of a save army, treat them as the same
    // character and UPDATE the save army's (x, y) to the log entry's
    // position. Earlier 0.9.244 SKIPPED the log entry instead — that
    // left the stale save marker visible at the old tile, so a "move
    // back to original tile" didn't update on the map. Updating in
    // place ensures the marker tracks the latest live position.
    const NEAR_TILES_SQ = 4; // 2-tile radius
    if (useLive) {
      for (const [key, entry] of livePos) {
        if (matchedKeys.has(key)) continue;
        if (!inTurn(entry)) continue;
        const fac = (entry.faction || "").toLowerCase();
        const entryFirst = (entry.name || "").toLowerCase().replace(/^(captain|admiral|general)\s+/, "").split(/\s+/)[0];
        if (!entryFirst || !fac) continue;
        for (const a of result) {
          if (typeof a.x !== "number" || typeof a.y !== "number") continue;
          const aFac = (a.faction || "").toLowerCase();
          if (aFac !== fac) continue;
          const aFirst = (a.firstName || (a.character || "").split(" ")[0] || "").toLowerCase();
          if (aFirst !== entryFirst) continue;
          const dx = entry.x - a.x, dy = entry.y - a.y;
          if (dx * dx + dy * dy > NEAR_TILES_SQ) continue;
          // Same character — adopt the log entry's position and mark
          // the key as matched so the synthetic-entry block below
          // doesn't add a duplicate.
          a.x = entry.x;
          a.y = entry.y;
          a.liveTracked = true;
          matchedKeys.add(key);
          break;
        }
      }
    }

    // Append log-only armies — characters the log has positions for
    // but the save parser genuinely didn't cover (true generated
    // captains, brigands, rebels). Now built AFTER the proximity
    // fix-up so save armies that drifted on stale data already moved.
    const alreadyAtPos = new Set();
    for (const a of result) {
      if (typeof a.x !== "number" || typeof a.y !== "number") continue;
      alreadyAtPos.add((a.faction || "") + "|" + a.x + "," + a.y);
    }
    const logOnlyByPos = new Map(); // "faction|x,y" → [entries]
    if (useLive) {
      for (const [key, entry] of livePos) {
        if (matchedKeys.has(key)) continue;
        if (!inTurn(entry)) continue;
        const posKey = (entry.faction || "") + "|" + entry.x + "," + entry.y;
        if (alreadyAtPos.has(posKey)) continue;
        if (!logOnlyByPos.has(posKey)) logOnlyByPos.set(posKey, []);
        logOnlyByPos.get(posKey).push(entry);
      }
    }
    for (const [posKey, entries] of logOnlyByPos) {
      const lead = entries[0];
      const passengers = entries.slice(1).map(e => ({ firstName: (e.name || "").replace(/^(Captain|Admiral|General)\s+/, "").split(/\s+/)[0], name: e.name }));
      let armyClass = "field";
      // Prefer log role for classification; fall back to name prefix.
      if (lead.role === "admiral" || /^admiral\s+/i.test(lead.name || "")) armyClass = "navy";
      else if (settlementTiles.has(`${lead.x},${lead.y}`)) armyClass = "garrison";
      result.push({
        faction: lead.faction || "unknown",
        character: lead.name,
        firstName: (lead.name || "").replace(/^(Captain|Admiral|General)\s+/, "").split(/\s+/)[0],
        lastName: null,
        x: lead.x, y: lead.y,
        armyClass,
        units: [],
        traits: [],
        age: null,
        liveTracked: true,
        logOnly: true,
        passengers,
      });
    }
    // descr_strat fallback: borrow units lists from descr_strat for save
    // armies positioned at matching tiles, AND add synthetic markers for
    // descr_strat armies the save genuinely missed.
    //
    // Caveat: in live mode the synthetic-marker addition is harmful once
    // a save army has moved off its descr_strat starting tile — the
    // descr_strat coord still holds an entry, the save army holds another
    // entry at its new position, and the user sees the same character
    // duplicated on the map (one at the old spawn, one at the current
    // location). Disable synthetic creation when log-position events have
    // been received; fall back to save+log as the authoritative source.
    if (saveLiveArmies && saveLiveArmies.length > 0 && armiesData && armiesData.length > 0) {
      // Index existing armies by position AND by character name so we can
      // dedupe even when the save's coord differs from descr_strat's. Was:
      // dedup-by-coord-only meant Aulus showed at BOTH his descr_strat
      // starting tile (337,385) AND his save-time position (340,384)
      // after he marched away — the bundled descr_strat marker got added
      // as a synth because no save army was at the descr_strat tile.
      const armyByPos = new Map();
      const armyByCharFaction = new Map();
      // Dedupe key uses the BIRTH lastName so chars with trait-driven
      // cognomen overrides (Aulus Gabinius → Aulus Messapivs the
      // Wallbreaker after gaining RomanConquerorMessapians) still match
      // the bundled descr_strat record's plain birth name. main.js's
      // liveArmies build preserves the birth value as `originalLastName`
      // exactly for this matching purpose.
      const makeNameKey = (firstName, lastName, faction) => {
        return (firstName || "").toLowerCase() + " " + ((lastName || "").replace(/_/g, " ").replace(/\s+the\s+\S+$/i, "").trim().toLowerCase()) + "|" + (faction || "").toLowerCase();
      };
      for (const a of result) {
        if (typeof a.x === "number" && typeof a.y === "number") {
          armyByPos.set(`${a.x},${a.y}`, a);
        }
        if (a.faction) {
          // Index BOTH birth and current display names so any of them
          // catches the synth dedupe below.
          const birthLast = a.originalLastName || a.lastName;
          if (a.firstName) {
            armyByCharFaction.set(makeNameKey(a.firstName, birthLast, a.faction), a);
            if (a.lastName && a.lastName !== birthLast) {
              armyByCharFaction.set(makeNameKey(a.firstName, a.lastName, a.faction), a);
            }
          } else if (a.character) {
            const parts = String(a.character).split(/\s+/);
            armyByCharFaction.set(makeNameKey(parts[0], parts.slice(1).join(" "), a.faction), a);
          }
        }
      }
      // Once a save has been parsed, save armies are authoritative for
      // ALL characters they include. Synthesis fills in descr_strat
      // entries the save didn't surface (rare — most chars are in
      // saveLiveArmies). Skip when live-log events have flowed too —
      // those positions are the freshest.
      const liveMovesActive = useLiveOverride && livePos.size > 0;
      for (const d of armiesData) {
        if (typeof d.x !== "number" || typeof d.y !== "number") continue;
        const key = `${d.x},${d.y}`;
        const existing = armyByPos.get(key);
        if (existing) {
          if ((!existing.units || existing.units.length === 0) && d.units && d.units.length > 0) {
            existing.units = d.units;
            existing._unitsFromDescrStrat = true;
          }
          continue;
        }
        // Name dedupe via birth-name key (see makeNameKey above).
        const dName = d.character || d.name;
        if (dName && d.faction) {
          const parts = String(dName).split(/\s+/);
          const dKey = makeNameKey(parts[0], parts.slice(1).join(" "), d.faction);
          if (armyByCharFaction.has(dKey)) continue;
        }
        if (liveMovesActive) continue;
        let armyClass = d.armyClass || "field";
        if (armyClass === "field" && settlementTiles.has(key)) armyClass = "garrison";
        const synth = { ...d, armyClass, descrStratOnly: true };
        result.push(synth);
        armyByPos.set(key, synth);
      }
    }
    // Compute live region for each army from its (x, y). City tiles are
    // BLACK on the regions TGA so a raw pixel lookup fails for armies
    // sitting on a settlement (0,0,0 isn't a region key) — we fall back
    // to cityPixels (which carries the region rgbKey for each settlement
    // tile) and, finally, to a 1-tile neighbourhood scan that catches
    // armies one tile off the city center. Without these fallbacks an
    // army garrisoning Uria gets `region = null` and its units stay
    // bucketed under the stale save region instead of moving to the
    // panel for the city the marker is on.
    const pxData = pixelDataRef.current;
    const W = imgSize.width, H = imgSize.height;
    // cityByXy keyed by WORLD coords (bottom-up) so tileToRegion's
    // settlement-tile fast path matches the army-position coord system.
    const cityByXy = new Map();
    for (const cp of (cityPixels || [])) {
      const worldY = (H - 1) - cp.y;
      cityByXy.set(`${cp.x},${worldY}`, cp.rgbKey);
    }
    const sampleAt = (x, y) => {
      if (!pxData || x < 0 || y < 0 || x >= W || y >= H) return null;
      const tgaY = (H - 1) - y;
      const idx = (tgaY * W + x) * 4;
      const r = pxData[idx], g = pxData[idx + 1], b = pxData[idx + 2];
      if (r === 0 && g === 0 && b === 0) return null; // city pixel — handled by cityByXy
      return regions[`${r},${g},${b}`]?.region || null;
    };
    const tileToRegion = (x, y) => {
      if (x == null || y == null) return null;
      // 1) Settlement-tile fast path.
      const cityRgb = cityByXy.get(`${x},${y}`);
      if (cityRgb) return regions[cityRgb]?.region || null;
      // 2) Direct pixel sample.
      const direct = sampleAt(x, y);
      if (direct) return direct;
      // 3) 1-tile neighbourhood scan — picks up armies that stand 1px
      //    off the settlement center, which is common for stacks
      //    laid down by descr_strat at coords adjacent to the city
      //    pixel rather than on it.
      for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) {
        if (dx === 0 && dy === 0) continue;
        const nbCity = cityByXy.get(`${x+dx},${y+dy}`);
        if (nbCity) return regions[nbCity]?.region || null;
        const nb = sampleAt(x + dx, y + dy);
        if (nb) return nb;
      }
      return null;
    };
    for (const a of result) {
      a.region = tileToRegion(a.x, a.y);
    }
    // Final filter: drop any army whose commander/character has been
    // reported dead by the live log. Save-derived armies linger
    // otherwise — defeated armies in a siege resolution would still
    // show their old marker until the next save snapshot.
    const wiped = liveAssaultWipedSettlements.current;
    const inWipedSettlement = (a) => {
      if (wiped.size === 0) return false;
      // Bodyguard unit is the first in the army's unit list. Its region
      // tag is the settlement the army was stationed in. If that's been
      // wiped by a successful assault, the bodyguard (and the rest of
      // the garrison) is dead.
      const bg = a.units && a.units[0];
      if (!bg || !bg.region) return false;
      return wiped.has(bg.region.toLowerCase());
    };
    const filtered = (deadUuids.size === 0 && wiped.size === 0)
      ? result
      : result.filter((a) => !isDeadCmd(a.commanderUuid) && !isDeadCmd(a.primaryUuid) && !inWipedSettlement(a));
    return filtered;
  }, [saveLiveArmies, armiesData, cityPixels, liveCharPositionsVersion, useLiveOverride, saveCurrentTurn, regions, imgSize]);

  // Live-aware unitsByRegion: re-bucket save-tagged units using the
  // commander's CURRENT region from armiesToRender, so the side panel
  // reflects mid-turn moves the same way the map markers do. The save's
  // unit-record region is frozen to the last save; armiesToRender layers
  // log-position events on top, giving us each commander's tile-accurate
  // location. If a commander has no live entry (or pixelData isn't ready),
  // we fall back to the save's region.
  // Build runtime char uuid → save secondaryUuid bridge ONCE from the
  // current liveUnitFlow snapshot, exposing both directions:
  //   mergedSecondaryByDonor: donor save secondary → recipient save secondary
  //   mergedRecipients: set of all recipient save secondaries
  // Used by liveUnitsByRegion (foot donation), the region panel's
  // mergeByTile (combine merged-into entries), and the map hover tooltip.
  const mergedPairsBySecondary = useMemo(() => {
    const out = new Map();
    const flow = liveUnitFlow.current || [];
    if (flow.length === 0 || !saveCharactersByRegion) return out;
    // Index save chars by (firstName, lastName) for unambiguous bridge.
    const pairMatches = new Map();
    for (const arr of Object.values(saveCharactersByRegion)) {
      for (const c of arr) {
        if (!c.secondaryUuid || !c.firstName) continue;
        const last = ((c.lastName || "").replace(/_/g, " ").toLowerCase());
        const key = (c.firstName || "").toLowerCase() + "|" + last;
        if (!pairMatches.has(key)) pairMatches.set(key, []);
        pairMatches.get(key).push(c.secondaryUuid);
      }
    }
    const parse = (n) => {
      if (!n) return null;
      const clean = String(n).toLowerCase().replace(/^(captain|admiral|general)\s+/, "").replace(/\s+the\s+\S+$/i, "");
      const parts = clean.split(/\s+/);
      return parts[0] + "|" + parts.slice(1).join(" ");
    };
    const bridge = (name) => {
      if (!name) return null;
      const k = parse(name);
      if (!k) return null;
      const matches = pairMatches.get(k);
      if (!matches || matches.length !== 1) return null;
      return matches[0];
    };
    for (const f of flow) {
      const donor = bridge(f.fromName);
      const target = bridge(f.toName);
      if (donor && target && donor !== target) {
        // Resolve transitive chains (A→B, B→C ⇒ A→C).
        let final = target;
        for (let i = 0; i < 20; i++) {
          const next = out.get(final);
          if (!next || next === final) break;
          final = next;
        }
        out.set(donor, final);
      }
    }
    return out;
  }, [liveCharPositionsVersion, saveCharactersByRegion]);

  const liveUnitsByRegion = useMemo(() => {
    if (!saveUnitsByRegion) return null;
    // Only override the unit's save-time region tag when the commander's
    // CURRENT position came from a live-log event (`liveTracked`). For
    // save-derived positions, tileToRegion(a.x, a.y) can drift to an
    // adjacent region purely because the bodyguard's world-object record
    // sits a couple of tiles off the settlement marker — Quintus
    // Ogulnius_Gallus, the appointed governor of Rome at (285, 404), is
    // 1-3 tiles away from Rome's center pixel and resolves to a
    // neighbouring region's RGB; without this gate his 13 units (bg +
    // 12 foot via Pass 2) bucketed out of Roma's panel even though their
    // save region tag IS "Roma". User report: "Rome should list armies
    // but Field armies: None". Save region is authoritative when there's
    // no live-log signal.
    const cmdToLiveRegion = new Map();
    // Build a settlement-tile set for the save-derived position fast path
    // below. cityPixels is the in-memory list of (x, y, rgbKey) for every
    // settlement on the map. World-army positions use BOTTOM-UP world y,
    // while cityPixels.y is TOP-DOWN pixel y — flip when comparing.
    const settlementTilesByXy = new Set();
    const H_world2 = imgSize.height;
    for (const cp of (cityPixels || [])) {
      const worldY = (H_world2 - 1) - cp.y;
      settlementTilesByXy.add(`${cp.x},${worldY}`);
    }
    for (const a of armiesToRender) {
      if (!a.commanderUuid || !a.region) continue;
      // Live-tracked: log told us the up-to-date region.
      if (a.liveTracked) { cmdToLiveRegion.set(a.commanderUuid, a.region); continue; }
      // Save-derived position on a settlement tile: trust it over the
      // stale unit-record region tag. The engine doesn't update the unit-
      // record region when a general moves, so after Aulus marches from
      // Taras to Uria and occupies, his bodyguard unit still says
      // region=Taras while the world-object record places him at Uria's
      // settlement tile. The 0.9.282 fix avoided this override generally
      // because save positions can drift 1-3 tiles off settlement
      // markers — but here we ONLY override when the army's x/y match
      // EXACTLY a known settlement-tile, where the region is unambiguous.
      if (typeof a.x === "number" && typeof a.y === "number"
          && settlementTilesByXy.has(`${a.x},${a.y}`)
          && a.region) {
        cmdToLiveRegion.set(a.commanderUuid, a.region);
      }
    }
    const deadUuids = liveDeadCharUuids.current;
    const isCmdDead = (cmd) => {
      if (!cmd || deadUuids.size === 0) return false;
      return deadUuids.has(cmd.toString(16).padStart(8, "0"));
    };
    const wiped = liveAssaultWipedSettlements.current;
    // 0.9.290+ re-enables the unit-flow override that 0.9.272 reverted.
    // Safer reattempt: main.js now records the donor's full name on each
    // transfer event (charNameByRuntimeUuid), and the renderer bridges
    // runtime char uuids → save secondaryUuids ONLY via strict
    // (firstName, lastName, faction) triple match. If either donor or
    // recipient can't bridge unambiguously, the flow is skipped — no
    // first-name-only fallback that caused the Uria flood.
    //
    // Donor-side guard: only foot units in the SAME region as the donor's
    // bodyguard are eligible to donate, so a stale region tag elsewhere
    // can't bleed cross-region. Recipient receives by relabeling
    // inferredCmd → recipient.secondaryUuid; the unit's `region` field
    // is left alone (the bodyguard's live position drives bucketing via
    // cmdToLiveRegion above).
    //
    // Build runtime char uuid → save secondaryUuid bridge.
    const flow = liveUnitFlow.current || [];
    const runtimeToSaveSecondary = new Map();
    if (flow.length > 0 && saveCharactersByRegion) {
      // Flatten save chars + index by (firstName, lastName, faction) AND
      // by (firstName, lastName) for the faction-unknown fallback below.
      // Recipients (e.g. Aulus when Marcus merges INTO him) don't emit
      // MOVING_NORMAL events, so their faction isn't in
      // factionByRuntimeUuid. If their name pair is unique across the
      // entire save char list, that's enough — we accept it.
      const tripleMatches = new Map();
      const pairMatches = new Map();
      for (const list of Object.values(saveCharactersByRegion)) {
        for (const c of list) {
          if (!c.secondaryUuid || !c.firstName) continue;
          const last = ((c.lastName || "").replace(/_/g, " ").toLowerCase());
          const tripleKey = (c.firstName || "").toLowerCase() + "|" + last + "|" + ((c.faction || "").toLowerCase());
          if (!tripleMatches.has(tripleKey)) tripleMatches.set(tripleKey, []);
          tripleMatches.get(tripleKey).push(c.secondaryUuid);
          const pairKey = (c.firstName || "").toLowerCase() + "|" + last;
          if (!pairMatches.has(pairKey)) pairMatches.set(pairKey, []);
          pairMatches.get(pairKey).push(c.secondaryUuid);
        }
      }
      const parseRuntimeName = (fullName) => {
        if (!fullName) return null;
        const clean = String(fullName).toLowerCase().replace(/^(captain|admiral|general)\s+/, "").replace(/\s+the\s+\S+$/i, "");
        const parts = clean.split(/\s+/);
        return { first: parts[0] || "", last: parts.slice(1).join(" ") };
      };
      // For each flow entry, try to bridge.
      const factionByRuntimeUuid = new Map();
      for (const v of liveCharPositions.current.values()) {
        if (v.charUuid && v.faction) factionByRuntimeUuid.set(v.charUuid, v.faction.toLowerCase());
      }
      const bridgeOne = (runtimeUuid, runtimeName) => {
        if (!runtimeUuid || !runtimeName) return null;
        const p = parseRuntimeName(runtimeName);
        if (!p) return null;
        const fac = factionByRuntimeUuid.get(runtimeUuid);
        // Tier 1: full triple match (preferred).
        if (fac) {
          const key = p.first + "|" + p.last + "|" + fac;
          const matches = tripleMatches.get(key);
          if (matches && matches.length === 1) return matches[0];
        }
        // Tier 2: unique (firstName, lastName) match across ALL save chars
        // when faction is unknown (recipient of a merge never emits a
        // MOVING_NORMAL with their faction). Skipped if the name pair
        // collides — keeps us safe from the 0.9.271 first-name flood.
        const pairKey = p.first + "|" + p.last;
        const pairList = pairMatches.get(pairKey);
        if (pairList && pairList.length === 1) return pairList[0];
        return null;
      };
      for (const f of flow) {
        const donorSecondary = bridgeOne(f.from, f.fromName);
        const recipientSecondary = bridgeOne(f.to, f.toName);
        if (donorSecondary && recipientSecondary) {
          runtimeToSaveSecondary.set(f.from, donorSecondary);
          runtimeToSaveSecondary.set(f.to, recipientSecondary);
        }
      }
    }
    // Build the per-flow donation plan: { donorSecondary → { recipientSecondary → count } }.
    const donationPlan = new Map();
    for (const f of flow) {
      const donor = runtimeToSaveSecondary.get(f.from);
      const recipient = runtimeToSaveSecondary.get(f.to);
      if (!donor || !recipient || donor === recipient) continue;
      if (!donationPlan.has(donor)) donationPlan.set(donor, new Map());
      const inner = donationPlan.get(donor);
      inner.set(recipient, (inner.get(recipient) || 0) + (f.count || 0));
    }
    // Locate each donor's bodyguard region for the region-aware donor guard.
    // Only foot units in that same region are eligible to donate.
    const donorRegion = new Map();
    if (donationPlan.size > 0) {
      for (const [region, units] of Object.entries(saveUnitsByRegion)) {
        for (const u of units) {
          if (u.commanderUuid && donationPlan.has(u.commanderUuid) && !donorRegion.has(u.commanderUuid)) {
            donorRegion.set(u.commanderUuid, region);
          }
        }
      }
    }
    const out = {};
    // Per-donor cursor: how many foot units have we already donated from this donor
    // (across all recipients). Stops double-donating when multiple flows target
    // different recipients from the same source.
    const donatedCount = new Map();
    // Apply donations during the bucketing pass. For each foot unit whose
    // inferredCmd === a planned donor AND is in the donor's bodyguard region,
    // pop from the donation plan and rebind inferredCmd to the recipient.
    const advanceDonation = (donorSec) => {
      const plan = donationPlan.get(donorSec);
      if (!plan) return null;
      const consumed = donatedCount.get(donorSec) || 0;
      let running = 0;
      for (const [recipient, count] of plan) {
        running += count;
        if (consumed < running) {
          donatedCount.set(donorSec, consumed + 1);
          return recipient;
        }
      }
      return null;
    };
    for (const [region, units] of Object.entries(saveUnitsByRegion)) {
      for (const u of units) {
        if (wiped.size > 0 && u.region && wiped.has(u.region.toLowerCase())) continue;
        let cmd = u.commanderUuid || u.inferredCmd || 0;
        if (isCmdDead(cmd)) continue;
        // Foot unit (no commanderUuid) whose inferred general is a donor:
        // possibly redirect to a recipient. Only when in the donor's region.
        let unitOut = u;
        if (!u.commanderUuid && u.inferredCmd && donationPlan.has(u.inferredCmd)
            && donorRegion.get(u.inferredCmd) === region) {
          const newCmd = advanceDonation(u.inferredCmd);
          if (newCmd) {
            unitOut = { ...u, inferredCmd: newCmd };
            cmd = newCmd;
          }
        }
        const effective = (cmd && cmdToLiveRegion.get(cmd)) || region;
        if (!out[effective]) out[effective] = [];
        out[effective].push(unitOut);
      }
    }
    return out;
  }, [saveUnitsByRegion, armiesToRender, liveCharPositionsVersion, saveCharactersByRegion]);
  const [homelandsData, setHomelandsData] = useState({}); // faction → [hidden_resource, ...]
  // [{ name, count, group }, ...] — every hidden-resource token in the active
  // campaign, classified into a logical group. Group classification is
  // data-driven: faction homelands → Faction, r.ethnicities tokens → Ethnic,
  // r.region/r.city → Settlement, _aor suffix → AoR, contains "merc" →
  // Mercenary, otherwise Other. Must live AFTER the homelandsData useState so
  // we don't reference it inside its own TDZ during the first render pass.
  const hiddenResourcesList = useMemo(() => {
    const counts = {};
    for (const r of Object.values(regions || {})) {
      for (const tok of getHiddenResources(r.tags)) counts[tok] = (counts[tok] || 0) + 1;
    }
    const factionSet = new Set();
    for (const list of Object.values(homelandsData || {})) {
      for (const h of (list || [])) factionSet.add(String(h).toLowerCase());
    }
    const ethnicSet = new Set();
    const settlementSet = new Set();
    for (const r of Object.values(regions || {})) {
      for (const e of parseEthnicities(r.ethnicities || "")) ethnicSet.add(e.name.toLowerCase());
      if (r.region) settlementSet.add(String(r.region).toLowerCase());
      if (r.city) settlementSet.add(String(r.city).toLowerCase());
    }
    const classify = (name) => {
      const t = name.toLowerCase();
      if (factionSet.has(t)) return "Faction";
      if (ethnicSet.has(t)) return "Ethnic";
      if (settlementSet.has(t)) return "Settlement";
      if (t.endsWith("_aor")) return "Area of Recruitment";
      if (t.includes("merc")) return "Mercenary";
      return "Other";
    };
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count, group: classify(name) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [regions, homelandsData]);
  const [showGarrisons, setShowGarrisons] = useState(true);
  const [showFieldArmies, setShowFieldArmies] = useState(true);
  const [showNavies, setShowNavies] = useState(true);
  const [hoveredArmy, setHoveredArmy] = useState(null); // { army, screenX, screenY }
  const [hoveredResource, setHoveredResource] = useState(null); // { type, amount, screenX, screenY }
  const [legendFilter, setLegendFilter] = useState(null); // culture/religion name to highlight
  const [pinnedRegions, setPinnedRegions] = useState(
    () => { try { return JSON.parse(localStorage.getItem("pinnedRegions") || "[]"); } catch { return []; } }
  );
  const [populationData, setPopulationData] = useState({});
  const [dimOverlay, setDimOverlay] = useState(null);
  const [factionSearch, setFactionSearch] = useState("");
  const [classicToImperial, setClassicToImperial] = useState(null); // city mapping
  const [classicVictory, setClassicVictory] = useState(null); // parsed classic victory conditions
  const [portedVictory, setPortedVictory] = useState(null); // ported conditions (null = not computed)
  const [showPortedVictory, setShowPortedVictory] = useState(false); // toggle ported vs original
  const [savedOriginalVictory, setSavedOriginalVictory] = useState(null); // backup of original
  const [legendSearch, setLegendSearch] = useState("");
  const [exportConfirm, setExportConfirm] = useState(false);

  // ── Live log watcher state ──
  const [liveLogActive, setLiveLogActive] = useState(false);
  const [liveLogEvents, setLiveLogEvents] = useState([]); // [{type, text, turn, ts}]
  const [liveLogTurn, setLiveLogTurn] = useState(null); // {turn, year, season, faction}
  // Number of Turn-End events seen since activation. Used to gate save-derived
  // building overrides — the heuristic save parser produces false positives
  // when the game is still on turn 0, so only trust it once a turn has ended.
  const [liveTurnsEnded, setLiveTurnsEnded] = useState(0);
  // Player's faction for live mode. Persisted so repeat launches remember.
  const [playerFaction, setPlayerFaction] = useState(() => {
    try { return localStorage.getItem("playerFaction") || null; } catch { return null; }
  });
  // Ref mirror so the save-snapshot handler (inside an effect) always sees the
  // current playerFaction without re-subscribing on every change.
  const playerFactionRef = useRef(playerFaction);
  useEffect(() => { playerFactionRef.current = playerFaction; }, [playerFaction]);
  const [showFactionPicker, setShowFactionPicker] = useState(false);
  const [liveLogDir, setLiveLogDir] = useState(() => {
    try { return localStorage.getItem("liveLogDir") || null; } catch { return null; }
  });
  // Save dir is per-campaign (Alex saves to .../Alexander/saves, BI to
  // .../Barbarian Invasion/saves, vanilla to .../Rome/saves) — independent
  // of the log dir (RR writes logs into .../Rome/logs regardless).
  const [liveSaveDir, setLiveSaveDir] = useState(() => {
    try { return localStorage.getItem("liveSaveDir") || null; } catch { return null; }
  });
  // User-pinned save filename. null = follow the newest-by-mtime (default).
  // When set, the save-watcher reparses this specific file on every change,
  // so loading an older save in-game + re-saving it over itself updates the UI.
  const [pinnedSaveFile, setPinnedSaveFile] = useState(() => {
    try { return localStorage.getItem("pinnedSaveFile") || null; } catch { return null; }
  });
  const [liveHistory, setLiveHistory] = useState([]); // all events across sessions, persisted
  const [liveSliderTurn, setLiveSliderTurn] = useState(null); // null = live/latest, number = rewound to turn N
  const [livePlayback, setLivePlayback] = useState(false); // true = auto-advancing turns
  const livePlaybackRef = useRef(null); // interval ID
  const baseRegionsRef = useRef(null); // snapshot of regions at time Live was activated
  const baseFactionMapRef = useRef(null); // snapshot of factionRegionsMap at time Live was activated

  // Undo/Redo stacks — stores snapshots of {regions, resourcesData, populationData, victoryConditions}
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const pushUndoRef = useRef(() => {});
  const UNDO_LIMIT = 50;

  const pushUndo = useCallback(() => {
    undoStackRef.current.push({
      regions: { ...regions },
      resourcesData: JSON.parse(JSON.stringify(resourcesData)),
      populationData: { ...populationData },
      victoryConditions: JSON.parse(JSON.stringify(victoryConditions)),
    });
    if (undoStackRef.current.length > UNDO_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = []; // clear redo on new action
  }, [regions, resourcesData, populationData, victoryConditions]);
  pushUndoRef.current = pushUndo;

  const popUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    // Push current state to redo before restoring
    redoStackRef.current.push({
      regions: { ...regions },
      resourcesData: JSON.parse(JSON.stringify(resourcesData)),
      populationData: { ...populationData },
      victoryConditions: JSON.parse(JSON.stringify(victoryConditions)),
    });
    const snapshot = undoStackRef.current.pop();
    setRegions(snapshot.regions);
    setResourcesData(snapshot.resourcesData);
    setPopulationData(snapshot.populationData);
    setVictoryConditions(snapshot.victoryConditions);
  }, [regions, resourcesData, populationData, victoryConditions]);

  const popRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    // Push current state to undo before restoring
    undoStackRef.current.push({
      regions: { ...regions },
      resourcesData: JSON.parse(JSON.stringify(resourcesData)),
      populationData: { ...populationData },
      victoryConditions: JSON.parse(JSON.stringify(victoryConditions)),
    });
    const snapshot = redoStackRef.current.pop();
    setRegions(snapshot.regions);
    setResourcesData(snapshot.resourcesData);
    setPopulationData(snapshot.populationData);
    setVictoryConditions(snapshot.victoryConditions);
  }, [regions, resourcesData, populationData, victoryConditions]);

  // ── Live Log Parser ──
  // Parses Rome Remastered log lines and extracts game events
  const parseLogLines = useCallback((source, text) => {
    const lines = text.split(/\r?\n/);
    const events = [];
    for (const line of lines) {
      // Turn marker from campaign_ai_log
      // AI: Campaign saved: "./saves/save_Autosave   The House of Claudii   Turn 2 End.sav" for year -270, season summer
      const turnMatch = line.match(/Campaign saved:.*save_Autosave\s+(.+?)\s+Turn (\d+) (Start|End)\.sav.*for year (-?\d+), season (\w+)/);
      if (turnMatch) {
        events.push({ type: "turn", campaign: turnMatch[1].trim(), turn: parseInt(turnMatch[2]), phase: turnMatch[3], year: parseInt(turnMatch[4]), season: turnMatch[5] });
        continue;
      }
      // Faction turn start from campaign_ai_log
      // AI: 				start 'romans_julii' for year -270, season summer
      const factionTurnMatch = line.match(/start '([^']+)' for year (-?\d+), season (\w+)/);
      if (factionTurnMatch) {
        events.push({ type: "faction_turn", faction: factionTurnMatch[1], year: parseInt(factionTurnMatch[2]), season: factionTurnMatch[3] });
        continue;
      }
      // Settlement capture from message_log
      // faction(romans_julii) captures Asculum from slave. Reason - CAPTURED
      const captureMatch = line.match(/faction\(([^)]+)\) captures ([^ ]+) from ([^.]+)\. Reason - (\w+)/);
      if (captureMatch) {
        events.push({ type: "capture", faction: captureMatch[1], settlement: captureMatch[2], from: captureMatch[3], reason: captureMatch[4] });
        continue;
      }
      // Surrender event — fires just BEFORE the matching capture line, and
      // its `reason` distinguishes a successful assault (whole garrison
      // dies) from peaceful surrender or auto-capture of an abandoned
      // settlement. The capture event itself always has reason=CAPTURED so
      // it can't tell them apart on its own.
      // faction(messapians) surrenders Brundisium to faction(romans_julii). Reason - SUCCESSFUL_ASSAULT
      const surrenderMatch = line.match(/faction\(([^)]+)\) surrenders ([^ ]+) to faction\(([^)]+)\)\. Reason - (\w+)/);
      if (surrenderMatch) {
        events.push({ type: "surrender", from: surrenderMatch[1], settlement: surrenderMatch[2], to: surrenderMatch[3], reason: surrenderMatch[4] });
        continue;
      }
      // Region attachment
      // attaching region Picenum(155) to faction(romans_julii)
      const attachMatch = line.match(/attaching region ([^(]+)\((\d+)\) to faction\(([^)]+)\)/);
      if (attachMatch) {
        events.push({ type: "region_attach", region: attachMatch[1], regionId: parseInt(attachMatch[2]), faction: attachMatch[3] });
        continue;
      }
      // Siege begin/end from message_log
      // siege by X on Settlement(x,y) has begun/ended
      const siegeMatch = line.match(/siege by ([^(]+)\([^)]*\)(?:\(army:[^)]*\))? on ([^(]+)\((\d+),(\d+)\) has been (ended|begun)/);
      if (!siegeMatch) {
        const siegeMatch2 = line.match(/siege by ([^(]+)\([^)]*\) on ([^(]+)\((\d+),(\d+)\) has (begun)/);
        if (siegeMatch2) {
          events.push({ type: "siege", general: siegeMatch2[1].trim(), settlement: siegeMatch2[2].trim(), x: parseInt(siegeMatch2[3]), y: parseInt(siegeMatch2[4]), status: siegeMatch2[5] });
          continue;
        }
      } else {
        events.push({ type: "siege", general: siegeMatch[1].trim(), settlement: siegeMatch[2].trim(), x: parseInt(siegeMatch[3]), y: parseInt(siegeMatch[4]), status: siegeMatch[5] });
        continue;
      }
      // Protectorate from message_log
      // Faction X has become a protectorate of faction Y
      const protMatch = line.match(/Faction ([A-Z_]+)\(\d+\) has become a protectorate of faction ([A-Z_]+)/);
      if (protMatch) {
        events.push({ type: "protectorate", vassal: protMatch[1], lord: protMatch[2] });
        continue;
      }
      // Population from campaign_ai_log
      // AI: region control: settlement 'X', (pop N, old order N), tax TAX_LEVEL_X
      const popMatch = line.match(/settlement '([^']+)', \(pop (\d+), old order (-?\d+)\), tax (\w+)/);
      if (popMatch) {
        events.push({ type: "population", settlement: popMatch[1], pop: parseInt(popMatch[2]), order: parseInt(popMatch[3]), tax: popMatch[4] });
        continue;
      }
      // Finance from campaign_ai_log
      // AI: finance: est income N, est maintenance N, est outgoings N
      const finMatch = line.match(/finance: est income (\d+), est maintenance (\d+), est outgoings (\d+).*spending max (\d+), spending norm (-?\d+)/);
      if (finMatch) {
        events.push({ type: "finance", income: parseInt(finMatch[1]), maintenance: parseInt(finMatch[2]), outgoings: parseInt(finMatch[3]), spendingMax: parseInt(finMatch[4]), spendingNorm: parseInt(finMatch[5]) });
        continue;
      }
      // War status from campaign_ai_log
      const warMatch = line.match(/are at war with: (.+)/);
      if (warMatch) {
        events.push({ type: "at_war", enemies: warMatch[1].split(",").map(s => s.trim()).filter(Boolean) });
        continue;
      }
      // New round start from message_log
      const roundMatch = line.match(/new round start turn\(([^)]+)\)/);
      if (roundMatch) {
        events.push({ type: "round_start", faction: roundMatch[1] });
        continue;
      }
      // Army movement from message_log
      // Name(id:army(id):faction:named character):ACTION:start(x,y):end(x2,y2)
      const moveMatch = line.match(/([^(]+)\([0-9a-f]+:army\([0-9a-f]+\):([a-z_]+):named character\):(\w+):start\((\d+),(\d+)\):end\((\d+),(\d+)\)/);
      if (moveMatch) {
        events.push({
          type: "army_move",
          name: moveMatch[1].trim(),
          faction: moveMatch[2],
          action: moveMatch[3],
          fromX: parseInt(moveMatch[4]), fromY: parseInt(moveMatch[5]),
          toX: parseInt(moveMatch[6]), toY: parseInt(moveMatch[7]),
        });
        continue;
      }
      // Settlement damage (riot, disaster, siege damage) from message_log
      // settlement 'Suza' damaged (riot, 968 deaths)
      const damMatch = line.match(/^settlement '([^']+)' damaged \(([^,]+), (\d+) deaths\)/);
      if (damMatch) {
        events.push({
          type: "settlement_damaged",
          settlement: damMatch[1],
          cause: damMatch[2].trim(),
          deaths: parseInt(damMatch[3]),
        });
        continue;
      }
      // Autoresolved battle outcome from message_log
      // Name(uuid) has defeated Name(uuid) in an autoresolved battle
      const battleMatch = line.match(/^(.+?)\([0-9a-f]+\) has defeated (.+?)\([0-9a-f]+\) in an autoresolved battle/);
      if (battleMatch) {
        events.push({
          type: "battle_outcome",
          winner: battleMatch[1].trim(),
          loser: battleMatch[2].trim(),
        });
        continue;
      }
    }
    return events;
  }, []);

  // Process parsed events — update map state
  // Replay capture/region_attach events onto base state up to a given turn
  const replayToTurn = useCallback((targetTurn, history, baseRegions, baseFactionMap) => {
    if (!baseRegions || !baseFactionMap) return;
    const replayRegions = {};
    for (const [k, v] of Object.entries(baseRegions)) replayRegions[k] = { ...v };
    const replayFactionMap = {};
    for (const [f, regs] of Object.entries(baseFactionMap)) replayFactionMap[f] = [...regs];

    for (const ev of history) {
      if (ev._turn > targetTurn) break;
      if (ev.type === "capture" || ev.type === "region_attach") {
        const settlement = ev.settlement || ev.region;
        const faction = ev.faction;
        // Remove from all factions
        for (const f of Object.keys(replayFactionMap)) {
          replayFactionMap[f] = replayFactionMap[f].filter(r => r.toLowerCase() !== settlement.toLowerCase());
        }
        // Add to new faction
        if (!replayFactionMap[faction]) replayFactionMap[faction] = [];
        if (!replayFactionMap[faction].some(r => r.toLowerCase() === settlement.toLowerCase())) {
          replayFactionMap[faction].push(settlement);
        }
        // Update region
        for (const [rgbKey, r] of Object.entries(replayRegions)) {
          if (r.city?.toLowerCase() === settlement.toLowerCase() || r.region?.toLowerCase() === settlement.toLowerCase()) {
            replayRegions[rgbKey] = { ...r, faction };
            break;
          }
        }
      }
    }
    setRegions(replayRegions);
    setFactionRegionsMap(replayFactionMap);
  }, []);

  // Track current turn number and campaign name for tagging events
  const currentTurnRef = useRef(0);
  const currentCampaignRef = useRef(null);

  const processLogEvents = useCallback((events, isBackfill = false) => {
    let newHistory = [];
    let needsTruncate = false;
    let truncateTurn = 0;
    let needsReset = false;

    for (const ev of events) {
      if (ev.type === "turn") {
        // Detect new campaign: Turn 1 appearing when we already have history beyond Turn 1
        // This means the logs were cleared (game restarted) and a new campaign began
        if (ev.turn === 1 && ev.phase === "End" && currentTurnRef.current > 1) {
          needsReset = true;
          // Generate a unique campaign ID from timestamp
          currentCampaignRef.current = `${ev.campaign || "unknown"}_${Date.now()}`;
        }
        // Detect reload: incoming turn is less than what we've already seen (but not a new campaign)
        if (ev.campaign && !needsReset) currentCampaignRef.current = ev.campaign;
        if (ev.turn < currentTurnRef.current && !needsReset) {
          needsTruncate = true;
          truncateTurn = ev.turn;
        }
        currentTurnRef.current = ev.turn;
        setLiveLogTurn(prev => ({ ...prev, turn: ev.turn, phase: ev.phase, year: ev.year, season: ev.season, campaign: ev.campaign }));
        // On turn end, trigger save file parse for building/army updates,
        // and mark that we've seen at least one real turn so the UI can
        // trust save-derived data from here on.
        if (ev.phase === "End" && !isBackfill) {
          setLiveTurnsEnded(n => n + 1);
          const api = window.electronAPI;
          if (api?.saveCheckNow) api.saveCheckNow();
        }
      }
      // Tag every event with current turn
      const tagged = { ...ev, _turn: currentTurnRef.current, ts: Date.now() };
      newHistory.push(tagged);
    }

    // Handle new campaign — clear all history, reset base state
    if (needsReset) {
      setLiveHistory([]);
      setLiveLogEvents([]);
      setLiveSliderTurn(null);
      // Re-snapshot base state from current loaded data
      if (baseRegionsRef.current && baseFactionMapRef.current) {
        setRegions(JSON.parse(JSON.stringify(baseRegionsRef.current)));
        setFactionRegionsMap(JSON.parse(JSON.stringify(baseFactionMapRef.current)));
      }
      // Only keep events from the new campaign
      const api = window.electronAPI;
      if (api?.saveUserFile) api.saveUserFile("live_history.json", JSON.stringify(newHistory));
      setLiveHistory(newHistory);
    } else if (needsTruncate) {
      // Reload detected — truncate history to before the reload turn, then append new
      setLiveHistory(prev => {
        const truncated = prev.filter(e => e._turn < truncateTurn);
        const next = [...truncated, ...newHistory];
        const api = window.electronAPI;
        if (api?.saveUserFile) api.saveUserFile("live_history.json", JSON.stringify(next));
        // Replay state from base to current
        if (baseRegionsRef.current && baseFactionMapRef.current) {
          replayToTurn(currentTurnRef.current, next, baseRegionsRef.current, baseFactionMapRef.current);
        }
        return next;
      });
      setLiveSliderTurn(null);
    } else {
      // Normal case — append and apply live
      for (const ev of events) {
        if (!isBackfill && (ev.type === "capture" || ev.type === "region_attach")) {
          const settlement = ev.settlement || ev.region;
          const faction = ev.faction;
          setFactionRegionsMap(prev => {
            const next = {};
            for (const [f, regs] of Object.entries(prev)) next[f] = [...regs];
            for (const f of Object.keys(next)) next[f] = next[f].filter(r => r.toLowerCase() !== settlement.toLowerCase());
            if (!next[faction]) next[faction] = [];
            if (!next[faction].some(r => r.toLowerCase() === settlement.toLowerCase())) next[faction].push(settlement);
            return next;
          });
          // Do the city-name lookup inside setRegions's updater so we read
          // the CURRENT regions state (the outer `regions` variable here
          // is stale — processLogEvents is a useCallback with deps
          // [replayToTurn], so the captured `regions` is the initial empty
          // map from first render and never updates). The settlement from
          // the regex is the REGION name (e.g. "Salentinia"); we need to
          // map it to the CITY name (e.g. "Uria") to key
          // currentOwnerByCity — the map render's live-ownership override
          // (App.js:3767). Without this update the region keeps its
          // pre-capture color even though the live panel shows
          // "X attached to Y".
          setRegions(prev => {
            const next = { ...prev };
            let cityName = null;
            for (const [rgbKey, r] of Object.entries(next)) {
              if (r.city?.toLowerCase() === settlement.toLowerCase() || r.region?.toLowerCase() === settlement.toLowerCase()) {
                next[rgbKey] = { ...r, faction };
                cityName = r.city || null;
                break;
              }
            }
            // Chain currentOwnerByCity update with the city we just
            // resolved. React batches state updates issued from within
            // another updater; this fires in the same render cycle.
            if (cityName) {
              setCurrentOwnerByCity(prevOwner => {
                if (!prevOwner) return prevOwner;
                return { ...prevOwner, [cityName]: faction };
              });
            }
            return next;
          });
        }
        // Successful-assault surrender: the entire garrison of the losing
        // faction inside this settlement dies on the same turn. Track so
        // liveUnitsByRegion + the Characters panel can drop them without
        // waiting for a save refresh (user report: Titus survived in the
        // panel after Marcus stormed Brundisium, no new save since the
        // siege resolution). Defenders parked OUTSIDE the settlement
        // aren't on this list — their region tag isn't this settlement.
        if (!isBackfill && ev.type === "surrender" && ev.reason === "SUCCESSFUL_ASSAULT" && ev.settlement) {
          liveAssaultWipedSettlements.current.add(ev.settlement.toLowerCase());
          // Force liveUnitsByRegion + armiesToRender memos to recompute.
          setLiveCharPositionsVersion(v => v + 1);
        }
      }
      // Append to persistent history
      if (newHistory.length > 0) {
        setLiveHistory(prev => {
          const next = [...prev, ...newHistory];
          const api = window.electronAPI;
          if (api?.saveUserFile) api.saveUserFile("live_history.json", JSON.stringify(next));
          return next;
        });
      }
    }

    // Update army positions from log movement events
    // Log coords use bottom-up Y; map image uses top-down: mapY = mapHeight - logY
    const mh = (CAMPAIGNS[mapCampaign]?.mapHeight || 350) - 1;
    for (const ev of events) {
      if (ev.type === "army_move") {
        // For BESIEGE/ASSAULT, 'end' is the settlement — use 'start' (army's actual position)
        const useFrom = ev.action === 'BESIEGE' || ev.action === 'ASSAULT' || ev.action === 'CAPTURE_RESIDENCE';
        const mapX = useFrom ? ev.fromX : ev.toX;
        const mapY = mh - (useFrom ? ev.fromY : ev.toY);
        setArmiesData(prev => {
          // Find by name + faction
          const idx = prev.findIndex(a => a.name === ev.name && a.faction === ev.faction);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], x: mapX, y: mapY };
            return updated;
          }
          return prev; // unknown army, skip
        });
      }
    }

    // Track active sieges
    for (const ev of events) {
      if (ev.type === "siege") {
        setActiveSieges(prev => {
          const next = { ...prev };
          if (ev.status === "begun") {
            next[ev.settlement] = { general: ev.general, x: ev.x, y: ev.y };
          } else if (ev.status === "ended") {
            delete next[ev.settlement];
          }
          return next;
        });
      }
    }

    // Add to visible event log (keep last 200)
    setLiveLogEvents(prev => {
      const important = newHistory.filter(e => ["capture", "region_attach", "siege", "turn", "protectorate", "round_start", "building_new", "building_upgrade", "building_removed", "building_damaged", "army_arrived", "army_left", "army_changed", "settlement_damaged", "battle_outcome"].includes(e.type));
      if (important.length === 0) return prev;
      // If reset, start fresh
      if (needsReset) return important.slice(-200);
      // If truncated, remove events past truncate point
      const base = needsTruncate ? prev.filter(e => e._turn < truncateTurn) : prev;
      const next = [...base, ...important];
      return next.slice(-200);
    });
  }, [replayToTurn]);

  // Effect: start/stop log watcher
  useEffect(() => {
    if (!liveLogActive || !liveLogDir) return;
    const api = window.electronAPI;
    if (!api?.logWatchStart) return;

    // Start watching
    api.logWatchStart(liveLogDir);

    // Listen for live character moves — authoritative positions from the
    // engine's own movement events, used to keep army markers pixel-
    // accurate between save snapshots.
    const unsubMoves = api.onLiveCharMoves ? api.onLiveCharMoves(({ moves, deaths, reset, unitFlow }) => {
      if (reset) {
        liveCharPositions.current = new Map();
        liveUnitFlow.current = [];
        setLiveCharPositionsVersion(v => v + 1);
        return;
      }
      if (unitFlow) {
        liveUnitFlow.current = unitFlow;
        setLiveCharPositionsVersion(v => v + 1);
      }
      // Key format: "firstName|lastNameStub|faction". lastNameStub is the
      // first word of the character's surname (log: "of Rhodes" → "of",
      // save: "of_Rhodes" → "of_Rhodes" or similar). Empty if no surname.
      const keyFromName = (name, faction) => {
        // Strip role prefix and trailing trait epithet (e.g. "the
        // Defender", "the Drunkard"). What's left is "FirstName +
        // optionally compound surname".
        const cleanRaw = (name || "").toLowerCase().replace(/^(captain|admiral|general|admiral)\s+/, "");
        const clean = cleanRaw.replace(/\s+the\s+\S+$/i, "");
        const parts = clean.split(/\s+/);
        const first = parts[0] || "";
        // Engine logs split compound surnames with SPACES while saves
        // store them with underscores: log "Lucius Valerius Flaccus"
        // vs save "Valerius_Flaccus". Concatenate parts[1..] with
        // underscores stripped so both sides produce "valeriusflaccus"
        // and the keys match. Without this the match cascade's Tier 1
        // (full key) failed for every multi-word Roman surname,
        // leaving their position updates orphaned.
        const lastStub = parts.slice(1).join("").replace(/[_]/g, "");
        return first + "|" + lastStub + "|" + (faction || "").toLowerCase();
      };
      // Store positions ONLY under the canonical key (first|lastStub|faction).
      // Events keep their turn so the armiesToRender memo can filter out
      // events from turns past the currently-loaded save's turn (avoids
      // showing "future" positions when reviewing an older save).
      let changed = false;
      if (moves) {
        for (const m of moves) {
          if (m.x == null || m.y == null || !m.name) continue;
          if (m.x < 0 || m.x > 1100 || m.y < 0 || m.y > 800) continue; // raised 2026-05-09 for RIS imperial 1020x700 map
          const key = keyFromName(m.name, m.faction);
          liveCharPositions.current.set(key, {
            x: m.x, y: m.y, name: m.name, faction: m.faction, role: m.role || null,
            charUuid: m.charUuid || null, turn: m.turn || 0,
          });
          changed = true;
        }
      }
      if (deaths) {
        for (const d of deaths) {
          // Track charUuid for every death so armiesToRender can skip
          // save-derived armies whose commander is dead per the log,
          // even before the next save snapshot writes that fact.
          if (d.charUuid) liveDeadCharUuids.current.add(d.charUuid);
          // Also map the runtime memory uuid in the log back to the save's
          // stored secondaryUuid via a name lookup against
          // saveCharactersByRegionRef. Without this, when the log says
          // "Titus died (charUuid 14f47c40)" the existing uuid filter
          // misses Titus's save entry (his save secondaryUuid is some
          // other value, e.g. cb79a1ae for save_rome10's Aulus). User
          // report: Titus killed at Brundisium siege, no new save yet,
          // his marker + 8-unit roster still showed at the captured tile.
          //
          // Two-pass name match: the DYING log line emits ONLY the first
          // name ("Titus(uuid):DYING..."), but if the same character had
          // emitted a MOVING_NORMAL earlier in this session, livePos has
          // his full name keyed under (first|lastStub|faction). Find that
          // entry by charUuid → recover the full name → match save chars
          // on BOTH first AND last name. Falls back to first-name-only if
          // no live entry exists (e.g. stationary character that never
          // emitted a move).
          if (d.name) {
            const dFirst = d.name.toLowerCase().split(/\s+/)[0];
            // Recover full name + faction from liveCharPositions if
            // possible — engine logs the full surname in MOVING_NORMAL
            // events even when DYING strips it.
            let dLastStub = null;
            let dFaction = (d.faction || "").toLowerCase() || null;
            if (d.charUuid) {
              for (const [k, v] of liveCharPositions.current) {
                if (v.charUuid === d.charUuid) {
                  // k format: "first|lastStub|faction"
                  const parts = k.split("|");
                  if (parts[0] === dFirst) {
                    dLastStub = parts[1] || null;
                    dFaction = dFaction || parts[2] || null;
                  }
                  break;
                }
              }
            }
            const byReg = saveCharactersByRegionRef.current || {};
            for (const list of Object.values(byReg)) {
              for (const c of list) {
                if ((c.firstName || "").toLowerCase() !== dFirst) continue;
                // Last-name discriminator when we recovered one. Save
                // stores compound surnames with underscores; the live
                // lastStub strips those. Use the same normalization on
                // BOTH sides for the compare.
                if (dLastStub) {
                  const cLast = (c.originalLastName || c.lastName || "").toLowerCase().replace(/_/g, "").split(/\s+/)[0];
                  if (cLast !== dLastStub) continue;
                }
                // No faction tag on char records yet, so we can't
                // discriminate further on faction. With first+last match
                // and a recovered lastStub this is unique enough in
                // practice (two characters sharing both first AND last
                // name across factions would be a rare collision).
                if (c.secondaryUuid) liveDeadCharUuids.current.add(c.secondaryUuid.toString(16).padStart(8, "0"));
              }
            }
          }
          if (d.name) {
            const key = keyFromName(d.name, d.faction);
            const entry = liveCharPositions.current.get(key);
            if (entry && entry.charUuid) liveDeadCharUuids.current.add(entry.charUuid);
            if (liveCharPositions.current.delete(key)) changed = true;
          } else if (d.charUuid) {
            // Uuid-only death: iterate the map and drop entries whose stored
            // charUuid matches. Covers "character ptr(uuid) deleted" events
            // where we don't have a name to key by.
            for (const [k, v] of liveCharPositions.current) {
              if (v.charUuid === d.charUuid) {
                liveCharPositions.current.delete(k);
                changed = true;
              }
            }
          }
        }
      }
      if (changed) setLiveCharPositionsVersion(v => v + 1);
    }) : null;

    // Listen for new lines
    const unsub = api.onLogLines(({ source, text }) => {
      if (source === "reset") {
        // Logs were truncated — game restarted, new campaign likely
        currentTurnRef.current = 0;
        setLiveHistory([]);
        setLiveLogEvents([]);
        setLiveSliderTurn(null);
        if (baseRegionsRef.current && baseFactionMapRef.current) {
          setRegions(JSON.parse(JSON.stringify(baseRegionsRef.current)));
          setFactionRegionsMap(JSON.parse(JSON.stringify(baseFactionMapRef.current)));
        }
        const resetApi = window.electronAPI;
        if (resetApi?.saveUserFile) resetApi.saveUserFile("live_history.json", "[]");
        return;
      }
      const events = parseLogLines(source, text);
      if (events.length > 0) processLogEvents(events);
    });

    return () => {
      api.logWatchStop();
      if (unsub) unsub();
      if (unsubMoves) unsubMoves();
    };
  }, [liveLogActive, liveLogDir, parseLogLines, processLogEvents]);

  // Ref to always have latest processLogEvents without re-running the save watcher effect
  const processLogEventsRef = useRef(processLogEvents);
  useEffect(() => { processLogEventsRef.current = processLogEvents; }, [processLogEvents]);
  useEffect(() => { saveCharactersByRegionRef.current = saveCharactersByRegion; }, [saveCharactersByRegion]);

  // Effect: start/stop save file watcher (alongside log watcher)
  useEffect(() => {
    if (!liveLogActive || !liveLogDir) return;
    const api = window.electronAPI;
    if (!api?.saveWatchStart) return;

    // Saves dir is stored separately (campaigns have their own /saves but
    // share /logs under /Rome/logs). Fall back to log-dir-derived path for
    // backwards compatibility with old saved state.
    const saveDir = liveSaveDir || liveLogDir.replace(/[/\\]logs\/?$/, "/saves");

    // Set up listeners BEFORE starting the watcher.
    // Loading banner subscription — flip the indicator on as soon as the
    // user clicks Live so the app doesn't appear frozen during the parse.
    setLiveLoading(true);
    setLiveLoadingStage("Starting live mode...");
    setLiveLoadingStartedAt(Date.now());
    setLiveLoadingElapsedSec(0);
    const unsubProgress = api.onSaveProgress?.(({ stage, pct }) => {
      setLiveLoadingStage(stage || "");
      if (stage === "Done" || pct === 100) {
        liveLoadingStartedAtRef.current = null;
        setTimeout(() => setLiveLoading(false), 250);
      } else {
        // Show the loading banner whenever a progress event arrives —
        // not just on the initial save-watch-start. Reparses triggered
        // by in-game saves emit the same progress events; without this,
        // the user saw a frozen UI with no indication anything was
        // happening (the banner was only flipped on at Live-mode start).
        setLiveLoading(true);
        if (!liveLoadingStartedAtRef.current) {
          liveLoadingStartedAtRef.current = Date.now();
          setLiveLoadingStartedAt(Date.now());
          setLiveLoadingElapsedSec(0);
        }
      }
    });

    const unsubEvents = api.onSaveEvents(({ file, events }) => {
      const saveEvents = events.map(ev => ({
        ...ev,
        _turn: currentTurnRef.current,
        _fromSave: true,
        ts: Date.now(),
      }));
      if (saveEvents.length > 0) processLogEventsRef.current(saveEvents);
    });

    // Re-detect player faction from a save filename. Returns the faction key
    // (or null if no match). Shared between live-mode start and each save
    // snapshot — a new campaign load should flip the detected faction.
    // Uses factionsRef to always see the latest faction list (avoids stale
    // closure if factions load after this effect runs).
    const detectFactionFromSaveName = (filename) => {
      const factionList = factionsRef.current;
      const displayMap = factionDisplayMapRef.current || {};
      if (!filename || !factionList || !factionList.length) {
        console.log("[faction] detect skipped: filename=" + filename + " factions=" + (factionList ? factionList.length : "null"));
        return null;
      }
      const m = filename.match(/save_Autosave\s+(.+?)\s+Turn\s+\d+/i);
      if (!m) { console.log("[faction] filename regex didn't match:", filename); return null; }
      const hint = m[1].trim().toLowerCase();
      // 1. Display map lookup ("The House of Claudii" → "romans_julii")
      let match = displayMap[hint];
      if (match && !factionList.includes(match)) match = null;
      // 2. Direct internal-id match
      if (!match) match = factionList.find(f => f.toLowerCase() === hint);
      // 3. Underscore-to-space match
      if (!match) match = factionList.find(f => f.replace(/_/g, " ").toLowerCase() === hint);
      // 4. Last-word fallback ("Julii" → romans_julii)
      if (!match) {
        const lastWord = hint.split(/\s+/).pop();
        match = factionList.find(f => f.endsWith("_" + lastWord) || f === lastWord);
      }
      console.log("[faction] hint=\"" + hint + "\" → match=" + (match || "NONE") + " (displayMap=" + Object.keys(displayMap).length + " factions=" + factionList.length + ")");
      return match || null;
    };

    const unsubSnapshot = api.onSaveSnapshot(({ file, data }) => {
      // Wall-clock stamp of the latest snapshot — drives the "loaded Xm ago"
      // label, lets the user notice if the watcher's gone quiet.
      setSaveLoadedAt(Date.now());
      // Clear the assault-wiped-settlements list on every save refresh.
      // The wipe was added in 0.9.267 to drop a defender's units from the
      // captured-settlement's panel during the live moment between the
      // surrender event and the next save snapshot. Once a fresh save
      // lands, the save data itself is correct — keeping settlements on
      // the wipe list any longer filters out the new owner's units too
      // (user report: Aulus's 14-unit army at recaptured Taras showed
      // 'No units stationed' because Taras had been wiped earlier in
      // the campaign and never cleared).
      liveAssaultWipedSettlements.current.clear();
      // Same reasoning for the dead-uuid set — those flags were stale-
      // save guards. Once the save is fresh, the death is in the
      // characters list (or NOT in the characters list if the engine
      // dropped them) — so the runtime guard isn't needed.
      liveDeadCharUuids.current.clear();
      setLiveCharPositionsVersion(v => v + 1);
      if (data && data.buildings) setSaveBuildingsData(data.buildings);
      if (data && data.armies) setSaveArmiesData(data.armies);
      if (data && data.queues) setSaveQueues(data.queues);
      if (data && data.taxByCity) setSaveTaxByCity(data.taxByCity);
      if (data && data.happinessByCity) setSaveHappinessByCity(data.happinessByCity);
      if (data && data.populationByCity) setSavePopulationByCity(data.populationByCity);
      if (data && data.incomeByCity) setSaveIncomeByCity(data.incomeByCity);
      if (data && data.sizeByCity) setSaveSizeByCity(data.sizeByCity);
      if (data && data.treasuryByFaction) setSaveTreasuryRecords(data.treasuryByFaction);
      if (data && data.charactersByRegion) setSaveCharactersByRegion(data.charactersByRegion);
      if (data && data.unitsByRegion) setSaveUnitsByRegion(data.unitsByRegion);
      if (data && data.scriptedByFaction) setSaveScriptedByFaction(data.scriptedByFaction);
      if (data && data.currentYear != null) setSaveCurrentYear(data.currentYear);
      if (data && data.currentTurn != null) setSaveCurrentTurn(data.currentTurn);
      if (data && data.factionRecords) setSaveFactionRecords(data.factionRecords);
      if (data && data.luaCounters) setSaveLuaCounters(data.luaCounters);
      if (data && data.governorByCity) setSaveGovernorByCity(data.governorByCity);
      if (data && data.liveArmies) setSaveLiveArmies(data.liveArmies);
      if (data && data.navyDiag) console.log("[navy-diag]", data.navyDiag);
      if (data && data.builtBuildingsByCity) setBuiltBuildingsByCity(data.builtBuildingsByCity);
      if (data && data.queuedBuildingsByCity) setQueuedBuildingsByCity(data.queuedBuildingsByCity);
      if (data && data.initialOwnerByCity) setInitialOwnerByCity(data.initialOwnerByCity);
      if (data && data.currentOwnerByCity) setCurrentOwnerByCity(data.currentOwnerByCity);
      if (file) setLiveSaveFile(file);
      // Re-detect faction on every save — catches campaign switches while live
      // mode stays active (e.g. user quits Dummies and loads a Julii save).
      if (file) {
        const match = detectFactionFromSaveName(file);
        if (match && match !== playerFactionRef.current) {
          setPlayerFaction(match);
          try { localStorage.setItem("playerFaction", match); } catch {}
          setShowFactionPicker(false);
          pushToast(`Detected player faction: ${match.replace(/_/g, " ")}`, "info");
        }
      }
    });

    // Start watcher — returns initial parsed data directly.
    // If the baseline filename encodes the player's faction long name (e.g.
    // "save_Autosave The House of Claudii Turn 1 End.sav"), try to fuzzy-match
    // it against the known faction list and auto-fill playerFaction. If we
    // can't match, the user still has the picker.
    api.saveWatchStart(saveDir, pinnedSaveFile).then(result => {
      if (result?.initialData) {
        const d = result.initialData;
        if (d.buildings) setSaveBuildingsData(d.buildings);
        if (d.armies) setSaveArmiesData(d.armies);
        if (d.queues) setSaveQueues(d.queues);
        if (d.taxByCity) setSaveTaxByCity(d.taxByCity);
        if (d.happinessByCity) setSaveHappinessByCity(d.happinessByCity);
        if (d.populationByCity) setSavePopulationByCity(d.populationByCity);
        if (d.incomeByCity) setSaveIncomeByCity(d.incomeByCity);
        if (d.sizeByCity) setSaveSizeByCity(d.sizeByCity);
        if (d.treasuryByFaction) setSaveTreasuryRecords(d.treasuryByFaction);
        // New parser outputs were missing from the initial-load path — until
        // the user triggered a save, Units / Built / Queued stayed empty.
        if (d.charactersByRegion) setSaveCharactersByRegion(d.charactersByRegion);
        if (d.unitsByRegion) setSaveUnitsByRegion(d.unitsByRegion);
        if (d.scriptedByFaction) setSaveScriptedByFaction(d.scriptedByFaction);
        if (d.currentYear != null) setSaveCurrentYear(d.currentYear);
        if (d.currentTurn != null) setSaveCurrentTurn(d.currentTurn);
        if (d.factionRecords) setSaveFactionRecords(d.factionRecords);
        if (d.luaCounters) setSaveLuaCounters(d.luaCounters);
        if (d.governorByCity) setSaveGovernorByCity(d.governorByCity);
        if (d.liveArmies) setSaveLiveArmies(d.liveArmies);
        if (d.builtBuildingsByCity) setBuiltBuildingsByCity(d.builtBuildingsByCity);
        if (d.queuedBuildingsByCity) setQueuedBuildingsByCity(d.queuedBuildingsByCity);
        if (d.initialOwnerByCity) setInitialOwnerByCity(d.initialOwnerByCity);
        if (d.currentOwnerByCity) setCurrentOwnerByCity(d.currentOwnerByCity);
      }
      if (result?.baseline) setLiveSaveFile(result.baseline);
      if (result?.baseline) {
        const match = detectFactionFromSaveName(result.baseline);
        if (match && match !== playerFactionRef.current) {
          setPlayerFaction(match);
          try { localStorage.setItem("playerFaction", match); } catch {}
          setShowFactionPicker(false);
          pushToast(`Detected player faction: ${match.replace(/_/g, " ")}`, "info");
        } else if (!match && !playerFactionRef.current) {
          const m = result.baseline.match(/save_Autosave\s+(.+?)\s+Turn\s+\d+/i);
          if (m) pushToast(`Couldn't identify faction from save name "${m[1].trim()}" — pick manually.`, "info");
        }
      }
      // Belt-and-braces: even if the "Done" progress event was missed,
      // the resolved promise means parsing is over. Hide the banner.
      setLiveLoading(false);
    });

    return () => {
      api.saveWatchStop();
      if (unsubEvents) unsubEvents();
      if (unsubSnapshot) unsubSnapshot();
      if (unsubProgress) unsubProgress();
      setLiveLoading(false);
      setSaveBuildingsData(null);
      setSaveArmiesData(null);
      setSaveQueues(null);
      setSaveTaxByCity(null);
      setSaveHappinessByCity(null);
      setSavePopulationByCity(null);
      setSaveIncomeByCity(null);
      setSaveSizeByCity(null);
      setSaveTreasuryRecords(null);
      setSaveFactionRecords(null);
      setSaveLuaCounters(null);
      setSaveGovernorByCity(null);
      setSaveCharactersByRegion(null);
      setSaveUnitsByRegion(null);
      setBuiltBuildingsByCity(null);
      setQueuedBuildingsByCity(null);
      setInitialOwnerByCity(null);
      setCurrentOwnerByCity(null);
      setLiveSaveFile(null);
    };
  }, [liveLogActive, liveLogDir, liveSaveDir, pinnedSaveFile]);

  // Effect: playback auto-advance (1.5s per turn)
  useEffect(() => {
    if (livePlaybackRef.current) { clearInterval(livePlaybackRef.current); livePlaybackRef.current = null; }
    if (!livePlayback || !liveLogActive) return;
    const turnEvents = liveHistory.filter(e => e.type === "turn");
    if (turnEvents.length === 0) { setLivePlayback(false); return; }
    const maxTurn = Math.max(...turnEvents.map(e => e._turn || e.turn));
    const minTurn = Math.min(...turnEvents.map(e => e._turn || e.turn));
    // Start from min if at live/max, otherwise from current slider position
    if (liveSliderTurn == null || liveSliderTurn >= maxTurn) {
      setLiveSliderTurn(minTurn);
      if (baseRegionsRef.current && baseFactionMapRef.current) {
        replayToTurn(minTurn, liveHistory, baseRegionsRef.current, baseFactionMapRef.current);
      }
    }
    livePlaybackRef.current = setInterval(() => {
      setLiveSliderTurn(prev => {
        const next = (prev || minTurn) + 1;
        if (next > maxTurn) {
          // Reached the end — stop playback, go live
          setLivePlayback(false);
          if (baseRegionsRef.current && baseFactionMapRef.current) {
            replayToTurn(maxTurn, liveHistory, baseRegionsRef.current, baseFactionMapRef.current);
          }
          return null;
        }
        if (baseRegionsRef.current && baseFactionMapRef.current) {
          replayToTurn(next, liveHistory, baseRegionsRef.current, baseFactionMapRef.current);
        }
        return next;
      });
    }, 1500);
    return () => { if (livePlaybackRef.current) { clearInterval(livePlaybackRef.current); livePlaybackRef.current = null; } };
  }, [livePlayback, liveLogActive, liveHistory, liveSliderTurn, replayToTurn]);

  // ── Dev Autosave System ──
  // Keeps the last 10 per-edit snapshots + periodic 5-min checkpoints (up to 30 total)
  const AUTOSAVE_KEY = "devAutosaves";
  const AUTOSAVE_MAX = 30;
  const AUTOSAVE_RECENT = 10;       // keep last 10 edit-level saves
  const CHECKPOINT_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const [autosaves, setAutosaves] = useState(() => {
    try { return JSON.parse(localStorage.getItem(AUTOSAVE_KEY)) || []; } catch { return []; }
  });
  const [timelineIndex, setTimelineIndex] = useState(null); // null = live (latest state)

  // Save a snapshot to autosave history
  const saveAutosaveSnapshot = useCallback((isCheckpoint = false) => {
    const snapshot = {
      ts: Date.now(),
      checkpoint: isCheckpoint,
      regions: { ...regions },
      resourcesData: JSON.parse(JSON.stringify(resourcesData)),
      populationData: { ...populationData },
      victoryConditions: JSON.parse(JSON.stringify(victoryConditions)),
    };
    setAutosaves(prev => {
      const next = [...prev, snapshot];
      // Prune: keep all checkpoints + last AUTOSAVE_RECENT edit saves, capped at AUTOSAVE_MAX
      const checkpoints = next.filter(s => s.checkpoint);
      const edits = next.filter(s => !s.checkpoint);
      const keptEdits = edits.slice(-AUTOSAVE_RECENT);
      let merged = [...checkpoints, ...keptEdits].sort((a, b) => a.ts - b.ts);
      if (merged.length > AUTOSAVE_MAX) merged = merged.slice(-AUTOSAVE_MAX);
      try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(merged)); } catch {}
      return merged;
    });
    setTimelineIndex(null); // reset to live
  }, [regions, resourcesData, populationData, victoryConditions]);

  // Auto-save on every edit (dev mode only)
  const prevEditsRef = useRef(0);
  useEffect(() => {
    if (!devMode) return;
    if (devEditsCount > prevEditsRef.current) {
      saveAutosaveSnapshot(false);
    }
    prevEditsRef.current = devEditsCount;
  }, [devMode, devEditsCount, saveAutosaveSnapshot]);

  // Periodic checkpoint every 5 minutes (dev mode only, only if edits exist)
  const checkpointEditsRef = useRef(0);
  useEffect(() => {
    if (!devMode) return;
    const id = setInterval(() => {
      if (devEditsCount > checkpointEditsRef.current) {
        saveAutosaveSnapshot(true);
        checkpointEditsRef.current = devEditsCount;
      }
    }, CHECKPOINT_INTERVAL);
    return () => clearInterval(id);
  }, [devMode, devEditsCount, saveAutosaveSnapshot]);

  // Restore a specific autosave snapshot (timeline scrubbing — no undo push)
  const timelineStashRef = useRef(null); // stash live state when entering timeline
  const restoreAutosave = useCallback((index) => {
    if (index < 0 || index >= autosaves.length) return;
    // Stash current live state the first time we leave "Live"
    if (timelineIndex === null) {
      timelineStashRef.current = {
        regions: { ...regions },
        resourcesData: JSON.parse(JSON.stringify(resourcesData)),
        populationData: { ...populationData },
        victoryConditions: JSON.parse(JSON.stringify(victoryConditions)),
      };
    }
    const snap = autosaves[index];
    setRegions(snap.regions);
    setResourcesData(snap.resourcesData);
    setPopulationData(snap.populationData);
    setVictoryConditions(snap.victoryConditions);
    setTimelineIndex(index);
  }, [autosaves, timelineIndex, regions, resourcesData, populationData, victoryConditions]);

  // Return to live state from timeline
  const returnToLive = useCallback(() => {
    if (timelineStashRef.current) {
      const s = timelineStashRef.current;
      setRegions(s.regions);
      setResourcesData(s.resourcesData);
      setPopulationData(s.populationData);
      setVictoryConditions(s.victoryConditions);
      timelineStashRef.current = null;
    }
    setTimelineIndex(null);
  }, []);

  // Show recovery prompt when dev mode is enabled and autosaves exist
  const prevDevModeRef = useRef(false);
  useEffect(() => {
    if (devMode && !prevDevModeRef.current && autosaves.length > 0) {
      setDevRecoveryPrompt(true);
    }
    prevDevModeRef.current = devMode;
  }, [devMode, autosaves.length]);

  const computeTransform = useCallback(() => {
    const scale = Math.max(canvasSize.width / imgSize.width, canvasSize.height / imgSize.height);
    const totalScale = scale * zoom;
    const imgDisplayWidth = imgSize.width * totalScale;
    const imgDisplayHeight = imgSize.height * totalScale;
    const baseOffsetX = (canvasSize.width - imgDisplayWidth) / 2;
    const baseOffsetY = (canvasSize.height - imgDisplayHeight) / 2;
    return { scale, totalScale, baseOffsetX, baseOffsetY, imgDisplayWidth, imgDisplayHeight };
  }, [canvasSize.width, canvasSize.height, imgSize.width, imgSize.height, zoom]);

  const clampOffset = useCallback(
    (next) => {
      const { imgDisplayWidth, imgDisplayHeight, baseOffsetX, baseOffsetY } = computeTransform();
      let { x, y } = next;
      if (imgDisplayWidth <= canvasSize.width) x = 0;
      else {
        const minX = canvasSize.width - imgDisplayWidth - baseOffsetX;
        const maxX = -baseOffsetX;
        x = Math.max(minX, Math.min(maxX, x));
      }
      if (imgDisplayHeight <= canvasSize.height) y = 0;
      else {
        const minY = canvasSize.height - imgDisplayHeight - baseOffsetY;
        const maxY = -baseOffsetY;
        y = Math.max(minY, Math.min(maxY, y));
      }
      return { x, y };
    },
    [computeTransform, canvasSize.width, canvasSize.height]
  );

  const drawBackground = useCallback(() => {
    const src = bgSourceRef.current;
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const vw = window.innerWidth,
      vh = window.innerHeight;
    canvas.width = Math.floor(vw * dpr);
    canvas.height = Math.floor(vh * dpr);
    canvas.style.width = vw + "px";
    canvas.style.height = vh + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    if (src) {
      const sw = src.width, sh = src.height;
      ctx.imageSmoothingEnabled = true;
      // Tile the marble texture at native size
      for (let ty = 0; ty < vh; ty += sh) {
        for (let tx = 0; tx < vw; tx += sw) {
          ctx.drawImage(src, tx, ty, sw, sh);
        }
      }
      // Dark mode darkens the marble; light mode lightly darkens it too
      // (the bare marble texture alone reads as glaring otherwise).
      ctx.fillStyle = isDark ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.12)";
      ctx.fillRect(0, 0, vw, vh);
    } else {
      ctx.fillStyle = isDark ? "#181a1b" : "#222";
      ctx.fillRect(0, 0, vw, vh);
    }
  }, [isDark]);

  const regionsForFaction = useCallback(
    (faction) => {
      if (!faction) return [];
      if (colorMode === "victory") return victoryConditions[faction]?.hold_regions || [];
      return factionRegionsMap[faction] || [];
    },
    [colorMode, victoryConditions, factionRegionsMap]
  );

  // Settlement tier lookup: rgb key → level string (town/large_town/city/large_city)
  const settlementTierMap = useMemo(() => {
    if (!buildingsData.length || !Object.keys(regions).length) return {};
    // Build region name → rgb key map
    const nameToRgb = {};
    for (const [rgb, r] of Object.entries(regions)) {
      if (r.region) nameToRgb[r.region.toLowerCase()] = rgb;
    }
    const map = {};
    for (const fObj of buildingsData) {
      for (const s of (fObj.settlements || [])) {
        if (!s.region) continue;
        const rgb = nameToRgb[s.region.toLowerCase()];
        if (rgb) map[rgb] = s.level || "town";
      }
    }
    return map;
  }, [buildingsData, regions]);

  // Government type lookup: rgb key → { type, level } (e.g. "governmentA", "gov1")
  const governmentMap = useMemo(() => {
    if (!buildingsData.length || !Object.keys(regions).length) return {};
    const nameToRgb = {};
    for (const [rgb, r] of Object.entries(regions)) {
      if (r.region) nameToRgb[r.region.toLowerCase()] = rgb;
    }
    const map = {};
    for (const fObj of buildingsData) {
      for (const s of (fObj.settlements || [])) {
        if (!s.region) continue;
        const rgb = nameToRgb[s.region.toLowerCase()];
        if (!rgb) continue;
        for (const b of (s.buildings || [])) {
          if (b.type && b.type.startsWith("government")) {
            map[rgb] = { type: b.type, level: b.level };
            break;
          }
        }
      }
    }
    return map;
  }, [buildingsData, regions]);

  // Load faction colours — prefer user-imported copy in userData/campaign_data,
  // then bundled descr_sm_factions.txt, then cached faction_colors.json as last resort
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let primaryErr = null;
      try {
        const r = await loadCampaignData("descr_sm_factions.txt");
        if (cancelled || !r?.text) throw new Error("no text returned");
        const parsed = parseSmFactions(r.text);
        if (Object.keys(parsed).length > 0) { setFactionColors(parsed); return; }
        throw new Error("parser returned 0 factions");
      } catch (e) {
        if (cancelled) return;
        primaryErr = e;
      }
      if (window.electronAPI?.readUserFile) {
        try {
          const text = await window.electronAPI.readUserFile("faction_colors.json");
          if (!cancelled && text) {
            setFactionColors(JSON.parse(text));
            return;
          }
        } catch (e) {
          if (!cancelled) pushToast(`Faction colour cache is corrupt (${e.message}). Re-import your mod to restore colours.`);
          return;
        }
      }
      if (!cancelled) pushToast(`Could not load faction colours (${primaryErr?.message || "unknown"}). Map will fall back to region RGB.`);
    })();
    return () => { cancelled = true; };
  }, [loadCampaignData, pushToast]);

  // Load buildings data
  useEffect(() => {
    const campaign = CAMPAIGNS[mapCampaign];
    loadCampaignData(campaign.buildingsFile)
      .then((r) => setBuildingsData(JSON.parse(r.text)))
      .catch((err) => {
        setBuildingsData([]);
        console.error("Failed to load buildings data:", err);
      });
  }, [loadCampaignData, mapCampaign]);

  // Load resources data (only when the campaign has a resourcesFile)
  useEffect(() => {
    const campaign = CAMPAIGNS[mapCampaign];
    if (!campaign.resourcesFile) { setResourcesData({}); return; }
    loadCampaignData(campaign.resourcesFile)
      .then((r) => {
        const raw = JSON.parse(r.text);
        // Merge entries whose keys differ only by case (e.g. "xupon" vs "Xupon").
        // Prefer the key with a leading uppercase letter as canonical.
        const merged = {};
        const lowerMap = {}; // lowercase → canonical key in merged
        for (const [key, entries] of Object.entries(raw)) {
          const lk = key.toLowerCase();
          const existing = lowerMap[lk];
          if (existing) {
            // Merge into existing, but swap canonical key if new one starts uppercase
            if (/^[A-Z]/.test(key) && !/^[A-Z]/.test(existing)) {
              merged[key] = merged[existing].concat(entries);
              delete merged[existing];
              lowerMap[lk] = key;
            } else {
              merged[existing] = merged[existing].concat(entries);
            }
          } else {
            merged[key] = [...entries];
            lowerMap[lk] = key;
          }
        }
        setResourcesData(merged);
      })
      .catch(() => setResourcesData({}));
  }, [loadCampaignData, mapCampaign]);

  // Load homelands data (shared across campaigns)
  useEffect(() => {
    fetch((import.meta.env.BASE_URL || "./") + "/homelands.json")
      .then(r => r.json())
      .then(d => setHomelandsData(d))
      .catch(() => setHomelandsData({}));
  }, []);

  // Load actual settlement population data
  useEffect(() => {
    const campaign = CAMPAIGNS[mapCampaign];
    if (!campaign.populationFile) { setPopulationData({}); return; }
    loadCampaignData(campaign.populationFile)
      .then((r) => setPopulationData(JSON.parse(r.text)))
      .catch(() => setPopulationData({}));
  }, [loadCampaignData, mapCampaign]);

  // Load armies data
  useEffect(() => {
    const campaign = CAMPAIGNS[mapCampaign];
    if (!campaign.armiesFile) { setArmiesData([]); return; }
    loadCampaignData(campaign.armiesFile)
      .then((r) => setArmiesData(JSON.parse(r.text)))
      .catch(() => setArmiesData([]));
    // starting_armies is the region→armies-with-units lookup saved by the
    // import flow. Fall back to empty if the bundled campaign didn't ship
    // this file (older imports).
    const startFile = campaign.armiesFile.replace(/armies_/, "starting_armies_");
    loadCampaignData(startFile)
      .then((r) => setStartingArmiesByRegion(JSON.parse(r.text)))
      .catch(() => setStartingArmiesByRegion({}));
  }, [loadCampaignData, mapCampaign]);

  // Pre-load resource icon images whenever resourcesData is available — used
  // by the resource map mode AND by the region info bar's resource chips.
  // Previously gated on `colorMode === "resource"`, which meant chip icons
  // only appeared after the user had visited resource mode at least once.
  useEffect(() => {
    if (Object.keys(resourcesData).length === 0) {
      setResourceImages({});
      return;
    }
    const names = new Set();
    for (const entries of Object.values(resourcesData)) {
      if (Array.isArray(entries)) entries.forEach(e => names.add(e.type));
      else Object.keys(entries).forEach(n => names.add(n));
    }
    const loaded = {};
    let pending = names.size;
    if (pending === 0) { setResourceImages({ ...loaded }); return; }
    // slave_trade shares the slaves icon; slaves gets a red-tinted variant
    const ICON_ALIAS = { slave_trade: "slaves" };
    names.forEach(name => {
      const img = new window.Image();
      const srcName = ICON_ALIAS[name] || name;
      img.src = `${PUBLIC_URL}/resources/resource_${srcName}.png`;
      const finish = () => { pending--; if (pending === 0) setResourceImages({ ...loaded }); };
      img.onload = () => {
        if (name === "slaves") {
          // Create a red-tinted version for slaves
          const c = document.createElement("canvas");
          c.width = img.width; c.height = img.height;
          const cx = c.getContext("2d");
          cx.drawImage(img, 0, 0);
          cx.globalCompositeOperation = "source-atop";
          cx.fillStyle = "rgba(200, 40, 40, 0.45)";
          cx.fillRect(0, 0, c.width, c.height);
          const tinted = new window.Image();
          tinted.src = c.toDataURL();
          tinted.onload = () => { loaded[name] = tinted; finish(); };
          tinted.onerror = () => { loaded[name] = img; finish(); };
        } else {
          loaded[name] = img; finish();
        }
      };
      img.onerror = finish;
    });
  }, [resourcesData, PUBLIC_URL]);

  // Hook up building getter — static data as base, save data merged on top for live updates.
  // Defined inline (NOT inside useEffect) so each render sees the latest state.
  // The previous setBuildingsGetter-via-useEffect approach lagged by one render
  // (state changes → render with stale getter → useEffect updates getter), which
  // caused stale building data in the UI. Wrapped in useCallback for stable
  // identity when nothing changed.
  const HIDDEN_CHAINS = useMemo(() => new Set(['hinterland_region','hinterland_roads','health','default_set']), []);
  const getBuildings = useCallback((regionInfo, raw = false) => {
      if (!regionInfo || !regionInfo.region) return [];
      const pretty = (s) => (s || "").toString().replace(/_/g, " ").trim();

      const deriveLabelFromIcons = (icons, type) => {
        if (!icons || !icons.length) return null;
        const r = String(icons[0]);
        const noExt = r.replace(/\.[^.]+$/, "");
        let core = noExt.replace(/^#/, "").replace(/^roman_/, "");
        const t = (type || "").toString().trim().toLowerCase();
        if (t && core.startsWith(`${t}_`)) core = core.slice(t.length + 1);
        return pretty(core);
      };

      // 1. Get static buildings as base
      let staticBuildings = [];
      for (const factionObj of buildingsData) {
        const settlement = (factionObj.settlements || []).find(
          (sett) => sett.region && sett.region.toLowerCase() === regionInfo.region.toLowerCase()
        );
        if (settlement && settlement.buildings) {
          staticBuildings = settlement.buildings;
          break;
        }
      }

      // Save-file building merge (as of 2026-04-20, parser is reliable).
      // The buildingParser.js inverted-block model correctly identifies each
      // settlement's built chains via the mic_1 demolish experiment. Keys in
      // builtBuildingsByCity are CITY names (e.g. "Eddopolis", "Rome"), so
      // look up by regionInfo.city — not regionInfo.region.
      const cityKey = regionInfo.city;
      const saveChains = (liveLogActive && builtBuildingsByCity && cityKey)
        ? builtBuildingsByCity[cityKey] : null;

      let merged = [...staticBuildings];
      if (saveChains && saveChains.length > 0) {
        // Chains present in save = CURRENTLY BUILT. Chains absent = demolished
        // or never built. Replace the static list with save-derived chains
        // using save-derived levels (so upgrades reflect; static data alone
        // would only show turn-0 levels).
        // saveChains entries can be either { name, level } (from new parser
        // with level decoding) or plain string (legacy parsed without level).
        const staticByChain = {};
        for (const b of staticBuildings) {
          if (b.type) staticByChain[b.type.toLowerCase()] = b;
        }
        merged = [];
        for (const entry of saveChains) {
          const chainName = (typeof entry === "string") ? entry : entry.name;
          const saveLevel = (typeof entry === "object") ? entry.level : null;
          const saveHealth = (typeof entry === "object") ? entry.health : null;
          const stat = staticByChain[chainName.toLowerCase()];
          // Resolve the concrete level name for the current save-level index.
          const levelNames = buildingLevelsLookup?.[chainName];
          let levelName = null;
          if (typeof saveLevel === "number" && levelNames && saveLevel >= 0 && saveLevel < levelNames.length) {
            levelName = levelNames[saveLevel];
          }
          if (stat) {
            const finalLevel = levelName || stat.level;
            merged.push({ ...stat, level: finalLevel, health: saveHealth });
          } else {
            const finalLevel = levelName || (levelNames?.[0]) || chainName;
            merged.push({ type: chainName, level: finalLevel, health: saveHealth, _fromSave: true });
          }
        }
      }

      if (raw) return merged;

      // Culture comes ONLY from faction (via descr_sm_factions.txt). No
      // silent fallbacks — if we can't resolve a culture, UI shows raw
      // level names so the failure is visible and fixable.
      let culture = null;
      const ownerId = (currentOwnerByCity && currentOwnerByCity[regionInfo.city])
        || (initialOwnerByCity && initialOwnerByCity[regionInfo.city])
        || regionInfo.faction
        || null;
      if (ownerId && factionCultures && factionCultures[ownerId]) {
        culture = factionCultures[ownerId];
      }
      if (!culture) {
        console.warn("[buildings] NO CULTURE for", regionInfo.city,
          "ownerId:", ownerId,
          "factionCultures loaded:", !!factionCultures && Object.keys(factionCultures).length,
          "regionInfo.faction:", regionInfo.faction);
      }
      // Kick off icon prefetch for all merged buildings. Don't gate on modDataDir
      // — the main-process resolver falls back to the vanilla / Alexander
      // game installs so users who haven't selected a mod still get icons.
      if (culture) {
        const triples = merged.map((b) => [culture, b.level, b.type]).filter(([, l]) => l);
        prefetchBuildingIcons(modDataDir, triples, () => {
          setIconCacheVersion((v) => v + 1);
        });
      }

      const resolved = merged.map((b, idx) => {
        const icons = guessIconNames(b.type, b.level);
        // Display-name lookup: prefer the game's export_buildings.txt
        // with culture-aware variant (e.g. `forum_greek` → "Agora"),
        // then the plain level key, then the bundled JSON as a fallback.
        const lvl = b.level;
        let displayName = null;
        if (lvl && gameDisplayNames) {
          // Try multiple key orderings the mod might use:
          //   1. <level>_<culture>          (RIS gov-chain style: gov2_roman)
          //   2. <chain>_<token>_<tier>     (RIS colony-chain style: colony_italic_2)
          //   3. <level>                    (plain key)
          // Order #2 is necessary because RIS imperial uses culture-or-
          // ethnicity tokens INSIDE the level key for the colony chain
          // (`colony_italic_2`) rather than appended like governments
          // (`gov2_roman`). Without it the colony chain falls back to the
          // bundled JSON's "Large Colony" instead of the mod's localized
          // "Colony 2 - Italic" — and the user notices the gov-themed
          // name (e.g. "Provincia (Direct Rule)") going missing.
          if (culture && gameDisplayNames[`${lvl}_${culture}`]) {
            displayName = gameDisplayNames[`${lvl}_${culture}`];
          }
          if (!displayName && b.type && lvl) {
            // Parse the trailing "_<tier>" suffix off the level name, then
            // try the mod's alternate ordering: chain_token_tier.
            const m = lvl.match(/^(.*)_(\d+)$/);
            if (m && m[1] === b.type) {
              const tier = m[2];
              // Try the region's culture tokens (lowercase). r.tags includes
              // ethnic markers (italic, italiote, hellenic, ...). The
              // bundled regionTags closure isn't directly accessible here,
              // so use the resolved `culture` plus a small fallback list
              // of common RIS tokens — Italic, Hellenic, Iberian, etc.
              const tokens = [];
              if (culture) tokens.push(culture);
              // The faction's culture often matches; the region's ethnic
              // tag is what RIS keys by. Probe common tokens — cheap (the
              // gameDisplayNames map lookup is O(1)).
              for (const t of ["italic", "italiote", "hellenic", "celtic", "iberian", "germanic", "thracian", "illyrian", "persian", "indian", "arab", "punic", "carthaginian", "romanized"]) {
                if (!tokens.includes(t)) tokens.push(t);
              }
              for (const tok of tokens) {
                const key = `${b.type}_${tok}_${tier}`;
                if (gameDisplayNames[key]) { displayName = gameDisplayNames[key]; break; }
              }
            }
          }
          if (!displayName && gameDisplayNames[lvl]) {
            displayName = gameDisplayNames[lvl];
          }
          if (!displayName) {
            console.warn("[buildings] NO DISPLAY NAME for level", JSON.stringify(lvl),
              "culture:", culture,
              "gameDisplayNames keys:", Object.keys(gameDisplayNames).length,
              "has_culture_key:", !!gameDisplayNames[`${lvl}_${culture}`],
              "has_generic:", !!gameDisplayNames[lvl]);
          }
        } else if (!gameDisplayNames) {
          console.warn("[buildings] gameDisplayNames is NULL when resolving", JSON.stringify(lvl));
        }
        const label =
          displayName ||
          (b.level && b.level.trim && b.level.trim() && pretty(b.level)) ||
          (b.name && b.name.trim && b.name.trim() && pretty(b.name)) ||
          deriveLabelFromIcons(icons, b.type) ||
          (b.type && b.type.trim && b.type.trim() && pretty(b.type)) ||
          `Building ${idx + 1}`;

        // Mod/game icon takes priority. No Roman fallback — if the culture's
        // icon isn't found, show no icon at all (user explicitly doesn't want
        // misleading Roman stand-ins).
        const modIconUrl = culture ? getCachedBuildingIcon(culture, b.level) : null;
        const iconCandidates = modIconUrl ? [modIconUrl] : null;

        // Tier (1-based) = 1 + index of this level within the chain's level
        // list from `export_descr_buildings.txt`. No hardcoded sequences —
        // every mod's EDB defines its own chains and levels, we just parse it.
        // The chain name from descr_strat (`b.type`) maps directly to EDB's
        // `building <chain> { … }` block; the `levels` line inside is the
        // canonical ladder.
        let tier = null;
        if (b.type && b.level && buildingLevelsLookup) {
          const chainLevels = buildingLevelsLookup[b.type];
          if (chainLevels) {
            const idx = chainLevels.indexOf(b.level);
            if (idx >= 0) tier = idx + 1;
          }
          // Some mods rename a chain but keep the level names — cross-chain
          // scan as a safety net so a level still resolves to its position.
          if (tier == null) {
            for (const levels of Object.values(buildingLevelsLookup)) {
              const idx = levels.indexOf(b.level);
              if (idx >= 0) { tier = idx + 1; break; }
            }
          }
        }
        return {
          ...b,
          label,
          icon: iconCandidates,
          tier,
          culture, // RTW culture (greek/roman/eastern/…) for the info popup
        };
      });
      // For each queued (in-construction) chain, REPLACE the built entry
      // in-place with the target level. The row then shows the next-tier
      // icon with an orange frame + green progress overlay instead of the
      // old tier's icon — matches how the game itself surfaces upgrades
      // in the construction queue.
      const queuedChains = (liveLogActive && queuedBuildingsByCity && cityKey)
        ? queuedBuildingsByCity[cityKey] : null;
      if (queuedChains && queuedChains.length > 0 && culture) {
        for (const entry of queuedChains) {
          const chainName = typeof entry === "string" ? entry : entry.name;
          const percent = typeof entry === "object" && entry && typeof entry.percent === "number" ? entry.percent : null;
          const chainLevels = buildingLevelsLookup?.[chainName] || null;
          const rowIdx = resolved.findIndex((b) => b.type === chainName);
          const currLevel = rowIdx >= 0 ? resolved[rowIdx].level : null;
          let targetLevelName = null;
          let targetTier = null;
          if (chainLevels) {
            const currIdx = currLevel ? chainLevels.indexOf(currLevel) : -1;
            const nextIdx = currIdx + 1;
            if (nextIdx >= 0 && nextIdx < chainLevels.length) {
              targetLevelName = chainLevels[nextIdx];
              targetTier = nextIdx + 1;
            }
          }
          if (!targetLevelName) continue;
          prefetchBuildingIcons(modDataDir, [[culture, targetLevelName, chainName]], () => {
            setIconCacheVersion((v) => v + 1);
          });
          let tLabel = null;
          if (gameDisplayNames) {
            if (culture && gameDisplayNames[`${targetLevelName}_${culture}`]) tLabel = gameDisplayNames[`${targetLevelName}_${culture}`];
            else if (gameDisplayNames[targetLevelName]) tLabel = gameDisplayNames[targetLevelName];
          }
          if (!tLabel) tLabel = targetLevelName.replace(/_/g, " ");
          const tIcon = getCachedBuildingIcon(culture, targetLevelName);
          const row = {
            type: chainName,
            level: targetLevelName,
            label: tLabel,
            icon: tIcon ? [tIcon] : null,
            tier: targetTier,
            queued: true,
            progress: percent != null ? percent / 100 : 0,
            culture,
          };
          if (rowIdx >= 0) resolved[rowIdx] = row; else resolved.push(row);
        }
      }
      return resolved;
  }, [buildingsData, builtBuildingsByCity, liveLogActive, buildingLevelsLookup, buildingDisplayNames, HIDDEN_CHAINS, modDataDir, iconCacheVersion, gameDisplayNames, factionCultures, currentOwnerByCity, initialOwnerByCity, queuedBuildingsByCity]);
  // Keep the legacy module-level getter in sync for any code that still calls it.
  useEffect(() => { setBuildingsGetter(getBuildings); }, [getBuildings]);

  // Load victory conditions
  useEffect(() => {
    (async () => {
      try {
        const campaign = CAMPAIGNS[mapCampaign];
        const r = await loadCampaignData(campaign.winConditionsFile);
        const parsed = parseVictoryConditions(r.text);
        setVictoryConditions(parsed);
      } catch (err) {
        console.error("Failed to load victory conditions:", err);
        setVictoryConditions({});
      }
    })();
  }, [loadCampaignData, mapCampaign]);

  const globalScrollbarKill = `
    .custom-scroll-viewport, .custom-scroll-viewport * {
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
      scrollbar-color: transparent transparent !important;
    }
    .custom-scroll-viewport::-webkit-scrollbar,
    .custom-scroll-viewport *::-webkit-scrollbar {
      width: 0 !important; height: 0 !important; display: none !important;
      background: transparent !important;
    }
    .custom-scroll-viewport::-webkit-scrollbar-thumb,
    .custom-scroll-viewport::-webkit-scrollbar-track,
    .custom-scroll-viewport::-webkit-scrollbar-corner {
      background: transparent !important; border: none !important;
    }
    .legend-panel { scrollbar-width: none; -ms-overflow-style: none; }
    .legend-panel::-webkit-scrollbar { display: none; }
  `;

  // Start splash timer; resize will compute layout
  useEffect(() => {
    splashStartRef.current = Date.now();
    setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
  }, []);

  // Background marble
  useEffect(() => {
    const img = new window.Image();
    img.src = PUBLIC_URL + "/menu_marble_frame.png";
    img.onload = () => {
      const src = document.createElement("canvas");
      src.width = img.width;
      src.height = img.height;
      src.getContext("2d").drawImage(img, 0, 0);
      bgSourceRef.current = src;
      drawBackground();
    };
    img.onerror = () => {
      bgSourceRef.current = null;
      drawBackground();
    };
  }, [PUBLIC_URL, drawBackground]);
  useEffect(() => {
    const onResize = () => drawBackground();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [drawBackground]);
  useEffect(() => {
    drawBackground();
  }, [drawBackground]);

  // Persist settings to localStorage
  useEffect(() => {
    localStorage.setItem("mapCampaign", mapCampaign);
    devBorderModeRef.current = null;
    setColoredOffscreen(null);
    pixelDataRef.current = null;
  }, [mapCampaign]);
  useEffect(() => { localStorage.setItem("mapVariant", mapVariant); }, [mapVariant]);
  useEffect(() => {
    localStorage.setItem("colorMode", colorMode);
    if (colorMode !== "culture" && colorMode !== "religion" && colorMode !== "faction" && !DEV_COLOR_MODES.has(colorMode)) {
      setLegendFilter(null);
      setSelectedProvinces([]);
    }
    setLegendSearch("");
  }, [colorMode]);
  useEffect(() => {
    if (selectedFaction) localStorage.setItem("selectedFaction", selectedFaction);
    else localStorage.removeItem("selectedFaction");
  }, [selectedFaction]);
  useEffect(() => {
    localStorage.setItem("pinnedRegions", JSON.stringify(pinnedRegions));
  }, [pinnedRegions]);


  // Keyboard shortcuts
  useEffect(() => {
    // Order must mirror the colorModes array in renderMapModeToggle so
    // Ctrl+1..9 → Faction/Victory/Culture/Religion/Population/Fertility/
    // Resources/Homeland/Government.
    const numericModes = [
      "faction", "victory", "culture", "religion",
      "population", "farm", "resource", "homeland", "government",
    ];
    const handler = (e) => {
      const inField = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";
      // Ctrl+F → focus the search input regardless of where focus currently is.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
          searchInputRef.current.select();
        }
        return;
      }
      // Ctrl+1..9 → switch map mode (only when not typing in a field).
      if (!inField && e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        const mode = numericModes[idx];
        if (mode) { e.preventDefault(); setColorMode(mode); }
        return;
      }
      if (inField) {
        // Esc inside an input clears the field's value (search etc.).
        if (e.key === "Escape" && e.target.tagName === "INPUT") {
          e.target.blur();
        }
        return;
      }
      if (e.key === "Escape") {
        // Esc cascade — close whatever overlay is open, then clear selection.
        setInfoPopup((cur) => { if (cur) return null; return cur; });
        setDevContextMenu((cur) => { if (cur) return null; return cur; });
        setLegendFilter((cur) => { if (cur) return null; return cur; });
        setSearchQuery("");
        setSelectedProvinces([]);
        setSelectedFaction(null);
        setLockedRegionInfo(null);
      }
      else if (e.key === "ArrowLeft")  { e.preventDefault(); setOffset((p) => clampOffset({ x: p.x + 60 / Math.max(1, zoom), y: p.y })); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setOffset((p) => clampOffset({ x: p.x - 60 / Math.max(1, zoom), y: p.y })); }
      else if (e.key === "ArrowUp")    { e.preventDefault(); setOffset((p) => clampOffset({ x: p.x, y: p.y + 60 / Math.max(1, zoom) })); }
      else if (e.key === "ArrowDown")  { e.preventDefault(); setOffset((p) => clampOffset({ x: p.x, y: p.y - 60 / Math.max(1, zoom) })); }
      // , and . step through the recent-regions backstack (most recent first).
      else if (e.key === "," || e.key === ".") {
        if (recentRegions.length === 0) return;
        const cur = lockedRegionInfo?.rgb;
        const idx = cur ? recentRegions.indexOf(cur) : -1;
        const next = e.key === "," ? idx + 1 : idx - 1;
        if (next >= 0 && next < recentRegions.length) {
          const key = recentRegions[next];
          const r = regions[key];
          if (r) {
            setLockedRegionInfo({ ...r, rgb: key });
            setSelectedProvinces([key]);
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [clampOffset, zoom, recentRegions, lockedRegionInfo, regions]);

  // Dev mode toggle: Ctrl+Shift+D
  useEffect(() => {
    const devHandler = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        e.preventDefault();
        setDevMode(prev => {
          const next = !prev;
          // If turning off dev mode while a dev color mode is active, reset to faction
          if (!next) setColorMode(cm => DEV_COLOR_MODES.has(cm) ? "faction" : cm);
          return next;
        });
      }
      // Ctrl+Z: undo
      if (e.ctrlKey && !e.shiftKey && e.key === "z") {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
        e.preventDefault();
        popUndo();
      }
      // Ctrl+Shift+Z or Ctrl+Y: redo
      if ((e.ctrlKey && e.shiftKey && e.key === "Z") || (e.ctrlKey && !e.shiftKey && e.key === "y")) {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
        e.preventDefault();
        popRedo();
      }
    };
    window.addEventListener("keydown", devHandler);
    return () => window.removeEventListener("keydown", devHandler);
  }, [popUndo, popRedo]);

  // Click-away to close Load menu
  useEffect(() => {
    if (!showLoadMenu) return;
    const handler = (e) => {
      if (loadMenuRef.current && !loadMenuRef.current.contains(e.target)) {
        setShowLoadMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showLoadMenu]);


  // Precompute one representative pixel position per region (for search pan-to)
  // Also find black (0,0,0) city pixels and map them to the nearest region
  useEffect(() => {
    if (!pixelDataRef.current || !imgSize.width || !offscreen) return;
    const schedule = typeof window.requestIdleCallback === "function"
      ? (cb) => window.requestIdleCallback(cb, { timeout: 3000 })
      : (cb) => setTimeout(cb, 0);
    schedule(() => {
      const data = pixelDataRef.current;
      if (!data) return;
      const W = imgSize.width;
      const centroids = {};
      const blacks = []; // city pixel positions
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const key = `${r},${g},${b}`;
        if (regions[key] && !centroids[key]) {
          const idx = i / 4;
          centroids[key] = { x: idx % W, y: Math.floor(idx / W) };
        }
        // Collect black pixels (city markers)
        if (r === 0 && g === 0 && b === 0) {
          const idx = i / 4;
          blacks.push({ x: idx % W, y: Math.floor(idx / W) });
        }
      }
      // Map each black pixel to the nearest region by checking neighbors
      const cities = [];
      const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
      for (const bp of blacks) {
        let rgbKey = null;
        for (const [dx, dy] of dirs) {
          const nx = bp.x + dx, ny = bp.y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < imgSize.height) {
            const ni = (ny * W + nx) * 4;
            const nk = `${data[ni]},${data[ni+1]},${data[ni+2]}`;
            if (regions[nk]) { rgbKey = nk; break; }
          }
        }
        if (rgbKey) cities.push({ x: bp.x, y: bp.y, rgbKey });
      }
      setRegionCentroids(centroids);
      setCityPixels(cities);
    });
  }, [regions, imgSize, offscreen]);

  // Build colored overlay canvas for culture/population/farm/religion/dev modes
  useEffect(() => {
    const NON_OVERLAY = new Set(["resource", "victory"]);
    if (NON_OVERLAY.has(colorMode) || !pixelDataRef.current || !offscreen) {
      setColoredOffscreen(null);
      setStripeOverlay(null);
      return;
    }
    // Clear stripe overlay for non-culture modes
    if (colorMode !== "culture") setStripeOverlay(null);
    const schedule = typeof window.requestIdleCallback === "function"
      ? (cb) => window.requestIdleCallback(cb, { timeout: 3000 })
      : (cb) => setTimeout(cb, 0);
    schedule(() => {
      const pxData = pixelDataRef.current;
      if (!pxData) return;
      const W = imgSize.width, H = imgSize.height;
      if (colorMode === "faction") {
        // Build rgbKey → owner faction.
        // Base layer: descr_strat starting ownership.
        // Live override: when a save is loaded (currentOwnerByCity set),
        // overwrite each region whose owner has changed. Without this the
        // map permanently shows turn-0 borders even after the player has
        // conquered half the world. (User report 2026-05-09: "I should
        // own this area as Rome. Salentinia." — the side-panel showed
        // Faction: Rome, but the tile stayed brown because this loop
        // never consulted currentOwnerByCity.)
        const rgbToOwner = {};
        for (const [faction, regionNames] of Object.entries(factionRegionsMap)) {
          for (const rn of regionNames) {
            for (const [rgbKey, r] of Object.entries(regions)) {
              if (r.region?.toLowerCase() === rn.toLowerCase() || r.city?.toLowerCase() === rn.toLowerCase()) {
                rgbToOwner[rgbKey] = faction;
                break;
              }
            }
          }
        }
        if (currentOwnerByCity) {
          let changeCount = 0;
          const samples = [];
          for (const [rgbKey, r] of Object.entries(regions)) {
            const liveOwner = currentOwnerByCity[r.city];
            if (liveOwner) {
              const prev = rgbToOwner[rgbKey];
              if (prev !== liveOwner) {
                changeCount++;
                if (samples.length < 5) samples.push(`${r.region}/${r.city}: ${prev || "(none)"} → ${liveOwner}`);
              }
              rgbToOwner[rgbKey] = liveOwner;
            }
          }
          // Only log when the override actually flipped a region's owner.
          // Quiet on normal repaints (dev-mode toggles, color-mode switches);
          // fires on the first render after a conquest so the conquest is
          // visible in the dev console with timestamps.
          if (changeCount > 0) {
            console.log(`[map-render] live-ownership override flipped ${changeCount} region(s). Samples: ${samples.join(" | ")}`);
          }
        }
        // Build faction → color map (use sm_factions primary if available, else region's pixel color)
        const fcMap = {};
        for (const faction of Object.keys(factionRegionsMap)) {
          if (!fcMap[faction]) {
            const fc = factionColors[faction.toLowerCase()];
            if (fc && fc.primary) {
              fcMap[faction] = fc.primary;
            }
          }
        }
        setColoredOffscreen(buildColoredCanvas(pxData, W, H, regions,
          (r, pr, pg, pb, px, py) => {
            const rgbKey = `${pr},${pg},${pb}`;
            const owner = rgbToOwner[rgbKey] || r.faction;
            const baseCol = fcMap[owner] || fcMap[owner?.toLowerCase()] || [pr, pg, pb];
            if (devFlatColors) return baseCol;
            const v = (((pr * 31 + pg * 17 + pb * 7) & 0x3F) - 32) * 0.6;
            return [Math.max(0,Math.min(255,baseCol[0]+v)), Math.max(0,Math.min(255,baseCol[1]+v)), Math.max(0,Math.min(255,baseCol[2]+v))];
          }));
      } else if (colorMode === "culture") {
        const cultureColors = {};
        let ci = 0;
        for (const v of Object.values(regions)) {
          if (v.culture && !cultureColors[v.culture]) {
            cultureColors[v.culture] = CULTURE_PALETTE[ci % CULTURE_PALETTE.length];
            ci++;
          }
        }
        // Base culture colors at native resolution (sharp)
        const ethCache = {};
        for (const [key, r] of Object.entries(regions)) {
          const eth = parseEthnicities(r.ethnicities);
          if (eth.length > 1) ethCache[key] = eth;
        }
        setColoredOffscreen(buildColoredCanvas(pxData, W, H, regions,
          (r, pr, pg, pb) => {
            const rgbKey = `${pr},${pg},${pb}`;
            const eth = ethCache[rgbKey];
            const base = (eth && eth.length > 1) ? getEthnicityColor(eth[0].name) : (cultureColors[r.culture] || [128, 128, 128]);
            if (devFlatColors) return base;
            const v = (((pr * 31 + pg * 17 + pb * 7) & 0x3F) - 32) * 0.9;
            return [
              Math.max(0, Math.min(255, base[0] + v)),
              Math.max(0, Math.min(255, base[1] + v)),
              Math.max(0, Math.min(255, base[2] + v)),
            ];
          }));
        // Stripe overlay at high resolution (smooth diagonal lines)
        const hasStripes = Object.keys(ethCache).length > 0;
        if (hasStripes) {
          const S = 8; // high-res scale for smooth stripes
          const sW = W * S, sH = H * S;
          const PERIOD = 48; // stripe spacing in hi-res pixels
          const HALF = 4;    // half-width of stripe
          const stripeCanvas = document.createElement("canvas");
          stripeCanvas.width = sW; stripeCanvas.height = sH;
          const sCtx = stripeCanvas.getContext("2d");
          const sImg = sCtx.createImageData(sW, sH);
          const sd = sImg.data;
          // For each map pixel with stripes, fill the SxS hi-res block
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const i = (y * W + x) * 4;
              const key = `${pxData[i]},${pxData[i+1]},${pxData[i+2]}`;
              const eth = ethCache[key];
              if (!eth || eth.length < 2) continue;
              const col = getEthnicityColor(eth[1].name);
              for (let sy = 0; sy < S; sy++) {
                for (let sx = 0; sx < S; sx++) {
                  const hx = x * S + sx, hy = y * S + sy;
                  const diag = (hx * 2 + hy) / Math.sqrt(5);
                  const pos = ((diag % PERIOD) + PERIOD) % PERIOD;
                  const dist = Math.abs(pos - PERIOD / 2);
                  if (dist < HALF) {
                    const oi = (hy * sW + hx) * 4;
                    const edge = HALF - dist;
                    const alpha = edge < 1.5 ? Math.round((edge / 1.5) * 255) : 255;
                    sd[oi] = col[0]; sd[oi+1] = col[1]; sd[oi+2] = col[2]; sd[oi+3] = alpha;
                  }
                }
              }
            }
          }
          sCtx.putImageData(sImg, 0, 0);
          setStripeOverlay(stripeCanvas);
        } else {
          setStripeOverlay(null);
        }
      } else if (colorMode === "population") {
        const getPop = (r) => populationData[r.region] || populationData[r.region?.split("-")[0]] || populationData[r.city] || 0;
        const max = Math.max(1, ...Object.values(regions).map(getPop));
        setColoredOffscreen(buildColoredCanvas(pxData, W, H, regions, (r, pr, pg, pb) => {
          const t = Math.min(1, getPop(r) / max);
          // Dark blue (low) → bright gold (high)
          const v = (((pr * 31 + pg * 17 + pb * 7) & 0x1F) - 16) * 0.6;
          return [
            Math.max(0, Math.min(255, Math.round(30 + t * 210) + v)),
            Math.max(0, Math.min(255, Math.round(60 + t * 140) + v)),
            Math.max(0, Math.min(255, Math.round(180 - t * 160) + v)),
          ];
        }));
      } else if (colorMode === "farm") {
        // Farm fertility is encoded as a Farm1–Farm14 tag, not farm_level
        const getFarm = (r) => {
          const m = String(r.tags || "").match(/\bFarm(\d+)\b/);
          return m ? parseInt(m[1], 10) : 0;
        };
        const max = Math.max(1, ...Object.values(regions).map(getFarm));
        setColoredOffscreen(buildColoredCanvas(pxData, W, H, regions, (r, pr, pg, pb) => {
          const t = Math.min(1, getFarm(r) / max);
          // Red (low) → Yellow (mid) → Green (high)
          const red   = t < 0.5 ? 210 : Math.round(210 - (t - 0.5) * 2 * 160);
          const green = t < 0.5 ? Math.round(t * 2 * 200) : 200;
          const blue  = 30;
          // Small per-province brightness variation for same-fertility neighbours
          const v = (((pr * 31 + pg * 17 + pb * 7) & 0x1F) - 16) * 0.7;
          return [
            Math.max(0, Math.min(255, red + v)),
            Math.max(0, Math.min(255, green + v)),
            Math.max(0, Math.min(255, blue + v)),
          ];
        }));
      } else if (colorMode === "religion") {
        // Dominant religion per province = rel_* tag with highest numeric level
        const getDominant = (r) => {
          let best = null, bestLvl = -1;
          const m = String(r.tags || "").matchAll(/\brel_([a-z_]+?)_(\d+)\b/g);
          for (const hit of m) {
            const lvl = parseInt(hit[2], 10);
            if (lvl > bestLvl) { best = hit[1]; bestLvl = lvl; }
          }
          return best;
        };
        setColoredOffscreen(buildColoredCanvas(pxData, W, H, regions, (r, pr, pg, pb) => {
          const rel = getDominant(r);
          const base = (rel && RELIGION_COLORS[rel]) || [80, 80, 80];
          if (devFlatColors) return base;
          const v = (((pr * 31 + pg * 17 + pb * 7) & 0x3F) - 32) * 0.8;
          return [
            Math.max(0, Math.min(255, base[0] + v)),
            Math.max(0, Math.min(255, base[1] + v)),
            Math.max(0, Math.min(255, base[2] + v)),
          ];
        }));
      } else if (colorMode === "pop_growth") {
        // Headroom = pop_level (cap from descr_strat) − current population
        // bracket. Green = lots of room to grow, red = capped.
        const getPop = (r) => populationData[r.region] || populationData[r.region?.split("-")[0]] || populationData[r.city] || 0;
        // Derive cap from r.pop_level (the descr_regions value), which is
        // a 1-15 scale roughly mapping to maximum settlement size.
        const ratio = (r) => {
          const cap = parseInt(r.pop_level || "0", 10) || 0;
          if (cap <= 0) return 0;
          // Pop is a raw count; divide by an empirical 1500/level scale so
          // 100% = at-cap. Clamp so visualisation stays in 0..1.
          const pop = getPop(r);
          return Math.min(1.5, pop / (cap * 1500));
        };
        setColoredOffscreen(buildColoredCanvas(pxData, W, H, regions, (r, pr, pg, pb) => {
          const t = Math.min(1, ratio(r));
          // Green (room) → orange (filling) → red (capped)
          const red   = t < 0.5 ? Math.round(70 + t * 2 * 180) : 250;
          const green = t < 0.5 ? Math.round(200 - t * 2 * 60)  : Math.round(140 - (t - 0.5) * 2 * 130);
          const blue  = 40;
          const v = (((pr * 31 + pg * 17 + pb * 7) & 0x1F) - 16) * 0.5;
          return [
            Math.max(0, Math.min(255, red + v)),
            Math.max(0, Math.min(255, green + v)),
            Math.max(0, Math.min(255, blue + v)),
          ];
        }));
      } else if (colorMode === "wealth") {
        // Approximate per-region income from on-tile resources + farm level
        // + port level. Resources contribute their `amount`; farms contribute
        // (farm_level * 2); ports contribute (port_level * 4). It's a crude
        // proxy, not the exact game-side formula, but enough to surface
        // wealthy vs poor at a glance.
        const score = (r) => {
          let s = 0;
          const resList = resourcesData[r.region] || resourcesData[r.city] || [];
          for (const x of resList) s += (x.amount || 1);
          const farm = parseInt(r.farm_level || "0", 10) || 0;
          s += farm * 2;
          const portM = String(r.tags || "").match(/\bbase_port_level_(\d+)\b/);
          if (portM) s += parseInt(portM[1], 10) * 4;
          return s;
        };
        const max = Math.max(1, ...Object.values(regions).map(score));
        setColoredOffscreen(buildColoredCanvas(pxData, W, H, regions, (r, pr, pg, pb) => {
          const t = Math.min(1, score(r) / max);
          // Dark grey (poor) → bright gold (wealthy)
          const red   = Math.round(60 + t * 200);
          const green = Math.round(60 + t * 160);
          const blue  = Math.round(60 + t * 30);
          const v = (((pr * 31 + pg * 17 + pb * 7) & 0x1F) - 16) * 0.5;
          return [
            Math.max(0, Math.min(255, red + v)),
            Math.max(0, Math.min(255, green + v)),
            Math.max(0, Math.min(255, blue + v)),
          ];
        }));
      } else if (colorMode === "recruitment") {
        // Per-region count of unique recruitable units. Reuses the same
        // filter logic as RegionInfo's `recruitable` prop, but only the
        // count — to keep the per-pixel pass cheap, we precompute the
        // count for each region once.
        const getCount = (r) => {
          if (!buildingRecruits || !unitOwnership) return 0;
          const ownerId = (
            (currentOwnerByCity && currentOwnerByCity[r.city])
            || (initialOwnerByCity && initialOwnerByCity[r.city])
            || r.faction || ""
          ).toLowerCase();
          const culture = factionCultures?.[ownerId] || null;
          // Find the region's buildings via buildingsData (descr_strat).
          let built = null;
          for (const fd of buildingsData) {
            const sett = (fd.settlements || []).find(s => s.region?.toLowerCase() === r.region?.toLowerCase());
            if (sett) { built = sett.buildings || []; break; }
          }
          if (!built || built.length === 0) return 0;
          const tagSet = new Set(String(r.tags || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
          const seen = new Set();
          for (const b of built) {
            const lvls = buildingRecruits[b.type];
            if (!lvls) continue;
            const allLevels = (buildingLevelsLookup && buildingLevelsLookup[b.type]) || null;
            const levels = allLevels ? allLevels.slice(0, allLevels.indexOf(b.level) + 1) : [b.level];
            for (const lvl of levels) {
              const recs = lvls[lvl];
              if (!recs) continue;
              for (const rec of recs) {
                if (rec.factions && rec.factions.length > 0 && ownerId
                    && !rec.factions.includes("all") && !rec.factions.includes(ownerId) && !rec.factions.includes(culture)) continue;
                if (rec.requires) {
                  // Drop only positive `major_event "X"` — the negative form
                  // (`not major_event`) gates pre-reform recruits and should
                  // pass. Same reasoning in the bottom-panel evaluator.
                  if (/(?<!\bnot\s)\bmajor_event\b/.test(rec.requires) || /\bnot\s+is_player\b/.test(rec.requires)) continue;
                  const negFm = rec.requires.match(/not\s+factions\s*\{\s*([^}]*)\}/);
                  if (negFm) {
                    const ex = negFm[1].split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
                    if (ex.includes(ownerId) || ex.includes(culture)) continue;
                  }
                  let hrOk = true;
                  for (const m of rec.requires.matchAll(/\bnot\s+hidden_resource\s+(\S+)/g))
                    if (tagSet.has(m[1].toLowerCase())) { hrOk = false; break; }
                  if (!hrOk) continue;
                  const positives = rec.requires.replace(/\bnot\s+hidden_resource\s+\S+/g, "");
                  for (const m of positives.matchAll(/\bhidden_resource\s+(\S+)/g))
                    if (!tagSet.has(m[1].toLowerCase())) { hrOk = false; break; }
                  if (!hrOk) continue;
                }
                if (unitOwnership) {
                  const owners = unitOwnership[rec.unit];
                  if (!owners) continue;
                  if (ownerId && !owners.includes("all") && !owners.includes(ownerId) && !owners.includes(culture)) continue;
                }
                seen.add(rec.unit);
              }
            }
          }
          return seen.size;
        };
        // Cache per-region count to keep the per-pixel pass cheap.
        const counts = new Map();
        for (const [k, r] of Object.entries(regions)) counts.set(k, getCount(r));
        const max = Math.max(1, ...counts.values());
        setColoredOffscreen(buildColoredCanvas(pxData, W, H, regions, (r, pr, pg, pb) => {
          const k = `${pr},${pg},${pb}`;
          const c = counts.get(k) || 0;
          const t = Math.min(1, c / max);
          // Black (none) → purple → orange (lots)
          const red   = Math.round(t * 240);
          const green = Math.round(t * 140);
          const blue  = Math.round(40 + (1 - t) * 80);
          const v = (((pr * 31 + pg * 17 + pb * 7) & 0x1F) - 16) * 0.5;
          return [
            Math.max(0, Math.min(255, red + v)),
            Math.max(0, Math.min(255, green + v)),
            Math.max(0, Math.min(255, blue + v)),
          ];
        }));
      } else if (colorMode === "homeland") {
        // Get the selected faction's homeland hidden resources
        const factionKey = (selectedFaction || "").toLowerCase();
        const homelandResources = new Set((homelandsData[factionKey] || []).map(s => s.toLowerCase()));
        // Build rgbKey → owner faction from descr_strat
        const rgbToOwner = {};
        for (const [faction, regionNames] of Object.entries(factionRegionsMap)) {
          for (const rn of regionNames) {
            for (const [rgbKey, r] of Object.entries(regions)) {
              if (r.region?.toLowerCase() === rn.toLowerCase() || r.city?.toLowerCase() === rn.toLowerCase()) {
                rgbToOwner[rgbKey] = faction;
                break;
              }
            }
          }
        }
        setColoredOffscreen(buildColoredCanvas(pxData, W, H, regions, (r, pr, pg, pb) => {
          const rgbKey = `${pr},${pg},${pb}`;
          const tags = String(r.tags || "").split(",").map(s => s.trim().toLowerCase());
          const owner = (rgbToOwner[rgbKey] || r.faction || "").toLowerCase();
          const isHomeland = homelandResources.size > 0 && tags.some(t => homelandResources.has(t));
          let base;
          if (!isHomeland) base = [180, 50, 50];                          // Red: not their homeland
          else if (owner === factionKey) base = [50, 180, 50];            // Green: homeland they own
          else base = [210, 190, 40];                                      // Yellow: homeland someone else owns
          if (devFlatColors) return base;
          const v = (((pr * 31 + pg * 17 + pb * 7) & 0x3F) - 32) * 0.5;
          return [Math.max(0,Math.min(255,base[0]+v)), Math.max(0,Math.min(255,base[1]+v)), Math.max(0,Math.min(255,base[2]+v))];
        }));
      } else if (colorMode === "government") {
        const GOV_COLORS = {
          gov1: [130, 70, 180],   // Purple
          gov2: [210, 130, 40],   // Orange
          gov3: [190, 60, 150],   // Magenta
          gov4: [25, 100, 45],    // Green
        };
        // Build set of rgbKeys owned by selected faction
        const selectedOwned = new Set();
        if (selectedFaction) {
          const regionNames = factionRegionsMap[selectedFaction] || factionRegionsMap[selectedFaction.toLowerCase()] || [];
          for (const rn of regionNames) {
            for (const [rgbKey, r] of Object.entries(regions)) {
              if (r.region?.toLowerCase() === rn.toLowerCase() || r.city?.toLowerCase() === rn.toLowerCase()) {
                selectedOwned.add(rgbKey);
                break;
              }
            }
          }
        }
        setColoredOffscreen(buildColoredCanvas(pxData, W, H, regions, (r, pr, pg, pb) => {
          const rgbKey = `${pr},${pg},${pb}`;
          const gov = governmentMap[rgbKey];
          // If a faction is selected, gray out regions they don't own
          if (selectedFaction && !selectedOwned.has(rgbKey)) {
            return [60, 60, 60];
          }
          const base = gov ? (GOV_COLORS[gov.level] || [100, 100, 100]) : [80, 80, 80];
          if (devFlatColors) return base;
          const v = (((pr * 31 + pg * 17 + pb * 7) & 0x3F) - 32) * 0.5;
          return [Math.max(0,Math.min(255,base[0]+v)), Math.max(0,Math.min(255,base[1]+v)), Math.max(0,Math.min(255,base[2]+v))];
        }));
      }
      // ── Dev map modes ──────────────────────────────────────────────
      else if (DEV_COLOR_MODES.has(colorMode)) {
        const vm = devFlatColors ? 0 : 0.25; // variation multiplier
        const vary = (base, pr, pg, pb) => {
          if (vm === 0) return base;
          const v = (((pr * 31 + pg * 17 + pb * 7) & 0xFF) - 128) * vm;
          return [Math.max(0,Math.min(255,base[0]+v)), Math.max(0,Math.min(255,base[1]+v)), Math.max(0,Math.min(255,base[2]+v))];
        };
        // For hidden_resource, precompute per-region "has it?" once so the
        // 15M-pixel canvas pass is just a WeakMap lookup instead of a string
        // split per pixel — clicking a token redraws much faster.
        const hrMatch = new WeakMap();
        if (colorMode === "hidden_resource" && selectedHiddenResource) {
          for (const r of Object.values(regions)) hrMatch.set(r, hasTag(r.tags, selectedHiddenResource));
        }
        const getBase = (r) => {
          if (colorMode === "terrain") { const t = getTagValue(r.tags, TERRAIN_TAGS); return (t && TERRAIN_COLORS[t]) || [100,100,100]; }
          if (colorMode === "climate") { const c = getTagValue(r.tags, CLIMATE_TAGS); return (c && CLIMATE_COLORS[c]) || [100,100,100]; }
          if (colorMode === "port_level") {
            const lvl = getPortLevel(r.tags); const isTI = r.region === "Terra_Incognita";
            if (lvl != null && lvl > 0) return PORT_COLORS[lvl] || PORT_COLORS.inland;
            if (lvl === 0 && !isTI) return PORT_COLORS[0];
            return PORT_COLORS.inland;
          }
          if (colorMode === "irrigation") { const irr = getTagValue(r.tags, IRRIGATION_TAGS); return irr ? IRRIGATION_COLORS[irr] : IRRIGATION_COLORS.none; }
          if (colorMode === "earthquakes") { return hasTag(r.tags, "earthquake") ? [200,70,60] : [80,160,80]; }
          if (colorMode === "rivertrade") { return hasTag(r.tags, "rivertrade") ? [50,170,70] : [160,130,100]; }
          if (colorMode === "hidden_resource") {
            if (!selectedHiddenResource) return [110, 110, 110];
            return hrMatch.get(r) ? [50, 180, 90] : [80, 65, 60];
          }
          return [100,100,100];
        };
        setColoredOffscreen(buildColoredCanvas(pxData, W, H, regions, (r, pr, pg, pb) => vary(getBase(r), pr, pg, pb)));
      }
    });
  }, [colorMode, regions, offscreen, imgSize, populationData, coastalRegions, devFlatColors, factionColors, factionRegionsMap, homelandsData, selectedFaction, governmentMap, selectedHiddenResource, resourcesData, buildingRecruits, unitOwnership, factionCultures, currentOwnerByCity, initialOwnerByCity, buildingLevelsLookup, buildingsData]);

  // Cache the dimming overlay — active whenever provinces are selected.
  // When `pinFaction` is on AND a faction is selected, the dim is much
  // stronger (alpha 200 vs the default 90), so the selected faction's
  // territory reads as the foreground and everything else fades.
  useEffect(() => {
    if (selectedProvinces.length === 0 || !pixelDataRef.current) {
      setDimOverlay(null);
      return;
    }
    const selectedSet = new Set(selectedProvinces);
    const pxData = pixelDataRef.current;
    const dimCanvas = document.createElement("canvas");
    dimCanvas.width = imgSize.width; dimCanvas.height = imgSize.height;
    const dimCtx = dimCanvas.getContext("2d");
    const dimImg = dimCtx.createImageData(imgSize.width, imgSize.height);
    const dd = dimImg.data;
    const dimAlpha = pinFaction && selectedFaction ? 200 : 90;
    for (let i = 0; i < pxData.length; i += 4) {
      const key = `${pxData[i]},${pxData[i+1]},${pxData[i+2]}`;
      if (regions[key] && !selectedSet.has(key)) {
        dd[i] = 0; dd[i+1] = 0; dd[i+2] = 0; dd[i+3] = dimAlpha;
      }
    }
    dimCtx.putImageData(dimImg, 0, 0);
    setDimOverlay(dimCanvas);
  }, [selectedProvinces, regions, imgSize, pinFaction, selectedFaction]);

  // Draw minimap
  const MINIMAP_W = 160;
  useEffect(() => {
    const mm = minimapRef.current;
    if (!mm || !offscreen || showSplash) return;
    const drawCanvas = coloredOffscreen || offscreen;
    const mmH = Math.round(MINIMAP_W * imgSize.height / imgSize.width);
    mm.width = MINIMAP_W;
    mm.height = mmH;
    const ctx = mm.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(drawCanvas, 0, 0, MINIMAP_W, mmH);
    // Viewport rectangle
    const { totalScale, baseOffsetX, baseOffsetY } = computeTransform();
    const mmScale = MINIMAP_W / imgSize.width;
    const vx = (-baseOffsetX - offset.x) / totalScale * mmScale;
    const vy = (-baseOffsetY - offset.y) / totalScale * mmScale;
    const vw = canvasSize.width / totalScale * mmScale;
    const vh = canvasSize.height / totalScale * mmScale;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(Math.max(0, vx), Math.max(0, vy),
      Math.min(MINIMAP_W - Math.max(0, vx), vw), Math.min(mmH - Math.max(0, vy), vh));
  }, [offscreen, coloredOffscreen, zoom, offset, canvasSize, imgSize, computeTransform, showSplash]);

  // Load regions
  useEffect(() => {
    (async () => {
      try {
        setAssetError(null);
        const campaign = CAMPAIGNS[mapCampaign];
        const r = await loadCampaignData(campaign.regionsFile);
        setRegions(JSON.parse(r.text));
      } catch (e) {
        setRegions({});
        setAssetError(`Failed to load regions. ${e.message}. Ensure it exists in public/ (or build/).`);
      }
    })();
  }, [loadCampaignData, mapCampaign]);

  // Overlay runtime-parsed descr_strat ownership onto the bundled regions
  // map. The bundled `regions_large.json` was generated against whatever
  // mod state was current when the dev ran `npm run bundle-data` — for
  // any other user, or after a descr_strat edit, the bundled `faction`
  // value is stale (e.g. Uria's owner shown as romans_julii when current
  // descr_strat puts it under messapians). `initialOwnerByCity` is the
  // authoritative turn-0 owner per the loaded mod's descr_strat —
  // overlay it onto each region whose city is in the map.
  useEffect(() => {
    if (!initialOwnerByCity || Object.keys(initialOwnerByCity).length === 0) return;
    setRegions((prev) => {
      let touched = false;
      const next = { ...prev };
      for (const [rgb, r] of Object.entries(prev)) {
        if (!r || !r.city) continue;
        const realOwner = initialOwnerByCity[r.city];
        if (realOwner && realOwner !== r.faction) {
          next[rgb] = { ...r, faction: realOwner };
          touched = true;
        }
      }
      return touched ? next : prev;
    });
  }, [initialOwnerByCity]);

  // Keep selection on map mode change; only reset on region data changes
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [canvasSize.width, canvasSize.height, imgSize.width, imgSize.height]);

  useEffect(() => {
    // If underlying regions change, clear selection to avoid stale references
    setRegionInfo(null);
    setSelectedProvinces([]);
    setSelectedFaction(null);
    setSelectedFactions(new Set());
  }, [regions]);

  // Re-sync selected provinces when map mode or faction selection changes
  useEffect(() => {
    if (selectedFactions.size === 0) return;
    const allKeys = [...selectedFactions].flatMap(f => {
      const targets = regionsForFaction(f);
      return targets.map((regionName) => {
        for (const rgbKey in regions) {
          const reg = regions[rgbKey];
          if (
            reg.region?.toLowerCase() === regionName.toLowerCase() ||
            reg.city?.toLowerCase() === regionName.toLowerCase()
          ) return rgbKey;
        }
        return null;
      }).filter(Boolean);
    });
    setSelectedProvinces([...new Set(allKeys)]);
  }, [colorMode, selectedFactions, regions, victoryConditions, factionRegionsMap, regionsForFaction]);

  // iconsPreloaded gates splash dismissal so the UI isn't revealed before
  // faction icons are cached. The preload effect itself is further down in
  // the component (keyed on `factions`).
  const [iconsPreloaded, setIconsPreloaded] = useState(false);

  // Music plays on splash whenever the user is going to see the onboarding flow
  // (test builds, or a release build on a first launch where onboarding hasn't
  // been dismissed). Once started it plays to natural end — nothing stops it
  // when the cards are dismissed. Mute flips .muted/.volume on the live element
  // (handled in toggleAudioMuted) so unmuting later picks up at the current playhead.
  const [welcomePhase, setWelcomePhase] = useState(null); // still tracked for future use
  const audioMutedRef = useRef(audioMuted);
  useEffect(() => { audioMutedRef.current = audioMuted; }, [audioMuted]);
  const musicStartedRef = useRef(false);
  useEffect(() => {
    if (!showSplash || musicStartedRef.current) return;
    const willShowOnboarding = isTestBuild || !onboardingDone;
    if (!willShowOnboarding) return;
    musicStartedRef.current = true;
    try {
      const audio = new Audio((import.meta.env.BASE_URL || ".") + "/startup.wav");
      audioOriginalVolumeRef.current = 0.7;
      const mutedAtStart = audioMutedRef.current;
      audio.volume = mutedAtStart ? 0 : audioOriginalVolumeRef.current;
      audio.muted = mutedAtStart;
      currentAudioRef.current = audio;
      audio.addEventListener("ended", () => {
        if (currentAudioRef.current === audio) currentAudioRef.current = null;
      });
      audio.play().catch(() => {});
    } catch {}
  }, [showSplash, isTestBuild, onboardingDone]);

  // Splash auto-hide: normal path and hard cap fallback
  // When splash ends, show welcome/what's-new screen before the main UI.
  // One-shot: subsequent calls (re-fired when campaign switches re-run the splash
  // effect) must not re-open the welcome screen.
  const hideSplash = useCallback(() => {
    setShowSplash(false);
    if (!welcomeShownOnceRef.current) {
      welcomeShownOnceRef.current = true;
      setShowWelcome(true);
    }
  }, []);
  // Force faction mode when the welcome screen is showing
  useEffect(() => {
    if (showWelcome) setColorMode("faction");
  }, [showWelcome]);
  useEffect(() => {
    const essentialsReady = !!offscreen && imgSize.width > 0 && imgSize.height > 0;
    const uiReady = essentialsReady && iconsPreloaded;
    const elapsed = Date.now() - splashStartRef.current;
    const remaining = Math.max(0, SPLASH_MIN_MS - elapsed);
    // Hard cap: whichever comes first — SPLASH_HARD_MAX_MS total, or 5s after
    // essentials showed up (in case icon preload stalls).
    const hardCapDelay = Math.max(
      0,
      Math.min(SPLASH_HARD_MAX_MS - elapsed, (essentialsReady ? 5000 : SPLASH_HARD_MAX_MS))
    );
    const hardCap = setTimeout(hideSplash, hardCapDelay);
    if (uiReady || assetError) {
      const t = setTimeout(hideSplash, remaining);
      return () => {
        clearTimeout(t);
        clearTimeout(hardCap);
      };
    }
    return () => clearTimeout(hardCap);
  }, [offscreen, imgSize, iconsPreloaded, assetError, hideSplash]);

  // Draw map
  useEffect(() => {
    if (showSplash || (assetError && !proceedAnyway)) return;
    if (!offscreen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { totalScale, baseOffsetX, baseOffsetY } = computeTransform();
    ctx.setTransform(totalScale, 0, 0, totalScale, baseOffsetX + offset.x, baseOffsetY + offset.y);
    ctx.imageSmoothingEnabled = false;
    const src = coloredOffscreen || offscreen;
    ctx.drawImage(src, 0, 0);

    // Draw stripe overlay (high-res, scaled down with smoothing for clean lines)
    if (stripeOverlay) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(stripeOverlay, 0, 0, imgSize.width, imgSize.height);
      ctx.restore();
    }

    // Dim non-selected provinces when legend filter is active (cached overlay)
    if (dimOverlay) {
      ctx.drawImage(dimOverlay, 0, 0);
    }

    // Borders toggle: faction borders (black) + internal province borders (light)
    // In culture mode, use culture-group borders instead of faction borders
    if (devCultureBorders) {
      ctx.save();
      ctx.lineJoin = "round";
      // Thin lighter borders between individual provinces (internal)
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 0.6 / totalScale;
      for (const path of Object.values(borderPaths)) ctx.stroke(path);
      // Thick black border at group boundaries
      const groupPath = colorMode === "culture" ? cultureBorderPath : factionBorderPath;
      if (groupPath) {
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.lineWidth = 2 / totalScale;
        ctx.stroke(groupPath);
      }
      ctx.restore();
    }

    // In dev modes: thin province borders + thick group borders
    if (DEV_COLOR_MODES.has(colorMode)) {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 0.6 / totalScale;
      for (const path of Object.values(borderPaths)) ctx.stroke(path);
      if (devBorderPath) {
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.lineWidth = 2 / totalScale;
        ctx.stroke(devBorderPath);
      }
      ctx.restore();
    }

    // Selected province borders
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = 1.5 / totalScale;
    ctx.lineJoin = "round";
    for (const rgbKey of selectedProvinces) {
      const border = borderPaths[rgbKey];
      if (border) ctx.stroke(border);
    }
    ctx.restore();

    // Draw resource icons at their actual map coordinates (resource mode only)
    if (colorMode === "resource" && Object.keys(resourceImages).length > 0) {
      const ICON_PX = Math.min(22, Math.max(8, 6 + zoom * 3)); // scales with zoom: 8–22px
      const iconSz = ICON_PX / totalScale;
      const half = iconSz / 2;
      const SKIP = new Set([]);
      // Overlap prevention: track placed icon screen positions, skip if too close
      const placedIcons = [];
      const MIN_SPACING = ICON_PX * 0.7; // minimum screen-pixel gap between icons
      // Dev mode: detect resources sharing the same pixel (by stored x,y)
      const pixelOccupants = {};
      if (devMode) {
        for (const [, entries] of Object.entries(resourcesData)) {
          if (!Array.isArray(entries)) continue;
          for (const res of entries) {
            const pk = `${res.x},${res.y}`;
            pixelOccupants[pk] = (pixelOccupants[pk] || 0) + 1;
          }
        }
      }
      // Iterate all regions; resources are stored as [{type,x,y,amount}]
      for (const [regionName, entries] of Object.entries(resourcesData)) {
        if (!Array.isArray(entries)) continue;
        for (const res of entries) {
          if (SKIP.has(res.type)) continue;
          if (resourceFilter !== null && !resourceFilter.has(res.type)) continue;
          const img = resourceImages[res.type];
          if (!img) continue;
          // If this resource is being dragged, draw at mouse position instead
          const isDragging = devDragResource && devDragResource.regionName === regionName && devDragResource.type === res.type;
          let drawX, drawY;
          if (isDragging) {
            drawX = (devDragResource.mx - baseOffsetX - offset.x) / totalScale;
            drawY = (devDragResource.my - baseOffsetY - offset.y) / totalScale;
          } else {
            drawX = res.x + 0.5;
            drawY = res.y - 0.5;
          }
          // Cull off-screen
          const sx = drawX * totalScale + baseOffsetX + offset.x;
          const sy = drawY * totalScale + baseOffsetY + offset.y;
          if (sx < -ICON_PX || sx > canvasSize.width + ICON_PX) continue;
          if (sy < -ICON_PX || sy > canvasSize.height + ICON_PX) continue;
          // Skip if overlapping a previously placed icon (except when dragging)
          if (!isDragging) {
            let overlaps = false;
            for (const p of placedIcons) {
              if (Math.abs(sx - p.x) < MIN_SPACING && Math.abs(sy - p.y) < MIN_SPACING) { overlaps = true; break; }
            }
            if (overlaps) continue;
            placedIcons.push({ x: sx, y: sy });
          }
          ctx.save();
          if (isDragging) ctx.globalAlpha = 0.7;
          ctx.drawImage(img, drawX - half, drawY - half, iconSz, iconSz);
          // Dev warning: red ring if multiple resources share this pixel
          if (devMode && pixelOccupants[`${res.x},${res.y}`] > 1) {
            ctx.strokeStyle = "rgba(255,40,40,0.9)";
            ctx.lineWidth = Math.max(1.5 / totalScale, 0.3);
            ctx.beginPath();
            ctx.arc(drawX, drawY, half * 0.9, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    }

    // Draw siege indicators on besieged settlements
    if (Object.keys(activeSieges).length > 0) {
      const mh = (CAMPAIGNS[mapCampaign]?.mapHeight || 350) - 1;
      const siegeR = Math.max(3 / totalScale, 0.8);
      for (const [name, siege] of Object.entries(activeSieges)) {
        const mapX = siege.x;
        const mapY = mh - siege.y; // flip Y from log coords to map coords
        const sx = mapX * totalScale + baseOffsetX + offset.x;
        const sy = mapY * totalScale + baseOffsetY + offset.y;
        if (sx < -20 || sx > canvasSize.width + 20 || sy < -20 || sy > canvasSize.height + 20) continue;
        ctx.save();
        // Red pulsing circle
        ctx.beginPath();
        ctx.arc(mapX + 0.5, mapY + 0.5, siegeR, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 40, 40, 0.9)";
        ctx.lineWidth = Math.max(0.8 / totalScale, 0.2);
        ctx.stroke();
        // Inner X
        const cr = siegeR * 0.45;
        ctx.beginPath();
        ctx.moveTo(mapX + 0.5 - cr, mapY + 0.5 - cr);
        ctx.lineTo(mapX + 0.5 + cr, mapY + 0.5 + cr);
        ctx.moveTo(mapX + 0.5 + cr, mapY + 0.5 - cr);
        ctx.lineTo(mapX + 0.5 - cr, mapY + 0.5 + cr);
        ctx.strokeStyle = "rgba(255, 60, 60, 0.8)";
        ctx.lineWidth = Math.max(0.4 / totalScale, 0.1);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Draw army markers when the Armies overlay toggle is on — works over
    // any colorMode, not just a dedicated armies map mode. Uses armiesToRender
    // which picks the save-parsed live armies when available, else falls
    // back to descr_strat starting armies.
    if (armiesToRender.length > 0 && showArmies) {
      // Marker radius scales with zoom so the dot is visible at every
      // zoom level: ~3px at full-map view, growing as you zoom in. The
      // earlier 1.5px floor was too small to spot at default zoom — the
      // user had to zoom way in before seeing anything, which made the
      // feature feel broken. Floor of 3 screen-px is small enough not
      // to clutter, big enough to spot a stack at a glance.
      const r = Math.max(3 / totalScale, 0.4);

      // Class shape conventions: garrison = filled circle (sits on the
      // city tile), field = diamond (mobile), navy = anchor-style. Keep
      // them simple; the faction-coloured border + class-coloured fill
      // is enough to read at a glance.
      const COLORS = {
        garrison: 'rgba(220,160,40,0.95)',
        field:    'rgba(180,40,40,0.95)',
        navy:     'rgba(40,110,210,0.95)',
      };

      for (const army of armiesToRender) {
        if (army.armyClass === 'garrison' && !showGarrisons) continue;
        if (army.armyClass === 'field'    && !showFieldArmies) continue;
        if (army.armyClass === 'navy'     && !showNavies) continue;
        if (typeof army.x !== 'number' || typeof army.y !== 'number') continue;
        const mapY = (imgSize.height - 1) - army.y;
        const sx = army.x * totalScale + baseOffsetX + offset.x;
        const sy = mapY * totalScale + baseOffsetY + offset.y;
        const margin = r * totalScale + 4;
        if (sx < -margin || sx > canvasSize.width + margin) continue;
        if (sy < -margin || sy > canvasSize.height + margin) continue;

        ctx.save();
        ctx.beginPath();
        ctx.arc(army.x + 0.5, mapY + 0.5, r, 0, Math.PI * 2);
        ctx.fillStyle = COLORS[army.armyClass] || COLORS.field;
        ctx.fill();
        // Faction-coloured outline. Wider line than before so it reads
        // as a coloured halo around the dot rather than a hairline.
        const fc = factionColors[(army.faction || "").toLowerCase()];
        if (fc && fc.primary) {
          ctx.strokeStyle = `rgb(${fc.primary[0]},${fc.primary[1]},${fc.primary[2]})`;
          ctx.lineWidth = Math.max(1.2 / totalScale, 0.3);
        } else {
          ctx.strokeStyle = "rgba(0,0,0,0.85)";
          ctx.lineWidth = Math.max(0.8 / totalScale, 0.25);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // Dev pixel grid overlay — only when zoomed in enough that pixels are visible
    if (devGrid && totalScale >= 4) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 0.5 / totalScale;
      // Calculate visible pixel range
      const vx0 = Math.max(0, Math.floor((-baseOffsetX - offset.x) / totalScale));
      const vy0 = Math.max(0, Math.floor((-baseOffsetY - offset.y) / totalScale));
      const vx1 = Math.min(imgSize.width, Math.ceil((canvasSize.width - baseOffsetX - offset.x) / totalScale));
      const vy1 = Math.min(imgSize.height, Math.ceil((canvasSize.height - baseOffsetY - offset.y) / totalScale));
      ctx.beginPath();
      for (let gx = vx0; gx <= vx1; gx++) { ctx.moveTo(gx, vy0); ctx.lineTo(gx, vy1); }
      for (let gy = vy0; gy <= vy1; gy++) { ctx.moveTo(vx0, gy); ctx.lineTo(vx1, gy); }
      ctx.stroke();
      ctx.restore();
    }

    // Settlement tier — recolor black city pixels by tier
    if (showSettlementTier && cityPixels.length > 0 && Object.keys(settlementTierMap).length > 0) {
      const TIER_COLORS = {
        village:    "rgba(170,110,60,1)",
        town:       "rgba(200,50,50,1)",
        large_town: "rgba(120,200,80,1)",
        city:       "rgba(40,175,140,1)",
        large_city: "rgba(240,150,170,1)",
        huge_city:  "rgba(210,190,100,1)",
      };
      for (const cp of cityPixels) {
        const tier = settlementTierMap[cp.rgbKey];
        if (!tier) continue;
        const sx = cp.x * totalScale + baseOffsetX + offset.x;
        const sy = cp.y * totalScale + baseOffsetY + offset.y;
        if (sx < -2 || sx > canvasSize.width + 2) continue;
        if (sy < -2 || sy > canvasSize.height + 2) continue;
        ctx.fillStyle = TIER_COLORS[tier] || TIER_COLORS.town;
        ctx.fillRect(cp.x, cp.y, 1, 1);
      }
    }

    // Draw city/region name labels on the map
    if (showLabels !== "off" && cityPixels.length > 0) {
      ctx.save();
      const fontSize = Math.max(3, Math.min(12, 4 + zoom * 1.5));
      ctx.font = `bold ${fontSize / totalScale}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const labelOffset = 1.5 / totalScale; // gap below settlement dot
      for (const cp of cityPixels) {
        const r = regions[cp.rgbKey];
        if (!r) continue;
        const label = showLabels === "city" ? (r.city || r.region || "") : (r.region || r.city || "");
        if (!label) continue;
        const lx = cp.x + 0.5;
        const ly = cp.y + 1 + labelOffset;
        // Shadow for readability
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillText(label.replace(/_/g, " "), lx + 0.15 / totalScale, ly + 0.15 / totalScale);
        ctx.fillStyle = "#fff";
        ctx.fillText(label.replace(/_/g, " "), lx, ly);
      }
      ctx.restore();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [
    zoom,
    offset,
    offscreen,
    coloredOffscreen,
    canvasSize,
    imgSize,
    selectedProvinces,
    borderPaths,
    showSplash,
    assetError,
    proceedAnyway,
    computeTransform,
    colorMode,
    cultureBorderPath,
    factionBorderPath,
    devBorderPath,
    devDragResource,
    devGrid,
    devMode,
    devCultureBorders,
    showSettlementTier,
    showLabels,
    cityPixels,
    settlementTierMap,
    stripeOverlay,
    resourceImages,
    resourcesData,
    regionCentroids,
    regions,
    resourceFilter,
    legendFilter,
    dimOverlay,
    armiesData,
    armiesToRender,
    activeSieges,
    showArmies,
    showGarrisons,
    showFieldArmies,
    showNavies,
    factionColors,
  ]);

  // Load map image (PNG or TGA depending on campaign)
  useEffect(() => {
    const campaign = CAMPAIGNS[mapCampaign];
    let cancelled = false;

    (async () => {
      try {
        const r = await loadCampaignData(campaign.mapFile);
        if (cancelled) return;

        if (campaign.mapType === "tga" || r.binary) {
          const buffer = r.binary || (typeof r.text === "string" ? null : r.text);
          if (!buffer) throw new Error("No binary data for TGA");
          const decoded = await decodeTgaAsync(buffer);
          if (cancelled) return;
          const off = document.createElement("canvas");
          off.width = decoded.width;
          off.height = decoded.height;
          const offCtx = off.getContext("2d", { willReadFrequently: true });
          offCtx.putImageData(new ImageData(decoded.data, decoded.width, decoded.height), 0, 0);
          pixelDataRef.current = offCtx.getImageData(0, 0, decoded.width, decoded.height).data;
          setImgSize({ width: decoded.width, height: decoded.height });
          setOffscreen(off);
          setAssetError(null);
        } else {
          // PNG — need to load via Image element; fall back to fetch URL
          const srcUrl = PUBLIC_URL + "/" + campaign.mapFile;
          const img = new window.Image();
          img.src = srcUrl;
          img.onload = () => {
            if (cancelled) return;
            setImgSize({ width: img.width, height: img.height });
            const off = document.createElement("canvas");
            off.width = img.width;
            off.height = img.height;
            const offCtx = off.getContext("2d", { willReadFrequently: true });
            offCtx.drawImage(img, 0, 0);
            pixelDataRef.current = offCtx.getImageData(0, 0, img.width, img.height).data;
            setOffscreen(off);
            setAssetError(null);
          };
          img.onerror = (e) => {
            if (cancelled) return;
            setOffscreen(null);
            setAssetError(`Failed to load ${campaign.label} map (${campaign.mapFile}). ${e.message}.`);
          };
        }
      } catch (e) {
        if (cancelled) return;
        setOffscreen(null);
        setAssetError(`Failed to load ${campaign.label} map (${campaign.mapFile}). ${e.message}.`);
      }
    })();

    return () => { cancelled = true; };
  }, [mapCampaign, loadCampaignData, PUBLIC_URL]);

  // Factions starting order (used for both modes)
  useEffect(() => {
    (async () => {
      try {
        const campaign = CAMPAIGNS[mapCampaign];
        const r = await loadCampaignData(campaign.factionsFile);
        const data = JSON.parse(r.text);
        setFactionRegionsMap(data);
        setFactions(Object.keys(data)); // preserve file order for both modes
      } catch {
        setFactionRegionsMap({});
        setFactions([]);
      }
    })();
  }, [loadCampaignData, mapCampaign]);

  // Faction starting treasury (descr_strat field 2 per faction).
  const [factionWealth, setFactionWealth] = useState({});
  useEffect(() => {
    (async () => {
      try {
        const fname = mapCampaign === "imperial" ? "faction_wealth_large.json" : "faction_wealth_classic.json";
        const r = await loadCampaignData(fname);
        setFactionWealth(JSON.parse(r.text) || {});
      } catch { setFactionWealth({}); }
    })();
  }, [loadCampaignData, mapCampaign]);
  const [showWealthPanel, setShowWealthPanel] = useState(false);
  const [showStatsPanel, setShowStatsPanel] = useState(false);

  // Preload effect body lives here; the iconsPreloaded state is declared
  // earlier in the component so the splash auto-hide effect can depend on it.
  // Preload BOTH bundled and mod-folder TGAs so the first render of the
  // faction grid hits the cache instantly — without the mod-side preload,
  // each FactionIcon mount kicked off a fresh IPC + TGA decode AFTER the
  // splash dismissed, producing a visible pop-in.
  useEffect(() => {
    if (!factions || factions.length === 0) return;
    setIconsPreloaded(false);
    let cancelled = false;
    const jobs = [preloadIcon("faction_icons/slave.tga")];
    for (const f of factions) {
      jobs.push(preloadIcon(`faction_icons/${f}.tga`));
      if (modIconsDir) jobs.push(preloadModIcon(modIconsDir, f));
    }
    if (modIconsDir) jobs.push(preloadModIcon(modIconsDir, "slave"));
    Promise.allSettled(jobs).then(() => {
      if (!cancelled) setIconsPreloaded(true);
    });
    return () => { cancelled = true; };
  }, [factions, modIconsDir]);

  // Precompute borders
  useEffect(() => {
    if (!regions || !offscreen || !imgSize || imgSize.width === 0) return;
    const schedule = (cb) => {
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(cb, { timeout: 2000 });
      else setTimeout(cb, 0);
    };
    schedule(() => {
      const result = prerenderBorderPaths(regions, offscreen, imgSize);
      setBorderPaths(result.borderPaths);
      setCoastalRegions(result.coastalRegions);
    });
    schedule(() => {
      setCultureBorderPath(prerenderCultureBorderPath(regions, offscreen, imgSize));
    });
  }, [regions, offscreen, imgSize]);

  // Precompute faction border path for Borders toggle
  useEffect(() => {
    if (!offscreen || !regions || Object.keys(regions).length === 0 || Object.keys(factionRegionsMap).length === 0) {
      setFactionBorderPath(null);
      return;
    }
    // Build rgbKey → faction owner lookup
    const rgbToOwner = {};
    for (const [faction, regionNames] of Object.entries(factionRegionsMap)) {
      for (const rn of regionNames) {
        for (const [rgbKey, r] of Object.entries(regions)) {
          if (r.region?.toLowerCase() === rn.toLowerCase() || r.city?.toLowerCase() === rn.toLowerCase()) {
            rgbToOwner[rgbKey] = faction;
            break;
          }
        }
      }
    }
    const schedule = (cb) => {
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(cb, { timeout: 2000 });
      else setTimeout(cb, 0);
    };
    schedule(() => {
      setFactionBorderPath(prerenderGroupBorderPath(regions, offscreen, imgSize,
        (r, rgbStr) => rgbToOwner[rgbStr] || r.faction || null));
    });
  }, [regions, offscreen, imgSize, factionRegionsMap]);

  // Precompute group border paths for dev map modes
  useEffect(() => {
    if (!DEV_COLOR_MODES.has(colorMode) || !offscreen || !regions || Object.keys(regions).length === 0) {
      setDevBorderPath(null);
      return;
    }
    // Skip border path for hidden_resource — borders around individual tokens
    // aren't useful, and the 15M-pixel scan was the main lag on each click
    if (colorMode === "hidden_resource") {
      setDevBorderPath(null);
      return;
    }
    setDevBorderPath(null);
    const classifiers = {
      terrain:    (r) => getTagValue(r.tags, TERRAIN_TAGS) || "unknown",
      climate:    (r) => getTagValue(r.tags, CLIMATE_TAGS) || "unknown",
      port_level: (r) => { const lvl = getPortLevel(r.tags); if (lvl != null && lvl > 0) return String(lvl); if (lvl === 0 && r.region !== "Terra_Incognita") return "0"; return "inland"; },
      irrigation: (r) => getTagValue(r.tags, IRRIGATION_TAGS) || "none",
      earthquakes:(r) => hasTag(r.tags, "earthquake") ? "yes" : "no",
      rivertrade: (r) => hasTag(r.tags, "rivertrade") ? "yes" : "no",
    };
    const classify = classifiers[colorMode];
    if (!classify) return;
    // Capture current offscreen to detect stale computation
    const currentOffscreen = offscreen;
    setTimeout(() => {
      // Bail if offscreen changed (campaign switch) while we were queued
      if (currentOffscreen !== offscreen) return;
      setDevBorderPath(prerenderGroupBorderPath(regions, currentOffscreen, imgSize, classify));
    }, 0);
  }, [colorMode, regions, offscreen, imgSize]);

  // Layout sizing
  useEffect(() => {
    function handleResize() {
      const baselineSidebar = PANEL_WIDTH * 2 + PANELS_GAP;
      const availableWidthForMap =
        window.innerWidth - MAP_PADDING * 2 - baselineSidebar - PANELS_GAP - MAP_WIDTH_ADJUST;

      const availableHeightForMap =
        window.innerHeight - MAP_PADDING * 2 - REGIONINFO_HEIGHT - MAP_PADDING;

      const imgAspect = imgSize.width / imgSize.height;
      let mapW = availableWidthForMap;
      let mapH = Math.round(mapW / imgAspect);
      if (mapH > availableHeightForMap) {
        mapH = availableHeightForMap;
        mapW = Math.round(mapH * imgAspect);
      }
      mapW = Math.max(100, mapW);
      mapH = Math.max(100, mapH);

      const rightLeft = MAP_PADDING + mapW + PANELS_GAP;
      const rightWidth = Math.max(200, Math.floor(window.innerWidth - rightLeft - MAP_PADDING));

      setCanvasSize({ width: mapW, height: mapH });
      setRightColWidth(rightWidth);
    }
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, [imgSize.width, imgSize.height]);

  // Measure top-left bar height dynamically so the legend panel can avoid overlapping it
  useEffect(() => {
    const el = topBarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setTopBarHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function handleMouseDown(e) {
    // Dev mode + resource mode: check if clicking on a resource icon to drag it
    if (devMode && colorMode === "resource" && e.button === 0) {
      const { totalScale, baseOffsetX, baseOffsetY } = computeTransform();
      const mx = e.nativeEvent.offsetX, my = e.nativeEvent.offsetY;
      const ICON_PX = 20;
      for (const [regionName, entries] of Object.entries(resourcesData)) {
        if (!Array.isArray(entries)) continue;
        for (const res of entries) {
          const sx = (res.x + 0.5) * totalScale + baseOffsetX + offset.x;
          const sy = (res.y - 0.5) * totalScale + baseOffsetY + offset.y;
          if (Math.abs(mx - sx) <= ICON_PX / 2 && Math.abs(my - sy) <= ICON_PX / 2) {
            setDevDragResource({ regionName, type: res.type, mx, my });
            e.preventDefault();
            return; // Don't start map drag
          }
        }
      }
    }
    setDrag({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, ox: offset.x, oy: offset.y, moved: false });
  }
  function handleMouseUp(e) {
    if (devDragResource && e) {
      const { totalScale, baseOffsetX, baseOffsetY } = computeTransform();
      const mapX = (e.nativeEvent.offsetX - baseOffsetX - offset.x) / totalScale;
      const mapY = (e.nativeEvent.offsetY - baseOffsetY - offset.y) / totalScale;
      setResourcesData(prev => {
        const next = { ...prev };
        next[devDragResource.regionName] = (next[devDragResource.regionName] || []).map(r =>
          r.type === devDragResource.type ? { ...r, x: Math.floor(mapX), y: Math.floor(mapY) + 1 } : r
        );
        return next;
      });
      markDirty("resources");
      setDevDragResource(null);
      // Prevent the click event that follows from selecting/deselecting
      devDragJustEndedRef.current = true;
      setTimeout(() => { devDragJustEndedRef.current = false; }, 50);
      return;
    }
    if (drag && drag.moved) {
      panJustEndedRef.current = true;
      setTimeout(() => { panJustEndedRef.current = false; }, 50);
    }
    setDrag(null);
    setDevDragResource(null);
  }
  function handleMouseMove(e) {
    if (devDragResource) {
      const mx = e.nativeEvent.offsetX, my = e.nativeEvent.offsetY;
      setDevDragResource(prev => prev ? { ...prev, mx, my } : null);
      // Update tooltip to show coordinates at current drag position
      const { totalScale, baseOffsetX, baseOffsetY } = computeTransform();
      const mapX = Math.round((mx - baseOffsetX - offset.x) / totalScale);
      const mapY = Math.round((my - baseOffsetY - offset.y) / totalScale);
      setHoveredResource(prev => prev ? { ...prev, resX: mapX, resY: mapY, screenX: mx, screenY: my } :
        { type: devDragResource.type, amount: null, resX: mapX, resY: mapY, screenX: mx, screenY: my });
      return;
    }
    if (drag) {
      const dx = e.nativeEvent.offsetX - drag.x;
      const dy = e.nativeEvent.offsetY - drag.y;
      if (!drag.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        setDrag(prev => prev ? { ...prev, moved: true } : null);
      }
      setOffset((prev) => clampOffset({ x: drag.ox + dx, y: drag.oy + dy }));
    } else if (pixelDataRef.current) {
      const { totalScale, baseOffsetX, baseOffsetY } = computeTransform();
      const mouseScreenX = e.nativeEvent.offsetX;
      const mouseScreenY = e.nativeEvent.offsetY;
      const x = Math.floor((mouseScreenX - baseOffsetX - offset.x) / totalScale);
      const y = Math.floor((mouseScreenY - baseOffsetY - offset.y) / totalScale);
      if (x >= 0 && y >= 0 && x < imgSize.width && y < imgSize.height) {
        const data = pixelDataRef.current;
        const i = (y * imgSize.width + x) * 4;
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2];
        const rgbKey = `${r},${g},${b}`;
        // Throttle: only re-set state when the cursor crossed into a
        // different region. Mouse-move fires every pixel; without this gate
        // setRegionInfo(...) creates a fresh object per pixel and re-renders
        // RegionInfo + downstream consumers many times per second.
        if (regions[rgbKey]) {
          setRegionInfo(prev => prev?.rgb === rgbKey ? prev : { ...regions[rgbKey], rgb: rgbKey });
        }
        else setRegionInfo(prev => prev === null ? prev : null);
      } else setRegionInfo(prev => prev === null ? prev : null);

      // Resource icon hover detection
      if (colorMode === "resource") {
        const ICON_PX = 20;
        const SKIP = new Set([]);
        let found = null;
        outer: for (const [regionName, entries] of Object.entries(resourcesData)) {
          if (!Array.isArray(entries)) continue;
          for (const res of entries) {
            if (SKIP.has(res.type)) continue;
            if (resourceFilter !== null && !resourceFilter.has(res.type)) continue;
            const { totalScale: ts, baseOffsetX: bx, baseOffsetY: by } = computeTransform();
            const sx = (res.x + 0.5) * ts + bx + offset.x;
            const sy = (res.y - 0.5) * ts + by + offset.y;
            if (Math.abs(mouseScreenX - sx) <= ICON_PX / 2 && Math.abs(mouseScreenY - sy) <= ICON_PX / 2) {
              // Look up region at the resource's pixel position using pixelDataRef (same as map hover)
              let resolvedRegion = regionName;
              const data = pixelDataRef.current;
              const lookupY = res.y - 1; // resource Y is height-stratY; pixel lookup needs height-1-stratY
              if (data && res.x >= 0 && lookupY >= 0 && res.x < imgSize.width && lookupY < imgSize.height) {
                const pi = (lookupY * imgSize.width + res.x) * 4;
                let rk = `${data[pi]},${data[pi+1]},${data[pi+2]}`;
                // If black pixel, check neighbors
                if (data[pi] === 0 && data[pi+1] === 0 && data[pi+2] === 0) {
                  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
                    const nx = res.x+dx, ny = res.y+dy;
                    if (nx >= 0 && ny >= 0 && nx < imgSize.width && ny < imgSize.height) {
                      const ni = (ny * imgSize.width + nx) * 4;
                      const nk = `${data[ni]},${data[ni+1]},${data[ni+2]}`;
                      if (regions[nk]) { rk = nk; break; }
                    }
                  }
                }
                if (regions[rk]) resolvedRegion = regions[rk].region;
              }
              found = { type: res.type, amount: res.amount, resX: res.x, resY: res.y, regionName: resolvedRegion, screenX: mouseScreenX, screenY: mouseScreenY };
              break outer;
            }
          }
        }
        setHoveredResource(found);
      } else {
        setHoveredResource(null);
      }

      // Army marker hover detection (only when overlay is on)
      if (showArmies && armiesToRender.length > 0) {
        const { totalScale: ts, baseOffsetX: bx, baseOffsetY: by } = computeTransform();
        // Hit area: at least 6 screen pixels so it's clickable even when tiny
        const hitPx = Math.max(6, 0.25 * ts);
        let foundArmy = null;
        for (const army of armiesToRender) {
          if (army.armyClass === 'garrison' && !showGarrisons) continue;
          if (army.armyClass === 'field'    && !showFieldArmies) continue;
          if (army.armyClass === 'navy'     && !showNavies) continue;
          if (typeof army.x !== 'number' || typeof army.y !== 'number') continue;
          const mapY = (imgSize.height - 1) - army.y;
          const sx = (army.x + 0.5) * ts + bx + offset.x;
          const sy = (mapY + 0.5) * ts + by + offset.y;
          if (Math.abs(mouseScreenX - sx) <= hitPx && Math.abs(mouseScreenY - sy) <= hitPx) {
            foundArmy = { army, screenX: mouseScreenX, screenY: mouseScreenY };
            break;
          }
        }
        setHoveredArmy(foundArmy);
      } else {
        setHoveredArmy(null);
      }

      // City label hover detection (Labels view mode) — triggers on any pixel in the province
      if (showLabels !== "off" && cityPixels.length > 0) {
        let foundCity = null;
        if (x >= 0 && y >= 0 && x < imgSize.width && y < imgSize.height) {
          const data = pixelDataRef.current;
          const pi = (y * imgSize.width + x) * 4;
          const rr = data[pi], gg = data[pi+1], bb = data[pi+2];
          let hovRgb = `${rr},${gg},${bb}`;
          // Resolve black pixels to nearest region
          if (rr === 0 && gg === 0 && bb === 0) {
            const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
            for (const [dx, dy] of dirs) {
              const nx = x+dx, ny = y+dy;
              if (nx >= 0 && ny >= 0 && nx < imgSize.width && ny < imgSize.height) {
                const ni = (ny * imgSize.width + nx) * 4;
                const nk = `${data[ni]},${data[ni+1]},${data[ni+2]}`;
                if (regions[nk]) { hovRgb = nk; break; }
              }
            }
          }
          if (regions[hovRgb]) {
            const cp = cityPixels.find(c => c.rgbKey === hovRgb);
            const r = regions[hovRgb];
            foundCity = {
              city: r.city || r.region,
              region: r.region,
              x: x, y: y,
              tier: settlementTierMap[hovRgb] || "unknown",
              screenX: mouseScreenX, screenY: mouseScreenY,
            };
          }
        }
        setHoveredCity(foundCity);
      } else {
        setHoveredCity(null);
      }
    }
  }
  function handleClick(e) {
    if (devDragJustEndedRef.current || panJustEndedRef.current) return;
    if (!pixelDataRef.current) return;
    const { totalScale, baseOffsetX, baseOffsetY } = computeTransform();

    // Resource mode: clicking an icon selects all regions with that resource type
    if (colorMode === "resource") {
      const ICON_PX = 20;
      const SKIP = new Set([]);
      const mx = e.nativeEvent.offsetX, my = e.nativeEvent.offsetY;
      for (const entries of Object.values(resourcesData)) {
        if (!Array.isArray(entries)) continue;
        for (const res of entries) {
          if (SKIP.has(res.type)) continue;
          if (resourceFilter !== null && !resourceFilter.has(res.type)) continue;
          const sx = (res.x + 0.5) * totalScale + baseOffsetX + offset.x;
          const sy = (res.y - 0.5) * totalScale + baseOffsetY + offset.y;
          if (Math.abs(mx - sx) <= ICON_PX / 2 && Math.abs(my - sy) <= ICON_PX / 2) {
            setResourceFilter(prev =>
              prev instanceof Set && prev.size === 1 && prev.has(res.type)
                ? null // clicking same type again = show all
                : new Set([res.type])
            );
            return;
          }
        }
      }
    }

    const x = Math.floor((e.nativeEvent.offsetX - baseOffsetX - offset.x) / totalScale);
    const y = Math.floor((e.nativeEvent.offsetY - baseOffsetY - offset.y) / totalScale);
    if (x >= 0 && y >= 0 && x < imgSize.width && y < imgSize.height) {
      const data = pixelDataRef.current;
      const i = (y * imgSize.width + x) * 4;
      const rgbKey = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      if (regions[rgbKey]) {
        // Lock info panel to clicked region (click same region again to unlock)
        setLockedRegionInfo((prev) => {
          if (prev?.rgb === rgbKey) return null;
          pushRecentRegion(rgbKey);
          return { ...regions[rgbKey], rgb: rgbKey };
        });
        // Shift = add/remove from selection; plain click = select only this one
        if (e.shiftKey) {
          setSelectedProvinces((prev) => prev.includes(rgbKey) ? prev.filter((k) => k !== rgbKey) : [...prev, rgbKey]);
        } else {
          setSelectedProvinces((prev) => prev.includes(rgbKey) && prev.length === 1 ? [] : [rgbKey]);
        }
      } else {
        setLockedRegionInfo(null);
        if (!e.shiftKey) setSelectedProvinces([]);
      }
    }
    handleMouseMove(e);
  }
  function handleContextMenu(e) {
    if (!devMode || !pixelDataRef.current) return;
    e.preventDefault();
    const { totalScale, baseOffsetX, baseOffsetY } = computeTransform();
    const x = Math.floor((e.nativeEvent.offsetX - baseOffsetX - offset.x) / totalScale);
    const y = Math.floor((e.nativeEvent.offsetY - baseOffsetY - offset.y) / totalScale);
    if (x >= 0 && y >= 0 && x < imgSize.width && y < imgSize.height) {
      const data = pixelDataRef.current;
      const i = (y * imgSize.width + x) * 4;
      const rgbKey = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      if (regions[rgbKey]) {
        setDevContextMenu({ x: e.clientX, y: e.clientY, rgbKey, region: regions[rgbKey] });
      }
    }
  }
  function applyDevEdit(rgbKey, field, value) {
    setRegions(prev => {
      const r = prev[rgbKey];
      if (!r) return prev;
      // Tag-based edit (dev modes)
      if (DEV_EDIT_OPTIONS[field]) {
        const opts = DEV_EDIT_OPTIONS[field];
        return { ...prev, [rgbKey]: { ...r, tags: replaceTag(r.tags, opts.tags, value) } };
      }
      // Hidden resource toggle: add the token if missing, remove if present
      if (field === "hidden_resource") {
        const token = String(value || "").trim();
        if (!token) return prev;
        const arr = String(r.tags || "").split(/,\s*/).map(s => s.trim()).filter(Boolean);
        const idx = arr.indexOf(token);
        const next = idx >= 0 ? arr.filter((_, i) => i !== idx) : [...arr, token];
        return { ...prev, [rgbKey]: { ...r, tags: next.join(", ") } };
      }
      // Direct field edit (faction, culture, farm, religion)
      if (field === "faction") {
        // Also move this region in factionRegionsMap (the descr_strat-derived
        // ownership map that faction map mode actually colors from). Without
        // this, the rebel-default in descr_regions changes but the canvas
        // doesn't redraw because owned regions read from factionRegionsMap.
        // And queue an ownership move for descr_strat patching on export.
        const regionName = r.region;
        if (regionName) {
          setFactionRegionsMap(prevMap => {
            const next = {};
            let placed = false;
            for (const [fac, list] of Object.entries(prevMap)) {
              const filtered = (list || []).filter(rn => String(rn).toLowerCase() !== regionName.toLowerCase());
              if (fac === value) {
                next[fac] = [...filtered, regionName];
                placed = true;
              } else {
                next[fac] = filtered;
              }
            }
            if (!placed) next[value] = [regionName];
            return next;
          });
          setFactionOwnerChanges(prev => ({ ...prev, [regionName]: value }));
        }
        return { ...prev, [rgbKey]: { ...r, faction: value } };
      }
      if (field === "culture") return { ...prev, [rgbKey]: { ...r, culture: value } };
      if (field === "farm") {
        const newTags = r.tags.replace(/\bFarm\d+\b/, `Farm${value}`);
        return { ...prev, [rgbKey]: { ...r, tags: newTags.includes(`Farm${value}`) ? newTags : newTags + `, Farm${value}` } };
      }
      if (field === "religion") {
        // Remove old dominant religion tag, add new one at level 4
        let tags = r.tags;
        // Find current dominant
        let bestTag = null, bestLvl = -1;
        for (const hit of String(tags).matchAll(/\brel_([a-z_]+?)_(\d+)\b/g)) {
          const lvl = parseInt(hit[2], 10);
          if (lvl > bestLvl) { bestTag = hit[0]; bestLvl = lvl; }
        }
        if (bestTag) tags = tags.replace(bestTag, `rel_${value}_4`);
        else tags = tags + `, rel_${value}_4`;
        return { ...prev, [rgbKey]: { ...r, tags } };
      }
      return prev;
    });
    // All region edits (tags, faction, culture, farm, religion) go into descr_regions.txt.
    // Faction edits ALSO require a descr_strat.txt patch (settlement block move).
    if (field === "faction") markDirty("descr_regions.txt", "descr_strat.txt");
    else markDirty("descr_regions.txt");
    setDevContextMenu(null);
  }
  function handleDoubleClick(e) {
    const { baseOffsetX, baseOffsetY, scale } = computeTransform();
    const offsetX = e.nativeEvent.offsetX,
      offsetY = e.nativeEvent.offsetY;
    const newZoom = Math.min(maxZoom, Number((zoom * 1.2).toFixed(2)));
    const wx = (offsetX - baseOffsetX - offset.x) / (scale * zoom);
    const wy = (offsetY - baseOffsetY - offset.y) / (scale * zoom);
    const newImgDisplayWidth = imgSize.width * scale * newZoom;
    const newImgDisplayHeight = imgSize.height * scale * newZoom;
    const newBaseOffsetX = (canvasSize.width - newImgDisplayWidth) / 2;
    const newBaseOffsetY = (canvasSize.height - newImgDisplayHeight) / 2;
    const newOffsetX = offsetX - newBaseOffsetX - wx * scale * newZoom;
    const newOffsetY = offsetY - newBaseOffsetY - wy * scale * newZoom;
    setZoom(newZoom);
    setOffset(clampOffset({ x: newOffsetX, y: newOffsetY }));
  }
  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const handler = (e) => {
      e.preventDefault();
      const { offsetX, offsetY } = e;
      // Exponential zoom: speed scales with current zoom level (Apple-style)
      const zoomSpeed = 0.0015;
      const factor = Math.exp(-e.deltaY * zoomSpeed);
      let newZoom = zoom * factor;
      newZoom = Math.max(minZoom, Math.min(maxZoom, newZoom));

      const { scale } = computeTransform();
      const imgDisplayWidth = imgSize.width * scale * zoom;
      const imgDisplayHeight = imgSize.height * scale * zoom;
      const baseOffsetX = (canvasSize.width - imgDisplayWidth) / 2;
      const baseOffsetY = (canvasSize.height - imgDisplayHeight) / 2;
      const wx = (offsetX - baseOffsetX - offset.x) / (scale * zoom);
      const wy = (offsetY - baseOffsetY - offset.y) / (scale * zoom);

      const newImgDisplayWidth = imgSize.width * scale * newZoom;
      const newImgDisplayHeight = imgSize.height * scale * newZoom;
      const newBaseOffsetX = (canvasSize.width - newImgDisplayWidth) / 2;
      const newBaseOffsetY = (canvasSize.height - newImgDisplayHeight) / 2;
      const newOffsetX = offsetX - newBaseOffsetX - wx * scale * newZoom;
      const newOffsetY = offsetY - newBaseOffsetY - wy * scale * newZoom;
      setZoom(Number(newZoom.toFixed(4)));
      setOffset(clampOffset({ x: newOffsetX, y: newOffsetY }));
    };
    node.addEventListener("wheel", handler, { passive: false });
    return () => node.removeEventListener("wheel", handler);
  }, [zoom, offset, canvasSize, imgSize, computeTransform, clampOffset, showSplash]);

  const tileBaseStyle = {
    width: ICON_SIZE,
    height: ICON_SIZE,
    cursor: "pointer",
    boxSizing: "border-box",
    borderRadius: 6,
    padding: 0,
    margin: 0,
    background: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "box-shadow 0.15s",
    overflow: "hidden",
    lineHeight: 0,
    boxShadow: "0 0 0 0 rgba(0,0,0,0)",
  };

  const widthForCols = (n) => ICON_SIDE_PAD * 2 + ICON_SIZE * n + ICON_GAP * (n - 1) + SCROLLBAR_GUTTER;
  const want4ColsWidth = widthForCols(4);
  const want3ColsWidth = widthForCols(3);

  // Faction panel: use all available space minus what the info panel needs
  const PANEL_TIGHT_PAD = 2; // horizontal padding from .panel-tight CSS (1px each side)
  const maxFactionWidth = rightColWidth - PANELS_GAP - RIGHT_MIN_WIDTH;
  // Calculate how many icon columns fit inside the panel (accounting for panel padding)
  const innerWidth = maxFactionWidth - PANEL_TIGHT_PAD;
  const fittableCols = Math.max(2, Math.floor((innerWidth + ICON_GAP) / (ICON_SIZE + ICON_GAP)));
  // Panel width = exact fit for N columns + panel padding
  const factionPanelTargetWidth = widthForCols(fittableCols) + PANEL_TIGHT_PAD;

  const isVictoryMode = colorMode === "victory";

  function regionNamesToKeys(regionNames) {
    return regionNames.map((regionName) => {
      for (const rgbKey in regions) {
        const reg = regions[rgbKey];
        if (
          reg.region?.toLowerCase() === regionName.toLowerCase() ||
          reg.city?.toLowerCase() === regionName.toLowerCase()
        ) return rgbKey;
      }
      return null;
    }).filter(Boolean);
  }

  // Port victory conditions from classic to imperial campaign
  async function portClassicVictory() {
    // Load mapping and classic VC if not cached
    let mapping = classicToImperial;
    let classicVC = classicVictory;
    if (!mapping) {
      const r = await fetch((import.meta.env.BASE_URL || "./") + "/classic_to_imperial.json");
      mapping = await r.json();
      setClassicToImperial(mapping);
    }
    if (!classicVC) {
      const r2 = await fetch((import.meta.env.BASE_URL || "./") + "/descr_win_conditions_classic.txt");
      classicVC = parseVictoryConditions(await r2.text());
      setClassicVictory(classicVC);
    }
    // Also build imperial city → region name map for conversion
    const impCityToRegion = {};
    for (const r of Object.values(regions)) {
      if (r.city && r.region) impCityToRegion[r.city.toLowerCase()] = r.region;
    }
    // Port each faction's victory conditions
    const ported = {};
    for (const [faction, vc] of Object.entries(classicVC)) {
      const impCities = new Set();
      for (const city of (vc.hold_regions || [])) {
        const mapped = mapping[city];
        if (mapped) {
          for (const ic of mapped) impCities.add(ic);
        } else {
          // Try direct name match
          if (impCityToRegion[city.toLowerCase()]) impCities.add(city);
        }
      }
      // Convert imperial city names to region names (victory conditions use region names internally)
      const impRegions = [...impCities].map(c => impCityToRegion[c.toLowerCase()]).filter(Boolean);
      ported[faction] = {
        hold_regions: [...new Set(impRegions)],
        take_regions: impRegions.length,
      };
    }
    setPortedVictory(ported);
    setSavedOriginalVictory(JSON.parse(JSON.stringify(victoryConditions)));
    setVictoryConditions(ported);
    setShowPortedVictory(true);
    markDirty("descr_win_conditions.txt");
  }

  function togglePortedVictory() {
    if (!portedVictory || !savedOriginalVictory) return;
    if (showPortedVictory) {
      // Switch back to original
      setVictoryConditions(savedOriginalVictory);
      setShowPortedVictory(false);
    } else {
      // Switch to ported
      setVictoryConditions(portedVictory);
      setShowPortedVictory(true);
    }
  }

  function setFactionSelection(faction, isShift = false) {
    if (isShift) {
      setSelectedFactions(prev => {
        const next = new Set(prev);
        if (next.has(faction)) { next.delete(faction); }
        else next.add(faction);
        // Recompute selected provinces as union of all selected factions
        const allKeys = [...next].flatMap(f => regionNamesToKeys(regionsForFaction(f)));
        setSelectedProvinces([...new Set(allKeys)]);
        return next;
      });
      setSelectedFaction(faction);
    } else {
      setSelectedFaction(faction);
      setSelectedFactions(new Set([faction]));
      setSelectedProvinces(regionNamesToKeys(regionsForFaction(faction)));
    }
  }

  function renderFactionSelector() {
    // Always use starting-order faction list for both modes
    const list = factions;
    return (
      <div style={{ padding: 0, margin: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 5,
            padding: "6px 8px 0 8px",
            gap: 8,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "inherit", letterSpacing: "0.3px", display: "inline-flex", alignItems: "baseline", gap: 6 }}>
            {isVictoryMode ? "Victory: choose faction" : "Factions"}
            {liveLogActive && (saveCurrentTurn != null || saveCurrentYear != null) && (
              <span
                key={`save-badge-${saveCurrentTurn}-${saveCurrentYear}`}
                className="save-badge-flash"
                title="Current turn / year from the loaded save"
                style={{
                  fontSize: "0.65rem", fontWeight: 600,
                  color: "#dca64a",
                  background: "rgba(220,166,74,0.12)",
                  padding: "1px 6px", borderRadius: 4,
                  fontFamily: "Consolas, monospace",
                }}
              >
                {saveCurrentTurn != null ? `T${saveCurrentTurn}` : ""}
                {saveCurrentTurn != null && saveCurrentYear != null ? " · " : ""}
                {saveCurrentYear != null ? `${Math.abs(saveCurrentYear)} ${saveCurrentYear < 0 ? "BC" : "AD"}` : ""}
              </span>
            )}
            {/* Faction-record + Lua-counter badges added 2026-05-09 — show
                live the new structures decoded by rtw-sav-parser. */}
            {liveLogActive && saveFactionRecords && saveFactionRecords.count > 0 && (
              <span
                title={`Faction record array: ${saveFactionRecords.count} records, ${(saveFactionRecords.arraySpan?.totalBytes / 1024).toFixed(0)} KB total. Grows ~90 B/turn/faction — the dominant bloat source. Magic ff 0a af f0.`}
                style={{
                  fontSize: "0.65rem", fontWeight: 600,
                  color: "#7aa2c7",
                  background: "rgba(122,162,199,0.12)",
                  padding: "1px 6px", borderRadius: 4,
                  fontFamily: "Consolas, monospace",
                }}
              >
                {saveFactionRecords.count}fr · {(saveFactionRecords.arraySpan?.totalBytes / 1024).toFixed(0)}KB
              </span>
            )}
            {liveLogActive && saveLuaCounters && saveLuaCounters.count > 0 && (
              <span
                title={
                  `Lua persistent counters: ${saveLuaCounters.count} entries.\n` +
                  Object.entries(saveLuaCounters.byName)
                    .slice(0, 12)
                    .map(([k, v]) => `${k} = ${v}`).join("\n") +
                  (saveLuaCounters.count > 12 ? `\n…and ${saveLuaCounters.count - 12} more` : "")
                }
                style={{
                  fontSize: "0.65rem", fontWeight: 600,
                  color: "#9ec77a",
                  background: "rgba(158,199,122,0.12)",
                  padding: "1px 6px", borderRadius: 4,
                  fontFamily: "Consolas, monospace",
                }}
              >
                {saveLuaCounters.count}lua
                {saveLuaCounters.byName?.turn_number != null && ` · tn=${saveLuaCounters.byName.turn_number | 0}`}
              </span>
            )}
            {/* Parser-stats badge — quick-glance health check. Hover to see
                all per-pass counts. Lights up red when any expected count
                is suspiciously low (e.g. 0 units in a populated save). */}
            {liveLogActive && saveUnitsByRegion && (() => {
              const unitTotal = Object.values(saveUnitsByRegion).reduce((s, arr) => s + arr.length, 0);
              const regionCount = Object.keys(saveUnitsByRegion).length;
              const charCount = Object.values(saveCharactersByRegion || {}).reduce((s, arr) => s + arr.length, 0);
              const armyCount = (saveLiveArmies || []).length;
              const ownerCount = currentOwnerByCity ? Object.keys(currentOwnerByCity).length : 0;
              let conquests = 0;
              if (currentOwnerByCity && initialOwnerByCity) {
                for (const [city, owner] of Object.entries(currentOwnerByCity)) {
                  if (initialOwnerByCity[city] && initialOwnerByCity[city] !== owner) conquests++;
                }
              }
              const tooltip =
                `Parser stats for the current save\n` +
                `\n` +
                `Units:      ${unitTotal} (across ${regionCount} regions)\n` +
                `Armies:     ${armyCount} (named + captain stacks on the map)\n` +
                `Characters: ${charCount} (parsed from v1 layout — RIS-imperial undercounts)\n` +
                `Settlements w/ owner: ${ownerCount}\n` +
                `Conquests:  ${conquests} (regions whose owner ≠ descr_strat starting owner)`;
              const looksWrong = unitTotal === 0 || regionCount === 0;
              return (
                <span
                  title={tooltip}
                  style={{
                    fontSize: "0.65rem", fontWeight: 600,
                    color: looksWrong ? "#e88" : "#c79e7a",
                    background: looksWrong ? "rgba(230,128,128,0.15)" : "rgba(199,158,122,0.12)",
                    padding: "1px 6px", borderRadius: 4,
                    fontFamily: "Consolas, monospace",
                    cursor: "help",
                  }}
                >
                  {unitTotal}u·{armyCount}a·{conquests}cq
                </span>
              );
            })()}
            {liveLogActive && saveLoadedAt && (() => {
              // "loaded Xm ago" — refreshes every 30s via setNowTick. Lets
              // users on long campaigns notice if the watcher's gone stale.
              const diff = Math.max(0, Date.now() - saveLoadedAt);
              const sec = Math.round(diff / 1000);
              let label;
              if (sec < 30) label = "just now";
              else if (sec < 90) label = "1m ago";
              else if (sec < 3600) label = `${Math.round(sec / 60)}m ago`;
              else if (sec < 7200) label = "1h ago";
              else label = `${Math.round(sec / 3600)}h ago`;
              const stale = sec > 600; // > 10 min — colour to amber-warn
              return (
                <span
                  title={`Last save snapshot: ${new Date(saveLoadedAt).toLocaleTimeString()}${stale ? " — watcher may be stale" : ""}`}
                  style={{
                    fontSize: "0.62rem", fontWeight: 400,
                    color: stale ? "#e89030" : "#888",
                    fontStyle: "italic",
                  }}
                >loaded {label}</span>
              );
            })()}
            {appVersion && appVersion !== "0.0.0" && (
              <span
                onClick={onCheckUpdates}
                title={updateDownloadPct != null ? `Downloading update… ${updateDownloadPct}%` : "Click to check for updates"}
                style={{
                  position: "relative",
                  fontSize: "0.65rem", fontWeight: 400, opacity: 0.55,
                  fontFamily: "Consolas, monospace", letterSpacing: 0,
                  cursor: "pointer", padding: "0 4px", borderRadius: 3,
                  transition: "opacity 0.15s, background 0.12s",
                  overflow: "hidden",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = 0.95; e.currentTarget.style.background = "rgba(220,166,74,0.18)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.55; e.currentTarget.style.background = ""; }}
              >
                {/* Progress strip — bottom underline that fills as the
                    update downloads. Goes away on completion. */}
                {updateDownloadPct != null && (
                  <span className="update-progress-strip" style={{
                    position: "absolute", left: 0, bottom: 0,
                    height: 2, width: `${updateDownloadPct}%`,
                    transition: "width 0.2s linear",
                    pointerEvents: "none",
                  }} />
                )}
                v{displayVersion}{isTestBuild ? "-test" : ""}
                {updateDownloadPct != null && (
                  <span style={{ marginLeft: 4, color: "#dca64a", fontWeight: 600 }}>
                    {updateDownloadPct}%
                  </span>
                )}
              </span>
            )}
          </span>
          <button
            style={{
              fontSize: "0.75rem",
              padding: "3px 10px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(0,0,0,0.2)",
              color: "inherit",
              cursor: selectedFactions.size > 0 ? "pointer" : "not-allowed",
              opacity: selectedFactions.size > 0 ? 1 : 0.5,
              fontWeight: 600,
              transition: "opacity 0.15s",
            }}
            onClick={() => {
              setSelectedFaction(null);
              setSelectedFactions(new Set());
              setSelectedProvinces([]);
            }}
            disabled={selectedFactions.size === 0}
          >
            Deselect
          </button>
        </div>
        <div style={{ padding: "0 8px 4px 8px" }}>
          <input
            type="text"
            placeholder="Search faction..."
            value={factionSearch}
            onChange={(e) => setFactionSearch(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box", padding: "3px 8px",
              borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(0,0,0,0.3)", color: "inherit", fontSize: "0.8rem",
              outline: "none",
            }}
          />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, ${ICON_SIZE}px)`,
            columnGap: Math.max(ICON_GAP, 6),
            rowGap: Math.max(ICON_GAP, 6),
            justifyContent: "center",
            padding: "4px 4px",
          }}
        >
          {list.filter(f => {
            // Search filter
            if (factionSearch && !f.toLowerCase().includes(factionSearch.toLowerCase())) return false;
            // Hide eliminated factions: in Live mode, drop factions
            // that hold zero regions per the live factionRegionsMap.
            // (The map is updated on every capture event so dead
            // factions disappear from the grid as soon as their last
            // city falls.) Slave/rebel default factions are special —
            // keep them visible since they're synthetic and
            // factionRegionsMap may not list their occupied tiles.
            if (liveLogActive && factionRegionsMap && factionRegionsMap[f]) {
              const regions = factionRegionsMap[f];
              if (Array.isArray(regions) && regions.length === 0 && !/(slave|rebel)/i.test(f)) {
                return false;
              }
            }
            return true;
          }).map((faction) => {
            const isSelected = selectedFactions.has(faction);
            return (
              <Tooltip label={(factionDisplayNames && factionDisplayNames[faction]) || faction.replace(/_/g, " ")} key={faction}>
                <div
                  className="faction-tile"
                  style={{
                    ...tileBaseStyle,
                    boxShadow: isSelected
                      ? "0 0 0 2px #dca64a, 0 0 8px rgba(220,166,74,0.4)"
                      : "0 1px 4px rgba(0,0,0,0.3)",
                    transform: isSelected ? "scale(1.04)" : "scale(1)",
                    transition: "box-shadow 0.15s, transform 0.15s",
                  }}
                  onClick={(e) => setFactionSelection(faction, e.shiftKey)}
                  onContextMenu={(e) => {
                    // Right-click → show the same faction card the
                    // homeland-row icons open. One overlay handles both.
                    e.preventDefault();
                    setInfoPopup({
                      type: "faction",
                      factionId: faction,
                      name: faction,
                      label: (factionDisplayNames && factionDisplayNames[faction]) || faction.replace(/_/g, " "),
                      modIconsDir,
                    });
                  }}
                  onDoubleClick={() => {
                    // Zoom to fit all territory of this faction
                    const keys = regionNamesToKeys(regionsForFaction(faction));
                    const pts = keys.map(k => regionCentroids[k]).filter(Boolean);
                    if (pts.length === 0) return;
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
                    const pad = 20; // padding in image pixels
                    const bw = (maxX - minX) + pad * 2;
                    const bh = (maxY - minY) + pad * 2;
                    // Base scale (zoom=1): fit image to canvas
                    const baseScale = Math.max(canvasSize.width / imgSize.width, canvasSize.height / imgSize.height);
                    const zx = canvasSize.width / (bw * baseScale);
                    const zy = canvasSize.height / (bh * baseScale);
                    const fitZoom = Math.max(1, Math.min(maxZoom, Math.min(zx, zy)));
                    const ts = baseScale * fitZoom;
                    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
                    const imgW = imgSize.width * ts, imgH = imgSize.height * ts;
                    const bxOff = (canvasSize.width - imgW) / 2;
                    const byOff = (canvasSize.height - imgH) / 2;
                    // Compute and clamp offset using the NEW zoom (not stale state)
                    let ox = canvasSize.width / 2 - cx * ts - bxOff;
                    let oy = canvasSize.height / 2 - cy * ts - byOff;
                    if (imgW > canvasSize.width) { ox = Math.max(canvasSize.width - imgW - bxOff, Math.min(-bxOff, ox)); } else { ox = 0; }
                    if (imgH > canvasSize.height) { oy = Math.max(canvasSize.height - imgH - byOff, Math.min(-byOff, oy)); } else { oy = 0; }
                    setZoom(fitZoom);
                    setOffset({ x: ox, y: oy });
                  }}
                >
                  <div style={{ width: "100%", height: "100%", display: "block", filter: ICON_DROP_SHADOW }}>
                    <FactionIcon iconPath={`faction_icons/${faction}.tga`} alt={faction} size={ICON_SIZE} tightCrop modIconsDir={modIconsDir} />
                  </div>
                </div>
              </Tooltip>
            );
          })}
        </div>
      </div>
    );
  }

  // Drag-and-drop reorder (grab to move)
  const dragIndexRef = useRef(null);
  function onDragStart(idx, e) {
    dragIndexRef.current = idx;
    e.dataTransfer.effectAllowed = "move";
  }
  function onDragOver(idx, e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }
  function onDrop(idx, e) {
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from == null) return;
    setSelectedProvinces((prev) => moveAtIndex(prev, from, idx));
    dragIndexRef.current = null;
  }
  function onDragEnd() {
    dragIndexRef.current = null;
  }

  function renderSelectedProvincesList() {
    const items = selectedProvinces.map((rgbKey) => {
      const region = regions[rgbKey];
      let regionName = region?.region || region?.name || region?.label || "";
      let cityName = region?.city || "";
      let displayName = regionName && cityName ? `${cityName} (${regionName})` : cityName || regionName || rgbKey;
      return { rgbKey, displayName };
    });

    const victoryMeta = selectedFaction && isVictoryMode ? victoryConditions[selectedFaction] : null;

    return (
      <div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <button
            style={{ fontSize: "0.85rem", padding: "2px 8px", borderRadius: 7, border: "1px solid #bbb",
              cursor: selectedProvinces.length ? "pointer" : "not-allowed",
              opacity: selectedProvinces.length ? 1 : 0.7, fontWeight: 500 }}
            onClick={() => { setSelectedProvinces([]); setSelectedFaction(null); }}
            disabled={selectedProvinces.length === 0}
          >Deselect All</button>
        </div>

        {victoryMeta && (
          <div style={{ marginBottom: 8, fontSize: "0.95rem" }}>
            Goal: hold {victoryMeta.hold_regions?.length || 0} regions, conquer at least{" "}
            {victoryMeta.take_regions ?? "?"} total.
          </div>
        )}

        {items.length ? (
          <ul style={{ margin: 0, paddingLeft: 0, fontSize: "0.95rem", listStyle: "none" }}>
            {items.map(({ rgbKey, displayName }, idx) => (
              <li
                key={rgbKey}
                draggable
                onDragStart={(e) => onDragStart(idx, e)}
                onDragOver={(e) => onDragOver(idx, e)}
                onDrop={(e) => onDrop(idx, e)}
                onDragEnd={onDragEnd}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 4,
                  padding: "4px 6px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.05)",
                  cursor: devDragResource ? "grabbing" : "grab",
                }}
              >
                <span style={{ minWidth: 32, color: "#aaa", fontVariantNumeric: "tabular-nums" }}>{idx + 1}.</span>
                <span style={{ flex: 1 }}>{displayName}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ color: "#bbb", fontStyle: "italic", marginLeft: 1, fontSize: "0.95rem" }}>(None selected)</div>
        )}
      </div>
    );
  }

  // Search: pan to and select a province
  function handleSearchSelect(result) {
    setSearchQuery("");
    setSearchResults([]);
    setSelectedProvinces((prev) => prev.includes(result.key) ? prev : [...prev, result.key]);
    const pos = regionCentroids[result.key];
    if (pos) {
      const { scale } = computeTransform();
      const ts = scale * zoom;
      const bx = (canvasSize.width - imgSize.width * ts) / 2;
      const by = (canvasSize.height - imgSize.height * ts) / 2;
      setOffset(clampOffset({ x: canvasSize.width / 2 - pos.x * ts - bx, y: canvasSize.height / 2 - pos.y * ts - by }));
    }
  }

  function renderSearch() {
    const q = searchQuery.trim().toLowerCase();
    const allMatches = q.length > 0
      ? Object.entries(regions)
          .filter(([, v]) => v.region?.toLowerCase().includes(q) || v.city?.toLowerCase().includes(q))
      : [];
    const results = allMatches
      .slice(0, 8)
      .map(([key, v]) => ({ key, label: v.region && v.city ? `${v.region} (${v.city})` : v.region || v.city || key }));
    const overflow = Math.max(0, allMatches.length - results.length);

    // Highlight the matched substring inside a result label. Splits on the
    // case-insensitive query and wraps the hits in <mark> with an amber tint.
    const highlight = (label) => {
      if (!q) return label;
      const lower = label.toLowerCase();
      const parts = [];
      let last = 0;
      for (let i = 0; i < label.length; ) {
        const found = lower.indexOf(q, i);
        if (found === -1) break;
        if (found > last) parts.push({ text: label.slice(last, found), hit: false });
        parts.push({ text: label.slice(found, found + q.length), hit: true });
        last = found + q.length;
        i = last;
      }
      if (last < label.length) parts.push({ text: label.slice(last), hit: false });
      if (parts.length === 0) return label;
      return parts.map((p, i) => p.hit
        ? <mark key={i} style={{ background: "rgba(220,166,74,0.4)", color: "#fff", padding: 0, borderRadius: 2 }}>{p.text}</mark>
        : <span key={i}>{p.text}</span>);
    };

    // The right-column container has overflow:hidden, which was clipping
    // the dropdown when it overflowed downward — making it appear "behind"
    // the Recent panel and showing a system scrollbar as the column tried
    // to grow. Portal the dropdown onto document.body with fixed positioning
    // computed from the input rect so it floats above everything.
    const inputEl = searchInputRef.current;
    const rect = inputEl ? inputEl.getBoundingClientRect() : null;
    const dropdown = (results.length > 0 && rect) ? (
      <div className="popover-pop-in" style={{
        position: "fixed",
        top: rect.bottom + 2,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
        background: "rgba(30,30,30,0.97)",
        borderRadius: 7,
        border: "1px solid #666",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        overflow: "hidden",
      }}>
        {results.map((r) => (
          <div key={r.key}
            onClick={() => handleSearchSelect(r)}
            style={{ padding: "6px 10px", cursor: "pointer", fontSize: "0.88rem", color: "#eee",
              borderBottom: "1px solid #3335" }}
            onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            {highlight(r.label)}
          </div>
        ))}
        {overflow > 0 && (
          <div style={{
            padding: "5px 10px", fontSize: "0.78rem",
            color: "#aaa", fontStyle: "italic",
            background: "rgba(0,0,0,0.25)",
          }}>
            +{overflow} more — refine search
          </div>
        )}
      </div>
    ) : null;
    return (
      <div style={{ position: "relative" }}>
        <input
          type="text"
          ref={searchInputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="legend-search-input"
          placeholder="Search province or settlement... (Ctrl+F)"
          style={{
            width: "100%", boxSizing: "border-box", padding: "6px 12px",
            borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)",
            color: "#f0f0f0", fontSize: "0.88rem", outline: "none",
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}
        />
        {dropdown && createPortal(dropdown, document.body)}
      </div>
    );
  }

  function renderFactionSummary() {
    const provinces = selectedProvinces.map((k) => regions[k]).filter(Boolean);
    const buildingCounts = {};
    for (const prov of provinces) {
      for (const fd of buildingsData) {
        const sett = (fd.settlements || []).find((s) =>
          s.region?.toLowerCase() === prov.region?.toLowerCase()
        );
        if (sett) {
          for (const b of sett.buildings || []) {
            buildingCounts[b.type] = (buildingCounts[b.type] || 0) + 1;
          }
        }
      }
    }
    const sorted = Object.entries(buildingCounts).sort((a, b) => b[1] - a[1]);

    // Population & resource stats
    const SKIP = new Set([]);
    let totalPop = 0;
    const resourceCounts = {}; // type → location count
    let totalResourceAmount = 0;
    for (const prov of provinces) {
      const pop = populationData[prov.region] || populationData[prov.region?.split("-")[0]] || populationData[prov.city] || 0;
      totalPop += pop;
      const entries = resourcesData[prov.region] || resourcesData[prov.city] || [];
      for (const r of entries) {
        if (SKIP.has(r.type)) continue;
        resourceCounts[r.type] = (resourceCounts[r.type] || 0) + 1;
        totalResourceAmount += r.amount || 1;
      }
    }
    const topResources = Object.entries(resourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const totalResourceTypes = Object.keys(resourceCounts).length;

    const statRow = (label, value) => (
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ color: "#ccc" }}>{label}</span>
        <span style={{ color: "#f0f0f0", fontWeight: 600 }}>{value}</span>
      </div>
    );

    return (
      <div style={{ fontSize: "0.9rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          {selectedFaction && (
            <div style={{ width: 40, height: 40, flexShrink: 0, filter: ICON_DROP_SHADOW }}>
              <FactionIcon iconPath={`faction_icons/${selectedFaction}.tga`} alt={selectedFaction} size={40} tightCrop modIconsDir={modIconsDir} />
            </div>
          )}
          <div>
            <div style={{ fontWeight: 700 }}>
              {selectedFaction ? selectedFaction.replace(/_/g, " ") : "Selection"}
            </div>
            <div style={{ color: "#bbb", fontSize: "0.85rem" }}>{provinces.length} province{provinces.length !== 1 ? "s" : ""}</div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ marginBottom: 10, padding: "6px 8px", borderRadius: 6, background: "rgba(255,255,255,0.05)" }}>
          {totalPop > 0 && statRow("Total population:", totalPop.toLocaleString())}
          {statRow("Resource types:", totalResourceTypes)}
          {totalResourceAmount > 0 && statRow("Total resource amount:", totalResourceAmount)}
          {topResources.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ color: "#ccc", marginBottom: 3 }}>Top resources:</div>
              {topResources.map(([type, count]) => (
                <div key={type} style={{ display: "flex", justifyContent: "space-between", paddingLeft: 8 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    {resourceImages[type] && (
                      <img src={resourceImages[type].src} alt={type} style={{ width: 14, height: 14, objectFit: "contain" }} />
                    )}
                    {type.replace(/_/g, " ")}
                  </span>
                  <span style={{ color: "#aaa" }}>{count} loc.</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {sorted.length > 0 ? (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4, color: "#ccc" }}>Buildings:</div>
            {sorted.map(([type, count]) => (
              <div key={type} style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                <span>{type.replace(/_/g, " ")}</span>
                <span style={{ color: "#aaa", minWidth: 24, textAlign: "right" }}>{count}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: "#bbb", fontStyle: "italic" }}>No building data for this selection.</div>
        )}
      </div>
    );
  }

  const overlayBase = {
    position: "fixed",
    zIndex: 9999,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100vw",
    height: "100vh",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  };

  function zoomIn() {
    setZoom((z) => Math.min(maxZoom, Number((z * 1.2).toFixed(2))));
  }
  function zoomOut() {
    setZoom((z) => Math.max(minZoom, Number((z / 1.2).toFixed(2))));
  }
  function resetZoom() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  function zoomToProvinces(rgbKeys) {
    const pts = rgbKeys.map(k => regionCentroids[k]).filter(Boolean);
    if (pts.length === 0) return;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const padX = Math.max(100, (maxX - minX) * 0.35);
    const padY = Math.max(100, (maxY - minY) * 0.35);
    const bx = minX - padX, by = minY - padY;
    const bw = maxX - minX + padX * 2, bh = maxY - minY + padY * 2;
    // base scale (zoom=1) maps imgSize → canvasSize
    const baseScale = Math.max(canvasSize.width / imgSize.width, canvasSize.height / imgSize.height);
    const targetZoom = Math.min(maxZoom, Math.min(canvasSize.width / (bw * baseScale), canvasSize.height / (bh * baseScale)));
    const newZoom = Math.max(minZoom, targetZoom);
    const totalScale = baseScale * newZoom;
    const baseOffX = (canvasSize.width  - imgSize.width  * totalScale) / 2;
    const baseOffY = (canvasSize.height - imgSize.height * totalScale) / 2;
    const cx = (bx + bw / 2) * totalScale + baseOffX;
    const cy = (by + bh / 2) * totalScale + baseOffY;
    const newOffset = {
      x: canvasSize.width  / 2 - cx,
      y: canvasSize.height / 2 - cy,
    };
    setZoom(newZoom);
    setOffset(newOffset);
  }

  function pinRegion(info) {
    const key = info.rgb;
    const label = info.region || info.city || key;
    setPinnedRegions(prev =>
      prev.find(p => p.key === key)
        ? prev.filter(p => p.key !== key)
        : [...prev, { key, label }]
    );
  }

  function jumpToPin(pin) {
    const centroid = regionCentroids[pin.key];
    setSelectedProvinces([pin.key]);
    setLockedRegionInfo(regions[pin.key] ? { ...regions[pin.key], rgb: pin.key } : null);
    if (centroid) {
      const { scale } = computeTransform();
      const ts = scale * zoom;
      const bx = (canvasSize.width - imgSize.width * ts) / 2;
      const by = (canvasSize.height - imgSize.height * ts) / 2;
      setOffset(clampOffset({ x: canvasSize.width / 2 - centroid.x * ts - bx, y: canvasSize.height / 2 - centroid.y * ts - by }));
    }
  }

  function handleScreenshot() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `map-${colorMode}-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function renderMapModeToggle() {
    const pillStyle = {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "4px 6px",
      borderRadius: 10,
      background: "rgba(0,0,0,0.5)",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
      color: "#f6f6f6",
      fontSize: "0.82rem",
      lineHeight: 1,
      boxShadow: "0 2px 12px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.08)",
      pointerEvents: "auto",
    };
    const btnStyle = (active) => ({
      padding: "3px 8px",
      borderRadius: 7,
      border: active ? "1px solid rgba(220,166,74,0.6)" : "1px solid rgba(255,255,255,0.15)",
      background: active
        ? "linear-gradient(180deg, #dca64a 0%, #c48e30 100%)"
        : "linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 100%)",
      color: active ? "#1a1400" : "#e8e8e8",
      fontWeight: 600,
      fontSize: "0.76rem",
      cursor: active ? "default" : "pointer",
      textShadow: active ? "none" : "0 1px 2px rgba(0,0,0,0.3)",
      boxShadow: active ? "0 2px 0 #b8842a, 0 1px 6px rgba(220,166,74,0.3)" : "0 1px 3px rgba(0,0,0,0.2)",
    });

    const campaigns = Object.values(CAMPAIGNS);
    const isImperial = mapCampaign === "imperial";

    const colorModes = [
      { key: "faction", label: "Faction" },
      { key: "victory", label: "Victory" },
      { key: "culture", label: "Culture" },
      { key: "religion", label: "Religion" },
      { key: "population", label: "Population" },
      { key: "farm", label: "Fertility" },
      { key: "resource", label: "Resources" },
      { key: "homeland", label: "Homeland" },
      { key: "government", label: "Government" },
    ];
    const devColorModes = [
      { key: "terrain", label: "Terrain" },
      { key: "climate", label: "Climate" },
      { key: "port_level", label: "Port Level" },
      { key: "irrigation", label: "Irrigation" },
      { key: "earthquakes", label: "Earthquakes" },
      { key: "rivertrade", label: "River Trade" },
      { key: "hidden_resource", label: "Hidden Res." },
      { key: "pop_growth", label: "Pop Headroom" },
      { key: "wealth", label: "Wealth" },
      { key: "recruitment", label: "Recruitment" },
    ];

    return (
      <div ref={topBarRef} style={{ position: "absolute", top: 8, left: 8, zIndex: welcomeHighlight === "map-modes" || welcomeHighlight === "view-options" || welcomeHighlight === "campaigns" ? 10001 : 5, display: "flex", flexDirection: "column", gap: 4, pointerEvents: "none" }}>
        {/* Map mode buttons — dev modes added when dev is active */}
        <div data-ui-highlight="map-modes" className={welcomeHighlight === "map-modes" ? "ws-ui-glow" : ""} style={{ ...pillStyle, flexWrap: "wrap", gap: 3, padding: "3px 5px", maxWidth: Math.max(200, canvasSize.width - 280) }}>
          {colorModes.map((m) => (
            <button key={m.key} onClick={() => setColorMode(m.key)}
              className={"map-mode-btn" + (colorMode === m.key ? " map-mode-btn--active" : "")}
              disabled={colorMode === m.key} style={btnStyle(colorMode === m.key)}>{m.label}</button>
          ))}
          {devMode && (<>
            <span style={{ color: "#e8a030", opacity: 0.5, fontSize: "0.7rem" }}>|</span>
            {devColorModes.map((m) => (
              <button key={m.key} onClick={() => setColorMode(m.key)}
                className={"map-mode-btn" + (colorMode === m.key ? " map-mode-btn--active" : "")}
                disabled={colorMode === m.key} style={btnStyle(colorMode === m.key)}>{m.label}</button>
            ))}
          </>)}
        </div>
        {/* Bottom-right stack: mute at top, optional dev-controls in middle,
            Dev button always anchored at the bottom. Portalled to document.body
            so parent stacking contexts (topBarRef) can't clamp its z-index
            below the welcome overlay. */}
        {createPortal(
        <div style={{ position: "fixed", bottom: 12, right: 12, zIndex: 10003, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, pointerEvents: "auto" }}>
          <MuteButton
            muted={audioMuted}
            onToggle={toggleAudioMuted}
            buttonStyle={btnStyle(false)}
          />
          {devMode && (<>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 8px", borderRadius: 10,
              background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
            }}>
              <button
                className="dev-btn"
                onClick={() => { setShowFileImport(true); setFileImportDone(false); }}
                style={{
                  ...btnStyle(false),
                  background: "rgba(60,60,60,0.7)",
                  color: "#e8a030",
                  border: "1px solid #e8a030",
                  minWidth: 80,
                }}
              >Import</button>
              <button
                onClick={() => {
                  const download = (name, content) => {
                    const blob = new Blob([content], { type: "text/plain" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = name;
                    a.click();
                    URL.revokeObjectURL(a.href);
                    // Backup to Electron userData if available
                    if (window.electronAPI?.saveUserFile) {
                      window.electronAPI.saveUserFile("exports/" + name, content);
                    }
                  };
                  const dirty = devDirtyFiles;

                  // ── Export Validation ──
                  const warnings = [];
                  // Check for regions with no faction
                  const noFaction = Object.values(regions).filter(r => !r.faction || r.faction === "none" || r.faction.trim() === "");
                  if (noFaction.length > 0) warnings.push(`${noFaction.length} region(s) have no faction assigned`);
                  // Check for regions with no culture
                  const noCulture = Object.values(regions).filter(r => !r.culture || r.culture.trim() === "");
                  if (noCulture.length > 0) warnings.push(`${noCulture.length} region(s) have no culture`);
                  // Check for duplicate resource entries in same region
                  let dupeCount = 0;
                  for (const [, entries] of Object.entries(resourcesData)) {
                    if (!Array.isArray(entries)) continue;
                    const seen = new Set();
                    for (const r of entries) {
                      const key = `${r.type}@${r.x},${r.y}`;
                      if (seen.has(key)) dupeCount++;
                      seen.add(key);
                    }
                  }
                  if (dupeCount > 0) warnings.push(`${dupeCount} duplicate resource entries found`);
                  // Check for orphaned resources (resource in region that doesn't exist)
                  const regionNames = new Set(Object.values(regions).flatMap(r => [r.region, r.city].filter(Boolean)));
                  const orphanedRes = Object.keys(resourcesData).filter(k => !regionNames.has(k));
                  if (orphanedRes.length > 0) warnings.push(`${orphanedRes.length} resource entries reference unknown regions`);
                  // Regions with no recruit options at all (likely unintentional —
                  // every starting settlement should at least be able to train
                  // peasants or local levies). We use the same recruitment
                  // filter as the bottom panel; flag any region that has 0
                  // recruitable units AND owns at least 1 building.
                  if (buildingRecruits && unitOwnership) {
                    let zeroRecruit = 0;
                    for (const r of Object.values(regions)) {
                      const ownerId = r.faction;
                      if (!ownerId || ownerId === "slave") continue;
                      let built = null;
                      for (const fd of buildingsData) {
                        const sett = (fd.settlements || []).find(s => s.region?.toLowerCase() === r.region?.toLowerCase());
                        if (sett) { built = sett.buildings || []; break; }
                      }
                      if (!built || built.length === 0) continue;
                      const culture = factionCultures?.[ownerId] || null;
                      const tagSet = new Set(String(r.tags || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
                      let hasAny = false;
                      for (const b of built) {
                        const lvls = buildingRecruits[b.type];
                        if (!lvls) continue;
                        for (const lvl of Object.keys(lvls)) {
                          for (const rec of lvls[lvl]) {
                            if (rec.factions && rec.factions.length > 0 && ownerId
                                && !rec.factions.includes("all") && !rec.factions.includes(ownerId) && !rec.factions.includes(culture)) continue;
                            const owners = unitOwnership[rec.unit];
                            if (!owners) continue;
                            if (ownerId && !owners.includes("all") && !owners.includes(ownerId) && !owners.includes(culture)) continue;
                            hasAny = true;
                            break;
                          }
                          if (hasAny) break;
                        }
                        if (hasAny) break;
                      }
                      if (!hasAny) zeroRecruit++;
                    }
                    if (zeroRecruit > 0) warnings.push(`${zeroRecruit} owned region(s) have ZERO recruitable units — likely missing faction/culture in EDU ownership lines`);
                  }
                  // Hidden_resources referenced in EDB but never present on any region
                  // (and vice versa). The first half is the more useful warning —
                  // it usually means a typo or removed-but-not-cleaned-up tag.
                  if (buildingRecruits) {
                    const usedHRs = new Set();
                    for (const lvls of Object.values(buildingRecruits)) {
                      if (!lvls || typeof lvls !== "object") continue;
                      for (const recList of Object.values(lvls)) {
                        for (const rec of (recList || [])) {
                          if (!rec.requires) continue;
                          for (const m of rec.requires.matchAll(/\bhidden_resource\s+(\S+)/g)) usedHRs.add(m[1].toLowerCase());
                        }
                      }
                    }
                    const presentHRs = new Set();
                    for (const r of Object.values(regions)) {
                      for (const t of String(r.tags || "").split(/,\s*/)) presentHRs.add(t.trim().toLowerCase());
                    }
                    const missingFromMap = [...usedHRs].filter(hr => hr && !presentHRs.has(hr));
                    if (missingFromMap.length > 0) {
                      warnings.push(`${missingFromMap.length} hidden_resource(s) referenced in EDB but never present on any region (e.g. ${missingFromMap.slice(0, 3).join(", ")})`);
                    }
                  }

                  if (warnings.length > 0) {
                    const proceed = window.confirm(
                      "Export Validation Warnings:\n\n" +
                      warnings.map((w, i) => `${i + 1}. ${w}`).join("\n") +
                      "\n\nExport anyway?"
                    );
                    if (!proceed) return;
                  }

                  // descr_regions.txt — region tags, faction, culture, etc.
                  if (dirty.has("descr_regions.txt")) {
                    const regLines = [];
                    for (const [rgbKey, r] of Object.entries(regions)) {
                      const rgb = rgbKey.split(",").join(" ");
                      regLines.push(r.region, r.city, r.faction, r.culture, rgb, r.tags, r.farm_level, r.pop_level, r.ethnicities);
                    }
                    download("descr_regions.txt", regLines.join("\n") + "\n");
                  }
                  // descr_strat.txt — resources, population and/or ownership changes
                  const stratNeeded = dirty.has("resources") || dirty.has("population") || dirty.has("descr_strat.txt");
                  if (stratNeeded && devOrigStratRef.current) {
                    download("descr_strat.txt", patchDescrStrat(devOrigStratRef.current, resourcesData, populationData, dirty, imgSize.height, factionOwnerChanges));
                  } else if (stratNeeded && !devOrigStratRef.current) {
                    alert("Cannot export descr_strat.txt — no original file loaded. Import the campaign folder first via the Import button.");
                  }
                  // descr_win_conditions.txt
                  if (dirty.has("descr_win_conditions.txt")) {
                    const vcLines = [];
                    for (const [faction, vc] of Object.entries(victoryConditions)) {
                      vcLines.push(faction);
                      if (vc.hold_regions?.length) vcLines.push("hold_regions " + vc.hold_regions.join(", "));
                      if (vc.take_regions != null) vcLines.push("take_regions " + vc.take_regions);
                      vcLines.push("");
                    }
                    download("descr_win_conditions.txt", vcLines.join("\n"));
                  }
                  if (dirty.size === 0) {
                    alert("No changes to export.");
                  } else {
                    const regionsEdited = dirty.has("descr_regions.txt");
                    setDevDirtyFiles(new Set());
                    setFactionOwnerChanges({});
                    setExportConfirm(true);
                    setTimeout(() => setExportConfirm(false), 3000);
                    if (regionsEdited) {
                      alert(
                        "descr_regions.txt was edited — you must regenerate map.rwm before launching the campaign.\n\n" +
                        "Delete map.rwm from the campaign folder (e.g. data/world/maps/campaign/imperial_campaign/map.rwm). " +
                        "RTW will rebuild it from descr_regions.txt + map_regions.tga the next time the campaign loads. " +
                        "Without this, your tag/faction/culture/HR edits won't appear in-game."
                      );
                    }
                  }
                }}
                style={{
                  ...btnStyle(false),
                  background: devDirtyFiles.size > 0 ? "#4a9" : "rgba(60,60,60,0.7)",
                  color: devDirtyFiles.size > 0 ? "#fff" : "#aaa",
                  border: "1px solid " + (devDirtyFiles.size > 0 ? "#4a9" : "#555"),
                  minWidth: 60,
                }}
              >Export{devDirtyFiles.size > 0 ? ` (${devDirtyFiles.size} file${devDirtyFiles.size > 1 ? "s" : ""})` : ""}</button>
              {exportConfirm && <span style={{ color: "#7c4", fontSize: "0.78rem", fontWeight: 600 }}>Exported!</span>}
              {(undoStackRef.current.length > 0 || redoStackRef.current.length > 0) && (
                <span style={{ color: "#aaa", fontSize: "0.72rem" }} title="Ctrl+Z undo / Ctrl+Shift+Z redo">
                  {undoStackRef.current.length > 0 && `Undo: ${undoStackRef.current.length}`}
                  {undoStackRef.current.length > 0 && redoStackRef.current.length > 0 && " · "}
                  {redoStackRef.current.length > 0 && `Redo: ${redoStackRef.current.length}`}
                </span>
              )}
              <button
                onClick={() => setShowShortcuts(p => !p)}
                title="Keyboard shortcuts"
                style={{
                  ...btnStyle(false),
                  background: "rgba(60,60,60,0.7)",
                  color: "#aaa",
                  border: "1px solid #555",
                  minWidth: 0, padding: "3px 7px", fontSize: "0.72rem", fontWeight: 700,
                }}
              >?</button>
              <button
                onClick={() => { saveAutosaveSnapshot(); }}
                title="Save snapshot now"
                style={{
                  ...btnStyle(false),
                  background: "rgba(60,60,60,0.7)",
                  color: "#8bf",
                  border: "1px solid #68a",
                  minWidth: 0, padding: "3px 8px", fontSize: "0.72rem",
                }}
              >Save</button>
              <div ref={loadMenuRef} style={{ position: "relative" }}>
                <button
                  onClick={() => setShowLoadMenu(p => !p)}
                  title="Load a saved snapshot"
                  style={{
                    ...btnStyle(showLoadMenu),
                    background: showLoadMenu ? "#68a" : "rgba(60,60,60,0.7)",
                    color: showLoadMenu ? "#fff" : "#8bf",
                    border: "1px solid #68a",
                    minWidth: 0, padding: "3px 8px", fontSize: "0.72rem",
                  }}
                >Load{autosaves.length > 0 ? ` (${autosaves.length})` : ""}</button>
                {showLoadMenu && (
                  <div style={{
                    position: "absolute", bottom: "100%", right: 0, marginBottom: 4,
                    background: "rgba(20,25,35,0.95)", backdropFilter: "blur(10px)",
                    border: "1px solid #68a", borderRadius: 8,
                    padding: "6px 0", minWidth: 240, maxHeight: 300, overflowY: "auto",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.5)", zIndex: 20,
                  }}>
                    {autosaves.length === 0 ? (
                      <div style={{ padding: "8px 12px", color: "#888", fontSize: "0.72rem" }}>No saves yet</div>
                    ) : (
                      [...autosaves].reverse().map((snap, ri) => {
                        const idx = autosaves.length - 1 - ri;
                        const d = new Date(snap.ts);
                        const isActive = timelineIndex === idx;
                        // Compute diff vs previous save
                        let diffText = "";
                        if (idx > 0) {
                          const prev = autosaves[idx - 1];
                          let regionChanges = 0, resourceChanges = 0;
                          if (prev.regions && snap.regions) {
                            for (const k of Object.keys(snap.regions)) {
                              const a = prev.regions[k], b = snap.regions[k];
                              if (!a || a.faction !== b.faction || a.culture !== b.culture) regionChanges++;
                            }
                          }
                          const prevRes = prev.resourcesData || {}, curRes = snap.resourcesData || {};
                          const allResKeys = new Set([...Object.keys(prevRes), ...Object.keys(curRes)]);
                          for (const k of allResKeys) {
                            if (JSON.stringify(prevRes[k]) !== JSON.stringify(curRes[k])) resourceChanges++;
                          }
                          const parts = [];
                          if (regionChanges) parts.push(`${regionChanges} region(s) changed`);
                          if (resourceChanges) parts.push(`${resourceChanges} resource region(s) changed`);
                          diffText = parts.length ? parts.join(", ") : "no changes from previous";
                        } else {
                          diffText = "initial save";
                        }
                        return (
                          <button key={snap.ts} title={diffText} onClick={() => {
                            restoreAutosave(idx);
                            setShowLoadMenu(false);
                          }} style={{
                            display: "block", width: "100%", textAlign: "left",
                            padding: "5px 12px", border: "none", cursor: "pointer",
                            background: isActive ? "rgba(104,170,220,0.25)" : "transparent",
                            color: isActive ? "#8bf" : "#ccd",
                            fontSize: "0.72rem",
                          }}
                          onMouseEnter={e => e.target.style.background = "rgba(104,170,220,0.15)"}
                          onMouseLeave={e => e.target.style.background = isActive ? "rgba(104,170,220,0.25)" : "transparent"}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            const name = window.prompt("Name this save:", snap.name || "");
                            if (name !== null) {
                              setAutosaves(prev => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], name: name || undefined };
                                try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(next)); } catch {}
                                return next;
                              });
                            }
                          }}
                          >
                            <span style={{ fontWeight: 600 }}>#{idx + 1}</span>
                            {snap.checkpoint && <span style={{ color: "#6a8", fontSize: "0.6rem", marginLeft: 4 }}>checkpoint</span>}
                            {snap.name && <span style={{ color: "#da6", fontSize: "0.65rem", marginLeft: 4 }}>{snap.name}</span>}
                            {" — "}
                            <span>{d.toLocaleDateString()} {d.toLocaleTimeString()}</span>
                          </button>
                        );
                      })
                    )}
                    {autosaves.length > 0 && (<>
                      <div style={{ borderTop: "1px solid #444", margin: "4px 0" }} />
                      <button onClick={() => {
                        if (window.confirm("Clear all autosave history?")) {
                          setAutosaves([]);
                          setTimelineIndex(null);
                          timelineStashRef.current = null;
                          try { localStorage.removeItem(AUTOSAVE_KEY); } catch {}
                          setShowLoadMenu(false);
                        }
                      }} style={{
                        display: "block", width: "100%", textAlign: "left",
                        padding: "5px 12px", border: "none", cursor: "pointer",
                        background: "transparent", color: "#c88", fontSize: "0.72rem",
                      }}
                      onMouseEnter={e => e.target.style.background = "rgba(100,40,40,0.3)"}
                      onMouseLeave={e => e.target.style.background = "transparent"}
                      >Clear All Saves</button>
                    </>)}
                  </div>
                )}
              </div>
              {autosaves.length > 0 && (<>
                <span style={{ color: "#68a", fontSize: "0.65rem", opacity: 0.5 }}>|</span>
                <span style={{ color: "#888", fontSize: "0.65rem", flexShrink: 0 }}>1</span>
                <input
                  type="range"
                  min={0}
                  max={autosaves.length}
                  value={timelineIndex !== null ? timelineIndex : autosaves.length}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (v >= autosaves.length) {
                      returnToLive();
                    } else {
                      restoreAutosave(v);
                    }
                  }}
                  title={timelineIndex !== null
                    ? `Viewing #${timelineIndex + 1} — ${new Date(autosaves[timelineIndex].ts).toLocaleTimeString()}`
                    : "Live (latest)"}
                  style={{ width: 120, accentColor: "#68a", cursor: "pointer" }}
                />
                <span style={{ color: "#888", fontSize: "0.65rem", flexShrink: 0 }}>
                  {timelineIndex !== null
                    ? new Date(autosaves[timelineIndex].ts).toLocaleTimeString()
                    : "Live"}
                </span>
              </>)}
            </div>
          </>)}
          <button
            className="dev-btn"
            onClick={() => setDevMode(prev => {
              const next = !prev;
              if (!next) setColorMode(cm => DEV_COLOR_MODES.has(cm) ? "faction" : cm);
              return next;
            })}
            style={{
              ...btnStyle(devMode),
              background: devMode ? "#e8a030" : "rgba(60,60,60,0.7)",
              color: devMode ? "#221" : "#aaa",
              border: "1px solid " + (devMode ? "#e8a030" : "#555"),
              minWidth: 40,
            }}
          >Dev</button>
        </div>,
        document.body
        )}
        {/* Keyboard shortcuts overlay */}
        {showShortcuts && (
          <div style={{
            position: "fixed", bottom: 52, right: 12, zIndex: 10,
            background: "rgba(20,25,35,0.95)", backdropFilter: "blur(10px)",
            border: "1px solid #555", borderRadius: 10,
            padding: "12px 16px", minWidth: 260,
            color: "#dde", fontSize: "0.75rem",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            pointerEvents: "auto",
          }}>
            <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 8, color: "#e8a030" }}>Keyboard Shortcuts</div>
            {[
              ["Ctrl+Shift+D", "Toggle dev mode"],
              ["Ctrl+Z", "Undo"],
              ["Ctrl+Shift+Z / Ctrl+Y", "Redo"],
              ["Escape", "Deselect all"],
              ["Arrow keys", "Pan map"],
              ["Scroll wheel", "Zoom in/out"],
              ["Double-click map", "Zoom in"],
              ["Shift+click faction", "Multi-select factions"],
              ["Double-click faction", "Zoom to territory"],
              ["Right-click save", "Rename save"],
            ].map(([key, desc]) => (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 3 }}>
                <kbd style={{ background: "rgba(255,255,255,0.1)", padding: "1px 5px", borderRadius: 3, fontSize: "0.68rem", color: "#8bf", whiteSpace: "nowrap" }}>{key}</kbd>
                <span style={{ color: "#aab" }}>{desc}</span>
              </div>
            ))}
            <button onClick={() => setShowShortcuts(false)} style={{
              marginTop: 6, padding: "3px 10px", borderRadius: 5, border: "1px solid #555",
              background: "rgba(60,60,60,0.7)", color: "#aaa", fontSize: "0.7rem", cursor: "pointer", width: "100%",
            }}>Close</button>
          </div>
        )}
        {/* Recovery banner — shown when dev mode opens with existing autosaves */}
        {devRecoveryPrompt && autosaves.length > 0 && (
          <div style={{
            position: "fixed", bottom: 52, right: 12, zIndex: 10,
            background: "rgba(30,40,60,0.92)", backdropFilter: "blur(10px)",
            border: "1px solid #68a", borderRadius: 10,
            padding: "10px 14px", maxWidth: 340,
            color: "#dde", fontSize: "0.78rem",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            pointerEvents: "auto",
          }}>
            <div style={{ marginBottom: 6, fontWeight: 600, color: "#8bf" }}>
              Recover previous session?
            </div>
            <div style={{ color: "#aab", fontSize: "0.72rem", marginBottom: 8 }}>
              {autosaves.length} autosave{autosaves.length !== 1 ? "s" : ""} found.
              Latest: {new Date(autosaves[autosaves.length - 1].ts).toLocaleString()}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => {
                restoreAutosave(autosaves.length - 1);
                setDevRecoveryPrompt(false);
              }} style={{
                padding: "4px 12px", borderRadius: 6, border: "1px solid #68a",
                background: "#68a", color: "#fff", fontWeight: 600,
                fontSize: "0.75rem", cursor: "pointer",
              }}>Restore Latest</button>
              <button onClick={() => setDevRecoveryPrompt(false)} style={{
                padding: "4px 12px", borderRadius: 6, border: "1px solid #555",
                background: "rgba(60,60,60,0.7)", color: "#aaa",
                fontSize: "0.75rem", cursor: "pointer",
              }}>Dismiss</button>
              <button onClick={() => {
                setAutosaves([]);
                setTimelineIndex(null);
                try { localStorage.removeItem(AUTOSAVE_KEY); } catch {}
                setDevRecoveryPrompt(false);
              }} style={{
                padding: "4px 12px", borderRadius: 6, border: "1px solid #644",
                background: "rgba(100,40,40,0.5)", color: "#c88",
                fontSize: "0.75rem", cursor: "pointer",
              }}>Clear All</button>
            </div>
          </div>
        )}
        {/* View options — always visible */}
        <div className={welcomeHighlight === "view-options" ? "ws-ui-glow" : ""} style={{ ...pillStyle, flexWrap: "wrap", gap: 4, maxWidth: Math.max(200, canvasSize.width - 280) }}>
          <span style={{ opacity: 0.7, fontSize: "0.78rem" }}>View:</span>
          <button className="map-mode-btn" onClick={() => setDevFlatColors(prev => !prev)}
            style={{ ...btnStyle(devFlatColors), minWidth: 0 }}>Flat</button>
          <button className="map-mode-btn" onClick={() => setDevGrid(prev => !prev)}
            style={{ ...btnStyle(devGrid), minWidth: 0 }}>Grid</button>
          <button className="map-mode-btn" onClick={() => setDevCultureBorders(prev => !prev)}
            style={{ ...btnStyle(devCultureBorders), minWidth: 0 }}>Borders</button>
          <button className="map-mode-btn" onClick={() => setPinFaction(prev => !prev)}
            title={pinFaction
              ? "Pin Faction is ON — non-selected regions are heavily greyed when a faction is selected"
              : "Pin Faction: heavily grey out everything except the selected faction's territory (sticky preference)"}
            style={{ ...btnStyle(pinFaction), minWidth: 0 }}>Pin</button>
          <button className="map-mode-btn" onClick={() => setShowWealthPanel(prev => !prev)}
            title="Open the Faction Wealth panel — sortable list with treasury and region count, click a row to jump to that faction's territory"
            style={{ ...btnStyle(showWealthPanel), minWidth: 0 }}>Wealth</button>
          <button className="map-mode-btn" onClick={() => setShowSettlementTier(prev => !prev)}
            style={{ ...btnStyle(showSettlementTier), minWidth: 0 }}>Settlements</button>
          <button className="map-mode-btn" onClick={() => setShowArmies(prev => !prev)}
            style={{ ...btnStyle(showArmies), minWidth: 0 }}>Armies</button>
          <button className="map-mode-btn" onClick={() => setShowLabels(prev => prev === "off" ? "city" : prev === "city" ? "region" : "off")}
            style={{ ...btnStyle(showLabels !== "off"), minWidth: 0 }}>{showLabels === "off" ? "Labels" : showLabels === "city" ? "Cities" : "Regions"}</button>
          {modDataDir && (
            <button className="map-mode-btn" onClick={async () => {
              const api = window.electronAPI;
              try { await api?.clearModCaches?.(); } catch {}
              setModReloadTick((t) => t + 1);
            }}
              title={modDataStale
                ? "EDB / EDU / text files were edited on disk since Provincia loaded them — click to re-parse and refresh recruits, descriptions, etc."
                : "Re-parse the mod's EDB / EDU / text files. Useful while iterating on a mod without restarting Provincia."}
              style={{
                ...btnStyle(modDataStale),
                minWidth: 0,
                animation: modDataStale ? "mac-active-pulse 1.6s ease-in-out infinite" : "none",
              }}>{modDataStale ? "Reload!" : "Reload"}</button>
          )}
          {devMode && modDataDir && buildingRecruits && unitOwnership && (
            <button className="map-mode-btn" onClick={() => {
              // Cross-file sanity sweep across the parsed mod data.
              // 1) Every recruit `unit` referenced in EDB exists in EDU
              // 2) Every chain key in buildingRecruits has at least one
              //    real level (catches RIS-style empty redefinitions
              //    that would silently drop recruits)
              // 3) Every faction in factionCultures has at least one
              //    region listed for it in factionRegionsMap
              const issues = [];
              const dictMap = unitOwnership.__dictionary || {};
              const knownUnits = new Set(Object.keys(unitOwnership).filter((k) => k !== "__dictionary"));
              for (const [chain, lvls] of Object.entries(buildingRecruits)) {
                if (chain === "__aliases") continue;
                if (!lvls || typeof lvls !== "object") continue;
                let recruitsInChain = 0;
                for (const [lvl, recs] of Object.entries(lvls)) {
                  if (!Array.isArray(recs)) continue;
                  for (const rec of recs) {
                    recruitsInChain++;
                    if (!knownUnits.has(rec.unit)) {
                      issues.push({ severity: "error", chain, level: lvl, message: `recruit "${rec.unit}" is not in EDU` });
                    }
                  }
                }
                if (recruitsInChain === 0) {
                  issues.push({ severity: "info", chain, level: "(any)", message: "chain has zero recruit lines (intentional?)" });
                }
              }
              const errCount = issues.filter((i) => i.severity === "error").length;
              const warnCount = issues.length - errCount;
              console.group(`[validate-mod-data] ${errCount} errors, ${warnCount} info`);
              for (const it of issues) console.log(`[${it.severity}] ${it.chain}/${it.level}: ${it.message}`);
              console.groupEnd();
              pushToast(
                errCount > 0
                  ? `Validation: ${errCount} errors${warnCount ? `, ${warnCount} info` : ""} — see DevTools console (F12)`
                  : `Validation: clean${warnCount ? ` (${warnCount} info)` : ""}`,
                errCount > 0 ? "error" : "info"
              );
            }}
              title="Cross-check recruit units against EDU and report issues. Output goes to DevTools console (F12)."
              style={{ ...btnStyle(false), minWidth: 0 }}>Validate</button>
          )}
          <button className="map-mode-btn" onClick={async () => {
            if (liveLogActive) {
              // Deactivate — restore to latest state
              setLiveLogActive(false);
              setLiveSliderTurn(null);
            } else {
              const api = window.electronAPI;
              let dir = liveLogDir;
              const importedCampaign = (() => { try { return localStorage.getItem("importedCampaign"); } catch { return null; } })();
              console.log("[live] activating. saved liveLogDir:", JSON.stringify(dir), "liveSaveDir:", JSON.stringify(liveSaveDir), "importedCampaign:", JSON.stringify(importedCampaign));
              // Log dir is always Rome/logs so we only sanity-check the
              // SAVE dir against the imported campaign. If they disagree
              // (saved Rome/saves but imported Alexander), clear and redetect.
              if (liveSaveDir && importedCampaign) {
                const norm = liveSaveDir.toLowerCase().replace(/\\/g, "/");
                const expected = "/" + importedCampaign.toLowerCase() + "/saves";
                const matches = norm.includes(expected);
                console.log("[live] saveDir/campaign match check:", "norm=", norm, "expected=", expected, "matches=", matches);
                if (!matches) {
                  console.log("[live] CLEARING stale dirs (save dir campaign mismatch)");
                  dir = null;
                  setLiveLogDir(null);
                  setLiveSaveDir(null);
                  try { localStorage.removeItem("liveLogDir"); } catch {}
                  try { localStorage.removeItem("liveSaveDir"); } catch {}
                }
              } else if (dir && !liveSaveDir && importedCampaign) {
                // Legacy saved state: only liveLogDir set (pointed at Rome
                // in older builds). Force re-detect to populate liveSaveDir
                // per-campaign.
                console.log("[live] legacy liveLogDir without liveSaveDir — forcing redetect");
                dir = null;
                setLiveLogDir(null);
                try { localStorage.removeItem("liveLogDir"); } catch {}
              }
              // No saved path yet — pick a campaign folder. Priority:
              //   1. The campaign the user last imported files from
              //      (saved in localStorage as "importedCampaign", set by
              //      the import flow when it detects alexander/ or bi/ in
              //      the chosen source path).
              //   2. Among installed campaigns, whichever has the newest
              //      .sav file — the one the user is most likely playing.
              let saveDirChoice = liveSaveDir;
              if (!dir || !saveDirChoice) {
                const paths = await api?.getAppPaths();
                const roots = [];
                if (paths?.localAppData) roots.push(paths.localAppData.replace(/\\/g, "/") + "/Feral Interactive/Total War ROME REMASTERED/VFS/Local");
                if (paths?.home) roots.push(paths.home.replace(/\\/g, "/") + "/Library/Application Support/Feral Interactive/Total War Rome Remastered/VFS/Local");
                console.log("[live] auto-detect roots:", JSON.stringify(roots));
                const camps = ["Alexander", "Barbarian Invasion", "Rome"];
                // RR writes logs into .../Rome/logs regardless of which
                // campaign the game is running, but each campaign has its
                // own .../<camp>/saves folder. So we pick the save dir
                // per-campaign and always use Rome/logs for the log dir.
                let chosenSaveDir = null;
                let chosenRoot = null;
                if (importedCampaign && camps.includes(importedCampaign)) {
                  for (const root of roots) {
                    const saveDir = root + "/" + importedCampaign + "/saves";
                    const latest = await api?.getLatestSaveMtime?.(saveDir);
                    console.log("[live] trying imported-campaign saveDir:", saveDir, "latestSave:", latest?.file || "(none)");
                    if (latest) { chosenSaveDir = saveDir; chosenRoot = root; break; }
                  }
                }
                if (!chosenSaveDir) {
                  let best = null;
                  for (const c of camps) {
                    for (const root of roots) {
                      const saveDir = root + "/" + c + "/saves";
                      const latest = await api?.getLatestSaveMtime?.(saveDir);
                      if (!latest) continue;
                      const mtime = latest.mtime || 0;
                      console.log("[live] candidate:", c, "latestSave:", latest.file, "mtime:", mtime);
                      if (!best || mtime > best.mtime) best = { saveDir, root, camp: c, mtime };
                      break;
                    }
                  }
                  if (best) { chosenSaveDir = best.saveDir; chosenRoot = best.root; console.log("[live] picking newest-save winner:", best.camp, best.saveDir); }
                }
                if (chosenRoot) {
                  dir = chosenRoot + "/Rome/logs"; // RR's log dir is always under /Rome/logs
                  saveDirChoice = chosenSaveDir;
                }
                // Last resort: ask user.
                if (!dir) {
                  dir = await api?.selectLogFolder();
                  if (!dir) return;
                  const norm = dir.replace(/\\/g, "/");
                  const check = await api.readFile(norm + "/message_log.txt");
                  if (!check) {
                    const check2 = await api.readFile(norm + "/logs/message_log.txt");
                    if (check2) { dir = norm + "/logs"; }
                    else { alert("message_log.txt not found.\nNavigate to the 'logs' folder inside your Rome Remastered data directory."); return; }
                  }
                  saveDirChoice = saveDirChoice || dir.replace(/[/\\]logs\/?$/, "/saves");
                }
                setLiveLogDir(dir);
                try { localStorage.setItem("liveLogDir", dir); } catch {}
                if (saveDirChoice) {
                  setLiveSaveDir(saveDirChoice);
                  try { localStorage.setItem("liveSaveDir", saveDirChoice); } catch {}
                  console.log("[live] final dirs — log:", dir, "save:", saveDirChoice);
                }
              }
              // Clean-slate activation: we don't replay historical logs because
              // the RR log files don't distinguish "events from before you opened
              // Provincia" from "events happening right now". Instead we:
              //   - Snapshot the starting state (for future diff references).
              //   - Clear any previous live history / events / sieges.
              //   - Let the useEffects for log-watch and save-watch start from EOF
              //     / latest autosave and produce forward-only events.
              baseRegionsRef.current = JSON.parse(JSON.stringify(regions));
              baseFactionMapRef.current = JSON.parse(JSON.stringify(factionRegionsMap));

              currentTurnRef.current = 0;
              currentCampaignRef.current = null;
              setLiveHistory([]);
              setLiveLogEvents([]);
              setLiveLogTurn(null);
              setActiveSieges({});
              setLiveTurnsEnded(0);
              if (api?.saveUserFile) api.saveUserFile("live_history.json", "[]");

              setLiveLogActive(true);
              pushToast(`Live mode: ${saveDirChoice || dir}`, "info");
              // Faction gets auto-detected from the autosave filename inside
              // the save-watch effect — no manual prompt needed.
            }
          }}
            style={{ ...btnStyle(liveLogActive), minWidth: 0, color: liveLogActive ? "#4f8" : undefined }}>Live</button>
          {liveLogActive && (
            <button className="map-mode-btn" onClick={() => setShowStatsPanel(prev => !prev)}
              title={saveLuaCounters && saveLuaCounters.count
                ? "Open the Campaign Stats panel — surfaces the save's lua persistent counters (battles fought, mercenary recruitment, faction reform progress, rebellion state)"
                : "Campaign Stats — waiting on save data"}
              style={{ ...btnStyle(showStatsPanel), minWidth: 0 }}>Stats</button>
          )}
          {liveLogActive && (
            <button
              className="map-mode-btn"
              onClick={async () => {
                try {
                  const res = await window.electronAPI?.logWatchReset?.();
                  if (res?.ok) {
                    pushToast("Live tracking reset — log re-anchored to now", "info");
                  } else {
                    pushToast("Reset failed: " + (res?.reason || res?.error || "unknown"), "warning");
                  }
                } catch (e) {
                  pushToast("Reset failed: " + e.message, "warning");
                }
              }}
              title="Re-anchor the live log watcher to the current end of message_log.txt and drop all live tracking state (passenger lists, unit-flow, char positions). Use after loading a save mid-session — Provincia will then only react to events from this moment forward."
              style={{ ...btnStyle(false), minWidth: 0, fontSize: "0.65rem", padding: "1px 6px" }}
            >
              Reset
            </button>
          )}
          {liveLogActive && (
            <button
              className="map-mode-btn"
              onClick={async () => {
                const api = window.electronAPI;
                const res = await api?.selectSaveFile?.(liveSaveDir);
                if (!res) return;
                if (res.error) { alert(res.error); return; }
                setPinnedSaveFile(res.file);
                try { localStorage.setItem("pinnedSaveFile", res.file); } catch {}
                pushToast(`Tracking ${res.file}`, "info");
              }}
              title={pinnedSaveFile ? `Pinned: ${pinnedSaveFile}\nClick to pick a different save.` : "Pick a specific save to track instead of the newest one."}
              style={{ ...btnStyle(!!pinnedSaveFile), minWidth: 0, fontSize: "0.65rem", padding: "1px 6px" }}
            >
              {pinnedSaveFile ? "Pinned" : "Pick save…"}
            </button>
          )}
          {liveLogActive && pinnedSaveFile && (
            <button
              className="map-mode-btn"
              onClick={() => {
                setPinnedSaveFile(null);
                try { localStorage.removeItem("pinnedSaveFile"); } catch {}
                pushToast("Following newest save again", "info");
              }}
              title="Stop pinning — resume newest-by-mtime tracking"
              style={{ ...btnStyle(false), minWidth: 0, fontSize: "0.65rem", padding: "1px 4px" }}
            >×</button>
          )}
        </div>
        {/* Live log event feed + turn slider */}
        {liveLogActive && (liveLogEvents.length > 0 || liveHistory.length > 0) && (() => {
          const turnEvents = liveHistory.filter(e => e.type === "turn");
          const maxTurn = turnEvents.length > 0 ? Math.max(...turnEvents.map(e => e.turn)) : 0;
          const minTurn = turnEvents.length > 0 ? Math.min(...turnEvents.map(e => e.turn)) : 0;
          const displayTurn = liveSliderTurn != null ? liveSliderTurn : maxTurn;
          // Find year/season for the display turn
          const turnInfo = turnEvents.filter(e => e.turn <= displayTurn).pop();
          return (
            <div style={{
              ...pillStyle, flexDirection: "column", gap: 2, width: "fit-content", maxWidth: 420,
              padding: "4px 10px", fontSize: "0.7rem",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ fontWeight: 700, fontSize: "0.72rem" }}>
                  {liveSliderTurn != null ? `Turn ${displayTurn}` : "Live"}{turnInfo ? ` (${Math.abs(turnInfo.year)} ${turnInfo.year < 0 ? "BC" : "AD"}, ${turnInfo.season})` : ""}
                </span>
                <span style={{ fontSize: "0.6rem", color: livePlayback ? "#fa4" : liveSliderTurn != null ? "#fa4" : "#4f8", marginLeft: 8 }}>
                  {livePlayback ? "playing" : liveSliderTurn != null ? "rewound" : "watching"}
                </span>
              </div>
              {/* Turn slider */}
              {maxTurn > minTurn && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                  <span style={{ fontSize: "0.6rem", opacity: 0.6 }}>{minTurn}</span>
                  <input type="range" min={minTurn} max={maxTurn} value={displayTurn}
                    style={{ flex: 1, height: 4, cursor: "pointer", accentColor: liveSliderTurn != null ? "#fa4" : "#4f8" }}
                    onChange={(e) => {
                      setLivePlayback(false);
                      const t = parseInt(e.target.value);
                      if (t >= maxTurn) {
                        setLiveSliderTurn(null);
                        if (baseRegionsRef.current && baseFactionMapRef.current) {
                          replayToTurn(maxTurn, liveHistory, baseRegionsRef.current, baseFactionMapRef.current);
                        }
                      } else {
                        setLiveSliderTurn(t);
                        if (baseRegionsRef.current && baseFactionMapRef.current) {
                          replayToTurn(t, liveHistory, baseRegionsRef.current, baseFactionMapRef.current);
                        }
                      }
                    }}
                  />
                  <span style={{ fontSize: "0.6rem", opacity: 0.6 }}>{maxTurn}</span>
                  <button onClick={() => {
                    if (livePlayback) {
                      setLivePlayback(false);
                    } else {
                      setLivePlayback(true);
                    }
                  }} style={{
                    background: livePlayback ? "rgba(250,160,60,0.3)" : "rgba(255,255,255,0.15)",
                    border: "none", color: livePlayback ? "#fa4" : "#ccc",
                    borderRadius: 4, padding: "1px 6px", fontSize: "0.7rem", cursor: "pointer",
                    minWidth: 20, textAlign: "center",
                  }}>{livePlayback ? "\u23F8" : "\u25B6"}</button>
                  {liveSliderTurn != null && !livePlayback && (
                    <button onClick={() => {
                      setLiveSliderTurn(null);
                      setLivePlayback(false);
                      if (baseRegionsRef.current && baseFactionMapRef.current) {
                        replayToTurn(maxTurn, liveHistory, baseRegionsRef.current, baseFactionMapRef.current);
                      }
                    }} style={{
                      background: "rgba(255,255,255,0.15)", border: "none", color: "#4f8",
                      borderRadius: 4, padding: "1px 6px", fontSize: "0.6rem", cursor: "pointer",
                    }}>Live</button>
                  )}
                </div>
              )}
              {/* Event list */}
              <div style={{ maxHeight: 90, overflowY: "auto" }}>
                {(liveSliderTurn != null
                  ? liveLogEvents.filter(e => e._turn <= liveSliderTurn).slice(-15).reverse()
                  : liveLogEvents.slice(-15).reverse()
                ).map((ev, i) => (
                  <div key={i} style={{ opacity: i === 0 ? 1 : 0.6, lineHeight: 1.3 }}>
                    {ev.type === "capture" && <span style={{ color: "#f84" }}>{ev.faction} captured {ev.settlement} from {ev.from}</span>}
                    {ev.type === "siege" && <span style={{ color: ev.status === "begun" ? "#fa4" : "#8f8" }}>Siege {ev.status}: {ev.general} at {ev.settlement}</span>}
                    {ev.type === "turn" && <span style={{ color: "#8af" }}>Turn {ev.turn} {ev.phase} ({Math.abs(ev.year)} {ev.year < 0 ? "BC" : "AD"}, {ev.season})</span>}
                    {ev.type === "protectorate" && <span style={{ color: "#da4" }}>{ev.vassal} became protectorate of {ev.lord}</span>}
                    {ev.type === "round_start" && <span style={{ color: "#aaa" }}>{ev.faction}'s turn</span>}
                    {ev.type === "region_attach" && <span style={{ color: "#f84" }}>{ev.region} attached to {ev.faction}</span>}
                    {ev.type === "building_new" && <span style={{ color: "#8d8" }}>{ev.city}: built {ev.building.replace(/_/g, " ")}{ev.level > 0 ? ` (level ${ev.level})` : ""}</span>}
                    {ev.type === "building_upgrade" && <span style={{ color: "#ad8" }}>{ev.city}: upgraded {ev.building.replace(/_/g, " ")} ({ev.from} &rarr; {ev.to})</span>}
                    {ev.type === "building_removed" && <span style={{ color: "#a66" }}>{ev.city}: lost {ev.building.replace(/_/g, " ")}</span>}
                    {ev.type === "building_damaged" && <span style={{ color: ev.to < ev.from ? "#f88" : "#8f8" }}>{ev.city}: {ev.building.replace(/_/g, " ")} {ev.from}% &rarr; {ev.to}%</span>}
                    {ev.type === "army_arrived" && <span style={{ color: "#8cf" }}>{ev.region}: army arrived ({ev.units} units, {ev.soldiers} men)</span>}
                    {ev.type === "army_left" && <span style={{ color: "#ca8" }}>{ev.region}: army departed ({ev.units} units)</span>}
                    {ev.type === "army_changed" && <span style={{ color: "#aaf" }}>{ev.region}: army changed ({ev.prevUnits}&rarr;{ev.units} units, {ev.soldiers} men)</span>}
                    {ev.type === "settlement_damaged" && <span style={{ color: "#f66" }}>{ev.settlement}: {ev.cause} ({ev.deaths} dead)</span>}
                    {ev.type === "battle_outcome" && <span style={{ color: "#fc8" }}>{ev.winner} defeated {ev.loser}</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        {/* Campaign toggle — lamp-switch style with labels outside */}
        <div className={welcomeHighlight === "campaigns" ? "ws-ui-glow" : ""} style={{ display: "inline-flex", alignItems: "center", gap: 8, pointerEvents: "auto", width: "fit-content" }}
          title={`Switch to ${isImperial ? campaigns[0].label : campaigns[1].label}`}
        >
          <span style={{
            fontSize: "0.78rem", fontWeight: !isImperial ? 700 : 400,
            color: !isImperial ? "#fff" : "rgba(255,255,255,0.45)",
            textShadow: "0 1px 3px rgba(0,0,0,0.7)",
            transition: "color 0.3s, font-weight 0.3s",
          }}>{campaigns[0].label}</span>
          <div onClick={() => setMapCampaign(isImperial ? campaigns[0].key : campaigns[1].key)} style={{
            position: "relative", width: 40, height: 20, borderRadius: 10,
            background: isImperial ? "rgba(60,100,180,0.7)" : "rgba(80,80,80,0.7)",
            backdropFilter: "blur(6px)",
            cursor: "pointer", transition: "background 0.3s",
            boxShadow: "inset 0 1px 3px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.15)",
            flexShrink: 0,
          }}>
            <span style={{
              position: "absolute",
              left: isImperial ? 2 : "auto",
              right: isImperial ? "auto" : 2,
              top: 2, width: 14, height: 14, borderRadius: "50%",
              background: "#fff",
              boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
              transition: "left 0.25s ease, right 0.25s ease",
            }} />
          </div>
          <span style={{
            fontSize: "0.78rem", fontWeight: isImperial ? 700 : 400,
            color: isImperial ? "#fff" : "rgba(255,255,255,0.45)",
            textShadow: "0 1px 3px rgba(0,0,0,0.7)",
            transition: "color 0.3s, font-weight 0.3s",
          }}>{campaigns[1].label}</span>
        </div>
      </div>
    );
  }

  function renderResourceFilter() {
    if (colorMode !== "resource") return null;
    const SKIP = new Set([]);
    // Collect all resource types present in data, sorted
    const locationCounts = {};
    for (const entries of Object.values(resourcesData)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        if (!SKIP.has(e.type)) locationCounts[e.type] = (locationCounts[e.type] || 0) + 1;
      }
    }
    const allTypes = Object.keys(locationCounts).filter(t => !SKIP.has(t)).sort();

    if (allTypes.length === 0) return null;

    const activeSet = resourceFilter; // null = all
    const isActive = (t) => activeSet === null || activeSet.has(t);

    const toggle = (t) => {
      setResourceFilter(prev => {
        const current = prev === null ? new Set(allTypes) : new Set(prev);
        if (current.has(t)) current.delete(t); else current.add(t);
        // If all selected, collapse back to null
        if (current.size === allTypes.length) return null;
        if (current.size === 0) return new Set(); // keep empty rather than null
        return current;
      });
    };

    const PUBLIC = import.meta.env.BASE_URL || "./";

    return (
      <div className="resource-panel-scroll" style={{
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)",
        borderRadius: 10, padding: "6px 8px",
        width: "100%", boxSizing: "border-box",
        color: "#f6f6f6", fontSize: "0.75rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: resourcePanelCollapsed ? 0 : 6, cursor: "pointer" }}
          onClick={() => setResourcePanelCollapsed(p => !p)}>
          <strong style={{ fontSize: "0.85rem" }}>Resources <span style={{ fontSize: "0.7rem", color: "#888" }}>{resourcePanelCollapsed ? "\u25B6" : "\u25BC"}</span></strong>
          {!resourcePanelCollapsed && (
            <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setResourceFilter(null)}
                style={{ padding: "2px 7px", borderRadius: 5, border: "1px solid #888",
                  background: activeSet === null ? "#dca64a" : "#eee", color: "#222",
                  fontWeight: 600, fontSize: "0.75rem", cursor: "pointer" }}>All</button>
              <button onClick={() => setResourceFilter(new Set())}
                style={{ padding: "2px 7px", borderRadius: 5, border: "1px solid #888",
                  background: activeSet !== null && activeSet.size === 0 ? "#dca64a" : "#eee",
                  color: "#222", fontWeight: 600, fontSize: "0.75rem", cursor: "pointer" }}>None</button>
            </div>
          )}
        </div>
        {!resourcePanelCollapsed && allTypes.length > 10 && (
          <input
            type="text"
            value={resourceSearch}
            onChange={(e) => setResourceSearch(e.target.value)}
            placeholder="Search resources..."
            style={{
              width: "100%", boxSizing: "border-box", padding: "3px 6px", marginBottom: 4,
              borderRadius: 5, border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(0,0,0,0.3)", color: "#f0f0f0", fontSize: "0.7rem", outline: "none",
            }}
          />
        )}
        <div style={{ display: resourcePanelCollapsed ? "none" : "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 3px" }}>
          {allTypes.filter(t => !resourceSearch || t.replace(/_/g, " ").includes(resourceSearch.toLowerCase())).map(t => {
            const on = isActive(t);
            return (
              <button key={t} onClick={() => toggle(t)} style={{
                display: "flex", alignItems: "center", gap: 3,
                padding: "2px 4px", borderRadius: 4,
                border: "1px solid " + (on ? "#aaa" : "#555"),
                background: on ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.3)",
                color: on ? "#fff" : "#777", cursor: "pointer",
                textAlign: "left", fontSize: "0.7rem",
              }}>
                {resourceImages[t]
                  ? <img src={resourceImages[t].src} alt={t} style={{ width: 14, height: 14, objectFit: "contain", flexShrink: 0 }} />
                  : <span style={{ width: 14, height: 14, flexShrink: 0 }} />}
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                  {t.replace(/_/g, " ")}
                </span>
                <span style={{ opacity: 0.6, fontSize: "0.65rem", flexShrink: 0 }}>{locationCounts[t]}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const variantLabel = colorMode;

  // Compute the mode-specific value string for a hovered/locked region
  function getModeExtra(info) {
    if (!info) return null;
    if (colorMode === "population") {
      const pop = populationData[info.region] || populationData[info.region?.split("-")[0]] || populationData[info.city];
      return pop != null ? { label: "Population", value: pop.toLocaleString() } : null;
    }
    if (colorMode === "farm") {
      const m = String(info.tags || "").match(/\bFarm(\d+)\b/);
      if (!m) return null;
      const val = parseInt(m[1], 10);
      const max = 14;
      return { label: "Fertility", value: `${val} / ${max}` };
    }
    if (colorMode === "culture") {
      return info.culture ? { label: "Culture", value: info.culture } : null;
    }
    if (colorMode === "religion") {
      let best = null, bestLvl = -1;
      for (const hit of String(info.tags || "").matchAll(/\brel_([a-z_]+?)_(\d+)\b/g)) {
        const lvl = parseInt(hit[2], 10);
        if (lvl > bestLvl) { best = hit[1]; bestLvl = lvl; }
      }
      return best ? { label: "Religion", value: best.replace(/_/g, " ") } : null;
    }
    if (colorMode === "pop_growth") {
      const pop = populationData[info.region] || populationData[info.region?.split("-")[0]] || populationData[info.city] || 0;
      const cap = parseInt(info.pop_level || "0", 10) || 0;
      if (cap <= 0) return { label: "Pop Headroom", value: "Unknown" };
      const ratio = Math.min(1.5, pop / (cap * 1500));
      const pct = Math.round(ratio * 100);
      return { label: "Pop Headroom", value: `${pop.toLocaleString()} / ~${(cap * 1500).toLocaleString()} (${pct}%)` };
    }
    if (colorMode === "wealth") {
      const resList = resourcesData[info.region] || resourcesData[info.city] || [];
      let resSum = 0;
      for (const x of resList) resSum += (x.amount || 1);
      const farm = parseInt(info.farm_level || "0", 10) || 0;
      const portM = String(info.tags || "").match(/\bbase_port_level_(\d+)\b/);
      const port = portM ? parseInt(portM[1], 10) : 0;
      const total = resSum + farm * 2 + port * 4;
      return { label: "Wealth (est.)", value: `${total} (resources ${resSum}, farm ×${farm}, port ×${port})` };
    }
    if (colorMode === "recruitment") {
      // No on-the-fly count — too expensive per hover. Just point to the
      // recruitable list shown in the bottom region-info panel.
      return { label: "Recruitment", value: "See bottom panel for details" };
    }
    // Dev modes
    if (colorMode === "terrain") {
      const t = getTagValue(info.tags, TERRAIN_TAGS);
      return t ? { label: "Terrain", value: TERRAIN_LABELS[t] || t } : { label: "Terrain", value: "Unknown" };
    }
    if (colorMode === "climate") {
      const c = getTagValue(info.tags, CLIMATE_TAGS);
      return c ? { label: "Climate", value: CLIMATE_LABELS[c] || c } : { label: "Climate", value: "Unknown" };
    }
    if (colorMode === "port_level") {
      const lvl = getPortLevel(info.tags);
      if (lvl != null && lvl > 0) return { label: "Port Level", value: PORT_LABELS[lvl] || `Level ${lvl}` };
      if (lvl === 0 && info.region !== "Terra_Incognita") return { label: "Port Level", value: PORT_LABELS[0] };
      return { label: "Port Level", value: "Inland (No Port)" };
    }
    if (colorMode === "irrigation") {
      const irr = getTagValue(info.tags, IRRIGATION_TAGS);
      return { label: "Irrigation", value: irr ? (IRRIGATION_LABELS[irr] || irr) : "No Irrigation" };
    }
    if (colorMode === "earthquakes") {
      const eq = hasTag(info.tags, "earthquake");
      return { label: "Earthquakes", value: eq ? "Yes" : "No" };
    }
    if (colorMode === "rivertrade") {
      const rt = hasTag(info.tags, "rivertrade");
      return { label: "River Trade", value: rt ? "Yes" : "No" };
    }
    if (colorMode === "hidden_resource") {
      const hrs = getHiddenResources(info.tags);
      if (selectedHiddenResource) {
        const has = hrs.includes(selectedHiddenResource);
        return { label: `Has '${selectedHiddenResource}'`, value: has ? "Yes" : "No" };
      }
      return { label: "Hidden Resources", value: hrs.length ? hrs.join(", ") : "None" };
    }
    return null;
  }

  function renderLegend() {
    const panelStyle = {
      background: "rgba(0,0,0,0.5)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
      borderRadius: 10, padding: "8px 12px", color: "#f6f6f6",
      fontSize: "0.75rem", minWidth: 160, maxWidth: Math.min(220, canvasSize.width * 0.3),
      border: "1px solid rgba(255,255,255,0.08)",
      boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
    };
    const labelRow = { display: "flex", justifyContent: "space-between", marginTop: 2 };
    const collapseArrow = legendCollapsed ? "\u25B6" : "\u25BC";
    const collapseToggle = { cursor: "pointer", userSelect: "none" };
    const onCollapseClick = () => setLegendCollapsed(p => !p);

    if (colorMode === "population") {
      const vals = Object.values(populationData);
      if (vals.length === 0) return null;
      const minV = Math.min(...vals), maxV = Math.max(...vals);
      const midV = Math.round((minV + maxV) / 2);
      return (
        <div style={panelStyle}>
          <div style={{ fontWeight: 700, marginBottom: legendCollapsed ? 0 : 4, ...collapseToggle }} onClick={onCollapseClick}>Population <span style={{ fontSize: "0.7rem", color: "#888" }}>{collapseArrow}</span></div>
          {!legendCollapsed && <>
            <div style={{ height: 12, borderRadius: 4, background: "linear-gradient(to right, rgb(30,60,180), rgb(135,130,100), rgb(240,200,20))" }} />
            <div style={labelRow}>
              <span>{minV.toLocaleString()}</span>
              <span>{midV.toLocaleString()}</span>
              <span>{maxV.toLocaleString()}</span>
            </div>
          </>}
        </div>
      );
    }

    if (colorMode === "farm") {
      return (
        <div style={panelStyle}>
          <div style={{ fontWeight: 700, marginBottom: legendCollapsed ? 0 : 4, ...collapseToggle }} onClick={onCollapseClick}>Fertility <span style={{ fontSize: "0.7rem", color: "#888" }}>{collapseArrow}</span></div>
          {!legendCollapsed && <>
            <div style={{ height: 12, borderRadius: 4, background: "linear-gradient(to right, rgb(210,0,30), rgb(210,200,30), rgb(50,200,30))" }} />
            <div style={labelRow}>
              <span>Fertility 1</span>
              <span>Fertility 7</span>
              <span>Fertility 14</span>
            </div>
          </>}
        </div>
      );
    }
    if (colorMode === "pop_growth") {
      return (
        <div style={panelStyle}>
          <div style={{ fontWeight: 700, marginBottom: legendCollapsed ? 0 : 4, ...collapseToggle }} onClick={onCollapseClick}>Pop Headroom <span style={{ fontSize: "0.7rem", color: "#888" }}>{collapseArrow}</span></div>
          {!legendCollapsed && <>
            <div style={{ height: 12, borderRadius: 4, background: "linear-gradient(to right, rgb(70,200,40), rgb(250,140,40), rgb(250,10,40))" }} />
            <div style={labelRow}>
              <span>Empty</span><span>Half</span><span>Capped</span>
            </div>
          </>}
        </div>
      );
    }
    if (colorMode === "wealth") {
      return (
        <div style={panelStyle}>
          <div style={{ fontWeight: 700, marginBottom: legendCollapsed ? 0 : 4, ...collapseToggle }} onClick={onCollapseClick}>Wealth (est.) <span style={{ fontSize: "0.7rem", color: "#888" }}>{collapseArrow}</span></div>
          {!legendCollapsed && <>
            <div style={{ height: 12, borderRadius: 4, background: "linear-gradient(to right, rgb(60,60,60), rgb(160,140,80), rgb(255,220,90))" }} />
            <div style={labelRow}>
              <span>Poor</span><span>Mid</span><span>Wealthy</span>
            </div>
            <div style={{ fontSize: "0.7rem", color: "#aaa", marginTop: 4 }}>Resources + farm + port. Approximate, not exact game formula.</div>
          </>}
        </div>
      );
    }
    if (colorMode === "recruitment") {
      return (
        <div style={panelStyle}>
          <div style={{ fontWeight: 700, marginBottom: legendCollapsed ? 0 : 4, ...collapseToggle }} onClick={onCollapseClick}>Recruitment <span style={{ fontSize: "0.7rem", color: "#888" }}>{collapseArrow}</span></div>
          {!legendCollapsed && <>
            <div style={{ height: 12, borderRadius: 4, background: "linear-gradient(to right, rgb(40,40,120), rgb(140,80,120), rgb(240,140,40))" }} />
            <div style={labelRow}>
              <span>None</span><span>Few</span><span>Many</span>
            </div>
            <div style={{ fontSize: "0.7rem", color: "#aaa", marginTop: 4 }}>Unique unit count per region (turn-0 buildings).</div>
          </>}
        </div>
      );
    }

    if (colorMode === "government") {
      const GOV_LEGEND = [
        { level: "gov1", label: "Government A", color: [130, 70, 180] },
        { level: "gov2", label: "Government B", color: [210, 130, 40] },
        { level: "gov3", label: "Government C", color: [190, 60, 150] },
        { level: "gov4", label: "Government D", color: [25, 100, 45] },
      ];
      // Count regions per gov type
      const govCounts = {};
      for (const gov of Object.values(governmentMap)) {
        govCounts[gov.level] = (govCounts[gov.level] || 0) + 1;
      }
      return (
        <div style={panelStyle}>
          <div style={{ fontWeight: 700, marginBottom: legendCollapsed ? 0 : 6, ...collapseToggle }} onClick={onCollapseClick}>
            Government <span style={{ fontSize: "0.7rem", color: "#888" }}>{collapseArrow}</span>
          </div>
          {!legendCollapsed && GOV_LEGEND.map(g => (
            <div key={g.level} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0,
                background: `rgb(${g.color[0]},${g.color[1]},${g.color[2]})` }} />
              <span>{g.label}</span>
              <span style={{ marginLeft: "auto", color: "#aaa", fontSize: "0.7rem" }}>{govCounts[g.level] || 0}</span>
            </div>
          ))}
        </div>
      );
    }

    if (colorMode === "culture" || colorMode === "religion") {
      // Build swatch list and region counts from visible regions
      const seen = {};
      const counts = {}; // name → number of regions
      let ci = 0;
      for (const r of Object.values(regions)) {
        if (colorMode === "culture" && r.culture) {
          if (!seen[r.culture]) {
            seen[r.culture] = CULTURE_PALETTE[ci % CULTURE_PALETTE.length];
            ci++;
          }
          counts[r.culture] = (counts[r.culture] || 0) + 1;
        }
        if (colorMode === "religion") {
          let best = null, bestLvl = -1;
          for (const hit of String(r.tags || "").matchAll(/\brel_([a-z_]+?)_(\d+)\b/g)) {
            const lvl = parseInt(hit[2], 10);
            if (lvl > bestLvl) { best = hit[1]; bestLvl = lvl; }
          }
          if (best) {
            if (!seen[best]) seen[best] = RELIGION_COLORS[best] || [128, 128, 128];
            counts[best] = (counts[best] || 0) + 1;
          }
        }
      }
      const entries = Object.entries(seen).sort((a, b) => a[0].localeCompare(b[0]));
      if (entries.length === 0) return null;

      // legendFilter is now a Set<string> or null
      const activeSet = legendFilter instanceof Set ? legendFilter : null;

      const getMatchingKeys = (name) => {
        const matching = [];
        for (const [rgbKey, r] of Object.entries(regions)) {
          if (colorMode === "culture") {
            if (r.culture === name) matching.push(rgbKey);
          } else {
            let best = null, bestLvl = -1;
            for (const hit of String(r.tags || "").matchAll(/\brel_([a-z_]+?)_(\d+)\b/g)) {
              const lvl = parseInt(hit[2], 10);
              if (lvl > bestLvl) { best = hit[1]; bestLvl = lvl; }
            }
            if (best === name) matching.push(rgbKey);
          }
        }
        return matching;
      };

      const handleLegendClick = (name, isShift) => {
        setLegendFilter(prev => {
          const current = prev instanceof Set ? new Set(prev) : new Set();
          if (isShift) {
            // Shift: toggle this entry in the set
            if (current.has(name)) current.delete(name);
            else current.add(name);
          } else {
            // Regular: if only this one selected, deselect all; else select only this
            if (current.size === 1 && current.has(name)) current.clear();
            else { current.clear(); current.add(name); }
          }
          // Recompute selected provinces as union of all selected cultures
          const allKeys = [...current].flatMap(n => getMatchingKeys(n));
          const unique = [...new Set(allKeys)];
          setSelectedProvinces(unique);
          if (unique.length > 0 && !isShift) zoomToProvinces(unique);
          return current.size === 0 ? null : current;
        });
      };

      // Determine which legend entries are currently active on the map
      // (provinces selected via map clicks that belong to a culture)
      const activeOnMap = new Set(
        selectedProvinces.map(k => colorMode === "culture" ? regions[k]?.culture : (() => {
          let best = null, bestLvl = -1;
          for (const hit of String(regions[k]?.tags || "").matchAll(/\brel_([a-z_]+?)_(\d+)\b/g)) {
            const lvl = parseInt(hit[2], 10);
            if (lvl > bestLvl) { best = hit[1]; bestLvl = lvl; }
          }
          return best;
        })()).filter(Boolean)
      );

      return (
        <div className="legend-panel" style={{ ...panelStyle, maxHeight: canvasSize.height - 100, overflowY: "auto" }}>
          <div style={{ fontWeight: 700, marginBottom: legendCollapsed ? 0 : 6, ...collapseToggle }} onClick={onCollapseClick}>
            {colorMode === "culture" ? "Culture" : "Religion"} <span style={{ fontSize: "0.7rem", color: "#888" }}>{collapseArrow}</span>
            {!legendCollapsed && <span style={{ fontWeight: 400, fontSize: "0.7rem", marginLeft: 6, color: "#aaa" }}>shift+click multi-select</span>}
          </div>
          {!legendCollapsed && (
            <input
              type="text"
              value={legendSearch}
              onChange={(e) => setLegendSearch(e.target.value)}
              className="legend-search-input"
              placeholder="Search..."
              style={{
                width: "100%", boxSizing: "border-box", padding: "4px 10px", marginBottom: 4,
                borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)",
                color: "#eee", fontSize: "0.74rem", outline: "none",
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
            />
          )}
          <div style={{ display: legendCollapsed ? "none" : "flex", flexDirection: "column", gap: 2 }}>
            {colorMode === "religion" ? (
              // Grouped religion legend
              Object.entries(RELIGION_GROUPS).map(([groupName, groupRels]) => {
                let groupEntries = entries.filter(([name]) => groupRels.includes(name));
                // Apply legend search filter
                const lq = legendSearch.trim().toLowerCase();
                if (lq) {
                  groupEntries = groupEntries.filter(([name]) => name.replace(/_/g, " ").toLowerCase().includes(lq));
                  if (groupEntries.length === 0 && !groupName.toLowerCase().includes(lq)) return null;
                }
                if (groupEntries.length === 0) return null;
                const isGroupCollapsed = lq ? false : collapsedRelGroups.has(groupName);
                const groupHasSelected = groupEntries.some(([name]) => activeSet?.has(name));
                const groupRegionCount = groupEntries.reduce((sum, [name]) => sum + (counts[name] || 0), 0);
                return (
                  <div key={groupName}>
                    <div onClick={(e) => {
                      if (e.shiftKey) {
                        // Shift+click: select all religions in this group
                        const groupNames = groupEntries.map(([name]) => name);
                        setLegendFilter(prev => {
                          const current = prev instanceof Set ? new Set(prev) : new Set();
                          const allSelected = groupNames.every(n => current.has(n));
                          if (allSelected) groupNames.forEach(n => current.delete(n));
                          else groupNames.forEach(n => current.add(n));
                          const allKeys = [...current].flatMap(n => getMatchingKeys(n));
                          const unique = [...new Set(allKeys)];
                          setSelectedProvinces(unique);
                          if (unique.length > 0) zoomToProvinces(unique);
                          return current.size === 0 ? null : current;
                        });
                      } else {
                        setCollapsedRelGroups(prev => {
                          const s = new Set(prev);
                          if (s.has(groupName)) s.delete(groupName); else s.add(groupName);
                          return s;
                        });
                      }
                    }} style={{
                      padding: "3px 4px", cursor: "pointer", fontWeight: 700, fontSize: "0.72rem",
                      color: groupHasSelected ? "#e8a030" : "#aaa", userSelect: "none",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      borderBottom: "1px solid rgba(255,255,255,0.08)", marginTop: 2,
                    }}>
                      <span>{isGroupCollapsed ? "\u25B6" : "\u25BC"} {groupName}</span>
                      <span style={{ fontWeight: 400, fontSize: "0.65rem", color: "#666" }}>{groupEntries.length} types, {groupRegionCount} regions</span>
                    </div>
                    {!isGroupCollapsed && groupEntries.map(([name, rgb]) => {
                      const selected = activeSet?.has(name);
                      const onMap = activeOnMap.has(name);
                      const dimmed = activeSet && activeSet.size > 0 && !selected;
                      return (
                        <div key={name} onClick={(e) => handleLegendClick(name, e.shiftKey)} style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "2px 4px 2px 14px", borderRadius: 4, cursor: "pointer",
                          background: selected ? "rgba(220,166,74,0.25)" : onMap ? "rgba(255,255,255,0.12)" : "transparent",
                          opacity: dimmed ? 0.4 : 1,
                          transition: "opacity 0.15s, background 0.15s",
                        }}>
                          <div style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                            background: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,
                            outline: selected ? "2px solid #dca64a" : onMap ? "2px solid #fff" : "none",
                          }} />
                          <span style={{
                            textTransform: "capitalize", flex: 1, fontSize: "0.72rem",
                            fontWeight: onMap ? 700 : 400,
                            color: onMap && !selected ? "#fff" : "inherit",
                          }}>{name.replace(/_/g, " ")}</span>
                          <span style={{ fontSize: "0.62rem", color: "#666", flexShrink: 0 }}>({counts[name] || 0})</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            ) : (
              // Grouped culture legend with nested sub-groups
              (() => {
                const lq = legendSearch.trim().toLowerCase();
                // Build culture → { main, sub } mapping
                const cultureGroupMap = {};
                for (const r of Object.values(regions)) {
                  if (r.culture && !cultureGroupMap[r.culture]) {
                    cultureGroupMap[r.culture] = classifyCultureGroup(r);
                  }
                }
                // Filter entries by legend search
                const filteredEntries = lq ? entries.filter(([name]) => name.replace(/_/g, " ").toLowerCase().includes(lq)) : entries;
                // Build main → { sub → entries[] }
                const mainGroups = {};
                for (const [name, rgb] of filteredEntries) {
                  const { main, sub } = cultureGroupMap[name] || { main: "Other", sub: null };
                  if (!mainGroups[main]) mainGroups[main] = {};
                  const subKey = sub || "__direct__";
                  if (!mainGroups[main][subKey]) mainGroups[main][subKey] = [];
                  mainGroups[main][subKey].push([name, rgb]);
                }
                const mainOrder = Object.keys(mainGroups).sort((a, b) => a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b));

                const renderCultureEntry = (name, rgb, indent) => {
                  const selected = activeSet?.has(name);
                  const onMap = activeOnMap.has(name);
                  const dimmed = activeSet && activeSet.size > 0 && !selected;
                  return (
                    <div key={name} onClick={(e) => handleLegendClick(name, e.shiftKey)} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: `2px 4px 2px ${indent}px`, borderRadius: 4, cursor: "pointer",
                      background: selected ? "rgba(220,166,74,0.25)" : onMap ? "rgba(255,255,255,0.12)" : "transparent",
                      opacity: dimmed ? 0.4 : 1, transition: "opacity 0.15s, background 0.15s",
                    }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                        background: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,
                        outline: selected ? "2px solid #dca64a" : onMap ? "2px solid #fff" : "none",
                      }} />
                      <span style={{ textTransform: "capitalize", flex: 1, fontSize: "0.72rem",
                        fontWeight: onMap ? 700 : 400, color: onMap && !selected ? "#fff" : "inherit",
                      }}>{name.replace(/_/g, " ")}</span>
                      <span style={{ fontSize: "0.62rem", color: "#666", flexShrink: 0 }}>({counts[name] || 0})</span>
                    </div>
                  );
                };

                return mainOrder.map(mainName => {
                  const subs = mainGroups[mainName];
                  const subKeys = Object.keys(subs).sort((a, b) => a === "__direct__" ? -1 : b === "__direct__" ? 1 : a.localeCompare(b));
                  const allEntries = subKeys.flatMap(k => subs[k]);
                  const hasSubs = subKeys.length > 1 || (subKeys.length === 1 && subKeys[0] !== "__direct__");
                  const isMainCollapsed = lq ? false : (collapsedCulGroups.has(mainName) || collapsedCulGroups.has("__all__"));
                  const mainHasSelected = allEntries.some(([name]) => activeSet?.has(name));
                  const mainRegionCount = allEntries.reduce((sum, [name]) => sum + (counts[name] || 0), 0);

                  return (
                    <div key={mainName}>
                      {/* Main group header */}
                      <div onClick={(e) => {
                        if (e.shiftKey) {
                          // Shift+click: select all cultures in this main group
                          const groupCultureNames = allEntries.map(([name]) => name);
                          setLegendFilter(prev => {
                            const current = prev instanceof Set ? new Set(prev) : new Set();
                            const allSelected = groupCultureNames.every(n => current.has(n));
                            if (allSelected) groupCultureNames.forEach(n => current.delete(n));
                            else groupCultureNames.forEach(n => current.add(n));
                            const allKeys = [...current].flatMap(n => getMatchingKeys(n));
                            const unique = [...new Set(allKeys)];
                            setSelectedProvinces(unique);
                            if (unique.length > 0) zoomToProvinces(unique);
                            return current.size === 0 ? null : current;
                          });
                        } else {
                          setCollapsedCulGroups(prev => {
                            const s = new Set(prev); s.delete("__all__");
                            if (s.has(mainName)) s.delete(mainName); else s.add(mainName);
                            return s;
                          });
                        }
                      }} style={{
                        padding: "3px 4px", cursor: "pointer", fontWeight: 700, fontSize: "0.72rem",
                        color: mainHasSelected ? "#e8a030" : "#aaa", userSelect: "none",
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        borderBottom: "1px solid rgba(255,255,255,0.08)", marginTop: 2,
                      }}>
                        <span>{isMainCollapsed ? "\u25B6" : "\u25BC"} {mainName}</span>
                        <span style={{ fontWeight: 400, fontSize: "0.65rem", color: "#666" }}>{allEntries.length}, {mainRegionCount} reg</span>
                      </div>
                      {!isMainCollapsed && (
                        hasSubs ? (
                          // Render sub-groups inside the main group
                          subKeys.map(subKey => {
                            const subEntries = subs[subKey];
                            const subLabel = subKey === "__direct__" ? `${mainName} (core)` : subKey.replace(/^.*? — /, "");
                            const isSubCollapsed = lq ? false : collapsedCulGroups.has(`sub:${subKey}`);
                            const subRegionCount = subEntries.reduce((sum, [name]) => sum + (counts[name] || 0), 0);
                            return (
                              <div key={subKey}>
                                <div onClick={(e) => {
                                  if (e.shiftKey) {
                                    const subCultureNames = subEntries.map(([name]) => name);
                                    setLegendFilter(prev => {
                                      const current = prev instanceof Set ? new Set(prev) : new Set();
                                      const allSel = subCultureNames.every(n => current.has(n));
                                      if (allSel) subCultureNames.forEach(n => current.delete(n));
                                      else subCultureNames.forEach(n => current.add(n));
                                      const allKeys = [...current].flatMap(n => getMatchingKeys(n));
                                      const unique = [...new Set(allKeys)];
                                      setSelectedProvinces(unique);
                                      if (unique.length > 0) zoomToProvinces(unique);
                                      return current.size === 0 ? null : current;
                                    });
                                  } else {
                                    setCollapsedCulGroups(prev => {
                                      const s = new Set(prev); const k = `sub:${subKey}`;
                                      if (s.has(k)) s.delete(k); else s.add(k);
                                      return s;
                                    });
                                  }
                                }} style={{
                                  padding: "2px 4px 2px 10px", cursor: "pointer", fontWeight: 600, fontSize: "0.68rem",
                                  color: "#888", userSelect: "none",
                                  display: "flex", alignItems: "center", justifyContent: "space-between",
                                }}>
                                  <span>{isSubCollapsed ? "\u25B9" : "\u25BF"} {subLabel}</span>
                                  <span style={{ fontWeight: 400, fontSize: "0.6rem", color: "#555" }}>{subEntries.length}, {subRegionCount} reg</span>
                                </div>
                                {!isSubCollapsed && subEntries.map(([name, rgb]) => renderCultureEntry(name, rgb, 20))}
                              </div>
                            );
                          })
                        ) : (
                          // No sub-groups — render entries directly
                          allEntries.map(([name, rgb]) => renderCultureEntry(name, rgb, 14))
                        )
                      )}
                    </div>
                  );
                });
              })()
            )}
          </div>
        </div>
      );
    }

    // ── Dev mode legends (interactive, with counts and toggles) ──────
    // Shared renderer for all dev legends
    function renderDevLegend(title, classify, colorsMap, labelsMap) {
      // Build category → { rgb, label, count, rgbKeys[] }
      const cats = {};
      for (const [rgbKey, r] of Object.entries(regions)) {
        const cat = classify(r, rgbKey);
        if (!cats[cat]) {
          const rgb = colorsMap[cat] || [100, 100, 100];
          cats[cat] = { rgb, label: labelsMap[cat] || cat, count: 0, rgbKeys: [] };
        }
        cats[cat].count++;
        cats[cat].rgbKeys.push(rgbKey);
      }
      // Sort by label, but put "unknown"/"none"/"no" entries last
      let entries = Object.entries(cats).sort((a, b) => {
        const aLow = /^(none|unknown|no )/.test(a[1].label.toLowerCase()) ? 1 : 0;
        const bLow = /^(none|unknown|no )/.test(b[1].label.toLowerCase()) ? 1 : 0;
        if (aLow !== bLow) return aLow - bLow;
        return a[1].label.localeCompare(b[1].label);
      });
      // Apply legend search filter
      const lq = legendSearch.trim().toLowerCase();
      if (lq) entries = entries.filter(([, { label }]) => label.toLowerCase().includes(lq));

      const activeSet = legendFilter instanceof Set ? legendFilter : null;

      const handleClick = (catKey, isShift) => {
        setLegendFilter(prev => {
          const current = prev instanceof Set ? new Set(prev) : new Set();
          if (isShift) {
            if (current.has(catKey)) current.delete(catKey);
            else current.add(catKey);
          } else {
            if (current.size === 1 && current.has(catKey)) current.clear();
            else { current.clear(); current.add(catKey); }
          }
          const allKeys = [...current].flatMap(k => cats[k]?.rgbKeys || []);
          const unique = [...new Set(allKeys)];
          setSelectedProvinces(unique);
          if (unique.length > 0 && !isShift) zoomToProvinces(unique);
          return current.size === 0 ? null : current;
        });
      };

      return (
        <div className="legend-panel" style={{ ...panelStyle, maxHeight: canvasSize.height - 100, overflowY: "auto", borderLeft: "3px solid #e8a030" }}>
          <div style={{ fontWeight: 700, marginBottom: legendCollapsed ? 0 : 6, color: "#e8a030", ...collapseToggle }} onClick={onCollapseClick}>
            {title} <span style={{ fontSize: "0.7rem", color: "#888" }}>{collapseArrow}</span>
            {!legendCollapsed && <span style={{ fontWeight: 400, fontSize: "0.7rem", marginLeft: 6, color: "#aaa" }}>shift+click multi</span>}
          </div>
          {!legendCollapsed && (
            <input
              type="text"
              value={legendSearch}
              onChange={(e) => setLegendSearch(e.target.value)}
              className="legend-search-input"
              placeholder="Search..."
              style={{
                width: "100%", boxSizing: "border-box", padding: "4px 10px", marginBottom: 4,
                borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)",
                color: "#eee", fontSize: "0.74rem", outline: "none",
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
            />
          )}
          <div style={{ display: legendCollapsed ? "none" : "flex", flexDirection: "column", gap: 2 }}>
            {entries.map(([catKey, { rgb, label, count }]) => {
              const selected = activeSet?.has(catKey);
              const dimmed = activeSet && activeSet.size > 0 && !selected;
              return (
                <div key={catKey} onClick={(e) => handleClick(catKey, e.shiftKey)} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "2px 4px", borderRadius: 4, cursor: "pointer",
                  background: selected ? "rgba(220,166,74,0.25)" : "transparent",
                  opacity: dimmed ? 0.4 : 1,
                  transition: "opacity 0.15s, background 0.15s",
                }}>
                  <div style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0,
                    background: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,
                    outline: selected ? "2px solid #dca64a" : "none",
                  }} />
                  <span style={{ flex: 1 }}>{label}</span>
                  <span style={{ color: "#aaa", fontSize: "0.7rem" }}>({count})</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (colorMode === "terrain") {
      return renderDevLegend("Terrain Types",
        (r) => getTagValue(r.tags, TERRAIN_TAGS) || "unknown",
        { ...TERRAIN_COLORS, unknown: [100, 100, 100] },
        { ...TERRAIN_LABELS, unknown: "Unknown" });
    }
    if (colorMode === "climate") {
      return renderDevLegend("Climates",
        (r) => getTagValue(r.tags, CLIMATE_TAGS) || "unknown",
        { ...CLIMATE_COLORS, unknown: [100, 100, 100] },
        { ...CLIMATE_LABELS, unknown: "Unknown" });
    }
    if (colorMode === "port_level") {
      return renderDevLegend("Port Level",
        (r) => { const lvl = getPortLevel(r.tags); return lvl != null ? String(lvl) : "0"; },
        Object.fromEntries(Object.entries(PORT_COLORS).map(([k, v]) => [String(k), v])),
        Object.fromEntries(Object.entries(PORT_LABELS).map(([k, v]) => [String(k), v])));
    }
    if (colorMode === "irrigation") {
      return renderDevLegend("Irrigation",
        (r) => getTagValue(r.tags, IRRIGATION_TAGS) || "none",
        IRRIGATION_COLORS, IRRIGATION_LABELS);
    }
    if (colorMode === "earthquakes") {
      return renderDevLegend("Earthquakes",
        (r) => hasTag(r.tags, "earthquake") ? "yes" : "no",
        { yes: [200, 70, 60], no: [80, 160, 80] },
        { yes: "Earthquake Zone", no: "No Earthquakes" });
    }
    if (colorMode === "rivertrade") {
      return renderDevLegend("River Trade",
        (r) => hasTag(r.tags, "rivertrade") ? "yes" : "no",
        { yes: [50, 170, 70], no: [160, 130, 100] },
        { yes: "River Trade", no: "No River Trade" });
    }
    if (colorMode === "hidden_resource") {
      // Token list grouped by classification (Faction / Ethnic / Settlement /
      // AoR / Mercenary / Other), styled like the cultures legend's grouped
      // headers. Click a row to highlight on the map; click a group header to
      // collapse/expand. Search box is the shared `legendSearch`.
      const lq = legendSearch.trim().toLowerCase();
      const filtered = lq
        ? hiddenResourcesList.filter(({ name }) => name.replace(/_/g, " ").toLowerCase().includes(lq))
        : hiddenResourcesList;
      const SWATCH_HIT = [50, 180, 90];
      const SWATCH_MISS = [110, 110, 110];
      const HR_GROUP_ORDER = ["Faction", "Ethnic", "Settlement", "Area of Recruitment", "Mercenary", "Other"];
      const grouped = {};
      for (const e of filtered) {
        if (!grouped[e.group]) grouped[e.group] = [];
        grouped[e.group].push(e);
      }
      const groupNames = HR_GROUP_ORDER.filter(g => grouped[g]);

      const renderEntry = ({ name, count }, indent) => {
        const active = selectedHiddenResource === name;
        const dimmed = selectedHiddenResource && !active;
        const swatch = active ? SWATCH_HIT : SWATCH_MISS;
        return (
          <div
            key={name}
            onClick={() => setSelectedHiddenResource(active ? null : name)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: `2px 4px 2px ${indent}px`, borderRadius: 4, cursor: "pointer",
              background: active ? "rgba(220,166,74,0.25)" : "transparent",
              opacity: dimmed ? 0.55 : 1,
              transition: "opacity 0.15s, background 0.15s",
            }}
          >
            <div style={{
              width: 10, height: 10, borderRadius: 2, flexShrink: 0,
              background: `rgb(${swatch[0]},${swatch[1]},${swatch[2]})`,
              outline: active ? "2px solid #dca64a" : "none",
            }} />
            <span style={{
              textTransform: "capitalize", flex: 1, fontSize: "0.72rem",
              fontWeight: active ? 700 : 400,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{name.replace(/_/g, " ")}</span>
            <span style={{ fontSize: "0.62rem", color: "#666", flexShrink: 0 }}>({count})</span>
          </div>
        );
      };

      return (
        <div className="legend-panel" style={{ ...panelStyle, maxHeight: canvasSize.height - 100, overflowY: "auto", borderLeft: "3px solid #e8a030" }}>
          <div style={{ fontWeight: 700, marginBottom: legendCollapsed ? 0 : 6, color: "#e8a030", ...collapseToggle }} onClick={onCollapseClick}>
            Hidden Resource <span style={{ fontWeight: 400, fontSize: "0.7rem", color: "#aaa" }}>({hiddenResourcesList.length})</span>
            <span style={{ fontSize: "0.7rem", color: "#888", marginLeft: 6 }}>{collapseArrow}</span>
          </div>
          {!legendCollapsed && (
            <input
              type="text"
              value={legendSearch}
              onChange={(e) => setLegendSearch(e.target.value)}
              className="legend-search-input"
              placeholder="Search..."
              style={{
                width: "100%", boxSizing: "border-box", padding: "4px 10px", marginBottom: 4,
                borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)",
                color: "#eee", fontSize: "0.74rem", outline: "none",
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
            />
          )}
          {!legendCollapsed && devMode && (() => {
            const lqExact = lq && hiddenResourcesList.some(e => e.name.toLowerCase() === lq);
            const proposed = lq && !lqExact && /^[a-z0-9_]+$/.test(lq) ? lq : null;
            const commit = (raw) => {
              const name = String(raw || "").trim().toLowerCase();
              if (!name) { setNewHrError("Token can't be empty."); return; }
              if (!/^[a-z0-9_]+$/.test(name)) { setNewHrError("Lowercase letters, digits and underscores only."); return; }
              const existing = hiddenResourcesList.find(e => e.name.toLowerCase() === name);
              setSelectedHiddenResource(existing ? existing.name : name);
              setLegendSearch("");
              setNewHrDraft(null);
              setNewHrError(null);
            };
            if (newHrDraft !== null) {
              return (
                <div style={{
                  marginBottom: 4, padding: 6, borderRadius: 8,
                  background: "rgba(232,160,48,0.08)", border: "1px dashed rgba(232,160,48,0.45)",
                }}>
                  <input
                    autoFocus
                    type="text"
                    value={newHrDraft}
                    onChange={(e) => { setNewHrDraft(e.target.value); if (newHrError) setNewHrError(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commit(newHrDraft); }
                      else if (e.key === "Escape") { e.preventDefault(); setNewHrDraft(null); setNewHrError(null); }
                    }}
                    placeholder="new_hr_token"
                    style={{
                      width: "100%", boxSizing: "border-box", padding: "4px 8px",
                      borderRadius: 6, border: "1px solid rgba(232,160,48,0.5)",
                      background: "rgba(0,0,0,0.4)", color: "#eee",
                      fontSize: "0.74rem", outline: "none",
                    }}
                  />
                  {newHrError && (
                    <div style={{ color: "#e8a030", fontSize: "0.65rem", marginTop: 3 }}>{newHrError}</div>
                  )}
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <button
                      onClick={() => commit(newHrDraft)}
                      style={{
                        flex: 1, padding: "3px 8px", borderRadius: 6, cursor: "pointer",
                        border: "1px solid rgba(232,160,48,0.5)", background: "#dca64a",
                        color: "#221", fontSize: "0.7rem", fontWeight: 700,
                      }}
                    >Add</button>
                    <button
                      onClick={() => { setNewHrDraft(null); setNewHrError(null); }}
                      style={{
                        flex: 1, padding: "3px 8px", borderRadius: 6, cursor: "pointer",
                        border: "1px solid rgba(255,255,255,0.2)", background: "transparent",
                        color: "#aaa", fontSize: "0.7rem",
                      }}
                    >Cancel</button>
                  </div>
                </div>
              );
            }
            return (
              <button
                onClick={() => { setNewHrDraft(proposed || ""); setNewHrError(null); }}
                title="Define a new hidden_resource token, then right-click a province to add it"
                style={{
                  width: "100%", padding: "4px 10px", marginBottom: 4,
                  borderRadius: 8, border: "1px dashed rgba(232,160,48,0.45)",
                  background: "rgba(232,160,48,0.08)", color: "#dca64a",
                  fontSize: "0.72rem", cursor: "pointer", textAlign: "center",
                }}
              >+ Add{proposed ? ` "${proposed}"` : " new hidden resource…"}</button>
            );
          })()}
          {!legendCollapsed && selectedHiddenResource && !hiddenResourcesList.some(e => e.name === selectedHiddenResource) && (
            <div style={{
              padding: "6px 8px", marginBottom: 4, borderRadius: 6,
              background: "rgba(232,160,48,0.12)", border: "1px solid rgba(232,160,48,0.4)",
              fontSize: "0.7rem", color: "#dca64a", lineHeight: 1.35,
            }}>
              <div style={{ fontWeight: 700, textTransform: "capitalize" }}>{selectedHiddenResource.replace(/_/g, " ")} <span style={{ fontWeight: 400, color: "#aaa" }}>(new — 0 regions)</span></div>
              <div style={{ color: "#aaa", fontSize: "0.65rem" }}>Right-click a province to add this token.</div>
              <div style={{ marginTop: 4, fontSize: "0.65rem" }}>
                <span onClick={() => setSelectedHiddenResource(null)} style={{ cursor: "pointer", textDecoration: "underline", color: "#aaa" }}>Cancel</span>
              </div>
            </div>
          )}
          <div style={{ display: legendCollapsed ? "none" : "flex", flexDirection: "column", gap: 2 }}>
            {groupNames.length === 0 && (
              <div style={{ color: "#aaa", fontSize: "0.72rem", padding: "8px 4px", textAlign: "center" }}>
                No matches.
              </div>
            )}
            {groupNames.map(groupName => {
              const items = grouped[groupName];
              const collapsed = lq ? false : (collapsedHrGroups.has(groupName) || collapsedHrGroups.has("__all__"));
              const groupHasSelected = !!(selectedHiddenResource && items.some(e => e.name === selectedHiddenResource));
              const totalRegions = items.reduce((s, e) => s + e.count, 0);
              return (
                <div key={groupName}>
                  <div onClick={() => {
                    setCollapsedHrGroups(prev => {
                      const s = new Set(prev); s.delete("__all__");
                      if (s.has(groupName)) s.delete(groupName); else s.add(groupName);
                      return s;
                    });
                  }} style={{
                    padding: "3px 4px", cursor: "pointer", fontWeight: 700, fontSize: "0.72rem",
                    color: groupHasSelected ? "#e8a030" : "#aaa", userSelect: "none",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    borderBottom: "1px solid rgba(255,255,255,0.08)", marginTop: 2,
                  }}>
                    <span>{collapsed ? "▶" : "▼"} {groupName}</span>
                    <span style={{ fontWeight: 400, fontSize: "0.65rem", color: "#666" }}>{items.length}, {totalRegions} reg</span>
                  </div>
                  {!collapsed && items.map(e => renderEntry(e, 14))}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // Faction legend
    if (colorMode === "faction") {
      // Aggregate from descr_strat ownership (factionRegionsMap), matching the
      // map coloring logic. The `r.faction` field in descr_regions is the
      // rebel-default faction (used for unowned regions), NOT the owner —
      // counting it would inflate factions like Sparta to 45 cities when the
      // mod actually places only 3 settlements under that faction.
      const factionMap = {};
      const ownedKeys = new Set();
      const nameLookup = {};
      for (const [rgbKey, r] of Object.entries(regions)) {
        if (r.region) (nameLookup[r.region.toLowerCase()] = nameLookup[r.region.toLowerCase()] || []).push(rgbKey);
        if (r.city) (nameLookup[r.city.toLowerCase()] = nameLookup[r.city.toLowerCase()] || []).push(rgbKey);
      }
      const ensure = (f, rgbKey) => {
        if (!factionMap[f]) {
          const fc = factionColors[f.toLowerCase()];
          const color = (fc && fc.primary) ? fc.primary : (rgbKey ? rgbKey.split(",").map(Number) : [128,128,128]);
          factionMap[f] = { color, count: 0, rgbKeys: [] };
        }
      };
      for (const [faction, regionNames] of Object.entries(factionRegionsMap || {})) {
        for (const rn of (regionNames || [])) {
          const keys = nameLookup[rn.toLowerCase()] || [];
          for (const rgbKey of keys) {
            if (ownedKeys.has(rgbKey)) continue;
            ensure(faction, rgbKey);
            factionMap[faction].count++;
            factionMap[faction].rgbKeys.push(rgbKey);
            ownedKeys.add(rgbKey);
          }
        }
      }
      // Remaining regions (no descr_strat owner) are rebels/slaves in-game.
      let rebelCount = 0;
      const rebelKeys = [];
      for (const rgbKey of Object.keys(regions)) {
        if (!ownedKeys.has(rgbKey)) { rebelCount++; rebelKeys.push(rgbKey); }
      }
      if (rebelCount > 0) {
        const fc = factionColors["slave"] || factionColors["rebels"];
        factionMap["slave"] = {
          color: (fc && fc.primary) ? fc.primary : [120, 120, 120],
          count: rebelCount,
          rgbKeys: rebelKeys,
        };
      }
      const factionEntries = Object.entries(factionMap).sort((a, b) => b[1].count - a[1].count);
      if (factionEntries.length === 0) return null;

      // Identify faction groups that share a primary colour (source-data collisions)
      const colorGroups = {};
      for (const [name, data] of factionEntries) {
        const key = data.color.join(",");
        (colorGroups[key] = colorGroups[key] || []).push(name);
      }
      const duplicateColorPartners = {}; // factionName → [other faction names sharing its colour]
      for (const names of Object.values(colorGroups)) {
        if (names.length > 1) {
          for (const n of names) {
            duplicateColorPartners[n] = names.filter(x => x !== n);
          }
        }
      }

      const activeSet = legendFilter instanceof Set ? legendFilter : null;
      const lq = legendSearch.trim().toLowerCase();
      const filtered = lq ? factionEntries.filter(([name]) => name.replace(/_/g, " ").toLowerCase().includes(lq)) : factionEntries;

      const handleFactionLegendClick = (factionName, isShift) => {
        setLegendFilter(prev => {
          const current = prev instanceof Set ? new Set(prev) : new Set();
          if (isShift) {
            if (current.has(factionName)) current.delete(factionName);
            else current.add(factionName);
          } else {
            if (current.size === 1 && current.has(factionName)) current.clear();
            else { current.clear(); current.add(factionName); }
          }
          const allKeys = [...current].flatMap(n => factionMap[n]?.rgbKeys || []);
          const unique = [...new Set(allKeys)];
          setSelectedProvinces(unique);
          if (unique.length > 0 && !isShift) zoomToProvinces(unique);
          return current.size === 0 ? null : current;
        });
      };

      return (
        <div className="legend-panel" style={{ ...panelStyle, maxHeight: canvasSize.height - 100, overflowY: "auto" }}>
          <div style={{ fontWeight: 700, marginBottom: legendCollapsed ? 0 : 6, ...collapseToggle }} onClick={onCollapseClick}>
            Factions <span style={{ fontSize: "0.7rem", color: "#888" }}>{collapseArrow}</span>
            {!legendCollapsed && <span style={{ fontWeight: 400, fontSize: "0.7rem", marginLeft: 6, color: "#aaa" }}>shift+click multi-select</span>}
          </div>
          {!legendCollapsed && (
            <input
              type="text"
              value={legendSearch}
              onChange={(e) => setLegendSearch(e.target.value)}
              className="legend-search-input"
              placeholder="Search factions..."
              style={{
                width: "100%", boxSizing: "border-box", padding: "4px 10px", marginBottom: 4,
                borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)",
                color: "#eee", fontSize: "0.74rem", outline: "none",
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
            />
          )}
          <div style={{ display: legendCollapsed ? "none" : "flex", flexDirection: "column", gap: 2 }}>
            {filtered.map(([factionName, { color, count }]) => {
              const selected = activeSet?.has(factionName);
              const dimmed = activeSet && activeSet.size > 0 && !selected;
              const partners = duplicateColorPartners[factionName];
              const collisionTip = partners
                ? `Shares this colour with: ${partners.map(p => p.replace(/_/g, " ")).join(", ")}`
                : null;
              return (
                <div key={factionName} onClick={(e) => handleFactionLegendClick(factionName, e.shiftKey)} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "2px 4px", borderRadius: 4, cursor: "pointer",
                  background: selected ? "rgba(220,166,74,0.25)" : "transparent",
                  opacity: dimmed ? 0.4 : 1,
                  transition: "opacity 0.15s, background 0.15s",
                }}>
                  <div style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0,
                    background: `rgb(${color[0]},${color[1]},${color[2]})`,
                    outline: selected ? "2px solid #dca64a" : "none",
                  }} />
                  <span style={{ flex: 1, textTransform: "capitalize", fontSize: "0.66rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={(factionDisplayNames && factionDisplayNames[factionName]) || factionName.replace(/_/g, " ")}>{(factionDisplayNames && factionDisplayNames[factionName]) || factionName.replace(/_/g, " ")}</span>
                  {collisionTip && (
                    <span title={collisionTip} style={{
                      fontSize: "0.62rem", color: "#e8a030", flexShrink: 0,
                      cursor: "help", fontWeight: 700,
                    }}>⚠</span>
                  )}
                  <span style={{ fontSize: "0.62rem", color: "#666", flexShrink: 0 }}>({count})</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    return null;
  }

  function renderSettlementLegend() {
    if (!showSettlementTier || Object.keys(settlementTierMap).length === 0) return null;
    const sPanelStyle = {
      background: "rgba(0,0,0,0.5)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
      borderRadius: 10, padding: "8px 12px", color: "#f6f6f6",
      fontSize: "0.75rem", minWidth: 160, maxWidth: Math.min(220, canvasSize.width * 0.3),
      border: "1px solid rgba(255,255,255,0.08)",
      boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
    };
    const STIER_LEGEND = [
      { level: "village",    label: "Village",    color: [170, 110, 60] },
      { level: "town",       label: "Town",       color: [200, 50, 50] },
      { level: "large_town", label: "Large Town", color: [120, 200, 80] },
      { level: "city",       label: "City",       color: [40, 175, 140] },
      { level: "large_city", label: "Large City", color: [240, 150, 170] },
      { level: "huge_city",  label: "Huge City",  color: [210, 190, 100] },
    ];
    const tierCounts = {};
    for (const tier of Object.values(settlementTierMap)) {
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    }
    const sCollapsed = settlementLegendCollapsed;
    const sArrow = sCollapsed ? "\u25B6" : "\u25BC";
    return (
      <div style={sPanelStyle}>
        <div style={{ fontWeight: 700, marginBottom: sCollapsed ? 0 : 6, cursor: "pointer", userSelect: "none" }} onClick={() => setSettlementLegendCollapsed(p => !p)}>
          Settlements <span style={{ fontSize: "0.7rem", color: "#888" }}>{sArrow}</span>
        </div>
        {!sCollapsed && STIER_LEGEND.map(s => (
          <div key={s.level} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0,
              background: `rgb(${s.color[0]},${s.color[1]},${s.color[2]})` }} />
            <span>{s.label}</span>
            <span style={{ marginLeft: "auto", color: "#aaa", fontSize: "0.7rem" }}>{tierCounts[s.level] || 0}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <style>{globalScrollbarKill}</style>
      <canvas
        ref={bgCanvasRef}
        aria-hidden="true"
        style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}
      />
      {updateReady && (
        <UpdateBanner
          version={updateReady.version}
          onRestart={() => window.electronAPI?.updaterQuitAndInstall?.()}
          onDismiss={() => setUpdateReady(null)}
        />
      )}
      <Toasts
        toasts={toasts}
        onDismiss={(id) => setToasts(prev => prev.filter(x => x.id !== id))}
      />
      {/* Live-mode loading banner: shows while the main process parses the
          latest save (5-30s on big mid-game saves). Without this, the user
          sees a frozen window and assumes the app crashed. */}
      {liveLoading && (
        <div
          style={{
            position: "fixed", top: 8, right: 12, zIndex: 10010,
            background: "linear-gradient(90deg, #1a1a1a 0%, #2a1f10 100%)",
            color: "#dca64a",
            border: "1px solid rgba(220,166,74,0.4)",
            borderRadius: 8,
            padding: "6px 12px",
            fontFamily: "Consolas, monospace",
            fontSize: "0.8rem",
            display: "inline-flex", alignItems: "center", gap: 10,
            boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
            maxWidth: "min(380px, 40vw)",
          }}
        >
          {/* Whole pill content is shimmer-text. Single sweeping
              gradient passes through "Loading save… <stage>", which
              both shows what's happening and signals progress with no
              extra spinner or stripe widget. */}
          <span
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              backgroundImage: "linear-gradient(90deg, #a8865c 0%, #a8865c 35%, #ffe6a8 50%, #a8865c 65%, #a8865c 100%)",
              backgroundSize: "300% 100%",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              animation: "live-shimmer 1.6s linear infinite",
              fontWeight: 600,
            }}
          >
            Loading save… {liveLoadingStage || ""}
          </span>
          <style>{`
            @keyframes live-shimmer {
              0%   { background-position: 200% 0; }
              100% { background-position: -100% 0; }
            }
          `}</style>
        </div>
      )}
      {showFactionPicker && factions && factions.length > 0 && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 10004,
          background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowFactionPicker(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "rgba(22,24,28,0.98)", border: "1px solid #555",
            borderRadius: 10, padding: 16, maxWidth: "80vw", maxHeight: "80vh",
            overflowY: "auto", color: "#eee", boxShadow: "0 6px 30px rgba(0,0,0,0.6)",
          }}>
            <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: 4 }}>
              Select your faction
            </div>
            <div style={{ fontSize: "0.8rem", color: "#aaa", marginBottom: 12 }}>
              Live mode uses this to label events and filter the save correctly. You can change it later.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 96px)", gap: 8 }}>
              {factions.map(f => (
                <button key={f} onClick={() => {
                  setPlayerFaction(f);
                  try { localStorage.setItem("playerFaction", f); } catch {}
                  setShowFactionPicker(false);
                }} style={{
                  background: "rgba(40,42,48,0.8)", border: "1px solid #555",
                  borderRadius: 6, padding: 6, cursor: "pointer", color: "#eee",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                }}>
                  <div style={{ width: 72, height: 72, filter: ICON_DROP_SHADOW }}>
                    <FactionIcon iconPath={`faction_icons/${f}.tga`} alt={f} size={72} tightCrop modIconsDir={modIconsDir} />
                  </div>
                  <span style={{ fontSize: "0.7rem", textTransform: "capitalize" }}>
                    {f.replace(/_/g, " ")}
                  </span>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setShowFactionPicker(false)} style={{
                padding: "6px 14px", borderRadius: 6, border: "1px solid #555",
                background: "transparent", color: "#aaa", cursor: "pointer",
              }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          height: "100vh",
          width: "100vw",
          background: "transparent",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        {showSplash && !assetError && (
          <div className="splash" style={overlayBase}>
            <img
              src={(import.meta.env.BASE_URL || "./") + "/splash.png"}
              alt="Splash"
              style={{
                display: "block",
                width: "100%",
                height: "auto",
                maxWidth: "80vw",
                maxHeight: "80vh",
                borderRadius: 16,
                boxShadow: "0 4px 32px rgba(0,0,0,0.2)",
              }}
              draggable={false}
            />
          </div>
        )}

        {assetError && !proceedAnyway && (
          <div style={overlayBase}>
            <div className="panel" style={{ maxWidth: 700, margin: 16, padding: 16, textAlign: "left" }}>
              <div style={{ fontWeight: 700, fontSize: "1.2rem", marginBottom: 8 }}>Asset load error</div>
              <div style={{ marginBottom: 12, whiteSpace: "pre-wrap" }}>{assetError}</div>
              <ul style={{ marginTop: 0 }}>
                <li>Open public/regions.json in an editor and fix the JSON at the indicated line/column.</li>
                <li>Ensure the active map file exists (map.png).</li>
                <li>Or run: npm run debug:regions to see the exact lines around the error.</li>
              </ul>
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => window.location.reload()}>Retry</button>
                <button
                  onClick={() => {
                    setProceedAnyway(true);
                    setAssetError(null);
                  }}
                >
                  Continue without regions
                </button>
              </div>
            </div>
          </div>
        )}

        {!showSplash && (!assetError || proceedAnyway) && (
          <>
            {showWelcome && (
              <WelcomeScreen
                currentVersion={displayVersion}
                lastSeenVersion={lastSeenVersion}
                onboardingDone={onboardingDone}
                forceOnboarding={isTestBuild}
                onPhaseChange={setWelcomePhase}
                onDone={(savedVersion) => {
                  setShowWelcome(false);
                  setWelcomePhase(null);
                  setWelcomeHighlight(null);
                  setLockedRegionInfo(null);
                  // WelcomeScreen reports back the highest version it just showed,
                  // so a later test-iteration of the same display version won't re-prompt.
                  setLastSeenVersion(savedVersion || displayVersion);
                  setOnboardingDone(true);
                }}
                onHighlight={(target) => {
                  setWelcomeHighlight(target);
                  if (target === "region-info") {
                    // Show a sample region in the info panel
                    const firstKey = Object.keys(regions)[0];
                    if (firstKey && regions[firstKey]) setLockedRegionInfo({ ...regions[firstKey], rgb: firstKey });
                  } else {
                    setLockedRegionInfo(null);
                  }
                }}
                mapCenterX={MAP_PADDING + canvasSize.width / 2}
              />
            )}
            {/* LEFT COLUMN: Map */}
            <div style={{ position: "absolute", top: MAP_PADDING, left: MAP_PADDING, width: canvasSize.width }}>
              <div style={{ position: "relative" }}>
                {renderMapModeToggle()}
                <div className="legend-panel" style={{
                  position: "absolute", top: 8, right: 8, zIndex: 3,
                  display: "flex", flexDirection: "column", gap: 6,
                  maxHeight: canvasSize.height - 16, overflowY: "auto",
                  width: 240, boxSizing: "border-box",
                }}>
                  {/* Map-mode panels first (Factions legend, Settlement
                      legend, Homeland, Resources) so the active mode's
                      context sits at the top of the sidebar. Army Types
                      always at the bottom — same ordering regardless of
                      map mode. */}
                  {renderLegend()}
                  {renderSettlementLegend()}
                  {renderResourceFilter()}
                  {colorMode === "homeland" && selectedFaction && (
                    <div style={{
                      background: "rgba(0,0,0,0.5)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
                      borderRadius: 10, padding: "8px 12px",
                      color: "#f6f6f6", fontSize: "0.75rem",
                      border: "1px solid rgba(255,255,255,0.08)",
                      boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: homelandPanelCollapsed ? 0 : 4, cursor: "pointer", userSelect: "none" }}
                        onClick={() => setHomelandPanelCollapsed(p => !p)}>
                        Homeland <span style={{ fontSize: "0.7rem", color: "#888" }}>{homelandPanelCollapsed ? "▶" : "▼"}</span>
                      </div>
                      {!homelandPanelCollapsed && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {[
                            { color: "rgb(50,180,50)", label: "Homeland — owned" },
                            { color: "rgb(210,190,40)", label: "Homeland — foreign-held" },
                            { color: "rgb(180,50,50)", label: "Not homeland" },
                          ].map(({ color, label }) => (
                            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ width: 12, height: 12, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />
                              <span>{label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {showArmies && armiesToRender.length > 0 && (
                    <div style={{
                      background: "rgba(0,0,0,0.5)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
                      borderRadius: 10, padding: "8px 12px",
                      color: "#f6f6f6", fontSize: "0.75rem",
                      border: "1px solid rgba(255,255,255,0.08)",
                      boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: armyTypesPanelCollapsed ? 0 : 4, cursor: "pointer", userSelect: "none" }}
                        onClick={() => setArmyTypesPanelCollapsed(p => !p)}>
                        Army Types <span style={{ fontSize: "0.7rem", color: "#888" }}>{armyTypesPanelCollapsed ? "▶" : "▼"}</span>
                      </div>
                      {!armyTypesPanelCollapsed && (
                        <>
                          <div onClick={() => setUseLiveOverride(v => !v)}
                            style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.7rem", color: useLiveOverride ? "#9ec" : "#888", marginBottom: 4, paddingBottom: 4, borderBottom: "1px solid #444" }}
                            title="When ON, positions from the message log override save positions (pixel-accurate for live play). Turn OFF when reviewing older saves.">
                            <span>{useLiveOverride ? "🟢" : "⚪"}</span>
                            <span>Live-log override</span>
                          </div>
                          {(() => {
                            const counts = { garrison: 0, field: 0, navy: 0 };
                            for (const a of armiesToRender) {
                              if (counts[a.armyClass] != null) counts[a.armyClass]++;
                            }
                            return [
                              { key: 'garrison',  label: '🏰 Garrisons', color: '#dca040', get: showGarrisons,   set: setShowGarrisons },
                              { key: 'field',     label: '⚔ Armies',       color: '#b42828', get: showFieldArmies, set: setShowFieldArmies },
                              { key: 'navy',      label: '⚓ Navies',      color: '#2872d2', get: showNavies,      set: setShowNavies },
                            ].map(({ key, label, color, get, set }) => (
                              <div key={key} onClick={() => set(s => !s)}
                                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", opacity: get ? 1 : 0.4 }}>
                                <span style={{ width: 12, height: 12, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />
                                <span>{label}</span>
                                <span style={{ color: "#9ab", marginLeft: "auto", fontVariantNumeric: "tabular-nums", fontSize: "0.76rem" }}>
                                  {counts[key]}
                                </span>
                              </div>
                            ));
                          })()}
                        </>
                      )}
                    </div>
                  )}
                </div>
                <canvas
                  ref={canvasRef}
                  onClick={handleClick}
                  onContextMenu={handleContextMenu}
                  onMouseMove={handleMouseMove}
                  onMouseDown={handleMouseDown}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={() => { handleMouseUp(); setHoveredResource(null); setHoveredArmy(null); setHoveredCity(null); }}
                  onDoubleClick={handleDoubleClick}
                  tabIndex={0}
                  width={canvasSize.width}
                  height={canvasSize.height}
                  style={{
                    display: "block",
                    background: "inherit",
                    borderRadius: 8,
                    boxShadow: "0 2px 16px rgba(0,0,0,0.06)",
                    border: "1px solid #333",
                    width: canvasSize.width,
                    height: canvasSize.height,
                    minWidth: 100,
                    minHeight: 100,
                  }}
                  aria-label={`Interactive map (${variantLabel})`}
                />

                {/* Army hover tooltip */}
                {hoveredArmy && (() => {
                  // Clamp the tooltip inside the viewport. A long traits
                  // line (e.g. Lucius Valerius_Flaccus with 3 listed
                  // traits) used to spill out the right side of the map
                  // into the info panel. We don't know the tooltip's
                  // exact rendered width up front, so use the maxWidth
                  // we set (300px) as a conservative reservation and
                  // flip the tooltip to the LEFT side of the marker
                  // when it would overflow the right edge.
                  const TT_W = 300, TT_H_EST = 120;
                  let left = hoveredArmy.screenX + 14;
                  let top = hoveredArmy.screenY - 10;
                  const vw = window.innerWidth, vh = window.innerHeight;
                  if (left + TT_W > vw - 8) left = Math.max(8, hoveredArmy.screenX - TT_W - 14);
                  if (top + TT_H_EST > vh - 8) top = Math.max(8, vh - TT_H_EST - 8);
                  if (top < 8) top = 8;
                  return (
                  <div style={{
                    position: "absolute",
                    left,
                    top,
                    background: "rgba(20,20,20,0.92)",
                    color: "#f7f7f7",
                    padding: "6px 10px",
                    borderRadius: 6,
                    fontSize: "0.82rem",
                    pointerEvents: "none",
                    zIndex: 11,
                    border: "1px solid #555",
                    maxWidth: TT_W,
                    whiteSpace: "normal",
                    wordBreak: "break-word",
                  }}>
                    {(() => {
                      // Same-tile merge via the runtime unit-flow events
                      // (main.js's `transferring general(X) → Y` lines).
                      // If a's commanderUuid is a merged donor or target,
                      // group all armies in that merge cluster together.
                      // Fallback: exact (faction, x, y) coord match for
                      // cases where the merge wasn't captured (mod reload
                      // mid-merge, etc).
                      const a = hoveredArmy.army;
                      // Find a's role in mergedPairsBySecondary.
                      const targetSec = a.commanderUuid
                        ? (mergedPairsBySecondary.get(a.commanderUuid) || a.commanderUuid)
                        : null;
                      let totalUnits = a.units ? a.units.length : 0;
                      const otherCommanders = [];
                      for (const other of (armiesToRender || [])) {
                        if (other === a) continue;
                        if (!other.faction || !a.faction) continue;
                        if (other.faction.toLowerCase() !== a.faction.toLowerCase()) continue;
                        // Merge-pair match: other belongs to the same
                        // logical stack per the live log.
                        let isMerge = false;
                        if (targetSec && other.commanderUuid) {
                          const otherTarget = mergedPairsBySecondary.get(other.commanderUuid) || other.commanderUuid;
                          if (otherTarget === targetSec) isMerge = true;
                        }
                        // Coord fallback.
                        if (!isMerge && typeof a.x === "number" && typeof a.y === "number" && other.x === a.x && other.y === a.y) {
                          isMerge = true;
                        }
                        if (!isMerge) continue;
                        if (Array.isArray(other.units)) totalUnits += other.units.length;
                        if (other.character) otherCommanders.push(other.character);
                      }
                      const displayName = otherCommanders.length > 0
                        ? `${a.character || a.name || "(unnamed)"} + ${otherCommanders.join(" + ")}`
                        : (a.character || a.name || "(unnamed)");
                      return <>
                        <div style={{ fontWeight: 700, marginBottom: 2 }}>
                          {a.armyClass === 'navy' ? '⚓' : a.armyClass === 'garrison' ? '🏰' : '⚔'} {displayName}
                          {typeof a.age === 'number' && otherCommanders.length === 0 ? <span style={{ color: "#9ab", fontWeight: 400, marginLeft: 6 }}>age {a.age}</span> : null}
                        </div>
                        <div style={{ color: "#bbb", marginBottom: 4 }}>
                          {(a.faction || '').replace(/_/g, " ")}
                          {totalUnits > 0 ? <> &mdash; {totalUnits} unit{totalUnits !== 1 ? 's' : ''}</> : null}
                          {a.region ? <span style={{ color: "#bba", marginLeft: 6 }} title="Region the army's tile resolves to (this is the region whose RegionInfo panel shows this army's roster).">in {a.region}</span> : null}
                          {a.logOnly ? <span style={{ color: "#88a", marginLeft: 6 }}>(log-tracked)</span> : a.liveTracked ? <span style={{ color: "#4a8", marginLeft: 6 }} title="Position updated from the live log, not the save">(live)</span> : null}
                        </div>
                      </>;
                    })()}
                    {typeof hoveredArmy.army.movementPoints === "number" ? (
                      <div style={{ color: "#9c8", fontSize: "0.78rem", marginBottom: 4 }}
                        title="Movement points remaining (f32 at bodyguard unit's commanderUuid+4 in the save; decoded 2026-05-10). 1 tile costs ~7.4 MP.">
                        MP remaining: <span style={{ fontVariantNumeric: "tabular-nums" }}>{hoveredArmy.army.movementPoints.toFixed(1)}</span>
                        {hoveredArmy.army.moved ? (
                          <span style={{ color: "#aaa", marginLeft: 6, fontStyle: "italic" }} title="Moved-this-turn flag set (bit 7 of byte +9 in the character-position record). The general has already issued at least one move this turn.">· moved this turn</span>
                        ) : null}
                      </div>
                    ) : hoveredArmy.army.moved ? (
                      <div style={{ color: "#aaa", fontSize: "0.78rem", marginBottom: 4, fontStyle: "italic" }}
                        title="Moved-this-turn flag set (bit 7 of byte +9 in the character-position record).">
                        moved this turn
                      </div>
                    ) : null}
                    {hoveredArmy.army.passengers && hoveredArmy.army.passengers.length > 0 ? (
                      <div style={{ color: "#aaa", fontSize: "0.76rem", marginBottom: 4, paddingLeft: 6 }}>
                        with {hoveredArmy.army.passengers.map(p => (typeof p === 'string' ? p : (p.firstName || p.name || ''))).filter(Boolean).join(", ")}
                      </div>
                    ) : null}
                    {hoveredArmy.army.traits && hoveredArmy.army.traits.length > 0 ? (() => {
                      const keyTraits = hoveredArmy.army.traits.filter(t =>
                        /^(Factionleader|Factionheir|GoodCommander|NaturalMilitarySkill|GoodAdministrator|GoodAttacker|GoodDefender|BattleScarred|Brave|Intelligent|Loyal)$/.test(t.name)
                      ).slice(0, 4);
                      if (keyTraits.length === 0) return null;
                      return (
                        <div style={{ color: "#9ab", fontSize: "0.72rem", marginTop: 4, paddingLeft: 6 }}>
                          {keyTraits.map(t => `${t.name.replace(/([A-Z])/g, ' $1').trim()}${t.level > 0 ? ` ${t.level}` : ''}`).join(" · ")}
                        </div>
                      );
                    })() : null}
                    {(() => {
                      // Merge unit lists using the same flow-event +
                      // coord-fallback rule as the header above.
                      const a = hoveredArmy.army;
                      const mergedUnits = [...(a.units || [])];
                      const targetSec = a.commanderUuid
                        ? (mergedPairsBySecondary.get(a.commanderUuid) || a.commanderUuid)
                        : null;
                      for (const other of (armiesToRender || [])) {
                        if (other === a) continue;
                        if (!other.faction || !a.faction) continue;
                        if (other.faction.toLowerCase() !== a.faction.toLowerCase()) continue;
                        let isMerge = false;
                        if (targetSec && other.commanderUuid) {
                          const otherTarget = mergedPairsBySecondary.get(other.commanderUuid) || other.commanderUuid;
                          if (otherTarget === targetSec) isMerge = true;
                        }
                        if (!isMerge && typeof a.x === "number" && typeof a.y === "number" && other.x === a.x && other.y === a.y) {
                          isMerge = true;
                        }
                        if (!isMerge) continue;
                        if (Array.isArray(other.units)) mergedUnits.push(...other.units);
                      }
                      return <>
                        {mergedUnits.slice(0, 12).map((u, i) => {
                          const uname = typeof u === 'string' ? u : (u.name || '');
                          const soldiers = typeof u === 'object' ? u.soldiers : null;
                          const maxSoldiers = typeof u === 'object' ? u.maxSoldiers : null;
                          return (
                            <div key={i} style={{ color: "#ddd", paddingLeft: 6, display: "flex", justifyContent: "space-between", gap: 8 }}>
                              <span>{uname.replace(/_/g, " ")}</span>
                              {typeof soldiers === 'number' && typeof maxSoldiers === 'number' && maxSoldiers > 0 ? (
                                <span style={{ color: "#9ba", fontVariantNumeric: "tabular-nums" }}>{soldiers}/{maxSoldiers}</span>
                              ) : null}
                            </div>
                          );
                        })}
                        {mergedUnits.length > 12 ? (
                          <div style={{ color: "#999", paddingLeft: 6, fontStyle: "italic" }}>
                            … +{mergedUnits.length - 12} more
                          </div>
                        ) : null}
                      </>;
                    })()}
                  </div>
                  );
                })()}

                {/* City label hover tooltip — hidden when resource tooltip is showing */}
                {hoveredCity && !hoveredResource && (
                  <div style={{
                    position: "absolute",
                    left: hoveredCity.screenX + 28,
                    top: hoveredCity.screenY - 20,
                    background: "rgba(20,20,20,0.92)",
                    color: "#f7f7f7",
                    padding: "4px 8px",
                    borderRadius: 6,
                    fontSize: "0.85rem",
                    pointerEvents: "none",
                    whiteSpace: "nowrap",
                    zIndex: 10,
                    border: "1px solid #555",
                  }}>
                    <strong>{hoveredCity.city}</strong>
                    {hoveredCity.tier !== "unknown" && <> &mdash; {hoveredCity.tier.replace(/_/g, " ")}</>}
                    <br /><span style={{ fontSize: "0.75rem", color: "#aaa" }}>x: {hoveredCity.x}, y: {imgSize.height - 1 - hoveredCity.y}</span>
                  </div>
                )}

                {/* Resource hover tooltip (merged with label info when labels are on) */}
                {hoveredResource && (
                  <div style={{
                    position: "absolute",
                    left: hoveredResource.screenX + 28,
                    top: hoveredResource.screenY - 20,
                    background: "rgba(20,20,20,0.92)",
                    color: "#f7f7f7",
                    padding: "4px 8px",
                    borderRadius: 6,
                    fontSize: "0.85rem",
                    pointerEvents: "none",
                    whiteSpace: "nowrap",
                    zIndex: 10,
                    border: "1px solid #555",
                  }}>
                    {hoveredResource.regionName && (
                      <div style={{ marginBottom: 2, color: "#bbb", fontSize: "0.75rem" }}>
                        {hoveredResource.regionName}
                      </div>
                    )}
                    <strong>{hoveredResource.type.replace(/_/g, " ")}</strong>
                    {hoveredResource.amount != null && <> &times; {hoveredResource.amount}</>}
                    {devMode && hoveredResource.resX != null && <><br /><span style={{ fontSize: "0.75rem", color: "#aaa" }}>x: {hoveredResource.resX}, y: {imgSize.height - hoveredResource.resY}</span></>}
                  </div>
                )}

                <div
                  className="zoom-controls"
                  style={{ position: "absolute", right: 12, bottom: 12, display: "flex", gap: 6, zIndex: welcomeHighlight === "region-info" ? 10001 : 2 }}
                >
                  <button className={"zoom-btn" + (welcomeHighlight === "region-info" ? " ws-ui-glow" : "")} title={lockedRegionInfo ? `Locked: ${lockedRegionInfo.region} — click to unlock` : "No region locked"}
                    onClick={() => lockedRegionInfo && setLockedRegionInfo(null)}
                    disabled={!lockedRegionInfo}
                    style={{ fontSize: "0.9rem", color: lockedRegionInfo ? "#dca64a" : "inherit", zIndex: welcomeHighlight === "region-info" ? 10001 : undefined, position: "relative" }}>
                    {lockedRegionInfo ? "🔒" : "🔓"}
                  </button>
                  <button className="zoom-btn" title="Export map as PNG" onClick={handleScreenshot} style={{ fontSize: "1rem" }}>
                    📷
                  </button>
                  <button className="zoom-btn" title="Zoom out" onClick={zoomOut} disabled={zoom <= minZoom}>
                    −
                  </button>
                  <button
                    className="zoom-btn"
                    title="Reset view"
                    onClick={resetZoom}
                    disabled={zoom === 1 && offset.x === 0 && offset.y === 0}
                    aria-label="Reset view"
                  >
                    <img
                      src={(import.meta.env.BASE_URL || "./") + "/reset-alt.svg"}
                      alt="Reset"
                      width={18}
                      height={18}
                      style={{ display: "block", filter: isDark ? "invert(1)" : "none" }}
                      draggable={false}
                    />
                  </button>
                  <button className="zoom-btn" title="Zoom in" onClick={zoomIn} disabled={zoom >= maxZoom}>
                    +
                  </button>
                </div>
                {/* Minimap */}
                <div style={{
                  position: "absolute",
                  bottom: 8,
                  left: 8,
                  zIndex: 3,
                  borderRadius: 8,
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.15)",
                  opacity: 0.9,
                  boxShadow: "0 2px 12px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.3)",
                  cursor: "pointer",
                }}
                  onMouseDown={(e) => {
                    minimapDragging.current = true;
                    const mm = minimapRef.current;
                    if (!mm) return;
                    const rect = mm.getBoundingClientRect();
                    const mmScale = MINIMAP_W / imgSize.width;
                    const mapX = (e.clientX - rect.left) / mmScale;
                    const mapY = (e.clientY - rect.top) / mmScale;
                    const { scale } = computeTransform();
                    const ts = scale * zoom;
                    const bx = (canvasSize.width - imgSize.width * ts) / 2;
                    const by = (canvasSize.height - imgSize.height * ts) / 2;
                    setOffset(clampOffset({ x: canvasSize.width / 2 - mapX * ts - bx, y: canvasSize.height / 2 - mapY * ts - by }));
                  }}
                  onMouseMove={(e) => {
                    if (!minimapDragging.current) return;
                    const mm = minimapRef.current;
                    if (!mm) return;
                    const rect = mm.getBoundingClientRect();
                    const mmScale = MINIMAP_W / imgSize.width;
                    const mapX = (e.clientX - rect.left) / mmScale;
                    const mapY = (e.clientY - rect.top) / mmScale;
                    const { scale } = computeTransform();
                    const ts = scale * zoom;
                    const bx = (canvasSize.width - imgSize.width * ts) / 2;
                    const by = (canvasSize.height - imgSize.height * ts) / 2;
                    setOffset(clampOffset({ x: canvasSize.width / 2 - mapX * ts - bx, y: canvasSize.height / 2 - mapY * ts - by }));
                  }}
                  onMouseUp={() => { minimapDragging.current = false; }}
                  onMouseLeave={() => { minimapDragging.current = false; }}
                >
                  <canvas ref={minimapRef} style={{ display: "block" }} />
                </div>
                {/* Keyboard hint */}
                <div style={{
                  position: "absolute", left: 8 + MINIMAP_W + 12, bottom: 10,
                  fontSize: "0.76rem", color: "rgba(255,255,255,0.55)", pointerEvents: "none", lineHeight: 1.4,
                  padding: "5px 14px", borderRadius: 20,
                  background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  letterSpacing: "0.02em",
                }}>
                  Arrows: pan · Scroll: zoom · Shift+click: multi-select · Esc: clear
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div
              style={{
                position: "absolute",
                top: MAP_PADDING,
                left: MAP_PADDING + canvasSize.width + PANELS_GAP,
                width: rightColWidth,
                height: canvasSize.height,
                display: "grid",
                gridTemplateColumns: `${Math.max(0, Math.floor(factionPanelTargetWidth))}px 1fr`,
                columnGap: PANELS_GAP,
                boxSizing: "border-box",
                zIndex: welcomeHighlight === "factions" ? 10001 : undefined,
              }}
            >
              <CustomScrollArea
                className={"panel panel-tight factions-panel" + (welcomeHighlight === "factions" ? " ws-ui-glow" : "")}
                /* CSS mask fades out partial row at bottom */
                style={{ width: "100%", height: "100%" }}
                skin={SCROLL_SKIN} railInset={{ top: 40, bottom: 40 }}
                trackWidth={SCROLLBAR_GUTTER} railWidth={4} thumbWidth={16}
                thumbMin={THUMB_MIN_PX} ariaLabel="Factions"
              >
                {renderFactionSelector()}
              </CustomScrollArea>

              <div style={{ display: "flex", flexDirection: "column", gap: PANELS_GAP, height: "100%", overflow: "hidden" }}>
                {/* Search bar */}
                <div className="panel" style={{ padding: "8px 10px", flexShrink: 0 }}>
                  {renderSearch()}
                </div>

                {/* Recently-viewed regions backstack */}
                {recentRegions.length > 0 && (
                  <div className="panel" style={{ padding: "6px 10px", flexShrink: 0 }}>
                    <div style={{
                      fontWeight: 700, fontSize: "0.78rem", marginBottom: 4, color: "#dca64a",
                      display: "flex", justifyContent: "space-between", alignItems: "baseline",
                    }}>
                      <span>↶ Recent</span>
                      <span
                        onClick={() => setRecentRegions([])}
                        title="Clear recent regions"
                        style={{ fontSize: "0.7rem", fontWeight: 400, opacity: 0.7, cursor: "pointer" }}
                      >clear</span>
                    </div>
                    <div className="resource-panel-scroll" style={{
                      display: "flex", flexWrap: "nowrap", gap: 4,
                      overflowX: "auto", overflowY: "hidden", paddingBottom: 2,
                      scrollbarWidth: "none",
                    }}>
                      {recentRegions.map(key => {
                        const r = regions[key];
                        if (!r) return null;
                        const label = r.city || r.region || key;
                        const isLocked = lockedRegionInfo?.rgb === key;
                        return (
                          <button
                            key={key}
                            onClick={() => jumpToPin({ key, label })}
                            title={r.region && r.city ? `${r.region} (${r.city})` : label}
                            style={{
                              padding: "2px 8px", borderRadius: 5,
                              border: isLocked ? "1px solid #dca64a" : "1px solid #555",
                              background: isLocked ? "rgba(220,166,74,0.18)" : "rgba(255,255,255,0.06)",
                              color: isLocked ? "#dca64a" : "#ddd",
                              cursor: "pointer", fontSize: "0.74rem",
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Pinned regions */}
                {pinnedRegions.length > 0 && (
                  <div className="panel" style={{ padding: "8px 10px", flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 5, color: "#dca64a" }}>📌 Pinned Regions</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 6px" }}>
                      {pinnedRegions.map(pin => (
                        <div key={pin.key} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                          <button
                            onClick={() => jumpToPin(pin)}
                            style={{ padding: "2px 8px", borderRadius: 5, border: "1px solid #777",
                              background: "rgba(255,255,255,0.1)", color: "#eee", cursor: "pointer", fontSize: "0.78rem" }}
                          >
                            {pin.label}
                          </button>
                          <button
                            onClick={() => setPinnedRegions(prev => prev.filter(p => p.key !== pin.key))}
                            title="Unpin"
                            style={{ padding: "2px 5px", borderRadius: 5, border: "1px solid #555",
                              background: "transparent", color: "#aaa", cursor: "pointer", fontSize: "0.75rem", lineHeight: 1 }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Selected provinces / faction summary */}
                <CustomScrollArea
                  className="panel"
                  style={{ width: "100%", flex: 1, minHeight: 0 }}
                  skin={SCROLL_SKIN} railInset={{ top: 40, bottom: 40 }}
                  trackWidth={SCROLLBAR_GUTTER} railWidth={4} thumbWidth={16}
                  thumbMin={THUMB_MIN_PX} ariaLabel="Selected provinces"
                >
                  <div style={{ marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                      {isVictoryMode ? "Victory target regions:" : "Selected Provinces:"}
                    </span>
                    {devMode && isVictoryMode && mapCampaign === "imperial" && (
                      <div style={{ display: "flex", gap: 4 }}>
                        {!portedVictory && (
                          <button
                            onClick={portClassicVictory}
                            style={{ fontSize: "0.7rem", padding: "2px 8px", borderRadius: 5,
                              border: "1px solid #e8a030", background: "rgba(232,160,48,0.15)",
                              color: "#e8a030", cursor: "pointer", fontWeight: 600 }}
                            title="Map classic campaign victory conditions to imperial regions using coordinate overlap"
                          >Port from Classic</button>
                        )}
                        {portedVictory && (
                          <button
                            onClick={togglePortedVictory}
                            style={{ fontSize: "0.7rem", padding: "2px 8px", borderRadius: 5,
                              border: "1px solid " + (showPortedVictory ? "#e8a030" : "#888"),
                              background: showPortedVictory ? "rgba(232,160,48,0.3)" : "transparent",
                              color: showPortedVictory ? "#e8a030" : "#aaa", cursor: "pointer", fontWeight: 600 }}
                            title="Toggle between ported classic and original victory conditions"
                          >{showPortedVictory ? "Ported (ON)" : "Ported (OFF)"}</button>
                        )}
                      </div>
                    )}
                  </div>
                  {showFactionSummary && selectedProvinces.length > 0
                    ? renderFactionSummary()
                    : renderSelectedProvincesList()}
                  {selectedProvinces.length > 0 && (
                    <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                      <button
                        onClick={() => setShowFactionSummary((s) => !s)}
                        style={{ flex: 1, fontSize: "0.8rem", padding: "3px 10px", borderRadius: 6,
                          border: "1px solid #888", cursor: "pointer",
                          background: showFactionSummary ? "#dca64a" : "transparent",
                          color: showFactionSummary ? "#221" : "inherit" }}
                        title="Toggle faction summary"
                      >
                        {showFactionSummary ? "Hide Summary" : "Summary"}
                      </button>
                      {devMode && <button
                        onClick={() => {
                          const names = selectedProvinces
                            .map(k => regions[k]?.city || regions[k]?.region)
                            .filter(Boolean);
                          navigator.clipboard.writeText(names.join("\n"))
                            .then(() => {
                              const btn = document.activeElement;
                              if (btn) { const orig = btn.textContent; btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = orig; }, 1200); }
                            });
                        }}
                        style={{ flex: 1, fontSize: "0.8rem", padding: "3px 10px", borderRadius: 6,
                          border: "1px solid #888", cursor: "pointer",
                          background: "transparent", color: "inherit" }}
                        title="Copy selected province names to clipboard"
                      >
                        Copy List
                      </button>}
                    </div>
                  )}
                </CustomScrollArea>
              </div>
            </div>

            {/* REGION INFO PANEL — fixed at bottom, doesn't move with map */}
            <div
              style={{
                position: "fixed",
                left: MAP_PADDING,
                right: MAP_PADDING,
                bottom: MAP_PADDING,
                height: REGIONINFO_HEIGHT,
                zIndex: welcomeHighlight === "region-info" ? 10001 : 2,
              }}
            >
              <CustomScrollArea
                className={"panel" + (welcomeHighlight === "region-info" ? " ws-ui-glow" : "")}
                style={{ width: "100%", height: "100%" }}
                skin={SCROLL_SKIN} railInset={{ top: 40, bottom: 40 }}
                trackWidth={SCROLLBAR_GUTTER} railWidth={4} thumbWidth={16}
                thumbMin={THUMB_MIN_PX} ariaLabel="Region information"
              >
                {(lockedRegionInfo || regionInfo) ? (
                  <div className="region-info">
                    <RegionInfo
                      info={lockedRegionInfo || regionInfo}
                      modeExtra={getModeExtra(lockedRegionInfo || regionInfo)}
                      devMode={devMode}
                      onShowInfo={setInfoPopup}
                      modIconsDir={modIconsDir}
                      onFactionRightClick={({ factionId, displayName }) => {
                        setInfoPopup({
                          type: "faction",
                          factionId,
                          name: factionId,
                          label: displayName,
                          modIconsDir,
                        });
                      }}
                      factionDisplayNames={factionDisplayNames}
                      homelandFactions={(() => {
                        // Factions whose homeland token (from homelands.json)
                        // is in this region's tag list. Used by RegionInfo
                        // for the "Homeland of:" row — surfaces RIS's
                        // homeland-unhappiness mechanic so non-natives
                        // immediately see where they'll catch flak.
                        const r = lockedRegionInfo || regionInfo;
                        if (!r || !homelandsData) return null;
                        const tags = new Set(String(r.tags || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
                        const out = [];
                        for (const [fac, hrs] of Object.entries(homelandsData)) {
                          for (const hr of hrs || []) {
                            if (tags.has(String(hr).toLowerCase())) { out.push(fac); break; }
                          }
                        }
                        return out;
                      })()}
                      // Compute buildings here so React re-renders when save state
                      // changes (RegionInfo's internal useMemo can't see those).
                      buildings={(() => {
                        const r = lockedRegionInfo || regionInfo;
                        if (!r) return null;
                        try { return getBuildings(r); }
                        catch { return null; }
                      })()}
                      garrisonCommander={(() => {
                        const r = lockedRegionInfo || regionInfo;
                        if (!r) return null;
                        // Non-live mode (or live mode while save is still
                        // parsing): pull the starting garrison commander
                        // from the bundled descr_strat data so the panel
                        // never looks broken in the load gap.
                        const liveGovReady = saveGovernorByCity && Object.keys(saveGovernorByCity).length > 0;
                        if (!liveLogActive || !liveGovReady) {
                          const reg = startingArmiesByRegion?.[r.region];
                          if (!reg) return null;
                          const gar = (reg.garrison || []).find((g) => {
                            const nm = (g.character || "").toLowerCase();
                            return nm && !nm.startsWith("garrison of") && nm !== "biggus dickus";
                          });
                          if (!gar) return null;
                          return {
                            character: gar.character,
                            faction: gar.faction || null,
                            age: gar.age ?? null,
                            isLeader: Array.isArray(gar.tags) && gar.tags.includes("leader"),
                            isHeir: Array.isArray(gar.tags) && gar.tags.includes("heir"),
                          };
                        }
                        // Source of truth: the per-settlement governor field
                        // (decoded at marker-1940). This works even for
                        // characters who don't command a bodyguard army
                        // (= no unit-record link), which the previous
                        // settlement-tile-coord match couldn't see.
                        if (saveGovernorByCity && r.city) {
                          const g = saveGovernorByCity[r.city];
                          if (g && !g.unresolved) {
                            const owner = (currentOwnerByCity && currentOwnerByCity[r.city]) || r.faction || null;
                            // Locate the governor's bodyguard unit. The
                            // unit-record region is whatever tile the
                            // bodyguard currently stands on, which can lag
                            // behind the governor's appointment (e.g. the
                            // governor moves to a neighbour and the unit
                            // record's region updates to that neighbour).
                            // So we search ALL regions for a unit whose
                            // commanderUuid matches the governor's uuid —
                            // this guarantees we attach the bodyguard to
                            // the appointed governor regardless of where
                            // the unit is physically parked.
                            let bodyguard = null;
                            let bodyguardRegion = null;
                            // Prefer liveUnitsByRegion — the unit-record's
                            // `region` field is stale after a move (RTW
                            // doesn't update it when a general moves), so
                            // the raw saveUnitsByRegion would always say
                            // the bodyguard is at the pre-move tile.
                            // liveUnitsByRegion re-buckets armies on a
                            // settlement tile to the resolved region
                            // (0.9.305+), so for a governor that's
                            // actually at his city, the bodyguard lands
                            // there too — and bodyguardRegion ends up
                            // matching r.region (no misleading message).
                            const unitSource = liveUnitsByRegion || saveUnitsByRegion;
                            if (g.uuid && unitSource) {
                              for (const [reg, arr] of Object.entries(unitSource)) {
                                for (const u of arr) {
                                  if (u.commanderUuid === g.uuid) {
                                    bodyguard = u;
                                    bodyguardRegion = reg;
                                    break;
                                  }
                                }
                                if (bodyguard) break;
                              }
                            }
                            return {
                              character: g.lastName
                                ? `${g.firstName} ${g.lastName.replace(/_/g, " ")}`
                                : g.firstName,
                              faction: owner,
                              age: g.age,
                              isLeader: g.isLeader,
                              isHeir: g.isHeir,
                              bodyguardUnit: bodyguard ? bodyguard.name : null,
                              bodyguardSoldiers: bodyguard ? bodyguard.soldiers : null,
                              bodyguardMax: bodyguard ? bodyguard.maxSoldiers : null,
                              bodyguardRegion: bodyguardRegion !== r.region ? bodyguardRegion : null,
                            };
                          }
                          if (g && g.unresolved) {
                            // Save says there's a governor but our v1 char
                            // pool doesn't have a name for the uuid (timing
                            // race, or RIS-imperial auto-generated char that
                            // v1 can't decode). Use the descr_strat starting
                            // garrison name as a best-effort label — it's
                            // accurate at turn 1 and stays useful as a
                            // "started here as" hint at later turns.
                            const reg = startingArmiesByRegion?.[r.region];
                            const gar = reg && (reg.garrison || []).find((g2) => {
                              const nm = (g2.character || "").toLowerCase();
                              return nm && !nm.startsWith("garrison of") && nm !== "biggus dickus";
                            });
                            if (gar) {
                              return {
                                character: gar.character,
                                faction: gar.faction || (currentOwnerByCity && currentOwnerByCity[r.city]) || r.faction || null,
                                age: gar.age ?? null,
                                isLeader: Array.isArray(gar.tags) && gar.tags.includes("leader"),
                                isHeir: Array.isArray(gar.tags) && gar.tags.includes("heir"),
                              };
                            }
                            return {
                              character: "(governor — character record not decoded)",
                              faction: (currentOwnerByCity && currentOwnerByCity[r.city]) || r.faction || null,
                            };
                          }
                        }
                        // Legacy fallback: settlement-tile coord match.
                        // (Same y-flip rationale as the garrison block.)
                        let settlementTile = startingArmiesByRegion?.[r.region]?.settlement || null;
                        if (!settlementTile && cityPixels && cityPixels.length) {
                          const cp = cityPixels.find(p => regions[p.rgbKey]?.region === r.region);
                          if (cp) settlementTile = { x: cp.x, y: (imgSize.height - 1) - cp.y };
                        }
                        if (!settlementTile) return null;
                        for (const list of Object.values(saveCharactersByRegion || {})) {
                          for (const c of list) {
                            if (c.x === settlementTile.x && c.y === settlementTile.y && c.secondaryUuid) {
                              return {
                                character: c.lastName
                                  ? `${c.firstName} ${c.lastName.replace(/_/g, " ")}`
                                  : c.firstName,
                                faction: c.faction || null,
                              };
                            }
                          }
                        }
                        return null;
                      })()}
                      garrison={(() => {
                        // Live mode: use the save-file parser data (fresh =
                        // saveUnitsByRegion, legacy = saveArmiesData fallback).
                        // Non-live: fall back to startingArmiesByRegion — the
                        // descr_strat turn-0 garrison resolved to regions
                        // during import.
                        const r = lockedRegionInfo || regionInfo;
                        if (!r) return null;
                        let normalised = null;
                        // Live mode is on but live data hasn't loaded yet
                        // (save parse takes a few seconds). Fall back to
                        // the descr_strat starting garrison so the panel
                        // never looks broken in the gap.
                        const liveDataReady = saveUnitsByRegion && Object.keys(saveUnitsByRegion).length > 0;
                        if (liveLogActive && liveDataReady) {
                          // liveUnitsByRegion re-buckets save units by each
                          // commander's CURRENT region (from log-position
                          // events), so an army that moved mid-turn shows
                          // up under its destination region's panel as
                          // soon as the log fires the move event — same
                          // as the map markers, no save snapshot required.
                          const fresh = liveUnitsByRegion?.[r.region];
                          const legacy = saveArmiesData?.[r.region] || saveArmiesData?.[r.city];
                          const rawFresh = fresh || null;
                          // Coord-based garrison definition: units whose
                          // commander is at the settlement tile, plus units
                          // with no commander (generic garrison defenders).
                          // Prefer the pre-bundled `startingArmiesByRegion`
                          // settlement coords. Fall back to cityPixels (the
                          // black-pixel position derived from the map TGA),
                          // which is always available — fixes regions like
                          // Poseidonia whose bundled armies file uses the
                          // older flat format with no per-region settlement.
                          let settlementTile = startingArmiesByRegion?.[r.region]?.settlement || null;
                          if (!settlementTile && cityPixels && cityPixels.length) {
                            const cp = cityPixels.find(p => regions[p.rgbKey]?.region === r.region);
                            // cityPixels.y is TOP-DOWN; army positions are
                            // BOTTOM-UP world coords. Flip when building
                            // the settlement tile so settlementTile.y
                            // matches army.y for exact comparison below.
                            if (cp) settlementTile = { x: cp.x, y: (imgSize.height - 1) - cp.y };
                          }
                          const charByUuid = new Map();
                          for (const list of Object.values(saveCharactersByRegion || {})) {
                            for (const c of list) { if (c.secondaryUuid) charByUuid.set(c.secondaryUuid, c); }
                          }
                          if (rawFresh) {
                            // Garrison = (a) commander-LESS units AND
                            // (b) units commanded by the appointed
                            // governor AND (c) units whose commander is
                            // standing on the settlement tile WITH the
                            // same faction as the region owner.
                            //
                            // The faction guard on (c) excludes besiegers
                            // / passers-through whose stack happens to
                            // sit on the settlement tile (or whose live
                            // log position resolved to it incorrectly).
                            // Without it the user saw foreign Roman
                            // bodyguards (Marcus Ogulnius_Gallus 55, etc.)
                            // in messapian-held Brundisium's garrison
                            // because the live-position attribution had
                            // pulled them into that bucket.
                            const ownerFaction = ((currentOwnerByCity && currentOwnerByCity[r.city])
                              || (initialOwnerByCity && initialOwnerByCity[r.city])
                              || r.faction || "").toLowerCase();
                            const governorUuid = (saveGovernorByCity && r.city && saveGovernorByCity[r.city] && !saveGovernorByCity[r.city].unresolved)
                              ? saveGovernorByCity[r.city].uuid
                              : null;
                            const cmdsAtSettlement = new Set();
                            const cmdToFaction = new Map();
                            for (const a of (armiesToRender || [])) {
                              if (a.commanderUuid && a.faction) cmdToFaction.set(a.commanderUuid, a.faction.toLowerCase());
                            }
                            if (settlementTile) {
                              for (const a of (armiesToRender || [])) {
                                if (!a.commanderUuid) continue;
                                if (a.x !== settlementTile.x || a.y !== settlementTile.y) continue;
                                if (ownerFaction && a.faction && a.faction.toLowerCase() !== ownerFaction) continue;
                                cmdsAtSettlement.add(a.commanderUuid);
                              }
                            }
                            // For commanded units the commander's faction
                            // must match the region owner — keeps a Roman
                            // siege bodyguard from showing up in a
                            // messapian city's defender list even when
                            // his live position resolves to that region.
                            const sameFaction = (cmd) => {
                              if (!cmd || !ownerFaction) return false;
                              const f = cmdToFaction.get(cmd);
                              return f && f === ownerFaction;
                            };
                            normalised = rawFresh
                              .filter((u) => {
                                if (!u.commanderUuid && !u.inferredCmd) return true;
                                if (governorUuid && (u.commanderUuid === governorUuid || u.inferredCmd === governorUuid)) return true;
                                if (cmdsAtSettlement.has(u.commanderUuid) || cmdsAtSettlement.has(u.inferredCmd)) return true;
                                // Final inclusive case: any commanded unit
                                // whose commander's faction matches the
                                // region owner is part of the city's
                                // defence. Keeps friendly stacks
                                // co-located with defenders inside.
                                if (sameFaction(u.commanderUuid) || sameFaction(u.inferredCmd)) return true;
                                return false;
                              })
                              .map((u) => ({
                                unit: u.name,
                                soldiers: u.soldiers,
                                max: u.maxSoldiers,
                                // Live XP / weapon / armour read directly from
                                // the save record (save-cracker session 10:
                                // u8 at regionEnd+20 / +17 / +16). Replaces
                                // the descr_strat seed fallback used here
                                // before, which missed mid-campaign recruits
                                // and just-fought chevron gains.
                                xp: u.xp || 0,
                                weapon: u.weapon || 0,
                                armour: u.armour || 0,
                              }));
                          } else if (legacy) {
                            normalised = legacy.map((u) => ({
                              unit: typeof u === "string" ? u : (u.unit || u.name),
                              soldiers: u.soldiers ?? null,
                              max: u.max ?? u.maxSoldiers ?? null,
                            }));
                          }
                          // Seed exp/armour/weapon from the bundled
                          // starting_armies_<suffix>.json — ONLY for units
                          // that the save didn't already provide a value for
                          // (legacy path / mid-campaign recruits absent from
                          // descr_strat). The fresh path above already reads
                          // live values from the unit record, so we don't
                          // overwrite them.
                          if (normalised && normalised.length > 0) {
                            const startingByName = new Map();
                            const startingArms = startingArmiesByRegion?.[r.region]?.garrison || [];
                            for (const a of startingArms) {
                              for (const u of a.units || []) {
                                if (!startingByName.has(u.name)) startingByName.set(u.name, []);
                                startingByName.get(u.name).push(u);
                              }
                            }
                            normalised = normalised.map((u) => {
                              const queue = startingByName.get(u.unit);
                              const seed = queue && queue.length ? queue.shift() : null;
                              return {
                                ...u,
                                xp: u.xp || seed?.exp || 0,
                                armour: u.armour || seed?.armour || 0,
                                weapon: u.weapon || seed?.weapon || 0,
                              };
                            });
                          }
                        } else {
                          // startingArmiesByRegion is now { region: {
                          //   garrison: [armies], field: [armies] } }. The
                          // garrison prop shows only units on the settlement
                          // tile; field armies render in a separate section.
                          const regData = startingArmiesByRegion?.[r.region];
                          const garrisonArmies = regData?.garrison || [];
                          if (garrisonArmies.length > 0) {
                            normalised = [];
                            for (const a of garrisonArmies) {
                              for (const u of a.units || []) {
                                normalised.push({
                                  unit: u.name,
                                  xp: u.exp || 0,
                                  armour: u.armour || 0,
                                  weapon: u.weapon || 0,
                                });
                              }
                            }
                          }
                        }
                        if (!normalised || normalised.length === 0) return null;
                        const ownerId =
                          (currentOwnerByCity && currentOwnerByCity[r.city])
                          || (initialOwnerByCity && initialOwnerByCity[r.city])
                          || r.faction;
                        if (ownerId) {
                          const dictMap = unitOwnership?.__dictionary || {};
                          const triples = normalised.map((u) => [ownerId, u.unit, dictMap[u.unit]]).filter(([, n]) => n);
                          prefetchUnitIcons(modDataDir, triples, () => setIconCacheVersion((v) => v + 1));
                        }
                        return normalised.map((u) => ({
                          ...u,
                          faction: ownerId,
                          icon: ownerId ? getCachedUnitIcon(ownerId, u.unit) : null,
                        }));
                      })()}
                      settlementTier={(() => {
                        // descr_strat settlement-level value (village/town/
                        // large_town/city/large_city/huge_city). Pulled from
                        // the precomputed settlementTierMap by rgb key.
                        const r = lockedRegionInfo || regionInfo;
                        if (!r || !r.rgb) return null;
                        return settlementTierMap[r.rgb] || null;
                      })()}
                      resources={(() => {
                        const r = lockedRegionInfo || regionInfo;
                        if (!r) return null;
                        return resourcesData[r.region] || resourcesData[r.city] || null;
                      })()}
                      resourceImages={resourceImages}
                      startingGarrison={(() => {
                        // Pass the descr_strat turn-0 garrison (units only) so
                        // RegionInfo can diff the live save's roster against
                        // it. Only meaningful when liveLogActive — without a
                        // save loaded, garrison IS startingGarrison so the diff
                        // is empty by definition.
                        if (!liveLogActive) return null;
                        const r = lockedRegionInfo || regionInfo;
                        if (!r) return null;
                        const arms = startingArmiesByRegion?.[r.region]?.garrison || [];
                        const out = [];
                        for (const a of arms) for (const u of a.units || []) out.push(u);
                        return out;
                      })()}
                      recruitable={(() => {
                        // Compute the union of recruit entries the city can
                        // currently train. RTW building chains are cumulative:
                        // owning level N satisfies the requirements for all
                        // levels 0..N in the same chain (army_barracks lets
                        // you train hastati/principes/triarii because the
                        // lower militia/city levels are implicitly still
                        // present). We therefore walk every level UP TO AND
                        // INCLUDING the current one in each built chain.
                        const r = lockedRegionInfo || regionInfo;
                        if (!r || !buildingRecruits) return null;
                        let builtList = null;
                        try { builtList = getBuildings(r, true); } catch {}
                        if (!builtList || builtList.length === 0) return null;
                        const ownerId = (
                          (currentOwnerByCity && currentOwnerByCity[r.city])
                          || (initialOwnerByCity && initialOwnerByCity[r.city])
                          || r.faction
                          || ""
                        ).toLowerCase();
                        const culture = factionCultures?.[ownerId] || null;
                        const seen = new Set();
                        const result = [];
                        // unit name → Set of chain types that expose it.
                        const gatedByMap = {};
                        // unit name → Set of hidden_resource names that gate it.
                        // Captured from positive `hidden_resource X` clauses in
                        // recruit rules. Lets RegionInfo light up recruits when
                        // the user hovers an HR chip in the tags row.
                        const hrGatesMap = {};
                        // upgrade-only unit name → [{chain, level}, ...]
                        const upgradeRequiresMap = {};
                        // Units added during the first (building-gated) pass —
                        // these are CURRENTLY recruitable. Second pass adds
                        // upgrade-only candidates without touching this set.
                        const availableSet = new Set();
                        for (const b of builtList) {
                          const lvls = buildingRecruits[b.type];
                          if (!lvls) continue;
                          // Levels in EDB order (low → high tier). buildingLevelsLookup
                          // is keyed by chain name. Trim to <= current level.
                          const allLevels = (buildingLevelsLookup && buildingLevelsLookup[b.type]) || null;
                          let levelsToCheck;
                          if (allLevels && allLevels.length > 0) {
                            const idx = allLevels.indexOf(b.level);
                            if (idx >= 0) {
                              levelsToCheck = allLevels.slice(0, idx + 1);
                            } else {
                              // Current level not found in the ordered list —
                              // fall back to whatever the level happens to be.
                              levelsToCheck = [b.level];
                            }
                          } else {
                            levelsToCheck = [b.level];
                          }
                          for (const lvl of levelsToCheck) {
                            const recs = lvls[lvl];
                            if (!recs) continue;
                            for (const rec of recs) {
                              // EDB recruit-level faction filter. RIS uses
                              // `factions { all, }` as a wildcard (every
                              // faction passes — narrowing happens via
                              // hidden_resource / `not factions { ... }`).
                              // Without the wildcard handling, AOR recruits
                              // (which dominate Seleucid's recruit pool)
                              // get rejected and many provinces show empty.
                              if (rec.factions && rec.factions.length > 0 && ownerId
                                  && !rec.factions.includes("all")
                                  && !rec.factions.includes(ownerId)
                                  && !rec.factions.includes(culture)) continue;
                              if (rec.requires) {
                                // Drop event-gated recruits where the player
                                // needs to TRIGGER a reform — but only the
                                // positive form (`major_event "X"`). The
                                // negative form (`not major_event "X"`) means
                                // "available BEFORE reform" — that's what
                                // gates pre-Marian Roman troops, dropping
                                // them was leaving Rome with only AOR units.
                                if (/(?<!\bnot\s)\bmajor_event\b/.test(rec.requires)) continue;
                                // Drop AI-only recruit lines. Many chains
                                // ship a `not is_player ... noisland` variant
                                // that hands the AI free units regardless of
                                // building progression. RIS Rorarii had 6+
                                // such lines; without filtering they showed
                                // up in every Roman city's recruit list.
                                if (/\bnot\s+is_player\b/.test(rec.requires)) continue;
                                // Negative faction filter.
                                if (/\bnot\s+factions\b/.test(rec.requires)) {
                                  const nm = rec.requires.match(/not\s+factions\s*\{\s*([^}]*)\}/);
                                  if (nm) {
                                    const excluded = nm[1].split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
                                    if (ownerId && excluded.includes(ownerId)) continue;
                                    if (culture && excluded.includes(culture)) continue;
                                  }
                                }
                                // hidden_resource <X> / not hidden_resource <Y>
                                // — evaluate against the region's tag list
                                // from descr_regions. Hidden resources are
                                // stored as plain tokens in the comma-separated
                                // tag list (e.g. "italic", "sicel", "merc_center").
                                // Without this Roman recruits at Pisae were
                                // dropped because every Roman recruit line has
                                // `hidden_resource italic` AND that's a valid
                                // requirement Pisae satisfies.
                                {
                                  const tagSet = new Set(
                                    String(r.tags || "")
                                      .split(",")
                                      .map(s => s.trim().toLowerCase())
                                      .filter(Boolean)
                                  );
                                  const reqs = rec.requires;
                                  // First check NEGATIVE requirements so we
                                  // reject before validating positives.
                                  const negRe = /\bnot\s+hidden_resource\s+(\S+)/g;
                                  let neg, hrOk = true;
                                  while ((neg = negRe.exec(reqs)) !== null) {
                                    if (tagSet.has(neg[1].toLowerCase())) { hrOk = false; break; }
                                  }
                                  if (!hrOk) continue;
                                  // Positive requirements: every `hidden_resource X`
                                  // (NOT preceded by `not`) must be in the tag set.
                                  // Strip the negative clauses from the search
                                  // so the regex doesn't match them.
                                  const positives = reqs.replace(/\bnot\s+hidden_resource\s+\S+/g, "");
                                  const posRe = /\bhidden_resource\s+(\S+)/g;
                                  let pos;
                                  while ((pos = posRe.exec(positives)) !== null) {
                                    if (!tagSet.has(pos[1].toLowerCase())) { hrOk = false; break; }
                                  }
                                  if (!hrOk) continue;
                                }
                                // Building / tier requirements. Two flavours:
                                //   - Tier aliases (mic_tier_2, gov_tier_3, colony_tier_1, culture_tier_2)
                                //     expand to one or more building_present_min_level clauses (OR-joined).
                                //   - Direct `building_present_min_level <chain> <level>` clauses.
                                // Both can be negated with `not`. Negation flips the satisfied check.
                                const aliasMap = buildingRecruits.__aliases || {};
                                // hasMinLevel(chain, level): does builtList satisfy this clause?
                                const hasMinLevel = (chain, level) => {
                                  const built = builtList.find(b => b.type === chain);
                                  if (!built) return false;
                                  // Bare `building_present X` clauses (captured
                                  // from aliases / direct requires with no
                                  // level) — any built level satisfies.
                                  if (level == null) return true;
                                  const order = (buildingLevelsLookup && buildingLevelsLookup[chain]) || null;
                                  if (!order) return built.level === level;
                                  const haveIdx = order.indexOf(built.level);
                                  const needIdx = order.indexOf(level);
                                  return haveIdx >= 0 && needIdx >= 0 && haveIdx >= needIdx;
                                };
                                const evalTierAlias = (tok) => {
                                  const branches = aliasMap[tok];
                                  if (!branches) return false; // unknown alias — treat as unsatisfied
                                  return branches.some(({ chain, level }) => hasMinLevel(chain, level));
                                };
                                let ok = true;
                                // 1) Tier aliases. Walk the requires string and capture each token
                                //    along with whether it's preceded by `not`.
                                {
                                  const re = /(\bnot\s+)?\b(mic_tier|gov_tier|colony_tier|culture_tier)_\d+\b/g;
                                  let m;
                                  while ((m = re.exec(rec.requires)) !== null) {
                                    const negated = !!m[1];
                                    const tok = m[0].replace(/^not\s+/, "");
                                    const sat = evalTierAlias(tok);
                                    if (negated ? sat : !sat) { ok = false; break; }
                                  }
                                }
                                if (!ok) continue;
                                // 2) Direct building_present_min_level clauses (with optional `not`).
                                {
                                  const re = /(\bnot\s+)?\bbuilding_present_min_level\s+(\S+)\s+(\S+)/g;
                                  let m;
                                  while ((m = re.exec(rec.requires)) !== null) {
                                    const negated = !!m[1];
                                    const sat = hasMinLevel(m[2], m[3]);
                                    if (negated ? sat : !sat) { ok = false; break; }
                                  }
                                }
                                if (!ok) continue;
                                // 3) Bare `building_present <chain>` (no level) — chain at any
                                //    built level satisfies. The `(?!_min_level)` negative
                                //    lookahead avoids re-matching `building_present_min_level`.
                                //    Skip the `queued` modifier (refers to build queue, not
                                //    built buildings — we have no queue data).
                                {
                                  const re = /(\bnot\s+)?\bbuilding_present(?!_min_level)\s+(\S+)(?:\s+(\w+))?/g;
                                  let m;
                                  while ((m = re.exec(rec.requires)) !== null) {
                                    if (m[3] === "queued") continue;
                                    const negated = !!m[1];
                                    const sat = hasMinLevel(m[2], null);
                                    if (negated ? sat : !sat) { ok = false; break; }
                                  }
                                }
                                if (!ok) continue;
                              }
                              // EDU ownership is the ground truth. RIS uses
                              // `ownership all` for AOR units — treat as
                              // wildcard, same as the EDB factions filter.
                              if (unitOwnership) {
                                const owners = unitOwnership[rec.unit];
                                if (!owners) continue;
                                if (ownerId
                                    && !owners.includes("all")
                                    && !owners.includes(ownerId)
                                    && !owners.includes(culture)) continue;
                              }
                              // Track which building chain gated this unit so
                              // RegionInfo can cross-highlight on hover. A
                              // unit can be reached via multiple chains (tier
                              // aliases or duplicate recruit lines); merge
                              // them into a Set per unit.
                              if (!seen.has(rec.unit)) {
                                seen.add(rec.unit);
                                result.push(rec.unit);
                              }
                              availableSet.add(rec.unit);
                              if (!gatedByMap[rec.unit]) gatedByMap[rec.unit] = new Set();
                              gatedByMap[rec.unit].add(b.type);
                              if (rec.requires) {
                                if (!hrGatesMap[rec.unit]) hrGatesMap[rec.unit] = new Set();
                                const positives = rec.requires.replace(/\bnot\s+hidden_resource\s+\S+/g, "");
                                for (const pm of positives.matchAll(/\bhidden_resource\s+(\S+)/g)) {
                                  hrGatesMap[rec.unit].add(pm[1].toLowerCase());
                                }
                              }
                            }
                          }
                        }
                        // Second pass: every unit the region COULD recruit
                        // if all building chains were upgraded to max — i.e.
                        // skip the building-present and tier-alias filters,
                        // but keep faction / hidden_resource / EDU ownership
                        // / negative-faction / not-is-player / major_event
                        // checks (these are not building-related). Used to
                        // render "future" recruits faded after the
                        // currently-available ones.
                        const tagSetForPotential = new Set(
                          String(r.tags || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
                        );
                        for (const chain of Object.keys(buildingRecruits)) {
                          if (chain === "__aliases") continue;
                          const lvls = buildingRecruits[chain];
                          if (!lvls || typeof lvls !== "object") continue;
                          for (const lvl of Object.keys(lvls)) {
                            const recs = lvls[lvl];
                            if (!recs) continue;
                            for (const rec of recs) {
                              if (rec.factions && rec.factions.length > 0 && ownerId
                                  && !rec.factions.includes("all")
                                  && !rec.factions.includes(ownerId)
                                  && !rec.factions.includes(culture)) continue;
                              if (rec.requires) {
                                if (/(?<!\bnot\s)\bmajor_event\b/.test(rec.requires) || /\bnot\s+is_player\b/.test(rec.requires)) continue;
                                const negFm = rec.requires.match(/not\s+factions\s*\{\s*([^}]*)\}/);
                                if (negFm) {
                                  const ex = negFm[1].split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
                                  if (ex.includes(ownerId) || ex.includes(culture)) continue;
                                }
                                let hrOk = true;
                                for (const m of rec.requires.matchAll(/\bnot\s+hidden_resource\s+(\S+)/g)) {
                                  if (tagSetForPotential.has(m[1].toLowerCase())) { hrOk = false; break; }
                                }
                                if (!hrOk) continue;
                                const positives = rec.requires.replace(/\bnot\s+hidden_resource\s+\S+/g, "");
                                for (const m of positives.matchAll(/\bhidden_resource\s+(\S+)/g)) {
                                  if (!tagSetForPotential.has(m[1].toLowerCase())) { hrOk = false; break; }
                                }
                                if (!hrOk) continue;
                              }
                              if (unitOwnership) {
                                const owners = unitOwnership[rec.unit];
                                if (!owners) continue;
                                if (ownerId
                                    && !owners.includes("all")
                                    && !owners.includes(ownerId)
                                    && !owners.includes(culture)) continue;
                              }
                              if (!seen.has(rec.unit)) {
                                seen.add(rec.unit);
                                result.push(rec.unit);
                              }
                              if (!gatedByMap[rec.unit]) gatedByMap[rec.unit] = new Set();
                              gatedByMap[rec.unit].add(chain);
                              if (rec.requires) {
                                if (!hrGatesMap[rec.unit]) hrGatesMap[rec.unit] = new Set();
                                const positives = rec.requires.replace(/\bnot\s+hidden_resource\s+\S+/g, "");
                                for (const pm of positives.matchAll(/\bhidden_resource\s+(\S+)/g)) {
                                  hrGatesMap[rec.unit].add(pm[1].toLowerCase());
                                }
                              }
                              // For upgrade-only units, capture every (chain,
                              // level) that would unlock them so we can show
                              // the cheapest upgrade path in the tooltip.
                              if (!availableSet.has(rec.unit)) {
                                if (!upgradeRequiresMap[rec.unit]) upgradeRequiresMap[rec.unit] = [];
                                upgradeRequiresMap[rec.unit].push({ chain, level: lvl });
                              }
                            }
                          }
                        }
                        if (result.length === 0) return null;
                        if (ownerId) {
                          const dictMap = unitOwnership?.__dictionary || {};
                          prefetchUnitIcons(modDataDir, result.map((n) => [ownerId, n, dictMap[n]]), () => setIconCacheVersion((v) => v + 1));
                        }
                        // Sort: currently-available first, then upgrade-only.
                        result.sort((a, b) => {
                          const aAvail = availableSet.has(a) ? 0 : 1;
                          const bAvail = availableSet.has(b) ? 0 : 1;
                          return aAvail - bAvail;
                        });
                        // Index of the built level within each chain's ladder
                        // — used to compute the cheapest upgrade option.
                        const builtChainIdx = {};
                        for (const b of builtList) {
                          const order = (buildingLevelsLookup && buildingLevelsLookup[b.type]) || null;
                          builtChainIdx[b.type] = order ? order.indexOf(b.level) : 0;
                        }
                        const computeUpgradeHint = (unit) => {
                          const opts = upgradeRequiresMap[unit];
                          if (!opts || opts.length === 0) return null;
                          // Score each (chain, level) by how many upgrades away
                          // it is from the current build state. Lower = closer
                          // to recruitable. If a chain isn't built at all the
                          // cost is needIdx + 1 (one extra step to construct
                          // the chain from scratch).
                          const scored = opts.map(({ chain, level }) => {
                            const order = (buildingLevelsLookup && buildingLevelsLookup[chain]) || null;
                            const needIdx = order ? order.indexOf(level) : 0;
                            const haveIdx = chain in builtChainIdx ? builtChainIdx[chain] : -1;
                            const gap = haveIdx >= 0 ? (needIdx - haveIdx) : (needIdx + 1);
                            return { chain, level, gap, alreadyBuilt: haveIdx >= 0 };
                          }).sort((a, b) => a.gap - b.gap);
                          const best = scored[0];
                          const chainLabel = best.chain.replace(/_/g, " ");
                          const levelLabel = best.level.replace(/_/g, " ");
                          return best.alreadyBuilt
                            ? `Upgrade ${chainLabel} → ${levelLabel}`
                            : `Build ${levelLabel} (${chainLabel})`;
                        };
                        return result.map((name) => ({
                          unit: name,
                          faction: ownerId,
                          icon: ownerId ? getCachedUnitIcon(ownerId, name) : null,
                          gatedBy: gatedByMap[name] ? [...gatedByMap[name]] : [],
                          hrGates: hrGatesMap[name] ? [...hrGatesMap[name]] : [],
                          available: availableSet.has(name),
                          upgradeHint: !availableSet.has(name) ? computeUpgradeHint(name) : null,
                        }));
                      })()}
                      fieldArmies={(() => {
                        // Live mode: use commander coords (extracted from
                        // the save's world-object records) to classify each
                        // army as garrison (on settlement tile), player's
                        // own field army, or foreign. Falls back to EDU-
                        // ownership heuristic when coords aren't available.
                        // If live mode is on but live data hasn't loaded
                        // yet, fall through to the non-live path so the
                        // panel never looks empty during save-parse.
                        const liveDataReady = saveUnitsByRegion && Object.keys(saveUnitsByRegion).length > 0;
                        if (liveLogActive && liveDataReady) {
                          const r = lockedRegionInfo || regionInfo;
                          if (!r) return null;
                          // Same liveUnitsByRegion path as the Garrison
                          // panel — armies that moved mid-turn show up
                          // here under the destination region instead of
                          // their stale save-time region.
                          const raw = liveUnitsByRegion?.[r.region];
                          if (!raw || raw.length === 0) return null;
                          const ownerId = (
                            (currentOwnerByCity && currentOwnerByCity[r.city])
                            || (initialOwnerByCity && initialOwnerByCity[r.city])
                            || r.faction
                            || ""
                          ).toLowerCase();
                          const culture = factionCultures?.[ownerId] || null;
                          let settlementTile = startingArmiesByRegion?.[r.region]?.settlement || null;
                          if (!settlementTile && cityPixels && cityPixels.length) {
                            const cp = cityPixels.find(p => regions[p.rgbKey]?.region === r.region);
                            if (cp) settlementTile = { x: cp.x, y: cp.y };
                          }
                          const byCmd = new Map();
                          for (const u of raw) {
                            // Group by inferredCmd (sequential-grouping pass
                            // from main.js) so non-bodyguard units follow
                            // their stack's bodyguard rather than all
                            // falling into the cmd=0 garrison bucket.
                            // Fall back to raw commanderUuid if inference
                            // is absent (e.g. old save payload).
                            const key = u.inferredCmd || u.commanderUuid || 0;
                            if (!byCmd.has(key)) byCmd.set(key, []);
                            byCmd.get(key).push(u);
                          }
                          // Build uuid → character info (from save) for
                          // position and name lookup.
                          const charByUuid = new Map();
                          for (const list of Object.values(saveCharactersByRegion || {})) {
                            for (const c of list) {
                              if (c.secondaryUuid) charByUuid.set(c.secondaryUuid, c);
                            }
                          }
                          const ownerFactionOfUnits = (units) => {
                            if (!unitOwnership) return null;
                            for (const u of units) {
                              const o = unitOwnership[u.name];
                              if (o && (o.includes("all") || (ownerId && o.includes(ownerId)) || (culture && o.includes(culture)))) return "own";
                            }
                            for (const u of units) {
                              const o = unitOwnership[u.name];
                              if (o) return o.find((f) => f !== "slave" && f !== "mercs") || o[0];
                            }
                            return null;
                          };
                          // Merge unidentified commander groups into one
                          // "Unknown armies" bucket per faction — cleaner
                          // than dozens of "Army #XXX" single-unit entries
                          // when the save parser's character coverage is
                          // incomplete.
                          // The settlement's governor commands the
                          // garrison stack — those units now appear in the
                          // Garrison panel above. Skip the governor's group
                          // here so it doesn't also appear in "Region
                          // owners armies".
                          const governorUuidForFA = (saveGovernorByCity && r.city && saveGovernorByCity[r.city] && !saveGovernorByCity[r.city].unresolved)
                            ? saveGovernorByCity[r.city].uuid
                            : null;
                          // Same settlement-tile garrison promotion as the
                          // Garrison panel above — symmetrically skip
                          // commanders that ARE the garrison (own-faction
                          // stack on the settlement tile) so they don't
                          // double-list. Besiegers (foreign faction
                          // standing on or near the tile) are NOT
                          // garrison; they belong in this panel.
                          let settlementTileFA = startingArmiesByRegion?.[r.region]?.settlement || null;
                          if (!settlementTileFA && cityPixels && cityPixels.length) {
                            const cp = cityPixels.find(p => regions[p.rgbKey]?.region === r.region);
                            if (cp) settlementTileFA = { x: cp.x, y: (imgSize.height - 1) - cp.y };
                          }
                          const cmdsAtSettlementFA = new Set();
                          if (settlementTileFA) {
                            for (const a of (armiesToRender || [])) {
                              if (!a.commanderUuid) continue;
                              if (a.x !== settlementTileFA.x || a.y !== settlementTileFA.y) continue;
                              // Faction guard: only OWN-faction stacks on
                              // the tile count as garrison and get
                              // skipped here.
                              if (ownerId && a.faction && a.faction.toLowerCase() !== ownerId.toLowerCase()) continue;
                              cmdsAtSettlementFA.add(a.commanderUuid);
                            }
                          }
                          const mergedOwn = []; // identified own-faction armies
                          const mergedOthers = []; // identified foreign armies
                          const unknownByFaction = new Map(); // fac → units[]
                          // commanderUuid → "x,y" tile, for merging multi-general
                          // stacks. RTW armies hold up to 20 units, any number
                          // of which can be general units; when Marcus is
                          // transferred into Aulus's stack mid-turn, the save
                          // still records two separate cmd-grouped unit lists
                          // (the bodyguard unit's `cmd` field stays = Marcus's
                          // own char uuid). They share a tile, so merge by
                          // (faction, x, y).
                          const cmdPos = new Map();
                          const cmdLive = new Map(); // commanderUuid → bool (liveTracked or logOnly)
                          for (const a of (armiesToRender || [])) {
                            if (a.commanderUuid && typeof a.x === "number" && typeof a.y === "number") {
                              cmdPos.set(a.commanderUuid, `${a.x},${a.y}`);
                              cmdLive.set(a.commanderUuid, !!(a.liveTracked || a.logOnly));
                            }
                          }
                          for (const [cmd, units] of byCmd) {
                            if (!cmd) continue; // commander-less = Garrison panel
                            if (governorUuidForFA && cmd === governorUuidForFA) continue; // governor stack handled by Garrison panel
                            if (cmdsAtSettlementFA.has(cmd)) continue; // settlement-tile stack handled by Garrison panel
                            const commander = charByUuid.get(cmd);
                            // Every commanded army shows in the field-armies
                            // panel (named or aggregated). The previous
                            // "commander on settlement tile = garrison"
                            // shortcut required exact-pixel x/y match against
                            // a settlement tile we can't always resolve, and
                            // hid governor armies the user expected to see.
                            // Garrison panel now strictly = commander-LESS
                            // defenders; everything with a commander is here.
                            // Prefer the commander's actual faction (from
                            // the save's character record) over guessing
                            // from unit ownership. Parmenion's hoplites can
                            // be recruited by greek_cities, but Parmenion
                            // himself is macedon — use macedon for him.
                            const commanderFaction = commander?.faction || null;
                            const factionGuess = commanderFaction || ownerFactionOfUnits(units);
                            const isOwnFieldArmy = commanderFaction
                              ? commanderFaction === ownerId
                              : factionGuess === "own";
                            const fac = isOwnFieldArmy ? ownerId : (commanderFaction || factionGuess || "");
                            const entry = {
                              character: commander
                                ? (commander.lastName
                                    ? `${commander.firstName} ${commander.lastName.replace(/_/g, " ")}`
                                    : commander.firstName)
                                : null,
                              faction: fac,
                              _units: units,
                              _pos: cmdPos.get(cmd) || null,
                              _live: cmdLive.get(cmd) || false,
                              _secondary: cmd, // the commanderUuid itself, used by mergeByTile's flow-event matching
                            };
                            if (!commander) {
                              // Aggregate unknown commanders by faction so
                              // Parmenion-in-hostile-region doesn't render
                              // as 10 separate one-unit "armies".
                              const key = (isOwnFieldArmy ? "__own__" : fac) || "__unknown__";
                              if (!unknownByFaction.has(key)) unknownByFaction.set(key, { fac, isOwn: isOwnFieldArmy, units: [] });
                              unknownByFaction.get(key).units.push(...units);
                              continue;
                            }
                            (isOwnFieldArmy ? mergedOwn : mergedOthers).push(entry);
                          }
                          for (const { fac, isOwn, units } of unknownByFaction.values()) {
                            (isOwn ? mergedOwn : mergedOthers).push({
                              character: "(unidentified army)",
                              faction: fac,
                              _units: units,
                              _pos: null,
                            });
                          }
                          // Post-pass: merge entries that share (faction, tile).
                          // RTW lets up to 20 units (any number generals) live
                          // in a single army. When two named generals end up
                          // on the same tile after a mid-turn unit-transfer,
                          // they're really one combined stack — show them as
                          // one block with both names instead of two markers
                          // stacked at the same coords.
                          const mergeByTile = (list) => {
                            // Iterate entries; for each, compute its merge
                            // key from (faction, target-secondary-uuid):
                            //   - If the entry's commander has been merged
                            //     INTO another army (per the live log's
                            //     transfer events), use the target's
                            //     secondary uuid as the merge key.
                            //   - Else if the entry's own commander IS a
                            //     known target (someone has merged INTO
                            //     them), still use their own uuid as the
                            //     key so donors aggregate to them.
                            //   - Otherwise fall back to exact coords.
                            const allTargets = new Set(mergedPairsBySecondary.values());
                            const out = [];
                            const idx = new Map();
                            for (const e of list) {
                              const mergedInto = e._secondary ? mergedPairsBySecondary.get(e._secondary) : null;
                              let mergeKey;
                              if (mergedInto) {
                                mergeKey = (e.faction || "") + "@target:" + mergedInto;
                              } else if (e._secondary && allTargets.has(e._secondary)) {
                                mergeKey = (e.faction || "") + "@target:" + e._secondary;
                              } else if (e._pos) {
                                mergeKey = (e.faction || "") + "@pos:" + e._pos;
                              } else {
                                out.push({ ...e, _characters: [e.character] });
                                continue;
                              }
                              const hit = idx.get(mergeKey);
                              if (hit == null) {
                                idx.set(mergeKey, out.length);
                                out.push({ ...e, _characters: [e.character] });
                              } else {
                                const target = out[hit];
                                target._units = target._units.concat(e._units);
                                target._characters.push(e.character);
                              }
                            }
                            for (const e of out) {
                              if (e._characters && e._characters.length > 1) {
                                e.character = e._characters.filter(Boolean).join(" + ");
                              }
                              delete e._characters;
                              delete e._live;
                              delete e._secondary;
                            }
                            return out;
                          };
                          const mergedOwnFinal = mergeByTile(mergedOwn);
                          const mergedOthersFinal = mergeByTile(mergedOthers);
                          const dictMap = unitOwnership?.__dictionary || {};
                          // Same starting-values fallback as the garrison path
                          // — save format doesn't carry exp/armour/weapon, so
                          // we seed from descr_strat's turn-0 values matched
                          // by unit name within the region.
                          const fieldStartingByName = new Map();
                          for (const a of (startingArmiesByRegion?.[r.region]?.field || [])) {
                            for (const u of a.units || []) {
                              if (!fieldStartingByName.has(u.name)) fieldStartingByName.set(u.name, []);
                              fieldStartingByName.get(u.name).push(u);
                            }
                          }
                          const buildEntry = (e) => {
                            // Sort: bodyguard units (real commanderUuid)
                            // first, foot last. After a merge like
                            // Marcus + Aulus, both bodyguards must lead
                            // the roster — not get scattered by file order.
                            const sortedUnits = e._units.slice().sort((u1, u2) => {
                              const bg1 = u1.commanderUuid ? 0 : 1;
                              const bg2 = u2.commanderUuid ? 0 : 1;
                              return bg1 - bg2;
                            });
                            prefetchUnitIcons(modDataDir, sortedUnits.map((u) => [e.faction, u.name, dictMap[u.name]]), () => setIconCacheVersion((v) => v + 1));
                            return {
                              character: e.character,
                              faction: e.faction,
                              units: sortedUnits.map((u) => {
                                const queue = fieldStartingByName.get(u.name);
                                const seed = queue && queue.length ? queue.shift() : null;
                                // Prefer live XP / weapon / armour from the
                                // save (save-cracker session 10). Fall back
                                // to descr_strat starting seed only when the
                                // save value is 0/missing.
                                return {
                                  unit: u.name,
                                  xp: u.xp || seed?.exp || 0,
                                  armour: u.armour || seed?.armour || 0,
                                  weapon: u.weapon || seed?.weapon || 0,
                                  soldiers: typeof u.soldiers === "number" ? u.soldiers : null,
                                  max: typeof u.maxSoldiers === "number" ? u.maxSoldiers : null,
                                  faction: e.faction,
                                  icon: e.faction ? getCachedUnitIcon(e.faction, u.name) : null,
                                };
                              }),
                            };
                          };
                          const own = mergedOwnFinal.map(buildEntry);
                          const others = mergedOthersFinal.map(buildEntry);
                          if (own.length === 0 && others.length === 0) return null;
                          return { own, others };
                        }
                        const r = lockedRegionInfo || regionInfo;
                        if (!r) return null;
                        const regData = startingArmiesByRegion?.[r.region];
                        const armies = regData?.field || [];
                        if (armies.length === 0) return null;
                        const ownerFaction = (
                          (currentOwnerByCity && currentOwnerByCity[r.city])
                          || (initialOwnerByCity && initialOwnerByCity[r.city])
                          || r.faction
                          || ""
                        ).toLowerCase();
                        // Use each army's OWN faction for unit card lookup —
                        // a Macedon character standing in a Parthian region
                        // still has Macedonian units; their cards live under
                        // ui/units/macedon/, not ui/units/parthia/.
                        const triples = [];
                        const dictMap = unitOwnership?.__dictionary || {};
                        for (const a of armies) {
                          const fac = (a.faction || "").toLowerCase();
                          for (const u of a.units || []) if (fac) triples.push([fac, u.name, dictMap[u.name]]);
                        }
                        if (triples.length) prefetchUnitIcons(modDataDir, triples, () => setIconCacheVersion((v) => v + 1));
                        const own = [];
                        const others = [];
                        for (const a of armies) {
                          const fac = (a.faction || "").toLowerCase();
                          const entry = {
                            character: a.character,
                            faction: fac,
                            units: (a.units || []).map((u) => ({
                              unit: u.name, xp: u.exp || 0,
                              armour: u.armour || 0, weapon: u.weapon || 0,
                              faction: fac || null,
                              icon: fac ? getCachedUnitIcon(fac, u.name) : null,
                            })),
                          };
                          (fac && ownerFaction && fac === ownerFaction ? own : others).push(entry);
                        }
                        return { own, others };
                      })()}
                      /* `queue` prop removed — queued upgrades now render
                         inline in the main Buildings grid as an orange-bordered
                         card with green progress overlay (see getBuildings). */
                      saveFile={liveLogActive ? liveSaveFile : null}
                      characters={(() => {
                        const r = lockedRegionInfo || regionInfo;
                        if (!r) return null;
                        // Build a name → live region map from armiesToRender.
                        // CRITICAL: when an epithet trait fires (e.g. "the
                        // Eagle"), Marcus's display name becomes "Marcus
                        // Livius Drusus the Eagle" — but saveCharacters-
                        // ByRegion stores lastName with the epithet baked
                        // in too. Normalize BOTH sides identically:
                        // lowercase + underscores→spaces + KEEP epithets.
                        // (The 0.9.302 attempt stripped epithets on one
                        // side only, causing the filter to miss every
                        // character with a trait nickname.)
                        const normName = (full) => String(full || "").toLowerCase().replace(/_/g, " ").trim();
                        const liveRegionByCharName = new Map();
                        if (Array.isArray(armiesToRender)) {
                          for (const a of armiesToRender) {
                            if (!a || !a.region || !a.character) continue;
                            liveRegionByCharName.set(normName(a.character), a.region);
                            // Also register the birth name (pre-epithet)
                            // for the case where saveCharactersByRegion's
                            // lastName carries the epithet but the army
                            // entry's character was constructed pre-trait.
                            if (a.firstName && a.originalLastName) {
                              liveRegionByCharName.set(normName(a.firstName + " " + a.originalLastName), a.region);
                            }
                          }
                        }
                        const isMovedAway = (firstName, lastName) => {
                          const fullName = normName(firstName + " " + (lastName || ""));
                          const liveRegion = liveRegionByCharName.get(fullName);
                          return liveRegion && liveRegion !== r.region;
                        };
                        // Non-live fallback: synthesize a character list
                        // from descr_strat so traits / ancillaries / age
                        // are browsable without a save loaded. Live-save
                        // data takes precedence whenever it's available.
                        // Source priority:
                        //   1. Runtime descr_strat from the loaded mod
                        //      (`startingCharactersFromMod`) — works for
                        //      ANY mod or vanilla, not just the dev's
                        //      bundled one.
                        //   2. Bundled `startingArmiesByRegion` —
                        //      contains traits only if the dev rebundled
                        //      with the trait-capturing version of the
                        //      bundle script.
                        const liveCharsReady = saveCharactersByRegion && Object.keys(saveCharactersByRegion).length > 0;
                        if (!liveLogActive || !liveCharsReady) {
                          // Use the bundled per-region structure as the
                          // index of which characters live where (it has
                          // correct region bucketing because the bundle
                          // script does TGA pixel lookup), then merge in
                          // runtime trait data from descr_strat by
                          // firstName+faction match. The runtime data
                          // wins when present so live mod edits show up
                          // even without rebuilding the bundle.
                          const reg = startingArmiesByRegion?.[r.region];
                          if (!reg) return null;
                          const all = [...(reg.garrison || []), ...(reg.field || [])];
                          const real = all.filter((g) => {
                            const nm = (g.character || "").toLowerCase();
                            if (!nm || nm.startsWith("garrison of") || nm === "biggus dickus") return false;
                            // Drop chars who moved away per the live log.
                            const parts = (g.character || "").split(/\s+/);
                            const firstName = parts[0] || "";
                            const lastName = parts.slice(1).join("_");
                            if (isMovedAway(firstName, lastName)) return false;
                            return true;
                          });
                          if (real.length === 0) return null;
                          // Build a runtime lookup keyed by firstName+
                          // faction for fast merge.
                          const runtimeByKey = new Map();
                          if (Array.isArray(startingCharactersFromMod)) {
                            for (const c of startingCharactersFromMod) {
                              const key = (c.firstName || "") + "|" + (c.faction || "");
                              runtimeByKey.set(key, c);
                            }
                          }
                          const mapToChar = (g) => {
                            const parts = (g.character || "").split(/\s+/);
                            const firstName = parts[0] || g.character || "";
                            const lastName = parts.slice(1).join("_");
                            const rt = runtimeByKey.get(firstName + "|" + (g.faction || ""));
                            const traits = rt && Array.isArray(rt.traits) && rt.traits.length > 0
                              ? rt.traits
                              : (Array.isArray(g.traits) ? g.traits : []);
                            const ancRaw = rt && Array.isArray(rt.ancillaries) && rt.ancillaries.length > 0
                              ? rt.ancillaries
                              : (Array.isArray(g.ancillaries) ? g.ancillaries : []);
                            const tags = rt && Array.isArray(rt.tags) && rt.tags.length > 0
                              ? rt.tags
                              : (Array.isArray(g.tags) ? g.tags : []);
                            const age = rt && rt.age != null ? rt.age : (g.age ?? null);
                            return {
                              firstName,
                              lastName,
                              age,
                              isLeader: tags.includes("leader"),
                              isHeir: tags.includes("heir"),
                              gender: null,
                              isDead: false,
                              faction: g.faction || null,
                              traits,
                              ancillaries: ancRaw.map((a) => (typeof a === "string" ? { name: a } : a)),
                              _source: "starting",
                            };
                          };
                          const localMapped = real.map(mapToChar);
                          // Inverse: pull in chars from OTHER bundled
                          // regions whose live position resolved here
                          // (same as the live path's incoming pass).
                          const alreadyInLocal = new Set();
                          for (const c of localMapped) {
                            const k = (c.firstName + " " + (c.lastName || "").replace(/_/g, " ")).toLowerCase().trim();
                            alreadyInLocal.add(k);
                          }
                          const incomingStart = [];
                          for (const [region, regData] of Object.entries(startingArmiesByRegion || {})) {
                            if (region === r.region) continue;
                            const all = [...(regData.garrison || []), ...(regData.field || [])];
                            for (const g of all) {
                              const nm = (g.character || "").toLowerCase();
                              if (!nm || nm.startsWith("garrison of") || nm === "biggus dickus") continue;
                              const parts = (g.character || "").split(/\s+/);
                              const fullName = (parts[0] + " " + parts.slice(1).join(" ")).toLowerCase().trim();
                              if (alreadyInLocal.has(fullName)) continue;
                              if (liveRegionByCharName.get(fullName) !== r.region) continue;
                              incomingStart.push(mapToChar(g));
                              alreadyInLocal.add(fullName);
                            }
                          }
                          return [...localMapped, ...incomingStart];
                        }
                        // Referencing liveCharPositionsVersion forces this
                        // IIFE to re-evaluate after death events / assault
                        // wipes flip the filter state.
                        void liveCharPositionsVersion;
                        // Don't bail out when the region has no save-time
                        // chars — incoming chars (moved INTO the region
                        // via live log / settlement-tile re-bucketing)
                        // still need a chance to populate the list. The
                        // user reported empty Characters row in Uria
                        // after conquest because the original Messapian
                        // governors were gone and the early-exit fired
                        // before Aulus could be added via the incoming
                        // pass.
                        const list = saveCharactersByRegion[r.region] || [];
                        // Build a primary-uuid → char lookup across ALL
                        // regions so children of a character in this
                        // region can be resolved by name even when the
                        // child is governing a different settlement.
                        // Save-cracker session 13: child slots store
                        // primary uuids of the children.
                        const byPrimary = new Map();
                        for (const arr of Object.values(saveCharactersByRegion)) {
                          for (const c of arr) {
                            if (c.primaryUuid) byPrimary.set(c.primaryUuid, c);
                          }
                        }
                        // Resolve each character's children to names.
                        // Unresolvable uuids (dead child whose slot is
                        // preserved, or character not parsed) are dropped.
                        const enriched = list.map((c) => {
                          if (!Array.isArray(c.childUuids) || c.childUuids.length === 0) return c;
                          const childNames = [];
                          for (const u of c.childUuids) {
                            const ch = byPrimary.get(u);
                            if (ch) {
                              const nm = ch.lastName
                                ? `${ch.firstName} ${ch.lastName.replace(/_/g, " ")}`
                                : ch.firstName;
                              childNames.push(nm);
                            }
                          }
                          return childNames.length > 0 ? { ...c, _resolvedChildren: childNames } : c;
                        });
                        const deadUuids = liveDeadCharUuids.current;
                        const wiped = liveAssaultWipedSettlements.current;
                        const filtered = enriched.filter((c) => {
                          if (c.secondaryUuid && deadUuids.has(c.secondaryUuid.toString(16).padStart(8, "0"))) return false;
                          // Drop chars whose bodyguard is inside a wiped
                          // settlement. Find a unit they command in
                          // saveUnitsByRegion and check its region tag
                          // against the assault-wipe list. Skip the
                          // check if no wipes are active (the common case).
                          if (wiped.size > 0 && c.secondaryUuid && saveUnitsByRegion) {
                            for (const units of Object.values(saveUnitsByRegion)) {
                              for (const u of units) {
                                if (u.commanderUuid === c.secondaryUuid && u.region && wiped.has(u.region.toLowerCase())) return false;
                              }
                            }
                          }
                          // Drop chars whose live-log position has moved
                          // them to a different region — same filter as
                          // the non-live path above.
                          if (isMovedAway(c.firstName, c.lastName)) return false;
                          return true;
                        });
                        // Inverse: ADD chars from OTHER regions whose live
                        // position resolved to r.region. After a merge,
                        // Marcus moves from Metapontion to Aulus's tile in
                        // Taras — the live filter drops him from
                        // Metapontion, but saveCharactersByRegion["Taras"]
                        // still doesn't list him (the save hasn't caught
                        // up). Pull him in here via liveRegionByCharName.
                        const alreadyIn = new Set();
                        for (const c of filtered) {
                          if (c.firstName) {
                            const k = (c.firstName + " " + (c.lastName || "").replace(/_/g, " ")).toLowerCase().trim();
                            alreadyIn.add(k);
                          }
                        }
                        const incoming = [];
                        for (const [region, arr] of Object.entries(saveCharactersByRegion)) {
                          if (region === r.region) continue;
                          for (const c of arr) {
                            if (!c.firstName) continue;
                            const fullName = (c.firstName + " " + (c.lastName || "").replace(/_/g, " ")).toLowerCase().trim();
                            const birthName = c.originalLastName
                              ? (c.firstName + " " + c.originalLastName.replace(/_/g, " ")).toLowerCase().trim()
                              : null;
                            if (alreadyIn.has(fullName)) continue;
                            const liveRegion = liveRegionByCharName.get(fullName)
                              || (birthName ? liveRegionByCharName.get(birthName) : null);
                            if (liveRegion !== r.region) continue;
                            // Dead/wiped filter — same as above.
                            if (c.secondaryUuid && deadUuids.has(c.secondaryUuid.toString(16).padStart(8, "0"))) continue;
                            // Enrich with children resolution (same shape).
                            let enrichedChar = c;
                            if (Array.isArray(c.childUuids) && c.childUuids.length > 0) {
                              const childNames = [];
                              for (const u of c.childUuids) {
                                const ch = byPrimary.get(u);
                                if (ch) {
                                  const nm = ch.lastName ? `${ch.firstName} ${ch.lastName.replace(/_/g, " ")}` : ch.firstName;
                                  childNames.push(nm);
                                }
                              }
                              if (childNames.length > 0) enrichedChar = { ...c, _resolvedChildren: childNames };
                            }
                            incoming.push(enrichedChar);
                            alreadyIn.add(fullName);
                          }
                        }
                        const combined = [...filtered, ...incoming];
                        // TEMP DIAG: write to provincia.log when Uria
                        // panel is open so we can see why the live path
                        // is still producing zero chars. Remove once
                        // fixed.
                        try {
                          if (r.region === "Salentinia" || r.city === "Uria") {
                            const liveKeysSample = [...liveRegionByCharName.entries()].filter(([k, v]) => v === r.region || /aulus|gabinius|messapiv/.test(k)).slice(0, 8);
                            const saveRegions = Object.keys(saveCharactersByRegion || {}).length;
                            const tarasChars = (saveCharactersByRegion?.Taras || []).filter(c => /aulus/i.test(c.firstName || ""));
                            const tarasSample = tarasChars.slice(0, 3).map(c => `${c.firstName}|${c.lastName}|olast=${c.originalLastName}`).join(" :: ");
                            // Also dump what armiesToRender has for Aulus.
                            const aulusArmies = (armiesToRender || []).filter(a => /aulus/i.test(a.character || a.firstName || ""));
                            const aulusSample = aulusArmies.slice(0, 3).map(a => `char='${a.character}' first='${a.firstName}' olast='${a.originalLastName}' region='${a.region}' x=${a.x} y=${a.y}`).join(" :: ");
                            window.electronAPI?.logMessage?.("info",
                              `[char-diag] r.region=${r.region} r.city=${r.city} filtered=${filtered.length} incoming=${incoming.length} ` +
                              `saveRegions=${saveRegions} tarasCharsAulus=${tarasChars.length} tarasSample=[${tarasSample}] ` +
                              `armies=[${aulusSample}] ` +
                              `liveKeys=[${liveKeysSample.map(([k,v]) => k+'=>'+v).join(' / ')}]`);
                          }
                        } catch {}
                        return combined.length > 0 ? combined : null;
                      })()}
                      liveUnits={(() => {
                        if (!saveUnitsByRegion || !liveLogActive) return null;
                        const r = lockedRegionInfo || regionInfo;
                        if (!r) return null;
                        return saveUnitsByRegion[r.region] || null;
                      })()}
                      liveOwner={(() => {
                        const r = lockedRegionInfo || regionInfo;
                        if (!r || !r.city) return null;
                        // Owner-resolution chain. Save-current > strat-initial >
                        // descr_regions rebel default. Used for the displayed
                        // Faction line in RegionInfo. The fallback is no longer
                        // gated on liveLogActive — initialOwnerByCity is filled
                        // from a get-initial-ownership IPC at boot, so even
                        // without a save loaded we can override the rebel-
                        // default (descr_regions' r.faction) when descr_strat
                        // assigns a real owner. Fixes Corsica showing
                        // "romans_julii" when descr_strat says "corsi".
                        const id = (currentOwnerByCity && currentOwnerByCity[r.city])
                          || (initialOwnerByCity && initialOwnerByCity[r.city])
                          || null;
                        if (!id) return null;
                        // Translate internal faction id to in-game display name when known
                        // (e.g., "roman_rebels_2" → "The House of Cornelii").
                        return (factionDisplayNames && factionDisplayNames[id]) || id;
                      })()}
                      taxLevel={(() => {
                        try {
                          if (!liveLogActive || !saveTaxByCity) return null;
                          const r = lockedRegionInfo || regionInfo;
                          if (!r || !r.city) return null;
                          const v = saveTaxByCity[r.city];
                          if (!v) return null;
                          // Gate by player-ownership when we know it — the tax byte at
                          // settlement_name_offset-2269 only reads correctly for the
                          // player's settlements. When playerFaction isn't yet set,
                          // we still display whatever was parsed (best-effort).
                          if (playerFaction) {
                            const owner = (currentOwnerByCity && currentOwnerByCity[r.city])
                              || (initialOwnerByCity && initialOwnerByCity[r.city]);
                            if (owner && owner !== playerFaction) return null;
                          }
                          return v;
                        } catch { return null; }
                      })()}
                      happiness={(() => {
                        // Public-order f32 at settlement.offset-30. Raw save
                        // value ranges roughly 105..195 per the cracker;
                        // engine clips to a 0-100% bar at render. Apply the
                        // same player-ownership gate as taxLevel — the offset
                        // was only verified for the player's settlements.
                        try {
                          if (!liveLogActive || !saveHappinessByCity) return null;
                          const r = lockedRegionInfo || regionInfo;
                          if (!r || !r.city) return null;
                          const v = saveHappinessByCity[r.city];
                          if (typeof v !== "number") return null;
                          if (playerFaction) {
                            const owner = (currentOwnerByCity && currentOwnerByCity[r.city])
                              || (initialOwnerByCity && initialOwnerByCity[r.city]);
                            if (owner && owner !== playerFaction) return null;
                          }
                          return v;
                        } catch { return null; }
                      })()}
                      livePopulation={(() => {
                        // Live settlement population u32 at settlement.offset
                        // -1494. Cross-validated by the save-cracker against
                        // descr_strat starting pops; diverges from start as
                        // turns progress (growth / decay events apply).
                        try {
                          if (!liveLogActive || !savePopulationByCity) return null;
                          const r = lockedRegionInfo || regionInfo;
                          if (!r || !r.city) return null;
                          const v = savePopulationByCity[r.city];
                          if (typeof v !== "number") return null;
                          return v;
                        } catch { return null; }
                      })()}
                      liveIncome={(() => {
                        // Per-turn + cumulative settlement income, decoded
                        // 2026-05-10 via save-cracker session 3. STRONG
                        // confidence (one clean correlation across rome1..
                        // rome10 turn boundaries). Surfaced for player-
                        // owned settlements only (gate matches tax row).
                        try {
                          if (!liveLogActive || !saveIncomeByCity) return null;
                          const r = lockedRegionInfo || regionInfo;
                          if (!r || !r.city) return null;
                          const v = saveIncomeByCity[r.city];
                          if (!v || typeof v.perTurn !== "number") return null;
                          if (playerFaction) {
                            const owner = (currentOwnerByCity && currentOwnerByCity[r.city])
                              || (initialOwnerByCity && initialOwnerByCity[r.city]);
                            if (owner && owner !== playerFaction) return null;
                          }
                          return v;
                        } catch { return null; }
                      })()}
                      liveSize={(() => {
                        // Settlement size class enum from the save (live
                        // value, reflects mid-campaign upgrades). u8 at
                        // settlement.offset-2207. CONFIRMED across
                        // multiple samples.
                        try {
                          if (!liveLogActive || !saveSizeByCity) return null;
                          const r = lockedRegionInfo || regionInfo;
                          if (!r || !r.city) return null;
                          return saveSizeByCity[r.city] || null;
                        } catch { return null; }
                      })()}
                    />
                  </div>
                ) : (
                  <div style={{ color: "#bbb", fontStyle: "italic" }}>
                    Hover over a region to see details. Click to lock the panel.
                  </div>
                )}
              </CustomScrollArea>
            </div>
          </>
        )}
      </div>
      {/* ── Dev Context Menu (right-click edit) ──────────────────── */}
      {devContextMenu && devMode && (() => {
        const { x, y, rgbKey, region } = devContextMenu;
        const menuStyle = {
          position: "fixed", left: x, top: y, zIndex: 9999,
          background: "#1a1a1a", border: "1px solid #e8a030", borderRadius: 8,
          padding: "6px 0", minWidth: 190, boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
          color: "#eee", fontSize: "0.82rem", maxHeight: "60vh", overflowY: "auto",
        };
        const rowHover = (e, active) => {
          e.currentTarget.style.background = "rgba(232,160,48,0.15)";
        };
        const rowLeave = (e, active) => {
          e.currentTarget.style.background = active ? "rgba(232,160,48,0.2)" : "transparent";
        };

        let title = null;
        let items = null;

        // Dev tag-based modes
        if (DEV_EDIT_OPTIONS[colorMode]) {
          const opts = DEV_EDIT_OPTIONS[colorMode];
          const currentTag = getTagValue(region.tags, opts.tags);
          title = `${region.region} — ${opts.title}`;
          items = [];
          if (opts.includeNone) {
            items.push(
              <div key="__none" onClick={() => applyDevEdit(rgbKey, colorMode, null)} style={{
                padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                background: !currentTag ? "rgba(232,160,48,0.2)" : "transparent", fontStyle: "italic", color: "#aaa",
              }} onMouseEnter={(e) => rowHover(e)} onMouseLeave={(e) => rowLeave(e, !currentTag)}>
                {opts.noneColor && <div style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0, background: `rgb(${opts.noneColor[0]},${opts.noneColor[1]},${opts.noneColor[2]})` }} />}
                {opts.includeNone}
              </div>
            );
          }
          for (const tag of opts.tags) {
            const label = opts.labels[tag] || tag.replace(/_/g, " ");
            const isCurrent = tag === currentTag;
            const rgb = opts.colors && opts.colors[tag];
            items.push(
              <div key={tag} onClick={() => applyDevEdit(rgbKey, colorMode, tag)} style={{
                padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                background: isCurrent ? "rgba(232,160,48,0.2)" : "transparent", fontWeight: isCurrent ? 700 : 400,
              }} onMouseEnter={(e) => rowHover(e)} onMouseLeave={(e) => rowLeave(e, isCurrent)}>
                {rgb && <div style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0, background: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`, outline: isCurrent ? "2px solid #dca64a" : "none" }} />}
                {label}{isCurrent ? " (current)" : ""}
              </div>
            );
          }
        }
        // Hidden resource mode — toggle the currently-picked token on this region
        else if (colorMode === "hidden_resource") {
          const token = selectedHiddenResource;
          title = `${region.region} — Hidden Resource`;
          items = [];
          if (!token) {
            items.push(
              <div key="__no_token" style={{
                padding: "8px 12px", fontStyle: "italic", color: "#aaa", cursor: "default",
              }}>Pick a token in the legend first.</div>
            );
          } else {
            const has = hasTag(region.tags, token);
            items.push(
              <div key="__current" style={{
                padding: "5px 12px 4px 12px", fontSize: "0.7rem", color: "#888",
                borderBottom: "1px solid #333",
              }}>Currently {has ? "has" : "doesn't have"} <span style={{ color: "#dca64a", fontWeight: 600 }}>{token}</span></div>
            );
            items.push(
              <div key="__toggle" onClick={() => applyDevEdit(rgbKey, "hidden_resource", token)} style={{
                padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                background: "transparent", fontWeight: 600,
              }} onMouseEnter={(e) => rowHover(e)} onMouseLeave={(e) => rowLeave(e, false)}>
                <div style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0,
                  background: has ? "rgb(80,65,60)" : "rgb(50,180,90)",
                  border: "1px solid " + (has ? "#888" : "#dca64a") }} />
                {has ? `Remove '${token}'` : `Add '${token}'`}
              </div>
            );
          }
        }
        // Faction mode
        else if (colorMode === "faction") {
          title = `${region.region} — Faction`;
          const allFactions = [...new Set(Object.values(regions).map(r => r.faction))].sort();
          items = allFactions.map(f => {
            const isCurrent = f === region.faction;
            return (
              <div key={f} onClick={() => applyDevEdit(rgbKey, "faction", f)} style={{
                padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                background: isCurrent ? "rgba(232,160,48,0.2)" : "transparent", fontWeight: isCurrent ? 700 : 400,
              }} onMouseEnter={(e) => rowHover(e)} onMouseLeave={(e) => rowLeave(e, isCurrent)}>
                {f.replace(/_/g, " ")}{isCurrent ? " (current)" : ""}
              </div>
            );
          });
        }
        // Culture mode
        else if (colorMode === "culture") {
          title = `${region.region} — Culture`;
          const cultureGroupMap = {};
          for (const r of Object.values(regions)) {
            if (r.culture && !cultureGroupMap[r.culture]) cultureGroupMap[r.culture] = classifyCultureGroup(r);
          }
          // Build main → sub → cultures
          const mainGroups = {};
          for (const [culture, { main, sub }] of Object.entries(cultureGroupMap)) {
            if (!mainGroups[main]) mainGroups[main] = {};
            const subKey = sub || "__direct__";
            if (!mainGroups[main][subKey]) mainGroups[main][subKey] = [];
            mainGroups[main][subKey].push(culture);
          }
          const mainOrder = Object.keys(mainGroups).sort((a, b) => a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b));
          items = [];
          for (const mainName of mainOrder) {
            items.push(
              <div key={`main-${mainName}`} style={{ padding: "3px 12px", fontSize: "0.7rem", fontWeight: 700, color: "#e8a030", borderBottom: "1px solid #333", marginTop: items.length > 0 ? 4 : 0 }}>
                {mainName}
              </div>
            );
            const subKeys = Object.keys(mainGroups[mainName]).sort((a, b) => a === "__direct__" ? -1 : b === "__direct__" ? 1 : a.localeCompare(b));
            for (const subKey of subKeys) {
              const cultures = mainGroups[mainName][subKey].sort();
              if (subKey !== "__direct__" && subKeys.length > 1) {
                const subLabel = subKey.replace(/^.*? — /, "");
                items.push(
                  <div key={`sub-${subKey}`} style={{ padding: "2px 12px 2px 16px", fontSize: "0.65rem", fontWeight: 600, color: "#888", borderBottom: "1px solid #222" }}>
                    {subLabel}
                  </div>
                );
              }
              const indent = (subKey !== "__direct__" && subKeys.length > 1) ? 28 : 20;
              for (const c of cultures) {
                const isCurrent = c === region.culture;
                items.push(
                  <div key={c} onClick={() => applyDevEdit(rgbKey, "culture", c)} style={{
                    padding: `4px 12px 4px ${indent}px`, cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                    background: isCurrent ? "rgba(232,160,48,0.2)" : "transparent", fontWeight: isCurrent ? 700 : 400,
                    fontSize: "0.78rem",
                  }} onMouseEnter={(e) => rowHover(e)} onMouseLeave={(e) => rowLeave(e, isCurrent)}>
                    {c.replace(/_/g, " ")}{isCurrent ? " (current)" : ""}
                  </div>
                );
              }
            }
          }
        }
        // Farm/Fertility mode
        else if (colorMode === "farm") {
          title = `${region.region} — Fertility`;
          const currentFarm = (() => { const m = String(region.tags || "").match(/\bFarm(\d+)\b/); return m ? parseInt(m[1], 10) : 0; })();
          items = [];
          for (let lvl = 1; lvl <= 14; lvl++) {
            const isCurrent = lvl === currentFarm;
            const t = lvl / 14;
            const red = t < 0.5 ? 210 : Math.round(210 - (t - 0.5) * 2 * 160);
            const green = t < 0.5 ? Math.round(t * 2 * 200) : 200;
            items.push(
              <div key={lvl} onClick={() => applyDevEdit(rgbKey, "farm", lvl)} style={{
                padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                background: isCurrent ? "rgba(232,160,48,0.2)" : "transparent", fontWeight: isCurrent ? 700 : 400,
              }} onMouseEnter={(e) => rowHover(e)} onMouseLeave={(e) => rowLeave(e, isCurrent)}>
                <div style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0, background: `rgb(${red},${green},30)`, outline: isCurrent ? "2px solid #dca64a" : "none" }} />
                Fertility {lvl}{isCurrent ? " (current)" : ""}
              </div>
            );
          }
        }
        // Religion mode
        else if (colorMode === "religion") {
          title = `${region.region} — Religion`;
          let currentRel = null, bestLvl = -1;
          for (const hit of String(region.tags || "").matchAll(/\brel_([a-z_]+?)_(\d+)\b/g)) {
            const lvl = parseInt(hit[2], 10);
            if (lvl > bestLvl) { currentRel = hit[1]; bestLvl = lvl; }
          }
          items = [];
          for (const [groupName, groupRels] of Object.entries(RELIGION_GROUPS)) {
            const present = groupRels.filter(r => RELIGION_COLORS[r]);
            if (present.length === 0) continue;
            items.push(
              <div key={`grp-${groupName}`} style={{ padding: "3px 12px", fontSize: "0.7rem", fontWeight: 700, color: "#aaa", borderBottom: "1px solid #333", marginTop: items.length > 0 ? 4 : 0 }}>
                {groupName}
              </div>
            );
            for (const rel of present) {
              const isCurrent = rel === currentRel;
              const rgb = RELIGION_COLORS[rel] || [128, 128, 128];
              items.push(
                <div key={rel} onClick={() => applyDevEdit(rgbKey, "religion", rel)} style={{
                  padding: "4px 12px 4px 20px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                  background: isCurrent ? "rgba(232,160,48,0.2)" : "transparent", fontWeight: isCurrent ? 700 : 400,
                }} onMouseEnter={(e) => rowHover(e)} onMouseLeave={(e) => rowLeave(e, isCurrent)}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, background: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`, outline: isCurrent ? "2px solid #dca64a" : "none" }} />
                  <span style={{ fontSize: "0.78rem" }}>{rel.replace(/_/g, " ")}{isCurrent ? " (current)" : ""}</span>
                </div>
              );
            }
          }
        }
        // Population mode
        else if (colorMode === "population") {
          title = `${region.region} — Population`;
          const currentPop = populationData[region.region] || populationData[region.region?.split("-")[0]] || populationData[region.city] || 0;
          items = [
            <div key="pop-input" style={{ padding: "8px 12px" }}>
              <div style={{ fontSize: "0.75rem", color: "#aaa", marginBottom: 4 }}>Current: {currentPop.toLocaleString()}</div>
              <form onSubmit={(e) => {
                e.preventDefault();
                const val = parseInt(e.target.elements.popval.value, 10);
                if (!isNaN(val) && val >= 0) {
                  setPopulationData(prev => ({ ...prev, [region.region]: val }));
                  markDirty("population");
                  setDevContextMenu(null);
                }
              }} style={{ display: "flex", gap: 6 }}>
                <input name="popval" type="number" defaultValue={currentPop} min={0} style={{
                  flex: 1, padding: "4px 6px", borderRadius: 4, border: "1px solid #555",
                  background: "#222", color: "#eee", fontSize: "0.82rem",
                }} autoFocus />
                <button type="submit" style={{
                  padding: "4px 10px", borderRadius: 4, border: "1px solid #e8a030",
                  background: "#e8a030", color: "#1a1a1a", fontWeight: 700, cursor: "pointer",
                }}>Set</button>
              </form>
            </div>
          ];
        }
        // Victory mode
        else if (colorMode === "victory") {
          if (!selectedFaction) {
            title = `${region.region} — Victory`;
            items = [<div key="none" style={{ padding: "8px 12px", color: "#888" }}>Select a faction first (click a faction icon)</div>];
          } else {
            const holdList = victoryConditions[selectedFaction]?.hold_regions || [];
            const isHeld = holdList.includes(region.region);
            title = `${region.region} — ${selectedFaction.replace(/_/g, " ")}`;
            items = [
              <div key="toggle" onClick={() => {
                setVictoryConditions(prev => {
                  const vc = { ...prev };
                  const entry = { ...(vc[selectedFaction] || { hold_regions: [], take_regions: null }) };
                  if (isHeld) entry.hold_regions = entry.hold_regions.filter(r => r !== region.region);
                  else entry.hold_regions = [...entry.hold_regions, region.region];
                  vc[selectedFaction] = entry;
                  return vc;
                });
                markDirty("descr_win_conditions.txt");
                setDevContextMenu(null);
              }} style={{
                padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                background: "transparent", fontWeight: 600,
              }} onMouseEnter={(e) => rowHover(e)} onMouseLeave={(e) => rowLeave(e, false)}>
                <div style={{ width: 14, height: 14, borderRadius: 2, flexShrink: 0,
                  background: isHeld ? "#e8a030" : "#333", border: "2px solid " + (isHeld ? "#e8a030" : "#666") }} />
                {isHeld ? "Remove from victory conditions" : "Add to victory conditions"}
              </div>
            ];
          }
        }
        // Government mode
        else if (colorMode === "government") {
          const GOV_OPTIONS = [
            { type: "governmentA", level: "gov1", label: "Government A (gov1)", color: [130, 70, 180] },
            { type: "governmentB", level: "gov2", label: "Government B (gov2)", color: [210, 130, 40] },
            { type: "governmentC", level: "gov3", label: "Government C (gov3)", color: [190, 60, 150] },
            { type: "governmentD", level: "gov4", label: "Government D (gov4)", color: [25, 100, 45] },
          ];
          const currentGov = governmentMap[rgbKey];
          title = `${region.region} — Government`;
          items = GOV_OPTIONS.map(opt => {
            const isCurrent = currentGov && currentGov.level === opt.level;
            return (
              <div key={opt.level} onClick={() => {
                // Update buildingsData
                setBuildingsData(prev => {
                  const next = JSON.parse(JSON.stringify(prev));
                  for (const fObj of next) {
                    for (const s of (fObj.settlements || [])) {
                      if (s.region?.toLowerCase() !== region.region?.toLowerCase()) continue;
                      let found = false;
                      for (let i = 0; i < (s.buildings || []).length; i++) {
                        if (s.buildings[i].type?.startsWith("government")) {
                          s.buildings[i] = { type: opt.type, level: opt.level };
                          found = true;
                          break;
                        }
                      }
                      if (!found) {
                        if (!s.buildings) s.buildings = [];
                        s.buildings.push({ type: opt.type, level: opt.level });
                      }
                      return next;
                    }
                  }
                  return next;
                });
                markDirty("buildings");
                setDevContextMenu(null);
              }} style={{
                padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                background: isCurrent ? "rgba(232,160,48,0.2)" : "transparent", fontWeight: isCurrent ? 700 : 400,
              }} onMouseEnter={(e) => rowHover(e)} onMouseLeave={(e) => rowLeave(e, isCurrent)}>
                <div style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0,
                  background: `rgb(${opt.color[0]},${opt.color[1]},${opt.color[2]})`,
                  outline: isCurrent ? "2px solid #dca64a" : "none" }} />
                {opt.label}{isCurrent ? " (current)" : ""}
              </div>
            );
          });
        }
        // Resource mode
        else if (colorMode === "resource") {
          title = `${region.region} — Resources`;
          const regionResources = resourcesData[region.region] || [];
          const currentTypes = new Set(regionResources.map(r => r.type));
          const allTypes = [...new Set(Object.values(resourcesData).flat().map(r => r.type))].sort();
          items = [];
          // Show existing resources first with amount controls and remove button
          if (regionResources.length > 0) {
            items.push(<div key="hdr-existing" style={{ padding: "4px 12px", fontSize: "0.7rem", color: "#e8a030", fontWeight: 700, borderBottom: "1px solid #333" }}>Current resources</div>);
            for (const res of regionResources) {
              items.push(
                <div key={`existing-${res.type}`} style={{
                  padding: "4px 12px", display: "flex", alignItems: "center", gap: 6,
                  background: "rgba(232,160,48,0.1)",
                }}>
                  <span style={{ flex: 1, fontWeight: 600 }}>{res.type.replace(/_/g, " ")}</span>
                  <button onClick={() => {
                    setResourcesData(prev => {
                      const next = { ...prev };
                      next[region.region] = (next[region.region] || []).map(r =>
                        r.type === res.type ? { ...r, amount: Math.max(1, (r.amount || 1) - 1) } : r
                      );
                      return next;
                    });
                    markDirty("resources");
                  }} style={{ background: "#333", border: "1px solid #555", color: "#ccc", borderRadius: 3, cursor: "pointer", padding: "1px 6px", fontSize: "0.8rem" }}>-</button>
                  <span style={{ minWidth: 18, textAlign: "center", fontWeight: 700 }}>{res.amount || 1}</span>
                  <button onClick={() => {
                    setResourcesData(prev => {
                      const next = { ...prev };
                      next[region.region] = (next[region.region] || []).map(r =>
                        r.type === res.type ? { ...r, amount: (r.amount || 1) + 1 } : r
                      );
                      return next;
                    });
                    markDirty("resources");
                  }} style={{ background: "#333", border: "1px solid #555", color: "#ccc", borderRadius: 3, cursor: "pointer", padding: "1px 6px", fontSize: "0.8rem" }}>+</button>
                  <button onClick={() => {
                    setResourcesData(prev => {
                      const next = { ...prev };
                      next[region.region] = (next[region.region] || []).filter(r => r.type !== res.type);
                      return next;
                    });
                    markDirty("resources");
                  }} style={{ background: "#633", border: "1px solid #855", color: "#faa", borderRadius: 3, cursor: "pointer", padding: "1px 6px", fontSize: "0.8rem" }}>x</button>
                </div>
              );
            }
          }
          // Then list types not yet present to add
          const addTypes = allTypes.filter(t => !currentTypes.has(t));
          if (addTypes.length > 0) {
            items.push(<div key="hdr-add" style={{ padding: "4px 12px", fontSize: "0.7rem", color: "#888", fontWeight: 700, borderBottom: "1px solid #333", marginTop: 4 }}>Add resource</div>);
            for (const type of addTypes) {
              items.push(
                <div key={`add-${type}`} onClick={() => {
                  const cx = regionCentroids[rgbKey]?.x || 0;
                  const cy = regionCentroids[rgbKey]?.y || 0;
                  setResourcesData(prev => {
                    const next = { ...prev };
                    next[region.region] = [...(next[region.region] || []), { type, x: cx, y: cy, amount: 1 }];
                    return next;
                  });
                  markDirty("resources");
                }} style={{
                  padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                  background: "transparent", color: "#aaa",
                }} onMouseEnter={(e) => rowHover(e)} onMouseLeave={(e) => rowLeave(e, false)}>
                  <div style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0, background: "#444", border: "1px solid #666" }} />
                  {type.replace(/_/g, " ")}
                </div>
              );
            }
          }
          if (allTypes.length === 0) items = [<div key="none" style={{ padding: "8px 12px", color: "#888" }}>No resource data loaded</div>];
        }

        if (!items) return null;

        return (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 9998 }}
              onClick={() => setDevContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setDevContextMenu(null); }} />
            <div className="popover-pop-in" style={menuStyle}>
              <div style={{ padding: "4px 12px 6px", color: "#e8a030", fontWeight: 700, fontSize: "0.75rem", borderBottom: "1px solid #333" }}>
                {title}
              </div>
              {items}
              {/* Universal modder utility — present regardless of dev colour
                  mode. Builds a `settlement { ... }` block in descr_strat
                  format from current state and copies to clipboard, so a
                  modder can paste it into another mod or test branch. */}
              <div
                onClick={() => {
                  try {
                    const owner = (currentOwnerByCity && currentOwnerByCity[region.city])
                      || (initialOwnerByCity && initialOwnerByCity[region.city])
                      || region.faction || "slave";
                    const tier = settlementTierMap[rgbKey] || "town";
                    let built = [];
                    for (const fd of buildingsData) {
                      const sett = (fd.settlements || []).find(s => s.region?.toLowerCase() === region.region?.toLowerCase());
                      if (sett) { built = sett.buildings || []; break; }
                    }
                    const popData = populationData[region.region] || populationData[region.city] || 0;
                    const lines = [];
                    lines.push("settlement");
                    lines.push("{");
                    lines.push(`\tlevel ${tier}`);
                    lines.push(`\tregion ${region.region}`);
                    lines.push(`\tyear_founded 0`);
                    if (popData) lines.push(`\tpopulation ${popData}`);
                    lines.push(`\tplan_set default_set`);
                    lines.push(`\tfaction_creator ${owner}`);
                    for (const b of built) {
                      lines.push("\tbuilding");
                      lines.push("\t{");
                      lines.push(`\t\ttype ${b.type} ${b.level}`);
                      lines.push("\t}");
                    }
                    lines.push("}");
                    navigator.clipboard?.writeText(lines.join("\n"));
                    pushToast(`Copied descr_strat block for ${region.region}`, "info");
                  } catch (e) {
                    pushToast(`Copy failed: ${e.message}`, "error");
                  }
                  setDevContextMenu(null);
                }}
                style={{
                  padding: "6px 12px", cursor: "pointer",
                  borderTop: "1px solid #333", marginTop: 4,
                  fontSize: "0.78rem", color: "#dca64a",
                }}
                onMouseEnter={(e) => rowHover(e)} onMouseLeave={(e) => rowLeave(e, false)}
              >📋 Copy descr_strat block</div>
            </div>
          </>
        );
      })()}
      {/* ── Dev File Import Modal ──────────────────────────────────── */}
      {showFileImport && devMode && (() => {
        const isElectron = !!(window.electronAPI && window.electronAPI.isElectron);
        const overlayStyle = {
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        };
        const modalStyle = {
          background: "#1a1a1a", border: "2px solid #e8a030", borderRadius: 12,
          padding: "24px 32px", minWidth: 600, maxWidth: 800, maxHeight: "90vh",
          overflowY: "auto", color: "#eee", boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
        };
        const sectionStyle = (isActive) => ({
          padding: "12px 16px", marginBottom: 8, borderRadius: 8,
          border: isActive ? "1px solid #e8a030" : "1px solid #444",
          background: isActive ? "rgba(232,160,48,0.08)" : "rgba(255,255,255,0.02)",
        });
        const readFileAsText = (file) => new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsText(file);
        });

        const NEEDED_FILES = ["descr_regions.txt", "descr_strat.txt", "descr_win_conditions.txt", "map_regions.tga"];

        const expectedFiles = [
          { name: "descr_regions.txt", desc: "Regions, cities, cultures, tags, RGB keys" },
          { name: "descr_strat.txt", desc: "Factions, settlements, buildings, population" },
          { name: "descr_win_conditions.txt", desc: "Victory conditions per faction" },
          { name: "map_regions.tga", desc: "Region colour map (TGA)" },
        ];

        const campaigns = [
          { key: "classic", label: CAMPAIGNS.classic.label + " (Slot 1)", suffix: "classic",
            out: { regions: "regions_classic.json", factions: "factions_with_regions_classic.json", buildings: "descr_strat_buildings_classic.json", population: "population_classic.json", resources: "resources_classic.json", armies: "armies_classic.json", win: "descr_win_conditions_classic.txt", map: "map_regions_classic.tga" } },
          { key: "imperial", label: CAMPAIGNS.imperial.label + " (Slot 2)", suffix: "imperial",
            out: { regions: "regions_large.json", factions: "factions_with_regions_large.json", buildings: "descr_strat_buildings_large.json", population: "population_large.json", resources: "resources_large.json", armies: "armies_large.json", win: "descr_win_conditions_large.txt", map: "map_regions_large.tga" } },
        ];

        const setStatus = (suffix, text, color) => {
          const el = document.getElementById(`dev-status-${suffix}`);
          if (el) { el.textContent = text; el.style.color = color; }
        };

        // Shared processing logic — parses input files, saves JSON to disk (Electron),
        // AND applies data to live React state so it takes effect immediately.
        const isActiveCampaign = camp => camp.key === mapCampaign;
        const applyFiles = async (fileContents, binaryContents, camp, sourcePaths) => {
          const updated = [];
          const found = Object.keys(fileContents).concat(Object.keys(binaryContents)).concat(sourcePaths ? Object.keys(sourcePaths) : []);
          const missing = NEEDED_FILES.filter(n => !found.includes(n));
          const canSave = isElectron && window.electronAPI.saveFile;

          if (fileContents["descr_regions.txt"]) {
            const parsed = parseDescrRegions(fileContents["descr_regions.txt"]);
            const count = Object.keys(parsed).length;
            if (count > 0) {
              if (canSave) await window.electronAPI.saveFile(camp.out.regions, JSON.stringify(parsed, null, 2));
              if (isActiveCampaign(camp)) setRegions(parsed);
              updated.push(`regions (${count})`);
            }
          }
          if (fileContents["descr_strat.txt"]) {
            const text = fileContents["descr_strat.txt"];
            // Store original for patching on export — persist to disk in Electron
            devOrigStratRef.current = text;
            if (isElectron && window.electronAPI.saveUserFile) {
              window.electronAPI.saveUserFile("descr_strat_original.txt", text);
            }
            const factions = parseDescrStratFactions(text);
            const fCount = Object.keys(factions).length;
            if (fCount > 0) {
              if (canSave) await window.electronAPI.saveFile(camp.out.factions, JSON.stringify(factions, null, 2));
              if (isActiveCampaign(camp)) {
                setFactionRegionsMap(factions);
                setFactions(Object.keys(factions));
              }
              updated.push(`factions (${fCount})`);
            }
            const buildings = parseDescrStratBuildings(text);
            if (buildings.length > 0) {
              if (canSave) await window.electronAPI.saveFile(camp.out.buildings, JSON.stringify(buildings, null, 2));
              if (isActiveCampaign(camp)) setBuildingsData(buildings);
              updated.push(`buildings (${buildings.length})`);
            }
            const pop = extractPopulationData(buildings);
            const popCount = Object.keys(pop).length;
            if (popCount > 0) {
              if (canSave) await window.electronAPI.saveFile(camp.out.population, JSON.stringify(pop, null, 2));
              if (isActiveCampaign(camp)) setPopulationData(pop);
              updated.push(`population (${popCount})`);
            }
            // Extract resources from descr_strat.txt — assign to regions by pixel coordinate lookup
            let mapHeight = 0;
            const tgaBin = binaryContents["map_regions.tga"];
            if (tgaBin) {
              const view = new DataView(tgaBin instanceof ArrayBuffer ? tgaBin : tgaBin.buffer || tgaBin);
              mapHeight = view.getUint8(15) * 256 + view.getUint8(14); // little-endian uint16 at offset 14
            }
            // Use parsed regions from this import, or fall back to current state
            const regionsForLookup = (fileContents["descr_regions.txt"] ? parseDescrRegions(fileContents["descr_regions.txt"]) : regions);
            const resources = parseDescrStratResources(text, mapHeight, tgaBin, regionsForLookup);
            const resCount = Object.keys(resources).length;
            if (resCount > 0) {
              if (canSave) await window.electronAPI.saveFile(camp.out.resources, JSON.stringify(resources));
              if (isActiveCampaign(camp)) setResourcesData(resources);
              updated.push(`resources (${resCount})`);
            }
            // Extract armies from descr_strat.txt
            const armies = parseDescrStratArmies(text);
            if (armies.length > 0) {
              if (canSave) await window.electronAPI.saveFile(camp.out.armies, JSON.stringify(armies));
              if (isActiveCampaign(camp)) setArmiesData(armies);
              updated.push(`armies (${armies.length})`);
              // Pre-compute {region: [armies]} using the map_regions.tga
              // pixel lookup. A settlement's tile is the BLACK (0,0,0) pixel
              // inside the region's colored area — only armies sitting on
              // that exact tile are the GARRISON; others in the same region
              // are field armies and shouldn't clutter the city view.
              if (tgaBin && regionsForLookup) {
                const ab = tgaBin instanceof ArrayBuffer ? tgaBin : (tgaBin.buffer || tgaBin);
                const view = new DataView(ab);
                const idLen = view.getUint8(0);
                const w = view.getUint16(12, true);
                const h = view.getUint16(14, true);
                const bpp = view.getUint8(16);
                const bytesPerPx = bpp / 8;
                const dataOff = 18 + idLen;
                const descriptor = view.getUint8(17);
                const topDown = (descriptor & 0x20) !== 0;
                const bytes = new Uint8Array(ab);
                const rgbToRegion = {};
                for (const [rgb, r] of Object.entries(regionsForLookup)) {
                  if (r.region) rgbToRegion[rgb] = r.region;
                }
                // Map strat (x, y) → buffer row. TGAs can be top-down or
                // bottom-up; strat y=0 is the bottom, so bottom-up matches
                // buffer rows directly and top-down needs flipping.
                const bufRow = (stratY) => topDown ? (h - 1 - stratY) : stratY;
                const pixelRgb = (stratX, stratY) => {
                  const by = bufRow(stratY);
                  if (stratX < 0 || stratX >= w || by < 0 || by >= h) return null;
                  const idx = dataOff + (by * w + stratX) * bytesPerPx;
                  return bytes[idx + 2] + "," + bytes[idx + 1] + "," + bytes[idx];
                };
                // 1) Find each region's settlement tile (black pixel with a
                // region-coloured neighbour).
                const settlementByRegion = {};
                for (let by = 0; by < h; by++) {
                  for (let x = 0; x < w; x++) {
                    const i = dataOff + (by * w + x) * bytesPerPx;
                    if (bytes[i] !== 0 || bytes[i+1] !== 0 || bytes[i+2] !== 0) continue;
                    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                      const nx = x + dx, ny = by + dy;
                      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                      const j = dataOff + (ny * w + nx) * bytesPerPx;
                      const key = bytes[j+2] + "," + bytes[j+1] + "," + bytes[j];
                      const reg = rgbToRegion[key];
                      if (reg) {
                        const stratY = topDown ? (h - 1 - by) : by;
                        if (!settlementByRegion[reg]) settlementByRegion[reg] = { x, y: stratY };
                        break;
                      }
                    }
                  }
                }
                // 2) Classify each army as garrison (on settlement tile) or
                // field (inside region but elsewhere). Characters sitting on
                // the settlement tile have pixel_rgb (0,0,0) — we match by
                // coords not color for those.
                const tileKeyToRegion = {};
                for (const [reg, p] of Object.entries(settlementByRegion)) {
                  tileKeyToRegion[`${p.x},${p.y}`] = reg;
                }
                const byRegion = {}; // { region: { garrison: [armies], field: [armies], settlement: {x,y} } }
                // Seed the settlement tile coords for every region we found.
                for (const [reg, p] of Object.entries(settlementByRegion)) {
                  byRegion[reg] = { garrison: [], field: [], settlement: p };
                }
                for (const a of armies) {
                  // Synthetic garrisoned_army entries (no x/y, but carry a
                  // `region` field) — pin to the settlement tile.
                  if (a._garrisoned && a.region) {
                    const tile = settlementByRegion[a.region];
                    if (!byRegion[a.region]) byRegion[a.region] = { garrison: [], field: [], settlement: tile || null };
                    byRegion[a.region].garrison.push({
                      ...a,
                      x: tile?.x ?? null,
                      y: tile?.y ?? null,
                    });
                    continue;
                  }
                  if (a.x == null || a.y == null) continue;
                  let region = tileKeyToRegion[`${a.x},${a.y}`];
                  let isGarrison = !!region;
                  if (!region) {
                    const rgb = pixelRgb(a.x, a.y);
                    region = rgb && rgbToRegion[rgb];
                  }
                  if (!region) continue; // in sea or unowned
                  if (!byRegion[region]) byRegion[region] = { garrison: [], field: [], settlement: settlementByRegion[region] || null };
                  byRegion[region][isGarrison ? "garrison" : "field"].push(a);
                }
                const startingFile = camp.out.armies.replace(/armies_/, "starting_armies_");
                if (canSave) await window.electronAPI.saveFile(startingFile, JSON.stringify(byRegion));
                if (isActiveCampaign(camp)) setStartingArmiesByRegion(byRegion);
                const regionCount = Object.keys(byRegion).length;
                updated.push(`starting garrisons (${regionCount} regions)`);
              }
            }
          }
          if (fileContents["descr_win_conditions.txt"]) {
            const text = fileContents["descr_win_conditions.txt"];
            const vc = parseVictoryConditions(text);
            const vcCount = Object.keys(vc).length;
            if (vcCount > 0) {
              if (canSave) await window.electronAPI.saveFile(camp.out.win, text);
              if (isActiveCampaign(camp)) setVictoryConditions(vc);
              updated.push(`win conditions (${vcCount})`);
            }
          }
          if (fileContents["descr_sm_factions.txt"]) {
            const rawText = fileContents["descr_sm_factions.txt"];
            const parsed = parseSmFactions(rawText);
            const count = Object.keys(parsed).length;
            if (count > 0) {
              setFactionColors(parsed);
              if (isElectron) {
                if (window.electronAPI.saveFile) await window.electronAPI.saveFile("descr_sm_factions.txt", rawText);
                if (window.electronAPI.saveUserFile) await window.electronAPI.saveUserFile("faction_colors.json", JSON.stringify(parsed));
              }
              updated.push(`faction colours (${count})`);
            }
          }
          // Handle map_regions.tga — from sourcePaths (Electron copy) or binaryContents (browser/memory)
          const tgaBinary = binaryContents["map_regions.tga"];
          if (sourcePaths && sourcePaths["map_regions.tga"]) {
            if (canSave) await window.electronAPI.copyFile(sourcePaths["map_regions.tga"], camp.out.map);
          }
          if (tgaBinary && isActiveCampaign(camp)) {
            try {
              const decoded = await decodeTgaAsync(tgaBinary);
              const off = document.createElement("canvas");
              off.width = decoded.width;
              off.height = decoded.height;
              const offCtx = off.getContext("2d", { willReadFrequently: true });
              offCtx.putImageData(new ImageData(decoded.data, decoded.width, decoded.height), 0, 0);
              pixelDataRef.current = offCtx.getImageData(0, 0, decoded.width, decoded.height).data;
              setImgSize({ width: decoded.width, height: decoded.height });
              setOffscreen(off);
              updated.push("map");
            } catch (e) {
              console.error("Failed to decode map_regions.tga:", e);
            }
          } else if (sourcePaths && sourcePaths["map_regions.tga"]) {
            updated.push("map (saved)");
          }
          return { updated, found, missing };
        };

        // Reads files from a single discovered campaign and applies them to a target slot
        const importCampaignFiles = async (campaignResult, camp) => {
          setStatus(camp.suffix, `Reading ${formatCampaignName(campaignResult.name)}...`, "#888");
          const fileContents = {};
          const binaryContents = {};
          const sourcePaths = {};
          for (const [name, filePath] of Object.entries(campaignResult.found)) {
            if (name === "map_regions.tga") {
              sourcePaths[name] = filePath;
              const buf = await window.electronAPI.readFileBinary(filePath);
              if (buf) binaryContents[name] = buf;
            } else {
              const text = await window.electronAPI.readFile(filePath);
              if (text) fileContents[name] = text;
            }
          }
          // Remember which RR campaign this import came from so Live mode
          // can default to the right logs/saves folder. Sniff the source
          // paths for `/alexander/` or `/bi/` path segments (case-insensitive);
          // if neither, the import is from vanilla Rome. Also invalidate any
          // previously-saved liveLogDir that points at a DIFFERENT campaign —
          // otherwise the stale path wins and the watcher stays on Rome even
          // after you import Alex.
          try {
            const allPaths = Object.values(campaignResult.found || {}).join("\n").toLowerCase().replace(/\\/g, "/");
            let importedCampaign = "Rome";
            if (/\/alexander\//.test(allPaths)) importedCampaign = "Alexander";
            else if (/\/bi\//.test(allPaths) || /\/barbarian[ _]invasion\//.test(allPaths)) importedCampaign = "Barbarian Invasion";
            const prev = localStorage.getItem("importedCampaign");
            localStorage.setItem("importedCampaign", importedCampaign);
            console.log("[import] detected campaign:", importedCampaign, "(previous:", prev + ")");
            // If a saved log dir exists but doesn't match the new campaign,
            // clear it so the next Live click runs auto-detect afresh.
            try {
              const saved = localStorage.getItem("liveLogDir") || "";
              const norm = saved.toLowerCase().replace(/\\/g, "/");
              const matchesNew = norm.includes("/" + importedCampaign.toLowerCase() + "/");
              if (saved && !matchesNew) {
                console.log("[import] clearing stale liveLogDir:", saved);
                localStorage.removeItem("liveLogDir");
                setLiveLogDir(null);
                pushToast(`Import is from ${importedCampaign}. Click Live again to track its saves.`, "info");
              }
            } catch {}
          } catch {}
          const foundNames = Object.keys(campaignResult.found);
          const missingNames = NEEDED_FILES.filter(n => !foundNames.includes(n));
          const res = await applyFiles(fileContents, binaryContents, camp, sourcePaths);
          if (res.updated.length > 0) {
            // Update the campaign label to match the imported folder name
            const prettyName = formatCampaignName(campaignResult.name);
            setCampaignLabels(prev => ({ ...prev, [camp.key]: prettyName }));
            setStatus(camp.suffix, `Done — ${prettyName}: ${res.updated.join(", ")}` + (missingNames.length > 0 ? ` | Not found: ${missingNames.join(", ")}` : ""), "#7c4");
            setFileImportDone(true);
          } else {
            setStatus(camp.suffix, `No data parsed. Found: ${foundNames.join(", ") || "none"}`, "#c44");
          }
        };

        // Electron: native folder dialog — scans mod root, shows picker if multiple campaigns
        const handleElectronSelect = async (camp) => {
          setStatus(camp.suffix, "Selecting folder...", "#888");
          setImportPicker(null);
          const result = await window.electronAPI.selectFolder();
          if (!result) { setStatus(camp.suffix, "Cancelled.", "#888"); return; }

          if (!result.campaigns || result.campaigns.length === 0) {
            setStatus(camp.suffix, "No campaign data found in folder.", "#c44");
            return;
          }

          // Auto-import shared files (descr_sm_factions.txt) if found
          if (result.sharedFound && result.sharedFound["descr_sm_factions.txt"]) {
            const text = await window.electronAPI.readFile(result.sharedFound["descr_sm_factions.txt"]);
            if (text) {
              const parsed = parseSmFactions(text);
              const count = Object.keys(parsed).length;
              if (count > 0) {
                setFactionColors(parsed);
                if (window.electronAPI.saveFile) await window.electronAPI.saveFile("descr_sm_factions.txt", text);
                if (window.electronAPI.saveUserFile) await window.electronAPI.saveUserFile("faction_colors.json", JSON.stringify(parsed));
                const el = document.getElementById("dev-status-smfactions");
                if (el) { el.textContent = `Auto-loaded ${count} faction colours`; el.style.color = "#7c4"; }
              }
            }
          }

          // Auto-detect faction icons directory
          if (window.electronAPI?.findFactionIconsDir) {
            const iconsDir = await window.electronAPI.findFactionIconsDir(result.dir);
            if (iconsDir) {
              setModIconsDir(iconsDir);
              try { localStorage.setItem("modIconsDir", iconsDir); } catch {}
            }
          }

          if (result.campaigns.length === 1) {
            await importCampaignFiles(result.campaigns[0], camp);
          } else {
            setStatus(camp.suffix, `Found ${result.campaigns.length} campaigns — pick one:`, "#e8a030");
            setImportPicker({ suffix: camp.suffix, campaigns: result.campaigns, camp });
          }
        };

        // Browser fallback: webkitdirectory input
        const findFile = (files, name) => {
          const lower = name.toLowerCase();
          for (const f of files) {
            const fname = (f.webkitRelativePath || f.name).split("/").pop().toLowerCase();
            if (fname === lower) return f;
          }
          return null;
        };
        const handleBrowserSelect = async (e, camp) => {
          const allFiles = [...e.target.files];
          if (!allFiles.length) return;
          setStatus(camp.suffix, "Processing...", "#888");
          const fileContents = {};
          const binaryContents = {};
          for (const name of NEEDED_FILES) {
            const file = findFile(allFiles, name);
            if (!file) continue;
            if (name === "map_regions.tga") {
              binaryContents[name] = await file.arrayBuffer();
            } else {
              fileContents[name] = await readFileAsText(file);
            }
          }
          const res = await applyFiles(fileContents, binaryContents, camp, null);
          if (res.updated.length > 0) {
            setStatus(camp.suffix, `Done — ${res.updated.join(", ")}` + (res.missing.length > 0 ? ` | Missing: ${res.missing.join(", ")}` : ""), "#7c4");
            setFileImportDone(true);
          } else {
            setStatus(camp.suffix, "No recognised files found.", "#c44");
          }
        };

        return (
          <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) setShowFileImport(false); }}>
            <div style={modalStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h2 style={{ margin: 0, color: "#e8a030", fontSize: "1.2rem" }}>Update Data Files</h2>
                <button onClick={() => setShowFileImport(false)} style={{
                  background: "none", border: "none", color: "#888", fontSize: "1.4rem", cursor: "pointer",
                }}>&times;</button>
              </div>
              <p style={{ color: "#aaa", fontSize: "0.82rem", marginTop: 0, marginBottom: 12 }}>
                Select the campaign folder. The app finds and loads only these files:
              </p>
              <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 6, padding: "8px 12px", marginBottom: 16, fontSize: "0.78rem" }}>
                {expectedFiles.map((f) => (
                  <div key={f.name} style={{ display: "flex", gap: 8, padding: "3px 0" }}>
                    <span style={{ color: "#e8a030", fontWeight: 600, minWidth: 180 }}>{f.name}</span>
                    <span style={{ color: "#888" }}>{f.desc}</span>
                  </div>
                ))}
              </div>
              {campaigns.map((camp) => {
                const isActive = mapCampaign === camp.key;
                return (
                  <div key={camp.key} style={sectionStyle(isActive)}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: "1rem", color: isActive ? "#e8a030" : "#888" }}>
                          {camp.label}
                        </span>
                        {isActive && <span style={{ fontSize: "0.75rem", color: "#e8a030", marginLeft: 8 }}>(active)</span>}
                      </div>
                      {isElectron ? (
                        <button onClick={() => handleElectronSelect(camp)} style={{
                          padding: "5px 14px", borderRadius: 6, border: "1px solid #e8a030",
                          background: "rgba(232,160,48,0.15)", color: "#e8a030", fontWeight: 600,
                          cursor: "pointer", fontSize: "0.82rem",
                        }}>Select Folder</button>
                      ) : (
                        <input type="file" webkitdirectory="" directory="" multiple
                          onChange={(e) => handleBrowserSelect(e, camp)}
                          style={{ fontSize: "0.78rem", maxWidth: 260 }} />
                      )}
                    </div>
                    <div id={`dev-status-${camp.suffix}`} style={{ fontSize: "0.75rem", color: "#666", minHeight: 18 }}></div>
                    {importPicker && importPicker.suffix === camp.suffix && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {importPicker.campaigns.map((c) => {
                          const fileCount = Object.keys(c.found).length;
                          return (
                            <button key={c.name} onClick={async () => {
                              setImportPicker(null);
                              await importCampaignFiles(c, importPicker.camp);
                            }} style={{
                              padding: "5px 12px", borderRadius: 6, border: "1px solid #e8a030",
                              background: "rgba(232,160,48,0.12)", color: "#e8a030", fontWeight: 600,
                              cursor: "pointer", fontSize: "0.78rem",
                            }}>{formatCampaignName(c.name)} ({fileCount} files)</button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Shared file: descr_sm_factions.txt */}
              <div style={{ padding: "12px 16px", marginBottom: 8, borderRadius: 8, border: "1px solid #555", background: "rgba(255,255,255,0.02)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: "1rem", color: "#aaa" }}>Shared: descr_sm_factions.txt</span>
                    <div style={{ fontSize: "0.72rem", color: "#666" }}>Faction colours — shared across campaigns</div>
                  </div>
                  {isElectron ? (
                    <button onClick={async () => {
                      const result = await window.electronAPI.selectFolder();
                      if (!result) return;
                      // Find descr_sm_factions.txt — check sharedFound first, then campaign dirs
                      let filePath = result.sharedFound && result.sharedFound["descr_sm_factions.txt"];
                      if (!filePath && result.campaigns) {
                        for (const c of result.campaigns) {
                          if (c.found["descr_sm_factions.txt"]) { filePath = c.found["descr_sm_factions.txt"]; break; }
                        }
                      }
                      if (!filePath) {
                        const el = document.getElementById("dev-status-smfactions");
                        if (el) { el.textContent = "descr_sm_factions.txt not found in folder"; el.style.color = "#c44"; }
                        return;
                      }
                      const text = await window.electronAPI.readFile(filePath);
                      if (text) {
                        const parsed = parseSmFactions(text);
                        const count = Object.keys(parsed).length;
                        if (count > 0) {
                          setFactionColors(parsed);
                          if (window.electronAPI.saveFile) await window.electronAPI.saveFile("descr_sm_factions.txt", text);
                          if (window.electronAPI.saveUserFile) await window.electronAPI.saveUserFile("faction_colors.json", JSON.stringify(parsed));
                          const el = document.getElementById("dev-status-smfactions");
                          if (el) { el.textContent = `Done — ${count} factions`; el.style.color = "#7c4"; }
                          setFileImportDone(true);
                        }
                      }
                    }} style={{
                      padding: "5px 14px", borderRadius: 6, border: "1px solid #e8a030",
                      background: "rgba(232,160,48,0.15)", color: "#e8a030", fontWeight: 600,
                      cursor: "pointer", fontSize: "0.82rem",
                    }}>Select Folder</button>
                  ) : (
                    <input type="file" accept=".txt" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const text = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsText(file); });
                      const parsed = parseSmFactions(text);
                      const count = Object.keys(parsed).length;
                      if (count > 0) {
                        setFactionColors(parsed);
                        const el = document.getElementById("dev-status-smfactions");
                        if (el) { el.textContent = `Done — ${count} factions`; el.style.color = "#7c4"; }
                        setFileImportDone(true);
                      }
                    }} style={{ fontSize: "0.78rem", maxWidth: 220 }} />
                  )}
                </div>
                <div id="dev-status-smfactions" style={{ fontSize: "0.75rem", color: "#666", minHeight: 18 }}></div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                {!fileImportDone && (
                  <button onClick={() => setShowFileImport(false)} style={{
                    padding: "6px 16px", borderRadius: 6, border: "1px solid #555",
                    background: "#333", color: "#ccc", cursor: "pointer",
                  }}>Cancel</button>
                )}
                {fileImportDone && (
                  <button onClick={() => { setShowFileImport(false); window.location.reload(); }} style={{
                    padding: "6px 16px", borderRadius: 6, border: "1px solid #e8a030",
                    background: "#e8a030", color: "#1a1a1a", fontWeight: 700, cursor: "pointer",
                  }}>Done</button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
      {infoPopup && (
        <InfoPopup
          payload={infoPopup}
          modDataDir={modDataDir}
          factionDisplayNames={factionDisplayNames}
          devMode={devMode}
          onClose={() => setInfoPopup(null)}
        />
      )}
      {showWealthPanel && (() => {
        // Faction Wealth panel — sortable list of factions with starting
        // treasury (from descr_strat) and region count (from
        // factionRegionsMap). Click a row to zoom-fit that faction's
        // territory. Esc / outside click / X-button close it.
        // Live counts when a save is loaded — overlays the starting
        // descr_strat numbers with what the parser reads from the save now.
        // armiesByFaction is built from saveLiveArmies; regionsByFaction
        // (live) from currentOwnerByCity; unitsByFaction by counting
        // units whose army-faction or settlement-owner matches.
        const liveArmiesByFaction = {};
        for (const a of (saveLiveArmies || [])) {
          const f = (a.faction || "").toLowerCase();
          if (!f || f === "unknown") continue;
          liveArmiesByFaction[f] = (liveArmiesByFaction[f] || 0) + 1;
        }
        const liveRegionsByFaction = {};
        if (currentOwnerByCity) {
          for (const owner of Object.values(currentOwnerByCity)) {
            liveRegionsByFaction[owner] = (liveRegionsByFaction[owner] || 0) + 1;
          }
        }
        // Live treasury: map the raw 23-record scan to faction names using
        // the descr_strat RIS imperial major-faction order. Player at
        // index 0 (always), others follow descr_strat with player removed.
        // Decoded by save-cracker session 5 (CONFIRMED across 14 saves /
        // 4 campaigns). Falls back gracefully to descr_strat starting
        // wealth when live data isn't loaded yet or count != 23.
        const liveTreasuryByFaction = (() => {
          const recs = saveTreasuryRecords && saveTreasuryRecords.records;
          if (!recs || recs.length !== 23 || !playerFaction) return null;
          const MAJOR_FACTIONS = [
            "romans_julii", "carthage", "antigonid", "ptolemaic", "seleucid",
            "bactria", "parni", "saka", "armenia", "pontus", "lusitani",
            "getae", "acarnania", "achaea", "acragas", "aedui", "aetolia",
            "allobroges", "anatolians", "arevaci", "ardiaei", "argos",
            "arverni",
          ];
          const out = {};
          const others = MAJOR_FACTIONS.filter(f => f !== playerFaction);
          out[playerFaction] = { treasury: recs[0].treasury, turnStart: recs[0].turnStart };
          for (let k = 0; k < others.length && k + 1 < recs.length; k++) {
            out[others[k]] = { treasury: recs[k + 1].treasury, turnStart: recs[k + 1].turnStart };
          }
          return out;
        })();
        const rows = factions.map(f => {
          const lf = f.toLowerCase();
          const liveRegions = liveRegionsByFaction[lf];
          const liveArmies = liveArmiesByFaction[lf];
          const startRegions = (factionRegionsMap[f] || []).length;
          // Prefer live treasury when available; fall back to descr_strat
          // starting wealth. The live value carries a sign (bankruptcy
          // shows as negative).
          const liveTreasury = liveTreasuryByFaction && liveTreasuryByFaction[lf];
          const wealth = liveTreasury ? liveTreasury.treasury : (factionWealth[f] ?? 0);
          return {
            faction: f,
            wealth,
            wealthIsLive: !!liveTreasury,
            wealthTurnStart: liveTreasury ? liveTreasury.turnStart : null,
            regions: liveRegions != null ? liveRegions : startRegions,
            startingRegions: startRegions,
            armies: liveArmies || 0,
            isLive: liveLogActive && liveRegions != null,
            name: (factionDisplayNames && factionDisplayNames[f]) || f.replace(/_/g, " "),
          };
        }).filter(r => r.regions > 0 || r.wealth !== 0);
        rows.sort((a, b) => b.regions - a.regions || b.wealth - a.wealth);
        const jumpToFaction = (f) => {
          const keys = regionNamesToKeys(regionsForFaction(f));
          const pts = keys.map(k => regionCentroids[k]).filter(Boolean);
          if (pts.length === 0) return;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of pts) {
            minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
          }
          const pad = 20;
          const bw = (maxX - minX) + pad * 2;
          const bh = (maxY - minY) + pad * 2;
          const baseScale = Math.max(canvasSize.width / imgSize.width, canvasSize.height / imgSize.height);
          const fitZoom = Math.max(1, Math.min(maxZoom, Math.min(
            canvasSize.width / (bw * baseScale),
            canvasSize.height / (bh * baseScale),
          )));
          const ts = baseScale * fitZoom;
          const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
          const imgW = imgSize.width * ts, imgH = imgSize.height * ts;
          const bxOff = (canvasSize.width - imgW) / 2;
          const byOff = (canvasSize.height - imgH) / 2;
          let ox = canvasSize.width / 2 - cx * ts - bxOff;
          let oy = canvasSize.height / 2 - cy * ts - byOff;
          if (imgW > canvasSize.width) ox = Math.max(canvasSize.width - imgW - bxOff, Math.min(-bxOff, ox)); else ox = 0;
          if (imgH > canvasSize.height) oy = Math.max(canvasSize.height - imgH - byOff, Math.min(-byOff, oy)); else oy = 0;
          setZoom(fitZoom);
          setOffset({ x: ox, y: oy });
          setFactionSelection(f, false);
        };
        return createPortal(
          <div onClick={() => setShowWealthPanel(false)} style={{
            position: "fixed", inset: 0, zIndex: 9990,
            background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{
              background: "rgba(28,24,18,0.97)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 10,
              padding: "12px 0",
              width: "min(540px, 90vw)",
              maxHeight: "80vh",
              boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
              color: "#f4f4f4",
              display: "flex", flexDirection: "column",
            }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}>
                <span style={{ fontWeight: 700, fontSize: "1rem", color: "#dca64a" }}>
                  💰 Faction Wealth
                </span>
                <button onClick={() => setShowWealthPanel(false)}
                  style={{ background: "transparent", border: "none", color: "#aaa", fontSize: "1.1rem", cursor: "pointer", padding: 0 }}
                  title="Close (Esc)">×</button>
              </div>
              <div style={{ overflowY: "auto", padding: "4px 8px" }}>
                <div style={{
                  display: "grid", gridTemplateColumns: "28px 1fr 90px 70px 60px",
                  fontSize: "0.7rem", color: "#999", padding: "4px 8px",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                }}>
                  <span></span><span>Faction</span>
                  <span style={{ textAlign: "right" }}>Treasury</span>
                  <span style={{ textAlign: "right" }}>Regions</span>
                  <span style={{ textAlign: "right" }}>Armies</span>
                </div>
                {rows.map((r, i) => (
                  <div key={r.faction}
                    onClick={() => jumpToFaction(r.faction)}
                    style={{
                      display: "grid", gridTemplateColumns: "28px 1fr 90px 70px 60px",
                      alignItems: "center", padding: "4px 8px", borderRadius: 6,
                      cursor: "pointer", fontSize: "0.85rem",
                      background: selectedFaction === r.faction ? "rgba(220,166,74,0.18)" : "transparent",
                      transition: "background 120ms var(--ease-mac-out)",
                    }}
                    onMouseEnter={(e) => { if (selectedFaction !== r.faction) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                    onMouseLeave={(e) => { if (selectedFaction !== r.faction) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ color: "#888", textAlign: "right", paddingRight: 4, fontSize: "0.75rem" }}>{i + 1}</span>
                    <span style={{ textTransform: "capitalize" }}>{r.name}</span>
                    <span style={{ textAlign: "right", color: r.wealth < 0 ? "#e85050" : r.wealth >= 5000 ? "#9ec78a" : r.wealth >= 1000 ? "#f4cd57" : "#e89030", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}
                      title={r.wealthIsLive
                        ? `Live treasury from save (decoded 2026-05-10 via save-cracker session 5). ${typeof r.wealthTurnStart === "number" && r.wealthTurnStart !== r.wealth ? `Started this turn at ${r.wealthTurnStart.toLocaleString()}, mid-turn delta ${(r.wealth - r.wealthTurnStart >= 0 ? "+" : "") + (r.wealth - r.wealthTurnStart).toLocaleString()}.` : ""}`
                        : "Starting denarii from descr_strat. Live treasury not loaded (no save active, or non-RIS-imperial campaign)."}>
                      {r.wealth.toLocaleString()}
                      {r.wealthIsLive && <span style={{ color: "#4a8", marginLeft: 4, fontSize: "0.7rem", fontWeight: 400 }}>·live</span>}
                    </span>
                    <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums",
                                   color: r.isLive ? (r.regions > r.startingRegions ? "#9ec78a" : r.regions < r.startingRegions ? "#e89030" : "#bbb") : "#bbb" }}
                      title={r.isLive
                        ? `Live: ${r.regions} (started with ${r.startingRegions})`
                        : "Starting region count from descr_strat"}>
                      {r.regions}
                      {r.isLive && r.regions !== r.startingRegions && (
                        <span style={{ fontSize: "0.65rem", marginLeft: 2, opacity: 0.8 }}>
                          {r.regions > r.startingRegions ? "↑" : "↓"}
                        </span>
                      )}
                    </span>
                    <span style={{ textAlign: "right", color: r.armies > 0 ? "#bbb" : "#555", fontVariantNumeric: "tabular-nums" }}
                      title={r.isLive ? `Field armies the parser placed on the map` : "Live mode shows army counts"}>
                      {r.isLive ? r.armies : "—"}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ padding: "8px 16px 0", fontSize: "0.7rem", color: "#888", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                Treasury = starting denari from descr_strat. Click a row to zoom to that faction's territory.
              </div>
            </div>
          </div>,
          document.body
        );
      })()}
      {showStatsPanel && saveLuaCounters && saveLuaCounters.count > 0 && (() => {
        // Campaign Stats panel — surfaces the lua persistent-counter table
        // decoded by save-cracker session 23 (rtw-sav-parser). 115 counters
        // in RIS imperial: faction-ID hashes (filtered out — lookup
        // constants), military counters (num_battles_*, num_mercs_*),
        // per-faction reform-battle progress (Marian-style unlocks),
        // rebellion script state, misc setup flags.
        const all = saveLuaCounters.byName || {};
        const entries = Object.entries(all);
        const groups = {
          campaign: [],   // turn_number, setup, game_reloaded, first_time
          military: [],   // num_battles_*, num_mercs_recruited_*
          reform: [],     // *_reform_battle_counter, *_reform_settlement, *_reform_ready, *Reform*
          rebellion: [],  // *Rebellion_*
          capital: [],    // *capital*
          misc: [],
        };
        for (const [name, value] of entries) {
          if (/^id_/.test(name)) continue;
          if (/^turn_number$|setup|game_reloaded|first_time/.test(name)) groups.campaign.push([name, value]);
          else if (/^num_battles_|^num_mercs_recruited_/.test(name)) groups.military.push([name, value]);
          else if (/_reform_battle_counter$|_reform_settlement|_reform_ready|Reform/.test(name)) groups.reform.push([name, value]);
          else if (/[Rr]ebellion_/.test(name)) groups.rebellion.push([name, value]);
          else if (/capital/.test(name)) groups.capital.push([name, value]);
          else groups.misc.push([name, value]);
        }
        const sortByValueDesc = (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]);
        const sortByName = (a, b) => a[0].localeCompare(b[0]);
        groups.military.sort(sortByValueDesc);
        groups.reform.sort(sortByValueDesc);
        groups.rebellion.sort(sortByValueDesc);
        groups.capital.sort(sortByName);
        groups.misc.sort(sortByValueDesc);
        groups.campaign.sort(sortByName);
        const totalShown = Object.values(groups).reduce((s, g) => s + g.length, 0);
        const idHashCount = entries.filter(([k]) => /^id_/.test(k)).length;
        const Section = ({ title, hint, rows }) => {
          if (rows.length === 0) return null;
          return (
            <div style={{ marginBottom: 10 }}>
              <div style={{
                fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.04em",
                color: "#dca64a", padding: "6px 12px 4px",
                textTransform: "uppercase",
              }}>
                {title}
                <span style={{ marginLeft: 8, fontWeight: 400, color: "#888", textTransform: "none", letterSpacing: 0 }}>
                  {rows.length} {hint ? `· ${hint}` : ""}
                </span>
              </div>
              {rows.map(([name, value]) => (
                <div key={name} style={{
                  display: "grid", gridTemplateColumns: "1fr 90px",
                  alignItems: "center", padding: "2px 12px",
                  fontSize: "0.8rem", fontFamily: "Consolas, monospace",
                }}>
                  <span style={{ color: "#ddd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}
                  </span>
                  <span style={{
                    textAlign: "right", fontVariantNumeric: "tabular-nums",
                    color: value === 0 ? "#666" : value < 0 ? "#e85050" : "#9ec78a",
                    fontWeight: 600,
                  }}>
                    {value.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          );
        };
        return createPortal(
          <div onClick={() => setShowStatsPanel(false)} style={{
            position: "fixed", inset: 0, zIndex: 9990,
            background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{
              background: "rgba(28,24,18,0.97)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 10,
              padding: "12px 0",
              width: "min(540px, 90vw)",
              maxHeight: "80vh",
              boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
              color: "#f4f4f4",
              display: "flex", flexDirection: "column",
            }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}>
                <span style={{ fontWeight: 700, fontSize: "1rem", color: "#dca64a" }}>
                  📜 Campaign Stats
                </span>
                <button onClick={() => setShowStatsPanel(false)}
                  style={{ background: "transparent", border: "none", color: "#aaa", fontSize: "1.1rem", cursor: "pointer", padding: 0 }}
                  title="Close (Esc)">×</button>
              </div>
              <div style={{ overflowY: "auto", padding: "4px 0" }}>
                <Section title="Campaign" rows={groups.campaign} hint="turn + setup" />
                <Section title="Military" rows={groups.military} hint="battles + mercenary recruitment" />
                <Section title="Reform progress" rows={groups.reform} hint="per-faction Marian-style unlocks" />
                <Section title="Rebellion state" rows={groups.rebellion} hint="script-driven regional revolt counters" />
                <Section title="Capital" rows={groups.capital} />
                <Section title="Misc" rows={groups.misc} />
              </div>
              <div style={{ padding: "8px 16px 0", fontSize: "0.7rem", color: "#888", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                {totalShown} counters shown · {idHashCount} faction-ID hashes hidden · decoded by save-cracker session 23
              </div>
            </div>
          </div>,
          document.body
        );
      })()}
    </>
  );
}

export default App;