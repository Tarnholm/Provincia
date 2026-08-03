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
    version: "0.9.1466",
    date: "2026-08-03",
    items: [
      { type: "improvement", text: "**Crash-reporter 0.1.47: the season/date-ordering assert is now annotated as a known 4TPY artifact instead of looking like a defect.** The assert — year and season comparison failing between turns — fires 20 to 218 times a session on every beta from v7.9 to v7.13. Root-caused on the shipped campaign script: the 4-turns-per-year section forces the season back to summer on 2 of every 4 turns, so same-year dates sort out of order and every later date comparison (character ages, trait gains, event timers) trips the engine's summer-before-winter invariant. It has never been crash-associated in 486 telemetry sessions; reports now say so explicitly — structural to the 4TPY design, harmless, ignore in triage. The reporter selftest proves the matcher fires on the real telemetry text and stays silent on any other season-ish assert." },
    ],
  },

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

  ];

export default CHANGELOG;
