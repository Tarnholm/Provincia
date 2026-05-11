# RTW .sav format — research dossier

Compiled from public sources (taw/etwng, Rafkos rometwsaveeditor, TWC threads, M2TWEOP, REX/M2EX) plus our own findings on RIS save samples.

**Sample provenance**:
- All Feral-folder saves used for tonight's analyses (Saka batch save_1turnstart + save_1.x + save_2..7 + save_2.0/2.1/2.2 Sparta tax + Sparta 1.x movement saves + savestartsparta) are **RIS imperial campaign** — campaign name `"imperial_campaign"` at offset 0x3a in every header.
- The two repo-root samples `sample-turn1-end.sav` and `sample-turn2-start.sav` are **RIS Classic submod** (`"ris_classic"`). They were used only for the very first header-decoding run; all 15 field-level findings are on imperial campaign data.
- Both share the Rome Remastered binary format (magic 0x070a) — only the descr_strat content differs. Cross-reference imperial-campaign descr_strat at `C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt`.

## Magic & engine variants

- **Vanilla RTW 1.0 / 1.5 (Gold) / BI / Alex** — magic `04 07` (u16le = 0x0704). All public RE work targets this.
- **Rome Remastered (Feral 2021)** — magic `0a 07` (u16le = 0x070a). **First public observation: this project.** Our RIS imperial campaign sample (RIS is a Remastered total-conversion mod) confirms this magic. No prior public RE exists.
- **Medieval 2** — magic `06 09` (u16le = 0x0906). Sister format.
- **Rome 2 / Attila / Shogun 2 / Empire+** — completely different ESF format, gzip-wrapped.

Endianness: little-endian throughout. No compression, no encryption, no checksum (taw round-trips identical bytes on classic; same appears true on Remastered based on our scans).

### Feral's changes vs classic (what we've observed so far)

- Magic byte bump (0x04 → 0x0a in low byte at offset 1)
- 16-byte GUID inserted at offset 0x24 — vanilla had no equivalent here. This shifts every absolute offset Rafkos documented for vanilla Rome Gold; **his anchor-relative offsets are not safe to apply to Remastered without re-derivation.**
- Section grammar AND header strings table grammar appear preserved (1510 self-pointing sections found, 106 HST entries found) — Feral didn't redesign the file, they versioned it.
- Possibly new HST record types for Remastered-only features (province grouping, 2D/3D toggle, accessibility, modern graphics options) — needs comparison to a classic-era HST dump.

### Why classic-era research still helps

Even though Feral changed offsets, the structural invariants (section self-pointer, HST shape, ASCIIZ string conventions, no compression, no checksum) carry over. taw's `etwng/sav` section-tree extraction logic should still work on Remastered saves with at most cosmetic tweaks.

## Header layout (RIS Classic, sample-turn1-end.sav — same shape on imperial saves)

```
0x0000  u16le   magic = 0x070a
0x0002  u16le   ??? (= 0)
0x0004  f32le   1338.341 — campaign clock / day fraction?
0x0008  16B     zeros (padding)
0x0014  u32le   1024
0x0018  u32le   1024
0x001c  u16+u16 4, 2
0x0020  u32le   7
0x0024  16B     GUID-like blob
0x0034  u16le   43653
0x0036  u32le   2
0x003a  pstr16le  "ris_classic" (campaign name) — len=11 chars (UTF-16LE)
0x0052  u32le   0
0x0056  f32le   ???
... fixed-size header data block (~1.2KB total per taw on vanilla)
0x3328  HEADER_STRINGS_TABLE — 106 named record types, see below
```

Note: vanilla RTW has the campaign name immediately at offset 0x36 (after 50-byte data folder block + 2 bytes), but RIS's variant inserts a GUID and other bytes — so absolute offsets differ from Rafkos' anchor scheme. We must locate the campaign name string dynamically.

## Header strings table — schema-version manifest

At offset `0x3328` in our sample. Format: array of `(asciiz_name, u32_version)` pairs. 106 entries observed (RIS Classic Saka sample). Likely identical or nearly identical on imperial saves — same Rome Remastered engine version.

Excerpt:
```
WORLD_MAP                      v=3
DIPLOMATIC_ATTITUDE            v=6
SENATE_SERVICE_HISTORY         v=1
HELP_PLAYER_BUILDER            v=1
JOURNAL_EVENT                  v=1
GROUND_TILE                    v=1
MERCENARY_DESCRIPTION          v=4
ECONOMICS_DATA                 v=4
AMBIENT_OBJECT                 v=1
LOG_EVENT                      v=1
SETTLEMENT_PLAN_SLOT_POSITION  v=1
POLITICAL_ASSASSINATION        v=1
... (94 more)
```

The version int next to each name is the **schema version** the engine writes for that record type. Mods that change region/faction count produce saves where these versions still match vanilla, but the section bodies differ in size — which is why save-compat between mod versions usually breaks.

**Action item:** dump the full 106-entry table from our sample (currently truncated to 12 in console). It's already in the JSON output.

## Section grammar (taw's invariant)

```
struct Section {
  u32 absolute_offset;   // self-pointer; equals byte position of this struct
  u32 size_bytes;        // includes the 8-byte header
  u8  payload[size - 8]; // may contain nested Sections
}
```

Our scanner found **1510 candidate sections** in the sample save. Top-level section starts at `0x3bad` with size 6.49MB and 280 immediate children — that's the body root. Sections nest densely.

The body section root sits ~2KB after the header strings table — so the file flow is: leading header → fixed data block → header strings table → root section (recursive payload).

## String encodings

| Form | Used for |
|---|---|
| ASCIIZ (NUL-terminated UTF-8) | Section names in HST, embedded record-type strings, faction internal IDs, character names, settlement names, building chains, unit types, tags |
| u16le-prefixed UTF-8 ("pstr8") | Some short labels |
| u16le-prefixed UTF-16LE ("pstr16le") / "ca_unicode" | Header campaign-name path, display names |
| u16-prefixed ASCII (incl. trailing NUL) | Some embedded labels |

**RIS body uses UTF-8 cstrings extensively** — every faction/unit/building/character/trait token in the sample appears as null-terminated UTF-8 (`cstring` and `utf8raw` encoders both hit; the `utf16le` encoder rarely hits in the body).

## Confirmed concrete fields (Rafkos rometwsaveeditor, Rome Gold)

Offsets relative to CAMPAIGN_NAME anchor in vanilla Rome Gold. **Don't apply to RIS without re-anchoring.**

| Field | Width | Offsets from CAMPAIGN_NAME | Encoding |
|---|---|---|---|
| Unit size | f32 (high half) | +5, +47 | 0x003F=small, 0x803F=normal, 0x0040=large, 0x8040=huge |
| Battle time limit | u8 | +16, +58 | 0x1E=on, 0x1C=off |
| Battle difficulty | u8 | +11, +53, +278, +3438 | 0=Low,1=Med,2=High,3=VeryHigh, **stored at 4 redundant locations** |
| Campaign difficulty | u8 | +274, +3434 | Same enum |
| Year | i32 LE | +1178, +3705 | Negative for BC |
| Season | u8 | +1176, +3709 | 0=winter, 2=summer |

Pattern: settings are duplicated. Once we find one copy via diff, search the file for the same byte pattern to locate redundant copies.

## Field correlation findings (from our locator)

For known faction starting denarii vs faction-name string positions in the body, the integer cluster Δ averages **-1900 to -2000 bytes** (treasury appears ~2KB *before* the faction name string).

Cleanest signals (factions with unique starting denarii):
- `bithynia` 5500 → 8 pairs within ±2KB, topΔ=-1931
- `rhodes` 5500 → 4 pairs, topΔ=-1943
- `knossos` 5500 → 4 pairs, topΔ=-1975

Hypothesis: each faction record is ~2KB in length, with treasury near the start and the faction internal name as a trailing ASCIIZ string (or near it). Need to verify by looking at the bytes directly.

## High-leverage targets

Each of these is one breakthrough away:

1. **Faction record stride** — find the offset of the start of the FACTION record array. The 7 at 0x20 might be the count? Or might be something else. Cross-reference with HST entry `FACTION` if present.
2. **Settlement record array** — 128 hits per "core_building" / "italic" tag suggests 128 region-settlement records. Locate the array start.
3. **Character records** — every `character,` line in descr_strat names a starting general. Their names should appear in cstring form. Diff between turns to find age-incremented fields.
4. **`campaign_script` text embed** — the campaign script is included verbatim. Search for any signature line (e.g., `script_name` / `console_command`) to locate it. It bookends the AI/event sections.
5. **Region ID → owner faction** — the heart of "current ownership" parsing. The 128-region table likely has owner-faction-id as a small enum. Cross-reference with the 128-times-repeated tags.

## Existing tools

- **taw/etwng `sav/`** (Ruby) — section-tree extractor, round-trips identical. https://github.com/taw/etwng/tree/master/sav
- **Rafkos rometwsaveeditor** (Java) — 6-field GUI editor. https://bitbucket.org/Rafkos/rometwsaveeditor/
- **No 010 Editor / ImHex template exists** for RTW .sav. Writing one would benefit the modding community.

## Format determinism — CONFIRMED (2026-05-09)

**Two saves taken with zero input between them differ in exactly 2 bytes** at offset `0x43f8` (one u32le field, A=614 / B=470 in the test pair). Confirmed on RIS imperial campaign, brand-new turn-1 save → save → save again with no cursor input intended.

**Implications for parser work:**
- **No checksum.** A CRC/hash would either show fixed-location bytes (4–32 bytes) or propagate to the trailer. Neither happens. The format is self-validating only via the section grammar (self-pointers).
- **Round-trip is trivially safe.** Parse → re-emit identical bytes → game must load. The 2-byte field at 0x43f8 is not engine-validated (the test pair both load fine).
- **The 2-byte field is monotonically increasing across campaign time:**
  | Save | u32 @ 0x43f8 |
  |---|---|
  | identical_A/B (new T1) | 614 / 470 |
  | ror_t1e | 3700 |
  | ror_t2s | 5731 |
  | ror_t11s/e | 69467 / 72549 |
  | athens_t21..t22mid | 77251 → 81694 → 82077 → 83618 |
  
  Hypothesis: RNG step counter or game-frame counter, written at save time, ignored at load time.

**The Phase-4 "every previous attempt died at the checksum step" concern from taw's M2TW notes does not apply to RR.** RR likely dropped or never had a save checksum.

## CONFIRMED FIELDS (Rome Remastered)

This is the first field of the Rome Remastered save format publicly identified.

### Character record layout (Leonidas, save_1.3..1.6, RIS imperial campaign Sparta) — CONFIRMED

Triple-validated across three Leonidas movements (X 400→406→407, Y 335→329→320, all matching u32le predictions at expected offsets). Earlier Azes hypothesis was correctly identified as a coincidental match in a different data structure.

| Δ | Type | Meaning |
|---|---|---|
| −16 | `u32le` | Outer-section self-pointer (taw invariant) |
| −12 | `u32le` | Section size or version (= 6 here) |
| −8 | 4 bytes | Hash/timestamp |
| −4 | `u32le` | Inner-section self-pointer |
| **0** | **`u32le`** | **Character X coordinate** |
| **+4** | **`u32le`** | **Character Y coordinate** |
| +8 | u32 | Two u16: (24576, 1) — purpose unknown |
| +10 | u16 | "is land army leader" flag — flips 1→0 on embark |
| +12 | f32le | Land-mobility / active flag — 1.0 → 0.0 on embark |
| +16..+95 | 0x00 | Padding within record |
| +96..+319 | 0xff | Empty array slots between consecutive characters |

Coordinates are stored as **u32le** (despite values fitting in u16 — high bytes are 0). Position is updated even when the character is embarked on a fleet — it reflects the fleet's tile, with the +10 and +12 flags flipped to "embarked" state.

The double self-pointer (−16 and −4) confirms **taw's section grammar applies recursively**: each character is wrapped in nested {offset, size, payload} sections.

The 224-byte 0xff filler stretch between records suggests a fixed-size array slot of ~96 bytes per character with the rest reserved/padded.

### Settlement vs field character storage (Areus, save_1.6 → save_1.7)

Areus moved from Sparta city to (403, 332). His record then materialized at `0x0154a2fa` with the EXACT same layout as Leonidas's. In save_1.6, the same offset held the empty-slot pattern (mostly 0x00 with 0x7f and 0xff sentinels).

**Caveat — this single isolation has multiple confounded changes:**
1. Areus's field-army record is created (the part we measured cleanly via the unique position-pair signature)
2. Sparta city loses Areus from its garrison
3. Sparta city loses its governor (Areus was governor)
4. Public-order / income / squalor recalcs in Sparta
5. Possibly a new captain emerges as the city's nominal head

The position-field finding (u32le X@0, Y@+4) is unambiguously Areus because the integer pair (403, 332) is not state any settlement record would carry. But the wider byte deltas around the move pair-isolate to "all of the above"; the layout of the SETTLEMENT side cannot be inferred from this diff alone. A clean settlement-record probe would need: a save pair where ONLY a settlement field changes (e.g. a tax-rate change like save_3 in the Saka batch, with a movement-free baseline).

Conclusions:
- **Field characters live in a fixed-size pre-allocated array** in the save body.
- **Empty/inactive slots are filled with the pattern `00 ff ff ff ff` plus 0x00 padding** (sentinel for "no character here").
- **Settlement-resident characters do NOT appear in this array** — they live inside their settlement's character list (location TBD).
- **When a character moves out of a settlement**, the engine populates the next empty slot in the array with their field record.
- **When a character enters a settlement**, presumably the slot reverts to empty.
- Stride between Areus's slot (0x0154a2fa) and Leonidas's slot (0x0154a708) is 1038 bytes — but slot reuse means the array is sparse; consecutive populated entries may not be adjacent. Need to scan for ALL non-empty slots to determine actual max stride / record size.

### Tax-rate field — DECODED (Sparta saves 2.0/2.1/2.2)

Cross-validated by setting all Sparta settlements to **high** (save_2.0), **very_high** (save_2.1), **low** (save_2.2) and direct byte-compare across the three same-size saves.

Three byte offsets transition through three distinct values:
```
0x0130c39d   high=2, very_high=3, low=0
0x0130d22c   (+3727)
0x0130e0bf   (+3731)
```

**Confirmed enum**: `low=0, normal=1 (default), high=2, very_high=3`. (exempt likely 4.)

**Confirmed settlement record stride: ~3,728 bytes**. The 3,727/3,731 strides between consecutive tax bytes mean settlement records are fixed-size ~3,728B each; the tax field sits at the same relative offset within every record. Sparta has exactly 3 starting settlements in RIS imperial campaign — matches the 3-offset count.

**Earlier Saka 0→3 finding (save_3) was likely a DIFFERENT field** — the Sparta result is higher confidence (3 distinct levels, no file-size shift confusion). The Saka 0→3 may have been a "tax-changed-this-turn" flag, a settlement-happiness marker, or an AI-recommendation cache — not the actual tax level.

### Earlier Azes hypothesis — RETRACTED

Initial finding (Azes save_7, settlement-resident character moved to field):
- A u16le pair `X@0x2d53b` and `Y@0x2d549` (+14 bytes) flipped from (921,643) to (917,645). Only 1 unique offset in the file had both transitions.

Validation attempt (Leonidas save_1.3, field-army character moving 2 tiles):
- Reported coords (398,337) → (400,335)
- **No u16 X+Y co-occurrence found at any offset spacing from +2 to +256 bytes**
- No u16 +2/-2 paired delta found anywhere in same-absolute-offset comparison
- Both individual values exist in the file but never adjacent

Conclusion: the Azes finding was likely a **coincidental match in a different data structure** — probably the per-faction tile-vision array we saw 12-byte-stride records around 0x2d53b. The actual character position field is still unknown.

Possible explanations to test:
- Field characters use different encoding than settlement-resident (Azes was in Sakon Taphai; Leonidas was in the field)
- Position stored as map-tile-index (`y * map_width + x` as one u32) instead of separate X/Y
- UI coords (debug console) don't match save-stored coords (different scale/origin)
- X and Y in entirely different file regions, not co-located

### Coordinate system

- `descr_strat.txt` lists Azes at `x 439, y 306` (small integers)
- In-game (and in the save) Azes is at (921, 643) — **scale factor ~2.10×**
- This mirrors how Rome Remastered's enlarged Imperial Campaign uses a different internal coordinate system than the descr_strat input
- Coords stored as `u16le` (NOT f32 — the engine is grid-based, not continuous)

### Character storage architecture

- **Character names are NOT stored as strings in the save.** None of Azes / Spargapeithes / Amorges / Skunkha / Skyles appear in any encoding (utf-8, utf-16le).
- Implication: character records are referenced by a numeric ID; the engine looks up display names from descr_names.txt or expanded.txt at render time.
- This is a major architectural finding — the Provincia save parser will need to mirror the engine's name-pool indexing rather than reading names directly.
- **Region/city/settlement names are also absent** ("Prasiai", "Argos" the city) — same ID-indexed model.
- **Faction internal IDs DO appear as strings** (sparta, achaea, aetolia, greeks, saka, romans_julii) — at least for player-visible factions. Non-player factions like "argos" do NOT appear as strings even after the player declares war on them. Argos is referenced only by its faction-id integer.

### Faction internal-id discovery (Sparta = 30)

Disambiguated via two save isolations:
- save_1.1 = Sparta declares war on Argos + sieges Prasiai
- save_1.2 = Sparta attacks Messene + autoresolves (war only, no siege)

Both saves flipped a `u32le` at `sparta_cstring_offset_0 + 65` from `0xFFFFFFFF` (-1) to `0x0000001E` (30). Since Argos and Messene are different factions, **30 cannot be the enemy's faction-id**. The field encodes Sparta's OWN internal faction-id, written when Sparta enters its first war state.

Confirmed:
- **Sparta's internal faction-id = 30** in this RIS imperial campaign save
- **descr_strat order ≠ internal id**: Sparta is at descr_strat position 88 of 239 but internal id is 30. The engine compresses/renumbers faction-ids.
- The same value 30 appears **twice** within the same Sparta record at +0 and +28 from the anchor — two separate fields hold the faction-id back-reference.
- The record sits adjacent to asset path strings like `captain_portrait_sparta.tga` (visible ASCII). **Asset/UI paths ARE stored as cstrings in saves**, alongside faction internal-name strings — useful as parsing anchors.

### Diplomacy state propagates to every faction record

### Diplomacy state propagates to every faction record

When Sparta declared war:
- A 4-byte block at relative position Δ=-34..-31 from EVERY "spartan general" unit-name occurrence in the save flipped identically: `98 1b f0 bb` → `f0 dc c9 c0`.
- "spartan general" appears once per faction-relation record (~50 factions × ~1850-byte stride, totaling ~6 hits in this region).
- This 4-byte block is likely a **per-faction diplomacy-state hash/cookie** that the engine recomputes for every AI faction's view of the world after each diplomatic event.
- The actual war-declaration value (30) sits in Sparta's record only; the cookie change propagates to all factions.

### Naval unit records — anonymous fleets (2026-05-10, save_rome10)

Confirmed against `save_rome10.sav` (RIS imperial campaign, turn 5).

Naval unit records share the same outer shape as land units (nameLen u16 → ASCII name → seed/id u32 → small filler u32 → region UTF-16 with `ff ff ff ff` terminator → commanderUuid u32 → max u32 → soldiers u32 → ...) but with three quirks:

- **Region string is `"the sea"`** (lowercase). Land-unit region names always start uppercase (e.g. `"Taras"`, `"Calabria"`). An uppercase-first-letter filter in the region validator was rejecting every naval record on this codebase until 2026-05-10. The post-region 0xffffffff terminator + sane-bounds check on commanderUuid is enough to keep noise out without the case requirement.

- **commanderUuid is always 0.** RTW stores fleets as anonymous at the unit level — no character is bound via the unit record's commander field. Land units bind to their general via this field; naval units do not. To pair a fleet with its admiral or its (x, y) position, you need a separate mechanism (next bullet).

- **Fleet army_uuid sits at u32(i − 20)** where `i` is the offset of the unit's `nameLen` u16. Verified on save_rome10's 47 naval bireme records — 40 of those carry a fleet army_uuid here that matches a type-4 world-object position record. The remaining 7 are second/third ships in multi-ship fleets: only the FIRST ship in a fleet carries the army header; subsequent ships in the same fleet have something else at (i − 20). File-order inheritance fills in: if a naval unit's (i − 20) value isn't a known fleet uuid, assume it belongs to the most recent prior naval unit's fleet.

- **type-4 world-object position records** carry one fleet's (x, y) keyed by army_uuid (same shape as type-5 / type-6: `[type u32][uuid u32][self-offset u32==pos][x u32][y u32]`). save_rome10 has 46 distinct fleets, all of which appear in the type-4 set.

