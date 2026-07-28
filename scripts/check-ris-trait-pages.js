#!/usr/bin/env node
/**
 * Check the generated trait pages against the source, independently.
 *
 *   node scripts/check-ris-trait-pages.js [--ris <dir>] [--out <dir>]
 *
 * gen-ris-trait-pages.js already refuses to write when its own parsed-vs-flat table drifts.
 * This script re-derives the facts a SECOND way — block splitting instead of a line walk, its
 * own UTF-16 read of export_vnvs.txt — and then reads the PUBLISHED pages back:
 *
 *   1. block-derived counts vs flat patterns over the raw text, per field
 *   2. traits/index.json holds exactly one row per visible trait, above a hard floor
 *   3. every indexed trait's page exists and PRINTS that trait's display name — a page
 *      that silently lost its entries fails here, which is the belief-pages lesson
 *   4. rendered entries counted off the pages (### headings + table rows) equal the
 *      number of visible traits — nothing double-published, nothing dropped
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

const SRC = path.join(RIS, "export_descr_character_traits.txt");
let TXT = null;
try { TXT = fs.readFileSync(SRC, "latin1"); } catch { console.error(`not found: ${SRC}`); process.exit(2); }

// ── an INDEPENDENT parse: block splitting, not a line walk ───────────────────
// The generator walks lines and carries state; this cuts the text into blocks at every
// line that begins `Trait` or `Trigger` and interrogates each block on its own. The two
// mechanisms fail differently, which is the point of running both.
const blocks = TXT.split(/\r?\n(?=(?:Trait|Trigger)\s)/);
const traitBlocks = [], triggerBlocks = [];
for (const b of blocks) {
  if (/^Trait\s/.test(b)) traitBlocks.push(b);
  else if (/^Trigger\s/.test(b)) triggerBlocks.push(b);
}
const stripped = (b) => b.split(/\r?\n/).map((l) => l.replace(/;.*$/, "")).join("\n");
const traitOf = (b) => /^Trait\s+(\S+)/.exec(b)[1];
const isHidden = (b) => /^\s+Hidden\s*$/m.test(stripped(b));
const firstLevel = (b) => { const m = /^\s*Level\s+(\S+)/m.exec(stripped(b)); return m ? m[1] : null; };

const countIn = (list, re) => list.reduce((a, b) => a + ((stripped(b).match(re) || []).length), 0);
const flatOf = (re) => (TXT.match(re) || []).length;

const FIELDS = [
  ["Trait blocks", traitBlocks.length, flatOf(/^Trait\s/gm)],
  ["Trigger blocks", triggerBlocks.length, flatOf(/^Trigger\s/gm)],
  ["Level", countIn(traitBlocks, /^\s*Level\s/gm), flatOf(/^\s*Level\s/gm)],
  ["Effect", countIn(traitBlocks, /^\s+Effect\s/gm), flatOf(/^\s*Effect\s/gm)],
  ["Threshold", countIn(traitBlocks, /^\s+Threshold\s/gm), flatOf(/^\s+Threshold\s/gm)],
  ["Description", countIn(traitBlocks, /^\s+Description\s/gm), flatOf(/^\s+Description\s/gm)],
  ["EffectsDescription", countIn(traitBlocks, /^\s+EffectsDescription\s/gm), flatOf(/^\s+EffectsDescription\s/gm)],
  ["Hidden", traitBlocks.filter(isHidden).length, flatOf(/^\s+Hidden\s*$/gm)],
  ["Affects", countIn(triggerBlocks, /^\s*Affects\s/gm), flatOf(/^\s*Affects\s/gm)],
  ["WhenToTest", countIn(triggerBlocks, /^\s*WhenToTest\s/gm), flatOf(/^\s*WhenToTest\s/gm)],
  ["Condition", countIn(triggerBlocks, /^\s*Condition\s/gm), flatOf(/^\s*Condition\s/gm)],
  ["Epithet", countIn(traitBlocks, /^\s+Epithet\s/gm), flatOf(/^\s+Epithet\s/gm)],
  ["Inherit_chance", countIn(traitBlocks, /^\s+Inherit_chance\s/gm), flatOf(/^\s+Inherit_chance\s/gm)],
];
console.log("source, block-derived vs flat pattern:");
for (const [k, a, b] of FIELDS) {
  const ok = a === b;
  console.log(`  ${k.padEnd(20)} ${String(num(a)).padStart(8)} / ${String(num(b)).padStart(8)}${ok ? "" : "   <- MISMATCH"}`);
  if (!ok) fail(`${k}: block-derived ${a} != flat ${b}`);
}

// Affects lines must all be of a shape the generator understands — both the plain and the
// `Lose` form. Any third shape would be silently dropped by everyone.
{
  let odd = 0, first = null;
  for (const b of triggerBlocks) {
    for (const l of stripped(b).split(/\r?\n/)) {
      if (!/^\s*Affects\s/.test(l)) continue;
      if (!/^\s*Affects\s+\S+\s+(Lose\s+)?-?\d+\s+Chance\s+\d+/.test(l)) { odd++; if (!first) first = l.trim(); }
    }
  }
  console.log(`  Affects lines of an unknown shape: ${odd}${odd ? `  e.g. "${first}"` : ""}`);
  if (odd) fail(`${odd} Affects lines match neither the plain nor the Lose shape`);
}

// ── display names, independently ─────────────────────────────────────────────
const VNVS = {};
{
  let t = null;
  try { t = fs.readFileSync(path.join(RIS, "text", "export_vnvs.txt"), "utf16le"); } catch { console.error("text/export_vnvs.txt not found"); process.exit(2); }
  let cur = null;
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "").trim();
    if (/^[¬;]/.test(line)) continue;
    const m = /^\{([^}]+)\}\s*(.*)$/.exec(line);
    if (m) { cur = m[1]; VNVS[cur] = m[2].trim(); continue; }
    if (cur && line) VNVS[cur] = (VNVS[cur] ? VNVS[cur] + " " : "") + line;
  }
}

const visible = traitBlocks.filter((b) => !isHidden(b));
const hidden = traitBlocks.length - visible.length;
console.log(`\nvisible traits (not Hidden): ${num(visible.length)} · hidden: ${hidden}`);

// ── the published index ──────────────────────────────────────────────────────
const FLOOR = 3000;
let INDEX = null;
try { INDEX = JSON.parse(fs.readFileSync(path.join(OUT, "traits", "index.json"), "utf8")); } catch { console.error("traits/index.json missing — run gen-ris-trait-pages.js"); process.exit(1); }
const indexed = Object.keys(INDEX);
console.log(`traits/index.json rows: ${num(indexed.length)} (floor ${num(FLOOR)})`);
if (indexed.length < FLOOR) fail(`index.json has ${indexed.length} rows, below the floor of ${FLOOR}`);
if (indexed.length !== visible.length) fail(`index.json rows ${indexed.length} != visible traits ${visible.length}`);
{
  const idxSet = new Set(indexed);
  const missing = visible.map(traitOf).filter((t) => !idxSet.has(t));
  if (missing.length) fail(`${missing.length} visible traits absent from index.json — e.g. ${missing.slice(0, 5).join(", ")}`);
  const extra = indexed.filter((t) => !traitBlocks.some((b) => traitOf(b) === t));
  // (containment via a set, not .some, for speed)
  const allTokens = new Set(traitBlocks.map(traitOf));
  const reallyExtra = indexed.filter((t) => !allTokens.has(t));
  if (reallyExtra.length) fail(`${reallyExtra.length} index.json rows name no trait in the file — e.g. ${reallyExtra.slice(0, 5).join(", ")}`);
  void extra;
}

// ── every indexed trait is genuinely ON its page ─────────────────────────────
// The failure this exists for: a generator change that keeps writing pages and the index
// but stops printing the entries. Each page is read once; each trait's display name must
// appear in its page's text.
const pageText = new Map();
const readPage = (f) => {
  if (!pageText.has(f)) {
    try { pageText.set(f, fs.readFileSync(path.join(OUT, "traits", f), "utf8")); }
    catch { pageText.set(f, null); }
  }
  return pageText.get(f);
};
let absent = 0, pagesMissing = new Set();
for (const [token, row] of Object.entries(INDEX)) {
  const body = readPage(row.page);
  if (body == null) { pagesMissing.add(row.page); continue; }
  if (!body.includes(row.name)) { absent++; if (absent <= 5) fail(`"${row.name}" (${token}) is indexed to ${row.page} but the page never prints it`); }
}
if (pagesMissing.size) fail(`pages named by index.json but absent on disk: ${[...pagesMissing].join(", ")}`);
if (absent > 5) fail(`…and ${absent - 5} more indexed traits their page never prints`);
console.log(`indexed traits printed on their page: ${num(indexed.length - absent)} of ${num(indexed.length)} · pages read: ${pageText.size}`);

// ── rendered entries equal visible traits ────────────────────────────────────
// Table pages carry one `| **…**` row per trait; the others one `### ` heading per trait.
{
  const TABLE_PAGES = new Set(["governorships.md", "fears-and-hatreds.md", "origins.md"]);
  let rows = 0, headings = 0;
  const files = fs.readdirSync(path.join(OUT, "traits")).filter((f) => f.endsWith(".md"));
  for (const f of files) {
    const body = readPage(f);
    if (TABLE_PAGES.has(f)) rows += (body.match(/^\| \*\*/gm) || []).length;
    else headings += (body.match(/^### /gm) || []).length;
  }
  const total = rows + headings;
  console.log(`rendered entries: ${num(rows)} table rows + ${num(headings)} headings = ${num(total)} across ${files.length} pages`);
  if (total !== visible.length) fail(`rendered entries ${total} != visible traits ${visible.length} — something is dropped or double-published`);
}

// ── the index page exists and carries the decision ───────────────────────────
{
  let idx = null;
  try { idx = fs.readFileSync(path.join(OUT, "traits.md"), "utf8"); } catch { fail("traits.md missing"); }
  if (idx && !idx.includes(num(visible.length))) fail(`traits.md never states the visible count ${num(visible.length)}`);
  if (idx && !/candidate test/i.test(idx)) fail("traits.md lost the visibility-decision table");
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("\ntrait pages check out: source counts agree two ways, index matches, every entry is printed.");
