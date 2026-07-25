// scripting_log.txt analysis — the engine's own complaints about the mod's data
// files. Two things are being pinned here:
//
//  1. The analyser separates real errors from the log's overwhelming background
//     noise. The RIS log is 93,673 lines, of which 8,132 are bare `[FAILED]`
//     markers and 5,377 are `HasResource [...::FAILED]` — ordinary condition
//     checks coming out false, i.e. how a campaign script normally decides not
//     to fire. Reporting those would bury the 13 real errors under 13,000
//     non-problems, so a test asserts they stay out.
//
//  2. Every suggestion is provable from the mod files. The senate leads resolve
//     against the offices descr_senate.txt actually defines; the formation-
//     coverage leads cite the file's own catch-all statistics. Where the cause
//     ISN'T resolvable (the descr_formations_ai parse failure), the lead must
//     report impact and stop rather than guess — that's asserted too.
import { describe, it, expect } from "vitest";
import { createScriptLogAnalyzer } from "./aiMovementAnalyzer.js";
import {
  auditScriptErrors, parseSenateOffices, officeCandidates,
  countFormationsAfter, catchAllCoverage, parseHasOfficeRefs,
} from "./aiScriptAudit.js";

const feed = (lines) => {
  const an = createScriptLogAnalyzer();
  for (const l of lines) an.feedLine(l);
  return an.finish();
};

// verbatim shapes from the user's live scripting_log.txt
const REAL = {
  coverage: "Script Error in Q:\\Feral\\Users\\Default\\AppData\\Local\\Mods\\My Mods\\RIS/data/descr_formations_ai.txt, at line 531, column 1. Group Formation script error: Formation triplex_acies does not cover all unit types in the formation blocks preference list",
  parseFail: "Script Error in Q:\\Feral\\Users\\Default\\AppData\\Local\\Mods\\My Mods\\RIS/data/descr_formations_ai.txt, at line 2369, column 33. Group Formation script error: Expected end_formation",
  badTile: "Script Error in Q:\\Feral\\Users\\Default\\AppData\\Local\\Mods\\My Mods\\RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt, at line 40847, column 59. you have chosen an invalid tile(357, 398) for Skerviaidos (illyrian_kingdom)",
  senate: "Script Error in Q:\\Feral\\Users\\Default\\AppData\\Local\\Mods\\My Mods\\RIS/data/descr_senate.txt, at line 139, column 5. 'Aedile_tenure' does not contain a valid office name",
  hasOffice: "Error while executing HasOffice for character Biggus Dickus, no office named Aedile assigned to senate roman_senate",
};

// the log's dominant NON-error patterns — must never become findings
const NOISE = [
  "(sizeN_true.txt::123) Executing command inc_counter",
  "  HasResource [aor_gaul_early::FAILED]",
  ") [FAILED]",
  "  &&",
  "(ris_campaign_script.txt::5501) Executing command destroy_building",
  "(seleucid_reforms_2_trigger.txt::12) Executing command if",
  "",
];

describe("createScriptLogAnalyzer — signal vs noise", () => {
  it("extracts file, line and column from a Script Error, dropping the machine-specific path", () => {
    const r = feed([REAL.coverage]);
    expect(r.logKind).toBe("scripting");
    expect(r.usable).toBe(true);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect(f.kind).toBe("script_error");
    expect(f.file).toBe("descr_formations_ai.txt"); // not the Q:\Feral\... build path
    expect(f.line).toBe(531);
    expect(f.column).toBe(1);
    expect(f.message).toMatch(/does not cover all unit types/);
  });

  it("ignores the log's ordinary [FAILED] condition checks — they are not errors", () => {
    // 8,132 `[FAILED]` + 5,377 `HasResource […::FAILED]` lines in the real log
    const r = feed([...NOISE, ...NOISE, ...NOISE]);
    expect(r.findings).toHaveLength(0);
    expect(r.usable).toBe(false);
    // and it must say so as good news, not as a failure to parse
    expect(r.emptyReason).toMatch(/no script errors/);
    expect(r.emptyReason).toMatch(/good news/);
  });

  it("finds the errors even when buried in that noise, and counts the lines it read", () => {
    const lines = [];
    for (let i = 0; i < 200; i++) lines.push(...NOISE);
    lines.push(REAL.senate, REAL.badTile);
    const r = feed(lines);
    expect(r.findings).toHaveLength(2);
    expect(r.lines).toBe(200 * NOISE.length + 2);
  });

  it("grades a parse failure above an incomplete-coverage warning", () => {
    const r = feed([REAL.coverage, REAL.parseFail]);
    // fatal first — the engine DISCARDED that block, the other still loaded
    expect(r.findings[0].line).toBe(2369);
    expect(r.findings[0].severity).toBe(3);
    expect(r.findings[0].verdict).toMatch(/DISCARDED/);
    expect(r.findings[1].severity).toBe(2);
    expect(r.findings[1].verdict).toMatch(/gap/);
  });

  it("collapses a repeated error into one finding that reports the count", () => {
    const r = feed([REAL.hasOffice, REAL.hasOffice, REAL.hasOffice]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].kind).toBe("script_runtime_error");
    expect(r.findings[0].turns).toBe(3);
    expect(r.findings[0].detail).toMatch(/failed 3×/);
    expect(r.findings[0].detail).toMatch(/Biggus Dickus/);
  });

  it("reports no turn structure — a scripting log has none, and faking one would mislead", () => {
    const r = feed([REAL.senate]);
    expect(r.totalTurns).toBe(0);
    expect(r.findings[0].fromTurn).toBeNull();
  });
});

