// modLint.test.js — hermetic tests for the parse-time mod consistency lint.
// Builds a synthetic mini-mod in a temp dir with EXACTLY ONE instance of each
// check firing, plus a fully-consistent clean mod asserting zero false
// positives. No real mod files are touched.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { lintMod, parseUnitTypeToken, lintFormations, lintFormationValues, VANILLA_UNIT_TYPES, DOCUMENTED_FORMATION_VALUES } from "./modLint.js";

const SM_RESOURCES = `;; synthetic descr_sm_resources
"resources":
[
	"iron":
	{
		"subtype": "mineable",
		"trade value": 5,
		"tier": 1,
	},
	"good_tag":
	{
		"subtype": "hidden",
	},
	"dead_token":
	{
		"subtype": "hidden",
	},
	"scripted_token":
	{
		"subtype": "hidden",
	},
]
`;

// descr_regions block format: name / settlement / creator / rebels / rgb / hidden tags
const regionsTxt = (tags) => `; synthetic descr_regions
region_one
\tTownone
\tromans_julii
\tpatrician
\t100 101 102
\t${tags}
\t123
\t4
`;

// One building chain (core_building: village town) so chainLevels has a real
// chain + levels for the building_present checks to compare against.
const edbTxt = (extraCapLines, recruitLines) => `; synthetic EDB
building core_building
{
	levels village town
	{
		village requires factions { all, }
		{
			capability
			{
				population_growth_bonus bonus 1 requires hidden_resource good_tag
				population_growth_bonus bonus 1 requires resource iron
${extraCapLines.map((l) => "\t\t\t\t" + l).join("\n")}
			}
${recruitLines.map((l) => "\t\t\t" + l).join("\n")}
		}
		town requires factions { all, }
		{
		}
	}
}
`;

const EDU = `; synthetic EDU
type             real unit
dictionary       real_unit
category         infantry

type             strat unit
dictionary       strat_unit
category         infantry
`;

const stratTxt = (unitLines) => `; synthetic descr_strat
faction	romans_julii, balanced smith
character	Foo Barus, named character, x 10, y 20
army
${unitLines.join("\n")}
`;

function writeMod(dir, { smRes, regions, edb, edu, strat, script }) {
  const campDir = path.join(dir, "world", "maps", "campaign", "imperial_campaign");
  const baseDir = path.join(dir, "world", "maps", "base");
  fs.mkdirSync(campDir, { recursive: true });
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(path.join(dir, "descr_sm_resources.txt"), smRes, "latin1");
  fs.writeFileSync(path.join(baseDir, "descr_regions.txt"), regions, "latin1");
  fs.writeFileSync(path.join(dir, "export_descr_buildings.txt"), edb, "latin1");
  fs.writeFileSync(path.join(dir, "export_descr_unit.txt"), edu, "latin1");
  fs.writeFileSync(path.join(campDir, "descr_strat.txt"), strat, "latin1");
  if (script != null) fs.writeFileSync(path.join(campDir, "lint_script.txt"), script, "latin1");
}

