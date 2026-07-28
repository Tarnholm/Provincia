/**
 * export_descr_buildings.txt, parsed once and shared.
 *
 * Two things live here because two generators need exactly the same answer from the same
 * file, and a second copy of either would drift:
 *
 *   1. parseEdb()   — chains, their level order, each level's `requires`, and every
 *                     `recruit "<unit>" <exp> requires <expr>` line with the chain and level
 *                     it sits under. Also the `<effect> <n> requires <expr>` lines, because
 *                     that is where a hidden resource turns into a NUMBER.
 *   2. evaluate()   — a three-valued evaluator for a `requires` expression against a known
 *                     settlement state. Used to answer "what can this settlement recruit at
 *                     the campaign start", which is only answerable because turn 0 fixes the
 *                     owner, the buildings, the region's tags and its trade goods.
 *
 * WHY THREE-VALUED AND NOT TWO. Some conditions cannot be decided from turn-0 state at all:
 * `major_event "marian_reforms"` is a reform that has not happened yet. Returning false for
 * those would silently drop units that the settlement will be able to raise; returning true
 * would list units it cannot. So the third value is UNKNOWN, it propagates, and the caller is
 * expected to present those units separately with the undecided condition stated. That is the
 * whole reason this is not a boolean.
 *
 * WHAT THE FILE ACTUALLY CONTAINS, measured rather than assumed (numbers from the reference
 * data, printed by whichever generator runs this):
 *   - 29,894 recruit lines, in 8 chains. Every one has a `requires`.
 *   - NO parentheses anywhere in a recruit condition. Not one.
 *   - 27 recruit conditions mix `and` and `or` at the same level. With no brackets and no
 *     precedence stated anywhere in the file, which grouping the engine applies is NOT
 *     established, so those are reported AMBIGUOUS rather than guessed. 27 of 29,894.
 *   - 511 `alias` blocks, 113 of which contain `or`.
 *
 * ALIASES ARE TREATED AS BRACKETED GROUPS. `mic_tier_1` is `A or B`, and it is used as
 * `… and mic_tier_1 and …`; if the alias did not group, the surrounding `and`s would bind
 * into it and the condition would mean something else entirely. Every alias in the file is
 * written as though it groups (that is what an alias is for, and each carries its own
 * `display_string` as a single requirement shown to the player), so it is expanded as a
 * sub-expression, never pasted in as text.
 *
 * Six apparent alias cycles are not cycles: `alias temple` contains the token `temple`, which
 * there is the name of an exclusivity TAG from the `tags` block, not a reference to itself.
 * The expander therefore keeps a stack and refuses to re-enter a name already on it.
 */
"use strict";

// Built from char codes so no patch script can turn the escapes into real control characters
// inside the literal — the same precaution gen-ris-region-pages.js takes, for the same reason.
const SPLIT_EOL = new RegExp(String.fromCharCode(13) + "?" + String.fromCharCode(10));

const strip = (s) => s.replace(/;.*$/, "").trim();

/** `alias <name> { requires <expr> … }` → { name: expr }. */
function parseAliases(edb) {
  const out = {};
  const lines = edb.split(SPLIT_EOL);
  for (let i = 0; i < lines.length; i++) {
    const m = /^alias\s+(\S+)/.exec(strip(lines[i]));
    if (!m) continue;
    for (let k = i + 1; k < Math.min(i + 8, lines.length); k++) {
      const t = strip(lines[k]);
      if (t === "}") break;
      const r = /^requires\s+(.+)$/.exec(t);
      if (r) { out[m[1].toLowerCase()] = r[1].trim(); break; }
    }
  }
  return out;
}

/**
 * Chains, levels, recruit lines and capability effects.
 *
 * A level is recognised by `<level> requires <expr>` where <level> is one of the names on the
 * chain's own `levels` line. Matching any `<word> requires` would also catch `recruit "x" 0
 * requires …` and the standalone `requires …` continuation lines, and did.
 */
