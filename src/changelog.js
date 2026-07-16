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
    version: "0.9.1281",
    date: "2026-07-16",
    items: [
      { type: "fix", text: "**AOR unit cards no longer load in slowly.** The Areas-of-Recruitment roster keys its cards by region owner, and those pairs fell past the warm-up's safety cap (the log showed it truncating at 8,000 cards). The warm-up now computes each region's AOR units precisely and loads them first, and the cap is raised to 20,000 — AOR panels should open fully drawn like everything else." },
    ],
  },
  {
    version: "0.9.1280",
    date: "2026-07-16",
    items: [
      { type: "fix", text: "**Killed the last hover \"flash\": commander portraits.** Hovering a region swapped each bodyguard card for its general's portrait — resolved lazily, per character, the first time you hovered them, which read as a flash. All on-map commanders' portraits are now warmed quietly right after the map appears, so the panel's first render is already the portrait." },
      { type: "improvement", text: "**Background icon warm-up finishes much sooner.** The post-splash passes (recruit cards, remaining building catalog) were deliberately slow-paced from the fix in 0.9.1278; now that card lookups are indexed they run at a brisker pace — the whole map should be fully warm within seconds of the map appearing, while input stays responsive." },
    ],
  },
  {
    version: "0.9.1279",
    date: "2026-07-16",
    items: [
      { type: "improvement", text: "**The splash now says what it's doing.** A subtle loading line sits at the bottom of the splash from the very first paint — \"Loading map…\", \"Painting the map…\", \"Loading building icons…\", \"Loading unit cards…\" — so a longer hold never looks like a hang." },
    ],
  },
  {
    version: "0.9.1278",
    date: "2026-07-16",
    items: [
      { type: "fix", text: "**Fixed the very slow launch 0.9.1277 introduced.** Three compounding causes, all measured in the logs: the new recruit-card warm-up held the splash for its entire run (105 seconds for 8,200 cards); each card lookup could fall into a full directory scan in the main process; and the background icon pass redrew the whole app every 120ms, causing seconds-long stalls after the map appeared. Now: card files are indexed once at startup (lookups are instant), the splash waits only for the on-map army cards like 0.9.1276 did, the recruit warm-up runs quietly in the background after the map appears, and background passes no longer force app redraws. Launch should be back to 0.9.1276 speed — with the recruit tab still fully drawn within a few seconds of the map appearing." },
    ],
  },
  {
    version: "0.9.1277",
    date: "2026-07-16",
    items: [
      { type: "fix", text: "**Fixed the Terrain and Heights overlays on imported mods.** Both overlays sample map files (map_ground_types.tga / map_heights.tga) that the mod importer never copied — so on an imported slot they silently loaded nothing. The importer now brings both files along (the once-per-launch mod refresh picks them up automatically, so this self-heals on your next restart)." },
      { type: "improvement", text: "**The settlement Recruits tab now opens fully drawn.** The splash warm-up now also loads the card of every unit each map faction can recruit — computed from unit ownership in one cheap pass, not the expensive per-settlement walk — so recruit lists no longer fill in card-by-card." },
      { type: "improvement", text: "**Launch uses more CPU cores.** The icon decode pool was capped at 6 workers; it now scales with your machine (cores minus two, up to 12) and is fed bigger batches, so the behind-the-splash warm-up finishes noticeably faster on 8+ core machines." },
    ],
  },







];

export default CHANGELOG;
