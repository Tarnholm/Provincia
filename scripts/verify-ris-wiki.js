#!/usr/bin/env node
/**
 * Verify the generated RIS wiki. Exits non-zero if anything is wrong.
 *
 *   node scripts/verify-ris-wiki.js [--out <dir>] [--quiet]
 *
 * WHY THIS EXISTS. Two overview pages were silently absent from the published wiki for
 * several commits because two generators wrote the same filename and the later one won.
 * Nothing looked broken — the surviving page was perfectly good on its own — so the loss
 * was invisible until someone questioned a sentence that should have been there.
 *
 * That is the failure mode this catches: not pages that are WRONG, but pages that are
 * MISSING or unreachable, which no amount of reading the output reveals.
 *
 * Checks:
 *   1. Output-filename collisions between generators, read from their source.
 *   2. Every relative link in every page resolves to a file that exists.
 *   3. Every image reference resolves.
 *   4. Orphans: pages nothing links to, so a reader can never reach them.
 *   5. Sanity floors on the page counts, so a generator that silently produced almost
 *      nothing fails here instead of being committed.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
const SCRIPTS = __dirname;
const QUIET = argv.includes("--quiet");

const problems = [];
const note = (s) => { if (!QUIET) console.log(s); };
const fail = (s) => problems.push(s);

if (!fs.existsSync(OUT)) { console.error(`wiki not found: ${OUT}`); process.exit(2); }

// ── 1. filename collisions between generators ────────────────────────────────
// Read each generator's source for the root-level .md filenames it writes. A page written
// by two generators is lost from whichever runs first.
{
  const owners = new Map();   // filename -> [generator, …]
  for (const f of fs.readdirSync(SCRIPTS).filter((n) => /^gen-ris-.*\.js$/.test(n))) {
    const src = fs.readFileSync(path.join(SCRIPTS, f), "utf8");
    const names = new Set();
    // pages["x.md"]  and  path.join(OUT, "x.md")
    for (const m of src.matchAll(/pages\["([a-z0-9-]+\.md)"\]/g)) names.add(m[1]);
    for (const m of src.matchAll(/path\.join\(OUT,\s*"([a-z0-9-]+\.md)"\)/g)) names.add(m[1]);
    for (const n of names) {
      if (!owners.has(n)) owners.set(n, []);
      owners.get(n).push(f);
    }
  }
  let collisions = 0;
  for (const [name, gens] of owners) {
    if (gens.length > 1) { collisions++; fail(`COLLISION: ${name} is written by ${gens.join(" AND ")} — the later run overwrites the earlier`); }
  }
  note(`filename collisions: ${collisions === 0 ? "none" : collisions} (${owners.size} root pages claimed across the generators)`);
}

// ── walk every markdown file ─────────────────────────────────────────────────
const pages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.md$/i.test(e.name)) pages.push(p);
  }
})(OUT);

// ── 2 + 3. links and images resolve ──────────────────────────────────────────
const linkedTo = new Set();
let links = 0, images = 0, badLinks = 0, badImages = 0;
for (const p of pages) {
  const body = fs.readFileSync(p, "utf8");
  const dir = path.dirname(p);

  // [text](target) — skip absolute URLs and pure anchors
  for (const m of body.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const clean = target.split("#")[0];
    if (!clean) continue;
    links++;
    const resolved = path.resolve(dir, clean);
    if (!fs.existsSync(resolved)) { badLinks++; if (badLinks <= 8) fail(`BROKEN LINK in ${path.relative(OUT, p)}: ${target}`); }
    else if (/\.md$/i.test(clean)) linkedTo.add(path.resolve(resolved));
  }

  // <img src="..."> as well as markdown images
  for (const m of body.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    images++;
    const r = path.resolve(dir, m[1]);
    if (!fs.existsSync(r)) { badImages++; if (badImages <= 8) fail(`BROKEN IMAGE in ${path.relative(OUT, p)}: ${m[1]}`); }
  }
  for (const m of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    if (/^https?:/.test(m[1])) continue;
    images++;
    const r = path.resolve(dir, m[1].split("#")[0]);
    if (!fs.existsSync(r)) { badImages++; if (badImages <= 8) fail(`BROKEN IMAGE in ${path.relative(OUT, p)}: ${m[1]}`); }
  }
}
note(`links: ${links.toLocaleString("en-US")} checked, ${badLinks} broken`);
note(`images: ${images.toLocaleString("en-US")} checked, ${badImages} broken`);

// ── 4. orphans ───────────────────────────────────────────────────────────────
// A page nothing links to cannot be reached by a reader, which is how a lost overview
// page hides. README is the entry point so it is exempt.
{
  const readme = path.resolve(OUT, "README.md");
  const orphans = pages.filter((p) => path.resolve(p) !== readme && !linkedTo.has(path.resolve(p)));
  if (orphans.length) {
    fail(`ORPHANED: ${orphans.length} page(s) that nothing links to — e.g. ${orphans.slice(0, 5).map((p) => path.relative(OUT, p)).join(", ")}`);
  }
  note(`orphaned pages: ${orphans.length}`);
}

// ── 5. sanity floors ─────────────────────────────────────────────────────────
// A generator that silently produced almost nothing should fail here, not be committed.
{
  const count = (sub) => { try { return fs.readdirSync(path.join(OUT, sub)).length; } catch { return 0; } };
  const floors = { factions: 200, regions: 1000, units: 1000, cards: 900, maps: 150 };
  for (const [dir, min] of Object.entries(floors)) {
    const n = count(dir);
    if (n < min) fail(`TOO FEW in ${dir}/: ${n} (expected at least ${min}) — did that generator fail?`);
    note(`${dir}/: ${n.toLocaleString("en-US")}`);
  }
}

// ── report ───────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
note("\nwiki verified: no collisions, no broken links or images, no orphans.");
