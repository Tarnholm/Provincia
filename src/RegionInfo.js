import React, { useEffect, useMemo, useRef, useState } from "react";
import FactionIcon from "./FactionIcon";
import { Movable } from "./Movable";

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
const ShieldIcon = ({ color, size = 8 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="M8 1 L14 3 L14 8 Q14 13 8 15 Q2 13 2 8 L2 3 Z" fill={color} />
  </svg>
);
const SwordIcon = ({ color, size = 8 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="M3 13 L11 5 L13 5 L13 3 L11 3 L3 11 Z" fill={color} />
    <path d="M2 12 L4 14 M5 11 L7 13" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
// SVG chevron — RTW-style angular V. Stack vertically with `count` copies in
// `color` (the tier colour). Text-glyph chevrons (ˇ, ^) were illegible at the
// 7-8px sizes the unit cards demand.
const ChevronStack = ({ color, count }) => (
  <svg width="6" height={Math.max(3, count * 3 + 1)} viewBox={`0 0 16 ${count * 7 + 2}`} style={{ display: "block" }}>
    {Array.from({ length: count }).map((_, i) => (
      <path
        key={i}
        d={`M2 ${i * 7 + 5} L8 ${i * 7 + 1} L14 ${i * 7 + 5}`}
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

export default function RegionInfo({ info, modeExtra, devMode, buildings: buildingsProp, garrison, garrisonCommander, fieldArmies, factionDisplayNames, recruitable, queue, saveFile, characters, liveUnits, liveOwner, onShowInfo, startingGarrison, settlementTier, resources, resourceImages, recruitGatedBy, homelandFactions, taxLevel, happiness, livePopulation, liveIncome, liveSize, modIconsDir, onFactionRightClick, recruitingNow, buildingQueue, designMode, infoColPct, topRowPct, buildRowPct, onSetInfoColPct, onSetTopRowPct, onSetBuildRowPct }) {
  // Faction ids (e.g. "parthia") → display name ("Persia" in Alexander
  // campaign). Parsed from the game's expanded_bi.txt.
  const factionLabel = (fid) => {
    if (!fid) return "";
    const dn = factionDisplayNames && factionDisplayNames[fid];
    return dn || String(fid).replace(/_/g, " ");
  };
  const buildings = useMemo(() => buildingsProp || buildingsGetter(info) || [], [info, buildingsProp]);
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
      <Movable id="region.info" title="Region info" designMode={designMode}
        defaultPct={{ x: 0.5720, y: 0.0080, w: 0.2102, h: 0.3290 }}>
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
          const colors = { low: "#7ed27e", normal: "#bbb", high: "#e8a030", very_high: "#e85050" };
          const label = taxLevel.replace(/_/g, " ");
          return (
            <div style={{ marginBottom: 2 }}
              title="Current tax rate from the live save (parsed via cracker invariant: byte at settlement_name_offset - 2269)">
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
          const summed = {};
          for (const r of resources) {
            const k = String(r.type || "").toLowerCase();
            if (!k) continue;
            summed[k] = (summed[k] || 0) + (r.amount || 1);
          }
          const list = Object.entries(summed).sort((a, b) => b[1] - a[1]);
          return (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontWeight: 700, fontSize: "0.75rem", marginBottom: 2, color: "#cfc6b0" }}>Resources:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 4px" }}>
                {list.map(([type, amount]) => (
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
                ))}
              </div>
            </div>
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
      <Movable id="region.characters" title="Characters" designMode={designMode}
        defaultPct={{ x: 0.5720, y: 0.3416, w: 0.2102, h: 0.1550 }}>
      <div className={panelInnerClass} style={panelInner}>
        <div style={widgetHeader}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#fd8" }}>
            Characters:
            {characters && characters.length > 0 && (
              <span
                title={characters[0]?._source === "starting"
                  ? "Starting roster from descr_strat — turn-1 traits, ancillaries, age. Load a save to switch to live values."
                  : (saveFile ? `As of: ${saveFile}` : "From save file")}
                style={{ fontSize: "0.65rem", color: "#a98", marginLeft: 6, fontWeight: 400, cursor: "help" }}>
                {characters[0]?._source === "starting" ? "(starting)" : "(live)"}
              </span>
            )}
          </div>
        </div>
        <div style={widgetBody}>
        {characters && characters.length > 0 ? (() => {
          return (
          <div style={{ fontSize: "0.72rem" }}>
            <div>
              {characters.map((c, i) => {
                const sym = c.isLeader ? "👑" : c.isHeir ? "★" : c.gender === "female" ? "♀" : "";
                const status = c.isDead ? " (dead)" : "";
                const fullName = `${c.firstName}${c.lastName ? " " + c.lastName.replace(/_/g, " ") : ""}`;
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
                    {/* Stats always shown after age — render ? for any
                        missing field rather than hiding the whole block,
                        so the layout doesn't shift between characters
                        with/without decoded stats. */}
                    <span style={{ color: "#9bb1c8", fontVariantNumeric: "tabular-nums", marginLeft: 6, fontSize: "0.66rem" }}
                      title={`Command ${c.command ?? "?"} · Influence ${c.influence ?? "?"} · Management ${c.management ?? "?"} · Loyalty ${c.loyalty ?? "?"} (save-cracker session 91)`}>
                      ⚔ {c.command ?? "?"}/{c.influence ?? "?"}/{c.management ?? "?"}/{c.loyalty ?? "?"}
                    </span>
                    {status && <span style={{ color: "#c66", marginLeft: 4 }}>{status}</span>}
                  </div>
                );
              })}
            </div>
          </div>
          );
        })() : (
          <span style={{ color: "#bbb", fontStyle: "italic", fontSize: "0.75rem" }}>No characters</span>
        )}
        </div>
      </div>
      </Movable>

      {/* Building queue — Movable widget extracted from buildings */}
      <Movable id="region.queue" title="Build queue" designMode={designMode}
        defaultPct={{ x: 0.8912, y: 0.3416, w: 0.1038, h: 0.1550 }}>
      <div className={panelInnerClass} style={panelInner}>
        <div style={{ padding: "8px 14px", overflow: "auto", height: "100%", boxSizing: "border-box" }}>
        {Array.isArray(buildingQueue) && buildingQueue.length > 0 ? (
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
            {buildingQueue.map((q, i) => (
              <span key={i} style={{ color: "#cde" }}>
                {i > 0 ? ", " : ""}chain #{q.chainId}
                {Number.isFinite(q.turns) && q.turns > 0 && q.turns < 1000
                  ? ` — ${q.turns} turn${q.turns === 1 ? "" : "s"}`
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

      {/* Unit queue — Movable widget. Lists units currently being
          recruited in this settlement (recruitingNow from save). */}
      <Movable id="region.unitQueue" title="Unit queue" designMode={designMode}
        defaultPct={{ x: 0.7848, y: 0.3416, w: 0.1038, h: 0.1550 }}>
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
      <Movable id="region.buildings" title="Buildings" designMode={designMode}
        defaultPct={{ x: 0.5720, y: 0.5012, w: 0.2102, h: 0.4938 }}>
      <div className={panelInnerClass} style={panelInner}>
        <div style={widgetHeader}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>Buildings:</div>
        </div>
        <div style={widgetBody}>
        {buildingItems.length > 0 ? (
          (() => {
            // 20-slot grid with a minimum card size of 60×80 — cards
            // reflow into more rows when the widget is narrow and the
            // container scrolls vertically once 20 cards no longer fit.
            // Prevents the cards from shrinking past readable.
            const padded = buildingItems.slice(0, 20);
            const emptyCount = Math.max(0, 20 - padded.length);
            return (
          <div
            ref={buildingsBoxRef}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))",
              gridAutoRows: "80px",
              gap: 4,
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              alignContent: "start",
            }}
          >
            {buildingItems.map((b) => {
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
              return (
              <div key={b.key}
                onMouseEnter={() => setHoveredChain(b.type)}
                onMouseLeave={() => setHoveredChain((cur) => cur === b.type ? null : cur)}
                onContextMenu={(e) => { if (onShowInfo) { e.preventDefault(); onShowInfo({ type: "building", name: b.level, chainName: b.type, culture: b.culture || null, label: b.label }); } }}
                title={b.type ? `${b.type.replace(/_/g, " ")}: ${b.label}${b.queued ? " (in construction)" : ""}` : b.label} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                background: linkedFromRecruit ? "rgba(220,166,74,0.22)" : "rgba(0,0,0,0.25)",
                borderRadius: 4,
                padding: "4px 3px",
                minWidth: 0,
                minHeight: 0,
                width: "100%", height: "100%",
                boxSizing: "border-box",
                overflow: "hidden",
                transition: "background 150ms var(--ease-mac-out), border-color 150ms var(--ease-mac-out)",
                border: b.queued
                  ? "2px solid #e89030"
                  : (linkedFromRecruit || isHoveredChain)
                    ? "2px solid #dca64a"
                    : "2px solid transparent",
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
                <span style={{ color: "#f4f4f4", fontSize: "0.7rem", textAlign: "center", lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", wordBreak: "break-word", hyphens: "auto", width: "100%" }}>
                  {b.tierRoman && <span style={{ color: "#dca64a", fontWeight: 700, marginRight: 4 }}>{b.tierRoman}</span>}
                  {b.label}
                </span>
              </div>
              );
            })}
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
        </div>
      </div>
      </Movable>

      {/* Recruitable — Movable widget */}
      <Movable id="region.recruit" title="Recruitable" designMode={designMode}
        defaultPct={{ x: 0.7848, y: 0.0080, w: 0.2102, h: 0.3290 }}>
      <div className={panelInnerClass} style={panelInner}>
        <div style={widgetHeader}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#9fc78a" }}>Recruitable:</div>
        </div>
        <div style={widgetBody}>
        {(() => {
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
                return (
                  <div key={i}
                    onMouseEnter={() => setHoveredRecruit(u.unit)}
                    onMouseLeave={() => setHoveredRecruit((cur) => cur === u.unit ? null : cur)}
                    onContextMenu={(e) => { if (onShowInfo) { e.preventDefault(); onShowInfo({ type: "unit", faction: u.faction, name: u.unit, label: u.unit.replace(/_/g, " ") }); } }}
                    title={
                      u.unit.replace(/_/g, " ")
                      + (isRecruiting ? "\nCurrently being recruited" : "")
                      + (upgradeOnly
                        ? "\n" + (u.upgradeHint || "Needs building upgrade")
                        : "")
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
      <Movable id="region.garrison" title="Garrison" designMode={designMode}
        defaultPct={{ x: 0.7848, y: 0.5012, w: 0.2102, h: 0.1900 }}>
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
          <div style={{
            display: "grid",
            // Settlements can hold at most 20 units (10×2). Reserve all
            // 20 slots so the grid keeps a stable shape; empty slots
            // render as faint dashed placeholders below the real units.
            gridTemplateColumns: "repeat(10, 1fr)",
            gridTemplateRows: "repeat(2, 1fr)",
            gap: 2,
            flex: 1,
            minHeight: 0,
          }}>
            {garrison.map((u, i) => {
              const pct = u.max && u.max > 0 ? Math.max(0, Math.min(1, u.soldiers / u.max)) : null;
              // RTW chevron count = exp - 1 (descr_strat exp 1 → 0 chevrons,
              // exp 2 → 1 bronze, etc.). The first visible chevron appears
              // at exp 2 in-game.
              // Chevron level = exp value directly. exp 0 → no chevron,
              // exp 1 → 1 bronze, exp 2 → 2 bronze, exp 3 → 3 bronze,
              // exp 4 → 1 silver … exp 9 → 3 gold.
              const chevrons = u.xp || 0;
              const armour = u.armour || 0;
              const weapon = u.weapon || 0;
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
                  title={tooltip} style={{
                  position: "relative", padding: 1,
                  background: "rgba(0,0,0,0.35)", borderRadius: 2,
                  minWidth: 0,
                }}>
                  {u.icon ? (
                    <img src={u.icon} alt={u.unit}
                      style={{ width: "100%", aspectRatio: "164 / 224", objectFit: "cover", display: "block", borderRadius: 1 }}
                      onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  ) : (
                    <div style={{ width: "100%", aspectRatio: "164 / 224", background: "rgba(255,255,255,0.06)", borderRadius: 1 }} />
                  )}
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
                    }}>
                      {armour > 0 && <ShieldIcon color={upgradeTier(armour)} />}
                      {weapon > 0 && <SwordIcon color={upgradeTier(weapon)} />}
                    </div>
                  )}
                </div>
              );
            })}
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
        ) : (
          <span style={{ color: "#bbb", fontStyle: "italic", fontSize: "0.75rem" }}>
            No units stationed
          </span>
        )}
        </div>
      </div>
      </Movable>

      {/* Field armies — Movable widget (split from Garrison in 0.9.348) */}
      <Movable id="region.fieldArmies" title="Field armies" designMode={designMode}
        defaultPct={{ x: 0.7848, y: 0.6958, w: 0.2102, h: 0.2992 }}>
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
              {armies.map((a, ai) => (
                <div key={ai}>
                  <div style={{ fontSize: "0.68rem", color: "#ddd", marginBottom: 2 }}>
                    {a.character || (fac ? factionLabel(fac) + " army" : "Army")}
                  </div>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(10, 1fr)",
                    gap: 2,
                    justifyContent: "start",
                  }}>
                    {a.units.map((u, ui) => {
                      const pct = u.max && u.max > 0 ? Math.max(0, Math.min(1, u.soldiers / u.max)) : null;
                      // Chevron level = exp value directly. exp 0 → no chevron,
              // exp 1 → 1 bronze, exp 2 → 2 bronze, exp 3 → 3 bronze,
              // exp 4 → 1 silver … exp 9 → 3 gold.
              const chevrons = u.xp || 0;
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
                      }}>
                        {u.icon ? (
                          <img src={u.icon} alt={u.unit}
                            style={{ width: "100%", aspectRatio: "164 / 224", objectFit: "cover", display: "block", borderRadius: 1 }}
                            onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        ) : (
                          <div style={{ width: "100%", aspectRatio: "164 / 224", background: "rgba(255,255,255,0.06)", borderRadius: 1 }} />
                        )}
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
                          }}>
                            {armour > 0 && <ShieldIcon color={upgradeTier(armour)} />}
                            {weapon > 0 && <SwordIcon color={upgradeTier(weapon)} />}
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </div>
              ))}
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