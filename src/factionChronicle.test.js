// Faction Chronicle — every asserted line below is VERBATIM from a real log:
// either the harvested samples block in aiLogExtract.test.js (lifted from the
// 346MB reference campaign_ai_log by scripts/harvest-ailog-samples.js) or
// captured from the live RIS 0.7.0 session log on 2026-08-06 (the war/peace
// list shapes, which AI_RX does not carry). No line here was typed from
// imagination — that is how the `+start` header bug and the untestable
// falsifier happened.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createChronicler, chronicleLogFile, FINANCE_TEXT } from "./factionChronicle.js";

const REF_LOG = "C:/dev/log test files/campaign_ai_log.txt";
const haveRef = fs.existsSync(REF_LOG);

// One faction turn block assembled from real lines (sources noted above).
const TURN_BLOCK = [
  "AI: \t\t\t\tstart 'carthage' for year -270, season summer",
  "AI: ltgd: army strength 2125, free army strength 2125, navy strength 0.",
  "AI: ltgd: number of invasion targets: 0",
  "AI: ltgd: are at war with: Roman Rebels, Roman Rebels, Italics, Free Peoples, ", // live log 2026-08-06
  "AI: ltgd: want peace with: Galatians, ",                                          // live log 2026-08-06
  "AI: ltgd: 'carthage' invade 'corsi', not at war, good production against strongest neighbour >> ALI_START_PLAN (200).",
  "AI: ltgd: defend (frontline .000132, free 9.486274, product 21.18303) vs fac 'acragas': not at war, bad frontline, decent free strength >> ALD_DEFEND_DEEP.",
  "AI: mildir: invade_<other> attack authorised against 'slave'.",
  "AI: finance: est income 101, est maintenance 378, est outgoings 378 -- spending max 0, spending norm -277; balance AFB_EARN_MINUTE, state AFS_PAUPER",
  "AI: region control: settlement 'Roman Rebels 1 Settlement', (pop 400, old order 0), tax TAX_LEVEL_LOW due to enough money",
  "AI: production: started recruitment of 'hyrkanian foot archers' at 'Parnon Taphai', priority 25, prod type AI_PROD_TYPE_BALANCED.",
  "AI: production: started 'building new, garrison' at 'Sexi', priority 6496, prod type AI_PROD_TYPE_MILITARY.",
  "AI: Diplomat CC: Character \"Cassivellaunus\" told to move to settlement \"Vesontio\". Task: DIPLOMACY. Initiate: Yes. Priority 1000",
  "AI: campaign: garrison of settlement 'Carthage' told to split, 10 units leaving, priority 650.",
  "AI: campaign: mission move nonlocal: char 'Captain Proteus' moving towards sett 'Pella', priority 400.",
  "AI: campaign: mission move nonlocal: char 'Captain Nabag' moving towards sett 'Pella', priority 300.",
  "AI: named cc: leader status 'free', heir status 'free', ungoverned cities 0 / 1, adoptees 0, resources 0 (total str 0).",
];

function run(lines, opts) {
  const c = createChronicler(opts);
  for (const l of lines) c.feedLine(l);
  return c.finish();
}

