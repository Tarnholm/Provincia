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
  {
    version: "0.9.1273",
    date: "2026-07-16",
    items: [
      { type: "improvement", text: "**Faster startup: the mod database is now parsed once per launch instead of six times.** Boot-time telemetry showed the full mod parse (the 2MB campaign file, building tree, 4,600+ character names, traits) running six times at every startup — each run blocking the app — because the startup sequence re-requests it as things settle. The result is now cached and reused until a mod file actually changes on disk (editing the mod, or Manipula writing the building file, still reloads exactly as before)." },
      { type: "improvement", text: "**The colored map overlay is also built once per launch instead of 4–6 times.** Each startup step used to queue another full overlay build without cancelling the previous one; now only the final, fully-settled version builds. Together these two changes cut several seconds of redundant work from every launch." },
    ],
  },
  {
    version: "0.9.1272",
    date: "2026-07-16",
    items: [
      { type: "fix", text: "**Found and killed the engine behind ALL the recent lock-ups: the app was silently redrawing itself ~10+ times per second, forever, whenever a region was selected.** Every redraw of a settlement panel asked for its building icons, and even when every icon was already cached the answer still triggered another full redraw — a perpetual loop. On a fast idle machine it just burned CPU; combined with anything expensive (faction switching, Dev mode, panels) it starved the window until nothing responded — including React's own 'maximum update depth exceeded' errors visible in provincia.log. The icon fetch now reports whether anything new was actually loaded, and the redraw only happens when the answer is yes: the loop cannot sustain itself anymore. Selecting factions, regions, and map modes should finally feel instant — and the app no longer burns a CPU core while sitting idle." },
    ],
  },


];

export default CHANGELOG;