function parseEdb(edb) {
  const lines = edb.split(SPLIT_EOL);
  const chains = [];
  const byChain = new Map();
  const recruits = [];
  const effects = [];
  let chain = null, level = null;

  for (let i = 0; i < lines.length; i++) {
    const t = strip(lines[i]);
    if (!t) continue;

    let m = /^building\s+(\S+)$/.exec(t);
    if (m) {
      chain = { chain: m[1], order: [], levels: {} };
      chains.push(chain); byChain.set(chain.chain.toLowerCase(), chain);
      level = null;
      continue;
    }
    if (!chain) continue;

    m = /^levels\s+(.+)$/.exec(t);
    if (m) {
      // The `-` in the class is not decoration. `building grain_imports` declares
      // `levels grain grain+1 grain+2 grain-1`, and without it `grain-1` was filtered out of
      // the order, never became a level, and its own block's lines were attributed to the
      // level above it — which is how `grain+2` came to report a settlement minimum of
      // large_city when the file gives it city. One level in the whole mod is spelled this
      // way; it was found by counting the `settlement_min` lines two ways and getting 272
      // against 273.
      chain.order = m[1].split(/\s+/).filter((x) => /^[a-z0-9_+\-]+$/i.test(x));
      for (const l of chain.order) chain.levels[l] = { level: l, chain: chain.chain, requires: "", line: 0 };
      continue;
    }

    m = /^recruit\s+"([^"]+)"\s+(-?\d+)(?:\s+requires\s+(.+))?$/.exec(t);
    if (m) {
      recruits.push({
        chain: chain.chain, level: level ? level.level : null,
        unit: m[1].trim().toLowerCase(), exp: +m[2], requires: (m[3] || "").trim(), line: i + 1,
      });
      continue;
    }

    // `<effect> [bonus] <n> requires <expr>` inside a capability block. Three shapes exist and
    // all three are here: `taxable_income_bonus bonus 4 requires …` (the commonest, 1,095
    // lines, with a literal `bonus` keyword), `farming_level 2 requires …` (116, without it)
    // and `religious_belief italic 8 requires …` (a named subject before the number). This is
    // the only place a hidden resource turns into a NUMBER, so each is kept with its
    // condition intact.
    m = /^([a-z_]+)(?:\s+bonus)?\s+(-?\d+)\s+requires\s+(.+)$/.exec(t);
    if (m && level) { effects.push({ chain: chain.chain, level: level.level, effect: m[1], subject: null, amount: +m[2], requires: m[3].trim(), line: i + 1 }); continue; }
    m = /^([a-z_]+)\s+([a-z_]+)\s+(-?\d+)\s+requires\s+(.+)$/.exec(t);
    if (m && level) { effects.push({ chain: chain.chain, level: level.level, effect: m[1], subject: m[2], amount: +m[3], requires: m[4].trim(), line: i + 1 }); continue; }

    // `settlement_min <size>` is NOT a condition. It is a FIELD of a level block, sitting
    // beside `construction`, `cost` and `upgrades`, and it is the only place the mod states a
    // settlement-size requirement: all 273 occurrences are this shape, none appears inside a
    // `requires` expression, and there is no `settlement_max` of any kind. Captured on the
    // level so a size reference can ask "what does this size unlock" and get an answer read off
    // the file rather than inferred.
    m = /^settlement_min\s+([a-z0-9_]+)$/i.exec(t);
    if (m && level) { level.settlementMin = m[1].toLowerCase(); continue; }

    m = /^([a-z0-9_+\-]+)\s+requires\s+(.+)$/i.exec(t);
    if (m && chain.levels[m[1]]) {
      level = chain.levels[m[1]];
      level.requires = m[2].trim();
      level.line = i + 1;
      continue;
    }

    // A standalone `requires …` continues the level's own condition.
    m = /^requires\s+(.+)$/.exec(t);
    if (m && level) { level.requires += (level.requires ? " and " : "") + m[1].trim(); continue; }
  }
  return { chains, byChain, recruits, effects };
}

