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
    version: "0.9.1520",
    date: "2026-09-24",
    items: [
      { type: "fix", text: "**Trade deals show.** A trade-rights deal on its own never appeared under a faction's trade partners — only alliances did, because Provincia took the alliance bond for trade. It now reads trade rights the way the game does (checked against the running game, pair by pair), so a deal like one the Sarsinates offer you shows from the next save, and factions that only trade no longer count as partners of factions at war with them." },
      { type: "fix", text: "**Wars show the moment they start, and dead factions leave.** Diplomacy used to change only with the next save. A battle between two factions now puts them at war straight away — attacking a faction declares war — and ends their treaties, as in the game. A destroyed faction disappears from every war and treaty list (it was shown at war with its killer for ever, since the game keeps that entry), its region panel says it was destroyed, and characters it hands to the rebels — an admiral whose faction died — show under the rebels at once." },
      { type: "fix", text: "**A town lists only the units you can train there.** A building still being built counted as finished: Ankon, with its colony under construction, offered four Roman units the game doesn't. Buildings in the queue unlock nothing until they're done, and compound building requirements (the RIS area-of-recruitment tiers) are now checked properly." },
      { type: "fix", text: "**The build queue shows new buildings with their turns left.** A new building under construction was drawn as already built, with the queue pointing at the next level up at 0% and no turn count. It now shows in the queue with the turns the game has for that town — including its local speed-ups and slow-downs, which the save already carries — and not among the finished buildings. Repairs are labelled as repairs." },
      { type: "fix", text: "**The unit recruitment queue shows.** It stayed empty in every RIS town; it now lists the units being trained. How many turns they have left isn't read yet." },
      { type: "fix", text: "**Faction lists follow the live save.** A town taken before live mode started stayed with its old owner in the faction list and selection — Rome showed 26 provinces without Ankon, Asculum or Rhegium. And a rebel army was grouped under a heading like “saba rebel”; it now reads Free Peoples." },
    ],
  },

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

  ];

export default CHANGELOG;
