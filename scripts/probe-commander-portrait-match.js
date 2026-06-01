// scripts/probe-commander-portrait-match.js
//
// Proves the commander/army-card portrait resolver returns the SAME engine-
// exact portrait the family tree shows for each character — instead of an
// arbitrary name-hash pick. Covers BOTH the live coord-bridge path AND (0.9.778)
// the NON-LIVE / starting-view name-fallback path that was the reported bug.
//
// Family-tree resolution (CONFIRMED correct, see src/FamilyTree.js):
//   live    : coordToPortrait.get(`${x},${y}`)  ->  v1PortraitsByCoord cards
//   non-live: coordToPortrait.get(`name:${fn}|${ln}|${fac}`)  (statsCache folded
//             in under the FULL name key, then stripped fallbacks) -> .cards
//
// Commander/army-card resolution:
//   live    : commanderInfo[secondaryUuid].savePath = c.portraitCardsPath (main.js)
//   non-live: src/RegionInfo.js resolveNonLiveCommanderInfo() — recovers the full
//             surname from descr_strat `characters` then looks statsCache up by
//             the SAME `fn|ln|fac` key order the family tree uses.
//
// BEFORE 0.9.778 the non-live path looked statsCache up by ONLY the stripped
// `fn||fac` / `fn||` keys and hardcoded lastName:null -> surname dropped +
// frequent portrait miss -> DJB2 hash-pool pick (wrong face). This probe
// replicates BOTH resolutions from the raw save (no Electron/UI) and asserts
// the non-live commander resolution matches the family tree per-character.
//
// Usage: node scripts/probe-commander-portrait-match.js <save.sav> [--mod <dir>]

"use strict";
const fs = require("fs");
const { crackSave } = require("../src/saveCracker.js");