// ── condition splitting ───────────────────────────────────────────────────
// `factions { a, b, }` contains commas and braces and must survive the split intact, so it is
// parked before the split and restored after.
//
// THE PLACEHOLDER IS FENCED, NOT A BARE NUMBER. Parking a blob as "0"/"1" and restoring with
// a digit-only pattern corrupts every condition that contains a digit of its own —
// `mic_tier_1`, `gov1`, `rel_venetic_4` — because the restore cannot tell a placeholder from a
// real digit. The fence is a control character, built from its char code so no editor or patch
// script can turn it into something printable, and it cannot occur in
// export_descr_buildings.txt.
const FENCE = String.fromCharCode(1);
const PARK = new RegExp(FENCE + "([0-9]+)" + FENCE, "g");
const FACTIONS_BLOB = /factions[ \t]*\{[^}]*\}/gi;
const JOINER = /[ \t]+(and|or)[ \t]+/i;
const LEADING_NOT = /^not[ \t]+/i;
function splitTerms(expr) {
  const blobs = [];
  const s = String(expr).replace(FACTIONS_BLOB, (m) => { blobs.push(m); return FENCE + (blobs.length - 1) + FENCE; });
  const parts = s.split(JOINER);
  const terms = [];
  const ops = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) { ops.push(parts[i].toLowerCase()); continue; }
    let a = parts[i].trim();
    let negated = false;
    while (LEADING_NOT.test(a)) { negated = !negated; a = a.replace(LEADING_NOT, "").trim(); }
    a = a.replace(PARK, (_, k) => blobs[+k]);
    terms.push({ atom: a, negated });
  }
  return { terms, ops };
}

const T = true, F = false, U = null;   // U = cannot be decided from the state given
const negate = (v) => (v === U ? U : !v);

/**
 * Evaluate a `requires` expression against a settlement state.
 *
 * ctx:
 *   faction          faction token that owns the settlement
 *   isPlayer         value to give `is_player` (see the caller's note — turn 0 has no player)
 *   tags             Set of the region's hidden-resource tokens, lowercased
 *   factionTags      Set of every hidden resource anywhere in the faction's territory, for
 *                    `… factionwide`; omit and those atoms come back UNKNOWN
 *   built            Map chain(lower) -> level token that is present
 *   goods            Set of trade-resource tokens placed in the region
 *   chainTags        Map chain(lower) -> Set of exclusivity tags, for `no_building_tagged`
 *
 * Returns { value, unknown: [atom…], ambiguous: bool }. `unknown` names the atoms that could
 * not be decided, so a caller can print the actual condition instead of a shrug.
 */
function evaluate(expr, ctx, aliases, stack) {
  return evalNode(compile(expr, aliases, stack || []), ctx);
}

/**
 * Parse a condition into a tree ONCE, so 1,311 regions do not re-parse the same 29,894
 * conditions. Aliases are inlined as SUB-TREES rather than pasted in as text, which is what
 * makes them behave as bracketed groups.
 *
 * The cache is keyed on the expression string, which is safe here because a run reads one
 * export_descr_buildings.txt and therefore one alias table. It is the difference between a
 * generator that finishes and one that does not.
 */
const compileCache = new Map();
function compile(expr, aliases, stack) {
  stack = stack || [];
  if (!stack.length) {
    const hit = compileCache.get(expr);
    if (hit) return hit;
  }
  const { terms, ops } = splitTerms(expr);
  const kinds = new Set(ops);
  const node = {
    // `and` and `or` at the same level, with no parentheses anywhere in the file and no
    // precedence stated in it. The grouping the engine applies is NOT established, so this is
    // reported rather than guessed. 27 of 29,894 recruit conditions are like this.
    kind: kinds.size > 1 ? "ambiguous" : kinds.has("or") ? "or" : "and",
    ops,
    parts: terms.map(({ atom, negated }) => {
      const low = atom.trim().toLowerCase();
      const body = aliases[low];
      if (body != null && !stack.includes(low)) return { negated, node: compile(body, aliases, [...stack, low]) };
      return { negated, atom: atom.trim() };
    }),
  };
  if (!stack.length) compileCache.set(expr, node);
  return node;
}

