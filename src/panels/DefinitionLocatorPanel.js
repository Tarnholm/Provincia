// Definition Locator panel (2026-07-16). "Where is this defined?" — type an
// entity name (unit, building, region, settlement, faction, trait, resource,
// text token) and list every mod-file line that defines or references it,
// grouped by kind. Clicking a row opens the file in the user's editor at
// that line via the existing openSourceFile preload bridge (main.js
// "open-source-file" already supports Notepad++ `-n<line>` line jumps).
// Presentational + self-contained: only { modDataDir, initialQuery, onClose }
// come from the caller. Dark inline styling matches ArmySetupModal.
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const KIND_ORDER = [
  "edu-type", "edb-building", "edb-recruit", "regions-region",
  "strat-settlement", "strat-resource", "trait", "text-string", "generic",
];
const KIND_LABEL = {
  "edu-type": "Unit types (export_descr_unit)",
  "edb-building": "Buildings & levels (export_descr_buildings)",
  "edb-recruit": "Recruitment (export_descr_buildings)",
  "regions-region": "Regions & cities (descr_regions)",
  "strat-settlement": "Settlements (descr_strat)",
  "strat-resource": "Resources (descr_strat)",
  "trait": "Traits (export_descr_character_traits)",
  "text-string": "Text strings (text/*.txt)",
  "generic": "Other references",
};
const KIND_COLOR = {
  "edu-type": "#9fb6e8", "edb-building": "#e8c873", "edb-recruit": "#d8b05a",
  "regions-region": "#9ed6ad", "strat-settlement": "#8fd0c8", "strat-resource": "#c8a2e0",
  "trait": "#e0a2a2", "text-string": "#b8c8d8", "generic": "#9aa",
};

export default function DefinitionLocatorPanel({ modDataDir, initialQuery, onClose }) {
  const [query, setQuery] = useState(initialQuery || "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { query, kindGuesses, hits, truncated, elapsedMs } | { error }
  const inputRef = useRef(null);
  const seqRef = useRef(0);

  const runSearch = async (q) => {
    const qq = (q ?? query).trim();
    if (!qq || !modDataDir) return;
    const seq = ++seqRef.current;
    setBusy(true);
    try {
      const api = window.electronAPI || {};
      if (typeof api.locateDefinition !== "function") {
        setResult({ error: "locate-definition IPC unavailable (preload bridge missing?)" });
        return;
      }
      const r = await api.locateDefinition(modDataDir, qq);
      if (seqRef.current === seq) setResult(r || { error: "no result" });
    } catch (e) {
      if (seqRef.current === seq) setResult({ error: e?.message || String(e) });
    } finally {
      if (seqRef.current === seq) setBusy(false);
    }
  };

  useEffect(() => {
    inputRef.current?.focus();
    if (initialQuery && initialQuery.trim()) runSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openHit = (h) => {
    try { window.electronAPI?.openSourceFile?.(h.file, h.line); } catch {}
  };

  // Group hits by kind, in KIND_ORDER (unknown kinds last).
  const groups = [];
  if (result && !result.error && Array.isArray(result.hits)) {
    const byKind = new Map();
    for (const h of result.hits) {
      if (!byKind.has(h.kind)) byKind.set(h.kind, []);
      byKind.get(h.kind).push(h);
    }
    const orderOf = (k) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? KIND_ORDER.length : i; };
    for (const k of [...byKind.keys()].sort((a, b) => orderOf(a) - orderOf(b))) {
      groups.push({ kind: k, hits: byKind.get(k) });
    }
  }
  const isFuzzy = !!(result && !result.error && result.hits && result.hits.length && result.hits[0].fuzzy);

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(820px, 96vw)", maxHeight: "84vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 14px 8px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#cf8f6a" }}>⌖ Where is this defined?</span>
          <span style={{ fontSize: "0.7rem", color: "#8aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>{modDataDir || "(no mod dir)"}</span>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch(); if (e.key === "Escape") onClose?.(); }}
            placeholder="unit type, building, region, settlement, faction, trait, resource, {text_token}…"
            spellCheck={false}
            style={{ flex: 1, background: "rgba(255,255,255,0.07)", color: "#eee", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6, padding: "5px 10px", fontSize: "0.85rem" }}
          />
          <button
            onClick={() => runSearch()}
            disabled={busy || !query.trim()}
            style={{ background: "rgba(60,60,60,0.7)", color: "#e8c873", border: "1px solid #a08a4a", borderRadius: 5, padding: "4px 14px", cursor: busy ? "default" : "pointer", fontSize: "0.8rem", opacity: busy || !query.trim() ? 0.6 : 1 }}>
            {busy ? "Searching…" : "Locate"}
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "0 14px 10px" }}>
          {!result && !busy && (
            <div style={{ color: "#889", fontSize: "0.78rem", padding: "18px 4px" }}>
              Type a name and press Enter. Whole-word matches are shown when found; otherwise substring matches (marked ~fuzzy). Click a row to open the file in your editor at that line.
            </div>
          )}
          {result && result.error && (
            <div style={{ color: "#e8a090", fontSize: "0.78rem", padding: "12px 4px" }}>⚠ {String(result.error)}</div>
          )}
          {result && !result.error && (
            <div style={{ fontSize: "0.72rem", color: "#8aa", padding: "4px 2px 8px" }}>
              {result.hits.length} hit{result.hits.length === 1 ? "" : "s"} for “{result.query}”
              {isFuzzy && <span style={{ color: "#d8b05a" }}> (no whole-word match — showing substring matches)</span>}
              {result.truncated && <span style={{ color: "#e8a090" }}> — capped at 200</span>}
              {typeof result.elapsedMs === "number" && <span> · {result.elapsedMs} ms</span>}
              {result.kindGuesses && result.kindGuesses.length > 0 && (
                <span> · likely: {result.kindGuesses.slice(0, 3).map((k) => KIND_LABEL[k] ? KIND_LABEL[k].split(" (")[0] : k).join(", ")}</span>
              )}
            </div>
          )}
          {result && !result.error && result.hits.length === 0 && (
            <div style={{ color: "#889", fontSize: "0.78rem", padding: "8px 4px" }}>Nothing found — check spelling, or try a shorter fragment for a fuzzy match.</div>
          )}
          {groups.map((g) => (
            <div key={g.kind} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: "0.76rem", color: KIND_COLOR[g.kind] || "#9aa", padding: "4px 2px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {KIND_LABEL[g.kind] || g.kind} <span style={{ color: "#778", fontWeight: 400 }}>({g.hits.length})</span>
              </div>
              {g.hits.map((h, i) => (
                <div
                  key={g.kind + ":" + i}
                  onClick={() => openHit(h)}
                  title={h.file + ":" + h.line + " — click to open in editor"}
                  style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "3px 4px", cursor: "pointer", borderRadius: 4, background: i % 2 ? "rgba(255,255,255,0.025)" : "transparent" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(232,200,115,0.10)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = i % 2 ? "rgba(255,255,255,0.025)" : "transparent"; }}>
                  <span style={{ fontSize: "0.7rem", color: "#8aa", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {h.rel}<span style={{ color: "#e8c873" }}>:{h.line}</span>
                  </span>
                  <span style={{ fontSize: "0.74rem", color: "#ddd", fontFamily: "Consolas, 'Courier New', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {h.preview}
                  </span>
                  {h.fuzzy && <span style={{ fontSize: "0.66rem", color: "#d8b05a", flexShrink: 0 }}>~fuzzy</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
