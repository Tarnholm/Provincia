// changelog.js — per-version "What's New" entries for the Settlement Processor
// Suite, newest first. Rendered as cards by updater-ui.js after an update.
// Each entry: { version, date, items: [{ type, text }] }
// Types: "feature" | "fix" | "improvement" | "change". `text` supports **bold**
// and `code`.
window.SPS_TYPE_COLOURS = { feature: "#4a9", fix: "#c66", improvement: "#6ac", change: "#ba6" };

window.SPS_CHANGELOG = [
  {
    version: "0.16.25",
    date: "2026-08-12",
    items: [
      { type: "change", text: "**Farms now ship with the per-chain bump exceptions filled in.** The table added in 0.16.17 was empty by default, so every farm chain sat behind the full bump. All ten chains now start with a rule set: irrigated and rainfed skip the bump at `fertility` 8 and 9 or `grain` 2, qanat at `grain` 1, `dates` 2 or `fertility` 7, and the pastoral chains at `livestock`, `sheep`, `horses` or `camels` 3. On RIS this lifts 81 settlements to a higher farm level — 63 of them irrigation, mostly large_towns moving from irrigation ditches to basin irrigation — and gives 15 large_towns their first farm building. Clear a row to get the old behaviour back for that chain." },
    ],
  },
  {
    version: "0.16.24",
    date: "2026-08-10",
    items: [
      { type: "feature", text: "**Rural Exploits: limit the rich-resource exception by settlement level** — the same **Full-Tier Levels** list Urban Exploits got in 0.16.23. Remove a level (e.g. `town`) and settlements of that size always use the lower band, no matter how much of the resource the region has. Default lists every level, so nothing changes until you prune it." },
      { type: "feature", text: "**Reset to default.** The editor toolbar has a new button that replaces the open pipeline script with the pristine copy shipped with the app — the instant fix when hand edits (or an AI's) leave a script that won't parse. No restart needed; saved rule profiles are untouched. (A Provincia restart also restores all scripts — they re-seed from the app at every launch.)" },
    ],
  },
  {
    version: "0.16.23",
    date: "2026-08-09",
    items: [
      { type: "feature", text: "**Urban Exploits: limit the rich-resource exception by settlement level.** New editable **Full-Tier Levels** list — settlement levels on it may use the higher building band when the resource stack is large; remove a level (e.g. `large_town`) and settlements of that size always stay in the lower band. Default lists every level, so nothing changes until you prune it." },
      { type: "fix", text: "**Saving a broken Python script now tells you immediately.** The editor still saves (your work is never held hostage), but a `.py` that no longer parses pops the exact error — `line N: what's wrong` — instead of failing silently mid-pipeline later. Note: script edits live in the Suite's project folder and are **re-seeded from the app on every launch** — save a Rule Profile (and Export it) to keep intentional changes." },
    ],
  },
  {
    version: "0.16.22",
    date: "2026-08-09",
    items: [
      { type: "change", text: "**868 lines of dead code removed from the master pipeline.** `master_processor.py` still carried full inlined copies of the old Rural and Urban Exploits steps from before the pipeline went single-source — never executed, but exactly the stale-copy trap that once let a fix silently miss the master run for months. The pipeline now contains only what it runs; verified end to end." },
    ],
  },
  {
    version: "0.16.21",
    date: "2026-08-09",
    items: [
      { type: "fix", text: "**Elephants really do map to ivory_trade.** The Rural Exploits mapping editor was missing `ivory_trade` from its dropdown options, so the elephants row silently **displayed** — and on save would have **written** — the first option, `wine_industry`. The script itself was always correct (elephant regions get ivory buildings; verified on the live data). The option is now listed, and the editor defends itself: a value missing from a dropdown's options is shown as-is instead of falling back." },
      { type: "feature", text: "**Adjustable industry qualification.** Rural and Urban Exploits each gained two editable knobs: the **qualifying amount** (how much of a mapped resource a region needs before it gets an industry at all, default 2) and the **full-tier amount** (how much lifts the building to the higher level band, default 4)." },
      { type: "feature", text: "**Rule profiles export and import.** Every saved profile has an **Export** button that writes a single portable file, and the sidebar has **Import…** to bring one back — on this machine or a teammate's. Imported profiles never overwrite an existing name (auto-suffixed), and only recognized pipeline scripts are accepted from the file." },
      { type: "fix", text: "**Dead editor fields removed.** The old rural/urban \"Bump Rule\" fields and urban \"Minimum Settlement Tier\" edited code the current selection model never runs (or variables that don't exist — the priority lists were bound to wrong names and are now editable again). The dead helper functions they pointed at are gone from the scripts too." },
    ],
  },
  {
    version: "0.16.20",
    date: "2026-08-09",
    items: [
      { type: "fix", text: "**Carthage gets its capital treasury.** The Core Buildings owner parser cut region names at the first hyphen, so every hyphenated region (`Qart-Khadasht` and ~130 others) had no known owner — **carthage, arados, samnites and veneti_gallia** never received their capital treasuries, and empire sizes were undercounted wherever a faction owned hyphenated regions. Region names now parse whole, matching every other script in the Suite." },
      { type: "feature", text: "**Bump exception: large towns can take the tier-2 market.** New editable **level exception list** in Core Buildings — levels on it skip the bump rule and only need their own EDB minimum. Ships with `market` on it, so a large_town builds the tier-2 market instead of stopping at trader; forum and above still bump (higher markets would be excessive)." },
    ],
  },
  {
    version: "0.16.19",
    date: "2026-08-09",
    items: [
      { type: "feature", text: "**Light and dark mode.** The Suite follows the OS theme, exactly like the main app: light is the marble-and-parchment look; dark is the main window's neutral dark glass — the same slate ground and amber accents, marble gone. The wax tablets carry through both, and the native window buttons re-tint live when the OS theme flips." },
    ],
  },
  {
    version: "0.16.18",
    date: "2026-08-08",
    items: [
      { type: "change", text: "**The Suite now looks like Provincia.** The window trades the generic gray dark theme for the main app's identity: the RTW-R cream-marble slab as the ground, parchment panels, bronze inscription headers, and Provincia amber everywhere the old blue was. Consoles and the code editor sit on dark **wax tablets** framed in bronze, with warm log colors. Pipeline and Master steps are numbered with **Roman numerals** in true execution order." },
    ],
  },
  {
    version: "0.16.17",
    date: "2026-08-08",
    items: [
      { type: "feature", text: "**Farms: per-chain bump exceptions.** Each farm chain can now have its own bump-rule exceptions — skip the bump when the region has enough of a **specific resource** or meets a **fertility** threshold. Editable per chain in the Farms simple editor (the global fertility exception still applies to all chains)." },
      { type: "feature", text: "**Heavy industry: bump exceptions.** Global rule: the bump is skipped when the region has **≥ 5** of one of the building's enabling resources (threshold editable). Plus **per-building rules** — skip the bump for one building on a specific resource amount (e.g. mines when gold ≥ 2), editable like the farms exceptions. Also: the master pipeline now runs `heavy_industry.py` directly, so it picks up the **sum-scoring fix** and your rule edits (the old inlined copy had gone stale)." },
      { type: "feature", text: "**Roads: block by terrain or faction.** New editable lists — regions with chosen hidden resources (e.g. `mountains`, `desert`) or settlements owned by chosen factions get **no roads at all**." },
      { type: "fix", text: "**Capital treasuries are actually placed now.** The old rule only kept treasuries that already existed in descr_strat — there were none, so none were ever built. Each faction's starting capital (first settlement in its faction block) now gets a `capital_treasury`, levelled by **empire size** (1+/4+/9+/16+ settlements, thresholds editable) and capped by what the settlement's size allows." },
      { type: "fix", text: "**Temples step crash fixed** in the full pipeline run (`TempleBuildingProcessor` → `StandardTempleProcessor` rename was never applied to the pipeline)." },
    ],
  },
  {
    version: "0.16.16",
    date: "2026-05-25",
    items: [
      { type: "fix", text: "**Walls: size bump restored.** Regular walls are one tier below settlement size, capped at `stone_wall` (tier 3): town → none, large_town → wooden_pallisade, city → wooden_wall, large_city/huge_city → stone_wall. Per-region exceptions (Trinakria 4, Korinthia 3) stay un-bumped (full tier up to their cap). Fixes tier-1 walls on tier-1 towns." },
    ],
  },
  {
    version: "0.16.15",
    date: "2026-05-25",
    items: [
      { type: "feature", text: "**Starting Treasury step.** Sets each faction's starting denari = **5000 + 500 × (starting settlements)**. Slave/dummies and the emergent/rebel markers are left untouched. New pipeline step — runs with the others, editable KEEP list in the script." },
    ],
  },
  {
    version: "0.16.14",
    date: "2026-05-25",
    items: [
      { type: "fix", text: "**Walls reach stone_wall (tier 3) again** for cities — the size bump was capping them at wooden_wall. Exceptions (Trinakria 4, Korinthia 3) and never-exceed-settlement-tier still apply." },
      { type: "fix", text: "**Roads bump restored** (large_town → roads, city → paved_roads, large_city+ → highways) and **highways now also require** the region's total resource amount to exceed 12 (size still gates it). Roma → highways." },
      { type: "fix", text: "**Treasuries are built again**, capped at tier 2 (large_treasury) — the bump had been dropping them." },
      { type: "fix", text: "**Heavy industry: enabling vs scoring resources.** A building is only considered when one of its real inputs is present (e.g. mines needs an actual metal/coal); slave_trade/timber/grain/glass/amber etc. only adjust the score." },
      { type: "fix", text: "**Ports:** towns that no longer qualify are correctly reported as **removed** (the port was already stripped, but the report mislabeled it as kept)." },
      { type: "change", text: "Urban-exploit priority list reordered; farms **mountains** reverted to plain highland_pastoralism." },
    ],
  },
  {
    version: "0.16.13",
    date: "2026-05-25",
    items: [
      { type: "feature", text: "**Grain exports step.** A region with **grain ≥2** and a sea/river outlet (`base_port_level` 1-3 or `rivertrade`) gets a `food_storage` granary: large_town → `granary`, city/large_city/huge_city → `granary+1`; towns get none. Region **Gynaikopolites_Nomos** → `granary+2`. New pipeline step (editable, runs with the others)." },
    ],
  },
  {
    version: "0.16.12",
    date: "2026-05-25",
    items: [
      { type: "change", text: "**Port authority reworked.** Coastal port always wins when a `base_port_level` 1-3 is present (even alongside rivertrade); tier-1 `port` is now a **town**-level building. Coastal bump keys off the region's **total resource amount** (>5 = no bump → bigger port at smaller settlement size); river-port bump keys off grain/stone/marble/timber presence." },
      { type: "change", text: "**Roads rule.** Desert / mountains / alpine / sub_artic / small-islands / karst cap roads at **tier 1**; **highways** require the region's total resource amount to **exceed 12**, otherwise paved_roads; region **Roma** always gets highways." },
    ],
  },
  {
    version: "0.16.11",
    date: "2026-05-24",
    items: [
      { type: "change", text: "**Urban exploits reworked around stack size** (matching rural). Placed when a mapped resource is at stack **2+**; **highest amount wins** (priority breaks exact ties). Building tier follows settlement size + amount: **towns get none**, large_town only at amount 4-5; tier = settlement_tier−1 (4-5) or −2 (2-3), capped at 3. `…supply` levels are never used. `sheep`/`flax`/`cotton` → `textiles_production`; fish no longer needs salt." },
    ],
  },
  {
    version: "0.16.10",
    date: "2026-05-24",
    items: [
      { type: "change", text: "**Rural exploits reworked around stack size.** A rural building is placed whenever a mapped resource is present in a stack of **2+**; the **highest-amount** resource wins (priority list breaks exact ties). Building tier follows settlement size **and** amount: tier = settlement tier for amount 4-5, one below for 2-3 (capped at 3) — so a town only gets one at amount 4-5. `…supply`/`…sawmill` levels are never used (drops to the tier below)." },
      { type: "change", text: "**Elephants → ivory_trade moved from urban to rural** exploits." },
    ],
  },
  {
    version: "0.16.9",
    date: "2026-05-24",
    items: [
      { type: "change", text: "**Military capped at tier 2.** Both MIC and garrison are capped at their tier-2 building (`mic_2` / `garrison+1`) — enables full homeland recruitment while leaving higher tiers for the player to build." },
      { type: "change", text: "**Fewer pre-built cisterns.** Sanitation's water rule no longer counts `irrigation_lake` / `irrigation_springs` (only `lead` & `irrigation_river`), so fewer settlements start with a health building." },
    ],
  },
  {
    version: "0.16.8",
    date: "2026-05-24",
    items: [
      { type: "change", text: "**Heavy industry rebalanced to per-building weights.** Each building now scores resources with its own weights (e.g. mines gold 9 / silver 8…, jewelry gemstones 8…, smith iron 7 / coal 6…) instead of one global table. Added two buildings — **`salt_production`** and **`pitch_gathering`** — and a new tie-break order." },
      { type: "fix", text: "**No more `…_supply` levels.** A building's top `_supply` level is never selected; it drops to the tier below (affects salt, pitch, jewelry, stone, sulphur, purple_dye, marble)." },
    ],
  },
  {
    version: "0.16.7",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**Heavy industry cleaned up.** Removed urban/rural chains (glass, amber, slave, wine, timber, textile, livestock) and the defunct single-resource mines from the heavy-industry pool — fixes duplicate buildings (e.g. double glass in Alexandria) and references to buildings that no longer exist. Heavy industry now competes only among real `heavy_ind` buildings." },
      { type: "change", text: "**Farms rules updated.** Plateau/Hills/Mountain-valley rainfed rules now key off the no-irrigation/cold exclusion (incl. `sub_artic` & `alpine`) or a warm climate; Hills & Mountain-valley gain a qanat rule for `irrigation_aquifer`; Mountains now needs sheep/livestock/perfumes/honey/salt (else no farm); Karst rainfed drops `sub_artic`; Wetlands marsh_reclamation needs a qualifying resource; Floodplains drops its rainfed fallback." },
    ],
  },
  {
    version: "0.16.6",
    date: "2026-05-24",
    items: [
      { type: "feature", text: "**Civic buildings step.** A new pipeline section places civic buildings (`magistrate_court`, `centralized_mint`/`autonomous_mint`, `academy`) per settlement from an **editable list** (`config/civic_buildings.txt`). Edit it in the config editor, or click **Import List** on the Civic step to drop in an updated .txt — then re-run with the other scripts. Existing civics are replaced (`no_other_civic`)." },
      { type: "improvement", text: "Double-clicking the version to watch for updates now **auto-installs** the update the moment it finishes downloading — no \"Restart & install\" click needed. Double-click again to cancel before one appears." },
    ],
  },
  {
    version: "0.16.5",
    date: "2026-05-24",
    items: [
      { type: "fix", text: "**Temples now use the suite-wide -1 tier rule.** A non-capital settlement gets a temple one tier below its size (e.g. a large_town → a tier-1 temple); only the faction capital gets a temple matching its full level. Matches mics.py and the other placement scripts." },
      { type: "feature", text: "**Special temples are respected.** A settlement that already has a special temple (`temples_of_viking`, `temples_of_horse`, etc.) keeps it and gets no culture temple — RTW allows only one temple per settlement." },
    ],
  },
  {
    version: "0.16.4",
    date: "2026-05-23",
    items: [
      { type: "change", text: "**Heavy-industry weights now read correctly.** coal=5, glass=3, amber=3, elephants=3 are the real values (previously masked by old defaults). `tin` stays 3 globally with an artisans-only override of 5 so **artisans** — not smith — wins tin settlements. No change to actual placements." },
    ],
  },
  {
    version: "0.16.3",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**“What’s New” cards.** After an update the app shows release-notes cards summarising what changed in each new version (this card!)." },
    ],
  },
  {
    version: "0.16.2",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Update watcher indicator.** Double-clicking the version number shows a pulsing **👀 watching…** badge while it polls for a new release every 5 seconds." },
    ],
  },
  {
    version: "0.16.1",
    date: "2026-05-23",
    items: [
      { type: "improvement", text: "**Heavy industry — luxury crafting.** Settlements with glass, amber or elephants now build **jewelry** instead of raw mining (`mines`). The glass/amber **trade** chains are urban and no longer compete in the heavy-industry step." },
    ],
  },
  {
    version: "0.16.0",
    date: "2026-05-23",
    items: [
      { type: "feature", text: "**Temples by culture (`temples.py`).** Each settlement's temple is assigned from the region's dominant **culture %**; ties go to the owning faction's own culture. Wired into the pipeline, Master and the GUI." },
      { type: "change", text: "**Wall caps.** Walls are capped at **tier 3**, with per-region exceptions (Trinakria 4, Korinthia 3) and no walls in Elis, Kappadokia and Lucensia_Meridionalis. A wall never exceeds the settlement's own tier." },
      { type: "improvement", text: "**Heavy-industry scoring.** Per-building resource weights — smith values coal more; artisans pick up tin/lead." },
      { type: "feature", text: "**Auto-updates.** The app updates itself from GitHub releases — click the version number to check, double-click to keep watching." },
    ],
  },
];
