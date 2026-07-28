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
    version: "0.9.1461",
    date: "2026-07-28",
    items: [
      { type: "fix", text: "**Crash-reporter 0.1.43: crash dumps are dated by their own crash time, because file mtime lies twice.** Cross-referencing dump hex ids across the telemetry channel proved every Feral XML lands one report LATE — Feral writes the .dmp at crash time but the XML twin later, sometimes not until the next launch — so the minidump fault-address analysis was systematically pinned on the session AFTER the crash. And Feral shuffles dumps between `Crash Reports/{pending,processing,sent}`, refreshing mtime: one tester's report attached an XML from a crash a full day earlier as if it were fresh. Either could flip a clean session to SUSPECTED CRASH. The filename's crash timestamp is now the authority (a bare .dmp is dated via its timestamped XML twin's hex id); a dump from before the session is attached but labelled \"previous session\" and never decides the status." },
      { type: "improvement", text: "**Raw .dmp files are parsed as minidumps directly** — they ARE minidumps; only the XML's base64/zlib-wrapped copy was parsed before, which is exactly why the fault address always arrived one report late. The current session's crash now shows its own fault address in its own report. The selftest covers the dating logic on the real telemetry filenames that exposed the bug." },
      { type: "change", text: "**The `+0x266FD3` triage note is dated to v7.12-and-earlier: beta v7.13 removes all seven bare `unit_type pilum_infantry` tokens** (verified against the RIS working copy — 0 bare, 181 valid prefixed remain). A v7.13 report should be checked for the unit-enum asserts before anyone chases formations; if the assert family still appears on 7.13, that itself is a finding, and the note says so. Also: the telemetry reader now counts SESSIONS, not messages — the reporter posts dump-carrier companion messages that repeat the status, and counting them read 254 suspected crashes where there are 154 real suspect sessions." },
    ],
  },

  {
    version: "0.9.1460",
    date: "2026-07-27",
    items: [
      { type: "improvement", text: "**Crash-reporter 0.1.41: assert risk is now quoted against the baseline instead of as a bare count.** The warning used to read \"336 sessions: 136 crashes, 200 survivors\" — 40%, which is alarming or reassuring depending entirely on what you assume normal is. Measured over the 486 telemetry sessions that carry a Session line: the baseline is 31%, and sessions carrying the unit-enum asserts crash 68% of the time, 2.4x. The first attempt at this measurement concluded \"no signal\", because counting messages rather than sessions puts the baseline at 43% — the reporter splits large posts and the continuation parts repeat the status without a session line." },
      { type: "improvement", text: "**The high-volume asserts are protective, and the report now says so rather than implying they are neutral.** `man_in_front_index` (538 occurrences across v7.12) sits at a 25% crash rate, 0.76x baseline; `smp_2 != STRATEGY_MAP_POSITION` at 0.73x. Also ruled out: a 12.78 GB peak working set looks like a leak worth chasing, but 205 of 486 sessions exceed 12 GB and they crash at the baseline rate (1.17x). Not a signal." },
      { type: "improvement", text: "**Two new crash-address signatures, both defined by what is missing.** Remeasured across 54 parsed minidumps: `+0x266FD3` still dominates at 26 (48%, seven testers), newly enriched for a siege battle before exit (23% vs 7%). But `+0x128D0` (6) and `+0x868C71` (5) carry *none* of the assert families — 0% against 19–44% elsewhere. Triage that goes hunting for an assert there finds nothing and reads the report as empty, when the absence is the signature." },
      { type: "fix", text: "**Corrected an overstated claim in the dominant signature.** It said the unit-enum asserts appear in \"0% of other-address crashes\" and rested its argument on that exclusivity. With 54 dumps instead of 50 it is 11%: the enrichment is real (2.5x) but not exclusive. A 0% resting on a denominator of ~28 was four samples away from being wrong." },
      { type: "fix", text: "**The bundled reporter was six versions behind and no check could see it.** Provincia ships `crash-reporter/` verbatim and nothing copied the current reporter in, so the bundle sat at 0.1.33 while testers on the standalone installer ran 0.1.38 — every analyser improvement between them reached only half the users. Every existing packaging check passed throughout, because a stale file is still a complete file. Synced, plus a test comparing the two versions that was verified to actually fail." },
      { type: "fix", text: "**Corrected my own `pilum_infantry` conclusion, which was backwards.** I reported that all 177 `heavy_`/`light_`/`spearmen_pilum_infantry` entries were invalid; acting on that would have broken 177 working formation entries. Two errors: I audited the `alternate_map` branch's copy of `descr_formations_ai.txt` (119 KB) when the engine loads the Steam Workshop copy (76 KB), and I trusted that file's header comment — which lists `pilum_infantry` among the standalone keywords — over the engine's own output. Line 80 of the shipped file is `unit_type pilum_infantry 1.0`, a BARE use and exactly the line the engine names. The prefixed forms are valid vanilla tokens. Provincia's lint had this right already." },
    ],
  },

  {
    version: "0.9.1459",
    date: "2026-07-26",
    items: [
      { type: "improvement", text: "**The `pilum_infantry` lint now names all 28 locations and the four formations they sit in**, instead of only the first line. It is a copy-paste defect — seven uses each in `triplex_acies_defend`, `triplex_acies_defence_to_offense`, `triplex_acies_maneuver` and `triplex_acies_ad_gladio` — so reporting one line sent the modder to fix one of twenty-eight while the other twenty-seven kept firing. The engine is no help here either: its error names only whichever instance it hit most recently." },
      { type: "improvement", text: "Formation names are read from the enclosing `begin_formation` block, so the scope of the edit is visible before making it. Three tests cover it: the full location list, no redundant list for a single use (the leading `line N:` already says it), and — the one that matters — that vanilla tokens like `heavy_pilum_infantry` and `spearmen` are still accepted, since an early version of this rule would have condemned 164 of them." },
    ],
  },

  {
    version: "0.9.1458",
    date: "2026-07-26",
    items: [
      { type: "improvement", text: "**The engine has now confirmed the `pilum_infantry` finding in its own words, in a crashing session.** A tester crashed three times consecutively with an identical signature — 42 asserts, only the two unit-enum ones, 8 `descr_formations_ai` faults, a crash dump each time. The raw assert file contains: `descr_formations_ai.txt:80` / `Failed to find either a unit class or unit category. Provided: 'pilum_infantry'`. The engine names the file, the line and the token that this lint rule predicts statically from the mod files, without running the game." },
      { type: "fix", text: "**Provincia's line number is the accurate one, and the lint now says so.** The engine reports `descr_formations_ai.txt:80`; the lint reports line 78. Checked directly against the file: line 78 is `unit_type pilum_infantry 1.0` — the engine's figure is two lines late. A modder reading 80 in their log and 78 in the lint would reasonably distrust the tool, so the detail now states which to follow and why." },
      { type: "improvement", text: "**Reporter v0.1.38, shipped alongside, stops discarding that line.** Its assert matcher captured text up to the first `Failed`, which for a message that *starts* with the word is nothing — so the engine's most actionable output was filed as an assert named `Failed`, appearing as `Failed x14` in three separate crash reports. Resolution failures are now recovered with their token and the file:line the engine named, flagged as a data defect with a known location that needs no crash reproduction to fix." },
      { type: "improvement", text: "Also verified live: the crash-association ranking and fault-signature notes from v0.1.36/37 are appearing correctly in tester reports, with the unit-enum asserts tagged HIGH-RISK and ordered above asserts firing a thousand times more often." },
    ],
  },

  {
    version: "0.9.1457",
    date: "2026-07-26",
    items: [
      { type: "improvement", text: "**Telemetry turned the `pilum_infantry` lint finding from a warning into a priority.** Measured across 336 tester sessions — 136 suspected crashes and 200 that exited cleanly despite a high assert volume — the engine assert this token produces (`unit_class != UCL_NUM_CLASSES || unit_category != UC_NUM_CATEGORIES`) appears in **11% of crashed sessions against 1% of survivors**. That is the largest gap of any assert measured. The lint detail now says so, with the sample size and an explicit note that it is correlation over one mod's reports rather than proof of causation." },
      { type: "fix", text: "**The loudest asserts turned out to be the harmless ones, which means ranking by volume was actively misleading.** `m_status == TEX_MANAGER_DISPLAY_OPEN` appears in **89% of sessions that survived and only 40% of crashes**; the string ref-count overflow, 87% against 43%. A session with 14,000 `length_squared` failures is likelier to exit cleanly than one with 14 unit-enum failures. The crash reporter (v0.1.36, shipped alongside) now orders crash signals by measured crash-association and labels the loud benign ones instead of leading with them." },
      { type: "improvement", text: "**Memory was investigated as a crash cause and ruled out as a discriminator.** Every v7.12 session grows from ~0.3 GB to 12-13 GB with peak private reaching 22-24 GB, which looked like the obvious culprit. It is not: crashed sessions peak at a median 11.96 GB and sessions that survived at **12.17 GB** — indistinguishable. The growth is real and universal, but it does not separate the two groups, so no finding was built on it." },
      { type: "improvement", text: "Both figures come from the same 336-session pass, and the negative result is recorded as deliberately as the positive one — a uniform signal that explains nothing is exactly the kind of thing that gets mistaken for a cause on a second look." },
    ],
  },

  {
    version: "0.9.1456",
    date: "2026-07-26",
    items: [
      { type: "fix", text: "**The provenance check was warning on every tester report, and the warning was wrong.** It anchored time by assuming the log opens at the campaign start — but the crash reporter ships a TAIL of the log (recent turn blocks only), so a tester extract never does. On the first full report analysed (Leo, Bithynia, v7.12) it could only answer \"unknown\", reported a save year **14 years wrong**, and put a spurious \"these describe different moments\" caveat above every finding. descr_strat states `start_date -270 summer` outright, so the guess was never necessary." },
      { type: "improvement", text: "**Anchored on the campaign's declared start date, Leo's pairing reads correctly: log -256 to -254, save turn 69 = year -253, gap 0, confidence good.** The caveat disappears and the real outcome lead is back at the top. The anchor did not become a rubber stamp — a save genuinely outside a tail extract's window is still flagged, and so is one from before the window begins, both with tests." },
      { type: "feature", text: "**First complete tester pipeline analysed end to end.** Leo's report carried a 573 KB AI extract *and* a 44 MB save, so the full save-correlated path ran on data from someone else's machine for the first time: **100% log coverage, 0 unaccounted lines, 0 unseen shapes**, 137 findings, 19 mod-file leads, 477 ungoverned settlements with the AI log independently corroborating at 94%." },
      { type: "fix", text: "**A patch script wrote an invisible control character into a regex.** `parseCampaignStartYear` silently returned null because a stray **backspace (0x08)** sat between `(-?\d+)` and the closing delimiter, left by an escaping slip. It reads normally in an editor and in `grep`; only a byte dump revealed it. The fix asserts no 0x08 byte survives anywhere in the file, and the test that exercises it builds its fixture with `String.fromCharCode` so no future patch can turn an escape sequence into real whitespace." },
    ],
  },

  ];

export default CHANGELOG;
