#!/usr/bin/env node
/**
 * Character trait reference pages, plus the index that explains the system.
 *
 *   node scripts/gen-ris-trait-pages.js [--ris <dir>] [--out <dir>]
 *
 * Writes wiki/traits.md, wiki/traits/<page>.md and wiki/traits/index.json. Run
 * check-ris-trait-pages.js afterwards — it re-reads the source with independent patterns and
 * fails on any drift between what was parsed and what was published.
 *
 * WHAT COUNTS AS A TRAIT A PLAYER SEES. export_descr_character_traits.txt declares 3,950
 * traits, and the first question is which of them deserve a page. Four candidate tests were
 * measured rather than assumed:
 *
 *   has a display name in export_vnvs.txt   3,950 of 3,950  — no test at all: the file is
 *                                            generated from a spreadsheet and every level of
 *                                            every trait is localised, machinery included
 *   is not marked `Hidden`                   3,826           — the file's OWN marker for what
 *                                            the player never sees (Immortal, FasterCharacters,
 *                                            HasCholera, the script-bookkeeping set)
 *   has at least one Effect line             2,868           — excludes epithets and titles
 *                                            that exist to be displayed, so it is too narrow
 *   is reachable by a trigger                3,338           — excludes everything granted by
 *                                            the campaign script or at birth, so it is wrong
 *                                            in the other direction
 *
 * The `Hidden` flag is the test these pages use: it is the mod's own statement of intent, and
 * both broader alternatives were shown to exclude real, displayed traits. The 124 hidden
 * traits are counted and listed on the index rather than silently dropped.
 *
 * THE SHAPE OF THE FAMILY. 3,826 visible traits are far too many for one page and too
 * formulaic for one page each: 1,419 of them are a single web of mutually-exclusive city
 * governorship titles, and ~600 more are "From <city>" / "Native of <city>" origin stamps.
 * The five formulaic families are detected by structure (the AntiTraits web they all share, the
 * Characters class, the token prefix) and compressed onto one table page apiece; everything
 * else is a dictionary, one page per first letter of the display name, every trait with its
 * levels, effects, descriptions and the triggers that grant it. Every visible trait lands on
 * EXACTLY one page, and the checker asserts the partition.
 *
 * TRAPS LEARNED PARSING THIS FILE, kept here because each one cost a wrong count:
 *   - two `Level` lines sit at column 0 (Corona_Civica2/3); a pattern requiring leading
 *     whitespace parses 5,549 of 5,551 and nothing fails
 *   - 269 `Affects` lines use `Affects <trait> Lose <n> Chance <c>` — the Lose word breaks
 *     the usual <trait> <n> shape and those lines vanish without it
 *   - two `Effect` lines separate the word with a TAB, so count with \s, not a space
 *   - export_vnvs.txt is UTF-16LE, and 5 of its {tags} are commented out with `;;;` — a flat
 *     matchAll over the text counts 16,779 where the file really declares 16,774 lines of tag,
 *     16,756 of them distinct (18 keys are declared twice; the later declaration wins, which
 *     is how the game reads it too)
 *
 * DISPLAY NAMES are per LEVEL, not per trait: {Level_Name}, {Level_Name_desc},
 * {Level_Name_effects_desc} in text/export_vnvs.txt. A trait's heading is its first level's
 * name. Effect attributes (Command, TroopMorale, …) have NO entry in any of the mod's text
 * files — they are engine UI strings — so they are rendered by splitting the token
 * (TroopMorale -> Troop Morale), the same fallback every other generator uses for a token
 * with no text entry, and the run output counts how many attributes got only that treatment.
 * `Combat_V_<x>` resolves <x> against the mod's faction and culture names where it can.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
const num = (n) => Number(n).toLocaleString("en-US");
const uniq = (a) => [...new Set(a)];
const cell = (s) => String(s).replace(/\|/g, "\\|");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fold = (summary, lines) => `<details>\n<summary>${summary}</summary>\n\n${lines.join("\n")}\n\n</details>`;

// ── the source file ──────────────────────────────────────────────────────────
const SRC = path.join(RIS, "export_descr_character_traits.txt");
let TXT = null;
try { TXT = fs.readFileSync(SRC, "latin1"); } catch { console.error(`not found: ${SRC}`); process.exit(2); }

/**
 * One walk for both halves of the file. A line beginning `Trait` opens a trait, `Trigger` a
 * trigger, and every field line belongs to whichever is open. Fields are written onto the
 * open record immediately — there is no confirming line to wait for in this format, so the
 * belief-file trap (fields declared above the line that registers the block) cannot occur,
 * but the per-field parsed-vs-flat table is still printed and enforced below because that is
 * the only thing that PROVES it.
 */
