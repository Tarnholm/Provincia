// Faction Extinction Watch — pure helpers (no IPC, no Node, renderer-safe; ESM
// like src/traitExplorer.js).
//
// ENGINE RULE (user-confirmed 2026-07-18): RTW has no succession crisis. When a
// faction's LAST living male family member dies, the faction is DESTROYED and
// its settlements revert to the rebels — however much land it holds. So the
// number that matters is the count of living adult males in the family, not
// the heir's age or the ruler's traits.
//
// SECOND ROUTE (user rule 2026-09-21): a faction also dies when its LAST
// SETTLEMENT is taken — unless it is a hording faction that has not used up its
// horde attempts, in which case it takes to the field instead. So a faction is
// judged on two independent axes: its LINE (adult males) and its LAND (last
// settlement, with the horde exception read from descr_sm_factions). At campaign
// start no horde attempt has been used, so every horde-capable faction has the
// escape; how many attempts the engine allows is not derived here.
//
// Input is the per-faction family data the app already holds:
//   modFamiliesByFaction[faction] = { members: [{ firstName, lastName, gender,
//     age, alive, role, isCharacter, tags, x, y }], relatives: [...] }
// (src/modDataLoader.js — descr_strat `character` + `character_record` lines),
// so this is the CAMPAIGN-START picture. A live save's family roster is only a
// partial read (src/familyIntegrity.js refuses it below 80% reference
// resolution), and a head-count built on a partial roster would cry wolf for
// every faction — so the panel states its source and does not use it.
//
// What is and is not claimed:
//   • adult = age ≥ COMING_OF_AGE (16, the engine's coming-of-age). Boys are
//     listed separately and NEVER counted toward the line's safety: whether the
//     engine spares a faction whose only males are minors is not established.
//   • "elderly" (≥ ELDERLY_AGE) is a reading aid, not an engine threshold.
//   • agents and admirals are not family; only `named character` records and
//     the family's own character_record entries count.
export const COMING_OF_AGE = 16;
export const ELDERLY_AGE = 60;

export const TIERS = [
  { key: "extinct", label: "No living adult male", max: 0 },
  { key: "critical", label: "One death from destruction", max: 1 },
  { key: "fragile", label: "Fragile", max: 3 },
  { key: "secure", label: "Secure", max: Infinity },
];

export function fullName(m) {
  const clean = (v) => (v ? String(v).replace(/_/g, " ").trim() : "");
  return [clean(m && m.firstName), clean(m && m.lastName)].filter(Boolean).join(" ") || "—";
}

// Family = the dynasty. descr_strat marks field characters `named character`;
// everything else carrying a `character` line (admiral, spy, diplomat…) is an
// agent or a fleet commander and cannot inherit.
export function isFamily(m) {
  if (!m) return false;
  if (!m.isCharacter) return true; // a character_record-only entry is by definition family
  const role = String(m.role || "").toLowerCase().replace(/_/g, " ").trim();
  return role === "named character";
}

function tagOf(m) {
  const tags = (m && m.tags) || [];
  if (tags.includes("leader")) return "leader";
  if (tags.includes("heir")) return "heir";
  return null;
}

