/**
 * Link settlements to the characters governing them — and check the link before use.
 *
 * WHAT WAS FOUND (2026-07-25). `settlementFields.governorUuid` shares an id space with
 * `characters.v1[].secondaryUuid`, NOT with `v1[].primaryUuid` or `family[].uuid`:
 * 645 of 848 governor ids resolve against secondaryUuid and exactly 0 against either of
 * the others. With 842 distinct ids against a 1,358-value pool over 2^32, chance would
 * predict essentially none, so the shared space is real.
 *
 * The link is therefore usable — but `v1[].faction` IS NOT. Applying the obvious
 * falsifier (a governor must belong to the faction that owns the settlement) gives
 * **1% agreement, worse than the 17.6% a random pairing would score.** Being worse than
 * random is the tell: this is a systematic misattribution, not noise.
 *
 * The misattribution is PARTLY structured. Some owners' governors carry one consistent
 * wrong label — romans_julii's 25 are labelled seleucid_rebels2 25 times out of 25,
 * ptolemaic's 41 of 49 say antigonid, antigonid's 15 of 18 say carthage — while others
 * scatter (carthage 3 of 10, seleucid 16 of 46, the rebels 12 of 259).
 *
 * A FIRST READING OF THIS OVERSTATED IT as a single global index shift, on the strength
 * of "65 of 102 owners have one dominant label". That figure was an artifact of counting
 * owners who hold a SINGLE governor, for whom a dominant label is trivially 100%.
 * Requiring three or more gives 17 of 38, and at ten or more only about half the owners
 * relabel consistently. So the code claims `partlyConsistent`, not an index shift, and
 * publishes its minimum sample alongside the ratio so the number cannot be quoted
 * without it.
 *
 * What IS unambiguous is that the character records themselves are right and only the
 * label is wrong: the governors sitting in Roman cities are named Numerius, Gaius,
 * Publius, Quintus and Decimus — Roman praenomina — while labelled seleucid_rebels2.
 *
 * So: use `factionFromSettlement` (the owner of the settlement they govern, which is
 * authoritative and independently verified) and treat `v1[].faction` as unreliable until
 * the parser is fixed. This module reports the evidence rather than silently preferring
 * one field, because the next reader needs to know which half to trust.
 */

const NO_ID = 0xffffffff;
const ok = (u) => !!u && u !== NO_ID;

/**
 * Resolve settlement → governing character, and grade the result.
 *
 * @param {Object} a
 * @param {Object<string,{governorUuid:number}>} a.settlementFields
 * @param {Object<string,string>} a.ownerByCity   settlement → owning faction
 * @param {Array} a.v1                            characters.v1 records
 */
