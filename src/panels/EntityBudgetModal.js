// Save entity-budget modal, extracted from App.js (2026-07-15). Pure
// presentational component: renders the live-character / dead-pool budget
// against the ~65536 engine pointer cap. Props are the three counts + a close
// handler; no App state or refs are touched. Behavior identical to the inline
// IIFE it replaced.
import React from "react";

export default function EntityBudgetModal({ aliveCount, deadCount, inPlaceDeadCount, onClose }) {
  const cap = 65536;
  const alive = aliveCount;
  const dead = deadCount;
  const inPlace = inPlaceDeadCount;
  const have = (alive != null) || (dead != null);
  const total = (alive || 0) + (dead || 0);
  const totalFrac = total / cap;
  const deadFrac = dead != null ? dead / cap : 0;
  const tier = deadFrac >= 0.4 ? "red" : deadFrac >= 0.3 ? "yellow" : "green";
  const tierColor = tier === "red" ? "#f87171" : tier === "yellow" ? "#facc15" : "#4ade80";
  const tierLabel = tier === "red" ? "near corruption risk" : tier === "yellow" ? "watch closely" : "healthy";
  const fmt = (n) => n == null ? "—" : Number(n).toLocaleString();
  const pct = (n) => n == null ? "—" : `${(n * 100).toFixed(1)}%`;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 10001, display: "flex", alignItems: "flex-start", justifyContent: "center",
      paddingTop: "12vh",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#1e1e1e", color: "#e6e6e6", borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.10)",
        width: "min(540px, 92vw)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: "1rem", flex: 1 }}>
            Save entity budget
            <span style={{ marginLeft: 10, fontSize: "0.72rem", color: tierColor, fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {tierLabel}
            </span>
          </h3>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
            color: "#ccc", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: "0.78rem",
          }}>Close</button>
        </div>
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          {!have ? (
            <div style={{ color: "#888", fontStyle: "italic", fontSize: "0.85rem" }}>
              No save loaded yet — counts populate after the first snapshot parse.
            </div>
          ) : (
            <>
              <div style={{ fontSize: "0.78rem", color: "#bbb" }}>
                Engine pointer cap: <span style={{ color: "#eee", fontFamily: "monospace" }}>~{cap.toLocaleString()}</span> (2<sup>16</sup>).
                Live characters and dead-pool dynasty records share this budget;
                the dead pool grows ~8.6 entries per turn on a long campaign.
              </div>
              {/* Combined progress bar */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.74rem", color: "#aaa", marginBottom: 4 }}>
                  <span>Total used</span>
                  <span><span style={{ color: "#eee" }}>{fmt(total)}</span> of {cap.toLocaleString()} ({pct(totalFrac)})</span>
                </div>
                <div style={{ height: 10, background: "rgba(255,255,255,0.06)", borderRadius: 5, overflow: "hidden", display: "flex" }}>
                  <div style={{
                    width: `${Math.min(100, ((alive || 0) / cap) * 100)}%`,
                    background: "#60a5fa",
                  }} />
                  <div style={{
                    width: `${Math.min(100 - ((alive || 0) / cap) * 100, ((dead || 0) / cap) * 100)}%`,
                    background: tierColor,
                  }} />
                </div>
              </div>
              {/* Line items */}
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "6px 12px", fontSize: "0.86rem", alignItems: "baseline" }}>
                <span style={{ color: "#60a5fa", fontWeight: 600 }}>live characters</span>
                <span style={{ color: "#888", fontSize: "0.74rem" }}>engine CHARACTER records (active block)</span>
                <span style={{ fontFamily: "monospace", color: "#eee" }}>{fmt(alive)}</span>

                <span style={{ color: tierColor, fontWeight: 600 }}>dead-pool</span>
                <span style={{ color: "#888", fontSize: "0.74rem" }}>per-faction dynasty records ({pct(deadFrac)} of cap)</span>
                <span style={{ fontFamily: "monospace", color: "#eee" }}>{fmt(dead)}</span>

                <span style={{ color: "#a78bfa", fontWeight: 600 }}>in-place dead</span>
                <span style={{ color: "#888", fontSize: "0.74rem" }}>died this turn — still in active CHARACTER block</span>
                <span style={{ fontFamily: "monospace", color: "#eee" }}>{fmt(inPlace)}</span>
              </div>
              {tier !== "green" && (
                <div style={{
                  padding: "8px 10px", borderRadius: 6, fontSize: "0.78rem",
                  background: `${tierColor}22`, border: `1px solid ${tierColor}55`, color: tierColor,
                }}>
                  {tier === "red"
                    ? "Dead pool exceeds 40% of the engine cap — campaigns at this size have been reported to corrupt on save. Consider archiving the campaign."
                    : "Dead pool exceeds 30% of the engine cap — watch the growth rate over the next several turns."}
                </div>
              )}
              <div style={{ fontSize: "0.7rem", color: "#666", marginTop: 4 }}>
                Counts refresh on every save snapshot. The signatures were cracked
                2026-05-26 against the engine's reference build; tolerance ~3.8%.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
