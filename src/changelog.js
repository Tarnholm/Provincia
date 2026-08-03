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
    version: "0.9.1474",
    date: "2026-08-03",
    items: [
      { type: "fix", text: "**Trade Lanes pans smoothly with the whole road network on.** With the all-built what-if the network is about 171,000 points, and it was stroked twice per frame — a dark casing plus the tan road — on every pan, zoom and lane hover. The geometry is now pre-built at three levels of detail and the map strokes the cheapest one the current zoom can justify: full detail up close, half and quarter as you zoom out, where the extra points sit well under a pixel and can't be seen anyway. The casing is skipped at the furthest zoom too, since it hides entirely beneath the fill stroke there. Same look, roughly a quarter of the per-frame work when zoomed out." },
    ],
  },

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

  ];

export default CHANGELOG;
