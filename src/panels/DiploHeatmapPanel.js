// Diplomacy heatmap panel — NxN faction-pair grid over the live decoded
// diplomacy matrix. War blocs, alliance clusters and isolation become visible
// at a glance instead of reading per-faction lists in the Diplomacy widget.
//
// Presentational + self-contained: all decoding lives in src/diploHeatmap.js;
// the caller only passes the App-state props (see WIRING SPEC in the feature
// report). Canvas-rendered (RIS live matrices are ~200+ factions; a div grid
// would be 40k+ nodes), with axis labels drawn only while the cell size stays
// readable — hover tooltip carries pair identity at every size.
// Styling matches src/panels/ArmySetupModal.js (dark portal modal).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildHeatmapModel, getCell } from "../diploHeatmap";

const STATE_COLORS = {
  war: "#d05858",          // red
  allied: "#69b563",       // green
  trade: "#5b8fd0",        // blue
  protectorate: "#9a6fd0", // purple
  hostile: "#c9924a",      // amber — AI drift, not formal war
  neutral: "#262320",      // dark gray
};
const STATE_LABELS = {
  war: "at war", allied: "allied", trade: "trade/military bond",
  protectorate: "protectorate", hostile: "hostile (not at war)", neutral: "neutral",
};
const DIAG = "#151310";
const GRID_LINE = "rgba(255,255,255,0.05)";

