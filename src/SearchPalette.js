// src/SearchPalette.js
//
// 0.9.x: Cmd+K / Ctrl+K "search everywhere" palette.
//
// A portaled, centered modal overlay with backdrop blur. The parent
// (App.js) toggles `open`; this component owns the query text, the
// keyboard-navigable result list, and the activation dispatch.
//
// Sources are passed in by App.js as an array of:
//   { type, id, label, subtitle, payload }
// where `type` is one of "region" | "faction" | "character" | "building" | "unit".
// `payload` is whatever the activator needs to jump (region obj, faction id,
// character record, building meta, unit meta).
//
// Fuzzy matcher: simple subsequence + score, no dependency. Score is
// lower-is-better:
//   - prefix match → bonus
//   - tighter character span → bonus
//   - shorter target → bonus
//   - alphabetical for tie-break
//
// Logging directive: every open/close/query/activation writes a
// bracketed [search-palette] line so flows are debuggable from
// provincia.log without re-running.
//
// Animation: `data-anim-id="search-palette"` + useEnterExit with
// defaultMount="popover-in" so the overlay fades in nicely. The root
// carries `data-anim-bypass` so the layout-mode click-interceptor
// doesn't swallow the input or row clicks.

"use strict";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEnterExit } from "./AnimationLayout";

// Type-badge colors. Picked to match colors used elsewhere in the app
// (homeland chip green, faction gold, etc.) — see spec.
const TYPE_BADGE_COLORS = {
  region:    "#4a9",
  faction:   "#c8a85a",
  character: "#c896d8",
  building:  "#9fc78a",
  unit:      "#88c2e0",
};

const TYPE_BADGE_LABELS = {
  region:    "REGION",
  faction:   "FACTION",
  character: "CHARACTER",
  building:  "BUILDING",
  unit:      "UNIT",
};

// Type priority for tie-breaking when scores are equal. Regions and
// factions are higher-value navigation targets than units / buildings,
// so they bubble up when a query matches several types equally.
const TYPE_PRIORITY = {
  region:    0,
  faction:   1,
  character: 2,
  building:  3,
  unit:      4,
};

const MAX_VISIBLE = 12;

/**
 * Score `target` against `query`. Both should be lowercase before
 * calling. Returns null if `query` is not a subsequence of `target`.
 * Lower score = better match. Hot path; keep allocation-free.
 */
function scoreMatch(target, query) {
  if (!query) return 0;
  if (!target) return null;
  const tlen = target.length;
  const qlen = query.length;
  if (qlen > tlen) return null;

  // Walk query chars through target. Track first match index and
  // span (last - first) to penalize widely-spaced matches.
  let ti = 0;
  let qi = 0;
  let first = -1;
  let last = -1;
  while (ti < tlen && qi < qlen) {
    if (target.charCodeAt(ti) === query.charCodeAt(qi)) {
      if (first < 0) first = ti;
      last = ti;
      qi++;
    }
    ti++;
  }
  if (qi < qlen) return null;

  // Base = span + first-offset penalty. Span = last - first.
  const span = last - first;
  let score = span * 4 + first * 2;
  // Length tiebreaker — shorter is better but de-emphasized.
  score += tlen * 0.1;
  // Prefix-match bonus.
  if (target.startsWith(query)) score -= 25;
  // Word-boundary bonus: if the query's first char matches the first
  // char after a space/underscore/dash, prefer that.
  if (first > 0) {
    const prev = target.charCodeAt(first - 1);
    if (prev === 32 || prev === 95 || prev === 45) score -= 6;
  }
  return score;
}

/**
 * Filter & rank sources. Returns up to MAX_VISIBLE entries.
 */
function rankSources(sources, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) {
    // Empty query — show nothing (see empty-state copy in render).
    return [];
  }
  const out = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (!s || !s.label) continue;
    const lbl = String(s.label).toLowerCase();
    const score = scoreMatch(lbl, q);
    if (score == null) continue;
    out.push({ src: s, score });
  }
  out.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const pa = TYPE_PRIORITY[a.src.type] ?? 9;
    const pb = TYPE_PRIORITY[b.src.type] ?? 9;
    if (pa !== pb) return pa - pb;
    return String(a.src.label).localeCompare(String(b.src.label));
  });
  return out.slice(0, MAX_VISIBLE).map((x) => x.src);
}

function Badge({ type }) {
  const color = TYPE_BADGE_COLORS[type] || "#888";
  return (
    <span style={{
      display: "inline-block",
      minWidth: 64,
      textAlign: "center",
      padding: "2px 6px",
      borderRadius: 3,
      fontSize: "0.6rem",
      fontWeight: 700,
      letterSpacing: "0.06em",
      background: "rgba(0,0,0,0.35)",
      color,
      border: `1px solid ${color}55`,
      fontFamily: "ui-monospace, monospace",
    }}>
      {TYPE_BADGE_LABELS[type] || type.toUpperCase()}
    </span>
  );
}