describe("parseSenateOffices", () => {
  const SENATE = [
    "Quaestor",
    "Title\t\tSMT_X",
    "Rank\t\t10",
    "Restrictions",
    "\ttrait_Senatorial 1",
    "End",
    "",
    "PlebeianAedile",
    "Restrictions",
    "\tQuaestor_tenure",
    "End",
    "",
    "CuruleAedile",
    "Restrictions",
    "End",
    "",
    "Praetor",
    "Restrictions",
    "\tAedile_tenure",
    "\ttrait_Senatorial 1",
    "End",
    "; PontifexMaximus        <- commented out, not a definition",
  ].join("\n");

  it("reads the office names and skips the file's structural keywords", () => {
    const { offices } = parseSenateOffices(SENATE);
    expect([...offices].sort()).toEqual(["CuruleAedile", "PlebeianAedile", "Praetor", "Quaestor"]);
    expect(offices.has("Restrictions")).toBe(false);
    expect(offices.has("End")).toBe(false);
    expect(offices.has("PontifexMaximus")).toBe(false); // commented
  });

  it("records every <Office>_tenure restriction with its line number", () => {
    const { tenureRefs } = parseSenateOffices(SENATE);
    expect(tenureRefs.map((r) => r.name)).toEqual(["Quaestor", "Aedile"]);
    expect(tenureRefs[1].line).toBe(19); // the Aedile_tenure line
  });

  it("returns empty structures for a missing file rather than throwing", () => {
    expect(parseSenateOffices(null).offices.size).toBe(0);
    expect(parseSenateOffices(null).tenureRefs).toEqual([]);
  });

  it("resolves a renamed office by containment — Aedile → the two real Aediles", () => {
    const { offices } = parseSenateOffices(SENATE);
    expect(officeCandidates("Aedile", offices)).toEqual(["CuruleAedile", "PlebeianAedile"]);
    // and does not offer the name itself back
    expect(officeCandidates("Praetor", offices)).toEqual([]);
  });
});

describe("parseHasOfficeRefs", () => {
  it("collects active Condition HasOffice references and skips disabled ones", () => {
    const refs = parseHasOfficeRefs([
      "Trait Whatever",
      "    Condition HasOffice Consul",
      ";;;    Condition HasOffice PontifexMaximus",
      "    Condition HasOffice Aedile",
    ].join("\n"));
    expect(refs).toEqual([
      { office: "Consul", line: 2 },
      { office: "Aedile", line: 4 },
    ]);
  });
});

