// Recruit Planner panel (2026-07-17) — presentational overlay showing, for the
// selected settlement, what each NEXT building upgrade unlocks for
// recruitment ("Barracks city_barracks → army_barracks: +Principes, +Triarii").
// The plan itself is computed by src/recruitPlanner.js (planRecruitUpgrades);
// this component only renders it. Dark inline styling matches
// src/panels/ArmySetupModal.js (same overlay/panel/card vocabulary).
//
// Props (all owned by the caller):
//   info                — region info object ({ city, region, faction, ... })
//   plan                — planRecruitUpgrades() result array
//   factionDisplayNames — { factionId: display name } (optional)
//   unitDict            — optional { unitName: display string } override for
//                         unit labels; falls back to newUnits[i].displayName,
//                         then to the prettified internal name
//   onClose             — close handler
import React from "react";
import { createPortal } from "react-dom";

const pretty = (s) => String(s || "").replace(/_/g, " ").trim();

export default function RecruitPlannerPanel({ info, plan, factionDisplayNames, unitDict, onClose }) {
  if (typeof document === "undefined") return null;
  const settlementName = (info && (info.city || info.region)) || "—";
  const ownerId = (info && info.faction) || null;
  const ownerLabel = ownerId
    ? ((factionDisplayNames && factionDisplayNames[ownerId]) || pretty(ownerId))
    : null;
  const unitLabel = (u) =>
    (unitDict && unitDict[u.unit]) || u.displayName || pretty(u.unit);
  const rows = Array.isArray(plan) ? plan : [];
  const upgrades = rows.filter((e) => !e.alreadyMax);
  const maxed = rows.filter((e) => e.alreadyMax);
  return createPortal(
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="popover-pop-in"
        style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(560px, 94vw)", maxHeight: "82vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}
      >
        {/* Header — settlement name + owner, close button. */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "0 14px 8px", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
          <div style={{ fontSize: "1.02rem", fontWeight: 600, color: "#e8c873" }}>
            Recruitment planner — {settlementName}
          </div>
          {ownerLabel && (
            <div style={{ fontSize: "0.76rem", color: "#9ab" }}>{ownerLabel}</div>
          )}
          <button
            onClick={onClose}
            style={{ marginLeft: "auto", background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>
        <div style={{ overflow: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.length === 0 && (
            <div style={{ fontSize: "0.8rem", color: "#9ab", padding: "6px 2px" }}>
              No building data for this settlement.
            </div>
          )}
          {/* One card per upgradable chain. */}
          {upgrades.map((e) => (
            <div
              key={e.chain}
              style={{ padding: "8px 10px", borderRadius: 6, background: e.newUnits.length > 0 ? "rgba(232,200,115,0.07)" : "rgba(255,255,255,0.03)", border: e.newUnits.length > 0 ? "1px solid rgba(232,200,115,0.3)" : "1px solid rgba(255,255,255,0.12)" }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.86rem", fontWeight: 600, color: "#e8c873", textTransform: "capitalize" }}>
                  {pretty(e.chain)}
                </span>
                <span style={{ fontSize: "0.76rem", color: "#cbb" }}>
                  {e.notBuilt
                    ? <>build <b style={{ color: "#eee" }}>{pretty(e.toLevel)}</b></>
                    : <>{pretty(e.fromLevel)} → <b style={{ color: "#eee" }}>{pretty(e.toLevel)}</b></>}
                </span>
                {e.notBuilt && (
                  <span style={{ fontSize: "0.68rem", color: "#9fb6e8", border: "1px solid #5a72b0", borderRadius: 4, padding: "0 5px" }}>
                    not built yet
                  </span>
                )}
              </div>
              {e.newUnits.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                  {e.newUnits.map((u) => (
                    <span
                      key={u.unit}
                      title={u.unit}
                      style={{ fontSize: "0.74rem", color: "#b8d38f", background: "rgba(143,180,110,0.12)", border: "1px solid rgba(143,180,110,0.4)", borderRadius: 5, padding: "1px 7px", textTransform: "capitalize" }}
                    >
                      +{unitLabel(u)}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 4, fontSize: "0.72rem", color: "#889" }}>
                  no new recruits from this upgrade
                </div>
              )}
            </div>
          ))}
          {/* Already-max chains — dimmed at the bottom. */}
          {maxed.length > 0 && (
            <div style={{ marginTop: 4, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 6 }}>
              {maxed.map((e) => (
                <div
                  key={e.chain}
                  style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "3px 2px", opacity: 0.45 }}
                >
                  <span style={{ fontSize: "0.78rem", color: "#ccc", textTransform: "capitalize" }}>
                    {pretty(e.chain)}
                  </span>
                  <span style={{ fontSize: "0.7rem", color: "#99a" }}>
                    {e.unknownLadder
                      ? `${pretty(e.fromLevel)} — level ladder unknown`
                      : `${pretty(e.fromLevel)} — already max level`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