function governorLink({ settlementFields = null, ownerByCity = null, v1 = null } = {}) {
  if (!settlementFields || !ownerByCity || !Array.isArray(v1) || !v1.length) return null;

  const bySecondary = new Map();
  for (const c of v1) if (ok(c.secondaryUuid)) bySecondary.set(c.secondaryUuid, c);

  const links = [];
  let withGovernor = 0, unresolved = 0;
  for (const [city, owner] of Object.entries(ownerByCity)) {
    const g = settlementFields[city] && settlementFields[city].governorUuid;
    if (!ok(g)) continue;
    withGovernor++;
    const c = bySecondary.get(g);
    if (!c) { unresolved++; continue; }
    links.push({
      city,
      owner: String(owner).toLowerCase(),
      name: c.firstName || null,
      // The label the record carries, and the label the settlement implies. Kept as two
      // fields on purpose — collapsing them would hide which one was believed.
      factionOnRecord: c.faction ? String(c.faction).toLowerCase() : null,
      factionFromSettlement: String(owner).toLowerCase(),
    });
  }

  if (!links.length) {
    return {
      withGovernor, resolved: 0, unresolved,
      agreement: null, randomBaseline: null, factionFieldUsable: false,
      systematicRelabel: null, links: [],
      note: `No governor id resolved against v1.secondaryUuid (${withGovernor} settlements have one). ` +
            `The link between settlements and characters is not available from this save.`,
    };
  }

  // ── THE FALSIFIER ──
  // Independent of the id space being tested: settlement ownership comes from a
  // different part of the save than the character record's faction field.
  let agree = 0, judged = 0;
  for (const l of links) {
    if (!l.factionOnRecord) continue;
    judged++;
    if (l.factionOnRecord === l.factionFromSettlement) agree++;
  }
  const agreement = judged ? +(agree / judged).toFixed(3) : null;

  // What would random pairing score? Sum of squared owner shares. Without this the
  // agreement figure has no scale — and the real finding is that it falls BELOW it.
  const owners = Object.values(ownerByCity).map((x) => String(x).toLowerCase());
  const counts = new Map();
  for (const o of owners) counts.set(o, (counts.get(o) || 0) + 1);
  let randomBaseline = 0;
  for (const n of counts.values()) randomBaseline += (n / owners.length) ** 2;
  randomBaseline = +randomBaseline.toFixed(3);

  // ── SYSTEMATIC-RELABEL FINGERPRINT ──
  // Noise scatters. An index shift maps each owner to ONE consistent wrong label, which
  // is what distinguishes "the faction field is offset" from "the link is wrong".
  const byOwner = new Map();
  for (const l of links) {
    if (!l.factionOnRecord) continue;
    const m = byOwner.get(l.owner) || new Map();
    m.set(l.factionOnRecord, (m.get(l.factionOnRecord) || 0) + 1);
    byOwner.set(l.owner, m);
  }
  // MINIMUM SAMPLE MATTERS MORE THAN IT LOOKS. With no floor, an owner holding one
  // governor trivially has a "100% dominant" label, and counting those gave 65 of 102
  // owners "consistently relabelled" — an artifact. Requiring 3+ drops it to 17 of 38.
  // The floor is stated in the output so the figure cannot be quoted without it.
  const MIN_SAMPLE = 3;
  const STRONG_SAMPLE = 10;
  let considered = 0, dominant = 0;
  const strongExamples = [];
  for (const [owner, m] of byOwner) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    if (total < MIN_SAMPLE) continue;
    considered++;
    const [label, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    const consistent = n / total >= 0.8;
    if (consistent) dominant++;
    // Large-sample cases are reported whether or not the global pattern holds: they are
    // the concrete leads for whoever fixes the parser. romans_julii's 25 governors are
    // labelled seleucid_rebels2 25 times out of 25, which is not arguable.
    if (total >= STRONG_SAMPLE && consistent && label !== owner) {
      strongExamples.push({ owner, mislabelledAs: label, n, of: total });
    }
  }
  strongExamples.sort((a, b) => b.of - a.of);
  const systematicRelabel = {
    minSample: MIN_SAMPLE,
    ownersConsidered: considered,
    ownersWithOneDominantLabel: dominant,
    strongExamples,
    // NOT claimed as a single global index shift. At the >=10-link sample only about
    // half of owners relabel consistently (romans_julii, ptolemaic and antigonid do;
    // carthage, seleucid and the rebels do not), so the misattribution is partly
    // structured and partly scattered. Saying "index shift" outright would overstate it.
    partlyConsistent: considered >= 10 && dominant / considered >= 0.4,
  };

  const factionFieldUsable = agreement != null && agreement >= 0.9;

  return {
    withGovernor,
    resolved: links.length,
    unresolved,
    idSpace: "settlementFields.governorUuid <-> characters.v1[].secondaryUuid",
    agreement,
    randomBaseline,
    // Below the random baseline is the headline: it rules out "noisy but roughly right".
    worseThanRandom: agreement != null && agreement < randomBaseline,
    factionFieldUsable,
    systematicRelabel,
    links: links.slice(0, 200),
    note: factionFieldUsable
      ? `Governor links resolve and the character records' faction field agrees with settlement ownership ` +
        `${Math.round(agreement * 100)}% of the time. Both may be used.`
      : `USE factionFromSettlement, NOT the record's faction field. The link itself resolves ` +
        `(${links.length} of ${withGovernor} settlements with a governor), but the faction on the character ` +
        `record agrees with the settlement's owner only ${Math.round((agreement || 0) * 100)}% of the time — ` +
        `against ${Math.round(randomBaseline * 100)}% for random pairing, so it is not merely noisy.` +
        (strongExamples.length
          ? ` The misattribution is partly structured: ${dominant} of ${considered} owner factions with at least ` +
            `${MIN_SAMPLE} governors carry one dominant wrong label, including ` +
            `${strongExamples.slice(0, 3).map((e) => `${e.owner} -> ${e.mislabelledAs} (${e.n}/${e.of})`).join(", ")}. ` +
            `The character records themselves look right — the governors in Roman cities are named Numerius, Gaius, ` +
            `Publius, Quintus and Decimus — so it is the faction LABEL that is wrong, not the link.`
          : ""),
  };
}

/**
 * Per-faction governor coverage, using settlement ownership for attribution.
 *
 * Deliberately does NOT report a "spare characters" or shortage verdict. Answering
 * "shortage or deployment failure?" needs a complete per-faction character roster, and
 * this save has none: v1's faction field is misattributed (see above) and
 * characters.family resolves only 15% of its own references (see familyIntegrity.js).
 * A verdict was computed from those and read plausibly — 20 factions "assignment", 1
 * "supply" — before the falsifier showed the attribution was worse than random. It is
 * omitted rather than shipped with a caveat, because a plausible wrong answer is more
 * expensive than a missing one.
 */
function governorCoverage({ settlementFields = null, ownerByCity = null } = {}) {
  if (!settlementFields || !ownerByCity) return null;
  const per = new Map();
  for (const [city, owner] of Object.entries(ownerByCity)) {
    const k = String(owner).toLowerCase();
    const e = per.get(k) || { faction: k, owned: 0, governed: 0, ungoverned: 0 };
    e.owned++;
    const g = settlementFields[city] && settlementFields[city].governorUuid;
    if (ok(g)) e.governed++; else e.ungoverned++;
    per.set(k, e);
  }
  const rows = [...per.values()]
    .map((e) => ({ ...e, ungovernedShare: e.owned ? +(e.ungoverned / e.owned).toFixed(3) : null }))
    .sort((a, b) => b.ungoverned - a.ungoverned);
  return {
    factions: rows.length,
    totalUngoverned: rows.reduce((a, r) => a + r.ungoverned, 0),
    rows,
  };
}

module.exports = { governorLink, governorCoverage };
