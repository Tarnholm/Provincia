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
    version: "0.9.1470",
    date: "2026-08-03",
    items: [
      { type: "fix", text: "**Trade Lanes stays smooth with the full all-built network on.** Two hot paths were doing per-item work that scaled with the what-if's 600+ lanes: every repaint stroked each sea lane individually (dashed strokes are the most expensive kind), and every mouse move measured the cursor against every segment of every lane and road — hundreds of thousands of distance checks per move. Sea lanes now stroke as one combined path per frame (the same batching roads already had; the dash pattern restarts per lane, so the look is pixel-identical), and lane hover uses a precomputed bounding-box index with lightly thinned points, so a mouse move only measures the handful of polylines actually near the cursor." },
      { type: "change", text: "**The all-built what-if now also simulates universal trade agreements.** Every faction is treated as having trade rights with every other faction (rebels still can't trade, and wars still block — the engine kills trade at war regardless of rights), so partner choice in the what-if network is purely geography and economy instead of favouring campaign-start allies." },
    ],
  },

  {
    version: "0.9.1469",
    date: "2026-08-03",
    items: [
      { type: "feature", text: "**Dev All-built what-if: a roads-only stage, and a coverage validator that names the provinces trade can't reach.** The cycle on the active Trade Lanes button is now ROADS (every province's roads built, ports stay real) → all ports level 3 → 2 → 1 → off, so the road network can be tested on its own. Each stage prints an [all-built] coverage report to the console: provinces with no road piece even in the all-roads world, and — the interesting list — provinces that are coastal and faction-owned yet get no sea lane even with every port built, each with the exact reason (all their landing frontiers are land neighbours, or point at rebel regions). On RIS that fixable list is 12 provinces (Cantabria, Caledonia, Adramitia…); the expected exclusions (landlocked, rebel-owned) collapse to summary counts so they don't bury the signal." },
    ],
  },

  {
    version: "0.9.1468",
    date: "2026-08-03",
    items: [
      { type: "change", text: "**Dev mode: the All-built what-if now lives on the Trade Lanes button itself — the separate 🏗 button is gone.** With Trade Lanes active in dev mode, clicking the mode button again cycles the assumed port level: dockyard → shipwright → port → off, shown as a small ALL·3/2/1 chip on the button. Same what-if underneath (every settlement's roads and port treated as built, level = sea lanes per port); one less button in the bar." },
    ],
  },

  {
    version: "0.9.1467",
    date: "2026-08-03",
    items: [
      { type: "feature", text: "**Dev mode: 🏗 All built — see the whole trade world at once.** A new dev-only button in the map-mode bar treats every settlement as having roads and a port built: the full road network draws unclipped (no per-province masking), every harbour road appears, and the sea-lane map regrows as the what-if network those ports would trade on. Clicking cycles the assumed port level — dockyard → shipwright → port → off — and the level is the number of sea lanes each port gets (3/2/1), exactly the game's own export-slot rule, so you can watch the network densify as ports upgrade. On RIS that's 243 lanes at level 1 growing to 612 at level 3. Selection stays the engine's real greedy rule (value-ranked sea-reachable partners, land neighbours skipped, wars excluded) — only the buildings are hypothetical, so the what-if map stays honest about geography and diplomacy." },
    ],
  },

  {
    version: "0.9.1466",
    date: "2026-08-03",
    items: [
      { type: "improvement", text: "**Crash-reporter 0.1.47: the season/date-ordering assert is now annotated as a known 4TPY artifact instead of looking like a defect.** The assert — year and season comparison failing between turns — fires 20 to 218 times a session on every beta from v7.9 to v7.13. Root-caused on the shipped campaign script: the 4-turns-per-year section forces the season back to summer on 2 of every 4 turns, so same-year dates sort out of order and every later date comparison (character ages, trait gains, event timers) trips the engine's summer-before-winter invariant. It has never been crash-associated in 486 telemetry sessions; reports now say so explicitly — structural to the 4TPY design, harmless, ignore in triage. The reporter selftest proves the matcher fires on the real telemetry text and stays silent on any other season-ish assert." },
    ],
  },

  ];

export default CHANGELOG;
