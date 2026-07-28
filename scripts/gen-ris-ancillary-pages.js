#!/usr/bin/env node
/**
 * Retinue (ancillary) reference pages, plus the index that explains the system.
 *
 *   node scripts/gen-ris-ancillary-pages.js [--ris <dir>] [--out <dir>]
 *
 * Run AFTER gen-ris-trait-pages.js (this consumes traits/index.json to link the traits an
 * ancillary's acquisition is conditioned on) and run gen-ris-trait-pages.js AGAIN afterwards
 * so the trait pages can print their "retinue it attracts" line from ancillaries/index.json —
 * the same circular arrangement the culture and belief generators already use. Then run
 * check-ris-ancillary-pages.js, which re-reads the source with an independent mechanism.
 *
 * WHAT COUNTS AS AN ANCILLARY A PLAYER SEES. Unlike the trait file there is NO Hidden flag —
 * the ancillary vocabulary is Image / Description / EffectsDescription / Effect /
 * Religious_Belief / Unique / ExcludedAncillaries / ExcludeCultures, and nothing else. The
 * candidate tests, measured:
 *
 *   has a display name in export_ancillaries.txt   1,115 of 1,115 — fully localised
 *   has at least one effect                        1,113           — two are pure flavour
 *   reachable by an AcquireAncillary trigger         983           — the other 132 are given
 *                                                   by the campaign script (Hanno the Great,
 *                                                   the Pet Elephant) and still shown in game
 *
 * So ALL 1,115 are published: the file offers no marker of concealment, every entry is
 * localised, and the trigger test demonstrably excludes real, displayed retinue. Entries a
 * trigger never grants say so explicitly instead of being dropped.
 *
 * DISPLAY TEXT is NOT export_vnvs.txt: ancillaries have their own text/export_ancillaries.txt
 * (UTF-16LE, 3,739 keys), keyed {token}, {token_desc}, {token_effects_desc}. Resolution is
 * 100% on all three keys and the run output proves it.
 *
 * THE DEAD-ZONE TRAP. trigger_EducationInCarthage_02 is commented out — but only its
 * `Trigger` line. Its WhenToTest, Condition, `and` and AcquireAncillary lines are live text
 * that belongs to nothing, and a parser that keeps the previous trigger open would attach
 * them to trigger_EducationInCarthage_01, which would then grant BOTH the astrologer and the
 * geographer. A commented-out `Trigger`/`Ancillary` line therefore opens a dead zone that
 * swallows body lines until the next live block, and the swallowed lines are counted and
 * printed on every run (4 as RIS ships). One Effect line also writes its amount as `+1` with
 * an explicit plus, which a bare `-?\d+` silently drops.
 *
 * PORTRAITS: each entry names an Image in ui/ancillaries/ (145 distinct files for the 1,115
 * entries — most share stock portraits). They are converted once each into
 * wiki/ancillary-icons/, which this generator owns.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
// Portraits only: 27 of the 145 images the mod references are the base game's stock art,
// not shipped in the mod folder — the engine falls back to the install, and so does this.
const VAN = valOf("--vanilla",
  "C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/data");
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
const num = (n) => Number(n).toLocaleString("en-US");
const uniq = (a) => [...new Set(a)];
const cell = (s) => String(s).replace(/\|/g, "\\|");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fold = (summary, lines) => `<details>\n<summary>${summary}</summary>\n\n${lines.join("\n")}\n\n</details>`;

const SRC = path.join(RIS, "export_descr_ancillaries.txt");
let TXT = null;
try { TXT = fs.readFileSync(SRC, "latin1"); } catch { console.error(`not found: ${SRC}`); process.exit(2); }

// ── parse, with dead zones ───────────────────────────────────────────────────
const ANCS = {}; const ORDER = [];
const TRIGS = {}; const TORDER = [];
let deadLines = [];
{
  let cur = null, curTrig = null, curCond = null, dead = false;
  for (const raw of TXT.split(/\r?\n/)) {
    if (/^;+\s*(Trigger|Ancillary)\s/.test(raw)) { dead = true; cur = null; curTrig = null; curCond = null; continue; }
    const nc = raw.replace(/;.*$/, "");
    if (!nc.trim()) continue;
    let m;
    if ((m = /^Ancillary\s+(\S+)/.exec(nc))) {
      dead = false; curTrig = null;
      cur = { name: m[1], image: null, unique: false, excluded: [], excludeCultures: [], desc: null, fxDesc: null, effects: [], beliefs: [] };
      ANCS[m[1]] = cur; ORDER.push(m[1]);
      continue;
    }
    if ((m = /^Trigger\s+(\S+)/.exec(nc))) {
      dead = false; cur = null; curCond = null;
      curTrig = { name: m[1], when: null, conds: [], acquires: [] };
      TRIGS[m[1]] = curTrig; TORDER.push(m[1]);
      continue;
    }
    if (dead) { deadLines.push(nc.trim()); continue; }
    if (curTrig) {
      if ((m = /^\s*WhenToTest\s+(.+)$/.exec(nc))) { curTrig.when = m[1].trim(); curCond = null; continue; }
      if ((m = /^\s*AcquireAncillary\s+(\S+)\s+chance\s+(\d+)/i.exec(nc))) { curTrig.acquires.push({ anc: m[1], chance: parseInt(m[2], 10) }); curCond = null; continue; }
      if ((m = /^\s*Condition\s+(.+)$/.exec(nc))) { curCond = [m[1].trim()]; curTrig.conds.push(curCond); continue; }
      if (curCond && nc.trim()) { curCond.push(nc.trim()); continue; }
      continue;
    }
    if (!cur) continue;
    if ((m = /^\s+Image\s+(\S+)/.exec(nc))) { cur.image = m[1]; continue; }
    if (/^\s+Unique\s*$/.test(nc)) { cur.unique = true; continue; }
    if ((m = /^\s+ExcludedAncillaries\s+(.+)$/.exec(nc))) { cur.excluded = m[1].split(",").map((s) => s.trim()).filter(Boolean); continue; }
    if ((m = /^\s+ExcludeCultures\s+(.+)$/.exec(nc))) { cur.excludeCultures = m[1].split(",").map((s) => s.trim()).filter(Boolean); continue; }
    if ((m = /^\s+Description\s+(\S+)/.exec(nc))) { cur.desc = m[1]; continue; }
    if ((m = /^\s+EffectsDescription\s+(\S+)/.exec(nc))) { cur.fxDesc = m[1]; continue; }
    // one line writes `Effect Influence  +1` — the sign class must allow the plus
    if ((m = /^\s+Effect\s+(\S+)\s+([+-]?\d+)/.exec(nc))) { cur.effects.push({ attr: m[1], amount: parseInt(m[2], 10) }); continue; }
    if ((m = /^\s+Religious_Belief\s+(\S+)\s+([+-]?\d+)/.exec(nc))) { cur.beliefs.push({ belief: m[1], amount: parseInt(m[2], 10) }); continue; }
  }
}
const ALL = ORDER.map((a) => ANCS[a]);
const TRIG_ALL = TORDER.map((t) => TRIGS[t]);
if (!ALL.length) { console.error("no ancillaries parsed"); process.exit(2); }

// ── parsed vs flat, ENFORCED ─────────────────────────────────────────────────
// The flat baseline is the text with the dead-zone lines masked out by an independent
// two-state scanner, so both sides agree on what the file MEANS while the raw-vs-masked
// delta (the swallowed lines) is still printed and must stay explainable.
const MASKED = (() => {
  let dead = false;
  return TXT.split(/\r?\n/).filter((raw) => {
    if (/^;+\s*(Trigger|Ancillary)\s/.test(raw)) { dead = true; return false; }
    if (/^(Trigger|Ancillary)\s/.test(raw)) { dead = false; return true; }
    return !dead;
  }).join("\n");
})();
const flatOf = (re) => (MASKED.match(re) || []).length;
const rawOf = (re) => (TXT.match(re) || []).length;
const FIELD_TABLE = [
  ["Ancillary", ALL.length, flatOf(/^Ancillary\s/gm)],
  ["Image", ALL.filter((a) => a.image).length, flatOf(/^\s+Image\s/gm)],
  ["Description", ALL.filter((a) => a.desc).length, flatOf(/^\s+Description\s/gm)],
  ["EffectsDescription", ALL.filter((a) => a.fxDesc).length, flatOf(/^\s+EffectsDescription\s/gm)],
  ["Effect", ALL.reduce((x, a) => x + a.effects.length, 0), flatOf(/^\s+Effect\s/gm)],
  ["Religious_Belief", ALL.reduce((x, a) => x + a.beliefs.length, 0), flatOf(/^\s+Religious_Belief\s/gm)],
  ["Unique", ALL.filter((a) => a.unique).length, flatOf(/^\s+Unique\s*$/gm)],
  ["ExcludedAncillaries", ALL.filter((a) => a.excluded.length).length, flatOf(/^\s+ExcludedAncillaries\s/gm)],
  ["ExcludeCultures", ALL.filter((a) => a.excludeCultures.length).length, flatOf(/^\s+ExcludeCultures\s/gm)],
  ["Trigger", TRIG_ALL.length, flatOf(/^Trigger\s/gm)],
  ["WhenToTest", TRIG_ALL.filter((t) => t.when).length, flatOf(/^\s*WhenToTest\s/gm)],
  ["Condition", TRIG_ALL.reduce((x, t) => x + t.conds.length, 0), flatOf(/^\s*Condition\s/gm)],
  ["AcquireAncillary", TRIG_ALL.reduce((x, t) => x + t.acquires.length, 0), flatOf(/^\s*AcquireAncillary\s/gm)],
];
let mismatches = 0;
console.log("export_descr_ancillaries.txt — parsed vs a flat pattern over the dead-zone-masked text:");
for (const [k, p, f] of FIELD_TABLE) {
  const ok = p === f;
  if (!ok) mismatches++;
  console.log(`  ${k.padEnd(20)} ${String(num(p)).padStart(7)} / ${String(num(f)).padStart(7)}${ok ? "" : "   <- MISMATCH"}`);
}
console.log(`  dead-zone lines swallowed (live text after a commented-out block header): ${deadLines.length}`);
for (const l of deadLines) console.log(`    | ${l}`);
{
  // The raw file must exceed the masked one by exactly the swallowed lines for the four
  // affected fields — anything else means the mask ate something it should not have.
  const delta = ["WhenToTest", "Condition", "AcquireAncillary"].map((k) => {
    const re = new RegExp(String.raw`^\s*${k}\s`, "gm");
    return rawOf(re) - flatOf(re);
  }).reduce((a, b) => a + b, 0) + (rawOf(/^\s+and\s/gm) - flatOf(/^\s+and\s/gm));
  if (delta !== deadLines.length) { console.error(`dead-zone accounting broken: masked ${delta} lines by pattern but swallowed ${deadLines.length}`); process.exit(1); }
}
if (mismatches) { console.error(`\n${mismatches} field(s) drift — nothing was written`); process.exit(1); }

// ── display text: text/export_ancillaries.txt, NOT export_vnvs.txt ───────────
const ANC_TEXT = {};
{
  let t = null;
  try { t = fs.readFileSync(path.join(RIS, "text", "export_ancillaries.txt"), "utf16le"); } catch { console.error("text/export_ancillaries.txt not found"); process.exit(2); }
  let cur = null;
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "").trim();
    if (/^[¬;]/.test(line)) continue;
    const m = /^\{([^}]+)\}\s*(.*)$/.exec(line);
    if (m) { cur = m[1]; ANC_TEXT[cur] = m[2].trim(); continue; }
    if (cur && line) ANC_TEXT[cur] = (ANC_TEXT[cur] ? ANC_TEXT[cur] + " " : "") + line;
  }
}
const nameVia = { text: 0, token: 0 };
for (const a of ALL) {
  const n = ANC_TEXT[a.name];
  if (n) { nameVia.text++; a.display = n; } else { nameVia.token++; a.display = a.name.replace(/_/g, " "); }
}
const descHits = ALL.filter((a) => a.desc && (ANC_TEXT[a.desc] || "").length).length;
const fxDescHits = ALL.filter((a) => a.fxDesc && (ANC_TEXT[a.fxDesc] || "").length).length;

// ── names for effect tokens, cultures, beliefs, traits ───────────────────────
function loadText(file) {
  const map = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", file), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) map[m[1].trim().toLowerCase()] = m[2].trim();
  } catch { /* tokens */ }
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
const TRAIT_INDEX = readIndex("traits");

