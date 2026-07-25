// AI Movement Analyzer — tested against the REAL 97-turn campaign log archived
// in calibration/logs-archive (no fabricated fixtures; the numbers asserted
// here were read off the actual log). Guards both the analyzer heuristics and
// the messageLogParser flee regex (whose old single-field-order version
// silently matched zero real flee lines).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeMovementLog } from "./aiMovementAnalyzer.js";
import { parseLine } from "./messageLogParser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(__dirname, "..", "calibration", "logs-archive", "message_log-97turns.txt");

describe("messageLogParser flee_tile (real-log field orders)", () => {
  it("parses the faction:uuid order (with space before army)", () => {
    const ev = parseLine("Captain Xerxes(parthia:a8ba7150) army(a5bb3ba0) found flee tile(129,26)");
    expect(ev).toMatchObject({ type: "flee_tile", faction: "parthia", charUuid: "a8ba7150", armyUuid: "a5bb3ba0", x: 129, y: 26 });
  });
  it("parses the uuid:faction order (no space before army)", () => {
    const ev = parseLine("Alexander(a63a2f70:macedon)army(a5bb1c20) found flee tile(11,37)");
    expect(ev).toMatchObject({ type: "flee_tile", faction: "macedon", charUuid: "a63a2f70", armyUuid: "a5bb1c20", x: 11, y: 37 });
  });
  it("tolerates trailing concatenated text (real logs append scroll spam)", () => {
    const ev = parseLine("Admiral Assandros(macedon:a638ccd0) army(a5bb1c20) found flee tile(11,37)prebattle_scroll scroll opened");
    expect(ev).toMatchObject({ type: "flee_tile", faction: "macedon", x: 11, y: 37 });
  });
});

describe("analyzeMovementLog on the archived 97-turn campaign", () => {
  const text = fs.readFileSync(LOG, "utf8");
  const r = analyzeMovementLog(text);

  it("attributes the full campaign", () => {
    expect(r.totalTurns).toBeGreaterThanOrEqual(97);
    expect(r.moveLines).toBeGreaterThan(2000);   // 2,496 in the archive
    expect(r.armies).toBeGreaterThan(200);       // 287
    expect(r.fleeLines).toBeGreaterThan(200);    // 297 — 0 before the regex fix
    expect(r.cannotFlee).toBe(14);               // exact count grep-verified
  });

  it("finds the known pathologies (this log has famously circling armies)", () => {
    expect(r.findingCounts.oscillation).toBeGreaterThan(10);
    expect(r.findingCounts.stuck).toBeGreaterThan(5);
    expect(r.findingCounts.flee_loop).toBeGreaterThanOrEqual(3);
    // the champion: Datuvahya of Babylonia ping-pongs (128,34)↔(128,35) for ~70 turns
    const champ = r.findings.find((f) => f.kind === "oscillation" && f.name.includes("Datuvahya"));
    expect(champ).toBeTruthy();
    expect(champ.turns).toBeGreaterThan(50);
  });

  it("computes per-faction wander stats", () => {
    expect(r.factionStats.parthia.moves).toBeGreaterThan(1000);
    expect(r.factionStats.parthia.wander).toBeGreaterThan(0.3); // they circle a lot in this log
    for (const s of Object.values(r.factionStats)) {
      expect(s.wander).toBeGreaterThanOrEqual(0);
      expect(s.wander).toBeLessThanOrEqual(1);
    }
  });

  it("is fast enough for interactive use", () => {
    const t0 = Date.now();
    analyzeMovementLog(text);
    expect(Date.now() - t0).toBeLessThan(2000); // ~50ms in practice
  });
});

