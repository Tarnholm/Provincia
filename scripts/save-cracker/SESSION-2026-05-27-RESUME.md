# Session 2026-05-27 — RESUME NOTES

Saved before PC restart triggered by Test C crash. Continue here after reboot.

## What we proved this session

### Save-cracker coverage: 60.18 % → 100 %

Five fixes in `cover.js`:

1. **Char-pool ZONE_END** anchored to `factions[0].offset` instead of hardcoded
   `0x1f10c72`. Found that ALL top-10 unknown blobs were char-pool the detector
   wasn't scanning. +22 pp coverage.
2. **Sections 14/15/16/17** got the same dynamic ZONE_END treatment. +17 pp.
3. **Pure-padding sweeper** (section 18) claims runs ≥ 64 B that are ≥ 98 %
   single sentinel.
4. **Character + unit record claims** no longer capped at 800/256 B per record
   when there's a successor; now claim every byte up to next record's start.
5. **Post-grid 267-stride detector** made magic-tolerant (first-record's u32
   IS the magic; varies per save, e.g. T960=0x3c4=964, T1018=0x3fe=1022,
   pattern is `magic ≈ turn + 4`). Multi-stride walk handles records that
   span 2-6 stride units.
6. **Pre-first-marker fallback** (section 9d) claims the gap between
   settlement-detail-0 and the first settlement marker on early-game saves
   that don't have the full 267-stride array yet.

Diplo claims 3b/3c widened to consume trailing 12-byte stride entries.

### Map-entity parsers added

`src/mapEntityParser.js` exports `countRoads`, `countPorts`, `countWatchtowers`,
`countMapEntities`, `findPostGridArray`:

- **roads** = settlement-attached `hinterland_roads` chain records.
  T960=1268, T1017=1269, T1018=1269.
- **ports** = `port_buildings` + `river_port` chains.
  T960=721 (529+192), T1017=724 (529+195), T1018=724 (529+195).
- **watchtowers (old heuristic)** = non-template records in post-grid 267-stride
  array. Returned 347-351 across saves — **flagged as wrong** because the byte
  at +0x20 is an entity-TYPE enum bundling watchtowers + forts + other types.

### Watchtower agent breakthrough (just before kill)

The agent found the **canonical watchtower table** as a 40-byte stride record
array with:
- Coords at +0/+4
- Magic `61 13 82 12` at +28..+31 on every record
- Terminator `2c 71 21 ad ...` at the end
- Header preceding the table contains `e4 02 00 00 14 00 00 00 ...`

**Exact counts (validated by +1 across the +1-turn pair):**
- T960: **156**
- T1017: **176**
- T1018: **177**  (+1 = one watchtower built that turn — strong validation)

**The agent was killed before it could update `mapEntityParser.js` to use the
new exact-count logic.** The dig scripts are saved:
- `dig-watchtower-table.js`, `dig-watchtower-final.js`, `dig-watchtower-coordmap.js`,
  `dig-watchtower-coords.js`, `dig-watchtower-exact.js`, `dig-watchtower-locate.js`,
  `dig-watchtower-search.js`

**TODO on resume:** Replace `countWatchtowers(buf)` in `src/mapEntityParser.js`
with the 40-byte-stride table parser. Re-run `save-budget-full.js` to confirm
T1017 = ... entries.

### Resources count

Now from descr_strat `resource` lines (5,548 in RIS imperial). Wired into
`save-budget-full.js`. Bumped T1017 total from 58,094 → 61,667 (94.1 % of
65,536 cap). Real headroom 3,869 instead of the old fake 7,442.

## Dead-pool pruner experiment results

Three test saves derived from Turn 960 (which has headroom so failures
attribute to OUR edit, not natural overflow):

| Test | Modification | Result | Implication |
|---|---|---|---|
| A | byte-identical rename | ✓ loaded + ended turn | RTW handles renamed saves |
| B | 1 byte flipped in path: `/portraits/dead/` → `/portrXits/dead/` of dead record #50 | ✓ loaded + ended turn | dead-pool path strings NOT checksummed |
| **C** | **250 B of post-path body zeroed** | **✗ CRASH (graceful, no dump)** | dead-pool record BODY IS validated |