describe("modLint — synthetic mini-mod, one firing per check", () => {
  let dir, result;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "modlint-dirty-"));
    writeMod(dir, {
      smRes: SM_RESOURCES,
      // bad_region_tag is a REGION TAG but not declared in the JSON -> the fatal case
      regions: regionsTxt("bad_region_tag, good_tag"),
      edb: edbTxt(
        [
          // FATAL: hidden_resource token that is a region tag but undeclared in JSON
          "population_growth_bonus bonus 1 requires hidden_resource bad_region_tag",
          // WARN (dead): declared hidden, zero regions, no script grant
          "population_growth_bonus bonus 1 requires hidden_resource dead_token",
          // clean: declared hidden, zero regions, but a campaign script grants it
          "population_growth_bonus bonus 1 requires hidden_resource scripted_token",
          // FATAL: plain resource absent from descr_sm_resources entirely
          "population_growth_bonus bonus 1 requires resource missing_res",
          // WARN: unknown chain
          "population_growth_bonus bonus 1 requires building_present no_such_chain",
          // WARN: known chain, unknown level
          "population_growth_bonus bonus 1 requires building_present_min_level core_building citadel",
        ],
        [
          'recruit "real unit" 0 requires factions { all, }',
          // ERROR: recruit target missing from the EDU
          'recruit "ghost unit" 0 requires factions { all, }',
        ]
      ),
      edu: EDU,
      strat: stratTxt([
        "unit\tstrat unit\t\t\texp 0 armour 0 weapon_lvl 0",
        // ERROR: army unit missing from the EDU
        "unit\tphantom unit\t\t\texp 0 armour 0 weapon_lvl 0",
      ]),
      script: "add_hidden_resource local scripted_token\n;add_hidden_resource local dead_token\n",
    });
    result = lintMod(dir);
  });

  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

  it("returns the { warnings, counts, ms } shape", () => {
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(typeof result.ms).toBe("number");
    expect(result.counts).toEqual({ fatal: 2, error: 2, warn: 3 });
  });

  it("check 1 FATAL: hidden_resource region tag undeclared in descr_sm_resources", () => {
    const w = result.warnings.filter((x) => x.check === "edb-undeclared-resource" && /bad_region_tag/.test(x.detail));
    expect(w).toHaveLength(1);
    expect(w[0].severity).toBe("fatal");
    expect(w[0].detail).toMatch(/unrecognised resource class/);
  });

  it("check 1 FATAL: plain resource token absent from descr_sm_resources entirely", () => {
    const w = result.warnings.filter((x) => x.check === "edb-undeclared-resource" && /missing_res/.test(x.detail));
    expect(w).toHaveLength(1);
    expect(w[0].severity).toBe("fatal");
  });

  it("check 2 ERROR: descr_strat army unit missing from the EDU", () => {
    const w = result.warnings.filter((x) => x.check === "strat-unknown-unit");
    expect(w).toHaveLength(1);
    expect(w[0].severity).toBe("error");
    expect(w[0].detail).toMatch(/phantom unit/);
  });

  it("check 3 ERROR: EDB recruit unit missing from the EDU", () => {
    const w = result.warnings.filter((x) => x.check === "edb-unknown-recruit");
    expect(w).toHaveLength(1);
    expect(w[0].severity).toBe("error");
    expect(w[0].detail).toMatch(/ghost unit/);
  });

  it("check 4 WARN: building_present unknown chain + unknown level (one each)", () => {
    const w = result.warnings.filter((x) => x.check === "edb-unknown-building");
    expect(w).toHaveLength(2);
    expect(w.every((x) => x.severity === "warn")).toBe(true);
    expect(w.some((x) => /no_such_chain/.test(x.detail))).toBe(true);
    expect(w.some((x) => /core_building citadel/.test(x.detail))).toBe(true);
  });

  it("check 5 WARN: dead hidden_resource fires; script-granted token does not", () => {
    const w = result.warnings.filter((x) => x.check === "edb-dead-hidden-resource");
    expect(w).toHaveLength(1);
    expect(w[0].severity).toBe("warn");
    expect(w[0].detail).toMatch(/dead_token/);
    // scripted_token is granted by an (uncommented) add_hidden_resource — clean.
    // The commented-out grant for dead_token must NOT have suppressed its warn.
    expect(result.warnings.some((x) => /scripted_token/.test(x.detail))).toBe(false);
  });

  it("used, declared, region-tagged tokens and real units produce no findings", () => {
    expect(result.warnings.some((x) => /good_tag|"iron"|real unit|strat unit/.test(x.detail))).toBe(false);
  });
});

describe("modLint — fully consistent mod is clean (zero false positives)", () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "modlint-clean-"));
    writeMod(dir, {
      smRes: SM_RESOURCES,
      regions: regionsTxt("good_tag"),
      edb: edbTxt(
        [
          "population_growth_bonus bonus 1 requires hidden_resource scripted_token",
          "population_growth_bonus bonus 1 requires building_present_min_level core_building town",
          "population_growth_bonus bonus 1 requires not building_present core_building queued",
          "population_growth_bonus bonus 1 requires hidden_resource capital",
        ],
        ['recruit "real unit" 0 requires factions { all, }']
      ),
      edu: EDU,
      strat: stratTxt(["unit\tstrat unit\t\t\texp 0 armour 0 weapon_lvl 0"]),
      script: "add_hidden_resource local scripted_token\n",
    });
  });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

  it("reports zero findings", () => {
    const r = lintMod(dir);
    expect(r.warnings).toEqual([]);
    expect(r.counts).toEqual({ fatal: 0, error: 0, warn: 0 });
  });
});

describe("modLint — missing files degrade to fatal findings, no throw", () => {
  it("empty dir yields missing-file fatals only", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "modlint-empty-"));
    try {
      const r = lintMod(dir);
      expect(r.warnings.length).toBeGreaterThan(0);
      expect(r.warnings.every((w) => w.check === "missing-file" && w.severity === "fatal")).toBe(true);
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } }
  });
});

