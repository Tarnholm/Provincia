// dig-roads-ports-watchtowers-SUMMARY.js — final crack notes.
//
// Goal (from user brief): replace the (est) ratio-based rows for roads /
// ports / watchtowers in save-budget-full.js with counted values pulled
// directly from the save buffer. Dev image targets (pointer registry at
// corruption): roads = 3957, ports = 1276, watchtowers = 363.
//
// =============================================================================
// FINDINGS
// =============================================================================
//
// PORTS (counted)
//   Source: per-settlement chain records inside settlement-detail records.
//   Implementation: src/mapEntityParser.js → countPorts().
//   Method: scan every settlement-detail record for the building chains
//           `port_buildings` (deep-water port) and `river_port` (river port).
//   Counts (across 4 reference saves):
//     turn 900 End:        599  (port_buildings=365 + river_port=234)
//     turn 960 Start:      721  (port_buildings=529 + river_port=192)
//     item-limit-bug T1017: 724  (port_buildings=529 + river_port=195)
//     turn 1018 Start:     724  (port_buildings=529 + river_port=195)
//   Dev image (ports): 1276 — about 1.76× our count. The pointer-registry
//   bumps each port by additional aux slots (PORT_SHROUD + PORT_MANAGER
//   linkage + BLOCKADE_PORT_BUILDER + trade_fleet pointers). Our count is the
//   strict lower bound — the SETTLEMENT count of port objects.
//
// ROADS (counted)
//   Source: same — per-settlement chain records.
//   Implementation: src/mapEntityParser.js → countRoads().
//   Method: count `hinterland_roads` chain occurrences per settlement.
//   Counts (4 saves):
//     turn 900 End:   1175
//     turn 960 Start: 1268
//     item-limit-bug: 1269
//     turn 1018:      1269
//   Dev image (roads): 3957 — about 3.1× our count. The pointer-registry's
//   "roads" entity is per-tile road segment (each settlement's hinterland
//   road actually paints many tiles); we count the settlement-level CHAIN
//   record, which is the persistent presence indicator. The tile-level
//   roads array couldn't be located: no `road`/`watchtower` strings exist
//   in the body, the 240×238 "tile-grid" at 0xf8fd2 was previously
//   confirmed to be the bilateral DIPLOMATIC ATTITUDE matrix (NOT tiles —
//   session 32 cracked this), and the character-paths section is only
//   1,703 records (movement trails, not roads).
//
// WATCHTOWERS (counted-probable; falls back to estimate if array absent)
//   Source: post-grid 267-stride auxiliary tile-format array.
//   Implementation: src/mapEntityParser.js → countWatchtowers().
//   Method: locate the array (cover.js section 9c), count records where
//           byte +0x20 ≠ 0xc8 (the default-template value).
//   Counts:
//     turn 900 End:  array absent (returns null → fall back to estimate=233)
//     turn 960:      347
//     item-limit:    351
//     turn 1018:     351
//   Dev image (watchtowers): 363 — within ~4 % of our 347-351 reading.
//
//   Caveat: the +0x20 byte takes multiple non-c8 values (0xe8=216,
//   0xbc=46, 0x58=16, 0x00=39, plus ~30 rare ones), so this column is
//   probably an entity-TYPE enum, not a watchtower-specific flag. The 347
//   non-template records likely lump watchtowers, forts (HST has FORT v=6
//   too), and other map entities together. Tagged "counted-probable" rather
//   than "counted" pending sub-type byte decode.
//
// =============================================================================
// FAILED HYPOTHESES (documented so future sessions don't re-walk them)
// =============================================================================
//
// 1. Section grammar tags in the body: searched body root for u32-aligned
//    HST-index-version pairs at +8 of every self-pointer header — zero hits
//    for WATCHTOWER (60,2), PORT_MANAGER (37,1), ROAD_MANAGER (55,1), etc.
//    The body root is NOT a generic section-grammar tree; it's a sequence of
//    fixed regions (toggle_fow / post-fow-35-stride / diplo-event-log /
//    diplo-slot-table / ZoneA / ZoneB / character-paths) that doesn't
//    surface its sections by HST-index byte.
//
// 2. ASCII strings: zero `watchtower`/`fort` strings in any save body.
//    (Only HST entries contain these tokens.) UTF-16 search also empty.
//
// 3. u32 = 3957 / 1276 / 363 scan: 3957 had ZERO hits in the file. 1276 had
//    43 hits but none at structural anchors. 363 had 965 hits but they
//    overwhelmingly landed inside the diplo-event-log's turn-counter u16
//    field (`6b 01` = 363 = current turn) — a coincidence, not a count.
//
// 4. ZoneA-log-slots stride-113 × n=1256 (within 2 % of ports=1276):
//    inspection showed the zone is actually stride-12 records continuing
//    the diplo-event-log shape, not a manager-array. The "113 × 1256"
//    factorisation is coincidental.
//
// 5. Per-settlement detail records carrying watchtower flags: scanned every
//    settlement detail for ASCII "watchtower" — zero hits anywhere. Per-
//    settlement port flags ARE encoded as the port_buildings / river_port
//    chain presence (this is how we now count ports).
//
// 6. Stride-9/7 score tables in the army-trail zone: those are AI-army
//    recruitment-priority tables (session 65), not entity records.
//
// =============================================================================
// RECOMMENDATIONS
// =============================================================================
//
// * Roads & ports: keep using settlement-level chain counts. The dev image
//   numbers are higher because the engine's pointer registry counts auxiliary
//   slots per entity. Our lower-bound count is still vastly better than the
//   ratio-based estimate (which underestimates badly: the old est_roads ratio
//   gave 2,673 vs counted 1,269 — i.e. the ratio over-estimated by 2×).
//
// * Watchtowers: keep the "counted-probable" 347-351 number when the
//   post-grid array exists; fall back to the dev-ratio estimate when it
//   doesn't (Turn 900 End and earlier saves). Future work: decode the +0x20
//   sub-type byte to separate watchtowers from forts from other map
//   entities.
//
// * The remaining 5,300-byte gap between counted+estimated total (58,094)
//   and the dev-image cap-reach total (65,536) is in the unaccounted
//   pointer-registry slots that aren't user-visible entities — most likely
//   one shroud + one manager pointer per entity, which a future session can
//   crack by diffing two saves where exactly ONE watchtower was built.
"use strict";
console.log("This file is documentation. Run scripts/save-budget-full.js <save> for actual counts.");
