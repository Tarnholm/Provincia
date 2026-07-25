// Report export — the files the RIS team works from. What matters here: CSV
// stays valid when the data contains commas/quotes/newlines (lead text is full
// of prose), the Markdown never claims things the run didn't establish, and an
// unusable log exports as "nothing to analyse" rather than an empty all-clear.
import { describe, it, expect } from "vitest";
import { toMarkdown, toFindingsCsv, toLeadsCsv, factionRollup } from "./aiReportExport.js";

const run = {
  logKind: "campaign_ai",
  logPath: "C:/logs/campaign_ai_log.txt",
  totalTurns: 51, firstYear: -270, lastYear: -245, lines: 4386174,
  usable: true,
  findings: [
    { kind: "campaign_stall", name: "Pella", faction: "epirus", fromTurn: 2, toTurn: 40, turns: 20, severity: 3, region: "Pella", detail: "GATHERING for 20 turns, still 0/35717 strength", verdict: "NEVER arrived — x holds it", impossible: true, blockedBy: "recruitment", micMax: 1, factionMenAtSave: 3127, factionSettlements: 4 },
    { kind: "abandoned", name: "Captain Dasas", faction: "delmatae", fromTurn: 1, toTurn: 1, turns: 50, severity: 3, region: null, x: null, y: null, detail: 'commanded, then silent, "quoted" text, and a comma', verdict: "ORPHANED — still alive", orphaned: true },
    { kind: "rich_but_stalled", name: "sophene", faction: "sophene", fromTurn: null, toTurn: null, turns: 7, severity: 3, region: null, detail: "7 stalled while 88% rich" },
  ],
  findingCounts: { campaign_stall: 1, abandoned: 1, rich_but_stalled: 1 },
  modLeads: [
    { severity: 3, faction: "epirus", file: "export_descr_buildings.txt", key: "mic_2 → settlement_min large_town", issue: "SETTLEMENT-TIER LOCKED, tier 1", suggestion: "lower mic_2's settlement_min", evidence: "16 impossible campaign(s), asks 35,717" },
    { severity: 2, faction: "carthage", file: "descr_strat.txt", key: "starting army", issue: "asks reach 56,279", suggestion: "thicken forces", evidence: "holds 48 settlement(s)" },
  ],
  save: { turn: 102, confirmedNeverArrived: 1207, impossibleCampaigns: 402, orphanedArmies: 1140, navalWorld: 50, sieges: 46, factionsWithUnits: 125 },
};

describe("toFindingsCsv", () => {
  const csv = toFindingsCsv(run);
  it("emits a header plus one row per finding", () => {
    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(1 + run.findings.length);
    expect(lines[0]).toMatch(/^kind,name,faction,/);
  });
  it("quotes cells containing commas or quotes so the CSV stays parseable", () => {
    // the delmatae detail has both a comma and embedded quotes
    expect(csv).toMatch(/"commanded, then silent, ""quoted"" text, and a comma"/);
  });
  it("writes missing values as empty cells, never 'null' or 'undefined'", () => {
    expect(csv).not.toMatch(/,null,/);
    expect(csv).not.toMatch(/,undefined,/);
  });
});

describe("toLeadsCsv", () => {
  it("emits every lead with the file and key to edit", () => {
    const csv = toLeadsCsv(run);
    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(1 + run.modLeads.length);
    expect(lines[0]).toBe("severity,faction,file,key,issue,suggestion,evidence");
    expect(csv).toMatch(/export_descr_buildings\.txt/);
    expect(csv).toMatch(/mic_2 → settlement_min large_town/);
  });
});

describe("toMarkdown", () => {
  const md = toMarkdown(run, { generatedAt: "2026-07-25T00:00:00Z" });
  it("leads with what was analysed and the save-verified totals", () => {
    expect(md).toMatch(/# AI Movement Lab report/);
    expect(md).toMatch(/\*\*AI decision log\*\* · 51 turn blocks/);
    expect(md).toMatch(/turn 102/);
    // number formatting is locale-dependent (thin/non-breaking space vs comma),
    // so assert on the digits with any separator between them
    expect(md.replace(/[\s,  ]/g, "")).toMatch(/\*\*1207\*\*moveordersconfirmedneverto/);
  });
  it("groups the leads by the file you would edit — that IS the to-do list", () => {
    expect(md).toMatch(/## Mod-file leads/);
    expect(md).toMatch(/### `export_descr_buildings\.txt` — 1 lead\(s\)/);
    expect(md).toMatch(/### `descr_strat\.txt` — 1 lead\(s\)/);
    expect(md).toMatch(/fix: lower mic_2's settlement_min/);
  });
  it("includes a faction rollup and worst cases", () => {
    expect(md).toMatch(/## Worst-affected factions/);
    expect(md).toMatch(/\| epirus \|/);
    expect(md).toMatch(/## Worst cases/);
    expect(md).toMatch(/Captain Dasas/);
  });
  it("says 'nothing to analyse' for an unusable log instead of an empty all-clear", () => {
    const bad = toMarkdown({ logKind: "message_log", totalTurns: 1, usable: false, emptyReason: "no movement events in this log — 43,230 lines scanned", findings: [] });
    expect(bad).toMatch(/Nothing to analyse/);
    expect(bad).toMatch(/43,230 lines scanned/);
    expect(bad).not.toMatch(/Worst-affected factions/);
  });
  it("returns empty string for no result at all", () => {
    expect(toMarkdown(null)).toBe("");
  });
});

describe("factionRollup", () => {
  it("ranks factions by total findings and counts each symptom", () => {
    const r = factionRollup(run);
    expect(r[0].total).toBeGreaterThanOrEqual(1);
    const ep = r.find((x) => x.faction === "epirus");
    expect(ep).toMatchObject({ impossible: 1, neverArrived: 1 });
    const dl = r.find((x) => x.faction === "delmatae");
    expect(dl.orphaned).toBe(1);
  });
});
