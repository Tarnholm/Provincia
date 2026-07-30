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
    version: "0.9.1465",
    date: "2026-07-30",
    items: [
      { type: "feature", text: "**Thin submods work in the Army Setup: RIS_Four_Romans' Roman factions now analyse fully.** The bug had two halves. Provincia derives the mod data dir from the ICONS folder — which a thin submod never ships — so with the Four Romans slot active the army pipeline silently read BASE RIS's descr_strat, where roman_rebels_1/2 and roman_senate are five-line stubs: \"not working for the roman factions\" while every other faction (identical in both files) looked fine. And pointing the pipeline at the submod alone breaks ~60 file reads that expect EDU/EDB/map files a thin overlay doesn't carry (EDU parsed 0 units). The app now derives the campaign's own data root from the imported slot's source folder, and the main process materialises a merged submod-over-base view the way the game's own VFS does — the base mod is found automatically, directories the submod doesn't touch are junctioned so teammate edits still flow live, and the submod wins per file. Verified on the real submod: all four Roman factions produce full upkeep/income/PO/growth (julii 14,900 · rebels 18,702 / 21,253 · senate 10,581), and a plain full mod short-circuits through unchanged." },
      { type: "fix", text: "**Army Setup applies keep writing the SUBMOD's real descr_strat, never the merged copy.** Only the read/analysis handlers route through the merged view; the Add/Recruit/Replace buttons target the original overlay file (which is the submod's whole point of existing), and the merged view refreshes itself on the next analysis." },
    ],
  },

  {
    version: "0.9.1464",
    date: "2026-07-30",
    items: [
      { type: "fix", text: "**Army Setup: PO now updates when you add or remove garrison units.** The PO model's garrison table was cached per mod dir with no invalidation, so every Apply wrote descr_strat correctly but 🔄 Reload recomputed public order against the pre-edit garrison until the app was restarted — the writes always worked; only the number on screen was stale. The cache is now keyed on descr_strat's mtime, the same pattern the EDU and strat-line caches already used." },
      { type: "feature", text: "**Save-anchored PO treats the calibration save as the starting point and layers your edits on top.** The first analysis with a save snapshots the descr_strat garrison table as that save's baseline; every later run adds the exact garrison-law delta (5·ΔPts, men = EDU soldiers ×4) for units added or removed since, shown as a green ✎+N badge on the town's PO. The baseline deliberately does NOT come from the save's own unit records — verified unsound first: raw save attribution mis-buckets field armies as garrisons and its soldier counts include officers, mismatching 1,301 of 1,311 settlements against the garrison law." },
      { type: "fix", text: "**External map edits now reach the app: a mod-file epoch invalidates every topology cache.** A teammate repainting map_regions.tga (or RTW rebuilding map.rwm, or Manipula writing EDB) changed nothing in a running Provincia — ~23 caches (region adjacency, sea bodies, trade lanes, settlement coords, mine deposits…) were keyed on the mod dir alone and survived every in-app reload. One throttled mtime sweep over the 8 source files now wholesale-clears them all the moment any file changes, and the three map TGAs joined the mtime watchlist so the \"Reload mod data\" badge actually flashes on a map repaint." },
      { type: "fix", text: "**The AI Lab recognises the engine's current scripting_log again.** Newer logs open with thousands of lines of token-creation chatter — \"(file.txt::2) (CREATE) Creating token…\" — before the first \"Executing command\", so the 4KB head sniff missed both known signatures and the log fell through to the message-log analyser. A third detection shape covers it, built from the log's real vocabulary (2,761 CREATE + 1,862 SCOPE, nothing else in 92,952 lines) and verified absent from every other live log's head. The live-log integration test asserts pipeline structure instead of a July-25 content snapshot that had already drifted." },
    ],
  },

  {
    version: "0.9.1463",
    date: "2026-07-28",
    items: [
      { type: "fix", text: "**Crash-reporter 0.1.46: an engine could-not-resolve-name claim is verified against the tester's actual on-disk file before the report calls it a data defect.** Steam updates workshop items in place — sometimes while the game is running — so a session can spend hours resolving names against a pre-update file that is already fixed on disk. Two v7.13 sessions did exactly that with the removed `pilum_infantry` token, and the old \"DATA defect, fixable\" wording sent the team re-chasing a shipped fix. The reporter now maps the engine's VFS path (workshop or My Mods) to the real file and re-checks the token as a standalone word with comments stripped: a live defect reads \"[verified in the on-disk file]\", a moved token names its new line, and a vanished one reads \"NOT in the on-disk file anymore — the game loaded an older copy; restart the game\". The selftest covers all four verdicts on a fixture mirroring the fixed formations file." },
      { type: "fix", text: "**Crash-reporter 0.1.46: no more \"could NOT be assessed for crashes\" printed over a session with its own crash dump.** The stale-message-log warning used to be written before dump detection, so a marathon whose log went silent in its final minutes carried both a 🔴 crash verdict and a sentence claiming the session couldn't be assessed. The message is now worded after the dump scan: with a same-session dump it says the dump is the authority and the silent window is likely the hang itself; without one, the original logging-off warning stands unchanged." },
    ],
  },

  {
    version: "0.9.1462",
    date: "2026-07-28",
    items: [
      { type: "fix", text: "**Crash-reporter 0.1.45: the dev build is no longer flagged as an unapproved mod.** \"Imperium Surrectum\" joins the default mod allowlist — the dev version's display name (\"[OPEN BETA] RTR: Imperium Surrectum 0.7.0\") contains no literal \"RIS\", so every dev-version session was being marked 🚫 despite being the mod itself. An ini that explicitly sets `allowed_mod_substrings=RIS` overrides the new default and needs the line removed or extended." },
      { type: "fix", text: "**Crash-reporter 0.1.44: a previous-session-only dump upload no longer announces a CTD.** Field-verified on the first 0.1.43 reports: the main report correctly labelled a stale XML \"(previous session)\" and kept the session UNSTABLE — but the dump-carrier companion message still said \"🔴 Feral crash dump (CTD)\", a red crash line over a session that exited cleanly. When every dump aboard is from a previous session it now reads \"🟠 Feral crash dump from a PREVIOUS session (late XML twin, no new crash)\"." },
    ],
  },

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



  ];

export default CHANGELOG;
