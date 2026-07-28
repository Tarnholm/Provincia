#!/usr/bin/env node
/**
 * Verify a built RIS wiki site the way verify-ris-wiki.js verifies the markdown it came from.
 * Exits non-zero if anything is wrong.
 *
 *   node scripts/check-ris-wiki-site.js [--site <dir>] [--without cards] [--quiet]
 *
 * WHY THIS IS A SEPARATE FILE AND NOT A FLAG ON THE BUILDER. A builder that checks its own
 * output can only check what it thought it wrote. This reads the built folder cold, with no
 * knowledge of how it was produced, and resolves every path the way a browser opening
 * index.html from a plain folder would. That is the only way to catch the class of bug this
 * exists for: a URL that is correct in the source and wrong in the export.
 *
 * Checks, each reported with the COUNT it examined:
 *   1. Root-absolute URLs. `href="/art/x.png"` works on a server and points at the root of
 *      the C: drive under file://. Any single one of these means the export is not portable.
 *   2. Every href/src resolves to a file that exists, resolved relative to the page holding it.
 *   3. Every #fragment matches an id on the target page. The region pages alone carry
 *      thousands of links into a reference page BY HEADING; a slug rule that drifted would
 *      land every one of them silently at the top of the page.
 *   4. Orphans: pages nothing links to, which a reader can never reach.
 *   5. The entry point exists, is the README, and its own links resolve.
 *   6. Case. Windows resolves ART/X.PNG to art/x.png; GitHub Pages does not.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const SITE = path.resolve(valOf("--site", "C:/RIS/_build/ris-wiki-site"));
const QUIET = argv.includes("--quiet");
const WITHOUT = new Set((valOf("--without", "") || "").split(",").map((s) => s.trim()).filter(Boolean));

const note = (s) => { if (!QUIET) console.log(s); };
const n = (x) => x.toLocaleString("en-US");
const problems = [];
const fail = (s) => problems.push(s);

if (!fs.existsSync(SITE)) { console.error(`site not found: ${SITE}`); process.exit(2); }

// ── inventory ────────────────────────────────────────────────────────────────
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else files.push(path.relative(SITE, p).split(path.sep).join("/"));
  }
})(SITE);
const present = new Set(files);
const pages = files.filter((f) => /\.html$/i.test(f));
// The stylesheet is scanned as well as the pages, and that is not thoroughness for its own
// sake. The shell's one CSS background-image — the mod's rule under every page title — lives
// only in wiki.css. An earlier version of this check looked at .html alone, passed with zero
// broken links, and the built site was asking every browser for C:\art\ris-rule.png.
const scanned = files.filter((f) => /\.(html|css)$/i.test(f));
note(`site: ${n(files.length)} files, ${n(pages.length)} html pages, ${n(scanned.length - pages.length)} stylesheet(s)`);

// Real directory listings, so a reference that differs only in case is caught here rather
// than by a reader on a case-sensitive host.
const listing = new Map();
const existsExact = (rel) => {
  const dir = path.posix.dirname(rel);
  if (!listing.has(dir)) {
    let names = new Set();
    try { names = new Set(fs.readdirSync(path.join(SITE, dir === "." ? "" : dir))); } catch { /* no dir */ }
    listing.set(dir, names);
  }
  return listing.get(dir).has(path.posix.basename(rel));
};

// ids on a page, cached — a fragment is checked against the target's real anchors.
const idsOf = (() => {
  const cache = new Map();
  return (rel) => {
    if (cache.has(rel)) return cache.get(rel);
    const set = new Set();
    try {
      for (const m of fs.readFileSync(path.join(SITE, rel), "utf8").matchAll(/\bid="([^"]+)"/g)) set.add(m[1].toLowerCase());
    } catch { /* unreadable */ }
    cache.set(rel, set);
    return set;
  };
})();

// ── 1 + 2 + 3 + 6 ────────────────────────────────────────────────────────────
const SKIP_URL = /^(https?:|mailto:|data:|javascript:|\/\/)/i;
let urls = 0, absolute = 0, broken = 0, frags = 0, badFrags = 0, caseBad = 0, skippedByFlag = 0;
const linkedTo = new Set();
const sample = { abs: [], broken: [], frag: [], case: [] };
const keep = (bucket, s) => { if (sample[bucket].length < 8) sample[bucket].push(s); };

