// src/diagnostics.js — APP-WIDE SELF-CHECK / DIAGNOSTICS (shared, pure).
//
// WHY THIS EXISTS
// ---------------
// In the 2026-05/06 sessions, several bugs surfaced ONLY when the user tested
// in-game, even though each had a clear headless signal we could have caught:
//   - commander/army card portraits showing nomad/steppe faces (the hash pool
//     fired because savePath came back null);
//   - public order shown as 40% when the real settlement value was 295 (card
//     read the stale `happiness` offset instead of settlementFields.publicOrder);
//   - the player's diplomacy war list rendered empty when the game showed wars
//     (real wars against rebel/slave columns were filtered as placeholders);
//   - a settlement's garrison panel including commander-led FIELD stacks.
//
// This module turns each of those bug CLASSES into an automated check. It is
// PURE and READ-ONLY: it takes already-resolved app data and returns a
// structured report. It never re-derives data (callers pass the same resolvers'
// output the UI uses), never mutates input, and never throws on bad input — a
// failed check becomes an anomaly, not a crash.
//
// USED BY
//   - scripts/doctor.js  (headless; run BEFORE shipping a release)
//   - main.js            (live save-watch: one `[diag]` summary per load/turn)
//   - src/App.js         (non-live / starting-state load: one `[diag]` summary)
//
// CONFIRMED vs HYPOTHESIS: every band/threshold below is annotated. Where a
// value's "truth" is known from a cracked field we assert against it; where we
// only have a soft floor we emit a WARN, not an ERROR.
//
// CommonJS (main.js `require`s it at runtime; saveCracker is CommonJS too).
"use strict";

// ── severities ──────────────────────────────────────────────────────────────
const SEV = { ERROR: "error", WARN: "warn", INFO: "info" };

// Soft thresholds. Tuned from the corpus (julii/Carthage T1-3, RoR T5/8/34).
const PORTRAIT_HASH_WARN_FRAC = 0.15;   // >15% commanders on the hash pool → WARN
const PORTRAIT_HASH_ERROR_FRAC = 0.40;  // >40% → ERROR (the nomad-faces regression)
const PORTRAIT_MISMATCH_ERROR = 0.05;   // >5% card-vs-familytree portrait mismatch → ERROR
const ATTRIBUTION_WARN_FRAC = 0.90;     // land-unit attribution below 90% → WARN
const ATTRIBUTION_ERROR_FRAC = 0.50;    // below 50% → ERROR (something is broken)
const PUBLIC_ORDER_MAX = 500;           // engine order total runs ~0..400 typical (CONFIRMED, settlementFieldsParser);
                                        // turn-1 capitals carry the s7 start bonus and legitimately reach ~440
                                        // (Carthage 415, Syracuse 440 on julii1) — so the implausibility ceiling
                                        // is 500, not 400. The 40-vs-295 bug class is caught by the divergence
                                        // sub-check, not the band.
const PUBLIC_ORDER_MIN = -200;          // deeply unhappy settlements can run negative; below this is implausible
const DIPLO_SYMMETRY_WARN = 0.95;       // war-state matrix symmetry below this → WARN

function pct(n) {
  return `${Math.round(n * 1000) / 10}%`;
}

// A check helper: normalize a check result into the report shape.
function check(name, ok, detail, severity) {
  return { name, ok: !!ok, detail: String(detail), severity: severity || (ok ? SEV.INFO : SEV.WARN) };
}