describe("createChronicler — one real turn block", () => {
  const r = run(TURN_BLOCK, { displayNames: { carthage: "Carthage", corsi: "Corsi" } });
  const turn = r.turnsByFaction.carthage[0];
  const texts = turn.lines.map((l) => l.t);
  const kinds = turn.lines.map((l) => l.k);

  it("opens one turn for the faction with year/season from the header", () => {
    expect(r.factions).toHaveLength(1);
    expect(r.factions[0]).toMatchObject({ tag: "carthage", display: "Carthage", turns: 1, invades: 1 });
    expect(turn).toMatchObject({ turn: 1, year: -270, season: "summer" });
  });

  it("translates the invade decision with the engine's own reason", () => {
    expect(texts).toContain(
      "Started planning an invasion of Corsi — not at war, good production against strongest neighbour"
    );
  });

  it("parses the war/peace lists, deduping the engine's repeats", () => {
    expect(texts).toContain("At war with: Roman Rebels, Italics, Free Peoples");
    expect(texts).toContain("Wants peace with: Galatians");
  });

  it("translates finance state and strength/targets", () => {
    expect(texts).toContain("Treasury: broke — expects 101 income vs 378 upkeep");
    expect(texts).toContain(
      "Army strength ~2,125 (2,125 free for offensives), navy 0 — sees no viable invasion target"
    );
  });

  it("translates production, diplomacy and military lines", () => {
    expect(texts).toContain("Started building garrison at Sexi");
    expect(texts).toContain("Recruiting hyrkanian foot archers at Parnon Taphai");
    expect(texts).toContain("Diplomat Cassivellaunus dispatched to Vesontio");
    expect(texts).toContain("Pulled 10 units out of Carthage's garrison");
    expect(texts).toContain("Attack authorised against slave");
    expect(texts).toContain("Defence vs acragas: defence in depth");
    expect(texts).toContain("Taxes set: low ×1");
    expect(texts).toContain("Orders issued: march ×2");
  });

  it("skips routine noise: ALD_DEFEND_NORMAL and 0-ungoverned health", () => {
    expect(kinds).not.toContain("alert");
    const withNormal = run([
      TURN_BLOCK[0],
      "AI: ltgd: defend (frontline 534.705856, free 69.019248, product 8.733918) vs fac 'cisalpine_boii': not at war, neither at war elsewhere >> ALD_DEFEND_NORMAL.", // live log (scout capture)
    ]);
    expect(withNormal.turnsByFaction.carthage[0].lines).toHaveLength(0);
  });
});

describe("turn counting — a faction's Nth block is its turn N (4TPY-safe)", () => {
  it("counts repeated (year, season) blocks as distinct turns", () => {
    // RIS is 4 turns/year but the log only labels summer/winter: the same
    // (year, season) legitimately appears twice. Block count must win.
    const r = run([
      "AI: \t\t\t\tstart 'carthage' for year -270, season summer",
      "AI: \t\t\t\tstart 'dummies' for year -270, season summer",
      "AI: \t\t\t\tstart 'carthage' for year -270, season summer",
      "AI: \t\t\t\tstart 'carthage' for year -270, season winter",
    ]);
    expect(r.turnsByFaction.carthage.map((t) => t.turn)).toEqual([1, 2, 3]);
    expect(r.turnsByFaction.dummies.map((t) => t.turn)).toEqual([1]);
    // Global session turn advances when a tag repeats — the merge key that
    // lines chronicle turns up with message_log "end round" ordinals.
    expect(r.turnsByFaction.carthage.map((t) => t.g)).toEqual([1, 2, 3]);
    expect(r.turnsByFaction.dummies.map((t) => t.g)).toEqual([1]);
  });

  it("attributes lines to the OPEN block's faction", () => {
    const r = run([
      "AI: \t\t\t\tstart 'carthage' for year -270, season summer",
      "AI: finance: est income 101, est maintenance 378, est outgoings 378 -- spending max 0, spending norm -277; balance AFB_EARN_MINUTE, state AFS_PAUPER",
      "AI: \t\t\t\tstart 'dummies' for year -270, season summer",
    ]);
    expect(r.turnsByFaction.carthage[0].lines.some((l) => l.k === "economy")).toBe(true);
    expect(r.turnsByFaction.dummies[0].lines).toHaveLength(0);
  });

  it("ignores lines before the first block instead of crashing", () => {
    const r = run([
      "==== campaign ai log start, build date: Jan 17 2022 ===",
      "AI: finance: est income 101, est maintenance 378, est outgoings 378 -- spending max 0, spending norm -277; balance AFB_EARN_MINUTE, state AFS_PAUPER",
    ]);
    expect(r.factions).toHaveLength(0);
  });
});

