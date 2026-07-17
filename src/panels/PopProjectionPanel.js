// Population Projection panel (2026-07-17) — early-warning table for balance
// work: project every settlement of a faction N seasons forward at current
// conditions (project-population IPC → src/popProjection.js) and flag risks:
// decline (red), stall (yellow), tier-up with the turn number (green), and
// unrest risk when the starting-PO model puts a town under 80% at normal tax.
// Self-contained state; style matches ArmySetupModal / EconBaselinePanel's
// dark look (inline styles, gold accents, tabular numerals).
import React, { useState } from "react";

const GREEN = "#9ed6ad", RED = "#e8a090", YELLOW = "#e8c873", NEUTRAL = "#9ab";
const SKIP_FAC = new Set(["slave", "rebels", "roman_rebels_1", "roman_rebels_2", "roman_senate"]);

const fmt = (n) => (typeof n === "number" && Number.isFinite(n)) ? n.toLocaleString("en-US") : "—";
const TIER_LBL = {
  village: "Village", town: "Town", large_town: "L.Town",
  city: "City", large_city: "L.City", huge_city: "H.City",
};

// Tiny inline SVG sparkline of a settlement's projected population. Normalizes
// over [min(popNow, traj), max(...)] so flat lines render mid-height. A dashed
// reference tick marks the next-tier threshold when it lies inside the range.
function Sparkline({ popNow, trajectory, nextTierAt, color }) {
  const W = 96, H = 24, PAD = 2;
  const pts = [popNow, ...(trajectory || [])].filter((v) => typeof v === "number");
  if (pts.length < 2) return null;
  let lo = Math.min(...pts), hi = Math.max(...pts);
  if (nextTierAt != null && nextTierAt >= lo && nextTierAt <= hi * 1.15) hi = Math.max(hi, nextTierAt);
  if (hi === lo) { hi += 1; lo -= 1; }
  const x = (i) => PAD + (i / (pts.length - 1)) * (W - 2 * PAD);
  const y = (v) => H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD);
  const poly = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const tierY = (nextTierAt != null && nextTierAt >= lo && nextTierAt <= hi) ? y(nextTierAt) : null;
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      {tierY != null && (
        <line x1={PAD} y1={tierY} x2={W - PAD} y2={tierY}
          stroke="rgba(158,214,173,0.5)" strokeWidth="1" strokeDasharray="3,2" />
      )}
      <polyline points={poly} fill="none" stroke={color || NEUTRAL} strokeWidth="1.5" />
    </svg>
  );
}

function Badge({ color, children, title }) {
  return (
    <span title={title} style={{
      display: "inline-block", padding: "1px 7px", borderRadius: 9, fontSize: "0.68rem",
      fontWeight: 600, marginRight: 4, whiteSpace: "nowrap",
      color, border: `1px solid ${color}`, background: "rgba(0,0,0,0.25)",
    }}>{children}</span>
  );
}

