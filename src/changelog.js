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
    version: "0.9.1528",
    date: "2026-10-06",
    items: [
      { type: "fix", text: "**Crash reports say what the game had loaded.** A report now lists the tools injected into the game (such as RR Turbo, with the modules it had switched on, its settings file and the end of its log), the exact build of every mod (the branch and commit of a development copy, the Workshop update of a Workshop copy) and the graphics card with its driver version. It also counts the game’s own failure messages over the whole session, such as textures that failed to load or unit and building pictures that are missing, instead of only the last few hundred lines. The RIS development copy is no longer flagged as an unapproved mod (bundled crash reporter v0.1.63)." },
      { type: "fix", text: "**The AI Movement Lab counts retreats.** A message log whose only movement traces were armies fleeing was reported as having no movement at all, because two of the log’s four kinds of retreat line were read and then dropped. All four now count, including the common one where the game writes its next log line onto the end of the retreat." },
      { type: "fix", text: "**One crash address now gets the right verdict.** Crashes at +0x266FD3, the most common one in the telemetry, are now filed as the game’s own fault in its interface image handling rather than as unexplained (bundled crash reporter v0.1.62)." },
      { type: "fix", text: "**Crash reporter names the mods that actually ran.** Reports used to list the mods enabled in the launcher, and that list can be out of date or disagree with what the game loaded. A report labelled “RIS + 4 Romans” had in fact run 4 Romans alone. The mod list now comes from the game’s own message log. When a submod runs without the RIS beta under it, when the game cannot start its display, or when the graphics card fails at the end of a session, the report now says so and tells the tester what to do, instead of blaming the mod’s files. The game’s list of script events at shutdown is no longer counted as an error (bundled crash reporter v0.1.61)." },
    ],
  },

  {
    version: "0.9.1527",
    date: "2026-10-02",
    items: [
      { type: "improvement", text: "**Trade Lanes map: roads redrawn for the current RIS map.** The road network was read again from the game after this summer's map changes: 356 settlements now connect to different neighbours than before (3,003 roads in all). Settlements the game no longer reaches by road, such as Alexandreia-Arachosia, now show none, as in the game." },
    ],
  },

  {
    version: "0.9.1526",
    date: "2026-10-02",
    items: [
      { type: "improvement", text: "**Settlement trade income now matches the game to the denarius.** Trade is computed from your save the way the game computes it: every land route (population, goods, trade rights, road links and road levels, the governor's trading skill), every sea route (which ports a town's fleets pick, distance, docks, blockades, enemy armies in the region), the imports each partner sends back, and the Colossus. Checked against the running game on all 811 faction-owned settlements of a Turn 2 save: every one matches. Hover a settlement's trade value to see its routes row by row, like the in-game income scroll." },
    ],
  },

  {
    version: "0.9.1525",
    date: "2026-10-01",
    items: [
      { type: "fix", text: "**Crash reporter no longer counts a failed ambush as an error.** The game logs a failed ambush as “Conflict Type(FailedAmbush)”, and the reporter read that as an engine assert, which appeared in 6% of beta reports. It is now ignored. The battle summary still shows the conflict type (bundled crash reporter v0.1.60)." },
    ],
  },

  {
    version: "0.9.1524",
    date: "2026-10-01",
    items: [
      { type: "improvement", text: "**Crash reporter stops flagging harmless engine lines.** Heirs placed at map position (0,0) are no longer reported as a crash risk or a mod fault. These are mostly heirs of the hording Parni, and the RIS team has ruled them harmless. Portrait hair variants, the bodyguard size cap, undefined toggles, “CAS file has invalid chunk” and the base game’s ground_rock2.tga typo are also no longer counted as errors. They are now listed together on one “ignored” line. A missing file in a sound pack now gets a note saying which pack needs rebuilding (bundled crash reporter v0.1.59)." },
    ],
  },

  {
    version: "0.9.1523",
    date: "2026-10-01",
    items: [
      { type: "feature", text: "**A second map window for a second screen (dev setting).** Tick “⧉ Second map window” at the bottom of the 🧰 Tools menu and a Map 2 button appears in the title bar while dev mode is on. It opens the same campaign in a window of its own — maximised on your other screen the first time — with its own map mode, overlays and panel positions, so you can keep Trade Lanes on one screen and Political on the other. Live mode and the campaign are switched in the main window and Map 2 follows: it shows the same live data as it arrives, without reading the save a second time. Closing the main window closes Map 2." },
    ],
  },

  {
    version: "0.9.1522",
    date: "2026-09-26",
    items: [
      { type: "fix", text: "**Crash reporter no longer hangs after long sessions.** After a multi-hour game the log files can reach several GB, and the reporter loaded a whole log into memory just to keep its last lines, so it sat using lots of RAM and CPU and never sent its report. It now reads only the end of each log, reads the live logs in small pieces, and shows what it is doing at every step after the game closes (bundled crash reporter v0.1.58)." },
    ],
  },

  {
    version: "0.9.1521",
    date: "2026-09-24",
    items: [
      { type: "feature", text: "**Agents on the map.** Every diplomat, spy and assassin is drawn where it stands, in its faction's colour, with a hover card showing its name, faction and type — read from the save and checked against the running game (all 303 agents of a campaign, on the right tile). In live mode they move as the game reports it, new ones appear in the town that recruited them, and those caught or killed disappear. Toggle them under Army Types." },
      { type: "feature", text: "**Units being trained show their turns left.** The recruitment queue now reads “aor etruscan spearmen — 1 turn left”, counted down the way the game does. It was missing in some towns before, too." },
      { type: "feature", text: "**Live: whose turn it is during the AI's turn.** The live feed says which faction is moving right now." },
      { type: "feature", text: "**Live: deals and destroyed factions in the feed.** When you accept a deal the feed says so straight away — what it contains arrives with the next save — and factions destroyed are listed as it happens." },
      { type: "feature", text: "**Live: characters' new traits right away.** A character's card lists the traits and retinue he gained or lost since the last save, so a general who just won a battle shows it before the next save." },
      { type: "feature", text: "**Live: AI recruitment orders in their towns' queues.** When an AI faction orders units during its turn, the town's recruitment queue shows them." },
    ],
  },

  ];

export default CHANGELOG;
