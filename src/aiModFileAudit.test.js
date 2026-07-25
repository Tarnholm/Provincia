// AI ↔ mod-file audit — parsers checked against REAL RIS file syntax, and the
// lead rules checked end-to-end on a small hand-built world.
import { describe, it, expect } from "vitest";
import { auditModFiles, parseAiPersonality, parseStratFactions, parseNavalOwners, parseSmFactions } from "./aiModFileAudit.js";

// verbatim-shaped excerpts from RIS data files
const AI_PERS = `
;;; Building Priorities
building_priority Balanced
population_growth_bonus 80

diplomatic_priority super_aggressive
aggresiveness 100

diplomatic_priority passive
aggresiveness 50

;;; Personalities
personality ai_chios
building_priority chios
military_priority chios
diplomatic_priority super_aggressive

personality ai_rome
building_priority romans_julii
military_priority romans_julii
diplomatic_priority passive
`;

const STRAT = `
faction	chios, ai_chios
denari	5700
settlement
{
	level large_town
	region Chios
	building
	{
		type port_buildings port
	}
}
character	Angeliskos, named character, leader, age 60, , x 437, y 360
army
unit		greek general			exp 0 armour 0 weapon_lvl 0
unit		greek hoplites			exp 0 armour 0 weapon_lvl 0

faction	romans_julii, ai_rome
denari	20000
settlement
{
	level city
	region Roma
}
character	Quintus, named character, leader, age 60, , x 285, y 404
army
unit		roman general			exp 0 armour 0 weapon_lvl 0
character	Gaius Admiral, admiral, age 30, , x 100, y 100
army
unit		naval triremes			exp 0 armour 0 weapon_lvl 0
`;

const EDU = `
type		naval triremes
category	ship
ownership	romans_julii, carthage, chios
type		roman hoplites
category	infantry
ownership	romans_julii
`;

const SM = `
	"chios":
	{
		"culture":   "greek",
		"default religion": "ionian",
	}
	"romans_julii":
	{
		"culture":   "roman",
		"default religion": "italic",
	}
`;

describe("mod-file parsers (real RIS syntax)", () => {
  it("reads personalities and their aggression profiles", () => {
    const { personalities, diplomatic } = parseAiPersonality(AI_PERS);
    expect(personalities.ai_chios).toMatchObject({ building: "chios", military: "chios", diplomatic: "super_aggressive" });
    expect(diplomatic.super_aggressive.aggresiveness).toBe(100);
    expect(diplomatic.passive.aggresiveness).toBe(50);
  });
  it("reads descr_strat faction starting positions", () => {
    const s = parseStratFactions(STRAT);
    expect(s.chios).toMatchObject({ aiPersonality: "ai_chios", settlements: 1, denari: 5700, admirals: 0 });
    expect(s.chios.units).toBe(2);
    expect(s.romans_julii.admirals).toBe(1);
  });
  it("reads naval ownership from EDU (ships only)", () => {
    const n = parseNavalOwners(EDU);
    expect(n.chios).toBe(1);
    expect(n.romans_julii).toBe(1);
    expect(n.carthage).toBe(1);
  });
  it("reads culture/religion from descr_sm_factions", () => {
    const sm = parseSmFactions(SM);
    expect(sm.chios).toMatchObject({ culture: "greek", religion: "ionian" });
  });
});

describe("audit leads", () => {
  const files = { aiPersonality: AI_PERS, strat: STRAT, smFactions: SM, edu: EDU };
  const saveFacts = {
    turn: 102,
    menByFaction: { chios: 240, romans_julii: 14699 },
    settlementsByFaction: { chios: 1, romans_julii: 40 },
    navalByFaction: { romans_julii: 3 },
  };
  const findings = [
    { kind: "campaign_stall", faction: "chios", region: "Erythrai", detail: "GATHERING for 9 turns, still 0/11590 strength — never launches", impossible: true, verdict: "NEVER arrived — x" },
    { kind: "stuck_mission", faction: "chios", region: "Erythrai", detail: "ordered toward 'Erythrai' in 50 separate turns", verdict: "NEVER arrived — ptolemaic holds Erythrai" },
  ];

  it("flags max aggression on a faction that cannot act, naming file+key", () => {
    const { leads } = auditModFiles({ findings, saveFacts, files });
    const agg = leads.find((l) => l.file.includes("feral_descr_ai_personality") && /aggresiveness 100/.test(l.key));
    expect(agg).toBeTruthy();
    expect(agg.faction).toBe("chios");
    expect(agg.severity).toBe(3);
    expect(agg.evidence).toMatch(/impossible campaign/);
  });

  it("flags a no-navy faction whose orders never arrive, and knows it CAN own ships", () => {
    const { leads } = auditModFiles({ findings, saveFacts, files });
    const nav = leads.find((l) => /no starting admiral/.test(l.key));
    expect(nav).toBeTruthy();
    expect(nav.faction).toBe("chios");
    // chios IS in a ship ownership line, so severity is the milder 2 and the
    // suggestion must be descr_strat (give a transport), not an EDU edit
    expect(nav.severity).toBe(2);
    expect(nav.suggestion).toMatch(/starting transport/);
  });

  it("does not flag a healthy faction", () => {
    const { leads } = auditModFiles({ findings, saveFacts, files });
    expect(leads.some((l) => l.faction === "romans_julii")).toBe(false);
  });

  it("profiles factions with file facts joined to save facts", () => {
    const { factions } = auditModFiles({ findings, saveFacts, files });
    expect(factions.chios).toMatchObject({
      aiPersonality: "ai_chios", diplomaticProfile: "super_aggressive", aggresiveness: 100,
      culture: "greek", canOwnShips: 1, menAtSave: 240, settlementsAtSave: 1,
    });
  });
});

