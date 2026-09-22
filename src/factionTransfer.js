// Bring a dormant faction onto a campaign map — the text layer.  (2026-09-22)
//
// WHY. A submod declares the same factions as the main mod but leaves most of
// them as stubs: `faction <name>, ai_x` / `dead_until_resurrected` /
// `re_emergent` / `denari 5000`. Measured on RIS: the main campaign has 220
// factions holding settlements, RIS_Light 102 and RIS_Classic 55, with 137 and
// 183 stubs respectively. So "adding a faction" is really WAKING one.
//
// WHAT CANNOT BE COPIED. The submods are consolidated maps with their own
// descr_regions (Light 422 regions, Classic 300, against the main mod's 1,312),
// so a faction's main-mod holdings mostly do not exist there: of the factions
// dormant in Light, exactly ONE has all its main-mod towns present, 49 have
// some and 11 have none. Settlements therefore come from the TARGET map — the
// existing block is moved from whoever holds it — and only the roster
// (characters, their armies, family records) is carried over from the main mod.
// Its x,y are main-map coordinates and are rewritten on the way in.
//
// WHAT IS SAFE TO CARRY. Neither submod ships export_descr_unit.txt, names.txt
// or descr_namelists.txt, so unit names and character names from the main mod
// resolve through the base mod exactly as they do there. Family records and
// `relative` lines carry no coordinates and move verbatim.
//
// Pure text in, text out: no fs, no IPC. Everything here is exercised against
// the real RIS files in src/factionTransfer.test.js.
"use strict";

const { REGION_LINE_RE } = require("./stratTokens.js");

// A line that opens a new top-level item inside a faction block.
const TOP = /^(faction|settlement|character|character_record|relative|standing|alliance)\b/;

function splitLines(text) { return text.split(/\r?\n/); }
function eolOf(text) { return text.includes("\r\n") ? "\r\n" : "\n"; }
const strip = (l) => { const i = l.indexOf(";"); return i < 0 ? l : l.slice(0, i); };

// The faction blocks, in file order: { faction, start, end } over `lines`.
function factionBlocks(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = strip(lines[i]).match(/^faction\s+([a-z_0-9]+)\s*,/i);
    if (!m) continue;
    if (out.length) out[out.length - 1].end = i;
    out.push({ faction: m[1].toLowerCase(), start: i, end: lines.length });
  }
  return out;
}

function blockOf(lines, faction) {
  return factionBlocks(lines).find((b) => b.faction === String(faction).toLowerCase()) || null;
}

// A `settlement` item: its line plus the balanced { … } that follows.
function settlementExtent(lines, i) {
  let j = i + 1, depth = 0, opened = false;
  while (j < lines.length) {
    const l = strip(lines[j]);
    for (const ch of l) { if (ch === "{") { depth++; opened = true; } else if (ch === "}") depth--; }
    j++;
    if (opened && depth <= 0) break;
  }
  return j; // exclusive
}

// A `character` item: its line plus traits/ancillaries/army/unit lines under it.
function characterExtent(lines, i) {
  let j = i + 1;
  while (j < lines.length && !TOP.test(strip(lines[j]).trim())) j++;
  return j;
}

