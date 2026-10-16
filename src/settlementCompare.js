// Compare a settlement on this map with the same settlement in the main mod,
// and copy across what the user picks.  (2026-10-16)
//
// WHY. The submods' towns were written by hand and are often thin: RIS_Light's
// Arretium can be a 400-pop town with one building where the main mod has a
// 5,100-pop large town with twelve. The main mod's block is the fuller one,
// so filling a submod town is mostly "take these lines from over there".
//
// WHAT IS COMPARED. The settlement's own lines — level, population,
// year_founded, plan_set, faction_creator — and its live buildings, one row
// per chain (RTW allows one building per chain). `;GOVPO`-style commented
// buildings are neither read nor touched, and nor is anything else in the
// block (a rebel garrisoned_army stays where it is).
//
// HOW IT IS COPIED. In place, with the town's layout kept: a field keeps its
// line and indentation and only the value changes; a chain both towns have
// changes only the level on its `type` line; a chain only the main mod has
// arrives as the main mod's own building block, after the last live one; a
// chain removed (only when asked) loses just its block.
//
// Pure text in, text out; src/settlementCompare.test.js runs it against the
// real RIS and RIS_Light files.
"use strict";

const { REGION_LINE_RE } = require("./stratTokens.js");
const ft = require("./factionTransfer.js");

const FIELDS = ["level", "population", "year_founded", "plan_set", "faction_creator"];
// RTW's settlement ladder (engine-fixed; descr_strat `level` takes these)
const LEVELS = ["village", "town", "large_town", "city", "large_city", "huge_city"];

const strip = (l) => { const i = l.indexOf(";"); return i < 0 ? l : l.slice(0, i); };
const eolOf = (text) => (text.includes("\r\n") ? "\r\n" : "\n");

// Every settlement on a map: [{ region, owner, start, end }] (end exclusive).
function settlementIndex(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const b of ft.factionBlocks(lines)) {
    for (let i = b.start + 1; i < b.end; i++) {
      if (!/^settlement\b/.test(strip(lines[i]).trim())) continue;
      const end = ft.settlementExtent(lines, i);
      const rm = (lines.slice(i, end).map(strip).find((l) => REGION_LINE_RE.test(l)) || "").match(REGION_LINE_RE);
      if (rm) out.push({ region: rm[1], owner: b.faction, start: i, end });
      i = end - 1;
    }
  }
  return out;
}

// One settlement block's lines → { fields: {key: {value, idx}}, buildings:
// [{ chain, level, start, end, typeIdx }], regionIdx, closeIdx }. Indices are
// into `lines`; a building's end is exclusive.
function readSettlement(lines) {
  const fields = {}, buildings = [];
  let depth = 0, regionIdx = -1, closeIdx = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    const code = strip(lines[i]);
    const t = code.trim();
    if (depth === 1) {
      const f = t.match(/^([a-z_]+)\s+(\S+)/);
      if (f && FIELDS.includes(f[1]) && !fields[f[1]]) fields[f[1]] = { value: f[2], idx: i };
      if (REGION_LINE_RE.test(code) && regionIdx < 0) regionIdx = i;
      if (/^building\b/.test(t)) {
        // building / { / type chain level / }
        let j = i + 1, d = 0, opened = false, chain = null, level = null, typeIdx = -1;
        for (; j < lines.length; j++) {
          const c = strip(lines[j]);
          const tm = c.trim().match(/^type\s+(\S+)\s+(\S+)/);
          if (tm && chain == null) { chain = tm[1]; level = tm[2]; typeIdx = j; }
          for (const ch of c) { if (ch === "{") { d++; opened = true; } else if (ch === "}") d--; }
          if (opened && d <= 0) break;
        }
        if (chain) buildings.push({ chain, level, start: i, end: j + 1, typeIdx });
        i = j;
        continue;
      }
    }
    for (const ch of code) { if (ch === "{") depth++; else if (ch === "}") { depth--; if (depth === 0) closeIdx = i; } }
  }
  return { fields, buildings, regionIdx, closeIdx };
}

// Where `a` stands against `b` on a ladder: >0 higher, <0 lower, 0 same, null unknown.
function rank(ladder, a, b) {
  if (!ladder) return null;
  const i = ladder.indexOf(a), j = ladder.indexOf(b);
  return i < 0 || j < 0 ? null : i - j;
}

/**
 * Side by side. `catalogue` (src/buildingCatalogue.js) is optional and only
 * orders levels within a chain.
 * Returns { fields: [{ key, here, there }], buildings: [{ chain, here, there,
 * status, duplicate }] } — status: "missing" (main only), "only_here", "same",
 * "higher_there", "lower_there", "different" (levels not on one ladder),
 * "duplicate" (same level, but listed more than once here — RIS_Light had
 * three such towns on 2026-10-16). `duplicate` is set whatever the status.
 */
function compareSettlement(hereLines, thereLines, catalogue = null) {
  const h = readSettlement(hereLines), t = readSettlement(thereLines);
  const fields = FIELDS.map((key) => ({ key, here: h.fields[key] ? h.fields[key].value : null, there: t.fields[key] ? t.fields[key].value : null }))
    .filter((f) => f.here != null || f.there != null);
  const chains = [];
  for (const b of [...t.buildings, ...h.buildings]) if (!chains.includes(b.chain)) chains.push(b.chain);
  const buildings = chains.map((chain) => {
    const a = h.buildings.find((b) => b.chain === chain), b = t.buildings.find((x) => x.chain === chain);
    const duplicate = h.buildings.filter((x) => x.chain === chain).length > 1;
    let status;
    if (!a) status = "missing";
    else if (!b) status = "only_here";
    else if (a.level === b.level) status = duplicate ? "duplicate" : "same";
    else {
      const r = rank(catalogue && catalogue.chains ? catalogue.chains[chain] : null, b.level, a.level);
      status = r == null ? "different" : r > 0 ? "higher_there" : "lower_there";
    }
    return { chain, here: a ? a.level : null, there: b ? b.level : null, status, duplicate };
  });
  return { fields, buildings };
}

