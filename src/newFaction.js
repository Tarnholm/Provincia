// Create a BRAND-NEW faction by cloning a donor's scaffolding.  (2026-09-22)
//
// Not the same job as waking a dormant one (src/factionTransfer.js): that
// faction already exists everywhere the engine looks. A new one has to be
// registered from nothing, and the engine is unforgiving about where.
//
// WHICH FILES, MEASURED NOT GUESSED. For every candidate file I tested whether
// ALL 239 declared RIS factions appear in it. All → the engine needs it for
// every faction; only some → a faction can live without it. Mandatory:
//
//   descr_sm_factions.txt          the 103-line entry (culture, namelists, art
//                                  indices, colours, …)
//   descr_character.txt            several blocks — one per character-type section
//   descr_model_strat.txt          faction-tagged texture/model lines, 51 for parni
//                                  across 6 model types
//   descr_banners.txt              5 lines: standard / rebels / routing / ally
//   feral_descr_ai_personality.txt a `personality ai_<id>` block
//   the campaign's descr_strat.txt (handled by the caller — a new faction also
//                                  needs a leader, an heir and a town)
//   descr_win_conditions.txt       238 of 239 (all but the rebels)
//   text/expanded_bi.txt           {ID} and {ID_DESCR}, or the game shows the raw key
//
// Optional, and deliberately left alone: export_descr_buildings and
// export_descr_unit (recruitment — `gauls`, `germanics`, `greeks` and
// `scythians` have no entries at all and still exist), formations, logos,
// traits, battle models, ancillaries, rebel entries.
//
// NAMES ARE NOT PER-FACTION. descr_names_lookup and descr_namelists hold no
// faction tokens; descr_sm_factions points at a NAMELIST (85 pools serve 239
// factions), so a new faction reuses a pool and needs no new names.
//
// ART. Each cloned entry points at the donor's textures. The caller is given
// `artCopies` — copy the donor's file to the new faction's name and the entries
// already point at the copy, so replacing the art later is overwriting a file.
//
// Pure text: every function takes strings and returns strings. Nothing here
// reads or writes a disk.
"use strict";

const { settlementOwners, settlementExtent } = require("./factionTransfer.js");
const { REGION_LINE_RE } = require("./stratTokens.js");

const TOKEN = /^[a-z][a-z0-9_]*$/;
const strip = (l) => { const i = l.indexOf(";"); return i < 0 ? l : l.slice(0, i); };
const eolOf = (t) => (t.includes("\r\n") ? "\r\n" : "\n");
const linesOf = (t) => t.split(/\r?\n/);
// the faction token as a whole word, for substitution inside a cloned block
const tokenRe = (id) => new RegExp("(^|[^A-Za-z0-9_])" + id + "(?![A-Za-z0-9_])", "g");
const swapToken = (line, from, to) => line.replace(tokenRe(from), (m, p) => p + to);

// ── descr_sm_factions: the entry, from `\t"id":` to the next one ───────────
// Every faction declared in descr_sm_factions, in file order. This is the
// count that matters for the engine's ceiling, and the list of possible donors.
function listFactions(smText) {
  if (!smText) return [];
  return linesOf(smText).map((l) => (strip(l).match(/^\t"(\w+)":\s*$/) || [])[1]).filter(Boolean);
}

function smEntry(text, id) {
  const lines = linesOf(text);
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const m = strip(lines[i]).match(/^\t"(\w+)":\s*$/);
    if (m) heads.push({ id: m[1], i });
  }
  const k = heads.findIndex((h) => h.id === id);
  if (k < 0) return null;
  // The entry ends at its own closing `\t},` — not at the next entry, and above
  // all not at end of file: the LAST entry (RIS: dummies) used to run on to
  // the file's closing `],`, and the clone carried that bracket with it.
  const limit = k + 1 < heads.length ? heads[k + 1].i : lines.length;
  let end = -1;
  for (let i = heads[k].i + 1; i < limit; i++) if (/^\t\}/.test(strip(lines[i]))) { end = i + 1; break; }
  if (end < 0) return null;
  return { start: heads[k].i, end, lines: lines.slice(heads[k].i, end), all: heads.map((h) => h.id) };
}

