// Faction Chronicle panel (📜, 2026-08-06) — pick a faction and read an AI
// test run as a story instead of grepping a 50MB log. The heavy lifting is
// main-process: src/factionChronicle.js streams campaign_ai_log.txt in the
// crack worker (chronicle-campaign-log IPC) and returns per-faction turns with
// English lines already narrated. This panel adds the battle side: it reads
// message_log.txt from the same folder (chronicle-read-message-log — the
// offset-safe read) through src/battleLedger.js and merges battles, sieges and
// settlement captures into the matching turns by GLOBAL session turn (the
// chronicle's `g` field ↔ the ledger's end-round ordinal).
//
// Dark inline styling mirrors src/panels/CampaignAutopsyPanel.js.
//
// Props:
//   defaultLogDir       live log folder if known (one-click "Read live log")
//   factionDisplayNames { tag: "Display Name" } (passed to the worker so the
//                       narration itself uses proper names)
//   onClose             () => void
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createLedger } from "../battleLedger";

const KINDS = {
  status:    { icon: "⚖",  color: "#9aa6b2", label: "Status" },
  economy:   { icon: "💰", color: "#8fd18f", label: "Economy" },
  war:       { icon: "⚔",  color: "#e07a6a", label: "War/peace" },
  peace:     { icon: "🕊", color: "#9fb8d8", label: "War/peace" },
  invade:    { icon: "🗡", color: "#e0a860", label: "Invasion plans" },
  defend:    { icon: "🛡", color: "#8fc9d8", label: "Defence" },
  military:  { icon: "⚑",  color: "#c9a0dc", label: "Military" },
  build:     { icon: "🏗", color: "#d8c088", label: "Construction" },
  recruit:   { icon: "🎖", color: "#d8b88f", label: "Recruitment" },
  diplomacy: { icon: "📜", color: "#c9b8e0", label: "Diplomacy" },
  orders:    { icon: "➤",  color: "#7a8894", label: "Orders" },
  alert:     { icon: "⚠",  color: "#e8c873", label: "Alerts" },
  battle:    { icon: "⚔",  color: "#f0787a", label: "Battles" },
};
// Filter chips group some kinds together so the bar stays short.
const FILTER_GROUPS = [
  { key: "battle",  label: "⚔ Battles",     kinds: ["battle"] },
  { key: "invade",  label: "🗡 Invasions",   kinds: ["invade", "defend"] },
  { key: "war",     label: "🕊 War & peace", kinds: ["war", "peace"] },
  { key: "economy", label: "💰 Economy",     kinds: ["economy"] },
  { key: "build",   label: "🏗 Production",  kinds: ["build", "recruit"] },
  { key: "diplo",   label: "📜 Diplomacy",   kinds: ["diplomacy"] },
  { key: "mil",     label: "⚑ Movements",    kinds: ["military", "orders", "status", "alert"] },
];
const BATTLE_TYPE_LABEL = { field: "field battle", naval: "naval battle", siege_assault: "siege assault", sally: "sally" };

function fmtYear(y) { return y < 0 ? `${-y} BC` : `${y} AD`; }

// battleLedger events for ONE faction, narrated → { turn → [text] }.
function narrateBattles(events, tag, disp) {
  const byTurn = new Map();
  const add = (turn, t) => {
    let a = byTurn.get(turn);
    if (!a) { a = []; byTurn.set(turn, a); }
    a.push(t);
  };
  // snapshot() is newest-first; walk oldest-first so each turn reads in order.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const type = BATTLE_TYPE_LABEL[ev.battleType] || ev.battleType || "battle";
    const loc = ev.location ? ` at ${ev.location}` : "";
    if (ev.kind === "battle") {
      if (ev.winner === tag) add(ev.turn, `Won a ${type} against ${disp(ev.loser)}${loc}`);
      else if (ev.loser === tag) add(ev.turn, `Lost a ${type} to ${disp(ev.winner)}${loc}`);
    } else if (ev.kind === "siege_begun" && ev.faction === tag) {
      add(ev.turn, `Laid siege to ${ev.settlement}${ev.general ? ` under ${ev.general}` : ""}`);
    } else if (ev.kind === "assault_captured" || ev.kind === "settlement_captured") {
      const how = ev.kind === "assault_captured" ? " by storm" : "";
      if (ev.winner === tag) add(ev.turn, `Captured ${ev.settlement} from ${disp(ev.loser)}${how}`);
      else if (ev.loser === tag) add(ev.turn, `LOST ${ev.settlement} to ${disp(ev.winner)}${how}`);
    } else if (ev.kind === "army_destroyed") {
      if (ev.faction === tag) add(ev.turn, `Army of ${ev.commanderName} was destroyed${ev.destroyedBy ? ` by ${disp(ev.destroyedBy)}` : ""}`);
      else if (ev.destroyedBy === tag) add(ev.turn, `Destroyed ${disp(ev.faction)}'s army under ${ev.commanderName}`);
    }
  }
  return byTurn;
}

