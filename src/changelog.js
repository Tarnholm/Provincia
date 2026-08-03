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
    version: "0.9.1478",
    date: "2026-08-03",
    items: [
      { type: "fix", text: "**The duplicated roads are gone — and most of what the last two releases \"repaired\" never needed repairing.** The gap-finder's coverage test only searched a 3×3 pixel neighbourhood, so it could not see geometry more than about 1.4px away and declared roads missing that were plainly there. It reported 570 broken segments; with the search sized correctly there are 48, and only 15 stretches on the whole map are genuine holes. The earlier fills therefore drew fresh line alongside road that already existed, which is the doubling that showed up in Igyllionia. The network is now back to the approved bake plus those 15 real holes closed: no waypoint and no segment is more than 4px from drawn road, nothing sits on sea, and the Igyllionia view renders pixel-identical to the approved geometry." },
      { type: "improvement", text: "**The road gap tool now measures before it decides, and refuses to draw over itself.** It reports the distance distribution rather than assuming a threshold — the bake follows the game's aerial curve, which drifts up to about 2.5px from the manager centreline, so anything closer than that is the same road drawn slightly differently, not a gap. It also counts how many points it would place on top of existing road and reports it every run; that number is 0." },
    ],
  },

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

  ];

export default CHANGELOG;
