// @vitest-environment jsdom
// The Settlements tab of Bring In a Faction (src/panels/SettlementComparePane.js).
// What must hold: the thinnest towns come first, "Fill in what is missing"
// ticks only what this town lacks or has smaller, the level and the core
// building tick together, warnings name the real reason, and Copy sends
// exactly what is ticked.
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import FactionTransferPanel from "./panels/FactionTransferPanel.js";

let container, root;
function mount(el) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(el));
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => {
  if (root) { try { act(() => root.unmount()); } catch { /* */ } root = null; }
  if (container && container.parentNode) container.parentNode.removeChild(container);
  container = null;
  delete window.electronAPI;
});
const text = () => document.body.textContent;
const click = (node) => act(() => node.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const button = (re) => [...document.querySelectorAll("button")].find((b) => re.test(b.textContent || ""));
const ticked = (sel) => [...document.querySelectorAll(sel)].filter((r) => /rgba\(143, 209, 143, 0.08\)/.test(r.getAttribute("style") || "")).map((r) => r.getAttribute(sel.match(/\[(.+?)\]/)[1]));

const LIST = {
  target: { campaign: "ris_classic" },
  source: { campaign: "imperial_campaign", modDataDir: "C:/RIS/RIS/data", settlements: 1301 },
  towns: [
    { region: "Etruria", city: "Arretium", owner: "romans_julii", sourceRegion: "Etruria", sourceCity: "Arretium", level: "city", sourceLevel: "large_town", population: 6500, sourcePopulation: 5100, buildings: 12, sourceBuildings: 12, missing: 0, higher: 0, onlyHere: 3, fieldsMore: [] },
    { region: "Roma", city: "Rome", owner: "romans_julii", sourceRegion: "Roma", sourceCity: "Rome", level: "town", sourceLevel: "large_city", population: 400, sourcePopulation: 12500, buildings: 2, sourceBuildings: 15, missing: 13, higher: 2, onlyHere: 0, fieldsMore: ["level", "population"] },
    { region: "Nowhere", city: "Nowhere", owner: "slave", sourceRegion: null },
  ],
};
const ROME = {
  region: "Roma", city: "Rome", owner: "romans_julii", sourceRegion: "Roma", sourceCity: "Rome", sourceOwner: "roman_senate",
  sourceCampaign: "imperial_campaign", targetCampaign: "ris_classic",
  fields: [
    { key: "level", here: "town", there: "large_city", more: true },
    { key: "population", here: "400", there: "12500", more: true },
    { key: "faction_creator", here: "romans_julii", there: "roman_senate", more: false },
  ],
  buildings: [
    { chain: "core_building", here: "governors_house", there: "proconsuls_palace", status: "higher_there", duplicate: false },
    { chain: "hinterland_roads", here: "highways", there: "paved_roads", status: "lower_there", duplicate: false },
    { chain: "theatres", here: null, there: "odeon", status: "missing", duplicate: false },
    { chain: "wine_industry", here: null, there: "wine_2", status: "missing", duplicate: false },
    { chain: "smith", here: "blacksmith", there: null, status: "only_here", duplicate: false },
  ],
  checks: {
    core_building: { settlementMin: null, requires: null, slotTakenBy: null },
    hinterland_roads: { settlementMin: null, requires: null, slotTakenBy: null },
    theatres: { settlementMin: "city", requires: null, slotTakenBy: null },
    wine_industry: { settlementMin: null, requires: { kind: "resource", what: "wine" }, slotTakenBy: null },
  },
  settlementTiers: [], levels: ["village", "town", "large_town", "city", "large_city", "huge_city"],
};

function apiWith() {
  const calls = { apply: [] };
  window.electronAPI = {
    factionTransferScan: () => Promise.resolve({ target: { campaign: "ris_classic" }, source: LIST.source, factions: [] }),
    settlementCompareList: () => Promise.resolve(LIST),
    settlementCompare: () => Promise.resolve(ROME),
    settlementCompareApply: (dir, region, choice) => { calls.apply.push({ region, choice }); return Promise.resolve({ ok: true, dryRun: !!choice.dryRun, changes: ["population 400 → 12500"] }); },
  };
  return calls;
}

describe("Compare Settlements", () => {
  it("opens on the Settlements tab when asked, thinnest town first", async () => {
    apiWith();
    mount(<FactionTransferPanel initialTab="settlements" modDataDir="C:/mod" onClose={() => { }} />);
    await settle();
    const rows = [...document.querySelectorAll("[data-compare-town]")].map((n) => n.getAttribute("data-compare-town"));
    // Arretium has nothing to fill, so the default filter hides it
    expect(rows).toEqual(["Roma", "Nowhere"]);
    expect(text()).toMatch(/town 400 · 2b\s+←\s+large city 12500 · 15b/);
    expect(text()).toMatch(/2 of 3 towns found in imperial_campaign/);
  });

  it("Fill in what is missing ticks only what is missing or bigger, and warns with the reason", async () => {
    apiWith();
    mount(<FactionTransferPanel initialTab="settlements" modDataDir="C:/mod" onClose={() => { }} />);
    await settle();
    click(document.querySelector('[data-compare-town="Roma"]'));
    await settle();
    expect(ticked("[data-field]")).toEqual(["level", "population"]);
    expect(ticked("[data-building]")).toEqual(["core_building", "theatres", "wine_industry"]);
    expect(text()).toMatch(/hidden resource wine, which Roma lacks on this map/);
    // the level goes to large_city, so the odeon's city minimum is met: no warning
    expect(text()).not.toMatch(/needs at least a city/);
    // untick the level: core building goes too, and now the odeon is too big for a town
    click(document.querySelector('[data-field="level"]'));
    expect(ticked("[data-building]")).toEqual(["theatres", "wine_industry"]);
    expect(text()).toMatch(/needs at least a city — this town would be a town/);
  });

  it("Match the main mod also takes smaller values and removes what only this town has", async () => {
    apiWith();
    mount(<FactionTransferPanel initialTab="settlements" modDataDir="C:/mod" onClose={() => { }} />);
    await settle();
    click(document.querySelector('[data-compare-town="Roma"]'));
    await settle();
    click(button(/Match the main mod/));
    expect(ticked("[data-field]")).toEqual(["level", "population", "faction_creator"]);
    expect(ticked("[data-building]")).toEqual(["core_building", "hinterland_roads", "theatres", "wine_industry"]);
    expect(text()).toMatch(/remove/);
  });

  it("Copy sends exactly what is ticked", async () => {
    const calls = apiWith();
    mount(<FactionTransferPanel initialTab="settlements" modDataDir="C:/mod" pushToast={() => { }} onClose={() => { }} />);
    await settle();
    click(document.querySelector('[data-compare-town="Roma"]'));
    await settle();
    click(document.querySelector('[data-building="wine_industry"]'));
    click(button(/Copy into this town/));
    await settle();
    expect(calls.apply[0]).toEqual({ region: "Roma", choice: { fields: ["level", "population"], buildings: ["core_building", "theatres"], remove: [], dryRun: false } });
  });

  it("the Factions tab is still there", async () => {
    apiWith();
    mount(<FactionTransferPanel initialTab="settlements" modDataDir="C:/mod" onClose={() => { }} />);
    await settle();
    click(document.querySelector('[data-tab="factions"]'));
    await settle();
    expect(document.querySelector("[data-compare-town]")).toBeNull();
  });
});
