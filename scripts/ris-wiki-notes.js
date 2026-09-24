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

module.exports = {
  NOTES_DIR, PAGES_DIR, MARK, PLACEHOLDER, HEADING, LF, MENU_PAGE,
  pageName, extractNotes, readNote, readTeamPages,
};
