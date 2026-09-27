// Shared contract between the three scripts that move "Team notes" around:
//   build-github-wiki.js       notes store -> GitHub wiki pages
//   pull-github-wiki-notes.js  GitHub wiki pages -> notes store
//   build-ris-wiki-site.js     notes store -> the styled site
//
// The generators own C:/RIS/_wiki and rewrite it wholesale, so notes CANNOT
// live there. They live beside it in C:/RIS/_wiki-notes, one flat file per
// wiki page name, which is also the RIS repo so the team shares them.
const fs = require('fs'), path = require('path');

const NOTES_DIR = 'C:/RIS/_wiki-notes';
// Whole pages the team CREATED in the wiki, as opposed to notes they appended to a generated
// page. They have no TEAM-NOTES marker because no generator ever wrote them, and they are
// absent from page-map.json for the same reason -- which is exactly how they are recognised.
// Same reasoning as the notes store for why they cannot live in C:/RIS/_wiki: the
// generators rewrite that wholesale. Both stores sit in the RIS repo, so the team shares them.
const PAGES_DIR = 'C:/RIS/_wiki-pages';
const MARK = '<!-- TEAM-NOTES -- everything below this line is kept when the wiki is re-imported -->';
const PLACEHOLDER = 'Nothing yet. Click **Edit** above and write below the line -- it will survive the next import.';
const HEADING = 'Team notes';

const BSLASH = String.fromCharCode(92);
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const NEWLINE_RE = new RegExp(CR + '?' + LF);
const HEADING_RE = /^#{1,6}\s*Team notes\s*$/i;

// 'regions/Akarnania.md' or 'regions\Akarnania.md' -> 'regions-Akarnania'
// (the GitHub wiki namespace is flat, so the folder becomes a prefix)
function pageName(rel) {
  return rel.replace(/\.md$/, '').split(BSLASH).join('/').split('/').join('-');
}

// Everything a human wrote below MARK, minus our own heading and placeholder line.
function extractNotes(pageText) {
  const i = pageText.indexOf(MARK);
  if (i === -1) return null;
  const kept = [];
  for (const l of pageText.slice(i + MARK.length).split(NEWLINE_RE)) {
    if (HEADING_RE.test(l.trim())) continue;
    if (l.includes(PLACEHOLDER)) continue;
    kept.push(l);
  }
  const tail = kept.join(LF).trim();
  return tail || null;
}

// The note for a page, or null. Accepts 'regions/Akarnania.md' or 'regions-Akarnania'.
function readNote(rel, notesDir) {
  const f = path.join(notesDir || NOTES_DIR, pageName(rel) + '.md');
  if (!fs.existsSync(f)) return null;
  const t = fs.readFileSync(f, 'utf8').trim();
  return t || null;
}

// A team-written page, as stored: the markdown exactly as the author left it in the wiki.
// A missing store is simply "no team pages", not an error: it is created on the first pull.
// The wiki page the team edits to add sections and links to the site's side menu. It is read
// by sync-wiki-notes.js (-> wiki-notes/menu.json) and is not itself a page on the site.
const MENU_PAGE = 'Site-Menu';