Result: 53 naval-prefix units → 46 fleets, 46/46 position-matched after file-order inheritance. Each becomes a synthesized navy-class army for the renderer, labeled `"<faction> fleet"` (faction taken from the captain_card marker preceding the bodyguard's offset).

### Runtime uuids vs save uuids — they DO NOT match

Confirmed on every character / army / unit traced through the message_log this session.

- The save file's stored uuids (character `secondaryUuid` at record_start − 43, fleet army_uuid at u32(i − 20), region IDs, etc.) are **assigned at character/army/region creation** and stay stable across save/load cycles.
- The values the engine emits in `message_log.txt` (and presumably in its in-memory runtime structs) are **memory pointers assigned at game-session start** and change every time the user restarts the game. RTW Remastered uses 64-bit pointers; the last 8 hex chars happen to look uuid-shaped (e.g. `aae189d0`, `2b0992e0`) which is why early reverse-engineering treated them as uuids — they're truncated pointers.
- Provincia matches runtime → save by **first name + last name** (lastStub-normalized: lowercase, underscores stripped, trailing `the X` epithet stripped). The character match cascade tiers (primaryUuid match → commanderUuid match → full-key name match → first-name prefix match) all rely on names because uuid equality across the runtime/save boundary never holds.
- Trait-driven cognomen overrides (e.g. `RomanConquerorMessapians` → "Messapivs") **rewrite the character's displayed lastName**, so the match cascade also tracks `originalLastName` to preserve the birth-record value the engine continues to emit in MOVING_NORMAL events.

### Live unit-flow tracking via transfer events

The engine emits two transfer-event forms in `message_log.txt`:

```
transferring unit(unitUuid) from army(fromArmyUuid) to general(Name:charUuid):army(toArmyUuid)
transferring general(MovedName:movedCharUuid) unit(unitUuid) from army(fromArmyUuid) to named general(DestName:destCharUuid):army(toArmyUuid)
```

The `general(X)...to named general(X)` self-transfer form signals a **split**: a general moving themselves into a new (empty) army uuid. Distinct from the `general(X)...to named general(Y)` form (X ≠ Y) which signals a **merge**: X's unit joins Y's existing army.

Live tracking insight: the engine's BESIEGE / MOVING_NORMAL event that follows the split carries the NEW army uuid in its `army(...)` field. So splits are detectable from the move event alone (army uuid mismatch against the last seen value for that character) — no need to wait for the self-transfer line, which actually emits AFTER the move event in save_rome10's log.

Since runtime unit uuids have no save mapping (no field in the save's unit record matches the engine's runtime pointer), unit transfers can only be tracked by **count of units between leaders**, not by unit identity. The renderer applies the count by donating foot units (commanderUuid=null, attached via file-order Pass 2) from the donor leader's save roster to the recipient leader's. Bodyguards (commanderUuid bound) stay with their general. Off-by-one drift can occur when a general-transfer count includes the moved general's bodyguard, but the visible delta is ±1 unit at most.

## Methodology

1. Load both sample saves
2. Scan known tokens (faction/region/character/unit/building names) in 5 encodings
3. Scan known integers (treasuries, garrisons, x/y) in u32/u16
4. Find self-pointing sections (taw invariant) → build section tree
5. Find HST → label sections by version
6. Diff turn1-end vs turn2-start, with bounded-shift resync to ignore record-size shifts
7. Correlate known ints near known strings to locate field offsets within records

The differential method beats top-down RE because the engine itself is the oracle: every changed byte between two consecutive turns is a known-cause delta.

## Differential findings (saka, sparta, sample-turn1/2)

### Findings 2026-05-10 (background session)

Three new field offsets identified, plus refinements to the known character-position record.

#### 1. Settlement public-order / happiness f32 at `tax_byte + 2239` — CONFIRMED

Cross-validated using the existing Sparta tax triple (save_2.0 high=2, save_2.1 very_high=3, save_2.2 low=0) against all three known Sparta tax-byte offsets (0x130c39d, 0x130d22c, 0x130e0bf).

A single f32 field, **exactly 2239 bytes after the tax-level byte** in every settlement record, scales linearly with tax level:

| Settlement (tax_byte) | low (0) | high (2) | very_high (3) |
|---|---|---|---|
| 0x130c39d (Sparta city) | 195.00 | 145.00 | 125.00 |
| 0x130d22c (settl 2)     | 175.00 | 125.00 | 105.00 |
| 0x130e0bf (settl 3)     | 190.00 | 140.00 | 120.00 |

Step is −25 per tax level (low→high = −50, high→very_high = −20, smaller because very_high adds a 4th level penalty). The +2239 offset is the **only** byte that changes inside any settlement record when tax level changes (verified by exhaustive scan from −64 to +3700 from each tax byte across the 3 saves).

**Best-guess interpretation: city happiness / public order**. Values 100–200 are too high for percentages; more likely the engine's internal "satisfaction" score where 100 is the neutral baseline and tax modifiers subtract ~25 per level. RTW Remastered's UI shows public order as a 0–100% bar, so this raw value is likely scaled/clipped at render time. Alternative interpretations (population, food, growth-rate) don't fit — population would be a u32 in the 1000–50000 range, food/growth would be smaller floats with different deltas.

Refines the existing tax-decoded research: settlement record stride is ~3,728 bytes, with **tax-level at relative offset T**, **happiness/order f32 at T+2239**. A future probe should change one settlement to "exempt" (=4) and confirm whether the +2239 float jumps further down to ~100 or transitions to a different scale.

#### 2. Bodyguard-unit movement-points f32 at `commanderUuid + 4` — CONFIRMED

Found in `save_rome5..sav` vs `save_rome6.sav` (RIS imperial campaign, Roman Julii Turn 5 → next save). The full pair-diff is only **313 bytes across 8 runs** — the smallest non-trivial diff in the corpus, with one Roman general moving 1 tile (X: 328 → 327, Y: 374 unchanged) and the engine's frame counter at 0x43f8 bumping.

The character (`uuid 06 4c a4 cd`, portrait `generals/346.tga`) appears at four offsets in the save. Two of them carry the **same f32**, which dropped by exactly **−7.425** when the character moved 1 tile:

| Anchor | Offset | f32 before move | f32 after move |
|---|---|---|---|
| Bodyguard unit "roman general", commanderUuid at 0x01539fe0, f32 at 0x01539fe4 | `commanderUuid + 4` | 238.55 | 231.125 |
| Field-army position record, char-section start (X) at 0x0150fd84, f32 at 0x0150fdb6 | `X + 50` | 238.55 | 231.125 |

The duplication (same float in two places, both adjacent to the character's uuid) is engine-driven, not a copy-paste: the character's character-record holds the canonical value, and the bodyguard-unit record mirrors it for fast lookup.

**Best-guess interpretation: movement points remaining for the character/bodyguard**. The single-tile movement cost of 7.425 is consistent with RTW's internal MP system (default-move-tile-cost ≈ 7–10 internal units for a 1-cell flat-terrain step). Open question: do regular (non-bodyguard) unit records also carry this float at the same relative offset? Existing layout says `commanderUuid → max → soldiers` with nothing between; this finding inserts a 4-byte field between commanderUuid and max for **bodyguard records specifically**. Worth checking a non-bodyguard unit's record byte layout against the existing parser before treating this as universal.

**Refinement to known character-position record**: the existing layout says +16..+95 is `0x00` padding. That's *almost* correct — byte +50 (= `X + 50`, since X is at relative 0) is actually a non-zero f32 holding the movement-points value. The padding zones are +16..+49 and +54..+95.

#### 3. Character-record "has moved this turn" flag bit — HYPOTHESIS

Same `save_rome5..sav` vs `save_rome6.sav` pair, same character-position record at 0x0150fd80.

At byte `X + 9` (relative to the character's X coord), the value changed:
- Before move (rome5): `0x40`
- After move (rome6):  `0xc0`

Bit 7 (`0x80`) of this byte flipped from 0 to 1. Bits 6 (`0x40`) stayed set in both. This is inside the existing layout's "+8 = two u16 (24576, 1)" zone — specifically, the upper byte of the first u16. The flip from `0x4000` → `0xc000` could be:
- An "issued orders this turn" flag bit
- A "movement points partially consumed" flag  
- Part of a packed action-state enum (2-bit field at bits 6–7)

Cannot disambiguate from one save pair; mark as hypothesis. Worth re-testing with two moves in succession to see if `0xc0 → 0xe0` (next bit) or stays at `0xc0`.

#### 4. Faction-level summary record at 0x1551df3 (HYPOTHESIS — unidentified faction context)

In the Sparta tax triple (save_2.0 high / save_2.1 very_high / save_2.2 low), three 4-byte values changed inside a section header at `0x01551df3`:

```
0x01551df3..f6  outer self-ptr 0x01551DF3
0x01551df7..fa  inner self-ptr 0x01551DF7
0x01551dfb..fe  01 00 00 00      (version = 1)
0x01551dff..02  c0 06 00 00      (= 1728, possibly region/settlement id or capacity)
0x01551e03..06  CHANGING u32     low=3048  high=4575  very_high=5720
0x01551e0b..0e  66 00 00 00      (= 102, possibly faction count or aggregator id)
... 0x20 zero ...
0x01551e23..26  CHANGING u32     low=465   high=617   very_high=731
... 0x40 mostly zero ...
0x01551e63..66  CHANGING i32     low=+5700 high=−2509 very_high=+5403
```

The first two values are **monotonically increasing with tax level** (low<high<very_high). The third is non-monotonic and goes **negative** at high tax, which makes it look like a net delta (income − expenses, or unrest − loyalty).

**Caveats**: the nearest faction marker (`captain_card_sparta.tga`) is at 0x0154917d, +35,958 bytes AFTER this section. The next faction marker is `captain_card_carthage.tga` at 0x01559303, +29,200 bytes BEFORE this section. So this record is NOT obviously bound to Sparta or any other captain-card-anchored faction in the file layout. Could be:
- A per-faction summary table indexed by faction-id (not adjacent to faction-name strings)
- A settlement-aggregate record (the 1728 could be a region grouping)
- An economic/financial projection cached for Sparta's UI

Treat as hypothesis until cross-validated against a different tax change in a different campaign.

#### 5. Region rendering / tile-visibility table at 0x01f1d0e4..0x01f1d267 — STRUCTURAL (not decoded)

The largest diff run between rome5 and rome6 (the only same-size pair) was 380 bytes of small integers at 0x01f1d0e4 — clearly a structured table that gets recomputed when the character moves. Pattern is rows of `[N bytes of small ints (0–9)] 00 ff 00 ff 00 ff 00 XX` where XX increments by 1 across rows (`e7 e8 e9 e9 ea e6 d6 d4 d1 d0 cf`). The `0–9` ints look like terrain-type or visibility flags per tile in a region; the `00 ff 00 ff 00 ff` looks like a row-end sentinel.

This is **fog-of-war / tile-discovery / per-tile road-or-visibility data** that updates when a character moves into a new tile. Not field-level decoded, but documenting the offset so a future probe can target it directly. Each row appears to be ~30 bytes; ~12 rows visible in the diff range.

---

### Reproducer commands

All findings can be reproduced with one-shot `node -e` against the Feral saves directory. The decisive pair for findings #2/#3 is `save_rome5..sav` vs `save_rome6.sav` (313-byte diff). For finding #1, use `save_2.0/2.1/2.2.sav` (the existing Sparta tax triple).

### Findings 2026-05-10 (background session 2)

Two new field offsets identified, plus cross-validation of one prior hypothesis. Treasury target attempted but not pinned (see "Targets attempted, not landed" below).

#### 1. Settlement live population u32 at `tax_byte + 775` and a second pop-shaped u32 at `tax_byte + 2235` — CONFIRMED (primary), HYPOTHESIS (secondary)

Cross-validated across three independent samples:

- **Sparta tax triple (`save_2.0/2.1/2.2.sav`)** — all three settlements (Sparta city @tax 0x130c39d, Lakonikos @0x130d22c, Kythera @0x130e0bf) hold the correct descr_strat starting populations (3500, 1800, 1400) at both `tax_byte+775` and `tax_byte+2235`. Across all 3 saves × 3 settlements × 2 offsets = 18/18 hits, all u32le.
- **Roman campaign (`save_rome5..sav`)** — Roma's pop=9000 sits at 0xf85986 with tax_byte at 0xf8567f (byte=1, "normal"). The +1460 dup also reads 9000 in this same-turn save. A second Roma record exists at 0x113e064 with identical +1460=9000 — suggests RIS imperial campaign duplicates Roma in two distinct record locations (possibly WORLD_MAP vs SETTLEMENT_PLAN_SLOT_POSITION).
- **Roman campaign rome10** (different campaign, lower frame counter) — same two offsets (0xf85986, 0x113e064) carry 9000/9000. Settlement-record absolute offsets are file-position stable within a campaign **and** across same-size campaign restarts.

**Stride between the two pop-shaped fields = exactly 1460 bytes** (= +2235 − +775). Pinned this by filtering all u32==3500 hits in save_2.0 to pairs with stride 1460 — every confirmed Sparta-city pop sits in such a pair (35 pairs total in the file, only 3 belong to Sparta-city since 3500 is a common starting value in RIS).

**At a turn boundary (rome6 → rome7), the two pops DIVERGE:**

| Save | +775 | +2235 |
|---|---|---|
| save_rome5/6 (within turn) | 9000 | 9000 |
| save_rome7 (next turn, Roma shifted +363 bytes to 0xf85af1) | 9000 | 8955 |

So the +775 field is the **live citizen / "displayed" population u32** (canonical), and the +2235 field is a **secondary pop-shaped value** that moves on turn-end recalculation but stays in sync at turn-start. Best-guess interpretations for +2235:

- "Pre-event-turn population" snapshot used to detect growth/shrinkage between turns
- "Public-order / loyalty weighted population" or "tax-eligible population"  
- Population cap or projected next-turn pop (less likely — value goes down, not up)

Promoting +775 to **CONFIRMED u32le live population**. Keeping +2235 as **HYPOTHESIS** pending a save pair where only one of the two changes deterministically (e.g. a forced population drop via plague script or a known growth boost).

This finding refines the settlement record stride research: `tax_level u8 @ T+0` (CONFIRMED), `happiness/order f32 @ T+2239` (session-1 finding), now `population u32 @ T+775` plus a second pop-shaped u32 @ T+2235. The 4-byte gap between +2235 and +2239 places the pop-shaped field directly adjacent to the happiness float — likely related (population that contributes to public order vs. raw citizen count).

#### 2. Character "moved this turn" bit-7 flag at `X + 9` — CONFIRMED (cross-validated across two independent move pairs)

Session-1 had this as HYPOTHESIS from a single pair. Cross-validated with a second within-turn move pair in the same campaign:

| Pair | Character | Move | byte @ X+9 before | byte @ X+9 after | Bit 7 |
|---|---|---|---|---|---|
| save_rome5..sav → save_rome6.sav | uuid 06 4c a4 cd, X@0x0150fd84 | 328→327 X, 374 Y (1 tile) | 0x40 | 0xc0 | 0 → **1** |
| save_rome8.sav → save_rome9.sav | uuid 06 4c a4 cd, X@0x01516db7 | 329→327 X, 376→373 Y (2-3 tiles) | 0x20 | 0x80 | 0 → **1** |

**Bit 7 (0x80) of byte @ X+9 = "has moved / been issued orders this turn"** — flips 0→1 on movement, regardless of tile count. The other bits in the same byte differ (0x40 vs 0x20) — those are an unrelated character/order state subfield (still HYPOTHESIS).

This refines the existing character-position-record layout: `+8..+11` is no longer "two u16 (24576, 1)" — it's `[byte: bits 0..7 unknown action state][byte: bit 0..6 unknown, bit 7 = moved-this-turn flag][u16 = 1 fixed]`.

Reproducer: `b[X+9] & 0x80` reads the flag, where `X` is the offset of the character's X coordinate u32.

#### 3. Marcus Messapivs character record interior layout — STRUCTURAL (partial)

Marcus's character RECORD (distinct from his character-POSITION record) sits at **0x01506718** in save_rome5, anchored by the uuid `06 4c a4 cd` at +0. Body structure:

```
-32..-4  ASCIIZ "generals/346.tga" portrait path (within prior section's tail)
+0       u32  uuid (primaryUuid) = 0xcda44c06
+4       u32  0 (zero filler)
+8       u32  30 (some faction-id-ish small int — matches the "30" pattern seen at Sparta's record)
+12..+44 zeros / small filler
+44      u32  0x01000009 (= 16777225; possible bitmask)
+48      u32  3897 (possible character creation turn or age-related)
...
+132..+212  cluster of small u32s in (0..63) range — likely trait/ancillary IDs in big-endian u32
+248..+356  ASCIIZ "data/ui/roman/portraits/cards/young/generals/014.tga\\0data/ui/roman/portraits/young_general/014.tga\\0" portrait path strings
```

The trait/ancillary block (0x1506870..0x150693c, 200 bytes) consists of 8-byte entries where the second u32 reads as **big-endian** small integers (0x66=102, 0x65=101, 0x26=38, 0x9f=159, 0xa9=169, 0xc7=199...). Most are unique values in [3..255] range — looks like trait_ids or ancillary_ids interleaved with [type/level] markers in the first u32.

```
Entry 0:  00 19 00 01 | 00 00 00 66    (type=01, id=102)
Entry 1:  0e 00 00 01 | 00 00 00 65    (type=01, id=101)
Entry 2:  0e 00 00 02 | 00 00 00 26    (type=02, id=38)
Entry 3:  00 00 00 05 | 00 00 00 2f    (type=05, id=47)
Entry 4:  00 00 00 05 | 00 00 00 78    (type=05, id=120)
...
```

Marker bytes `0e` and `03` recur — possibly distinguishing trait records from ancillary records. The interpretation of `[first u32 = ??type/level??] [second u32 BE = id]` is a HYPOTHESIS; cross-validating requires either:
- A trait_id → trait_name map exported from the mod (export_descr_character_traits.txt for RIS imperial)
- A save where a known trait is gained between consecutive turns, looking at which new entry appears in this block

The block ends just before the portrait path ASCIIZ. **Trait + ancillary records are co-located in this 200-byte block**, consistent with the session-1 dossier's "ancillaries probably sit adjacent (after the traits block)" hypothesis.

#### Targets attempted but not landed

- **Per-faction current treasury**: spent ~20 minutes scanning rome5/rome10 around captain_card_romans_julii.tga markers and around faction-name cstrings, and diffing rome6→rome7 (turn boundary) for u32 values in 5000-50000 range. The 46 captain_card markers in rome5 are **per-character portrait references**, NOT per-faction record anchors (strides between consecutive markers vary from 532 to 900748 bytes — not a faction-record array). The actual FACTION_DATA / FACTION_ECONOMICS sections referenced in the HST live deeper in the body (root section at ~0xaa370, 3.66MB). Turn-boundary diffs (rome6→rome7) yielded 13M byte changes, with no u32 in the player-faction range that obviously tracks treasury. **Recommended next probe**: find FACTION_ECONOMICS section in the body via taw section-tree extraction, then read its payload as a fixed-stride array. Anchor-by-string-proximity is unreliable for this field.

- **Section grammar root**: the existing dossier says "body root at 0x3bad with size 6.49MB". In save_rome5, the value at 0x3bad is `u32=3080302` (= 0x2eff4e), which is **not** a self-pointer. Searching for big self-pointing sections in 0..0xa8000 found none. The root is somewhere else for this campaign (or this is a different RIS imperial save than the one used for the original measurement). First big section in rome5 is at **0xaa370 with size 3,840,531 (3.66MB)**. May need re-derivation.

### Settlement record byte map (background session 3)

Goal: produce an exhaustive byte-by-byte map of the settlement record. Approach: lock Rome's record at file offset `0xf8567f` (rome1..rome6, rome10) / `0xf857ea` (rome7..rome9, post-turn-boundary) and Sparta's record at `0x130c39d` (save_2.0/2.1/2.2), build a byte-change frequency matrix across all 13 saves, then classify each offset.

**Corpus used (13 saves on the same Rome record, 1 cross-faction sample on Sparta record):**
- save_rome1.sav .. save_rome6.sav (6 saves, same offset 0xf8567f, within-turn movement variations + turn 5 → 6 transition between rome6 and rome7)
- save_rome7.sav .. save_rome9.sav (3 saves, offset 0xf857ea, post-turn-boundary)
- save_rome10.sav (1 save, offset 0xf8567f, **separate game session** — same in-game turn but session-rooted runtime pointers all changed)
- save_2.0.sav / 2.1.sav / 2.2.sav (Sparta tax triple — only happens to share the same 3728-byte stride; offsets are FOREIGN)

**Coverage achieved**: 402 of 3728 bytes change anywhere in the corpus (~10.8%); the remaining 3326 bytes are CONSTANT (2243 are zeroes, 1199 are 0xff filler, 84 are non-zero structural constants). Of the changing bytes, runs map to ~14 distinct fields across 17 changing-runs in the rome corpus (sparta diffs add more because Sparta is a different settlement class, not just live-state changes on the same one).

#### Stride is variable, NOT fixed at 3728

The dossier asserted "settlement record stride: ~3,728 bytes" based on the 3727 / 3731 strides between Sparta's three settlements. **A scan of all 1,304 settlements in save_rome5 finds strides clustering bimodally at ~3,420 bytes (smaller settlements) AND ~3,727 bytes (larger settlements)**, with the distribution running from ~3,415 up to ~4,034. The 3,728 quote was true for Sparta city specifically, not universal. The "extra" ~300-byte block in larger settlements appears to hold one additional building-chain sub-record (Rome has 5 ASCII sub-record names; Sparta has 4).

Practical implication for any field-by-relative-offset read: **fields located at relative offset ≥ ~3,400 from tax_byte are unsafe** — they may fall in a different settlement's record. Fields at offsets ≤ ~3,400 are safe across all settlement sizes.

#### Settlement record content BEFORE tax_byte

Tax byte (relative 0) is NOT the start of the record. The record's structural header sits at relative `-21..-1`:

```
-21 -20 -19 -18 | -17 -16 -15 -14 | -13 -12 -11 -10 | -9 -8 -7 -6 | -5 -4 -3 -2 -1 | 0
cb  00  00  00  | (varies; 4xff or 4x00 padding) | 00 00 00 00 | 02 00 00 00 | 00 00 00 02 00 | tax
```

The `cb 00 00 00` four-byte signature (= u32le `0xcb` = 203) at relative `-21` is a **settlement-record-type tag** — it appears 348 times in save_2.0 (matches expected ~239 settlements + duplicates / minor positions). This is a useful structural anchor for parser code: scan for `cb 00 00 00` at u32 alignment, validate by reading the next ~21 bytes and ensuring tax_byte at +21 is in [0..4].

#### Byte map table (relative offset from tax_byte = 0)

| Offset | Width | Confidence | Meaning | Evidence |
|---|---|---|---|---|
| -21..-18 | u32 | CONFIRMED | Settlement record type tag = `0xcb` | 348 occurrences in save_2.0; precedes every settlement |
| -17..-1 | 17B | STRUCTURAL | Header padding / linkage (varies between Rome/Brundisium) | layout differs by settlement class |
| **+0** | **u8** | **CONFIRMED** (prior) | **Tax level enum**: 0=low, 1=normal, 2=high, 3=very_high, 4=exempt | Sparta tax triple |
| +1..+27 | varies | UNDECODED | Record-type-specific prefix (differs Rome vs Brundisium); contains some u32s | both samples differ structurally |
| **+28** | **u8** | **CONFIRMED** | **Turn counter for this settlement's owner faction** — value = 11 (turn 5 player), 12 (turn 6 player), 10 (turn 5 AI factions), 0 (rebel/inactive settlements) | rome1..rome6 = 11, rome7..rome9 = 12 (turn boundary), rome10 = 11 (different session, same turn). 1222 of 1304 settlements have +28=10 (AI), 25 have 11 (player Rome), 57 have 0 (rebel) |
| +29..+33 | 5B | CONSTANT | `00 00 64 00 00 00` style padding | most saves identical |
| **+34** | **u8** | **STRONG** | **Public-order / loyalty tracking byte**, increments at turn boundary (100 → 195 between rome6→rome7) | only changes at turn boundary |
| +35..+37 | 3B | CONSTANT | zeros | |
| **+38** | **u16** | **STRONG** | **Snapshot value for population (likely "previous-turn-end pop")**: rome=400, rome7-9=8955. Note 8955 = 9000 − 45. The current pop is 9000 in all rome1..rome6, drops to 9000 at rome7 onward but +2235 also reads 8955 in rome7. So +38 might be **per-turn pop delta** or **last-turn pop**. | turn-boundary delta of 8555 (=8955 from a 400-base) needs cross-check |
| +42 | u8 | STRONG | Boolean flag (1 → 0 at turn boundary in rome corpus) — **possibly "tax was edited this turn"** | rome1..rome6=1, rome7..rome9=0 |
| +50 | u8 | STRONG | Boolean flag (0 → 1 at turn boundary) — possibly "needs-recalc this turn" | rome1..rome6=0, rome7..rome9=1 |
| +54 | u8 | HYPOTHESIS | Decreasing counter (5 → 2 at turn boundary). Could be "turns until next event" or "construction turns remaining" | inverse direction from +28 |
| **+62** | **u8** | **STRONG** | **Settlement size-class enum**: 0=village/dummy, 1=town, 2=large_town, 3=city, 4=large_city, 5=huge_city. Rome=4 (large_city), Sparta=2 (large_town), Carthage=5 (huge_city). | matches descr_strat for Rome+Sparta directly; 463 settlements at value=2 (large_town), 674 at value=1 (town), 89 at value=3 (city), 15 at value=4 (large_city), 4 at value=5 (huge_city). Matches expected RIS imperial settlement-class distribution. Some "noise" values (109, 12, 156) suggest a few settlements have a non-standard layout where +62 lands in a different field — likely captured/transitional cities |
| +63..+78 | 16B | CONSTANT | Mostly zeros + structural | |
| +79..+86 | 8B | RECORD-DERIVED | u32 + u32 — fingerprint values shared across rome corpus (=1759193926 / 100), differ for Sparta. **Likely settlement-id-derived hashes / region tag pair.** | constant within each settlement |
| +87..+288 | 202B | CONSTANT (zeros) | Padding zone — possibly reserved for future expansion or unused capacity | all zeros across entire corpus |
| +289 | u8 | INTER-FACTION | Constant 0 in rome saves, 100 in sparta (some flag) | |
| +290..+324 | 35B | CONSTANT (zeros) | Padding | |
| **+325..+340** | **16B** | **CONFIRMED** | **4× u32 RUNTIME POINTERS** (game session pointers, change every game session). Verified: rome5 vs rome10 (same in-game turn, different sessions) — these 16 bytes differ; rome1..rome9 (same session) — these 16 bytes stay stable per character but differ per session. NOT real save data — engine writes them but doesn't trust them at load. Same architecture as character `secondaryUuid` runtime/save mismatch (dossier already documents this for chars). | session-by-session diff; 16 bytes = 4 u32 = 4 truncated 64-bit pointers |
| **+341** | **u32** | **CONFIRMED** | **Settlement map X-coordinate (tile)**. Rome=285, Sparta=397, Carthage=257, Arretium=278, Pisae=263. Cross-validated against `descr_strat.txt` (Etruria resources at X 270-280 — match Arretium/Volaterrae). | matches coordinate clusters in descr_strat resource lines |
| **+345** | **u32** | **CONFIRMED** | **Settlement map Y-coordinate (tile)**. Rome=404, Sparta=338, Carthage=333, Arretium=427, Pisae=431. | same evidence |
| **+349..+352** | **u32** | **CONFIRMED** | **Runtime pointer #5** (4 bytes; differs between sessions, stable within session) | rome5=0x1249128a, rome10=0xc34df117 |
| +353..+371 | 19B | CONSTANT (zeros) | Padding | |
| +372..+375 | u32 | UNDECODED | Sparta=`ff ff ff ff` (-1), Rome=1. **Possibly governor charUuid placeholder** (-1 = no governor) | sparta vs rome |
| +384 | u8 | UNDECODED | 1 in rome, 0 in sparta | |
| +388..+391 | u32 | RUNTIME-PTR | rome5=`d0 24 d8 2c` = 752362704; same value rome1..rome10. Hex pattern looks like a stable HASH not a pointer (rome10 has same value as rome5). | stable across rome corpus including separate session rome10 |
| +392..+634 | 243B | CONSTANT (zeros) | Padding | |
| +635 | u8 | INTER-FACTION | rome=11, sparta=6 | |
| +636..+678 | 43B | CONSTANT | Mostly zeros + sparse constants | |
| **+679** | **u32** | **STRONG** | **Last-turn population growth or income u32** — increments turn-by-turn (rome1=0, rome2-6=15, rome7-9=34). Sparta=0 (turn 1?). **Hypothesis: cumulative income earned at this settlement.** | growth in lockstep with turn boundaries |
| **+683** | **u32** | **STRONG** | **Per-turn settlement income** (denarii): rome1=924 (initial), rome2-6=902, rome7-9=860 (declines as turns pass). Sparta=444. Plausible game-state income value. | declines monotonically over turns; magnitudes match a city of Rome's tier |
| **+687** | **u32** | **STRONG** | **Cumulative settlement income / treasury contribution**: rome1=6295, rome2-6=6131, rome7-9=5532. Sparta=2549. ~7× the per-turn income — fits "income summed over campaign turns so far". | scales with +683 in expected ratio |
| +711 | u8 | INTER-FACTION | Schema/version byte: rome=11, sparta=6 (matches +28 / +635 pattern: per-faction tag) | |
| +715/+723/+727 | u8 | TURN-BOUNDARY | small-int flags that flip 0→1, 0→3, 0→0xf1 between rome6 and rome7 — turn-end recalculation flags | |
| +743 | u8 | INTER-FACTION | rome=7, sparta=2 | |
| **+775** | **u32** | **CONFIRMED** (prior) | **Live citizen population** | dossier finding |
| +776 | u8 | DECODE-DERIVED | upper byte of +775 | |
| +781..+782 | u16 | TURN-BOUNDARY | rome1..6=16768 (=0x4180=18.0 LE-f32 hi half), rome7-9=16768, sparta=16384 (=0x4080 = 4.0 LE-f32 hi half) — the f32 starts at +779 — **f32 looking at +779 reads ~4.0 for Rome** | could be city-size coefficient |
| +785 | u8 | TURN-BOUNDARY | 64 → 160 at turn boundary | |
| +789..+790 | 2B | TURN-BOUNDARY | 0,0 → 224,192 between rome6→rome7. **f32 at +787 reads as 0.0 in rome1-6, 9.5 in rome7-9** — potentially squalor / unrest accumulator | |
| +793..+794 | 2B | TURN-BOUNDARY | similar transition | |
| +817..+818 | 2B | TURN-BOUNDARY | 0,0 → 64,64 (= f32 hi half of 3.0) at turn boundary | |
| **+819** | **f32** | **STRONG** | **Settlement-class-derived size multiplier**: Rome=4.0, Sparta=1.0. May be growth-rate or squalor multiplier proportional to (size_class - 1). | |
| +822 | u8 | RECORD-DERIVED | f32 in upper-half pattern; differs Rome vs Sparta | |
| +1081..+1095 | 15B | TURN-BOUNDARY | Cluster of u32-shaped fields that all change at the rome6→rome7 boundary — likely **per-turn growth/squalor/income recalc snapshot**. +1083 u32: rome=968, rome7-9=1728, sparta=528. +1087 u32: rome=936, rome7-9=1216, sparta=772. +1095 u32: rome=222, rome7-9=830, sparta=54. | |
| +1115..+1116 | 2B | TURN-BOUNDARY | rome=127, rome7-9=377 — another turn-boundary recalc | |
| +1127..+1132 | u32+u32 | DUPLICATED INCOME | **+1127=924 (rome1..6), 902 (rome7-9), 924 (rome10), 444 (sparta)** — same shape as +683 but ONE TURN LAGGED (rome1's +683=924, rome2's +683 already dropped to 902, but +1127 stays at 924 until turn 6). **+1127 = "last-turn-end income snapshot"** while +683 = "this-turn live income". Same logic for +1131 (matches +687 with one-turn lag). | dual-buffered income tracking |
| +1163..+1164 | u32 | TURN-BOUNDARY | rome=2126, rome7-9=3774, sparta=1354 — yet another turn-boundary recalc | |
| +1167 | u8 | CONSTANT | =53 across entire corpus | |
| +1171 | u8 | INTER-FACTION | rome=100, sparta=0 | |
| +1172..+1334 | 163B | CONSTANT | mostly zeros | |
| +1335 | u8 | INTER-FACTION | sparta=100, rome=0 | |
| +1336..+1382 | 47B | CONSTANT | zeros | |
| +1383..+1395 | 13B | INTER-FACTION | sparta has values 41,3,5; rome zeros. Settlement-class-derived | |
| +1396..+2046 | 651B | CONSTANT (zeros) | Padding zone | |
| +2047/+2051/+2083 | 3 bytes | INTER-FACTION | sparse non-zero in sparta only | |
| +2084..+2234 | 151B | CONSTANT (zeros) | Padding | |
| **+2235** | **u32** | **HYPOTHESIS** (prior) | **Pre-turn population snapshot** — equals current pop within turn, but at turn-end recalc: rome7's +775 (live pop) is still 9000 but +2235 dropped to 8955. **+2235 likely = "previous-turn-end population"** snapshot used to compute growth rate. | rome6=9000 / rome7=8955 — turn boundary delta of 45 |
| **+2239** | **f32** | **CONFIRMED** (prior) | **Public order / happiness raw score** | tax-triple finding |
| +2241..+2242 | 2B | DECODE-DERIVED | upper bytes of happiness f32 (changes when tax level changes) | |
| +2243..+2254 | 12B | CONSTANT (zeros) | Padding | |
| +2255..+2262 | 8B | STRUCTURAL | u32 + u32 = two self-pointers (e.g. rome5: `4e 5f f8 00 52 5f f8 00` = file offsets 0xf85f4e + 0xf85f52). These ARE self-pointers within Rome's own record. Standard taw section grammar. | both u32s equal current file position |
| +2263..+2269 | 7B | STRUCTURAL | structural prefix `00 00 ef 00 00 00 01` — leads into name marker | |
| **+2269** | **u8** | **CONFIRMED** | **Settlement name marker = 0x01** | dossier |
| **+2270..+2271** | **u16** | **CONFIRMED** | **Settlement name length** (UTF-16LE chars) | |
| **+2272..** | **var** | **CONFIRMED** | **UTF-16LE settlement display name** ("Rome", "Sparta", ...) | |
| +past-name..+2395 | varies | STRUCTURAL | post-name padding + filler `fc fc fc fc` | |
| +2396 / +2399 | varies | ASCII | **`default_set` plan_set name** (length-prefixed ASCIIZ at start of plan-set sub-record) | matches descr_strat `plan_set default_set` |
| +2408 | u32 | STRUCTURAL | self-pointer to a building-chain sub-record (varies by settlement class) | |
| +2420..+2425 | 6B | RUNTIME-PTR | **second runtime-pointer cluster** (changes between rome5 and rome10) | session-stable |
| +2465..+2495 | 30B | building1 sub-record header + payload | self-ptr + u16 len + ASCIIZ name (`hinterland_region`) + payload | each building-chain entry follows the same shape |
| +2497..+2500 | u32 | RUNTIME-PTR | **third runtime-pointer cluster** | session-stable |
| +2517..+2544 | 28B | TURN-BOUNDARY/CONSTANT | mostly constant in rome (some turn-boundary 0→ef fluctuation) — likely **building completion progress** counter | |
| +2781..+2807 | 27B | building2 sub-record | self-ptr + len + ASCIIZ (`core_building`) + payload | |
| +2809..+2812 | u32 | RUNTIME-PTR | **fourth runtime-pointer cluster** | |
| +2829..+2856 | 28B | TURN-BOUNDARY/CONSTANT | second building progress counter | |
| +3093..+3117 | 25B | building3 sub-record | self-ptr + len + ASCIIZ (`governmentA` Rome / `governmentC` Sparta — matches descr_strat governmentC for Sparta; `governmentA` for Rome diverges from descr_strat-stated `governmentD`, suggesting the engine REWRITES the chain at runtime when Rome's empire-tier triggers a rebuild) | |
| +3135..+3138 | u32 | RUNTIME-PTR | **fifth runtime-pointer cluster** | |
| +3160..+3166 | 7B | TURN-BOUNDARY | building3 progress counter | |
| +3403..+3489 | 87B | building4 sub-record (Rome only — Sparta's record ends here in `ff` filler) | self-ptr + len + ASCIIZ (`military_industrial_complex`) + payload | this ~300B block is the source of the bimodal stride distribution: large_city tier has it, large_town tier doesn't |
| +3451..+3454 | u32 | RUNTIME-PTR | **sixth runtime-pointer cluster** | |
| +3486..+3489 | 4B | TURN-BOUNDARY | building4 progress | |
| +3490..+3705 | varies | 0xff filler | **inter-record padding**; in Rome this is shorter, in Sparta the entire +3403..+3705 region is 0xff (Sparta has no 4th building chain) | |
| +3706..+3727 | 22B | NEXT-RECORD HEADER | belongs to the NEXT settlement's `cb 00 00 00 ff ff ff ff ...` header (i.e. relative offset of next tax_byte = +3727 in Sparta but varies in others) | |

#### Newly identified fields (this session)

| Confidence | Field | Offset | Type | Description |
|---|---|---|---|---|
| **CONFIRMED** | Settlement map X | +341 | u32le | In-game tile X coordinate |
| **CONFIRMED** | Settlement map Y | +345 | u32le | In-game tile Y coordinate |
| **CONFIRMED** | Settlement size class | +62 | u8 | 0=village, 1=town, 2=large_town, 3=city, 4=large_city, 5=huge_city |
| **CONFIRMED** | Owner-faction-turn tag | +28 | u8 | 11=player Rome turn 5, 12=player Rome turn 6, 10=AI factions, 0=rebels — tracks owner-faction's relative turn index |
| **CONFIRMED** | Settlement-record-type tag | -21 (= +3707 from prior tax_byte) | u32le `0xcb` | Universal settlement-record signature, useful structural anchor |
| **STRONG** | Per-turn settlement income | +683 | u32le | Denarii income produced this turn (current value) |
| **STRONG** | Cumulative settlement income | +687 | u32le | Sum of denarii produced across all turns (or last-N-turn aggregate) |
| **STRONG** | Last-turn-end income snapshot | +1127 | u32le | One-turn-lagged copy of +683 (dual-buffered for delta computation) |
| **STRONG** | Last-turn-end cumulative snapshot | +1131 | u32le | One-turn-lagged copy of +687 |
| **STRONG** | Settlement-class growth multiplier f32 | +819 | f32le | 4.0 for large_city Rome, 1.0 for large_town Sparta — likely tier-derived growth/squalor coefficient |
| **STRONG** | Settlement size-class enum (alt encoding) | +62 | u8 | Same as above; primary storage |
| **HYPOTHESIS** | Cumulative income (low) | +679 | u32le | rome1=0, rome2-6=15, rome7-9=34 — small accumulator, possibly per-turn-growth events count |
| **HYPOTHESIS** | Tax-edited-this-turn flag | +42 | u8 | 1=edited or fresh, 0=stale (flips at turn boundary) |
| **HYPOTHESIS** | Recalc-needed flag | +50 | u8 | 0=clean, 1=needs-recalc (flips at turn boundary) |
| **HYPOTHESIS** | "Turns since last event" countdown | +54 | u8 | 5 → 2 across turn 5 → 6 — could be construction-turns-remaining for current build queue |

#### Stable session-runtime pointers (NOT real save data)

The settlement record contains **6 runtime pointer clusters** at relative offsets +325..+340 (4 ptrs), +349..+352 (1 ptr), +388..+391 (1 ptr), +2420..+2423 (1 ptr), +2497..+2500 (1 ptr), +2809..+2812 (1 ptr), +3135..+3138 (1 ptr), +3451..+3454 (1 ptr). Total ~11 truncated pointers (44 bytes) per settlement record. These match the dossier's existing observation that "runtime uuids vs save uuids — they DO NOT match" for character records — same architecture extended to settlements. A parser writing back these bytes can use any value; the engine ignores them at load.

#### Coverage summary

- **3326 / 3728 bytes** (89.2%) classified as CONSTANT (zeros, 0xff filler, or stable structural constants) — minimal information content, but useful as an alignment validator
- **402 / 3728 bytes** (10.8%) classified as CHANGING — of these:
  - **44 bytes** are runtime-session pointers (no semantic content)
  - **86 bytes** are ASCII strings inside building-chain sub-records (decoded as plain text; building chain identifies the building type)
  - **~80 bytes** map to identified fields with CONFIRMED or STRONG confidence (tax, size, X, Y, pop, pop2, happiness, +28 turn tag, income u32 cluster)
  - **~190 bytes** are turn-boundary recalc snapshots inside known sub-records — recoverable as additional fields with one more save-pair pass each
- **5 named building-chain sub-records** identified inside Rome's record: `default_set`, `hinterland_region`, `core_building`, `governmentA`, `military_industrial_complex` — each with the standard `[u32 self-ptr][u16 nameLen][ASCIIZ name]` header

#### Caveats / things that did not validate

- **+62 size-class enum has noise**: 23 settlements in save_rome5 have +62 values like 109, 12, 156, 27 that don't match the 0..5 scheme. These are likely settlements where the tax_byte anchor is misaligned (perhaps captured cities, mid-construction, or a different sub-class tag). For a production parser, validate +62 ∈ [0..5] and fall back to descr_strat lookup by name otherwise.
- **+28 turn-tag interpretation is partial**: value 11 for player Rome at turn 5 doesn't equal the turn count directly (turn=5, value=11 = 2*turn+1?). The 0/10/11 split per faction-class is solid but the exact arithmetic isn't pinned.
- **+819 f32 = 4.0 for Rome, 1.0 for Sparta** could plausibly be MANY things (tier-coefficient, max-pop-multiplier, growth-rate-multiplier). Distinguishing requires a settlement that levels up between two saves.
- **+679 / +683 / +687 income hypothesis** is unvalidated against the actual game-displayed income for Rome at turn 5. The values (924 d/turn for Rome) are plausible but only an in-game UI screenshot would confirm the interpretation.

---

### Character record byte map (background session 4)

Goal: exhaustive byte-by-byte map of the CHARACTER record interior, pushing coverage well beyond the ~5 known fields documented before this session. Method: anchor on `findCharacterRecords` from `src/characterParser.js` — the parser already knows two record layouts (LAYOUT_A surnamed at +302 traitCount, LAYOUT_B single-name at +298). For each save pair, match characters across saves by `primaryUuid + firstName + lastName` and tabulate which interior bytes flipped, then sample value transitions to interpret.

**Corpus used:**
- `save_rome5..sav` ↔ `save_rome6.sav` — within-turn (Roman general moves 1 tile, frame counter bumps); 0 record-interior diffs.
- `save_rome6.sav` ↔ `save_rome7.sav` — turn 5 → turn 6 boundary (936 → 987 chars; 25 LAYOUT_A + 911 LAYOUT_B matched).
- `save_Autosave Sparta Turn 4 End.sav` ↔ `save_Autosave Sparta Turn 5 Start.sav` — clean turn boundary, 1337 chars matched (largest signal sample).
- `save_Autosave Athens Turn 22 Start.sav` ↔ `save_Autosave Athens Turn 22 End.sav` — within turn, 1941 chars matched, isolated 2 character DEATHS (Herakleides + Hierokles).
- `save_rome1..rome10.sav` — Aulus Gabinius (LAYOUT_A roman family) and Bouzos (LAYOUT_B captain) tracked across all 10 saves to identify per-turn drift.

**Coverage achieved**: bytes mapped in record header `0..301` (LAYOUT_A): **265 / 302 = 87.7%** when including padding zones marked CONSTANT 0 / sentinels. New named fields: **8** beyond the prior ~5. Total fields now identified in the record header: **13 named + 7 padding/sentinel zones**.

#### New CONFIRMED fields (cross-validated ≥2 independent observations)

##### 1. Fine-grained age u16le at `+86` — CONFIRMED

**u16le at +86 ≈ age × 64 + birth_offset (0..63)**. Increments by exactly 64 every campaign turn. Verified on 1263 / 1304 (96.8%) of characters with `age > 0` in `save_Autosave Sparta Turn 4 End.sav`: `u16le(+86) - age*64 ∈ [0, 63]`. The remaining 3.2% are characters with role discrepancies or age-0 newborns where parser-reported age is 0 but the lifetime tick is small (6-7).

Across the Sparta T4-end → T5-start turn boundary, 940 / 1219 changing characters had byte +86 increment by exactly +64 (mod 256), with byte +87 (high half of u16) bumping +1 every 4 turns when the low byte wraps. **Implications:**
- RIS imperial campaign uses **4 ticks per year** for the fine age timer (each turn = 1 tick = 64 lifetime units; 4 turns = 1 year = 256 units = byte+87 +1).
- The low 6 bits of byte +86 are the character's **birth offset within their birth year** — stable across the character's lifetime.
- Combined with byte +26 (yearly age = `242 - byte`), the engine has redundant age representations: coarse year-aged for trait threshold checks, fine ticks for event scheduling.

##### 2. Death-marker u32 at `+34` — CONFIRMED

When a character dies, bytes `+30..+33` flip from `00 00 00 00` to `f7 fe ff ff` (= 0xfffffef7 as u32 LE = -265 i32). Witnessed for both Herakleides (age 52) and Hierokles (age 15) in the Athens T22 within-turn diff — both characters' secondaryUuids at `-43..-40` were also zeroed in the same diff. The parser's existing `isDead` heuristic reads byte +34 (`d34`) and treats `>= 0xf0` as dead — that's correct but the field is actually the u32 starting at +30 carrying the negative-sentinel value 0xfffffef7. Two independent same-turn deaths confirm.

##### 3. Death-cause u32 at `+82` — STRONG

In the same Athens T22 death diff, byte +82 went from `00 00 00 00` to `03 00 00 00` for both Herakleides AND Hierokles. Two independent deaths in the same turn both write `3` at the same offset. Best-guess: **death-cause enum** (3 = old age / natural? Both chars were oldest in their families). The single-turn correlation is strong but interpretation needs more death samples (assassination, battle, plague) to disambiguate.

##### 4. 12-byte character birth-seed at `+50..+61` — STRONG

Three consecutive u32s at +50, +54, +58 form an apparent 12-byte hash. For Aulus Gabinius across rome1/rome2/rome3/rome5/rome7/rome9: `ca c0 5c c8 37 80 8f a1 39 56 d7 6c` — **byte-identical across all 6 saves** (including the rome6→rome7 turn-boundary save and an aged-Aulus save). Stable through gameplay = creation-time hash, not state. Likely the **character's deterministic event seed** used by the engine for trait-trigger random-number choices.

##### 5. Per-turn marker byte at `+122` (LAYOUT_A) — STRONG

For LAYOUT_A characters, byte +122 toggles 0→255 between consecutive turns. In the rome6→rome7 boundary, **all 25 LAYOUT_A characters** went from `{0:19, 1:1, 255:5}` to `{255:24, 254:1}` — i.e. essentially everyone has +122=0xff after the turn end. This is a **"processed-by-turn-end" flag** — the engine sets it on every character when ticking the turn. (LAYOUT_B has different semantics at the corresponding shifted offset; LAYOUT_B's +122 was seen incrementing by +9 on Sparta T4→T5 in 788 chars, distinct field.)

#### New STRONG fields (one clear observation + plausible interpretation)

##### 6. Per-turn temporary stat i32 at `+150` — STRONG

i32 at +150 holds values clustered around -100, -90, -95 etc. (multiples of 5/10) before turn end, then **resets to 0** at the next turn-start. Distribution at Sparta Turn 4 End: 667 chars at -100, 411 at 0, 69 at -90, 41 at -95, ranges -200..+50. At Turn 5 Start: 1102 at 0, with smaller spread. **Best-guess: a per-turn morale/loyalty/influence delta accumulator** — the engine tallies turn-event-driven deltas during the turn, applies them at turn-end, then zeroes the accumulator for the next turn. The same field changed for 919 of 1337 characters (68.7%) at the Sparta turn boundary.

##### 7. Role-class u32 at `+38` — STRONG

The byte-level `role` at +42 is well-known (0..10). Bytes +38..+41 form a u32 that mirrors the role byte (= 0x00000002 for Aulus's role=2). Likely a **wider role/character-type discriminator** with the role byte at +42 being the low byte. Distribution warrants its own probe.

#### New HYPOTHESIS-level fields

##### 8. Commission/state u16 at `+98` — HYPOTHESIS

u16le at +98 in Sparta T4 End: 768 chars at 0, 191 at 1, 117 at 2, 71 at 0xffff (-1 sentinel), 60 at 3, etc. Small ints + sentinel — looks like a **commission counter** (years remaining on an assignment) or **available action slots**. Need a save pair where a known commission is granted/expires.

##### 9. State-state u8 at `+178` — HYPOTHESIS

LAYOUT_B characters often have +178 decrement by 1 per turn (2→1→0). Possible **commission timer** that counts down toward 0. Not isolated — the bytes at +178..+181 are correlated, hinting at a 4-byte structure.

##### 10. Stat counter u8 at `+218` — HYPOTHESIS

Byte +218 increments by +5 across turn boundaries for many characters (Biggus_Dickus, Hanno, Hamilcar, Adherbal, Hasdrubal all +5 between rome6→rome7). Non-uniform — some +1, some +2. Consistent with **xp-per-turn at 5 base rate** or a **battle-influence stat that ticks up**.

##### 11. Small-enum u8 at `+88` — HYPOTHESIS

u8 with values mostly in {0,1,2,3} (4 distinct), distribution non-uniform. Doesn't correlate cleanly with role byte. Possible **family-status flag** (single, married-in, married-out, dead-spouse) or **diplomatic stance**. Need a marriage event isolation.

#### Trait-block structure — REFINED + RETRACTED

Session-2's hypothesis that the trait block contains **8-byte entries with second u32 in big-endian** is **RETRACTED**. In Aulus Gabinius's record (rome5, traitCount=29 at +302, traits start at +308), reading every entry as `[u32 id LE, u16 level, u16 flag]` yields 28 valid trait names from RIS's `export_descr_character_traits.txt`:
- Entry 0 +308: id=3686 (`ArchonHiereonZalmoxou`) lvl=1
- Entry 1 +316: id=3685 (`Former_Mercenary`) lvl=4
- Entry 2 +324: id=38 (`Political_General`) lvl=3
- ...
- Entry 28 +532: id=3835 (`Iberian_Rite_Passed`) lvl=0 flag=53 — **TERMINATOR**

The terminator entry (last slot) carries `lvl=0` and a non-zero `flag` u16 (53 for most Roman LAYOUT_A chars, 108 for captain-card chars, etc.). The flag value is likely the count or hash of something else — **possibly the ancillary count that follows externally**, or a trait-system version marker. **The terminator is a real entry slot, not separator bytes** — `traitCount` reflects the slot count including it.

The session-2 BE u32 reading was a numeric-coincidence artifact: many trait IDs are small and fit in a single byte, so misinterpreting LE-as-BE produced reasonable-looking numbers (e.g. id=102 BE = id=0x66000000 LE which shows as huge but the low byte 0x66 = 102 is the actual id when read LE). The real format is uniform LE u32.

**Ancillaries are NOT mixed into the trait block.** Aulus's 29 entries all resolve as valid trait names from `export_descr_character_traits.txt`; none correspond to ancillary IDs from `export_descr_ancillaries.txt`. Where ancillaries live is now an **open question** for a future session — they are NOT in the byte range +0..+540 of Aulus's record (the trait block ends right at +540 and portrait paths start immediately). Possibilities: a separate per-character ancillary section in the body, or hidden behind one of the small-int fields like the +98 u16.

#### Header byte map (LAYOUT_A; LAYOUT_B is the same with `-4` shift after +5)

```
+0    u32  firstNameIdx (LE)               CONFIRMED
+4    u8   gender (1=M, 2=F)               CONFIRMED
+5    u32  lastNameIdx (LE)                CONFIRMED (LAYOUT_A only)
+9    u8   pad9 = 0                        CONFIRMED
+10..+17  zero padding                     CONFIRMED
+18   u32  0xffffffff sentinel (variable family link)  STRONG
+22   u32  0xffffffff sentinel             STRONG
+26   u8   age = 242 - byte                CONFIRMED
+27..+29  age field high bytes 0xfeffff    CONFIRMED
+30   u32  death-marker (0=alive, 0xfffffef7=dead)  CONFIRMED ◆ session 4
+34   u32  zero / death continuation       (already in parser)
+38   u32  role-class wide                 STRONG ◆ session 4
+42   u8   role byte (0..10)               CONFIRMED
+43..+45  padding                          CONFIRMED
+46   u32  fatherUuid                      CONFIRMED
+50   12B  character birth-seed hash       STRONG ◆ session 4
+62..+81  zero padding                     CONFIRMED
+82   u32  death-cause (0 alive, 3 natural?)  STRONG ◆ session 4
+86   u16  fine age (= age*64 + birth_off) CONFIRMED ◆ session 4
+88   u8   small-enum {0,1,2,3}            HYPOTHESIS ◆ session 4
+89   u8   pad = 0                         CONFIRMED
+90..+97  small char-specific data + 4-byte reserved
+98   u16  commission/state counter        HYPOTHESIS ◆ session 4
+100  u16  small-int + 0xffff sentinel     HYPOTHESIS ◆ session 4
+102..+121  per-character counters / flags
+122  u8   "processed-by-turn-end" flag (LAYOUT_A) STRONG ◆ session 4
+126..+149  padding
+150  i32  per-turn temporary stat (resets at turn boundary) STRONG ◆ session 4
+154..+177  padding
+178  u8   state-state (decrements per turn for LAYOUT_B) HYPOTHESIS ◆ session 4
+182..+217  padding
+218  u8   xp-or-stat (+5 per turn)        HYPOTHESIS ◆ session 4
+222  u8   small counter                   HYPOTHESIS ◆ session 4
+226..+297  padding
+298  u16  traitCount (LAYOUT_B)           CONFIRMED
+302  u16  traitCount (LAYOUT_A)           CONFIRMED
+308..+(308 + 8*tc)  trait entries [u32 id LE, u16 lvl, u16 flag]  CONFIRMED ◆ session 4 (BE retracted)
   Last entry is TERMINATOR with lvl=0 and flag in {53, 108, ...}
+(308 + 8*tc)..  portrait paths (u16-prefixed UTF-8 cstrings, 2 entries per char)
```

Pre-record:
```
-47  u32  primaryUuid                      CONFIRMED
-43  u32  secondaryUuid (zeroed on death)  CONFIRMED
```

#### Reproducer scripts

All findings reproduce via `scripts/save-cracker/dig-charmap{2..8}.js` — no new dependencies beyond `src/characterParser.js`. Key one-liner for the +86 confirmation:

```bash
node -e "const cp=require('./src/characterParser.js'); const fs=require('fs'); const buf=fs.readFileSync('save_Autosave   Sparta   Turn 4 End.sav'); const r=cp.findCharacterRecords(buf,nameLookup,traitNames,null); let ok=0; for(const c of r) if(c.age>0 && Math.floor((buf.readUInt16LE(c.offset+86)-c.age*64)/64)===0) ok++; console.log(ok+'/'+r.filter(c=>c.age>0).length);"
```

#### Open questions for future sessions

- **Ancillaries**: location in the save unknown. Probe candidates: a separate body section indexed by character uuid, an external `[count][entries...]` block referenced by one of the small-int fields, or hidden after the second portrait path. Use a save pair where a character explicitly gains a known ancillary (`message_log` "Acquired Ancillary" event) to find it.
- **Command/Management/Influence stars**: not yet localized. Each is 0..10 in the UI. Candidates inside the +90..+220 small-int forest. A save pair where a character levels up CMD via traits is the cleanest probe.
- **Bodyguard size**: should mirror unit-record `soldiers` field (already known). Session-1 found bodyguard MP at `commanderUuid+4` — bodyguard size would be at `commanderUuid+8` (the next `soldiers` u32 in the unit layout).
- **Spouse / child UUIDs**: fatherUuid is at +46. Spouse is likely adjacent (+50 conflicts with the 12-byte seed; could be at `+38` slot). Child UUIDs could live in a variable-length array tied to one of the trailing zero-padding zones.
- **Trait `flag` u16 at entry+6**: terminator carries non-zero `flag` (e.g. 53). Could be a trait-event timestamp, a giver-character-uuid partial, or a "trait_id_sentinel" version. Sample varies by character so it carries SOME info — needs a probe across same character before/after gaining a trait to see if the flag is set on the new entry too.

---

### Findings 2026-05-10 (background session 5 — factions + treasury via section walk)

Goal: pin **per-faction current treasury (denarii)** and as much of the per-faction record layout as feasible. Session 2 attempted treasury via `captain_card_<faction>.tga` string proximity but failed because those tokens turn out to be per-character portrait references. This session located the per-faction record array via a structural signature derived from a unique-treasury anchor (Ptolemaic = 20000 denari, the only faction with a unique starting wealth in RIS imperial), then cross-validated against 14 saves spanning multiple campaigns and turn boundaries.

#### 1. Per-faction current treasury u32 at faction-record `+0` — CONFIRMED

The save contains a flat array of **23 "major faction" records** (RIS imperial has 23 playable factions; the remaining ~216 descr_strat entries are minor/rebel and use a different record format). Each major-faction record matches a fixed structural signature.

**Faction-record signature** (u32 at the byte offsets shown; multi-byte fields are little-endian):

| Δ | Width | Value | Meaning |
|---|---|---|---|
| `+0` | `u32` | **denarii (live treasury)** | CONFIRMED — see cross-validation below |
| `+4` | `u32` | **runtime pointer** (varies between game sessions) | NOT save data |
| `+8` | `u32` | `100` | **MAJOR-FACTION-CLASS TAG** — only the 23 playable factions carry this; minor factions don't match |
| `+12` | `u32` | `1` | constant version marker |
| `+16..+23` | 8 bytes | zeros | padding |
| `+24` | `u32` | **self-pointer** (== position+24) | section header |
| `+28` | `u32` | runtime hash | NOT save data |
| `+32..+39` | 8 bytes | zeros | padding |
| `+40` | `u32` | **self-pointer** (== position+40) | inner section header |
| `+44` | `u32` | `6` | size of the next sub-section (6 bytes) |
| `+48` | `u32` | **count N** (interpretation TBD — see caveat below) | STRONG signature, but interpretation is open |
| `+52..+(52+4N)` | `u32[N]` | **list of N region/homeland IDs (interpretation HYPOTHESIS)** | values are in the RIS region-id space (13..1306), but they **overlap heavily across factions** — only 152 unique IDs across 514 total slots in rome5. So the array is NOT "regions currently owned" (each region has exactly one owner). Likely candidates: homeland regions, claimed regions, or per-faction interest/spawn region list. |
| `+(92 + 4N)` | `u32` | **start-of-turn treasury snapshot** | STRONG — matches `+0` for AI factions (which don't spend during the player's turn) but differs for the player (who is mid-turn-spending). See finding #2. |

**Cross-validation of treasury at `+0` (CONFIRMED)**:

- **rome1..rome10** (RIS imperial, Romans Julii player, turn 5):
  - All 23 factions identified in identical position-order across all 10 saves.
  - `rome5/rome6` (within-turn): Ptolemaic=20000, Carthage=10000, Antigonid=7500 — exact starting denarii from descr_strat.
  - `rome7` (turn-6 start, after AI turn-end income/expenses): Ptolemaic=32083, Carthage=16981, Antigonid=24667 — all increased by plausible per-turn AI surplus (~5–17k denarii).
  - `rome10` (different game session, same in-game turn 5): all treasury values reset to start-of-turn (Romans Julii=10000 vs. 7610 in rome5 — rome10 is a session-start snapshot).
- **Saka T1 start** (descr_strat day 0): Saka=5000 at index 0 (player), Carthage=10000 at index 1, Antigonid=7500 at index 2, Ptolemaic=20000 at index 3, Seleucid=15000 at index 4, Bactria=5000 at index 5, Parni=10000 at index 6, Romans_julii=10000 at index 7 — **all 23 factions match descr_strat starting denari values byte-for-byte.**
- **Saka T1 → T2 boundary**: treasuries all shift to plausible new values (Saka 5000→6158, Carthage 10000→27093, Romans_julii 10000→-6492 (bankrupt!), Ptolemaic 20000→32538).
- **Athens T22 start**: 23 records, treasuries in the 200–41000 range (mature campaign). No record at the player's expected starting wealth, confirming this is mid-campaign state.
- **Sparta T4 end → T5 start**: Carthage 18460→17395 (lost 1065 from war or upkeep?), Ptolemaic 23642→-477, Romans_julii -13692→-14704 (still bankrupt).

**Faction-index ordering**: the **player faction is always at index 0** of the array. Remaining 22 factions follow descr_strat order minus the player-removed slot. Verified: rome saves index 0 = Romans Julii (regions=35); Saka save index 0 = Saka (regions=21); Sparta save index 0 = Carthage (regions=22; Sparta is a non-playable faction-class so doesn't get a major-class record — it must live in a different table). Athens save index 0 = Carthage (Athens also not in the 23-playable set).

The implication: **the 23 major-faction-class records are RIS's "great power" list** (Romans Julii, Carthage, Antigonid, Ptolemaic, Seleucid, Bactria, Parni, Saka, Armenia, Pontus, Lusitani, Getae, Acarnania, Achaea, Acragas, Aedui, Aetolia, Allobroges, Anatolians, Arevaci, Ardiaei, Argos, Arverni — 23 from a quick descr_strat scan of factions with `denari` lines). The player slot is moved to index 0. Sparta, Athens, etc. — non-major-class factions — must be in a separate per-faction table that this scan doesn't catch.

#### 2. Start-of-turn treasury snapshot u32 at `+(92 + 4N)` — STRONG

Located adjacent to the region-list end. Carthage rome5 (within turn 5): `+0`=10000 (current), `+180`=10000 (dup — same since AI hasn't spent). Carthage rome7 (turn-6 start): `+0`=16981 (current), `+180`=16981 (dup — same since turn just rolled). But for **Romans Julii rome5** (player, mid-turn-5): `+0`=7610 (already spent 2390 denarii this turn), `+232` (= 92 + 4×35) **=10000** (start-of-turn snapshot, unchanged).

Verified across 22 of 23 records in rome5: dup at `+(92 + 4N)` equals treasury at `+0` for every AI faction. Romans_julii (player) is the only one that differs — exactly as expected if the dup is a "treasury at start of this faction's turn" snapshot for delta-computation.

**Use case for parser**: `(current - snapshot)` gives the live net-spend so far this turn (player only; AI is always 0 within the player's turn).

#### 3. Region-list-shaped u32[N] at `+52..+(52 + 4N)` — STRONG (signature) / HYPOTHESIS (semantics)

The N u32s starting at `+52` are valid RIS region IDs (small ints 13..1306, matching the region-id space). N at `+48` ranges from 2 to 35 across the 23 factions in rome5.

**But these IDs overlap heavily across factions** — in rome5, the 23 records contain 514 total region-id slots but only 152 unique values. Records 5 (Bactria), 6 (Parni), 7 (Saka) share `13, 289, 395, 854, 973` as their first 5 IDs in different orders. Records 15/17/21 share `339, 397, 418, 574, 203` (different orders, all 24-region factions).

Since each region has exactly one owner in RTW, this CANNOT be "regions currently owned by the faction." Candidate interpretations:

- **Homeland regions** — the faction's traditional/cultural territory, used by the engine for "fighting in homeland" combat bonuses (homelands.json on Provincia side already maps faction → set of regions).
- **Claimed regions** — places the faction will path-find toward as expansion targets.
- **Adjacent region cache** — regions on the faction's border (read-mostly cache for AI pathing).
- **Starting position pool** — the descr_strat-listed starting regions, retained as immutable across the campaign.

A future probe should:
1. Diff a faction's `+52..` block across a save where the faction loses a region in conquest — if the list changes, it's "currently owned" or "claimed". If unchanged, it's "homeland/starting".
2. Cross-reference against Provincia's existing `homelands.json` — if it matches the homeland set for each faction, we're done.

**Conservative parser stance**: read N and the u32 array, but label them as "homeland-shaped region IDs" until validated.

#### 4. Faction array location — variable across saves

The 23-record array is contiguous in the body but its absolute offset varies between saves (file shifts from prior data). In rome1..rome10 it starts around 0x01541000 — 0x01700000. In Sparta/Athens saves it shifts further. **The signature itself is the locator**; scan for any u32 at file offset `i` with `u32(i+8)==100, u32(i+12)==1, u32(i+24)==i+24, u32(i+40)==i+40, u32(i+44)==6, u32(i+48) ∈ [0..200]` and group consecutive hits. The 23 records appear adjacent (each ~5,200–80,000 bytes from the previous, depending on per-faction trailing data).

Inter-record stride is NOT fixed — each record has trailing data (likely diplomacy attitudes, AI policy state, character spawn lists) of variable length. Adjacent records' positions in rome5 differ by:
- record 0→1: +208,001 bytes
- record 1→2: +205,490 bytes
- record 2→3: +492,118 bytes
- record 6→7: +22,572 bytes (smallest)

So the array is conceptually a sequence of variable-length records, each anchored by the +24/+40 self-pointers but with size info NOT in the header (the dossier's section grammar applies to inner subsections only — the full per-faction record extends until the next record begins).

#### 5. Half-2 marker record at faction-record-internal position — STRUCTURAL (Ptolemaic anchor only)

Within Ptolemaic's record (regions=31), at +216 from the record start (the treasury dup position), there's a 5-byte preamble (`c8 00 00 00 00`) followed by `[u32 treasury][u32 30][32+ bytes zeros][0xef markers]`. The u32 `30` is Ptolemaic's faction-id (matches dossier session 2's discovery that "Sparta's internal faction-id = 30 in this RIS imperial campaign save" — but that was the value 30 in Sparta's `captain_card_sparta`-marker record, which is now retracted as a per-character record. The `1e/30` here is a record-type tag, not necessarily a faction-id).

NOTE: this is observed cleanly only for Ptolemaic. For other faction records, the +(92+4N) treasury dup is followed by a different layout. Treat as an internal sub-structure of the per-faction record, not a portable signature.

#### 6. Field +4 (between treasury and the "100 1" version pair) — runtime pointer, NOT income

Initially looked like a net-income field (Carthage rome5: -14793; rome7: +33870; delta = +48663 = ~3× treasury delta). But cross-session comparison (rome5 vs rome10, same in-game state, different sessions) shows +4 changes value while treasury (+0) stays identical. So +4 is a **runtime pointer or session-stable hash**, not real save data. Confirmed by the dossier's prior architecture observation ("runtime uuids vs save uuids do not match").

24 runtime-pointer-shaped fields identified in the first 1600 bytes of Carthage's record: `+4, +24, +28, +40, +280, +284, +288, +292, +296, +300, +304, +308, +312, +892, +936..+948, +1028..+1044, +1076`. These all differ between rome5 and rome10 while treasury and region IDs stay stable.

#### 7. Per-faction trailing data — UNDECODED

After the region list, each faction record contains variable-length data presumably encoding:
- Diplomacy attitudes (per-other-faction relation state) — likely the 16-byte-stride array seen at Ptolemaic +pos before treasury, `03 00 00 00 00 XX XX XX 00 00 00 00 00 00 00 00` per other-faction
- Per-faction AI policy state
- Build queue / faction objectives  
- Construction-this-turn aggregator
- Military upkeep aggregator
- Naval upkeep aggregator
- Income breakdown (taxes, trade, mining, farming)

Carthage rome5 vs rome7 (turn-boundary) diff reveals fields at `+328, +1456, +1480, +1536` that change by +1, +1, +4, +1 respectively across the turn boundary — possibly turn counters or build-queue advance counters. But these positions are **not consistent across faction records** (record [4] has a different value at +328, etc.) — implying the post-region-list section is NOT byte-aligned across factions.

#### Targets not landed

- **Per-faction current military upkeep**: not pinned. Would require correlating in-game UI screenshots or summing per-unit upkeep across the army roster. Stretch goal not attempted in this session.
- **Per-faction construction spend this turn**: not pinned. The aggregator likely lives in the post-region-list trailing data of each faction record.
- **Per-faction unit count**: derivable from existing army parser (already counts units per faction); not a save-format question.
- **Diplomacy state vector**: the 16-byte-stride `03 00 00 00 00 XX XX XX 00 00 00 00 00 00 00 00` array before Ptolemaic's record is a strong candidate for the per-faction relation table — each entry is one "(this faction, other faction, hash)" triple — but identifying which 8-byte hash corresponds to which faction-pair needs a save where a known diplomatic state changes (e.g., war declared between known parties).
- **Non-major faction records**: Sparta and Athens are playable in some saves but don't appear in the 23-record array (their +8 is not 100). Their treasury must live in a different table — possibly a parallel array of "minor faction" records with a different version-tag, or as part of a per-settlement aggregate.

#### Reproducer

```bash
node scripts/save-cracker/dig-faction-track2.js  # dumps the 23 records for any save
node scripts/save-cracker/dig-faction-deeper.js  # diffs Carthage record across turn boundary
```

One-liner to read a save's treasury table:

```js
function readTreasuries(buf) {
  const out = [];
  for (let i = 0; i + 64 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    const treasury = buf.readInt32LE(i);  // signed, since bankruptcy gives negative values
    const turnStart = buf.readInt32LE(i + 92 + 4 * regions);
    out.push({ pos: i, treasury, turnStart, regions });
  }
  return out;
}
```

The first record is always the player faction. The remaining 22 follow descr_strat order with the player slot removed. Map index→faction-id by walking the descr_strat major-faction list (any line with `denari N` and AI value ≠ `ai_rebel`) and skipping the player.

---

### Findings 2026-05-10 (background session 6 — ancillaries + diplomacy)

Goal: locate (1) **character ancillaries** (session 4 confirmed they're NOT inside the trait block; session 2 hypothesis that they sit adjacent to traits was unverified) and (2) the **diplomacy state matrix** (the -34 cookie from "spartan general" was known but the actual per-faction-pair relation byte/u32 wasn't pinned).

Ancillaries: **fully decoded and cross-validated**. Diplomacy: **9-byte per-relation record stride STRONGly identified for Sparta** (26 records ending in `0xff` sentinels, byte 0 = state in [0..6]); semantic meaning of each enum value not yet mapped, and faction-id of the "other" side not yet extracted.

#### 1. Ancillaries — CONFIRMED, inline in character record between trait block and portrait paths

**Layout** (relative to character-record `offset`, where `tsOff = 308` for LAYOUT_A surnamed, `304` for LAYOUT_B single-name):

```
+tsOff..+(tsOff + tc*8)            traitBlock: tc * 8 bytes of [u32 id, u16 lvl, u16 flag]
+(tsOff + tc*8)..+(portraitStart)  ancillary section (see two sub-cases below)
+(portraitStart)..                 portrait1: u16 lenPrefix + ASCIIZ "data/ui/..."
                                   portrait2: u16 lenPrefix + ASCIIZ "data/ui/..."
```

Ancillary section has two shapes depending on whether the character has any ancillaries:

- **Sub-case A** (`gap = -2`, observed in 637 / 935 chars in save_rome6, ~68%): 0 ancillaries AND the last trait slot's `flag` u16 (offset `tsOff + (tc-1)*8 + 6..+7`) **overlaps with the portrait length prefix**. So the trait block ends exactly at the start of "data/" and the portrait length prefix is the last 2 bytes of slot `tc-1`. No bytes between trait_block_end and portrait data.

- **Sub-case B** (`gap >= 2`, observed in 211 / 935 chars in save_rome6): the ancillary section is `[u16=0, u16=ancId]` pairs immediately after the trait block, followed by a `[u16=0]` sentinel and then the portrait length prefix u16. So `gap = 2 + 4 * ancCount`:
  - `gap == 2`: 0 ancillaries (190 chars in rome6; just a `00 00` separator before the portrait length prefix)
  - `gap == 6`: 1 ancillary (43 chars)
  - `gap == 10`: 2 ancillaries (10 chars)
  - `gap == 14`: 3 ancillaries (11 chars)
  - `gap == 18`: 4 ancillaries (1 char)

The ancId u16 is a 0-based index into the mod's `export_descr_ancillaries.txt` (entries declared with `Ancillary <name>` — 1092 entries in RIS imperial; ID 0 = `labrys_maker`, ID 1 = `saffron_merchant`, …, ID 1091 = `priest_of_Zibelthiurdos2`).

**Cross-validation** — Ancillary lists are **stable across the rome1..rome10 save corpus** (10 saves spanning multiple turn boundaries and a different game session via rome10). Sample observations:

| Character | Faction culture | Ancillaries (id → name) |
|---|---|---|
| Hanno (Carthaginian) | carthage | 51=pontic_noble, 55=hellene_wife |
| Hannibal (Carthaginian) | carthage | 86=prophet_carthage1, 92=priest_of_Baal_Hammon |
| AntigonosB (Greek) | greek | 263=jeweller, 364=wrestler |
| Sadalas (Thracian) | greek | 262=intrepid_explorer, 947=Mandoni, 952=Aristonicus |
| Rhoigos (Thracian) | greek | 178=architect, 936=Wine_Horn1, 924=Fallow_Deer_Head, 948=Edeco |
| Marcus Livius_Drusus (Roman) | roman | (none — gap=-2 sub-case) |
| Aulus Gabinius (Roman) | roman | (none — gap=-2 sub-case) |

Each character's list **does not change** across rome6→rome7 turn boundary even when the same character GAINS new traits (e.g. Hanno's trait count goes 18→28 from rome6 to rome7 but his ancillary list stays at `[51, 55]`). At rome7 onward Hanno does have a NEW THIRD ancillary `170=Canaanchief_Commander` — so ancillaries DO change at turn boundaries when an event grants one.

**Parser** (Node.js): see `scripts/save-cracker/dig-anc5.js`, `dig-anc6.js`. The 9-line parser:

```js
function parseAncillariesAt(buf, charOff, layoutA) {
  const tcOff = layoutA ? 302 : 298, tsOff = layoutA ? 308 : 304;
  const tc = buf.readUInt16LE(charOff + tcOff);
  const trEnd = charOff + tsOff + tc * 8;
  // Scan for 'data/' to find portrait start
  let dataPos = -1;
  for (let i = 0; i < 200; i++) {
    if (buf[trEnd+i]===0x64 && buf[trEnd+i+1]===0x61 && buf[trEnd+i+2]===0x74 && buf[trEnd+i+3]===0x61 && buf[trEnd+i+4]===0x2f) { dataPos = i; break; }
  }
  if (dataPos === 0) return [];                              // gap=-2 sub-case
  if ((dataPos - 2) % 4 !== 2) return null;                  // malformed (skip)
  const N = (dataPos - 2 - 2) / 4;                           // entries before trailing zero sentinel
  const out = [];
  for (let i = 0; i < N; i++) {
    if (buf.readUInt16LE(trEnd + i*4) !== 0) return null;    // padding word must be 0
    out.push(buf.readUInt16LE(trEnd + i*4 + 2));             // ancId u16
  }
  return out;
}
```

Parser success rate against the full character list: save_rome6 = 892/936 (95.3%), save_2.0 = 910/936, save_Autosave Sparta Turn 4 End = 1237/1341. The failures are split between (a) `dataPos<0` cases where the parser couldn't find "data/" within 200 bytes (likely role-7+ "captain" records with different portrait conventions, ~20-40 per save) and (b) `ancRegionLen % 4 == 0` cases (22-65 per save) — likely cases where the "first data/" search found the SECOND portrait, indicating the first portrait is a non-data/-prefixed path (e.g. mod-folder paths starting with `Q:/Feral/...` instead of `data/`). Both are minor edge cases not affecting the layout finding.

**Retraction of session 4 trait-block "terminator" interpretation**: session 4 documented "the last entry's flag carries non-zero values like 53, 108" and treated this as a special "terminator marker". That was incomplete — for the `gap=-2` sub-case (most chars), the `flag=portLen` was just **the portrait length prefix overlapping with the last trait slot's flag bytes**. The last trait slot's `flag` is actually a *real trait flag* in the sub-case B chars where the ancillary section is non-trivial — values vary (39, 65, 178, 210, 288, 330, …) and don't carry obvious semantics yet.

**Open follow-up** for ancillaries:
- The `[u16=0]` "padding" before each ancillary id might encode an ancillary slot/type that the engine differentiates (e.g. weapon vs retinue companion vs item). All observed values are 0 in our corpus; need a save where someone has a typed ancillary slot filled to test.
- The 22-65 "ancRegionLen%4!=2" parse failures may indicate a SECOND ancillary-section format for certain character classes (priests? generals with non-standard portrait paths?). Worth investigating with a small probe.
- Ancillary effects (the descr-file `Effect` lines) are NOT stored in the save — only the id. Effect resolution is mod-data-driven at render time.

#### 2. Diplomacy — STRONG: 9-byte-per-record relation array, byte 0 = state enum (0..6); end-of-array signaled by 0xff sentinels

Save pair: `save_1turnstart.sav` (pre-war, Sparta has not yet declared war on Argos) vs `save_1.1.sav` (post-war, Sparta declared war on Argos and sieged Prasiai). Anchor: `captain_card_sparta.tga` ASCII path at file offsets `0x1c6afbd` (pre) / `0x1549189` (post). The "diplomacy cookie at -34 from spartan general" finding from the original dossier matches what we observe at the same relative position (also seen at `+182` from captain_card_sparta — same 4-byte hash repeated): `b8 5a be d5` → `6a a0 33 c1`.

**The actual per-relation records** sit at relative offset `+6306..+6540` (234 bytes = 26 records × 9 bytes) from `captain_card_sparta.tga`, followed by `0xff` filler sentinels filling the remaining "slots" of a fixed-size relation slot table.

Each record layout:
```
+0     u8    state enum (observed values 0..6)
+1..+4 u32   value ("runtime-shaped" — in 68M..74M range = 0x040E0000..0x047D0000)
+5..+8 4B    zeros (padding)
```

State enum values observed across the 26 Sparta-side records:
- pre-war: `[5,4,4,1,3,4,6,5,3,3,4,0,0,5,0,3,6,1,5,4,3,4,0,2,3,5]` then sentinels (rec 26 is `[06 ff*8]` — a "terminator" record with state=6 and all-ff tail, then full `0xff` filler).
- post-war: `[0,3,4,3,3,4,3,6,4,2,6,2,6,6,1,6,2,1,5,3,2,6,3,6,2,1]` then `5,4` (two new populated records replacing what were sentinels) then sentinels.

**Every state byte changed** between pre/post-war saves. That's much wider than a single Sparta-declares-war-on-Argos event should produce in a true per-pair-state matrix. Two interpretations:

- **HYPOTHESIS A** (more likely): This is a **per-faction "diplomatic message queue" or "pending event list"** — each entry is a queued event with `state` = event type (offer-trade, declare-war, propose-alliance, etc.) and the u32 is a target-faction-id or event-uuid runtime pointer. War declaration causes the AI factions to all enqueue counter-responses, hence many entries change.
- **HYPOTHESIS B** (less likely but possible): It IS the per-pair relation state matrix, but the state encoding includes "trust gradient" so even non-target factions' attitude toward Sparta nudges on a war declaration. The full 6-value enum has too many states for the standard `[no-contact, peace, war, alliance, trade, ceasefire]` set; might be `[unmet, hostile, war, neutral, friendly, trade-partner, allied]` = 7 states.

**Cross-validation NOT YET done** for diplomacy — the corpus pair (1turnstart vs 1.1) has size delta ~166KB (post-war save inserted ~16 bytes of metadata around the Sparta record), so by-offset diffs in the wider region are noisy and can't isolate which state bytes are the *Sparta-vs-Argos* one vs ambient AI churn. A clean probe needs:
- Two same-size saves spanning ONLY a known diplomatic event (e.g. trade-rights signed between two AI factions with no human input)
- OR an isolated peace-negotiation save pair

**Faction-id mapping**: the u32 field at `+1..+4` of each record is the suspected "target faction" reference but the values (68M-74M = `0x040E0000` to `0x047D0000`) look like runtime pointers (session 3 documented similar truncated-pointer patterns). If they ARE pointers, they would NOT survive save/load cycles and the diplomacy record is keyed by something else (slot index = faction-id?). Or if they're "creation-time hashes / uuids" (similar to character `secondaryUuid` documented in the prior dossier), they'd be stable. Need to test by loading the same save twice in different game sessions and comparing.

**Open follow-up** for diplomacy:
- Map the state enum [0..6] to game-engine meanings via systematic save-pair diffs over known diplomacy events (war, peace, alliance, trade, ceasefire).
- Determine if the u32 at +1..+4 is target-faction-id or runtime-pointer.
- Find the EQUIVALENT 9-byte array for each other faction (the relation matrix is symmetric — Sparta's record at `0x1c6c81f`-ish should have a peer in each other faction's record block).
- The byte-0 enum range 0..7 was observed (rec 17 had state=7); 7 might be "very-recent-event" flag. Worth checking what state 7 means.

#### 3. Failed probes / negative results

- **Ancillaries hypothesized in a SEPARATE body section** (`ANCILLARY_UNIT v=1` per HST): I verified this section type exists in the header strings table but did NOT find evidence that per-character ancillaries live there. They are INLINE in the character record (confirmed above). The `ANCILLARY_UNIT` HST entry may be the schema definition for the inline `[u16=0, u16=ancId]` structure that appears 211+ times in the body, not a separate section.
- **Ancillary names as cstrings in the save**: only `bodyguard` (a unit name, not an ancillary) found; the 1091 other ancillary names from `export_descr_ancillaries.txt` are NOT stored as strings in the save. Same architecture as traits — only ids stored.
- **`message_log.txt` lacks diplomacy events**: in this RIS imperial campaign session the log carried engine-boot/asset-loading messages only. No "declares war on X" / "negotiates peace" / "gained ancillary" lines. So the dossier's hint of "find a save where character gained an ancillary via message_log" wasn't usable — the log was empty of gameplay events. Cross-validating ancillaries across rome1..rome10 (the technique that DID work) is the recommended methodology for future ancillary probes.

#### Reproducer scripts

- `scripts/save-cracker/dig-anc1.js` — initial baseline diff for Drusus
- `scripts/save-cracker/dig-anc2.js` — gap-distribution analysis (which led to discovering the two sub-cases)
- `scripts/save-cracker/dig-anc3.js` — first [u16=0, u16=ancId] parse attempt
- `scripts/save-cracker/dig-anc4.js` — per-culture ancillary ID histogram
- `scripts/save-cracker/dig-anc5.js` — multi-save ancillary stability validation (THE decisive cross-validation)
- `scripts/save-cracker/dig-anc6.js` — production-quality parser w/ error reporting across 5 corpus saves
- `scripts/save-cracker/dig-diplo1.js` — diplomacy region scan that identified the 9-byte stride array

---

### Findings 2026-05-10 (background session 8 — trade routes + character tail bytes)

Goal: (1) the trade-route adjacency graph (entirely unmapped before this
session), and (2) classify the remaining ~12% of the character record header
that session 4 left undocumented (+219..+301 + a few earlier bytes that turn
out to also be character-state).

Trade routes were not pinned as an explicit adjacency list — strong negative
result: **trade routes are NOT stored as `(settlement_id_a, settlement_id_b)`
pairs anywhere in the save body** (Approach A from the brief). Instead the
engine appears to compute trade routes at runtime from three save-stored
inputs: (a) per-settlement road infrastructure presence (decoded below),
(b) ownership (per-settlement, decoded in prior sessions), (c) diplomacy
state (decoded in session 6). The session pivoted to map the road
infrastructure marker (which sufficient to derive trade route eligibility
per settlement) and to finish the character tail bytes.

#### 1. Settlement road infrastructure marker — CONFIRMED via `hinterland_roads` sub-record presence

Every settlement record contains a list of named sub-records (`default_set`,
`hinterland_region`, `core_building`, `governmentA/B/C/D`,
`military_industrial_complex`, `port_buildings`, `town_walls`, `theatres`,
and ~12 others) — each in the standard
`[u32 self-ptr][u16 nameLen][ASCIIZ name][payload]` shape that session 3
established. The presence (or absence) of the `hinterland_roads` sub-record
in a settlement's body is **the engine's persistent "this settlement has
constructed road infrastructure" bit**.

**Cross-validation** (save_rome6 vs save_rome7, the rome5→6 turn boundary):

| Sub-record | rome6 count | rome7 count | Δ | interpretation |
|---|---|---|---|---|
| `default_set` | 1311 | 1311 | 0 | every settlement carries it (= total settlement count for this campaign) |
| `hinterland_region` | 1296 | 1296 | 0 | 98.9% of settlements; presumably absent only for ungoverned-tile placeholders |
| `core_building` | 1305 | 1305 | 0 | the central building chain — every "real" settlement |
| `hinterland_roads` | **539** | **542** | **+3** | settlements WITH roads. Increased by 3 at the turn boundary — three new road-construction projects completed during the AI turn end |
| `military_industrial_complex` | 367 | 432 | +65 | building chain advance; 65 new completions at this turn end |
| `port_buildings` | 227 | 228 | +1 | sea ports |
| `governmentA` | 17 | 17 | 0 | imperial-tier government (Roman cities) |
| `governmentC` | 8 | 8 | 0 | Greek/eastern government |
| `messapian` (faction-prefix unit names) | 7 | 0 | **−7** | Messapians wiped — all faction-cultured units removed at the turn boundary |

Confirmation that the trade routes Approach A (raw settlement-id pairs)
fails: a u32-aligned scan of save_rome6 for streaks of values in the
RIS region-id space [13..1500] turned up **998 streaks totalling 27,302
slots**, but all longer streaks (top 40, len ≥ 80) were either (a) repeating
`(x_tile, y_tile)` coordinate pairs from per-region tile inventories, (b)
per-region resource arrays from the `MAP_REGIONS` HST section, or (c)
runtime cache structures. None had the diff pattern expected from a
trade-route table (additions/removals at the turn boundary scaled to the
number of new/lost ownership edges). The 7 messapian-prefixed unit strings
that disappeared from rome7 are LAND UNITS in the Calabria region — they
vanished because Messapians lost their last city. There are NO
adjacency-list edges that could be cross-correlated.

**Practical implication for Provincia parsers**: a settlement's
trade-eligibility can be derived from save data by:

1. Locate the settlement's name (UTF-16LE) using the marker `01 LEN_LO LEN_HI`
   pattern. Each settlement appears once in the save.
2. Scan forward up to 3500 bytes from the name position for the cstring
   `hinterland_roads`. Hit = "has roads". No hit = "no roads".
3. Combine with ownership (parser already knows this — settlement owner is
   read from the settlement-record-class layout's `+28` byte) and diplomacy
   state (session 6's per-faction relation matrix) to derive trade-route
   income contributions.

This is the same model classic-engine RTW used: trade is a derived
runtime computation, not a stored graph. The save persists only the
per-settlement infrastructure flags and the global ownership/diplomacy
state.

#### 2. Character record byte +286 (LAYOUT_A) / +282 (LAYOUT_B) — CONFIRMED per-turn counter (+5 per turn end)

The single most reliable new field in the character tail zone. Triple-validated
across three independent corpora:

| Corpus | LAYOUT_A chars | +286 stable | +286 incremented | typical delta |
|---|---|---|---|---|
| save_rome6 → save_rome7 (RIS imperial, Roman T5→T6 boundary) | 25 | 5 | 20 | +5 |
| save_Autosave Sparta Turn 4 End → Turn 5 Start | 38 | 37 | 1 | +1 |
| save_Autosave Athens Turn 22 Start → Turn 22 End (within-turn) | 57 | 57 | 0 | 0 |

For LAYOUT_B (the 4-byte-shorter Greek/single-name variant), the equivalent
offset is `+282`:

| Corpus | LAYOUT_B chars | +282 stable | +282 incremented | typical delta |
|---|---|---|---|---|
| save_rome6 → save_rome7 (Roman T5→T6) | 911 | 896 | 15 | +5 |
| Sparta T4 End → T5 Start | 1300 | 1266 | 34 | +5 (27 by exactly 5) |
| Athens T22 Start → T22 End (within-turn) | 1884 | 1884 | 0 | 0 |

**Interpretation**: a per-turn-end counter that ticks `+5` ONLY for
characters belonging to the faction whose turn ended in the diff interval.
Within-turn moves (Athens T22 Start → T22 End) leave it untouched. The
fact that the value resets at character birth to 0 (rome1 Roman Aulus
Gabinius and Marcus Livius_Drusus both have +286=0 in saves rome1..rome6
where their factions haven't yet completed turn 5) suggests this is a
**character-lifetime tracker measured in turn-ticks × 5**.

Best-guess interpretation: **the engine's internal "experience bonus accrual"
field for the character — possibly a per-turn loyalty or seniority drift
that compounds into trait threshold checks**. The +5 stride is suggestive of
RTW's classical trait-threshold gain rates (most CMV traits in the descr
files increment by 5 per turn under specific conditions). Worth verifying
by capturing a save pair across a known trait-level upgrade event for the
same character.

**Retraction of session 4's `+218` HYPOTHESIS**: session 4 documented "byte
+218 increments by +5 across turn boundaries for many characters". This was
NOT confirmed by this session. In all 25 Roman LAYOUT_A characters traced
across rome1..rome9, **+218 stayed at 0 in every save**. The +5 pattern
session 4 observed was the same field — but actually at `+286`, mis-mapped
during the initial scan. Use `+286` (LAYOUT_A) / `+282` (LAYOUT_B) for the
per-turn-end counter.

#### 3. Character record byte +126 (LAYOUT_A) / +122 (LAYOUT_B) — CONFIRMED per-turn counter (+1 per player turn end)

Distinct from #2: where +286 ticks `+5` per faction-turn-end for that
character's faction, **+126 ticks `+1` for player-Rome characters at the
player's turn boundary** AND ticks at variable rate for AI characters at the
total-turn-cycle boundary.

| Corpus | LAYOUT_A chars | top delta | count |
|---|---|---|---|
| rome6 → rome7 (player T5→T6) | 25 LAYOUT_A | +1 | 17 (`5→6` 7x, `7→8` 7x, `6→7` 3x) |
| Sparta T4 End → T5 Start | 38 LAYOUT_A | +9 | 25 (`3→12` 11x, `1→10` 7x, `2→11` 6x, `4→13` 3x, `5→14` 1x, `7→16` 1x) |
| Sparta T4 End → T5 Start (LAYOUT_B) | 1300 chars | +9 | 218 chars had `7→16` exactly |

The Roman save pair spans one player-turn-end; +126 ticks +1. The Sparta
autosave pair spans the entire AI rotation (Sparta T4 End → T5 Start =
many AI faction turns running between the save points); +126 ticks +9 in
lockstep across hundreds of characters. The proportional relationship
suggests the field encodes **"AI-or-player faction-turns elapsed since
character creation"** at 1 tick per faction-turn — explaining why the
Sparta autosave delta is higher when the autosave timestamps span more
end-of-faction events.

For LAYOUT_B, this is the field documented in session 4 as "+122 was seen
incrementing by +9 on Sparta T4→T5 in 788 chars, distinct field" — now
confirmed as a per-faction-turn counter rather than the per-character-turn
counter session 4 hypothesized for the player.

#### 4. Character record bytes +18..+25 (LAYOUT_A) — STRONG: cognomen / clan-name "family head" link

Session 4 documented this 8-byte block as "`+18 u32 0xffffffff sentinel
(variable family link)`". This session refines it to a **specific
character-family pointer** that gets written when a character is bound to
a clan/family head.

**Cross-corpus distribution** (LAYOUT_A only):

| Save | LAYOUT_A chars total | non-sentinel +18 | values seen |
|---|---|---|---|
| save_rome6.sav | 25 | 1 | `+18=1102 (Cornelius_Scapula), +22=2` for Aulus Gabinius |
| save_rome7.sav | 25 | 2 | same `+18=1102, +22=2` for Aulus AND Marcus Livius_Drusus |
| Sparta T5 Start | 39 | 1 | `+18=0 (Aaron), +22=?` for one char |
| Athens T22 End | 57 | 1 | `+18=1103 (Cornelius_Scipio), +22=?` for one char |

Marcus's +18 transition from `0xffffffff` (sentinel) to `1102
(Cornelius_Scapula)` between rome6 and rome7 matches his RomanConquerorMessapians
trait gain at the same turn boundary. The fact that Aulus Gabinius had the
same value pre-set (in rome6) suggests this is a stable lifetime link, not
a per-event marker.

**Best-guess interpretation**: `+18` is a u32 index into `descr_names_lookup.txt`
pointing to the character's **"family clan head" / cognomen tag** — the
character is associated with a clan that supersedes their birth-family lastName
for political/marriage/inheritance purposes. The fact that Marcus and Aulus
both reference `Cornelius_Scapula` (which is NOT the surname of any character
in this save) suggests a "Roman gens patron" pool of name tokens that the
engine maps select characters to. The `+22 u32 = 2` is a small enum
(probably the relationship type: adopted, married-in, sworn-loyalty, etc.).

This is character-state, not turn-state. Most LAYOUT_A characters have
sentinel here. Only 1-2 of 25 in each save have a real value, suggesting
the field is set by specific game events (adoption, marriage, dyadic
patronage trait gain).

#### 5. Character record byte +302 (LAYOUT_A) / +298 (LAYOUT_B) — CONFIRMED: traitCount slot count INCLUDES the terminator

Session 4 documented traitCount at +302 (LAYOUT_A) / +298 (LAYOUT_B) with
"last slot is TERMINATOR with lvl=0 and flag in {53, 108, ...}". This session
refines: **the value written at +302 equals `parser.traits.length + 1`** —
i.e. the saved count INCLUDES the terminator slot. Verified on Marcus
Livius_Drusus: parser reports 22 traits in rome1..rome6 (saved value +302
reads 23) and 35 traits in rome7..rome9 (saved value +302 reads 36).

Session 6's retraction of the terminator interpretation is the correct
read: the "terminator" slot is just the slot for the LAST real trait, and
the `flag` u16 at slot+6 is a real trait-flag field. The slot count is the
exact entry count including all real entries.

#### Method note: rome10's character records are NOT findable by uuid

`save_rome10.sav` is a different game session of the same in-game state as
rome5. Per session 3's "runtime uuids vs save uuids — they DO NOT match"
finding, the character records in rome10 have **different secondaryUuids**
than rome5 even though the in-game state is identical (campaign turn 5,
same characters, same positions). Marcus Livius_Drusus's primaryUuid
(1311873815) in rome5 doesn't match any character record in rome10. For
character-record cross-session tracking, must match by name (firstName +
lastName + culture) — the parser already does this. For within-session
turn-boundary tracking (rome1..rome9), uuid match works fine.

#### Reproducer scripts

- `scripts/save-cracker/dig-chartail{1..10}.js` — character tail byte map
  (the 8-step iterative methodology that pinned `+286`, `+126`, and `+18`).
  Run any with `node scripts/save-cracker/dig-chartailN.js` from the
  Provincia root.
- `scripts/save-cracker/dig-trade{1..11}.js` — trade-route search,
  building-chain sub-record inventory, hinterland_roads cross-validation.
- The "hinterland_roads has=YES/NO" one-liner is:
  ```js
  function hasRoads(buf, namePos) {
    const tok = Buffer.from("hinterland_roads");
    let p = Math.max(0, namePos - 200);
    while ((p = buf.indexOf(tok, p)) !== -1 && p < namePos + 3500) return true;
    return false;
  }
  ```
  Pass it the UTF-16LE settlement-name-position. Returns whether the
  settlement has road infrastructure.

#### Open follow-ups

- **The +286 / +282 turn counter's semantic exactness** — is it +5 per
  character-turn or +5 per faction-turn-of-that-character's-faction?
  A clean test: take a save where the player ends turn while one general
  is exiled/seconded to another faction; check if +286 ticks on the
  player's turn-end or only on the seconded-to faction's turn-end.
- **The +126 / +122 per-faction-turn counter exact source** — track
  one character through 5 consecutive Sparta autosaves to count
  faction-turns elapsed vs. byte delta. The proportionality should
  match (delta / 1) faction-turns.
- **Trade-route income aggregation** — the per-settlement income field at
  `+683` (decoded session 3) presumably includes trade income. Cross-check
  by comparing two settlement records where ONLY trade-partner availability
  changes (e.g., a save before vs. after a sea-route blockade is broken).
  Difference in +683 = trade-income component for that settlement.
- **`+18..+25` family clan link** — pin the +22 enum (=2 in both observed
  cases) by finding a save where a character is granted a different
  family-link type (e.g., a marriage event vs. an adoption event).

---

### Findings 2026-05-10 (background session 7 — diplomacy semantics + minor-faction treasuries)

Goal: (1) pin the **diplomacy state enum semantics** that session 6's 9-byte
array exposed but did not decode, and (2) attempt the unfinished stretch goal
**non-major faction treasury location**.

Diplomacy semantics: **NOT pinned. Session 6's interpretation of the
captain_card_sparta+6306 array is RETRACTED.** It is not a per-pair
diplomacy state matrix — see Retraction #1 below for the cross-validation that
forced this conclusion. The 4-byte diplomacy cookie at sparta-34 / sparta+182
remains the only confirmed war-declaration signal, and it is an opaque hash,
not a readable state byte.

Minor-faction treasury: **fully decoded.** A parallel "minor faction record"
array of 216 entries sits in the body next to the 23 major-faction records,
with a distinct `+44=8` (instead of `+44=6`) discriminator tag. Treasury is at
`+0` (i32) plus a duplicate at `+48`. Starting denarii values match descr_strat
byte-for-byte across all saves tested.

#### 1. RETRACTION: the captain_card_sparta+6306 9-byte array is NOT the diplomacy state matrix

Session 6 documented a 9-byte-stride array at relative `+6306..+6540` from
`captain_card_sparta.tga` and claimed 26 records with `+0 = state enum (0..7)`
representing per-other-faction diplomatic relations. **Re-walking the array
from its 0xff-filler terminator (instead of using session 6's hard-coded
+6306 offset) revealed the array is actually 124 records long**, preceded by
a `u8 = 124` count byte at `start-1`. Session 6 read only the last 26 of
those 124 records and mistakenly identified record 25 (which has state=6 and
happens to be followed by 8 sentinel `0xff` bytes from the trailing filler) as
a special "terminator record" — it's actually a regular record adjacent to the
true terminator.

Cross-validation that this array is NOT diplomatic state:

| Pair | Sparta-game-state | Array equal? |
|---|---|---|
| `save_savestartsparta` (Turn 1 Start) vs `save_1.1` (Sparta declared war on Argos + sieged Prasiai) | **declares-war event happens here** | **byte-identical, 124/124 records match** |
| `save_savestartsparta` vs `save_2.0` (taxes raised in 3 cities) | same diplomatic state | byte-identical |
| `save_1.1` vs `save_2.0` | declared-war state persists | byte-identical |
| `save_1turnstart` vs `save_1turnchange` | both at turn 1→2 boundary | byte-identical |
| `save_savestartsparta` vs `save_1turnstart` | mid-turn-1 vs turn-1-end-or-turn-2-start | **124/124 records differ** |
| `save_rome5` vs `save_rome10` (same in-game turn 5, different game sessions) | same diplomatic state | byte-identical |
| `save_rome5` vs `save_rome6` (within turn 5) | same diplomatic state | byte-identical |
| `save_rome6` vs `save_rome7` (turn boundary) | same diplomatic state | byte-identical |

The pattern: the array is **stable across all within-turn events** including
the war declaration AND the turn boundary in non-player sessions, but
completely flips across turn boundaries in the Sparta-as-player session.
Whatever the array encodes, it isn't a real-time diplomacy state — it's a
**per-turn-end recomputed structure tied to the active player's bodyguard
record**. Possible interpretations (NOT cross-validated):

- AI policy table re-evaluated at the end of each player turn
- Per-turn random-number-generator-seed log used for trait/event determinism
- Pre-baked AI move-suggestion cache for the next turn

The byte+3 high nibble is also a small enum 0..7 (independent of byte 0), and
the byte+4 marker is always `0x04`. Effective record content is 3 informative
bytes per slot (state byte, byte+1 = u8 in 4000-7000 range, byte+3 high
nibble = enum 0..7).

**Only the Sparta record has N=124**. Athens has N=60. Other captain_card-X
factions don't have analogous arrays in their bodyguard records. So this is
not a generic "per-faction-relations" structure — its presence is tied to
specific faction classes (large playable factions only?). The 60-vs-124
ratio doesn't match any sensible "factions-known-to-this-faction" count
either.

The actual diplomacy state for the war-declaration event is captured ONLY by:
- 4-byte cookie at `captain_card_sparta - 34` / `+182` (already in the
  dossier; opaque hash that flips on any diplomatic change)
- u32 at sparta+78 flips from `0xFFFFFFFF` → `0x0000001E` (= 30, Sparta's
  internal faction-id) — already in the dossier; this is Sparta's own ID
  written when she enters her first war state, NOT the war-target's ID

No readable enum byte and no target-faction reference appear in the diff
between savestartsparta and save_1.1 — they're hidden inside the 4-byte
hash. The semantic enum the session brief asked about ("peace / war /
alliance / trade rights / ceasefire / vassal / protectorate") is likely
stored only inside the per-faction-pair diplomacy AI section that does NOT
appear in our captain_card-anchored window.

#### 2. CONFIRMED: minor-faction record format (216 records, +44=8 discriminator)

Session 5 found 23 major-faction records via the signature `+8=100, +12=1,
+24=self, +40=self, +44=6, +48=N regions`. Relaxing the `+44=6` constraint
reveals a SECOND set of 216 records with `+44=8` instead. **Total class-100
records = 23 + 216 = 239, exactly matching RIS imperial's 239 factions**
(playable + nonplayable + rebels + slave + dummies, per descr_strat).

Minor record byte map (Δ relative to record start; signature: u32(+8)=100,
u32(+12)=1, u32(+24)==i+24, u32(+40)==i+40, u32(+44)=8):

| Δ | Type | Confidence | Meaning |
|---|---|---|---|
| `+0` | `i32le` | **CONFIRMED** | **Current treasury (denarii)** — signed for bankruptcy; matches descr_strat starting values byte-for-byte |
| `+4..+7` | `u32` | RUNTIME | Hash/cookie that propagates on diplomatic events |
| `+8` | `u32 = 100` | CONFIRMED | Class tag (same as major) |
| `+12` | `u32 = 1` | CONFIRMED | Version marker (same as major) |
| `+16..+23` | 8 B | CONST zero | Padding |
| `+24` | `u32` | CONFIRMED | Self-pointer (== `pos+24`) |
| `+28..+31` | 4 B | RUNTIME | The "spartan general"-34 diplomacy cookie — flips on diplomacy changes (same architecture as session 6's finding for the cookie hash, just now we know where it lives in the minor record) |
| `+32..+39` | 8 B | CONST zero | Padding |
| `+40` | `u32` | CONFIRMED | Inner self-pointer (== `pos+40`) |
| `+44` | `u32 = 8` | **CONFIRMED** | **MINOR-FACTION-CLASS TAG** — discriminates from major's `+44=6` |
| `+48` | `u32` | CONFIRMED | **Duplicate of +0 treasury** (engine likely uses +48 to read at load while +0 is what the UI writes — same dual-buffer pattern as session 3's settlement income at +683/+1127) |
| `+52` | `u32 = 30` | CONFIRMED | Constant marker byte across all 216 minor records and across all saves; **NOT the faction-id**. Possibly a record-format-version tag or a sub-section-class enum. Coincidentally equals 30, which is also Sparta's internal-fid — but the marker stays 30 even when looking at non-Sparta minor records, so it's not an fid. |
| `+56..` | various | UNDECODED | Per-faction-specific trailing data (region list? diplomacy state? AI policy? military upkeep? — see session 5's open question about per-faction trailing data) |

**Inter-record stride**: First two minor records in Sparta-player saves are
separated by 6565 bytes (Sparta's minor record size = 6565 bytes). This is
LARGER than the 5200-80000-byte range seen for major records in session 5,
suggesting minor records pack more dense per-faction data than major ones —
or that the player faction in particular has more trailing state.

**Faction-id is positional**: The faction-id of each minor record is NOT
stored at any visible field offset — it is encoded by **array position**.
Walking the save's minor records in file order gives a stable per-save
faction array. The PLAYER faction's minor record is always at index 0:
- `savestartsparta` (Sparta player): index 0 = treasury 5000 (Sparta's
  starting denari from descr_strat)
- `save_rome5/rome10` (Romans Julii player): index 0 = treasury 9500
  (matches `roman_rebels_1` and `roman_rebels_2` starting denari — Romans
  Julii is in the MAJOR array; minor array index 0 is whichever minor faction
  is sorted first when player is in the major set)

The other 215 minor records follow in a stable order across saves of the
same campaign. **Mapping index → faction-name requires either**: (a)
counting descr_strat's non-major faction list in declaration order and
applying the engine's compaction rule, or (b) reading the starting treasury
values and matching them back to descr_strat `denari` lines (1:1 unique for
some factions like Sparta's 5000, ambiguous for the 78 factions that share
denari=5000).

**Cross-validation across saves**:

| Save | Sparta minor record pos | Sparta treasury |
|---|---|---|
| `savestartsparta` (Turn 1 Start) | 0x1551a81 (index 0) | 5000 |
| `save_1.1` (mid-turn 1, war declared) | 0x1551eb0 (index 0) | 5000 |
| `save_2.0` (mid-turn 1, taxes set) | 0x1551e5f (index 0) | 5000 |
| `save_1turnchange` (Turn 1 End) | 0x1c97be2 (re-located 7MB) | 9500 (+4500 income at turn-end) |

Treasury increases by 4500 across the first turn boundary (income > upkeep).
The 7MB relocation in `1turnchange` indicates the body's section ordering
shifts between turns — the array signature (`+44=8`) is the only reliable
locator. The MAJOR-records likewise relocate; index ordering stays stable.

#### 3. War-declaration diff in Sparta's minor record (savestartsparta vs save_1.1)

124 bytes differ inside Sparta's 6565-byte minor record between
savestartsparta and save_1.1 (Sparta declared war on Argos in 1.1). Diff
classification:

- **+4..+5, +24..+25, +40..+41**: 2-byte changes that look like high-byte
  bumps on runtime self-pointers (e.g. `0x1a → 0x1e`). Session 5's
  "runtime-pointer cluster" pattern applied to the minor-record format.
- **+28..+31** (4 B): the known diplomacy cookie `98 1b f0 bb → f0 dc c9 c0`
  — the same dossier-confirmed Sparta diplomacy hash.
- **+151..+156, +163..+170, +281..+288, +1241..+1244, +1274..+1281,
  +1342..+1345, +6561..+6564**: 4- to 8-byte hash changes that propagate
  from the diplomacy event. None readable as a state enum or as Argos's
  faction-id.
- **+2476..+2606**: cluster of ~16 small 2-byte changes all with high-byte
  bump `0x24 → 0x28` (+4). Another runtime-pointer cluster.

**No "diplomacy state byte" or "war-target faction-id" appears at a stable
offset inside Sparta's minor record between savestartsparta and save_1.1.**
The state semantics are hidden in the propagating hashes; without an engine
disassembly there's no way to decode the enum from save data alone.

#### 4. descr_strat starting diplomacy context (for future correlation work)

RIS imperial's `descr_strat.txt` lines 1766400-1768400 ("start of diplomacy
section") document the engine's diplomatic-attitude conventions, which would
be the ground-truth target for any successful state-byte decoding:

```
core_attitudes legend:
  -10  Locked Allied
   0   DS_ALLIED
  100  DS_SUSPICIOUS
  200  DS_NEUTRAL
  400  DS_HOSTILE
  600  DS_AT_WAR
  850  Total war
 1000  Crazy War

faction_relationships legend:
  =<199  Ally + Trade agreement (if possible)
   200   Neutral
  =>201  War
```

Sparta's starting relations (extracted from the descr_strat lines 61657-66856):

- **Locked allied (-10) FROM Sparta TO**: ptolemaic, achaea, athens, greeks,
  gortyn, lyttos
- **War (600) FROM Sparta TO**: antigonid, aetolia, epirus, elis, knossos,
  messene, argos, megalopolis, slave
- **Allied (0) FROM Sparta TO**: rhodes, syracuse, kydonia

So at Turn 1, Sparta is already AT WAR with 9 factions including Argos. The
"Sparta declared war on Argos" event in save_1.1 is therefore NOT a
state-transition from peace-to-war — Sparta and Argos were at war from day
0 per descr_strat. What save_1.1 actually captures is the **first
player-driven aggressive action** (siege of Prasiai), which writes the
`u32 = 30` at sparta+78 (the "Sparta has acted aggressively for the first
time this campaign" marker). This explains why no per-pair state byte
flipped — Sparta's relation with Argos was identical before and after.

This is a substantial correction to the original brief's premise: there is
no pre/post-war pair in the corpus for Sparta-vs-Argos, because that war is
permanent from Turn 1. To pin diplomacy enum semantics, the corpus needs:
- A save pair where two factions transition from neutral/ally to war (e.g.
  a player negotiating an alliance, then breaking it), or
- A save pair where ceasefire / peace / trade rights is signed between two
  factions in the same turn.

Neither is currently in the available save corpus.

#### Targets attempted, not landed

- **Per-faction current military upkeep**: not pinned. With Sparta's minor
  record fully mapped to 6565 bytes, this would be a fine probe target —
  upkeep should change predictably between turn-end saves where army count
  is known. Out of session scope.
- **Mapping minor-record index → faction-name**: a one-time correlation
  exercise — match each index's starting treasury back to descr_strat
  `denari` lines, breaking ties via the cookie hash that connects each
  faction's record to its captain_card-X portrait string. Out of session
  scope but tractable.
- **The byte+3 high-nibble enum in the Sparta 124-array**: independent
  small enum 0..7, distribution roughly bell-shaped (peaks at 3,4). Could
  encode tile-type / terrain / weather / squadron-class. Not investigated.

#### Reproducer scripts

- `scripts/save-cracker/dig-diplo2.js` — corrected diplomacy-array walker;
  retracts session 6's 26-record claim by walking back from the 0xff
  terminator and showing N=124 with a count byte preceding the array.
- `scripts/save-cracker/dig-diplo3.js` — minor-faction record locator and
  treasury reader; produces a per-save (majors, minors, treasuries) table.

#### Open questions for future sessions

- **Diplomacy state enum decode**: blocked on corpus. Needs a save pair with
  a clean diplomatic state transition (war declaration between previously
  neutral factions, alliance proposal accepted, peace signed, etc.) and
  no other concurrent changes. Or: in-game inspection of the `core_attitudes`
  decimal value at save-time via a mod-script console command (the engine
  exposes attitudes to script).
- **Minor-record trailing data (`+56..+6564` for Sparta)**: 6500 bytes of
  per-faction state of UNKNOWN content. Probably contains: region-owned
  list, building-queue, AI policy state, diplomatic attitudes to other
  factions, military-upkeep aggregator, character-spawn list. A full byte-map
  would take 1-2 sessions like session 3 did for settlements.
- **The Sparta 124-array semantics**: probably a per-turn AI-eval cache.
  Could be confirmed by checking whether modifying these bytes in a save
  has any observable effect on next-turn AI behavior — but that requires
  game-side experimentation, not save analysis.

---

### Findings 2026-05-11 (background session 9 — faction trailing data + military upkeep)

Goal: extend the faction-record decoding from session 5. Three targets:
1. Per-faction military upkeep
2. Per-faction construction spend this turn
3. The +52..+(end-of-record) trailing-data region in major records

Outcome: **target #3 fully decoded** with two strong cross-validations. Targets
#1 and #2 not pinned — the trailing data after the region list turns out NOT
to be byte-aligned across factions or even across turn boundaries for a single
faction, making fixed-offset financial-field decoding infeasible without
section-boundary anchoring. Plus a clean section-walker prototype and several
useful negative/retraction-level observations.

#### 1. CONFIRMED: the region list at +52..+(52+4N) is a STATIC homeland/claim
list, NOT "currently owned regions"

Triple-validated by cross-corpus comparison:

- **Same campaign, ALL save states (rome1..rome10, 10 saves, spanning Roman
  player T5 within-turn moves AND the T5→T6 turn boundary)**: every faction's
  region list bytes match byte-for-byte across all 10 saves. `regionCount`
  stays at 35 for Romans Julii in every save, region IDs in identical order.
- **Same campaign across diplomatic events (savestartsparta vs save_1.1 —
  Sparta declares siege on Argos)**: region lists for ALL 23 major faction
  records identical.
- **CROSS-CAMPAIGN BYTE-IDENTICAL TEST**: Romans Julii's 35-region list
  `[436,437,462,467,481,486,496,497,508,530,536,580,592,698,798,818,922,949,
  969,994,1002,1003,1011,1019,1024,1025,1026,1042,1047,1056,1057,1071,1074,
  1078,1089]` (sorted) is byte-for-byte identical across FOUR DIFFERENT
  CAMPAIGNS:
  - Roman player campaign (`save_rome5..sav`)
  - Sparta player campaign (`save_savestartsparta.sav`)
  - Saka player campaign (`save_Autosave Saka Turn 1.sav`)
  - Athens player campaign (`save_08-05-2026 Athens Turn 21.sav`)
- Same test on Carthage's 22-region list: 1 unique fingerprint across 4
  campaigns; all match.

**Conclusion**: the list is the faction's `descr_strat`-derived starting
territory ("homeland" or "originally-owned-at-campaign-start" regions), written
at campaign start and never updated by the engine. The session 5 hypothesis
candidate-list ("homeland regions / claimed regions / starting position pool")
collapses to the first option.

The session 5 follow-up — "diff a faction's +52..+(52+4N) across a save where
the faction loses a region in conquest" — is now resolved: **the list doesn't
change** across siege-declaration, turn-boundary AI churn, or any save event
in the available corpus. Combined with session 5's own observation that the
IDs overlap heavily across faction records (152 unique IDs across 514 total
slots in rome5), this matches a static "homeland reference" interpretation.

For parser code: read `(N at +48, regions at +52..+(52+4N))` as a static
homeland descriptor. This data is most likely what `homelands.json` should be
cross-cross-validated against — if the parser-side homeland map matches, the
save's intra-record region list is the same dataset.

#### 2. STRONG: 23 major-faction records may be REORDERED between saves in
the same campaign

Side-effect discovered while running cross-save comparisons: while the
**region lists themselves are byte-identical** across all saves in a given
campaign, the **order of the 23 major-faction records inside the save body**
is NOT guaranteed stable. Session 5 documented "player faction always at
index 0" which **is true for the rome corpus and Saka corpus**, but in the
Sparta player corpus, multiple saves show a different ordering:

- `savestartsparta` (player Sparta, Sparta has minor record so doesn't take
  index 0 of the major array): order = Carthage(idx 0, 22r), ..., Romans Julii(idx 22, 35r)
- `save_1turnstart`, `save_1turnchange`, `save_2`, `save_3..7`: order
  changes — the record at ref `idx 6` (treasury 5000, 21 regions, = Parni)
  rotates to cur `idx 0`, pushing everyone down by 1. Total = a single
  rotation of one record.
- `save_1.1`, `save_1.2..1.7`, `save_2.0`, `save_2.1`, `save_2.2`, the
  Sparta T4/T5 autosaves: SAME ORDER as savestartsparta.

The split between "reordered" and "stable-order" saves doesn't correlate
with any obvious gameplay event. Hypothesis: the engine's serialization
order depends on which faction's turn was just being processed at save
time — `save_1.1..1.7` are mid-Sparta-turn quicksaves (player has just
acted) while `save_1turnstart/change/2-7` are autosaves at the
inter-faction-turn boundary (a non-player faction had just been processed).

**Parser-side implication**: do NOT use positional indexing alone to map
faction-record-index → faction-id. Map by:
1. Read all 23 (major) + 216 (minor) faction records' region lists and
   treasury.
2. Match each major record's sorted region-list fingerprint against the
   mod's `descr_strat`-derived starting-region set per faction.
3. This works because (per finding #1) the lists are byte-identical to
   the descr_strat-derived set.

For the rome corpus, positional indexing happened to work because saves
0..10 are all the same gameplay state at micro-states where the engine
emitted records in the canonical order. The Sparta corpus exposes that
the order isn't load-bearing.

#### 3. RETRACTION (session 5): the +24 / +40 "embedded section self-pointers"
at the start of the major-faction record are NOT a taw section grammar header

Session 5 documented the major-faction-record signature as:
```
+0  u32 treasury
+4  u32 runtime pointer
+8  u32 = 100
+12 u32 = 1
+16..+23 zeros
+24 u32 = self-pointer (`pos+24`)
+28 u32 runtime hash
+32..+39 zeros
+40 u32 = self-pointer (`pos+40`)
+44 u32 = 6
+48 u32 = regionCount N
+52..+(52+4N) region IDs
```

Calling the +24 and +40 fields "section header" was misleading. A taw
section's grammar is `u32 self-pointer at N, u32 size at N+4, payload of
that size`. In the major-faction-record case, the bytes at `+(self-ptr)+4`
are NOT a size: they're a runtime hash (at +28) or the constant `6` (at
+44). **The major-faction-record is NOT a taw section** — its self-pointers
are stand-alone anchors used by the engine for internal addressing, not for
the section invariant.

Empirical confirmation: walking the file with a section grammar walker (the
session-9 prototype `dig-section1.js` etc.) and recursively descending into
the root section's child tree does NOT visit any of the 23 major-faction
records as children, even though they sit inside the root's byte range. The
walker correctly skips them because their u32 at `+ptr+4` is not a size value.

This means: the section walker stretch goal mapping section-name → offset
is **partially blocked** by the fact that important game-state structures
(per-faction records, the major-faction array as a whole, the minor-faction
array as a whole) are NOT proper sections. They live as flat data inside
parent sections. The walker still finds the proper sections (~4400 in
rome5 across 23 levels of nesting depth, see finding #6).

#### 4. STRONG: the player faction record extends ~225KB and contains many
embedded character & unit records

While probing the trailing data after `+52+4N` (= +192 for Romans Julii), the
session found:

- **Romans Julii's major record spans 225,761 bytes** in `save_rome5..sav`
  (file offsets `0x154197a..0x1578b5b`). Inter-record stride here is
  measured from one record-start to the next major-record-start.
- The 225KB block contains AT LEAST:
  - 3 occurrences of the unit-name cstring `roman general` at relative
    offsets `+1447, +8012, +21612` — each begins a land-unit record with
    the dossier's known shape `[u16 nameLen][ASCII name][seed u32][...]
    [region UTF-16][commanderUuid u32][unknown 8 bytes][max u32]
    [soldiers u32]`. Reading the max/soldiers fields gives `60/60` for
    all 3 (full-strength bodyguard units).
  - 31 occurrences of `caetrati swordsmen` at ~2850-byte stride (each at
    relative offsets +45051, +47896, +50743, ...).
  - 3 occurrences of `naval biremes`.
  - A 354-byte-stride array of 12 records at relative +40719..+44613,
    each with a triple self-pointer header (+0 self, +4 self, +16 self),
    `+8 = 6`, and small ints at +20/+24 that look like map coordinates
    (X, Y) — e.g. `(292,339), (246,367), (289,338), ...`.
- Across rome corpus: the SAME 31 caetrati and 3 naval biremes appear at
  the SAME relative offsets in rome1..rome6 and rome10 (within-turn-5
  snapshots from the same session OR from the rome10 session with a
  different runtime-pointer set but same in-game state). In rome7..rome9
  (turn-6 start), the record extends to 232,475 bytes — the player
  record grew by 6,714 bytes at the turn boundary due to character traits
  expanding, new units appearing, or both.

**Interpretation**: the "major-faction record" in our session-5 nomenclature
isn't really a self-contained faction summary. It's the engine's per-faction
serialized state, which includes ALL armies, units, and characters that
faction owns or has knowledge of. This explains the 5KB..80KB stride
variability session 5 saw between consecutive records: it scales with each
faction's owned-army count and tracked-character count.

For the parser, this is important: parsing "the major faction record" means
parsing a complex variable-length structure with embedded sub-records, not
a flat fixed-stride per-faction array.

The `caetrati swordsmen` units appearing in Romans Julii's record is
surprising at face value (Romans don't recruit Iberians) — but in RIS
imperial the player faction may have intelligence/visibility records about
units of other factions, OR more likely the unit strings inside ONE faction
record are units that PHYSICALLY OVERLAP the byte range without belonging
to that faction. The bytes interpreted as Romans Julii's "+45051..+130731"
might actually be part of a separately-anchored unit-list structure that
just happens to lie between this major record's start and the next major
record's start in file order. Distinguishing these two interpretations
requires section-walker integration; the session 5 stride number "+208001
bytes between major records" is more accurately "+208001 bytes of mixed
faction-state + units + characters in file order".

#### 5. RETRACTION & RE-CLASSIFICATION: my initial "+1000/+1016/+1032 vs
+1152/+1168/+1184 dual-buffered finance" finding is NOT real

Pre-RESEARCH-write byte-diff showed:
- Romans Julii rome5: +1000=459, +1016=1537, +1032=1792, +1152..+1184=-1
- Romans Julii rome7: +1000=974, +1016=967, +1032=229, +1152=459, +1168=1537,
  +1184=1792

Looked like a dual-buffer pattern (old values get copied to +1152 slots
while new values fill +1000 slots). I treated this as a strong candidate
for income breakdown.

Re-examination at byte level: those offsets fall INSIDE an embedded
character/portrait record. At rome5, +900..+1100 holds the cstring
`data/ui/roman/portraits/cards/young/generals/459.tga` followed by a
second portrait path and a character sub-record. At rome7, the same
relative offsets fall inside a DIFFERENT character sub-record (trait
block of a different character) because the record interior was
reorganized when the player record grew by 6,714 bytes at the turn
boundary. The "+1000=459" reading in rome5 corresponds to a portrait
filename (`459.tga` → portrait number 459, stored as the bytes
`cb 01 00 00` = 459 u32 immediately after the path string), not a
financial field. The "+974 = 0x03ce" in rome7 is reading bytes from a
totally different embedded structure.

**The dual-buffer pattern was a coincidence of byte-aliasing across two
unrelated structures that ended up at the same relative offset in two
different snapshots of the same record after a content-driven layout
shift.**

Lesson for future probes: never treat a fixed relative offset INSIDE
a major-faction-record (beyond +52+4N for the region list and possibly
the treasury snapshot at +92+4N) as a stable field anchor. The trailing
data is content-aligned, not byte-aligned.

#### 6. STRONG: file-wide section walker finds ~4,428 self-pointing sections
with nesting up to depth 1032

`dig-section5.js` scans every byte of `save_rome5..sav` for u32 self-pointers
followed by a plausible size word. Results:

- 4,428 candidate sections file-wide
- Root section at file offset `0xc4842`, size 29,236,676 bytes (28 MB —
  the body root). Sits just after the HST at 0x3314.
- Largest direct child of root: 23 MB sub-container at `0xdb753`.
- Sections nest extremely densely — at depth 947 there are still 585
  sections, with depth-944 marking a transition where many parallel
  sub-trees fan out. Some chains nest to depth 1032 (likely false
  positives where small-value u32s coincidentally match the
  self-pointer + size pattern; need additional structural validation).
- Only **768 sections** have a u16-prefixed ASCII name within the first
  200 bytes of payload (the standard `[u16 nameLen][ASCIIZ name]` shape).
  Of these, 759 are `default_set` (settlement records — matches session 3's
  finding that the settlement record carries a `default_set` plan-set
  sub-record), 6 are `hinterland_region` (per-region settlement sub-records),
  2 are `roman` (faction-culture tag inside some record), 1 is `historic`.

**Open follow-up**: the walker needs (a) a stricter false-positive filter
that uses parent-child size containment, (b) deeper name extraction that
descends past the first 200 bytes to find labels like `core_building`,
`governmentA`, `military_industrial_complex`, etc. The session-3 dossier
documented 5 named building-chain sub-records inside a single settlement;
all should be findable. (c) the named sections should be cross-referenced
against the 106-entry HST manifest to label them with their schema name
(e.g. `SETTLEMENT_PLAN_SLOT_POSITION`, `MAP_REGIONS`, etc.).

**Reproducer**: `node scripts/save-cracker/dig-section5.js` against
`save_rome5..sav`. Output gives 4428-section count, depth histogram, and
top-named-sections list.

#### 7. HYPOTHESIS: u8 at +860 in player major-faction record is a per-faction
turn counter ticking +5 across each faction's turn-end

Constant across saves where the player faction has not ended its turn:
- rome1..rome6 (player Romans Julii turn 5 within-turn): +860 = 8
- rome10 (same in-game state, different session): +860 = 8
- rome7..rome9 (player Romans Julii turn 6 start, after T5 turn-end): +860 = 13
  (= 8 + 5)

This matches session-8's `+286/+282 character-record turn counter` pattern
(per-faction-turn tick of +5 per turn) but located at the major-faction-record
level, not the character record. It survives the major-faction-record interior
content shift (the player record grew by 6,714 bytes at the turn boundary)
because its position is offset from the record start, not from a content-
sensitive anchor. The constancy across rome10 (different session) rules out
the runtime-pointer interpretation.

Cross-faction check: Carthage (AI) at +860 = 1 in rome1..rome9 + rome10 (no
change across turn boundary, because Carthage's "+860" lies inside Carthage's
trailing data which was likely reorganized by the turn-end recalc). So this
+860 interpretation is **player-specific**: the player record's +860 is
stable across content shifts but for AI records, +860 falls in different
sub-structures depending on each faction's individual layout.

For session-10+, this needs validation: take a save where the player has
ended 5 turns in a row (Roman saves go from turn 5 to turn 11 in some
autosaves) and verify the +860 byte increments by 5 each turn.

#### Targets not landed, and why

- **Per-faction current military upkeep (Target #1)**: NOT pinned.
  - The trailing data after the region list is NOT byte-aligned across
    factions (each faction's record has variable embedded sub-records).
  - The dual-buffer hypothesis at fixed offsets (+1000 / +1152) was
    retracted on re-examination as a portrait-string vs. char-record
    aliasing coincidence.
  - The 12-record stride-354 array at +40719 inside the player record
    LOOKS like a per-army/per-character coordinate cache but cross-
    checking against the character parser's known X,Y values gave 0
    matches — those records are not the player's own armies.
  - To make progress, need either:
    (a) A save pair where ONLY a single unit is recruited (treasury
        drops by exactly the unit cost, upkeep should bump by exactly
        the unit upkeep). The rome corpus has no such isolated event.
    (b) An export-script dump from the engine listing per-faction
        upkeep, used as ground truth for byte-pattern correlation.
- **Per-faction construction spend this turn (Target #2)**: NOT pinned.
  - Same architecture problem as #1: the spend value lives somewhere in
    the trailing data, but byte-offset reads aren't stable.
  - Recommended future probe: inspect saves taken seconds apart where
    the player just started a construction project. The treasury drops
    by the building's cost; the construction-spend-this-turn accumulator
    should bump by the same amount. With a clean save pair from a known
    construction-start event, byte-diff is reliable.
- **Diplomacy state enum semantics (session 7's blocker)**: NOT
  attempted this session (no clean diplomatic-transition save pair in
  the corpus per session 7's analysis).

#### Reproducer scripts

- `scripts/save-cracker/dig-upkeep{1..12}.js` — per-faction trailing-data
  probes (turn-boundary diffs, hex dumps, structural detection)
- `scripts/save-cracker/dig-region-list{1..4}.js` — region-list stability
  comparison across saves and cross-campaign fingerprint check
- `scripts/save-cracker/dig-section{1..5}.js` — section walker prototypes
  (latest: dig-section5.js — full-file walk + depth histogram + name
  extraction)

#### Open questions for session 10+

- **Anchor the upkeep field via a clean recruit/disband event**: find a
  save pair (e.g. taken seconds apart) where the player recruits exactly
  one unit at a known cost AND a known upkeep. Diff and look for a u32
  in the +50..+200 denarii range that bumps by the unit upkeep value.
- **Validate the +860 player-turn-counter hypothesis** by reading a save
  10+ turns deep into a player's campaign and confirming the value
  equals 8 + 5*turns_elapsed.
- **Section walker false-positive filter**: enforce that for a section
  at offset P with size S, the bytes `P+8..P+S` should contain a
  contiguous run of valid sub-sections or all-zero/0xff padding. This
  will collapse the 4,428 → some smaller number of REAL sections.
- **Major-faction-record proper boundary**: with no taw-grammar header,
  the record's true end is determined ONLY by "next major-faction-record's
  start position". The current +0..(next_start - current_start) range
  includes many byte ranges that don't belong to the faction. Need a
  proper sub-record walker that stays within the faction's own
  sub-tree.
- **Inter-record reordering investigation**: the Sparta corpus shows
  saves where ONE major-faction record rotates by 1 slot. What
  serialization event causes this? Likely related to which faction's
  turn was being processed at save time. Test by saving in-game right
  after each faction's turn ends.

---

### Findings 2026-05-11 (background session 11 — construction queue + battle outcomes)

Goal: (1) decode the per-settlement construction queue (which chain/level is
being built, turns remaining); (2) find the per-character battle counter
(wins/losses); (3) re-attempt per-faction military upkeep aggregate; (4)
stretch: diplomacy enum semantics from a clean state-change save pair.

Outcome: construction queue **STRUCTURALLY DECODED** with a clean +53-byte
"queue block" inserted before the first building chain in any settlement that
has a construction project in progress, plus **CONFIRMED building-damage stat
byte at relative +36 from the damaged sub-record's cstring** in a separate
finding from the damagedturn1/notdamagedturn1 save pair. Battle counters
**NOT pinned in this session** (corpus lacked a clean isolated-battle pair).
Military upkeep stretch goal not progressed. Diplomacy state enum: the
Macedon Turn 97→98 End→99 Start corpus shows small-int byte changes inside
the Macedon faction record at +2002..+3000 that look like the same "AI
policy cache" structure session 7 identified — NOT the per-pair relation
matrix (no diplomatic transition in this 3-save sequence per the in-game
context of bankrupt late-game survival mode).

The save corpus this session is the **Alexander/Macedon campaign**
(`alexander` campaign tag at header offset 0x3a, not `imperial_campaign`).
Distinct from all prior session corpora — the file is much smaller (1.05 MB
vs 35 MB RIS imperial), has only 43 settlements (vs 1300+), 5 major-faction
records (vs 23), and 1 minor-faction record (vs 216). The structural
invariants from sessions 1-9 still hold (cb 00 00 00 settlement tag, faction
record signature with +8=100/+12=1/+44=6or8, etc.). Two new sub-record
type tags observed: `temple_of_governors`, `temple_of_one_god`,
`despotic_law`, `academic`, `equestrian` — these are Alexander-mod-specific
building chain names not in the prior RIS imperial corpus.

#### 1. CONFIRMED: settlement construction-queue block (+53-byte insert before
`core_building` chain when a construction project is in progress)

Decisive pair: `save_saveturn1start.sav` (1051379 bytes) → `save_saveturn1construction.sav`
(1052279 bytes, **+900 bytes** larger). The user started Pella's
construction project between these two saves; everything else was held
constant. Across the diff, **Pella's settlement record alone gains 53 bytes**
inserted between the `default_set` sub-record and the `core_building`
sub-record. Every OTHER settlement's `core_building` shifts forward by a
file-position-only delta (not a structural change). 

| Save | Pella core_building at | rel from name |
|---|---|---|
| save_saveturn1start | 0x10df9 | **+106** |
| save_saveturn1building | 0x10df9 | **+106** |
| save_saveturn1move | 0x10df9 | **+106** |
| save_saveturn2start (Pella @ 0x10f31) | 0x10f9b | **+106** |
| save_Noarmiesmovedturn1 | 0x10df9 | **+106** |
| **save_saveturn1construction** | 0x10e2e | **+159 (+53 vs baseline)** |

The 53-byte block is the construction queue entry. Structure (relative to
the byte AFTER the default_set sub-record's `08 00 00 00 27 00 00 00 01`
trailer; absolute Pella+64 in saveturn1construction):

```
Offset  Width  Value  Interpretation
+0      u32    800    BUILDING_CHAIN_ID (target — equals 0x320 = u32 800)
+4      u32    0      zeros
+8..+15 8 B    0      zeros
+16     u32    1      version marker (= 1)
+20     u32    0      zeros
+24     u32    runtime ptr   ← session-stable, runtime-pointer-shaped (NOT save data)
+28     u32    runtime ptr   ← second runtime ptr
+32     u32    1
+36     u32    0
+40     u32    800    BUILDING_CHAIN_ID (DUPLICATE — engine writes target twice)
+44     u32    0
+48     u32    2      ← STRONG hypothesis: TARGET LEVEL or TURNS REMAINING
+52     0..16  ...    trailing 12-16 bytes with 800 appearing a 3rd time,
                      then leads into the standard sub-record header
                      `01 00 00 00 0b 00 00 00 [u32 self-ptr] 0e 00`
                      that begins the existing `core_building` chain.
```

`u32 800` appears 3 times in the block (offsets +0, +40, and at ~+85
inside the trailing 16-byte segment). The third occurrence is preceded by
`00 00 00 01 00 00 02 00` which looks like flags. The triple-redundancy of
the building-chain ID matches the dual-buffer/runtime-cache architecture
seen elsewhere in this format (treasury duplicated at +0/+48, settlement
income at +683/+1127). Best-guess interpretation: one is the **canonical
target chain id**, one is the engine's **active-cache lookup key**, one is
the **UI-display source**.

**u32 800 = building chain ID** in the Alexander mod's
`export_descr_buildings.txt` index. Validation requires reading the mod's
building list and confirming index 800 corresponds to the next-level
core_building (e.g. wooden_pallisade → wooden_wall) — out of session scope
but tractable with mod data lookup.

**`u32=2` at +48 is the leading "turns remaining" candidate**. Turn 1 just
started in the save; many low-tier upgrades take 2 turns in vanilla RTW
balance. Alternative interpretation: **build queue length** (= 2 items
queued?) or **target chain level** (= upgrading to level 2 of the
core_building chain). Distinguishing requires a saveturn1construction →
saveturn1construction_midway pair where 1 turn elapsed — should drop to
`u32=1`. Not in current corpus.

**Validation across saves**: `u32=800` does NOT appear at Pella+0..+200 in
any of the 5 saves without construction (start, building, move, turn2start,
Noarmies). It appears at Pella+64, +104, +133 ONLY in saveturn1construction.
This is the cleanest "field present iff feature active" signal in the
dossier so far.

**Parser strategy for Provincia**: scan each settlement's record from the
default_set sub-record forward. If the next sub-record is at +53 from where
core_building's standard position would be (i.e., +159 instead of +106 in
Alexander format), read the 53-byte queue block to extract the construction
target. The block is only present when construction is queued. Settlement
record stride **expands by 53 bytes** when a building is under construction
in that settlement.

The session brief mentioned "Provincia infers queued buildings but doesn't
always show turns-remaining accurately" — this finding provides the
structural anchor for an accurate parser: when the settlement record has the
+53 insert, the construction is active; when it doesn't, the settlement is
idle. Turns-remaining is at insert offset +48 (HYPOTHESIS).

Note on the prior dossier (session 3): the "turn-boundary 0→ef fluctuation
at +2517..+2544 inside building1 sub-record header — likely building
completion progress counter" finding was inside Rome's record in
RIS imperial. That was inside the `default_set` sub-record's interior — a
distinct field from the construction-queue block found here. Both may be
real (one tracks per-chain "this building is ticking up" progress, one
tracks "actively-queued upgrade" target ID), but only the +53-insert
queue-block has a clean save-pair signal.

#### 2. CONFIRMED: building-damage stat u8 at sub-record cstring +(name.length + 30)

Decisive pair: `save_notdamagedturn1.sav` (1189090) vs `save_damagedturn1.sav`
(same 1189090 — same size, direct byte-aligned diff). The user took battle
damage on turn 1 in damagedturn1 but not in notdamagedturn1; saves are
otherwise identical (RNG counter at 0x43f8 type pattern + this single
in-place change). **Only 8 bytes differ across the entire 1.19MB file**:

| Offset | A (notdamaged) | B (damaged) | Width | Interpretation |
|---|---|---|---|---|
| 0x000efd | `16 0f` | `26 21` | 2 B | header-region hash propagation |
| 0x003604 | `1c` | `16` | 1 B | header-region delta (28→22) |
| **0x0111ec** | **`64`** | **`32`** | **1 B** | **building-damage stat: u8 100 → 50** |
| **0x030da0** | **`37`** | **`31`** | **1 B** | **soldier count in a unit: u8 55 → 49 (lost 6 men)** |
| 0x030df8 | `dc ea` | `44 e0` | 2 B | header-region hash propagation |
| 0x122277 | `01` | `00` | 1 B | name-table init bool (slave_men/slave_women section) |

**0x0111ec is inside Pella's settlement record** — specifically inside the
`market` sub-record at file offset 0x111c8, at relative offset +36 from
the cstring start. The bytes around it are `... 04 00 00 00 64 00 00 00
... 15 00 00 00 [ff filler]` — the standard `[u32 level=4][u32 health=100]`
trailer common to every building-chain sub-record. The damage event dropped
this u32 from 100 to 50, i.e. **the market building took 50% damage in the
battle**.

(NB: this `0x111ec` ≠ the same address in saveturn1start because the
damagedturn1 save is from a different game-state. The relative position
"+36 from market\\0 cstring start" is the portable anchor.)

**Confirmation across all market sub-records**: in notdamaged, 31 of 32
markets read `u32@+36=100`; in damaged, 30 of 32 read 100 and 1 reads 50.
Only ONE market was damaged (Pella's, per the user's save). All other
building sub-records (defenses, barracks, missiles, port_buildings,
hinterland_farms, hinterland_roads, theatres, etc.) carry their own `+36`
damage stat — same field offset, same default value 100.

**0x030da0 is inside an army-unit record** carrying Alexander's bodyguard
(the cstring "Alexander" appears 0xc2 bytes later in the file). Reads as
u8/u32 = 55 dropping to 49 (lost 6 soldiers). Verified by scanning at
48-byte stride from 0x30000: three other 55-valued u32s at 0x30b78,
0x30bd4, 0x30c34 (= different units in the same army, none damaged). The
fourth instance at 0x30da0 is the unit that took casualties. This
**confirms soldier count is a u32le at a known offset within unit records**
— already documented in prior sessions for naval/land units but here cross-
validated against a known-event damage.

**0x122277 is a name-pool init bool** (= 0 in damaged, 1 in not). The byte
sits in a region of culture-name table init (slave_men, slave_women,
parthia_men, ...). Unclear semantic — possibly a "user-played-this-game"
or "save-source" marker. Not battle-related; benign by-product.

**Implication for Provincia**: building damage state is per-sub-record at
cstring+36 as u32. Values observed: 100 (intact), 50 (damaged), and from
the cross-save sweep `damagedturn2` shows `66` (= 102 — POTENTIALLY
healed/being-repaired between damagedturn1 and damagedturn2). Saveturn2start
has the value as `0` for that same byte offset, suggesting position drift
between saves — must locate by sub-record cstring proximity, not absolute
offset.

#### 3. STRUCTURAL: same-format unit/army records appear at 48-byte stride
near Alexander's character/army region

Discovered while tracing the 55→49 unit-count diff. The region around
0x30b78..0x30da4 in the damagedturn1 corpus is a contiguous array of
**48-byte unit records** with the following internal layout (4 records
sampled):

```
+0   u32  X-ish (24..38 — could be tile X within local frame)
+4   u32  Y-low-ish (1186..1316 — looks like an unit-id-derived hash)
+8   u32  Y-high or count (1822..1830 — also hash-like)
+12  u32  zero
+16  u32  soldier_count (= 55 in 3 records, dropped to 49 in 4th)
+20..+45  zeros (padding)
+46..+47 hash bytes (varies)
```

Inter-record stride = 48 bytes. Adjacent records share the `c2 01 00 00
2b 15 00 00` prefix (= u32=450, u32=5419 — possibly faction-id pair
shared across army-mates). This is consistent with a **per-army unit
roster** where each unit is represented by a 48-byte struct, and the army
groups them by shared faction-tag bytes.

The pattern matches the dossier's prior unit-record finding but in a
shorter compact form. The `48-byte stride` may be specific to **bodyguard
units** (smaller record than regular units which carry more state). Worth
testing on a save where a known field army has both bodyguard and infantry
units.

#### 4. STRUCTURAL: faction-record signature works for the Alexander campaign
(5 major + 1 minor record)

Session 5's faction-record signature `(+8=100, +12=1, +24=self, +40=self,
+44=6)` finds exactly 5 records in the Alexander Macedon corpus:

| idx | pos (Turn 97) | treasury | regions |
|---|---|---|---|
| 0 | 0x63a38 | -255926 | 25 | **Macedon (player)** |
| 1 | 0x8ec33 | -66504 | 3 | Persia |
| 2 | 0x8fdf6 | 0 | 2 | (third faction, treasury 0) |
| 3 | 0x90d28 | 0 | 2 | (fourth, treasury 0) |
| 4 | 0x92961 | 0 | 3 | (fifth, treasury 0) |

Player at index 0 (matches dossier convention). Treasury is deeply
negative for Macedon (bankrupt late-game survival mode at turn 97).

**Minor faction records (+44=8)**: only 1 in the Alexander corpus, at
0xc5091 — also Macedon-tied (treasury -170424). The Alexander campaign
has very few factions, so the two-tier major/minor architecture from
RIS imperial is preserved but with a much shorter record list.

The 3-save sequence (Turn 97 / Turn 98 End / Turn 99 Start) shows the
Macedon record drifting in file position by ~5KB between saves but with
stable index-0 position. Treasury evolves: -255926 → -255139 (+787) →
-254381 (+758). The +787 gain at turn-end is the net AI-faction income
minus upkeep, but the upkeep field itself is not isolatable without a
disband/recruit save pair (per session 9's blocker).

#### 5. NEGATIVE: Macedon's 7,000-byte record interior contains a small-int
byte cluster at +2002..+3000 with 600+ byte changes per turn, but NOT a
clean diplomatic-state matrix

The Macedon record (idx 0 minor) interior shows:
- **+0..+128**: small clusters of 2-4 byte changes per turn (runtime hash
  propagation — same architecture as the session 6 / session 7 diplomacy
  cookie)
- **+2002..+3000**: 619 diff runs in the Turn 97→98 End diff, with values
  in the {0..7} small-int range. **This is the same shape as session 7's
  Sparta "124-array" that session 7 RETRACTED as a per-turn AI policy
  cache**. The Macedon variant has ~250 records visible. Byte values
  decrement/increment by small amounts (1-2) per turn.
- **+4000..+7000**: more small-int clusters with similar dynamics

The interpretation matches session 7's conclusion: **this region is the
per-turn-recomputed AI policy cache, NOT the diplomacy state matrix**.
Pure diplomatic state (war/peace/alliance/trade rights) is stored
elsewhere — likely inside a separate body section that isn't anchored at
the faction record by a fixed offset.

#### 6. NEGATIVE: battle-counter (wins/losses) per character — not found in
this session's corpus

Diffing the 8-byte signal of damagedturn1 vs notdamagedturn1 isolated:
- Building damage (0x111ec)
- Unit soldier count (0x30da0)
- A name-table init byte (0x122277)
- 5 hash-propagation bytes (header region)

**No per-character battle counter increment found** in the diff. Either:
(a) the battle in damagedturn1 didn't generate a counter increment (it was
NOT autoresolved — maybe just garrison damage during siege approach), OR
(b) the battle counter is updated only at turn-end, not at battle time
(would need a turn-end save pair to isolate), OR
(c) the counter is stored INSIDE the character's trait block as a special
trait threshold (some RTW mods use "BattlesWon" as a trait that increments
on real battles).

The session 4 character-record byte map covered +0..+302 with strong
coverage. Per-character battle wins/losses, if stored, would need to be
in either the trait block (where it would appear as a high-counter trait
ID like "BattlesWon" that the engine bumps each real combat) OR in a
post-portrait extension that session 4 didn't probe past +540. A future
probe should:
- Diff two character records belonging to the SAME general across a
  save where that general won a battle vs. before the battle
- Look at the trait block for any trait that increased in level by 1
- Look at the 32-byte zone immediately after the portrait2 cstring (the
  "tail" we haven't deeply explored)

This session does NOT have a save pair with a clean isolated battle that
spans a turn boundary. The damagedturn1/notdamagedturn1 pair is
within-turn (no turn-end recalculation has run, so any "save-time"
counters wouldn't have updated yet).

#### 7. NEGATIVE: military upkeep — still blocked

Session 9 ended on this target with the same conclusion. The Macedon
record's trailing data (after region list +52+4*25=152) extends ~7000
bytes but is NOT byte-aligned across turns or factions. Without a
disband/recruit save pair, the upkeep aggregator can't be pinned.

#### Reproducer scripts

- `dig-construction1.js` through `dig-construction18.js` — settlement
  construction-queue probe sequence. The decisive script is
  `dig-construction17.js` (precise A-vs-B diff aligned by `core_building`
  cstring) and `dig-construction18.js` (cross-save u32=800 detection).
- `dig-battle1.js` through `dig-battle10.js` — battle damage probe
  sequence. Decisive script is `dig-battle10.js` (cross-validation of
  the building-damage byte offset = cstring + 36).
- `dig-upkeep-disband1.js` — Alexander campaign faction record
  enumeration (5 major + 1 minor).
- `dig-diplo4.js` — Macedon record turn-boundary diff (negative result
  for diplomacy state, but documents the 619-byte-cluster AI policy cache
  structure).

#### Open follow-ups for session 12+

- **Building chain ID 800 interpretation**: read the Alexander mod's
  `export_descr_buildings.txt` and confirm index 800 is a valid upgrade
  target for Pella's core_building chain. (Mod data lookup, 10-min task.)
- **Construction "turns remaining" u32 at +48 of queue block**: need a
  save pair where 1 turn elapsed during the construction. Should drop by
  1 or by a known per-turn-progress increment.
- **Per-character battle counter**: find a save pair with a clean
  autoresolved-battle event spanning a turn boundary (post-end-of-turn
  state). Diff the character record in tail bytes (+220..+540) and
  trait block for an incremented small int.
- **Multiple-building queue**: the +53 insert in this corpus is a single
  construction entry. RTW supports queuing multiple buildings per
  settlement (with a build-queue UI). A save with 2-3 queued buildings
  would show a +53 × N inserted block, with each entry carrying a
  different building chain ID. Cross-validate by setting up a queue
  in-game and saving.
- **Building damage interpretation**: confirm u8 100=intact / 50=damaged
  generalizes to "percent health out of 100" or is a binary
  intact/damaged enum (verify by inducing more damage). The
  damagedturn2 save shows value 66 (= 102 per low byte read) at the
  same logical location — but that's a different save state, not a
  3rd damage step.

---

### Findings 2026-05-11 (background session 10 — unit XP/armour/weapon + settlement building sub-records)

Goal: (1) pin per-unit XP / armour / weapon upgrade bytes inside the unit
record (currently Provincia seeds these from descr_strat turn-0 values and
defaults to 0 for mid-campaign recruits, missing live in-save state); (2)
finish the settlement record's building sub-record interior.

Outcome: **XP byte CONFIRMED** at unit-record `regionEnd+20` with values
strictly in 0..9 plus a separate high-bit flag (0x80). **Weapon upgrade byte
CONFIRMED** at `regionEnd+17` with values 0..1 observed across 5,857 unit
records carrying weapon_lvl 1. **Armour upgrade byte HYPOTHESIZED** at
`regionEnd+16` by symmetry — never observed >0 in the 33,727-unit corpus
(no faction had built an armoury). **Morale-state byte STRONG** at `+19`
showing 64/80/96/112 in lockstep with XP gains. **Per-soldier array stride
= 9 bytes** starting at `regionEnd+28`. Building sub-record findings are
described below as a refinement of session 11's construction-queue work, not
a duplication.

Save corpus this session: the **Alexander/Macedon calibration corpus**
(`C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z`, 1369 saves,
196 unique turn/phase pairs from Turn 1 to ~Turn 50 of a Macedon campaign)
plus rome10 (RIS imperial Roman player turn 5) and the older Alexander/Rome
single saves. The Macedon corpus is the **decisive battle-survivor source**
— units fight repeatedly across turns and several phalangists/hypaspists
accumulate XP from 0 to 9 over the campaign. The Roman corpus contributes
the cross-faction weapon_lvl=1 validation.

#### 1. CONFIRMED: per-unit XP byte at `regionEnd + 20`

Cross-validated across 196 Macedon saves (Turn 1 Start through ~Turn 50) +
rome10/RoR Turn 1. The unit-record `regionEnd` anchor used here is identical
to the existing parser's: it points to the byte immediately AFTER the
post-region `0xffffffff` (variant A) or small-int (variant B) terminator —
the same offset where `commanderUuid` lives at +0, `max` at +8, `current`
at +12.

| Δ from regionEnd | Type | Value range | Confidence | Meaning |
|---|---|---|---|---|
| **+20** | **u8** | **0..9 ∪ {128}** | **CONFIRMED** | **Unit experience / chevron level**. Low nibble (bits 0..3) holds the chevron count (0..9, matching RTW's max 3-tier gold-chevron cap). Bit 7 (0x80) is a separate flag — observed only on Roma garrison units in `save_rome10.sav` (14 of 14 Roman starting units in the capital had 0x80 set with chevrons = 0). Best-guess: "this unit was placed by descr_strat / starting roster" flag.  |

**Distribution across 33,727 unit records** (4 corpora, 72 saves):
- `+20 = 0`: 33,659 (99.8%)
- `+20 = 1`: 13 / `+20 = 2`: 3 / `+20 = 3`: 9 / `+20 = 4..9`: 21 / `+20 = 128`: 28
- Never any value in (9, 127) ∪ (128, 255). The high bit 0x80 is a clean flag, the low nibble is the XP count.

**Decisive cross-turn validation** (Macedon T13 End → T14 Start, three units
gained chevrons during the inter-turn AI rotation):
```
[T13→T14] hypaspists @ Macedon: +20 = 1→3
[T13→T14] hypaspists @ Macedon: +20 = 1→2
[T13→T14] phalangists @ Macedon: +20 = 1→2  (lost 177 soldiers, survived)
```

**Implication for Provincia**: parser can now read live XP from the save
directly. Replace the descr_strat-seeded fallback with `buf[regionEnd + 20]
& 0x0f` for the chevron count.

#### 2. CONFIRMED: per-unit weapon-upgrade byte at `regionEnd + 17`

Cross-corpus distribution shows `+17 ∈ {0, 1}` only. The units with `+17 = 1`
in T13 End are **exactly the 11 Macedonian phalangists/hypaspists**.
Phalangists and hypaspists in the Alexander campaign's `descr_strat.txt`
start with `weapon_lvl 1`; every other unit type (hoplites, javelin
skirmishers, allied cavalry, persian infantry, etc.) starts with
`weapon_lvl 0`.

| Source | `+17 = 1` units | Cross-reference |
|---|---|---|
| Macedon Turn 1 End | 11 (7 phalangists + 4 hypaspists) | both have `weapon_lvl 1` |
| Macedon Turn 97 | 11 (same) | same |
| save_rome10 (RIS imperial) | 2,582 of 4,056 (64%) | roman_leves, roman_hastati_early, roman_principes_early, roman_general — all carry `weapon_lvl 1` in Roman descr_strat |
| save_Republic_of_Rome_Turn_1 | 2,582 (same factions) | same |

The strictly-binary distribution (0 or 1 only, never 2/3) is consistent
with **weapon-upgrade byte stored as the engine's `weapon_lvl` field**
(0..3 range; 0..1 observed). A future probe should verify the 2/3 values
by checking a save where the player has built a Royal Armoury (which
grants weapon_lvl 2..3 per RTW vanilla building tree).

**Implication**: `buf[regionEnd + 17]` reads the live weapon upgrade level
0..3. This replaces the descr_strat fallback for mid-campaign recruits.

#### 3. HYPOTHESIS: per-unit armour-upgrade byte at `regionEnd + 16`

Never observed >0 in 33,727 unit records across 4 corpora. By symmetry
with the `+17` weapon byte (4 adjacent bytes at +16/+17/+18/+19 form an
obvious "unit modifier pack"), `+16` is **likely the armour upgrade byte**
(0..3, same RTW convention). The negative evidence is consistent with all
4 corpora being **early-to-mid Macedon/Roman games where no armoury
buildings had been constructed**. To prove: find a save with a unit
recruited after a `weapon_smith` / `armory` / `barracks` chain upgrade and
re-check.

The 4-byte pack `[+16 armour][+17 weapon][+18 ?][+19 morale-state]`
matches the in-game UI's "stat boost icons" layout (chevron + shield +
sword + horse icons in the unit card).

#### 4. STRONG: morale-state byte at `regionEnd + 19`

Always `0` when `+17 = 0` (units without weapon upgrades).
When `+17 = 1`, `+19` takes values in `{64, 80, 96, 112}` (steps of 16,
range 0x40..0x70). Across all 11 Macedonian weapon-upgraded units:
- XP=0 → +19=64 (24 instances)
- XP=3 → +19=64, 80, 96, 112 (varies)
- XP=5..6 → +19=80, 96
- XP=7..8 → +19=96, 112
- XP=9 → +19=112

The 16-step quantization plus the dependency on weapon_lvl + XP suggests
**+19 encodes the unit's current TOTAL morale stat** (base from
descr_strat + chevron bonus + weapon-upgrade morale boost). The raw value
might be `(base_morale + bonuses) * 16` or a 4.4 fixed-point encoding.

Conservatively classify as **STRONG: morale-state aggregator** until
verified against in-game UI morale numbers. Provincia could ignore this
byte for now since the UI displays computed stats; the per-record XP/
weapon/armour bytes are the actionable ones.

#### 5. STRUCTURAL: per-soldier array layout = 9 bytes per soldier, starts at `regionEnd + 28`

The unit record's per-soldier "men" array begins at `regionEnd + 28` and
extends for `9 * max_soldiers` bytes (approximately — measured ratio
9.16..9.24 across the corpus, suggesting a small per-unit trailer or
alignment padding).

Per-soldier stride observed (from Macedon hoplites, hypaspists, etc.):
```
+0  u8   health-like (often 0 for first soldier or > 0)
+1  u8   stat?
+2  u8   morale/state byte — typically 0x10, 0x20, 0x30, 0x40, 0x50, 0x60 (= multiples of 16)
+3..+8  6 bytes of zeros (sentinel padding)
```

Soldier records are packed sequentially with NO alignment, so soldier N
starts at byte `9*N`. Total array bytes ≈ `9 × max_soldiers` but the per-
unit trailer (~20-40 bytes) brings the next-record gap to ~`9 × max +
26..39` depending on unit type.

This is **per-soldier data** — it varies per battle outcome (each fallen
soldier zeros out their entry). NOT useful for unit-level XP/armour/weapon
display (those live in the +16..+20 zone of the unit header). Documented
for completeness.

#### 6. REFINEMENT: building sub-record `core_building` payload byte at `+4 after the hash u32` = current chain level

Session 11 documented the +53-byte construction queue insert when a
project is active. This session adds a **non-queue field** decoded from
the 32 `core_building` sub-records in `save_saveturn1start.sav`
(Alexander Macedon, no construction active):

Each `core_building` sub-record follows the standard sub-record header
`[u32 self-ptr at nameOff-6][u16 nameLen+1][asciiz "core_building"][u32
runtime_hash]`. The byte at **payload + 4** (= the 5th byte after the
nul-terminated name, equivalent to the FIRST byte after the runtime
hash) holds a **small integer in 0..4**:

| `+4` value | count |
|---|---|
| 0 | 8 |
| 1 | 11 |
| 2 | 9 |
| 3 | 3 |
| 4 | 1 |

That's exactly the right shape for a **current building chain level**
(0 = village, 1 = small town, 2 = town, 3 = large town, 4 = city, etc.).
The single `+4 = 4` settlement is the largest in the Macedon T1 corpus.

The 20 bytes following this level byte are usually all zero, with two
exceptions where they contain the byte sequence `53 74 54 65 45 6e 52 74
45 73 44 5c 5c 52 43 65 6f 73 6e 6f` ("StTeEnRtEsD\\RCeosno" as ASCII).
Pattern repeats in core_building, defenses, barracks, port_buildings,
hinterland_roads sub-records — looks like **uninitialized runtime memory**
that the engine memcpy'd into the serialized struct from a `BuildingLevel*`
pointer cluster (consistent with x64-pointer-bytes-as-ASCII coincidence).
Not save data; ignore.

After the 20-byte zone, every sub-record has `[u32 = 4..17 (probably
"building-id integer for the current building")][u32 = 100 = 0x64
constant (probably "max health = 100")][zeros][u32 = 0x15 = 21 (?)]
[ff filler]`.

**Implication for Provincia parser**: each settlement's building chain
state can now be read as `[u32 hash][u8 level @ +4][20 zero/ptr bytes]
[u32 building_id][u32 = 100 max_health][zeros][u32 = 21][ff filler →
next sub-record]`. The u8 level at +4 gives the current upgrade tier of
each chain; combined with session 11's `cstring + 36 = u32 damage stat`,
parsers can render both progression and damage state.

#### 7. STRUCTURAL: `default_set` sub-record is a SETTLEMENT-LEVEL aggregator, not a building chain

The `default_set` sub-record (the FIRST sub-record in every settlement,
matching session 3's documentation) is **not** a building-chain record like
core_building/defenses/etc. Its payload structure is distinct:

```
+0..+3:   u32 self-ptr to nameOff-2-4 + 12 (= absolute file position)
+4..+7:   u32 runtime hash (changes between game sessions)
+8..+11:  u32 = 0xfcfcfcfc filler/separator
+12..+15: u32 (varies per settlement — building chain index count? = 8 in Pella, 7 elsewhere)
+16..+19: u32 (varies — 39 in Pella, smaller for less-developed cities)
+20..+23: u32 = 1 (constant version marker)
+24..+40: 17 bytes of zeros
+41..+44: u32 = 1
+45..+47: zeros
+48..+51: u32 = 1
+52..+55: u32 = 11 (or 7..14)
+56..    end (57 bytes total in a non-construction settlement)
```

When a construction is queued, the `default_set` payload grows by **53
bytes** (session 11 finding) — the queue block is inserted INSIDE the
default_set payload, not between sub-records as initially hypothesized.
This refines session 11's wording: the queue block sits at
`default_set + ~64`, ending before the standard `01 00 00 00 0b 00 00 00`
trailer.

Triple-occurrence of `u32 = 800` (target building chain ID) inside the
queue block matches session 11's count of 3 ID occurrences. The session
11 hypothesis "u32 at +48 of queue block = turns remaining" remains
unvalidated this session — Macedon corpus lacks consecutive
construction-progress saves.

#### 8. NEGATIVE: armoury upgrade samples — corpus too narrow

No save in the Macedon/Rome/Alex corpora has units with `+16 > 0` (armour
upgrade > 0). Either:
- All 4 player factions are early/mid-game without armoury chains built
- `+16` is NOT the armour byte (would need an alternative offset to test)

The Provincia user could record a save AFTER building a Royal Armoury and
recruiting a unit; the recruited unit's +16 byte should equal the armoury
upgrade level (1, 2, or 3). Once that single positive sample exists, the
+16 finding becomes CONFIRMED.

#### Reproducer scripts

- `dig-unitstats1.js` through `dig-unitstats22.js` — XP/armour/weapon
  probe sequence. Decisive scripts:
  - `dig-unitstats14.js` — first identified +20 as a monotonic
    candidate by tracing one phalangists unit across 125 snapshots
  - `dig-unitstats18.js` — full XP-distribution sanity check across 196
    saves (0..9 + 128 only)
  - `dig-unitstats21.js` — cross-corpus weapon_lvl validation
    (Macedon, Rome, Alex)
  - `dig-unitstats22.js` — exhaustive 33,727-unit scan for armour > 0
    (none found)
- `dig-buildchain1.js` through `dig-buildchain12.js` — building
  sub-record decode. Decisive scripts:
  - `dig-buildchain3.js` — core_building +4 byte distribution (0..4
    levels)
  - `dig-buildchain10.js` — sub-record file-order in Pella before/after
    construction
  - `dig-buildchain12.js` — three-way Pella default_set diff
    (start/build/construction)

#### Open follow-ups for session 12+

- **Validate +16 armour byte** with a save where an armoury was built
  (only takes 1 save sample). Recommended: in any Roman save, recruit a
  unit AFTER building blacksmith → urban armoury chain. The recruited
  unit's record should have `+16 > 0`.
- **Decode bit 0x80 of +20**: only seen on 14 Roman garrison units in
  rome10. Test: re-save after moving one of these units OUT of Roma —
  does the bit clear? If yes, it's "in capital garrison" / "fresh
  starting roster" flag. If unchanged, it's a permanent unit-class
  marker.
- **Confirm building chain ID 800 → mod data**: read
  `export_descr_buildings.txt` for the Alexander mod and check what
  building has internal ID 800. (Was already flagged in session 11.)
- **Cross-validate +19 = morale-state**: take a save where a general
  with high command is present vs. absent in an army. The +19 byte
  should differ proportional to command stars.

---

### Findings 2026-05-11 (background session 13 — construction queue + character family tree)

Goal: (1) cross-validate session 11's HYPOTHESIS that u32 at construction-
queue-block offset +48 = "turns remaining" by finding a save pair where 1
turn elapsed during a known construction; (2) pin **settlement queue
position** for multi-building queues; (3) finish character record bytes
+219..+285 / +287..+301; (4) **family tree relationships** — spouse,
children, siblings.

Outcome: target 4 (family tree) **CONFIRMED with high confidence** — child
uuids live in the character record at a 4-byte-stride slot array starting
at **+54 (LAYOUT_A) / +50 (LAYOUT_B)** in age-descending birth order.
Target 1 (construction turns-remaining) **negative result** — the only
turn-boundary save pair available (saveturn1construction → saveturn2start)
**REMOVED the entire +53 queue block** rather than decrementing it,
suggesting either the construction completed in 1 turn OR was abandoned.
The u32=2 at +48 is therefore likely **build cost / target level**, NOT
turns-remaining. Targets 2 and 3 (queue position, character tail bytes
+219..+301) had no clean differential signal in available corpus.

#### 1. CONFIRMED: child UUIDs stored as 4-byte-stride slot array at character record +54 (LAYOUT_A) / +50 (LAYOUT_B)

The decisive test: enumerate every parent-child pair in the 937-character
Rome T1 save and check WHERE in the parent's record the child's primaryUuid
appears. Result: **218 / 218 children's uuids found in their parent's
record** — perfect coverage. Slot offsets (relative to parent record start):

| Slot | LAYOUT_A offset | LAYOUT_B offset | Width | Count of hits (T1 corpus) |
|---|---|---|---|---|
| child[0] | +54 | +50 | u32 | 192 (LAYOUT_B) + 1 (LAYOUT_A) |
| child[1] | +58 | +54 | u32 | 16 (LAYOUT_B) + 1 (LAYOUT_A) |
| child[2] | +62 | +58 | u32 | 6 (LAYOUT_B) |
| child[3] | +66 | +62 | u32 | 2 (LAYOUT_B) |

The -4 shift between LAYOUT_A and LAYOUT_B is the same shift session 4
documented for every post-+5 field. Reproduced byte-for-byte in
**save_rome10.sav** (a different game session of the same in-game state)
— same 218/218 coverage at the same offsets.

**Slot assignment is by birth order, NOT current age**. Most parents (e.g.,
Kassandros: PhilipposD-67, AlexandrosE-66, AntipatrosB-64 → +50,+54,+58)
fill consecutive slots in age-descending order. But several exceptions
suggest dead/missing children preserve their slot index:

- **Antiochos** (uuid=132772696, 2 living children SeleukosB-24 and
  AntiochosB-16): kids at **+50 and +62**, with garbage at +54, +58.
  Implies 4 birth slots, of which slots 1 and 2 hold dead intermediate
  children's stale data.
- **Pyrrhos** (3 living children at ages 25, 23, 22): kids at **+54, +58,
  +62**, with garbage at +50. Implies an even-older first child whose
  slot is preserved.

The "garbage" between active slots is **per-session re-randomized**: in
Quintus Ogulnius_Gallus's record (LAYOUT_A, 2 sons), bytes at +50..+53
and +62..+65 differ between save_T1 and save_rome10 even though the
in-game state is identical. The active child-uuid slots at +54 and +58
also differ (because the uuids themselves are per-session). The
distinction is that the uuids match real characters in the same save's
character table, while the garbage doesn't.

**Cross-game-session validation**:

| Save | Quintus's +54 → | Quintus's +58 → |
|---|---|---|
| Rome T1 | uuid=2975434905 = **Servius Ogulnius_Gallus** (age 36) | uuid=2090620317 = **Marcus Ogulnius_Gallus** (age 30) |
| save_rome10 | uuid=3469267916 = **Servius Ogulnius_Gallus** (age 36) | uuid=519390266 = **Marcus Ogulnius_Gallus** (age 30) |

Same in-game state, different uuids in each save, but **slot+54 always
points to Servius (eldest) and slot+58 to Marcus (younger)**. The
implementation uses primaryUuid (per-session-randomized 4-byte ID) to
encode the family edge — same architecture as fatherUuid at +46
(LAYOUT_A) / +42 (LAYOUT_B).

**Number of slots**: the byte-diff scan between Rome T1 and rome10 shows
+44..+61 (LAYOUT_A) / +40..+57 (LAYOUT_B) as the "variable" zone, with
+62..+65 also varying for characters with ≥4 children OR with 3 dead
ancestors. The active slot count empirically caps at 4 (highest observed
= Kassandros with 3 living kids, no 5-kid parent in any corpus).

**Parser strategy for Provincia**: read u32 at parent_offset + 54 (resp.
+50 for LAYOUT_B) for child[0]. If it's a valid uuid (small non-zero
value, matches an existing character in the same save), it's a real
child. If not (e.g., looks like random hash bytes ~0x80000000+), the
slot is empty / dead-child stale data. Stride forward by 4 bytes for
additional children.

The session 4 dossier interpretation of `+50: 12B character birth-seed
hash` is **retracted** — that 12-byte zone is actually the
child-uuid-slot-array region. The variability across game sessions
session 4 observed is real but stems from per-session uuid
re-randomization, not from a runtime hash being written into a
constant-byte slot.

Note: this finding does NOT pin the **spouse uuid** or **mother uuid**.
The garbage bytes between active child slots are NOT consistent across
multiple parents with the same in-game state — Quintus's +50 is
`2727630246` in T1 and `2520745189` in rome10. If +50 were the spouse
uuid in LAYOUT_A (the "child[0] slot" is at +54 in LAYOUT_A, so +50 is
unused), it should match a female character — but the Rome corpus has
**zero female characters detected** by the parser (all 937 chars have
gender ∈ {1=male, 0=unknown}). RTW probably stores wives in a separate
table or with a different record signature the parser doesn't match.

#### 2. STRUCTURAL: child slot array continues past +62 for high-fertility families

Inspecting all 191 LAYOUT_B families with ≥1 child in the Rome T1 save:
- 168 have just 1 child → only +50 populated
- 18 have 2 children → +50 and +54
- 5 have 3 children → +50, +54, +58
- 0 have 4+ children

But the offsets-where-children-were-found scan also caught **2 hits at
+62** — these come from the Pyrrhos / Ptolemy / Antiochos exceptions
above (kids shifted into later slots when an earlier slot is occupied by
dead-child data). The "5th slot" at +66 was never observed populated by
a living child in any corpus save. The exact maximum is unclear (RTW's
descr files cap manageable family size at 5-7 children but most are
single-child).

The slot array probably extends **up to 4 (LAYOUT_A: +54..+69) or 4
(LAYOUT_B: +50..+65)**, matching the 16-byte "+50..+65 zone" that
session 4 mis-identified as a 12-byte hash. After the array, the
constant sentinel `ff ff ff ff` appears at +70 (LAYOUT_A) / +66
(LAYOUT_B).

#### 3. NEGATIVE: construction queue "turns remaining" — saveturn1construction → saveturn2start REMOVES the queue block entirely

The session 11 HYPOTHESIS was that u32 at queue-block offset +48 (value =
2 in saveturn1construction) decrements per turn. The clean test was
save_saveturn1construction (queue block present, +48=2) versus
save_saveturn2start (1 turn later, same in-game position).

Result: **save_saveturn2start has NO queue block** — Pella's `core_building`
sub-record is back at +106 from the settlement name (baseline), matching
save_saveturn1start. The 53-byte queue insert is GONE.

Possible explanations:
- **Build completed in 1 turn**: the construction in saveturn1construction
  was a 1-turn building (perhaps a low-tier upgrade), and the engine
  removed the queue block at turn-end when it finished. The new building
  level should be reflected somewhere in core_building.
- **User abandoned the construction**: between saveturn1construction and
  saveturn2start the player may have cancelled the queue.

Either way, **u32=2 at +48 is NOT turns-remaining** in the simple
decrement sense — it must be either (a) build cost (= 2 turns from start),
(b) target level enum, or (c) some other progress-tracking field. The
session 11 finding that the block is structurally a 53-byte insert with
chain_id at +0, +40, +85 still holds; the +48 field's semantic is
**reopened**.

The 1-turn-completion theory is testable by examining
saveturn2start's Pella core_building sub-record to check whether the
chain has advanced (versus saveturn1start's identical state). Out of
session scope.

Counts of u32=800 across the Alexander corpus confirm the queue block is
unique to saveturn1construction:

| Save | u32=800 count | Notes |
|---|---|---|
| save_saveturn1start | 0 | no construction queued |
| save_saveturn1building | 2 | unrelated (random table hits) |
| **save_saveturn1construction** | **8** | 3 in queue block + 5 random |
| save_saveturn2start | 2 | queue gone; only random hits |
| save_damagedturn1 | 3 | no queue (different save line) |
| save_damagedturn2 | 2 | no queue |
| save_Noarmiesmovedturn1 | 0 | no queue |
| save_Macedon Turn 97/98/99 | 0/0/0 | late-game, no queue |
| save_Macedon Turn 7/8 calibration | 8/8 | non-queue-block hits |

Strict structural signature for queue block (`v0=v40 ∈ [1..2000]` AND
`v4=v8=v12=v20=v36=v44=0` AND `v16=v32=1`) matches **exactly 1 position**
across all 11 saves tested — Pella+64 in saveturn1construction. This
signature can be used as a parser to detect construction queues with
zero false positives in the current corpus.

#### 4. NEGATIVE: settlement queue POSITION — not pinned this session

The 53-byte queue block found in session 11 represents a SINGLE construction
project for Pella. To pin the queue POSITION field, the corpus would need
a save with 2-3 buildings queued simultaneously in one settlement — none
available. The queue-block trailing bytes (+52..+88) contain runtime
pointers and an `01 00 02 00 ... 20 03 00` byte-misaligned pattern with
the chain_id 800 appearing a third time at byte offset 133 from queue
start. This trailing region is the leading candidate for a "next queue
entry" or "queue-rank" field but cannot be validated without a
multi-queue corpus.

#### 5. NEGATIVE: character record bytes +219..+301 still mostly mapped to "stable per-character state, not per-turn delta"

Byte-by-byte diff of all 936 matched characters between save_T1 and
save_rome10 (different game sessions, same in-game state) confirms:

- **+0..+90**: 60-70% of bytes differ per character — these encode
  per-session-randomized uuids (fatherUuid, child uuids), birth seeds,
  and the role/age-encoding zone.
- **+91..+150**: 0-15% differ — mostly stable, with brief differences at
  +118 (95/936), +122 (128/936 — the +5/turn counter from session 8).
- **+151..+218**: 0-3% differ — broadly stable.
- **+218..+278**: 5-12% differ across selected ranges — variable per
  character but stable per save. Specifically:
  - +218..+222 (38-88/936 chars differ): low-volume per-char state.
  - +246..+258 (~30-91 chars differ): a cluster.
  - +266..+277 (~13-102 chars differ): another cluster.
- **+278..+301**: 0-3% differ — broadly stable.

These low-volume clusters carry per-character state that's stable across
the game session but varies across game sessions (similar to fatherUuid
shape). They are NOT runtime hashes (which would 100% differ); they
encode meaningful but uuid-shaped per-character data — leading candidates
are **secondary uuids referencing other characters** (like the +18
clanHead pointer session 8 documented for 2 of 25 LAYOUT_A characters).

Cross-save **within-turn** corpus (damagedturn1 → damagedturn2, a single
turn boundary with a known battle event): only 3 characters matched by
uuid across both saves, and **zero bytes differed in any character's
+0..+302 range** — confirming the battle event didn't write into the
character record. The unit-soldier-count drop happened in the unit
record at 0x30da0, not in the character record. **Per-character battle
counter remains unpinned**; the session 11 conclusion that battle counters
live elsewhere (in trait block or unit record) still holds.

#### 6. RETRACTION of session 4's `+50: 12-byte character birth-seed hash`

The "12-byte hash" annotation in the session 4 byte map was incorrect.
That region is the **4-slot child-uuid array** (4 × 4 = 16 bytes,
LAYOUT_A +54..+69 / LAYOUT_B +50..+65). The variability session 4
observed is real but stems from:
1. Per-session uuid re-randomization of the child slots (active slots).
2. Per-session re-randomization of inactive slots (engine writes garbage
   into unused or dead-child slots).

The corrected byte map (LAYOUT_A; LAYOUT_B is -4 shifted from +5 onward):

```
+46   u32  fatherUuid                          CONFIRMED ◆ session 4
+50   u32  ?? (per-session garbage, NOT a slot in LAYOUT_A)
+54   u32  child[0]_uuid (eldest by birth)     CONFIRMED ◆ session 13
+58   u32  child[1]_uuid                       CONFIRMED ◆ session 13
+62   u32  child[2]_uuid                       CONFIRMED ◆ session 13
+66   u32  child[3]_uuid (rare in practice)    STRONG ◆ session 13
+70..+73  4-byte ff ff ff ff sentinel          CONFIRMED ◆ session 13
+74..+78  ...                                  (untouched)
```

For LAYOUT_B:
```
+42   u32  fatherUuid                          CONFIRMED ◆ session 4
+46   u32  ?? per-session garbage
+50   u32  child[0]_uuid (eldest)              CONFIRMED ◆ session 13
+54   u32  child[1]_uuid                       CONFIRMED ◆ session 13
+58   u32  child[2]_uuid                       CONFIRMED ◆ session 13
+62   u32  child[3]_uuid (rare)                STRONG ◆ session 13
+66..+69  4-byte ff ff ff ff sentinel          CONFIRMED ◆ session 13
```

The asymmetry (+46/+50 = garbage in LAYOUT_A; +46 = garbage in LAYOUT_B)
suggests there IS an extra 4-byte slot before the child array — possibly
the **spouse uuid** (LAYOUT_A +50, LAYOUT_B +46). But no female characters
exist in the corpus to validate, so this remains HYPOTHESIS.

#### Reproducer scripts

- `dig-queue1.js` — strict structural signature for the construction queue
  block (`v0=v40 ∈ [1..2000]`, `v4=v8=v12=v20=v36=v44=0`, `v16=v32=1`).
  Finds exactly 1 hit in the corpus (Pella in saveturn1construction).
- `dig-chartail2-1.js`, `dig-chartail2-2.js` — character tail-byte diff
  across save pairs. dig-chartail2-2 is the decisive Rome T1 vs rome10
  per-offset diff that quantifies stability of each byte.
- `dig-family1.js` through `dig-family11.js` — family tree investigation
  sequence. Decisive script is `dig-family11.js` (per-LAYOUT child-slot
  verification) and `dig-family9.js` (218/218 child-uuid hit rate).

#### Open follow-ups for session 14+

- **Spouse uuid**: locate by finding a save with female characters in the
  parser (debug gender-detection or look for a different record layout
  for wives). LAYOUT_A +50 and LAYOUT_B +46 are the leading candidates.
- **Mother uuid**: not yet pinned. Likely adjacent to fatherUuid (+46
  LAYOUT_A / +42 LAYOUT_B). Test by finding a save with both spouses
  alive and tracking which u32 in the child's record matches the
  mother's uuid.
- **Sibling uuid**: not explicitly stored; can be derived by querying
  "characters with same fatherUuid" at runtime.
- **Construction queue with 2+ buildings queued**: needed to pin the
  queue POSITION field. The 53-byte block per session 11 may be repeated
  for each queued building, OR there may be a separate per-settlement
  queue-array structure.
- **Construction +48 field semantic**: re-test by finding a save pair
  where 1 turn elapsed but construction is still active (mid-build state).
  The current corpus has only start→complete transitions.
- **Character record byte +218..+278 clusters**: investigate the
  10-12%-of-chars-differ clusters at +218..+222, +246..+258, +266..+277.
  Likely candidates: secondary uuids (like clanHead), army-assignment
  uuid, or trait block extensions.

---

### Findings 2026-05-11 (background session 12 — diplomacy + section walker)

Goal: (1) decode the **diplomacy state enum** that sessions 6/7 left blocked.
(2) Build a **production-quality recursive section walker** so we can
systematically catalog every HST-declared section type that actually appears
in the body.

Outcome: Diplomacy state byte **NOT decoded** — three strong negative results
reshape the search space (see Retractions below). Section walker yields
**CONFIRMED top-level file geography** (header + HST + body root +
fog-of-war/tile-attribute gap + settlement zone + trailer), **CONFIRMED that
the body root's direct children are CHARACTER_PATHS records** (one per known
character), and **STRONG evidence that the settlement zone is positional
(not section-grammar) — sections found inside it are false positives from
the engine's positional UTF-16LE-name+payload encoding coincidentally
matching the `u32==pos` invariant**.

Save corpus this session: `save_rome10.sav` and `save_Autosave Republic of
Rome Turn 1.sav` (vanilla Republic of Rome campaign — NOT RIS imperial as
the dossier's older sessions had assumed for "rome10"). Vanilla
`imperial_campaign` from Steam has 21 factions including 4 Roman families
(julii/brutii/scipii/senate); their diplomatic state ground truth is in
`C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/
Contents/Resources/Data/data/world/maps/campaign/imperial_campaign/
descr_strat.txt` lines 4856-4884 (just 28 lines for diplomatic relations
since most factions default to 200 = neutral).

#### 1. CONFIRMED: file top-level geography (rome10 — vanilla imperial_campaign)

The save file is **NOT a single nested section tree**. It has 3 major regions
plus a trailer:

| Region | Offset range | Size | Structure |
|---|---|---|---|
| Header + HST | `0x0..0x3b97` | 15 255 B | Fixed-position header + 102-entry HST schema manifest |
| Body root | `0x3b99..0x633bb3` | 6.49 MB | Section grammar root — 287 direct children in rome10 (104 in RoR-T1) |
| Gap (tile-attr / fog-of-war) | `0x633bb3..0xf88637` | 9.78 MB | **NOT section-grammar**. 95.8% zeros + sparse small-int bytes at byte values 200, 2, 3, 64, 5, 10, 166, 6 (each ~36500-108K occurrences). Consistent with a per-tile attribute map (terrain, visibility, ownership-byte) over a ~600×600 campaign-tile grid. |
| Settlement zone | `0xf88637..0x1f10c72` | 16.29 MB | Single self-pointing wrapper section containing the settlement table. Settlements are NOT individually self-pointing — they are positional records each beginning with `[u32 self_anchor_for_first_settlement][u32 size_field][u16 nameLen][UTF-16LE name][payload]`. Self-pointers inside this zone are coincidental matches and should be filtered out by structural validation. |
| Tail | `0x1f10c72..0x21153ae` | 6.31 MB | Save trailer, currently un-investigated |

The HST manifest at `0x3314..0x3b97` has 102 entries (dossier previously said
106; difference may be RIS vs vanilla schemas). Key entries indexed by name:
`WORLD_MAP v=3`, `DIPLOMATIC_ATTITUDE v=6`, `CHARACTER_PATHS v=1`,
`SETTLEMENT v=14`, `MAP_REGIONS v=6`, `FACTION_ECONOMICS v=2`,
`AI_SENATE_FACTION_DATA v=6`, `SETTLEMENT_MECHANICS_STATS v=5`.

The HST schema names appear ONLY in the manifest — section instances in the
body do NOT carry their schema name as a string. They are identified by
either (a) positional order within a parent, or (b) implicit-type discrimination
on payload signature. The dossier's "schema tag at section start" hypothesis
is unsupported by the data.

#### 2. CONFIRMED: body root direct children = CHARACTER_PATHS records (one per known character)

Body root at `0x3b99` has size 6488090 bytes (`0x630000 + ~`). Walking its
payload yields **287 direct children in rome10, 104 in RoR-T1**, all sharing
the structure:

```
+0   u32  self-pointer (== record offset)
+4   u32  size of this record (includes header)
+8   u32  size - 20 (= payload-after-header size; redundant with +4)
+12  u32  count of sub-records / move events
+16  u32  X_first (initial X tile coord, 0..1500 range)
+20  u32  Y_first (initial Y tile coord, 0..1500 range)
+24..  (count - 1) × 8-byte (X, Y) tile-coord pairs
+24 + 8(count-1) .. record_end:  variable number of sub-records, each in the
                                  same shape (concatenated multi-move records)
```

Cross-validation:
- rome10 kid[1] @0xa8d4d size=698: payload (678, 13, 2, 9) then 9 coord pairs
  starting at (285, 404) walking through (283, 410). Then a `00 00 00 00`
  sentinel and a new sub-record starting at +100 with self-pointer
  `0xa8db0` (= record start + 100). Each kid contains 1-3 concatenated
  sub-records.
- The first child kid[0] @0x51ad is a special record of 13884 bytes whose
  payload starts `(0, 65404932, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4, 7, 7, 7, 7,
  7, 12, 13, 22, 23, 29, ...)` — a sorted u32 ID list of ~1157 entries.
  Probably the **character-id index** that maps positional kid index → character
  uuid (i.e. kid[k] for k≥1 is the character whose uuid is read from
  kid[0]'s payload[k-1]).
- The 287 vs 104 kid count difference between rome10 (turn 5) and RoR-T1
  (turn 1) matches the population growth: by turn 5 the player and AI
  factions have spawned 183 new generals/captains/agents whose movement
  trails are now recorded. **The first 19 children's offsets are
  byte-identical between the two saves** (kid[1]=0xa8d4d, kid[2]=0xa9155,
  …, kid[19]=0xae51d in both). This confirms the same characters' path
  records persist across the 5 turns and new records are appended.
- 55/286 (rome10) / 9/103 (RoR-T1) kids parse as >70% coord-pair-rich. The
  rest contain non-coord payloads — likely battle/event sub-records mixed
  with the move trail.

**Implication for Provincia**: a parser can extract every character's
movement history by walking the body root's direct children. The kid[0]
index gives the (character-uuid → kid-index) mapping.

#### 3. RETRACTION: the "23 major + 216 minor faction record" claim from sessions 5-7 was campaign-mod-specific

Session 5 documented 23 major + 216 minor faction records for the RIS
imperial campaign. **Vanilla Republic of Rome (descr_strat 4856-4884) has
just 21 factions: 4 Roman families + 17 non-Roman**, and yet the strict
`+8=100, +12=1, +24=self, +40=self, +44 ∈ {6,8}` signature finds:

| Save | majors (+44=6) | minors (+44=8) | total |
|---|---|---|---|
| save_Autosave Republic of Rome Turn 1.sav | 7 | 54 | 61 |
| save_rome10.sav | 10 | 43 | 53 |
| save_Autosave Macedon Turn 97.sav (alex campaign) | 2 | many | — |
| save_Autosave Macedon Turn 98 End.sav | 2 | many | — |
| save_Autosave Macedon Turn 99 Start.sav | **1** | many | — |

So the `+44` discriminator is NOT a static major/minor split — it is
**dynamic faction classification** that changes per-save based on faction
state. The Macedon Turn 99 save has only ONE major (player Macedon, treasury
−70062, 3 regions, bankrupt late-game), whereas Turn 97/98 had 2 majors. The
extra major at Turn 97/98 must have been eliminated by Turn 99. So
`+44=6` likely means "**faction with both major-class settlements AND a
treasury slot**" while `+44=8` is "minor/auxiliary faction record". The
discrimination is recomputed at save-time per current state.

Sessions 5/7's table mapping "Romans Julii has 35 regions homeland list" to
positional index 0 in the major array is still valid for those specific
RIS imperial saves, but **must not be generalized** — for vanilla saves
the player faction is one of the +44=6 records, but it could be at
ANY index in the major array. **Use treasury, homeland-region-list
fingerprint, or +0/+48 dual-buffer pattern to identify the player record,
not array position.**

#### 4. RETRACTION: the "+260..+360 enum byte array inside major-faction records" is NOT the diplomacy state matrix

I probed the trailing data after the region list (`+52+4N..+52+4N+200`) in
every major record across RoR-T1 and rome10, expecting a per-faction-pair
state byte. What I found:

- After the region list, every major record has an IDENTICAL byte pattern
  for the first ~50 bytes (`1e 00 00 00 00...00 64 00 00 00 [treasury_u32]
  1e 00 00 00 00...00 ef 00 00 00`). This is **starting-treasury snapshot
  data**, not diplomacy.
- A few non-zero u8s appear at content-relative offsets (e.g. RoR-T1
  player @+285 has byte 3 at index 17 and byte 6 at index 26 in a
  30-byte zero-run). I HYPOTHESIZED these were 30-faction diplomacy
  enums but cross-checking against descr_strat ground truth (player
  Romans Julii has 100/100/100 with Brutii/Scipii/Senate, 600 with slave,
  and 200 with all others) the bit-pattern doesn't match — only 2
  non-default vs 4 expected. The bytes are content-aligned debris
  from an adjacent record interior, not a faction-state array.
- After +200ish, each major record runs into an embedded **16-byte stride
  array** of `[u32 region_id][u32 small_int_0_4][u32 small_int_0_4][01 01
  01 00]`. For the player record in RoR-T1: count=84 records, X values in
  region_id range [796..1311], y/z small ints. By rome10 (turn 5):
  count=34. The count DECREASES across turns. This is **NOT diplomacy**;
  best guess is a **per-region "known fog-of-war state" cache** (y/z
  are 0..4 enum values per known region per neighbor faction). The 84
  → 34 reduction at turn 5 corresponds to the player having lost
  shrouded-but-known territories as the engine pruned the cache.

**Conclusion**: the per-faction diplomacy enum is NOT inside the
major-faction record at any stable offset. It is either (a) inside the
HST-declared `DIPLOMATIC_ATTITUDE v=6` section type which lives somewhere in
the gap region (the 9.8MB tile-attribute area, where no self-pointing sections
were found), or (b) encoded into the 4-byte runtime cookie at major
record +4 / +28 / +40 that propagates on diplomatic changes but whose
state-byte component is opaque to byte-level analysis. The session
brief's interpretation strategies (a) and (b) both failed:

- (a) Cross-referencing descr_strat against per-faction-record byte values:
  the byte pattern in every major record's `+52+4N..` zone is identical
  faction-to-faction (just starting-treasury+region-count snapshot), so
  there's no positional diplomacy data to map.
- (b) Save-pair diff between RoR-T1 (turn-1 start) and rome10 (turn 5 in
  same campaign): the player Romans Julii's major-record offset changes
  (0x15ab1a4 → 0x157af18, a different file position), and 95+% of bytes
  inside the record differ across the 5-turn gap due to embedded
  character/unit/portrait churn. Isolating the "diplomacy bytes"
  signal-from-noise is impossible without ground-truth observation of
  which factions Romans Julii's player took war/peace/alliance actions
  against between turns 1 and 5 — and we don't have that game-state log.

The dossier's diplomacy decode is still **BLOCKED ON CORPUS**. Required
corpus: two same-turn saves where the player makes a single isolated
diplomatic action (e.g. accept a trade-rights offer from one specific AI
faction) and saves before and after. Only this gives a clean
single-faction-state diff.

#### 5. STRONG: the 9.8MB "gap" between body root end and settlement zone is a tile-attribute map

The byte histogram of the 9.78MB region between `0x633bb3` and `0x0f88637`:

| Byte value | Count | % of gap |
|---|---|---|
| 0x00 | 9,371,785 | 95.8% |
| 0xc8 (=200) | 108,394 | 1.1% |
| 0x02 | 74,081 | 0.8% |
| 0x03 | 36,600 | 0.4% |
| 0x40 (=64) | 36,596 | 0.4% |
| 0x05 | 36,594 | 0.4% |
| 0x0a (=10) | 36,585 | 0.4% |
| 0xa6 (=166) | 36,582 | 0.4% |
| 0x06 | 36,327 | 0.4% |
| 0xff | 8,134 | 0.1% |

The **remarkable invariant** is that byte values 0x02, 0x03, 0x05, 0x06,
0x0a, 0x40, 0xa6 all appear at near-identical counts (~36,500). This is the
signature of a **sparse 2D grid** where each cell is a byte and most cells
hold one of these specific values. 36,500 cells × 8 byte values ≈ 290K
non-zero cells. With ~280×280 ≈ 78K total cells, the density doesn't match
a single grid — more likely a 2D grid of size ~270×270 (= 73K) with each
cell being a 4-byte struct `[byte][byte][byte][byte]` of attribute values
(e.g., terrain | trade-good | visibility | owner-byte).

The gap contains NO self-pointing sections (`+8=100, +12=1` faction
signature: 0 hits; ASCII strings: 0 hits; UTF-16LE strings: 0 hits across
9.78 MB). This is consistent with `WORLD_MAP_STREAMING_GAME_TILE v=1` from
the HST — a per-tile streaming data table that the engine writes
positionally without any embedded metadata.

**No further breakdown of this region is practical without a save where
one player-side action visibly changes one tile** (e.g. recruiting a unit
that places a new flag on a specific tile; we'd then diff the two saves
to find which 4 bytes flipped). Out of scope for this session.

#### 6. CONFIRMED: settlement zone @ 0xf88637 is positional, not section-grammar

The 16.29 MB settlement zone starts with self-pointer `0xf88637` and size
16287291. Walking its interior payload looking for child sections via the
`u32==pos` invariant finds **443 candidate self-pointers**, of which **only
1 (the first one) is accepted by greedy non-overlap**. The other 442 are
**false positives** — they sit inside settlement-record interiors where
the bytes coincidentally satisfy the self-pointer invariant.

Concrete evidence:

- The byte at offset `0xf8ad40` is a u32 self-pointer with size 15663104.
  But the byte at `0xf8c32b` ALSO is a u32 self-pointer with size 15663104.
  They differ in offset by 0x15eb (5 KB). Both fit within the file. They
  CANNOT both be real sections of size 15.66 MB.
- Settlements are encoded positionally with structure `[u32 self_anchor_at_first_byte_of_settlement_block][u32 size_field_for_settlement_block][u16 nameLen][UTF-16LE name][payload]`. The "self_anchor" looks like a normal section header but it's not nested — it's a wrapper around a single settlement. The wrapper's `size` field happens to point past the settlement to the NEXT settlement (or much further), causing the greedy walker to consume hundreds of settlements as one giant section.
- The dossier's session 3 settlement-record findings (sub-records named
  `default_set`, `core_building`, `hinterland_roads`, etc.) ARE present
  inside this 16 MB zone, but each settlement is a **flat byte block**, not
  a nested section. The "section walker" approach to settlement parsing is
  unworkable; the **anchor-by-string method** (session 3) is correct.

**Implication for the section-walker stretch goal**: the section grammar
applies ONLY at the body-root level (and at one nested level under it).
After that, all per-settlement / per-character / per-unit data is
positional. The 287 body-root direct children ARE the catalog of "real"
HST-declared sections in this save; everything below them is flat
positional records.

#### 7. NEGATIVE: the 0xf88637 ↑ 16-MB section's interior has 443 false-positive
self-pointers all at size=15663104

When walking with the greedy non-overlap filter, exactly ONE child of size
15.66 MB gets accepted, and it has only 332 (mostly small/zero) inner
children. The "1300 settlements expected" interpretation does not surface
because the walker treats settlement-record concatenated blocks as a single
giant section.

**Fix for future sessions**: parse settlements ONLY via the
`[u16 nameLen][UTF-16LE name]` anchor (session 3's approach). The section
grammar is structurally meaningless inside the settlement zone — do not
attempt to descend into it via self-pointer matching.

#### 8. CONFIRMED: HST has 102 entries in rome10 (vanilla)

Scanning 0x3000..0x4000 for `ASCIIZ + u32 v∈[1..16]` pairs yields exactly
**102 entries** in `save_rome10.sav` (vanilla Republic of Rome). Session 1
dossier reported 106 entries from a Saka sample (RIS Classic). The
4-entry difference is mod-specific — RIS adds some schema names to vanilla.

The 102-entry list is dumped in `dig-section-walker1.js`'s output for
reference.

#### Targets attempted, not landed

- **Diplomacy state enum decode** (primary target): NOT pinned. See
  Retraction #4 above.
- **DIPLOMATIC_ATTITUDE section instance locator**: NOT found in either
  save. The schema name appears once (only in HST, 0x3322) — no body-level
  instances. The actual diplomatic state may be encoded in the gap region's
  attribute map but no per-faction-pair data structure was identifiable.
- **Live cargo / units embarked on ships** (stretch): NOT pinned. rome10's
  47 "naval biremes" cstrings each look like normal unit records (region =
  "the sea", standard 9-byte-per-soldier array). No embedded land-unit
  payload visible at the byte level. To test, would need a save before and
  after a single land unit boards a single ship; diff identifies the new
  bytes. Out of session scope.
- **Per-faction military upkeep** (stretch): NOT attempted (session 9 already
  spent 60+ minutes on this with negative result).

#### Reproducer scripts

- `dig-diplo5.js` through `dig-diplo13.js` — diplomacy state probes
  (faction-record signature variants, 16-byte stride array decode,
  small-int array searches, descr_strat ground-truth correlation)
- `dig-section-walker1.js` through `dig-section-walker8.js` — section
  walker prototypes:
  - `1.js`: basic recursive walker with depth histogram
  - `2.js`: child classification by payload signature
  - `3.js`: strict-filter walker w/ classify function
  - `4.js`: top-level file geography mapper
  - `5.js`: gap-region scan + section B exploration
  - `6.js`: false-positive analysis (Corfinium UTF-16LE search)
  - `7.js`: body root children deep inspection (revealed CHARACTER_PATHS structure)
  - `8.js`: FINAL — geographic summary + CHARACTER_PATHS confirmation

#### Open questions for session 13+

- **Diplomacy state enum (still blocked)**: needs a clean isolated
  state-transition save pair. The Macedon Turn 97→98→99 sequence has only
  1 surviving major at turn 99 (bankrupt late-game), so no per-pair
  comparison is possible. Recommended user-side action: in any campaign,
  pause at a turn boundary, save → accept a trade-rights offer from one
  specific AI faction → save again. The diff isolates the per-pair state
  byte change to a small region.
- **WORLD_MAP_STREAMING_GAME_TILE v=1 byte semantics**: decode the gap's
  per-tile attribute structure. Probe: open a save in editor, find the
  player's capital tile coord, move it +1 in X, save again. The few bytes
  that change in the gap map back to that tile's attribute index.
- **Embarked unit storage**: probe with isolated "load 1 unit onto 1
  ship" save pair.
- **DIPLOMATIC_ATTITUDE actual location**: HST declares it but no body
  instance found. May be embedded inside `AI_SENATE_FACTION_DATA v=6`
  records, which exist for each faction but were not searched in this
  session. Worth a probe.

---

### Findings 2026-05-11 (background session 14 — save-file tail + lua state)

Goal: (1) Document the 6.3MB tail section that session 12 left unmapped.
(2) Find lua persistent state / mission system records beyond the simple
counters that `findLuaCounters` already parses. (3) Stretch: revisit
diplomacy enum with Macedon T97/98/99.

Outcome: **The "tail" is fully decomposed into 5 structural regions** (CONFIRMED).
**Six embedded scripted-rebellion records identified in the body** (CONFIRMED), each
keyed by a UTF-16LE script path with structured payload — these are the
richer mission-state records the dossier hinted at. **Diplomacy still
blocked** (NEGATIVE — Macedon trio is too noisy for byte-level diff). The
dossier's session-12 claim that rome10 is "vanilla Republic of Rome" is
**RETRACTED** — rome10 is actually a **RIS mod save** (confirmed via the
mod path `Q:\Feral\Users\Default\AppData\Local\Mods\My Mods\RIS/...`
embedded at file offset 0x43fa).

Save corpus this session: `save_rome10.sav` (RIS imperial campaign, 33 MB)
+ `save_Autosave Republic of Rome Turn 1.sav` (same RIS campaign turn 1,
33 MB) + the Macedon T97/T98/T99 trio (alex campaign, ~1 MB each).

#### 1. CONFIRMED: full tail decomposition (rome10 — RIS imperial campaign)

The 2.02MB tail (0x1f10c72 .. 0x21153ae, NOT 6.3MB as session 12's geography
table claimed — that was a miscalculation; the actual size is 2,115,388 bytes)
decomposes into 5 sequential sub-regions, all positional (no section-grammar):

| Sub-region | Offset range | Size | Content |
|---|---|---|---|
| Field-army units | `0x1f10c72..0x1f42cb6` | ~200KB | Positional array of unit records, each `[u16 nameLen][ASCII unit name][u8 0][12-byte struct][8-byte uuid][u16 settlementNameLen][UTF-16LE settlement name][soldier persistent payload]`. ~144 records in rome10. Unit names: `thracian royal bodyguards`, `greek general`, `greek hoplites`, `cappadocian general`, `cilician spearmen`, etc. Settlement names: `Thynia`, `Eumolpia`, `Ratiariai`, `Korelia` — these are tail-only names, i.e. **regions/settlements NOT in the main settlement zone** (cross-validation: only 4 of 62 unique tail settlement names also appear in the main settlement zone). Hypothesis: these are **rebel-faction army units** stationed in unrecognized/unclaimed regions, or **field armies attached to ephemeral "spawn camps"**. |
| Hash blob | `0x1f43000..0x1f47abd` | ~19KB | High-entropy random-looking bytes (entropy 5.2 / 8 bits per byte, no recognizable structure). Probably AI internal state, cryptographic randomness seeds, or runtime memory dump. No ASCII/UTF-16LE strings inside. |
| Settlement model strings | `0x1f47abd..0x1f8f97b` | ~290KB | Positional array of `[u16 strLen][ASCII model name]` records. 688 total instances, **24 unique model names**: `W_hellenistic_Large_Town` (×142), `W_hellenistic_Large_City` (×89), `Celtic_Large_Town` (×81), `W_hellenistic_City` (×65), `Eastern_Large_Town` (×51), `Illyrian_Large_Town` (×43), `W_hellenistic_Town` (×36), `W_hellenistic_Huge_City` (×25), `Celtic_City` (×23), `Carthaginian_Large_Town` (×21), `Carthaginian_Huge_City` (×20), `Eastern_City` (×19), `Germanic_Large_Town` (×19), `Nomad_Large_Town` (×10), `Eastern_Huge_City` (×8), `Carthaginian_City` (×7), `Eastern_Town` (×7), `Egyptian_Large_Town` (×6), `Carthaginian_Town` (×5), `Egyptian_Town` (×3), `Illyrian_Town` (×3), `Celtic_Town` (×2), `Germanic_Town` (×2), `Nomad_Town` (×1). These are **battle-map architectural model references** — each settlement is rendered using one of these 24 visual templates on the battle map. The 688 total = number of settlements with battlefield models attached. |
| Alternate tile grid | `0x1f8f97b..0x210f4d4` | ~1.83MB | 2-byte-stride array where each cell is `[u8 attribute][0xff]`. Repeating pattern `00 ff 00 ff` (= cell with attribute=0, padding=0xff). Sparse non-zero cells in the same way the main 9.8MB gap region was sparse. Decoded as u16 LE this is mostly the value 0xff00 (65280). Probably the **alternate / battle-map / strategic overlay tile grid** — separate from the main 9.8MB tile-attribute map between body and settlement zone. ~1.83MB / 2 bytes per cell = ~930,000 cells = ~960×960 grid (vs ~600×600 for the main gap region). |
| Lua/script footer | `0x210f4d4..0x21153ae` | ~24KB | (a) Section preamble at 0x210f4d4. (b) UTF-16LE path `data/world/maps/campaign/imperial_campaign/RIS_Campaign_Script.txt` at 0x210f4e5 (length=66 chars). (c) **Lua persistent counter table** at 0x210f56f .. 0x2110a23 (115 records, 5300 bytes) — this is what `findLuaCounters` parses. (d) **Tile-coord trail array** at 0x2110a24 .. 0x21153ae (~18KB): chunks of `[u32 N][N × records of (u32 selfPtr, u16 count, count × (u32 X, u32 Y))]`. 217 chunks in rome10 containing 2499 total records. Tile coords are in (1..1500, 1..1500) range matching the campaign grid. **Hypothesis**: AI's strategic movement intents / raid targets / shroud-tile cache for each character. Total bytes covered by chunks: 18,710 (matches the 18,827 bytes from end-of-counter-table to EOF). |

The tail is therefore **fully accounted for** — no remaining unmapped bytes
after subtracting these 5 sub-regions.

Cross-validation on RoR-T1 (different turn, same campaign): same 5-region
structure, same 6 spawn_scripts in body, same end-of-file tile-trail array
pattern (file ends at 0x20ec903; the chunk array's u32 self-pointers like
`0x20ec843, 0x20ec851, 0x20ec85f` chain identically to rome10's). The
**positional structure is determinstic across saves** for the same campaign.

#### 2. CONFIRMED: rome10 is a RIS mod save (RETRACTION of session 12's "vanilla")

Session 12 concluded rome10 was a vanilla Republic of Rome save because
the player faction was Romans Julii and vanilla descr_strat has 21
factions. **That conclusion is wrong**.

Evidence: At file offset `0x43fa` (right after HST), the save embeds the
UTF-16LE path:
```
Q:\Feral\Users\Default\AppData\Local\Mods\My Mods\RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt
```

This is the **RIS mod's** descr_strat.txt, not vanilla Steam's. Confirms
sessions 5-7's claim of "23 majors + 216 minors" is correct for this save
(they were probing the RIS campaign with its expanded faction roster all
along). The "21 factions" came from inspecting the vanilla descr_strat.txt
on disk, which is irrelevant to what's in the .sav.

**Implication**: When parsing a .sav, the embedded mod path at 0x43fa
identifies the campaign's ground-truth descr_strat. Provincia could read
this path to auto-discover which mod is active.

#### 3. CONFIRMED: six embedded scripted-rebellion records in body (mission state)

Searching the body for UTF-16LE paths ending in `.txt`, exactly 7 paths
appear in rome10 — 1 in the header (descr_strat) and **6 in the body**,
each a spawn_script:

| Body offset | Script name | Trailing-data count field |
|---|---|---|
| `0x18d3693` | `data/world/maps/campaign/imperial_campaign/spawn_scripts/chrysaoria_revolt.txt` | 75 |
| `0x18d481f` | `.../spawn_scripts/cilicians_revolt.txt` | 76 |
| `0x1956794` | `.../spawn_scripts/egypt_revolt.txt` | 95 |
| `0x1ab163d` | `.../spawn_scripts/lycia_revolt.txt` | 144 |
| `0x1b0efc5` | `.../spawn_scripts/miletus_revolt.txt` | 159 |
| `0x1c939ba` | `.../spawn_scripts/thessaly_revolt.txt` | 213 |

Each record has the structure:
```
+0   16 bytes  zeros
+16  3 bytes   03 00 01           (record tag = 0x010003 or similar)
+19  1 byte    stringLen          (in chars; e.g. 0x4e = 78 for chrysaoria_revolt.txt)
+20  N×2 bytes UTF-16LE path      (no terminator)
+20+2N  4 bytes  selfPtr           (= file offset of this u32 itself)
+24+2N  4 bytes  zero
+28+2N  4 bytes  count             (75 / 76 / 95 / 144 / 159 / 213)
+32+2N  count × records of mission/event state (16-byte stride: looks like
                                                uuid + value + 2 u32s each)
```

These six rebellion-script tokens **match the lua counter prefixes** that
`findLuaCounters` already extracts:

- `chrysaoria_revolt.txt` ↔ `ChrysaoriaRebellion_RebelOwned`, `ChrysaoriaRebellion_ForeignOwned`, `ChrysaoriaRebellion_RhodesTurns`, `ChrysaoriaRebellion_RhodesOwned`, `ChrysaoriaRebellion_Done` (5 counters)
- `cilicians_revolt.txt` ↔ `CiliciaRebellion_RebelOwned`, `CiliciaRebellion_PlayerRevolt`, `CiliciaRebellion_Done` (3 counters)
- `egypt_revolt.txt` ↔ `EgyptianRebellion_PlayerRevolt`, `EgyptianRebellion_Done` (2 counters)
- `lycia_revolt.txt` ↔ `LyciaRebellion_PlayerRevolt`, `LyciaRebellion_RhodesOwned`, `LyciaRebellion_RhodesTurns`, `LyciaRebellion_*` (5 counters)
- `miletus_revolt.txt` ↔ `MiletusRebellion_PlayerRevolt`, `MiletusRebellion_Done` (2 counters)
- `thessaly_revolt.txt` ↔ `ThessalyRebellion_PlayerRevolt`, `ThessalyRebellion_ThessalyAntigonid`, `ThessalyRebellion_RebelOwned`, `ThessalyRebellion_AllAntigonidOwned`, `Thessaly*` (5 counters)

So **the engine stores scripted-event/rebellion state in two correlated places**:
- the lua counter table (simple `name → value` lookup at end-of-file)
- the spawn-script payload in body (richer record-of-records, presumably
  including which characters / armies / units the script has spawned, plus
  per-faction per-region tracking that doesn't fit in a single counter)

The trailing counts (75, 76, 95, 144, 159, 213) grow with `script
complexity` — `thessaly_revolt.txt` has the most (213), consistent with
ThessalyRebellion being the most elaborate scripted rebellion in the
ChrysaoriaRebellion/EgyptRebellion/etc family.

**Implication for Provincia**: a parser can extract per-script structured
state by walking these 6 records. Each one's `count`-field-many sub-records
likely contain per-faction per-turn snapshot data that the existing
lua-counter-only display doesn't surface. STRONG candidate for a feature
like "Show me the live state of each scripted rebellion in this save".

Cross-validated: RoR-T1 has the **same 6 spawn_scripts** at different offsets
(0x18c0667, 0x18c17f3, 0x1940c6a, 0x1a9537a, 0x1af0e8a, 0x1c6e0ef). Same
order. Confirms this is a per-campaign template structure.

#### 4. NEGATIVE: no LUA_PERSISTENT_VALUE HST schema name

The session brief mentioned `LUA_PERSISTENT_VALUE v=1` HST entries. **No
such schema is in the HST manifest** of rome10, RoR-T1, or any Macedon save.
The HST has 101 entries (session 12 reported 102 which was an off-by-one),
covering: `WORLD_MAP`, `DIPLOMATIC_ATTITUDE`, `JOURNAL_EVENT`,
`MERCENARY_DESCRIPTION`, `EVENT_MANAGER`, `SENATE_MISSION_IMPL`,
`MISSION_HISTORY_ENTRY`, `SOLDIER_PERSISTENT`, `SETTLEMENT_PLAN_PERSISTING`,
`ASSASSINATION_MISSION`, etc. — but no `LUA_PERSISTENT_VALUE`. Confirmed
ALL 101 entries in `dig-lua-state1.js`'s output.

The dossier's reference to that schema name was likely from an older save
generation (M2TW or RTW Gold) and does not apply to RTW Remastered (magic
0x070a). The persistent-counter table is engine-internal data — the
records have no HST-declared schema; they're just `[u32 nameLen × 2][UTF-16LE
name][u32 value]` triples concatenated.

#### 5. CONFIRMED: end-of-file tile-trail array structure

The very-end ~18KB of every rome10/RoR-T1 save is a tile-trail array with
this grammar:
```
chunk:
  u32 N              (chunk count, typically 1..200)
  N × record:
    u32  selfPtr     (= file offset of this u32)
    u16  pairCount   (typically 0..3, occasionally up to ~6)
    pairCount × (u32 X, u32 Y)   (X,Y in 1..1500 range)
```
217 chunks in rome10, total 2499 records, covering exactly 0x2110a24
through 0x21153ae (file EOF). Many records have `pairCount=0` (empty trail
markers). Records with `pairCount=1` cluster around tile coords like
(494, 485), (576, 459), (594, 449), (509, 354) — plausible **strategic
intent / pathfinding cache / AI targeting** rather than character paths
(character movement history is in the body-root's CHARACTER_PATHS section
per session 12).

The chunk structure means a parser MUST first read the leading u32 count
to know how many records to consume. The records are NOT individually
self-terminating; they require external count knowledge.

**Hypothesis (UNCONFIRMED)**: each chunk corresponds to one faction's or
character's "remembered objectives" (e.g., AI strategic-target queue). The
217-chunk count is in the right order of magnitude for an array indexed by
faction × something (RIS has 23+216 factions, but 217 is suspiciously close
to the 216-minor-faction count from sessions 5-7).

#### 6. CONFIRMED: tail's field-army records are NOT in the main settlement zone

Of the 62 unique UTF-16LE settlement-name strings in the tail (0x1f10c72
..EOF), only 4 are also present in the main 16MB settlement zone
(0xf88637..0x1f10c72). The other 58 (e.g. `Thynia`, `Eumolpia`, `Ratiariai`,
`Korelia`, `Axios`, `Treria-Tilataia`) are **tail-only**. These are
plausibly:
- regions occupied by **non-faction entities** (rebels, hordes,
  mercenaries) that don't have a permanent settlement card
- temporary spawn-camp settlements for the rebellion scripts (which create
  rebel armies)
- watchtower-territory or fort-region names (the HST has
  `WATCHTOWER_MANAGER v=1` and `FORT v=6`)

The unit records' soldier-persistent payload mentions UTF-16LE characters
like `B e s s i`, `K a b y l`, `D e n t`, `M a i d`, `O d r y`, `K o r e`,
`T r i b` — these match real tribal/regional names in the RIS campaign.
So each tail unit record carries its "home tribal territory" as a UTF-16LE
field.

#### 7. NEGATIVE: Macedon T97→T98→T99 too noisy for diplomatic-state diff

Diff between T98 (915 KB) and T99 (950 KB) Macedon saves: **59.7% of
bytes differ**. The diff is dominated by structural shifts (different
offsets across saves because records were added/removed between turns).
The session brief's expectation that "isolated diplomatic transitions
might be visible" is not supported by the byte-diff approach; saves at
adjacent turns are simply too different. **Diplomacy decode remains
BLOCKED** on the same corpus constraint session 12 identified: need a
pair of saves taken seconds apart with one isolated diplomatic action
between them.

#### Reproducer scripts

- `dig-tail1.js` — Initial tail histogram + ASCII/UTF-16LE/self-ptr scan
- `dig-tail2.js` — Cluster tail strings by spatial region (per-64KB blocks)
- `dig-tail3.js` — Hex dumps of boundary areas + "thracian royal bodyguards" search
- `dig-tail4.js` — Decode W_models area + unit-record area
- `dig-tail5.js` — Walk all unit-name records, stride analysis
- `dig-tail6.js` — Entropy histogram per 4KB; locate hash block
- `dig-tail7.js` — Boundary continuum + global self-pointer scan
- `dig-tail8.js` — UTF-16LE settlement-name counts in zone vs tail; W_models classification
- `dig-tail9.js` — Statistical counts (unique names per region)
- `dig-tail10.js` — End-of-file self-pointer array decode
- `dig-tail11.js` — Walk all tile-trail records at EOF
- `dig-tail12.js` — Find all chunked tile-trail arrays (217 chunks, 2499 records)
- `dig-tail13.js` — Decode 00-ff stride zone + alternate tile grid
- `dig-tail14.js` — UTF-16LE path scan + script path records' trailing data
- `dig-lua-state1.js` — HST scan for lua schemas; full HST dump (101 entries)
- `dig-lua-state2.js` — Macedon save HST + path scan
- `dig-lua-state3.js` — `findLuaCounters` run + adjacent-region probe
- `dig-lua-state4.js` — Hex dumps around each spawn_script path in body
- `dig-lua-state5.js` — Search for `03 00 01` record-tag pattern + ASCII counter pairs (incorrect pattern)
- `dig-lua-state6.js` — All UTF-16LE Pascal strings + script trailing-data decode (CORRECT)
- `dig-lua-state7.js` — Mod-config region at 0x43fc + cross-validation
- `dig-diplo14.js` — Macedon T97/T98/T99 diff (negative result)

#### Open questions for session 15+

- **Spawn-script record body decode**: each rebellion script's `count`
  trailing records (75-213 of them, each 16 bytes) need decoding. Each
  16-byte record probably starts with a uuid (8 bytes) and value (8 bytes
  / 2 u32s). Test: dump a few of the chrysaoria record's 75 sub-records,
  see if uuids match known character/faction uuids from the body root's
  CHARACTER_PATHS index (kid[0] @ 0x51ad in rome10).

- **End-of-file tile-trail correlation**: are the 217 chunks
  faction-indexed? Test: see if the tile coords in the largest chunks
  cluster geographically near each faction's homeland regions. If chunk 0
  has tiles in Greece and chunk 1 has tiles in Italy, that's a faction
  index.

- **24-model name → battle-architecture map**: the 688 settlement-model
  references could feed a Provincia feature "show what each settlement
  looks like on the battle map". The 24 unique model names correlate
  1:1 to RTW's settlement-tier × culture matrix (10+ cultures × 5 tiers
  ≈ 50 possible, only 24 used in this campaign).

- **Tail unit-record "home settlement"**: which faction owns the 144
  field-army units? Test: extract their 8-byte uuids and cross-reference
  to faction owner via the main body-root's character_paths index. If they
  all belong to slave/rebel factions, that confirms the "rebel armies"
  hypothesis.

- **Alternate-tile-grid (0x1f8f97b..0x210f4d4) semantics**: 960×960 grid
  is bigger than the 600×600 main map. Could be a higher-resolution
  battle-map tile attribute, fog-of-war state, or shroud table. Test:
  pick a player-controlled tile coord, move it +1 in X, save, compare.

- **Diplomacy enum** (still blocked): requires user-side controlled save
  pair as documented in session 12.

---

### Findings 2026-05-11 (background session 15 — tile-attribute map + AI policy)

Goal: (1) Map each rare byte value in the 9.78MB "gap" region to its game
meaning (per session 12's tile-attribute hypothesis). (2) Locate the per-faction
AI strategic-policy cache (16-byte-stride array). (3) Stretch: per-faction army
manifest.

Outcome: The session 12 "tile-attribute map" hypothesis is **RETRACTED**. The
9.78MB region is **not a per-tile byte table** with rare-byte semantics
encoding terrain class / fog-of-war. It is **CONFIRMED to be an array of
36,582 fixed-stride 267-byte records** with a near-constant 10-u32-field
template; the rare-byte-count near-equality session 12 observed is a direct
artifact of each record containing exactly one occurrence of each constant.
AI policy cache: **NOT pinned** — three negative results documented (16-byte
stride scan, 5-faction array scan in Alexander Macedon, small-int dense
cluster diff). Army manifest stretch: not attempted (time spent on
tile-attribute decode + AI policy attempts).

Save corpus this session: `save_rome10.sav` (vanilla Republic of Rome, T5),
`save_Autosave Republic of Rome Turn 1.sav` (same campaign, T1), Alexander
`save_Autosave Macedon Turn 97.sav` / `Turn 98 End.sav` / `Turn 99 Start.sav`.

#### 1. CONFIRMED: the 9.78MB "gap" is a 36,582-record fixed-stride array, NOT a tile-attribute byte table

The region between body-root-end (`0x633bb3`) and the start of the
settlement zone wrapper (`0xf8463X`, slightly earlier than session 12's
`0xf88637` boundary which actually points inside the settlement zone) is
**not raw per-tile bytes**. It is an array of `36,582 records of 267-byte
stride`, plus a 157-byte zero-prefix header and a small trailing pad before
the next section.

Layout:

```
0x633bb3..0x633c50    157 bytes  prefix (all zeros)
0x633c50..0xf84632    9,767,394  36,582 records × 267-byte stride
0xf84632..0xf88637    16,389     post-array; actually contains start of
                                 settlement zone (`default_set`,
                                 `hinterland_region` ASCIIZ blobs)
                                 — the session-12 gap-end boundary 0xf88637
                                 was off by 16KB
```

Per-record structure (record 0 of rome10, all canonical records identical
across both T1 and T5 saves; 35,699 of 36,582 = 97.6% are byte-identical to
this template):

| Δ | Type | Value (canonical) | Variations observed |
|---|---|---|---|
| +0 | u32le | 5 | constant (36582/36582) |
| +4..+11 | 8 B zero | 0 | constant |
| +12 | u32le | 10 | constant |
| +16 | u32le | 200 | constant |
| +20 | u32le | 200 | 600 (385×), 0 (261×) |
| +24 | u32le | 2 | constant |
| +28 | u32le | 6 | 54 (250×), 55 (11×) |
| +32 | u32le | 200 | 600 (516×), 0 (100×), 4294967286=−10 (93×), 400 (1×) |
| +36..+67 | 32 B zero | 0 | constant |
| +68 | u32le | 3 | constant |
| +72..+83 | 12 B zero | 0 | constant |
| +84 | u32le | 576 | constant (= 0x240) |
| +88..+95 | 8 B zero | 0 | constant |
| +96 | u8 = 0xa6 | 166 | constant (last byte of each record's data) |
| +97..+266 | 170 B zero | 0 | constant padding to stride |

**Total distinct variant patterns over (u32+16, +20, +24, +28, +32): 13**.
The 5 most common:
- `200_200_2_6_200`: 35,699 records (canonical, 97.6%)
- `200_600_2_6_600`: 382 records (1.0%)
- `200_0_2_54_200`: 160 records (0.4%)
- `200_200_2_6_600`: 127 records
- `200_200_2_6_0`: 98 records
- 8 minor variants <100 records each

Total non-canonical: **883 records** (2.4% of 36,582).

#### 2. CONFIRMED: the array is STATIC across turns (0 byte diffs T1 → T5 across 5 turns of gameplay)

Cross-save diff: `save_rome10.sav` (T5) vs `save_Autosave Republic of Rome
Turn 1.sav` (T1, same campaign). All 36,582 × 97 = 3,548,454 informative
bytes match **byte-for-byte** across the 5-turn gap. This rules out:
- Fog-of-war / tile-discovery state (varies per turn as players explore)
- AI policy / diplomacy cache (recomputed per turn per session 7 findings)
- Per-character / per-unit data (units die, new ones spawn)
- Per-faction treasury / state (varies per turn)

Static-across-turns rules in static **map-baked metadata**: terrain class,
ground type, climate, height, roughness, the descr_strat starting-state
data, or watchtower placements that don't change.

This finding **REFUTES** session 12's hypothesis that the gap holds a
tile-attribute map with byte values encoding terrain/visibility/ownership.
The 8 rare-byte counts near-equal at ~36,500 reported by session 12 are
exactly explained by: each record contains exactly ONE occurrence each of
0x05, 0x0a, 0x02, 0x06, 0x03, 0x40, 0xa6 plus three 0xc8 (=200) bytes per
record × 36,582 = ~109,746 occurrences of 0xc8 (session 12 reported
108,394, off only by the 883 variants where one or more 0xc8 flipped to
0x58, 0xf6, or 0x90). The histogram-equality session 12 observed was the
SIGNATURE OF A REPEATING RECORD, not the signature of a tile attribute map.

#### 3. STRONG: the record array is laid out as a W=240 grid; 153 rows + partial last row

For variant `200_0_2_54_200` (160 records, the second-most-common
non-canonical variant), record indices: 101, 341, 581, 821, 1061, 1301,
1541, 1781, 2021, 2261, 2501, 2741, ..., 36381. Delta between consecutive
records = **240 in 147 of 159 deltas** (92%).

Column analysis at W=240: this variant occurs at **column 101 in row 0, 1,
2, ..., 152 (153 rows)**. That is, a perfect vertical line in the (col,
row) grid. At least one record at column 101 is non-canonical in every row
of the array.

The +28=54 variant similarly forms a vertical stripe (column 101) across
153 rows; `200_600_2_6_600` and `200_200_2_6_600` form independent vertical
stripes at columns 12, 37, 43, 59, 87, 115, 151 (8 columns each appearing
in many rows).

Total records 36,582 = 240×152 + 102. So the array is **240 columns × 153
rows with a partial last row (only first 102 cols filled)**. Cf. vanilla
campaign map dimensions per `descr_terrain.txt`: width 255, height 156 —
slightly larger than 240×153 by 15 cols and 3 rows. Plausible explanation:
the array covers the campaign map's playable rectangle excluding margins.
However a spatial overlay against `map_regions.tga` does NOT show the
variants clustering on land vs sea — variants are scattered through both
land and sea pixel positions (visualized in `dig-tilemap14.js`). The
240-grid hypothesis is structurally sound at the record-array level but
the (col, row) → (campaign_map_x, campaign_map_y) mapping is NOT a simple
identity.

#### 4. HYPOTHESIS (untested): the records describe placed entities (resources, ports, watchtowers, settlements)

The variant counts and static-across-turns invariance are consistent with
the data being **descr_strat-derived map placements that get baked at
campaign start and never rewritten**. Vanilla imperial_campaign descr_strat
has 688 `resource` entries, 96 `settlement` entries, 177 `character`
entries (= 961 placed entities total). The 883 non-canonical record count
is in the same order of magnitude but not exactly matching. Possible
interpretations (none cross-validated):

- **Placed-resource cache**: each record's +28 enum (canonical 6,
  variants 54/55) is the resource-type-id; canonical "6" = no
  resource on this tile, "54"/"55" = specific trade-good types. 250+11=261
  records have +28=54 or +28=55, close to a typical resource subset.
- **Per-tile region-ownership cache**: +20/+32 flips 200↔600↔0 could
  encode ownership transitions baked at start. But 883 transition tiles
  is too few to cover region borders.
- **Per-tile streaming game-tile (HST: `WORLD_MAP_STREAMING_GAME_TILE
  v=1`)**: streaming chunks for the campaign-map renderer; +84=576
  could be a chunk-size or LOD parameter.

Test required: build a custom descr_strat with ONE extra resource placed at
a known tile coord, save the campaign turn 1, find the new non-canonical
record. Out of scope for autonomous session — needs user-side game-launch.

#### 5. NEGATIVE: AI policy cache not pinned via 16-byte-stride scan

Three independent search strategies attempted, all negative:

- **5-element 16-byte-stride array in Macedon player record trailing**
  (idx 0, +44=6, regions=25, 176KB trailing in T97). Scanned offsets
  0..5000 of trailing for any 5-record array where col-0 is a u32 in
  {0..30} (faction-id-like) AND all 5 IDs are distinct. **Zero matches.**
  Repeated at strides 4, 8, 12, 16, 20, 24, 28, 32, 40, 48. Zero matches.
- **23-element 16-byte stride in rome10 Romans Julii trailing** (227KB).
  Same scan, zero matches.
- **Small-int dense diff cluster**: T97 vs T98 End diff in Macedon's
  trailing has 21,420 diff regions totaling 16K+ bytes. The biggest 145-byte
  cluster at trail+173956 is f32-shaped character coordinate data (high
  bytes 0x43/0x44/0x47/0x48 indicate float values in 800..50000), not a
  policy enum array. A 109-byte cluster at trail+3901 contains UTF-8 ASCII
  strings (`data/ui/barbarian/portraits/cards/old/generals/054.tga`) —
  evidence that a character DIED between T97 and T98 (general 054 became
  the "dead" portrait). NOT policy data.

The session-7 retraction stands: **the per-faction AI policy state is NOT
at a fixed positional offset within the major-faction record's trailing
data**. The trailing data is dominated by per-character/per-unit/per-army
records (visible at ~450-byte-stride between `ffffffff ffffffff` sentinels;
sentinels found at +258, +717, +1200, +1703, +2198, +2643, ... in Macedon
trailing — that's the army roster, NOT a policy cache).

The diplomacy decode requires a save-pair where ONE diplomatic action
happens cleanly between saves; the available corpora do NOT contain such
a pair (Macedon T97/98/99 has 1 faction at endgame; rome10/T1 has
character churn across 5 turns; sparta corpus has war-declaration but
session 7's negative result already documented that the visible 9-byte
array there is the bodyguard's per-turn AI cache, not the per-pair state
matrix).

#### 6. CONFIRMED: Alexander campaign has 0 minor-faction records (+44=8) — Macedon corpus geometry distinct from RIS

Scanning `save_Autosave Macedon Turn 97.sav` for the minor-faction
signature (`+8=100, +12=1, +24=self, +40=self, +44=8`) finds **0 records**.
Compare RIS imperial campaign (216 minors) and vanilla Republic of Rome
(43-54 minors per save). The Alexander campaign has only 5 major-faction
records (T97 saves, idx 0 = Macedon player) and NO minor-class records at
all. Either the Alexander campaign is small enough that the engine
classifies all factions as major, or the `+44=8` minor-class is
descr_strat-version dependent. Sessions 5-9's "two-tier major/minor"
architecture from RIS imperial does NOT generalize to Alexander.

Implication: parser-side faction enumeration must handle BOTH classes by
union and not assume the minor class exists.

#### Reproducer scripts

- `dig-tilemap1.js` — first probe: dump gap prefix as bytes + u32s
- `dig-tilemap2.js` — first stride-discovery attempt (failed pattern)
- `dig-tilemap3.js` — cluster enumeration, found 36,596 nonzero clusters w/
  stride=267 dominating
- `dig-tilemap4.js` — per-offset value histogram, identified canonical
  pattern + 13 variants
- `dig-tilemap5.js` — multi-save cross-validation (rome10 + RoR-T1 both
  have same array)
- `dig-tilemap6.js` — u32-field interpretation across all records
- `dig-tilemap7.js` — outlier record (rec 36582 = start of settlement zone)
- `dig-tilemap8.js` — T1 vs T5 cross-save byte diff (0 diffs CONFIRMED
  static)
- `dig-tilemap9.js` — variant classification (13 distinct keys)
- `dig-tilemap10.js` — grid-width search (W=240 column-101 alignment)
- `dig-tilemap11.js` — vanilla map_regions.tga color analysis
- `dig-tilemap12.js` — u32/u16/i32/f32 record interpretation
- `dig-tilemap13.js` — record-index → (x,y) hypothesis test
- `dig-tilemap14.js` — visual 2D grid overlay vs map_regions.tga
- `dig-ai-policy1.js` — major-faction record enumeration + trailing diff
- `dig-ai-policy2.js` — 16-byte-stride array scan in rome10 player trail
- `dig-ai-policy3.js` — Macedon T97 vs T98 End trailing diff
- `dig-ai-policy4.js` — Macedon AI-policy probe (+1800..+3200 small-int
  region)
- `dig-ai-policy5.js` — Macedon trail diff cluster inspection (f32 + ASCII
  string content)
- `dig-ai-policy6.js` — multi-stride array scan (zero matches at any stride)
- `dig-ai-policy7.js` — character-record sentinels in Macedon trailing
- `dig-ai-policy8.js` — diplomatic 21×21 matrix search by value statistics

#### Open follow-ups for session 16+

- **36,582-record interpretation**: needs descr_strat counting plus a
  custom-mod test where ONE resource/setting is added or removed pre-game
  to identify which records the new entity occupies. Without the mod test,
  the array's exact semantic remains HYPOTHESIS-grade. Highest-value test:
  remove one specific resource from descr_strat, save → diff against
  unmodified-save → identify which record(s) lose their variant.
- **AI policy cache location**: the trailing data of major-faction
  records is NOT byte-aligned; sessions 5/7/9/12 + this session 15 all
  failed at this target. **Recommended pivot**: search for an explicit
  HST-anchored section in the body root's direct children rather than
  embedded in faction records. Session 12 found 287 CHARACTER_PATHS as
  body-root children but did not enumerate other section types; one of
  those 287 might be the AI policy cache. Re-walk body root and look for
  children whose payload is NOT character-paths-shaped — those are
  candidates.
- **Diplomacy enum** (still blocked on corpus): unchanged from sessions
  6/7/12 status. Requires user-side controlled save pair where a single
  isolated diplomatic action happens between T1-start and T1-end.
- **Per-faction army manifest** (stretch, not attempted): the
  ~450-byte-stride sentinel-separated records in Macedon's trailing data
  (~390 of them per major faction record) are the per-character/army
  records. A future session could decode their structure as a follow-up
  to session 4's character record findings.

---

## Sources

- taw/etwng/sav: https://github.com/taw/etwng/tree/master/sav
- Rafkos pointers: https://bitbucket.org/Rafkos/rometwsaveeditor/raw/master/pointers/rometw.json
- TWC "Decoding save game (.sav) files": https://www.twcenter.net/threads/decoding-save-game-sav-files.562363/
- TWC "Advanced Save Game Editing": https://www.twcenter.net/threads/advanced-save-game-editing.657545/
- M2TWEOP runtime structs: https://eop-labs.github.io/M2TWEOP-library/
- Pannoniae/rex (M2EX/REX x64 engine): https://github.com/Pannoniae/rex
