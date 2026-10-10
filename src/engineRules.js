// Engine rules: mod-data checks built from what the Rome Remastered exe was
// measured or decompiled doing (2026-10), not from modding folklore. Each check
// names the engine behaviour it guards against in its `why`.
//
// Shape: every check returns { id, severity, title, why, issues: [{ file, line?,
// snippet?, text }] }. runAll(dataDir, readModText) reads the mod (every read
// goes through the caller's BOM-sniffing readModText) and runs them all; a check
// whose input file is missing is skipped, never guessed.
//
// WHERE EACH RULE COMES FROM
//   • banner per culture — BANNER_DISPLAY indexes the banner sets by culture with
//     no bounds check; a culture with no `banner` block crashed every custom
//     battle (RIS roman_portraits, 2026-10-08).
//   • factionless culture in descr_building_battle — the culture filter is the
//     SET of factions with that culture; empty -> "Building db, expected a filter"
//     and the game will not start (2026-10-06).
//   • feral_descr_ai_personality.txt LF-only — not parsed at all; every faction's
//     packed personality reads 0 and the improved AI sits at home (2026-10-07).
//   • EDB browser walk — the browser tests a STATIC per-level faction bitset:
//     factions{}/culture lists give their factions, EVERY other condition
//     (hidden_resource, is_player, port, aliases...) gives all factions, `not`
//     complements, and/or group from the RIGHT. A clear bit stops the chain for
//     that faction ("faction X has gap in building prior to Y"). So a direct
//     `not hidden_resource x` is NO faction. One level per settlement size:
//     a level whose settlement_min is below the current column is skipped.
//   • EDB number widths — level cost u16 (wraps above 65,535; final cost >= 20,000
//     asserts), construction turns u8, capability bonus values int16.
//   • emergence list — an emerging faction with no "emergence" -> "settlement
//     units" list pushes every unit it may own into a fixed 256-entry stack
//     array: end-turn fail-fast crash once it owns more than 256 (2026-10-05).
//   • EDU/EDB ownership — a recruit line for a faction the unit's EDU ownership
//     leaves out never fires; a horde unit the faction does not own is an error
//     at launch (2026-10-06).
//   • army size — ARMY::validate_army trims land armies above 20 units every turn.
//   • hold_regions — win conditions take SETTLEMENT names (2026-10-05).
//   • portraits — a streamed portrait folder with NNN.tga beside NNN.tga.dds
//     fails to stream and crashes; a portrait set with no block in
//     feral_descr_portraits_variation.txt crashes on a governor's portrait.
//   • descr_ui_buildings lookup_variants — a culture with no fallback lines shows
//     the generic picture wherever it has no art of its own.
//   • historic events — an event with no {NAME_TITLE}/{NAME_BODY} string crashes
//     the game when it fires (+0x190C65F, earthquake_in_iberia, 2026-10-07).
//   • flood scale — the splash pool is sized from the flood radius = scale >> 1;
//     a scale-0/1 flood makes it 0 and the next weather splash divides by zero
//     (+0x868C71, 2026-10-06).
'use strict';
const fs = require('fs');
const path = require('path');

const SIZES = ['village', 'town', 'large_town', 'city', 'large_city', 'huge_city'];
// Blocks RIS's copy of feral_descr_portraits_variation.txt carries from vanilla.
const VANILLA_PORTRAIT_BLOCKS = new Set(['barbarian', 'eastern', 'egyptian', 'greek', 'roman']);
const EMERGENCE_SELECTION_CAP = 256;
const ARMY_CAP = 20;

// ─── loose JSON (descr_cultures.txt / descr_sm_factions.txt) ─────────────────
// RR's files are JSON-ish: `;` comments, trailing commas, and arrays that hold
// `"key": value` pairs. Objects AND arrays come back as { entries, items, line }.
function tokenizeLoose(text) {
  const toks = [];
  let i = 0, line = 1;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === ',') { i++; continue; }
    if (c === ';') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"' && text[j] !== '\n') j++;
      toks.push({ t: 's', v: text.slice(i + 1, j), line });
      i = j + 1;
      continue;
    }
    if ('{}[]:'.includes(c)) { toks.push({ t: c, line }); i++; continue; }
    let j = i;
    while (j < n && !/[\s,;{}[\]:"]/.test(text[j])) j++;
    if (j === i) { i++; continue; }
    toks.push({ t: 'w', v: text.slice(i, j), line });
    i = j;
  }
  return toks;
}

function parseLoose(text) {
  const toks = tokenizeLoose(text);
  let p = 0;
  const isPair = () => toks[p] && toks[p].t === 's' && toks[p + 1] && toks[p + 1].t === ':';
  function value() {
    const t = toks[p];
    if (!t) return null;
    if (t.t === '{' || t.t === '[') {
      const close = t.t === '{' ? '}' : ']';
      p++;
      const node = { entries: [], items: [], line: t.line };
      while (p < toks.length && toks[p].t !== close) {
        if (isPair()) {
          const k = toks[p]; p += 2;
          node.entries.push({ key: k.v, line: k.line, value: value() });
        } else node.items.push(value());
      }
      p++;
      return node;
    }
    p++;
    if (t.t === 's') return t.v;
    if (t.t === 'w') {
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      const num = Number(t.v);
      return Number.isNaN(num) ? t.v : num;
    }
    return null;
  }
  const root = { entries: [], items: [], line: 1 };
  while (p < toks.length) {
    if (isPair()) {
      const k = toks[p]; p += 2;
      root.entries.push({ key: k.v, line: k.line, value: value() });
    } else p++;
  }
  return root;
}
const getEntry = (node, key) => (node && node.entries ? node.entries.find((e) => e.key === key) : undefined);
const get = (node, key) => getEntry(node, key)?.value;