function readTeamPages(pagesDir) {
  const dir = pagesDir || PAGES_DIR;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== MENU_PAGE + '.md')
    .sort()
    .map((f) => ({ name: f.replace(/\.md$/, ''), md: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

// ── community guides ─────────────────────────────────────────────────────────
// A team page named "Guide-..." is a community guide (asked for 2026-09-27). Its first lines
// under the title may say which factions it is about, a one-line summary and who wrote it:
//
//   # Playing Carthage
//
//   Factions: Carthage, Gades
//   Summary: Surviving the first ten turns against Rome.
//   Author: Wopper
//
// Those lines drive the Community guides list (wiki-notes/guides.json, written by both
// sync-wiki-notes.js and build-ris-wiki-site.js) and become the guide's header on its page.
const GUIDE_PREFIX = 'Guide-';
const META_RE = /^(factions?|summary|author|by)\s*:\s*(.*)$/i;

function isGuide(name) { return String(name).indexOf(GUIDE_PREFIX) === 0; }

function parseGuide(name, md) {
  const lines = String(md).replace(/\r\n/g, LF).split(LF);
  const meta = { factions: [], summary: '', author: '' };
  let title = null;
  const body = [];
  let inHead = true;   // meta lines count only before the first section heading or paragraph
  for (const l of lines) {
    const t = l.trim();
    let m;
    if (title === null && (m = /^#\s+(.+)$/.exec(t))) { title = m[1].trim(); continue; }
    if (inHead && (m = META_RE.exec(t))) {
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k.indexOf('faction') === 0) meta.factions = v.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
      else if (k === 'summary') meta.summary = v;
      else meta.author = v;
      continue;
    }
    if (inHead && t && !/^<!--/.test(t)) inHead = false;
    body.push(l);
  }
  // The template's instructions sit in an HTML comment, which the site's renderer would print
  // as text; a reader never sees them.
  return { name, title: title || String(name).slice(GUIDE_PREFIX.length).replace(/-/g, ' '), ...meta,
    body: body.join(LF).replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim() };
}

// Faction name or token -> token, from [token, title] pairs (a wiki clone's factions-*.md, or
// the generated factions/*.md). "Carthage", "carthage" and "Carthaginian Empire" all work if
// they are the token or the page title; anything else stays a plain name.
function factionResolver(pairs) {
  const byKey = new Map();
  for (const [tok, title] of pairs) {
    byKey.set(tok.toLowerCase(), tok);
    if (title) byKey.set(title.toLowerCase(), tok);
  }
  return (n) => byKey.get(String(n).trim().toLowerCase()) || null;
}

// The guide's page: the title, a header line (emblems + faction links, author, summary), then
// its body. `root` is the path from the guide's page to the site root ("../" from team/).
function guideMarkdown(g, resolve, root, ext) {
  const X = ext || ".md";
  const esc = (t) => String(t).replace(/</g, '&lt;');
  const facs = g.factions.map((n) => {
    const tok = resolve(n);
    return tok
      ? `[<img src="${root}symbols/${tok}.png" alt="" width="24" height="24" style="vertical-align:middle"> ${esc(n)}](${root}factions/${tok}${X})`
      : esc(n);
  });
  const head = [
    facs.length ? `**For:** ${facs.join(' · ')}` : null,
    g.author ? `**By:** ${esc(g.author)}` : null,
  ].filter(Boolean).join(' · ');
  return `# ${g.title}\n\n${head ? head + '\n\n' : ''}${g.summary ? `> ${esc(g.summary)}\n\n` : ''}${g.body}\n\n[← all community guides](${root}community-guides.html)\n`;
}

// Links a writer makes on the GitHub wiki, turned into site links: [[Page]], [[Label|Page]] (or
// [[Page|Label]]), and [Label](Page-name), where Page is a wiki page name. `target(name)`
// returns the site path for a wiki page name (without extension) or null; unknown links are
// left as written. Used by sync-wiki-notes.js, which publishes team pages between full builds.
function resolveWikiLinks(md, target, root, ext) {
  const to = (name) => { const t = target(String(name).trim().replace(/ /g, '-')); return t ? root + t + ext : null; };
  md = md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => {
    if (b === undefined) { const t = to(a); return t ? '[' + a.trim() + '](' + t + ')' : a.trim(); }
    const g = to(b); if (g) return '[' + a.trim() + '](' + g + ')';
    const w = to(a); return w ? '[' + b.trim() + '](' + w + ')' : a.trim();
  });
  return md.replace(/\[([^\]\n]*)\]\(([A-Za-z0-9_%-][^)\s/:.#]*)(#[^)\s]*)?\)/g, (m, label, name, frag) => {
    const t = to(decodeURIComponent(name)); return t ? '[' + label + '](' + t + (frag || '') + ')' : m;
  });
}

// The list the Community guides page reads.
function guideList(pages, resolve) {
  return pages.filter((p) => isGuide(p.name)).map((p) => {
    const g = parseGuide(p.name, p.md);
    return { page: p.name, title: g.title, summary: g.summary, author: g.author,
      factions: g.factions.map((n) => ({ n, t: resolve(n) })) };
  }).sort((a, b) => a.title.localeCompare(b.title));
}

module.exports = {
  NOTES_DIR, PAGES_DIR, MARK, PLACEHOLDER, HEADING, LF, MENU_PAGE,
  pageName, extractNotes, readNote, readTeamPages,
  GUIDE_PREFIX, isGuide, parseGuide, factionResolver, guideMarkdown, guideList, resolveWikiLinks,
};
