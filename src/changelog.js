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
  {
    version: "0.9.1276",
    date: "2026-07-16",
    items: [
      { type: "improvement", text: "**Unit cards now load instantly.** Scrolling the map used to show blank unit cards for a moment while each portrait loaded one-by-one; the cards of every army on the map are now loaded up-front behind the splash (in one batch, decoded across CPU cores), so panels open fully drawn. Loading a save tops up any new units' cards quietly in the background. The splash can hold a touch longer to cover this — that's the intended tradeoff." },
      { type: "improvement", text: "**Mod icon changes now apply live.** Updated faction icon TGAs in your mod folder are picked up by a running app the moment they change on disk — no restart needed. (New icons were always used after a restart; now they hot-swap in place.)" },
      { type: "fix", text: "**Quieter launch.** The once-per-launch mod re-read no longer flashes the \"Reloading mod from disk…\" overlay or shows a toast — it runs silently. Manual reloads via the button keep their confirmation." },
      { type: "change", text: "**The Loyalist map mode moved into Dev mode**, alongside the other editing-oriented modes." },
      { type: "improvement", text: "**The Live button is now readable in dark mode** — its label shows in yellow when live mode is off (it used to render dark grey on dark, looking disabled)." },
    ],
  },
  {
    version: "0.9.1275",
    date: "2026-07-16",
    items: [
      { type: "improvement", text: "**The splash now lifts ~4 seconds earlier.** It used to hold until every one of the ~5,700 possible building icons was loaded; it now waits only for the icons of settlements actually on the map, then finishes the rest quietly in the background. In rare cases a building icon can pop in a moment late (e.g. right after granting a settlement to a new faction in Dev mode) — the tradeoff for the faster start. Icon loading itself also got faster: the decode workers no longer sit idle between batches." },
      { type: "improvement", text: "**Less background work while you use the app.** Dark-theme users no longer pay for the light-theme contrast watcher (it rescanned every panel element on every screen change, doing nothing useful in dark mode). Startup no longer parses the mod database twice in the app window (the six-times-per-launch main-process parse was fixed in 0.9.1273; this closes the remaining renderer-side double). And the Garrison and Field-armies panel data — the last two heavy panel computations that re-derived on every redraw — are now cached and only recompute when the underlying data changes. Two stale-cache edge cases in the recruit/character panel caches were fixed along the way." },
      { type: "change", text: "**The in-app changelog now shows the last 5 versions** instead of the full 1,100+ entry history, which had grown to nearly a megabyte parsed on every post-update welcome screen. The full history lives on in the repository." },
      { type: "change", text: "**Release plumbing (internal):** publishing is now one command that ends by verifying the update feed actually serves the new version, and a repository check fails loudly if a release commit ever lands unpublished — the 0.9.1269 \"committed but never shipped\" gap can't silently happen again. The app's main code file also shed ~1,500 lines into a tested module, groundwork for further splitting." },
    ],
  },
  {
    version: "0.9.1274",
    date: "2026-07-16",
    items: [
      { type: "improvement", text: "**The splash art now appears the instant the window opens.** It used to wait for the app's whole JavaScript bundle to load and start (1–2 seconds of blank window); the splash is now part of the page itself and paints ~0.3s into window load, before any code runs — then the app takes over seamlessly, pixel-identical. The brief flash before the very first paint is now dark instead of white, too." },
    ],
  },




];

export default CHANGELOG;
