// src/SaveInsightsPanel.js
//
// UI batch 2 (2026-05-31): surfaces four already-cracked-but-unshown save
// datasets in one togglable panel. Pure presentational — all data arrives via
// props from App.js (which gets it from the live save-watch snapshot or the
// on-demand timeline-scan IPC). Honors the project no-fabrication rule: any
// datum a save doesn't supply renders as "—", never a placeholder number.
//
//   1. Last turn        — diffTurn(prevSnapshot.eventLog, thisSnapshot.eventLog)
//                         grouped by type, tagged with faction. "—" with no
//                         prior snapshot (first live load).
//   2. Event schedule   — disaster / scripted-event table; static vs runtime-
//                         random, PENDING flag (dated after the current turn),
//                         eruption warning. "Show on map" toggles markers.
//   3. Campaign timeline— per-turn arc across a scanned saves folder (on-demand).
//   4. AI scouting      — per-faction "scouted N settlements / N tiles" summary.

import React, { useState } from "react";

const SECTION_ORDER = ["lastTurn", "schedule", "timeline", "scouting"];
const SECTION_TITLE = {
  lastTurn: "Last turn",
  schedule: "Event schedule",
  timeline: "Campaign timeline",
  scouting: "AI scouting",
};

// Event-log record class → label + emoji. Mirrors EVENT_CLASS in eventLogParser.
const EVENT_META = {
  marriage: { icon: "💍", label: "Marriage" },
  adoption: { icon: "🧒", label: "Adoption" },
  blockade: { icon: "⚓", label: "Blockade" },
  agent_discovered: { icon: "🕵", label: "Agent discovered" },
  governor_appointed: { icon: "🏛", label: "Governor appointed" },
  settlement_under_siege: { icon: "🛡", label: "Under siege" },
  settlement_lost: { icon: "🔻", label: "Settlement lost" },
  settlement_gained: { icon: "🔺", label: "Settlement gained" },
  natural_death: { icon: "⚰", label: "Death" },
  birth: { icon: "👶", label: "Birth" },
  new_faction_leader: { icon: "👑", label: "New leader" },
  new_faction_heir: { icon: "🎖", label: "New heir" },
  faction_defeated: { icon: "💀", label: "Faction defeated" },
};

// Disaster category → emoji.
const CAT_ICON = {
  historic: "📜", volcano: "🌋", earthquake: "🌍", flood: "🌊",
  storm: "⛈", plague: "☣", locusts: "🦗", riot: "🔥",
  famine: "🍂", fire: "🔥", emergent_faction: "⚔",
};

const fac = (name) => (name ? String(name).replace(/_/g, " ") : "—");
const yearLabel = (y, season) => {
  if (y == null) return "—";
  const base = `${Math.abs(y)} ${y < 0 ? "BC" : "AD"}`;
  return season ? `${base} (${season})` : base;
};

function SectionHeader({ id, open, onToggle, count, accent }) {
  return (
    <button
      onClick={() => onToggle(id)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%", boxSizing: "border-box",
        background: open ? "rgba(220,166,74,0.10)" : "transparent",
        border: "none", borderBottom: "1px solid rgba(255,255,255,0.06)",
        color: accent || "#dca64a", fontWeight: 700, fontSize: "0.82rem",
        padding: "7px 12px", cursor: "pointer", textAlign: "left",
      }}
    >
      <span>{open ? "▾ " : "▸ "}{SECTION_TITLE[id]}</span>
      {count != null && (
        <span style={{ color: "#999", fontWeight: 600, fontSize: "0.72rem" }}>{count}</span>
      )}
    </button>
  );
}

