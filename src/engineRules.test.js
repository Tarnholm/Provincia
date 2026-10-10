// Engine rules (src/engineRules.js): each check flags the broken form and passes
// the fixed one. Fixtures are tiny hand-written mod files.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("./engineRules.js");

const CULTURES = `"cultures":
[
	"roman":
	{
		"string": "ROMAN",
		"portrait mapping": "roman",
	},
	"greek":
	{
		"portrait mapping": "greek",
	},
	"hosts": ;; factionless portrait host
	{
		"portrait mapping": "hosts",
	},
]
`;
const SM = `"factions":
[
	"romans": ;Rome
	{
		"culture":   "roman",
		"emergence":
		{
			"settlement units":
			[
				"legionaries",
			],
		},
	},
	"athens":
	{
		"culture":   "greek",
		"horde":
		{
			"horde units":
			[
				"hoplites",
				"legionaries",
			],
		},
	},
	"sparta":
	{
		"culture":   "greek",
		"shadow faction": "athens",
	},
	"slave":
	{
		"culture":   "greek",
	},
]
`;
const cultures = E.parseCultures(CULTURES);
const sm = E.parseSmFactions(SM);
const U = E.makeUniverse(sm, cultures);

const edbOf = (levels) => E.parseEdb(`building things
{
	levels ${levels.map((l) => l.name).join(" ")}
	{
${levels.map((l) => `		${l.name} requires ${l.req}
		{
			capability
			{
${(l.caps || []).map((c) => `				${c}`).join("\n")}
			}
			construction  ${l.turns ?? 2}
			cost  ${l.cost ?? 800}
			settlement_min ${l.min || "town"}
			upgrades
			{
			}
		}`).join("\n")}
	}
	plugins
	{
	}
}
`);

describe("loose parsing", () => {
  it("reads cultures, mappings and faction keys past ; comments", () => {
    expect(cultures.map((c) => [c.name, c.portraitMapping])).toEqual([["roman", "roman"], ["greek", "greek"], ["hosts", "hosts"]]);
    expect(sm.map((f) => f.name)).toEqual(["romans", "athens", "sparta", "slave"]);
    expect(sm[0].emergenceUnits).toEqual(["legionaries"]);
    expect(sm[1].hordeUnits).toEqual(["hoplites", "legionaries"]);
    expect(sm[2].shadow).toBe("athens");
  });
});

describe("conditions: static faction bitset", () => {
  it("groups from the right and binds not to the next term", () => {
    const p = E.parseCondition("factions { romans, } and is_player or factions { athens, }");
    expect(E.engineReading(p)).toBe("factions { romans } and (is_player or factions { athens })");
    // romans AND (all OR athens) = romans
    expect(U.names(E.evalCondition(p, U))).toEqual(["romans"]);
    expect(U.names(E.evalCondition(E.parseCondition("not factions { slave, } and factions { all, }"), U))).toEqual(["romans", "athens", "sparta"]);
    expect(U.names(E.evalCondition(E.parseCondition("factions { greek, }"), U))).toEqual(["athens", "sparta", "slave"]);
    expect(E.evalCondition(E.parseCondition("not hidden_resource x"), U)).toBe(0n);
  });
});

describe("browser walk", () => {
  it("flags a level closed to factions that can build a later one (the v7.21 roads gap)", () => {
    const broken = edbOf([
      { name: "dirt", req: "factions { all, } and not hidden_resource no_roads" },
      { name: "paved", req: "factions { all, }" },
    ]);
    const gap = E.checkBrowserGaps(broken, U);
    expect(gap.issues).toHaveLength(1);
    expect(gap.issues[0].text).toMatch(/dirt is closed to 4 factions that can build paved/);
    expect(E.checkDirectNot(broken, U).issues[0].text).toMatch(/`not hidden_resource no_roads` counts as no faction/);
    const fixed = edbOf([
      { name: "dirt", req: "factions { all, } and has_roads" },
      { name: "paved", req: "factions { all, }" },
    ]);
    expect(E.checkBrowserGaps(fixed, U).issues).toHaveLength(0);
    expect(E.checkDirectNot(fixed, U).issues).toHaveLength(0);
  });
  it("ignores a `not` that an `or` makes harmless", () => {
    const edb = edbOf([{ name: "a", req: "factions { all, } or not is_player" }]);
    expect(E.checkDirectNot(edb, U).issues).toHaveLength(0);
  });
  it("skips a level whose settlement_min is below the browser column", () => {
    const edb = edbOf([
      { name: "a", req: "factions { all, }", min: "town" },
      { name: "b", req: "factions { all, }", min: "town" },
      { name: "c", req: "factions { all, }", min: "city" },
    ]);
    const r = E.checkBrowserSizeSkips(edb);
    expect(r.issues.map((i) => i.snippet)).toEqual(["b"]);
  });
});

