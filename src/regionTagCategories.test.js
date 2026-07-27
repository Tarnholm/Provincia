// @vitest-environment node
/**
 * The wiki's region-tag categories must match Provincia's own.
 *
 * src/RegionInfo.js categorises a descr_regions tag for the region panel; the wiki generator
 * needs the same answer so a reader is not told `mediterranean` is a climate in the app and a
 * terrain on the page. It cannot import RegionInfo (a React module) from a Node script, so the
 * sets are copied — and a copy drifts unless something reads both.
 *
 * This is what that costs if it goes unchecked: the wiki had `mediterranean`, `arid`,
 * `temperate` and `tropical` filed as terrain, and the irrigation tags lumped under
 * "geography and gating", for as long as those pages existed.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** Pull a `new Set([...])` literal's string members out of a source file by variable name. */
function setLiteral(src, name) {
  const re = new RegExp(`${name}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`);
  const m = re.exec(src);
  if (!m) return null;
  return new Set([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1].toLowerCase()));
}

const app = read("src/RegionInfo.js");
const gen = read("scripts/gen-ris-region-pages.js");
// The third copy. gen-ris-tag-pages.js writes the reference page each category links INTO, so
// if it disagreed with the region generator a value would be filed under Terrain on the region
// page and appear on the Climate page — or, worse, appear on neither and lose its link
// silently, because verify-ris-wiki.js checks that the file exists, not the heading.
const tags = read("scripts/gen-ris-tag-pages.js");

const PAIRS = [
  ["TERRAIN_TAG_SET", "TERRAIN_TAGS"],
  ["CLIMATE_TAG_SET", "CLIMATE_TAGS"],
  ["IRRIGATION_TAG_SET", "IRRIGATION_TAGS"],
  ["SPECIALTY_AOR_TAGS", "SPECIALTY_AOR"],
];
const COPIES = [["the wiki region generator", gen], ["the tag reference generator", tags]];

describe("wiki region-tag categories match Provincia's", () => {
  for (const [appName, genName] of PAIRS) {
    for (const [where, src] of COPIES) {
      it(`${genName} in ${where} matches ${appName}`, () => {
        const a = setLiteral(app, appName);
        const b = setLiteral(src, genName);
        // A missing set means one side was renamed; that must fail, not skip.
        expect(a, `${appName} not found in src/RegionInfo.js`).toBeTruthy();
        expect(b, `${genName} not found in ${where}`).toBeTruthy();
        const missing = [...a].filter((t) => !b.has(t));
        const extra = [...b].filter((t) => !a.has(t));
        expect({ missing, extra }).toEqual({ missing: [], extra: [] });
      });
    }
  }

  it("the four categories do not overlap", () => {
    // A token in two sets would be categorised by whichever test ran first — order-dependent
    // output is worse than a wrong category, because it looks stable.
    const sets = PAIRS.map(([, g]) => setLiteral(gen, g));
    const seen = new Map();
    for (let i = 0; i < sets.length; i++) {
      for (const t of sets[i]) {
        expect(seen.has(t), `${t} appears in both ${PAIRS[seen.get(t)]?.[1]} and ${PAIRS[i][1]}`).toBe(false);
        seen.set(t, i);
      }
    }
  });

  it("fertility is read from the Farm tag, not descr_regions field 7", () => {
    // RIS leaves that field at a constant 5 for every region, so reporting it would give the
    // same answer 1,311 times. Both the app and the generator must read the tag.
    expect(app).toMatch(/Farm\(\\d\+\)|Farm\(\\d\+\)\\b|\\bFarm\(\\d\+\)\\b/);
    expect(gen).toMatch(/\/ 14/);
  });
});
