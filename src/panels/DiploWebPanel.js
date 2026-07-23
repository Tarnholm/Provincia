// Diplomacy Web (🕸, 2026-07-24) — force-directed graph of the live diplomacy
// matrix. Nodes = factions (faction colour, sized by connection count), edges
// = pair states from the same buildHeatmapModel the heatmap uses: war red,
// allied green, protectorate purple, trade blue, hostile amber (dashed).
// War blocs and alliance clusters literally pull together on screen.
// Interactions: hover = tooltip, click = focus a faction (dims non-neighbours,
// relation list below), drag = reposition, edge-type toggles, alive-only.
// Canvas-rendered like DiploHeatmapPanel (RIS live matrices are ~220 factions).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildHeatmapModel } from "../diploHeatmap";

const STATE_COLORS = {
  war: "#d05858", allied: "#69b563", protectorate: "#9a6fd0",
  trade: "#5b8fd0", hostile: "#c9924a",
};
const STATE_WIDTHS = { war: 1.7, allied: 1.4, protectorate: 1.3, trade: 0.8, hostile: 0.9 };
const EDGE_STATES = ["war", "allied", "protectorate", "trade", "hostile"];

export default function DiploWebPanel({
  diplomacyMatrix,
  allFactionDiplomacy,
  factionDisplayNames,
  factionCultures,
  factionColors,
  liveActive,
  onClose,
}) {
  const [aliveOnly, setAliveOnly] = useState(true);
  const [show, setShow] = useState(() => new Set(EDGE_STATES));
  const [selected, setSelected] = useState(null);   // faction id | null
  const [hover, setHover] = useState(null);         // { id, x, y } | null
  const [query, setQuery] = useState("");
  const [, setTick] = useState(0);                  // re-render after drag
  const canvasRef = useRef(null);
  const posRef = useRef(null);                      // Map id → {x,y} (mutable: drag)
  const dragRef = useRef(null);                     // { id } while dragging

  const model = useMemo(() => buildHeatmapModel({
    diplomacyMatrix, allFactionDiplomacy, factionCultures,
    aliveOnly, displayNames: factionDisplayNames,
  }), [diplomacyMatrix, allFactionDiplomacy, factionCultures, aliveOnly, factionDisplayNames]);

  const label = (id) => (factionDisplayNames && (factionDisplayNames[id] || factionDisplayNames[String(id).toLowerCase()])) || String(id).replace(/_/g, " ");
  const facColor = (id) => {
    const fc = factionColors && (factionColors[String(id).toLowerCase()] || factionColors[id]);
    const p = fc && fc.primary;
    return Array.isArray(p) ? `rgb(${p[0]},${p[1]},${p[2]})` : "#8a8a8a";
  };

  // ── graph: nodes with a diplomatic presence + typed edges ──
  const graph = useMemo(() => {
    const ids = model.orders ? model.orders.culture : [];
    const edges = [];
    const deg = {};
    for (const [key, cell] of Object.entries(model.cells || {})) {
      if (!cell || cell.state === "neutral") continue;
      const [a, b] = key.split("|");
      edges.push({ a, b, state: cell.state });
      deg[a] = (deg[a] || 0) + 1; deg[b] = (deg[b] || 0) + 1;
    }
    // keep only factions with at least one relation — isolated dots are noise
    const nodes = ids.filter((id) => deg[id]);
    return { nodes, edges, deg };
  }, [model]);

  // ── canvas geometry ──
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const W = Math.max(560, Math.min(vw * 0.9, 1180)) - 40;
  const H = Math.max(420, Math.min(vh * 0.82, 900)) - 190;

  // ── force layout (synchronous Fruchterman-Reingold, culture-circle seed) ──
  useMemo(() => {
    const { nodes, edges } = graph;
    const n = nodes.length;
    const pos = new Map();
    if (!n) { posRef.current = pos; return; }
    const idx = new Map(nodes.map((id, i) => [id, i]));
    const px = new Float64Array(n), py = new Float64Array(n);
    for (let i = 0; i < n; i++) {          // culture-sorted circle = clustered start
      const a = (i / n) * Math.PI * 2;
      px[i] = W / 2 + Math.cos(a) * (Math.min(W, H) * 0.38);
      py[i] = H / 2 + Math.sin(a) * (Math.min(W, H) * 0.38);
    }
    const E = edges.map((e) => [idx.get(e.a), idx.get(e.b), e.state === "war" || e.state === "allied" || e.state === "protectorate" ? 1.0 : 0.45])
      .filter((e) => e[0] != null && e[1] != null);
    const K = Math.sqrt((W * H) / n) * 0.85;
    let temp = Math.min(W, H) * 0.10;
    const dx = new Float64Array(n), dy = new Float64Array(n);
    for (let it = 0; it < 240; it++) {
      dx.fill(0); dy.fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let ex = px[i] - px[j], ey = py[i] - py[j];
          let d2 = ex * ex + ey * ey; if (d2 < 0.01) { ex = Math.random() - 0.5; ey = Math.random() - 0.5; d2 = 0.25; }
          const f = (K * K) / d2;
          dx[i] += ex * f; dy[i] += ey * f; dx[j] -= ex * f; dy[j] -= ey * f;
        }
      }
      for (const [i, j, w] of E) {
        const ex = px[i] - px[j], ey = py[i] - py[j];
        const d = Math.sqrt(ex * ex + ey * ey) || 0.1;
        const f = (d * d) / K * w / d;
        dx[i] -= ex * f; dy[i] -= ey * f; dx[j] += ex * f; dy[j] += ey * f;
      }
      for (let i = 0; i < n; i++) {
        const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 0.1;
        const lim = Math.min(d, temp);
        px[i] += dx[i] / d * lim; py[i] += dy[i] / d * lim;
        // gentle centering + keep on canvas
        px[i] += (W / 2 - px[i]) * 0.004; py[i] += (H / 2 - py[i]) * 0.004;
        px[i] = Math.max(14, Math.min(W - 14, px[i]));
        py[i] = Math.max(14, Math.min(H - 14, py[i]));
      }
      temp *= 0.985;
    }
    for (let i = 0; i < n; i++) pos.set(nodes[i], { x: px[i], y: py[i] });
    posRef.current = pos;
  }, [graph, W, H]);

  const radiusOf = (id) => Math.min(11, 3 + Math.sqrt(graph.deg[id] || 1) * 1.6);
  const neighbours = useMemo(() => {
    if (!selected) return null;
    const s = new Set([selected]);
    for (const e of graph.edges) {
      if (e.a === selected) s.add(e.b);
      if (e.b === selected) s.add(e.a);
    }
    return s;
  }, [selected, graph]);

  // ── draw ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const pos = posRef.current;
    if (!canvas || !pos) return;
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    // edges
    for (const e of graph.edges) {
      if (!show.has(e.state)) continue;
      const pa = pos.get(e.a), pb = pos.get(e.b);
      if (!pa || !pb) continue;
      const focus = neighbours ? (e.a === selected || e.b === selected) : true;
      ctx.globalAlpha = focus ? (e.state === "trade" ? 0.5 : 0.75) : 0.06;
      ctx.strokeStyle = STATE_COLORS[e.state];
      ctx.lineWidth = STATE_WIDTHS[e.state];
      ctx.setLineDash(e.state === "hostile" ? [4, 3] : []);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    // nodes
    const q = query.trim().toLowerCase();
    for (const id of graph.nodes) {
      const p = pos.get(id); if (!p) continue;
      const dim = neighbours && !neighbours.has(id);
      const hit = q && (label(id).toLowerCase().includes(q) || id.includes(q));
      ctx.globalAlpha = dim ? 0.15 : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radiusOf(id), 0, Math.PI * 2);
      ctx.fillStyle = facColor(id);
      ctx.fill();
      ctx.lineWidth = hit ? 2.2 : 1;
      ctx.strokeStyle = hit ? "#ffd24a" : (id === selected ? "#fff" : "rgba(0,0,0,0.55)");
      ctx.stroke();
    }
    // labels: all when small graph, else high-degree + selected neighbourhood + search hits
    ctx.globalAlpha = 1;
    ctx.font = "10px sans-serif";
    const byDeg = [...graph.nodes].sort((a, b) => (graph.deg[b] || 0) - (graph.deg[a] || 0));
    const labelSet = new Set(graph.nodes.length <= 70 ? graph.nodes : byDeg.slice(0, 34));
    if (neighbours) for (const id of neighbours) labelSet.add(id);
    if (q) for (const id of graph.nodes) if (label(id).toLowerCase().includes(q) || id.includes(q)) labelSet.add(id);
    for (const id of labelSet) {
      const p = pos.get(id); if (!p) continue;
      if (neighbours && !neighbours.has(id)) continue;
      const t = label(id);
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillText(t, p.x + radiusOf(id) + 3.6, p.y + 4.0);
      ctx.fillStyle = id === selected ? "#ffd24a" : "#e8e2d4";
      ctx.fillText(t, p.x + radiusOf(id) + 3, p.y + 3.4);
    }
  }, [graph, show, selected, neighbours, query, W, H, hover]);

  // ── mouse: hover / click / drag ──
  const nodeAt = (mx, my) => {
    const pos = posRef.current; if (!pos) return null;
    let best = null, bd = 144;
    for (const id of graph.nodes) {
      const p = pos.get(id); if (!p) continue;
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      const r = radiusOf(id) + 4;
      if (d < r * r && d < bd) { bd = d; best = id; }
    }
    return best;
  };
  const mouse = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { mx: e.clientX - r.left, my: e.clientY - r.top };
  };
  const onMove = (e) => {
    const { mx, my } = mouse(e);
    if (dragRef.current) {
      const p = posRef.current.get(dragRef.current.id);
      if (p) { p.x = Math.max(8, Math.min(W - 8, mx)); p.y = Math.max(8, Math.min(H - 8, my)); setTick((t) => t + 1); }
      return;
    }
    const id = nodeAt(mx, my);
    setHover(id ? { id, x: mx, y: my } : null);
  };
  const onDown = (e) => {
    const { mx, my } = mouse(e);
    const id = nodeAt(mx, my);
    if (id) dragRef.current = { id, moved: false, sx: mx, sy: my };
  };
  const onUp = (e) => {
    const d = dragRef.current; dragRef.current = null;
    if (!d) return;
    const { mx, my } = mouse(e);
    if ((mx - d.sx) ** 2 + (my - d.sy) ** 2 < 16) {
      setSelected((cur) => (cur === d.id ? null : d.id));
    }
  };

  const relsOf = (id) => graph.edges
    .filter((e) => e.a === id || e.b === id)
    .map((e) => ({ other: e.a === id ? e.b : e.a, state: e.state }))
    .sort((x, y) => EDGE_STATES.indexOf(x.state) - EDGE_STATES.indexOf(y.state) || label(x.other).localeCompare(label(y.other)));

  const hasData = graph.nodes.length > 0;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: W + 40, maxWidth: "96vw", maxHeight: "92vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#8fc9d8" }}>🕸 Diplomacy Web</span>
          <span style={{ fontSize: "0.72rem", color: "#888" }}>
            {model.stats ? `${model.stats.wars} wars · ${model.stats.alliances} alliances · ${graph.nodes.length} factions` : ""}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "6px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find faction…"
            style={{ width: 150, padding: "3px 8px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "#f0f0f0", fontSize: "0.78rem", outline: "none" }}
          />
          {EDGE_STATES.map((st) => (
            <label key={st} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem", cursor: "pointer", color: show.has(st) ? "#ddd" : "#777" }}>
              <input
                type="checkbox"
                checked={show.has(st)}
                onChange={() => setShow((prev) => { const n2 = new Set(prev); if (n2.has(st)) n2.delete(st); else n2.add(st); return n2; })}
              />
              <span style={{ width: 14, height: 3, background: STATE_COLORS[st], display: "inline-block", borderRadius: 2 }} />
              {st}
            </label>
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem", cursor: "pointer", marginLeft: "auto" }}>
            <input type="checkbox" checked={aliveOnly} onChange={() => { setAliveOnly((v) => !v); setSelected(null); }} />
            alive only
          </label>
        </div>

        <div style={{ position: "relative", margin: "8px 20px 0" }}>
          {!liveActive && !hasData && (
            <div style={{ padding: 30, color: "#aaa", fontStyle: "italic", textAlign: "center" }}>
              Live mode required — connect a save (Live button) to decode the diplomacy matrix.
            </div>
          )}
          {liveActive && !hasData && (
            <div style={{ padding: 30, color: "#aaa", fontStyle: "italic", textAlign: "center" }}>
              No diplomacy matrix decoded yet — give the live reader a moment.
            </div>
          )}
          {hasData && (
            <canvas
              ref={canvasRef}
              style={{ width: W, height: H, borderRadius: 8, background: "rgba(0,0,0,0.30)", cursor: hover ? "pointer" : "default", display: "block" }}
              onMouseMove={onMove}
              onMouseDown={onDown}
              onMouseUp={onUp}
              onMouseLeave={() => { setHover(null); dragRef.current = null; }}
            />
          )}
          {hover && !dragRef.current && (
            <div style={{ position: "absolute", left: Math.min(hover.x + 12, W - 180), top: hover.y + 10, background: "rgba(15,13,10,0.95)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 8px", fontSize: "0.72rem", pointerEvents: "none", maxWidth: 200 }}>
              <div style={{ fontWeight: 700, color: "#e8d9a0" }}>{label(hover.id)}</div>
              <div style={{ color: "#aaa" }}>{(graph.deg[hover.id] || 0)} relations · click to focus</div>
            </div>
          )}
        </div>

        {selected && (
          <div style={{ padding: "6px 20px 2px", maxHeight: 110, overflowY: "auto" }}>
            <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#e8d9a0", marginBottom: 2 }}>
              {label(selected)} — {relsOf(selected).length} relations
              <span onClick={() => setSelected(null)} style={{ color: "#8fc9d8", cursor: "pointer", marginLeft: 10, fontWeight: 400 }}>clear ✕</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {relsOf(selected).map((r) => (
                <span
                  key={r.other}
                  onClick={() => setSelected(r.other)}
                  title={`${r.state} — click to focus ${label(r.other)}`}
                  style={{ fontSize: "0.7rem", padding: "1px 8px", borderRadius: 8, cursor: "pointer", background: "rgba(255,255,255,0.05)", border: `1px solid ${STATE_COLORS[r.state]}`, color: "#ddd" }}
                >{label(r.other)}</span>
              ))}
            </div>
          </div>
        )}

        <div style={{ padding: "6px 20px 0", fontSize: "0.68rem", color: "#888" }}>
          War blocs pull together; drag nodes to untangle. Node size = number of relations.
        </div>
      </div>
    </div>,
    document.body
  );
}
