// Final audit: how well does the v1 parser map descr_strat after fixes?
const fs = require("fs");
const path = require("path");
const savePath = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const dsPath = path.join(modPath, "data/world/maps/campaign/imperial_campaign/descr_strat.txt");
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitsTxt = fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8");
const traitsList = [];
for (const m of traitsTxt.matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traitsList.push(m[1]);
const { findCharacterRecords } = require("../../src/characterParser.js");
const buf = fs.readFileSync(savePath);
const v1Records = findCharacterRecords(buf, names, traitsList, null);

// descr_strat parser — WITH sub_faction skip
const dsText = fs.readFileSync(dsPath, "utf8");
const dsChars = [];
const dsByName = new Map();
let currentFaction = null, lastChar = null;
for (const line of dsText.split(/\r?\n/)) {
  const facM = line.match(/^faction\s+([a-z_]+)/);
  if (facM) { currentFaction = facM[1]; continue; }
  const charM = line.match(/^character,\s+(.+?)\s*$/);
  if (charM) {
    const parts = charM[1].split(",").map(s => s.trim());
    const fullName = parts[0];
    // 2026-05-20: skip RIS sub_faction territory markers — they're not characters
    if (/^sub[_ ]faction\b/i.test(fullName)) { lastChar = null; continue; }
    const obj = { fullName, faction: currentFaction, cls: null, role: null, gender: null, age: null, x: null, y: null, traits: [], father: null, mother: null, spouse: null, children: [] };
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i]; if (!p) continue;
      if (["named character", "captain", "admiral", "spy", "diplomat", "assassin", "princess"].includes(p)) obj.cls = p;
      else if (["leader", "heir"].includes(p)) obj.role = p;
      else if (["male", "female"].includes(p)) obj.gender = p;
      const ageM = p.match(/^age\s+(\d+)/); if (ageM) obj.age = parseInt(ageM[1]);
      const xM = p.match(/^x\s+(\d+)/); if (xM) obj.x = parseInt(xM[1]);
      const yM = p.match(/^y\s+(\d+)/); if (yM) obj.y = parseInt(yM[1]);
    }
    dsChars.push(obj);
    dsByName.set(fullName, obj);
    lastChar = obj;
    continue;
  }
  if (line.match(/^traits\s+/) && lastChar) {
    const items = line.replace(/^traits\s+/, "").split(",").map(s => s.trim());
    for (const it of items) {
      const m = it.match(/^([A-Za-z0-9_]+)\s+(\d+)$/);
      if (m) lastChar.traits.push({ name: m[1], level: parseInt(m[2]) });
    }
  }
  const relM = line.match(/^relative\s+([^,]+),\s*([^,]+)(?:,\s*(.+?))?$/);
  if (relM) {
    const father = relM[1].trim(), mother = relM[2].trim();
    const childPart = (relM[3] || "").replace(/,\s*end\b.*$/, "").trim();
    const children = childPart.split(/\s*,\s*/).filter(x => x && x !== "end");
    if (dsByName.has(father)) { dsByName.get(father).spouse = mother; dsByName.get(father).children = children; }
    if (dsByName.has(mother)) dsByName.get(mother).spouse = father;
    for (const c of children) if (dsByName.has(c)) { dsByName.get(c).father = father; dsByName.get(c).mother = mother; }
  }
}
console.log(`descr_strat real chars (after sub_faction filter): ${dsChars.length}`);
console.log(`v1 records (after parser fixes): ${v1Records.length}`);

// Match
const v1ByName = new Map();
for (const c of v1Records) {
  if (!c.firstName) continue;
  const key = c.lastName ? `${c.firstName} ${c.lastName.replace(/ /g, "_")}` : c.firstName;
  if (!v1ByName.has(key)) v1ByName.set(key, []);
  v1ByName.get(key).push(c);
}
const usedV1 = new Set();
const matched = [];
const unmatched = [];
for (const ds of dsChars) {
  const cs = v1ByName.get(ds.fullName) || [];
  let best = null;
  for (const c of cs) {
    if (usedV1.has(c.offset)) continue;
    if (c.tileX === ds.x && c.tileY === ds.y) { best = c; break; }
  }
  if (!best) for (const c of cs) {
    if (usedV1.has(c.offset)) continue;
    if (c.age === ds.age) { best = c; break; }
  }
  if (!best) for (const c of cs) {
    if (usedV1.has(c.offset)) continue;
    best = c; break;
  }
  if (best) { usedV1.add(best.offset); matched.push({ ds, v1: best }); }
  else unmatched.push(ds);
}
console.log(`\nMatched: ${matched.length} / ${dsChars.length} (${(100*matched.length/dsChars.length).toFixed(1)}%)`);
console.log(`Unmatched: ${unmatched.length}`);

// Verify fields for confidence
let confAge = 0, confTile = 0, confFather = 0;
for (const { ds, v1 } of matched) {
  if (v1.age === ds.age) confAge++;
  if (v1.tileX === ds.x && v1.tileY === ds.y) confTile++;
}
console.log(`\nField verification on matched:`);
console.log(`  age match: ${confAge}/${matched.length} (${(100*confAge/matched.length).toFixed(1)}%)`);
console.log(`  tile match: ${confTile}/${matched.length} (${(100*confTile/matched.length).toFixed(1)}%)`);

// fatherUuid validation (only when descr_strat father is also in v1)
let fOK = 0, fTotal = 0;
const v1ByFirstName = new Map();
for (const c of v1Records) {
  if (!c.firstName) continue;
  const k = c.lastName ? `${c.firstName} ${c.lastName.replace(/ /g, "_")}` : c.firstName;
  if (!v1ByFirstName.has(k)) v1ByFirstName.set(k, c);
}
for (const { ds, v1 } of matched) {
  if (!ds.father) continue;
  const father = v1ByFirstName.get(ds.father);
  if (!father) continue;
  fTotal++;
  if (v1.fatherUuid === father.primaryUuid) fOK++;
}
console.log(`  fatherUuid match: ${fOK}/${fTotal} (${(100*fOK/fTotal).toFixed(1)}%)`);

// children check
let cOK = 0, cTotal = 0, allMatch = 0, withCh = 0;
for (const { ds, v1 } of matched) {
  if (!ds.children.length) continue;
  withCh++;
  const dsChildUuids = ds.children.map(c => v1ByFirstName.get(c)?.primaryUuid).filter(Boolean);
  const v1ChildUuids = v1.childUuids || [];
  const hits = dsChildUuids.filter(u => v1ChildUuids.includes(u)).length;
  if (hits === dsChildUuids.length && dsChildUuids.length > 0) allMatch++;
  cOK += hits; cTotal += dsChildUuids.length;
}
console.log(`  childUuids partial: ${cOK}/${cTotal} children`);
console.log(`  childUuids all-match: ${allMatch}/${withCh} families`);

// Unmatched
console.log(`\nUnmatched samples (first 10):`);
for (const ds of unmatched.slice(0, 10)) {
  console.log(`  ${ds.fullName} (cls=${ds.cls}, age=${ds.age}, x=${ds.x}, y=${ds.y})`);
}