// Everything about one faction, as text that can be moved.
function readFactionRoster(stratText, faction) {
  const lines = splitLines(stratText);
  const b = blockOf(lines, faction);
  if (!b) return null;
  const out = {
    faction: String(faction).toLowerCase(),
    aiLabel: (strip(lines[b.start]).match(/^faction\s+[a-z_0-9]+\s*,\s*(.+?)\s*$/i) || [])[1] || null,
    denari: null, dormant: false, reEmergent: false,
    settlements: [], characters: [], family: [], relatives: [],
  };
  for (let i = b.start + 1; i < b.end; i++) {
    const raw = lines[i], t = strip(raw).trim();
    if (/^dead_until_resurrected\b/.test(t)) { out.dormant = true; continue; }
    if (/^re_emergent\b/.test(t)) { out.reEmergent = true; continue; }
    const dm = t.match(/^denari\s+(\d+)/);
    if (dm) { out.denari = +dm[1]; continue; }

    if (/^settlement\b/.test(t)) {
      const end = settlementExtent(lines, i);
      const body = lines.slice(i, end);
      const region = (body.map(strip).find((l) => REGION_LINE_RE.test(l)) || "").match(REGION_LINE_RE);
      const level = (body.map(strip).find((l) => /^\s*level\s+/.test(l)) || "").trim().split(/\s+/)[1] || null;
      out.settlements.push({ region: region ? region[1] : null, level, lines: body });
      i = end - 1; continue;
    }

    if (/^character\s/.test(t)) {
      const end = characterExtent(lines, i);
      const body = lines.slice(i, end);
      const head = strip(body[0]);
      const parts = head.replace(/^character\s+/, "").split(",").map((s) => s.trim());
      const x = (head.match(/\bx\s+(-?\d+)/) || [])[1];
      const y = (head.match(/\by\s+(-?\d+)/) || [])[1];
      const army = body.map(strip).filter((l) => /^\s*unit\s/.test(l)).map((l) => l.trim().replace(/^unit\s+/, "").split(/\s{2,}|\t+/)[0].trim());
      out.characters.push({
        name: parts[0] || null,
        kind: parts[1] || null,
        role: /\bleader\b/.test(head) ? "leader" : /\bheir\b/.test(head) ? "heir" : null,
        age: +((head.match(/\bage\s+(\d+)/) || [])[1] || 0) || null,
        x: x == null ? null : +x, y: y == null ? null : +y,
        army, unitCount: army.length, lines: body,
      });
      i = end - 1; continue;
    }

    if (/^character_record\s/.test(t)) {
      const parts = t.replace(/^character_record\s+/, "").split(",").map((s) => s.trim());
      out.family.push({
        name: parts[0] || null,
        gender: /\bfemale\b/.test(t) ? "female" : "male",
        age: +((t.match(/\bage\s+(\d+)/) || [])[1] || 0) || null,
        alive: !/\bdead\b/.test(t),
        line: raw,
      });
      continue;
    }

    if (/^relative\s/.test(t)) {
      const names = t.replace(/^relative\s+/, "").split(",").map((s) => s.trim()).filter((s) => s && !/^end$/i.test(s));
      out.relatives.push({ husband: names[0] || null, wife: names[1] || null, children: names.slice(2), names, line: raw });
      continue;
    }
  }
  return out;
}

// Who holds each settlement on a map, by region: { region: { faction, level } }.
function settlementOwners(stratText) {
  const lines = splitLines(stratText);
  const out = {};
  for (const b of factionBlocks(lines)) {
    for (let i = b.start + 1; i < b.end; i++) {
      if (!/^settlement\b/.test(strip(lines[i]).trim())) continue;
      const end = settlementExtent(lines, i);
      const body = lines.slice(i, end).map(strip);
      const rm = (body.find((l) => REGION_LINE_RE.test(l)) || "").match(REGION_LINE_RE);
      const level = (body.find((l) => /^\s*level\s+/.test(l)) || "").trim().split(/\s+/)[1] || null;
      if (rm) out[rm[1]] = { faction: b.faction, level };
      i = end - 1;
    }
  }
  return out;
}

// Put a character on a different map: rewrite x,y in its `character` line.
function replaceCoords(characterLines, x, y) {
  const copy = characterLines.slice();
  copy[0] = copy[0].replace(/\bx\s+-?\d+/, "x " + x).replace(/\by\s+-?\d+/, "y " + y);
  return copy;
}

