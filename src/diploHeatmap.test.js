// Hermetic tests for the diplomacy-heatmap model (src/diploHeatmap.js).
// Synthetic matrix only — no save files, no IPC, no DOM.
import { describe, test, expect } from "vitest";
import { buildHeatmapModel, cellKey, getCell, isRealFaction } from "./diploHeatmap";

// Synthetic decoded matrix in the exact shape parseDiplomacyMatrix emits:
// per-faction rows { war, allied, hostile, trade, protectorates, suzerains, rel }
// plus a _meta row that consumers must skip. War is recorded ONE-SIDED on
// romans_julii (the symmetric-union case) and carthage's row is deliberately
// empty toward romans_julii to prove b|a lookups still resolve.
const mkRow = (o = {}) => ({
  war: [], allied: [], hostile: [], trade: [], protectorates: [], suzerains: [], rel: [], ...o,
});
const MATRIX = {
  romans_julii: mkRow({
    war: ["carthage", "slave"], // slave = placeholder target, not a grid column
    allied: ["egypt"],
    trade: ["egypt", "numidia"],           // bond >= 54 (ally OR protectorate bond)
    protectorates: ["numidia"],            // numidia is julii's client
    hostile: ["gauls"],
    rel: [
      { to: "carthage", att: 600, bond: 6, agg: 120, turnsAllied: 0, turnsAtWar: 4 },
      { to: "egypt", att: 0, bond: 54, agg: -50, turnsAllied: 9, turnsAtWar: 0 },
      { to: "gauls", att: 400, bond: 6, agg: 300, turnsAllied: 0, turnsAtWar: 0 },
      { to: "numidia", att: 200, bond: 54, agg: 0, turnsAllied: 0, turnsAtWar: 0 },
    ],
  }),
  carthage: mkRow({
    war: ["egypt"], // carthage also fights egypt (its only listed war here)
    rel: [{ to: "egypt", att: 600, bond: 6, agg: 200, turnsAllied: 0, turnsAtWar: 2 }],
  }),
  egypt: mkRow({ allied: ["romans_julii"], trade: ["romans_julii"] }),
  gauls: mkRow(),
  numidia: mkRow({ suzerains: ["romans_julii"], trade: ["romans_julii"] }),
  iberia: mkRow({ trade: ["gauls"] }), // bond without allied state → "trade" cell
  gauls_extra_pad: undefined, // eslint-disable-line no-undefined -- not present; placeholder for clarity
  _meta: { base: 0, stride: 267, key: 1, C: 0, N: 7, symmetry: 1, warPairs: 2 },
};
delete MATRIX.gauls_extra_pad;
MATRIX.gauls.trade = ["iberia"];

const CULTURES = {
  romans_julii: "roman",
  carthage: "carthaginian",
  egypt: "egyptian",
  gauls: "barbarian",
  numidia: "carthaginian",
  iberia: "barbarian",
};

// Liveness signal: allFactionDiplomacy keys = factions with a diplomacy zone
// in the save. "iberia" is missing → dead under aliveOnly.
const ALIVE = {
  romans_julii: { wars: 2, allies: 1, ceasefires: 0, locked: 0, neutral: 4, count: 7, relationCount: 3 },
  carthage: { wars: 1, allies: 0, ceasefires: 0, locked: 0, neutral: 2, count: 3, relationCount: 1 },
  egypt: { wars: 1, allies: 1, ceasefires: 0, locked: 0, neutral: 1, count: 3, relationCount: 2 },
  gauls: { wars: 0, allies: 0, ceasefires: 0, locked: 0, neutral: 1, count: 1, relationCount: 0 },
  numidia: { wars: 0, allies: 1, ceasefires: 0, locked: 0, neutral: 0, count: 1, relationCount: 1 },
};

describe("cellKey / getCell — symmetric pair addressing", () => {
  test("cellKey is order-independent and lowercased", () => {
    expect(cellKey("b", "a")).toBe("a|b");
    expect(cellKey("a", "b")).toBe("a|b");
    expect(cellKey("Carthage", "romans_julii")).toBe(cellKey("ROMANS_JULII", "carthage"));
  });
  test("getCell resolves both argument orders to the same cell", () => {
    const m = buildHeatmapModel({ diplomacyMatrix: MATRIX });
    const ab = getCell(m, "romans_julii", "carthage");
    const ba = getCell(m, "carthage", "romans_julii");
    expect(ab).toBeTruthy();
    expect(ba).toBe(ab);
  });
});

describe("buildHeatmapModel — cell states", () => {
  const m = buildHeatmapModel({ diplomacyMatrix: MATRIX, factionCultures: CULTURES });

  test("one-sided war decodes as war for the pair (symmetric union)", () => {
    // carthage's row does NOT list romans_julii; julii's row does.
    expect(getCell(m, "carthage", "romans_julii").state).toBe("war");
    expect(getCell(m, "egypt", "carthage").state).toBe("war");
  });
  test("war outranks allied/trade (carthage-egypt has no bond; julii-egypt allied)", () => {
    expect(getCell(m, "romans_julii", "egypt").state).toBe("allied");
  });
  test("protectorate outranks allied/trade and is read from either side", () => {
    expect(getCell(m, "romans_julii", "numidia").state).toBe("protectorate");
  });
  test("bond without allied state is trade", () => {
    expect(getCell(m, "gauls", "iberia").state).toBe("trade");
  });
  test("hostile (attitude 400) is hostile, not war", () => {
    expect(getCell(m, "romans_julii", "gauls").state).toBe("hostile");
  });
  test("no relation either way → neutral (cell omitted from sparse map)", () => {
    expect(getCell(m, "egypt", "gauls")).toBeNull();
  });
  test("numeric attitude value carried from rel when present, else null", () => {
    expect(getCell(m, "romans_julii", "carthage").value).toBe(600);
    expect(getCell(m, "romans_julii", "egypt").value).toBe(0);
    expect(getCell(m, "gauls", "iberia").value).toBeNull();
  });
  test("placeholder rows/targets (slave, _rebels, _meta) never appear", () => {
    expect(isRealFaction("slave")).toBe(false);
    expect(isRealFaction("roman_rebels_1")).toBe(false);
    expect(m.order).not.toContain("slave");
    expect(m.order).not.toContain("_meta");
    for (const k of Object.keys(m.cells)) expect(k).not.toMatch(/slave|_meta/);
  });
});

