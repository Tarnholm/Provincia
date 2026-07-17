// src/panels/TimelinePlayerPanel.js
//
// Campaign Timeline Player (2026-07-17): mini-map + scrub bar that animates
// region ownership turn by turn across a scanned saves-folder timeline.
// Presentational — all data arrives via props from App.js:
//
//   timeline            — campaignTimeline (scan-saves-timeline payload)
//   scanning            — timelineScanning
//   onScanTimeline      — runTimelineScan
//   offscreen           — the ORIGINAL region-color canvas (unique rgb per region)
//   regions             — { "r,g,b": { region, city, faction, ... } }
//   factionColors       — { factionId: { primary: [r,g,b], secondary: [r,g,b] } }
//   factionDisplayNames — { factionId: displayName } | null
//   onClose
//
// Frames are built by src/timelinePlayer.js (pure, vitest-covered): one
// rgbKey→color Map + one pixel pass per turn, at reduced resolution (base
// downscaled ONCE, nearest-neighbor so region keys survive), cached per turn
// in a ref Map so scrubbing is instant after first visit.
//
// No-fabrication rule: a turn whose row carries no ownership data shows a
// notice instead of a stale or guessed map; unknown-owner regions paint dark
// gray, never a faction color.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  buildOwnershipFrame,
  downscaleNearest,
  frameCacheKey,
  resolveFactionColor,
  rowOwnership,
  topFactionsForTurn,
  UNKNOWN_OWNER_COLOR,
} from "../timelinePlayer";

const PLAY_MS = 600;           // per-turn dwell while playing
const MAP_MAX_W = 700;         // recolor resolution cap (display is CSS-scaled)

const facLabel = (names, id) =>
  (names && id && names[id]) || (id ? String(id).replace(/_/g, " ") : "—");

const yearLabel = (y, seasonIndex) => {
  if (y == null) return "—";
  const base = `${Math.abs(y)} ${y < 0 ? "BC" : "AD"}`;
  return seasonIndex != null ? `${base} s${seasonIndex}` : base;
};