function evalNode(node, ctx) {
  const unknown = [];
  let ambiguous = false;
  const values = node.parts.map((p) => {
    const r = p.node ? evalNode(p.node, ctx) : atomValue(p.atom, ctx);
    if (r.ambiguous) ambiguous = true;
    for (const u of r.unknown) unknown.push(u);
    return p.negated ? negate(r.value) : r.value;
  });
  if (node.kind === "ambiguous" && !ambiguous) {
    // An unbracketed mix of `and` and `or`. Rather than pick a precedence the file does not
    // state, evaluate BOTH readings — the engine-agnostic pair of `and` binding tighter, and
    // strict left-to-right — and accept the answer only when they agree. They usually do,
    // because the terms the mod ors together are alternatives that are all false or all
    // irrelevant. Where they disagree the condition really is undetermined and says so.
    const a = foldAndTighter(values, node.ops);
    const b = foldLeftToRight(values, node.ops);
    if (a !== null && a === b) return { value: a, unknown: [], ambiguous: false };
    return { value: U, unknown, ambiguous: true };
  }
  if (ambiguous) return { value: U, unknown, ambiguous: true };
  if (node.kind === "or") {
    if (values.some((v) => v === T)) return { value: T, unknown: [], ambiguous: false };
    if (values.some((v) => v === U)) return { value: U, unknown, ambiguous: false };
    return { value: F, unknown: [], ambiguous: false };
  }
  if (values.some((v) => v === F)) return { value: F, unknown: [], ambiguous: false };
  if (values.some((v) => v === U)) return { value: U, unknown, ambiguous: false };
  return { value: T, unknown: [], ambiguous: false };
}

/** `a and b or c and d` read as `(a and b) or (c and d)`. */
function foldAndTighter(values, ops) {
  const groups = [[values[0]]];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i] === "or") groups.push([values[i + 1]]);
    else groups[groups.length - 1].push(values[i + 1]);
  }
  const ands = groups.map((g) => (g.some((v) => v === F) ? F : g.some((v) => v === U) ? U : T));
  return ands.some((v) => v === T) ? T : ands.some((v) => v === U) ? U : F;
}

/** `a and b or c and d` read as `(((a and b) or c) and d)`. */
function foldLeftToRight(values, ops) {
  let acc = values[0];
  for (let i = 0; i < ops.length; i++) {
    const v = values[i + 1];
    if (ops[i] === "and") acc = acc === F || v === F ? F : acc === U || v === U ? U : T;
    else acc = acc === T || v === T ? T : acc === U || v === U ? U : F;
  }
  return acc;
}

