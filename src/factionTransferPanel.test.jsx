// @vitest-environment jsdom
// The ☥ Bring In a Faction panel. What must hold: it only offers factions this
// campaign leaves dormant, it pre-ticks the suggested towns and the whole
// roster, it names the current owner of every town (the warning the user asked
// for), and "Bring in" sends exactly what is ticked.
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import FactionTransferPanel from "./panels/FactionTransferPanel.js";

let container, root;
function mount(el) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => root.render(el));
}
const settle = () => new Promise((r) => setTimeout(r, 0)).then(() => flushSync(() => { }));
afterEach(() => {
  if (root) { try { flushSync(() => root.unmount()); } catch { /* */ } root = null; }
  if (container && container.parentNode) container.parentNode.removeChild(container);
  container = null;
  delete window.electronAPI;
});
const text = () => document.body.textContent;
const click = (node) => flushSync(() => node.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const button = (re) => [...document.querySelectorAll("button")].find((b) => re.test(b.textContent || ""));

const SCAN = {
  target: { campaign: "ris_light", campaigns: ["ris_light"] },
  source: { modDataDir: "C:/RIS/RIS/data", campaign: "imperial_campaign", settlements: 1306 },
  factions: [
    { faction: "minaeans", dormant: true, settlements: 0, characters: 0, sourceSettlements: 5, sourceCharacters: 2 },
    { faction: "acragas", dormant: true, settlements: 0, characters: 0, sourceSettlements: 1, sourceCharacters: 3 },
    { faction: "carthage", dormant: false, settlements: 41, characters: 9, sourceSettlements: 41, sourceCharacters: 9 },
  ],
};
const ROSTER = {
  faction: "minaeans",
  target: { campaign: "ris_light", dormant: true, settlements: 0, denari: 5000 },
  source: { campaign: "imperial_campaign", denari: 7000, aiLabel: "ai_east" },
  roster: {
    characters: [
      { name: "Zamir_Ali_Zarih", kind: "named character", role: "leader", age: 45, units: 10, army: ["arabian spearmen", "camel riders"] },
      { name: "Nasha_Karab", kind: "named character", role: "heir", age: 22, units: 3, army: ["arabian spearmen"] },
    ],
    family: [{ name: "Ilsharah", gender: "female", age: 40, alive: true }],
    relatives: [{ names: ["Zamir_Ali_Zarih", "Ilsharah"] }],
  },
  settlements: [
    { region: "Qarnawu", city: "Karna", level: "large_town", owner: "slave", suggested: true, x: 376, y: 53 },
    { region: "Nagran", city: "Negrana", level: "town", owner: "slave", suggested: true, x: 364, y: 57 },
    { region: "Pella", city: "Pella", level: "city", owner: "macedon", suggested: false, x: 10, y: 20 },
  ],
  suggestedCount: 2,
};

function apiWith(overrides = {}) {
  const calls = { apply: [] };
  window.electronAPI = {
    factionTransferScan: () => Promise.resolve(SCAN),
    factionTransferRoster: () => Promise.resolve(ROSTER),
    factionTransferApply: (dir, faction, choice) => { calls.apply.push({ faction, choice }); return Promise.resolve({ ok: true, summary: { settlements: choice.settlements.map((r) => ({ region: r, from: "slave" })), characters: [], family: [], relatives: 0 }, warnings: [] }); },
    ...overrides,
  };
  return calls;
}

describe("FactionTransferPanel", () => {
  it("lists only the dormant factions, with what each has in the fuller mod", async () => {
    apiWith();
    mount(<FactionTransferPanel modDataDir="C:/mod" onClose={() => { }} />);
    await settle();
    const rows = [...document.querySelectorAll("[data-dormant-faction]")].map((n) => n.getAttribute("data-dormant-faction"));
    expect(rows).toEqual(["minaeans", "acragas"]); // carthage is awake, so it is not on offer
    expect(text()).toMatch(/5 towns, 2 characters over there/);
    expect(text()).toMatch(/roster from imperial_campaign \(1306 settlements\)/);
  });

  it("pre-ticks the suggested towns and the whole roster, and names each town's owner", async () => {
    apiWith();
    mount(<FactionTransferPanel modDataDir="C:/mod" factionDisplayNames={{ macedon: "Macedon" }} onClose={() => { }} />);
    await settle();
    click(document.querySelector('[data-dormant-faction="minaeans"]'));
    await settle();
    expect(text()).toMatch(/2 settlement\(s\), 2 character\(s\), 1 family record\(s\)/);
    expect(text()).toMatch(/arabian spearmen, camel riders/);      // the army is shown, not just a count
    expect(text()).toMatch(/rebels/);                               // slave is named in plain words
    expect(text()).toMatch(/Macedon/);                              // a living owner is named too
  });

  it("sends exactly what is ticked, and unticking a town changes it", async () => {
    const calls = apiWith();
    mount(<FactionTransferPanel modDataDir="C:/mod" pushToast={() => { }} onClose={() => { }} />);
    await settle();
    click(document.querySelector('[data-dormant-faction="minaeans"]'));
    await settle();
    click(document.querySelector('[data-town="Nagran"]'));          // drop a suggested town
    click(document.querySelector('[data-character="Nasha_Karab"]')); // drop the heir
    click(button(/Bring in/));
    await settle();
    expect(calls.apply.length).toBe(1);
    expect(calls.apply[0].faction).toBe("minaeans");
    expect(calls.apply[0].choice.settlements).toEqual(["Qarnawu"]);
    expect(calls.apply[0].choice.characters).toEqual(["Zamir_Ali_Zarih"]);
    expect(calls.apply[0].choice.family).toEqual(["Ilsharah"]);
  });

  it("will not write with no settlement chosen — that faction would die at once", async () => {
    apiWith();
    mount(<FactionTransferPanel modDataDir="C:/mod" onClose={() => { }} />);
    await settle();
    click(document.querySelector('[data-dormant-faction="minaeans"]'));
    await settle();
    click(document.querySelector('[data-town="Qarnawu"]'));
    click(document.querySelector('[data-town="Nagran"]'));
    expect(button(/Bring in/).disabled).toBe(true);
    expect(button(/Bring in/).title).toMatch(/dies on the first turn/);
  });

  it("says so when there is no fuller mod to take a roster from", async () => {
    apiWith({ factionTransferScan: () => Promise.resolve({ ...SCAN, source: null }) });
    mount(<FactionTransferPanel modDataDir="C:/mod" onClose={() => { }} />);
    await settle();
    expect(text()).toMatch(/No fuller mod was found/);
    expect(button(/Bring in/)).toBeFalsy();
  });

  it("shows the scan's error rather than an empty panel", async () => {
    apiWith({ factionTransferScan: () => Promise.resolve({ error: "no campaign with a descr_strat.txt in this mod" }) });
    mount(<FactionTransferPanel modDataDir="C:/mod" onClose={() => { }} />);
    await settle();
    expect(text()).toMatch(/no campaign with a descr_strat/);
  });
});
