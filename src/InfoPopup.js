// src/InfoPopup.js
//
// Right-click popup showing the large RTW info tga for a unit or a
// building. Units have dedicated `unit_info/<faction>/<unit>_info.tga`
// panels (~320×512). Buildings reuse the `_constructed` banner (~361×163).
//
// Stats (soldier count, armour, attack, etc.) are TODO — this first pass
// just blows up the image so players can read what the game actually shows
// in-game without having to alt-tab.

"use strict";

import { Fragment, useEffect, useState } from "react";
import TGA from "./tga.js";

// Trim and prettify a `requires` clause for display in capability rows.
// We strip `is_player`, `not is_player`, and the noisy `factions { ... }`
// lists down to a short faction summary so the line stays readable.
function shortRequires(req) {
  if (!req) return null;
  let r = String(req)
    .replace(/\bis_player\b/g, "")
    .replace(/\band\s+and\b/g, "and")
    .replace(/^\s*and\s+/i, "")
    .replace(/\s+and\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  // Fold `factions { x, y, } -> [x, y]
  r = r.replace(/factions\s*\{\s*([^}]*)\}/g, (_, list) => {
    const xs = list.split(",").map((s) => s.trim()).filter(Boolean);
    return `[${xs.join(", ")}]`;
  });
  return r || null;
}

