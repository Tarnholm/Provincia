// Unit tests for reportExport — the shareable single-file HTML report builder.
// Hermetic: pure string building, synthetic payloads, no DOM, no fixtures.
import { describe, it, expect } from "vitest";
import { buildHtmlReport, esc } from "./reportExport.js";

const XSS = "<script>alert(1)</script>";

const fullPayload = () => ({
  meta: {
    title: "RIS balance snapshot & notes", // & exercises header escaping
    modName: "RIS",
    campaign: "imperial_campaign",
    appVersion: "0.9.1279",
    date: "2026-07-17",
  },
  // 1x1 transparent PNG
  mapPngDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  factionRows: [
    { name: XSS, color: "#a02020", settlements: 12, income: 5400, upkeep: 5100, net: 300, verdict: "OK (+300)" },
    { name: "Macedon", color: 'red" onmouseover="alert(2)', settlements: 8, income: 3100, upkeep: 3600, net: -500, verdict: "OVER by 500" },
  ],
  settlementRows: [
    { name: "Roma", faction: "Julii", pop: 12000, income: 1800, note: "capital, mine income spike" },
    { name: "Syracuse", faction: "Greek Cities", pop: 9000, income: 1400 },
  ],
  victoryRows: [
    { faction: "Julii", pct: 42.5, held: 17, required: 40 },
    { faction: "Carthage", pct: 12, held: 5, required: 40 },
  ],
  notes: "Line one.\nLine two with <tags> & ampersands.",
});

describe("esc", () => {
  it("escapes the five HTML metacharacters and stringifies nullish to empty", () => {
    expect(esc(`<a href="x" title='y'>&`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;");
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
    expect(esc(0)).toBe("0");
  });
});

describe("buildHtmlReport", () => {
  it("returns a complete document starting with <!DOCTYPE html>", () => {
    const html = buildHtmlReport(fullPayload());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain("<style>");
    expect(html).toContain("<script>");
  });

  it("escapes injected user strings — no raw script tags from data", () => {
    const html = buildHtmlReport(fullPayload());
    expect(html).not.toContain(XSS);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // notes are escaped too
    expect(html).toContain("Line two with &lt;tags&gt; &amp; ampersands.");
    // exactly one <script> — the static inline sorter, nothing injected
    expect(html.match(/<script>/g)).toHaveLength(1);
  });

  it("drops unsafe faction colors instead of interpolating them", () => {
    const html = buildHtmlReport(fullPayload());
    expect(html).toContain("background:#a02020");
    expect(html).not.toContain("onmouseover");
  });

  it("renders all sections when provided", () => {
    const html = buildHtmlReport(fullPayload());
    expect(html).toContain("RIS balance snapshot &amp; notes");
    expect(html).toContain("Mod: <b>RIS</b>");
    expect(html).toContain("imperial_campaign");
    expect(html).toContain("0.9.1279");
    expect(html).toContain("Map snapshot");
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain("Faction economy");
    expect(html).toContain("Settlement highlights");
    expect(html).toContain("Victory progress");
    expect(html).toContain("Notes");
    // table content spot checks
    expect(html).toContain("Syracuse");
    expect(html).toContain("12,000");           // formatted pop
    expect(html).toContain("OVER by 500");
    expect(html).toContain("width:42.5%");      // victory progress bar
  });

  it("omits sections that are not provided", () => {
    const html = buildHtmlReport({ meta: { title: "Minimal", modName: "RIS" } });
    expect(html).toContain("Minimal");
    expect(html).not.toContain("Map snapshot");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Faction economy");
    expect(html).not.toContain("Settlement highlights");
    expect(html).not.toContain("Victory progress");
    expect(html).not.toContain("<h2>Notes</h2>");
  });

  it("treats empty arrays / blank notes / non-data-URL map as absent", () => {
    const html = buildHtmlReport({
      meta: { title: "Edge" },
      factionRows: [], settlementRows: [], victoryRows: [],
      notes: "   ",
      mapPngDataUrl: "javascript:alert(1)",
    });
    expect(html).not.toContain("Faction economy");
    expect(html).not.toContain("Settlement highlights");
    expect(html).not.toContain("Victory progress");
    expect(html).not.toContain("<h2>Notes</h2>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
  });

  it("is fully self-contained — no external http(s) references", () => {
    const html = buildHtmlReport(fullPayload());
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  it("survives a null/empty payload with a fallback title", () => {
    const html = buildHtmlReport();
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("Provincia report");
  });
});