export default function FactionChroniclePanel({ defaultLogDir, factionDisplayNames, onClose }) {
  const [result, setResult] = useState(null);
  const [battleEvents, setBattleEvents] = useState(null); // full ledger event feed (all factions)
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [faction, setFaction] = useState(() => {
    try { return localStorage.getItem("chronicleFaction") || ""; } catch { return ""; }
  });
  const [off, setOff] = useState(() => new Set()); // disabled filter-group keys
  const [newestFirst, setNewestFirst] = useState(true);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);

  useEffect(() => {
    const offP = window.electronAPI?.onChronicleProgress?.((p) => setProgress(p));
    return () => { if (typeof offP === "function") offP(); if (copiedTimer.current) clearTimeout(copiedTimer.current); };
  }, []);
  useEffect(() => {
    try { if (faction) localStorage.setItem("chronicleFaction", faction); } catch { /* ignore */ }
  }, [faction]);

  const disp = (tag) => (factionDisplayNames && factionDisplayNames[tag]) || String(tag || "?").replace(/_/g, " ");

  const run = async (logPathOrDir) => {
    setBusy(true); setError(null); setProgress(null);
    try {
      const r = await window.electronAPI.chronicleCampaignLog(logPathOrDir || null, factionDisplayNames || {});
      if (r && r.canceled) { setBusy(false); return; }
      if (!r || r.error) { setError((r && r.error) || "chronicle failed"); setBusy(false); return; }
      setResult(r);
      if (!r.factions.some((f) => f.tag === faction)) setFaction(r.factions[0]?.tag || "");
      // Battle side: message_log.txt from the same folder, through battleLedger.
      setBattleEvents(null);
      const dir = r.logPath ? r.logPath.replace(/[\\/][^\\/]*$/, "") : null;
      const ml = dir ? await window.electronAPI.chronicleReadMessageLog?.(dir) : null;
      if (ml && ml.text) {
        // High event cap: the default 500 is a live-ticker budget and a real
        // session exceeds it within ~16 turns — the chronicle needs the whole run.
        const ledger = createLedger({ maxEvents: 50000 });
        ledger.ingest(ml.text);
        setBattleEvents(ledger.snapshot().events);
      }
    } catch (e) { setError(e?.message || String(e)); }
    setBusy(false); setProgress(null);
  };

  const offKinds = useMemo(() => {
    const s = new Set();
    for (const g of FILTER_GROUPS) if (off.has(g.key)) for (const k of g.kinds) s.add(k);
    return s;
  }, [off]);

  const battlesByTurn = useMemo(
    () => (battleEvents && faction ? narrateBattles(battleEvents, faction, disp) : new Map()),
    [battleEvents, faction, factionDisplayNames] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // The rendered chronicle: one entry per turn, chronicle lines + battle lines.
  const turns = useMemo(() => {
    if (!result || !faction) return [];
    const src = result.turnsByFaction[faction] || [];
    const out = [];
    for (const t of src) {
      const lines = [];
      for (const b of battlesByTurn.get(t.g) || []) lines.push({ k: "battle", t: b });
      for (const l of t.lines) if (!offKinds.has(l.k)) lines.push(l);
      out.push({ ...t, lines: offKinds.has("battle") ? lines.filter((l) => l.k !== "battle") : lines });
    }
    return newestFirst ? out.slice().reverse() : out;
  }, [result, faction, battlesByTurn, offKinds, newestFirst]);

  const shownTurns = useMemo(() => turns.filter((t) => t.lines.length > 0), [turns]);

  const copyText = async () => {
    const fac = result.factions.find((f) => f.tag === faction);
    const parts = [`# Chronicle of ${disp(faction)}${result.logPath ? ` — ${result.logPath.split(/[\\/]/).pop()}` : ""}`];
    for (const t of shownTurns) {
      parts.push(`\n## Turn ${t.g} — ${t.season} ${fmtYear(t.year)}`);
      for (const l of t.lines) parts.push(`- ${(KINDS[l.k] || {}).icon || "•"} ${l.t}`);
    }
    if (fac) parts.push(`\n(${fac.turns} turns chronicled · ${fac.invades} invasion decisions · ${fac.builds} buildings · ${fac.recruits} recruitments)`);
    try {
      await navigator.clipboard.writeText(parts.join("\n"));
      setCopied(true);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard denied */ }
  };

  const close = () => onClose && onClose();
  const btn = (extra) => ({ background: "rgba(60,60,60,0.7)", color: "#e8c873", border: "1px solid #a08a4a", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: "0.78rem", ...extra });

  return createPortal(
    <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(860px, 96vw)", height: "min(760px, 92vh)", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#d8c8a0" }}>
            📜 Faction Chronicle
            {result && !busy && (
              <span style={{ color: "#9ab", fontWeight: 400, fontSize: "0.78rem", marginLeft: 10 }}>
                — {result.logPath ? result.logPath.split(/[\\/]/).pop() : ""} · {result.factions.length} factions
                {battleEvents ? "" : " · no message_log found (battles omitted)"}
              </span>
            )}
          </span>
          <button onClick={close} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", padding: "8px 16px" }}>
          {defaultLogDir && (
            <button onClick={() => run(defaultLogDir)} disabled={busy} style={btn({ opacity: busy ? 0.6 : 1 })}>
              {busy ? (progress || "Reading…") : "Read live log"}
            </button>
          )}
          <button onClick={() => run(null)} disabled={busy} style={btn({ color: "#cfe0d0", borderColor: "#5a7a5a", opacity: busy ? 0.6 : 1 })}>Pick log…</button>
          {result && (
            <>
              <select value={faction} onChange={(e) => setFaction(e.target.value)}
                style={{ background: "#2a241e", color: "#f0e8d8", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 8px", fontSize: "0.8rem", maxWidth: 240 }}>
                {result.factions.map((f) => (
                  <option key={f.tag} value={f.tag}>{f.display} ({f.turns}t · {f.invades} inv)</option>
                ))}
              </select>
              <label style={{ fontSize: "0.72rem", color: "#9ab", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input type="checkbox" checked={newestFirst} onChange={(e) => setNewestFirst(e.target.checked)} /> newest first
              </label>
              <button onClick={copyText} style={btn({ color: "#b8d8e8", borderColor: "#5a7a8a" })}>{copied ? "Copied ✓" : "Copy as text"}</button>
            </>
          )}
        </div>

        {/* Filter chips */}
        {result && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            {FILTER_GROUPS.map((g) => {
              const on = !off.has(g.key);
              return (
                <button key={g.key}
                  onClick={() => setOff((prev) => { const n = new Set(prev); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}
                  style={{ background: on ? "rgba(232,200,115,0.12)" : "rgba(40,40,40,0.6)", color: on ? "#e8d8b0" : "#667", border: `1px solid ${on ? "#a08a4a" : "#3a3a3a"}`, borderRadius: 12, padding: "2px 10px", cursor: "pointer", fontSize: "0.7rem" }}>
                  {g.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Body */}
        <div style={{ overflow: "auto", padding: "10px 16px", flex: 1 }}>
          {!result && !busy && (
            <div style={{ textAlign: "center", padding: "40px 12px", color: "#9ab", fontSize: "0.86rem", lineHeight: 1.6, maxWidth: 520, margin: "0 auto" }}>
              Read a <b>campaign_ai_log.txt</b> and follow one faction through the whole run, translated to
              plain English — what it decided to invade and why, its finances, what it built and recruited,
              who it sent diplomats to — with battles, sieges and captured settlements merged in from the
              folder's message_log.txt.
              {error && <div style={{ color: "#e8a090", fontSize: "0.78rem", marginTop: 14 }}>⚠ {String(error)}</div>}
            </div>
          )}
          {busy && <div style={{ textAlign: "center", padding: "40px 12px", color: "#9ab", fontSize: "0.84rem" }}>{progress || "Reading the campaign log…"}</div>}
          {result && error && <div style={{ padding: "12px", color: "#e8a090", fontSize: "0.8rem" }}>⚠ {String(error)}</div>}

          {result && !busy && faction && shownTurns.length === 0 && (
            <div style={{ textAlign: "center", padding: "30px 12px", color: "#9ab", fontSize: "0.82rem" }}>
              Nothing to show for {disp(faction)} with the current filters.
            </div>
          )}

          {result && !busy && shownTurns.map((t) => (
            <div key={t.g} style={{ marginBottom: 10, border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
              <div style={{ padding: "5px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", color: "#e8c873", fontSize: "0.76rem", fontWeight: 700 }}>
                Turn {t.g} <span style={{ color: "#9ab", fontWeight: 400 }}>— {t.season} {fmtYear(t.year)}</span>
              </div>
              <div style={{ padding: "6px 10px" }}>
                {t.lines.map((l, i) => {
                  const meta = KINDS[l.k] || { icon: "•", color: "#9aa" };
                  return (
                    <div key={i} style={{ display: "flex", gap: 8, padding: "1.5px 0", fontSize: "0.78rem", lineHeight: 1.45 }}>
                      <span style={{ width: 18, textAlign: "center", flexShrink: 0 }}>{meta.icon}</span>
                      <span style={{ color: l.k === "battle" ? meta.color : "#d8dde2" }}>{l.t}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
