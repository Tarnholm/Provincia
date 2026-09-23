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
    version: "0.9.1519",
    date: "2026-09-24",
    items: [
      { type: "fix", text: "**Live mode: an army that wins a battle stays where it fought.** Before every battle the game notes, for each army, the tile it would retreat to if it lost — and live mode moved the army there, win or lose. A general who reinforced an assault and won could vanish from beside the town and turn up far inland. Only a real retreat moves an army now, and routed armies — which were not moved at all before — are drawn where they fled to." },
      { type: "fix", text: "**Live mode no longer misses a move now and then.** The game writes its log in blocks that usually end partway through a line, and live mode read each line as soon as any part of it appeared: a move that straddled two blocks was split in half and lost. Lines are now read once they are complete." },
    ],
  },

  {
    version: "0.9.1518",
    date: "2026-09-24",
    items: [
      { type: "fix", text: "**Live mode: an army that marches into a siege stands beside the town.** When an army walks up to a town and lays siege in the same order, it was still drawn on the tile it set off from. It now stands on the tile beside the town it walked to — checked against the running game — and the next save puts it on its exact tile. The same goes for an army that walks into an attack." },
    ],
  },

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

  ];

export default CHANGELOG;
