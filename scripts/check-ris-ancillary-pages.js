#!/usr/bin/env node
/**
 * Check the generated retinue (ancillary) pages against the source, independently.
 *
 *   node scripts/check-ris-ancillary-pages.js [--ris <dir>] [--out <dir>]
 *
 * gen-ris-ancillary-pages.js refuses to write when its own parsed-vs-flat table drifts.
 * This re-derives the facts a SECOND way — block splitting instead of a line walk, its own
 * dead-zone mask, its own UTF-16 read of text/export_ancillaries.txt — then reads the
 * PUBLISHED pages back:
 *
 *   1. block-derived counts vs flat patterns over the dead-zone-masked text, per field,
 *      plus the raw-vs-masked delta, which must be exactly the swallowed lines
 *   2. ancillaries/index.json holds one row per entry, above a hard floor
 *   3. every indexed entry's page exists and PRINTS its display name
 *   4. rendered entries (### headings + table rows) equal the number of entries
 *   5. every trait token index.json ties an ancillary to exists in the trait file
 *
 * Exits non-zero on any mismatch.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
const num = (n) => Number(n).toLocaleString("en-US");
const problems = [];
const fail = (s) => problems.push(s);

const SRC = path.join(RIS, "export_descr_ancillaries.txt");
let TXT = null;
try { TXT = fs.readFileSync(SRC, "latin1"); } catch { console.error(`not found: ${SRC}`); process.exit(2); }

// ── the dead-zone mask, derived independently of any block logic ─────────────
let deadCount = 0;
const MASKED_LINES = [];
{
  let dead = false;
  for (const raw of TXT.split(/\r?\n/)) {
    if (/^;+\s*(Trigger|Ancillary)\s/.test(raw)) { dead = true; continue; }
    if (/^(Trigger|Ancillary)\s/.test(raw)) dead = false;
    if (dead) { if (raw.replace(/;.*$/, "").trim()) deadCount++; continue; }
    MASKED_LINES.push(raw);
  }
}
const MASKED = MASKED_LINES.join("\n");

// ── an INDEPENDENT parse: block splitting over the masked text ───────────────
const blocks = MASKED.split(/\r?\n(?=(?:Ancillary|Trigger)\s)/);
const ancBlocks = [], trigBlocks = [];
for (const b of blocks) {
  if (/^Ancillary\s/.test(b)) ancBlocks.push(b);
  else if (/^Trigger\s/.test(b)) trigBlocks.push(b);
}
const strippedOf = (b) => b.split(/\r?\n/).map((l) => l.replace(/;.*$/, "")).join("\n");
const nameOf = (b) => /^(?:Ancillary|Trigger)\s+(\S+)/.exec(b)[1];
const countIn = (list, re) => list.reduce((a, b) => a + ((strippedOf(b).match(re) || []).length), 0);
const flatOf = (re) => (MASKED.match(re) || []).length;
const rawOf = (re) => (TXT.match(re) || []).length;

const FIELDS = [
  ["Ancillary blocks", ancBlocks.length, flatOf(/^Ancillary\s/gm)],
  ["Trigger blocks", trigBlocks.length, flatOf(/^Trigger\s/gm)],
  ["Image", countIn(ancBlocks, /^\s+Image\s/gm), flatOf(/^\s+Image\s/gm)],
  ["Description", countIn(ancBlocks, /^\s+Description\s/gm), flatOf(/^\s+Description\s/gm)],
  ["EffectsDescription", countIn(ancBlocks, /^\s+EffectsDescription\s/gm), flatOf(/^\s+EffectsDescription\s/gm)],
  ["Effect", countIn(ancBlocks, /^\s+Effect\s/gm), flatOf(/^\s+Effect\s/gm)],
  ["Unique", countIn(ancBlocks, /^\s+Unique\s*$/gm), flatOf(/^\s+Unique\s*$/gm)],
  ["ExcludedAncillaries", countIn(ancBlocks, /^\s+ExcludedAncillaries\s/gm), flatOf(/^\s+ExcludedAncillaries\s/gm)],
  ["ExcludeCultures", countIn(ancBlocks, /^\s+ExcludeCultures\s/gm), flatOf(/^\s+ExcludeCultures\s/gm)],
  ["WhenToTest", countIn(trigBlocks, /^\s*WhenToTest\s/gm), flatOf(/^\s*WhenToTest\s/gm)],
  ["Condition", countIn(trigBlocks, /^\s*Condition\s/gm), flatOf(/^\s*Condition\s/gm)],
  ["AcquireAncillary", countIn(trigBlocks, /^\s*AcquireAncillary\s/gm), flatOf(/^\s*AcquireAncillary\s/gm)],
];
console.log("source, block-derived vs flat pattern over the dead-zone-masked text:");
for (const [k, a, b] of FIELDS) {
  const ok = a === b;
  console.log(`  ${k.padEnd(20)} ${String(num(a)).padStart(7)} / ${String(num(b)).padStart(7)}${ok ? "" : "   <- MISMATCH"}`);
  if (!ok) fail(`${k}: block-derived ${a} != flat ${b}`);
}
{
  const rawTotal = ["WhenToTest", "Condition", "AcquireAncillary"].reduce((a, k) => {
    const re = new RegExp(String.raw`^\s*${k}\s`, "gm");
    return a + rawOf(re) - flatOf(re);
  }, 0) + (rawOf(/^\s+and\s/gm) - flatOf(/^\s+and\s/gm));
  console.log(`  dead-zone lines masked: ${deadCount} · raw-vs-masked field delta: ${rawTotal}`);
  if (rawTotal !== deadCount) fail(`dead-zone accounting: masked ${deadCount} live lines but field patterns lost ${rawTotal}`);
}
// Every AcquireAncillary line must be of the one understood shape.
{
  let odd = 0, first = null;
  for (const l of MASKED.split(/\r?\n/)) {
    if (!/^\s*AcquireAncillary\s/.test(l)) continue;
    if (!/^\s*AcquireAncillary\s+\S+\s+chance\s+\d+/i.test(l.replace(/;.*$/, ""))) { odd++; if (!first) first = l.trim(); }
  }
  console.log(`  AcquireAncillary lines of an unknown shape: ${odd}${odd ? `  e.g. "${first}"` : ""}`);
  if (odd) fail(`${odd} AcquireAncillary lines match no understood shape`);
}

// ── display names, independently ─────────────────────────────────────────────
const ANC_TEXT = {};
{
  let t = null;
  try { t = fs.readFileSync(path.join(RIS, "text", "export_ancillaries.txt"), "utf16le"); } catch { console.error("text/export_ancillaries.txt not found"); process.exit(2); }
  let cur = null;
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "").trim();
    if (/^[¬;]/.test(line)) continue;
    const m = /^\{([^}]+)\}\s*(.*)$/.exec(line);
    if (m) { cur = m[1]; ANC_TEXT[cur] = m[2].trim(); continue; }
    if (cur && line) ANC_TEXT[cur] = (ANC_TEXT[cur] ? ANC_TEXT[cur] + " " : "") + line;
  }
}
const unnamed = ancBlocks.map(nameOf).filter((n) => !(ANC_TEXT[n] || "").length);
console.log(`\nentries: ${num(ancBlocks.length)} · with a display name: ${num(ancBlocks.length - unnamed.length)}${unnamed.length ? ` · UNNAMED: ${unnamed.slice(0, 8).join(", ")}` : ""}`);

// ── the published index ──────────────────────────────────────────────────────
const FLOOR = 1000;
let INDEX = null;
try { INDEX = JSON.parse(fs.readFileSync(path.join(OUT, "ancillaries", "index.json"), "utf8")); } catch { console.error("ancillaries/index.json missing — run gen-ris-ancillary-pages.js"); process.exit(1); }
const indexed = Object.keys(INDEX);
console.log(`ancillaries/index.json rows: ${num(indexed.length)} (floor ${num(FLOOR)})`);
if (indexed.length < FLOOR) fail(`index.json has ${indexed.length} rows, below the floor of ${FLOOR}`);
if (indexed.length !== ancBlocks.length) fail(`index.json rows ${indexed.length} != entries ${ancBlocks.length}`);
{
  const idxSet = new Set(indexed);
  const missing = ancBlocks.map(nameOf).filter((t) => !idxSet.has(t));
  if (missing.length) fail(`${missing.length} entries absent from index.json — e.g. ${missing.slice(0, 5).join(", ")}`);
  const allTokens = new Set(ancBlocks.map(nameOf));
  const extra = indexed.filter((t) => !allTokens.has(t));
  if (extra.length) fail(`${extra.length} index.json rows name no entry in the file — e.g. ${extra.slice(0, 5).join(", ")}`);
}

// ── every indexed entry is genuinely ON its page ─────────────────────────────
const pageText = new Map();
const readPage = (f) => {
  if (!pageText.has(f)) {
    try { pageText.set(f, fs.readFileSync(path.join(OUT, "ancillaries", f), "utf8")); }
    catch { pageText.set(f, null); }
  }
  return pageText.get(f);
};
let absent = 0; const pagesMissing = new Set();
for (const [token, row] of Object.entries(INDEX)) {
  const body = readPage(row.page);
  if (body == null) { pagesMissing.add(row.page); continue; }
  if (!body.includes(row.name)) { absent++; if (absent <= 5) fail(`"${row.name}" (${token}) is indexed to ${row.page} but the page never prints it`); }
}
if (pagesMissing.size) fail(`pages named by index.json but absent on disk: ${[...pagesMissing].join(", ")}`);
if (absent > 5) fail(`…and ${absent - 5} more indexed entries their page never prints`);
console.log(`indexed entries printed on their page: ${num(indexed.length - absent)} of ${num(indexed.length)} · pages read: ${pageText.size}`);

// ── rendered entries equal the file's entries ────────────────────────────────
{
  const TABLE_PAGES = new Set(["priesthoods.md"]);
  let rows = 0, headings = 0;
  const files = fs.readdirSync(path.join(OUT, "ancillaries")).filter((f) => f.endsWith(".md"));
  for (const f of files) {
    const body = readPage(f);
    if (TABLE_PAGES.has(f)) rows += (body.match(/^\| \*\*/gm) || []).length;
    else headings += (body.match(/^### /gm) || []).length;
  }
  const total = rows + headings;
  console.log(`rendered entries: ${num(rows)} table rows + ${num(headings)} headings = ${num(total)} across ${files.length} pages`);
  if (total !== ancBlocks.length) fail(`rendered entries ${total} != entries ${ancBlocks.length}`);
}

