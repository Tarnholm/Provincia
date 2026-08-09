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

  {
    version: "0.9.1493",
    date: "2026-08-09",
    items: [
      { type: "improvement", text: "**Panel headers join the Palatino voice.** \"Selected Provinces:\", the Factions header, 📜 Campaign Stats, 📊 Save insights, the Diplomacy editor title, info-popup titles, campaign slot labels and the empty-slot / asset-error overlays now use the same display face as the app's other headings — with a small optical size bump so nothing reads smaller. Tiny section captions stay sans on purpose: the serif-title/sans-label contrast is what keeps it looking deliberate." },
    ],
  },

  {
    version: "0.9.1492",
    date: "2026-08-09",
    items: [
      { type: "feature", text: "**Scripts Suite: light and dark mode.** The Suite window now follows the OS theme exactly like the main app — light is the marble-and-parchment look; dark is the main window's neutral dark glass, same slate ground and amber accents, no marble. The wax tablets carry through both, and the native window buttons re-tint live when the OS theme flips. Suite 0.16.19." },
      { type: "improvement", text: "**The Palatino display face now carries the whole app's headings** — region titles, panel and dialog headers, the Welcome cards and changelog version numbers — the same Roman inscription voice as the Suite's titlebar. Controls and body copy stay on the system sans." },
      { type: "improvement", text: "**Suite chrome retuned to the main window's sandy gray** — the titlebar, toolbar and sidebar now sit in the same muted parchment family as the app's panels instead of bright cream." },
    ],
  },

  {
    version: "0.9.1491",
    date: "2026-08-09",
    items: [
      { type: "change", text: "**The Settlement Processor Suite now looks like part of Provincia.** The Scripts window trades its generic gray theme for the app's own identity: the RTW-R cream-marble slab as the ground, translucent parchment panels, bronze inscription headers set in Palatino small caps, and Provincia amber everywhere the old blue was — tabs, buttons, checkboxes, focus rings, even Feral-gold scrollbars. Consoles and the code editor sit on dark **wax tablets** framed in bronze, with a matching warm Monaco theme (amber cursor, bronze line numbers). Pipeline and Master steps carry **Roman numerals** in true execution order, and dialogs became parchment sheets. Suite 0.16.18." },
    ],
  },

  {
    version: "0.9.1490",
    date: "2026-08-08",
    items: [
      { type: "feature", text: "**Settlement Processor Suite 0.16.17: bump-rule exceptions you can actually aim.** Farms gain **per-chain exceptions** — skip the bump for one farm chain when the region has enough of a specific resource or meets a fertility threshold (editable chips per chain in the simple editor; the global fertility exception still applies everywhere). Heavy industry gains the same: a **global enabling-resource threshold** (≥ 5 skips the bump — rich deposits get their industry sooner) plus **per-building rules** (e.g. mines when gold ≥ 2)." },
      { type: "feature", text: "**Suite: roads can now be blocked by terrain or faction.** Two new editable lists in Core Buildings — regions carrying chosen hidden resources (mountains, desert, …) or settlements owned by chosen factions get no hinterland roads at all, existing ones removed." },
      { type: "fix", text: "**Suite: capital treasuries are finally placed.** The old rule only re-levelled treasuries already present in descr_strat — there were none, so in every run ever, zero were built. Each faction's starting capital now gets a capital_treasury levelled by empire size (1/4/9/16 settlements, editable) and capped by what the settlement's size allows. On current RIS data: 214 capitals — 176 treasury, 33 large, 2 great, 3 imperial (Roma, Qart-Khadasht, Mesopotamia)." },
      { type: "fix", text: "**Suite: the full pipeline run was crashing at the temples step** — a processor class rename (v0.9.667) was never applied to the pipeline callers, so a master run had never completed past step 9. Fixed; a full 14-step run now completes. Bonus: the pipeline's heavy-industry step had silently kept a stale pre-0.9.667 copy of the rules (old max-scoring, blind to editor tweaks) — it now runs heavy_industry.py directly." },
      { type: "improvement", text: "**Touch support on the campaign map:** single-finger pan, two-finger pinch zoom anchored at the finger midpoint, tap to select — mouse behaviour unchanged. The 🧰 tools menu now closes on tap/click outside (it was undismissable on touchscreens) and on Esc." },
      { type: "improvement", text: "**Scroll feedback without scrollbars:** a thin amber pulse appears along a list's edge while it scrolls and fades out after — every scrollable panel gets position feedback again without bringing back visible rails." },
    ],
  },

  ];

export default CHANGELOG;
