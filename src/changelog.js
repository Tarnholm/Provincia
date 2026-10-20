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
    version: "0.9.1541",
    date: "2026-10-20",
    items: [
      { type: "fix", text: "**RIS Light shows all its resources again.** Its region map is saved compressed, and the import read it as plain pixels, so nearly every resource was dropped (3 icons on the map instead of about 1,900). Re-import the Light folder once after updating to rebuild the list." },
    ],
  },
  {
    version: "0.9.1540",
    date: "2026-10-17",
    items: [
      { type: "fix", text: "**The Terrain map mode has its legend back.** It went missing in 0.9.1395, when the three income modes were merged." },
      { type: "improvement", text: "**Export map as PNG saves at three times the screen's resolution.** Same view, sharper image." },
      { type: "fix", text: "**The fertility scale follows the map.** RIS now runs Farm1 to Farm12, so the Fertility legend and the region panel's colour no longer assume 14; RIS_Light, which still reaches Farm14, keeps its 14." },
    ],
  },
  {
    version: "0.9.1539",
    date: "2026-10-17",
    items: [
      { type: "feature", text: "**Map 2 can show another campaign.** Click a campaign slot in the second map window to show it there, Imperial on one screen and RIS Light on the other, with its own map mode and overlays. While it shows a different campaign from the main window it is view only (its title says so): edits, tools and Live stay with the main window, which is the campaign Provincia saves into. Click the main window's slot in Map 2 to follow the main window again." },
    ],
  },
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
  ];

export default CHANGELOG;