// ── blocks that start with `faction <id>` and run to the next such line ────
// …or to a line matching `stopRe`. descr_character is split into `type <x>`
// sections and `slave` is the last faction in each, so without a stop its
// block ran on through `type general`, `actions …` and `wage_base` — the clone
// copied the next section's header and landed inside that section.
function factionBlocks(text, id, startRe, stopRe) {
  const lines = linesOf(text);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = strip(lines[i]).match(startRe);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !startRe.test(strip(lines[j])) && !(stopRe && stopRe.test(strip(lines[j])))) j++;
    if (m[1] === id) {
      // trim trailing blank and comment-only lines: they belong to whatever
      // follows, and the clone goes in right after the donor's last real line
      let e = j;
      while (e > i + 1 && !strip(lines[e - 1]).trim()) e--;
      out.push({ start: i, end: e, lines: lines.slice(i, e) });
    }
    i = j - 1;
  }
  return out;
}

// Add a cloned block after the donor's last block of that kind.
function cloneBlocks(text, donor, newId, startRe, renamePath, stopRe) {
  const blocks = factionBlocks(text, donor, startRe, stopRe);
  if (!blocks.length) return null;
  const eol = eolOf(text);
  const lines = linesOf(text);
  const copies = [];
  let added = 0;
  for (const b of blocks.slice().reverse()) {
    const clone = b.lines.map((l) => {
      // paths FIRST: `.../ris/parni/eastern_general_parni.tga` has its directory
      // swapped by the token pass too, and then the recorded source would be a
      // path that never existed
      const withPaths = renamePath ? renamePath(l, copies) : l;
      return swapToken(withPaths, donor, newId);
    });
    lines.splice(b.end, 0, "", ...clone);
    added += clone.length;
  }
  return { text: lines.join(eol), blocks: blocks.length, added, copies };
}

// Rewrite a texture path that carries the donor's name, and record the copy.
function pathRenamer(donor, newId) {
  const re = new RegExp("([\\w./\\\\-]*" + donor + "[\\w./-]*\\.(?:tga|dds|png))", "gi");
  return (line, copies) => line.replace(re, (p) => {
    const to = p.replace(new RegExp(donor, "gi"), newId);
    if (p !== to && !copies.some((c) => c.from === p)) copies.push({ from: p, to });
    return to;
  });
}

/**
 * Everything a new faction needs, as edited text plus a list of art to copy.
 *
 *   files      { smFactions, character, modelStrat, banners, aiPersonality,
 *                winConditions?, expandedText? } — raw contents
 *   donor      the faction to clone
 *   newId      the new faction token
 *   displayName / description   shown in game (written to expandedText)
 *   culture / namelists / colours   optional overrides of the donor's values
 *
 * Returns { edits, artCopies, summary, warnings, errors }. Any error → no edits.
 */
