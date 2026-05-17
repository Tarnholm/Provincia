# Provincia Save Cracker — Comprehensive Field Map

Last updated: 2026-05-17 (sessions 120-169)

This is the authoritative summary of all decoded RTW Remastered save fields,
validated via controlled experiments on user's vanilla, Alexander, and other saves.

## Universal save structure

All RTW Remastered saves (vanilla Imperial, Alexander, BI, mods) share the same
binary format with these zones:

```
0x0000  Magic (0a 07 00 00 for Feral Remastered, 0a 04 ... for classic)
0x0100  Section table (32-byte entries, section indices + metadata)
0x0500  Section type registry (106 type names + counts, format:
        <ASCII name>\0<u32 count>)
0x0de0  Campaign path UTF-16 string ("campaign/imperial_campaign", etc.)
0x0e80  Per-faction flag arrays (21 u32 each, value 0 marks player)
0x1190  Settlement-owner table (12-byte stride, static descr_strat snapshot)
0x14a0  Event log (1096 × 12-byte records)
0x4800  Character family relationship records (14 markers)
0x5400  Historic events table (~50 events, type+specific+trailer)
0x5cf0  Tile-event records (24-byte stride)
0x7b88  Wonders of the World (7 ASCII names)
0x7c20  Region border polygons (~50 self-pointer records)
0xcff0  Diplomatic relations table (380 records × 115 bytes)
0x1943f Settlement records (~103 settlements, walked via "default_set" markers)
0x37000 More settlements + character ancillaries + merc pools
0x3e000 Mercenary pool definitions by region
0x40000+ Unit records (649 units in vanilla T4, type + location + state)
```

## Per-settlement decoded fields

### Stats block (583 bytes BEFORE the name pstr16)

| Offset | Type | Field | Validated by |
|--------|------|-------|--------------|
| +0 | u32 | **OWNER faction-id** | Epidamnus enslave (0→11 Macedon) |
| +12 | u32 | settlement level (1-6) | Cross-validation |
| +148 | u32 | **public order** (0-100) | Tax-change experiments |
| +220 | u32 | building-related small int | Inferred |
| +360 | u32 | population variant | Adjacent to +548 |
| +456 | u32 | **income per turn** | Faction economy totals |
| +548 | u32 | **POPULATION** | Epidamnus enslave (6199→3078 = halved) |

### Settlement record body

| Field | Location | Validated by |
|-------|----------|--------------|
| Name | UTF-16 pstr16 at start | All settlements |
| Gap to default_set | 18 (vanilla) / 19 (Alex) / variable mods | Walker tries 18-25 |
| default_set marker | pstr16_asciiz("default_set\0") | Universal |
| Tile X | u32 at default_set+14+12 | All 103 vanilla settlements |
| Tile Y | u32 at default_set+14+16 | All 103 vanilla settlements |
| Construction queue | pstr16 names INSERTED before building list | Port_buildings queue experiment |
| Recruitment queue | pstr16 unit-type names INSERTED before building list | Hoplites queue experiment |
| Tax rate | byte INSIDE settlement post-building (Pella at ~0x10b5b) | Tax inc experiment (1→2) |
| Siege state | ~592 bytes appended on siege | Byzantium siege experiment |

### Building list (after default_set + 61-byte header)

Each building: pstr16_asciiz_name + 78 bytes data.

| byte+offset | Field | Validated by |
|-------|-------|--------------|
| +0..3 | hash/UUID | Random per building |
| +4 | **building TIER** (0-4 per EDB) | Pella core upgrade (t2→t3) |
| +5..24 | hash digest fragment | Stays stable |
| +25 | per-settlement constant byte | Identical per settlement |
| +33 | 0x64 constant (=100) | Universal |
| +50..53 | 0x15 section tag | Universal |
| +76 | **cultural origin** (1=matched, 2=neutral, 3=foreign) | Spanish/Punic settlements show 3 |
| +77 | 0x00 or 0xff | Padding |

## Per-unit decoded fields

Unit records: ASCII type + location pstr16 + state.

```
[24 bytes header: 0x15 section tag + UUID + counters]
[ASCII unit type name]
[pstr16 UTF-16 location/region name]
[state header ~16 bytes including current_soldiers (+12) and max (+16)]
[N × (9-byte per-soldier record: health flag, experience, condition)]
[trailer]
```