Crash signature from `message_log.txt`:
```
Unknown format %  at formatting[568].
min <= max Failed
When calculating ranged random numbers min must be smaller than max.
```

Crash happens during dynastic processing after the world-map setup completed.
Engine reads bytes for format-string lookup AND for an RNG range — our zeros
broke both.

**Conclusion:** in-place wipe of dead records is NOT viable. The pruner must
take Option 1: **truncation**. Find the per-faction dead-pool count header,
decrement it, splice out the trailing record bytes.

### Pruner — next concrete step

Inspect bytes BEFORE the first dead-pool record in each per-faction pool
(char-pool-auto sections start at offsets like 0x1885587 for the first
faction). Look for u32 = the per-faction dead character count just before
where the dead records start.

In the data dumped at `0x187d1ab..0x187d2ab`, the bytes look like a sequence
of `<u32 charId> <u32 something>` pairs (charIds 219→226 incrementing) — these
are PER-FACTION char IDs. The actual COUNT header is probably at the START of
the entire faction's pool block (earlier in the file). Hunt for it:
- Look at the start of each char-pool section per cover.js (0x1885587, etc.).
- Expect a header like `<u32 magic> <u32 live_count> <u32 dead_count> ...`.

If the count header is found and decrement+truncate works on a test save,
we have a working pruner that frees real registry slots.

## Files modified / created this session

- `scripts/save-cracker/cover.js` (5 commits)
- `src/mapEntityParser.js` (NEW — roads/ports/watchtowers production parser)
- `scripts/save-budget-full.js` (resources counted from descr_strat)
- `scripts/save-cracker/test-dead-pool-removal.js` (test saves A/B/C generator)
- `scripts/save-cracker/dig-watchtower-*.js` (×7 — breakthrough dig trail)
- `scripts/save-cracker/dig-roads-*.js`, `dig-postgrid-*.js`, etc. (dig trail)
- `scripts/save-cracker/dig-roads-ports-watchtowers-SUMMARY.js` (catalog)

## Current best Turn 1017 budget

```
characterRecords  23122  35.28%  counted    ← dominant runaway
buildings         16773  25.59%  counted
units              7765  11.85%  counted
resources          5549   8.47%  counted-descr-strat
armies             2527   3.86%  counted
characters         2116   3.23%  counted
roads              1269   1.94%  counted
settlements        1232   1.88%  counted
ports               724   1.10%  counted
watchtowers         351   0.54%  counted-probable  ← change to 176 after agent update
factions            238   0.36%  counted
sieges                1   0.00%  counted
TOTAL             61667  94.1%
```

With the watchtower fix (351 → 176): TOTAL = 61,492 (93.8 %), headroom 4,044.

The gap from our 61,667 → dev's 65,563 corruption point (~3,900) is most
likely the aux-pointer multiplier for ports/watchtowers (each port is `port`
+ `port_shroud` + `port_blockade_builder` = 3 slots). Worth confirming if
we want a 100 %-accurate budget.

## Test saves on disk (Downloads folder)