// ── 1. Last-turn summary ─────────────────────────────────────────────────────
function LastTurnSection({ lastTurnEvents }) {
  if (lastTurnEvents == null) {
    return (
      <div style={{ padding: "10px 14px", color: "#9a9a9a", fontSize: "0.78rem" }}>
        — no previous snapshot yet. The first save loaded is the baseline; end a
        turn (or load the next save) and this will list what changed.
      </div>
    );
  }
  if (lastTurnEvents.length === 0) {
    return (
      <div style={{ padding: "10px 14px", color: "#9a9a9a", fontSize: "0.78rem" }}>
        No new events in the elapsed turn.
      </div>
    );
  }
  // Group by type, preserving the EVENT_META display order.
  const byType = {};
  for (const e of lastTurnEvents) (byType[e.type] ||= []).push(e);
  const order = Object.keys(EVENT_META).filter((t) => byType[t]);
  for (const t of Object.keys(byType)) if (!order.includes(t)) order.push(t);
  return (
    <div style={{ padding: "6px 0" }}>
      {order.map((type) => {
        const meta = EVENT_META[type] || { icon: "•", label: type };
        const evs = byType[type];
        return (
          <div key={type} style={{ padding: "2px 12px 6px" }}>
            <div style={{ color: "#cdb98a", fontSize: "0.74rem", fontWeight: 700, marginBottom: 2 }}>
              {meta.icon} {meta.label} <span style={{ color: "#777", fontWeight: 600 }}>×{evs.length}</span>
            </div>
            {evs.slice(0, 30).map((e, i) => (
              <div key={i} style={{ fontSize: "0.74rem", color: "#ddd", paddingLeft: 16, lineHeight: 1.45 }}>
                <span style={{ color: "#e0c98a" }}>{fac(e.faction)}</span>
                {e.subject ? <span style={{ color: "#bbb" }}> — {e.subject}</span> : null}
              </div>
            ))}
            {evs.length > 30 && (
              <div style={{ fontSize: "0.72rem", color: "#777", paddingLeft: 16 }}>…and {evs.length - 30} more</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 2. Event / disaster schedule ─────────────────────────────────────────────
function ScheduleSection({ eventSchedule, currentYear, showMarkers, onToggleMarkers }) {
  if (!eventSchedule || !Array.isArray(eventSchedule.records)) {
    return (
      <div style={{ padding: "10px 14px", color: "#9a9a9a", fontSize: "0.78rem" }}>
        — no scripted-event table located in this save (the descr_events backing
        store wasn't found; some campaigns/mods ship without one).
      </div>
    );
  }
  const recs = eventSchedule.records;
  const positioned = recs.filter((r) => r.x != null && r.y != null).length;
  // PENDING = dated after the current campaign year (we only know the year here;
  // season ties are ambiguous, so this is a year-level "still upcoming" flag).
  const isPending = (r) => currentYear != null && r.year != null && r.year > currentYear;
  // Sort: pending first (by year asc), then historical.
  const sorted = recs.slice().sort((a, b) => {
    const pa = isPending(a) ? 0 : 1, pb = isPending(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return (a.year ?? 0) - (b.year ?? 0);
  });
  return (
    <div style={{ padding: "4px 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 12px 6px" }}>
        <span style={{ fontSize: "0.72rem", color: "#999" }}>
          {recs.length} events · {positioned} positioned · {recs.filter((r) => r.isRandom).length} runtime-random
        </span>
        <label style={{ fontSize: "0.72rem", color: "#cdb98a", display: "flex", alignItems: "center", gap: 5, cursor: positioned ? "pointer" : "default", opacity: positioned ? 1 : 0.4 }}>
          <input type="checkbox" checked={!!showMarkers} disabled={!positioned} onChange={onToggleMarkers} />
          Show on map
        </label>
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {sorted.map((r, i) => {
          const pending = isPending(r);
          const icon = CAT_ICON[r.category] || "•";
          return (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "20px 1fr auto",
              gap: 6, padding: "2px 12px", fontSize: "0.74rem",
              color: pending ? "#f0e0b0" : "#cfcfcf", alignItems: "baseline",
            }}>
              <span title={r.category}>{icon}</span>
              <span>
                <span style={{ textTransform: "capitalize" }}>{r.category}</span>
                {r.label && r.label !== r.category ? <span style={{ color: "#9a9a9a" }}> · {r.label}</span> : null}
                {r.isRandom && <span style={{ color: "#8aa0c0", fontSize: "0.68rem" }}> [random]</span>}
                {r.warning && <span style={{ color: "#e0a060", fontSize: "0.68rem" }}> ⚠ warning</span>}
                {r.x != null && r.y != null && <span style={{ color: "#777", fontSize: "0.68rem" }}> @({r.x},{r.y})</span>}
                {r.scale ? <span style={{ color: "#777", fontSize: "0.68rem" }}> scale {r.scale}</span> : null}
              </span>
              <span style={{ color: pending ? "#f0c060" : "#888", fontSize: "0.7rem", whiteSpace: "nowrap" }}>
                {pending ? "PENDING · " : ""}{yearLabel(r.year, r.season)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 3. Campaign timeline ─────────────────────────────────────────────────────
function TimelineSection({ timeline, scanning, onScan, modDataDir }) {
  const num = (v) => (v == null ? "—" : String(v));
  const signed = (v) => (v == null ? "—" : v >= 0 ? "+" + v : String(v));
  return (
    <div style={{ padding: "8px 12px" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <button
          onClick={onScan}
          disabled={scanning || !modDataDir}
          title={modDataDir ? "Pick a folder of saves to read and chart" : "Load a mod first"}
          style={{
            background: "rgba(220,166,74,0.18)", border: "1px solid rgba(220,166,74,0.4)",
            color: "#dca64a", padding: "4px 11px", borderRadius: 5,
            cursor: scanning || !modDataDir ? "default" : "pointer", fontSize: "0.76rem", fontWeight: 600,
            opacity: scanning || !modDataDir ? 0.5 : 1,
          }}
        >{scanning ? "Scanning…" : "Scan a saves folder…"}</button>
        {timeline && <span style={{ fontSize: "0.72rem", color: "#999" }}>{timeline.scanned} save(s) scanned</span>}
      </div>
      {timeline && timeline.error && (
        <div style={{ color: "#e08080", fontSize: "0.76rem" }}>{timeline.error}</div>
      )}
      {timeline && Array.isArray(timeline.campaigns) && timeline.campaigns.map((c, ci) => (
        <div key={ci} style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, color: "#cdb98a", fontSize: "0.78rem", marginBottom: 3 }}>
            {fac(c.player)} <span style={{ color: "#777", fontWeight: 600 }}>· {c.saves} save(s)</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: "0.72rem", color: "#ddd", width: "100%" }}>
              <thead>
                <tr style={{ color: "#999" }}>
                  {["turn", "date", "treasury", "income", "rgn", "units", "soldiers", "war", "ally", "fam"].map((h) => (
                    <th key={h} style={{ textAlign: h === "turn" || h === "date" ? "left" : "right", padding: "2px 6px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.turns.map((t, ti) => {
                  const d = ti > 0 ? c.deltas[ti - 1] : null;
                  const deltaParts = [];
                  if (d) {
                    if (d.settlementsGained?.length) deltaParts.push(`+${d.settlementsGained.length} settlement(s)`);
                    if (d.settlementsLost?.length) deltaParts.push(`-${d.settlementsLost.length} settlement(s)`);
                    if (d.treasurySwing != null && d.treasurySwing !== 0) deltaParts.push(`treasury ${signed(d.treasurySwing)}`);
                    if (d.newWar?.length) deltaParts.push(`+war ${d.newWar.map(fac).join("/")}`);
                    if (d.endWar?.length) deltaParts.push(`-war ${d.endWar.map(fac).join("/")}`);
                    if (d.newAlly?.length) deltaParts.push(`+ally ${d.newAlly.map(fac).join("/")}`);
                    if (d.endAlly?.length) deltaParts.push(`-ally ${d.endAlly.map(fac).join("/")}`);
                    if (d.familyChainBroken) deltaParts.push("family Δ — (different save chain)");
                    else {
                      if (d.births) deltaParts.push(`${d.births} born/come-of-age`);
                      if (d.deaths) deltaParts.push(`${d.deaths} died`);
                    }
                  }
                  return (
                    <React.Fragment key={ti}>
                      <tr>
                        <td style={{ padding: "1px 6px" }}>{num(t.turn)}</td>
                        <td style={{ padding: "1px 6px" }}>{yearLabel(t.year, t.seasonIndex != null ? `s${t.seasonIndex}` : null)}</td>
                        <td style={{ padding: "1px 6px", textAlign: "right" }}>{num(t.treasury)}</td>
                        <td style={{ padding: "1px 6px", textAlign: "right" }}>{num(t.income)}</td>
                        <td style={{ padding: "1px 6px", textAlign: "right" }}>{num(t.regions)}</td>
                        <td style={{ padding: "1px 6px", textAlign: "right" }}>{num(t.units)}</td>
                        <td style={{ padding: "1px 6px", textAlign: "right" }}>{num(t.soldiers)}</td>
                        <td style={{ padding: "1px 6px", textAlign: "right" }}>{num(t.wars)}</td>
                        <td style={{ padding: "1px 6px", textAlign: "right" }}>{num(t.allies)}</td>
                        <td style={{ padding: "1px 6px", textAlign: "right" }}>{num(t.family)}</td>
                      </tr>
                      {deltaParts.length > 0 && (
                        <tr>
                          <td colSpan={10} style={{ padding: "0 6px 3px 18px", color: "#9aa0a8", fontSize: "0.68rem" }}>
                            Δ {deltaParts.join("  ·  ")}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {timeline && (!timeline.campaigns || timeline.campaigns.length === 0) && !timeline.error && (
        <div style={{ color: "#9a9a9a", fontSize: "0.76rem" }}>No saves found in that folder.</div>
      )}
      {!timeline && !scanning && (
        <div style={{ color: "#9a9a9a", fontSize: "0.76rem" }}>
          Scan the game's saves folder (or a crash-save bundle) to chart treasury,
          territory, military and diplomacy turn by turn. Saves are sorted by their
          cracked turn number, not filename; deltas across different save chains
          are flagged, never fabricated.
        </div>
      )}
    </div>
  );
}

// ── 4. AI scouting summary ───────────────────────────────────────────────────
function ScoutingSection({ factionKnowledge }) {
  if (!factionKnowledge || !factionKnowledge.perFaction) {
    return (
      <div style={{ padding: "10px 14px", color: "#9a9a9a", fontSize: "0.78rem" }}>
        — no faction-knowledge data in this snapshot.
      </div>
    );
  }
  const rows = Object.entries(factionKnowledge.perFaction)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => (b.knownSettlements || 0) - (a.knownSettlements || 0));
  return (
    <div style={{ padding: "4px 0" }}>
      <div style={{ fontSize: "0.72rem", color: "#999", padding: "2px 12px 4px" }}>
        {factionKnowledge.factionsWithTail} faction(s) with scouting data ·{" "}
        {factionKnowledge.totalTuples} known tiles total. Per-tile fog overlay is a
        future step (needs the tile resolver + map_regions.tga — too heavy per snapshot).
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, padding: "2px 12px", color: "#999", fontSize: "0.7rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <span>Faction</span><span style={{ textAlign: "right" }}>settlements</span><span style={{ textAlign: "right" }}>tiles</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, padding: "1px 12px", fontSize: "0.74rem", color: "#ddd" }}>
            <span>{fac(r.name)}</span>
            <span style={{ textAlign: "right", color: "#e0c98a" }}>{r.knownSettlements}</span>
            <span style={{ textAlign: "right", color: "#999" }}>{r.knownTiles}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SaveInsightsPanel({
  onClose,
  lastTurnEvents,
  eventSchedule,
  factionKnowledge,
  currentYear,
  showScheduleMarkers,
  onToggleScheduleMarkers,
  timeline,
  scanning,
  onScanTimeline,
  modDataDir,
}) {
  const [open, setOpen] = useState({ lastTurn: true, schedule: true, timeline: false, scouting: false });
  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  const counts = {
    lastTurn: lastTurnEvents == null ? null : lastTurnEvents.length,
    schedule: eventSchedule && eventSchedule.records ? eventSchedule.records.length : null,
    timeline: timeline && timeline.scanned != null ? timeline.scanned : null,
    scouting: factionKnowledge && factionKnowledge.perFaction ? Object.keys(factionKnowledge.perFaction).length : null,
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 9990, background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{
        background: "rgba(28,24,18,0.97)", border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 10, width: "min(620px, 92vw)", maxHeight: "84vh",
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          padding: "10px 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#dca64a" }}>📊 Save insights</span>
          <button onClick={onClose}
            style={{ background: "transparent", border: "none", color: "#aaa", fontSize: "1.1rem", cursor: "pointer", padding: 0 }}
            title="Close (Esc)">×</button>
        </div>
        <div style={{ overflowY: "auto" }}>
          {SECTION_ORDER.map((id) => (
            <div key={id}>
              <SectionHeader id={id} open={open[id]} onToggle={toggle} count={counts[id]} />
              {open[id] && (
                id === "lastTurn" ? <LastTurnSection lastTurnEvents={lastTurnEvents} /> :
                id === "schedule" ? <ScheduleSection eventSchedule={eventSchedule} currentYear={currentYear} showMarkers={showScheduleMarkers} onToggleMarkers={onToggleScheduleMarkers} /> :
                id === "timeline" ? <TimelineSection timeline={timeline} scanning={scanning} onScan={onScanTimeline} modDataDir={modDataDir} /> :
                <ScoutingSection factionKnowledge={factionKnowledge} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
