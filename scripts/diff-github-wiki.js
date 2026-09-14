#!/usr/bin/env node
/**
 * What has the team changed in the GitHub wiki since the machine last wrote to it?
 *
 *   node scripts/diff-github-wiki.js <wiki-clone> [--since <ref>] [--full] [--no-fetch]
 *
 * WHY THIS EXISTS. The wiki is written from two directions: this project regenerates it from
 * the RIS data files, and the team edits it in the browser. Before a regeneration overwrites
 * anything, you want to see exactly what the team did -- and in particular the one thing the
 * round trip CANNOT keep: an edit made ABOVE the TEAM-NOTES marker, on the part of the page
 * the generators own. That edit is usually someone fixing a number by hand. It will be gone
 * at the next import and the fix belongs in the generator. Nothing else reports it, so
 * without this it is lost in silence and the same wrong number comes back.
 *
 * THE BASELINE IS A STAMP, NOT A GUESS. build-github-wiki.js writes .import-stamp.json on
 * every import, so the commit carrying it is exactly where the machine last wrote. Before
 * that file existed the boundary has to be inferred, and the inference is printed rather than
 * hidden: a re-import that touched three files and a hand-edit that touched three files
 * cannot be told apart by size, so the report says which rule it used.
 *
 * This script only ever READS. It fetches, it diffs, it prints. It writes nothing, anywhere.
 */
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const { MARK, extractNotes, pageName } = require('./ris-wiki-notes.js');

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const FULL = argv.includes('--full');
const NO_FETCH = argv.includes('--no-fetch');
const CLONE = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--since')[0];

if (!CLONE || !fs.existsSync(path.join(CLONE, '.git'))) {
  console.error('usage: node scripts/diff-github-wiki.js <wiki-clone> [--since <ref>] [--full] [--no-fetch]');
  console.error('clone it with: git clone https://github.com/Tarnholm/ris-wiki.wiki.git');
  process.exit(1);
}

