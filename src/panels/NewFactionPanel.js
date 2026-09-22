// src/panels/NewFactionPanel.js
//
// ☥ New Faction — create a faction the mod has never had.
//
// The neighbouring tool (FactionTransferPanel) wakes a faction that is already
// declared everywhere the engine looks. This one has to register a faction from
// nothing, so it works by cloning a DONOR: the donor's entry is copied in each
// of the seven files the engine demands for every faction, and the copy is
// renamed. That is why the first choice is "who is this like?" rather than a
// blank form — there is no such thing as a faction without a culture, a banner,
// a strat model and an AI personality.
//
// Three things the panel insists on, because the engine does:
//   · a settlement — a faction with no town is destroyed on the first turn
//   · a LEADER and an HEIR — same rule, via the family: no living male family
//     member, no faction. Their names come out of the donor's namelist pool,
//     which is already registered, so nothing has to be added to names.txt.
//   · a token, lower case, that nothing else uses
//
// Recruitment is a picker rather than a step: four RIS factions have no
// export_descr_buildings entry at all and still exist, so it is optional, and
// the user asked to choose which offers the new faction gets rather than all.
//
// Props: modDataDir, campaign, factionDisplayNames, pushToast, onClose
import React from "react";
import { createPortal } from "react-dom";

const GOLD = "#e8c873";
const WARN = "#ff9d7a";
const DIM = "#9ab";
// 240th, not "240st" (same rule as newFactionHandlers.ordinal)
const ordinal = (n) => (n % 100 >= 11 && n % 100 <= 13 ? n + "th" : n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));

const label = (f, names) => (names && f && names[f]) || (f ? f.replace(/_/g, " ") : "—");
const field = { background: "rgba(255,255,255,0.07)", color: "#eee", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6, padding: "4px 8px", fontSize: "0.8rem" };