// ── PORTRAITS ────────────────────────────────────────────────────────────────
// A portrait "resolves a real file" when its resolution carries a non-null
// savePath (the engine-exact .tga). When savePath is null the renderer's DJB2
// hash pool fires — that is exactly the nomad-faces bug. We also compare each
// commander's resolved portrait against the family-tree resolution for the same
// character (keyed by coord or name) and flag mismatches.
//
// Input shape (path-agnostic — both live and non-live map into it):
//   commanders: [{ name, faction, savePath, coordKey?, nameKey?, ambiguousKey? }]
//     savePath     = resolved engine-exact portrait path, or null/"" if hashed.
//     ambiguousKey = true when >1 char shares this coord. The family-tree map is
//        coord-keyed and collapses collisions to the LAST char (a known
//        limitation, documented in FamilyTree.js), so cross-checking a commander
//        at a shared tile against that map is meaningless and would create false
//        mismatches. Such commanders still count toward hash-pool coverage but
//        are EXCLUDED from the family-tree cross-check.
//   familyPortraitByKey: Map|object  key (coord "x,y" or "name:fn|ln|fac") → savePath
//
// `label` distinguishes the live vs non-live invocation in the detail string.
function checkPortraits(commanders, familyPortraitByKey, label) {
  const tag = label ? `[${label}] ` : "";
  if (!Array.isArray(commanders) || commanders.length === 0) {
    // Empty is a legitimate state (a save with no generals on-map, or before
    // the non-live armies are assembled). Log it as INFO, not an anomaly.
    return check(`portraits${label ? ":" + label : ""}`, true, `${tag}no commanders to check (0)`, SEV.INFO);
  }
  const fam = familyPortraitByKey
    ? (familyPortraitByKey instanceof Map ? familyPortraitByKey : new Map(Object.entries(familyPortraitByKey)))
    : new Map();
  let hashed = 0, resolved = 0, mismatch = 0, compared = 0;
  const mismatchSamples = [];
  for (const c of commanders) {
    const sp = c && c.savePath ? String(c.savePath) : null;
    if (sp) resolved++; else hashed++;
    // Family-tree cross-check: when both sides have a portrait for the same
    // character key, they MUST agree (the card and the family tree resolve the
    // identical char). A divergence is the off-by-one / wrong-coord class.
    const key = c && (c.coordKey || c.nameKey);
    if (key && !c.ambiguousKey && fam.has(key)) {
      const famPath = fam.get(key);
      const famSp = famPath && typeof famPath === "object" ? (famPath.cards || famPath.fulls) : famPath;
      if (sp && famSp) {
        compared++;
        // Compare on basename (cards vs portraits variant differ only by dir).
        const base = (p) => String(p).replace(/^.*[\\/]/, "").toLowerCase();
        if (base(sp) !== base(famSp)) {
          mismatch++;
          if (mismatchSamples.length < 5) mismatchSamples.push(`${c.name || key}: card=${base(sp)} tree=${base(famSp)}`);
        }
      }
    }
  }
  const total = commanders.length;
  const hashFrac = hashed / total;
  const mismatchFrac = compared ? mismatch / compared : 0;
  let sev = SEV.INFO, ok = true;
  const reasons = [];
  if (hashFrac > PORTRAIT_HASH_ERROR_FRAC) { sev = SEV.ERROR; ok = false; reasons.push(`${pct(hashFrac)} on hash pool (>${pct(PORTRAIT_HASH_ERROR_FRAC)})`); }
  else if (hashFrac > PORTRAIT_HASH_WARN_FRAC) { sev = SEV.WARN; ok = false; reasons.push(`${pct(hashFrac)} on hash pool (>${pct(PORTRAIT_HASH_WARN_FRAC)})`); }
  if (mismatchFrac > PORTRAIT_MISMATCH_ERROR) { sev = SEV.ERROR; ok = false; reasons.push(`${pct(mismatchFrac)} mismatch family tree (${mismatch}/${compared})`); }
  const detail = `${tag}${resolved}/${total} portraits resolved a real file, ${hashed} on hash pool` +
    (compared ? `, ${compared} cross-checked vs family tree (${mismatch} mismatch)` : ", family-tree cross-check N/A") +
    (reasons.length ? ` — ${reasons.join("; ")}` : "") +
    (mismatchSamples.length ? ` [${mismatchSamples.join(" | ")}]` : "");
  return check(`portraits${label ? ":" + label : ""}`, ok, detail, sev);
}

