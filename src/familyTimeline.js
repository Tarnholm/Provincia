// src/familyTimeline.js
//
// Helpers for the FamilyTree's campaign-history scrubber. Given a flat
// list of characters (each may carry birthYear / birthTurn / age, and
// deathYear / deathTurn / isDead), derive a normalized lifespan in TURN
// units and produce the visibility verdict for a given scrub turn.
//
// RTW Imperial campaign is 4 turns / year by default; the constant is
// overridable if a mod ever changes that.

export const DEFAULT_TURNS_PER_YEAR = 4;

// Convert a raw character record to `{ birthTurn, deathTurn, hasBirth }`.
// Priority:
//   1. explicit birthTurn / deathTurn (already in turn units)
//   2. birthYear / deathYear -> turns via (year - epochYear) * turnsPerYear
//   3. age + currentTurn -> birthTurn = currentTurn - age * turnsPerYear,
//      no deathTurn (treat alive)
//
// `epochYear` is the in-game year that corresponds to turn 0. If we
// don't know it, we instead pass the current-turn/year pair (currentTurn,
// currentYear) and derive: epochYear = currentYear - currentTurn / turnsPerYear.
//
// Characters with no birth data return hasBirth=false — caller decides
// whether to always-show or always-hide them.
export function lifespanFor(char, opts) {
  const { currentTurn = 0, currentYear = null, turnsPerYear = DEFAULT_TURNS_PER_YEAR } = opts || {};
  const epochYear = (currentYear != null)
    ? (currentYear - Math.floor(currentTurn / turnsPerYear))
    : null;

  let birthTurn = null;
  let deathTurn = null;

  if (typeof char.birthTurn === "number") birthTurn = char.birthTurn;
  else if (typeof char.birthYear === "number" && epochYear != null) {
    birthTurn = Math.max(0, Math.round((char.birthYear - epochYear) * turnsPerYear));
  } else if (typeof char.age === "number" && char.age >= 0) {
    birthTurn = Math.max(0, currentTurn - Math.round(char.age * turnsPerYear));
  }

  if (typeof char.deathTurn === "number") deathTurn = char.deathTurn;
  else if (typeof char.deathYear === "number" && epochYear != null) {
    deathTurn = Math.max(0, Math.round((char.deathYear - epochYear) * turnsPerYear));
  } else if ((char.isDead || char.alive === false) && deathTurn == null) {
    // We know they're dead but not when; treat death as "current turn"
    // so they remain visible across all historical turns and hide only
    // at the very tip of the timeline. Caller can override.
    deathTurn = currentTurn;
  }

  return {
    birthTurn,
    deathTurn,
    hasBirth: birthTurn != null,
    hasDeath: deathTurn != null,
  };
}

// Decide visibility for a character at the given scrubTurn.
//   alive: birthTurn <= scrubTurn && (!deathTurn || deathTurn > scrubTurn)
//   bornThisTurn: birthTurn === scrubTurn
//   diedThisTurn: deathTurn === scrubTurn
//
// Characters without a known birthTurn fall back to "always visible"
// (so the tree still renders descr_strat-only chars sanely when no
// save is loaded).
export function visibilityAt(char, scrubTurn, opts) {
  const life = lifespanFor(char, opts);
  if (!life.hasBirth) {
    return { visible: true, bornThisTurn: false, diedThisTurn: false, life };
  }
  const aliveByBirth = life.birthTurn <= scrubTurn;
  const aliveByDeath = !life.hasDeath || life.deathTurn > scrubTurn;
  return {
    visible: aliveByBirth && aliveByDeath,
    bornThisTurn: life.birthTurn === scrubTurn,
    diedThisTurn: life.hasDeath && life.deathTurn === scrubTurn,
    life,
  };
}

// Produce { births: number[], deaths: number[] } for tick markers on
// the slider. Deduplicates within each category so a turn with many
// births only counts once visually (the tooltip can still summarize).
export function timelineTicks(chars, opts) {
  const births = new Set();
  const deaths = new Set();
  for (const c of chars) {
    const life = lifespanFor(c, opts);
    if (life.hasBirth && life.birthTurn > 0) births.add(life.birthTurn);
    if (life.hasDeath) deaths.add(life.deathTurn);
  }
  return {
    births: Array.from(births).sort((a, b) => a - b),
    deaths: Array.from(deaths).sort((a, b) => a - b),
  };
}

// Convert a turn back to a display year. Inverse of the epoch math above.
export function turnToYear(turn, opts) {
  const { currentTurn = 0, currentYear = null, turnsPerYear = DEFAULT_TURNS_PER_YEAR } = opts || {};
  if (currentYear == null) return null;
  const epochYear = currentYear - Math.floor(currentTurn / turnsPerYear);
  return epochYear + Math.floor(turn / turnsPerYear);
}

// Format a year as "270 BC" / "AD 14".
export function formatYear(y) {
  if (y == null) return "—";
  if (y < 0) return `${Math.abs(y)} BC`;
  if (y === 0) return "1 BC";
  return `AD ${y}`;
}
