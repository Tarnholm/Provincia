#!/usr/bin/env node
/**
 * Generate the crash reporter's Python line-filter from Provincia's own manifest.
 *
 * WHY THIS EXISTS
 * ---------------
 * The reporter has to send campaign_ai_log data back from testers, and the raw
 * file is 330MB. It ships a filtered extract instead — which is only equivalent
 * to the original if it filters on EXACTLY the line shapes the analyser reads.
 *
 * Keeping a second, hand-typed copy of those patterns in Python guarantees drift.
 * It already bit once: a retyped faction turn header used "+start" where the real
 * log has "AI: <tabs>start", matched nothing, and would have silently discarded
 * every turn boundary — and with it all faction attribution — with no error.
 *
 * So the patterns live in src/aiMovementAnalyzer.js (AI_LOG_LINE_PATTERNS) and
 * this writes the Python form. Run by `npm run gen:ailog-patterns`, and by
 * prebuild so a release can never ship a stale copy.
 *
 * It also ASSERTS that every pattern uses only constructs that mean the same
 * thing in both regex dialects, rather than assuming it.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { pythonPatternModule } = require(path.join(ROOT, "src", "aiLogExtract.js"));
const { AI_LOG_LINE_PATTERNS } = require(path.join(ROOT, "src", "aiMovementAnalyzer.js"));

// Constructs that exist in JS regex but differ or are absent in Python's `re`.
const JS_ONLY = [
  { rx: /\(\?<[=!]/, what: "lookbehind (Python needs fixed width)" },
  { rx: /\(\?<\w+>/, what: "JS named group syntax (Python uses (?P<name>…))" },
  { rx: /\\p\{/, what: "\\p{...} unicode property escape" },
  { rx: /\\d(?=.*\/[a-z]*u)/, what: "unicode-flag-dependent class" },
];

const offences = [];
for (const src of AI_LOG_LINE_PATTERNS) {
  for (const { rx, what } of JS_ONLY) {
    if (rx.test(src)) offences.push(`${what} in: ${src}`);
  }
  // a pattern containing a raw triple-quote would break the generated literal
  if (src.includes('"""')) offences.push(`triple quote would break the Python literal: ${src}`);
}
if (offences.length) {
  console.error("REFUSING to generate — these patterns are not portable to Python:");
  for (const o of offences) console.error("  " + o);
  process.exit(1);
}

// The reporter repo lives beside Provincia; also drop a copy inside Provincia's
// own bundle so the packaged app can hand it to the reporter it launches.
const targets = [
  path.join(ROOT, "crash-reporter", "ai_log_patterns.py"),
  path.join(ROOT, "..", "RIS-CrashReporter", "ai_log_patterns.py"),
];

const body = pythonPatternModule();
let wrote = 0;
for (const t of targets) {
  try {
    fs.mkdirSync(path.dirname(t), { recursive: true });
    const prev = fs.existsSync(t) ? fs.readFileSync(t, "utf8") : null;
    if (prev === body) { console.log(`unchanged: ${t}`); wrote++; continue; }
    fs.writeFileSync(t, body);
    console.log(`wrote ${AI_LOG_LINE_PATTERNS.length} patterns -> ${t}`);
    wrote++;
  } catch (e) {
    // the sibling reporter checkout may not exist on another machine — that is
    // not a build failure, but Provincia's own copy is mandatory
    console.warn(`skipped ${t}: ${e.message}`);
  }
}
if (!fs.existsSync(targets[0])) {
  console.error("FAILED: Provincia's own copy was not written");
  process.exit(1);
}
console.log(`done (${wrote}/${targets.length} targets)`);