const attrResolved = new Set(); const attrMechanical = new Set();
function attrName(attr) {
  const m = /^Combat_V_(.+)$/i.exec(attr);
  if (m) {
    const x = m[1].toLowerCase();
    const viaFaction = FACTION_NAMES[x] || BI_NAMES[x];
    const viaCulture = CULTURE_INDEX[x] && CULTURE_INDEX[x].name;
    if (viaFaction || viaCulture) { attrResolved.add(attr); return `Combat vs ${viaFaction || viaCulture}`; }
    attrMechanical.add(attr);
    return `Combat vs ${m[1].replace(/_/g, " ")}`;
  }
  attrMechanical.add(attr);
  return attr.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\bOf\b/g, "of");
}
const fx = (e) => `${e.amount > 0 ? "+" : ""}${e.amount} ${attrName(e.attr)}`;
const beliefFx = (b) => {
  const e = BELIEF_INDEX[String(b.belief).toLowerCase()];
  const name = e ? `[${e.name}](../religions/${e.page})` : String(b.belief).replace(/_/g, " ");
  return `${b.amount > 0 ? "+" : ""}${b.amount} ${name} belief`;
};
const ancFx = (a) => {
  const parts = [...a.effects.map(fx), ...a.beliefs.map(beliefFx)];
  return parts.length ? parts.join(", ") : "no stat effects — flavour only";
};
let cultureLinked = 0;
const cultureRef = (tok) => {
  const e = CULTURE_INDEX[String(tok).toLowerCase()];
  if (!e) return String(tok).replace(/_/g, " ");
  cultureLinked++;
  return `[${e.name}](../cultures/${e.page})`;
};
let traitLinked = 0, traitUnknown = 0;
const traitRef = (tok) => {
  const e = TRAIT_INDEX[tok];
  if (!e) { traitUnknown++; return String(tok).replace(/_/g, " "); }
  traitLinked++;
  return `[${e.name}](../traits/${e.page}#${e.anchor})`;
};

