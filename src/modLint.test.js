// modLint.test.js — hermetic tests for the parse-time mod consistency lint.
// Builds a synthetic mini-mod in a temp dir with EXACTLY ONE instance of each
// check firing, plus a fully-consistent clean mod asserting zero false
// positives. No real mod files are touched.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { lintMod } from "./modLint.js";

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
