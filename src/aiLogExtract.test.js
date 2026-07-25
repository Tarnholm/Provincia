// @vitest-environment node
//
// The crash reporter ships a FILTERED campaign_ai_log back from testers, because
// the real file is 330MB. That is only acceptable if the Lab reaches the same
// conclusions from the extract as from the original — so this test does not
// reason about it, it measures it: run the analyser over the full reference log
// and over an extract of the same log, and require the findings to be identical.
//
// Skips cleanly where the 330MB reference file isn't present.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractAiLog, keepLine, pythonPatternModule } from "./aiLogExtract.js";
import { createAiDecisionAnalyzer, AI_LOG_LINE_PATTERNS } from "./aiMovementAnalyzer.js";

const REF_LOG = "C:/dev/log test files/campaign_ai_log.txt";
const haveRef = fs.existsSync(REF_LOG);

function analyse(text) {
  const an = createAiDecisionAnalyzer();
  for (const line of text.split("\n")) an.feedLine(line);
  return an.finish();
}

describe("keepLine follows the analyser's own patterns", () => {
  it("keeps one example of every shape the analyser reads", () => {
    // ── HARVESTED, NOT HAND-WRITTEN ──
    // One verbatim line per pattern, lifted from the reference campaign_ai_log by
    // scripts/harvest-ailog-samples.js --write. Do not edit by hand: a typed sample
    // encodes what the engine is IMAGINED to emit, and this project has already been
    // bitten by exactly that (a falsifier that passed while testing nothing). Every
    // pattern below is proven to have a real example; the harvester refuses to write
    // this block if any pattern has none, because that pattern is speculative.
    //
    // Note the faction header's TABS after "AI:" and absence of "+": a retyped
    // version of that pattern got both wrong.
    const samples = [
      "AI: \t\t\t\tstart 'dummies' for year -270, season summer",
      "AI: campaign: mission move nonlocal: char 'Captain Proteus' moving towards sett 'Pella', priority 400.",
      "AI: named cc: army 'Bellovesus' told to move to 'Decetia', priority 100.",
      "AI: campaign: res for char 'Captain Nabag' assigned to reg 1017 at priority 1.",
      "AI: resource for char 'Captain Bodmelqart' released by controller",
      "AI: campaign for region '1040' aborted because of insufficient available strength.",
      "AI: campaign: campaign for 'Armenian Rebels Settlement' (reg 1306, des 129) using strategy ACS_DEFEND_BORDER. required str 0 (ACZ_STAY_AT_HOME), allocated str 0; num res 0.",
      "AI: finance: est income 101, est maintenance 378, est outgoings 378 -- spending max 0, spending norm -277; balance AFB_EARN_MINUTE, state AFS_PAUPER",
      "AI: -- building 'Small Treasury' at priority 171.",
      "AI: campaign: garrison of settlement 'Carthage' told to split, 10 units leaving, priority 650.",
      "AI: mildir: invade_<other> attack authorised against 'slave'.",
      "AI: 0 spies assigned this turn",
      "AI: ltgd: army strength 2125, free army strength 2125, navy strength 0.",
      "AI: ltgd: 'carthage' invade 'corsi', not at war, good production against strongest neighbour >> ALI_START_PLAN (200).",
      "AI: ltgd: defend (frontline .000132, free 9.486274, product 21.18303) vs fac 'acragas': not at war, bad frontline, decent free strength >> ALD_DEFEND_DEEP.",
      "AI: -- troop type 'Caetrati Infantry' at priority 40.",
      "AI: region control: settlement 'Roman Rebels 1 Settlement', (pop 400, old order 0), tax TAX_LEVEL_LOW due to enough money",
      "AI: production: started recruitment of 'hyrkanian foot archers' at 'Parnon Taphai', priority 25, prod type AI_PROD_TYPE_BALANCED.",
      "AI: production: started 'building new, garrison' at 'Sexi', priority 6496, prod type AI_PROD_TYPE_MILITARY.",
      "AI: ltgd: number of invasion targets: 0",
      "AI: number of spies 0, number of assassins 0.",
      "AI: named cc: leader status 'free', heir status 'free', ungoverned cities 0 / 1, adoptees 0, resources 0 (total str 0).",
      "AI: production: settlement 'Iol' is busy constructing building upgrade, military_industrial_complex to level 1, considering repairs.",
      "AI: campaign: mission move: char 'Admiral Baalshafot' moving towards tile (123, 356) in region (0), priority 924 (move towards a position to take on a passenger).",
      "AI: worldwide: char 'Ptolemaios' assigned (in region 1256) at priority 0.",
      "AI: resource for char 'Ptolemaios' released by worldwide controller in region 1252.",
      "AI: Diplomat CC: Character \"Cassivellaunus\" told to move to settlement \"Vesontio\". Task: DIPLOMACY. Initiate: Yes. Priority 1000",
      "AI: production: sufficient numbers of troops but enough cash for more, so continuing to recruit.",
      "err: no building of this type in settlement",
      "AI: campaign: campaign for 'Armenian Rebels Settlement' (reg 1306, des 129) using strategy ACS_DEFEND_BORDER. required str 0 (ACZ_STAY_AT_HOME), allocated str 0; num res 0.sudo set_building_health local hinterland_region",
      "AI: naval controller: ARMY resource for char 'Admiral Yahua' assigned for reg 0.",
    ];
    expect(samples).toHaveLength(AI_LOG_LINE_PATTERNS.length);
    for (const s of samples) expect(keepLine(s), `should keep: ${s.slice(0, 60)}`).toBe(true);
  });

  it("drops lines the analyser never reads", () => {
    for (const s of [
      "AI: ltgd: considering invade of epirus",   // names no character
      "AI: some unrelated diagnostic",
      "",
      "=================== end round 12 ===================",
      "AI: campaign: something not in the manifest",
    ]) expect(keepLine(s), `should drop: ${s}`).toBe(false);
  });

  it("would have caught the retyped-pattern bug", () => {
    // the wrong guess, for the record: "+start" matches nothing in a real log
    expect(/^AI: \t*\+start '/.test("AI: \t\t\t\tstart 'dummies' for year -270, season summer")).toBe(false);
    // …while the exported pattern does match it
    expect(keepLine("AI: \t\t\t\tstart 'dummies' for year -270, season summer")).toBe(true);
  });
});

describe("the Python pattern module stays in step with the JS one", () => {
  const py = pythonPatternModule();
  it("contains every pattern, verbatim", () => {
    for (const src of AI_LOG_LINE_PATTERNS) expect(py).toContain(src);
    expect(py).toMatch(/^# GENERATED by scripts\/gen-ailog-patterns\.js/);
    expect(py).toMatch(/def keep_ai_log_line/);
  });
  it("uses only regex constructs that mean the same thing in Python", () => {
    // if a future pattern used a JS-only construct this would need revisiting,
    // so the assumption is asserted rather than assumed
    for (const src of AI_LOG_LINE_PATTERNS) {
      expect(src, `JS-only construct in: ${src}`).not.toMatch(/\(\?<[=!]/);  // lookbehind
      expect(src, `named group syntax differs: ${src}`).not.toMatch(/\(\?<\w+>/);
      expect(src).not.toMatch(/\\p\{/);                                       // unicode property
    }
  });
});

describe("extractAiLog against the real 330MB log", () => {
  it.runIf(haveRef)("produces an extract the analyser reads IDENTICALLY to the full log", async () => {
    const ex = await extractAiLog(REF_LOG, { maxBytes: 64 * 1024 * 1024 }); // no trimming
    expect(ex.droppedTurnBlocks).toBe(0);
    expect(ex.lines).toBeGreaterThan(4_000_000);
    expect(ex.keptLines).toBeGreaterThan(500_000);
    expect(ex.turnBlocks).toBeGreaterThan(40);          // 51 blocks

    const fromExtract = analyse(ex.text);
    const fromFull = analyse(fs.readFileSync(REF_LOG, "latin1"));

    // the numbers that drive every finding must be the same
    expect(fromExtract.totalTurns).toBe(fromFull.totalTurns);
    expect(fromExtract.findings.length).toBe(fromFull.findings.length);
    expect(fromExtract.findingCounts).toEqual(fromFull.findingCounts);
    expect(fromExtract.askDistribution).toEqual(fromFull.askDistribution);
    expect(fromExtract.agents).toEqual(fromFull.agents);
    expect(Object.keys(fromExtract.economy).length).toBe(Object.keys(fromFull.economy).length);
    // and so must the findings themselves, in order
    const key = (f) => `${f.kind}|${f.name}|${f.faction}|${f.region}|${f.turns}|${f.detail}`;
    expect(fromExtract.findings.map(key)).toEqual(fromFull.findings.map(key));
  }, 600000);

  it.runIf(haveRef)("compresses inside a plain Discord attachment", async () => {
    const ex = await extractAiLog(REF_LOG);
    expect(ex.sourceBytes).toBeGreaterThan(300 * 1024 * 1024);   // 330MB
    expect(ex.gzipBytes).toBeLessThanOrEqual(8 * 1024 * 1024);   // 7.5MB
    // gzip must actually be gzip, so the receiving end can open it
    expect(ex.gzip[0]).toBe(0x1f);
    expect(ex.gzip[1]).toBe(0x8b);
  }, 600000);

  it.runIf(haveRef)("drops the OLDEST turn blocks when it has to trim, never mid-line", async () => {
    // force a trim with an absurdly small ceiling
    const ex = await extractAiLog(REF_LOG, { maxBytes: 512 * 1024 });
    expect(ex.gzipBytes).toBeLessThanOrEqual(512 * 1024);
    expect(ex.droppedTurnBlocks).toBeGreaterThan(0);
    expect(ex.turnBlocks).toBeGreaterThan(0);            // something is left
    // the extract must START on a turn header, so the first record is whole
    expect(ex.text.split("\n")[0]).toMatch(/^AI: \t*start '/);
    // every retained line is still one the analyser reads — no partial lines
    for (const l of ex.text.split("\n")) expect(keepLine(l)).toBe(true);
    // and it must still be analysable, with the LATEST turns kept
    const r = analyse(ex.text);
    expect(r.usable).toBe(true);
    expect(r.lastYear).toBeGreaterThan(-270);
  }, 600000);

  it("writes a real gzip for a tiny synthetic log", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ailog-"));
    const p = path.join(dir, "campaign_ai_log.txt");
    fs.writeFileSync(p, [
      "AI: \t\t\t\tstart 'rome' for year -270, season summer",
      "AI: irrelevant chatter",
      "AI: 3 spies assigned this turn",
      "AI: more chatter",
    ].join("\n"));
    const ex = await extractAiLog(p);
    expect(ex.lines).toBe(4);
    expect(ex.keptLines).toBe(2);
    expect(ex.turnBlocks).toBe(1);
    expect(ex.text.split("\n")).toEqual([
      "AI: \t\t\t\tstart 'rome' for year -270, season summer",
      "AI: 3 spies assigned this turn",
    ]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