function parseTraits(txt) {
  const traits = {}; const traitOrder = [];
  const triggers = {}; const triggerOrder = [];
  let cur = null, curLevel = null, curTrigger = null, curCondition = null;
  for (const raw of txt.split(/\r?\n/)) {
    const nc = raw.replace(/;.*$/, "");
    if (!nc.trim()) continue;
    let m;
    if ((m = /^Trait\s+(\S+)/.exec(nc))) {
      cur = {
        name: m[1], characters: null, hidden: false, anti: [], excludeCultures: [],
        noGoingBack: null, maxAllowed: null, inheritChance: null, levels: [],
      };
      curLevel = null; curTrigger = null;
      traits[m[1]] = cur; traitOrder.push(m[1]);
      continue;
    }
    if ((m = /^Trigger\s+(\S+)/.exec(nc))) {
      curTrigger = { name: m[1], whenToTest: null, conditions: [], affects: [] };
      triggers[m[1]] = curTrigger; triggerOrder.push(m[1]);
      cur = null; curLevel = null; curCondition = null;
      continue;
    }
    if (curTrigger) {
      if ((m = /^\s*WhenToTest\s+(.+)$/.exec(nc))) { curTrigger.whenToTest = m[1].trim(); curCondition = null; continue; }
      // `Affects <trait> <n> Chance <c>` and `Affects <trait> Lose <n> Chance <c>` — 269
      // lines use the Lose form and disappear under the plain pattern.
      if ((m = /^\s*Affects\s+(\S+)\s+(Lose\s+)?(-?\d+)\s+Chance\s+(\d+)/.exec(nc))) {
        curTrigger.affects.push({ trait: m[1], amount: parseInt(m[3], 10) * (m[2] ? -1 : 1), lose: !!m[2], chance: parseInt(m[4], 10) });
        curCondition = null; continue;
      }
      if ((m = /^\s*Condition\s+(.+)$/.exec(nc))) { curCondition = [m[1].trim()]; curTrigger.conditions.push(curCondition); continue; }
      // continuation lines: `and …`, `or …`, a bare `)`, or an indented fragment of a
      // multi-line parenthesised clause
      if (curCondition && nc.trim()) { curCondition.push(nc.trim()); continue; }
      continue;
    }
    if (!cur) continue;
    // `Level` appears at column 0 twice (Corona_Civica2/3): \s* rather than \s+.
    if ((m = /^\s*Level\s+(\S+)/.exec(nc))) {
      curLevel = {
        name: m[1], desc: null, effectsDesc: null, gainMessage: null, loseMessage: null,
        epithet: null, threshold: null, effects: [], beliefs: [],
      };
      cur.levels.push(curLevel); continue;
    }
    if ((m = /^\s+Characters\s+(.+)$/.exec(nc))) { cur.characters = m[1].trim(); continue; }
    if (/^\s+Hidden\s*$/.test(nc)) { cur.hidden = true; continue; }
    if ((m = /^\s+AntiTraits\s+(.+)$/.exec(nc))) { cur.anti = m[1].split(",").map((s) => s.trim()).filter(Boolean); continue; }
    if ((m = /^\s+ExcludeCultures\s+(.+)$/.exec(nc))) { cur.excludeCultures = m[1].split(",").map((s) => s.trim()).filter(Boolean); continue; }
    if ((m = /^\s+NoGoingBackLevel\s+(\d+)/.exec(nc))) { cur.noGoingBack = parseInt(m[1], 10); continue; }
    if ((m = /^\s+MaxAllowed\s+(\d+)/.exec(nc))) { cur.maxAllowed = parseInt(m[1], 10); continue; }
    if ((m = /^\s+Inherit_chance\s+(\d+)/.exec(nc))) { cur.inheritChance = parseInt(m[1], 10); continue; }
    if (!curLevel) continue;
    if ((m = /^\s+Description\s+(\S+)/.exec(nc))) { curLevel.desc = m[1]; continue; }
    if ((m = /^\s+EffectsDescription\s+(\S+)/.exec(nc))) { curLevel.effectsDesc = m[1]; continue; }
    if ((m = /^\s+GainMessage\s+(\S+)/.exec(nc))) { curLevel.gainMessage = m[1]; continue; }
    if ((m = /^\s+LoseMessage\s+(\S+)/.exec(nc))) { curLevel.loseMessage = m[1]; continue; }
    if ((m = /^\s+Epithet\s+(\S+)/.exec(nc))) { curLevel.epithet = m[1]; continue; }
    if ((m = /^\s+Threshold\s+(-?\d+)/.exec(nc))) { curLevel.threshold = parseInt(m[1], 10); continue; }
    // two Effect lines use a tab after the word: \s, never a literal space
    if ((m = /^\s+Effect\s+(\S+)\s+(-?\d+)/.exec(nc))) { curLevel.effects.push({ attr: m[1], amount: parseInt(m[2], 10) }); continue; }
    if ((m = /^\s+Religious_Belief\s+(\S+)\s+(-?\d+)/.exec(nc))) { curLevel.beliefs.push({ belief: m[1], amount: parseInt(m[2], 10) }); continue; }
  }
  return { traits, traitOrder, triggers, triggerOrder };
}
const { traits: TRAITS, traitOrder: TRAIT_ORDER, triggers: TRIGGERS, triggerOrder: TRIGGER_ORDER } = parseTraits(TXT);
if (!TRAIT_ORDER.length) { console.error("no traits parsed"); process.exit(2); }