// cultures: [{ name, line, portraitMapping }]
function parseCultures(text) {
  const list = get(parseLoose(text), 'cultures');
  return (list?.entries || []).map((e) => ({
    name: e.key, line: e.line,
    portraitMapping: typeof get(e.value, 'portrait mapping') === 'string' ? get(e.value, 'portrait mapping') : null,
  }));
}

// factions: [{ name, line, culture, emergenceUnits: [] | null, hordeUnits: [] | null }]
function parseSmFactions(text) {
  const list = get(parseLoose(text), 'factions');
  return (list?.entries || []).map((e) => {
    const units = (node) => (node && node.items ? node.items.filter((x) => typeof x === 'string') : null);
    return {
      name: e.key, line: e.line,
      culture: typeof get(e.value, 'culture') === 'string' ? get(e.value, 'culture') : null,
      emergenceUnits: units(get(get(e.value, 'emergence'), 'settlement units')),
      hordeUnits: units(get(get(e.value, 'horde'), 'horde units')),
      hordeLine: getEntry(get(e.value, 'horde'), 'horde units')?.line || e.line,
      shadow: typeof get(e.value, 'shadow faction') === 'string' ? get(e.value, 'shadow faction') : null,
    };
  });
}

// ─── faction universe + static bitsets (BigInt masks) ────────────────────────
function makeUniverse(factions, cultures) {
  const index = new Map(factions.map((f, i) => [f.name, i]));
  const all = factions.length ? (1n << BigInt(factions.length)) - 1n : 0n;
  const cultureMask = new Map((cultures || []).map((c) => [c.name, 0n]));
  factions.forEach((f, i) => {
    if (!f.culture) return;
    cultureMask.set(f.culture, (cultureMask.get(f.culture) || 0n) | (1n << BigInt(i)));
  });
  const maskOf = (tokens) => {
    let m = 0n;
    for (const tok of tokens) {
      if (tok === 'all') return all;
      if (index.has(tok)) m |= 1n << BigInt(index.get(tok));
      else if (cultureMask.has(tok)) m |= cultureMask.get(tok);
    }
    return m;
  };
  const has = (mask, i) => ((mask >> BigInt(i)) & 1n) === 1n;
  const count = (mask) => { let c = 0; for (let m = mask; m; m &= m - 1n) c++; return c; };
  const names = (mask) => factions.filter((_, i) => has(mask, i)).map((f) => f.name);
  return { factions, index, all, cultureMask, maskOf, has, count, names };
}

// A condition string -> { terms: [{ neg, kind: 'factions'|'other', list?, words? }], ops: ['and'|'or'] }
// or null when it does not read as term (op term)*.
function parseCondition(cond) {
  const terms = [], ops = [];
  let cur = null, neg = false;
  const re = /factions\s*\{([^}]*)\}|(\S+)/g;
  let m;
  while ((m = re.exec(cond))) {
    if (m[1] !== undefined) {
      if (cur) terms.push(cur);
      cur = { neg, kind: 'factions', list: m[1].split(/[\s,]+/).filter(Boolean) };
      neg = false;
      continue;
    }
    const w = m[2];
    if (w === 'and' || w === 'or') {
      if (!cur) return null;
      terms.push(cur); cur = null; ops.push(w);
      continue;
    }
    if (w === 'not' && !cur) { neg = !neg; continue; }
    if (!cur) { cur = { neg, kind: 'other', words: [w] }; neg = false; } else if (cur.kind === 'other') cur.words.push(w);
  }
  if (cur) terms.push(cur);
  if (!terms.length || ops.length !== terms.length - 1) return null;
  return { terms, ops };
}

// The engine's reading: `not` binds the next term; and/or group from the RIGHT.
function evalCondition(parsed, U, override) {
  const termMask = (t, i) => {
    if (override && override.has(i)) return override.get(i);
    const base = t.kind === 'factions' ? U.maskOf(t.list) : U.all;
    return t.neg ? (U.all ^ base) : base;
  };
  let v = termMask(parsed.terms[parsed.terms.length - 1], parsed.terms.length - 1);
  for (let i = parsed.terms.length - 2; i >= 0; i--) {
    const a = termMask(parsed.terms[i], i);
    v = parsed.ops[i] === 'and' ? (a & v) : (a | v);
  }
  return v;
}

const termText = (t) => (t.neg ? 'not ' : '') + (t.kind === 'factions' ? `factions { ${t.list.join(', ')} }` : t.words.join(' '));
// `A and B or C` -> `A and (B or C)`
function engineReading(parsed) {
  let s = termText(parsed.terms[parsed.terms.length - 1]);
  for (let i = parsed.terms.length - 2; i >= 0; i--) {
    s = `${termText(parsed.terms[i])} ${parsed.ops[i]} ${i < parsed.terms.length - 2 ? `(${s})` : s}`;
  }
  return s;
}