// ── the acquisition map ──────────────────────────────────────────────────────
const TRIGGERS_FOR = new Map();     // anc token -> [{trigger, chance}]
const TRAITS_FOR = new Map();       // anc token -> Set(trait tokens its conditions test)
for (const t of TRIG_ALL) {
  const condText = t.conds.map((c) => c.join(" ")).join(" ");
  const traitSet = new Set();
  for (const m of condText.matchAll(/(?:^|\s)(?:FatherTrait|Trait)\s+(\w+)/g)) traitSet.add(m[1]);
  for (const a of t.acquires) {
    if (!TRIGGERS_FOR.has(a.anc)) TRIGGERS_FOR.set(a.anc, []);
    TRIGGERS_FOR.get(a.anc).push({ trigger: t, chance: a.chance });
    if (!TRAITS_FOR.has(a.anc)) TRAITS_FOR.set(a.anc, new Set());
    for (const x of traitSet) TRAITS_FOR.get(a.anc).add(x);
  }
}

// ── the visibility decision, measured ────────────────────────────────────────
const CANDIDATES = [
  ["has a display name in export_ancillaries.txt", ALL.filter((a) => (ANC_TEXT[a.name] || "").length).length],
  ["has at least one effect", ALL.filter((a) => a.effects.length || a.beliefs.length).length],
  ["is reachable by an AcquireAncillary trigger", ALL.filter((a) => TRIGGERS_FOR.has(a.name)).length],
  ["carries a Hidden-style marker", 0],
];
const UNREACHABLE = ALL.filter((a) => !TRIGGERS_FOR.has(a.name));

