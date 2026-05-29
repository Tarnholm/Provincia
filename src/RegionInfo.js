import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import FactionIcon from "./FactionIcon";
import { Movable } from "./Movable";
import { loadPortrait, getCachedPortrait } from "./portraitIcons";
import { displayFirstName, displayFullName } from "./displayName";
import { loadBuildingIcon, invalidateBuildingIcon } from "./buildingIcons";
import AddGeneralModal from "./AddGeneralModal";
import DiplomacyEditor from "./DiplomacyEditor";

// Map a raw core_attitudes value to its descr_strat tier name (see the
// descr_strat diplomacy legend: -10 Locked Allied … 1000+ Crazy War).
function dsAttitudeLabel(v) {
  if (v == null) return "—";
  if (v < 0) return "Locked Allied";
  if (v === 0) return "Allied";
  if (v < 200) return "Suspicious";
  if (v === 200) return "Neutral";
  if (v < 400) return "Cooling";
  if (v < 600) return "Hostile";
  if (v < 850) return "At War";
  if (v < 1000) return "Total War";
  return "Crazy War";
}

// Inline treasury-over-time sparkline (0.9.549) from the cracked f13 per-turn
// checkpoint timeline. Green if the faction's wealth ended up vs its start.
function TreasurySparkline({ series, width = 130, height = 26 }) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const min = Math.min(...series), max = Math.max(...series), span = (max - min) || 1;
  const stepX = width / (series.length - 1);
  const y = (v) => (height - 2 - ((v - min) / span) * (height - 4));
  const pts = series.map((v, i) => `${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = series[series.length - 1] >= series[0];
  const col = up ? "#9ec78a" : "#e89030";
  return (
    <svg width={width} height={height} style={{ display: "block" }} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={((series.length - 1) * stepX).toFixed(1)} cy={y(series[series.length - 1]).toFixed(1)} r="2" fill={col} />
    </svg>
  );
}

// Renders a character portrait blob. Two paths:
//   - savePath set (RIS imperial via 0.9.397+ coord bridge → 0.9.406 RIS
//     cultures) — IPC fast-path loads that exact file. Engine-exact match.
//   - savePath null (vanilla) — IPC hashes the character name + faction +
//     age to pick from the right culture's portrait pool. Stable per-char,
//     matches what RTW would have rendered for the same character.
// Both flows go through loadPortrait/getCachedPortrait so cache hits across
// re-renders.
function CommanderPortraitImg({ charContext, culture, modDataDir, fallback, style }) {
  const slot = "general";
  // 0.9.464: TWO BUGS were stacking to produce the "garrison Antigonos II
  // = Roman portrait" symptom:
  //   1. Defaulting cultureKey to "roman" when culture was null/undefined.
  //      The first render of a bodyguard unit (before commanderInfo finishes
  //      populating) had culture=null → loaded roman/general/038.tga.
  //   2. useEffect's `if (!url)` guard meant once that wrong URL was set,
  //      changing cultureKey ("w_hellenistic" when info populated next
  //      render) didn't trigger a re-load. The roman blob stayed forever.
  // Fix: no "roman" fallback (return null when culture missing so the
  // unit-icon fallback shows instead), and re-fetch on every dep change.
  const cultureKey = culture ? String(culture).toLowerCase() : null;
  const [url, setUrl] = useState(() => cultureKey ? getCachedPortrait(cultureKey, slot, charContext) : null);
  useEffect(() => {
    if (!charContext || !modDataDir || !cultureKey) {
      // Clear any stale blob URL when ctx/culture goes missing so the
      // fallback (unit icon) shows instead of a previous wrong portrait.
      setUrl(null);
      if (typeof window !== "undefined" && charContext && !window.__bodyguardSwapLogged?.has(`no-ctx|${charContext?.name || "?"}`)) {
        window.__bodyguardSwapLogged ||= new Set();
        window.__bodyguardSwapLogged.add(`no-ctx|${charContext?.name || "?"}`);
        console.log(`[bodyguard-swap] missing culture for "${charContext?.name || "?"}" — falling back to unit icon (no portrait swap)`);
      }
      return;
    }
    let alive = true;
    loadPortrait(modDataDir, cultureKey, slot, charContext).then((u) => {
      if (typeof window !== "undefined" && !window.__bodyguardSwapLogged?.has(`load|${charContext.name}|${cultureKey}`)) {
        window.__bodyguardSwapLogged ||= new Set();
        window.__bodyguardSwapLogged.add(`load|${charContext.name}|${cultureKey}`);
        console.log(`[bodyguard-swap] ${u ? "OK" : "FAIL"} "${charContext.name}" culture="${cultureKey}" savePath="${charContext.savePath || "(none)"}"`);
      }
      if (alive) setUrl(u || null);
    });
    return () => { alive = false; };
  }, [charContext, cultureKey, modDataDir]);
  if (!url) return fallback || null;
  return <img src={url} alt="" style={style} onError={(e) => { e.currentTarget.style.display = "none"; }} />;
}

const PUBLIC_URL = import.meta.env.BASE_URL || "./";

// Religion colors for ethnicity bar (duplicated subset from App.js)
const ETHNICITY_COLORS = {
  macedonian:[55,85,185], dorian:[80,120,200], ionian:[100,150,220],
  aeolian:[120,160,210], arcadian:[90,140,210], epirote:[80,100,180],
  northwest_greek:[80,130,200], greco_bactrian:[55,110,165], indo_greek:[100,130,175],
  bithynian:[110,140,180], cypriot_greek:[80,140,205], pamphylian_greek:[90,150,215],
  celtic:[45,185,75], germanic:[200,155,45], baltic:[55,165,155],
  italic:[205,120,55], iberian:[160,100,60],
  illyrian:[100,145,120], liburnian:[65,145,185],
  delmato_pannonian:[145,65,85], triballian:[110,60,80],
  paeonian:[145,75,110], dardanian:[120,80,50],
  thracian:[190,55,75],
  scythian:[130,75,160], bosporan:[160,75,210], venetic:[125,110,165],
  phoenician:[130,50,170], arab:[215,170,50], assyrian:[160,90,50],
  mesopotamian:[170,120,60], judaean:[170,165,65], libyan:[205,185,75],
  egyptian:[215,180,55], ethiopian:[140,75,55],
  iranian:[185,100,40], armenian:[185,65,65], caucasian:[130,90,50],
  indian:[195,130,50],
  phrygian:[175,100,145], cappadocian:[160,110,80],
  paphlagonian:[140,85,140], mysian:[145,130,100],
  lydian:[195,155,65], carian:[165,85,100],
  lycian:[110,175,150], pisidian:[150,100,80],
  lycaonian:[115,155,80], pamphylian:[95,165,175],
  cilician:[120,100,155], isaurian:[145,110,90],
};
// RTW chevron tiering. exp 1 → 0 chevrons (no display). exp 2-4 → 1-3
// bronze. exp 5-7 → 1-3 silver. exp 8-10 → 1-3 gold.
// Bronze is a clear reddish-brown — at small sizes the previous tan-bronze
// blended with the drop-shadow and read as gold/yellow against bright cards.
const TIER_BRONZE = "#8a4f1f";
const TIER_SILVER = "#bcbfc2";
const TIER_GOLD = "#f5cd3a";
function chevronTier(level /* 1..9 */) {
  if (level >= 7) return TIER_GOLD;
  if (level >= 4) return TIER_SILVER;
  return TIER_BRONZE;
}
function chevronCount(level /* 1..9 */) {
  // Each tier has 3 stages (1, 2, 3 chevrons), then upgrades to next tier.
  return ((level - 1) % 3) + 1;
}
// Armour / weapon upgrades only have 3 stages (1=bronze, 2=silver, 3=gold).
// One icon, colour-only progression — no stacking.
function upgradeTier(lvl /* 1..3 */) {
  if (lvl >= 3) return TIER_GOLD;
  if (lvl >= 2) return TIER_SILVER;
  return TIER_BRONZE;
}

// Inline SVG icons. The ⛨ / ⚔ unicode glyphs aren't in the default Windows
// fonts and rendered as literal "⛨" escape strings on user machines.
// SVGs always render regardless of font coverage.
// Solid SVG icons — no stroke or drop-shadow. At 8px the stroke + black blur
// dominated the fill and made bronze look gold; clean fills read truer.
const ShieldIcon = ({ color, size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="M8 1 L14 3 L14 8 Q14 13 8 15 Q2 13 2 8 L2 3 Z" fill={color} />
  </svg>
);
// 0.9.495: redrawn so the sword actually reads as a sword at 14 px.
// Tip at upper-left (2.5, 2.5), blade points up-left, crossguard at the
// blade's mid-bottom, hilt + pommel extend to lower-right (13, 13). The
// icon sits in the unit card's lower-left so a sword pointing up-left
// "stabs" upward-into-the-card visually.
const SwordIcon = ({ color, size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: "block" }}>
    {/* blade — thin diamond from tip (2,2) to crossguard (10,10) */}
    <path d="M2 2 L2.6 3.6 L10.4 11.4 L11.4 10.4 L3.6 2.6 Z" fill={color} />
    {/* crossguard — short bar perpendicular to blade direction */}
    <path d="M8.5 12.5 L12.5 8.5 L13.5 9.5 L9.5 13.5 Z" fill={color} />
    {/* pommel / grip — small bar continuing past crossguard */}
    <path d="M11 13 L13 11 L14 12 L12 14 Z" fill={color} />
  </svg>
);
// SVG chevron — RTW-style angular V, point facing DOWN (matches the in-game
// experience chevrons). Stack vertically with `count` copies in `color` (the
// tier colour). Text-glyph chevrons (ˇ, ^) were illegible at the 7-8px sizes
// the unit cards demand.
const ChevronStack = ({ color, count }) => (
  <svg width="6" height={Math.max(3, count * 3 + 1)} viewBox={`0 0 16 ${count * 7 + 2}`} style={{ display: "block" }}>
    {Array.from({ length: count }).map((_, i) => (
      <path
        key={i}
        d={`M2 ${i * 7 + 1} L8 ${i * 7 + 5} L14 ${i * 7 + 1}`}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ))}
  </svg>
);

function getEthColor(name) {
  if (ETHNICITY_COLORS[name]) return ETHNICITY_COLORS[name];
  for (const [key, col] of Object.entries(ETHNICITY_COLORS)) {
    if (key.startsWith(name) || name.startsWith(key)) return col;
  }
  return [128,128,128];
}
function parseEth(str) {
  if (!str) return [];
  const parts = str.trim().split(/\s+/);
  const result = [];
  for (let i = 0; i < parts.length - 1; i += 2) {
    const pct = parseInt(parts[i + 1], 10);
    if (!isNaN(pct)) result.push({ name: parts[i], pct });
  }
  return result;
}

let buildingsGetter = (info) => (info && info.buildings ? info.buildings : []);
let buildingsGetterVersion = 0;
export function setBuildingsGetter(fn) {
  buildingsGetter = fn;
  buildingsGetterVersion++;
}
export function getBuildingsGetterVersion() { return buildingsGetterVersion; }

// Module-level cache for the building catalogue (chains + categories). Fetched
// lazily on first dev-mode open per session; subsequent opens reuse this.
let __buildingCatalogueCache = null;
let __buildingCatalogueInflight = null;
function fetchBuildingCatalogueCached() {
  if (__buildingCatalogueCache) return Promise.resolve(__buildingCatalogueCache);
  if (__buildingCatalogueInflight) return __buildingCatalogueInflight;
  if (typeof window === "undefined" || !window.electronAPI?.getBuildingCatalogue) {
    return Promise.resolve(null);
  }
  __buildingCatalogueInflight = window.electronAPI.getBuildingCatalogue()
    .then((cat) => {
      if (cat && cat.chains) {
        __buildingCatalogueCache = cat;
        console.log(`[building-edit] catalogue loaded: ${Object.keys(cat.chains).length} chains`);
      }
      __buildingCatalogueInflight = null;
      return __buildingCatalogueCache;
    })
    .catch((e) => {
      console.log(`[building-edit] catalogue fetch failed: ${e?.message || e}`);
      __buildingCatalogueInflight = null;
      return null;
    });
  return __buildingCatalogueInflight;
}

// Local inlined editBtnStyle — same look as InfoPopup.js TraitsSection but
// sized down for the building cards (smaller cards = smaller buttons).
const buildingEditBtnStyle = {
  background: "rgba(220,166,74,0.22)",
  color: "#eee",
  border: "1px solid rgba(220,166,74,0.45)",
  borderRadius: 3,
  padding: 0,
  width: 14, height: 14,
  fontSize: "0.65rem",
  cursor: "pointer",
  fontWeight: 700,
  lineHeight: 1,
  display: "flex", alignItems: "center", justifyContent: "center",
};

// Categorise a single descr_regions tag token into a logical group so the
// region-info panel can render tags as labelled chip groups instead of one
// flat blob. The categories mirror the dev map modes: terrain / climate /
// irrigation / port / religion / fertility / earthquake-rivertrade. Anything
// left over is treated as a hidden_resource (modder gating token).
const TERRAIN_TAG_SET = new Set([
  "river_valley","floodplains_delta","grassland","mountain_valley","forest",
  "steppe","hills","wetlands","small_islands_and_rocky_coast","plateau",
  "karst_terrain","mountains","desert",
]);
const CLIMATE_TAG_SET = new Set([
  "mediterranean","humid_sub_tropical","monsoon","temperate","oceanic",
  "continental","dry_sub_tropical","cold_semi_arid","alpine","sub_artic",
  "tropical","hot_semi_arid","arid",
]);
const IRRIGATION_TAG_SET = new Set([
  "irrigation_river","irrigation_springs","irrigation_lake","irrigation_aquifer","irrigation_oasis",
]);
function categoriseTag(t) {
  const k = String(t).toLowerCase();
  if (TERRAIN_TAG_SET.has(k)) return "Terrain";
  if (CLIMATE_TAG_SET.has(k)) return "Climate";
  if (IRRIGATION_TAG_SET.has(k)) return "Irrigation";
  if (/^base_port_level_\d+$/.test(k)) return "Port";
  if (/^rel_[a-z_]+_\d+$/.test(k)) return "Religion";
  // Farm## is shown above as the "Fertility:" colour-graded line; skip
  // the duplicate chip group here.
  if (/^Farm\d+$/.test(t)) return null;
  if (k === "earthquake" || k === "rivertrade") return "Hazards & Trade";
  return "Hidden Resource";
}
const CATEGORY_COLOURS = {
  Terrain:            "rgba(110, 180, 100, 0.18)",
  Climate:            "rgba(100, 160, 220, 0.18)",
  Irrigation:         "rgba(60, 200, 220, 0.18)",
  Port:               "rgba(220, 200, 80, 0.18)",
  Religion:           "rgba(190, 110, 200, 0.18)",
  Fertility:          "rgba(220, 160, 60, 0.18)",
  "Hazards & Trade":  "rgba(200, 100, 100, 0.18)",
  "Hidden Resource":  "rgba(200, 200, 200, 0.10)",
};
// Religion deliberately excluded — the ethnicities chart already conveys
// the religious split per region; surfacing rel_*_N as chips too is
// redundant noise.
const CATEGORY_ORDER = ["Terrain", "Climate", "Irrigation", "Port", "Fertility", "Hazards & Trade", "Hidden Resource"];

// Normalize arrays; split comma-delimited strings into individual tags
function listOrEmpty(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    const parts = val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : [val];
  }
  return [val];
}

// Extract label: prefer explicit label, then name, then type; if "(...)" exists, use only the text inside the last parentheses
function labelFrom(raw, idx) {
  return raw?.label || raw?.name || raw?.type || `Building ${idx + 1}`;
}

// Resolve icon paths; supports a single string or an array of candidates.
// Adds .png if missing extension, encodes '#', and prepends /construction/ for bare names.
function resolveIcon(icon) {
  const tryOne = (val) => {
    if (!val) return null;
    let out = String(val).trim();
    if (!out) return null;
    // Blob URLs come from the mod/game icon loader (buildingIcons.js). They
    // are valid <img src> values as-is; pass through.
    if (out.startsWith("blob:") || out.startsWith("data:")) return out;
    if (!/\.(png|jpg|jpeg|gif|webp)$/i.test(out)) out += ".png";

    // Encode literal '#' so files like "#roman_wooden_wall.png" load correctly
    if (out.includes("#")) out = out.replace(/#/g, "%23");

    const isAbsolute = /^https?:\/\//i.test(out);
    const isRooted = out.startsWith("/") || out.startsWith("./");

    if (!isAbsolute && !isRooted) {
      // Bare filename: assume it lives in public/construction/
      return `${PUBLIC_URL.replace(/\/+$/, "")}/construction/${out}`;
    }

    const parts = out.split("/");
    const file = parts.pop();
    const encodedFile = encodeURIComponent(file);
    return [...parts, encodedFile].join("/");
  };

  if (Array.isArray(icon)) {
    for (const cand of icon) {
      const resolved = tryOne(cand);
      if (resolved) return resolved;
    }
    return null;
  }
  return tryOne(icon);
}

// Pick (cols, rows) for an N-slot grid that best fits a container's aspect
// while keeping each cell roughly `targetCardAspect` (width/height). Returns
// the smallest grid with cols × rows ≥ N. Used by the buildings widget so a
// wide widget gets 10×2, a tall one 2×10, and a square one 4×5/5×4.
function adaptiveGrid(boxEl, total, targetCardAspect) {
  if (!boxEl) return { cols: Math.ceil(Math.sqrt(total)), rows: Math.ceil(total / Math.ceil(Math.sqrt(total))) };
  const r = boxEl.getBoundingClientRect();
  const W = Math.max(1, r.width);
  const H = Math.max(1, r.height);
  const aspect = W / H;
  // Solve: cols / rows ≈ aspect / targetCardAspect, with cols*rows >= total.
  let best = { cols: total, rows: 1, score: Infinity };
  for (let cols = 1; cols <= total; cols++) {
    const rows = Math.ceil(total / cols);
    if (cols * rows < total) continue;
    const cellAspect = (W / cols) / (H / rows);
    const score = Math.abs(Math.log(cellAspect / targetCardAspect));
    if (score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

// Design-mode splitter overlays. Three handles inside the RegionInfo panel:
//  • vertical between info|recruit in row 1
//  • horizontal between row 1 (info+recruit) and row 2 (buildings)
//  • horizontal between row 2 (buildings) and row 3 (armies)
// All drag math runs in fractions of the panel's own bounding box so the
// stored % is invariant under window resize.
function RegionInfoSplitters({ infoColFrac, topRowFrac, buildFrac, onSetInfoColPct, onSetTopRowPct, onSetBuildRowPct }) {
  const ref = useRef(null);
  const getRect = () => {
    const el = ref.current;
    if (!el || !el.parentElement) return null;
    return el.parentElement.getBoundingClientRect();
  };
  const startVDrag = (e) => {
    e.preventDefault();
    const rect = getRect(); if (!rect) return;
    function onMove(ev) {
      const frac = Math.max(0.08, Math.min(0.75, (ev.clientX - rect.left) / rect.width));
      onSetInfoColPct && onSetInfoColPct(frac);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const startHDrag = (which) => (e) => {
    e.preventDefault();
    const rect = getRect(); if (!rect) return;
    function onMove(ev) {
      const frac = Math.max(0.08, Math.min(0.85, (ev.clientY - rect.top) / rect.height));
      if (which === "top") {
        const top = frac;
        const curBuild = buildFrac != null ? buildFrac : 0.35;
        const cap = Math.max(0.05, 1 - top - 0.1);
        const newBuild = Math.min(curBuild, cap);
        onSetTopRowPct && onSetTopRowPct(top);
        if (newBuild !== curBuild) onSetBuildRowPct && onSetBuildRowPct(newBuild);
      } else {
        const top = topRowFrac != null ? topRowFrac : 0.35;
        const mid = Math.max(0.05, frac - top);
        onSetBuildRowPct && onSetBuildRowPct(mid);
        if (topRowFrac == null) onSetTopRowPct && onSetTopRowPct(top);
      }
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const stripeV = "repeating-linear-gradient(0deg, rgba(220,166,74,0.85), rgba(220,166,74,0.85) 6px, rgba(0,0,0,0.5) 6px, rgba(0,0,0,0.5) 10px)";
  const stripeH = "repeating-linear-gradient(90deg, rgba(220,166,74,0.85), rgba(220,166,74,0.85) 6px, rgba(0,0,0,0.5) 6px, rgba(0,0,0,0.5) 10px)";
  const leftPctForV = (infoColFrac != null ? infoColFrac : 240 / Math.max(800, (ref.current?.parentElement?.getBoundingClientRect().width || 800))) * 100;
  const topPctForRow1 = (topRowFrac != null ? topRowFrac : 0.34) * 100;
  const topPctForRow2 = ((topRowFrac != null ? topRowFrac : 0.34) + (buildFrac != null ? buildFrac : 0.33)) * 100;
  return (
    <div ref={ref} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 4 }}>
      {/* Vertical splitter between info|recruit — only spans the top row */}
      <div
        title="Drag to resize the info column"
        onMouseDown={startVDrag}
        style={{
          position: "absolute",
          top: 0, height: `${topPctForRow1}%`,
          left: `calc(${leftPctForV}% - 4px)`, width: 8,
          cursor: "ew-resize", background: stripeV, pointerEvents: "auto",
        }}
      />
      {/* Horizontal splitter between row 1 (info+recruit) and row 2 (buildings) */}
      <div
        title="Drag to resize info / recruit row vs buildings"
        onMouseDown={startHDrag("top")}
        style={{
          position: "absolute",
          top: `calc(${topPctForRow1}% - 4px)`, height: 8,
          left: 0, right: 0,
          cursor: "ns-resize", background: stripeH, pointerEvents: "auto",
        }}
      />
      {/* Horizontal splitter between row 2 (buildings) and row 3 (armies) */}
      <div
        title="Drag to resize buildings row vs armies row"
        onMouseDown={startHDrag("mid")}
        style={{
          position: "absolute",
          top: `calc(${topPctForRow2}% - 4px)`, height: 8,
          left: 0, right: 0,
          cursor: "ns-resize", background: stripeH, pointerEvents: "auto",
        }}
      />
    </div>
  );
}

export default function RegionInfo({ info, modeExtra, devMode, buildings: buildingsProp, garrison, garrisonCommander, fieldArmies, factionDisplayNames, recruitable, aorUnits, queue, saveFile, characters, liveUnits, liveOwner, ownerFactionId, factionTreasuries, factionRecordOwners, factionDiplomacy, allFactionDiplomacy, diplomacyMatrix, treasuryHistory, factionWealth, factionRelationships, onShowInfo, startingGarrison, settlementTier, resources, resourceImages, recruitGatedBy, homelandFactions, taxLevel, happiness, livePopulation, liveIncome, liveSize, modIconsDir, onFactionRightClick, onHighlightFactions, factionColors, recruitingNow, buildingQueue, designMode, infoColPct, topRowPct, buildRowPct, onSetInfoColPct, onSetTopRowPct, onSetBuildRowPct, onShowFamilyTree, hasFamilyTreeData, modDataDir, commanderInfo, factionCultures, statsCache, traitData, onEditBuildings, onIconReplaced, colBox, onStageGeneral, pendingGenerals, onStageDiplomacy, pendingDiplomacy, regions, regionCentroids, victoryConditions, selectedArmyKey, onSelectArmy, onAddUnitToSelectedArmy, onRemoveUnitFromSelectedArmy, armyKeyOf }) {
  // Faction ids (e.g. "parthia") → display name ("Persia" in Alexander
  // campaign). Parsed from the game's expanded_bi.txt.
  const factionLabel = (fid) => {
    if (!fid) return "";
    const dn = factionDisplayNames && factionDisplayNames[fid];
    return dn || String(fid).replace(/_/g, " ");
  };
  // 0.9.441: building edits flow UP to App.js (via onEditBuildings) so
  // its getBuildings() can re-run with full icon prefetch + label/tier/
  // culture resolution. Previously the editor kept a stripped local
  // mirror, which meant upgraded buildings rendered with stale icons
  // (kept the old tier's blob URL) and the edits vanished when devMode
  // toggled off. Lifting the state up restores both: icons refresh
  // automatically on every edit, and edits survive devMode toggling.
  const buildings = useMemo(() => buildingsProp || buildingsGetter(info) || [], [info, buildingsProp]);
  // 0.9.533: Diplomacy & Treasury for the selected region's OWNING faction.
  // Matches the owner's internal id against factionRecordOwners (identified
  // via the cracked faction_id), then reads its treasury record + diplomacy
  // relation list. Diplomacy relation entries carry a class enum but NOT the
  // other faction's identity (still uncracked), so we summarize by class:
  //   0 = allied, 1 = ceasefire, 2 = at war, 4 = locked alliance.
  const factionState = useMemo(() => {
    if (!ownerFactionId) return null;
    const fidLower = String(ownerFactionId).toLowerCase();
    // 0.9.536: named STARTING diplomacy from descr_strat (the live save can't
    // name partners). Lists who this faction began allied / at war with.
    // Each diplomacy entry is { id, name } so the widget can colour names by
    // faction and highlight a faction's regions on click.
    let startAllies = [], startWars = [], startProtects = [], startProtectedBy = [];
    if (factionRelationships && factionRelationships[fidLower]) {
      for (const e of factionRelationships[fidLower]) {
        const nm = (factionDisplayNames && factionDisplayNames[e.to]) || String(e.to).replace(/_/g, " ");
        const entry = { id: e.to, name: nm };
        if (e.kind === "ally") startAllies.push(entry);
        else if (e.kind === "war") startWars.push(entry);
        else if (e.kind === "protects") startProtects.push(entry);
        else if (e.kind === "protected_by") startProtectedBy.push(entry);
      }
    }
    const idx = Array.isArray(factionRecordOwners)
      ? factionRecordOwners.findIndex((o) => o && o.factionName && o.factionName.toLowerCase() === fidLower)
      : -1;
    // 0.9.539: live diplomacy COUNTS for ANY faction (incl. player, senate,
    // minors) from the per-faction diplomacy zones, keyed by faction name.
    // This replaces the old 23-records-only `factionDiplomacy[idx]` path so
    // every faction you click shows live war/ally counts.
    const liveDiplo = (allFactionDiplomacy && allFactionDiplomacy[fidLower]) || null;
    // 0.9.546: NAMED live diplomacy from the N×N attitude matrix — the real
    // diplomacy source. Lists who this faction is CURRENTLY at war / allied /
    // hostile with, BY NAME (matrix position = faction pair). Excludes rebel/
    // slave pseudo-factions from the display lists (always-at-war noise).
    // Engine placeholder / non-diplomatic factions — generic rebels (slave),
    // the bankrupt `dummies` slot, and per-faction respawn markers (*_rebels).
    // KEEP IN SYNC with saveCrackerExtras.DIPLO_PLACEHOLDER_RE (the decoder uses
    // the same rule to keep these out of the matrix; this is the display-side
    // safety net so an already-cached matrix also renders correctly).
    const PLACEHOLDER_RE = /(_rebels|^slave$|^slaves$|^rebels$|^dummies$)/;
    const isRealFaction = (n) => n && !PLACEHOLDER_RE.test(n);
    const isFreePeoples = (n) => /^(slave|slaves|rebels)$/.test(n);
    const nameOf = (n) => (factionDisplayNames && factionDisplayNames[n]) || String(n).replace(/_/g, " ");
    const entryOf = (id) => ({ id, name: nameOf(id) });
    const mtxRow = (diplomacyMatrix && diplomacyMatrix[fidLower]) || null;
    let liveWar = [], liveAllied = [], liveHostile = [], liveTrade = [];
    if (mtxRow) {
      liveWar = (mtxRow.war || []).filter(isRealFaction).map(entryOf);
      liveAllied = (mtxRow.allied || []).filter(isRealFaction).map(entryOf);
      liveHostile = (mtxRow.hostile || []).filter(isRealFaction).map(entryOf);
      // Trade = the alliance bond (descr_strat's 199 = "Ally/Trade" + scripted
      // protectorates). Decoded from the matrix bond field. Includes protectorates.
      liveTrade = (mtxRow.trade || []).filter(isRealFaction).map(entryOf);
    }
    let atWarWithAll = false;
    let isPlaceholderFaction = false;
    if (!PLACEHOLDER_RE.test(fidLower)) {
      // A real faction: it's also permanently at war with the independent
      // "Free Peoples" (slave). The save's matrix only encodes DECLARED faction
      // wars, not this implicit default (verified: NPC rows omit slave), so
      // surface it explicitly (user request 2026-05-24).
      if (!liveWar.some((e) => e.id === "slave")) liveWar.push(entryOf("slave"));
    } else if (isFreePeoples(fidLower)) {
      // The independent "Free Peoples" itself — permanently AT WAR with every
      // faction, never allied. The engine keeps no real diplomacy for it, so its
      // raw row decodes as Allied toward everyone (the old "92 allies" bug).
      liveAllied = [];
      liveHostile = [];
      liveTrade = [];
      const everyone = diplomacyMatrix
        ? Object.keys(diplomacyMatrix).filter((n) => n !== "_meta" && isRealFaction(n) && n !== fidLower)
        : [];
      liveWar = everyone.map(entryOf).sort((a, b) => a.name.localeCompare(b.name));
      atWarWithAll = liveWar.length > 0;
    } else {
      // `dummies` / per-faction respawn markers — engine placeholders with no
      // real diplomacy. Show nothing rather than garbage (e.g. the bogus
      // "dummies at war with Macedon").
      liveWar = []; liveAllied = []; liveHostile = []; liveTrade = [];
      isPlaceholderFaction = true;
    }
    // Protectorates score as Allied (attitude 0) in the matrix, so they show up
    // in liveAllied too. We list them separately under "protects/protectorate
    // of" (from descr_strat + campaign script), so drop them from the plain
    // allied list to avoid double-listing (e.g. Macedon: Argos/Megalopolis are
    // protectorates, not plain allies).
    if (startProtects.length || startProtectedBy.length) {
      const protSet = new Set([...startProtects, ...startProtectedBy].map((p) => p.id));
      liveAllied = liveAllied.filter((a) => !protSet.has(a.id));
    }
    // Starting-treasury fallback (descr_strat) so EVERY region shows
    // something — the live treasury records only exist for the ~23 major
    // NPC factions, so the player's own provinces and minor/rebel factions
    // would otherwise go blank. factionWealth is keyed by internal faction id.
    let startWealth = null;
    if (factionWealth) {
      startWealth = factionWealth[ownerFactionId];
      if (startWealth == null) {
        // case-insensitive fallback lookup
        for (const k in factionWealth) { if (k.toLowerCase() === fidLower) { startWealth = factionWealth[k]; break; } }
      }
    }
    const rec = idx >= 0 && Array.isArray(factionTreasuries) ? factionTreasuries[idx] : null;
    const owner = idx >= 0 ? factionRecordOwners[idx] : null;
    const treasury = rec ? rec.treasury : (startWealth != null ? startWealth : null);
    const hasLiveNamed = liveWar.length > 0 || liveAllied.length > 0 || liveTrade.length > 0;
    // If nothing at all to show, signal noData.
    if (treasury == null && !liveDiplo && !hasLiveNamed && startAllies.length === 0 && startWars.length === 0
        && startProtects.length === 0 && startProtectedBy.length === 0) {
      return { noData: true };
    }
    return {
      treasury,
      turnStart: rec ? rec.turnStartTreasury : null,
      isStarting: !rec,
      aiPersonality: owner ? owner.aiPersonality : null,
      // Live counts from the all-faction diplomacy map (covers every faction).
      hasLiveDiplo: !!liveDiplo,
      noDiplo: !liveDiplo,
      relationCount: liveDiplo ? liveDiplo.count : 0,
      wars: liveDiplo ? liveDiplo.wars : 0,
      allies: liveDiplo ? liveDiplo.allies : 0,
      ceasefires: liveDiplo ? liveDiplo.ceasefires : 0,
      locked: liveDiplo ? liveDiplo.locked : 0,
      // 0.9.546: NAMED live diplomacy from the attitude matrix.
      hasLiveNamed, liveWar, liveAllied, liveHostile, liveTrade, atWarWithAll, isPlaceholderFaction,
      startAllies, startWars, startProtects, startProtectedBy,
    };
  }, [ownerFactionId, factionRecordOwners, factionTreasuries, allFactionDiplomacy, diplomacyMatrix, factionWealth, factionRelationships, factionDisplayNames]);

  // ── Diplomacy list rendering helpers. Each faction name renders as a
  // coloured "pill" (chip) for legibility: a translucent tint of the faction's
  // colour with a matching border and a brightened-for-contrast label.
  const factionPillStyle = (id) => {
    const c = factionColors && (factionColors[id] || factionColors[String(id).toLowerCase()]);
    const rgb = c && c.primary;
    if (!rgb || rgb.length < 3) {
      return { color: "#e0e0e0", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.18)" };
    }
    const [r, g, b] = rgb;
    let lr = r, lg = g, lb = b;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 150) { const f = ((150 - lum) / 150) * 0.78; lr += (255 - r) * f; lg += (255 - g) * f; lb += (255 - b) * f; }
    return {
      color: `rgb(${Math.round(lr)},${Math.round(lg)},${Math.round(lb)})`,
      background: `rgba(${r},${g},${b},0.20)`,
      border: `1px solid rgba(${r},${g},${b},0.55)`,
    };
  };
  // One diplomacy line: clickable label (highlights all those factions on the
  // map) + each faction name as a coloured pill. `entries` = [{id, name}].
  const diploLine = (emoji, label, labelColor, entries, allText) => {
    if (!entries || entries.length === 0) return null;
    // Exclude the independent "Free Peoples" (slave/rebels) from the map
    // highlight — they own scattered regions everywhere, so highlighting them
    // floods the whole map. They still show in the list (just not highlighted).
    const highlightIds = entries
      .map((e) => e.id)
      .filter((id) => id && !/^(slave|slaves|rebels)$/.test(String(id).toLowerCase()));
    const clickable = !!onHighlightFactions && highlightIds.length > 0;
    return (
      <div
        style={{ fontSize: "0.66rem", color: labelColor, marginBottom: 3, cursor: clickable ? "pointer" : "default", lineHeight: 1.6 }}
        onClick={clickable ? () => onHighlightFactions(highlightIds) : undefined}
        title={clickable ? `Highlight these ${highlightIds.length} faction${highlightIds.length === 1 ? "" : "s"} on the map` : undefined}
      >
        {emoji} {label} ({entries.length}):{" "}
        {allText ? (
          <span style={{ color: "#ddd" }}>{allText}</span>
        ) : (
          entries.map((e, i) => {
            // Clicking an individual pill highlights ONLY that faction (and
            // stops the line-click that highlights the whole category). The
            // Free Peoples pill isn't clickable — it owns regions everywhere.
            const isFP = /^(slave|slaves|rebels)$/.test(String(e.id || "").toLowerCase());
            const pillClickable = !!onHighlightFactions && !!e.id && !isFP;
            return (
              <span
                key={e.id || i}
                onClick={pillClickable ? (ev) => { ev.stopPropagation(); onHighlightFactions([e.id]); } : undefined}
                title={pillClickable ? `Highlight ${e.name} on the map` : undefined}
                style={{ display: "inline-block", padding: "0px 5px", margin: "0 3px 0 0", borderRadius: "8px", whiteSpace: "nowrap", fontWeight: 600, cursor: pillClickable ? "pointer" : "default", ...factionPillStyle(e.id) }}
              >{e.name}</span>
            );
          })
        )}
      </div>
    );
  };

  // 0.9.541: diagnostic — log how the Diplomacy & Treasury widget resolved
  // the selected region's owner, so "doesn't load for faction X" reports are
  // debuggable. Logs once per owner change: the owner id, whether it matched
  // a live diplomacy zone / a treasury record, and the available-key count.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fid = ownerFactionId ? String(ownerFactionId).toLowerCase() : null;
    const allKeys = allFactionDiplomacy ? Object.keys(allFactionDiplomacy).length : 0;
    const liveHit = fid && allFactionDiplomacy ? !!allFactionDiplomacy[fid] : false;
    // Resolve the treasury-record index the same way the factionState memo does,
    // so the log shows exactly why the player faction may fall through to the
    // descr_strat starting-wealth fallback (idx < 0 ⇒ name mismatch).
    const tIdx = Array.isArray(factionRecordOwners)
      ? factionRecordOwners.findIndex((o) => o && o.factionName && o.factionName.toLowerCase() === fid)
      : -2;
    const tVal = tIdx >= 0 && Array.isArray(factionTreasuries) && factionTreasuries[tIdx]
      ? factionTreasuries[tIdx].treasury : null;
    window.__diploWidgetLogged ||= new Set();
    const k = `${fid}|${liveHit}|${allKeys}|${tIdx}`;
    if (!window.__diploWidgetLogged.has(k)) {
      window.__diploWidgetLogged.add(k);
      console.log(`[diplo-widget] owner="${ownerFactionId || "(none)"}" liveZone=${liveHit} allFactionDiplomacyKeys=${allKeys} factionState=${factionState ? (factionState.noData ? "noData" : "ok") : "null"} treasIdx=${tIdx} treasVal=${tVal} owners=${Array.isArray(factionRecordOwners) ? factionRecordOwners.length : "n/a"} treas=${Array.isArray(factionTreasuries) ? factionTreasuries.length : "n/a"} owner0=${factionRecordOwners && factionRecordOwners[0] ? factionRecordOwners[0].factionName : "n/a"}`);
    }
  }, [ownerFactionId, allFactionDiplomacy, factionState, factionRecordOwners, factionTreasuries]);
  // Dev-mode: right-click the Diplomacy widget to inspect the RAW attitude-matrix
  // numbers (core_attitudes/bond/aggression) for this faction, both directions.
  const [diploRawOpen, setDiploRawOpen] = useState(false);
  const [diploEditOpen, setDiploEditOpen] = useState(false);
  // Dev-mode "Add General" family-builder (writes to descr_strat for new campaigns).
  const [addGenOpen, setAddGenOpen] = useState(false);
  // Staged generals placed at THIS region's settlement — shown atop the roster
  // until Save writes them. Matched by settlement name (case-insensitive).
  const pendingHere = (() => {
    if (!pendingGenerals || pendingGenerals.size === 0) return [];
    const city = String((info && (info.city || info.name)) || "").toLowerCase().trim();
    if (!city) return [];
    return [...pendingGenerals.entries()]
      .filter(([, e]) => e.settlement && String(e.settlement).toLowerCase().trim() === city)
      .map(([id, e]) => ({ id, ...e }));
  })();
  // Catalogue + edit UI state. Catalogue is only fetched once dev mode is on.
  const [catalogue, setCatalogue] = useState(__buildingCatalogueCache);
  useEffect(() => {
    if (!devMode) return;
    if (catalogue) return;
    let alive = true;
    fetchBuildingCatalogueCached().then((cat) => { if (alive && cat) setCatalogue(cat); });
    return () => { alive = false; };
  }, [devMode, catalogue]);
  const [savingMsg, setSavingMsg] = useState(null);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  // 0.9.467: edits stage to the pending-changes registry in App.js (via
  // onEditBuildings); the descr_strat IPC fires only when the user clicks
  // Apply in the review modal. logMsg becomes the human-readable line in
  // the review modal so the user knows what each edit did.
  const persistBuildings = (newList, logMsg) => {
    if (logMsg) console.log(`[building-edit] ${logMsg}`);
    if (!region) return;
    const payload = newList.map((b) => ({ type: b.type, level: b.level }));
    if (typeof onEditBuildings === "function") {
      onEditBuildings(region, payload, { description: logMsg || `edit buildings in ${region}` });
    }
    setSavingMsg("Staged — review in toolbar");
    setTimeout(() => setSavingMsg(null), 2000);
  };
  // Strip render-only fields so list ops only carry {type, level} for each
  // building (matching what we ship to the IPC).
  const stripBuilding = (b) => ({ type: b.type, level: b.level });
  // 0.9.441: settlement-tier gating. RTW's `settlement_min` line per EDB
  // level says e.g. governors_villa requires settlement >= town. The
  // settlement's effective tier IS the core_building level (= the very
  // ladder the engine uses for villages → towns → cities). So we look
  // up the current core_building level, find its index in the chain, and
  // any candidate-level's settlement_min must be at most that.
  const currentCoreLevel = useMemo(() => {
    const core = buildings.find((b) => b?.type === "core_building");
    return core?.level || null;
  }, [buildings]);
  const currentTierIdx = useMemo(() => {
    if (!catalogue?.settlementTiers || !currentCoreLevel) return -1;
    return catalogue.settlementTiers.indexOf(currentCoreLevel);
  }, [catalogue, currentCoreLevel]);
  const tierOf = (settlementTierName) => {
    if (!catalogue?.settlementTiers || !settlementTierName) return -1;
    return catalogue.settlementTiers.indexOf(settlementTierName);
  };
  // 0.9.443: region context used by the engine-`requires` evaluator. The
  // faction we compare against is the CURRENT owner (live or descr_strat),
  // since `requires factions { x, y }` is evaluated against whoever
  // currently controls the settlement — not the rebel-default. Tags are
  // the descr_regions tag list (Farm7, aor_celtic, rel_dorian_1, ...).
  const regionFactionLower = useMemo(() => {
    const f = liveOwner || info?.faction || null;
    return f ? String(f).toLowerCase() : null;
  }, [liveOwner, info]);
  const regionTagsLower = useMemo(() => {
    const t = info?.tags;
    const blob = typeof t === "string" ? t : (Array.isArray(t) ? t.join(",") : "");
    return new Set(blob.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
  }, [info]);
  // Cheap requires-expression evaluator. Walks the level's `requires` clause
  // and rejects when a `factions { ... }` constraint excludes the current
  // region's faction, a `not factions { ... }` rule includes it, or a
  // `hidden_resource X` / `resource X` rule isn't satisfied by the region's
  // tag list. Unknown predicates (event_counter, religion, building_present)
  // are treated as satisfied so we don't over-filter and hide legitimate
  // options — better permissive than missing.
  const requiresClauseAllows = (raw) => {
    if (!raw || typeof raw !== "string") return true;
    const text = raw.toLowerCase();
    // Faction allow-lists: `factions { x, y, }` — non-negated occurrences
    // must include our faction (engine treats multiple unguarded clauses
    // as ANDed conjunctions, but in practice level requires only have ONE
    // positive factions clause). We collect ALL positive lists and require
    // membership in at least one.
    const positiveFactionLists = [];
    const negativeFactionLists = [];
    const factionRegex = /(?:^|\s)(not\s+)?factions\s*\{([^}]*)\}/g;
    let fm;
    while ((fm = factionRegex.exec(text)) !== null) {
      const negated = !!fm[1];
      const ids = fm[2].split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
      (negated ? negativeFactionLists : positiveFactionLists).push(ids);
    }
    if (regionFactionLower && positiveFactionLists.length > 0) {
      // `factions { all, }` is a WILDCARD (every faction qualifies), not a
      // literal faction id — treat a list containing "all" as satisfied.
      // Without this, every government building (governmentA/B/C/D all use
      // `factions { all }`) was hidden from the add picker, so a removed
      // government could never be re-added. Mirrors the recruit-filter logic.
      const inAny = positiveFactionLists.some(list => list.includes("all") || list.includes(regionFactionLower));
      if (!inAny) return false;
    }
    if (regionFactionLower) {
      for (const list of negativeFactionLists) {
        if (list.includes(regionFactionLower)) return false;
      }
    }
    // Hidden-resource / resource: `requires hidden_resource X` and
    // `requires resource X` are essentially the same gate for our purposes
    // — both check region tags. Engine syntax: `... hidden_resource X ...`
    // (no list braces, single token).
    const positiveHRs = [];
    const negativeHRs = [];
    const hrRegex = /(?:^|\s)(not\s+)?(?:hidden_resource|resource)\s+([a-z][a-z0-9_]*)/g;
    let hm;
    while ((hm = hrRegex.exec(text)) !== null) {
      const negated = !!hm[1];
      (negated ? negativeHRs : positiveHRs).push(hm[2]);
    }
    if (positiveHRs.length > 0 && regionTagsLower.size > 0) {
      const haveAny = positiveHRs.some(hr => regionTagsLower.has(hr));
      if (!haveAny) return false;
    }
    if (regionTagsLower.size > 0) {
      for (const hr of negativeHRs) {
        if (regionTagsLower.has(hr)) return false;
      }
    }
    return true;
  };
  // canUpgradeTo: true when `level` is allowed in the current settlement.
  // core_building chain is special — it IS the settlement tier ladder, so
  // settlement_min doesn't apply (you're choosing the tier itself). We still
  // honour the level's `requires` clause though (some mods gate huge_city
  // to capital-only or specific factions). Returns { ok, reason, requiredTier }.
  const canUpgradeToDetail = (chainName, levelName) => {
    if (chainName === "core_building") {
      const expr = catalogue?.levelRequires?.[`${chainName}|${levelName}`];
      if (expr && !requiresClauseAllows(expr)) {
        return { ok: false, reason: "requires", requiredTier: null };
      }
      return { ok: true };
    }
    if (!catalogue?.settlementMins) return { ok: true };
    const req = catalogue.settlementMins[`${chainName}|${levelName}`];
    if (req) {
      const reqIdx = tierOf(req);
      if (reqIdx >= 0 && currentTierIdx < reqIdx) {
        return { ok: false, reason: "settlement_min", requiredTier: req };
      }
    }
    // 0.9.443: also check the level's `requires` clause for factions /
    // hidden_resource / resource gates. These don't show up in
    // settlementMins; they live in levelRequires.
    const expr = catalogue?.levelRequires?.[`${chainName}|${levelName}`];
    if (expr && !requiresClauseAllows(expr)) {
      return { ok: false, reason: "requires", requiredTier: null };
    }
    return { ok: true };
  };
  const canUpgradeTo = (chainName, levelName) => canUpgradeToDetail(chainName, levelName).ok;
  // 0.9.473: strict settlement-tier cap. Each building row gets flagged when
  // its CURRENT level's settlement_min is higher than the current settlement
  // tier — this happens when the user demolishes the core_building down to a
  // smaller tier, leaving e.g. a city_barracks stranded on a town. We don't
  // auto-remove (let the user choose); just decorate the card red.
  const tierMismatch = (chainName, levelName) => {
    if (!chainName || !levelName || chainName === "core_building") return null;
    if (!catalogue?.settlementMins) return null;
    const req = catalogue.settlementMins[`${chainName}|${levelName}`];
    if (!req) return null;
    const reqIdx = tierOf(req);
    if (reqIdx < 0 || currentTierIdx < 0) return null;
    if (currentTierIdx >= reqIdx) return null;
    return { requiredTier: req, currentTier: currentCoreLevel || "(none)" };
  };
  const onBuildingUp = (idx) => {
    const cur = buildings[idx];
    const chain = catalogue?.chains?.[cur?.type];
    if (!chain || !cur) return;
    const ci = chain.indexOf(cur.level);
    if (ci < 0 || ci >= chain.length - 1) return;
    const nextLevel = chain[ci + 1];
    const det = canUpgradeToDetail(cur.type, nextLevel);
    if (!det.ok) {
      const why = det.reason === "settlement_min"
        ? `needs settlement ≥ ${det.requiredTier} (have ${currentCoreLevel || "none"})`
        : `requires clause excludes this region`;
      setSavingMsg(`Blocked: ${nextLevel} ${why}`);
      setTimeout(() => setSavingMsg(null), 3000);
      console.log(`[building-edit-cap] disabled up: ${cur.type} ${cur.level} → ${nextLevel} (${why})`);
      return;
    }
    if (cur.type === "core_building") {
      // 0.9.473: core_building IS the settlement tier — upgrading is allowed
      // regardless of settlement_min (we're moving the tier itself) but
      // strictly one step at a time (the engine grows settlements one tier
      // per construction), and the next level's `requires` must be satisfied.
      console.log(`[building-edit-cap] core_building one-step upgrade: ${cur.level} → ${nextLevel}`);
    }
    const next = buildings.map(stripBuilding);
    next[idx] = { type: cur.type, level: nextLevel };
    persistBuildings(next, `up ${cur.type} ${cur.level} → ${nextLevel} in region ${region}`);
  };
  const onBuildingDown = (idx) => {
    const cur = buildings[idx];
    const chain = catalogue?.chains?.[cur?.type];
    if (!chain || !cur) return;
    const ci = chain.indexOf(cur.level);
    if (ci <= 0) return;
    const prevLevel = chain[ci - 1];
    const next = buildings.map(stripBuilding);
    next[idx] = { type: cur.type, level: prevLevel };
    persistBuildings(next, `down ${cur.type} ${cur.level} → ${prevLevel} in region ${region}`);
  };
  const onBuildingRemove = (idx) => {
    const cur = buildings[idx];
    if (!cur) return;
    const next = buildings.map(stripBuilding).filter((_, i) => i !== idx);
    persistBuildings(next, `remove ${cur.type} ${cur.level} in region ${region}`);
  };
  // The engine "slot" a chain occupies (government / temple / civic / port /
  // heavy_ind / entertainment / …). At most one building per slot; adding a
  // same-slot chain REPLACES the occupant. Prefer the catalogue's parsed tag;
  // fall back to the `no_other_<X>` token (negated form stripped) for older
  // cached catalogues.
  const chainSlot = (c) => {
    const t = catalogue?.tags?.[c];
    if (t) return String(t).toLowerCase();
    const lvls = catalogue?.chains?.[c] || [];
    for (const lv of lvls) {
      const req = (catalogue?.levelRequires?.[`${c}|${lv}`] || "").toLowerCase().replace(/not\s+no_other_\w+/g, "");
      const m = req.match(/no_other_(\w+)/);
      if (m) return m[1];
    }
    return null;
  };
  const onBuildingAdd = (chainName) => {
    const chain = catalogue?.chains?.[chainName];
    if (!chain || chain.length === 0) return;
    const firstLevel = chain[0];
    // One building per slot: if this chain's slot is already filled by a
    // DIFFERENT chain, replace it (remove the occupant) instead of stacking.
    const slot = chainSlot(chainName);
    let base = buildings.map(stripBuilding);
    let replaced = null;
    if (slot) {
      const occ = base.find((b) => b.type !== chainName && chainSlot(b.type) === slot);
      if (occ) { replaced = occ.type; base = base.filter((b) => b !== occ); }
    }
    const next = [...base, { type: chainName, level: firstLevel }];
    persistBuildings(next, replaced
      ? `replace ${replaced} with ${chainName} ${firstLevel} in region ${region}`
      : `add ${chainName} ${firstLevel} in region ${region}`);
    setShowAddPicker(false);
    setAddQuery("");
  };
  // Pre-compute available chains for the picker (those not already in the
  // region — engine forbids duplicate chains). 0.9.473 (strict tier cap):
  // chains whose first level's settlement_min exceeds the current settlement
  // tier are still listed but flagged with a "(needs <tier>)" hint and
  // disabled — so the user can see what's gated without it silently failing.
  // Chains whose `requires` clause rejects this region (factions /
  // hidden_resource) are HIDDEN entirely (they will never apply here).
  // Returns [{ chain, ok, requiredTier, reason }] so the renderer can
  // decorate disabled entries.
  const availableChainsForAdd = useMemo(() => {
    if (!showAddPicker || !catalogue?.chains) return [];
    const owned = new Set(buildings.map((b) => b.type).filter(Boolean));
    const q = addQuery.trim().toLowerCase();
    const all = Object.keys(catalogue.chains).sort();
    // Show EVERY buildable tree. A settlement holds one building per engine
    // "slot" (tag), but we no longer HIDE same-slot chains — that made ~50 trees
    // vanish from a developed settlement (you couldn't browse the 3 entertainment
    // options, trade buildings, etc.). Instead onBuildingAdd REPLACES the slot's
    // occupant, and each entry is annotated with what it would replace.
    const ownedBySlot = new Map();
    for (const b of buildings) { const s = b.type && chainSlot(b.type); if (s && !ownedBySlot.has(s)) ownedBySlot.set(s, b.type); }
    const out = [];
    for (const c of all) {
      if (owned.has(c)) continue;
      if (q !== "" && !c.toLowerCase().includes(q)) continue;
      const lvls = catalogue.chains[c];
      const firstLevel = lvls && lvls[0];
      if (!firstLevel) continue;
      const det = canUpgradeToDetail(c, firstLevel);
      if (!det.ok && det.reason === "requires") {
        // Permanently excluded by faction/hidden_resource — don't surface.
        console.log(`[building-edit-cap] hidden in picker: ${c} (requires clause excludes region)`);
        continue;
      }
      const slot = chainSlot(c);
      const replaces = slot ? ownedBySlot.get(slot) : null;
      out.push({
        chain: c,
        firstLevel,
        ok: det.ok,
        requiredTier: det.requiredTier || null,
        replaces: replaces && replaces !== c ? replaces : null,
      });
      if (!det.ok) {
        console.log(`[building-edit-cap] disabled in picker: ${c} first level=${firstLevel} (needs ${det.requiredTier}, have ${currentCoreLevel || "none"})`);
      }
      if (out.length >= 200) break;
    }
    return out;
  }, [showAddPicker, addQuery, catalogue, buildings, currentTierIdx, currentCoreLevel]);
  // Hover-state readout for unit cards. Shows the same info as the native
  // tooltip (name, soldiers, chevrons, upgrades) but inline next to the
  // panel header, so it's easier to read than the OS tooltip floater.
  const [hoveredUnit, setHoveredUnit] = useState(null);
  // Cross-link hover: hovering a building card highlights units gated by
  // that chain (and vice-versa). hoveredChain = { type } when hovering a
  // building, hoveredRecruit = unit name when hovering a recruit card.
  const [hoveredChain, setHoveredChain] = useState(null);
  const [hoveredRecruit, setHoveredRecruit] = useState(null);
  // Hidden-resource hover: chip in the tags row → highlight every
  // recruit gated on that HR. Builds on the existing recruit/building
  // cross-link.
  const [hoveredHr, setHoveredHr] = useState(null);
  // 0.9.473: drag-over state for icon-replace drops. Index into buildingItems
  // (= idx of the source building) so the card we're hovering with a file
  // can paint a dashed gold outline. null = no drag in progress.
  const [dragOverBuildingIdx, setDragOverBuildingIdx] = useState(null);
  const [iconReplaceMsg, setIconReplaceMsg] = useState(null);
  // Helper: handle a file drop onto a building icon. Calls the IPC, kicks
  // off cache invalidation + re-fetch, and pushes a pending-log entry so the
  // user can review/revert in the unified Save modal.
  const handleIconDrop = async (idx, file) => {
    if (!file) return;
    const cur = buildings[idx];
    if (!cur) return;
    const api = window.electronAPI;
    if (!api?.replaceBuildingIcon) {
      console.log(`[icon-replace] electronAPI.replaceBuildingIcon unavailable`);
      return;
    }
    const culture = cur.culture || info?.culture || null;
    if (!culture) {
      console.log(`[icon-replace] no culture for ${cur.type}/${cur.level} — cannot resolve destination`);
      setIconReplaceMsg(`No culture for ${cur.type} — drop ignored`);
      setTimeout(() => setIconReplaceMsg(null), 3000);
      return;
    }
    // Electron's File object exposes `.path` (the absolute path on disk) on
    // drops. With webSecurity enabled but no sandboxing on the BrowserWindow
    // we still get it. Validate explicitly so we can log a useful error.
    const srcPath = file.path;
    console.log(`[icon-replace] drop: chain=${cur.type} level=${cur.level} culture=${culture} src=${srcPath || "(none)"} name=${file.name} type=${file.type} size=${file.size}`);
    if (!srcPath) {
      setIconReplaceMsg("Drop source path unavailable");
      setTimeout(() => setIconReplaceMsg(null), 3000);
      return;
    }
    const mime = (file.type || "").toLowerCase();
    const okMime = mime.startsWith("image/") || /\.(png|jpe?g|tga)$/i.test(file.name || "");
    if (!okMime) {
      console.log(`[icon-replace] rejected non-image mime: ${mime} name=${file.name}`);
      setIconReplaceMsg("Only PNG / JPG / TGA accepted");
      setTimeout(() => setIconReplaceMsg(null), 3000);
      return;
    }
    setIconReplaceMsg(`Replacing icon for ${cur.type} ${cur.level}…`);
    try {
      const res = await api.replaceBuildingIcon(modDataDir || null, culture, cur.level, cur.type, srcPath);
      if (!res || !res.ok) {
        console.log(`[icon-replace] IPC reported failure: ${res?.error || "(unknown)"}`);
        setIconReplaceMsg(`Replace failed: ${res?.error || "(unknown)"}`);
        setTimeout(() => setIconReplaceMsg(null), 4000);
        return;
      }
      console.log(`[icon-replace] success: dest=${res.destPath} backup=${res.backupPath || "(none)"}`);
      // Invalidate cache and force a re-fetch so the new icon appears.
      try { invalidateBuildingIcon(culture, cur.level); } catch {}
      try { await api.clearModCaches?.(); } catch {}
      try { await loadBuildingIcon(modDataDir || null, culture, cur.level, cur.type); } catch {}
      // Bump parent's iconCacheVersion so App.js re-runs getBuildings and
      // picks up the fresh blob URL. Pass through the new IPC result so
      // App.js can include destPath in the revert payload.
      if (typeof onIconReplaced === "function") {
        onIconReplaced(region, {
          chain: cur.type,
          level: cur.level,
          culture,
          destPath: res.destPath,
          backupPath: res.backupPath || null,
        });
      }
      setIconReplaceMsg(`Replaced ${cur.type} ${cur.level} icon`);
      setTimeout(() => setIconReplaceMsg(null), 2500);
    } catch (e) {
      console.log(`[icon-replace] threw: ${e?.message || String(e)}`);
      setIconReplaceMsg(`Replace error: ${e?.message || String(e)}`);
      setTimeout(() => setIconReplaceMsg(null), 4000);
    }
  };
  // Buildings widget — adaptive grid that always reserves 20 slots but
  // picks cols/rows from the container's aspect so cards stay square-ish.
  // We track the container ref + a re-render trigger driven by a
  // ResizeObserver so the grid recomputes when the user drags the widget
  // wider/taller.
  const buildingsBoxRef = useRef(null);
  const [, setBuildingsTick] = useState(0);
  useEffect(() => {
    if (!buildingsBoxRef.current) return;
    const ro = new ResizeObserver(() => setBuildingsTick((t) => t + 1));
    ro.observe(buildingsBoxRef.current);
    return () => ro.disconnect();
  }, []);
  const hoverReadout = (u) => {
    if (!u) return null;
    const chevrons = u.xp || 0;
    const armour = u.armour || 0;
    const weapon = u.weapon || 0;
    const parts = [u.unit.replace(/_/g, " ")];
    if (u.soldiers != null) parts.push(`${u.soldiers}${u.max != null ? `/${u.max}` : ""}`);
    if (chevrons > 0) {
      const tier = chevrons >= 7 ? "gold" : chevrons >= 4 ? "silver" : "bronze";
      parts.push(`${chevronCount(chevrons)} ${tier} chev`);
    }
    if (armour > 0) parts.push(`armour +${armour}`);
    if (weapon > 0) parts.push(`weapon +${weapon}`);
    return parts.join(" · ");
  };

  if (!info) {
    return (
      <div style={{ padding: 12, color: "#bbb", fontStyle: "italic" }}>
        Hover over a colored region to see details.
      </div>
    );
  }

  const { region, city, faction, culture, rgb, tags, farm_level, population_level, ethnicities } = info;

  const tagsList = listOrEmpty(tags);
  const ethnicitiesList = listOrEmpty(ethnicities);

  const toRoman = (n) => {
    if (!n || n < 1) return "";
    const map = [["M",1000],["CM",900],["D",500],["CD",400],["C",100],["XC",90],["L",50],["XL",40],["X",10],["IX",9],["V",5],["IV",4],["I",1]];
    let out = "", v = n;
    for (const [s, k] of map) { while (v >= k) { out += s; v -= k; } }
    return out;
  };
  const buildingItems = buildings.map((b, idx) => {
    const label = labelFrom(b, idx);
    const icon =
      resolveIcon(b?.icon) ||
      resolveIcon(b?.image) ||
      resolveIcon(b?.imagePath) ||
      resolveIcon(b?.iconPath) ||
      resolveIcon(b?.img) ||
      null;
    return {
      key: `${label}-${idx}`,
      idx,
      label,
      icon,
      type: b?.type || "",
      // Level NAME (e.g. "city_barracks") and culture are needed for the
      // right-click info popup — without them resolveBuildingBanner gets
      // called with levelName=undefined and bails immediately, and the
      // description IPC misses culture-specific keys like
      // `{governors_house_barbarian_desc}`.
      level: b?.level || "",
      culture: b?.culture || null,
      health: b?.health,
      tier: b?.tier,
      tierRoman: toRoman(b?.tier),
      queued: !!b?.queued,
      // Progress is the fraction complete (0..1). If unknown for a queued
      // building, default to 0 so the overlay fills the whole icon — that's
      // the game's visual for "just started construction".
      progress: typeof b?.progress === "number" ? b.progress : (b?.queued ? 0 : null),
    };
  });

  const row = (label, value) =>
    value !== undefined && value !== null && value !== "" ? (
      <div style={{ marginBottom: 2 }}>
        <strong>{label}</strong> {value}
      </div>
    ) : null;

  // Layout overrides — fractions of the panel. 0 means "use default".
  const infoColFrac = infoColPct > 0 ? infoColPct : null;   // info|recruit split in row 1
  const topRowFrac  = topRowPct  > 0 ? topRowPct  : null;   // row 1 height / panel
  const buildFrac   = buildRowPct > 0 ? buildRowPct : null; // row 2 height / panel
  const colsTemplate = infoColFrac
    ? `${(infoColFrac * 100).toFixed(2)}fr ${((1 - infoColFrac) * 100).toFixed(2)}fr`
    : "240px 1fr";
  let rowsTemplate;
  if (designMode || topRowFrac != null || buildFrac != null) {
    // In design mode (even before the user has dragged anything) force
    // fractional rows so the splitter overlays land on the same lines the
    // grid actually renders. With "auto auto auto" rows the splitters would
    // sit off the visible row gaps until first drag.
    const top = topRowFrac != null ? topRowFrac : 0.34;
    const mid = buildFrac  != null ? buildFrac  : 0.33;
    const bot = Math.max(0.05, 1 - top - mid);
    rowsTemplate = `${(top * 100).toFixed(2)}fr ${(mid * 100).toFixed(2)}fr ${(bot * 100).toFixed(2)}fr`;
  } else {
    rowsTemplate = "auto auto auto";
  }

  // Widget inner panel — uses the global `.panel` class so widgets get the
  // same cream/light look as the factions panel (and so the light-mode
  // contrast observer in App.js auto-darkens any bright text inside).
  // Padding is overridden to 0 because each widget renders its own header
  // (flex-shrink: 0) + body (flex: 1, overflow: auto) and they manage
  // padding individually — that lets the header stay fixed while only
  // the body scrolls.
  const panelInnerClass = "panel";
  const panelInner = {
    width: "100%", height: "100%", boxSizing: "border-box",
    display: "flex", flexDirection: "column",
    padding: 0,        // override .panel default 12 px
    overflow: "hidden",
  };
  // Reusable header/body styles. Horizontal padding is 14 px so titles
  // and buttons clear the panel's 12 px corner radius without being cut.
  const widgetHeader = {
    flexShrink: 0,
    padding: "8px 14px 4px 14px",
  };
  const widgetBody = {
    flex: 1, minHeight: 0,
    padding: "0 14px 8px 14px",
    overflow: "auto",
    display: "flex", flexDirection: "column",
  };

  return (
    <>
      {/* Region info — Movable widget. Default positions in 0.9.357+
          mirror the user's snapped-to-grid layout: left half of the right
          column shares x=0.5696 / w=0.2243; right half shares x=0.7974 /
          w=0.1991. Row anchors are y=0.0056 / 0.3148 / 0.4573 with a
          common GAP_FRAC≈0.0035 between rows. */}
      <Movable id="region.info" title="Region info" designMode={designMode} colBox={colBox}
        defaultPct={{ x: 0.5720, y: 0.0083, w: 0.2090, h: 0.2600 }}>
      <div className={panelInnerClass} style={panelInner}>
        <div style={{ padding: "8px 14px", overflow: "auto", height: "100%", boxSizing: "border-box" }}>
        {region && (
          <div
            title="Double-click to copy region name"
            onDoubleClick={() => {
              try {
                navigator.clipboard?.writeText(region);
              } catch {}
            }}
            style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "copy" }}
          >
            {region}
          </div>
        )}
        {city ? (
          <div
            title="Double-click to copy settlement name"
            onDoubleClick={() => {
              try { navigator.clipboard?.writeText(city); } catch {}
            }}
            style={{ marginBottom: 2, cursor: "copy", display: "flex", alignItems: "baseline", gap: 6, flexWrap: "nowrap", maxWidth: "100%" }}
          >
            <strong style={{ flexShrink: 0 }}>Settlement:</strong>
            <span style={{ flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{city}</span>
            {settlementTier && (() => {
              // Colour-grade by tier so a glance at the badge tells you
              // size: grey village → bronze town → silver city → gold huge.
              const TIER_STYLE = {
                village:     { bg: "rgba(140,140,140,0.22)", fg: "#cfcfcf" },
                town:        { bg: "rgba(170,140,90,0.22)",  fg: "#d6b07a" },
                large_town:  { bg: "rgba(190,150,80,0.22)",  fg: "#e2bf6e" },
                city:        { bg: "rgba(200,200,210,0.22)", fg: "#e0e3e9" },
                large_city:  { bg: "rgba(230,190,80,0.25)",  fg: "#f5cd57" },
                huge_city:   { bg: "rgba(255,210,70,0.30)",  fg: "#ffe080" },
              };
              const t = String(settlementTier).toLowerCase();
              const s = TIER_STYLE[t] || TIER_STYLE.town;
              return (
                <span style={{
                  fontSize: "0.65rem", padding: "0 5px", borderRadius: 8,
                  background: s.bg, color: s.fg,
                  textTransform: "capitalize", lineHeight: 1.4,
                  flexShrink: 0, whiteSpace: "nowrap", alignSelf: "center",
                }} title="Settlement level (descr_strat)">{String(settlementTier).replace(/_/g, " ")}</span>
              );
            })()}
          </div>
        ) : row("Settlement:", city)}
        {(() => {
          // `faction` = descr_regions field 3 = rebel-default (who takes
          // the settlement on a rebellion). `liveOwner` = current owner from
          // descr_strat (or the live save). When they differ, surface the
          // rebel-default as a small italic note so the distinction is
          // visible — otherwise users see e.g. Corsica owned by `corsi`
          // and don't realise it'd flip to `romans_julii` if it rebelled.
          const ownerLabel = liveOwner || factionLabel(faction);
          if (!ownerLabel) return null;
          const rebelLabel = factionLabel(faction);
          const showRebelHint = liveOwner && rebelLabel
            && String(liveOwner).toLowerCase() !== String(rebelLabel).toLowerCase();
          return (
            <div style={{ marginBottom: 2 }}>
              <strong>Faction:</strong> {ownerLabel}
              {showRebelHint && (
                <span title="When this region rebels, it joins the rebel-default faction (descr_regions field 3)"
                  style={{ marginLeft: 6, fontSize: "0.7rem", color: "#bbb", fontStyle: "italic" }}>
                  rebels → {rebelLabel}
                </span>
              )}
            </div>
          );
        })()}
        {culture ? (
          <div style={{ marginBottom: 2 }}
            title="Rebel sub-faction that spawns when this region rebels (descr_regions field 4)">
            <strong>Rebels:</strong> {culture}
          </div>
        ) : null}
        {taxLevel ? (() => {
          const colors = { very_low: "#5cb85c", low: "#7ed27e", normal: "#bbb", high: "#e8a030", very_high: "#e85050" };
          const label = taxLevel.replace(/_/g, " ");
          return (
            <div style={{ marginBottom: 2 }}
              title="Current tax rate from the live save. Long-block path (imperial_campaign / ris_classic) reads byte at marker-2269; short-block path (all campaigns including alexander) reads byte at settlement_name_pos-562. The two map to the same string labels.">
              <strong>Tax:</strong>{" "}
              <span style={{ color: colors[taxLevel] || "#ccc", textTransform: "capitalize" }}>{label}</span>
            </div>
          );
        })() : null}
        {typeof happiness === "number" ? (() => {
          // Raw save-cracker value sits roughly 100..200; RTW's UI clips it
          // to a 0..100% bar. Linear map: 100 → 0%, 200 → 100% — that puts
          // a "normal-tax neutral" reading near the middle of the bar,
          // matching where the in-game public-order bar tends to sit on
          // a stable city. Color: green/yellow/red traffic light.
          const raw = happiness;
          const pct = Math.max(0, Math.min(100, Math.round((raw - 100))));
          const color = pct >= 60 ? "#7ed27e" : pct >= 30 ? "#e8a030" : "#e85050";
          return (
            <div style={{ marginBottom: 2 }}
              title={`Public order (raw save value ${raw.toFixed(2)}, mapped to ${pct}%). Field at settlement_name_offset-30, decoded 2026-05-10 via the cracker.`}>
              <strong>Public order:</strong>{" "}
              <span style={{ color, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
              <span style={{ color: "#888", fontSize: "0.7rem", marginLeft: 6 }}>({raw.toFixed(0)})</span>
            </div>
          );
        })() : null}
        {devMode && rgb && (() => {
          // Show both decimal RGB and hex, plus a swatch + colour-tinted
          // hex so the row reads as the colour it represents — easier
          // when grabbing values for an image editor.
          const parts = String(rgb).split(",").map(s => parseInt(s.trim(), 10));
          const valid = parts.length === 3 && parts.every(n => Number.isFinite(n));
          if (!valid) return row("RGB:", rgb);
          const [r, g, b] = parts.map(n => Math.max(0, Math.min(255, n || 0)));
          const hex = "#" + [r, g, b].map(n => n.toString(16).padStart(2, "0")).join("").toUpperCase();
          // Brighten dim swatches so the hex stays legible against the
          // panel; keep hue, lift toward white when luminance is low.
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const lift = lum < 80 ? 0.6 : lum < 140 ? 0.3 : 0;
          const tr = Math.round(r + (255 - r) * lift);
          const tg = Math.round(g + (255 - g) * lift);
          const tb = Math.round(b + (255 - b) * lift);
          const textColor = `rgb(${tr},${tg},${tb})`;
          return (
            <div style={{ marginBottom: 2, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <strong>RGB:</strong>
              <span title={`rgb(${r}, ${g}, ${b})`} style={{
                display: "inline-block",
                width: 12, height: 12, borderRadius: 3,
                background: `rgb(${r},${g},${b})`,
                border: "1px solid rgba(255,255,255,0.25)",
                boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
                flexShrink: 0,
              }} />
              <span style={{ fontFamily: "Consolas, monospace" }}>{rgb}</span>
              <span style={{ fontFamily: "Consolas, monospace", color: textColor, fontWeight: 700 }}>{hex}</span>
            </div>
          );
        })()}
        {(() => {
          // Real fertility is encoded in the Farm## tag (Farm1..Farm14), not
          // descr_regions field 7 — which RIS leaves at a constant 5 for every
          // region as a placeholder. Parse the tag list so we surface the
          // actual value, and colour-tint the number using the same red →
          // yellow → green gradient as the Fertility map mode.
          const tagBlob = typeof tags === "string" ? tags : (Array.isArray(tags) ? tags.join(",") : "");
          const m = tagBlob.match(/\bFarm(\d+)\b/);
          if (m) {
            const val = parseInt(m[1], 10);
            const t = Math.max(0, Math.min(1, val / 14));
            const red   = t < 0.5 ? 210 : Math.round(210 - (t - 0.5) * 2 * 160);
            const green = t < 0.5 ? Math.round(t * 2 * 200) : 200;
            const blue  = 30;
            return (
              <div style={{ marginBottom: 2 }}>
                <strong>Fertility:</strong>{" "}
                <span style={{ color: `rgb(${red},${green},${blue})`, fontWeight: 700 }}>{val}</span>
                <span style={{ color: "#aaa" }}> / 14</span>
              </div>
            );
          }
          return farm_level !== undefined && farm_level !== null ? row("Farm Level:", farm_level) : null;
        })()}
        {population_level !== undefined && population_level !== null && (() => {
          // pop_level is the descr_regions 1-15 cap scale; ~1500 people per
          // level is the empirical map → game ratio. Surface both so the
          // user doesn't have to do mental math.
          const lvl = parseInt(population_level, 10);
          const approx = Number.isFinite(lvl) && lvl > 0 ? lvl * 1500 : null;
          return (
            <div style={{ marginBottom: 2 }}>
              <strong>Pop Cap:</strong> level {population_level}
              {approx != null && <span style={{ color: "#aaa", fontSize: "0.72rem" }}> · ~{approx.toLocaleString()}</span>}
            </div>
          );
        })()}
        {typeof livePopulation === "number" && (
          <div style={{ marginBottom: 2 }}
            title="Live population read from the save (u32 at settlement_name_offset-1494, decoded 2026-05-10). Updates each turn as growth/decay events apply.">
            <strong>Population:</strong>{" "}
            <span style={{ color: "#eee", fontVariantNumeric: "tabular-nums" }}>{livePopulation.toLocaleString()}</span>
          </div>
        )}
        {liveSize && (
          <div style={{ marginBottom: 2 }}
            title="Current settlement size class read live from the save (u8 at settlement_name_offset-2207). Reflects mid-campaign upgrades; descr_strat only carries the starting tier.">
            <strong>Size:</strong>{" "}
            <span style={{ color: "#eee", textTransform: "capitalize" }}>{liveSize.replace(/_/g, " ")}</span>
          </div>
        )}
        {liveIncome && typeof liveIncome.perTurn === "number" && (
          <div style={{ marginBottom: 2 }}
            title="Per-turn settlement income (denarii). u32 at settlement_name_offset-1586, decoded 2026-05-10 via save-cracker session 3. STRONG-confidence: one clean correlation across rome1..rome10 turn boundaries; exact game-UI semantics not fully pinned.">
            <strong>Income:</strong>{" "}
            <span style={{ color: liveIncome.perTurn >= 0 ? "#7ed27e" : "#e85050", fontVariantNumeric: "tabular-nums" }}>
              {liveIncome.perTurn >= 0 ? "+" : ""}{liveIncome.perTurn.toLocaleString()}
            </span>
            <span style={{ color: "#888", fontSize: "0.72rem", marginLeft: 6 }}>denarii/turn</span>
            {typeof liveIncome.cumulative === "number" && (
              <span style={{ color: "#888", fontSize: "0.72rem", marginLeft: 6 }}
                title="Cumulative income contributed by this settlement (lifetime). u32 at settlement_name_offset-1582.">
                · {liveIncome.cumulative.toLocaleString()} total
              </span>
            )}
          </div>
        )}
        {Array.isArray(homelandFactions) && homelandFactions.length > 0 && (
          <div style={{ marginBottom: 2, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
            <strong>Homeland of:</strong>{" "}
            {homelandFactions.map((f) => {
              const displayName = factionDisplayNames?.[f] || f.replace(/_/g, " ");
              return (
                <span
                  key={f}
                  title={displayName}
                  onContextMenu={(e) => {
                    if (!onFactionRightClick) return;
                    e.preventDefault();
                    onFactionRightClick({ factionId: f, displayName });
                  }}
                  style={{
                    width: 22, height: 22,
                    display: "inline-block",
                    cursor: onFactionRightClick ? "context-menu" : "default",
                    verticalAlign: "middle",
                  }}
                >
                  <FactionIcon
                    iconPath={`faction_icons/${f}.tga`}
                    alt={displayName}
                    size={22}
                    tightCrop
                    modIconsDir={modIconsDir}
                  />
                </span>
              );
            })}
            <span style={{ color: "#aaa", fontSize: "0.7rem", marginLeft: 4 }}>
              (non-native owners suffer happiness penalty)
            </span>
          </div>
        )}
        {(() => {
          // Religion: derive majority from `rel_<X>_<level>` tags. The number
          // is the strength (1..4 in vanilla / RIS); the highest-level tag is
          // the dominant religion. A small text row complements the
          // ethnicities chart immediately above it (chart shows ancestry, not
          // creed). Falls back silently when no rel_* tags are present.
          if (!tagsList || tagsList.length === 0) return null;
          const rels = tagsList
            .map((t) => {
              const m = String(t).toLowerCase().match(/^rel_([a-z_]+)_(\d+)$/);
              return m ? { name: m[1], level: parseInt(m[2], 10) } : null;
            })
            .filter(Boolean);
          if (rels.length === 0) return null;
          rels.sort((a, b) => b.level - a.level);
          const total = rels.reduce((s, r) => s + r.level, 0) || 1;
          return (
            <div style={{ marginBottom: 2 }}>
              <strong>Religion:</strong>{" "}
              {rels.map((r, i) => {
                const pct = Math.round((r.level / total) * 100);
                return (
                  <span key={i}>
                    {i > 0 ? ", " : ""}
                    <span style={{ textTransform: "capitalize" }}>{r.name.replace(/_/g, " ")}</span>{" "}
                    <span style={{ color: "#aaa", fontSize: "0.72rem" }}>{pct}%</span>
                  </span>
                );
              })}
            </div>
          );
        })()}
        {(() => {
          // Ethnicities chart sits right under Pop Level (its original spot).
          // Trimmed marginTop / removed minHeight so the Resources + Tags
          // blocks below sit close to it instead of floating in dead space.
          const ethData = parseEth(typeof ethnicities === 'string' ? ethnicities : (Array.isArray(ethnicities) ? ethnicities.join(' ') : ''));
          if (ethData.length === 0) return null;
          return (
            <div style={{ marginTop: 2 }} title={ethData.map(e => `${e.name.replace(/_/g, " ")} ${e.pct}%`).join("  ·  ")}>
              <div style={{ display: "flex", height: 10, borderRadius: 3, overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)" }}>
                {ethData.map((e, i) => {
                  const col = getEthColor(e.name);
                  return (
                    <div key={i} title={`${e.name.replace(/_/g, " ")} ${e.pct}%`} style={{
                      width: `${e.pct}%`, background: `rgb(${col[0]},${col[1]},${col[2]})`,
                      minWidth: e.pct > 0 ? 2 : 0,
                    }} />
                  );
                })}
              </div>
            </div>
          );
        })()}
        {Array.isArray(resources) && resources.length > 0 && (() => {
          // Bucket by descr_strat category so trade goods stay separated from
          // slaves (raw commodity) and ambience (aqueducts / shipwrecks). The
          // parser tags each entry with `category`; older bundles missing the
          // tag default to "trade" so behaviour is unchanged for vanilla mods.
          const buckets = { trade: {}, slave: {}, ambience: {} };
          for (const r of resources) {
            const k = String(r.type || "").toLowerCase();
            if (!k) continue;
            const cat = (r.category === "slave" || r.category === "ambience") ? r.category : "trade";
            const bag = buckets[cat];
            bag[k] = (bag[k] || 0) + (r.amount || 1);
          }
          // Preserve descr_strat order: first-seen wins (no sort) so the chip
          // sequence matches the file. The Map keeps insertion order; we just
          // re-walk `resources` to seed it.
          const orderedKeys = { trade: [], slave: [], ambience: [] };
          for (const r of resources) {
            const k = String(r.type || "").toLowerCase();
            if (!k) continue;
            const cat = (r.category === "slave" || r.category === "ambience") ? r.category : "trade";
            if (!orderedKeys[cat].includes(k)) orderedKeys[cat].push(k);
          }
          const SECTIONS = [
            { cat: "trade", label: "Resources" },
            { cat: "slave", label: "Slaves" },
            { cat: "ambience", label: "Ambience" },
          ];
          const visible = SECTIONS.filter(s => orderedKeys[s.cat].length > 0);
          if (visible.length === 0) return null;
          return (
            <>
              {visible.map(({ cat, label }) => (
                <div key={cat} style={{ marginTop: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.75rem", marginBottom: 2, color: "#cfc6b0" }}>{label}:</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 4px" }}>
                    {orderedKeys[cat].map((type) => {
                      const amount = buckets[cat][type];
                      return (
                        <span key={type} style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "1px 5px", borderRadius: 4,
                          background: "rgba(220,166,74,0.16)",
                          fontSize: "0.7rem", whiteSpace: "nowrap",
                        }}>
                          {resourceImages && resourceImages[type] && (
                            <img src={resourceImages[type].src} alt={type}
                              style={{ width: 12, height: 12, objectFit: "contain" }} />
                          )}
                          {type.replace(/_/g, " ")}
                          {amount > 1 ? <span style={{ color: "#aaa" }}>×{amount}</span> : null}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          );
        })()}
        {tagsList.length > 0 && (() => {
          const groups = {};
          for (const t of tagsList) {
            const cat = categoriseTag(t);
            // null = explicitly suppressed (e.g. Fertility — already shown
            // as a coloured line above the tag list).
            if (cat == null) continue;
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(t);
          }
          const orderedCats = CATEGORY_ORDER.filter((c) => groups[c]);
          return (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontWeight: 700, fontSize: "0.75rem", marginBottom: 2, color: "#cfc6b0" }}>Tags:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {orderedCats.map((cat) => (
                  <div key={cat} style={{ display: "flex", flexWrap: "wrap", gap: "2px 4px", alignItems: "center" }}>
                    <span style={{ fontSize: "0.62rem", color: "#a8a094", marginRight: 2, minWidth: 56 }}>{cat}</span>
                    {groups[cat].map((t, i) => {
                      const isHr = cat === "Hidden Resource";
                      const isActive = isHr && hoveredHr === t.toLowerCase();
                      return (
                        <span key={`${t}-${i}`}
                          onMouseEnter={isHr ? () => setHoveredHr(t.toLowerCase()) : undefined}
                          onMouseLeave={isHr ? () => setHoveredHr((cur) => cur === t.toLowerCase() ? null : cur) : undefined}
                          title={isHr ? `Hover: highlight recruits gated on hidden_resource ${t}` : undefined}
                          style={{
                            padding: "1px 5px", borderRadius: 4,
                            background: isActive
                              ? "rgba(220,166,74,0.35)"
                              : (CATEGORY_COLOURS[cat] || "rgba(255,255,255,0.08)"),
                            outline: isActive ? "1px solid #dca64a" : "none",
                            outlineOffset: -1,
                            fontSize: "0.7rem", whiteSpace: "nowrap",
                            cursor: isHr ? "default" : "default",
                            transition: "background 120ms var(--ease-mac-out)",
                          }}>{t}</span>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        {modeExtra && (
          <div style={{ marginTop: 4, padding: "2px 6px", borderRadius: 4, background: "rgba(220,166,74,0.2)", display: "inline-block" }}>
            <strong>{modeExtra.label}:</strong> {modeExtra.value}
          </div>
        )}
        </div>
      </div>
      </Movable>

      {/* Characters — Movable widget extracted from buildings */}
      <Movable id="region.characters" title="Characters" designMode={designMode} colBox={colBox}
        posOverride={addGenOpen ? { y: 0.4400, h: 0.3130 } : null}
        zIndex={addGenOpen ? 6 : 2}
        defaultPct={{ x: 0.5720, y: 0.4360, w: 0.2090, h: 0.1480 }}>
      <div className={panelInnerClass} style={addGenOpen ? { ...panelInner, background: "#181b21" } : panelInner}>
        <div style={widgetHeader}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#fd8", display: "flex", alignItems: "center", gap: 6 }}>
            <span>Characters:</span>
            {characters && characters.length > 0 && (
              <span
                title={characters[0]?._source === "starting"
                  ? "Starting roster from descr_strat — turn-1 traits, ancillaries, age. Load a save to switch to live values."
                  : (saveFile ? `As of: ${saveFile}` : "From save file")}
                style={{ fontSize: "0.65rem", color: "#a98", fontWeight: 400, cursor: "help" }}>
                {characters[0]?._source === "starting" ? "(starting)" : "(live)"}
              </span>
            )}
            {onShowFamilyTree && hasFamilyTreeData && (
              <button
                onClick={(e) => { e.stopPropagation(); onShowFamilyTree(); }}
                title="Show full faction family tree (parents, spouses, children — from descr_strat in mod-data mode or live save when loaded)"
                style={{
                  marginLeft: "auto",
                  padding: "1px 6px",
                  fontSize: "0.65rem",
                  background: "rgba(168, 134, 92, 0.18)",
                  color: "#ffe6a8",
                  border: "1px solid rgba(168, 134, 92, 0.6)",
                  borderRadius: 3,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                👪 Family Tree
              </button>
            )}
            {devMode && (
              <button onClick={(e) => { e.stopPropagation(); setAddGenOpen(true); }}
                title="Add a new named general (+ family) to this faction in descr_strat (new campaigns)"
                style={{ marginLeft: (onShowFamilyTree && hasFamilyTreeData) ? 4 : "auto", padding: "1px 6px", fontSize: "0.65rem", background: "rgba(92,168,120,0.18)", color: "#bfe8bf", border: "1px solid rgba(92,168,120,0.6)", borderRadius: 3, cursor: "pointer", fontWeight: 600 }}>
                + Add General
              </button>
            )}
          </div>
        </div>
        <div style={widgetBody}>
        {addGenOpen ? (
          <AddGeneralModal
            settlementName={(info && (info.city || info.name || info.region)) || null}
            ownerFactionId={ownerFactionId}
            factionLabel={factionLabel}
            onStage={onStageGeneral}
            onClose={() => setAddGenOpen(false)}
          />
        ) : (
          <div style={{ fontSize: "0.72rem" }}>
            {pendingHere.length > 0 && (
              <div style={{ marginBottom: 6, padding: "4px 7px", background: "rgba(92,168,120,0.12)", border: "1px solid rgba(92,168,120,0.4)", borderRadius: 4 }}>
                <div style={{ color: "#bfe8bf", fontWeight: 600, fontSize: "0.64rem", marginBottom: 2 }}>Pending — Save to apply (revert under Changes):</div>
                {pendingHere.map((p) => (
                  <div key={p.id} style={{ color: "#cdeccd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    + {p.displayName}<span style={{ color: "#8aa88a", marginLeft: 6 }}>· age {p.age != null ? p.age : "?"}</span>
                  </div>
                ))}
              </div>
            )}
            {characters && characters.length > 0 ? (
            <div>
              {characters.map((c, i) => {
                const sym = c.isLeader ? "👑" : c.isHeir ? "★" : c.gender === "female" ? "♀" : "";
                const status = c.isDead ? " (dead)" : "";
                const fullName = displayFullName(c.firstName, c.lastName);
                return (
                  <div key={i}
                    onContextMenu={(e) => {
                      if (onShowInfo) {
                        e.preventDefault();
                        onShowInfo({ type: "character", character: c, label: fullName });
                      }
                    }}
                    title="Right-click to view traits"
                    style={{ padding: "1px 0", color: "#eee", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: onShowInfo ? "context-menu" : "default" }}
                  >
                    {sym ? sym + " " : ""}{fullName}
                    <span style={{ color: "#999", fontVariantNumeric: "tabular-nums", marginLeft: 6 }}>· age {c.age != null ? c.age : "?"}</span>
                    {/* 0.9.422: stats chip renders if any of the four are
                        known. Non-live mode: estimated from trait/ancillary
                        effects in main.js (descr_strat doesn't store stats
                        inline — the engine derives them). Estimates carry
                        a leading `~` to flag they're approximate. */}
                    {(c.command != null || c.influence != null || c.management != null || c.loyalty != null) && (
                      <span style={{ color: "#9bb1c8", fontVariantNumeric: "tabular-nums", marginLeft: 6, fontSize: "0.66rem" }}
                        title={`Command ${c.command ?? "?"} · Influence ${c.influence ?? "?"} · Management ${c.management ?? "?"} · Loyalty ${c.loyalty ?? "?"}${c._statsEstimated ? " (estimated from trait+ancillary effects)" : ""}`}>
                        {c._statsEstimated ? "~" : ""}⚔ {c.command ?? "?"}/{c.influence ?? "?"}/{c.management ?? "?"}/{c.loyalty ?? "?"}
                      </span>
                    )}
                    {status && <span style={{ color: "#c66", marginLeft: 4 }}>{status}</span>}
                  </div>
                );
              })}
            </div>
            ) : pendingHere.length === 0 ? (
              <span style={{ color: "#bbb", fontStyle: "italic", fontSize: "0.75rem" }}>No characters</span>
            ) : null}
          </div>
        )}
        </div>
      </div>
      </Movable>

      {/* Diplomacy & Treasury — Movable widget (0.9.533). Shows the selected
          region's owning faction's live treasury, AI personality archetype,
          and a diplomacy summary (war/ally counts). Data decoded from the
          save via the cracked faction_id + treasury + diplomacy records. */}
      <Movable id="region.diplomacy" title="Diplomacy & Treasury" designMode={designMode} colBox={colBox}
        defaultPct={{ x: 0.5720, y: 0.2770, w: 0.2090, h: 0.1500 }}>
      <div className={panelInnerClass} style={panelInner}
        title={(devMode && ownerFactionId) ? "Right-click to inspect raw diplomacy data" : undefined}
        onContextMenu={(devMode && ownerFactionId && (diplomacyMatrix || (factionState && !factionState.noData))) ? (e) => { e.preventDefault(); e.stopPropagation(); setDiploRawOpen((v) => !v); } : undefined}>
        {devMode && diploRawOpen && diplomacyMatrix && ownerFactionId && (() => {
          const fid = String(ownerFactionId).toLowerCase();
          const mine = diplomacyMatrix[fid];
          const relOf = (a, b) => { const r = diplomacyMatrix[a] && diplomacyMatrix[a].rel; return r ? (r.find((e) => e.to && e.to.toLowerCase() === b) || null) : null; };
          // partners = union of this faction's non-neutral rels (outgoing) and
          // any faction that has a non-neutral rel toward it (incoming).
          const partners = new Map();
          if (mine && mine.rel) for (const e of mine.rel) partners.set(e.to.toLowerCase(), e.to);
          for (const k in diplomacyMatrix) {
            if (k === fid || k === "_meta") continue;
            const r = diplomacyMatrix[k] && diplomacyMatrix[k].rel;
            if (r && r.some((e) => e.to && e.to.toLowerCase() === fid)) partners.set(k, k);
          }
          const rows = [...partners.entries()].map(([pk, pname]) => {
            const out = relOf(fid, pk) || { att: 200, bond: 6, agg: 200 };
            const inc = relOf(pk, fid) || { att: 200, bond: 6, agg: 200 };
            return { name: factionLabel(pname) || pname, pk, out, inc };
          }).sort((a, b) => (a.out.att - b.out.att) || a.name.localeCompare(b.name));
          const cell = (c) => `${c.att} (${dsAttitudeLabel(c.att)}) · bond ${c.bond} · agg ${c.agg}`;
          return createPortal(
            <div onClick={() => setDiploRawOpen(false)} style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 2147483000,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div onClick={(e) => e.stopPropagation()} style={{
                background: "#15171c", border: "1px solid #3a3f4a", borderRadius: 6,
                padding: 14, maxWidth: "70vw", maxHeight: "80vh", overflow: "auto",
                fontSize: "0.72rem", color: "#ddd", boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
              }}>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#fd8", marginBottom: 2 }}>
                  Raw diplomacy numbers — {factionLabel(ownerFactionId) || ownerFactionId}
                </div>
                <div style={{ color: "#8a93a8", fontSize: "0.62rem", marginBottom: 8 }}>
                  core_attitudes: -10 Locked Allied · 0 Allied · 100 Suspicious · 200 Neutral · 400 Hostile · 600 At War · 850 Total War · 1000 Crazy. bond: 6 normal / 54 protectorate-ally / 55 special. agg = faction_aggression (recalc/turn). Pairs not listed are Neutral 200. {diplomacyMatrix._meta ? `[matrix base 0x${(diplomacyMatrix._meta.base||0).toString(16)} stride ${diplomacyMatrix._meta.stride} C ${diplomacyMatrix._meta.C} sym ${Math.round((diplomacyMatrix._meta.symmetry||0)*100)}%]` : ""} — click anywhere to close.
                </div>
                {rows.length === 0 ? <div style={{ color: "#888" }}>All-neutral (no non-default relations).</div> : (
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <thead><tr style={{ color: "#9ab", textAlign: "left" }}>
                      <th style={{ padding: "2px 10px 4px 0" }}>Faction</th>
                      <th style={{ padding: "2px 10px 4px 0" }}>{factionLabel(ownerFactionId) || "this"} → them</th>
                      <th style={{ padding: "2px 0 4px 0" }}>them → {factionLabel(ownerFactionId) || "this"}</th>
                    </tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.pk} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                          <td style={{ padding: "3px 10px 3px 0", color: "#fff", whiteSpace: "nowrap" }}>{r.name}</td>
                          <td style={{ padding: "3px 10px 3px 0", color: r.out.att >= 600 ? "#e8a0a0" : r.out.att === 0 ? "#9ed09e" : r.out.att >= 400 ? "#e0c080" : "#bbb", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{cell(r.out)}</td>
                          <td style={{ padding: "3px 0", color: r.inc.att >= 600 ? "#e8a0a0" : r.inc.att === 0 ? "#9ed09e" : r.inc.att >= 400 ? "#e0c080" : "#bbb", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{cell(r.inc)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>,
            document.body
          );
        })()}
        {/* Campaign-start raw-inspect — no save loaded, so no numeric attitude
            matrix exists; show the descr_strat starting stances + treasury. */}
        {devMode && diploRawOpen && !diplomacyMatrix && factionState && !factionState.noData && ownerFactionId && createPortal(
          <div onClick={() => setDiploRawOpen(false)} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 2147483000,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              background: "#15171c", border: "1px solid #3a3f4a", borderRadius: 6,
              padding: 14, maxWidth: "60vw", maxHeight: "80vh", overflow: "auto",
              fontSize: "0.78rem", color: "#ddd", boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
            }}>
              <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#fd8", marginBottom: 2 }}>
                Raw diplomacy (campaign start) — {factionLabel(ownerFactionId) || ownerFactionId}
              </div>
              <div style={{ color: "#8a93a8", fontSize: "0.62rem", marginBottom: 8 }}>
                These are the engine's STARTING core_attitudes, derived from the descr_strat stances: Allied = 0, At War = 600, and every faction not listed below = Neutral (200). Load a save to see the live per-turn values. Click anywhere to close.
              </div>
              {(() => {
                const sec = (label, arr, color, num) => (arr && arr.length)
                  ? <div key={label} style={{ marginBottom: 4 }}><span style={{ color }}>{label}:</span> <span style={{ color: "#ddd" }}>{arr.map((n) => `${n} ${num}`).join(", ")}</span></div>
                  : null;
                const any = (factionState.startWars && factionState.startWars.length) || (factionState.startAllies && factionState.startAllies.length) || (factionState.startProtects && factionState.startProtects.length) || (factionState.startProtectedBy && factionState.startProtectedBy.length);
                return <>
                  {sec("⚔ War", factionState.startWars, "#e8a0a0", 600)}
                  {sec("🤝 Allied", factionState.startAllies, "#9ed09e", 0)}
                  {sec("🛡 Protectorate of", factionState.startProtects, "#a0c8e8", 0)}
                  {sec("🛡 Protected by", factionState.startProtectedBy, "#a0c8e8", 0)}
                  <div style={{ marginTop: 4, color: "#9aa" }}>Everyone else: <span style={{ color: "#ddd" }}>200 (Neutral)</span></div>
                  {factionState.treasury != null && <div style={{ marginTop: 6, color: "#bbb" }}>Treasury: <span style={{ color: "#ddd" }}>{factionState.treasury}</span></div>}
                  {!any && <div style={{ color: "#888" }}>No declared stances — every faction starts at 200 (Neutral).</div>}
                </>;
              })()}
            </div>
          </div>,
          document.body
        )}
        <div style={widgetHeader}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#fd8", display: "flex", alignItems: "center", gap: 6 }}>
            <span>Diplomacy &amp; Treasury{liveOwner ? <span style={{ fontSize: "0.65rem", color: "#a98", fontWeight: 400, marginLeft: 6 }}>{factionLabel(ownerFactionId) || liveOwner}</span> : null}</span>
            {devMode && ownerFactionId && (
              <button onClick={(e) => { e.stopPropagation(); setDiploEditOpen(true); }}
                title="View / edit every faction's starting attitude toward this faction (writes to descr_strat on Save)"
                style={{ marginLeft: "auto", padding: "1px 6px", fontSize: "0.62rem", background: "rgba(92,140,200,0.18)", color: "#bcd6f0", border: "1px solid rgba(92,140,200,0.6)", borderRadius: 3, cursor: "pointer", fontWeight: 600 }}>
                ✎ All numbers
              </button>
            )}
          </div>
        </div>
        {diploEditOpen && createPortal(
          <DiplomacyEditor
            ownerFactionId={ownerFactionId}
            factionLabel={factionLabel}
            factionDisplayNames={factionDisplayNames}
            onStageEdit={onStageDiplomacy}
            pendingDiplo={pendingDiplomacy}
            regions={regions}
            regionCentroids={regionCentroids}
            victoryConditions={victoryConditions}
            onClose={() => setDiploEditOpen(false)}
          />, document.body)}
        <div style={widgetBody}>
          {(factionState && !factionState.noData) ? (
            <div style={{ fontSize: "0.75rem", display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ color: "#bbb" }}>Treasury{factionState.isStarting && <span style={{ color: "#a98", fontSize: "0.62rem", marginLeft: 4 }}>(starting)</span>}</span>
                <span style={{
                  fontVariantNumeric: "tabular-nums", fontWeight: 700,
                  color: factionState.treasury == null ? "#888"
                    : factionState.treasury < 0 ? "#e85050"
                    : factionState.treasury >= 5000 ? "#9ec78a"
                    : factionState.treasury >= 1000 ? "#f4cd57" : "#e89030",
                }} title={factionState.isStarting
                  ? "Starting denarii from descr_strat. Live treasury isn't available for this faction (player faction or a minor faction without a save treasury record)."
                  : (factionState.turnStart != null && factionState.turnStart !== factionState.treasury
                    ? `Started this turn at ${factionState.turnStart.toLocaleString()} (net ${(factionState.treasury - factionState.turnStart >= 0 ? "+" : "") + (factionState.treasury - factionState.turnStart).toLocaleString()})`
                    : "Current treasury, decoded from the save")}>
                  {factionState.treasury != null ? factionState.treasury.toLocaleString() + " d" : "—"}
                  {!factionState.isStarting && <span style={{ color: "#4a8", marginLeft: 4, fontSize: "0.66rem", fontWeight: 400 }}>·live</span>}
                </span>
              </div>
              {(() => {
                // 0.9.549: treasury-over-time sparkline (f13 per-turn checkpoints).
                const fid = ownerFactionId ? String(ownerFactionId).toLowerCase() : null;
                const series = fid && treasuryHistory ? treasuryHistory[fid] : null;
                if (!series || series.length < 2) return null;
                const lo = Math.min(...series), hi = Math.max(...series);
                return (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "#bbb" }}>Wealth trend <span style={{ color: "#777", fontSize: "0.62rem" }}>({series.length} turns)</span></span>
                    <span title={`per-turn treasury: ${series.join(" → ")}  (min ${lo.toLocaleString()} / max ${hi.toLocaleString()})`}>
                      <TreasurySparkline series={series} />
                    </span>
                  </div>
                );
              })()}
              {factionState.aiPersonality && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ color: "#bbb" }}>AI personality</span>
                  <span style={{ color: "#8a93a8" }} title={`feral_descr_ai_personality.txt: ${factionState.aiPersonality}`}>
                    {factionState.aiPersonality.replace(/^ai_/, "").replace(/_/g, " ")}
                  </span>
                </div>
              )}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 4, marginTop: 1 }}>
                {/* 0.9.546: NAMED LIVE diplomacy from the N×N attitude matrix
                    (cracked this session — the real diplomacy source). The
                    matrix POSITION encodes the faction pair, so we can finally
                    list WHO each faction is currently at war / allied with, BY
                    NAME, for every faction on the map. Allied includes
                    protectorates (the matrix scores both as DS_ALLIED=0); the
                    protectorate distinction comes from the campaign-start data,
                    shown as a supplement. Falls back to campaign-start named
                    diplomacy (descr_strat + script) when no save is synced. */}
                {factionState.isPlaceholderFaction ? (
                  <div style={{ color: "#888", fontSize: "0.68rem", fontStyle: "italic" }}>
                    Engine placeholder faction — no diplomacy.
                  </div>
                ) : factionState.hasLiveNamed ? (
                  <>
                    <div style={{ color: "#bbb", fontSize: "0.66rem", marginBottom: 2 }}>Diplomacy <span style={{ color: "#4a8" }}>(live)</span></div>
                    {diploLine("⚔", "at war", "#e8a0a0", factionState.liveWar, factionState.atWarWithAll ? "all factions (independent — no peace possible)" : null)}
                    {diploLine("🤝", "allied", "#9ed09e", factionState.liveAllied)}
                    {diploLine("⚠", "hostile", "#e0c080", factionState.liveHostile)}
                    {diploLine("🔄", "trade", "#8fc9d6", factionState.liveTrade)}
                    {diploLine("🛡", "protects", "#9cc0e0", factionState.startProtects)}
                    {diploLine("🛡", "protectorate of", "#9cc0e0", factionState.startProtectedBy)}
                  </>
                ) : ((factionState.startWars && factionState.startWars.length) || (factionState.startAllies && factionState.startAllies.length) || (factionState.startProtects && factionState.startProtects.length) || (factionState.startProtectedBy && factionState.startProtectedBy.length)) ? (
                  <>
                    <div style={{ color: "#bbb", fontSize: "0.66rem", marginBottom: 2 }}>Diplomacy <span style={{ color: "#777" }}>(at campaign start)</span></div>
                    {diploLine("⚔", "war", "#e8a0a0", factionState.startWars)}
                    {diploLine("🤝", "allied", "#9ed09e", factionState.startAllies)}
                    {diploLine("🛡", "protects", "#9cc0e0", factionState.startProtects)}
                    {diploLine("🛡", "protectorate of", "#9cc0e0", factionState.startProtectedBy)}
                  </>
                ) : (
                  <div style={{ color: "#888", fontSize: "0.68rem", fontStyle: "italic" }}>Starts neutral — no declared alliances, wars, or protectorates.</div>
                )}
                {/* Dev mode: the raw per-faction attitude numbers the engine uses
                    to evaluate every relationship (cracked core_attitudes matrix).
                    Only exists once a save is synced (the engine computes these). */}
                {devMode && diplomacyMatrix && ownerFactionId && (() => {
                  const fid = String(ownerFactionId).toLowerCase();
                  const row = diplomacyMatrix[fid];
                  if (!row || !Array.isArray(row.rel) || row.rel.length === 0) return null;
                  const isReal = (n) => n && !/(_rebels|^slave$|^slaves$|^rebels$|^dummies$)/.test(n);
                  const nm = (n) => (factionDisplayNames && factionDisplayNames[n]) || String(n).replace(/_/g, " ");
                  const rels = row.rel
                    .filter((r) => r.to && isReal(String(r.to).toLowerCase()))
                    .map((r) => ({ name: nm(String(r.to).toLowerCase()), att: r.att, bond: r.bond, agg: r.agg }))
                    .sort((a, b) => (a.att - b.att) || a.name.localeCompare(b.name));
                  if (!rels.length) return null;
                  const colorFor = (att) => att >= 600 ? "#e8a0a0" : att === 0 ? "#9ed09e" : att >= 400 ? "#e0c080" : "#bbc";
                  return (
                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 4, marginTop: 4 }}>
                      <div style={{ color: "#8a93a8", fontSize: "0.6rem", marginBottom: 2 }}>Raw attitudes <span style={{ color: "#677" }}>core_attitudes · dev ({rels.length})</span></div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "1px 10px", fontSize: "0.63rem", fontVariantNumeric: "tabular-nums", maxHeight: 120, overflowY: "auto" }}>
                        {rels.map((r) => (
                          <span key={r.name} title={`${r.name}: attitude ${r.att} (${dsAttitudeLabel(r.att)}) · bond ${r.bond} · aggression ${r.agg}`}>
                            <span style={{ color: "#cdd6e6" }}>{r.name}</span> <span style={{ color: colorFor(r.att), fontWeight: 700 }}>{r.att}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (
            <span style={{ color: "#bbb", fontStyle: "italic", fontSize: "0.75rem" }}>
              {ownerFactionId ? "No treasury data — load a save or 🎯 Calibrate" : "No region selected"}
            </span>
          )}
        </div>
      </div>
      </Movable>

      {/* Building queue — Movable widget extracted from buildings */}
      <Movable id="region.queue" title="Build queue" designMode={designMode} colBox={colBox}
        defaultPct={{ x: 0.8925, y: 0.3453, w: 0.1022, h: 0.1550 }}>
      <div className={panelInnerClass} style={panelInner}>
        <div style={{ padding: "8px 14px", overflow: "auto", height: "100%", boxSizing: "border-box" }}>
        {Array.isArray(buildings?.queuedUpgrades) && buildings.queuedUpgrades.length > 0 ? (
          // Building upgrades in progress, shown as cards like the Buildings
          // panel: the target building's icon with a GREEN overlay filling from
          // the bottom = % complete (50% = bottom half green), matching the
          // in-game construction visual. The building itself stays at its
          // current level in the Buildings panel until this finishes.
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 4 }}>
            {buildings.queuedUpgrades.map((u, i) => {
              const ic = resolveIcon(u.icon) || resolveIcon(u.image) || resolveIcon(u.img);
              const frac = typeof u.progress === "number" ? Math.min(1, Math.max(0, u.progress)) : 0;
              return (
                <div key={i}
                  title={`${u.fromLabel ? u.fromLabel + " → " : ""}${u.label}${u.percent != null ? ` — ${u.percent}% complete` : ""}`}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "rgba(0,0,0,0.25)", border: "2px solid #e89030", borderRadius: 4, padding: "4px 3px", overflow: "hidden" }}>
                  <div style={{ position: "relative", width: "100%", height: 44 }}>
                    {ic && <img src={ic} alt={u.label} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${frac * 100}%`, background: "rgba(60,200,80,0.55)", pointerEvents: "none", borderRadius: 2 }} />
                    {typeof u.turnsRemaining === "number" && (
                      <div style={{
                        position: "absolute", top: 0, right: 0,
                        minWidth: 13, height: 13, padding: "0 2px", boxSizing: "border-box",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "rgba(0,0,0,0.78)", color: "#fff",
                        fontSize: "0.62rem", fontWeight: 700, lineHeight: 1,
                        borderRadius: 2, pointerEvents: "none",
                      }}>{u.turnsRemaining}</div>
                    )}
                  </div>
                  <span style={{ fontSize: "0.58rem", color: "#cde", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                    {u.label}{u.percent != null ? ` ${u.percent}%` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        ) : Array.isArray(buildingQueue) && buildingQueue.length > 0 ? (
          <div
            title="Construction queue (decoded from save's default_set chain — session 36)"
            style={{
              marginBottom: 4,
              padding: "3px 6px",
              background: "rgba(60,200,80,0.10)",
              border: "1px solid rgba(60,200,80,0.35)",
              borderRadius: 3,
              fontSize: "0.75rem",
              lineHeight: 1.3,
            }}
          >
            <span style={{ color: "#9fc78a", fontWeight: 700, marginRight: 4 }}>Building:</span>
            {buildingQueue.map((q, i) => {
              // Prefer turnsRemaining (cracked 2026-05-21). Fall back to total
              // for saves parsed by older clients that only have `turns`.
              const rem = Number.isFinite(q.turnsRemaining) ? q.turnsRemaining : null;
              const tot = Number.isFinite(q.turnsTotal) ? q.turnsTotal : q.turns;
              const show = rem != null ? rem : tot;
              const valid = Number.isFinite(show) && show > 0 && show < 1000;
              return (
                <span key={i} style={{ color: "#cde" }}>
                  {i > 0 ? ", " : ""}chain #{q.chainId}
                  {valid ? ` — ${show} turn${show === 1 ? "" : "s"} left` : ""}
                </span>
              );
            })}
          </div>
        ) : (
          <span style={{ color: "#888", fontStyle: "italic", fontSize: "0.72rem" }}>No queue</span>
        )}
        </div>
      </div>
      </Movable>

      {/* Unit queue — Movable widget. Lists units currently being
          recruited in this settlement (recruitingNow from save). */}
      <Movable id="region.unitQueue" title="Unit queue" designMode={designMode} colBox={colBox}
        defaultPct={{ x: 0.7857, y: 0.3453, w: 0.1021, h: 0.1550 }}>
      <div className={panelInnerClass} style={panelInner}>
        <div style={{ padding: "8px 14px", overflow: "auto", height: "100%", boxSizing: "border-box" }}>
        {Array.isArray(recruitingNow) && recruitingNow.length > 0 ? (
          <div
            title="Recruitment queue (decoded from save's recruit chain — session 36)"
            style={{
              padding: "3px 6px",
              background: "rgba(60,200,80,0.10)",
              border: "1px solid rgba(60,200,80,0.35)",
              borderRadius: 3,
              fontSize: "0.75rem",
              lineHeight: 1.3,
            }}
          >
            <span style={{ color: "#9fc78a", fontWeight: 700, marginRight: 4 }}>Recruiting:</span>
            {recruitingNow.map((r, i) => (
              <span key={i} style={{ color: "#cde" }}>
                {i > 0 ? ", " : ""}{(r.unit || "?").replace(/_/g, " ")}
                {Number.isFinite(r.turns) && r.turns > 0 && r.turns < 1000
                  ? ` — ${r.turns} turn${r.turns === 1 ? "" : "s"}`
                  : ""}
              </span>
            ))}
          </div>
        ) : (
          <span style={{ color: "#888", fontStyle: "italic", fontSize: "0.72rem" }}>No queue</span>
        )}
        </div>
      </div>
      </Movable>

      {/* Buildings grid — Movable widget */}
      <Movable id="region.buildings" title="Buildings" designMode={designMode} colBox={colBox}
        defaultPct={{ x: 0.5720, y: 0.5940, w: 0.2090, h: 0.4000 }}>
      <div className={panelInnerClass} style={panelInner}>
        <div style={widgetHeader}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>Buildings:{devMode ? " — dev edit" : ""}</div>
            {savingMsg && (
              <span style={{ color: "#dca64a", fontSize: "0.66rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{savingMsg}</span>
            )}
            {iconReplaceMsg && (
              <span style={{ color: "#4ab4dc", fontSize: "0.66rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{iconReplaceMsg}</span>
            )}
          </div>
        </div>
        <div style={widgetBody}>
        {(buildingItems.length > 0 || devMode) ? (
          (() => {
            // 0.9.533: fixed 5×4 = 20-slot grid. A region can hold at most
            // ~20 buildings, so we cap the list at 20 and use exactly 5
            // columns (4 rows) regardless of widget width — bigger, evenly
            // sized cards instead of the old width-dependent auto-fill that
            // reflowed to 6+ narrow columns. In dev mode the "+ Add" tile
            // takes one slot so the empty-placeholder count is reduced.
            const padded = buildingItems.slice(0, 20);
            const addSlot = devMode ? 1 : 0;
            const emptyCount = Math.max(0, 20 - padded.length - addSlot);
            return (
          <div
            ref={buildingsBoxRef}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gridAutoRows: "80px",
              gap: 4,
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              alignContent: "start",
            }}
          >
            {padded.map((b) => {
              // Overlay: queued buildings get a green bar matching progress;
              // damaged buildings (health < 100) get a red bar matching
              // damage. Fraction = portion of icon covered from the bottom.
              let overlayColor = null, overlayFraction = 0;
              if (b.queued) {
                overlayColor = "rgba(60,200,80,0.55)";
                // Green = fraction COMPLETED, growing from bottom as the build
                // progresses — same as the game's construction-queue visual.
                overlayFraction = typeof b.progress === "number" ? Math.min(1, Math.max(0, b.progress)) : 0;
              } else if (b.health != null && b.health < 100) {
                overlayColor = "rgba(220,60,60,0.55)";
                overlayFraction = (100 - b.health) / 100;
              }
              // Cross-link highlighting: this building card lights up if
              // the user is hovering a recruit unit that this chain gates.
              const linkedFromRecruit = hoveredRecruit && (recruitGatedBy?.[hoveredRecruit] || []).includes(b.type);
              const isHoveredChain = hoveredChain === b.type;
              // Dev-mode edit affordances: chain lookup tells us whether
              // up/down are possible. If catalogue missing or chain absent,
              // hide arrows (× still works — same defensive pattern as the
              // trait editor when traitData is missing).
              const chainLevels = catalogue?.chains?.[b.type];
              const chainIdx = Array.isArray(chainLevels) ? chainLevels.indexOf(b.level) : -1;
              const upTargetLevel = (chainIdx >= 0 && chainLevels && chainIdx < chainLevels.length - 1) ? chainLevels[chainIdx + 1] : null;
              // 0.9.473: strict settlement-tier cap. The ⬆ button still
              // renders when there's a next level (so the user can see what
              // the chain offers) but is DISABLED + tooltip explains why
              // when the candidate level's settlement_min would exceed the
              // current settlement tier — replaces the prior "silently
              // hidden" behaviour. requires-clause failures still hide the
              // button (they're region-permanent rejections, not gateable).
              const upDetail = upTargetLevel ? canUpgradeToDetail(b.type, upTargetLevel) : { ok: false };
              const upBlockedByTier = upTargetLevel && !upDetail.ok && upDetail.reason === "settlement_min";
              const upBlockedByRequires = upTargetLevel && !upDetail.ok && upDetail.reason === "requires";
              const canUp = devMode && upTargetLevel != null && upDetail.ok;
              const showUpDisabled = devMode && upTargetLevel != null && upBlockedByTier;
              const canDown = devMode && chainIdx > 0;
              if (devMode && upBlockedByRequires) {
                console.log(`[building-edit-cap] disabled up: ${b.type} ${b.level} → ${upTargetLevel} (requires clause excludes region)`);
              }
              if (showUpDisabled) {
                console.log(`[building-edit-cap] disabled up: ${b.type} ${b.level} → ${upTargetLevel} (needs ${upDetail.requiredTier}, have ${currentCoreLevel || "none"})`);
              }
              // 0.9.473: tier-mismatch flag — current level's settlement_min
              // is higher than current settlement tier (user demolished core
              // down). Paint a red border + tooltip; user can choose to
              // demolish/downgrade. We log once per render so the live log
              // proves enforcement is working.
              const mismatch = devMode ? tierMismatch(b.type, b.level) : null;
              if (mismatch) {
                console.log(`[building-edit-cap] tier-mismatch flagged: ${b.type} ${b.level} (needs ${mismatch.requiredTier}, have ${mismatch.currentTier}) in region ${region}`);
              }
              const isDragOver = dragOverBuildingIdx === b.idx;
              return (
              <div key={b.key}
                onMouseEnter={() => setHoveredChain(b.type)}
                onMouseLeave={() => setHoveredChain((cur) => cur === b.type ? null : cur)}
                onContextMenu={(e) => { if (onShowInfo) { e.preventDefault(); onShowInfo({ type: "building", name: b.level, chainName: b.type, culture: b.culture || null, label: b.label }); } }}
                onDragOver={devMode ? (e) => {
                  // Accept drops of image files. dataTransfer.types is the
                  // safest filter (file MIME isn't readable yet during
                  // dragOver) — "Files" means at least one file is present.
                  if (!e.dataTransfer) return;
                  if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  if (dragOverBuildingIdx !== b.idx) setDragOverBuildingIdx(b.idx);
                } : undefined}
                onDragLeave={devMode ? () => {
                  setDragOverBuildingIdx((cur) => cur === b.idx ? null : cur);
                } : undefined}
                onDrop={devMode ? (e) => {
                  e.preventDefault();
                  setDragOverBuildingIdx(null);
                  const files = e.dataTransfer?.files;
                  if (!files || files.length === 0) return;
                  handleIconDrop(b.idx, files[0]);
                } : undefined}
                title={(() => {
                  const base = b.type ? `${b.type.replace(/_/g, " ")}: ${b.label}${b.queued ? " (in construction)" : ""}` : b.label;
                  if (mismatch) return `${base}\nSettlement tier ${mismatch.requiredTier} too low for this building.\n(current: ${mismatch.currentTier})`;
                  if (devMode) return `${base}\n(drop a PNG / JPG / TGA to replace the icon)`;
                  return base;
                })()} style={{
                position: "relative",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                background: isDragOver
                  ? "rgba(74,180,220,0.28)"
                  : (mismatch ? "rgba(220,60,60,0.16)" : (linkedFromRecruit ? "rgba(220,166,74,0.22)" : "rgba(0,0,0,0.25)")),
                borderRadius: 4,
                padding: "4px 3px",
                minWidth: 0,
                minHeight: 0,
                width: "100%", height: "100%",
                boxSizing: "border-box",
                overflow: "hidden",
                transition: "background 150ms var(--ease-mac-out), border-color 150ms var(--ease-mac-out)",
                border: isDragOver
                  ? "2px dashed #4ab4dc"
                  : (mismatch
                    ? "2px solid #dc6060"
                    : (b.queued
                      ? "2px solid #e89030"
                      : ((linkedFromRecruit || isHoveredChain)
                        ? "2px solid #dca64a"
                        : "2px solid transparent"))),
              }}>
                <div style={{ position: "relative", width: "100%", flex: "1 1 0", minHeight: 0 }}>
                  {b.icon && (
                    <img
                      src={b.icon}
                      alt={b.label}
                      // 60×48 keeps RTW's 156×124 aspect (≈1.26:1). Width is
                      // capped at 60 but allowed to shrink (width:100%) so
                      // the icon never overflows when the column gets narrow
                      // — buildings grid now uses fr columns to fit any
                      // panel width.
                      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  )}
                  {overlayColor && (
                    <div style={{
                      position: "absolute", left: 0, right: 0, bottom: 0,
                      height: `${overlayFraction * 100}%`,
                      background: overlayColor,
                      pointerEvents: "none",
                      borderRadius: 2,
                    }} />
                  )}
                </div>
                {devMode && (
                  // Edit affordances overlay — small gold buttons stacked in
                  // the top-right corner. stopPropagation on each click so we
                  // don't trigger the card's hover/context handlers. Positioned
                  // absolutely so the icon + label keep their flex layout.
                  <div
                    onMouseDown={(e) => e.stopPropagation()}
                    onContextMenu={(e) => e.stopPropagation()}
                    style={{
                      position: "absolute", top: 1, right: 1,
                      display: "flex", flexDirection: "column", gap: 1,
                      zIndex: 2,
                    }}
                  >
                    {canUp && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onBuildingUp(b.idx); }}
                        title={`Upgrade to ${chainLevels[chainIdx + 1]}`}
                        style={buildingEditBtnStyle}
                      >{'⬆'}</button>
                    )}
                    {showUpDisabled && (
                      <button
                        disabled
                        onClick={(e) => { e.stopPropagation(); }}
                        title={`Cannot upgrade to ${chainLevels[chainIdx + 1]} — needs settlement ≥ ${upDetail.requiredTier} (current: ${currentCoreLevel || "(none)"})`}
                        style={{ ...buildingEditBtnStyle, opacity: 0.4, cursor: "not-allowed", color: "#888", borderColor: "rgba(120,120,120,0.35)" }}
                      >{'⬆'}</button>
                    )}
                    {canDown && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onBuildingDown(b.idx); }}
                        title={`Downgrade to ${chainLevels[chainIdx - 1]}`}
                        style={buildingEditBtnStyle}
                      >{'⬇'}</button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onBuildingRemove(b.idx); }}
                      title="Remove this building"
                      style={{ ...buildingEditBtnStyle, color: "#dc7f7f", borderColor: "rgba(220,127,127,0.45)" }}
                    >{'×'}</button>
                  </div>
                )}
                <span style={{ color: "#f4f4f4", fontSize: "0.58rem", textAlign: "center", lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", wordBreak: "break-word", hyphens: "auto", width: "100%", flexShrink: 0 }}>
                  {b.tierRoman && <span style={{ color: "#dca64a", fontWeight: 700, marginRight: 3 }}>{b.tierRoman}</span>}
                  {b.label}
                </span>
              </div>
              );
            })}
            {/* Dev-mode: + Add Building tile. Always takes one of the 20
                slots so the grid shape stays predictable. Clicking it opens
                the chain picker (full-grid overlay below). */}
            {devMode && (
              <div
                key="add-building"
                onClick={() => { setShowAddPicker(true); setAddQuery(""); }}
                title="Add a new building chain to this region"
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 4,
                  background: "rgba(220,166,74,0.10)",
                  border: "2px dashed rgba(220,166,74,0.45)",
                  color: "#dca64a",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  width: "100%", height: "100%",
                  boxSizing: "border-box",
                  textAlign: "center",
                  padding: "4px 3px",
                  lineHeight: 1.1,
                }}
              >
                <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>+</span>
                <span>Add building</span>
              </div>
            )}
            {/* Empty-slot placeholders so the 20-slot grid keeps a stable
                shape as the user adds/removes buildings. Faint dashed
                outline, no fill. */}
            {Array.from({ length: emptyCount }).map((_, i) => (
              <div key={`empty-${i}`} style={{
                width: "100%", height: "100%",
                border: "1px dashed rgba(128,128,128,0.25)",
                borderRadius: 4,
                boxSizing: "border-box",
              }} />
            ))}
          </div>
            );
          })()
        ) : (
          <span style={{ color: "#bbb", fontStyle: "italic" }}>No buildings</span>
        )}
        {/* Dev-mode: building-chain picker. Renders below the grid as an
            inline panel — search + list of chains not already in the region.
            Cap at 200 visible (engine has ~150 chains across mods). */}
        {devMode && showAddPicker && (
          <div style={{
            marginTop: 6, padding: "6px 8px",
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(220,166,74,0.3)",
            borderRadius: 4,
            fontSize: "0.72rem",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ color: "#9ab" }}>Add building chain</span>
              <button
                onClick={() => { setShowAddPicker(false); setAddQuery(""); }}
                style={{ ...buildingEditBtnStyle, width: "auto", height: "auto", padding: "1px 6px", marginLeft: "auto" }}
              >cancel</button>
            </div>
            <input
              autoFocus
              placeholder="search chain…"
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "rgba(0,0,0,0.4)", color: "#eee",
                border: "1px solid rgba(220,166,74,0.3)", borderRadius: 3,
                padding: "3px 6px", fontSize: "0.72rem",
              }}
            />
            {!catalogue && (
              <div style={{ color: "#888", marginTop: 4 }}>Loading catalogue…</div>
            )}
            {catalogue && (
              <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 4, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                {availableChainsForAdd.map((entry) => {
                  const c = entry.chain;
                  const cat = catalogue?.categories?.[c];
                  const disabled = !entry.ok;
                  const needsHint = disabled && entry.requiredTier
                    ? ` (needs ${entry.requiredTier.replace(/_/g, " ")})`
                    : "";
                  const title = disabled && entry.requiredTier
                    ? `Settlement tier ${entry.requiredTier} required — current tier is ${currentCoreLevel || "(none)"}`
                    : entry.replaces
                      ? `Adding this replaces ${entry.replaces.replace(/_/g, " ")} (same building slot)`
                      : (cat ? `category: ${cat}` : c);
                  return (
                    <button key={c}
                      onClick={() => {
                        if (disabled) {
                          console.log(`[building-edit-cap] picker-click ignored: ${c} (needs ${entry.requiredTier})`);
                          return;
                        }
                        onBuildingAdd(c);
                      }}
                      disabled={disabled}
                      title={title}
                      style={{
                        textAlign: "left", padding: "2px 5px",
                        background: disabled ? "rgba(120,120,120,0.08)" : "rgba(255,255,255,0.05)",
                        color: disabled ? "#888" : "#eee",
                        border: "1px solid transparent", borderRadius: 2,
                        fontSize: "0.7rem", cursor: disabled ? "not-allowed" : "pointer",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        opacity: disabled ? 0.6 : 1,
                      }}>
                      {c.replace(/_/g, " ")}
                      {needsHint && (
                        <span style={{ color: "#dca64a", fontSize: "0.62rem", marginLeft: 4 }}>{needsHint}</span>
                      )}
                      {!needsHint && entry.replaces && (
                        <span style={{ color: "#7fae7f", fontSize: "0.6rem", marginLeft: 4 }}>↔ replaces</span>
                      )}
                    </button>
                  );
                })}
                {availableChainsForAdd.length === 0 && (
                  <span style={{ color: "#888", fontSize: "0.7rem" }}>(no matches)</span>
                )}
              </div>
            )}
          </div>
        )}
        </div>
      </div>
      </Movable>

      {/* Recruitable — Movable widget */}
      <Movable id="region.recruit" title="Recruitable" designMode={designMode} colBox={colBox}
        defaultPct={{ x: 0.7857, y: 0.0083, w: 0.2090, h: 0.3287 }}>
      <div className={panelInnerClass} style={panelInner}>
        <div style={widgetHeader}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", color: aorUnits != null ? "#dca64a" : "#9fc78a" }}>{aorUnits != null ? "AOR Units:" : "Recruitable:"}</div>
        </div>
        <div style={widgetBody}>
        {aorUnits != null ? (() => {
          // AOR map mode: the Recruitable widget shows the full owner-independent
          // AOR roster instead, as unit cards in the SAME grid style. Units with
          // a faction restriction get a coloured outline + a small bottom caption
          // (green "only: …" / amber "not: …"); full list in the hover title.
          if (aorUnits.length === 0) {
            return <span style={{ color: "#bbb", fontStyle: "italic", fontSize: "0.75rem" }}>No AOR units for this region</span>;
          }
          const cleanUnit = (t) => String(t || "").replace(/^aor\s+/i, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          const shortFactions = (arr) => {
            const n = arr.map(factionLabel);
            return n.length > 3 ? `${n.slice(0, 3).join(", ")} +${n.length - 3}` : n.join(", ");
          };
          const noteFor = (u) => {
            if (u.only && u.only.length) return { short: `only: ${shortFactions(u.only)}`, full: `${u.only.map(factionLabel).join(", ")} only`, color: "#9fc78a", bg: "rgba(60,160,80,0.9)" };
            if (u.except && u.except.length) return { short: `not: ${shortFactions(u.except)}`, full: `all except ${u.except.map(factionLabel).join(", ")}`, color: "#e8a060", bg: "rgba(200,120,40,0.9)" };
            return null;
          };
          const sorted = aorUnits.slice().sort((a, b) => {
            const ta = (a.aors || []).slice().sort().join(","), tb = (b.aors || []).slice().sort().join(",");
            if (ta !== tb) return ta.localeCompare(tb);
            return cleanUnit(a.unit).localeCompare(cleanUnit(b.unit));
          });
          return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gridAutoRows: "min-content", gap: 3, flex: 1, minHeight: 0, overflowY: "auto" }}>
              {sorted.map((u, i) => {
                const note = noteFor(u);
                const aorLabel = (u.aors || []).map((a) => a.replace(/^aor_/, "")).join(", ");
                return (
                  <div key={i}
                    onContextMenu={(e) => { if (onShowInfo) { e.preventDefault(); onShowInfo({ type: "unit", faction: u.faction, name: u.unit, label: cleanUnit(u.unit) }); } }}
                    title={cleanUnit(u.unit) + (aorLabel ? `\nAOR: ${aorLabel}` : "") + (note ? `\n${note.full}` : "\nall factions")}
                    style={{ position: "relative", padding: 2, background: "rgba(0,0,0,0.35)", borderRadius: 3, minWidth: 0, outline: note ? `1px solid ${note.color}` : "none", outlineOffset: -1 }}>
                    {u.icon ? (
                      <img src={u.icon} alt={u.unit}
                        style={{ width: "100%", aspectRatio: "164 / 224", objectFit: "cover", display: "block", borderRadius: 2 }}
                        onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    ) : (
                      <div style={{ width: "100%", aspectRatio: "164 / 224", background: "rgba(255,255,255,0.06)", borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.5rem", color: "#9a9a9a", textAlign: "center", padding: 2, lineHeight: 1.1 }}>{cleanUnit(u.unit)}</div>
                    )}
                    {note && (
                      <div style={{ position: "absolute", left: 2, right: 2, bottom: 2, background: note.bg, color: "#0b0b0b", fontSize: "0.5rem", fontWeight: 700, padding: "1px 2px", borderRadius: 2, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{note.short}</div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })() : (() => {
          // Build a normalised set of unit names currently in the recruit
          // queue (session 36 schema). The save uses spaces ("roman leves")
          // while EDU uses underscores ("roman_leves"), so we key on
          // lowercase-collapsed-non-alphanum.
          const recruitingSet = new Set();
          if (Array.isArray(recruitingNow)) {
            for (const r of recruitingNow) {
              if (r && r.unit) recruitingSet.add(String(r.unit).toLowerCase().replace(/[^a-z0-9]/g, ""));
            }
          }
          const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          return recruitable && recruitable.length > 0 ? (
            <div style={{
              display: "grid",
              // 6 columns, all 1fr → cards scale with widget width. Cards
              // keep their portrait aspect (164:224) so taller widgets get
              // larger icons. Extras scroll; the scrollbar is hidden globally.
              gridTemplateColumns: "repeat(6, 1fr)",
              gridAutoRows: "min-content",
              gap: 3,
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
            }}>
              {recruitable.map((u, i) => {
                const gatedSet = u.gatedBy || (recruitGatedBy?.[u.unit] ?? []);
                const linkedFromBuilding = hoveredChain && gatedSet.includes(hoveredChain);
                const linkedFromHr = hoveredHr && (u.hrGates || []).includes(hoveredHr);
                const isHoveredHere = hoveredRecruit === u.unit;
                const upgradeOnly = u.available === false;
                const isRecruiting = recruitingSet.has(norm(u.unit));
                const canAddToArmy = devMode && selectedArmyKey && onAddUnitToSelectedArmy;
                return (
                  <div key={i}
                    onMouseEnter={() => setHoveredRecruit(u.unit)}
                    onMouseLeave={() => setHoveredRecruit((cur) => cur === u.unit ? null : cur)}
                    onContextMenu={(e) => { if (onShowInfo) { e.preventDefault(); onShowInfo({ type: "unit", faction: u.faction, name: u.unit, label: u.unit.replace(/_/g, " ") }); } }}
                    onClick={(e) => {
                      // 0.9.648 dev: click a recruitable unit to append it to
                      // the currently-selected army (garrison or field army).
                      if (!canAddToArmy) return;
                      e.preventDefault();
                      onAddUnitToSelectedArmy(u.unit);
                    }}
                    title={
                      u.unit.replace(/_/g, " ")
                      + (isRecruiting ? "\nCurrently being recruited" : "")
                      + (upgradeOnly
                        ? "\n" + (u.upgradeHint || "Needs building upgrade")
                        : "")
                      + (canAddToArmy ? "\n[dev] click → add to selected army" : "")
                    } style={{
                    position: "relative",
                    padding: 2,
                    background: isRecruiting ? "rgba(60,200,80,0.22)" : ((linkedFromBuilding || linkedFromHr) ? "rgba(220,166,74,0.22)" : "rgba(0,0,0,0.35)"),
                    borderRadius: 3,
                    minWidth: 0,
                    outline: isRecruiting
                      ? "2px solid #5ed87a"
                      : (linkedFromBuilding || linkedFromHr || isHoveredHere)
                        ? "2px solid #dca64a"
                        : (upgradeOnly ? "1px dashed rgba(255,255,255,0.18)" : "none"),
                    outlineOffset: -1,
                    opacity: upgradeOnly ? 0.45 : 1,
                    filter: upgradeOnly ? "grayscale(0.4)" : "none",
                    transition: "background 150ms var(--ease-mac-out), opacity 150ms var(--ease-mac-out), filter 150ms var(--ease-mac-out)",
                    cursor: canAddToArmy ? "copy" : "default",
                  }}>
                    {u.icon ? (
                      <img src={u.icon} alt={u.unit}
                        style={{ width: "100%", aspectRatio: "164 / 224", objectFit: "cover", display: "block", borderRadius: 2 }}
                        onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    ) : (
                      <div style={{ width: "100%", aspectRatio: "164 / 224", background: "rgba(255,255,255,0.06)", borderRadius: 2 }} />
                    )}
                    {isRecruiting && (
                      <div style={{
                        position: "absolute", top: 2, right: 2,
                        background: "rgba(60,200,80,0.85)", color: "#0b1b0e",
                        fontSize: "0.55rem", fontWeight: 700,
                        padding: "1px 3px", borderRadius: 2, lineHeight: 1,
                      }}>REC</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <span style={{ color: "#bbb", fontStyle: "italic", fontSize: "0.75rem" }}>Nothing recruitable</span>
          );
        })()}
        </div>
      </div>
      </Movable>

      {/* Garrison — Movable widget */}
      <Movable id="region.garrison" title="Garrison" designMode={designMode} colBox={colBox}
        defaultPct={{ x: 0.7857, y: 0.5086, w: 0.2090, h: 0.1340 }}>
      <div className={panelInnerClass} style={panelInner}>
        <div style={widgetHeader}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#8cf",
            display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span>Garrison:</span>
            {hoveredUnit && <span style={{ fontWeight: 400, fontSize: "0.7rem", color: "#dca64a" }}>{hoverReadout(hoveredUnit)}</span>}
          </div>
        </div>
        <div style={widgetBody}>
        {garrisonCommander && (
          <div style={{ fontSize: "0.68rem", color: "#ddd", marginBottom: 2 }}>
            {garrisonCommander.character}{garrisonCommander.faction ? ` — ${factionLabel(garrisonCommander.faction)}` : ""}
            {garrisonCommander.bodyguardRegion && (
              <span style={{ color: "#aaa", marginLeft: 6 }}>
                (bodyguard currently at {garrisonCommander.bodyguardRegion})
              </span>
            )}
          </div>
        )}
        {garrison && garrison.length > 0 ? (
          (() => {
            // 0.9.648: army-unit-edit selection. Dev-mode click on a garrison
            // unit card → selects THIS army (faction + region). Selected army
            // gets a yellow ring and per-unit × overlay to remove; subsequent
            // Recruitable clicks append to it.
            // 0.9.651: when the garrison is backed by a named character's
            // bodyguard army (e.g. Pisae's units sit inside Appius's
            // `army {}` block in descr_strat, NOT in a `garrisoned_army`
            // block), the region-only locator can't find anything to
            // write → IPC returns "garrison block not found". Surface
            // the commander's first name in the locator so the IPC can
            // resolve via that character's army block too.
            const commanderName = (garrisonCommander && garrisonCommander.character)
              || (garrison.find(u => u && u.commanderName) || {}).commanderName
              || null;
            // 0.9.659: prefer the FULL name in the locator (e.g. "Servius
            // Fulvius_Flaccus" not just "Servius") so the IPC can
            // disambiguate when the faction has multiple characters sharing
            // a first name (RIS romans_julii has 2 Servius / 3 Manius /…).
            // garrisonCommander.character from a live save is typically
            // full; the non-live unit-card commanderName is firstName only,
            // and the IPC falls back to byCoord / ;Region when that is
            // ambiguous.
            const commanderFirst = commanderName || null;
            // 0.9.653: use the SETTLEMENT'S actual owner (from save / descr_strat
            // ownership map) for the locator faction — NOT `info.faction`, which
            // for the rebel-mapping case is `italics`/`slave`/whatever
            // descr_regions assigns as the fallback culture (the Pisae IPC log
            // showed `wantFac="italics"` because info.faction was the rebel
            // faction, while Appius's actual character record lives under
            // romans_julii). Fall back to garrisonCommander.faction → r.faction
            // so we always have something.
            const ownerFaction = ownerFactionId
              || (garrisonCommander && garrisonCommander.faction)
              || (info && info.faction)
              || null;
            const garrisonArmyDesc = {
              faction: ownerFaction,
              locator: {
                region: (info && info.region) || null,
                ...(commanderFirst ? { character: commanderFirst } : {}),
              },
              units: garrison,
              label: `${(info && (info.city || info.name || info.region)) || "settlement"} garrison${commanderFirst ? ` (${commanderFirst})` : ""}`,
            };
            const garrisonKey = armyKeyOf ? armyKeyOf(garrisonArmyDesc.faction, garrisonArmyDesc.locator) : null;
            const isGarrisonSelected = devMode && garrisonKey && garrisonKey === selectedArmyKey;
            return (
          <div style={{
            display: "grid",
            // Cards capped at 32 px wide so they stay compact (10×2 = 20
            // slots max in any settlement). `minmax(0, 32px)` lets cards
            // shrink if the widget is narrow but never balloon past 32 px
            // when the widget is wide — restores the pre-0.9.362 size.
            gridTemplateColumns: "repeat(10, minmax(0, 32px))",
            gridAutoRows: "min-content",
            gap: 2,
            justifyContent: "start",
            alignContent: "start",
            // 0.9.648: highlight box when this army is the selected edit target.
            outline: isGarrisonSelected ? "2px solid #facc15" : "none",
            outlineOffset: 2,
            borderRadius: 3,
          }}>
            {(() => {
              // 0.9.442: generals first. Any unit that will swap to a face
              // card (has commanderUuid in live mode, or commanderName in
              // non-live) goes to the front so multi-general armies show
              // the portraits side-by-side instead of bookending the row.
              // Stable sort preserves relative order of other units.
              const sorted = garrison.slice().map((u, idx) => ({ u, idx }));
              sorted.sort((a, b) => {
                const aGen = (a.u.commanderUuid || a.u.commanderName) ? 1 : 0;
                const bGen = (b.u.commanderUuid || b.u.commanderName) ? 1 : 0;
                if (aGen !== bGen) return bGen - aGen;
                return a.idx - b.idx;
              });
              return sorted.map(({ u }, i) => {
              const pct = u.max && u.max > 0 ? Math.max(0, Math.min(1, u.soldiers / u.max)) : null;
              // RTW chevron count = exp - 1 (descr_strat exp 1 → 0 chevrons,
              // exp 2 → 1 bronze, etc.). The first visible chevron appears
              // at exp 2 in-game.
              // Chevron level = exp value directly. exp 0 → no chevron,
              // exp 1 → 1 bronze, exp 2 → 2 bronze, exp 3 → 3 bronze,
              // exp 4 → 1 silver … exp 9 → 3 gold.
              const chevrons = u.xp ?? u.exp ?? 0;
              const armour = u.armour || 0;
              const weapon = u.weapon || 0;
              // 0.9.493: one-shot log per unit so we can verify in the
              // log file that the upgrade values are flowing to the
              // renderer. If this fires "weapon=1" but the user sees no
              // sword icon, the issue is the SVG render — not data.
              if (typeof window !== "undefined" && (chevrons || armour || weapon)) {
                window.__unitUpgradeLogged ||= new Set();
                const k = `${u.unit}|${chevrons}|${armour}|${weapon}|${u.commanderName || ""}`;
                if (!window.__unitUpgradeLogged.has(k)) {
                  window.__unitUpgradeLogged.add(k);
                  console.log(`[unit-upgrade] ${u.unit} → xp=${chevrons} armour=${armour} weapon=${weapon}${u.commanderName ? " cmd=" + u.commanderName : ""}`);
                }
              }
              const tooltipParts = [u.unit.replace(/_/g, " ")];
              if (u.soldiers != null) tooltipParts.push(`${u.soldiers}${u.max != null ? `/${u.max}` : ""}`);
              if (chevrons > 0) {
                const tier = chevrons >= 7 ? "gold" : chevrons >= 4 ? "silver" : "bronze";
                tooltipParts.push(`${chevronCount(chevrons)} ${tier} chevron${chevronCount(chevrons) === 1 ? "" : "s"}`);
              }
              if (armour > 0) {
                const tier = armour >= 3 ? "gold" : armour >= 2 ? "silver" : "bronze";
                tooltipParts.push(`armour +${armour} (${tier})`);
              }
              if (weapon > 0) {
                const tier = weapon >= 3 ? "gold" : weapon >= 2 ? "silver" : "bronze";
                tooltipParts.push(`weapon +${weapon} (${tier})`);
              }
              const tooltip = tooltipParts.join(" — ");
              return (
                <div key={i}
                  onMouseEnter={() => setHoveredUnit(u)}
                  onMouseLeave={() => setHoveredUnit((cur) => cur === u ? null : cur)}
                  onContextMenu={(e) => { if (onShowInfo) { e.preventDefault(); onShowInfo({ type: "unit", faction: u.faction, name: u.unit, label: u.unit.replace(/_/g, " ") }); } }}
                  onClick={(e) => {
                    // 0.9.649: select this garrison as the edit target on click.
                    // Removal is now a × button (rendered below) so plain click
                    // is unambiguous.
                    if (!devMode || !onSelectArmy) return;
                    e.preventDefault();
                    onSelectArmy(garrisonArmyDesc);
                  }}
                  title={devMode ? `${tooltip}\n[dev] click → select army for editing (× to remove)` : tooltip} style={{
                  position: "relative", padding: 1,
                  background: "rgba(0,0,0,0.35)", borderRadius: 2,
                  minWidth: 0,
                  cursor: devMode ? "pointer" : "default",
                  outline: isGarrisonSelected ? "1px solid rgba(250,204,21,0.55)" : "none",
                }}>
                  {isGarrisonSelected && onRemoveUnitFromSelectedArmy && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const origIdx = garrison.indexOf(u);
                        if (origIdx >= 0) onRemoveUnitFromSelectedArmy(origIdx);
                      }}
                      title="Remove this unit"
                      style={{
                        position: "absolute", top: -4, right: -4, zIndex: 5,
                        width: 13, height: 13, padding: 0, lineHeight: 1,
                        background: "rgba(248,113,113,0.95)", color: "#fff",
                        border: "1px solid rgba(0,0,0,0.4)", borderRadius: "50%",
                        cursor: "pointer", fontSize: "10px", fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >×</button>
                  )}
                  {(() => {
                    // 0.9.410+ swap: same general-face-card swap as field-army
                    // path, applied to garrison bodyguard units.
                    let info = u.commanderUuid && commanderInfo ? commanderInfo.get(u.commanderUuid) : null;
                    // 0.9.429: non-live fallback via commanderName + statsCache.
                    if (!info && u.commanderName && statsCache) {
                      const fn = u.commanderName.toLowerCase();
                      const fac = (u.commanderFaction || "").toLowerCase();
                      const cached = statsCache[`${fn}||${fac}`] || statsCache[`${fn}||`] || null;
                      if (cached) {
                        info = {
                          firstName: u.commanderName,
                          // 0.9.505: surface cached lastName so epithet
                          // suffixes like "the Elder" / "the Wallbreaker"
                          // appear under the bodyguard portrait.
                          lastName: cached.lastName || null,
                          // 0.9.537: the LIVE garrison unit's faction wins over
                          // the cache entry's faction. The statsCache lookup can
                          // fall back to the faction-agnostic `name||` key, whose
                          // stored faction may belong to a same-named character
                          // in a DIFFERENT faction (e.g. a seleucid Demophanes
                          // was being shown as "ptolemaic"). For cross-culture
                          // name collisions that also pulled the wrong portrait
                          // pool. u.commanderFaction is authoritative for who's
                          // actually garrisoned here.
                          faction: u.commanderFaction || cached.faction || null,
                          age: typeof cached.age === "number" ? cached.age : null,
                          // 0.9.505: use cached.portrait. The 0.9.460
                          // workaround forced this to null because v1's
                          // c.portraits[0] occasionally cross-contaminated
                          // (Demetrios III case). With main.js's 0.9.504
                          // re-enable of v1 portraits + the existing
                          // captain-banner filter, this path is the only
                          // way for save-cracked characters like Achaios
                          // (who v2 misses, see characterParserV2 missing
                          // type=3 signature for some records) to get their
                          // engine-assigned portrait through to the
                          // garrison/army cards.
                          savePath: cached.portrait || null,
                        };
                      }
                    }
                    // 0.9.490: last-ditch fallback via descr_strat characters.
                    // Some named generals (e.g. Achaios in Sardis) aren't in
                    // the save-derived statsCache — the save's stats table
                    // tracks generals who've earned stats, but a turn-0 NPC
                    // general with all-zero stats can be missing. The
                    // descr_strat parse (in `characters`) has every starting
                    // character regardless, so match by firstName + faction
                    // and synthesize a minimal info object so the portrait
                    // swap still runs.
                    if (!info && u.commanderName && Array.isArray(characters)) {
                      const fn = u.commanderName.toLowerCase();
                      const fac = (u.commanderFaction || "").toLowerCase();
                      const ds = characters.find((c) =>
                        c && typeof c.firstName === "string" &&
                        c.firstName.toLowerCase() === fn &&
                        (!fac || !c.faction || c.faction.toLowerCase() === fac)
                      );
                      if (ds) {
                        info = {
                          firstName: ds.firstName,
                          lastName: ds.lastName || null,
                          faction: ds.faction || u.commanderFaction || null,
                          age: typeof ds.age === "number" ? ds.age : null,
                          savePath: null,
                        };
                        // 0.9.526: dedup this log. It was unguarded and fired
                        // once per render per garrison unit — a multi-unit
                        // stack led by one descr_strat-fallback commander
                        // (e.g. Zamir's 30-unit Minaean garrison) spammed the
                        // same line 30+ times every frame. Throttle per
                        // commander name like the sibling logs below.
                        if (typeof window !== "undefined") {
                          window.__bgFallbackLogged ||= new Set();
                          if (!window.__bgFallbackLogged.has(u.commanderName)) {
                            window.__bgFallbackLogged.add(u.commanderName);
                            console.log(`[bodyguard-swap garr] descr_strat fallback hit for "${u.commanderName}" — using starting character data (faction="${info.faction}", age=${info.age})`);
                          }
                        }
                      }
                    }
                    const culture = info && info.faction && factionCultures
                      ? (factionCultures[String(info.faction).toLowerCase()] || factionCultures[info.faction])
                      : null;
                    if (typeof window !== "undefined" && (u.commanderUuid || u.commanderName)) {
                      window.__bgGarrisonLogged ||= new Set();
                      const k = u.commanderUuid ? u.commanderUuid.toString(16) : `name:${u.commanderName}`;
                      if (!window.__bgGarrisonLogged.has(k)) {
                        window.__bgGarrisonLogged.add(k);
                        if (!info) {
                          console.log(`[bodyguard-swap garr] no info for ${k}. unit="${u.unit}" cmdMapSize=${commanderInfo?.size ?? 0} cacheSize=${statsCache ? Object.keys(statsCache).length : 0}`);
                        } else {
                          console.log(`[bodyguard-swap garr] ${k} → ${info.firstName} faction="${info.faction}" savePath="${info.savePath || "(none)"}" cultureLookup="${culture || "(missing)"}"`);
                        }
                      }
                    }
                    const imgStyle = { width: "100%", aspectRatio: "164 / 224", objectFit: "cover", display: "block", borderRadius: 1 };
                    const fallback = u.icon ? (
                      <img src={u.icon} alt={u.unit} style={imgStyle}
                        onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    ) : (
                      <div style={{ width: "100%", aspectRatio: "164 / 224", background: "rgba(255,255,255,0.06)", borderRadius: 1 }} />
                    );
                    if (info && modDataDir && (info.savePath || info.firstName)) {
                      const ctx = {
                        name: info.firstName || "",
                        lastName: info.lastName || "",
                        faction: info.faction || "",
                        age: info.age != null ? Number(info.age) : null,
                        savePath: info.savePath || undefined,
                      };
                      return <CommanderPortraitImg charContext={ctx} culture={culture || info.faction} modDataDir={modDataDir} fallback={fallback} style={imgStyle} />;
                    }
                    return fallback;
                  })()}
                  {pct != null && (
                    <div style={{ width: "100%", height: 3, background: "rgba(0,0,0,0.6)", marginTop: 1, borderRadius: 1, overflow: "hidden" }}>
                      <div style={{
                        width: `${pct * 100}%`, height: "100%",
                        background: pct > 0.66 ? "#6c6" : pct > 0.33 ? "#fa4" : "#f66",
                      }} />
                    </div>
                  )}
                  {typeof u.soldiers === "number" && (
                    <div style={{
                      position: "absolute", bottom: 4, left: 1, right: 1,
                      textAlign: "center", color: "#fff", fontSize: "0.55rem",
                      lineHeight: 1, fontVariantNumeric: "tabular-nums",
                      textShadow: "0 0 3px #000, 0 0 2px #000",
                      pointerEvents: "none",
                    }}>{u.soldiers}</div>
                  )}
                  {chevrons > 0 && (
                    <div style={{
                      position: "absolute", top: 1, left: 1,
                      pointerEvents: "none",
                      filter: "drop-shadow(0 0 1px rgba(0,0,0,0.95)) drop-shadow(0 0 1px rgba(0,0,0,0.95))",
                    }}>
                      <ChevronStack color={chevronTier(chevrons)} count={chevronCount(chevrons)} />
                    </div>
                  )}
                  {(armour > 0 || weapon > 0) && (
                    <div style={{
                      position: "absolute", bottom: 1, left: 1,
                      display: "flex", flexDirection: "row", gap: 1,
                      pointerEvents: "none",
                      // 0.9.498: black drop-shadow outline so the bronze/
                      // silver/gold icons read clearly against any unit-
                      // card background. Same approach as ChevronStack.
                      filter: "drop-shadow(0 0 1px rgba(0,0,0,0.95)) drop-shadow(0 0 1px rgba(0,0,0,0.95))",
                    }}>
                      {armour > 0 && <ShieldIcon color={upgradeTier(armour)} />}
                      {weapon > 0 && <SwordIcon color={upgradeTier(weapon)} />}
                    </div>
                  )}
                </div>
              );
              });
            })()}
            {/* Fill out to 20 slots so the 10×2 grid stays a stable shape
                as garrison size changes. Empty cells render as faint
                dashed placeholders. */}
            {Array.from({ length: Math.max(0, 20 - garrison.length) }).map((_, i) => (
              <div key={`empty-${i}`} style={{
                width: "100%", height: "100%",
                border: "1px dashed rgba(128,128,128,0.25)",
                borderRadius: 3,
                boxSizing: "border-box",
              }} />
            ))}
          </div>
            );
          })()
        ) : (
          devMode && info && info.faction && info.region ? (
            // 0.9.648: empty garrison — still let the user select it as the
            // edit target so they can add units from Recruitable to it.
            (() => {
              const emptyDesc = { faction: info.faction, locator: { region: info.region }, units: [], label: `${info.city || info.name || info.region} garrison` };
              const emptyKey = armyKeyOf ? armyKeyOf(emptyDesc.faction, emptyDesc.locator) : null;
              const isSel = emptyKey && emptyKey === selectedArmyKey;
              return (
                <span
                  onClick={() => onSelectArmy && onSelectArmy(emptyDesc)}
                  title="Click to select this empty garrison as the army edit target — Recruitable clicks will add units to it"
                  style={{ color: isSel ? "#facc15" : "#bbb", fontStyle: "italic", fontSize: "0.75rem", cursor: "pointer", outline: isSel ? "1px solid rgba(250,204,21,0.55)" : "none", padding: "1px 4px", borderRadius: 3 }}
                >No units stationed{isSel ? " · selected — add from Recruitable below" : " (dev: click to make editable)"}</span>
              );
            })()
          ) : (
            <span style={{ color: "#bbb", fontStyle: "italic", fontSize: "0.75rem" }}>
              No units stationed
            </span>
          )
        )}
        </div>
      </div>
      </Movable>

      {/* Field armies — Movable widget (split from Garrison in 0.9.348) */}
      <Movable id="region.fieldArmies" title="Field armies" designMode={designMode} colBox={colBox}
        defaultPct={{ x: 0.7857, y: 0.6509, w: 0.2090, h: 0.3441 }}>
      <div className={panelInnerClass} style={panelInner}>
        <div style={widgetHeader}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#fc6" }}>Field armies:</div>
        </div>
        <div style={widgetBody}>
        {(() => {
          // Group armies by faction so the user can see at a glance who
          // owns each foreign stack. Multiple Roman armies passing through
          // collapse under one "Romans:" header instead of repeating the
          // faction tag on every line.
          const groupByFaction = (list) => {
            const groups = new Map();
            for (const a of list) {
              const fac = a.faction || "";
              if (!groups.has(fac)) groups.set(fac, []);
              groups.get(fac).push(a);
            }
            return Array.from(groups.entries());
          };
          const renderArmyList = (list) => (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {groupByFaction(list).map(([fac, armies], gi) => (
                <div key={gi}>
                  {fac && (
                    <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#cfa", marginBottom: 4 }}>
                      {factionLabel(fac)}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {armies.map((a, ai) => {
                // 0.9.648: field-army edit selection. Coord locator → keys
                // pendingArmyUnits the same way main.js's update-army-units
                // IPC matches by (x, y).
                const fieldDesc = {
                  faction: a.faction || fac,
                  locator: { x: a.x, y: a.y },
                  units: a.units || [],
                  label: a.character || (fac ? factionLabel(fac) + " army" : "Army"),
                };
                const fieldKey = (devMode && armyKeyOf && a.x != null && a.y != null)
                  ? armyKeyOf(fieldDesc.faction, fieldDesc.locator) : null;
                const isFieldSelected = devMode && fieldKey && fieldKey === selectedArmyKey;
                return (
                <div key={ai}>
                  <div
                    onClick={(e) => { if (devMode && onSelectArmy && a.x != null && a.y != null) { e.preventDefault(); onSelectArmy(fieldDesc); } }}
                    title={devMode && a.x != null && a.y != null ? "[dev] click → select this army to edit · click recruitable below to add units" : undefined}
                    style={{
                      fontSize: "0.68rem", color: isFieldSelected ? "#facc15" : "#ddd", marginBottom: 2,
                      cursor: devMode && a.x != null && a.y != null ? "pointer" : "default",
                      outline: isFieldSelected ? "1px solid rgba(250,204,21,0.55)" : "none",
                      padding: "1px 4px", borderRadius: 3, display: "inline-block",
                    }}>
                    {a.character || (fac ? factionLabel(fac) + " army" : "Army")}{isFieldSelected ? " · selected" : ""}
                  </div>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(10, 1fr)",
                    gap: 2,
                    justifyContent: "start",
                    outline: isFieldSelected ? "2px solid #facc15" : "none",
                    outlineOffset: 2,
                    borderRadius: 3,
                  }}>
                    {(() => {
                      // 0.9.442: generals first (same as garrison).
                      const sortedUnits = a.units.slice().map((u, idx) => ({ u, idx }));
                      sortedUnits.sort((x, y) => {
                        const xGen = (x.u.commanderUuid || x.u.commanderName) ? 1 : 0;
                        const yGen = (y.u.commanderUuid || y.u.commanderName) ? 1 : 0;
                        if (xGen !== yGen) return yGen - xGen;
                        return x.idx - y.idx;
                      });
                      return sortedUnits.map(({ u }, ui) => {
                      const pct = u.max && u.max > 0 ? Math.max(0, Math.min(1, u.soldiers / u.max)) : null;
                      // Chevron level = exp value directly. exp 0 → no chevron,
              // exp 1 → 1 bronze, exp 2 → 2 bronze, exp 3 → 3 bronze,
              // exp 4 → 1 silver … exp 9 → 3 gold.
              const chevrons = u.xp ?? u.exp ?? 0;
                      const armour = u.armour || 0;
                      const weapon = u.weapon || 0;
                      const tooltipParts = [u.unit.replace(/_/g, " ")];
                      if (u.soldiers != null) tooltipParts.push(`${u.soldiers}${u.max != null ? `/${u.max}` : ""}`);
                      if (chevrons > 0) tooltipParts.push(`${chevrons} chevron${chevrons === 1 ? "" : "s"}`);
                      if (armour > 0) tooltipParts.push(`armour +${armour}`);
                      if (weapon > 0) tooltipParts.push(`weapon +${weapon}`);
                      const tooltip = tooltipParts.join(" — ");
                      return (
                      <div key={ui}
                        onMouseEnter={() => setHoveredUnit(u)}
                        onMouseLeave={() => setHoveredUnit((cur) => cur === u ? null : cur)}
                        onContextMenu={(e) => { if (onShowInfo) { e.preventDefault(); onShowInfo({ type: "unit", faction: u.faction, name: u.unit, label: u.unit.replace(/_/g, " ") }); } }}
                        title={tooltip} style={{
                        position: "relative", padding: 1,
                        background: "rgba(0,0,0,0.35)", borderRadius: 2,
                        outline: isFieldSelected ? "1px solid rgba(250,204,21,0.55)" : "none",
                      }}>
                        {isFieldSelected && onRemoveUnitFromSelectedArmy && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const origIdx = a.units.indexOf(u);
                              if (origIdx >= 0) onRemoveUnitFromSelectedArmy(origIdx);
                            }}
                            title="Remove this unit"
                            style={{
                              position: "absolute", top: -4, right: -4, zIndex: 5,
                              width: 13, height: 13, padding: 0, lineHeight: 1,
                              background: "rgba(248,113,113,0.95)", color: "#fff",
                              border: "1px solid rgba(0,0,0,0.4)", borderRadius: "50%",
                              cursor: "pointer", fontSize: "10px", fontWeight: 700,
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                          >×</button>
                        )}
                        {(() => {
                          // 0.9.410+ swap: bodyguard unit card → general's face card.
                          let info = u.commanderUuid && commanderInfo ? commanderInfo.get(u.commanderUuid) : null;
                          // 0.9.429: non-live fallback via commanderName +
                          // statsCache portrait. Lets the swap fire in
                          // (starting) mode using the calibrated portrait.
                          if (!info && u.commanderName && statsCache) {
                            const fn = u.commanderName.toLowerCase();
                            const fac = (u.commanderFaction || "").toLowerCase();
                            const cached = statsCache[`${fn}||${fac}`] || statsCache[`${fn}||`] || null;
                            if (cached) {
                              info = {
                                firstName: u.commanderName,
                                lastName: null,
                                faction: u.commanderFaction || null,
                                age: null,
                                savePath: cached.portrait || null,
                              };
                            }
                          }
                          // 0.9.490: descr_strat fallback for generals
                          // missing from statsCache (e.g. all-zero-stat
                          // turn-0 NPC generals like Achaios in Sardis).
                          if (!info && u.commanderName && Array.isArray(characters)) {
                            const fn = u.commanderName.toLowerCase();
                            const fac = (u.commanderFaction || "").toLowerCase();
                            const ds = characters.find((c) =>
                              c && typeof c.firstName === "string" &&
                              c.firstName.toLowerCase() === fn &&
                              (!fac || !c.faction || c.faction.toLowerCase() === fac)
                            );
                            if (ds) {
                              info = {
                                firstName: ds.firstName,
                                lastName: ds.lastName || null,
                                faction: ds.faction || u.commanderFaction || null,
                                age: typeof ds.age === "number" ? ds.age : null,
                                savePath: null,
                              };
                              // 0.9.526: dedup (see garrison path above).
                              if (typeof window !== "undefined") {
                                window.__bgFallbackLogged ||= new Set();
                                if (!window.__bgFallbackLogged.has(u.commanderName)) {
                                  window.__bgFallbackLogged.add(u.commanderName);
                                  console.log(`[bodyguard-swap field] descr_strat fallback hit for "${u.commanderName}" — using starting character data (faction="${info.faction}", age=${info.age})`);
                                }
                              }
                            }
                          }
                          const culture = info && info.faction && factionCultures
                            ? (factionCultures[String(info.faction).toLowerCase()] || factionCultures[info.faction])
                            : null;
                          if (typeof window !== "undefined" && (u.commanderUuid || u.commanderName)) {
                            window.__bgFieldLogged ||= new Set();
                            const k = u.commanderUuid ? u.commanderUuid.toString(16) : `name:${u.commanderName}`;
                            if (!window.__bgFieldLogged.has(k)) {
                              window.__bgFieldLogged.add(k);
                              if (!info) {
                                console.log(`[bodyguard-swap field] no info for ${k}. unit="${u.unit}" cmdMapSize=${commanderInfo?.size ?? 0} cacheSize=${statsCache ? Object.keys(statsCache).length : 0}`);
                              } else {
                                console.log(`[bodyguard-swap field] ${k} → ${info.firstName} faction="${info.faction}" savePath="${info.savePath || "(none)"}" cultureLookup="${culture || "(missing)"}"`);
                              }
                            }
                          }
                          const imgStyle = { width: "100%", aspectRatio: "164 / 224", objectFit: "cover", display: "block", borderRadius: 1 };
                          const fallback = u.icon ? (
                            <img src={u.icon} alt={u.unit} style={imgStyle}
                              onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          ) : (
                            <div style={{ width: "100%", aspectRatio: "164 / 224", background: "rgba(255,255,255,0.06)", borderRadius: 1 }} />
                          );
                          if (info && modDataDir && (info.savePath || info.firstName)) {
                            const ctx = {
                              name: info.firstName || "",
                              lastName: info.lastName || "",
                              faction: info.faction || "",
                              age: info.age != null ? Number(info.age) : null,
                              savePath: info.savePath || undefined,
                            };
                            return <CommanderPortraitImg charContext={ctx} culture={culture || info.faction} modDataDir={modDataDir} fallback={fallback} style={imgStyle} />;
                          }
                          return fallback;
                        })()}
                        {pct != null && (
                          <div style={{ width: "100%", height: 3, background: "rgba(0,0,0,0.6)", marginTop: 1, borderRadius: 1, overflow: "hidden" }}>
                            <div style={{
                              width: `${pct * 100}%`, height: "100%",
                              background: pct > 0.66 ? "#6c6" : pct > 0.33 ? "#fa4" : "#f66",
                            }} />
                          </div>
                        )}
                        {typeof u.soldiers === "number" && (
                          <div style={{
                            position: "absolute", bottom: 4, left: 1, right: 1,
                            textAlign: "center", color: "#fff", fontSize: "0.55rem",
                            lineHeight: 1, fontVariantNumeric: "tabular-nums",
                            textShadow: "0 0 3px #000, 0 0 2px #000",
                            pointerEvents: "none",
                          }}>{u.soldiers}</div>
                        )}
                        {chevrons > 0 && (
                          <div style={{
                            position: "absolute", top: 1, left: 1,
                            pointerEvents: "none",
                            filter: "drop-shadow(0 0 1px rgba(0,0,0,0.95)) drop-shadow(0 0 1px rgba(0,0,0,0.95))",
                          }}>
                            <ChevronStack color={chevronTier(chevrons)} count={chevronCount(chevrons)} />
                          </div>
                        )}
                        {(armour > 0 || weapon > 0) && (
                          <div style={{
                            position: "absolute", top: 1, left: 0, right: 0,
                            display: "flex", justifyContent: "center", gap: 2,
                            pointerEvents: "none",
                            filter: "drop-shadow(0 0 1px rgba(0,0,0,0.95)) drop-shadow(0 0 1px rgba(0,0,0,0.95))",
                          }}>
                            {armour > 0 && <ShieldIcon color={upgradeTier(armour)} />}
                            {weapon > 0 && <SwordIcon color={upgradeTier(weapon)} />}
                          </div>
                        )}
                      </div>
                      );
                      });
                    })()}
                  </div>
                </div>
              );
              })}
                  </div>
                </div>
              ))}
            </div>
          );
          const own = fieldArmies?.own || [];
          const others = fieldArmies?.others || [];
          return (
            <>
              {own.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, fontSize: "0.85rem", marginTop: 8, marginBottom: 3, color: "#fc6" }}>Region owners armies:</div>
                  {renderArmyList(own)}
                </>
              )}
              {others.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, fontSize: "0.85rem", marginTop: 8, marginBottom: 3, color: "#d88" }}>Other faction armies:</div>
                  {renderArmyList(others)}
                </>
              )}
              {own.length === 0 && others.length === 0 && (
                <span style={{ color: "#bbb", fontStyle: "italic", fontSize: "0.75rem" }}>None</span>
              )}
            </>
          );
        })()}
        </div>
      </div>
      </Movable>
    </>
  );
}