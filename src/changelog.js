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

  {
    version: "0.9.1502",
    date: "2026-08-12",
    items: [
      { type: "change", text: "**Settlement Processor Suite 0.16.25: farm bump exceptions arrive with real defaults.** The per-chain exception table shipped empty, so every farm chain sat behind the full bump. All ten chains now start with a rule set — irrigated and rainfed skip the bump at `fertility` 8 and 9 or `grain` 2, qanat at `grain` 1, `dates` 2 or `fertility` 7, and the pastoral chains at `livestock`, `sheep`, `horses` or `camels` 3. On RIS that promotes 81 settlements to a higher farm level, 63 of them irrigation, and gives 15 large_towns their first farm building. Clear a row to restore the old behaviour for that chain." },
    ],
  },

  {
    version: "0.9.1501",
    date: "2026-08-10",
    items: [
      { type: "fix", text: "**Crash Reporter v0.1.53: the mod version now gets its own ✅/🔴.** The freshness mark on the mod line now compares the tester's loaded beta version against the live workshop title — so a tester still on v7.14.b shows 🔴 naming the latest (v7.15), and a tester on the current build shows ✅. The previous size-based check produced no mark at all on submod stacks (e.g. 4 Romans on RIS)." },
    ],
  },

  {
    version: "0.9.1500",
    date: "2026-08-10",
    items: [
      { type: "feature", text: "**Crash Reporter v0.1.52: version-freshness marks in every report.** The header now shows a ✅ when the reporter is the latest release and a ✅ on the mod name when the tester's Steam workshop copy matches what Steam has published — or a 🔴 with instructions (outdated reporter → update; stale Steam cache → restart Steam) so out-of-date setups are obvious at a glance in the channel. Local dev copies get no mark (nothing to compare against). The workshop check reads Steam's own install manifest and the item's public page, so it works even though the beta item is unlisted." },
    ],
  },

  {
    version: "0.9.1499",
    date: "2026-08-10",
    items: [
      { type: "feature", text: "**Scripts Suite: Rural Exploits can also limit the rich-resource exception by settlement level** — same Full-Tier Levels list Urban Exploits got yesterday. Remove a level and settlements of that size always use the lower building band. Suite 0.16.24." },
      { type: "feature", text: "**Scripts Suite: Reset to default.** New editor toolbar button replaces the open pipeline script with the pristine copy shipped with the app — the instant fix for a script that hand edits left unparseable, no restart needed." },
    ],
  },

  ];

export default CHANGELOG;