// ── event phrases (same map as the trait pages, ancillary events added) ──────
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
  GovernorBuildingCompleted: "when a building completes in the governed city",
  GovernorUnitTrained: "when a unit is trained in the governed city",
  GovernorAgentCreated: "when an agent is trained in the governed city",
  GovernorThrowGames: "on holding games",
  GovernorThrowRaces: "on holding races",
  AgentCreated: "when the agent is trained",
  OfferedForAdoption: "when offered for adoption",
  OfferedForMarriage: "when offered for marriage",
  LeaderOrderedDiplomacy: "when ordered on a diplomatic mission",
  LeaderOrderedSpyingMission: "when ordered on a spying mission",
  LeaderOrderedAssassination: "when ordered to assassinate",
  SufferAssassinationAttempt: "on surviving an assassination attempt",
  ExecutesASpyOnAMission: "on executing a captured spy",
  AcquiresAncillary: "on acquiring another retinue member",
  TakeOffice: "on taking office",
  LeaveOffice: "on leaving office",
  BecomesFactionLeader: "on becoming faction leader",
  BecomesFactionHeir: "on becoming faction heir",
  Birth: "at birth",
};
const eventPhrase = (w) => EVENT_PHRASE[w] || (w ? w.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() : "not stated");

// ── portraits ────────────────────────────────────────────────────────────────
// Every distinct Image, converted once into wiki/ancillary-icons/ (owned here). The DDS
// twins beside some TGAs are ignored — the Image field names the TGA.
const dg = require(path.join(__dirname, "..", "src", "descrStratGeneral.js"));
const { convert } = require(path.join(__dirname, "lib", "tgaPng.js"));
const ICON_DIR = path.join(OUT, "ancillary-icons");
fs.mkdirSync(ICON_DIR, { recursive: true });
const iconOf = new Map();           // image token -> png filename or null
let iconsWritten = 0, iconsFromVanilla = 0, iconsMissing = [];
for (const image of uniq(ALL.map((a) => a.image).filter(Boolean))) {
  let src = path.join(RIS, "ui", "ancillaries", image);
  const base = image.replace(/\.tga$/i, "");
  if (!fs.existsSync(src)) {
    // One image (woodpecker.tga) ships only in the mod's cards directory; the rest of the
    // gaps are base-game stock art resolved from the install. Three exist nowhere at all —
    // in game those entries show placeholder art, and here they show none.
    const fallbacks = [
      path.join(RIS, "ui", "ancillaries_cards", image),
      path.join(VAN, "ui", "ancillaries", image),
      path.join(VAN, "ui", "ancillaries_cards", image),
    ];
    const hit = fallbacks.find((f) => fs.existsSync(f));
    if (hit) { src = hit; iconsFromVanilla += hit.startsWith(VAN) ? 1 : 0; }
  }
  if (!fs.existsSync(src)) { iconOf.set(image, null); iconsMissing.push(image); continue; }
  const r = convert(dg, src, 2);
  if (!r) { iconOf.set(image, null); iconsMissing.push(image); continue; }
  fs.writeFileSync(path.join(ICON_DIR, `${base}.png`), r.buf);
  iconOf.set(image, `${base}.png`);
  iconsWritten++;
}
const portrait = (a) => {
  const f = a.image && iconOf.get(a.image);
  return f ? `<img src="../ancillary-icons/${f}" alt="" width="44" style="float:right;margin:0 0 .3rem .6rem;border-radius:4px">` : "";
};

