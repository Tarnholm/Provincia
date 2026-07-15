// Unit tests for buildLastTurnSummary — the pure event-log diff→summary used by
// the live "last turn" panel. Uses diffTurn's real dedup key
// (recordClass|factionId|subject|title|body).
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildLastTurnSummary } = require("./lastTurnSummary.js");

const ev = (o) => ({ type: "trait_gain", recordClass: "char", factionId: 5, subject: "Marcus", title: "T", body: "B", ...o });

describe("buildLastTurnSummary", () => {
  it("returns null when either input is not an array (first live load)", () => {
    expect(buildLastTurnSummary(null, [])).toBeNull();
    expect(buildLastTurnSummary([], null)).toBeNull();
    expect(buildLastTurnSummary(undefined, undefined)).toBeNull();
  });

  it("maps newly-appeared events to the renderer shape, dropping extra fields", () => {
    const out = buildLastTurnSummary([], [ev({ faction: "gaul", extra: "x" })]);
    expect(out).toEqual([
      { type: "trait_gain", recordClass: "char", faction: "gaul", subject: "Marcus", title: "T", body: "B" },
    ]);
    // factionId and unrelated fields are not carried through
    expect(out[0]).not.toHaveProperty("factionId");
    expect(out[0]).not.toHaveProperty("extra");
  });

  it("returns only events not present in the previous snapshot (dedup by key)", () => {
    const a = ev({ subject: "Aulus" });
    const b = ev({ subject: "Brennus" });
    const out = buildLastTurnSummary([a], [a, b]); // a is unchanged → only b is new
    expect(out.map((e) => e.subject)).toEqual(["Brennus"]);
  });

  it("defaults faction/title/body to null when absent", () => {
    const out = buildLastTurnSummary([], [{ type: "move", recordClass: "unit", subject: "x" }]);
    expect(out[0]).toMatchObject({ faction: null, title: null, body: null });
  });

  it("returns an empty array when nothing new appeared", () => {
    const a = ev({});
    expect(buildLastTurnSummary([a], [a])).toEqual([]);
  });
});