// ── parsed vs flat, per field — printed every run and ENFORCED ───────────────
// A parser that drops a field does so silently; only a flat pattern over the raw text, with
// no block structure involved, can contradict it. Any mismatch is a hard failure.
const ALL = TRAIT_ORDER.map((t) => TRAITS[t]);
const ALL_LEVELS = ALL.flatMap((t) => t.levels);
const ALL_TRIGGERS = TRIGGER_ORDER.map((t) => TRIGGERS[t]);
const flatOf = (re) => (TXT.match(re) || []).length;
const FIELD_TABLE = [
  ["Trait", ALL.length, flatOf(/^Trait\s/gm)],
  ["Level", ALL_LEVELS.length, flatOf(/^\s*Level\s/gm)],
  ["Trigger", ALL_TRIGGERS.length, flatOf(/^Trigger\s/gm)],
  ["Effect", ALL_LEVELS.reduce((a, l) => a + l.effects.length, 0), flatOf(/^\s*Effect\s/gm)],
  ["Affects", ALL_TRIGGERS.reduce((a, t) => a + t.affects.length, 0), flatOf(/^\s*Affects\s/gm)],
  ["Characters", ALL.filter((t) => t.characters != null).length, flatOf(/^\s+Characters\s/gm)],
  ["Hidden", ALL.filter((t) => t.hidden).length, flatOf(/^\s+Hidden\s*$/gm)],
  ["AntiTraits", ALL.filter((t) => t.anti.length).length, flatOf(/^\s+AntiTraits\s/gm)],
  ["ExcludeCultures", ALL.filter((t) => t.excludeCultures.length).length, flatOf(/^\s+ExcludeCultures\s/gm)],
  ["NoGoingBackLevel", ALL.filter((t) => t.noGoingBack != null).length, flatOf(/^\s+NoGoingBackLevel\s/gm)],
  ["MaxAllowed", ALL.filter((t) => t.maxAllowed != null).length, flatOf(/^\s+MaxAllowed\s/gm)],
  ["Inherit_chance", ALL.filter((t) => t.inheritChance != null).length, flatOf(/^\s+Inherit_chance\s/gm)],
  ["Description", ALL_LEVELS.filter((l) => l.desc).length, flatOf(/^\s+Description\s/gm)],
  ["EffectsDescription", ALL_LEVELS.filter((l) => l.effectsDesc).length, flatOf(/^\s+EffectsDescription\s/gm)],
  ["Threshold", ALL_LEVELS.filter((l) => l.threshold != null).length, flatOf(/^\s+Threshold\s/gm)],
  ["GainMessage", ALL_LEVELS.filter((l) => l.gainMessage).length, flatOf(/^\s+GainMessage\s/gm)],
  ["LoseMessage", ALL_LEVELS.filter((l) => l.loseMessage).length, flatOf(/^\s+LoseMessage\s/gm)],
  ["Epithet", ALL_LEVELS.filter((l) => l.epithet).length, flatOf(/^\s+Epithet\s/gm)],
  ["Religious_Belief", ALL_LEVELS.reduce((a, l) => a + l.beliefs.length, 0), flatOf(/^\s+Religious_Belief\s/gm)],
  ["WhenToTest", ALL_TRIGGERS.filter((t) => t.whenToTest).length, flatOf(/^\s*WhenToTest\s/gm)],
  ["Condition", ALL_TRIGGERS.reduce((a, t) => a + t.conditions.length, 0), flatOf(/^\s*Condition\s/gm)],
];
let fieldMismatches = 0;
console.log("export_descr_character_traits.txt — parsed vs a flat pattern, per field:");
for (const [k, p, f] of FIELD_TABLE) {
  const ok = p === f;
  if (!ok) fieldMismatches++;
  console.log(`  ${k.padEnd(20)} ${String(num(p)).padStart(8)} / ${String(num(f)).padStart(8)}${ok ? "" : "   <- MISMATCH"}`);
}
if (fieldMismatches) { console.error(`\n${fieldMismatches} field(s) drift between parser and flat count — nothing was written`); process.exit(1); }

// ── display text: export_vnvs.txt, UTF-16LE, line-walked ─────────────────────
// A flat matchAll over the text finds 16,779 {tags}; five of them are commented out with
// `;;;` and are skipped here, and 18 keys are declared twice — the later declaration wins,
// which is also how the game resolves them. Both figures are printed below.
const VNVS = {};
let vnvsTagLines = 0, vnvsDupes = 0, vnvsCommented = 0;
{
  let t = null;
  try { t = fs.readFileSync(path.join(RIS, "text", "export_vnvs.txt"), "utf16le"); } catch { console.error("text/export_vnvs.txt not found"); process.exit(2); }
  let cur = null;
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    const trimmed = line.trim();
    if (/^¬/.test(trimmed)) continue;
    if (/^;/.test(trimmed)) { if (/\{[^}]+\}/.test(trimmed)) vnvsCommented++; continue; }
    const m = /^\{([^}]+)\}\s*(.*)$/.exec(trimmed);
    if (m) { vnvsTagLines++; if (VNVS[m[1]] !== undefined) vnvsDupes++; cur = m[1]; VNVS[cur] = m[2].trim(); continue; }
    if (cur && trimmed) VNVS[cur] = (VNVS[cur] ? VNVS[cur] + " " : "") + trimmed;
  }
}