// ── check 6: requires clauses mixing and/or without grouping ─────────────────
// RTW's requires syntax has no parentheses and evaluates left-to-right with no
// operator precedence — which is how this app's own EDB evaluator reads it
// (src/growthEval.js evalReq, calibrated line-for-line against the in-game
// growth scroll). So `A and B or C` is (A and B) or C, and C alone satisfies it.
//
// The rule's whole value is being RIGHT about the reading, so the two shapes are
// tested separately: a pure-`or` tail really does short-circuit, but a tail
// containing another `and` does NOT, and claiming otherwise would be worse than
// staying quiet.
describe("edb-and-or-precedence", () => {
  const lintEdb = (body) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "modlint-andor-"));
    fs.writeFileSync(path.join(dir, "export_descr_buildings.txt"), body);
    const r = lintMod(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    return r.warnings.filter((w) => w.check === "edb-and-or-precedence");
  };

  it("shows the true left-to-right grouping and the short-circuit for a pure-or tail", () => {
    const w = lintEdb(`building x\n{\n\tlevels a\n\t{\n\t\ta requires not is_player and homeland and size1 or size2 or size3\n\t}\n}\n`);
    expect(w).toHaveLength(1);
    expect(w[0].severity).toBe("warn");
    expect(w[0].detail).toMatch(/\(\(\(\(not is_player and homeland\) and size1\) or size2\) or size3\)/);
    expect(w[0].detail).toMatch(/"size2" or "size3" alone satisfies the whole condition/);
  });

  it("does NOT claim a short-circuit when an `and` trails the `or`", () => {
    // A and B or C and D  →  ((A and B) or C) and D — C alone is NOT enough
    const w = lintEdb(`building x\n{\n\tlevels a\n\t{\n\t\ta requires mic_tier_1 and hidden_resource aor_gallic or hidden_resource aor_belgic and aor_tier_1\n\t}\n}\n`);
    expect(w).toHaveLength(1);
    expect(w[0].detail).toMatch(/\(\(\(mic_tier_1 and hidden_resource aor_gallic\) or hidden_resource aor_belgic\) and aor_tier_1\)/);
    expect(w[0].detail).not.toMatch(/alone satisfies/);
    expect(w[0].detail).toMatch(/Note the trailing "and"/);
  });

  it("ignores clauses that are pure `and`, pure `or`, or lead with the `or`", () => {
    expect(lintEdb(`building x\n{\n\tlevels a\n\t{\n\t\ta requires size1 and size2 and size3\n\t}\n}\n`)).toHaveLength(0);
    expect(lintEdb(`building x\n{\n\tlevels a\n\t{\n\t\ta requires size1 or size2 or size3\n\t}\n}\n`)).toHaveLength(0);
    // no `and` before the first `or` → the reading is unsurprising
    expect(lintEdb(`building x\n{\n\tlevels a\n\t{\n\t\ta requires size1 or size2 and size3\n\t}\n}\n`)).toHaveLength(0);
  });

  it("skips commented-out lines", () => {
    expect(lintEdb(`building x\n{\n\tlevels a\n\t{\n\t\t;a requires not is_player and homeland and size1 or size2\n\t}\n}\n`)).toHaveLength(0);
  });

  it("collapses long faction lists so the message stays readable", () => {
    const facs = "factions { " + Array.from({ length: 40 }, (_, i) => "f" + i).join(", ") + ", }";
    const w = lintEdb(`building x\n{\n\tlevels a\n\t{\n\t\ta requires ${facs} and size1 or size2\n\t}\n}\n`);
    expect(w).toHaveLength(1);
    expect(w[0].detail).toMatch(/factions \{…40\}/);
    expect(w[0].detail).not.toMatch(/f17/);        // no name dump
    expect(w[0].detail.length).toBeLessThan(500);
  });

  it("reports each distinct clause once, however many levels repeat it", () => {
    const one = "\t\ta requires not is_player and homeland and size1 or size2\n";
    const w = lintEdb(`building x\n{\n\tlevels a\n\t{\n${one}${one}${one}\n\t}\n}\n`);
    expect(w).toHaveLength(1);
  });
});