// ─── EDB ─────────────────────────────────────────────────────────────────────
const stripSemi = (s) => { const i = s.indexOf(';'); return i < 0 ? s : s.slice(0, i); };

function parseEdb(text) {
  const lines = text.split(/\r?\n/);
  const chains = [];
  const conds = [];   // every `requires` in the file: { line, cond, where }
  let depth = 0, chain = null, level = null, alias = null, sub = null;
  for (let i = 0; i < lines.length; i++) {
    const code = stripSemi(lines[i]);
    const t = code.trim();
    const d0 = depth;
    let m;
    if (t) {
      if (d0 === 0 && (m = t.match(/^building\s+(\S+)/))) {
        chain = { name: m[1], line: i + 1, levelNames: [], levels: [] };
        chains.push(chain); level = null; alias = null;
      } else if (d0 === 0 && (m = t.match(/^alias\s+(\S+)/))) {
        alias = m[1]; chain = null; level = null;
      } else if (d0 === 1 && alias && (m = t.match(/^requires\s+(.*)$/))) {
        conds.push({ line: i + 1, cond: m[1].trim(), where: `alias ${alias}` });
      } else if (chain && d0 === 1 && (m = t.match(/^levels\s+(.*)$/))) {
        chain.levelNames = m[1].trim().split(/\s+/);
      } else if (chain && d0 === 2 && chain.levelNames.includes(t.split(/\s+/)[0])) {
        const rm = t.match(/\brequires\b(.*)$/);
        level = { name: t.split(/\s+/)[0], line: i + 1, requires: rm ? rm[1].trim() : '', caps: [] };
        sub = null;
        chain.levels.push(level);
        if (rm) conds.push({ line: i + 1, cond: level.requires, where: `${chain.name} ${level.name}` });
      } else if (level && d0 === 3) {
        if ((m = t.match(/^construction\s+(-?\d+)/))) { level.construction = +m[1]; level.constructionLine = i + 1; }
        else if ((m = t.match(/^cost\s+(-?\d+)/))) { level.cost = +m[1]; level.costLine = i + 1; }
        else if ((m = t.match(/^settlement_min\s+(\S+)/))) level.settlementMin = m[1];
        else if (/^[a-z_]+$/.test(t)) sub = t;
      } else if (level && d0 === 4 && (sub === 'capability' || sub === 'faction_capability')) {
        level.caps.push({ line: i + 1, text: t });
        const rm = t.match(/\brequires\b(.*)$/);
        if (rm) conds.push({ line: i + 1, cond: rm[1].trim(), where: `${chain.name} ${level.name}` });
      }
    }
    depth += (code.match(/\{/g) || []).length - (code.match(/\}/g) || []).length;
    if (depth <= 0) { depth = 0; if (d0 > 0) { chain = null; level = null; alias = null; } }
    if (level && depth <= 2 && d0 >= 3) { level = null; sub = null; }
  }
  return { chains, conds };
}

const EDB = 'export_descr_buildings.txt';
const snip = (s) => (s.length > 160 ? s.slice(0, 157) + '…' : s);

// Browser chain cut: a faction whose bit is clear on level i but set on a later level.
function checkBrowserGaps(edb, U) {
  const issues = [];
  for (const ch of edb.chains) {
    const masks = ch.levels.map((l) => { const p = l.requires ? parseCondition(l.requires) : null; return l.requires && !p ? null : (p ? evalCondition(p, U) : U.all); });
    if (masks.some((m) => m === null)) continue;
    const groups = new Map();   // level index -> { later: Set, factions: [] }
    U.factions.forEach((f, fi) => {
      const first = masks.findIndex((m) => !U.has(m, fi));
      if (first < 0) return;
      const later = masks.findIndex((m, j) => j > first && U.has(m, fi));
      if (later < 0) return;
      const g = groups.get(first) || { later: new Set(), factions: [] };
      g.later.add(ch.levels[later].name); g.factions.push(f.name);
      groups.set(first, g);
    });
    for (const [li, g] of groups) {
      const lvl = ch.levels[li];
      issues.push({
        file: EDB, line: lvl.line, snippet: lvl.name,
        text: `${ch.name}: ${lvl.name} is closed to ${g.factions.length} faction${g.factions.length === 1 ? '' : 's'} that can build ${[...g.later].join(' / ')} later (${g.factions.slice(0, 8).join(', ')}${g.factions.length > 8 ? ', …' : ''})`,
      });
    }
  }
  return {
    id: 'edbBrowserGap', severity: 'warn', title: 'Building browser stops early for some factions',
    why: 'The browser walks a chain level by level and stops at the first level a faction may not have (static faction test), so later levels never show; the game logs "faction X has gap in building prior to Y".',
    issues,
  };
}