// Humanize a single capability line from EDB into something a player /
// modder can scan at a glance. Falls back to the raw line (lowercase
// underscores → spaces, capitalized) when no rule matches.
function humanizeCapability(raw) {
  if (!raw) return "";
  const line = String(raw).trim();
  // <stat>_bonus bonus N [requires ...]
  let m = line.match(/^([a-z_]+_bonus)\s+bonus\s+(-?\d+)(?:\s+requires\s+(.+))?$/);
  if (m) {
    const stat = m[1].replace(/_bonus$/, "").replace(/_/g, " ");
    const n = parseInt(m[2], 10);
    const sign = n >= 0 ? "+" : "";
    const req = shortRequires(m[3]);
    return `${sign}${n} ${stat}${req ? ` (${req})` : ""}`;
  }
  // population_growth_bonus 2 (no `bonus` keyword)
  m = line.match(/^([a-z_]+)\s+(-?\d+)$/);
  if (m) {
    const known = ["wall_level", "tower_level", "gate_strength", "gate_defences",
      "farming_level", "road_level", "port_level", "construction_modifier"];
    if (known.includes(m[1])) {
      const stat = m[1].replace(/_/g, " ");
      const n = parseInt(m[2], 10);
      const cap = stat.charAt(0).toUpperCase() + stat.slice(1);
      return `${cap}: ${n}`;
    }
  }
  // recruits_morale_bonus N
  m = line.match(/^recruits?_(morale|exp|experience)_bonus\s+(?:bonus\s+)?(-?\d+)/);
  if (m) {
    const tag = m[1].startsWith("morale") ? "morale" : "experience";
    return `+${m[2]} recruit ${tag}`;
  }
  // mine_resource <res> <multi>
  m = line.match(/^mine_resource\s+(\S+)\s+(\S+)/);
  if (m) return `Mines ${m[1]} (×${m[2]})`;
  // hidden_resource ... or other rare lines — keep but tidy.
  return line.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

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

export default function InfoPopup({ payload, modDataDir, factionDisplayNames, onClose, devMode }) {
  const [imgUrl, setImgUrl] = useState(null);
  const [status, setStatus] = useState("loading");
  const [unitStats, setUnitStats] = useState(null);
  const [buildingStats, setBuildingStats] = useState(null); // { cost, construction, settlementMin, capabilities[] }
  const [description, setDescription] = useState(null); // { displayName, short, long }

  // Fetch unit stats from EDU when payload is a unit.
  useEffect(() => {
    setUnitStats(null);
    if (!payload || payload.type !== "unit") return;
    const api = window.electronAPI;
    if (!api?.getUnitStats) return;
    let cancelled = false;
    api.getUnitStats(modDataDir || null, payload.name).then((s) => {
      if (!cancelled) setUnitStats(s || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [payload, modDataDir]);

  // Fetch building stats (cost, construction turns, capability lines)
  // when the payload is a building.
  useEffect(() => {
    setBuildingStats(null);
    if (!payload || payload.type !== "building") return;
    const api = window.electronAPI;
    if (!api?.getBuildingStats) return;
    let cancelled = false;
    api.getBuildingStats(modDataDir || null, payload.name, payload.chainName || null).then((s) => {
      if (!cancelled) setBuildingStats(s || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [payload, modDataDir]);

  // Fetch the long-form description (text/export_units.txt or
  // text/export_buildings.txt). For units we need the EDU `dictionary`
  // key — the IPC resolves that internally. For buildings we pass the
  // level name (preferred) and chain name (fallback).
  useEffect(() => {
    setDescription(null);
    if (!payload) return;
    const api = window.electronAPI;
    if (!api) return;
    let cancelled = false;
    if (payload.type === "unit" && api.getUnitDescription) {
      api.getUnitDescription(modDataDir || null, payload.name).then((d) => {
        if (!cancelled) setDescription(d || null);
      }).catch(() => {});
    } else if (payload.type === "building" && api.getBuildingDescription) {
      api.getBuildingDescription(modDataDir || null, payload.name, payload.chainName || null, payload.culture || null).then((d) => {
        if (!cancelled) setDescription(d || null);
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [payload, modDataDir]);

  useEffect(() => {
    if (!payload) return;
    setImgUrl(null);
    setStatus("loading");
    let cancelled = false;
    const api = window.electronAPI;
    const run = async () => {
      try {
        let res = null;
        if (payload.type === "unit" && api?.resolveUnitInfo) {
          res = await api.resolveUnitInfo(modDataDir || null, payload.faction, payload.name);
          if (!res && api?.resolveUnitCard) {
            // Fallback to the small card if the unit has no info variant.
            res = await api.resolveUnitCard(modDataDir || null, payload.faction, payload.name);
          }
        } else if (payload.type === "building") {
          console.log("[info-popup] building payload:", JSON.stringify(payload));
          // Buildings: prefer the wide `_constructed` banner — matches the
          // game's info panel. Fall back to the normal icon resolver.
          if (api?.resolveBuildingBanner) {
            res = await api.resolveBuildingBanner(modDataDir || null, payload.culture, payload.name, payload.chainName || null);
            console.log("[info-popup] banner result path:", res?.path || "(null)");
          }
          if (!res && api?.resolveBuildingIcon) {
            res = await api.resolveBuildingIcon(modDataDir || null, payload.culture, payload.name, payload.chainName || null);
            console.log("[info-popup] icon fallback path:", res?.path || "(null)");
          }
        }
        if (!res || !res.buffer) { if (!cancelled) setStatus("missing"); return; }
        const tga = new TGA(new Uint8Array(res.buffer));
        if (!tga.width || !tga.height || !tga.pixels) { if (!cancelled) setStatus("missing"); return; }
        const url = await pixelsToBlobUrl({ width: tga.width, height: tga.height, pixels: tga.pixels });
        if (!cancelled) { setImgUrl(url); setStatus("ready"); }
      } catch (e) {
        if (!cancelled) setStatus("missing");
      }
    };
    run();
    return () => { cancelled = true; };
  }, [payload, modDataDir]);

  useEffect(() => {
    if (!payload) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [payload, onClose]);

  if (!payload) return null;

  const title = payload.label || (payload.name || "").replace(/_/g, " ");
  const factionLabel = payload.faction
    ? (factionDisplayNames?.[payload.faction] || payload.faction.replace(/_/g, " "))
    : "";
  const subtitle = payload.type === "unit"
    ? `Unit${factionLabel ? ` — ${factionLabel}` : ""}`
    : `${payload.chainName ? payload.chainName.replace(/_/g, " ") + " · " : ""}${payload.culture || ""}`;

  return (
    <div onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 10000,
      background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "rgba(30,24,18,0.96)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 10,
        padding: 16,
        maxWidth: "min(90vw, 560px)",
        maxHeight: "90vh",
        overflow: "auto",
        color: "#f6f6f6",
        boxShadow: "0 10px 40px rgba(0,0,0,0.7)",
      }}>
        <div style={{ fontSize: "1.05rem", fontWeight: 700, textTransform: "capitalize" }}>{title}</div>
        {subtitle && <div style={{ fontSize: "0.72rem", color: "#bba", marginBottom: 8, textTransform: "capitalize" }}>{subtitle}</div>}
        <div style={{
          minHeight: 200,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.3)", borderRadius: 6,
        }}>
          {status === "loading" && <span style={{ color: "#aaa", fontStyle: "italic" }}>Loading…</span>}
          {status === "missing" && <span style={{ color: "#aaa", fontStyle: "italic" }}>No image available</span>}
          {status === "ready" && imgUrl && (
            <img src={imgUrl} alt={title} style={{ maxWidth: "100%", maxHeight: "70vh", display: "block" }} />
          )}
        </div>
        {description && (description.short || description.long) && (
          <div style={{
            marginTop: 10,
            padding: "8px 10px",
            background: "rgba(0,0,0,0.3)",
            borderRadius: 6,
            fontSize: "0.78rem",
            color: "#ddd",
            lineHeight: 1.4,
            maxHeight: "32vh",
            overflowY: "auto",
            whiteSpace: "pre-wrap",
          }}>
            {description.long || description.short}
          </div>
        )}
        {payload.type === "building" && buildingStats && (() => {
          const rows = [];
          if (buildingStats.cost != null) rows.push(["Cost", `${buildingStats.cost} denarii`]);
          if (buildingStats.construction != null) rows.push(["Construction", `${buildingStats.construction} turn${buildingStats.construction === 1 ? "" : "s"}`]);
          if (buildingStats.settlementMin) rows.push(["Settlement min", buildingStats.settlementMin.replace(/_/g, " ")]);
          if (buildingStats.tierIndex != null && buildingStats.tierIndex >= 0 && buildingStats.tierMax) {
            rows.push(["Tier", `${buildingStats.tierIndex + 1} / ${buildingStats.tierMax}`]);
          }
          const hasCaps = buildingStats.capabilities && buildingStats.capabilities.length > 0;
          const hasRecruits = buildingStats.recruits && buildingStats.recruits.length > 0;
          const hasLadder = buildingStats.chainLadder && buildingStats.chainLadder.length > 1;
          if (rows.length === 0 && !hasCaps && !hasRecruits && !hasLadder) return null;
          return (
            <div style={{
              marginTop: 10,
              padding: "8px 10px",
              background: "rgba(0,0,0,0.3)",
              borderRadius: 6,
              fontSize: "0.78rem",
              color: "#ddd",
            }}>
              {rows.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 3, marginBottom: 8 }}>
                  {rows.map(([label, value], i) => (
                    <Fragment key={i}>
                      <span style={{ color: "#9ab" }}>{label}</span>
                      <span style={{ fontVariantNumeric: "tabular-nums", textTransform: "capitalize" }}>{value}</span>
                    </Fragment>
                  ))}
                </div>
              )}
              {hasLadder && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: "#9ab", marginBottom: 4 }}>Chain ladder</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", fontSize: "0.72rem" }}>
                    {buildingStats.chainLadder.map((lvl, i) => (
                      <Fragment key={lvl}>
                        <span style={{
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: i === buildingStats.tierIndex ? "rgba(220,166,74,0.35)" : "rgba(255,255,255,0.06)",
                          color: i === buildingStats.tierIndex ? "#ffd98a" : "#bbb",
                          fontWeight: i === buildingStats.tierIndex ? 700 : 400,
                          textTransform: "capitalize",
                        }}>{lvl.replace(/_/g, " ")}</span>
                        {i < buildingStats.chainLadder.length - 1 && (
                          <span style={{ color: "#666" }}>›</span>
                        )}
                      </Fragment>
                    ))}
                  </div>
                </div>
              )}
              {hasRecruits && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: "#9ab", marginBottom: 4 }}>Adds at this level</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, fontSize: "0.72rem" }}>
                    {buildingStats.recruits.map((r, i) => (
                      <span key={i} style={{
                        padding: "2px 6px",
                        background: "rgba(255,255,255,0.06)",
                        borderRadius: 4,
                        textTransform: "capitalize",
                      }}>{r.unit.replace(/_/g, " ")}</span>
                    ))}
                  </div>
                </div>
              )}
              {hasCaps && (
                <>
                  <div style={{ color: "#9ab", marginBottom: 4 }}>Effects</div>
                  <div style={{ fontSize: "0.74rem", lineHeight: 1.5, color: "#cfd6dd", maxHeight: "28vh", overflowY: "auto" }}>
                    {buildingStats.capabilities.map((c, i) => (
                      <div key={i} style={{ marginBottom: 1 }}>{humanizeCapability(c)}</div>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })()}
        {payload.type === "unit" && unitStats && (() => {
          const rows = [];
          const push = (label, value) => { if (value != null && value !== "") rows.push([label, value]); };
          push("Soldiers", unitStats.soldierCount);
          push("HP", unitStats.hp);
          if (unitStats.priAttack != null) {
            push("Attack",
              `${unitStats.priAttack}${unitStats.priWeapon ? ` (${unitStats.priWeapon})` : ""}` +
              (unitStats.secAttack != null ? ` / ${unitStats.secAttack}${unitStats.secWeapon ? ` (${unitStats.secWeapon})` : ""}` : ""));
          }
          push("Charge",
            unitStats.priCharge != null && unitStats.secCharge != null
              ? `${unitStats.priCharge} / ${unitStats.secCharge}`
              : (unitStats.priCharge ?? null));
          if (unitStats.armour != null || unitStats.defenseSkill != null || unitStats.shield != null) {
            push("Defense",
              `${unitStats.armour ?? 0} armour · ${unitStats.defenseSkill ?? 0} skill · ${unitStats.shield ?? 0} shield`);
          }
          if (unitStats.morale != null) {
            push("Morale", `${unitStats.morale}${unitStats.discipline ? ` (${unitStats.discipline})` : ""}`);
          }
          push("Charge dist", unitStats.chargeDist);
          if (unitStats.recruitCost != null || unitStats.upkeep != null) {
            push("Cost",
              `${unitStats.recruitCost ?? "?"}${unitStats.recruitTurns ? ` (${unitStats.recruitTurns} turns)` : ""}` +
              (unitStats.upkeep != null ? ` · upkeep ${unitStats.upkeep}` : ""));
          }
          push("Replenishment", unitStats.replenishMen ? `+${unitStats.replenishMen}/turn` : null);
          push("Class", unitStats.classType ? `${unitStats.category || ""} ${unitStats.classType}`.trim() : unitStats.category);
          if (rows.length === 0) return null;
          return (
            <div style={{
              marginTop: 10,
              padding: "8px 10px",
              background: "rgba(0,0,0,0.3)",
              borderRadius: 6,
              fontSize: "0.78rem",
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              columnGap: 12,
              rowGap: 3,
              color: "#ddd",
            }}>
              {rows.map(([label, value], i) => (
                <Fragment key={i}>
                  <span style={{ color: "#9ab" }}>{label}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
                </Fragment>
              ))}
            </div>
          );
        })()}
        {devMode && (() => {
          // Show-in-source buttons — open the right line in EDB/EDU.
          // Tries VS Code's vscode://file/<path>:<line> URL first; falls back
          // to the OS default editor. The right-click already passes the
          // chain name (for buildings) and unit type (for units).
          const api = window.electronAPI;
          if (!api) return null;
          const isUnit = payload.type === "unit";
          const isBuilding = payload.type === "building";
          if (!isUnit && !isBuilding) return null;
          const openIn = async (kind) => {
            try {
              let loc;
              if (kind === "edu") loc = await api.findEduType(modDataDir || null, payload.name);
              else loc = await api.findEdbChain(modDataDir || null, payload.chainName || payload.name);
              if (!loc) return;
              await api.openSourceFile(loc.path, loc.line);
            } catch {}
          };
          const btnStyle = {
            padding: "4px 10px", fontSize: "0.74rem",
            borderRadius: 6, border: "1px solid #555",
            background: "rgba(255,255,255,0.06)", color: "#dca64a",
            cursor: "pointer", fontWeight: 600,
          };
          return (
            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {isUnit && api.findEduType && (
                <button style={btnStyle} onClick={() => openIn("edu")}
                  title="Open export_descr_unit.txt at this unit's `type` line">
                  📄 Show in EDU
                </button>
              )}
              {isBuilding && api.findEdbChain && (
                <button style={btnStyle} onClick={() => openIn("edb")}
                  title="Open export_descr_buildings.txt at this chain's `building` line">
                  📄 Show in EDB
                </button>
              )}
              <span style={{ fontSize: "0.65rem", color: "#888", alignSelf: "center" }}>
                opens in Notepad++ (with line jump) if installed; otherwise Notepad
              </span>
            </div>
          );
        })()}
        <div style={{ marginTop: 10, fontSize: "0.7rem", color: "#888" }}>
          Right-click or press Esc to close
        </div>
      </div>
    </div>
  );
}