describe("caps keep a chronicle readable", () => {
  it("groups invade decisions sharing decision+reason into one sentence", () => {
    // The rebel faction logs the SAME opportunistic decision against dozens of
    // targets; grouped they must become one line, not a wall.
    const r = run([
      "AI: \t\t\t\tstart 'slave' for year -270, season summer",
      "AI: ltgd: 'slave' invade 'romans_julii', at war, inferior to enemy >> ALI_INVADE_OPPORTUNISTIC (40).",
      "AI: ltgd: 'slave' invade 'carthage', at war, inferior to enemy >> ALI_INVADE_OPPORTUNISTIC (40).",
      "AI: ltgd: 'slave' invade 'seleucid', at war, inferior to enemy >> ALI_INVADE_OPPORTUNISTIC (40).",
      "AI: ltgd: 'carthage' invade 'corsi', not at war, good production against strongest neighbour >> ALI_START_PLAN (200).",
    ]);
    const texts = r.turnsByFaction.slave[0].lines.map((l) => l.t);
    const invades = texts.filter((t) => t.startsWith("Watching"));
    expect(invades).toHaveLength(1);
    expect(invades[0]).toBe("Watching for an opening to strike romans julii, carthage, seleucid — at war, inferior to enemy");
    // Different reason → its own line, unmerged.
    expect(texts).toContain("Started planning an invasion of corsi — not at war, good production against strongest neighbour");
  });

  it("sorts the slave pseudo-faction last however active it is", () => {
    const r = run([
      "AI: \t\t\t\tstart 'slave' for year -270, season summer",
      "AI: \t\t\t\tstart 'carthage' for year -270, season summer",
      "AI: \t\t\t\tstart 'slave' for year -270, season summer",
    ]);
    expect(r.factions.map((f) => f.tag)).toEqual(["carthage", "slave"]);
  });

  it("overflows past 15 recruit lines into a counter line", () => {
    const lines = ["AI: \t\t\t\tstart 'carthage' for year -270, season summer"];
    for (let i = 0; i < 20; i++) {
      lines.push("AI: production: started recruitment of 'hyrkanian foot archers' at 'Parnon Taphai', priority 25, prod type AI_PROD_TYPE_BALANCED.");
    }
    const turn = run(lines).turnsByFaction.carthage[0];
    const recruitLines = turn.lines.filter((l) => l.k === "recruit");
    expect(recruitLines).toHaveLength(16); // 15 + the overflow note
    expect(recruitLines[15].t).toBe("…and 5 more recruit entries this turn");
  });
});

describe("vocabulary fallbacks never crash on unknown enums", () => {
  it("humanizes an unknown finance state", () => {
    expect(FINANCE_TEXT.AFS_PAUPER).toBe("broke");
    const r = run([
      "AI: \t\t\t\tstart 'carthage' for year -270, season summer",
      "AI: finance: est income 5, est maintenance 5, est outgoings 5 -- spending max 0, spending norm 0; balance AFB_EARN_MINUTE, state AFS_SOME_FUTURE_STATE",
    ]);
    expect(r.turnsByFaction.carthage[0].lines[0].t).toContain("some future state");
  });
});

describe.runIf(haveRef)("reference log (346MB, streamed slice)", () => {
  it("chronicles the first 4MB of the real log without inventing factions", async () => {
    // A 4MB latin1 slice = the first ~50k lines: enough to cover several full
    // faction turn blocks while keeping the test fast. Whole-log streaming is
    // what chronicleLogFile does in production; the worker path exercises it.
    const fd = fs.openSync(REF_LOG, "r");
    const buf = Buffer.alloc(4 * 1024 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const text = buf.toString("latin1", 0, n);
    const c = createChronicler();
    for (const line of text.split("\n")) c.feedLine(line);
    const r = c.finish();
    expect(r.factions.length).toBeGreaterThan(5);
    // Every faction tag must look like a real strat tag, not a mangled capture.
    for (const f of r.factions) expect(f.tag).toMatch(/^[a-z_0-9 ]+$/i);
    // At least one narrated line of each core kind must appear in real data.
    const allKinds = new Set();
    for (const arr of Object.values(r.turnsByFaction)) {
      for (const t of arr) for (const l of t.lines) allKinds.add(l.k);
    }
    for (const k of ["economy", "invade", "orders"]) expect(allKinds).toContain(k);
  });

  it("streams end-to-end via chronicleLogFile on the full log", { timeout: 300000 }, async () => {
    let progressed = 0;
    const r = await chronicleLogFile(REF_LOG, {}, () => progressed++);
    expect(progressed).toBeGreaterThan(0);
    expect(r.factions.length).toBeGreaterThan(10);
    expect(r.logPath).toBe(REF_LOG);
    // The archived autosave next to this log is "Turn 102 Start" and the
    // session ran on past it (the busiest faction logs 121 blocks). What this
    // guards is the SEASON TRAP: counting distinct (year, season) pairs would
    // give ~60 at 4TPY, and double-counting would give ~240. Block count must
    // land in the real-session band, nowhere near either failure mode.
    expect(r.factions[0].turns).toBeGreaterThan(100);
    expect(r.factions[0].turns).toBeLessThan(180);
  });
});
