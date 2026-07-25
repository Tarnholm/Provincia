// Campaign Autopsy panel — the post-mortem view over a scanned saves timeline:
// "who won, who collapsed and when." Each faction gets a row with a verdict
// badge, a tiny settlement-count sparkline over turns, and its peak / first-
// decline / elimination turns. The header names the winner.
//
// Presentational + one IPC call: the heavy trajectory analysis lives in the pure
// main-process module src/campaignAutopsy.js and is reached via the
// analyze-campaign IPC (preload: window.electronAPI.analyzeCampaign). The panel
// simply forwards the app's already-scanned `campaignTimeline` (no re-crack) and
// renders the result. Dark inline styling mirrors src/panels/ArmySetupModal.js.
//
// Props:
//   modDataDir          active mod data dir (passed through to the IPC)
//   timeline            the scan-saves-timeline result (app's campaignTimeline), or null
//   onScanTimeline      () => void — kick off a saves-folder scan (same as the Timeline Player)
//   scanning            bool — a scan is in flight
//   factionDisplayNames { faction: "Display Name" } map (optional)
//   onClose             () => void
import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";

const VERDICTS = {
  dominant:   { label: "Dominant",   color: "#e8c873", bg: "rgba(232,200,115,0.16)", border: "#a08a4a" },
  growing:    { label: "Growing",    color: "#8fd18f", bg: "rgba(143,209,143,0.14)", border: "#4a9a6a" },
  stagnant:   { label: "Stagnant",   color: "#9aa6b2", bg: "rgba(154,166,178,0.12)", border: "#5a6470" },
  declining:  { label: "Declining",  color: "#e0a860", bg: "rgba(224,168,96,0.14)",  border: "#a07a3a" },
  eliminated: { label: "Eliminated", color: "#e07a6a", bg: "rgba(224,122,106,0.14)", border: "#a04a3a" },
};

function facLabel(fac, names) {
  return ((names && names[fac]) || fac || "—").replace(/_/g, " ");
}

// Tiny sparkline of settlement count over the faction's series. Null (undecoded)
// points are skipped; peak is dotted, elimination marked with a small red tick.
function Sparkline({ series, peak, eliminated, color, width = 168, height = 34 }) {
  const pts = (series || []).map((s, i) => ({ i, v: s.settlements })).filter((p) => p.v != null);
  if (pts.length === 0) return <svg width={width} height={height} />;
  const n = series.length;
  const maxV = Math.max(1, ...pts.map((p) => p.v));
  const pad = 3;
  const x = (i) => n <= 1 ? width / 2 : pad + (i / (n - 1)) * (width - 2 * pad);
  const y = (v) => height - pad - (v / maxV) * (height - 2 * pad);
  const d = pts.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  // Peak marker (dotted circle) at the peak turn's index within the series.
  let peakXY = null;
  if (peak && peak.settlements != null) {
    const pi = series.findIndex((s) => s.turn === peak.turn && s.settlements === peak.settlements);
    if (pi >= 0) peakXY = { cx: x(pi), cy: y(peak.settlements) };
  }
  let elimX = null;
  if (eliminated) {
    const ei = series.findIndex((s) => s.turn === eliminated.turn && s.settlements === 0);
    if (ei >= 0) elimX = x(ei);
  }
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      {pts.length === 1 && <circle cx={x(pts[0].i)} cy={y(pts[0].v)} r={2.2} fill={color} />}
      {peakXY && <circle cx={peakXY.cx} cy={peakXY.cy} r={3} fill="none" stroke="#e8c873" strokeWidth={1.2} strokeDasharray="1.5 1.5" />}
      {last && <circle cx={x(last.i)} cy={y(last.v)} r={2.2} fill={color} />}
      {elimX != null && <line x1={elimX} y1={pad} x2={elimX} y2={height - pad} stroke="#e07a6a" strokeWidth={1} strokeDasharray="2 2" />}
    </svg>
  );
}