// `not <non-faction condition>` in a level's requires: the engine reads it as NO faction.
function checkDirectNot(edb, U) {
  const issues = [];
  for (const ch of edb.chains) {
    for (const l of ch.levels) {
      if (!l.requires) continue;
      const p = parseCondition(l.requires);
      if (!p) continue;
      const actual = evalCondition(p, U);
      p.terms.forEach((t, i) => {
        if (!t.neg || t.kind !== 'other') return;
        const asAll = evalCondition(p, U, new Map([[i, U.all]]));
        if (asAll === actual) return;
        const lost = U.count(asAll) - U.count(actual);
        issues.push({
          file: EDB, line: l.line, snippet: l.name,
          text: `${ch.name}: ${l.name} — \`${termText(t)}\` counts as no faction here, closing the level to ${lost} faction${lost === 1 ? '' : 's'} in the browser (wrap it in an alias)`,
        });
      });
    }
  }
  return {
    id: 'edbDirectNot', severity: 'warn', title: 'Level requires with a direct `not` on a non-faction condition',
    why: 'For the browser\'s static faction test every non-faction condition counts as all factions, so `not` on one counts as none; inside an alias the same `not` is harmless.',
    issues,
  };
}

// One level per settlement size: a level whose settlement_min is below the column is skipped.
function checkBrowserSizeSkips(edb) {
  const issues = [];
  for (const ch of edb.chains) {
    let col = ch.name === 'core_building' ? 0 : 1;
    for (const l of ch.levels) {
      const sm = Math.max(0, SIZES.indexOf(l.settlementMin || 'village'));
      if (col >= SIZES.length) break;
      if (sm < col) {
        issues.push({ file: EDB, line: l.line, snippet: l.name, text: `${ch.name}: ${l.name} (settlement_min ${l.settlementMin || 'village'}) — the browser's column is already ${SIZES[col]}` });
        continue;
      }
      col = sm + 1;
    }
  }
  return {
    id: 'edbBrowserSizeSkip', severity: 'info', title: 'Levels the building browser never shows',
    why: 'The browser shows at most one level per settlement size (core_building from village, other chains from town); a level whose settlement_min is below the current column is skipped. The construction menu is unaffected.',
    issues,
  };
}

function checkEdbNumbers(edb) {
  const issues = [];
  for (const ch of edb.chains) {
    for (const l of ch.levels) {
      if (l.cost > 65535) issues.push({ sev: 'error', file: EDB, line: l.costLine, snippet: l.name, text: `${ch.name}: ${l.name} cost ${l.cost} — above 65,535 the cost wraps (stored as ${l.cost % 65536})` });
      else if (l.cost >= 20000) issues.push({ sev: 'info', file: EDB, line: l.costLine, snippet: l.name, text: `${ch.name}: ${l.name} cost ${l.cost} — a final cost of 20,000 or more trips an engine assert (log only)` });
      if (l.construction > 255) issues.push({ sev: 'error', file: EDB, line: l.constructionLine, snippet: l.name, text: `${ch.name}: ${l.name} construction ${l.construction} turns — stored in one byte (max 255)` });
      for (const c of l.caps) {
        const w = c.text.split(/\s+/);
        if (/^(recruit|recruit_pool|agent|agent_limit|agent_limit_settlement)$/.test(w[0])) continue;
        const v = w[1] === 'bonus' ? w[2] : w[1];
        if (!/^-?\d+$/.test(v || '')) continue;
        const n = +v;
        if (n > 32767 || n < -32768) issues.push({ sev: 'error', file: EDB, line: c.line, snippet: c.text, text: `${ch.name}: ${l.name} — ${w[0]} ${n} is outside -32,768..32,767 and wraps` });
      }
    }
  }
  const severity = issues.some((x) => x.sev === 'error') ? 'error' : 'info';
  return {
    id: 'edbNumbers', severity, title: 'EDB numbers past the engine\'s field widths',
    why: 'Level cost is 16-bit unsigned, construction turns 8-bit and capability values 16-bit signed; past those they wrap silently.',
    issues,
  };
}

function checkMixedAndOr(edb) {
  const issues = [];
  for (const c of edb.conds) {
    const p = parseCondition(c.cond);
    if (!p) continue;
    const firstAnd = p.ops.indexOf('and');
    if (firstAnd < 0 || p.ops.lastIndexOf('or') < firstAnd) continue;   // no `and` before an `or`: reads as usual
    issues.push({ file: EDB, line: c.line, snippet: c.cond.slice(0, 60), text: `${c.where}: read as ${snip(engineReading(p))}` });
  }
  return {
    id: 'edbAndOr', severity: 'info', title: 'Conditions with `and` before `or`',
    why: 'The building database groups conditions from the right with no precedence: `A and B or C` means `A and (B or C)`.',
    issues,
  };
}

// ─── EDU ─────────────────────────────────────────────────────────────────────
function parseEdu(text) {
  const units = new Map();   // lower-case type -> { type, line, ownership: [] }
  let cur = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const t = stripSemi(raw).trim();
    let m;
    if ((m = t.match(/^type\s+(.+)$/))) { cur = { type: m[1].trim(), line: i + 1, ownership: [] }; units.set(cur.type.toLowerCase(), cur); }
    else if (cur && (m = t.match(/^ownership\s+(.+)$/))) cur.ownership = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  });
  return units;
}
const ownsMask = (unit, U) => U.maskOf(unit.ownership);

