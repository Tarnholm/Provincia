import React, { useEffect, useState } from "react";

// Dev-mode "Add General" family builder. Writes a new named general (+ optional
// wife / sons / daughters) into descr_strat for NEW campaigns, with culture-
// correct UNIQUE names resolved by the backend (see descrStratGeneral.js).
const RAND = "__rand__"; // sentinel for the 🎲 Random option in name dropdowns

export default function AddGeneralModal({ settlementName, ownerFactionId, factionLabel, onStage, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const [factionName, setFactionName] = useState(null);
  const [settlement, setSettlement] = useState(null); // city name
  const [genAge, setGenAge] = useState(32);
  const [genFirst, setGenFirst] = useState("");
  const [familyMode, setFamilyMode] = useState("new");
  const [familyId, setFamilyId] = useState("");   // join: the chosen head's family id
  const [surname, setSurname] = useState("");      // new line (surname cultures only)
  const [wifeOn, setWifeOn] = useState(false);
  const [wifeFirst, setWifeFirst] = useState("");
  const [wifeAge, setWifeAge] = useState(28);
  const [wifeDead, setWifeDead] = useState(false);
  const [kids, setKids] = useState([]);
  const [generalUnit, setGeneralUnit] = useState("");

  const rand = (arr) => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : "");
  const randAge = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

  useEffect(() => {
    let alive = true;
    console.log(`[addgen-ui] open — settlement="${settlementName}" owner="${ownerFactionId}"`);
    window.electronAPI.addgenGetData().then((r) => {
      if (!alive) return;
      if (!r || !r.ok) { console.warn("[addgen-ui] get-data failed:", r && r.error); setErr((r && r.error) || "failed to load descr_strat data"); return; }
      // Guard a malformed-but-ok response (no factions/settlements) so a missing
      // field can't throw "reading 'factions'" from this async handler.
      if (!r.factions || !r.settlements) { console.warn("[addgen-ui] get-data ok but missing factions/settlements"); setErr("descr_strat data incomplete (no factions)"); return; }
      setData(r);
      const key = String(settlementName || "").toLowerCase().trim();
      const hit = r.settlements[key];
      const fac = (hit && hit.faction) || ownerFactionId || Object.keys(r.factions)[0];
      let selCity = null;
      const fo = r.factions[fac] && r.factions[fac].ownedSettlements;
      if (fo) { const m = fo.find((s) => s.city.toLowerCase() === key && s.x != null); if (m) selCity = m.city; }
      console.log(`[addgen-ui] data: ${Object.keys(r.factions).length} factions; faction=${fac}; owned=${fo ? fo.length : 0}; matched settlement=${selCity || "(none → default)"}`);
      setFactionName(fac);
      setSettlement(selCity);
    }).catch((e) => { console.warn("[addgen-ui] get-data error:", e); alive && setErr(String(e)); });
    return () => { alive = false; };
  }, [settlementName, ownerFactionId]);

  const fac = data && factionName ? data.factions[factionName] : null;
  const owned = (fac && fac.ownedSettlements) || [];
  const coords = owned.find((s) => s.city === settlement && s.x != null) || null;
  // Surname options for "new line" (surname cultures only) — derived from
  // existing family display names (the part after the head's first name).
  const surnameOptions = fac && fac.usesSurnames
    ? [...new Set(fac.families.filter((f) => f.headFam).map((f) => f.display.split(" ").slice(1).join(" ")))].sort()
    : [];

  // defaults once a faction's pools load
  useEffect(() => {
    if (!fac) return;
    setGenFirst((v) => v || fac.maleFirst[0] || "");
    setWifeFirst((v) => v || fac.femaleFirst[0] || "");
    setSurname((v) => v || surnameOptions[0] || "");
    setFamilyId((v) => v || (fac.families[0] && fac.families[0].id) || "");
    setGeneralUnit((v) => v || fac.generalUnit || (fac.generalUnits && fac.generalUnits[0]) || "");
    // default placement to first owned-with-coords if nothing matched
    setSettlement((v) => v || (owned.find((s) => s.x != null) || {}).city || null);
  }, [fac]); // eslint-disable-line

  function nameSelect(value, pool, set) {
    if (value === RAND) set(rand(pool)); else set(value);
  }
  function addKid() { setKids((k) => [...k, { gender: "son", first: (fac && fac.maleFirst[0]) || "", age: 6 }]); }
  function setKid(i, patch) { setKids((k) => k.map((x, j) => j === i ? { ...x, ...patch } : x)); }
  function delKid(i) { setKids((k) => k.filter((_, j) => j !== i)); }

  function submit() {
    if (!fac || !coords) { setErr("pick a settlement with valid coords"); return; }
    setErr(null);
    const selection = {
      factionName, x: coords.x, y: coords.y,
      settlement, homeX: coords.x, homeY: coords.y,
      generalUnit: generalUnit || undefined,
      general: { firstDisplay: genFirst, age: +genAge },
      familyId: familyMode === "join" ? familyId : undefined,
      familyName: familyMode === "new" && fac.usesSurnames ? surname : undefined,
      wife: wifeOn ? { firstDisplay: wifeFirst, age: +wifeAge, dead: wifeDead } : null,
      children: kids.map((k) => ({ firstDisplay: k.first, gender: k.gender, age: +k.age })),
    };
    // Display label for the roster / changes list (token resolution happens in
    // the backend on Save; this is just a human label).
    let displayName = genFirst;
    if (familyMode === "new" && fac.usesSurnames && surname) displayName = `${genFirst} ${surname}`;
    else if (familyMode === "join" && fac.usesSurnames) {
      const famSel = fac.families.find((f) => f.id === familyId);
      const sur = famSel ? famSel.display.split(" ").slice(1).join(" ") : "";
      if (sur) displayName = `${genFirst} ${sur}`;
    }
    console.log("[addgen-ui] stage:", JSON.stringify(selection));
    if (onStage) onStage({ selection, displayName, faction: factionName, factionLabel: lab(factionName), settlement, region: coords.region || null, age: +genAge });
    onClose();
  }

  const lab = (id) => (factionLabel ? factionLabel(id) : id);
  const sel = { background: "#1b1e25", color: "#ddd", border: "1px solid #3a3f4a", borderRadius: 4, padding: "3px 6px", fontSize: "0.75rem" };
  const num = { ...sel, width: 58 };
  const dice = { ...sel, cursor: "pointer", padding: "2px 6px" };
  const row = { display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" };
  const NameSelect = ({ value, pool, onPick, width }) => (
    <select style={{ ...sel, width }} value={pool.includes(value) ? value : ""} onChange={(e) => nameSelect(e.target.value, pool, onPick)}>
      <option value={RAND}>🎲 Random</option>
      {!pool.includes(value) && <option value="" disabled>— pick —</option>}
      {pool.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );

  // Inline form — rendered INSIDE the Characters widget body (replaces the
  // roster while adding). Scrolls within the widget; no portal/overlay.
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", color: "#ddd", fontSize: "0.74rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#fd8" }}>Add General</div>
        <button onClick={onClose} title="back to character list" style={{ background: "#2a2e36", color: "#ddd", border: "1px solid #3a3f4a", borderRadius: 4, cursor: "pointer", padding: "1px 8px", fontWeight: 600, fontSize: "0.65rem" }}>← back</button>
      </div>
      <div style={{ overflow: "auto", flex: 1, paddingRight: 4 }}>
        <div style={{ color: "#8a93a8", fontSize: "0.6rem", marginBottom: 6 }}>Staged as a pending change — shows in the roster and writes to descr_strat on Save (revert under Changes).</div>

        {err && <div style={{ background: "#3a1c1c", border: "1px solid #6a3030", color: "#e8a0a0", padding: 8, borderRadius: 4, marginBottom: 10 }}>{err}</div>}
        {!data && !err && <div style={{ color: "#888" }}>Loading descr_strat…</div>}

        {result ? (
          <div>
            <div style={{ background: "#1c3a22", border: "1px solid #356a3f", color: "#9ed09e", padding: 10, borderRadius: 4 }}>
              <div style={{ fontWeight: 700 }}>✓ Added {result.summary.general} to {lab(result.summary.faction)}</div>
              <div style={{ fontSize: "0.7rem", marginTop: 4 }}>
                wife: {result.summary.wife ? "yes" : "no"} · children: {result.summary.children}<br />
                new name tokens minted: {result.summary.minted.length ? result.summary.minted.join(", ") : "none"}<br />
                backups saved (suffix {result.backupStamp}.bak) · <span style={{ color: "#bbb" }}>Start a new campaign to see the general.</span>
              </div>
            </div>
            <div style={{ marginTop: 12, textAlign: "right" }}>
              <button onClick={() => setResult(null)} style={{ ...sel, cursor: "pointer", marginRight: 8 }}>Add another</button>
              <button onClick={onClose} style={{ ...sel, cursor: "pointer" }}>Close</button>
            </div>
          </div>
        ) : fac ? (
          <div>
            <div style={row}>
              <span style={{ color: "#bbb" }}>Faction</span>
              <select style={{ ...sel, flex: 1, minWidth: 110 }} value={factionName} onChange={(e) => { setFactionName(e.target.value); setSettlement(null); setGenFirst(""); setSurname(""); setFamilyId(""); setWifeFirst(""); setKids([]); setGeneralUnit(""); }}>
                {Object.keys(data.factions).sort().map((fn) => <option key={fn} value={fn}>{lab(fn)}</option>)}
              </select>
              <span style={{ color: "#bbb" }}>Bodyguard</span>
              {fac.generalUnits && fac.generalUnits.length ? (
                <select style={{ ...sel, flex: 1, minWidth: 110 }} value={generalUnit} onChange={(e) => setGeneralUnit(e.target.value)}>
                  {fac.generalUnits.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              ) : (
                <span style={{ color: "#ddd", fontSize: "0.66rem" }}>{fac.generalUnit || "—"}</span>
              )}
            </div>

            <div style={row}>
              <span style={{ color: "#bbb" }}>Place at</span>
              <select style={{ ...sel, flex: 1, minWidth: 110 }} value={settlement || ""} onChange={(e) => setSettlement(e.target.value)}>
                <option value="">— pick settlement —</option>
                {owned.map((s) => <option key={s.region} value={s.city} disabled={s.x == null}>{s.city}{s.x == null ? " (no coords)" : ""}</option>)}
              </select>
              <span style={{ color: coords ? "#4a8" : "#e89030", fontSize: "0.66rem", whiteSpace: "nowrap" }}>{coords ? `x ${coords.x}, y ${coords.y}` : "no coords"}</span>
            </div>

            {fac.duplicates && fac.duplicates.length > 0 && (
              <div style={{ background: "#3a2e1c", border: "1px solid #6a5530", color: "#e8c98a", padding: 6, borderRadius: 4, marginBottom: 8, fontSize: "0.64rem" }}>
                ⚠ Existing duplicate names in this faction (can cause engine issues): {fac.duplicates.map((d) => `${d.key} ×${d.count}`).join(", ")}
              </div>
            )}

            <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "10px 0 8px" }} />
            <div style={row}>
              <span style={{ width: 84, color: "#fd8" }}>General</span>
              <NameSelect value={genFirst} pool={fac.maleFirst} onPick={setGenFirst} />
              <span style={{ color: "#bbb" }}>age</span>
              <input className="no-spin" style={num} type="number" min={16} max={82} value={genAge} onChange={(e) => setGenAge(e.target.value)} />
              <button style={dice} title="random age 16–82" onClick={() => setGenAge(randAge(16, 82))}>🎲</button>
            </div>

            <div style={row}>
              <span style={{ width: 84, color: "#bbb" }}>Family</span>
              <label style={{ cursor: "pointer" }}><input type="radio" checked={familyMode === "new"} onChange={() => setFamilyMode("new")} /> New line</label>
              <label style={{ cursor: "pointer" }}><input type="radio" checked={familyMode === "join"} onChange={() => setFamilyMode("join")} /> Join existing</label>
            </div>
            <div style={row}>
              <span style={{ width: 84, color: "#bbb" }}>{familyMode === "new" ? "Surname" : "Father"}</span>
              {familyMode === "new" ? (
                fac.usesSurnames ? (
                  surnameOptions.length ? (
                    <select style={{ ...sel, minWidth: 160 }} value={surname} onChange={(e) => setSurname(e.target.value)}>
                      {surnameOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <input style={{ ...sel, minWidth: 160 }} placeholder="surname" value={surname} onChange={(e) => setSurname(e.target.value)} />
                  )
                ) : (
                  <span style={{ color: "#778", fontSize: "0.66rem" }}>single-name culture — no surname</span>
                )
              ) : (
                fac.families.length ? (
                  <select style={{ ...sel, minWidth: 260 }} value={familyId} onChange={(e) => setFamilyId(e.target.value)}>
                    {fac.families.map((f) => <option key={f.id} value={f.id}>{f.display}{f.mother ? ` — wife: ${f.mother}` : ""}</option>)}
                  </select>
                ) : (
                  <span style={{ color: "#e89030", fontSize: "0.66rem" }}>no existing families in this faction</span>
                )
              )}
            </div>

            <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "10px 0 8px" }} />
            <div style={row}>
              <label style={{ width: 84, color: "#bbb", cursor: "pointer" }}><input type="checkbox" checked={wifeOn} onChange={(e) => setWifeOn(e.target.checked)} /> Wife</label>
              {wifeOn && <>
                <NameSelect value={wifeFirst} pool={fac.femaleFirst} onPick={setWifeFirst} />
                <span style={{ color: "#bbb" }}>age</span>
                <input className="no-spin" style={num} type="number" min={14} max={82} value={wifeAge} onChange={(e) => setWifeAge(e.target.value)} />
                <button style={dice} title="random age 16–82" onClick={() => setWifeAge(randAge(16, 82))}>🎲</button>
                <label style={{ cursor: "pointer", color: wifeDead ? "#e8a0a0" : "#bbb" }}><input type="checkbox" checked={wifeDead} onChange={(e) => setWifeDead(e.target.checked)} /> dead</label>
              </>}
            </div>

            <div style={{ marginBottom: 6 }}>
              <span style={{ color: "#bbb" }}>Children</span>
              <button onClick={addKid} style={{ ...sel, cursor: "pointer", marginLeft: 8, padding: "1px 8px" }}>+ add</button>
            </div>
            {kids.map((k, i) => (
              <div key={i} style={row}>
                <select style={{ ...sel, width: 92 }} value={k.gender} onChange={(e) => setKid(i, { gender: e.target.value, first: (e.target.value === "son" ? fac.maleFirst[0] : fac.femaleFirst[0]) || "" })}>
                  <option value="son">son</option><option value="daughter">daughter</option>
                </select>
                <NameSelect value={k.first} pool={k.gender === "son" ? fac.maleFirst : fac.femaleFirst} onPick={(v) => setKid(i, { first: v })} width={130} />
                <span style={{ color: "#bbb" }}>age</span>
                <input className="no-spin" style={num} type="number" min={0} max={40} value={k.age} onChange={(e) => setKid(i, { age: e.target.value })} />
                <button style={dice} title="random age 0–17" onClick={() => setKid(i, { age: randAge(0, 17) })}>🎲</button>
                <button onClick={() => delKid(i)} style={{ ...sel, cursor: "pointer", color: "#e8a0a0", padding: "1px 7px" }}>✕</button>
              </div>
            ))}

            <div style={{ marginTop: 14, textAlign: "right" }}>
              <button onClick={onClose} style={{ ...sel, cursor: "pointer", marginRight: 8 }}>Cancel</button>
              <button onClick={submit} disabled={busy || !coords || !genFirst} style={{ ...sel, cursor: busy ? "wait" : "pointer", background: coords && genFirst ? "#2a4a2f" : "#23262d", color: coords && genFirst ? "#bfe8bf" : "#777", fontWeight: 700 }}>
                {busy ? "Writing…" : "Add General"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