// ── the partition: priesthoods as a table, everything else a dictionary ──────
const isPriest = (a) => /^(High )?Priest(ess)? of /.test(a.display);
function pageOf(a) {
  if (isPriest(a)) return "priesthoods";
  const m = /[a-z]/i.exec(a.display);
  return m ? m[0].toLowerCase() : "other";
}
for (const a of ALL) a.page = pageOf(a);
const PAGES = new Map();
for (const a of ALL) {
  if (!PAGES.has(a.page)) PAGES.set(a.page, []);
  PAGES.get(a.page).push(a);
}
if (PAGES.has("other")) { console.error(`unplaceable ancillaries: ${PAGES.get("other").map((a) => a.name).join(", ")}`); process.exit(1); }

// heading disambiguation (three entries all read "Punic Necklace")
for (const [, list] of PAGES) {
  const seen = new Map();
  for (const a of list.slice().sort((x, y) => x.display.localeCompare(y.display) || x.name.localeCompare(y.name))) {
    const n = (seen.get(a.display) || 0) + 1;
    seen.set(a.display, n);
    a.heading = n === 1 ? a.display : `${a.display} (${a.name.replace(/_/g, " ")})`;
  }
}
const ANC_LINKS = new Map();
for (const [page, list] of PAGES) {
  for (const a of list) ANC_LINKS.set(a.name, { page: `${page}.md`, anchor: page === "priesthoods" ? "the-priesthoods" : slug(a.heading) });
}
let exclLinked = 0, exclUnknown = 0;
const ancRef = (token) => {
  const target = ANC_LINKS.get(token);
  const label = ANCS[token] ? ANCS[token].display : String(token).replace(/_/g, " ");
  if (!target) { exclUnknown++; return label; }
  exclLinked++;
  return `[${label}](${target.page}#${target.anchor})`;
};

