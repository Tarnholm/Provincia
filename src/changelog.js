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
    version: "0.9.1477",
    date: "2026-08-03",
    items: [
      { type: "improvement", text: "**Crash-reporter 0.1.48: the intentional trait-display warnings no longer pollute crash reports.** The RIS team confirmed the engine's repeated \"Current Trait: X mismatch between attribute list and listed effects\" lines are by design — several traits deliberately carry zero-effect levels as part of their level scaling, and the warning cannot be silenced in-game. The reporter now keeps those lines out of the report's last-line headline (one crash report led with the Autumn trait warning and buried the actual crash-dump signal) and out of every assert/settlement/asset context window, counts them, and states once that they were ignored. The raw lines still ship in the attached log tails, so nothing is silently dropped, and the selftest proves the matcher hits the real telemetry lines and nothing else." },
    ],
  },

  {
    version: "0.9.1476",
    date: "2026-08-03",
    items: [
      { type: "fix", text: "**The stray road fragments — a road drawn as dashes, a spur floating on its own in a province — are gone.** They were real game roads all along, but the connecting strokes between waypoints were missing, so a continuous road rendered as a broken line. Yesterday's coverage check couldn't see it: it asked whether each of the engine's 62,939 waypoints had geometry near it (100%), never whether the stretch BETWEEN two waypoints was drawn. Measuring that found 570 broken segments — 2.4% of the network. Those stretches are now rebuilt from the engine's own path, and the release is verified on both metrics: **every waypoint present (100%) and every segment between them drawn (100%)**, with no road point on a sea pixel." },
      { type: "fix", text: "**Corrected a bad sea-pixel test that had been nudging road points off the engine's own geometry.** Checking which pixel a point sits in must floor its coordinate, not round it — baked points sit at pixel centres, so rounding reports the neighbouring pixel and calls a correctly-placed coastal road \"in the water\". Under the wrong test the network appeared to have 2,543 points at sea; it has none, and never did. The clamp that acted on those false readings had displaced 29 points by up to 1.4px, which is now reverted." },
    ],
  },

  {
    version: "0.9.1475",
    date: "2026-08-03",
    items: [
      { type: "feature", text: "**The road network is now the game's complete network — every single waypoint.** The bake reproduced 62,388 of the engine's 62,939 road waypoints (99.12%); the missing 551 sat in 230 short runs that the mask pass clipped away at junctions and chain ends. Those runs are now emitted as extra chains built from the engine's own waypoints and its own road spline (tangent from the neighbouring nodes, cubic Bézier with 0.33 control arms, 5 subdivisions), each overlapping the existing network by one waypoint on both sides so nothing dangles, and each region-tagged so per-province clipping treats them like the rest. **Coverage is now 62,939 of 62,939 — 100.00%.** New points that the curve bowed into water are clamped back to land." },
      { type: "fix", text: "**Dragging the map is much smoother.** Two things dominated pan frames. Province borders were stroked one path per province — about 1,300 separate stroke calls every frame — and they all share a single style, so they are now pre-combined into one path and drawn in a single call. And while a drag is actually in progress the map now draws roads at their cheapest level of detail and skips the road casing entirely; full detail is restored the instant you release. Nothing about the still image changes." },
    ],
  },

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