describe("EDB numbers and grouping", () => {
  it("flags wrapping cost, turns and capability values", () => {
    const edb = edbOf([{ name: "a", req: "factions { all, }", cost: 70000, turns: 300, caps: ["law_bonus bonus 40000", "happiness_bonus bonus 3", "recruit \"x\" 0 requires factions { all, }"] }]);
    const r = E.checkEdbNumbers(edb);
    expect(r.severity).toBe("error");
    expect(r.issues.map((i) => i.text)).toEqual([
      expect.stringMatching(/cost 70000 — above 65,535 the cost wraps \(stored as 4464\)/),
      expect.stringMatching(/construction 300 turns/),
      expect.stringMatching(/law_bonus 40000/),
    ]);
    expect(E.checkEdbNumbers(edbOf([{ name: "a", req: "factions { all, }", cost: 19000 }])).issues).toHaveLength(0);
    expect(E.checkEdbNumbers(edbOf([{ name: "a", req: "factions { all, }", cost: 20000 }])).issues[0].sev).toBe("info");
  });
  it("shows how the engine reads `and` before `or`", () => {
    const edb = edbOf([{ name: "a", req: "factions { all, }", caps: ["law_bonus bonus 1 requires is_player and port or hidden_resource x"] }]);
    const r = E.checkMixedAndOr(edb);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].text).toMatch(/read as is_player and \(port or hidden_resource x\)/);
    expect(E.checkMixedAndOr(edbOf([{ name: "a", req: "is_player or port and factions { all, }" }])).issues).toHaveLength(0);
  });
});

const EDU = `type             legionaries
dictionary       legionaries
ownership        romans

type             hoplites
dictionary       hoplites
ownership        athens, sparta
`;
const edu = E.parseEdu(EDU);

describe("EDU ownership", () => {
  it("flags recruit lines naming a faction outside the unit's ownership", () => {
    const text = `				recruit "legionaries" 0 requires factions { romans, athens, }
				recruit "hoplites" 0 requires factions { athens, } and not factions { romans, }`;
    const r = E.checkRecruitOwnership(null, text, edu, U);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].text).toMatch(/^legionaries: athens/);
  });
  it("flags horde units the faction does not own", () => {
    const r = E.checkHordeUnits(sm, edu, U);
    expect(r.issues.map((i) => i.text)).toEqual(['athens: horde unit "legionaries" is not in its EDU ownership']);
  });
});

describe("descr_strat", () => {
  const strat = E.parseStrat(`faction	romans, ai_romans
re_emergent
character	Gaius, named character, leader, age 40, , x 1, y 1
army
unit		legionaries			exp 0 armour 0 weapon_lvl 0
${"unit		legionaries			exp 0 armour 0 weapon_lvl 0\n".repeat(20)}
faction	athens, ai_athens
re_emergent
faction	sparta, ai_sparta
dead_until_resurrected
spawn_script sparta, revolt, spawn_scripts/sparta.txt
;spawn_script slave, revolt, x.txt
`);
  it("flags a land army over 20 units", () => {
    expect(E.checkArmySize(strat).issues.map((i) => i.text)).toEqual(["romans: Gaius starts with 21 units"]);
  });
  it("flags only re-emerging factions that can come back with no list and >256 units", () => {
    const many = new Map([...Array(300)].map((_, i) => [`u${i}`, { type: `u${i}`, ownership: ["all"] }]));
    const r = E.checkEmergence(strat, sm, many, U);
    // romans has a list; athens is sparta's shadow -> can emerge; sparta has a spawn_script.
    expect(r.issues.map((i) => i.text)).toEqual([
      expect.stringMatching(/^athens \(re_emergent\) has no "emergence" settlement units and may own 300 units/),
      expect.stringMatching(/^sparta \(dead_until_resurrected\)/),
    ]);
    expect(E.checkEmergence(strat, sm, edu, U).issues).toHaveLength(0);   // few units: no overflow
  });
});

describe("win conditions", () => {
  it("flags region names in hold_regions", () => {
    const regions = E.parseRegions(`; comment
Latium
	Roma
	romans

Attica
	Athenai
	athens
`);
    const r = E.checkHoldRegions(`romans\nhold_regions Roma Attica Nowhere\ntake_regions 20\n`, regions);
    expect(r.issues.map((i) => i.text)).toEqual(["romans: Attica is a region name — its settlement is Athenai", "romans: Nowhere is not a settlement in descr_regions"]);
  });
});