export default function NewFactionPanel({ modDataDir, campaign, factionDisplayNames, pushToast, onClose }) {
  const [scan, setScan] = React.useState(null);
  const [donor, setDonor] = React.useState(null);
  const [info, setInfo] = React.useState(null);     // the donor's names, towns, recruitment
  const [query, setQuery] = React.useState("");
  const [townQuery, setTownQuery] = React.useState("");
  const [recruitQuery, setRecruitQuery] = React.useState("");
  const [form, setForm] = React.useState({ newId: "", displayName: "", description: "", denari: 5000, playable: false });
  const [towns, setTowns] = React.useState(new Set());
  const [leader, setLeader] = React.useState({ name: "", age: 40 });
  const [heir, setHeir] = React.useState({ name: "", age: 20 });
  const [recruit, setRecruit] = React.useState(new Set());
  const [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState(null);
  const api = typeof window !== "undefined" ? window.electronAPI : null;

  const close = onClose || (() => { });
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  React.useEffect(() => {
    let dead = false;
    if (!api || !api.newFactionScan || !modDataDir) { setScan({ error: modDataDir ? "this build cannot create factions" : "no mod loaded" }); return undefined; }
    setScan(null);
    api.newFactionScan(modDataDir, campaign)
      .then((r) => { if (!dead) setScan(r || { error: "no answer from the scan" }); })
      .catch((e) => { if (!dead) setScan({ error: e && e.message ? e.message : String(e) }); });
    return () => { dead = true; };
  }, [api, modDataDir, campaign]);

  // Picking a donor fills everything that can be defaulted: a name out of its
  // pool for the leader and another for the heir, its own towns pre-suggested.
  React.useEffect(() => {
    let dead = false;
    if (!donor || !api || !api.newFactionDonor) { setInfo(null); return undefined; }
    setInfo(null); setPreview(null);
    api.newFactionDonor(modDataDir, donor, campaign)
      .then((r) => {
        if (dead) return;
        setInfo(r || { error: "no answer" });
        if (r && !r.error) {
          setTowns(new Set());
          setRecruit(new Set());
          setLeader({ name: r.names[0] || "", age: 40 });
          setHeir({ name: r.names[1] || r.names[0] || "", age: 20 });
        }
      })
      .catch((e) => { if (!dead) setInfo({ error: e && e.message ? e.message : String(e) }); });
    return () => { dead = true; };
  }, [api, donor, modDataDir, campaign]);

  const toggle = (set, put, key) => { const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); put(n); setPreview(null); };
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setPreview(null); };

  const tokenBad = form.newId && !/^[a-z][a-z0-9_]*$/.test(form.newId);
  const taken = !!(scan && scan.donors || []).some((d) => d.faction === form.newId);
  const ready = !!donor && !!form.newId && !tokenBad && !taken && towns.size > 0 && !!leader.name && !!heir.name && leader.name !== heir.name;

  const choice = React.useMemo(() => ({
    // the campaign the scan actually read (and the header names), not the prop
    donor, campaign: (scan && !scan.error && scan.campaign) || campaign,
    newId: form.newId, displayName: form.displayName || form.newId, description: form.description,
    denari: Number(form.denari) || 0, playable: form.playable,
    aiLabel: info && info.aiLabel,
    settlements: [...towns],
    leader: { name: leader.name, age: Number(leader.age) || 40 },
    heir: { name: heir.name, age: Number(heir.age) || 20 },
    recruitLines: [...recruit],
  }), [donor, campaign, scan, form, info, towns, leader, heir, recruit]);

  const run = async (dryRun) => {
    if (!api || !api.newFactionApply) return;
    setBusy(true);
    try {
      const r = await api.newFactionApply(modDataDir, { ...choice, dryRun });
      if (r && r.error) { pushToast && pushToast(`Could not create ${form.newId}: ${r.error}`, "error", 9000); setPreview(null); }
      else if (dryRun) setPreview(r);
      else {
        pushToast && pushToast(
          `${form.displayName || form.newId} created from ${label(donor, factionDisplayNames)}: ${r.summary.files.length} file(s) written, ` +
          `${r.summary.strat.settlements.length} settlement(s), ${r.copied.length} art file(s) copied. ` +
          "Timestamped backups were saved beside each file. Click 🔄 Reload so the map catches up.", "info", 11000);
        setPreview(null); setDonor(null);
        if (api.newFactionScan) api.newFactionScan(modDataDir, campaign).then(setScan);
      }
    } catch (e) { pushToast && pushToast(`Could not create that faction: ${e && e.message}`, "error", 9000); }
    finally { setBusy(false); }
  };

  const donors = (scan && scan.donors ? scan.donors : []).filter((d) => {
    const q = query.trim().toLowerCase();
    return !q || d.faction.toLowerCase().includes(q) || label(d.faction, factionDisplayNames).toLowerCase().includes(q) || (d.culture || "").includes(q);
  });

  const box = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 7 };
  const chk = (on) => ({ display: "inline-block", width: 13, height: 13, marginRight: 7, borderRadius: 3, verticalAlign: "-2px", border: "1px solid " + (on ? "#8fd18f" : "rgba(255,255,255,0.3)"), background: on ? "rgba(143,209,143,0.55)" : "transparent" });
  const head = { fontSize: "0.86rem", color: GOLD, margin: "12px 0 4px" };

  return createPortal(
    <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" role="dialog" aria-label="New Faction"
        style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, width: "min(1100px, 95vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", color: "#ddd", boxShadow: "0 18px 60px rgba(0,0,0,0.55)" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="panel-heading" style={{ fontSize: "1.1rem", fontWeight: 600, color: GOLD }}>
            New Faction
            <span style={{ marginLeft: 10, fontSize: "0.74rem", color: DIM, fontWeight: 400 }}>
              {scan && !scan.error ? `${scan.campaign} · ${scan.count} factions declared` : ""}
            </span>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: "transparent", border: "none", color: DIM, fontSize: "1rem", cursor: "pointer" }}>✕</button>
        </div>

        {!scan && <div style={{ padding: "28px 12px", textAlign: "center", color: DIM, fontSize: "0.85rem" }}>Reading the mod…</div>}
        {scan && scan.error && <div style={{ padding: "20px 16px", color: WARN, fontSize: "0.82rem" }}>⚠ {scan.error}</div>}

        {scan && !scan.error && (scan.atCap || scan.missingFiles.length > 0) && (
          <div style={{ padding: "10px 16px", color: WARN, fontSize: "0.78rem", lineHeight: 1.5, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            {scan.atCap && <div>⚠ This mod already declares {scan.count} factions. {scan.cap} is as far as the engine is known to go — a {ordinal(scan.count + 1)} may fail to load. You can still create one; test it before building on it.</div>}
            {!!scan.missingFiles.length && <div>⚠ Missing from this mod: {scan.missingFiles.join(", ")}. The faction will be written to the files that are here, but may not load without the rest.</div>}
          </div>
        )}

        {scan && !scan.error && (
          <div style={{ display: "flex", minHeight: 0, flex: 1 }}>
            {/* donors */}
            <div style={{ width: 250, borderRight: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ padding: "10px 12px 4px", fontSize: "0.74rem", color: DIM, lineHeight: 1.45 }}>
                Every faction needs a culture, banners, a strat model and an AI. Pick the faction the new one should be built from — it inherits all of that, and you change what you like.
              </div>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search factions or cultures…" aria-label="Search donors" style={{ ...field, margin: "6px 12px" }} />
              <div style={{ overflowY: "auto", padding: "0 8px 10px" }}>
                {!donors.length && <div style={{ padding: 14, color: DIM, fontSize: "0.8rem" }}>Nothing matches.</div>}
                {donors.map((d) => (
                  <div key={d.faction} data-donor={d.faction} onClick={() => setDonor(d.faction)}
                    style={{ padding: "6px 8px", margin: "2px 0", borderRadius: 6, cursor: "pointer", background: donor === d.faction ? "rgba(232,200,115,0.16)" : "transparent", border: "1px solid " + (donor === d.faction ? "rgba(232,200,115,0.45)" : "transparent") }}>
                    <div style={{ fontSize: "0.84rem", color: "#e6e6e6" }}>{label(d.faction, factionDisplayNames)}</div>
                    <div style={{ fontSize: "0.71rem", color: DIM }}>
                      {d.culture || "no culture"}{d.settlements ? ` · ${d.settlements} town${d.settlements === 1 ? "" : "s"}` : " · not on this map"}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* the new faction */}
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", minWidth: 0 }}>
              {!donor && <div style={{ padding: "40px 12px", textAlign: "center", color: DIM, fontSize: "0.85rem" }}>Pick a faction to build from, on the left.</div>}
              {donor && !info && <div style={{ padding: "30px 12px", textAlign: "center", color: DIM, fontSize: "0.84rem" }}>Reading {label(donor, factionDisplayNames)}…</div>}
              {donor && info && info.error && <div style={{ padding: "16px 4px", color: WARN, fontSize: "0.82rem" }}>⚠ {info.error}</div>}

              {donor && info && !info.error && (
                <>
                  <div style={{ ...head, marginTop: 0 }}>Who they are</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <label style={{ fontSize: "0.76rem", color: DIM }}>Token
                      <input value={form.newId} onChange={(e) => set("newId", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="tocharians" aria-label="Faction token"
                        style={{ ...field, marginLeft: 6, width: 150, borderColor: tokenBad || taken ? WARN : "rgba(255,255,255,0.18)" }} />
                    </label>
                    <label style={{ fontSize: "0.76rem", color: DIM }}>Name
                      <input value={form.displayName} onChange={(e) => set("displayName", e.target.value)} placeholder="Tocharians" aria-label="Display name" style={{ ...field, marginLeft: 6, width: 170 }} />
                    </label>
                    <label style={{ fontSize: "0.76rem", color: DIM }}>Treasury
                      <input type="number" value={form.denari} onChange={(e) => set("denari", e.target.value)} aria-label="Starting denari" style={{ ...field, marginLeft: 6, width: 90 }} />
                    </label>
                    <label style={{ fontSize: "0.76rem", color: DIM, cursor: "pointer" }} onClick={() => set("playable", !form.playable)}>
                      <span style={chk(form.playable)} />playable
                    </label>
                  </div>
                  <input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="One line shown on the faction select screen…" aria-label="Description"
                    style={{ ...field, width: "100%", marginTop: 6 }} />
                  {taken && <div style={{ color: WARN, fontSize: "0.75rem", marginTop: 4 }}>⚠ {form.newId} already exists in this mod.</div>}
                  {tokenBad && <div style={{ color: WARN, fontSize: "0.75rem", marginTop: 4 }}>⚠ A faction token is lower case letters, digits and underscores, starting with a letter.</div>}
                  <div style={{ fontSize: "0.73rem", color: DIM, marginTop: 5 }}>
                    Inherits {info.culture || "the donor's culture"} and the {info.namelists.men || "donor's"} name pool, and gets its own copies of the banner, icon and strat-model textures — replace those files later and the faction picks them up.
                  </div>

                  {/* the family the engine demands */}
                  <div style={head}>Leader and heir <span style={{ color: DIM, fontSize: "0.75rem" }}>· required</span></div>
                  <div style={{ fontSize: "0.74rem", color: DIM, marginBottom: 6 }}>
                    A faction with no living male family member is destroyed on its first turn. These names come from the {info.namelists.men || "donor's"} pool, which the engine already knows — nothing new is added to names.txt.
                  </div>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {[["Leader", leader, setLeader], ["Heir", heir, setHeir]].map(([who, val, put]) => (
                      <label key={who} style={{ fontSize: "0.76rem", color: DIM }}>{who}
                        <select value={val.name} onChange={(e) => { put({ ...val, name: e.target.value }); setPreview(null); }} aria-label={who + " name"} style={{ ...field, marginLeft: 6, width: 160 }}>
                          {!info.names.length && <option value="">no names in the pool</option>}
                          {info.names.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <input type="number" value={val.age} onChange={(e) => { put({ ...val, age: e.target.value }); setPreview(null); }} aria-label={who + " age"} style={{ ...field, marginLeft: 6, width: 60 }} />
                      </label>
                    ))}
                  </div>
                  {leader.name && leader.name === heir.name && <div style={{ color: WARN, fontSize: "0.75rem", marginTop: 4 }}>⚠ The leader and the heir cannot be the same man.</div>}

                  {/* towns */}
                  <div style={head}>Settlements <span style={{ color: DIM, fontSize: "0.75rem" }}>· {towns.size} chosen · required</span></div>
                  <div style={{ fontSize: "0.74rem", color: DIM, marginBottom: 6 }}>
                    A new faction has no land of its own, so each town it starts with is handed over from whoever holds it now. {label(donor, factionDisplayNames)}&apos;s own towns are listed first.
                  </div>
                  <input value={townQuery} onChange={(e) => setTownQuery(e.target.value)} placeholder="Search towns…" aria-label="Search towns" style={{ ...field, width: "100%", marginBottom: 6 }} />
                  <div style={{ ...box, maxHeight: 170, overflowY: "auto", padding: "4px 0" }}>
                    {info.settlements
                      .filter((s) => { const q = townQuery.trim().toLowerCase(); return !q || s.city.toLowerCase().includes(q) || s.region.toLowerCase().includes(q); })
                      .slice(0, 400)
                      .map((s) => {
                        const on = towns.has(s.region);
                        return (
                          <div key={s.region} data-town={s.region} onClick={() => toggle(towns, setTowns, s.region)}
                            style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 10px", cursor: "pointer", fontSize: "0.78rem", background: on ? "rgba(143,209,143,0.08)" : "transparent" }}>
                            <span style={chk(on)} />
                            <span style={{ flex: "0 1 180px", color: "#e6e6e6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.city}</span>
                            <span style={{ flex: "0 1 140px", color: "#7d8896", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.region}</span>
                            <span style={{ width: 72, color: DIM }}>{s.level}</span>
                            <span style={{ flex: 1, color: s.owner === "slave" ? DIM : WARN, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {s.owner === "slave" ? "rebels" : label(s.owner, factionDisplayNames)}
                            </span>
                          </div>
                        );
                      })}
                  </div>

                  {/* recruitment */}
                  {scan.haveRecruitment && (
                    <>
                      <div style={head}>Recruitment <span style={{ color: DIM, fontSize: "0.75rem" }}>· {recruit.size} of {info.recruitCount} · optional</span></div>
                      <div style={{ fontSize: "0.74rem", color: DIM, marginBottom: 6 }}>
                        Everything {label(donor, factionDisplayNames)} may build or recruit. Ticking one lets the new faction have it too. Leave them all unticked and the faction exists but recruits nothing — some factions ship that way.
                        <button onClick={() => { setRecruit(new Set(info.recruit.map((o) => o.line))); setPreview(null); }} style={{ marginLeft: 8, background: "transparent", color: GOLD, border: "1px solid rgba(232,200,115,0.35)", borderRadius: 5, padding: "1px 8px", fontSize: "0.72rem", cursor: "pointer" }}>all</button>
                        <button onClick={() => { setRecruit(new Set()); setPreview(null); }} style={{ marginLeft: 5, background: "transparent", color: DIM, border: "1px solid rgba(255,255,255,0.2)", borderRadius: 5, padding: "1px 8px", fontSize: "0.72rem", cursor: "pointer" }}>none</button>
                      </div>
                      <input value={recruitQuery} onChange={(e) => setRecruitQuery(e.target.value)} placeholder="Search units and buildings…" aria-label="Search recruitment" style={{ ...field, width: "100%", marginBottom: 6 }} />
                      <div style={{ ...box, maxHeight: 170, overflowY: "auto", padding: "4px 0" }}>
                        {info.recruit
                          .filter((o) => { const q = recruitQuery.trim().toLowerCase(); return !q || (o.unit || "").toLowerCase().includes(q) || (o.building || "").toLowerCase().includes(q) || (o.level || "").toLowerCase().includes(q); })
                          .slice(0, 400)
                          .map((o) => {
                            const on = recruit.has(o.line);
                            return (
                              <div key={o.line} data-recruit={o.line} onClick={() => toggle(recruit, setRecruit, o.line)}
                                style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 10px", cursor: "pointer", fontSize: "0.78rem", background: on ? "rgba(143,209,143,0.08)" : "transparent" }}>
                                <span style={chk(on)} />
                                <span style={{ flex: "0 1 230px", color: o.unit ? "#e6e6e6" : DIM, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.unit || "(may build it)"}</span>
                                <span style={{ flex: 1, color: "#7d8896", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.building || "—"}{o.level ? ` · ${o.level}` : ""}</span>
                              </div>
                            );
                          })}
                      </div>
                    </>
                  )}

                  {preview && preview.summary && (
                    <div style={{ ...box, marginTop: 12, padding: "8px 12px", fontSize: "0.78rem" }}>
                      <div style={{ color: GOLD, marginBottom: 3 }}>What will happen</div>
                      <div>{preview.summary.files.length} file(s) written: {preview.summary.files.join(", ")}</div>
                      <div>
                        {preview.summary.strat.settlements.map((s) => `${s.region} from ${s.from === "slave" ? "the rebels" : label(s.from, factionDisplayNames)}`).join(", ")}
                        {" · "}{preview.summary.strat.leader} leads, {preview.summary.strat.heir} succeeds, at ({preview.summary.strat.at.x},{preview.summary.strat.at.y})
                      </div>
                      <div>{preview.summary.art} art file(s) copied{preview.summary.artMissing ? `, ${preview.summary.artMissing} not found` : ""}{preview.summary.recruitChanged ? ` · ${preview.summary.recruitChanged} recruitment line(s)` : ""}</div>
                      {preview.warnings.map((w, i) => <div key={i} style={{ color: WARN, marginTop: 3 }}>⚠ {w}</div>)}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {scan && !scan.error && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ fontSize: "0.74rem", color: DIM, flex: 1 }}>
              {ready
                ? `${form.displayName || form.newId} from ${label(donor, factionDisplayNames)} · ${towns.size} town(s) · ${leader.name} and ${heir.name}${recruit.size ? ` · ${recruit.size} recruitment line(s)` : ""}`
                : "Writes descr_sm_factions, descr_character, descr_model_strat, descr_banners, the AI personality, the win conditions and this campaign's descr_strat. Each gets a timestamped backup first."}
            </span>
            <button onClick={() => run(true)} disabled={!ready || busy}
              style={{ background: "transparent", color: GOLD, border: "1px solid rgba(232,200,115,0.45)", borderRadius: 6, padding: "4px 14px", fontSize: "0.8rem", cursor: ready && !busy ? "pointer" : "default", opacity: ready && !busy ? 1 : 0.5 }}>
              Preview
            </button>
            <button onClick={() => run(false)} disabled={!ready || busy}
              title={!ready ? "Needs a free token, at least one settlement, and a leader and heir with different names" : ""}
              style={{ background: "rgba(143,180,110,0.25)", color: "#b8d38f", border: "1px solid #7a9a5a", borderRadius: 6, padding: "4px 16px", fontSize: "0.8rem", cursor: ready && !busy ? "pointer" : "default", opacity: ready && !busy ? 1 : 0.5 }}>
              {busy ? "Writing…" : "Create faction"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
