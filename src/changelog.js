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

  {
    version: "0.9.1498",
    date: "2026-08-09",
    items: [
      { type: "feature", text: "**Scripts Suite: limit the urban rich-resource exception by settlement level.** New Full-Tier Levels list in Urban Exploits — remove a level (e.g. large_town) and settlements of that size always use the lower building band regardless of resource amount. Suite 0.16.23." },
      { type: "fix", text: "**Scripts Suite: saving a broken Python script now reports the exact syntax error** (line and message) instead of failing silently in the next pipeline run. The save still goes through so no work is lost." },
    ],
  },

  {
    version: "0.9.1497",
    date: "2026-08-09",
    items: [
      { type: "change", text: "**Scripts Suite: 868 lines of dead code removed from the master pipeline.** master_processor.py carried never-executed inlined copies of the old Rural and Urban Exploits steps — the stale-copy trap that once let a fix silently miss master runs for months. The pipeline now contains only what it runs; full run verified. Suite 0.16.22." },
    ],
  },

  {
    version: "0.9.1496",
    date: "2026-08-09",
    items: [
      { type: "fix", text: "**Scripts Suite: elephants really do map to ivory_trade.** The Rural Exploits mapping editor was missing `ivory_trade` from its dropdown, so the elephants row displayed — and on save would have written — `wine_industry`. The script itself was always correct. Dropdowns now always show the file's real value. Suite 0.16.21." },
      { type: "feature", text: "**Scripts Suite: adjustable industry qualification.** Rural and Urban Exploits gained editable knobs for the qualifying resource amount (default 2) and the full-tier amount (default 4)." },
      { type: "feature", text: "**Scripts Suite: rule profiles export and import.** Export any saved profile to a portable file and import it back — keep your script changes across machines or share them with the team." },
    ],
  },

  {
    version: "0.9.1495",
    date: "2026-08-09",
    items: [
      { type: "fix", text: "**Scripts Suite: Carthage gets its capital treasury.** The Core Buildings owner parser cut region names at the first hyphen, so hyphenated regions (`Qart-Khadasht` and ~130 others) had no known owner — carthage, arados, samnites and veneti_gallia never received capital treasuries, and empire sizes were undercounted for factions owning hyphenated regions. Suite 0.16.20." },
      { type: "feature", text: "**Scripts Suite: large towns can take the tier-2 market.** New editable bump-exception list in Core Buildings — levels on it skip the bump rule and only need their own EDB minimum. Ships with `market`, so a large_town builds the tier-2 market instead of stopping at trader; forum and above still bump." },
    ],
  },

  {
    version: "0.9.1494",
    date: "2026-08-09",
    items: [
      { type: "improvement", text: "**The Palatino voice reaches the whole chrome.** The map-mode category tabs (POLITICAL, GOVERNMENT, …) and mode buttons, the Live/Stats chips, the titlebar **Provincia** wordmark (now letterspaced small caps) and the campaign slot toggles all use the display face." },
      { type: "improvement", text: "**Region panel headers too**: the region name, Settlement/Faction/Rebels/Fertility/Homeland/Religion label prefixes, Resources/Slaves/Ambience/Tags section labels, and the Characters, Diplomacy & Treasury, Buildings, Recruitable, AOR Units, Garrison and Field armies widget titles — with small optical size bumps so nothing reads smaller than before." },
    ],
  },

  ];

export default CHANGELOG;