| Field | Location | Validated by |
|-------|----------|--------------|
| Type | ASCII pstr | 649 units catalogued |
| Location | UTF-16 pstr16 region/settlement name | Mauretania, Hispania, etc. |
| Current soldiers | u32 at state+12 | greek hoplite militia=160, etc. |
| Max soldiers | u32 at state+16 | Damaged generals show < max |
| Per-soldier record | 9 bytes × max_soldiers | Battle outcome changes these |

## Per-character decoded fields (partial)

| Field | Location | Validated by |
|-------|----------|--------------|
| Family relationships | 0x4800-0x5400 | Session 133 markers |
| Movement points remaining | 0x4d4b u8 in 0x4800 zone | Boat move + attack saves (35→0) |
| Can-act flag | 0x4ec0 u8 | Same saves (1→0) |
| Character record itself | In units zone (NOT 0x4800) | Adoption experiment showed |

## Faction-index mapping (vanilla Rome)

Validated via descr_strat cross-reference:

```
0  romans_julii        7  parthia          14 dacia
1  romans_brutii       8  parthia          15 numidia
2  romans_scipii       9  pontus           16 thrace
3  romans_senate      10 gauls             17 scythia
4  macedon            11 germans           18 SPAIN (player in Spain test campaign)
5  egypt              12 britons           19 ...
6  seleucid           13 armenia           20 slave/rebels
```

Note: Each campaign (vanilla, Alex, BI, mods) has its own faction list and
mapping. Load from descr_strat.txt for proper labeling.

## Universal section type counts (vanilla T4 example)

From section registry at 0x500-0xde0 (counts vary per save state):

```
FACTION                       34 instances
ECONOMICS_DATA                 4
CHARACTER_RECORD              20
SETTLEMENT                    14
AI_SENATE_FACTION             14
MAP_REGIONS                    6
SOLDIER_PERSISTENT             5
RECRUITMENT_ITEM               6
BUILDING_CONSTRUCTION_ITEM     3
WONDER_SHROUD                  1
FOG_OF_WAR_TABLE               1
NAME_DB                        1
STRATEGY_DATE                  1
... and 95 more section types
```

## Validated game events

Effects detectable from save state changes:

| Event | Detection method | Validated |
|-------|-----------------|-----------|
| Settlement capture | stats_block+0 changes from rebel to capturer | ✓ Epidamnus, Byzantium |
| Enslavement | stats_block+548 halved | ✓ Epidamnus 6199→3078 |
| Building upgrade complete | byte+4 of building tier increments | ✓ Pella t2→t3 |
| New building constructed | New pstr16 name added to settlement | ✓ Pella + port_buildings |
| Tax rate changed | byte in settlement post-building area | ✓ Pella 1→2 |
| Character moved | character zone byte 0x4d4b → 0 | ✓ Boat + attack |
| Battle won (enemy destroyed) | File shrinks; enemy unit records removed | ✓ Rebel army gone |
| Siege started | ~592 bytes added to besieged settlement | ✓ Byzantium siege |
| Unit casualties | Per-soldier 9-byte records change | ✓ Battle outcomes |

## Open puzzles

These require further work or new save data:

1. **Treasury per faction** — 34 FACTION records exist but their exact file
   location remains elusive. Treasury isn't at any stable u32 offset in
   the first 1.3 MB; likely buried in a per-faction packed record.

2. **Construction queue progress (turns to completion)** — known to exist
   somewhere but specific offset not located.

3. **Religion percentages per settlement** — known to exist but offset
   not pinpointed.

4. **Per-unit weapon/armor upgrade levels** — separate from experience,
   stored somewhere in the ~1000 bytes of unit state.

5. **Full block-index → faction mapping in diplomatic table** — 7 of 20
   blocks anchored (Romans×4, Spain, Carthage, Rebels); 13 still open.

6. **Trade routes** — which settlements trade with which.

7. **Settlement growth rate** — population growth modifiers.

## Cracker methodology recap

The most successful approach for finding fields:

1. **Controlled experiments**: Two saves differing only by ONE in-game action
2. **Zone-focused diffs**: Group changes by file zone (header / settlements /
   units / etc.)
3. **Look for small-magnitude diffs (≤8 bytes)** — these are usually field
   changes vs structural reshuffling
4. **Filter out pointer shifts**: 2-4 byte changes at regular intervals are
   often file-position-dependent pointers
5. **Cross-reference with descr_strat / EDB** to interpret meaning

Sessions 160-169 (today) used this approach for 10+ surgical field
identifications.