describe("cultures", () => {
  it("flags a culture with no banner block, factionless included", () => {
    const r = E.checkCultureBanners(cultures, "banner		roman\n{\n}\nbanner	greek\n");
    expect(r.issues.map((i) => i.snippet)).toEqual(['"hosts"']);
    expect(E.checkCultureBanners(cultures, "banner roman\nbanner greek\nbanner hosts\n").issues).toHaveLength(0);
  });
  it("flags a factionless culture used as a descr_building_battle filter", () => {
    const bb = "texture_variants\n{\n\tgates1.tga\n\t{\n\t\troman gates1.tga\n\t\thosts gates1.tga\n\t}\n\thosts.tga\n\t{\n\t\tany hosts.tga\n\t}\n}\n";
    const r = E.checkFactionlessCultureFilters(cultures, U, bb);
    expect(r.issues.map((i) => i.line)).toEqual([6]);
  });
  it("flags a culture with factions and no lookup_variants fallback", () => {
    const r = E.checkLookupVariants(cultures, U, "lookup_variants\n{\n    greek roman\n    temple_a temple_b\n}\n");
    expect(r.issues.map((i) => i.text)).toEqual(["roman has no fallback lines in lookup_variants"]);
  });
});

describe("portraits", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "engine-rules-"));
  const mk = (rel) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ""); };
  mk("ui/hosts/portraits/portraits/young/generals/001.tga.dds");
  mk("ui/hosts/portraits/portraits/young/generals/001.tga");
  mk("ui/hosts/portraits/portraits/young/generals/002.tga.dds");
  mk("ui/greek/portraits/portraits/old/civilian/001.tga.dds");
  it("flags NNN.tga beside NNN.tga.dds", () => {
    const r = E.checkPortraitTgaBesideDds(tmp, cultures);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].text).toMatch(/^1 portrait with a \.tga beside the \.tga\.dds \(001\.tga\)/);
  });
  it("flags a mod portrait set with no variation block", () => {
    expect(E.checkPortraitVariation(tmp, cultures, "greek\n{\n\told\n\t{\n\t}\n}\n").issues.map((i) => i.snippet)).toEqual(["hosts"]);
    // No file in the mod: the game's own covers the vanilla sets only.
    expect(E.checkPortraitVariation(tmp, cultures, null).issues.map((i) => i.snippet)).toEqual(["hosts"]);
    expect(E.checkPortraitVariation(tmp, cultures, "greek\n{\n}\nhosts\n{\n}\n").issues).toHaveLength(0);
  });
});

describe("files and events", () => {
  it("flags an LF-only AI personality file", () => {
    expect(E.checkAiPersonalityCrlf("personality ai_x\n{\n}\n").issues).toHaveLength(1);
    expect(E.checkAiPersonalityCrlf("personality ai_x\r\n{\r\n}\r\n").issues).toHaveLength(0);
  });
  it("flags an event with no title/body string", () => {
    const events = "event	earthquake	earthquake_in_iberia ; 60 BC\ndate	210 summer\n\nevent historic rhodes_quake\n";
    const r = E.checkEventStrings(events, "{RHODES_QUAKE_TITLE}x\n{RHODES_QUAKE_BODY}y\n");
    expect(r.issues.map((i) => i.text)).toEqual(["earthquake earthquake_in_iberia — no {EARTHQUAKE_IN_IBERIA_TITLE} / {EARTHQUAKE_IN_IBERIA_BODY} in text/historic_events.txt"]);
  });
  it("flags floods with scale below 2", () => {
    const disasters = [{ file: "descr_disasters.txt", text: "event volcano v\nmin_scale 0\n\nevent		flood\nfrequency 10\nmin_scale	1\nmax_scale 3\n" }];
    const r = E.checkFloodScale(disasters, "event flood flood_in_rome ; Tiber\nscale 1\n\nevent volcano x\nscale 0\n");
    expect(r.issues.map((i) => i.text)).toEqual(["flood (event at line 4) min_scale 1", "flood flood_in_rome scale 1"]);
    expect(E.checkFloodScale([{ file: "descr_disasters.txt", text: "event flood\nmin_scale 2\n" }], "event flood f\nscale 2\n").issues).toHaveLength(0);
  });
});

describe("runAll", () => {
  it("skips checks whose files are missing instead of failing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "engine-rules-empty-"));
    const r = E.runAll(tmp, (p) => fs.readFileSync(p, "utf8"));
    expect(r.error).toBeNull();
    expect(r.checks).toEqual([]);
    expect(r.skipped.length).toBeGreaterThan(10);
  });
});