// ── names for the tokens effects point at ────────────────────────────────────
function loadText(file) {
  const map = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", file), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) map[m[1].trim().toLowerCase()] = m[2].trim();
  } catch { /* fall back to the token */ }
  return map;
}
const BI_NAMES = loadText("expanded_bi.txt");
const FACTION_NAMES = (() => {
  const out = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", "campaign_descriptions.txt"), "utf16le");
    for (const m of t.matchAll(/\{IMPERIAL_CAMPAIGN_([A-Z0-9_]+)_TITLE\}([^\r\n]*)/g)) out[m[1].toLowerCase()] = m[2].trim();
  } catch { /* tokens */ }
  return out;
})();
const readIndex = (sub) => {
  try { return JSON.parse(fs.readFileSync(path.join(OUT, sub, "index.json"), "utf8")); } catch { return {}; }
};
const CULTURE_INDEX = readIndex("cultures");
const BELIEF_INDEX = readIndex("religions");

// The engine's effect attributes have no entry in any of the mod's text files — they are UI
// strings inside the game itself. The token is split instead (TroopMorale -> Troop Morale),
// which is the same fallback the other generators use for a token with no text entry, and the
// run output says how many attributes got only that treatment. Combat_V_<x> is the exception
// whose <x> IS resolvable from the mod's own files.
const attrResolved = new Set(); const attrMechanical = new Set();
function attrName(attr) {
  let m = /^Combat_V_(.+)$/i.exec(attr);
  if (m) {
    const x = m[1].toLowerCase();
    const viaFaction = FACTION_NAMES[x] || BI_NAMES[x];
    const viaCulture = CULTURE_INDEX[x] && CULTURE_INDEX[x].name;
    if (viaFaction || viaCulture) { attrResolved.add(attr); return `Combat vs ${viaFaction || viaCulture}`; }
    attrMechanical.add(attr);
    return `Combat vs ${m[1].replace(/_/g, " ")}`;
  }
  attrMechanical.add(attr);
  return attr
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\bOf\b/g, "of");
}
const fx = (e) => `${e.amount > 0 ? "+" : ""}${e.amount} ${attrName(e.attr)}`;
const beliefFx = (b) => {
  const e = BELIEF_INDEX[String(b.belief).toLowerCase()];
  const name = e ? `[${e.name}](../religions/${e.page})` : String(b.belief).replace(/_/g, " ");
  return `${b.amount > 0 ? "+" : ""}${b.amount} ${name} belief`;
};
const levelFx = (l) => {
  const parts = [...l.effects.map(fx), ...l.beliefs.map(beliefFx)];
  return parts.length ? parts.join(", ") : "no stat effects";
};
let cultureLinked = 0;
const cultureRef = (tok) => {
  const e = CULTURE_INDEX[String(tok).toLowerCase()];
  if (!e) return String(tok).replace(/_/g, " ");
  cultureLinked++;
  return `[${e.name}](../cultures/${e.page})`;
};

// ── who a trait can appear on ────────────────────────────────────────────────
const CHAR_CLASS = {
  family: "family members — generals, governors, leaders",
  all: "every character, agents included",
  diplomat: "diplomats",
  spy: "spies",
  assassin: "assassins",
  admiral: "admirals",
};
const charName = (c) => CHAR_CLASS[c] || String(c || "").replace(/_/g, " ") || "not stated";

// ── trigger events, in plain words ───────────────────────────────────────────
// The WhenToTest vocabulary is the engine's. The common ones are phrased for a reader; any
// value not in this map is split mechanically, so a new event cannot print as CamelCase glue.
const EVENT_PHRASE = {
  CharacterTurnEnd: "at the end of the character's turn",
  CharacterTurnStart: "at the start of the character's turn",
  CharacterTurnEndInSettlement: "ending a turn in a settlement",
  PostBattle: "after a battle",
  BattleAiCommenced: "as battle is joined",
  GeneralCaptureSettlement: "on capturing a settlement",
  GeneralCaptureResidence: "on capturing a residence",
  CharacterComesOfAge: "on coming of age",
  CharacterMarries: "on marriage",
  CharacterBecomesAFather: "on becoming a father",
  GovernorCityRiots: "when the governed city riots",
  GovernorCityRebels: "when the governed city rebels",
  GovernorBuildingCompleted: "when a building completes in the governed city",
  GovernorUnitTrained: "when a unit is trained in the governed city",
  GovernorAgentCreated: "when an agent is trained in the governed city",
  GovernorThrowGames: "on holding games",
  GovernorThrowRaces: "on holding races",
  GeneralOrdersRaid: "on ordering a raid",
  OfferedForAdoption: "when offered for adoption",
  OfferedForMarriage: "when offered for marriage",
  LeaderOrderedDiplomacy: "when ordered on a diplomatic mission",
  LeaderOrderedSpyingMission: "when ordered on a spying mission",
  LeaderOrderedAssassination: "when ordered to assassinate",
  SufferAssassinationAttempt: "on surviving an assassination attempt",
  ExecutesASpyOnAMission: "on executing a captured spy",
  AcquiresAncillary: "on acquiring a retinue member",
  TakeOffice: "on taking office",
  LeaveOffice: "on leaving office",
  CeasedFactionLeader: "on ceasing to be faction leader",
  BecomesFactionLeader: "on becoming faction leader",
  BecomesFactionHeir: "on becoming faction heir",
  HordeMigrated: "when the horde migrates",
  UnitDisbanded: "on disbanding a unit",
  Birth: "at birth",
};
const eventPhrase = (w) => EVENT_PHRASE[w] || (w ? w.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() : "not stated");

