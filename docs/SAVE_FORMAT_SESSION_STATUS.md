# Long-running crack session — FINAL (post-bug-fix)

## Versions shipped (18 total: 0.9.388 → 0.9.405)

### Latest milestone: v0.9.405 — record-owner via captain banner

**Bug found and fixed:** Provincia's Wealth widget was assigning the WRONG faction's treasury per row in RIS imperial saves. The legacy assumption "player record always at idx 0" was incorrect — for a Macedon-played RIS save, rec 0 is actually `carthage`, not `antigonid`.

**Crack:** Each faction record's body contains `captain_card_FACTIONNAME.tga` paths for its captains. Counting these gives an accurate record→faction mapping. Validated on Macedon T0 RIS:
- rec 0 = carthage (3 captains)
- rec 1 = romans_julii (3 captains)
- rec 2 = ptolemaic (2 captains)
- rec 3 = seleucid (1 captain)
- rec 11-17 = minor factions (1 captain each)
- 13 records have no captain banners — likely small NPCs + the player faction itself

**Backend exposed as:** `factionRecordOwners` IPC field, `identifyFactionRecordOwners(buf, factionRecords)` in `saveCrackerExtras.js`.

## All cracks completed this session

| Topic | Status |
|---|---|
| Portrait UUID linkage (143/143 chars) | ✅ Done — +280 in 354-byte extended record |
| Per-faction diplomacy extraction | ✅ Done — `05 00 24 39` marker, 240+ relations validated |
| Region-record walker | ✅ Done — paired self-pointer signature |
| Treasury parser refactor | ✅ Done — `parseFactionTreasuries()` reusable |
| Section type registry location | ✅ Done — 0x3310 in vanilla T0 |
| Faction-record owner via captain banner | ✅ Done — `identifyFactionRecordOwners()` |
| Save-derived age + region in family tree | ✅ Done — coord (x,y) bridge |
| Mac build via Electron repack | ✅ Done |
| RIS dummies UX | ✅ Done |
| Misidentification corrections | ✅ Done (Spain T1 = 2500 was settlement pop, not treasury) |
| Wife/child portrait | ✅ Confirmed not crackable in vanilla |

## Still blocked (need ground truth)

- **Diplomatic relation owner-mapping** (which factions each relation is between) — needs in-game screenshot
- **Faction leader UUID location** — char UUID list found at stride 354 in record bodies, first char is plausibly leader, but player's record can't be identified yet
- **Alex campaign character anchor** — no role strings, different format
- **Region_id → region_name mapping** — region names not adjacent to region records in save

## Files touched

- `src/saveCrackerExtras.js` — 5 new exports: `attachMapCoords`, `resolvePortraitsByCharacter`, `parseFactionTreasuries`, `parseFactionDiplomacy`, `identifyFactionRecordOwners`, `findRegionRecords`
- `src/FamilyTree.js` — coord bridge, save-derived age, dummies hidden
- `src/App.js` — wealth widget fix + state for new IPC fields
- `main.js` — IPC plumbing
- `~20 cracker scripts` in `scripts/save-cracker/dig-*.js`
- `5 memory files` updated

The cracking is in good shape. Most remaining work needs your input (ground truth for owner-mapping, etc.) or is UI integration (religion bar, diplomacy panel, etc.).
