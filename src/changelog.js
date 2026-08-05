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
    version: "0.9.1481",
    date: "2026-08-06",
    items: [
      { type: "fix", text: "**A submod campaign now inherits its map from the base mod — and your base-folder edits actually reach it.** A thin submod like RIS Four Romans ships only the files it changes (descr_strat, campaign script, text), so importing its folder found no map files at all: the slot kept whatever map copies it had from an earlier import, and no amount of re-importing could refresh them — edits to the base mod's map_regions/ground_types/heights or descr_regions were invisible on that slot forever. The folder scan now fills whatever the selected tree is missing the way the game's own file system does: from the submod's base mod first (its campaign folder of the same name, then its world/maps/base, found with the same resolver the analysis pipeline already uses), and from the vanilla install as a last resort when no base mod exists. Re-importing the Four Romans folder now pulls the base's live map files every time." },
      { type: "fix", text: "**The \"Reload mod data\" badge now notices base-mod edits under a submod.** The mtime watcher only looked inside the selected mod folder — a submod dir lacks the map files entirely, so repainting the base map never lit the badge. Files missing from the selected folder are now watched through the base mod instead, so the edit-→-badge-→-reload loop works the same whether the slot is a full mod or a submod." },
    ],
  },

  {
    version: "0.9.1480",
    date: "2026-08-04",
    items: [
      { type: "improvement", text: "**Crash-reporter 0.1.49: report headers now name the base mod and its version under a submod stack.** A submod session used to identify itself by the submod alone (\"Neep / 4 Romans RIS\") — the main mod's version, the first thing every beta question needs, only appeared in the Mods-active line further down and never in the one-line channel listing. Headers now read \"4 Romans RIS on [PublicBETA] RIS 0.7.0 v7.14\": the base mod loads last under a submod, so the highest-load-order entry is appended whenever it differs from the primary. An explicit mod_name in the ini still wins, single-mod sessions are unchanged, and a stack that lists the same mod twice stays a single name." },
    ],
  },

  {
    version: "0.9.1479",
    date: "2026-08-04",
    items: [
      { type: "feature", text: "**The Balance overview now shows each faction's economy in both of its real states: the first look, and after the empire-size tax lands.** When a campaign opens, the empire-size events (Empire Tax Level 1–10, fired by the campaign script from settlement count: 0–1 / 2–4 / 5–8 / 9–15 / 16–29 / 30–50 / 51–100 / 101–200 / 201–400 / 401+) have not fired yet — so the finance scroll you see before clicking anything is a different number from the one you govern with a turn later. The overview table now carries a **Size** column (the faction's tax level, with the brackets in the tooltip) and two income columns: **Income 1st look** and **@ size tax**, with the per-faction difference marked ▼/▲ — Carthage, for instance, opens at 55,831 and settles at 50,445 once its Size-6 penalties land. Everything downstream (wages, corruption, net, verdicts) budgets with the after-tax state, which is the economy the faction actually lives on. The single-faction budget header and the ⧉ copy report carry both numbers too." },
      { type: "fix", text: "**The Greens, the Blues and the Senate are finally selectable — all four Roman factions are in the Army Setup picker.** v0.9.1465 taught the analysis pipeline to read them through the RIS_Four_Romans submod overlay, but the picker itself was still filtering roman_rebels_1, roman_rebels_2 and roman_senate out alongside the rebel pseudo-factions, so the fix was unreachable from the UI. With the submod active they now analyze like any other faction; on base RIS (where they are dead-until-resurrected civil-war stubs with no settlements) their overview rows read **emergent** instead of pretending a zero economy is a balance verdict." },
    ],
  },

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