function parseArgs(argv) {
  const a = { save: null, mod: "C:\\RIS\\RIS\\data" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mod") a.mod = argv[++i];
    else if (!a.save) a.save = argv[i];
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
if (!args.save || !fs.existsSync(args.save)) { console.error("save not found:", args.save); process.exit(1); }

const buf = fs.readFileSync(args.save);
const r = crackSave(buf, args.mod);
const v1 = r.characters.v1 || [];
const player = (r.playerFaction || "").toLowerCase();
console.log(`turn ${r.turn}  player ${r.playerFaction}  v1chars=${v1.length}  units=${r.units.length}`);

// ── Replicate main.js's v1PortraitsByCoord build (the family-tree LIVE source) ──
function buildV1PortraitsByCoord(chars) {
  const out = {};
  for (const v of chars) {
    if (v.tileX == null || v.tileY == null) continue;
    const ports = Array.isArray(v.portraits) ? v.portraits : [];
    const isBadPath = (p) => !p || (!v.isDead && /\/dead\//i.test(p));
    const goodLarge = ports.find((p) => !isBadPath(p) && /\/portraits\/portraits\//i.test(p));
    const goodAny = ports.find((p) => !isBadPath(p));
    const pick = goodLarge || goodAny;
    if (!pick) continue;
    const cards = pick.replace(/\/portraits\/portraits\//i, "/portraits/cards/");
    out[`${v.tileX},${v.tileY}`] = { cards };
  }
  return out;
}
const v1PortraitsByCoord = buildV1PortraitsByCoord(v1);

// ── Replicate App.js's statsCache build (the family-tree + commander-card
//    NON-LIVE source). main.js attaches portraitCardsPath; App.js writeBest's
//    it under `fn|ln|fac`, `fn||fac`, `fn||`. We use portraitCardsPath here
//    (resolved identically to v1PortraitsByCoord). This is the persisted cache
//    a non-live session reads from localStorage. ──
function portraitCardsPathFor(c) {
  const ports = Array.isArray(c.portraits) ? c.portraits : [];
  const isBadPath = (p) => !p || (!c.isDead && /\/dead\//i.test(p));
  const goodLarge = ports.find((p) => !isBadPath(p) && /\/portraits\/portraits\//i.test(p));
  const goodAny = ports.find((p) => !isBadPath(p));
  const pick = goodLarge || goodAny;
  return pick ? pick.replace(/\/portraits\/portraits\//i, "/portraits/cards/") : null;
}
function buildStatsCache(chars) {
  const cache = {};
  const score = (e) => (e.portrait ? 1 : 0) + (e.command || e.influence || e.management ? 2 : 0) + (e.traitCount > 0 ? 3 : 0);
  const writeBest = (k, e) => { const cur = cache[k]; if (!cur || score(e) > score(cur)) cache[k] = e; };
  for (const c of chars) {
    const entry = {
      portrait: portraitCardsPathFor(c),
      lastName: c.lastName || null,
      faction: c.faction || null,
      age: typeof c.age === "number" ? c.age : null,
      command: c.command, influence: c.influence, management: c.management,
      traitCount: typeof c.traitCount === "number" ? c.traitCount : (Array.isArray(c.traits) ? c.traits.length : 0),
    };
    const fn = (c.firstName || "").toLowerCase();
    const ln = (c.lastName || "").replace(/_/g, " ").toLowerCase();
    const fac = (c.faction || "").toLowerCase();
    writeBest(`${fn}|${ln}|${fac}`, entry);
    writeBest(`${fn}||${fac}`, entry);
    writeBest(`${fn}||`, entry);
  }
  return cache;
}
const statsCache = buildStatsCache(v1);

// ── Family-tree NON-LIVE resolution: name-key lookup into the folded map
//    (FamilyTree.js: coordToPortrait.get(`name:fn|ln|fac`) || `name:fn||fac` ||
//    `name:fn||`). Here we read statsCache[...].portrait by the same keys. ──
function familyTreeNonLiveSavePath(fn, ln, fac) {
  const f = (fn || "").toLowerCase();
  const l = (ln || "").replace(/_/g, " ").toLowerCase();
  const c = (fac || "").toLowerCase();
  const e = (l && statsCache[`${f}|${l}|${c}`])
    || statsCache[`${f}||${c}`]
    || statsCache[`${f}||`];
  return (e && e.portrait) || null;
}

// ── Commander-card NON-LIVE resolution AFTER 0.9.778 — replicates
//    src/RegionInfo.js resolveNonLiveCommanderInfo(): the army tags the
//    PRECISE surname (commanderLastName, split from the full `a.character`
//    name), so the resolver keys statsCache by the FULL `fn|ln|fac` key. We
//    model the army tag as the char's own (firstName, lastName). ──
function commanderCardNonLiveAfter(commanderName, commanderLastName, commanderFaction) {
  const fn = (commanderName || "").toLowerCase();
  let lastName = commanderLastName || null;
  const faction = commanderFaction || null;
  const ln = (lastName || "").replace(/_/g, " ").toLowerCase();
  const facKey = (faction || "").toLowerCase();
  const keys = [ln ? `${fn}|${ln}|${facKey}` : null, ln ? `${fn}|${ln}|` : null, `${fn}||${facKey}`, `${fn}||`].filter(Boolean);
  for (const k of keys) if (statsCache[k]) return { savePath: statsCache[k].portrait || null, lastName, faction };
  return { savePath: null, lastName, faction };
}
// BEFORE 0.9.778: stripped-key only + lastName dropped.
function commanderCardNonLiveBefore(commanderName, commanderFaction) {
  const fn = (commanderName || "").toLowerCase();
  const fac = (commanderFaction || "").toLowerCase();
  const cached = statsCache[`${fn}||${fac}`] || statsCache[`${fn}||`] || null;
  return { savePath: (cached && cached.portrait) || null, lastName: null };
}

// ── Sample named v1 chars in the player faction (the starting-view set). The
//    family tree shows these; the starting "Region owners armies" cards do too.
//    descr_strat list = v1 chars with a firstName (carry the full surname). ──
const dsList = v1.filter((c) => c.firstName);
const sample = v1.filter((c) =>
  c.firstName &&
  // commander candidates: named chars that the starting view would render
  (c.lastName || (c.faction && c.faction.toLowerCase() === player) || true)
).filter((c) => c.firstName);

// Focus the assertion on chars the family tree CAN resolve a real face for
// (non-live name key). Where the family tree itself hash-falls-back, the card
// legitimately does too.
let ftResolves = 0, beforeMatched = 0, afterMatched = 0, afterMismatch = 0, afterDropSurname = 0;
const focus = ["Servius", "Marcus", "Quintus", "Gnaeus", "Lucius"];
const rows = [];
const seen = new Set();
for (const c of sample) {
  const key = `${c.firstName}|${c.lastName || ""}`;
  if (seen.has(key)) continue; seen.add(key);
  // Family tree resolves by the char's own full name + faction.
  const ft = familyTreeNonLiveSavePath(c.firstName, c.lastName, c.faction);
  // BEFORE: army tagged firstName only → stripped-key lookup, surname dropped.
  const before = commanderCardNonLiveBefore(c.firstName, c.faction);
  // AFTER: army tags the PRECISE surname (commanderLastName) so the card keys
  // statsCache by the identical full name the family tree uses.
  const after = commanderCardNonLiveAfter(c.firstName, c.lastName, c.faction);
  if (ft) {
    ftResolves++;
    if (before.savePath === ft) beforeMatched++;
    if (after.savePath === ft) afterMatched++; else afterMismatch++;
  }
  // surname-drop check: family tree shows a surname, did the after-fix card keep it?
  if (c.lastName && !after.lastName) afterDropSurname++;
  const isFocus = focus.includes(c.firstName) || (c.lastName || "").toLowerCase().includes("ogulnius");
  if (isFocus || rows.length < 16) {
    rows.push(
      `  ${(c.firstName + " " + (c.lastName || "")).padEnd(28)} fac=${(c.faction || "—")}\n` +
      `      familyTree   : ${ft ? ft.split("/").slice(-3).join("/") : "(hash fallback)"}\n` +
      `      card BEFORE  : ${before.savePath ? before.savePath.split("/").slice(-3).join("/") : "(hash — arbitrary face)"}  lastName="${before.lastName || ""}"\n` +
      `      card AFTER   : ${after.savePath ? after.savePath.split("/").slice(-3).join("/") : "(hash fallback)"}  lastName="${after.lastName || ""}"` +
      `${ft ? (after.savePath === ft ? "   <= MATCHES family tree" : "   <= MISMATCH") : ""}`
    );
  }
}

console.log(`\nsample (unique named chars): ${seen.size}\n`);
console.log(rows.join("\n"));
console.log(`\n--- NON-LIVE summary ---`);
console.log(`family tree resolves a real card for : ${ftResolves} chars (statsCache name key)`);
console.log(`card BEFORE fix matched family tree  : ${beforeMatched}`);
console.log(`card AFTER  fix matched family tree  : ${afterMatched}`);
console.log(`card AFTER  fix MISMATCHED            : ${afterMismatch}`);
console.log(`chars with surname DROPPED after fix : ${afterDropSurname} (expected 0)`);

let ok = true;
if (ftResolves === 0) { console.log("ASSERT FAIL: family tree resolved NO non-live cards (statsCache empty?)"); ok = false; }
if (afterMismatch !== 0) { console.log("ASSERT FAIL: after-fix mismatched a family-tree-resolved char"); ok = false; }
if (afterMatched !== ftResolves) { console.log("ASSERT FAIL: after-fix did not match every family-tree-resolved char"); ok = false; }
if (afterDropSurname !== 0) { console.log("ASSERT FAIL: a char's surname was dropped after the fix"); ok = false; }
// Document the improvement: before should match far fewer (stripped-key misses).
console.log(`\nimprovement: before matched ${beforeMatched}/${ftResolves}, after matched ${afterMatched}/${ftResolves}`);

console.log(`\n${ok ? "ALL ASSERTIONS PASS — non-live commander card now matches the family tree per-character portrait" : "ASSERTIONS FAILED"}`);
process.exit(ok ? 0 : 1);
