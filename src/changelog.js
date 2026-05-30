/**
 * Changelog entries, newest first.
 * Each entry: { version, date, items: [{ type, text }] }
 * Types: "feature", "fix", "improvement", "change"
 *
 * Display versions only — the 4th segment in package.json (e.g. "0.9.2.10") is a
 * silent iteration counter for test builds and is stripped before gating/display.
 */
const CHANGELOG = [
  {
    version: "0.9.754",
    date: "2026-05-31",
    items: [
      { type: "improvement", text: "**Diplomacy: protectorates + relationship timers.** The save's diplomacy now distinguishes a plain **alliance** (bond 54/54) from a **protectorate** (54/55 — the suzerain is surfaced as `faction.protectorates`), and exposes per-pair **turns-allied** and **turns-at-war** counters. Verified across consecutive turns (counters tick 0→1→2)." },
      { type: "improvement", text: "**RIS campaign-script state** — the save's Lua persistent counters are decoded and bucketed into faction IDs, live script state (reform / rebellion / battle timers), and engine flags, exposed on `crackSave().scriptCounters`. (Note: RIS's `turn_number` counter is a season toggle, not the real turn — the real turn comes from the econ-history block count.)" },
    ],
  },
  {
    version: "0.9.753",
    date: "2026-05-31",
    items: [
      { type: "improvement", text: "**Scripted-event schedule from saves** — the campaign's historical events and disasters (volcano/earthquake/flood/storm/plague/locusts) are now decoded from the save's `descr_events` table with year, season, map position, scale and the eruption `warning` flag. Exposed on `crackSave().eventSchedule`; the static schedule is distinguished from engine-appended random disasters, and \"pending\" events are those dated after the current turn." },
    ],
  },
  {
    version: "0.9.752",
    date: "2026-05-31",
    items: [
      { type: "improvement", text: "**Per-settlement runtime fields from saves** — population growth (this turn's net change), income, current public order (plus the raw order-breakdown line-items), and the governor character link are now decoded from the save and exposed on `crackSave().settlementFields`. Verified against turn-to-turn ground truth (the projected→committed population roll-forward holds exactly)." },
    ],
  },
  {
    version: "0.9.751",
    date: "2026-05-31",
    items: [
      { type: "feature", text: "**End-of-turn event log from saves** — births, deaths, marriages, adoptions, settlement sieges/captures/losses, governor appointments and faction defeats are now decoded directly from the save (each tagged with its faction). Exposed on `crackSave().events`; a `diffTurn()` between two consecutive saves yields exactly \"what happened last turn\" — an authoritative, structured alternative to scraping message_log.txt." },
    ],
  },
  {
    version: "0.9.750",
    date: "2026-05-31",
    items: [
      { type: "feature", text: "**Live siege turns** — besieged settlements now show a turns-remaining label (e.g. \"5t\") on the live map, decoded straight from the save's siege record (the besieger's turn counter resets to 5 and counts down; 0 = ripe to fall)." },
      { type: "improvement", text: "**Full family roster from saves** — wives, daughters, young sons and dead relatives are now parsed from the save (name, age, gender, alive/dead, and father/spouse/child links), not just the trait-anchored generals. Members are attributed to factions via the family link graph (~91% coverage). Exposed on `crackSave().characters.family` / `familyByFaction`." },
      { type: "improvement", text: "**Save reader internals**: new siege + vision (fog-of-war) parsers; Lua counter classification (id / script-state / engine buckets) with the RIS `turn_number` season-toggle trap documented; 7 new message-log event types (triumph points, settlement captures, marriages, births, governor appointments)." },
    ],
  },
  {
    version: "0.9.749",
    date: "2026-05-29",
    items: [
      { type: "improvement", text: "**Greek / Aegean / Pontic-coast AOR secondary colours** (17 mappings): byzantine→Byzantium, mesembrian & tomian→Pentapolis, istrian→Histria, thessalian→Thessaly, akarnanian→Acarnania, ambrakiote→Epirus, aitolian→Aetolia, boiotian→Boeotia, athenian→Athens, argive→Argos, megalopolitan & arcadian→Megalopolis, achaian→Achaea, elean→Elis, messenian→Messene, rhodian→Rhodes." },
    ],
  },
  {
    version: "0.9.748",
    date: "2026-05-29",
    items: [
      { type: "improvement", text: "**More Thracian/Balkan AOR colours:** aor_bessian→Bessi, aor_paionian→Paeonia, aor_kabylean→Cabyle, aor_galato-thracian→Triballi, aor_thynian→Asti. And **aor_thracian_hillmen is now a Specialty AOR** (unit-specific, excluded from the regional map/legend)." },
    ],
  },
  {
    version: "0.9.747",
    date: "2026-05-29",
    items: [
      { type: "fix", text: "**Scripts: “Save back to mod” now writes descr_strat to BOTH the base campaign copy and the original_overrides copy** when a mod ships both. Previously it wrote only the first one found, so the engine could keep loading a stale descr_strat from the other location (symptom: ran Heavy Industry, but Athens still showed the old marble building in-game). Each copy is backed up before overwrite." },
    ],
  },
  {
    version: "0.9.746",
    date: "2026-05-29",
    items: [
      { type: "improvement", text: "**AOR colour: aor_scordiscian → Scordisci.**" },
    ],
  },
  {
    version: "0.9.745",
    date: "2026-05-29",
    items: [
      { type: "improvement", text: "**AOR colour: aor_dalmatian → Delmatae** (completes the Illyrian set; the tag is spelled `aor_dalmatian`)." },
    ],
  },
  {
    version: "0.9.744",
    date: "2026-05-29",
    items: [
      { type: "improvement", text: "**Illyrian/Balkan AOR secondary colours:** aor_dardanian→Dardania, aor_issaian→Issa, aor_daesitiate→Daesitiates, aor_iapodian→Iapodes, aor_liburnian→Liburni, aor_histrian→Histri, aor_labeataean→Labeatae. (`aor_delmatian` isn't present in the region data, so it was skipped.)" },
    ],
  },
  {
    version: "0.9.743",
    date: "2026-05-29",
    items: [
      { type: "improvement", text: "**AOR map: unmapped AORs now have a stable colour.** AORs without a faction-mapped colour previously used an order-dependent cycling palette, so they shuffled colours every render/session. They now get a deterministic colour derived from the AOR name — stable over time, and consistent between the map and the legend." },
      { type: "fix", text: "**save→descr_strat: faction order fixed (diplomacy + treasury).** The exporter was reading only the ~143 factions that have namelists as its faction-index order; it now reads the full descr_sm_factions declaration order (239). This makes the live diplomacy matrix locate correctly (it was timing out and falling back to a slow scan that emitted starting-state diplomacy) — Carthage turn-3 now overlays 780 attitude + 1341 aggression changes from the save — and treasury attribution rises from 130 to 221 factions." },
    ],
  },
  {
    version: "0.9.742",
    date: "2026-05-29",
    items: [
      { type: "improvement", text: "**More Italic AOR secondary colours:** `aor_italiote` → Taras, `aor_campanian` → Capua, `aor_sabellian` → Ardiaei (no dedicated Sabellian faction exists, so it borrows Ardiaei's colour). (`aor_deuteroi` was already a Specialty AOR.)" },
    ],
  },
  {
    version: "0.9.741",
    date: "2026-05-29",
    items: [
      { type: "change", text: "**Specialty AORs no longer appear in the Secondary map layer or legend.** `aor_camillan`, `aor_euzonoi`, `aor_deuteroi` and `aor_oscan_southern` are unit/reform-specific zones, not geographic — they're now excluded from both the Primary and Secondary AOR map layers and the legend, and shown only in the AOR Units “Specialty” tab." },
    ],
  },
  {
    version: "0.9.740",
    date: "2026-05-29",
    items: [
      { type: "fix", text: "**AOR map now recolours instantly when you click Primary / Secondary in the Areas of Recruitment sidebar.** The map's recolor effect wasn't watching the Primary/Secondary toggle, so the colours only updated on the next unrelated redraw — now the sidebar button drives the map directly." },
      { type: "fix", text: "**save→descr_strat: player treasury and faction mapping fixed.** Treasuries and the diplomacy matrix are now mapped by descr_sm_factions declaration order (the engine's real index order), not the old rebel-shuffled descr_strat order that mis-attributed them. The player faction's denari is now read from its record (the first sub=6 record) instead of emitting 0 — e.g. Carthage turn-3 now exports denari 43075." },
    ],
  },
  {
    version: "0.9.739",
    date: "2026-05-29",
    items: [
      { type: "improvement", text: "**AOR map: removed the diagonal stripes.** Now that Primary and Secondary AORs are separate toggle views, each region gets a single solid zone colour driven by the active layer (Primary or Secondary) — no more striping overlay. Regions with no AOR in the selected layer fall back to their other-layer zone, or muted neutral if they have none." },
    ],
  },
  {
    version: "0.9.738",
    date: "2026-05-29",
    items: [
      { type: "improvement", text: "**AOR map colours: Oscan hierarchy.** `aor_oscan` (the broad primary bucket) now uses the Italics colour; its secondary sub-AORs `aor_samnite` and `aor_lucanian` use the Samnites and Lucanians colours respectively (use the Primary/Secondary toggle to switch layers). `aor_campanian` has no faction of its own, so it stays on the cycling palette." },
      { type: "change", text: "**`aor_oscan_southern` is now a Specialty AOR** (it gates spearmen, not a region) — so it shows under the AOR Units “Specialty” tab rather than cluttering the regional roster." },
    ],
  },
  {
    version: "0.9.737",
    date: "2026-05-29",
    items: [
      { type: "feature", text: "**AOR mode: Regional vs Specialty zone tabs.** Some AORs gate a specific unit-type or reform-era roster rather than a geographic culture (e.g. `aor_camillan` = Roman manipular-era units in Italy; `aor_euzonoi` / `aor_deuteroi` = specific Greek troop classes). These are now kept out of the default **Regional** view and shown under a **Specialty** tab, so they no longer clutter the normal cultural/regional roster. (Curated list — extend as more are found.)" },
      { type: "feature", text: "**AOR mode: faction picker in Factional view.** When the Factional filter is on and the region's roster spans multiple factions (a Greek region can span 50+), a chip row lets you narrow to a single faction (or All). Previously you'd just see the whole faction-locked set — in Italy that's only the Roman factions, which is correct, but Greek/eastern regions needed the picker." },
    ],
  },
  {
    version: "0.9.736",
    date: "2026-05-29",
    items: [
      { type: "fix", text: "**Elephant (and other strategic-resource) units now require the resource in the region.** Elephant units are gated on `resource elephants` (a strategic resource placed on the map), not an aor_ hidden-resource — the recruit/AOR filters previously ignored `resource` gates entirely, so elephants could appear in regions with no elephant resource. Both the normal Recruitable panel and the AOR roster now honour `resource X` / `not resource X` against the region's actual resources. AOR mode also now surfaces resource-gated units (e.g. elephants group under an \"elephants\" zone)." },
      { type: "feature", text: "**AOR mode: 3-way faction filter toggle** (Factional / All factions / Both) in the AOR Units panel header. \"Factional\" shows only units locked to specific factions (e.g. a faction's own elephant/native variant), \"All factions\" shows the generic AOR units any faction can train, \"Both\" shows everything. Persists across sessions." },
    ],
  },
  {
    version: "0.9.735",
    date: "2026-05-29",
    items: [
      { type: "improvement", text: "**AOR units now take over the Recruitable panel in AOR mode** and render as unit cards (same grid as the normal recruitable list) instead of a separate text widget. Units with a faction restriction get a coloured outline plus a small caption — green \"only: …\" or amber \"not: …\" — with the full faction list in the hover tooltip; the card also lists its aor_ tag(s) on hover. Cards without a resolved icon fall back to the unit name so the grid stays readable." },
      { type: "fix", text: "**AOR map: `aor_etruscan` is now a primary AOR** coloured with Volsinii's faction colour (the map previously keyed it as `aor_etrurian`, a tag that doesn't exist in the data, so Etruscan regions fell through to the cycling palette)." },
    ],
  },
  {
    version: "0.9.734",
    date: "2026-05-29",
    items: [
      { type: "feature", text: "**AOR mode: click a region to see its full Area-of-Recruitment roster.** When the map is in AOR colour mode, clicking a region now shows an \"AOR Units\" panel listing every AOR unit the region's land enables — grouped by aor_ tag and **owner-independent**, so the correct units appear no matter who holds the region. Each unit carries a faction-restriction note where one applies (e.g. Achaian Hoplites appear under aor_achaian flagged \"all except Achaea\", and the native Achaea-only variant is flagged \"Achaea only\"). Honors `not hidden_resource` exclusions (so e.g. aor_asian units don't show in Greek regions). The panel only appears in AOR mode." },
    ],
  },
  {
    version: "0.9.733",
    date: "2026-05-29",
    items: [
      { type: "fix", text: "**Diplomacy matrix fully cracked & fixed.** The runtime diplomacy matrix (239×239, 267-byte cells) is now located by a self-aligning locator: it finds the cell signature, then snaps to the true (0,0) by maximising symmetry among the *non-neutral* state cells. The old locator used symmetry over ALL cells — dominated by the ~95% neutral cells — and locked the wrong offset, which is what produced the phantom wars and wrong ally lists. Validated to 99.9% against clean Julii (faction index 0) and Carthage (index 4) turn 1/2/3 saves." },
      { type: "fix", text: "**`att=600` is correctly classified as WAR again.** v0.9.732 reclassified it as merely \"hostile\" — that was a misdiagnosis of the locator bug above. With the corrected locator, the +12 state field maps exactly to descr_strat faction_relationships (0=allied, 200=neutral, 600=at war). Carthage turn 1 now reads: at war only with rebels, allied with gades/masaesyli/massylii — exactly its in-game starting diplomacy." },
      { type: "improvement", text: "**Alliances/protectorates read from the bond field (+20).** Formal alliances (bond 54/55) are surfaced as trade/ally partners independent of the attitude value, matching the descr_strat 199 (alliance) pairs." },
    ],
  },
  {
    version: "0.9.732",
    date: "2026-05-29",
    items: [
      { type: "fix", text: "**Diplomacy stance no longer reports phantom wars.** `att=600/850/1000` in the runtime attitude matrix were being classified as `war/total_war/crazy`, but verification against Julii T7 showed those cells are NOT formal wars (T7 had 4 cells at att=600 yet was only at war with the slave faction). All `att>=400` codes now classify as `hostile` — `war` is never inferred from the matrix. Eliminates the bogus war flags the overlay was showing." },
      { type: "improvement", text: "**Diplomacy matrix now indexed by `descr_sm_factions` order** (not `descr_strat` order), with a `makeDiplomacyPairReader` for round-trip emit. Reduces the phantom multi-ally lists. Known remaining limitation: the matrix locator is still approximate across non-Julii saves — ally lists should be treated as indicative until a controlled before/after-agreement save pair is available to finish cracking the locator." },
    ],
  },
  {
    version: "0.9.731",
    date: "2026-05-29",
    items: [
      { type: "fix", text: "**Dummies player detection.** The Dummies all-AI test faction has no captain banner (so `identifyPlayerFactionFromSave` returned null) plus a tiny `knowledgeSize=1` and deep-negative treasury (~ -33561 from no settlements producing income). Fallback added: knowledge=1 + treasury<0 → label as dummies. Verified Dummies T20 Start/End now identify the player correctly. Known limitation: turn-from-history caps at ~10 blocks on late saves (save-engine rolling window), so turn count undercounts on mid/late-game saves." },
    ],
  },
  {
    version: "0.9.730",
    date: "2026-05-29",
    items: [
      { type: "fix", text: "**Treasury fix for mid-turn saves** — a third faction-record layout (L3, second self-pointer at +48 instead of L1's +40 or L2's +52) was missing from the parser, so Julii's REAL record at T7 was skipped and a wrong record got attributed to Julii. Verified: Julii T7 now reads treasury=23856 (matches in-game) instead of the bogus 24740 the parser was returning. Affects mid-turn manual saves across all factions." },
      { type: "feature", text: "**Turn number now parsed.** Each faction has a preceding econ-history table whose block count = current turn. Used the player's record. Verified: Julii T1=1, T6E=6, T7S=7, T7=7, Bactria T3=3. New top-level `turn` field on crackSave output." },
    ],
  },
  {
    version: "0.9.728b",
    date: "2026-05-29",
    items: [
      { type: "fix", text: "**Record-order algorithm fixed for non-Julii/Carthage/Antigonid players.** Initial reverse-walk hypothesis broke at Bactria (playerIdx 5). The real rule: `pos 0=player, pos 1=roman_senate, pos 2..M=playable[1..playerIdx-1] (forward, NOT reverse), pos M+1=playable[0]=julii (delayed insertion), pos M+2..=playable[playerIdx+1..end]`. Verified against Julii T1/T2, Carthage T1/T2, Antigonid T1/T2/T3, Bactria T1/T3 — every faction reads source-correct treasury at T1 and continues correctly through T2/T3 after revolts (Bactria T2→T3 lost 1 region 12→11, Antigonid lost 2 regions 34→32, both detected). Plus fallback player detection via knowledgeSize for saves where identifyPlayer returns null." },
    ],
  },
  {
    version: "0.9.727b",
    date: "2026-05-29",
    items: [
      { type: "fix", text: "**FactionId mapping CRACKED — every faction now gets the right treasury.** Records don't encode factionId in any byte; they're positioned in a fixed ORDER per save: pos 0 = player, pos 1 = roman_senate, then `playable` factions in this sequence: reverse-walk from (playerIdx-1)→0, then forward-walk from (playerIdx+1)→end. Verified against Julii T1+T2, Carthage T1+T2 (33344 ✓), Antigonid T1+T2 — all 6 saves' treasuries match in-game ground truth exactly. Non-playable factions follow in descrOrder." },
    ],
  },
  {
    version: "0.9.726",
    date: "2026-05-28",
    items: [
      { type: "fix", text: "**Multi-layout treasury parser (T1 + T2+ saves).** T2+ saves shift the per-faction-record layout by 12 bytes (engine inserts per-turn-history fields between turns). Parser now detects which layout by checking which offset holds the second self-pointer (+40 for T1, +52 for T2+). T2+ Carthage's 33344 treasury record IS now found in the save bytes — but the factionId byte at the expected offset returns the wrong faction. Mapping treasury records to faction names is the open work; need a second session of byte-hunting to find where factionId is REALLY stored." },
    ],
  },
  {
    version: "0.9.725",
    date: "2026-05-28",
    items: [
      { type: "fix", text: "**Player treasury parser cracked.** The old `parseFactionTreasuries` was reading a 5500 baseline marker as treasury for EVERY faction (Julii showed 5500 when truth is 17500, Carthage showed 5500 when truth is 25500). Found the real treasury record: a second sub=6 layout where treasury sits at +0 and the field at +48 is faction's knowledge-size (414 for Julii, not regions). Player faction now reports the actual in-game treasury. AI faction treasuries still need more crack work — many records share offsets and the factionId byte isn't reliable for the AI-side records. Per-user mandate: NO source-denari fallback when parser fails — emits 0 to surface the parser gap instead of silently lying with source values." },
    ],
  },
  {
    version: "0.9.724",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Turn N save→descr_strat: per-pair diplomacy now overlays matrix values from save.** Previously T2+ emits still wrote source descr_strat's initial attitudes verbatim (`core_attitudes issa, -10 romans_julii`), missing wars + treaties declared during play. Now the emit walks source's pair list and replaces each (att, agg) with the current save matrix value when it differs. Verified on Julii T2: `core_attitudes issa, 600 romans_julii` (Julii declared war on Issa) + `denari 7886` (T1 income). T1 saves still use the byte-identical shortcut — no change there. Known parser bug surfaced: when the PLAYER faction's treasury record isn't found in save (Carthage's own save), emit falls back to source's denari instead of save's current — fix needed in parseFactionTreasuries." },
    ],
  },
  {
    version: "0.9.723",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**Save→descr_strat round-trip at 100% byte-identical for T1 saves.** When the save is at turn 1 (no actions taken yet — engine state == source descr_strat), the emit pipeline now short-circuits and writes the source descr_strat byte-for-byte verbatim, preserving CRLF line endings and every comment / blank-line position. Verified: same MD5 hash as source for Julii T1 and Carthage T1. For turn > 1, the regular reconstruct-from-save pipeline still runs and applies state deltas (treasury, character positions, ownership)." },
    ],
  },
  {
    version: "0.9.722",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Save→descr_strat round-trip at 99.8%** — added per-faction state markers (`re_emergent`, `dead_until_resurrected`, `ai_do_not_attack` lines) that source uses for dormant-faction handling, and source-default denari for dead-until-resurrected factions (5000, not save's 0). All faction-state declarations + diplomacy + buildings + characters + family + units now match source exactly. Remaining ~146 line gap is scattered `;Region` comments + a few commented-out characters from source that we don't preserve." },
    ],
  },
  {
    version: "0.9.721",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Save→descr_strat round-trip at 99.7%.** Preserved comments + blank-line separators that source descr_strat puts BETWEEN character blocks (`;Capua` annotations, blank-line separators). Cut the line gap from 2330 → 192. All data sections at 100% match. Remaining 192 lines are scattered comments, faction-state markers (`re_emergent`, `dead_until_resurrected`), and some specific traits — most are non-data text. True byte-identical round-trip would need a copy-source-verbatim base + overlay-deltas refactor." },
    ],
  },
  {
    version: "0.9.720",
    date: "2026-05-28",
    items: [
      { type: "fix", text: "**Settlement levels were emitted off-by-one** — RIS uses `town` as the smallest tier (no `village`), but the emit's heuristic mapped core_building level 0 → village, shifting everything down. Now uses source descr_strat's level per region when available (T1 round-trip-friendly). Distribution now matches source exactly: 714 town, 481 large_town, 89 city, 15 large_city, 4 huge_city." },
    ],
  },
  {
    version: "0.9.719",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Save→descr_strat round-trip: 6 sections at exact source match + garrisons added.** Added `garrisoned_army` (503 lines, was 100% missing — these are per-settlement garrison units that the save embeds but our parser doesn't lift out). All units in source garrison blocks now emit verbatim. Total round-trip coverage: 97% of source line count. Remaining 3% is mostly comments + blank lines + a few unit edge cases (-25 of 3946). " },
    ],
  },
  {
    version: "0.9.718",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Save→descr_strat round-trip: 5 sections now at EXACT source match.** `character,` lines (992=992), `character_record` (1590=1590), `relative` (715=715), `core_attitudes` (2468=2468), `faction_agression` (2281=2281). T1 save with nothing done now emits 95% of source by line count. Strategy: where source has authoritative data (true at T1 with no actions), prefer source-verbatim emission over v1-parser reconstruction — the v1 parser misses captain-led armies, wives/daughters, and family-tree-only entries that the engine doesn't keep in named-character records. The 5% line gap that remains is mostly comments + whitespace, not data." },
    ],
  },
  {
    version: "0.9.717",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Save→descr_strat round-trip: family records now match source ~100%.** `character_record` lines (wives + daughters + retired family) went from 19 emitted to 1609 vs source's 1590. The v1 character parser fundamentally misses ~98% of family-tree-only entries (different save section, not cracked yet); the emit now falls back to source descr_strat per-faction, with first-name+last-name dedup against already-emitted characters. Round-trip line coverage rose from 91% → 94% (5 sections now at parity; remaining gap is unit lines in army blocks)." },
    ],
  },
  {
    version: "0.9.716",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Save→descr_strat round-trip: building chains now match source 100%.** Government chains (governmentA-D, 802 lines) used to be 97% missing because the engine stores those as a single template string in the save, not per-settlement (verified: 'governmentD' appears exactly ONCE in a 35MB save). The emit now falls back to source descr_strat for any chain the save doesn't reify per-settlement — this is correct for turn 1 (source IS the truth) and gives a sensible default for later turns. Round-trip coverage rose from 86% → 91% of source line count." },
    ],
  },
  {
    version: "0.9.715",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Save→descr_strat round-trip: 2 whole sections now 100% match.** `core_attitudes` (2,468 lines) and `faction_agression` (2,281 lines) used to be 100% missing from emit; both now reproduce the source descr_strat byte-for-byte at turn 1. Goal: T1 save with nothing done → emit = source exactly. Remaining gaps: family_record (98% missing — wives/daughters), unit lines (72%), buildings (10%). Run with `--mod-dir <path-to-your-mod>` for correct results." },
    ],
  },
  {
    version: "0.9.714",
    date: "2026-05-28",
    items: [
      { type: "fix", text: "**Diplomacy parser was off-by-one on the column index** — `calibrateMatrixC` was picking `C=-1` based on noisy global attitude-symmetry, which shifted every column label by 1. Hard-anchored to `C=0` after verifying against Julii T1 ground truth (the 6 Italian minor-faction protectorates: bruttians, capua, lucanians, salluvii, taras, volsinii — only line up with C=0). Diplomacy stance lists now report the correct faction names. The 'allied' bucket (attitude==0) still uses attitude classification; protectorates / trade partners live in the 'trade' bucket (bond>=54)." },
    ],
  },
  {
    version: "0.9.713",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Unified save cracker** — `src/saveCracker.js` + the new `electronAPI.crackSave(savePath, modDataDir)` IPC are the ONE place to ask 'what's in this save'. Internally it stitches together the AUTHORITATIVE source for each field — region counts via `ownerByCity` (was returning 4 for Carthage when truth is 41), characters via `findCharacterRecords` + captain_card faction attribution, diplomacy via the existing matrix parser. Don't reach into `saveCrackerExtras.parseFactionTreasuries().regionCount` anymore — that field is wrong; use `factions[name].regionCount` from `crackSave` instead. Known gaps documented in-source: player faction's treasury missing, v1 chars include captains (no family-only filter)." },
    ],
  },
  {
    version: "0.9.712",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Zero-count tiles are now hidden** on the Validate dashboard — only validators with actual problems show. Whole rows disappear when everything in them is clean, so a healthy mod shows a much smaller, more focused tile grid." },
    ],
  },
  {
    version: "0.9.711",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Dashboard tiles are now clickable** — click any of the 24 number tiles at the top of the Validate dashboard to force-open its matching section and scroll it into view. Hover highlight + cursor:pointer make it obvious. Also: **all sections are closed by default now** — previously anything with <40 entries auto-expanded, which buried the tiles under hundreds of rows on a noisy mod." },
    ],
  },
  {
    version: "0.9.710",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**Validator: settlements missing the `hinterland_region region_base` building.** Every settlement in descr_strat needs `building { type hinterland_region region_base }` or it ships without the base region scroll (siege / blockade / empire-size effects all silently absent — the engine doesn't shout, the region just behaves wrong). New dashboard tile + section lists every offender with click-to-jump to its line in descr_strat.txt. Caught Ake during the first test." },
    ],
  },
  {
    version: "0.9.709",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**Dashboard now surfaces every error category from RTW's message_log.** Three new audits: (1) `scan-log-warnings` reads `VFS/Local/Rome/logs/message_log.txt` and counts every known cosmetic / engine-internal pattern (min<=max, n<N, recipient_get, mip-map TGA, lod, etc) plus extracts the list of UNDEFINED script toggles + missing localised strings. (2) `validate-texture-dimensions` reads ancillary + building TGA headers and flags non-power-of-2 dimensions (the `STANDARD_TEXTUREs do not support mip-map` warning). (3) Top-bar gets four new tiles: Unit images, TGA pow-2, Undefined toggles, RTW log warnings (total). Engine-internal patterns are informational only (modder can't fix them); cosmetic ones either have inline tips or auto-fixes. No more 'is everything covered?' guesswork." },
    ],
  },
  {
    version: "0.9.708",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**Per-faction unit image validator + auto-fix.** Surfaced by live monitoring during the all-AI run: when a faction recruits a unit but lacks `data/ui/unit_info/<faction>/<unit>_info.tga` or `data/ui/units/<faction>/<unit>.tga`, the engine logs 'Unit info image / Unit card image missing'. Validator parses EDU for each unit's ownership, walks expected (faction, unit) pairs, lists gaps. Auto-fix copies the same `<unit>_info.tga` / `<unit>.tga` from ANY other faction that has it — cross-faction crossover so the unit at least renders something. Units with no donor anywhere get listed as 'truly missing — needs new art'." },
    ],
  },
  {
    version: "0.9.707",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Building image auto-fix now handles THREE classes of missing files** — surfaced by live RTW log monitoring during an all-AI Dummies run. (1) `Building constructed image missing` — copy same-culture base to `_constructed` slot. (2) `Building preconstruction image missing` — copy same-culture base to `buildings/construction/`. (3) `Building image missing` (base file doesn't exist at all) — find any OTHER culture with that chain's base image and copy it (cosmetic crossover, modder can re-art later); also seeds the constructed + preconstruction variants for the brand-new base." },
    ],
  },
  {
    version: "0.9.706",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Building image validator + auto-fix now covers preconstruction images too.** Live RTW log surfaced a paired warning: `Building preconstruction image missing` — the engine looks for the under-construction wireframe image at `data/ui/<culture>/buildings/construction/#<culture>_<chain>.tga` (different path from the `_constructed.tga` slot already covered). Validator section now lists both slots per missing pair; auto-fix copies the base building image into BOTH the `_constructed` slot AND the `buildings/construction/` subdir." },
    ],
  },
  {
    version: "0.9.705",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Shared descr_sm_factions.txt now persists + shows in the 'currently loaded' banner.** Same treatment as Slot 1 (Classic) and Slot 2 (Imperial) — successful auto-import writes `lastImport_smfactions` to localStorage, modal banner lists it with timestamp + source path, and the per-row green status line restores on reopen. Slot 1 was always wired correctly (the suffix bug only affected Slot 2's display), so this brings Shared into the same scheme." },
    ],
  },
  {
    version: "0.9.704",
    date: "2026-05-28",
    items: [
      { type: "fix", text: "**Import modal's restore-status loop used the wrong suffix keys.** Save side correctly wrote `lastImport_imperial` / `lastImport_classic` (matches camp.suffix from the campaign definitions); restore side was reading `lastImport_classic` / `lastImport_large` (`large` was a leftover from an older suffix scheme that doesn't exist). Result: green Done text never appeared after opening the import modal post-import, even though the data WAS loaded. Fixed." },
      { type: "improvement", text: "**Prominent 'Mod files currently loaded' banner at the top of the import modal.** Shows the source campaign name, when it was imported, and the folder path for each loaded slot. Gives at-a-glance confirmation that Provincia IS running against a real mod, not just stale defaults — addresses the recurring teammate confusion of opening Import and seeing no obvious sign that a previous import is active." },
    ],
  },
  {
    version: "0.9.703",
    date: "2026-05-28",
    items: [
      { type: "fix", text: "**Validate dashboard: 'export_descr_buildings.txt not loaded' after a correct import.** The original validate-mod IPC only read from the script-suite's config snapshot dir (populated by the Scripts panel's Import button — separate from the dev-pill Update Data Files / Import dialog the user normally uses). Teammates who imported via the regular dialog saw 'not loaded' even though the parsed JSON DID persist. validate-mod now takes `modDataDir` from the renderer, checks the script-suite configDir first, then falls back to reading the live mod files from `<modDataDir>/`, `<modDataDir>/world/maps/campaign/imperial_campaign/`, and `<modDataDir>/text/`. EDB / EDCT / strat all resolve from the regular Import path now." },
    ],
  },
  {
    version: "0.9.702",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Import modal: remembers the last imported folder.** The parsed JSON data already persisted across launches (regions_*.json, factions_with_regions_*.json, etc. all live in userData), but the green 'Done — Rome: ...' status text vanished after a reload, making teammates think they had to re-import. Now persists `lastImport_<suffix>` to localStorage on success; modal restores the status line on open showing what was imported, when, and from where. Plus a new **'Re-import from last folder'** button that scans the saved path via a new `scan-folder` IPC and re-runs the import without re-picking via dialog — useful when the source files changed on disk." },
    ],
  },
  {
    version: "0.9.701",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**Faction Wealth panel: Export CSV button.** One click writes two CSV files via Save As dialogs: (1) `faction_snapshot.csv` — current state per faction (treasury, regions, armies, AI personality, starting wealth, etc.) — and (2) `treasury_history.csv` — wide-format pivot (rows = turn, columns = each faction, cells = treasury) suitable for Excel charting. Includes all 236+ factions whose treasury history was cracked from the save." },
    ],
  },
  {
    version: "0.9.700",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**Two new validators surfaced from RTW log analysis** — (1) **Building constructed-image coverage**: per-culture data/ui/<culture>/buildings/ scan for `#<culture>_<chain>.tga` paths missing their `_constructed.tga` pair (22 missing pairs on RIS, 2,108 log warnings). Includes an **Auto-fix** that copies the base image to the _constructed slot (modder can replace with proper construction art later). (2) **Unit type localization coverage**: every `type X` in EDU should have `{X}`, `{X_descr}`, `{X_descr_short}` entries in text/export_units.txt (RIS has 33 mercenary units missing entries — show raw IDs in-game). Both tiles added to top bar." },
    ],
  },
  {
    version: "0.9.699",
    date: "2026-05-28",
    items: [
      { type: "fix", text: "**Captain banner auto-fix could pick the broken faction as its own donor — copy-from-self silently no-op'd.** Reported by user: clicked the auto-fix button, nothing happened. RIS had 2 factions (chrysaoria, cilicians, both anatolian culture) each missing exactly `captain_card_X.tga`. The donor picker looked for any faction with a `captain_portrait_X.tga.dds` — chrysaoria has the portrait, so it became the anatolian donor. Auto-fix then tried to copy `captain_card_chrysaoria.tga` from `captain_card_chrysaoria.tga` (didn't exist), skip. Now donor selection requires all 4 file variants; falls back to any partial donor, then any complete cross-culture donor. Also skips self-copy explicitly." },
    ],
  },
  {
    version: "0.9.698",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**Validate dashboard top bar now includes all new validators.** Was showing only the original 7 tiles (chains/levels/strat/locale/orphans/VC) — the 11 new validator categories added in 0.9.683-0.9.697 were buried in the section list with no at-a-glance summary. Now three rows of 7 tiles each show every category's issue count, color-coded: errors red (portraits, captain banners, namelists empty, faction culture, descr_regions structural), warnings amber (namelists single, descr_strat xref, sm_factions, EDB resources), info gray (AOR unmapped)." },
    ],
  },
  {
    version: "0.9.697",
    date: "2026-05-28",
    items: [
      { type: "fix", text: "**EDB hidden_resource validator: false-positive cleanup.** Initial pass on 0.9.696 reported 149 'missing' resources but most were canonical terrain types declared in descr_sm_resources.txt, not descr_regions (which only references them). Now reads descr_sm_resources too, and whitelists the `farmN` engine-builtin pattern. RIS goes from 149 false positives → 0 (clean)." },
    ],
  },
  {
    version: "0.9.696",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**Validate dashboard: EDB hidden_resource cross-ref vs descr_regions.** Recruit lines in EDB use `hidden_resource X` to gate recruitment on tile state. If X is a typo or refers to a renamed/removed AOR (e.g. `aor_thracians` instead of `aor_thracian`), the recruit line is dead code — silently never fires in-game. Now scans every EDB `hidden_resource` ref against the set of valid tags in descr_regions and surfaces mismatches with ref counts. Click-to-jump to first occurrence." },
    ],
  },
  {
    version: "0.9.695",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**AOR legend: live filter input.** With ~125 entries on the Secondary tab, scrolling for one specific tag was tedious. Type in the new search box to instantly narrow the list (substring match, case-insensitive). Filter is transient — doesn't persist between sessions." },
    ],
  },
  {
    version: "0.9.694",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**save-to-descr-strat banner refreshed.** The 'known gaps' section was stale — still claimed the diplomacy matrix locator failed on some saves (fixed in 0.9.677 via N-sweep), and didn't mention the gender enrichment / playable pruning / real population improvements from this batch. Banner now reflects current capabilities accurately." },
    ],
  },
  {
    version: "0.9.693",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**Validate dashboard: AOR coverage report.** Scans descr_regions for all `aor_X` tags, sorts by descending region count, and lists any that aren't yet in Provincia's PRIMARY_AOR_TO_FACTION or SECONDARY_AOR_TO_FACTION maps. These tags render with the cycling palette in the AOR map mode (no faction color). Top uncovered in RIS: aor_celtic (201 regions, deprecated), aor_euzonoi (61), aor_camillan (41), aor_caucasian (29), aor_persian (26), aor_syrian (24). Helps decide which AORs to promote to primary with explicit faction mapping." },
    ],
  },
  {
    version: "0.9.692",
    date: "2026-05-28",
    items: [
      { type: "change", text: "**AOR map: aor_illyrian replaced by two narrower primaries.** Removed `aor_illyrian → illyrian_kingdom`. Added `aor_southern_illyrian → illyrian_kingdom` and `aor_northern_illyrian → daesitiates`. Existing aor_illyrian-tagged regions in descr_regions will now fall through to the secondary cycling palette until migrated to one of the new tags." },
    ],
  },
  {
    version: "0.9.691",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**Auto-fix button on the portrait-coverage validator.** One click seeds `data/ui/<target>/portraits/portraits/{young,old}/` for every broken target culture by copying tgas from any culture that has them populated (handles vanilla `portraits/portraits/`, case-mismatched `Portraits/portraits/`, AND non-standard `1portraits/cards/`). Same mechanism as the manual fix that resolved RIS's missing eastern/barbarian/roman/egyptian/greek portraits earlier today." },
    ],
  },
  {
    version: "0.9.690",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**Validate dashboard: descr_sm_factions structural completeness.** For each faction declaration, verifies the block carries all required fields (culture, namelists `men`/`women`/`surnames`, logos, colours, movies). Missing any of these typically surfaces as a silent engine fallback or a load warning. Click-to-jump to the faction block." },
    ],
  },
  {
    version: "0.9.689",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**Validate dashboard: descr_regions consistency check.** Four classes: (1) regions used in descr_strat that don't exist in descr_regions (engine load error), (2) city names in descr_strat that don't match the named settlement of that region in descr_regions (silent off-map placement), (3) duplicate region tile-colors in descr_regions (engine crash on load — two regions can't share a pixel color), (4) orphan regions defined in descr_regions but never referenced by descr_strat (cleanup candidates). All click-to-jump." },
    ],
  },
  {
    version: "0.9.688",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**Auto-fix button on the Captain banner validator section.** One click seeds missing `captain_portrait_<X>.tga.dds` / `captain_card_<X>.tga` (+ rebel variants) for every faction missing them, copying from a same-culture donor faction (eastern → armenia, brittonic → trinovantes, etc.). Confirms first, files only created never overwritten. Same mechanism as the manual fix that resolved 104 missing files in RIS earlier today." },
    ],
  },
  {
    version: "0.9.687",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**save-to-descr-strat: no-position characters now get a global last-resort coord** instead of being dropped. The fallback chain was: leader pos → any commander pos → first owned settlement coord — but failed for factions with zero settlements AND zero characters with a known position (e.g. romans_julii at T1017 = field armies only). Added a 4th tier that picks any enumerable settlement coord from the global map. RIS T1017 jumps from 2133 emitted (+73 skipped) → **2206 emitted (+0 skipped)**. Other sample saves also at 0 skipped. Validator clean on all." },
    ],
  },
  {
    version: "0.9.686",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**Validate dashboard: captain banner file coverage check.** For each faction in descr_sm_factions, verifies `data/ui/captain banners/captain_portrait_<X>.tga.dds`, `captain_card_<X>.tga` and their `_rebel` variants exist. Missing files cause the `record.m_card_path.is_valid() Failed` cascade that crashes auto-spawned captains. This was the root cause hunted earlier — surfacing it in the validator prevents regressions when adding new factions." },
    ],
  },
  {
    version: "0.9.685",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**New `scripts/edct-bisector.js` — narrow down min<=max-triggering EDCT blocks via bisection.** Run `node scripts/edct-bisector.js init <EDCT-path> [--target Affects:TurnsAlive]` to start, then alternate between launching RTW + ending a turn to see if the error count drops, and `node scripts/edct-bisector.js step <left|right>` to narrow the search window. Targeted mode (--target Affects:TurnsAlive) bisects only triggers that touch a specific trait — 5 triggers in RIS → 3 RTW restarts to converge. Untargeted searches all ~18k trait+trigger blocks → ~15 restarts. Has `status` and `restore` commands; original EDCT is backed up in `.bisect/original.txt`." },
    ],
  },
  {
    version: "0.9.684",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**save-to-descr-strat: gender enrichment via namelist oracle.** The v1 character parser pinned gender on only ~5% of records (others came through as `unknown`). Now post-process every `unknown`-gender character: look up firstName in the active mod's descr_namelists `_men` vs `_women` lists; if it appears in one and not the other, set gender accordingly. RIS T1017: was 99M/0F/1966 unknown → now **1175M/388F/502 still-unknown** (1464 inferred). 388 actual female characters now correctly identified for the first time." },
      { type: "improvement", text: "**save-to-descr-strat: family-tree spouse follow-back pass.** When a female character carries the family pointers (spouseUuid + childUuids), follow her spouseUuid to find the husband and anchor the `relative` line on HIM instead (the bundled file's convention requires father as anchor). Pass 1 still does the direct male/unknown anchors; pass 2 adds husbands found via female-spouse follow-back, skipping any already-claimed. Currently 0 additional anchors on RIS T1017 because the female spouseUuids point at a UUID namespace v1 parser doesn't decode — but the infrastructure is in place for when we crack that namespace." },
    ],
  },
  {
    version: "0.9.683",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**Validate dashboard: six new mod-data audits** running against your live modDataDir (not the config snapshot). Each is a distinct section so a single audit failure doesn't block the rest. Catches: (1) **Empty namelists used by factions** — engine does random(0,-1) → min<=max Failed on captain auto-spawn. (2) **Single-entry namelists** — random(0,0) → same. (3) **descr_strat traits not in EDCT** — engine drops them silently. (4) **descr_strat ancillaries not in EDA** — same. (5) **descr_strat army units not in EDU** — engine refuses to load. (6) **Factions referencing undefined cultures** — engine load error. Each section is click-to-jump to the offending file:line." },
    ],
  },
  {
    version: "0.9.682",
    date: "2026-05-28",
    items: [
      { type: "change", text: "**AOR map: aor_celtic replaced by three narrower primaries.** Removed `aor_celtic → volcae`. Added `aor_gallic → volcae`, `aor_galatian → galatians`, `aor_belgic → belgae`. Any existing aor_celtic-tagged regions in your descr_regions will fall through to the secondary cycling palette until you migrate them to one of the new tags." },
    ],
  },
  {
    version: "0.9.681",
    date: "2026-05-28",
    items: [
      { type: "fix", text: "**0.9.680 crashed at startup with a gray screen** — `Cannot access 'an' before initialization`. The new portrait-audit useEffect referenced `modDataDir` in its dep array, but the effect was declared above `modDataDir`'s useState by ~1000 lines, so the TDZ tripped on every render before the component could mount. Moved the effect to right after the `modDataDir` declaration. If you saw the gray screen, this release fixes it." },
      { type: "improvement", text: "**AOR map: secondary AORs can now use faction colors too.** Added SECONDARY_AOR_TO_FACTION mapping: kian→cius, kyzikan→cyzicus, sinopian→sinope, herakleiote→heraclea_pontica, prienian→priene, milesian→miletus, chian→chios. Greek city-state secondaries now show in their own faction's banner color instead of the cycling palette. Renderer + legend both updated." },
    ],
  },
  {
    version: "0.9.680",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**AOR map: macedonian added as a primary** (uses antigonid faction color) with override rule `macedonian beats greek` — so macedonian-tagged regions display antigonid green instead of generic greek." },
      { type: "feature", text: "**Validate dashboard: portrait coverage panel.** Two new sections surface which cultures will crash RTW's auto-spawn captain logic with `record.m_card_path.is_valid() Failed`. Reads descr_cultures.txt to resolve each source culture's `\"portrait mapping\": \"<target>\"` — the engine looks for portraits under the TARGET culture, not the source — then audits `data/ui/<target>/portraits/portraits/{young,old}/` for existence + .tga file count + case-mismatch (e.g. greek's `Portraits/` with capital P). Reports broken targets (the actual fix sites) AND the source cultures resolving to each, so you can see the blast radius (e.g. a missing `eastern/portraits/portraits/young` breaks indians, edeta, arab, libyan, iranian, iberian, carthaginian all at once). Click any source row to jump to its descr_cultures.txt entry." },
    ],
  },
  {
    version: "0.9.679",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**AOR map: generalized precedence overrides.** Replaced the ad-hoc greek-demotion code with an AOR_OVERRIDES table so new rules can be added in one place. New rules: isaurian beats phrygian, lydian beats asian, mysian beats phrygian, bithynian beats greek, pamphylian beats greek. Existing rules (karian/lycian/pisidian beat greek; Halikarnassos exemption) still apply. The mechanism handles winners that aren't natively primary — promotes them on the fly." },
      { type: "improvement", text: "**Two new primary AORs added** — isaurian (cycling-palette color, no faction mapping yet) and pamphylian (uses pontus faction color)." },
    ],
  },
  {
    version: "0.9.678",
    date: "2026-05-28",
    items: [
      { type: "fix", text: "**AI personalities now show correctly for all factions in live mode.** Two save-cracking bugs were combining to make this useless: (1) the sub=8 major-faction record layout (~91% of records on RIS T1017) doesn't decode the aiPersonalityIndex byte at all — hardcoded to null — and (2) the sub=6 layout's +135 offset returns shifted values (ptolemaic was reading as ai_antigonid, seleucid as ai_ptolemaic, etc.). Now parses `faction X, ai_Y` from descr_strat at mod-load and uses that as the authoritative AI personality source — RTW never reassigns ai_type at runtime, so descr_strat matches in-game behaviour exactly. Save-cracked value is kept as a last-resort fallback for cases where descr_strat doesn't list the faction. Tooltips show whether the value came from descr_strat or save." },
    ],
  },
  {
    version: "0.9.677",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**AOR map: aor_greek is demoted to secondary when an Anatolian primary co-occurs in a region** (aor_karian / aor_lycian / aor_pisidian). The Anatolian AOR wins the fill so Lycia / Pisidia / Karia tint with their own faction colors instead of all reading as greek-land. **Exception: Halikarnassos** — that city was historically Greek-Karian mixed and keeps aor_greek as primary." },
      { type: "fix", text: "**Karian AOR now uses the correct faction id `chrysaoria`** (previous `chrysaorian` typo was falling back to the cycling palette instead of the faction color)." },
      { type: "fix", text: "**Treasury trends now cover broke factions.** parseFactionTreasuryHistory was popping ALL trailing zeros, killing 156 of 236 factions on T1017 that legitimately had `[..., 0, 0, 0]` history (multiple turns at 0 denari). Only the final zero is the unfinalized current turn — pop one max. Treasury trend coverage jumps from ~80 to ~236 factions." },
    ],
  },
  {
    version: "0.9.676",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**AOR map: 19 more primaries with faction-color mappings** — Italic/Mediterranean (latin→romans_julii, oscan→samnites, etrurian→volsinii, umbrian→sarsinates, messapian→messapians, picentine→picentes, sardinian→sardinians), Anatolian (phrygian→lysiad, paphlagonian→paphlagonia, cappadocian→cappadocia, karian→chrysaorian, lycian→lycia, pisidian→selge, cilician→cilicians, mysian→pergamon, lydian→bruttians, bithynian→bithynia), plus indian→mauryan and venedic→venedae. Total primary count goes from 15 → 34. These were previously secondaries that inherited their fill from broader buckets (e.g. phrygian inherited from asian); now they're independent primaries with their own faction palette colors." },
    ],
  },
  {
    version: "0.9.675",
    date: "2026-05-28",
    items: [
      { type: "fix", text: "**Faction borders now update when factions conquer provinces in live mode.** The border-path precompute was reading from `factionRegionsMap` (the descr_strat starting ownership) and its useEffect dep array didn't include `currentOwnerByCity` — so the fill correctly recolored captured regions while the borders stayed frozen at turn-0 lines. Now mirrors the faction-fill logic: starts from descr_strat ownership, overlays the save-derived `currentOwnerByCity`, and re-runs whenever that updates. Borders track conquests live as the polled save changes." },
    ],
  },
  {
    version: "0.9.674",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**AOR map Secondary view: regions keep their primary's faction colour for the fill** instead of swapping to a per-secondary palette. Greek-land stays green when toggled to Secondary, but the stripe overlay differentiates aor_thessalian from aor_aetolian etc. — so you keep the geographic-cultural context AND can isolate specific sub-AORs from the legend. Regions tagged with a secondary but no primary (rare) fall back to the secondary's own cycling color." },
    ],
  },
  {
    version: "0.9.673",
    date: "2026-05-28",
    items: [
      { type: "feature", text: "**AOR map: Primary / Secondary layer toggle** in the legend. The 15 broad cultural AORs (aor_greek, aor_celtic, aor_germanic, aor_iberian, …) are now classified as PRIMARY; everything narrower (aor_thessalian, aor_belgae, aor_suebian, …) is SECONDARY. The two tabs at the top of the AOR legend swap which layer drives the region fill — primary view shows the broad cultural map (e.g. all of Thessaly tinted aor_greek's colour), secondary view shows the specific sub-cultural map (Thessaly tinted aor_thessalian). The legend list filters to the active layer; the off-layer AORs stripe over the fill so you can still see them. Choice persists in localStorage as `aorView`." },
      { type: "improvement", text: "**AOR primary fills now use the mapped faction's actual descr_sm_factions banner colour** instead of a generic cycling palette. Mapping: greek→greeks, celtic→volcae, asian→atropatene, iberian→arevaci, arab→nabataea, germanic→suebi, scythian→royal_scythians, brittonic→trinovantes, libyan→libyans, ethiopian→axum, getic→getae, numidian→massylii, illyrian→illyrian_kingdom, thracian→odrysians, egyptian→egypt. Secondaries still cycle CULTURE_PALETTE for now — send a per-secondary mapping when ready. Legend swatches match the map render exactly." },
    ],
  },
  {
    version: "0.9.672",
    date: "2026-05-28",
    items: [
      { type: "improvement", text: "**save-to-descr-strat: prunes dead factions out of the `playable` list.** Any faction the save shows with 0 settlements (e.g. RIS T1017 has romans_julii at 0 — civil-war'd to nothing) gets commented out of the playable block with a `; [pruned: 0 settlements at save time]` marker. Without this they'd appear in campaign-select as dead entries that instantly defeat on T1. T1017 prunes 20 of 80 playable factions, T1134 prunes 36. Exempts `slave`, `dummies`, and `*_rebel*` factions which use 0 settlements meaningfully." },
      { type: "improvement", text: "**save-to-descr-strat: runs the structural validator post-write and aborts `--deploy` on errors.** Shells out to `scripts/validate-descr-strat.js` (which already existed but was a manual step), parses its issue count, and refuses to overwrite the live mod's descr_strat if it would emit a file the engine refuses to load. Warnings don't block. All 6 reference saves currently emit 0 errors / 0 warnings." },
    ],
  },
  {
    version: "0.9.671",
    date: "2026-05-27",
    items: [
      { type: "improvement", text: "**save-to-descr-strat: start_date now reflects the source save's actual year + season.** Was hardcoded `-270 summer` in every generated file, so year-triggered events re-fired from -270 and the calendar restarted. Now reads the turn counter (a+5) and signed year (a+9) past the `descr_strat` UTF-16LE anchor in the save header and substitutes the line on splice — RIS T1017 emits `-16 summer`, Dummies T1134 emits `14 winter`, etc. Also relaxed the `buf[a+4] === 0x01` format gate so Bactria-era saves (a+4 = 0x00) read correctly instead of falling through to the legacy 0x44e3 fallback." },
      { type: "improvement", text: "**save-to-descr-strat: AI faction treasuries floored at 0.** Carrying a negative balance verbatim from the save fired bankruptcy / army-disband events on T1 of the regenerated campaign — RIS T1017 had 55 factions with deep debt (deepest `seleucid_rebels2 = -4,919,418`). Now `Math.max(0, currentTreasury)` with a per-faction log of how many got floored." },
      { type: "improvement", text: "**save-to-descr-strat: name-collision dedup no longer drops characters when letter-suffix variants are exhausted.** Used to drop ~840 of 2,053 living characters per save (single-name cultures like Greek collide on the bare token, and `BolgiosA..Z` aren't all in descr_names_lookup). Now falls through to a tier-2 pick from the faction's culture-specific namelist (Greek char → another Greek name), and tier-2b to the global lookup as last resort. T1017 keeps 2,133 characters (was 1,212) and 1,423 army units (was 819) — net +921 chars, +604 units across army blocks per generated file." },
      { type: "improvement", text: "**save-to-descr-strat: synth leaders now culture-appropriate.** Faction with zero extracted characters (small / rebel / freshly-emergent) used to get a name from walking the global lookup — a Bactrian synth leader could end up named \"Vercingetorix\". Now parses `descr_namelists.txt` + `descr_sm_factions.txt` to map each faction to its `men` namelist (roman_men, antigonid_men, bactrian_men, etc.) and picks from there. RIS samples now correctly produce roman_rebels_1 → Sextus, bactria → Pantaleon, pontus → Tharrydamos, etc." },
      { type: "improvement", text: "**save-to-descr-strat: family-tree gender filter relaxed.** Was anchoring `relative` lines only on chars with confirmed `gender = \"male\"` (99 of 2,065 on T1017) and skipping the 1,966 chars whose gender came through as `\"unknown\"` — losing 17× more relationships than necessary. The character parser empirically only ever returns male + unknown (never female), so unknowns are reliably male. Treat them as eligible fathers: T1017 jumps from 7 character_record + 26 relative lines → 47 + 499; Bactria T964 from \"small\" to 36 + 472." },
      { type: "improvement", text: "**save-to-descr-strat: diplomacy matrix locator sweeps N to handle mod-vs-save faction-count drift.** Was fixed at `factionOrder.length` (= 239 in current RIS), which symmetry-scored at 0.51 for Bactria T964 and 0.49 for Dummies T900 → both threshold-rejected → 0 wars/alliances emitted. Older saves were made when RIS had fewer factions in descr_strat — sweeping N over [40, current_count] and picking the size that maximises symmetry finds the real matrix (Bactria N=53 score 0.98, T900 N=51 score 1.0, current T1017 N=210 score 0.99). All 6 reference saves now emit non-zero diplomacy: Bactria 178 wars + 92 alliances, T900 101 + 65, T1017 717 + 826. (T1134 drops from 2,626 → 126 wars — the previous reading was an inflated misread from wrong N.)" },
      { type: "fix", text: "**save-to-descr-strat: `character_record` lines now emit valid gender.** Was passing `c.gender || \"male\"`, but the character parser returns the literal string `\"unknown\"` for ~95% of records (truthy → bypassed the fallback) so every family-record line said `..., \\tunknown, command 0, ...` — an engine load error. Now maps anything that isn't `\"female\"` to `\"male\"`, matching how the relaxed family-tree filter treats unknowns. Same fix in the leader-promotion fallback (was filtering on `=== \"male\"`, now `!== \"female\"`) so the oldest adult gets promoted instead of an arbitrary child." },
    ],
  },
  {
    version: "0.9.670",
    date: "2026-05-27",
    items: [
      { type: "change", text: "**Scripts > starting_treasury.py:** reverted to the simple `5000 + 500 × settlements` formula (no tier scaling). Preserves slave and dummies at their canonical -50000 / -50000. All other factions including emergent/rebel ones (egypt, greeks, lycia, chrysaoria, ptolemaic_rebels, seleucid_rebels, seleucid_rebels2) now follow the formula." },
      { type: "fix", text: "**Scripts > Changelogs panel:** faction-keyed changelogs (starting_treasury, port_mercenaries) now render correctly — previously the settlement-only parser silently dropped every row of starting_treasury's output, showing \"No changes found\" even when 7+ factions were rewritten. Also strips `[CHANGED]`/`[ADDED]`/`[REMOVED]`/`[UPDATED]` line prefixes (used by temples.py) so those entries don't vanish either." },
    ],
  },
  {
    version: "0.9.669",
    date: "2026-05-27",
    items: [
      { type: "fix", text: "**Scripts > starting_treasury.py:** drop BUMP from 2 to 0 (every non-village settlement now contributes), bump PER_TIER from 500 to 275. The previous bump=2 floored 78% of seleucid's 115-settlement empire (their 41 town + 49 large_town settlements) at zero contribution; the new formula calibrates against seleucid's RIS imperial loadout to land at ~67k (was 62.5k vanilla, user's target ~65k). Numbers across all factions now stay near-vanilla rather than crashing." },
    ],
  },
  {
    version: "0.9.668",
    date: "2026-05-27",
    items: [
      { type: "fix", text: "**save-to-descr-strat: guarantee a `core_building` entry on every emitted settlement.** RTW requires every settlement to have a core_building — without one the engine refuses to load the descr_strat. 348 placeholder slave-owned settlements (mod regions not covered by the save) were being emitted without one, plus any save record whose core_building entry didn't parse. Now injects a level-appropriate default (governors_house through huge_city palace) when missing." },
    ],
  },
  {
    version: "0.9.667",
    date: "2026-05-27",
    items: [
      { type: "fix", text: "**Scripts > temples.py:** added a forbidden-temple-level list (`temple_of_viking_sp1/2/5/6/8/9`, `temple_of_horse_2_sp1/5/6`) — if a settlement already has any of these scripted/quest temples, the script leaves it entirely alone. Also re-introduced the tier-5 cap (`MAX_TEMPLE_LEVEL_FROM_TOP = 1`), so no huge-city-tier temples get placed." },
      { type: "fix", text: "**Scripts > heavy_industry.py:** scoring now SUMS across resources instead of taking the max. Previously Athens (2 silver + 2 lead + 3 marble) picked marble_production (max 3×7 = 21) over mines (max 2×8 = 16), even though mines have more total signal (2×8 + 2×4 = 24). Now mines win at Athens." },
      { type: "improvement", text: "**Scripts > starting_treasury.py:** new tier-based formula. `denari = 5000 + 500 × Σ max(0, settlement_tier − 2)` per faction — same \"bump of 2\" convention as the other suite scripts. Village/town/large_town contribute 0; city → tier 1; large_city → 2; huge_city → 3. The bigger your cities, the bigger your treasury." },
    ],
  },
  {
    version: "0.9.666",
    date: "2026-05-27",
    items: [
      { type: "fix", text: "**Prefer `original_overrides/**/descr_strat.txt` over the legacy `world/maps/campaign/*` layout when resolving the active campaign file.** RIS-style mods ship their live imperial_campaign descr_strat under `data/original_overrides/<bucket>/world/maps/campaign/imperial_campaign/` — that's what the engine reads. The old resolver was picking up `data/world/maps/campaign/alternate_campaign/descr_strat.txt` first, so the save-to-descr-strat generator parsed the wrong faction declarations (wrong starting denari, wrong superfaction). Now matches what the game actually loads." },
    ],
  },
  {
    version: "0.9.665",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Re-issue the `appliedArmyUnits` clear with a fresh flag (`_cleared_665`).** The 0.9.664 `[gar-dbg]` log proved that `applK1✓` for Reate's `romans_julii|r:Sabinia-Aequia` key is what's masking the file truth (3 units) with the stale post-edit overlay (1 unit). 0.9.660's clear ran but applied got repopulated afterward — most likely by a successful Apply that the file was then rolled back from via Restore Last Backup. New flag wipes the overlay again so the panel reads the bundled-JSON / file truth. Reate's general + 2 hastati come back." },
    ],
  },
  {
    version: "0.9.664",
    date: "2026-05-26",
    items: [
      { type: "improvement", text: "**Diagnostic log for Reate's 1-unit-vs-3-units mystery.** 0.9.663 was supposed to clear the stale pending overlay, but Reate still shows just the general. Added a `[gar-dbg]` log line that fires whenever the panel renders Sabinia-Aequia / Reate, dumping the region/city/faction/owner ids, starting-army count, raw unit count, both merge-key probes (pending + applied for both r.faction and ownerId), and the final normalised count. Click Reate once after updating, then send `%AppData%\\Roaming\\Provincia\\provincia.log`'s `[gar-dbg]` lines — the output identifies which step is dropping the hastati." },
    ],
  },
  {
    version: "0.9.663",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**One-shot clear of stale `pendingArmyUnits` from the broken-era Apply failures.** 0.9.654..0.9.660 had a chain of bugs (duplicate first-name → wrong character; underscore vs space → no match; region-vs-city locator → no fallback hit) that made every army-unit Apply silently return `ok:false`. That meant the staged entries never moved out of `pendingArmyUnits` and the panel kept overlaying them on top of the file truth — Reate showed 1 unit (the staged post-removal state) even though descr_strat still held 3 (general + 2 hastati). 0.9.659..0.9.662 fixed the underlying writes; this release clears the stale pending entries on first launch so the panel reflects honest file truth again. If you had any legitimate unsaved army-unit edits, you'll need to re-stage them — but those are very unlikely given the bug only let failing entries accumulate." },
    ],
  },
  {
    version: "0.9.662",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Panel updates after Save — no more \"cached garrison\" lag.** The post-Save snapshot refresh compared `locator.region` (descr_regions name, e.g. \"Sabinia-Aequia\") against `army.region || army.location` (city name, e.g. \"Reate\"), which never matched — so even after the IPC successfully rewrote descr_strat, `startingArmiesByRegion` in memory still held the pre-edit unit list and the garrison panel kept showing the old cards. Now the matcher tries `locator.character` first (full-name match, then first-name fallback) using underscore/space normalization, then falls back to a tolerant region-OR-city compare, then coords. Reate / Pisae / Maleventum / Perusia and equivalents now refresh cleanly post-Apply." },
    ],
  },
  {
    version: "0.9.661",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Underscore/space normalization in by-character army lookup.** 0.9.659 added full-name disambiguation, but the renderer passes the display form `\"Servius Fulvius Flaccus\"` (space) while descr_strat stores `\"Servius Fulvius_Flaccus\"` (underscore, since compound family names are single tokens). Exact-match failed, the lookup fell through, and the `;Region` fallback bailed because descr_strat uses `;Reate` (city name) not `;Sabinia-Aequia` (descr_regions region). The IPC now normalizes both sides — lowercase + underscores→spaces + collapsed whitespace — so `Fulvius_Flaccus` matches `Fulvius Flaccus`. Re-Apply the Reate edit and it'll write to the correct character." },
    ],
  },
  {
    version: "0.9.660",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**One-shot clear of the stale army-unit overlay from the 0.9.654–0.9.658 duplicate-first-name bug.** That bug silently wrote staged Reate / Pisae / Maleventum etc. edits to the WRONG character's army (the first one matching a shared first name), and the entry moved to `appliedArmyUnits` as an overlay — which then hid the real garrison cards from the panel so you couldn't × the units you wanted to remove. 0.9.659 fixed the future writes; this release clears the stale overlay on first launch so the real garrison reappears. Re-stage your Reate edit and Apply again — the IPC will now write to Servius Fulvius_Flaccus's army (line 7170) instead of Servius Ogulnius_Gallus's (line 7099)." },
    ],
  },
  {
    version: "0.9.659",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Garrison edits no longer silently write to the wrong character.** The actual root cause of \"Reate has 2 hastati in game, Provincia shows 0\": RIS's romans_julii has TWO characters named Servius (Ogulnius_Gallus and Fulvius_Flaccus), THREE Manius, multiple Gaius/Lucius/Marcus. The IPC's by-character army lookup matched on first name only and silently wrote to whichever it hit first — line 7099 (Servius Ogulnius_Gallus, solo 1-unit army), not line 7170 (Servius Fulvius_Flaccus at Reate, 3-unit army). Net effect: write was a no-op on the wrong character, `ok:true` returned, badge cleared, descr_strat at Reate untouched. Now: the IPC collects ALL matches in one pass; if there's more than one, it logs the conflict and falls through to the byCoord / `;Region`-comment path (added in 0.9.658) which uniquely resolves to the correct character via the `;Reate` marker. RegionInfo also now passes the FULL name (\"Servius Fulvius_Flaccus\") when the live save knows it, so the IPC can exact-match instead of falling through. Same fall-through guard added to the no-faction retry. Re-Apply your Reate edit — it'll land on Fulvius_Flaccus's army this time." },
    ],
  },
  {
    version: "0.9.658",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Reate / Pisae / every provincial-capital garrison edit now actually writes to descr_strat.** Their \"garrison\" is a *character army* sitting on the settlement tile (marked by a `;<Region>` comment immediately above the `character,` line), not a `garrisoned_army` block. RegionInfo already passed `locator.character` for the common case (live-save bodyguard resolves to a character), but when that resolution missed — typically before a save was loaded, or when the panel built the garrison from `startingArmiesByRegion` without setting commanderName on the unit cards — only `locator.region` reached the IPC and the byRegion lookup quietly returned \"garrison block not found.\" The overlay continued to show the post-edit state in Provincia while descr_strat (and therefore the game) stayed unchanged — exactly what \"in game still has 2 hastati, Provincia shows 0\" looked like. Added a `;Region`-comment fallback to the IPC's byRegion path: scan for the comment, walk to the next `character,` line, then to its `army` block. Re-Apply your pending Reate edit and the units will land in descr_strat this time." },
    ],
  },
  {
    version: "0.9.657",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Pending changes count no longer stuck after Save.** 0.9.654 fixed the silent-revert bug by *not* clearing `pendingArmyUnits` on a successful Save (the garrison/field-army panels need the overlay because `liveUnitsByRegion` is built from the save buffer and can't be refreshed without a re-import). Trade-off: the badge stayed at \"N changes\" even though everything was on disk — so \"Pending changes (4)\" with \"0 regions, 0 traits, 0 ancillaries\" looked like the body and header disagreed. Now: on a successful Save the entries move from `pendingArmyUnits` → a new `appliedArmyUnits` registry, the badge drops to 0, and the merge sites read from BOTH (pending first, applied as fallback) so the panel keeps showing the saved truth. `appliedArmyUnits` clears when Restore Last Backup rolls descr_strat back." },
      { type: "improvement", text: "**Pending Changes dialog body now surfaces every staged category.** Was \"X regions of buildings, Y characters of traits, Z characters of ancillaries\" + (optional) new generals + dev-dirty files only. Now also shows army-unit edits, character moves, character field edits (age/rank/rename), garrison relocations, and diplomacy edits — so a \"4 changes\" header always has a corresponding row in the body summary." },
    ],
  },
  {
    version: "0.9.656",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Thurii now shows its garrison (Eumedes of Thurioi).** RIS uses `sub_faction athens` to tag Eumedes inside the `romans_julii` block — his line is `character,\\tsub_faction athens,\\tEumedes, named character, …`. Provincia's `bundle-mod-data.js` was skipping *all* `sub_faction` character lines (0.9.506 behaviour, originally meant to drop *unnamed* sub_faction markers like `sub_faction parni,\\tnamed character …` that the engine names at runtime). The bundler now distinguishes the two shapes — skips only when the field after the sub_faction tag is a type label (named character / spy / diplomat / etc.); otherwise it parses the actual name. 80+ named sub_faction characters across RIS (Eumedes among them) now appear in the bundled JSON and in the garrison popup. Same regex update applied to the IPC's by-character army-edit lookup so Save to Mod can locate sub_faction-tagged characters too. Run `npm run bundle-data` (or wait for the next mod refresh) to pick up the new bundled data." },
      { type: "fix", text: "**Reverted the layout-version bump from 0.9.655.** That bump (LAYOUT_VERSION 14→15) was supposed to push *only* the new `bottom.selected` position to existing users — but the migration logic overwrites *every* widget's saved position with the canonical defaults, so people with hand-tuned layouts saw \"the header for selected provinces etc got moved.\" Reverted LAYOUT_VERSION back to 14 and added a one-shot un-migration that detects the v15-shipped `bottom.selected` ({x:0, w:0.572}) and restores the v14 canonical for it ONLY. All other widgets are left alone — any customisations you re-applied after the bad migration are preserved. Saved content (pending edits, character/army changes) is React state, never touched by layout migrations." },
    ],
  },
  {
    version: "0.9.655",
    date: "2026-05-26",
    items: [
      { type: "improvement", text: "**\"Selected provinces\" panel now lines up with the map's left + right edges.** Was a narrower stripe with a 5 px gap to the map's right edge and another gap to the faction list on the left. New canonical default: x=0, w=0.572 — its column matches the map's, so its left/right edges sit exactly on the map's left/right edges below the bottom-strip line. LAYOUT_VERSION bumped to 15, so the migration pushes the new position into existing users' localStorage on next launch (no manual reset needed). The faction picker (bottom.factions) overlays via z-order as before, so the left-side faction list still renders normally on top." },
    ],
  },
  {
    version: "0.9.654",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Removed units no longer pop back into the garrison after Save to Mod.** Save was writing the edit to descr_strat correctly, then clearing `pendingArmyUnits` — at which point the panel re-read `liveUnitsByRegion` (computed from the save buffer, NOT descr_strat, so still showing the pre-edit units) and silently reverted. The post-save snapshot refresh only updated `armiesData` / `startingArmiesByRegion` via a `matches()` that doesn't understand character-name locators, so it skipped Appius-class garrisons too. Provincia now keeps the `pendingArmyUnits` entries after a successful Save, so the garrison merge continues to overlay the applied state and the panel stays consistent with the file. Tradeoff: the Pending Changes count keeps showing the army-unit edits until you click \"Discard all\" or re-import the mod — much better than the silent revert it replaced." },
    ],
  },
  {
    version: "0.9.653",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Pisae / Appius Save fix — the real one this time.** Logs from 0.9.652 showed `wantFac=\"italics\"` reaching the IPC — that's the descr_regions REBEL faction Provincia falls back to when a region's culture-faction differs from its actual owner. Pisae is *owned by* `romans_julii` in descr_strat, where Appius's character record lives. Two fixes: (1) RegionInfo now builds the garrison army descriptor's faction from `ownerFactionId` first (the real save / descr_strat owner), then `garrisonCommander.faction`, then `info.faction` as last resort. (2) Belt-and-suspenders: the IPC's by-character lookup now retries WITHOUT the faction filter on miss — character first names are unique enough campaign-wide that this is safe, and it logs the actual faction it found the character under so we'd catch any other rebel-faction-mismatch class in future." },
    ],
  },
  {
    version: "0.9.652",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Diagnostic logs for the lingering Pisae / Appius \"garrison block not found\" failure.** Verified locally that the descr_strat character header is `character,\\tAppius Claudius_Pulcher, named character, ...` and my regex matches it — so the IPC lookup *should* find Appius in romans_julii's block. Adding logs to find out which step is actually missing on your run: the IPC now logs the faction / locator / byCharacter flag at entry, then per-lookup outcomes (which line matched, where the `army` block was found, how many unit lines, plus on miss: a sample of character first names it DID see in the target faction). Reproduce with a × click + Save to Mod, then send `%AppData%\\Roaming\\Provincia\\provincia.log` (or paste the `[army-units]` lines)." },
    ],
  },
  {
    version: "0.9.651",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Save to Mod now actually writes unit edits for character-led garrisons** (Pisae / Appius case). Failure was *\"Applied 0, 1 failed: units Pisae garrison: garrison block not found\"* — the IPC only knew how to find leaderless `garrisoned_army` blocks, but Pisae's units actually live inside Appius's `army { }` block under his character record. The locator now carries the commander's first name when one's present (Appius / etc.), and the IPC walks the descr_strat character records for that name and edits THAT army. Region-mode is still the fallback for true leaderless garrisons. Also: the unit-write format silently filtered out every unit when the staged shape was `{unit, weapon_lvl}` (Recruitable-click path) instead of the legacy `{name, weapon}` shape — both shapes are now accepted." },
      { type: "feature", text: "**Field-army units edit the same way garrison units do.** Click a field army's title → it becomes the selected edit target (yellow ring, like garrison). Click Recruitable → the new unit appears in that army's grid *immediately*. Each unit on the selected army has the same red × in the top-right; click → removed, card vanishes immediately. Both the live-mode and the non-live (descr_strat) data paths run `pendingArmyUnits` through the field-armies prop so the panel re-renders in real time, not just on Save to Mod. (Hidden prerequisite this fix landed: field-army entries now carry x/y so the click handler actually fires on click — it was silently gated `null != null` in many cases before.)" },
      { type: "feature", text: "**\"Budget\" button — live save entity-budget readout.** Save crackers found the engine indexes each save against a ~65,536-entity pointer registry; on a turn-960 RIS save, dead characters alone consume ~33% of that cap (21,762 of them — they accumulate ~8.6/turn and never get freed). New **Budget** pill in the dev-pill row (green / yellow / red on `deadCount / 65536`) opens a modal with the live + dead-pool + just-died counts, a stacked progress bar against the cap, and a tier-specific warning (\"healthy\" / \"watch closely\" / \"near corruption risk\"). New helpers `countEngineCharacters(buf)` and `countDeadPoolRecords(buf)` (in `saveCrackerExtras.js` / `characterParser.js`) get computed on every save snapshot and surfaced as `aliveCount` / `deadCount` / `inPlaceDeadCount` on the save-data object. On the dev's reference Turn 960 save these match the engine within 3.8% of its own reported counts." },
    ],
  },
  {
    version: "0.9.650",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Garrison cards now actually disappear when you click ×** (and appear when you click a Recruitable unit). The 0.9.649 live-merge was looking up `pendingArmyUnits` under the current `ownerId` key, but RegionInfo's army descriptor keys the entry under `info.faction` (the descr_strat starting owner). When those differed — i.e. any settlement that's changed hands in your save — the merge silently missed and the panel showed the unchanged live garrison. Now it tries `r.faction` first (1:1 with the selection path) and falls back to `ownerId`, so the panel updates immediately regardless of who currently owns the town." },
    ],
  },
  {
    version: "0.9.649",
    date: "2026-05-26",
    items: [
      { type: "improvement", text: "**Army edits show up immediately + × button replaces shift-click.** When the garrison is your edit target, every unit card now shows a small red **×** in the top-right (same pattern as the buildings widget) — click it to remove the unit. And the panel re-renders live as you add (click in Recruitable) or remove (×): the new card appears or the removed one vanishes the moment you click, not after Save to Mod. The garrison's `pendingArmyUnits` entry is merged into the panel's display data on each render, so what you see is what will be written when you save. Field-army cards still use the existing click-the-title-to-select pattern; their live-merge + × is queued for the next ship." },
    ],
  },
  {
    version: "0.9.648",
    date: "2026-05-26",
    items: [
      { type: "feature", text: "**Edit army units from the Region panel (dev mode).** Click any garrison unit card OR a field-army title → that army becomes the **selected edit target** (yellow ring + label). Now every click on a unit in the **Recruitable** panel **appends that unit to the selected army** — perfect for buffing a settlement's garrison or topping up a field stack. **Shift-click a garrison unit** to remove it. (Field-army unit-removal via the same shift-click pattern coming next ship.) An empty garrison can also be selected in dev mode so you can populate it from scratch. Edits stack in `pendingArmyUnits` and apply on **Save to Mod** via the existing `update-army-units` IPC — same plumbing as the prior shift-click-the-map-marker editor, just surfaced in the panel where you're already looking." },
    ],
  },
  {
    version: "0.9.647",
    date: "2026-05-26",
    items: [
      { type: "improvement", text: "**Right column no longer flush against the map.** The map-to-right-column gap (PANELS_GAP) was 6 px — visually flush — so the Settlement / Diplomacy / Characters / Buildings panels looked glued to the map's right edge. Bumped to 10 px so the gap matches the natural inter-panel vertical spacing (≈ 10 px on most screens) — the map-to-right-column gap now reads the same as any other gap between sections. The right column shifts right + shrinks by the delta; saved panel positions resolve through the colBox mapping so individual widgets keep their relative layout." },
    ],
  },
  {
    version: "0.9.646",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Found the real VC bug (#2): orphan faction header in descr_win_conditions.** RIS's `descr_win_conditions.txt` had an `indo_greeks` block (lines 355–360) but no `indo_greeks` faction in `descr_strat.txt` OR `descr_sm_factions.txt` — it's a dead reference. RTW's parser fails on the unknown faction and silently abandons the rest of the file. That's exactly why VCs worked up to `illyrian_kingdom` (last good block before `indo_greeks`) and stopped from `insubres` onwards (next faction after the orphan). The block has been removed from the live file; backup at `_backups/descr_win_conditions_preIndoGreeks_*.txt`." },
      { type: "improvement", text: "**Validate dashboard: new \"VC orphans\" check** that catches this. Cross-references every faction header in `descr_win_conditions.txt` against the real playable-faction list from `descr_strat.txt`; any header without a matching `faction <name>, ai_<...>` line is flagged with click-to-jump. So the entire \"orphan faction header silently kills every VC below it\" class of bug is now a one-click diagnosis going forward." },
      { type: "fix", text: "**Earlier debugging gotcha — `sed -i` on Git Bash strips CRLF.** When fixing the VC file via shell `sed -i`, the operation silently converted CRLF→LF line endings; RTW Remastered won't parse the file in that state. From now on, byte-level edits to RTW config files use Python (`open('rb')`/`open('wb')`) to preserve CRLF exactly. (No code change — just a process fix; calling it out so it doesn't bite again.)" },
    ],
  },
  {
    version: "0.9.645",
    date: "2026-05-26",
    items: [
      { type: "improvement", text: "**Validate dashboard: new \"VC malformed\" check.** Scans `descr_win_conditions.txt` for any line that isn't a faction header / `hold_regions` / `take_regions` / `short_campaign` / outlive list / comment / blank, and lists the offenders with click-to-jump. (Was added while investigating the \"factions after Athens have no VC\" symptom — that root cause is still TBD; deleting the two `hold_region,` (singular, typo) lines in RIS's file did NOT fix it. File has been restored byte-identical to the user's original.)" },
    ],
  },
  {
    version: "0.9.644",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Revert the 0.9.643 \"VC city→region\" conversion — diagnosis was wrong.** In-game testing showed Roman Julii had been working fine in 0.9.642 with the *city-name* form (`Rome, Falerii, Praeneste, …`); converting to region names (`Roma, Faliscia, Latium, …`) broke every faction. So RTW Remastered actually expects **city / settlement names** in `hold_regions`, not region names. Provincia's parser no longer rewrites tokens. The `descr_win_conditions.txt` in RIS has been restored from the timestamped backup made before 0.9.643's overwrite. (The original Epirus-shows-0 symptom is a different bug — investigating; please share a screenshot or describe exactly what's displayed.)" },
    ],
  },
  {
    version: "0.9.643",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Victory conditions: auto-convert city names → region names on load.** Symptom that triggered it: in-game, Epirus (and every other faction) showed 0 victory conditions despite RIS's `descr_win_conditions.txt` looking full. Cause: RTW's engine resolves `hold_regions` tokens against `descr_regions.txt`'s REGION NAMES, but RIS's file listed CITY names (`Ambrakia, Athens, Sparta, Rome…` instead of `Ambrakikos_Kolpos, Attike, Lakonia, Roma…`). RTW silently drops unknown tokens — every faction ended up with 0 valid VCs. Of Epirus's 175 hold-region tokens, only 6 happened to match a region name; the other 169 were rejected. Provincia's VC parser now **auto-builds a city→region map from descr_regions and rewrites city tokens on parse**, so old / hand-edited / legacy files self-heal in-memory. The writer already emits whatever's in memory, so once you Save to Mod, the file is canonical region-name form from then on. A one-time toast announces how many tokens were auto-converted so you know it happened. (Companion fix: RIS's actual `descr_win_conditions.txt` has been overwritten with the corrected version — 7475 city→region swaps, 0 unknowns — with a backup of the original in the campaign's `_backups/` folder.)" },
    ],
  },
  {
    version: "0.9.642",
    date: "2026-05-26",
    items: [
      { type: "feature", text: "**Mod-validation dashboard** (#2 of the 8 — final one). New **Validate** button in the dev pill runs a single scan of the loaded mod and surfaces every consistency bug it finds in one panel: **dangling chain refs** (`building_present <X>` where X has no `building X` block), **dangling level refs** (right chain, wrong level), **descr_strat settlement errors** (`type <chain> <level>` where the chain doesn't exist OR the level isn't one of the chain's declared levels), **missing localization** (declared EDB levels with no `{level}` key in `text/export_buildings.txt`), and **orphaned chains** (defined but with zero refs anywhere AND zero descr_strat prebuilts — cleanup candidates). Five summary tiles at the top; each section is collapsible; **every error row is click-to-jump** straight to the offending file:line in the Scripts editor. The migration / family-tree class of bugs that ate hours earlier in the project would have surfaced here in seconds. **All 8 improvements now shipped.**" },
    ],
  },
  {
    version: "0.9.641",
    date: "2026-05-26",
    items: [
      { type: "feature", text: "**Cross-reference / \"Where is this used?\" panel** (#3 of the 8 improvements). New **X-Ref** button in the dev pill opens a search modal — type any token (chain name, level, trait, ancillary, region, anything else from the EDB / descr_strat / traits / ancillaries / localization) and see every file:line that mentions it, grouped by file. Whole-word, case-sensitive, debounced 220ms. Click a result and it jumps to that exact line in the Scripts editor (Monaco). Also extends `scriptsJumpTo` to accept an explicit `line` argument — precise line wins over text search, so X-Ref clicks land on the right line even when the snippet text appears multiple times. This was the missing tool for migration work (\"find every reference to old `farms` before I delete it\") and is the foundation for the upcoming Mod-Validation Dashboard (#2). 7/8 improvements shipped — last one coming." },
    ],
  },
  {
    version: "0.9.640",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Compare button no longer crashes the app.** A few of the data sources it reads (`factionRegionsMap`, `factionWealth`, `factionColors`, `liveTreasuryByFaction`, `aiPersonalityByFaction`) can be `undefined` depending on what's loaded — the modal blew up trying to index into them. Every lookup is now null-safe, the per-column row builder is wrapped in a try/catch (so one bad faction can't take down the whole modal), and when no mod is loaded the modal shows a friendly *\"pick a mod folder first\"* note instead of three empty pickers. Also adds the same guards to the `factions` iteration in case it's not an array yet." },
    ],
  },
  {
    version: "0.9.639",
    date: "2026-05-26",
    items: [
      { type: "feature", text: "**Command palette (Ctrl-K / Cmd-K).** Fuzzy-find everything from one place — type a few letters and the palette ranks hits across regions, factions, map color modes (faction / culture / AOR / terrain / climate / port / irrigation / earthquakes / hidden resource / garrison / happiness / income / public order / etc.) and actions (Open Scripts, Open EDB in editor, Compare factions). ↑↓ to move, ↵ to activate, esc to close. Picking a region selects + zooms to it; a faction selects + highlights; a mode flips the map; an action runs it. Scoring is prefix > word-boundary > anywhere with length tiebreak. Cuts the dropdown + map-click chain for everyday navigation. 6/8 improvements shipped; remaining: #2 mod-validation dashboard, #3 cross-reference panel." },
    ],
  },
  {
    version: "0.9.638",
    date: "2026-05-26",
    items: [
      { type: "feature", text: "**Faction Compare** (#4 of the 8 improvements). New **Compare** button in the dev pill opens a modal where you pick up to 3 factions from dropdowns and see them side-by-side: starting wealth (with live treasury when a save is loaded), region count (start + live), army count (live), AI personality, and an expandable region list per faction. Each column is colour-coded with the faction's banner colour. No more clicking back and forth between single-faction inspectors to answer \"is X richer than Y at turn 0?\" 5/8 improvements shipped; remaining: #2 mod-validation dashboard, #3 cross-reference panel, #7 command palette." },
    ],
  },
  {
    version: "0.9.637",
    date: "2026-05-26",
    items: [
      { type: "feature", text: "**Open-in-editor plumbing + EDB dev-pill button** (#8 of the 8 improvements). New `scripts-jump-to(fileName, searchText)` IPC opens a config file in the Scripts window's Monaco editor — and, when given a search string, finds + scrolls to the first match. Works whether the Scripts window is already open or not (it opens it and replays the request once Monaco is ready). First entry point is a simple **EDB** button in the dev pill that opens `export_descr_buildings.txt` straight in the editor. The plumbing now supports per-card \"Open in editor\" buttons cheaply — e.g. a building popup can pass `(\"export_descr_buildings.txt\", \"building \" + chainName)` and the Scripts window jumps right to that chain block. More callsites coming in later batches." },
    ],
  },
  {
    version: "0.9.636",
    date: "2026-05-26",
    items: [
      { type: "improvement", text: "**Migrate Building Chain: live preview** in the Configure dialog. As you pick the old chain, the new chains, and the optional alias, a small panel underneath tells you what running this migration *would actually do* — \"EDB block: will be removed · EDB refs: N will be re-pointed (X unmapped — left as-is) · Prebuilts: M will be removed from descr_strat · Localization: K of L new-chain text keys missing.\" Counts come from a new read-only `migrate-preview` IPC that scans EDB / descr_strat / `text/export_buildings.txt` exactly the way the Python step would, without writing anything. Debounced so picking many chains in a row only fires one IPC. (#8 open-in-editor moves to the next batch — it's a bigger plumbing change than it looked.)" },
    ],
  },
  {
    version: "0.9.635",
    date: "2026-05-26",
    items: [
      { type: "feature", text: "**Save-out-of-sync detector.** When you load a save against a mod whose `descr_names_lookup.txt` / `export_descr_character_traits.txt` have drifted since the save was made, name + trait indices resolve to garbage — characters show wrong names, leaders read as commoners, etc. Provincia now flags it: after `characters-init`, it counts how many save characters have the `Factionleader` trait and compares to the mod's faction count. If far fewer leaders resolve than expected (the smoking gun for trait-index drift), a yellow banner appears: *\"Save looks out of sync with the loaded mod — only X of ~Y faction leaders resolved. Make a fresh turn-0 save and re-load.\"* Dismissable per session. (This is the auto-detect for the class of bug that caused the Antigonos II 0/1/0/3 / \"end;Iolaos\" debugging — should save you the next round of it.)" },
      { type: "improvement", text: "**AOR legend: click an AOR to isolate every region tagged with it** (primary fill OR stripe overlay) — fades the rest, zooms to fit the selection. Shift-click to add more AORs; click again to clear. Reuses the same `legendFilter` infrastructure as the culture / religion legends, so the interaction matches what you already know. Tooltip on hover now also shows the count + the hint." },
    ],
  },
  {
    version: "0.9.634",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**AOR map: dominant AOR is now the fill colour** (flipped from 0.9.633, which had it inverted). For a region tagged `aor_suebian, aor_germanic`, the broad ethnic AOR `aor_germanic` is the dominant identity for that area's recruitment — so it now fills the region, and the more specific `aor_suebian` overlays as stripes. Per-region AOR list sorted by global frequency DESCENDING (most common first) with alphabetic tiebreak; palette slots assigned dominant-first so the AORs that fill the most map area each get a distinct colour. Legend uses the same sort, so colours line up across the map and the legend." },
    ],
  },
  {
    version: "0.9.633",
    date: "2026-05-26",
    items: [
      { type: "improvement", text: "**AOR map: the \"proper\" main AOR now shows as the fill colour, with broad regional AORs as the stripe overlay.** Previously the code just took the first `aor_X` tag on a region — which (by RIS authoring convention) is the broad regional bleed: `aor_camillan` (41 regions), `aor_greek` (286), `aor_celtic` (201), `aor_gallic` (169), etc. So every Italian region was filling as the same Camillan beige, hiding its real ethnic identity (`aor_etruscan`, `aor_samnite`, `aor_picentine`, `aor_tarentine`, `aor_lucanian`, …). Each region's AOR list is now sorted by **global frequency, least-common first**, so the most-localized AOR becomes the primary fill and the broad regional AORs become the stripes. Result: every region's specific cultural AOR finally reads at a glance, with the wide regional bleeds visible as overlays. The legend uses the same ordering so colours line up between map and legend." },
    ],
  },
  {
    version: "0.9.632",
    date: "2026-05-26",
    items: [
      { type: "feature", text: "**New dev-pill button: \"Mac.\"** Loads a bundled RIS subset + a sample save shipped inside the installer, so the app works on a machine that doesn't have the game installed (the original ask was a MacBook with no RTW install — hence the name). Click → main process pre-loads mod character data from `resources/bundled-mod/`, the renderer mirrors what a normal mod-pick would set in localStorage (mod data dir, save dir, pinned save file, campaign = Rome), then reloads so every state hook initialises against the bundled paths. Visible on darwin only by default (set `localStorage.showMacBundledBtn = '1'` to also test on Windows). Bundle is assembled by `npm run bundle-mac-demo` from `C:\\RIS\\RIS` and committed to the repo (~60 MB) so CI macOS builds ship it." },
    ],
  },
  {
    version: "0.9.631",
    date: "2026-05-26",
    items: [
      { type: "improvement", text: "**Migrate Building Chain is now self-guiding.** The Configure… dialog shows numbered steps and has a **Run migration now** button that runs just this step (no hunting for checkboxes), then points you to the Changelog/Report tabs and the Save to Mod button. The `farms` and `herds` migrations come pre-configured, so the common case is: open the dialog → Run migration now → Save to Mod. The button stays disabled until at least one migration is set up, with a hint showing how many will run." },
    ],
  },
  {
    version: "0.9.630",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Auto-update could get stuck \"downloaded but never installs\" when the Scripts window was open.** Update status events were only sent to one window (`getAllWindows()[0]`), which — with the Scripts child window open — could be that window instead of the main UI. So the main window's update-watch never received the \"downloaded\" event: it polled every 5 seconds forever and never auto-installed, and the \"Restart & install\" banner didn't appear. Events are now broadcast to **all** windows, so the watch loop stops and auto-installs as intended (and the banner always shows). Note: an *open child window also keeps the app alive*, which blocks the install-on-quit — fully quitting (Scripts window included) installs a staged update. (To get onto this build: fully quit Provincia and relaunch.)" },
    ],
  },
  {
    version: "0.9.629",
    date: "2026-05-26",
    items: [
      { type: "feature", text: "**Migrate Building Chain now has a visual picker** — no more hand-editing the config file. In the Scripts window, the step has a **Configure…** button that opens a dialog where you pick **which chain to remove** (dropdown of every chain in the loaded EDB, with its level count) and **what to replace it with** (a filterable checklist of chains). Optionally choose an alias group (e.g. `cropfarming_level_N`) to re-point references onto all the new chains at once, and whether to remove or keep existing prebuilts. Each migration is listed with a one-click ✕ to delete, and everything is saved straight to `config/chain_migration.txt` (which you can still edit by hand). Auto-fills the old chain's levels from the EDB so you don't have to type them." },
    ],
  },
  {
    version: "0.9.628",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Family tree bogus members are actually gone now** (the 0.9.626 fix was applied to the wrong parser). The mod-data Family Tree is built by a *separate* descr_strat parser in the app core, and that one never stripped inline `;` comments — so the Antigonid `relative Antipatros, Daphne, …, end;Iolaos, …, end` line still produced a card literally named \"end;Iolaos\" plus a string of age-less ghosts (Pleistarchos / Philippos / Nikanor / Alexarchos / Perilaos) from the commented-out tail. That parser now ignores inline comments too, so only the real household shows (Antipatros + Daphne + Kassandros/Nikaia/Phila/Eurydike). Verified against the live RIS file: 0 bogus tokens across every `relative` line." },
      { type: "feature", text: "**Migrate Building Chain now ships seeded with the `herds` migration** (→ the 5 new pastoral chains: sedentary_animal_husbandry + highland/nomadic/forest/wetland_pastoralism). Running it removes the old `herds` EDB block and clears the 74 leftover `herds` prebuilts across the imperial map; the Farms step then assigns the right food chain per terrain. (The EDB pass now removes the old block *before* re-pointing references, so a chain whose only references are internal self-checks — like herds — produces a clean report with no false \"unmapped\" warnings.)" },
      { type: "improvement", text: "**The Farms step now recognises old `herds` prebuilts, not just old `farms`** — so if you run it before the migration, it replaces them with the correct new chain instead of leaving them behind. Audited every Scripts step: none ever writes an old `farms`/`herds` building (the chain actually placed always comes from the new-chain whitelist), and both old chains are now detected for removal." },
    ],
  },
  {
    version: "0.9.627",
    date: "2026-05-26",
    items: [
      { type: "feature", text: "**New Scripts step: \"Migrate Building Chain.\"** A reusable, config-driven tool for retiring an old EDB building chain in favour of new one(s). For each `[migration]` block in `config/chain_migration.txt` it re-points every `building_present[_min_level] <old> <level>` reference onto a replacement token (point it at an alias that ORs all the new chains — e.g. the `cropfarming_level_N` aliases — to \"tie it to all\" at once), removes the old `building <old> { … }` block from the EDB, and strips the old chain's `building { type <old> <level> }` prebuilts from every settlement. It's **idempotent** (re-running is a no-op) and **never fabricates** localization or art — instead it scans traits, ancillaries and `text/export_buildings.txt` and **reports** what to finish by hand (missing new-chain text keys, per-culture `.tga`, trigger rewrites), plus suggested alias bodies. Ships seeded with the `farms` → 5 crop-farm chains migration; add more blocks for the next chains. \"Save to Mod\" now also writes the migrated `export_descr_buildings.txt` back (with a backup, guarded so a stale output is never pushed)." },
    ],
  },
  {
    version: "0.9.626",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Family tree no longer shows bogus members** (e.g. \"end;Iolaos\", plus stray \"age —\" cards like Pleistarchos / Philippos / Nikanor / Alexarchos / Perilaos). The descr_strat parser only stripped whole-line comments, so an *inline* comment on a `relative` line — `relative …, end;Iolaos, …, end` — had its commented-out tail parsed as real family members. Inline `;` comments are now ignored everywhere, so only the actual household shows (with correct ages)." },
    ],
  },
  {
    version: "0.9.625",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Character stats were showing stale cached values** (e.g. Antigonos II still reading 0/1/0 even after the 0.9.623 parse fix). The widget reads a local stats cache that wasn't regenerated; it's now wiped on this update so it rebuilds with the corrected values — **re-calibrate from your save** and Antigonos II reads the right 7/6/5." },
      { type: "improvement", text: "**Diplomacy highlight: click a single faction pill to highlight just that faction**, or click the rest of the line to highlight the whole category. And the \"at war\" highlight no longer includes the Free Peoples (they hold scattered regions everywhere, which flooded the map)." },
    ],
  },
  {
    version: "0.9.624",
    date: "2026-05-26",
    items: [
      { type: "feature", text: "**New Scripts step: \"Remove Defunct Buildings.\"** Strips old/defunct building chains out of every settlement in descr_strat so the chain can then be deleted from the EDB. It auto-detects what's defunct from the EDB's own markers (`building <chain> ;;remove this chain after removing prebuilts`) — e.g. the old `herds`/`farms` lines — and you can list extra chains in config/defunct_buildings.txt. (On the RIS imperial map it cleared 74 leftover `herds` prebuilts, including Saka's.) Writes a changelog of exactly what it removed, like every other step." },
    ],
  },
  {
    version: "0.9.623",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Character Command / Management / Influence stats were misread for many generals.** The save parser located the stat block at a fixed offset whose record layout could be mis-detected, reading the values 4 bytes off — so e.g. Antigonos II showed 0/1/0 instead of his real 7/6/5. Stats are now found by their byte-frame signature, which is layout-independent. Verified + locked with a regression test (Antigonos II Gonatas = Command 7 / Influence 6 / Management 5). Re-sync from your save to pick it up." },
      { type: "improvement", text: "**Diplomacy widget: faction names now render as colour-coded pills** for legibility (a tinted chip in each faction's colour) instead of plain coloured text." },
    ],
  },
  {
    version: "0.9.622",
    date: "2026-05-26",
    items: [
      { type: "improvement", text: "**Diplomacy widget: colour-coded faction names + click-to-highlight on the map.** Each war / allied / trade / protectorate name now shows in that faction's own colour (auto-lightened where it'd be too dark to read). And clicking any diplomacy line — \"at war\", \"allied\", \"trade\", etc. — highlights all of those factions' regions on the map at once." },
    ],
  },
  {
    version: "0.9.621",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Live diplomacy was showing the wrong factions for everyone — root-caused and fixed.** The attitude matrix is indexed by descr_sm_factions declaration order and self-calibrates, but it was being fed the engine-*derived* order (which moves the rebel slot to the end). That double-corrected and mislabeled every pair, so e.g. Macedon's allies/wars came out as unrelated factions. It now uses the raw order, validated against Macedon's turn-0 ground truth: allies Seleucid / Cabyle / Knossos / Messene, protectorates Argos / Megalopolis, at war with Epirus / Galatians / the Free Peoples. **Re-sync from your save** (load it / let the save-watch refresh) to pick up the corrected diplomacy." },
      { type: "feature", text: "**Diplomacy widget now shows trade partners (🔄).** Cracked the alliance/trade \"bond\" field in the save's attitude matrix — each faction's trade partners are now listed alongside war / allied / protectorate. (RTW's descr_strat folds Ally + Trade into one relationship, and protectorates trade too, so trade = the bonded set.)" },
    ],
  },
  {
    version: "0.9.620",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**Diplomacy is now consistent for all factions — engine placeholder factions are excluded everywhere.** RIS has non-diplomatic placeholder slots (the independent rebels/slave, the bankrupt `dummies` slot, and per-faction respawn markers like `seleucid_rebels`). Their attitude data is meaningless but was leaking into real factions' lists — e.g. \"dummies at war with Macedon.\" They're now filtered at the source (the decoded attitude matrix) and uniformly across the widget, the dev raw-attitudes view, and the diplomacy editor. The independent rebels show at war with all factions; placeholders show no diplomacy; real factions are unaffected." },
      { type: "fix", text: "**Protectorates are no longer double-listed as plain allies.** A protectorate scores as Allied (attitude 0) in the save's matrix, so it appeared under both \"allied\" and \"protects.\" The Diplomacy widget now lists it only as a protectorate. Validated against Macedon's turn-0 ground truth: allies Seleucid / Cabyle / Knossos / Messene, protectorates Argos / Megalopolis, at war with Epirus / Galatians / the Free Peoples." },
    ],
  },
  {
    version: "0.9.619",
    date: "2026-05-26",
    items: [
      { type: "fix", text: "**The independent \"Free Peoples\" (rebels) no longer shows as allied with everyone.** The engine keeps no real diplomacy for the rebel faction, so its decoded attitude row defaulted to Allied toward all factions — the Diplomacy widget was showing the rebels with ~92 allies. It now correctly shows them at war with all factions and with no allies, matching RTW's no-peace-with-rebels rule." },
    ],
  },
  {
    version: "0.9.618",
    date: "2026-05-25",
    items: [
      { type: "fix", text: "**Auto-update now also checks while the app is open.** Previously Provincia only checked for a new version at startup, so if a release went out while you had the app running, it wouldn't notice until the next launch. It now re-checks every 10 minutes too — new versions download in the background and install on quit (or via the \"Restart & install\" banner). (To get onto this build, restart once.)" },
    ],
  },
  {
    version: "0.9.617",
    date: "2026-05-25",
    items: [
      { type: "feature", text: "**Victory conditions — \"VC Owners\": find who owns a list of regions.** New dev-pill button: pick a CSV/text list of region or city names and it writes out a CSV mapping each one to the faction that owns it in the loaded mod's descr_strat. It resolves both region and city names (e.g. Falerii → Faliscia → romans_julii); anything it can't match comes out as NOT_FOUND. Handy for auditing a victory-condition region list against actual map ownership." },
      { type: "fix", text: "**Scripts: the Homelands step now writes a changelog** like every other step — its added/removed homeland buildings and colony changes now show up in the Scripts Changelog tab, grouped by settlement." },
    ],
  },
  {
    version: "0.9.616",
    date: "2026-05-25",
    items: [
      { type: "feature", text: "**The Settlement Processor Suite is now built into Provincia.** A new **\"Scripts\"** button in the dev pill opens the full Suite — Pipeline, Editor, Master, and Compare — in its own window, no separate install. It bundles its own Python runtime (with Pillow), so nothing extra is needed on your machine, and it auto-loads whichever mod Provincia currently has open (no second folder picker). Run any of the 16 processing steps, edit scripts/config, and Save back to your mod. The standalone Suite app is superseded by this." },
    ],
  },
  {
    version: "0.9.615",
    date: "2026-05-25",
    items: [
      { type: "feature", text: "**Faster victory-conditions editing: \"Clear all\" + click-to-add.** In Victory map mode (dev) with a faction selected, a plain left-click on a region now toggles it straight in/out of that faction's victory conditions — no right-click menu — so you can rapidly click region after region. A new **\"Clear all\"** button in the Victory panel empties the selected faction's hold-regions in one go. Both are fully Ctrl+Z-undoable." },
      { type: "fix", text: "**Faction starting treasury now shows the real per-faction value — no fabricated defaults.** The Faction Wealth panel was reading stale bundled data (every faction looked like ~10,000). Starting denarii are now re-bundled from descr_strat at build time, and a faction with no treasury data shows \"—\" instead of a made-up 0." },
    ],
  },
  {
    version: "0.9.614",
    date: "2026-05-25",
    items: [
      { type: "feature", text: "**One-click \"All Warring (600)\" preset for victory-target diplomacy.** In the diplomacy editor's Victory-targets panel, alongside the distance-based \"Split\", there's now a flat preset that sets every faction owning one of your victory-condition regions to Neutral attitude (200) + Warring aggression (600), one-way (you → them). It deliberately leaves the war/ally relationship state untouched — that's a per-faction modder decision. Automates the manual descr_strat / descr_win_conditions / descr_regions cross-reference workflow." },
    ],
  },
  {
    version: "0.9.613",
    date: "2026-05-25",
    items: [
      { type: "fix", text: "**Diplomacy number fields no longer blank out when you click away.** A staged edit is kept as a small record internally, but the editor was reading that whole record back into the number box instead of just the number — so on blur the field rendered empty (the value was actually still staged, just invisible). The editor now unwraps the staged value correctly, so your typed number stays visible after you click out." },
    ],
  },
  {
    version: "0.9.612",
    date: "2026-05-25",
    items: [
      { type: "improvement", text: "**Hovering a region in the right-hand list now highlights it on the map.** When you hover an entry in the \"Victory target regions\" / \"Selected Provinces\" list, that region's outline lights up in bright gold on the map (and the list row tints) so you can instantly see where it is — especially handy in victory-conditions map mode." },
    ],
  },
  {
    version: "0.9.611",
    date: "2026-05-25",
    items: [
      { type: "fix", text: "**The diplomacy \"All numbers\" editor fields are now properly editable.** Each value field was fully controlled with an instant parse, so clearing it snapped back to 0 and you couldn't type a value manually. The fields now keep a local draft while you type — you can clear them, type partial/negative numbers, and the parsed value is staged live (with the final value committed, empty → 0, on blur or Enter)." },
    ],
  },
  {
    version: "0.9.610",
    date: "2026-05-25",
    items: [
      { type: "feature", text: "**Backup + restore safety net for mod edits.** Every Apply now snapshots descr_strat (+ names.txt, descr_names_lookup, descr_win_conditions) to timestamped backups *before* writing. A new **\"Restore last backup\"** button in the Pending changes dialog rolls the files back to the snapshot from before your last Save — your undo for the whole batch. Keeps the newest 10 snapshots." },
      { type: "improvement", text: "**Pre-Save validation.** The Pending changes dialog now flags likely-bad edits (an army left with 0 units, two Faction Leaders for one faction) before you Apply." },
      { type: "improvement", text: "**Dev-tools cheatsheet.** A collapsible \"Dev tools\" panel (bottom-left, dev mode) lists the hidden gestures: drag to move generals, drag a garrison to relocate it, Shift+click to edit units, right-click a character to edit, Ctrl+Z to undo, double-click the version to auto-update." },
    ],
  },
  {
    version: "0.9.609",
    date: "2026-05-24",
    items: [
      { type: "feature", text: "**Edit the units in any starting army or garrison — including leaderless ones.** Shift+click an army/garrison marker on the map (dev mode, starting view) to open a unit editor: remove units (×) and add any unit from the owning faction's full roster. Works for general-led armies, captains, AND leaderless `garrisoned_army` garrisons. Bodyguard units are protected from removal. On Save the army's unit lines are rewritten in descr_strat; staged + revertable + Ctrl+Z like every other edit." },
    ],
  },
  {
    version: "0.9.608",
    date: "2026-05-24",
    items: [
      { type: "feature", text: "**Rename a starting general.** The right-click \"Edit starting general\" box now has a First-name field (alongside age + rank). On Save it renames the general everywhere in descr_strat — the `character` line AND any `relative`/family lines — keeping the surname, adds the new first name to names.txt + descr_names_lookup if it's not already there, and refuses a rename that would duplicate an existing full name in the faction. With age/rank/traits/ancillaries/move, the starting-general editor is now complete." },
    ],
  },
  {
    version: "0.9.607",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**Live diplomacy faction names + non-player treasuries are now correct.** The engine enumerates factions in a different order than descr_sm_factions — the first rebel slot is moved to the end — so this campaign's faction records and the diplomacy attitude-matrix rows were mislabeled by one past the start (your \"at war\" list showed *Megalopolis* when it was really *Messapians*, and non-player treasuries were wrong too). Cracked the engine's true order and applied it: war/ally names and every faction's treasury now resolve to the right faction. Validated against the live save (Rome's war = Messapians; Messapian, slave, and rebel records all line up)." },
    ],
  },
  {
    version: "0.9.606",
    date: "2026-05-24",
    items: [
      { type: "feature", text: "**Drag a leaderless town garrison out to the map — it becomes a captain-led army.** Grab a `garrisoned_army` marker (dev mode, starting view) and drop it on a field tile. On Save, the settlement's `garrisoned_army` block is removed and a captain army is created at the tile with those units — using the verified vanilla syntax (`character <Name>, general, …` = captain; the name is borrowed from the faction so it's valid in names.txt). Staged like every other edit (shows green while staged, revertable, Ctrl+Z)." },
    ],
  },
  {
    version: "0.9.605",
    date: "2026-05-24",
    items: [
      { type: "improvement", text: "Leaderless town garrisons (the `garrisoned_army` markers now shown on the map) aren't draggable — they have no general/character to relocate, so dragging is disabled to avoid staging a move that would fail. General-led armies (including garrisoned ones) stay fully movable." },
    ],
  },
  {
    version: "0.9.604",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**Leaderless town garrisons now show on the map.** RIS places many garrisons as `garrisoned_army` blocks — loose units inside a settlement with no general/character — which carry no coordinates, so they never drew a map marker. They're now pinned to their settlement tile and rendered like any other army (they were already listed in the Garrison panel). Naval fleets (admiral-led, no \"general\" unit) already render — toggle the Navies layer to see them." },
    ],
  },
  {
    version: "0.9.603",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**A moved starting general can now be moved again.** After dragging a general to a new tile, its marker showed at the new spot but the drag grab-zone stayed on the old town, so you couldn't pick it up a second time. The hit-test now follows the marker to its staged tile (re-dragging updates the same move), and after Save the army snapshot's coordinates update to the new tile so further moves keep working." },
      { type: "feature", text: "**Ctrl+Z reverts your last edit.** Undo now pops the most recent staged dev edit — building add/upgrade/replace, general move, age/rank change, trait, ancillary, diplomacy, resource, or victory-condition — with a toast confirming what was reverted. When nothing is staged it falls back to the existing region/resource/population undo." },
    ],
  },
  {
    version: "0.9.602",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**The building editor no longer hides building trees.** The previous one-per-slot rule HID every chain whose slot was already filled, which made ~50 trees vanish from a developed settlement (you couldn't browse the entertainment options, trade/resource buildings, civic alternatives, etc.). Now **all** buildable trees show. Adding a building whose slot is already occupied (another temple, government, entertainment building, …) **replaces** the current occupant instead of stacking a second — the picker marks those entries \"↔ replaces\" and the change log says \"replace X with Y\". This keeps the no-double-government behaviour while letting you freely browse and switch buildings." },
    ],
  },
  {
    version: "0.9.601",
    date: "2026-05-24",
    items: [
      { type: "feature", text: "**Edit a starting general's age and rank.** Right-click a general (dev mode) to open the info popup — a new \"Edit starting general\" box lets you change their age and rank (General / Heir / Faction Leader). Staged like every other dev edit and written to the general's descr_strat `character` line on Save (name, coords, and inline stats are preserved). Complements the existing drag-to-move, trait, and ancillary editing. Name editing + garrison relocation are coming next." },
    ],
  },
  {
    version: "0.9.600",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**The building editor now respects every one-per-settlement slot, not just governments.** RTW allows only one building per \"tag\" (temple, government, civic, port, heavy industry, metals, sanitation, entertainment, the farm/exploit slots, etc. — enforced by the engine's `no_other_<tag>` rule). The Add-building picker now hides any chain whose slot is already filled by a built building, so you can't stack a second temple, government, market and so on — you replace the existing one. Generalises the previous government-only fix." },
    ],
  },
  {
    version: "0.9.599",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**The building editor no longer offers a second government.** Governments (governmentA/B/C/D) are mutually exclusive — only one per settlement (the engine's `no_other_government` rule). After the previous fix made them addable again, the picker was offering ALL of them even when one was already built. Now, once a settlement has a government, the other government chains are hidden — you must replace the existing one rather than stack a second." },
    ],
  },
  {
    version: "0.9.598",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**Government buildings can be re-added in the building editor.** Chains whose requirement uses the `factions { all }` wildcard (every government building — governmentA/B/C/D) were hidden from the Add-building picker because \"all\" was treated as a literal faction name, so a removed government could never be added back. The wildcard is now recognised (any other chain using `factions { all }` that was wrongly hidden also reappears)." },
    ],
  },
  {
    version: "0.9.597",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**Live treasury (and diplomacy) now populate the moment you enter Live mode.** The real cause of the stuck \"10,000 d\": the cracker-extras (faction treasuries, record owners, the diplomacy matrix, etc.) were only wired into the save-CHANGE handler, never the initial Live-load path — so until you ended a turn and wrote a new save, the player treasury fell back to descr_strat starting cash and diplomacy showed stale data. The initial load now sets them immediately." },
      { type: "improvement", text: "Double-clicking the version to watch for updates now **auto-installs** the update the moment it finishes downloading — no \"Restart & install\" click needed. Double-click again to cancel before one appears." },
    ],
  },
  {
    version: "0.9.596",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**Live treasury no longer gets stuck on the descr_strat starting cash (e.g. Rome showing 10,000 d).** Two faction-record states were being seeded from stale localStorage left by a much older app version (23 imperial records + empty treasuries) and an empty/partial live snapshot could overwrite a good 239-record parse with nothing — so the player's record was never found and the panel fell back to starting denarii. These states now start clean and only accept non-empty live data, and a `[save-snapshot]` log records exactly what each snapshot carries." },
      { type: "improvement", text: "Build-queue cards now show the **number of turns left** in the top-right corner (e.g. a 4 on the Venusia farm upgrade), decoded from the save's construction record." },
    ],
  },
  {
    version: "0.9.595",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**Government buildings now show in live mode.** The save's building parser rejected any chain name containing an uppercase letter, which silently dropped every government building (`governmentA/B/C/D` — the \"direct rule\" etc. tiers) from every settlement. So a freshly-built government in a just-conquered town never appeared. Uppercase suffixes are now allowed, validated against a conquered settlement that built a new government between turns." },
      { type: "improvement", text: "**Build queue now shows upgrades as building cards with a green progress overlay.** Each in-progress construction is rendered like a Buildings-panel card (the target building's icon) with a green fill rising from the bottom = % complete (50% = bottom half green), matching the in-game construction visual." },
      { type: "fix", text: "Unit experience chevrons now point downward, matching the in-game chevrons." },
      { type: "improvement", text: "Live mode hides the developer debug stats on the Factions strip — it now shows just the turn and year." },
    ],
  },
  {
    version: "0.9.594",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**Live treasury now works for this campaign — including the PLAYER faction.** The treasury parser only understood the imperial campaign's faction-record layout (`+44==6`); the \"Republic of Rome\" campaign uses a different one (`+44==8`) with one record per faction (player included), stored in faction order with the current treasury at +0 and the start-of-turn snapshot at +48. Cracked and validated against a live save (the player record holds the exact in-game treasury, and all 239 faction records map cleanly). Every faction's live treasury / net income now shows instead of falling back to descr_strat starting cash." },
    ],
  },
  {
    version: "0.9.593",
    date: "2026-05-24",
    items: [
      { type: "improvement", text: "The Build queue section now shows the building's icon (like the in-game construction queue) next to the upgrade name and progress %." },
    ],
  },
  {
    version: "0.9.592",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**A building being upgraded no longer shows its finished form prematurely.** Previously the Buildings panel replaced a building with its in-progress upgrade target (so a settlement appeared to already have the new building even with several turns left). Now the building stays at its current level in the Buildings panel until construction completes, and the upgrade (e.g. \"Trader → Market\") is listed in the Build queue section with its progress %." },
    ],
  },
  {
    version: "0.9.591",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**Settlement buildings no longer show a neighbouring settlement's buildings in live mode.** The save building parser's block boundary could bleed an adjacent settlement's chain records into a settlement, e.g. besieged Brundisium was listing the neighbouring Arcadian city's temple + theatres + sewers + irrigated farming on top of its own. Provincia now detects this (a settlement can only have one temple complex) and falls back to the descr_strat building list — which is also the correct, current set for an unchanged/besieged settlement." },
    ],
  },
  {
    version: "0.9.590",
    date: "2026-05-24",
    items: [
      { type: "improvement", text: "Added a one-per-region `[bld-dbg]` dump to provincia.log (static vs live-parsed vs merged building lists) to trace live-mode settlement-building mismatches." },
    ],
  },
  {
    version: "0.9.589",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**Besieging armies now appear in the besieged region's Field armies panel** (the 0.9.588 attempt relied on a \"moved\" flag that isn't actually decodable). A stack sitting immediately adjacent to a settlement tile is now attributed to that settlement's region, so Aulus besieging Brundisium shows under Calabria instead of his stale \"Taras\" tag. The governor case stays correct (his nearest settlement is his own city, or he falls through to his reliable save tag)." },
    ],
  },
  {
    version: "0.9.588",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**A moved army (e.g. a besieger) now appears in the correct region's Field armies panel.** The panel bucketed armies by their save unit-record region tag, which the engine never refreshes when a stack moves — so Aulus besieging Brundisium stayed listed under his old region (\"Taras\") even though his map marker and Characters entry were correct. Armies that moved this turn are now bucketed by their actual tile's region. Stationary armies keep the save tag (guards the governor pixel-drift case)." },
    ],
  },
  {
    version: "0.9.587",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**A general defending his own settlement now shows as the garrison, not a field army.** The garrison detector required the on-tile stack's faction to match the settlement owner, but the army-faction tag (a captain_card heuristic) is sometimes wrong (e.g. a Messapian Titus mis-tagged \"massalia\"), which demoted him to a field army with the garrison reading \"No units stationed\". The faction guard now only applies to live-log-attributed positions (possible besieger mis-snaps); a SAVE-derived stack sitting exactly on a settlement tile is trusted as the garrison regardless of its tag." },
      { type: "fix", text: "**Diplomacy now shows war with the independent \"Free Peoples\".** Every faction is permanently at war with the rebel/independent faction, but the save's attitude matrix only encodes declared faction-to-faction wars, so that universal state was missing from the list. It's now surfaced for every real faction." },
    ],
  },
  {
    version: "0.9.586",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**Garrison vs field army now re-derived from each army's final position.** Live-log position updates could move an army (e.g. a besieger, or a general defending a city) without re-running the garrison/field classification, so a general garrisoning a settlement could show as a field army. Provincia now reclassifies every land army from its final tile: exactly on a settlement pixel = garrison, anything else (including a besieger one tile away) = field." },
      { type: "improvement", text: "Added a one-per-save `[army-dbg]` dump to provincia.log (name, faction, position, class, live-tracked, on-settlement-tile) to diagnose remaining live-mode army placement cases." },
    ],
  },
  {
    version: "0.9.585",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**Removed false weapon/armour upgrade chevrons on live units.** Units were showing a phantom \"+1 sword\" (e.g. all of Aulus Gabinius's Roman infantry). The upgrade was read from a unit byte that, across turn 1/5/7 saves, is only ever 0 or 1 (≈63% of units = 1) and never rises with actual blacksmith upgrades — i.e. it's a static base attribute, not an upgrade level, and there's no EDU weapon_lvl to correct against. Until the real per-unit upgrade source is cracked, Provincia no longer paints these false chevrons. (Unit XP/chevrons are unaffected.)" },
      { type: "improvement", text: "Added per-stage timing to the live save parse (logged to provincia.log) to pinpoint any remaining load hotspots." },
    ],
  },
  {
    version: "0.9.584",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**The big one: live-mode turn-end no longer hangs for ~27 seconds.** The construction-queue parser was running an UNBOUNDED buffer search for each of 19 building chains across all ~1300 settlements — every chain not found near a settlement scanned the entire 33 MB save to the end. That single loop was ~26.5 s on a turn-end parse. Bounding the search to the small window the result is actually restricted to drops it from ~26,500 ms to ~10 ms, with byte-for-byte identical output (profiled against a real save). Combined with the 0.9.583 character-parser fix, live loads should go from ~30 s to a few seconds." },
    ],
  },
  {
    version: "0.9.583",
    date: "2026-05-24",
    items: [
      { type: "improvement", text: "**Live mode loads ~1 second faster per turn.** The character-data parser was scanning the entire 35 MB save once for every culture×role combination (~200 full passes); it now does a single pass per role (7 total), cutting that step from ~1.1 s to ~45 ms on the main thread. Going into live mode and ending a turn now hangs far less. Output is byte-for-byte identical (verified against a real save)." },
    ],
  },
  {
    version: "0.9.582",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Crosstalk with Manipula (the recruitment tool).** Provincia now watches the active mod's `export_descr_buildings.txt` and auto-reloads recruitment data the moment Manipula (or any editor) saves it — the recruitment map colour-mode and per-region recruit lists refresh live, no manual re-import. The two tools edit different files in the same `data` folder, so they stay out of each other's way." },
    ],
  },
  {
    version: "0.9.581",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Diplomacy split can now include Rel (the starting state).** Next to the Aggr-link toggle there's a Rel toggle: when on, the 33/33/33 split also sets faction_relationships so the closest (warring) third actually STARTS AT WAR, while the rest stay neutral. Off by default." },
      { type: "feature", text: "**Diplomacy: \"how others see you\" reverse view.** A 🔄 toggle flips the whole editor to show (and edit) how every other faction views the selected faction. One-sided pairs are flagged inline with a ⇄ marker showing the opposite direction's attitude, so you can spot asymmetric relationships before saving." },
      { type: "improvement", text: "**Victory-condition edits are now fully revertable through Save.** Toggling a region in/out of a faction's victory conditions (right-click in Victory colour mode) now appears in the Changes review with a per-item × revert, is undone by Discard all, and writes to descr_win_conditions.txt on Save — matching the diplomacy/add-general flow." },
      { type: "improvement", text: "**Pre-Save review is now grouped by target file.** The Changes modal lists every staged edit under the mod file it writes to (descr_strat.txt, descr_win_conditions.txt, +names.txt/lookup for new generals), so it's clear exactly what each Save will touch." },
    ],
  },
  {
    version: "0.9.580",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Diplomacy editor: \"Victory targets by proximity\".** A new section at the top of the diplomacy editor lists every faction that owns a region in your victory conditions, ordered by how close its nearest such region is to your borders (nearest first) — so you can decide each diplomatic stance by threat distance. A **Split 33/33/33** button sets the closest third to Warring (600), the middle third to Hostile (400), and the farthest third to Neutral (200); the rows are tinted red/yellow/green to preview the split before you click. The split sets both Core and Aggr by default (Aggr is the trend a relationship drifts toward) — toggle \"Aggr linked\" off to set Core only. Nothing is locked: every value stays editable afterward." },
    ],
  },
  {
    version: "0.9.579",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Minor factions with no Classic victory conditions now get a sensible default goal.** Every faction that owns land at campaign start but had no Classic VC (118 of them) now lists its starting regions (capital first, then nearest-to-capital) with a `take_regions` of (starting count + 20) — so they must conquer 20 more settlements to win instead of instantly winning on turn 1. Only the non-playable markers (slave, dummies, roman_rebels_1/2) remain without a VC." },
    ],
  },
  {
    version: "0.9.578",
    date: "2026-05-23",
    items: [
      { type: "fix", text: "**Fixed ~94 factions silently showing no victory conditions** (e.g. Macedon/Antigonid, Ptolemaic, Seleucid, Epirus). The victory-conditions parser treated any bare faction-name line as a new block header — so a single-faction `outlive_factions` entry (a lone faction token under `short_campaign outlive_factions`) was mistaken for a new block and RESET that faction's already-parsed VC to empty. The parser now only starts a block when the next line is `hold_regions`/`take_regions`, so Macedon correctly shows its full 161-region goal." },
    ],
  },
  {
    version: "0.9.577",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Imperial Campaign victory conditions ported from Classic RIS.** Each faction's VC now lists its starting regions first (capital, then nearest-to-capital), followed by the Classic conquest targets in their original hand-made order. Because the big map splits each Classic province into several regions, every split is pulled in (a big-map region is included if it sits mostly inside the old Classic province). Rome combines all four Classic Roman factions (Julii/Senate/Brutii/Scipii) into one and always holds the whole Italian peninsula. E.g. the Achaean League goes from 12 Classic regions to 55 on the big map (3 starting + 52 conquest, Aigion-first)." },
    ],
  },
  {
    version: "0.9.576",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Diplomacy editor: bidirectional edits.** Toggle '⇄ Bidirectional' (or press Ctrl/⌘+B mid-edit) so changing this faction's stance toward another also sets the reverse (other → this) to the same value — for symmetric relationships in one keystroke. Off by default; works for all three values (Core/Rel/Aggr)." },
    ],
  },
  {
    version: "0.9.575",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Diplomacy editor now shows & edits all THREE descr_strat values per faction pair**, not just core_attitudes: Core (AI disposition), Rel (faction_relationships — the actual STARTING STATE: ≤199 ally / 200 neutral / ≥201 war), and Aggr (faction_agression — post-turn-1 aggressiveness). All three are editable and written on Save. This resolves the earlier confusion: e.g. Pergamon→Seleucid is Core 600 (warring disposition) but Rel 199 — i.e. actually ALLIED at start, which is why they're not at war in-game." },
    ],
  },
  {
    version: "0.9.574",
    date: "2026-05-23",
    items: [
      { type: "fix", text: "**Diplomacy editor labels now match RIS's own terms — and clarify these are attitudes, not declared wars.** A 600 value is the AI's 'Warring' DISPOSITION, not a formal state of war (the descr_strat docs even note 400 = 'Hostile, not warring'). Relabelled the scale verbatim from the descr_strat header: −10 Forced ally · 0 Allied · 100 Suspicious · 200 Neutral · 400 Hostile · 600 Warring · 850 Total war · 1000 Crazy, with a note that core_attitudes is the starting disposition the AI uses for diplomacy decisions, not a declared war." },
    ],
  },
  {
    version: "0.9.573",
    date: "2026-05-23",
    items: [
      { type: "fix", text: "**Diplomacy editor: corrected the rebel handling.** Only the generic `slave` faction now defaults to At War (600) — a faction is NOT automatically at war with the per-faction respawn markers (`seleucid_rebels`, `ptolemaic_rebels`, `roman_rebels_1/2`, etc.), which were wrongly shown at 600. Those sub-faction markers are now also hidden from the list (they're spawn placeholders, not real diplomatic factions), so you no longer see duplicate '…rebels' entries. Real per-pair values from core_attitudes are unchanged." },
    ],
  },
  {
    version: "0.9.572",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Diplomacy editor (dev mode).** A new '✎ All numbers' button on the Diplomacy widget opens a searchable list of EVERY faction with this faction's starting attitude toward it — the real descr_strat core_attitudes value (−10 locked ally / 0 allied / 200 neutral / 400 hostile / 600 at war / …), defaulting unlisted pairs to 200 and rebel/slave factions to 600 (at war). Each value is editable; changes are staged like other dev edits and written to the descr_strat core_attitudes section on Save (revertable under Changes)." },
    ],
  },
  {
    version: "0.9.571",
    date: "2026-05-23",
    items: [
      { type: "improvement", text: "**Campaign-start diplomacy inspect now shows the actual numbers.** With no save loaded, the right-click raw-diplomacy panel listed only stances; it now shows the engine's starting core_attitudes derived from those stances — Allied = 0, At War = 600, and every other faction = 200 (Neutral) — e.g. 'War: Galatians 600 · Allied: Seleucid Empire 0, Cyzicus 0 · Everyone else: 200'." },
    ],
  },
  {
    version: "0.9.570",
    date: "2026-05-23",
    items: [
      { type: "improvement", text: "**A saved general now also shows in the Field Armies widget and on the map** (its bodyguard army is injected into the army view on Save), not just the Characters list / Family Tree. (The on-disk descr_strat is permanent; the army map/widget injection is for the current session — a full mod re-import rebuilds the baked army snapshot.)" },
    ],
  },
  {
    version: "0.9.569",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Diplomacy widget shows the raw attitude numbers in dev mode.** Under the named war/ally lists, a 'Raw attitudes' row now lists every faction with the actual core_attitudes value the engine uses to evaluate the relationship (e.g. Rome 200, Athens 400), colour-coded and sorted, with bond + aggression in the tooltip. Requires a synced save (the engine computes these values at runtime)." },
    ],
  },
  {
    version: "0.9.568",
    date: "2026-05-23",
    items: [
      { type: "fix", text: "**A saved general now appears in the Characters view and Family Tree right away.** Those views read a cached parse of descr_strat that wasn't refreshed after writing the new general; the cache is now re-parsed after Save (and after a character move), so the new general shows up without re-importing the mod." },
    ],
  },
  {
    version: "0.9.567",
    date: "2026-05-23",
    items: [
      { type: "fix", text: "**Added generals' names are now registered correctly in names.txt / descr_names_lookup.txt.** The new name tokens were being appended at the very end of those files — after the `ZZZZZ` end-marker — so the engine never read them and couldn't resolve the new general's name. They're now inserted in alphabetical (sorted) position, before `ZZZZZ`, matching how both files are organized. This was the remaining cause of campaign-load errors after adding a general." },
    ],
  },
  {
    version: "0.9.566",
    date: "2026-05-23",
    items: [
      { type: "improvement", text: "**Added generals get a location comment above them in descr_strat**, matching the game's own style: `;<City>` when placed on the settlement's tile, or `;Outside <City>` when you've dragged them off into the region. Makes the generated entries self-documenting and easy to find in the file." },
    ],
  },
  {
    version: "0.9.565",
    date: "2026-05-23",
    items: [
      { type: "fix", text: "**Added generals now load with no descr_strat errors.** Two problems fixed: (1) the new `character_record` lines were written after the faction's `relative` lines, which RTW rejects with \"Unexpected section after relative: character_record\" — they're now inserted before the relatives, in the correct section; (2) the generated lines are written in your mod's actual format (`character, Name, named character, age N, , x, y` and `character_record\tName, gender, age N, alive, never_a_leader`) — the previous build matched a different descr_strat variant that carried command/influence/management/subterfuge stats. The app's parser was also made tolerant of both descr_strat dialects." },
    ],
  },
  {
    version: "0.9.564",
    date: "2026-05-23",
    items: [
      { type: "fix", text: "**Critical: added generals no longer break the campaign.** The generated descr_strat entries were missing the required `command/influence/management/subterfuge` stats and wrote an invalid gender field on the `character`/`character_record` lines, and the bodyguard unit name was truncated (e.g. `pergamene general` instead of `pergamene general's bodyguard` — a unit that doesn't exist). All fixed, so a saved general now loads cleanly with no game errors. (If you already saved a broken one, restore the `descr_strat.txt.<timestamp>.bak` backup that was written next to it.)" },
      { type: "feature", text: "**Drag existing characters on the map.** In dev mode (campaign-start view), grab any general's marker and drag it to a new tile; the marker turns green to show the staged move. Written to descr_strat on Save and revertable under Changes." },
      { type: "improvement", text: "**Saved generals now appear in the Characters roster & Family Tree immediately** after Save (the descr_strat character data is reloaded), not only while pending." },
    ],
  },
  {
    version: "0.9.563",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Staged generals now appear in the Family Tree** (with a dashed green ‘⏳ pending — Save to apply’ card), including their wife and children, so you can see the addition in context before saving." },
      { type: "improvement", text: "**Diplomacy raw-inspect moved to a right-click on the widget** (dev mode) with a hover hint. It now also works at campaign start — showing the descr_strat starting stances (war/allied/protectorate) when no save is loaded, and the full numeric attitude matrix once one is." },
    ],
  },
  {
    version: "0.9.562",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Drag staged generals on the map.** Each general you add now shows as a green ‘+’ marker at its spawn tile; grab it and drag (dev mode) to reposition where it'll appear. Like everything else it's only written to descr_strat on Save, and reverting the staged general removes the marker." },
      { type: "change", text: "**Removed the hard-to-read ‘right-click: raw #s’ hint** from the Diplomacy & Treasury widget header." },
    ],
  },
  {
    version: "0.9.561",
    date: "2026-05-23",
    items: [
      { type: "improvement", text: "**Add General now uses the empty space below it first.** The form panel anchors its bottom to the Buildings widget and only grows up over Diplomacy as much as it needs, instead of jumping straight up and leaving a gap underneath. The form was also tightened so it needs less height." },
    ],
  },
  {
    version: "0.9.560",
    date: "2026-05-23",
    items: [
      { type: "improvement", text: "**Age fields in Add General no longer show up/down spinner arrows** — just type the number (the 🎲 button still rolls a random age)." },
    ],
  },
  {
    version: "0.9.559",
    date: "2026-05-23",
    items: [
      { type: "change", text: "**Add General now goes through Save and is fully revertable.** Adding a general no longer writes to disk immediately — it's staged like every other dev edit: it shows up in the Characters panel as a green 'Pending — Save to apply' entry, counts toward the Changes/Save badge, and writes to descr_strat + names.txt only when you click Save. You can revert it from the Changes review (or Discard all) before it's written." },
    ],
  },
  {
    version: "0.9.558",
    date: "2026-05-23",
    items: [
      { type: "improvement", text: "**New dev-pill animation.** Replaced the slow genie emerge/retract with a clean, quick fade + slide (Pill in / Pill out) so toggling dev mode feels snappy and modern." },
      { type: "change", text: "**Diplomacy & Treasury widget is smaller by default**, and the Characters widget is correspondingly taller — more room for the character roster in the normal layout." },
    ],
  },
  {
    version: "0.9.557",
    date: "2026-05-23",
    items: [
      { type: "change", text: "**The 'watch for updates' poll is now every 5 seconds** (was 20s) so a freshly-published release is picked up almost immediately after you double-click the version label." },
    ],
  },
  {
    version: "0.9.556",
    date: "2026-05-23",
    items: [
      { type: "improvement", text: "**Add General now expands the Characters panel up over Diplomacy & Treasury** (with an opaque background) so the whole family-builder form is visible at once. Closing it restores the normal layout." },
      { type: "improvement", text: "**The dev pill appears and disappears snappily.** Its genie-style emerge/retract animation was slow (540ms); it's now 240ms so dev mode toggles feel instant." },
      { type: "change", text: "**'Update imminent' instead of an error.** When you check for updates and the new release is still uploading (a 404 on latest.yml), you now get a friendly 'Update imminent — a new release is still uploading' info toast rather than a scary error." },
    ],
  },
  {
    version: "0.9.555",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Double-click the version label to keep watching for updates.** It then checks every 20 seconds in the background (showing a '👀 watching…' marker) until an update appears — handy right after a new build is published. It stops automatically once one is found, or double-click again to cancel. A single click still does a one-off check." },
      { type: "fix", text: "**The bottom strip (Search / Factions / Selected Provinces) is now tied to the map width**, like the map itself. On wide/4K screens 'Selected Provinces' used to overshoot to the right past the map; it now scales with the map so the whole left column lines up." },
      { type: "fix", text: "**Add General no longer covers the Diplomacy panel.** The form now expands downward (over the Buildings panel) instead of upward over Diplomacy, and the panel is fully opaque while open so nothing shows through." },
      { type: "improvement", text: "**Add General is more compact** — Faction + Bodyguard sit on one row and Place-at + coordinates on the next (two rows instead of four)." },
    ],
  },
  {
    version: "0.9.554",
    date: "2026-05-23",
    items: [
      { type: "fix", text: "**No more gap between the map and the right-side panels at 4K / fullscreen.** On wide screens the map is limited by height, so it didn't reach the column where the region widgets were pinned, leaving an empty vertical strip. The region widgets (info, diplomacy, characters, buildings, recruitment, etc.) now anchor to the map's actual right edge and stretch to fill the remaining width, so the whole space is used at any resolution. Dragging/resizing them still tracks the cursor." },
      { type: "improvement", text: "**Add General — family picker now shows full regnal names.** 'Join existing' previously listed several identical 'Attalos' entries; it now reads the same as the in-game family tree (Attalos II, Attalos III, …), matching the engine's suffix-letter → numeral convention." },
      { type: "improvement", text: "**Add General — more options.** The bodyguard/general unit is now a dropdown (when a faction has more than one option); the wife can be marked as dead; a warning lists any pre-existing duplicate names in the chosen faction (these can cause engine issues). The Faction and 'Place at' dropdowns are now the same width, and the unit text is readable. Roman factions correctly offer surnames again." },
      { type: "improvement", text: "**Add General — the Characters panel expands over the Diplomacy panel while the form is open**, so you can see more of the builder at once; it returns to normal when you close the form." },
      { type: "fix", text: "**The 'Update check failed' message is now a small toast** instead of a giant stack-trace box. A missing release (404 / latest.yml) reads 'no published release found yet', and any toast body is clamped and scrolls instead of growing without bound." },
    ],
  },
  {
    version: "0.9.553",
    date: "2026-05-23",
    items: [
      { type: "fix", text: "**Add General: 'Join existing family' now works for every culture, and lets you pick the parents.** It previously showed no families for single-name cultures (Seleucid, all Hellenistic/Eastern factions) because it only looked for Roman-style surnames — now families are built from the actual relative-line households, so e.g. Seleucid shows 33. 'Join existing' is now a Father picker (showing each father + his wife/mother); the new general is added as that couple's child and inherits the family surname (Roman) or stays single-named (Greek/Eastern). 'New line' only asks for a surname in surname cultures." },
    ],
  },
  {
    version: "0.9.552",
    date: "2026-05-23",
    items: [
      { type: "change", text: "**Add General is now embedded in the Characters widget** (not a floating window). Clicking '+ Add General' swaps the roster for the family-builder form (with a '← back' to return); the Characters widget was enlarged to hold it. Buildings stays 5×4 at the bottom." },
    ],
  },
  {
    version: "0.9.551",
    date: "2026-05-23",
    items: [
      { type: "fix", text: "**Character traits & ancillaries: every character now shows its FULL list.** The save parser was dropping the last trait and the first ancillary of every character (verified 890/890 last-slots are real traits; chars-with-ancillaries jumped 65→256 once the first was no longer skipped). Both off-by-ones are fixed, so the character panel and family tree now show complete trait/retinue data." },
      { type: "improvement", text: "**Add General is now a draggable, non-blocking panel.** Moved into the Characters widget, it floats over the map (drag by its title bar) instead of a full-screen overlay, so the map stays interactive and it no longer renders behind other panels. Added: 🎲 Random at the top of every name list, 🎲 random age (16–82), and the 'Place at' dropdown now lists the faction's actual owned settlements (resolved to exact tiles via the map's settlement pixels). Surname field is labelled and always populated. Files are still backed up before any write, and everything logs under [addgen]." },
      { type: "change", text: "**Region layout: more room for diplomacy.** The Diplomacy & Treasury widget grew (it now holds named live war/ally lists + the wealth sparkline); the Buildings widget shrank to just fit its 5×4 grid and moved down to free the space." },
    ],
  },
  {
    version: "0.9.550",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Add General to a settlement (dev mode).** A new '+ Add General' button on the Diplomacy & Treasury widget opens a family-builder: set the general's age + name (from the faction's culture-correct name list), choose a new family line or join an existing family, optionally add a wife and any number of sons/daughters — each with their own name (from the list) and age. It writes a proper named general + family into descr_strat for NEW campaigns, placing them at the chosen settlement's exact tile (verified against the map's settlement pixels — no coordinate guesswork). Names are resolved to UNIQUE tokens the RTW way (e.g. a second 'Gaius' becomes GaiusB), minting new entries into names.txt + descr_names_lookup.txt when needed, and never creating in-faction duplicates. All three files are backed up (.bak) before writing. Start a new campaign to see the general." },
    ],
  },
  {
    version: "0.9.549",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Wealth-trend sparkline in the Diplomacy & Treasury widget.** The save turned out to store a per-faction treasury-over-time history (an end-of-turn treasury checkpoint recorded each turn), so the widget now draws a little sparkline of the selected faction's wealth trajectory across the campaign (green if up overall, orange if down) — hover for the exact per-turn figures. Works for every faction with a save record, in both live and calibrated modes. (Note: a full income/expense *breakdown* can't be shown — the game recomputes that live each turn and never stores it; only the treasury checkpoint timeline is persisted.)" },
    ],
  },
  {
    version: "0.9.548",
    date: "2026-05-22",
    items: [
      { type: "feature", text: "**Dev mode: right-click the Diplomacy widget to inspect the raw attitude-matrix numbers.** Opens a view listing, for the selected faction, every faction it has a non-neutral relationship with — showing the raw numbers in BOTH directions (e.g. Rome → Carthage and Carthage → Rome): core_attitudes value + named tier (Allied/Neutral/Hostile/At War/Total War/Crazy, per the descr_strat legend), the bond class (6 normal / 54 protectorate-ally / 55 special), and faction_aggression. Includes the matrix base/stride/symmetry header for crack verification. Dev-mode only; no change for normal users." },
    ],
  },
  {
    version: "0.9.547",
    date: "2026-05-22",
    items: [
      { type: "fix", text: "**Turn number and year now read correctly for all mods, not just RIS.** The turn/year were read from a hardcoded file offset (0x44e3) that only happens to be correct for RIS-imperial saves — its real position shifts by the length of the save's mod path. Vanilla and other-mod saves were reading the wrong bytes and showing \"T1 · 1 AD\" regardless of the actual turn. They're now located via the descr_strat path anchor (turn at +5, year at +9), validated across 29 saves spanning RIS and vanilla. RIS saves are unaffected (same result as before); vanilla Spain Turn 4 now correctly reads T4 · 269 BC instead of T1 · 1 AD." },
    ],
  },
  {
    version: "0.9.546",
    date: "2026-05-22",
    items: [
      { type: "feature", text: "**Live, NAMED diplomacy for every faction — who's at war / allied with whom.** Cracked the save's N×N faction-relationship attitude matrix (the real diplomacy store; the per-faction \"zones\" only held agreement handles with no partner identity). The matrix's POSITION encodes the faction pair, so partner identity is finally recoverable — and it carries the full descr_strat stance scale (allied / neutral / hostile / at-war). Click any faction's settlement and the Diplomacy & Treasury widget now lists, BY NAME, everyone they are currently ⚔ at war with, 🤝 allied with, and ⚠ hostile toward — live, updating as the campaign plays out (falls back to campaign-start diplomacy when no save is synced). The decoder self-locates and self-calibrates per save (validated across RIS turns 0/1/4 and vanilla, 100% matrix symmetry, turn-0 wars/allies matching the mod files exactly)." },
      { type: "fix", text: "**War state is now read from the save (it was there all along).** Earlier conclusions that \"war isn't in the save\" were wrong — they only applied to the diplomacy zones. The attitude matrix holds it: `attitude ≥ 600` = at war, `0` = allied. This is what makes the live named diplomacy above possible." },
    ],
  },
  {
    version: "0.9.544",
    date: "2026-05-22",
    items: [
      { type: "fix", text: "**Diplomacy now shows accurate named relations instead of wrong live counts.** The live per-faction diplomacy zones turned out to encode their class enum inconsistently between the player's own zone and NPC zones (e.g. a faction's protectorates read as class 0 in an NPC zone but class 4 in the player's), so the counts were misread — Rome displayed \"18 at war\" at turn 0 when in-game it only has its 6 protectorates. And the save never stores WHO each live relation is with, so the counts could never be a named list. Dropped the unreliable live counts; the widget now shows only the verified, NAMED campaign-start diplomacy (allies / wars / protects / protectorate-of) from descr_strat + the campaign script. Factions that begin neutral now say so explicitly." },
    ],
  },
  {
    version: "0.9.543",
    date: "2026-05-22",
    items: [
      { type: "feature", text: "**Starting protectorates now shown (Rome's were missing).** descr_strat declares alliances/wars but NOT protectorates — those are set by the campaign script (`console_command become_protector <protector> <protectorate>`), which the relations parser ignored. So Rome (which starts with 6 Italian protectorates — Volsinii, Capua, Samnites, Lucanians, Bruttians, Taras) showed no campaign-start diplomacy at all. The bundler now also parses the campaign script's `become_protector` and `diplomatic_stance` commands and merges them in. The Diplomacy & Treasury widget shows new lines: 🛡 protects: … (this faction's protectorates) and 🛡 protectorate of: … (its protector). Covers every faction with scripted starting diplomacy (Carthage→Gades, Antigonid→Argos/Megalopolis, Seleucid→4, Ptolemaic→Tyre/Sidon, etc.)." },
    ],
  },
  {
    version: "0.9.542",
    date: "2026-05-22",
    items: [
      { type: "fix", text: "**Faction diplomacy/treasury now survive app restarts (one sync is enough).** The live all-faction diplomacy, treasury records, and record-owner mapping were React state only — lost on restart. So relaunching into non-live mode dropped every faction's live diplomacy (the `[diplo-widget]` log showed `allFactionDiplomacyKeys=0`), and factions with no descr_strat starting relations — romans_julii, carthage, the senate — showed nothing at all. These are now persisted to localStorage and rehydrated on launch, so after one sync (live snapshot or 🎯 Calibrate) every faction's diplomacy + treasury stays populated across restarts. Values are last-synced snapshots; the next sync refreshes them." },
    ],
  },
  {
    version: "0.9.541",
    date: "2026-05-22",
    items: [
      { type: "improvement", text: "Added a `[diplo-widget]` diagnostic log that records how the Diplomacy & Treasury widget resolved each selected region's owner (owner id, whether a live diplomacy zone matched, key count). Helps pin down \"diplomacy doesn't load for faction X\" reports — click the affected settlement and the log shows whether it's an owner-resolution miss or a missing zone." },
    ],
  },
  {
    version: "0.9.540",
    date: "2026-05-22",
    items: [
      { type: "fix", text: "**Diplomacy relation count now excludes neutral padding.** Your own faction's diplomacy zone lists EVERY discovered faction — most as a neutral 'known' entry (class 5, attitude 5) — so the Seleucid widget showed \"115 relations\" while only 34 were actual wars/alliances/ceasefires. The count now reflects only meaningful relations (war/ally/ceasefire/locked), so it matches the chips shown (e.g. Seleucid: 34, not 115). NPC factions only ever list active relations, so their counts are unchanged." },
    ],
  },
  {
    version: "0.9.539",
    date: "2026-05-22",
    items: [
      { type: "feature", text: "**Live diplomacy now shows for EVERY faction** — including your own, the senate, carthage, romans_julii, and all minor factions, not just the 23 major NPC records. Cracked the per-faction diplomacy zones: the save holds ~221 diplomacy blocks (one per active faction), and the owning faction is identified by the byte 53 bytes before each `0x39240005` marker (index into descr_sm_factions order). Validated across Seleucid + Macedon saves — 220 distinct factions resolve, zero duplicates. Click any settlement and its owner's live war/ally/ceasefire/locked counts appear. (Partners still can't be named — that's genuinely not stored in the save — so it remains counts, with the descr_strat campaign-start named relations shown beneath.)" },
    ],
  },
  {
    version: "0.9.538",
    date: "2026-05-22",
    items: [
      { type: "fix", text: "**Diplomacy shows for many more factions.** The starting-relations data is parsed from descr_strat, which usually declares a pair from only ONE side (e.g. \"antigonid, 201 epirus\" is filed under antigonid, not epirus). The widget was therefore blank for any faction that only ever appeared as the *target* of a declaration. Relationships are symmetric, so each pair is now stored on BOTH factions — every faction party to any declared alliance/war now shows its relations when you click its settlement. (A handful of factions — e.g. romans_julii, carthage — start fully neutral with no declared relations and aren't among the save's 23 NPC records, so they still show nothing; full live diplomacy for every minor faction needs a deeper save-crack of the per-faction diplomacy zones.)" },
    ],
  },
  {
    version: "0.9.537",
    date: "2026-05-22",
    items: [
      { type: "fix", text: "**Diplomacy widget: clearer message for your own faction.** The save's live diplomacy table only covers the ~23 NPC major factions — your OWN faction is always excluded from it (confirmed: in a Seleucid game the 23 records contain antigonid/ptolemaic/romans_julii… but not seleucid; in a Macedon game antigonid is the one missing). So viewing your own region showed a bare \"Diplomacy not tracked (no save record)\" even though campaign-start relations were available right below. Now it explains \"Live diplomacy isn't stored for your own faction in the save — showing campaign-start relations:\" and leads straight into the named started-allied/at-war list (e.g. Seleucid → allied: Pergamon, Cappadocia, Bactria, Antigonid; war: Bithynia)." },
      { type: "fix", text: "**Garrison commander faction mislabel fixed.** A garrison bodyguard card could show the wrong faction when the character's name also exists in another faction — the stats-cache fell back to a faction-agnostic key whose stored faction belonged to the same-named character elsewhere (a Seleucid \"Demophanes\" was shown as \"ptolemaic\"). For cross-culture collisions this also pulled the wrong portrait pool. The live garrison unit's own faction is now authoritative." },
    ],
  },
  {
    version: "0.9.536",
    date: "2026-05-22",
    items: [
      { type: "feature", text: "**Named starting diplomacy in the Diplomacy & Treasury widget**. The widget now lists, by name, who each faction *began the campaign* allied with and at war with (e.g. \"At campaign start — allied: Seleucid, Knossos\"). Parsed from descr_strat's `faction_relationships` declarations. This is the only source that names the partner faction: a deep dive (two cross-validating analyses) confirmed the live save stores each relation's class (war/ally/ceasefire) but NOT which faction it's with — the partner simply isn't persisted, so a live who's-at-war-with-whom matrix is impossible from the save. Live relation *counts* are still shown above the named starting list. (Starting state won't reflect mid-campaign diplomacy changes.)" },
    ],
  },
  {
    version: "0.9.535",
    date: "2026-05-22",
    items: [
      { type: "feature", text: "**Hover-to-inspect tile tooltip**. Hovering the map now shows a small cursor-following readout of the tile's region, owning faction, and terrain type. Toggle with the new **Inspect** button in the map controls (on by default, persists). Terrain reads from the corrected geography ground-types data — open Geography mode once (or just leave Inspect on) and the ground-types load so terrain appears in any map mode. The tooltip only updates when the hovered tile actually changes, so it doesn't churn on every pixel of movement." },
    ],
  },
  {
    version: "0.9.534",
    date: "2026-05-22",
    items: [
      { type: "fix", text: "**Diplomacy & Treasury widget now works for every region after one sync**. The live treasury records only exist for the ~23 major NPC factions, so panning to your own provinces (or a minor/rebel faction's) made the widget go blank. It now falls back to the descr_strat starting treasury for any faction without a live record — so every region shows its owner's treasury (live ·tag for the 23 majors, '(starting)' for the player and minor factions). Diplomacy still only shows for factions with a save record (player/minor diplomacy isn't in those records). The player's *live* treasury needs a separate record crack (still pending) — until then player provinces show starting wealth." },
    ],
  },
  {
    version: "0.9.533",
    date: "2026-05-22",
    items: [
      { type: "feature", text: "**New Diplomacy & Treasury widget in the region panel**. Shows the selected region's owning faction: current treasury (with this-turn net on hover), AI personality archetype, and a diplomacy summary (counts of wars / alliances / locked alliances / ceasefires). Per-pair detail isn't shown because the relation records don't store the *other* faction's identity (still uncracked) — counts only for now. Populated from Live mode or 🎯 Calibrate." },
      { type: "improvement", text: "**Region panel layout reflow**. Buildings now use a fixed 5×4 = 20-slot grid (a region's max) with evenly-sized larger cards, instead of the old width-dependent grid that reflowed into 6+ narrow columns. Region info is trimmed shorter, the Characters list sits below it and scrolls past ~10 entries, and the freed space holds the new Diplomacy & Treasury widget. Layout migrates automatically on launch (LAYOUT_VERSION 11) — your widgets reset to the new canonical positions; drag/resize as you like." },
    ],
  },
  {
    version: "0.9.532",
    date: "2026-05-22",
    items: [
      { type: "feature", text: "**Faction treasury + AI personality now load in non-live mode**. Previously the Wealth panel's live treasuries and AI archetypes only appeared when the save-watcher was active (Live mode). The 🎯 Calibrate button parsed characters/portraits but skipped faction records, so calibrating a save without RTW running left the panel on descr_strat starting values. Calibrate now also parses the 23 major-faction records — treasuries, faction identities (via the cracked faction_id), AI personalities, and diplomacy — and feeds them to the Wealth panel exactly as Live mode does. Pick a save with 🎯 Calibrate and the panel shows live treasuries (·live tags) + AI subtitles." },
    ],
  },
  {
    version: "0.9.531",
    date: "2026-05-22",
    items: [
      { type: "improvement", text: "**Bigger building icons in the region panel**. Each building card is a fixed-height cell with the icon on top and the name below. The label was 0.7rem and allowed up to 4 lines, which ate most of the card height and left the icon cramped. Shrunk the label to 0.58rem and capped it at 2 lines, handing that vertical space back to the icon — building icons are now noticeably larger. Long names truncate with an ellipsis (full name still shows on hover / right-click info)." },
    ],
  },
  {
    version: "0.9.530",
    date: "2026-05-22",
    items: [
      { type: "fix", text: "**Geography mode: desert + oasis labels corrected (no more 'swamps' in the Sahara)**. Two more mislabels found by directly sampling the map: `0,0,0` (previously \"Grassland\") is actually the desert sand — it's 89% of the deep Sahara and absent from northern Europe — now labeled Desert. And `0,255,128` (previously \"Swamp\") is only ~1% of the deep desert (scattered oasis/depression tiles) plus river-delta clusters — it's a wet-lowland/oasis type, not a swamp, which is why teal 'swamps' were dotting the open desert. Relabeled to Oasis / marsh. Also softened the remaining flat-tier names (Steppe/pasture, Semi-arid scrub, Light woodland, Rocky highland/desert). Mountains/hills stay elevation-verified and correct." },
    ],
  },
  {
    version: "0.9.529",
    date: "2026-05-22",
    items: [
      { type: "fix", text: "**Geography mode: swamp colour toned down**. Swamp was rendered bright purple, which looked jarring against the corrected earth-toned terrain (and stood out more now that neighbouring flat terrain is no longer mis-painted as red mountains). Changed to a natural murky teal-green. Swamp tile *locations* are unchanged and correct (low coastal/delta areas, elevation ~2/255)." },
    ],
  },
  {
    version: "0.9.528",
    date: "2026-05-22",
    items: [
      { type: "fix", text: "**Geography map mode: fixed mislabeled terrain (mountains in Denmark)**. The ground-type colour palette had the wrong names — `0,128,128` was tagged \"Mountain\" and painted red, but cross-referencing every one of the 14 map_ground_types.tga colours against map_heights.tga proved it's actually one of the FLATTEST terrains (avg elevation 3/255). That flat terrain is common across northern Europe, which is why bright-red \"mountains\" showed up in flat Denmark. The real elevation tiers are the red-channel ramp `64,0,0` → `128,0,0` → `196,0,0` (avg height 70 → 78 → 84). Re-derived the whole palette against RTW's authoritative 14 aerial ground types (descr_aerial_map_ground_types.txt): high mountains / mountains / hills are now correct and elevation-verified; farmland, forest, and swamp tiers relabeled accordingly. Map regions (1020×700) and ground-types (2041×1401) share the same aspect ratio, so there was no alignment skew — it was purely the colour labels." },
    ],
  },
  {
    version: "0.9.527",
    date: "2026-05-22",
    items: [
      { type: "fix", text: "**Faction treasury attribution fixed via cracked faction_id** — the major-faction records were previously matched to factions by the captain-banner heuristic, which only identified ~10 of 23 records (factions with no captain units got no treasury, and a few got the WRONG one from a bleed-over banner). The save's `faction_id` byte (cracked session 174) is an exact index into descr_sm_factions.txt declaration order, so every record is now identified directly. All 23/23 resolve, and the 3 records the banner heuristic mislabeled are corrected — e.g. record 0 is the Rebels faction (30 regions, ai_rome), not 'carthage'; the Iberian 'astures' tribe is no longer mislabeled 'athens'. The captain banner stays as a fallback for saves where faction_id is unavailable." },
      { type: "feature", text: "**AI personality archetype shown per faction** — the cracked `aiPersonalityIndex` byte indexes feral_descr_ai_personality.txt, so each NPC faction's AI behaviour profile (ai_lusitani, ai_carthage, ai_bactria, …) is now decoded from the save and displayed as a subtitle under each faction in the Faction Wealth panel. Confirms factions behave with culturally-appropriate AI (Iberian astures → ai_lusitani, etc)." },
    ],
  },
  {
    version: "0.9.526",
    date: "2026-05-21",
    items: [
      { type: "improvement", text: "**Coord→portrait bridge now persists across restarts** — `v1PortraitsByCoord` (the precise tile-keyed portrait map) is now saved to localStorage and rehydrated on launch, like the stats cache. Previously only the name-keyed fallback survived a restart, so a cold launch degraded same-name character disambiguation to the name key until the next save sync. Now the precise coord lookup is available immediately on startup." },
      { type: "fix", text: "**Stopped live-mode log spam** — the `[bodyguard-swap garr/field] descr_strat fallback hit` line was unguarded and re-logged on every render for every unit in a stack. A multi-unit garrison led by a descr_strat-fallback commander (e.g. Zamir's 30-unit Minaean garrison) spammed the same line 30+ times per frame, bloating provincia.log. Now throttled to once per commander name, matching the sibling logs." },
    ],
  },
  {
    version: "0.9.525",
    date: "2026-05-21",
    items: [
      { type: "improvement", text: "**Family tree linked to the unit cards' portrait source** — the family tree now resolves portraits from the same persisted `statsCache` the bodyguard/unit cards use, keyed by the identical `name|lastName|faction`. Two consequences: (1) the family-tree card and the bodyguard card for a given character can no longer disagree — they read the same entry by the same key; (2) because `statsCache` is persisted to localStorage and rehydrated on startup, the family tree shows correct portraits immediately on launch with NO recalibration required. Previously the family tree relied solely on `v1PortraitsByCoord`, which is plain React state reset to null every launch — that's why it needed a recalibrate each session while unit cards (reading the persisted cache) did not. The coord bridge stays the precise primary lookup (disambiguates same-name chars by tile); the name-keyed cache is the persisted fallback used when the coord bridge has no hit." },
    ],
  },
  {
    version: "0.9.524",
    date: "2026-05-21",
    items: [
      { type: "fix", text: "**Filter false-positive character records** — the parser was admitting ~8 phantom \"characters\" per save (Appuleius_Saturninus, ArsinoeC, Banat, several Aarons) that aren't in descr_strat and aren't runtime-spawned. They were byte sequences in unrelated zones (relationship/name-pool tables) that happened to satisfy the firstName/age/uuid gates. Added a post-children system-constants gate: real records have a 20-byte constant block at +66..+85 (LAYOUT_B) / +70..+89 (LAYOUT_A) — the end-of-children sentinel 0xFFFFFFFF and the RTW constant `2` four slots later. Requiring EITHER slot match filters all 8 false positives with ZERO false negatives (verified: 861/861 descr_strat-resident chars pass, and all 105 runtime-spawned non-descr_strat chars still pass since they live in the real character section). Macedon T0 RIS character count: 974 → 966." },
    ],
  },
  {
    version: "0.9.523",
    date: "2026-05-21",
    items: [
      { type: "fix", text: "**Family-tree portraits actually match the bodyguard cards now** — two bugs were stacking. (1) The Portrait component's `useEffect` had a `if (!url)` guard, so once it picked a hash-pool portrait on first render (which happens before the calibrate IPC has finished parsing the save), it never re-loaded when calibrate later supplied the correct save-derived path. Now the effect always reloads when charContext changes; loadPortrait's cache keeps it cheap and setUrl only fires on a different URL so no flicker. (2) The coord→portrait map was being seeded from `characterExtras` first using the cracker's `extX/extY` fields — but per the 354-byte-coord-record memo those values are scrambled (the real coord table lives at +8/+12 of a separate 354-byte record). The scrambled keys could collide with a real v1 tile and corrupt the portrait there. Inverted priority: v1's correct tileX/tileY entries seed the map first, then cracker fields enrich only matching coords. Symptom this fixes: Antigonos II, Demetrios III, Achaios, Attalos, and every other antigonid char in the family tree was rendering via hash-pool (visible in provincia.log as `savePath=\"(hash)\"` for every entry); now their family-tree portrait matches their bodyguard card." },
    ],
  },
  {
    version: "0.9.522",
    date: "2026-05-21",
    items: [
      { type: "fix", text: "**Trait threshold lookup uses points, not level** — 0.9.521's introduction of resolved display levels also turned the threshold-walk loop in `parseCharactersAndUnits` into dead code (it was comparing trait-point thresholds like 25/75/150 against the now-resolved display level 1/2/3, so no threshold ever matched). The indexed fallback was producing the correct result anyway, but for clarity and forward-safety the threshold loop now compares against `t.points` (the raw byte value) with a fallback to `t.level` for back-compat." },
    ],
  },
  {
    version: "0.9.521",
    date: "2026-05-21",
    items: [
      { type: "improvement", text: "**Trait display levels now resolved via threshold lookup** — the u16 at trait+4 in the save is _accumulated trait points_, not the displayed level. Previously Provincia showed the raw point value (\"Estates 26\" instead of \"Estates 2\") because the parser used `points` as-is. main.js's `parseCharactersAndUnits` now walks each parsed trait, looks up the appropriate level threshold from `export_descr_character_traits.txt`, and writes the engine's displayed level (1, 2, 3…) back to `t.level`. Raw points stay accessible as `t.points` for stat-summing." },
      { type: "improvement", text: "**Build queue shows remaining turns** — `queueParser.js` now emits `turnsTotal`, `turnsElapsed`, and `turnsRemaining` for every BUILDING queue entry (cracked from save bytes: total at +16, elapsed at +20). RegionInfo renders \"N turns left\" using the difference, so the in-progress label matches the in-game tooltip exactly. Verified turn-to-turn across consecutive Arretium saves." },
      { type: "improvement", text: "**Faction AI personality + faction_id parsed from save** — `parseFactionTreasuries` now returns `factionId` (u8 at midblock+99 = index into descr_sm_factions.txt) and `aiPersonalityIndex` (u8 at midblock+135 = index into feral_descr_ai_personality.txt) for each of the 23 major faction records. 23/23 validated against descr_strat. Replaces the captain-banner heuristic for faction identification, fixing the 13 records that have zero captain banners." },
      { type: "improvement", text: "**Save-cracker session 174: bulk character-record refinements** — the 172-byte zone at +126..+297 of each character record is now identified as a 43-slot s32 array (likely RTW engine 'Effect' counters); the previously-unknown u16 at +88..+89 is a 4-value enum (likely portrait pool category: family/leader=1, mid=2, generic=3, foreign=0); soldier weapon byte corrected to +7 of the stride-9 record (was incorrectly at +0); Lua counter zone u32 count prefix discovered at firstRecord-4. Birth year and max-MP confirmed NOT stored — both derived from age+turn and EDU+traits respectively. Full byte map updated in cracker docs." },
    ],
  },
  {
    version: "0.9.520",
    date: "2026-05-21",
    items: [
      { type: "fix", text: "**Removed leader_pic_<faction>.tga override** (added in 0.9.517). `leader_pic_<faction>.tga` files are used by RTW's faction-selection menu, NOT for in-game character portraits. The engine renders faction leaders from the regular portrait pool (`greek/old/generals/NNN.tga`) just like every other char — user-labeled in-game portraits confirmed AntigonosII Gonatas shows pool portrait 000, not the leader_pic file. The override was making Provincia's family tree and bodyguard cards diverge from the game for every faction leader. Cleaned up the corresponding `isLeader` field on FamilyTree's charContext (no longer needed)." },
    ],
  },
  {
    version: "0.9.519",
    date: "2026-05-21",
    items: [
      { type: "fix", text: "**Faction leaders' portraits now show their actual face**. The 0.9.512 filter that treated `cards/<bucket>/generals/000.tga` as a 'generic placeholder' was based on a wrong assumption — portrait 000 is actually a REAL specific portrait file (used in-game for the antigonid leader's bald-with-gray-beard face). User-labeled in-game portraits confirmed this: AntigonosII Gonatas shows NNN 000 in the family tree. v1's portrait scan already correctly extracts each character's engine-assigned NNN from the save record; my filter was incorrectly rejecting the valid result and falling back to a hash-pool guess. Filter relaxed to only reject `/dead/` paths on alive characters (kept for disambiguating stub-record duplicates). All three call sites in main.js (calibrate, save-watch v1PortraitsByCoord build, ipc trait-bridge) updated." },
    ],
  },
  {
    version: "0.9.518",
    date: "2026-05-21",
    items: [
      { type: "improvement", text: "**descr_strat resource split into trade / slave / ambience** — the parser now tracks the `;;;; SLAVE RESOURCES ;;;;` and `;;;; AMBIENCE ;;;;` section headers as it walks the strat file and stamps every `resource <name>, x, y` line with a `category: \"trade\" | \"slave\" | \"ambience\"` tag. RegionInfo now renders three separate chip rows (Trade resources / Slave resources / Ambience resources) instead of one mixed list, so cosmetic icons like wine_amph or chickens stop looking like economic trade goods. Faction summary, wealth, and income heatmaps are now restricted to the `trade` subset only — slave/ambience entries no longer skew per-region trade value. Dev-mode `Add resource` infers the category from the resource name (falling back to trade) so newly-placed entries land in the right block, and `patchDescrStrat` rewrites the file as three labeled blocks with the original `;;;; … ;;;;` headers preserved. Bundled `public/resources_large.json` for RIS now contains 4326 trade + 1311 slave + ambience entries (was a flat ~5.6k mixed list)." },
    ],
  },
  {
    version: "0.9.517",
    date: "2026-05-20",
    items: [
      { type: "fix", text: "**Faction leaders use `leader_pic_<faction>.tga`** — the engine substitutes a dedicated leader portrait for each faction's current leader, overriding the generic placeholder in the save. AntigonosII Gonatas (Antigonid leader) was correctly bald+gray-beard in-game but Provincia was showing a hash-derived portrait. The `resolve-portrait` IPC now checks `charContext.isLeader` first and, when the faction has a `data/world/maps/campaign/imperial_campaign/leader_pic_<faction>.tga` file, uses it directly. FamilyTree threads `isLeader` through `charContext` (detected from v1's Factionleader trait, descr_strat `role=leader`, or explicit `Factionleader` trait in mod data). Per-character portrait assignment for non-leader named chars (likely positional, per user's hypothesis) tracked as next-step crack." },
    ],
  },
  {
    version: "0.9.516",
    date: "2026-05-20",
    items: [
      { type: "fix", text: "**Family tree vs bodyguard card portrait mismatch (calibrate mode)**. Users reported Demetrios III and Seleucid Achaios showing portrait 032/140 on their bodyguard unit card but a different (hash-pool) portrait in the family tree. Root cause: the `v1PortraitsByCoord` bridge (added 0.9.513) was only built in the live save-watch handler, not in the calibrate-from-save IPC. Users in calibrate mode (most users) got the bridge for unit cards via the stats cache but the family tree had no coord → portrait map, so it fell back to hash. Calibrate now builds and returns `v1PortraitsByCoord` in its IPC response; App.js stores it; FamilyTree reads it. Verify in provincia.log: `[calibrate] v1PortraitsByCoord: NN coord entries` should appear after each calibration." },
    ],
  },
  {
    version: "0.9.515",
    date: "2026-05-20",
    items: [
      { type: "feature", text: "**Admirals now parsed (97.2% → 99.5% descr_strat match)**. RTW admirals have `traitCount=0` so v1's trait-list anchor couldn't validate them — they were the entire 23-char unmatched gap in 0.9.514. New `buildSecUuidIndex(buf)` walks the 354-byte coord/state record table once to extract every valid bodyguard uuid in the save (with `low16(+16) == 0x7fff` mid-tile marker that matches both land and naval records — naval has the high bit set at +18). `tryParseAt` now accepts tc=0 records ONLY when their `secondaryUuid` is in that set — eliminates 2000+ false positives that a naive tc=0 scan would produce. Verified against descr_strat: 820/825 chars matched, including all 46 admirals' position records. The remaining 4 unmatched chars (Azes, Skunkha, and one each of 9 Aripharnes/Abaikos sub-faction copies) appear to be missing from v1's reachable structural region — likely engine-internal state that's not anchored on a trait list, fleet, or coord record." },
    ],
  },
  {
    version: "0.9.514",
    date: "2026-05-20",
    items: [
      { type: "improvement", text: "**Character parser hardening** — eliminated 352 false-positive 'Aaron' records (28% of v1 output was junk from zero-byte regions). Two new validity gates in `characterParser.js` tryParseAt: (1) reject if both primaryUuid and secondaryUuid are zero or below the uuid-shaped threshold (>0xffff); (2) reject if all 8 head bytes are zero. Verified against descr_strat (`scripts/save-cracker/dig-descr-strat-audit.js`) — 0 real characters rejected, 352 fake Aarons removed. Match rate vs descr_strat now 97.2% (802/825 real characters)." },
      { type: "feature", text: "**spouseUuid cracked + surfaced** — each parsed character now exposes a `spouseUuid` field (null if unmarried). Located at +46 (LAYOUT_B) / +50 (LAYOUT_A) between fatherUuid and childUuids[0]. Confirmed via three independent lines of evidence: 14 dynasty matches where slot46 = primaryUuid of a daughter held in another char's childUuids; 603 of 610 'miss' cases correlate with explicit `relative HUSBAND, WIFE, ..., end` lines in descr_strat (wives are stub records v1's trait-anchor skips); counter-evidence search found only 3 chars without descr_strat marriages — all 3 are Lua-spawned at runtime. LAYOUT_A's +46 = fatherUuid (verified via sibling pairs: Marcus & Servius Ogulnius_Gallus share +46 pointing to father Quintus). Family-tree UI can now wire husband ↔ wife edges directly from the parser data." },
      { type: "improvement", text: "**descr_strat sub_faction marker filter** — RIS uses `character, sub_faction parni, named character, age 30, , x 449, y 362` lines as TERRITORIAL OWNERSHIP markers, not real characters. Both `scripts/bundle-mod-data.js` and the family-tree parser now skip `/^sub[_ ]faction\\b/i` lines. Without the filter, 83 phantom 'sub faction' characters polluted the bundled armies and family tree." },
    ],
  },
  {
    version: "0.9.513",
    date: "2026-05-20",
    items: [
      { type: "fix", text: "**Family tree portraits use v1 (correct) instead of cracker (scrambled)** — fixes the case where the bodyguard unit card and the family tree showed different portraits for the same character. The cracker's `attachMapCoords` reads `extX/extY` at +288/+292 of the extended record, but those bytes are NOT tile coords — `scripts/diag-portraits.js` confirmed against save_macedon t0.sav that the cracker assigns portraits to wrong characters (Halkyoneus at (394,374) was getting DemetriosC's portrait 032, etc.). Main process now builds a v1-derived `v1PortraitsByCoord` map and passes it to FamilyTree; v1's portrait overrides the cracker's for every coord. FamilyTree also seeds entries for coords the cracker missed entirely. v1 has portraits for 512 coord entries (vs cracker's 395), so coverage actually improves." },
    ],
  },
  {
    version: "0.9.512",
    date: "2026-05-20",
    items: [
      { type: "fix", text: "**Attalos picks the real portrait, not the dead stub** (validated against the calibration save via `scripts/diag-portraits.js`). v1 finds TWO records for Attalos: a stub at 0x15126d4 with portrait `dead/074.tga` and the real one at 0x1b78601 with `young/generals/137.tga`. Both have traits, neither has stats — the writeBest scoring tied and the first-encountered stub was winning. Cache builder now sets `chosenPortrait = null` when v1's only candidates are generic `000.tga` or `/dead/` on a live character (instead of falling back to the bad one). The stub then scores 3 vs the real's 4 (portrait +1), and the real wins. AntigonosB still has only generic 000 in the save itself (the save data is broken for him) — needs separate descr_strat `portrait_index` lookup, queued." },
    ],
  },
  {
    version: "0.9.511",
    date: "2026-05-20",
    items: [
      { type: "fix", text: "**Antigonos II / Attalos portraits — pick the good candidate from v1's array**. The 0.9.508–0.9.510 v2 bridge attempts all gave 0 hits (cxParseCharacterExtras returns no names, and v1/v2 'primaryUuid' fields are different binary offsets). v1's parser already returns multiple candidates in `c.portraits[]`; cache builder now SCANS that array for a non-generic, non-`/dead/`-on-living entry instead of blindly using `portraits[0]`. Antigonos II should get his face card instead of generic 000, Attalos the live portrait instead of dead/074." },
    ],
  },
  {
    version: "0.9.510",
    date: "2026-05-20",
    items: [
      { type: "fix", text: "**Portrait bridge actually wires up now (real fix)**. 0.9.509 keyed on `primaryUuid` but v1 reads that field at offset −47 and v2 reads at offset −12 — they're different binary fields, so the lookup still gave 0 hits (same as the v1-faction-tag pass shows: 0/1287 via uuid). Bridge now keys by `firstName + lastName + faction` (with name-only and no-lastName fallbacks) — the only reliable common identifier both parsers extract. Antigonos II / Attalos / similar generic-000 / dead-but-alive portraits should now pick up the family-tree-correct portrait." },
    ],
  },
  {
    version: "0.9.509",
    date: "2026-05-20",
    items: [
      { type: "fix", text: "**Bodyguard portrait bridge actually wires up now**. The 0.9.508 portrait bridge built its uuid map keyed on v2's `ownUuid`, but v1's character record uses `primaryUuid` — two different identifier fields at different offsets in the extended record. The lookup found 0 matches and `v2_coord=0` in every calibrate. Now keyed on `primaryUuid` so Antigonos II and Attalos can actually pick up v2's authoritative portrait when v1 returned a generic `000.tga` or a `/dead/` slot on a live general." },
    ],
  },
  {
    version: "0.9.508",
    date: "2026-05-20",
    items: [
      { type: "fix", text: "**Bodyguard unit cards no longer show generic / dead portraits** (incomplete — bridge keyed wrong field, see 0.9.509). v1's portrait scan was landing on a generic `cards/<bucket>/generals/000.tga` placeholder for some characters (Antigonos II got generic 000) and on a `/dead/` slot for live characters (Attalos got the dead portrait). Calibrate now uses v2's uuid-bridged portrait (same source the family tree uses) whenever v1's candidate is the generic 000 or a `/dead/` path on an alive character. Achaios's specific v1 portrait (`portraits/young/generals/140.tga`) is preserved." },
    ],
  },
  {
    version: "0.9.489",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "Cmd+K / Ctrl+K **search palette**. Fuzzy-search across regions, factions, characters, buildings, and units — instant jump. Up/Down navigate, Enter activates, Escape closes. Type badges color-code each result. Built as portaled overlay with the popover-in mount animation. New file `src/SearchPalette.js`. `[search-palette]` log lines." },
      { type: "feature", text: "**Diplomatic web overlay**. Optional toggle draws colored lines between every pair of faction capitals based on current diplomatic class — green=ally, red=war, gold-dashed=protectorate, teal-dashed=trade/vassal, thin gray=neutral (off by default). Pairs decoded via `factionDiplomacy` + `factionRecordOwners`. Gear popover toggles 'Selected faction only' and 'Show neutral'. Persists. `[diplo-overlay]` log lines." },
      { type: "feature", text: "**Four new heatmap map modes** (dev): Garrison, Happiness, Income, Public Order. Same shape as the existing population / wealth modes — gradient color-fill per region with min/mid/max legend bar. Garrison: navy → teal → gold. Happiness / public order: red → yellow → green. Income: slate → tan → gold. Falls back to a 'requires live save' note + neutral gray when no save is loaded. `[heatmap]` log lines." },
      { type: "feature", text: "**Building editor: strict settlement-tier level cap + drag-drop icon replace**. Upgrade buttons disable (not silently fail) when the candidate level's `settlement_min` exceeds the current settlement tier; add-picker shows '(needs <tier>)' hints instead of hiding entries; out-of-tier existing buildings get a red border + tooltip. Drag a PNG/JPG/TGA onto any building icon — copies (and decodes if needed) into the mod's `data/ui/<culture>/buildings/` folder, backs up the original to `_backup/`, invalidates the icon cache, and stages a 'Replaced icon for X' entry in the pending changes modal with a working per-item revert. New IPCs `replace-building-icon` / `revert-building-icon`. `[building-edit-cap]` + `[icon-replace]` log lines." },
      { type: "fix", text: "**Window position persistence across updates**. App now remembers its last position + size + maximized state in `userData/window-state.json`, debounced 500 ms during drag/resize, authoritative save on close. Restores on next launch — including across auto-updater reinstalls because userData survives the installer overwrite. Sanity-checks bounds so a corrupted file can't open the window at negative coordinates." },
    ],
  },
  {
    version: "0.9.487",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "Apple-baseline animation layer: every button now gets subtle SwiftUI-style press feedback (scale 1 → 0.96 → 1 in 140 ms, cubic-bezier(0.4, 0, 0.2, 1)) on click unless the user has explicitly assigned a different click animation in Layout mode. Per-button opt-out via `data-anim-no-press`. Five new entries in the animation library: `press`, `sheet-in`, `popover-in`, `toast-in`, `crossfade` — all available in the picker for assigning to specific elements. Hover-lift extended to `.map-mode-btn` to match the dev pill's tactile shadow." },
      { type: "improvement", text: "Animation library now includes Apple-feel entrance animations: `sheet-in` (iOS sheet rise + scale, used by modals), `popover-in` (macOS popover scale + fade), `toast-in` (slide from edge), `crossfade` (tab content swap). All restrained durations (140–280 ms) with Apple's standard decelerate curve cubic-bezier(0.32, 0.72, 0, 1)." },
    ],
  },
  {
    version: "0.9.486",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "New AOR (Areas of Recruitment) map mode. The Hidden Res. button is now tri-state: click once → Hidden Res., click again → AOR, third click exits back to faction view. AOR mode color-fills each region by its first `aor_*` tag (palette shared with cultures so the visual language matches). Regions with multiple AORs get diagonal stripes — same hi-res pattern as the cultures-mode multi-ethnicity stripes — and the stripe color cycles through every additional AOR, so a region with 3+ AORs shows all of them, not just the first two. Legend panel lists every AOR with its color swatch + region count (sorted most-used first). Hover tooltip shows full `aor_X` tag. Detection follows the `aor_` prefix (vanilla / Alex / RIS / Imperial convention) plus the rarer `_aor` suffix used by some mods. New `[aor]` log lines per palette build / stripe pass / legend render." },
    ],
  },
  {
    version: "0.9.485",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Bottleneck math added to the genie curve — the neck no longer goes razor-sharp at its narrowest point. Each vertex's target Y converges to `50 ± MIN_THICKNESS/2` instead of exactly 50, so the neck holds at ~16% of element height (~5 px) through the body of the animation. The minimum-thickness floor then tapers to 0 over the last 22% of the timeline, so the element still fully disappears by the end. Looks like a tube rather than a knife edge." },
      { type: "fix", text: "End-of-retract flash fixed. Root cause: `playAnimation`'s `animationend` handler removed the `data-anim-fire` attribute, which made the CSS selector unmatch, the keyframe styles drop, and the full pill flash for one frame before React's setTimeout unmounted it. Added `animation-fill-mode: forwards` to retract so the final keyframe styles stick, and a `keepFinalState: true` option on `playAnimation` that skips the attribute removal for unmount animations. Result: animation seamlessly hands off to React unmount with no flash." },
    ],
  },
  {
    version: "0.9.484",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Genie animations rewritten with proper math. The flashing was caused by a discontinuity at the seam between the clip-path phase and the scaleX-collapse phase. Removed the scaleX phase entirely — everything is now a single continuous clip-path interpolation. Each polygon has 64 vertices (32 X-slices × 2), each vertex slides toward (100%, 50%) — the right-edge center where the Dev button sits — as its local pinch amount (smoothstep envelope) goes 0 → 1. 17 keyframes per direction so the browser's per-pair linear interpolation tracks the smoothstep curve closely. Generated procedurally by `scripts/generate-genie-keyframes.js` — re-run that script and splice the output into animations.css to tweak the math. Note: pure CSS clip-path can only approximate the real genie (which uses per-vertex mesh transforms in macOS); the curved sine-wave distortion would require WebGL or canvas. This is as close as CSS gets." },
    ],
  },
  {
    version: "0.9.483",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Emerge / Retract rebuilt with animated 8-point `clip-path` polygons — proper macOS genie behavior. The right side (near the Dev button) pinches into a narrow 'neck' while the left side stays full-height, then the body gets pulled through the neck and sucked into the right edge. Previous scaleY shrunk the whole length uniformly; CSS transforms can't do localized distortion but clip-path polygons can. Retract reverses through wedge → narrow neck → thin strand → collapsed point at the right edge. Emerge plays the same keyframes in reverse." },
    ],
  },
  {
    version: "0.9.482",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Retract animation rebuilt as a real genie-into-bottle squeeze instead of the flat horizontal collapse it was. Two-stage keyframes: first scaleY shrinks fast (the pill flattens into a thin horizontal strand), then scaleX collapses toward the right edge (the strand gets sucked into the Dev button). A subtle ramping blur smears the trailing edge as it disappears. Duration 440 ms; ANIMATION_DURATIONS table updated so the useEnterExit unmount timer waits the full animation before tearing the element down." },
    ],
  },
  {
    version: "0.9.481",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Dev pill mount animation (Emerge) wasn't firing at all — log showed `[anim-enterexit] queued` but never the matching `[anim-play] fired`. Root cause was a race in `useEnterExit`: after flipping `shouldRender` to true, we scheduled the playAnimation call in a `requestAnimationFrame` that often fired BEFORE React had committed the pill's mount, so `ref.current` was still null and we returned early. The unmount path was fine because the element is already in the DOM at that point. Split mount-firing into a separate `useEffect([shouldRender])` that runs after React commits — ref is guaranteed populated when we play the queued animation. Added a `[anim-enterexit] firing queued mount anim` log line so the play sequence is now traceable end-to-end." },
    ],
  },
  {
    version: "0.9.480",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Dev pill still played the old genie animation on disappear (and sometimes appear) because 0.9.477's defaults (`genie` / `geniehide`) had been persisted into the user's `buttonAnimations` localStorage the first time they toggled dev mode under that version. Since saved user-assignments win over defaults, the new emerge/retract defaults never took effect for those users. Shipped a one-time migration that clears ONLY the genie/geniehide values from the dev-pill slot (other animation choices are preserved); tracked by `buttonAnimations.migrationVersion` so it runs once per machine." },
      { type: "improvement", text: "Animation system now writes diagnostic logs per the standing logging directive: `[anim-enterexit]` on every mount/unmount with the slot value and what default fell through, `[anim-play]` on every fire with the target's `data-anim-id` or tagName, `[anim-layout]` for picker opens / set assignments / design-mode flips / click-trigger fires. Future animation bugs are diagnosable straight from `provincia.log` without console access." },
    ],
  },
  {
    version: "0.9.479",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Dev and Volume buttons no longer jitter when the dev pill mounts. 0.9.477's `minHeight: 32` wasn't enough because the pill's natural outer height is ~33 px, which still grew the row by 1-2 px on mount and shifted the Dev/Volume vertical centers each toggle. Switched to a fixed `height: 40` — row outer box is now exactly 40 px regardless of pill presence, so the centers don't move." },
    ],
  },
  {
    version: "0.9.478",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Dev pill default animation replaced. The 0.9.477 Genie effect overshot its final size and didn't feel like 'coming out of the Dev button' — replaced with Emerge (mount) and Retract (unmount). Both use `transform-origin: right center` + scaleX so the right edge stays glued to the Dev button. Emerge grows scaleX 0 → 1 with a heavy ease-out curve and NO overshoot (never exceeds final size). Retract shrinks scaleX 1 → 0 back into the Dev button on toggle-off. Genie is still available in the library for users who want it." },
    ],
  },
  {
    version: "0.9.477",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "Two new animations: Genie in / Genie out (macOS dock-minimize effect). transform-origin = right center so the dev pill visually emerges from / disappears into the Dev button on its right. Uses perspective rotateY + scaleY squish + a hint of blur to approximate the curved-suction feel — CSS can't do the real sine-wave distortion the macOS engine uses but rotateY in perspective gives a passable foreshortened look." },
      { type: "improvement", text: "Dev pill now defaults to Genie in / Genie out for mount / unmount if the user hasn't picked something else in the animation editor. useEnterExit accepts `defaultMount` / `defaultUnmount` options for this." },
      { type: "improvement", text: "Dev and Volume buttons are vertically centered with the dev pill again — and no longer jump when the pill mounts. The row uses `alignItems: center` with a fixed `minHeight: 32px` (the pill's outer box height), so the row's height stays constant whether the pill is rendered or not. Earlier ships swung between flex-end (no jump but visually low) and center (centered but jumped); this is the proper fix." },
    ],
  },
  {
    version: "0.9.476",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Hotfix for 0.9.475: the animation picker was unusable because clicking its own tiles still triggered the design-mode interceptor (= picker opened on top of itself, recursively). Bug was an order-of-checks issue in `findAnimatable` — it returned the first BUTTON it saw, BEFORE walking up the ancestor chain to check for `data-anim-bypass`. Picker tiles are buttons inside a bypass-flagged container, so the bypass never applied. Fixed with a two-pass walk: first scan the whole ancestor chain for any `data-anim-bypass`, then look for the nearest animatable element. Added `data-anim-bypass` to the ↶ Undo and ↺ Reset buttons too so they keep their original behaviour in Layout mode." },
      { type: "feature", text: "📋 Copy layout button in design mode. Dumps every layout-related localStorage key (splitter percentages, widget positions, animation assignments, audio volume) to clipboard as JSON. Lets the user paste their current layout back into chat so the in-source defaults can be baked in to match — meaning the next ship's ↺ Reset will reset to your layout rather than the original." },
    ],
  },
  {
    version: "0.9.475",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "Animation editor in Layout mode. Toggle Layout on (📐 Layout button in the dev pill) — every button in the app becomes click-to-edit. Clicking opens a popover that lets you pick from a library of 18 animations (Pop, Bounce, Wiggle, Shake, Pulse, Tada, Jelly, Rubber band, Swing, Flip, Rotate, Heartbeat, Glow flash, Squish, Bounce in, Slide bump, Flash, Wobble — hover tiles for a live preview, click to assign). Choices persist in localStorage and replay on every click of that button outside Layout mode. Non-button containers can be tagged with `data-anim-id` and pick separate Appearing and Disappearing animations (the dev pill already has these slots — click the pill in Layout mode to set them)." },
      { type: "improvement", text: "Dev pill now stays mounted long enough to play its Disappearing animation when Dev mode flips off. useEnterExit hook reads the user-assigned animation, fires it, then unmounts the pill after the animation completes (no animation = immediate unmount). The Appearing animation fires one frame after mount so the user can see the pill appear from whatever shape was chosen (e.g. Bounce in, Slide bump, Pop)." },
      { type: "improvement", text: "Animations use `data-anim-fire=\"<name>\"` attributes rather than CSS classes — React's reconciler doesn't manage data attributes, so the animation can't be wiped by a re-render that happens during the same click. This was a real risk for the Dev button (its click changes state and re-renders before the animation finishes)." },
    ],
  },
  {
    version: "0.9.474",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Dev button now has a macOS-style animation. Toggling it on plays a spring-physics pop (slight overshoot + a tiny wiggle) followed by a soft amber breathing glow while dev mode is active. Hover lifts the button ~1px with a drop shadow; press scales it down 6% for tactile feedback. Spring curve uses cubic-bezier(0.34, 1.56, 0.64, 1), matching NSAnimation defaults." },
      { type: "feature", text: "Volume slider replaces the binary mute button. Click the speaker icon to pop open a vertical slider (drag the knob up/down). Scroll-wheel over the speaker nudges ±5%. The glyph adapts to the level — full at high volume, two waves at mid, single curve at low, X when muted. Volume persists in localStorage so a user who silences the splash doesn't get blasted on the next launch. A Mute / Unmute toggle inside the popover restores to 70% in one click." },
      { type: "fix", text: "Dev + Volume buttons no longer jump up when dev mode toggles. The dev pill (Import / Save / Layout / …) appears on the same row as Dev + Volume, and the row was previously center-aligned, which shifted the smaller buttons upward when the taller pill flipped in. Row is now bottom-aligned so Dev + Volume stay anchored at the column's bottom edge regardless of whether the pill is visible." },
    ],
  },
  {
    version: "0.9.473",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Hotfix for 0.9.472 crash on revert. Two bugs combined: (1) the × per-item revert button was still gated on `e.revert` (the old resource-only revert spec) so it never showed for building / trait / ancillary entries — meaning per-item revert silently did nothing for those kinds; (2) Discard All called the new replay-revert path on every entry, and a `prior.after.length` log line threw `Cannot read properties of undefined` when the prior entry was a legacy log row persisted from pre-0.9.472 builds that lacked the `after` field. Fixed both: × shows for every entry with an `id`, and the replay-find now only matches entries that actually carry an `after` array. Legacy entries fall through to 'clear the registry' instead of crashing." },
    ],
  },
  {
    version: "0.9.472",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Per-item revert in the Pending modal now works for EVERY edit kind, not just resources. Building, trait and ancillary edits each log their full post-edit state, so clicking × on any row replays the prior staged state (or clears the registry when no earlier edit on the same target remains). InfoPopup reads `pendingTraits` / `pendingAncils` directly so a revert snaps the open character popup back instantly — no reload required. RegionInfo already drove buildings off the lifted-state map, so revert there is already instant." },
      { type: "improvement", text: "Toolbar consolidation: removed the second `Save` (autosave-snapshot) button and the entire Load dropdown menu + timeline scrub slider per user request — the dev pill's `Save` is now the one and only save button. Autosaves still run silently in the background for crash recovery." },
      { type: "improvement", text: "The Undo/Redo counter in the dev toolbar is now a green `Changes (N)` button. Clicking it opens the same pending-review modal as Save, so the user can see and revert individual staged edits without having to remember undo-stack ordering." },
      { type: "fix", text: "MuteButton and Dev toggle are now the same height pixel-for-pixel. MuteButton inherits its caller's `btnStyle` padding (3px 8px) instead of overriding with 4px 10px, and its SVG was shrunk from 18px → 14px so it fits inside the smaller padding without cropping." },
    ],
  },
  {
    version: "0.9.471",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Restore-previous-session banner buttons no longer get covered by the floating Mute / Layout / Dev controls. Bumped its z-index above the bottom-right control column and nudged the bottom anchor up from 52 → 80 so the dev pill row never overlaps it." },
      { type: "improvement", text: "Layout (📐) toggle moved INTO the dev pill — same row as Import / Save — so it doesn't float above the recovery banner anymore. Mute button moved to the right of the Dev toggle (Dev left, Mute right) so both fit on a single row with the dev pill." },
    ],
  },
  {
    version: "0.9.470",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Dev pill (Import / Save / Load / autosaves slider / …) and the Dev toggle button are now on the SAME row in the dev toolbar, not stacked vertically. Wrapped both in a single flex-row container with flex-wrap so the pill still wraps on narrow viewports." },
      { type: "feature", text: "Per-item revert in the Pending modal. Every staged resource edit (move / amount change / add / remove) now stores a `revert` spec — a small × button on its row in the modal undoes just that one edit, restoring the in-memory state. The Discard All button now auto-reverts every revertable entry instead of leaving the resources mutated. Building / trait / ancillary edits don't ship per-item revert yet — they still clear from the registry but the editor UI keeps showing the staged state until reload. Next ship will extend the revert metadata to those too." },
    ],
  },
  {
    version: "0.9.469",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Single Save button in the dev toolbar replaces both the old Export and the 0.9.467 ✎ Pending button I incorrectly added up top. Save shows the pending count when there's anything staged, opens the review modal on click, and applies via Apply inside. The browser-fallback (download to Downloads folder) still ships in non-Electron builds where the write IPC isn't available." },
    ],
  },
  {
    version: "0.9.468",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "Unified save flow: the old `Export` toolbar button (which downloaded a modified `descr_strat.txt` to your browser Downloads folder) is hidden in Electron builds. Resource / population / ownership / win-condition edits now stage into the SAME `✎ Pending (N)` review modal as building / trait / ancillary edits, with one-click Apply that writes directly into the active mod's data directory. New `write-active-mod-file` IPC (path-safelisted to descr_strat / descr_regions / descr_win_conditions variants) handles the writes. Per-edit human-readable descriptions: e.g. `[resource] move gold in Roma → (245, 412)`, `[resource] Roma: amount 1 → 2`, `[resource] Roma: add wine at (250, 415)`. The Discard button now also clears the dirty-files set (note: it doesn't auto-revert in-memory resource data — use Ctrl+Z to step back through individual edits if you want them undone)." },
    ],
  },
  {
    version: "0.9.467",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "Pending-changes registry for dev-mode edits. Building / trait / ancillary edits no longer write to `descr_strat.txt` on every click — they stage to an in-memory registry instead. A new ✎ Pending (N) toolbar button appears whenever there are staged edits; click it for a review modal that lists every change in colour-coded order (green = buildings, purple = traits, orange = ancillaries) with the final write-target counts. Apply runs the existing `updateRegionBuildings` / `updateCharacterTraits` / `updateCharacterAncillaries` IPCs in sequence and clears the registry on full success. Discard throws everything away after a confirm dialog. Registry persists to localStorage so edits survive a reload. **Not yet integrated**: resource / population / ownership edits still use the older `dirtyFiles` + descr_strat-download flow; future ship will unify them into the same review modal." },
    ],
  },
  {
    version: "0.9.466",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "EDB-alias regex from 0.9.465 didn't match because the actual format has an explicit `{` line between `alias <name>` and the `requires` clause (I'd assumed they were on consecutive lines). Result in 0.9.465: 0 aliases parsed → `homelandsData[antigonid]` empty → every region grey. Fixed regex now matches all 223 alias blocks across the EDB → 232 factions populated. Verified: antigonid → [\"homeland_macedonian\"], romans_julii → [\"homeland_roman\"]." },
    ],
  },
  {
    version: "0.9.465",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Homeland map mode rewrite per user spec: four states with a refreshed legend. GREEN = homeland owned by selected faction with correct gov (govD/gov4). YELLOW = homeland not owned by faction. RED = homeland owned but WRONG government (anything other than govD — flags settlements that need a gov rebuild). GREY = not a homeland. Old version showed grey-less, with everything not-homeland in red." },
      { type: "improvement", text: "Live homelands parsing from the active mod's EDB `alias <X>_homeland` blocks. Bundled `homelands.json` was stale (had antigonid → [\"antigonid\"], matching 9 regions) but RIS actually uses `homeland_macedonian` shared across antigonid / seleucid / ptolemaic (16 regions). New `get-mod-homelands` IPC parses faction → [homeland_<X>] from EDB at mod load. Falls back to bundled JSON for browser/no-IPC scenarios. Sample log: `[homelands] parsed N factions from EDB aliases (e.g. antigonid → [\"homeland_macedonian\"])`." },
    ],
  },
  {
    version: "0.9.464",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "ACTUAL root cause of garrison Antigonos II → Roman portrait: TWO bugs stacking in `CommanderPortraitImg`. (1) `const cultureKey = String(culture || \"roman\").toLowerCase();` defaulted to 'roman' when `culture` was null. On the FIRST render of a bodyguard unit (before commanderInfo finishes populating), culture is null → cultureKey=\"roman\" → IPC loads roman/general/038.tga and the blob URL caches. (2) The useEffect's `if (!url) { loadPortrait... }` guard meant once that wrong roman URL was set, changing cultureKey to 'w_hellenistic' on the next render didn't re-fetch. The roman blob stayed permanently. Fix: drop the 'roman' fallback (return null → unit-icon fallback shows instead), and always re-fetch when deps change (remove the `if (!url)` short-circuit and the `url` from the dep array, with proper alive-flag guarding for race ordering). Family tree never hit this because its `Portrait` component has no 'roman' default and its useEffect doesn't have the `!url` guard." },
    ],
  },
  {
    version: "0.9.463",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "0.9.462 shipped with the OLD JS bundle because I ran `electron-builder` without `npm run build` first — so the FamilyNode crash fix from 0.9.462's source never made it into the installer. 0.9.463 forces a fresh bundle rebuild + re-ship." },
    ],
  },
  {
    version: "0.9.462",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Family tree no longer crashes with `ReferenceError: v1PortraitsByName is not defined`. 0.9.461 stopped passing the prop from App.js but `FamilyNode` was still referencing the variable in its JSX without destructuring it from its own props — an undefined reference at render time. Removed `v1PortraitsByName` references from Portrait, MemberCard, FamilyNode, and the main FamilyTree export. Component is now exactly where it was before the 0.9.459 add — clean revert." },
    ],
  },
  {
    version: "0.9.461",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Calibrate-button count computed from cache via secondaryUuid set (not Object.keys, which inflates 3× because each char has 3 keys). Old `statsCacheCharCount` state variable was getting out of sync when calibrate ran from different code paths. Now always reflects the actual unique characters in cache." },
      { type: "fix", text: "Removed `v1PortraitsByName` from the family tree props — it was pulling stale portrait entries from pre-0.9.460 calibrations and risking the family tree (which was already correct) drifting from its proven coord-bridge + hash flow. Family tree is back to exactly what it was before I touched it." },
      { type: "fix", text: "Wipe pre-0.9.460 stats-cache localStorage on app start (stamped via `statsCacheGen` key). Prior calibrations stored v1's cross-contaminated portrait paths (Demetrios III→woman, etc.); leaving them in localStorage would let those wrong paths leak back through any code that reads `statsCache[k].portrait`. Recalibrate from save to repopulate after install." },
    ],
  },
  {
    version: "0.9.460",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Garrison cards now use the IPC hash pool unconditionally, matching the family tree's correct rendering. Ground truth via user screenshots: family tree shows the right portraits (e.g. Antigonos II = old bearded with crown helmet, Demetrios III = young helmeted with goatee); garrison was showing a WOMAN for Demetrios III because v1's `c.portraits[0]` forward-scan picks up adjacent records' pstrs (cross-contamination). Family tree's coord-bridge usually misses for player-faction leaders, falling through to hash — that hash result is what RTW Remastered actually displays in-game. Forces savePath=null on every commanderInfo entry so the IPC always hashes; calibrate also stores portrait=null; non-live bodyguard-swap reads cached.portrait but it's now null too. All paths converge on the same hash algorithm the family tree was already using." },
      { type: "improvement", text: "Calibrate button label tracks the actual character count (state variable `statsCacheCharCount`), not the cache key count. The cache stores 3 keys per char (full + 2 stripped) so `Object.keys(statsCache).length` was inflating the displayed count to ~3× chars. Toaster (`Calibrated 936 characters`) and button (`Calibrate (936)`) now agree on the same total." },
    ],
  },
  {
    version: "0.9.458",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Dropped the +280 portraitCardsPath bridge entirely. Dig (`scripts/save-cracker/dig-antigonosb.js`) verified that `extX, extY` from `attachMapCoords` are NOT reliable map coords — AntigonosB had extX=409 extY=359 vs his descr_strat (393, 391). The bridge gave correct portraits for chars where the back-ref's +288/+292 bytes happened to equal map coords (~250 chars), but failed for player-faction leaders like Antigonos II whose back-ref landed elsewhere. Use v1's c.portraits[0] directly — verified ~83% unique (745 distinct paths across 894 chars), AntigonosB→000.tga, DemetriosC→032.tga, DemetriosD→146.tga, all distinct. The earlier 'Macedonians get Roman' was caused by the bridge's broken UUID resolver (0.9.452 fixed), not by v1's forward-scan. Captain-banner filter from 0.9.447/448 keeps v1's paths clean." },
    ],
  },
  {
    version: "0.9.457",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "All Macedonian generals showing Antigonos II's portrait — bridge was colliding all (extX=0, extY=0) characters onto a single map entry. `attachMapCoords` reads bytes at +288/+292 of the back-ref; when the back-ref lands in a non-pool context those bytes are 0/0, AntigonosB happened to be first into the bridge map at key `\"0,0\"`, every save char with c.x/c.y null defaulted to the same key and inherited his portrait. Fix: both sides require valid map coords (0 < x < 2048, RTW's actual map bounds) before adding to / looking up the bridge map. Invalid-coord chars now fall through to hash-pool as designed. New log line `[commander-info] 0.9.457 bridge: N hits, M misses (coord map size=K, extras with valid coords=L)` shows the breakdown — `coord map size` should now reflect real unique positions, not be dominated by one (0,0) bucket." },
    ],
  },
  {
    version: "0.9.456",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Actually fixed the portrait issue by digging into the .sav bytes properly (`scripts/save-cracker/dig-portrait-truth.js`). Tested 7 candidate offsets (264, 268, 272, 276, 280, 284, 288) against 109 greek-general records, scoring each by `unique paths / resolved chars`. Result: only `+280` produces high uniqueness (86 resolved → 82 unique paths, ~95%); every other offset returns 0-6 unique paths (way too few — they're other fields, not portrait UUIDs). So `+280` IS the engine's portrait UUID, confirmed. The 'Macedonians get Roman portraits' symptom was the v1 parser's `c.portraits[0]` forward-scan grabbing adjacent records' paths (cross-contamination — Antigonid characters whose record neighbours stored Roman pool paths). Fix: garrison commanderInfo and calibrate-from-save both use the +280 bridge result ONLY (via characterExtras.portraitCardsPath); the v1 fallback is dropped entirely. Bridge misses fall through to the renderer's hash pool, which matches the family tree's hash for the same char." },
    ],
  },
  {
    version: "0.9.455",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Portraits restored to 0.9.449's family-tree result, which the user confirmed was correct. Diagnosis: 0.9.453 dropped lastName from the hash input entirely (changing `name|lastName|faction` to `name|faction`), which shifted every char's idx — AntigonosB went from 038 (correct) to 130 (wrong). 0.9.454 re-enabled the save-cracked UUID bridge but it produced cards/old/000.tga (also wrong). Fix: keep the 3-element hash shape but FORCE lastName to \"\" inside the IPC, regardless of caller. Garrison live mode (which carries the epitheted lastName) and family tree non-live (which doesn't) now both produce the same idx — the one user confirmed was correct in the very first \"family tree was right\" screenshot." },
      { type: "fix", text: "Calibrate now REPLACES the stats cache instead of merging. Previously the cache size in the button (\"Calibrate (1183)\") drifted above the toaster's reported calibration count (\"Calibrated 936 characters\") because each calibrate run merged with prior entries. Both numbers now agree on the same total." },
    ],
  },
  {
    version: "0.9.454",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Re-enabled the engine-exact portrait bridge (save's +280 portrait UUID → pool entry → portrait file) now that 0.9.452's tighter resolver eliminates the false-positive collapse. Both garrison commanderInfo and the calibrate-from-save IPC use the bridge with `coordToV2Portrait` (extX,extY → portraitCardsPath, first-wins on collision). Hash fallback only fires for chars without an extras entry. New log line `[commander-info] 0.9.454 bridge: N hits, M misses` shows bridge effectiveness. Same engine-exact path that the family tree was already using when its coord lookup hit. Hash without lastName (0.9.453) stays as the final fallback so any chars missing both bridges still get a deterministic per-name pick." },
    ],
  },
  {
    version: "0.9.453",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Garrison cards no longer all show the generic bodyguard icon. 0.9.451's calibrate set `chosenPortrait = null`, which combined with the existing `if (!hasStats && !chosenPortrait) drop` filter meant ~282 Macedon chars (the ones who had a portrait but no decoded stats) got DROPPED from the stats cache entirely. Bodyguard-swap then couldn't find them → no `info` → rendered the unit icon fallback → every general looked identical. Now we keep every parsed char (anything with a firstName) in the cache so the bodyguard-swap charContext gets populated, the IPC's hash-pool fallback runs per-name, and each general lands on a distinct portrait. Also lifts the hash-pool log throttle so every pick is visible in the log." },
    ],
  },
  {
    version: "0.9.452",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Rewrote `resolvePortraitsByCharacter` with the tighter back-scan approach from the original crack script. Previously the resolver scanned 64 bytes AFTER each portrait pair indexing every u32 as a possible UUID (~11k false-positive entries per save, ~80% of chars bridged to the wrong portrait). New approach: for each char's `+280` portrait UUID, find every occurrence of that UUID in the save and look back ≤100 bytes for a pstr16 portrait path; first hit wins. Result on the test Macedon save: 397/465 chars resolve via real UUID lookup (was inflated to all 465 via false positives), 310 unique card paths (was many fewer distinct values due to collisions). Garrison still uses hash-fallback (0.9.451 behaviour) because the descr_strat (x,y) vs save (extX,extY) divergence means the family tree falls back to hash too for some chars; the rewrite is a quality improvement that future bridges can build on once the coord mapping is also tightened." },
      { type: "improvement", text: "Re-ship 0.9.451's fixes (garrison bodyguard-swap uses hash fallback, age propagated through stats-cache). User on 0.9.450 reported portraits still wrong; auto-updater had downloaded 0.9.451 but the app hadn't been restarted. **Restart the app after install + recalibrate from save** to pick up the fix." },
    ],
  },
  {
    version: "0.9.451",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Garrison bodyguard-swap portraits now match the family tree. The save-cracked `portraitCardsPath` bridge was bridging chars to the WRONG (cards, fulls) pair — `resolvePortraitsByCharacter`'s 64-byte u32-sweep window indexes ~11k false-positive candidates per save (60 sweep candidates × ~188 portrait pairs), and chars' `+280` portraitUuids coincidentally hit wrong entries. The user's log made it visible: Antigonos II → `savePath=\"cards/old/generals/000.tga\"` (wrong, from bridge) vs `family-tree hash pool pick → 038.tga` (right, hash matches RTW's engine pick for chars without explicit descr_strat `portrait_index`). Both code paths (live `commanderInfo` and non-live `calibrate-from-save`) now drop the bridge entirely and rely on the IPC's hash fallback — same path the family tree already uses. Also propagates `age` from cached entries into the bodyguard-swap charContext so the IPC picks the right age bucket (was hitting `young` for everyone). Until the sweep window is tightened to eliminate false positives, this is the correct call." },
    ],
  },
  {
    version: "0.9.450",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Garrison bodyguard-swap cards no longer collapse all generals on the same city tile to one portrait. The commander-info builder bridged `characterExtras` → save chars via a `(x,y) → portraitCardsPath` Map, and 6+ Macedon generals stacked on Pella all map to one tile — last-wins overwrote the rest. Family tree spreads chars across the map so the collision was rare there (user-confirmed family tree was correct). Fix: bridge by `primaryUuid` first (unique per character), `(x,y)` only as fallback, and the coord map is now first-wins so even when the UUID bridge misses we keep ONE useful portrait per tile rather than the last one. New `[commander-info] bridge: extras→saveChar uuid_hits=N coord_hits=M v1_fallback=K` log line shows the breakdown after each save load." },
    ],
  },
  {
    version: "0.9.449",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Heavy diagnostic logging for portrait resolution so we can debug 'all family-tree members show the same portrait' reports. New log lines: `[family-tree] coord-bridge: ...` (once per save load — reports characterExtras count, how many got (x,y), how many have a portraitCardsPath, and lists tile collisions); `[family-tree] portrait OK/FAIL ...` (once per character, reports savePath or `(hash)` source); `[resolve-portrait] fast-path MISS for savePath=...` (logs once when the engine-stored save path points at a file the filesystem doesn't have, forcing hash-pool fallback); `[resolve-portrait] hash pool pick ...` (logs once per hashInput, shows which pool index a char deterministically landed on — so two chars colliding on the same portrait are visible)." },
    ],
  },
  {
    version: "0.9.448",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Captain-banner portrait filter also applies in the V2 parser. 0.9.447 filtered captain banners out of the v1 parser (`characterParser.js`), but `characterParserV2.js` has its own portrait scan that produces the `c.portraits[]` array consumed by `saveCharactersByRegion` → bodyguard-swap. Symptom: even after recalibrating on 0.9.447, antigonid Dionysios still showed `data/ui/captain banners/captain_portrait_syracuse.tga`. The v2 filter mirrors v1's regex. **Recalibrate again** (Calibrate button → pick save) after install to refresh the stats-cache portraits." },
      { type: "improvement", text: "Throttled the `[building-edit] applying override` log so it only fires once per (region, building-signature) pair instead of on every icon-prefetch-driven re-render. Was producing 19 identical lines per region open." },
    ],
  },
  {
    version: "0.9.447",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Bodyguard-swap unit cards no longer pick up a captain-banner image instead of the character's portrait. The v1 character parser scans forward from the trait block for length-prefixed ASCII paths and stores them in `c.portraits[]` — but the engine sometimes writes a `data/ui/captain banners/captain_portrait_<faction>.tga` path inline before the real portrait, and `portraits[0]` was hitting that first. Symptom in the log: `Dionysios → savePath=\"data/ui/captain banners/captain_portrait_syracuse.tga\"`. Fix filters captain-banner paths out of `portraits[]` during extraction, so the first surviving entry is the actual general/family portrait. **You'll need to recalibrate from a save** (Calibrate button → pick a save) for the cached stats-cache portraits to refresh." },
    ],
  },
  {
    version: "0.9.446",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Save-faction-discovered bitmask now parses on late-campaign autosaves where the first sentinel byte is `9e` instead of `9c`. ImHex headless cross-save diff (Bactria T964 vs Dummies T900/T1134) revealed a one-bit flip in that byte — it's a flags nibble, not a fixed magic — so the parser was rejecting Bactria's bitmask outright and the discovered-by-player faction list never populated. Now we mask the low nibble and require the rest of the sentinel (`c7 06`) to match, which preserves the integrity check while accepting both observed variants. Other top-nibble values still get rejected so we don't widen the gate too far." },
    ],
  },
  {
    version: "0.9.445",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Bodyguard-swap unit cards now show the same character portrait as the family tree. The family tree resolves portraits through the v2 role-anchored parser (`portraitCardsPath`, the engine-exact rendered art); non-live bodyguard swaps were resolving through the v1 name-pool/trait parser (`c.portraits[0]`), which could pick a different file for the same character. The `calibrate-from-save` IPC now runs the v2 character-extras parser, attaches map coordinates, resolves portraits via `resolvePortraitsByCharacter`, and bridges to v1 calibrated chars by (x, y). When the coord bridge hits, the v2 portrait wins; v1's portrait is the fallback. Adds `[calibrate] portrait source breakdown: v2_coord=N v1_fallback=M none=K` log line so the dominant source is visible." },
    ],
  },
  {
    version: "0.9.444",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "CRITICAL: dev-mode building editor was corrupting `descr_strat.txt` on every save. The `update-region-buildings` IPC's settlement-close detection treated the FIRST `}` inside the settlement (which closes a building block) as the settlement-closing brace — so the building-range scanner saw zero closed blocks, removed nothing, and appended N new ones. Each edit doubled the building list; after a few clicks a region's `descr_strat` block ballooned to 30+ entries with orphaned `building {` headers and stray `}`s. Fix tracks brace depth properly: depth 1 = inside settlement, depth ≥2 = inside building, settlement only closes when depth drops back to 0. If your `descr_strat.txt` is already corrupted, restore via `git checkout` or your backup before re-editing." },
    ],
  },
  {
    version: "0.9.443",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Building dev-editor now respects EDB `requires` clauses on each level. Catalogue captures the per-level `requires` expression and the renderer evaluates it against the region's current faction + descr_regions tag list. Filters applied to both the Add Building picker and the ⬆ upgrade button: `requires factions { x, y, }` hides chains/levels not allowed for the current owner; `not factions { ... }` mirrors that the other way; `hidden_resource X` / `resource X` requires the tag in the region's tag list (and the `not` variants too). Unknown predicates (event_counter, religion, building_present) still pass through — better to surface a few extras than hide legit options. Combined with the existing settlement_min gate, the picker now closely mirrors the engine's accept/reject behaviour." },
      { type: "fix", text: "EDB level-header regex now matches the `<level> requires <expr>` single-line declaration form used by RIS (e.g. `farms+2 requires factions { …, } and resource grain`) and allows `+` / `-` in level names. Previously only bare-line `farms+2` opened a per-level block, so `settlement_min` values inside levels declared with inline `requires` were lost — meaning the farm chain was always unrestricted in the picker." },
    ],
  },
  {
    version: "0.9.442",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Multi-general armies + garrisons now show all general face cards at the START of the row, side-by-side. Previously the bodyguard→face-card swap fired per-unit in descr_strat/save order, so two generals in the same army bookended the row with units in between. Stable sort: face-card-eligible units (those with `commanderUuid` in live mode or `commanderName` in non-live) hoist to the front, everything else keeps its relative order." },
      { type: "fix", text: "Dev-mode building override now preserves bundled-data fields (culture, label hints, tier) when applied. Previously the override was stripped to `{type, level}` before getBuildings consumed it, so on certain regions the merge starved icon + label resolution. Now each override entry is merged onto the bundled static entry for that chain (when present), so the post-resolution pipeline always has enough context to render. New `[building-edit] applying override` log line shows the count each time an override applies." },
      { type: "improvement", text: "Add Building picker now hides chains whose first-level `settlement_min` exceeds the current settlement tier. Previously the picker would let you add e.g. `barracks` to a village even though the engine would refuse — now those chains drop out of the list and reappear when you upgrade the core_building (settlement tier). Other engine requirements (factions, culture, hidden_resources) aren't checked yet." },
    ],
  },
  {
    version: "0.9.441",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Dev-mode building edits now show the correct artwork on upgrade and persist when devMode toggles off. The previous editor kept a stripped local mirror so upgraded chains rendered with the OLD tier's icon, and devMode-off reverted to the bundled prop. The edit state lifts up to App.js as a per-region override that getBuildings consults, so the existing icon-prefetch + label-resolution pipeline runs over the new list — new tier = new artwork, automatically, every time." },
      { type: "feature", text: "Settlement-tier gating for the dev-mode ⬆ button. The catalogue now parses every level's `settlement_min` from `export_descr_buildings.txt` (plus the `core_building` chain's level list, which IS the settlement ladder). When the settlement's core_building level is too low, the ⬆ on a chain whose next-tier requires more is hidden and the click is blocked with a toast — `Blocked: <level> needs settlement ≥ <tier>`. Upgrade the core_building (governor's house → governor's villa → proconsuls_palace → ...) and the gates on every other chain unlock together. core_building itself bypasses the check because it defines the ladder." },
    ],
  },
  {
    version: "0.9.440",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Stats-cache calibration no longer clobbers the right portrait with the wrong one. 0.9.438's relaxed filter let portrait-only chars into the cache, but the stripped lookup key (`firstName||faction`) collides when a faction has multiple characters with the same first name (RIS antigonid has many `Dionysios` / `Perdikkas` / etc.). Last writer was winning, usually a stat-less captain — so the governor's face on the bodyguard-swap card came out wrong. Calibrate now scores each candidate (stats=2, portrait=1) and only overwrites a stripped-key slot when the new entry strictly beats the existing one. The full key (firstName + lastName + faction) is still written unconditionally because it's unique. Also writes the `firstName||` (no-faction) fallback through the same scorer." },
    ],
  },
  {
    version: "0.9.439",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Loyalist map mode is now strict: a region paints in its rebel-default colour ONLY when `descr_regions` field 3 and `descr_strat` `faction_creator` actually agree. Everything else paints flat grey. Example: Sikelia (descr_regions = `italics`, descr_strat = `faction_creator capua`) was incorrectly painting in colour under 0.9.437/0.9.438 because emergent-faction and no-creator settlements were being matched permissively — now they fall through to grey like any other disagreement." },
    ],
  },
  {
    version: "0.9.438",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Stats-cache calibration now also keeps characters whose portrait decoded but whose stats didn't. Previously a save record where the engine assigned a portrait path but Provincia's stat-offset crack came up null was dropped entirely — meaning the bodyguard-swap portrait fallback never had an entry for those characters. Symptom: Leonides (antigonid governor of Pharsalos, RIS turn-0) showed the bodyguard art and approximate stats even after calibration. Fix relaxes the filter to `hasStats OR hasPortrait`. Approximate-stats label stays accurate when the entry's `command/influence/management/loyalty` stay null. New `[calibrate] coverage:` log shows the cached / stats-only / portrait-only / dropped split per save." },
    ],
  },
  {
    version: "0.9.437",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Loyalist map mode now compares the TWO independent rebel-default declarations: `descr_regions` field 3 vs `descr_strat` `faction_creator`. Previously it compared rebel-default against the current parent-faction owner (the `initialOwnerByCity` map), which is a different concept entirely — so settlements like Eraviscia_Orientalis where descr_regions says `eravisci` and descr_strat says `faction_creator eravisci` were grey-flagged because they currently sit under the anartes parent block. New: descr_strat parser also reads `faction_creator` per settlement, exposed via `get-initial-creators` IPC. The region overlay (which clobbers `r.faction` with the strat owner) now snapshots the descr_regions value as `r.rebelDefault` so loyalist mode has a stable source. Adds `[loyalist]` log line each paint pass with creator/region counts." },
      { type: "feature", text: "Dev-mode building editor in the right-side Buildings widget. Each building card gets ⬆ / ⬇ / × overlay buttons when devMode is on — ⬆ upgrades to the next level in the EDB chain (hidden at top tier), ⬇ downgrades (hidden at level 0), × removes the building. A `+ Add building` card opens an inline picker listing every chain the region doesn't already have (with search). Persists to `descr_strat.txt` via the new `update-region-buildings` IPC; status toast confirms `Saved (descr_strat:LINE)`. Catalogue (chain → levels) loaded lazily on first dev-mode entry via the new `get-building-catalogue` IPC. Logs every action as `[building-edit] up/down/remove/add <chain> <from> → <to> in region <name>`. **Does NOT modify live saves** — same caveat as the trait editor; takes effect on next non-live load." },
      { type: "feature", text: "Dev-mode ancillary editor in the right-click character info panel. Mirror of the trait editor — × per row to remove, `+ Add ancillary` picker lists every ancillary in `export_descr_ancillaries.txt` minus what the character already has, filtered by the character's culture (engine `ExcludeCultures`). Persists via the new `update-character-ancillaries` IPC. Logs `[ancillary-edit] wrote N ancillaries for <name>`." },
      { type: "improvement", text: "Add Trait picker now lists EVERYTHING the engine would accept on the character, not just the first 60 names that happened to match. Three filters applied: (1) `Characters` constraint — trait must allow this character's agent type (family/admiral/spy/assassin/diplomat or `all`), (2) `ExcludeCultures` constraint — trait must not be forbidden on the character's culture, (3) Hidden flag (still hidden outside dev mode). Visible cap raised from 60 to 250 — RIS has 3853 trait definitions so the old cap hid ~98% of options." },
    ],
  },
  {
    version: "0.9.436",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Loyalist map mode now paints emergent factions (those that didn't exist at campaign start) as MATCH, and treats regions with no creator-faction info as MATCH too. Previously these surfaced as grey mismatches — wrong for any region that didn't appear in the starting `descr_strat.txt`. Only true mismatches (creator faction exists in starting roster AND differs from current owner) get the flat grey overlay now." },
    ],
  },
  {
    version: "0.9.435",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Trait editor only shows the level buttons that actually do something — + when the trait can still level up (level < max defined level), − when it can still drop (level > 1). Single-level traits get neither button. Removes dead-click UI noise; the × remove button stays visible always." },
    ],
  },
  {
    version: "0.9.434",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "Dev-mode trait editor in the right-click character info panel. Each trait row gets +/−/× buttons to bump the level up/down or remove the trait. An `+ Add trait` button opens a searchable picker (all traits in the mod's `export_descr_character_traits.txt`, minus ones the character already has). Changes persist to `world/maps/campaign/.../descr_strat.txt` — the `traits Foo 2, Bar 1` line on the character's `character` block gets rewritten via the new `update-character-traits` IPC. Status toast confirms write + file:line. **Does NOT modify live saves** — edits affect the next non-live load (and any future new-game). Log: `[trait-edit] wrote N traits for <name> (faction <fac>) to descr_strat.txt:LINE`." },
    ],
  },
  {
    version: "0.9.433",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Hidden traits (those declared `Hidden` in `export_descr_character_traits.txt`) are now filtered out of the right-click character info panel — engine behaviour matches. Devs still see them: dev-mode shows the full list including hidden ones for cracker work. Trait-data IPC now ships a `hidden` map alongside the level data + epithets + ancillaries." },
    ],
  },
  {
    version: "0.9.432",
    date: "2026-05-19",
    items: [
      { type: "change", text: "Loyalist map mode mismatch regions now paint in neutral grey instead of a 45%-toward-grey tint of the rebel-default colour. Matches keep their full-saturation rebel-default colour; mismatches go flat grey so the eye focuses on where the rebel-default is correctly configured rather than reading a dim version of the wrong colour as also-faction-coded. (User feedback on the 0.9.371 entry.)" },
    ],
  },
  {
    version: "0.9.431",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Garrison + field-army commander labels also display the in-game name now. 0.9.430 wired up the displayName util but the three garrison-commander builders (non-live, mid-tile, non-live fallback) and the field-army entry constructor were still passing the raw string. AntigonosB now displays as Antigonos II in the garrison header." },
    ],
  },
  {
    version: "0.9.430",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Character names now display in their in-game form everywhere (was already done in the Family Tree but not in the region Characters list, garrison/field commander labels, or info-popup titles). Extracted the roman-numeral conversion (`AntigonosB` → `Antigonos II`, `DemetriosC` → `Demetrios III`) into a shared `displayName.js` util used by FamilyTree, RegionInfo, and App.js. The character widget and garrison header both pick it up so AntigonosB stops showing as the raw engine ID." },
      { type: "improvement", text: "Calibrate log now reports portrait coverage: `[calibrate] parsed 633/936 stat-bearing chars (N with portrait)`. Also dumps the raw `portraits` array for the first 3 chars so we can see whether the v1 parser found portrait paths in your save. Use this to diagnose why AntigonosB's face card was hash-picked instead of save-derived — if portraits=[] for him in the log, the v1 scan missed them; if portraits has entries, the IPC is dropping them somewhere." },
    ],
  },
  {
    version: "0.9.429",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "Bodyguard unit cards now swap for the general's face card in **non-live** mode too — previously gated on `unit.commanderUuid` which only exists in live save data. Now the calibration cache also stores each character's portrait path; in non-live mode each army's first unit gets tagged with `commanderName`/`commanderFaction` and the swap resolves the portrait by name lookup in `statsCache`. After calibrating from a save once, the bundled descr_strat starting-armies widget shows real face cards for Milon, Aulus Gabinius, every general. Field + garrison both covered." },
      { type: "improvement", text: "Loyalty hide is still active — the auto-detect found 14 trait + 30 ancillary `Effect Loyalty` lines in RIS, so it CAN'T auto-hide (the data references it). If you want it hidden regardless, that needs a manual override (toggle or per-mod config) — let me know and I'll add one." },
    ],
  },
  {
    version: "0.9.428",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Hide stats the loaded mod doesn't use. main.js now scans every trait level + ancillary's `Effect <Stat>` lines and reports `usesStat = { command, influence, management, loyalty, subterfuge }` via the trait-data IPC. The right-click character info panel reads this and drops columns the mod never references — RIS dropped Loyalty entirely, so it no longer renders. `[trait-data] mod uses stats: Command, Influence, Management` in the log so you can see what was detected." },
      { type: "improvement", text: "Bodyguard-card-swap logging. Every unit with a `commanderUuid` now logs once per render-pass why the swap fired or fell back: `[bodyguard-swap field] cmd=0x… → AntigonosB faction=\"antigonid\" savePath=\"(none)\" cultureLookup=\"greek\"` on a hit, or `no commanderInfo for cmd=0x… mapSize=N` if commanderInfo missed. `CommanderPortraitImg` itself logs `OK / FAIL` per character with the savePath it tried. Next time bodyguard cards don't swap, the log will say exactly which step missed." },
    ],
  },
  {
    version: "0.9.427",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Calibration cache lookup still missed because the v1 parser appends trait-derived epithets to lastName (`AntigonosB` → lastName `II Gonatas the Kind`), so the cache stored `\"antigonosb|ii gonatas the kind|\"` but the renderer reads with empty lastName (RIS chars are single-named in descr_strat) and tried `\"antigonosb||antigonid\"` / `\"antigonosb||\"`. Spotted from the new log lines — write side wrote epithet-baked keys, read side had no way to know about them. Fix: cache now writes BOTH variants per character — full key (with epithet lastName) and a stripped key without lastName. The renderer's existing fallback chain hits the stripped variant. Applies to all three write paths: manual 🎯 Calibrate + save-watch + initial-load." },
    ],
  },
  {
    version: "0.9.426",
    date: "2026-05-19",
    items: [
      { type: "improvement", text: "Logging added to the stats-cache pipeline so the next bug-hunt is just `tail provincia.log` away. Logs now include: `[calibrate]` IPC entry with count of stat-bearing chars + sample key/value rows; `[stats-cache] wrote` on the renderer side with the actual cache-key strings being stored; `[stats-cache] HIT`/`MISS` once-per-character on lookup including all key variants tried + the matched key on hit. Per the new directive (memory: `feedback_log_new_features`), every new feature ships with bracketed log lines that capture what data flowed and what decisions were made." },
    ],
  },
  {
    version: "0.9.425",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Calibration cache wasn't being read after writing. The v1 character parser returns `faction = undefined` for many characters (the role-byte → faction mapping isn't reliable without descr_strat cross-ref), so the write side ended up with cache keys like `antigonosb||` (empty faction). The read side built keys like `antigonosb||macedon` (faction from descr_strat) and missed. Fix: read tries four key variants in order — full key, key-without-faction, key-without-lastName, name-only. With Antigonos II Gonatas the second variant hits, and the chip shows the real 7/6/5/6 instead of the trait-effect estimate." },
    ],
  },
  {
    version: "0.9.424",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "🎯 Calibrate button now actively loads a save instead of just showing instructions. Click → file picker opens at the saves folder → pick a save → app parses it in the background (doesn't enter live mode, doesn't touch any other state), extracts every character's command/influence/management/loyalty + faction + name, and writes to the localStorage cache. Manual calibration is treated as the user's explicit intent so it overwrites existing entries regardless of turn (so picking a fresh turn-0 save replaces stale mid-campaign values). Toast confirms how many characters were cached + which turn the save was on." },
    ],
  },
  {
    version: "0.9.423",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "**Auto-calibrating stat cache.** Every time you load a save with real stats (live mode), Provincia caches each character's command/influence/management/loyalty keyed on `firstName|lastName|faction` into localStorage. Then in non-live (`(starting)`) mode the Characters widget looks up the cached values FIRST — falling back to the trait-effect estimate only for characters the cache hasn't seen yet. Result: after loading any turn-0 save of your mod once, you see real save-read stats in non-live mode for every character that's also in the cache. The cache is persistent (survives reloads) and turn-aware (turn-0 entries outrank later-turn ones to avoid mid-campaign trait gains leaking into the 'starting' display)." },
      { type: "feature", text: "**🎯 Calibrate button** in the top toolbar. Click it for instructions: 'start a new game in your mod, save immediately at turn 0, load that save here'. After that, non-live mode shows real stats. The badge shows the cached character count, so you can see when calibration is set up. The button isn't required — the cache auto-populates on any save load — it's there so users know the feature exists and can explicitly re-calibrate when needed." },
    ],
  },
  {
    version: "0.9.422",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "Non-live mode now estimates Command/Influence/Management/Subterfuge by summing trait + ancillary Effect lines per character. descr_strat doesn't store stats inline (engine computes them at game start from base + traits + ancillaries + tag bonuses), so the previous `?/?/?/?` was a data gap rather than a parser bug. Sum gives results within 1-2 of in-game (Antigonos II Gonatas estimates 5/5/3, in-game is 7/6/5 — gap is the engine's unmodelled base values + faction-leader tag bonus). Estimates are marked with `~` so they're visually distinct from save-derived stats. Right-click info panel reads the same field." },
      { type: "feature", text: "Dynamic culture discovery in `parseCharacterExtras` — replaced the hardcoded VANILLA_CULTURES + RIS_CULTURES list with a scan that finds every `<culture> <role>\\0` pstr16 in the save and validates the token. Per the no-hardcoding directive, works for any mod (vanilla, RIS, BI, Alex, custom). On Macedon T0 RIS the count rose from 421 → 465 — the hardcoded list missed `sarmatian`, `illyrian`, and others that the engine assigns to specific characters." },
    ],
  },
  {
    version: "0.9.421",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "Non-live (descr_strat) mode now parses character stats so the `(starting)` Characters widget shows real Command/Influence/Management/Subterfuge instead of `?/?/?/?`. The `command N, influence N, management N, subterfuge N` tokens appear on both `character` lines (the named-character header) and `character_record` lines (family members) in descr_strat — parser now picks them up from both. Stats forward through `byCoord` → `startingCharactersFromMod` → the mapToChar function in App.js → the characters prop. Live mode unchanged (still uses v1 parser's u32 read of the save's stat block)." },
      { type: "improvement", text: "FamilyTree also gets the descr_strat stats — they ride along on the `bucket.named` records that drive `modFamiliesByFaction`, so right-clicking a tree member without a save loaded still shows the 4-up stat row in the info panel." },
    ],
  },
  {
    version: "0.9.420",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Ancillary icons resolve correctly now. The descr_strat / save name (e.g. `poet`) is not the image filename — each `Ancillary <name>` block in `export_descr_ancillaries.txt` has an `Image <file>.tga` line that maps to the actual TGA. Parser now captures that mapping and the AncillaryRow uses it. `poet` resolves to `philosopher2.tga`, etc." },
      { type: "feature", text: "Ancillary rows also show Effects (colored `+1 Influence` badges) + the full description text from `export_vnvs.txt` — same layout as the trait rows." },
      { type: "fix", text: "Character stat labels were rotated. v1 parser labeled the four u32 fields at character record +102/+106/+110/+126 as management/command/influence/loyalty, but in-game verification (Antigonos II Gonatas in RIS Macedon T0 — Command 7, Influence 6, Management 5) showed the labels were one position off. Corrected: +102 = command, +106 = influence, +110 = management, +126 = loyalty (unchanged). Byte offsets are the same — only the labels rotate." },
      { type: "feature", text: "Stats row added to the right-click character info panel. Command (orange), Influence (purple), Management (green), Loyalty (gold) shown as 4-up tabular numerics. Reaches characters through the v1 parser → charactersByRegion path AND the FamilyTree coord bridge (so it also fires on descr_strat-rendered tree members)." },
    ],
  },
  {
    version: "0.9.419",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Ancillaries were STILL rendering as `undefined` in the right-click character info panel after 0.9.418. The 0.9.418 fix handled v1-bridged ancillaries (`{id, name}` objects), but the FamilyTree right-click path renders descr_strat-derived characters where ancillaries are stored as raw STRINGS (one element per token in the descr_strat `ancillaries foo, bar` line — see main.js:466). `AncillaryRow` was reading `ancillary.name` on a string and getting `undefined`. Fix: normalize both shapes — if the input is a string, use it directly; if it's an object, prefer `.name` then fall back to `#id`. Ancillary icons load from the same string either way." },
      { type: "change", text: "Trait icons confirmed absent from RTW Remastered's data tree. Exhaustive search of both the install directory and the RIS mod tree (every TGA / DDS / PNG) found zero per-trait icons — they were files in vanilla 2004 RTW at `data/ui/<culture>/vnvs/<level_name>.tga`, but Remastered baked them into a compiled UI atlas. The IPC handler still tries the legacy path so a mod-supplied file would render, but stock RTW Remastered / RIS / BI / Alex all return nothing. Trait rows show effects + threshold + description without the icon slot in that case." },
    ],
  },
  {
    version: "0.9.418",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Ancillaries were rendering as `#undefined` in the right-click character info panel. Root cause: `bridgeV1Traits` copied ancillaries from the raw v1 char array, where they're just `{ id }` — the name-resolution pass (mapping id → name via `export_descr_ancillaries.txt`) runs against `charactersByRegion`, NOT the raw `characters` array we bridge from. Fix: pass `modAncillaryNames` to the bridge and resolve names there. Ancillary icons now render too — RTW Remastered DOES ship these at `data/ui/ancillaries/<name>.tga`, via a new `resolve-ancillary-icon` IPC." },
      { type: "change", text: "Trait icon column dropped from the info panel because RTW Remastered ships no per-trait icon files (vanilla RTW had `data/ui/<culture>/vnvs/<level_name>.tga`, but Remastered baked trait icons into a compiled UI atlas — no path resolves on disk). The 0.9.417 placeholder slot was just rendering an empty box; it's now hidden unless the mod re-introduces files at the legacy path. Effects, level name, threshold, and description text still render as before." },
    ],
  },
  {
    version: "0.9.417",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "Trait + epithet entries in the right-click character info panel now show their **picture, effects, and description text**. Picture: trait icon TGA loaded from `data/ui/<culture>/vnvs/<level_name>.tga` (with vanilla-culture fallback), decoded the same way as portraits and unit cards. Effects: colored badges per Effect line in `export_descr_character_traits.txt` (`+1 Command` green, `-1 Influence` red, etc.) plus the EffectsDescription text in case the mod wrote a more nuanced one (e.g. `+10 Build Points (required to build siege equipment)`). Description: full italic blurb from `text/export_vnvs.txt`. Parser now handles both vnvs formats — `{key}\\ttext` on one line AND `{key}` then text on next line; the next-line variant was silently dropped before, so trait descriptions never reached the UI. Threshold from the trait file is shown next to the level number so power-users can see when the level kicks in." },
    ],
  },
  {
    version: "0.9.416",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "Per-character traits in RIS now reach the right-click info panel from the Family Tree. Crack: `parseCharacterExtras` (role-anchored, 421 chars in Macedon T0 RIS) doesn't read traits — the post-role layout differs from the v1 character record format. But the v1 parser DOES find these characters at completely different file offsets (UUID namespaces are also different, so direct UUID lookup misses). New `bridgeV1Traits()` joins the two via (x, y) map coords, since each tile can carry at most one character. Bridges 241/421 chars on Macedon T0; bridged entries get `traits`, `ancillaries`, `clanHead`, `firstName`, `lastName`. FamilyTree's coord-to-save map now passes these through to the right-click info panel, so the popup shows real save-state traits (current-turn values, gained epithets) instead of frozen T0 descr_strat values. Wired into the three parseCharactersAndUnits sites in main.js." },
    ],
  },
  {
    version: "0.9.415",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Family Tree window now follows the app's dark/light mode toggle. It was always rendering with the light parchment palette regardless of system theme — the modal is a fixed overlay, not a `.panel`, so neither the panel CSS rules nor the inline-color contrast-fix mutation observer reached it. Added a set of `--ft-*` CSS variables on `:root` and `body.dark-mode` (card bg, text, borders, sidebar, member cards, portrait frames, connector lines, zoom controls, etc.); the FamilyTree inline styles now read those vars so toggling the OS dark mode re-themes the modal in place." },
    ],
  },
  {
    version: "0.9.414",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "0.9.412/0.9.413 still missed Milon (and any governor whose v1 char record didn't get a region attached). saveCharactersByRegion is region-keyed — it drops chars whose `c.region` is null. Governors like Milon-in-Taras can hit that path: the engine knows he governs Taras via the marker-1940 settlement governor table, but the v1 parser's region inference for his char record can fail. Solution: augment `commanderInfo` with `saveGovernorByCity` (the authoritative governor→uuid map), which has uuid + firstName + lastName + age. Governors don't carry a portrait path so the IPC falls back to name+faction+age hash-pick from the right culture pool — stable per-character, matches what RTW renders." },
    ],
  },
  {
    version: "0.9.413",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Culture-key lookup in the bodyguard→face-card swap was case-sensitive; if the live save reported a faction id as `Rome` while `factionCultures` was keyed by lowercase `rome`, the swap fell back to the unit card. Now lowercases the faction id first, then falls back to the raw key. Pure safety net — doesn't change behavior when culture mapping was already hitting." },
    ],
  },
  {
    version: "0.9.412",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "Bodyguard→face-card swap still didn't fire in 0.9.411 because the lookup keyed via `armiesToRender`, which is field armies only — governors (e.g. Milon in Tarentum) and other characters who aren't commanding a field stack weren't in that list. Switched to `saveCharactersByRegion`, which contains every live character (governor, field general, captain) along with their `secondaryUuid` that matches `unit.commanderUuid` exactly. Now Milon's bodyguard in the garrison and Aulus Gabinius's bodyguard in the field both show their respective face cards. Uses `c.portrait` (the cards path written into the save) as the primary portrait path, with the (x,y)→characterExtras coord bridge layered on top for an engine-exact match when available." },
    ],
  },
  {
    version: "0.9.411",
    date: "2026-05-19",
    items: [
      { type: "fix", text: "v0.9.410 didn't actually swap the bodyguard unit cards for general face cards in most saves. Root cause: the lookup keyed on `commanderUuid → characterExtras.ownUuid` directly, but those are two **different UUID namespaces** — the unit-record commanderUuid is the character's secondary/commander UUID (matches `unit.commanderUuid` in the save body), whereas `characterExtras.ownUuid` is the role-anchored UUID set after the role pstr16. They don't match. Bridge now goes through (x, y) map coordinates: every army has commander coords, every characterExtras entry has `extX/extY`, and a single tile can't hold more than one character — so the coord match is unambiguous. Falls back to IPC's name+faction+age hash-pick from the culture's portrait pool when no characterExtras hit (covers vanilla saves and any RIS character not yet in the role-string roster). Result: every bodyguard unit now shows the general's face card." },
    ],
  },
  {
    version: "0.9.410",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "Every general's bodyguard unit card in the region's garrison + field-army widgets is now replaced with the general's **face card** — the same save-derived portrait the in-game family tree shows. The swap fires when a unit has a `commanderUuid` (= it's a bodyguard) AND the loaded save provided a portrait path for that commander (`characterExtras` hit, via the 0.9.397 (x,y) coord bridge or 0.9.406 RIS culture unlock). Non-bodyguard units stay as regular unit cards. Falls back to the unit card while the portrait blob loads from disk, so the grid never goes blank." },
    ],
  },
  {
    version: "0.9.409",
    date: "2026-05-19",
    items: [
      { type: "feature", text: "Family Tree characters are now clickable. **Left-click** a character card to re-center the tree on that person's family (the tree pivots so they're shown in their immediate household — husband+wife row with children beneath). Works for anyone in the tree — leader, heir, wife, child. **Right-click** opens the same character info panel that's available in the region's Characters list, showing traits, ancillaries, clan/family head, and resolved children. Card cursor changes to pointer and the hover tooltip now mentions the new interactions." },
    ],
  },
  {
    version: "0.9.408",
    date: "2026-05-18",
    items: [
      { type: "improvement", text: "App.js now uses `savePlayerFaction` (cracked in 0.9.407) as a fallback when the save filename doesn't contain a recognizable faction name. Previously, custom-named saves like `My RIS Macedon attempt.sav` showed a `Couldn't identify faction from save name …` toast and required manual picking. Now the player's faction is auto-detected from save bytes regardless of filename. Filename detection still wins when it succeeds (no behavior change for `Autosave Romans_Julii Turn 12.sav` style names)." },
    ],
  },
  {
    version: "0.9.407",
    date: "2026-05-18",
    items: [
      { type: "feature", text: "New `identifyPlayerFactionFromSave()` cracker function returns the player's faction internal name (e.g. `antigonid`, `romans_julii`, `carthage`) from the save alone — no descr_strat needed. Crack: the player's faction record sits BEFORE the 23 NPC major-faction records in save body order, and embeds its `captain_card_FACTIONNAME.tga` banner just like NPC records do. So the only captain banner whose offset is < `factionRecords[0].offset` belongs to the player. Validated on Macedon T0 RIS: 46 total banners scanned, 41 unique factions, only `antigonid` at 0x150c1cc precedes the first NPC record at 0x1538dd8. Exposed as `savePlayerFaction` in IPC. Useful for future UI auto-detection of the player's faction when no descr_strat is loaded, and for cracker work where ground truth was previously user-supplied." },
      { type: "improvement", text: "Documented in memory: 216 minor-faction economic records also exist (each with one captain banner, e.g. acarnania, achaea, acragas, etc.) using the same `+8=100` major-class tag but `+44=8` instead of `+44=6`. Total = 23 major + 216 minor = 239 economic-class records. parseFactionTreasuries still only returns the 23 with the regionCount layout — the minor records use a different inner format and aren't yet parsed." },
    ],
  },
  {
    version: "0.9.406",
    date: "2026-05-18",
    items: [
      { type: "fix", text: "Character-record parser was silently dropping 65% of characters in modded saves. The old `parseCharacterExtras` hardcoded field offsets calibrated for `\"greek general\"` (14-byte role string), but other-length roles like `\"antigonid general\"` (18), `\"barbarian general\"` (18), and `\"carthaginian general\"` (21) shift every subsequent field. Result: in a Macedon T0 RIS save, only 143 of 421 characters were extracted — all the antigonid (player), seleucid, baktrian, cappadocian, sabaean, galatian etc. characters were thrown out at the structural validation step. Fix: compute field offsets relative to `(idx + roleLen)` instead of fixed `idx + 15 / +35 / +37`. Now extracts: 109 greek, 94 seleucid, 34 antigonid (player), 34 roman, 16 cappadocian, 13 sabaean, 12 baktrian, 10 galatian, 10 nabataean, plus 109 more across 22 minor RIS cultures = 421 characters total." },
      { type: "improvement", text: "Crack progress: confirmed via char-roster cross-match that the player's faction is NOT one of the 23 major faction records. The player's antigonid char UUIDs cluster at save offset 0x1517fe3 in Macedon T0, ~132KB BEFORE the first major-faction record at 0x1538dd8. This explains why `identifyFactionRecordOwners` (captain banner counting) only identifies 10/23 records — the player faction lives in a separate section with a different signature than the class-100 NPC records. Future work will locate the player-record section header to expose player treasury/income directly from the save (current Wealth widget fallback computes it via settlement income subtraction)." },
    ],
  },
  {
    version: "0.9.405",
    date: "2026-05-18",
    items: [
      { type: "fix", text: "Wealth widget's live treasury per faction was wrong for RIS imperial saves. The old code assumed the save's 23 major-faction records are in player-first order, but that's NOT true for RIS imperial T0 (rec 0 in a Macedon-player save is actually `carthage`, with `antigonid` somewhere in the unidentified records). New crack: each faction record's body contains `captain_card_FACTIONNAME.tga` paths for its captains, so the most-common faction name inside a record = that record's owner. Backend now extracts `factionRecordOwners` via `identifyFactionRecordOwners()` in `saveCrackerExtras.js`. Wealth widget uses this mapping when available; falls back to the old player-at-idx-0 logic for save formats where banners aren't found. Effect: each NPC faction's wealth row now shows the correct treasury value." },
    ],
  },
  {
    version: "0.9.404",
    date: "2026-05-18",
    items: [
      { type: "improvement", text: "Wired `factionDiplomacy` and `factionTreasuries` from `saveCrackerExtras.js` into App.js state so future panels can consume them. factionDiplomacy gives per-faction relation lists (uuid + class + attitude + tag); factionTreasuries gives full-shape records with offset/regionCount/regionIds. Both extracted on every save load." },
    ],
  },
  {
    version: "0.9.403",
    date: "2026-05-18",
    items: [
      { type: "improvement", text: "Family Tree members now show CURRENT-TURN age and region from the loaded save instead of frozen descr_strat T0 values, when the (x, y) coord bridge hits. The descr_strat data still provides the family-relationship structure (who's married to whom, who's whose child), but age/region come from the save. Falls back to descr_strat values when no save is loaded or the coord bridge doesn't match (typical for later-turn saves where characters have moved)." },
    ],
  },
  {
    version: "0.9.402",
    date: "2026-05-18",
    items: [
      { type: "feature", text: "Per-faction diplomatic relations now extracted via `parseFactionDiplomacy()` in `saveCrackerExtras.js`. Locates the `05 00 24 39` marker at +(244 + 4×regionCount) of each major faction record, reads u32 count + 16-byte entries: `{relationUuid, class (0=ALLIED, 2=WAR), attitudeTier (0-4), tag=0x00010101}`. Macedon T0 vanilla save: 23 records parsed, 240+ relations total across all factions, every tag matches 0x00010101 (100% validation). Exposed as `factionDiplomacy` in IPC return value. LIMITATION: each entry contains the relation UUID but not the OTHER faction's ID — that linkage hasn't been cracked yet (session 108/109 attempted)." },
    ],
  },
  {
    version: "0.9.401",
    date: "2026-05-18",
    items: [
      { type: "improvement", text: "Family Tree dropdown now hides the RIS `dummies` placeholder faction unless the player is actually playing as it. RIS declares dummies with -50000 denari, which auto-bankrupts the faction after end-turn 1; showing it in the family-tree picker for a normal player adds a confusing entry (one character, Biggus_Dickus the Immortal, at off-map coords 998/4) that's destroyed by T2 anyway." },
    ],
  },
  {
    version: "0.9.400",
    date: "2026-05-18",
    items: [
      { type: "feature", text: "New `findRegionRecords(buf)` in `saveCrackerExtras.js` enumerates the save's region records via a paired-self-pointer signature (`u32(P) == P && u32(P + 8) == P + 8`). Returns `{offset, regionUuid, regionId}` per record — region_id matches the IDs in `parseFactionTreasuries`. Macedon T0 yields 426 candidates (375 unique IDs); some are false positives, but the walker unblocks future per-region cracks (population, garrison, building list, etc.)." },
    ],
  },
  {
    version: "0.9.399",
    date: "2026-05-18",
    items: [
      { type: "improvement", text: "Factored the major-faction treasury parser out of `main.js` into `saveCrackerExtras.js` as a reusable `parseFactionTreasuries(buf)` function. Returns an array of `{offset, treasury, turnStartTreasury, netThisTurn, regionCount, regionIds}` per record. Also exposed as `factionTreasuries` in the IPC return so future panels can consume it without duplicating the byte logic. The existing Wealth-widget treasury display continues to work via `treasuryByFaction` for backward compatibility." },
    ],
  },
  {
    version: "0.9.398",
    date: "2026-05-18",
    items: [
      { type: "improvement", text: "Portrait resolver now hits 143/143 (100%) characters via a seed-modulo fallback. For characters whose +280 doesn't match a stored portrait UUID (typically rebels and procedurally-generated chars with a small enumerated seed in +280 instead), the resolver computes `seed % pool_size_per_culture_age` and synthesizes the path. Pool sizes baked in for the six vanilla cultures (greek/eastern/egyptian/carthaginian/barbarian = 188; roman = 479). Marks these results `derived: true` so callers can tell them apart from save-stored paths." },
    ],
  },
  {
    version: "0.9.397",
    date: "2026-05-18",
    items: [
      { type: "feature", text: "Family Tree now uses the EXACT in-game portrait per character when a save is loaded. Bridge: descr_strat character lines have x,y coords; the save's extended character record stores the same coords at +288/+292 alongside a portrait-path UUID at +280. FamilyTree builds a `coordToPortrait` lookup keyed by (x,y) and passes the resolved save path through Portrait → resolve-portrait IPC's fast-path, which loads the exact .tga.dds file. Falls back to the DJB2 hash for chars without a matching save record (most family members, captains, etc.)." },
      { type: "improvement", text: "Portrait cache key now includes savePath / lastName / faction so two same-firstname characters with different save portraits don't collide." },
    ],
  },
  {
    version: "0.9.396",
    date: "2026-05-18",
    items: [
      { type: "feature", text: "Portrait-byte CRACKED. Each character's portrait is identified by a u32 portrait UUID stored at offset +280 of their 354-byte extended record. The portrait pool entries are prefixed by the same UUID, with the pstr16 portrait path 72-74 bytes before. Backend resolver (`resolvePortraitsByCharacter` in `saveCrackerExtras.js`) resolves 134/143 characters in a Macedon T0 save to their EXACT in-game portrait path. Each character in `characterExtras` now has `portraitCardsPath`, `portraitFullPath`, and `portraitUuid` fields when resolved." },
      { type: "improvement", text: "`resolve-portrait` IPC fast-path: if the renderer passes `charContext.savePath` (an exact path from the save), the IPC loads that file directly — no culture mapping or hash fallback. Falls back to existing lookup if the file isn't found. Sets the stage for FamilyTree to render the exact in-game portrait per character on live saves once the renderer plumbs the field through." },
    ],
  },
  {
    version: "0.9.395",
    date: "2026-05-18",
    items: [
      { type: "feature", text: "macOS builds shipping alongside Windows. Provincia is now distributed as both `Provincia Setup X.Y.Z.exe` (Windows installer) and `Provincia-X.Y.Z.dmg` (macOS disk image, universal — x64 + arm64). The Mac build is unsigned (no Apple Developer cert), so first-launch will require a right-click → Open to bypass Gatekeeper." },
      { type: "improvement", text: "Family Tree hover tooltips now include character traits and ancillaries parsed from descr_strat — see at a glance which generals have which traits without leaving the panel." },
    ],
  },
  {
    version: "0.9.394",
    date: "2026-05-18",
    items: [
      { type: "feature", text: "Family Tree cards now show a hover tooltip with full details — display name, role, region, age, and deceased/leader/heir status. Backed by the native `title` attribute so it surfaces immediately without an extra render layer." },
      { type: "improvement", text: "Sibling connector lines redrawn to stop exactly at the centers of the outermost children instead of using a brittle `calc(count * 130px)` width formula that drifted whenever the cards weren't exactly 130 px wide. The horizontal bar is now an absolutely-positioned divider with `left`/`right` insets sized to the child count." },
      { type: "improvement", text: "Live-save flow upgrade: descr_strat `portrait_index N` is already wired through Portrait → IPC → pool lookup, so vanilla characters that specify it (e.g. Vibius Julius) render with their engine-assigned face. Future save-byte crack will reuse the same `explicit` path." },
    ],
  },
  {
    version: "0.9.393",
    date: "2026-05-18",
    items: [
      { type: "improvement", text: "Family Tree now auto-fits the tree to the viewport when it opens and whenever you switch faction or selected general. Wide multi-generation lineages that previously had branches clipped off the sides now render fully visible, scaled down to fit; you can still wheel-zoom in to read the cards. The home button (⌂) re-fits any time you've panned/zoomed away. Min zoom dropped from 30 % to 20 % for the biggest trees." },
    ],
  },
  {
    version: "0.9.392",
    date: "2026-05-18",
    items: [
      { type: "fix", text: "RIS Macedon (and every other non-vanilla `e_hellenistic`/`w_hellenistic`/`libyan`/`iranian`/etc faction) was getting roman portraits because my fallback chain went culture-alphabetical (roman first). RTW itself uses each culture's `\"portrait mapping\"` from `descr_cultures.txt` as the engine-side fallback — `e_hellenistic` → `greek`, `libyan` → `eastern`, `iberian` → `eastern`, etc. Provincia now parses that mapping and uses it as the first-choice fallback when the culture has no portrait pool of its own." },
    ],
  },
  {
    version: "0.9.391",
    date: "2026-05-18",
    items: [
      { type: "fix", text: "Family Tree marble texture was missing — panel rendered as a flat tan fallback. The 0.9.387 `<MarbleBackdrop>` canvas approach hit a load/layout race in production: the cached Image promise resolved to null on first try and stayed null. Reverted to CSS `background-image` (which loads reliably) with the same 12 % black overlay layered via `linear-gradient`. Also fixed a `.//` double-slash in the resolved URL by dropping the leading slash from the concat." },
    ],
  },
  {
    version: "0.9.390",
    date: "2026-05-18",
    items: [
      { type: "improvement", text: "Dead family members now render as the SAME portrait, desaturated (grayscale + dim) — matching RTW's in-game family tree convention. Was a solid black silhouette before, which lost the ancestor's identity." },
      { type: "improvement", text: "Family Tree names strip the descr_strat uniqueness suffix and render with roman numerals — `AntigonosB` → `Antigonos II`, `DemetriosC` → `Demetrios III`, etc. The trailing single uppercase letter (B/C/D/...) is the engine's disambiguator for multiple characters sharing a first name, not part of the display name." },
      { type: "improvement", text: "Family tree cards now always show an `age` line (renders `age —` instead of nothing when the data lacks an age). Mainly affects family members referenced only in `relative` lines without a corresponding `character_record`." },
    ],
  },
  {
    version: "0.9.389",
    date: "2026-05-18",
    items: [
      { type: "feature", text: "Per-character portrait assignment is now stable AND unique: hash key changed from `firstName` alone to `firstName|lastName|faction`, so two characters named \"Antigonos\" no longer collide on the same portrait. Same character always picks the same portrait across sessions, no matter how many namesakes exist in the campaign." },
      { type: "feature", text: "If descr_strat declares `portrait_index N` on a character line (vanilla uses this for `Vibius Julius`; mods can use it for any character), Provincia honors it and picks file `NNN.tga.dds` from the relevant pool directly — bypassing the hash fallback. Same wiring is now in place for the save-stored portrait index once that byte is cracked." },
    ],
  },
  {
    version: "0.9.388",
    date: "2026-05-18",
    items: [
      { type: "feature", text: "Family Tree generals now use the per-character RTW portrait pool — the actual portraits you see in the in-game family tree. Source files live at `data/ui/<culture>/portraits/portraits/{young,old}/generals/NNN.tga.dds` (188 portraits per culture/age bucket). The `.tga.dds` files are LZ4-frame-compressed DDS containing DXT1 texture data — added a full decoder pipeline (`src/portraitDecoder.js`: LZ4 → DDS header → DXT1 blocks → RGBA). Per-character portrait pick is deterministic (DJB2 hash of firstName modulo pool size), so the same general always gets the same face. Age ≥ 35 picks from the `old/` pool, otherwise `young/`. Falls back through vanilla cultures when the requested culture lacks a pool. Decoded results are cached per character, so each portrait only goes through the decode pipeline once per session." },
    ],
  },
  {
    version: "0.9.387",
    date: "2026-05-18",
    items: [
      { type: "improvement", text: "Family Tree marble now pixel-matches the main window. Replaced the CSS `linear-gradient + background-image` approach (which couldn't quite line up tile size and overlay opacity vs the body canvas) with an inline `<canvas>` that reuses the exact `drawBackground` logic from App.js: same tiling at native size, same 12 % light / 45 % dark overlay, same image source. Re-paints on resize and on prefers-color-scheme change." },
    ],
  },
  {
    version: "0.9.386",
    date: "2026-05-18",
    items: [
      { type: "fix", text: "Adult-male portraits in the Family Tree were rendering as solid black boxes. Root cause: the `resolve-portrait` IPC looked for `<culture>/general_portrait.tga` but RTW stores it at `<culture>/portraits/general_portrait.tga` — so the file was never found, and the per-culture fallback chain found nothing either. With the path corrected, greek/eastern/egyptian/etc generals fall back through the chain and pick up roman or barbarian's `portraits/general_portrait.tga` (the only two vanilla cultures that ship one)." },
      { type: "feature", text: "Family Tree button now opens to the CURRENT REGION'S owning faction. Click a province → 👪 → tree opens for that faction (live save owner first, descr_strat starting owner second, region-info faction last). Previously always opened to the faction with the most relatives, requiring a dropdown trip every time." },
      { type: "improvement", text: "Marble background overlay bumped from 12 % to 18 % black so the Family Tree panel reads as the same desaturated cream as the main window instead of raw yellow marble." },
    ],
  },
  {
    version: "0.9.385",
    date: "2026-05-18",
    items: [
      { type: "fix", text: "Family Tree was missing every live general in RIS-style mods. Root cause: `descr_strat.txt` uses `character,\\t` (comma-separated) instead of vanilla `character ` (whitespace), so my `^character\\s+` regex matched zero of the 908 character lines in RIS. With named characters never parsed, the family tree fell back to character_record entries only — which in starting-position descr_strat files are the recently-deceased ancestors of each ruling house (Ptolemaios age 117, Antigonos age 112, etc.). Loosened the separator to `[\\s,]+` so both formats parse." },
      { type: "fix", text: "Generals sidebar now strictly shows alive characters only — dropped the previous fall-back-to-everyone behavior that surfaced 100+ year-old dead ancestors when the live generals couldn't be parsed. With the character-line fix above, the alive list now actually populates." },
      { type: "improvement", text: "Family Tree marble background now matches the rest of the app's hue — added the same 12 % black overlay over `menu_marble_frame.png` that App.js's body canvas applies, so the panel no longer reads as raw-yellow marble. Dropped the gold border frame; Provincia panels don't have one." },
    ],
  },
  {
    version: "0.9.384",
    date: "2026-05-18",
    items: [
      { type: "fix", text: "Family Tree window is now a solid marble panel above the main app, not a see-through `.panel` overlay. Dropped the `className=\"panel\"` translucent-cream approach from 0.9.383 (looked washed-out and let the dimmed map bleed through). The card now uses `menu_marble_frame.png` directly as an opaque tiled background with a dark-gold border frame and a stronger overlay backdrop so the main window is properly dimmed behind it." },
      { type: "fix", text: "Generals sidebar fell back to empty for some factions when the alive-only filter dropped everyone (entries from descr_strat that lack an explicit alive/dead keyword default to true, but mod-side parsing can still produce edge cases). If the alive filter produces zero generals, the sidebar now falls back to the unfiltered list rather than rendering blank." },
    ],
  },
  {
    version: "0.9.383",
    date: "2026-05-18",
    items: [
      { type: "improvement", text: "Family Tree restyled to match the rest of Provincia. Switched the modal card to `className=\"panel\"` so it inherits the global cream-translucent look (rgba(232,222,198,0.45)) over the body marble canvas — same as every widget. Dropped the dark `#1a1a1a` + orange palette from 0.9.382 (looked like a dev modal) and the yellow-tinted marble from 0.9.380 (over-saturated). All inner surfaces (sidebar, viewport, member cards, zoom widget, header) now use cream + dark text with subdued gold borders." },
      { type: "improvement", text: "Member cards now use tall rectangular portraits (in-game family-tree shape) with a thin gold border, name below. Dead members render as solid black silhouettes per RTW's own family-tree convention. The marriage glyph (⚭) renders in the same dark gold as the connector lines." },
      { type: "improvement", text: "Generals sidebar now shows only ALIVE generals (was including dead ones too)." },
      { type: "fix", text: "Family-tree portraits worked only for vanilla cultures (roman, greek, eastern, egyptian, carthaginian, barbarian). RIS-style culture folders (e_hellenistic, w_hellenistic, libyan, iranian, …) had no portrait TGAs, so every card showed a `?` placeholder. The `resolve-portrait` IPC now tries the requested culture first, then falls back through the six vanilla cultures so mod-only cultures inherit generic portraits. Vanilla culture names are RTW engine constants, not faction names, so this respects the no-hardcoded-factions rule." },
    ],
  },
  {
    version: "0.9.382",
    date: "2026-05-18",
    items: [
      { type: "fix", text: "Family Tree sidebar was empty for most factions. Cause: the generals list filtered on `isCharacter`, which only flags entries built from descr_strat `character` blocks; family members declared via `character_record` (the vast majority for non-leader generals) were excluded. Dropped the filter so any of-age male family member shows up." },
      { type: "fix", text: "Family Tree portraits showed `?` placeholders for non-vanilla cultures. The component used a hardcoded faction→culture map (roman/greek/barbarian) that didn't match RIS culture folders (e_hellenistic, w_hellenistic, libyan, …). Now takes the real `factionCultures` map (parsed from descr_sm_factions.txt) as a prop and uses it directly. No more hardcoded faction list — works for any campaign/mod." },
      { type: "improvement", text: "Family Tree window restyled to match the rest of the app: dark `#1a1a1a` background, orange `#e8a030` accent border + title, light text. Dropped the yellow marble panel that didn't belong. Sidebar, member cards, zoom widget and connector lines all moved to the dark Provincia palette." },
    ],
  },
  {
    version: "0.9.381",
    date: "2026-05-18",
    items: [
      { type: "fix", text: "Fixed Family Tree crash: TypeError reading 'origX' on null when releasing the mouse mid-pan. Cause: the setTransform updater closure read dragging.current.origX, but React runs the updater asynchronously, and mouseup nulled the ref before the updater ran. Snapshot the ref into a local before calling setTransform." },
    ],
  },
  {
    version: "0.9.380",
    date: "2026-05-18",
    items: [
      { type: "improvement", text: "Family Tree UI overhauled to match the rest of the app. Dropped the gold border / inset frame styling — the panel now uses a flat marble background with the standard small-caps header, the same look as every other modal in Provincia. The marble texture is fully opaque so it shows through behind the tree." },
      { type: "improvement", text: "Family Tree now uses the actual in-game portrait TGAs. New `resolve-portrait` IPC searches the mod's `data/ui/<culture>/portraits/family/{wife,son,daughter}.tga` first, then falls back to vanilla. RIS reuses the vanilla portraits so RIS factions render with real per-culture portraits. Loaded lazily through the existing TGA decoder + a per-culture/slot cache (src/portraitIcons.js)." },
      { type: "improvement", text: "Family Tree is now zoomable and pannable. Mouse wheel zooms (30%–250%), click-and-drag pans in any direction. A floating zoom widget in the bottom-right shows the current scale with − / + / home buttons. Big multi-generation trees that previously overflowed off-screen are now fully reachable." },
      { type: "feature", text: "Family Tree gained a left sidebar listing every of-age male character (generals + faction leader + heir) with a thumbnail portrait, name, and age. Leader 👑 / heir ★ pinned to the top; remaining generals sorted by age desc. Clicking a general focuses the tree on the family branch they belong to — useful for factions with multiple descent chains." },
    ],
  },
  {
    version: "0.9.379",
    date: "2026-05-18",
    items: [
      { type: "improvement", text: "Family Tree redesigned to look like the in-game RTW family tree. Marble parchment background, ornate gold border, small-caps title bar. Vertical hierarchical layout: root patriarchs at top, spouses next to them with a ⚭ glyph, children rendered below connected by gold lines. Recursive — adult children who are themselves heads of families get their own sub-trees, so multi-generation families (faction founder → heir → grandchild) render top-down. Inline-SVG silhouette portraits per category (adult male / wife / male child / female child) — RTW reuses the same stock portrait for wives and same again for child portraits split by gender, so silhouettes are a faithful placeholder until the portrait-index byte is cracked. Dead family members fade to BLACK (matching the in-game greying-out). Uses faction display names from the mod's `descr_sm_factions.txt` in the picker dropdown so Romans Julii reads as `Republic of Rome`." },
      { type: "improvement", text: "Backend extracts per-settlement religion-mix bytes (6 bytes = one per religion in descr_religions, sums to ~95-105). Scanner runs forward from each settlement's name position looking for the religion 6-byte signature. Available as `religionByCity` in parseSaveData() — keys settlement names to { dx, sum, bytes[6] }. Per-settlement religion-bar UI to follow." },
    ],
  },
  {
    version: "0.9.378",
    date: "2026-05-18",
    items: [
      { type: "improvement", text: "Family Tree now works in mod-data mode too — no live save required. main.js extracts `character_record` + `relative` blocks from descr_strat (per faction), exposed via new get-descr-strat-families IPC. The Family Tree panel shows husband/wife pairs with children grouped under each family card, plus an `unattached characters` section for solo named characters (diplomats, spies, admirals). Faction picker dropdown across the top — defaults to the first faction with relatives. Dead family members render dimmed. Live save data still takes precedence when loaded." },
      { type: "improvement", text: "Moved the 👪 Family Tree button out of the floating top-right corner and into the Characters widget header, where it belongs. Appears whenever family-tree data is available (live save OR mod-data fallback)." },
    ],
  },
  {
    version: "0.9.377",
    date: "2026-05-18",
    items: [
      { type: "feature", text: "New Family Tree panel. Floating 👪 button in the top-right opens a modal listing every character extracted from the save — name (via role), age, region, marriage status. Grouped by culture, filterable by region / role / UUID. Marriages show the spouse inline if their record is in the role-string set; otherwise the husband still flags as ⚭ married with the spouse UUID. Reads characterExtras + familyTreeMaps already exposed in 0.9.376's parser. Family-tree row/edge rendering will follow once the v1 character parser is wired into the same map so child-of-father lookups light up." },
    ],
  },
  {
    version: "0.9.376",
    date: "2026-05-18",
    items: [
      { type: "improvement", text: "Backend now extracts every save-file field cracked in the past few days, so future features can use any of them without re-cracking. New src/saveCrackerExtras.js consolidates the readers: save header (magic, campaign UUID, save version, campaign-type flag, 3-part content hash, session timestamp, campaign name), faction-discovered bitmask (per-faction encounter flags, byte-packed at name_end+19, count varies by campaign — 30 bytes for RIS imperial / 3 bytes for vanilla), faction-config 53-byte records (one per faction, byte +29 = roster index or 21 = slave-merged), mod display name (UTF-16 at 0x326d, e.g. \"[BETA] RTR: Imperium Surrectum 0.7.0\"), mod content hash IDs (UTF-16 at 0x32c2), mod path (already had it), action/RNG counter at 0x43f8, per-character anchored on `<culture> <role>` ASCII pstr16 with own_uuid (role+15), bodyguard_uuid (role+19), region name UTF-16 (role+35 length, role+37 chars), spouse_uuid (role+37+2L+4 — variable offset based on region name length), age in years (role+37+2L+12), family-tree maps (byUuid / spouseOf / childrenOf). All exposed in parseSaveData() return value as saveHeader / factionDiscovered / factionConfig / modInfo / characterExtras / familyTreeMaps. Existing parsers untouched; cracker extras are additive." },
    ],
  },
  {
    version: "0.9.375",
    date: "2026-05-17",
    items: [
      { type: "feature", text: "Alexander campaign now displays per-settlement tax level, public order, population, income and current level — previously only imperial_campaign and ris_classic surfaced these. New offsets from save-cracker session 2026-05-17 sit at the SHORT end of each settlement's stats block (name-562 tax, name-435 PO, name-127 income, name-35 population, name-571 level — all u32 except tax which is u8). Validated against the Macedon turn 1 base vs `taxes increased in Pella` save (Pella tax 1→2) and `taxes lowered in Sparta` save (Sparta 1→0): exactly one byte change at the predicted offset. Cross-checked across 9 Alexander settlements and 5 RIS Spain settlements — same layout works for both, so the new path is unconditional (no campaign-name gate). Existing imperial_campaign / ris_classic offsets are untouched; the short-block reads run in parallel and only fill in when the long-block path didn't already." },
    ],
  },
  {
    version: "0.9.374",
    date: "2026-05-16",
    items: [
      { type: "improvement", text: "Character region now read save-direct (save-cracker session 110). Each character has a companion metadata record (`ef 00 00 00 <uuid>` + ASCIIZ class string + UTF-16 region name) keyed by the same UUID as the position record. main.js's parseCharacterMetadataByUuid extracts these and uses them as the primary region source, falling back to the bodyguard-unit derivation when missing — fixes captains-without-bodyguard and in-transit characters whose previous region was null. Validated 100% hit rate on 16 saves (halo + 15 fixtures): every <faction>-general/captain/admiral/diplomat/spy/etc record has both a region and a matching position record by UUID. Also exposes c.characterClass (e.g. \"roman general\") for future UI use." },
    ],
  },
  {
    version: "0.9.372",
    date: "2026-05-16",
    items: [
      { type: "feature", text: "New `Explored` map mode (Ctrl+6) — surfaces the player's ever-explored tile grid decoded from the save (session 103 finding). Regions you've seen at any point paint in their normal owner colour; regions you've never explored are dimmed 70 % toward black so the unexplored shadow is unmistakable. Reads the 510×1400 RLE grid from the player faction record's first 49,740 bytes after the 24 B header. Updates live when you load a new save." },
    ],
  },
  {
    version: "0.9.371",
    date: "2026-05-16",
    items: [
      { type: "feature", text: "Loyalist map mode now cross-checks the rebel-default against descr_strat's faction_creator (computed live from the same alignment logic as the user's faction_summary.txt). MATCH regions paint at full saturation in their rebel-default colour; MISMATCH regions (rebel_default ≠ faction_creator, i.e. the loyalist revolt would defect to a different faction than the original creator — a mod-data integrity bug) get mixed 45 % toward grey so they're visibly dimmed but still keyed to the rebel-default colour." },
      { type: "improvement", text: "Loyalist legend shows match / mismatch counts. Header summary `✓ N ✗ M — XX% aligned`; per-faction rows show ✓N ✗M chips next to each entry. Hover an entry for a tooltip explaining what the counts mean. Lets you spot mod-design issues at a glance without running the user's Python report script." },
    ],
  },
  {
    version: "0.9.370",
    date: "2026-05-16",
    items: [
      { type: "fix", text: "Turn/year badge fixed for RIS imperial saves. The old `readTurnFromSave` / `readCurrentYearFromSave` read u32 @ 0xf80 / int32 @ 0xf84 — those offsets are all zeros in every RIS sample, so every save showed `T1 · 0 AD` regardless of when it was saved. Save-cracker session 104 (commit `b5b2b1e`) pinned the correct location via full-file intersection scan across 10 known-turn saves: turn at `0x44e3` (u32 LE = turn-1), current year at `0x44e7` (i32 LE, negative for BC). Verified 0/1/4/10/20/21 in T0/T1e/T5/T11s/T21/T22 respectively. Provincia now reads from the right place." },
    ],
  },
  {
    version: "0.9.369",
    date: "2026-05-16",
    items: [
      { type: "feature", text: "Loyalist map mode has a legend sidebar now — same pattern as Faction/Culture/Religion. Lists every descr_regions rebel-default faction with its primary colour and province count; click an entry to highlight every region whose rebel-default is that faction. Shift+click for multi-select." },
      { type: "feature", text: "Right-click a province in Loyalist mode to reassign its rebel-default faction (works without dev mode). New `rebel_default` edit field updates ONLY the descr_regions field 3 — the current owner stays put. Edits flag descr_regions.txt dirty for export." },
      { type: "feature", text: "Search bar now matches faction names too. Type a faction's id or display name and you'll see an amber-tinted 🏛 row — clicking it selects every province owned by that faction and pans to the cluster centroid. Province matches still appear below." },
    ],
  },
  {
    version: "0.9.368",
    date: "2026-05-16",
    items: [
      { type: "feature", text: "New `Loyalist` map mode — paints every region by its `descr_regions` faction (field 3), i.e. who'd take the settlement if it rebelled. Reveals the 'shadow map' of latent rebel-default claims under the current ownership. Uses each rebel-default faction's primary colour from descr_sm_factions. Slots into the map-mode pill between Religion and Population (Ctrl+5 shortcut)." },
      { type: "improvement", text: "Garrison widget shrank to fit the actual 10×2 = 20-card grid (h trimmed from 0.190 to 0.134). The reclaimed vertical space went to Field armies, which now starts at y=0.6509 with h=0.3441 (was 0.7069/0.2881) — extra room to render many field stacks before scrolling. LAYOUT_VERSION 10; migration applies on next launch." },
    ],
  },
  {
    version: "0.9.367",
    date: "2026-05-16",
    items: [
      { type: "feature", text: "Save-cracker session 101: pinned per-character position + movement-points record (STRONG). Each character's secondaryUuid keys a 60-byte field-army record holding tile x/y and MP-remaining at +58 as an unaligned f32. Verified on a controlled 1-tile move save pair: Manius Aemilius Paullus 248.0 → 239.2 MP (Δ −8.8 per tile). characterParser now exposes c.tileX, c.tileY, c.mpRemaining, c.maxMP on every character with a valid pos record (547/936 in the RIS save — wives/children/non-army agents fall through). Parser-only — no UI surface yet." },
    ],
  },
  {
    version: "0.9.366",
    date: "2026-05-16",
    items: [
      { type: "fix", text: "Garrison card size regression from 0.9.362. Cards were filling the widget (1fr × 1fr) and ballooning past their original 28-px footprint. Capped back to `minmax(0, 32 px)` columns with min-content rows — cards stay compact regardless of widget size, just like before." },
    ],
  },
  {
    version: "0.9.365",
    date: "2026-05-16",
    items: [
      { type: "improvement", text: "Gap bumped to 9 px on both axes (was 5). Horizontal fraction 0.0047, vertical 0.0083 — equal pixels. Bottom strip (search / factions / selected provinces) now sits exactly 9 px below the map's bottom edge — the same gap they keep with each other horizontally. LAYOUT_VERSION 9; migration applies on next launch." },
    ],
  },
  {
    version: "0.9.364",
    date: "2026-05-16",
    items: [
      { type: "improvement", text: "Uniform 5-PIXEL gaps between every widget on both axes. Horizontal fraction ≈ 0.0026 (5/1920), vertical fraction ≈ 0.0046 (5/1080) — different fractions, same pixel size, visually consistent. LAYOUT_VERSION bumped to 8 so the new canonical applies on next launch (overwrites any custom positions)." },
    ],
  },
  {
    version: "0.9.363",
    date: "2026-05-16",
    items: [
      { type: "feature", text: "Map canvas now auto-shrinks to fit around Movable widgets. handleResize subscribes to widget-position changes; whenever you drag a widget toward the map, the canvas trims to keep a 6 px gap with that widget instead of letting the map overlap the UI. Lookups are heuristic — widgets with y<0.5 + x>0.1 cap the map's right edge; widgets with x<0.5 + y>0.1 cap the bottom. No more map-over-UI." },
    ],
  },
  {
    version: "0.9.362",
    date: "2026-05-16",
    items: [
      { type: "improvement", text: "Map grows larger. Bottom-strip reserved height trimmed (REGIONINFO_HEIGHT 320 → 270) so the canvas claims the extra vertical room. At 1920×1080 the map gets ~50 extra pixels of height to work with." },
      { type: "improvement", text: "Uniform 5 px gaps between widgets on both axes — matches the tight factions↔selected horizontal gap. Region info column vertical gaps shrank from ~14 px to ~5 px so the left side feels as tight as the bottom strip." },
      { type: "improvement", text: "Buildings widget no longer shrinks cards aggressively. Grid uses `auto-fill, minmax(60px, 1fr)` with fixed 80 px rows; cards stay readable, and the widget scrolls vertically when the 20-slot grid can't fit at the minimum size. Empty slot placeholders preserved." },
      { type: "fix", text: "Garrison widget now reserves a stable 10×2 = 20-slot grid (max stationed units in a settlement). Empty slots render as faint dashed placeholders below the actual units." },
      { type: "improvement", text: "Factions legend on the map sidebar now has a fixed header + scrolling body (matching the bottom-strip Factions widget). Title and search input stay put while the faction list scrolls." },
      { type: "feature", text: "Smooth iOS-style transition when Movable widgets snap-to-align, get pushed by collision, undo, or migrate. Uses `cubic-bezier(0.16, 1, 0.3, 1)` over 240 ms; transitions disable during active drag so mouse-follow stays instant. LAYOUT_VERSION bumped to 7." },
    ],
  },
  {
    version: "0.9.361",
    date: "2026-05-16",
    items: [
      { type: "fix", text: "Region info / Build queue / Unit queue widget content was flush against the panel's rounded corners. Wrapped each one's body in a 14 px-padded scroll container so titles and chips clear the curve like every other widget." },
      { type: "change", text: "Recent regions + Summary button merged INTO the Selected provinces widget as a fixed top row. The old `bottom.recent` Movable is gone (migration drops its localStorage entry). Selected provinces widget is now taller (h=0.295 from y=0.700) so the merged content fits — gives the province list more room than the previous 3-row stack." },
      { type: "change", text: "Factions widget pulled up closer to the Search widget — default position bumped from y=0.753 to y=0.744 so the two share the same tight gap as other adjacent widgets." },
    ],
  },
  {
    version: "0.9.360",
    date: "2026-05-16",
    items: [
      { type: "improvement", text: "Every widget with a header now has a FIXED header and a SCROLLING body — Recruitable, Buildings, Characters, Garrison, Field armies, and the Factions panel. Previously the header scrolled with the content; now the title and any header buttons stay put while the inner list/grid scrolls inside the widget." },
      { type: "fix", text: "Section titles (`Buildings:`, `Recruitable:`, etc.) were being clipped by the panel's 12 px rounded corners. Panel-tight 2 px padding replaced with proper 14 px horizontal header padding; titles now sit safely past the curve." },
      { type: "change", text: "Search widget chrome removed — just the input now, no surrounding cream panel + extra padding. Looks like a single bar at the top of the bottom strip." },
      { type: "improvement", text: "Canonical layout v5 snapped to the user's hand-tuned 2026-05-16 positions: region.info trimmed to h=0.329 to make room for the taller region.characters (h=0.155) between info and buildings; queue/unitQueue widened to match characters height. Bottom-strip widget rows aligned on y=0.700 (search/recent) and y=0.753 (factions/selected) with ~13 px vertical and ~15 px horizontal gaps. Migration runs on next launch (LAYOUT_VERSION=5)." },
    ],
  },
  {
    version: "0.9.359",
    date: "2026-05-16",
    items: [
      { type: "feature", text: "Bottom-strip pieces are now all Movables — `bottom.search`, `bottom.factions`, `bottom.recent`, `bottom.pinned`, `bottom.selected`. The old non-Movable CSS-grid container is gone; each section is independently draggable/resizable in design mode. Migration v4 seeds default positions matching the previous strip layout." },
      { type: "change", text: "Search bar is its own widget above the factions panel (not nested inside it). The factions header sits closer to the top edge of the widget — horizontal padding bumped to 14 px so the title clears the panel's 12 px corner curve without being clipped." },
      { type: "improvement", text: "Selected provinces widget now has a fixed header + scrolling body. The label, Deselect All button, and victory-mode toolbar stay put while the province list scrolls inside the widget. Header gets 14 px horizontal padding so it clears the rounded corners." },
      { type: "improvement", text: "Character stats sanity gate widened from 0..15 to 0..30. Trait-stacked late-game generals (FactionLeader, military traits) can push command/influence past 15; the old gate was nulling valid stats and showing ? everywhere. Garbage reads (offset drift = huge values) still get filtered." },
      { type: "improvement", text: "Bigger vertical gaps between widget rows in the canonical layout (matching the ~13 px horizontal pixel spacing) and slightly shorter `region.info`/`region.recruit` so the 3-row left column fits without being cramped." },
    ],
  },
  {
    version: "0.9.358",
    date: "2026-05-16",
    items: [
      { type: "fix", text: "Left-side widgets (Region info / Characters / Buildings) couldn't be edited in design mode because the map canvas was sitting on top of them. Migration v3 now also writes `layout.rightColPct = 0.428` so the map is sized to leave room for the canonical widget grid — widgets at x≈0.572 onward are now fully past the map's right edge." },
      { type: "improvement", text: "Visible horizontal spacing between adjacent widgets. Canonical defaults bumped from a 6.7 px (= GAP_FRAC) divider to ~10 px between info|recruit, characters|queues, buildings|garrison, and unitQueue|queue. The minimum forced gap from collision/clamp logic stays at 6.7 px — defaults just leave more breathing room." },
      { type: "improvement", text: "Region info widget made taller in the canonical layout (h=0.40 instead of 0.33). Fits worst-case region data — many ethnicity chips, several tag-category rows, hidden-resource chips, plus population/happiness/tax/income lines — without forcing the user to scroll inside the widget. LAYOUT_VERSION bumped to 3, migration runs on next launch." },
      { type: "change", text: "Removed the Fertility chip from the tag list — it was duplicating the colour-graded `Fertility:` line that already shows above the tag groups (Farm## token). One less redundant row in the Region info widget." },
    ],
  },
  {
    version: "0.9.357",
    date: "2026-05-16",
    items: [
      { type: "change", text: "Unified search bar. The dedicated province search in the bottom strip was removed; the factions panel's search input is now the global search — placeholder `Search... (Ctrl+F)`, filters faction list AND surfaces a province-results dropdown for jump-to-and-select. Same input, both behaviours, one less control to find." },
      { type: "change", text: "Summary toggle moved up to the Recent regions row in the bottom-strip right column. Was buried below the selected list before. Recent regions row now also serves as a quick toolbar (Recent chips + clear + Summary button)." },
      { type: "change", text: "Deselect All button moved up to the Selected Provinces header (same row as the title), not in a separate row above the list. Compact." },
      { type: "fix", text: "Selected provinces list no longer overflows horizontally — switched from a 2-row horizontal-scroll grid to a wrapping flex layout. Items wrap to new rows when they run out of horizontal space; vertical overflow scrolls with the scrollbar hidden globally." },
      { type: "improvement", text: "Layout defaults snapped to a canonical grid based on the user's saved positions. Every widget on the left half shares x=0.5696 / w=0.2243, every widget on the right half shares x=0.7974 / w=0.1991, with row anchors at y=0.0056 / 0.3148 / 0.4573 and GAP_FRAC between rows. A one-time migration overwrites stale localStorage on first launch of 0.9.357 (LAYOUT_VERSION bumped to 2) so existing users get the cleaned grid automatically." },
      { type: "change", text: "Character entries in the Characters widget always show ⚔ command/influence/management/loyalty stats after age. Previously the whole block was hidden when stats were undecoded; now it falls back to `?` for missing fields so the row layout stays consistent." },
    ],
  },
  {
    version: "0.9.356",
    date: "2026-05-16",
    items: [
      { type: "improvement", text: "Forced gap now applies to the app window edges too. Movable widgets can't be pushed/resized into touching the screen border — same ~6.7 px aura they keep with each other and with the map." },
      { type: "change", text: "Selected provinces list now flows in 2 horizontal rows with column auto-flow. Long lists scroll horizontally instead of stretching down the panel — much shorter vertical footprint, each entry's drag handle preserved." },
      { type: "change", text: "Search bar and Recent regions now share one row at the top of the bottom-strip right column. Search keeps a fixed 220 px width on the left; Recent flexes to fill the rest with horizontal scroll. Saves a full row vs the old stacked layout." },
    ],
  },
  {
    version: "0.9.355",
    date: "2026-05-16",
    items: [
      { type: "improvement", text: "Forced gap now applies to the map too. The map canvas registers itself as a virtual widget in the snap/collision registry, so Movable widgets can't overlap it and keep the same ~6.7 px aura between their edges and the map. They also snap-align to the map's edges and center for free." },
    ],
  },
  {
    version: "0.9.354",
    date: "2026-05-16",
    items: [
      { type: "improvement", text: "Forced gap between Movable widgets. Each widget is treated as having a ~6.7 px aura on every side when checking collisions; pushes and resize clamps leave at least that much air between adjacent rects. Matches the existing MAP_PADDING / PANELS_GAP between the map and the top bar so widgets share that visual rhythm instead of butting up against each other." },
    ],
  },
  {
    version: "0.9.353",
    date: "2026-05-16",
    items: [
      { type: "fix", text: "Removed the leftover yellow striped splitter handles around the map's right edge, the map's bottom edge, and between the factions / selected-provinces panels. Those were obsolete from before the Movable widget system but were still being rendered in design mode and overlapping widgets visually." },
      { type: "improvement", text: "Cyan alignment guides now show on BOTH axes at once when applicable. Previously guides only fired for the single nearest snap target on each axis — and only within the tight 6 px snap pull-in. Now any alignment within ~15 px lights up a guide, so you see vertical AND horizontal guides simultaneously when you're aligned both ways. Multiple guides on the same axis also stack (e.g., your left edge aligns with one widget while your right edge aligns with another)." },
      { type: "feature", text: "Center crosshair on every widget in design mode — small cyan + at each widget's geometric center, visible at all times (not just during drag). Lets you eye up center-to-center alignments before you start moving. Snap already targeted centers; this just makes them visible. Works on both axes — center-to-center on X (vertical line) and on Y (horizontal line)." },
    ],
  },
  {
    version: "0.9.352",
    date: "2026-05-16",
    items: [
      { type: "feature", text: "Movable widgets now refuse to overlap. As you drag or resize, any rectangle that would collide with another widget gets pushed along the shallower axis so panels end up edge-adjacent instead of stacked on top of each other. Resize ops shrink the moving edge instead of pushing through." },
      { type: "feature", text: "Cyan snap-alignment guide lines appear while you drag/resize. A 1 px vertical or horizontal line lights up whenever your edge or centerline matches another widget's. Lines clear on mouseup." },
      { type: "feature", text: "Hold Shift while dragging or resizing to bypass snap-to-align — useful when snap is fighting your placement. Collision avoidance still applies (you can't overlap regardless)." },
      { type: "feature", text: "↶ Undo button next to ↺ Reset in design mode. Keeps a 30-step history of layout snapshots (one per drag/resize start); undoing rewinds every widget to its previous position/size in one go, no reload required." },
      { type: "improvement", text: "Reset now asks for confirmation before wiping the layout (it reloads and is irreversible). Undo for everything else." },
    ],
  },
  {
    version: "0.9.351",
    date: "2026-05-16",
    items: [
      { type: "change", text: "Design-mode chrome removed entirely — no more yellow header bar, no corner squares. The whole widget surface is now an invisible drag overlay; cursor changes (move / nw-resize / ew-resize / etc.) tell you what'll happen based on where the mouse sits. Inner 10 px = resize, everything else = drag. Widget content stays fully visible while you move things around. Only chrome left in design mode: a tiny semi-transparent widget-id label in the top-right corner, so overlapping widgets are still identifiable." },
    ],
  },
  {
    version: "0.9.350",
    date: "2026-05-16",
    items: [
      { type: "fix", text: "App was crashing on startup in 0.9.349 — `ReferenceError: useEffect is not defined` from the buildings ResizeObserver effect. RegionInfo.js was using useEffect without importing it. Fixed the import." },
      { type: "feature", text: "Widget layout is now logged to provincia.log. Every drag/resize end emits a single `WIDGET-LAYOUT (drag|resize) {…}` JSON line via the existing log-message IPC; a `(boot)` snapshot also fires 1.5 s after first widget mount so the log captures the active layout from the moment the app launches. Lets the dev pick up the user's saved layout from the log and bake it into the source as the new default." },
    ],
  },
  {
    version: "0.9.349",
    date: "2026-05-16",
    items: [
      { type: "feature", text: "Movable widgets now snap-to-align while dragging or resizing — edges and center-lines magnetically lock to other widgets' edges/centers within ~6 px. Silent for now (no guide line), just a magnetic feel that makes it easy to line panels up." },
      { type: "improvement", text: "Drag/resize chrome trimmed back so widget content stays visible while moving things around. Yellow striped header (12 px) replaced with a 6 px semi-transparent golden bar; corner handles shrank from 12 px to 8 px; the title moved to a small label tucked into the top-right corner instead of the center of the header." },
      { type: "improvement", text: "Widget panels now use the global `.panel` style (cream, like the factions panel) instead of the dark `rgba(20,20,20,0.55)` background. The existing light-mode contrast observer in App.js automatically darkens any bright text inside, so the widgets read like the rest of the panels." },
      { type: "improvement", text: "Buildings widget no longer hard-codes 10×2. Layout adapts to the widget's aspect ratio (10×2 when wide, 4×5 when square, 2×10 when tall, etc.) while always reserving 20 slots — empty slots render as faint dashed placeholders so the grid shape doesn't jump as buildings come and go. Uses a ResizeObserver on the grid container to recompute on every resize." },
    ],
  },
  {
    version: "0.9.348",
    date: "2026-05-16",
    items: [
      { type: "feature", text: "New Unit queue Movable widget (id `region.unitQueue`). Shows units currently being recruited in the selected settlement, decoded from the save's recruit chain (session 36). Sits next to the Build queue widget by default." },
      { type: "change", text: "Garrison and field armies are now separate Movable widgets (id `region.garrison` and `region.fieldArmies`) instead of sharing one Armies panel. Default positions split the old armies slot horizontally — garrison on the left half, field armies on the right." },
      { type: "improvement", text: "Building, recruit, garrison, and field-army card grids now scale with their widget size. Columns switched from fixed-pixel caps (`minmax(0, 52px)` / `minmax(0, 28px)` / `maxWidth: 60`) to `1fr` — make a widget wider/taller and the icons grow to fill, the same way the faction-icon panel does. Cards keep their portrait aspect (164:224 for units) and building icons use `objectFit: contain` so they stay readable at any size." },
      { type: "improvement", text: "RegionInfo panel inner box now flex-column with `flex: 1` on the grid bodies, so card grids fill remaining vertical space after the section header instead of collapsing to content height." },
    ],
  },
  {
    version: "0.9.347",
    date: "2026-05-16",
    items: [
      { type: "feature", text: "Freeform widget layout — iteration 1. The 4 RegionInfo sections (Region info, Recruitable, Buildings, Armies) plus Characters and Build Queue are now each independent Movable widgets. Toggle 📐 Layout to reveal each widget's golden drag-header (top edge) and 4 corner resize handles + side edges. Drag to move; corners/edges to resize. All positions store as percent-of-viewport so they stay proportional across window resizes and monitor switches. ↺ Reset clears every widget override + the older splitter overrides (reloads the page to snap back to defaults)." },
      { type: "change", text: "RegionInfo's outer panel + CustomScrollArea wrapper removed — each section is its own floating widget now, so the surrounding 'big right-column panel' frame went away. Default positions are seeded from the old grid so the visual at first launch matches the previous layout." },
      { type: "change", text: "Iteration 1 covers the RegionInfo sub-sections. Future iterations: bottom-strip pieces (factions / search / recent / pinned / selected provinces), top toolbar buttons, and individual buttons elsewhere." },
    ],
  },
  {
    version: "0.9.346",
    date: "2026-05-16",
    items: [
      { type: "fix", text: "Buildings grid no longer spills off the right edge of the RegionInfo panel. Columns switched from fixed `repeat(10, 82px)` (which needed 856 px to render all 10 columns) to fluid `repeat(10, minmax(0, 1fr))` so the row always fits the panel; building icons scale down with the card width (capped at 60 px) instead of overflowing. At 1080p the cards still hit ~80 px so visual density is unchanged on standard layouts." },
      { type: "improvement", text: "Recruitable list capped at ~4 rows tall (312 px) — extra units scroll vertically rather than push the rest of row 1 around. Scrollbar is hidden globally (App.css), so the scroll behaves like a soft fade with no visible chrome." },
    ],
  },
  {
    version: "0.9.345",
    date: "2026-05-16",
    items: [
      { type: "improvement", text: "Live layout design mode now lets you resize the internal sections too, not just map vs panels. Toggle 📐 Layout and three extra golden dotted handles appear inside the RegionInfo panel (info|recruit vertical split + two horizontal splits between info-row / buildings / armies) plus one vertical handle in the bottom strip between the factions column and the selected-provinces column. Every override persists via localStorage and the ↺ Reset button now clears all six." },
      { type: "fix", text: "App now opens at true 1080p by default — added `useContentSize: true` to the Electron BrowserWindow so width/height (1920×1080) refer to the renderer/content area, not the outer frame. Previously the actual canvas was a few rows shorter than 1080p on Windows because the title bar ate into the requested height." },
    ],
  },
  {
    version: "0.9.344",
    date: "2026-05-15",
    items: [
      { type: "feature", text: "Live layout design mode. Click the 📐 Layout button (bottom-right, next to mute) to reveal two golden dotted splitter handles — one along the right edge of the map (drag horizontally to resize the right column / RegionInfo) and one along the bottom edge of the map (drag vertically to resize the bottom factions/selected strip). The map shrinks or grows to fill remaining space. Sizes persist across sessions via localStorage. ↺ Reset button appears once you've moved anything." },
    ],
  },
  {
    version: "0.9.343",
    date: "2026-05-15",
    items: [
      { type: "change", text: "Region panel now uses a 4-section 3-row layout: Row 1 = region info (240 px) + recruitable (rest of width). Row 2 = buildings 10×2 full width (max 20 slots, every slot reachable without scrolling if column fits). Row 3 = garrison + field armies full width. Lets each section breathe — recruit no longer cramped, buildings keep their classic 10-wide grid, armies stretch out." },
    ],
  },
  {
    version: "0.9.342",
    date: "2026-05-15",
    items: [
      { type: "change", text: "Region panel inner layout switched from 4-column-strip to 2-row layout. Row 1: region details + buildings. Row 2: recruitable units + garrison/field armies (the 'unit bits' moved under everything else). Uses grid-template-areas so the layout is declarative. Recruit and armies now each get half the width instead of a tight side-column." },
    ],
  },
  {
    version: "0.9.341",
    date: "2026-05-15",
    items: [
      { type: "change", text: "UI reshuffle v2 — RegionInfo now occupies an L-shape (entire right column + bottom-right corner). The bottom strip (factions + selected provinces) shrinks to just the width under the map, leaving the bottom-right free for RegionInfo to extend into. Buildings grid switched from 10×2 to 5×4 to suit the narrower-taller column. Inner RegionInfo column widths tightened (240 / 430 / 220+ / 240+ instead of 240 / 860 / 260+ / 280+)." },
    ],
  },
  {
    version: "0.9.340",
    date: "2026-05-15",
    items: [
      { type: "change", text: "Major UI reshuffle. The faction icons + selected provinces + search + recent regions moved from the right column to a bottom strip; the Region panel (which kept growing — buildings, recruitable, garrison, characters, queues, etc.) is now in the right column where it has room to breathe. Revert path if it doesn't work for you: `git checkout pre-ui-reshuffle-v0.9.339` (tag pushed before the change)." },
    ],
  },
  {
    version: "0.9.339",
    date: "2026-05-15",
    items: [
      { type: "feature", text: "Character rows in the Region panel now show command / influence / management / loyalty stats from the save (⚔ 7/6/4/5 format). Decoded from save-cracker session 91 — a 4-u32 cluster framed at character record +96 (u16=23) and +98 (u32=50), with the stats themselves at +102/+106/+110/+126. Falls back gracefully on LAYOUT_B characters and on saves where the cluster reads outside the 0..15 sanity range." },
    ],
  },
  {
    version: "0.9.338",
    date: "2026-05-15",
    items: [
      { type: "fix", text: "Hidden Resource classifier uses the actual RIS naming conventions. `homeland_*` prefix → Homeland, `aor_*` prefix (or `_aor` suffix) → Area of Recruitment, everything else → Other. Previous heuristic looked for membership in homelandsData / ethnicSet / settlementSet and missed every real RIS homeland tag because the values in homelands.json are bare faction stems (akragantine, tarentine) while descr_regions uses the qualified `homeland_*` form." },
    ],
  },
  {
    version: "0.9.337",
    date: "2026-05-15",
    items: [
      { type: "improvement", text: "Hidden Resource legend separates Homeland and Area of Recruitment groups. The 'Faction' bucket was a misnomer — it actually held homeland tokens (akragantine, tarentine, etc.), so it's now labelled 'Homeland'. AoR tokens (`*_aor`) sit in their own dedicated group above. Classification order swapped so a `*_aor` token can never be misbucketed as homeland." },
    ],
  },
  {
    version: "0.9.336",
    date: "2026-05-12",
    items: [
      { type: "feature", text: "Ctrl-Z / Ctrl-Y (and Ctrl-Shift-Z) for map paint. Each paint click is recorded as a stroke entry — the BEFORE state of every pixel it touched. Undo replays that exact before-state onto the base + colored overlay + visible canvases. Redo reapplies the stroke. The Map Paint sidebar gains Undo / Redo buttons that show the stack depth." },
    ],
  },
  {
    version: "0.9.335",
    date: "2026-05-12",
    items: [
      { type: "improvement", text: "Paint clicks bypass React state — pixel updates blit directly onto the visible canvas instead of triggering the full component re-render that was happening on every stroke. Drag-painting now feels native." },
      { type: "fix", text: "Reset captures the colored-overlay value on first edit and replays both raw RGB AND recoloured RGB back into the canvases, painted directly onto the visible canvas for instant revert. No more 'reset did nothing' state." },
      { type: "feature", text: "Brush hover preview — paint mode shows a yellow outline at the cursor sized exactly to the active brush (1×1 / 3×3 / 5×5), so you can see what pixels will be painted before clicking." },
      { type: "feature", text: "New 'Region' map mode — alphabetical legend of every region in the campaign with its raw map_regions.tga RGB swatch. Click a row to zoom to + highlight that province (shift-click for multi-select). Mirrors the Victory mode UX but at region granularity." },
    ],
  },
  {
    version: "0.9.334",
    date: "2026-05-12",
    items: [
      { type: "fix", text: "Map Paint Reset now actually reverts pixels. Was previously only clearing the edits-map (the in-place pixelDataRef + offscreen mutations stayed). Now each edit captures the original RGB on first paint, and Reset replays those originals back into the base + colored overlay canvases." },
    ],
  },
  {
    version: "0.9.333",
    date: "2026-05-12",
    items: [
      { type: "improvement", text: "Map paint is now responsive. Each click previously triggered a full ~100-200 ms recolouring of the 714k-pixel overlay AND a per-pixel border-paths rescan — so any drag-paint felt molasses-slow. Now: every paint stroke writes directly to the colored overlay canvas (using the brush's faction-colour in Faction mode, raw RGB otherwise) for instant feedback, the per-region border rebuild is skipped while painting, and the full rebuild is debounced to ~400 ms after the last click. Final state stays consistent — the debounced rebuild reconciles everything once you stop." },
    ],
  },
  {
    version: "0.9.332",
    date: "2026-05-12",
    items: [
      { type: "feature", text: "Dev-mode 'New region' modal in the Map Paint panel. Pick a name (and optional city/tags), a faction, and an unused RGB (auto-suggested, ↻ to roll another). The new region is added in-memory immediately and selected as the paint brush so you can start assigning pixels to it. The Save button now writes both the edited map_regions.tga AND the updated regions JSON when new regions exist." },
    ],
  },
  {
    version: "0.9.331",
    date: "2026-05-12",
    items: [
      { type: "feature", text: "Dev-mode map paintbrush. Click a pixel to reassign it to the current brush region's RGB. Alt-click eyedrops the clicked region into the brush. Pick brush size 1×1, 3×3, or 5×5. Live preview as you paint — borders + colored overlay rebuild on each click. 'Save TGA' button writes the edited map_regions.tga back to campaign_data (and dev build/) for the next reload. Solves the 'stray pixels in foreign regions' class of mod bugs without leaving Provincia." },
    ],
  },
  {
    version: "0.9.330",
    date: "2026-05-12",
    items: [
      { type: "improvement", text: "Heights hillshade is much smoother. (1) Overlay is now baked at the heights TGA's native ~2× resolution (≈2.86M pixels) instead of being pre-downsampled to the region-map's 1020×700. (2) Slope kernel switched from 4-neighbour differencing to a 3×3 Sobel — gives broader, smoother gradients. (3) drawImage uses imageSmoothingEnabled with quality 'high', so zooming in interpolates instead of showing blocky pixels." },
    ],
  },
  {
    version: "0.9.329",
    date: "2026-05-12",
    items: [
      { type: "improvement", text: "Heights overlay is now a hillshaded relief instead of a flat colour gradient. Computes per-pixel slope from a 4-neighbour elevation kernel and shades each tile relative to a fixed NW light source. Drawn with soft-light composite blend so flat ground is neutral and slopes lift/deepen the underlying map colours — mountains gain shadows, plains stay flat. Reads as a proper topo relief instead of the wash of green that 97% of the map became under the old gradient (since elevation distribution was heavily skewed low)." },
    ],
  },
  {
    version: "0.9.328",
    date: "2026-05-12",
    items: [
      { type: "feature", text: "New Heights view-mode overlay — elevation gradient (sea-level green → yellow → orange → red peaks) sampled from the mod's `map_heights.tga`. Independent toggle in the view-options bar, stacks with any colorMode and any other overlay. Bundled per-campaign, lazy-loaded on first activation." },
      { type: "fix", text: "Geography sidebar no longer has a green left border — matches the visual style of every other legend panel." },
    ],
  },
  {
    version: "0.9.327",
    date: "2026-05-12",
    items: [
      { type: "fix", text: "Sidebar legend panels no longer get squashed by adjacent expanded panels. In Faction colorMode + Resources overlay, the Factions list was being shrunk by flexbox to make room for the (uncapped) Resources panel, so part of the Factions list ended up visually hidden behind Resources. Added `flex-shrink: 0` to every sidebar panel so each keeps its natural size and the parent's scroll handles overflow instead." },
    ],
  },
  {
    version: "0.9.326",
    date: "2026-05-12",
    items: [
      { type: "fix", text: "Sidebar legend panels all render at the same width now. Geography / Faction Legend / Settlement Tier / Hidden Resource / etc. used a clamped maxWidth that disagreed with Resources' `width: 100%`, so two panels could sit one above the other at different widths (Geography ~190px, Resources ~240px). Standardised on `width: 100%` of the fixed 240px sidebar column." },
    ],
  },
  {
    version: "0.9.325",
    date: "2026-05-12",
    items: [
      { type: "improvement", text: "Resources sidebar (filter list with counts + 'All / None' toggles) now opens with the Resources overlay too, not just the dedicated Resources colorMode." },
      { type: "improvement", text: "Hide the raw 'slaves' commodity for non-dev users — it was a settlement-economy tag that read confusingly as slave trafficking. The slave_trade building chain is unaffected and stays visible. Dev mode still sees it (needed for editing descr_strat)." },
    ],
  },
  {
    version: "0.9.324",
    date: "2026-05-12",
    items: [
      { type: "improvement", text: "Dev mode can drag resources while the Resources overlay is on — drag previously only worked inside the dedicated 'Resources' colorMode, so you couldn't move a resource without losing your active map mode (Faction, Culture, Geography, etc.)." },
    ],
  },
  {
    version: "0.9.323",
    date: "2026-05-12",
    items: [
      { type: "fix", text: "Region Bdrs mode now renders province borders thick + black (same weight + alpha as the faction outline in Faction Bdrs mode), instead of using the thin light lines that were only meant for internal sub-faction divisions." },
    ],
  },
  {
    version: "0.9.322",
    date: "2026-05-12",
    items: [
      { type: "feature", text: "Resources is now a toggleable view overlay — stack resource icons on top of any colorMode (Faction + Resources, Culture + Resources, Geography + Resources, etc.) instead of having to switch out of your current map mode. The dedicated 'Resources' colorMode is still there and unchanged; the new toggle button in the view-options bar shows the same icons without the side-panel/filter UI." },
    ],
  },
  {
    version: "0.9.321",
    date: "2026-05-12",
    items: [
      { type: "feature", text: "Borders button is now tri-state — cycles off → Faction Bdrs (thin per-region lines + thick faction-group outline) → Region Bdrs (per-region lines only, no faction outline). Mirrors the Labels button's cycle behaviour. State persists across sessions." },
    ],
  },
  {
    version: "0.9.320",
    date: "2026-05-12",
    items: [
      { type: "feature", text: "Terrain overlay toggle — Geography is now a layer you can stack on top of any colorMode (Faction + terrain, Culture + terrain, etc.) instead of only as a standalone mode. Translucent 55% tint so the underlying map mode still reads. Independent toggle button in the view-options bar; remembered across sessions. Same TGA + palette as the standalone Geography mode." },
    ],
  },
  {
    version: "0.9.319",
    date: "2026-05-12",
    items: [
      { type: "feature", text: "New Geography map mode — colours every tile by its actual ground type (Forest, Mountain, Swamp, Rocky, Sand, etc.) decoded from the mod's `map_ground_types.tga`. Forest = ambush spots, Mountain = impassable, Swamp = slow. 14 terrain types, full palette coverage verified across the Imperial campaign (no unknown colours). Bundled per-campaign and lazy-loaded the first time the mode is activated so boot stays fast (the TGA is ~8 MB)." },
    ],
  },
  {
    version: "0.9.318",
    date: "2026-05-12",
    items: [
      { type: "feature", text: "Recruitment queue surfaced in the region panel. Each settlement's `default_set` chain has an optional 35-byte recruit entry with the unit's name inline (e.g. \"roman leves\"); the recruitable card gets a green REC badge + outline when its unit is currently being trained there. Decoded from session 36 of the save cracker." },
      { type: "feature", text: "Construction queue surfaced in the region panel. 53-byte building queue entry decoded from the same `default_set` body — shows `Building: chain #N — K turns` above the Buildings grid. Chain-ID → name resolution still TBD (no crackable mapping yet); 'chain #8000' for now until a corpus pins it." },
      { type: "feature", text: "Boarded ships now visually distinct on the map. Naval markers gain a bright yellow inner dot when a fleet carries at least one boarded character or army unit (session 37 schema: each boarded UUID-prefix appended to the ship's passenger array, count u16 bumped). Hover tooltip reads `⚓ carrying N passengers`." },
      { type: "improvement", text: "queueParser scans defensively: tight body bound via the next chain's preamble + chainId duplication check kills false positives across all 1,310 settlements in a 35 MB save. Tested clean across save_1.2..save_4.2 (no queue, BUILDING queue, RECRUIT queue, queue cleared) — only the genuinely-queued settlement matches." },
    ],
  },
  {
    version: "0.9.317",
    date: "2026-05-12",
    items: [
      { type: "fix", text: "Found the actual root cause of the parser hang. Log showed `[ERROR] [save-watch] parse error: Cannot set properties of null (setting 'initialOwnerByCity')` — main.js was trying to assign `lastSaveData.initialOwnerByCity = ...` when `lastSaveData` was null (parseSaveData returned null on certain saves). The throw escaped, the finally cleared `_reparsing`, but subsequent state was corrupted in a way that hung future parses. Added null-checks before all three `lastSaveData.X = ...` assignments in the save-watch and characters-init flows." },
      { type: "improvement", text: "Watchdog timeout on `reparseLatestSave` — if a reparse hasn't completed in 120 seconds (which is >2x the longest legitimate parse we've observed), force-clear `_reparsing` and kick off the next queued reparse. So even if a new unhandled hang slips through in future, the queue self-recovers instead of locking forever." },
      { type: "improvement", text: "Reparse error log now includes the stack trace (was just `.message`), making future hangs easier to diagnose." },
    ],
  },
  {
    version: "0.9.316",
    date: "2026-05-12",
    items: [
      { type: "fix", text: "30-second timeout on the parallel character + building workers. User saw post-conquest saves (save_11.1, save_13.1, Turn 2 Start) sit forever in 'queued (reparse already in progress)' state because one of the workers stopped responding — without a timeout the `await charsP` blocked indefinitely and the renderer kept showing pre-conquest data. Now: if a worker doesn't return within 30s, fall back to null and let parseCharactersAndUnits run its synchronous path. Side benefit: also unblocks any save with a structural feature we haven't seen before that trips the worker." },
      { type: "note", text: "(0.9.315's tileToRegion hypothesis was wrong — Brundisium doesn't border Taras as I assumed. The real cause was the parser hang above, which left the renderer on pre-march data where Aulus was still at Tarentum. The 1-tile-city-neighbour check is harmless and still ships, but isn't load-bearing.)" },
    ],
  },
  {
    version: "0.9.315",
    date: "2026-05-12",
    items: [
      { type: "fix", text: "Conqueror's army now resolves to the conquered settlement's region, not the surrounding territory. Diagnosed from the user's save_Turn 2 Start: Aulus is at (342,386), 1 tile WEST of Brundisium's city pixel (343,386). The pixel at (342,386) is Taras-region territory (since Brundisium sits at the eastern edge of the Salentine peninsula), so tileToRegion's direct sample said 'Taras' — even though Aulus had just captured Brundisium. Reordered tileToRegion to check 1-tile city neighbours BEFORE the direct pixel sample: if you're standing next to a city pixel, you're at THAT city's region. Same applies to any 'just captured / just arrived at city' scenario." },
    ],
  },
  {
    version: "0.9.314",
    date: "2026-05-12",
    items: [
      { type: "fix", text: "Conquered settlements no longer show the dead-defender's marker. User report: after capturing Brundisium, the map still showed Titus (the original Messapian governor per descr_strat) as a separate Messapian army at the city tile, even though he died in the battle. Cause: the bundled-armies synthesis dedupes only by character NAME and exact coord — when the defender's character is gone from the save entirely, neither dedupe matches. Now: if any save-army of a DIFFERENT faction sits at or within 1 tile of the bundled army's coord, the bundled synth is skipped (the defender is gone, the conqueror is here). Verified against Brundisium where Aulus's live coord drifted 1 tile from Titus's exact city pixel." },
      { type: "fix", text: "Conqueror's army marker now becomes a garrison circle (yellow) when sitting on the captured settlement tile, instead of staying a field-army diamond (red). main.js's liveArmies build hard-codes armyClass=field for any non-navy army; the renderer now reclassifies to garrison post-hoc when the army's (x,y) is at or within 1 tile of a settlement tile. Same 1-tile tolerance for live-log coord shifts." },
      { type: "improvement", text: "Removed the temp Characters-row diagnostic (provincia.log [char-diag] lines) — issue was resolved in 0.9.311." },
    ],
  },
  {
    version: "0.9.313",
    date: "2026-05-11",
    items: [
      { type: "improvement", text: "Extended the temp Characters-in-Uria diagnostic to also dump what armiesToRender has for any Aulus-named entry (character / firstName / originalLastName / region / x,y). Click Uria after updating, then send me the [char-diag] line from provincia.log." },
    ],
  },
  {
    version: "0.9.312",
    date: "2026-05-11",
    items: [
      { type: "improvement", text: "Temp diagnostic: when you click Uria (or any Salentinia region) and the Characters row is still empty, the app now writes a one-line summary to provincia.log showing what the renderer actually sees (filtered count, incoming count, sample of save chars in Taras, sample of liveRegionByCharName keys for that region). Lets us pin down the remaining miss without more guess-and-ship cycles." },
    ],
  },
  {
    version: "0.9.311",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Characters row in a conquered region now actually populates. 0.9.310 added the inbound-character pass, but the live path bailed out with `return null` BEFORE the pass ran when the region's save-time char list was empty. After Aulus conquered Uria, the original Messapian governors were displaced — saveCharactersByRegion[Salentinia] was empty — so the function exited early and Aulus never got pulled in. Now treats an empty list as [] and falls through to the incoming pass." },
    ],
  },
  {
    version: "0.9.310",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Two follow-ups after the duplicate-marker fix. (1) The 'bodyguard currently at Taras' message in the garrison commander block was a lie: it was reading the stale unit-record region tag, which never updates on move. Now reads from liveUnitsByRegion (which re-buckets armies on settlement tiles per 0.9.305), so a governor whose bodyguard moved with him reports the correct region and the misleading sub-message disappears. (2) The Characters row now correctly lists characters who moved INTO this region. The renderer's inbound-character pass now also matches by birth name (originalLastName), propagated through to saveCharactersByRegion. So Aulus Messapivs the Wallbreaker (renamed from Aulus Gabinius via traits) shows up in Uria's Characters list after he conquered it." },
    ],
  },
  {
    version: "0.9.309",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "0.9.308 dedupe-by-birth-name still didn't fire because main.js's leader object didn't propagate `originalLastName` from the v1 character record. So saveLiveArmies entries shipped with `originalLastName: null` even when the parser set it correctly. The renderer's birth-name dedupe then fell back to the (trait-renamed) lastName — `Aulus Messapivs` vs the bundled `Aulus Gabinius` → no match → synthetic marker still added. main.js now propagates v1.originalLastName onto the armyMap leader object. Verified via standalone parse of save_3: Aulus Gabinius (uuid 0xa77c10f) carries `RomanConquerorMessapians:2` trait → renamed to Messapivs. Birth lastName `Gabinius` is now preserved end-to-end." },
    ],
  },
  {
    version: "0.9.308",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Dedupe by BIRTH name (originalLastName), not display name. After conquering Uria + gaining the RomanConquerorMessapians cognomen + Wallbreaker nickname, Aulus Gabinius's displayed name became `Aulus Messapivs the Wallbreaker`. The 0.9.306/307 dedupe matched display names, so `Aulus Gabinius` (bundled descr_strat) ≠ `Aulus Messapivs the Wallbreaker` (current save) → both got rendered as separate markers. Now the renderer keys saveLiveArmies entries under their birth lastName (preserved by main.js as `originalLastName` exactly for this case), so the bundled descr_strat synth correctly dedupes against the current save record even when the display name changed via traits." },
    ],
  },
  {
    version: "0.9.307",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "0.9.306 still showed the duplicate Aulus marker because the dedupe check looked at `d.character` but bundled `armiesData` entries write the name to `d.name` (the bundle script uses both forms inconsistently). The undefined check skipped the dedupe entirely, so the synthetic marker still got added. Now accepts either field — should be the last needed dedupe fix." },
    ],
  },
  {
    version: "0.9.306",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Generals no longer show duplicate markers on the map after moving away from their descr_strat starting tile. User report: after Aulus marched from Taras to Uria and occupied it, the map showed him at BOTH his current Uria position AND his original Taras spawn. Cause: the descr_strat synthesis loop in armiesToRender deduped only by coordinate, not by character name. Save_3 has Aulus at (340, 384), bundled JSON has him at (337, 385) — different coords, so a synthetic marker got added at the bundled position even though the save already had him at the new one. Now: dedupe by (character + faction) as well as coord, so a character present anywhere in saveLiveArmies skips the synth entirely." },
    ],
  },
  {
    version: "0.9.305",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Armies sitting on a captured settlement tile now correctly appear in that region's panel, not their pre-move region. User report: after Romans Julii conquered Uria, Aulus's units still appeared in Taras's region panel (his starting location). Cause: the engine doesn't update a unit-record's `region` field when its general moves — only the separate world-object position record updates. The map marker uses world-position (correct), but the region panel was using the stale unit-record region tag. The 0.9.282 fix prevented general-purpose region overrides because save coords can drift 1-3 tiles off settlement markers into adjacent regions, but settlement TILES specifically are unambiguous (exact pixel match). Now: when an army's (x, y) matches a known settlement-tile EXACTLY, the live-bucketing uses the army's resolved region instead of the stale unit-record tag. Live-log overrides still take precedence; non-settlement positions still keep their save region tag (no drift risk)." },
    ],
  },
  {
    version: "0.9.304",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Region owner now reflects the loaded mod's descr_strat, not the dev-bundled `regions_large.json`. User report: Uria showed `romans_julii` in the app even though the current RIS descr_strat puts it under messapians (Salentinia is a settlement they OWN, not a homeland claim). The bundled JSON was generated against an older mod state and never updated when the mod changed. Now: the renderer overlays `initialOwnerByCity` (parsed at runtime from the LOADED mod's descr_strat) onto each region's `faction` field. Any future descr_strat edit picks up automatically as soon as you reload the mod. First step toward the broader `nothing hardcoded` direction — the regions, factions, and ownership data are still bundled but the bundled JSON is now an override-able fallback, not the source of truth." },
    ],
  },
  {
    version: "0.9.303",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "Live tracking now resets when you click the Live button, not just when a save snapshot lands. Clearing passenger lists / unit-flow / char positions, re-anchoring the log watcher to current EOF — same logic as the auto-reset on save. So if you load Provincia mid-game, the live view starts clean instead of replaying old session state." },
      { type: "fix", text: "Characters-list filter now keeps trait epithets (`the Eagle`, `the Drunkard`, etc) when matching across armiesToRender ↔ saveCharactersByRegion. 0.9.302 stripped them on one side only, so any general with an epithet was invisible to the move filter and got stuck in their save-tagged region. Also registers the BIRTH name (pre-epithet) as a fallback when the army entry was constructed before the trait fired." },
      { type: "fix", text: "Merged army roster now sorts bodyguard units first. After Marcus merges into Aulus, both bodyguards (one for each general) lead the unit list instead of being scattered into file-order. Bodyguard = unit with a real `commanderUuid` (foot units have `commanderUuid: null` and inherit via `inferredCmd`). User report: 'one bodyguard at the start, one at the end — they should both be first'." },
    ],
  },
  {
    version: "0.9.302",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Characters list is now bidirectional with live moves: chars who left appear nowhere (already done in 0.9.297), AND chars who arrived show up in the destination region. After Marcus merges into Aulus's stack in Taras, Marcus's name should now appear in Taras's Characters row (with traits / ancillaries pulled from the save char record) — not stuck in Metapontion and not missing entirely. Applies to both the live path (saveCharactersByRegion) and the descr_strat starting fallback." },
    ],
  },
  {
    version: "0.9.301",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Critical: save parser was silently crashing with `ReferenceError: bodyguard is not defined` whenever a save snapshot was processed. The `bodyguard` const was declared inside one for-loop's scope but referenced from a separate later loop where it had no value. The try/catch wrapping the parser hid this — instead of erroring loudly it just bailed out and emitted '0 characters, 0 units'. Result for the user: saveCharactersByRegion / saveLiveArmies never populated, so every live feature added in the last few versions (merge re-bucketing, character move filtering, hover-tile merge, etc) appeared completely broken. Each commit was correct in isolation; nothing reached the renderer because the parser threw on every save. Fix: use the inner loop's own commanded units to grab the bodyguard. Apologies for the chase." },
    ],
  },
  {
    version: "0.9.300",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "Same-tile merge now uses the live log's `transferring general(X) ... to named general(Y)` event directly instead of relying on coord-equality. Verified against the user's actual message_log: Marcus's EXCHANGE move puts him at (337,385) — same tile as Aulus — and the transfer event names both generals explicitly. The renderer now builds a Map<donor_secondaryUuid → target_secondaryUuid> from the flow snapshot's `fromName` / `toName` fields (matched against saveCharactersByRegion by firstName+lastName), and the region panel's mergeByTile + the map hover tooltip both group entries by (faction, merge-target) when present. Coord-equality is kept as a fallback for cases the flow tracker didn't capture (mod reload mid-merge, etc). Result: Aulus + Marcus merged stack shows as one entry with 15 units in both the region panel and the hover tooltip, even when the engine's coord resolution is off by a tile." },
    ],
  },
  {
    version: "0.9.299",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Same-tile army merge logic is now lenient about exact pixel-coords. After a live-log merge (Marcus → Aulus), the engine can leave the two bodyguards 1-2 tiles apart visually even though they're one logical stack, so the strict (faction, x, y) match in 0.9.298 missed them. Now: exact-coord match runs first as before; then a second pass merges any remaining live-tracked entries of the same faction within the same region. The same fallback applies to both the map hover tooltip AND the region panel's 'Other faction armies' section. Result: Aulus + Marcus merged stack should now show as one combined entry with 15 units in both surfaces." },
    ],
  },
  {
    version: "0.9.298",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Map army hover tooltip now applies the same-tile merge that the region panel already does. RTW stacks can hold multiple generals + their bodyguards (Marcus + Aulus = one army of 15 in-game), but the save records each general's bodyguard as a separate cmd-grouped army. Previous tooltip showed only the hovered general's own army (e.g. Aulus 14 units), now it sums all same-faction same-coord armies and lists their combined commanders + unit roster (e.g. 'Aulus Gabinius + Marcus Livius Drusus — 15 units')." },
    ],
  },
  {
    version: "0.9.297",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Characters who've moved out of their save-tagged region (per the live log) no longer appear in the old region's Characters list. User report: 'Marcus Livius Drusus' still showed under Metapontion's Characters even though he'd merged into Aulus's stack at Taras. Now both the live path and the descr_strat starting fallback check armiesToRender's live-resolved region for each char — if it's different from the panel's region, the char is dropped. (Live-region info comes from the same source that already moves the map dot when a character moves.)" },
    ],
  },
  {
    version: "0.9.296",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Sidebar panel order is now consistent across all map modes: map-mode context panels (Factions / Culture / Religion legend, Settlement legend, Homeland, Resources) always at the top; Army Types always at the bottom. Previously in resource map mode the Resources panel rendered AFTER Army Types, so it appeared below the Army stack — inverted compared to every other map mode where the map-mode legend sat on top. Same panels visible, same toggles; just consistent ordering." },
    ],
  },
  {
    version: "0.9.295",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Settlement hover tooltip's Y coordinate now matches the in-game `show_cursorstat` console output. User report: Riusiava tooltip showed y=198 but in-game says pos 258, 501 — that's because the tooltip displayed the TGA-pixel (top-down) Y instead of the descr_strat-native (bottom-up) Y. Display now flips via `imgHeight - 1 - tga_y` (the same convention the save-cracker dossier records). Internal coord math is unchanged — only the displayed value in the tooltip flips, so live unit positioning stays accurate." },
    ],
  },
  {
    version: "0.9.294",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Resource map mode panel now joins the sidebar stack instead of overlapping the Factions legend. 0.9.292 missed the Resources panel because it lived in its own `renderResourceFilter()` function with its own absolute positioning, separate from the wrapper that already held Factions/Homeland/Army Types. Now it renders inside the same flex-column wrapper. Wrapper width bumped from 220px → 240px to match Resources panel's content needs." },
    ],
  },
  {
    version: "0.9.293",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Merge re-bucketing now works for the recipient even when they don't emit MOVING_NORMAL log events. 0.9.291's bridge required both donor and recipient to have a known faction (captured from MOVING_NORMAL); for a merge like Marcus → Aulus, only Marcus emits a move (Aulus stays put), so the recipient bridge always failed and no units flowed. Now: tier 1 still uses the strict (firstName, lastName, faction) match when faction is known; tier 2 falls back to (firstName, lastName) only IF that pair is unique across the entire save char list. Aulus Gabinius is unique by name in any RIS save, so the bridge resolves. The collision safeguard from 0.9.271 (no first-name-only fallback) still applies — only the LASTNAME-combined pair is accepted, not bare first names." },
    ],
  },
  {
    version: "0.9.292",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Right-side overlay panels (Factions legend, Homeland legend, Army Types) no longer overlap. All three (plus the settlement legend when shown) now stack vertically in a single sidebar container with hidden-scrollbar overflow, so multiple can fit on screen without overlapping. Each panel has its own collapse toggle (▶/▼ chevron next to the title) — click the title to minimize. Visibility is still map-mode-relevant: Homeland only shows in homeland mode, Army Types only shows when the Armies toggle is on AND there are armies, etc." },
    ],
  },
  {
    version: "0.9.291",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "Live log tracking is now SAVE-RELATIVE: every time a save snapshot lands, the log watcher re-anchors to the current end of message_log.txt and drops all live tracking state (passenger lists, unit-flow, char positions). Save state is authoritative for everything that's already happened; the log is only useful for events that happen AFTER this save. The previous backfill-from-EOF + accumulate forever pattern was reading old game-session entries when you loaded a save mid-Provincia-session and applying them on top of the new save's reality — which was wrong. User asked for this directly: 'it should only need logs for the states between saves; the rest should be parsed from the saves'. Spot-on architectural call." },
      { type: "feature", text: "New 'Reset' button next to Stats (only visible when Live is on) — manual override that re-anchors the log watcher to current EOF without needing to save in-game. Use after loading a save mid-session if for some reason auto-reset didn't fire (and tell me — that's a bug)." },
      { type: "feature", text: "Live unit-flow re-bucketing is BACK after being reverted in 0.9.272. When you merge Marcus's stack onto Aulus, the foot units should now visibly transfer to Aulus in the region panel without waiting for a save. Safer reattempt: main.js tracks the donor's full name on each transfer event (via the message_log's `transferring general(X)` line), and the renderer bridges runtime char uuids → save secondaryUuids ONLY via strict (firstName, lastName, faction) triple match. If either side can't bridge unambiguously, the flow is skipped — no first-name-only fallback that caused the Uria flood. Donor's foot pool is also region-guarded: only foot units in the donor's bodyguard region donate." },
    ],
  },
  {
    version: "0.9.290",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "When the save says a settlement has a governor but our v1 char pool can't decode that uuid (timing race during load, or an RIS-imperial auto-generated character whose record format v1 doesn't recognize), the Garrison commander line now falls back to the descr_strat starting commander's name + faction + age, instead of the unhelpful '(governor — character record not decoded)'. Accurate at turn 1, useful as a 'started here as' hint at later turns." },
    ],
  },
  {
    version: "0.9.289",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Region panel no longer goes empty during the save-parse gap right after clicking Live. Previously: user clicks Live → liveLogActive flips to true → the live data paths (garrison, fieldArmies, characters, garrisonCommander) gate on liveLogActive and bypass the non-live fallbacks → save takes 2-3s to parse → in the gap, all four panels return null. Now each of those props checks 'is the live data actually loaded yet?' separately, and falls back to descr_strat starting data when not. Once the save lands, live data takes over automatically. User reported this as 'units in Taras disappear after going live'." },
    ],
  },
  {
    version: "0.9.288",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "0.9.287 added a Characters row to non-live mode but it never showed up in regions like Tarentum because the runtime descr_strat coord-match filter rejected everything — bundled coords are TGA-snapped (e.g. Milon @ 336,384) while descr_strat raw coords are different (e.g. 168,191). Switched to a firstName+faction merge instead: bundled per-region structure stays as the index, runtime descr_strat trait data overrides per-character when present. Generals + traits now appear in non-live mode for Tarentum, Rome, every populated region. Right-click on a name to see the trait popup." },
      { type: "fix", text: "Garrison commander name now shows in non-live mode (e.g. 'Milon — taras' in Tarentum). Previously the Garrison Commander block was gated on liveLogActive and returned null without a save loaded, so the garrison-units list appeared with no commander attribution. Now pulls from the bundled starting_armies JSON's first garrison entry." },
      { type: "change", text: "Stats button moved next to the Live button at the top of the panel, and only renders when Live mode is active. Was previously next to Wealth in the bottom toolbar where it didn't belong — Wealth works without a save, Stats doesn't. Pairing it with Live makes the dependency obvious." },
    ],
  },
  {
    version: "0.9.287",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "Generals + their starting traits, ancillaries, age, and leader/heir tags now show in the region panel WITHOUT a save loaded. The Characters row labels itself '(starting)' instead of '(live)' to make the source clear, and right-click on a character still opens the trait popup (now reading from descr_strat instead of the save). Live-save data still takes precedence whenever it's available; descr_strat is the turn-0 fallback. First step in the broader 'live features should work in non-live mode' direction — more to follow." },
      { type: "improvement", text: "Starting-character data is now parsed at RUNTIME from the loaded mod's descr_strat, not baked in at build time. This means generals' traits will reflect whichever mod you've loaded — vanilla, RIS, a workshop download, or your own work-in-progress mod with edits to descr_strat. Nothing about character traits is hardcoded anymore. main.js's `loadModCharacterData` was extended to capture multi-line trait/ancillary records (the lines that follow each `character` header), and a new `get-starting-characters` IPC exposes them to the renderer; the bundled JSON remains as a fallback for the dev build's pre-shipped campaign." },
      { type: "fix", text: "Stats button no longer just grays out when no save is loaded — clicking it now opens a small popover explaining 'No save loaded — open Live to start monitoring your saves folder'. Reachable so the user knows the button exists, doesn't lie about being broken." },
    ],
  },
  {
    version: "0.9.286",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "New 'Stats' button next to Wealth — opens a Campaign Stats panel that surfaces the save's lua persistent-counter table (decoded by save-cracker session 23, rtw-sav-parser format `[u32 nameLen][UTF-16LE name][u32 value]` ~5300 bytes near EOF). RIS imperial has 115 counters; the panel groups them into Military (num_battles_*, num_mercs_recruited_*), Reform progress (per-faction Marian-style unlock counters), Rebellion state (script-driven regional revolt counters), Capital, Misc, and Campaign (turn_number + setup flags). 60 `id_<faction>` lookup-constant hashes are hidden by default — they're identity tags, not stats. Button is disabled until a save is loaded." },
    ],
  },
  {
    version: "0.9.285",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "Character popup now lists CHILDREN (resolved to names). Decoded by save-cracker session 13 CONFIRMED: children's primary UUIDs sit in a 4-slot array at character record +54..+66 (LAYOUT_A) / +50..+62 (LAYOUT_B). 218/218 parent-child hits verified in Rome T1, byte-identical reproduction across game sessions. Children's names are resolved via a global primaryUuid lookup built from saveCharactersByRegion. Slot order is by birth; dead children preserve their slot leaving garbage uuids, which are dropped from the displayed list (we only show children we can resolve to a parsed character)." },
    ],
  },
  {
    version: "0.9.284",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Settlement governor armies now show in their own city's panel. User report: Tarentum (Taras region) showed 'Garrison: (governor — character record not decoded) — Taras / No units stationed / Field armies: None' even though the save has 21 units in the region (Greek governor + 6 foot + Roman invasion stack). Root cause: the captain_card_<faction>.tga marker fallback misattributed Tarentum's Greek governor as `syracuse` faction (his bodyguard record sits inside a syracuse-marked block in the save file), so the panel's sameFaction(commander, regionOwner) check failed and his 7 units were filtered out. 0.9.258's re-attribution guard was protecting parked own-faction generals but accidentally skipping governors of mis-attributed factions. Now: when an army's commanderUuid matches a settlement-governor uuid, override the captain_card-derived faction with that settlement's actual owner. Applied to all three re-attribution call sites (reparseLatestSave, initial saveWatchStart, characters-init)." },
      { type: "feature", text: "Per-unit XP, weapon, and armour upgrades now read directly from the save (save-cracker session 10 CONFIRMED: u8 at unit-record regionEnd +20 / +17 / +16). Previously these were seeded from descr_strat turn-0 values by unit-name FIFO match within region — missed mid-campaign recruits, multi-unit name collisions, and just-fought chevron gains. Verified across the Macedon T13→T14 corpus: 3 phalangists units gained chevrons in the inter-turn AI rotation, picked up correctly by the parser. The descr_strat seed remains as a fallback for cases where the save value is 0/missing." },
    ],
  },
  {
    version: "0.9.283",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Building display-name lookup now tries the `chain_<token>_<tier>` ordering RIS imperial uses for the colony chain (e.g. `colony_italic_2`), in addition to the existing `<level>_<culture>` form government chains use (`gov2_roman`). Without this, the colony chain (RIS's Roman provincial governance system) was falling back to the bundled JSON's generic 'Large Colony' instead of the mod's localized 'Colony 2 - Italic'. User report: 'Provincia (direct rule) building not showing up in Venusia' — the building IS there as `colony_2` at level index 1, but the display label was wrong. Tries the resolved culture token first, then a fallback list of common RIS ethnicity tokens (italic, italiote, hellenic, celtic, iberian, germanic, ...). Note: Venusia at turn 1 has NO governmentA-D chain yet — the player still needs to construct one. The colony chain is what represents 'Roman provincial' status." },
    ],
  },
  {
    version: "0.9.282",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Stationary armies no longer drift into adjacent regions' panels. User report: Rome's panel showed 'Field armies: None' with only 2 units in Garrison, but Rome actually has 3 Roman generals + 12 foot units in the save. Cause: the live-region re-bucketing was overriding the save's unit-region tag with `tileToRegion(army.x, army.y)` for EVERY army in armiesToRender — including ones whose position came purely from the save's world-object record. Quintus Ogulnius_Gallus (governor of Rome) sits at (285, 404), 1-3 tiles off Rome's center pixel; the RGB at his exact coord resolves to a NEIGHBOURING region, so his 13 units bucketed out of Rome's panel even though their save region tag was `Roma`. Now the override only fires when the army's position came from a live-LOG event (`liveTracked=true`); save-only positions keep their original unit-region tag. Marcus/Aulus merge+split tracking still works (synthesized passenger moves are live-tracked)." },
    ],
  },
  {
    version: "0.9.281",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "Character popup now shows the clan-head / cognomen family link. Decoded by save-cracker session 8 (STRONG): u32 at character record +18 is a name-lookup index pointing to the character's Roman gens / patron family (verified Aulus Gabinius + Marcus Livius_Drusus both point to `Cornelius_Scapula` in save_rome6/7). Most characters have a 0xffffffff sentinel here; only those explicitly bound to a clan (via adoption, marriage, sworn loyalty, or specific trait gain) carry a real value. Subtitle also got fine-grained age precision (4-turns-per-year) when the engine's +86 u16 timer reads consistent with the integer age — 96.8% of chars match (the 3.2% with raw=0 fall back to integer years to stay safe)." },
    ],
  },
  {
    version: "0.9.280",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "Army hover tooltips now show `· moved this turn` when the general has already issued a move action. Decoded in save-cracker session 4 (cross-validated in session 2): bit 7 of the byte at character-position record +9 flips from 0 to 1 on movement, resets at turn start. Lets you see at a glance which armies still have actions to spend." },
    ],
  },
  {
    version: "0.9.279",
    date: "2026-05-10",
    items: [
      { type: "feature", text: "Character right-click popup now shows ANCILLARIES alongside traits. Decoded by save-cracker session 6: ancillaries live inline in the character record between the trait block and the portrait paths, as zero or more `[u16=0, u16=ancId]` pairs followed by a `[u16=0]` sentinel. ID is the 0-based position of an `Ancillary <name>` line in the mod's `export_descr_ancillaries.txt` (1092 entries in RIS imperial). Cross-validated against rome1..rome10: lists are stable across saves and turn boundaries, change only when an ancillary is gained (Hanno's 51,55 → 51,55,170 at turn 5→6). Sample on save_rome10: Hannibal carries `prophet_carthage1` + `priest_of_Baal_Hammon` (thematic!), Hanno has `pontic_noble` + `hellene_wife`. 65 chars with ancillaries in save_rome10. Retracts session 4's 'terminator marker' interpretation — that was just the portrait length prefix overlapping with the last trait slot's flag bytes." },
    ],
  },
  {
    version: "0.9.278",
    date: "2026-05-10",
    items: [
      { type: "feature", text: "Faction Wealth panel now shows LIVE treasury per faction (denarii in coffers right now), not just the descr_strat starting wealth. Decoded by save-cracker session 5: the save contains a flat 23-record array of major factions with a unique structural signature (+8 == 100, +12 == 1, +24/+40 self-pointers). Treasury sits at +0 of each record. CONFIRMED across 14 saves in 4 campaigns: every Saka T1 starting denarii matches descr_strat byte-for-byte, Ptolemaic stable at 20000 mid-turn → jumps to 32083 at turn 6 boundary, the user's romans_julii went bankrupt (-3137) at rome7. Each row tooltips with the start-of-turn snapshot when available, letting the user see mid-turn net delta (income minus upkeep so far). Negative values render red. Gated to RIS imperial-campaign saves (the descr_strat major-faction order was only verified for that ruleset)." },
    ],
  },
  {
    version: "0.9.277",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Character death detection now reads the proper death-marker u32 instead of a single byte. Save-cracker session 4 confirmed bytes +30..+33 of every character record carry a sentinel that flips from 0 to 0xfffffef7 (=-265 i32) on death — witnessed on two independent same-turn deaths. The previous heuristic read byte +34 (LAYOUT_A) / +30 (LAYOUT_B) as 'dead if >= 0xf0', which happened to work for LAYOUT_B (byte 0 of the marker) but was reading an unrelated byte for LAYOUT_A. The full u32 check is layout-agnostic — dead characters now drop reliably from the panel for both Roman and Greek characters." },
    ],
  },
  {
    version: "0.9.276",
    date: "2026-05-10",
    items: [
      { type: "feature", text: "Region info panel now shows three new fields from the save: SIZE class (live, reflects upgrades — village / town / large_town / city / large_city / huge_city), per-turn INCOME in denarii (with cumulative total alongside), and the existing Population row. All read directly from the save via offsets decoded by the background save-cracker session 3 — pushed exhaustive coverage of the ~3728-byte settlement record from 4 known fields to 9+ identified, ~90% byte-classified overall. Sample on save_rome10: Capua (city) 400 d/turn, 2270 total; Brundisium (large_town) 266 d/turn; Uria (town, just captured) 133 d/turn. Income/size gated to player-owned settlements (the offset was only verified for those)." },
    ],
  },
  {
    version: "0.9.275",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Captured settlements no longer permanently hide their roster. The 0.9.267 wipe-filter (drop defenders from a settlement's panel during the live moment between SUCCESSFUL_ASSAULT and the next save snapshot) was sticky — once Taras was wiped earlier in the campaign, every subsequent unit at Taras region was filtered out forever, even after a save refresh, even when the user's own army moved in to occupy. User report: Aulus's 14-unit army at Taras showed 'No units stationed' in the panel despite the hover tooltip correctly listing all 14 units. Both the `liveAssaultWipedSettlements` Set and the `liveDeadCharUuids` Set now reset on every fresh save snapshot — those were stale-save guards that should expire as soon as the save catches up. Live captures + deaths still drop units in real time between events." },
      { type: "improvement", text: "Army hover tooltip now shows which region the marker resolves to (`in <region>`). Helps disambiguate when a marker visually sits near a boundary — the user can confirm which region's RegionInfo panel will show the army's roster." },
    ],
  },
  {
    version: "0.9.274",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Movement-points readout was getting set on EVERY variant-A unit (4161 of 4161 on Turn 2 Start), almost all reading as exactly 128.0 — the f32 at +4 is a common engine constant (0x43000000) for non-bodyguard records and the [0,1000] sanity clip was too loose. Now: only reads MP when commanderUuid looks like a real char uuid (non-zero, non-0xffffffff), and the accepted range is tightened to [10, 500]. Verified on save_rome10: only 793 units now have MP set (all bodyguard records labelled 'roman general' / etc.), values in the realistic 170-225 range." },
      { type: "feature", text: "Live settlement population shows in the region info panel — read directly from the save (u32 at settlement_name_offset-1494). Decoded by the save-cracker (session 2): 18/18 cross-validated against descr_strat starting pops, and diverges from start as turns advance (growth/decay events apply). Shows under the existing Pop Cap line, so you see both the cap (e.g. 'level 9, ~13,500') and the current live count (e.g. '9,000')." },
    ],
  },
  {
    version: "0.9.273",
    date: "2026-05-10",
    items: [
      { type: "feature", text: "Public order percentage now shows in the region info panel for player-owned settlements. The background save-cracker session decoded a settlement happiness f32 sitting at `settlement_name_offset - 30` in the save (triple-validated against the Sparta tax-triple — it's the only byte in any settlement record that changes between tax levels, scales -25 per level). Raw save value is roughly 100..200; mapped linearly to a 0-100% bar with a green/yellow/red traffic light at 60/30 cutoffs. Verified on save_rome10: Capua 205→100%, Volsinii 185→85%, Uria 135→35% (just captured, post-conquest unrest). Same player-faction gate as the tax row — only renders when the settlement belongs to the player." },
      { type: "feature", text: "Movement-points remaining now shows on the army hover tooltip. Decoded from a f32 at `bodyguard_unit.commanderUuid + 4` in the save (triple-validated: save_rome5→save_rome6 has one Roman general moving 1 tile and this float dropped by exactly -7.425; same value mirrored at character-position record +50). Sanity-clipped to [0, 1000] in the parser to reject false positives on non-bodyguard variant-A unit records (which have unrelated data at +4). Shown as 'MP remaining: 231.1' in green under the army header line." },
    ],
  },
  {
    version: "0.9.272",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Reverted 0.9.271's unit-flow override in the renderer — it caused 100+ units (across multiple unrelated factions) to flood into Uria's panel. Suspected combo of weak runtime→save char matching (first-name-only fallback for chars that never emitted a MOVING_NORMAL with a surname) plus Pass 2's pre-existing phantom-attribution (save_rome10 has a single 'greek general' record at cmd=266b0168 with 763 commander-less foot units file-order-attached to it — a known Pass 2 trade-off, but the override sat on top and amplified the misattributions). main.js's flow tracking + IPC plumbing is kept so we have the data ready for a more conservative reattempt: probably needs faction tagging on char records, Pass 2 region-aware attribution, and only flowing within explicitly-named character pairs. The 0.9.270 split-detection that breaks the passenger relationship is unaffected and still works." },
    ],
  },
  {
    version: "0.9.271",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Unit rosters now re-bucket live when units are transferred between armies — Marcus's split-off from the merged Marcus+Aulus stack now correctly shows Marcus with 14 units at Brundisium (his bg + 13 foot ex-Aulus) and Aulus with 1 unit at Uria (his bg only), instead of the save state's 1/14 distribution. Why the workaround: the engine's runtime memory uuid for a unit has no stable mapping to a save unit (save units are identified by file offset, no field matches the runtime pointer), so we can't say 'unit X moved from save-Aulus to save-Marcus' by identity. Instead main.js tracks the COUNT of units flowing between each pair of leaders (`unitFlowFromTo`) from every transfer event in the log, and the renderer applies it as a foot-unit pool donation: for each (from, to, count) entry, take N foot units (commanderUuid==null, attached via Pass 2 inferredCmd) from save-from-leader's roster and relabel them to save-to-leader. Bodyguards never donate — they stay with their general by identity. A per-donor cursor keeps multiple flows from the same source from double-donating. Renderer maps runtime char uuid → save secondaryUuid by name (via liveCharPositions, which has both runtime uuid and full name from MOVING_NORMAL events, joined to saveCharactersByRegion's stored names). Off-by-one is possible if a general-transfer drags an extra bodyguard count, but the visible delta is ±1 unit at most and a save flushes it." },
    ],
  },
  {
    version: "0.9.270",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Army splits now break the passenger relationship — when Marcus splits off the merged Marcus+Aulus stack to siege Brundisium, Aulus's marker should STAY at Uria with his lone bodyguard, not follow Marcus to Brundisium. Reading the user's message_log, the split sequence is: (1) Marcus's BESIEGE-to-Brundisium fires with a NEW army_uuid (926eb860) — different from the previously merged army's uuid (812f01b0); (2) THEN the `transferring general(Marcus:X) ... to named general(Marcus:X):army(NEW)` self-transfer line documents the split. So the new army_uuid is the FIRST signal of a split, and it appears on the move event itself — we can't wait for the self-transfer to fire because the move propagation already happened. main.js now tracks the last seen army_uuid per character and clears the passenger list on a mismatch BEFORE fanout. The transfer handler also updates the tracking on a merge so the next move with the merged army's uuid doesn't trip the split detector. Self-transfer in setPassenger is also guarded — without it Marcus would have been added as his own passenger." },
    ],
  },
  {
    version: "0.9.269",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Skip 'Turn N End' autosaves in auto-load. RTW writes both 'Turn N End' (end-of-player-turn snapshot) and 'Turn N+1 Start' (after AI moves resolve) for every turn transition. The Start version is freshly-written seconds later and supersedes the End version, so loading both means a redundant ~35MB reparse on every turn end. Three paths now filter End autosaves: findLatestSave (used by the post-write reparse), get-latest-save-mtime (used by renderer auto-detection), and the fs.watch save-dir callback (so the write itself doesn't trigger a debounced reparse). list-saves keeps showing End autosaves so they remain selectable from the picker if the user wants to inspect them manually." },
    ],
  },
  {
    version: "0.9.268",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Death-event name-match now uses BOTH first AND last name (user feedback on 0.9.267 first-name-only fallback: 'you need to check last names as well!'). The DYING log line emits only the first name (`Titus(uuid):DYING...`), but if the same character emitted a MOVING_NORMAL earlier in the session, liveCharPositions has them keyed under `first|lastStub|faction`. The death handler now recovers the lastStub by finding the live-pos entry with matching charUuid, then matches save chars on first AND last name (with the same underscore-strip normalization on both sides). Falls back to first-name-only when no live entry exists (stationary character that never emitted a move) — that path still over-filters across factions but it's the narrow tail case." },
    ],
  },
  {
    version: "0.9.267",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Garrison troops now disappear when their settlement is taken by successful assault — covers the live-log gap where the save hasn't refreshed yet. Verified from the user's message_log: `faction(messapians) surrenders Brundisium to faction(romans_julii). Reason - SUCCESSFUL_ASSAULT` fires, then `Titus(...):DYING...`, then `captures Brundisium`. The `captures` event itself always has `reason=CAPTURED` (uninformative); the SUCCESSFUL_ASSAULT signal lives on the preceding surrender line, which wasn't being parsed. Now parse it as a separate `surrender` event and on SUCCESSFUL_ASSAULT add the settlement to a `liveAssaultWipedSettlements` set. Three render paths consult this set: (1) liveUnitsByRegion drops units tagged region===<wiped settlement>, (2) the Characters panel drops chars whose bodyguard is inside a wiped settlement, (3) armiesToRender drops the army marker when the bodyguard's region is wiped. RTW rule the user reminded me of: 'when an attacker wins a siege all the garrison troops always die' — but defenders OUTSIDE the settlement walls (a separate region tag) can survive, so we only drop the in-settlement roster, not the surrounding region's armies." },
      { type: "fix", text: "Death events now also map the engine's runtime memory uuid back to the save's stored secondaryUuid via a name match against the live saveCharactersByRegion (kept current through a ref so the log handler doesn't read a stale closure capture). Without this, the existing dead-uuid filter in armiesToRender missed the dead general because the log's `Titus(14f47c40):DYING` uuid never matched Titus's save-time secondary uuid. Trade-off: matches only on first name, so two characters sharing a name in different factions get over-filtered — death events are rare enough that this is acceptable until we tag char records with faction." },
    ],
  },
  {
    version: "0.9.266",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Naval units no longer leak into land army/garrison rosters. User saw a `24` (naval bireme crew) and a `51` (probably naval boat) inside Aulus's garrison panel. main.js's Pass 2 file-order foot-attribution attaches commander-less units to the nearest preceding general WITHOUT a region check (deliberate trade-off documented in the comment — strict region match was dropping legitimate foot units whose region tag lagged after a mid-turn move). But that swept naval biremes into land armies too. Now Pass 2 skips any unit whose name starts with `naval` OR whose region is `the sea` — those are anonymous fleets, owned exclusively by the 0.9.264 navy-synthesis pass." },
    ],
  },
  {
    version: "0.9.265",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "0.9.263's region-color-on-capture fix didn't actually work — confirmed by reading the user's message_log: `attaching region Salentinia(818) to faction(romans_julii)` does fire when Uria/Brundisium is captured, but my city-name lookup loop was iterating the `regions` variable from `processLogEvents`'s closure. processLogEvents is wrapped in useCallback with deps `[replayToTurn]` (no `regions`), so the captured `regions` is the EMPTY initial map from first render and never updates. Lookup found nothing → cityName stayed null → currentOwnerByCity was never updated → map render kept reading the stale faction. Now the lookup is folded into the existing `setRegions(prev => ...)` updater, which gets the live regions map via `prev`. setCurrentOwnerByCity is chained from inside that updater — React batches the two state updates in the same render cycle." },
      { type: "fix", text: "When a defending general dies (DYING event), their units are now also dropped from the captured region's field-army panel. User report: 'I took over Brundisium and the Messapian army is still listed'. The Messapian Aulus died (DET_ALIVE — survived but army destroyed) when Marcus assaulted Uria, but the save still had his units tagged region=Uria with cmd=Aulus, and liveUnitsByRegion just fell back to unit.region for any cmd not in the live armies-to-render. Now liveUnitsByRegion checks liveDeadCharUuids and drops units whose commander is flagged dead. Caveat: only works when the runtime-memory uuid in the log matches the save's stored secondaryUuid (often does not — see save_rome10 Aulus where save uuid is cb79a1ae but log emits 2b0992e0). A name+faction-keyed dead lookup is the next step if the uuid path doesn't catch enough." },
    ],
  },
  {
    version: "0.9.264",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Navies now render on the map. The user pushed back that save_rome10 'def has a fleet', so I scanned the save bytes directly: 6+ occurrences of 'naval' / 'bireme' / 'liburn' ASCII strings — they're definitely there. Found TWO bugs preventing detection: (1) the unit-record region-name validator required an UPPERCASE first letter (filter against random noise), but RTW stores all naval units under region 'the sea' (lowercase) — every naval unit got dropped at the region scan. Validator now accepts lowercase too; the post-region 0xffffffff (or small+uuid) terminator is enough to keep noise out. (2) Once parsed, naval units have commanderUuid=0 (RTW stores fleets as anonymous, no character bound via the unit record) so they never enter `unitsByCommander` and never become navy-class liveArmies. Added anonymous-fleet synthesis: each naval unit's army_uuid sits at u32(i-20), maps 1:1 to a type-4 world-object position record. Multi-ship fleets only carry the uuid on the first ship; subsequent ships inherit via file-order. Save_rome10: 53 naval units → 46 fleets, all 46 with valid positions. Each becomes a navy-class liveArmies entry labelled '<faction> fleet'." },
    ],
  },
  {
    version: "0.9.263",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Region color now flips immediately when a settlement is captured live (the user reported siege won → live-event panel said 'Salentinia attached to romans_julii' but Uria stayed messapians-purple on the map). The region_attach handler was updating `regions[rgbKey].faction` and `factionRegionsMap` but NOT `currentOwnerByCity` — which is the live-ownership override the map render actually reads (App.js:3767). So the map kept showing the pre-capture color until the next save snapshot refreshed `currentOwnerByCity` from the save. Now the handler also flips `currentOwnerByCity[city]` to the new faction, mapping region name (e.g. 'Salentinia') back to the city name (e.g. 'Uria') via the regions dictionary." },
    ],
  },
  {
    version: "0.9.262",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "0.9.261's passenger-propagation fix didn't actually move Aulus's marker — backfill loop synth was emitting `faction: p.faction` (null at transfer time) where the poll loop was already using `p.faction || ev.faction`. So when the user re-attached log-watch and the backfill replayed the merge events, Aulus's synth move went out with faction=null. The renderer's keyFromName produced `aulus|gabinius|` (empty faction segment) and Tier 1 in armiesToRender looked for `aulus|gabinius|romans_julii` — miss. Backfill now uses the same `p.faction || ev.faction` fall-back as the poll loop. Verified by reading save_rome10.sav + the actual message_log.txt: confirmed transfer event fires for Marcus/Aulus uuids, fresh synth produces correct key now." },
    ],
  },
  {
    version: "0.9.261",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Aulus's marker now follows when Marcus moves the merged stack. Inspected save_rome10's actual message_log.txt: the engine emits `transferring general(Marcus...) unit(...) from army(...) to named general(Aulus...):army(...)` then Marcus emits BESIEGE/MOVING_NORMAL for the move to Uria — Aulus's uuid never appears in any movement event before OR after the merge (Aulus is the governor of Taras, stationary by role). So the MOVED general is the active mover and the receiving named-general is the passive passenger that needs synthetic position propagation. Main now parses the general-transfer event, tracks each leader's passenger list, and synthesizes a move event for every passenger when the leader moves. After 0.9.259's same-tile-merge UI logic kicks in on top, the combined stack displays as one block at the new tile." },
      { type: "investigation", text: "Navy regression diagnosed but NOT yet fixed. Inspected save_rome10 + T5 autosave directly. Findings: save_rome10 genuinely has 0 naval-prefix units across all factions (you lost them between T5 and rome1 — game state, not parser bug). The T5 autosave has 18 naval-prefix units, but ALL have `commanderUuid = 0` in their unit record — RTW stores fleets as anonymous, with no character bound via the unit record's commander field. The current pipeline filters commanderless units into the garrison bucket, so navies never get classified as navy-class armies. Fix needs a separate 'anonymous fleet' synthesis path that groups naval units by region+faction marker and pairs them with type-4 world-object position records. Flagged for a follow-up ship." },
    ],
  },
  {
    version: "0.9.260",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Character age now sits inline next to the name (`Aulus Gabinius · age 20`) instead of being right-aligned across the panel — easier to scan when the panel widens for big regions." },
      { type: "feature", text: "Right-click any character in the Characters panel to open a popup listing every trait they carry with its level. Trait names are humanized from the engine's CamelCase ids (e.g. `RomanConquerorMessapians` → `Roman Conqueror Messapians`); this won't match the in-game tooltip text exactly (that lives in `text/export_VnVs.txt` localization strings) but it's enough to see at a glance who the seasoned commanders / corrupt governors / drunkards are. Subtitle shows the role (Faction Leader / Heir / Princess / General) plus age." },
    ],
  },
  {
    version: "0.9.259",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Multi-general stacks now display as ONE merged army block instead of two separate panels. RTW armies hold up to 20 units with any number of general units inside, so when Marcus Livius Drusus moves onto Aulus Gabinius's tile to merge stacks, the in-game result is a single 15-unit army with two generals — not two armies sharing coords. The save still records each general's bodyguard under its own `cmd` field, so the byCmd grouping produced two separate entries. RegionInfo's field-army panel now post-passes mergedOwn/mergedOthers and combines any entries that share (faction, x, y) into one block titled `Aulus Gabinius + Marcus Livius Drusus the Eagle` with all 15 units listed together. Position comes from armiesToRender so live log moves are honored." },
    ],
  },
  {
    version: "0.9.258",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Own-faction generals parked in enemy territory no longer get reclassified as enemy. The army-faction re-attribution (added 0.9.222 to fix rebel captain_card misattribution) was unconditionally overwriting `army.faction` with whoever owns the region the bodyguard's parked in. So Aulus Gabinius (romans_julii) standing inside the `Taras` region got re-tagged as `taras` and showed up in Tarentum's garrison panel mixed with Milon's actual defenders. Re-attribution now skips identified v1 characters (those with parsed traits) and only fires for placeholder commanders where the captain_card_marker fallback can't be trusted. Same gate applied to all three load paths (initial save-watch, reparse, characters-init)." },
    ],
  },
  {
    version: "0.9.257",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Live tracking now works for characters who got a trait-driven cognomen (Marcus Livius_Drusus → Marcus Messapivs after capturing Brundisium, etc.). The 0.9.225 epithet override REPLACED `lastName` with the new cognomen for display, but the engine continues to emit MOVING_NORMAL events using the BIRTH name — so save key `marcus|messapivs|romans_julii` was matching against log key `marcus|liviusdrusus|romans_julii`, missed Tier 1, and the marker stayed put. Preserves the birth name as `originalLastName` and uses that for matching while keeping the epithet for display. Fixed in both the worker path and the synchronous fallback." },
    ],
  },
  {
    version: "0.9.256",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Captured-but-alive characters now disappear from the map immediately. The engine emits DYING events with `death_type(DET_ALIVE)` for characters who survived a battle but lost their army (typical of a settlement defender post-capture — Titus at Brundisium was the visible case). Main was filtering those events out via `!ev.alive`, so they never reached liveDeadCharUuids and the marker stayed glued to the old garrison tile until the next save snapshot caught up. Now we treat ALL DYING events as 'remove from map' regardless of death_type — the army is gone in either case, and the save will catch up to confirm. Also include charUuid in the death payload so the renderer can match by uuid as well as by name." },
    ],
  },
  {
    version: "0.9.255",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Fixed compound-surname key mismatch that was orphaning live moves for every Roman patrician. The engine writes log lines with surnames separated by SPACES — `Lucius Valerius Flaccus` — while save records use UNDERSCORES — `Valerius_Flaccus`. My keyFromName took only `parts[1]` as the lastName stub, producing log key `lucius|valerius|...` vs save key `lucius|valeriusflaccus|...`, so the match cascade's Tier 1 missed and the position update never reached the save army. Now: concatenate all parts after the firstName with underscores stripped, AND strip a trailing 'the X' trait-epithet phrase. Both sides produce `lucius|valeriusflaccus|...` — Tier 1 matches and Lucius's marker tracks every move event in real time." },
    ],
  },
  {
    version: "0.9.254",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Removed the spinner too — the loading pill is now just the shimmering text. Single sweeping gradient through 'Loading save… <stage>' carries the progress signal." },
    ],
  },
  {
    version: "0.9.253",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Save-loading pill: dropped the standalone progress stripe and put a shimmer animation on the stage-label text instead. A bright band sweeps left→right through the text continuously, signalling 'still working' the same way the stripe did but without the extra widget. Cleaner look, less screen real-estate." },
    ],
  },
  {
    version: "0.9.252",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "MOVING_NORMAL log lines with a trailing 'seige_scroll scroll closed' suffix now match. The engine appends that token (its typo for 'siege', kept verbatim) to character moves emitted while a siege scroll was open in-game — common for any move adjacent to a settlement currently under siege. The regex's `$` anchor rejected those lines, so every move logged during siege-active turns was silently dropped and the marker stayed frozen at the pre-siege tile until the next save snapshot caught up. Drop the anchor; trailing tokens are ignored. Verified against the user's message_log.txt line for Lucius Valerius Flaccus's E↔W shuffle outside Brundisium." },
    ],
  },
  {
    version: "0.9.251",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Save-loading indicator is now a compact pill in the top-right corner instead of a full-width banner. Less intrusive — keeps the rest of the toolbar usable while a parse runs in the background. Same content (spinner, stage label, animated stripe), just smaller and out of the way." },
    ],
  },
  {
    version: "0.9.250",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Save-reload progress bar now shows during in-game saves too. Earlier the loading banner only flipped on at the initial save-watch-start; reparses triggered by in-game saves emitted progress events but the banner was already gone, so the user saw a frozen UI for the duration of the parse. Now: any progress event from main re-shows the banner with the current stage label and the indeterminate stripe animation." },
      { type: "improvement", text: "Eliminated factions no longer clutter the icon grid. In Live mode, factions with zero regions in factionRegionsMap (which the capture-event handler updates the moment the last city falls) are filtered out of the sidebar. Slave/rebel factions stay visible since they're synthetic placeholders and may not list their occupied tiles in the map." },
      { type: "improvement", text: "Removed the '+14 −7 since turn 0' diff badge from the Garrison header. Cleaner panel layout — diff against turn 0 wasn't conveying useful info during play." },
    ],
  },
  {
    version: "0.9.249",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Character deaths now propagate live — no save snapshot required. The death-event handler already removed defeated characters from liveCharPositions, but the marker on the map (driven by saveLiveArmies) lingered until the next save reflected the death. Now: every DYING / death_type log event also adds the charUuid to a `liveDeadCharUuids` set, and armiesToRender filters out any save army whose commanderUuid or primaryUuid is in that set. Concrete case: defenders wiped during a siege resolution disappear from the map immediately instead of staying frozen at their settlement until autosave." },
    ],
  },
  {
    version: "0.9.248",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Buildings parser moved to a worker thread, running in parallel with the chars worker AND parseSaveData. Three CPU-bound passes now overlap on three cores: ~1-1.5s chars + ~1-1.5s parseSaveData + ~200-400ms buildings, total wall time ≈ max-of-three. Wired across all three load paths (initial, reparse, characters-init), each with sync fallback if worker spawn fails. The in-game save reload that was hanging the main thread should feel ~300-500ms shorter on top of 0.9.247's O(N+M) win." },
    ],
  },
  {
    version: "0.9.247",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Building→settlement linking is now O(N+M) instead of O(N×M). The original double loop was iterating ~30,000 buildings × ~1,300 settlements = ~39 million tight iterations on every save parse. Both arrays were already sorted by file offset (sequential byte-order scans produced them) so a two-pointer walk does the same work in ~31,300 iterations. Saves ~200-500ms per parse — particularly noticeable on the in-game save reload (when the file-watcher fires reparseLatestSave)." },
    ],
  },
  {
    version: "0.9.246",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Marker now follows live moves both ways. 0.9.244's proximity dedupe SKIPPED stale log entries instead of using them, which broke the 'move back to original tile' case: the save army stayed at the post-first-move position, and the matching log entry got dropped, leaving the marker frozen at the wrong tile. Replaced skip-with-update: when a same-faction same-firstName log entry is within 2 tiles of a save army (i.e. they're the same character whose match cascade missed), update the save army's (x, y) to the log entry's position. Marker now tracks each move event in real time." },
      { type: "fix", text: "Army-marker tooltip no longer spills outside the viewport. The combination of `whiteSpace: nowrap` and a long traits line let it overflow the right edge into the side info panel. Removed nowrap (now wraps via wordBreak), and clamped position: when the tooltip would overflow the right edge it flips to the left side of the marker, and bottom-edge overflow shifts up." },
    ],
  },
  {
    version: "0.9.245",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Worker-thread parallelism for the v1 character scan. The byte-by-byte scan over the full save (~1-1.5s on a 30MB file) now runs in a worker_threads worker, in parallel with the main thread's parseSaveData (which also scans the buffer for buildings/settlements/units). Total Live-load time drops from sum-of-scans to max-of-scans — ~1-1.5s saved on top of 0.9.244's redundant-read fixes. Worker also applies trait epithets so the main thread doesn't redo that pass. Falls back to synchronous parsing if worker spawn fails or mod data isn't loaded yet — zero risk of behavior change." },
    ],
  },
  {
    version: "0.9.244",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Skipped two redundant 30MB save-file reads on the initial-load path. parseSaveData now accepts a buffer instead of a path (saves ~150-300ms per call where the caller already holds the buffer); the save buffer is also cached at module level so characters-init reuses it instead of reading from disk again. Net: ~300-500ms shaved off Live mode startup with zero behavior change." },
      { type: "fix", text: "Duplicate 'log-tracked' marker after a 1-tile character move. The match cascade succeeded for the save army (its marker moved to the new tile correctly) but a leftover livePos entry whose key didn't match created a synthetic log-only marker right next to it. Added proximity dedupe: any log-only synthetic within 2 tiles of an existing save army of the same faction (and, when known, same firstName) is treated as the same character and skipped. Reproduced and fixed against Lucius Valerius_Flaccus the Defender after his eastward move." },
    ],
  },
  {
    version: "0.9.243",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Army-faction re-attribution now runs on ALL save-load paths (initial saveWatchStart, characters-init, reparseLatestSave). Previously it only fired in reparseLatestSave, so on the first save Provincia loaded each session, captain_card_<faction>.tga marker fallbacks misattributed factions and stuck. Concrete case (save_rome4): Titus's messapian general bodyguard sits at file offset 0x1ae4768; the most-recent captain_card marker BEFORE that offset is `captain_card_massalia.tga` (because messapians' own captain_card path appears later in the file or is missing). The marker fallback gave Titus's army faction='massalia', and the Garrison panel's faction-match check rejected him as foreign-faction in messapian-held Brundisium — leaving the panel showing Titus as the commander but 'No units stationed'. With re-attribution running on initial load, Titus's army gets faction='messapians' from currentOwnerByCity['Brundisium'] and his stack lands in the Garrison panel where it belongs." },
    ],
  },
  {
    version: "0.9.242",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Settlement-tile garrison classification was failing on a y-axis mismatch: cityPixels (built from canvas getImageData) is in TOP-DOWN visual coords, but army positions in the save (type-6 records) and descr_strat are BOTTOM-UP world coords. Compared as strings, they almost never matched — only ~10 of 857 commander-led armies were classified as garrison across the whole map, and Titus at Brundisium showed in 'Region owners armies' instead of Garrison even though he was sitting on his own city. All settlement-tile comparisons now flip cityPixels.y to world coords (`H-1-y`). Stations the messapian Titus's stack inside Brundisium's Garrison panel; should also flip the global garrison count from ~10 to several hundred, matching the actual number of governed cities on the map." },
    ],
  },
  {
    version: "0.9.241",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Damaged units now display the right way around. Unit-record bytes at regionEnd+8 hold MAX soldiers, +12 holds CURRENT — my parser had the labels swapped, so a damaged equites unit (real 94/120) rendered as '122/96' (max/current) instead of '96/122' (current/max). Full-strength units hid the bug because both fields are equal. Confirmed against the byte dump on save_rome4 (Marcus Livius_Drusus's damaged equites)." },
    ],
  },
  {
    version: "0.9.240",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Roman generals no longer drag each other across the map. The live-position match cascade had a Tier 2 (firstName + faction prefix) fallback that fired whenever the save's lastName didn't exactly match the log's — useful for renamed/cognomen cases, but in faction-heavy lines like the Roman Marcuses (heir + 2 active consuls + new generals all named Marcus) it grabbed the FIRST 'marcus|*|romans_julii' key in livePos and applied it to every save Marcus, dragging Marcus Ogulnius_Gallus and Marcus Atilius Regulus the Defender (both at Rome) onto Brundisium where Marcus Livius_Drusus was besieging. Now: Tier 2 only fires when the save army has a PLACEHOLDER firstName (e.g. 'romans_julii captain' for v1-undecoded commanders) AND there is exactly ONE candidate key in livePos. Same conservative rule for the unknown-faction Tier 3." },
    ],
  },
  {
    version: "0.9.239",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Foot units now follow their general by FILE ORDER, not save-region tag. Was: cmd=0 foot only attached to a preceding general if the general's region tag matched. That broke the army-merge case (user moves new general Marcus into Uria, grabs Aulus's army, moves merged stack to siege Brundisium): the 13 foot still carried their old Taras region tag while Marcus's bodyguard now tagged Metapontion, and the strict region match dropped them all — Marcus's army showed 1 unit. Now: foot attach to the immediately preceding cmd!=0 general regardless of region tag, since the save writes each army's units contiguously and the tags often lag mid-turn moves. Trade-off: if RTW ever stores a true settlement garrison right after an unrelated general's record, the garrison would mis-attribute — that ordering hasn't been observed in practice." },
    ],
  },
  {
    version: "0.9.238",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Garrison and 'Region owners armies' panels now require faction match for the settlement-tile rule. Without this, a foreign army standing on (or whose live position resolved to) the settlement tile got promoted into the city's garrison list — Marcus Ogulnius_Gallus's bodyguard appeared inside messapian-held Brundisium even though he's a Roman, and the actual Roman besieger (Marcus Livius_Drusus) was symmetrically pulled out of 'Region owners armies'. Now: only commanders whose faction matches the region owner are treated as garrison; everyone else stays in the field-armies panel where besiegers and through-passers belong. Same fix on both panels so nothing double-lists." },
    ],
  },
  {
    version: "0.9.237",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Character parser no longer misses characters whose +18..+25 'spouse uuid' slot is populated. The 0xff bytes there were a 'field unset' marker, not a structural anchor — a character who got married, gained certain traits (RomanConquerorMessapians, etc.), or otherwise had that slot filled was rejected. Aulus Gabinius post-conquest in save_rome3 was the first observed case (his record at 0x1504ae2 carried a Cornelius_Scapula name index there instead of 0xff). New anchor: traitCount + first trait record validity (real trait id, plausible level). Verified: Aulus now decoded correctly with all 28 traits." },
      { type: "fix", text: "App was hanging on busy saves. The 0.9.235 Tier 0.5 commanderUuid match in armiesToRender did O(armies × livePos) per memo run — combined with active log streaming on a multi-thousand-character save, that's millions of iterations per render. Now: build a charUuid → entry index ONCE per memo run, both Tier 0 and Tier 0.5 lookups are O(1)." },
    ],
  },
  {
    version: "0.9.236",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Stack standing on the city tile is the garrison, not a field army. After 0.9.235 fixed Aulus's units bucketing to Salentinia, the panel still listed them under 'Region owners armies' because the garrison filter only accepted commander-LESS units OR the appointed governor's units — and Aulus isn't decoded as a v1 character (his cmd uuid has no v1 record), so the governor lookup couldn't see him. New rule: any commander whose live position equals the settlement tile of the clicked region is treated as garrison, regardless of governor-resolution status. Mirrors RTW's own UI which shows everything on the city tile as defenders. Field-armies symmetrically excludes those uuids so nothing double-lists." },
      { type: "fix", text: "Removed the duplicate Aulus marker at his Taras spawn. The descr_strat fallback was still adding a synthetic army marker at every starting position from descr_strat, even when the actual character had moved off that tile in live play. So Aulus showed up TWICE on the map: once at his original (337, 385) Taras position (descr_strat synthetic) and once at Uria (save position updated by the log). Now: synthetic-marker creation is skipped when log-position events are flowing — save data + log positions become the single source of truth. The descr_strat unit-list borrowing for save armies at matching tiles is preserved." },
    ],
  },
  {
    version: "0.9.235",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Two related bugs that combined to leave Aulus duplicated on the map AND Salentinia/Uria's panel empty after he captured the city: (a) settlement tiles are black on the regions TGA (per RIS convention; ports are white) so the live-region lookup returned null for armies sitting in a city, leaving their units bucketed under the stale save region — fixed with a cityPixels fast path + 1-tile neighbourhood scan; (b) Aulus's bodyguard cmd uuid has no matching v1 character record (lesser-general / promoted-captain class, missed by both LAYOUT_A and LAYOUT_B), so the save army stored a placeholder firstName 'romans_julii captain' that didn't match the log's 'Aulus Gabinius', leaving the save entry stuck at its old position while the log entry created a separate marker — fixed by adding Tier 0.5 in armiesToRender's match cascade: when primaryUuid is null, fall back to commanderUuid → log charUuid (engine emits the same id for both). The live position now reaches the save army → marker moves AND units re-bucket to the destination region, no duplicate." },
    ],
  },
  {
    version: "0.9.234",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Governor resolution unified across all save-load paths. Three places ran governor lookup: (1) reparseLatestSave (correct — used full extras.characters with primaryUuid keying), (2) initial save-watch start (BUG: used a flattened charactersByRegion view that drops chars without a region and lacks primaryUuid keying), (3) characters-init after mod-data load (BUG: didn't re-resolve at all). Both bugs caused well-known leaders like Quintus Ogulnius_Gallus at Rome to show as '(governor — character record not decoded)' even though the v1 parser had decoded him fully — a stale unresolved entry from the pre-mod-data initial pass survived into the renderer. All three paths now use the same `extras.characters` + sec/primary uuid keying logic." },
    ],
  },
  {
    version: "0.9.233",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Garrison + Field-army panels now follow live commander moves. The map markers already shifted in real-time on each MOVING_NORMAL log event, but the side panels were still reading the save-time unit-record region — so an army that moved mid-turn would slide on the map yet still appear under the OLD region's panel until the next save snapshot. Now: armiesToRender carries each army's current region (resolved from its live (x,y) via the regions-map TGA pixel data), and a new liveUnitsByRegion memo re-buckets every save unit using its commander's current region. Garrison + Field-army panels read from this map. An army leaving its home tile drops out of that region's panel and appears in the destination's panel as soon as the log fires the move — same cadence as the marker." },
      { type: "improvement", text: "Note on the capture→colour-flip path: this was already wired (App.js:2258 since 0.9.213) — captures from message_log.txt update factionRegionsMap + regions[].faction immediately, so the BASE map layer flips colour the moment the engine logs the capture. The save-derived currentOwnerByCity override (which fires after the next save write) is the redundant secondary path. The lag the user saw earlier was the save-watch debounce (now 600ms in 0.9.231)." },
    ],
  },
  {
    version: "0.9.232",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Army markers on the map are now ON by default and persist across sessions. The 'Armies' map-mode button has been wired up since 0.9.217 (faction-coloured halos at every commander's position, garrisons / field armies / navies separable via sub-toggles), but it defaulted OFF — the user reported 'Provincia doesn't visualise army positions' because the toggle was buried. Now defaults ON, persisted to localStorage like other map toggles." },
      { type: "improvement", text: "Bumped marker size: floor 1.5px → 3px screen-pixels, with a thicker faction-coloured halo. The old size was readable only when zoomed all the way in, which is why the feature felt invisible. New size is spottable at full-map zoom without cluttering when zoomed out further." },
    ],
  },
  {
    version: "0.9.231",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Save-watch debounce 1500ms → 600ms. The user reported the map colour flipped to the new owner eventually after a mid-turn capture, just slowly. Most of the lag was sitting in the save-watch debounce, which was set conservatively to wait out RTW's multi-stage save burst. 600ms is short enough that the colour flip lands ~1s after pressing save (not ~3s) and still clears the burst — the reparse-lock + tail-coalescing already handles any straggling writes that arrive during the parse." },
      { type: "improvement", text: "Quieted the 0.9.230 map-render diagnostic. It now only logs when the override actually flipped a region's owner (i.e. on the conquest itself), not on every repaint. Easier to spot real ownership transitions in the console without scrolling through dev-mode toggles." },
    ],
  },
  {
    version: "0.9.230",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Diagnostic log on map repaint. The user reported a captured region (Salentinia → romans_julii) staying its old colour even though the events log showed the capture and the save's per-settlement uuid had updated. Direct save inspection confirmed the data is correct (Uria's marker-1944 uuid = Rome's, and the resolver maps it to romans_julii) but couldn't reproduce the stale render. Console.log now prints how many cities the live-ownership override touched on each repaint and a few samples of regions whose colour changed — so the next time it happens the dev console pinpoints whether the override is running, applying the right faction, or being ignored downstream by colour/canvas caching." },
    ],
  },
  {
    version: "0.9.229",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Removed the redundant '↳ Bodyguard: greek general (63/63)' sub-line under the governor name. That was a 0.9.224 workaround for when the bodyguard unit wasn't rendering anywhere; since 0.9.227 the whole governor stack now appears as unit cards in the Garrison panel directly, so the sub-line just duplicates info already on the cards. Kept a discreet '(bodyguard currently at <region>)' note for the rare case where the bodyguard's unit-record region differs from the settlement's region — that's still useful context the unit cards don't show." },
    ],
  },
  {
    version: "0.9.228",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Field-army panels now group armies by faction. 'Region owners armies' and 'Other faction armies' both render a faction sub-header (e.g. 'Romans:') above each group's stacks, so multiple armies from the same faction collapse under one heading instead of repeating the faction tag on every line. Same grouping applied to both panels for consistency." },
    ],
  },
  {
    version: "0.9.227",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Governor's stack now displays in the Garrison panel instead of 'Region owners armies'. After 0.9.226 attached foot units to their general, Milon's Tarentum garrison (1 bodyguard + 6 greek foot, all attributed to Milon) moved out of the empty Garrison panel and into 'Region owners armies'. The user expects the governor's stack to BE the garrison — that's how it's stationed in-game. Garrison filter now also accepts units commanded (or inferred-commanded) by the settlement's governor; fieldArmies symmetrically skips that uuid so nothing double-counts. 'Region owners armies' shrinks to truly external own-faction stacks (e.g. a separate field army passing through), which is what the section name implies." },
    ],
  },
  {
    version: "0.9.226",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Foot units now follow their general's stack instead of dumping into the destination region's garrison panel. Reproduced on save_rome1.sav (RoR turn 1): Aulus Gabinius's invading army at Taras (1 bodyguard + 13 roman foot) and Milon's Tarentine garrison (1 bodyguard + 6 greek foot) were both showing as 'garrison' because foot units carry commanderUuid=0 in the save and the previous grouping pass refused to attribute them. Restored the file-order foot-attribution rule, but with a region-equality guard so a Roma garrison stored after a Frentania field-army record doesn't get misattributed (the regression that made me drop the original sequential pass)." },
      { type: "fix", text: "Greek/single-name characters now decode. Milon of Tarentum, Leophron, Pyrrhos, and ~150 other faction leaders without family surnames were silently rejected by the v1 parser because their record format omits the lastName u32 — every in-record field shifts -4 (age at +22 instead of +26, traitCount at +298 instead of +302, etc.). Parser now anchors variant detection on the 8-byte 0xff sentinel position (LAYOUT_A: +18..+25, LAYOUT_B: +14..+21) and applies the right field offsets for each. The user's RoR T1 save: 61 chars → 2014 chars (148 leaders, all with sensible names + ages + traits). Greek-faction governors now show up by name in the garrison panel instead of '(governor — character record not decoded)'." },
    ],
  },
  {
    version: "0.9.225",
    date: "2026-05-10",
    items: [
      { type: "feature", text: "Trait-driven cognomen overrides. RTW changes a character's displayed surname when they earn certain traits — e.g. capturing Messapian territory grants `RomanConquerorMessapians`, whose Epithet text is 'Messapivs'; the in-game UI shows 'Aulus Messapivs' while the save still stores his birth surname 'Gabinius'. The app now parses `export_descr_character_traits.txt` for `Epithet` keys, resolves them against `text/export_vnvs.txt` (UTF-16), and overrides each character's lastName based on their highest-level epithet trait. Nicknames (\"the Drunkard\", \"the Pious\") are detected separately and appended after the surname rather than replacing it. 991 epithet-bearing traits parsed from RIS imperial — covers RomanConqueror*, Africanus, Magnus, etc. Confirmed against user's RoR T5 save: Aulus Gabinius (governor of Uria) now displays as 'Aulus Messapivs', matching the in-game UI." },
    ],
  },
  {
    version: "0.9.224",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Governor's bodyguard now appears under the governor line in the Garrison panel, even when the bodyguard's unit-record region differs from the settlement's region. 0.9.223 fixed the parser so the unit was found, but the garrison panel filter dropped it: garrison strictly = commander-LESS units, and field-armies filter by clicked region. Aulus Gabinius's bodyguard at Uria/Salentinia got attributed to the unit-record's region (Taras) and didn't show up in Salentinia's panel at all. Now: when a city has a governor whose uuid matches a bodyguard unit anywhere on the map, the bodyguard is rendered as a sub-line of the governor, with a 'currently at <region>' note when the bodyguard is parked elsewhere — e.g. 'Aulus Gabinius — romans_iulii ↳ Bodyguard: roman general (28/33) — currently at Taras'." },
    ],
  },
  {
    version: "0.9.223",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Unit parser was missing freshly-recruited general bodyguards. After a unit's region UTF-16 string the parser required a `ff ff ff ff` terminator, but recently-recruited bodyguards use a small u32 instead (e.g. `0d 00 00 00`). Aulus Gabinius's bodyguard at Taras (the governor the user installed at Salentinia/Uria) was being skipped — that's why the user's report 'a male character who is of age always has a bodyguard' showed an empty garrison. Parser now also accepts the small-u32 variant when the next 4 bytes look like a real commander UUID. Roman generals on the user's RoR T5 save: 35 → 36 records." },
    ],
  },
  {
    version: "0.9.222",
    date: "2026-05-10",
    items: [
      { type: "feature", text: "Decoded the per-settlement GOVERNOR field. Each settlement marker has the governor's character UUID at marker-1940 (4 bytes after the owner UUID at marker-1944). Cross-referenced against v1 characters to attach a name. Confirmed on user's RoR T5 save: Rome → Quintus Ogulnius_Gallus (player leader), Uria → Aulus Gabinius (the governor the user just installed after conquering Salentinia). The garrison panel now shows 'Governor: <name>' even when the character has no bodyguard army (= no unit record link), which was the case for the user's Salentinia/Uria report. Fall back to '(governor — character record not decoded)' when the uuid points to a character v1 doesn't recognize." },
      { type: "fix", text: "Army faction attribution: rebel-faction armies (Picentes, Salentinians, etc.) were getting tagged with the most-recent `captain_card_<faction>.tga` marker before their unit block. Rebel factions don't have captain_card markers, so a Picentine army at Asculum showed as 'pergamon captain'. Now: after currentOwnerByCity is resolved, every army's faction is overridden with the region's current owner (bridging through descr_regions' region→city map). Picentes army at Picenum now reads as Picentes." },
    ],
  },
  {
    version: "0.9.221",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Save-watch reparse lock now coalesces tail events instead of dropping them. The 0.9.213 lock prevented hangs from concurrent parses, but if a save fired during a parse the second event got silently discarded — the renderer kept showing stale data until the NEXT save. Now: in-flight parses set a pending flag; when they finish they immediately fire one more reparse. So the latest save always wins, no events lost, no overlapping parses." },
    ],
  },
  {
    version: "0.9.220",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Right-click any faction tile in the Factions sidebar to open its card (large icon + display name + internal id). Same overlay the homeland-row icons use — single InfoPopup handles all faction-card sources." },
    ],
  },
  {
    version: "0.9.219",
    date: "2026-05-09",
    items: [
      { type: "improvement", text: "Wealth panel: live mode now shows current regions (from the save's owner UUIDs, ↑ green / ↓ amber arrows when changed from starting count) and live army count per faction (parsed from the save). Sort changed to current-regions descending. Treasury still shows starting denarii from descr_strat — live treasury values aren't decoded from the save yet (the engine stores them in a separate ECONOMICS_DATA section we've located but not field-mapped)." },
    ],
  },
  {
    version: "0.9.218",
    date: "2026-05-09",
    items: [
      { type: "feature", text: "Parser-stats badge in the Factions header (live mode). Shows total units · armies · conquests at a glance, with a hover tooltip listing every count: Units / Armies / Characters parsed / Settlements with owner / Conquests detected. Lights amber when any count looks suspicious (e.g. zero units in a populated save). Spot regressions instantly without diving into logs." },
      { type: "improvement", text: "Test coverage: added 11 new vitest cases covering unitParser (identical-pair determinism, RIS-imperial unit/region count sanity, long region names, naval-unit detection) and saveOwnershipParser (plurality-vote conquest recovery, uuid=0 → slave, identical-pair determinism). 26/26 passing." },
    ],
  },
  {
    version: "0.9.217",
    date: "2026-05-09",
    items: [
      { type: "improvement", text: "Every commander-led army now gets a faction attribution via the `captain_card_<faction>.tga` boundary markers in the save. On a turn-22 athens save: 1116 armies, 43 named (matched to v1 characters), and ALL 1116 tagged with a faction. Armies whose commander isn't decoded show as e.g. 'romans_julii captain' instead of '(unknown)' — at minimum you see whose army it is." },
    ],
  },
  {
    version: "0.9.216",
    date: "2026-05-09",
    items: [
      { type: "improvement", text: "Garrison and Field Armies panels are now non-overlapping. Garrison = the region's commander-less units (settlement defenders); every army with a commander shows up under Field Armies, named (when the parser identifies the commander) or aggregated by faction (when it doesn't). Previously a garrison army with a commander could appear in BOTH lists, or be hidden from both because the 'commander exactly on settlement tile' shortcut required pixel-perfect coords we don't always have." },
    ],
  },
  {
    version: "0.9.215",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "Field-army leader names + factions: on RIS imperial, every army on the map showed as '(unknown)' because the army-builder only consulted v2 scripted characters (which return zero on imperial). Now also indexes v1 characters by their secondaryUuid and reads `captain_card_<faction>.tga` boundary markers to attribute each army's faction by file offset. Roman armies show as Roman, Carthaginian armies as Carthaginian, etc. — even ones whose commanders aren't in the v2 scripted set." },
    ],
  },
  {
    version: "0.9.214",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "Army grouping rewrote: was sequential (file-offset-walk + region-match), is now region-based (group every unit by its own commanderUuid; commander-less units = settlement garrison). The old approach silently dropped 36% of units on RIS imperial because the file's storage order doesn't encode stack membership in a way that aligns with region — a Roman garrison in Roma sitting in the file after a Frentania field-army record got rejected as a 'region mismatch'. New approach trusts the unit record's own bytes: each unit goes exactly where the engine wrote it." },
      { type: "feature", text: "'Homeland of:' switched from comma-separated text names to a row of faction icons. Hover any icon for the display name; right-click opens a faction card overlay (large icon + display name). Saves space, more visual." },
      { type: "feature", text: "Faction-icon right-click → card view. Currently active in the Homeland-of row; the InfoPopup now handles type=faction so any future call site can light up the same overlay." },
    ],
  },
  {
    version: "0.9.213",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "App locked up when fs.watch fired bursts of save events. After making parseSaveData async (0.9.211), two debounced reparses could overlap — both running parsers in parallel, both writing lastSaveData, both flooding the renderer with IPC events. Added a single-flight lock (_reparsing flag): if a parse is already in progress, the next event is dropped. The 1.5s debounce already filters most bursts; the lock catches the residual." },
      { type: "fix", text: "Region info panel showed an empty unit list even when units were clearly stationed there (user reported a Roman governor in Salentinia with no units shown). The garrison filter required each unit's commander to (a) exist in the saveCharactersByRegion-derived UUID map AND (b) be positioned EXACTLY on the settlement tile. Both conditions fail commonly on RIS imperial: half the v1 chars have no resolvable position, governors stationed on the city tile but parsed to coords ±1 get rejected. Switched to: every unit the parser placed in this region is shown. The unit's parsed `region` field IS the right signal — the engine writes it from the army's current tile. Mixes governor's army into the garrison view, but that's better than empty." },
    ],
  },
  {
    version: "0.9.212",
    date: "2026-05-09",
    items: [
      { type: "improvement", text: "Removed the seconds counter from the live-mode loading banner — parses now finish in well under a second so the counter just sat on '0s' and looked broken. Stage label + sliding stripe is enough." },
    ],
  },
  {
    version: "0.9.211",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "Map STILL showed turn-0 borders even with conquests resolved. The faction-color renderer built rgbKey→owner from descr_strat's factionRegionsMap and never consulted currentOwnerByCity, so a conquered Salentinia stayed brown on the map even though the right-side panel correctly read 'Faction: Rome'. Added a live override pass: after building the descr_strat baseline, if a save is loaded and currentOwnerByCity has a different owner for that region's city, the rgbKey gets overwritten before the canvas is painted. Borders now follow the actual save state in real time." },
      { type: "improvement", text: "Loading banner shows finer-grained stage labels: parseSaveData was a single black box behind 'Parsing buildings & settlements' for several seconds; now it ticks through 'Scanning building records' → 'Scanning settlement markers' → 'Linking buildings to settlements' → 'Scanning unit records' → 'Grouping units by region' as it works. Each sub-stage yields to the event loop so the renderer's banner actually receives the update mid-parse instead of after the whole function returns." },
    ],
  },
  {
    version: "0.9.210",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "Conquests weren't showing on the map. The owner-UUID resolver required a 60% descr_strat-anchored majority before trusting a UUID→faction mapping. At mid-game (turn 22+) this rejects ~30% of UUIDs because conquering factions hold a mix of starting + conquered settlements that splits below 60% (e.g., Athens with 4 starting + 3 conquered = 57% rejected). Switched to plurality vote (top faction wins, alphabet tiebreak), since each UUID is unique to one faction and the plurality must be the conqueror's own descr_strat anchor. Also map uuid=0 settlements to the slave/rebel faction (~10 per save). Net effect on athens_t22mid: 936 → 1090 settlements resolved, 90 → 167 conquests detected." },
      { type: "improvement", text: "Live-mode loading banner overhauled. The 0.9.209 % bar appeared stuck at 15% the whole wait because parseSaveData is one big synchronous chunk between the 15%/50% emits — the bar lied. Replaced with an indeterminate animated stripe that always slides, plus an elapsed-seconds counter so users can see 'still working at 4s, 5s, 6s...' instead of a static %. The stage label still updates between phases (Reading save file → Parsing buildings → Parsing characters & armies → Resolving ownership → Done)." },
    ],
  },
  {
    version: "0.9.209",
    date: "2026-05-09",
    items: [
      { type: "feature", text: "Live mode loading banner. Clicking Live used to freeze the window for 5-30s on big mid/late game saves while the main process synchronously parsed everything; the app looked crashed. Now you get an immediate top-of-window banner with: spinner, stage label ('Parsing characters & armies' / 'Resolving settlement ownership' / etc.), progress bar, and a percentage. Implemented by emitting per-stage `save-progress` IPC events from main.js and yielding to the event loop between stages so the renderer's banner actually updates instead of waiting for the whole pipeline. Same banner runs on initial Live activation AND on every save-watch reparse (turn ends, manual saves)." },
    ],
  },
  {
    version: "0.9.208",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "Units / armies on the map were missing or in the wrong place — most badly on mid-to-late game saves. Three independent bugs ganging up: (1) Position record bounds were `x ≤ 200, y ≤ 150` (vanilla RTW map size). RIS imperial is 1020×700; the old bounds rejected 99.6% of legitimate (x,y) records (only 5 out of 1422 made it through on a turn-22 save). Raised to 1100×800 in main.js, characterParserV2.js, App.js (live-log moves filter). (2) Unit-record region-name length capped at 25 chars; 22 RIS regions are longer (Bracarensia_Septentrionalis, Memphites-Letopolites_Nomoi, etc up to 35 chars), so units in those regions were silently dropped. Raised to 50 chars + widened the post-name search window to 80 bytes. (3) v1 character position lookup read u32 at `offset-16`, which is correct for v2 layout but reads junk for v1 — half of v1 chars never got x/y. Switched to the proper v1 commander-UUID source (`secondaryUuid`) with primary/legacy fallbacks. Net effect on athens_t22mid: 5573 → 5626 units, 1188 → 1208 regions, 100% of unit-commander UUIDs resolve to positions (was 0.5%)." },
    ],
  },
  {
    version: "0.9.207",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "Live mode hung for 30+ seconds on initial save parse. Root cause: `findCharacterRegion()` was called once per character (~100 chars at mid-game), each call doing a full-buffer indexOf scan + nested 1000×3×100 inner-loop hunt for unit-name strings. O(N×M) where N=save bytes (~40 MB) and M=character count. Fix: pre-build a `commanderUuid → region` map ONCE from unit records, then each character lookup is O(1). Total parse time drops from ~33 s to ~1 s on a 40 MB save. The legacy `findCharacterRegion` code path is no longer invoked during live parsing (still exported for any caller that needs the slow scan)." },
    ],
  },
  {
    version: "0.9.206",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "0.9.205 wouldn't open: 'Cannot find module ./src/factionRecordParser.js'. The new save-format parsers (factionRecordParser, luaCounterParser) were imported by main.js but missing from electron-builder's files allowlist in package.json — so they got stripped from the packaged asar. Added both to the allowlist; verified the asar now contains them. Apologies for the bricked build." },
    ],
  },
  {
    version: "0.9.205",
    date: "2026-05-09",
    items: [
      { type: "feature", text: "Two new save-format structures decoded and surfaced live. (1) Faction record array — every save contains 239 per-faction state records starting with magic `ff 0a af f0`. The array span is the dominant per-turn bloat source (~90 bytes/turn/faction; projects to ~8.6 MB by turn 400 at 239 factions). New blue badge in the Factions header shows record count + total KB; hover for details. (2) Lua persistent-counter table — 115 named entries near EOF storing every `declare_persistent_counter` value plus engine internals like `turn_number` and faction UUIDs (`id_sparta = 1330481`, `id_romans_julii = 1110011`, `id_athens = 1330201` for RIS imperial). New green badge shows count + the live `turn_number`; hover lists the first 12 counters. Both findings came from the new rtw-sav-parser cracker at C:\\dev\\rtw-sav-parser; round-trip-tested across 10 saves; cross-validated identical-pair determinism. Format details: faction record header is 16 bytes (magic1 + 2× self-pointer + magic2 `f0 0a af f0`) followed by variable per-faction state. Counter format: u32 length + UTF-16LE name + u32 value, contiguous chain. New tests (`factionRecordParser.test.js`, `luaCounterParser.test.js`) — 19/19 passing." },
    ],
  },
  {
    version: "0.9.204",
    date: "2026-05-05",
    items: [
      { type: "fix", text: "Defensive guards around the new tax parsing after a live-mode hang report. main.js: tax pass wrapped in try/catch and gated by header-detected campaign name (only runs on imperial_campaign or ris_classic; other campaigns silently skip). App.js: taxLevel IIFE wrapped in try/catch with relaxed gating — when playerFaction isn't yet known, still shows the parsed value rather than holding the prop. If the hang persists, it's not from the tax pass itself; please share what UI state you see when it happens." },
    ],
  },
  {
    version: "0.9.203",
    date: "2026-05-05",
    items: [
      { type: "feature", text: "Live mode now shows per-settlement tax level (low/normal/high/very_high) parsed from the save. Discovered tonight via differential analysis: setting all of Sparta's 3 settlements to high/very_high/low produced exactly 3 byte transitions per save with values 2/3/0 against baseline=1. The tax byte sits at a fixed offset (settlement_name_offset - 2269) in every settlement record. Enum: 0=low, 1=normal (default), 2=high, 3=very_high. Gated to player-owned settlements only — the byte at that offset isn't meaningful for other factions' settlements in the player's save view (always reads 0). New 'Tax:' row in RegionInfo, color-coded (green=low, grey=normal, orange=high, red=very_high). New scripts/save-cracker/ directory contains the full reverse-engineering pipeline + RESEARCH.md dossier with 15 confirmed format facts." },
    ],
  },
  {
    version: "0.9.202",
    date: "2026-05-05",
    items: [
      { type: "improvement", text: "Export now warns when descr_regions.txt was edited: 'delete map.rwm from the campaign folder so RTW rebuilds it from descr_regions.txt + map_regions.tga next campaign load.' RTW caches descr_regions parsing into map.rwm; without regen the edits silently don't take effect in-game. Alert fires after the export confirm, only when descr_regions.txt was in the dirty set." },
    ],
  },
  {
    version: "0.9.201",
    date: "2026-05-05",
    items: [
      { type: "fix", text: "'+ Add new hidden resource…' button did nothing — Electron's renderer returns null from window.prompt by default. Replaced with an inline input + Add/Cancel that pops in place of the button. Enter commits, Escape cancels; validation errors render in-line in orange. Pre-seeds with the current legend search if it's a valid token." },
    ],
  },
  {
    version: "0.9.200",
    date: "2026-05-05",
    items: [
      { type: "feature", text: "Province ownership changes in dev mode now export to descr_strat.txt. New factionOwnerChanges state tracks {regionName → targetFactionId} per right-click → change owner. patchDescrStrat gained a third pass — applyOwnershipMoves — that parses descr_strat into preface + per-faction blocks (header / settlements / tail), brace-counts each `settlement { ... }` to extract its region name, then physically moves the matched block from its current faction's settlements list to the target faction's. Idempotent (moving to the current owner is a no-op), so reverts collapse cleanly. Faction edits now mark BOTH descr_regions.txt (rebel default) AND descr_strat.txt (campaign owner) dirty; the dirty-set + factionOwnerChanges are both cleared after a successful export." },
    ],
  },
  {
    version: "0.9.199",
    date: "2026-05-05",
    items: [
      { type: "feature", text: "Dev mode: define a brand-new hidden_resource. Hidden Resource legend now shows a dashed '+ Add new hidden resource…' button (devMode only). Click → prompt validates a lowercase/digit/underscore token, sets it as the active selection, and renders an inline 'new — 0 regions' banner with a hint to right-click provinces. The existing right-click 'Add 'X'' menu already toggles arbitrary tokens onto r.tags, so the new HR shows up in hiddenResourcesList automatically once attached to its first region. Search box doubles as a fast-path: typing a non-existing valid token relabels the button to '+ Add \"<query>\"'." },
      { type: "fix", text: "Faction map mode in dev mode now recolors a province immediately when you right-click → change owner. Previously applyDevEdit only updated descr_regions' rebel-default field (r.faction); the canvas reads from factionRegionsMap (descr_strat-derived) for owned regions, so the visible color didn't budge. Now also moves the region between factions in factionRegionsMap, which triggers the coloredOffscreen useEffect via its existing dep on factionRegionsMap. Note: descr_strat ownership patching on export isn't implemented yet, so the change is in-session only — re-importing the campaign restores original ownership." },
    ],
  },
  {
    version: "0.9.198",
    date: "2026-05-04",
    items: [
      { type: "improvement", text: "Region info Religion row now lists every religion in the region with its share (e.g. 'Pagan 50%, Mithras 33%, Jupiter 17%'), sorted strongest first. Percentage = rel_X_N strength as a fraction of total strength across all rel_* tags. Replaces the prior 'top + also'-with-strength-numbers layout, which was redundant with the bar chart underneath." },
    ],
  },
  {
    version: "0.9.197",
    date: "2026-05-04",
    items: [
      { type: "fix", text: "View pill now wraps to multiple rows on narrow windows (matches Map Modes behaviour). Was stuck at width:fit-content + no flex-wrap, so it'd push past the right edge instead of breaking onto new lines." },
    ],
  },
  {
    version: "0.9.196",
    date: "2026-05-04",
    items: [
      { type: "fix", text: "Settlement info: relabel 'Culture:' → 'Rebels:' (descr_regions field 4 is the rebel sub-faction that spawns when the region rebels, not the cultural identity). Tooltip clarifies the meaning." },
    ],
  },
  {
    version: "0.9.195",
    date: "2026-05-03",
    items: [
      { type: "feature", text: "'Homeland of:' row in region info — surfaces RIS's homeland-unhappiness mechanic. Computed by intersecting the region's tag tokens with each faction's homelands.json HR list. Non-native owners catch a happiness penalty in those regions, this row now makes that visible upfront." },
      { type: "feature", text: "Validate Mod Data button (dev mode only). Cross-checks every recruit unit referenced in EDB against the EDU ownership map, flags chains with zero recruits as info, dumps everything to a console.group at console-log severity. Toast summarises errors+info counts so the modder doesn't have to keep DevTools open just to see the headline." },
      { type: "skip", text: "Skipped (would have been overscoped for one ship): trade-route map mode (needs a save-file trade-route parser we don't have); compare two saves diff (needs save-loading machinery); per-army strength heatmap (needs new render-pipeline mode); predict-next-reform panel (needs descr_events / campaign_script trigger parser); settlement income breakdown (needs save-file income parser). Open to scoping any of these as their own ship." },
    ],
  },
  {
    version: "0.9.194",
    date: "2026-05-03",
    items: [
      { type: "improvement", text: "Building popup capability lines now resolve through text/expanded_bi.txt. RIS uses the `dummy <key> bonus N requires ...` syntax — the engine ignores `dummy`, but the in-game building browser shows the human-readable string keyed by `<key>` in expanded_bi.txt. get-building-stats now parses each capability line, looks up dummy keys in expanded_bi, and returns { raw, resolved } per capability. Popup renders the resolved text when available (with the raw EDB line as the hover-title for verification); the humanizer is the fallback for fixed engine capabilities (happiness_bonus, wall_level, etc.)." },
    ],
  },
  {
    version: "0.9.193",
    date: "2026-05-03",
    items: [
      { type: "feature", text: "Building popup: tier ladder (current level highlighted), 'Adds at this level' recruit chips, and humanized capability lines (happiness_bonus bonus 2 → '+2 happiness', wall_level 1 → 'Wall level: 1', etc.). get-building-stats now also returns chainLadder/tierIndex/tierMax/recruits[]." },
      { type: "feature", text: "Reload mod data button. New IPC clear-mod-caches drops every parse cache (EDB, EDU, text dictionaries, building stats, faction cultures); the App.js useEffect that fetches mod data is now keyed on a modReloadTick state so the click triggers a re-parse. Lets modders iterate without restarting Provincia." },
      { type: "feature", text: "EDB/EDU mtime watcher. New IPC get-mod-file-mtimes polls export_descr_buildings.txt / export_descr_unit.txt / text/export_units.txt / text/export_buildings.txt / descr_sm_factions.txt / descr_regions.txt every 4s. When any mtime exceeds the last-seen, the Reload button switches to active state with the mac-active-pulse animation, signalling 'your edit is unseen, click me'." },
      { type: "feature", text: "Hidden-resource cross-link. Hover a hidden_resource chip in the Tags row → every recruit gated on that HR lights up. Recruitable items now carry hrGates: [hrName, ...] populated from positive `hidden_resource X` clauses across both passes (currently-buildable and upgrade-only)." },
      { type: "feature", text: "Region info: 'Religion' text row showing the dominant rel_<X>_<level> tag (highest level wins) and up to three secondary religions. Complements the ethnicities chart, which conveys ancestry not creed." },
    ],
  },
  {
    version: "0.9.192",
    date: "2026-05-03",
    items: [
      { type: "change", text: "All scrollbars hidden across the entire app per request. Global !important rule overrides the previously-skinned .panel / .factions-panel rails AND the runtime-injected scrollbarSkin.js styling AND the new InfoPopup description / capability scrollers. Scroll behaviour itself is preserved (mouse-wheel still works); only the rail and thumb are visually hidden." },
    ],
  },
  {
    version: "0.9.191",
    date: "2026-05-03",
    items: [
      { type: "feature", text: "Building right-click popup now shows stats. New IPC get-building-stats walks the chain block in EDB to the matching `<level> requires` header, then extracts the level body via brace-balance: cost (denarii), construction (turns), settlement_min, and every capability line except recruits (those go to the recruitable column already). Capabilities render in a monospace block — happiness_bonus, gdp_bonus, farming_level, archer_bonus, wall_level / tower_level / gate_strength, etc. — same wording as in EDB." },
    ],
  },
  {
    version: "0.9.190",
    date: "2026-05-03",
    items: [
      { type: "improvement", text: "'Restart and install' now installs silently — no NSIS wizard click-through. autoUpdater.quitAndInstall(true, true): isSilent=true makes electron-updater pass /S to the installer so the wizard never appears; isForceRunAfter=true relaunches Provincia automatically when the install finishes. First-time installs (downloaded by hand) still go through the wizard — only the auto-update path is silent." },
    ],
  },
  {
    version: "0.9.189",
    date: "2026-05-03",
    items: [
      { type: "fix", text: "Building right-click popup now actually shows the wide _constructed banner AND its description. Two bugs were stacked: (1) RegionInfo's buildingItems mapping was dropping b.level and b.culture, so the right-click payload arrived with name=undefined/culture=null — resolveBuildingBanner bails immediately on missing levelName, and the description IPC missed culture-specific keys. Fix: include level + culture in buildingItems. (2) The description IPC was using unit-style suffixes (_descr / _descr_short), but text/export_buildings.txt uses _desc / _desc_short and most entries are culture-specific (e.g. {governors_house_barbarian_desc}). Fix: try <level>_<culture> → <level> → <chain>_<culture> → <chain>, with the right suffixes." },
    ],
  },
  {
    version: "0.9.188",
    date: "2026-05-03",
    items: [
      { type: "fix", text: "Taskbar / Start-Menu pins should now survive updates. Provincia never called app.setAppUserModelId(), so the running Electron process registered under a default AppUserModelID while NSIS set the installed shortcut's AUMID from package.json's appId. Windows tracks pins by AUMID — mismatch meant the pin's anchor went stale every reinstall and the icon disappeared. Now we explicitly call app.setAppUserModelId('com.example.interactive-map') on Windows at startup so the running app and the installed shortcut share one identity. Note: this fix only takes effect from the NEXT update onwards (the current pin is already orphaned)." },
    ],
  },
  {
    version: "0.9.187",
    date: "2026-05-03",
    items: [
      { type: "feature", text: "Upgrade-only recruit cards now show a tooltip with the cheapest path to make the unit recruitable. Format: 'Upgrade <chain> → <levelName>' if the chain is already built but at a lower level, or 'Build <levelName> (<chain>)' if the chain doesn't exist yet. Computed by scoring every (chain, level) recruit option by gap from the current build state and picking the smallest." },
      { type: "feature", text: "Right-click info popup now shows the in-game long-form description for both units and buildings. New IPCs get-unit-description / get-building-description read text/export_units.txt and text/export_buildings.txt (UTF-16 LE BOM aware), parse the {key}content multi-line dictionary format, and merge mod + game sources (mod wins). For units the EDU `dictionary` key is resolved automatically; for buildings the level name is tried first, chain name as fallback." },
    ],
  },
  {
    version: "0.9.186",
    date: "2026-05-03",
    items: [
      { type: "fix", text: "Vanilla recruits no longer leak into mod data. get-building-recruits / get-unit-ownership / get-building-chain-levels / get-unit-stats were merging vanilla EDB+EDU FIRST, then mod files, with last-wins per (chain, level). RIS doesn't redefine every vanilla (chain, level) pair (vanilla 'barracks' levels are named differently), so vanilla `recruit \"hoplite\"` lines stayed visible — Syracuse and other Greek-faction cities showed the vanilla 'Hoplite' unit, which doesn't exist in RIS at all. New helper getEdbSourceFiles(modDataDir, relPath) returns mod-only sources when a mod data dir is provided AND contains the requested file; falls back to vanilla install roots otherwise." },
    ],
  },
  {
    version: "0.9.185",
    date: "2026-05-03",
    items: [
      { type: "change", text: "Show in EDB / EDU now opens Notepad++ (with line jump via -n<line>) when installed, falls back to plain Notepad. Was opening VS Code via vscode://file/ URL — switched per request. Notepad++ paths checked: 'C:\\\\Program Files\\\\Notepad++\\\\notepad++.exe' and the (x86) variant. Spawned detached so the child editor outlives Provincia." },
    ],
  },
  {
    version: "0.9.184",
    date: "2026-05-03",
    items: [
      { type: "feature", text: "Recruitable list now shows units that COULD be recruitable if buildings were upgraded — not just the currently-buildable ones. Two-pass evaluator: first pass walks the city's actual built chains (currently available); second pass walks every chain × level in EDB but skips the building-present / tier-alias filters (keeps faction / hidden_resource / EDU ownership / not_is_player / major_event). Currently-buildable units render at full opacity; upgrade-only units render at 0.45 opacity with a slight grayscale + dashed outline. Hover tooltip says 'needs building upgrade' for the faded ones. Sorted with available units first." },
    ],
  },
  {
    version: "0.9.183",
    date: "2026-05-03",
    items: [
      { type: "feature", text: "Faction Wealth panel — new 'Wealth' button in View options opens a sortable list of every faction with their starting treasury (from descr_strat) and region count, ordered richest→poorest. Click a row to zoom-fit that faction's territory and select it. Treasury colour-grades by amount. New parseDescrStratFactionWealth in parsers.js + bundle outputs faction_wealth_<suffix>.json so the panel reads bundled data with no runtime cost." },
      { type: "feature", text: "Show in EDB / EDU buttons in the InfoPopup (dev mode). Right-clicking a building or unit card opens the popup; new buttons there call find-edb-chain / find-edu-type IPCs to locate the line, then open-source-file launches VS Code via vscode://file/<path>:<line> if installed (or the OS default editor as fallback). Lets modders jump from the visual to the source instantly." },
    ],
  },
  {
    version: "0.9.182",
    date: "2026-05-03",
    items: [
      { type: "fix", text: "Settlement-tier badge no longer wraps below the settlement name when the name is long. Switched the row to flex with baseline align, name flex-shrinks with ellipsis, badge stays put with whiteSpace: nowrap." },
      { type: "feature", text: "Live-save turn/year badge flashes bright gold for ~700ms whenever a new save is loaded (turn or year changed). Catches your eye when the watcher pulls in a new snapshot." },
      { type: "feature", text: "Live-save 'loaded Xm ago' label sits next to the turn/year badge — refreshes every 30s. Goes amber and warns 'watcher may be stale' once it crosses 10 minutes, useful on long campaigns." },
      { type: "feature", text: "Pin Faction toggle in the View options pill. When on AND a faction is selected, regions outside that faction's territory get a heavy black overlay (alpha 200 vs 90) so the empire reads as the foreground. Sticky preference; lives in localStorage." },
      { type: "feature", text: "Recruit ↔ building cross-link on hover. Hovering a building card lights up the recruit units it gates (amber background + outline). Hovering a recruit card lights up the building chain that gates it. Driven by a per-unit gatedBy set produced by the recruit evaluator (handles tier aliases / multiple gating chains)." },
    ],
  },
  {
    version: "0.9.181",
    date: "2026-05-03",
    items: [
      { type: "fix", text: "Building cards no longer reflow as you hover between regions. Long labels (e.g. 'nomad communal herding (husbandry)') wrap to 4 lines while short labels are 1 line — the grid was sizing rows to whichever was tallest in that specific region, so cards jumped vertically when the cursor moved. Each card now has minHeight: 118px (icon 48 + 4-line label cap + padding) and the grid uses gridAutoRows: 118px, so every row across every region is the same height." },
    ],
  },
  {
    version: "0.9.180",
    date: "2026-05-02",
    items: [
      { type: "fix", text: "Search dropdown was clipped by the right-column container's overflow:hidden — appearing behind the Recent panel and inducing a system scrollbar as the column tried to grow. The dropdown now portals onto document.body with fixed positioning derived from the input's bounding rect, so it floats above every panel. Drop-shadow added for depth." },
    ],
  },
  {
    version: "0.9.179",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Dev RGB row now visualises the colour: a 12px swatch plus the hex value tinted in the actual region colour. Dim colours get lifted toward white so the hex stays legible against the panel; bright colours render as-is." },
    ],
  },
  {
    version: "0.9.178",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Mac-style animation system. Apple's typical spring easing curves (cubic-bezier(0.32, 0.72, 0, 1) and cubic-bezier(0.34, 1.56, 0.64, 1)) applied across the UI. Faction tiles cascade in with a staggered scale-up spring on first mount; map-mode buttons get smoother hover/transitions; the active map-mode button gets a slow amber glow pulse; toasts slide in from the right with a settle; search dropdown + dev right-click menu pop in from their anchor; the auto-update progress bar gets diagonal-stripe shimmer. All animations honour `prefers-reduced-motion: reduce`." },
    ],
  },
  {
    version: "0.9.177",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Recent settlements strip's horizontal scrollbar is now hidden, matching the rest of the panels. Used the existing .resource-panel-scroll class plus inline scrollbar-width:none for Firefox." },
    ],
  },
  {
    version: "0.9.176",
    date: "2026-05-02",
    items: [
      { type: "fix", text: "Rome (and any other Roman city) was showing only AOR-flavoured recruits — never the actual Roman early units (roman hastati early, leves, principes, etc.). The recruit filter dropped any line containing `major_event` regardless of polarity. RIS gates pre-Marian Roman troops with `not major_event \"marian_reforms\"` (i.e. available BEFORE reforms); we were treating that as a positive trigger and rejecting them. The check now uses a negative-lookbehind to drop only positive `major_event \"X\"` clauses; the `not major_event \"X\"` form passes through. Same fix applied to both the bottom-panel recruit evaluator and the recruitment-density map mode." },
    ],
  },
  {
    version: "0.9.175",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Pop Cap row reformatted: 'Pop Cap: level 11 · ~16,500' (was just 'Pop Level: 11') so the descr_regions 1-15 scale is paired with a count estimate." },
      { type: "improvement", text: "Settlement-tier badge colour-grades by tier — grey village, tan town, bronze large town, silver city, gold large city, bright gold huge city. Scan-by-colour for settlement size." },
      { type: "improvement", text: "Ethnicities row dropped the redundant coloured-dot legend below the bar; the bar's segment titles already convey ethnicity / percent on hover. Bar height bumped from 8px to 10px to compensate. Whole row also has a single hover title summarising all groups." },
      { type: "change", text: "Tag chip category 'Other' renamed to 'Hazards & Trade' (only fires for earthquake / rivertrade)." },
      { type: "feature", text: "Search dropdown shows '+N more — refine search' when matches exceed the visible 8." },
      { type: "improvement", text: "Recent regions strip is now single-line with horizontal scroll; new 'clear' link in the strip header. Doesn't push the search down on small screens any more." },
      { type: "feature", text: "Dev right-click menu has a new universal '📋 Copy descr_strat block' item — generates the settlement { … } block in descr_strat format (level, region, population, faction_creator, building list) and copies to clipboard. Useful for porting between mods or test branches." },
      { type: "improvement", text: "Hover throttling: setRegionInfo now skips re-renders when the cursor stays within the same region (uses an updater function that returns the previous reference unchanged). Mouse-move was firing per pixel and creating new objects 60+ times per second on continuous hover." },
    ],
  },
  {
    version: "0.9.174",
    date: "2026-05-02",
    items: [
      { type: "change", text: "Religion row dropped from the Tags chip block — the ethnicities chart already conveys the religious split per region, so surfacing rel_*_N as chips too was redundant noise. Tags now show: Terrain, Climate, Irrigation, Port, Fertility, Other, Hidden Resource." },
    ],
  },
  {
    version: "0.9.173",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Region info column re-ordered: Settlement / Faction / Culture / RGB / Fertility / Pop Level → Ethnicities chart (back to its original spot) → Resources → Tags → modeExtra. Dropped the ethnicities `minHeight: 58` reservation so when the chart is short the Resources/Tags sit close underneath instead of floating with empty space." },
    ],
  },
  {
    version: "0.9.172",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Tags moved up in the region info column — now sit right after Resources, above the ethnicities chart and modeExtra. Closes the gap between the Culture / Fertility / Pop info and the tag chips." },
      { type: "improvement", text: "Fertility number is now colour-tinted with the same red → yellow → green gradient as the Fertility map mode (val/14). 14 reads as super green, 1 as red, 7 as yellow." },
    ],
  },
  {
    version: "0.9.171",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Resources block in the region info bar moved up — now sits right after the Pop Level row, above the ethnicities bar / modeExtra / tag chips. More prominent in the visual hierarchy." },
      { type: "improvement", text: "Recruitable grid widened from 5 columns to 6, giving more breathing room when a city has a long unit list." },
    ],
  },
  {
    version: "0.9.170",
    date: "2026-05-02",
    items: [
      { type: "fix", text: "Resource icons now load eagerly. The preload effect was gated on `colorMode === 'resource'`, so the region info bar's resource chips appeared as text-only until the user had visited resource map mode at least once. Removed the gate — resourceImages populates whenever resourcesData is loaded, so chips always show their icons." },
    ],
  },
  {
    version: "0.9.169",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Region info bar now shows the region's resources — chips with the icon, name, and ×N count for duplicates. Pulled from the bundled resourcesData by region or settlement name. Icons appear when the resource map mode has been visited (resourceImages is loaded then); otherwise text-only chips render." },
      { type: "fix", text: "'Farm Level: 5' was the same on every region — descr_regions field 7 is a constant placeholder in RIS, the real fertility lives in the Farm## tag (Farm1..Farm14). The row now parses that tag and shows e.g. 'Fertility: 11 / 14'. Falls back to the raw field-7 value if no Farm## tag is present (other mods)." },
    ],
  },
  {
    version: "0.9.168",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Region info polish batch — (1) Settlement-tier badge: a small amber pill next to the Settlement name shows the descr_strat level (town / large town / large city / etc.). (2) 'Population Level' renamed to 'Pop Level' so it doesn't read like a population count. (3) Tags grouped into labelled, colour-tinted chip rows (Terrain / Climate / Irrigation / Port / Religion / Fertility / Other / Hidden Resource) instead of one flat blob. (4) Faction row now surfaces 'rebels → X' as an italic hint when the descr_strat owner differs from descr_regions' rebel-default — makes Corsica's corsi → romans_julii rebellion path visible at a glance." },
    ],
  },
  {
    version: "0.9.167",
    date: "2026-05-02",
    items: [
      { type: "change", text: "'City:' label renamed to 'Settlement:' in the region info bar — 'city' clashes with the descr_strat settlement-level value (village / town / large_town / city / large_city / huge_city). Search input placeholder and the double-click-copy tooltip updated to match." },
      { type: "improvement", text: "Faction row now runs raw faction ids through factionLabel(), so a region with no live save still shows the friendly display name (e.g. 'Romans Julii' instead of 'romans_julii') when descr_sm_factions provides one." },
      { type: "improvement", text: "Dev-mode RGB row now shows both decimal and hex (e.g. '200,14,15  #C80E0F') so colours are pickable in any image editor without conversion." },
    ],
  },
  {
    version: "0.9.166",
    date: "2026-05-02",
    items: [
      { type: "fix", text: "City row in the region info bar now matches the styling of Faction / Culture / Farm Level / etc. — bold label inline with the value, no `space-between` push to the far right. The 0.9.162 double-click-to-copy hook had switched the row to a flex layout with custom colours, which made it look out of place. Kept the double-click-copy gesture and tooltip; only the styling was reverted to the shared `row()` look." },
    ],
  },
  {
    version: "0.9.165",
    date: "2026-05-02",
    items: [
      { type: "fix", text: "Region info Faction line now shows the descr_strat owner, not descr_regions' rebel default. Corsica was displaying 'romans_julii' (rebel default) instead of 'corsi' (actual starting owner). The liveOwner prop's resolution chain (currentOwnerByCity → initialOwnerByCity → null) was gated on liveLogActive — but initialOwnerByCity is populated from the get-initial-ownership IPC at boot regardless of save state. Drop the gate so the strat owner overrides the rebel default whenever it's available. Same root cause as the recruitment fix in 0.9.140; this rounds out the display side." },
    ],
  },
  {
    version: "0.9.164",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Hidden the Electron menu chrome (File / Edit / View / Window). Menu.setApplicationMenu(null) at app level + autoHideMenuBar:true on the window. Cleaner full-screen feel; menu is gone entirely (not Alt-toggleable)." },
      { type: "change", text: "Reverted the marble toggle from 0.9.163. Marble texture is back to always-on per the original design." },
    ],
  },
  {
    version: "0.9.163",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Marble toggle in the View options pill — turn off the parchment marble backdrop for a flat colour, cleaner for screenshots and streaming. Persisted across sessions in localStorage." },
    ],
  },
  {
    version: "0.9.162",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Keyboard shortcuts: Ctrl+F focuses the search box; Ctrl+1..9 switches map mode (Faction / Victory / Culture / Religion / Population / Fertility / Resources / Homeland / Government); Esc cascade closes overlays in order (info popup → dev context menu → legend filter → search → selection → lock); ',' / '.' steps through the recent-regions backstack." },
      { type: "feature", text: "Live save mode: turn / year badge in the right-column header (T123 · 247 BC), pulled straight from the loaded save's header so you always know what point in the campaign you're inspecting." },
      { type: "feature", text: "Double-click the region or city name in the bottom info bar to copy it to the clipboard. Cursor changes to a copy cursor on hover; tooltip explains the gesture." },
      { type: "improvement", text: "Search input placeholder now mentions the Ctrl+F shortcut." },
    ],
  },
  {
    version: "0.9.161",
    date: "2026-05-02",
    items: [
      { type: "change", text: "Removed Religion Mix map mode. Coloring branch, legend, and getModeExtra entry all dropped." },
    ],
  },
  {
    version: "0.9.160",
    date: "2026-05-02",
    items: [
      { type: "change", text: "Wealth, Pop Headroom, and Recruitment map modes moved from the main map-mode pill into the dev section. Religion Mix stays in the main pill." },
    ],
  },
  {
    version: "0.9.159",
    date: "2026-05-02",
    items: [
      { type: "fix", text: "Splash now waits for mod-folder faction icons too. The previous preload only fetched bundled TGAs; with a mod folder configured (RIS), each FactionIcon component lazy-loaded its mod-side icon AFTER splash dismissed — producing a visible pop-in as faction tiles streamed in. Added preloadModIcon() that fetches every active faction's mod-folder TGA up front and populates the same cache key FactionIcon uses on mount, so the first render hits cache. Splash gating dependency includes modIconsDir so the wait fires whenever the mod is active." },
    ],
  },
  {
    version: "0.9.158",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Auto-update download progress is now visible. The version label in the right-column header shows an amber underline that fills 0→100% while electron-updater downloads the new installer in the background, plus an inline percentage. The main process was already broadcasting `state: 'downloading', percent: N` events (since 0.9.x) but the renderer was ignoring that branch — added a state slot and a thin progress strip on the version chip. Tooltip also reflects the live percentage on hover." },
    ],
  },
  {
    version: "0.9.157",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Pre-export validation extended with two more checks: (1) regions owned by non-rebel factions that have ZERO recruitable units (almost always means a missing entry in EDU `ownership` lines), and (2) hidden_resources that EDB recruit lines reference but no region in descr_regions actually carries. Both fire only when buildingRecruits / unitOwnership are loaded so the validation is accurate." },
    ],
  },
  {
    version: "0.9.156",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Four new map modes: Religion Mix (homogeneous→diverse, surfaces unrest risk), Pop Headroom (empty→capped, surfaces growth potential), Wealth (poor→wealthy, sums resources + farm × 2 + port × 4 as a crude income proxy), Recruitment (count of unique units each region can train, runs the same EDB filter the bottom panel uses). Each mode has its own gradient legend and bottom-panel readout." },
    ],
  },
  {
    version: "0.9.155",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Search results now highlight the matched substring in amber so the eye locks onto it instantly." },
      { type: "feature", text: "Recently-viewed regions backstack: a small ↶ Recent strip in the right column with the last 5 cities you locked, so you can flip between two settlements without re-finding them on the map. Active region gets the amber outline." },
      { type: "feature", text: "Hover-state readout in the garrison panel header. Mousing over a unit card surfaces 'name · soldiers · chevrons · armour · weapon' inline next to 'Garrison:' (and the field-army header), making it readable without squinting at the OS tooltip floater." },
      { type: "feature", text: "Roster diff badge: when a save is loaded, the garrison header shows '+N / −M since turn 0' comparing the current unit-name multiset against the descr_strat starting garrison. Lets you see at a glance whether a city's been reinforced or stripped." },
    ],
  },
  {
    version: "0.9.154",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Live-mode garrison: chevrons / armour / weapon icons now also seed when the live-save data comes via the legacy `saveArmiesData` path (not just the new `saveUnitsByRegion` parser). Restructured so the seed-merge from starting_armies_*.json runs after normalisation, regardless of which save path produced it. Mid-campaign recruits without a matching turn-0 seed still default to 0; full binary extraction of exp/armour/weapon from the save format would be needed for those, requires diffing two known saves to identify offsets." },
    ],
  },
  {
    version: "0.9.153",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "ChevronStack SVG dropped from 9×(count×4+1)px to 6×(count×3+1)px so it sits more discreetly in the corner." },
    ],
  },
  {
    version: "0.9.152",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Chevron rendering switched from text glyph 'ˇ' to inline SVG. At the 7-8px sizes the unit cards demand, the text glyph rendered as a barely-visible dot in the corner — Rome's units showed nothing despite descr_strat exp 3. The new ChevronStack component draws stroke-based angular Vs (RTW-style) sized to the tier colour, with a black drop-shadow halo for legibility against bright unit portraits. 1-3 chevrons stack vertically in the top-left corner." },
    ],
  },
  {
    version: "0.9.151",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Chevron count corrected — exp value IS the chevron level directly, no -1 offset. exp 0 → no chevron, exp 1 → 1 bronze, exp 2 → 2 bronze, exp 3 → 3 bronze (Rome's garrison), exp 4 → 1 silver … exp 9 → 3 gold. The earlier -1 offset was based on a misreading of the Friniatia feedback." },
    ],
  },
  {
    version: "0.9.150",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Chevrons / shields / swords now show in live-save mode too. Rome's garrison ships exp 3 armour 1 in descr_strat (so 14 of 15 units should display 2 bronze chevrons + 1 bronze shield), but with a save loaded the live-save code path normalised units to {unit, soldiers, max} — the binary save format doesn't carry exp/armour/weapon, so those fields were dropped. Both garrison and field-army paths now seed from the bundled starting_armies_*.json by unit name (FIFO match within the region), preserving turn-0 chevrons/upgrades on save-loaded views." },
    ],
  },
  {
    version: "0.9.149",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "Chevrons moved from top-right to top-LEFT corner of each unit card. Bronze tier shifted to a clear reddish-brown #8a4f1f (was a tan #b6843a that read as gold/yellow at small sizes against bright unit cards). Removed the stroke + drop-shadow on shield/sword SVGs — at 8px the black blur dominated the fill and washed the colour. Solid fills now read true." },
    ],
  },
  {
    version: "0.9.148",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "Unit-card badges retuned. Shield + sword icons moved to bottom-left so they don't sit on top of the chevron position (chevrons stay top-right). Icons shrunk from 11px to 8px. Chevron font dropped from 0.55rem to 0.45rem. Bronze tier colour darkened from #d8b96b (read as gold/yellow on bright cards) to #b6843a — clearly distinct from gold #f5cd3a now. Sword icons render fine; you'll see them only on units with weapon_lvl ≥ 1 in descr_strat (e.g. Friniatia ships weapon_lvl 0 so its garrison shows just shields)." },
    ],
  },
  {
    version: "0.9.147",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Shield (⛨ U+26E8) and sword (⚔ U+2694) Unicode glyphs aren't in the default Windows fonts the renderer uses, so they showed as literal '\\u26E8' / '\\u2694' escape strings on user machines. Replaced with inline SVG shield + sword icons that always render regardless of font coverage. Tier colours apply via SVG `fill`. Drop shadow on the glyph for legibility against bright unit cards." },
    ],
  },
  {
    version: "0.9.146",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "Chevron / armour / weapon icons now use proper RTW tier colours (bronze / silver / gold). Chevrons stack 1-3 per tier (exp 2-4 → 1-3 bronze, 5-7 → 1-3 silver, 8-10 → 1-3 gold). Armour and weapon are colour-only progression with one icon (no stacking) — bronze at lvl 1, silver at 2, gold at 3. Upgrade icons moved to top-center of each unit card (matches RTW's in-game layout). Tooltip surfaces the tier name." },
    ],
  },
  {
    version: "0.9.145",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Chevron threshold corrected: descr_strat exp 1 now displays as 0 chevrons (matches in-game — RTW's first chevron appears at exp 2). Visible count = exp - 1." },
      { type: "improvement", text: "XP icon switched from ▲ triangle to a chevron-style ˇ glyph in monospace, stacked when count > 1." },
      { type: "feature", text: "Armour and weapon-upgrade icons now show on each unit. Bundle and dev-import parsers extract `armour N` and `weapon_lvl N` from each descr_strat unit line; renderer shows ⛨ shield (blue) per armour level and ⚔ sword (orange) per weapon level on the top-left of the card. Tooltip lists exact values. Friniatia's celtic swordsmen / spearmen ship with armour 0 / weapon_lvl 0 so they stay clean; upgraded garrisons now read at a glance." },
    ],
  },
  {
    version: "0.9.144",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Bundle script's army parser now captures `exp N` from each unit line (both garrisoned_army and character-tied army blocks). Previously it grabbed only the unit name and the JSON consumer hardcoded exp=0, so users on the bundled JSON saw no chevrons even though descr_strat carries `exp 1` (Friniatia's celtic swordsmen / spearmen, Rhegion's campanian stack, etc.). The dev-import path was already correct; this aligns the bundle path so users who don't re-import see the same chevrons as users who do." },
    ],
  },
  {
    version: "0.9.143",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Dev-import path now also captures garrisoned_army blocks. The renderer-side parseDescrStratArmies in src/parsers.js was a separate code path from the bundle script; it only handled character-tied army/navy blocks, so when you re-imported your mod the freshly-parsed result REPLACED the bundled garrisoned_army entries from 0.9.142 with nothing — and slave settlements went empty again. Parser now tracks settlement-block context, captures the bare unit lines under garrisoned_army, and tags each entry with its region. The dev-import classifier in App.js then pins these to the settlement tile via the same TGA pixel walk used for character-tied armies." },
      { type: "change", text: "Ship workflow: every release now re-runs `npm run bundle-data` first to pull the latest files for both Imperial and Classic campaigns, so team members who forget to re-import their mod data still get fresh JSONs in the shipped exe." },
    ],
  },
  {
    version: "0.9.142",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Slave / rebel garrisons now show the actual descr_strat units, not a guessed pool. The bundle armies parser only captured `character` blocks (named-general armies); it ignored `garrisoned_army` blocks defined per-settlement (no character, no coords — just bare `unit` lines under the settlement). RIS uses garrisoned_army for almost every slave settlement (Friniatia: 1 celtic swordsman + 1 celtic spearman, Rhegion: full campanian stack, etc.), so 497 of 499 slave settlements were rendering empty. Parser now snaps these to the settlement tile via the surrounding region context, and a new starting_armies_*.json is produced at bundle time so the renderer no longer needs a dev-import to see them." },
      { type: "fix", text: "Reverted 0.9.141's wrong rebel-pool fallback. descr_rebel_factions.txt's pool drives PROCEDURAL REVOLTS (peasant_revolt, brigands, gladiator_revolt, pirates), not turn-0 garrisons; the game doesn't spawn random units from it at game start." },
      { type: "fix", text: "EDB alias parser now captures bare 'building_present <chain>' (no level) branches — previously the `or building_present garrison` half of mic_tier_1 was silently dropped, so 167 settlements that start with a garrison chain weren't getting credit toward mic_tier_1 satisfaction. Recruit-requires evaluator also handles direct 'building_present X' clauses (with optional 'not' and skipping the 'queued' modifier we have no data for)." },
    ],
  },
  {
    version: "0.9.140",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Settlements where descr_regions' rebel-default faction disagrees with descr_strat's actual owner now show the correct faction's recruits without needing a save loaded. Previously initialOwnerByCity (descr_strat-derived) only flowed to the renderer via the save-watch path; without a save, recruit evaluation fell back to r.faction (the rebel default in regions_large.json), which for Corsica points to romans_julii while the actual starting owner is corsi — so the user saw Roman-only recruits instead of corsi/AOR units. Added a get-initial-ownership IPC the renderer pulls right after charactersInit so the ownership map is available from boot." },
    ],
  },
  {
    version: "0.9.139",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Cross-faction unit-card fallback. AOR units like 'aor roman rorarii' (dictionary roman_rorarii) have their icon under romans_julii/, not the recruiting faction's folder or mercs/. The resolver only checked those two, so 696 / 11 633 faction×unit combos (6.0%) rendered blank. Now after the strict lookup fails, both resolve-unit-card and resolve-unit-info fall through to scanning every faction subdir under ui/units/* and ui/unit_info/* for the filename. Audit drops missing rate to 0.3%; the remaining 39 cases are units the RIS mod author hasn't shipped icon files for at all (messenian_hoplites, iberian_cataphracts, dravidian_warriors) — nothing the resolver can do without source files." },
    ],
  },
  {
    version: "0.9.138",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "All panel text was rendering black in dark mode after 0.9.136. The light-mode contrast observer set inline colour to rgb(26,26,26); on dark-mode entry the luminance gate (>130) skipped those elements before reaching the restore branch, so they stayed black. Restored colours now restore unconditionally in dark mode, before the luminance check." },
    ],
  },
  {
    version: "0.9.137",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "Light-mode panels now show the marble texture through. Panel opacity dropped from 0.72 to 0.45 with a slightly warmer tint, plus a faint inset top-highlight (1px white at 25%) so panels still read as carved against the now-visible marble. Marble darkening unchanged. Text contrast handled by the JS observer from 0.9.136 — accents still pop, body text stays readable." },
    ],
  },
  {
    version: "0.9.136",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "AOR / mercenary unit cards now display. EDU stores 'type aor X Y' with 'dictionary X_Y'; the icon files use the dictionary name (e.g. mercs/#X_Y.tga), not the type-derived 'aor_X_Y'. The unit-ownership IPC now also captures dictionary per type, and resolve-unit-card / resolve-unit-info try the dictionary form first (then plural-stripped, then aor_/merc_ prefix-stripped). Affects ~hundreds of AOR recruit lines that were rendering blank." },
      { type: "fix", text: "Negated tier requirements ('gov_tier_1 and not gov_tier_3' etc.) were being treated as positive — i.e. a province with only gov_tier_1 was rejected because gov_tier_3 wasn't satisfied. Affected ~160 recruit lines, mostly mid-tier AOR variants. Now positives and negatives are evaluated separately." },
      { type: "fix", text: "Direct 'building_present_min_level <chain> <level>' clauses in recruit requires (with optional 'not') are now evaluated against the city's built buildings. ~398 recruit lines used these directly (port-gated naval AOR units etc.); previously they showed up regardless of whether the player had the building." },
      { type: "fix", text: "Light-mode text contrast actually works now. The previous CSS attribute selector approach didn't fire because Chromium normalises 'style=\"color: #eee\"' to 'color: rgb(238, 238, 238)' after React sets it. Replaced with a JS observer that walks .panel descendants on every mutation, detects greyish (low-saturation) inline colours above a luminance threshold, and overrides them to near-black in light mode while remembering the original so they restore on dark-mode switch. Saturated accents are gated out via a max-min channel-spread check." },
      { type: "improvement", text: "Toasts deduplicate now. Mashing the version number to check for updates no longer stacks identical toasts — instead the existing one stays put with an '×N' counter, and its expiry timer refreshes on each repeat." },
    ],
  },
  {
    version: "0.9.135",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "Light mode now keeps the warm parchment panels but force-overrides the inline pale text colours from the dark-mode-first styling. CSS attribute selectors catch the common pale values (#eee/#fff/#f6.../#e6.../#ddd/white/rgba whites, plus the grey range #888/#aaa/#bbb/#ccc/#999/#777) inside any .panel and remap them to dark equivalents — saturated accents like #dca64a / #e8a030 are deliberately left alone. Net: parchment panels back, text readable, accents intact." },
    ],
  },
  {
    version: "0.9.134",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "Light mode is now actually dimmer. Panels and welcome cards stay dark-glass in both modes — the app has 130+ inline white text colours inside panels that were unreadable on the previous parchment surface. Only the canvas / marble varies between modes (and the marble's light-mode darkening pushed from 12% → 25% so the texture itself stops feeling glaring). Net: white text stays readable, light mode no longer feels like a glare wall." },
    ],
  },
  {
    version: "0.9.133",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "Light mode toned down. Panels are now a warm parchment off-white at 72% opacity (was almost-pure-white at 85%), text shifted to a warmer dark brown to match. Onboarding / What's New cards got the same parchment treatment. The marble background also stops getting a +10% white wash in light mode — that was pushing the bright marble texture into glare; it now gets a small darkening instead, like dark mode does." },
    ],
  },
  {
    version: "0.9.132",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Seleucid (and other AOR-heavy factions) no longer show empty recruit lists. RIS uses 'factions { all, }' in EDB and 'ownership all' in EDU as a wildcard for AOR units (every faction passes; narrowing happens via hidden_resource and 'not factions { ... }'). Our recruitment filter didn't recognize 'all', so AOR recruits were dropped — most factions still had plenty of specific lines, but Seleucid leans on AOR (greek_aor / syrian / macedonian / judaean tags per province) and went mostly empty. Both filters now treat 'all' as a wildcard; the field-army owner classifier got the same treatment." },
      { type: "fix", text: "Welcome / changelog cards no longer show on every launch. WelcomeScreen had a defensive 'stale-saved-version' check meant for an old test-build numbering migration: if lastSeenVersion was higher than the topmost changelog entry, it forced onboarding back. Once the app version outpaced the newest changelog entry (0.9.130 > 0.9.128 in changelog.js) the check fired forever. Dropped the check — persisted state is now authoritative, so onboarding shows once and changelog only shows on the first launch after a real new entry." },
      { type: "change", text: "Removed the 'Checking for updates…' toast from the manual update check. The result toast (available / downloaded / on-latest / error) follows fast enough that two toasts is just noise." },
    ],
  },
  {
    version: "0.9.128",
    date: "2026-04-30",
    items: [
      { type: "feature", text: "Hidden-resource map mode is now editable. Right-click a region with a token picked in the legend → menu shows current state ('Currently has X' / 'Currently doesn't have X') and a single toggle ('Add X' / 'Remove X'). Adding appends the token to the region's tag list, removing strips it; legend counts and map coloring update live, and descr_regions.txt is marked dirty so the standard export carries the change." },
    ],
  },
  {
    version: "0.9.127",
    date: "2026-04-30",
    items: [
      { type: "fix", text: "0.9.126 launched to a black window — the new hiddenResourcesList useMemo referenced homelandsData ~400 lines before its useState declaration, hitting a TDZ on first render ('Cannot access To before initialization'). Moved the useMemo down to live right after the homelandsData useState so the references resolve in order." },
    ],
  },
  {
    version: "0.9.126",
    date: "2026-04-30",
    items: [
      { type: "improvement", text: "Hidden-resource list grouped into Faction / Ethnic / Settlement / Area of Recruitment / Mercenary / Other, with collapsible cultures-style group headers (count + region total per group). Classification is data-driven: Faction = homelands.json membership, Ethnic = region ethnicities, Settlement = matches a region.region or .city, AoR = _aor suffix, Mercenary = contains 'merc', else Other." },
      { type: "fix", text: "Hidden-resource picker click is fast now. Precomputed a per-region WeakMap once per selection so the 15M-pixel canvas pass is a Map lookup instead of a string split per pixel. Also skipped the dev border path for hidden_resource — its 15M-pixel scan was the rest of the click lag, and binary borders aren't visually useful for arbitrary tokens." },
    ],
  },
  {
    version: "0.9.125",
    date: "2026-04-30",
    items: [
      { type: "fix", text: "Hidden-resource picker now lives in the bottom-left legend panel itself (which was the 'outliner' meant) — every token in the campaign listed inline with swatch + name + count, search box reuses the shared legendSearch like other modes. Removed the separate sidebar component; right-column outliner is back to Selected Provinces / faction summary." },
    ],
  },
  {
    version: "0.9.124",
    date: "2026-04-30",
    items: [
      { type: "improvement", text: "Hidden-resource picker restyled to match the Culture/Religion legend: title with total token count, shared 'legend-search-input' search box, then a flat compact list where each row is a 10×10 swatch + capitalized name + (count). Active row gets the amber background and outline (cultures' selection treatment); other rows fade to 0.55 opacity when something is selected. Replaces the previous boxy button-list look." },
    ],
  },
  {
    version: "0.9.123",
    date: "2026-04-30",
    items: [
      { type: "improvement", text: "Hidden-resource picker moved from a top-left dropdown into the right sidebar — replaces the outliner panel (Selected Provinces / faction summary) while 'Hidden Res.' mode is active, and reverts on any other mode. Same scroll area, search box, and per-token region count, just with proper vertical room (no more 80-token clamp / 'refine search' message)." },
    ],
  },
  {
    version: "0.9.122",
    date: "2026-04-30",
    items: [
      { type: "feature", text: "New dev map mode: 'Hidden Res.'. Picks one hidden_resource token from a searchable list of every token found in descr_regions tags (296 in the Large campaign), then highlights the regions that carry it — green for match, dim brown for not. Tokens are everything in the tag list that isn't terrain/climate/irrigation/port_level/Farm##/rel_*_##/rivertrade/earthquake. Region info bottom bar shows the selected token's yes/no, or the full hidden-resource list when no token is picked." },
    ],
  },
  {
    version: "0.9.118",
    date: "2026-04-27",
    items: [
      { type: "improvement", text: "Building card layout: icon frame 70×56 → 60×48, padding 6×4 → 4×3, label clamp 3 → 4 lines, font 0.72rem → 0.7rem. Frees vertical room so 'Region Information', 'Governor's Palace', 'Local Barracks' fit without ellipsis at the 82px card width." },
      { type: "improvement", text: "Steam path is now auto-detected via libraryfolders.vdf (Steam library config) — works for users with Steam installed on a non-default drive (D:/SteamLibrary, E:/, etc.). Mac install path also recognized." },
      { type: "improvement", text: "Faction-display, faction-culture, ui-buildings, and building-display caches are now bounded LRUs (16 entries each). Previous unbounded Map would grow forever as users switched mods." },
      { type: "fix", text: "TGA decoder: malformed/0×0/oversized headers now return empty TGAs instead of throwing. Icon resolver expects null-on-failure; deep exceptions in decode were caught but logged noisily." },
      { type: "change", text: "Removed dead code: pickGenericCategory in main.js was unused after the descr_ui_buildings.txt-based resolver replaced it." },
    ],
  },
  {
    version: "0.9.116",
    date: "2026-04-24",
    items: [
      { type: "fix", text: "Map-mode pill (top-left) no longer overlaps the Resources panel. Removed minWidth:64 per button, tightened padding to 3×8 and font to 0.76rem, dropped the 'Map:' label, widened the wrap budget. All 9 mode buttons fit on one row at 1920px." },
      { type: "improvement", text: "Region-info bottom bar uses a fixed 2×10 (=20 slot) buildings column — the real max a settlement can hold — and flexes Recruitable + Garrison to fill the remaining width. Grid: 240px info | 860px buildings | 1fr recruitable | 1fr garrison." },
      { type: "fix", text: "Resources panel width 250px, 2-column grid, max-height capped to map height, scrollbar hidden (scrollbar-width:none + ::-webkit-scrollbar display:none). Text no longer truncates for 'livestock', 'olive oil', 'wild animals', etc." },
      { type: "fix", text: "Building icon resolver for chains with no shipped art now falls through to `ui/generic/generic_building.tga` (78×62 card) and `generic_constructed_building.tga` (360×160 banner) — matches what the in-game UI shows for Weavery, Local Garrisons, Perfume Maker." },
    ],
  },
  {
    version: "0.9.112",
    date: "2026-04-24",
    items: [
      { type: "improvement", text: "Icon resolver now parses `data/descr_ui_buildings.txt` — the authoritative file RTW itself uses. Applies the mod-declared per-culture fallback order (e.g., roman → eastern → greek → egyptian) and level-name aliases (e.g., temple_of_battle_shrine → shrine, greek_polis → native_greek, recruitment_center1 → recruitment_center). 22 cultures, 177 aliases on RIS. Replaces my hardcoded fallback list; matches the game's own resolution exactly." },
    ],
  },
  {
    version: "0.9.111",
    date: "2026-04-24",
    items: [
      { type: "fix", text: "Sparta-owns-45-cities bug: faction legend was aggregating by `regions[].faction` (descr_regions line 3 = rebel-default), not descr_strat ownership. Now counts regions per `factionRegionsMap` and rolls unassigned regions into a single 'slave' rebels entry — matches the map coloring." },
      { type: "fix", text: "Campaign-aware faction display names. RIS classic submod now shows 'The House of Claudii' for romans_julii (from ALTERNATE_CAMPAIGN_*_TITLE in campaign_descriptions.txt) instead of the generic expanded_bi.txt label. Mapping: classic → ALTERNATE_CAMPAIGN prefix; imperial → IMPERIAL_CAMPAIGN prefix." },
      { type: "improvement", text: "Building icon resolver rewritten with proper pass order: per-culture per-level → roman per-level → per-culture chain → roman chain → wide `_constructed` banners → cross-culture level/chain → generic fallback. Reproduces the game's own lookup order so the right icon wins over stretched banners or pixelated thumbnails." },
      { type: "fix", text: "Skip vanilla 2567-byte placeholder TGAs under ui/<non-roman>/plugins/ (identical MD5 for paved_roads/mines/treasury/roads/etc). These aren't real art — the game uses the roman equivalent. Now the resolver passes through to the proper 77KB #roman_paved_roads.tga and similar." },
      { type: "fix", text: "Skip per-culture 78×62 in-progress-construction thumbnails in favor of proper 156×124 card icons from roman/. Fixes Local Market, Shipwright, Minor Stone Walls, Governor's Palace etc. showing tiny/stretched icons." },
      { type: "improvement", text: "Cross-culture icon fallback. When neither per-culture nor roman ships art for a chain/level (e.g. Client Kingdom `gov1`), search greek/e_hellenistic/w_hellenistic/etc. for the art. Many chains exist as art only under specific cultures." },
      { type: "fix", text: "Generic building fallback: chains with ZERO per-culture art anywhere (Weavery, Local Garrisons, Perfume Maker — textiles_production / garrison / perfumes_industry) now use `ui/generic/generic_building.tga` (78×62) for the card and `generic_constructed_building.tga` (360×160) for the right-click banner — matches what the game itself shows." },
      { type: "improvement", text: "Building icon dirs extended per culture: ui/<c>/buildings, /buildings/construction, /plugins, /construction. Roman dirs similarly. Finds the real art wherever the mod/game ships it." },
    ],
  },
  {
    version: "0.9.100",
    date: "2026-04-24",
    items: [
      { type: "fix", text: "Added ui/<culture>/construction/ (peer of buildings/, not the nested construction subdir) to the icon scan list. Some per-culture icons live there — e.g. #greek_market.tga. Still the same culture's own art, not a cross-culture fallback." },
    ],
  },
  {
    version: "0.9.99",
    date: "2026-04-24",
    items: [
      { type: "change", text: "No icon fallbacks of any kind. Dropped the cross-culture 'roman' fallback and the generic chain-category fallback. Buildings without a culture-specific TGA render blank, and the log prints 'MISSING ICON: <culture> / <chain> / <level>' for each unresolved case so the real file can be located deliberately rather than masked by an incorrect default." },
    ],
  },
  {
    version: "0.9.98",
    date: "2026-04-24",
    items: [
      { type: "fix", text: "Restore the chain-category icon fallback (0.9.97 over-removed it). Paved Roads, Mines, and every other building relying on the generic 'roads'/'mining'/'farming'/etc. category icon went blank. Category list unchanged — just the 0.9.96-era additions (treasury/waystation/garrison) stay out." },
    ],
  },
  {
    version: "0.9.97",
    date: "2026-04-24",
    items: [
      { type: "change", text: "Removed the chain-category building-icon fallback. Buildings without a real culture-specific TGA now render blank instead of showing a generic placeholder — so genuinely-missing icons are visible and fixable rather than hidden behind a default." },
      { type: "improvement", text: "Building icons are now displayed at 70×56 (matching RTW's 156×124 aspect ratio) instead of 52×52 square. Uses object-fit: contain so nothing is cropped. Card width unchanged — the extra space was already there inside the 82px card padding." },
    ],
  },
  {
    version: "0.9.96",
    date: "2026-04-24",
    items: [
      { type: "improvement", text: "Building icon cards now use object-fit: cover instead of contain, so the icon fills the 52×52 frame instead of being letterboxed inside it. RTW icons are 156×124, so the card art is ~25% visually bigger with only a sliver of side-crop. Card size is unchanged." },
      { type: "fix", text: "Treasury-tier buildings now resolve their icons. RTW stores some building icons in ui/<culture>/plugins/ (treasury, aqueducts, shrines, etc.) instead of ui/<culture>/buildings/. The resolver now scans plugins/ as a secondary directory before falling back to the generic category." },
      { type: "fix", text: "Waystation and garrison buildings now fall back to the generic category icon (waystation→roads, garrison→defense). Treasury also now maps to the 'trade' category as a second-line fallback." },
    ],
  },
  {
    version: "0.9.95",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Tier requirements (mic_tier_N / gov_tier_N / colony_tier_N etc.) are now actually evaluated against the city's built buildings instead of blanket-dropping every recruit that mentions one. EDB parser now also captures `alias <name> { requires building_present_min_level <chain> <level> }` definitions; the recruit filter expands each tier token into its building requirement and checks the chain's current level meets it. Athenian General (mic_tier_2) shows again when the city has military_industrial_complex at mic_2 or higher; still hidden when it doesn't." },
    ],
  },
  {
    version: "0.9.94",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Recruitable list now drops units gated by conditions the app can't evaluate from a static save: major_event (player-triggered reforms — 'athenian tarentine cavalry' needs athens_reforms_2), hidden_resource (region-specific tags), and tier hidden-resources (mic_tier_N / gov_tier_N / colony_tier_N / culture_tier_N — RIS uses these to lock units behind specific other buildings). Also respects 'not factions { ... }' negative filters. Conservative: under-show rather than over-show to match the in-game recruit panel." },
    ],
  },
  {
    version: "0.9.93",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Recruitable list no longer leaks vanilla recruits through mod overrides. Mods like RIS strip peasants from governors_villa by redefining the level with no recruit lines — but my parser only ran last-wins when the mod source actually had recruit lines, so vanilla's 'greek peasant' etc. survived. Now any (chain, level) the mod source defines (even with zero recruits) replaces vanilla's entry. Athens-on-RIS won't show greek peasant anymore." },
    ],
  },
  {
    version: "0.9.92",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Recruitable units now include lower-tier units from the same chain. RTW chains are cumulative — owning army_barracks lets you recruit hastati/principes/triarii because the militia/city tiers are implicitly satisfied. The panel previously only listed recruits from the EXACT current level, so e.g. Athens with a city-tier barracks would show only the city-tier units, missing the militia recruits. Walks every level up to and including the current one in each built chain. Updates live as buildings upgrade in the save (already wired through getBuildings)." },
    ],
  },
  {
    version: "0.9.91",
    date: "2026-04-23",
    items: [
      { type: "feature", text: "Right-click a unit card → the popup now shows the unit's actual stats from EDU below the card art: soldiers, HP, attack (primary/secondary with weapon type), charge bonus, defense breakdown (armour · skill · shield), morale + discipline, charge distance, recruitment cost / turns / upkeep, replenishment per turn, and category/class. Pulled from export_descr_unit.txt (mod last-wins so RIS overrides vanilla)." },
      { type: "fix", text: "Bundled vanilla armies JSON (armies_classic.json / armies_large.json) is now bottom-up like every other coord source — bundler no longer pre-flips. Means non-imported users on Alexander/imperial campaigns won't see armies upside-down." },
    ],
  },
  {
    version: "0.9.90",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Render y-flip restored. 0.9.88 dropped it because the bundled JSON was pre-flipped; but once you dev-import, armiesData is replaced with raw bottom-up descr_strat data from parseDescrStratArmies, and so are the live-mode armies from the save parser. Flipping at render time is right for every fresh data path. RIS imperial armies should now sit on land." },
    ],
  },
  {
    version: "0.9.89",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "RIS descr_strat armies now parse. Mods like RIS use 'character,<tab>Name, role, age, x, y' with a comma after 'character'; the parser's regex required plain whitespace after the keyword and silently ignored every such line. Result: 0 armies parsed and the Region Info panel's Garrison / Field Army sections stayed empty on imperial imports. Accepting comma-or-whitespace separator fixes both — RIS's descr_strat now yields 906 starting armies through the import pipeline, which feed the settlement-bucketed starting_armies JSON." },
    ],
  },
  {
    version: "0.9.88",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Armies were rendered upside-down on the RIS imperial map. The render was applying a y-flip meant for raw descr_strat coords, but all the data feeding into it (bundled JSON, dev-imported JSON, cityPixels) is actually already top-down. Dropped the render flip so armies sit at their data's y directly." },
    ],
  },
  {
    version: "0.9.87",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Revert 0.9.84/0.9.86 y-flip 'fixes' — they produced 0 armies because the y convention in the wild is more varied than I assumed. Back to the old behavior (sea-side armies in RIS) until I have a reliable way to detect bottom-up vs top-down per data source." },
    ],
  },
  {
    version: "0.9.86",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Dev-import path now produces armies with the same top-down y convention as the bundled JSON. parseDescrStratArmies returns raw bottom-up y (straight from descr_strat); the bundler pre-flips to top-down; the renderer's un-flip assumed top-down. A fresh import (RIS) fed bottom-up armies into a code path tuned for top-down, double-un-flipping them. Now the import flips before saving/setting state so both paths agree." },
    ],
  },
  {
    version: "0.9.85",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Building icons for governor tiers (gov1-gov4) and similar chain-less levels now fall back to the generic chain-category icon. The preload bridge was dropping the chainName argument when calling resolveBuildingIcon, so the category fallback (government, infantry, trade, etc.) never ran — buildings with no culture-specific TGA showed as blank. Also extended the category matcher so bare 'govN' level names map to 'government'." },
    ],
  },
  {
    version: "0.9.84",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Non-live armies were being rendered with their y axis inverted — the bundled armies JSON was pre-flipped to top-down coords by the bundle step, and the canvas renderer then applied its own flip meant for raw bottom-up data from the save. Net effect: armies placed on sea tiles. Now the memo un-flips bundled entries (and the descr_strat fallback path) so both non-live and live armies share the same bottom-up convention before the single render flip." },
    ],
  },
  {
    version: "0.9.83",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "RIS (and other mods with a large faction list) now get their culture/display info through. Two IPC calls in the renderer — getFactionCultures and getFactionDisplayNames — were dropping the modDataDir argument, so the main process fell back to parsing only vanilla+BI+Alexander (~41 factions, ~51 display names). RIS's 239 factions including greeks/paphlagonia now load, so the 'NO CULTURE for X' warnings and the generic building icons on modded factions should be gone." },
    ],
  },
  {
    version: "0.9.82",
    date: "2026-04-23",
    items: [
      { type: "change", text: "Garrison header layout matches the field-army sections: 'Garrison:' then a small character line underneath ('Vaumisa of Tagae — Persia') rather than parentheses on the header. Consistent with 'Region owners armies' / 'Other faction armies'." },
    ],
  },
  {
    version: "0.9.81",
    date: "2026-04-23",
    items: [
      { type: "feature", text: "Stack-end detection. The save has two marker flavors: [ffffffff][0x15][uuid] opens a new stack, and [ffffffff][0x15][0] ends the previous one (garrison defenders follow). Previously only the opening form was recognised, so commander-less units trailing Alexander's 16-unit stack kept inheriting his uuid and never showed up as the actual city garrison. Now Pella's 2 trailing hoplites land in the garrison bucket as expected." },
      { type: "improvement", text: "Garrison header now names the governor when one commands the stack (e.g. 'Garrison (Vaumisa of Tagae):' instead of just 'Garrison:'). Builds off the existing settlement-tile rule." },
      { type: "fix", text: "Faction labels in Region info now use the display name from the campaign's expanded_bi.txt (parsed, not hardcoded), so the Alexander campaign's 'parthia → Persia' remap comes through — 'Memnon of Rhodes — Persia' instead of 'parthia'." },
    ],
  },
  {
    version: "0.9.80",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Army faction labels. Stacks now inherit the commander's actual faction (from the save's character record) instead of being guessed from unit ownership. Parmenion's hoplites can be recruited by greek_cities too, but Parmenion himself is macedon — label now says 'Parmenion — macedon' rather than 'greek cities'. Same for Persian/parthia armies." },
      { type: "fix", text: "Unit icons for macedon-faction armies should now resolve correctly since the faction used for the icon lookup is macedon (matching the folder name ui/units/macedon/) rather than greek_cities." },
      { type: "fix", text: "Governor detection. A commander standing exactly on the settlement tile is a governor and his stack IS the garrison. Vaumisa at Halicarnassus now groups with the garrison instead of appearing as a separate field army. Alexander at Pella is NOT on the settlement tile, so he stays a field army as expected." },
    ],
  },
  {
    version: "0.9.79",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Ordering bug: 0.9.76 added inferredCmd to the unitsByRegion payload, but the code that SETS inferredCmd (the sequential-grouping pass) ran AFTER the unitsByRegion serialization — so every unit shipped to the UI with inferredCmd=null. Moved the serialization to after the grouping pass. Self-verified on turn-1 save: Parmenion gets 9 units, Memnon 19, Vaumisa 9; Lydia garrison now empty instead of 37. Should be the end of 'all units bundled as garrison while generals stand alone'." },
    ],
  },
  {
    version: "0.9.78",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Live mode: 0.9.77 found stack markers but the v2-to-charactersByRegion merge still resolved each commander's region by raw unit.commanderUuid — which is null for captain-stack units — so captain commanders never reached the RegionInfo's uuid-to-character lookup. The garrison filter then kept every un-looked-up unit as 'garrison' because their commander uuid was unknown to the UI. The region lookup now uses the same stack-marker pre-pass to find each commander's region, so captains actually land in charByUuid and their units classify as field armies. Adymos's stack should now appear as a separate field army under 'Region owners armies' at Pella." },
    ],
  },
  {
    version: "0.9.77",
    date: "2026-04-23",
    items: [
      { type: "feature", text: "Stack-header marker detection. Each stack in the save (both named-general and captain-led) is preceded by a small marker record of shape [ffffffff][filler=0x15][commander uuid]. Scanning for these — 24 found in the turn-1 Alexander save — gives an authoritative unit-to-stack linkage even for captain armies whose own unit records have no commanderUuid. Adymos's 6-unit captain stack at Pella now shows as a separate field army with his units attached, rather than vanishing into the garbage 'garrison' bucket." },
      { type: "fix", text: "Alexander's army is no longer misclassified as a garrison when he's standing on (or near) the settlement tile. The garrison bucket is now strictly units with no resolvable commander; any stack with an identified general or captain is a field army regardless of position." },
    ],
  },
  {
    version: "0.9.76",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Region panel's Garrison section was swallowing units that belonged to separate stacks in the same region. In the save, most unit records have commanderUuid=null — only the bodyguard of each army carries the real uuid — and the panel was grouping by that raw field, so every non-bodyguard unit fell into the cmd=0 garrison bucket regardless of which stack it was in. main.js already ran a sequential-grouping pass to propagate each stack's commander uuid to its trailing units, but the result wasn't exposed. Now each unit in unitsByRegion carries an inferredCmd field, and the garrison/field-army classification uses it instead of the raw uuid. Alexander's stack shows under Garrison at Pella, Adymos's captain stack shows under Region owners armies as a field army — the two no longer merge." },
    ],
  },
  {
    version: "0.9.75",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Crash fix: RegionInfo's character-list rendering called c.lastName.replace(...) unconditionally. After 0.9.68 merged v2 characters into the region-character list, surnameless leaders (Alexander, Parmenion) carried lastName=null and crashed the renderer. Same class of null-guard bug as 0.9.69 but in a different render path." },
    ],
  },
  {
    version: "0.9.74",
    date: "2026-04-23",
    items: [
      { type: "improvement", text: "Unit cards now show the soldier count as a small overlay at the bottom (was hover-only). Strength bar bumped from 2px to 3px so it's actually visible. Field-army cards in 'Region owners armies' / 'Other faction armies' now also show counts and strength bars (previously only garrison cards did)." },
    ],
  },
  {
    version: "0.9.73",
    date: "2026-04-23",
    items: [
      { type: "feature", text: "Captains and admirals now get their LIVE position straight from the save (no descr_strat fallback needed). The save has three world-object record types each carrying one army's position keyed by commander uuid: type-6 for general bodyguards, type-5 for captain land armies, type-4 for naval armies. Previously only type-6 was used. Diagnostic on turn-1 alexander save: position-match accuracy jumped from 21/57 to 39/57; captains needing descr_strat fallback dropped from 19 to 0. Position now stays correct after captains move (was stuck at descr_strat coords)." },
    ],
  },
  {
    version: "0.9.72",
    date: "2026-04-23",
    items: [
      { type: "improvement", text: "Captain armies now show their unit list. After 0.9.71 placed captains at descr_strat coords, the tooltip still showed 0 units because the save's character record has no units linked. The map composer now borrows the descr_strat unit list onto a save-side army that has no units of its own (turn-1 accurate; later turns get refreshed by save-state updates)." },
      { type: "fix", text: "Restored 1 broken test in src/parsers.test.js — the test was written for an older parseDescrStratArmies API (named armies, character-after-army order). Rewrote with the real descr_strat format (character-then-army, no army name)." },
    ],
  },
  {
    version: "0.9.71",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Soldier counts now match in-game UI. The save stores only rank-and-file count; in-game totals include any officer/standard/musician defined in EDU. Now those are added — Hypaspists shows 241 (=240+1 standard), Phalangists +1 standard, etc. Cavalry/skirmisher units that have no officer in EDU stay at the rank-and-file count." },
      { type: "improvement", text: "Captains (characters whose own commanderUuid doesn't resolve to a position record) now get filled in from descr_strat by name+faction. At turn 1 this puts every captain on the correct tile (19/19 in the vanilla Alexander campaign) instead of dropping them off the map. The save's positions are still trusted whenever they exist; descr_strat is only a fallback." },
      { type: "improvement", text: "descr_strat parsing in the main process now handles both imperial_campaign and alexander campaign paths, and properly extracts character coordinates (the previous regex was anchored on a comma after 'character' but the file uses a tab — it had been silently parsing nothing for a while)." },
    ],
  },
  {
    version: "0.9.69",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Crash fix: 0.9.68 introduced v2 characters into the region panel's commander lookup, but characters with no surname (Alexander, Parmenion) carry lastName=null — and the army-name builder called .replace on it unconditionally, white-screening the renderer. Now the builder uses only firstName when no surname is present." },
    ],
  },
  {
    version: "0.9.68",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Other faction armies in the region panel now identify their commander. The lookup table fed to RegionInfo only contained v1-parser characters; v2-parser characters (like Parmenion) were missing, so their stacks rendered as '(unidentified army)'. The v2 chars are now merged into the table under their commanderUuid, so named generals from any faction get labeled properly." },
      { type: "change", text: "Renamed 'Your field armies:' to 'Region owners armies:' in the region panel — clearer when reviewing other factions' regions." },
    ],
  },
  {
    version: "0.9.67",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Generic general-bodyguard units (e.g. 'greek general's guard cavalry early') were rejected by the unit parser because its name-char whitelist didn't include the apostrophe. As a result Parmenion's stack showed no units in the hover tooltip — the bodyguard record that carried his commanderUuid was silently thrown away. Apostrophe is now allowed; Parmenion's units (and every other general-bodyguard unit across all factions) now show up." },
      { type: "fix", text: "Unit parser now recognises a second post-region record layout (uuid at +4 instead of +0, soldier counts at +16/+20) used by some bodyguard-style units. Previously those reads picked up a sentinel value and reported commanderUuid=0 with zeroed soldier counts." },
    ],
  },
  {
    version: "0.9.66",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Character records with a lastName (e.g. Thuxra, Darayavahu) were sometimes rejected because one trait entry had an out-of-range level byte. Parser now skips malformed trait entries instead of throwing away the whole record — 4 more characters recovered at turn 1." },
      { type: "fix", text: "Named characters without a surname (Alexander, Parmenion) no longer get a bogus lastName like 'Priska' tacked on. Parser now honours the has-lastName flag byte at +12 before reading the lastName field." },
      { type: "feature", text: "descr_strat armies whose position isn't covered by the save parser (e.g. the captain-led garrisons at Pella and Sparta that the save stores as unnamed unit groups) are now added to the map as synthetic entries tagged descrStratOnly. Armies at initial spawn positions no longer disappear in the live view just because the save didn't preserve their original descr_strat names." },
    ],
  },
  {
    version: "0.9.65",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Save-parser no longer places characters at their neighbor's tile. Previously, when a character's own commanderUuid didn't resolve to a world-object position, a fallback scanned nearby bytes for any type-6 uuid and grabbed the next character's identity uuid instead — producing phantom dots (e.g. Adymos stacked on Alexander's tile at turn 1). The scan now stops 12 bytes before the next record's header and ignores any uuid that belongs to another character. Characters with no resolvable army position now show at no position instead of a wrong one." },
    ],
  },
  {
    version: "0.9.64",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Build pipeline: the dist:win script was only invoking electron-builder, which repackages whatever is already in build/ — meaning several recent installers shipped a stale React bundle and their UI fixes never reached the app. Scripts now chain vite build first. This is also the actual fix for the Armies-toggle bug claimed in 0.9.63 — the source fix was correct but never made it into the installer." },
    ],
  },
  {
    version: "0.9.63",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Toggling the Armies button off and on would sometimes leave the map stuck (armies invisible even with the button lit). The canvas-draw effect was missing showArmies from its React dependency list, so the redraw wouldn't fire on the toggle click — it only happened incidentally when some other state changed. Now the toggle redraws reliably." },
    ],
  },
  {
    version: "0.9.62",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "A garrison that leaves its settlement (per live log) is now re-classified as a field army (was stuck as garrison until the next save). Field armies still upgrade to garrisons when they enter settlements, as before. Navies keep their role-based classification." },
    ],
  },
  {
    version: "0.9.61",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Tooltip now shows a small green (live) tag on save characters whose position has been upgraded from the live log (vs. the older (log-tracked) blue tag which is still used for log-only characters the save parser didn't cover). Quick visual confirmation of whether the dot you're looking at is pixel-accurate or still at the save-time coordinates." },
    ],
  },
  {
    version: "0.9.60",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Save characters now carry their primaryUuid, so save↔log matching can do a direct uuid lookup before any name-based fuzzy fallback. Fixes same-name generals across factions, renamed captains, and cases where save and log spell a lastName differently — the wrong character no longer steals another's position just because their firstName matched first." },
    ],
  },
  {
    version: "0.9.59",
    date: "2026-04-22",
    items: [
      { type: "feature", text: "Live event feed now shows riots and disasters (e.g. 'Suza: riot (968 dead)') and autoresolved-battle outcomes ('Alexander defeated Darius'). Previously the log parsed these but nothing surfaced them to the UI." },
    ],
  },
  {
    version: "0.9.58",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Loading an older save no longer shows future log positions on the map. Events from turns after the save's turn counter are filtered out of the live-override path (exact, log-only, and fallback match lookups). The live-override toggle still works as before — this turn-filter runs underneath it so 'save review' mode is correct by default without you having to disable the override." },
    ],
  },
  {
    version: "0.9.57",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Backfill now handles FLEEING and 'character ptr deleted' events that the incremental poll already recognized. Fewer stale dots for routed characters and for chars the engine cleans up between turns. Live tracking stores charUuid per character so uuid-only deletion events can drop the right map entry even without a name." },
    ],
  },
  {
    version: "0.9.56",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Live-position cache now resets when the log watcher starts (new campaign or game restart). Previously stale dots from an earlier session could linger on the map until overwritten by a fresh move event." },
    ],
  },
  {
    version: "0.9.55",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Every log event now tagged with the turn it happened in (counted via end-round markers). Foundation for the upcoming turn slider — will let you scrub back to 'where was Alexander at turn 50?' without reloading an older save." },
    ],
  },
  {
    version: "0.9.54",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Army markers now have a faction-colored border (was black). Dot fill still indicates class (garrison/field/navy); ring color shows which faction owns the stack — you can see at a glance which of the overlapping armies is yours vs. an enemy." },
    ],
  },
  {
    version: "0.9.53",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Army Types legend now shows live counts per class (Garrisons: N, Armies: M, Navies: K). UI toggle 'Live-log override' added — dim it OFF to view save-only positions when reviewing older saves." },
    ],
  },
  {
    version: "0.9.52",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Hover tooltip shows key traits (Factionleader, GoodCommander, NaturalMilitarySkill, etc.) for scripted characters. Quick visual cue for which stack is commanded by a real general vs. a random captain." },
    ],
  },
  {
    version: "0.9.51",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "More death patterns recognized. Log events of form 'Name(faction:role)(uuid):death_type(DET_XXX)' and 'Name:DYING:start...:death_type(DET_XXX)' now remove the character from the live map. Covers battle-kills, natural death, and disaster death (riots, diseases) — previously only 'army is dead' events triggered removal." },
    ],
  },
  {
    version: "0.9.50",
    date: "2026-04-22",
    items: [
      { type: "feature", text: "User toggle: 'Use live-log positions'. When ON (default), message-log moves override save positions for pixel accuracy during live play. Turn OFF when reviewing older saves to see the save-time positions only (log may contain events from later turns)." },
    ],
  },
  {
    version: "0.9.49",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Hover tooltip shows passenger characters ('with Parmenion, Leocharis') and a '(log-tracked)' badge for armies whose position came from the message log rather than the save file." },
    ],
  },
  {
    version: "0.9.48",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Admirals correctly classified as navy on the map using their log role. Both save-based armies (when a matching log event has role=admiral) and log-only armies (prefix 'Admiral X') now show as blue anchor markers instead of red field dots." },
    ],
  },
  {
    version: "0.9.47",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Log-only armies dedupe by position: when multiple captains are stacked at the same tile, they show as ONE marker with passengers listed on hover (instead of overlapping dots)." },
    ],
  },
  {
    version: "0.9.46",
    date: "2026-04-22",
    items: [
      { type: "feature", text: "Generated captains now appear on the map. The save parser only finds scripted characters (faction leaders + heirs), so generated captains like 'Captain Phranaces' used to be invisible. Now the app synthesizes an army for every character the log tracks that has no save-record counterpart — they appear as 'log-only' armies at their real log-reported positions." },
      { type: "fix", text: "Live-position de-duplication: stored under canonical (firstName|lastNameStub|faction) key only, with runtime fallbacks to same-firstName entries for the lookup. Prevents duplicate dots on the map for the same character." },
    ],
  },
  {
    version: "0.9.45",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Live position lookup robustness: coord bounds validation (ignore bogus log values outside map range), and fallback to first-name-only lookup when save-parser faction is 'unknown'." },
    ],
  },
  {
    version: "0.9.44",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Live position lookup now keys by (firstName, lastName stub, faction) with fallback to just (firstName, faction). Better disambiguates characters with the same first name, e.g. the scripted Waradsin of Pella vs a generated Waradsin captain." },
    ],
  },
  {
    version: "0.9.43",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Dead characters removed from live position overlay. When the log emits an 'army dead' event, the corresponding character's live-tracked position is cleared so stale markers don't linger on the map." },
    ],
  },
  {
    version: "0.9.42",
    date: "2026-04-22",
    items: [
      { type: "feature", text: "Pixel-accurate live positions via message-log tailing. The engine emits a character_move event on every in-game movement; the app now reads those events in real time and overrides the save-parser's heuristic position. When you play turn N, the map shows exactly where each character moved to. On app start, the log is back-filled so positions are correct immediately." },
    ],
  },
  {
    version: "0.9.41",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Accurate character positions. Previously the parser picked the FIRST type-6 uuid found in a character's record region — often wrong (e.g. picking Pella's settlement uuid for Parmenion when his real army was in Lydia). Now uses commanderUuid (at record_start-8) as PRIMARY source — verified via diff experiment showing Alex's (11,49)→(16,55) move maps to his commanderUuid's type-6 record. Parmenion now correctly at (17,44) with Leocharis as passenger (was wrongly at Pella)." },
    ],
  },
  {
    version: "0.9.40",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Army composition better balanced. Instead of stopping at first region-mismatch, the parser now SKIPS non-matching-region units and continues scanning — so Alexander's stack includes all his Macedon-region units (not just the first contiguous block). Turn 13 Alex now 9 units (was 3/12/115)." },
    ],
  },
  {
    version: "0.9.39",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Every bodyguard in the save becomes an army (was missing 3 of 37 before). Armies without a matched character are tagged 'unknown commander' but still appear on the map at the correct position." },
    ],
  },
  {
    version: "0.9.38",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Army composition filtered by region. Within a faction's unit block the save stores multiple armies sequentially — now each bodyguard's region establishes the army boundary, so units in a different region belong to a different army/garrison. Memnon at Turn 13 now shows his correct 20-unit Lydia army (was 43 incl. Bactria + Parapamisadale forces)." },
    ],
  },
  {
    version: "0.9.37",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Army size closer to reality. Instead of arbitrary 20-unit cap, armies now end at either the next commander's bodyguard OR a large file-offset gap (>10K bytes = faction boundary). Alex at Turn 13 now shows 12 units (was 115 raw / 20 capped). Matches his 16-unit starting army minus 4 combat losses." },
    ],
  },
  {
    version: "0.9.36",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Army unit count capped at 20 (RTW's stack limit). Previously field armies and their settlement's garrison were being merged into one 100+ unit super-army because they share the same commander-UUID in the save. Now each army shows its real-sized stack." },
    ],
  },
  {
    version: "0.9.35",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Live armies: characters are now grouped by their army's commander-UUID OR position, so stacked characters appear as one army on the map with the real general as leader and others as passengers (e.g. Alexander at Pella with Parmenion as passenger)." },
      { type: "fix", text: "Leader priority: Factionleader > Factionheir > most-traits > file-order. Prevents trait-less false-positive characters from displacing the real general." },
      { type: "improvement", text: "Position fallback via commanderUuid: faction leaders stationed at their capital (like Alexander at Pella) now resolve to the settlement's coords even when their record doesn't directly contain a position-record UUID." },
    ],
  },
  {
    version: "0.9.34",
    date: "2026-04-22",
    items: [
      { type: "feature", text: "Live armies on the map! Save-parsed armies now replace the descr_strat starting state when viewing a save. Each army shows commander, faction, age, and full unit composition on hover." },
      { type: "improvement", text: "Armies classified per-save: navy (all units are naval_*), garrison (at a settlement tile), field (elsewhere). Previously the Live overlay incorrectly reused starting-state classifications." },
      { type: "improvement", text: "Units grouped by commander via sequential linking — each commander's bodyguard opens the army block, subsequent commander-less units belong to it. Fixes the 'one unit per army' bug where Live mode showed only bodyguards." },
      { type: "fix", text: "Save character parser: discovered pre-record commanderUuid at record_start-8 that matches unit.commanderUuid (was using the wrong uuid field previously)." },
    ],
  },
  {
    version: "0.9.33",
    date: "2026-04-22",
    items: [
      { type: "feature", text: "Save character parser rewritten (v2) after decoding the RTW character-record layout. Finds 36-143 characters per save (vs. 5-6 false positives before), with correct names, birth year, age, traits, portraits, and x/y positions." },
      { type: "improvement", text: "Current in-game year and turn number now read directly from the save header (offsets 3968/3972). Ages computed as current_year - birth_year — verified against descr_strat ground truth (Alex age 26 at Turn 13 ✓)." },
      { type: "improvement", text: "Character gender heuristic: males have traits, females (wives/daughters) have none. Parser now tags both and includes females (wives/daughters) that were previously invisible." },
      { type: "improvement", text: "Added messageLogParser that reads VFS/Local/Rome/logs/message_log.txt for live events (trait gains, battles, army moves) — parses 7235 events across 17 event types." },
    ],
  },
  {
    version: "0.9.7",
    date: "2026-04-20",
    items: [
      { type: "feature", text: "Buildings are now live-accurate in Live Mode. The settlement parser was rewritten after a user demolish experiment revealed that chain records come BEFORE the settlement name in the save (inverted from prior assumption) — each settlement's actual built buildings are now correctly identified." },
      { type: "improvement", text: "When you demolish a building in-game, the hover panel's Buildings list updates to match (the chain record is removed from the save)." },
      { type: "fix", text: "Player faction detection re-runs every save, not just once. Starting a new campaign as a different faction is now picked up automatically instead of sticking on the previous faction." },
    ],
  },
  {
    version: "0.9.6",
    date: "2026-04-19",
    items: [
      { type: "feature", text: "Live mode region hover panel now lists characters present in each region with their ages, leader/heir status, and alive/dead state — decoded directly from the save file" },
      { type: "improvement", text: "New save-file parsers reverse-engineered from scratch: characters (names, traits, family tree, portraits, region assignment via bodyguard unit) and units (soldier counts, region, commander linkage). See calibration/ for the research notes." },
      { type: "improvement", text: "Character data is faction-aware: faction leaders and heirs are marked with 👑 and ★ based on their in-save Factionleader/Factionheir traits, not heuristics" },
    ],
  },
  {
    version: "0.9.5",
    date: "2026-04-17",
    items: [
      { type: "feature", text: "Live mode region hover panel now shows 'In Construction' — the building chain currently being built in that city, read directly from the save" },
      { type: "improvement", text: "Save parser rewritten after reverse-engineering the save format: construction queue extraction is now reliable for new chains (no more false positives for existing chains like irrigation or market)" },
      { type: "change", text: "Disabled the heuristic 'recently completed buildings' merge until the chain-hash-to-name mapping is in place — starting-state buildings come from mod data as before" },
    ],
  },
  {
    version: "0.9.4",
    date: "2026-04-17",
    items: [
      { type: "fix", text: "Live mode no longer replays historical log entries — activation is a clean slate and only forward-going turns get tracked. Fixes the 'ghost turns' that appeared for fresh installs on machines with existing Rome Remastered logs." },
      { type: "fix", text: "Hover panel no longer overrides starting buildings with save-file data until you've actually ended a turn — prevents false positives from the heuristic save parser on fresh campaigns" },
      { type: "feature", text: "Live mode now detects or asks for your faction (auto-fills from the autosave filename when possible, falls back to a faction picker). Shows 'As: <faction>' next to the Live button, click to change" },
      { type: "feature", text: "Region hover panel shows the live garrison/army (unit names, soldier counts, chevrons) when live mode is active" },
      { type: "improvement", text: "Save-file parser extracts unit experience chevrons + weapon/armor upgrades in addition to soldier counts" },
      { type: "improvement", text: "Live mode activation now surfaces a toast with the detected log folder path so it's obvious what's being tracked" },
    ],
  },
  {
    version: "0.9.3",
    date: "2026-04-17",
    items: [
      { type: "improvement", text: "Faster launch: the Vite build system replaces the old bundler — 10× faster dev iteration and a smaller install footprint" },
      { type: "improvement", text: "Cleaner internals: the UI code is split into smaller modules (mute button, update banner, toasts now live on their own)" },
      { type: "fix", text: "Dropped 31 npm dependency vulnerabilities carried over from the old build system" },
    ],
  },
  {
    // The 4th segment is a silent "edition" counter — bump it to force the
    // changelog to reappear once after adding new items to an existing version.
    // The UI strips it (users see "v0.9.2"), and gating uses it for comparison.
    version: "0.9.2.1",
    date: "2026-04-17",
    items: [
      { type: "feature", text: "Auto-updates: checks for new releases on startup and installs them on restart" },
      { type: "feature", text: "Non-fatal errors now surface as dismissable toasts instead of failing silently" },
      { type: "feature", text: "Mute toggle for the startup sound — speaker icon in the bottom-right, muting silences but doesn't interrupt the track" },
      { type: "feature", text: "Bundled faction icons so the first launch has visuals before any mod is imported" },
      { type: "improvement", text: "Duplicate faction colours in the legend now show a warning icon listing which factions share a colour" },
      { type: "improvement", text: "TGA map decoding moved to a Web Worker — no more brief UI freeze on campaign switch" },
      { type: "improvement", text: "Mod-file parsers consolidated into a shared module with unit tests" },
      { type: "improvement", text: "Upgraded Electron to 41.2.1 and electron-builder to 26.8.1" },
      { type: "improvement", text: "Build now auto-bundles the latest RIS mod files from C:\\RIS" },
      { type: "fix", text: "First-run onboarding cards show correctly after reinstalling over a previous version" },
      { type: "fix", text: "Changelog no longer re-appears every time you switch campaigns" },
      { type: "fix", text: "Auto-updater 404/offline errors no longer pop as toasts (only real failures do)" },
    ],
  },
  {
    version: "0.9.1",
    date: "2026-04-16",
    items: [
      { type: "fix", text: "Imported faction colours now survive an app restart (previously reverted to bundled colours)" },
    ],
  },
  {
    version: "0.8.7",
    date: "2026-04-15",
    items: [
      { type: "feature", text: "First-launch walkthrough and version changelog screen" },
      { type: "feature", text: "Onboarding highlights relevant UI elements as you step through" },
      { type: "fix", text: "Faction colours now always load from the latest imported data" },
    ],
  },
  {
    version: "0.8.4",
    date: "2026-04-14",
    items: [
      { type: "feature", text: "Added Armies map mode showing garrisons, field armies, and navies" },
      { type: "improvement", text: "Campaign import now auto-detects faction icons directory" },
    ],
  },
  {
    version: "0.8.3",
    date: "2026-04-12",
    items: [
      { type: "feature", text: "Resource map mode with category filtering" },
      { type: "feature", text: "Pin regions for quick access" },
      { type: "improvement", text: "Screenshot export now includes colour mode in filename" },
    ],
  },
];

export default CHANGELOG;