function checkRecruitOwnership(edb, edbText, edu, U) {
  const byUnit = new Map();
  edbText.split(/\r?\n/).forEach((raw, i) => {
    const t = stripSemi(raw).trim();
    const m = t.match(/^recruit(?:_pool)?\s+"([^"]+)"(.*)$/);
    if (!m) return;
    const unit = edu.get(m[1].toLowerCase());
    if (!unit) return;
    const rm = m[2].match(/\brequires\b(.*)$/);
    const p = rm ? parseCondition(rm[1]) : null;
    if (!p) return;
    const owned = ownsMask(unit, U);
    for (const term of p.terms) {
      if (term.kind !== 'factions' || term.neg) continue;
      for (const tok of term.list) {
        if (!U.index.has(tok) || U.has(owned, U.index.get(tok))) continue;
        const g = byUnit.get(unit.type) || { factions: new Set(), lines: [] };
        g.factions.add(tok); g.lines.push(i + 1);
        byUnit.set(unit.type, g);
      }
    }
  });
  const issues = [...byUnit].map(([type, g]) => ({
    file: EDB, line: g.lines[0], snippet: `"${type}"`,
    text: `${type}: ${[...g.factions].join(', ')} — named on ${g.lines.length} recruit line${g.lines.length === 1 ? '' : 's'}, not in the unit's EDU ownership`,
  }));
  return {
    id: 'recruitOwnership', severity: 'warn', title: 'Recruit lines for factions that do not own the unit',
    why: 'A recruit line never fires for a faction left out of the unit\'s export_descr_unit ownership.',
    issues,
  };
}

function checkHordeUnits(factions, edu, U) {
  const issues = [];
  factions.forEach((f, fi) => {
    for (const u of f.hordeUnits || []) {
      const unit = edu.get(u.toLowerCase());
      if (unit && U.has(ownsMask(unit, U), fi)) continue;
      issues.push({ file: 'descr_sm_factions.txt', line: f.hordeLine, snippet: u, text: `${f.name}: horde unit "${u}" ${unit ? 'is not in its EDU ownership' : 'is not in export_descr_unit.txt'}` });
    }
  });
  return {
    id: 'hordeUnits', severity: 'error', title: 'Horde units the faction cannot own',
    why: 'The game reports "Faction X has horde unit ... not available" at launch for a horde unit outside the faction\'s ownership.',
    issues,
  };
}

// ─── descr_strat ─────────────────────────────────────────────────────────────
function parseStrat(text) {
  const lines = text.split(/\r?\n/);
  const factions = [];   // { name, line, reEmergent, deadUntil }
  const armies = [];     // { line, units, faction, character }
  const spawnScripts = new Set();   // factions named by an active spawn_script line
  let fac = null, lastChar = null;
  for (let i = 0; i < lines.length; i++) {
    const t = stripSemi(lines[i]).trim();
    let m;
    if ((m = t.match(/^spawn_script\s+([A-Za-z0-9_]+)/))) { spawnScripts.add(m[1]); continue; }
    if ((m = t.match(/^faction\s+([A-Za-z0-9_]+)/))) { fac = { name: m[1], line: i + 1, reEmergent: false, deadUntil: false }; factions.push(fac); lastChar = null; continue; }
    if (!fac) continue;
    if (/^re_emergent\b/.test(t)) fac.reEmergent = true;
    else if (/^dead_until_resurrected\b/.test(t)) fac.deadUntil = true;
    else if ((m = t.match(/^character\s+([^,]+),\s*([^,]+)/))) lastChar = { name: m[1].trim(), type: m[2].trim() };
    else if (t === 'army') {
      let n = 0, j = i + 1;
      for (; j < lines.length; j++) {
        const u = stripSemi(lines[j]).trim();
        if (!u) { if (lines[j].trim().startsWith(';')) continue; break; }
        if (!/^unit\b/.test(u)) break;
        n++;
      }
      armies.push({ line: i + 1, units: n, faction: fac.name, character: lastChar });
    }
  }
  return { factions, armies, spawnScripts };
}

function checkEmergence(strat, smFactions, edu, U) {
  const sm = new Map(smFactions.map((f) => [f.name, f]));
  // It can only emerge through a spawn_script (revolt/capture/end_of_turn) or as
  // the shadow some faction declares; with neither it never comes back.
  const shadowTargets = new Set(smFactions.map((f) => f.shadow).filter(Boolean));
  const issues = [];
  for (const f of strat.factions) {
    if (!f.reEmergent && !f.deadUntil) continue;
    if (!strat.spawnScripts.has(f.name) && !shadowTargets.has(f.name)) continue;
    const entry = sm.get(f.name);
    if (!entry || (entry.emergenceUnits && entry.emergenceUnits.length)) continue;
    const fi = U.index.get(f.name);
    let owned = 0;
    for (const u of edu.values()) if (U.has(ownsMask(u, U), fi)) owned++;
    if (owned <= EMERGENCE_SELECTION_CAP) continue;
    issues.push({ file: 'descr_sm_factions.txt', line: entry.line, snippet: `"${f.name}"`, text: `${f.name} (${f.reEmergent ? 're_emergent' : 'dead_until_resurrected'}) has no "emergence" settlement units and may own ${owned} units` });
  }
  return {
    id: 'emergenceList', severity: 'error', title: 'Re-emerging factions with no emergence unit list',
    why: 'Without an "emergence" -> "settlement units" list the engine pushes every unit the faction may own into a fixed 256-slot array; above 256 the end turn crashes.',
    issues,
  };
}

