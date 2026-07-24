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
