import React, { useMemo, useState } from "react";

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
  if (/^Farm\d+$/.test(t)) return "Fertility";
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

export default function RegionInfo({ info, modeExtra, devMode, buildings: buildingsProp, garrison, garrisonCommander, fieldArmies, factionDisplayNames, recruitable, queue, saveFile, characters, liveUnits, liveOwner, onShowInfo, startingGarrison, settlementTier, resources, resourceImages }) {
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

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        minHeight: "100%",
        display: "grid",
        // info+tags | buildings (fixed 10×82 + 9×4 gap = 856px) | recruitable | garrison+field armies
        gridTemplateColumns: "240px 860px minmax(260px, 1fr) minmax(280px, 1fr)",
        gap: 6,
        paddingBottom: 4,
        color: "#f7f7f7",
        fontSize: "0.82rem",
        lineHeight: 1.25,
        boxSizing: "border-box",
        height: "100%",
      }}
    >
      {/* Left: region details */}
      <div style={{ paddingRight: 6, minWidth: 200, overflow: "hidden" }}>
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
            style={{ marginBottom: 2, cursor: "copy", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <strong>Settlement:</strong> {city}
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
        {row("Culture:", culture)}
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
                    {groups[cat].map((t, i) => (
                      <span key={`${t}-${i}`} style={{
                        padding: "1px 5px", borderRadius: 4,
                        background: CATEGORY_COLOURS[cat] || "rgba(255,255,255,0.08)",
                        fontSize: "0.7rem", whiteSpace: "nowrap",
                      }}>{t}</span>
                    ))}
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

      {/* Right: buildings + garrison */}
      <div
        style={{
          borderLeft: "1px solid #8882",
          paddingLeft: 12,
          boxSizing: "border-box",
          minWidth: 0,
          height: "100%",
        }}
      >
        {characters && characters.length > 0 && (
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 3, color: "#fd8" }}>
              Characters:
              <span
                title={saveFile ? `As of: ${saveFile}` : "From save file"}
                style={{ fontSize: "0.65rem", color: "#a98", marginLeft: 6, fontWeight: 400, cursor: "help" }}>(live)</span>
            </div>
            <div style={{ maxHeight: 80, overflowY: "auto", fontSize: "0.72rem" }}>
              {characters.map((c, i) => {
                const sym = c.isLeader ? "👑" : c.isHeir ? "★" : c.gender === "female" ? "♀" : "";
                const status = c.isDead ? " (dead)" : "";
                return (
                  <div key={i} style={{ display: "flex", gap: 6, padding: "1px 0" }}>
                    <span style={{ flex: 1, color: "#eee", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {sym ? sym + " " : ""}{c.firstName}{c.lastName ? " " + c.lastName.replace(/_/g, " ") : ""}{status}
                    </span>
                    <span style={{ color: "#ccc", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>age {c.age}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 3 }}>Buildings:</div>
        {buildingItems.length > 0 ? (
          (() => {
            // Fixed 10×2 = 20-slot grid. The column always reserves space
            // for a full stack so the layout doesn't shift as settlements
            // fill up or get compared side-by-side.
            return (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(10, 82px)",
              gridAutoRows: "min-content",
              gap: 4,
              justifyContent: "start",
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
              return (
              <div key={b.key}
                onContextMenu={(e) => { if (onShowInfo) { e.preventDefault(); onShowInfo({ type: "building", name: b.level, chainName: b.type, culture: b.culture || null, label: b.label }); } }}
                title={b.type ? `${b.type.replace(/_/g, " ")}: ${b.label}${b.queued ? " (in construction)" : ""}` : b.label} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                background: "rgba(0,0,0,0.25)", borderRadius: 4,
                padding: "4px 3px",
                minWidth: 0,
                border: b.queued ? "2px solid #e89030" : "2px solid transparent",
              }}>
                <div style={{ position: "relative", width: 60, height: 48, flexShrink: 0 }}>
                  {b.icon && (
                    <img
                      src={b.icon}
                      alt={b.label}
                      // Frame 60×48 keeps RTW's 156×124 aspect (≈1.26:1)
                      // while leaving more vertical room in the 82px card
                      // for a 4-line label (handles "Region Information",
                      // "Governor's Palace", etc. without ellipsis).
                      style={{ width: 60, height: 48, objectFit: "contain", display: "block" }}
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
          </div>
            );
          })()
        ) : (
          <span style={{ color: "#bbb", fontStyle: "italic" }}>No buildings</span>
        )}
      </div>

      {/* Fourth column: recruitable units in this settlement (from EDB) */}
      <div
        style={{
          borderLeft: "1px solid #8882",
          paddingLeft: 12,
          boxSizing: "border-box",
          minWidth: 0,
          height: "100%",
          overflowY: "auto",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 3, color: "#9fc78a" }}>Recruitable:</div>
        {recruitable && recruitable.length > 0 ? (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, minmax(0, 52px))",
            gridAutoRows: "min-content",
            gap: 3,
            justifyContent: "start",
          }}>
            {recruitable.map((u, i) => (
              <div key={i}
                onContextMenu={(e) => { if (onShowInfo) { e.preventDefault(); onShowInfo({ type: "unit", faction: u.faction, name: u.unit, label: u.unit.replace(/_/g, " ") }); } }}
                title={u.unit.replace(/_/g, " ")} style={{
                padding: 2, background: "rgba(0,0,0,0.35)", borderRadius: 3,
                minWidth: 0,
              }}>
                {u.icon ? (
                  <img src={u.icon} alt={u.unit}
                    style={{ width: "100%", aspectRatio: "164 / 224", objectFit: "cover", display: "block", borderRadius: 2 }}
                    onError={(e) => { e.currentTarget.style.display = "none"; }} />
                ) : (
                  <div style={{ width: "100%", aspectRatio: "164 / 224", background: "rgba(255,255,255,0.06)", borderRadius: 2 }} />
                )}
              </div>
            ))}
          </div>
        ) : (
          <span style={{ color: "#bbb", fontStyle: "italic", fontSize: "0.75rem" }}>Nothing recruitable</span>
        )}
      </div>

      {/* Fifth column: garrison + field armies for this region */}
      <div
        style={{
          borderLeft: "1px solid #8882",
          paddingLeft: 12,
          boxSizing: "border-box",
          minWidth: 0,
          height: "100%",
          overflowY: "auto",
        }}
      >
        {(() => {
          // Roster diff vs turn 0. Only show in live mode (when garrison
          // came from a save) — otherwise we'd be diffing the descr_strat
          // value against itself. Compares unit-name multisets and reports
          // net +N / -N.
          let diffBadge = null;
          if (startingGarrison && garrison) {
            const count = (arr, get) => {
              const m = new Map();
              for (const x of arr || []) {
                const n = get(x); if (!n) continue;
                m.set(n, (m.get(n) || 0) + 1);
              }
              return m;
            };
            const cur = count(garrison, u => u.unit);
            const start = count(startingGarrison, u => u.unit || u.name);
            let added = 0, removed = 0;
            const allKeys = new Set([...cur.keys(), ...start.keys()]);
            for (const k of allKeys) {
              const d = (cur.get(k) || 0) - (start.get(k) || 0);
              if (d > 0) added += d;
              else if (d < 0) removed += -d;
            }
            if (added > 0 || removed > 0) {
              diffBadge = (
                <span style={{ fontSize: "0.65rem", fontWeight: 600 }}>
                  {added > 0 && <span style={{ color: "#7c7", marginRight: 4 }}>+{added}</span>}
                  {removed > 0 && <span style={{ color: "#e77" }}>−{removed}</span>}
                  <span style={{ color: "#888", fontWeight: 400 }}> since turn 0</span>
                </span>
              );
            }
          }
          return (
            <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 3, color: "#8cf",
              display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span>Garrison: {diffBadge}</span>
              {hoveredUnit && <span style={{ fontWeight: 400, fontSize: "0.7rem", color: "#dca64a" }}>{hoverReadout(hoveredUnit)}</span>}
            </div>
          );
        })()}
        {garrisonCommander && (
          <div style={{ fontSize: "0.68rem", color: "#ddd", marginBottom: 2 }}>
            {garrisonCommander.character}{garrisonCommander.faction ? ` — ${factionLabel(garrisonCommander.faction)}` : ""}
          </div>
        )}
        {garrison && garrison.length > 0 ? (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(10, minmax(0, 28px))",
            gridAutoRows: "min-content",
            gap: 2,
            justifyContent: "start",
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
          </div>
        ) : (
          <span style={{ color: "#bbb", fontStyle: "italic", fontSize: "0.75rem" }}>
            No units stationed
          </span>
        )}
        {(() => {
          const renderArmyList = (list) => (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {list.map((a, ai) => (
                <div key={ai}>
                  <div style={{ fontSize: "0.68rem", color: "#ddd", marginBottom: 2 }}>
                    {a.character}{a.faction ? ` — ${factionLabel(a.faction)}` : ""}
                  </div>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(10, minmax(0, 28px))",
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
                <>
                  <div style={{ fontWeight: 700, fontSize: "0.85rem", marginTop: 8, marginBottom: 3, color: "#fc6" }}>Field armies:</div>
                  <span style={{ color: "#bbb", fontStyle: "italic", fontSize: "0.75rem" }}>None</span>
                </>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}