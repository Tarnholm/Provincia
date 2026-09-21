#!/usr/bin/env node
/**
 * Export the RIS wiki as a standalone static site: one .html per page, no server, no Node,
 * no install. Double-click index.html and it works.
 *
 *   node scripts/build-ris-wiki-site.js [--wiki <dir>] [--site <dir>] [--without cards,maps]
 *
 * WHY A STATIC EXPORT AND NOT AN APP. Two things fall out of one build. A folder (or a zip of
 * it) opens from `file://` on a machine with nothing installed, which is what "send it to a
 * friend" means; and the same folder is a GitHub Pages site, which is where this wiki is
 * headed anyway. Anything heavier — an Electron shell, a bundled server — buys neither.
 *
 * THE RENDERER IS NOT REIMPLEMENTED HERE. scripts/serve-ris-wiki.js exports its markdown
 * renderer, its section layout and its page shell, and this file requires them. A second
 * renderer would agree with the served one on the day it was written and drift from then on;
 * every layout decision in that file (the two-pane distribution, the dealt-across tables, the
 * scroll containers) would have to be duplicated and kept in step. So this file does exactly
 * one thing the server does not: it turns URLs that only a server can resolve into URLs a
 * plain folder can.
 *
 * WHAT HAS TO CHANGE FOR `file://`, and why each one is not optional:
 *
 *   1. Root-absolute paths. The shell writes `/README.md`, `/art/ris-mark.png` and
 *      `url(/art/ris-rule.png)`. Under `file://` a leading slash means the root of the DRIVE,
 *      so every one of those resolves to C:\README.md and the page loads with no logo, no
 *      rule under the title and a dead nav. They become paths relative to the page.
 *   2. `.md` targets. A browser shows a .md file as plain text — and there are 213,000 of
 *      these links. Rewritten to .html, fragment preserved.
 *   3. Directory indexes. `file://` has no "serve README.md for this folder" behaviour, so
 *      index.html at the root IS the README.
 *   4. Search. The served version searches on the server. There is no server here, so the
 *      title index is written out as a script and search.html filters it in the browser. A
 *      search box that silently does nothing would be worse than no search box.
 *
 * CSS AND THE PAGE SCRIPT ARE LIFTED OUT rather than inlined per page. The shell inlines
 * ~11 KB of stylesheet in every page; across the wiki's pages that is around 48 MB of the
 * same bytes repeated, on a site whose whole problem is its size. They go to wiki.css and
 * wiki.js, linked at the right depth.
 *
 * OUTPUT GOES OUTSIDE BOTH REPOSITORIES by default: C:/dev/ris-wiki-site, beside the
 * Provincia checkout rather than inside it. It is derived — every byte of it can be rebuilt
 * from the markdown in about two minutes — and it is about the same size as the wiki it is
 * built from, so committing it would roughly double the mod repo to store a second copy of
 * what is already in it. Being outside both trees is what makes that a fact rather than an
 * intention: no `git add -A` in either repo can reach it.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const QUIET = argv.includes("--quiet");
const WIKI = path.resolve(valOf("--wiki", "C:/RIS/wiki"));
const SITE = path.resolve(valOf("--site", "C:/dev/ris-wiki-site"));
// Top-level asset directories to leave out, for a build small enough to send. Named rather
// than inferred: `--without cards` drops the 104 MB of unit cards and nothing else.
const WITHOUT = new Set((valOf("--without", "") || "").split(",").map((s) => s.trim()).filter(Boolean));

const note = (s) => { if (!QUIET) console.log(s); };
const n = (x) => x.toLocaleString("en-US");

if (!fs.existsSync(WIKI)) { console.error(`wiki not found: ${WIKI}`); process.exit(2); }
if (path.resolve(SITE) === WIKI || SITE.startsWith(WIKI + path.sep)) {
  console.error(`refusing to build into the wiki itself: ${SITE}`); process.exit(2);
}

// ── the served renderer, without the server ──────────────────────────────────
// process.argv is swapped before the require. serve-ris-wiki.js parses `--out` off the real
// process.argv at load time to decide which wiki to read, so requiring it from a script that
// was itself given `--site <dir>` would be fine but `--out <dir>` would silently point the
// renderer's index and nav-existence checks at the OUTPUT directory — which does not exist
// yet, so it would exit(2) and take this process with it. Handing it an argv of our own
// making removes the coupling entirely: this script's flags cannot collide with its flags.
const viewer = (() => {
  const real = process.argv;
  process.argv = [real[0], real[1], "--out", WIKI, "--no-open"];
  try { return require("./serve-ris-wiki.js"); } finally { process.argv = real; }
})();
const { renderMarkdown, sectionise, SHELL, CSS, INDEX } = viewer;

// Team notes the team wrote in the GitHub wiki, pulled in by scripts/pull-github-wiki-notes.js
const { readNote, readTeamPages, NOTES_DIR, PAGES_DIR, LF } = require("./ris-wiki-notes.js");
const NOTES = path.resolve(valOf("--notes", NOTES_DIR));
const NOTE_SEP = LF + LF + "## Team notes" + LF + LF;
let notesMerged = 0;

// -- pages the team wrote -----------------------------------------------------
// Two kinds of team writing reach this build from the GitHub wiki, both pulled in by
// scripts/pull-github-wiki-notes.js: NOTES, appended under the marker on a generated page and
// merged into it in the render loop below; and PAGES the team created, which no generator owns
// and which therefore have no place in C:/RIS/wiki at all. Those are rendered here into
// team/, through the same shell as everything else, so a contributor's article reads as part
// of the wiki rather than as an attachment to it.
//
// THE LINKS ARE THE WHOLE PROBLEM. A teammate writing in the wiki links the way the wiki
// links -- `[[Akarnania]]`, or `/Tarnholm/ris-wiki/wiki/regions-Akarnania` -- and those flat
// names exist nowhere in this site's layout. page-map.json (written by build-github-wiki.js,
// copied into the store by the pull) is the only thing that can turn one back into a path, so
// it travels with the pages. A link that no longer resolves -- because a data regeneration
// renamed or dropped the page it pointed at -- is REPORTED and rendered as plain text: a dead
// link must not be published in silence, and one stale link in a contributor's prose must not
// stop the game data from being published either.
const TEAM_PAGES_DIR = path.resolve(valOf("--pages", PAGES_DIR));
const TEAM_MAP_FILE = path.join(TEAM_PAGES_DIR, "page-map.json");
const TEAM_MAP = fs.existsSync(TEAM_MAP_FILE)
  ? JSON.parse(fs.readFileSync(TEAM_MAP_FILE, "utf8")) : {};
const TEAM = readTeamPages(TEAM_PAGES_DIR).map((p) => ({
  name: p.name,
  md: p.md,
  rel: "team/" + p.name + ".md",
  title: (/^#\s+(.+)$/m.exec(p.md) || [, p.name.split("-").join(" ")])[1].trim(),
}));
const TEAM_HUB = "team.md";
// mapUrl checks every target against the source wiki; these pages are produced here instead,
// so without this every link to one would be reported as a missing file.
const PRODUCED_HERE = new Set(TEAM.length ? [TEAM_HUB, ...TEAM.map((p) => p.rel)] : []);

const teamUnresolved = [];    // { from, target }
let teamLinks = 0;

// A flat GitHub-wiki page name -> a root-relative target in this site, or null.
function teamTarget(flat, fromName, quiet) {
  const hash = flat.indexOf("#");
  const frag = hash >= 0 ? flat.slice(hash) : "";
  const bare = decodeURIComponent(hash >= 0 ? flat.slice(0, hash) : flat).trim();
  if (!bare) return null;
  const src = TEAM_MAP[bare];
  if (src) { teamLinks++; return "/" + src.split("\\").join("/") + frag; }
  // A link from one team page to another: those are not in the map, they are in the store.
  if (TEAM.some((t) => t.name === bare)) { teamLinks++; return "/team/" + bare + ".md" + frag; }
  if (!quiet) teamUnresolved.push({ from: fromName, target: bare });
  return null;
}

// The wiki link syntaxes the team actually has available, turned into ordinary markdown links
// pointing at this site's paths. Done on the markdown, not the rendered HTML, so the renderer
// -- the SAME renderer every generated page goes through -- only ever sees a normal link.
function resolveTeamLinks(md, fromName) {
  // [[Page]], and the two-part form. Gollum (which is what GitHub wikis run) documents
  // [[Label|Page]], MediaWiki habit writes [[Page|Label]], and contributors will write both.
  // Rather than punish whoever guesses wrong, each side is tried as the page name and whichever
  // one names a real page wins; Gollum's order is preferred when both do. Only when NEITHER
  // side resolves is the link reported and flattened to text.
  md = md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => {
    if (b === undefined) {
      const t = teamTarget(a, fromName);
      return t ? `[${a.trim()}](${t})` : a.trim();
    }
    const asGollum = teamTarget(b, fromName, true);
    if (asGollum) return `[${a.trim()}](${asGollum})`;
    const asMediaWiki = teamTarget(a, fromName, true);
    if (asMediaWiki) return `[${b.trim()}](${asMediaWiki})`;
    teamUnresolved.push({ from: fromName, target: b.trim() });
    return a.trim();
  });
  md = md.replace(/\[([^\]\n]*)\]\((?:https?:\/\/github\.com)?\/Tarnholm\/ris-wiki\/wiki\/([^)\s]+)\)/g,
    (m, label, flat) => {
      const t = teamTarget(flat, fromName);
      return t ? `[${label}](${t})` : label;
    });
  return md;
}

// The section appended to the index so the team's pages are reachable from the front door.
// Kept here beside the pages themselves rather than in the render loop: if the team has
// written nothing, nothing is appended and the index is byte-identical to before.
const TEAM_INDEX_SECTION = LF + LF + [
  "## Written by the team",
  "",
  `[Team pages](/${TEAM_HUB}) — ${TEAM.length} page${TEAM.length === 1 ? "" : "s"} written by the team in the wiki,`,
  "rather than generated from the game files.",
  "",
].join(LF);

// ── the pages ────────────────────────────────────────────────────────────────
const walk = (dir, hit) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, hit); else hit(p);
  }
};
const relOf = (abs) => path.relative(WIKI, abs).split(path.sep).join("/");

const mdPages = [];        // wiki-relative posix paths, e.g. "units/hastati.md"
const staticHtml = [];     // .html files that were already in the wiki (the sortable views)
const allFiles = [];
walk(WIKI, (p) => {
  const r = relOf(p);
  allFiles.push(r);
  if (/\.md$/i.test(r)) mdPages.push(r);
  else if (/\.html$/i.test(r)) staticHtml.push(r);
});

// ── name collisions between a page and a pre-existing .html ──────────────────
// units.md and units.html both exist, as do the region and faction pairs: the markdown page
// is the written overview, the .html is the sortable table generated beside it. Exporting
// units.md to units.html would overwrite the sortable view with the overview and nothing
// would look broken — the surviving page is perfectly good on its own — which is precisely
// the failure verify-ris-wiki.js was written after. The markdown keeps the natural name
// because that is what 213,000 links point at; the sortable view moves aside.
const RENAMED = new Map();   // "units.html" -> "units-sortable.html"
for (const h of staticHtml) {
  if (mdPages.includes(h.replace(/\.html$/i, ".md"))) {
    RENAMED.set(h, h.replace(/\.html$/i, "-sortable.html"));
  }
}

// ── url rewriting ────────────────────────────────────────────────────────────
const SKIP_URL = /^(https?:|mailto:|data:|javascript:|#|\/\/)/i;
// An attribute value built by inline JavaScript rather than written as a path: the sortable
// views emit `href="' + v.href + '"` from a template, and search.html the same. These are not
// URLs, and treating them as such reported four files "missing" that were never referenced.
const IS_JS_TEMPLATE = (v) => /['"<>]/.test(v) || v.includes("+ ") || v.includes("${");

// A target as written on `fromRel`'s page, resolved to a wiki-root-relative posix path.
function toRootRel(fromRel, target) {
  if (target.startsWith("/")) return target.slice(1);
  const dir = path.posix.dirname(fromRel);
  return path.posix.normalize(dir === "." ? target : `${dir}/${target}`);
}

// What that path is called in the built site.
function outNameOf(rootRel) {
  if (/\.md$/i.test(rootRel)) return rootRel.replace(/\.md$/i, ".html");
  return RENAMED.get(rootRel) || rootRel;
}

const assetRefs = new Map();   // wiki-relative asset path -> reference count
const missing = new Map();     // referenced path -> [pages that reference it]
const notedMissing = (rootRel, fromRel) => {
  if (!missing.has(rootRel)) missing.set(rootRel, []);
  missing.get(rootRel).push(fromRel);
};

// Rewrite one URL for a page living at `fromRel` (wiki-relative, .md or .html).
function mapUrl(fromRel, raw) {
  if (!raw || SKIP_URL.test(raw) || IS_JS_TEMPLATE(raw)) return raw;
  // The shell's search form posts to a route only the server has.
  if (raw === "/search") raw = "/search.html";
  const hash = raw.indexOf("#");
  const frag = hash >= 0 ? raw.slice(hash) : "";
  const bare = hash >= 0 ? raw.slice(0, hash) : raw;
  if (!bare) return raw;

  const rootRel = toRootRel(fromRel, decodeURIComponent(bare));
  // Produced by this script rather than copied from the wiki, so their absence from the
  // source directory is not a missing reference.
  const produced = ["search.html", "index.html", "search-index.js", "wiki.css", "wiki.js"].includes(rootRel)
    || PRODUCED_HERE.has(rootRel);
  if (!produced && !fs.existsSync(path.join(WIKI, rootRel))) notedMissing(rootRel, fromRel);
  else if (!produced && !/\.(md|html)$/i.test(rootRel)) {
    assetRefs.set(rootRel, (assetRefs.get(rootRel) || 0) + 1);
  }

  const out = outNameOf(rootRel);
  const fromDir = path.posix.dirname(fromRel);
  let rel = path.posix.relative(fromDir === "." ? "" : fromDir, out);
  if (!rel) rel = path.posix.basename(out);
  return encodeURI(rel) + frag;
}

// href/src/action attributes, and url() inside the stylesheet the shell inlines.
// Attribute values only: the pattern is anchored on an attribute name and a quote, so prose
// containing a slash is never touched.
function rewriteHtml(html, fromRel) {
  let out = html.replace(/\b(href|src|action)="([^"]*)"/g,
    (_, a, v) => `${a}="${mapUrl(fromRel, v)}"`);
  out = out.replace(/url\((['"]?)([^)'"]+)\1\)/g,
    (m, q, v) => (SKIP_URL.test(v) ? m : `url(${q}${mapUrl(fromRel, v)}${q})`));
  return out;
}

// ── the shell, taken apart once ──────────────────────────────────────────────
// CSS and the page script are the same bytes on every page, so they are written once and
// linked. Both are located by matching what the shell actually produced rather than by
// assuming its text: if serve-ris-wiki.js changes its script, this still finds it, and if it
// ever stops having one the build says so instead of silently shipping a page with no theme
// toggle. The stylesheet is matched against the exported CSS constant, which is the same
// value the shell interpolates.
const probe = SHELL("probe", "<p>probe</p>", "/README.md");
const styleTag = `<style>${CSS}</style>`;
if (!probe.includes(styleTag)) {
  console.error("the page shell no longer inlines the exported CSS — stylesheet extraction would be wrong");
  process.exit(2);
}
const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(probe);
if (!scriptMatch) {
  console.error("the page shell no longer carries an inline script — the theme toggle would be lost");
  process.exit(2);
}
const SHELL_SCRIPT = scriptMatch[0];

// The extra behaviour the static site needs on every page: a search box that goes somewhere,
// and a localStorage that cannot take the theme toggle down with it. Appended to the shell's
// own script so there is one file, not three.
//
// The localStorage guard is not defensive padding. Under `file://` each document is its own
// opaque origin, and a browser is entitled to refuse storage to it — Chromium does when
// started with certain policies, and the shell's script reads localStorage on its FIRST line,
// outside any try. A throw there kills the whole block: no theme toggle, and no "/" to focus
// search. The shim installs a memory-backed stand-in only when the real one is unusable, so
// the page degrades to "theme resets when you navigate" instead of "nothing works".
const EXTRA_JS = `
// ── static-export additions ──────────────────────────────────────────────────
(function(){
  var base = window.RIS_BASE || "";
  var form = document.querySelector(".top form");
  if (form) {
    var input = form.querySelector("input");
    // On a web host the plain GET works: search.html?q=… . Under file:// a form GET does not
    // reliably carry a query string, so the submit is intercepted and the term travels in the
    // hash, which every browser keeps. search.html reads whichever arrived.
    form.addEventListener("submit", function(e){
      var q = (input && input.value || "").trim();
      if (!q) { e.preventDefault(); return; }
      if (location.protocol === "file:") {
        e.preventDefault();
        location.href = base + "search.html#q=" + encodeURIComponent(q);
      }
    });
  }
})();

// ── team notes, fetched at view time ─────────────────────────────────────────
// A note written on the GitHub wiki reaches this site through a CI job that CANNOT rebuild
// the site: the 222 MB of RIS source a rebuild needs lives on rtris.org, which a GitHub
// runner cannot reach. So the job publishes each note as a small pre-rendered fragment and
// the page fetches its own when it loads. wiki-notes/index.json lists which pages have one,
// so a page with no note makes no second request, and the whole thing is skipped when a full
// local rebuild has already merged the note into the HTML.
(function () {
  try {
    if (location.protocol === "file:") return;              // an offline copy is a snapshot
    if (document.getElementById("team-notes")) return;      // a rebuild already merged it
    var main = document.querySelector("main");
    if (!main || typeof fetch !== "function") return;

    // Declared here, not borrowed: the shell's own copy lives inside a different IIFE, so
    // reading it from this one is a ReferenceError — which this block's try/catch swallows,
    // leaving no console error and a page that simply never shows its note.
    var base = window.RIS_BASE || "";
    var rootPath = new URL(base || "./", location.href).pathname;
    var here = decodeURIComponent(location.pathname);
    if (here.indexOf(rootPath) !== 0) return;
    var key = here.slice(rootPath.length).replace(/\.html?$/, "");
    if (!key || key === "index") key = "README";

    fetch(base + "wiki-notes/index.json", { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (idx) {
        if (!idx || !idx[key]) return null;
        return fetch(base + "wiki-notes/" + encodeURIComponent(idx[key]) + ".html", { cache: "no-cache" });
      })
      .then(function (r) { return r && r.ok ? r.text() : null; })
      .then(function (html) {
        if (!html) return;
        var sec = document.createElement("section");
        sec.className = "sec";
        sec.innerHTML = '<h2 id="team-notes">Team notes</h2>' + html;
        main.appendChild(sec);
        var jump = document.querySelector(".jump");
        if (jump && !jump.querySelector('a[href="#team-notes"]')) {
          var a = document.createElement("a");
          a.href = "#team-notes";
          a.textContent = "Team notes";
          jump.appendChild(a);
        }
      })
      .catch(function () {});   // a missing notes folder is normal, not an error
  } catch (e) {}
})();
`;
const STORAGE_SHIM = `<script>
// See build-ris-wiki-site.js: file:// documents may be denied localStorage, and the shell's
// script touches it before any try/catch. A memory stand-in keeps the rest of the page alive.
(function(){try{var k="__ris";localStorage.setItem(k,"1");localStorage.removeItem(k);}catch(e){
var m={};try{Object.defineProperty(window,"localStorage",{value:{getItem:function(k){return k in m?m[k]:null;},
setItem:function(k,v){m[k]=String(v);},removeItem:function(k){delete m[k];}},configurable:true});}catch(e2){}}})();
</script>`;

// The output directory is also the git clone that publishes to GitHub Pages
// (Tarnholm/ris-wiki), so what this build removes from it is removed from the published site.
//
// IT USED TO CLEAR THE WHOLE TREE except a KEEP set, and that cost a teammate their file:
// someone committed `test` at the site root, a rebuild swept it away because it was not in
// KEEP, and `git add -A` published the deletion (73dae8c4). KEEP could only ever list the
// files whoever edited this script had thought of; a person adding a file to a repo they can
// write to has not consulted that list.
//
// So the build now deletes only what the build itself made. .build-manifest.json records
// every path the previous run wrote; anything in it that this run did not write is stale
// output and goes. Anything NOT in it was put there by someone else and is reported, never
// removed -- the same rule the other scripts in this family follow. --prune-unknown deletes
// those too, for the rare case of a genuinely abandoned directory.
const MANIFEST = ".build-manifest.json";
const PRUNE_UNKNOWN = argv.includes("--prune-unknown");
// Still never touched, whoever wrote them: git's own directory, the Pages marker, the
// workflow that publishes notes, and the notes CI has already published.
const KEEP = new Set([".git", ".nojekyll", ".github", "wiki-notes", MANIFEST]);

const previous = (() => {
  try { return new Set(JSON.parse(fs.readFileSync(path.join(SITE, MANIFEST), "utf8")).files); }
  catch { return null; }
})();
const written = new Set();   // site-relative posix paths this run produced
const wrote = (abs) => {
  written.add(path.relative(SITE, abs).split(path.sep).join("/"));
  return abs;
};

fs.mkdirSync(SITE, { recursive: true });
// The stylesheet gets the same URL rewriting the pages do, and it is written AT THE SITE ROOT,
// so its one url() is resolved from there. Writing the raw constant instead left
// `url(/art/ris-rule.png)` in it, which under file:// asks for C:\art\ris-rule.png — so every
// page in the wiki lost the mod's rule under its title and nothing else looked wrong. A real
// browser found that; no amount of reading the HTML would have, because the HTML was correct.
fs.writeFileSync(wrote(path.join(SITE, "wiki.css")), rewriteHtml(CSS, "wiki.css"));
fs.writeFileSync(wrote(path.join(SITE, "wiki.js")),
  SHELL_SCRIPT.replace(/^<script>|<\/script>$/g, "") + EXTRA_JS);

const writeOut = (rel, text) => {
  const abs = path.join(SITE, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(wrote(abs), text);
};

// Turn one shell-rendered page into a file:// -safe document.
function finish(html, fromRel) {
  const depth = path.posix.dirname(fromRel) === "." ? "" : "../".repeat(fromRel.split("/").length - 1);
  let out = rewriteHtml(html, fromRel);
  // The stylesheet was rewritten in place above (its url() now points at the right depth),
  // so it is matched here in its rewritten form.
  const rewrittenStyle = `<style>${rewriteHtml(CSS, fromRel)}</style>`;
  out = out.replace(rewrittenStyle,
    `<link rel="stylesheet" href="${depth}wiki.css">\n<script>window.RIS_BASE=${JSON.stringify(depth)}</script>`);
  out = out.replace(SHELL_SCRIPT, `${STORAGE_SHIM}\n<script src="${depth}wiki.js"></script>`);
  return out;
}

// ── render every page ────────────────────────────────────────────────────────
let rendered = 0;
for (const rel of mdPages) {
  let md = fs.readFileSync(path.join(WIKI, rel), "utf8");

  // Team notes written by the team in the GitHub wiki, pulled into the notes store by
  // scripts/pull-github-wiki-notes.js. They live outside C:/RIS/wiki because the
  // generators rewrite that wholesale; merging them here is what puts them on the site.
  const note = readNote(rel, NOTES);
  if (note) { md = md.trimEnd() + NOTE_SEP + note + "\n"; notesMerged++; }
  // The index is the only page no generator will ever link the team's pages from, and a page
  // nothing links to is a page nobody finds. Appended to the markdown rather than to the HTML
  // so it picks up the same section treatment as everything else on the index.
  if (rel === "README.md" && TEAM.length) md = md.trimEnd() + TEAM_INDEX_SECTION;
  const title = (/^#\s+(.+)$/m.exec(md) || [, path.basename(rel)])[1];
  // The toc has to be kept and handed on, not created in the argument list: renderMarkdown fills
  // the array it is given, and SHELL builds the bar's jump strip out of it. Passing a throwaway
  // array built every page in the site without its section links — the server had the same bug.
  const toc = [];
  const html = SHELL(title, sectionise(renderMarkdown(md, toc), rel), "/" + rel, toc);
  writeOut(rel.replace(/\.md$/i, ".html"), finish(html, rel));
  rendered++;
}
note(`pages rendered: ${n(rendered)} (from ${n(mdPages.length)} .md files under ${WIKI})`);
note(`team notes merged: ${n(notesMerged)} (from ${NOTES})`);

// ── the team's own pages, and the hub that lists them ────────────────────────
// Rendered after the generated corpus so that a link FROM one of them to a game page is
// resolved against the wiki that was just built, not against whatever was there last time.
let teamRendered = 0;
if (TEAM.length) {
  for (const p of TEAM) {
    const md = resolveTeamLinks(p.md, p.name);
    const toc = [];
    const html = SHELL(p.title, sectionise(renderMarkdown(md, toc)), "/" + p.rel, toc);
    writeOut(p.rel.replace(/\.md$/i, ".html"), finish(html, p.rel));
    INDEX.push({ title: p.title, rel: "/" + p.rel, section: "team" });
    teamRendered++;
  }
  const hubMd = [
    "# Team pages",
    "",
    "Written by the team in [the wiki](https://github.com/Tarnholm/ris-wiki/wiki), not generated",
    "from the game files. Everything else on this site is rebuilt from the RIS data on every",
    "update; these pages are not, and are only ever changed by the person who writes them.",
    "",
    ...TEAM.map((p) => `- [${p.title}](/${p.rel})`),
    "",
  ].join(LF);
  const hubToc = [];
  const hubHtml = SHELL("Team pages", sectionise(renderMarkdown(hubMd, hubToc)), "/" + TEAM_HUB, hubToc);
  writeOut(TEAM_HUB.replace(/\.md$/i, ".html"), finish(hubHtml, TEAM_HUB));
  INDEX.push({ title: "Team pages", rel: "/" + TEAM_HUB, section: "team" });
}
note(`team pages: ${n(teamRendered)} rendered (from ${TEAM_PAGES_DIR}), ${n(teamLinks)} links into the game data resolved`);

// A link a contributor wrote that no longer resolves. Reported in full and never fatal: the
// usual cause is a data regeneration renaming the page it pointed at, and the game data must
// still publish. This is the one check nothing else does -- verify-ris-wiki.js reads only the
// generated corpus, so without this a renamed region silently dead-ends a teammate's prose.
if (teamUnresolved.length) {
  console.log("");
  console.log(`⚠ ${teamUnresolved.length} link${teamUnresolved.length === 1 ? "" : "s"} in team-written pages no longer resolve — rendered as plain text:`);
  for (const u of teamUnresolved.slice(0, 30)) console.log(`  ${u.from}  ->  ${u.target}`);
  if (teamUnresolved.length > 30) console.log(`  ... and ${teamUnresolved.length - 30} more`);
  console.log("");
}

// The root README is the entry point. `file://` will not serve a folder's README for you, so
// index.html is a byte copy of it — same directory, so every relative link in it still lands.
if (!fs.existsSync(path.join(SITE, "README.html"))) {
  console.error("no README.md at the wiki root — the site would have no index page");
  process.exit(2);
}
fs.copyFileSync(path.join(SITE, "README.html"), wrote(path.join(SITE, "index.html")));

// ── the sortable views ───────────────────────────────────────────────────────
// Hand-generated HTML, not markdown, and they carry their table data inline as JSON with
// `"href":"units/x.md"` in it. Rewriting attributes alone would leave every row in those
// tables pointing at a .md file the browser shows as text, so the embedded data is rewritten
// too. Counted, so a change to how those files are generated shows up as a count of zero
// rather than as three quietly broken pages.
let embeddedRefs = 0;
for (const rel of staticHtml) {
  let html = fs.readFileSync(path.join(WIKI, rel), "utf8");
  html = html.replace(/"(href|img)":"([^"]+)"/g, (m, k, v) => {
    embeddedRefs++;
    return `"${k}":"${mapUrl(rel, v)}"`;
  });
  html = rewriteHtml(html, rel);
  writeOut(outNameOf(rel), html);
}
note(`sortable views: ${n(staticHtml.length)} copied (${n(RENAMED.size)} renamed to avoid a page of the same name), ${n(embeddedRefs)} embedded row links rewritten`);

// ── search ───────────────────────────────────────────────────────────────────
// The served wiki searches on the server. There is no server here, so the same index — title
// and path, which is all the server had — is written out and filtered in the browser. It is
// loaded ONLY by search.html: putting it in the shell would add its whole weight to every one
// of the wiki's pages to serve a box most readers never type in.
const searchRows = INDEX.map((e) => {
  const rootRel = e.rel.replace(/^\//, "");
  return [e.title, outNameOf(rootRel), e.section];
});
fs.writeFileSync(wrote(path.join(SITE, "search-index.js")),
  `window.RIS_PAGES=${JSON.stringify(searchRows)};\n`);

const SEARCH_BODY = `<h1>Search</h1>
<p id="q-note">Type in the box above and press Enter.</p>
<ul class="res" id="q-res"></ul>
<script src="search-index.js"></script>
<script>
(function(){
  // Ranked the same way the server ranked: exact title, then prefix, then substring, then
  // path. Same order in, same order out, so a reader who used the preview sees the same list.
  function search(q){
    var needle = q.trim().toLowerCase(), hits = [];
    if (!needle) return hits;
    for (var i = 0; i < window.RIS_PAGES.length; i++){
      var e = window.RIS_PAGES[i], t = e[0].toLowerCase(), s = -1;
      if (t === needle) s = 0;
      else if (t.indexOf(needle) === 0) s = 1;
      else if (t.indexOf(needle) >= 0) s = 2;
      else if (e[1].toLowerCase().indexOf(needle) >= 0) s = 3;
      if (s >= 0) hits.push([s, e]);
    }
    hits.sort(function(a,b){ return a[0]-b[0] || a[1][0].localeCompare(b[1][0]); });
    return hits.slice(0, 200).map(function(h){ return h[1]; });
  }
  function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function term(){
    // ?q= is what a form GET produces on a web host; #q= is what the file:// path uses.
    var m = /[?&]q=([^&]*)/.exec(location.search) || /[#&]q=([^&]*)/.exec(location.hash);
    return m ? decodeURIComponent(m[1].replace(/\\+/g, " ")) : "";
  }
  function run(){
    var q = term(), note = document.getElementById("q-note"), res = document.getElementById("q-res");
    var box = document.querySelector(".top input");
    if (box) box.value = q;
    if (!q){ note.textContent = "Type in the box above and press Enter."; res.innerHTML = ""; return; }
    var hits = search(q);
    document.title = "Search: " + q + " — RIS wiki";
    note.innerHTML = hits.length
      ? hits.length + (hits.length === 200 ? "+" : "") + " page" + (hits.length === 1 ? "" : "s") + " matching <code>" + esc(q) + "</code>."
      : "Nothing matches <code>" + esc(q) + "</code>.";
    res.innerHTML = hits.map(function(h){
      return '<li><a href="' + h[1] + '">' + esc(h[0]) + '</a> <span class="sec">' + esc(h[2]) + '</span></li>';
    }).join("");
  }
  addEventListener("hashchange", run);
  run();
})();
</script>`;
// Rendered through the same shell as every other page, so the bar, nav, crumbs and theme are
// the page's own rather than a second layout that has to be kept in step.
writeOut("search.html", finish(SHELL("Search", SEARCH_BODY, "/search.html"), "search.html"));
note(`search: client-side over ${n(searchRows.length)} page titles (search-index.js, ${n(fs.statSync(path.join(SITE, "search-index.js")).size)} bytes)`);

// ── assets ───────────────────────────────────────────────────────────────────
// Copied because a page REFERENCES them, not because they are in the folder. The wiki carries
// art nothing points at, and shipping it is pure weight in a build whose size is the whole
// question.
let copied = 0, copiedBytes = 0, skipped = 0, skippedBytes = 0, caseMismatch = 0;
const caseSamples = [];
// Real on-disk names per directory, so a reference whose case differs from the file can be
// caught. Windows does not care; GitHub Pages runs on Linux and serves a 404, so a build that
// looks perfect here would lose images the moment it is published.
const realNames = new Map();
const realNameOf = (rootRel) => {
  const dir = path.posix.dirname(rootRel);
  if (!realNames.has(dir)) {
    let names = new Set();
    try { names = new Set(fs.readdirSync(path.join(WIKI, dir))); } catch { /* missing dir */ }
    realNames.set(dir, names);
  }
  return realNames.get(dir).has(path.posix.basename(rootRel));
};