describe("createAiDecisionAnalyzer (real campaign_ai_log lines)", () => {
  it("parses turn blocks, missions, churn, stalls and aborts", async () => {
    const { createAiDecisionAnalyzer } = await import("./aiMovementAnalyzer.js");
    const an = createAiDecisionAnalyzer({ MIN_MISSION_TURNS: 2, CHURN_MIN: 2, MIN_STALL_TURNS: 2, MIN_ABORT_TURNS: 2 });
    // REAL lines quoted from the 346MB RIS telemetry log (2026-07-24)
    const lines = [
      "AI: \t\t\t\tstart 'dummies' for year -270, season summer",
      "AI: campaign: campaign for 'Pella' (reg 983, des 129) using strategy ACS_GATHERING. required str 400 (ACZ_SOLID), allocated str 120; num res 3.",
      "AI: campaign: mission move nonlocal: char 'Captain Proteus' moving towards sett 'Pella', priority 400.",
      "AI: campaign: res for char 'Alexandros' assigned to reg 983 at priority 528.",
      "AI: resource for char 'Alexandros' released by controller",
      "AI: campaign for region '983' aborted because of insufficient available strength.",
      "AI: \t\t\t\tstart 'dummies' for year -270, season winter",
      "AI: campaign: campaign for 'Pella' (reg 983, des 129) using strategy ACS_GATHERING. required str 400 (ACZ_SOLID), allocated str 120; num res 3.",
      "AI: campaign: mission move nonlocal: char 'Captain Proteus' moving towards sett 'Pella', priority 400.",
      "AI: campaign: res for char 'Alexandros' assigned to reg 983 at priority 528.",
      "AI: resource for char 'Alexandros' released by controller",
      "AI: campaign for region '983' aborted because of insufficient available strength.",
    ];
    for (const l of lines) an.feedLine(l);
    const r = an.finish();
    expect(r.logKind).toBe("campaign_ai");
    expect(r.totalTurns).toBe(2);
    expect(r.firstYear).toBe(-270);
    expect(r.findingCounts.stuck_mission).toBe(1);
    expect(r.findingCounts.assign_churn).toBe(1);
    expect(r.findingCounts.campaign_stall).toBe(1);
    expect(r.findingCounts.aborted_hotspot).toBe(1);
    const stall = r.findings.find((f) => f.kind === "campaign_stall");
    expect(stall.region).toBe("Pella"); // regId 983 self-described by the campaign line
  });
});

describe("correlateWithSave / buildSaveFacts (log verdicts from save state)", () => {
  it("turns findings into verdicts using real save shapes", async () => {
    const { correlateWithSave, buildSaveFacts } = await import("./aiMovementAnalyzer.js");
    // shapes taken from a real cracked save (crackSave output, turn 102)
    const save = {
      turn: 102,
      ownerByCity: { Erythrai: "ptolemaic", Neapolis: "romans_julii", Klazomenai: "ptolemaic" },
      units: [
        { faction: "romans_julii", region: "Campania", soldiers: 120, naval: false },
        { faction: "romans_julii", region: "Campania", soldiers: 100, naval: false },
        { faction: "chios", region: "Chios", soldiers: 40, naval: false },
        { faction: "ptolemaic", region: "Ionia", soldiers: 200, naval: true },
      ],
    };
    const facts = buildSaveFacts(save, { Erythrai: "Ionia", Neapolis: "Campania", Klazomenai: "Ionia" });
    expect(facts.turn).toBe(102);
    expect(facts.navalWorld).toBe(1);
    expect(facts.menByFaction.romans_julii).toBe(220);
    expect(facts.settlementsByFaction.ptolemaic).toBe(2);

    const out = correlateWithSave([
      { kind: "stuck_mission", faction: "chios", name: "Ariston", region: "Erythrai", detail: "x" },
      { kind: "stuck_mission", faction: "romans_julii", name: "Statiis", region: "Neapolis", detail: "x" },
      { kind: "campaign_stall", faction: "chios", name: "Erythrai", region: "Erythrai", detail: "GATHERING for 9 turns, still 0/11590 strength — never launches" },
      { kind: "campaign_stall", faction: "ptolemaic", name: "Klazomenai", region: "Klazomenai", detail: "GATHERING for 9 turns, still 0/100 strength — never launches" },
    ], facts);

    // never arrived: target held by someone else AND no units in that region
    expect(out[0].verdict).toMatch(/NEVER arrived/);
    expect(out[0].targetOwner).toBe("ptolemaic");
    // arrived: the faction holds the target now
    expect(out[1].targetTaken).toBe(true);
    expect(out[1].verdict).toMatch(/arrived eventually/);
    // impossible: needs 11,590 but the whole faction fields 40 men
    expect(out[2].impossible).toBe(true);
    expect(out[2].reqVsHave).toMatch(/needs 11.590/);
    // affordable: needs 100, faction fields 200
    expect(out[3].impossible).toBe(false);
  });

  it("says 'unknown' instead of guessing when the save can't answer", async () => {
    const { correlateWithSave, buildSaveFacts } = await import("./aiMovementAnalyzer.js");
    const facts = buildSaveFacts({ turn: 5, ownerByCity: {}, units: [] }, {});
    const out = correlateWithSave([{ kind: "stuck_mission", faction: "x", name: "y", region: "Nowhere", detail: "d" }], facts);
    expect(out[0].verdict).toMatch(/unknown/);
    expect(out[0].targetTaken).toBeUndefined();
  });
});