function planNewFaction({ files = {}, donor, newId, displayName, description, culture = null, namelists = null, colours = null } = {}) {
  const errors = [], warnings = [], edits = {}, artCopies = [];
  const fail = (m) => ({ edits: {}, artCopies: [], summary: null, warnings, errors: [m] });

  if (!donor || !newId) return fail("a donor faction and a new faction id are required");
  const id = String(newId).toLowerCase();
  if (!TOKEN.test(id)) return fail(`"${newId}" is not a usable faction id — lower case letters, digits and underscores, starting with a letter`);
  if (id === String(donor).toLowerCase()) return fail("the new faction needs a different id from its donor");

  const sm = files.smFactions ? smEntry(files.smFactions, donor) : null;
  if (!files.smFactions) return fail("descr_sm_factions.txt is required");
  if (!sm) return fail(`"${donor}" has no entry in descr_sm_factions.txt`);
  if (sm.all.includes(id)) return fail(`"${id}" already exists in this mod`);

  const summary = { newId: id, donor, factionCountBefore: sm.all.length, files: {}, art: 0 };

  // 1. descr_sm_factions — the entry itself
  {
    const eol = eolOf(files.smFactions);
    const lines = linesOf(files.smFactions);
    const renameArt = pathRenamer(donor, id);
    // Only the KEY is renamed here, never the body. The body names the donor in
    // four other places and each must stay: "parni_men"/"parni_women" are
    // namelist pools that exist (and are meant to be shared), and
    // "horde parni horse archers" and friends are UNIT names out of
    // export_descr_unit — renaming those invents units the mod does not have.
    // The one exception is the faction icon, which is art and gets copied.
    const clone = sm.lines.map((l, ix) => {
      let out = ix === 0 ? l.replace(/"\w+"\s*:/, `"${id}":`) : l;
      out = renameArt(out, artCopies);
      const s = strip(out);
      if (/^\s*"string"\s*:/.test(s)) out = out.replace(/"string"\s*:\s*"[^"]*"/, `"string":      "${id.toUpperCase()}"`);
      if (/^\s*"description"\s*:/.test(s)) out = out.replace(/"description"\s*:\s*"[^"]*"/, `"description": "${id.toUpperCase()}_DESCR"`);
      if (culture && /^\s*"culture"\s*:/.test(s)) out = out.replace(/"culture"\s*:\s*"[^"]*"/, `"culture":   "${culture}"`);
      if (namelists) {
        if (namelists.men && /^\s*"men"\s*:/.test(s)) out = out.replace(/"men"\s*:\s*"[^"]*"/, `"men":      "${namelists.men}"`);
        if (namelists.women && /^\s*"women"\s*:/.test(s)) out = out.replace(/"women"\s*:\s*"[^"]*"/, `"women":    "${namelists.women}"`);
        if (namelists.surnames && /^\s*"surnames"\s*:/.test(s)) out = out.replace(/"surnames"\s*:\s*"[^"]*"/, `"surnames": "${namelists.surnames}"`);
      }
      if (colours) {
        if (colours.primary && /^\s*"primary"\s*:/.test(s)) out = out.replace(/"primary"\s*:\s*\[[^\]]*\]/, `"primary":   [ ${colours.primary.join(", ")}, ]`);
        if (colours.secondary && /^\s*"secondary"\s*:/.test(s)) out = out.replace(/"secondary"\s*:\s*\[[^\]]*\]/, `"secondary": [ ${colours.secondary.join(", ")}, ]`);
      }
      return out;
    });
    // JSON-ish list: if the donor's closing brace carried no comma (last
    // entry of a strict file), the donor now needs one and the clone ends as
    // the donor did
    const close = sm.end - 1;
    if (!/,\s*$/.test(strip(lines[close]).replace(/\s+$/, ""))) {
      lines[close] = lines[close].replace(/\}/, "},");
    }
    lines.splice(sm.end, 0, ...clone);
    edits.smFactions = lines.join(eol);
    summary.files.smFactions = clone.length + " lines";
  }

  // 2. descr_banners / 3. descr_character — `faction <id>` blocks, art renamed
  for (const [key, label] of [["banners", "descr_banners.txt"], ["character", "descr_character.txt"]]) {
    if (!files[key]) { warnings.push(`${label} was not supplied — the faction may not display correctly`); continue; }
    const r = cloneBlocks(files[key], donor, id, /^faction\s+(\w+)\s*$/, pathRenamer(donor, id), /^\s*type\b/);
    if (!r) { errors.push(`"${donor}" has no block in ${label}`); continue; }
    edits[key] = r.text;
    artCopies.push(...r.copies);
    summary.files[key] = `${r.blocks} block(s)`;
  }

  // 4. feral_descr_ai_personality — a personality that REFERENCES the donor's
  //    priority tables, rather than duplicating them
  if (files.aiPersonality) {
    const r = cloneBlocks(files.aiPersonality, "ai_" + donor, "ai_" + id, /^personality\s+(\w+)\s*$/, null);
    if (r) { edits.aiPersonality = r.text; summary.files.aiPersonality = "personality ai_" + id; }
    else errors.push(`"${donor}" has no personality block in feral_descr_ai_personality.txt`);
  } else warnings.push("feral_descr_ai_personality.txt was not supplied — the faction may have no AI behaviour");

  // 5. descr_model_strat — duplicate every faction-tagged line
  if (files.modelStrat) {
    const eol = eolOf(files.modelStrat);
    const lines = linesOf(files.modelStrat);
    const re = tokenRe(donor);
    const out = [];
    let tagged = 0;
    const copies = [];
    const rename = pathRenamer(donor, id);
    for (const l of lines) {
      out.push(l);
      re.lastIndex = 0;
      if (!re.test(strip(l))) continue;
      // only lines that TAG a faction, not prose or a path that merely contains it
      if (!/^\s*(texture|pbr_texture|model|no_variation)\b/.test(strip(l))) continue;
      out.push(swapToken(rename(l, copies), donor, id)); // paths first — see cloneBlocks
      tagged++;
    }
    edits.modelStrat = out.join(eol);
    artCopies.push(...copies);
    summary.files.modelStrat = tagged + " line(s)";
    if (!tagged) warnings.push("no strat-model lines found for the donor — the new faction may show no map models");
  } else warnings.push("descr_model_strat.txt was not supplied — the faction may show no models on the map");

  // 6. descr_win_conditions — every faction but the rebels has an entry
  if (files.winConditions) {
    // this file names the faction on a bare line, with its conditions under it
    const r = cloneBlocks(files.winConditions, donor, id, /^(\w+)\s*$/, null);
    if (r) { edits.winConditions = r.text; summary.files.winConditions = `${r.blocks} block(s)`; }
    else warnings.push(`"${donor}" has no block in descr_win_conditions.txt — the new faction will have no victory conditions`);
  }

  // 7. the display name, or the game shows the raw key
  if (files.expandedText != null) {
    const eol = eolOf(files.expandedText) || "\r\n";
    const key = id.toUpperCase();
    if (new RegExp("^\\{" + key + "\\}", "m").test(files.expandedText)) warnings.push(`{${key}} already exists in the text file — left as it is`);
    else {
      const name = displayName || id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const desc = (description || name).replace(/\r?\n/g, "\\n");
      edits.expandedText = files.expandedText.replace(/\s*$/, "") + eol +
        `{${key}}\t\t\t\t\t${name}` + eol +
        `{${key}_DESCR}\t\t\t\t\t${desc}` + eol;
      summary.files.expandedText = `{${key}} and {${key}_DESCR}`;
    }
  } else warnings.push("no text file supplied — the faction will show as its raw key in game");

  if (errors.length) return { edits: {}, artCopies: [], summary: null, warnings, errors };

  // de-duplicate the art list; the same texture is often named by several lines
  const seen = new Set();
  const art = artCopies.filter((c) => (seen.has(c.from + "|" + c.to) ? false : seen.add(c.from + "|" + c.to)));
  summary.art = art.length;
  summary.factionCountAfter = sm.all.length + 1;
  return { edits, artCopies: art, summary, warnings, errors: [] };
}