describe("recruitment- vs income-blocked leads", () => {
  const AI = `
diplomatic_priority super_aggressive
aggresiveness 100
personality ai_poor
building_priority poorbuild
military_priority poormil
diplomatic_priority super_aggressive
personality ai_rich
building_priority richbuild
military_priority richmil
diplomatic_priority super_aggressive
`;
  const STRAT = `
faction	poor, ai_poor
denari	3000
settlement
{
	level town
	region A
}
faction	rich, ai_rich
denari	30000
settlement
{
	level city
	region B
}
`;
  const files = { aiPersonality: AI, strat: STRAT, smFactions: "", edu: "" };
  // 20 settlements keeps both out of the "≤3 settlements" aggression rule, so
  // only the recruitment/income leads can fire here.
  const saveFacts = { turn: 102, menByFaction: { poor: 600, rich: 900 }, settlementsByFaction: { poor: 20, rich: 20 } };

  it("names the mic/building-priority lever when the faction is recruitment-capped", () => {
    const { leads } = auditModFiles({
      findings: [{ kind: "campaign_stall", faction: "poor", region: "X", detail: "still 0/20000 strength", impossible: true, blockedBy: "recruitment", micMax: 1, micMissing: 3, micTowns: 4 }],
      saveFacts, files,
    });
    const l = leads.find((x) => /RECRUITMENT-capped/.test(x.issue));
    expect(l).toBeTruthy();
    expect(l.file).toMatch(/export_descr_buildings/);
    expect(l.key).toMatch(/military_industrial_complex tier 1/);
    expect(l.key).toMatch(/building_priority poorbuild/);
    expect(l.issue).toMatch(/3\/4 of its towns have none/);
  });

  it("points at economy files when infrastructure is fine but money isn't", () => {
    const { leads } = auditModFiles({
      findings: [{ kind: "campaign_stall", faction: "rich", region: "Y", detail: "still 0/20000 strength", impossible: true, blockedBy: "income", micMax: 3, micMissing: 0, micTowns: 5 }],
      saveFacts, files,
    });
    const l = leads.find((x) => /INCOME-limited/.test(x.issue));
    expect(l).toBeTruthy();
    expect(l.file).toMatch(/descr_sm_resources/);
    expect(l.evidence).toMatch(/started with 30.000 denari/);
    // and it must NOT also claim a recruitment cap
    expect(leads.some((x) => x.faction === "rich" && /RECRUITMENT-capped/.test(x.issue))).toBe(false);
  });
});

