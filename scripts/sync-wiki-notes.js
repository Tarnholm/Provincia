#!/usr/bin/env node
// Sync "Team notes" from the GitHub wiki into the published site's notes folder.
//
//   node scripts/sync-wiki-notes.js <wiki-clone> <site-repo>
//
// Runs in CI on the `gollum` event (a wiki edit). It does NOT rebuild the site: the
// 222 MB of RIS source lives on rtris.org, which a GitHub runner cannot reach. It
// writes each note as a small pre-rendered fragment which the site loads at view
// time, so a note reaches the site without regenerating 4,332 pages.
//
// The fragment is rendered with the SITE'S OWN renderer, required from this repo —
// never a second markdown implementation, which would agree on the day it was
// written and drift from then on.
const fs = require('fs'), path = require('path');
const { extractNotes } = require('./ris-wiki-notes.js');

// serve-ris-wiki.js resolves its wiki root from process.argv AT LOAD TIME and exits(2) if
// that directory is missing — defaulting to C:/RIS/_wiki, which exists on the machine
// that generates the wiki and on no CI runner anywhere. Requiring it with an argv of our own
// making points it at the wiki clone we do have. build-ris-wiki-site.js does the same thing
// for the same reason; without it this script dies on a runner before it reads a single note.
const { renderMarkdown } = (() => {
  const real = process.argv;
  process.argv = [real[0], real[1], '--out', process.argv[2] || '.', '--no-open'];
  try { return require('./serve-ris-wiki.js'); } finally { process.argv = real; }
})();

const WIKI = process.argv[2];
const SITE = process.argv[3];
if (!WIKI || !SITE) {
  console.error('usage: node scripts/sync-wiki-notes.js <wiki-clone> <site-repo>');
  process.exit(1);
}

const mapFile = path.join(WIKI, 'page-map.json');
if (!fs.existsSync(mapFile)) {
  console.error('page-map.json missing from the wiki — re-run build-github-wiki.js and push it.');
  process.exit(1);
}
const PAGE_MAP = JSON.parse(fs.readFileSync(mapFile, 'utf8'));

const OUT = path.join(SITE, 'wiki-notes');
fs.mkdirSync(OUT, { recursive: true });

const before = new Set(fs.readdirSync(OUT).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
const index = {};
let written = 0, unchanged = 0, cleared = 0, unmapped = [];

for (const f of fs.readdirSync(WIKI)) {
  if (!f.endsWith('.md') || f.startsWith('_')) continue;
  const page = f.slice(0, -3);
  if (page === 'Home') continue;                 // Home mirrors README; notes belong on README
  const raw = fs.readFileSync(path.join(WIKI, f), 'utf8');

  // A page no generator writes is a TEAM page: publish the whole of it, so an edit on the wiki
  // shows on the site within minutes instead of waiting for a full local rebuild. The site's
  // team/<page>.html swaps its body for this fragment when it loads.
  if (!PAGE_MAP[page]) {
    const body = raw.replace(/\r\n/g, '\n').trim();
    if (!body) continue;
    const key = 'team/' + page;
    index[key] = key;
    fs.mkdirSync(path.join(OUT, 'team'), { recursive: true });
    const mdPath = path.join(OUT, key + '.md');
    const prev = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8').trim() : null;
    if (prev === body) { unchanged++; continue; }
    fs.writeFileSync(mdPath, body + '\n');
    fs.writeFileSync(path.join(OUT, key + '.html'), renderMarkdown(body, []));
    written++;
    console.log((prev ? 'updated ' : 'new     ') + key + '  (team page)');
    continue;
  }
  const note = extractNotes(raw);
  if (!note) continue;

  const target = PAGE_MAP[page];

  index[target] = page;
  const mdPath = path.join(OUT, page + '.md');
  const prev = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8').trim() : null;
  if (prev === note) { unchanged++; continue; }

  fs.writeFileSync(mdPath, note + '\n');
  fs.writeFileSync(path.join(OUT, page + '.html'), renderMarkdown(note, []));
  written++;
  console.log((prev ? 'updated ' : 'new     ') + page + '  -> ' + target);
}

// A note file whose wiki page still exists but no longer carries a note was cleared by a
// person on purpose, so it goes. A note whose wiki page has vanished is LEFT ALONE — that
// is a rename or a bad import, not someone asking for their writing to be deleted.
for (const page of before) {
  if (index[PAGE_MAP[page]] === page) continue;
  if (!fs.existsSync(path.join(WIKI, page + '.md'))) {
    console.log('kept    ' + page + '  (its wiki page is missing — not treating that as a delete)');
    const target = PAGE_MAP[page];
    if (target) index[target] = page;
    continue;
  }
  for (const ext of ['.md', '.html']) {
    const p = path.join(OUT, page + ext);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  cleared++;
  console.log('cleared ' + page + '  (note removed in the wiki)');
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));

console.log('');
console.log('notes written:   ' + written);
console.log('notes unchanged: ' + unchanged);
console.log('notes cleared:   ' + cleared);
console.log('pages with notes: ' + Object.keys(index).length);
if (unmapped.length) console.log('unmapped pages:  ' + unmapped.length + ' (' + unmapped.slice(0, 5).join(', ') + ')');
