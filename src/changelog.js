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
    version: "0.9.1452",
    date: "2026-07-25",
    items: [
      { type: "fix", text: "**The save's family roster is incomplete, and anything counting characters per faction has been getting wrong answers.** It looks authoritative — 2,846 records, every one with a resolvable name, 99% with a plausible age, no duplicate uuids — but only **15% of its own father references and 11% of its spouse references resolve inside it**. **416 referenced fathers are simply absent, and 257 of them (62%) turn up in `characters.v1`**, so `family` and `v1` are two partial views of one roster and neither is usable alone." },
      { type: "improvement", text: "**The shortfall is male-skewed, which is what makes it dangerous rather than merely incomplete.** The surviving records read **19% male**, yielding **48 alive adult males map-wide against 848 settlements that demonstrably have a governor**. A uniform undercount would still give correct ratios; this one does not, so every per-faction character count and every male/adult filter built on it comes out wrong. New `familyIntegrity()` measures the resolution rates and refuses the roster outright when they fall below 80%." },
      { type: "improvement", text: "**The gender decode is CORRECT and is reported separately, so nobody rewrites a bit-flag that was never broken.** That was established before any of the above was believed: every record referenced as a father is male (**84 of 84**) and every resolved spouse pair is opposite-gender (**246 of 246**). Fatherhood and marriage come from different fields than the gender bit, so those checks could have failed and did not — the problem is coverage, not decoding, which is precisely why it is easy to mistake for real data. A test feeds a deliberately inverted bit and asserts the check fires, so the guard cannot become decorative." },
      { type: "improvement", text: "This is why v0.9.1451's governance finding stops at **463 ungoverned settlements** and does not say whether that is a character shortage or a deployment failure. Those have different fixes, so the distinction matters — but the roster cannot support it, and the integration test now pins that reason rather than leaving the missing lead unexplained." },
    ],
  },

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

  ];

export default CHANGELOG;