// ── NON-LIVE COMMANDER CARDS ──────────────────────────────────────────────────
// THE GAP THIS CLOSES: checkPortraits above cross-checks the commander card
// against the FAMILY-TREE resolution, but in the non-live path BOTH sides were
// historically fed from the SAME statsCache-only source, so it falsely PASSED
// ("867/869, 0 mismatch") while the actual commander cards — resolved by
// resolveNonLiveCommanderInfo — fell to the DJB2 hash pool for the starting
// royal family (Quintus/Marcus/Servius Ogulnius_Gallus → 110/020/058.tga). The
// family tree got the real face via the COORD bridge (v1PortraitsByCoord); the
// commander resolver never consulted it.
//
// This check exercises the REAL resolver path. Each commander entry carries:
//   savePath   = what resolveNonLiveCommanderInfo actually returned (null = hash)
//   resolvable = whether the engine-exact portrait map (the SAME source the
//      family tree uses) CAN place this commander to a real file.
// A commander that is `resolvable` but whose `savePath` is null is the bug: the
// portrait IS known via the family-tree source, yet the card hash-pooled it.
// That is an ERROR. (A commander that is genuinely NOT resolvable falling to the
// hash pool is acceptable — no fabricated face, per the no-fallbacks rule.)
//
// Input: commanders = [{ name, faction, savePath, resolvable }]
function checkNonLiveCommanders(commanders, label) {
  const tag = label ? `[${label}] ` : "";
  if (!Array.isArray(commanders) || commanders.length === 0) {
    return check("commanders:non-live", true, `${tag}no non-live commanders to check (0)`, SEV.INFO);
  }
  let resolved = 0, hashed = 0, resolvableButHashed = 0;
  const bugSamples = [];
  for (const c of commanders) {
    const sp = c && c.savePath ? String(c.savePath) : null;
    if (sp) resolved++; else hashed++;
    if (!sp && c && c.resolvable) {
      resolvableButHashed++;
      if (bugSamples.length < 8) bugSamples.push(c.name || "?");
    }
  }
  const ok = resolvableButHashed === 0;
  const sev = ok ? SEV.INFO : SEV.ERROR;
  const detail = `${tag}${resolved}/${commanders.length} commander cards resolved a real portrait, ${hashed} on hash pool` +
    (resolvableButHashed
      ? ` — ${resolvableButHashed} resolvable via family-tree source but FELL TO HASH POOL [${bugSamples.join(", ")}]`
      : " (no resolvable commander hash-pooled)");
  return check("commanders:non-live", ok, detail, sev);
}

// ── PUBLIC ORDER ──────────────────────────────────────────────────────────────
// settlementFields.<city>.publicOrder is the CONFIRMED in-game order value
// (offset-30 float, ~0..400). The card prefers it; the legacy `happiness` prop
// reads a stale offset and mis-maps (it showed 40 for Rome's 295). So:
//   1. each present publicOrder must be in a plausible band;
//   2. when a card-displayed `happiness` value is supplied AND diverges from
//      settlementFields.publicOrder, that is the 40-vs-295 bug → ERROR.
//
// Input:
//   settlementFields: { city: { publicOrder?:number, ... } }
//   cardHappinessByCity: { city: number }  (optional — the value the card WOULD
//      have shown via the legacy prop; only meaningful if present)
function checkPublicOrder(settlementFields, cardHappinessByCity) {
  const sf = settlementFields || {};
  const cities = Object.keys(sf);
  if (cities.length === 0) {
    return check("publicOrder", true, "no settlementFields to check (0)", SEV.INFO);
  }
  let present = 0, outOfBand = 0, diverge = 0;
  const bandSamples = [], divergeSamples = [];
  const ch = cardHappinessByCity || {};
  for (const city of cities) {
    const v = sf[city] && typeof sf[city].publicOrder === "number" ? sf[city].publicOrder : null;
    if (v == null) continue;
    present++;
    if (v < PUBLIC_ORDER_MIN || v > PUBLIC_ORDER_MAX) {
      outOfBand++;
      if (bandSamples.length < 5) bandSamples.push(`${city}=${Math.round(v)}`);
    }
    // Divergence check: the card uses publicOrder when present, so a different
    // `happiness` is only a bug if the card would have FALLEN BACK to it. We
    // flag a divergence when the legacy value differs from the confirmed value
    // by more than a rounding tolerance — that means the two sources disagree
    // and a code path using the wrong one would mislead the user.
    if (typeof ch[city] === "number") {
      const diff = Math.abs(ch[city] - v);
      if (diff > 5 && diff / Math.max(1, Math.abs(v)) > 0.1) {
        diverge++;
        if (divergeSamples.length < 5) divergeSamples.push(`${city}: card=${Math.round(ch[city])} confirmed=${Math.round(v)}`);
      }
    }
  }
  let sev = SEV.INFO, ok = true;
  const reasons = [];
  if (diverge > 0) { sev = SEV.ERROR; ok = false; reasons.push(`${diverge} settlements where card value diverges from confirmed publicOrder [${divergeSamples.join(" | ")}]`); }
  if (outOfBand > 0) {
    if (sev !== SEV.ERROR) sev = SEV.WARN;
    ok = false;
    reasons.push(`${outOfBand} out of band ${PUBLIC_ORDER_MIN}..${PUBLIC_ORDER_MAX} [${bandSamples.join(" | ")}]`);
  }
  const detail = `${present}/${cities.length} settlements have publicOrder` +
    (reasons.length ? ` — ${reasons.join("; ")}` : ", all in band, no card divergence");
  return check("publicOrder", ok, detail, sev);
}