function checkArmySize(strat) {
  const issues = strat.armies
    .filter((a) => a.units > ARMY_CAP && !/admiral/i.test(a.character?.type || ''))
    .map((a) => ({ file: 'descr_strat.txt', line: a.line, text: `${a.faction}: ${a.character ? a.character.name : 'army'} starts with ${a.units} units` }));
  return {
    id: 'armySize', severity: 'warn', title: 'Starting armies above 20 units',
    why: 'The engine trims land armies above 20 units every turn and at battle start.',
    issues,
  };
}

// ─── descr_regions + win conditions ──────────────────────────────────────────
function parseRegions(text) {
  const lines = text.split(/\r?\n/);
  const regions = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = stripSemi(lines[i]);
    if (!raw.trim() || /^\s/.test(raw)) continue;
    let j = i + 1;
    while (j < lines.length && !stripSemi(lines[j]).trim()) j++;
    if (j < lines.length && /^\s/.test(lines[j])) regions.push({ region: raw.trim(), settlement: stripSemi(lines[j]).trim() });
  }
  return regions;
}

function checkHoldRegions(wcText, regions) {
  const settlements = new Set(regions.map((r) => r.settlement.toLowerCase()));
  const byRegion = new Map(regions.map((r) => [r.region.toLowerCase(), r.settlement]));
  const issues = [];
  let faction = null;
  wcText.split(/\r?\n/).forEach((raw, i) => {
    const t = stripSemi(raw).trim();
    if (/^[a-z_0-9]+$/.test(t)) { faction = t; return; }
    const m = t.match(/^hold_regions\s+(.*)$/);
    if (!m) return;
    for (const tok of m[1].split(/[\s,]+/).filter(Boolean)) {
      if (/^\d+$/.test(tok) || settlements.has(tok.toLowerCase())) continue;
      const s = byRegion.get(tok.toLowerCase());
      issues.push({ file: 'descr_win_conditions.txt', line: i + 1, snippet: tok, text: `${faction || '?'}: ${tok} ${s ? `is a region name — its settlement is ${s}` : 'is not a settlement in descr_regions'}` });
    }
  });
  return {
    id: 'holdRegions', severity: 'error', title: 'hold_regions names that are not settlements',
    why: 'Win conditions take settlement names, not region names.',
    issues,
  };
}

// ─── cultures: banners, building_battle, ui_buildings, portraits ─────────────
function checkCultureBanners(cultures, bannersText) {
  const have = new Set();
  for (const raw of bannersText.split(/\r?\n/)) {
    const m = stripSemi(raw).match(/^\s*banner\s+(\S+)/);
    if (m) have.add(m[1]);
  }
  return {
    id: 'cultureBanner', severity: 'error', title: 'Cultures with no banner block',
    why: 'Battle banners are looked up by culture with no bounds check; a culture with no `banner` block in descr_banners.txt crashes custom battles, even one no faction uses.',
    issues: cultures.filter((c) => !have.has(c.name)).map((c) => ({ file: 'descr_cultures.txt', line: c.line, snippet: `"${c.name}"`, text: `${c.name} has no \`banner ${c.name}\` block in descr_banners.txt` })),
  };
}

function checkFactionlessCultureFilters(cultures, U, bbText) {
  const empty = new Set(cultures.filter((c) => !U.cultureMask.get(c.name)).map((c) => c.name));
  const issues = [];
  if (empty.size) {
    bbText.split(/\r?\n/).forEach((raw, i) => {
      const w = stripSemi(raw).trim().split(/\s+/).filter(Boolean);
      for (const tok of w.slice(0, -1)) {
        if (empty.has(tok)) issues.push({ file: 'descr_building_battle.txt', line: i + 1, snippet: raw.trim(), text: `${tok} has no factions — its filter is empty` });
      }
    });
  }
  return {
    id: 'factionlessCultureFilter', severity: 'error', title: 'descr_building_battle filters on a culture with no factions',
    why: 'A culture filter is the set of factions with that culture; an empty one stops the game at start ("Building db, expected a filter like faction, culture, season, condition *OR* the `any` flag").',
    issues,
  };
}

function checkLookupVariants(cultures, U, uibText) {
  const left = new Set();
  let depth = 0, inLv = false;
  for (const raw of uibText.split(/\r?\n/)) {
    const t = stripSemi(raw).trim();
    if (depth === 0 && /^lookup_variants\b/.test(t)) inLv = true;
    const d0 = depth;
    depth += (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length;
    if (inLv && d0 === 1) { const w = t.split(/\s+/); if (w.length === 2) left.add(w[0]); }
    if (depth <= 0 && d0 > 0) inLv = false;
  }
  const issues = cultures
    .filter((c) => U.cultureMask.get(c.name) && !left.has(c.name))
    .map((c) => ({ file: 'descr_ui_buildings.txt', snippet: 'lookup_variants', text: `${c.name} has no fallback lines in lookup_variants` }));
  return {
    id: 'lookupVariants', severity: 'warn', title: 'Cultures with no building-picture fallbacks',
    why: 'lookup_variants names the cultures whose pictures a culture borrows (not recursively); with none, every building it has no art for shows the generic picture.',
    issues,
  };
}

function walkFiles(dir, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out); else out.push(p);
  }
  return out;
}