// ── which triggers feed which trait ──────────────────────────────────────────
const TRIGGERS_FOR = new Map();
for (const tr of ALL_TRIGGERS) {
  for (const a of tr.affects) {
    if (!TRIGGERS_FOR.has(a.trait)) TRIGGERS_FOR.set(a.trait, []);
    TRIGGERS_FOR.get(a.trait).push({ trigger: tr, ...a });
  }
}

// ── the visibility decision, measured ────────────────────────────────────────
const hasNameEntry = (t) => t.levels.some((l) => (VNVS[l.name] || "").length > 0);
const hasEffects = (t) => t.levels.some((l) => l.effects.length > 0 || l.beliefs.length > 0);
const isReachable = (t) => TRIGGERS_FOR.has(t.name);
const CANDIDATES = [
  ["has a display name in export_vnvs.txt", ALL.filter(hasNameEntry).length],
  ["is not marked Hidden", ALL.filter((t) => !t.hidden).length],
  ["has at least one Effect line", ALL.filter(hasEffects).length],
  ["is reachable by a trigger", ALL.filter(isReachable).length],
  ["not Hidden AND reachable by a trigger", ALL.filter((t) => !t.hidden && isReachable(t)).length],
];
const HIDDEN = ALL.filter((t) => t.hidden);
const VISIBLE = ALL.filter((t) => !t.hidden);

// ── display name per trait ───────────────────────────────────────────────────
const nameVia = { text: 0, token: 0 };
function levelName(l) {
  const n = VNVS[l.name];
  if (n) { nameVia.text++; return n; }
  nameVia.token++;
  return String(l.name).replace(/_/g, " ");
}
for (const t of ALL) {
  t.levels.forEach((l) => { l.display = levelName(l); });
  t.display = t.levels[0].display;
}

// ── the partition: five structural families, then the dictionary ─────────────
// Rules in order, first match wins. Every rule is structural — the AntiTraits web, the
// Characters class, the token prefix — never a guess at meaning.
function pageOf(t) {
  if (t.anti.includes("Not_Archon") || /^(Archon_|Strategos_)/.test(t.name) || t.name === "Not_Archon") return "governorships";
  if (["diplomat", "spy", "assassin"].includes(t.characters)) return "agents";
  if (t.characters === "admiral") return "admirals";
  if (/^(Fears|Hates)/.test(t.name)) return "fears-and-hatreds";
  if (/^(From |Native of )/.test(t.display)) return "origins";
  const m = /[a-z]/i.exec(t.display);
  return m ? m[0].toLowerCase() : "other";
}
for (const t of VISIBLE) t.page = pageOf(t);
const PAGES = new Map();
for (const t of VISIBLE) {
  if (!PAGES.has(t.page)) PAGES.set(t.page, []);
  PAGES.get(t.page).push(t);
}

// ── anchors: the heading each trait sits under, unique per page ──────────────
// Table pages anchor at their section heading; dictionary pages at the trait's own H3.
// Duplicate display names on one page (39 governorship webs all read "Strategos") get the
// de-underscored token appended so no two headings slug alike.
for (const [, list] of PAGES) {
  const seen = new Map();
  for (const t of list.slice().sort((a, b) => a.display.localeCompare(b.display) || a.name.localeCompare(b.name))) {
    const n = (seen.get(t.display) || 0) + 1;
    seen.set(t.display, n);
    t.heading = n === 1 ? t.display : `${t.display} (${t.name.replace(/_/g, " ")})`;
  }
}

// ── rendering helpers ────────────────────────────────────────────────────────
const TRAIT_LINKS = new Map();   // token -> { page file, anchor }
const TABLE_PAGES = new Set(["governorships", "fears-and-hatreds", "origins"]);
for (const [page, list] of PAGES) {
  for (const t of list) {
    TRAIT_LINKS.set(t.name, { page: `${page}.md`, anchor: TABLE_PAGES.has(page) ? "the-traits" : slug(t.heading) });
  }
}
let antiLinked = 0, antiHiddenOrMissing = 0;
function traitRef(token) {
  const target = TRAIT_LINKS.get(token);
  const t = TRAITS[token];
  const label = t ? t.display : String(token).replace(/_/g, " ");
  if (!target) { antiHiddenOrMissing++; return label; }
  antiLinked++;
  return `[${label}](${target.page}#${target.anchor})`;
}

