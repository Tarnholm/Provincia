// The resource row convention (src/parsers.js). On 2026-06-14 the READER and the
// icon drawing moved to "pixel row = H-1-gameY"; the hit tests, the drop and the
// WRITER did not — so the hover/drag hitbox sat one tile above the icon, and a
// resource save would have moved every untouched resource one row north. These
// pin reader, writer and hit-test centre to ONE convention.
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseDescrStratResources, stratYToRow, rowToStratY, resourceIconCenter, formatStratResourceLine } from "./parsers.js";

const H = 700; // RIS map height

describe("resource row convention", () => {
  test("the two conversions are exact inverses, and the bottom game row is the last pixel row", () => {
    for (const g of [0, 1, 349, 698, 699]) expect(rowToStratY(stratYToRow(g, H), H)).toBe(g);
    expect(stratYToRow(0, H)).toBe(H - 1);
    expect(stratYToRow(H - 1, H)).toBe(0);
    // no map height known → coordinates pass through untouched, both ways
    expect(stratYToRow(123, 0)).toBe(123);
    expect(rowToStratY(123, 0)).toBe(123);
  });

  test("WRITE then READ returns every resource to the same place (the save used to shift them a row)", () => {
    const original = [
      "resource        grain,                  2,           285,  404      ; Roma",
      "resource        timber,                 1,            12,    0      ; Bottom_Row",
      "resource        iron,                   3,           900,  699      ; Top_Row",
    ].join("\r\n");
    const parsed = parseDescrStratResources(original, H);
    const all = Object.entries(parsed).flatMap(([region, arr]) => arr.map((r) => ({ region, ...r })));
    expect(all.length).toBe(3);
    const rewritten = all.map((r) => formatStratResourceLine(r.region, r, H)).join("\r\n");
    const coords = (t) => [...t.matchAll(/resource\s+(\w+),\s*\d+,\s*(\d+),\s*(\d+)/g)].map((m) => `${m[1]} ${m[2]},${m[3]}`).sort();
    expect(coords(rewritten)).toEqual(coords(original));
    // and a second pass is still stable
    const again = Object.entries(parseDescrStratResources(rewritten, H)).flatMap(([region, arr]) => arr.map((r) => formatStratResourceLine(region, r, H))).join("\r\n");
    expect(coords(again)).toEqual(coords(original));
  });

  test("a dropped resource is written at the tile it was dropped on", () => {
    // dropped on pixel row 295 (the app stores y = floor(mapY)) → game y = 700-1-295
    expect(formatStratResourceLine("X", { type: "grain", amount: 1, x: 10, y: 295 }, H)).toMatch(/\s10,\s+404\s/);
  });

  test("the icon — and therefore its hitbox — is centred on the resource's own pixel", () => {
    expect(resourceIconCenter({ x: 285, y: 295 })).toEqual({ x: 285.5, y: 295.5 });
  });

  test("App.js never re-spells the arithmetic (every hit test goes through resourceIconCenter)", () => {
    const app = fs.readFileSync(path.resolve(__dirname, "App.js"), "utf8");
    const code = app.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join("\n");
    expect(code).not.toMatch(/res\.y\s*-\s*0\.5/);
    expect(code).not.toMatch(/mapHeight\s*-\s*res\.y/);
    expect(code).not.toMatch(/Math\.floor\(mapY\)\s*\+\s*1/);
    expect((code.match(/resourceIconCenter\(/g) || []).length).toBeGreaterThanOrEqual(5); // draw x, draw y, press, hover, click
  });
});
