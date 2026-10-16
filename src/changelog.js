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
    version: "0.9.1538",
    date: "2026-10-16",
    items: [
      { type: "change", text: "**The ⧉ Map 2 button is on for everyone in dev mode.** It used to need a tick box in Tools first, so most people never saw it. The tick box is still there to hide it again." },
    ],
  },
  {
    version: "0.9.1537",
    date: "2026-10-16",
    items: [
      { type: "feature", text: "**Compare Settlements: fill a submod town from the main mod.** A new Settlements tab in Bring In a Faction (also on its own tile, ⇋ Compare Settlements) puts each town on this map beside the same town in the main mod — found by region, or by settlement name where the map was redrawn — with level, population and every building chain side by side. The list starts with the towns that have the most to fill. **Fill in what is missing** ticks every chain the town lacks or has smaller, and the level and population when the main mod’s are bigger; **Match the main mod** ticks every difference, smaller values and removals included. The level and the core building tick together. Buildings keep their place in the town, new ones arrive as the main mod writes them, and commented-out (;GOVPO) buildings are left alone. Each building warns when it needs a bigger town than this one will be, a hidden resource the region lacks on this map, or a slot another building already fills. Works for RIS_Light and RIS_Classic against the main mod with no setup." },
      { type: "fix", text: "**A building listed twice in a town shows up.** The compare marks it (RIS_Light has three: port_buildings in Parthenope, glass_production in Mareotis and Rhodos), and taking it keeps one copy." },
    ],
  },
  {
    version: "0.9.1536",
    date: "2026-10-16",
    items: [
      { type: "feature", text: "**Bring In a Faction also adds to factions already on the map.** Under the dormant factions there is now an “On the map” list. Pick one and it works as before: towns from this map (suggested from what it holds in the main mod), and characters, armies and family copied from the main mod. The faction keeps everything it already has. Its own towns and anyone already on the map are shown but can’t be picked twice. A faction has one leader and one heir, so a main-mod leader or heir arriving where the faction already has one comes as a plain family member, and the list says so. Characters can be added without taking a town." },
      { type: "improvement", text: "**Characters brought in stand near their own towns.** Each one goes to the town nearest where they stand in the main mod, when the faction holds that town on this map. Before, everyone gathered at the first town chosen. The preview now says once per town when it ran out of free tiles, instead of a line for every character." },
    ],
  },
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
  ];

export default CHANGELOG;
