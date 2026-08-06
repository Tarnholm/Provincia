/**
 * Changelog entries, newest first.
 * Each entry: { version, date, items: [{ type, text }] }
 * Types: "feature", "fix", "improvement", "change"
 *
 * Display versions only — the 4th segment in package.json (e.g. "0.9.2.10") is a
 * silent iteration counter for test builds and is stripped before gating/display.
 *
 * CAP: keep only the last ~5 versions here. WelcomeScreen imports and parses
 * this whole module on every post-update launch, and it had grown to 827KB /
 * 8,623 lines (2026-07-16). When adding a new entry, move the oldest one to
 * docs/changelog-archive.js (npm run ship warns when this file grows past 8).
 */
const CHANGELOG = [
  {
    version: "0.9.1487",
    date: "2026-08-06",
    items: [
      { type: "feature", text: "**Crash-reporter 0.1.50: reports now name the broken characters behind one of the two engine crash families.** When a family member comes of age, the engine only tries the faction leader's tile and the eight tiles around each of that faction's settlements; if every one is water, impassable or occupied it gives up and creates the character anyway at map position (0,0) with null trait and ancillary strings. Rendering that character's card copies a null string and the game dies instantly (ACCESS_VIOLATION +0x190C65F — five reproducible crashes from one tester). The reporter now counts both populations separately, because they need different answers: placement failures mean the save is manufacturing landmines right now (and names the faction whose family tree is stuck), while characters already sitting at (0,0) mean the save is permanently mined — a map fix cannot repair those. Verified against real telemetry before shipping: one session yields nine failures for Barzapharnes of the Parni, another shows Gotzon and Shabataka already broken." },
    ],
  },

  {
    version: "0.9.1486",
    date: "2026-08-06",
    items: [
      { type: "improvement", text: "**Starting Populations: the progress bar now shows too MUCH population, not just too little.** The bar previously measured against the band the population implies — so a town holding city-sized numbers still drew a calm green bar. It now measures against the settlement's DECLARED level: green with a % when the population sits inside its level's band, amber **▼** when it is below the level's own threshold (too little, with how far short in the tooltip), and red **▲over** when it has blown past the next level's upgrade threshold (too much — the tooltip says by how many). The ⚠ overcrowding warning (above the level's max pop) stacks on any of the three. The column is renamed \"vs level\" to say what it measures." },
    ],
  },

  {
    version: "0.9.1485",
    date: "2026-08-06",
    items: [
      { type: "improvement", text: "**Starting Populations: every settlement now shows a progress bar toward its next city level.** The new \"→ next\" column draws how far the (edited) population has climbed from its current band's threshold toward the next level's upgrade threshold — a city at 13,000 reads 50%, halfway from 9,000 to the 17,000 large-city mark — with the exact numbers, including how many more people the upgrade needs, in the tooltip. Huge cities (no next level) show % of their max population instead. The bar turns red with a ⚠ when the population exceeds the band's **max pop** — descr_cultures' overcrowding ceiling (in RIS: 5,800 / 9,000 / 16,000 / 22,000 / 30,000 / 60,000, one ladder for all 22 cultures, measured). The bar updates live as you type a new population, so you can dial a settlement to exactly the growth headroom you want." },
    ],
  },

  {
    version: "0.9.1484",
    date: "2026-08-06",
    items: [
      { type: "fix", text: "**Starting Populations no longer freezes the app when you toggle a filter.** The table was rendering all ~1,300 settlement rows — a controlled input each, roughly ten thousand DOM nodes — so clicking \"level≠pop only\" re-laid the whole thing out and pinned a core while the mouse went unresponsive; every keystroke in a population box paid the same cost. The table now renders only the rows actually in view (~40, with spacers keeping the scrollbar honest), so opening the panel, toggling filters, and typing are all instant — measured at roughly 10× faster to open and 10× faster per toggle even before browser layout costs, which is where the real freeze lived. The header now stays pinned while you scroll, and a regression test fails if the table ever goes back to rendering everything." },
      { type: "improvement", text: "**The city-level ladder is now clickable — filter to just Villages, Towns, or any mix.** Each level chip (Village 0 · Town 1,500 · …) shows how many settlements are declared at that level and toggles a filter; click several to combine, ✕ clears. The \"level≠pop only\" checkbox now shows its live count too, so you can see at a glance how many settlements sit outside their declared band before diving in." },
    ],
  },

  {
    version: "0.9.1483",
    date: "2026-08-06",
    items: [
      { type: "fix", text: "**Fixed: v0.9.1481 could re-import a full mod's campaign with VANILLA map files — RIS slots suddenly showed the vanilla map (103 regions).** The new base-mod inheritance had a hole: when a slot imports the campaign folder directly (…/world/maps/campaign/imperial_campaign), the folder scan never sees the mod's own world/maps/base — and for a full mod the fallback skipped the sibling-mod search and went straight to the vanilla install, silently overwriting the slot's descr_regions, map TGAs and descr_sm_factions with vanilla's. The campaign's own mod root is now always the FIRST inheritance source, sibling base mods second, vanilla strictly last — verified on the real RIS and Four Romans folders (zero vanilla paths resolve). If your RIS slot went vanilla: just update and reopen — the next auto-reimport pulls the correct RIS files back." },
    ],
  },

  {
    version: "0.9.1482",
    date: "2026-08-06",
    items: [
      { type: "feature", text: "**🧰 Tools → 👥 Starting Populations: an editable table of every settlement's starting population, written straight back into descr_strat.** All ~1,300 settlements in one grid — faction, settlement, declared level, and an editable population box — with search, a faction filter, sortable columns, and a bulk **±% adjust** for whatever is filtered. Beside each population the table shows which city-level band it falls in, using the thresholds read from descr_cultures' \"settlement upgrade levels\" (in RIS all 22 cultures share one ladder: village 0 · town 1,500 · large town 4,000 · city 9,000 · large city 17,000 · huge city 27,000, minimum 400 — measured, and the panel warns if a mod's cultures ever differ). A ⚠ flags every settlement whose population sits in a different band than the level descr_strat declares — there's a \"level≠pop only\" filter to sweep exactly those. Apply rewrites ONLY the changed population lines (brace-depth parsing, indentation and line endings preserved — proven byte-for-byte on the real RIS file), takes a .provincia-bak backup first, and reports what changed. Submod slots edit the submod's own descr_strat, exactly like the Army Setup applies." },
    ],
  },

  ];

export default CHANGELOG;
