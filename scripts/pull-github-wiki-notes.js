#!/usr/bin/env node
// Pull "Team notes" written by the team in the GitHub wiki back into the notes
// store, so build-ris-wiki-site.js can merge them into the styled site.
//
//   node scripts/pull-github-wiki-notes.js <wiki-clone> [notes-dir]
//
// Round trip:
//   teammate clicks Edit at github.com/Tarnholm/ris-wiki/wiki, writes under
//   "Team notes"  ->  this script  ->  C:/RIS/RIS/wiki-notes/<page>.md
//   ->  npm run wiki:site  ->  tarnholm.github.io/ris-wiki/
const fs = require('fs'), path = require('path');
const { NOTES_DIR, extractNotes, pageName } = require('./ris-wiki-notes.js');

const argv = process.argv.slice(2).filter((a) => a !== '--prune');
const PRUNE = process.argv.includes('--prune');
const CLONE = argv[0];
const NOTES = path.resolve(argv[1] || NOTES_DIR);

if (!CLONE || !fs.existsSync(CLONE)) {
  console.error('usage: node scripts/pull-github-wiki-notes.js <wiki-clone> [notes-dir]');
  console.error('clone it with: git clone https://github.com/Tarnholm/ris-wiki.wiki.git');
  process.exit(1);
}

fs.mkdirSync(NOTES, { recursive: true });

const before = new Set(fs.readdirSync(NOTES).filter(f => f.endsWith('.md')));
let written = 0, cleared = 0, unchanged = 0;
const touched = new Set();

for (const f of fs.readdirSync(CLONE)) {
  if (!f.endsWith('.md') || f.startsWith('_')) continue;
  const note = extractNotes(fs.readFileSync(path.join(CLONE, f), 'utf8'));
  const dest = path.join(NOTES, pageName(f) + '.md');
  if (!note) continue;
  touched.add(pageName(f) + '.md');
  const prev = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8').trim() : null;
  if (prev === note) { unchanged++; continue; }
  fs.writeFileSync(dest, note + '\n');
  written++;
  console.log((prev ? 'updated ' : 'new     ') + pageName(f));
}

// A note in the store with nothing matching in the wiki is REPORTED, never removed:
// it may be a page not yet imported, or a note someone is mid-way through moving.
// Deleting is opt-in, because losing written prose is not a recoverable mistake.
const orphans = [...before].filter((f) => !touched.has(f));
for (const f of orphans) {
  if (!PRUNE) { console.log('orphan  ' + f.replace(/\.md$/, '') + '  (kept)'); continue; }
  fs.unlinkSync(path.join(NOTES, f));
  cleared++;
  console.log('removed ' + f.replace(/\.md$/, ''));
}

console.log('');
console.log('notes written:   ' + written);
console.log('notes unchanged: ' + unchanged);
console.log('notes removed:   ' + cleared + (PRUNE ? '' : '  (nothing is deleted without --prune)'));
if (orphans.length && !PRUNE) console.log('orphans kept:    ' + orphans.length);
console.log('store:           ' + NOTES);
console.log('');
console.log('next: npm run wiki:site   then commit + push C:/dev/ris-wiki-site');