describe("auditScriptErrors — senate offices", () => {
  const senate = [
    "Quaestor", "Restrictions", "End",
    "PlebeianAedile", "Restrictions", "End",
    "CuruleAedile", "Restrictions", "End",
    "Praetor", "Restrictions", "\tAedile_tenure", "End",
  ].join("\n");
  const traits = ["Trait X", "    Condition HasOffice Aedile", "Trait Y", "    Condition HasOffice Consul"].join("\n");

  it("names the offices that DO exist and suggests the rename, per file", () => {
    const r = feed([REAL.senate, REAL.hasOffice]);
    const { leads } = auditScriptErrors({ findings: r.findings, files: { senate, traits } });
    // one dead name can produce a lead per file, so select by key rather than
    // by file (this fixture's `Consul` reference is dead too — see below)
    const pick = (k) => leads.find((l) => l.key === k);

    // descr_senate.txt — the _tenure restriction, with its own line number
    const sen = pick("Aedile_tenure");
    expect(sen.file).toBe("descr_senate.txt");
    expect(sen.suggestion).toMatch(/CuruleAedile_tenure or PlebeianAedile_tenure/);
    expect(sen.evidence).toMatch(/line 12/);

    // export_descr_character_traits.txt — the HasOffice condition, its own lines
    const tr = pick("Condition HasOffice Aedile");
    expect(tr.file).toBe("export_descr_character_traits.txt");
    expect(tr.suggestion).toMatch(/CuruleAedile or PlebeianAedile/);
    expect(tr.evidence).toMatch(/line 2/);

    for (const l of leads) expect(l.evidence).toMatch(/offices that DO exist: CuruleAedile, PlebeianAedile, Praetor, Quaestor/);
  });

  it("finds dead office references the LOG never reported (static sweep)", () => {
    // no findings at all — everything below comes from reading the files
    const traits2 = traits + "\nTrait Z\n    Condition HasOffice PontifexMaximus";
    const { leads } = auditScriptErrors({ findings: [], files: { senate, traits: traits2 } });
    const keys = leads.map((l) => l.key);
    expect(keys).toContain("Condition HasOffice PontifexMaximus");
    expect(keys).toContain("Aedile_tenure");
    // an office with no rename candidate gets the honest fallback, not a guess
    const pm = leads.find((l) => l.key === "Condition HasOffice PontifexMaximus");
    expect(pm.suggestion).toMatch(/define an office named "PontifexMaximus"/);
  });

  it("stays silent about office names that really are defined", () => {
    const { leads } = auditScriptErrors({ findings: [], files: { senate, traits } });
    // Consul IS referenced by traits but is NOT an office in this fixture, so it
    // is reported; Quaestor/Praetor exist and must not be.
    expect(leads.some((l) => /Quaestor/.test(l.key))).toBe(false);
    expect(leads.some((l) => /Praetor/.test(l.key))).toBe(false);
  });

  it("proves nothing when descr_senate.txt is unavailable", () => {
    const r = feed([REAL.senate, REAL.hasOffice]);
    const { leads } = auditScriptErrors({ findings: r.findings, files: {} });
    // no senate file → no office claims at all (the generic fallback still fires
    // for the parse error class, but never a rename suggestion)
    expect(leads.some((l) => /rename to/.test(l.suggestion))).toBe(false);
  });
});

