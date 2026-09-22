// @vitest-environment jsdom
// The ☥ New Faction panel. What must hold: it warns at the engine's ceiling
// before anything is created, it will not let a faction be created without the
// things the engine destroys it for lacking (a town, a leader, an heir with a
// different name, a free token), it defaults the family out of the donor's name
// pool, and "Create faction" sends exactly what was chosen.
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import NewFactionPanel from "./panels/NewFactionPanel.js";

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
const typeIn = (sel, value) => {
  const el = document.querySelector(sel);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  flushSync(() => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
  return el;
};

const SCAN = {
  modDataDir: "C:/RIS/RIS/data", campaign: "imperial_campaign", campaigns: ["imperial_campaign"],
  count: 239, cap: 239, atCap: true, missingFiles: [], haveRecruitment: true,
  donors: [
    { faction: "parni", culture: "eastern", namelistMen: "parni_men", settlements: 1, inCampaign: true },
    { faction: "pontus", culture: "eastern", namelistMen: "pontus_men", settlements: 6, inCampaign: true },
  ],
};
const DONOR = {
  donor: "parni", culture: "eastern", namelists: { men: "parni_men", women: "parni_women" },
  names: ["Arsakes", "Orodes", "Phraates"], aiLabel: "ai_east",
  settlements: [
    { region: "Parnia", city: "Nisa", level: "large_town", owner: "parni", suggested: true, x: 200, y: 150 },
    { region: "Pontus", city: "Sinope", level: "city", owner: "pontus", suggested: false, x: 180, y: 160 },
  ],
  recruit: [
    { line: 40, building: "barracks", level: "muster_field", unit: "parni horse archers", kind: "recruit", text: "…" },
    { line: 52, building: "alias steppe_chain", level: null, unit: null, kind: "building", text: "…" },
  ],
  recruitCount: 2,
};

function api(over = {}) {
  const calls = [];
  window.electronAPI = {
    newFactionScan: (...a) => { calls.push(["scan", ...a]); return Promise.resolve(over.scan || SCAN); },
    newFactionDonor: (...a) => { calls.push(["donor", ...a]); return Promise.resolve(over.donor || DONOR); },
    newFactionApply: (dir, choice) => { calls.push(["apply", dir, choice]); return Promise.resolve(over.apply || { ok: true, summary: { files: ["smFactions", "strat"], strat: { settlements: [{ region: "Pontus", from: "pontus" }], leader: "Arsakes", heir: "Orodes", at: { x: 180, y: 160 } }, art: 7, artMissing: 0, recruitChanged: 1 }, warnings: [], copied: [] }); },
  };
  return calls;
}
const open = async (over) => {
  const calls = api(over);
  mount(<NewFactionPanel modDataDir="C:/RIS/RIS/data" campaign="imperial_campaign" factionDisplayNames={{ parni: "Parni", pontus: "Pontus" }} pushToast={() => { }} onClose={() => { }} />);
  await settle();
  return calls;
};
const pickDonor = async () => { click(document.querySelector('[data-donor="parni"]')); await settle(); };

describe("NewFactionPanel", () => {
  it("warns at the engine's ceiling before anything is created", async () => {
    await open();
    expect(text()).toMatch(/already declares 239 factions/);
    expect(text()).toMatch(/240th may fail to load|239 is as far as the engine/);
  });

  it("does not warn about a ceiling the mod is nowhere near", async () => {
    await open({ scan: { ...SCAN, count: 30, atCap: false } });
    expect(text()).not.toMatch(/as far as the engine is known to go/);
  });

  it("defaults the leader and heir from the donor's name pool, and they differ", async () => {
    await open();
    await pickDonor();
    const [leaderSel, heirSel] = [...document.querySelectorAll("select")];
    expect(leaderSel.value).toBe("Arsakes");
    expect(heirSel.value).toBe("Orodes");
    expect([...leaderSel.options].map((o) => o.value)).toEqual(["Arsakes", "Orodes", "Phraates"]);
  });

  it("names the current owner of every town on offer", async () => {
    await open();
    await pickDonor();
    expect(document.querySelector('[data-town="Pontus"]').textContent).toMatch(/Sinope.*Pontus/);
  });

  it("will not create without a town, however complete the rest is", async () => {
    const calls = await open();
    await pickDonor();
    typeIn('input[aria-label="Faction token"]', "tocharians");
    await settle();
    expect(button(/Create faction/).disabled).toBe(true); // no town yet
    click(document.querySelector('[data-town="Pontus"]'));
    await settle();
    expect(button(/Create faction/).disabled).toBe(false);
    expect(calls.filter((c) => c[0] === "apply")).toHaveLength(0);
  });

  it("refuses a token that is taken, and says so", async () => {
    await open();
    await pickDonor();
    typeIn('input[aria-label="Faction token"]', "pontus");
    click(document.querySelector('[data-town="Pontus"]'));
    await settle();
    expect(text()).toMatch(/pontus already exists in this mod/);
    expect(button(/Create faction/).disabled).toBe(true);
  });

  it("keeps a token to what the engine accepts", async () => {
    await open();
    await pickDonor();
    const el = typeIn('input[aria-label="Faction token"]', "Tocharians 2!");
    await settle();
    expect(el.value).toBe("tocharians_2_"); // upper case and punctuation cannot survive
  });

  it("sends exactly what was chosen, and previews without writing", async () => {
    const calls = await open();
    await pickDonor();
    typeIn('input[aria-label="Faction token"]', "tocharians");
    typeIn('input[aria-label="Display name"]', "Tocharians");
    click(document.querySelector('[data-town="Pontus"]'));
    click(document.querySelector('[data-recruit="40"]'));
    await settle();

    click(button(/Preview/));
    await settle();
    const dry = calls.find((c) => c[0] === "apply")[2];
    expect(dry.dryRun).toBe(true);

    click(button(/Create faction/));
    await settle();
    const sent = calls.filter((c) => c[0] === "apply").pop()[2];
    expect(sent).toMatchObject({
      donor: "parni", newId: "tocharians", displayName: "Tocharians", aiLabel: "ai_east",
      settlements: ["Pontus"], leader: { name: "Arsakes", age: 40 }, heir: { name: "Orodes", age: 20 },
      recruitLines: [40],
    });
    expect(sent.dryRun).toBeFalsy();
  });

  it("says plainly when the mod is missing a file the engine needs", async () => {
    await open({ scan: { ...SCAN, atCap: false, count: 30, missingFiles: ["descr_banners.txt"] } });
    expect(text()).toMatch(/Missing from this mod: descr_banners\.txt/);
  });
});
