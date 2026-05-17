// Per-category numidia counting to isolate the 2 records that disappear
// between peace and war (siege-only). The disappearing records encode the
// Spain↔Carthage diplomatic relation.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const war = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 besiged corduba.sav'));

function positions(buf, str) {
  const hits = [];
  let p = 0;
  const needle = Buffer.from(str);
  while ((p = buf.indexOf(needle, p)) !== -1) { hits.push(p); p++; }
  return hits;
}

// For each "numidia" position, read the 64-byte preceding context to
// identify what KIND of record it's part of.
function categorize(buf, pos) {
  // Read up to 64 bytes before
  const before = buf.subarray(Math.max(0, pos - 64), pos);
  const beforeStr = Array.from(before).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  // Read up to 32 bytes after
  const after = buf.subarray(pos, Math.min(buf.length, pos + 32));
  const afterStr = Array.from(after).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  // Categorize based on visible text patterns
  if (beforeStr.includes('captain_portrait_')) return 'portrait_captain';
  if (beforeStr.includes('captain_card_')) return 'card_captain';
  if (beforeStr.includes('captain banners/')) return 'banners';
  if (afterStr.startsWith('numidian cavalry')) {
    if (beforeStr.includes('merc')) return 'merc_numidian_cavalry';
    return 'numidian_cavalry';
  }
  if (afterStr.startsWith('numidian javelinmen')) return 'numidian_javelinmen';
  if (afterStr.startsWith('numidian war elephant')) return 'numidian_elephants';
  if (afterStr.startsWith('numidian camel raiders')) return 'numidian_camels';
  if (afterStr.startsWith('numidian legionaries')) return 'numidian_legionaries';
  if (afterStr.startsWith('numidian mercenaries')) return 'numidian_mercenaries';
  if (afterStr.startsWith('numidian desert')) return 'numidian_desert';
  if (afterStr.startsWith('numidia.tga')) return 'numidia_tga';
  if (afterStr.startsWith('numidian_')) return 'numidian_underscore';
  // Faction-tag isolated string?
  return 'other (after: "' + afterStr.slice(0, 24) + '")';
}

const numA = positions(peace, 'numidia');
const numB = positions(war, 'numidia');

const peaceCats = new Map();
const warCats = new Map();
for (const p of numA) {
  const cat = categorize(peace, p);
  peaceCats.set(cat, (peaceCats.get(cat) || 0) + 1);
}
for (const p of numB) {
  const cat = categorize(war, p);
  warCats.set(cat, (warCats.get(cat) || 0) + 1);
}

console.log('=== Numidia category counts ===');
console.log('category'.padEnd(40) + '  peace  war  diff');
const allCats = new Set([...peaceCats.keys(), ...warCats.keys()]);
for (const cat of allCats) {
  const p = peaceCats.get(cat) || 0;
  const w = warCats.get(cat) || 0;
  const d = w - p;
  const mark = (d !== 0) ? '  <-- CHANGED' : '';
  console.log(cat.padEnd(40) + '  ' + String(p).padStart(5) + '  ' + String(w).padStart(3) + '  ' + (d >= 0 ? '+' : '') + d + mark);
}

// For categories that changed, dump every position of that category
console.log('\n=== Positions in changed categories ===');
for (const cat of allCats) {
  const p = peaceCats.get(cat) || 0;
  const w = warCats.get(cat) || 0;
  if (p === w) continue;
  console.log('\n--- Category: ' + cat + ' (peace=' + p + ', war=' + w + ') ---');
  console.log('PEACE positions:');
  for (const pos of numA) {
    if (categorize(peace, pos) !== cat) continue;
    const slice = peace.subarray(pos - 48, pos + 48);
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  0x' + pos.toString(16) + ':');
    console.log('    hex: ' + hex.slice(0, 96));
    console.log('    asc: ' + asc);
  }
  console.log('WAR positions:');
  for (const pos of numB) {
    if (categorize(war, pos) !== cat) continue;
    const slice = war.subarray(pos - 48, pos + 48);
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  0x' + pos.toString(16) + ':');
    console.log('    hex: ' + hex.slice(0, 96));
    console.log('    asc: ' + asc);
  }
}