// ── the campaign side ───────────────────────────────────────────────────────
// A faction in the scaffolding files still does not play: descr_strat has to
// declare it, give it a town, and give it a FAMILY. RTW destroys a faction the
// moment its last living male family member dies, so a leader and an heir are
// the minimum for one that survives its first turn — the tool refuses without
// them (user rule, 2026-09-22).
//
// Names are NOT minted. descr_sm_factions points the faction at a namelist pool
// and those names are already registered everywhere the engine looks, so the
// leader and heir are drawn from that pool; nothing has to be added to
// names.txt, descr_names_lookup or descr_namelists.

// A pool's names, following one level of "inherit".
function readNamelist(namelistsText, pool, depth) {
  if (!namelistsText || !pool) return [];
  const re = new RegExp('"' + pool + '"\\s*:\\s*\\{', "g");
  const m = re.exec(namelistsText);
  if (!m) return [];
  // the pool object, to its closing brace
  let i = m.index + m[0].length, depthB = 1;
  while (i < namelistsText.length && depthB > 0) {
    const c = namelistsText[i];
    if (c === "{") depthB++; else if (c === "}") depthB--;
    i++;
  }
  const body = namelistsText.slice(m.index, i);
  // only what is inside the "names" [ … ] array — "inherit" holds a POOL name,
  // not a person, and reading it as one christened a leader "iranian_men".
  const arr = body.match(/"names"\s*:?\s*\[([\s\S]*?)\]/);
  const names = arr ? [...arr[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  const inherit = (body.match(/"inherit"\s*:\s*"([^"]+)"/) || [])[1];
  const parent = inherit && (depth || 0) < 3 ? readNamelist(namelistsText, inherit, (depth || 0) + 1) : [];
  const seen = new Set();
  return [...names, ...parent].filter((n) => (seen.has(n) ? false : seen.add(n)));
}

/**
 * Declare the new faction in a campaign and give it a home.
 *
 *   stratText     the campaign
 *   newId         the new faction token
 *   after         put its block after this faction's (keeps the file tidy)
 *   aiLabel       e.g. "ai_east"
 *   settlements   [region, …] on this map, handed over from their current owner
 *   leader/heir   { name, age } — both required
 *   at            { x, y } for the characters
 *   playable      list it as playable rather than nonplayable
 */
function planFactionStratEntry({ stratText, newId, after, aiLabel = "ai_barbarian", settlements = [], leader = null, heir = null, at = null, denari = 5000, playable = false } = {}) {
  const errors = [], warnings = [];
  const fail = (m) => ({ text: stratText, summary: null, warnings, errors: [m] });
  if (!stratText || !newId) return fail("a campaign and a faction id are required");
  const id = String(newId).toLowerCase();
  const eol = eolOf(stratText);
  let lines = linesOf(stratText);

  if (linesOf(stratText).some((l) => new RegExp("^faction\\s+" + id + "\\s*,").test(strip(l)))) return fail(`"${id}" already has a block in this campaign`);
  if (!leader || !leader.name) return fail("a new faction needs a leader — without a family member it is destroyed on the first turn");
  if (!heir || !heir.name) return fail("a new faction needs an heir as well as a leader");
  if (!settlements.length) return fail("a new faction needs at least one settlement, or it is destroyed at once");
  if (!at || at.x == null || at.y == null) return fail("no map position for the leader and heir");

  // 1. take the settlements from whoever holds them
  const owners = settlementOwners(stratText);
  const taken = [];
  for (const region of settlements) {
    const o = owners[region];
    if (!o) return fail(`no settlement in region "${region}" on this map`);
    taken.push({ region, from: o.faction, level: o.level });
    if (o.faction !== "slave") warnings.push(`${region} is taken from ${o.faction}, which loses a settlement`);
  }
  // Taking a faction's LAST town destroys it on turn one — the same rule that
  // makes the leader and heir mandatory here. Worth saying out loud.
  for (const f of new Set(taken.map((t) => t.from))) {
    if (f === "slave") continue;
    const held = Object.keys(owners).filter((k) => owners[k].faction === f);
    if (held.every((k) => taken.some((t) => t.region === k))) warnings.push(`${f} is left with NO settlements and will be destroyed — leave it one, or expect it gone`);
  }
  const cuts = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^settlement\b/.test(strip(lines[i]).trim())) continue;
    const end = settlementExtent(lines, i);
    const body = lines.slice(i, end).map(strip);
    const rm = (body.find((l) => REGION_LINE_RE.test(l)) || "").match(REGION_LINE_RE);
    if (rm && taken.some((t) => t.region === rm[1])) cuts.push({ region: rm[1], start: i, end, lines: lines.slice(i, end) });
    i = end - 1;
  }
  for (const c of cuts.slice().sort((a, b) => b.start - a.start)) lines.splice(c.start, c.end - c.start);

  // 2. declare it, next to the faction it was cloned from where possible
  let declared = false;
  const listName = playable ? "playable" : "nonplayable";
  for (let i = 0; i < lines.length && !declared; i++) {
    if (strip(lines[i]).trim() !== listName) continue;
    let j = i + 1;
    while (j < lines.length && strip(lines[j]).trim() !== "end") j++;
    const near = after ? lines.slice(i + 1, j).findIndex((l) => strip(l).trim() === after) : -1;
    const atIdx = near >= 0 ? i + 1 + near + 1 : j;
    const sample = lines[i + 1] || "\t" + id;
    const indent = (sample.match(/^\s*/) || [""])[0] || "\t";
    lines.splice(atIdx, 0, indent + id);
    declared = true;
  }
  if (!declared) return fail(`this campaign has no "${listName}" list to declare the faction in`);

  // 3. the faction block, after the donor's
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = strip(lines[i]).match(/^faction\s+([a-z_0-9]+)\s*,/i);
    if (m) blocks.push({ faction: m[1].toLowerCase(), start: i });
  }
  if (!blocks.length) return fail("this campaign has no faction blocks");
  for (let k = 0; k < blocks.length; k++) blocks[k].end = k + 1 < blocks.length ? blocks[k + 1].start : lines.length;
  const host = blocks.find((b) => b.faction === String(after || "").toLowerCase()) || blocks[blocks.length - 1];

  const body = [`faction\t${id}, ${aiLabel}`, `denari\t${denari}`];
  for (const t of taken) body.push(...cuts.find((c) => c.region === t.region).lines);
  body.push(`character\t${leader.name}, named character, leader, age ${leader.age || 40}, , x ${at.x}, y ${at.y}`);
  body.push(`character\t${heir.name}, named character, heir, age ${heir.age || 20}, , x ${at.x}, y ${at.y}`);
  body.push("");
  lines.splice(host.end, 0, ...body);

  return {
    text: lines.join(eol),
    summary: { faction: id, declaredAs: listName, settlements: taken, leader: leader.name, heir: heir.name, at, denari },
    warnings, errors: [],
  };
}

