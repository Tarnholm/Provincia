import { describe, test, expect } from "vitest";
import {
  parseSmFactions,
  parseDescrRegions,
  parseDescrStratFactions,
  parseDescrStratBuildings,
  parseDescrStratResources,
  parseDescrStratArmies,
} from "./parsers.js";

describe("parseSmFactions", () => {
  test("extracts primary + secondary RGB from a minimal factions block", () => {
    const text = `
"factions":
[
  "romans_julii": ;Rome
  {
    "colours":
    {
      "primary":   [  165, 20,  20, ],
      "secondary": [  0,   0,   0,  ],
    },
  },
  "carthage":
  {
    "colours":
    {
      "primary":   [  50, 120, 255, ],
      "secondary": [ 255, 255, 255, ],
    },
  },
]
`;
    const result = parseSmFactions(text);
    expect(result.romans_julii).toEqual({ primary: [165, 20, 20], secondary: [0, 0, 0] });
    expect(result.carthage).toEqual({ primary: [50, 120, 255], secondary: [255, 255, 255] });
  });

  test("lowercases faction names and skips the 'factions' keyword", () => {
    const text = `
"factions":
[
  "ROMAN_REBELS":
  {
    "colours":
    {
      "primary":   [ 1, 2, 3, ],
      "secondary": [ 4, 5, 6, ],
    },
  },
]
`;
    const result = parseSmFactions(text);
    expect(Object.keys(result)).toEqual(["roman_rebels"]);
    expect(result.factions).toBeUndefined();
  });

  test("ignores family tree sub-block colors", () => {
    const text = `
"factions":
[
  "greek":
  {
    "colours":
    {
      "primary":   [ 10, 20, 30, ],
      "secondary": [ 40, 50, 60, ],
      "family tree":
      {
        "background": [ 99, 99, 99, ],
      },
    },
  },
]
`;
    const result = parseSmFactions(text);
    expect(result.greek.primary).toEqual([10, 20, 30]);
    expect(result.greek.secondary).toEqual([40, 50, 60]);
  });
});

describe("parseDescrRegions", () => {
  test("parses a single region block into an RGB-keyed entry", () => {
    const text = `
Etruria
Arretium
romans_julii
roman
100 50 25
foo, bar
3
2
mediterranean 90 celtic 10
`;
    const result = parseDescrRegions(text);
    expect(result["100,50,25"]).toMatchObject({
      region: "Etruria",
      city: "Arretium",
      faction: "romans_julii",
      culture: "roman",
      tags: "foo, bar",
      farm_level: "3",
      pop_level: "2",
      ethnicities: "mediterranean 90 celtic 10",
    });
  });

  test("skips blocks with malformed RGB", () => {
    const text = `
BadRegion
BadCity
nobody
none
not_rgb here
tags
1
1
none
GoodRegion
GoodCity
romans_julii
roman
7 8 9
tags
1
1
none
`;
    const result = parseDescrRegions(text);
    expect(Object.keys(result)).toEqual(["7,8,9"]);
  });
});

describe("parseDescrStratFactions", () => {
  test("groups settlements under their faction", () => {
    const text = `
faction romans_julii, balanced
settlement
{
  level town
  region Etruria
}
settlement
{
  level town
  region Umbria
}
faction carthage, balanced
settlement
{
  level town
  region Qart_Hadasht
}
`;
    const result = parseDescrStratFactions(text);
    expect(result.romans_julii).toEqual(["Etruria", "Umbria"]);
    expect(result.carthage).toEqual(["Qart_Hadasht"]);
  });

  test("omits factions with no settlements", () => {
    const text = `
faction empty_faction, balanced
faction real_faction, balanced
settlement
{
  region SomeRegion
}
`;
    const result = parseDescrStratFactions(text);
    expect(result.empty_faction).toBeUndefined();
    expect(result.real_faction).toEqual(["SomeRegion"]);
  });
});

describe("parseDescrStratBuildings", () => {
  test("extracts region, level, population, and buildings per settlement", () => {
    const text = `
; >>>> start of factions section <<<<
faction romans_julii, balanced
settlement
{
  level town
  region Etruria
  population 2500
  faction_creator romans_julii
  building
  {
    type hinterland_roads roman_roads
  }
  building
  {
    type farms farms
  }
}
`;
    const result = parseDescrStratBuildings(text);
    expect(result).toHaveLength(1);
    expect(result[0].faction).toBe("romans_julii");
    expect(result[0].settlements[0]).toMatchObject({
      region: "Etruria",
      level: "town",
      population: 2500,
      faction_creator: "romans_julii",
    });
    expect(result[0].settlements[0].buildings).toEqual([
      { type: "hinterland_roads", level: "roman_roads" },
      { type: "farms", level: "farms" },
    ]);
  });
});

describe("parseDescrStratResources", () => {
  test("parses resource lines and falls back to comment when no TGA provided", () => {
    const text = `
resource wine,           1,    100,  50   ; Etruria
resource olive_oil,      2,    120,  60   ; Umbria
`;
    const result = parseDescrStratResources(text, 350, null, null);
    expect(result.Etruria).toEqual([{ type: "wine", amount: 1, x: 100, y: 300 }]);
    expect(result.Umbria).toEqual([{ type: "olive_oil", amount: 2, x: 120, y: 290 }]);
  });

  test("skips resource lines without a region comment when no TGA", () => {
    const text = `
resource wine, 1, 100, 50
`;
    const result = parseDescrStratResources(text, 350, null, null);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe("parseDescrStratArmies", () => {
  test("captures army/navy entries with character names", () => {
    // Real descr_strat format: `character` line first (with name + coords),
    // then bare `army`/`navy` keyword, then `unit` lines until something
    // else. The character is the army's commander; the army has no name.
    const text = `
faction romans_julii, balanced
character Gaius Junius, general, age 40, , x 100, y 50
army
unit roman hastati    exp 0 armour 0 weapon_lvl 0
character Marcus Tullius, general, age 35, , x 200, y 80
army
unit roman triarii    exp 1 armour 0 weapon_lvl 0
faction carthage, balanced
character Hannibal Barca, admiral, age 30, , x 300, y 100
navy
unit naval bireme    exp 0 armour 0 weapon_lvl 0
`;
    const result = parseDescrStratArmies(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ faction: "romans_julii", type: "army", character: "Gaius Junius", x: 100, y: 50 });
    expect(result[0].units).toEqual([{ name: "roman hastati", exp: 0, armour: 0, weapon: 0 }]);
    expect(result[1]).toMatchObject({ faction: "romans_julii", type: "army", character: "Marcus Tullius" });
    expect(result[2]).toMatchObject({ faction: "carthage", type: "navy", character: "Hannibal Barca", armyClass: "navy" });
  });
});
