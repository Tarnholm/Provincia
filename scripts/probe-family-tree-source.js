// scripts/probe-family-tree-source.js
//
// Verifies the Family Tree data pipeline for a faction by reproducing the
// EXACT main.js descr_strat family-extraction (loadModCharacterData) — both
// the OLD first-name-keyed merge and the NEW full-name-keyed merge — and then
// applying FamilyTree.js's buildRoots + generals filter to each, so we can
// assert the bug (14 generals) and confirm the fix (~20) without launching
// Electron. Also dumps the live save's familyByFaction for cross-reference.
//
// Usage:
//   node scripts/probe-family-tree-source.js <save.sav> [--mod <dir>] [--faction romans_julii]

"use strict";
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const save = process.argv[2];
const mod = arg("--mod", "C:\\RIS\\RIS\\data");
const faction = arg("--faction", "romans_julii");
if (!save || !fs.existsSync(save)) { console.error("save not found:", save); process.exit(1); }

// ── descr_strat family extraction, parameterized on the merge KEY strategy ──
// keyMode: "first" (old, buggy) | "full" (new fix).
function extractFamilies(modDir, fac, keyMode) {
  const paths = [];
  const walk = (d) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (/^descr_strat\.txt$/i.test(e.name)) paths.push(fp);
    }
  };
  walk(modDir);
  const nameKey = (first, last) =>
    keyMode === "full" ? `${first}|${(last || "").replace(/_/g, " ")}` : first;

  const named = {};
  const members = [];
  const relatives = [];
  const reChar = /^character[\s,]+([^,]+?),\s*([^,]+?),.*?\bx\s+(\d+),\s*y\s+(\d+)/;

  for (const dsPath of paths) {
    let cur = null;
    const lines = fs.readFileSync(dsPath, "utf8").split(/\r?\n/);
    for (const raw of lines) {
      const noC = raw.includes(";") ? raw.slice(0, raw.indexOf(";")) : raw;
      const line = noC.replace(/\s+$/, "");
      const fm = line.match(/^faction\s+(\S+?),/);
      if (fm) { cur = fm[1]; continue; }
      if (cur !== fac) continue;

      // named `character` line (general/agent)
      const cm = line.match(reChar);
      if (cm && !/^character_record/.test(line)) {
        const nameField = cm[1].trim();
        if (/^sub[_\s]faction\b/i.test(nameField)) continue;
        const [first, ...rest] = nameField.split(/\s+/);
        const last = rest.join(" ") || null;
        const ageM = /\bage\s+(\d+)/.exec(line);
        const tags = [];
        if (/\bleader\b/i.test(cm[0])) tags.push("leader");
        if (/\bheir\b/i.test(cm[0])) tags.push("heir");
        named[nameKey(first, last)] = {
          firstName: first, lastName: last, age: ageM ? +ageM[1] : null,
          alive: true, gender: "male", tags, isCharacter: true,
        };
        continue;
      }
      // character_record (wife/child/dead relative)
      const cr = line.match(/^\s*character_record\s+([^,]+?),\s*(male|female)\s*,(.*)$/i);
      if (cr) {
        const [first, ...rest] = cr[1].trim().split(/\s+/);
        const last = rest.join(" ") || null;
        const gender = cr[2].toLowerCase();
        const ageM = /\bage\s+(\d+)/.exec(cr[3]);
        const aliveM = /\b(alive|dead)\b/.exec(cr[3]);
        const k = nameKey(first, last);
        const existing = named[k];
        if (existing) {
          if (ageM) existing.age = +ageM[1];
          existing.gender = gender;
          existing.alive = aliveM ? aliveM[1] === "alive" : true;
        } else {
          members.push({
            firstName: first, lastName: last, gender,
            age: ageM ? +ageM[1] : null,
            alive: aliveM ? aliveM[1] === "alive" : true, tags: [],
          });
        }
        continue;
      }
      // relative line
      const rel = line.match(/^\s*relative\s+([^,]+?),\s*([^,]+?),\s*(.*)$/);
      if (rel) {
        const husband = rel[1].trim();
        const wifeField = rel[2].trim();
        const wife = /^none$/i.test(wifeField) ? null : wifeField;
        const children = rel[3].replace(/\s+end\s*$/i, "")
          .split(",").map(s => s.trim()).filter(s => s && !/^end$/i.test(s));
        relatives.push({ husband, wife, children });
      }
    }
  }
  for (const k in named) members.push(named[k]);
  return { members, relatives };
}

