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
];

describe("coverage tracker agrees with the analyser", () => {
  it("counts a line as signal only if the analyser actually reads it", () => {
    for (const line of REAL_SIGNAL) {
      // What the tracker claims.
      const t = createCoverageTracker((l) => {
        const c = l.charCodeAt(0);
        if (c === 101 && AI_RX.scriptErr.test(l)) return true;
        if (c !== 65) return false;
        return Object.values(AI_RX).some((rx) => rx.test(l));
      });
      t.feedLine(line);
      const claimedSignal = t.finish().signalLines === 1;

      // What the analyser does. `parsedLines` is incremented by every handler that
      // claims a line, so it is the honest witness of whether the line reached one.
      // (Not `lines`, which counts everything fed in regardless of the fast path.)
      const a = createAiDecisionAnalyzer();
      a.feedLine(line);
      const actuallyRead = (a.finish().parsedLines || 0) > 0;

      expect(actuallyRead, `tracker says signal but analyser discards it: ${line.slice(0, 70)}`)
        .toBe(claimedSignal);
    }
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
