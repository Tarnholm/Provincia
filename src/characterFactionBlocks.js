// Which faction does a v1 character record belong to?  (2026-09-21)
//
// WHAT WAS WRONG. Records were labelled with "the last captain_card_<faction>
// marker before the record". A save holds only ~47 such markers for 239
// factions, and a marker sits INSIDE its faction's block, not at its start (the
// Julii's governors lie on both sides of the Julii marker). Measured against
// the one thing that is certain — a governor belongs to the faction that owns
// the settlement he governs — that rule was right for 22 of 177 governors on a
// turn-57 RIS save and 112 of 724 on a turn-1 save. Every Roman governor was
// "seleucid_rebels2". Family attribution is built on these labels, so it
// inherited the damage.
//
// WHAT IS TRUE (measured on both saves):
//   • a faction's character records are CONTIGUOUS in the file: 232 governors
//     of 81 factions fall into 84 runs, and the only faction in more than one
//     run is `slave` (the rebels);
//   • the blocks come in descr_strat faction order;
//   • whenever a record's two nearest governor-neighbours name the same faction,
//     the record is that faction's — 123 of 123 and 373 of 373, leave-one-out.
//
// So: governors are ANCHORS (faction = owner of the settlement governed, never
// `slave`), and every governor is labelled with that fact. The anchors that
// respect the block order then pin the blocks: every record lying between two
// such anchors of the SAME faction gets that faction. Labels finally spread
// across family links (father / spouse / children) — 0 conflicts on the two
// clean saves, 5 in 301 on the fragmented one (counted in the report, never
// resolved by overwriting).
//
// THE BLOCKS DO NOT LAST. They are the campaign-START layout. Characters who
// come of age later are filed into freed slots anywhere in the file, so a long
// campaign fragments: on a turn-102 all-AI save 51 of 102 factions were split
// across runs, a third of the governors sat outside their faction's main block,
// and filling blocks there was right only 106 times in 141 (75%). Two theories
// that would have excused those misses were tested and are FALSE: the governor
// references are not stale (the towns' original owners are the big empires, not
// the small neighbours the labels named), and the ownership table is not wrong
// (it agrees with the faction records' own region lists for 786 of 786 towns).
//
// The save itself says which case it is: the share of governors that break the
// block order was 0% (turn 1), 4.5% (turn 57) and 48% (turn 102). Above
// FRAGMENTED_ABOVE the block fill AND the family spread are skipped and only
// the governors themselves are labelled — facts that need no assumption.
//
// WHAT IS NOT CLAIMED. A record between anchors of two DIFFERENT factions could
// belong to either, or to a governor-less faction ordered between them, so it
// stays `null`. On an unfragmented save coverage is 53% (turn 57) to 82% (turn
// 1) with 100% leave-one-out precision. The captain_card markers were tried as
// extra anchors and REJECTED: inside governor-pinned blocks they clashed twice
// in five.
// The old positional guess is kept as `factionByMarker` for diagnostics only.
"use strict";

// Share of governors breaking the block order above which the campaign-start
// layout is treated as gone (measured: 0 · 0.045 · 0.48 — see the header).
const FRAGMENTED_ABOVE = 0.10;

const NO_ID = 0xffffffff;
const ok = (u) => !!u && u !== NO_ID;

