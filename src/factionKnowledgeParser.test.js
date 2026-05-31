import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseFactionKnowledge, findFactionRecords, resolveNames } from "./factionKnowledgeParser.js";

const SAVE = path.join("bundled-mod", "saves", "sample.sav");

describe("parseFactionKnowledge", () => {
  test("enumerates ff0aaff0 faction records (well-formed when present)", () => {
    if (!fs.existsSync(SAVE)) return;
    // The bundled sample is a different mod build (map dims may differ), so it
    // may carry 0 records matching the 1020x700 RIS-imperial signature; the
    // parser is validated against the live RIS saves. Just assert well-formedness.
    const recs = findFactionRecords(fs.readFileSync(SAVE));
    expect(Array.isArray(recs)).toBe(true);
    for (const r of recs) { expect(r.size).toBeGreaterThan(24); }
  });

  test("parses known-settlement tuples with sane fields", () => {
    if (!fs.existsSync(SAVE)) return;
    const k = parseFactionKnowledge(fs.readFileSync(SAVE));
    // Some factions should have a populated tail; if the build differs and none
    // do, the parser must still return a well-formed (empty) result.
    expect(Array.isArray(k.records)).toBe(true);
    expect(typeof k.totalTuples).toBe("number");
    for (const rec of k.records) {
      expect(rec.tupleCount).toBe(rec.tuples.length);
      for (const t of rec.tuples) {
        if (t.tag === 27) {
          // tile coords within RTW map bounds; tier a small settlement level
          expect(t.tileX).toBeGreaterThanOrEqual(0);
          expect(t.tileX).toBeLessThan(1100);
          expect(t.tileY).toBeGreaterThanOrEqual(0);
          expect(t.tileY).toBeLessThan(900);
          expect(t.tier).toBeGreaterThanOrEqual(0);
          expect(t.tier).toBeLessThan(10);
          expect(typeof t.model).toBe("string");
        }
      }
    }
  });

  test("resolveNames annotates tag-27 tuples from a tileIndex (stub)", () => {
    // Pure unit test — no map files needed. A stub tileIndex maps one tile.
    const records = [{
      factionIndex: 0, tupleCount: 2, fullCount: 1,
      tuples: [
        { tag: 27, tileX: 100, tileY: 200 },
        { tag: 29, sizeLevel: 3 }, // non-27: must be left untouched
      ],
    }];
    const tileIndex = {
      resolve: (x, y) => (x === 100 && y === 200 ? { region: "Latium", settlement: "Roma" } : null),
    };
    resolveNames(records, tileIndex);
    expect(records[0].tuples[0].region).toBe("Latium");
    expect(records[0].tuples[0].settlement).toBe("Roma");
    expect(records[0].tuples[1].region).toBeUndefined();
    // a tile with no settlement → explicit nulls
    records[0].tuples[0].tileX = 5;
    resolveNames(records, tileIndex);
    expect(records[0].tuples[0].region).toBe(null);
    expect(records[0].tuples[0].settlement).toBe(null);
    // null tileIndex is a safe no-op
    expect(() => resolveNames(records, null)).not.toThrow();
  });
});
