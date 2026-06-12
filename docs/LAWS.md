# RTW:Remastered (RIS) — Cracked Economy & Public-Order Laws

The complete reference of every engine law reverse-engineered from live RTW:R running
the RIS mod, 2026-06-09 → 06-12. Method: settlement-scroll/ledger screenshot corpora,
controlled console probes (`give_trait`, `add_population`), one-line `descr_strat`
resource edits with fresh-campaign F12 reads, and save-file byte cracking. Every
constant lives in `src/incomeModel.js` (`CALIB`) or `src/poModel.js`; regression
guards in `src/incomeModel.test.js`, `src/incomeModel.live.test.js`, `src/taxCalib.test.js`,
`src/poModel.test.js`.

Audience: the RIS mod team. "Live" always means an in-game reading on the current mod
vintage; probe evidence is cited inline.

## Validated accuracy (v0.9.1098 vintage)

| scope | result |
|---|---|
| farming / wages / mining | exact (julii 0.0%, egypt +0.3%, mining 8/8) |
| army upkeep | exact law (julii ±0, capua ±0, egypt +0.02%, cyrene +0.13%) |
| taxes | ±1% faction Σ modulo the per-town H roll (see §4.3) |
| trade | capua 1268/1268 exact, julii −0.1%, kyzikos exact, egypt +0.7% (pinned), cyrene −7% |
| corruption | julii +1.9%, cyrene +1.0%, egypt +0.9% |
| public order | save-aware 26/26 towns within ±10pp (16 exact), no-save 24/26 |
| AI factions (n=215) | total income median 3.7%, p90 11.3% |

---

## 1. Farming

```
farming_town = 73.6 × pts        (= 80 × 0.92 hard-difficulty)
pts = region farmN (descr_regions) + Σ EDB farming_level / farming_level-bonus
      (per-chain maxima ADD: farms + irrigation both feed income)
      + governor `Effect Farming` points
```

