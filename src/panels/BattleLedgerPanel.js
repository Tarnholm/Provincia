// Battle Ledger panel — per-faction battle statistics accumulated live from
// the game's message_log stream. PRESENTATIONAL ONLY: the integrator (App.js)
// owns the ledger instance (src/battleLedger.js createLedger()), feeds it
// inside the existing onLogLines subscription, and passes a throttled
// snapshot() here as `ledgerSnapshot`. This component never subscribes to
// anything itself.
//
// Props:
//   ledgerSnapshot  — result of ledger.snapshot(): { byFaction, events, turn }
//                     (null/undefined tolerated → empty state)
//   liveActive      — boolean: is the live log watcher currently running
//   onClose         — () => void
//
// Style: dark inline styles matching src/panels/ArmySetupModal.js.
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";

const TYPE_LABEL = {
  field: "Field battle",
  naval: "Naval battle",
  siege_assault: "Siege assault",
  sally: "Sally",
};
const TYPE_COLOR = {
  field: "#c8b78a",
  naval: "#9fd3ff",
  siege_assault: "#e8a95a",
  sally: "#d69ad6",
};

function facLabel(f) {
  if (!f) return "?";
  return f.replace(/_/g, " ");
}

function describeEvent(ev) {
  switch (ev.kind) {
    case "battle": {
      const t = TYPE_LABEL[ev.battleType] || "Battle";
      const w = ev.winner ? facLabel(ev.winner) : (ev.winnerName || "?");
      const l = ev.loser ? facLabel(ev.loser) : (ev.loserName || "?");
      return `${t}: ${w} defeated ${l}` + (ev.location ? ` at ${ev.location}` : "");
    }
    case "army_destroyed":
      return `Army of ${facLabel(ev.faction)} destroyed (${ev.commanderName})` +
        (ev.destroyedBy ? ` by ${facLabel(ev.destroyedBy)}` : "");
    case "siege_begun":
      return `Siege of ${ev.settlement || "?"} begun` +
        (ev.faction ? ` by ${facLabel(ev.faction)}` : ` (${ev.general})`);
    case "siege_ended":
      return `Siege of ${ev.settlement || "?"} lifted`;
    case "assault_captured":
      return `${facLabel(ev.winner)} stormed ${ev.settlement} (taken from ${facLabel(ev.loser)})`;
    case "settlement_captured":
      return `${facLabel(ev.winner)} captured ${ev.settlement} from ${facLabel(ev.loser)}` +
        (ev.reason && ev.reason !== "CAPTURED" ? ` (${ev.reason.toLowerCase()})` : "");
    default:
      return ev.kind;
  }
}

function eventColor(ev) {
  if (ev.kind === "battle") return TYPE_COLOR[ev.battleType] || "#c8b78a";
  if (ev.kind === "army_destroyed") return "#e8a090";
  if (ev.kind === "assault_captured" || ev.kind === "settlement_captured") return "#b8d38f";
  return "#9ab";
}

