// Simulate renderer's saveCharactersByRegion build via main.js's parseCharactersAndUnits,
// and check what Aulus looks like in there + whether the incoming-pass match fires.
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav';
const MOD = 'C:/RIS/RIS/data';

// Run the worker like main.js does, with epithet override.
const buf = fs.readFileSync(SAVE);
const nameLookup = fs.readFileSync(path.join(MOD, 'descr_names_lookup.txt'),'utf8').split(/\r?\n/).map(s=>s.trim());
const traitNames = [];
const traitEpithets = {};
let curTrait = null, curLevel = null, curLevelIdx = 0;
for (const line of fs.readFileSync(path.join(MOD, 'export_descr_character_traits.txt'),'utf8').split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/);
  if (tm) { curTrait = tm[1]; curLevel = null; curLevelIdx = 0; traitNames.push(curTrait); continue; }
  const lm = line.match(/^\s*Level\s+(\S+)/);
  if (lm) { curLevel = lm[1]; curLevelIdx++; continue; }
  const em = line.match(/^\s*Epithet\s+(\S+)/);
  if (em && curTrait && curLevel) {
    if (!traitEpithets[curTrait]) traitEpithets[curTrait] = [];
    traitEpithets[curTrait].push({ level: curLevelIdx, levelName: curLevel, key: em[1], text: null });
  }
}
// Resolve epithet keys → text via export_vnvs.txt
const vnvsBuf = fs.readFileSync(path.join(MOD, 'text', 'export_vnvs.txt'));
const vnvsTxt = (vnvsBuf[0]===0xff && vnvsBuf[1]===0xfe) ? vnvsBuf.toString('utf16le', 2) : vnvsBuf.toString('utf8');
const keyToText = new Map();
for (const line of vnvsTxt.split(/\r?\n/)) {
  const m = line.match(/^\{([^}]+)\}\s*(.+?)\s*$/);
  if (m) keyToText.set(m[1], m[2]);
}
for (const trait of Object.keys(traitEpithets)) {
  for (const e of traitEpithets[trait]) if (keyToText.has(e.key)) e.text = keyToText.get(e.key);
  traitEpithets[trait] = traitEpithets[trait].filter(e => e.text);
  if (traitEpithets[trait].length === 0) delete traitEpithets[trait];
}
console.log("traitEpithets keys:", Object.keys(traitEpithets).length);
console.log("Has RomanConquerorMessapians?", Boolean(traitEpithets.RomanConquerorMessapians));
console.log("Has LegendarySiegeExpert/related?");
for (const t of Object.keys(traitEpithets)) if (/siege|wallbreak/i.test(t)) console.log("  ", t, "→", traitEpithets[t]);

const { findCharacterRecords } = require('C:/dev/Provincia/src/characterParser.js');
const characters = findCharacterRecords(buf, nameLookup, traitNames, null);
console.log("\nchars parsed:", characters.length);

// Apply epithet overrides like the worker does
const isNickname = (s) => /^(the|de|der|le|la|el|il|den)\s/i.test(s);
for (const c of characters) {
  if (!c.traits || c.traits.length === 0) continue;
  let surname = null, nickname = null;
  for (const t of c.traits) {
    const cands = traitEpithets[t.name];
    if (!cands) continue;
    let best = null;
    for (const cd of cands) if (!best || cd.level > best.level) best = cd;
    if (!best) continue;
    if (isNickname(best.text)) nickname = best.text;
    else if (!surname || best.level > (surname.level || 0)) surname = best;
  }
  if (surname || nickname) c.originalLastName = c.lastName || null;
  if (surname) c.lastName = surname.text;
  if (nickname) c.lastName = (c.lastName ? c.lastName + " " : "") + nickname;
}

// Focus on Aulus uuid 0xa77c10f
const aulus = characters.find(c => c.secondaryUuid === 0xa77c10f);
console.log("\nAulus AFTER epithet override:");
console.log("  firstName:", aulus.firstName);
console.log("  lastName:", aulus.lastName);
console.log("  originalLastName:", aulus.originalLastName);