const git = (...args) => execFileSync('git', ['-C', CLONE, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
// Swallows git's own stderr as well as its exit code: a probe for a ref that may not exist
// (origin/master in a clone with no remote) is a question, not an error, and printing
// 'fatal: Needed a single revision' above the report makes a clean run look broken.
const gitQuiet = (...args) => {
  try {
    return execFileSync('git', ['-C', CLONE, ...args],
      { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return ''; }
};
const show = (ref, file) => gitQuiet('show', ref + ':' + file);

// -- the two ends of the comparison -------------------------------------------
if (!NO_FETCH) {
  try { git('fetch', '--quiet', 'origin'); }
  catch { console.error('could not fetch -- comparing against the clone as it stands'); }
}
const HEAD = gitQuiet('rev-parse', '--verify', 'origin/master').trim()
  || gitQuiet('rev-parse', 'HEAD').trim();

let baseline = valOf('--since', null);
let how = 'given with --since';
if (!baseline) {
  const stamped = gitQuiet('log', '--format=%H', '-1', HEAD, '--', '.import-stamp.json').trim();
  if (stamped) { baseline = stamped.split('\n')[0]; how = 'the commit that last wrote .import-stamp.json'; }
}
if (!baseline) {
  // Before the stamp existed. An import rewrites the corpus; nothing a person does in a
  // browser touches a thousand files at once. Printed plainly, because it IS a guess.
  const lines = gitQuiet('log', '--format=%H', HEAD).trim().split('\n').filter(Boolean);
  for (const sha of lines) {
    const n = gitQuiet('show', '--name-only', '--format=', sha).trim().split('\n').filter(Boolean).length;
    if (n >= 100) {
      baseline = sha;
      how = 'inferred: newest commit touching ' + n + ' files (no stamp yet -- pass --since to be exact)';
      break;
    }
  }
}
if (!baseline) { console.error('no baseline found. Pass --since <ref>.'); process.exit(2); }

const describe = (sha) => gitQuiet('log', '-1', '--format=%h %ad  %an  %s', '--date=short', sha).trim();
console.log('comparing');
console.log('  from  ' + describe(baseline));
console.log('        (' + how + ')');
console.log('  to    ' + describe(HEAD));
console.log('');

// -- what changed --------------------------------------------------------------
const PAGE_MAP = (() => {
  const t = show(HEAD, 'page-map.json');
  try { return t ? JSON.parse(t) : {}; } catch { return {}; }
})();
const isGenerated = (page) => Object.prototype.hasOwnProperty.call(PAGE_MAP, page);
const above = (text) => { const i = text.indexOf(MARK); return i === -1 ? text : text.slice(0, i); };

const status = gitQuiet('diff', '--name-status', baseline + '..' + HEAD).trim();
const changes = status ? status.split('\n').map((l) => {
  const parts = l.split('\t');
  return { code: parts[0][0], file: parts[parts.length - 1] };
}) : [];

const overwritten = [];   // edits to the generated part -- the ones that will be lost
const notes = [];         // notes added, changed or removed
const newPages = [];      // pages the team created
const deleted = [];       // pages removed in the wiki
const other = [];         // everything that is not a page

for (const c of changes) {
  if (!c.file.endsWith('.md')) { other.push(c); continue; }
  const page = pageName(c.file);
  if (c.code === 'D') { deleted.push({ page, generated: isGenerated(page) }); continue; }
  const after = show(HEAD, c.file);
  if (c.code === 'A') {
    if (isGenerated(page)) overwritten.push({ page, why: 'created by hand under a generated page name' });
    else newPages.push({ page, lines: after.trim().split('\n').length });
    continue;
  }
  const before = show(baseline, c.file);
  const noteBefore = extractNotes(before), noteAfter = extractNotes(after);
  if (above(before).trim() !== above(after).trim()) {
    overwritten.push({ page, why: 'the generated part of the page was edited' });
  }
  if ((noteBefore || '') !== (noteAfter || '')) {
    notes.push({ page, kind: !noteBefore ? 'added' : !noteAfter ? 'removed' : 'changed' });
  }
}

// -- the report ----------------------------------------------------------------
const fileOf = (page) => (changes.find((c) => c.file.endsWith('.md') && pageName(c.file) === page) || {}).file;
const printDiff = (file, limit) => {
  if (!file) return;
  const d = gitQuiet('diff', '-U' + (FULL ? 3 : 0), baseline + '..' + HEAD, '--', file);
  const body = d.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  const take = FULL ? body : body.slice(0, limit);
  for (const l of take) console.log('      ' + l);
  if (take.length < body.length) console.log('      ... ' + (body.length - take.length) + ' more changed lines (--full)');
};

if (overwritten.length) {
  console.log('!! EDITED WHERE A REGENERATION WILL OVERWRITE IT -- ' + overwritten.length + ' page(s)');
  console.log('   The round trip cannot keep this. Port the change into the generator before');
  console.log('   importing, or the page goes back to what it was.');
  for (const o of overwritten) {
    console.log('   ' + o.page + '  (' + o.why + ')');
    printDiff(fileOf(o.page), 12);
  }
  console.log('');
}
if (newPages.length) {
  console.log('new pages written by the team -- ' + newPages.length + ' (kept by the import; pull them into the store)');
  for (const p of newPages) console.log('   ' + p.page + '  (' + p.lines + ' lines)');
  console.log('');
}
if (notes.length) {
  console.log('team notes -- ' + notes.length + ' (kept by the round trip)');
  for (const nt of notes) {
    console.log('   ' + nt.kind.padEnd(8) + nt.page);
    if (FULL) printDiff(fileOf(nt.page), 12);
  }
  console.log('');
}
if (deleted.length) {
  console.log('pages deleted in the wiki -- ' + deleted.length);
  for (const d of deleted) {
    console.log('   ' + d.page + (d.generated
      ? '  (generated -- the next import brings it back)'
      : '  (team-written -- gone unless the store still holds it)'));
  }
  console.log('');
}
if (other.length) {
  console.log('other files -- ' + other.length);
  for (const o of other) console.log('   ' + o.code + '  ' + o.file);
  console.log('');
}

if (!changes.length) console.log('nothing has changed in the wiki since the last import.');
else console.log(changes.length + ' file(s) changed in total.');
console.log('');
console.log('nothing was written by this script. If it all looks right, next:');
console.log('  npm run wiki:pull -- ' + CLONE);