function atomValue(atom, ctx) {
  const none = { unknown: [], ambiguous: false };
  const a = atom.trim();
  const low = a.toLowerCase();

  let m = /^factions\s*\{([^}]*)\}$/i.exec(a);
  if (m) {
    const set = m[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (set.includes("all")) return { value: T, ...none };
    if (!ctx.faction) return { value: U, unknown: [a], ambiguous: false };
    return { value: set.includes(String(ctx.faction).toLowerCase()) ? T : F, ...none };
  }

  m = /^hidden_resource\s+([a-z0-9_\-]+)(\s+factionwide)?$/i.exec(a);
  if (m) {
    const tok = m[1].toLowerCase();
    if (m[2]) {
      if (!ctx.factionTags) return { value: U, unknown: [a], ambiguous: false };
      return { value: ctx.factionTags.has(tok) ? T : F, ...none };
    }
    if (!ctx.tags) return { value: U, unknown: [a], ambiguous: false };
    return { value: ctx.tags.has(tok) ? T : F, ...none };
  }

  m = /^resource\s+([a-z0-9_\-]+)$/i.exec(a);
  if (m) {
    if (!ctx.goods) return { value: U, unknown: [a], ambiguous: false };
    return { value: ctx.goods.has(m[1].toLowerCase()) ? T : F, ...none };
  }

  m = /^building_present_min_level\s+([a-z0-9_+\-]+)\s+([a-z0-9_+\-]+)$/i.exec(a);
  if (m) {
    if (!ctx.built) return { value: U, unknown: [a], ambiguous: false };
    const chain = m[1].toLowerCase(), want = m[2].toLowerCase();
    const have = ctx.built.get(chain);
    if (!have) return { value: F, ...none };
    const order = (ctx.chainOrder && ctx.chainOrder.get(chain)) || null;
    if (!order) return { value: U, unknown: [a], ambiguous: false };
    const iHave = order.indexOf(have), iWant = order.indexOf(want);
    // A level named in the condition that the chain does not list is a broken reference in
    // the mod, not something to answer confidently either way.
    if (iHave < 0 || iWant < 0) return { value: U, unknown: [a], ambiguous: false };
    return { value: iHave >= iWant ? T : F, ...none };
  }

  // `queued` = under construction. descr_strat records no construction at the campaign
  // start (checked: zero matches in the file), so at turn 0 nothing is queued.
  m = /^building_present\s+([a-z0-9_+\-]+)(\s+queued)?$/i.exec(a);
  if (m) {
    if (m[2]) return { value: F, ...none };
    if (!ctx.built) return { value: U, unknown: [a], ambiguous: false };
    return { value: ctx.built.has(m[1].toLowerCase()) ? T : F, ...none };
  }

  m = /^no_building_tagged\s+([a-z0-9_+]+)$/i.exec(a);
  if (m) {
    if (!ctx.built || !ctx.chainTags) return { value: U, unknown: [a], ambiguous: false };
    const tag = m[1].toLowerCase();
    for (const chain of ctx.built.keys()) {
      const tags = ctx.chainTags.get(chain);
      if (tags && tags.has(tag)) return { value: F, ...none };
    }
    return { value: T, ...none };
  }

  m = /^settlement_min\s+([a-z0-9_]+)$/i.exec(a);
  if (m) {
    if (!ctx.settlementRank || ctx.settlementLevel == null) return { value: U, unknown: [a], ambiguous: false };
    const have = ctx.settlementRank(ctx.settlementLevel), want = ctx.settlementRank(m[1]);
    if (have == null || want == null) return { value: U, unknown: [a], ambiguous: false };
    return { value: have >= want ? T : F, ...none };
  }

  if (low === "is_player") {
    if (ctx.isPlayer == null) return { value: U, unknown: [a], ambiguous: false };
    return { value: ctx.isPlayer ? T : F, ...none };
  }

  // A reform. Whether it has fired is a campaign-script question, so it is answered only when
  // ctx.majorEvent says the event's own trigger script provably cannot fire at turn 0 —
  // see majorEventInactiveAtTurn0. Absent that proof it stays undecided and is reported.
  m = /^major_event\s+"([^"]+)"/i.exec(a);
  if (m) {
    const v = ctx.majorEvent ? ctx.majorEvent(m[1].toLowerCase()) : null;
    return v === false ? { value: F, ...none } : { value: U, unknown: [a], ambiguous: false };
  }
  if (/^event_counter\b/i.test(low)) return { value: U, unknown: [a], ambiguous: false };
  if (/^majority_religion\b/i.test(low) || /^religion\b/i.test(low)) return { value: U, unknown: [a], ambiguous: false };

  // Anything left is either a condition kind this evaluator does not know or an alias name
  // that could not be inlined because it is already on the expansion stack — six of the
  // mod's aliases share a name with an exclusivity tag from the `tags` block, so `alias
  // temple` mentions the token `temple` meaning the tag, not itself. Either way the honest
  // answer is that it was not decided, and the atom is named so the caller can print it.
  return { value: U, unknown: [a], ambiguous: false };
}

/**
 * Settlement size ordering, read from descr_sm_settlements.txt — the file that DECLARES the
 * ladder, one block of level names per culture, rather than hardcoding the vanilla six.
 * Every culture's block is read and they must agree on the prefix; a culture that stops early
 * (several stop at `city`) is a shorter ladder, not a different one, and the longest wins.
 */
function settlementRanks(settlementsText) {
  const ladders = [];
  let cur = null, depth = 0;
  for (const raw of String(settlementsText || "").split(SPLIT_EOL)) {
    const t = strip(raw);
    if (!t) continue;
    if (t === "{") { depth++; continue; }
    if (t === "}") { depth--; continue; }
    if (/^[a-z_]+$/.test(t) && depth === 0) { cur = []; ladders.push(cur); continue; }
    if (/^[a-z_]+$/.test(t) && depth === 1 && cur) cur.push(t);
  }
  const real = ladders.filter((l) => l.length);
  let order = [];
  for (const l of real) if (l.length > order.length) order = l;
  // Any ladder that is not a prefix of the longest means the cultures disagree about the
  // ORDER, which would make `settlement_min` mean different things in different places. That
  // is worth surfacing rather than papering over.
  const disagree = real.filter((l) => l.some((v, i) => order[i] !== v)).length;
  const rank = (s) => {
    const i = order.indexOf(String(s || "").toLowerCase().replace(/\s+/g, "_"));
    return i < 0 ? null : i;
  };
  return { order, rank, ladders: real.length, disagree };
}

