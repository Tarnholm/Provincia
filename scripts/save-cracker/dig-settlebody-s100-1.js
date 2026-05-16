// dig-settlebody-s100-1.js
//
// Session 100: T0-vs-live diff for the settlement-name-marker neighbourhood
// to pin editable per-settlement fields. The MARKER anchor is the byte
// position returned by `findAllSettlementMarkers(buf)` — i.e. the `[flag,
// nchars, 0x00, UTF-16 name, 0x00 0x00]` block that opens each settlement's
// chain-record gap. Earlier sessions (86/94/96) anchored on the FC magic
// inside the *settlement-detail* record (a different region of the file).
// The fields below are MARKER-relative and SEPARATE from FC-relative
// findings.
//
// Inputs (fixtures/feral/):
//   - save_10_fresh.sav   — RIS imperial T0 (player = romans_julii)
//   - save_1.2.sav        — also basically T0 (1310 markers, Rome=9000)
//   - ror_t1e.sav         — RoR T1 end (RIS imperial)
//   - ror_t2s.sav         — RoR T2 start
//   - ror_t5.sav          — RoR T5 (Rome=8955, populations have evolved)
//   - ror_t11s.sav        — RoR T11 start (Rome=9460)
//
// Findings (relative offsets are FROM the settlement-name marker; CONFIRMED
// means cross-validated across ≥ 3 distinct turns / saves):
//
//   d=-2269   u8   tax-level enum {0=auto/low,1=normal,2=high,3=very_high}
//                 CONFIRMED — 1118/1118 settlements in T11s have v∈{0,1,2,3}
//                 Default written for non-player factions = 0 (most settlements
//                 in T0 have 0; the player's 25 starting settlements have 1).
//                 As campaigns progress, AI tax bytes drift.
//
//   d=-2207   u8   settlement-level enum CONFIRMED via descr_strat correlation
//                   1 = town  (676/715 = 94.5%)
//                   2 = large_town (465/481 = 96.7%)
//                   3 = city (89/89 = 100%)
//                   4 = large_city (15/15 = 100%)
//                   5 = huge_city (4/4 = 100%)
//                   0 = village (no villages in RIS imperial T0 sample)
//                 Cross-validated on save_10_fresh / ror_t1e / ror_t2s /
//                 ror_t5 / ror_t11s — 96%+ enum-valid every save.
//
//   d=-1944   u32  current owner faction UUID (already CONFIRMED — earlier sessions)
//   d=-1940   u32  governor character UUID (already CONFIRMED — session 50ish)
//
//   d=-1494   u32  CURRENT live population CONFIRMED (Rome T0 = 9000 ✓
//                 descr_strat). 1310/1310 in T0 within [400, 12000] range.
//
//   d=-34     u32  POPULATION SNAPSHOT (mirror) — CONFIRMED
//                 In T0 saves: u32(-34) == u32(-1494) for ALL 1310 settlements.
//                 In ror_t5: 861/1171 pairs differ slightly (e.g. Carthage
//                 current=12548, snap=12736). Semantics unclear; testing
//                 vs T1e->T2s shows snapshot is NOT simply "previous-turn end
//                 population" — only 247/1304 pairs match that hypothesis.
//                 Best guess: a "displayed/projected" pop value vs an
//                 "actual" pop. STRONG that the value exists; HYPOTHESIS
//                 for exact semantics.
//
//   d=-30     f32  PUBLIC ORDER / HAPPINESS score CONFIRMED
//                 Range observed 0..360. Hot zone 75..275. The prompt's
//                 "u32 LE happiness, range 105..195" was a misread — the
//                 value is f32 (high byte 0x43 dominant = ~100..300 range
//                 in float). Confirmed 1304/1310 settlements pass
//                 "f32 in [-100, 500]" check in T0.
//
//   d=-1190   f32  HAPPINESS DUPLICATE / SECONDARY (HYPOTHESIS — previous-turn snapshot)
//                 In T0: f32(-30) and f32(-1190) match for only 21/1310
//                 (mostly close-but-not-equal, off by 5-20). In T11s:
//                 1025/1171 match exactly. Pattern: T0 the secondary
//                 hasn't been written yet; over time they converge. Best
//                 interpretation: "previous-turn happiness" or "displayed
//                 happiness with smoothing." Range identical to -30.
//
//   PUBLIC ORDER / INCOME f32 CLUSTER (marker-relative, stride 4):
//   d=-1490   f32  STRONG ACTIVE — peaks at 16.0; AI cities also nonzero;
//                  values 0..16 dominant. Possibly "base trade income" or
//                  "base farming output". Distinct values: ~17.
//   d=-1486   f32  STRONG ACTIVE — can be NEGATIVE (Garama T5 = -3,
//                  many cities -1, -4 etc.). Public-order penalty/bonus
//                  modifier — likely religion / culture-foreign penalty.
//                  Distinct values: 19 in T11.
//   d=-1482   f32  STRONG ACTIVE — all zero in T0, fills in over turns.
//                  Range -4..+6. A "post-first-turn" modifier (squalor?).
//   d=-1478   f32  STRONG ACTIVE — small positives 0..8.
//   d=-1474   f32  CONFIRMED ACTIVE — 0 in T0, jumps to {6: 776, 0: 395}
//                  in T11s. Looks like a 2-state {0, 6} switch. Possibly
//                  "is rebellion-eligible / squalor base flag" or "base
//                  culture-foreign penalty = 6."
//   d=-1462   f32  STRONG ACTIVE — present heavily in T0 (768/1310 nonzero)
//                  but drops to 50/1118 in T11. Migration to another offset
//                  over turns?
//   d=-1454   f32  STRONG ACTIVE
//   d=-1450   f32  STRONG ACTIVE — small positives 0..8.
//   d=-1446   f32  STRONG ACTIVE — values 0..16, similar shape to -1490.
//                  Possibly the "current-turn" twin of -1490 (income).
//   d=-1442   f32  STRONG ACTIVE — FRACTIONAL values seen (0.3, 0.9, 8.5,
//                  9.7, 9.8, 10.0). Range mostly 0..10. Unique among the
//                  cluster for non-integer values. Possibly a percentage
//                  / rate field. Modest correlation 0.14 with pop-delta —
//                  NOT the growth rate directly.
//   d=-1434   f32  WEAK — 0 in T0, becomes active in T11 (342/1118).
//   d=-1430   f32  WEAK
//   d=-1406   f32  STRONG ACTIVE in T0 (618/1310 == 2) but drops to ~40
//                  in T11s. A turn-0-anchored counter that decays.
//
//   GAP at d=-1402..-1194: ALL ZERO across all samples (reserved padding
//   or future-feature space).
//
//   d=-1182   u16  STRONG correlation with population (Pearson 0.856).
//                  Same pop ⇒ same u16. Range 327..1144. Likely "tax revenue
//                  per turn" or "income from population" — needs formula fit.
//
// USAGE: node dig-settlebody-s100-1.js