// One faction → its line. `members` may be missing (a faction with no family
// block at all — emergent stubs, the slave faction): that is reported as
// noFamily, never as "extinct".
export function assessFaction(faction, bucket) {
  const members = (bucket && Array.isArray(bucket.members)) ? bucket.members : [];
  const family = members.filter(isFamily);
  const males = family.filter((m) => m.gender === "male" && m.alive !== false);
  const toRow = (m) => ({
    name: fullName(m), age: typeof m.age === "number" ? m.age : null, tag: tagOf(m),
    onMap: !!m.isCharacter, x: m.isCharacter && typeof m.x === "number" ? m.x : null, y: m.isCharacter && typeof m.y === "number" ? m.y : null,
    elderly: typeof m.age === "number" && m.age >= ELDERLY_AGE,
  });
  // an age-less male on the map is a commanding adult (descr_strat always ages
  // its `character` lines; a record without an age is kept adult, not dropped)
  const isAdult = (m) => (typeof m.age === "number" ? m.age >= COMING_OF_AGE : true);
  const adults = males.filter(isAdult).map(toRow).sort((a, b) => (b.age ?? -1) - (a.age ?? -1));
  const boys = males.filter((m) => !isAdult(m)).map(toRow).sort((a, b) => (b.age ?? -1) - (a.age ?? -1));
  const n = adults.length;
  const tier = !family.length ? null : TIERS.find((t) => n <= t.max);

  // every adult male standing on ONE tile can be lost in one battle
  const placed = adults.filter((a) => a.x != null && a.y != null);
  const tiles = new Set(placed.map((a) => `${a.x},${a.y}`));
  const oneStack = n >= 2 && placed.length === n && tiles.size === 1;

  const flags = [];
  if (tier && tier.key !== "extinct") {
    const old = adults.filter((a) => a.elderly).length;
    if (old && old === n) flags.push(n === 1 ? `the only adult male is ${adults[0].age}` : `every adult male is ${ELDERLY_AGE}+`);
    else if (old && n - old <= 1) flags.push(`${old} of ${n} adult males are ${ELDERLY_AGE}+`);
    if (oneStack) flags.push("every adult male stands on the same tile");
    if (!boys.length && n <= 3) flags.push("no boys to come of age");
  }
  // years until the eldest boy comes of age — the soonest the line can grow
  // without an adoption or a marriage
  const nextOfAgeIn = boys.length && boys[0].age != null ? Math.max(0, COMING_OF_AGE - boys[0].age) : null;

  return {
    faction, noFamily: !family.length,
    tier: tier ? tier.key : "none", tierLabel: tier ? tier.label : "No family recorded",
    adultMales: n, adults, boys, nextOfAgeIn, oneStack, flags,
    leader: (adults.find((a) => a.tag === "leader") || {}).name || null,
    heir: (adults.find((a) => a.tag === "heir") || {}).name || null,
  };
}

const TIER_ORDER = { extinct: 0, critical: 1, fragile: 2, secure: 3, none: 4 };

// The LAND axis for one faction. settlements: how many it holds (null = unknown);
// horde: its descr_sm_factions horde block, or falsy.
//   lastTown   — exactly one settlement and no horde escape: one siege ends it
//   hordeSaves — exactly one settlement, but it can horde instead of dying
export function assessLand(settlements, horde) {
  const canHorde = !!horde;
  const one = settlements === 1;
  return {
    canHorde,
    lastTown: one && !canHorde,
    hordeSaves: one && canHorde,
    landNote: one ? (canHorde ? "last settlement — but it can horde instead of dying" : "last settlement — taking it destroys the faction") : null,
  };
}

// All factions, most endangered first: by line tier, then factions on their last
// settlement, then fewer adults, more flags, more settlements at stake.
// settlementCount: { faction: n }; hordeByFaction: { faction: hordeBlock }.
export function assessAll(familiesByFaction, settlementCount, hordeByFaction) {
  const counts = settlementCount || {};
  const hordes = hordeByFaction || {};
  const rows = Object.entries(familiesByFaction || {}).map(([fac, bucket]) => {
    const settlements = counts[fac] ?? null;
    return { ...assessFaction(fac, bucket), settlements, ...assessLand(settlements, hordes[fac] || hordes[String(fac).toLowerCase()]) };
  });
  rows.sort((a, b) => (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) || ((b.lastTown ? 1 : 0) - (a.lastTown ? 1 : 0)) || (a.adultMales - b.adultMales) || (b.flags.length - a.flags.length) || ((b.settlements || 0) - (a.settlements || 0)) || a.faction.localeCompare(b.faction));
  const summary = { extinct: 0, critical: 0, fragile: 0, secure: 0, none: 0, lastTown: 0, canHorde: 0 };
  for (const r of rows) { summary[r.tier]++; if (r.lastTown) summary.lastTown++; if (r.canHorde) summary.canHorde++; }
  return { rows, summary };
}

export default { assessFaction, assessLand, assessAll, isFamily, fullName, COMING_OF_AGE, ELDERLY_AGE, TIERS };
