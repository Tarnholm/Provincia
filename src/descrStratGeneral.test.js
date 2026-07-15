// Unit tests for descrStratGeneral pure helpers — the name-list / token logic
// behind the "Add General" save editor. Pure functions (no disk IO), tested
// with small synthetic inputs. Guards the save-corruption-adjacent paths:
// a mis-minted or duplicate name token breaks campaign start.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  parseNamesTxt,
  parseLookup,
  isFamilyToken,
  parseNamelistPools,
  insertNamelistTokens,
  parseSmFactionNamelists,
  findDuplicateNames,
  resolveFreeToken,
} = require("./descrStratGeneral.js");

describe("parseNamesTxt", () => {
  it("maps tokens to displays and groups tokens by shared display", () => {
    const { tokenToDisplay, displayToTokens } = parseNamesTxt(
      "{Gaius}Gaius\n{GaiusA}Gaius\n{Ogulnius_Gallus}Ogulnius Gallus\n; a comment\nnoise",
    );
    expect(tokenToDisplay.get("GaiusA")).toBe("Gaius");
    expect(tokenToDisplay.get("Ogulnius_Gallus")).toBe("Ogulnius Gallus");
    expect(displayToTokens.get("Gaius")).toEqual(["Gaius", "GaiusA"]);
    expect(displayToTokens.get("Ogulnius Gallus")).toEqual(["Ogulnius_Gallus"]);
  });

  it("strips a leading BOM and ignores non-matching lines", () => {
    const { tokenToDisplay } = parseNamesTxt("﻿{Marcus}Marcus\n");
    expect(tokenToDisplay.get("Marcus")).toBe("Marcus");
    expect(tokenToDisplay.size).toBe(1);
  });
});

describe("parseLookup", () => {
  it("returns a set of non-empty trimmed tokens", () => {
    const set = parseLookup("Gaius\nGaiusA\n\n  \nOgulnius_Gallus\n");
    expect(set.has("Gaius")).toBe(true);
    expect(set.has("Ogulnius_Gallus")).toBe(true);
    expect(set.size).toBe(3);
  });
});

describe("isFamilyToken", () => {
  it("treats underscore tokens as family names", () => {
    expect(isFamilyToken("Ogulnius_Gallus")).toBe(true);
    expect(isFamilyToken("Gaius")).toBe(false);
  });
});

describe("parseNamelistPools", () => {
  it("resolves inherited pools into the full effective name set", () => {
    const text = `
      "greek_men" : { "names" : [ "Alexandros", "Philippos" ] }
      "bosporan_men" : { "inherit" : "greek_men" "names" : [ "Spartokos" ] }
    `;
    const pools = parseNamelistPools(text);
    expect(pools.greek_men).toEqual(["Alexandros", "Philippos"]);
    // own names first, then inherited, de-duplicated
    expect(pools.bosporan_men).toEqual(["Spartokos", "Alexandros", "Philippos"]);
  });

  it("terminates and dedupes on a cyclic inherit chain", () => {
    const text = `"a" : { "inherit" : "b" "names" : [ "x" ] } "b" : { "inherit" : "a" "names" : [ "y" ] }`;
    const pools = parseNamelistPools(text);
    expect(new Set(pools.a)).toEqual(new Set(["x", "y"]));
    expect(new Set(pools.b)).toEqual(new Set(["x", "y"]));
  });

  it("returns {} for empty input", () => {
    expect(parseNamelistPools("")).toEqual({});
  });
});

describe("insertNamelistTokens", () => {
  const raw = '"greek_men" : {\n\t\t\t"names" : [\n\t\t\t"Alexandros",\n\t\t\t]\n}';

  it("inserts only tokens not already present", () => {
    const out = insertNamelistTokens(raw, "greek_men", ["Philippos", "Alexandros"]);
    expect(out).toContain('"Philippos"');
    expect(out).toContain('"Alexandros"'); // original preserved
    // Alexandros was already present, so it must not be duplicated by the insert
    expect((out.match(/"Alexandros"/g) || []).length).toBe(1);
  });

  it("returns null when every token is already present", () => {
    expect(insertNamelistTokens(raw, "greek_men", ["Alexandros"])).toBeNull();
  });

  it("returns null when the pool is not found", () => {
    expect(insertNamelistTokens(raw, "roman_men", ["Marcus"])).toBeNull();
  });

  it("returns null for an empty token list", () => {
    expect(insertNamelistTokens(raw, "greek_men", [])).toBeNull();
  });
});

describe("parseSmFactionNamelists", () => {
  it("extracts per-faction men/women namelist references", () => {
    const text =
      '\t"romans_julii": {\n\t\t"namelists": {\n\t\t\t"men": "roman_men",\n\t\t\t"women": "roman_women"\n\t\t}\n\t}\n' +
      '\t"greek_cities": {\n\t\t"namelists": {\n\t\t\t"men": "greek_men"\n\t\t}\n\t}';
    const out = parseSmFactionNamelists(text);
    expect(out.romans_julii).toEqual({ men: "roman_men", women: "roman_women" });
    expect(out.greek_cities).toEqual({ men: "greek_men", women: null });
  });

  it("returns {} for empty input", () => {
    expect(parseSmFactionNamelists("")).toEqual({});
  });
});

describe("findDuplicateNames", () => {
  it("reports name keys used more than once across characters + records", () => {
    const fac = {
      characters: [
        { firstTok: "Gaius", famTok: "Iulius" },
        { firstTok: "Gaius", famTok: "Iulius" },
        { firstTok: "Lucius", famTok: "Cornelius" },
      ],
      characterRecords: [{ firstTok: "Marcus", famTok: null }],
    };
    expect(findDuplicateNames(fac)).toEqual([{ key: "Gaius Iulius", count: 2 }]);
  });

  it("returns [] when all names are unique", () => {
    const fac = {
      characters: [{ firstTok: "Gaius", famTok: "Iulius" }],
      characterRecords: [{ firstTok: "Marcus", famTok: null }],
    };
    expect(findDuplicateNames(fac)).toEqual([]);
  });
});

describe("resolveFreeToken", () => {
  const names = parseNamesTxt("{Gaius}Gaius\n{GaiusA}Gaius\n{GaiusB}Gaius");

  it("returns the first free existing variant without minting", () => {
    expect(resolveFreeToken("Gaius", names, new Set())).toEqual({ token: "Gaius", mint: false });
    expect(resolveFreeToken("Gaius", names, new Set(["Gaius", "GaiusA"]))).toEqual({
      token: "GaiusB",
      mint: false,
    });
  });

  it("mints the next unused letter when every variant is taken", () => {
    const used = new Set(["Gaius", "GaiusA", "GaiusB"]);
    const r = resolveFreeToken("Gaius", names, used);
    expect(r).toEqual({ token: "GaiusC", mint: true, display: "Gaius" });
  });

  it("mints from the display when the name has no existing variants", () => {
    const r = resolveFreeToken("Zeus", names, new Set());
    expect(r.mint).toBe(true);
    expect(r.token).toBe("ZeusA");
  });
});
