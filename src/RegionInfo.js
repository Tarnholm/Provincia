import React, { useMemo } from "react";

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
  const pick = raw?.label || raw?.name || raw?.type || `Building ${idx + 1}`;
  const m = typeof pick === "string" ? pick.match(/\(([^)]*)\)\s*$/) : null;
  if (m && m[1]) return m[1].trim();
  return pick;
}

// Resolve icon paths; supports a single string or an array of candidates.
// Adds .png if missing extension, encodes '#', and prepends /construction/ for bare names.
function resolveIcon(icon) {
  const tryOne = (val) => {
    if (!val) return null;
    let out = String(val).trim();
    if (!out) return null;
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

export default function RegionInfo({ info, modeExtra, devMode, buildings: buildingsProp }) {
  const buildings = useMemo(() => buildingsProp || buildingsGetter(info) || [], [info, buildingsProp]);

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

  const buildingItems = buildings.map((b, idx) => {
    const label = labelFrom(b, idx);
    const icon =
      resolveIcon(b?.icon) ||
      resolveIcon(b?.image) ||
      resolveIcon(b?.imagePath) ||
      resolveIcon(b?.iconPath) ||
      resolveIcon(b?.img) ||
      null;
    return { key: `${label}-${idx}`, label, icon, type: b?.type || "", health: b?.health };
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
        gridTemplateColumns: "240px 220px 1fr", // info | tags | buildings
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
          <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {region}
          </div>
        )}
        {row("City:", city)}
        {row("Faction:", faction)}
        {row("Culture:", culture)}
        {devMode && row("RGB:", rgb)}
        {farm_level !== undefined && farm_level !== null && row("Farm Level:", farm_level)}
        {population_level !== undefined && population_level !== null && row("Population Level:", population_level)}
        {(() => {
          const ethData = parseEth(typeof ethnicities === 'string' ? ethnicities : (Array.isArray(ethnicities) ? ethnicities.join(' ') : ''));
          if (ethData.length === 0) return null;
          return (
            <div style={{ marginTop: 2, minHeight: 58 }}>
              <div style={{ display: "flex", height: 8, borderRadius: 3, overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)" }}>
                {ethData.map((e, i) => {
                  const col = getEthColor(e.name);
                  return (
                    <div key={i} title={`${e.name} ${e.pct}%`} style={{
                      width: `${e.pct}%`, background: `rgb(${col[0]},${col[1]},${col[2]})`,
                      minWidth: e.pct > 0 ? 2 : 0,
                    }} />
                  );
                })}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "1px 6px", marginTop: 2, fontSize: "0.65rem" }}>
                {ethData.map((e, i) => {
                  const col = getEthColor(e.name);
                  return (
                    <span key={i} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 2, background: `rgb(${col[0]},${col[1]},${col[2]})` }} />
                      {e.name.replace(/_/g, " ")} {e.pct}%
                    </span>
                  );
                })}
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

      {/* Middle: tags section, wraps into multiple rows */}
      <div
        style={{
          borderLeft: "1px solid #8882",
          paddingLeft: 6,
          boxSizing: "border-box",
          height: "100%",
          maxWidth: 280,
          overflow: "hidden",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 3 }}>Tags:</div>
        {tagsList.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "2px 4px",
              alignContent: "flex-start",
            }}
          >
            {tagsList.map((t, i) => (
              <span
                key={`${t}-${i}`}
                style={{
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: "rgba(255,255,255,0.08)",
                  fontSize: "0.75rem",
                  whiteSpace: "nowrap",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        ) : (
          <span style={{ color: "#bbb", fontStyle: "italic" }}>No tags</span>
        )}
      </div>

      {/* Right: buildings */}
      <div
        style={{
          borderLeft: "1px solid #8882",
          paddingLeft: 12,
          boxSizing: "border-box",
          minWidth: 0,
          height: "100%",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 3 }}>Buildings:</div>
        {buildingItems.length > 0 ? (
          <div
            style={{
              columnWidth: 110,
              columnGap: 4,
              columnFill: "auto",
              height: 130,
              overflow: "hidden",
            }}
          >
            {buildingItems.map((b) => (
              <div key={b.key} title={b.type ? `${b.type.replace(/_/g, " ")}: ${b.label}` : b.label} style={{
                display: "flex", alignItems: "center", gap: 4,
                background: "rgba(0,0,0,0.25)", borderRadius: 4,
                padding: "2px 5px 2px 2px", marginBottom: 2,
                breakInside: "avoid", WebkitColumnBreakInside: "avoid",
              }}>
                {b.icon && (
                  <img
                    src={b.icon}
                    alt={b.label}
                    style={{ width: 20, height: 20, objectFit: "contain", display: "block", flexShrink: 0 }}
                  />
                )}
                <span style={{ color: "#f4f4f4", fontSize: "0.72rem" }}>{b.label}</span>
                {b.health != null && b.health < 100 && (
                  <span style={{ color: b.health < 50 ? "#f66" : "#fa4", fontSize: "0.65rem", marginLeft: 2 }}>{b.health}%</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <span style={{ color: "#bbb", fontStyle: "italic" }}>No buildings</span>
        )}
      </div>
    </div>
  );
}