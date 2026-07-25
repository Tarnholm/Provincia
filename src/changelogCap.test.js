// @vitest-environment node
//
// The in-app changelog is dynamic-imported and parsed by WelcomeScreen on every
// post-update launch. The cap was set at ~5 versions in 0.9.1275 for that
// reason, `npm run ship` warned about it for 146 releases, and nobody acted —
// by 2026-07-25 the file was 151 entries / 110 KB.
//
// So the cap is now enforced in two places: `npm run ship` trims automatically,
// and this test fails if the file drifts anyway (e.g. someone hand-edits it, or
// the trim silently stops working). It also checks the archive still holds the
// history, because "small file" is only correct if nothing was thrown away.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LIVE = path.join(ROOT, "src", "changelog.js");
const ARCHIVE = path.join(ROOT, "docs", "changelog-archive.js");

describe("in-app changelog stays small", () => {
  it("keeps at most 8 entries and well under 40 KB", async () => {
    const src = fs.readFileSync(LIVE, "utf8");
    const live = (await import("file://" + LIVE.replace(/\\/g, "/"))).default;
    expect(Array.isArray(live)).toBe(true);
    expect(
      live.length,
      "src/changelog.js has drifted past the cap — run `npm run changelog:trim` (ship does it automatically)"
    ).toBeLessThanOrEqual(8);
    // 110 KB was the drifted size; 40 KB leaves generous headroom for 5 verbose entries
    expect(src.length, `src/changelog.js is ${(src.length / 1024).toFixed(0)} KB`).toBeLessThan(40 * 1024);
  });

  it("is newest-first, which the ship script and WelcomeScreen both rely on", async () => {
    const live = (await import("file://" + LIVE.replace(/\\/g, "/"))).default;
    const num = (v) => v.split(".").map((x) => parseInt(x, 10));
    for (let i = 1; i < live.length; i++) {
      const a = num(live[i - 1].version), b = num(live[i].version);
      const cmp = a[0] - b[0] || a[1] - b[1] || (a[2] || 0) - (b[2] || 0);
      expect(cmp, `${live[i - 1].version} should sort above ${live[i].version}`).toBeGreaterThan(0);
    }
  });

  it("hands off to the archive with no gap — trimming must not lose a release", async () => {
    const live = (await import("file://" + LIVE.replace(/\\/g, "/"))).default;
    const arch = (await import("file://" + ARCHIVE.replace(/\\/g, "/"))).default;
    expect(arch.length).toBeGreaterThan(100);
    const oldestLive = live[live.length - 1].version;
    const newestArchived = arch[0].version;
    expect(oldestLive).not.toBe(newestArchived);        // no duplicate at the seam
    // and no version appears in both files
    const liveSet = new Set(live.map((e) => e.version));
    const dupes = arch.filter((e) => liveSet.has(e.version)).map((e) => e.version);
    expect(dupes, "these versions exist in BOTH the live changelog and the archive").toEqual([]);
  });

  it("every entry has a version, a date and at least one item", async () => {
    const live = (await import("file://" + LIVE.replace(/\\/g, "/"))).default;
    for (const e of live) {
      expect(e.version, "entry without a version").toBeTruthy();
      expect(e.date, `entry ${e.version} has no date`).toBeTruthy();
      expect(Array.isArray(e.items) && e.items.length, `entry ${e.version} has no items`).toBeTruthy();
      for (const it of e.items) {
        expect(["feature", "fix", "improvement", "change"]).toContain(it.type);
        expect(typeof it.text).toBe("string");
        expect(it.text.length).toBeGreaterThan(10);
      }
    }
  });
});

// The trim moves entries as TEXT, spliced on brace boundaries. Re-serialising
// from parsed data is what corrupted this file once before (emoji and quotes in
// the prose got mis-escaped and truncated the write), so the brace scanner is
// the load-bearing part and its string-awareness is what these cover.
describe("trim-changelog brace scanner", () => {
  // the scanner, extracted verbatim in behaviour from scripts/trim-changelog.js
  function findEntrySpans(src, arrayOpenIdx) {
    const spans = [];
    let i = arrayOpenIdx + 1;
    let depth = 0, entryStart = -1;
    let quote = null, escaped = false;
    while (i < src.length) {
      const ch = src[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = null;
        i++; continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; i++; continue; }
      if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (ch === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i) + 2; continue; }
      if (ch === "{") { if (depth === 0) entryStart = i; depth++; i++; continue; }
      if (ch === "}") { depth--; if (depth === 0) { spans.push({ start: entryStart, end: i + 1 }); entryStart = -1; } i++; continue; }
      if (ch === "]" && depth === 0) break;
      i++;
    }
    return spans;
  }
  const spansOf = (body) => {
    const src = `const X = [\n${body}\n];\n`;
    return findEntrySpans(src, src.indexOf("["));
  };

  it("counts one span per top-level entry, nested objects included", () => {
    expect(spansOf(`  { version: "1", items: [{ type: "fix", text: "a" }] },\n  { version: "2", items: [{ type: "fix", text: "b" }] },`)).toHaveLength(2);
  });

  it("is not fooled by braces inside release-note prose", () => {
    // this is the real hazard: prose about code contains { and }
    const body = `  { version: "1", items: [{ type: "fix", text: "fixed requires { all, } and the } brace" }] },
  { version: "2", items: [{ type: "fix", text: "another {" }] },`;
    expect(spansOf(body)).toHaveLength(2);
  });

  it("is not fooled by escaped quotes or apostrophes in prose", () => {
    const body = `  { version: "1", items: [{ type: "fix", text: "he said \\"{\\" and it's fine" }] },
  { version: "2", items: [{ type: "fix", text: "don't } break" }] },`;
    expect(spansOf(body)).toHaveLength(2);
  });

  it("skips comments that contain braces", () => {
    const body = `  // a comment with { and }
  { version: "1", items: [{ type: "fix", text: "a" }] },
  /* block { comment } */
  { version: "2", items: [{ type: "fix", text: "b" }] },`;
    expect(spansOf(body)).toHaveLength(2);
  });

  it("stops at the array's closing bracket, ignoring later code", () => {
    const src = `const X = [\n  { a: 1 },\n];\nconst Y = { b: 2 };\n`;
    expect(findEntrySpans(src, src.indexOf("["))).toHaveLength(1);
  });

  it("extracts spans that are themselves valid object literals", () => {
    const body = `  { version: "1", items: [{ type: "fix", text: "a { b } c" }] },`;
    const src = `const X = [\n${body}\n];\n`;
    const [s] = findEntrySpans(src, src.indexOf("["));
    // eslint-disable-next-line no-new-func
    const obj = new Function(`return ${src.slice(s.start, s.end)}`)();
    expect(obj).toMatchObject({ version: "1" });
    expect(obj.items[0].text).toBe("a { b } c");
  });
});