export default function BattleLedgerPanel({ ledgerSnapshot, liveActive, onClose }) {
  const [expanded, setExpanded] = useState(null); // faction name or null

  const rows = useMemo(() => {
    const bf = (ledgerSnapshot && ledgerSnapshot.byFaction) || {};
    return Object.entries(bf)
      .map(([faction, s]) => ({ faction, ...s }))
      .sort((a, b) => b.fought - a.fought || b.won - a.won || a.faction.localeCompare(b.faction));
  }, [ledgerSnapshot]);

  const events = (ledgerSnapshot && ledgerSnapshot.events) || [];
  const hasData = rows.length > 0 || events.length > 0;

  const th = { textAlign: "right", padding: "4px 8px", fontSize: "0.72rem", color: "#9ab", fontWeight: 600, whiteSpace: "nowrap" };
  const td = { textAlign: "right", padding: "3px 8px", fontSize: "0.78rem", whiteSpace: "nowrap" };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} className="popover-pop-in" style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(760px, 96vw)", maxHeight: "86vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#e8c873" }}>Battle Ledger</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.72rem", color: liveActive ? "#9ed6ad" : "#c8a06a" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: liveActive ? "#5ac87a" : "#a08a4a", display: "inline-block" }} />
            {liveActive ? "live" : "live mode off"}
          </span>
          {ledgerSnapshot && ledgerSnapshot.turn ? (
            <span style={{ fontSize: "0.72rem", color: "#9ab" }}>turn {ledgerSnapshot.turn}</span>
          ) : null}
          <button onClick={onClose}
            style={{ marginLeft: "auto", background: "none", border: "1px solid rgba(255,255,255,0.2)", color: "#9aa", borderRadius: 5, padding: "2px 10px", cursor: "pointer", fontSize: "0.74rem" }}>
            close
          </button>
        </div>

        {!hasData ? (
          /* Empty state */
          <div style={{ padding: "28px 24px", textAlign: "center" }}>
            <div style={{ fontSize: "0.85rem", color: "#c8b78a", marginBottom: 8 }}>No battles recorded yet</div>
            <div style={{ fontSize: "0.76rem", color: "#9ab", lineHeight: 1.5, maxWidth: 480, margin: "0 auto" }}>
              The ledger fills in during live play: with the log watcher running, every battle,
              siege and destroyed army the game writes to its message log is tallied here per
              faction — who fought whom, who won, and where.
              {!liveActive && (
                <span style={{ display: "block", marginTop: 8, color: "#c8a06a" }}>
                  Live mode is currently off — start the log watcher to begin recording.
                </span>
              )}
            </div>
          </div>
        ) : (
          <div style={{ overflowY: "auto", padding: "8px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Faction table */}
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
                  <th style={{ ...th, textAlign: "left" }}>Faction</th>
                  <th style={th}>Fought</th>
                  <th style={th}>Won</th>
                  <th style={th}>Lost</th>
                  <th style={th}>Win %</th>
                  <th style={th}>Sieges</th>
                  <th style={th}>Armies destroyed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const isOpen = expanded === r.faction;
                  const winPct = r.fought > 0 ? Math.round((r.won / r.fought) * 100) : null;
                  const oppRows = Object.entries(r.opponents).sort((a, b) => b[1] - a[1]);
                  return (
                    <React.Fragment key={r.faction}>
                      <tr onClick={() => setExpanded(isOpen ? null : r.faction)}
                        style={{ cursor: "pointer", background: isOpen ? "rgba(232,200,115,0.07)" : "none", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <td style={{ ...td, textAlign: "left", color: "#e8c873" }}>
                          <span style={{ display: "inline-block", width: 14, color: "#9ab" }}>{isOpen ? "▾" : "▸"}</span>
                          {facLabel(r.faction)}
                        </td>
                        <td style={td}>{r.fought}</td>
                        <td style={{ ...td, color: "#9ed6ad" }}>{r.won}</td>
                        <td style={{ ...td, color: "#e8a090" }}>{r.lost}</td>
                        <td style={{ ...td, color: winPct == null ? "#667" : winPct >= 50 ? "#9ed6ad" : "#e8a090" }}>
                          {winPct == null ? "—" : winPct + "%"}
                        </td>
                        <td style={td}>{r.sieges}</td>
                        <td style={td}>{r.armiesDestroyed}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7} style={{ padding: "6px 8px 10px 22px" }}>
                            <div style={{ borderRadius: 6, border: "1px solid rgba(200,170,110,0.35)", background: "rgba(30,26,18,0.55)", padding: "6px 10px", fontSize: "0.74rem" }}>
                              {oppRows.length === 0 ? (
                                <span style={{ color: "#9ab" }}>No recorded opponents yet.</span>
                              ) : (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
                                  {oppRows.map(([o, n]) => (
                                    <span key={o} style={{ color: "#c8b78a" }}>
                                      vs {facLabel(o)}: <b style={{ color: "#f4f4f4" }}>{n}</b>
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div style={{ marginTop: 4, color: "#9ab" }}>
                                own armies lost: <b style={{ color: "#e8a090" }}>{r.armiesLost}</b>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>

            {/* Recent events feed */}
            <div>
              <div style={{ fontSize: "0.74rem", fontWeight: 600, color: "#9ab", margin: "2px 0 4px" }}>
                Recent events {events.length > 0 && <span style={{ fontWeight: 400 }}>({events.length} kept, newest first)</span>}
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.25)", padding: "4px 8px" }}>
                {events.length === 0 ? (
                  <div style={{ fontSize: "0.74rem", color: "#667", padding: "4px 0" }}>Nothing yet.</div>
                ) : events.slice(0, 120).map(ev => (
                  <div key={ev.seq} style={{ fontSize: "0.73rem", padding: "1px 0", color: eventColor(ev), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <span style={{ color: "#667", marginRight: 6 }}>T{ev.turn}</span>
                    {describeEvent(ev)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
