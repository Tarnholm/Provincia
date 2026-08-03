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
    version: "0.9.1473",
    date: "2026-08-03",
    items: [
      { type: "improvement", text: "**Regression tests pin the dashboard's \"hide clean validators\" behaviour.** The feature shipped in 0.9.1472 but was reported as not working — it was simply not in the installed build yet. Two tests now assert it directly: sections with 0 issues don't render, sections with findings do, and unticking \"Hide clean\" brings the empty ones back. Verified against the real symptom (a 0-count \"Dangling chain references\" section sitting in the list)." },
    ],
  },

  {
    version: "0.9.1472",
    date: "2026-08-03",
    items: [
      { type: "fix", text: "**The building-localization audit was reading UTF-16 text files as UTF-8, so it reported all 637 keys missing when every one of them was present.** The engine's text/*.txt files are UTF-16 LE with a BOM; decoded as UTF-8, every character comes back followed by a NUL, so a search for {region_base} could never match even though the string sits right there in export_buildings.txt. All mod-file reads now sniff the BOM (UTF-16 LE/BE, UTF-8, or plain 8-bit) and decode accordingly, which also covers the rule files that genuinely are 8-bit. On RIS: 273 declared building levels, 273 falsely reported missing, now 0." },
      { type: "improvement", text: "**The dashboard hides validators with no issues.** Clean sections aren't actionable and made the list long to scroll, so they're collapsed away by default; a \"Hide clean\" checkbox in the header brings them back when you want to confirm a validator actually ran. The summary tiles already skipped zeros, so tile-to-section jumps are unaffected." },
    ],
  },

  {
    version: "0.9.1471",
    date: "2026-08-03",
    items: [
      { type: "fix", text: "**The unit-strings audit was reading the wrong field, and reported 1,691 problems that didn't exist — it now finds the 3 that do.** A unit's name, description and unit card come from the export_units.txt entry named by its EDU **dictionary** line, not by its `type` line; the check was looking up `type`, which contains spaces and therefore can never match a text token, so on RIS it flagged all 1,691 units. It now resolves via `dictionary` and groups the types that share one entry (\"roman leves\" and \"aor roman leves\" both use roman_leves), turning 1,691 findings into 3 real ones on RIS." },
      { type: "improvement", text: "**Missing unit strings now suggest the near match, which is usually the actual typo.** Two of the three real RIS findings are one letter apart: the EDU asks for legio_vii_paterna_macedon**ica**_early while the text file spells it macedon**ia**_early. The audit prints \"→ did you mean {…}?\" next to any missing key with a close existing token, so the fix is visible without grepping." },
    ],
  },

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