// ── the trait ties are real ──────────────────────────────────────────────────
// index.json says which traits gate each entry; every one of those tokens must exist in
// the trait file, or the cross-family links rest on a typo.
{
  const traitTxt = fs.readFileSync(path.join(RIS, "export_descr_character_traits.txt"), "latin1");
  const traitTokens = new Set([...traitTxt.matchAll(/^Trait\s+(\S+)/gm)].map((m) => m[1]));
  const tied = Object.values(INDEX).flatMap((e) => e.traits || []);
  const badTies = uniqArr(tied).filter((t) => !traitTokens.has(t));
  console.log(`trait ties: ${num(tied.length)} across ${num(Object.values(INDEX).filter((e) => (e.traits || []).length).length)} entries · distinct traits ${num(uniqArr(tied).length)} · unknown tokens ${badTies.length}${badTies.length ? ` (${badTies.slice(0, 5).join(", ")})` : ""}`);
  if (badTies.length) fail(`${badTies.length} trait tokens in index.json exist in no Trait block`);
  function uniqArr(a) { return [...new Set(a)]; }
}

// ── the index page exists and carries the decision ───────────────────────────
{
  let idx = null;
  try { idx = fs.readFileSync(path.join(OUT, "ancillaries.md"), "utf8"); } catch { fail("ancillaries.md missing"); }
  if (idx && !idx.includes(num(ancBlocks.length))) fail(`ancillaries.md never states the entry count ${num(ancBlocks.length)}`);
  if (idx && !/candidate test/i.test(idx)) fail("ancillaries.md lost the visibility-decision table");
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("\nancillary pages check out: source counts agree two ways, index matches, every entry is printed.");