for (const rootRel of assetRefs.keys()) {
  const top = rootRel.split("/")[0];
  const src = path.join(WIKI, rootRel);
  const size = fs.statSync(src).size;
  if (!realNameOf(rootRel)) {
    caseMismatch++;
    if (caseSamples.length < 5) caseSamples.push(rootRel);
  }
  if (WITHOUT.has(top)) { skipped++; skippedBytes += size; continue; }
  const dst = path.join(SITE, rootRel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, wrote(dst));
  copied++; copiedBytes += size;
}

// Present but unreferenced: in the wiki, pointed at by nothing, so not shipped.
const referenced = new Set([...assetRefs.keys()]);
const isPage = (r) => /\.(md|html)$/i.test(r);
const unreferenced = allFiles.filter((r) => !isPage(r) && !referenced.has(r));
const byDir = new Map();
for (const r of unreferenced) {
  const top = r.includes("/") ? r.split("/")[0] : "(root)";
  byDir.set(top, (byDir.get(top) || 0) + 1);
}

note(`assets referenced: ${n(assetRefs.size)} distinct files, ${n([...assetRefs.values()].reduce((a, b) => a + b, 0))} references`);
note(`assets copied:     ${n(copied)} (${(copiedBytes / 1048576).toFixed(1)} MB)`);
if (WITHOUT.size) note(`assets left out:   ${n(skipped)} (${(skippedBytes / 1048576).toFixed(1)} MB) by --without ${[...WITHOUT].join(",")}`);
note(`referenced but missing: ${n(missing.size)}${missing.size ? " — e.g. " + [...missing.keys()].slice(0, 5).join(", ") : ""}`);
note(`present but unreferenced: ${n(unreferenced.length)}${unreferenced.length ? " — " + [...byDir].sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d} ${n(c)}`).join(", ") : ""}`);
note(`case-mismatched references: ${caseMismatch}${caseSamples.length ? " — e.g. " + caseSamples.join(", ") : ""} (would 404 on GitHub Pages, which is case-sensitive)`);

// No OPEN-ME.txt is written. The wiki is read in the browser at
// https://tarnholm.github.io/ris-wiki/ and edited in the browser at
// https://github.com/Tarnholm/ris-wiki/wiki — there is no local step to explain.
const openMe = path.join(SITE, "OPEN-ME.txt");
if (fs.existsSync(openMe)) fs.unlinkSync(openMe);

// ── clean up after the PREVIOUS build, and nothing else ──────────────────────
// The only files this may delete are ones a previous run of this script wrote and this run
// did not: a page whose source was renamed, an asset no longer referenced. A file nobody here
// made -- something a person committed to the Pages repo by hand -- is reported and left
// exactly where it is. That is the whole rule, and it is enforced by the manifest rather than
// by a list of names someone has to remember to update.
const walkSite = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dir === SITE && KEEP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSite(p, acc); else acc.push(path.relative(SITE, p).split(path.sep).join("/"));
  }
  return acc;
};
const onDisk = walkSite(SITE);
let removed = 0, removedBytes = 0;
const foreign = [];
for (const rel of onDisk) {
  if (written.has(rel)) continue;
  const mine = previous ? previous.has(rel) : false;
  if (!mine) { foreign.push(rel); continue; }
  const abs = path.join(SITE, rel);
  try { removedBytes += fs.statSync(abs).size; } catch { /* size is for the report only */ }
  fs.rmSync(abs, { force: true });
  removed++;
}
// Empty directories left behind by those deletions, deepest first. A directory that still
// holds someone else's file is not empty and so is never touched.
for (const d of [...new Set(onDisk.map((r) => path.posix.dirname(r)))].filter((d) => d !== ".").sort((a, b) => b.length - a.length)) {
  const abs = path.join(SITE, d);
  try { if (fs.readdirSync(abs).length === 0) fs.rmdirSync(abs); } catch { /* not empty, or gone */ }
}

let prunedForeign = 0;
if (foreign.length && PRUNE_UNKNOWN) {
  for (const rel of foreign) { fs.rmSync(path.join(SITE, rel), { force: true }); prunedForeign++; }
}

fs.writeFileSync(path.join(SITE, MANIFEST),
  JSON.stringify({ built: new Date().toISOString(), files: [...written].sort() }, null, 0) + "\n");

note(`stale output removed: ${n(removed)} file(s)${removedBytes ? ` (${(removedBytes / 1048576).toFixed(1)} MB)` : ""}${previous ? "" : " — no manifest yet, so nothing was treated as stale on this run"}`);
if (foreign.length) {
  console.log("");
  console.log(`${foreign.length} file(s) in the site that this build did not write — LEFT IN PLACE${PRUNE_UNKNOWN ? ", then deleted because --prune-unknown was passed" : ""}:`);
  for (const f of foreign.slice(0, 20)) console.log("   " + f);
  if (foreign.length > 20) console.log(`   ... and ${foreign.length - 20} more`);
  if (!PRUNE_UNKNOWN) console.log("   (someone added these by hand; they are published as they are)");
  console.log("");
}

// ── totals ───────────────────────────────────────────────────────────────────
let files = 0, bytes = 0;
walk(SITE, (p) => { files++; bytes += fs.statSync(p).size; });
note(`\nsite: ${n(files)} files, ${(bytes / 1048576).toFixed(1)} MB at ${SITE}`);
note(`open ${path.join(SITE, "index.html")}`);

if (missing.size) {
  console.error(`\n${missing.size} referenced file(s) do not exist in the wiki:`);
  for (const [t, from] of [...missing].slice(0, 20)) console.error(`  ${t}  <- ${from[0]}${from.length > 1 ? ` (+${from.length - 1} more)` : ""}`);
  process.exit(1);
}