- `save_TEST_A_control.sav` (Turn 960 byte-identical) ✓ loaded
- `save_TEST_B_oneByte.sav` (1-byte flip) ✓ loaded
- `save_TEST_C_zeroBody.sav` (250 B wiped) ✗ CRASH
- `save_TEST_D_splice.sav` (record #50 spliced out, file -462 B) — **NEEDS IN-GAME TEST**
- `save_TEST_E_clone.sav` (record #50 = byte-equal clone of #49, same size) — **NEEDS IN-GAME TEST**
- `save_TEST_F10_splice10.sav` (records 100..109, -7,810 B) — run if D loads
- `save_TEST_G10_splice10late.sav` (records 21000..21009, -9,650 B) — run if D loads
- `save_TEST_F_splice100.sav` (records 100..199, -67,814 B) — run if F-10 loads
- `save_TEST_G_splice100late.sav` (records 21000..21099, -67,554 B) — run if F-10 loads

Originals also present:
- `save_Autosave   Dummies   Turn 900 End.sav`
- `save_Autosave   Dummies   Turn 960 Start.sav` (test source)
- `save_item limit bug.sav` (Turn 1017)
- `save_Autosave   Dummies   Turn 1018 Start.sav`

## Session 2026-05-27 part 2 — post-restart findings

### Dead-pool structure (CONFIRMED via dig-deadpool-count-v4)

Dead-pool records are **packed tight with no inter-record header**. Each
record is structured:

```
u16 path_length        ← e.g. 0x2f = 47
ascii path             ← e.g. "data/ui/greek/portraits/portraits/dead/090.tga"
\0 (path terminator)
... per-record binary body (~440 B typical, can be MUCH larger) ...
```

The NEXT record's `u16 path_length` immediately follows the previous
record's body. There is **no terminator, no record-count u32, and no
faction-pool header** observable in the inter-record bytes.

Whole-save scan for `u32 == 21762` (= total dead-record count): no hit in
header areas. The hits at 0x8bb0+12n are an unrelated 12-byte-stride array
in the file header (coincidentally many 21762 values). So there is NO
single global "decrement-this-counter" header that we have located.

### The cluster hypothesis was WRONG

Dead-pool records are NOT in per-faction contiguous pools. They are
**interleaved with LIVING character records** (`cards/old/`, `cards/young/`).
Cluster boundaries detected by gap analysis (238-target) coincide with
crossings of unrelated sections (often 200KB+ of other data between
"clusters") — not with faction-pool boundaries.

### Test D + E design

Since no count was found, two hypotheses to test in-game:

| Test | Hypothesis it falsifies | Modification |
|---|---|---|
| **D (splice)** | "engine reads count from file" | record #50 removed, file shrinks 462 B. If loads → engine walks until terminator OR rebuilds from registry, AND tolerates the file-size change. |
| **E (clone)** | "engine validates record uniqueness" | record #50 overwritten byte-equal with record #49. File size unchanged, but two records now share the same UUID/charId. If loads → uniqueness not enforced. |

Outcomes branch the path forward:
- D loads ⇒ pruner is `splice records out, write smaller file`. Easy.
- D crashes, E loads ⇒ pruner must overwrite-with-clone of a "safe noop"
  record (probably a generic-template dead char).
- Both crash ⇒ pointer-registry or absolute-offset dependency we haven't
  located. Need to differentially find the offset-index this validates.

### TODO (next session)

1. **User: load Test D and Test E in RTW.** Report which (if any) loads
   cleanly and ends turn. This single experiment branches the rest of the
   pruner design.
   - If D loads: also run F-10 → G-10 → F → G to verify splice scales and
     position-doesn't-matter.
   - Use `splice-dead-batch.js <startIdx> <count>` to generate ad-hoc test
     variants.
2. ~~Update `mapEntityParser.js` countWatchtowers to 40-byte-stride table.~~
   **DONE 2026-05-27.** Walked count == declared count == expected on all
   reference saves. Source label now `(counted)`. Budget refreshed:
   T1017 = 61,492 / 93.8% (4,044 headroom).
3. Per the outcome of (1), implement the pruner against T1017 to actually
   free entity-budget slots. Even if only safe-to-trim records can be
   pruned, the Dummies save has ~21,000 dead-pool candidates vs the ~4,000
   headroom we need — splice viability ⇒ massive headroom restoration.

### Trajectory across reference saves (post-watchtower-fix)

| Save | Total | Pct | Headroom | characterRecords | watchtowers |
|---|---|---|---|---|---|
| T900 End    | 59,921 | 91.4% | 5,615 | 21,243 | 281 |
| T960 Start  | 60,138 | 91.8% | 5,398 | 21,762 | 156 |
| T1017       | 61,492 | 93.8% | 4,044 | 23,122 | 176 |
| T1018 Start | 61,555 | 93.9% | 3,981 | 23,150 | 177 |

Character-record growth rate (T960→T1017): +24/turn average. At that rate
+168 turns to cap. Splice-out of 5,000 dead-pool records (if viable per
Test D outcome) would restore ~5,000 slots = ~210 turns of runway.
