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
    version: "0.9.1444",
    date: "2026-07-25",
    items: [
      { type: "fix", text: "**The parsing-coverage figure was overstating itself, and finding out why recovered 555 real mod bugs.** `feedLine` opens with a speed guard — `if (line[0] !== 'A') return` — under the comment *every interesting line starts \"AI:\"*. That comment stopped being true when `err: ...` lines (failed script commands) became worth reading: the handler sat below the guard, so it never ran once. The coverage tracker had no such guard and happily counted those lines as parsed. **A coverage number that counts lines the analyser discards is worse than no number, because it reads as reassurance.** The handler moved above the guard, and the tracker's rule now mirrors what `feedLine` can actually reach." },
      { type: "feature", text: "**Recovered by the fix: 555 occurrences of `err: no building of this type in settlement` — a script command aimed at a building the settlement does not have.** Reported as a real mod defect rather than discarded as noise. Also newly counted is the complete mission family, all 11 types: the AI issues **8,683 attack-residence and 8,652 siege-residence orders**, so it genuinely does order assaults. Only `move nonlocal` was read before, which meant the orders that matter most were invisible." },
      { type: "improvement", text: "**Coverage of the 4,386,174-line reference log is now 100.0%, with zero unaccounted lines** (from 21.5% at the start of this work, via 47.1% and 84.9%). Every line is one of three things: parsed signal (2,238,783), recognised vocabulary that carries no signal (1,487,465), or a known subsystem family that is deliberately not read line-by-line (659,926) — and the three are reported apart, so \"recognised\" is never quietly passed off as \"understood\". The last tail was closed by naming the un-prefixed engine notes, asset-loading chatter and the file's own header banner." },
      { type: "improvement", text: "**Two guards so the number cannot drift back into fiction.** The first asserts the invariant the whole metric rests on: any line the tracker calls signal must actually change the analyser's output — that is what failed silently before. On the real log the two counters now agree *exactly*, both at 2,238,783. The second replaces a hand-written test fixture with **one verbatim line per pattern, harvested from the 4.4M-line log**; all 30 patterns were confirmed to have a real example, so none is speculative. Hand-typed fixtures encode what the engine is imagined to emit, and that has already cost this project a falsifier that passed while testing nothing." },
    ],
  },

  {
    version: "0.9.1443",
    date: "2026-07-25",
    items: [
      { type: "fix", text: "**Correcting the headline of v0.9.1435 and 1437: the \"16× gap\" was a unit error, and the real figure is 1.21×.** Those releases compared a campaign's required *strength* against the save's *soldier counts* and concluded that only 3 of 125 factions could ever meet a typical requirement. The justification was a single coincidence — a line reading `allocated str 27,183` sitting near Ptolemaic's 28,246 soldiers. It was exactly that, a coincidence. Newly-parsed lines carry the engine's own accounting of the same quantity, and Ptolemaic's army strength is **589,755** against those 28,246 men. Across 124 comparable factions the strength-to-men ratio runs p25 21.8, median 32.7, p75 59.6, with 76% inside 2× of the median: strength is a derived metric roughly 33× a headcount, not a headcount." },
      { type: "improvement", text: "**With both sides in the engine's own unit the picture is different and far more useful.** The median offensive requirement is 23,902 strength; the median faction reports 19,772 *free* strength — a ratio of **1.21×**, with **86 of 223 factions** clearing it. So the requirement is not absurd, it is close to what a typical faction has spare, and **61% falling short is a closable gap** rather than the impossibility the old framing implied. The lead now says so and points at the two levers that would move it. The result carries its unit on its face, and a test asserts headcounts stay about 33× smaller so a future mix-up fails loudly." },
      { type: "feature", text: "**The Lab now reads the AI's own strategic reasoning — parsing coverage went from 21.5% to 47.1% of the log.** A taxonomy of the 3.36M lines it was throwing away found five high-value shapes. It now parses the AI's self-reported army/free/navy strength; its **invade decisions with the reasons it gave** (\"at war, inferior to enemy\" 11,225 times — the most direct evidence there is for why an AI will not attack); its defend postures; what troops it wants to recruit (656,132 lines, the twin of the build-appetite line it already read); and its per-settlement tax choices with reasons (100,169 extortionate, 54,908 low, 3,755 high)." },
      { type: "improvement", text: "One shape was deliberately left alone: `region control: settlement 'X' has changed from 'A' to 'B'`, 40,685 lines. It reads like a conquest record and is not — the values are production-focus enums, not faction names. Checked before building anything on it. The crash reporter's extract grew with the new patterns and was re-measured rather than assumed: 5.88 MB compressed, still inside the attachment ceiling, so nothing is trimmed and the extract remains equivalent to the full log." },
    ],
  },
  {
    version: "0.9.1442",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**Drop a crash report's attachment straight into the AI Movement Lab — it now opens compressed logs itself.** The reporter ships its campaign_ai_log extract as a `.txt.xz`, because that is the only way a 330 MB log fits an attachment. Until now the pipeline stopped one step short of useful: the report arrived, and then somebody had to find a 7-Zip and unpack it before Provincia would look at it. `.gz` and `.xz` are now unpacked automatically — `.gz` with Node's own zlib, `.xz` with the Python runtime Provincia already bundles, since Node has no xz." },
      { type: "improvement", text: "**Verified end to end on the real thing, not in principle.** The reporter was run against the 330 MB reference log to produce a genuine 3.24 MB `.xz` attachment, which was then handed to the Lab: identical `logKind`, turn count, **all 6,399 findings in the same order**, and identical save-verified totals (1,207 never-arrived, 402 unaffordable, 1,140 orphaned), 716 mod-file leads, 37 proven-no-route orders, the same 23,902 median strength requirement and the same +23 independents delta. A 3 MB attachment now yields exactly the analysis the 330 MB original does." },
      { type: "improvement", text: "The unpacked copy goes to a temp file rather than memory (these extracts are ~107 MB decompressed) and is removed however the run ends, including on failure. A corrupt archive is reported as such instead of throwing or handing back junk, and if the bundled Python is missing the message says to extract it manually rather than failing obscurely." },
    ],
  },
  {
    version: "0.9.1441",
    date: "2026-07-25",
    items: [
      { type: "fix", text: "**Hardened yesterday's formations rule against the mistake I nearly made with it a third time.** Chasing the still-unexplained parse failure in descr_formations_ai.txt, I found `unit_density loose` (20 uses in RIS, **0 in vanilla**) and `block_formation square` (4 in RIS, 0 in vanilla) and was about to report both as defects. The file's own header documents them: *\"unit_density — either loose or close\"* and *\"block_formation — the formation to organise the block into (square, column, line)\"*. **Absence from vanilla is not evidence of invalidity.** So the rule now grades by confidence: a token that is a near miss of a real one — a dropped prefix or typo, which is the `pilum_infantry` case the engine confirmed 413 times — stays an error, while a wholly novel token is a warning that says plainly it may be a deliberate extension and points at the game's own error_log as the thing that would settle it." },
      { type: "feature", text: "**New check: `unit_density` and `block_formation` values are validated against the list the file's own header documents** — better evidence than vanilla usage, and it would catch a plain typo like `unit_density sparse`. 536 values checked on the real mod, 0 bad, which is the correct answer and confirms `loose` and `square` pass. `unit_formation` is deliberately not checked: its documented list ends in \"(wedge, square, ...)\", and an open-ended list cannot be validated without inventing the rest." },
      { type: "improvement", text: "Ruled out, so nobody re-chases it: the line-2369 parse failure is **not** caused by any of these. That formation contains zero bare `pilum_infantry`, no `unit_density loose` and no `block_formation square`, and every token it uses is one vanilla uses too. It remains a separate, unexplained defect — which is now recorded as such rather than being quietly attached to a nearby finding." },
    ],
  },
  {
    version: "0.9.1440",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**Mod Lint now catches the defect that took 32 crashed play sessions to find — statically, in 220ms.** The v7.12 beta telemetry showed the engine rejecting a formation token **413 times across 32 sessions**, in its own words: `Failed to find either a unit class or unit category. Provided: 'pilum_infantry'`, alongside 462 unit-enum asserts and 2,893 `is_template_formation()` failures. descr_formations_ai.txt was also the file named by 352 script faults — five times the next worst. The lint now reads that file and reports the one line at fault: bare `pilum_infantry`, 28 uses from line 78, where the engine only knows the prefixed forms." },
      { type: "improvement", text: "**The vocabulary is derived from vanilla, not invented — and that is what makes it trustworthy.** My first pass at this assumed every underscore-joined token was a mod invention and would have condemned **192 lines**. Checking the three shipped vanilla files disproved it outright: `heavy_pilum_infantry`, `light_pilum_infantry`, `spearmen_pilum_infantry`, `non_phalanx_spear`, `ranged_missile_infantry`, `chanting_screeching`, `phalanx`, `swimming` and `carrying_siege_engine *` are all tokens vanilla itself uses. Only the bare form is absent — 0 uses across all three vanilla files against 28 in RIS, and precisely the token the engine names. Guessing would have produced 164 false accusations; on the real mod the rule now reports exactly one finding out of 819 tokens examined." },
      { type: "improvement", text: "The message quotes the engine's own wording so it can be grepped straight against a log, names the near-miss (\"vanilla does use heavy_pilum_infantry — a dropped prefix is the likely cause\"), and the check reports how many tokens it examined so a rule that silently stops working is detectable rather than looking like a clean file. Every vanilla token is unit-tested as a non-finding, which is the false-positive trap this rule could easily have fallen into." },
    ],
  },
  ];

export default CHANGELOG;