// Is the main-mod value of a field more than this town has? (what "fill in
// what is missing" takes)
function fieldIsMore(key, here, there) {
  if (there == null) return false;
  if (here == null) return true;
  if (key === "level") { const r = rank(LEVELS, there, here); return r != null && r > 0; }
  if (key === "population") return +there > +here;
  return false;
}

/**
 * Copy the chosen parts of the main-mod settlement into this one.
 *   choice = { fields: [key], buildings: [chain], remove: [chain] }
 * `buildings` takes the main mod's level for a chain (adding the chain if this
 * town lacks it, and dropping any second copy of it); `remove` drops a chain
 * only this town has, every copy.
 * Returns { lines, changes: [text] } or { error }.
 */
function applyToSettlement(hereLines, thereLines, choice = {}) {
  const h = readSettlement(hereLines), t = readSettlement(thereLines);
  const lines = hereLines.slice();
  const changes = [];
  const edits = []; // { at, del, ins } applied bottom-up
  for (const key of choice.fields || []) {
    const src = t.fields[key];
    if (!src) return { error: `the main-mod town has no ${key} line` };
    const cur = h.fields[key];
    if (cur) {
      if (cur.value === src.value) continue;
      edits.push({ at: cur.idx, del: 1, ins: [lines[cur.idx].replace(/^(\s*[a-z_]+\s+)\S+/, `$1${src.value}`)] });
      changes.push(`${key} ${cur.value} → ${src.value}`);
    } else {
      if (h.regionIdx < 0) return { error: "this town has no region line" };
      const indent = (lines[h.regionIdx].match(/^(\s*)/) || ["", ""])[1];
      edits.push({ at: h.regionIdx + 1, del: 0, ins: [`${indent}${key} ${src.value}`] });
      changes.push(`${key} ${src.value} added`);
    }
  }
  const remove = new Set(choice.remove || []);
  const lastKept = [...h.buildings].reverse().find((b) => !remove.has(b.chain));
  const appendAt = lastKept ? lastKept.end : h.closeIdx;
  const appended = [];
  for (const chain of choice.buildings || []) {
    const src = t.buildings.find((b) => b.chain === chain);
    if (!src) return { error: `the main-mod town has no ${chain} building` };
    const [cur, ...extra] = h.buildings.filter((b) => b.chain === chain);
    if (cur) {
      for (const x of extra) edits.push({ at: x.start, del: x.end - x.start, ins: [] });
      if (extra.length) changes.push(`${chain} second copy removed`);
      if (cur.level === src.level) continue;
      edits.push({ at: cur.typeIdx, del: 1, ins: [lines[cur.typeIdx].replace(/^(\s*type\s+\S+\s+)\S+/, `$1${src.level}`)] });
      changes.push(`${chain} ${cur.level} → ${src.level}`);
    } else {
      appended.push(...thereLines.slice(src.start, src.end));
      changes.push(`${chain} ${src.level} added`);
    }
  }
  if (appended.length) edits.push({ at: appendAt, del: 0, ins: appended, order: 1 });
  for (const chain of remove) {
    const all = h.buildings.filter((b) => b.chain === chain);
    if (!all.length) continue;
    if (t.buildings.some((b) => b.chain === chain)) return { error: `${chain} is in the main-mod town too — take its level instead of removing it` };
    for (const cur of all) edits.push({ at: cur.start, del: cur.end - cur.start, ins: [] });
    changes.push(`${chain} ${all[0].level} removed`);
  }
  // bottom-up; at one index an insertion goes after the line edits there
  edits.sort((a, b) => (b.at - a.at) || ((a.order || 0) - (b.order || 0)));
  for (const e of edits) lines.splice(e.at, e.del, ...e.ins);
  return { lines, changes };
}

/**
 * The whole-file step: find both towns, copy, splice back.
 * Returns { text, changes, errors }; on an error the text is unchanged.
 */
function planSettlementCopy({ targetText, sourceText, targetRegion, sourceRegion, choice } = {}) {
  const fail = (msg) => ({ text: targetText, changes: [], errors: [msg] });
  if (!targetText || !sourceText) return fail("both campaigns are needed");
  const here = settlementIndex(targetText).find((s) => s.region === targetRegion);
  if (!here) return fail(`no settlement in region "${targetRegion}" on this map`);
  const there = settlementIndex(sourceText).find((s) => s.region === (sourceRegion || targetRegion));
  if (!there) return fail(`no settlement in region "${sourceRegion || targetRegion}" in the main mod`);
  const tl = targetText.split(/\r?\n/), sl = sourceText.split(/\r?\n/);
  const r = applyToSettlement(tl.slice(here.start, here.end), sl.slice(there.start, there.end), choice);
  if (r.error) return fail(r.error);
  tl.splice(here.start, here.end - here.start, ...r.lines);
  return { text: tl.join(eolOf(targetText)), changes: r.changes, errors: [] };
}

module.exports = { FIELDS, LEVELS, settlementIndex, readSettlement, compareSettlement, applyToSettlement, planSettlementCopy, fieldIsMore };
