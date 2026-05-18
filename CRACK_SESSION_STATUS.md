# Long-running crack session — FINAL FINAL STATUS

## Versions shipped tonight (15 total)

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
| 0.9.400 | Region-record walker (paired self-pointer signature) |
| 0.9.401 | RIS `dummies` faction hidden from family-tree dropdown |
| 0.9.402 | Per-faction diplomacy extraction (240+ relations parsed) |

## Cracks completed tonight (in order of impact)

### 🎯 Portrait UUID linkage — 143/143 chars
- +280 of 354-byte extended record = portrait UUID
- Match against u32-prefixed portrait pool entries to get exact path
- Seed-modulo fallback for procedural/rebel chars
- Coord (x, y) bridge: descr_strat char x/y ↔ save's extX/extY at +288/+292
- Renderer uses save-derived portrait when bridge hits

### 🎯 Per-faction diplomacy
- Marker `05 00 24 39` at +(244 + 4×regionCount) of major faction records
- u32 count + 16-byte entries: `{relationUuid, class, attitude, tag=0x00010101}`
- 100% tag-validated across 240+ relations in Macedon T0
- Each relation UUID is GLOBALLY UNIQUE (verified — 283 UUIDs across 23 records, zero duplicates)
- LIMITATION: each entry doesn't contain the OTHER faction's ID. Memory's "mirror entry" hypothesis refuted by this run (would need ground-truth diplomacy screen to back-derive)

### 🎯 Region-record walker
- Paired self-pointer signature: `u32(P) == P && u32(P + 8) == P + 8`
- Layout: `[self_ptr_A][region_uuid][self_ptr_B][region_id][per-region data]`
- region_id matches `parseFactionTreasuries.regionIds`
- 426 records in Macedon T0 (some false positives but unique IDs match)

### 🎯 Treasury parser refactored
- `parseFactionTreasuries(buf)` in `saveCrackerExtras.js`
- Vanilla imperial: 23 records, player at idx 0
- Treasury + start-of-turn snapshot + regionCount + region IDs
- Existing Wealth widget already consumes this via `treasuryByFaction`

### 🎯 Section type registry location
- Vanilla T0: at **0x3310** (memory said 0x500 for RIS — version difference)
- 106 entries: FACTION_ECONOMICS id 91, count 36 (RIS) / 20 (vanilla T1 classic)

### 🎯 Misidentification correction
- The memory's "Spain T1 treasury = 2500 at 0x2c5e1" — that value is a settlement population threshold (surrounded by cascading float tiers 16.0 / 3.0 / 2.0 / 1.0). Real treasury lives in major-faction records.

### 🎯 RIS dummies UX
- Hidden from family-tree dropdown unless player is dummies
- dummies has -50000 denari, dies after T1 — surfacing it confused users

### 🎯 Wife/child portrait — confirmed not crackable
- Vanilla `data/ui/<culture>/portraits/family/` has ONE wife.tga / son.tga / daughter.tga
- The engine uses the same file for all wives/sons/daughters per culture
- descr_strat doesn't specify per-wife `portrait_index` either
- Current Provincia behavior matches the engine

## Still blocked / outstanding

### Diplomatic relations owner-mapping
- Extraction works (240+ relations validated)
- BLOCKED: which TWO factions each relation is between is unknown
- Needs in-game diplomacy screenshot for ground truth

### Faction leader / heir UUID
- Tried scanning faction records ±2000 bytes for char UUIDs — only 1/10 matched
- The 143-char roster from parseCharacterExtras may miss leaders
- Or leader is stored as a different type (not character UUID)

### Full TAW section walker
- Simple `{u32 self_ptr, u32 size}` invariant doesn't apply
- Region records use paired self-pointer (cracked)
- Other section types may use other signatures

### Alexander campaign character parsing
- parseCharacterExtras finds 0 chars in Alex saves
- Different role-string format
- Would need format-specific parsing

## Recommended next session

1. **Wire `factionDiplomacy` into a UI panel** — show per-faction relation count + class breakdown
2. **Surface religion bar** in RegionInfo (data already in `religionByCity`)
3. **Crack faction leader UUID** with a known save where you can read off the leader name in-game
4. **Build per-region data extraction** using the region-record walker (population, garrison composition, building list)

Sleep well — see you when you're back.