describe("finance + build-appetite tracking (real campaign_ai_log lines)", () => {
  it("profiles a faction's economy and flags rich-but-stalled", async () => {
    const { createAiDecisionAnalyzer } = await import("./aiMovementAnalyzer.js");
    const an = createAiDecisionAnalyzer({ MIN_STALL_TURNS: 2 });
    // real line shapes from the 346MB telemetry log
    const rich = "AI: finance: est income 484, est maintenance 389, est outgoings 389 -- spending max 5700, spending norm 95; balance AFB_EARN_MINUTE, state AFS_CROESUS";
    const stall = "AI: campaign: campaign for 'Pella' (reg 983, des 129) using strategy ACS_GATHERING. required str 400 (ACZ_SOLID), allocated str 0; num res 0.";
    for (let t = 1; t <= 6; t++) {
      an.feedLine(`AI: \t\t\t\tstart 'rich_fac' for year -${280 - t}, season summer`);
      an.feedLine(rich);
      an.feedLine("AI: -- building 'Barracks and Armoury' at priority 2740.");
      an.feedLine("AI: -- building 'Racing Course (Leisure)' at priority 38.");
      an.feedLine(stall);
    }
    const r = an.finish();
    expect(r.economy.rich_fac.reports).toBe(6);
    expect(r.economy.rich_fac.richPct).toBe(1);
    expect(r.economy.rich_fac.avgIncome).toBe(484);
    expect(r.economy.rich_fac.avgSpendMax).toBe(5700);
    // build appetite: 2 candidates evaluated, 1 military, top military priority captured
    expect(r.buildAppetite.rich_fac.picks).toBe(12);
    expect(r.buildAppetite.rich_fac.military).toBe(6);
    expect(r.buildAppetite.rich_fac.topMilitaryPriority).toBe(2740);
    expect(r.buildAppetite.rich_fac.topMilitaryName).toBe("Barracks and Armoury");
    // and the finding: money is not the block
    const rb = r.findings.find((f) => f.kind === "rich_but_stalled");
    expect(rb).toBeTruthy();
    expect(rb.faction).toBe("rich_fac");
    expect(rb.detail).toMatch(/100% of its turns were rich/);
  });

  it("does not flag a POOR stalled faction as rich-but-stalled", async () => {
    const { createAiDecisionAnalyzer } = await import("./aiMovementAnalyzer.js");
    const an = createAiDecisionAnalyzer({ MIN_STALL_TURNS: 2 });
    const poor = "AI: finance: est income 101, est maintenance 378, est outgoings 378 -- spending max 0, spending norm -277; balance AFB_EARN_MINUTE, state AFS_PAUPER";
    for (let t = 1; t <= 6; t++) {
      an.feedLine(`AI: \t\t\t\tstart 'poor_fac' for year -${280 - t}, season summer`);
      an.feedLine(poor);
      an.feedLine("AI: campaign: campaign for 'X' (reg 1, des 1) using strategy ACS_GATHERING. required str 400 (ACZ_SOLID), allocated str 0; num res 0.");
    }
    const r = an.finish();
    expect(r.economy.poor_fac.poorPct).toBe(1);
    expect(r.findings.some((f) => f.kind === "rich_but_stalled")).toBe(false);
  });
});

describe("empty / unsuitable logs are reported honestly (not as 'all clear')", () => {
  it("marks a warnings-only message_log unusable and explains why", async () => {
    const { analyzeMovementLog } = await import("./aiMovementAnalyzer.js");
    // shape of a real session log that never played AI turns (engine warnings only)
    const junk = [
      "==== message log start, build date: Jan 17 2022 ===",
      "Mods Disabled: No",
      "Trying to reinitialise the own_character_info_scroll when it hasn't been initialised already",
      "resetting all armies in region(4)",
      "bdg.construction_type_get() == BUILDING_CONSTRUCTION_ITEM_BUILDING_NEW Failed",
    ].join("\n");
    const r = analyzeMovementLog(junk);
    expect(r.logKind).toBe("message_log");
    expect(r.usable).toBe(false);
    expect(r.findings).toEqual([]);
    expect(r.emptyReason).toMatch(/no movement events/);
    expect(r.emptyReason).toMatch(/campaign_ai_log\.txt/); // tells the user where to look
  });

  it("marks a real movement log usable with no emptyReason", () => {
    const r = analyzeMovementLog(fs.readFileSync(LOG, "utf8")); // archived 97-turn campaign
    expect(r.usable).toBe(true);
    expect(r.emptyReason).toBeNull();
  });

  it("marks an AI-decision log with no turn blocks unusable", async () => {
    const { createAiDecisionAnalyzer } = await import("./aiMovementAnalyzer.js");
    const an = createAiDecisionAnalyzer();
    an.feedLine("==== campaign ai log start, build date: Jan 17 2022 ===");
    an.feedLine("some unrelated line");
    const r = an.finish();
    expect(r.usable).toBe(false);
    expect(r.emptyReason).toMatch(/no AI decision data/);
  });
});

