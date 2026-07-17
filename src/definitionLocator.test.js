// definitionLocator.test.js — hermetic tests for the "Where is this defined?"
// locator. Builds a synthetic mini-mod in a temp dir: latin1 data files plus
// one UTF-16LE-BOM text/ file. Covers: hits with correct lines/kinds, UTF-16
// decode, latin1 high-byte decode, whole-token vs fuzzy fallback, the
// 200-hit cap, and mtime-based cache invalidation. No real mod files touched.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { locateDefinition, clearDefinitionLocatorCache, _lineCache } from "./definitionLocator.js";

let root; // temp mini-mod root; data dir = root/data
let dataDir;

// Line numbers are asserted against these exact contents — keep in sync.
const EDU = [
  "; synthetic EDU",                       // 1
  "type                    roman legionaries", // 2
  "dictionary              roman_legionaries", // 3
  "category                infantry",       // 4
  "ownership               romans_julii",   // 5
  "",                                       // 6
  "type                    gaul élite swordsmen", // 7 (latin1 é)
  "dictionary              gaul_elite_swordsmen",      // 8
].join("\r\n");

const EDB = [
  "; synthetic EDB",                        // 1
  "building mines",                         // 2
  "{",                                      // 3
  "\tlevels mines mines+1",                 // 4
  "\t{",                                    // 5
  "\t\tmines requires resource gold",       // 6
  "\t\t{",                                  // 7
  "\t\t\tcapability",                       // 8
  "\t\t\t{",                                // 9
  '\t\t\t\trecruit "roman legionaries" 0 requires factions { romans_julii, }', // 10
  "\t\t\t}",                                // 11
  "\t\t}",                                  // 12
  "\t}",                                    // 13
  "}",                                      // 14
].join("\r\n");

const REGIONS = [
  "; synthetic descr_regions",              // 1
  "Etruria",                                // 2  region name
  "\tArretium",                             // 3  city name
  "\titalics",                              // 4
  "\tEtruscans",                            // 5
  "\t157 198 13",                           // 6
  "\titaly, rel_italic_4, Farm11",          // 7
  "\t5",                                    // 8
  "\t11",                                   // 9
  "\titalic 100",                           // 10
].join("\r\n");

const STRAT = [
  "; synthetic descr_strat",                // 1
  "faction\tromans_julii, ai_romans_julii", // 2
  "settlement",                             // 3
  "{",                                      // 4
  "\tlevel large_city",                     // 5
  "\tregion Etruria",                       // 6
  "\tyear_founded 0",                       // 7
  "\tpopulation 4000",                      // 8
  "}",                                      // 9
  "resource\tgold,\t2,\t100, 200; Etruria", // 10
  "character\tFlavius, general",            // 11
].join("\r\n");

const TRAITS = [
  "; synthetic traits",                     // 1
  "Trait GoodCommander",                    // 2
  "    Characters family",                  // 3
  "    AntiTraits BadCommander",            // 4
  "",                                       // 5
  "Trait BadCommander",                     // 6
  "    Characters family",                  // 7
].join("\r\n");

// UTF-16LE with BOM — the common text/*.txt encoding.
const TEXT_UNITS = "﻿{roman_legionaries}Roman Legionaries\r\n{gaul_elite_swordsmen}Gaulish Élite Swordsmen\r\n";

function writeLatin1(rel, content) {
  const p = path.join(dataDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.from(content, "latin1"));
  return p;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "defloc-test-"));
  dataDir = path.join(root, "data");
  writeLatin1("export_descr_unit.txt", EDU);
  writeLatin1("export_descr_buildings.txt", EDB);
  writeLatin1("world/maps/base/descr_regions.txt", REGIONS);
  writeLatin1("world/maps/campaign/imperial_campaign/descr_strat.txt", STRAT);
  writeLatin1("export_descr_character_traits.txt", TRAITS);
  const textPath = path.join(dataDir, "text", "export_units.txt");
  fs.mkdirSync(path.dirname(textPath), { recursive: true });
  fs.writeFileSync(textPath, Buffer.from(TEXT_UNITS, "utf16le"));
  clearDefinitionLocatorCache();
});

afterAll(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
});

