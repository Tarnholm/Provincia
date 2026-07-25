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
    version: "0.9.1430",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**The Lab now reads map_ground_types.tga, so \"the army never arrives\" can be checked against the ground it was ordered across.** Every other mod file answers whether a faction *can* raise the troops a campaign needs; this one answers whether the route exists at all. High mountains and dense forest are impassable, so a corridor of them turns a short-looking order into an impossible one. 1,848 findings on the reference log now carry their target region's terrain, and 22 leads flag factions whose failures cluster on ground far harder than the map's own median — the Salassi against Salassia (84% hard, 68% impassable, the Great St Bernard), the Indians against Bariy and Paropamisadai (the Hindu Kush), Saba and the Minaeans in the Yemeni highlands." },
      { type: "improvement", text: "Mission targets resolve through the settlement→region map, because the AI log names a settlement (\"moving towards sett 'Erythrai'\") while the terrain map is keyed by region — without that translation only 15 of 6,399 findings resolved. Thresholds are relative to each map's own median rather than fixed numbers, so this works on any mod. Regions too small for their percentages to mean anything are annotated but never turned into a lead: a third of the RIS map's regions have under 200 land pixels, and \"95% impassable\" measured over 98 pixels is not evidence about a route. The land-pixel count is always shown so you can judge it yourself." },
      { type: "improvement", text: "The RGB→terrain palette was verified against the real file before any of this was built: exactly 14 distinct colours, 100.000% covered, no unknowns. Findings whose cause terrain cannot explain — garrison stripping, war spam — are deliberately left alone." },
      { type: "change", text: "**Internal save-format jargon is gone from everything you can see.** One word had leaked out of the save-reading internals into tooltips, buttons, error messages, progress text and the changelog itself — 33 places across 18 files. They now all say \"read\" (for the action) or \"decoded\" (for provenance: \"decoded 2026-05-10\", \"the decoded income model\"). A test enforces this permanently across the renderer, the main process and the preload bridge, and it proves its own teeth by checking it still catches the word in each shape it previously appeared in. It caught this very changelog entry on the first attempt." },
    ],
  },
  {
    version: "0.9.1429",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**Mod Lint now catches `requires` clauses whose and/or grouping doesn't mean what it looks like — 44 of them in RIS.** RTW has no parentheses and evaluates conditions strictly left-to-right with no operator precedence (which is exactly how Provincia's own EDB evaluator reads them, and that evaluator was calibrated line-for-line against the in-game growth scroll). So `not is_player and homeland and size1 or size2 or size3` actually reads as `(((not is_player and homeland) and size1) or size2) or size3` — meaning **size2 or size3 alone satisfies it**, and the \"HOMELAND AND CAPITAL GROWTH BUFF FOR AI\" block applies regardless of whether the faction is the AI or the region is a homeland. The same shape appears on AOR recruitment gates, where a single `hidden_resource aor_galatian` sits after the `or` that follows the faction list and the `mic_tier` check." },
      { type: "improvement", text: "The warning prints the **actual** left-to-right grouping rather than describing it, because the two shapes behave differently: with a pure-`or` tail a trailing term really does satisfy the whole clause (31 cases), but when another `and` trails the `or` it does not — `A and B or C and D` is `((A and B) or C) and D` (13 cases). Claiming a short-circuit there would be worse than saying nothing, so each case gets the reading that is true for it. Both are unit-tested." },
      { type: "improvement", text: "Long `factions { … }` lists collapse to a count, each distinct clause is reported once however many building levels repeat it, and commented-out lines are skipped. It is a warning, not an error — this shape can be intentional, so the message states the reading and asks you to confirm rather than declaring a bug." },
    ],
  },
  {
    version: "0.9.1428",
    date: "2026-07-25",
    items: [
      { type: "fix", text: "**Correcting bad advice I shipped in v0.9.1425.** That version told you to \"raise the Farm level on its regions in descr_regions.txt\" for farm-poor tier-locked factions. That is wrong, and here is the proof: RIS pairs every region's farming level N with a matching `Farm<N>` tag — 1,298 of 1,311 regions, zero mismatches — and export_descr_buildings' `hinterland_region` has a \";BASE GROWTH\" block applying `population_growth_bonus bonus -N requires hidden_resource farmN` for all 14 levels. The tag and the penalty are the same number, so raising one deepens the other and fertility nets out. Provincia's own growth model, calibrated line-for-line against the in-game growth scroll, had already measured farm's coefficient at about -0.01 — I should have checked it against the Lab's advice, and didn't." },
      { type: "improvement", text: "**The Lab now proves that cancellation from your EDB instead of asserting it.** It counts the matching farm rules and reports \"14/14 levels\" as evidence. If you ever change or remove that block, the advice downgrades itself to a cautious \"check the \";BASE GROWTH\" block first\" rather than repeating a claim the files no longer support — both paths are unit-tested. Poor farmland is still reported, because it is useful context; it is just no longer presented as the fix. The real levers stay first in the sentence: `settlement_min`, the `mic_tier_*` unit requirements, or giving the faction a settlement that can grow." },
      { type: "improvement", text: "The lead now also names what actually governs growth in RIS — squalor, the core_building tier penalties, and the homeland/capital buffs in that same EDB block — so the next thing to look at is obvious." },
    ],
  },
  {
    version: "0.9.1427",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**The Lab now reads descr_character.txt, and it connects your own comment to the AI's worst habit.** `starting_action_points` is the global movement budget every character begins a turn with — RIS runs 128 where vanilla RTW:R ships 80. The line's own comment reads *\"99 = AI doesn't leave cities undefended, but is passive in harrassing\"*, and the reference log contains 727 settlements whose garrisons their own owner pulled out, with 4,000+ units removed. That is precisely the symptom the comment describes, so the Lab now surfaces the setting next to the measured count and quotes your note back rather than proposing a number of its own. It also flags that this is a single global value, so it moves the player too." },
      { type: "improvement", text: "Each candidate value stays attached to the comment it came from. The file mentions both 99 and 124, but they are different claims — 124 is annotated \"HIGHLY RECOMMENDED AS PER MEDIEVAL 2 AI'S\" — so the Lab quotes the \"undefended cities\" line against 99 only, and mentions 124 separately. A summary that merged them would put words in your mouth." },
      { type: "improvement", text: "The lead stays silent unless the symptom is actually in the log. A high setting on its own is not a finding — without garrison-stripping there is nothing to report, and saying otherwise would be theorising instead of measuring." },
    ],
  },
  {
    version: "0.9.1426",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**The Lab now reads scripting_log.txt and finds real bugs in the mod's data files — with the exact file, line and column.** This is a third log kind and the highest-confidence signal in the whole tool: the AI logs describe behaviour that needs interpreting, whereas here the engine itself names what it could not parse, so nothing is inferred. On your live log it pulls 13 genuine errors out of 93,673 lines in 22ms, and no save is needed. Two are fully diagnosed: `Aedile_tenure` in descr_senate.txt names an office RIS no longer has (it was split into PlebeianAedile and CuruleAedile), so that restriction can never be satisfied and the Praetor office behind it is unobtainable — the same dead name is used by 3 `Condition HasOffice Aedile` triggers in export_descr_character_traits.txt, and `PontifexMaximus` is dead there too. Also found: descr_formations_ai.txt fails to parse at line 2369 (26 of its 32 formations are declared after that point), 5 formation groups have no catch-all block while the 21 the engine accepted all do, and two characters — Skerviaidos and Dionysios — start on invalid tiles and so are not placed where descr_strat.txt says." },
      { type: "improvement", text: "**Each error arrives with a fix resolved from your mod files, or an honest \"not resolvable\".** Office leads list the offices that actually exist and name the rename; formation leads cite the file's own catch-all statistics as evidence. Where the cause genuinely can't be pinned down — the descr_formations_ai parse failure, where the engine's column number points at where it gave up recovering rather than at the offending token — the lead reports the measured blast radius and stops, instead of guessing. The Lab also sweeps every office reference in the mod statically, so it finds dead ones the log hasn't hit yet." },
      { type: "improvement", text: "The log's 13,000+ ordinary `[FAILED]` condition checks are deliberately excluded — those are just campaign scripts deciding not to fire, and reporting them would bury the 13 real errors. A one-click **⚠ Check mod files** button reads the scripting log straight from your game folder." },
      { type: "fix", text: "The analysis worker no longer demands a save file up front. It never used that copy — the save is read further down the pipeline — so this removes a redundant 44MB read on every run, and makes the save-free scripting-log mode possible at all." },
      { type: "fix", text: "A new packaging guard walks the worker's entire require graph and fails the test suite if any module is missing from the build whitelist. This is the exact bug that shipped in v0.9.1417 (\"Cannot find module 'electron'\") in its other form, and it is invisible to every runtime test because modules resolve fine off disk in development — it only breaks in the packaged app. Verified to actually catch it." },
    ],
  },
  {
    version: "0.9.1425",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**The Lab now explains WHY a faction’s towns never grow, using descr_regions farm levels.** The settlement-tier lock says a faction can’t build military infrastructure because its towns are too small; this goes one step upstream and checks whether its provinces can feed growth at all. On the reference campaign 8 of the 91 tier-locked factions are genuinely farm-poor — Hadhramaut averages Farm 3.1 against a map median of 6.2, so its towns will never reach large_town — and those leads now point at raising the Farm level in descr_regions.txt. The other 83 are explicitly told their farmland is ordinary, so growth is NOT their blocker and the settlement_min gate is." },
    ],
  },
  {
    version: "0.9.1424",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**Two new AI problems detected, plus an espionage health check.** GARRISON STRIPPED: towns whose defenders the AI keeps pulling out — 727 cases on the reference log, worst being Mediolanum with its garrison split apart in 29 separate turns and 206 units removed in total, which is how AI factions lose their own cities. WAR SPAM: factions authorising attacks against far more enemies than they can fight — 80 of them, with Seleucid authorising against 17 different factions while its own campaigns sat stalled. The Lab also now reports espionage usage, and on this campaign 69% of faction-turns assigned no agents at all." },
    ],
  },
  {
    version: "0.9.1423",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**New “By faction” view makes thousands of findings navigable.** Instead of scrolling 5,592 rows, you get one row per faction — worst first — with its totals for unaffordable campaigns, orders that never arrived and orphaned armies, plus a chip breakdown of its problem mix. Click a faction to jump straight to its findings." },
      { type: "improvement", text: "**The Lab remembers what you were working on.** The attached save and the last log you analysed persist between sessions, and a “↻ Re-run last log” button repeats the previous analysis in one click — which is the normal loop when you tweak the mod, play forward and re-measure." },
    ],
  },
  {
    version: "0.9.1422",
    date: "2026-07-25",
    items: [
      { type: "improvement", text: "**The AI analysis now tells you what it’s doing.** A run over a 346MB log plus a save takes about fifteen seconds, and until now the only feedback was a button reading “Analyzing…”. It now reports its phase live — streaming the log (with a running line count), reading the save, cross-referencing, auditing the mod files — so a long run is visibly progressing rather than possibly hung." },
    ],
  },
  {
    version: "0.9.1421",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**Export the AI analysis as a report the team can work from.** “⤸ Export report” writes a Markdown review document plus CSVs: the Markdown opens with what was analysed and the save-verified totals, then groups every mod-file lead under the file you would edit — which is effectively the to-do list — followed by the worst-affected factions and the worst individual cases per problem type. The CSVs carry every finding and every lead in full for spreadsheets. On the reference campaign that is a 56KB review document, a 5,592-row findings sheet and a 677-row leads sheet, so 677 leads stop being something you scroll past in a dialog." },
    ],
  },
  {
    version: "0.9.1420",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**AI Movement Lab can now prove whether a mod change actually helped.** Save any run as a named baseline (“before mic_2 settlement_min change”), make your edit, play the campaign forward, then re-run and compare: you get a verdict (IMPROVED / REGRESSED / UNCHANGED) plus before→after numbers for every problem type, the save-verified totals (never-arrived, unaffordable campaigns, orphaned armies), the biggest movers faction by faction, and whether mod-file leads went down. Baselines are small files kept in the app’s data folder, so you can keep a history of tuning attempts." },
      { type: "improvement", text: "**The comparison refuses to flatter you.** Findings scale with campaign length, so everything is also measured per turn — a shorter replay showing half the problems at the same rate reports UNCHANGED, not a win — and comparing two different log types is rejected outright with the reason stated. Fewer problems reads green; the verdict is computed from rates, not raw counts." },
    ],
  },
  {
    version: "0.9.1419",
    date: "2026-07-25",
    items: [
      { type: "improvement", text: "**Added the tests that would have caught yesterday’s two Lab failures before release.** An end-to-end test now runs a real 346MB campaign_ai_log plus a real turn-102 save through the actual worker and pins the results (log parsed, 102-turn cross-reference, every impossible campaign attributed to a cause, every mod-file lead naming an editable file), and a second test statically walks the worker’s whole require graph and fails if anything in it reaches for Electron or other main-process-only bindings. That static check is the one that matters: in development Electron resolves from node_modules so the bad require succeeds, and only the packaged app failed — which is exactly how it shipped. Both were verified by reintroducing the bug and watching them fail. Tests skip cleanly on machines without the reference files." },
    ],
  },
  {
    version: "0.9.1418",
    date: "2026-07-25",
    items: [
      { type: "fix", text: "**Fixed “Cannot find module ‘electron’” when analysing a log in the AI Movement Lab.** Moving the analysis into a worker thread (previous version) left behind the file-picker code that requires Electron — which a worker has no access to — so the packaged app failed instead of analysing. The picker belongs on the main thread and now stays there; the worker only ever receives a resolved path. Added a test that fails if anything Electron-dependent creeps back into the worker module." },
    ],
  },
  {
    version: "0.9.1417",
    date: "2026-07-25",
    items: [
      { type: "fix", text: "**The app no longer freezes while the AI Movement Lab analyses a log + save.** Reading a 45MB save takes about 12 seconds and it was running on the main thread, so the whole UI — mouse included — locked up for the duration. The entire pipeline (log streaming, save read, cross-reference and mod-file audit) now runs in a worker thread: measured on the 346MB reference log plus the turn-102 save, 15.3 seconds of work with a worst main-thread stall of 111ms instead of a multi-second freeze." },
      { type: "fix", text: "**Findings list no longer shows “(null,null)” or a bare “t–”.** AI-decision findings have no map tile or turn span (unlike movement findings), and those empty values were being printed literally. They’re now simply omitted, and a single-turn span reads “t12” rather than “t12–12”." },
      { type: "improvement", text: "**The summary, tabs and filters now stay pinned while you scroll** — only the results list moves, so the cross-reference totals and the filter chips remain reachable in a list of thousands of findings." },
    ],
  },
  {
    version: "0.9.1416",
    date: "2026-07-25",
    items: [
      { type: "fix", text: "**AI Movement Lab no longer reports an empty log as “the AI moved cleanly”.** Feeding it a message_log that carries no movement data (a session log full of engine warnings, which is what the game leaves behind when no AI turns were played) showed “0 findings” plus a cross-reference banner full of zeroes — reading as a clean bill of health when in fact there was nothing to analyse. It now says so plainly, with the line count and what was missing, and points you at campaign_ai_log.txt instead. The save cross-reference is skipped entirely for such logs rather than printing zeroes." },
      { type: "improvement", text: "**The header now names which kind of log was parsed** (“movement log” vs “AI decision log”), and “no findings” now distinguishes “your filters hide them all” from “genuinely nothing wrong in this log”." },
    ],
  },
  {
    version: "0.9.1415",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**AI Movement Lab now reads descr_sm_resources too — completing the AI-relevant file set.** Each faction gets a resource endowment (its provinces’ resources × their trade values) measured against the map median, so an income problem can be blamed on poor land — or cleared of it. On the reference campaign it CLEARED all 22 income-limited factions: every one sits at or near the median (3.1–6.4 against a median of 5), so their shortfall is tax base and upkeep, not resources. Leads now say that outright instead of staying silent, which stops anyone “fixing” resources that were never the problem." },
      { type: "improvement", text: "**Mod files now mined: descr_strat, descr_regions, descr_sm_factions, feral_descr_ai_personality, export_descr_unit, export_descr_buildings and descr_sm_resources** — every faction profile carries its AI personality and aggression, starting position, culture, naval ownership, settlement tier, military-infrastructure ceiling, economy over the campaign, build appetite and resource endowment." },
    ],
  },
  {
    version: "0.9.1414",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**AI Movement Lab now reads export_descr_buildings and found the root cause of stalled AI factions.** Each military_industrial_complex level carries a settlement_min (mic_2 needs a large_town, mic_3 a city), and on the reference save every faction’s military infrastructure equalled its best settlement tier EXACTLY — Aulerci’s four villages had none at all. So a faction whose towns stay small is permanently barred from the troop tiers its own campaigns demand, however rich it gets. New SETTLEMENT-TIER LOCKED lead (91 factions on the reference log) names the exact level, its settlement_min, cost and build time, and offers the three real fixes: lower that level’s settlement_min, lower the mic_tier_* requirement on mid-tier units, or give the faction a settlement that can grow." },
      { type: "improvement", text: "**Faction profiles now include best settlement tier**, so a lead can distinguish “too poor” from “too small” — e.g. Armenia is financially rich 41% of the time, fields 1,890 men, and is asked for 135,121 strength while locked at town tier." },
    ],
  },
  {
    version: "0.9.1413",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**AI Movement Lab now reads the engine's own finance reports — so it can tell you when money is NOT the problem.** New RICH BUT STALLED finding: factions the engine itself rated financially rich for most of the campaign whose offensives still never launched. On the reference log that is 51 factions — Sophene sat on an average spending headroom of 77,773 and still never attacked. Those leads now explicitly say “do NOT raise its income” and point at military-building cost/time and recruit-tier gates instead, which is the opposite advice to the genuinely poor factions." },
      { type: "improvement", text: "**Each faction now gets an economy and build-appetite profile** — share of turns rich vs poor, average income/outgoings/spending headroom, and the highest priority it ever assigned to a military building (e.g. Cyzicus ranks Barracks and Armoury at 3,047 yet still fields 264 men). That distinguishes “doesn’t want military buildings” from “wants them but never completes them”." },
    ],
  },
  {
    version: "0.9.1412",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**AI Movement Lab now separates “can’t afford it” from “can’t build it”.** Every impossible campaign is classified by reading the faction’s actual military infrastructure out of the save: RECRUITMENT-capped (its towns never get past a low military_industrial_complex tier, so the units its own campaigns demand don’t exist for it) versus INCOME-limited (infrastructure is fine, the money isn’t). On the reference campaign that split 402 impossible campaigns into 295 recruitment-capped and 107 income-limited — e.g. Aulerci asks for 27,526 strength while fielding 2,227 men with 3 of its 4 towns having no military infrastructure at all." },
      { type: "improvement", text: "**Mod-file leads now point at the right file for each cause** — recruitment caps name the mic recruit-gates in export_descr_buildings plus that faction’s building_priority, while income limits name descr_strat and descr_sm_resources instead. No more guessing which knob a stalled faction actually needs." },
    ],
  },
  {
    version: "0.9.1411",
    date: "2026-07-24",
    items: [
      { type: "feature", text: "**AI Movement Lab now answers “why did that army disappear?”** New ABANDONED detector: any character the AI actively commanded and then went silent on. Attach a save and each one is settled — still alive means the AI ORPHANED a live army (a real bug), dead means it simply died (marked benign and sorted away), and unmatched names say “unknown” instead of guessing. On the reference campaign: 2,255 armies went silent, and 1,140 of them were still alive at turn 102 while only 45 had actually died." },
      { type: "feature", text: "**New “Mod-file leads” tab — findings turned into edits.** Cross-references the AI log and save against the mod’s AI-relevant files (feral_descr_ai_personality, descr_strat, descr_sm_factions, export_descr_unit) and reports which FILE and which KEY to change, with the evidence: e.g. “Volcae: personality ai_volcae → super_aggressive (aggresiveness 100) — max aggression on a 3-settlement faction that fields 1,006 men but asks for 35,053 strength; retier to passive.” Also flags factions with overseas objectives but no fleet (distinguishing ‘needs a starting transport’ from ‘cannot own any ship in EDU’)." },
    ],
  },
  {
    version: "0.9.1410",
    date: "2026-07-24",
    items: [
      { type: "feature", text: "**AI Movement Lab can now cross-reference a save — turning findings into verdicts.** Attach a .sav alongside the log and every finding gets checked against what actually happened: did the army ever arrive (or does another faction still hold the target?), and could the faction ever have afforded the campaign it kept gathering for? On the reference 102-turn campaign that proved 179 of 271 repeated move orders never arrived, and 402 of 563 stalled campaigns were mathematically impossible — one faction needed 23,041 strength while fielding 631 men in total. A “proven only” filter narrows the list to what the save confirms, and where the save can’t answer, the verdict says “unknown” rather than guessing." },
    ],
  },
  {
    version: "0.9.1409",
    date: "2026-07-24",
    items: [
      { type: "feature", text: "**AI Movement Lab now reads campaign_ai_log.txt too — the AI's own decision log, at any size.** Telemetry logs stream (a real 346MB / 4.4-million-line log analyzes in ~1 second) and yield four new finding types: STUCK MISSIONS (the AI re-issues the same move order turn after turn — one army was ordered toward the same settlement in 50 of 51 turns), THRASHED ARMIES (the controller assigns/releases the same army endlessly — champion: 240 reassignments across 94 regions), STALLED CAMPAIGNS (gathering for a target but never reaching required strength, some at 0 of 11,000+), and ABORT HOTSPOTS (regions whose campaigns die for insufficient strength dozens of turns running). Log type is auto-detected; region ids resolve to settlement names from the log itself; click a finding to highlight the place on the map." },
    ],
  },
  {
    version: "0.9.1408",
    date: "2026-07-24",
    items: [
      { type: "fix", text: "**HTML Report preview fixed.** Preview used a popup window, which the app's window policy always blocks — so it silently never opened. It now writes a temp file and opens it in your default browser, with clear status feedback." },
    ],
  },
  {
    version: "0.9.1407",
    date: "2026-07-24",
    items: [
      { type: "feature", text: "**New tool: AI Movement Lab (⚔ in Tools).** Analyzes a campaign log (message_log.txt — the live game's, an archive, or one downloaded from the RIS Discord telemetry) for AI pathing pathologies, to guide AI tuning in the mod: STUCK armies (moving every turn, going nowhere), PING-PONG loops (bouncing between two tiles), orders that NEVER ARRIVE, and FLEE LOOPS — each with army, faction, turn span and the region it happened in (click to highlight on the map). Plus a per-faction wander index (how much of its marching is circles) and a cannot-find-flee-tile counter. Validated on a real 97-turn campaign: found an army that ping-ponged between two tiles for 70+ turns." },
      { type: "fix", text: "**Flee events now actually parse.** The log parser's flee-tile pattern only matched one field order while real logs use two — every flee event was silently dropped (in Live mode too). Both orders parse now; 297 flee events surface in the reference log where before there were zero." },
    ],
  },
  {
    version: "0.9.1406",
    date: "2026-07-24",
    items: [
      { type: "fix", text: "**Public Order (and Corruption/Income/Growth) no longer lock the app on first use.** The economy model re-parsed the entire buildings file (export_descr_buildings.txt) once per faction inside its trade-partner pass — about 12 seconds of frozen main thread the first time one of these modes opened. That parse is now cached, cutting the cold cost by ~78% (12s → ~2.7s), and the remaining one-time map/graph setup is cached per mod and warmed quietly in the background, so opening these modes is effectively instant after load." },
    ],
  },
  {
    version: "0.9.1405",
    date: "2026-07-24",
    items: [
      { type: "improvement", text: "**Removed the hitch when opening Growth (and Corruption/Income/Public Order).** These per-faction model modes paid a one-time ~400ms cost to parse the economy/trait/region model the first time one was opened. That model is shared across all of them, so the app now warms it quietly in the background shortly after a mod loads — whichever of these modes you open first now paints immediately instead of stalling." },
    ],
  },
  {
    version: "0.9.1404",
    date: "2026-07-24",
    items: [
      { type: "fix", text: "**Restored missing sidebars for Culture, Religion, AOR, Legions and Victory.** A series of mode merges had scrambled the boundary between the hover-readout function and the legend function, leaving five modes' legend panels either deleted or misfiled (so they never rendered). All five are back in place with their full legends; the earlier one-line “culture/religion restore” attempt had landed in the wrong function." },
      { type: "improvement", text: "**Reach map mode rebuilt to measure real travel, not region hops.** It used to count adjacency steps (“1 region ≈ 1 turn”) — which was wrong because provinces vary hugely in size. It now runs a distance-weighted shortest-path from your nearest army: each step costs the actual geographic distance across the province, halved along roads, converted to an estimated number of turns to march reinforcements there. Hover shows the per-province estimate." },
    ],
  },
  {
    version: "0.9.1403",
    date: "2026-07-24",
    items: [
      { type: "fix", text: "**Fixed missing garrisons and field armies across much of the map (all of Italy, and more).** The map RIS ships (map_regions.tga) is RLE-compressed, but the starting-armies builder read it as uncompressed — every pixel lookup was garbage, so armies whose position didn’t happen to land on a valid region were silently dropped. Added RLE decoding: regions with armies jumped from ~500 to 1304 of 1311. Rome, Campania, Etruria, Latium and the rest of Italy now show their garrisons and field armies again — which also fixes the Armies map mode, army composition on hover, and the Reach mode’s army seeds." },
    ],
  },
  {
    version: "0.9.1402",
    date: "2026-07-24",
    items: [
      { type: "fix", text: "**Restored the Culture and Religion map legends.** A recent mode-merge accidentally removed the shared culture/religion legend block, leaving those two modes with no sidebar. Brought it back (grouped families, search, per-entry region counts, click-to-isolate)." },
    ],
  },
  {
    version: "0.9.1401",
    date: "2026-07-24",
    items: [
      { type: "fix", text: "**Fixed a Live-mode crash on battle events.** The War map mode kept calling a snapshot setter whose state had been removed when the Battle Ledger tool was folded in — the next battle in a live game would have thrown. Restored the trigger so the War map/legend update live again." },
      { type: "fix", text: "**Live time-scrubber now rewinds the map.** Dragging the live turn slider back in time repainted only the label/event feed while the map stayed on present-day borders. Faction, Diplomacy, Cultural Conversion, Threat/Reach and Armies now all follow the scrubber; returning to the latest turn resyncs to live." },
      { type: "fix", text: "**Fixed crashes opening the Climate, Port Level, Irrigation, Earthquakes and River Trade legends** (a shared legend helper was never defined) and the Diplomacy line-overlay (its data was never computed — it now draws relation-coloured lines between faction territories). Also fixed the Compare Saves tool crashing on open." },
      { type: "improvement", text: "**Added an undefined-reference guard** to the test suite: it statically scans App.js for any identifier used but never defined, catching this whole class of crash before release — the render smoke-test only covers the default map mode, so mode-specific and handler-specific crashes slipped through." },
    ],
  },
  {
    version: "0.9.1400",
    date: "2026-07-24",
    items: [
      { type: "fix", text: "**Fixed a crash when opening the History map mode.** Its legend referenced a scan handler by the wrong name (a leftover from when it was a tool panel), throwing on render. History mode now opens correctly — scan your saves and scrub the timeline on the map." },
      { type: "improvement", text: "**Corruption mode now has a hover readout** — hovering a region shows its per-turn corruption loss, matching the Income and Growth modes." },
    ],
  },
  {
    version: "0.9.1399",
    date: "2026-07-24",
    items: [
      { type: "fix", text: "**Cultural Conversion now uses the game's real rule.** A province's faith is whichever religion holds the largest share — the highest rel_X_N level in the region data (e.g. dorian 4 / italic 2 → dorian). A province is “converted” (green) when that dominant faith matches its owner faction's default religion (from descr_sm_factions), “foreign” (red) when another faith dominates — the same majority-religion logic the public-order model uses. Hover shows the dominant faith, the runner-up, and the owner's faith; the legend lists a faction's foreign-faith holdings. (Previously it compared a display-culture label against the wrong vocabulary.)" },
    ],
  },
  {
    version: "0.9.1398",
    date: "2026-07-24",
    items: [
      { type: "feature", text: "**New map mode: History (Political).** Folds in the old Timeline Player tool — scan your saves folder (button in the legend) and the map itself recolours by region ownership at the scrubbed turn. Play/pause auto-advances; the legend shows the year and the largest factions at that point. The separate Timeline Player tool is gone." },
      { type: "feature", text: "**Armies mode shows the selected region's army composition.** Hover or click a region and the Armies legend lists each army with its units grouped by type and unit icons — click any unit for its full card. Not just counts anymore." },
      { type: "feature", text: "**New map mode: Cultural Conversion (Demography).** Green = the settlement's culture matches its owner (converted, no friction); red = foreign culture under a different-culture owner (population resisting — unrest and slow urbanisation until it converts). Pick a faction to list its foreign holdings; hover shows both cultures." },
    ],
  },
  {
    version: "0.9.1397",
    date: "2026-07-24",
    items: [
      { type: "improvement", text: "**Four more Tools folded into their map modes.** Victory Progress → the Victory mode legend (faction list ranked by completion; click one for its held/missing breakdown with jump-to-region chips). Battle Ledger → the War mode legend (per-faction won/lost + recent battles, click to jump). Mercenary Pools → the Mercenaries mode legend (▸ on a pool lists its units with costs/replenish/restrictions, click for the unit card). Population Projection removed — the Growth mode covers it. The Tools menu is down to genuinely non-map tools." },
    ],
  },
  {
    version: "0.9.1396",
    date: "2026-07-24",
    items: [
      { type: "improvement", text: "**Population legend lists the selected faction's provinces with their headroom** — population vs cap, fullest first (red ≥ 90%, amber ≥ 60%, green below). Click to highlight, double-click to jump." },
    ],
  },
  {
    version: "0.9.1395",
    date: "2026-07-24",
    items: [
      { type: "improvement", text: "**Three income modes merged into one Income (Economy).** The model Income, the dev live-save Income and the dev Wealth proxy were all answering “how rich is this settlement”. Now one mode with three data tiers: exact per-turn income from the live save when connected → the selected faction's model income (computed per faction, ~1s) → a static resources+farm+port estimate so the map is never empty. Legend lists settlements richest-first (click to highlight, double-click to jump); hover says which source you're seeing. The old all-faction background sweep is gone entirely." },
      { type: "improvement", text: "**Pop Headroom merged into Population.** Hovering in Population mode now shows the population AND how full the settlement is against its cap — the separate dev mode is gone." },
    ],
  },
  {
    version: "0.9.1394",
    date: "2026-07-24",
    items: [
      { type: "improvement", text: "**Unrest merged into Public Order** — they were the same number shown two ways. Public Order (Government) now also lists the settlements worst-first with click-to-highlight / double-click-to-jump, from the live save or the selected faction's model." },
      { type: "improvement", text: "**Tier Forecast merged into Growth** — one mode, called Growth (Economy), now computed only for the selected faction. Colour = growth rate; hover and the legend's settlement list show each settlement's growth and how many turns until its next tier at that rate." },
      { type: "improvement", text: "**Corruption legend lists the faction's settlements** with each one's corruption cost (dn/turn, worst first) and the faction total — click to highlight, double-click to jump." },
    ],
  },
  {
    version: "0.9.1393",
    date: "2026-07-24",
    items: [
      { type: "improvement", text: "**Happiness and Public Order merged into one Public Order mode (Government)** — they read the same value. Now a regular (non-dev) mode that also works WITHOUT a save: pick a faction and the PO model estimates every settlement (normal tax); connect Live for exact in-game values. Same colour bands as before (green > 100%, light green 85–100, orange 75–85, red < 75)." },
      { type: "change", text: "**Export Map PNG removed from Tools** — the map screenshot button already covers it." },
    ],
  },
  {
    version: "0.9.1392",
    date: "2026-07-24",
    items: [
      { type: "improvement", text: "**Tier Forecast computes only the selected faction** (like Corruption) — no more all-faction sweep. Pick a faction in the sidebar; its projection computes in about a second and is cached." },
      { type: "fix", text: "**Tier Forecast numbers fixed.** The old 60-turn simulation let squalor plateau every settlement below its threshold, so the map showed nothing useful — and 0% growth could read green. Now: turns-to-next-tier at the CURRENT growth rate (Rome at +3.5%/turn → ~32 turns), green only for genuinely growing settlements, grey = stalled (0%), red = declining, blue = max tier. Hover shows the rate and pop vs threshold." },
      { type: "change", text: "**Removed the Diplomacy Web tool** (added earlier today) — not helpful in practice. The Diplomacy map mode and the Diplomacy Heatmap remain." },
    ],
  },
  {
    version: "0.9.1391",
    date: "2026-07-24",
    items: [
      { type: "feature", text: "**New map mode: Diplomacy (Political).** The classic relation view — every region coloured by its owner's standing with your faction: blue = yours, red = at war, amber = hostile, green = allied, purple = protectorate, light blue = trade bond, grey = neutral. Pick a faction in the sidebar to set the viewpoint (Live mode supplies the relations); hover any region for the exact relation. The Heatmap and Web panels in Tools remain the deep-dive views." },
      { type: "improvement", text: "**Mercenaries map mode no longer requires dev mode** — it now sits under Military as a regular mode, alongside the Mercenary Pools browser in Tools." },
    ],
  },
  {
    version: "0.9.1390",
    date: "2026-07-24",
    items: [
      { type: "feature", text: "**New tool: Diplomacy Web (in the Tools menu).** Force-directed graph of the live diplomacy matrix — war blocs pull together, alliance clusters form visibly. Edges by relation type (war / allied / protectorate / trade / hostile, individually toggleable), node size = number of relations, faction colours. Drag nodes to untangle, search to find a faction, click one to focus its relations." },
      { type: "improvement", text: "**Corruption map computes only the selected faction.** Picking the Corruption mode no longer kicks off the full all-faction sweep — select a faction in the sidebar and its numbers compute in under a second (cached per faction). The legend says which faction is shown." },
    ],
  },
  {
    version: "0.9.1389",
    date: "2026-07-24",
    items: [
      { type: "feature", text: "**New map mode: Tier Forecast (Population).** Colors every settlement by how many turns until it reaches its next population tier (60-turn projection): green = imminent, amber = distant, grey = stalled, red = declining, blue = already max tier. Hover shows the exact forecast (current tier, turns, pop vs threshold)." },
      { type: "feature", text: "**New tool: Mercenary Pools (in the Tools menu).** Browse every mercenary pool with its units — experience, cost, replenish rate, max, faction restrictions. Search across pools/units/regions, highlight a pool's regions on the map, click a unit for its unit card." },
      { type: "feature", text: "**New tool: Export Map PNG (in the Tools menu).** Saves the whole map in the current mode as a high-resolution PNG (3× native) with crisp region pixels, re-stroked overlays (borders, trade lanes) and a painted legend — ready for sharing or mod documentation." },
    ],
  },
  {
    version: "0.9.1388",
    date: "2026-07-23",
    items: [
      { type: "feature", text: "**Legions map: see each legion's units.** Every legion in the Legions legend now has a ▸ expander listing its actual units (early/late cohort and First Cohort variants, with unit icons) — click a unit to open its full unit card. Units are matched from the game's unit roster, so III Cyrenaica won't pick up III Gallica and XIII Gemina won't pick up X Gemina Pia." },
    ],
  },
  {
    version: "0.9.1387",
    date: "2026-07-23",
    items: [
      { type: "improvement", text: "**Legions map mode is now a regular Military mode** — visible under Military without dev mode on, and switching dev mode off no longer kicks you out of it." },
    ],
  },
  {
    version: "0.9.1386",
    date: "2026-07-23",
    items: [
      { type: "feature", text: "**New map mode: Legions (Military, dev).** Shows where each named legion can be recruited — the aor_*_early / aor_praetorian zones from descr_regions: Legio I Germanica, II Gallica, III Cyrenaica, IIII Parthica, V Alaudae, VI Ferrata, VII Paterna, IX Hispana, X Equestris, XIII Gemina, and the Praetorian Guard (Roma). Solid colour per legion (each region belongs to at most one zone), legend sorted by zone size with click-to-isolate / shift-click-to-add, hover shows the legion name. These legion tags no longer clutter the regular AOR map's Secondary layer — they live here now." },
    ],
  },
  {
    version: "0.9.1385",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Road masking is now strictly per province.** A province that has roads (or a port) built shows ALL road stretches inside it — including the piece connecting its settlement to the network. The previous update's per-connection logic wrongly hid parts of a province's own roads (e.g. Iliensia's settlement link)." },
    ],
  },
  {
    version: "0.9.1384",
    date: "2026-07-23",
    items: [
      { type: "improvement", text: "**Roads now respect what's actually built — per region.** Without Live mode, the map shows only roads in regions that have roads built at campaign start (from descr_strat); with Live mode, the loaded save's built roads are added. A road crossing into a region without roads is cut exactly at the border — even mid-link — instead of drawing the whole connection. Settlement→port connectors still show in port regions (the game builds those with the port)." },
    ],
  },
  {
    version: "0.9.1383",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Roads now use the game's actual rendered curves.** The road network's clean topology (all connections, proper junctions, no doubles) is now overlaid with the game's own rendered road geometry captured piece by piece — so the curves on the map are the real in-game curves, with their genuine detail and natural sharp corners, not a synthetic approximation. Verified map-wide: zero hairpin spikes, zero crossings, zero gaps, nothing on water." },
    ],
  },
  {
    version: "0.9.1382",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Road detail restored while staying clean.** The previous version was correct but too smoothed-out. Roads now keep finer curve detail along their length (more of the route's bends, with the game's ±15° wiggle) — organic like the in-game roads — while still all present, correctly connected, with zero hairpin spikes, zero gaps, nothing on water." },
    ],
  },
  {
    version: "0.9.1381",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Roads rebuilt to match the game's all-roads network — organic, complete, spike-free.** Roads now come from the game's real road network (every connection present, none missing or extra, junctions properly joined) and are drawn with the game's own ±15° curve-wiggle, so they look organic like the in-game roads rather than geometric. Verified map-wide: zero hairpin spikes, zero gaps, nothing on water. This finally gives both the correct connections and the in-game look at once." },
    ],
  },
  {
    version: "0.9.1380",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Road spikes and doubled lines drastically reduced (measured).** A rebuilt validator now honestly counts hairpin spikes and parallel-doubles across the whole map, and a final cleanup pass removes them: map-wide hairpin spikes dropped from ~625 to 3, parallel-doubles from ~384 to 7, with zero crossovers and zero roads on water. The organic captured curves are untouched. The few remaining sharp forks at some coastal towns are two real roads genuinely meeting at the settlement, not artifacts." },
    ],
  },
  {
    version: "0.9.1379",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Road spikes eliminated (verified).** The gap-closing was bending road ends sideways and creating hairpin spikes (there were ~105). Ends now run straight into their junction, and a new automatic check confirms the whole map before release: this build has zero spikes, zero crossovers, zero roads on water, and only 9 tiny unavoidable gaps (down from ~2,000 in the raw capture). Duplicates removed and the game's organic curves preserved." },
    ],
  },
  {
    version: "0.9.1378",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Fixed the spiky road junctions (e.g. around Olbia-Sardinia).** When closing gaps, road ends were sometimes extended backwards past a town, making a spike. Ends now only extend forward along the road's direction, so junctions read cleanly. Duplicates removed and connectivity preserved as before." },
    ],
  },
  {
    version: "0.9.1377",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Removed the remaining duplicated roads.** Where the capture left two lines tracing the same route, the redundant one is now removed (~1,700 across the map), keeping the game's organic curves intact. Every removal is verified — if it would leave a settlement, port or junction without a road it's undone, so nothing disconnects. Roads still meet cleanly at junctions with no crossovers." },
    ],
  },
  {
    version: "0.9.1376",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Road gaps closed while keeping the game's real curves.** Roads use the game's actual captured geometry (organic, uneven curves — unchanged), and only the fragmented piece-ends are now snapped together at junctions and settlements, so roads connect properly instead of stopping just short of each other. ~8,000 loose ends joined, no crossovers introduced, curve shapes untouched." },
      { type: "fix", text: "**Roads show without Live mode.** The whole baked network draws by default; Live mode only narrows it to a loaded save's built roads." },
    ],
  },
  {
    version: "0.9.1375",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Reverted roads to the game's actual captured render.** The rebuilt-from-network version looked too geometric (straight runs and perfectly even curves) — nothing like the game's organic roads. Roads are back to the captured in-game geometry with its natural, uneven curves." },
    ],
  },
  {
    version: "0.9.1374",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**The game's full road network now shows by default — no Live mode needed.** Previously roads were filtered to a loaded save's built roads, so without Live mode connected they looked incomplete. The whole baked road network (the game's own roads) now draws by default; Live mode only narrows it to a specific save's built roads when you connect one." },
      { type: "improvement", text: "**Roads now render at full detail (no simplification).** Every bend of the game's actual road route is kept — the curves follow the terrain exactly as the game routes them, just smoothed off the pixel grid." },
    ],
  },
  {
    version: "0.9.1373",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Roads rebuilt from the game's real road network so they connect correctly everywhere.** The earlier captured road lines were fragmented — pieces ended just short of each other, leaving gaps and dangling ends that couldn't be patched away. Roads are now built from the game's own road network as one connected graph: every settlement and port is linked exactly as in the game, shared routes merge into one line, junctions join cleanly, roads never cross, and no duplicates. Curves are organic (following the terrain) though very slightly smoother than the raw capture — the trade-off for connections that are actually correct." },
    ],
  },
  {
    version: "0.9.1372",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Parallel roads merged into Y-branches without losing any connections.** The previous attempt trimmed too eagerly and left roads disconnected. This version only merges two roads that genuinely leave the same junction together, and every trim is verified afterwards — if it would drop a road from any settlement, port or junction, it's undone. Result: parallel double-lines become a single trunk that forks (like the game), exact duplicate lines removed, and zero roads lost (verified map-wide: 0 lost connections, 0 crossovers)." },
    ],
  },
  {
    version: "0.9.1371",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Parallel/duplicate roads cleaned up without losing any roads.** Two roads leaving the same junction toward different towns were captured as separate lines running side by side; they're now merged into a single trunk that splits into a Y where they diverge — exactly like the game. Exact duplicate lines are removed outright. Crucially, every settlement's and port's road is protected, so nothing gets disconnected (the previous attempt over-trimmed and left roads missing — this one is verified connected map-wide)." },
    ],
  },
  {
    version: "0.9.1370",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Removed duplicated / parallel road lines.** Where the game's capture had split a shared road corridor into overlapping pieces, they drew as double lines (e.g. across southern Sardinia). Overlapping duplicates are now collapsed to a single line per corridor, while the last road into every settlement and port is protected so nothing gets disconnected. ~1,600 duplicate pieces removed, connectivity verified map-wide." },
    ],
  },
  {
    version: "0.9.1369",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Reverted roads and sea lanes to the earlier, better-looking version.** The recent re-scan of the game changed how roads and sea lanes were built and made both look worse — roads lost detail and sea lanes changed character. Both are now back to the version from a few updates ago that looked right." },
    ],
  },
  {
    version: "0.9.1368",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Road detail restored.** The previous build smoothed roads so much they lost their character. Roads now keep the genuine bends of their route (following terrain) while still being clean curves — the staircase from the underlying tile grid is removed, but real corners are preserved. Junctions stay connected and roads still never cross." },
      { type: "fix", text: "**Roads to port cities now show (e.g. Uselis ⇄ Neapolis-Sardinia).** Port settlements are connected into the road network by the game even without a hinterland-roads building, so Provincia now shows those links too. Fixes roads that were missing between coastal cities." },
    ],
  },
  {
    version: "0.9.1367",
    date: "2026-07-23",
    items: [
      { type: "fix", text: "**Road junctions and crossovers now match the game exactly.** Roads are rebuilt from the game's own road network as a single connected graph: where two roads share a route they merge onto one line, and they only ever meet at junctions — they never cross over each other, exactly like the game. This fixes the disconnected 4-way junctions and the X-shaped crossovers in southern Sardinia (and everywhere else). Verified map-wide: zero crossovers, zero dead-ends — every road runs junction-to-junction or into a settlement/port — and the curves stay smooth and organic." },
    ],
  },
  {
    version: "0.9.1366",
    date: "2026-07-22",
    items: [
      { type: "feature", text: "**Sea lanes now use the game's own routes.** Trade Lanes previously reconstructed sea routes with a pathfinder; it now draws the game's actual sea-route network — the same coastal shipping lanes the game itself renders — so they match exactly, hugging every coast from the Atlantic to the Red Sea. 267 routes, every point on navigable water." },
      { type: "improvement", text: "**Roads refreshed from a new capture** that also records the game's own road-connection links. The road network is unchanged visually (still validated end-to-end: every road reaches a settlement, port or junction; nothing on water) — this just re-bakes from the latest, most complete capture." },
    ],
  },
  {
    version: "0.9.1365",
    date: "2026-07-22",
    items: [
      { type: "fix", text: "**Cleaned up messy junctions around Uselis ⇄ Caralis and Neapolis-Sardinia ⇄ Sulci.** Where a road end needed joining to the network, the whole road tip was being dragged sideways, painting a straight diagonal across terrain. Road geometry is now left untouched — instead a short smooth connector curve is added from the road's own direction into the junction or settlement, so joins read as natural forks. Also, when connecting an end, the nearest target of ANY kind now wins (a road passing right beside beats a settlement further away), which is what created the stray diagonals in the first place." },
    ],
  },
  {
    version: "0.9.1364",
    date: "2026-07-22",
    items: [
      { type: "fix", text: "**Roads now show per LINK, exactly like the game — fixes Friniatia, Vennonia-Caluconia, Turonia, Anagnutia showing no roads and the Cavaria–Vocontia / Caturigia–Vocontia connections.** The game draws a road per settlement-to-settlement link: if either settlement has roads, the whole link is drawn, even where it crosses provinces without roads. Provincia was deciding per road piece from the province it happened to lie in, hiding the middle of exactly those cross-province links. Every road piece is now tagged with the actual link(s) it belongs to — traced settlement-to-settlement through the road network — and shown by the game's own rule." },
      { type: "fix", text: "**No more half-drawn roads:** if a visible road continues into a piece the filter would have hidden, the continuation is shown too — a drawn road always runs settlement to settlement, never stopping mid-field." },
      { type: "fix", text: "**The pre-release check now also verifies the filtered view** — it simulates what you'll actually see at campaign start and confirms every province with roads shows them at its settlement and no visible road dangles. This build: zero issues, map-wide." },
    ],
  },
  {
    version: "0.9.1363",
    date: "2026-07-22",
    items: [
      { type: "fix", text: "**Every road end now terminates at a settlement, port or junction — enforced as a hard rule.** Roads that stopped a pixel or two short of their settlement (Rome–Praeneste, Gabalium, the Cavaria–Vocontia road, Genava and ~1,500 more ends map-wide) are now extended to their destination: ends near a settlement or port snap onto it, ends near another road join it as a T-junction. Nothing is deleted — an earlier cleanup that removed a 'sliver' turned out to be Syracuse's only port road; that can't happen anymore." },
      { type: "fix", text: "**The pre-release check now verifies this rule across the whole map** — every road end must reach a settlement, port or junction, every settlement keeps its game connections, and nothing sits on water. This build: zero issues." },
    ],
  },
  {
    version: "0.9.1362",
    date: "2026-07-22",
    items: [
      { type: "fix", text: "**Restored missing roads at Velzna, Arpi, around Olbia-Sardinia, Praeneste–Rome and ~30 more places.** The water test used to decide \"this road is in the sea\" was matching some regions' map colours (Velzna's and Arpi's among them), silently deleting every road that touched them. Water is now identified exactly, and none of those roads are lost." },
      { type: "fix", text: "**Every road connection is now machine-verified before release.** A new validation pass checks the entire map: every settlement and harbour that has roads in the game keeps them, no road end is left hanging that the game has connected, no leftover slivers, nothing on water. This build passes with zero issues — and the check runs on every future road data update, so this class of bug can't slip through again." },
    ],
  },
  {
    version: "0.9.1361",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Y-junctions rebuilt properly this time.** The previous junction merging averaged nearby road endpoints together, which could yank a road's end away from its natural course — producing spikes and crooked forks (visible at Pluvium among others). Joining is now done the way the game's data intends: only road ends that continue one another (the two halves of the same road meeting at a province border) are joined, settlement and junction anchor points are left exactly where the game puts them, and every correction is blended smoothly along the road instead of kinking the tip. Verified against the game at Pluvium, Olbia, Caralis and spot-checked across Italy and Greece before release." },
    ],
  },
  {
    version: "0.9.1360",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Road junctions now form clean Y-forks instead of tiny triangles.** The game's road data contains tiny 1–2 pixel connector pieces between junction points — invisible under the game's thick road texture, but Provincia's fine lines drew them as small triangles. Those connectors are now merged into a single junction point. Dead-end stubs (settlement and harbour links) are untouched." },
    ],
  },
  {
    version: "0.9.1359",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Fixed missing road halves.** The game splits every road at the province border, and a road from a province with roads into one without is still drawn in full by the game — but Provincia was hiding the half lying in the roadless province. Roads are now filtered per link (drawn if either side has roads, exactly the game's rule), so roads run their full length again." },
      { type: "fix", text: "**Cleaned up tangled road clusters (southern Sardinia and elsewhere).** Neighbouring provinces each store their own copy of shared border roads, and drawing both near-identical copies as fine lines produced a tangled look. Same-route copies are now merged (275 across the map) while genuinely distinct alternative roads — like the route through a settlement versus around it — are kept." },
    ],
  },
  {
    version: "0.9.1358",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Fixed remaining road loops and dots.** Two causes: (1) very short roads (like a settlement's harbour link) could have both ends pulled into the same junction, turning them into small circles — junction merging now never collapses a road onto itself; (2) roads the game draws along land strips too narrow to exist at map resolution (e.g. coastal spits) were being squashed onto a single shore pixel — those are now omitted, since that water shows as blue in Provincia and roads never sit on blue." },
      { type: "fix", text: "**Restored roads that run through settlements (e.g. Olbia-Sardinia) and minor spurs (e.g. up to Pluvium).** The previous version's duplicate-removal was too aggressive: when two road pieces connected the same two junctions by different routes, it kept only the shorter one — but those are often two real roads (one through the settlement, one around it). Every road piece the game draws is now drawn." },
    ],
  },
  {
    version: "0.9.1357",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Fixed looping/tangled roads (e.g. Caralis ⇄ Neapolis-Sardinia).** The game stores some road links twice, along two slightly different routes; drawn together the pair made a loop or hook. Provincia now keeps only the single most-direct route for each connection, so roads read as one clean line between settlements. Removed ~750 duplicate route pieces across the map." },
    ],
  },
  {
    version: "0.9.1356",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Roads no longer cut off between regions.** The game builds each road as separate per-region pieces that meet at the province border, and those pieces stopped a pixel or two short of each other — invisible in-game under the thick road texture, but showing as a gap in Provincia's fine lines (e.g. the road from Uelis to Caralis). Road pieces that meet at a junction are now snapped together, so roads run unbroken from settlement to settlement." },
    ],
  },
  {
    version: "0.9.1355",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Settlement→port roads now show for every port, even where no roads are built.** A settlement with a harbour always has a short road down to its port — but these were being hidden in regions that had a port yet no built roads (e.g. Baliares_Maiores). Port connectors now draw wherever the region has a port, matching the game." },
    ],
  },
  {
    version: "0.9.1354",
    date: "2026-07-21",
    items: [
      { type: "improvement", text: "**Roads now cover every province, using the game's actual drawn curves.** The road network is no longer limited to the regions that happened to be captured — it now spans the whole map, from Iberia to the Near East and every island, with each road following the exact organic curve the game draws. Roads draw only where the loaded game actually has roads, so what you see matches your campaign. Single clean lines throughout, always on land." },
    ],
  },
  {
    version: "0.9.1353",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Fixed the doubled/parallel road lines.** Where the game's captured road ran alongside a reproduced fallback road, both were being drawn, showing as two parallel lines. The fallback is now suppressed wherever it overlaps a captured road, so each road draws once." },
    ],
  },
  {
    version: "0.9.1352",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Roads now use the game's actual drawn curve — read directly, not reproduced.** Instead of trying to recompute the game's road shape (which kept coming out stair-stepped or wobbly), Provincia now uses the road geometry the game itself draws, so the curves are exactly the game's organic flowing lines. Regions that couldn't be captured fall back to the smooth reproduction so nothing is missing." },
      { type: "fix", text: "**Roads can no longer sit on sea.** Every road point is now guaranteed to be on land — any point that would fall on a water pixel is pulled back to the nearest land. No more roads crossing into the blue." },
    ],
  },
  {
    version: "0.9.1351",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Roads now flow organically instead of hugging the tile grid.** The road routes were correct, but they were pinned to the square tile grid, so they came out stair-stepped/squarish — and a per-step jitter made them look wobbly rather than curved. Roads are now relaxed off the grid into a smooth flowing line and drawn as a continuous dirt road, so they curve naturally like the game's, not like a modern highway. Also fixed roads that strayed into the sea near the coast — stray points are pulled back onto land." },
    ],
  },
  {
    version: "0.9.1350",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Roads now draw as a solid dirt line, like the game — which finally makes the curve visible.** They were drawn dashed, and a dashed line chops a gentle curve into short straight ticks, so the road read as straight no matter how accurate the underlying path was. Roads are now a solid continuous line (tan with a subtle darker casing), so the exact route — the meander, the forks, the in-and-out — actually shows. Sea lanes stay dashed." },
    ],
  },
  {
    version: "0.9.1349",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**The exact road curve now actually shows — the previous update was being masked by a stale cache.** v0.9.1348 computed the game's real curved roads but the road cache key hadn't changed, so the app kept serving the older straight version. The cache key now busts correctly (and is tied to the road data so this can't recur), so the game-exact curving/meander is what you'll see." },
    ],
  },
  {
    version: "0.9.1348",
    date: "2026-07-21",
    items: [
      { type: "feature", text: "**Roads now render with the game's exact curve — including its natural wiggle.** Rather than approximating, this reproduces the game's own road-drawing spline exactly: a cubic Bézier through the road's tiles, with each point's direction set the way the game sets it — including the small, deterministic bend the game applies at every step (seeded from the terrain, so it never flickers and matches run to run). That's why even straight stretches gently meander, exactly as in-game. The result stays on land where the game's roads are, and no longer runs ruler-straight." },
    ],
  },
  {
    version: "0.9.1347",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Reverted the road \"wiggle\" — it was pushing coastal roads into the sea.** The previous version nudged roads sideways to look hand-drawn, but that displacement ignored the coastline and shoved near-shore roads into the water, and looked worse overall. Roads now draw the captured in-game course faithfully with only corner-rounding, so they stay on land exactly where the game puts them." },
    ],
  },
  {
    version: "0.9.1346",
    date: "2026-07-21",
    items: [
      { type: "improvement", text: "**Exact roads now generalize to any Rome Remastered map, not just RIS.** The exact-road system was reworked to hold multiple maps' real road networks and match whichever map you have loaded automatically (by a map fingerprint), so additional maps/mods can be supported with their true in-game road layout. Any map without an exact network still uses the computed router." },
    ],
  },
  {
    version: "0.9.1345",
    date: "2026-07-21",
    items: [
      { type: "improvement", text: "**Roads now wiggle like the game's, not just at the bends.** The captured network gives each road's true course, but the game draws its roads as an organic, gently-meandering line even along straight open stretches. Roads now render with that same subtle wiggle (deterministic, so it never flickers, and tapered to stay pinned at settlements and junctions), so a long straight run reads like a real road instead of a ruler line." },
    ],
  },
  {
    version: "0.9.1344",
    date: "2026-07-21",
    items: [
      { type: "feature", text: "**Roads on the RIS grand campaign now match the game exactly.** Instead of computing an approximation of where roads run, Provincia now uses the game's own complete road network — every road across the whole map, exactly as the game itself lays them (the Y-forks, the coastal detours, the junctions, all of it). Trade Lanes on this map is now pixel-for-pixel the game's road layout. Other maps continue to use the computed router." },
    ],
  },
  {
    version: "0.9.1343",
    date: "2026-07-20",
    items: [
      { type: "fix", text: "**Roads now use the game's own road-building method.** Deep analysis of the game established exactly how it lays roads: it routes each settlement to each neighbouring settlement (and to its own harbour) along the cheapest path, staying within those two provinces' territory, and every road reuses the existing network where they meet — which is what forms the junctions and forks. Trade Lanes now reproduces that method directly instead of approximating it." },
      { type: "fix", text: "**Terrain is now read correctly — this was the big one.** The map's terrain data had been decoded with an inverted colour table: the shades that are actually shallow/deep sea were being treated as mountains, and the commonest inland type was mislabelled. Roads were therefore avoiding and following the wrong ground. Terrain is now identified from the game's own definitive table (fertile land, wilderness, hills, mountains, forest, swamp, sea depths, beach), so roads thread the passable ground and bend around real mountains and forest the way the game does." },
      { type: "improvement", text: "**Geography overlay labels fixed too.** The same terrain-table correction fixes the Geography map mode and hover tooltips, which previously mislabelled sea as mountains and vice-versa." },
    ],
  },
  {
    version: "0.9.1342",
    date: "2026-07-20",
    items: [
      { type: "fix", text: "**Road links now run settlement-to-settlement, like the game — the missing Y-fork is back.** Verified against the campaign-start map: a settlement with roads sends its road ALL THE WAY to each neighbouring settlement, even across a province that has no roads of its own. Previously the drawn road was cut at the roadless province's border, which removed exactly the fork the game shows on Sardinia (the west road splitting toward Pluvium and toward Olbia). Two roadless neighbours still get no link between them." },
      { type: "fix", text: "**Harbour roads follow the port building, not the roads building.** A settlement that has built a port gets its settlement→harbour road even with no roads built (this is how the game lays them — e.g. Sardinia's inland town at campaign start has only a port, and its long harbour road across the island is drawn). Port roads were previously gated on the roads building." },
      { type: "fix", text: "**Compatible with today's mod update's re-compressed map files.** The mod's latest update re-saved its campaign map images in a compressed format; one internal reader still assumed the uncompressed layout and silently mis-read the map. All map readers now handle both formats." },
    ],
  },
  {
    version: "0.9.1341",
    date: "2026-07-20",
    items: [
      { type: "fix", text: "**Roads built during your campaign now show.** Which provinces have roads was read from the campaign's STARTING setup, so any province that built its roads during play showed nothing — on Sardinia this cut away the entire northern Y-fork (the junction where the road splits toward Pluvium and Olbia) even though the game draws it. With a save loaded, road-having provinces now come from the save's own building lists, so the network matches what you actually built." },
      { type: "improvement", text: "**Roads draw as soft curves, like the game.** The drawn line now rounds every corner of the routed course (the course itself is unchanged), so roads meander organically instead of stepping in right angles. The hover highlight follows the same curve." },
    ],
  },
  {
    version: "0.9.1340",
    date: "2026-07-20",
    items: [
      { type: "fix", text: "**Harbour roads now draw for every port, not only trading ports.** A settlement's road to its harbour previously only appeared when a sea lane was actively using that port, so e.g. Sardinia's long road from the inland town across to its east-coast harbour never showed. Harbour roads now come from the map's port markers directly — every province with roads and a port shows the road to it, exactly as the game draws them." },
      { type: "improvement", text: "**Roads now read the height map.** Road routing folds elevation into its terrain costs — steep ground is more expensive, so roads prefer valley floors and passes over hill shoulders. Captured road courses (like Sardinia's) are unaffected; this refines routes everywhere else." },
    ],
  },
  {
    version: "0.9.1339",
    date: "2026-07-20",
    items: [
      { type: "feature", text: "**Sardinia roads now follow the game's actual road course.** The island's road layout — the long west road that runs north out of Cornus before turning inland, the three-way junction in the middle of the island, and the harbour road crossing to the east coast — was captured from the campaign map itself and georeferenced to map coordinates. Trade Lanes routes on Sardinia now follow that real course wherever it is known, instead of a computed best-guess path." },
      { type: "improvement", text: "**Harbour roads follow terrain and the road network.** The settlement→harbour connector is now routed like every other road — winding around hills and forest and merging onto existing roads — instead of being drawn as a straight line. An inland town's road to a far-coast harbour now crosses the island along the actual road course, like the game." },
    ],
  },
  {
    version: "0.9.1338",
    date: "2026-07-19",
    items: [
      { type: "feature", text: "**Roads are now one shared network, like the game.** Instead of drawing an independent straight road for every pair of towns, roads build a connected network — the shortest links form the backbone first and longer routes merge onto it, following the shared spine and reaching towns through junctions. This reproduces the game's road layout (routes that run along a backbone rather than cutting straight across) instead of a fan of separate direct lines." },
    ],
  },
  {
    version: "0.9.1337",
    date: "2026-07-19",
    items: [
      { type: "change", text: "**Roads use the game's exact terrain movement costs.** After deep analysis of the game's own data, road routing now uses the exact per-terrain costs from the game (grassland 10, forest 13, hills 14, mountains 15/20, beach 14, marsh 20, dense forest + high mountains impassable), producing the cheapest land route between settlements." },
    ],
  },
  {
    version: "0.9.1336",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads now thread the open grassland and detour around forest like the game.** Road placement now avoids woodland, hills and rough ground much more strongly, so a route will swing north up an open corridor and come across the top rather than cutting straight through a forest — matching how the game lays its roads out." },
    ],
  },
  {
    version: "0.9.1335",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads now wind through open ground around forest and hills, like the game.** Instead of a straight (or over-smoothed) line, the route is the raw per-pixel cheapest path — but road placement now treats woodland, hills and rough terrain as strong obstacles, so the road threads the open grassland and weaves around each wooded patch the way the game draws it." },
    ],
  },
  {
    version: "0.9.1334",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads are now drawn as smooth, winding curves instead of straight lines.** Each route is laid out as a flowing spline through waypoints, so roads sweep and bend the way the game draws them rather than reading as a dead-straight bird's-eye path." },
    ],
  },
  {
    version: "0.9.1333",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Sea lanes now respect water depth.** Shallow coastal water is cheapest, medium (deep) sea costs more, and the deepest open ocean is impassable — so trade lanes hug the coastline and thread between shallows instead of striking straight across the open sea, matching how the game routes them." },
    ],
  },
  {
    version: "0.9.1332",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads now follow the inland route the game draws, not the coast.** I recovered the game's exact terrain-type ordering: fertile grassland is the cheapest ground (so roads follow the interior), while beach and marsh are costly (roads stay off the coast and out of swamp), and high mountains and dense forest are impassable (routed around). Roads now curve through the fertile heart of the land the way the game places them." },
    ],
  },
  {
    version: "0.9.1331",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads now use the game's exact terrain movement costs.** The per-terrain costs are taken verbatim from the game's own cost table (grassland 10, hills 13, forest 13–14, low mountains 15, high mountains 20, marsh 8, beach 4.5), so roads weave through the landscape exactly as the game weights it — all land passable, sea excluded." },
    ],
  },
  {
    version: "0.9.1330",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads curve through the terrain again, without hugging the coast.** They now weave along the easier ground (plains and grassland), bend around forest and hills, and route around impassable high mountains — restoring the game-like curves that the previous straight-line version lost, while keeping them off the coastline." },
    ],
  },
  {
    version: "0.9.1329",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads now take the direct route the game draws.** They previously detoured along the coast and around terrain because they were weighted by movement cost; the game's road network instead connects settlements by the shortest path over passable land, only routing around genuinely impassable ground (sea and high mountains). Roads now do the same — straighter, inland routes that match the game." },
    ],
  },
  {
    version: "0.9.1328",
    date: "2026-07-19",
    items: [
      { type: "improvement", text: "**Trade Lanes now load from a cache — much faster.** The sea-lane and road geometry is cached (in memory for instant map-mode switching, and on disk so it stays fast across restarts). The cache rebuilds automatically whenever the mod or game data changes, so it's always up to date." },
    ],
  },
  {
    version: "0.9.1327",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads now follow terrain the way the game does.** The previous version biased routes downhill, sending some roads the wrong way. Roads now weight terrain by how rough/broken the ground is (symmetrically, using the exact per-terrain move costs and the roughness factor the game uses), so they thread smooth valleys and coastlines and bend around rugged ground without the downhill bias." },
    ],
  },
  {
    version: "0.9.1326",
    date: "2026-07-19",
    items: [
      { type: "improvement", text: "**Roads now follow the terrain instead of drawing straight lines.** Land routes are traced at full map resolution and weighted by elevation, so they bend around hills and thread along valleys and coasts the way the game's roads do — using the mod's own height data." },
    ],
  },
  {
    version: "0.9.1325",
    date: "2026-07-19",
    items: [
      { type: "feature", text: "**Trade Lanes now show money.** Hovering a sea lane lists the goods AND the denarii each direction earns, plus a lane total. The sidebar list is now ranked by value (most valuable trades first) and shows each lane's denarii." },
      { type: "feature", text: "**Roads are hoverable too.** Hovering a land road highlights it and shows the goods and denarii of the land trade between those two provinces — same inspector as sea lanes." },
    ],
  },
  {
    version: "0.9.1324",
    date: "2026-07-19",
    items: [
      { type: "change", text: "**Trade Lanes: all lines now drawn at a uniform thickness** — line width no longer scales with trade volume, so the map reads more cleanly." },
      { type: "feature", text: "**Hover a sea lane to see its cargo.** Moving the cursor over a trade lane highlights it and shows a tooltip listing the goods carried each way and their quantities (e.g. Caralis → Hippo Diarrhytus: copper ×2, grain ×2, olive oil ×2)." },
    ],
  },
  {
    version: "0.9.1323",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Trade Lanes: roads now clip at province borders.** When a province with roads borders one without, its road is drawn up to the shared border and stops — the road-less province shows nothing inside its own borders, instead of the whole connecting segment vanishing. Each road is clipped to exactly the road-having provinces it passes through." },
    ],
  },
  {
    version: "0.9.1322",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Trade Lanes: roads now only appear for settlements that actually have roads built.** Provinces with no road (e.g. Pluvium at campaign start) no longer show a road segment running through them — a land route is drawn only where both settlements it connects have roads, matching the game." },
      { type: "fix", text: "**Trade Lanes: every sea route audited and corrected — all 225 now draw.** Routes through narrow straits (Gibraltar, the Dardanelles, the Kerch strait, the Gulf of Corinth) that previously didn't appear now cross correctly, and small port-cities like Piraeus dock at their own harbour instead of a neighbour's. Verified end-to-end: no missing lanes, none over land, none docking at the wrong port." },
    ],
  },
  {
    version: "0.9.1321",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Trade Lanes: sea routes now reach ports tucked in tight coastal pockets.** Some ports sit in a bay so narrow the router couldn't thread a path to the exact port cell, so the lane silently didn't draw (e.g. Caralis→Hippo Diarrhytus). Those lanes now route from the nearest open water while still drawing to the port marker — recovering 11 more sea lanes. Lanes that already drew are unchanged." },
    ],
  },
  {
    version: "0.9.1320",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Trade Lanes: sea routes now dock at each settlement's OWN port.** On crowded coastlines (Sardinia, southern Italy, the Aegean, North Africa) a lane was snapping to whichever port marker sat physically closest — often a neighbouring town's — which left the settlement's real port with no line drawn from it (e.g. Uselis/Iliensia showed no route to Rome even though the route existed). Each port marker is now matched to the town it belongs to, so 34 regions that were docking at a neighbour's port draw correctly from their own." },
    ],
  },
  {
    version: "0.9.1319",
    date: "2026-07-18",
    items: [
      { type: "feature", text: "**Trade Lanes now uses your live save's actual trade network.** With a save loaded, the overlay draws the real sea routes the game derived for that campaign (every port's actual trade partners) instead of the campaign-start estimate — so routes the start-of-game model didn't pick, like a Sardinian port trading with Rome, now appear. With no save loaded it still shows the campaign-start network." },
    ],
  },
  {
    version: "0.9.1318",
    date: "2026-07-18",
    items: [
      { type: "improvement", text: "**Sea lanes route at full map resolution now, so more of them connect.** The pathfinder was working on a half-resolution water map that pinched narrow straits and small bays shut, stranding island and coastal routes; it now uses the full map (kept fast with reusable pathfinding memory), so noticeably more lanes draw. Also logs each region's port binding for diagnosing any that still don't." },
    ],
  },
  {
    version: "0.9.1317",
    date: "2026-07-18",
    items: [
      { type: "improvement", text: "**Better diagnostics for missing sea lanes.** When a lane doesn't draw, the log now names the two settlements and the exact reason (no port found and how far the nearest one was, port on an enclosed bay, or no water route), so a missing connection can be pinned down instead of guessed at." },
    ],
  },
  {
    version: "0.9.1316",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**The straight lines cutting across land are gone.** A sea lane now only draws once its actual water route is computed — the temporary straight-across placeholder (drawn city-to-city while a route was still calculating or when none could be found) has been removed, so nothing is ever shown crossing land." },
    ],
  },
  {
    version: "0.9.1315",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Sea lanes no longer cross land (Sardinia, etc.).** The water map was treating any unrecognised map colour as sea, so lanes could path straight through a land region that wasn't in the loaded set. It now classifies water by the actual sea colour, and draws each route point at the cell centre so lanes sit cleanly on the water rather than a pixel onto the shore." },
    ],
  },
  {
    version: "0.9.1314",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Sea lanes no longer clip across land corners, and more coastal towns get their lane.** Diagonal steps that sliced across the tip of a headland (a route appearing to cross land near coasts, e.g. by Carthage) are blocked, and the port-matching reach is wider so settlements whose port tile sits a bit further off — like Uselis on Sardinia connecting to Rome — now draw their sea lane." },
    ],
  },
  {
    version: "0.9.1313",
    date: "2026-07-18",
    items: [
      { type: "improvement", text: "**Land roads now use the game's exact terrain movement costs.** Roads route on the same least-cost land paths the game does — coast and open ground cheap, forest and hills dearer, mountains dearest (about 4× the cost of flat ground, not an exaggerated wall) — so they curve through passes and along valleys the way the in-game roads do." },
    ],
  },
  {
    version: "0.9.1312",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Sea lanes dock at the ports again.** The previous change to route over the game's navigation map made some lanes stop reaching their ports; reverted that routing while keeping the port-to-port docking, so lanes connect to the port markers as before." },
    ],
  },
  {
    version: "0.9.1311",
    date: "2026-07-18",
    items: [
      { type: "improvement", text: "**Sea lanes now route over the game's own sea-navigation map.** Instead of treating every blue pixel as open water, lanes follow the actual navigable channels the game uses, so they hug the coasts and thread the straits the same way rather than cutting across open sea." },
    ],
  },
  {
    version: "0.9.1310",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Sea lanes now dock at the actual ports, not the city centres.** Each region's port is read straight from the map (the port markers), and every sea lane runs port-to-port, with a short road from the settlement out to its own port — so lanes no longer terminate on inland city markers. Regions with no nearby port don't get a sea lane." },
    ],
  },
  {
    version: "0.9.1309",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Sea lanes stay in the water and roads stay on land.** The water/land maps were counting a coastal cell as both, so some sea lanes cut across peninsulas and a few roads strayed into the sea. Each now uses the cell's centre, so lanes hug the coast and roads keep to land. A sea lane that genuinely can't be routed over water is now hidden rather than drawn straight across an island, and only truly coastal settlements get a line to a port." },
    ],
  },
  {
    version: "0.9.1308",
    date: "2026-07-18",
    items: [
      { type: "improvement", text: "**Trade routes now read like the game: settlement → road → port → sea lane → port → road → settlement.** Sea lanes connect port to port over the water, and land trade follows roads that thread through valleys and passes (avoiding mountains) between neighbouring settlements — plus a short road links each coastal settlement to its own port. Sea lanes are dashed light, roads dashed brown. Everything routes in the background when you open the mode." },
    ],
  },
  {
    version: "0.9.1307",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Sea lanes no longer cut straight across land.** Some lanes were skipping their ports because the water route couldn't be traced through a narrow strait or a tight bay; the sea map now keeps those channels open, and any lane that still can't find a full water route at least leaves each settlement through its coast instead of drawing a straight line over land." },
    ],
  },
  {
    version: "0.9.1306",
    date: "2026-07-18",
    items: [
      { type: "improvement", text: "**Sea lanes now follow the actual sea.** Instead of straight arcs, each lane is routed around the coastlines and between the islands — pathfinding over the water from port to port — and drawn as a dashed line like the in-game trade routes. Routes compute in the background the first moment you open the mode; a lane shows a light arc until its exact route is ready." },
    ],
  },
  {
    version: "0.9.1305",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Trade Lanes mode no longer stutters when panning.** It was rebuilding the whole lane-anchor map on every frame; that's now computed once and reused." },
    ],
  },
  {
    version: "0.9.1304",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Trade lanes now actually connect to the settlements.** The previous attempt mirrored the settlement positions vertically (a coordinate flip that shouldn't have been there), so lanes ran to the wrong points. Endpoints now sit on the settlement/port tiles." },
    ],
  },
  {
    version: "0.9.1303",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Geography, Terrain and Heights now read their map directly from the mod folder.** Instead of relying on a copy the importer was supposed to make into the app's data (which could be missing), all three now load map_ground_types.tga / map_heights.tga straight from your mod's world/maps/base — always current, no re-import needed. Geography should now paint real per-tile terrain (forest, hills, mountains…) instead of a flat colour per province." },
    ],
  },
  {
    version: "0.9.1302",
    date: "2026-07-18",
    items: [
      { type: "improvement", text: "**Trade Lanes now curve and connect to settlements.** Lanes anchor at each region's settlement/port tile (not the province centre) and draw as gentle arcs instead of straight lines — closer to how the game renders sea routes." },
    ],
  },
  {
    version: "0.9.1301",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Geography mode and the Terrain & Heights overlays work again on imported mods.** The folder importer had stopped copying map_ground_types.tga and map_heights.tga into the slot, so all three silently fell back to nothing (Geography just showed each region in a flat colour). The importer now brings both files along again — this self-heals on your next launch (the startup mod re-read re-imports them); if it doesn't, hit 🔄 Reload or re-import the mod folder once." },
    ],
  },
  {
    version: "0.9.1300",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Trade Lanes are no longer pixelated.** The lanes were baked into the map image and upscaled with smoothing off, so they looked blocky. They're now drawn as true vector lines on top of the map — crisp at every zoom." },
      { type: "feature", text: "**Trade Lanes sidebar is now a lane inspector.** Every sea lane is listed ranked by trade flow; click one to highlight it (bright cyan) and its two ports on the map. Click again to clear." },
    ],
  },
  {
    version: "0.9.1299",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Build-Order Optimizer (🧰 Tools).** Select a settlement, and it ranks every structure you could build there by payback time — construction cost divided by the extra income per turn it would add (computed from the same decoded economy model as the income maps). Fastest-paying builds first; walls/happiness/recruitment-only buildings are flagged as non-income at the bottom. A toggle switches between the one settlement and the whole faction." },
    ],
  },
  {
    version: "0.9.1298",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Campaign Autopsy (🧰 Tools).** Point it at a scanned saves timeline and get a post-mortem: each faction's settlement/treasury/army arc over the campaign, when they peaked, when they started declining, when they were wiped out, and who won — with a sparkline and verdict badge per faction." },
      { type: "improvement", text: "**Unrest map mode: pick a faction, see its provinces.** The sidebar now starts as a faction picker (worst revolt risk first); selecting one lists that faction's provinces with their public order, worst first — click to highlight, double-click to jump. Use '‹ all factions' to go back." },
    ],
  },
  {
    version: "0.9.1297",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Trait Explorer (🧰 Tools).** Browse every character trait in the mod: filter by effect (tax, law, command, trading…), see each trait's levels, thresholds, and effects (color-coded + / −), and — with a save loaded — who currently carries each trait, grouped by faction." },
    ],
  },
  {
    version: "0.9.1296",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Trade Lanes map mode (Economy).** The decoded sea-trade network drawn on the map: every lane as a golden line between its two regions, thickness and brightness = trade flow, over a dimmed map. The last of the player map-mode series — nine modes total." },
    ],
  },
  {
    version: "0.9.1295",
    date: "2026-07-17",
    items: [
      { type: "fix", text: "**Unrest mode shows one faction at a time.** The map stays neutral until you pick a faction in the sidebar list (all factions listed, worst revolt risk first); only the picked faction's settlements color. Click again to deselect." },
    ],
  },
  {
    version: "0.9.1294",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Revolt risk by faction.** The Unrest map mode's sidebar now ranks factions by settlements at revolt risk (public order under 80 — the riot line is 70), worst first. Click a faction to focus the map on just their regions; click again to unfocus." },
    ],
  },
  {
    version: "0.9.1293",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Four model-powered map modes: Unrest, Income, Corruption, Growth.** *Unrest* (Government) colors every settlement by public-order risk, green stable → red riot line. In Economy: *Income* shows each settlement's real modeled net income in denarii, *Corruption* shows exactly where distance-to-capital corruption bleeds money, and *Growth* shows squalor-aware population growth — declining red, booming green. All four come from the decoded economy/growth/PO models (campaign-start values); the first activation computes every faction (a minute or two) and is then cached." },
    ],
  },
  {
    version: "0.9.1292",
    date: "2026-07-17",
    items: [
      { type: "fix", text: "**Mining 'Current' list tightened** — only settlements with a mine built AND earning appear (settlements whose income came from governor-building mining bonuses without an actual mine no longer slip in). Note: the first version of this filter shipped in 0.9.1291 — if Current looks unfiltered, restart the app to pick up the update." },
    ],
  },
  {
    version: "0.9.1291",
    date: "2026-07-17",
    items: [
      { type: "improvement", text: "**Mining mode, refined again per feedback.** The Current view lists only settlements with a mine actually built; clicking a settlement in the sidebar highlights its province on the map and double-clicking jumps you there (same flow as the region search); and hovering a region shows a small tooltip at the cursor with its current + potential mine income — without touching the region info panel." },
    ],
  },
  {
    version: "0.9.1290",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Two more player map modes: Threat and Reach (Military section).** *Threat* — your regions colored by border exposure: green interior, yellow foreign border, orange hostile neighbor, red at-war neighbor (war/hostile read from the loaded save's diplomacy). *Reach* — your regions colored by how far your nearest army is (green = garrisoned, red = 5+ regions away, purple = no land route) — the 'which frontier towns would die alone' view. Both use the selected faction as the perspective, falling back to the live player faction." },
    ],
  },
  {
    version: "0.9.1289",
    date: "2026-07-17",
    items: [
      { type: "improvement", text: "**Mining map mode reworked per feedback.** The sidebar now lists EVERY settlement with mineable deposits (scrollable, sorted by income) with a Current / Potential toggle that also switches what the map colors show — what mines earn today vs what they could earn at best level. The mode no longer injects anything into the region info panel, and the formula note is gone." },
    ],
  },
  {
    version: "0.9.1288",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Two new player map modes (Military section).** *Armies* — regions heat-tinted by force size: blue = the owner's troops, red = a foreign army present, purple = both; hover for unit counts and factions. *War* (live mode) — battles and sieges from the game log glow by recency, so the active front is visible at a glance; hover a region for its recorded events. First two of the player-mode series — more coming." },
    ],
  },
  {
    version: "0.9.1287",
    date: "2026-07-17",
    items: [
      { type: "improvement", text: "**The Mining map mode got its sidebar.** Legend with the bronze→silver→gold income scale, a 'Richest deposits' top-5 list (✓ = mine already built), and hovering any region now shows its minerals and exact per-level income — no deposits says so." },
    ],
  },
  {
    version: "0.9.1286",
    date: "2026-07-17",
    items: [
      { type: "fix", text: "**The 🧰 Tools menu now opens upward.** It opened downward from the toolbar and ran off the bottom of the screen, hiding the entries. It also scrolls if it ever outgrows the screen." },
    ],
  },
  {
    version: "0.9.1285",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**The 🧰 Tools menu — fifteen new analysis and modding tools in one release.** A new Tools button in the toolbar collects everything below (the Mining map mode joins the Economy map modes). Every panel is crash-isolated: if one misbehaves it shows a notice, never takes down the app." },
      { type: "feature", text: "**Mod safety net:** *Submod Drift* scans a submod folder for stale overrides of the base mod — the exact 'Could not find string' failure a teammate hit this week — and *Mod Lint* checks EDB/EDU/strat/resources for undeclared hidden resources (the fatal boot-crash class), missing units and dead conditions in ~200ms." },
      { type: "feature", text: "**Balance workflow:** *Economy Baseline* snapshots all 239 factions' turn-1 economies and diffs after mod edits; the *What-If Sandbox* applies a hypothetical EDB/EDU tweak in a temp shadow copy and shows every faction's economy delta without touching the mod; the *Unit Comparator* puts up to 6 units side by side with cost-effectiveness ratios; the *Recruit Planner* shows what each next building upgrade unlocks in the selected settlement." },
      { type: "feature", text: "**Campaign analysis:** *Compare Saves* diffs two saves (ownership flips, treasury/army deltas, population); the *Timeline Player* animates region ownership turn by turn across a scanned saves folder; the *Battle Ledger* reconstructs every battle from the live game log with per-faction win/loss records; *Victory Progress* tracks each faction's win conditions; the *Diplomacy Heatmap* shows war blocs as a sortable NxN grid; *Population Projection* simulates every settlement's squalor-aware growth N seasons ahead with decline/stall/unrest flags." },
      { type: "feature", text: "**Everyday modding:** *Find Definition* locates any unit/building/region/string across all mod files with file+line and opens your editor there; the mining map mode colors regions bronze→silver→gold by predicted mine income; the region panel's income explainer itemizes where a settlement's tax/farm/mine/trade numbers come from." },
    ],
  },
  {
    version: "0.9.1284",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**The region panel now shows real mining income.** Regions with mineable deposits get a Mining row: the actual per-turn income a mine would earn there, per level, computed with the exact formula the game uses internally (deposit quantities × trade values × the mine's effective strength) — the number the in-game building card can't show. The currently built level is marked, and predictions match live settlement scrolls to the denarius. Appears a few seconds after launch (the first computation runs quietly in the background)." },
      { type: "improvement", text: "**One-line launch diagnostics.** The moment the splash lifts, the log gets a single [boot] line: total time, when each stage finished (map, overlay, building icons, unit cards) and how much was served from the disk cache. If a launch ever feels slow again, that one line is the whole bug report." },
      { type: "improvement", text: "**The icon cache cleans up after itself.** Importing a different mod into a slot now removes the replaced mod's cached icons from disk instead of keeping them forever. (Re-importing the same folder — the reload flow — keeps the cache warm.)" },
      { type: "fix", text: "**\"Clear mod caches\" and factory reset now truly clear the faction-name/culture caches.** A silently swallowed error meant those caches survived every reset since they were introduced, so a mod reload could keep serving stale faction display data until an app restart." },
      { type: "change", text: "**Internals: the launch warm-up logic is consolidated into one scheduler module with its pacing rules under test, and the main-process file slimmed by ~1,000 lines into five focused modules.** No behavior change intended — groundwork that makes future launch work safer." },
    ],
  },
  {
    version: "0.9.1283",
    date: "2026-07-16",
    items: [
      { type: "feature", text: "**Icons are now cached on disk — warm-up becomes near-instant from your second launch.** Every unit card, building icon, and commander portrait used to be re-decoded from the game's TGA/DDS art on every single launch. Decoded images are now saved as PNGs (per source file, auto-invalidated when the mod's file changes) and served directly on later launches: no decoding, no heavy transfers, just reading small files. First launch after this update builds the cache; from the second launch the splash and post-map warm-up should shrink dramatically." },
      { type: "fix", text: "**Fixed the huge hidden cost behind 0.9.1282's slowdown.** The warm-up requests the same card art under many faction keys, and each request shipped its own full copy of the file between processes — at 100,000 requests that was gigabytes of internal traffic. Each unique file now crosses once per batch and all keys share one image. The warm-up cap is gone entirely." },
      { type: "fix", text: "**Ships no longer flash in.** Fleets sit on sea tiles, so their unit cards were missed by the region-based warm-up — all rendered army markers, navies included, are now warmed." },
    ],
  },
  {
    version: "0.9.1282",
    date: "2026-07-16",
    items: [
      { type: "fix", text: "**Zero pop-in, as fast as possible.** 0.9.1281's warm-up still truncated at 20,000 cards on large mods (the log showed it), and the background passes ran deliberately slowly — so cards could pop in for tens of seconds after the map appeared. Three changes: each unique card file is now decoded once ever and shared across all faction keys (most of those 20,000+ were the same art), the cap is effectively gone (100,000), and every post-splash pass now runs at full pipelined speed with no redraw storms. Commander-portrait warming is quicker too. The whole map should be warm within a few seconds of reveal." },
    ],
  },






];

export default CHANGELOG;
