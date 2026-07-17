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
    version: "0.9.1292",
    date: "2026-07-17",
    items: [
      { type: "fix", text: "**Mining 'Current' list tightened** — only settlements with a mine built AND earning appear (settlements whose income came from governor-building mining bonuses without an actual mine no longer slip in). Note: the first version of this filter shipped in 0.9.1291 — if Current looks unfiltered, restart the app to pick up the update." },
    ],
  },
  {
    version: "0.9.1291",
    date: "2026-07-17",
    items: [
      { type: "improvement", text: "**Mining mode, refined again per feedback.** The Current view lists only settlements with a mine actually built; clicking a settlement in the sidebar highlights its province on the map and double-clicking jumps you there (same flow as the region search); and hovering a region shows a small tooltip at the cursor with its current + potential mine income — without touching the region info panel." },
    ],
  },
  {
    version: "0.9.1290",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Two more player map modes: Threat and Reach (Military section).** *Threat* — your regions colored by border exposure: green interior, yellow foreign border, orange hostile neighbor, red at-war neighbor (war/hostile read from the loaded save's diplomacy). *Reach* — your regions colored by how far your nearest army is (green = garrisoned, red = 5+ regions away, purple = no land route) — the 'which frontier towns would die alone' view. Both use the selected faction as the perspective, falling back to the live player faction." },
    ],
  },
  {
    version: "0.9.1289",
    date: "2026-07-17",
    items: [
      { type: "improvement", text: "**Mining map mode reworked per feedback.** The sidebar now lists EVERY settlement with mineable deposits (scrollable, sorted by income) with a Current / Potential toggle that also switches what the map colors show — what mines earn today vs what they could earn at best level. The mode no longer injects anything into the region info panel, and the formula note is gone." },
    ],
  },
  {
    version: "0.9.1288",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Two new player map modes (Military section).** *Armies* — regions heat-tinted by force size: blue = the owner's troops, red = a foreign army present, purple = both; hover for unit counts and factions. *War* (live mode) — battles and sieges from the game log glow by recency, so the active front is visible at a glance; hover a region for its recorded events. First two of the player-mode series — more coming." },
    ],
  },
  {
    version: "0.9.1287",
    date: "2026-07-17",
    items: [
      { type: "improvement", text: "**The Mining map mode got its sidebar.** Legend with the bronze→silver→gold income scale, a 'Richest deposits' top-5 list (✓ = mine already built), and hovering any region now shows its minerals and exact per-level income — no deposits says so." },
    ],
  },
  {
    version: "0.9.1286",
    date: "2026-07-17",
    items: [
      { type: "fix", text: "**The 🧰 Tools menu now opens upward.** It opened downward from the toolbar and ran off the bottom of the screen, hiding the entries. It also scrolls if it ever outgrows the screen." },
    ],
  },
  {
    version: "0.9.1285",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**The 🧰 Tools menu — fifteen new analysis and modding tools in one release.** A new Tools button in the toolbar collects everything below (the Mining map mode joins the Economy map modes). Every panel is crash-isolated: if one misbehaves it shows a notice, never takes down the app." },
      { type: "feature", text: "**Mod safety net:** *Submod Drift* scans a submod folder for stale overrides of the base mod — the exact 'Could not find string' failure a teammate hit this week — and *Mod Lint* checks EDB/EDU/strat/resources for undeclared hidden resources (the fatal boot-crash class), missing units and dead conditions in ~200ms." },
      { type: "feature", text: "**Balance workflow:** *Economy Baseline* snapshots all 239 factions' turn-1 economies and diffs after mod edits; the *What-If Sandbox* applies a hypothetical EDB/EDU tweak in a temp shadow copy and shows every faction's economy delta without touching the mod; the *Unit Comparator* puts up to 6 units side by side with cost-effectiveness ratios; the *Recruit Planner* shows what each next building upgrade unlocks in the selected settlement." },
      { type: "feature", text: "**Campaign analysis:** *Compare Saves* diffs two saves (ownership flips, treasury/army deltas, population); the *Timeline Player* animates region ownership turn by turn across a scanned saves folder; the *Battle Ledger* reconstructs every battle from the live game log with per-faction win/loss records; *Victory Progress* tracks each faction's win conditions; the *Diplomacy Heatmap* shows war blocs as a sortable NxN grid; *Population Projection* simulates every settlement's squalor-aware growth N seasons ahead with decline/stall/unrest flags." },
      { type: "feature", text: "**Everyday modding:** *Find Definition* locates any unit/building/region/string across all mod files with file+line and opens your editor there; the mining map mode colors regions bronze→silver→gold by predicted mine income; the region panel's income explainer itemizes where a settlement's tax/farm/mine/trade numbers come from." },
    ],
  },
  {
    version: "0.9.1284",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**The region panel now shows real mining income.** Regions with mineable deposits get a Mining row: the actual per-turn income a mine would earn there, per level, computed with the exact formula the game uses internally (deposit quantities × trade values × the mine's effective strength) — the number the in-game building card can't show. The currently built level is marked, and predictions match live settlement scrolls to the denarius. Appears a few seconds after launch (the first computation runs quietly in the background)." },
      { type: "improvement", text: "**One-line launch diagnostics.** The moment the splash lifts, the log gets a single [boot] line: total time, when each stage finished (map, overlay, building icons, unit cards) and how much was served from the disk cache. If a launch ever feels slow again, that one line is the whole bug report." },
      { type: "improvement", text: "**The icon cache cleans up after itself.** Importing a different mod into a slot now removes the replaced mod's cached icons from disk instead of keeping them forever. (Re-importing the same folder — the reload flow — keeps the cache warm.)" },
      { type: "fix", text: "**\"Clear mod caches\" and factory reset now truly clear the faction-name/culture caches.** A silently swallowed error meant those caches survived every reset since they were introduced, so a mod reload could keep serving stale faction display data until an app restart." },
      { type: "change", text: "**Internals: the launch warm-up logic is consolidated into one scheduler module with its pacing rules under test, and the main-process file slimmed by ~1,000 lines into five focused modules.** No behavior change intended — groundwork that makes future launch work safer." },
    ],
  },
  {
    version: "0.9.1283",
    date: "2026-07-16",
    items: [
      { type: "feature", text: "**Icons are now cached on disk — warm-up becomes near-instant from your second launch.** Every unit card, building icon, and commander portrait used to be re-decoded from the game's TGA/DDS art on every single launch. Decoded images are now saved as PNGs (per source file, auto-invalidated when the mod's file changes) and served directly on later launches: no decoding, no heavy transfers, just reading small files. First launch after this update builds the cache; from the second launch the splash and post-map warm-up should shrink dramatically." },
      { type: "fix", text: "**Fixed the huge hidden cost behind 0.9.1282's slowdown.** The warm-up requests the same card art under many faction keys, and each request shipped its own full copy of the file between processes — at 100,000 requests that was gigabytes of internal traffic. Each unique file now crosses once per batch and all keys share one image. The warm-up cap is gone entirely." },
      { type: "fix", text: "**Ships no longer flash in.** Fleets sit on sea tiles, so their unit cards were missed by the region-based warm-up — all rendered army markers, navies included, are now warmed." },
    ],
  },
  {
    version: "0.9.1282",
    date: "2026-07-16",
    items: [
      { type: "fix", text: "**Zero pop-in, as fast as possible.** 0.9.1281's warm-up still truncated at 20,000 cards on large mods (the log showed it), and the background passes ran deliberately slowly — so cards could pop in for tens of seconds after the map appeared. Three changes: each unique card file is now decoded once ever and shared across all faction keys (most of those 20,000+ were the same art), the cap is effectively gone (100,000), and every post-splash pass now runs at full pipelined speed with no redraw storms. Commander-portrait warming is quicker too. The whole map should be warm within a few seconds of reveal." },
    ],
  },






];

export default CHANGELOG;
