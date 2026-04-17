/**
 * Changelog entries, newest first.
 * Each entry: { version, date, items: [{ type, text }] }
 * Types: "feature", "fix", "improvement", "change"
 *
 * Display versions only — the 4th segment in package.json (e.g. "0.9.2.10") is a
 * silent iteration counter for test builds and is stripped before gating/display.
 */
const CHANGELOG = [
  {
    version: "0.9.3",
    date: "2026-04-17",
    items: [
      { type: "improvement", text: "Faster launch: the Vite build system replaces the old bundler — 10× faster dev iteration and a smaller install footprint" },
      { type: "improvement", text: "Cleaner internals: the UI code is split into smaller modules (mute button, update banner, toasts now live on their own)" },
      { type: "fix", text: "Dropped 31 npm dependency vulnerabilities carried over from the old build system" },
    ],
  },
  {
    // The 4th segment is a silent "edition" counter — bump it to force the
    // changelog to reappear once after adding new items to an existing version.
    // The UI strips it (users see "v0.9.2"), and gating uses it for comparison.
    version: "0.9.2.1",
    date: "2026-04-17",
    items: [
      { type: "feature", text: "Auto-updates: checks for new releases on startup and installs them on restart" },
      { type: "feature", text: "Non-fatal errors now surface as dismissable toasts instead of failing silently" },
      { type: "feature", text: "Mute toggle for the startup sound — speaker icon in the bottom-right, muting silences but doesn't interrupt the track" },
      { type: "feature", text: "Bundled faction icons so the first launch has visuals before any mod is imported" },
      { type: "improvement", text: "Duplicate faction colours in the legend now show a warning icon listing which factions share a colour" },
      { type: "improvement", text: "TGA map decoding moved to a Web Worker — no more brief UI freeze on campaign switch" },
      { type: "improvement", text: "Mod-file parsers consolidated into a shared module with unit tests" },
      { type: "improvement", text: "Upgraded Electron to 41.2.1 and electron-builder to 26.8.1" },
      { type: "improvement", text: "Build now auto-bundles the latest RIS mod files from C:\\RIS" },
      { type: "fix", text: "First-run onboarding cards show correctly after reinstalling over a previous version" },
      { type: "fix", text: "Changelog no longer re-appears every time you switch campaigns" },
      { type: "fix", text: "Auto-updater 404/offline errors no longer pop as toasts (only real failures do)" },
    ],
  },
  {
    version: "0.9.1",
    date: "2026-04-16",
    items: [
      { type: "fix", text: "Imported faction colours now survive an app restart (previously reverted to bundled colours)" },
    ],
  },
  {
    version: "0.8.7",
    date: "2026-04-15",
    items: [
      { type: "feature", text: "First-launch walkthrough and version changelog screen" },
      { type: "feature", text: "Onboarding highlights relevant UI elements as you step through" },
      { type: "fix", text: "Faction colours now always load from the latest imported data" },
    ],
  },
  {
    version: "0.8.4",
    date: "2026-04-14",
    items: [
      { type: "feature", text: "Added Armies map mode showing garrisons, field armies, and navies" },
      { type: "improvement", text: "Campaign import now auto-detects faction icons directory" },
    ],
  },
  {
    version: "0.8.3",
    date: "2026-04-12",
    items: [
      { type: "feature", text: "Resource map mode with category filtering" },
      { type: "feature", text: "Pin regions for quick access" },
      { type: "improvement", text: "Screenshot export now includes colour mode in filename" },
    ],
  },
];

export default CHANGELOG;
