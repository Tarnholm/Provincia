// unitCompare.js — pure derivation logic for the Unit Comparator panel.
// ESM, no React, no IPC: takes already-fetched EDU stat objects and returns
// normalized comparison rows with best-in-row markers + derived
// cost-effectiveness ratios. Rendered by src/panels/UnitComparePanel.js.
//
// INPUT STAT SHAPE — the exact object returned by the existing
// `get-unit-stats` IPC handler in src/iconHandlers.js (renderer side:
// `window.electronAPI.getUnitStats(modDataDir, unitName)`), which parses the
// unit's export_descr_unit.txt block. Fields consumed here:
//
//   soldierCount   int    soldier line, 2nd field (men per unit)
//   hp             int    stat_health 1st field
//   mountHp        int    stat_health 2nd field (0 for infantry)
//   priAttack      int    stat_pri 1st field   (may be NaN — parseInt, no fallback)
//   priCharge      int    stat_pri 2nd field   (may be NaN)
//   priRange       int    stat_pri 4th field (0 for non-missile)
//   priAmmo        int    stat_pri 5th field (0 for non-missile)
//   secAttack      int    stat_sec 1st field (only set when stat_sec is a real weapon)
//   armour         int    stat_pri_armour 1st field (may be NaN)
//   defenseSkill   int    stat_pri_armour 2nd field (may be NaN)
//   shield         int    stat_pri_armour 3rd field (may be NaN)
//   morale         int    stat_mental 1st field (may be NaN)
//   recruitTurns   int    stat_cost 1st field (may be NaN)
//   recruitCost    int    stat_cost 2nd field (may be NaN)
//   upkeep         int    stat_cost 3rd field (may be NaN)
//
// (The handler parses no movement-speed field and no mount model — EDU speed
// lives in descr_mount/skeleton data the app doesn't read — so "speed" is not
// a row; mountHp stands in as the mounted-unit signal.)
//
// NULL POLICY: a stat that is missing (undefined), null, NaN or non-numeric is
// surfaced as null — NEVER coerced to 0. Any ratio with a null operand (or a
// zero divisor) is null. Best-in-row markers are only assigned when at least
// TWO units have a non-null value in that row (a lone value being "best" is
// noise). Rows where every unit is null are dropped entirely.

/** Finite number or null — never fabricates 0 for missing/NaN stats. */
export function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Null-safe division: null if either operand is null or divisor is 0. */
export function div(a, b) {
  return a == null || b == null || b === 0 ? null : a / b;
}

/**
 * Defense total = armour + defense skill + shield (stat_pri_armour).
 * EDU always writes all three fields together, so this is all-or-nothing:
 * if any component is missing the total is null (no partial sums).
 */
export function defenseTotal(stats) {
  if (!stats) return null;
  const a = num(stats.armour), d = num(stats.defenseSkill), s = num(stats.shield);
  return a == null || d == null || s == null ? null : a + d + s;
}

// Row specs. `better`: "high" | "low" — which direction wins the green marker.
// `get` reads the (possibly null) stats object and must return number|null.
const STAT_ROWS = [
  { key: "priAttack",    label: "Attack",           better: "high", get: (s) => num(s?.priAttack) },
  { key: "priCharge",    label: "Charge bonus",     better: "high", get: (s) => num(s?.priCharge) },
  { key: "priRange",     label: "Missile range",    better: "high", get: (s) => num(s?.priRange) },
  { key: "priAmmo",      label: "Ammo",             better: "high", get: (s) => num(s?.priAmmo) },
  { key: "secAttack",    label: "Sec. attack",      better: "high", get: (s) => num(s?.secAttack) },
  { key: "defenseTotal", label: "Defense (total)",  better: "high", get: (s) => defenseTotal(s) },
  { key: "armour",       label: "· Armour",         better: "high", get: (s) => num(s?.armour) },
  { key: "defenseSkill", label: "· Defense skill",  better: "high", get: (s) => num(s?.defenseSkill) },
  { key: "shield",       label: "· Shield",         better: "high", get: (s) => num(s?.shield) },
  { key: "hp",           label: "Hit points",       better: "high", get: (s) => num(s?.hp) },
  { key: "mountHp",      label: "Mount HP",         better: "high", get: (s) => { const v = num(s?.mountHp); return v === 0 ? null : v; } },
  { key: "morale",       label: "Morale",           better: "high", get: (s) => num(s?.morale) },
  { key: "soldierCount", label: "Soldiers",         better: "high", get: (s) => num(s?.soldierCount) },
  { key: "recruitCost",  label: "Recruit cost",     better: "low",  get: (s) => num(s?.recruitCost) },
  { key: "upkeep",       label: "Upkeep / turn",    better: "low",  get: (s) => num(s?.upkeep) },
  { key: "recruitTurns", label: "Recruit turns",    better: "low",  get: (s) => num(s?.recruitTurns) },
];