describe("worker-safety of the analysis pipeline", () => {
  it("aiMovementRun.js must not require electron (it runs in a worker thread)", async () => {
    const fsp = await import("node:fs");
    const src = fsp.readFileSync(path.join(__dirname, "aiMovementRun.js"), "utf8");
    // A worker has no Electron bindings — requiring it threw
    // "Cannot find module 'electron'" for the packaged app (2026-07-25).
    expect(src).not.toMatch(/require\(\s*["']electron["']\s*\)/);
  });

  it("exposes runAiMovementAnalysis and refuses a missing log path cleanly", async () => {
    const { runAiMovementAnalysis } = await import("./aiMovementRun.js");
    expect(typeof runAiMovementAnalysis).toBe("function");
    const r = await runAiMovementAnalysis({ logPath: null, modDataDir: null, savePath: null });
    expect(r.error).toMatch(/no log path/);
  });
});

describe("garrison-stripping, war-spam and espionage detectors (real line shapes)", () => {
  it("flags a town whose garrison is repeatedly split apart", async () => {
    const { createAiDecisionAnalyzer } = await import("./aiMovementAnalyzer.js");
    const an = createAiDecisionAnalyzer({ MIN_STRIP_TURNS: 3 });
    for (let t = 1; t <= 4; t++) {
      an.feedLine(`AI: \t\t\t\tstart 'insubres' for year -${280 - t}, season summer`);
      an.feedLine("AI: campaign: garrison of settlement 'Mediolanum' told to split, 9 units leaving, priority 650.");
    }
    const r = an.finish();
    const f = r.findings.find((x) => x.kind === "garrison_stripped");
    expect(f).toBeTruthy();
    expect(f.name).toBe("Mediolanum");
    expect(f.faction).toBe("insubres");
    expect(f.turns).toBe(4);
    expect(f.detail).toMatch(/36 units pulled out/);      // 4 × 9
    expect(f.detail).toMatch(/worst single order: 9/);
  });

  it("flags a faction authorising attacks on many factions at once", async () => {
    const { createAiDecisionAnalyzer } = await import("./aiMovementAnalyzer.js");
    const an = createAiDecisionAnalyzer({ MIN_WAR_TARGETS: 3 });
    an.feedLine("AI: \t\t\t\tstart 'seleucid' for year -270, season summer");
    for (const t of ["bithynia", "cius", "parni", "byzantium"]) {
      an.feedLine(`AI: mildir: invade_<other> attack authorised against '${t}'.`);
    }
    const r = an.finish();
    const f = r.findings.find((x) => x.kind === "war_spam");
    expect(f).toBeTruthy();
    expect(f.faction).toBe("seleucid");
    expect(f.turns).toBe(4);                               // 4 distinct targets
    expect(f.detail).toMatch(/4 different factions/);
    expect(f.detail).toMatch(/bithynia/);
  });

  it("does not flag a faction with only a couple of war targets", async () => {
    const { createAiDecisionAnalyzer } = await import("./aiMovementAnalyzer.js");
    const an = createAiDecisionAnalyzer({ MIN_WAR_TARGETS: 6 });
    an.feedLine("AI: \t\t\t\tstart 'rome' for year -270, season summer");
    an.feedLine("AI: mildir: invade_<other> attack authorised against 'samnites'.");
    an.feedLine("AI: mildir: invade_<other> attack authorised against 'taras'.");
    expect(an.finish().findings.some((x) => x.kind === "war_spam")).toBe(false);
  });

  it("reports espionage usage, including turns where no agents were assigned", async () => {
    const { createAiDecisionAnalyzer } = await import("./aiMovementAnalyzer.js");
    const an = createAiDecisionAnalyzer();
    an.feedLine("AI: \t\t\t\tstart 'rome' for year -270, season summer");
    an.feedLine("AI: 3 spies assigned this turn");
    an.feedLine("AI: 0 assassins assigned this turn");
    an.feedLine("AI: 0 spies assigned this turn");
    const r = an.finish();
    expect(r.agents).toMatchObject({ reports: 3, spies: 3, assassins: 0 });
    expect(r.agents.zeroTurnPct).toBeCloseTo(2 / 3, 2);
  });
});
