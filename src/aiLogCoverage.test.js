// @vitest-environment node
// The invariant that the coverage number depends on.
//
// Background: `feedLine` has a performance fast-path — `if (l.charCodeAt(0) !== 65)
// return;` — resting on the comment "every interesting line starts AI:". That
// comment went stale when `err: ...` (script-command failures, 555 on the reference
// log) became signal. The handler was placed BELOW the guard, so it never ran, and
// `scriptCommandErrors` came back empty.
//
// The expensive part of that bug was not the lost data, it was the lost trust: the
// coverage tracker had no such guard, so it counted those 555 lines as parsed while
// the analyser never saw them. A coverage figure that counts lines the analyser
// discards is worse than no figure, because it reads as reassurance.
//
// So this file asserts the two agree. Any line the tracker calls signal must
// actually change the analyser's output. That fails loudly the next time a handler
// is added below the fast path, or the fast path is tightened.
import { describe, it, expect } from "vitest";
import { createAiDecisionAnalyzer, AI_RX } from "./aiMovementAnalyzer.js";
import { createCoverageTracker, classifyNoSignal, classifyFamily, lineShape } from "./aiLogVocabulary.js";

// Real lines, harvested from the reference log — see aiLogExtract.test.js on why
// these are not hand-written.
const REAL_SIGNAL = [
  "AI: \t\t\t\tstart 'dummies' for year -270, season summer",
  "err: no building of this type in settlement",
  "AI: ltgd: number of invasion targets: 0",
  "AI: campaign: mission attack residence: char 'Ulkos' attacking sett 'Nasium', priority 90.",
  // A bare console echo. Starts with 's', so it is only seen because feedLine checks
  // for it above the AI:-prefix fast path — the same trap the err: handler fell into.
  "sudo set_building_health local governmentA 100",
];

// The concatenated form: the engine appends console output to an AI line with no
// newline. feedLine deliberately does NOT claim these (the AI line it is glued to
// still needs the handlers below), so the tracker must not claim them either. Listed
// apart because the invariant for them is "both sides agree it is NOT signal here".
const CONCATENATED = [
  "AI: campaign: campaign for 'Armenian Rebels Settlement' (reg 1306, des 129) using strategy ACS_DEFEND_BORDER. required str 0 (ACZ_STAY_AT_HOME), allocated str 0; num res 0.sudo set_building_health local hinterland_region 100",
];

describe("coverage tracker agrees with the analyser", () => {
  it("counts a line as signal only if the analyser actually reads it", () => {
    // Deliberately uses the analyser's OWN tracker via its `vocabulary` output rather
    // than a copy of the predicate. A first version of this test re-implemented the
    // predicate inline — which is precisely the anti-pattern it exists to catch, and
    // it duly failed to notice when a new handler (consoleCmd) was added. The two
    // numbers must come from the same run to be worth comparing.
    for (const line of [...REAL_SIGNAL, ...CONCATENATED]) {
      const a = createAiDecisionAnalyzer();
      a.feedLine(line);
      const out = a.finish();
      const claimedSignal = out.vocabulary.signalLines;   // what the tracker counted
      const actuallyRead = out.parsedLines || 0;          // what a handler claimed

      expect(actuallyRead, `tracker and analyser disagree on: ${line.slice(0, 70)}`)
        .toBe(claimedSignal);
    }
  });

  it("attributes a failed command to the command, in both line forms", () => {
    // "555x no building of this type in settlement" names neither the command nor
    // the file and is not actionable. Paired with its command it points straight at
    // RIS_Campaign_Script.txt:4623-4627.
    const a = createAiDecisionAnalyzer();
    a.feedLine(CONCATENATED[0]);
    a.feedLine("err: no building of this type in settlement");
    a.feedLine("sudo set_building_health local governmentA 100");
    a.feedLine("err: no building of this type in settlement");
    const cmds = a.finish().failedConsoleCommands;
    expect(cmds.map((c) => c.command)).toEqual([
      "set_building_health local hinterland_region 100",
      "set_building_health local governmentA 100",
    ]);
    // Each error is blamed on exactly ONE command. Not clearing the pending command
    // is how a count of 111 first came out as 221.
    expect(cmds.every((c) => c.count === 1)).toBe(true);
  });

  it("does not blame a second error on an already-consumed command", () => {
    const a = createAiDecisionAnalyzer();
    a.feedLine("sudo set_building_health local governmentA 100");
    a.feedLine("err: no building of this type in settlement");
    a.feedLine("err: no building of this type in settlement");
    const cmds = a.finish().failedConsoleCommands;
    expect(cmds).toHaveLength(1);
    expect(cmds[0].count).toBe(1);
  });

  it("reads err: lines despite the AI:-prefix fast path", () => {
    // The specific regression. `err:` starts with 'e', not 'A', so it is only seen
    // if its handler sits above the guard.
    const a = createAiDecisionAnalyzer();
    for (let i = 0; i < 3; i++) a.feedLine("err: no building of this type in settlement");
    const out = a.finish();
    expect(out.scriptCommandErrors).toBeTruthy();
    expect(out.scriptCommandErrors[0]).toMatchObject({
      message: "no building of this type in settlement",
      count: 3,
    });
  });

  it("classifies every line as signal, no-signal, or a known family", () => {
    // Complete accounting: on the reference log this reaches 100%. Here it just has
    // to hold for one line of each kind, including the file's own banner.
    for (const line of [
      "==== campaign ai log start, build date: Jan 15 2026 ====",
      "AI: production: not enough cash to build anything",
      "Performing unit swaps for faction 3",
      "Loading spritesheet strat1.rsd = 1, 1 textures, 4 sprites",
    ]) {
      const accounted =
        classifyNoSignal(line) !== null ||
        classifyFamily(line) !== null ||
        Object.values(AI_RX).some((rx) => rx.test(line)) ||
        lineShape(line) === "";
      expect(accounted, `unaccounted vocabulary: ${line.slice(0, 70)}`).toBe(true);
    }
  });
});