// ── major events at turn 0 ───────────────────────────────────────────────────
/**
 * `major_event "polybian_reforms"` in a recruit condition asks whether a reform has happened.
 * At the campaign start the answer is usually no, but "usually" is not good enough, so it is
 * DERIVED from each event's own trigger script instead of assumed.
 *
 * descr_sm_major_events.txt names, per event, a `trigger conditions` script and a localised
 * `title`. descr_strat.txt contains no `trigger_status` lines, so no event is switched on
 * before the first check.
 *
 * The decider below only ever PROVES AN EVENT INACTIVE. It returns "inactive" when every
 * `return true` in the script sits behind an and-chained condition containing at least one
 * atom that is false at turn 0, and null — not determined — for anything else. It models
 * exactly two atom kinds and refuses the rest:
 *
 *   I_TurnNumber <op> K            — the turn is 0
 *   I_CompareCounter <name> <op> K — but only when <name> was built purely by counting
 *                                    settlements, `for_each settlement in faction "F"` with
 *                                    `inc_counter <name> 1` as the whole body. Counters the
 *                                    campaign script maintains (battle tallies and the like)
 *                                    are left undetermined.
 *
 * `else` anywhere, or an `or` inside a condition, disqualifies the script. Conditions continue
 * onto following lines beginning `and` or `&&`, and BOTH spellings appear — the Marian reform
 * uses `&&`, and reading only `and` left its `I_TurnNumber >= 2000` guard unseen, which is the
 * difference between "the Marian reform has not happened" and "not determined".
 */
function parseMajorEvents(eventsText) {
  const out = {};
  for (const m of String(eventsText || "").matchAll(/"([A-Za-z0-9_]+)"\s*:\s*\{([\s\S]*?)\n\t\}/g)) {
    const t = /"trigger conditions"\s*:\s*"([^"]+)"/.exec(m[2]);
    const ti = /"title"\s*:\s*"([^"]+)"/.exec(m[2]);
    if (t) out[m[1].toLowerCase()] = { script: t[1], titleKey: ti ? ti[1].toLowerCase() : null };
  }
  return out;
}

function majorEventInactiveAtTurn0(src, settlementsOfFaction) {
  const lines = String(src || "").split(SPLIT_EOL)
    .map((l) => l.replace(/;.*$/, "").trim()).filter(Boolean);
  if (!lines.length) return null;

  // Pass 1: counters we can put a number on.
  const counters = new Map();
  const bad = new Set();
  for (let i = 0; i < lines.length; i++) {
    let m = /^declare_counter\s+(\S+)/i.exec(lines[i]);
    if (m) { counters.set(m[1].toLowerCase(), 0); continue; }
    m = /^set_counter\s+(\S+)\s+(-?\d+)/i.exec(lines[i]);
    if (m) { counters.set(m[1].toLowerCase(), +m[2]); continue; }
    m = /^for_each\s+settlement\s+in\s+faction\s+"?([a-z_0-9]+)"?/i.exec(lines[i]);
    if (m) {
      const body = [];
      let k = i + 1;
      for (; k < lines.length && !/^end_for$/i.test(lines[k]); k++) body.push(lines[k]);
      const inc = body.length === 1 ? /^inc_counter\s+(\S+)\s+1$/i.exec(body[0]) : null;
      if (inc) {
        const c = inc[1].toLowerCase();
        const n = settlementsOfFaction ? settlementsOfFaction(m[1].toLowerCase()) : null;
        if (n == null || !counters.has(c)) bad.add(c);
        else counters.set(c, counters.get(c) + n);
      } else {
        for (const b of body) { const x = /^inc_counter\s+(\S+)/i.exec(b); if (x) bad.add(x[1].toLowerCase()); }
      }
      i = k;
      continue;
    }
    // Any other for_each (`in world`, `in region`, …) or a bare inc_counter outside one:
    // whatever it touches stops being knowable.
    m = /^inc_counter\s+(\S+)/i.exec(lines[i]);
    if (m) bad.add(m[1].toLowerCase());
    if (/^for_each\b/i.test(lines[i])) {
      let k = i + 1;
      for (; k < lines.length && !/^end_for$/i.test(lines[k]); k++) {
        const x = /^inc_counter\s+(\S+)/i.exec(lines[k]);
        if (x) bad.add(x[1].toLowerCase());
      }
    }
  }
  for (const c of bad) counters.delete(c);

  // Pass 2: is every `return true` behind a condition that is false at turn 0?
  const guards = [];
  let sawTrue = 0, unproven = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^(script|end_script|end_for|declare_counter|set_counter|inc_counter|for_each)\b/i.test(l)) continue;
    if (/^else/i.test(l)) return null;
    let m = /^if\s+(.+)$/i.exec(l);
    if (m) {
      let cond = m[1], k = i + 1;
      while (k < lines.length && /^(and|&&)\s+/i.test(lines[k])) { cond += " and " + lines[k].replace(/^(and|&&)\s+/i, ""); k++; }
      i = k - 1;
      guards.push(/\b(or|\|\|)\b/i.test(cond) ? null : (condFalseAtTurn0(cond, counters) ? true : null));
      continue;
    }
    if (/^end_if$/i.test(l)) { guards.pop(); continue; }
    if (/^return\s+true$/i.test(l)) { sawTrue++; if (!guards.some((g) => g === true)) unproven++; }
  }
  if (guards.length) return null;      // unbalanced if/end_if — do not reason about it
  if (!sawTrue) return "inactive";     // the script can never fire
  return unproven === 0 ? "inactive" : null;
}