// ── check 7: descr_formations_ai.txt unit_type tokens ────────────────────────
// This rule came out of v7.12 telemetry, where the engine rejected a formation
// token 413 times across 32 sessions. The property that matters is that it is
// NARROW: the first attempt at it assumed every underscore-joined token was a mod
// invention and would have condemned 192 lines, when the three vanilla files use
// most of them. These tests pin that — real vanilla tokens must pass, and only the
// genuinely absent one may fail.
describe("formations-unknown-unit-type", () => {
  it("extracts the token from every real line shape, comment and ratio included", () => {
    const cases = [
      ["\t\tunit_type heavy infantry 2.0", "heavy infantry"],
      ["\t\tunit_type any\t\t0.0", "any"],
      ["\t\tunit_type siege 1 ;; right artillery shooting position", "siege"],
      ["\t\tunit_type carrying_siege_engine tower 1.0", "carrying_siege_engine tower"],
      ["\t\tunit_type spearmen", "spearmen"],
      ["\t\tunit_type missile cavalry -1.0", "missile cavalry"],
      ["  ; unit_type specifies units that can be allocated", null],
      ["\t\tunit_density close", null],
      ["", null],
    ];
    for (const [line, want] of cases) {
      expect(parseUnitTypeToken(line), JSON.stringify(line)).toBe(want);
    }
  });

  it("accepts every token vanilla itself uses — the false-positive trap", () => {
    // every one of these LOOKS like a mod invention (underscores, odd names) and
    // is in fact used by the shipped vanilla files
    const tokens = [
      "heavy_pilum_infantry", "light_pilum_infantry", "spearmen_pilum_infantry",
      "non_phalanx_spear", "ranged_missile_infantry", "chanting_screeching",
      "phalanx", "swimming", "general_unit",
      "carrying_siege_engine ram", "spearmen cavalry", "skirmish infantry",
    ];
    const body = tokens.map((t) => "\t\tunit_type " + t + " 1.0").join("\n");
    const hits = [];
    const r = lintFormations(body, (sev, check, file, detail) => hits.push({ sev, check, detail }));
    expect(hits, "a vanilla token was wrongly flagged").toEqual([]);
    expect(r).toMatchObject({ checked: tokens.length, unknown: 0 });
  });

  it("flags a token vanilla never uses, and names the near miss", () => {
    const body = [
      "\t\tunit_type heavy infantry 2.0",
      "\t\tunit_type pilum_infantry 1.0",
      "\t\tunit_type pilum_infantry 0.5",
    ].join("\n");
    const hits = [];
    const r = lintFormations(body, (sev, check, file, detail) => hits.push({ sev, check, file, detail }));
    expect(r).toMatchObject({ checked: 3, unknown: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0].sev).toBe("error");
    expect(hits[0].check).toBe("formations-unknown-unit-type");
    expect(hits[0].file).toBe("descr_formations_ai.txt");
    expect(hits[0].detail).toMatch(/line 2/);                    // first occurrence
    expect(hits[0].detail).toMatch(/\(2 uses\)/);
    expect(hits[0].detail).toMatch(/NONE of the three vanilla/);
    // quote the engine's own wording, so the message is greppable against a log
    expect(hits[0].detail).toMatch(/Failed to find either a unit class or unit category\. Provided: 'pilum_infantry'/);
    expect(hits[0].detail).toMatch(/heavy_pilum_infantry/);
    expect(hits[0].detail).toMatch(/dropped prefix/);
  });

  it("says so plainly when there is no similar vanilla token", () => {
    const hits = [];
    lintFormations("\t\tunit_type wibble_wobble 1.0", (s, c, f, d) => hits.push(d));
    expect(hits[0]).toMatch(/No similar vanilla token exists/);
  });

  it("stays silent when the mod has no formations file at all", () => {
    const hits = [];
    expect(lintFormations(null, () => hits.push(1))).toEqual({ checked: 0, unknown: 0 });
    expect(lintFormations("", () => hits.push(1))).toEqual({ checked: 0, unknown: 0 });
    expect(hits).toEqual([]);
  });

  it("reports a count of what it examined, so a silently-inert rule is detectable", () => {
    // a rule that checks nothing and reports nothing looks identical to a clean
    // file — the same trap as a falsifier that examined zero pairs
    const r = lintFormations("\t\tunit_type any 1.0\n\t\tunit_type any 1.0", () => {});
    expect(r.checked).toBe(2);
  });

  it("keeps the full vanilla vocabulary, and never whitelists the defect", () => {
    // if this size drops, someone trimmed the set and false positives follow
    expect(VANILLA_UNIT_TYPES.size).toBe(29);
    expect(VANILLA_UNIT_TYPES.has("pilum_infantry"), "the defective token must NOT be whitelisted").toBe(false);
    expect(VANILLA_UNIT_TYPES.has("heavy_pilum_infantry")).toBe(true);
  });
});

