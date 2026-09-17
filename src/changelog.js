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
    version: "0.9.1507",
    date: "2026-09-17",
    items: [
      { type: "improvement", text: "**Crash Reporter v0.1.57: one address demoted, one claim narrowed.** Two corrections, both from reading the 107 sessions testers sent on v7.17 and v7.18. Twenty of those carried a crash dump the reporter could parse, and a single address took seven of the twenty — by a wide margin the largest cluster in the window, and exactly the sort of number that starts a hunt for a mod bug. All seven are the same tester on the same graphics card. Grouped that way it has the same shape as the address already filed as one machine's problem, so it now sits beside it, and a report landing there says as much instead of quietly implicating the mod. Only one address in the whole window turned up on two different testers on two different cards; that one keeps its standing. The second correction is an admission. When the engine can find no free tile beside any of a faction's settlements, a character coming of age is created at the map's origin with empty name strings, and drawing that character's card crashes the game on the spot. The reporter has been calling this a map problem — certain settlements in the mod are sealed in by construction, and those do produce it. But across these 107 sessions the fault was caught in the act exactly once, and the faction it happened to was not one of the sealed ones: an ordinary playable faction, with a real town and a field army. A faction can evidently be closed in during a campaign by whatever has gathered around it, and no edit to the map prevents that. So the reporter no longer promises a map fix closes this. It names the faction and calls the fix necessary rather than sufficient, because that name is what decides which of the two it was. What would settle it is the save from that session. The damage, meanwhile, is wider than the crash count suggests: 68 of the 107 saves already carry these broken characters, across thirteen testers, and nothing can clean them out of a save that has them. The mine is laid nearly everywhere and had simply not been trodden on." },
    ],
  },

  {
    version: "0.9.1506",
    date: "2026-08-31",
    items: [
      { type: "feature", text: "**Crash Reporter v0.1.56: every report now ends with a verdict.** Until now a report listed the evidence and left the conclusion to whoever read it. It now states one, on its own line directly under the status, where it cannot be cut off. Four verdicts, and which one you get decides who picks the report up. **MOD-SIDE** means it is fixable in the mod's own data, and where the engine named a file and a line, the report quotes that line back from the copy the game actually loaded — a lookup only the tester's machine can do, since any other copy is a different branch or a different build. **ENGINE** means the game's own fault or a hard engine limit, like the 16-bit string ref-count that wraps on multi-hour sessions: mitigation only, nothing to fix on our side. **LOCAL** means one machine — a driver, an overlay, or the tester's own save. That bucket exists because the telemetry has a whole class that fits neither of the others: one crash address accounts for 15 sessions from a single tester on a single graphics card, and chasing it as a mod bug would burn time on something nobody else can reproduce. **CANNOT PIN DOWN** is the honest default, and it names the one piece of evidence that would settle it, so the report asks for the save while the tester still has it. The most common crash address in the whole channel stays in that last bucket on purpose — it is measured to death and still unexplained, and promoting it to a real verdict would be worse than staying quiet. Across the 450 sessions already in telemetry, of the 120 crashes about one in five now arrives already triaged. One limit worth knowing: the reporter on a tester's PC only ever sees that one PC, so everything it knows about the other testers is baked in when the build is made. An out-of-date reporter gives out-of-date verdicts." },
    ],
  },

  {
    version: "0.9.1505",
    date: "2026-08-16",
    items: [
      { type: "fix", text: "**Crash Reporter v0.1.55: reports reach the channel again.** The report channel's Discord webhook was deleted at Discord's end, so for a while every crash report and every dump failed to upload — with the error landing on the tester's machine and nothing looking wrong from here. The reporter now carries a fresh webhook and, more usefully, repairs itself: your saved `crash_reporter.ini` keeps its settings across updates, so an ini pinned to a retired webhook used to stay broken forever. Such a webhook is now swapped for the current one and the ini rewritten, and a webhook that dies mid-run is retried on the current one instead of losing the report. Leaving `webhook_url` blank means use the one built into the reporter, which is what you want; set it to `none` to stop uploading." },
    ],
  },

  {
    version: "0.9.1504",
    date: "2026-08-16",
    items: [
      { type: "feature", text: "**Crash Reporter v0.1.54: 3h+ sessions are marked.** A session that ran past three hours now says so on the report's Session line — ⚠ **3h+ session**, with the advice that matters: save and restart every ~2 h. The engine's string ref-count is 16 bits and wraps after hours of play, and until now the reporter only mentioned it once the assert had already fired — too late for that session. The telemetry listing carries the same mark, on older reports too, so long sessions are easy to pick out at a glance. Long sessions are not more crash-prone overall (20.1% vs 25.6% under 3 h across 1,971 sessions) — the mark is about that one CTD class and claims nothing more." },
    ],
  },

  {
    version: "0.9.1503",
    date: "2026-08-12",
    items: [
      { type: "feature", text: "**Settlement Processor Suite 0.16.26: farm bump exceptions can be limited by settlement size.** New **Bump Exception Levels** set in Farms — the same Levels list Urban and Rural Exploits already have. Remove a level (e.g. `large_town`) and settlements of that size always take the full bump, with both the per-chain rules and the global fertility exception switched off for them. Default lists every level, so nothing changes until you prune it. On RIS, dropping `large_town` demotes 87 large_towns one level and takes the farm off 20 more." },
    ],
  },

  ];

export default CHANGELOG;
