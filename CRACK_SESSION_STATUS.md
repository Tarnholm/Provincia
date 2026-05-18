# Long-running crack session — FINAL STATUS

## Versions shipped tonight

| Ver | What |
|---|---|
| 0.9.388 | LZ4+DDS+DXT1 portrait decoder |
| 0.9.389 | Hash includes lastName+faction, honors descr_strat `portrait_index` |
| 0.9.390 | Dead = greyscale portrait, B/C/D → roman numerals, age fallback |
| 0.9.391 | Marble CSS revert |
| 0.9.392 | descr_cultures.txt portrait mapping |
| 0.9.393 | Auto-fit-to-view in tree |
| 0.9.394 | Hover tooltips + cleaner sibling connector lines |
| 0.9.395 | Mac build via repackaged Electron zip |
| 0.9.396 | Portrait crack backend (134/143) |
| 0.9.397 | UI integration: coord (x,y) bridge → save-derived portraits |
| 0.9.398 | Seed-modulo fallback → 143/143 (100%) |
| 0.9.399 | parseFactionTreasuries factored + exposed |

## Cracks completed tonight

### ✅ Portrait UUID linkage (143/143)
- **+280 of 354-byte extended record** = portrait UUID
- Match against u32-prefixed portrait pool entries to get exact path
- Seed-modulo fallback for the few procedural/rebel chars without a stored UUID
- Save's coords at +288/+292 bridge to descr_strat character x,y
- Renderer uses save-derived portrait when bridge hits, hash fallback otherwise

### ✅ Section type registry (vanilla T0)
- Starts at **0x3310** in vanilla T0 (was 0x500 for RIS — version difference)
- 106 entries
- FACTION_ECONOMICS = id 91, count 36 (RIS) / 20 (vanilla T1 classic)
- Full ID → name mapping in `dig-section-registry-v3.js` output

### ✅ Region-record walker
- Region records identified via paired self-pointer signature: `u32(P) == P && u32(P + 8) == P + 8`
- Layout: `[self_ptr][region_uuid][self_ptr][region_id][per-region data...]`
- region_id at +12 matches `parseFactionTreasuries.regionIds`
- Unblocks future per-region cracks (population, garrison, building list, etc.)

### ✅ Treasury parser refactored
- `parseFactionTreasuries(buf)` in `saveCrackerExtras.js` — reusable
- Works on vanilla imperial saves (Macedon T0 → 23 records, player at idx 0)
- Exposed as `factionTreasuries` in IPC return value
- Existing Wealth widget continues working via `treasuryByFaction` for backward compat

### ✅ Misidentification correction
- The memory's "Spain T1 treasury = 2500 at 0x2c5e1" is **wrong** — that value is a settlement population threshold (surrounded by cascading float tiers 16.0 / 3.0 / 2.0 / 1.0). Real treasury lives in major-faction records.

### ✅ Wife/child portrait — confirmed not crackable
- Vanilla `data/ui/<culture>/portraits/family/` has ONE wife.tga / son.tga / daughter.tga
- The engine uses the same file for all wives/sons/daughters per culture
- Save's portrait pool only contains `/generals/` subfolders
- Current Provincia behavior (using family/*.tga) matches the engine

## Blocked / hard

### Diplomatic relations owner-mapping
- Marker found, 16-byte entries decoded
- BLOCKED: the OTHER faction in each relationship isn't in the entry
- Needs in-game diplomacy screenshot to back-derive owner-zone → faction mapping

### Full TAW section walker
- The simple `{u32 self_ptr, u32 size}` invariant doesn't apply
- Region records have paired-self-pointer signature instead
- Other section types may have other signatures — needs per-type investigation

### Alex campaign character parsing
- parseCharacterExtras finds 0 chars in Alexander campaign saves
- Likely uses a different role-string format or different sections
- Would need format-specific parsing to support Alex character diffs

## Recommended next session

1. Wire `factionTreasuries` into a "Faction Economy" widget (data already extracted)
2. Use region-record walker to extract per-region data (population, garrison count, etc.)
3. Surface religion-percentage bars in RegionInfo (data already in `religionByCity`)
4. Add character traits-from-save to family tree tooltips (currently shows descr_strat traits only)

Sleep well — see you when you're back.
