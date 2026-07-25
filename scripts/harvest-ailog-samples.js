// Harvest a REAL sample line for every pattern in the manifest.
//
// The guard test asserts one sample per pattern. Writing those samples by hand
// means writing what I imagine the engine emits, and a fixture built from
// imagination has already burned this project once (the falsifier that examined a
// shape buildSaveFacts never produces). So each sample is lifted verbatim from the
// reference log instead, and a pattern with NO real example in 4.4M lines is
// reported rather than papered over — that would mean the pattern is speculative.
const fs = require("fs");
const readline = require("readline");

const { AI_LOG_LINE_PATTERNS } = require("C:/dev/Provincia/src/aiMovementAnalyzer.js");
const LOG = "C:/dev/log test files/campaign_ai_log.txt";

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
      // Keep it short enough to read in a test file but long enough to be real.
      e.sample = l.length > 200 ? l.slice(0, 200) : l;
      if (--need === 0) rl.close();
    }
  }
});

rl.on("close", () => {
  const found = rxs.filter((e) => e.sample !== null);
  const missing = rxs.filter((e) => e.sample === null);

  console.log(`real samples found: ${found.length} / ${rxs.length}`);
  if (missing.length) {
    console.log("\nNO real example in the reference log (pattern may be speculative):");
    for (const e of missing) console.log("   " + e.src.slice(0, 110));
  }

  fs.writeFileSync(
    "C:/Users/vtarn/AppData/Local/Temp/claude/C--Users-vtarn-OneDrive-Skrivbord/6fd4885d-f016-48c8-bf38-a20b78536fc3/scratchpad/samples.json",
    JSON.stringify({ found: found.map((e) => e.sample), missing: missing.map((e) => e.src) }, null, 2)
  );
  console.log("\nwrote samples.json");
});
