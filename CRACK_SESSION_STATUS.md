# Long-running crack session — status (auto-update)

## Latest: 0.9.399 shipped — treasury parser factored + exposed

### What I've done in this session (chronological)

| Ver | Done |
|---|---|
| 0.9.388 | LZ4+DDS+DXT1 portrait decoder |
| 0.9.389 | Hash includes lastName+faction, honors descr_strat `portrait_index` |
| 0.9.390 | Dead = greyscale portrait, B/C/D → roman numerals, age fallback |
| 0.9.391 | Marble CSS revert (canvas race-fixed) |
| 0.9.392 | descr_cultures.txt portrait mapping (RIS Macedon → greek portraits) |
| 0.9.393 | Auto-fit-to-view in tree |
| 0.9.394 | Hover tooltips + cleaner sibling connector lines |
| 0.9.395 | Mac build via repackaged Electron zip |
| 0.9.396 | Portrait crack backend (134/143) |
| 0.9.397 | UI integration: coord (x,y) bridge → save-derived portraits |
| 0.9.398 | Seed-modulo fallback → 143/143 (100%) |
| 0.9.399 | parseFactionTreasuries factored + exposed as `factionTreasuries` IPC return |

### What I've verified this evening

- **Treasury**: already in Provincia for imperial campaigns (23 records, player at idx 0, surfaced in Wealth widget via `liveTreasury`). The "Spain T1 = 2500 at 0x2c5e1" memory was **misidentified** — that value is a settlement population threshold, not faction treasury.
- **Section type registry**: lives at 0x3310 in vanilla T0 (memory said 0x500 for RIS — version difference). 106 entries confirmed. FACTION_ECONOMICS = id 91, count 36 (RIS) / 20 (vanilla T1 classic).
- **Movement points / queue parser** — already shipped previously.
- **Character diff between saves**: works for vanilla role-anchored saves; **Alexander campaign saves use a different format** — parseCharacterExtras finds 0 chars. Would need Alex-specific parsing.
- **Religion percentages** — already extracted, returned as `religionByCity` IPC field. UI bar not yet added.

### Crack targets still blocked

- **Diplomatic relations owner-mapping** — need in-game diplomacy screenshot to back-derive which 219-zone belongs to which faction.
- **Section walker for arbitrary section types** — the simple `{u32 self_ptr, u32 size}` invariant doesn't apply on this save format. Would need a different grammar.
- **Wife/child portrait pool** — vanilla `data/ui/<culture>/portraits/family/` only has one of each. In-game "unique faces" the user thought they saw may be RIS-specific or misperception.

### Easiest next wins (if user wants more)

1. Surface religion bar in RegionInfo (data already in `religionByCity`)
2. Add Alex-campaign-aware character parser (different culture names / role strings)
3. Build v1Chars → familyTreeMaps integration (would let family-tree use post-T0 family relationships)
4. Per-faction trait list from save (descr_strat traits are starting-only; saves have current)

I'll keep this status file updated and push it to your phone periodically.
