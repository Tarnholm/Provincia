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
    version: "0.9.1514",
    date: "2026-09-22",
    items: [
      { type: "feature", text: "**New Faction (Tools menu): create a faction the mod has never had.** Not the same job as waking a sleeping one \u2014 a new faction has to be registered from nothing, in every file the engine demands, and it is unforgiving about which. Which files those are was settled by measuring the mod rather than guessing: for each candidate, does every one of RIS\u2019s 239 declared factions appear in it? Seven do, and all seven are written \u2014 the faction entry, the character types, the strat models, the banners, the AI personality, the win conditions and the campaign itself. So you start by choosing a faction to build it FROM: there is no such thing as a faction without a culture, a banner, a strat model and an AI, and yours inherits all of it, then takes its own token, name, description, treasury and colours." },
      { type: "feature", text: "**A leader and an heir, from names the game already knows.** A faction with no living male family member is destroyed on its first turn, so the panel will not create one without both, and will not let them be the same man. The names come out of the donor\u2019s name pool \u2014 descr_namelists holds 85 pools serving all 239 factions, so nothing has to be invented or registered; pick from the list and set their ages. A settlement is required for the same reason, and is handed over from whoever holds it now, with the current owner named beside every town. If the hand-over would leave the old owner with nothing, you are told it will be destroyed." },
      { type: "feature", text: "**Recruitment is yours to pick.** Every building and unit the donor faction may have is listed \u2014 250 lines of RIS\u2019s export_descr_buildings name a single faction \u2014 and each one you tick lets the new faction have it too. Tick none and the faction still exists and still plays: four RIS factions ship with no recruitment entry at all, which is why this is a choice and not a step. Exclusion lists are never offered, because adding a faction to one of those would forbid the thing rather than grant it. Art is copied under the new faction\u2019s names, so replacing its banner or icon later is a matter of overwriting a file." },
      { type: "change", text: "**Warned, not walled, at the engine\u2019s ceiling.** 239 factions is as far as any mod is known to go, and RIS is already there, so creating a 240th says so plainly before you do it and then lets you \u2014 this is not a RIS-only tool and the limit is the engine\u2019s, not Provincia\u2019s. Preview runs the whole creation and writes nothing, so what you approve is what lands. Every file gets a timestamped backup first, and \u201Cexport instead of overwrite\u201D is honoured throughout." },
    ],
  },

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

  ];

export default CHANGELOG;