export default function CampaignAutopsyPanel({ modDataDir, timeline, onScanTimeline, scanning, factionDisplayNames, onClose }) {
  const [analysis, setAnalysis] = useState(null); // { factions, turns, winner } | { error }
  const [busy, setBusy] = useState(false);

  const hasTimeline = !!(timeline && !timeline.error && (
    (Array.isArray(timeline.campaigns) && timeline.campaigns.length > 0) ||
    Array.isArray(timeline.turns) || Array.isArray(timeline)
  ));

  // Recompute whenever the scanned timeline changes.
  useEffect(() => {
    let cancelled = false;
    if (!hasTimeline) { setAnalysis(null); return; }
    const api = window.electronAPI;
    if (!api || !api.analyzeCampaign) { setAnalysis({ error: "analyze-campaign IPC unavailable (preload bridge missing?)." }); return; }
    setBusy(true);
    Promise.resolve(api.analyzeCampaign(modDataDir, timeline))
      .then((r) => { if (!cancelled) setAnalysis(r || { error: "no result" }); })
      .catch((e) => { if (!cancelled) setAnalysis({ error: e?.message || String(e) }); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [timeline, hasTimeline, modDataDir]);

  const close = () => onClose && onClose();

  return createPortal(
    <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(880px, 96vw)", maxHeight: "88vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#cf8f6a" }}>
            ⚰ Campaign Autopsy
            {analysis && !analysis.error && analysis.winner &&
              <span style={{ color: "#9ab", fontWeight: 400, fontSize: "0.82rem", marginLeft: 10 }}>
                — winner: <b style={{ color: "#e8c873", textTransform: "capitalize" }}>{facLabel(analysis.winner, factionDisplayNames)}</b>
              </span>}
          </span>
          <button onClick={close} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ overflow: "auto", padding: "10px 16px" }}>

          {/* No timeline yet → scan prompt (same action the Timeline Player uses). */}
          {!hasTimeline && (
            <div style={{ textAlign: "center", padding: "28px 12px", color: "#9ab" }}>
              <div style={{ fontSize: "0.86rem", marginBottom: 14, maxWidth: 460, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>
                Point at a folder of saves from one campaign to reconstruct every faction's arc over
                time — settlements, treasury and army size per turn — and a collapse/growth verdict for each.
              </div>
              {timeline && timeline.error && <div style={{ color: "#e8a090", fontSize: "0.76rem", marginBottom: 12 }}>⚠ {String(timeline.error)}</div>}
              <button onClick={() => onScanTimeline && onScanTimeline()} disabled={scanning}
                style={{ background: "rgba(60,60,60,0.7)", color: "#e8c873", border: "1px solid #a08a4a", borderRadius: 6, padding: "6px 18px", cursor: scanning ? "default" : "pointer", fontSize: "0.82rem", opacity: scanning ? 0.6 : 1 }}>
                {scanning ? "Scanning saves…" : "Scan saves…"}
              </button>
            </div>
          )}

          {/* Timeline present → analysis. */}
          {hasTimeline && (busy || !analysis) && (
            <div style={{ textAlign: "center", padding: "28px 12px", color: "#9ab", fontSize: "0.84rem" }}>Analyzing campaign trajectory…</div>
          )}

          {hasTimeline && analysis && analysis.error && (
            <div style={{ padding: "16px 12px", color: "#e8a090", fontSize: "0.8rem" }}>⚠ {String(analysis.error)}</div>
          )}

          {hasTimeline && analysis && !analysis.error && !busy && (
            <>
              <div style={{ color: "#8aa", fontSize: "0.74rem", marginBottom: 8 }}>
                {analysis.factions.length} faction{analysis.factions.length === 1 ? "" : "s"} across {analysis.turns.length} recorded turn{analysis.turns.length === 1 ? "" : "s"}
                {analysis.turns.length > 0 && <> (turn {analysis.turns[0]} → {analysis.turns[analysis.turns.length - 1]})</>}
                {typeof analysis.scanned === "number" && <> · {analysis.scanned} save(s) scanned</>}
                {Array.isArray(analysis.errors) && analysis.errors.length > 0 && <span style={{ color: "#e0a860" }}> · {analysis.errors.length} read error(s)</span>}
                <span style={{ color: "#667", marginLeft: 8 }}>· sorted by final settlements</span>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
                <thead>
                  <tr style={{ color: "#8aa", textAlign: "left" }}>
                    <th style={{ padding: "2px 6px" }}>Faction</th>
                    <th style={{ padding: "2px 6px" }}>Verdict</th>
                    <th style={{ padding: "2px 6px" }}>Settlements over time</th>
                    <th style={{ padding: "2px 6px", textAlign: "right" }}>Final</th>
                    <th style={{ padding: "2px 6px", textAlign: "right" }}>Peak</th>
                    <th style={{ padding: "2px 6px", textAlign: "right" }}>Decline</th>
                    <th style={{ padding: "2px 6px", textAlign: "right" }}>Wiped</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.factions.map((f) => {
                    const v = VERDICTS[f.verdict] || VERDICTS.stagnant;
                    const isWinner = f.faction === analysis.winner;
                    return (
                      <tr key={f.faction} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                        <td style={{ padding: "5px 6px", color: isWinner ? "#f2e3b8" : "#dde", textTransform: "capitalize", fontWeight: isWinner ? 700 : 400 }}>
                          {isWinner && <span title="Winner — most final settlements" style={{ marginRight: 4 }}>👑</span>}
                          {facLabel(f.faction, factionDisplayNames)}
                        </td>
                        <td style={{ padding: "5px 6px" }}>
                          <span style={{ display: "inline-block", padding: "1px 8px", borderRadius: 10, fontSize: "0.68rem", fontWeight: 700, color: v.color, background: v.bg, border: "1px solid " + v.border }}>{v.label}</span>
                        </td>
                        <td style={{ padding: "3px 6px" }}>
                          <Sparkline series={f.series} peak={f.peak} eliminated={f.eliminated} color={v.color} />
                        </td>
                        <td style={{ padding: "5px 6px", textAlign: "right", color: "#dde", fontVariantNumeric: "tabular-nums" }}>{f.finalSettlements == null ? "—" : f.finalSettlements}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right", color: "#9aa", fontVariantNumeric: "tabular-nums" }}>{f.peak ? `${f.peak.settlements}@${f.peak.turn}` : "—"}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right", color: f.firstDecline ? "#e0a860" : "#667", fontVariantNumeric: "tabular-nums" }}>{f.firstDecline ? `T${f.firstDecline.turn}` : "—"}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right", color: f.eliminated ? "#e07a6a" : "#667", fontVariantNumeric: "tabular-nums" }}>{f.eliminated ? `T${f.eliminated.turn}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div style={{ marginTop: 10, color: "#667", fontSize: "0.68rem", lineHeight: 1.5 }}>
                Peak = high-water settlement count and the turn it was first reached · Decline = first turn after the peak that never recovered · Wiped = first turn at zero settlements.
                Dotted ring on the sparkline marks the peak; red tick marks elimination.
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