// ── DIPLOMACY ─────────────────────────────────────────────────────────────────
// The matrix must be located (or cleanly null), war-state symmetry ~1.0, the
// player's war list non-empty when wars exist, and war relations symmetric (if
// A is at war with B, B is at war with A). Catches the empty-war-list bug.
//
// Input:
//   diplomacy: parseDiplomacyMatrix output { faction:{ war:[],allied:[],... }, _meta:{ symmetry, warPairs, N } } | null
//   playerFaction: string|null
//   expectWars: bool|null  — if the caller KNOWS the player should have wars
//      (e.g. event log / RIS start), an empty list is an ERROR. Null = unknown.
function checkDiplomacy(diplomacy, playerFaction, expectWars) {
  if (diplomacy == null) {
    // Cleanly null is acceptable (e.g. a save layout where the matrix wasn't
    // located) — INFO, not an anomaly, per "log the empty/fallback case too".
    return check("diplomacy", true, "matrix not located (null) — diplomacy unavailable for this save", SEV.INFO);
  }
  const meta = diplomacy._meta || {};
  const rows = Object.keys(diplomacy).filter((k) => k !== "_meta");
  let sev = SEV.INFO, ok = true;
  const reasons = [];

  // Symmetry of the located matrix (war state should be mutual).
  const sym = typeof meta.symmetry === "number" ? meta.symmetry : null;
  if (sym != null && sym < DIPLO_SYMMETRY_WARN) {
    sev = SEV.WARN; ok = false;
    reasons.push(`matrix symmetry ${sym.toFixed(3)} < ${DIPLO_SYMMETRY_WARN} (misaligned?)`);
  }

  // War-relation symmetry: A∈war(B) ⇒ B∈war(A). Asymmetry means a row is
  // mis-decoded or a war was filtered on one side only.
  let asymWars = 0;
  const asymSamples = [];
  for (const a of rows) {
    const wl = (diplomacy[a] && diplomacy[a].war) || [];
    for (const bRaw of wl) {
      const b = String(bRaw).toLowerCase();
      const back = diplomacy[b] && diplomacy[b].war;
      // Only assert symmetry when B has a decodable row (placeholder columns
      // like slave/*_rebels legitimately have no row — those are one-sided by
      // design and must NOT be counted as anomalies).
      if (back && !back.map((x) => String(x).toLowerCase()).includes(a)) {
        asymWars++;
        if (asymSamples.length < 5) asymSamples.push(`${a}→${b} not mutual`);
      }
    }
  }
  if (asymWars > 0) {
    if (sev !== SEV.ERROR) sev = SEV.WARN;
    ok = false;
    reasons.push(`${asymWars} one-sided war relations [${asymSamples.join(" | ")}]`);
  }

  // Player's war list — empty when wars are expected is the regression.
  let playerWarN = null;
  if (playerFaction) {
    const pf = String(playerFaction).toLowerCase();
    playerWarN = (diplomacy[pf] && diplomacy[pf].war) ? diplomacy[pf].war.length : 0;
    if (expectWars === true && playerWarN === 0) {
      sev = SEV.ERROR; ok = false;
      reasons.push(`player ${pf} war list EMPTY but wars were expected`);
    }
  }

  const totalWarPairs = typeof meta.warPairs === "number" ? meta.warPairs : null;
  const detail = `matrix located (N=${meta.N != null ? meta.N : "?"}), symmetry=${sym != null ? sym.toFixed(3) : "?"}, ` +
    `warPairs=${totalWarPairs != null ? totalWarPairs : "?"}, player(${playerFaction || "?"}) wars=${playerWarN != null ? playerWarN : "?"}` +
    (reasons.length ? ` — ${reasons.join("; ")}` : "");
  return check("diplomacy", ok, detail, sev);
}

