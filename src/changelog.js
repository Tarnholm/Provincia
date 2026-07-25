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
    version: "0.9.1451",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**463 settlements across 85 factions have no governor — and the biggest offenders were being hidden.** Governor coverage now comes from the save, which records it per settlement, instead of from the AI log. That recovers every faction the log-based version had to exclude for unstable readings, which were exactly the large conquering factions worth knowing about: **seleucid 49 of 110 ungoverned (45%), ptolemaic 35 of 101, antigonid 17 of 40, indians 11 of 19 (58%)**. An ungoverned settlement gets no governor bonuses, so its public order, growth and income all run below what the same settlement manages with one — a faction above ~40% is short of characters, not buildings." },
      { type: "improvement", text: "**The save figure is trusted because the log independently corroborates it, not because it is convenient.** Over the 75 factions whose log reading is usable, the two agree within two settlements for **95%** of them. That comparison is reported in the panel alongside the number and asserted in the integration test, so the corroboration cannot quietly lapse." },
      { type: "fix", text: "**This finishes the validation started in v0.9.1450, which had only checked half the field.** That release established the log's *denominator* was unusable and switched to a count. The numerator needed the same scrutiny: it turns out to be sound where the stability flag says it is sound (96% within ±2 across 113 stable factions) and badly wrong where it does not — seleucid's log median reads 7 against a true 49. So the flag was doing real work, but keeping the log as the source meant discarding the most interesting factions to respect it. The save has no such limitation." },
      { type: "improvement", text: "Share is now guaranteed to be a real fraction — the test asserts ungoverned never exceeds settlements held and every share falls in (0, 1], so a bad denominator can never again produce a percentage above 100. The panel's bars are coloured by severity with the count spelled out beside them, and it states plainly that it needs a save rather than silently rendering nothing." },
    ],
  },

  {
    version: "0.9.1450",
    date: "2026-07-25",
    items: [
      { type: "fix", text: "**The ungoverned-settlements percentage shipped in v0.9.1446 was built on a denominator that does not hold up, and is now gone.** The engine's \"ungoverned cities N / M\" line gives an M that matches descr_strat almost exactly at turn 1 — 218 of 221 factions — which is what made it look like a settlement count. Checked against the save at the other end of the campaign it falls apart: only **26% of factions land within 10%**, and it does not improve with faction size — **seleucid reads 36 against the save's 110**. It is also not stable across the engine's own passes within a single turn. So M is something narrower than \"settlements owned\" and any share computed from it was wrong." },
      { type: "improvement", text: "**The section now leads with the count, and takes its denominator from the save where one exists.** \"10 settlements ungoverned of 19 held (53%, denominator from the save)\" is defensible; \"10 of 17\" was not. `expansionReport` now exposes `ownedNow` — per-faction settlements as the save has them — precisely so nothing else reaches for the log's figure again, and the reason is written at the field. Where the save has no count the share is simply omitted rather than guessed." },
      { type: "improvement", text: "This was found by validating a number already on screen instead of trusting it. The turn-1 agreement was genuinely strong, and that is exactly what made the field convincing — a check at one end of a campaign says nothing about the other. The rebel faction had already been excluded for behaving oddly here; the useful discovery is that the same weakness affects every faction, just less visibly." },
    ],
  },

  {
    version: "0.9.1449",
    date: "2026-07-25",
    items: [
      { type: "fix", text: "**Retracting v0.9.1447 and 1448 in full: the \"51-turn gap\" and the \"different campaigns\" verdict were both wrong.** RIS runs **four turns per year**, twice the base game. The log's season field only ever reads *summer* or *winter* — two labels for four turns — so counting distinct (year, season) blocks gave 51 for a log that spans 26 years and about **104 turns**. The turn-102 save is therefore **inside** the log's span, not 51 turns past it. Corrected figures: gap **0.25 years**, overlaps true, confidence **good**. The caveats no longer fire and the outcome lead is back at the top where it belongs." },
      { type: "fix", text: "**The \"different campaigns\" claim rested on a single faction — and it was the one faction already known to be special.** It fired only on the rebels: the log leaves them near 31 settlements, the save has 522. With the timescale corrected, that is two figures 17x apart *at the same moment*, which means the two sources are not measuring the same thing for that faction — not that the campaigns differ. aiExpansion.js has excluded the rebels from its arithmetic all along for exactly this reason, and this check now does too. It also requires **two or more** factions to diverge before drawing any conclusion, and reports a lone outlier as an outlier instead of a verdict." },
      { type: "improvement", text: "**Comparison is now done in years, not turn-block counts.** Years are stated unambiguously on every faction header; turn blocks depend on how many season labels the engine happens to emit, which is the assumption that broke. The timescale is a named constant (4 for RIS) because nothing in the mod data states it — there is no `timescale` anywhere in RIS/data — so it is declared and overridable rather than silently inferred. A test pins the failure directly: the same inputs at 2 turns/year invent a 25-year gap and raise a caveat; at 4 they do not." },
      { type: "improvement", text: "What survives from those two releases is the check itself, now correct and quiet on good data: it still verifies the log opens at the campaign start (**218 of 221 factions match descr_strat**, which is what licenses the year arithmetic) and will still speak up when a log and save genuinely do not belong together. The lesson recorded alongside it is that a caveat which fires on sound data is not caution, it is noise — and it cost two releases to learn." },
    ],
  },

  {
    version: "0.9.1448",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**The Lab now detects that a log and a save are from DIFFERENT CAMPAIGNS — and the reference pair is.** The previous release only checked that the log *starts* at a campaign start, which every campaign's log does; it could not tell two playthroughs apart. The new check looks for divergence elapsed time cannot explain: the log leaves the independent peoples at ~31 settlements after a continuous decline from a 413 peak, while the save has **522 — about 17x**. A faction cannot recover that from near-death, because conquered settlements pass to the conqueror, not back to their former owner. Emitted as the first lead, above the timing caveat, because if the files are not the same playthrough no gap arithmetic makes them comparable." },
      { type: "fix", text: "**Confirmed against how the game actually behaves.** The independents really do lose settlements fast — the log shows an unbroken decline, 497 → 450 → 413 → 370 → 324 → 288 → 257 → 232 → … → 31 over 51 turns. An intermediate check of mine mislabelled that as \"resets/jumps\" because its tolerance treated a 10% continued drop as a discontinuity; the series is in fact monotonic, and the collapse is real." },
      { type: "fix", text: "**A stray sample nearly turned a real 17x finding into a false 522x one.** The rebel faction's very last reading in the log is a lone \"1\" against a run of ~30, and taking the raw last value let that single outlier set the ratio. The tail value is now the median of the last five turns — still \"where the log leaves this faction\", but no single sample can set it. The integration test pins the factor between 10 and 30 so the outlier form cannot come back." },
      { type: "improvement", text: "Findings that rest on the log alone — orders issued, strength requirements, script errors, invasion targets — are unaffected by any of this and the lead says so explicitly. What is now flagged as unsafe is the cross-referenced set: never-arrived verdicts, unaffordable campaigns, orphaned armies. The check stays quiet on ordinary growth (a faction going 40 → 48 over 51 turns proves nothing) and on small counts where a large ratio is unremarkable, so it fires on the impossible rather than the merely busy." },
    ],
  },

  {
    version: "0.9.1447",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**The Lab now checks whether your log and your save describe the same moment — and on the reference pair, they do not.** The log covers turns 1-51; the save is turn 102. So every \"the army never arrived\" verdict was being decided against a world **51 turns after the log stopped talking about it** — as long again as the log ever observed. A new provenance check states the relationship and now sits as the FIRST lead, above the findings it qualifies, because a caveat that appears below them has already failed at its job." },
      { type: "improvement", text: "**The gap is a fact, not a guess, because the log is anchored first.** If a log's opening settlement counts match descr_strat's starting ownership, it begins at turn 1 — and only then does \"the save is 51 turns later\" mean anything. On this campaign **218 of 221 factions match (98.6%)**, so the anchor holds. Where it does not hold, the check refuses to compute a gap at all and says the log's turn range cannot be established, rather than doing arithmetic on an assumption." },
      { type: "fix", text: "**Found by chasing a contradiction rather than averaging it away.** The log shows the independent peoples already down to 413 settlements in their very first logged turn and falling; the save shows them holding 522. Both numbers survived scrutiny — the 522 are real named settlements, not placeholders or unresolved owners — which left the pairing itself as the thing that did not hold. The \"conquest is not working\" lead is unaffected as a net statement, but it now carries the caveat, and the modder can see that the net figure may hide a collapse followed by a recovery as factions were wiped out." },
      { type: "improvement", text: "Two guards earned their keep on this change. The worker-safety test caught that the new module was missing from the packaged file list — it would have been **absent from app.asar in the shipped build**, the exact silent failure that whitelist exists to prevent. And the integration test's \"outcome lead must be first\" assertion failed, correctly: that ordering was a deliberate decision, so it was re-argued and updated in place rather than quietly relaxed, with the original intent (outcome above scale) preserved directly beneath." },
    ],
  },

  {
    version: "0.9.1446",
    date: "2026-07-25",
    items: [
      { type: "fix", text: "**Nine fields were being computed on every run and displayed nowhere — and the first one examined turned out to be wrong.** `factionHealth` averaged the engine's \"ungoverned cities N / M\" line, which is written about three times per season, once per AI pass. For most factions the value is stable across those passes (carthage reads 41→41→43, a real settlement count) but for the rebels it *decays within a single season* — 497→450→413 — because its territory is being processed as the passes run. Averaging the two together is meaningless, and it had the rebels holding **79 settlements when they hold about 500**." },
      { type: "improvement", text: "**Now reported as the median of one reading per turn, with an explicit stability flag.** `countIsStable` is computed by comparing the passes' actual values, not by counting samples — a sample count carries no information about agreement, and a first attempt that used one was thrown away for exactly that reason. On the reference campaign **22 of 224 factions are flagged unstable and excluded** (rebels, ptolemaic, seleucid — all mid-conquest), leaving **127 factions with a defensible ungoverned count**: indians 10 of 17, carthage 9 of 36, pontus 6 of 15. The panel names the excluded factions and says why rather than hiding them." },
      { type: "feature", text: "**New \"AI activity\" tab surfaces what the AI actually did.** Orders issued by type, with assault and siege orders coloured apart from movement — the AI issues **8,683 attack-residence and 8,652 siege-residence orders**, so it does order assaults, and a faction that issues none is passive for a different reason than one that issues them and never arrives. Plus the engine's own invasion-target count (a faction reporting zero will never attack however strong it grows), ungoverned settlements, and the rejected script commands. Every section has an explicit empty state, because a section that silently renders nothing makes a parsing regression look like a clean campaign." },
      { type: "improvement", text: "**A contradiction between two sources was chased down rather than averaged over.** The log shows the rebel faction collapsing from 497 settlements to ~30; the save says it *grew* 499 → 522. Rebels cannot do both. Resolved by establishing that the log's figure is not a stable per-turn count for that faction while the save-vs-descr_strat comparison is independent of the log and stands — so the \"conquest is not working\" lead is unaffected. The stability flag now encodes what was learned, so the next reader does not have to re-derive it." },
    ],
  },

  {
    version: "0.9.1445",
    date: "2026-07-25",
    items: [
      { type: "feature", text: "**A failed script command now names the command, the file and the line.** Last release recovered 555 `err: no building of this type in settlement` lines, but that text names nothing you can act on. Each error is now paired with the command that caused it, and cross-referenced against the campaign script — producing one lead: **five `set_building_health` calls at RIS_Campaign_Script.txt lines 4623-4627, each failing exactly 111 times, 555 total.** The suggested fix is the `if SettlementBuildingExists = ...` guard the same script already uses four lines later." },
      { type: "fix", text: "**A parser blind spot found while doing it: the engine sometimes writes console output with NO newline, gluing it onto the end of an AI line.** 111 of the 555 failing commands are hidden that way — the line ends `...num res 0.sudo set_building_health local hinterland_region 100`. Anchoring on `^sudo` missed every one, and worse, it mis-attributed their errors to whichever command came before, inflating one count from 111 to 221. The scan is now unanchored and each error is charged to exactly one command." },
      { type: "improvement", text: "**Three tempting explanations were checked and rejected before this lead was written.** That the building chains don't exist — all four `governmentA`–`D` **are** declared in EDB. That `local` is an unexpanded variable — `local` is correct scope syntax, used properly by the same script seventeen lines earlier. That it's a deliberate try-all-four where three must fail — then one would *succeed*, and all five counts are identical, including a chain that isn't part of any mutually-exclusive set. So the lead reports what is measured (every call fails, always) and does not assert a cause. It also states plainly that these are failure **counts, not rates**: the console echoes only failures, so this log has no denominator." },
      { type: "improvement", text: "**A 5,872-item finding was investigated and deliberately NOT shipped.** `is busy constructing **invalid**` looked like a major defect across 1,077 settlements. Two probes failed to distinguish it from a normal busy settlement, and the one asymmetry found ran *against* the bug reading. Unexplained is not the same as broken, so nothing was published — that would have been 5,872 false accusations. Recorded as ruled-out so it is not re-chased." },
      { type: "improvement", text: "**Guards tightened where this round found them wanting.** The coverage invariant caught real drift (the new command handler made the two counters disagree by exactly 444) but only because I looked — its first version re-implemented the predicate inline, which is precisely the anti-pattern it exists to catch. It now reads both numbers from the same analyser run, and on the reference log they agree exactly at 2,239,227. The sample harvester is now a maintained script (`--write`) that refuses to update the fixture if any pattern lacks a real example, and the reporter's embedded copy is synced from it — 31/31, verified on the frozen build. Extract re-measured rather than estimated: **6.58 MB xz against the 7 MB attachment ceiling**, so it still fits whole, but headroom is now 6% and the next pattern should re-check it." },
    ],
  },

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

  ];

export default CHANGELOG;
