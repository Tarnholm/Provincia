#!/usr/bin/env node
/**
 * Harvest a REAL sample line for every AI-log pattern, and rewrite the test fixture.
 *
 *   node scripts/harvest-ailog-samples.js [--log <path>] [--write]
 *
 * WHY THIS EXISTS. src/aiLogExtract.test.js asserts one sample line per pattern in
 * AI_LOG_LINE_PATTERNS, so that every pattern is proven to keep a line the reporter
 * would actually ship. Satisfying that by hand means writing what I *imagine* the
 * engine emits — and a fixture built from imagination has already cost this project
 * a falsifier that passed while examining nothing (see the aiTerrainAudit history).
 *
 * So samples are lifted verbatim from the reference log instead. A pattern with NO
 * real example in 4.4M lines is REPORTED, not papered over: that means the pattern is
 * speculative and should be justified or dropped.
 *
 * Run this after adding any AI_RX pattern, together with:
 *   node scripts/gen-ailog-patterns.js     (regenerate the reporter's Python twin)
 * and re-measure the reporter's extract size — a new pattern keeps more lines.
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ROOT = path.join(__dirname, "..");
const { AI_LOG_LINE_PATTERNS } = require(path.join(ROOT, "src", "aiMovementAnalyzer.js"));

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const logArg = argv.indexOf("--log");
const LOG = logArg >= 0 ? argv[logArg + 1] : "C:/dev/log test files/campaign_ai_log.txt";

const TEST = path.join(ROOT, "src", "aiLogExtract.test.js");
const START = "    // ── HARVESTED, NOT HAND-WRITTEN ──";
const END = "    expect(samples).toHaveLength(AI_LOG_LINE_PATTERNS.length);";

if (!fs.existsSync(LOG)) {
  console.error(`reference log not found: ${LOG}`);
  console.error("pass --log <path> to point at one.");
  process.exit(2);
}

const rxs = AI_LOG_LINE_PATTERNS.map((src) => ({ src, rx: new RegExp(src), sample: null }));
let need = rxs.length;

const rl = readline.createInterface({
  input: fs.createReadStream(LOG, { highWaterMark: 1 << 20 }),
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  if (!need) return;
  const l = line.trimEnd();
  for (const e of rxs) {
    if (e.sample === null && e.rx.test(l)) {
      // Long enough to be real, short enough to read in a test file.
      e.sample = l.length > 220 ? l.slice(0, 220) : l;
      if (--need === 0) rl.close();
    }
  }
});

rl.on("close", () => {
  const found = rxs.filter((e) => e.sample !== null);
  const missing = rxs.filter((e) => e.sample === null);

  console.log(`real samples found: ${found.length} / ${rxs.length}`);
  if (missing.length) {
    console.log("\nNO real example in the reference log — these patterns are speculative:");
    for (const e of missing) console.log("   " + e.src.slice(0, 120));
    console.log("\nEither justify them from another log, or drop them. Not writing the");
    console.log("fixture: a fixture that silently omits a pattern defeats the guard.");
    process.exit(1);
  }

  if (!WRITE) {
    console.log("\n(dry run — pass --write to update src/aiLogExtract.test.js)");
    return;
  }

  const s = fs.readFileSync(TEST, "utf8");
  const eol = s.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
  const a = s.indexOf(START);
  const b = s.indexOf(END);
  if (a < 0 || b < 0 || b < a) {
    console.error(`anchors missing in ${TEST} — has the fixture block been renamed?`);
    process.exit(3);
  }

  const header = [
    "    // ── HARVESTED, NOT HAND-WRITTEN ──",
    "    // One verbatim line per pattern, lifted from the reference campaign_ai_log by",
    "    // scripts/harvest-ailog-samples.js --write. Do not edit by hand: a typed sample",
    "    // encodes what the engine is IMAGINED to emit, and this project has already been",
    "    // bitten by exactly that (a falsifier that passed while testing nothing). Every",
    "    // pattern below is proven to have a real example; the harvester refuses to write",
    "    // this block if any pattern has none, because that pattern is speculative.",
    "    //",
    "    // Note the faction header's TABS after \"AI:\" and absence of \"+\": a retyped",
    "    // version of that pattern got both wrong.",
    "    const samples = [",
    ...found.map((e) => "      " + JSON.stringify(e.sample) + ","),
    "    ];",
    "",
  ].join(eol);

  fs.writeFileSync(TEST, s.slice(0, a) + header + s.slice(b));
  console.log(`\nwrote ${found.length} real lines into src/aiLogExtract.test.js`);
});