export default function PopProjectionPanel({ modDataDir, factions, factionDisplayNames, initialFaction, onClose }) {
  const [faction, setFaction] = useState(initialFaction || "");
  const [turnsStr, setTurnsStr] = useState("20");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const api = (typeof window !== "undefined" && window.electronAPI) || {};
  const missingBridge = !api.projectPopulation;

  const facList = (factions || []).filter((f) => f && !SKIP_FAC.has(f));
  const display = (f) => (factionDisplayNames && factionDisplayNames[f]) || String(f).replace(/_/g, " ");

  const run = async () => {
    if (busy || !modDataDir || !faction || missingBridge) return;
    const turns = Math.max(1, Math.min(400, Math.floor(parseFloat(turnsStr)) || 20));
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await api.projectPopulation(modDataDir, faction, turns);
      if (r && r.error) setError(r.error);
      else if (!r || !Array.isArray(r.settlements)) setError("projection returned no result");
      else setResult(r);
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  const btnStyle = (accent) => ({
    background: accent ? "rgba(232,200,115,0.14)" : "rgba(60,60,60,0.7)",
    color: accent ? "#e8c873" : "#9ab",
    border: "1px solid " + (accent ? "#a08a4a" : "rgba(255,255,255,0.25)"),
    borderRadius: 5, padding: "3px 12px", cursor: "pointer", fontSize: "0.78rem",
  });
  const inputStyle = {
    background: "rgba(255,255,255,0.07)", color: "#eee",
    border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6,
    padding: "3px 8px", fontSize: "0.78rem",
  };
  const th = (extra) => ({ padding: "3px 6px", ...extra });
  const td = (extra) => ({ padding: "3px 6px", ...extra });
  const num = { textAlign: "right", fontVariantNumeric: "tabular-nums" };

  const rows = result ? result.settlements : [];
  const nRisk = rows.filter((s) => s.declining || s.stalled || s.unrestRisk).length;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(940px, 96vw)", maxHeight: "88vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div>
            <span style={{ fontSize: "1.0rem", fontWeight: 600, color: "#e8c873" }}>Population Projection</span>
            <span style={{ marginLeft: 10, fontSize: "0.72rem", color: NEUTRAL }}>current conditions · normal tax · no save</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        {missingBridge && (
          <div style={{ margin: "10px 16px", padding: "8px 10px", borderRadius: 6, background: "rgba(220,90,70,0.10)", border: "1px solid rgba(220,90,70,0.45)", color: RED, fontSize: "0.78rem" }}>
            project-population IPC bridge missing from preload — feature not wired yet.
          </div>
        )}

        {/* Controls */}
        <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.78rem", color: NEUTRAL }}>Faction</span>
          <select value={faction} onChange={(e) => setFaction(e.target.value)} style={{ ...inputStyle, minWidth: 200 }}>
            {!faction && <option value="">— pick a faction —</option>}
            {facList.map((f) => <option key={f} value={f}>{display(f)}</option>)}
          </select>
          <span style={{ fontSize: "0.78rem", color: NEUTRAL }}>seasons</span>
          <input value={turnsStr} onChange={(e) => setTurnsStr(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }}
            style={{ ...inputStyle, width: 52, textAlign: "right" }} />
          <button onClick={run} disabled={busy || !faction || !modDataDir || missingBridge}
            style={{ ...btnStyle(true), opacity: (busy || !faction || !modDataDir) ? 0.5 : 1 }}>
            {busy ? "Projecting…" : "Project"}
          </button>
          {result && (
            <span style={{ fontSize: "0.72rem", color: NEUTRAL }}>
              {rows.length} settlements · {nRisk} flagged{result.poAvailable ? "" : " · PO model unavailable"} · {result.computeMs} ms
            </span>
          )}
        </div>

        {error && (
          <div style={{ margin: "10px 16px 0", padding: "8px 10px", borderRadius: 6, background: "rgba(220,90,70,0.10)", border: "1px solid rgba(220,90,70,0.45)", color: RED, fontSize: "0.78rem" }}>
            {error}
          </div>
        )}

        {/* Results */}
        <div style={{ overflow: "auto", padding: "8px 16px 4px", flex: 1 }}>
          {result && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
              <thead>
                <tr style={{ color: NEUTRAL, textAlign: "left" }}>
                  <th style={th()}>Settlement</th>
                  <th style={th()}>Tier</th>
                  <th style={th(num)}>Pop</th>
                  <th style={th(num)}>%/turn</th>
                  <th style={th()}>Projection</th>
                  <th style={th(num)}>Pop t{result.turns}</th>
                  <th style={th(num)}>Next tier</th>
                  <th style={th(num)}>PO</th>
                  <th style={th()}>Risks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const endPop = s.trajectory.length ? s.trajectory[s.trajectory.length - 1] : s.popNow;
                  const lineColor = s.declining ? RED : s.stalled ? YELLOW : GREEN;
                  return (
                    <tr key={s.settlement} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={td()} title={s.region}>{String(s.settlement || "").replace(/_/g, " ")}</td>
                      <td style={td({ color: "#ccc" })}>
                        {TIER_LBL[s.tierNow] || s.tierNow}
                        {s.tierEnd && s.tierEnd !== s.tierNow ? <span style={{ color: GREEN }}> → {TIER_LBL[s.tierEnd] || s.tierEnd}</span> : null}
                      </td>
                      <td style={td(num)}>{fmt(s.popNow)}</td>
                      <td style={td({ ...num, color: s.growthPctPerTurn < 0 ? RED : s.growthPctPerTurn === 0 ? YELLOW : GREEN, fontWeight: 600 })}>
                        {s.growthPctPerTurn > 0 ? "+" : ""}{s.growthPctPerTurn.toFixed(1)}{s.borderline ? " ?" : ""}
                      </td>
                      <td style={td()}>
                        <Sparkline popNow={s.popNow} trajectory={s.trajectory} nextTierAt={s.nextTierAt} color={lineColor} />
                      </td>
                      <td style={td(num)}>{fmt(endPop)}</td>
                      <td style={td({ ...num, color: "#ccc" })}>{s.nextTierAt != null ? fmt(s.nextTierAt) : "—"}</td>
                      <td style={td({ ...num, color: s.po == null ? NEUTRAL : s.po < 80 ? RED : s.po < 100 ? YELLOW : "#ccc" })}>
                        {s.po != null ? `${s.po}%` : "—"}
                      </td>
                      <td style={td({ whiteSpace: "nowrap" })}>
                        {s.declining && <Badge color={RED} title="Population shrinks under current conditions">declining</Badge>}
                        {s.stalled && <Badge color={YELLOW} title="Growth within ±0.1%/turn — settlement never develops">stalled</Badge>}
                        {s.reachesNextTierAtTurn != null && (
                          <Badge color={GREEN} title={`Reaches ${fmt(s.nextTierAt)} pop (next tier) at season ${s.reachesNextTierAtTurn}`}>
                            tier↑ t{s.reachesNextTierAtTurn}
                          </Badge>
                        )}
                        {s.unrestRisk && <Badge color={RED} title="Starting public order below 80% at normal tax — riot line is 70%">unrest</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {result && result.caveat && (
            <div style={{ margin: "8px 0 6px", fontSize: "0.68rem", color: NEUTRAL }}>{result.caveat}</div>
          )}
          {!result && !error && (
            <div style={{ padding: "14px 0", color: NEUTRAL, fontSize: "0.78rem" }}>
              Pick a faction and a horizon, then Project: every settlement is advanced
              season by season with the no-save growth model (pop-dependent squalor and
              tier upgrades re-evaluated each turn). Red = shrinking, yellow = stalled,
              green = reaches its next settlement tier, unrest = starting PO under 80%.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
