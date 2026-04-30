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

export default function RegionInfo({ info, modeExtra, devMode, buildings: buildingsProp, garrison, garrisonCommander, fieldArmies, factionDisplayNames, recruitable, queue, saveFile, characters, liveUnits, liveOwner, onShowInfo }) {
  // Faction ids (e.g. "parthia") → display name ("Persia" in Alexander
  // campaign). Parsed from the game's expanded_bi.txt.
  const factionLabel = (fid) => {
    if (!fid) return "";
    const dn = factionDisplayNames && factionDisplayNames[fid];
    return dn || String(fid).replace(/_/g, " ");
  };
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
          <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {region}
          </div>
        )}
        {row("City:", city)}
        {row("Faction:", liveOwner || faction)}
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
        {tagsList.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontWeight: 700, fontSize: "0.75rem", marginBottom: 2, color: "#cfc6b0" }}>Tags:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 4px", alignContent: "flex-start" }}>
              {tagsList.map((t, i) => (
                <span key={`${t}-${i}`} style={{
                  padding: "1px 5px", borderRadius: 4,
                  background: "rgba(255,255,255,0.08)",
                  fontSize: "0.7rem", whiteSpace: "nowrap",
                }}>{t}</span>
              ))}
            </div>
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
            gridTemplateColumns: "repeat(5, minmax(0, 52px))",
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
        <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 3, color: "#8cf" }}>
          Garrison:
        </div>
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
              const chevrons = Math.max(0, (u.xp || 0) - 1);
              const armour = u.armour || 0;
              const weapon = u.weapon || 0;
              const tooltipParts = [u.unit.replace(/_/g, " ")];
              if (u.soldiers != null) tooltipParts.push(`${u.soldiers}${u.max != null ? `/${u.max}` : ""}`);
              if (chevrons > 0) tooltipParts.push(`${chevrons} chevron${chevrons === 1 ? "" : "s"}`);
              if (armour > 0) tooltipParts.push(`armour +${armour}`);
              if (weapon > 0) tooltipParts.push(`weapon +${weapon}`);
              const tooltip = tooltipParts.join(" — ");
              return (
                <div key={i}
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
                      position: "absolute", top: 0, right: 1,
                      color: "#fc6", fontSize: "0.55rem", lineHeight: 0.8,
                      textShadow: "0 0 2px #000",
                      fontFamily: "monospace", letterSpacing: -1,
                    }}>
                      {/* RTW chevron: angular V \u2014 stacked when count > 1 */}
                      {"\u02C7".repeat(Math.min(chevrons, 3))}{chevrons > 3 ? "+" : ""}
                    </div>
                  )}
                  {(armour > 0 || weapon > 0) && (
                    <div style={{
                      position: "absolute", top: 0, left: 1,
                      display: "flex", flexDirection: "column", gap: 0,
                      fontSize: "0.55rem", lineHeight: 0.9,
                      textShadow: "0 0 2px #000",
                    }}>
                      {armour > 0 && <span style={{ color: "#9cf" }}>{"\u26E8".repeat(Math.min(armour, 3))}</span>}
                      {weapon > 0 && <span style={{ color: "#f96" }}>{"\u2694".repeat(Math.min(weapon, 3))}</span>}
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
                      const chevrons = Math.max(0, (u.xp || 0) - 1);
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
                            position: "absolute", top: 0, right: 1,
                            color: "#fc6", fontSize: "0.55rem", lineHeight: 0.8,
                            textShadow: "0 0 2px #000",
                            fontFamily: "monospace", letterSpacing: -1,
                          }}>
                            {"\u02C7".repeat(Math.min(chevrons, 3))}{chevrons > 3 ? "+" : ""}
                          </div>
                        )}
                        {(armour > 0 || weapon > 0) && (
                          <div style={{
                            position: "absolute", top: 0, left: 1,
                            display: "flex", flexDirection: "column", gap: 0,
                            fontSize: "0.55rem", lineHeight: 0.9,
                            textShadow: "0 0 2px #000",
                          }}>
                            {armour > 0 && <span style={{ color: "#9cf" }}>{"\u26E8".repeat(Math.min(armour, 3))}</span>}
                            {weapon > 0 && <span style={{ color: "#f96" }}>{"\u2694".repeat(Math.min(weapon, 3))}</span>}
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