// ── GARRISON vs FIELD ─────────────────────────────────────────────────────────
// A settlement's garrison must EXCLUDE commander-led field stacks. We re-run the
// authoritative isGarrisonUnit rule (the SAME rule App.js's filter uses) over a
// representative settlement's region units and assert the field stacks land in
// the field set, not the garrison. Catches the garrison-dup bug.
//
// Input:
//   settlements: [{ city, units:[{commanderUuid?,inferredCmd?}], governorUuid?, cmdsAtSettlement?:Set|array, fieldCommanders?:Set|array }]
//     fieldCommanders = commander UUIDs KNOWN to be field armies (not on the
//        settlement tile). When supplied, any such commander whose unit lands in
//        the garrison set is the bug.
//   isGarrisonFn: the isGarrisonUnit function (injected so this module stays
//        framework-free / CJS; doctor + main pass require("./garrisonClassify")).
function checkGarrison(settlements, isGarrisonFn) {
  if (typeof isGarrisonFn !== "function") {
    return check("garrison", true, "isGarrisonUnit not provided — garrison check skipped", SEV.INFO);
  }
  if (!Array.isArray(settlements) || settlements.length === 0) {
    return check("garrison", true, "no settlements with units to check (0)", SEV.INFO);
  }
  let checked = 0, leaks = 0;
  const leakSamples = [];
  for (const s of settlements) {
    const units = s && Array.isArray(s.units) ? s.units : null;
    if (!units || units.length === 0) continue;
    checked++;
    const cmdsAt = s.cmdsAtSettlement instanceof Set ? s.cmdsAtSettlement : new Set(s.cmdsAtSettlement || []);
    const fieldCmds = s.fieldCommanders instanceof Set ? s.fieldCommanders : new Set(s.fieldCommanders || []);
    const ctx = { governorUuid: s.governorUuid || null, cmdsAtSettlement: cmdsAt };
    for (const u of units) {
      const cmd = u.commanderUuid || u.inferredCmd || null;
      if (!cmd) continue;
      // A field commander (not on the tile) whose unit is classified as garrison
      // is the leak. isGarrisonUnit already encodes the rule; this asserts the
      // classification matches the field/garrison ground truth the caller knows.
      if (fieldCmds.has(cmd) && !cmdsAt.has(cmd)) {
        if (isGarrisonFn(u, ctx)) {
          leaks++;
          if (leakSamples.length < 5) leakSamples.push(`${s.city || "?"}: field cmd ${typeof cmd === "number" ? cmd.toString(16) : cmd} in garrison`);
        }
      }
    }
  }
  const ok = leaks === 0;
  const detail = `${checked} settlements checked, ${leaks} field-stack leaks into garrison` +
    (leaks ? ` [${leakSamples.join(" | ")}]` : "");
  return check("garrison", ok, detail, leaks ? SEV.ERROR : SEV.INFO);
}

// ── FAMILY ────────────────────────────────────────────────────────────────────
// Member count realistic for the turn (not under-read), the REAL faction leader
// present with a plausible adult age (not a child's), and no members attributed
// to a placeholder/`_rebel` faction.
//
// IDENTIFYING THE LEADER (matters — the prior version picked an arbitrary member)
// -----------------------------------------------------------------------------
// The leader is identified the SAME way the Family Tree the user sees does it:
// the member crowned in FamilyTree.js is the one whose `tags` includes "leader"
// (see FamilyTree.js `char.tags.includes("leader")`). So this check resolves the
// leader, in priority order:
//   1. the `"leader"`-tagged member of the family roster (player faction when
//      known) — the family-tree method, equivalent to `isLeader === true`;
//   2. the caller-supplied `leader` object (a separately-resolved leader, e.g.
//      the descr_strat `"leader"`-tagged character matched into a live roster
//      that itself carries no tags). The save's family roster (crackSave) has no
//      leader tag, so LIVE callers pass the descr_strat leader here — the same
//      character the live family tree crowns.
// If NEITHER yields a leader we INFO-skip (log it) rather than pass on an
// arbitrary member; if the caller KNOWS a leader is expected (`opts.expectLeader`)
// an unresolved/absent leader is an ERROR (the missing-leader regression).
//
// Why this catches the age-4 regression: a child "Quintus" that overwrote the
// real 60-year-old leader makes the `"leader"`-tagged member (or the resolved
// leader) read age 4 — `age < ADULT_MIN` → ERROR.
//
// Input:
//   family: [{ name?, firstName?, lastName?, age?, gender?, faction?, alive?,
//              isLeader?, tags?:string[] }]  (crackSave .characters.family, or a
//              descr_strat-derived roster that carries leader tags)
//   playerFaction: string|null
//   leader: { name?, age?, alive? } | null   (caller-resolved leader, if any)
//   minMembers: number|null                  (a soft floor; null = tiny default)
//   opts: { expectLeader?:bool } | undefined  (expectLeader=true ⇒ absent leader
//                                               is an ERROR, not an INFO-skip)
const LEADER_ADULT_MIN = 16;   // RTW men come of age at 16; a leader younger is a regression.
const LEADER_AGE_MAX = 120;    // an age above this is a corrupt/overflowed read.
const LEADER_AGE_OLD = 90;     // plausible-but-suspect ceiling → WARN, not ERROR.