function triggerFold(t) {
  const feeds = TRIGGERS_FOR.get(t.name) || [];
  if (!feeds.length) {
    return "_No trigger in the file grants this trait. It comes from the campaign script, from birth, or from inheritance — the trait file itself does not say which._";
  }
  const gains = feeds.filter((f) => !f.lose), losses = feeds.filter((f) => f.lose);
  const events = uniq(feeds.map((f) => eventPhrase(f.trigger.whenToTest))).slice(0, 4);
  const rows = feeds.slice(0, 60).map((f) => {
    const cond = f.trigger.conditions.map((c) => c.join(" ")).join(" · ");
    return `| ${eventPhrase(f.trigger.whenToTest)} | ${f.lose ? "loses" : "+"}${Math.abs(f.amount)} | ${f.chance}% | ${cond ? `\`${cell(cond.slice(0, 220))}${cond.length > 220 ? "…" : ""}\`` : "always"} |`;
  });
  const table = [
    `| When | Points | Chance | Conditions |`,
    `|---|---|---:|---|`,
    ...rows,
    feeds.length > 60 ? `| _…and ${feeds.length - 60} more_ | | | |` : null,
  ].filter(Boolean).join("\n");
  return fold(
    `How it is ${losses.length && !gains.length ? "lost" : "gained"} — ${feeds.length} trigger${feeds.length === 1 ? "" : "s"}, ${events.join(", ")}${losses.length && gains.length ? ` (${losses.length} remove points)` : ""}`,
    [table],
  );
}

function factsLine(t) {
  const bits = [`Appears on ${charName(t.characters)}`];
  if (t.levels.length > 1) bits.push(`**${t.levels.length}** levels`);
  if (t.anti.length) bits.push(`pulls against ${t.anti.map(traitRef).join(", ")}`);
  if (t.inheritChance != null) bits.push(`sons inherit it ${t.inheritChance}% of the time`);
  if (t.maxAllowed != null) bits.push(`at most **${t.maxAllowed}** character${t.maxAllowed === 1 ? "" : "s"} may hold it`);
  if (t.noGoingBack != null && t.levels.length > 1) bits.push(`cannot fall back below level ${t.noGoingBack}`);
  if (t.excludeCultures.length) bits.push(`never on ${t.excludeCultures.length} of the cultures`);
  return bits.join(" · ") + ".";
}

function traitEntry(t) {
  const lines = [`### ${t.heading}`, ""];
  lines.push(factsLine(t));
  lines.push("");
  if (t.levels.length === 1) {
    const l = t.levels[0];
    lines.push(`**Effects:** ${levelFx(l)}${l.epithet ? ` · grants the epithet _${VNVS[l.epithet] || l.epithet.replace(/_/g, " ")}_` : ""}`);
    lines.push("");
    const d = VNVS[l.desc];
    if (d) lines.push(`> ${cell(d)}`);
    else lines.push("> _description not determined — no text entry_");
  } else {
    lines.push(`| Level | At points | Effects |`);
    lines.push(`|---|---:|---|`);
    for (const l of t.levels) {
      lines.push(`| **${cell(l.display)}**${l.epithet ? ` · epithet _${cell(VNVS[l.epithet] || l.epithet.replace(/_/g, " "))}_` : ""} | ${l.threshold == null ? "—" : l.threshold} | ${cell(levelFx(l))} |`);
    }
    const descs = t.levels.filter((l) => VNVS[l.desc]);
    if (descs.length) {
      lines.push("");
      lines.push(fold(`What the game says at each level`, descs.map((l) => `**${cell(l.display)}** — ${cell(VNVS[l.desc])}\n`)));
    }
  }
  if (t.excludeCultures.length) {
    lines.push("");
    lines.push(fold(`Cultures that never receive it (${t.excludeCultures.length})`, [t.excludeCultures.map(cultureRef).join(" · ")]));
  }
  lines.push("");
  lines.push(triggerFold(t));
  return lines.join("\n");
}

// A one-row rendering for the three formulaic families, where 1,419 title stamps as full
// entries would bury the reader. The in-game description of each is per-city flavour text and
// is left to the game screen; everything mechanical is in the row.
function traitRow(t) {
  const fxCol = t.levels.map((l) => (t.levels.length > 1 ? `**${cell(l.display)}:** ${cell(levelFx(l))}` : cell(levelFx(l)))).join(" · ");
  const feeds = (TRIGGERS_FOR.get(t.name) || []).length;
  return `| **${cell(t.heading)}** | ${fxCol} | ${feeds || "—"} |`;
}

const HEAD = (title) => `# ${title}\n\n[← all traits](../traits.md) · [wiki index](../README.md)\n`;

function tablePage(page, title, intro) {
  const list = PAGES.get(page) || [];
  list.sort((a, b) => a.heading.localeCompare(b.heading));
  const multi = list.filter((t) => t.levels.length > 1).length;
  return `${HEAD(title)}
${intro(list)}

## The traits

**Triggers** is how many rules in the file grant or remove the trait's points; a — means the
campaign script or an office grants it directly. Each title's in-game description is its own
per-city flavour text, read in game rather than reprinted ${num(list.length)} times here.
${multi ? `${multi} of these carry more than one level; their effects are listed per level.` : ""}

| Trait | Effects | Triggers |
|---|---|---:|
${list.map(traitRow).join("\n")}
`;
}

// ── write the family ─────────────────────────────────────────────────────────
fs.mkdirSync(path.join(OUT, "traits"), { recursive: true });
const written = new Map();
const writePage = (file, body) => { fs.writeFileSync(path.join(OUT, "traits", file), body, "utf8"); written.set(file, body); };

// the three compressed table pages
writePage("governorships.md", tablePage("governorships", "City governorships",
  (list) => `One web of **${num(list.length)}** mutually exclusive city titles — Archon, Shophet, Strategos and
their kin — one per governable city. Holding the office grants the title and its bonus;
losing the city takes it away. Every one of them excludes every other through the shared
\`Not_Archon\` anti-trait, which is how the file keeps one governor to one city.`));
writePage("fears-and-hatreds.md", tablePage("fears-and-hatreds", "Fears and hatreds",
  (list) => `**${num(list.length)}** traits from the ethnic module: characters who campaign against a people long
enough come to hate them — or fear them. Hatred sharpens combat against that people;
fear blunts it. Each pair pulls against the other, so a character drifts toward one pole.`));
writePage("origins.md", tablePage("origins", "Origins and hometowns",
  (list) => `**${num(list.length)}** birthplace stamps: "From" a city for family members, "Native of" a city for
agents. Most carry no stat effects at all — they exist so a character's biography names
a home — and the handful that do are border-city stamps with a loyalty edge.`));

// the two small full-detail class pages
function classPage(page, title, intro) {
  const list = (PAGES.get(page) || []).slice().sort((a, b) => a.heading.localeCompare(b.heading));
  return `${HEAD(title)}
${intro(list)}

${list.map(traitEntry).join("\n\n---\n\n")}
`;
}
writePage("agents.md", classPage("agents", "Agent traits",
  (list) => `**${num(list.length)}** traits that appear only on diplomats, spies and assassins — the skill ladders
and habits of the characters who work alone. Traits open to every character type,
agents included, are in the main dictionary.`));
writePage("admirals.md", classPage("admirals", "Admiral traits",
  (list) => `**${num(list.length)}** traits that appear only on admirals: sea-sense, victory experience, the state of
the fleet's supplies and pay. A fleet's character is its admiral — ships carry no
traits of their own.`));

// the dictionary
const LETTERS = [...PAGES.keys()].filter((p) => /^[a-z]$/.test(p)).sort();
const OTHER = PAGES.get("other") || [];
if (OTHER.length) { console.error(`unplaceable traits (no letter in display name): ${OTHER.map((t) => t.name).join(", ")}`); process.exit(1); }
for (const L of LETTERS) {
  const list = PAGES.get(L).slice().sort((a, b) => a.heading.localeCompare(b.heading));
  const body = `${HEAD(`Traits — ${L.toUpperCase()}`)}
**${num(list.length)}** trait${list.length === 1 ? "" : "s"} whose display name begins with **${L.toUpperCase()}**.
${LETTERS.map((x) => (x === L ? `**${x.toUpperCase()}**` : `[${x.toUpperCase()}](${x}.md)`)).join(" · ")}

${list.map(traitEntry).join("\n\n---\n\n")}
`;
  writePage(`${L}.md`, body);
}

// ── the index page ───────────────────────────────────────────────────────────
const epithetLevels = ALL_LEVELS.filter((l) => l.epithet).length;
const attrCounts = {};
for (const t of VISIBLE) for (const l of t.levels) for (const e of l.effects) attrCounts[e.attr] = (attrCounts[e.attr] || 0) + 1;
const topAttrs = Object.entries(attrCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);
const charCounts = {};
for (const t of VISIBLE) charCounts[t.characters || "(none)"] = (charCounts[t.characters || "(none)"] || 0) + 1;
const inheritable = VISIBLE.filter((t) => t.inheritChance != null).length;
const PAGE_ROWS = [
  ["governorships.md", "City governorships", "one web of mutually exclusive city titles"],
  ["fears-and-hatreds.md", "Fears and hatreds", "the ethnic module: hatred sharpens, fear blunts"],
  ["origins.md", "Origins and hometowns", "birthplace stamps for characters and agents"],
  ["agents.md", "Agent traits", "diplomats, spies and assassins only"],
  ["admirals.md", "Admiral traits", "admirals only — experience, supplies, pay"],
];

const indexBody = `# Character traits

[← wiki index](README.md) · [all factions](factions.md) · [all units](units.md)

Characters in **RTR: Imperium Surrectum** are shaped by **${num(VISIBLE.length)}** visible traits — the virtues,
vices, offices, wounds, habits and reputations that appear on a general's, governor's or
agent's scroll. Behind them the file also declares **${HIDDEN.length}** hidden bookkeeping traits the player
never sees; they are counted here and excluded everywhere else.

<details>
<summary>What counts as a trait a player sees — the tests that were measured</summary>

The file declares **${num(ALL.length)}** traits. Four candidate tests for "the player sees this" were
measured rather than assumed:

| Candidate test | Traits it keeps |
|---|---:|
${CANDIDATES.map(([k, n]) => `| ${k} | ${num(n)} |`).join("\n")}

Every level of every trait has a display name in the text files — the file is generated from
a spreadsheet, machinery included — so the name test selects nothing. Requiring an Effect
line drops real display-only traits (epithets, titles); requiring a trigger drops everything
granted by the campaign script or at birth. The \`Hidden\` flag is the mod's own marker for
what the player never sees, and it is the test these pages use: **${num(VISIBLE.length)}** visible, **${HIDDEN.length}** hidden.

The ${HIDDEN.length} hidden traits, so the exclusion is inspectable: ${HIDDEN.map((t) => `\`${t.name}\``).join(", ")}.