export default function TimelinePlayerPanel({
  timeline,
  scanning,
  onScanTimeline,
  offscreen,
  regions,
  factionColors,
  factionDisplayNames,
  onClose,
}) {
  const campaigns = (timeline && Array.isArray(timeline.campaigns)) ? timeline.campaigns : [];
  // Default to the campaign with the most saves.
  const defaultCampaignIdx = useMemo(() => {
    let best = 0;
    for (let i = 1; i < campaigns.length; i++) {
      if ((campaigns[i].turns || []).length > (campaigns[best].turns || []).length) best = i;
    }
    return best;
  }, [campaigns]);

  const [campaignIdx, setCampaignIdx] = useState(defaultCampaignIdx);
  useEffect(() => { setCampaignIdx(defaultCampaignIdx); }, [defaultCampaignIdx, timeline]);

  const campaign = campaigns[Math.min(campaignIdx, Math.max(0, campaigns.length - 1))] || null;
  const rows = (campaign && campaign.turns) || [];

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [drawn, setDrawn] = useState(null); // { key, hasOwnership } of the last painted frame

  // Clamp / reset the cursor when the timeline or campaign changes.
  useEffect(() => { setIdx(0); setPlaying(false); }, [timeline, campaignIdx]);

  // ── base image: read the offscreen ONCE, downscale ONCE (nearest) ─────────
  const baseRef = useRef(null); // { width, height, data }
  const baseFor = useRef(null); // the offscreen the base was read from
  if (offscreen && baseFor.current !== offscreen) {
    try {
      const ctx = offscreen.getContext("2d", { willReadFrequently: true });
      const img = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
      baseRef.current = downscaleNearest(
        { width: img.width, height: img.height, data: img.data },
        MAP_MAX_W
      );
      baseFor.current = offscreen;
    } catch {
      baseRef.current = null;
    }
  }

  // ── per-turn frame cache ──────────────────────────────────────────────────
  const cacheRef = useRef(new Map());
  useEffect(() => { cacheRef.current = new Map(); }, [timeline, regions, factionColors, offscreen]);

  const canvasRef = useRef(null);

  // Draw the current turn's frame (build lazily, cache forever within a scan).
  useEffect(() => {
    const base = baseRef.current;
    const canvas = canvasRef.current;
    const row = rows[idx];
    if (!base || !canvas || !row) return;
    const own = rowOwnership(row);
    const key = frameCacheKey(campaignIdx, idx);
    let frame = own ? cacheRef.current.get(key) : null;
    if (own && !frame) {
      frame = buildOwnershipFrame(base, regions || {}, own, factionColors || {}, null);
      cacheRef.current.set(key, frame);
    }
    const paint = frame || base; // no ownership in this row → show the raw region map
    if (canvas.width !== paint.width) canvas.width = paint.width;
    if (canvas.height !== paint.height) canvas.height = paint.height;
    const ctx = canvas.getContext("2d");
    ctx.putImageData(new ImageData(paint.data, paint.width, paint.height), 0, 0);
    setDrawn({ key, hasOwnership: !!own });
  }, [idx, rows, campaignIdx, regions, factionColors, timeline, offscreen]);

  // ── playback ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return;
    if (rows.length < 2) { setPlaying(false); return; }
    const t = setInterval(() => {
      setIdx((i) => {
        if (i + 1 >= rows.length) { setPlaying(false); return i; }
        return i + 1;
      });
    }, PLAY_MS);
    return () => clearInterval(t);
  }, [playing, rows.length]);

  const row = rows[idx] || null;
  const ownership = rowOwnership(row);
  const legend = useMemo(() => topFactionsForTurn(ownership, 10), [ownership]);
  const anyOwnership = rows.some((r) => !!rowOwnership(r));

  // ── styles (dark, gold-accent — matches the App's modal vocabulary) ───────
  const S = {
    overlay: {
      position: "fixed", inset: 0, zIndex: 9990, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
    },
    panel: {
      background: "rgba(28,24,18,0.97)", border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: 10, width: "min(760px, 94vw)", maxHeight: "90vh",
      boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4",
      display: "flex", flexDirection: "column", overflow: "hidden",
    },
    header: {
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      padding: "10px 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)",
    },
    title: { fontWeight: 700, fontSize: "1rem", color: "#dca64a" },
    closeBtn: {
      background: "transparent", border: "none", color: "#aaa",
      fontSize: "1.1rem", cursor: "pointer", padding: 0,
    },
    body: { overflowY: "auto", padding: "12px 16px 16px" },
    goldBtn: (disabled) => ({
      background: "rgba(220,166,74,0.18)", border: "1px solid rgba(220,166,74,0.4)",
      color: "#dca64a", padding: "5px 12px", borderRadius: 5,
      cursor: disabled ? "default" : "pointer", fontSize: "0.78rem", fontWeight: 600,
      opacity: disabled ? 0.5 : 1,
    }),
    hint: { color: "#9a9a9a", fontSize: "0.78rem", lineHeight: 1.5, marginTop: 8 },
    mapWrap: {
      background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 6, padding: 6, display: "flex", justifyContent: "center",
    },
    canvas: {
      width: "min(700px, 100%)", height: "auto",
      imageRendering: "pixelated", display: "block", borderRadius: 3,
    },
    controls: { display: "flex", alignItems: "center", gap: 10, marginTop: 10 },
    slider: { flex: 1, accentColor: "#dca64a", cursor: "pointer" },
    label: { fontSize: "0.78rem", color: "#e0c98a", fontWeight: 600, marginTop: 6 },
    sub: { color: "#999", fontWeight: 500 },
    legend: {
      display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8,
      fontSize: "0.74rem", color: "#ddd",
    },
    swatch: (c) => ({
      display: "inline-block", width: 10, height: 10, borderRadius: 2,
      background: `rgb(${c[0]},${c[1]},${c[2]})`, marginRight: 5,
      border: "1px solid rgba(255,255,255,0.25)", verticalAlign: "middle",
    }),
    notice: { color: "#e0a060", fontSize: "0.74rem", marginTop: 6 },
    select: {
      background: "rgba(0,0,0,0.4)", color: "#ddd", border: "1px solid rgba(255,255,255,0.2)",
      borderRadius: 4, fontSize: "0.76rem", padding: "3px 6px",
    },
  };

  const hasTimeline = campaigns.length > 0;

  return (
    <div onClick={onClose} style={S.overlay}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={S.panel}>
        <div style={S.header}>
          <span style={S.title}>▶ Campaign timeline player</span>
          <button onClick={onClose} style={S.closeBtn} title="Close (Esc)">×</button>
        </div>
        <div style={S.body}>
          {!hasTimeline ? (
            <div>
              <button
                onClick={onScanTimeline}
                disabled={!!scanning}
                style={S.goldBtn(!!scanning)}
              >
                {scanning ? "Scanning…" : "Scan a saves folder…"}
              </button>
              <div style={S.hint}>
                Point the scanner at a folder of saves (e.g. the autosave
                directory). Each save is cracked into a per-turn row; this
                player then animates region ownership across those turns on a
                mini-map. Saves are ordered by their cracked turn number, not
                filename.
              </div>
              {timeline && timeline.error && (
                <div style={{ ...S.notice, color: "#e08080" }}>{timeline.error}</div>
              )}
            </div>
          ) : (
            <div>
              {campaigns.length > 1 && (
                <div style={{ marginBottom: 8 }}>
                  <select
                    value={campaignIdx}
                    onChange={(e) => setCampaignIdx(+e.target.value)}
                    style={S.select}
                  >
                    {campaigns.map((c, i) => (
                      <option key={i} value={i}>
                        {facLabel(factionDisplayNames, c.player)} · {(c.turns || []).length} save(s)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {!offscreen || !baseRef.current ? (
                <div style={S.hint}>
                  — map not loaded yet. Load a mod (so the region-color map is
                  available) to render the ownership mini-map.
                </div>
              ) : (
                <div style={S.mapWrap}>
                  <canvas ref={canvasRef} style={S.canvas} />
                </div>
              )}

              <div style={S.controls}>
                <button
                  onClick={() => {
                    if (!playing && idx >= rows.length - 1) setIdx(0); // replay from start
                    setPlaying((p) => !p);
                  }}
                  disabled={rows.length < 2}
                  style={S.goldBtn(rows.length < 2)}
                  title={playing ? "Pause" : "Play (~0.6s per turn)"}
                >
                  {playing ? "❚❚" : "▶"}
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, rows.length - 1)}
                  value={Math.min(idx, Math.max(0, rows.length - 1))}
                  onChange={(e) => { setPlaying(false); setIdx(+e.target.value); }}
                  style={S.slider}
                />
                <span style={{ fontSize: "0.72rem", color: "#999", whiteSpace: "nowrap" }}>
                  {rows.length ? `${idx + 1} / ${rows.length}` : "—"}
                </span>
              </div>

              {row && (
                <div style={S.label}>
                  Turn {row.turn != null ? row.turn : "—"}
                  <span style={S.sub}> · {yearLabel(row.year, row.seasonIndex)}</span>
                  {row.file ? <span style={S.sub}> · {row.file}</span> : null}
                  {campaign && campaign.player ? (
                    <span style={S.sub}> · tracked: {facLabel(factionDisplayNames, campaign.player)}</span>
                  ) : null}
                </div>
              )}

              {row && !ownership && (
                <div style={S.notice}>
                  {anyOwnership
                    ? "This save's row carries no ownership data — showing the raw region map for this turn."
                    : "This scan's rows carry no per-save ownership (_ownerByCity). Re-scan after updating: the timeline payload must keep _ownerByCity for the player to animate (see saveAnalysisHandlers finalizeTimeline)."}
                </div>
              )}

              {legend.length > 0 && (
                <div style={S.legend}>
                  {legend.map(({ faction, count }) => {
                    const col = resolveFactionColor(factionColors, faction) || UNKNOWN_OWNER_COLOR;
                    return (
                      <span key={faction} title={faction}>
                        <span style={S.swatch(col)} />
                        {facLabel(factionDisplayNames, faction)}
                        <span style={{ color: "#888" }}> ×{count}</span>
                      </span>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <button onClick={onScanTimeline} disabled={!!scanning} style={S.goldBtn(!!scanning)}>
                  {scanning ? "Scanning…" : "Re-scan…"}
                </button>
                {timeline && timeline.scanned != null && (
                  <span style={{ fontSize: "0.72rem", color: "#999", marginLeft: 8 }}>
                    {timeline.scanned} save(s) scanned
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