function memberDisplayName(m) {
  if (!m) return "?";
  if (m.name) return String(m.name);
  const fn = m.firstName || "?";
  const ln = m.lastName ? " " + String(m.lastName).replace(/_/g, " ") : "";
  return `${fn}${ln}`;
}

// The family-tree leader signal: a member whose tags include "leader" (or the
// equivalent `isLeader` flag). Restricted to the player faction when known so a
// foreign faction's leader in a shared roster isn't mistaken for ours.
function findTaggedLeader(family, playerFaction) {
  const pf = playerFaction ? String(playerFaction).toLowerCase() : null;
  const isLeaderMember = (m) =>
    !!m && (m.isLeader === true || (Array.isArray(m.tags) && m.tags.includes("leader")));
  const inFaction = (m) => !pf || (m && m.faction && String(m.faction).toLowerCase() === pf);
  // Prefer a player-faction tagged leader; fall back to any tagged leader only
  // when the faction isn't known (so we never crown another faction's leader).
  return family.find((m) => isLeaderMember(m) && inFaction(m))
    || (pf ? null : family.find(isLeaderMember))
    || null;
}

function checkFamily(family, playerFaction, leader, minMembers, opts) {
  if (!Array.isArray(family)) {
    return check("family", true, "no family roster provided", SEV.INFO);
  }
  const expectLeader = !!(opts && opts.expectLeader);
  let sev = SEV.INFO, ok = true;
  const reasons = [];
  const total = family.length;

  // Under-read: a populated campaign should have several family members. A
  // realistic floor is small (a fresh faction has ~3-5 named relatives). Below
  // it suggests the family table wasn't read.
  const floor = typeof minMembers === "number" ? minMembers : 1;
  if (total < floor) {
    sev = SEV.WARN; ok = false;
    reasons.push(`only ${total} family members (< floor ${floor}) — under-read?`);
  }

  // Placeholder/_rebel attribution: family members must never be tagged to a
  // `_rebel` (singular UI-banner) faction. The save-cracker explicitly drops
  // those markers; any surviving attribution is a regression.
  const rebelTagged = family.filter((r) => r && r.faction && /_rebel$/.test(String(r.faction))).length;
  if (rebelTagged > 0) {
    sev = SEV.ERROR; ok = false;
    reasons.push(`${rebelTagged} members attributed to a _rebel placeholder faction`);
  }

  // ── Identify the REAL faction leader ──
  // 1. the "leader"-tagged roster member (the family-tree method); else
  // 2. the caller-supplied leader object.
  const taggedLeader = findTaggedLeader(family, playerFaction);
  let resolvedLeader = null;
  let leaderSource = null;
  if (taggedLeader) {
    resolvedLeader = {
      name: memberDisplayName(taggedLeader),
      age: typeof taggedLeader.age === "number" ? taggedLeader.age : null,
      alive: taggedLeader.alive,
    };
    leaderSource = "tag";
  } else if (leader && (leader.name || typeof leader.age === "number")) {
    resolvedLeader = { name: leader.name || "?", age: typeof leader.age === "number" ? leader.age : null, alive: leader.alive };
    leaderSource = "caller";
  }

  if (resolvedLeader) {
    // Present but DEAD where a (living) leader is expected is the same class as
    // a wrong/overwritten leader — the faction has no valid head.
    if (resolvedLeader.alive === false) {
      sev = SEV.ERROR; ok = false;
      reasons.push(`faction leader ${resolvedLeader.name} is dead`);
    }
    if (typeof resolvedLeader.age === "number") {
      if (resolvedLeader.age < LEADER_ADULT_MIN) {
        sev = SEV.ERROR; ok = false;
        reasons.push(`faction leader ${resolvedLeader.name} age ${resolvedLeader.age} is a child (<${LEADER_ADULT_MIN})`);
      } else if (resolvedLeader.age > LEADER_AGE_MAX) {
        sev = SEV.ERROR; ok = false;
        reasons.push(`faction leader ${resolvedLeader.name} age ${resolvedLeader.age} is impossible (>${LEADER_AGE_MAX})`);
      } else if (resolvedLeader.age > LEADER_AGE_OLD) {
        if (sev !== SEV.ERROR) sev = SEV.WARN;
        ok = false;
        reasons.push(`faction leader ${resolvedLeader.name} age ${resolvedLeader.age} implausibly old (>${LEADER_AGE_OLD})`);
      }
    } else if (expectLeader) {
      // We have a leader but no age to validate — can't confirm the adult-age
      // assertion. WARN (it's the value we'd want for the regression check).
      if (sev !== SEV.ERROR) sev = SEV.WARN;
      ok = false;
      reasons.push(`faction leader ${resolvedLeader.name} has no age to validate`);
    }
  } else if (expectLeader) {
    // A leader was expected (the caller knows the faction should have one) but
    // none could be identified — the missing-leader regression.
    sev = SEV.ERROR; ok = false;
    reasons.push(`no faction leader identified for ${playerFaction || "player"} but one was expected`);
  } else if (playerFaction) {
    // Leader not resolvable and not asserted as expected — INFO only (log the
    // skip, per the standing rule; we never fabricate/crown an arbitrary member).
    reasons.push("no faction leader identified (leader check skipped)");
  }

  const attributed = family.filter((r) => r && r.faction).length;
  const leaderStr = resolvedLeader
    ? `, leader ${resolvedLeader.name}${typeof resolvedLeader.age === "number" ? ` age ${resolvedLeader.age}` : ""} (via ${leaderSource})`
    : "";
  const detail = `${total} family members, ${attributed} attributed` + leaderStr +
    (reasons.length ? ` — ${reasons.join("; ")}` : "");
  return check("family", ok, detail, sev);
}