</details>

## How traits work

- **A trait is a ladder of levels.** Points accumulate through triggers — battles fought,
  turns idle, buildings raised — and each level shows once its points reach that level's
  threshold. The ${num(VISIBLE.length)} visible traits carry ${num(VISIBLE.reduce((a, t) => a + t.levels.length, 0))} levels between them, fed by ${num(ALL_TRIGGERS.length)} triggers and
  ${num(ALL_TRIGGERS.reduce((a, t) => a + t.affects.length, 0))} award rules.
- **Traits pull against each other.** ${num(VISIBLE.filter((t) => t.anti.length).length)} of the visible traits name anti-traits: points in
  one drain the other, so a character drifts toward drink or sobriety, courage or cowardice,
  never both.
- **${num(inheritable)}** traits can pass from father to son at birth.
- **${num(epithetLevels)}** trait levels grant an epithet — the "the Great" and "the Mad" a name carries.
- Some traits are one-way: past a \`NoGoingBackLevel\`, the ladder no longer goes down.

## Where to look

| Page | Traits | What is on it |
|---|---:|---|
${PAGE_ROWS.map(([f, title, what]) => `| [**${title}**](traits/${f}) | ${num((PAGES.get(f.replace(/\.md$/, "")) || []).length)} | ${what} |`).join("\n")}

### The dictionary — every other trait, by first letter

| | | | | |
|---|---|---|---|---|
${(() => {
    const cells = LETTERS.map((L) => `[**${L.toUpperCase()}**](traits/${L}.md) · ${PAGES.get(L).length}`);
    const rows = [];
    for (let i = 0; i < cells.length; i += 5) rows.push(`| ${cells.slice(i, i + 5).join(" | ")} |`);
    return rows.join("\n");
  })()}

## What traits touch

The twelve stats trait effects reach most often, across the ${num(VISIBLE.length)} visible traits:

| Stat | Effect lines |
|---|---:|
${topAttrs.map(([a, n]) => `| ${attrName(a)} | ${num(n)} |`).join("\n")}

Who the traits appear on: ${Object.entries(charCounts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `**${num(n)}** on ${charName(c)}`).join(" · ")}.

<details>
<summary>Where these answers come from</summary>

export_descr_character_traits.txt declares every trait, level, effect and trigger; display
names and descriptions are text/export_vnvs.txt (UTF-16LE), keyed by level name. Effect
attribute names (Command, Troop Morale, …) are the engine's own UI strings and exist in no
mod text file, so they are rendered from the token. Values are printed exactly as the file
gives them — movement points as points, never converted to percentages. Where a description
has no text entry the page says **not determined** rather than inventing one.

</details>
`;
fs.writeFileSync(path.join(OUT, "traits.md"), indexBody, "utf8");

