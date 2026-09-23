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
    version: "0.9.1517",
    date: "2026-09-24",
    items: [
      { type: "fix", text: "**Live mode now shows every army, where it is, under the right banner.** Checked army by army against a running campaign over three turns, live mode matches the game: every land army and every fleet on its tile, with its faction and its commander's name. Before, after a single AI turn more than a quarter of the armies on the map were missing, duplicated or under the wrong faction." },
      { type: "fix", text: "**Armies led by a captain appear.** When the AI marches troops out of a town under a captain, those armies were missing from the map entirely — their units were quietly added to whichever general happened to be stored before them, so a one-unit general would suddenly show ten. After one AI turn of RIS that was 262 armies. They are now their own armies, where the game has them." },
      { type: "fix", text: "**The right faction for every army.** More than half of all armies used to take their faction from a guess, and generals away from home — or standing in rebel land — were often shown under the wrong banner. Factions now come from the character's own record, from the rebel marker the game gives rebel armies and pirate fleets, from the game's log (which names the faction of every army that moves), and only then from whose land it stands in." },
      { type: "fix", text: "**No more ghost duplicates.** A general who had marched away could still be drawn a second time at his starting position. Gone." },
      { type: "fix", text: "**The log never undoes a newer save.** The game writes a line in its log each time it saves; live mode now uses it to know exactly which moves the save already contains, so an older move from the log no longer puts an army back where it was. Everything that happens after the save — including a general who marries into the family mid-turn and takes his place in a town's garrison — still comes from the log." },
      { type: "fix", text: "**Fleets carrying troops or agents appear, and carry their admiral's name.** A fleet with an army or a diplomat on board was lost from the map. Fleets now show as “Admiral Gaius” rather than “romans julii fleet”. Characters with a single name, such as Azes of the Saka, are no longer dropped by the save reader and shown as an unnamed captain." },
    ],
  },

  {
    version: "0.9.1516",
    date: "2026-09-22",
    items: [
      { type: "fix", text: "**Picking a mod folder loads the right campaign with the right map.** Picking a folder that holds a whole mod project — the mod, its submods and a backups folder — listed the backups as campaigns too, and loading one filled the map with an old descr_strat: characters under the wrong faction, in places they no longer are. Backup, archive and wiki folders are no longer offered. Worse, every campaign found this way took its regions and map from whichever mod the search happened to reach last, so a campaign could load with a submod's map. Each campaign now uses its own mod's files, and a submod without its own map uses its parent mod's. Two mods that both ship an imperial_campaign are now both listed, each with the folder it comes from, instead of one silently hiding the other. If a character appears somewhere the game does not show him, re-import the campaign once." },
      { type: "fix", text: "**Live mode: a besieging army stands outside the town.** The game's log gives a siege's target town as the move's end point, and the army was drawn there — under the town's own icon, so the siege seemed to have no attacker. Besieging, storming, attacking, blockading and landing now leave the army on its own tile, and taking a town puts it inside — checked against where every army's next move started across a 97-turn campaign." },
      { type: "improvement", text: "**Choosing a campaign is clearer.** When a folder holds several campaigns, one is now picked for you (the last one you loaded, otherwise the imperial campaign), the choice is highlighted, and a Load button sits next to Cancel — before, the only button was Cancel and the campaign names looked like labels. Double-clicking a campaign still loads it straight away." },
    ],
  },

  {
    version: "0.9.1515",
    date: "2026-09-22",
    items: [
      { type: "fix", text: "**New Faction: two donors no longer damage the mod's files.** Building from `dummies` — the last faction in descr_sm_factions — copied the file's closing bracket into the new entry and wrote it after the end of the list. Building from `slave` — the last faction in every section of descr_character — carried the next section's header along with it, so the new faction's character types landed in the wrong section. Each block now ends where it really ends, and the clone goes in right after its donor." },
      { type: "fix", text: "**New Faction: the new faction uses its own AI, and a failed write no longer leaves it half-made.** It was given a copy of the donor's AI personality, but its campaign entry still pointed at the donor's, so the copy did nothing. And the files were written one at a time: if one could not be written (the game holding it open, say), the ones before it stayed changed, and every retry said the faction “already exists”. Now the files land together or not at all, under one backup, with descr_strat last. Bring In a Faction and New Faction also build on what you already exported, instead of starting again from the live mod and losing your first faction, and refuse to write into a campaign other than the one on screen." },
      { type: "fix", text: "**Nothing is written to your mod when its backup fails.** Apply takes a backup of the campaign files before it writes, and the settlement, character and army edits after it rely on that backup — but a failed backup was only logged and the edits went through anyway. Apply now stops and says why. The same rule now holds for replacing a building icon (a failed backup used to be followed by the write, and “revert” then deleted the icon), and the Scripts window's “Save back to mod” now writes all its files together with the same timestamped backups that “Restore last backup” reads, descr_strat last." },
      { type: "fix", text: "**The building-image auto-fix never overwrites art again.** It promised not to, but it checked whether an image already existed with the exact capitalisation, while Windows ignores it: a culture whose image was named `#ROMAN_temple.tga` had it replaced with another culture's temple. It now matches names the way Windows does, and refuses to replace any file." },
      { type: "fix", text: "**Live mode keeps up with every save, and starts without freezing.** After a save that had already been read, the next one could wait up to two minutes before it showed — an early exit left the reader marked “busy” until a safety timer cleared it. And starting live mode read the whole message log in one go, which froze the window on long campaigns and, past a few hundred megabytes, silently skipped placing armies from the log. It is now read in pieces in the background." },
      { type: "improvement", text: "**Smaller fixes.** Notices stay up for as long as they were meant to (every one closed after six seconds). The warning at the faction ceiling says “240th”. Renaming or deleting the mod folder while Provincia watches it no longer trips the crash handler, and two file operations that take a path from the window now check it properly." },
    ],
  },

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

  ];

export default CHANGELOG;
