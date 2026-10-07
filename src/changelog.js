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
 * docs/changelog-archive.js (npm run ship trims it automatically past 8).
 */
const CHANGELOG = [
  {
    version: "0.9.1530",
    date: "2026-10-07",
    items: [
      { type: "fix", text: "**Bring In a Faction and New Faction give each character its own tile.** Every character used to be put on the town’s tile. Now only the faction leader stands in the town; everyone else goes to the nearest free tile in the town’s region, or in a neighbouring region if the region has none. A free tile has no mountain, dense forest, river, sea, cliff or volcano, and no other character on it. An admiral goes to the nearest free shallow-sea tile off the town. The preview shows where each character will stand." },
      { type: "fix", text: "**A town taken from the rebels arrives empty.** The rebels’ garrison in the town and any rebel character standing on its tile are removed, instead of staying inside the new owner’s walls. The preview says what was removed." },
      { type: "improvement", text: "**Brought-in characters are written the way RIS writes them.** Each character has a `;Asculum`, `;Outside Asculum` or `;Port of …` line above it, the family records follow as one group under the leader’s name, then the family links, with one blank line after each group." },
    ],
  },
  {
    version: "0.9.1529",
    date: "2026-10-06",
    items: [
      { type: "fix", text: "**New Faction caps a mod at 255 factions.** The tool used to warn at 239 and still let you go on. RIS now runs 250 factions, and 255 works in game, so the limit is 255: a mod with 255 factions cannot get another one, and the panel says so and keeps the Create button disabled." },
      { type: "fix", text: "**New Faction finds the donor’s recruitment again.** RIS now starts every building and recruit requirement with a rule that keeps the rebels out, and the tool skipped every line that had any such exclusion. A donor like the Parni was offered none of its 128 recruit lines. Each requirement is now read part by part, and the new faction is added where the donor is granted something, never inside an exclusion." },
    ],
  },
  {
    version: "0.9.1528",
    date: "2026-10-06",
    items: [
      { type: "fix", text: "**Crash reports say what the game had loaded.** A report now lists the tools injected into the game (such as RR Turbo, with the modules it had switched on, its settings file and the end of its log), the exact build of every mod (the branch and commit of a development copy, the Workshop update of a Workshop copy) and the graphics card with its driver version. It also counts the game’s own failure messages over the whole session, such as textures that failed to load or unit and building pictures that are missing, instead of only the last few hundred lines. The RIS development copy is no longer flagged as an unapproved mod (bundled crash reporter v0.1.63)." },
      { type: "fix", text: "**The AI Movement Lab counts retreats.** A message log whose only movement traces were armies fleeing was reported as having no movement at all, because two of the log’s four kinds of retreat line were read and then dropped. All four now count, including the common one where the game writes its next log line onto the end of the retreat." },
      { type: "fix", text: "**One crash address now gets the right verdict.** Crashes at +0x266FD3, the most common one in the telemetry, are now filed as the game’s own fault in its interface image handling rather than as unexplained (bundled crash reporter v0.1.62)." },
      { type: "fix", text: "**Crash reporter names the mods that actually ran.** Reports used to list the mods enabled in the launcher, and that list can be out of date or disagree with what the game loaded. A report labelled “RIS + 4 Romans” had in fact run 4 Romans alone. The mod list now comes from the game’s own message log. When a submod runs without the RIS beta under it, when the game cannot start its display, or when the graphics card fails at the end of a session, the report now says so and tells the tester what to do, instead of blaming the mod’s files. The game’s list of script events at shutdown is no longer counted as an error (bundled crash reporter v0.1.61)." },
    ],
  },

  {
    version: "0.9.1527",
    date: "2026-10-02",
    items: [
      { type: "improvement", text: "**Trade Lanes map: roads redrawn for the current RIS map.** The road network was read again from the game after this summer's map changes: 356 settlements now connect to different neighbours than before (3,003 roads in all). Settlements the game no longer reaches by road, such as Alexandreia-Arachosia, now show none, as in the game." },
    ],
  },

  {
    version: "0.9.1526",
    date: "2026-10-02",
    items: [
      { type: "improvement", text: "**Settlement trade income now matches the game to the denarius.** Trade is computed from your save the way the game computes it: every land route (population, goods, trade rights, road links and road levels, the governor's trading skill), every sea route (which ports a town's fleets pick, distance, docks, blockades, enemy armies in the region), the imports each partner sends back, and the Colossus. Checked against the running game on all 811 faction-owned settlements of a Turn 2 save: every one matches. Hover a settlement's trade value to see its routes row by row, like the in-game income scroll." },
    ],
  },

  ];

export default CHANGELOG;
