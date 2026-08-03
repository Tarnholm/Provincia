// Mod-validation Dashboard modal, extracted from App.js (2026-07-15). The ~20
// data-fetching useEffects and all audit state stay in App.js (hooks can't move
// into a conditionally-rendered child); this component receives every audit
// slice + the shared DashSection/DashRow components + AOR constants as props and
// renders the dashboard. Body moved verbatim (closure vars -> same-named props),
// so behavior is byte-identical to the inline IIFE it replaced.
import React from "react";

export default function DashboardModal(props) {
  const {
    dashResult, dashLoading, setShowDashboard,
    portraitAudit, captainBannerAudit, modExtraAudit, descrRegionsAudit,
    regionScrollsAudit, smFactionsAudit, aorCoverage, edbResAudit,
    buildingImagesAudit, unitLocAudit, unitImagesAudit, logWarningsAudit,
    textureDimsAudit, modDataDir,
    PRIMARY_AOR_TAGS, SECONDARY_AOR_TO_FACTION,
    DashSection, DashRow,
  } = props;
        const r = dashResult;
        const jumpTo = (file, snippet, line) => window.electronAPI?.scriptsJumpTo?.(file, snippet || null, line || null);
        const Section = DashSection; // stable module-scope identity — see hoist note above App()
        // Tile → Section bridge. Each tile carries the prefix of its target
        // Section's title; click forces it open and scrolls it into view.
        // Substring match keeps tiles working when a section gets a suffix
        // appended (e.g. "(of 234 total)").
        const openSectionByTitle = (titlePrefix) => {
          if (!titlePrefix) return;
          const sections = document.querySelectorAll('details[data-dash-section]');
          for (const d of sections) {
            const t = d.getAttribute('data-dash-section') || '';
            if (t.startsWith(titlePrefix) || t.includes(titlePrefix)) {
              d.open = true;
              d.scrollIntoView({ behavior: 'smooth', block: 'start' });
              return;
            }
          }
        };
        const Row = DashRow; // stable module-scope identity
        return (
          <div onClick={() => setShowDashboard(false)} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            zIndex: 10001, display: "flex", alignItems: "flex-start", justifyContent: "center",
            paddingTop: "6vh",
          }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              background: "#1e1e1e", color: "#e6e6e6", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.10)",
              width: "min(820px, 92vw)", maxHeight: "86vh", overflow: "auto",
              padding: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
            }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                <h3 style={{ margin: 0, flex: 1, fontSize: "1.05rem" }}>Mod-validation dashboard</h3>
                <button onClick={() => setShowDashboard(false)} style={{
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                  color: "#ccc", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: "0.78rem",
                }}>Close</button>
              </div>
              {dashLoading || !r ? (
                <div style={{ padding: 20, color: "#888", textAlign: "center" }}>Scanning…</div>
              ) : r.error ? (
                <div style={{ padding: 14, color: "#f87171" }}>{r.error}</div>
              ) : (() => {
                const s = r.summary || {};
                const totalIssues = (s.danglingChains || 0) + (s.danglingLevels || 0) + (s.stratErrors || 0) + (s.missingLocale || 0);
                // New validators rolled into the top bar so the user sees
                // every category at-a-glance (added 0.9.683-0.9.697).
                const pBrokenTargets = (portraitAudit?.targets || []).filter(t => t.status !== 'ok').length;
                const cbMissing = (captainBannerAudit?.missing || []).length;
                const nlEmpty = (modExtraAudit?.namelistEmpty?.issues || []).length;
                const nlSingle = (modExtraAudit?.namelistSingle?.issues || []).length;
                const stratXref = (modExtraAudit?.stratTraitRefs?.issues || []).length +
                                  (modExtraAudit?.stratAncillaryRefs?.issues || []).length +
                                  (modExtraAudit?.stratUnitRefs?.issues || []).length;
                const facCult = (modExtraAudit?.factionCulture?.issues || []).length;
                const drIssues = (descrRegionsAudit?.stratMissingRegion || []).length +
                                 (descrRegionsAudit?.stratWrongSettlement || []).length +
                                 (descrRegionsAudit?.duplicateColors || []).length;
                const smIncomplete = (smFactionsAudit?.incomplete || []).length;
                const edbMissing = (edbResAudit?.missingResources || []).length;
                return (
                  <>
                    {/* Tile rows. The 4th tuple element is the prefix of the matching <Section title=…>;
                        clicking a tile force-opens that section and scrolls it into view. Tiles
                        with count 0 still scroll-jump (the empty section will say "all OK"). */}
                    {[
                      [
                        ["Dangling chains", s.danglingChains, "#f87171", "Dangling chain references"],
                        ["Dangling levels", s.danglingLevels, "#fb923c", "Dangling level references"],
                        ["descr_strat errors", s.stratErrors, "#facc15", "descr_strat settlement errors"],
                        ["Missing locale", s.missingLocale, "#a78bfa", "Missing localization keys"],
                        ["Orphaned chains", s.orphanedChains, "#9ca3af", "Orphaned chains"],
                        ["VC malformed", s.vcMalformed, "#f87171", "descr_win_conditions malformed lines"],
                        ["VC orphans", s.vcOrphanFactions, "#f87171", "VC orphan factions"],
                      ],
                      [
                        ["Portraits broken", pBrokenTargets, "#f87171", "Portrait coverage — broken target cultures"],
                        ["Captain banners missing", cbMissing, "#f87171", "Captain banner files missing per faction"],
                        ["Namelists empty", nlEmpty, "#f87171", "Empty namelists used by factions"],
                        ["Namelists single-entry", nlSingle, "#fbbf24", "Single-entry namelists used by factions"],
                        ["descr_strat xref", stratXref, "#fbbf24", "descr_strat traits not in EDCT"],
                        ["Faction culture", facCult, "#f87171", "Factions referencing undefined cultures"],
                        ["Chars sharing tile", (modExtraAudit?.charSharedCoords?.issues || []).length, "#f87171", "Characters sharing a map tile"],
                        ["Multi-general towns", (modExtraAudit?.charNearCityTile?.issues || []).length, "#f87171", "Settlements with more than one general at campaign start (engine displaces extras - they start FLEEING)"],
                        ["descr_regions issues", drIssues, "#f87171", "descr_strat regions not in descr_regions"],
                      ],
                      [
                        ["sm_factions incomplete", smIncomplete, "#fbbf24", "descr_sm_factions: incomplete faction blocks"],
                        ["EDB resource refs", edbMissing, "#fbbf24", "EDB hidden_resource refs not in descr_regions"],
                        ["AOR unmapped", (aorCoverage?.aors || []).filter(a => !PRIMARY_AOR_TAGS.has(a.name) && !SECONDARY_AOR_TO_FACTION[a.name]).length, "#9ca3af", "AOR tags in descr_regions not yet mapped"],
                        ["Building images", (buildingImagesAudit?.missing || []).length, "#fbbf24", "Building images missing"],
                        ["Unit localization", (unitLocAudit?.missing || []).length, "#9ca3af", "Unit type strings missing"],
                        ["Unit images", ((unitImagesAudit?.missingInfo || []).length + (unitImagesAudit?.missingCard || []).length), "#fbbf24", "Per-faction unit images missing"],
                        ["TGA pow-2", (textureDimsAudit?.nonPow2 || []).length, "#9ca3af", "Non-power-of-2 TGA dimensions"],
                        ["Undefined toggles", (logWarningsAudit?.undefinedToggles || []).length, "#fbbf24", "Campaign script: undefined toggles"],
                        ["RTW log warnings (total)", Object.values(logWarningsAudit?.counts || {}).reduce((a, b) => a + b, 0), "#9ca3af", "RTW log: cosmetic"],
                        ["Missing region_base", (regionScrollsAudit?.missing || []).length, "#f87171", "Settlements missing hinterland_region region_base"],
                      ],
                    ].map((row, rowIdx) => {
                      // Hide tiles with 0 issues — the clean ones aren't actionable.
                      // If a whole row goes to zero, skip the row entirely so we
                      // don't leave a blank grid gap.
                      const visible = row.filter(([, n]) => (n || 0) > 0);
                      if (visible.length === 0) return null;
                      return (
                      <div key={rowIdx} style={{ display: "grid", gridTemplateColumns: `repeat(${visible.length}, 1fr)`, gap: 8, marginBottom: 10 }}>
                        {visible.map(([label, n, color, sectionTitle]) => (
                          <div
                            key={label}
                            onClick={() => openSectionByTitle(sectionTitle)}
                            title={sectionTitle ? `Click → jump to "${sectionTitle}"` : ""}
                            style={{
                              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.10)",
                              borderRadius: 6, padding: "8px 10px", textAlign: "center",
                              cursor: sectionTitle ? "pointer" : "default",
                              transition: "background 0.1s",
                            }}
                            onMouseEnter={sectionTitle ? (e) => e.currentTarget.style.background = "rgba(255,255,255,0.07)" : undefined}
                            onMouseLeave={sectionTitle ? (e) => e.currentTarget.style.background = "rgba(255,255,255,0.03)" : undefined}
                          >
                            <div style={{ fontSize: "1.4rem", fontWeight: 700, color: (n || 0) > 0 ? color : "#4ade80", fontVariantNumeric: "tabular-nums" }}>{n || 0}</div>
                            <div style={{ fontSize: "0.66rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
                          </div>
                        ))}
                      </div>
                      );
                    })}
                    {totalIssues === 0 && (
                      <div style={{ padding: 12, background: "rgba(74,222,128,0.10)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 6, color: "#86efac", fontSize: "0.82rem" }}>
                        ✓ No correctness issues found. The {(s.orphanedChains || 0)} orphaned chains below are candidates for cleanup but not bugs.
                      </div>
                    )}
                    <Section title="Dangling chain references" count={s.danglingChains || 0} color="#f87171">
                      {(r.danglingChains || []).map((d, i) => (
                        <Row key={i} label={`${d.chain} — ${d.text}`} file={d.file} line={d.line} onClick={() => jumpTo(d.file, null, d.line)} />
                      ))}
                    </Section>
                    <Section title="Dangling level references" count={s.danglingLevels || 0} color="#fb923c">
                      {(r.danglingLevels || []).map((d, i) => (
                        <Row key={i} label={`${d.chain} → ${d.level} — ${d.text}`} file={d.file} line={d.line} onClick={() => jumpTo(d.file, null, d.line)} />
                      ))}
                    </Section>
                    <Section title="descr_strat settlement errors" count={s.stratErrors || 0} color="#facc15">
                      {(r.stratErrors || []).map((d, i) => (
                        <Row key={i} label={`${d.region}: type ${d.chain} ${d.level} — ${d.issue}`} file={d.file} line={d.line} onClick={() => jumpTo(d.file, null, d.line)} />
                      ))}
                    </Section>
                    <Section title="Missing localization keys" count={s.missingLocale || 0} color="#a78bfa">
                      {(r.missingLocale || []).map((d, i) => (
                        <Row key={i} label={`{${d.level}} — needed for ${d.chain}`} />
                      ))}
                    </Section>
                    <Section title="Orphaned chains (no refs, no prebuilts)" count={s.orphanedChains || 0} color="#9ca3af">
                      {(r.orphanedChains || []).map((d, i) => (
                        <Row key={i} label={d.chain} file={d.file} line={d.line} onClick={() => jumpTo(d.file, null, d.line)} />
                      ))}
                    </Section>
                    <Section title="descr_win_conditions malformed lines (silently kill VCs for every faction below)" count={s.vcMalformed || 0} color="#f87171">
                      {(r.vcMalformed || []).map((d, i) => (
                        <Row key={i} label={d.text} file={d.file} line={d.line} onClick={() => jumpTo(d.file, null, d.line)} />
                      ))}
                    </Section>
                    <Section title="VC orphan factions (header in win_conditions, faction not in descr_strat — kills VCs below)" count={s.vcOrphanFactions || 0} color="#f87171">
                      {(r.vcOrphanFactions || []).map((d, i) => (
                        <Row key={i} label={`${d.faction} — not a playable faction in descr_strat`} file={d.file} line={d.line} onClick={() => jumpTo(d.file, null, d.line)} />
                      ))}
                    </Section>
                    {portraitAudit && !portraitAudit.error && (() => {
                      const broken = (portraitAudit.sources || []).filter(s => s.status !== 'ok');
                      const brokenTargets = (portraitAudit.targets || []).filter(t => t.status !== 'ok');
                      return (
                        <>
                          <Section title={`Portrait coverage — broken target cultures (auto-spawned captains crash on these)`} count={brokenTargets.length} color="#f87171">
                            {brokenTargets.length > 0 && window.electronAPI?.autofixPortraits && (
                              <div style={{ padding: "4px 8px" }}>
                                <button
                                  onClick={async () => {
                                    if (!confirm(`Auto-seed missing data/ui/<target>/portraits/portraits/{young,old}/ for ${brokenTargets.length} cultures by copying tgas from any culture that has them? Files only created, never overwritten.`)) return;
                                    const r = await window.electronAPI.autofixPortraits(modDataDir);
                                    if (r.error) { alert(`Auto-fix failed: ${r.error}`); return; }
                                    alert(`Seeded ${r.copied} files across ${r.sources.length} target cultures from donor=${r.donor?.culture || '?'}.\n\nDashboard will re-audit on close+reopen.`);
                                  }}
                                  style={{
                                    background: "rgba(34,197,94,0.20)", border: "1px solid rgba(34,197,94,0.45)",
                                    color: "#bbf7d0", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: "0.72rem",
                                    fontWeight: 600,
                                  }}
                                >Auto-fix: copy tgas from any populated culture</button>
                              </div>
                            )}
                            {brokenTargets.map((t, i) => (
                              <Row key={i}
                                label={`${t.target}: ${t.status} — ${(t.notes || []).join("; ")}`}
                                file={t.expectedPath}
                              />
                            ))}
                            {brokenTargets.length === 0 && <div style={{ fontSize: "0.72rem", color: "#888", padding: "4px 8px" }}>All {(portraitAudit.targets || []).length} target portrait cultures have valid young/old directories.</div>}
                          </Section>
                          <Section title={`Portrait coverage — source cultures resolving to a broken target`} count={broken.length} color="#fbbf24">
                            {broken.map((s, i) => (
                              <Row key={i}
                                label={`${s.source} → portrait_mapping=${s.target} (${s.status})`}
                                file="descr_cultures.txt"
                                onClick={() => jumpTo("descr_cultures.txt", `"${s.source}":`, null)}
                              />
                            ))}
                            {broken.length === 0 && <div style={{ fontSize: "0.72rem", color: "#888", padding: "4px 8px" }}>All {(portraitAudit.sources || []).length} source cultures map to a target with valid portraits.</div>}
                          </Section>
                        </>
                      );
                    })()}
                    {portraitAudit && portraitAudit.error && (
                      <Section title="Portrait coverage — audit failed" count={1} color="#f87171">
                        <Row label={portraitAudit.error} />
                      </Section>
                    )}
                    {modExtraAudit && !modExtraAudit.error && (
                      <>
                        <Section title="Empty namelists used by factions (auto-spawn random(0,-1) → min<=max Failed)" count={(modExtraAudit.namelistEmpty?.issues || []).length} color="#f87171">
                          {(modExtraAudit.namelistEmpty?.issues || []).map((d, i) => (
                            <Row key={i}
                              label={`${d.namelist} (used by ${d.usedBy}: ${d.uses.map(u => u.faction + '/' + u.slot).join(', ')}${d.usedBy > 6 ? '…' : ''})`}
                              file="descr_namelists.txt"
                              onClick={() => jumpTo("descr_namelists.txt", `"${d.namelist}":`, null)}
                            />
                          ))}
                        </Section>
                        <Section title="Single-entry namelists used by factions (random(0,0) → min<=max Failed every captain spawn)" count={(modExtraAudit.namelistSingle?.issues || []).length} color="#fbbf24">
                          {(modExtraAudit.namelistSingle?.issues || []).map((d, i) => (
                            <Row key={i}
                              label={`${d.namelist} (used by ${d.usedBy}: ${d.uses.map(u => u.faction + '/' + u.slot).join(', ')}${d.usedBy > 6 ? '…' : ''})`}
                              file="descr_namelists.txt"
                              onClick={() => jumpTo("descr_namelists.txt", `"${d.namelist}":`, null)}
                            />
                          ))}
                        </Section>
                        <Section title="descr_strat traits not in EDCT (engine drops them silently)" count={(modExtraAudit.stratTraitRefs?.issues || []).length} color="#fbbf24">
                          {(modExtraAudit.stratTraitRefs?.issues || []).slice(0, 100).map((d, i) => (
                            <Row key={i}
                              label={`${d.trait} (${d.faction} → ${d.character || '?'})`}
                              file={d.file} line={d.line}
                              onClick={() => jumpTo(d.file, null, d.line)}
                            />
                          ))}
                        </Section>
                        <Section title="descr_strat ancillaries not in EDA" count={(modExtraAudit.stratAncillaryRefs?.issues || []).length} color="#fbbf24">
                          {(modExtraAudit.stratAncillaryRefs?.issues || []).slice(0, 100).map((d, i) => (
                            <Row key={i}
                              label={`${d.ancillary} (${d.faction} → ${d.character || '?'})`}
                              file={d.file} line={d.line}
                              onClick={() => jumpTo(d.file, null, d.line)}
                            />
                          ))}
                        </Section>
                        <Section title="Characters sharing a map tile (engine shifts one at spawn — breaks governor binding)" count={(modExtraAudit.charSharedCoords?.issues || []).length} color="#f87171">
                          {(modExtraAudit.charSharedCoords?.issues || []).slice(0, 100).map((d, i) => (
                            <div key={i} style={{ padding: "2px 0", fontSize: "0.78rem", color: "#ccc" }}>
                              <b style={{ color: "#f87171" }}>({d.xy})</b> {(d.characters || []).map(c => `${c.faction}: ${c.name} (${c.type})`).join("  ·  ")}
                            </div>
                          ))}
                          {(modExtraAudit.charSharedCoords?.issues || []).length === 0 && <div style={{ color: "#7fd17f", fontSize: "0.78rem" }}>No shared tiles — all character coordinates unique.</div>}
                        </Section>
                        <Section title="descr_strat army units not in EDU (engine refuses to load)" count={(modExtraAudit.stratUnitRefs?.issues || []).length} color="#f87171">
                          {(modExtraAudit.stratUnitRefs?.issues || []).slice(0, 100).map((d, i) => (
                            <Row key={i}
                              label={`${d.unit} (${d.faction} → ${d.character || '?'})`}
                              file={d.file} line={d.line}
                              onClick={() => jumpTo(d.file, null, d.line)}
                            />
                          ))}
                        </Section>
                        <Section title="Factions referencing undefined cultures" count={(modExtraAudit.factionCulture?.issues || []).length} color="#f87171">
                          {(modExtraAudit.factionCulture?.issues || []).map((d, i) => (
                            <Row key={i}
                              label={`${d.faction} → culture=${d.culture} (not in descr_cultures.txt)`}
                              file={d.file} line={d.line}
                              onClick={() => jumpTo(d.file, null, d.line)}
                            />
                          ))}
                        </Section>
                      </>
                    )}
                    {modExtraAudit && modExtraAudit.error && (
                      <Section title="Mod-data audit failed" count={1} color="#f87171">
                        <Row label={modExtraAudit.error} />
                      </Section>
                    )}
                    {captainBannerAudit && !captainBannerAudit.error && (
                      <Section
                        title={`Captain banner files missing per faction (each missing file triggers record.m_card_path.is_valid() Failed crash)`}
                        count={(captainBannerAudit.missing || []).length}
                        color="#f87171"
                      >
                        {(captainBannerAudit.missing || []).length > 0 && window.electronAPI?.autofixCaptainBanners && (
                          <div style={{ padding: "4px 8px" }}>
                            <button
                              onClick={async () => {
                                if (!confirm(`Auto-seed missing captain banner files for ${(captainBannerAudit.missing || []).length} factions by copying from a same-culture donor faction? Files will only be CREATED, never overwritten.`)) return;
                                const r = await window.electronAPI.autofixCaptainBanners(modDataDir);
                                if (r.error) { alert(`Auto-fix failed: ${r.error}`); return; }
                                alert(`Seeded ${r.copied} files across ${(captainBannerAudit.missing || []).length} factions. ${r.noDonor.length ? r.noDonor.length + ' factions had no same-culture donor available.' : ''}\n\nDashboard will re-audit on close+reopen.`);
                              }}
                              style={{
                                background: "rgba(34,197,94,0.20)", border: "1px solid rgba(34,197,94,0.45)",
                                color: "#bbf7d0", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: "0.72rem",
                                fontWeight: 600,
                              }}
                            >Auto-fix: copy from same-culture donors</button>
                          </div>
                        )}
                        {(captainBannerAudit.missing || []).slice(0, 100).map((d, i) => (
                          <Row key={i}
                            label={`${d.faction} — missing: ${d.missing.join(', ')}`}
                            file="data/ui/captain banners/"
                          />
                        ))}
                        {(captainBannerAudit.missing || []).length === 0 && (
                          <div style={{ fontSize: "0.72rem", color: "#888", padding: "4px 8px" }}>
                            All {captainBannerAudit.summary?.factionsTotal || '?'} factions have their captain_portrait + captain_card files (and rebel variants).
                          </div>
                        )}
                      </Section>
                    )}
                    {captainBannerAudit && captainBannerAudit.error && (
                      <Section title="Captain banner audit failed" count={1} color="#f87171">
                        <Row label={captainBannerAudit.error} />
                      </Section>
                    )}
                    {descrRegionsAudit && !descrRegionsAudit.error && (
                      <>
                        <Section title="descr_strat regions not in descr_regions (engine load error)" count={(descrRegionsAudit.stratMissingRegion || []).length} color="#f87171">
                          {(descrRegionsAudit.stratMissingRegion || []).slice(0, 100).map((d, i) => (
                            <Row key={i} label={d.region} file={d.file} line={d.line} onClick={() => jumpTo(d.file, null, d.line)} />
                          ))}
                        </Section>
                        <Section title="descr_strat city name doesn't match descr_regions for that region" count={(descrRegionsAudit.stratWrongSettlement || []).length} color="#fbbf24">
                          {(descrRegionsAudit.stratWrongSettlement || []).slice(0, 100).map((d, i) => (
                            <Row key={i} label={`${d.region}: strat=${d.stratSays} vs regions=${d.regionsExpects}`} file={d.file} line={d.line} onClick={() => jumpTo(d.file, null, d.line)} />
                          ))}
                        </Section>
                        <Section title="Duplicate region tile-colors in descr_regions (engine crash on load)" count={(descrRegionsAudit.duplicateColors || []).length} color="#f87171">
                          {(descrRegionsAudit.duplicateColors || []).slice(0, 100).map((d, i) => (
                            <Row key={i} label={`color ${d.color}: ${d.regions.map(r => r.region).join(', ')}`} file="descr_regions.txt" />
                          ))}
                        </Section>
                        <Section title="Orphan regions (in descr_regions, never used by descr_strat)" count={(descrRegionsAudit.orphanRegions || []).length} color="#9ca3af">
                          {(descrRegionsAudit.orphanRegions || []).slice(0, 100).map((d, i) => (
                            <Row key={i} label={`${d.region} (settlement: ${d.settlement || '?'})`} file={d.file} line={d.line} onClick={() => jumpTo(d.file, null, d.line)} />
                          ))}
                        </Section>
                      </>
                    )}
                    {descrRegionsAudit && descrRegionsAudit.error && (
                      <Section title="descr_regions audit failed" count={1} color="#f87171">
                        <Row label={descrRegionsAudit.error} />
                      </Section>
                    )}
                    {regionScrollsAudit && !regionScrollsAudit.error && (
                      <Section
                        title={`Settlements missing hinterland_region region_base building${regionScrollsAudit.total ? ` (of ${regionScrollsAudit.total} total)` : ''}`}
                        count={(regionScrollsAudit.missing || []).length}
                        color="#f87171"
                      >
                        {(regionScrollsAudit.missing || []).slice(0, 200).map((d, i) => (
                          <Row key={i} label={d.region} file="descr_strat.txt" line={d.line} onClick={() => jumpTo("descr_strat.txt", null, d.line)} />
                        ))}
                        {(regionScrollsAudit.missing || []).length === 0 && (
                          <div style={{ fontSize: "0.72rem", color: "#888", padding: "4px 8px" }}>
                            All {regionScrollsAudit.total} settlements have hinterland_region region_base. Region scrolls render correctly.
                          </div>
                        )}
                      </Section>
                    )}
                    {regionScrollsAudit && regionScrollsAudit.error && (
                      <Section title="Region-scroll audit failed" count={1} color="#f87171">
                        <Row label={regionScrollsAudit.error} />
                      </Section>
                    )}
                    {smFactionsAudit && !smFactionsAudit.error && (
                      <Section
                        title={`descr_sm_factions: incomplete faction blocks (missing required fields)`}
                        count={(smFactionsAudit.incomplete || []).length}
                        color="#fbbf24"
                      >
                        {(smFactionsAudit.incomplete || []).slice(0, 100).map((d, i) => (
                          <Row key={i}
                            label={`${d.faction} — missing: ${d.missing.join(', ')}`}
                            file="descr_sm_factions.txt" line={d.line}
                            onClick={() => jumpTo("descr_sm_factions.txt", `"${d.faction}":`, d.line)}
                          />
                        ))}
                        {(smFactionsAudit.incomplete || []).length === 0 && (
                          <div style={{ fontSize: "0.72rem", color: "#888", padding: "4px 8px" }}>
                            All {smFactionsAudit.summary?.total || '?'} factions have culture, men/women/surnames namelists, logos, colours, movies.
                          </div>
                        )}
                      </Section>
                    )}
                    {smFactionsAudit && smFactionsAudit.error && (
                      <Section title="descr_sm_factions audit failed" count={1} color="#f87171">
                        <Row label={smFactionsAudit.error} />
                      </Section>
                    )}
                    {aorCoverage && !aorCoverage.error && (() => {
                      const uncovered = (aorCoverage.aors || []).filter(a => !PRIMARY_AOR_TAGS.has(a.name) && !SECONDARY_AOR_TO_FACTION[a.name]);
                      return (
                        <Section
                          title={`AOR tags in descr_regions not yet mapped in Provincia (cycling palette, no faction color)`}
                          count={uncovered.length}
                          color="#9ca3af"
                        >
                          {uncovered.slice(0, 60).map((a, i) => (
                            <Row key={i}
                              label={`aor_${a.name} — ${a.count} region(s)`}
                              file="descr_regions.txt"
                            />
                          ))}
                          {uncovered.length === 0 && (
                            <div style={{ fontSize: "0.72rem", color: "#888", padding: "4px 8px" }}>
                              All {(aorCoverage.aors || []).length} AORs in descr_regions are mapped.
                            </div>
                          )}
                        </Section>
                      );
                    })()}
                    {aorCoverage && aorCoverage.error && (
                      <Section title="AOR coverage report failed" count={1} color="#f87171">
                        <Row label={aorCoverage.error} />
                      </Section>
                    )}
                    {edbResAudit && !edbResAudit.error && (
                      <Section
                        title={`EDB hidden_resource refs not in descr_regions (dead-code recruit lines, silently never fire)`}
                        count={(edbResAudit.missingResources || []).length}
                        color="#fbbf24"
                      >
                        {(edbResAudit.missingResources || []).slice(0, 100).map((d, i) => (
                          <Row key={i}
                            label={`${d.resource} — ${d.refCount} EDB ref(s); first at L${d.firstLine}`}
                            file="export_descr_buildings.txt"
                            line={d.firstLine}
                            onClick={() => jumpTo("export_descr_buildings.txt", null, d.firstLine)}
                          />
                        ))}
                      </Section>
                    )}
                    {edbResAudit && edbResAudit.error && (
                      <Section title="EDB resource audit failed" count={1} color="#f87171">
                        <Row label={edbResAudit.error} />
                      </Section>
                    )}
                    {buildingImagesAudit && !buildingImagesAudit.error && (
                      <Section
                        title={`Building images missing — constructed + preconstruction (UI shows blank in-game)`}
                        count={(buildingImagesAudit.missing || []).length}
                        color="#fbbf24"
                      >
                        {(buildingImagesAudit.missing || []).length > 0 && window.electronAPI?.autofixBuildingImages && (
                          <div style={{ padding: "4px 8px" }}>
                            <button
                              onClick={async () => {
                                const s = buildingImagesAudit.summary || {};
                                if (!confirm(`Auto-seed ${s.missingConstructed || 0} missing _constructed.tga + ${s.missingPreconstruction || 0} missing buildings/construction/ images by copying the matching base #<culture>_<chain>.tga? Files only created, never overwritten.`)) return;
                                const r = await window.electronAPI.autofixBuildingImages(modDataDir);
                                if (r.error) { alert(`Auto-fix failed: ${r.error}`); return; }
                                alert(`Seeded ${r.copied} building image files (constructed + preconstruction). Dashboard will re-audit on close+reopen.`);
                              }}
                              style={{
                                background: "rgba(34,197,94,0.20)", border: "1px solid rgba(34,197,94,0.45)",
                                color: "#bbf7d0", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: "0.72rem",
                                fontWeight: 600,
                              }}
                            >Auto-fix: copy base → both slots</button>
                          </div>
                        )}
                        {(buildingImagesAudit.missing || []).slice(0, 80).map((d, i) => {
                          const parts = [];
                          if (d.missingConstructed) parts.push(`_constructed.tga`);
                          if (d.missingPreconstruction) parts.push(`construction/`);
                          return (
                            <Row key={i}
                              label={`${d.culture} → ${d.chain} — missing: ${parts.join(', ')}`}
                              file={`data/ui/${d.culture}/buildings/`}
                            />
                          );
                        })}
                      </Section>
                    )}
                    {unitLocAudit && !unitLocAudit.error && (
                      <Section
                        title={`Unit dictionary strings missing in text/export_units.txt (shows raw ID in-game)`}
                        count={(unitLocAudit.missing || []).length}
                        color="#9ca3af"
                      >
                        {(unitLocAudit.missing || []).slice(0, 100).map((d, i) => (
                          <Row key={i}
                            label={`${d.key || d.unit} — missing: ${d.missing.join(', ')}${
                              d.suggest ? `  → did you mean {${d.suggest}}?` : ''
                            }${
                              d.types && d.types.length ? `  (EDU type${d.types.length > 1 ? 's' : ''}: ${d.types.slice(0, 3).join(', ')}${d.types.length > 3 ? ` +${d.types.length - 3}` : ''})` : ''
                            }`}
                            file="text/export_units.txt"
                          />
                        ))}
                      </Section>
                    )}
                    {textureDimsAudit && !textureDimsAudit.error && (
                      <Section
                        title={`Non-power-of-2 TGA dimensions (STANDARD_TEXTUREs mip-map warning)`}
                        count={(textureDimsAudit.nonPow2 || []).length}
                        color="#9ca3af"
                      >
                        {(textureDimsAudit.nonPow2 || []).slice(0, 80).map((d, i) => (
                          <Row key={i}
                            label={`${d.dir}/${d.file} — ${d.w}×${d.h} (resize to nearest pow-2)`}
                            file={`${d.dir}/${d.file}`}
                          />
                        ))}
                        {(textureDimsAudit.nonPow2 || []).length === 0 && (
                          <div style={{ fontSize: "0.72rem", color: "#888", padding: "4px 8px" }}>
                            All {textureDimsAudit.summary?.scanned || '?'} ancillary + building TGAs are power-of-2.
                          </div>
                        )}
                      </Section>
                    )}
                    {logWarningsAudit && !logWarningsAudit.error && (
                      <>
                        <Section
                          title={`RTW log: cosmetic & engine-internal warnings (from message_log.txt — informational, fix where possible)`}
                          count={Object.values(logWarningsAudit.counts || {}).reduce((a, b) => a + b, 0)}
                          color="#9ca3af"
                        >
                          <div style={{ fontSize: "0.7rem", color: "#888", padding: "2px 8px" }}>
                            log last modified: {logWarningsAudit.lastModified ? new Date(logWarningsAudit.lastModified).toLocaleString() : "?"}
                          </div>
                          {Object.entries(logWarningsAudit.counts || {}).sort((a, b) => b[1] - a[1]).map(([label, n]) => (
                            <Row key={label} label={`${label}: ${n.toLocaleString()}`} file="message_log.txt" />
                          ))}
                        </Section>
                        <Section
                          title={`Campaign script: undefined toggles (engine defaults; fix: add console_command declarations)`}
                          count={(logWarningsAudit.undefinedToggles || []).length}
                          color="#fbbf24"
                        >
                          {(logWarningsAudit.undefinedToggles || []).map((t, i) => (
                            <Row key={i} label={t} file="RIS_Campaign_Script.txt" />
                          ))}
                        </Section>
                        <Section
                          title={`Missing localised strings (engine fell back to raw key)`}
                          count={(logWarningsAudit.lostLocStrings || []).length}
                          color="#9ca3af"
                        >
                          {(logWarningsAudit.lostLocStrings || []).map((s, i) => (
                            <Row key={i} label={s} file="text/" />
                          ))}
                        </Section>
                      </>
                    )}
                    {unitImagesAudit && !unitImagesAudit.error && (() => {
                      const total = (unitImagesAudit.missingInfo || []).length + (unitImagesAudit.missingCard || []).length;
                      return (
                        <Section
                          title={`Per-faction unit images missing (unit_info + units card slots)`}
                          count={total}
                          color="#fbbf24"
                        >
                          {total > 0 && window.electronAPI?.autofixUnitImages && (
                            <div style={{ padding: "4px 8px" }}>
                              <button
                                onClick={async () => {
                                  const s = unitImagesAudit.summary || {};
                                  if (!confirm(`Auto-seed ${s.missingInfoCount || 0} missing unit_info tgas + ${s.missingCardCount || 0} missing unit card tgas by copying from any other faction that has them? Files only created, never overwritten.`)) return;
                                  const r = await window.electronAPI.autofixUnitImages(modDataDir);
                                  if (r.error) { alert(`Auto-fix failed: ${r.error}`); return; }
                                  alert(`Seeded ${r.copied} unit image files. ${r.skipped.length ? r.skipped.length + ' had no donor in any faction (truly missing — needs new art).' : ''}\nDashboard will re-audit on close+reopen.`);
                                }}
                                style={{
                                  background: "rgba(34,197,94,0.20)", border: "1px solid rgba(34,197,94,0.45)",
                                  color: "#bbf7d0", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: "0.72rem",
                                  fontWeight: 600,
                                }}
                              >Auto-fix: copy from other factions</button>
                            </div>
                          )}
                          {(unitImagesAudit.missingInfo || []).slice(0, 50).map((d, i) => (
                            <Row key={"info-"+i} label={`${d.faction}/${d.unit} — missing _info.tga`} file={`data/ui/unit_info/${d.faction}/`} />
                          ))}
                          {(unitImagesAudit.missingCard || []).slice(0, 50).map((d, i) => (
                            <Row key={"card-"+i} label={`${d.faction}/${d.unit} — missing card .tga`} file={`data/ui/units/${d.faction}/`} />
                          ))}
                        </Section>
                      );
                    })()}
                    {buildingImagesAudit && buildingImagesAudit.error && (
                      <Section title="Building images audit failed" count={1} color="#f87171">
                        <Row label={buildingImagesAudit.error} />
                      </Section>
                    )}
                    {unitLocAudit && unitLocAudit.error && (
                      <Section title="Unit localization audit failed" count={1} color="#f87171">
                        <Row label={unitLocAudit.error} />
                      </Section>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        );
}