export default function DiploHeatmapPanel({
  diplomacyMatrix,
  allFactionDiplomacy,
  factionDisplayNames,
  factionCultures,
  factionColors,
  liveActive,
  onClose,
}) {
  const [ordering, setOrdering] = useState("culture"); // "alphabetical" | "culture" | "wars"
  const [aliveOnly, setAliveOnly] = useState(true);
  const [hover, setHover] = useState(null);            // { r, c, x, y } | null
  const canvasRef = useRef(null);
  const baseRef = useRef(null);                        // offscreen base render
  const geomRef = useRef(null);                        // { labelW, topH, cell, n }

  const model = useMemo(() => buildHeatmapModel({
    diplomacyMatrix,
    allFactionDiplomacy,
    factionCultures,
    aliveOnly,
    displayNames: factionDisplayNames,
  }), [diplomacyMatrix, allFactionDiplomacy, factionCultures, aliveOnly, factionDisplayNames]);

  const order = (model.orders && model.orders[ordering]) || model.order || [];
  const n = order.length;
  const label = (id) => (factionDisplayNames && (factionDisplayNames[id] || factionDisplayNames[String(id).toLowerCase()])) || String(id).replace(/_/g, " ");
  const facColor = (id) => {
    const fc = factionColors && (factionColors[String(id).toLowerCase()] || factionColors[id]);
    const p = fc && fc.primary;
    return Array.isArray(p) ? `rgb(${p[0]},${p[1]},${p[2]})` : null;
  };
  const cultureOf = (id) => (factionCultures && (factionCultures[id] || factionCultures[String(id).toLowerCase()])) || "";

  // ── Geometry: fit min(78vh, 92vw) budget; labels only while readable ──
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const budget = Math.max(240, Math.min(vh * 0.78, vw * 0.92) - 40);
  const showLabels = n > 0 && (budget - 150) / n >= 7; // cell >= 7px with gutters
  const labelW = showLabels ? 132 : 10;
  const topH = showLabels ? 108 : 10;
  const cell = n > 0 ? Math.max(3, Math.min(20, Math.floor((budget - labelW) / n))) : 0;
  const W = labelW + n * cell + 2;
  const H = topH + n * cell + 2;

  // ── Base render (offscreen) — cells + labels + culture separators ──
  useEffect(() => {
    if (!n) { baseRef.current = null; return; }
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const off = document.createElement("canvas");
    off.width = Math.round(W * dpr); off.height = Math.round(H * dpr);
    const ctx = off.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "rgba(26,22,18,1)";
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < n; r++) {
      const y = topH + r * cell;
      for (let c = 0; c < n; c++) {
        const x = labelW + c * cell;
        if (r === c) { ctx.fillStyle = DIAG; ctx.fillRect(x, y, cell, cell); continue; }
        const cellData = getCell(model, order[r], order[c]);
        ctx.fillStyle = STATE_COLORS[(cellData && cellData.state) || "neutral"];
        ctx.fillRect(x, y, cell, cell);
      }
    }
    // hairline grid (only when cells are big enough to benefit)
    if (cell >= 6) {
      ctx.strokeStyle = GRID_LINE; ctx.lineWidth = 1;
      for (let i = 0; i <= n; i++) {
        const x = labelW + i * cell + 0.5, y = topH + i * cell + 0.5;
        ctx.beginPath(); ctx.moveTo(x, topH); ctx.lineTo(x, topH + n * cell); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(labelW, y); ctx.lineTo(labelW + n * cell, y); ctx.stroke();
      }
    }
    // culture-group separators when clustered by culture
    if (ordering === "culture" && n > 1) {
      ctx.strokeStyle = "rgba(232,200,115,0.45)"; ctx.lineWidth = 1;
      for (let i = 1; i < n; i++) {
        if (cultureOf(order[i]) !== cultureOf(order[i - 1])) {
          const p = topH + i * cell + 0.5, px = labelW + i * cell + 0.5;
          ctx.beginPath(); ctx.moveTo(labelW, p); ctx.lineTo(labelW + n * cell, p); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(px, topH); ctx.lineTo(px, topH + n * cell); ctx.stroke();
        }
      }
    }
    if (showLabels) {
      ctx.font = `${Math.min(11, Math.max(7, cell - 1))}px sans-serif`;
      ctx.textBaseline = "middle";
      for (let r = 0; r < n; r++) {
        const y = topH + r * cell + cell / 2;
        const col = facColor(order[r]);
        if (col) { ctx.fillStyle = col; ctx.fillRect(labelW - 8, y - Math.max(2, cell / 2 - 1), 5, Math.max(4, cell - 2)); }
        ctx.fillStyle = "#cfc8bd"; ctx.textAlign = "right";
        ctx.fillText(label(order[r]).slice(0, 20), labelW - 12, y, labelW - 16);
      }
      for (let c = 0; c < n; c++) {
        const x = labelW + c * cell + cell / 2;
        ctx.save();
        ctx.translate(x, topH - 6);
        ctx.rotate(-Math.PI / 2);
        const col = facColor(order[c]);
        if (col) { ctx.fillStyle = col; ctx.fillRect(-2, -Math.max(2, cell / 2 - 1), 5, Math.max(4, cell - 2)); }
        ctx.fillStyle = "#cfc8bd"; ctx.textAlign = "left"; // rotated: left edge = bottom
        ctx.fillText(label(order[c]).slice(0, 20), 8, 0, topH - 16);
        ctx.restore();
      }
    }
    baseRef.current = off;
    geomRef.current = { labelW, topH, cell, n };
    draw(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, ordering, order.join("|"), W, H, showLabels]);

  // ── Composite: blit base + row/column hover highlight ──
  const draw = (hv) => {
    const cv = canvasRef.current, base = baseRef.current;
    if (!cv || !base) return;
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    if (cv.width !== base.width) { cv.width = base.width; cv.height = base.height; }
    const ctx = cv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(base, 0, 0);
    if (hv && hv.r >= 0 && hv.c >= 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(labelW, topH + hv.r * cell, n * cell, cell);            // row band
      ctx.fillRect(labelW + hv.c * cell, topH, cell, n * cell);            // column band
      ctx.strokeStyle = "#e8c873"; ctx.lineWidth = 1.5;
      ctx.strokeRect(labelW + hv.c * cell + 0.75, topH + hv.r * cell + 0.75, cell - 1.5, cell - 1.5);
    }
  };
  useEffect(() => { draw(hover); }, [hover]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (e) => {
    const g = geomRef.current;
    if (!g) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const c = Math.floor((x - g.labelW) / g.cell);
    const r = Math.floor((y - g.topH) / g.cell);
    if (r < 0 || c < 0 || r >= g.n || c >= g.n) { if (hover) setHover(null); return; }
    if (!hover || hover.r !== r || hover.c !== c || hover.x !== e.clientX) {
      setHover({ r, c, x: e.clientX, y: e.clientY });
    }
  };

  const hoverInfo = useMemo(() => {
    if (!hover || hover.r == null || hover.r === hover.c) return null;
    const a = order[hover.r], b = order[hover.c];
    if (!a || !b) return null;
    const cd = getCell(model, a, b);
    const state = (cd && cd.state) || "neutral";
    return {
      text: `${label(a)} ↔ ${label(b)}: ${STATE_LABELS[state]}${cd && cd.value != null ? ` (att ${cd.value})` : ""}`,
      color: STATE_COLORS[state],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, model, order]);

  const stats = model.stats || { wars: 0, alliances: 0, mostWarring: [] };
  // Show controls whenever the matrix has ANY real rows — even if the aliveOnly
  // filter currently empties the grid, the user must be able to untick it.
  const rawRows = useMemo(() => (diplomacyMatrix && typeof diplomacyMatrix === "object")
    ? Object.keys(diplomacyMatrix).filter((k) => k !== "_meta").length : 0, [diplomacyMatrix]);
  const hasMatrix = !!(liveActive && rawRows > 0);
  const aliveSignal = !!(allFactionDiplomacy && Object.keys(allFactionDiplomacy).length > 0);

  // ── Shell: dark portal modal, same language as ArmySetupModal ──
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in"
        style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", maxWidth: "96vw", maxHeight: "92vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#cf8f6a" }}>🕊 Diplomacy heatmap{hasMatrix ? ` — ${n} factions` : ""}</span>
          {hasMatrix && (
            <span style={{ fontSize: "0.78rem", color: "#bbb" }}>
              <b style={{ color: STATE_COLORS.war }}>{stats.wars}</b> wars · <b style={{ color: STATE_COLORS.allied }}>{stats.alliances}</b> alliances
              {stats.mostWarring.length > 0 && (
                <span style={{ color: "#8aa" }}> · most warring: {stats.mostWarring.slice(0, 3).map((m) => `${label(m.id)} (${m.wars})`).join(", ")}</span>
              )}
            </span>
          )}
          <button onClick={onClose} style={{ background: "rgba(60,60,60,0.7)", color: "#eee", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 5, padding: "2px 10px", cursor: "pointer", fontSize: "0.78rem" }}>✕ Close</button>
        </div>

        {!hasMatrix ? (
          <div style={{ padding: "28px 24px", color: "#98938a", fontSize: "0.86rem", maxWidth: 460 }}>
            {!liveActive
              ? "Live mode is not active. The diplomacy matrix is only trusted while a live save is loaded — start live mode to see the current war blocs and alliance clusters."
              : "No decoded diplomacy matrix in this save (the N×N attitude matrix was not located)."}
          </div>
        ) : (
          <>
            {/* controls + legend */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "8px 16px" }}>
              <label style={{ fontSize: "0.78rem", color: "#bbb" }}>Order:{" "}
                <select value={ordering} onChange={(e) => setOrdering(e.target.value)}
                  style={{ background: "rgba(255,255,255,0.07)", color: "#eee", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 5, padding: "2px 6px", fontSize: "0.78rem" }}>
                  <option value="alphabetical">Alphabetical</option>
                  <option value="culture">Culture group</option>
                  <option value="wars">Most wars</option>
                </select>
              </label>
              {aliveSignal && (
                <label style={{ fontSize: "0.78rem", color: "#bbb", cursor: "pointer" }}
                  title="Only factions that have a diplomacy zone in the loaded save (the per-save liveness signal). Untick to show every faction the matrix decodes.">
                  <input type="checkbox" checked={aliveOnly} onChange={(e) => setAliveOnly(e.target.checked)} style={{ verticalAlign: "middle", marginRight: 4 }} />
                  alive only
                </label>
              )}
              <span style={{ marginLeft: "auto", display: "flex", gap: 10, fontSize: "0.72rem", color: "#aaa", flexWrap: "wrap" }}>
                {["war", "allied", "trade", "protectorate", "hostile", "neutral"].map((s) => (
                  <span key={s}><span style={{ display: "inline-block", width: 10, height: 10, background: STATE_COLORS[s], borderRadius: 2, marginRight: 4, verticalAlign: "middle", border: s === "neutral" ? "1px solid rgba(255,255,255,0.15)" : "none" }} />{s}</span>
                ))}
              </span>
            </div>

            {/* grid */}
            <div style={{ overflow: "auto", padding: "0 16px 12px", flex: 1 }}>
              {n === 0 && (
                <div style={{ color: "#98938a", fontSize: "0.82rem", padding: "18px 4px" }}>
                  No factions to show{aliveOnly && aliveSignal ? " — the alive-only filter removed every faction; untick it to see the full matrix." : "."}
                </div>
              )}
              <canvas ref={canvasRef}
                style={{ width: W, height: H, display: "block", cursor: "crosshair", borderRadius: 6 }}
                onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
              {!showLabels && (
                <div style={{ fontSize: "0.7rem", color: "#877", marginTop: 4 }}>
                  {n} factions — axis labels hidden at this density; hover any cell for the pair.
                </div>
              )}
            </div>

            {/* tooltip */}
            {hoverInfo && hover && (
              <div style={{ position: "fixed", left: Math.min(hover.x + 14, vw - 280), top: Math.min(hover.y + 14, vh - 40), zIndex: 9992, pointerEvents: "none", background: "rgba(15,13,10,0.96)", border: `1px solid ${hoverInfo.color}`, borderRadius: 6, padding: "4px 9px", fontSize: "0.78rem", color: "#f0ece4", boxShadow: "0 4px 14px rgba(0,0,0,0.5)", whiteSpace: "nowrap" }}>
                {hoverInfo.text}
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