// ── index.json for consumers ─────────────────────────────────────────────────
const INDEX = {};
for (const t of VISIBLE) {
  INDEX[t.name] = { page: `${t.page}.md`, anchor: TRAIT_LINKS.get(t.name).anchor, name: t.display };
}
fs.writeFileSync(path.join(OUT, "traits", "index.json"), JSON.stringify(INDEX, null, 1), "utf8");

// ── report ───────────────────────────────────────────────────────────────────
const say = (s) => console.log(s);
say(`\ntrait pages -> ${path.join(OUT, "traits")} (+ traits.md, traits/index.json)`);
say(`  visibility: ${num(VISIBLE.length)} visible / ${HIDDEN.length} hidden of ${num(ALL.length)} declared — the candidates, measured:`);
for (const [k, n] of CANDIDATES) say(`    ${k.padEnd(42)} ${num(n)}`);
say(`  export_vnvs.txt: ${num(vnvsTagLines)} live tag lines, ${num(Object.keys(VNVS).length)} distinct keys, ${vnvsDupes} declared twice (later wins), ${vnvsCommented} commented out with ;;;`);
say(`  display names: ${num(nameVia.text)} levels named from the text file, ${nameVia.token} from the token  <- a nonzero second number means untranslated levels`);
say(`  partition: ${[...PAGES.entries()].filter(([p]) => !/^[a-z]$/.test(p)).map(([p, l]) => `${p} ${l.length}`).join(" · ")} · dictionary ${LETTERS.reduce((a, L) => a + PAGES.get(L).length, 0)} across ${LETTERS.length} letter pages`);
{
  const placed = [...PAGES.values()].reduce((a, l) => a + l.length, 0);
  say(`  every visible trait on exactly one page: ${placed === VISIBLE.length ? `yes, ${num(placed)}` : `NO — ${num(placed)} placed vs ${num(VISIBLE.length)} visible`}`);
  if (placed !== VISIBLE.length) process.exit(1);
}
say(`  effect attributes: ${Object.keys(attrCounts).length} distinct · ${attrResolved.size} Combat-vs tokens resolved via faction/culture names · ${attrMechanical.size} rendered from the token (engine UI strings, no mod text entry)`);
say(`  anti-trait references: ${antiLinked} linked to their page · ${antiHiddenOrMissing} name hidden or undeclared traits (unlinked)`);
say(`  cultures linked: ${cultureLinked} (${Object.keys(CULTURE_INDEX).length} in cultures/index.json)${Object.keys(CULTURE_INDEX).length ? "" : "  <- run gen-ris-culture-pages.js first, then this again"}`);
say(`  beliefs linked: ${Object.keys(BELIEF_INDEX).length ? "religions/index.json present" : "religions/index.json MISSING — belief tokens printed bare"}`);
say(`  pages written: ${written.size} under traits/, plus traits.md and traits/index.json`);
say(`  NEXT: node scripts/check-ris-trait-pages.js && node scripts/verify-ris-wiki.js`);