describe("EDB mic ladder + settlement-tier lock", () => {
  // verbatim shape from RIS export_descr_buildings.txt
  const EDB = `
building core_building
{
	levels village
}
building military_industrial_complex
{
	levels mic_1 mic_2 mic_3 mic_4
	{
			mic_1 requires factions { all, }
			{
				construction  4
				cost  3000
				settlement_min town
				upgrades
				{
				}
			}
			mic_2 requires factions { all, }
			{
				construction  6
				cost  6000
				settlement_min large_town
				upgrades
				{
				}
			}
			mic_3 requires factions { all, }
			{
				construction  7
				cost  10000
				settlement_min city
				upgrades
				{
				}
			}
	}
}
building market
{
	levels trader
}
`;

  it("reads cost / turns / settlement_min per mic level", async () => {
    const { parseMicLadder } = await import("./aiModFileAudit.js");
    const l = parseMicLadder(EDB);
    expect(l.mic_1).toMatchObject({ cost: 3000, turns: 4, settlementMin: "town", settlementMinTier: 1 });
    expect(l.mic_2).toMatchObject({ cost: 6000, turns: 6, settlementMin: "large_town", settlementMinTier: 2 });
    expect(l.mic_3).toMatchObject({ cost: 10000, turns: 7, settlementMin: "city", settlementMinTier: 3 });
  });

  it("flags a faction whose settlements are too small to ever reach the next mic level", () => {
    const files = {
      aiPersonality: "diplomatic_priority super_aggressive\naggresiveness 100\npersonality ai_small\nbuilding_priority sb\nmilitary_priority sm\ndiplomatic_priority super_aggressive\n",
      strat: "faction	small, ai_small\ndenari	9000\nsettlement\n{\n	level town\n	region A\n}\n",
      smFactions: "", edu: "", edb: EDB,
    };
    // 20 settlements avoids the "≤3 settlements" aggression rule; best tier 1 (town)
    const saveFacts = { turn: 102, menByFaction: { small: 1500 }, settlementsByFaction: { small: 20 }, tierByFaction: { small: 1 } };
    const findings = [{ kind: "campaign_stall", faction: "small", region: "X", detail: "still 0/20000 strength", impossible: true, blockedBy: "recruitment", micMax: 1, micMissing: 0, micTowns: 4 }];
    const { leads } = auditModFiles({ findings, saveFacts, files });
    const tl = leads.find((l) => /SETTLEMENT-TIER LOCKED/.test(l.issue));
    expect(tl).toBeTruthy();
    expect(tl.file).toBe("export_descr_buildings.txt");
    // best tier is 1 → the unreachable next level is mic_2, which needs large_town
    expect(tl.key).toMatch(/mic_2 → settlement_min large_town \(cost 6000, 6 turns\)/);
    expect(tl.issue).toMatch(/best town is tier 1 \(town\)/);
    expect(tl.suggestion).toMatch(/lower mic_2's settlement_min/);
  });

  it("does NOT flag a faction whose settlements already qualify", () => {
    const files = {
      aiPersonality: "personality ai_big\nbuilding_priority bb\nmilitary_priority bm\ndiplomatic_priority passive\n",
      strat: "faction	big, ai_big\ndenari	9000\n", smFactions: "", edu: "", edb: EDB,
    };
    // best tier 3 (city) → next level mic_4 isn't in this ladder, so no lock claim
    const saveFacts = { turn: 102, menByFaction: { big: 20000 }, settlementsByFaction: { big: 40 }, tierByFaction: { big: 3 } };
    const findings = [{ kind: "campaign_stall", faction: "big", region: "Y", detail: "still 0/500 strength", impossible: true, blockedBy: "income", micMax: 3 }];
    const { leads } = auditModFiles({ findings, saveFacts, files });
    expect(leads.some((l) => /SETTLEMENT-TIER LOCKED/.test(l.issue))).toBe(false);
  });
});

describe("resource endowment (descr_sm_resources × descr_strat placements)", () => {
  it("sums trade value per faction from its regions' resources", async () => {
    const { factionResourceWealth } = await import("./aiModFileAudit.js");
    const w = factionResourceWealth({
      ownerByCity: { Rome: "romans_julii", Capua: "romans_julii", Sparta: "sparta" },
      regionOfSettlement: { Rome: "Roma", Capua: "Campania", Sparta: "Lakonia" },
      resourceValues: { gold: { tradeValue: 3, mineable: true }, grain: { tradeValue: 1 }, dyes: { tradeValue: 2 } },
      resourcesByRegion: { Roma: new Set(["gold", "grain"]), Campania: ["dyes"], Lakonia: ["grain"] },
    });
    expect(w.romans_julii).toMatchObject({ regions: 2, resources: 3, tradeValue: 6, mineable: 1, topResource: "gold" });
    expect(w.romans_julii.tradeValuePerRegion).toBe(3);
    expect(w.sparta).toMatchObject({ regions: 1, tradeValue: 1 });
  });

  it("states the NEGATIVE when land is ordinary, so resources aren't chased", () => {
    const files = {
      aiPersonality: "personality ai_x\nbuilding_priority b\nmilitary_priority m\ndiplomatic_priority passive\n",
      strat: "faction	x, ai_x\ndenari	9000\n", smFactions: "", edu: "", edb: "",
    };
    const saveFacts = { turn: 102, menByFaction: { x: 900 }, settlementsByFaction: { x: 20 }, tierByFaction: { x: 3 } };
    // x sits exactly at the median of the two factions supplied → not poor land
    const resourceWealth = { x: { regions: 4, resources: 8, tradeValue: 20, tradeValuePerRegion: 5, topResource: "gold" },
                             y: { regions: 4, resources: 8, tradeValue: 20, tradeValuePerRegion: 5, topResource: "gold" } };
    const findings = [{ kind: "campaign_stall", faction: "x", region: "Z", detail: "still 0/9000 strength", impossible: true, blockedBy: "income", micMax: 3 }];
    const { leads } = auditModFiles({ findings, saveFacts, files, resourceWealth });
    const l = leads.find((q) => /INCOME-limited/.test(q.issue));
    expect(l).toBeTruthy();
    expect(l.issue).toMatch(/land is NOT the problem/);
    expect(l.suggestion).toMatch(/tax base or upkeep/);
  });

  it("flags genuinely poor land when it IS below the map median", () => {
    const files = { aiPersonality: "", strat: "", smFactions: "", edu: "", edb: "" };
    const saveFacts = { turn: 102, menByFaction: { poorland: 900 }, settlementsByFaction: { poorland: 20 }, tierByFaction: { poorland: 3 } };
    const resourceWealth = {
      poorland: { regions: 4, resources: 2, tradeValue: 4, tradeValuePerRegion: 1, topResource: "grain" },
      rich1: { regions: 4, tradeValuePerRegion: 8 }, rich2: { regions: 4, tradeValuePerRegion: 9 },
    };
    const findings = [{ kind: "campaign_stall", faction: "poorland", region: "Z", detail: "still 0/9000 strength", impossible: true, blockedBy: "income", micMax: 3 }];
    const { leads } = auditModFiles({ findings, saveFacts, files, resourceWealth });
    const l = leads.find((q) => /INCOME-limited/.test(q.issue));
    expect(l.issue).toMatch(/land IS genuinely poor/);
    expect(l.severity).toBe(3);
    expect(l.file).toMatch(/descr_sm_resources/);
  });
});

describe("farm endowment — why a faction's towns never grow", () => {
  it("sums farm levels per faction from its regions", async () => {
    const { factionFarmWealth } = await import("./aiModFileAudit.js");
    const w = factionFarmWealth({
      ownerByCity: { A: "poorfarm", B: "poorfarm", C: "richfarm" },
      regionOfSettlement: { A: "Ra", B: "Rb", C: "Rc" },
      farmByRegion: { Ra: 3, Rb: 4, Rc: 11 },
    });
    expect(w.poorfarm).toMatchObject({ regions: 2, farmSum: 7, farmMax: 4, lowFarm: 2 });
    expect(w.poorfarm.farmAvg).toBe(3.5);
    expect(w.richfarm).toMatchObject({ regions: 1, farmMax: 11, lowFarm: 0 });
  });

  const EDB = `
building military_industrial_complex
{
	levels mic_1 mic_2
	{
			mic_1 requires factions { all, }
			{
				construction  4
				cost  3000
				settlement_min town
			}
			mic_2 requires factions { all, }
			{
				construction  6
				cost  6000
				settlement_min large_town
			}
	}
}
building market
{
	levels trader
}
`;
  const files = { aiPersonality: "", strat: "", smFactions: "", edu: "", edb: EDB };
  const findings = [{ kind: "campaign_stall", faction: "poorfarm", region: "X", detail: "still 0/20000 strength", impossible: true, blockedBy: "recruitment", micMax: 1 }];
  const saveFacts = { turn: 102, menByFaction: { poorfarm: 900 }, settlementsByFaction: { poorfarm: 20 }, tierByFaction: { poorfarm: 1 } };

  it("blames poor farmland when the faction's land really is below the map median", () => {
    const farmWealth = {
      poorfarm: { regions: 3, farmAvg: 3, farmMax: 4, lowFarm: 3 },
      other1: { regions: 3, farmAvg: 7 }, other2: { regions: 3, farmAvg: 8 },
    };
    const { leads } = auditModFiles({ findings, saveFacts, files, farmWealth });
    const tl = leads.find((l) => /SETTLEMENT-TIER LOCKED/.test(l.issue));
    expect(tl).toBeTruthy();
    expect(tl.suggestion).toMatch(/average Farm 3 against a map median of 7/);
    expect(tl.suggestion).toMatch(/descr_regions\.txt/);
  });

  it("says growth is NOT the blocker when the farmland is ordinary", () => {
    const farmWealth = {
      poorfarm: { regions: 3, farmAvg: 7, farmMax: 8, lowFarm: 0 },
      other1: { regions: 3, farmAvg: 7 }, other2: { regions: 3, farmAvg: 7 },
    };
    const { leads } = auditModFiles({ findings, saveFacts, files, farmWealth });
    const tl = leads.find((l) => /SETTLEMENT-TIER LOCKED/.test(l.issue));
    expect(tl.suggestion).toMatch(/farm land is ordinary, so growth is not the blocker/);
    expect(tl.suggestion).not.toMatch(/descr_regions/);
  });
});