// ── the confidence grading, and the trap that motivated it ───────────────────
// Absence from vanilla is NOT evidence of invalidity. I nearly reported
// `unit_density loose` (20 uses in RIS, 0 in vanilla) and `block_formation square`
// (4 in RIS, 0 in vanilla) as defects on that basis alone — the file's own header
// documents both as legal. So a token that merely fails to appear in vanilla is a
// warning, while a NEAR MISS of a real token (a dropped prefix, a typo) is an
// error. `pilum_infantry` is the latter, and the engine confirmed it 413 times.
describe("formations rule grades findings by confidence", () => {
  it("treats a near miss as an error — the pilum_infantry case", () => {
    const hits = [];
    lintFormations("\t\tunit_type pilum_infantry 1.0", (sev, check, file, detail) => hits.push({ sev, detail }));
    expect(hits).toHaveLength(1);
    expect(hits[0].sev).toBe("error");
    expect(hits[0].detail).toMatch(/dropped prefix/);
  });

  it("treats a wholly novel token as a WARNING, not an accusation", () => {
    const hits = [];
    lintFormations("\t\tunit_type wibble_wobble 1.0", (sev, check, file, detail) => hits.push({ sev, detail }));
    expect(hits).toHaveLength(1);
    expect(hits[0].sev).toBe("warn");
    expect(hits[0].detail).toMatch(/may be a deliberate extension/);
    expect(hits[0].detail).toMatch(/absence from vanilla is not proof/);
    // and it points at the evidence that would settle it
    expect(hits[0].detail).toMatch(/error_log/);
  });
});

// ── values the file's own header documents ───────────────────────────────────
describe("formations-bad-value", () => {
  it("accepts every documented value, including the two vanilla never uses", () => {
    const body = [
      "\t\tunit_density close",
      "\t\tunit_density loose",          // 0 uses in vanilla, documented as legal
      "\t\tblock_formation line",
      "\t\tblock_formation column",
      "\t\tblock_formation square",      // 0 uses in vanilla, documented as legal
    ].join("\n");
    const hits = [];
    const r = lintFormationValues(body, (sev, check, file, detail) => hits.push(detail));
    expect(hits, "a documented value was wrongly flagged").toEqual([]);
    expect(r).toMatchObject({ checked: 5, bad: 0 });
  });

  it("flags a value the header does not list, and quotes the legal set", () => {
    const hits = [];
    const r = lintFormationValues("\t\tunit_density sparse\n\t\tunit_density sparse", (sev, check, file, detail) => hits.push({ sev, check, detail }));
    expect(r).toMatchObject({ checked: 2, bad: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0].sev).toBe("error");
    expect(hits[0].check).toBe("formations-bad-value");
    expect(hits[0].detail).toMatch(/line 1/);
    expect(hits[0].detail).toMatch(/\(2 uses\)/);
    expect(hits[0].detail).toMatch(/"loose", "close"/);
    expect(hits[0].detail).toMatch(/this file's own header documents/);
  });

  it("flags a bad block_formation too", () => {
    const hits = [];
    lintFormationValues("\t\tblock_formation circle", (s, c, f, d) => hits.push(d));
    expect(hits[0]).toMatch(/block_formation "circle"/);
    expect(hits[0]).toMatch(/"square", "column", "line"/);
  });

  it("ignores comments and a missing file", () => {
    const hits = [];
    lintFormationValues(";\tunit_density\t\t\t\teither loose or close", (s, c, f, d) => hits.push(d));
    expect(hits, "the header's own documentation line must not be parsed as data").toEqual([]);
    expect(lintFormationValues(null, () => hits.push(1))).toEqual({ checked: 0, bad: 0 });
  });

  it("does not check unit_formation, whose documented list is open-ended", () => {
    // the header ends that line with "(wedge, square, ...)" — an incomplete list
    // cannot be validated, and guessing would produce false positives
    expect(Object.keys(DOCUMENTED_FORMATION_VALUES).sort()).toEqual(["block_formation", "unit_density"]);
    const hits = [];
    lintFormationValues("\t\tunit_formation anything_at_all", (s, c, f, d) => hits.push(d));
    expect(hits).toEqual([]);
  });
});