function checkPortraitTgaBesideDds(dataDir, cultures) {
  const issues = [];
  const targets = [...new Set(cultures.map((c) => c.portraitMapping).filter(Boolean))];
  for (const tgt of targets) {
    const root = path.join(dataDir, 'ui', tgt, 'portraits');
    const files = walkFiles(root);
    const lower = new Set(files.map((f) => f.toLowerCase()));
    const byDir = new Map();
    for (const f of files) {
      if (!/\.tga\.dds$/i.test(f)) continue;
      const tga = f.slice(0, -4);
      if (!lower.has(tga.toLowerCase())) continue;
      const d = path.dirname(f);
      byDir.set(d, (byDir.get(d) || []).concat(path.basename(tga)));
    }
    for (const [d, names] of byDir) {
      issues.push({ file: path.relative(dataDir, d).replace(/\\/g, '/'), text: `${names.length} portrait${names.length === 1 ? '' : 's'} with a .tga beside the .tga.dds (${names.slice(0, 4).join(', ')}${names.length > 4 ? ', …' : ''})` });
    }
  }
  return {
    id: 'portraitTgaBesideDds', severity: 'error', title: 'Portrait folders with .tga beside .tga.dds',
    why: 'A streamed portrait whose folder also holds NNN.tga fails to stream and crashes on a character panel; portrait folders must hold .tga.dds only.',
    issues,
  };
}

