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
    version: "0.9.1434",
    date: "2026-07-25",
    items: [
      { type: "fix", text: "**Correcting v0.9.1431: the falsification check I was so pleased with was itself dead code.** That release said the terrain model \"ran against all 125 factions fielding troops and found zero contradictions\". It ran against none of them. The save's unit index is a flat map keyed `\"faction|Region\"`, not the nested `{faction: {region: n}}` I assumed, so the loop's inner iteration produced an empty list every time and the check examined nothing while reporting a clean bill of health. It now examines **816 faction-region pairs on the reference save and still finds zero contradictions** — the conclusion survives, but it was unearned when I published it. The run reports how many pairs were checked, and \"no contradictions out of nothing checked\" is now reported as unknown rather than as a pass." },
      { type: "fix", text: "**And the naval claim in those verdicts was based on nothing.** Naval units in the save carry no faction — all 50 ships land under \"?\" — so \"this faction has no ships\" was reading an empty bucket and always coming out true. That is why v0.9.1431 asserted every one of the 14 stranded factions lacked a navy. The truth from descr_strat.txt is more interesting: **8 of them do start with a fleet and still never embark** (Chios among them, with one admiral), while 6 genuinely have none. Those are different bugs with different fixes, and the leads now say which is which. The save's per-faction ship count is flagged as unusable at source so nothing else can quietly depend on it." },
      { type: "improvement", text: "The unit tests were the root cause: their fixtures used the nested shape I had imagined rather than the one the code actually produces, so they passed while the real path did nothing. They now use the real flat-key shape, and one test deliberately feeds the wrong shape and asserts it yields zero checks — the failure mode is pinned, not just fixed." },
      { type: "improvement", text: "Also ruled out, so nobody spends time on it: a sea-reachability counterpart to the land model. Three probes established that of the 14 stranded faction-target pairs, all 14 have a sea route and none lack one — so it would produce no findings — and whether ships may enter the map's deepest water class is not stated anywhere in the mod files. Two of those probes failed for reasons that were my error rather than the model's, which is recorded alongside." },
    ],
  },
  {
    version: "0.9.1433",
    date: "2026-07-25",
    items: [
      { type: "improvement", text: "**The in-app changelog is 99 KB smaller.** This file is parsed on every post-update launch, and a cap of about five versions was set in 0.9.1275 for exactly that reason — but the release script only *warned* about it, and the warning went unheeded for 146 releases until the file reached 151 entries and 110 KB. It is now 11 KB. All 1,313 entries are intact; the older ones moved into docs/changelog-archive.js, which keeps the history greppable in the working tree." },
      { type: "improvement", text: "**And it cannot drift again.** The release script now performs the trim itself instead of warning about it, and a test fails the suite if the file grows past the cap anyway. The trim moves entries as text spliced on brace boundaries rather than re-serialising them — regenerating this file from parsed data is what corrupted it once before, when emoji and quotes in the prose were mis-escaped and truncated the write mid-file. It verifies both files still load, that no entry was lost or altered, and that no version ends up in both, and refuses to write anything if any of that fails. Measured on the real trim: 1,313 entries before, 1,313 after, zero altered." },
      { type: "improvement", text: "The brace scanner the trim depends on is tested against the cases that would actually break it — braces inside release-note prose (this changelog describes clauses like `requires { all, }`), escaped quotes, apostrophes, and comments containing braces. It also preserves each file's existing line endings, so the diff shows only the moved entries." },
    ],
  },
  {
    version: "0.9.1432",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**New Hotspots tab: where the trouble is, rather than whose it is.** 989 regions are named across the findings, and the table ranks them by how many <b>different</b> factions fail at the same place — because several factions failing at one spot points at the map, not at any one of them. It immediately says something the per-faction view could not: the worst hotspots are contested prizes nobody can staff, not hard ground. Nasium has <b>seven different factions</b> stalled on it at ground difficulty 30; Menosgada and Variscium have five each. Each row shows its faction count, findings, proven-no-route orders, ground difficulty and problem mix, and clicking it highlights the region on the map." },
      { type: "improvement", text: "**Findings can be sorted.** Six thousand rows in one fixed order were unreadable. \"Worst first\" (the analyser's own severity ranking) stays the default, joined by longest-running, hardest ground, earliest turn and faction A–Z. Sorting works on a copy, so the export and the before/after digest still read the analyser's original ordering." },
      { type: "fix", text: "**The terrain data added in the last release was being computed and then not shown.** 1,848 findings carried their target's ground difficulty and none of it reached the screen. Each such row now has a ⛰ chip coloured by how hard the ground is, with the full breakdown on hover, and the save banner reports the land-mass count, the proven-no-route total, and whether the terrain model survived being checked against every faction's unit positions. Adding a measurement without surfacing it is only half the work." },
    ],
  },
  {
    version: "0.9.1431",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**The Lab can now PROVE an order was impossible, not just suspect it.** Flooding the walkable ground of map_ground_types.tga into connected land masses answers the question outright: if the ordering faction's territory and the target share no walkable land, an army cannot walk there — no hedging required. **37 orders across 14 factions are now proven to have had no land route**, and the reference log's champion stuck mission falls out of it exactly: Ariston of Chios was ordered to Erythrai in 50 of 51 turns; Chios is an island, Erythrai sits in mainland Mimas, and Chios owns no ships. Also caught: the Corsi ordered at mainland Etruria and Sardinia, Qataban and Himyar ordered across the Bab-el-Mandeb into the Horn of Africa, Sardinians at Corsica, and Cretan and Aegean city-states at the mainland. Every one of them has no navy, so the fix is concrete — a starting transport in descr_strat.txt, or a ship type they may own in export_descr_unit.txt." },
      { type: "improvement", text: "The land masses were validated against geography before anything was built on them: the fill yields 2,176 components over 1.92M walkable pixels, and they match the real world — one continental mass of 1,017 regions containing Roma, Etruria, Arvernia and Aeduia, with Britain its own 45-region mass, Ireland 5, Sicily 16, Crete 11, Cyprus 5, and Sardinia, Corsica, Euboea and Scandinavia each separate. Regions that genuinely straddle two masses (44 of them, either side of an impassable ridge) keep both, so a real two-sided province is never wrongly called unreachable." },
      { type: "improvement", text: "**The claim is falsifiable, and the check actually fires.** My first attempt asked \"does the save show them already holding the region we call unreachable?\" — which can never trigger, because owning a region puts its land mass into that faction's own reachable set. That was dead code pretending to be a safety net. The real check uses a signal the model is not built from: where each faction's units are standing. A faction the save says owns no ships, with units on a disconnected land mass, could neither have walked nor sailed there — so the model is wrong about it and that faction is dropped from the verdicts, rather than one bad strait discrediting the whole map. On the reference save it ran against all 125 factions fielding troops and found zero contradictions." },
      { type: "fix", text: "A proven-impossible route now renders as ⛔ in red. It was being drawn as a green ✓, because the good/bad decision was still keyed off an older verdict's wording." },
    ],
  },
  {
    version: "0.9.1430",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**The Lab now reads map_ground_types.tga, so \"the army never arrives\" can be checked against the ground it was ordered across.** Every other mod file answers whether a faction *can* raise the troops a campaign needs; this one answers whether the route exists at all. High mountains and dense forest are impassable, so a corridor of them turns a short-looking order into an impossible one. 1,848 findings on the reference log now carry their target region's terrain, and 22 leads flag factions whose failures cluster on ground far harder than the map's own median — the Salassi against Salassia (84% hard, 68% impassable, the Great St Bernard), the Indians against Bariy and Paropamisadai (the Hindu Kush), Saba and the Minaeans in the Yemeni highlands." },
      { type: "improvement", text: "Mission targets resolve through the settlement→region map, because the AI log names a settlement (\"moving towards sett 'Erythrai'\") while the terrain map is keyed by region — without that translation only 15 of 6,399 findings resolved. Thresholds are relative to each map's own median rather than fixed numbers, so this works on any mod. Regions too small for their percentages to mean anything are annotated but never turned into a lead: a third of the RIS map's regions have under 200 land pixels, and \"95% impassable\" measured over 98 pixels is not evidence about a route. The land-pixel count is always shown so you can judge it yourself." },
      { type: "improvement", text: "The RGB→terrain palette was verified against the real file before any of this was built: exactly 14 distinct colours, 100.000% covered, no unknowns. Findings whose cause terrain cannot explain — garrison stripping, war spam — are deliberately left alone." },
      { type: "change", text: "**Internal save-format jargon is gone from everything you can see.** One word had leaked out of the save-reading internals into tooltips, buttons, error messages, progress text and the changelog itself — 33 places across 18 files. They now all say \"read\" (for the action) or \"decoded\" (for provenance: \"decoded 2026-05-10\", \"the decoded income model\"). A test enforces this permanently across the renderer, the main process and the preload bridge, and it proves its own teeth by checking it still catches the word in each shape it previously appeared in. It caught this very changelog entry on the first attempt." },
    ],
  },
  {
    version: "0.9.1429",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**Mod Lint now catches `requires` clauses whose and/or grouping doesn't mean what it looks like — 44 of them in RIS.** RTW has no parentheses and evaluates conditions strictly left-to-right with no operator precedence (which is exactly how Provincia's own EDB evaluator reads them, and that evaluator was calibrated line-for-line against the in-game growth scroll). So `not is_player and homeland and size1 or size2 or size3` actually reads as `(((not is_player and homeland) and size1) or size2) or size3` — meaning **size2 or size3 alone satisfies it**, and the \"HOMELAND AND CAPITAL GROWTH BUFF FOR AI\" block applies regardless of whether the faction is the AI or the region is a homeland. The same shape appears on AOR recruitment gates, where a single `hidden_resource aor_galatian` sits after the `or` that follows the faction list and the `mic_tier` check." },
      { type: "improvement", text: "The warning prints the **actual** left-to-right grouping rather than describing it, because the two shapes behave differently: with a pure-`or` tail a trailing term really does satisfy the whole clause (31 cases), but when another `and` trails the `or` it does not — `A and B or C and D` is `((A and B) or C) and D` (13 cases). Claiming a short-circuit there would be worse than saying nothing, so each case gets the reading that is true for it. Both are unit-tested." },
      { type: "improvement", text: "Long `factions { … }` lists collapse to a count, each distinct clause is reported once however many building levels repeat it, and commented-out lines are skipped. It is a warning, not an error — this shape can be intentional, so the message states the reading and asks you to confirm rather than declaring a bug." },
    ],
  },
  {
    version: "0.9.1428",
    date: "2026-07-25",
    items: [
      { type: "fix", text: "**Correcting bad advice I shipped in v0.9.1425.** That version told you to \"raise the Farm level on its regions in descr_regions.txt\" for farm-poor tier-locked factions. That is wrong, and here is the proof: RIS pairs every region's farming level N with a matching `Farm<N>` tag — 1,298 of 1,311 regions, zero mismatches — and export_descr_buildings' `hinterland_region` has a \";BASE GROWTH\" block applying `population_growth_bonus bonus -N requires hidden_resource farmN` for all 14 levels. The tag and the penalty are the same number, so raising one deepens the other and fertility nets out. Provincia's own growth model, calibrated line-for-line against the in-game growth scroll, had already measured farm's coefficient at about -0.01 — I should have checked it against the Lab's advice, and didn't." },
      { type: "improvement", text: "**The Lab now proves that cancellation from your EDB instead of asserting it.** It counts the matching farm rules and reports \"14/14 levels\" as evidence. If you ever change or remove that block, the advice downgrades itself to a cautious \"check the \";BASE GROWTH\" block first\" rather than repeating a claim the files no longer support — both paths are unit-tested. Poor farmland is still reported, because it is useful context; it is just no longer presented as the fix. The real levers stay first in the sentence: `settlement_min`, the `mic_tier_*` unit requirements, or giving the faction a settlement that can grow." },
      { type: "improvement", text: "The lead now also names what actually governs growth in RIS — squalor, the core_building tier penalties, and the homeland/capital buffs in that same EDB block — so the next thing to look at is obvious." },
    ],
  },
  ];

export default CHANGELOG;
