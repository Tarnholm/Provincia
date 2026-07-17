// src/panels/TraitExplorerPanel.js
//
// Trait Explorer — a searchable browser over the mod's character traits.
// Presentational + renderer-pure: it derives everything from the `traitData`
// object the app already fetches via get-trait-data, plus an optional flat
// `liveCharacters` array (flattened from App's saveCharactersByRegion). No IPC.
//
// Props:
//   traitData          — the get-trait-data result ({ levels, ... }); null until loaded
//   liveCharacters     — optional flat [{ firstName, lastName, faction, traits }];
//                        null/undefined hides the "current carriers" section
//   factionDisplayNames— optional { factionTag: "Display Name" }
//   onClose            — close handler
//
// Style: dark inline, matching src/panels/ArmySetupModal.js.
import React from "react";
import { createPortal } from "react-dom";
import { buildTraitIndex, filterTraits, carriersByTrait } from "../traitExplorer.js";

const GOLD = "#e8c873";
const GREEN = "#8fd18f";
const RED = "#e08a7a";

export default function TraitExplorerPanel({ traitData, liveCharacters, factionDisplayNames, onClose }) {
  const [query, setQuery] = React.useState("");
  const [effect, setEffect] = React.useState("");
  const [openTrait, setOpenTrait] = React.useState(null);

  const index = React.useMemo(() => buildTraitIndex(traitData), [traitData]);
  const carriers = React.useMemo(() => carriersByTrait(liveCharacters), [liveCharacters]);
  const hasLive = Array.isArray(liveCharacters) && liveCharacters.length > 0;
  const filtered = React.useMemo(
    () => filterTraits(index, { query, effect }),
    [index, query, effect]
  );

  const close = onClose || (() => {});
  const facLabel = (f) =>
    (factionDisplayNames && f && factionDisplayNames[f]) || (f ? f.replace(/_/g, " ") : "—");

  const loaded = traitData && index.traits.length > 0;

  const inputStyle = {
    background: "rgba(255,255,255,0.07)", color: "#eee",
    border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6,
    padding: "4px 8px", fontSize: "0.82rem", width: "100%",
  };

  return createPortal(
    <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, width: "min(940px, 96vw)", maxHeight: "88vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: "1.02rem", fontWeight: 600, color: GOLD }}>
            Trait Explorer
            <span style={{ marginLeft: 10, fontSize: "0.74rem", color: "#9ab", fontWeight: 400 }}>
              {loaded ? `${filtered.length} / ${index.traits.length} traits` : ""}
              {hasLive ? "  ·  live carriers on" : ""}
            </span>
          </div>
          <button onClick={close} style={{ background: "none", border: "1px solid rgba(255,255,255,0.2)", color: "#9aa", borderRadius: 5, padding: "2px 10px", cursor: "pointer", fontSize: "0.8rem" }}>close</button>
        </div>

        {!loaded ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ab", fontSize: "0.9rem" }}>
            No trait data loaded.<br />
            <span style={{ fontSize: "0.78rem", color: "#788" }}>Load a mod to browse its character traits.</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", padding: "10px 16px 14px", gap: 10, overflow: "hidden" }}>
            {/* Filter bar */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ flex: "1 1 260px", minWidth: 200 }}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search trait name or description…"
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: "0 1 240px", minWidth: 180 }}>
                <select value={effect} onChange={(e) => setEffect(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                  <option value="">All effects</option>
                  {index.allEffects.map((eff) => (
                    <option key={eff} value={eff}>{eff}</option>
                  ))}
                </select>
              </div>
              {(query || effect) && (
                <button onClick={() => { setQuery(""); setEffect(""); }} style={{ background: "none", border: "1px solid rgba(232,200,115,0.4)", color: GOLD, borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontSize: "0.74rem" }}>
                  clear
                </button>
              )}
            </div>

            {/* Trait list */}
            <div style={{ overflow: "auto", maxHeight: "62vh", background: "rgba(0,0,0,0.3)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)" }}>
              {filtered.length === 0 ? (
                <div style={{ padding: "26px 16px", textAlign: "center", color: "#889", fontSize: "0.84rem" }}>
                  No traits match this filter.
                </div>
              ) : filtered.map((t) => {
                const isOpen = openTrait === t.name;
                const carr = carriers[t.name] || [];
                return (
                  <div key={t.name} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <div
                      onClick={() => setOpenTrait(isOpen ? null : t.name)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", background: isOpen ? "rgba(232,200,115,0.08)" : "transparent" }}
                    >
                      <span style={{ color: GOLD, fontSize: "0.7rem", width: 12, display: "inline-block" }}>{isOpen ? "▾" : "▸"}</span>
                      <span style={{ fontWeight: 600, fontSize: "0.88rem", color: "#f0e6d0" }}>{t.name.replace(/_/g, " ")}</span>
                      <span style={{ marginLeft: "auto", display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {t.effectNames.map((eff) => (
                          <span key={eff} style={{ fontSize: "0.66rem", color: "#9ab", background: "rgba(255,255,255,0.06)", borderRadius: 4, padding: "1px 6px" }}>{eff}</span>
                        ))}
                        {hasLive && carr.length > 0 && (
                          <span style={{ fontSize: "0.66rem", color: GREEN, background: "rgba(143,209,143,0.12)", borderRadius: 4, padding: "1px 6px" }}>{carr.length} carrier{carr.length === 1 ? "" : "s"}</span>
                        )}
                      </span>
                    </div>

                    {isOpen && (
                      <div style={{ padding: "4px 14px 12px 32px", background: "rgba(0,0,0,0.22)" }}>
                        {/* Levels */}
                        {t.levels.map((lv, i) => (
                          <div key={i} style={{ padding: "6px 0", borderTop: i > 0 ? "1px dashed rgba(255,255,255,0.06)" : "none" }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#dcc9a0" }}>
                                L{lv.levelIdx} · {String(lv.level).replace(/_/g, " ")}
                              </span>
                              {lv.threshold != null && (
                                <span style={{ fontSize: "0.7rem", color: "#889" }}>threshold {lv.threshold}</span>
                              )}
                            </div>
                            {lv.effects.length > 0 && (
                              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 3 }}>
                                {lv.effects.map((e, j) => (
                                  <span key={j} style={{ fontSize: "0.76rem", color: e.value < 0 ? RED : e.value > 0 ? GREEN : "#bbb" }}>
                                    {e.name} <b>{e.value > 0 ? "+" : ""}{e.value}</b>
                                  </span>
                                ))}
                              </div>
                            )}
                            {lv.desc && (
                              <div style={{ fontSize: "0.74rem", color: "#a8a099", marginTop: 3, fontStyle: "italic" }}>{lv.desc}</div>
                            )}
                          </div>
                        ))}

                        {/* Live carriers grouped by faction */}
                        {hasLive && (
                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                            <div style={{ fontSize: "0.72rem", color: GOLD, marginBottom: 4 }}>
                              Current carriers ({carr.length})
                            </div>
                            {carr.length === 0 ? (
                              <div style={{ fontSize: "0.74rem", color: "#788" }}>No live character carries this trait.</div>
                            ) : (() => {
                              const byFac = {};
                              for (const c of carr) (byFac[c.faction || "—"] || (byFac[c.faction || "—"] = [])).push(c);
                              return Object.keys(byFac).sort().map((f) => (
                                <div key={f} style={{ marginBottom: 4 }}>
                                  <span style={{ fontSize: "0.72rem", color: "#9fb6e8", fontWeight: 600 }}>{facLabel(f)}</span>
                                  <span style={{ fontSize: "0.74rem", color: "#cbb" }}>
                                    {": "}
                                    {byFac[f].map((c, k) => (
                                      <span key={k}>
                                        {k > 0 ? ", " : ""}
                                        {c.character}
                                        {(c.levelName || c.level != null) && (
                                          <span style={{ color: "#889" }}> ({c.levelName ? String(c.levelName).replace(/_/g, " ") : "L" + c.level})</span>
                                        )}
                                      </span>
                                    ))}
                                  </span>
                                </div>
                              ));
                            })()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
