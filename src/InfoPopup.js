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

export default function InfoPopup({ payload, modDataDir, factionDisplayNames, onClose }) {
  const [imgUrl, setImgUrl] = useState(null);
  const [status, setStatus] = useState("loading");
  const [unitStats, setUnitStats] = useState(null);

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
        <div style={{ marginTop: 10, fontSize: "0.7rem", color: "#888" }}>
          Right-click or press Esc to close
        </div>
      </div>
    </div>
  );
}