// Derived cost-effectiveness ratios — the balance-team numbers.
const RATIO_ROWS = [
  { key: "upkeepPerSoldier",   label: "Upkeep per soldier",        better: "low",
    get: (s) => div(num(s?.upkeep), num(s?.soldierCount)) },
  { key: "costPerSoldier",     label: "Cost per soldier",          better: "low",
    get: (s) => div(num(s?.recruitCost), num(s?.soldierCount)) },
  { key: "upkeepPerAttack",    label: "Upkeep per attack point",   better: "low",
    get: (s) => div(num(s?.upkeep), num(s?.priAttack)) },
  { key: "costPerEffectiveHp", label: "Cost per effective HP (hp × men)", better: "low",
    get: (s) => {
      const ehp = num(s?.hp) == null || num(s?.soldierCount) == null ? null : num(s.hp) * num(s.soldierCount);
      return div(num(s?.recruitCost), ehp);
    } },
  { key: "combatPer100Upkeep", label: "Attack+defense per 100 upkeep", better: "high",
    get: (s) => {
      const atk = num(s?.priAttack), def = defenseTotal(s);
      const combat = atk == null || def == null ? null : atk + def;
      const r = div(combat, num(s?.upkeep));
      return r == null ? null : r * 100;
    } },
];

/**
 * Best-in-row flags. Marks every index that ties for the best non-null value.
 * Requires >= 2 non-null values — with 0 or 1 comparable values every flag is
 * false (nothing to compare against).
 */
export function markBest(values, better) {
  const best = values.map(() => false);
  const idx = [];
  values.forEach((v, i) => { if (v != null) idx.push(i); });
  if (idx.length < 2) return best;
  let bestVal = null;
  for (const i of idx) {
    if (bestVal == null) bestVal = values[i];
    else bestVal = better === "low" ? Math.min(bestVal, values[i]) : Math.max(bestVal, values[i]);
  }
  for (const i of idx) if (values[i] === bestVal) best[i] = true;
  return best;
}

/**
 * deriveComparison(statsList)
 * @param statsList Array<{ unit: string, stats: object|null }> — one entry per
 *        comparison column, `stats` being the raw get-unit-stats result (null
 *        when the unit was not found in EDU / fetch failed).
 * @returns {{
 *   units: string[],
 *   rows:   Array<{key,label,better,values:(number|null)[],best:boolean[]}>,
 *   ratios: Array<{key,label,better,values:(number|null)[],best:boolean[]}>,
 * }}
 * Rows/ratios where every unit is null are omitted.
 */
export function deriveComparison(statsList) {
  const list = Array.isArray(statsList) ? statsList : [];
  const units = list.map((e) => (e && e.unit != null ? String(e.unit) : ""));
  const statsObjs = list.map((e) => (e && e.stats && typeof e.stats === "object" ? e.stats : null));
  const build = (specs) => {
    const out = [];
    for (const spec of specs) {
      const values = statsObjs.map((s) => spec.get(s));
      if (!values.some((v) => v != null)) continue; // all-null row: drop
      out.push({ key: spec.key, label: spec.label, better: spec.better, values, best: markBest(values, spec.better) });
    }
    return out;
  };
  return { units, rows: build(STAT_ROWS), ratios: build(RATIO_ROWS) };
}
