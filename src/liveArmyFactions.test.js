// Live-mode army factions (src/liveArmyFactions.js). Measured against the
// running game on 2026-09-23: the old rule (marker, patched for governors and
// trait-less armies) left 112 of 953 RIS generals under the wrong faction on
// the map; label → governor → region brought that to 16.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { relabelLiveArmies } = require("./liveArmyFactions.js");

// Governors anchor faction blocks in file order; a general recorded between two
// governors of the SAME faction takes that faction (characterFactionBlocks),
// even though he stands in another faction's land.
const v1 = [
  { offset: 100, secondaryUuid: 1, primaryUuid: 11, faction: "wrongmarker" }, // governs Roma
  { offset: 200, secondaryUuid: 2, primaryUuid: 12, faction: "wrongmarker" }, // field general inside the Roman block
  { offset: 250, secondaryUuid: 5, primaryUuid: 15, faction: "wrongmarker" }, // governs Antium (Roman)
  { offset: 300, secondaryUuid: 3, primaryUuid: 13, faction: "wrongmarker" }, // governs Carthago
  { offset: 400, secondaryUuid: 4, primaryUuid: 14, faction: "wrongmarker" }, // governs Utica
];
const ctx = {
  ownerByCity: { Roma: "romans_julii", Antium: "romans_julii", Carthago: "carthage", Utica: "carthage", Lydia_City: "seleucid" },
  governorByCity: { Roma: { uuid: 1 }, Antium: { uuid: 5 }, Carthago: { uuid: 3 }, Utica: { uuid: 4 } },
  regionToCity: { Lydia: "Lydia_City", Latium: "Roma" },
  factionOrder: ["romans_julii", "carthage", "seleucid"],
};
const army = (cmd, region, faction = "wrongmarker") => ({ commanderUuid: cmd, primaryUuid: null, faction, units: [{ region }] });

describe("relabelLiveArmies", () => {
  it("takes the verified character label first — even for a general in someone else's land", () => {
    const armies = [army(2, "Lydia")];
    const counts = relabelLiveArmies(armies, v1, ctx);
    expect(armies[0].faction).toBe("romans_julii"); // not the region owner (seleucid)
    expect(armies[0].factionSource).toBe("character");
    expect(counts.character).toBe(1);
  });

  it("falls back to the governed city's owner, then the region owner, then keeps the marker", () => {
    const armies = [army(99, "Lydia"), army(98, "Nowhere", "kept")];
    relabelLiveArmies(armies, [], ctx);
    expect(armies[0]).toMatchObject({ faction: "seleucid", factionSource: "region" });
    expect(armies[1]).toMatchObject({ faction: "kept", factionSource: "marker" });
  });

  it("never rewrites the shared character records", () => {
    const records = v1.map((c) => ({ ...c }));
    relabelLiveArmies([army(2, "Lydia")], records, ctx);
    expect(records.every((c) => c.faction === "wrongmarker")).toBe(true);
  });

  it("a rebel card marker makes the army a rebel (slave), before any other rule", () => {
    const armies = [army(2, "Lydia", "seleucid_rebels_rebel"), army(99, "Lydia", "seleucid_rebels")];
    relabelLiveArmies(armies, v1, ctx);
    expect(armies[0]).toMatchObject({ faction: "slave", factionSource: "rebel" });
    expect(armies[1].faction).not.toBe("slave"); // seleucid_rebels is a real faction, not the rebel card
  });

  it("leaves fleets alone — except pirates, which carry the rebel card", () => {
    const fleet = { commanderUuid: 2, faction: "carthage", armyClass: "navy", units: [{ region: "the sea" }] };
    const pirates = { commanderUuid: 3, faction: "paeonia_rebel", armyClass: "navy", units: [{ region: "the sea" }] };
    relabelLiveArmies([fleet, pirates], v1, ctx);
    expect(fleet.faction).toBe("carthage");
    expect(pirates.faction).toBe("slave");
  });
});
