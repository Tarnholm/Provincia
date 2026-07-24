// AI Movement Lab (🧭⚔, 2026-07-24) — analyze RTW:R campaign logs for AI
// pathing pathologies, to tune the mod's AI. Pick any message_log.txt (the
// live log dir, an archived one, or a log downloaded from the RIS Discord
// telemetry channel) and get per-army findings: stuck armies, ping-pong
// pathing loops, multi-turn orders that never arrive, and flee loops — each
// with the army's name, faction, turn span, and the region it happened in
// (click to highlight it on the map, double-click to jump).
// Analysis is main-process (src/aiMovementAnalyzer.js, validated against the
// real 97-turn calibration log); this panel only renders the result.
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";

const KIND_META = {
  stuck: { color: "#e87a6a", label: "Stuck", desc: "moves every turn but gets nowhere" },
  oscillation: { color: "#e8c873", label: "Ping-pong", desc: "bounces between two tiles" },
  never_arrives: { color: "#cf8f6a", label: "Never arrives", desc: "multi-turn order never completes" },
  flee_loop: { color: "#c9a0dc", label: "Flee loop", desc: "flees repeatedly within a few turns" },
};

export default function AiMovementPanel({
  defaultLogDir,        // live log dir if known (auto-analyze offer)
  modDataDir,
  factionDisplayNames,
  regions,              // rgbKey → { region, ... } for map highlight
  onHighlightRegion,    // (regionName, jump) => void
  onClose,
}) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [kindFilter, setKindFilter] = useState(() => new Set(Object.keys(KIND_META)));
  const [factionFilter, setFactionFilter] = useState("");

  const run = async (logPath) => {
    setBusy(true); setError(null);
    try {
      const r = await window.electronAPI.analyzeAiMovement(logPath || null, modDataDir || null);
      if (r && r.canceled) { setBusy(false); return; }
      if (!r || r.error) setError((r && r.error) || "analysis failed");
      else setResult(r);
    } catch (e) { setError(e && e.message ? e.message : String(e)); }
    setBusy(false);
  };

  const flabel = (id) => (factionDisplayNames && factionDisplayNames[id]) || String(id || "?").replace(/_/g, " ");
  const visible = useMemo(() => {
    if (!result) return [];
    const fq = factionFilter.trim().toLowerCase();
    return (result.findings || []).filter((f) =>
      kindFilter.has(f.kind) &&
      (!fq || String(f.faction).toLowerCase().includes(fq) || flabel(f.faction).toLowerCase().includes(fq) || String(f.name).toLowerCase().includes(fq)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, kindFilter, factionFilter, factionDisplayNames]);

  const jump = (regionName, dbl) => {
    if (!regionName || !onHighlightRegion) return;
    onHighlightRegion(regionName, dbl);
  };

  const facRows = useMemo(() => {
    if (!result) return [];
    return Object.entries(result.factionStats || {})
      .filter(([, s]) => s.moves > 0)
      .sort((a, b) => b[1].wander - a[1].wander)
      .slice(0, 12);
  }, [result]);

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(860px, 96vw)", maxHeight: "88vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#8fc9d8" }}>⚔ AI Movement Lab</span>
          {result && (
            <span style={{ fontSize: "0.72rem", color: "#888" }}>
              {result.totalTurns} turns · {result.moveLines.toLocaleString()} moves · {result.armies} armies · {result.findings.length} findings · {result.ms}ms
            </span>
          )}
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => run(null)} disabled={busy}
            style={{ padding: "4px 12px", borderRadius: 6, cursor: busy ? "default" : "pointer", border: "1px solid rgba(220,166,74,0.4)", background: "rgba(220,166,74,0.18)", color: "#dca64a", fontWeight: 600, fontSize: "0.78rem" }}>
            {busy ? "Analyzing…" : "Open log file…"}
          </button>
          {defaultLogDir && (
            <button onClick={() => run(defaultLogDir)} disabled={busy}
              title={defaultLogDir}
              style={{ padding: "4px 12px", borderRadius: 6, cursor: busy ? "default" : "pointer", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#cfe3ea", fontSize: "0.78rem" }}>
              Analyze current game log
            </button>
          )}
          <span style={{ fontSize: "0.68rem", color: "#888" }}>
            Any message_log.txt works — live dir, archive, or a Discord telemetry download.
          </span>
        </div>

        {error && <div style={{ padding: "8px 16px", color: "#e87a6a", fontSize: "0.78rem" }}>{error}</div>}

        {!result && !error && (
          <div style={{ padding: "26px 20px", color: "#aaa", fontSize: "0.82rem", lineHeight: 1.6 }}>
            Analyzes a campaign log for AI pathing problems:
            <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
              {Object.entries(KIND_META).map(([k, m]) => (
                <li key={k}><span style={{ color: m.color, fontWeight: 600 }}>{m.label}</span> — {m.desc}</li>
              ))}
            </ul>
          </div>
        )}

        {result && (
          <div style={{ overflowY: "auto", padding: "8px 16px" }}>
            {/* kind filter chips + summary counts */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
              {Object.entries(KIND_META).map(([k, m]) => {
                const on = kindFilter.has(k);
                const n = (result.findingCounts && result.findingCounts[k]) || 0;
                return (
                  <button key={k}
                    onClick={() => setKindFilter((prev) => { const s = new Set(prev); if (s.has(k)) s.delete(k); else s.add(k); return s; })}
                    title={m.desc}
                    style={{ padding: "2px 10px", borderRadius: 10, cursor: "pointer", fontSize: "0.72rem", border: `1px solid ${m.color}`, background: on ? m.color + "33" : "transparent", color: on ? "#eee" : "#777" }}>
                    {m.label} {n}
                  </button>
                );
              })}
              {result.cannotFlee > 0 && (
                <span title="Beaten armies with NOWHERE to retreat (context-free engine line, not attributable to a specific army)"
                  style={{ fontSize: "0.72rem", color: "#e87a6a" }}>· {result.cannotFlee}× cannot-find-flee-tile</span>
              )}
              <input value={factionFilter} onChange={(e) => setFactionFilter(e.target.value)} placeholder="Filter faction / army…"
                style={{ marginLeft: "auto", width: 170, padding: "3px 8px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "#f0f0f0", fontSize: "0.74rem", outline: "none" }} />
            </div>

            {/* findings table */}
            {visible.length === 0 && <div style={{ color: "#8fd18f", fontSize: "0.8rem", padding: "8px 2px" }}>No findings match — the AI moved cleanly here.</div>}
            {visible.map((f, i) => {
              const m = KIND_META[f.kind] || { color: "#999", label: f.kind };
              return (
                <div key={i}
                  onClick={() => jump(f.region, false)}
                  onDoubleClick={() => jump(f.region, true)}
                  title={f.region ? "Click: highlight region · double-click: jump" : "No region resolved for this tile"}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "3px 4px", borderRadius: 4, cursor: f.region ? "pointer" : "default", fontSize: "0.76rem", borderLeft: `3px solid ${m.color}`, marginBottom: 2 }}>
                  <span style={{ color: m.color, fontWeight: 700, width: 86, flexShrink: 0 }}>{m.label}</span>
                  <span style={{ color: "#eee", fontWeight: 600 }}>{f.name}</span>
                  <span style={{ color: "#9a8f7a" }}>{flabel(f.faction)}</span>
                  <span style={{ color: "#8fc9d8", flexShrink: 0 }}>t{f.fromTurn}–{f.toTurn}</span>
                  <span style={{ color: "#bbb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{f.detail}</span>
                  <span style={{ color: "#cfc6b0", flexShrink: 0 }}>{f.region ? f.region.replace(/_/g, " ") : `(${f.x},${f.y})`}</span>
                </div>
              );
            })}

            {/* faction wander table */}
            {facRows.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#cfc6b0", marginBottom: 3 }}>
                  Faction wander index (1 = walks in circles, 0 = beelines):
                </div>
                {facRows.map(([f, s]) => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.74rem", marginBottom: 1 }}>
                    <span style={{ width: 150, color: "#ddd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{flabel(f)}</span>
                    <div style={{ flex: 1, height: 7, borderRadius: 3, background: "rgba(255,255,255,0.07)" }}>
                      <div style={{ height: 7, borderRadius: 3, width: `${Math.round(s.wander * 100)}%`, background: s.wander > 0.5 ? "#e87a6a" : s.wander > 0.3 ? "#e8c873" : "#8fd18f" }} />
                    </div>
                    <span style={{ color: "#9a8f7a", width: 100, textAlign: "right" }}>{s.wander.toFixed(2)} · {s.moves} mv</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
