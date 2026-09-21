// @vitest-environment jsdom
// Extinction Watch: the head-count rules (pure) and the panel's three states
// (no mod · empty · populated), filter chips and expansion.
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { assessFaction, assessAll, assessLand, isFamily, fullName } from "./extinctionWatch.js";
import { createRequire } from "node:module";
const { parseHordeFactions } = createRequire(import.meta.url)("./hordeFactions.js");
import ExtinctionWatchPanel from "./panels/ExtinctionWatchPanel.js";

// No testing-library in this repo: mount with react-dom, drive with real DOM events
// (the panel portals into document.body, so queries run against the document).
let container, root;
function mount(el) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => root.render(el));
}
afterEach(() => {
  if (root) { try { flushSync(() => root.unmount()); } catch { /* */ } root = null; }
  if (container && container.parentNode) container.parentNode.removeChild(container);
  container = null;
});
const text = () => document.body.textContent;
const fire = (node, type, init) => flushSync(() => { node.dispatchEvent(type === "keydown" ? new KeyboardEvent(type, { bubbles: true, ...init }) : new MouseEvent(type, { bubbles: true, ...init })); });
const byText = (t) => [...document.body.querySelectorAll("span,div,button")].reverse().find((n) => n.children.length === 0 && n.textContent.trim() === t);
const tiersShown = () => [...document.querySelectorAll("[data-extinction-row]")].map((r) => r.getAttribute("data-extinction-row"));

const char = (firstName, lastName, age, extra = {}) => ({ firstName, lastName, age, gender: "male", alive: true, isCharacter: true, role: "named character", tags: [], x: 10, y: 10, ...extra });
const rec = (firstName, lastName, age, gender = "male", alive = true) => ({ firstName, lastName, age, gender, alive, isCharacter: false, role: "family_member", tags: [] });

describe("extinctionWatch — who counts", () => {
  it("named characters and family records are family; admirals and agents are not", () => {
    expect(isFamily(char("A", "B", 30))).toBe(true);
    expect(isFamily(rec("A", "B", 8))).toBe(true);
    expect(isFamily(char("A", "B", 30, { role: "admiral" }))).toBe(false);
    expect(isFamily(char("A", "B", 30, { role: "spy" }))).toBe(false);
  });

  it("counts living ADULT males only — women, the dead, boys and admirals never raise the count", () => {
    const r = assessFaction("test", { members: [
      char("Ashoka", "Maurya", 34, { tags: ["leader"] }),
      char("Nearchos", null, 40, { role: "admiral" }),
      rec("Kunala", "Maurya", 15),
      rec("Tivala", "Maurya", 9),
      rec("Devi", "Maurya", 30, "female"),
      rec("Bindusara", "Maurya", 70, "male", false),
    ] });
    expect(r.adultMales).toBe(1);
    expect(r.tier).toBe("critical");
    expect(r.leader).toBe("Ashoka Maurya");
    expect(r.boys.map((b) => b.name)).toEqual(["Kunala Maurya", "Tivala Maurya"]);
    expect(r.nextOfAgeIn).toBe(1); // the eldest boy is 15, coming of age at 16
  });

  it("tiers: 1 critical · 2–3 fragile · 4+ secure; a faction with NO family is 'none', never 'extinct'", () => {
    const n = (k) => assessFaction("f", { members: Array.from({ length: k }, (_, i) => char("M" + i, "X", 30, { x: i, y: i })) }).tier;
    expect([n(1), n(2), n(3), n(4), n(9)]).toEqual(["critical", "fragile", "fragile", "secure", "secure"]);
    expect(assessFaction("slave", { members: [] }).tier).toBe("none");
    expect(assessFaction("slave", undefined).noFamily).toBe(true);
    // a family of women and boys only IS extinct-tier: there is a line, and no adult male in it
    expect(assessFaction("f", { members: [rec("A", "X", 30, "female"), rec("B", "X", 5)] }).tier).toBe("extinct");
  });

  it("flags: an all-elderly line, a line on one tile, and no boys coming", () => {
    const old = assessFaction("f", { members: [char("A", "X", 66, { x: 1, y: 1 }), char("B", "X", 61, { x: 2, y: 2 })] });
    expect(old.flags).toContain("every adult male is 60+");
    expect(old.flags).toContain("no boys to come of age");
    const stack = assessFaction("f", { members: [char("A", "X", 30, { x: 5, y: 5 }), char("B", "X", 25, { x: 5, y: 5 })] });
    expect(stack.oneStack).toBe(true);
    expect(stack.flags).toContain("every adult male stands on the same tile");
    // an off-map adult (family record) means they are NOT all in one stack
    const mixed = assessFaction("f", { members: [char("A", "X", 30, { x: 5, y: 5 }), rec("B", "X", 25)] });
    expect(mixed.oneStack).toBe(false);
  });

  it("underscores in either name are spaces", () => {
    expect(fullName({ firstName: "Biggus_Dickus", lastName: "Ogulnius_Gallus" })).toBe("Biggus Dickus Ogulnius Gallus");
  });

  it("assessAll puts the most endangered first and breaks ties by what is at stake", () => {
    const fam = {
      big: { members: [char("A", "X", 30)] },
      small: { members: [char("B", "Y", 30)] },
      safe: { members: [0, 1, 2, 3].map((i) => char("C" + i, "Z", 30, { x: i, y: i })) },
      empty: { members: [] },
    };
    const { rows, summary } = assessAll(fam, { big: 40, small: 2, safe: 10 });
    expect(rows.map((r) => r.faction)).toEqual(["big", "small", "safe", "empty"]);
    expect(summary).toMatchObject({ extinct: 0, critical: 2, fragile: 0, secure: 1, none: 1 });
  });
});

