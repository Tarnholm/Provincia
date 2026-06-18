# Provincia Trade Model — How It Works & Current Accuracy
*Last updated 2026-06-18 (v0.9.1165). All formulas cracked from controlled in-game experiments + live scroll captures (RIS mod, turn 1).*

A settlement's **Trade** income = the sum, over all its trade routes, of each route's value.
Routes are **one-directional and per-settlement**: a town **exports** to some partners and **imports** from others. The same physical link appears on *both* towns' scrolls (one as an export row, the other as an import row). There are three kinds: **land**, **sea**, and **river**.

---

## 1. Land trade

```
land(X→Y) = (2 + 0.2·tradePct_X) · (exportCargo + 0.5·importCargo + const) · roadMult · rights
```
- **tradePct_X** = exporter's trade-building level (market chain: trader 1 … curia 5).
- **exportCargo** = Σ qty·value of X's goods that Y lacks; **importCargo** = the reverse (×0.5).
- **roadMult** = road network bonus. **No distance penalty** — land trade is road-based.
- **rights** = ×3 with trade rights, ÷3 without (own/agreement = full).

**Accuracy: ✅ ~3%.** Rome's land routes verified live: Camerinum 60/60, Reate 64/65, Falerii 96/93, Praeneste 112/111, Cosa 153/150.

---

## 2. Sea trade — VALUE (how much a route is worth)

```
sea(X→Y) = K · landRate_X · dist^−0.89 · (exportCargo + 0.35·importCargo + const) · popX^0.13 · popY^0.06 · rights
```
| term | value | how it was cracked |
|---|---|---|
| **K** | 13 | fit |
| **landRate_X** | 2 + 0.2·tradePct_X (**linear**) | Carthage market great_forum→trader experiment (every route scaled ×landRate^1.0) |
| **dist** | depth-weighted **white-port** path: shallow ×1, medium ×2, deep impassable; port = white pixel in map_regions, settlement = black pixel | forced-corridor experiment (Issa walled to one corridor) |
| **dist exponent** | **−0.89** | same corridor (shallow 546 → medium 294, medium = 2.0× distance) |
| **cargo** | export + **0.347**·import + const | amber qty experiment (linear in qty; return-cargo term) |
| **const** | 9.86 | amber dilution (Kyrene & Carthage) |
| **popX / popY** | ^0.13 / ^0.06 (weak) | Arsinoe pop ×4.74 experiment |
| **rights** | 1 (own/agreement) or 0.5 (foreign) — **value only** | Quietus guide + Rome/Capua |

**Accuracy:**
- **Open-water crossings: ✅ ~1-2%** (Carthage→Aspis +2%, →Eryx ratio 1.01). Verified on the map: sea routes run **straight** across gulfs, which is exactly what the white-port distance computes.
- **Coastal / short routes: ⚠️ ±10-16%** (value-law noise — small cargo/pop residuals, not a pathing problem).

---

## 3. Sea trade — FORMATION (which routes a port forms)

- Each port fills **slots_X = built port chain level** (e.g. dockyard = 3) with its **most profitable** partners — **not** its nearest.
- Selection profit = `dist^−0.89 · (cargo+const) · popY^0.06` — **rights are NOT applied to selection** (they only scale the realized value).
- A port also shows **import rows** for any partner whose own slot set includes it.

**Accuracy: ✅ routes exact.** Carthage exports = {Aspis, Hippo Diarrhytus, Eryx} = game; Rome exports = {Fregellae, Capua} = game (Capua picked over distant same-faction Neapolis).

---

## 4. River trade (Nile, etc.)

- River bodies are thin sea bodies; river ports lane near-all-pairs within the body.
- **Value now uses the same sea law** (channel distance + cargo) — previously a flat size-only law (every Nile route from a city showed the same number).

**Accuracy: ⚠️ −1% to +22%.** Alexandria→Sebennytos 658 vs 663 (**−1%**, exact); →Tanis +22%; →Mendes −15%. Alexandria total +9%.

---

## 5. Governor

The exporter's **governor trading trait** multiplies the **export** leg ×(1 + 0.74·trading%). The import leg (partner's export back) is unaffected. (Captures can be gov-in or gov-out; gov-out is preferred for calibration.)

---

## Accuracy at a glance

| Component | Status | Typical error |
|---|---|---|
| Land trade | ✅ | ~3% |
| Sea value — open water | ✅ | ~1-2% |
| Sea value — coastal/short | ⚠️ | ±10-16% |
| Sea formation (route picks) | ✅ | exact route set |
| River value | ⚠️ | −15% … +22% |
| **Faction/settlement aggregates** | ✅ | Kyrene −0.5%, Carthage −3%, Rome +9%, Alexandria +9% |

---

## The last mile to 0%

1. **Delta/river distances** — the white-port Dijkstra takes shortcuts across compact deltas (Tanis underestimated) and **blocks** some channel-locked cities (Mendes → bad BFS fallback). Fix: force river-lane distance to follow the channel. *(This is the single biggest remaining error.)*
2. **River multiplier** — currently 1.0; needs a **gov-out** Nile capture to calibrate exactly.
3. **Coastal value noise** — ±10-16% on short sea routes; a cargo/pop fine-tune, not a structural problem.

Everything structural is cracked and shipped; the residuals above are calibration/pathing refinements.