function condFalseAtTurn0(cond, counters) {
  for (const raw of cond.split(/\s+(?:and|&&)\s+/i)) {
    const atom = raw.trim();
    let m = /^(not\s+)?I_TurnNumber\s*(>=|<=|==|>|<|=)\s*(-?\d+)/i.exec(atom);
    if (m) {
      const v = cmp(0, m[2], +m[3]);
      if (m[1] ? v : !v) return true;
      continue;
    }
    m = /^(not\s+)?I_CompareCounter\s+(\S+)\s*(>=|<=|==|>|<|=)\s*(-?\d+)/i.exec(atom);
    if (m && counters.has(m[2].toLowerCase())) {
      const v = cmp(counters.get(m[2].toLowerCase()), m[3], +m[4]);
      if (m[1] ? v : !v) return true;
      continue;
    }
  }
  return false;
}
const cmp = (a, op, b) => (op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b
  : op === "<=" ? a <= b : a === b);

/** chain(lower) -> Set of exclusivity tags, from each chain's `tags` field. */
function chainTagsOf(edb) {
  const out = new Map();
  let chain = null;
  for (const raw of String(edb).split(SPLIT_EOL)) {
    const t = strip(raw);
    let m = /^building\s+(\S+)$/.exec(t);
    if (m) { chain = m[1].toLowerCase(); continue; }
    m = /^tags?\s+(.+)$/.exec(t);
    if (m && chain) out.set(chain, new Set(m[1].split(/[\s,]+/).filter(Boolean).map((s) => s.toLowerCase())));
  }
  return out;
}

/**
 * Every place a token of one CONDITION KIND is conditioned on, split by whether the token is
 * required or excluded. `not hidden_resource X` is a real consequence too — carrying X
 * BLOCKS the thing — and reporting only the positive uses would miss most of the
 * recruitment vocabulary, where the tags mask each other.
 *
 * TWO KINDS SHARE THIS WALK. `hidden_resource <tag>` is what a region tag reference needs
 * (gen-ris-tag-pages.js); `resource <good>` is what a trade-good reference needs
 * (gen-ris-trade-goods.js). They are the same traversal — direct mentions on levels, recruit
 * lines and effect lines, plus everything reached through an `alias`, with the sign flipped
 * under a `not` — so it is written once and parameterised on the atom pattern rather than
 * copied. A second copy would drift, and the alias sign-flipping is the half that is easy to
 * get subtly wrong.
 *
 * The two patterns cannot collide: `hidden_resource` has a word character before `resource`,
 * so an anchored `^resource\s` never matches it.
 */
