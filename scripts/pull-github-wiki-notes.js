#!/usr/bin/env node
// Pull everything the TEAM wrote in the GitHub wiki back onto this machine, so
// build-ris-wiki-site.js can put it on the styled site and a regeneration cannot
// lose it. Two kinds of team writing, two stores:
//
//   Team notes   appended under the TEAM-NOTES marker on a GENERATED page
//                -> C:/RIS/RIS/wiki-notes/<page>.md   (the note only)
//   Team pages   a page the team CREATED, which no generator owns
//                -> C:/RIS/RIS/wiki-pages/<page>.md   (the whole page)
//
//   node scripts/pull-github-wiki-notes.js <wiki-clone> [notes-dir] [--pages <dir>] [--prune]
//
// Round trip:
//   teammate clicks Edit at github.com/Tarnholm/ris-wiki/wiki  ->  this script
//   ->  npm run wiki:site  ->  tarnholm.github.io/ris-wiki/
//
// HOW A TEAM PAGE IS RECOGNISED, and why it is not guesswork: build-github-wiki.js writes
// page-map.json into the wiki listing every page it generated. A page absent from that map
// was created by a person, because nothing else can put a page there. The marker alone is
// not enough to tell them apart -- a generated page whose notes were deleted also has no
// note -- which is why the map is required rather than optional.
const fs = require('fs'), path = require('path');
const { NOTES_DIR, PAGES_DIR, extractNotes, pageName } = require('./ris-wiki-notes.js');

const raw = process.argv.slice(2);
const PRUNE = raw.includes('--prune');
const valOf = (f, d) => { const i = raw.indexOf(f); return i >= 0 ? raw[i + 1] : d; };
const PAGES = path.resolve(valOf('--pages', PAGES_DIR));
const positional = raw.filter((a, i) => !a.startsWith('--') && raw[i - 1] !== '--pages');
const CLONE = positional[0];
const NOTES = path.resolve(positional[1] || NOTES_DIR);

if (!CLONE || !fs.existsSync(CLONE)) {
  console.error('usage: node scripts/pull-github-wiki-notes.js <wiki-clone> [notes-dir] [--pages <dir>] [--prune]');
  console.error('clone it with: git clone https://github.com/Tarnholm/ris-wiki.wiki.git');
  process.exit(1);
}

// Absent map = every page would look team-written, and the next site build would publish
// 4,332 duplicates of the generated wiki. Refuse instead.
const mapFile = path.join(CLONE, 'page-map.json');
if (!fs.existsSync(mapFile)) {
  console.error('page-map.json missing from the wiki clone — re-run build-github-wiki.js and push it.');
  console.error('Without it a generated page cannot be told from one the team wrote.');
  process.exit(2);
}
const PAGE_MAP = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const isGenerated = (page) => Object.prototype.hasOwnProperty.call(PAGE_MAP, page);

fs.mkdirSync(NOTES, { recursive: true });
fs.mkdirSync(PAGES, { recursive: true });

const beforeNotes = new Set(fs.readdirSync(NOTES).filter((f) => f.endsWith('.md')));
const beforePages = new Set(fs.readdirSync(PAGES).filter((f) => f.endsWith('.md')));
let written = 0, unchanged = 0, cleared = 0;
let pagesWritten = 0, pagesUnchanged = 0, pagesCleared = 0;
const touchedNotes = new Set(), touchedPages = new Set();

const writeIfChanged = (dest, text) => {
  const prev = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8').trim() : null;
  if (prev === text.trim()) return 'same';
  fs.writeFileSync(dest, text.trimEnd() + '\n');
  return prev === null ? 'new' : 'updated';
};

for (const f of fs.readdirSync(CLONE)) {
  if (!f.endsWith('.md') || f.startsWith('_')) continue;
  const page = pageName(f);
  const text = fs.readFileSync(path.join(CLONE, f), 'utf8');

  // Home mirrors README; notes belong on README, and Home is generated, never team-written.
  if (page === 'Home') continue;

  if (!isGenerated(page)) {
    // A whole page the team wrote. Stored verbatim -- there is no generated part to strip.
    touchedPages.add(page + '.md');
    const r = writeIfChanged(path.join(PAGES, page + '.md'), text);
    if (r === 'same') { pagesUnchanged++; continue; }
    pagesWritten++;
    console.log((r === 'new' ? 'new page ' : 'upd page ') + page);
    continue;
  }

  const note = extractNotes(text);
  if (!note) continue;
  touchedNotes.add(page + '.md');
  const r = writeIfChanged(path.join(NOTES, page + '.md'), note);
  if (r === 'same') { unchanged++; continue; }
  written++;
  console.log((r === 'new' ? 'new note ' : 'upd note ') + page);
}

// Anything in a store with nothing matching in the wiki is REPORTED, never removed: it may
// be a page not yet imported, or something someone is mid-way through moving. Deleting is
// opt-in, because losing written prose is not a recoverable mistake.
const sweep = (before, touched, dir, label) => {
  const orphans = [...before].filter((f) => !touched.has(f));
  let removed = 0;
  for (const f of orphans) {
    if (!PRUNE) { console.log('orphan   ' + f.replace(/\.md$/, '') + '  (' + label + ', kept)'); continue; }
    fs.unlinkSync(path.join(dir, f));
    removed++;
    console.log('removed  ' + f.replace(/\.md$/, ''));
  }
  return { orphans, removed };
};
// The map travels with the pages store. The site build needs it to turn a wiki link written
// by a teammate ("/Tarnholm/ris-wiki/wiki/regions-Akarnania") back into the site's own path,
// and the build must not depend on a wiki clone being present on the machine that runs it.
fs.copyFileSync(mapFile, path.join(PAGES, 'page-map.json'));

const noteSweep = sweep(beforeNotes, touchedNotes, NOTES, 'note');
const pageSweep = sweep(beforePages, touchedPages, PAGES, 'page');
cleared = noteSweep.removed;
pagesCleared = pageSweep.removed;

console.log('');
console.log('notes written:   ' + written + '   unchanged: ' + unchanged + '   removed: ' + cleared);
console.log('pages written:   ' + pagesWritten + '   unchanged: ' + pagesUnchanged + '   removed: ' + pagesCleared);
if (!PRUNE) console.log('(nothing is deleted without --prune)');
const keptOrphans = noteSweep.orphans.length + pageSweep.orphans.length;
if (keptOrphans && !PRUNE) console.log('orphans kept:    ' + keptOrphans);
console.log('notes store:     ' + NOTES);
console.log('pages store:     ' + PAGES);
console.log('');
console.log('next: npm run wiki:site   then commit + push C:/dev/ris-wiki-site');