- The 80/pt base is Feral-documented (EDB.md *"farming_level: plus the region's
  agricultural base"*); 0.92 is the documented HARD-difficulty income multiplier
  (Easy 1.20 / Normal 1.00 / Hard 0.92).
- Additive bonuses (olives/vines/dates) only apply on top of an existing farm chain
  (Fregellae pin).
- The ledger jitters turn-to-turn (julii 19,202 ↔ 19,469 with identical buildings):
  each region rolls a **harvest** every turn (Poor/Average/Excellent). Turn-1 reads are
  pre-roll and reproduce exactly (4/4 cyrene towns to the denarius; egypt +0.3% on 84 towns).
- Hanging Gardens: farming wonder bonus applies (ptolemaic-owned, folded in CALIB).

## 2. Wages

```
wages = 200 × named character + 50 × admiral        (exact)
```
Julii fresh t1: 33 characters = 30·200 + 3·50 = 6,150, ledger-exact. Verified again on
every corpus save.

## 3. Army upkeep

```
ledger army = Σ units RAW EDU stat_cost[3rd field]        — no category scales
bodyguards  = round(upkeep × men / (soldiers × sizeMult)),
              men = soldiers×4 (HUGE) + officers + 2×commandStars,
              faction LEADER and HEIR men ×2
```

- Cracked via the Capua disband probe (2026-06-11: "removed all units but the
  generals" → ledger 202 with 2 generals: 45×54/24 = 101.25 → 101 each ✓).
- Auto-heir: a faction with a leader but no heir flag (cyrene) promotes one general at
  start — he gets the ×2 too.
- The old per-class scales (inf .976 / cav 1.186) and the ×1.0122 global constant were
  artifacts (the constant was masking command-star men: julii has 26 stars).
- Unit-card tooltip upkeep is the size-scaled display (≈EDU/2.4), **not** the ledger
  charge — red herring resolved.
- Four-faction validation: julii 25,958 ±0 · capua 4,565 ±0 · egypt 44,209 +10 (0.02%)
  · cyrene ±11 (0.13%). AI pays FULL EDU upkeep (median ratio 1.010, n=215 — no AI
  discount exists).

## 4. Taxes

### 4.1 Imperial law (multi-town factions, player)

```
taxes_town = 0.4559 × W(pop) × rate × gov  +  3.9 × P × gov
W(pop)     = 400 × (ln pop − 4.4)
rate       = 0.8 / 1.0 / 1.2 / 1.5            (low/normal/high/very-high — exactly linear,
                                               verified on full 4-bracket sweeps of 5 towns)
P          = Σ EDB taxable_income_bonus points — ALL LINES APPLY FLAT, never as %
gov        = 1 + governor TaxCollection% (traits + followers/ancillaries)
```

- The flat-points discovery (bucket-solve over all 3^8 line-class assignments) killed
  the historic "taxable %" reading; empire-size hinterland lines select by **exact**
  tier (`empire_sizeN` events, exclusive settlement-count brackets 1 / 2-4 / 5-8 / 9-15 /
  16-29 / 30-50 / 51-100 / …).
- Trait→effect mapping is plain EDCT thresholds with effects replacing per level
  (Tanis console probes: Cheapskate L1 +4.6%≈5 exact, L2 +9.8%≈10 exact), plus the
  **L1 floor**: any seeded points ≥ 1 activate at least level 1 (cyrene governor cards:
  Lenient pts6 < thr10 still shows Tax −10).
- Anti-traits subtract seeded levels before mapping (Thessalonike/Memphis probes).
- Capital bonus FALSIFIED: Kyrene (cyrene capital, PO 200) fits ±1% with no bonus;
  PO≥120 `order_income_bonus` dead; Influence/Mgmt/Law tax multipliers dead (r ≤ 0.17, n=15).

### 4.2 City-state law (single-settlement factions, player)

```
taxes = 0.8154 × W(pop) × rate × gov  −  43.2 × gov
```
Capua 4-bracket sweep (bottom-bar 4137/4454/4771/5246, perfectly linear → 1585·rate −
47.5). The pop coefficient is 1.79× the imperial one and the flat points collapse —
the player sibling of the AI tier-1 subsidy floor (§10).

### 4.3 H quantization — the per-campaign tax roll

```
live_taxes(town) = model × H,   H ∈ {0.90, 0.95, 1.00, 1.05, 1.10}
```

- Discovered on the 26-town fresh-julii live-vs-model table (2026-06-12): every
  residual snaps to a ±5% step (19/19 non-governor towns, maxErr 6 denarii; the
  "wine probe" tax twists Capua 2330→2446 and Messana 1880→1974 are exactly ×1.05).
- H is **rolled at campaign start, seeded by the exact file set**: same files reproduce
  it (user-verified determinism); ANY strat/EDB edit reshuffles every town's H
  (11/19 towns flipped between two campaigns differing by one unit line).
- H is uncorrelated with every file feature tested (resources, farms, distance, PO,
  buildings — 1,596 feature pairs, zero consistent) and is not recoverable from the
  save (whole-file scan negative). Static model accuracy cap: ±10%/town, ±2-3% on a
  faction Σ (E[H] ≈ 1).
- Mitigation shipped (v0.9.1097): the 🎯 per-campaign tax calibration box — paste live
  per-town readings once per campaign, H locks per town (`src/taxCalib.js`).
- METHOD RULE: tax probes must be within-campaign (console) or same-files restarts;
  any file edit invalidates cross-campaign tax comparisons.

## 5. Admin income (financial overview "other", econ slot f9)

```
admin_town = (2 × governor's displayed Management stat)% × (taxes+farming+mining+trade)
```
Exact 7/7 cyrene towns to the denarius (M 0/0/1/2/3/4/5 → 0/0/2/4/6/8/10%); card stats
verified against 8 governor-card 4K reads. The save stores the computed card stats
directly (characterParser frame, SIGNED int32 — a negative Influence nulled the old
unsigned read). No governor → no admin row.

## 6. Corruption ("other" expenditure, slot f22)

```
corr%_town = clamp( 0.74 × (d_eff − 15.5), 0, 60 )   of town gross (incl. admin)
d_eff      = pixel distance to capital + 4 × max(0, −lawPts)
law        = −3 pp per settlement law point (corrLawPct 3, see below)
capital    = 0
```

- LINEAR (corrB 0): refit on six fresh julii console-probe towns (rmse 0.35pp, max
  0.62pp — `corruption-refit-2.md`), egypt-80 out-of-sample rmse 3.06pp unchanged.
- **corrLawPct 3 double-confirmed live**: `give_trait Nossis HarshJustice 1/2` on Locri:
  34.24% → 31.27% → 25.45%. EDCT HarshJustice is Law +2/+4/+6 but it ANTI-TRAITS
  Just/1, so the net law deltas were +1/+3 → 2.97/2.93 pp per law point. Exactly linear,
  5%/pt ruled out.
- Negative law inflates distance ~4 tiles/pt (Pisae law−2 probe: 14.3%→20.2%; explains
  the cyrene desert trio).
- Saturation cap 60: far-east egypt towns read 59-64% at x = 141/226/351 — not the old
  90% linear climb.
- No display floor (Volaterrae 0.92% shows live). The historic "law ≥ 3 → zero"
  threshold and office-governor-zero rules were this law in small samples.

## 7. Sea trade

The most probe-intensive crack. A port forms **lanes**; each lane carries directed
**flows**; a flow's value = per-lane `f` × shortfall-cargo points.

### 7.1 Lane formation

- Slots: `1 + built port-chain index` export slots (port=1, shipwright=2 — Rome,
  Capua, Kyzikos, Lampsakos all shipwright→2 exports).
- Eligible partners: own / ally / trade-rights / **not-at-war** ports (Sena→Nesactium:
  neutral histria trades; trade rights boost, not gate).
- **Land-adjacency exclusion**: mutually land-adjacent regions never lane (the Nile
  proof: Alexandria~Naukratis touch diagonally → land row only; Kyrene⇄Arsinoe skip
  their adjacent neighbors exactly as predicted).
- Distance-greedy matching, `seaLaneMaxDist` 40 (no Aegean lanes from Cyrenaica);
  matching is **cargo-value-sensitive** (the Mamertina wine-7 probe re-routed
  Messana's lane from Consentia to Panormos — goods edits re-route lanes).
- **River bodies** (map water colors form bodies; a "small" body < 1500 px = river):
  river ports lane ALL-PAIRS within the body, no slot consumption (Nile delta:
  Alexandria⇄Sebennytos/Mendes/Tanis live 713/605/519).
- Weak slots (last slot / one-sided pick) EXPORT NOTHING — every historic "weak
  export" reading was a misread import row.
- Reproduces every observed lane set: Rome Freg*/Capua*/Volat-w · Cosa Praen*/Pisae-w ·
  Nea Freg*/Grum-w · Sena Nesactium* · Kyr Ars*/Eues* · Eues Ptol*/Kyr-w-out ·
  Ars Kyr* · Ptol Eues* · Messana Consentia.

### 7.2 The ÷5 import law

Every sea row is ONE directed flow; **both** sides earn from it; the importer earns
**exactly exporter/5**. Eleven exact witnesses across three factions (Kyr→Ars 430↔86,
Ars→Kyr 140↔28, Kyr→Eues 265↔53, Eues⇄Ptol 191/39 & 174/35; julii 86=430/5, 67=335/5,
42=207/5, 37=185/5, 9=45/5, 98=489/5, 26=126/5). The old "import k=7.2" was
exporter/5 in disguise.

### 7.3 Turn-1 activation

A partner's reverse flow (your import row) can be dark at turn 1 and appear at turn 2
(Capua's Rome row: absent t1, "Rome 59" at t2 = 295/5 with exports unchanged). Seeded
lanes carry observed flags; the heuristic for unseeded lanes is nearest-lane.

### 7.4 Cargo: quantity-shortfall + exclusion

```
flow = f_lane × Σ_resources shipped_units × file_value
```

- Per resource: importer qty ≥ 2 → EXCLUDED; importer qty 1 → counted only if the
  shortfall (qtyX − qtyY) ≥ 2; importer qty 0 → full eff(qtyX).
  (Mamertines probe: Messana wine3 vs Consentia wine1 → 2×33 = 66 live EXACT; plain
  presence-exclusion gave cargo 0.)
- Zero-trade-value resources (stone/hemp/flax/pitch) ship at value 1 (Latium stone-3
  IS the whole Praeneste→Capua flow) but never compete in saturation.
- File value RATIOS are correct: the Roma single-unit delta chain (salt −40/2pts,
  glass +80/4pts, dyes −20, pottery −20) reads f_Freg = 20.0/value-pt EXACT across
  four resources.

### 7.5 Diminishing quantity worth (eff curve)

A resource's q-th quantity unit is worth `[1, 1, 1, 1, 0.42, 0.30, 0.28]`, then
0.28/unit. Pinned by: Capua trio eff(4)=4 exact; Campania wine 4→5 probe (Rome-lane
Δ = +14 = 33.2×0.42); Messana wine-5/7 ratio 74/65 = 1.138; horses-9 probe eff(9)=5.56.

### 7.6 Market saturation

A good's worth on a lane collapses ×0.18 when the importer's holdings of it from
COMPETING routes beat the exporter's qty (relative rule; land competitor needs qty ≥ 3).
State table from the (RomaGlass, ParthenopeGlass) probe chain → Capua row:
(1,0)=(1,1)=(1,2)=259, (1,3)=230, (3,3)=318. Symmetric witness: Neapolis→Freg fell
126→92 when its glass was removed (Rome supplies Freg too).

### 7.7 The per-lane f ladder — still open

Measured f spans **8–95** per lane+direction (Capua 33/33, Rome 50/66 totals vs 20/24.5
marginals, Kyzikos 95, julii small ports 3.4-25, Red-Sea exotic lanes ≈1) and regresses
poorly on every feature tried (building level, pop, pct, distance, rights, player flag —
R²log 0.71 best). Distance decay is dead three times over (Capua strong k23.8 and
Grumentum weak k3.56 at IDENTICAL d=17; the forced-deep Messana lane flows at full f).
The deep-water (128,0,0) trade-penalty lead was falsified by route fitting (median
|err| 41.8%). One real split is player-vs-AI per town: Praeneste→Capua = 49 when JULII
is the player vs 100 when CAPUA is (reproduced 2+3 campaigns) — but Rome→Capua is
≈290 in both. Until cracked, measured lanes carry live-calibrated f
(`CALIB.seaLaneF`), unmeasured lanes run at 33 (`seaCargoK`), and egypt (whose Nile +
Red-Sea lanes overshoot pure-law +33%) is pinned per town to its live t1 scroll totals
(`CALIB.tradeMeasuredByPlayer.ptolemaic`, 83 towns). All pins are vintage-bound.

## 8. Land trade

```
v_route = 5.27 × popX^0.0064 × popY^−0.1085 × e^(0.1355·pctX)
          × e^(0.1847·(roadX+roadY)) × (1+rvX)^0.6473 × (1+rvY)^0.3010
          × rights_tier × (1 + 0.74 × governor Trading%)
```

- Global refit on 385 live route rows (julii 105 + cyrene 15 + egypt 265), R² 0.755 —
  RESOURCE-DRIVEN; pop is nearly irrelevant (the old popX^0.488 was an Italy artifact).
- **Rights tier**: partners without trade rights earn less (Bovianum/samnites row 60 vs
  rich julii-partner rows; rights = alliances + become_protector script lines).
- Governor Trading multiplies the EXPORT component only (~74% share): Alexandria
  GoodTrader +10% probe moved every land row ×1.074.
- Land rows respond to goods edits with the same shortfall/exclusion structure
  (Campania wine 4→5: Freg +3 / Bov +2 / Malev +6, with Parthenope/Latium wine ≥ 2
  rows unmoved as exclusion controls).
- Measured towns are pinned (`CALIB.landLaneRows`: julii 26 + capua + kyzikos +
  cyrene 7); the law covers the rest.

## 9. Tribute (protectorates)

```
tribute = 50.0% of the client's pre-tribute net, ledger slots f19 (payer) → f8 (suzerain)
turn 2+ = partial, turn 3+ = full
```
20 `become_protector` pairs in RIS_Campaign_Script. Client nets are computed under AI
rules (tier laws + subsidy floor) — switching from player rules moved the julii floor
1,034 → 5,434 vs ~7,048 live-turn-3 (rest = real client growth over turns 1-3).

## 10. AI economy

- **Tier-1 subsidy floor**: AI city-state taxes ≈ CONSTANT 3,909 (R²=0.00 vs
  pop/brackets across 77 city-states) — the engine's welfare floor; it explains the
  historic K_single mystery and why AI rows were useless for player-law cracking.
- AI taxes are AFFINE per empire tier: truth = slope·model + intercept
  {1:[0.30,3309], 2:[1.78,−415], 3:[1.14,706], 4:[1.31,−919]} (n=215 ledgers).
- AI farming bonus is FLAT ×1.188 at every tier; trade/corr per-tier corrections in
  CALIB; mining gets NO AI bonus (8/8 exact); AI pays full EDU army upkeep.
- AI features drop script-destroyed government/colony buildings (phantom −40 pts/town
  fixed causally).

## 11. Public order (settlement-details panel) — cracked 2026-06-12

All rows in 5% points; the panel total is the exact sum. Validated on the julii
26-town details corpus (`jcrops/julii/po-corpus.tsv`) cross-checked against
`save_Julii1.sav`'s settlement `orderBreakdown[]` (garrison/squalor/distance/culture
idx 0/10/11/12 match 26/26), out-of-sample on the egypt 80-town panel set.

```
PO = 100 (base)
   + garrison    5 × min(16, floor(70 × men/pop))      men = EDU soldiers×4, no officers
   + law         5 × (EDB law_bonus + governor Law)    LoyaltyLevel & STRating excluded
   + happiness   5 × Σ EDB happiness_bonus             FULL predicate eval (see below)
   + governor    5 × influence stat
   + health      5 × (EDB health pips + gov Health)
   − squalor     5 × max(0, floor((pop + max(0, pop − squalourPop[level]))/2300) + gov Squalor)
   − distance    5 × floor(max(0, d − 10) × 0.2 / 5)   d = px to capital
   − culture     20 + 10 (leader) when region majority religion ≠ faction religion
                 and no colony ≥ level 2 (Paestum: dorian majority, colony_2 → exempt)
   + tax         vs low: 0 / −30 / −50 / −70
```

- **Happiness is EXACT 26/26** once three predicate families evaluate correctly:
  `majority_religion X` (region's highest rel_X_N hidden resource),
  `faction_religion_X` (descr_sm_factions "default religion"), and the exact
  empire-size tier. This explains the two historic outliers: Rome +20 (capital size5
  −8 happiness line) and Paestum −70 (governmentC −8 "majority_religion dorian and not
  faction_religion_dorian" + colony −4).
- Squalor constants are descr_cultures: "squalor rate" 2300, per-level "squalour pop"
  above which each pop counts DOUBLE (village 1800 / town 6000 / large_town 9000 /
  city 17000 / large_city 28000). Egypt 85/86 exact.
- Distance multiplier 0.2 = descr_cultures "capital distance multiplier" (all RIS
  cultures); verified to d=339 (Berenike-Deire −65).
- Garrison K=70 with men = base soldiers ×4 (HUGE size): julii 25/26, egypt 74/86
  exact (rest ±1 pt). 80% display cap. Practical: +1 PO point per pop/70 men.
- Influence row = the governor's card Influence stat verbatim (24/26 with save stats).
- The display caps at 200 (Rome stores 240, shows 200).
- The save stores garrison/squalor/distance/culture points directly in the settlement
  block (`orderBreakdown`) — a calibration save makes those rows exact.

## 12. Method facts worth keeping

- Cross-save trait comparison is dead: 24/26 governors reroll trait POINTS at campaign
  start (±5-10); display level = EDCT threshold on those points + the L1 floor.
- `descr_strat` region comments (`; Region`) match the pixel goods map 5546/5546 — a
  comment-parsed resource map is safe.
- Engine turn noise on sea rows is ±3-5/lane between identical campaigns.
- Per-town econ values exist NOWHERE in the save (whole-file scan) — settlement scroll
  screenshots are provably the only per-town income data source.
- Financial Overview is STALE until a bracket toggle; settlement scrolls are live.
- One settlement may hold only ONE general at campaign start (extras flee — validator
  in the app).

---
*Companion file: [INCOME_MODEL.md](INCOME_MODEL.md) (earlier spec, partially
superseded by this document). Constants: `src/incomeModel.js` CALIB · PO:
`src/poModel.js` · tax H lock: `src/taxCalib.js`.*
