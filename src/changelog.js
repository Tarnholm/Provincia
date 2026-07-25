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
  {
    version: "0.9.1435",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**The Lab has found the structural reason AI campaigns gather forever and never launch, and it is not any individual faction's economy.** Across 1,117 targets the AI's median *offensive* strength requirement is **23,902 men**. The median faction on this map fields **1,480**. That is a factor of **16**, only **3 of 125** factions could field the median requirement at all, and a single such requirement is 5.4% of every soldier alive on the map (443,099 across 125 factions). This is now the first lead in every report, because it reframes all the per-faction ones beneath it: \"this faction is too poor to launch\" is a symptom of the map's shape, not of that faction. Raising one small faction's income cannot close a 16× gap." },
      { type: "improvement", text: "The two sides are verified to be the same unit before being compared, which is the whole basis of the claim: the log's `allocated str 27,183` lines up with Ptolemaic's 28,246 soldiers in the save, and unit sizes there are a sane 64 men at the median — so requirement and manpower really are men-equivalent, not one being an abstract score. Defensive postures are excluded from the requirement figure: `ACS_DEFEND_*` asks read as whole-frontier totals rather than one stack's worth (the extremes are all defensive — Consentia 890,300, Petelia 312,060), and mixing them in would make the number meaningless. Requirements are taken as one per target so a heavily-logged region cannot skew the distribution." },
      { type: "improvement", text: "The lead only appears when the gap is large *and* few factions can clear it — a 4× gap that most factions meet anyway is not a structural problem, and would not be worth putting at the top of a report." },
      { type: "fix", text: "Two smaller honesty fixes fall out of the same investigation. The \"no navy\" audit lead required the save's per-faction ship count to be zero, which was vacuously true for everyone because naval units in the save carry no faction; the gate now rests only on descr_strat's starting admirals, which is a real fact, and the evidence says outright that the save cannot supply a current ship count. And the per-finding `factionNaval` figure is now null rather than a confident 0." },
    ],
  },
  {
    version: "0.9.1434",
    date: "2026-07-25",
    items: [
      { type: "fix", text: "**Correcting v0.9.1431: the falsification check I was so pleased with was itself dead code.** That release said the terrain model \"ran against all 125 factions fielding troops and found zero contradictions\". It ran against none of them. The save's unit index is a flat map keyed `\"faction|Region\"`, not the nested `{faction: {region: n}}` I assumed, so the loop's inner iteration produced an empty list every time and the check examined nothing while reporting a clean bill of health. It now examines **816 faction-region pairs on the reference save and still finds zero contradictions** — the conclusion survives, but it was unearned when I published it. The run reports how many pairs were checked, and \"no contradictions out of nothing checked\" is now reported as unknown rather than as a pass." },
      { type: "fix", text: "**And the naval claim in those verdicts was based on nothing.** Naval units in the save carry no faction — all 50 ships land under \"?\" — so \"this faction has no ships\" was reading an empty bucket and always coming out true. That is why v0.9.1431 asserted every one of the 14 stranded factions lacked a navy. The truth from descr_strat.txt is more interesting: **8 of them do start with a fleet and still never embark** (Chios among them, with one admiral), while 6 genuinely have none. Those are different bugs with different fixes, and the leads now say which is which. The save's per-faction ship count is flagged as unusable at source so nothing else can quietly depend on it." },
      { type: "improvement", text: "The unit tests were the root cause: their fixtures used the nested shape I had imagined rather than the one the code actually produces, so they passed while the real path did nothing. They now use the real flat-key shape, and one test deliberately feeds the wrong shape and asserts it yields zero checks — the failure mode is pinned, not just fixed." },
      { type: "improvement", text: "Also ruled out, so nobody spends time on it: a sea-reachability counterpart to the land model. Three probes established that of the 14 stranded faction-target pairs, all 14 have a sea route and none lack one — so it would produce no findings — and whether ships may enter the map's deepest water class is not stated anywhere in the mod files. Two of those probes failed for reasons that were my error rather than the model's, which is recorded alongside." },
    ],
  },
  {
    version: "0.9.1433",
    date: "2026-07-25",
    items: [
      { type: "improvement", text: "**The in-app changelog is 99 KB smaller.** This file is parsed on every post-update launch, and a cap of about five versions was set in 0.9.1275 for exactly that reason — but the release script only *warned* about it, and the warning went unheeded for 146 releases until the file reached 151 entries and 110 KB. It is now 11 KB. All 1,313 entries are intact; the older ones moved into docs/changelog-archive.js, which keeps the history greppable in the working tree." },
      { type: "improvement", text: "**And it cannot drift again.** The release script now performs the trim itself instead of warning about it, and a test fails the suite if the file grows past the cap anyway. The trim moves entries as text spliced on brace boundaries rather than re-serialising them — regenerating this file from parsed data is what corrupted it once before, when emoji and quotes in the prose were mis-escaped and truncated the write mid-file. It verifies both files still load, that no entry was lost or altered, and that no version ends up in both, and refuses to write anything if any of that fails. Measured on the real trim: 1,313 entries before, 1,313 after, zero altered." },
      { type: "improvement", text: "The brace scanner the trim depends on is tested against the cases that would actually break it — braces inside release-note prose (this changelog describes clauses like `requires { all, }`), escaped quotes, apostrophes, and comments containing braces. It also preserves each file's existing line endings, so the diff shows only the moved entries." },
    ],
  },
  {
    version: "0.9.1432",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**New Hotspots tab: where the trouble is, rather than whose it is.** 989 regions are named across the findings, and the table ranks them by how many <b>different</b> factions fail at the same place — because several factions failing at one spot points at the map, not at any one of them. It immediately says something the per-faction view could not: the worst hotspots are contested prizes nobody can staff, not hard ground. Nasium has <b>seven different factions</b> stalled on it at ground difficulty 30; Menosgada and Variscium have five each. Each row shows its faction count, findings, proven-no-route orders, ground difficulty and problem mix, and clicking it highlights the region on the map." },
      { type: "improvement", text: "**Findings can be sorted.** Six thousand rows in one fixed order were unreadable. \"Worst first\" (the analyser's own severity ranking) stays the default, joined by longest-running, hardest ground, earliest turn and faction A–Z. Sorting works on a copy, so the export and the before/after digest still read the analyser's original ordering." },
      { type: "fix", text: "**The terrain data added in the last release was being computed and then not shown.** 1,848 findings carried their target's ground difficulty and none of it reached the screen. Each such row now has a ⛰ chip coloured by how hard the ground is, with the full breakdown on hover, and the save banner reports the land-mass count, the proven-no-route total, and whether the terrain model survived being checked against every faction's unit positions. Adding a measurement without surfacing it is only half the work." },
    ],
  },
  ];

export default CHANGELOG;