// ── rendering ────────────────────────────────────────────────────────────────
function acquisitionFold(a) {
  const feeds = TRIGGERS_FOR.get(a.name) || [];
  if (!feeds.length) {
    return "_No trigger in the file grants this — it comes from the campaign script or an event, and is listed here because the game still shows it when it arrives._";
  }
  const events = uniq(feeds.map((f) => eventPhrase(f.trigger.when))).slice(0, 4);
  const rows = feeds.slice(0, 40).map((f) => {
    const cond = f.trigger.conds.map((c) => c.join(" ")).join(" · ");
    return `| ${eventPhrase(f.trigger.when)} | ${f.chance}% | ${cond ? `\`${cell(cond.slice(0, 220))}${cond.length > 220 ? "…" : ""}\`` : "always"} |`;
  });
  const table = [
    "| When | Chance | Conditions |",
    "|---|---:|---|",
    ...rows,
    feeds.length > 40 ? `| _…and ${feeds.length - 40} more_ | | |` : null,
  ].filter(Boolean).join("\n");
  return fold(`How it is gained — ${feeds.length} trigger${feeds.length === 1 ? "" : "s"}, ${events.join(", ")}`, [table]);
}

function ancEntry(a) {
  const bits = [];
  if (a.unique) bits.push("**unique** — one in the world at a time");
  // An entry excluding ITSELF is the file's idiom for "never twice on one character" and
  // reads as nonsense in print, so self-exclusions are dropped from the sentence.
  const partners = a.excluded.filter((x) => x !== a.name);
  if (partners.length) bits.push(`never alongside ${partners.map(ancRef).join(", ")}`);
  if (a.excludeCultures.length) bits.push(`never for ${a.excludeCultures.length} of the cultures`);
  const traits = [...(TRAITS_FOR.get(a.name) || [])].sort();
  const lines = [`### ${a.heading}`, ""];
  lines.push(`${portrait(a)}${bits.length ? bits.join(" · ") + "." : ""}`);
  lines.push("");
  lines.push(`**Effects:** ${ancFx(a)}`);
  lines.push("");
  const d = ANC_TEXT[a.desc];
  lines.push(d ? `> ${cell(d)}` : "> _description not determined — no text entry_");
  if (traits.length) {
    lines.push("");
    lines.push(`Acquisition is tied to ${traits.length === 1 ? "the trait" : "traits"}: ${traits.map(traitRef).join(", ")}.`);
  }
  if (a.excludeCultures.length) {
    lines.push("");
    lines.push(fold(`Cultures that never receive it (${a.excludeCultures.length})`, [a.excludeCultures.map(cultureRef).join(" · ")]));
  }
  lines.push("");
  lines.push(acquisitionFold(a));
  return lines.join("\n");
}

const HEAD = (title) => `# ${title}\n\n[← all retinue](../ancillaries.md) · [all traits](../traits.md) · [wiki index](../README.md)\n`;

fs.mkdirSync(path.join(OUT, "ancillaries"), { recursive: true });
const written = new Map();
const writePage = (file, body) => { fs.writeFileSync(path.join(OUT, "ancillaries", file), body, "utf8"); written.set(file, body); };

// the priesthood table page
{
  const list = PAGES.get("priesthoods").slice().sort((x, y) => x.heading.localeCompare(y.heading));
  const body = `${HEAD("Priesthoods")}
**${num(list.length)}** of the retinue are priests and priestesses — one per cult and city, from the
Priest of Amun to the Priestess of Vesta. Each joins a character through temple and
belief conditions and carries a small bonus; the in-game description is per-cult flavour
text, read in game rather than reprinted here.

## The priesthoods

**Triggers** is how many rules in the file can bring one; a — means only the campaign
script hands it out.

| Priesthood | Effects | Triggers |
|---|---|---:|
${list.map((a) => `| **${cell(a.heading)}**${a.unique ? " · unique" : ""} | ${cell(ancFx(a))} | ${(TRIGGERS_FOR.get(a.name) || []).length || "—"} |`).join("\n")}
`;
  writePage("priesthoods.md", body);
}

// the dictionary
const LETTERS = [...PAGES.keys()].filter((p) => /^[a-z]$/.test(p)).sort();
for (const L of LETTERS) {
  const list = PAGES.get(L).slice().sort((x, y) => x.heading.localeCompare(y.heading));
  const body = `${HEAD(`Retinue — ${L.toUpperCase()}`)}
**${num(list.length)}** retinue member${list.length === 1 ? "" : "s"} whose name begins with **${L.toUpperCase()}**.
${LETTERS.map((x) => (x === L ? `**${x.toUpperCase()}**` : `[${x.toUpperCase()}](${x}.md)`)).join(" · ")}

${list.map(ancEntry).join("\n\n---\n\n")}
`;
  writePage(`${L}.md`, body);
}

// ── the index page ───────────────────────────────────────────────────────────
const attrCounts = {};
for (const a of ALL) for (const e of a.effects) attrCounts[e.attr] = (attrCounts[e.attr] || 0) + 1;
const topAttrs = Object.entries(attrCounts).sort((x, y) => y[1] - x[1]).slice(0, 12);
const withTraits = ALL.filter((a) => (TRAITS_FOR.get(a.name) || new Set()).size).length;
const uniques = ALL.filter((a) => a.unique).length;

const indexBody = `# Retinue

[← wiki index](README.md) · [all traits](traits.md) · [all factions](factions.md)

A character in **RTR: Imperium Surrectum** gathers a retinue — **${num(ALL.length)}** followers, keepsakes,
offices and animals that attach themselves to generals, governors and agents and travel
with them. Where a trait is who a character has become, retinue is who and what he keeps
around him, and members can be traded between characters who meet.

<details>
<summary>What counts as retinue a player sees — the tests that were measured</summary>

Unlike the trait file there is **no Hidden flag here** — the ancillary vocabulary has no
concealment marker at all. The candidate tests:

| Candidate test | Entries it keeps |
|---|---:|
${CANDIDATES.map(([k, n]) => `| ${k} | ${num(n)} |`).join("\n")}

Every entry is localised, so the name test selects nothing; the trigger test would drop
**${UNREACHABLE.length}** real, displayed followers the campaign script hands out (Hanno the Great among
them). So all **${num(ALL.length)}** are published, and an entry no trigger grants says so on its page.

</details>

## How retinue works

- **A member arrives by trigger or by script.** ${num(TRIG_ALL.length)} triggers with ${num(TRIG_ALL.reduce((x, t) => x + t.acquires.length, 0))} grant rules bring
  ${num(ALL.length - UNREACHABLE.length)} of the ${num(ALL.length)}; the other ${UNREACHABLE.length} come from the campaign script and events.
- **${num(withTraits)}** members' acquisition is conditioned on the character's traits — the drunkard
  attracts drinking companions, the scholar attracts philosophers. Those pages link both ways.
- **${num(uniques)}** are unique: one in the world at a time.
- **${num(ALL.filter((a) => a.excluded.length).length)}** exclude other members — rival followers who will not share a tent.

## Where to look

| Page | Entries | What is on it |
|---|---:|---|
| [**Priesthoods**](ancillaries/priesthoods.md) | ${num(PAGES.get("priesthoods").length)} | one priest or priestess per cult and city |

### The dictionary — every other member, by first letter

| | | | | |
|---|---|---|---|---|
${(() => {
    const cells = LETTERS.map((L) => `[**${L.toUpperCase()}**](ancillaries/${L}.md) · ${PAGES.get(L).length}`);
    const rows = [];
    for (let i = 0; i < cells.length; i += 5) rows.push(`| ${cells.slice(i, i + 5).join(" | ")} |`);
    return rows.join("\n");
  })()}

## What retinue touches

| Stat | Effect lines |
|---|---:|
${topAttrs.map(([a, n]) => `| ${attrName(a)} | ${num(n)} |`).join("\n")}

<details>
<summary>Where these answers come from</summary>

export_descr_ancillaries.txt declares every member, its effects and the triggers that grant
it; display names and descriptions are text/export_ancillaries.txt (UTF-16LE) — the
ancillaries' own text file, not export_vnvs.txt — keyed \`{token}\`, \`{token_desc}\`,
\`{token_effects_desc}\`. Portraits are the mod's ui/ancillaries art, converted as-is. Effect
attribute names are the engine's UI strings and exist in no mod text file, so they are
rendered from the token. Where a description has no text entry the page says **not
determined** rather than inventing one.

</details>
`;
fs.writeFileSync(path.join(OUT, "ancillaries.md"), indexBody, "utf8");

// ── index.json for consumers (the trait pages read `traits` to link back) ────
const INDEX = {};
for (const a of ALL) {
  INDEX[a.name] = {
    page: `${a.page}.md`, anchor: ANC_LINKS.get(a.name).anchor, name: a.display,
    traits: [...(TRAITS_FOR.get(a.name) || [])].sort(),
  };
}
fs.writeFileSync(path.join(OUT, "ancillaries", "index.json"), JSON.stringify(INDEX, null, 1), "utf8");

// ── report ───────────────────────────────────────────────────────────────────
const say = (s) => console.log(s);
say(`\nancillary pages -> ${path.join(OUT, "ancillaries")} (+ ancillaries.md, ancillaries/index.json, ancillary-icons/)`);
say(`  visibility: all ${num(ALL.length)} published — the candidates, measured (no Hidden-style marker exists in this file):`);
for (const [k, n] of CANDIDATES) say(`    ${k.padEnd(46)} ${num(n)}`);
say(`    granted by no trigger (campaign script/events): ${UNREACHABLE.length} — e.g. ${UNREACHABLE.slice(0, 5).map((a) => a.name).join(", ")}`);
say(`  display text: text/export_ancillaries.txt (NOT export_vnvs.txt), ${num(Object.keys(ANC_TEXT).length)} keys`);
say(`    names ${nameVia.text}/${ALL.length} from the text file (${nameVia.token} from the token) · descriptions ${descHits}/${ALL.length} · effect texts ${fxDescHits}/${ALL.length}`);
say(`  partition: priesthoods ${PAGES.get("priesthoods").length} · dictionary ${LETTERS.reduce((x, L) => x + PAGES.get(L).length, 0)} across ${LETTERS.length} letter pages`);
{
  const placed = [...PAGES.values()].reduce((x, l) => x + l.length, 0);
  say(`  every entry on exactly one page: ${placed === ALL.length ? `yes, ${num(placed)}` : `NO — ${num(placed)} vs ${num(ALL.length)}`}`);
  if (placed !== ALL.length) process.exit(1);
}
say(`  portraits: ${iconsWritten} of ${uniq(ALL.map((a) => a.image).filter(Boolean)).length} distinct images converted to ancillary-icons/ (${iconsFromVanilla} are base-game stock art, taken from the install)${iconsMissing.length ? ` · MISSING: ${iconsMissing.join(", ")}` : ""}`);
say(`  effect attributes: ${Object.keys(attrCounts).length} distinct · ${attrResolved.size} Combat-vs resolved via faction/culture names · ${attrMechanical.size} rendered from the token`);
say(`  trait cross-links: ${withTraits} entries tied to traits · ${traitLinked} links via traits/index.json · ${traitUnknown} trait tokens not in that index (hidden traits, printed unlinked)`);
say(`  exclusion links: ${exclLinked} linked · ${exclUnknown} name entries with no page (unlinked)`);
say(`  cultures linked: ${cultureLinked} (${Object.keys(CULTURE_INDEX).length} in cultures/index.json)`);
say(`  pages written: ${written.size} under ancillaries/, plus ancillaries.md and ancillaries/index.json`);
say(`  NEXT: node scripts/gen-ris-trait-pages.js  (prints the retinue-attracts lines) && node scripts/check-ris-ancillary-pages.js && node scripts/verify-ris-wiki.js`);
