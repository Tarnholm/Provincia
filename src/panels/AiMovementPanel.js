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
  // message_log (movement traces)
  stuck: { color: "#e87a6a", label: "Stuck", desc: "moves every turn but gets nowhere" },
  oscillation: { color: "#e8c873", label: "Ping-pong", desc: "bounces between two tiles" },
  never_arrives: { color: "#cf8f6a", label: "Never arrives", desc: "multi-turn order never completes" },
  flee_loop: { color: "#c9a0dc", label: "Flee loop", desc: "flees repeatedly within a few turns" },
  // campaign_ai_log (the AI's own decisions)
  stuck_mission: { color: "#e87a6a", label: "Stuck mission", desc: "same move order re-issued turn after turn — the army never arrives" },
  assign_churn: { color: "#e8c873", label: "Thrashed army", desc: "controller assigns/releases this army over and over" },
  campaign_stall: { color: "#cf8f6a", label: "Stalled campaign", desc: "gathering for a target but never reaches required strength" },
  aborted_hotspot: { color: "#c9a0dc", label: "Abort hotspot", desc: "campaign for this region aborted many turns for insufficient strength" },
  rich_but_stalled: { color: "#8fd18f", label: "Rich but stalled", desc: "the engine's own finance report says it had money — income is NOT this faction's problem" },
  abandoned: { color: "#d88fb0", label: "Abandoned army", desc: "the AI commanded it, then went silent — attach a save to tell an ORPHANED live army from a character who simply died" },
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
  const [savePath, setSavePath] = useState(null);      // optional .sav to cross-reference
  const [onlyConfirmed, setOnlyConfirmed] = useState(false);
  const [tab, setTab] = useState("findings"); // "findings" | "leads"

  const run = async (logPath) => {
    setBusy(true); setError(null);
    try {
      const r = await window.electronAPI.analyzeAiMovement(logPath || null, modDataDir || null, savePath || null);
      if (r && r.canceled) { setBusy(false); return; }
      if (!r || r.error) setError((r && r.error) || "analysis failed");
      else setResult(r);
    } catch (e) { setError(e && e.message ? e.message : String(e)); }
    setBusy(false);
  };

  const pickSave = async () => {
    try {
      const r = await window.electronAPI?.pickAiSaveFile?.();
      if (r && r.path) setSavePath(r.path);
    } catch { /* cancelled */ }
  };

  const flabel = (id) => (factionDisplayNames && factionDisplayNames[id]) || String(id || "?").replace(/_/g, " ");
  const visible = useMemo(() => {
    if (!result) return [];
    const fq = factionFilter.trim().toLowerCase();
    return (result.findings || []).filter((f) =>
      kindFilter.has(f.kind) &&
      (!onlyConfirmed || /NEVER arrived/.test(f.verdict || "") || f.impossible) &&
      (!fq || String(f.faction).toLowerCase().includes(fq) || flabel(f.faction).toLowerCase().includes(fq) || String(f.name).toLowerCase().includes(fq)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, kindFilter, factionFilter, onlyConfirmed, factionDisplayNames]);

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
              {result.logKind === "campaign_ai"
                ? `AI decision log · ${result.totalTurns} turn blocks (${result.firstYear} → ${result.lastYear}) · ${(result.lines || 0).toLocaleString()} lines · ${result.findings.length} findings · ${result.ms}ms`
                : `movement log · ${result.totalTurns} turns · ${result.moveLines.toLocaleString()} moves · ${result.armies} armies · ${result.findings.length} findings · ${result.ms}ms`}
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
            Takes message_log.txt (movement traces) or campaign_ai_log.txt (AI decisions, any size — 300MB telemetry streams fine).
          </span>
          <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
            <button onClick={pickSave} disabled={busy}
              style={{ padding: "3px 10px", borderRadius: 6, cursor: busy ? "default" : "pointer", border: "1px solid rgba(143,201,216,0.4)", background: savePath ? "rgba(143,201,216,0.18)" : "transparent", color: "#8fc9d8", fontSize: "0.74rem" }}>
              {savePath ? "✓ Save attached" : "Cross-reference a save… (optional)"}
            </button>
            {savePath && (
              <>
                <span title={savePath} style={{ fontSize: "0.68rem", color: "#9a8f7a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>
                  {savePath.split(/[\/]/).pop()}
                </span>
                <span onClick={() => setSavePath(null)} title="Detach" style={{ color: "#e87a6a", cursor: "pointer", fontSize: "0.74rem" }}>✕</span>
              </>
            )}
            <span style={{ fontSize: "0.66rem", color: "#777" }}>
              A save turns findings into verdicts — did the army ever arrive, was the campaign even affordable? (adds ~12s)
            </span>
          </div>
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

        {result && result.usable === false && (
          <div style={{ padding: "18px 20px" }}>
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(232,122,106,0.10)", border: "1px solid rgba(232,122,106,0.35)" }}>
              <div style={{ fontWeight: 700, color: "#e87a6a", marginBottom: 4 }}>Nothing to analyse in this log</div>
              <div style={{ fontSize: "0.8rem", color: "#ddd", lineHeight: 1.55 }}>{result.emptyReason}</div>
              <div style={{ fontSize: "0.72rem", color: "#9a8f7a", marginTop: 6 }}>
                {(result.logPath || "").split(/[\/]/).pop()}
                {result.logBytes ? ` · ${(result.logBytes / 1048576).toFixed(1)} MB` : ""}
              </div>
            </div>
            <div style={{ fontSize: "0.76rem", color: "#aaa", marginTop: 10, lineHeight: 1.6 }}>
              This is <b>not</b> a clean bill of health for the AI — it simply means this file carries no
              movement or decision data. The AI-side analysis lives in <code style={{ color: "#8fc9d8" }}>campaign_ai_log.txt</code>,
              which is usually the far larger file in the same folder.
            </div>
          </div>
        )}
        {result && result.usable !== false && (
          <>
          {/* FIXED header — the summary, tabs and filters stay put; only the
              list below scrolls (user 2026-07-25). flexShrink:0 keeps it from
              being squeezed by the scroller's flex:1. */}
          <div style={{ padding: "8px 16px 6px", flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {result.saveError && (
              <div style={{ marginBottom: 6, fontSize: "0.74rem", color: "#e87a6a" }}>Save cross-reference failed: {result.saveError}</div>
            )}
            {result.save && (
              <div style={{ marginBottom: 8, padding: "6px 9px", borderRadius: 6, background: "rgba(143,201,216,0.10)", border: "1px solid rgba(143,201,216,0.28)", fontSize: "0.75rem", lineHeight: 1.5 }}>
                <b style={{ color: "#8fc9d8" }}>Cross-referenced with turn {result.save.turn}</b>
                {" — "}
                <b style={{ color: "#e87a6a" }}>{result.save.confirmedNeverArrived}</b> orders confirmed never to have arrived,{" "}
                <b style={{ color: "#e87a6a" }}>{result.save.impossibleCampaigns}</b> campaigns the faction could never afford,{" "}
                <b style={{ color: "#e87a6a" }}>{result.save.orphanedArmies}</b> armies orphaned while still alive.
                <div style={{ color: "#9a8f7a", fontSize: "0.7rem" }}>
                  World at that turn: {result.save.navalWorld} ships total · {result.save.sieges} active sieges · {result.save.factionsWithUnits} factions still fielding troops.
                </div>
              </div>
            )}
            {result.modLeads && result.modLeads.length > 0 && (
              <div style={{ display: "flex", gap: 2, marginBottom: 8, padding: 2, background: "rgba(0,0,0,0.25)", borderRadius: 5 }}>
                {[["findings", `Findings (${result.findings.length})`], ["leads", `Mod-file leads (${result.modLeads.length})`]].map(([k, lab]) => (
                  <div key={k} onClick={() => setTab(k)}
                    style={{ flex: 1, padding: "3px 8px", fontSize: "0.74rem", textAlign: "center", cursor: "pointer", borderRadius: 4, userSelect: "none",
                      background: tab === k ? "rgba(255,255,255,0.14)" : "transparent", color: tab === k ? "#fff" : "#bbb", fontWeight: tab === k ? 600 : 400 }}>
                    {lab}
                  </div>
                ))}
              </div>
            )}
            {/* filters live in the fixed header too, so they're always reachable */}
            {tab === "findings" && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {Object.entries(KIND_META).map(([k, m]) => {
                const on = kindFilter.has(k);
                const n = (result.findingCounts && result.findingCounts[k]) || 0;
                return (
                  <button key={k}
                    onClick={() => setKindFilter((prev) => { const s2 = new Set(prev); if (s2.has(k)) s2.delete(k); else s2.add(k); return s2; })}
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
              {result.save && (
                <label title="Show only findings the save proves went wrong" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem", color: onlyConfirmed ? "#e87a6a" : "#888", cursor: "pointer" }}>
                  <input type="checkbox" checked={onlyConfirmed} onChange={() => setOnlyConfirmed((v) => !v)} />
                  proven only
                </label>
              )}
              <input value={factionFilter} onChange={(e) => setFactionFilter(e.target.value)} placeholder="Filter faction / army…"
                style={{ marginLeft: "auto", width: 170, padding: "3px 8px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "#f0f0f0", fontSize: "0.74rem", outline: "none" }} />
            </div>
            )}
          </div>

          {/* SCROLLER — just the results */}
          <div style={{ overflowY: "auto", padding: "8px 16px", flex: 1, minHeight: 0 }}>
            {tab === "leads" && result.modLeads && (
              <div>
                <div style={{ fontSize: "0.7rem", color: "#888", marginBottom: 6 }}>
                  Each lead names the file and the key to edit, with the log/save evidence behind it.
                </div>
                {result.modLeads.map((l, i) => (
                  <div key={i} style={{ marginBottom: 7, padding: "6px 9px", borderRadius: 6, borderLeft: `3px solid ${l.severity >= 3 ? "#e87a6a" : l.severity === 2 ? "#e8c873" : "#8fc9d8"}`, background: "rgba(255,255,255,0.03)" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <b style={{ color: "#eee" }}>{flabel(l.faction)}</b>
                      <code style={{ fontSize: "0.7rem", color: "#8fc9d8" }}>{l.file}</code>
                      <span style={{ fontSize: "0.7rem", color: "#9a8f7a" }}>{l.key}</span>
                    </div>
                    <div style={{ fontSize: "0.74rem", color: "#e8c873", marginTop: 2 }}>{l.issue}</div>
                    <div style={{ fontSize: "0.74rem", color: "#8fd18f" }}>→ {l.suggestion}</div>
                    <div style={{ fontSize: "0.68rem", color: "#888", marginTop: 1 }}>{l.evidence}</div>
                  </div>
                ))}
              </div>
            )}
            {tab === "findings" && (<>
            {/* findings table */}
            {visible.length === 0 && (
              <div style={{ color: (result.findings || []).length ? "#e8c873" : "#8fd18f", fontSize: "0.8rem", padding: "8px 2px" }}>
                {(result.findings || []).length
                  ? "No findings match the current filters — widen them to see the rest."
                  : "No problems found — the AI moved cleanly in this log."}
              </div>
            )}
            {visible.map((f, i) => {
              const m = KIND_META[f.kind] || { color: "#999", label: f.kind };
              return (
                <div key={i}>
                  <div
                  onClick={() => jump(f.region, false)}
                  onDoubleClick={() => jump(f.region, true)}
                  title={f.region ? "Click: highlight region · double-click: jump" : "No region resolved for this tile"}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "3px 4px", borderRadius: 4, cursor: f.region ? "pointer" : "default", fontSize: "0.76rem", borderLeft: `3px solid ${m.color}`, marginBottom: 2 }}>
                  <span style={{ color: m.color, fontWeight: 700, width: 86, flexShrink: 0 }}>{m.label}</span>
                  <span style={{ color: "#eee", fontWeight: 600 }}>{f.name}</span>
                  <span style={{ color: "#9a8f7a" }}>{flabel(f.faction)}</span>
                  {f.fromTurn != null && f.toTurn != null && (
                    <span style={{ color: "#8fc9d8", flexShrink: 0 }}>
                      {f.fromTurn === f.toTurn ? `t${f.fromTurn}` : `t${f.fromTurn}–${f.toTurn}`}
                    </span>
                  )}
                  <span style={{ color: "#bbb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{f.detail}</span>
                  <span style={{ color: "#cfc6b0", flexShrink: 0 }}>
                    {f.region
                      ? f.region.replace(/_/g, " ")
                      : (f.x != null && f.y != null ? `(${f.x},${f.y})` : "")}
                  </span>
                  </div>
                  {(f.verdict || f.reqVsHave) && (
                    <div style={{ margin: "0 0 3px 92px", fontSize: "0.7rem", color: /NEVER arrived/.test(f.verdict || "") || f.impossible ? "#e87a6a" : "#8fd18f" }}>
                      {f.impossible ? "⛔ " : /NEVER arrived/.test(f.verdict || "") ? "✕ " : "✓ "}
                      {f.reqVsHave || f.verdict}
                      {f.factionSettlements != null && f.kind === "campaign_stall" ? ` · holds ${f.factionSettlements} settlement(s)` : ""}
                    </div>
                  )}
                  </div>
              );
            })}

            </>)}
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
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
