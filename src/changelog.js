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
    version: "0.9.1535",
    date: "2026-10-16",
    items: [
      { type: "fix", text: "**Saving a submod campaign writes to that campaign.** Edits made on a submod map such as RIS Light (buildings, characters, garrisons, armies, ownership, playable nations) were written into the main mod’s campaign instead, matched by region name — so they landed on the wrong towns and the submod’s own descr_strat was left unchanged. They now go to the campaign you imported, and Export puts them under that campaign’s own path." },
      { type: "fix", text: "**Saving descr_regions keeps every region’s owner.** A save that changed anything in descr_regions (a hidden resource, say) also replaced each region’s rebel-default faction with its descr_strat starting owner — 352 of RIS Light’s 605 regions on one save. Only the lines you edited change now." },
      { type: "fix", text: "**A save stops before writing if the edits don’t fit the file.** If an edited region isn’t in the descr_strat it would be written to, nothing is saved and the message names the regions and the file." },
      { type: "fix", text: "**Ownership and playable-nation saves keep the building and character edits saved before them.** They used to rebuild descr_strat from the copy read at import, which threw those edits away." },
      { type: "improvement", text: "**Bundled Crash Reporter v0.1.68.** When AI watch ran alongside the game, the reporter also sends that session’s AI watch rounds (what each AI faction planned every round, and why) as a follow-up message after the report." },
    ],
  },
  {
    version: "0.9.1534",
    date: "2026-10-12",
    items: [
      { type: "improvement", text: "**Loading a save no longer freezes the app.** The heavy read-and-decode of a 30–45 MB save now runs off the main thread, so the window stays responsive while it works. It is also decoded once and shared between the panels that need it (economy, tax plans, the settlement read) instead of being redone three to five times on every load." },
      { type: "improvement", text: "**Switching map modes is instant.** Each mode’s coloured map is kept and reused until the underlying data changes, so flipping between, say, Faction, Population and Economy no longer rebuilds the whole map each time. The recolour itself is faster too, and the Culture map’s striped overlay is now prepared once rather than re-scaled on every repaint." },
      { type: "improvement", text: "**Lighter and quicker to start.** The start-up sound is about 10 MB smaller, and the tool panels now load the moment you open one rather than all at once up front — so the app starts from a smaller download and a smaller first load." },
    ],
  },
  {
    version: "0.9.1533",
    date: "2026-10-12",
    items: [
      { type: "improvement", text: "**New look.** A new splash screen and app icon — a Roman aquila and standard over a gold map of the classical world." },
    ],
  },
  {
    version: "0.9.1532",
    date: "2026-10-12",
    items: [
      { type: "improvement", text: "**Bundled Crash Reporter v0.1.67.** The reporter is now hardened against being picked apart with a debugger. It makes no difference to normal use — it changes nothing on disk and never stops a report from being sent." },
    ],
  },
  {
    version: "0.9.1531",
    date: "2026-10-12",
    items: [
      { type: "feature", text: "**Crash Reporter v0.1.66 turns the game’s full logging on.** Before the game starts and again after it closes, `show_err enable_logging verbose_script_logging` is added to the game’s Advanced settings and switched on. Your other switches, `-nm` included, stay. The standalone reporter also starts the game through Steam when it opens (`launch_game` in its settings), has a new icon in its window and taskbar, and names more decoded crash addresses." },
      { type: "feature", text: "**Dashboard: Engine rules.** A new tile and section check the mod against rules decoded from the game itself: a banner for every culture, culture filters with no factions, the AI personality file’s line endings, building-browser gaps and hidden levels, EDB field widths, and/or grouping, dead recruit lines, horde units, emergence lists, armies over 20 units, hold_regions names, portrait folders and variation blocks, picture fallbacks, event strings and flood scale." },
      { type: "improvement", text: "**Public order shows the exact culture penalty.** Without a save, the penalty is now worked out the way the game does it, from who built each building in the town, instead of a flat -22. The turn-1 tooltip lists which factions hold the culture points. Checked against RIS turn-1 saves: 1,304 of 1,306 towns match." },
      { type: "fix", text: "**New Faction keeps map.rwm in step.** The map stores each region’s creator by faction number, and a new faction shifts every number after it, so rebel towns showed other factions’ banners. Every map.rwm in the mod is now updated with the rest of the files, and the preview says how many regions change. The donor’s captain art is copied, and the donor’s shadow-faction link is no longer cloned." },
      { type: "fix", text: "**Faction tools read sub_faction characters’ real names.** A line like `character sub_faction odrysians, Taroutinas, …` was read as the name “sub_faction odrysians”, so Bring In a Faction picked the same character twice." },
      { type: "fix", text: "**The installer carries the RIS faction list from alternate_map.** v0.9.1530 shipped a test branch’s 250-faction list; the bundled faction list and icons now always come from the alternate_map branch." },
    ],
  },
  {
    version: "0.9.1530",
    date: "2026-10-07",
    items: [
      { type: "fix", text: "**Bring In a Faction and New Faction give each character its own tile.** Every character used to be put on the town’s tile. Now only the faction leader stands in the town; everyone else goes to the nearest free tile in the town’s region, or in a neighbouring region if the region has none. A free tile has no mountain, dense forest, river, sea, cliff or volcano, and no other character on it. An admiral goes to the nearest free shallow-sea tile off the town. The preview shows where each character will stand." },
      { type: "fix", text: "**A town taken from the rebels arrives empty.** The rebels’ garrison in the town and any rebel character standing on its tile are removed, instead of staying inside the new owner’s walls. The preview says what was removed." },
      { type: "improvement", text: "**Brought-in characters are written the way RIS writes them.** Each character has a `;Asculum`, `;Outside Asculum` or `;Port of …` line above it, the family records follow as one group under the leader’s name, then the family links, with one blank line after each group." },
    ],
  },
  ];

export default CHANGELOG;
