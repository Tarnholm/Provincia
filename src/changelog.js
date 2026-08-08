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
    version: "0.9.1493",
    date: "2026-08-09",
    items: [
      { type: "improvement", text: "**Panel headers join the Palatino voice.** \"Selected Provinces:\", the Factions header, 📜 Campaign Stats, 📊 Save insights, the Diplomacy editor title, info-popup titles, campaign slot labels and the empty-slot / asset-error overlays now use the same display face as the app's other headings — with a small optical size bump so nothing reads smaller. Tiny section captions stay sans on purpose: the serif-title/sans-label contrast is what keeps it looking deliberate." },
    ],
  },

  {
    version: "0.9.1492",
    date: "2026-08-09",
    items: [
      { type: "feature", text: "**Scripts Suite: light and dark mode.** The Suite window now follows the OS theme exactly like the main app — light is the marble-and-parchment look; dark is the main window's neutral dark glass, same slate ground and amber accents, no marble. The wax tablets carry through both, and the native window buttons re-tint live when the OS theme flips. Suite 0.16.19." },
      { type: "improvement", text: "**The Palatino display face now carries the whole app's headings** — region titles, panel and dialog headers, the Welcome cards and changelog version numbers — the same Roman inscription voice as the Suite's titlebar. Controls and body copy stay on the system sans." },
      { type: "improvement", text: "**Suite chrome retuned to the main window's sandy gray** — the titlebar, toolbar and sidebar now sit in the same muted parchment family as the app's panels instead of bright cream." },
    ],
  },

  {
    version: "0.9.1491",
    date: "2026-08-09",
    items: [
      { type: "change", text: "**The Settlement Processor Suite now looks like part of Provincia.** The Scripts window trades its generic gray theme for the app's own identity: the RTW-R cream-marble slab as the ground, translucent parchment panels, bronze inscription headers set in Palatino small caps, and Provincia amber everywhere the old blue was — tabs, buttons, checkboxes, focus rings, even Feral-gold scrollbars. Consoles and the code editor sit on dark **wax tablets** framed in bronze, with a matching warm Monaco theme (amber cursor, bronze line numbers). Pipeline and Master steps carry **Roman numerals** in true execution order, and dialogs became parchment sheets. Suite 0.16.18." },
    ],
  },

  {
    version: "0.9.1490",
    date: "2026-08-08",
    items: [
      { type: "feature", text: "**Settlement Processor Suite 0.16.17: bump-rule exceptions you can actually aim.** Farms gain **per-chain exceptions** — skip the bump for one farm chain when the region has enough of a specific resource or meets a fertility threshold (editable chips per chain in the simple editor; the global fertility exception still applies everywhere). Heavy industry gains the same: a **global enabling-resource threshold** (≥ 5 skips the bump — rich deposits get their industry sooner) plus **per-building rules** (e.g. mines when gold ≥ 2)." },
      { type: "feature", text: "**Suite: roads can now be blocked by terrain or faction.** Two new editable lists in Core Buildings — regions carrying chosen hidden resources (mountains, desert, …) or settlements owned by chosen factions get no hinterland roads at all, existing ones removed." },
      { type: "fix", text: "**Suite: capital treasuries are finally placed.** The old rule only re-levelled treasuries already present in descr_strat — there were none, so in every run ever, zero were built. Each faction's starting capital now gets a capital_treasury levelled by empire size (1/4/9/16 settlements, editable) and capped by what the settlement's size allows. On current RIS data: 214 capitals — 176 treasury, 33 large, 2 great, 3 imperial (Roma, Qart-Khadasht, Mesopotamia)." },
      { type: "fix", text: "**Suite: the full pipeline run was crashing at the temples step** — a processor class rename (v0.9.667) was never applied to the pipeline callers, so a master run had never completed past step 9. Fixed; a full 14-step run now completes. Bonus: the pipeline's heavy-industry step had silently kept a stale pre-0.9.667 copy of the rules (old max-scoring, blind to editor tweaks) — it now runs heavy_industry.py directly." },
      { type: "improvement", text: "**Touch support on the campaign map:** single-finger pan, two-finger pinch zoom anchored at the finger midpoint, tap to select — mouse behaviour unchanged. The 🧰 tools menu now closes on tap/click outside (it was undismissable on touchscreens) and on Esc." },
      { type: "improvement", text: "**Scroll feedback without scrollbars:** a thin amber pulse appears along a list's edge while it scrolls and fades out after — every scrollable panel gets position feedback again without bringing back visible rails." },
    ],
  },

  {
    version: "0.9.1489",
    date: "2026-08-08",
    items: [
      { type: "fix", text: "**Crash-reporter 0.1.51: the (0,0)-character count is no longer silently capped.** The reporter tracks up to 60 distinct broken-character names to bound memory, but it printed that capped length as though it were the measurement. The field data made the flaw plain: 9 of 15 affected v7.14.b saves reported exactly 60 broken characters — the cap, not a count. Totals are now tallied independently of the cap, so a report reads \"AT LEAST 60 broken characters (150 sightings)\" instead of a confident and wrong 60. Matters because this is the signal we are using to size the coming-of-age placement defect: 15 of 35 v7.14.b sessions carry these characters, and each one is an instant CTD if its card renders." },
    ],
  },

  {
    version: "0.9.1488",
    date: "2026-08-06",
    items: [
      { type: "feature", text: "**Faction Chronicle (📜, new tool): follow one faction through a whole AI test run, translated to plain English.** Point it at a campaign_ai_log (one click for the live log folder) and pick a faction: every turn becomes a readable entry — invasion decisions with the engine's own stated reasons (\"Started planning an invasion of Corsi — not at war, good production against strongest neighbour\"), treasury state, taxes, what it built and recruited, diplomats dispatched, garrisons thinned — with battles, sieges and settlement captures merged in from the same folder's message_log. Repetitive engine-speak is grouped, not dumped: the rebel faction's 60 identical \"opportunistic invade\" lines become one sentence, 18 zero-strength campaign aborts become one line, and the engine's double-logged garrison splits are deduped. Turn counting is block-based, immune to the summer/winter-only labels that undercount 4TPY campaigns 2x. Filter chips per topic, newest-first toggle, and Copy as text for pasting a run summary straight into Discord. Parsing reuses the proven AI-log pattern manifest and battle ledger — verified against the live RIS session log (218 factions, 659k lines, ~4s) and the 346MB reference log." },
      { type: "fix", text: "Battle ledger event feed cap is now configurable: the default 500 events is a live-ticker budget that a real session exceeds within ~16 turns — the Chronicle raises it so early-game battles aren't silently dropped from post-run reading." },
    ],
  },

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

  ];

export default CHANGELOG;