export default function SearchPalette({ open, onClose, sources, onActivate }) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const rootRef = useRef(null);

  const { shouldRender } = useEnterExit(!!open, rootRef, "search-palette", {
    defaultMount: "popover-in",
  });

  // Log open/close transitions so flows are visible in provincia.log
  // per the standing logging directive.
  useEffect(() => {
    if (open) console.log("[search-palette] open");
    else if (!open) console.log("[search-palette] closed");
  }, [open]);

  // Reset query + selection whenever the palette is reopened. Also
  // autofocus the input on mount.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIdx(0);
    // Defer focus a tick so the portal child is mounted in the DOM.
    const t = setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 10);
    return () => clearTimeout(t);
  }, [open]);

  const results = useMemo(() => {
    const ranked = rankSources(sources || [], query);
    if (query.trim()) {
      console.log(`[search-palette] query="${query}" → ${ranked.length} results`);
    }
    return ranked;
  }, [sources, query]);

  // Clamp activeIdx when results shrink.
  useEffect(() => {
    if (activeIdx >= results.length) setActiveIdx(0);
  }, [results, activeIdx]);

  // Scroll the active row into view when arrow keys move past the
  // visible window. Cheap — only fires on keypress.
  useEffect(() => {
    if (!listRef.current) return;
    const row = listRef.current.querySelector(`[data-row-idx="${activeIdx}"]`);
    if (row && row.scrollIntoView) {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  function activate(src) {
    if (!src) return;
    console.log(`[search-palette] activated ${src.type}:${src.label}`);
    try { onActivate?.(src); } catch (e) {
      console.warn("[search-palette] activate error:", e);
    }
    onClose?.();
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(results[activeIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose?.();
    }
  }

  if (!shouldRender) return null;

  const trimmed = query.trim();

  const overlay = (
    <div
      ref={rootRef}
      data-anim-id="search-palette"
      data-anim-bypass
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 12500,
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
      onMouseDown={(e) => {
        // Click on backdrop closes; clicks inside the panel are
        // stopped before they reach this handler.
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        data-anim-bypass
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: "92vw",
          background: "rgba(22,24,30,0.97)",
          color: "#eee",
          borderRadius: 10,
          border: "1px solid rgba(220,166,74,0.35)",
          boxShadow: "0 18px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: "inherit",
        }}
      >
        {/* Input row */}
        <div style={{
          padding: "12px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ color: "#dca64a", fontSize: "0.85rem", fontWeight: 700 }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search regions, factions, characters, buildings, units…"
            spellCheck={false}
            autoComplete="off"
            data-anim-bypass
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#eee",
              fontSize: "1rem",
              fontFamily: "inherit",
              padding: "2px 0",
            }}
          />
          <span style={{
            fontSize: "0.62rem",
            color: "#888",
            fontFamily: "ui-monospace, monospace",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 3,
            padding: "1px 5px",
          }}>ESC</span>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          style={{
            maxHeight: 12 * 44, // ~12 rows at 44px each
            overflowY: "auto",
            padding: "4px 0",
          }}
        >
          {results.length === 0 && (
            <div style={{
              padding: "22px 18px",
              color: "#888",
              fontSize: "0.82rem",
              textAlign: "center",
            }}>
              {trimmed
                ? `No matches for "${trimmed}"`
                : "Start typing to search…"}
            </div>
          )}
          {results.map((r, i) => {
            const isActive = i === activeIdx;
            return (
              <div
                key={`${r.type}:${r.id}:${i}`}
                data-row-idx={i}
                data-anim-bypass
                onMouseDown={(e) => { e.preventDefault(); activate(r); }}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 14px",
                  cursor: "pointer",
                  background: isActive ? "rgba(220,166,74,0.13)" : "transparent",
                  borderLeft: isActive
                    ? "3px solid #dca64a"
                    : "3px solid transparent",
                  transition: "background 0.08s",
                }}
              >
                <Badge type={r.type} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: "0.88rem",
                    color: "#eee",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>{r.label}</div>
                  {r.subtitle && (
                    <div style={{
                      fontSize: "0.7rem",
                      color: "#999",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>{r.subtitle}</div>
                  )}
                </div>
                {isActive && (
                  <span style={{
                    fontSize: "0.6rem",
                    color: "#dca64a",
                    fontFamily: "ui-monospace, monospace",
                    border: "1px solid rgba(220,166,74,0.45)",
                    borderRadius: 3,
                    padding: "1px 5px",
                  }}>↵</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: "6px 14px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: "0.65rem",
          color: "#777",
          display: "flex", justifyContent: "space-between",
          fontFamily: "ui-monospace, monospace",
        }}>
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span>{results.length > 0 ? `${results.length} of ${(sources || []).length}` : `${(sources || []).length} indexed`}</span>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
