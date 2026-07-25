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
    version: "0.9.1440",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**Mod Lint now catches the defect that took 32 crashed play sessions to find — statically, in 220ms.** The v7.12 beta telemetry showed the engine rejecting a formation token **413 times across 32 sessions**, in its own words: `Failed to find either a unit class or unit category. Provided: 'pilum_infantry'`, alongside 462 unit-enum asserts and 2,893 `is_template_formation()` failures. descr_formations_ai.txt was also the file named by 352 script faults — five times the next worst. The lint now reads that file and reports the one line at fault: bare `pilum_infantry`, 28 uses from line 78, where the engine only knows the prefixed forms." },
      { type: "improvement", text: "**The vocabulary is derived from vanilla, not invented — and that is what makes it trustworthy.** My first pass at this assumed every underscore-joined token was a mod invention and would have condemned **192 lines**. Checking the three shipped vanilla files disproved it outright: `heavy_pilum_infantry`, `light_pilum_infantry`, `spearmen_pilum_infantry`, `non_phalanx_spear`, `ranged_missile_infantry`, `chanting_screeching`, `phalanx`, `swimming` and `carrying_siege_engine *` are all tokens vanilla itself uses. Only the bare form is absent — 0 uses across all three vanilla files against 28 in RIS, and precisely the token the engine names. Guessing would have produced 164 false accusations; on the real mod the rule now reports exactly one finding out of 819 tokens examined." },
      { type: "improvement", text: "The message quotes the engine's own wording so it can be grepped straight against a log, names the near-miss (\"vanilla does use heavy_pilum_infantry — a dropped prefix is the likely cause\"), and the check reports how many tokens it examined so a rule that silently stops working is detectable rather than looking like a clean file. Every vanilla token is unit-tested as a non-finding, which is the false-positive trap this rule could easily have fallen into." },
    ],
  },
  {
    version: "0.9.1439",
    date: "2026-07-25",
    items: [
      { type: "fix", text: "**The bundled reporter would have silently sent no AI log at all — caught by a self-test written for exactly this.** Provincia drives it with the embeddable Python it ships, and that distribution does not put a script's own directory on the import path, so the reporter could not find its line filter. It would have run perfectly, watched the game, uploaded a report, and simply omitted the campaign_ai_log extract, with no error anywhere. A normal `python crash_reporter.py` does add that directory, which is why it only appeared once the reporter was bundled. The reporter now adds its own directory itself, so it works under any host." },
      { type: "improvement", text: "**The standalone build for testers who do not use Provincia gets the same upgrade, plus a gate.** Its build now names the filter as an explicit hidden import (PyInstaller's static scan can miss one inside a try/except), refuses to build if the generated file is absent, and then runs the freshly built exe's `--selftest` and fails the build if it does not pass. That check verifies the filter loads AND that it classifies lines correctly, so a build that would quietly stop sending AI data cannot reach a tester." },
      { type: "fix", text: "The size guard that trims an over-large extract did not converge: it recomputed how much to drop from the already-reduced count, so each pass dropped less than the one before. Asking for a 256 KB result settled at 2,182 KB and stopped. It now halves the retained turn blocks monotonically and hits 249 KB, 853 KB and 3,313 KB for 256 KB / 1 MB / 7 MB ceilings, always starting on a whole turn header so no record is cut in half." },
      { type: "improvement", text: "New tests keep all of this honest: the generated Python filter must be byte-identical to what the analyser's manifest produces right now (a stale copy fails the suite), everything the reporter needs must be listed for packaging, and the reporter must pass its own self-test under Provincia's runtime." },
    ],
  },
  {
    version: "0.9.1438",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**The crash reporter is built into Provincia — you no longer run two programs.** Tools → ⚑ Crash Reporter. Set your RIS Discord name once, press start, then play: it watches for the game, and when the game exits it uploads the report by itself. It is the same reporter, driven by the Python runtime Provincia already ships, so there is nothing extra to install. Its output is shown live in the panel, and its settings live in your user folder so they survive updates. Provincia's own copy never self-updates (that would fight Provincia's updater), and it is stopped when Provincia closes rather than being left orphaned." },
      { type: "feature", text: "**Reports now carry what the AI Movement Lab needs — including the AI's own decision log, which was never collected before.** campaign_ai_log.txt is where every finding in the Lab comes from, and a 102-turn campaign writes about 330 MB of it. Attaching that is impossible, but it turns out only 23% of the lines are ever read: a verbatim extract of exactly those compresses to **3.2 MB**, comfortably inside an attachment. Verified on the 330 MB reference log — the Lab produces **all 6,399 findings identically, in the same order**, from the extract as from the original, with matching turn counts, economy blocks and strength distributions. Reports also gain a verbatim copy of every `Script Error` line, which the existing human-readable version could not be parsed from." },
      { type: "improvement", text: "The filter patterns are generated from the analyser's own definitions rather than copied, because a copy drifts and a drifted filter loses data silently. That is not hypothetical: the first hand-written version guessed the faction turn header as \"+start\" where the log has a tab-indented \"start\", matched nothing, and would have discarded every turn boundary — and with it all faction attribution — without a single error. A test now runs the analyser over both the full log and an extract and requires identical findings." },
      { type: "fix", text: "Three bugs the real-data testing caught before any of this shipped, each of which would have quietly lost information: Python's `match()` anchors where JavaScript's `test()` searches, which dropped one pattern and 83,427 lines; an off-by-one skipped everything before the first turn header, losing the log's preamble; and a hand-rolled turn-header check counted 23,337 turn blocks in a log that has 51, which would have made the size-trimming nonsense." },
      { type: "fix", text: "When it runs inside Provincia the reporter never prompts on a console it does not have — the \"what is your Discord name?\" question and every \"press Enter to close\" would otherwise raise an error and take it down before it watched anything. Standalone behaviour is unchanged. The name is collected in Provincia's UI instead, and start stays disabled until it is set, because a report tagged \"unnamed\" cannot be followed up." },
    ],
  },
  {
    version: "0.9.1437",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**The strength requirement has a floor, and that is the real problem.** A median demand of 23,902 men could simply mean the map's targets are well defended — so the Lab now pairs each target's requirement against the garrison actually standing there. The requirement does track the defence, cleanly: **1–2 defending units → 13,603 · 3–5 → 20,172 · 6–10 → 27,528 · 11–20 → 33,503**, over 919 targets. But look at the first bucket. A settlement held by **one or two units** still demands **13,603 men — 9.2× the median faction's entire army.** There is no target on this map a typical faction can take. The problem is the floor, not the slope, and that distinction changes what is worth tuning." },
      { type: "improvement", text: "Both halves of the comparison are now stated in the lead and the banner, so the reasoning is visible rather than asserted: what is demanded, what is defending, and what the asking faction actually has." },
    ],
  },
  {
    version: "0.9.1436",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**The Lab now reports the scoreboard: did the AI actually take anything?** Everything else in the tool measures attempts — orders re-issued, campaigns gathering, strength never reached. This compares who owned what at campaign start against who owns it in the save, and the answer on the reference campaign is stark. The independent peoples went from **499 settlements to 522**, while the 220 real factions **lost 17 between them and 97 of them (44%) were wiped out entirely**. The map consolidated by factions eating each other, not by anyone conquering the independents — which is exactly what you would predict from requirements no small state can meet. Only Ptolemaic (84→101), Carthage (41→48), Rome (26→33) and Antigonid (34→40) made real gains." },
      { type: "improvement", text: "This is now the first thing in every report, above the strength-scale figure, because it is the observation and that is its explanation. It is also the number to re-measure after any change — the before/after tab exists precisely so you can check whether a tweak moved it." },
      { type: "improvement", text: "The independents' *size* is deliberately not treated as a finding: descr_strat gives that faction 499 of 1,305 settlements on purpose, as \"Free Peoples\". Only its delta counts, and it is excluded from the real-faction arithmetic entirely so it cannot distort the wiped-out and net-change figures." },
      { type: "improvement", text: "The two sides come from different sources, so the report certifies they can be differenced at all before drawing any conclusion — descr_strat has 1,305 settlements and the save 1,311, a 0.46% gap from places founded or razed mid-campaign. Above a couple of percent it refuses to compare and publishes no lead, because a delta between two populations that don't match is not a delta. Both the tolerance and the refusal are unit-tested." },
    ],
  },
  ];

export default CHANGELOG;
