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
    version: "0.9.1513",
    date: "2026-09-22",
    items: [
      { type: "feature", text: "**Bring In a Faction (Tools menu): put a faction from the main mod onto a submod's map.** A submod declares the same factions as the mod it sits on but leaves most of them asleep — RIS_Light 137 of 239, RIS_Classic 183 — so adding one is really waking one. Pick a dormant faction and you get its roster from the main mod: every character with the units in its army, and its family, each with a tick. Settlements are picked on the submod's own map, since those maps are redrawn (Light has 422 regions against the main mod's 1,312, Classic 300) and a faction's old towns mostly do not exist there; the ones it holds in the main mod that DO exist here are suggested and pre-ticked. Every town names its current owner — the rebels in grey, a living faction in orange, because taking it costs them a settlement. Preview shows exactly what will move before anything is written, including the tile each character will stand on." },
      { type: "change", text: "**Written carefully, and only where you point it.** Bringing a faction in rewrites that campaign's descr_strat with a timestamped backup beside it, and honours \"export instead of overwrite\". Characters keep their armies but get fresh coordinates on the new map — a main-mod position would drop them in the sea. A marriage or parent link only travels when everyone it names travels, and the panel warns you if what you have chosen would leave the faction without a town or without a leader, which kills it on the first turn." },
    ],
  },

  {
    version: "0.9.1512",
    date: "2026-09-22",
    items: [
      { type: "fix", text: "**Campaign Autopsy: \"Scan saves…\" now opens the folder picker.** It did nothing at all, which made the whole tool unreachable — the button was handed its action under the wrong name, so every click was quietly dropped. The Timeline section of Save Insights had the same dead button and is fixed with it. The scan itself was never broken; nothing could start it. If no mod is loaded the button now says so instead of going silent, which is what made it look broken rather than blocked." },
    ],
  },

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

  ];

export default CHANGELOG;
