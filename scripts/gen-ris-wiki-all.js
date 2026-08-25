#!/usr/bin/env node
// Run every RIS wiki generator, in dependency order, against the current RIS data.
//
//   npm run wiki:gen
//
// They were run by hand one at a time before, which is how pages drifted out of
// step with each other: regenerating regions alone renames a region, while the
// faction and trade-good pages keep linking to the old name.
const { execFileSync } = require('child_process');
const path = require('path');

const ORDER = [
  'gen-ris-region-pages.js',
  'gen-ris-faction-pages.js',
  'gen-ris-unit-pages.js',
  'gen-ris-unit-cards.js',
  'gen-ris-building-pages.js',
  'gen-ris-building-icons.js',
  'gen-ris-culture-pages.js',
  'gen-ris-belief-pages.js',
  'gen-ris-trait-pages.js',
  'gen-ris-ancillary-pages.js',
  'gen-ris-trade-goods.js',
  'gen-ris-settlement-sizes.js',
  'gen-ris-tag-pages.js',
  'gen-ris-wiki.js',
  'gen-ris-wiki-html.js',
];

const failed = [];
for (const [i, s] of ORDER.entries()) {
  const label = `[${i + 1}/${ORDER.length}] ${s}`;
  process.stdout.write(label + ' ... ');
  try {
    execFileSync(process.execPath, [path.join(__dirname, s)], { stdio: 'pipe' });
    console.log('ok');
  } catch (e) {
    console.log('FAILED (exit ' + e.status + ')');
    failed.push({ script: s, status: e.status, err: String(e.stderr || '').split('\n').slice(-8).join('\n') });
  }
}

console.log('');
if (failed.length) {
  console.log('FAILED: ' + failed.length + ' of ' + ORDER.length);
  for (const f of failed) { console.log('--- ' + f.script + ' ---'); console.log(f.err); }
  process.exitCode = 1;
} else {
  console.log('all ' + ORDER.length + ' generators ok');
}