describe("buildHeatmapModel — orderings", () => {
  const m = buildHeatmapModel({ diplomacyMatrix: MATRIX, factionCultures: CULTURES });

  test("all three orderings exist and are permutations of the same set", () => {
    const base = [...m.orders.alphabetical].sort();
    expect([...m.orders.culture].sort()).toEqual(base);
    expect([...m.orders.wars].sort()).toEqual(base);
    expect(m.order).toEqual(m.orders.alphabetical);
  });
  test("alphabetical is sorted by label/id", () => {
    expect(m.orders.alphabetical).toEqual(
      ["carthage", "egypt", "gauls", "iberia", "numidia", "romans_julii"]);
  });
  test("culture ordering clusters same-culture factions adjacently", () => {
    const cultures = m.orders.culture.map((id) => CULTURES[id]);
    // adjacency: each culture appears in exactly one contiguous run
    const seen = new Set();
    let prev = null;
    for (const c of cultures) {
      if (c !== prev) { expect(seen.has(c)).toBe(false); seen.add(c); prev = c; }
    }
    // carthaginians (carthage + numidia) are neighbors
    const iC = m.orders.culture.indexOf("carthage");
    const iN = m.orders.culture.indexOf("numidia");
    expect(Math.abs(iC - iN)).toBe(1);
  });
  test("wars ordering is war count descending", () => {
    // carthage: 2 wars (julii, egypt); julii: 1; egypt: 1; rest 0
    expect(m.orders.wars[0]).toBe("carthage");
    const counts = m.orders.wars.map((id) => m.warCounts[id]);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
  });
  test("displayNames drive alphabetical order when provided", () => {
    const m2 = buildHeatmapModel({
      diplomacyMatrix: MATRIX,
      displayNames: { romans_julii: "AAA Julii" }, // force to front
    });
    expect(m2.orders.alphabetical[0]).toBe("romans_julii");
  });
});

describe("buildHeatmapModel — aliveOnly filtering", () => {
  test("drops factions absent from the allFactionDiplomacy liveness signal", () => {
    const m = buildHeatmapModel({
      diplomacyMatrix: MATRIX, allFactionDiplomacy: ALIVE, aliveOnly: true,
    });
    expect(m.aliveFiltered).toBe(true);
    expect(m.order).not.toContain("iberia");
    expect(m.order).toContain("romans_julii");
    // cells involving the dropped faction are gone too
    expect(getCell(m, "gauls", "iberia")).toBeNull();
  });
  test("keeps everything when the signal is missing (and flags it)", () => {
    const m = buildHeatmapModel({ diplomacyMatrix: MATRIX, aliveOnly: true });
    expect(m.aliveFiltered).toBe(false);
    expect(m.order).toContain("iberia");
  });
  test("aliveOnly=false keeps everything even with a signal present", () => {
    const m = buildHeatmapModel({
      diplomacyMatrix: MATRIX, allFactionDiplomacy: ALIVE, aliveOnly: false,
    });
    expect(m.order).toContain("iberia");
  });
  test("explicit factions list restricts the grid", () => {
    const m = buildHeatmapModel({
      diplomacyMatrix: MATRIX, factions: ["romans_julii", "carthage"],
    });
    expect(m.order).toEqual(["carthage", "romans_julii"]);
    expect(m.stats.wars).toBe(1);
  });
});

describe("buildHeatmapModel — stats", () => {
  const m = buildHeatmapModel({ diplomacyMatrix: MATRIX, factionCultures: CULTURES });

  test("war and alliance pair counts", () => {
    // wars: julii-carthage, carthage-egypt = 2 (slave war excluded — not a column)
    expect(m.stats.wars).toBe(2);
    // alliances: julii-egypt (allied) + julii-numidia (protectorate) = 2
    expect(m.stats.alliances).toBe(2);
  });
  test("mostWarring sorted desc with per-faction counts", () => {
    expect(m.stats.mostWarring[0]).toEqual({ id: "carthage", wars: 2 });
    const ids = m.stats.mostWarring.map((e) => e.id);
    expect(ids).toContain("romans_julii");
    expect(ids).toContain("egypt");
    expect(ids).not.toContain("gauls");
  });
  test("empty/absent matrix yields an empty model, not a throw", () => {
    const e1 = buildHeatmapModel({});
    const e2 = buildHeatmapModel({ diplomacyMatrix: null });
    const e3 = buildHeatmapModel({ diplomacyMatrix: { _meta: { N: 0 } } });
    for (const e of [e1, e2, e3]) {
      expect(e.order).toEqual([]);
      expect(e.stats.wars).toBe(0);
      expect(Object.keys(e.cells)).toHaveLength(0);
    }
  });
});
