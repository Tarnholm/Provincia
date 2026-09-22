// src/panels/FactionTransferPanel.js
//
// ☥ Bring In a Faction — wake a faction that a submod leaves dormant, using the
// roster it has in the fuller mod this one sits on.
//
// The two halves are deliberately different in kind, because the mods differ in
// kind: SETTLEMENTS come from this map (the block moves from whoever holds it,
// since a submod's regions are its own), while the ROSTER — characters with
// their armies, family records — is copied from the main mod and re-placed on a
// tile here. Suggested towns are the ones that faction holds over there which
// also exist here, by region or by settlement name.
//
// Props:
//   modDataDir   active mod data dir
//   campaign     optional campaign name (a mod may ship several)
//   factionDisplayNames { faction: "Display Name" }
//   pushToast    (msg, kind, ms) => void
//   onClose      () => void
import React from "react";
import { createPortal } from "react-dom";

const GOLD = "#e8c873";
const WARN = "#ff9d7a";
const DIM = "#9ab";

const label = (f, names) => (names && f && names[f]) || (f ? f.replace(/_/g, " ") : "—");

export default function FactionTransferPanel({ modDataDir, campaign, factionDisplayNames, pushToast, onClose }) {
  const [scan, setScan] = React.useState(null);        // { target, source, factions } | { error }
  const [faction, setFaction] = React.useState(null);
  const [roster, setRoster] = React.useState(null);    // { roster, settlements, … } | { error }
  const [query, setQuery] = React.useState("");
  const [townQuery, setTownQuery] = React.useState("");
  const [picked, setPicked] = React.useState({ settlements: new Set(), characters: new Set(), family: new Set() });
  const [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState(null);  // dry-run result
  const api = typeof window !== "undefined" ? window.electronAPI : null;

  const close = onClose || (() => { });
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // ── load the campaign's dormant list ──────────────────────────────────
  React.useEffect(() => {
    let dead = false;
    if (!api || !api.factionTransferScan || !modDataDir) { setScan({ error: modDataDir ? "this build cannot read campaigns" : "no mod loaded" }); return undefined; }
    setScan(null);
    api.factionTransferScan(modDataDir, campaign)
      .then((r) => { if (!dead) setScan(r || { error: "no answer from the scan" }); })
      .catch((e) => { if (!dead) setScan({ error: e && e.message ? e.message : String(e) }); });
    return () => { dead = true; };
  }, [api, modDataDir, campaign]);

  // ── load one faction's roster + the towns on offer ────────────────────
  React.useEffect(() => {
    let dead = false;
    if (!faction || !api || !api.factionTransferRoster) { setRoster(null); return undefined; }
    setRoster(null); setPreview(null);
    api.factionTransferRoster(modDataDir, faction, campaign)
      .then((r) => {
        if (dead) return;
        setRoster(r || { error: "no answer" });
        if (r && !r.error) {
          setPicked({
            settlements: new Set(r.settlements.filter((s) => s.suggested).map((s) => s.region)),
            characters: new Set(r.roster.characters.map((c) => c.name)),
            family: new Set(r.roster.family.map((f) => f.name)),
          });
        }
      })
      .catch((e) => { if (!dead) setRoster({ error: e && e.message ? e.message : String(e) }); });
    return () => { dead = true; };
  }, [api, faction, modDataDir, campaign]);

  const toggle = (kind, key) => setPicked((p) => {
    const next = new Set(p[kind]);
    if (next.has(key)) next.delete(key); else next.add(key);
    setPreview(null);
    return { ...p, [kind]: next };
  });

  const choice = React.useMemo(() => ({
    settlements: [...picked.settlements],
    characters: [...picked.characters],
    family: [...picked.family],
  }), [picked]);

  const run = async (dryRun) => {
    if (!api || !api.factionTransferApply || !faction) return;
    setBusy(true);
    try {
      // the campaign the scan actually read (and the header names), not the prop
      const r = await api.factionTransferApply(modDataDir, faction, { ...choice, dryRun }, (scan && scan.target && scan.target.campaign) || campaign);
      if (r && r.error) { pushToast && pushToast(`Could not bring in ${label(faction, factionDisplayNames)}: ${r.error}`, "error", 9000); setPreview(null); }
      else if (dryRun) setPreview(r);
      else {
        pushToast && pushToast(
          `${label(faction, factionDisplayNames)} now holds ${r.summary.settlements.length} settlement(s) with ${r.summary.characters.length} character(s). ` +
          (r.exported ? `Exported to ${r.path}.` : "A timestamped backup was saved beside descr_strat. Click 🔄 Reload so the map catches up."), "info", 9000);
        setPreview(null); setFaction(null);
        if (api.factionTransferScan) api.factionTransferScan(modDataDir, campaign).then((s) => setScan(s));
      }
    } catch (e) { pushToast && pushToast(`Could not bring in that faction: ${e && e.message}`, "error", 9000); }
    finally { setBusy(false); }
  };

  const dormant = (scan && scan.factions ? scan.factions : []).filter((f) => f.dormant);
  const shown = dormant.filter((f) => {
    const q = query.trim().toLowerCase();
    return !q || f.faction.toLowerCase().includes(q) || label(f.faction, factionDisplayNames).toLowerCase().includes(q);
  }).sort((a, b) => (b.sourceSettlements || 0) - (a.sourceSettlements || 0) || a.faction.localeCompare(b.faction));

  const box = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 7 };
  const chk = (on) => ({ display: "inline-block", width: 13, height: 13, marginRight: 7, borderRadius: 3, verticalAlign: "-2px", border: "1px solid " + (on ? "#8fd18f" : "rgba(255,255,255,0.3)"), background: on ? "rgba(143,209,143,0.55)" : "transparent" });

  return createPortal(
    <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" role="dialog" aria-label="Bring In a Faction"
        style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, width: "min(1080px, 95vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", color: "#ddd", boxShadow: "0 18px 60px rgba(0,0,0,0.55)" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="panel-heading" style={{ fontSize: "1.1rem", fontWeight: 600, color: GOLD }}>
            Bring In a Faction
            <span style={{ marginLeft: 10, fontSize: "0.74rem", color: DIM, fontWeight: 400 }}>
              {scan && scan.target ? `${scan.target.campaign} · ${dormant.length} dormant of ${scan.factions.length}` : ""}
              {scan && scan.source ? `  ·  roster from ${scan.source.campaign} (${scan.source.settlements} settlements)` : ""}
            </span>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: "transparent", border: "none", color: DIM, fontSize: "1rem", cursor: "pointer" }}>✕</button>
        </div>

        {!scan && <div style={{ padding: "28px 12px", textAlign: "center", color: DIM, fontSize: "0.85rem" }}>Reading the campaign…</div>}
        {scan && scan.error && <div style={{ padding: "20px 16px", color: WARN, fontSize: "0.82rem" }}>⚠ {scan.error}</div>}
        {scan && !scan.error && !scan.source && (
          <div style={{ padding: "16px", color: WARN, fontSize: "0.8rem", lineHeight: 1.5 }}>
            ⚠ No fuller mod was found beside this one to take a roster from. This tool copies characters and armies from the main mod a submod sits on; on the main mod itself there is nothing to import.
          </div>
        )}

        {scan && !scan.error && scan.source && (
          <div style={{ display: "flex", minHeight: 0, flex: 1 }}>
            {/* dormant factions */}
            <div style={{ width: 260, borderRight: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", minHeight: 0 }}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search dormant factions…" aria-label="Search factions"
                style={{ margin: "10px 12px", background: "rgba(255,255,255,0.07)", color: "#eee", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6, padding: "4px 8px", fontSize: "0.8rem" }} />
              <div style={{ overflowY: "auto", padding: "0 8px 10px" }}>
                {!shown.length && <div style={{ padding: 14, color: DIM, fontSize: "0.8rem" }}>No dormant faction matches.</div>}
                {shown.map((f) => (
                  <div key={f.faction} data-dormant-faction={f.faction} onClick={() => setFaction(f.faction)}
                    style={{ padding: "6px 8px", margin: "2px 0", borderRadius: 6, cursor: "pointer", background: faction === f.faction ? "rgba(232,200,115,0.16)" : "transparent", border: "1px solid " + (faction === f.faction ? "rgba(232,200,115,0.45)" : "transparent") }}>
                    <div style={{ fontSize: "0.84rem", color: "#e6e6e6" }}>{label(f.faction, factionDisplayNames)}</div>
                    <div style={{ fontSize: "0.71rem", color: DIM }}>
                      {f.sourceSettlements ? `${f.sourceSettlements} town${f.sourceSettlements === 1 ? "" : "s"}, ${f.sourceCharacters} character${f.sourceCharacters === 1 ? "" : "s"} over there` : "nothing over there either"}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* the chosen faction */}
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", minWidth: 0 }}>
              {!faction && <div style={{ padding: "40px 12px", textAlign: "center", color: DIM, fontSize: "0.85rem" }}>Pick a faction on the left.<br /><span style={{ fontSize: "0.76rem" }}>Its settlements come from this map; its characters and armies are copied from {scan.source.campaign}.</span></div>}
              {faction && !roster && <div style={{ padding: "30px 12px", textAlign: "center", color: DIM, fontSize: "0.84rem" }}>Reading {label(faction, factionDisplayNames)}…</div>}
              {faction && roster && roster.error && <div style={{ padding: "16px 4px", color: WARN, fontSize: "0.82rem" }}>⚠ {roster.error}</div>}

              {faction && roster && !roster.error && (
                <>
                  {/* settlements */}
                  <div style={{ fontSize: "0.86rem", color: GOLD, marginBottom: 4 }}>
                    Settlements on this map <span style={{ color: DIM, fontSize: "0.75rem" }}>· {picked.settlements.size} chosen · {roster.suggestedCount} suggested</span>
                  </div>
                  <div style={{ fontSize: "0.74rem", color: DIM, marginBottom: 6 }}>Taking a town hands it over from its current owner. Suggested ones are what this faction holds in {roster.source.campaign}.</div>
                  <input value={townQuery} onChange={(e) => setTownQuery(e.target.value)} placeholder="Search towns…" aria-label="Search towns"
                    style={{ width: "100%", background: "rgba(255,255,255,0.07)", color: "#eee", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6, padding: "3px 8px", fontSize: "0.78rem", marginBottom: 6 }} />
                  <div style={{ ...box, maxHeight: 190, overflowY: "auto", padding: "4px 0", marginBottom: 12 }}>
                    {roster.settlements
                      .filter((s) => { const q = townQuery.trim().toLowerCase(); return !q || s.city.toLowerCase().includes(q) || s.region.toLowerCase().includes(q); })
                      .slice(0, 400)
                      .map((s) => {
                        const on = picked.settlements.has(s.region);
                        return (
                          <div key={s.region} data-town={s.region} onClick={() => toggle("settlements", s.region)}
                            style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 10px", cursor: "pointer", fontSize: "0.78rem", background: on ? "rgba(143,209,143,0.08)" : "transparent" }}>
                            <span style={chk(on)} />
                            <span style={{ flex: "0 1 190px", color: "#e6e6e6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.city}</span>
                            <span style={{ flex: "0 1 150px", color: "#7d8896", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.region}</span>
                            <span style={{ width: 72, color: DIM }}>{s.level}</span>
                            <span style={{ flex: 1, color: s.owner === "slave" ? DIM : WARN, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {s.owner === "slave" ? "rebels" : label(s.owner, factionDisplayNames)}
                            </span>
                            {s.suggested && <span title="This faction holds this town in the fuller mod" style={{ color: GOLD, fontSize: "0.72rem" }}>suggested</span>}
                          </div>
                        );
                      })}
                  </div>

                  {/* roster */}
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 320px", minWidth: 280 }}>
                      <div style={{ fontSize: "0.86rem", color: GOLD, marginBottom: 4 }}>
                        Characters <span style={{ color: DIM, fontSize: "0.75rem" }}>· {picked.characters.size} of {roster.roster.characters.length}</span>
                      </div>
                      <div style={{ ...box, maxHeight: 200, overflowY: "auto", padding: "4px 0" }}>
                        {!roster.roster.characters.length && <div style={{ padding: 10, color: DIM, fontSize: "0.78rem" }}>This faction has no characters in {roster.source.campaign}.</div>}
                        {roster.roster.characters.map((c) => {
                          const on = picked.characters.has(c.name);
                          return (
                            <div key={c.name} data-character={c.name} onClick={() => toggle("characters", c.name)} style={{ padding: "4px 10px", cursor: "pointer", fontSize: "0.78rem", background: on ? "rgba(143,209,143,0.08)" : "transparent" }}>
                              <div><span style={chk(on)} /><span style={{ color: "#e6e6e6" }}>{c.name.replace(/_/g, " ")}</span>
                                {c.role && <span style={{ marginLeft: 6, color: GOLD, fontSize: "0.72rem" }}>{c.role}</span>}
                                <span style={{ marginLeft: 6, color: DIM, fontSize: "0.72rem" }}>{c.kind}{c.age ? `, ${c.age}` : ""} · {c.units} unit{c.units === 1 ? "" : "s"}</span>
                              </div>
                              {!!c.army.length && <div style={{ paddingLeft: 20, color: "#7d8896", fontSize: "0.71rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.army.join(", ")}</div>}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ flex: "1 1 260px", minWidth: 230 }}>
                      <div style={{ fontSize: "0.86rem", color: GOLD, marginBottom: 4 }}>
                        Family <span style={{ color: DIM, fontSize: "0.75rem" }}>· {picked.family.size} of {roster.roster.family.length}</span>
                      </div>
                      <div style={{ ...box, maxHeight: 200, overflowY: "auto", padding: "4px 0" }}>
                        {!roster.roster.family.length && <div style={{ padding: 10, color: DIM, fontSize: "0.78rem" }}>No family records over there.</div>}
                        {roster.roster.family.map((f) => {
                          const on = picked.family.has(f.name);
                          return (
                            <div key={f.name} data-family={f.name} onClick={() => toggle("family", f.name)} style={{ padding: "3px 10px", cursor: "pointer", fontSize: "0.78rem", background: on ? "rgba(143,209,143,0.08)" : "transparent" }}>
                              <span style={chk(on)} /><span style={{ color: "#e6e6e6" }}>{f.name.replace(/_/g, " ")}</span>
                              <span style={{ marginLeft: 6, color: DIM, fontSize: "0.72rem" }}>{f.gender}{f.age != null ? `, ${f.age}` : ""}{f.alive ? "" : ", dead"}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: "0.71rem", color: DIM, marginTop: 4 }}>
                        Marriage and parent links come along when everyone they name is brought.
                      </div>
                    </div>
                  </div>

                  {preview && preview.summary && (
                    <div style={{ ...box, marginTop: 12, padding: "8px 12px", fontSize: "0.78rem" }}>
                      <div style={{ color: GOLD, marginBottom: 3 }}>What will happen</div>
                      <div>{preview.summary.settlements.length} settlement(s): {preview.summary.settlements.map((s) => `${s.region} from ${s.from === "slave" ? "the rebels" : label(s.from, factionDisplayNames)}`).join(", ") || "none"}</div>
                      <div>{preview.summary.characters.length} character(s) placed at {preview.summary.characters.map((c) => `${c.name.replace(/_/g, " ")} (${c.x},${c.y})`).join(", ") || "none"}; {preview.summary.family.length} family record(s), {preview.summary.relatives} link(s)</div>
                      {preview.warnings.map((w, i) => <div key={i} style={{ color: WARN, marginTop: 3 }}>⚠ {w}</div>)}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {scan && !scan.error && scan.source && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ fontSize: "0.74rem", color: DIM, flex: 1 }}>
              {faction && roster && !roster.error
                ? `${picked.settlements.size} settlement(s), ${picked.characters.size} character(s), ${picked.family.size} family record(s) → ${label(faction, factionDisplayNames)}`
                : "Writes this campaign's descr_strat; a timestamped backup is saved beside it first."}
            </span>
            <button onClick={() => run(true)} disabled={!faction || busy || !(roster && !roster.error)}
              style={{ background: "transparent", color: GOLD, border: "1px solid rgba(232,200,115,0.45)", borderRadius: 6, padding: "4px 14px", fontSize: "0.8rem", cursor: faction && !busy ? "pointer" : "default", opacity: faction && !busy ? 1 : 0.5 }}>
              Preview
            </button>
            <button onClick={() => run(false)} disabled={!faction || busy || !(roster && !roster.error) || !picked.settlements.size}
              title={!picked.settlements.size ? "Choose at least one settlement — a faction with no town dies on the first turn" : ""}
              style={{ background: "rgba(143,180,110,0.25)", color: "#b8d38f", border: "1px solid #7a9a5a", borderRadius: 6, padding: "4px 16px", fontSize: "0.8rem", cursor: faction && !busy && picked.settlements.size ? "pointer" : "default", opacity: faction && !busy && picked.settlements.size ? 1 : 0.5 }}>
              {busy ? "Writing…" : "Bring in"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