// Longest order-respecting subsequence of anchors (non-decreasing faction index).
function keepOrdered(idxs, orderIdx) {
  const n = idxs.length;
  if (!n) return new Set();
  const len = new Array(n).fill(1), prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) {
    if (orderIdx[j] <= orderIdx[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (len[i] > len[best]) best = i;
  const keep = new Set();
  for (let k = best; k >= 0; k = prev[k]) keep.add(idxs[k]);
  return keep;
}

// v1: character records ({ offset, secondaryUuid, primaryUuid, fatherUuid,
// spouseUuid, childUuids, faction }). Mutates each record:
//   faction          verified faction, or null
//   factionSource    "governor" | "block" | "family" | null
//   factionByMarker  the old positional guess (diagnostic only)
// Returns a small report.
function labelByFactionBlocks(v1, { settlementFields, ownerByCity, factionOrder } = {}) {
  const recs = (Array.isArray(v1) ? v1 : []).filter((c) => c && c.offset != null).sort((a, b) => a.offset - b.offset);
  for (const c of (v1 || [])) { if (c && !("factionByMarker" in c)) c.factionByMarker = c.faction || null; }
  const report = { records: recs.length, anchors: 0, anchorsDropped: 0, fragmentation: 0, fragmented: false, byBlock: 0, byFamily: 0, familyConflicts: 0, selfTest: null, unlabelled: recs.length, usable: false };
  if (!recs.length || !settlementFields || !ownerByCity) return report;

  const order = new Map((factionOrder || []).map((f, i) => [String(f).toLowerCase(), i]));
  const bySecondary = new Map();
  for (const c of recs) if (ok(c.secondaryUuid)) bySecondary.set(c.secondaryUuid >>> 0, c);

  const anchorAt = new Map(); // offset → faction
  for (const [city, owner] of Object.entries(ownerByCity)) {
    const fac = String(owner || "").toLowerCase();
    if (!fac || fac === "slave" || (order.size && !order.has(fac))) continue;
    const g = settlementFields[city] && settlementFields[city].governorUuid;
    if (!ok(g)) continue;
    const c = bySecondary.get(g >>> 0);
    if (c) anchorAt.set(c.offset, fac);
  }
  report.anchors = anchorAt.size;
  // too few anchors to say anything: leave every label null rather than half-apply
  if (anchorAt.size < 2) { for (const c of recs) { c.faction = null; c.factionSource = null; } return report; }

  const idxs = [];
  for (let i = 0; i < recs.length; i++) if (anchorAt.has(recs[i].offset)) idxs.push(i);
  const keep = order.size ? keepOrdered(idxs, idxs.map((i) => order.get(anchorAt.get(recs[i].offset)))) : new Set(idxs);
  report.anchorsDropped = idxs.length - keep.size;
  report.fragmentation = idxs.length ? report.anchorsDropped / idxs.length : 0;
  report.fragmented = report.fragmentation > FRAGMENTED_ABOVE;

  for (const c of recs) { c.faction = null; c.factionSource = null; }
  // A governor's faction is a FACT (the owner of the town he governs), whether or
  // not he sits where the block order expects. The first version dropped the
  // order-breakers and then relabelled them from their neighbours — 60 wrong
  // labels on the turn-102 save, every one of them a known governor.
  for (const i of idxs) { recs[i].faction = anchorAt.get(recs[i].offset); recs[i].factionSource = "governor"; }
  if (!report.fragmented) {
    const kept = [...keep].sort((a, b) => a - b);
    // SELF-TEST, every save: hide each order-respecting governor in turn and ask
    // the block rule what he is. "wrong" must stay 0 — it is the only evidence
    // that the block fill can be believed on THIS save (governors agreeing with
    // their own towns proves nothing: they were labelled from them).
    const st = { right: 0, wrong: 0, undecided: 0 };
    for (let k = 0; k < kept.length; k++) {
      const p = kept[k - 1], n = kept[k + 1];
      if (p == null || n == null || anchorAt.get(recs[p].offset) !== anchorAt.get(recs[n].offset)) { st.undecided++; continue; }
      if (anchorAt.get(recs[p].offset) === anchorAt.get(recs[kept[k]].offset)) st.right++; else st.wrong++;
    }
    report.selfTest = st;
    for (let k = 0; k + 1 < kept.length; k++) {
      const fac = anchorAt.get(recs[kept[k]].offset);
      if (anchorAt.get(recs[kept[k + 1]].offset) !== fac) continue;
      for (let i = kept[k] + 1; i < kept[k + 1]; i++) {
        if (recs[i].factionSource === "governor") continue; // never overwrite a fact
        recs[i].faction = fac; recs[i].factionSource = "block"; report.byBlock++;
      }
    }
  }

  // family links carry the faction; a conflict is never resolved by overwriting.
  // NOT on a fragmented save: on the turn-102 save 53 linked pairs named two
  // different factions (0 on both clean saves), so there the links themselves
  // cannot be trusted and only the governors — facts — are labelled.
  const byPrimary = new Map();
  for (const c of recs) if (ok(c.primaryUuid)) byPrimary.set(c.primaryUuid >>> 0, c);
  const conflictPairs = new Set(); // distinct linked pairs naming two different factions
  let grew = true, rounds = 0;
  while (!report.fragmented && grew && rounds++ < 12) {
    grew = false;
    for (const c of recs) {
      if (!c.faction) continue;
      for (const u of [c.fatherUuid, c.spouseUuid, ...(c.childUuids || [])]) {
        if (!ok(u)) continue;
        const o = byPrimary.get(u >>> 0);
        if (o && !o.faction) { o.faction = c.faction; o.factionSource = "family"; report.byFamily++; grew = true; }
        else if (o && o.faction !== c.faction) conflictPairs.add(Math.min(c.offset, o.offset) + "|" + Math.max(c.offset, o.offset));
      }
    }
  }
  report.familyConflicts = conflictPairs.size;
  report.unlabelled = recs.filter((c) => !c.faction).length;
  report.usable = true;
  return report;
}

module.exports = { labelByFactionBlocks, FRAGMENTED_ABOVE };