describe("ExtinctionWatchPanel", () => {
  const fam = {
    mauryan: { members: [char("Ashoka", "Maurya", 34, { tags: ["leader"] }), rec("Kunala", "Maurya", 15)] },
    romans_julii: { members: [0, 1, 2, 3, 4].map((i) => char("Gaius" + i, "Julius", 30 + i, { x: i, y: i })) },
  };

  it("says so when no mod is loaded", () => {
    mount(<ExtinctionWatchPanel familiesByFaction={null} onClose={() => { }} />);
    expect(text()).toMatch(/No mod loaded/);
  });

  it("says so when a campaign records no families", () => {
    mount(<ExtinctionWatchPanel familiesByFaction={{}} onClose={() => { }} />);
    expect(text()).toMatch(/records no family members/);
  });

  it("lists the endangered faction first, expands to its line, and the tier chip filters", () => {
    mount(<ExtinctionWatchPanel familiesByFaction={fam} settlementCount={{ mauryan: 19 }} factionDisplayNames={{ mauryan: "Mauryan Empire" }} onClose={() => { }} />);
    expect(tiersShown()).toEqual(["critical", "secure"]);
    expect(text()).toMatch(/19 towns/);
    expect(text()).not.toMatch(/Ashoka Maurya/); // collapsed until clicked
    fire(byText("Mauryan Empire"), "click");
    expect(text()).toMatch(/Ashoka Maurya/);
    expect(text()).toMatch(/the eldest comes of age in 1 year/);
    fire(document.querySelector('button[title^="Four or more living adult males"]'), "click");
    expect(tiersShown()).toEqual(["secure"]);
  });

  it("double-click hands the faction to the map; Escape closes", () => {
    let picked = null, closed = 0;
    mount(<ExtinctionWatchPanel familiesByFaction={fam} onPickFaction={(f) => { picked = f; }} onClose={() => { closed++; }} />);
    fire(byText("mauryan"), "dblclick");
    expect(picked).toBe("mauryan");
    fire(window, "keydown", { key: "Escape" });
    expect(closed).toBe(1);
  });
});

describe("the second route: the last settlement, and the horde exception", () => {
  it("one settlement and no horde block = one siege from destruction; a horde faction is spared", () => {
    expect(assessLand(1, null)).toMatchObject({ lastTown: true, canHorde: false, hordeSaves: false });
    expect(assessLand(1, { maxUnits: 40 })).toMatchObject({ lastTown: false, canHorde: true, hordeSaves: true });
    expect(assessLand(2, null).lastTown).toBe(false);
    expect(assessLand(0, null).lastTown).toBe(false);   // holds nothing: emergent or already hording — not "one siege away"
    expect(assessLand(null, null).lastTown).toBe(false); // count unknown → no accusation
  });

  it("assessAll counts both and ranks a last-town faction above its tier-mates", () => {
    const fam = { twoTowns: { members: [char("A", "X", 30)] }, oneTown: { members: [char("B", "Y", 30)] }, nomad: { members: [char("C", "Z", 30)] } };
    const { rows, summary } = assessAll(fam, { twoTowns: 2, oneTown: 1, nomad: 1 }, { nomad: { maxUnits: 40 } });
    expect(rows[0].faction).toBe("oneTown");
    expect(summary.lastTown).toBe(1);
    expect(summary.canHorde).toBe(1);
    expect(rows.find((r) => r.faction === "nomad").landNote).toMatch(/can horde/);
  });

  it("parseHordeFactions reads horde blocks and ignores a commented-out one", () => {
    const txt = ['"factions":', "{", '	"parni":', "	{", '		"horde":', "		{", '			"min horde units": 100,', '			"max horde units": 100,', '			"horde unit reduction per horde": 100, ;; a comment', "		},", "	},",
      '	"romans_julii":', "	{", '		;"horde":', "		;{", '		;	"max horde units": 40,', "		;},", "	},", "}"].join(String.fromCharCode(13, 10));
    const h = parseHordeFactions(txt);
    expect(Object.keys(h)).toEqual(["parni"]);
    expect(h.parni).toMatchObject({ minUnits: 100, maxUnits: 100, reductionPerHorde: 100 });
  });

  it("the panel marks last-town factions only once the horde list has been read, and spares the horde faction", async () => {
    const fam = { oneTown: { members: [char("B", "Y", 30)] }, nomad: { members: [char("C", "Z", 30)] } };
    window.electronAPI = { getHordeFactions: () => Promise.resolve({ factions: { nomad: { maxUnits: 40 } } }) };
    mount(<ExtinctionWatchPanel familiesByFaction={fam} settlementCount={{ oneTown: 1, nomad: 1 }} modDataDir="C:/x" onClose={() => { }} />);
    expect(text()).not.toMatch(/taking it destroys the faction/); // nothing claimed before the read lands
    await new Promise((r) => setTimeout(r, 0));
    flushSync(() => { });
    expect(text()).toMatch(/taking it destroys the faction/);
    expect(text()).toMatch(/it can horde instead of dying/);
    fire(document.querySelector('button[title^="Factions holding exactly one settlement"]'), "click");
    expect(tiersShown().length).toBe(1);
    delete window.electronAPI;
  });
});
