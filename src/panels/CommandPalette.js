// Command palette (Ctrl/Cmd-K), extracted from App.js (2026-07-15). The action
// index is built in App.js (its entries close over map/faction/region actions)
// and passed in as `items`; this component owns only the fuzzy filter, scoring,
// keyboard navigation (↑/↓/↵), and rendering. Behavior identical to the inline
// IIFE it replaced.
import React from "react";

const KIND_COLOR = { mode: "#fbbf24", faction: "#a0c4ff", region: "#7fd1b9", action: "#d0a0ff" };

export default function CommandPalette({ items, query, setQuery, selIdx, setSelIdx, onClose }) {
  const idx = items || [];
  // Fuzzy filter: substring (case-insensitive) with simple scoring —
  // prefix > word-boundary > anywhere. Limit to 60 hits for snappiness.
  const q = query.trim().toLowerCase();
  let hits;
  if (!q) {
    // No query → show modes + a few actions first, factions, then regions.
    hits = idx.slice().sort((a, b) => {
      const order = { mode: 0, action: 1, faction: 2, region: 3 };
      return (order[a.kind] - order[b.kind]) || a.label.localeCompare(b.label);
    }).slice(0, 60);
  } else {
    const scored = [];
    for (const e of idx) {
      const ll = e.label.toLowerCase();
      let score;
      if (ll === q) score = 0;
      else if (ll.startsWith(q)) score = 1;
      else if ((` ` + ll).includes(` ` + q)) score = 2;
      else if (ll.includes(q)) score = 3;
      else continue;
      scored.push([score, e.label.length, e]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].label.localeCompare(b[2].label));
    hits = scored.slice(0, 60).map(s => s[2]);
  }
  const sel = Math.max(0, Math.min(selIdx, hits.length - 1));
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 10002, display: "flex", alignItems: "flex-start", justifyContent: "center",
      paddingTop: "12vh",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#1e1e1e", color: "#e6e6e6", borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.10)",
        width: "min(560px, 90vw)", maxHeight: "70vh", overflow: "hidden",
        display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
      }}>
        <input
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSelIdx(i => Math.min(hits.length - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSelIdx(i => Math.max(0, i - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); hits[sel]?.action?.(); }
          }}
          placeholder="Search regions, factions, modes, actions…  (Ctrl-K)"
          style={{
            width: "100%", padding: "12px 14px", background: "#252525", color: "#eee",
            border: "none", outline: "none", fontSize: "0.95rem",
            borderBottom: "1px solid rgba(255,255,255,0.10)",
          }}
        />
        <div style={{ overflowY: "auto", maxHeight: "60vh" }}>
          {hits.length === 0 ? (
            <div style={{ padding: 14, color: "#888", fontStyle: "italic" }}>No matches.</div>
          ) : hits.map((h, i) => (
            <div
              key={`${h.kind}:${h.id}`}
              onMouseEnter={() => setSelIdx(i)}
              onClick={() => h.action?.()}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "7px 14px", fontSize: "0.82rem", cursor: "pointer",
                background: i === sel ? "rgba(255,255,255,0.06)" : "transparent",
                borderLeft: `3px solid ${i === sel ? (KIND_COLOR[h.kind] || "#aaa") : "transparent"}`,
              }}
            >
              <span style={{
                fontSize: "0.62rem", fontWeight: 700, color: KIND_COLOR[h.kind] || "#aaa",
                letterSpacing: "0.05em", textTransform: "uppercase",
                width: 56, flexShrink: 0,
              }}>{h.kind}</span>
              <span style={{ flex: 1, textTransform: h.kind === "region" || h.kind === "faction" ? "capitalize" : "none" }}>{h.label}</span>
              <span style={{ fontSize: "0.68rem", color: "#777" }}>{h.sub}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "6px 14px", fontSize: "0.65rem", color: "#777", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 14 }}>
          <span>↑↓ to move</span><span>↵ to select</span><span>esc to close</span><span style={{ marginLeft: "auto" }}>{hits.length} of {idx.length} indexed</span>
        </div>
      </div>
    </div>
  );
}