for (const page of scanned) {
  const dir = path.posix.dirname(page);
  const html = fs.readFileSync(path.join(SITE, page), "utf8");
  // Attribute values and stylesheet url() together — the shell's rule under the page title is
  // a url(), and it was root-absolute in the served version, so it has to be checked too.
  const found = [];
  for (const m of html.matchAll(/\b(href|src|action)="([^"]*)"/g)) found.push(m[2]);
  for (const m of html.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) found.push(m[2]);

  for (const raw of found) {
    if (!raw || SKIP_URL.test(raw)) continue;
    // A value containing markup is a template inside inline JS (the sortable views build
    // href="' + v.href + '"), not a URL this check can resolve.
    if (/[<>']/.test(raw) || raw.includes("+ ")) continue;
    urls++;
    if (raw.startsWith("/")) {
      absolute++;
      keep("abs", `${page}: ${raw}`);
      continue;
    }
    const hash = raw.indexOf("#");
    const frag = hash >= 0 ? raw.slice(hash + 1) : "";
    const bare = hash >= 0 ? raw.slice(0, hash) : raw;
    if (!bare) {                       // same-page anchor
      if (!frag) continue;
      frags++;
      if (!idsOf(page).has(frag.toLowerCase())) { badFrags++; keep("frag", `${page}: #${frag} — no such id on this page`); }
      continue;
    }
    const target = path.posix.normalize(dir === "." ? decodeURIComponent(bare) : `${dir}/${decodeURIComponent(bare)}`);
    if (WITHOUT.has(target.split("/")[0])) { skippedByFlag++; continue; }
    if (!present.has(target)) {
      broken++;
      keep("broken", `${page}: ${raw} -> ${target}`);
      continue;
    }
    if (!existsExact(target)) { caseBad++; keep("case", `${page}: ${raw}`); }
    if (/\.html$/i.test(target)) {
      linkedTo.add(target);
      if (frag) {
        frags++;
        if (!idsOf(target).has(frag.toLowerCase())) { badFrags++; keep("frag", `${page}: ${raw} — no id "${frag}" on ${target}`); }
      }
    }
  }
}

note(`urls examined:  ${n(urls)} href/src/action/url() values across ${n(scanned.length)} pages and stylesheets`);
note(`root-absolute:  ${n(absolute)} (any at all and the site cannot be opened from a folder)`);
note(`broken:         ${n(broken)}`);
note(`fragments:      ${n(frags)} checked against the target page's ids, ${n(badFrags)} broken`);
note(`case mismatch:  ${n(caseBad)} (would 404 on GitHub Pages)`);
if (WITHOUT.size) note(`not checked:    ${n(skippedByFlag)} links into ${[...WITHOUT].join(", ")}/ — left out by --without`);

if (absolute) fail(`${absolute} root-absolute URL(s): these resolve to the root of the drive under file://\n    ` + sample.abs.join("\n    "));
if (broken) fail(`${broken} broken link(s):\n    ` + sample.broken.join("\n    "));
if (badFrags) fail(`${badFrags} broken fragment(s):\n    ` + sample.frag.join("\n    "));
if (caseBad) fail(`${caseBad} case-mismatched reference(s):\n    ` + sample.case.join("\n    "));

// ── 3b. the search index ─────────────────────────────────────────────────────
// Every row in it is a link the reader can click, and none of them appears in any page's
// markup — so without this they are the one set of paths in the site nothing checks. A stale
// index would send every search result to a page that no longer exists under that name.
{
  const f = path.join(SITE, "search-index.js");
  if (!fs.existsSync(f)) fail("no search-index.js — the search box would find nothing");
  else {
    const src = fs.readFileSync(f, "utf8");
    const rows = JSON.parse(src.replace(/^window\.RIS_PAGES=/, "").replace(/;\s*$/, ""));
    let bad = 0;
    const badSample = [];
    for (const [, rel] of rows) {
      // Deliberately NOT added to linkedTo: every page is in the search index, so counting
      // that as reachable would make the orphan check below incapable of ever failing. Orphan
      // means "no page links here", and a reader who has to guess a title has not browsed to it.
      if (!present.has(rel)) { bad++; if (badSample.length < 5) badSample.push(rel); }
    }
    note(`search index:   ${n(rows.length)} titles, ${n(bad)} pointing at a page that is not there`);
    if (bad) fail(`${bad} search result(s) point at a missing page: ${badSample.join(", ")}`);
    if (rows.length < pages.length - 10) fail(`the search index has ${rows.length} entries for ${pages.length} pages — it is stale`);
  }
}

// ── 4. orphans ───────────────────────────────────────────────────────────────
// index.html is the entry point and search.html is reached from the box in the bar rather
// than from a link, so both are exempt.
{
  const exempt = new Set(["index.html", "search.html"]);
  const orphans = pages.filter((p) => !exempt.has(p) && !linkedTo.has(p));
  note(`orphaned pages: ${n(orphans.length)}`);
  if (orphans.length) fail(`${orphans.length} page(s) nothing links to — e.g. ${orphans.slice(0, 5).join(", ")}`);
}

// ── 5. the entry point ───────────────────────────────────────────────────────
{
  const idx = path.join(SITE, "index.html");
  if (!fs.existsSync(idx)) fail("no index.html — there is nothing to double-click");
  else {
    const a = fs.readFileSync(idx);
    const b = fs.existsSync(path.join(SITE, "README.html")) ? fs.readFileSync(path.join(SITE, "README.html")) : null;
    if (!b) fail("no README.html beside index.html");
    else if (!a.equals(b)) fail("index.html is not the README — the entry point has drifted from the wiki's own front page");
    else note("entry point: index.html is byte-identical to README.html");
  }
  for (const need of ["wiki.css", "wiki.js", "search-index.js", "search.html"]) {
    if (!present.has(need)) fail(`missing ${need} — the site would open unstyled or with a dead search box`);
  }
  note(`support files: wiki.css, wiki.js, search-index.js, search.html all present`);
}

// ── report ───────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
note("\nsite verified: no absolute paths, no broken links, fragments and images resolve, nothing orphaned.");
