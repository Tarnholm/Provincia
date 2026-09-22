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
 * docs/changelog-archive.js (npm run ship trims it automatically past 8).
 */
const CHANGELOG = [
  {
    version: "0.9.1511",
    date: "2026-09-22",
    items: [
      { type: "change", text: "**Internal: the save parsers are under test again — nothing changes on screen.** The tests that read real save files had lost the saves they needed, so fifteen of them were skipping: the unit reader, the ownership recovery, the faction records and the campaign counters all went unchecked. They run again, driven by saves rebuilt from this machine. Because those saves are older than the mod, each one is measured against a record of what the parsers produced when it was accepted rather than against the current mod data, and the drift between the two is now asserted rather than assumed (two settlements out of 1,310). This release carries no user-facing change; it exists so the next parser mistake is caught by a test instead of by a wrong number in a panel." },
    ],
  },

  {
    version: "0.9.1510",
    date: "2026-09-21",
    items: [
      { type: "fix", text: "**Live saves: characters are filed under the right faction — or under none, never the wrong one.** Each character in a save was labelled with the last faction marker before it in the file. A save holds about 47 such markers for 239 factions, and a marker sits inside its faction's block rather than at its start, so the label was right for roughly one character in eight: every Roman governor was filed under a Seleucid rebel faction, and the family attribution built on those labels inherited it. Characters are now anchored on something certain — a governor belongs to the faction that owns the town he governs — and, where the save still has its campaign-start layout, everyone filed between two governors of the same faction, plus their relatives, takes that faction. Measured on a turn-1 and a turn-57 RIS save: hiding each governor in turn and re-deriving him was right 373 of 373 and 73 of 73 times. A character that cannot be pinned this way now shows no faction instead of a wrong one." },
      { type: "change", text: "**Long campaigns get fewer labels, on purpose.** That layout does not survive a long campaign: characters who come of age later are filed into freed slots anywhere in the file. On a 102-turn all-AI save half the factions were split across the file and the same rule was right only three times in four, so the save reader now measures this on every save (the share of governors out of block order: 0% at turn 1, 4.5% at turn 57, 48% at turn 102) and, above 10%, labels the governors alone." },
    ],
  },

  {
    version: "0.9.1509",
    date: "2026-09-21",
    items: [
      { type: "fix", text: "**Resource icons: the hover and drag hitbox sits on the icon again.** It had been one tile above the icon since the June fix that moved resources onto their true map row — that change updated where icons are read and drawn, but not where the pointer looks for them. Hovering, clicking to filter, and picking a resource up to drag all use the icon's own centre now, and a dropped resource lands on the tile under the pointer." },
      { type: "fix", text: "**Saving resources no longer moves the ones you did not touch.** The same leftover was in the save path: every resource was written one row north of where it had been read, so a resource save would have shifted the whole map's resources by a tile (the one you had just dragged landed correctly, which hid it). Reading and writing now share one conversion, with a round-trip test. RIS's own descr_strat shows no such mass shift, so nothing needs repairing." },
    ],
  },

  {
    version: "0.9.1508",
    date: "2026-09-21",
    items: [
      { type: "fix", text: "**Army Setup was showing every settlement an empty recruit pool.** Since v0.9.1207 the pool only lists units from building classes the settlement owns — but Army Setup handed it each building's level without its class, so the owned set was empty and so was every pool (Rome: 0 units, now 8). The same parser also cut hyphenated regions at the hyphen (Qart-Khadasht became Qart), which lost those settlements their hidden resources. Both fixed; one shared pattern now reads a region name everywhere." },
      { type: "fix", text: "**Edits to your mod can no longer leave a half-written file.** Every write Provincia makes into a mod now goes to a temporary file and is swapped in whole, after a timestamped backup (descr_strat.txt.provincia-<time>.bak, newest ten kept, all restorable from the backups list). The old single .provincia-bak was overwritten by the second edit, so the original was gone after two changes; and if a backup cannot be made, nothing is written. Adding a general writes its name files first and descr_strat last, and puts everything back if any step fails." },
      { type: "fix", text: "**Army Setup and Starting Populations now respect \"export instead of overwrite\".** They wrote straight into the live mod whatever that setting said. Export mode also keeps every edit now: each edit used to start again from the untouched live file, so the exported copy only ever held the last one. Accented characters in an ANSI descr_strat also survive an edit now, instead of turning into replacement marks for good." },
      { type: "feature", text: "**Extinction Watch (Tools menu).** A faction is destroyed when its last living male family member dies, however much land it holds — or when its last settlement is taken, unless it can still horde. This lists every faction by its living adult males at campaign start — leader and heir, boys and when the eldest comes of age, lines where everyone is sixty or older, and lines standing on a single tile. On RIS, eight factions start with exactly one; the Mauryans have Ashoka and two boys. Factions down to one settlement are marked, with the horde-capable ones (read from descr_sm_factions) spared: on RIS 80 factions start with a single town and 5 of them can horde. Click a tier or \"last town\" to filter, double-click a faction to focus it on the map." },
      { type: "improvement", text: "**Faster start and smoother panning.** The 2.9 MB captured road network is loaded when the road layer first needs it rather than at launch, which cuts the startup script from 4.2 MB to 1.3 MB. While you drag the map the legend is no longer rebuilt on every frame (in faction mode that meant re-sorting every faction's regions each time), the minimap reuses its downscaled image, and the culture stripes use the cheap filter until you let go." },
      { type: "improvement", text: "**Scripts: your edited rules are kept, and Save back to mod checks its work.** Pipeline scripts are still refreshed at every launch, but one you had edited is first copied to a _user_edits folder and the Scripts window tells you where. Save back to mod refuses an output that is empty, under half the size of the file it replaces, or has no faction blocks — a step that died mid-run used to be copied over the live descr_strat. New guide for the team: docs/EDITING_RULE_SCRIPTS.md." },
      { type: "fix", text: "**Reload mod data reaches everything.** The map-mode metrics, faction relations, portrait and building-name caches never cleared, so a map repaint or a descr_strat edit could leave them stale until a restart. The folder picker and the silent re-import at launch now share one scanner, so a re-import always resolves the same campaign you picked." },
      { type: "change", text: "**Smaller installer.** It was carrying 58 MB of pipeline output from the build machine, plus Python caches; both are left out." },
    ],
  },

  {
    version: "0.9.1507",
    date: "2026-09-17",
    items: [
      { type: "improvement", text: "**Crash Reporter v0.1.57: one address demoted, one claim narrowed.** Two corrections, both from reading the 107 sessions testers sent on v7.17 and v7.18. Twenty of those carried a crash dump the reporter could parse, and a single address took seven of the twenty — by a wide margin the largest cluster in the window, and exactly the sort of number that starts a hunt for a mod bug. All seven are the same tester on the same graphics card. Grouped that way it has the same shape as the address already filed as one machine's problem, so it now sits beside it, and a report landing there says as much instead of quietly implicating the mod. Only one address in the whole window turned up on two different testers on two different cards; that one keeps its standing. The second correction is an admission. When the engine can find no free tile beside any of a faction's settlements, a character coming of age is created at the map's origin with empty name strings, and drawing that character's card crashes the game on the spot. The reporter has been calling this a map problem — certain settlements in the mod are sealed in by construction, and those do produce it. But across these 107 sessions the fault was caught in the act exactly once, and the faction it happened to was not one of the sealed ones: an ordinary playable faction, with a real town and a field army. A faction can evidently be closed in during a campaign by whatever has gathered around it, and no edit to the map prevents that. So the reporter no longer promises a map fix closes this. It names the faction and calls the fix necessary rather than sufficient, because that name is what decides which of the two it was. What would settle it is the save from that session. The damage, meanwhile, is wider than the crash count suggests: 68 of the 107 saves already carry these broken characters, across thirteen testers, and nothing can clean them out of a save that has them. The mine is laid nearly everywhere and had simply not been trodden on." },
    ],
  },

  ];

export default CHANGELOG;
