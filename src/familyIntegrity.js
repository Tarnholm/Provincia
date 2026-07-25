/**
 * How complete is the save's family roster?
 *
 * WHY THIS EXISTS. `characters.family` looks authoritative — 2,846 well-formed records
 * on the reference save, every one with a resolvable name, 99% with a plausible age,
 * no duplicate uuids. It is nonetheless a PARTIAL view, and using it as a roster gives
 * badly wrong answers:
 *
 *   - only 15% of fatherUuid references resolve inside it (84 of 561)
 *   - only 11% of spouseUuid references resolve (246 of 2,170)
 *   - 416 distinct fathers are referenced but absent, and 257 of those (62%) are
 *     present in `characters.v1` instead
 *   - the survivors skew 19% male, because the missing members are disproportionately
 *     male, which yields 48 "alive adult males" map-wide against 848 settlements that
 *     demonstrably HAVE a governor
 *
 * The gender decode itself is sound and was verified independently before any of this
 * was believed: every record referenced as a father is male (84/84) and every resolved
 * spouse pair is opposite-gender (246/246). Fatherhood and marriage come from different
 * fields than the gender bit, so those checks could have failed and did not. The problem
 * is coverage, not decoding — which is exactly why it is easy to mistake for real data.
 *
 * So this reports the resolution rates and refuses to let a caller treat the roster as
 * complete without seeing them. It answers "may I count characters per faction?" — and
 * on the reference save the answer is no.
 */

/** Fraction, or null when there is nothing to divide. */
function share(hit, total) {
  return total ? +(hit / total).toFixed(3) : null;
}

/**
 * @param {Object} a
 * @param {Array} a.family   characters.family records
 * @param {Array} [a.v1]     characters.v1 records, to locate the missing ones
 * @param {number} [a.minResolution]  below this, the roster is declared unusable
 */
function familyIntegrity({ family = null, v1 = null, minResolution = 0.8 } = {}) {
  if (!Array.isArray(family) || !family.length) return null;

  const have = new Set(family.map((x) => x.uuid).filter(Boolean));
  let fatherRefs = 0, fatherHit = 0, spouseRefs = 0, spouseHit = 0, childRefs = 0, childHit = 0;
  const missingFathers = new Set();

  for (const x of family) {
    if (x.fatherUuid) {
      fatherRefs++;
      if (have.has(x.fatherUuid)) fatherHit++; else missingFathers.add(x.fatherUuid);
    }
    if (x.spouseUuid) {
      spouseRefs++;
      if (have.has(x.spouseUuid)) spouseHit++;
    }
    for (const c of x.childUuids || []) {
      childRefs++;
      if (have.has(c)) childHit++;
    }
  }

  // Where did the missing ones go? If they are in the other character list, the two are
  // partial views of one roster and neither may be used alone.
  let missingFoundInV1 = 0;
  if (Array.isArray(v1)) {
    const other = new Set();
    for (const x of v1) {
      if (x.primaryUuid) other.add(x.primaryUuid);
      if (x.secondaryUuid) other.add(x.secondaryUuid);
    }
    for (const u of missingFathers) if (other.has(u)) missingFoundInV1++;
  }

  const males = family.filter((x) => x.gender === "male").length;

  // The internal consistency checks that establish the gender bit is fine. Reported so
  // a reader can see that "the data is wrong" was tested, not assumed — and which part.
  const byUuid = new Map(family.filter((x) => x.uuid).map((x) => [x.uuid, x]));
  let fathersChecked = 0, fathersMale = 0, spousesChecked = 0, spousesOpposite = 0;
  for (const x of family) {
    const f = x.fatherUuid && byUuid.get(x.fatherUuid);
    if (f) { fathersChecked++; if (f.gender === "male") fathersMale++; }
    const s = x.spouseUuid && byUuid.get(x.spouseUuid);
    if (s) { spousesChecked++; if (s.gender !== x.gender) spousesOpposite++; }
  }

  const fatherResolution = share(fatherHit, fatherRefs);
  const spouseResolution = share(spouseHit, spouseRefs);
  // The roster is usable only if its own internal references mostly resolve. A partial
  // roster does not merely undercount — it undercounts SELECTIVELY (here, males), which
  // is worse than a uniform shortfall because per-faction ratios come out skewed.
  const usableAsRoster = (fatherResolution != null && fatherResolution >= minResolution)
    && (spouseResolution != null && spouseResolution >= minResolution);

  return {
    records: family.length,
    fatherRefs, fatherResolution,
    spouseRefs, spouseResolution,
    childRefs, childResolution: share(childHit, childRefs),
    missingFathers: missingFathers.size,
    missingFoundInV1,
    malePct: share(males, family.length),
    genderDecodeChecks: {
      fathersChecked, fathersMale,
      spousesChecked, spousesOpposite,
      // Both at 1.0 means the gender BIT is right and the problem is coverage.
      fathersMaleShare: share(fathersMale, fathersChecked),
      spousesOppositeShare: share(spousesOpposite, spousesChecked),
    },
    usableAsRoster,
    note: usableAsRoster
      ? "Family references mostly resolve; the roster may be counted per faction."
      : `INCOMPLETE ROSTER — only ${Math.round((fatherResolution || 0) * 100)}% of father and ` +
        `${Math.round((spouseResolution || 0) * 100)}% of spouse references resolve inside it, and ` +
        `${missingFathers.size} referenced fathers are absent` +
        (missingFoundInV1 ? ` (${missingFoundInV1} of them present in characters.v1)` : "") +
        `. The shortfall is not uniform: survivors are ${Math.round((share(males, family.length) || 0) * 100)}% male, ` +
        `so per-faction character counts and any male/adult filter built on them will be wrong. ` +
        `Do not use this as a roster.`,
  };
}

module.exports = { familyIntegrity };