// Where a new item belongs inside a faction block: after the last item of its
// own kind, else after the last item of the kind before it. descr_strat wants
// settlements, then characters, then character_records, then relatives.
function insertionPoint(lines, block, kind) {
  const order = ["settlement", "character", "character_record", "relative"];
  const lastOf = {};
  for (let i = block.start + 1; i < block.end; i++) {
    const t = strip(lines[i]).trim();
    if (/^settlement\b/.test(t)) { lastOf.settlement = settlementExtent(lines, i); i = lastOf.settlement - 1; continue; }
    if (/^character\s/.test(t)) { lastOf.character = characterExtent(lines, i); i = lastOf.character - 1; continue; }
    if (/^character_record\s/.test(t)) { lastOf.character_record = i + 1; continue; }
    if (/^relative\s/.test(t)) { lastOf.relative = i + 1; continue; }
  }
  for (let k = order.indexOf(kind); k >= 0; k--) if (lastOf[order[k]] != null) return lastOf[order[k]];
  // nothing of any earlier kind: after the faction header and its denari/flags
  let i = block.start + 1;
  while (i < block.end && /^(denari|ai_do_not_attack|re_emergent|dead_until_resurrected)\b/.test(strip(lines[i]).trim())) i++;
  return i;
}

/**
 * Wake `faction` on the target campaign.
 *
 *   targetText        the campaign being edited
 *   sourceText        the campaign the roster comes from (the main mod)
 *   faction           which faction
 *   settlements       [region, …] on the TARGET map to hand over
 *   characters        [name, …] from the source roster (their armies come too)
 *   family            [name, …] source character_record names
 *   placements        { characterName: {x, y} } — required for each character
 *   denari            optional treasury override
 *
 * Returns { text, summary, warnings, errors }. On any error the text is
 * unchanged: a half-woken faction is worse than none.
 */