describe("locateDefinition — kinds and line numbers", () => {
  it("finds a unit type in EDU (type + dictionary lines) and its EDB recruit line", () => {
    const r = locateDefinition(dataDir, "roman legionaries");
    expect(r.query).toBe("roman legionaries");
    const edu = r.hits.filter((h) => h.kind === "edu-type");
    expect(edu.map((h) => h.line)).toContain(2); // type line
    const rec = r.hits.filter((h) => h.kind === "edb-recruit");
    expect(rec.length).toBe(1);
    expect(rec[0].line).toBe(10);
    expect(rec[0].preview).toContain('recruit "roman legionaries"');
    expect(rec[0].rel.replace(/\\/g, "/")).toBe("export_descr_buildings.txt");
    expect(path.isAbsolute(rec[0].file)).toBe(true);
    // whole-token matches — none flagged fuzzy
    expect(r.hits.every((h) => !h.fuzzy)).toBe(true);
    expect(r.kindGuesses).toContain("edu-type");
  });

  it("finds the dictionary token in EDU AND decodes the UTF-16LE text file token", () => {
    const r = locateDefinition(dataDir, "roman_legionaries");
    const edu = r.hits.find((h) => h.kind === "edu-type" && h.line === 3);
    expect(edu).toBeTruthy();
    const txt = r.hits.find((h) => h.kind === "text-string");
    expect(txt).toBeTruthy();
    expect(txt.line).toBe(1);
    expect(txt.preview).toContain("{roman_legionaries}Roman Legionaries");
    expect(txt.fuzzy).toBeFalsy();
  });

  it("decodes latin1 high bytes (é) in previews", () => {
    const r = locateDefinition(dataDir, "gaul élite swordsmen");
    const hit = r.hits.find((h) => h.kind === "edu-type");
    expect(hit).toBeTruthy();
    expect(hit.line).toBe(7);
    expect(hit.preview).toContain("gaul élite swordsmen");
  });

  it("classifies region + city names in descr_regions and settlement lines in descr_strat", () => {
    const r = locateDefinition(dataDir, "Etruria");
    const reg = r.hits.find((h) => h.kind === "regions-region");
    expect(reg).toBeTruthy();
    expect(reg.line).toBe(2);
    const strat = r.hits.find((h) => h.kind === "strat-settlement");
    expect(strat).toBeTruthy();
    expect(strat.line).toBe(6);
    expect(strat.preview).toContain("region Etruria");
    // the trailing "; Etruria" comment on the resource line also matches, as strat-resource
    const res = r.hits.find((h) => h.kind === "strat-resource");
    expect(res).toBeTruthy();
    expect(res.line).toBe(10);
    const city = locateDefinition(dataDir, "Arretium");
    expect(city.hits.some((h) => h.kind === "regions-region" && h.line === 3)).toBe(true);
  });

  it("classifies resources and building levels", () => {
    const r = locateDefinition(dataDir, "gold");
    expect(r.hits.some((h) => h.kind === "strat-resource" && h.line === 10)).toBe(true);
    const b = locateDefinition(dataDir, "mines");
    const kinds = new Set(b.hits.map((h) => h.kind));
    expect(kinds.has("edb-building")).toBe(true); // building + levels lines
    expect(b.hits.some((h) => h.line === 2 && h.kind === "edb-building")).toBe(true);
    expect(b.hits.some((h) => h.line === 4 && h.kind === "edb-building")).toBe(true);
  });

  it("classifies Trait blocks and AntiTraits references", () => {
    const r = locateDefinition(dataDir, "BadCommander");
    const traitHits = r.hits.filter((h) => h.kind === "trait");
    expect(traitHits.map((h) => h.line).sort((a, b) => a - b)).toEqual([4, 6]); // AntiTraits ref + Trait def
  });
});

describe("locateDefinition — token vs fuzzy", () => {
  it("returns whole-token hits un-flagged when they exist", () => {
    const r = locateDefinition(dataDir, "Etruria");
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.every((h) => !h.fuzzy)).toBe(true);
  });

  it("falls back to substring hits flagged fuzzy when no whole token matches", () => {
    const r = locateDefinition(dataDir, "legionar"); // substring of "legionaries"/"legionaries" only
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.every((h) => h.fuzzy === true)).toBe(true);
  });

  it("matching is case-insensitive", () => {
    const r = locateDefinition(dataDir, "ETRURIA");
    expect(r.hits.some((h) => h.kind === "regions-region" && h.line === 2)).toBe(true);
    expect(r.hits.every((h) => !h.fuzzy)).toBe(true);
  });

  it("returns empty hits for garbage queries", () => {
    const r = locateDefinition(dataDir, "zzz_does_not_exist_zzz");
    expect(r.hits).toEqual([]);
    expect(r.kindGuesses).toEqual([]);
  });
});

describe("locateDefinition — cap and cache", () => {
  it("caps hits at 200", () => {
    const spam = ["; cap spam"];
    for (let i = 0; i < 260; i++) spam.push(`Trait CapSpamTrait${i}`);
    for (let i = 0; i < 260; i++) spam.push("    Affects capspamtoken 1");
    const p = path.join(dataDir, "export_descr_character_traits.txt");
    fs.writeFileSync(p, Buffer.from(spam.join("\r\n"), "latin1"));
    // ensure a distinct mtime from the beforeAll write
    const st = fs.statSync(p);
    fs.utimesSync(p, st.atime, new Date(st.mtimeMs + 4000));
    const r = locateDefinition(dataDir, "capspamtoken");
    expect(r.hits.length).toBe(200);
    expect(r.truncated).toBe(true);
    // restore original traits file for any later test
    fs.writeFileSync(p, Buffer.from(TRAITS, "latin1"));
    const st2 = fs.statSync(p);
    fs.utimesSync(p, st2.atime, new Date(st2.mtimeMs + 8000));
  });

  it("caches per (path, mtime) and invalidates when the file changes", () => {
    const p = path.join(dataDir, "export_descr_unit.txt");
    // prime the cache
    let r = locateDefinition(dataDir, "brand_new_unit_xyz");
    expect(r.hits).toEqual([]);
    const cachedBefore = _lineCache.get(p);
    expect(cachedBefore).toBeTruthy();
    // same content on disk, same mtime → same cache entry object reused
    locateDefinition(dataDir, "roman_legionaries");
    expect(_lineCache.get(p)).toBe(cachedBefore);
    // append a new unit; bump mtime explicitly (utimesSync) so even
    // same-millisecond writes register as a change
    fs.writeFileSync(p, Buffer.from(EDU + "\r\ntype                    brand_new_unit_xyz", "latin1"));
    const st = fs.statSync(p);
    fs.utimesSync(p, st.atime, new Date(st.mtimeMs + 4000));
    r = locateDefinition(dataDir, "brand_new_unit_xyz");
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].kind).toBe("edu-type");
    expect(r.hits[0].line).toBe(9);
    expect(_lineCache.get(p)).not.toBe(cachedBefore); // cache entry replaced
  });
});
