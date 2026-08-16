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