function planFactionImport({ targetText, sourceText, faction, settlements = [], characters = [], family = [], placements = {}, denari = null } = {}) {
  const fail = (msg) => ({ text: targetText, summary: null, warnings: [], errors: [msg] });
  if (!targetText || !faction) return fail("targetText and faction are required");

  const fac = String(faction).toLowerCase();
  const eol = eolOf(targetText);
  let lines = splitLines(targetText);
  if (!blockOf(lines, fac)) return fail(`faction "${fac}" has no block in this campaign`);

  const source = sourceText ? readFactionRoster(sourceText, fac) : null;
  if ((characters.length || family.length) && !source) return fail(`faction "${fac}" has no block in the source campaign`);

  const warnings = [], summary = { faction: fac, settlements: [], characters: [], family: [], relatives: 0, wokeFromDormant: false, takenFrom: {} };

  // ── 1. settlements: cut each from its current owner ─────────────────────
  const owners = settlementOwners(targetText);
  const moved = [];
  for (const region of settlements) {
    const owner = owners[region];
    if (!owner) return fail(`no settlement in region "${region}" on this map`);
    if (owner.faction === fac) { warnings.push(`${region} already belongs to ${fac}`); continue; }
    moved.push({ region, from: owner.faction, level: owner.level });
  }
  // cut high-to-low so earlier indices stay valid
  const cuts = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^settlement\b/.test(strip(lines[i]).trim())) continue;
    const end = settlementExtent(lines, i);
    const body = lines.slice(i, end).map(strip);
    const rm = (body.find((l) => REGION_LINE_RE.test(l)) || "").match(REGION_LINE_RE);
    if (rm && moved.some((mv) => mv.region === rm[1])) cuts.push({ region: rm[1], start: i, end, lines: lines.slice(i, end) });
    i = end - 1;
  }
  for (const c of cuts.slice().sort((a, b) => b.start - a.start)) lines.splice(c.start, c.end - c.start);
  for (const mv of moved) {
    const cut = cuts.find((c) => c.region === mv.region);
    if (!cut) return fail(`could not lift the settlement block for "${mv.region}"`);
    mv.lines = cut.lines;
    summary.takenFrom[mv.from] = (summary.takenFrom[mv.from] || 0) + 1;
    if (mv.from !== "slave") warnings.push(`${mv.region} is taken from ${mv.from}, which loses a settlement`);
  }

  // ── 2. the faction's own block: no longer dormant ───────────────────────
  let block = blockOf(lines, fac);
  const kept = [];
  for (let i = block.start + 1; i < block.end; i++) {
    const t = strip(lines[i]).trim();
    if (/^(dead_until_resurrected|re_emergent)\b/.test(t)) { summary.wokeFromDormant = true; continue; }
    kept.push(lines[i]);
  }
  if (summary.wokeFromDormant) {
    lines.splice(block.start + 1, block.end - block.start - 1, ...kept);
    block = blockOf(lines, fac);
  }
  if (denari != null) {
    for (let i = block.start + 1; i < block.end; i++) {
      if (/^denari\s/.test(strip(lines[i]).trim())) { lines[i] = lines[i].replace(/(\bdenari\s+)\d+/, "$1" + denari); break; }
    }
  }

  // ── 3. insert, latest kind first so earlier insertion points hold ───────
  const chosenChars = [];
  for (const name of characters) {
    const c = source.characters.find((x) => x.name === name);
    if (!c) return fail(`"${name}" is not a character of ${fac} in the source campaign`);
    const at = placements[name];
    if (!at || at.x == null || at.y == null) return fail(`no map position given for "${name}" — a character needs a tile on this map`);
    chosenChars.push({ c, lines: replaceCoords(c.lines, at.x, at.y) });
  }
  const chosenFamily = family.map((name) => {
    const f = source.family.find((x) => x.name === name);
    if (!f) throw new Error(`"${name}" is not a family record of ${fac} in the source campaign`);
    return f;
  });
  // a relative line only travels when everybody it names travelled
  const present = new Set([...chosenChars.map((x) => x.c.name), ...chosenFamily.map((f) => f.name)]);
  const chosenRelatives = (source ? source.relatives : []).filter((r) => r.names.length && r.names.every((n) => present.has(n)));
  const droppedRelatives = (source ? source.relatives : []).length - chosenRelatives.length;
  if (droppedRelatives > 0) warnings.push(`${droppedRelatives} family link(s) left behind — they name people you did not bring`);

  // NB: recomputed per call, so inserts go in ASCENDING order (see below)
  const insert = (kind, payload) => {
    if (!payload.length) return;
    block = blockOf(lines, fac);
    const at = insertionPoint(lines, block, kind);
    lines.splice(at, 0, ...payload);
  };
  // forward order: each insert lands after the last item of its own kind, so
  // the file keeps the order the caller asked for
  for (const mv of moved) insert("settlement", mv.lines);
  for (const ch of chosenChars) insert("character", ch.lines);
  insert("character_record", chosenFamily.map((f) => f.line));
  insert("relative", chosenRelatives.map((r) => r.line));

  summary.settlements = moved.map((m) => ({ region: m.region, from: m.from, level: m.level }));
  summary.characters = chosenChars.map((x) => ({ name: x.c.name, role: x.c.role, units: x.c.unitCount, x: placements[x.c.name].x, y: placements[x.c.name].y }));
  summary.family = chosenFamily.map((f) => f.name);
  summary.relatives = chosenRelatives.length;
  if (!moved.length && !chosenChars.length) warnings.push("nothing was handed over — the faction is awake but holds nothing and will die on the first turn");
  else if (!moved.length) warnings.push("no settlement — a faction with only characters is destroyed as soon as it has no town");
  else if (!chosenChars.some((x) => x.c.role === "leader")) warnings.push("no leader among the characters brought — RTW needs a family member, or the faction dies with its last one");

  return { text: lines.join(eol), summary, warnings, errors: [] };
}

module.exports = { readFactionRoster, settlementOwners, planFactionImport, factionBlocks, settlementExtent, replaceCoords };
