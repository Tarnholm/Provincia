# RIS Income Model — Cracked Engine Laws

Reverse-engineered from live RTW:Remastered (RIS mod) ledgers, settlement scrolls and
controlled in-game experiments, 2026-06-09 → 06-11. All constants live in
`src/incomeModel.js` CALIB; the live regression guard is `src/incomeModel.live.test.js`.

## Validated accuracy (current mod vintage)

| scope | result |
|---|---|
| Julii (26 towns, player) | net ±1.5% vs live ledger |
| Cyrene (7 towns, player, out-of-sample) | income −4% (residual = sea trade) |
| AI factions (n=215, one fresh turn-1 save) | total income median 3.7%, p90 11.3% |
| farming / wages / mining | exact (mining 8/8 within 2%) |
| army upkeep | ±1% (calibrated EDU) |

## The laws

### Taxes (player)
```
taxes_town = 0.4559 · W(pop) · rate · gov  +  3.9 · P · gov
W(pop) = 400·(ln pop − 4.4)        rate = 0.8 / 1.0 / 1.2 / 1.5
P      = Σ EDB taxable_income_bonus points for the town's buildings — ALL FLAT,
         never percentages (the historic “taxable %” reading was wrong)
gov    = 1 + governor TaxCollection% (trait-parsed; effect levels are noisy ±5%, task #16)
```
The flat term is rate-independent (verified on full bracket sweeps of 5 towns).
Empire-size hinterland lines select by exact tier (`empire_sizeN` events, exclusive
ranges by settlement count). The hard-difficulty human multiplier 0.92 is folded into
the constants (H/H only). Capital towns: Rome reads ~13% above the law — unexplained
(capital hinterland +50 line or the PO≥120 order_income bonus; needs another capital read).

### Admin income (= the financial overview's "other" row, econ slot f9)
```
admin_town = (4 + 0.75·min(mgmt,3) + 0.25·max(0,law))% × (taxes+farming+mining+trade)
```
Shown in-game as the scroll's “Admin — Governor” row. No governor → no admin.

### Corruption (= "other" expenditure, slot f22)
```
corr% = 0.2261·(d−6) + 0.0061·(d−6)²   of town gross (incl. admin), capped at 90%,
linear extension beyond d=66 (calibration range), d = tile distance to capital.
ZERO for the capital and for towns governed by an OFFICE holder
(Quaestor/Aedile/Praetor/Propraetor/Consul/Proconsul/Censor — live-verified).
```

### Farming
```
farm_town = 73.6 · (region fertility + farm building levels + governor Farming pts)
(× 1.2 factionwide for the Hanging Gardens owner)
```
The displayed farms line carries a per-region random HARVEST roll each turn
(Poor/Average/Excellent) — season-noise around this exact average.

### Trade
Land (per-route): `v = 2.7478·popX^0.488·e^(0.1692·tradePctX) × e^(0.38·roadY)·(rvX+rvY)^0.30·popY^−0.34`
summed over adjacent NOT-AT-WAR regions (neutrals trade; descr_strat 199=ally, 201=war —
the relationship lines appear in either order, parse symmetrically). rv = Σ qty×tradeValue
(descr_strat resource lines have an explicit quantity column).
Sea (aggregate, julii-anchored): `1.1169 · Σ_ports gTrade·rv·√(seaPartners)`.
Sea per-LEG law (researched, not yet wired): two directional legs per lane;
`v_leg ≈ k · e^(0.127·pctX) · cargo`, cargo = exporter's qty-goods the partner LACKS
(exclusion rule, icon-verified), k_export ≈ 17-24, k_import ≈ 7.2, distance irrelevant.
UNKNOWN: lane formation (one-way lanes are ~10× weaker; needs port partner-list scrolls).

### Wages & army upkeep
```
wages = 200·named characters + 50·admirals (exact)
army  = Σ EDU stat_cost upkeep × category scale (inf 0.976 / cav 1.186 / ships excluded)
```
No hidden +400/turn hard bonus exists (treasury deltas equal the ledger net).

### AI factions (asAI path)
- farming/trade: × 1.188 flat (no tier dependence), mining: NO bonus, no 0.92 malus.
- taxes: affine per tier `truth = a·neutral + b`; tier 1 is the SUBSIDY FLOOR —
  AI city-states get ≈3,909 tax CONSTANT regardless of size (R²=0.00, n=77).
- The RIS campaign script destroys government/colony buildings in all AI settlements
  at start — AI features must exclude them.
- trade/corruption carry measured per-tier corrections (per-faction lane variance remains).

## Calibration saves
A fresh turn-1 save (before any end-turn/console/character move) provides: all factions'
rolled traits, exact stored PO per settlement (= the in-game % verbatim; bracket deltas
relative to low are 0/−30/−50/−70), governor↔town bindings, and committed pops.
End-turn rerolls 24/26 governors' traits — cross-save comparisons are invalid.

## Remaining unknowns (each with a ready experiment)
1. **Sea lane formation** → partner-list scrolls from Pisae/Grumentum/Sena (task #15).
2. **Trait effect levels** → ~10 governor cards vs their towns' tax/admin lines (task #16):
   displayed level = descr_strat seed ordinal, but income effects run hotter than seeds.
3. **Rome capital bonus** → one capital tax read on a second faction.