// ── recruitment ─────────────────────────────────────────────────────────────
// A faction may only recruit and build what names it in export_descr_buildings.
// Every `factions { … }` list that names the donor is an offer the new faction
// can be added to; the user picks which (they asked to choose rather than take
// the lot — one faction is named on ~260 lines of RIS's EDB).

function listRecruitOptions(edbText, donor) {
  if (!edbText || !donor) return [];
  const lines = linesOf(edbText);
  const out = [];
  let building = null, level = null;
  const has = tokenRe(donor);
  for (let i = 0; i < lines.length; i++) {
    const s = strip(lines[i]);
    const b = s.match(/^building\s+(\w+)/); if (b) { building = b[1]; level = null; }
    // the shared `alias <name>` chains sit outside any building and grant just
    // as much, so they are named rather than left blank in the picker
    const a = s.match(/^\s*alias\s+(\w+)/); if (a) { building = "alias " + a[1]; level = null; }
    const r = s.match(/^\s*recruit(?:_pool)?\s+"([^"]+)"/);
    const lv = !r && s.match(/^\s*(\w+)\s+requires\b/); if (lv) level = lv[1];
    if (!/\bfactions\s*\{/.test(s)) continue;
    // `requires not factions { … }` is an EXCLUSION: putting the new token in it
    // would forbid the thing rather than grant it. A faction absent from such a
    // list is already allowed, so there is nothing to offer.
    if (/\bnot\s+factions\s*\{/.test(s)) continue;
    has.lastIndex = 0;
    if (!has.test(s)) continue;
    out.push({ line: i, building, level, unit: r ? r[1] : null, kind: r ? "recruit" : "building", text: s.trim().slice(0, 160) });
  }
  return out;
}

function planRecruitment({ edbText, donor, newId, lines: picked = [] } = {}) {
  if (!edbText || !donor || !newId) return { text: edbText, changed: 0, errors: ["edbText, donor and newId are required"] };
  const id = String(newId).toLowerCase();
  const eol = eolOf(edbText);
  const lines = linesOf(edbText);
  const want = new Set(picked);
  let changed = 0;
  for (const i of want) {
    const l = lines[i];
    if (l == null) continue;
    const re = new RegExp("(factions\\s*\\{[^}]*?)(" + donor + ")(\\s*[,}])", "i");
    if (/\bnot\s+factions\s*\{/.test(strip(l))) continue; // an exclusion — see listRecruitOptions
    if (!re.test(strip(l))) continue;
    lines[i] = l.replace(re, (m, a, d, z) => a + d + ", " + id + z);
    changed++;
  }
  return { text: lines.join(eol), changed, errors: [] };
}

module.exports = { planNewFaction, listFactions, planFactionStratEntry, planRecruitment, listRecruitOptions, readNamelist, smEntry, factionBlocks, cloneBlocks, pathRenamer, TOKEN };