// ── FamilyTree.js logic (ported) ─────────────────────────────────────────
function famKey(o) {
  if (!o) return "";
  if (typeof o === "object") {
    const fn = o.firstName || ""; const ln = (o.lastName || "").replace(/_/g, " ").trim();
    return ln ? `${fn} ${ln}` : fn;
  }
  return String(o).replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
function buildRootsFull(fd) {
  const byName = new Map(); const byFirst = new Map();
  for (const c of fd.members) { byName.set(famKey(c), c); if (!byFirst.has(c.firstName)) byFirst.set(c.firstName, c); }
  const resolve = (nm) => { const key = famKey(nm); return byName.get(key) || byFirst.get(key.split(/\s+/)[0]) || { firstName: key.split(/\s+/)[0] }; };
  const childKeys = new Set();
  for (const r of fd.relatives) for (const c of r.children) childKeys.add(famKey(c));
  const roots = fd.relatives.filter(r => !childKeys.has(famKey(r.husband)))
    .map(r => ({ husband: resolve(r.husband), wife: r.wife ? resolve(r.wife) : null, children: r.children.map(resolve) }));
  return roots;
}
function generalsOf(fd, keyFn) {
  const seen = new Set();
  return fd.members
    .filter(c => c.gender !== "female" && c.age != null && c.age >= 16 && c.alive !== false)
    .filter(c => { const k = keyFn(c); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ── Run ────────────────────────────────────────────────────────────────
const buf = fs.readFileSync(save);
const r = crackSave(buf, mod);
console.log(`\n=== ${path.basename(save)} ===`);
console.log(`turn ${r.turn}  player ${r.playerFaction}  faction ${faction}`);

const fam = (r.characters.familyByFaction && r.characters.familyByFaction[faction]) || [];
console.log(`\n[B] live save familyByFaction[${faction}]: ${fam.length} members (female ${fam.filter(x=>x.gender==="female").length})`);

const OLD = extractFamilies(mod, faction, "first");
const NEW = extractFamilies(mod, faction, "full");
const oldGens = generalsOf(OLD, c => c.firstName);          // old: first-name dedup
const newGens = generalsOf(NEW, famKey);                    // new: full-name dedup
console.log(`\n[A-OLD first-name keyed]  members=${OLD.members.length}  relatives=${OLD.relatives.length}  generals=${oldGens.length}`);
console.log(`   generals: ${oldGens.map(g=>famKey(g)).join(", ")}`);
console.log(`\n[A-NEW full-name keyed]   members=${NEW.members.length}  relatives=${NEW.relatives.length}  generals=${newGens.length}  rootFamilies=${buildRootsFull(NEW).length}`);
console.log(`   generals: ${newGens.map(g=>famKey(g)).join(", ")}`);

const missing = newGens.map(famKey).filter(k => !oldGens.map(famKey).includes(k));
console.log(`\n  generals RECOVERED by the fix (${missing.length}): ${missing.join(", ")}`);
const leaderNew = newGens.find(g => g.tags && g.tags.includes("leader"));
const leaderOld = oldGens.find(g => g.tags && g.tags.includes("leader"));
console.log(`  leader visible OLD: ${leaderOld ? famKey(leaderOld) : "(MISSING!)"}   NEW: ${leaderNew ? famKey(leaderNew) : "(missing)"}`);