describe("auditScriptErrors — formations", () => {
  // 3 formations: two with a catch-all, one without
  const FORMATIONS = [
    "begin_formation alpha",           // 1
    "\tbegin_block 0",
    "\t\tunit_type any\t\t0.0",
    "\tend_block",
    "end_formation",                   // 5
    "",
    "begin_formation beta",            // 7
    "\tbegin_block 0",
    "\t\tunit_type heavy infantry 1.0",
    "\tend_block",
    "end_formation",                   // 11
    "",
    "begin_formation gamma",           // 13
    "\tbegin_block 0",
    "\t\tunit_type any 0.1",
    "\tend_block",
    "end_formation",                   // 17
  ].join("\n");

  it("measures catch-all coverage from the file instead of asserting it", () => {
    const c = catchAllCoverage(FORMATIONS);
    expect(c.total).toBe(3);
    expect(c.withCatchAll.sort()).toEqual(["alpha", "gamma"]);
    expect(c.without).toEqual(["beta"]);
  });

  it("cites that coverage as the evidence for the catch-all suggestion", () => {
    const err = REAL.coverage.replace("triplex_acies", "beta");
    const r = feed([err]);
    const { leads } = auditScriptErrors({ findings: r.findings, files: { formationsAi: FORMATIONS } });
    expect(leads).toHaveLength(1);
    expect(leads[0].key).toBe("beta");
    expect(leads[0].severity).toBe(2);
    expect(leads[0].suggestion).toMatch(/unit_type any/);
    expect(leads[0].evidence).toMatch(/2 of 3 formations in this file carry a `unit_type any` catch-all and 1 do not/);
    expect(leads[0].evidence).toMatch(/"beta" is in the second group/);
    // and it must warn that the engine's line number is not the culprit's line
    expect(leads[0].evidence).toMatch(/lands inside a sibling formation/);
  });

  it("reports the parse failure's blast radius and does NOT guess the cause", () => {
    const r = feed([REAL.parseFail]);
    const { leads } = auditScriptErrors({ findings: r.findings, files: { formationsAi: FORMATIONS } });
    expect(leads).toHaveLength(1);
    expect(leads[0].severity).toBe(3);
    expect(leads[0].issue).toMatch(/PARSE FAILURE/);
    // measured impact, hedged where it is not certain
    expect(leads[0].evidence).toMatch(/declared AFTER line 2369/);
    expect(leads[0].evidence).toMatch(/worth confirming in-game/);
    // it must NOT name a specific token as the culprit
    expect(leads[0].suggestion).not.toMatch(/unit_type any|unit_density close/);
    expect(leads[0].suggestion).toMatch(/points at where it gave up/);
  });

  it("emits ONE parse-failure lead even though the engine reports three messages", () => {
    const r = feed([
      REAL.parseFail,
      REAL.parseFail.replace("Expected end_formation", "unknown unit_density"),
      REAL.parseFail.replace("Expected end_formation", "at least one formation block required"),
    ]);
    expect(r.findings).toHaveLength(3); // all three are real log entries
    const { leads } = auditScriptErrors({ findings: r.findings, files: { formationsAi: FORMATIONS } });
    expect(leads.filter((l) => /PARSE FAILURE/.test(l.issue))).toHaveLength(1); // one fix
  });

  it("counts formations either side of a failure line", () => {
    expect(countFormationsAfter(FORMATIONS, 12)).toMatchObject({ before: 2, after: 1, total: 3 });
    expect(countFormationsAfter(null, 12)).toBeNull();
  });
});

describe("auditScriptErrors — descr_strat placements", () => {
  it("turns an invalid tile into a per-character, per-faction lead", () => {
    const r = feed([REAL.badTile]);
    const { leads } = auditScriptErrors({ findings: r.findings, files: {} });
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ severity: 3, faction: "illyrian_kingdom", file: "descr_strat.txt" });
    expect(leads[0].key).toMatch(/line 40847 — Skerviaidos/);
    expect(leads[0].issue).toMatch(/INVALID STARTING TILE \(357, 398\)/);
    expect(leads[0].evidence).toBe("descr_strat.txt:40847:59");
  });
});

describe("auditScriptErrors — contract", () => {
  it("gives every lead a file, a key, a suggestion and evidence", () => {
    const r = feed(Object.values(REAL));
    const { leads } = auditScriptErrors({ findings: r.findings, files: {} });
    expect(leads.length).toBeGreaterThan(0);
    for (const l of leads) {
      expect(l.file, "lead without a file").toBeTruthy();
      expect(l.key, "lead without a key").toBeTruthy();
      expect(l.suggestion, "lead without a suggestion").toBeTruthy();
      expect(l.evidence, "lead without evidence").toBeTruthy();
      expect([2, 3]).toContain(l.severity);
    }
  });

  it("sorts worst-first and survives being called with nothing", () => {
    const r = feed(Object.values(REAL));
    const { leads } = auditScriptErrors({ findings: r.findings, files: {} });
    for (let i = 1; i < leads.length; i++) expect(leads[i - 1].severity).toBeGreaterThanOrEqual(leads[i].severity);
    expect(auditScriptErrors().leads).toEqual([]);
    expect(auditScriptErrors({ findings: null, files: null }).leads).toEqual([]);
  });

  it("still produces a lead for an error class it has no cross-check for", () => {
    const odd = "Script Error in C:/x/RIS/data/descr_mercenaries.txt, at line 9, column 2. something entirely new";
    const r = feed([odd]);
    const { leads } = auditScriptErrors({ findings: r.findings, files: {} });
    expect(leads).toHaveLength(1);
    expect(leads[0].file).toBe("descr_mercenaries.txt");
    expect(leads[0].suggestion).toMatch(/open descr_mercenaries\.txt:9/);
  });
});