"use strict";

const fs = require("fs");
const path = require("path");
const { findAllSettlementMarkers } = require("../../src/buildingParser.js");

const FIXTURES = path.join(__dirname, "fixtures/feral");

function main() {
  const fresh = fs.readFileSync(path.join(FIXTURES, "save_10_fresh.sav"));
  const t5 = fs.readFileSync(path.join(FIXTURES, "ror_t5.sav"));
  const t11s = fs.readFileSync(path.join(FIXTURES, "ror_t11s.sav"));

  console.log("=== Cross-save validation of session-100 settlement-body findings ===\n");

  const saves = [
    { name: "save_10_fresh", buf: fresh },
    { name: "ror_t5", buf: t5 },
    { name: "ror_t11s", buf: t11s },
  ];

  for (const { name, buf } of saves) {
    const setts = findAllSettlementMarkers(buf);
    const lvlOk = setts.filter(s => buf[s.offset - 2207] <= 5).length;
    const taxOk = setts.filter(s => buf[s.offset - 2269] <= 3).length;
    const popOk = setts.filter(s => {
      const p = buf.readUInt32LE(s.offset - 1494);
      return p >= 100 && p <= 100000;
    }).length;
    const happOk = setts.filter(s => {
      const h = buf.readFloatLE(s.offset - 30);
      return isFinite(h) && h >= -100 && h <= 500;
    }).length;
    console.log(`${name.padEnd(16)} settlements=${setts.length}`);
    console.log(`   level @-2207 (u8 0..5): ${lvlOk}/${setts.length}`);
    console.log(`   tax   @-2269 (u8 0..3): ${taxOk}/${setts.length}`);
    console.log(`   pop   @-1494 (u32):    ${popOk}/${setts.length}`);
    console.log(`   order @-30   (f32):    ${happOk}/${setts.length}`);
  }

  // Spot-check Rome / Carthage values for sanity (descr_strat verification).
  console.log("\n=== Spot-check vs descr_strat ===");
  const sa = findAllSettlementMarkers(fresh);
  for (const n of ["Rome", "Carthage", "Sparta", "Tarentum", "Athens"]) {
    const s = sa.find(x => x.name === n);
    if (!s) continue;
    const pop = fresh.readUInt32LE(s.offset - 1494);
    const lvl = fresh[s.offset - 2207];
    const tax = fresh[s.offset - 2269];
    const happ = fresh.readFloatLE(s.offset - 30);
    const levelNames = ["village","town","large_town","city","large_city","huge_city"];
    console.log(`  ${n.padEnd(12)} pop=${pop} level=${lvl}(${levelNames[lvl]||"?"}) tax=${tax} happ=${happ.toFixed(2)}`);
  }
}

if (require.main === module) main();