// ── TURN / YEAR / SEASON ──────────────────────────────────────────────────────
// turn ≥ 1, year == −270 + floor((turn−1)/4) for RIS (4 turns/year, 270 BC
// start). seasonIndex 0..3. Inconsistency means the turn/year crack drifted.
//
// Input: { turn, currentYear, seasonIndex }
function checkTurnYear(turn, currentYear, seasonIndex) {
  if (turn == null) {
    return check("turnYear", true, "turn unknown (null) — turn/year crack absent for this save", SEV.INFO);
  }
  let sev = SEV.INFO, ok = true;
  const reasons = [];
  if (!(turn >= 1)) { sev = SEV.ERROR; ok = false; reasons.push(`turn ${turn} < 1`); }
  if (currentYear != null) {
    const expectedYear = -270 + Math.floor((turn - 1) / 4);
    if (currentYear !== expectedYear) {
      sev = SEV.ERROR; ok = false;
      reasons.push(`year ${currentYear} != expected ${expectedYear} for turn ${turn}`);
    }
  }
  if (seasonIndex != null && (seasonIndex < 0 || seasonIndex > 3)) {
    if (sev !== SEV.ERROR) sev = SEV.WARN;
    ok = false;
    reasons.push(`seasonIndex ${seasonIndex} out of 0..3`);
  }
  const detail = `turn=${turn}, year=${currentYear != null ? currentYear : "?"}, season=${seasonIndex != null ? seasonIndex : "?"}` +
    (reasons.length ? ` — ${reasons.join("; ")}` : " (consistent)");
  return check("turnYear", ok, detail, sev);
}

// ── UNIT ATTRIBUTION ──────────────────────────────────────────────────────────
// Fraction of LAND units attributed to a faction (naval excluded — they have no
// land owner). A low rate means the region→owner attribution broke.
//
// Input: unitAttribution = { total, naval, land, landAttributed, landAttributedFrac }
//   (crackSave._stats.unitAttribution).
function checkUnitAttribution(unitAttribution) {
  const ua = unitAttribution;
  if (!ua || typeof ua.land !== "number") {
    return check("unitAttribution", true, "no unit-attribution summary provided", SEV.INFO);
  }
  if (ua.land === 0) {
    return check("unitAttribution", true, `no land units (naval=${ua.naval || 0})`, SEV.INFO);
  }
  const frac = typeof ua.landAttributedFrac === "number" ? ua.landAttributedFrac : ua.landAttributed / ua.land;
  let sev = SEV.INFO, ok = true;
  let reason = "";
  if (frac < ATTRIBUTION_ERROR_FRAC) { sev = SEV.ERROR; ok = false; reason = ` — below error floor ${pct(ATTRIBUTION_ERROR_FRAC)}`; }
  else if (frac < ATTRIBUTION_WARN_FRAC) { sev = SEV.WARN; ok = false; reason = ` — below soft floor ${pct(ATTRIBUTION_WARN_FRAC)}`; }
  const detail = `${ua.landAttributed}/${ua.land} land units attributed (${pct(frac)}), naval=${ua.naval || 0} excluded${reason}`;
  return check("unitAttribution", ok, detail, sev);
}

