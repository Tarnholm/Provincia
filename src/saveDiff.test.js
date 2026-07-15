// Tests for the pure save-diff + autosave-classification helpers extracted
// from main.js. Lock the event shapes the live-watch feed depends on.
import { describe, test, expect } from "vitest";
import { diffSaveData, isEndAutosave } from "./saveDiff.js";

describe("diffSaveData — buildings", () => {
  test("upgrade emitted only when both levels known and differ", () => {
    const prev = { buildings: { Rome: { barracks: { level: 1, health: 100 } } } };
    const curr = { buildings: { Rome: { barracks: { level: 2, health: 100 } } } };
    expect(diffSaveData(prev, curr)).toContainEqual(
      { type: "building_upgrade", city: "Rome", building: "barracks", from: 1, to: 2 });
  });
  test("new building in a shared city", () => {
    const prev = { buildings: { Rome: { walls: { level: 1 } } } };
    const curr = { buildings: { Rome: { walls: { level: 1 }, temple: { level: 1, health: 100 } } } };
    expect(diffSaveData(prev, curr)).toContainEqual(
      { type: "building_new", city: "Rome", building: "temple", level: 1, health: 100 });
  });
  test("cities not in BOTH snapshots are ignored (noise reduction)", () => {
    const prev = { buildings: {} };
    const curr = { buildings: { NewTown: { walls: { level: 1 } } } };
    expect(diffSaveData(prev, curr).filter((e) => e.type.startsWith("building"))).toHaveLength(0);
  });
  test("damage emitted on health drop", () => {
    const prev = { buildings: { Rome: { walls: { level: 2, health: 100 } } } };
    const curr = { buildings: { Rome: { walls: { level: 2, health: 40 } } } };
    expect(diffSaveData(prev, curr)).toContainEqual(
      { type: "building_damaged", city: "Rome", building: "walls", from: 100, to: 40 });
  });
});

describe("diffSaveData — armies", () => {
  test("arrival / departure / change", () => {
    const arrived = diffSaveData({ armies: {} }, { armies: { Latium: [{ soldiers: 120 }] } });
    expect(arrived).toContainEqual({ type: "army_arrived", region: "Latium", units: 1, soldiers: 120 });

    const left = diffSaveData({ armies: { Latium: [{ soldiers: 120 }] } }, { armies: {} });
    expect(left).toContainEqual({ type: "army_left", region: "Latium", units: 1, soldiers: 120 });

    const changed = diffSaveData(
      { armies: { Latium: [{ soldiers: 120 }] } },
      { armies: { Latium: [{ soldiers: 120 }, { soldiers: 60 }] } });
    expect(changed).toContainEqual(
      { type: "army_changed", region: "Latium", prevUnits: 1, units: 2, prevSoldiers: 120, soldiers: 180 });
  });
});

describe("diffSaveData — queues", () => {
  test("disappearing queue entry = completed; new entry = queued", () => {
    const ev = diffSaveData(
      { queues: { Rome: ["barracks"] } },
      { queues: { Rome: ["temple"] } });
    expect(ev).toContainEqual({ type: "building_completed", city: "Rome", chain: "barracks" });
    expect(ev).toContainEqual({ type: "building_queued", city: "Rome", chain: "temple" });
  });
});

describe("diffSaveData — robustness", () => {
  test("empty snapshots produce no events", () => {
    expect(diffSaveData({}, {})).toEqual([]);
  });
});

describe("isEndAutosave", () => {
  // The leading \bAutosave\b was fixed 2026-07-15: the standard "save_Autosave …"
  // prefix has no word boundary before "Autosave" (underscore is \w), so End
  // autosaves were never actually being skipped. Now they match.
  test("skips the standard save_-prefixed 'Turn N End' autosave", () => {
    expect(isEndAutosave("save_Autosave Republic of Rome Turn 5 End.sav")).toBe(true);
    expect(isEndAutosave("save_Autosave   Republic of Rome   Turn 34 End.sav")).toBe(true);
  });
  test("also matches when 'Autosave' is at a plain boundary", () => {
    expect(isEndAutosave("Autosave Republic of Rome Turn 5 End.sav")).toBe(true);
    expect(isEndAutosave("my Autosave Turn 12 End.sav")).toBe(true);
  });
  test("keeps Start / bare-turn / manual saves", () => {
    expect(isEndAutosave("save_Autosave Republic of Rome Turn 5 Start.sav")).toBe(false);
    expect(isEndAutosave("save_Autosave Republic of Rome Turn 5.sav")).toBe(false);
    expect(isEndAutosave("save_rome10.sav")).toBe(false);
  });
});