const HIDDEN_RESOURCE_ATOM = /^hidden_resource\s+([a-z0-9_\-]+)/i;
const RESOURCE_ATOM = /^resource\s+([a-z0-9_\-]+)\s*$/i;

/** Every place a `hidden_resource <tag>` clause names a tag. */
function tagUsage(parsed, aliases) { return usageOf(parsed, aliases, HIDDEN_RESOURCE_ATOM); }
/** Every place a `resource <good>` clause names a trade good. */
function resourceUsage(parsed, aliases) { return usageOf(parsed, aliases, RESOURCE_ATOM); }

function usageOf(parsed, aliases, ATOM) {
  const usage = new Map();   // token -> { levels:[], recruits:[], effects:[], aliases:[], blockedRecruits:[], blockedLevels:[], blockedEffects:[] }
  const get = (tok) => {
    const t = tok.toLowerCase();
    if (!usage.has(t)) usage.set(t, { levels: [], recruits: [], effects: [], aliases: [], blockedRecruits: [], blockedLevels: [], blockedEffects: [] });
    return usage.get(t);
  };

  // Which aliases mention which token, transitively, and with what sign.
  const aliasSign = new Map();   // alias -> Map(token -> "requires"|"excludes"|"both")
  const signsOf = (name, stack) => {
    const low = name.toLowerCase();
    if (aliasSign.has(low)) return aliasSign.get(low);
    const out = new Map();
    aliasSign.set(low, out);
    if (stack.includes(low)) return out;
    const body = aliases[low];
    if (body == null) return out;
    const { terms } = splitTerms(body);
    for (const { atom, negated } of terms) {
      const hr = ATOM.exec(atom.trim());
      if (hr) { merge(out, hr[1].toLowerCase(), negated ? "excludes" : "requires"); continue; }
      const sub = aliases[atom.trim().toLowerCase()];
      if (sub != null) {
        for (const [tok, sign] of signsOf(atom.trim().toLowerCase(), [...stack, low])) {
          merge(out, tok, negated ? flip(sign) : sign);
        }
      }
    }
    return out;
  };
  const flip = (s) => (s === "requires" ? "excludes" : s === "excludes" ? "requires" : "both");
  function merge(map, tok, sign) {
    const cur = map.get(tok);
    map.set(tok, !cur || cur === sign ? sign : "both");
  }

  for (const name of Object.keys(aliases)) {
    for (const [tok, sign] of signsOf(name, [])) get(tok).aliases.push({ alias: name, sign });
  }

  // Direct mentions on levels, recruit lines and effect lines, plus mentions reached through
  // an alias the condition names.
  const scan = (requires) => {
    const found = new Map();
    const { terms } = splitTerms(requires);
    for (const { atom, negated } of terms) {
      const hr = ATOM.exec(atom.trim());
      if (hr) { merge(found, hr[1].toLowerCase(), negated ? "excludes" : "requires"); continue; }
      const low = atom.trim().toLowerCase();
      if (aliases[low] != null) {
        for (const [tok, sign] of signsOf(low, [])) merge(found, tok, negated ? flip(sign) : sign);
      }
    }
    return found;
  };

  for (const c of parsed.chains) {
    for (const l of Object.values(c.levels)) {
      if (!l.requires) continue;
      for (const [tok, sign] of scan(l.requires)) {
        const e = get(tok);
        (sign === "excludes" ? e.blockedLevels : e.levels).push({ chain: c.chain, level: l.level, sign, requires: l.requires });
      }
    }
  }
  for (const r of parsed.recruits) {
    for (const [tok, sign] of scan(r.requires)) {
      const e = get(tok);
      (sign === "excludes" ? e.blockedRecruits : e.recruits).push({ ...r, sign });
    }
  }
  for (const f of parsed.effects) {
    for (const [tok, sign] of scan(f.requires)) {
      const e = get(tok);
      (sign === "excludes" ? e.blockedEffects : e.effects).push({ ...f, sign });
    }
  }
  return usage;
}

module.exports = {
  SPLIT_EOL, parseAliases, parseEdb, splitTerms, compile, evaluate, settlementRanks,
  chainTagsOf, tagUsage, resourceUsage, parseMajorEvents, majorEventInactiveAtTurn0,
};