function checkPortraitVariation(dataDir, cultures, variationText) {
  const blocks = new Set();
  if (variationText != null) {
    let depth = 0;
    for (const raw of variationText.split(/\r?\n/)) {
      const t = stripSemi(raw).trim();
      if (depth === 0 && /^[A-Za-z0-9_]+$/.test(t)) blocks.add(t);
      depth += (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length;
    }
  }
  const have = variationText != null ? blocks : VANILLA_PORTRAIT_BLOCKS;
  const targets = [...new Set(cultures.map((c) => c.portraitMapping).filter(Boolean))];
  const issues = targets
    .filter((t) => !have.has(t) && fs.existsSync(path.join(dataDir, 'ui', t, 'portraits')))
    .map((t) => ({ file: 'feral_descr_portraits_variation.txt', snippet: t, text: `portrait set ${t} (ui/${t}/portraits) has no block in feral_descr_portraits_variation.txt${variationText == null ? ' (the mod does not ship one; the game\'s own covers only the vanilla sets)' : ''}` }));
  return {
    id: 'portraitVariation', severity: 'error', title: 'Portrait sets with no variation block',
    why: 'A portrait set with no block in feral_descr_portraits_variation.txt logs "doesn\'t provide any variations" and crashes when a settlement with such a governor is selected.',
    issues,
  };
}

// ─── AI personality line endings ─────────────────────────────────────────────
function checkAiPersonalityCrlf(text) {
  const lf = (text.match(/\n/g) || []).length;
  const crlf = (text.match(/\r\n/g) || []).length;
  const issues = [];
  if (lf && !crlf) issues.push({ file: 'feral_descr_ai_personality.txt', text: `LF-only line endings (${lf} lines) — the file is not read` });
  return {
    id: 'aiPersonalityCrlf', severity: 'error', title: 'feral_descr_ai_personality.txt needs CRLF line endings',
    why: 'With LF-only line endings the game does not parse the file: every faction\'s personality reads 0 and the improved campaign AI stays home from turn 1.',
    issues,
  };
}

// ─── events ──────────────────────────────────────────────────────────────────
function checkEventStrings(eventsText, historicText) {
  const issues = [];
  eventsText.split(/\r?\n/).forEach((raw, i) => {
    const m = stripSemi(raw).trim().match(/^event\s+(\S+)\s+(\S+)/);
    if (!m) return;
    const key = m[2].toUpperCase();
    const missing = ['TITLE', 'BODY'].filter((s) => !historicText.includes(`{${key}_${s}}`));
    if (missing.length) issues.push({ file: 'descr_events.txt', line: i + 1, snippet: m[2], text: `${m[1]} ${m[2]} — no ${missing.map((s) => `{${key}_${s}}`).join(' / ')} in text/historic_events.txt` });
  });
  return {
    id: 'eventStrings', severity: 'error', title: 'Events with no title or body string',
    why: 'When an event fires with no title/body string the game crashes (+0x190C65F after "Couldn\'t find title string for historic event").',
    issues,
  };
}

function checkFloodScale(disasters, eventsText) {
  const issues = [];
  for (const { file, text } of disasters) {
    let inFlood = false, start = 0;
    text.split(/\r?\n/).forEach((raw, i) => {
      const t = stripSemi(raw).trim();
      if (/^event\s/.test(t)) { inFlood = /^event\s+flood\b/.test(t); start = i + 1; return; }
      const m = t.match(/^min_scale\s+(-?\d+)/);
      if (inFlood && m && +m[1] < 2) issues.push({ file, line: i + 1, text: `flood (event at line ${start}) min_scale ${m[1]}` });
    });
  }
  if (eventsText) {
    let flood = null;
    eventsText.split(/\r?\n/).forEach((raw, i) => {
      const t = stripSemi(raw).trim();
      const ev = t.match(/^event\s+(\S+)\s*(\S*)/);
      if (ev) { flood = ev[1] === 'flood' ? (ev[2] || 'flood') : null; return; }
      const m = t.match(/^scale\s+(-?\d+)/);
      if (flood && m && +m[1] < 2) issues.push({ file: 'descr_events.txt', line: i + 1, snippet: flood, text: `flood ${flood} scale ${m[1]}` });
    });
  }
  return {
    id: 'floodScale', severity: 'error', title: 'Floods with scale below 2',
    why: 'The weather-splash pool is sized from the flood radius (scale >> 1); a scale 0 or 1 flood sets it to 0 and the next splash in that session divides by zero (+0x868C71).',
    issues,
  };
}

// ─── run everything ──────────────────────────────────────────────────────────
function runAll(dataDir, readModText) {
  const read = (...parts) => {
    const p = path.join(dataDir, ...parts);
    try { return fs.existsSync(p) ? readModText(p) : null; } catch { return null; }
  };
  const camp = ['world', 'maps', 'campaign', 'imperial_campaign'];
  const base = ['world', 'maps', 'base'];
  const checks = [];
  const skipped = [];
  const run = (name, needs, fn) => {
    if (needs.some((x) => x == null)) { skipped.push(name); return; }
    try { checks.push(fn()); } catch (e) { checks.push({ id: name, severity: 'error', title: name, why: '', issues: [], error: e.message }); }
  };

  const culturesText = read('descr_cultures.txt');
  const smText = read('descr_sm_factions.txt');
  const edbText = read('export_descr_buildings.txt');
  const eduText = read('export_descr_unit.txt');
  const stratText = read(...camp, 'descr_strat.txt');
  const cultures = culturesText ? parseCultures(culturesText) : null;
  const smFactions = smText ? parseSmFactions(smText) : null;
  const U = smFactions ? makeUniverse(smFactions, cultures || []) : null;
  const edb = edbText ? parseEdb(edbText) : null;
  const edu = eduText ? parseEdu(eduText) : null;
  const strat = stratText ? parseStrat(stratText) : null;

  run('cultureBanner', [cultures, read('descr_banners.txt')], () => checkCultureBanners(cultures, read('descr_banners.txt')));
  run('factionlessCultureFilter', [cultures, U, read('descr_building_battle.txt')], () => checkFactionlessCultureFilters(cultures, U, read('descr_building_battle.txt')));
  run('aiPersonalityCrlf', [read('feral_descr_ai_personality.txt')], () => checkAiPersonalityCrlf(read('feral_descr_ai_personality.txt')));
  run('edbBrowserGap', [edb, U], () => checkBrowserGaps(edb, U));
  run('edbDirectNot', [edb, U], () => checkDirectNot(edb, U));
  run('edbBrowserSizeSkip', [edb], () => checkBrowserSizeSkips(edb));
  run('edbNumbers', [edb], () => checkEdbNumbers(edb));
  run('edbAndOr', [edb], () => checkMixedAndOr(edb));
  run('recruitOwnership', [edb, edu, U], () => checkRecruitOwnership(edb, edbText, edu, U));
  run('hordeUnits', [smFactions, edu, U], () => checkHordeUnits(smFactions, edu, U));
  run('emergenceList', [strat, smFactions, edu, U], () => checkEmergence(strat, smFactions, edu, U));
  run('armySize', [strat], () => checkArmySize(strat));
  const regionsText = read(...camp, 'descr_regions.txt') || read(...base, 'descr_regions.txt');
  const wcText = read(...camp, 'descr_win_conditions.txt');
  run('holdRegions', [wcText, regionsText], () => checkHoldRegions(wcText, parseRegions(regionsText)));
  run('portraitTgaBesideDds', [cultures], () => checkPortraitTgaBesideDds(dataDir, cultures));
  run('portraitVariation', [cultures], () => checkPortraitVariation(dataDir, cultures, read('feral_descr_portraits_variation.txt')));
  run('lookupVariants', [cultures, U, read('descr_ui_buildings.txt')], () => checkLookupVariants(cultures, U, read('descr_ui_buildings.txt')));
  const eventsText = read(...camp, 'descr_events.txt');
  run('eventStrings', [eventsText, read('text', 'historic_events.txt')], () => checkEventStrings(eventsText, read('text', 'historic_events.txt')));
  const disasters = [[...base, 'descr_disasters.txt'], [...camp, 'descr_disasters.txt']]
    .map((parts) => ({ file: 'descr_disasters.txt', text: read(...parts) })).filter((d) => d.text != null);
  run('floodScale', [disasters.length || eventsText ? true : null], () => checkFloodScale(disasters, eventsText));

  return { checks, skipped, error: null };
}

module.exports = {
  runAll,
  parseLoose, parseCultures, parseSmFactions, makeUniverse, parseCondition, evalCondition, engineReading,
  parseEdb, parseEdu, parseStrat, parseRegions,
  checkCultureBanners, checkFactionlessCultureFilters, checkAiPersonalityCrlf,
  checkBrowserGaps, checkDirectNot, checkBrowserSizeSkips, checkEdbNumbers, checkMixedAndOr,
  checkRecruitOwnership, checkHordeUnits, checkEmergence, checkArmySize, checkHoldRegions,
  checkPortraitTgaBesideDds, checkPortraitVariation, checkLookupVariants, checkEventStrings, checkFloodScale,
};