// ── ORCHESTRATOR ──────────────────────────────────────────────────────────────
// Runs all checks over a normalized `data` object and returns the report. Every
// field is optional — a check whose inputs are absent emits an INFO "skipped"
// result rather than failing. This lets BOTH the live and non-live callers pass
// whatever subset they have without special-casing.
//
// data = {
//   label,                      // "live" | "non-live" | save filename — for log tagging
//   commandersLive, commandersNonLive,   // [{name,faction,savePath,coordKey?,nameKey?}]
//   commanders, portraitLabel,  // generic single-path portrait input (doctor uses this)
//   familyPortraitByKey,        // Map/object coordKey|nameKey → savePath (family-tree resolution)
//   settlementFields,           // { city: { publicOrder } }
//   cardHappinessByCity,        // { city: number } (optional legacy-prop values)
//   diplomacy, playerFaction, expectWars,
//   garrisonSettlements, isGarrisonUnit,
//   family, factionLeader, minFamilyMembers, expectLeader,
//   turn, currentYear, seasonIndex,
//   unitAttribution,
// }
function runDiagnostics(data) {
  const d = data || {};
  const checks = [];

  // Portraits — run for BOTH paths if present.
  if (d.commandersLive !== undefined) checks.push(checkPortraits(d.commandersLive, d.familyPortraitByKey, "live"));
  if (d.commandersNonLive !== undefined) checks.push(checkPortraits(d.commandersNonLive, d.familyPortraitByKey, "non-live"));
  // Generic single-path portrait input (doctor uses this).
  if (d.commanders !== undefined) checks.push(checkPortraits(d.commanders, d.familyPortraitByKey, d.portraitLabel || null));
  // Non-live commander-CARD check: runs the REAL resolveNonLiveCommanderInfo
  // output (savePath + resolvable flag) and flags a resolvable card that fell to
  // the hash pool. This is the check that catches the royal-family bug the
  // family-tree cross-check missed. Accepts either the non-live array directly
  // (commandersNonLive, carrying `resolvable`) or a generic `commandersResolved`.
  if (d.commandersNonLive !== undefined && d.commandersNonLive.some && d.commandersNonLive.some((c) => c && "resolvable" in c)) {
    checks.push(checkNonLiveCommanders(d.commandersNonLive, "non-live"));
  } else if (d.commandersResolved !== undefined) {
    checks.push(checkNonLiveCommanders(d.commandersResolved, d.portraitLabel || "non-live"));
  }

  checks.push(checkPublicOrder(d.settlementFields, d.cardHappinessByCity));
  checks.push(checkDiplomacy(d.diplomacy, d.playerFaction, d.expectWars));
  checks.push(checkGarrison(d.garrisonSettlements, d.isGarrisonUnit));
  checks.push(checkFamily(d.family, d.playerFaction, d.factionLeader, d.minFamilyMembers, { expectLeader: d.expectLeader === true }));
  checks.push(checkTurnYear(d.turn, d.currentYear, d.seasonIndex));
  checks.push(checkUnitAttribution(d.unitAttribution));

  const anomalies = checks.filter((c) => !c.ok);
  const errorCount = anomalies.filter((c) => c.severity === SEV.ERROR).length;
  const warnCount = anomalies.filter((c) => c.severity === SEV.WARN).length;
  return {
    label: d.label || null,
    checks,
    anomalies,
    summary: { total: checks.length, errors: errorCount, warns: warnCount, ok: errorCount === 0 },
  };
}

// One-line-per-check log summary for provincia.log. `logFn` defaults to console.log.
// Tag `[diag]` so it's greppable alongside [live-init]/[diplo]/[save-watch].
function logDiagnostics(report, logFn) {
  const log = logFn || ((...a) => { try { console.log(...a); } catch (e) { void e; } });
  if (!report || !Array.isArray(report.checks)) return;
  const label = report.label ? ` (${report.label})` : "";
  const s = report.summary || {};
  log(`[diag]${label} ${s.errors || 0} error(s), ${s.warns || 0} warn(s) across ${report.checks.length} checks`);
  for (const c of report.checks) {
    const mark = c.ok ? "PASS" : (c.severity === SEV.ERROR ? "ERROR" : "WARN");
    log(`[diag]${label}   ${mark} ${c.name}: ${c.detail}`);
  }
}

module.exports = {
  SEV,
  runDiagnostics,
  logDiagnostics,
  // individual checks (unit-testable + reusable):
  checkPortraits,
  checkNonLiveCommanders,
  checkPublicOrder,
  checkDiplomacy,
  checkGarrison,
  checkFamily,
  checkTurnYear,
  checkUnitAttribution,
};
