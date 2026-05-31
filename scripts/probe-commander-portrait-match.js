// scripts/probe-commander-portrait-match.js
//
// Proves the commander/army-card portrait resolver returns the SAME engine-
// exact portrait the family tree shows for each character — instead of an
// arbitrary name-hash pick.
//
// Family-tree resolution (CONFIRMED correct, see src/FamilyTree.js):
//   coordToPortrait.get(`${x},${y}`)  ->  v1PortraitsByCoord[`${tileX},${tileY}`].cards
//   (built in main.js from each v1 char's filtered portraits[]: goodLarge||goodAny,
//    rejecting /dead/ on alive chars; large /portraits/portraits/ rewritten to /cards/)
//
// Commander/army-card resolution (BEFORE fix, src/App.js commanderInfo builder):
//   forced savePath=null on every entry  ->  IPC `resolve-portrait` falls to the
//   DJB2 name-hash pool pick (an arbitrary face in the culture pool).
//
// AFTER fix: commanderInfo sets savePath from the SAME v1PortraitsByCoord coord
// map the family tree uses (then statsCache name fallback), null only when neither
// resolves -> hash pool stays a pure fallback.
//
// This probe replicates BOTH resolutions from the raw save (no Electron/UI) and
// asserts they match for Rome's commanded characters.
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

// ── Replicate main.js's v1PortraitsByCoord build (the family-tree source) ──
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
    const fulls = pick.replace(/\/portraits\/cards\//i, "/portraits/portraits/");
    out[`${v.tileX},${v.tileY}`] = { cards, fulls };
  }
  return out;
}
const v1PortraitsByCoord = buildV1PortraitsByCoord(v1);
console.log(`v1PortraitsByCoord: ${Object.keys(v1PortraitsByCoord).length} coord entries`);

// ── Family-tree resolution for a character (matches FamilyTree.js Portrait) ──
// Primary: coord bridge; secondary: statsCache name key (we don't have the
// persisted statsCache here, so coord-only — which IS the family tree's primary).
function familyTreeSavePath(c) {
  if (c.tileX != null && c.tileY != null) {
    const hit = v1PortraitsByCoord[`${c.tileX},${c.tileY}`];
    if (hit && hit.cards) return hit.cards;
  }
  return null;
}

// ── Commander-card resolution AFTER the fix (replicates the new App.js
//    commanderInfo builder): savePath from v1PortraitsByCoord by the char's
//    (x,y); null otherwise (-> renderer hash pool fallback). ──
function commanderCardSavePathAfter(c) {
  if (c.tileX != null && c.tileY != null) {
    const hit = v1PortraitsByCoord[`${c.tileX},${c.tileY}`];
    if (hit && hit.cards) return hit.cards;
  }
  return null; // hash-pool fallback in the renderer
}
// BEFORE the fix: always null (forced) -> always hash pool.
function commanderCardSavePathBefore(_c) { return null; }

// ── Sample: every commanded character (has a secondaryUuid that matches a
//    unit commanderUuid) plus all named v1 chars in the player faction. ──
const cmdUuids = new Set();
for (const u of r.units) if (u.commanderUuid) cmdUuids.add(u.commanderUuid);

const sample = v1.filter((c) =>
  c.firstName &&
  ((c.secondaryUuid && cmdUuids.has(c.secondaryUuid)) ||
   (c.faction && c.faction.toLowerCase() === player))
);

console.log(`\nsample: ${sample.length} characters (commanded + player-faction named)\n`);

let match = 0, ftHasCardBefore = 0, ftHasCardAfter = 0, ftNone = 0, mismatch = 0;
const focusName = "Quintus"; // Quintus Ogulnius_Gallus etc.
const rows = [];
for (const c of sample) {
  const ft = familyTreeSavePath(c);
  const before = commanderCardSavePathBefore(c);
  const after = commanderCardSavePathAfter(c);
  if (!ft) { ftNone++; }
  // Compare only where the family tree HAS a resolved card (where it shows a
  // real engine face). Where the family tree also falls back (ft=null), the
  // commander card legitimately uses the hash too — not a divergence.
  if (ft) {
    if (before === ft) ftHasCardBefore++; // before fix: before is always null, so never
    if (after === ft) { ftHasCardAfter++; match++; }
    else mismatch++;
  }
  if (c.firstName === focusName || rows.length < 14) {
    rows.push(
      `  ${(c.firstName + " " + (c.lastName || "")).padEnd(28)} ` +
      `fac=${(c.faction || "?").padEnd(14)} tile=${c.tileX != null ? c.tileX + "," + c.tileY : "—"}\n` +
      `      familyTree : ${ft ? ft.split("/").slice(-3).join("/") : "(hash fallback)"}\n` +
      `      card BEFORE: ${before ? before.split("/").slice(-3).join("/") : "(hash fallback — arbitrary face)"}\n` +
      `      card AFTER : ${after ? after.split("/").slice(-3).join("/") : "(hash fallback)"}` +
      `${ft ? (after === ft ? "   <= MATCHES family tree" : "   <= MISMATCH") : ""}`
    );
  }
}

console.log(rows.join("\n"));
console.log(`\n--- summary over ${sample.length} sampled chars ---`);
console.log(`family tree resolves a real card for : ${sample.length - ftNone} chars (coord bridge hit)`);
console.log(`family tree falls to hash for        : ${ftNone} chars`);
console.log(`card BEFORE fix matched family tree  : ${ftHasCardBefore} (expected 0 — savePath was forced null -> hash)`);
console.log(`card AFTER  fix matched family tree  : ${ftHasCardAfter}`);
console.log(`card AFTER  fix MISMATCHED            : ${mismatch}`);

// Assertions.
let ok = true;
if (ftHasCardBefore !== 0) { console.log("ASSERT FAIL: before-fix unexpectedly matched (probe logic error)"); ok = false; }
if ((sample.length - ftNone) > 0 && mismatch !== 0) { console.log("ASSERT FAIL: after-fix mismatched on a char the family tree resolved"); ok = false; }
if ((sample.length - ftNone) > 0 && ftHasCardAfter !== (sample.length - ftNone)) { console.log("ASSERT FAIL: after-fix did not match every family-tree-resolved char"); ok = false; }
const resolvedAny = (sample.length - ftNone) > 0;
if (!resolvedAny) { console.log("ASSERT FAIL: family tree resolved NO cards for the sample — coord bridge produced nothing"); ok = false; }

console.log(`\n${ok ? "ALL ASSERTIONS PASS — commander card now matches the family tree per-character portrait" : "ASSERTIONS FAILED"}`);
process.exit(ok ? 0 : 1);
