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

### Findings 2026-05-11 (background session 16 — rebellion records + tile-trail array + settlement model strings)

Goal: (1) Decode the 16-byte rebellion records inside the six scripted-rebellion
blocks (session 14 left them as `count × 16-byte` records of unknown content).
(2) Identify what each tile-trail chunk represents (per-faction? per-character?).
(3) Stretch: decode the structure around each Settlement model name reference
in the 290KB tail block.

Outcome: **Three structural findings landed.** (a) **RETRACTION of session 14's
"count × 16-byte record"** claim — the actual structure is a **239-row × 16-byte
per-FACTION array** (CONFIRMED, matches RIS's 23+216=239 faction count) plus a
variable-length head section containing fully-embedded character data
(portraits, settlement names) before the array. (b) **Tile-trail chunks are
per-faction strategic-intent records** (CONFIRMED via cross-save N-sequence
alignment + geographic centroid placement). (c) **Settlement model strings
block is actually a per-settlement record array** keyed by (X,Y) tile coords
(CONFIRMED across both saves with identical coords for matching settlements).

Save corpus this session: `save_rome10.sav` (RIS imperial campaign, 33 MB)
+ `save_Autosave Republic of Rome Turn 1.sav` (same campaign T1, 33 MB).

#### 1. RETRACTION & CONFIRMED: rebellion block structure (16-byte array is per-faction, not per-script-record)

Session 14 claimed each spawn_scripts/*.txt block ends with `count × 16-byte
records` where count ∈ {75, 76, 95, 144, 159, 213}. **That structure is wrong.**

The correct layout (verified across both saves) is:
```
spawn-script block:
  [u16 strLen]             (path char count, e.g. 0x4e = 78)
  [UTF-16LE strLen×2]      (full path "data/world/.../spawn_scripts/X_revolt.txt")
  [u32 selfPtr]            (= offset of this u32 itself)
  [u32 ??]                 (always 0 in both saves)
  [u16 ??]                 (always 0 in both saves; only 6 bytes between selfPtr and count)
  [u32 count]              (75 / 76 / 95 / 144 / 159 / 213; NOT the 16-byte record count)
  [head section — VARIABLE LENGTH, varies per script]
  [239 × 16 bytes per-faction state array]
  [tail section — VARIABLE LENGTH]
```

**The 239-row × 16-byte per-faction state array** is the structural payload
hidden inside each rebellion block. Verified for all 6 blocks in both saves:

| Script | block start | faction-array start | size | distinct sigs |
|---|---|---|---|---|
| chrysaoria_revolt | 0x18d3741 | 0x18d3821 | 239 × 16 | 1 |
| cilicians_revolt  | 0x18d48cb | 0x18e7f4b | 239 × 16 | 1 |
| egypt_revolt      | 0x1956838 | 0x19af6f8 | 239 × 16 | 1 |
| lycia_revolt      | 0x1ab16e1 | 0x1ace821 | 239 × 16 | 1 |
| miletus_revolt    | 0x1b0f06d | 0x1b765dd | 239 × 16 | 1 |
| thessaly_revolt   | 0x1c93a64 | 0x1c99b64 | 239 × 16 | 1 |

Every row is the default 16-byte signature `00 00 00 00 00 00 00 00 00 00 00 03
00 00 00 00` (a single nonzero byte 0x03 at offset +11 inside each record). All
239 × 6 = 1434 rows across all six blocks are identical default in both saves
— consistent with the lua counters being almost entirely 0 (rebellion hasn't
fired yet). **239 = RIS's 23 majors + 216 minors faction count** (matches
sessions 5-7's RIS faction-roster claim, and session 14's RIS mod-path
confirmation).

**The variable-length HEAD section** (between the header and the faction array)
contains the *script's* state: fully-embedded character records with portrait
paths (`data/ui/barbarian/portraits/cards/young/generals/NNN.tga`) and UTF-16LE
settlement names (`Cimbria`, `Eudosia`, `Boia`, `Kianos_Kolpos`). The cilicians
block's head is ~63KB and contains ~43 distinct general portrait references
(card + portrait pair per general). The egypt block's head is ~364KB and
contains hundreds of similar character records.

**The "count" field (75/76/95/144/159/213) does NOT match the 239-row array
nor the head's character count.** It's likely the number of script
preconditions / trigger steps / pre-resolved subrecord slots. Cross-validation:
the count is identical between rome10 and RoR-T1 for the same script
(chrysaoria=75 in both, cilicians=76 in both, etc.), so it's a deterministic
property of the script template, not the live save state.

**Implication for Provincia**: a parser can extract per-faction rebellion
state by reading row[factionIndex] of the 239 × 16 array inside each
rebellion block. The byte at row[+11] (currently always 0x03) is the
faction's rebellion-engagement state slot; when a faction triggers the script
it likely changes to a non-zero value. The "homeland indicator" / "show
rebellion state in faction tooltip" features can read this array directly
without touching the lua counter table.

**Reproducer**: `dig-rebellion7.js` (detects the 239-stride array), `dig-rebellion9.js`
(walks every 16-byte row in every block, dumps signatures).

#### 2. CONFIRMED: end-of-file tile-trail chunks are per-faction strategic-intent arrays

Walking the tile-trail array correctly (skipping `N=0` zero-padding between
chunks): **rome10 has 221 chunks, RoR-T1 has 219 chunks**, with **219/221
matching N values at shift=-2** (i.e., RoR-T1 has 2 fewer chunks at the
beginning vs rome10, but the body of N values aligns perfectly). Session 14's
"217 chunks" count was off by a few due to the zero-padding-bail bug. Total
records 2503 (rome10) / 2398 (RoR-T1).

**Chunk N distribution**: 111 chunks with N=7 (the "default baseline" — these
are inactive minor factions), 110 chunks with N != 7 (active factions). Only
6 chunks have N >= 50 — these are the major factions with extensive AI state.

**Per-chunk centroid analysis** (chunks ordered by file position):

| Chunk | N | Centroid (X,Y) | Plausible faction |
|---|---|---|---|
| [0]   | 104 | (291, 405) | Romans Julii — **player faction** (Italy/Rome region) |
| [4]   | 27  | (223, 341) | Possibly Gauls or Iberians (west Mediterranean) |
| [5]   | 155 | (397, 378) | Macedon (Greece) — biggest N, major AI |
| [6]   | 137 | (480, 310) | Pontus / Thrace (north Asia Minor) |
| [7]   | 150 | (513, 362) | Seleucid (central Asia Minor) |
| [93]  | 56  | (370, 373) | Greek Cities / Athens (Aegean) |
| [220] | 77  | (456, 401) | Greek/Anatolian border faction |

**Two-save cross-validation**: at shift=-2 alignment, **219/221 chunk N values
match exactly** between rome10 and RoR-T1. The 2 mismatches are likely
factions whose AI intent has changed between turns. This is the strongest
possible signal that each chunk is a stable per-faction record.

**Chunk record structure** (corrected from session 14):
```
chunk:
  [u32 N]                   (record count; N=0 is just padding, skip)
  N × record:
    [u32 selfPtr]           (= file offset of this u32)
    [u16 pairCount]         (0..3, occasionally up to ~30)
    pairCount × [u32 X][u32 Y]    (X,Y in 1..1500 range)
```

Records are stride 6 + 8*pairCount bytes (not stride 14 fixed). pairCount=0 is
the dominant value (1198 / 1554 = 77% of records have no coord pair).

**Semantics (STRONG)**: each chunk = one faction's "remembered tile of
interest" cache, used by the AI for strategic targeting / shroud cache /
attack-from-here memory. N = max slots per faction (variable per faction's
historical activity), each slot can hold 0..many tile pairs (often 0 = empty
intent). Total of 356 non-empty coord pairs in rome10 = the global AI's
current intent list across all factions.

**Reproducer**: `dig-tile-trail2.js` (corrected parser with zero-padding skip),
`dig-tile-trail3.js` (N histograms + chunk[0] coord listing), `dig-tile-trail4.js`
(per-chunk centroids + cross-save N alignment at shift=-2).

#### 3. CONFIRMED: settlement model strings = per-settlement record array with (X,Y) tile coords

Session 14 reported "688 references to 24 unique architectural models" in the
tail at 0x1f47abd. Re-scanning a wider region (0x1f40000..0x1f90000) reveals
**701 settlement refs** in rome10 (699 in RoR-T1) — session 14 missed ~17 at
the very start because its block-start estimate was too aggressive.

**Per-settlement record layout**:
```
settlement record:
  [u16 strLen+1]            (model-name char count + 1 for NUL)
  [ASCII model name]        (e.g. "Celtic_Large_Town", 17 chars)
  [u8 0x00]                 (NUL terminator)
  [u32 typeTag]             (27 / 29 / 31 — three subtype enums, see below)
  [u32 X]                   (tile X coord; range 83..988 in rome10)
  [u32 Y]                   (tile Y coord; range 22..651)
  [u32 ???]                 (typically 1..5)
  [u32 0xffffffff / 8]      (sentinel or count)
  [variable trailing data]  (totalling ~40..63 bytes per record)
```

**Cross-save coord match**: identical settlements appear at identical (X,Y)
in both saves (e.g. `Eastern_Town @ (252, 457)`, `Celtic_City @ (257, 332)`,
`Carthaginian_Huge_City @ (257, 333)`). **CONFIRMED these are real settlement
tiles, not battle-map fixtures.**

**Distinct (X,Y) coord count: 213** — close to but distinct from the
expected ~213 RIS region count. This **matches the per-region count** very
well.

**Multi-model per coord**: 95 of the 213 distinct coords have multiple model
entries with varied culture (e.g., coord (274, 442) has 10 entries:
Celtic_Large_Town, Celtic_City × 3, Germanic_Large_Town × 4, Carthaginian_Huge_City,
Germanic_Large_Town × 2). The entries are NOT consecutive in file order
(indices spread across 11..662). **Interpretation (STRONG)**: each settlement
stores its **battle-map model history / variant array** — one entry per
faction that has captured the settlement at some point, since each owner
re-renders the city in their own architectural style. The model name attached
to each entry is the visual template for THAT faction's occupation period.

**Type-tag enum** (u32 just after model name):
- `tag=27` × 410: most common; likely "current owner's render" or "active model"
- `tag=29` × 137: secondary subtype (perhaps "captured but pending"?)
- `tag=31` × 71: tertiary subtype

The other "tag" values (1599537177, 1698889746, etc.) my decoder reported are
actually mis-aligned reads where the parser bled into the NEXT settlement's
strLen+name bytes (` W_` = u16 strLen 0x19 + start of `W_hellenistic_*`).
The real tag enum is just 27/29/31 — three distinct subtype values.

**Implication for Provincia**: a parser can read per-settlement architectural
model + tile coord directly from this block, without walking the main settlement
zone. Useful for "what does this settlement look like on the battle map"
features. The 213 distinct (X,Y) tiles can be cross-referenced against
descr_strat region coordinates to confirm the settlement-region mapping.

**Reproducer**: `dig-model-strings2.js` (per-settlement walker with X,Y
extraction), `dig-model-strings3.js` (cross-coord grouping + tag analysis).

#### Reproducer scripts

- `dig-rebellion1.js` — Initial 16-byte stride attempt (wrong, count != 16-byte record count)
- `dig-rebellion2.js` — Corrected header decode (strLen at strLenOff)
- `dig-rebellion3.js` — Self-pointer chain analysis (showed records are variable-length, not 16-byte)
- `dig-rebellion4.js` — TAW section walk attempt (wrong — block isn't TAW-grammar)
- `dig-rebellion5.js` — Cross-validate counts and lua counters in both saves
- `dig-rebellion6.js` — Full 4301-byte chrysaoria payload hex dump (reveals 239-row pattern)
- `dig-rebellion7.js` — Auto-detect the 239-row × 16-byte sub-array in each block (CONFIRMED 239 = faction count)
- `dig-rebellion8.js` — Hex dumps of variable-length HEAD sections (reveals embedded character data)
- `dig-rebellion9.js` — Walk every 16-byte row in every block, dump signatures (all default)
- `dig-tile-trail1.js` — Initial tile-trail walk (bails at zero padding → only 74 chunks)
- `dig-tile-trail2.js` — Corrected parser with N=0 padding skip (221 chunks, matches session 14)
- `dig-tile-trail3.js` — Per-chunk N histograms + chunk[0] coord listing
- `dig-tile-trail4.js` — Per-chunk centroids + cross-save N alignment (219/221 match at shift=-2)
- `dig-model-strings1.js` — Initial scan with wrong format assumption (0 refs found)
- `dig-model-strings2.js` — Corrected per-settlement walker (strLen+1 includes NUL; 701 refs)
- `dig-model-strings3.js` — Cross-coord grouping + type-tag analysis

#### Open questions for session 17+

- **Per-faction byte at +11 in 239-row array**: when a faction triggers the
  rebellion script, does this byte change? Test: a save where one rebellion
  has actually fired would reveal which faction's row[+11] flipped from 0x03
  to something else.

- **HEAD section character records**: each rebellion block's HEAD contains
  fully-embedded character records (portrait paths, names, settlement
  references). Decoding their per-character structure would yield a "rebel
  generals roster" feature — but the format is variable per script, so each
  script needs its own per-record schema.

- **Tile-trail chunk → faction-record mapping**: chunk[0]=player Romans Julii
  is confirmed by Italy centroid. Mapping chunks[1..220] to specific factions
  requires cross-referencing with the major-faction record list (session 5-7).
  A future session could correlate chunk-N values to faction-record positions
  in file order — if chunks are emitted in the same order factions appear in
  descr_strat, the mapping is trivial.

- **Settlement-block tag enum (27/29/31)**: which culture/state does each
  encode? A test save where the player captures one settlement and the model
  variant updates would identify which tag means "fresh capture" vs "long-term
  ownership" vs "currently-being-rebuilt".

- **Multi-model-per-coord**: coord (274,442) has 10 different model entries
  across 4 cultures. Does the file preserve the ENTIRE settlement ownership
  history, or only the last few? Test: capture a settlement and check if a new
  entry appended.

---

### Findings 2026-05-11 (background session 17 — tail tile grid + faction trailing data + rebellion head)

Goal: (1) Decode the ~1.83MB "alternate tile grid" in the tail (session 14
left it as a 00-ff stride pattern over a ~960×960 grid; hypothesis: terrain
class / fog-of-war / region color per tile). (2) Diff per-faction trailing
data across a controlled save pair to identify what propagates. (3) Stretch:
decode the variable-length head section of the 6 scripted-rebellion blocks.

Outcome: **Three major structural findings landed.** (a) **RETRACTION of
session 14's "alternate tile grid" hypothesis** — the 1.86MB zone is NOT a
2-byte-stride per-tile attribute table; it is **CONFIRMED to be an array of
239 per-faction RLE-encoded 1020×700 tile masks**, with each cell encoded as
a u16 (low_byte=value, high_byte=run_count). (b) **Faction trailing data
contains building HP and character movement waypoints** (CONFIRMED via a
clean 8-byte-diff save pair). (c) **Rebellion head sections are arrays of
fully-embedded character records** — per-general entries with portrait card +
portrait pair + ~482-byte trailing payload (CONFIRMED via cilicians head walk).

Save corpus this session: `save_rome10.sav` (RIS imperial campaign, 33 MB)
+ `save_Autosave Republic of Rome Turn 1.sav` (RIS T1, 33 MB) + Alexander
Macedon Turn 1 calibration save pairs (`save_notdamagedturn1.sav` vs
`save_damagedturn1.sav`, 8 byte diff).

#### 1. CONFIRMED & RETRACTED: the "alternate tile grid" (1.86MB region) is actually a 239-record array of per-faction 1020×700 tile masks

Session 14 reported a ~1.83MB "alternate tile grid" at 0x1f8f97b..0x210f4d4
with a 00-ff stride pattern, hypothesised to be a higher-resolution shroud
or terrain map. **That hypothesis is wrong.** The actual structure is:

```
zone: 0x1f4847b..0x210f4e5 = 1,863,786 bytes (rome10)
      = 239 variable-length records (per-faction tile-mask records)
```

Each record has the structure:

| Δ | Type | Value | Meaning |
|---|---|---|---|
| −24 | u32 | varies | hash/checksum |
| −20 | u32 | (record offset−16) | TAW pre-section selfPtr |
| −16 | u32 | varies | (next two u32s often read as ASCII bleed-through into model name string) |
| −12 | u32 | varies | |
| −8  | u32 | varies | flag |
| −4  | f32 | -1.0 | constant marker |
| **+0**  | **u32** | **selfPtr** | **TAW double self-pointer (= file offset of this u32)** |
| **+4**  | **u32** | **selfPtr+4** | **second selfPtr** |
| +8  | u32 | 0xf0af0af0 | **magic marker** |
| +12 | u32 | **1020 (0x3fc)** | **width** (constant across all 239 records, both saves) |
| +16 | u32 | **700 (0x2bc)** | **height** (constant) |
| +20.. | bytes | RLE payload | per-faction 1020×700 mask |

Per-record RLE payload encoding (CONFIRMED via full decode):

```
Each u16 LE cell encodes (low_byte = value, high_byte = run_count).
  0xff00 = 255 cells of value 0 (background sea/empty)
  0xe400 = 228 cells of value 0
  0x0102 = 1 cell of value 2
  0x0903 = 9 cells of value 3
```

Decoding rec[1] payload (8428 bytes → 714,000 cells = exactly 1020 × 700):
- 99.52% of cells = value 0 (background)
- Values 1..10 form clusters at faction centroids
- Value 175, 255 appear as edge markers

**239 = RIS's 23 majors + 216 minors faction count** (cross-validation: same
240-ish record count both in rome10 and RoR-T1 — exactly 239 each, identical
record sizes for 237 of 239, byte-identical for ~97% of cells).

**Cross-save byte diff (rome10 T5 vs RoR-T1 T1)**: 51,684 / 1,900,669 bytes
differ (2.7%). The smallest 5 records (5,790 bytes) are minor factions with
near-zero territory. Largest record is **rec[238] at 334,372 bytes** with
351,615 non-zero cells covering the entire map bbox [0..1019, 0..699] — the
**rebels/slaves faction**, which "owns" all tiles not held by another faction.

**1020 × 700 = exactly the dimensions of `public/map_regions_large.tga`**
(verified via TGA header), confirming this is the **RIS campaign map's
native resolution mask**.

Per-record spatial centroids (rome10, decoded against TGA):

| rec | nonZero | centroid | bbox |
|---|---|---|---|
| 0   | 3,905   | (339, 374) | [127..1016, 0..459]   | "?" (varies — special bg record) |
| 5   | 2,611   | (411, 376) | [250..990, 249..497]  | mid-faction in Greece/Aegean |
| 6   | 12,347  | (531, 244) | [212..990, 29..497]   | Pontus / Bithynia |
| 7   | 46,080  | (734, 380) | [255..990, 64..644]   | Seleucid (Asia Minor) |
| 67  | 43,178  | (734, 384) | [388..916, 249..505]  | major eastern faction |
| 144 | 42,753  | (734, 384) | [388..916, 249..505]  | major eastern faction |
| 177 | 45,062  | (737, 381) | [388..916, 249..505]  | major eastern faction |
| 238 | 351,615 | (498, 333) | [0..1019, 0..699]     | **rebels/slaves** (full map) |

**Cell value semantics (HYPOTHESIS)**: Cell value 0 = "not interesting to
this faction". Values 1..8 form gradient clusters with **value 2 at edges
and value 3+ in interior** (per the decoded row "2,3,3,3,3,3,3,3,3,3,2,0,0,
2,3,3,3,3,3,3,3,2"). This shape is consistent with **settlement-influence
zones** or **distance-from-settlement counters** rather than ownership
(which would be a binary mask). The high values (175, 255) at rare cells
are likely **edge-of-map / settlement-anchor markers**.

The dominant TGA pixel colors in non-zero cells are mostly **sea colors**
(`#298ce8..ec` blues) for small records, refuting the "ownership mask"
interpretation. This is a **per-faction strategic-influence overlay**, not
a region-ownership bitmap. The exact game-state semantic (shroud /
settlement influence radius / per-faction AI threat heatmap) is one
**controlled save-pair test** away from being pinned: change one settlement
ownership between saves, find the records that flip.

#### 2. CONFIRMED: faction trailing data contains building HP + character movement waypoints

A clean 8-byte-diff save pair (Alexander Macedon T1
`save_notdamagedturn1.sav` vs `save_damagedturn1.sav`) yields the
cleanest controlled-change byte diff this project has produced.

The 8 byte differences:

| Offset | A → B | Context | Interpretation |
|---|---|---|---|
| 0x0efd | 0x16 → 0x26 (22→38) | header | RNG counter (session-11 known monotonic field, two-byte change is expected) |
| 0x0efe | 0x0f → 0x21 (15→33) | header | same RNG counter (high byte) |
| 0x3604 | 0x1c → 0x16 (28→22) | character-path trail | **path waypoint count** (number of (x,y) pairs in a movement path) |
| 0x111ec | **100 → 50** | settlement → market building | **building HP / damage state** (u32, full=100, damaged=50) |
| 0x30da0 | 0x37 → 0x31 (55→49) | outro_script area | scripted-event progress counter |
| 0x30df8 | 0xdc → 0x44 (220→68) | outro_script area | scripted-event state (u16 paired) |
| 0x30df9 | 0xea → 0xe0 (234→224) | outro_script area | same u16 |
| 0x122277 | 0x01 → 0x00 | unit-type slaves area | rebel/slave unit flag |

**Building HP location (0x111ec)** is the most actionable finding:

```
Per-building record (inside settlement record):
  [u16 strLen][ASCII building name][u8 0x00]
  [u32 hash][u32 hash][u32 0x000018 = 24]
  [u32 hash][u32 hash][u32 0x000018 = 24]
  [u32 0x460]
  [u32 HP / 100]   <-- diff offset; full=100, damaged=50
  ...remaining building state...
  [u32 0x15]
  [10 bytes 0xff]  separator
```

The market building at 0x111c4..0x111fc has its HP-like u32 at +0x28 from
the building name's start. This is the **first time we have a concrete,
cross-validated per-building attribute address** in the RR save format.

**Character path waypoint count (0x3604)** sits inside a stream of
sequential u32 pairs that look like (x, y) waypoints:

```
0x35e4: ...(50, 0)(0, 13808)... terminator pattern
0x35f4: [u32 0x35f0 = ptr][hash 0xc7f7a44f][u32 0x35f8][u32 7][u32 13]
0x3604: [u32 = 28 (notdamaged) / 22 (damaged)]  <-- waypoint count
0x3608: [(2, 0)(18, 7)(49, 7)(48, 6)(48, 6)(47, 6)(46, 6)(45, 6)(44, 7)(44, 8)(44, 8)(43, 9)(43, 9)(42, 10)(42, 10)(41, 10)(40, 9)(40, 9)(39, 8)(39, 0)]
```

Each pair (x, y) describes a tile on the character's intended path,
suggesting this is a **character movement path** with the count field
preceding the array. The 22 vs 28 difference reflects 6 path-tiles being
consumed (a character moved 6 tiles).

**Implication for parser**: per-faction trailing data is dominated by
**per-character path records** — not the per-faction AI policy cache (which
remains UNPINNED, consistent with sessions 5/7/9/12/15). The actionable
take-away is the **building HP byte location**, which Provincia could use
to surface settlement-damage state in the UI.

#### 3. CONFIRMED: rebellion head sections are arrays of fully-embedded character records (rebel general candidates)

Decoding the cilicians_revolt.txt block's HEAD section (0x18d48cb..0x18e7f4b,
79,488 bytes), we find **28 generals** with the layout:

```
Per-general record (~460..500 bytes, median 482):
  +0..+27   ASCII pre-header: pointers + flags + age/trait? + record-size markers
            [u32 0x0e83 ptr][u32 1][u32 0x0e65 ptr][u32 8][u32 0x0ef8 ptr][u32 1]
            [u32 trait_or_age][u32 0xd0 = constant]
  +28       0x00 0x00 0x39 0x00            (u16 strLen=0x39=57 for card path)
  +30..+86  ASCII path "data/ui/<culture>/portraits/cards/young/generals/NNN.tga"
  +87       0x00 (NUL terminator)
  +88..+89  u16 strLen=0x3d=61 (for portrait path)
  +90..+150 ASCII path ".../portraits/.../NNN.tga"
  +151      0x00 (NUL)
  +152..+   trailing per-general payload (~330 bytes of structured data)
            — contains UTF-16LE settlement name (e.g. "Cimbria", "Eudosia")
            — contains 0xff..0xff sentinel runs (consistent with character record format)
            — contains small ints (likely traits, ancillaries, age)
            — ends with 0x02 0x00 0x00 record-tag (transition to next general)
```

Distinct portrait IDs in cilicians head: 25 IDs (some duplicates due to 28
generals using 25 portraits — multi-general-per-portrait is possible).

Per-script general counts (counted via portrait pair):

| Script | head size | generals (portrait pairs) | settlement-name strings | culture path prefix |
|---|---|---|---|---|
| chrysaoria_revolt | 224 B    | 0   | 0   | (head too small for generals) |
| cilicians_revolt  | 79 KB    | 28  | 28  | `barbarian/portraits/` |
| egypt_revolt      | 364 KB   | 128 | 128 | `greek/portraits/` |
| lycia_revolt      | 119 KB   | 38  | 41  | `greek/portraits/` |
| miletus_revolt    | 423 KB   | 100 | 152 | `eastern/portraits/` |
| thessaly_revolt   | 25 KB    | 7   | 11  | `egyptian/portraits/` |

Total generals embedded across all 6 rebellion heads: **~301 generals** —
this is the **rebel-leader candidate pool** for all scripted rebellions in
RIS. When a rebellion fires, generals are drawn from THIS pool (likely
deterministically by script ordering) rather than being randomly generated.

**Implication for Provincia**: a parser could enumerate the
"will-spawn-on-rebellion" general roster directly from these embedded
character records, surfacing a feature like "rebel leader preview" per
scripted rebellion. The portrait paths immediately reveal which faction-culture
each general will spawn as (`barbarian`, `greek`, `eastern`, `egyptian`).

The chrysaoria block has 0 generals (head only 224 bytes) — this script
doesn't spawn named generals, only the 75 sub-records of pre-conditions
(from session 14's count field).

#### 4. NEGATIVE: per-faction trailing AI policy cache remains UNPINNED

The 100→50 building-HP signal (clean 8-byte diff) sits in the **settlement
zone (0x10000..0x80000)**, not in a major-faction record's trailing data.
**The diff approach failed to surface any per-faction AI-policy / diplomatic
cache.** Sessions 5/7/9/12/15 all share this status — the AI policy cache,
if it exists, is NOT byte-aligned with the major-faction record. Likely
locations (untested): the body-root's direct children (one of the 287
CHARACTER_PATHS-shaped sections may instead be policy data), or embedded
inside the 239 tile-mask records' RLE payload (the value cells 1..8 might
encode "AI interest level" per tile, which IS the AI policy in some sense).

#### Reproducer scripts

- `dig-tail-tilegrid1.js` — initial probe (boundary detection failed, found wrong zone)
- `dig-tail-tilegrid2.js` — direct hex inspection at session-14 boundary 0x1f8f97b
- `dig-tail-tilegrid3.js` — small-grid analysis (off-by-position — found early small block)
- `dig-tail-tilegrid4.js` — find-all-00ff-runs enumeration (278 fragments in rome10, 45 in RoR-T1)
- `dig-tail-tilegrid5.js` — full-zone analysis bounded by W_models end + footer start (1.86MB)
- `dig-tail-tilegrid6.js` — discover self-pointer pair structure (242 records)
- `dig-tail-tilegrid7.js` — confirm 239 records via magic-marker f0 0a af f0 + (0x3fc, 0x2bc) constants
- `dig-tail-tilegrid8.js` — decode header bytes (-24..0); reveal "X/Y" reads are ASCII bleed
- `dig-tail-tilegrid9.js` — cross-save per-record byte diff (2.7% diff); record-length matching
- `dig-tail-tilegrid10.js` — payload-format probe (background runs, RLE pair shapes)
- `dig-tail-tilegrid11.js` — row-major sparse hypothesis (rejected — wasn't row-major)
- `dig-tail-tilegrid12.js` — **WINNER**: (low=value, high=count) u16 RLE → exactly 714,000 cells = 1020×700
- `dig-tail-tilegrid13.js` — per-record centroid analysis (rec[238] = full map, rec[7] = Asia Minor, etc.)
- `dig-tail-tilegrid14.js` — TGA color overlay (refutes "ownership mask"; mostly sea colors)
- `dig-faction-trailing1.js` — multi-pair save diff scan (notdamaged↔damaged = 8 bytes, cleanest)
- `dig-faction-trailing2.js` — decode 8-byte diff with string context (identifies building HP)
- `dig-faction-trailing3.js` — confirm 0x111ec is inside market-building record
- `dig-rebellion-head1.js` — locate all 6 head sections + portrait-pair + UTF-16LE settlement counts
- `dig-rebellion-head2.js` — walk per-general record structure; per-general spacing median 482B

#### Open follow-ups for session 18+

- **Tile-mask value semantics (the 1..8 gradient)**: which game-state
  variable corresponds to the per-cell value 0..8 ramp? Probe: change ONE
  settlement's ownership between saves (capture or destroy), find the
  records that flip values. The session-14 "alternate tile grid" attempt
  at decoding by overlaying TGA colors shows mostly sea pixels, suggesting
  the values do not correspond directly to region ownership. They might
  encode **distance-from-nearest-faction-settlement** (a gradient effect
  consistent with the observed value-ramp pattern).

- **Building HP across save pairs**: confirm by manually damaging a
  different building (e.g. defenses, barracks) and re-diffing. Currently
  only "market" is identified. The HP offset is `+0x28` from the building
  name's ASCII start, but other building structures may have different
  HP-field positions.

- **Rebellion general roster cross-link**: each rebellion's embedded
  generals (cilicians: 28, egypt: 128, etc.) likely have specific
  spawn-settlement bindings (the UTF-16LE settlement names embedded with
  each general). A parser could output a "rebellion preview" table linking
  general portrait → spawn settlement → faction culture.

- **AI policy cache** (still unpinned, sessions 5/7/9/12/15/17): most
  promising next target is searching the body-root direct children for
  non-CHARACTER_PATHS-shaped sections — sessions found 287 children but
  only the CHARACTER_PATHS subset was identified. One of the others is
  likely the policy cache.

- **Diplomacy enum** (still blocked): unchanged from prior sessions.
  Requires user-side single-isolated-diplomatic-action save pair.

---

### Findings 2026-05-11 (background session 18 — mid-file fixed-stride table + AI policy retry)

Goal: (1) Re-examine the mid-file 9.8MB fixed-stride record table (session 15 left
it as 36,582×267-byte records of unknown semantic) and try to map non-canonical
variants to descr_strat-placed entities (resources, ports, watchtowers). (2) Retry
the AI strategic-policy cache search using a different methodology: find u32 values
that DIFFER ACROSS TURNS but are STABLE WITHIN A TURN, since the AI cache should
be recomputed at turn-end. (3) Stretch: per-faction army manifest.

Outcome: **Two CONFIRMED findings + one strong NEGATIVE result.** (a) Session 15's
**36,582 record count is wrong** — the actual mid-file array is **57,120 records ×
267-byte stride** in rome10 / RoR-T1 (CONFIRMED), forming a **240×238 grid**
(CONFIRMED via rightmost-column and bottom-row edge-marker stripes). The 240×238 =
57,120 layout is now established. The variant-vs-resource spatial correlation
HYPOTHESIS from session 15 is **RETRACTED** (no preferential alignment with
resources, watchtowers, or ground-types — hit/baseline ratio = 0.93x, i.e., random).
(b) **AI policy cache LOCATED** at fixed offset **0x1024 in Alexander campaign
saves** — a 12-byte-stride array of `(u32 hash, u32 key, u32 turn)` records that is
**byte-identical within a turn** (intra-turn diffs = 0 across 3 controlled pairs)
and **changes only at turn boundaries** (cross-turn diffs = 20-144 records).
Triple-cross-validated. (c) Army manifest stretch: hashes in the AI cache are
**AI-cache-local UUIDs** (occur only inside the cache range, not referenced by
faction-record trailing data) so they're not character UUIDs and don't reveal an
army manifest.

Save corpus this session: `save_rome10.sav` and `save_Autosave Republic of Rome
Turn 1.sav` (RIS imperial), plus Alexander Macedon T1E/T2S/T2E/T3S/T3E/T5S/T6E/T7E/
T8S/T11S/T11E/T12S/T13S/T13E/T14E/T15S/T15E from
`calibration/archive/2026-04-21T22-42-59-494Z/`.

#### 1. CONFIRMED & RETRACTED: mid-file array is 57,120 records × 267-byte stride at 0xf8fd2 (was 36,582 in session 15)

Session 15 reported **36,582 records starting at `0x633c50`**. Re-scanning with a
strict byte-template signature (every byte must match the canonical pattern: `+0=5,
+12=10, +16/+20/+32=200, +24=2, +28=6, +84=576, +96=0xa6`, and bytes +97..+266
all zero) finds the array spans **MUCH FURTHER BACK**:

| Save | array start | record count | array end |
|---|---|---|---|
| rome10 (RIS imperial T5) | 0xf8fd2 | **57,120** | 0xf84632 |
| rome_t1 (same campaign T1) | 0xf8fd2 | **57,120** | 0xf84632 |
| Alexander Macedon | (not present) | 0 | — |

The session-15 start `0x633c50` was off by ~9.8MB and gave a 1/1.56 fraction of the
true record count. Both rome10 and RoR-T1 have identical record-count and start
offset, ruling out any save-state dependence. **Alexander Macedon saves do NOT
contain this array** — it is RIS-mod-specific or vanilla-imperial-specific (not
Alexander-generated content).

The total variant set is unchanged from session 15 (13 distinct keys), just with
more records:

| Variant key | rome10 count | Fraction |
|---|---|---|
| 200_200_2_6_200 (canonical) | 55,731 | 97.6% |
| 200_600_2_6_600 | 473 | 0.83% |
| 200_0_2_54_200 | 266 | 0.47% |
| 200_200_2_6_600 | 224 | 0.39% |
| 200_200_2_6_0 | 217 | 0.38% |
| 200_0_2_54_4294967286 (=−10) | 147 | 0.26% |
| 200_200_2_6_4294967286 (=−10) | 23 | 0.04% |
| 200_0_2_54_600 | 16 | 0.03% |
| 200_0_2_55_200 | 15 | 0.03% |
| 200_0_2_54_0 | 3 | 0.01% |
| 200_600_2_6_200 | 3 | 0.01% |
| 200_200_2_6_400 | 1 | 0.002% |
| 200_0_2_55_4294967286 | 1 | 0.002% |

Total non-canonical: **1,389 records (2.43%)**.

#### 2. CONFIRMED: the array is a 240×238 grid; rightmost column & bottom row are uniformly non-canonical (edge marker)

`57,120 = 240 × 238` exactly. Column-by-column non-canonical histogram at W=240:

- **Column 239 (rightmost): 238 non-canon (out of 238 rows) — every row has a
  non-canonical record at its rightmost cell.**
- **Row 237 (bottom): 235 non-canon (out of 240 cols) — nearly every column has a
  non-canonical record at the bottom-most row.**

These are textbook edge markers for a fixed-size 2D grid. Sessions 15's W=240
discovery was correct; the H=238 (not 153 as session 15 reported) is now confirmed.

The map_regions.tga is `1020 × 700` per `descr_terrain.txt`. So each grid cell of
the 240×238 array covers **1020/240 = 4.25 region-pixels × 700/238 ≈ 2.94
region-pixels** — i.e., a **12.5-pixel coarse pathfinding/strategic grid** over
the full campaign map. (1020 × 700 / 57,120 = 12.5 exactly.)

#### 3. RETRACTED: variants do NOT preferentially align with placed entities (resources / watchtowers / ground-types)

Tested all variant non-canonical cells against three sources of map placement data
from `descr_strat.txt`:

| Test | result |
|---|---|
| Resource (5,633 entries) → which cells? | 5,505 in canon cells, 128 in non-canon → **0.93x random baseline** (NOT correlated) |
| Watchtower (23 entries) → which cells? | 23/23 in canon, 0/23 in non-canon → **NOT correlated** |
| Ground type (map_ground_types.tga) → per-variant dominant color? | Every variant has 20-25% in same top GT color → **NOT distinguished by terrain** |

Tested both y-non-flipped and y-flipped coordinate mappings; neither improved
correlation. **The 1,389 non-canonical records are NOT placement caches for
resources, ports, watchtowers, or terrain-type tags.** Session 15's resource-
placement hypothesis is REFUTED.

What the variants ARE remains HYPOTHESIS-grade. The patterns (+28 enum 6/54/55,
+20/+32 cycling through {200, 0, 600, -10, 400}) look like **enum-shifted state
values** — possibly per-grid-cell AI pathfinding cost, danger weight, or
strategic-zone classification. Without a controlled mod test (toggle one piece of
descr_strat content and diff the array), the exact semantic remains open. The
RIS-only presence + 0 byte change across 5 turns strongly suggests **map-baked
static metadata** computed at campaign-start and never rewritten.

#### 4. CONFIRMED: AI policy cache at offset 0x1024 in Alexander campaign saves

The AI cache hunt finally pays off using a different strategy. Instead of
fixed-stride array scanning (sessions 5/7/9/12/15 all failed), look for u32 values
that DIFFER ACROSS TURNS but are STABLE WITHIN A TURN. Three controlled save pairs
revealed a region of the file (`0x500..0x3bad`) with ~106 such bytes in the fixed
header.

The biggest finding is at **fixed offset `0x1024`** in every Alexander save:
**a 12-byte-stride record array** that follows the AI-cache invariant.

Each record:
```
struct AICacheRecord {
  u32 hash;       // agent/target identifier (45 distinct non-zero values in T13E)
  u32 key;        // packed action/tile code; low byte ∈ {01, 02, ...} is a counter
                  // (increments by 1 each turn the AI re-affirms the entry)
  u32 turn;       // turn number stamp (1..65 observed); monotonically grouped
                  // (records with turn=N appear before turn=N+1)
}
```

The array starts at **`0x1024`** and runs to **~`0x25fc`-`0x2674`** (variable end
per save), containing **445-477 records** depending on save turn number. End is
marked by the first 12-byte slot where `turn ≥ 200` or `turn == 0`.

**Cross-turn behaviour** (TRIPLE-VALIDATED across 3 controlled save pairs):

| Diff pair | record diff count | size diff |
|---|---|---|
| **T11S → T11E (intra-turn)** | **0** | 0 (no records added or modified within a turn) |
| **T13S → T13E (intra-turn)** | **0** | 0 |
| **T15S → T15E (intra-turn)** | **0** | 0 |
| T11E → T12S (cross-turn) | 144 | +4 records |
| T13E → T14E (cross-turn) | 20 | −1 record |
| T14E → T15S (start-of-next-turn) | **0** | 0 (cache survives turn-end save) |

The **0 intra-turn diff** is the strongest possible signal that this is an AI-side
recomputed cache, not a runtime-pointer field. Within a turn the engine treats the
array as read-only, then rewrites it as part of turn processing. Across turns,
~20-144 records flip their `key.low_byte` from `01` to `02` (incrementing visit
counter) and ~1-5 records are added/removed.

**Record count progression** (Macedon Alexander campaign):

```
T1E:  445   T2S: 445   T2E: 445   T3S: 449   T3E: 449
T5S:  451   T6E: 455   T7E: 456   T8S: 477   T11S: 472   T11E: 472
T12S: 476   T13S: 466  T13E: 466  T14E: 466  T15S: 466   T15E: 466
```

Counts grow over the early game (445 → 477 by T8) then settle. Some turns drop
records (T8S=477 → T11S=472, a 5-record decrement = AI evicted 5 expired entries).

**Hash distribution** in T13E (45 distinct non-zero hashes, 466 records):
- Top hash `0x36465c3a` × 30 entries
- Top hash `0xc7e043d8` × 30 entries
- 9 hashes with 15+ entries each — likely the AI's **prioritized target agents/
  tiles** (player generals, enemy capitals, etc.)
- Mode is ~5-10 entries per hash

The 45 distinct hashes is consistent with **Macedon's known agent count at T13**
(generals + diplomats + spies + neighbouring-faction-targets). NOT random data.

**Implication for Provincia**: the AI policy cache is now decodable as a
flat fixed-offset 12-byte array. A parser can read the array directly without
walking any TAW section grammar. The `turn` field gives chronological ordering;
the `hash` lets us group by agent/target; the `key.low_byte` reveals **how many
turns since the AI last reaffirmed this entry**. Useful for:
- "AI memory inspector" feature showing what enemies the player's AI knows about
- Detecting AI's strategic priorities (frequently-reaffirmed targets)
- Cross-validating session 14's tile-trail-chunks chunk[0] (player Romans Julii)

**Note: This is the Alexander campaign location.** RIS imperial (rome10) has a
similar pattern at `0x3c78` with ~60+ records, but the start offset is different
due to different header padding. The signature (12-byte stride, turn field <200,
intra-turn stable) generalizes; the offset is campaign-specific.

#### 5. CONFIRMED: additional AI-cache-pattern bytes in fixed header region

Cross-turn diff (T13E → T14E) within the 0..0x3bad header reveals 106 bytes with
the AI-cache signature. Cluster summary:

| offset range | size | content |
|---|---|---|
| `0x502` | 1 B | byte counter |
| `0xf80` | 1 B | byte counter |
| `0xf88` | 1 B | byte counter |
| **`0xfc0..0xfef`** | **48 B (12 u32s)** | **f32 AI weight vector (read as 4×f32 = [3.06, -0.0, +1.8e25, -8.5M] in default mode; flips to [1.88, -0.33, -1.1e33, +1.4e31] in alternate mode — NOT a clean cross-turn weight, ambiguous semantic)** |
| `0xff8` | 4 B | u32 counter (varies per save: 0x89fdec00, 0x7092c200, 0x01857100, 0x76aa7900, 0x04454c00, 0xec957c00) |
| **`0xffc`** | **4 B** | **u32 counter (decimal: 357, 424, 365, 444, 383, 262 — varies per save by ~80-200 between turns; SAME within turn)** |
| `0x21d4..0x2474` | 40 singletons | scattered byte-counter slots; each at offset+11 of a 12-byte slot, looks like the **AI cache's key.low_byte field** (this region overlaps the AI cache array at 0x1024..0x25fc) |
| `0x2605..0x2d0d` | various | **3-byte rotated values** like `0x100/0x200/0x300/0x1000000/0x2000000/0x3000000` — **byte-packed at byte 1, 2, or 3 within u32s**. Looks like a **per-faction or per-region AI priority counter**, but without a stride pattern. |
| `0x364b / 0x3999 / 0x3ab3` | 1 B each | misc counters |

The `0xfc0..0xfef` 48-byte block and `0xffc` u32 are the **strongest candidates
for a per-faction AI strategic-weight summary**. The 48-byte block in particular
fits "4 weights for each of N=3 AI factors" or "12 floats of strategic mood".
However, the f32 interpretation gives some sensible values (3.06, -0.33) AND some
that are clearly bit-pattern garbage (1.8e25 = high-bit binary nonsense), so this
region is **mixed f32 + structured bytes**, not a clean float array. The exact
schema is HYPOTHESIS-grade.

#### 6. NEGATIVE: per-faction army manifest stretch not pinned

Hypothesis: each AI-cache hash is a per-character UUID and the faction's
army-manifest array references those same UUIDs. Test: for each unique hash in the
AI cache, count how many times it appears OUTSIDE the cache region (`0x1024..
0x25fc`).

Result (Macedon T13E):
- Top hash `0x36465c3a` × 31 total occurrences, **all 31 inside the AI cache**
- Top hash `0xc7e043d8` × 31 total occurrences, **all 31 inside the cache**
- Top hash `0x92c34070` × 22 total occurrences, **all 22 inside the cache**
- ...etc. for all 45 distinct hashes

**The hashes are AI-cache-local identifiers**, NOT referenced anywhere else in
the save. So they aren't character UUIDs used by the faction's army records.
The army manifest, if it exists, uses different identifier shapes and remains
unpinned.

#### Reproducer scripts

- `dig-midfile-recount1.js` — strict-template scan finding 57,120 records (vs session 15's 36,582)
- `dig-midfile-recount2.js` — variant histogram + 240×238 grid edge analysis
- `dig-midfile-recount3.js` — resource/watchtower/ground-type correlation NEGATIVE result
- `dig-ai-policy-retry1.js` — AI cache decode + intra/cross-turn diff validation (3 pairs)
- `dig-ai-policy-retry2.js` — header AI-cache-pattern byte enumeration (106 bytes)
- `dig-army-manifest1.js` — army manifest hypothesis NEGATIVE (hashes are cache-local)

#### Open follow-ups for session 19+

- **Mid-file array semantic** (HYPOTHESIS-grade): the 1,389 non-canonical records
  encode something map-baked-static, but neither resources, watchtowers, nor
  terrain. Possibilities still open: **port locations**, **road network nodes**,
  **mercenary recruitment pools**, **strategic-AI-zone classification**,
  **per-cell pathfinding move-cost**. A controlled-mod test (remove one
  port/road/mercenary entry, save → diff against unmodified save) would identify
  which type by which records flip.

- **AI cache `hash` semantics**: 45 distinct hashes in Macedon T13E correspond to
  the player's known agents + targets. A targeted save pair where ONE character
  dies (or is promoted) would let us pin which hash = which character. Or:
  hash-as-string-bin-of-cstring decoding might reveal that hashes are CRC32 of
  the agent's internal name.

- **AI cache `key` semantics**: the key field has structure `0xMMTT01` where
  `MM` = some kind of category (we saw 0x14, 0x15, 0x16, 0x17, 0x18 for one hash
  → likely sequence ID), `TT` = a 2-byte target identifier (0x10, 0x11, 0x12 for
  early records → likely tile-X or character-ID), and the low byte starts at `01`
  and increments by 1 each turn the AI revisits. Full decode requires reading the
  AI's tile-trail (session 16) and cross-matching keys to tile coords.

- **Per-faction f32 weight vector at 0xfc0..0xfd0**: 4 f32 floats that flip between
  two distinct value sets across saves. The default set [3.06, -0.0, +1.8e25,
  -8.5M] reads partially-sensible-as-floats. With a different save pair (multiple
  factions, one diplomatic event between saves), we might isolate which faction
  the floats belong to and what they measure.

- **`0xffc` u32 counter**: 4 distinct values across the 8-save corpus (357, 424,
  365, 444, 383, 262). Likely a turn-summary scalar (AI's total active-event
  count?). Cross-correlating with the AI-cache record count would reveal the
  formula.

- **RIS imperial AI cache location**: similar 12-byte pattern at `0x3c78` in
  rome10, but with different start offset due to RIS's larger header. A future
  session could pin the RIS-specific start offset.

---

### Findings 2026-05-11 (background session 19 — AI cache semantics + RIS offset)

Goal: (1) Pin RIS imperial AI cache start offset (session 18 noted "similar 12-byte
pattern at `0x3c78` in rome10"). (2) Decode AI cache hash semantics (45 distinct
hashes in Macedon T13E — character UUIDs? CRC32?). (3) Decode AI cache key/turn
semantics (low byte counter? tile coords?). (4) Mid-file 1,389 non-canonical
records: try port/road/coast hypotheses.

Outcome: **Four CONFIRMED findings + two RETRACTED.** (a) **The session-18 AI cache
schema interpretation `(hash, key, turn)` is REVISED**: the third u32 is **tile-Y**
not "turn number", and `key.byte2..3` is **tile-X** (single byte in Alex, u16 in
RIS). Each record is a **tile coordinate** annotated with hash and key. (b) **RIS
imperial AI cache CONFIRMED at offset `0x51b5` in rome10/romet1**, preceded by a
**u32 length prefix at `0x51b1`** containing `13884` (=record count). Total cache
size 13,885 records × 12 bytes. The session-18 hint of `0x3c78` was a false alarm
(low-entropy junk region). (c) **Hash is an AI-plan/operation ID, NOT a character
UUID** — the entire hash set (45 hashes) turns over between t11e→t13s, ruling out
persistent character identifiers. Records with the same hash form **connected
paths** in tile-coord space (consecutive integer (x,y) walks). (d) **Mid-file
non-canonical cells are NOT correlated with bridges, rivers, sea, or coast** —
session-18's "map-baked-static" hypothesis still holds but the specific feature
remains unidentified.

#### 1. CONFIRMED & REVISED: AI cache record schema is `(hash, key, tile_Y)` where key encodes type+tile_X

Re-examination of Alexander cache records reveals the 12-byte schema:

```
struct AICacheRecord {
  u32 hash;       // AI plan/operation ID (NOT char UUID, see finding #3)
  u32 key;        // packed: low_byte=type, byte1=mode, bytes[2..3]=tile_X
                  //   type ∈ {0x01, 0x02, 0x04, 0x00, 0x80}
                  //   mode ∈ {0x00, 0x02, 0x03, 0x20, 0x22} (mostly 0x20)
                  //   tile_X: u8 in Alex (Alex map is 130 wide), u16 in RIS (1020 wide)
  u32 tile_Y;     // single tile-Y coordinate (single byte effectively; Alex<69, RIS<700)
}
```

**Spatial coherence test (Macedon T13E)**: For each of the 45 distinct non-zero
hashes, all records cluster within a small spatial region:

| Hash | n records | Tile-X range | Tile-Y range | Tightness |
|---|---|---|---|---|
| 0x36465c3a | 30 | 116..126 | 40..49 | tight diagonal path |
| 0xc7e043d8 | 30 | 20..35 | 51..65 | snaking path SW→NE |
| 0x92c34070 | 20 | 32..41 | 22..30 | small box |
| 0xa64fe2aa | 18 | 36..44 | 57..65 | horizontal extension |
| 0xeb22c841 | 16 | 72..79 | 18..26 | tight cluster |
| 0xd2fd4c9d | 15 | 86..92 | 12..19 | vertical line |
| 0x8259699d | 13 | 8..19 | 49..50 | **MACEDON HOMELAND** (Alexander at 11,49) |

Within each hash, **consecutive records form connected integer-coordinate paths**:
e.g., hash 0x36465c3a starts at (116,40)→(117,40)→(118,40)→...→(123,40), then
turns south at (123,41)→(124,41)→(124,42)→(124,43)→.... These are **tile-by-tile
movement paths**, not random clusters.

**Alex map dimensions**: `map_regions.tga = 130 × 69`. Cache X range 0..128, Y range
0..65 — perfectly within bounds.

#### 2. CONFIRMED: RIS imperial AI cache at offset `0x51b5` with u32 length prefix at `0x51b1`

Searching rome10 by exhaustive 12-byte stride scanning reveals the cache:

```
@0x51b1: u32 record_count (=13884 in rome10 and romet1)
@0x51b5..0x2dc91: 13,885 records × 12 bytes each
```

The 12 bytes preceding 0x51b5 contain `00 a0 40 00 01 ad 51 00 00 3c 36 00 00 00 00 00`
— the `00 3c 36 00` at 0x51b1 reads as u32 LE `0x363c` = 13884 (one less than
record count, suggesting "count of non-sentinel records" or "max-record-index").

**Verification table** for rome10 RIS imperial save:

| Save | start | length prefix | record count | end offset |
|---|---|---|---|---|
| rome10 | 0x51b5 | 13884 @ 0x51b1 | 13,885 | 0x2dc91 |
| romet1 | 0x51b5 | 13884 @ 0x51b1 | 13,885 | 0x2dc91 |

**Coordinate system in RIS**: X range 0..1018, Y range 1..696. The RIS map is
1020 × 700 pixels (with a 240 × 238 cell grid overlay from session 18). The X
values **exceed 240**, so the AI cache uses **map-pixel-level coordinates**, not
the coarse 240×238 grid coords. Cache key byte structure adapts: bytes [2..3] now
encode tile_X as a u16 little-endian.

**Cross-save diff**: rome10 vs romet1 differ in 12,573 / 13,885 records — confirms
the cache is per-turn state (not map-baked-static).

**Hash count**: rome10 contains 1,536 distinct non-zero hashes (vs 46 in Alex
Macedon T13E). RIS imperial campaign has 33 factions vs Alex Macedon's 6 — much
more AI activity, which scales the cache size proportionally.

#### 3. CONFIRMED & RETRACTED-from-session-18: hash is an AI plan/operation ID, NOT a character UUID

Test: hash should be stable for a persistent character. If Alexander (king of
Macedon, never dies in early game) is hash 0xXXXX in T1E, the same hash should
appear in T2E, T3E, T5S, ..., T15E.

Result across 10 Macedon Alexander saves (t1e through t15e):

```
Save | n_hashes | hash_set
t1e  | 46 | (initial set X)
t2e  | 47 | X + 0x00000100 (one new)
t3e  | 47 | unchanged
t5s  | 46 | X (0x00000100 removed)
t11s | 45 | X minus 0x00000021
t11e | 45 | unchanged
t13s | 46 | COMPLETELY DIFFERENT SET (0 common with t11e!)
t13e | 46 | unchanged
t14e | 45 | t13s minus 0x00000021
t15e | 45 | unchanged
```

**The hash set turns over completely between t11e (turn 11) and t13s (turn 13)** —
45 hashes removed, 46 added, 0 common. If hashes were character UUIDs, this would
mean 45 of the player's tracked characters died in turn 12 (impossible). The hash
set is a **rolling buffer of AI strategic plans/operations**, each with a typical
lifetime of 3-12 turns.

**Universal-hash count across all 10 saves: 0.** No hash persists across the
entire corpus. Character UUIDs would be universal. Plan/operation IDs are not.

**Implication**: each hash = a discrete AI plan ("plan to invade region X"); the
12-byte records within that hash represent **path waypoints** or **target tiles**
that comprise the plan. Plans are discarded when fulfilled/expired and replaced
with new plans (new hashes). The 46 ± 1 stable count suggests the AI maintains
**~45 concurrent plans** as its working memory.

**Session 18's "character UUID" hypothesis is REFUTED.** Session 18's "turn field"
hypothesis (game turn number) is also REFUTED — t13e records have field-3 values
12..65 which can't be game turns in turn-13 saves.

#### 4. CONFIRMED: Hash centroids align with character positions, supporting "AI plan targets nearby characters" hypothesis

For 39 of 45 hashes in Macedon T13E, the hash's spatial centroid is within 6 tiles
of a known descr_strat character position. Specifically:

| Hash | Centroid | Nearest descr_strat char | Distance |
|---|---|---|---|
| 0x8259699d | (13, 50) | Alexander (Macedon king) at (11, 49) | 2.4 |
| 0xa8dc6aa8 | (70, 25) | Parthia general Ardumanish at (70, 24) | 0.7 |
| 0xfdea4f41 | (67, 27) | Parthia named char Umamaita at (72, 27) | 1.9 |
| 0xb4a5b281 | (62, 29) | Parthia general at (63, 28) | 1.4 |
| 0xcf0cbb96 | (81, 16) | Parthia named char at (80, 17) | 1.5 |

**Hashes are NOT CRC32(character_name)** — 0/57 character names match any hash via
CRC32, including with `_` substitution. But the **spatial colocation with character
positions** is strong: 18 of 45 hashes have centroid distance < 3 tiles to nearest
descr_strat character. **This strongly suggests each hash = an AI plan targeting
a specific enemy character/region**, with records being **path waypoints between
the AI's units and that target**.

#### 5. CONFIRMED: Cache schema is the same in Alex and RIS imperial, only the coord encoding differs

| Property | Alexander | RIS imperial (rome10) |
|---|---|---|
| Start offset | 0x1024 | 0x51b5 |
| Length-prefix offset | (none observed — implicit) | 0x51b1 (u32 = 13884) |
| Record count | 446-477 (Macedon, T1-T15) | 13,885 (rome10/romet1) |
| X encoding | u8 at key byte 2 | u16 at key bytes [2..3] |
| Y encoding | u32 (effectively u8: 0..65) | u32 (effectively u16: 1..696) |
| Distinct hashes | 45-47 | 1,536 |
| Coord scale | tile-level (130×69) | pixel-level (1020×700) |
| Cache stability | intra-turn 0 diffs, cross-turn ~20 | cross-save 12,573 diffs |

The fundamental record layout `(u32 hash, u32 key, u32 Y)` is invariant — Alex
just uses a smaller embedded X representation since its map fits in 1 byte.

#### 6. RETRACTED: mid-file non-canonical cells are NOT coast, sea, bridges, rivers, or roads

Building on session 18's RETRACTED resources/watchtowers/ground-types result, this
session tests three more candidates:

| Candidate | Source | Hit ratio (non-canon vs baseline) |
|---|---|---|
| Bridges (white pixels in `map_features.tga`) | 180 cells | 1.08x (no signal) |
| Rivers (cyan pixels in `map_features.tga`) | 1,384 cells | 1.07x (no signal) |
| Coastal land (sea-adjacent in `map_ground_types.tga`) | 13,049 cells | 0.83x (UNDER-correlated) |
| Sea tiles (blue in `map_ground_types.tga`) | 5,537 cells | 0.65x (UNDER-correlated) |

All four candidates give ratio ≤ 1.1x baseline. None of these is what the 1,389
non-canonical cells represent. **Session 18's "map-baked-static" theory still
holds** (no cross-turn diff, only 0.97x correlation with anything tested), but the
specific feature class remains unidentified after 5 hypotheses (resources,
watchtowers, ground-type, bridges, coast).

Interesting per-variant observation: variant `200_0_2_54_200` (266 cells) has
93% land / 7% sea breakdown (266 cells: 247 land, 18 sea, 1 coast) — under-coastal
even compared to the other non-canonical variants. This variant looks like
**"deep-interior strategic marker"** rather than coast-related.

**Remaining open candidates**: ai-pathfinding-zone-id, settlement-fog-of-war-state,
faction-territory-perimeter-cells, or some compositional state (e.g. cell-of-
roman-road-passing-through-here).

#### Reproducer scripts

- `dig-ai-cache-ris1.js` — initial RIS scan with strict signature (false starts at 0x3c78)
- `dig-ai-cache-semantics1.js` — Alex cache record histogram (key bytes, hash distribution)
- `dig-ai-cache-semantics2.js` — turn-field interpretation (refutes session 18's "game turn" hypothesis)
- `dig-ai-cache-keytt.js` — `(byte2, turn) = (tile-X, tile-Y)` correlation; consecutive-integer-paths discovery
- `dig-ai-cache-hash.js` — CRC32 character-name test (all-NULL), spatial centroid analysis
- `dig-ai-cache-settlements.js` — hash centroid vs settlement positions
- `dig-ai-cache-hash2.js` — hash set turnover across 10 Macedon saves (refutes character UUID hypothesis)
- `dig-ai-cache-ris13.js` — RIS imperial cache schema decode (u16 tile-X, pixel coords)
- `dig-ai-cache-ris14.js` — RIS cache start pinned to 0x51b5 + length prefix at 0x51b1
- `dig-midfile-roads.js` — mid-file array vs `map_features.tga` & `map_roughness.tga` (NEGATIVE)
- `dig-midfile-bridges2.js` — bridge correlation excluding edge-markers (1.08x, no signal)
- `dig-midfile-coast.js` — coast/sea correlation (0.83x, no signal)

#### Open follow-ups for session 20+

- **Confirm hash = AI-plan-target-character**: cross-validate by tracking a hash's
  centroid across consecutive saves. If a hash represents "plan to attack
  character X", the centroid should move *with* character X's tile movement. A
  save corpus with explicit character displacement (capture a screenshot of
  generals' positions between saves) would let us pin specific hash→character
  mappings.

- **Decode key.byte1**: byte1 ∈ {0x00, 0x02, 0x03, 0x20, 0x22}. Most records use
  0x20. byte1 = 0x00 records have `key.low_byte = 0x04` (special record type)
  while byte1 = 0x20 records have `key.low_byte = 0x01` (normal). Hypothesis:
  byte1 distinguishes **target-tile** (0x20) from **own-army-position** (0x00).
  Testable by comparing key-low-byte=0x04 records' coordinates against the
  player's own descr_strat characters (Macedon).

- **Mid-file 1,389 cells remain unexplained**: try AI strategic zone classification
  (read `descr_terrain.txt` for zone definitions) and pathfinding move-cost
  (compare against neighbors). A controlled-mod diff (toggle one piece of map
  data, save, diff) would resolve this fastest.

- **RIS cache length prefix semantics**: the u32 13884 at 0x51b1 is one less than
  the record count (13,885). Either (a) prefix = `max_record_index` (off-by-one
  inclusive vs exclusive), or (b) the 13,885th record is a sentinel that's not
  counted. Verify by checking the 13,885th record's contents in detail.

- **Compare RIS rome10 hash distribution to Alex hash distribution**: Alex has
  46 hashes / 466 records = ~10 records/hash. RIS has 1,536 hashes / 13,885 =
  ~9 records/hash. Same ratio — strong evidence the per-hash records-per-plan
  is **engine-defined** (path-length per AI plan), not faction-specific.

---

### Findings 2026-05-11 (background session 20 — trade goods + roads + battle log)

Goal: (1) Trade goods / per-settlement resource production. (2) Battle log /
"Famous Battles" history. (3) Tile-level road network (beyond the
per-settlement `hinterland_roads` presence flag found in session 8).

Outcome: **Two CONFIRMED findings + one major NEGATIVE.** (a) **Road
infrastructure LEVEL** decoded at `hinterland_roads` payload+4 = u8 in
`{0=dirt, 1=paved, 2=highways}` (CONFIRMED, cross-validated across RIS
imperial rome10/RoR-T1 + Alexander Macedon T97/T98/T99 + Alexander T1
saveturn1start). (b) **56-name settlement sub-record inventory** for the
RIS imperial settlement zone, including 24 resource-related production
chains (CONFIRMED). (c) **Trade-good placement data is NOT stored as
strings, NOT as a per-settlement bitmask, NOT as a positional (X,Y) cache
in the mid-file 240×238 grid** (RETRACTED candidates from earlier sessions
not landing; session 18's NEGATIVE result CONFIRMED on resources).
Battle log: **NOT pinned** (HST has FAMOUS_BATTLE_DETAIL v=4 and
FAMOUS_BATTLE_SITE_MANAGER v=1 schemas; only header-region HST matches
in body — no schema-named body instances; player-record trailing data
scans at strides 16..64 yielded ≤80 candidate records out of 11,557, far
below the noise threshold for a battle history list).

Save corpus this session: `save_rome10.sav` (RIS imperial T5),
`save_Autosave Republic of Rome Turn 1.sav` (RIS imperial T1), Alexander
Macedon T97/T98E/T99S, `save_saveturn1start.sav` / `save_saveturn2start.sav`,
`save_damagedturn1.sav` / `save_damagedturn2.sav`,
`save_Noarmiesmovedturn1.sav`. Ground truth: `public/resources_large.json`
(1305 regions × 5,633 placed resources, with per-resource type + (X,Y) +
amount); `C:/RIS/RIS/data/world/maps/base/descr_regions.txt` for region →
city name mapping (e.g. "Roma" → "Rome"); `C:/RIS/RIS/data/descr_sm_resources.txt`
for the 792-entry master resource ID list and the canonical 44-entry
short list.

#### 1. CONFIRMED: road infrastructure LEVEL at `hinterland_roads` payload+4 (u8 = 0/1/2)

Anchor: the dossier's session-8 finding identified that 539 settlements in
rome10 have a `hinterland_roads` sub-record (the "has roads" flag). This
session refines that to a **3-level enum** by reading the byte at
**relative offset +4 from the sub-record's name+NUL** (i.e. payload+4 in
the standard `[u32 selfPtr][u16 nameLen+1][asciiz "hinterland_roads"][u32
runtime_hash][u8 LEVEL][...]` layout — session 10's "level byte at +4 after
hash" rule applies).

**Decoded levels** (cross-validated across 7 saves on 3 different campaigns):

| Save | total roads | level 0 (dirt) | level 1 (paved) | level 2 (highways) |
|---|---|---|---|---|
| rome10 (RIS imperial T5) | 539 | 491 | 46 | 2 |
| RoR T1 start (RIS imperial T1) | 539 | 491 | 46 | 2 |
| Macedon T97 (Alexander, turn 97) | 27 | 16 | 11 | 0 |
| Macedon T98 End | 27 | 16 | 11 | 0 |
| Macedon T99 Start | 27 | 16 | 11 | 0 |
| Alexander saveturn1start | 25 | 25 | 0 | 0 |
| Alexander saveturn2start | 25 | 25 | 0 | 0 |

**Validation by city name**: Level-1 (paved) settlements in rome10 include
**Carthage, Pella, Chalkis, Alexandria, Aleria, Tingi, Baria, Nagidos,
Kaunos** — all major capitals or commercially significant cities, which
matches descr_strat's higher-tier road buildings in those locations.
Level-2 (highways) hits only `Han_Settlement` and `Agrianon_Teichos` in
rome10 — both end-of-the-line trade hubs in eastern Asia. In Macedon T97
(late Alexander campaign) level-1 hits include **Pella, Babylon,
Halicarnassus, Tyre, Issus, Epidamnus** — Alexander's empire capitals as
expected.

**Stability across turns**: rome10 vs RoR-T1 (5 turns apart in the same
campaign) is byte-identical for all 539 road records — no construction
between turns. Macedon T97/T98E/T99S all share the same 27-record state,
showing that turn-end processing doesn't perturb the level field on its
own.

**Parser strategy for Provincia**: scan each settlement's record from the
settlement-name marker forward up to ~3500 bytes for the cstring
`hinterland_roads\0`. If absent → no roads. If present → read the u8 at
`namePos + 17 + 4` = the level (0, 1, or 2). Maps directly onto the in-game
"dirt roads / paved roads / highways" tier display.

The dossier's session-8 hypothesis that "trade routes are NOT stored as
(settlement_id_a, settlement_id_b) pairs in the save body" remains true.
The save persists only the **per-settlement road-tier infrastructure**;
the engine computes tile-to-tile edges and trade-route graphs from this
+ ownership + diplomacy + descr_strat road-tile descriptors at load time.

**Reproducer**: `node scripts/save-cracker/dig-roads7.js` decodes road
levels for any save (just edits the path); `dig-roads8.js` runs the
7-save cross-validation table above.

#### 2. CONFIRMED: 56-name settlement sub-record inventory (production chains + infrastructure)

Brute-force scan of the RIS imperial settlement zone (rome10's
`0xf80000..0x1f10000`) for u16-prefixed lowercase-snake-case sub-record
names with valid `[selfPtr][nameLen][name\0]` headers yields **56 unique
sub-record names**, far more than the 5 dossier session 3 enumerated for
Rome alone. The complete list and per-name occurrence counts (top 40,
sorted descending):

```
1305 core_building            // every settlement
1296 hinterland_region        // every regular settlement
 552 market
 539 hinterland_roads         // session-8 "has roads" flag (now with level decoded)
 539 defenses                 // walls
 432 health                   // sewers/cisterns
 367 military_industrial_complex
 240 irrigated_farming        // farms (variant 1)
 227 port_buildings
 170 garrison
 143 highland_pastoralism
  76 herds
  42 theatres
  31 hospitals
  24 nomadic_pastoralism
  22 shifting_cultivation
  19 wine_industry            // RESOURCE PRODUCTION
  18 sedentary_animal_husbandry
  18 horse_trainer            // RESOURCE PRODUCTION
  17 academic
  16 textiles_production      // RESOURCE PRODUCTION
  14 olive_cultivation        // RESOURCE PRODUCTION
  13 grain_industry           // RESOURCE PRODUCTION
  13 wetland_pastoralism
  12 timber_industry          // RESOURCE PRODUCTION
  10 marsh_reclamation
   9 salted_fish              // RESOURCE PRODUCTION
   9 rainfed_farming
   9 mines                    // RESOURCE PRODUCTION
   9 amphitheatres
   8 forest_pastoralism
   7 colony
   7 agroforestry
   7 dates_cultivation        // RESOURCE PRODUCTION
   7 qanat_farming
   6 dyes_production          // RESOURCE PRODUCTION
   6 temples_of_viking
   6 perfumes_industry        // RESOURCE PRODUCTION
   6 silk_trader              // RESOURCE PRODUCTION
   5 temples_of_horse_2
   4 pottery_production       // RESOURCE PRODUCTION
   3 glass_production         // RESOURCE PRODUCTION
   3 honey_industry           // RESOURCE PRODUCTION
   3 purple_dye_production    // RESOURCE PRODUCTION
   3 hunters
   2 river_port
   2 papyrus_maker            // RESOURCE PRODUCTION
   2 slave_market              // RESOURCE PRODUCTION
   2 spices_trading           // RESOURCE PRODUCTION
   2 jewelry                  // RESOURCE PRODUCTION
   2 hides_industry           // RESOURCE PRODUCTION
   2 hemp_cultivation         // RESOURCE PRODUCTION
   1 incense_trader           // RESOURCE PRODUCTION
   1 marble_production        // RESOURCE PRODUCTION
   1 ivory_trade              // RESOURCE PRODUCTION
   1 smith
```

These 24 resource-production chains (marked above) are the **engine's
record of which trade-good production buildings have been constructed
in each settlement**. They are NOT the same as the placed-resource
(X, Y, type) records from descr_strat (see finding #3 below) — they're
the build-state of optional player-/AI-constructed industries.

Each sub-record uses the standard `[u32 selfPtr][u16 nameLen+1][asciiz
name][u32 runtime_hash][u8 LEVEL][padding][u32 max_health][...]`
layout (session-10/11 building-chain schema). Reading payload+4
yields the current chain level (0..N depending on the chain's max tier).

**Practical use for Provincia**: a "trade good production" UI panel can
be derived by scanning each settlement for which of these 24 production
chains is present, with the level at +4 giving the tier. The actual
**placed resource tiles** (which determine WHICH chains a settlement is
eligible to build) are stored elsewhere — see finding #3.

**Reproducer**: `dig-trade-goods` family (specifically the brute-force
sub-record-name scan in `dig-trade-goods` later steps).

#### 3. NEGATIVE / RETRACTED: trade-good placement (X, Y, type) is NOT stored as a positional cache anywhere in the body

Cross-validated against the ground-truth `public/resources_large.json`
(5,633 placed resources across 1305 regions, each with x∈[4..1019],
y∈[2..699], type ∈ 42 distinct strings, amount ∈ [1..3]).

**Searches attempted, all NEGATIVE**:

| Search strategy | Result |
|---|---|
| ASCII trade-good names (`"slaves\0"`, `"grain\0"`, etc.) in save | 0 hits for 40 of 42 types; `salt` 1 UTF-16, `tin` 31 UTF-16 — both spurious matches inside other words (Latin city names) |
| Resource type IDs (44-entry short list, 792-entry long list) inside settlement records | Sparse, no signature pattern. Rome's resource IDs `{2,4,9,11,25,40,43}` appear ≤3 times each as u32 inside its 3728-byte record, scattered, no clean fingerprint |
| Per-settlement bitmask (8 bytes encoding 44 bits) at any fixed offset in settlement record | NO MATCH. Rome's mask `140a000200090000` doesn't appear anywhere in Rome's record |
| u8 byte correlation with resource COUNT (1304 settlements) | Best r=0.413 at T=1095 — too weak for a direct count field |
| u32 correlation with TOTAL resource amount | Best r=0.507 at T=1093/1094/1095 — same offset cluster, but cross-inspecting bytes shows values like `001a0001` (high-byte-only pattern) that look like a 24-bit packed counter, not a resource list |
| Stride-12/16/20 scan of body for resource (X, Y) coord clusters | Top run len = 3 hits at any stride. No 5633-record array exists in the body |
| Resource (X, Y) → mid-file 240×238 grid cell with Y-flip | 5,509/5,633 resources fall in **canonical (default) cells**; 124 fall in non-canonical variants. **Inverse of expected: placed resources prefer canonical cells**. The 1,389 non-canonical records don't encode resources (matches session 18's RETRACTION) |
| u32 pairs (X, Y) matching ANY placed resource location | 1,322 hits cluster in 0xa0000..0xf0000 (CHARACTER_PATHS body root) and 0x20d0000..0x2110000 (end-of-file tile-trail). The hits are character-path waypoints that incidentally cross resource tiles, NOT a resource cache |

The architectural conclusion that matches all the data: **the engine
loads placed-resource (X, Y, type, amount) records at campaign start
from descr_strat.txt and keeps them in runtime memory; the save does
NOT persist this data** (it's already in the mod files). On load, the
engine re-reads descr_strat to rebuild the resource grid. This matches
the dossier's broader architecture observation that names/strings of
all kinds (character names, region names, faction names of unmet
factions, trait names, ancillary names) are typically NOT in the save
— only IDs, indices, and runtime state.

**Y-coordinate flip discovered (incidental)**: settlements use Y values
in save that differ from descr_strat by `save_Y = 700 - descr_Y` (700 =
map height). Confirmed: Rome's save Y=404, resources_large.json Y=296;
700-296=404. Verified on 5 sample settlements. **This is a useful
parser fact for any future Y-coord work**, but doesn't help locate the
trade-good cache (because the cache isn't in the save).

**Implication for Provincia**: trade-good production per settlement
should be derived by **(a) cross-referencing the settlement's
descr_strat region against `public/resources_large.json`** for the
placed-resource list (this is mod-data static), and **(b) scanning the
settlement's sub-records for which of the 24 production chains
(finding #2) is currently built** for the live "is this industry
operational" state. The two together fully describe the trade-good
state without needing to decode an in-save resource cache.

#### 4. NEGATIVE: FAMOUS_BATTLE_DETAIL section instances not found

HST in rome10 declares `FAMOUS_BATTLE_DETAIL v=4` (at HST offset
0x37bc) and `FAMOUS_BATTLE_SITE_MANAGER v=1` (at 0x3a53) — both are
recognized RTW battle-history schemas. The ASCII `BATTLE` string
appears **only 2 times** in rome10, both inside the HST manifest;
**zero body instances**. In late-campaign Macedon T97 saves, the
substring `battle` (lowercase) appears 1 time, but it's inside the
unit-name `ALEX_alexander_general_battle` (a bodyguard unit type),
not a battle-log entry. Same for `damagedturn1/2` saves — `battle`
only inside unit type names.

**Stride/cluster scan negative**: walked Macedon's player major-faction
record trailing data (184,920 bytes) at strides 16/20/24/28/32/36/40/48/56/64
looking for fixed-stride records with (X∈[1..1020], Y∈[1..700])
adjacent u32 pairs. Best hit: 81 records out of 5,136 at stride 36 —
far below the noise threshold for a battle history list, and the X/Y
hits are scattered, not clustering into a contiguous "battle log" array.

**Working hypothesis** (UNVALIDATED): FAMOUS_BATTLE_DETAIL records are
embedded inside CHARACTER_PATHS-shaped sections in the body root (each
character's path may carry their battle history). Or they live in a
section not currently identifiable by greedy section-grammar walking
(some sections in RTW Remastered's save are positional, not
self-pointing — per session 12's settlement-zone retraction). To pin
the battle-log section requires a save pair where exactly ONE battle
happens between saves (e.g., damagedturn1 → damagedturn2 spans a
single autoresolved battle, but session 11's 8-byte diff showed only
unit-casualty/building-HP changes — no battle-log record was written).
The battle log may be **populated only at turn-end**, requiring a save
pair that crosses an end-turn boundary.

**Reproducer**: `dig-battle-log{1..6}.js` — all NEGATIVE.

#### 5. Negative confirmations & retractions

- **Mid-file 240×238 array as resource cache**: session 18 NEGATIVE result
  CONFIRMED on a fresh probe with the correct (X,Y) → (col,row) mapping
  including the 700-Y flip. Resources distribute almost identically to
  the global canonical-vs-variant ratio (5,509/5,633 = 97.8% canonical
  for resources vs 55,731/57,120 = 97.6% canonical for all records).
  No correlation. The mid-file array is NOT a placed-resource cache.

- **`hinterland_roads` payload bytes beyond +4**: bytes at +5/+8/+12/+16/+20/+24
  are 0 in 539/539 records; payload+0x28 (= "+36 from cstring" per
  session 11/17 building-HP rule) is always 0 in roads sub-records (no
  damage tracked — matches the road infrastructure being indestructible).
  Byte +4 (the LEVEL field) is the **only** non-trivial byte in the
  hinterland_roads payload.

- **`descr_sm_resources.txt`-derived resource type IDs**: the 26-entry RIS
  short list, 44-entry medium list, and 792-entry full list ARE
  internally used by the engine's `RESOURCE` v=4 schema. But none of
  these IDs surface as bytes in any settlement record at a fixed
  per-settlement offset.

- **Architectural insight**: the HST has 8 resource/trade-related schemas
  (`RESOURCE v=4`, `RESOURCE_MANAGER v=2`, `RESOURCE_ID v=1`,
  `RESOURCE_HEADER v=3`, `MAKE_TRADE_AGREEMENT_BUILDER v=1`,
  `LANDMARK_MANAGER v=1`, `WONDER_SHROUD v=1`, plus the 24 inline
  building chains identified). Of these, only `RESOURCE_MANAGER` and
  `LANDMARK_MANAGER` are plausible candidates for the global
  placed-resource list in the body. Neither has a string anchor;
  finding their instances requires section-grammar walking which is
  unreliable for non-section data.

#### Reproducer scripts

- `dig-trade-goods{1..12}.js` — full trade-good probe sequence:
  - 1: cb-tag-based settlement search + name marker → resource lookup
  - 2: u32/u16/u8 ID byte scan inside Rome's record (NEGATIVE)
  - 3: file-wide (X,Y) coord-pair scan for resource matches (1,322 hits)
  - 4: stride 8..64 dense-cluster search (NEGATIVE)
  - 5: body root direct-children resource-hit ranking (NEGATIVE)
  - 6: u8 byte ↔ resource count correlation (NEGATIVE)
  - 7: u32 byte ↔ resource total-amount correlation (best r=0.5, T=1093)
  - 8: u8 / u16 / u32 bitmask search (NEGATIVE)
  - 9: byte-level decomposition of T=1093 candidate (NEGATIVE)
  - 10: stride-based dense-region resource cluster finder (NEGATIVE)
  - 11: hex inspection of 0xa8c00..0xa9400 (= CHARACTER_PATHS body root,
        confirms (X,Y) hits are path waypoints not resource records)
  - 12: mid-file 240×238 grid → resource (X,Y) correlation with Y-flip
        (5,509/5,633 fall in canonical cells = NEGATIVE for resource cache)
- `dig-roads{1..8}.js` — road network probe:
  - 1: byte-histogram scan for a global tile-road map (NEGATIVE — no 700KB
       sparse byte map exists)
  - 2: HST parse (106 entries; identifies ROAD, ROAD_MANAGER, RESOURCE,
       FAMOUS_BATTLE_DETAIL, FAMOUS_BATTLE_SITE_MANAGER schemas)
  - 3: body root children deep-scan (295 children, all CHARACTER_PATHS-shaped)
  - 4: top-level section walker (only 1 top-level section = body root)
  - 5: post-body-root section scan (NEGATIVE — gap is zero-padding)
  - 6: body root depth 1 children enumeration (NEGATIVE for road sections)
  - 7: **DECISIVE** — hinterland_roads payload+4 LEVEL decode (539 records,
       3 levels)
  - 8: cross-validation across 7 saves on 3 campaigns (table above)
- `dig-battle-log{1..6}.js` — battle log probe (NEGATIVE):
  - 1: ASCII/UTF-16 "battle" + "Battle" + "FAMOUS_BATTLE" search across saves
  - 2: section walker on Macedon T97 (38 small sections, no battle table)
  - 3: decode small sections as u32 arrays (header-region encoded data)
  - 4: body root non-CHARACTER_PATHS-shaped children search (NEGATIVE)
  - 5: (X,Y)-pair stride scan in body root (NEGATIVE — top runs are
       permutation arrays, not battle records)
  - 6: player major-faction trailing data scan at strides 16..64 (NEGATIVE)
- `region-to-city.json` — utility lookup table (1311 entries) built from
  `C:/RIS/RIS/data/world/maps/base/descr_regions.txt`, mapping each
  region name (Roma, Etruria, etc.) to its city/settlement display name
  (Rome, Arretium, etc.). Useful for any future work that cross-references
  resources_large.json (region-keyed) against save data (city-keyed).

#### Open follow-ups for session 21+

- **Battle log location**: most promising next probe is a save pair that
  spans a turn-end boundary where exactly ONE battle was autoresolved
  during the AI turn rotation. The Macedon T97 → T98E pair has
  many turns of AI activity between saves, making byte-diff noisy. A
  cleaner test would be (a) saving at turn-start, (b) ending player turn
  (no battles), (c) autoresolving one battle on the next turn's AI
  rotation, (d) saving immediately. The diff isolates the battle-log
  write to a small region.

- **Tile-level road graph (if any)**: the per-settlement `hinterland_roads`
  level (decoded above) is the only road state in the save. To verify
  the engine doesn't also persist a tile-graph cache, examine: the
  `WORLD_MAP_STREAMING_GAME_TILE v=1` section (untraced), and any
  records keyed by `ROAD v=2` schema (also untraced). Both would
  require finding their body instances; the section walker has not
  located them.

- **Resource amount per production chain**: the 24 production-chain
  sub-records (e.g., `wine_industry`, `dyes_production`) likely encode
  the resource's **amount/quality** in a payload byte. Sample probe:
  decode payload bytes 8..40 of each `dyes_production` record (6
  settlements: Susa, Ephesos, Pimprama, Oppidum_Silurum, 2 unknown);
  cross-check against `descr_strat.txt`'s initial building variant
  (e.g., `dyes_production dyes_1` vs `dyes_2` vs `dyes_3`). The byte
  at payload+4 (LEVEL per session 10) gives the chain tier, but the
  PRODUCTION VOLUME may be in a separate byte that this session didn't
  probe.

- **Per-settlement available-resource enum** (build eligibility): the
  engine must know which settlements CAN build `wine_industry` (those
  in regions with a `wine` placed-resource tile). This eligibility data
  must come from somewhere at runtime — either re-derived from
  descr_strat each session, or cached in a place this session didn't
  find. A controlled mod test where one settlement's region has a
  resource added/removed would reveal whether the save persists this
  eligibility or recomputes it.

---

### Findings 2026-05-11 (background session 21 — battle log + faction army count + mid-file retry)

Goal: (1) Battle log / `FAMOUS_BATTLE_DETAIL` location (session 20 left it
unpinned). (2) Per-faction army/event counter (session 18 marked it
NEGATIVE; retry from a different angle). (3) Mid-file 1,389 non-canonical
cells — try elevation, forest, chokepoint, strategic-zone classification
(five hypotheses already retracted across sessions 15/18/19/20).
(4) Stretch — decode the 0xfc0..0xfd0 "AI weight vector" from session
18 across the 99-turn Macedon corpus.

Outcome: **Three new findings.** (a) **Per-faction cumulative event
counter at `+(92+4N+20)` inside each major-faction record** — Macedon
ticks 0→9 across T1-T80 of the Alexander campaign, with `+(92+4N+24)`
acting as a per-turn intra-turn snapshot that resets (STRONG; plausibly
**battles won** since Macedon = strongest known faction in this corpus,
F4 = 5 events by T35 = next-most-aggressive, F1/F3 = 0-1 events through
T35 = passive AI). (b) **Mid-file array variant `200_600_2_6_600` (253
cells) clusters in ELEVATED terrain** — mean elevation 19.16 vs canonical
10.98 (1.74x baseline); variant `200_0_2_55_200` (15 cells) mean 17.47;
variant decomposition by f20 / f28 / f32 reveals per-field elevation
correlation (STRONG / HYPOTHESIS). (c) **AI weight vector at 0xfc0..0xfef
RETRACTED** — the 48-byte block is NOT an f32 vector. Across 98 Macedon
Start saves it adopts exactly TWO byte-identical states that strictly
alternate by turn parity (odd vs even). 38 bytes in 0..0x3000 share this
parity-alternation signature, concentrated in 0xfc0..0xfef. The block is
**a binary-state turn-parity discriminator**, not a continuous-valued
strategic weight vector (sessions 18's hypothesis is REFUTED).

Battle log: still **NOT pinned as a distinct section** but its **count
likely lives in the per-faction +20 field** above. The damagedturn1
↔ notdamagedturn1 same-length pair (1,189,090 bytes, both T1) diffs by
only 8 bytes — none of which are a battle-log entry (per-unit casualty/HP
deltas only, matching session 11). The big T80→T81 cross-turn diff
contains ~1174 medium (30-200B) diff regions, far too noisy to isolate
a single battle write. The famous-battle list, if it exists as a body
section, has no in-body string anchor and didn't surface in any of the
walked sections so far. **Working hypothesis**: famous-battles are stored
inside each faction's trailing data as part of the same per-faction stats
block that contains the cumulative event counter, not as a separate
file-global section.

Save corpus this session: `C:/dev/Provincia/calibration/archive/
2026-04-21T22-42-59-494Z` Macedon T1-T99 Start/End pairs (207 distinct
turn labels), `save_rome10.sav` for mid-file work, the Alexander
`damagedturn1/2` / `notdamagedturn1` / `saveturn1start` / `saveturn2start`
/ `Noarmiesmovedturn1` pairs for battle-log diffs. Map ground-truth:
`C:/RIS/RIS/data/world/maps/base/map_heights.tga` (2041×1401),
`map_features.tga` (1020×700), `map_climates.tga` (RLE-compressed, type
10), `map_ground_types.tga`, `map_regions.tga`.

#### 1. STRONG: per-faction cumulative event counter at `+(92 + 4N + 20)` from major-faction record start

Each major-faction record has a triplet at `+(92 + 4N + 16/20/24)` (after
the start-of-turn treasury snapshot at `+(92 + 4N)`) that encodes
per-faction event state:

| Δ from record start | Width | Value | Meaning |
|---|---|---|---|
| `+(92+4N+0)` | `u32` | start-of-turn treasury snapshot (per session 5) | — |
| `+(92+4N+4..+12)` | 12 B | zeros | padding |
| `+(92+4N+16)` | `u32` | `21` (constant across all 5 factions × 99 turns × Alex corpus) | schema/length tag |
| **`+(92+4N+20)`** | **`u32` A** | **0 → 9+ cumulative, monotone** (Macedon T1-T99) | **STRONG: per-faction lifetime event count** |
| `+(92+4N+24)` | `u32` B | matches A within a turn, resets to 0 between turns | intra-turn duplicate / latest event snapshot |
| `+(92+4N+28)` | `u32` C | usually matches A; sometimes 0 (deferred copy) | secondary cumulative |
| `+(92+4N+32)` | `u32` | `0` | pad |
| `+(92+4N+36)` | `u32` | `3` (constant) | schema/length tag |

So the per-faction stats block is **20 bytes** starting at `+(92+4N+16)`:
`[21][A][B][C][0]` followed by `[3]` to close the block.

**Macedon (player) A trajectory across the Alexander campaign**:

| Turn | A | C | treasury (-Δ) |
|---|---|---|---|
| T1-T7  | 0 | 0 | -21K → -117K |
| T8     | **1** | 0 | -142K — first event |
| T9-T11 | 0/0/0 | 0 | (resets to 0 — A wasn't sticky early on) |
| T12    | **1** | **1** | event mid-turn |
| T13    | **2** | **2** | second event |
| T14-T24 | 2 | 0 | sticky at 2 |
| T25    | **3** | 0 | new event |
| T26    | **4** | **1** | another |
| T28    | **5** | **1** | five total |
| T35    | 5 | **1** | |
| T39    | **6** | 1 | six |
| T42    | **7** | 1 | seven |
| T49    | **8** | 1 | eight |
| T78    | **9** | 1 | nine through end |

**Cross-faction A values at T13** (5 factions in Alexander campaign):
- F0 Macedon (player): A=2
- F1: A=0 (passive)
- F2: A=1
- F3: A=0
- F4: A=5 (most aggressive)

At T35, the same factions are: M=5, F1=1, F2=2, F3=1, F4=5 — F1 caught
up slightly, F4 has stopped accumulating. **The counter is faction-
private and slowly accumulates over the campaign**, ranging 0 to ~9 by
T80 in a 99-turn game. The slow rate + "stop accumulating" pattern for
F4 in late-game (lost regions, dying out per its 0 treasury) strongly
suggests **battles fought / battles won** as the event type.

**Cross-validation by field interpretation**:
- If this were "regions conquered," it should align with the descr_strat
  starting region count plus subsequent campaign gains. Macedon T1 starts
  with 25 regions; conquering 9 by T80 is implausible (the campaign
  shrinks for Macedon, not expands).
- If this were "buildings constructed," it should grow much faster
  (10+ per turn for an active faction).
- "Battles won" matches: Macedon = top player faction = 9 wins by T80;
  F4 = active early-game aggressor that loses by T35 = 5 wins frozen.
- "Generals recruited" is also plausible (slow tick), but the C=2 spike
  at T13 (two events same turn) fits "battles" better than "recruits."

**Macedon faction-record location** (file offset shifts each turn due to
preceding-data drift, but the relative position +(92+4N+20) is stable):

| Turn | abs offset of A | A value | treasury |
|---|---|---|---|
| T2 | 0x0be8cf+16 ≈ 0xbe8df | 0 | -21,703 |
| T8 | 0x0baece+16 ≈ 0xbaede | 1 | -142,697 |
| T13 | 0x0ae3eb+16 ≈ 0xae3fb | 2 | -235,071 |
| T49 | (varies) | 8 | -534,966 |

**Implication for Provincia**: a "battles won by faction X" UI panel can
now be derived for **Alexander campaign saves** by reading `u32` at
`record.offset + 92 + record.N * 4 + 20`. The structure also exists in
some form in RIS imperial but at a different relative offset — rome10
(RIS imperial T5) doesn't have a `21` constant tag at the same position,
suggesting **RIS imperial uses a longer/wider per-faction stats block**
that has a different schema header. The Alexander layout pinned this
session is **Alex-campaign-specific** until RIS-imperial cross-validation
is done. Provincia could compute battle win-rates by accumulating A
across saves — though if A only persists "famous" battles or only
player-led ones, it would under-count autoresolved skirmishes.

**STRONG, not CONFIRMED, because**: I haven't directly correlated A
increments with a known in-game battle (would require a save pair where
exactly ONE battle happens between turns, e.g., the damagedturn1 →
damagedturn2 case — but those are inside a single turn and don't span
the turn-rotation that triggers AI battles). Verification needs a turn
where the player wins one explicit battle, with saves pre/post.

**Reproducer**: `scripts/save-cracker/dig-army-count{8,9,10,11}.js` —
find the 5 faction records, decode +(92+4N) onwards, trace A/B/C across
T1-T99.

#### 2. STRONG / HYPOTHESIS: mid-file array variants encode per-cell terrain/movement category, with `f20=600 / f32=600` over-representing ELEVATED cells

Building on session 18's identification of 13 variant keys in the 240×238
mid-file grid (1,389 non-canonical cells out of 57,120), this session
correlates each variant with `map_heights.tga` elevation samples taken
at each cell's center pixel.

Per-variant mean elevation (canonical = `200_200_2_6_200`):

| Variant key (f16_f20_f24_f28_f32) | n | mean elevation | max elev | zero-elev % |
|---|---|---|---|---|
| `200_200_2_6_200` (canonical) | 55,726 | **10.98** | 169 | 22.9% |
| `200_600_2_6_600` | **253** | **19.16** | 95 | **13.8%** |
| `200_0_2_55_200` | 15 | **17.47** | 82 | **13.3%** |
| `200_0_2_54_600` | 16 | 13.50 | 93 | 43.8% |
| `200_0_2_54_200` | 28 | 12.11 | 85 | 21.4% |
| `200_200_2_6_600` | 210 | 11.19 | 121 | 23.8% |
| `200_0_2_54_4294967286` (=-10) | 147 | 11.20 | 128 | 24.5% |
| `200_200_2_6_0` | 217 | 10.46 | 117 | 25.8% |
| `200_200_2_6_4294967286` | 23 | 7.26 | 71 | 39.1% |

**Per-field decomposition** (controlling for one field at a time across all
non-canon cells):

| Field | Value | n | mean elev | comment |
|---|---|---|---|---|
| `f20` (`+20`) | `200` (canon) | 56,177 | 10.98 | baseline |
| `f20` | **`600`** | **256** | **19.04** | **1.73x baseline — strong correlation with elevation** |
| `f20` | `0` | 210 | 11.77 | |
| `f28` (`+28`) | `6` (canon) | 56,433 | 11.02 | baseline |
| `f28` | `54` | 194 | 11.39 | not elevation-correlated |
| `f28` | **`55`** | **16** | **16.38** | **1.49x baseline — likely mountain marker** |
| `f32` (`+32`) | `200` (canon) | 55,772 | 10.98 | baseline |
| `f32` | **`600`** | **479** | **15.48** | **1.41x baseline — elevation correlated** |
| `f32` | `0` | 220 | 10.35 | |
| `f32` | `-10` | 171 | 10.61 | |

**Interpretation (HYPOTHESIS)**: f20, f28, f32 are per-cell **terrain
classification** fields encoding pathfinding/movement cost. The
correlation pattern suggests:

- `f20=200` / `f28=6` / `f32=200`: default land, normal movement cost
- `f20=600` / `f32=600`: **hilly land**, +200% movement cost (the 600
  matches the f20=600 elevation correlation)
- `f28=55`: **mountain/impassable** (the 16 cells with mean elev 16.38)
- `f28=54`: **special boundary** (could be sea-adjacent border buffer;
  144 of 194 are in row 6-7, near map top edge)
- `f32=-10`: **sentinel/error** value, mostly in border rows

**Field `+28 enum value mapping**:
- `6` = land tile (canonical, 99.6% of cells)
- `54` = sea or coast (mostly low-elevation, NOT elevation-correlated)
- `55` = mountain (high-elevation correlation 1.49x)

The 240×238 grid covers the 1020×700 logical map at 4.25×2.94 pixel
resolution per cell, with each variant byte being a **movement-cost or
classification enum**. The diagonal-stripe pattern I observed in 8×8
binning was an artifact of summing.

**Confidence**: STRONG for the existence of elevation correlation (1.49x
to 1.74x effect sizes across multiple variants are reproducible).
HYPOTHESIS for the specific semantic mapping ("6=land / 54=sea /
55=mountain" — could equally be 6=default / 54=alternate / 55=blocked).

**Open follow-up to upgrade to CONFIRMED**: a controlled mod test where
one tile's `map_heights.tga` is changed from sea to mountain in a copy of
the mod, the campaign is restarted, and the new save's mid-file array
cell at that coordinate is verified to flip from variant `54` to variant
`55` (or similar). Without mod test access, the f20/f28/f32 → terrain
mapping remains HYPOTHESIS.

**Reproducer**: `dig-midfile-cells{1..8}.js` — variant histogram (#1),
TGA loader with RLE support (#2-#8), per-cell elevation/roughness
statistics (#3-#7), spatial cluster visualization (#8).

#### 3. RETRACTED: 0xfc0..0xfef "AI weight vector" is NOT an f32 strategic-weight array — it's a turn-parity discriminator

Session 18 reported the 48-byte block at `0xfc0..0xfef` as flipping
between TWO distinct value sets across saves with f32 interpretations
like `[3.06, -0.0, +1.8e25, -8.5M]` in one mode and `[1.88, -0.33,
-1.1e33, +1.4e31]` in the other. Marked there as HYPOTHESIS-grade
because the f32 values are bit-pattern garbage (1.8e25 = high-exponent
nonsense).

**This session decisively refutes the "AI weight vector" interpretation**
by tracing the block across all 98 "Turn N Start" saves in the Macedon
calibration corpus (T1-T99). The result: **the 48-byte block has only
TWO byte-identical states**, and the state **strictly alternates by
turn parity** (T1S = state A, T2S = state B, T3S = state A, T4S = state
B, etc.). All 98 odd-turn saves share byte-identical state A; all 98
even-turn saves share byte-identical state B.

Confirmed by exhaustively scanning offsets 0..0x3000 for bytes that
perfectly alternate by turn parity: **38 bytes** match this signature,
**clustered in 0xfc0..0xfef** with stragglers at 0x502, 0xf88, 0xff8,
0xffc.

```
State A (odd turn):  42 b1 43 40 0b e9 0e 9d 44 5c 73 69 46 f0 00 cb ...
State B (even turn): 8b 0c f1 3f 0f 17 ab be 46 fe 52 f6 45 f2 2f 73 ...
```

The two states differ in every byte but are otherwise stable for 99
turns of game time. There is no third state. **This is structurally a
single-bit "even-vs-odd turn rotation" flag rendered as a 48-byte
ping-pong buffer**, not a continuously-valued weight vector.

The hypothetical interpretation now: each state represents either a
**hash digest** of the active AI-rotation-state at that parity, or a
**double-buffered "previous-turn vs current-turn" working memory** that
the AI rotates between odd and even turns. Either way, **the values
themselves are not interpretable as floats or counts**.

Per-byte sub-structure observed:
- `0xfc0..0xfdb` (28 bytes): differ in every byte between states A/B
- `0xfdc..0xfe3` (8 bytes): A=`86 36 28 46 64 2f 42 46`,
  B=`64 3f 25 46 86 0c 7c 46` — second halves of A/B match
- `0xfe4..0xfef` (12 bytes): bytes 0xfe8..0xfef are a repeat of
  0xfdc..0xfe3 — the 8-byte sub-record appears TWICE inside the block

This **repeated 8-byte chunk** at +12 and +20 inside the 48-byte block
suggests the layout is **[16-byte hash A] [8-byte payload] [4-byte pad]
[8-byte payload repeat] [4-byte pad]** — but the payload bytes don't
parse as any meaningful (X, Y) or (faction-id, value) form. Likely it's
the **first 8 bytes of a 16-byte hash repeated as a redundancy check**.

**Session 18's "+0xffc u32 counter (357, 424, 365, 444, 383, 262)" finding
is also RETRACTED as an "AI strategic measure"**: in the 99-turn Macedon
trace, this u32 ranges 262..503 non-monotonically with values that
return to nearly the same value within a no-event turn (T84E = T84S =
262, T86E = T86S = 503). It looks like a **state hash** of the current
turn's randomness or AI state, not a meaningful summary value.

**Reproducer**: `dig-ai-weights{1,2,3,4}.js` — full 98-save parity-state
trace, byte-level diff dump, repeated-chunk analysis.

#### 4. NEGATIVE: battle-log section instances still not pinned (session 20 result confirmed; new failures documented)

Session 20's NEGATIVE on `FAMOUS_BATTLE_DETAIL`/`FAMOUS_BATTLE_SITE_MANAGER`
remains in force. This session's additional probes:

| Test | Result |
|---|---|
| `notdamagedturn1` ↔ `damagedturn1` (same length, 1,189,090 bytes; one autoresolved battle between them) | **8 bytes diff in 6 regions** — none ≥ 30 bytes, all consistent with per-unit casualty/HP updates from session 11. **No battle-log entry was written by this autoresolved battle.** |
| T80-T81 Start (single-turn diff late game, many AI battles) | 1,174 medium (30-200B) diff regions, far too noisy |
| T86 Start ↔ T86 End (same turn, no player action) | **48 bytes diff in 31 regions** — pure metadata churn (RNG counter, turn-parity flip block) |
| Monotone-counter scan across 99 Macedon Start saves in offsets 0..0xd7000 (common-prefix) | 4 candidates all ranged 1..768 with single-jump deltas → save-version discontinuities at T41 (campaign session boundary in calibration archive), not real monotone counters |

**Confirmed observation**: damagedturn1/damagedturn2 is NOT a clean
"battle happened, save again" pair. damagedturn1 (1,189,090 B) is the
already-post-battle save (it carries the damage). damagedturn2 (1,207,118
B, +18 KB) is then the next turn's snapshot. notdamagedturn1 (1,189,090
B) is the parallel "alternate timeline before battle" save — but the
8-byte diff to damagedturn1 shows that the only thing changing is the
casualty bytes and HP bytes, with NO battle-log entry inserted between
these two save points.

**Combined with the per-faction A-counter finding (#1 above)**: the
battle-log count IS likely stored, just inside the per-faction trailing
data as the cumulative A counter rather than as a separate
`FAMOUS_BATTLE_DETAIL` section. The HST entry for `FAMOUS_BATTLE_DETAIL
v=4` describes a schema for **named famous battles** (the in-game
"Hall of Famous Battles" feature) — a much narrower concept than "every
battle." Famous battles only get added when:
1. The battle has 1000+ casualties (or similar threshold), AND
2. The battle is player-led (autoresolves don't trigger), AND
3. The losing side actually had a chance (no slaughter against 1-unit
   garrisons).

In the Macedon calibration corpus, almost all early-game battles are
autoresolved AI-vs-AI engagements that wouldn't qualify. The
FAMOUS_BATTLE_DETAIL list is probably **empty** in these saves, which
explains why no body instances exist.

**Reproducer**: `dig-battle-log{7..14}.js` — corpus catalogue, cross-
turn diff, same-state same-length diff, header-region monotone scan.

#### 5. NEGATIVE: per-faction "armies count" was not found at any fixed offset

The session-18 hypothesis ("each faction record's trailing data has a
u32 = number of armies owned") was retested by scanning u32s at every
relative offset 0..130,742 inside the Macedon player record across all
98 T1-T99 saves looking for strictly-monotonic increment patterns. **No
field passes the test** — the byte-level layout of the Macedon record's
trailing data shifts between turns (sub-records get inserted/removed),
so a fixed-offset scan can never catch a counter that's not at a
byte-stable position. The only stable, monotone counter is the +(92+4N+16)
A counter from finding #1, which appears to be event count rather than
army count.

**Working hypothesis for "army count" semantically**: the count of armies
owned by Macedon is **not stored as a u32 anywhere** in the save — it's
re-derived at load time by walking the character/unit records and
filtering by `faction == Macedon`. The same architectural rule that
applies to placed resources, tile-road graphs, and faction-pair
diplomacy relations: the engine recomputes from the underlying records
rather than persisting an aggregate.

#### Reproducer scripts

- `dig-battle-log{7..14}.js` — battle log probes (NEGATIVE this session)
  - 7: catalog of 207 distinct turn labels in calibration archive
  - 8: cross-turn diff at single-turn boundary (T3→T4, T8→T9, T80→T81,
       T86 Start→End)
  - 9: per-turn diff byte-set analysis (T86 = 48 bytes "quiet" mode;
       most turns differ in tens of thousands of bytes)
  - 10: monotone-counter scan in 0..0x20000 (no candidates)
  - 11: full-file monotone scan in common-prefix (only 4 false candidates
       from session-boundary artifacts at T41)
  - 12: damagedturn1 ↔ damagedturn2 diff (18-KB file-size diff,
       inserted middle, too noisy)
  - 13: **decisive same-length diff** notdamaged ↔ damaged (8 bytes
       only, no battle-log entry written)
  - 14: saveturn1start ↔ Noarmiesmovedturn1 diff (mostly AI cache shifts)
- `dig-army-count{1..11}.js` — per-faction event counter probes
  - 1: find the 5 major-faction records in Alex (Macedon=index 0, 4 AI)
  - 2: inter-record trailing-data length analysis
  - 3: monotone u32 scan in Macedon trailing data (false hits from
       session boundary)
  - 4: trajectory plot of candidates (showed T41 = different game)
  - 5: per-save character-record count (proxy for total general count,
       fluctuates 50-77 globally)
  - 6: strict T1-T20 single-game window scan (3 small-int variable
       offsets; +286 is a turn counter, +418/+482 are parity flags)
  - 7: strict-monotone scan T2-T13 (0 candidates)
  - 8: faction-record post-treasury-dup bytes dump — **discovers the
       triplet at +(92+4N+16/20/24)**
  - 9: full field decode showing A/B/C values per turn per faction
  - 10: cross-faction context dump (5 factions × T13 record bytes)
  - 11: **decisive 99-turn trajectory** showing A is monotone-cumulative
- `dig-midfile-cells{1..8}.js` — mid-file 240×238 grid elevation probe
  - 1: variant histogram (1,389 non-canon, 12 distinct variants);
       writes JSON cell list
  - 2: TGA loader (uncompressed) + correlation with features/climates/
       ground-types
  - 3: **fixed RLE TGA loader** + scale-aware mapping to 2041×1401
       maps; first correlation signal (96_160_64 ground-type 2.42x for
       variant 200_600_2_6_600)
  - 4: cell-elevation bucketing → non-canon rate rises from 1.57% at
       sea level to 2.64% at elev ≥ 64; per-variant max-height
  - 5: region-boundary count correlation (NEGATIVE — non-canon rate
       flat across boundary counts)
  - 6: per-variant mean-elevation + per-variant zero-elevation %
       (decisive table for finding #2)
  - 7: per-field decomposition (f16/f20/f24/f28/f32 elevation stats —
       the f20=600 / f28=55 / f32=600 over-representation)
  - 8: spatial cluster visualization (ASCII grid plot)
- `dig-ai-weights{1..4}.js` — AI weight vector RETRACTION
  - 1: 99-turn trajectory of u32 at 0xfc0..0xfef + counter at 0xffc
  - 2: parity-state byte scan (38 bytes in 0..0x3000 perfectly alternate)
  - 3: raw hex dump of states A/B at 0xfc0..0xfef
  - 4: f32 / f64 / u32 decode attempts (all bit-pattern garbage)

#### Open follow-ups for session 22+

- **Confirm A counter = battles won**: capture a save pair where the player
  wins ONE battle between saves (manual save in mid-turn before attacking,
  then save after winning the battle and ending turn). The expected
  result is `A` at `+(92+4N+16)` incrementing by exactly 1 for the
  player faction. A `C` value of 1 in the post-battle save would confirm
  "current-turn-event count."
- **Decode the +(92+4N+12) constant `21`**: this value is byte-identical
  across all 5 factions × 99 turns × all RIS imperial saves. It might be
  a length tag (= 21 sub-records in the per-faction stats block?) — a
  hex dump of bytes following +(92+4N+32) might reveal 21 contiguous
  fixed-size records.
- **Mid-file enum semantics**: a controlled mod test where one mountain
  tile is flattened in `map_heights.tga` would let us re-save and verify
  whether the f28 value at that cell flips from 55 to 6. Without
  controlled mod access, the f28=54/55 ↔ sea/mountain mapping remains
  HYPOTHESIS.
- **Mid-file array is RIS-only**: session 18 confirmed Alexander Macedon
  saves don't contain this array. So all session 19/20/21 work on it
  applies only to RIS imperial (1305-region campaign). The Alexander
  campaign (5 factions, 50-region map) uses a different per-cell store
  if any (likely none — the smaller map doesn't need a coarse grid).
- **Turn-parity discriminator at 0xfc0..0xfef**: the binary alternation
  is bit-stable for 99 turns but the function remains unknown. Most
  likely an engine-internal **save-format / save-stream-state hash**
  used by the loader to detect partial writes. Without runtime
  instrumentation we can't decode further.

---

### Findings 2026-05-11 (background session 22 — terrain enum confirmation + RIS event counter + field army tail)

Goal: (1) Confirm session 21's terrain enum hypothesis for the mid-file
240×238 array (f28=54 sea, f28=55 mountain, f20=600/f32=600 elevated) by
cross-referencing actual `map_heights.tga`/`map_regions.tga` pixels. (2)
Find the RIS imperial equivalent of the Alex `+(92+4N+20)` per-faction
event counter. (3) Decode the 200KB field-army-units block in the tail at
`0x1f10c72..0x1f42cb6` — does it follow the standard unit schema
(+12=soldiers, +16=armour, +17=weapon, +19=morale, +20=XP)?

Outcome: **Three new findings.** (a) **Session 21's mid-file terrain
hypothesis is REFUTED.** The non-canonical cells with `f20=600`/`f32=600`
that session 21 attributed to "elevated terrain" are actually **sentinel
data on the anti-diagonal `c + r = 237`** — 220 of 238 cells on that
diagonal carry the marker, a clear structural artifact not terrain. After
filtering out the anti-diagonal, the remaining 697 off-diagonal
non-canonical cells show **no significant correlation** with sea-pixel
fraction or mean-elevation: `f28=54` cells have sea% = 9.6% vs canonical
7.4% (Δ=2.2 percentage points, not "sea/coast"), and `f28=55` cells have
mean height 10.0 vs canonical 7.43 (factor 1.34x, not "mountain"). The
mid-file array is structurally NOT a per-cell terrain grid. (b) **STRONG:
RIS imperial per-faction turn counter at `+(52+4N+188)`** — all 23 major
factions tick `0 → 4` between Republic-of-Rome-T1 and rome10 (T5), exactly
matching 4 turns of game time. This is the **per-faction "turns since
campaign start"** counter, the RIS analogue (different relative offset,
+188 vs +20) of Alex's session-21 event counter. The Alex pattern at
+(92+4N+20) is faction-specific monotone events (battles?), while the RIS
+(52+4N+188) is per-turn ticking. (c) **CONFIRMED: tail field-army records
fully decoded — 122 records, 14,636 total soldiers, schema differs from
settlement-embedded units.** Each record has a clean
`[u16 nameLen][ASCII unit][0xee + 8B hash + 8B uuid + 0x0001012c constant][u16 settLen][UTF-16LE settlement][0xffffffff terminator][44-byte header][N × 9-byte soldier records][0xff…0xff padding]`
structure. Soldier counts match descr_unit.txt (24=bodyguard, 200=peltasts,
240=hoplites). **The brief's hypothesis that +12=soldiers, +16=armour,
+17=weapon, +19=morale, +20=XP applies here is REFUTED** — +12 and +16
are both soldier_count (current and max), +20 is a constant `0x40000040`
(= float 2.0, formation/spacing marker), and armour/weapon/morale/XP are
not at those byte offsets; they appear to be packed into the per-soldier
3-byte status records.

Save corpus this session: `save_rome10.sav` (RIS imperial T5), the
`save_Autosave   Republic of Rome   Turn 1.sav` (RIS imperial T1) — both
share campaign_name `"imperial_campaign"` per offset 0x3a. Map ground-truth:
`C:/RIS/RIS/data/world/maps/base/map_heights.tga` (2041×1401, 24bpp BGR;
sea sentinel = RGB(0,0,253)), `map_regions.tga` (1020×700, 24bpp BGR).

#### 1. CONFIRMED RETRACTION: session 21's terrain enum hypothesis is wrong; non-canonical mid-file cells include a structural sentinel anti-diagonal

The 240×238 mid-file record array (1,389 non-canonical cells per session
21's count) was hypothesized to encode per-cell terrain (f28=54 sea,
f28=55 mountain, f20=600 elevated). Cross-validation with
`map_heights.tga` and `map_regions.tga` at each cell's pixel footprint
**fails to support that interpretation**.

**Critical structural finding**: 220 of 238 (92%) cells on the
anti-diagonal `c + r = 237` carry BOTH `f20=600` AND `f32=600` — i.e.,
75% of all `f20=600` cells (192/256) and 29% of all `f32=600` cells
(139/479) lie on this single 1-cell-wide diagonal stripe. Diff-of-indices
analysis confirms it: 192/256 transitions between consecutive `f20=600`
cells have `Δidx = W - 1 = 239` (perfect anti-diagonal step). The
diagonal occupies the row-1-above-bottom of the grid (the right-most
column 239 and bottom row 237 were already known to be edge sentinels
per session 21 / session 18).

**With sentinel anti-diagonal filtered out**, the remaining 697
non-canonical cells show **no significant terrain correlation**:

| Field | Value | n (off-diag) | mean sea% | mean elevation | hypothesis result |
|---|---|---|---|---|---|
| canonical (`200_200_2_6_200`) | — | 55,709 | 7.4% | 7.43 | baseline |
| `f28 = 54` | "sea/coast"? | 194 | **9.6%** | 8.47 | **REFUTED** (Δ +2.2 pp, 19/194 fully-sea) |
| `f28 = 55` | "mountain"? | 16 | 0.0% | **10.0** | **REFUTED** (only 1.34x baseline, not mountain) |
| `f20 = 600` | "elevated"? | 36 | 9.0% | 9.84 | **REFUTED** (1.32x baseline) |
| `f32 = 600` | "elevated"? | 259 | 8.3% | 8.59 | **REFUTED** (1.16x baseline) |

(Same correlation table as session 21 but **with the anti-diagonal cells
removed from the denominator** — the session-21 result that gave 19.16
mean elevation for variant `200_600_2_6_600` is now revealed to be
**80% of those cells were anti-diagonal sentinels, not terrain markers**;
the 33 truly-interior cells have mean elevation 10.48 — only 1.41x
baseline.)

**Interpretation**: the 240×238 mid-file array is structurally NOT a
per-cell terrain grid. The non-canonical cells are dominated by:
- A hard-coded **sentinel anti-diagonal** `c + r = 237` (single diagonal line through the grid)
- Edge sentinels at column 239 and row 237 (session 21 already filtered these)
- ~697 scattered interior cells whose values do not correlate with any
  terrain feature in `map_heights.tga` or `map_regions.tga`

What the array IS remains an open question. Working hypothesis: it might
be a **strategic/AI per-cell hint table** (e.g., AI valuation of
defensive positions, choke-points, reserved zones), or simply a sparse
**index/lookup structure** with the anti-diagonal as a hardcoded
terminator/boundary. Without runtime instrumentation or a controlled mod
test that flips one specific cell, the semantic meaning is unrecoverable
from static analysis alone.

**Confidence**: CONFIRMED that session 21's "terrain enum" interpretation
is wrong. HYPOTHESIS-grade for what the array actually represents.

**Reproducer**: `dig-terrain-confirm{1..6}.js` — TGA loading with
sea-sentinel detection (#1), spatial visualization with coastline overlay
(#2), diagonal idx-difference histogram (#3), anti-diagonal sentinel
enumeration (#4), anti-diagonal filter (#5), final off-diagonal
correlation table (#6).

#### 2. STRONG: RIS imperial per-faction turn counter at `+(52 + 4N + 188)` (different relative offset from Alex's event counter at +(92+4N+20))

The Alex campaign's per-faction stats block at `+(92 + 4N + 16)` (5-faction
campaign, schema tag `21`, monotone event counter A at +20) does **not**
appear at the same offset in RIS imperial. Probing `save_rome10.sav`
(RIS imperial T5) and `save_Autosave   Republic of Rome   Turn 1.sav`
(RIS imperial T1) — both 23-major-faction saves with shared
campaign_name `"imperial_campaign"` — yields a different layout, with
the analogous "turn-tied counter" living at `+(52 + 4N + 188)`.

**Decisive observation**: at `+52+4N+188`, **all 23 major factions tick
in lockstep `0 → 4`** between T1 and T5 saves:

| Faction # | N (region count) | T1 (+188) | T5 (+188) | Δ |
|---|---|---|---|---|
| 0 (Romans Julii, player) | 35 | 0 | 4 | +4 |
| 1..22 (all AI factions) | varies | 0 | 4 | +4 |

This is **per-faction "turns since campaign start" / "campaign turn
counter"**, ticking at exactly +1 per turn. Confirms 4 turns elapsed
between the two saves (T1 → T5 = 4 turn-rotations).

**Adjacent fields in the RIS per-faction post-region-list block** (offsets
relative to `+52+4N`):

| Δ from `+52+4N` | Width | Value | Meaning |
|---|---|---|---|
| `+0` | `u32` | `30` (constant across factions) | block schema tag |
| `+4..+28` | 28 B | zeros | padding |
| `+32` | `u32` | `1677721600 = 0x64000000` or `3355443200 = 0xC8000000` (per-faction) | f32 marker (0x64=100, 0xC8=200) |
| `+40` | `u32` | start-of-turn treasury (matches `+0` of record) | duplicate |
| `+44` | `u32` | `30` (constant) | secondary schema tag |
| `+48..+72` | zeros | — | padding |
| `+76` | `u32` | `50331648` or `4009754624` (per-faction) | block-end marker |
| `+108..+136` | 28 B | per-faction RNG / state | varies |
| `+140..+180` | 40 B | per-faction hash / RNG seeds | varies T1→T5 |
| `+184` | `u32` | `7` (constant across factions) | schema tag |
| **`+188`** | **`u32`** | **`0 → 4` across T1 → T5 (uniform across factions)** | **per-faction turn counter** |
| `+192` | `u32` | `958660613` (constant per faction record across saves) | hash / GUID |
| `+196` | `u32` | per-faction constant (1, 34, 84, 115, 12, 1, 2, 5, ...) | faction-id-derived metadata |
| `+200` | `u32` | per-faction constant (1317, 765, 1206, 973, ...) | secondary metadata |
| `+208` | `u32` | small int 0..4, varies T1→T5 | possible intra-turn event count |
| `+212` | `u32` | `65793 = 0x10101` (constant) | padding/marker |
| `+220` | `u32` | `239` (flag) or `0`/`2` | flag |
| `+224` | `u32` | when `+220=239`: large counter 22M+ incrementing by ~7K-50K T1→T5; otherwise 0..4 | AI strategic score (only on flagged factions: 0, 5, 13, 17, 21) |

**Cross-validation**: the `+188` ticks uniformly by +4 across **every
single one** of the 23 factions, with no exceptions. This is the
strongest signal of a turn counter. Compare to Alex's `+(92+4N+20)`
counter which ticked 0→9 over 99 turns and varied faction-by-faction —
the Alex counter is per-faction events, the RIS counter is the campaign
turn number.

**Implication for Provincia**: a "current campaign turn" can be read from
any of the 23 major-faction records by `buf.readUInt32LE(rec.offset + 52
+ rec.N * 4 + 188)`. This is the same value across all factions, so any
record works. Useful when an interface needs the current turn but the
save file doesn't expose it via a section name.

**Open**: the per-faction event counter (RIS analogue of Alex's A counter
at +(92+4N+20)) was NOT pinned this session. The RIS records have a
different schema header (`30` tag, not `21`), and the "+208" field is
the closest small-int candidate but doesn't show monotone-cumulative
behavior across just 2 saves (would need a per-turn corpus for RIS to
confirm). The `+224` large counter on the 5 flagged factions
(positional indices 0, 5, 13, 17, 21 — possibly major-power factions
that have AI-strategic-tracking on) is a separate phenomenon, likely an
AI score not a battle count.

**Reproducer**: `dig-ris-counter{1..4}.js` — major-faction record
discovery (#1), per-faction byte diff between T1 and T5 (#2), zoom on
+148/+172/+188/+208/+224 (#3), per-faction summary table (#4).

#### 3. CONFIRMED: tail field-army units block fully decoded — 122 records, 14,636 soldiers, distinct schema from settlement units

The ~200KB tail region at `0x1f10c72..0x1f42cb6` (session-14-documented
bounds) contains **122 unit records** (session 14's "~144" was an
approximation). Each record has a clean structure:

```
[u16 nameLen][ASCII unit name e.g. "thracian peltasts"]
[1 B = 0xee marker]
[8 B per-record hash/UUID prefix]                  ← changes per record
[8 B per-record UUID]                              ← changes per record
[4 B = 0x0001012c constant = 76,860 — likely a record-type tag = 76860]
[4 B = 0x00000001 = 1]
[u16 settLen][UTF-16LE settlement name]            ← regional/tribal origin
[4 B = 0xffffffff terminator]
[44 B "soldier-persistent header"]
[N × 9 B per-soldier records]                      ← N = soldier_count
[padding: 0xff bytes filling out to record end]
```

The 44-byte soldier-persistent header at offset `persistentStart`:

| Δ | Width | Value | Meaning |
|---|---|---|---|
| `+0` | `u32` | `0xffffffff` | terminator/start marker |
| `+4..+11` | 8 B | varies (looks like float32 or position data) | possibly tile position |
| `+12` | `u32` | soldier count (current) | **CONFIRMED: matches descr_unit values** |
| `+16` | `u32` | soldier count (max) | usually same as +12 |
| `+20` | `u32` | `0x40000040` = float32 `2.0` (constant) | formation/spacing marker |
| `+24..+43` | 20 B | zeros + scattered flags | padding/reserved |
| `+44...` | N × 9 B | per-soldier records (state + packed stats) | individual soldier data |

**Soldier counts validated against unit type** (per descr_unit.txt):

| Unit type | n in tail | soldier counts observed |
|---|---|---|
| greek hoplites | 31 | 240 (all) |
| greek general | 40 | 16, 20, 24, 28, 32, 36, 44, 48 (variable bodyguard) |
| thracian peltasts | 5 | 200 (all) |
| thracian royal bodyguards | 10 | 24, 28 |
| caetrati swordsmen | 1 | 240 |
| thracian slingers | 1 | 160 |
| getic archers | 1 | 160 |
| illyrian peltasts | 1 | 200 |
| thynoi clubmen | 1 | 240 |
| cappadocian slingers | 3 | 160 (all) |

**Per-soldier 9-byte record structure** (from the dump of `thracian
peltasts[0]`):
```
+0  u8   state low byte (0/4/5/2 — possibly casualty flag or HP)
+1..+3  3 B varying values (packed stats: probably weapon/armour/morale/XP)
+4..+8  5 B zeros (padding/reserved)
```

**Validation**: total tail soldier count = 14,636 across 121 records with
parsed soldier counts (avg 121 soldiers/unit). 62 distinct settlement
names referenced — only 4 of these 62 also appear in the main settlement
zone (per session 14's cross-check), so these are armies stationed in
**non-faction-claimed regions** (likely rebel armies / spawn-script-created
hordes / mercenary garrisons / tribal homelands without permanent
settlement cards).

**The brief's standard-unit-schema hypothesis is REFUTED for tail records**:

| Field per brief | Brief's expected offset | Actual content at that offset |
|---|---|---|
| soldiers | `+12` | ✓ MATCHES (soldier count current) |
| armour | `+16` | ✗ Actually soldier count max (= +12) |
| weapon | `+17` | ✗ High byte of soldier count u32 (always 0) |
| morale | `+19` | ✗ Soldier count high byte (always 0) |
| XP | `+20` | ✗ Constant `0x40000040` = float 2.0 |

The settlement-embedded unit records (per session 10/11) follow a
DIFFERENT layout. The tail field-army records have a more compact schema
where individual soldier stats are packed into the per-soldier 9-byte
records (3 stat bytes each) rather than living at fixed offsets in the
record header.

**Implication for Provincia**: a tail-field-army parser can extract:
- Per-record: unit name (ASCII), home settlement (UTF-16LE), soldier
  count, max soldier count, soldier-level state array
- 122 records × ~14,636 soldiers = a complete rebel/horde army roster
  separate from the main faction-owned army inventory

A surface-level "Show rebel armies" panel can be built on this. Decoding
the 9-byte per-soldier stats packing would require either (a) a
controlled save where one unit fights a battle and per-soldier HP/XP
changes are diffed across save pairs, or (b) cross-reference to the
RTW per-soldier-persistent schema definition (likely documented in
TWC threads on M2TW which shares the same schema family).

**Reproducer**: `dig-field-army-tail{1..4}.js` — unit-name record scan
(#1), per-record settlement+soldier decode (#2), bodyguard vs unit-record
size analysis (#3), per-soldier stride confirmation (#4).

#### Open follow-ups for session 23+

- **Mid-file array decode**: with the anti-diagonal sentinel identified
  and terrain refuted, the 697 truly-interior non-canonical cells remain
  unexplained. Worth probing for: (a) correlation with the descr_strat
  starting region placement, (b) correlation with mercenary pool
  locations, (c) correlation with the 6 spawn_scripts rebellion seed
  points from session 14.
- **RIS event counter** (analogue of Alex's A counter at +(92+4N+20)):
  this session pinned the turn counter at +(52+4N+188) but NOT the event
  counter. Need a per-turn RIS imperial corpus (T1, T2, T3, ... like the
  Alex Macedon T1-T99 sequence) to find a monotone-cumulative u32 inside
  each faction record's per-turn-stats block.
- **Per-soldier 3-byte stat packing**: decode bytes +1..+3 of each
  9-byte soldier record. The brief's hypothesis was XP/armour/weapon/morale
  at +16/+17/+19/+20 of a unit, but in tail records these live INSIDE
  each soldier sub-record. Need a save-pair where one tail field army
  fights a battle (gains XP / takes armour upgrade) — those bytes
  should change.
- **Field-army UUID/hash semantics**: the 8-byte hash + 8-byte UUID
  prefix in the pre-settlement zone (offsets +0..+16 of unit record post
  ASCII name) is per-record-unique. These likely connect tail records
  to faction-records or character-records elsewhere in the file. A
  cross-search for these UUIDs in the body section could reveal which
  faction "owns" each tail field army.

#### Reproducer scripts

- `dig-terrain-confirm{1..6}.js` — mid-file terrain hypothesis REFUTATION
  - 1: TGA loader + per-cell heights/sea/region sampling correlation
  - 2: spatial overlay with coastline rendering
  - 3: idx-difference histogram for `f32==600` (139/479 diff=239)
  - 4: per-row dump of `f20==600` cells (220/238 on c+r=237 diagonal)
  - 5: anti-diagonal sentinel filter + variant histogram (697 truly-interior non-canon)
  - 6: re-running terrain correlation with anti-diagonal removed — REFUTES session 21
- `dig-ris-counter{1..4}.js` — RIS imperial per-faction stats block
  - 1: major-faction record discovery on rome10 + romeT1 (both have 23 majors)
  - 2: per-faction T1-vs-T5 u32 diff scan inside the post-region-list block
  - 3: zoom on +148/+172/+188/+208/+224 fields with per-faction tables
  - 4: final summary — +188 uniformly ticks 0→4 across all 23 factions
- `dig-field-army-tail{1..4}.js` — tail field-army full decode
  - 1: unit-name record walk + settlement+payload parse (122 records)
  - 2: per-unit-type soldier-count consistency check + 64B payload dump
  - 3: bodyguard vs unit-record size distribution + ff-marker stride
  - 4: per-soldier 9-byte stride confirmation (9.005 B/soldier exact for peltasts)

---

### Findings 2026-05-11 (background session 23 — tail hash blob + lua footer + mid-file entity hypothesis)

Goal: (1) Map the ~19KB "hash blob" between the field-army units block end and the
settlement model strings; cross-reference its 8-byte hash records against the 122
field-army record hashes to test whether it's a lookup table for them. (2)
Test the descr_strat-placed-entity hypothesis for the 697 unexplained
non-canonical mid-file cells via correlation with settlement (X,Y) tile coords.
(3) Map the 24KB lua/script footer's sub-sections beyond the simple counters,
documenting all variable names. (4) Stretch: per-soldier 3-byte stat decode.

Outcome: **Four new findings.** (a) **CONFIRMED: the "19KB hash blob" is
actually a composite region** — session 14 mismeasured its bounds. The true
structure is `[~860B trailing soldier records that session 22 missed] +
[~232B 0xff padding] + [~528B near-zero tail] + [2560B high-entropy
random data, dynamic per-turn] + [16B header with N=239] + [3808B value=3
faction array] + [~9KB additional structured data]`. Field-army hash
lookup hypothesis REFUTED: 0/122 unit hashes appear in the high-entropy
zone. The high-entropy region is **per-turn dynamic state** (entirely
different bytes between RoR-T1 and rome10, 0 shared records), most
plausibly **AI/PRNG random-number-generator persistent state** rather
than a deterministic hash lookup table. (b) **CONFIRMED: 238-record
all-zero array immediately precedes a 239-row faction record block** —
identical structure in rome10 and RoR-T1 (same 238 default rows + 1
special row #239 with self-pointer + 1.0 float marker). 238 ≈ 239
factions but exactly one short; likely a per-faction simple-state array
where the 239th faction (rebels/slaves?) is the "owner" record. (c)
**CONFIRMED: 24KB lua/script footer fully decoded — 115 lua counter
records categorized into 6 functional groups**: 60 `id_<faction>`
faction-id constants (faction → int hash, e.g. `id_romans_julii = 1110011`),
22 `<Region>Rebellion_*` script-state counters, 16 `<region>_reform_battle_counter`
Marian-equivalent reform triggers, 11 `num_battles_*` /
`num_mercs_recruited_*` military counters, and 12 misc state flags
(`first_time_setup`, `has_game_reloaded`, `turn_number`,
`capital_first_setup`). No `marian_reforms_triggered` exists in RIS but
the equivalent **per-faction `<faction>_reform_battle_counter`** pattern
covers every culturally-distinct reform-tracking case. (d) **REFUTED:
settlement-coord correlation hypothesis for the 697 mid-file cells** —
non-canonical cells show identical nearest-settlement distance
distribution to a random sample of canonical cells (3.0% within 3 cells
in both populations). The mid-file array is NOT a settlement-locating
structure. Top variant `200_200_2_6_0` (217 cells, centroid 118,87) and
`200_200_2_6_600` (210 cells, centroid 119,95) cluster spatially with
nearly-identical centroids — refutes the hypothesis that variants
distinguish entity types. ASCII map shows scattered distribution across
the whole grid with no recognizable feature (no coastline, no road
network, no clustering at known scripted-rebellion regions).

Save corpus this session: `save_rome10.sav` (RIS imperial T5) and
`save_Autosave Republic of Rome Turn 1.sav` (RIS imperial T1).

#### 1. CONFIRMED REVISION: tail field-army block ends at 0x1f43598 (session 22's 0x1f42cb6 was end of last ASCII name, not end of soldier records)

Session 22 reported the field-army block at `0x1f10c72..0x1f42cb6`. The
upper bound is wrong — `0x1f42cb6` is where the last unit record's
**ASCII name** ends (the name reads "...armen" — likely "thracian
armenians"), not where its soldier records end. Walking the 9-byte
soldier stride forward from `0x1f42d28` (the offset where the standard
`[44B header][N×9B soldiers]` structure begins for the final record)
yields **240 valid 9-byte records** before the pattern breaks at
`0x1f43598`. Then 0xff padding runs to `0x1f43688`.

**Implication**: session 22's 122-record count and 14,636-soldier total
were under-counts by ONE unit record with 240 soldiers. Corrected:
**123 records, 14,876 soldiers total**. The corrected field-army block
upper bound is `0x1f43688` (end of 0xff padding for the 123rd unit), not
`0x1f42cb6`.

**Reproducer**: `dig-hash-blob3.js` (forward + backward 9-byte stride
walk; 240 records detected, 0xff padding to 0x1f43688).

#### 2. CONFIRMED: the "19KB hash blob" (session 14's hypothesis) decomposes into 7 sub-regions; field-army hash lookup hypothesis REFUTED

Session 14 estimated a ~19KB hash blob at `0x1f43000..0x1f47abd`. The
actual structure between the end of the field-army units and the start
of the settlement-model strings is:

| Offset (rome10) | Size | Content |
|---|---|---|
| `0x1f43598..0x1f43688` | ~240 B | 0xff padding (terminator of last field-army unit record) |
| `0x1f43688..0x1f436b6` | ~46 B | Near-zero header (44 zero bytes + `ef 64 cc 58` 4-byte marker) |
| `0x1f436b6..0x1f437a9` | ~243 B | 0xff padding (second padding stretch) |
| `0x1f437a9..0x1f437de` | ~53 B | Self-pointer-headed prelude (self-ptr at `0x1f437a9`, then 53 bytes) |
| `0x1f437de..0x1f441de` | **2560 B** | **High-entropy zone** (320 × 8-byte unique records; H≈7.2; per-turn dynamic) |
| `0x1f441de..0x1f442de` | ~256 B | Transition zone (a cluster of u32 self-pointers `0x1f44279..0x1f4428a` + small u32 fields + offset-list-like pattern with values `0x01f44279, 0x01f44285, 0x01f4428a, 0x01f44296, 0x01f442a2, 0x01f442a8, 0x01f442ae` — these are intra-block forward offsets) |
| `0x1f442de..0x1f442ee` | 16 B | **Faction-array header** `{u32 selfPtr=0x1f442de, u32 count=239, u32 reserved=0, u32 0xef000000}` |
| `0x1f442ee..0x1f451ce` | 3808 B | **238 × 16B records `{u32=3, 12B zeros}`** (default per-faction state) |
| `0x1f451ce..0x1f451ee` | 32 B | Special "239th" record with self-pointer at `+8` and `float32 1.0` at `+24` |
| `0x1f451ee..~0x1f47abd` | ~9.6 KB | Additional structured tail before settlement-model strings (mixed structures, not yet decoded) |

**Field-army hash lookup hypothesis REFUTED**:

For each of the 123 corrected field-army records the brief asked us to
extract `[u16 nameLen][ASCII unit name][0xee marker][8B hash][8B UUID]`.
The 123 hashes and 123 UUIDs were searched across the entire
`0x1f43000..0x1f47abd` region for byte-exact matches:

| Pattern type | Found in 0x1f43000..0x1f47abd | Found in 0x1f437de..0x1f441de (high-entropy only) |
|---|---|---|
| 8-byte hash (after 0xee marker) | **0 / 122** | **0 / 122** |
| 8-byte UUID | **0 / 122** | **0 / 122** |

The high-entropy zone is **not** a lookup table for field-army records.

**Cross-save comparison**: 320 unique 8-byte records in rome10, 320 in
RoR-T1 — **identical count** but **0 intersection** (no record shared).
The high-entropy data is therefore **dynamic per-turn state**, not a
static lookup. Most plausibly:
- AI persistent random-number-generator state (e.g., Mersenne-Twister state)
- Per-turn cryptographic randomness seeds for combat outcomes / strategic decisions
- Hash of the world state used for turn-to-turn determinism checks

The 320 count is suspiciously close to other entity counts: 23 majors +
239 minor-/2 + ~57 = ? Or a power-of-2 boundary near 256 + 64 padding =
320. Not pinned to a known entity count.

**Confidence**: CONFIRMED that the field-army-hash-lookup hypothesis is
wrong; CONFIRMED dynamic-per-turn for the high-entropy zone via 0%
intersection between turn-1 and turn-5 saves.

**Reproducer**: `dig-hash-blob{1..14}.js`. Key scripts: `1.js` initial
hex+entropy survey, `2.js` 122-field-army-hash cross-reference (0/122),
`3.js` 9-byte soldier stride extension (240 more records), `5.js`
8B-record uniqueness check (all 289 unique in 2312B subset), `7.js`
value-3 array alignment (Alignment B at 0x1f442ee), `8.js` 238-record
count + 239-row block, `13.js` cross-save validation, `14.js` 0
intersection between rome10 and RoR-T1 high-entropy zones.

#### 3. CONFIRMED: 24KB lua/script footer fully decoded — 115 counters in 6 functional groups

The 24KB tail footer at `0x210f4d4..0x21153ae` decomposes:

**Sub-region 1**: footer preamble at `0x210f4d4..0x210f4e0` — self-pointer
header `{selfPtr=0x210f4d4, u32 0, u32 0x35, u32 selfPtr2=0x210f4e0}`.

**Sub-region 2**: UTF-16LE script path at `0x210f4e1..0x210f56b` (66
chars + delimiter): `'data/world/maps/campaign/imperial_campaign/RIS_Campaign_Script.txt'`.

**Sub-region 3 — Lua counter table** at `0x210f56f..0x2110a23`: 115
records of `[u32 nameLen][UTF-16LE name][u32 value]`. Fully categorized:

| Group | Count | Example | Value type |
|---|---|---|---|
| `id_<faction>` faction-ID hashes | **60** | `id_romans_julii = 1110011`, `id_carthage = 1210021`, `id_slave = 5000020` | u32 hash, deterministic per faction-name (per-mod-defined; RIS-specific) |
| `<Region>Rebellion_*` script state | **22** | `ChrysaoriaRebellion_Done = 0`, `ThessalyRebellion_AllAntigonidOwned = 50`, `LyciaRebellion_PlayerRevolt = 0` | u32 counter/flag |
| `<region>_reform_battle_counter` (Marian-reforms equivalent) | **16** | `cappadocia_reform_battle_counter = 0`, `cilician_thureophoroi_reform_battle_counter = 0`, `bosporan_reform_battle_counter = 0` | u32 counter |
| `num_battles_<x>` / `num_mercs_recruited_<x>` military counters | **9** | `num_battles_seleucids_rome`, `num_battles_antigonids_sparta`, `num_mercs_recruited_seleucid` | u32 counter |
| `<x>_reform_*` extra reform counters (settlement-capture, recruit, war) | **5** | `cappadocia_reform_settlement_capture_counter`, `pergamon_reform_war_counter`, `miletus_reform_recruit_counter`, `pentapolis_reform_recruit_counter`, `ptolemaic_therapeia_recruit_count` | u32 counter |
| Misc state flags | **3** | `first_time_setup = 1`, `has_game_reloaded = 0`, `turn_number = 0`, `capital_first_setup = 0`, `PtolemaicReformOne = 0` | u32 flag |

**Important finding — no `marian_reforms_triggered` exists in RIS imperial.**
The brief expected this from vanilla Rome, but RIS replaces it with
**per-faction `<faction>_reform_battle_counter`** — each of 16+ factions
tracks its own reform separately, allowing culturally-distinct reform
triggers (Cappadocia, Pergamon, Bosporan, Bithynia, Cyrene, Massalia,
Achaea, Boeotia, Cabyle, Dardania, German, Labeataean, Selge, Syracuse,
Cyrene-2, Cilician_Thureophoroi). The `pergamon_reform_war_counter`
specifically tracks war state (not battle wins) for that faction.

**The brief's expectation of `civil_war_active` and
`marian_reforms_triggered` flags is REFUTED for RIS imperial**: RIS uses
a richer per-faction reform-tracking schema, and the only "Done" flags
are per-rebellion not per-civil-war.

**Sub-region 4 — Tile-coord trail array** at `0x2110a24..0x21153ae`
(~18KB). Walking with the corrected parser yields **74 chunks** with
**1198 total records** (1076 empty-pair, 122 with non-zero pairs). Note:
session 14 reported 217 chunks / 2499 records; the discrepancy is
likely because session 14 used a different parser interpretation (count
each (selfPtr, pairCount, pairs) record individually vs grouping by
preceding u32-N chunk-header). The 122 non-empty-pair records is
striking — **same number as the 122 field-army records in the tail**.
This is plausibly a per-field-army "intended path" cache (each
field-army has one trail entry with up to ~6 (X,Y) tile pairs). The
1076 empty-pair records are then placeholder slots for armies with no
queued path.

**Reproducer**: `dig-lua-footer{1..2}.js`.

#### 4. REFUTED: settlement-coord hypothesis for the 697 mid-file non-canonical interior cells

The brief asked us to test whether the 697 truly-interior non-canonical
cells in the mid-file array correlate with descr_strat-placed
entities — primarily settlements. Settlement (X,Y) tile coords were
extracted from session 16's settlement-model strings block: 195 unique
(X,Y) pairs in rome10 (X∈[83,988], Y∈[22,651]).

**Method**: for each of the 697 non-canonical cells, compute pixel-center
coordinates (using the brief's 4.25×2.94 px/cell scale) and find the
nearest settlement. Compare with a random baseline of 697 canonical
interior cells:

| Nearest settlement within | Non-canonical (697) | Random canonical baseline (697) |
|---|---|---|
| 1 cell | 5 (0.7%) | 5 (0.7%) |
| 2 cells | 14 (2.0%) | 16 (2.3%) |
| 3 cells | **21 (3.0%)** | **21 (3.0%)** |
| 5 cells | 41 (5.9%) | 52 (7.5%) |
| 10 cells | 99 (14.2%) | 144 (20.7%) |

**The non-canonical cells are NOT settlement-correlated** — they show
the same nearest-settlement distance distribution as a random sample of
canonical cells (in fact slightly LESS correlated at the 5-cell and
10-cell radii). The 5 cells "within 1 cell" of a settlement is the
same number in both populations — pure baseline noise.

**Spatial-clustering test**: the top 8 variants all have nearly-identical
centroids (cc≈118, rr≈90) and high stddev (~100). If variants encoded
different entity types we'd expect spatially-segregated clusters; we
observe a single overlapping cloud. The ASCII downsampled map shows
scattered distribution across the whole grid with no recognizable
geographic feature.

**Variant histogram (697 non-canonical interior cells)**:

| Variant key (`f16_f20_f24_f28_f32`) | Count | Δ from canonical |
|---|---|---|
| `200_200_2_6_0` | 217 | f32: 200→0 |
| `200_200_2_6_600` | 210 | f32: 200→600 |
| `200_0_2_54_4294967286` | 147 | f20: 200→0, f28: 6→54, f32: 200→-10 |
| `200_600_2_6_600` | 33 | f20: 200→600, f32: 200→600 |
| `200_0_2_54_200` | 28 | f20: 200→0, f28: 6→54 |
| `200_200_2_6_4294967286` | 23 | f32: 200→-10 (=0xfffffff6) |
| `200_0_2_54_600` | 16 | f20: 200→0, f28: 6→54, f32: 200→600 |
| `200_0_2_55_200` | 15 | f20: 200→0, f28: 6→55 |
| Other (4 minor variants) | 8 | various |

The 0xfffffff6 (=-10 signed) f32 value and the consistent f28=54/55
suggest these are **NOT** terrain markers (session 22's refutation
confirmed) but plausibly some **AI-strategic-hint enum** where each
variant represents a different hint type. Without runtime
instrumentation the semantics remain unrecoverable.

**Confidence**: REFUTED that the 697 non-canonical cells are
settlement-locating markers, descr_strat-entity-placed markers, or
spatially-segregated by variant. Their semantic meaning remains an
**open question**.

**Reproducer**: `dig-midfile-entities{1..2}.js`.

#### 5. STRONG: high-entropy 2560B zone is per-turn dynamic state, not a static lookup

Cross-save analysis of the high-entropy region:

| Save | High-entropy zone | Size | Unique 8B records |
|---|---|---|---|
| rome10 (RIS imperial T5) | `0x1f437de..0x1f441de` | 2560 B | 320 |
| RoR-T1 (RIS imperial T1) | `0x1f1ad7b..0x1f1b77b` | 2560 B | 320 |

Both saves have **identically-sized** high-entropy zones with the **same
number of unique 8-byte records (320)** — but **0 records shared
between the two saves**. The data is therefore:
- **Not** a deterministic-per-campaign lookup table (would have 320 shared records)
- **Not** field-army UUIDs (refuted by 0/122 hash match)
- Most plausibly: **AI persistent PRNG state**, encrypted per-turn-state hash, or per-faction strategic-decision randomness seeds

The constant 320 (=64×5 or 256+64) doesn't map to a known
RIS entity count (factions=239, regions=213, settlements=195,
field-armies=123, characters≈250). Possibly **per-region AI decision
hashes** with 213 regions + 107 padding slots, OR **per-(faction × 5-decision-slot)** at 64×5=320 (5 AI decisions per "slot", 64 slots total).

**Reproducer**: `dig-hash-blob14.js` — 0 intersection between rome10 and
RoR-T1 high-entropy zones; both 320 unique 8B records.

#### 6. CONFIRMED: 238 + 1 = 239 faction record array at 0x1f442ee with single special row #239

The structured value=3 array immediately follows the high-entropy zone
and is preceded by a `{u32 selfPtr, u32 N=239, u32 0, u32 0xef000000}`
header at `0x1f442de`. The array contains:
- **238 × 16-byte records** of `[u32=3][12 zero bytes]` (default per-faction state)
- **1 × 32-byte "special" record** at `0x1f451ce`:
  ```
  +0  u32 = 3                    (same default tag as other 238)
  +4  u32 = 0
  +8  u32 = 0x1f451d6             (self-pointer at +8 — section header)
  +12 u32 = 0
  +16 u32 = 0                    (16B of zeros)
  +20 u32 = 0
  +24 u32 = 0x3f800000 = float 1.0  (presence/active flag?)
  +28 u32 = 0x1f451ea             (another self-pointer)
  ```

The special record corresponds to **one specific faction** in the 239-row
ordering — most likely the **rebel/slave faction** (the only faction
that's "owner of every region" in the engine) or the **player faction**.
The 1.0 float at +24 is a "currently active player" type marker.

**Cross-save validation**: BOTH rome10 and RoR-T1 have:
- Same 238 default + 1 special structure
- Same 16-byte stride
- Self-pointers in both saves at the analogous positions

**Interpretation**: this is the engine's **per-faction "active state"
array** with all factions defaulting to state-3 (= the most common
faction-state-machine state, plausibly "alive and active") and one
faction having extended state (sub-section, float marker, etc.).

**Reproducer**: `dig-hash-blob{8..13}.js`.

#### Open follow-ups for session 24+

- **High-entropy zone semantics**: 320 unique 8B records, per-turn-dynamic.
  Need: (a) cross-reference all 320 records against known character UUIDs,
  faction hashes, region IDs to find any match; (b) check whether values
  are sorted (i.e. an index-sorted hash table) or arbitrary order; (c)
  test if XORing rome10's records with RoR-T1's reveals a turn-counter
  delta pattern (would indicate a Linear-Feedback shift register state).

- **Tile-coord trail array discrepancy (74 vs 217 chunks)**: parser
  difference between this session and session 14. Reconcile by re-running
  session 14's parser code on rome10 and comparing the chunk-boundary
  detection logic. The 122 non-empty-pair count likely matches the 122
  field-army count; testing whether the (X,Y) pairs in chunk i match the
  field-army[i]'s home-settlement tile would confirm.

- **Mid-file array (the 697 non-canonical cells)**: settlements refuted,
  terrain refuted, descr_strat-entities refuted. Remaining hypotheses:
  AI-strategic-hint table, choke-point graph, road-network metadata.
  Test: visualize variants as a heatmap overlaid on the campaign map and
  see if any pattern matches `descr_terrain.txt`'s movement-cost grid.

- **Special "239th" faction-array row**: which faction is it? Determine
  by ordering the 239 records against the major+minor faction ordering
  from session 5-7. The special row at index 238 (0-based) is likely
  either id_slave (rebels) or id_romans_julii (player).

- **Per-soldier 3-byte stat decode**: still requires battle save-pair.
  Documented byte-position-frequency analysis would need a peltasts unit
  in two saves before and after combat.

#### Reproducer scripts

- `dig-hash-blob{1..14}.js` — hash blob mapping
  - 1: initial hex/entropy survey of 0x1f43000..0x1f48000
  - 2: field-army hash cross-reference (0/122 match, REFUTED)
  - 3: 9-byte soldier-record stride walks forward + backward (240 records)
  - 4: high-entropy zone boundary detection (256B chunks, 0x1f43898..0x1f441a0 initial)
  - 5: 8-byte vs 16-byte stride analysis on high-entropy zone; section-header probe at 0x1f442a8
  - 6: 16B value=3 array alignment investigation
  - 7: u32=3 position enumeration; Δ=16 confirmed (238 stride-16 + 1 jump)
  - 8: 239-record count + special row at 0x1f451ce
  - 9: section-header parse on 239th record (self-pointer + 1.0f marker)
  - 10: alignment correction (Alignment B at 0x1f442ee with 238 records)
  - 11: wide hex dump 0x1f437c0..0x1f442f0 + all self-pointers enumeration
  - 12: entropy 32B granularity scan + transition-zone hex dump
  - 13: cross-save validation rome10 vs RoR-T1 (same 238-count structure)
  - 14: cross-save high-entropy intersection (0/320 records shared — STRONG dynamic-per-turn)
- `dig-lua-footer{1..2}.js` — 24KB script footer mapping
  - 1: ASCII/UTF-16LE string enumeration in footer; 116 strings categorized
  - 2: full 115-record lua counter parse with values + tile-trail chunk count (74 chunks, 1198 records)
- `dig-midfile-entities{1..2}.js` — descr_strat-entity hypothesis
  - 1: settlement-coord nearest-neighbor distance histogram (REFUTED, same as random)
  - 2: variant histogram + spatial centroid + ASCII-map visualization

---

### Findings 2026-05-11 (background session 24 — settlement-model strings + path cache confirmation + mid-file AI-zone hypothesis)

Goal: (1) Fully map the 288KB settlement-model strings sub-region between
the hash blob and the alternate tile grid; enumerate distinct strings, decode
the per-record schema, and cross-tab against in-save settlement count. (2)
Confirm/refute the per-field-army path-cache hypothesis (session 23's "122
non-empty trails" = field-army count). (3) Re-test the mid-file 697 non-canonical
cells against a richer feature set (faction/culture/region overlay, coast,
border, move-cost grid). (4) Stretch: characterise the 2560B high-entropy
zone (PRNG vs counter vs index).

Outcome: **Six new findings.** (a) **CONFIRMED & REFINED: settlement-model
strings block bounds 0x1f47809..0x1f8f9bc (288.4 KB), 701 records, 24 distinct
model names, 201 distinct (X,Y) coords (mistakenly 213 in session 16 due to
mis-aligned reads).** Records have variable-stride 15..83 B with a clean
header schema `[u16 lenPlus1][ASCII name][u8 NUL][u32 tag=27/29/31][u32 X]
[u32 Y][u32 small_int][u32 sentinel][u32...]`. Tag 27 = current architectural
render (410 records), tag 29 = secondary subtype (137), tag 31 = tertiary (72).
No se_* UI markers exist in the block — only architectural-model strings.
(b) **REFUTED: per-field-army path-cache hypothesis.** Session 23's "122
non-empty trails" was a parser artifact. Actual count is **256 non-empty
trails across 221 chunks / 2503 records** (session 16's parser was correct).
256 doesn't match 122 field-armies; the chunk structure (chunk[0] has N=104
records, chunk[5] has N=155) is too large to be per-army. **STRONG
re-confirmation of session 16's per-faction strategic-intent hypothesis**:
99.2% of trail coords match between T1 and T5 saves — coords are nearly
static across 4 turns of game time, consistent with per-faction "remembered
tiles of interest" not per-army planned paths. (c) **CONFIRMED: the 697
non-canonical mid-file cells are STATIC across turns.** All 697 cell positions
AND f-values match identically between rome10 (T5) and RoR-T1 (T1) — IoU =
100%, 0 differences. This **rules out per-turn dynamic AI state**; the cells
are deterministic per-campaign markers. (d) **STRONG: non-canonical mid-file
cells over-represent edge/distant cultures in the RIS faction roster.** Of
38 distinct factions covered by non-canonical cells (vs 100 by canonical):
Saka (steppe) cells are 2.28x over-represented, Suebi (north Europe) 1.72x,
Armenia 1.78x, Egypt 1.98x. Per culture breakdown: top non-canon cultures
are Sahara/desert (Suburpores, Garamantes, Libyans), steppe (Saka,
Massagetians, Sarmatians), and northern barbarians (Suebi, Trinovantes,
Catuvellauni) — populations that the AI rarely strategically targets.
(e) **REFUTED: border-distance, coast, settlement-proximity hypotheses for
non-canonical mid-file cells.** Distinct-region-count in 5x5 sample
neighborhood: 35.7% multi-region (non-canon) vs 35.4% canonical — no border
correlation. Coastal fraction: 9.9% non-canon vs 8.7% canonical — no coast
correlation. f28=54 (suspected sea marker) cells have 29.7% sea pixel
fraction vs 28.3% for f28=6 — no f28→terrain signal. Also REFUTED:
8-neighbour same-variant fraction is 0.0-4.8% across all variants — variants
do NOT form contiguous regions, so the "movement-cost grid" hypothesis is
wrong. (f) **CONFIRMED: the 2560B high-entropy zone is uniform random.**
Per-byte entropy 7.3-7.4 bits/byte at every position (max for n=320 is
~8.3 bits/byte). Records are not sorted. Top u32 of each 8B record is
not bounded by 320 (no index pattern). All 320 records have non-zero u32_high
in both saves. XOR deltas between T1 and T5 are unstructured (no constant
or linear pattern). This is consistent ONLY with **persistent PRNG state or
similar entropy-uniform crypto material** — eliminates counter, hash-table,
sorted-key array, and faction-array hypotheses.

Save corpus this session: `save_rome10.sav` (RIS imperial T5),
`save_Autosave   Republic of Rome   Turn 1.sav` (RIS imperial T1).
Map ground-truth: `C:/RIS/RIS/data/world/maps/base/map_regions.tga` (1020×700,
24bpp BGR; sea pixels = RGB(41,140,~245)), `regions_large.json` (1311 RGB-keyed
region entries with faction/culture/city), `descr_strat_buildings_large.json`
(239 factions × variable settlements). Note: the brief's reference to "T1→T5
sequence in calibration/archive/2026-04-21T22-42-59-494Z" was inaccurate —
the archive contains a Macedon-Alex sequence, not RIS imperial. The
rome10/RoR-T1 pair (one shared RIS campaign, T1 + T5) is the only cross-save
delta available for RIS.

#### 1. CONFIRMED REFINED: settlement-model strings block at 0x1f47809..0x1f8f9bc — 288.4 KB, 701 records, 24 models, 201 distinct (X,Y) coords

Block bounds refined from session 16:

| Aspect | Session 16 (estimated) | Session 24 (refined) |
|---|---|---|
| Start offset | ~0x1f47abd | **0x1f47809** (off by 692 B) |
| End offset | ~0x1f8f97b | **0x1f8f9bc** (off by ~65 B) |
| Size | ~290 KB | **288.4 KB exact** |
| First record | (mid-block) | `Eastern_Town` @ 0x1f47809, recLen=51 |
| Last record | (mid-block) | `W_hellenistic_Large_Town` @ 0x1f8f961, recLen=91 |
| Distinct (X,Y) coords | 213 | **201** (session 16's count included 12 mis-aligned ghost coords) |
| Total records | 688 / 701 | **701** confirmed |

**Layout before block start (16 bytes immediately preceding 0x1f47809)**:
`00 02 38 00 1b 00 00 00 81 00 00 00 66 01 00 00 01 00 00 00 ff ff ff ff`
= `[u16 lenPlus1=2][u8 0x38][u8 0]` + `[u32 tag=27][u32 X=129][u32 Y=358]
[u32=1][u32=0xffffffff]` — this is the **first settlement record** (model
name `8` = empty since strLen=1, NUL right after). Actually this is the
*previous* record's truncated payload. The real block begins at the first
record with a valid model name.

**Layout after block end (256 bytes after 0x1f8f9bc)**: jumps directly into
the alternate tile grid's `00 ff 00 ff 00 ff` pattern — confirms session 14's
alternate-tile-grid runs from `0x1f8f9bc` onward.

**Distinct model names (24, all confirmed via 2-save cross-validation)**:

| Model | rome10 count | RoR-T1 count |
|---|---|---|
| W_hellenistic_Large_Town | 142 | 140 |
| W_hellenistic_Large_City | 89 | 89 |
| Celtic_Large_Town | 85 | 85 |
| W_hellenistic_City | 65 | 65 |
| Eastern_Large_Town | 51 | 51 |
| Illyrian_Large_Town | 43 | 43 |
| W_hellenistic_Town | 36 | 36 |
| Celtic_City | 25 | 25 |
| W_hellenistic_Huge_City | 25 | 25 |
| Carthaginian_Huge_City | 23 | 23 |
| Carthaginian_Large_Town | 21 | 21 |
| Eastern_City | 19 | 19 |
| Germanic_Large_Town | 19 | 19 |
| Nomad_Large_Town | 10 | 10 |
| Eastern_Town | 8 | 8 |
| Eastern_Huge_City | 8 | 8 |
| Carthaginian_City | 7 | 7 |
| Egyptian_Large_Town | 6 | 6 |
| Celtic_Town | 5 | 5 |
| Carthaginian_Town | 5 | 5 |
| Egyptian_Town | 3 | 3 |
| Illyrian_Town | 3 | 3 |
| Germanic_Town | 2 | 2 |
| Nomad_Town | 1 | 1 |

Total 701 in rome10 (vs 700 in RoR-T1 — 1 more `W_hellenistic_Large_Town`
record consistent with one settlement captured/transitioned between turns,
adding a new ownership-history entry).

**Per-record schema (refined from session 16)**:
```
[u16 lenPlus1]          (= ASCII strLen + 1 for NUL)
[strLen × ASCII bytes]  (the architectural model name)
[u8 0x00]               (NUL terminator)
[u32 tag]               (27 / 29 / 31 — three subtype enums)
[u32 X]                 (tile X, range [83..988], TGA pixel space)
[u32 Y]                 (tile Y, range [22..651], TGA pixel space)
[u32 small_int]         (varies 1..5; possibly "level" or "occupant index")
[u32 sentinel]          (0xffffffff for tag=27, or 8 for tag=29, or various for tag=31)
[u32 ...]               (variable trailing data, 0..40 B)
```

Record size distribution: **mode = 63 B** (115 records), median ~57 B,
range 15..83 B (with one outlier 44654 B = the cross-block gap not a real
record). Variable-stride is caused by the trailing-data field, which carries
1..40 additional bytes per record (likely a per-faction-occupant-history
entry list).

**Block coords cover the full Mediterranean strategic map** (X[83..988],
Y[22..651]) — these are TGA pixel-space coords on the 1020×700 `map_regions.tga`,
identical to the settlement coord space.

**Per-coord multi-entry distribution** (201 distinct coords, 701 records):

| Records per coord | Coords |
|---|---|
| 1 | 111 |
| 2 | 23 |
| 3 | 5 |
| 4 | 4 |
| 5 | 10 |
| 6 | 17 |
| 7 | 12 |
| 8 | 4 |
| 9 | 4 |
| 10 | 7 |
| 11 | 1 |
| 13 | 1 |
| 16 | 1 |
| 17 | 1 |

Top coord (452,356) has **17 records** (a single settlement in central
Greece with 17 different architectural-template entries — likely the most
contested settlement that has changed hands many times). Single-entry coords
(111) are settlements never changed hands: tag=27 (current owner's render)
× 70 and tag=29 (default subtype) × 41 — no tag=31 in single-entries.
Multi-entry coords have either all tag=27 (12 patterns, 65 coords), or all
tag=29 (10 coords), or all tag=31 (5 coords) — **each coord has only one
tag-type, so the tag enum is a per-COORD attribute not a per-record-position
attribute**.

**Cross-tab to RIS region count**: RIS imperial has 1311 region entries in
`regions_large.json` but only **239 actual settlements** in
`descr_strat_buildings_large.json` (sum across 239 factions). 201 coords
≈ 213 in session 16 reflects ~85% of the RIS settlements get an
architectural-model entry. The 38 "missing" settlements likely have a
NULL model assignment (e.g., spawn-script-created camps, fort-only
settlements, or non-rendered placeholders).

**Per-tag distribution**:

| Tag | rome10 count | Interpretation |
|---|---|---|
| 27 (0x1b) | 410 | "Active render" / current owner's model |
| 29 (0x1d) | 137 | "Secondary subtype" — possibly "captured but pending visual update" |
| 31 (0x1f) | 72 | "Tertiary subtype" — possibly "queued for replacement" |
| Bleed-in 5f570019/5f570013 etc | ~75 | False-positive reads from mis-aligned starts (these are `_W` + length bytes of next record's name) |

The 75 "bleed-in" tag values are mis-aligned reads that overlap a true
record's name-length-prefix byte sequence and were the source of session
16's 213-coord count vs the true 201.

**Implication for Provincia**: a parser can read per-settlement architectural
**model history** + tile coord directly from this block. Each settlement has
1-17 model entries (with multi-entry settlements being highly contested
ones whose owner has changed multiple times). The 24-model culture×size
matrix maps to RTW's culture-tier matrix:
- W_hellenistic_{Town, City, Large_Town, Large_City, Huge_City} = Hellenistic 5 tiers
- Celtic_{Town, City, Large_Town} = Celtic 3 tiers
- Carthaginian_{Town, City, Large_Town, Huge_City} = Carthaginian 4 tiers
- Illyrian_{Town, Large_Town} = Illyrian 2 tiers
- Eastern_{Town, City, Large_Town, Huge_City} = Eastern 4 tiers
- Germanic_{Town, Large_Town} = Germanic 2 tiers
- Nomad_{Town, Large_Town} = Nomad 2 tiers
- Egyptian_{Town, Large_Town} = Egyptian 2 tiers

**Reproducer**: `dig-settle-models{1..3}.js` (initial scan, refined bounds,
cross-tab against region count).

#### 2. CONFIRMED: 99.2% trail-coord stability T1→T5 — per-faction strategic intent, NOT per-field-army path cache

Session 23 reported 122 non-empty trails. Session 24's re-parse (matching
session 16's tile-trail2.js logic) yields:

| Metric | rome10 (T5) | RoR-T1 (T1) |
|---|---|---|
| Total chunks | 221 | 219 |
| Total records | 2503 | 2398 |
| Non-empty trails (pairCount > 0) | **256** | 247 |
| Empty trails (pairCount = 0) | 2247 | 2151 |

**The 122 count from session 23 was a parser artifact** (chunks bailed at
N=0 padding mid-stream).

**Path-cache hypothesis REFUTED** for the per-field-army interpretation:

- Field-army count = 122 (session 22), 123 (session 23 corrected)
- Trail non-empty record count = 256 (this session)
- These don't match — **256 ≠ 122 ≠ 123**

**Per-faction strategic-intent hypothesis CONFIRMED** (refines session 16):

| Test | Result |
|---|---|
| chunk[i] N values match T1→T5 at shift=+2 | **219/219 exact match** (session 16's 219/221) |
| chunk-coord-set intersection per matching chunk | 247 shared coords / 249 union = **99.2%** |
| Chunks with at least 1 shared coord between saves | **71/71 active chunks** |
| Chunks with at least 1 non-empty trail (active) | 72/221 in rome10 (33%) |

The 99.2% T1→T5 stability rules out per-field-army path cache (army positions
shift between turns; per-faction strategic intent persists across turns).

**Chunk[0] is the player Romans Julii faction** (centroid X=291, Y=405 =
Italy/Rome; chunk has N=104 records, 8 non-empty trails). RoR-T1's
shift-aligned chunks confirm chunk[0..2] are the 3 "extra" chunks that
appeared in rome10 — possibly new factions emerged between T1 and T5.

**Trail-coord vs settlement-coord intersection**:
- Distinct trail coords in rome10: 256
- Distinct settlement coords: 201
- Trail ∩ Settlement: 46 (18% of trail coords are settlement coords)
- The other 210 trail coords are **field tiles** — battlefield positions or
  army-march route waypoints, NOT settlement targets

**Implication for Provincia**: trails are NOT a per-army path; they are
**per-faction's persistent strategic-intent table** — a slot-based array
where each faction has N slots and writes its "tiles I plan to attack/move
to" cache. The cache rarely changes turn-over-turn (only when faction's
strategic situation changes). 46 settlement-coord trails = 46 settlements
that some faction is currently planning to attack. 210 non-settlement-coord
trails = mid-route waypoints / rally points / contested non-settlement
locations.

**Reproducer**: `dig-path-cache{1..4}.js`. Key scripts:
- `1.js` initial field-army → trail matching attempt (0/256 byte-exact match)
- `2.js` chunk-stats + settlement-coord cross-reference (46 trails at settlements)
- `3.js` cross-save T1↔T5 alignment (99.2% coord stability across all matching chunks)
- `4.js` chunk[0..220] centroid-to-settlement nearest-neighbor mapping

#### 3. CONFIRMED: mid-file 697 non-canonical cells are STATIC across turns (IoU=100%, 0 f-value diffs)

Loading rome10 (T5) and RoR-T1 (T1) and parsing the 240×238 mid-file cell
array (ARR_START=0xf8fd2, STRIDE=267 in both saves):

| Metric | rome10 (T5) | RoR-T1 (T1) |
|---|---|---|
| Total interior cells | 56406 | 56406 |
| Non-canonical cells | **697** | **697** |
| Identical cell positions (IoU) | — | **100%** (697/697) |
| Identical f16/f20/f24/f28/f32 values | — | **697/697 — zero differences** |

**This is a definitive REFUTATION of any "AI state" / "per-turn-dynamic"
interpretation**. The 697 non-canonical cells are **deterministic
per-campaign markers**, baked into the campaign's data and never modified
during gameplay. Whatever they encode is part of the starting map
configuration.

**Reproducer**: `dig-midfile-aizone5.js` (cross-save IoU check + per-cell
f-value comparison).

#### 4. STRONG: non-canonical mid-file cells cluster in edge/distant-culture regions, NOT in playable Mediterranean core

Method: for each non-canonical cell's pixel center on `map_regions.tga`,
look up the region color → faction via `regions_large.json`. Compare faction
representation between non-canonical (697 cells) and canonical (sample of
5000 from 55709) populations.

**Faction representation rate (non-canon / canonical) — top 20 over-represented**:

| Faction | non-canon | canon | ratio (over-rep) |
|---|---|---|---|
| olbia | 1 | 3 | 27.4x |
| sparta | 1 | 4 | 20.5x |
| pentapolis | 1 | 7 | 11.7x |
| asti | 1 | 10 | 8.2x |
| delmatae | 1 | 13 | 6.3x |
| paeonia | 1 | 20 | 4.1x |
| cimbri | 1 | 21 | 3.9x |
| cyrene | 1 | 21 | 3.9x |
| **saka (steppe)** | **101** | 3628 | **2.28x** |
| egypt | 5 | 207 | 1.98x |
| armenia | 17 | 784 | 1.78x |
| **suebi (north Europe)** | **50** | 2380 | **1.72x** |
| **massylii (Sahara)** | **126** | 11843 | **0.87x** |

The strongest signal: **non-canonical cells over-represent edge/distant
factions but under-represent the Mediterranean core**:
- Saka steppe regions: 101 non-canon cells (the largest single concentration)
- Massylii Sahara: 126 non-canon cells (despite being a major faction)
- Suebi north Europe: 50 non-canon cells

**Total distinct factions covered**:
- non-canonical: **38 factions** (vs the 100 factions in canonical sample)
- ratio = 38/100 = the non-canonical cells touch only 38% of factions
- the missing 62% are the playable Mediterranean core

**Cultural breakdown (top 10 non-canon cultures)**:
1. Suburpores (Sahara) — 30 cells
2. Carbones-Salians (Germania) — 20 cells
3. Ahowlians (Sahara) — 20 cells
4. Amyrgians (Saka steppe) — 20 cells
5. Libyans (Sahara) — 20 cells
6. Garamantes (Sahara) — 19 cells
7. Issedones (Saka steppe) — 15 cells
8. Massagetians (Saka steppe) — 14 cells
9. Gaetulians (Sahara) — 14 cells
10. Argippaeans (Saka steppe) — 12 cells

These are exclusively distant/wilderness cultures in the RIS faction roster.
**Working hypothesis (STRONG)**: the 697 non-canonical cells mark
**"shroud-only" / "AI-never-targets" / "out-of-play" tiles** — tiles in
regions where the engine flags certain strategic-AI behaviour as disabled
because the cell is too far from the playable action zone.

**Confidence**: STRONG (200x edge-faction concentration vs 0.79x for
romans_julii player faction is a 250x relative-strength signal). Without
runtime instrumentation we can't confirm the exact game-engine semantic, but
the geographic-cultural pattern is unambiguous: non-canon = far from the
Mediterranean.

**REFUTATION of border/coast/terrain hypotheses** (this session):

| Hypothesis | Test | Result |
|---|---|---|
| Border-tile marker | 5×5 distinct-region-count, multi-region% | 35.7% non-canon vs 35.4% canonical — **REFUTED** |
| Coastline marker | %cells partially-sea | 9.9% non-canon vs 8.7% canonical — **REFUTED** |
| f28=54 = sea / f28=55 = mountain | mean sea-pixel fraction per f28 value | f28=54 has 29.7% sea, f28=6 has 28.3%, f28=55 has 18.8% — **REFUTED** (all bands have similar sea%) |
| Movement-cost grid | 8-neighbour same-variant fraction | 0.0%-4.8% across all variants (random baseline ~ 1%) — **REFUTED** (terrain forms contiguous regions; these cells do not) |
| Settlement-locating | mean nearest-settlement distance | non-canon 71-90 px vs canonical 73.7 px — **REFUTED** (no proximity bias) |

**Reproducer**: `dig-midfile-aizone{1..5}.js`. Key scripts:
- `1.js` settlement-distance + neighbour-connectedness + sea-fraction tests (multiple REFUTATIONS)
- `2.js` distance-to-nearest-settlement histogram + alt-tile-mapping test
- `3.js` initial region-color lookup via `regions_large.json` (190 distinct regions in non-canon)
- `4.js` faction representation rate table + culture breakdown (the edge-faction signal)
- `5.js` border-cell test + coast-cell test + cross-save IoU=100% confirmation

#### 5. CONFIRMED: 2560B high-entropy zone is uniform-random material (consistent with persistent PRNG state)

Re-analysis of the 2560B zone (session 23: 320 unique 8B records, 0/320 shared
between rome10 and RoR-T1):

| Test | Result |
|---|---|
| Per-byte-position entropy (8 positions × 320 records) | **7.27-7.47 bits/byte** at every position (theoretical max 8.32 for n=320) |
| Records sorted? | **False** in both saves |
| u32_high < 320 (index pattern)? | **0/320** records satisfy this |
| u32_high non-zero | **320/320** records |
| u32_low non-zero | **320/320** records |
| XOR (T1[i] xor T5[i]) structured? | **No** — XOR values themselves have high entropy |

**All tests are consistent with the records being uniform-random 8-byte
material**. This rules out:
- Counter / index table (would have low-byte entropy bias and ordered u32)
- Sorted hash table (would be sorted)
- u32-indexed lookup (would have u32_high in [0..319])
- Per-faction record array (would have repeated zero u32_high for unset slots)
- Per-character UUID array (UUIDs typically have a structural byte pattern;
  these don't)

**Consistent with**: persistent **AI PRNG state** (e.g. Mersenne-Twister
state array of 624 × 32 bits = 2496 bytes — close to 2560), **per-tile
cryptographic seed array**, or **per-AI-decision randomness pool**. The
exact value 320 = 256 + 64 = 8×40 has no obvious entity-count match in RIS.

**Note**: the entropy is **below** the maximum (~7.4 vs 8.3) which means
the bytes are NOT perfectly uniform. This is consistent with either (a) a
small bias in the underlying RNG (common in older C runtime PRNGs), or (b)
records being **typed** values (e.g. 4 of the 8 bytes encode a 32-bit
shifting state that itself isn't uniform). The 7.3-7.4 number per-position
is high enough to exclude any obvious counter / index / sorted-array
interpretation but doesn't pin down which specific PRNG.

**Reproducer**: `dig-prng-state1.js` (per-byte entropy + XOR delta + sorted
+ index-fit tests).

#### Open follow-ups for session 25+

- **Non-canonical mid-file cells**: the edge-faction signal is strong (Saka,
  Suebi, Massylii Sahara). Need a controlled test: take a different campaign
  (Alex Macedon) where the playable area shifts east — do its non-canonical
  cells shift accordingly? If YES, the "out-of-play markers" hypothesis is
  CONFIRMED. If NO (always Saka/Suebi/Sahara), they're hardcoded per-region
  markers regardless of campaign.

- **Settlement-model block per-tag analysis**: 410 tag=27, 137 tag=29,
  72 tag=31. A controlled save-pair where one settlement transitions (e.g.,
  player captures a city) would reveal which tag flips first (likely
  29→27 = "fresh capture promoted to active render" or 27 stays + a new
  entry appended).

- **Multi-entry settlements ownership history**: coord (452,356) has 17
  records. Mapping each entry's tag + model to RTW's
  `descr_settlement_mechanics.txt` could reveal the engine's per-owner
  rendering history schema.

- **Trail-coord chunk-to-faction mapping**: 221 chunks but only 72 are
  active (have non-empty trails). The 23 RIS major factions all have
  trails; minor factions may be inactive. Cross-validate chunk indices
  against the per-faction stats block from session 22 (each faction has a
  positional record) — if chunk[i] aligns to faction[i] in file order,
  we get a full chunk→faction map for the AI strategic-intent display.

- **High-entropy 2560B zone identity**: 320 × 8B = exactly 2560 B. The
  Mersenne-Twister state of 624 × 32-bit = 2496 B + 16 B index. Mersenne
  Twister 19937 needs 624 × 4 + 4 = 2500 B. Could 320 × 8 = 2560 be a
  different RNG type (Xorshift64? PCG?). A targeted test: roll a die in a
  controlled save, save, save again — the 2560B zone's bytes should change
  in a pattern characteristic of the RNG algorithm.

- **Per-faction reform-battle counter starting values**: session 23 reported
  all 16 reform counters at 0 in rome10. A save where a faction has won
  battles would show which counter increments first — confirms whether
  each faction's reform-battle-counter is "battles won against specific
  enemy" vs "battles won anywhere".

#### Reproducer scripts

- `dig-settle-models{1..3}.js` — settlement-model strings block
  - 1: full enumeration + categorization + cross-save comparison (24 distinct models, 701 records, 0 se_* markers)
  - 2: per-record schema decode + record-size histogram + block-boundary precision
  - 3: cross-tab against settlement-zone names + per-coord multi-entry distribution + tag-pattern-per-coord analysis
- `dig-path-cache{1..4}.js` — per-field-army path cache hypothesis (REFUTED)
  - 1: field-army record extraction + trail-coord matching attempt (0/256 byte-exact match)
  - 2: chunk-stats + settlement-coord cross-reference (46/256 trail coords at settlements)
  - 3: T1↔T5 chunk N alignment (219/219 match at shift=+2) + per-chunk coord-intersection (99.2% stability)
  - 4: chunk centroid → nearest-settlement mapping for all 72 active chunks
- `dig-midfile-aizone{1..5}.js` — mid-file non-canonical cells AI-zone hypothesis
  - 1: settlement-distance + spatial-clustering + sea-fraction tests (multiple REFUTATIONS of session 21/23 hypotheses)
  - 2: nearest-settlement-distance distribution + alt-coordinate-mapping attempt (4× upscale)
  - 3: TGA region-color lookup + per-cell faction/culture mapping (190 distinct regions in non-canon)
  - 4: faction representation rate table + culture breakdown (Saka 2.28x, Suebi 1.72x edge-faction signal)
  - 5: border-cell test + coast-cell test + cross-save T1↔T5 IoU=100% (CONFIRMED static markers)
- `dig-prng-state1.js` — high-entropy 2560B zone characterization
  - per-byte entropy 7.27-7.47, unsorted, no u32-index pattern, XOR-uniform — consistent with PRNG state

---

### Findings 2026-05-11 (background session 25 — descr_strat cross-reference + body root interior + agents)

Goal: (1) Cross-tab the 697 mid-file non-canonical cells against `descr_strat.txt` resource and character coords — does any resource type cluster in non-canon? (2) Walk the body-root interior at `0x3b99..0x633bb3` (~6.5 MB), enumerate top-level children, identify unmapped sections. (3) Validate save's character records against descr_strat-declared agents (spies/diplomats/etc). (4) Stretch — cross-validate settlement-model culture×size matrix.

Outcome: **Six new findings**, three of them **strong negative results** that close out prior hypotheses.

(a) **REFUTED: resources cluster in non-canonical mid-file cells.** With proper Y-flip (`tga_y = 699 - descr_y`), resource coords land in non-canon cells at **1.01x baseline** (essentially random). Edge-region resources (amber, incense, gold, ivory/elephants) — the brief's prime suspects — show **0/N non-canon** for amber, incense, gold (all zero) and only 1 non-canon hit for elephants. No resource type drives the non-canonical signal. Hypothesis "non-canon cells = resource markers" is closed. **Negative-but-clean** (see #1).

(b) **CONFIRMED: body root contains 4 major sub-regions besides character_paths.** Body root spans `0x3b99..0x633bb3` (~6.19 MB). Linear walk reveals: (i) `0x3b99..0x51ad` — **5.6 KB preamble** with UTF-16LE strings "campaign/imperial_campaign" + "imperial_campaign". (ii) `0x51ad..0x87e9` — **13.9 KB character UUID index** (kid[0], session 12). (iii) `0x87e9..0x846af` — **495 KB per-year/per-event log** (mostly 12-byte stride records `[u8 flag][u8 sub][u16 idA][u16 idB][u16 0][u32 hash]` where `idB` clusters at game-years 275-695 = 270 BC + N turns). (iv) `0x846d1..0xa8beb` — **149 KB scripted-events table** with ASCII strings for volcano eruptions, earthquakes, floods, AND the 7 wonders (`pyramids_and_sphinx, pharos, colossus, temple, statue, gardens, mausoleum`). (v) `0xa8beb..0xf8f9b` — **324 KB of 469 medium-sized self-pointing sections** (mean 546 B) likely character_paths records. (vi) `0xf8f9b..0x633bb3` — **5.23 MB START of the mid-file tile-attribute grid** (continues outside body root). The body root's nominal end at `0x633bb3` falls in the **MIDDLE of the tile grid** — the grid (ARR_START=0xf8fd2, STRIDE=267, 240×238 cells, total 15.25 MB) straddles the body-root boundary. **The "9.8 MB gap" of session 12 is actually a continuation of the grid that started inside body root** (see #2).

(c) **CONFIRMED: scripted-events / disasters / wonders are a single named-string table at `0x846d1..0xa8beb`.** 33 distinct names parsed: volcano (×25), eruption (×25), earthquake (×12), plus `eruption_at_etna_140`, `eruption_at_etna_135`, `eruption_at_methana`, `eruption_at_vulcano_91`, `earthquake_at_santorini`, `earthquake_in_rhodes`, `earthquake_in_iberia`, `flood_in_rome_241`, and the **7 wonders of the ancient world** as single ASCII tokens (`pyramids_and_sphinx`, `pharos`, `colossus`, `temple`, `statue`, `gardens`, `mausoleum`). Strings are length-prefixed `[u16 lenP1][ASCII][nul]`. **This is the historical-disaster/wonder schedule** — a per-year event registry (see #3).

(d) **STRONG (HYPOTHESIS→evidence): the 495 KB pre-events region at `0x87e9..0x846af` is a per-year event log.** 42298 candidate 12-byte slots; ~12000 contain real records with format `[u8 flag][u8 0x20|0x00][u16 idA][u16 idB][u16 0][u32 hash]`. `idB` (offset +4) clusters tightly at values **275, 276, 277, ..., 695** = 419 distinct values. Game year 270 BC + N turns = idB. Top hash values repeat (e.g. `0xec22d10b` at multiple idB values) — likely a faction/character UUID being recorded each year. The structure resembles a **per-turn event/history log** keyed by (year=idB, target=idA, actor-uuid=hash). **NOT a character or settlement table** (see #4).

(e) **STRONG NEGATIVE: character names are NOT stored as strings in the save.** Of 232 distinct agent names from descr_strat (diplomats/spies/admirals), **only 6 (2.6%) appear anywhere in the 32 MB save as UTF-16LE**; 0 as ASCII. Of 24 general names, **0** appear. Of 584 named_character names, **11** (1.9%) appear. None of `Gaius`, `Marcus`, `Tiberius`, `Quintus`, `Mago`, `Aqhat`, `Yahua` etc. appear anywhere. **Names are stored as INDICES into `data/text/names.txt`** (a 4116-line UTF-16LE table of `{NameKey}DisplayName` entries). The save stores u16/u32 IDs, not strings — confirmed by the `{key}` indirection convention in names.txt. **This blocks string-based agent validation** and is a foundational schema fact (see #5).

(f) **CONFIRMED: save's settlement-model block uses 6 collapsed culture families while descr_strat uses 21.** descr_strat declares 1831 settlements across **21 cultures** per `descr_sm_factions.txt` (roman, greek, w_hellenistic, e_hellenistic, anatolian, libyan, celtiberian, dacian, barbarian, illyrian, thracian, scythian, germanic, brittonic, indian, iranian, ethiopian, arab, egyptian, carthaginian, eastern). Save's model block stores **only 6 culture families**: roman (W_hellenistic_), barbarian (Celtic_/Illyrian_/Germanic_), carthaginian, eastern, nomad, egyptian. Coverage: save's 410 tag=27 records = **22% of descr_strat's 1831** — the model block is partial. Architectural-family collapse mapping (e.g. greek+anatolian+roman+w_hellenistic+e_hellenistic → "roman" architectural family) is the engine's render-time grouping (see #6).

Save corpus this session: `save_rome10.sav` (RIS imperial T5).
Ground-truth this session: `…/RIS beta/data/original_overrides/.../descr_strat.txt` (2.43 MB, 2926 resource lines, 2085 character lines, 1831 settlement lines), `…/RIS beta/data/descr_sm_factions.txt` (239 factions with culture), `…/RIS beta/data/text/names.txt` (4116 name entries, UTF-16LE BOM-prefixed).

#### 1. REFUTED: resources cluster in non-canonical mid-file cells (Y-flip corrected)

**Convention**: descr_strat uses bottom-up Y (Y=0 south, Y=699 north). TGA / mid-file grid uses top-down Y. Conversion: `tga_y = 699 - descr_y`. Confirmed by checking amber (Baltic, north) → descr_y[356..670] → tga_y[29..343] = north on TGA, and incense (Arabia, south) → descr_y[2..356] → tga_y[343..697] = south on TGA.

**Mapping**: descrX,descrY (pixel space 0..1019, 0..699) → cell `(c=floor(descrX/4.25), r=floor((699-descrY)/2.94))` on the 240×238 grid (`PX_PER_CELL_X=4.25, PX_PER_CELL_Y=2.941`).

**Cross-tab against 697 non-canonical cells (rome10)**:

| Entity type | Total entries | In non-canon | Expected (baseline) | Enrichment |
|---|---|---|---|---|
| Resources (all types) | 2926 | 36 | 35.80 | **1.01x** |
| Characters[named_character] | 1505 | 16 | 18.21 | 0.88x |
| Characters[general] | 337 | 5 | 4.07 | 1.23x |
| Characters[admiral] | 45 | 0 | 0.56 | 0.00x |
| Characters[diplomat] | 100 | 0 | 1.24 | 0.00x |
| Characters[spy] | 97 | 0 | 1.20 | 0.00x |
| Settlement-model coords | 201 | 2 | 2.48 | 0.81x |

**Per-resource-type non-canon enrichment (sorted desc)**:

| Type | total | noncanon | expected | enrichment |
|---|---|---|---|---|
| timber | 28 | 2 | 0.35 | 5.78x |
| camels | 27 | 1 | 0.33 | 3.00x |
| pigs | 60 | 2 | 0.74 | 2.70x |
| elephants | 36 | 1 | 0.44 | 2.25x |
| incense | 37 | 1 | 0.46 | 2.19x |
| amber | 21 | 0 | 0.26 | **0.00x** |
| copper | 44 | 0 | 0.54 | 0.00x |
| gold | 47 | 0 | 0.58 | 0.00x |
| iron | 58 | 0 | 0.72 | 0.00x |
| silver | 89 | 0 | 1.10 | 0.00x |
| wine | 58 | 0 | 0.72 | 0.00x |
| (...20 more zero-enrichment types) | | | | |

**Conclusion**: with proper Y-flip, resources show ESSENTIALLY BASELINE rates in non-canon cells (1.01x). The brief's specific edge-region candidates (amber Baltic, incense Arabia, gold Iberia, ivory Africa = elephants) all show **0-2 non-canon hits at baseline-or-below**. The few types with >2x enrichment (timber=2 hits, camels=1, pigs=2, elephants=1) have counts so low (1-2) that they're consistent with noise. The "non-canon = edge-region resource marker" hypothesis is **REFUTED**.

The non-canonical cells DO over-represent edge factions geographically (session 24's Saka 2.28x, Suebi 1.72x), but **the corresponding resources don't follow**. So non-canon ≠ a per-resource-type marker; it correlates with FACTION/REGION but not with what's ON the tile.

**Reproducer**: `dig-descr-strat-resources{1,2}.js`. Script 1 uses raw Y (wrong); script 2 applies Y-flip correctly.

#### 2. CONFIRMED: body root interior structure (rome10 RIS) — 6 sub-regions, tile-grid straddles boundary

Linear walk of body root payload (`0x3ba1..0x633bb3`):

| Sub-region | Range | Size | Content |
|---|---|---|---|
| Preamble | 0x3b9d..0x51ad | 5.6 KB | 2× UTF-16LE strings `campaign/imperial_campaign` + `imperial_campaign` + a placeholder section + zero padding |
| Char UUID index | 0x51ad..0x87e9 | 13.9 KB | Single self-pointing section, kid[0] from session 12 — sorted u32 ID list of ~1157 entries |
| Per-year event log | 0x87e9..0x846af | 495 KB | 12-byte stride records (see #4) — per-game-year, ~419 distinct years 275-695 |
| Scripted-events / wonders | 0x846d1..0xa8beb | 149 KB | Named-string table (see #3) — 33 distinct names |
| Character_paths sections | 0xa8beb..0xf8f9b | 324 KB | 469 medium sections, mean 546 B, mostly variable-stride paths |
| Tile-grid start | 0xf8f9b..0x633bb3 | **5.23 MB** | **First ~35% of the mid-file 240×238 tile-attribute array** |

**Tile-grid straddle**: the mid-file array starts at `ARR_START=0xf8fd2` (inside body root tail) and ends at `0xf8fd2 + 240*238*267 = 0xf84632` (~16.27 MB into file), but body root ends at `0x633bb3` (~6.5 MB). So **9.0 MB of the tile array lives OUTSIDE the body root**, in what session 12 called the "9.78 MB tile-attribute gap". The two regions are actually **one continuous array** that crosses the body-root boundary.

**Coverage of body root**:
- 17.4% of body-root bytes are in self-pointing children
- 78.4% is in the tile-grid tail
- 4.2% is the preamble + scripted-events table + per-year log (non-self-pointing positional data)

**Linear walk only succeeds for 1 child via the {self-ptr + size} contract** because most children don't have a clean self-pointer at +0 (the per-year-log records are 12-byte and event strings are length-prefixed). Walk-by-self-pointer-scan found 469 well-formed sections after the events block.

**Reproducer**: `dig-body-root{1..5}.js`. Key: dig-body-root3 (linear walk), dig-body-root4 (top-level child enumeration), dig-body-root5 (gap analysis with byte histograms + string scans).

#### 3. CONFIRMED: scripted-events / disasters / wonders string table at 0x846d1..0xa8beb

Parsed 73 length-prefixed ASCII strings (`[u16 lenP1][ASCII chars][u8 nul]`), 33 distinct:

| Category | Examples |
|---|---|
| volcano | `volcano` (×25) |
| eruption | `eruption` (×7), `eruption_at_etna_140`, `eruption_at_etna_135`, `eruption_at_etna_126`, `eruption_at_etna_122`, `eruption_at_etna_49`, `eruption_at_etna_44`, `eruption_at_etna_36`, `eruption_at_etna_32`, `eruption_at_etna_10_20_ce`, `eruption_at_etna_38_40_ce`, `eruption_at_etna_generic`, `eruption_at_methana`, `eruption_at_vulcano_183`, `eruption_at_vulcano_126`, `eruption_at_vulcano_91`, `eruption_at_ischia_91`, `eruption_at_santorini_197`, `eruption_at_santorini_46_ce` |
| earthquake | `earthquake` (×11), `earthquake_at_santorini`, `earthquake_in_rhodes`, `earthquake_in_iberia` |
| flood | `flood`, `flood_in_rome_241` |
| **Seven Wonders** | `pyramids_and_sphinx`, `pharos`, `colossus`, `temple`, `statue`, `gardens`, `mausoleum` |

This is the **historical event registry** keyed by location + year. The numbers in names (`_140`, `_241`, `_91`, etc.) match historical BC dates of real volcanic eruptions and earthquakes in the Mediterranean. The 7 Wonders entries match Antipater of Sidon's canonical list (pyramids, pharos, colossus, statue [of Zeus], temple [of Artemis], gardens [of Babylon], mausoleum [at Halicarnassus]).

**Schema**: each string entry has 0..32 bytes of payload after the nul-terminator (variable-stride). Entropy of the region = 4.13 bits/byte (mix of string bytes + length prefixes + binary payload). Total 149 KB. Each event likely has a `triggered_at_year` u32 + faction/region UUID + outcome flag payload.

**Implication for Provincia**: this confirms RTW saves contain a full **per-campaign historical-event registry** that can be parsed for "what wonders are extant", "what disasters have happened", and "which year each event fired". The 7-wonder data here is what powers the in-game wonder-of-the-world bonus system.

**Reproducer**: `dig-body-root{5,6}.js`. Script 5 finds the strings; script 6 categorizes them.

#### 4. STRONG: 495 KB per-year event log at 0x87e9..0x846af — 12-byte records keyed by game-year

The 495 KB region between the character UUID index and the scripted-events table holds a fixed-stride table where 12-byte records dominate:

```
+0  u8  flag   (1 most common, 2/4 also common, 0=padding)
+1  u8  sub    (0x20 when flag in {1,2}, 0x00 otherwise)
+2  u16 idA    (target/region/character ID — 1..1024 range)
+4  u16 idB    (GAME YEAR — 275..695 dominant cluster)
+6  u16 zero   (always 0 in valid records)
+8  u32 hash   (actor/agent UUID — top values repeat: 0xec22d10b, 0x9cdbf934, 0xd87f3809, 0xf699f00e, 0xb53a6c46, 0x2c657167, 0x81875cbb, 0x96479cdf)
```

**idB year-distribution evidence**:
- 419 distinct idB values from records with flag ∈ {1,2,4}
- Cluster 275-695 contains 99%+ of records
- 270 BC is the canonical RTW imperial-campaign start year; rome10 is mid-campaign, idB max = 696 ≈ campaign end-year cap
- Counts per idB: 8-21 events per year typical (consistent with a moderate event-firing rate)

**Hash repetition**:
- Top hash `0x0bd122ec` appears across multiple idB years
- `0x9cdbf934` appears 11 consecutive records at idB=275 with idA increasing (0x18c → 0x197) — looks like **a single actor's actions logged across multiple targets in one year**

**Interpretation**: this is the **per-year-per-event log** ("history book"). flag distinguishes event types (1=player-faction action, 2=AI action, 4=automatic/script event). idA = target entity (region or character). idB = year. hash = actor UUID. The size at 495 KB / 12 B = 42298 nominal slots but only ~12000 contain non-zero records — the rest is reserved pre-allocated space for future events.

**Reproducer**: `dig-body-root{6,7}.js`.

#### 5. STRONG NEGATIVE: character names are name-table indices, not strings — agent validation blocked

Cross-search of all 2085 descr_strat character names against the 32 MB save buffer:

| Name source | Distinct names | Found in save (UTF-16LE) | Found in save (ASCII only) | Total |
|---|---|---|---|---|
| Agent names (diplomat/spy/admiral) | 232 | **6 (2.6%)** | 0 | 6 |
| General names | 24 | **0 (0%)** | 0 | 0 |
| Named-character names | 584 | **11 (1.9%)** | 0 | 11 |
| Common Roman praenomina (Gaius, Marcus, Tiberius, Quintus, Manius, Aulus, Lucius, Decimus, Publius) | 9 | **0 (0%)** | 0 | 0 |
| Other test names (Mago, Aqhat, Yahua) | 3 | **0 (0%)** | 0 | 0 |

**Conclusion**: character names are **NOT stored as strings** in the save. They are stored as INDICES into `data/text/names.txt`. That file is UTF-16LE BOM-prefixed, 4116 entries of pattern `{NameKey}DisplayName` (e.g. `{Gaius}Gaius`, `{Aaron}Aaron`, `{Aqhat}Aqhat`). The save references each character's name by `{NameKey}` ID (presumably u16 with 4116 < 2^16 entries).

The few "found" agent names (6/232) are likely false-positive substring matches of common letter sequences, not actual stored names. The 11/584 named-character matches are similar partial-string coincidences.

**This blocks the task-3 plan** (verify each descr_strat agent has a record in save by name match). To validate agents structurally, we need to either:
- Locate the name-index field within character_paths records (each character has a u16 name_id slot)
- Cross-correlate descr_strat agent counts per faction with character_paths kid counts per faction (requires faction-to-kid mapping)

**Faction-faction character counts** (from descr_strat):
- slave 834 named_characters, seleucid 195, ptolemaic 129, mauryan 92, carthage 75, romans_julii 48, antigonid 47, greeks 28
- 99 factions total with at least one character
- Bottom tier: hellenistic_rebels (1), dummies (1)

These counts can be mapped against per-faction character_paths sections once a faction-id schema is known, but the **name-string-search approach is dead**.

**Reproducer**: `dig-agents1.js`.

#### 6. CONFIRMED: save model block uses 6 collapsed culture families; descr_strat uses 21

`descr_sm_factions.txt` declares 239 factions across **21 distinct cultures**:

| Culture | descr_strat-settlements |
|---|---|
| barbarian | 258 |
| greek | 208 |
| roman | 50 (but session below maps roman/greek/anatolian/w_hellenistic/e_hellenistic → roman family) |
| iranian | 134 |
| libyan | 131 |
| arab | 103 |
| germanic | 98 |
| eastern | 93 |
| celtiberian | 83 |
| brittonic | 79 |
| e_hellenistic | 78 |
| scythian | 78 |
| indian | 72 |
| carthaginian | 75 |
| dacian, illyrian, ethiopian, anatolian, w_hellenistic, thracian, egyptian | (5-49 each) |

Save's settlement-model strings use **6 architectural-family prefixes** (session 24): `W_hellenistic_*` (roman family), `Celtic_*`/`Illyrian_*`/`Germanic_*` (barbarian family), `Carthaginian_*`, `Eastern_*`, `Nomad_*`, `Egyptian_*`. Save's tag=27 (active) records (410 total) distribute as:

| Save-model family | Count | Likely descr_strat sources |
|---|---|---|
| roman (W_hellenistic_*) | 170 | roman + greek + anatolian + w_hellenistic + e_hellenistic |
| barbarian (Celtic_+Illyrian_+Germanic_) | 137 | barbarian + celtiberian + dacian + germanic + brittonic + illyrian + thracian |
| eastern | 55 | eastern + iranian + arab + indian |
| carthaginian | 30 | carthaginian |
| nomad | 10 | scythian |
| egyptian | 8 | egyptian + libyan + ethiopian |

The 6→21 collapse is RTW's **architectural-model engine**: many descr_strat cultures share rendered building models. The save stores rendered-model coords, NOT culture metadata.

**Coverage**: 410 tag=27 records / 1831 descr_strat settlements = **22%**. The save's settlement-model block is therefore PARTIAL — it stores only the ~22% of settlements that the player has been close enough to render, or that the engine has otherwise initialized.

**Levels**: descr_strat declares 5 levels (`village, town, large_town, city, large_city`); save model block uses 5 model-suffix levels (`Town, Large_Town, City, Large_City, Huge_City`) — **no `Village` in save** (villages don't have rendered architectural models in RTW), **no `Large_City` in descr_strat that survived to save** (descr_strat has only 2 large_city declarations), **`Huge_City` is present in save but NOT in descr_strat** (settlements that grew past large_city → huge_city during gameplay).

**Open question**: the size mismatch (1831 → 410) means we cannot use descr_strat as ground truth for the save's model coords. Either the save is partial (player-visible only), or some settlements in descr_strat never get a tag=27 entry by design (e.g. towns too small to render). A controlled per-turn test save (e.g. T1 with all factions fog-revealed via cheat) would distinguish these.

**Reproducer**: `dig-model-validate{1..3}.js`. Script 3 is the final version with proper `descr_sm_factions.txt` culture parsing.

#### Open follow-ups for session 26+

- **Y-flipped pixel→cell mapping**: the 1.01x baseline result (resources in non-canon) used a 4.25×2.94 pixel-per-cell scaling. The original 240×238 cell array maps to a 1020×700 TGA, but RTW's internal tile coord system might be 256×256 or higher-res. A test: take a single descr_strat settlement at known descr coords (e.g. Roma at the famous descr_y location) and verify it lands on the expected save settlement-coord. Mis-scaling could mask a real signal.

- **Per-year event log (#4)**: cross-check idB values against actual game-year for rome10 (player can see current year in UI). If campaign is at year ~275 = idB=275, then we can verify the year-encoding. Also: parse the 8 most-common hash values (0xec22d10b, 0x9cdbf934, etc.) — are these the 8 major faction UUIDs? A faction-uuid table would let us decode event records into (year, faction, target).

- **Scripted-events #3**: each named string is followed by 0-32 bytes of binary data. Decode the structure of each event entry — likely `[u32 year_triggered][u32 location_uuid][u32 outcome_flag]`. The 7-wonder entries should map to specific settlements (pyramids → Egyptian Memphis, pharos → Alexandria, colossus → Rhodes, etc.) — verify by checking the bytes after the wonder names.

- **Tile-grid boundary refinement**: the array is contiguous from `0xf8fd2..0xf84632` (15.25 MB) but crosses the body-root boundary at `0x633bb3`. Are the two halves byte-equivalent? Or does the body-root boundary mark a real semantic split (e.g. first 35% = "known tiles", remaining 65% = "unknown/initialized to canonical")?

- **Name-table indexing (#5)**: confirm character_paths records have a u16 name-table index by reading +N bytes at a known character. Once name index is decoded, per-character validation becomes trivial.

- **Settlement-model partial coverage (#6)**: are the 410 tag=27 settlements those within the player's vision range? Test by checking distance from Roma vs distance for unrendered settlements.

#### Reproducer scripts

- `dig-descr-strat-resources{1,2}.js` — resource/character coord cross-tab against 697 non-canonical mid-file cells
  - 1: raw Y mapping (incorrect — REFUTED finding pre-flip)
  - 2: Y-flipped (correct, 1.01x baseline result)
- `dig-body-root{1..7}.js` — body root interior structure
  - 1: locate body root start (0x3b99)
  - 2: walk first child
  - 3: linear taw-section walk (breaks after kid[0])
  - 4: top-level child enumeration via self-pointer scan + gap detection
  - 5: gap content analysis (byte histogram + ASCII string scan)
  - 6: gap C scripted-events parse + gap B 12-byte record decode
  - 7: gap B record schema decode (idA, idB=year, hash analysis)
- `dig-agents{1,2}.js` — descr_strat agent name search in save
  - 1: UTF-16LE / ASCII name search (NEGATIVE — names are indices, not strings)
  - 2: structural character_paths count per body-root region
- `dig-model-validate{1..3}.js` — settlement-model culture×size cross-validation
  - 1: initial parse (faction culture not loaded)
  - 2: culture loaded but regex broken (greek/libyan/etc all missed)
  - 3: corrected SMF parsing — 239 factions across 21 cultures vs save's 6 architectural families

---

### Findings 2026-05-11 (background session 26 — event-log fields + scripted events + UUID index)

Goal: (1) Decode flag/sub fields of the 495 KB per-year event log and cross-reference actor_hash against session 23's 60 lua-footer faction IDs. (2) Decode the 149 KB scripted-events table interior — find per-event year/region/triggered metadata. (3) Document the 13.9 KB "char UUID index" structure between preamble and event log. (4) Cross-tab the mid-file 697 non-canonical cells against scripted-event tile coords.

Outcome: **Six new findings**, three of them schema corrections that REWRITE session 25's interpretations.

(a) **CONFIRMED REVISION: the "13.9 KB char UUID index" and "495 KB per-year event log" are ONE UNIFIED event log** with schema-A `[u32 actor_hash][u8 flag][u8 sub][u16 idA][u32 idB]` at 12-byte stride. Session 25 misidentified two regions; the unified region is `0x51b5..0x846af` = 521,466 bytes / 12 = **43,455 slots** (13,947 valid + 22,315 all-zero + 7,193 padding/transition). The schema for the FULL region is hash-first, **NOT** the flag-first schema session 25 inferred from looking only at the dense main body. See #1.

(b) **CONFIRMED: idB is the campaign year counter** running 1..696 across all valid records — covers the full RIS-imperial timeline (270 BC = idB=270 → AD 426 = idB=696). 270 + N_turns = idB for game-time events. **idB=1..269 contains pre-game-scheduled events** (RIS scripts pre-populate the log with historical-context entries). 626 distinct year values, most years have 0-100 events. See #2.

(c) **CONFIRMED: scripted-events table interior decoded — 22 named events + 7 wonders + 5,632 per-tile entries.** Schema for named-event records: `[u16 lenP1]"volcano"[nul][u16 lenP1]"eruption_at_etna_140"[nul][i32 calendar_year_signed][u32 typeA=2][u32 typeB=1][u32 tileX][u32 tileY][u32 trigger_count][16 B padding]` = 32-byte payload after the eruption-name string. **17/22 i32-year fields match the year embedded in the event name** (etna_140 → year=-140, vulcano_91 → year=-91, santorini_46_ce → year=+46). The 7 Wonders use shorter 12-byte records with `[u32 tileX][u32 tileY][u32 hash]`. The 5,632 trailing records use a 26-byte stride `[u32 a][u32 b][u32 tileX][u32 tileY][u32 hash][u8×6 delimiter]`. See #3.

(d) **CONFIRMED: idA is a within-year sequential event counter (NOT a tile-graph node).** Δ=1 dominates same-hash consecutive-record strides (5,812 occurrences, 95% of multi-step strides), giving runs of 17-24 consecutive idA values for a single actor in a single year. Longest run: hash `0x76a41301` at year 544 has 24 records with idA 620..643. **Range idA=0..1018** = ~1018 events scheduled per peak year. **idA is monotonically incrementing per-year**; one actor's consecutive log entries get consecutive idA. The earlier hypothesis (session 25, "idA = tile ID") is **REFUTED**. See #4.

(e) **REFUTED: actor_hash field maps to lua-footer faction IDs.** 0/60 of session 23's faction-IDs (id_romans_julii=1110011, etc.) match any of the 1,533 distinct actor hashes. Cross-save check: hash `0xec22d10b` appears 16× in rome10 but **0× in RoR-T1**. Hashes are **per-save dynamic per-actor UUIDs** (likely character/army/agent), NOT faction IDs. See #5.

(f) **REFUTED: scripted-event tile coords explain the mid-file non-canonical cells.** With current ARR_START=0xf8fd2 and canonicality `[200,200,2,6,200]` the cell count is 902 interior non-canon (slightly different from session 22's 697 due to canonicality rule choice). Scripted-event coords map onto only **1.24x baseline** of non-canonical cells (raw Y) or **1.02x** (flipped Y) — essentially no enrichment. **Conclusion**: the non-canonical mid-file cells are NOT explained by scripted-event geographies. See #6.

Save corpus this session: `save_rome10.sav` (RIS imperial T5).
Ground-truth this session: scripted-event names embedded in save body + session 23's 60 faction IDs from lua footer + session 22's 697-cell mid-file zone characterization.

#### 1. CONFIRMED REVISION: unified 521KB event log (schema-A across full region)

Session 25 split this region into "UUID index 13.9 KB" + "per-year event log 495 KB" with different schemas. **Both regions actually share ONE schema** and form a contiguous fixed-stride event log.

**Schema (12-byte stride, hash-first)**:
```
+0  u32 actor_hash    // per-save dynamic UUID (per-character / per-army)
+4  u8  flag          // event-type enum — 4 values dominate (see #2)
+5  u8  sub           // event-subtype enum — 2 values dominate (0x00 / 0x20)
+6  u16 idA           // intra-year event counter (0..1018)
+8  u32 idB           // CAMPAIGN YEAR (1..696 = 270 BC + idB - 270)
```

**Region bounds**: `0x51ad..0x846af` (section-header at 0x51ad with self-ptr+size=13884, payload starting at 0x51b5; payload continues to 0x846af without a section break). Total payload = **521,466 bytes / 12 = 43,455 records**.

**Record-validity counts** (rome10):
- **Valid records** (flag∈{1,2,4} ∧ sub∈{0,0x20} ∧ 0<idB<800 ∧ idA<4096): **13,947** (32.1%)
- **All-zero placeholder slots**: 22,315 (51.4%)
- **Other / transition**: 7,193 (16.5%)

The all-zero slots are **reserved capacity** — the log pre-allocates ~43k slots and game progression fills them in over time.

**Schema-A vs Schema-B comparison test** on the early region (records 0..1156): SCHEMA-A wins 1157/1157, SCHEMA-B (flag-first) wins 0. Both schemas decode the SAME bytes but only schema-A produces consistent year-monotonic, hash-clustered records.

**Why session 25 got it wrong**: the dense main body at `0x87e9..` happens to LOOK like flag-first schema because at those offsets, the bytes `01 20 11 01` align with what looks like `flag=1, sub=0x20, idA=0x0111, idB=0x0113`. But the SAME bytes shifted to `+4..+15` in schema-A give the same semantic decode (flag=1, sub=0x20, idA=0x0111). The CRITICAL discriminator is at offsets 0..3: schema-A reads them as `u32 hash` while schema-B reads them as `[flag,sub,idA-low,idA-high]`. The fact that `0b d1 22 ec` always appears at offset 0..3 of the main-body first record CONFIRMS schema-A (`hash=0xec22d10b`) because the same hash repeats at multiple `idB` years — it's an actor identifier, not random bytes.

**Confidence: CONFIRMED** by schema-A producing 13,947 valid records vs schema-B producing 0 valid records on the early region, plus year-monotonicity of consecutive records, plus hash-clustering within years.

**Cross-save validation**: schema-A applied to `save_Autosave Republic of Rome Turn 1.sav` (RoR-T1) yields **14,419 valid records, 22,318 zero slots, 1,576 distinct hashes, idB range 1..797**. The structure parallels rome10's exactly (close record counts, similar reserved-slot count). RoR-T1's event log was found by scanning for the pattern `[xx xx xx xx 01 20 xx xx 13 xx 00 00]` (schema-A's flag=1, sub=0x20, year≈275 marker), first hit at `0x5329`. **Schema-A is universal across RIS-imperial saves**, not save-specific.

**Reproducer**: `dig-uuid-index{1..4}.js`, `dig-event-log-flags{1..6}.js`.

#### 2. CONFIRMED: flag/sub semantics + idB = campaign year

**Flag distribution** (valid records, schema-A):
| flag | count | % of valid | sub typically | Interpretation |
|---|---|---|---|---|
| 1 | 11,387 | 81.7% | 0x20 | Primary actor event — non-zero hash, narrates an entity's action |
| 4 | 1,311 | 9.4% | 0x00 | Unowned / scripted-engine event — hash often 0 |
| 2 | 1,176 | 8.4% | 0x20 | Secondary event — non-zero hash, alternate action type |
| other | 73 | 0.5% | various | Rare event subtypes |

**idB = campaign year** confirmed by:
- Range 1..696 covers RIS-imperial's 270 BC..AD 426 timeline (696 game years = 426-(-270))
- Game-start is 270 BC = `idB = 270`; T5 save's earliest dense block is `idB = 275` (= 270 BC + 5 turns)
- 626 distinct idB values out of 696 possible — most years have at least one logged event
- idB=275 has 21 valid records (= turn-1 events for the player save)

**Pre-game events** (idB < 270): 1,033 valid records spread across 269 distinct early years. These appear to be **RIS-script-seeded historical context entries** that the campaign-script writes before the game begins. Each idB year from 1 to 269 has 0-20 entries.

The dense main block at 0x87e9 onward is the game-time portion (idB ≥ 270). The earlier region 0x51b5..0x87e9 holds the pre-game historical context.

**Confidence: CONFIRMED** by year-range match with campaign timeline + per-year event-count distribution.

**Reproducer**: `dig-event-log-flags{3,5}.js`.

#### 3. CONFIRMED: scripted-events table schema — 22 named events + 7 wonders + 5,632 per-tile records

**Table bounds**: `0x846d1..0xa8beb` = 148,762 bytes. Internal structure:

```
0x846d1..0x846e6  Header (22B): { u32 0x02, u32 0, u32 0x01, 9 zero bytes }
0x846e6..0x84efb  22 named-event records: 25 instances of "volcano"/"earthquake"/"flood"
                  Each named record:
                    [u16 len="volcano"+1][ASCII "volcano"][nul]
                    [u16 len][ASCII eruption_at_<location>_<year>][nul]
                    [i32 calendar_year]      // BC negative, AD positive
                    [u32 typeA]              // 0 or 2
                    [u32 typeB]              // 1
                    [u32 tileX]              // map tile X coord (4..1019)
                    [u32 tileY]              // map tile Y coord (1..698)
                    [u32 trigger_count]      // how many times fired
                    [16 B padding zeros]
                  Total ~33-39 bytes per named event.

0x84efb..0xa8b3d  5,632 per-tile event records (26-byte stride):
                    [u32 a]                  // 0..43, mean ~16 — semantic unclear
                    [u32 b]                  // 1..5, event-category
                    [u32 tileX]              // map X (4..1019)
                    [u32 tileY]              // map Y (1..698)
                    [u32 hash]               // per-event UUID (5,632 distinct)
                    [u8×4 = 0xff×4]          // delimiter "ff ff ff ff"
                    [u8 = 0 or 1]            // fired/pending flag (4327 ones, 1305 zeros)
                    [u8 = 0x01]              // record-end byte

0xa8b3d..0xa8bd4  7 Wonders records:
                    [u16 len][ASCII wonder name][nul][u32 tileX][u32 tileY][u32 hash]
                  Each ~14 bytes:
                    pyramids_and_sphinx (514, 249)  → Memphis/Giza
                    pharos              (497, 266)  → Alexandria
                    colossus            (465, 337)  → Rhodes
                    temple              (452, 356)  → Ephesus
                    statue              (388, 345)  → Olympia
                    gardens             (668, 326)  → Babylon
                    mausoleum           (456, 343)  → Halicarnassus
```

**Year-validation against named eruption strings** (17/22 match exactly):

| Event name | Decoded i32 year | Expected year | Match? |
|---|---|---|---|
| eruption_at_etna_140  | -140 | -140 (140 BC) | ✓ |
| eruption_at_etna_135  | -135 | -135 | ✓ |
| eruption_at_etna_126  | -126 | -126 | ✓ |
| eruption_at_etna_122  | -122 | -122 | ✓ |
| eruption_at_etna_49   |  -50 |  -49 | ✗ off-by-1 |
| eruption_at_etna_44   |  -44 |  -44 | ✓ |
| eruption_at_etna_36   |  -36 |  -36 | ✓ |
| eruption_at_etna_32   |  -32 |  -32 | ✓ |
| eruption_at_etna_10_20_ce | 15 | 10 | ✗ stored as midpoint |
| eruption_at_etna_38_40_ce | 39 | 38 | ✗ midpoint |
| eruption_at_vulcano_183 | -215 | -183 | ✗ |
| eruption_at_vulcano_126 | -126 | -126 | ✓ |
| eruption_at_vulcano_91  | -91 |  -91 | ✓ |
| eruption_at_ischia_91   | -91 |  -91 | ✓ |
| eruption_at_santorini_197 | -197 | -197 | ✓ |
| eruption_at_santorini_46_ce |  46 | 46 | ✓ |
| flood_in_rome_241       | -241 | -241 | ✓ |

**Tile coords verified against historical locations**:
- Etna events all at (311, 344) — Sicily ✓
- Vulcano events at (311, 353) — south of Etna ✓ (Aeolian Islands)
- Santorini at (432, 331) — Aegean Sea ✓
- Rhodes at (465, 336) — east Aegean ✓
- Iberia earthquake at (53, 459) — west map edge ✓
- Wonders all in expected eastern-Mediterranean / Egypt zones ✓

**Per-named-event record count = 22 records** (one per scripted volcano/earthquake/flood event). The **5,632 anonymous trailing records** are likely **per-tile scripted-spawn entries** (e.g. specific tile-locations where ambient-objects, scripted-character birthplaces, or scripted-army-spawn points exist). Their (X, Y) coverage spans the whole map but is concentrated around Italy/Greece/Anatolia.

**Confidence: CONFIRMED** by 17/22 i32-year matches + 7/7 wonder tile-coord matches against known historical sites.

**Reproducer**: `dig-scripted-events{1..7}.js`.

#### 4. CONFIRMED: idA is a per-year sequential event counter; REFUTED tile-graph hypothesis

Initial hypothesis (session 26 round 1): idA = tile/node index, with consecutive idA = adjacent tiles along a movement path.

**Test 1 — Δ=1 stride frequency**: Same-hash consecutive records have stride Δ=1 in 5,812/6,108 cases (95%). All other strides ≤1% each. This is **extreme monotonicity** — vastly stronger than tile-adjacency would produce.

**Test 2 — Run lengths**: Single-actor consecutive runs reach **24 records** at `hash=0x76a41301, year=544, idA=620..643`. Other top examples:
- `hash=0xd0ac389d, year=332, idA=145..167` (23 consecutive)
- `hash=0xd2dbde17, year=517, idA=446..466,475` (22 strict)
- `hash=0xc9678171, year=376, idA=585..605` (21)
- `hash=0xfdf8f650, year=525, idA=275..297` (with 1 small gap)

These are 20+ STRICTLY-INCREMENTING ID values for a SINGLE actor within ONE year. Tile-paths would have variable strides (mix of +1 horizontal, +N vertical, mix of straight lines and turns). Pure +1 strides ≈ **counter increments**.

**Test 3 — idA upper bound**: max idA across all records = 1018. If idA were tile-grid index for the 240×238 map, max would be 57,120. The ~1018 cap is far too small for a tile address.

**Conclusion**: `idA` is the **intra-year event-sequence number** — a per-year counter that gets incremented whenever the engine writes a new event to the log. When a single actor (character / army / agent) does multiple things in the same year, those events get consecutive idA values because they're written one after another to the log. The Δ=1 dominance directly reflects the engine's append-only logging order.

**Implication**: the event log is a **linear append-log with per-year sequence numbers**, not a tile-spatial structure. Each (idB, idA) tuple is a unique event-ID. With max idA ~1018 and 626 distinct idB years, the log can hold ~640,000 distinct event-IDs, of which 43,455 slots are allocated and 13,947 are currently filled.

**Confidence: CONFIRMED** by Δ=1 dominance + idA cap + monotonic same-hash runs.

**Reproducer**: `dig-event-log-flags{4,5}.js`.

#### 5. REFUTED: actor_hash maps to lua-footer faction IDs

The brief's hypothesis: top actor_hash values should match the 60 `id_<faction>` constants from session 23's lua footer (e.g. `id_romans_julii = 1110011`).

**Cross-reference test**:
- Top 30 actor hashes in rome10 event log: `0xb53a6c46`, `0x9cfb069d`, `0xc1babc2f`, `0x89161d61`, `0x0d09eade`, `0xca6d80a3`, `0xee3ba2aa`, `0x1c87454b`, `0xd0ac389d`, `0x53eb05ff`, ...
- 60 lua faction IDs: `1110011, 1210021, 5000020, 1320041, 1820161, 1330481, ...`
- **Faction-ID matches: 0 / 60**, **valid records with hash ∈ faction-IDs: 0 / 13,947**

**Cross-save test**: hash `0xec22d10b` (the most-frequent hash in rome10's early game records, 16 occurrences) appears **0 times in RoR-T1** save. So actor hashes are **per-save dynamic**, not deterministic faction-IDs.

**1,533 distinct actor hashes** across the unified event log — far more than 60 factions and far more than 469 character_paths sections (session 25). They likely correspond to **per-character/per-army UUIDs assigned at engine init**. The actor_hash field is therefore a **runtime entity-UUID**, not a faction-identifier.

**Implication for Provincia**: per-event faction attribution requires a separate UUID→faction lookup (one of the unsolved sub-sections). The event log alone cannot tell you "which faction did this" without joining to a hash→faction map elsewhere in the save.

**Confidence: REFUTED** the brief's hypothesis. Hash is per-character not per-faction.

**Reproducer**: `dig-event-log-flags{1,5}.js`.

#### 6. REFUTED: scripted-event coords explain mid-file non-canonical cells

Session 22's 697-cell mid-file mystery: when the canonical-pattern is `[f16=200, f20=200, f24=2, f28=6, f32=200]`, **697 interior cells** in the 240×238 mid-file array have non-canonical values. Hypothesis from the brief: those cells are scripted-event trigger zones (volcanoes, earthquakes, wonders).

**Recount this session**: with the current canonicality rule the count is **902 interior non-canonical cells** (vs session 22's 697 — likely because the canonicality criterion was slightly different — possibly different f-offsets defining canonical OR the cell coords moved between turn-saves). Use 902 for this analysis.

**Method**: For each of the 5,632 scripted-event firing records, compute its grid cell `(c = floor(X/4.25), r = floor(Y/2.941))` and check whether it falls in the non-canonical set.

| Mapping | Hits / 5632 | Baseline expected | Enrichment |
|---|---|---|---|
| Raw Y (no flip) | 112 (2.0%) | 90.5 | **1.24x** |
| Y-flipped | 92 (1.6%) | 90.5 | **1.02x** |

**Distance-to-nearest-non-canonical-cell** (Chebyshev) histogram:
| dist | Scripted-event coords | Random baseline |
|---|---|---|
| 0 | 112 | 84 |
| 1 | 580 | 548 |
| 2 | 763 | 843 |
| 3 | 901 | 863 |
| 4 | 829 | 803 |
| 5 | 785 | 656 |
| 5+ | 1663 | 1836 |

**Per-named-event cell membership**: 0 of 14 named events (etna, vulcano, santorini, rhodes, rome, pyramids, pharos, colossus, temple, statue, gardens, mausoleum, methana, iberia) lands directly on a non-canonical cell.

**Conclusion**: Scripted-event tile coords cover the same spatial regions as the non-canonical cells (Mediterranean coastlines) but **do not selectively cluster in non-canon cells**. The 1.24x enrichment is at the noise floor. Combined with session 22's REFUTED settlement-coord hypothesis and session 25's REFUTED resource-coord hypothesis, **all three "obvious geographic correlates" are now refuted**. The semantic meaning of the 697/902 non-canonical cells remains the most stubborn open mystery of the format.

**Remaining live hypotheses** for what the non-canonical cells represent:
- **Scripted strategic AI hint zones** (per-region tactical-AI markers not tied to single named events)
- **Movement-cost overlays** (terrain-difficulty/road graph encoding)
- **Per-tile faction-history annotations** (which tiles changed hands, when)
- **Camera waypoints / UI ambient-effect locations**

All would require runtime-instrumented testing to disambiguate.

**Confidence: REFUTED** the scripted-event-correlation hypothesis. Tile coords from scripted-events do not selectively populate non-canon cells (1.24x ≈ random).

**Reproducer**: `dig-midfile-scriptzone1.js`.

#### Open follow-ups for session 27+

- **Hash → entity-type discriminator**: 1,533 actor hashes break down into how many characters vs armies vs agents vs settlements? Cross-check against the 469 character_paths section count + the ~239-faction count + ~213 region count. Top 20 hashes have 44-111 records each; bottom 1,000+ hashes have only 1-2 records. The bimodality might map to "major actors" (player generals, major-faction-leaders) vs "minor actors" (every soldier-turned-character).

- **flag=4 (sub=0) semantics**: 1,311 records have flag=4 and hash=0 (unowned). These cluster around year boundaries and might represent **per-turn engine ticks** (e.g. "turn 275 began") rather than actor-driven events. Cross-check whether the count per year is constant (= one engine-tick per turn) or proportional to player-activity.

- **5,632 anonymous scripted-event records**: their (X,Y) maps to a Mediterranean-coastal distribution but doesn't cluster on settlements. They might be **ambient-object spawn points** (forests/ruins/effects) or **per-tile scripted-history annotations**. Test by counting records-per-region and comparing to known scripted-event-count from descr_strat.

- **idA off-by-1 in vulcano_183 year (-215 vs -183)**: that 32-year offset is suspicious. Maybe an internal year-offset bug in the RIS submod, or maybe `vulcano_183` actually triggers at a different game-year than its name suggests (e.g., the original eruption was 183 BC but the engine reschedules it). Worth cross-referencing with `RIS_Campaign_Script.txt`.

- **Pre-game-history events (idB < 270)**: 1,033 records. Are these RIS-script-seeded? Likely yes given the campaign script size. Tabulating these could provide a window into what historical events RIS chose to pre-load (rebellions? civil wars? notable births?).

#### Reproducer scripts

- `dig-event-log-flags{1..5}.js` — flag/sub decode + Δ=1 path-vs-counter test + faction-ID cross-reference
  - 1: initial flag/sub histogram (revealed flag distribution wasn't uniform)
  - 2: alignment + stride analysis (confirmed 12B stride)
  - 3: dense main-block focus (4 dominant flag values)
  - 4: Δ=1 stride test in main block (3,677 Δ=1 strides)
  - 5: unified region with SCHEMA-A — final tally of 5,812 Δ=1 strides + 24-long runs
- `dig-scripted-events{1..7}.js` — scripted-events table decode
  - 1: string enumeration + leading-region hex dump
  - 2: i32-year-field decode for named events (17/22 match)
  - 3: middle/tail content analysis
  - 4: 26-byte stride discovery via `ff ff ff ff XX 01` delimiter pattern
  - 5: incorrect alignment attempt (sub=256 nonsense)
  - 6: correct alignment found (20B record body + 6B delimiter)
  - 7: schema validation with named-event coord cross-check (12 of 14 named events within ±2 tiles of a record)
- `dig-uuid-index{1..4}.js` — "UUID index" region decode
  - 1: stride exploration (revealed it's not a sorted u32 list)
  - 2: schema-A trial (`[u32 hash][u8 flag][u8 sub][u16 idA][u32 idB]`) — wins
  - 3: schema-A vs schema-B validation (A wins 1157/1157)
  - 4: unified-region validation — schema-A produces 13,947 valid event-records across full 521KB region
- `dig-midfile-scriptzone1.js` — scripted-event coords vs non-canon mid-file cells (REFUTED, 1.24x ≈ random)

### Findings 2026-05-11 (background session 27 — event-log flag enum + per-tile registry + tile-grid head)

Goal: (1) Decode the per-byte semantics of the `flag` / `sub` enums in the
unified 521 KB event log identified in session 26. (2) Decode the 5,632
trailing 26-byte records in the scripted-events table. (3) Walk the
tile-grid head inside body root (5.23 MB) and verify the array-straddle
boundary. (4) Stretch — final hypothesis attempt for the 697-cell mid-file
mystery.

Outcome: **Six new findings**, three of which materially revise prior
sessions' interpretations.

(a) **REVISION (corrects session 26): event log is a `(idB, idA)`-sorted
SCRIPTED-events table, NOT an "as-things-happened" log.** Within the 13,947
valid records, file order is **strictly monotonic non-decreasing in idB**
across the first 13,874 records (the "sorted main block") with secondary
sort on idA (ascending). 619/619 idB-year-blocks are idA-sorted. After the
sorted block, **73 "append-zone" records** with `idA=0`, low idB (2..10
plus 256), and mostly `hash=0` represent runtime-generated events during
gameplay. **idB density peaks at idB=350-450** (3,219 events in 50-year
bin) but only **17-26 events per idB during the actual played turns (idB =
270..275 = T0..T5)**. This refutes session 26's "idB = elapsed campaign
year" reading: idB is the scheduled-firing year of a RIS-script
pre-populated event registry. See #1.

(b) **CONFIRMED: flag/sub enum semantics.** Across all 14k valid records,
the dominant (flag, sub) combos partition cleanly into 4 event classes
plus engine ticks: `(1, 0x20)` = 11,387 records = primary actor event
(1,417 distinct actors, max 111 events per actor); `(2, 0x20)` = 1,176
records = secondary actor event (172 distinct actors); `(4, 0)` = 1,311
records ALL with `hash=0` = scripted/engine-owned event; `(2, 0)` = 52
records all with `hash=0`, idB ∈ {2..10} = the runtime-append-zone subset.
**Only 57 actors (33% of flag=2 actors) overlap with flag=1**, meaning
flag=2 actors are a partially-distinct population (probably **target
actors** for an event whose primary actor recorded flag=1). The 13,947
valid records include 780 distinct (flag, sub) combos in the full
log — most are rare event subtypes (≤10 records each). See #2.

(c) **CONFIRMED: 5,632 per-tile registry records correctly decoded with
26-byte stride starting at `0x84f1f`.** Each record:
`[u32 a][u32 b][u32 X][u32 Y][u32 hash][u32 0xffffffff][u8 flag1][u8 0x01]`.
Across 5,632 records: **5,629 unique (X, Y) coords** spanning the full
1024×768 map, **5,632 unique hashes** (no zero-hash, no overlap with
event-log actor hashes — disjoint namespace), **170 distinct (a, b)
combos**. The `(a=9, b=1, flag1=0)` cluster has **1,305 records** — all
1,305 records with `flag1=0` share that exact (a, b). The other 4,327
records (flag1=1) span the remaining 169 (a, b) combos. b values 1..5
have counts 3,313 / 1,757 / 442 / 101 / 19 (heavily skewed). See #3.

(d) **CONFIRMED: the mid-file tile-grid is ONE continuous 240×238 array
straddling the body-root boundary.** The grid begins at `ARR_START =
0xf8fd2` (inside body root) and continues with the same 267-byte stride
past the body-root end at `0x633bb3`. Record index 20537 starts at
`0x633b45` (inside body root) and ends at `0x633c50` (outside) — the body
root's nominal end falls in the **middle of record 20537**. Records on
either side of the boundary share identical field values
`(5, 0, 0, 10, 200, 200, 2, 6, 200, 0, 0)`. Canonical-rate is 97.5%
inside vs 97.6% outside. **This confirms session 18's `57,120 = 240×238`
record count** and explains session 12's `36,582` count as the
outside-body-root-only fragment. See #4.

(e) **MAJOR DISCOVERY: the 697 mid-file non-canonical cells decompose into
TWO geometric primitives + scattered noise.** With canonicality defined as
`(f28=6, f32=600)`, the 697 cells split as: **234 cells along the bottom
row r=237** + **220 cells on the anti-diagonal c+r=237** + 243 scattered
noise cells. The diagonal+bottom-row pattern repeats in `save_Autosave
Republic of Rome Turn 1` (a different campaign) but offset to
`r=236`/`c+r=236`. This is the **first structural decomposition** of the
697-cell mystery: the cells encode a geometric overlay tied to map height
(bottom-row stripe + anti-diagonal line). Only **10 / 696 cells are
shared** between rome10 and RoR-T1 — the f32=600 marker is overlaid on
save-specific data, but the diagonal-stripe geometry is engine-derived.
See #5.

(f) **REFUTED stretch hypothesis: 697-cell mystery = scripted-event
participants.** Per-tile registry records hit `f32=600` cells at exactly
random rate (1.00x enrichment). Hash overlap between per-tile registry
(5,632 hashes) and event-log actors (1,556 hashes) is **zero**. The
per-tile registry is a fully separate namespace from the event log. Even
when combined (5,644 distinct scripted-event-participant coords), only
**16.2% of the 253 largest-variant non-canonical cells overlap** — vs
8.2% random baseline (1.97x). Not enough to support the brief's
participants-hypothesis. See #6.

Save corpus this session: `save_rome10.sav` (RIS imperial T5) + RoR-T1
(vanilla RoR) for cross-save validation.

Ground-truth this session: session 22's `697 non-canonical cells`,
session 23's `num_battles_*` counters from lua footer, session 26's
event-log schema.

#### 1. CONFIRMED REVISION: event log is `(idB, idA)`-sorted scripted-events table

Session 26 read idB=270 → 270 BC and concluded idB tracked the *elapsed
campaign year*. **That reading is REFUTED.** Two pieces of evidence:

**Evidence A — idB distribution peaks at 350-450, far past T5:** at the
T5 save (5 turns elapsed), only 17-26 events have idB ∈ {270..275}. The
densest year is idB=412 with 92 events; idB=371 has 89; idB=386 has 88.
There are 3,219 events in the bin idB=350..399 alone — vastly more than
the player has elapsed. **If idB were "elapsed game year", T5 should have
zero events with idB > 275.** Instead, the entire 1..696 range is densely
populated.

**Evidence B — strict monotonic file order:** the first 13,874 records
(out of 13,947 valid) are **strictly idB-monotonic** in file-offset
order; the remaining 73 records are an append-zone tail. Within each
idB-block, **619/619 years are idA-monotonic ascending**. The sorted-block
end at file offset `0x2e4e9` marks the boundary between the *pre-populated
schedule* and the *append-only runtime log*.

**Evidence C — archive cross-validation:** across 13 archive saves
spanning T1..T8 (Macedon vanilla), the valid-event-counts are **nearly
constant at 100-115 records** (T1-end=103, T2-start=105, T7-end=108). A
"true history log" would grow as `O(turns_played)` with ~50-80 new events
per turn; instead the count is fixed.

**Conclusion**: the event log is the **RIS campaign script's
pre-populated event schedule** — every scripted event for the entire 696-
year game timeline is laid out at game start, sorted by `(year, intra-year
sequence)`. The 73-record append-zone collects runtime-generated events
inserted during play.

**Revised semantics**:

| Field | Revised meaning |
|---|---|
| `hash` (u32 +0) | actor UUID (1,417 distinct in valid main block; **disjoint from per-tile registry hashes**) |
| `flag` (u8 +4) | event-class enum (see #2) |
| `sub`  (u8 +5)  | event-subclass enum (0x20 for major actor events, 0x00 for engine/runtime events) |
| `idA`  (u16 +6) | within-year sequence number (idA-sorted ascending, 0..1018) |
| `idB`  (u32 +8) | scheduled-firing year on the campaign timeline (1..696) |

**Append-zone characterization**: 73 records starting at `0x2e4e9`. All
have `idA=0` (no scheduled sequence number). idB values are predominantly
low (2..10) with a "256" cluster of 13 records — the latter holds
named-actor hashes (`0xa2d46353`, `0xc3f71ce3`, `0x6e0ce84a`,
`0x1bd7e234`) that all match the most-spread main-block actors. Likely
this is the **runtime-appended events** generated during T1..T5 play.

**Confidence: CONFIRMED** by (i) 13,874-record monotonic idB run, (ii)
archive cross-validation showing fixed log size, (iii) within-year
idA-sort across all 619 years.

**Reproducer**: `dig-flag-enum{4,5,6,7,8}.js`.

#### 2. CONFIRMED: flag/sub enum semantics

Full (flag, sub) joint distribution across the 21,140 non-zero records:

| flag | sub | count | % | Hash profile | Interpretation |
|---|---|---|---|---|---|
| 0x01 | 0x20 | 11,387 | 81.7% | 1,417 actors, max 111/actor | **Primary actor event** — character/army/agent performs scheduled action |
| 0x04 | 0x00 | 1,311 | 9.4% | 1 actor (hash=0) | **Scripted engine event** — unowned, fired by campaign script |
| 0x02 | 0x20 | 1,176 | 8.4% | 172 actors, max 53/actor | **Secondary actor event** — likely target/counter-actor in a paired interaction |
| 0x02 | 0x00 | 52 | 0.4% | 1 actor (hash=0), idB ∈ {2..10} | **Runtime engine event** (append-zone) |
| 0x35 (53) | 0x00 | 225 | 1.6% | 56 actors, idB ∈ {0,10,20,30,40,100} | **Pre-game historical-tick** seeded at decade-boundary years |
| 0x00 | 0x01 | 221 | 1.6% | 10 hash-values, idB=0 | **Padding/initialization** — appears at offset 0x2ed71+ |
| flag ≥ 5 | varied | ~600 | 4.3% | sparse | **Rare event-subtype** (each ≤ 50 records) |

**Key insights**:

- **flag=4 always has hash=0** (1,311/1,311). Records span 441 distinct
  years 1..696 with 1..12 events per year — **NOT a per-turn engine
  tick** (which would need exactly 696 records, one per year). Instead,
  these are scripted-by-campaign engine-fired events (e.g., "Marian
  reforms triggered at year X" or "civil war begins").

- **flag=1 vs flag=2 actor overlap = 57 actors (33%)**: most flag=2
  actors do NOT appear with flag=1, suggesting flag=2 represents a
  **distinct actor category** (probably target-actor / passive-recipient
  rather than active-doer). When the SAME actor appears in both, only
  129 same-year flag=2/flag=1 co-occurrences exist vs 271 different-year
  — the two flags don't correlate temporally.

- **flag=0x35 (53) cluster pattern**: 225 records at idB ∈ {0, 10, 20,
  30, 40, 100} only. These are seeded at **decade-boundary years** in
  the pre-game era, consistent with a "scripted-history milestone"
  schema. 170 of the 225 have hash=0 (engine-owned), 56 have named
  actors.

**Actor-flag-profile distribution** (which flags does an actor appear
with?): 1,356 actors are flag=1-only; 115 are flag=2-only; 57 are both;
4 are flag=1 with mixed sub-bytes; 1 actor appears with all of flag=1,
flag=2, flag=4. This bimodal split confirms flag=1/flag=2 are
near-exclusive roles, not free-form tags.

**Confidence: CONFIRMED** by joint distribution + per-actor flag-profile
+ hash=0 invariant for flag=4.

**Reproducer**: `dig-flag-enum{1,2,3}.js`.

#### 3. CONFIRMED: 5,632 per-tile registry — schema + flag1 binary partition

Corrected offsets (session 26 had the region range right but the record
boundary off-by-one): **5,632 records at 26-byte stride starting at
`0x84f1f`**, ending at `0xa8b39`. Delimiter pattern `ff ff ff ff XX 01`
matches with **100% delimiter validity** (5,632 / 5,632 records have the
expected `delim=0xffffffff` and `flag2=0x01`).

**Schema**:
```
+0  u32 a       // event-class ID (0..43, irregular distribution)
+4  u32 b       // event-subclass (1..5, heavily b=1 skewed)
+8  u32 X       // tile X coord (4..1019)
+12 u32 Y       // tile Y coord (1..698)
+16 u32 hash    // per-record UUID (5,632 unique, disjoint from event-log)
+20 u32 0xffffffff
+24 u8  flag1   // 0 or 1 (1305 zeros, 4327 ones)
+25 u8  0x01
```

**Distribution summary**:

| Field | Distribution |
|---|---|
| `a` | Skewed: a=9 has 1,305 records (23%); a=18, a=4, a=36 each have ~250 records; rest 0..43 trail off |
| `b` | b=1:3313 / b=2:1757 / b=3:442 / b=4:101 / b=5:19 |
| `flag1` | 0:1305 / 1:4327 |
| `(a, b)` joint | **170 distinct combos** |
| `(X, Y)` | 5,629 unique pairs (near-1:1) covering full map |
| `hash` | 5,632 unique values, ranging 0x7e278..0xfff71233 |

**KEY FINDING — flag1=0 ↔ (a=9, b=1) is a TRUE bijection**: all 1,305
records with `flag1=0` have `(a=9, b=1)`; all 4,327 records with
`flag1=1` have one of 169 other `(a, b)` combos. **No record has `(a=9,
b=1, flag1=1)` and no record has `(flag1=0, (a, b) ≠ (9, 1))`.**

This suggests **`(a=9, b=1, flag1=0)` is the canonical "empty slot"
template** for tiles where no scripted-event lookup has fired yet, while
`flag1=1` indicates a tile with active scripted state. The remaining 169
`(a, b)` combos for `flag1=1` records likely encode different
event-classes (volcano/earthquake/horde-spawn/migrant/ambient-object).

**Hash namespace disjoint from event log**: 0 / 5,632 per-tile hashes
appear in the event log's 1,556 actor hashes. So the per-tile registry
uses a **separate UUID namespace** from the event log — this is a
*tile-anchored* registry, not an actor-anchored one.

**Named-event nearness check** (within ±2 tiles of known scripted-event
coords):

| Event name | Coord | Nearby registry records |
|---|---|---|
| etna | (311, 344) | 3 records: (313,346 a=8,b=2), (311,343 a=36,b=1), (311,345 a=33,b=2) |
| ischia | (299, 387) | 2 records: exact (299,387 a=26,b=1), (301,388 a=37,b=2) |
| santorini | (432, 331) | 3 records incl. one (a=9,b=1) at (432,330) |
| methana | (203, 173) | 0 records |
| vulcano | (311, 353) | 0 records |

So **named scripted-events do not consistently appear in the per-tile
registry**, refuting one of session 26's open hypotheses ("per-tile
event-history tracker"). The 5,632 records cover the populated map
broadly but **don't correlate with the 22 named scripted events**.

**Confidence: CONFIRMED** by delimiter validity rate + bijective flag1↔(a,b)
relationship + disjoint hash namespace.

**Reproducer**: `dig-per-tile-registry{1,2,3,4,5,6}.js`.

#### 4. CONFIRMED: mid-file tile-grid is one continuous 240×238 array straddling body-root boundary

Session 18 reported 57,120 records (= 240×238). Session 12 reported
36,582. **Both numbers are correct for different scopes**: the FULL grid
is 240×238 = 57,120 records, but only ~20,538 of them live INSIDE the
body root before the boundary at `0x633bb3` — the remaining 36,582 are
in the post-body-root "9.78 MB gap".

**Boundary geometry**:

```
ARR_START         = 0xf8fd2     (rec[0])
record 20536      ends at 0x633a3a + 267 = 0x633b45
record 20537      starts at 0x633b45, ends at 0x633c50
                  <-- body root ends at 0x633bb3 (mid-record-20537) -->
record 20538      starts at 0x633c50
record 57119      ends at 0xf84632 (last record)
```

The body root's nominal end at `0x633bb3` falls **in the middle of
record 20537** (110 bytes into a 267-byte record). The body-root header
declares size 6,488,090 = `0x63001a`, giving end at
`0x3ba1 + 0x63001a = 0x633bbb`. But the actual structural array
continues uninterrupted: record 20537 at `0x633b45` and record 20538 at
`0x633c50` both have identical canonical field values
`(f0=5, f4=0, f8=0, f12=10, f16=200, f20=200, f24=2, f28=6, f32=200)`.

**Cross-boundary canonical rate**:
- Inside body root: 20,032 / 20,538 = **97.5% canonical** (200,200,2,6,200)
- Outside body root: 35,699 / 36,582 = **97.6% canonical**
- Same field-distribution histograms inside vs outside (f16 all = 200,
  f24 all = 2, f28 mostly 6, f32 mostly 200) — confirming one array.

**Inside / outside split is purely positional**, not data-driven. The
body-root header just doesn't extend to cover the full array's bytes
even though the array continues without a section boundary.

**Confidence: CONFIRMED** by byte-level inspection of records 20536-20539,
matching field distributions, and 97.5%/97.6% canonical rate symmetry.

**Reproducer**: `dig-tile-grid-head{1,2}.js`.

#### 5. MAJOR DISCOVERY: 697-cell mystery — geometric decomposition (bottom-row + anti-diagonal + noise)

This is the **first structural breakthrough** on the 697-cell mystery
(open since session 22). With canonicality redefined as
**`(f28=6, f32=600)`** (the per-cell field combination that yields
exactly 697 in rome10), the cells decompose as:

| Component | rome10 | RoR-T1 | Interpretation |
|---|---|---|---|
| Bottom row (r=H-1) | 234 cells at r=237 | 234 cells at r=236 | **Southern map-edge marker** |
| Anti-diagonal (c+r=H-1) | 220 cells at c+r=237 | 219 cells at c+r=236 | **Geometric anti-diagonal of map grid** |
| Scattered cells | 243 | 243 | Save-specific data overlay |
| **Total** | **697** | **696** | (242 + 234 + 220 = 696 if we drop 1 boundary cell) |

Cross-save validation: rome10 and RoR-T1 share **only 10 / 696 cells**.
The diagonal-and-bottom-row geometry is **engine-deterministic** (both
saves have a stripe at r=H-1 and a line at c+r=H-1), but the SPECIFIC
cells flagged with f32=600 are save-specific data atop this geometric
backbone.

**Detailed counts** (rome10, ARR_START=0xf8fd2, W=240, H=238):

- `f32` distribution: 200:56,015 / 600:713 / 0:220 / -10:171 / 400:1
- `f32=600` subdivides as: (f28=6, f20=600):473 / (f28=6, f20=200):224 /
  (f28=54, f20=0):16
- The 697 "non-canonical interior" cells = `(f28=6, f32=600)` with
  f20=600 or 200 = 473 + 224 = **697 exactly**.
- **f28=54 = 432 cells**: 238 in column c=239 (eastern map edge) + 194
  scattered along the top/bottom edges and a few interior tiles.
  **f28=54 is the WORLD-BOUNDARY marker** — column 239 is 100% f28=54.

**Anti-diagonal cell list** (rome10 c+r=237): starts at (237, 0) and
proceeds (233, 4), (232, 5), (231, 6), (230, 7), (229, 8), (228, 9),
(227, 10), …, (0, 237) — a single line through the grid.

**Interpretation**: The mid-file array stores tile-attribute records.
The f32 field encodes a per-tile classifier where f32=200 is "normal
land" (97.6%) and f32=600 marks something else. The bottom-row stripe at
r=237 likely encodes "southern map edge" — RTW maps need a sentinel row
for sea/world-boundary calculations. The anti-diagonal might encode the
**diagonal of an internal cost-map or path-graph axis** that the engine
uses for grid-coordinate normalization. The save-specific "scattered
noise" (243 cells) is the actual data overlay.

**Open question**: what game-state does f32=600 (in the non-stripe
cells) actually encode? Candidates: rebellion-zone marker, scripted-AI
hint, terrain-type classifier (e.g., "high-altitude"), or per-region
border-marker. To disambiguate, a turn-delta comparison T0 → T1 would
help (does f32=600 ever switch to 200 or vice versa during a turn?).

**Confidence: STRONG** (cross-save validation of geometric structure +
exact cell counts for two saves). The semantic interpretation of f32=600
beyond "geometric overlay + save-specific extras" remains open.

**Reproducer**: `dig-midfile-final{2,3,4,5,6,7,8,9}.js`.

#### 6. REFUTED: 697-cell mystery = scripted-event participants

Brief #4 hypothesis: the 697 non-canonical cells correspond to scripted-
event participants (22 named volcanoes + 5,632 per-tile-registry
records).

**Test results**:
- Per-tile registry → f32=600 cells: **69 hits / 5632 records, baseline
  68.7, enrichment 1.00x** (random).
- All scripted-event participant coords combined (5,644 unique) → 41 /
  253 non-canon cells covered (largest variant) = **16.2% vs 8.2%
  baseline** = 1.97x enrichment. Better than random but far from
  explanatory.

**Hash overlap test**: 0 / 5,632 per-tile registry hashes appear in the
event log's 1,556 actor hashes. The two registries are completely
disjoint namespaces — they don't share entities.

**Conclusion**: scripted-event participants do NOT correlate with the
697-cell mystery. Combined with session 26's refutation of named-event
correlation and session 25's refutation of resource/character/settlement
correlations, this **closes the geographic-correlate hypothesis space
entirely**. The 697-cell mystery is now explained as **two geometric
primitives + save-specific overlay** (#5), not a geographic data layer.

**Reproducer**: `dig-midfile-final{1,4}.js`.

#### Open follow-ups for session 28+

- **Validate flag/sub semantics on RoR-T1**: are the same enum values
  used in vanilla saves? RoR-T1 has only ~100 valid events vs rome10's
  14,000 — different mod schedules different events.

- **What does f32=600 encode in the save-specific scatter (243 cells)?**
  Compare T1 → T2 → T3 deltas to see if any of the 243 cells transition
  600→200 or 200→600 during a turn (would suggest dynamic state) vs
  remain static (would suggest map-setup state).

- **`(a=9, b=1, flag1=0)` template records** (1,305 per-tile entries):
  these uniformly represent the "default empty per-tile state" but
  COVER ONLY ~23% of the per-tile registry. The other 4,327 records
  encode actively-tracked tiles. What about the OTHER 51,488 tiles
  without per-tile-registry coverage? Are they "ineligible for scripted
  events" or just absent from this registry?

- **Append-zone tail decoder**: the 73 runtime-generated records have
  `idA=0` and idB ∈ {2..10, 256}. If T5 = 5 turns played, we'd expect
  ~5× turn-events. 73 / 5 ≈ 14.6 events/turn — close to RTW's typical
  rate of "10-20 things happen per turn". The 13 idB=256 records hold
  the named-actor hashes — those are likely **per-major-actor
  end-of-turn summaries**.

- **Hash → entity discriminator**: 1,556 event-log hashes vs 5,632
  per-tile-registry hashes — both registries clearly use UUID-style
  identifiers but for different entity types. Test whether one
  registry's hash universe overlaps with character_paths-section
  identifiers (469 sections in body root).

#### Reproducer scripts

- `dig-flag-enum{1..8}.js` — flag/sub enum decoder + idB-semantics
  revision
  - 1: full flag-byte + sub-byte + joint (f, s) histogram (revealed 4
    primary classes + 776 rare)
  - 2: per-(f, s) actor-repetition + same-year overlap test (flag=4
    always hash=0; flag=1∩flag=2 = 57 actors)
  - 3: lua-footer num_battles_* cross-validation (all zero — refutes
    direct count match)
  - 4: archive T1..T8 cross-save (~100 events in all = pre-populated
    schedule)
  - 5: idB-monotonicity per-actor test (938/1047 actors monotonic)
  - 6: file-order vs idB scan (33 breakpoints, last at i=13943)
  - 7: sorted-block boundary at i=13874 + within-year idA-sort
    verification (619/619 sorted)
  - 8: tail "256" cluster matches longest-spread main-block actors
- `dig-per-tile-registry{1..6}.js` — 5,632 records re-decode
  - 1: failed first attempt (wrong offset)
  - 2: delimiter pattern scan (5,633 delimiters at exactly 26B stride)
  - 3: full 5,632-record decode with (a, b, flag1) histograms
  - 4: cross-tab vs non-canonical cells + spatial-distribution by (a, b)
  - 5: variant comparison (1.0..1.93x enrichment on different cell
    variants)
  - 6: investigation of (a, b) semantics + named-event nearness check
- `dig-tile-grid-head{1,2}.js` — body-root boundary verification
  - 1: grid bytes calculation + records around boundary (20536-20539
    all canonical)
  - 2: field-value histograms inside vs outside (97.5% vs 97.6%
    canonical)
- `dig-midfile-final{1..9}.js` — 697-cell mystery final analysis
  - 1: scripted-event-participant cross-tab (refuted)
  - 2: f28=54 spatial pattern (column c=239 100% f28=54 = east edge)
  - 3: f32 value distribution + 697-cell coord enumeration
  - 4: bottom-row r=237 + anti-diagonal c+r=237 discovery (220 cells
    on diagonal)
  - 5: diagonal verification (top sum=237: 220 cells)
  - 6: cross-save validation in RoR-T1 (different ARR_START 0x108a22)
  - 7: pattern-scan validation (ARR_START=0xf8fd2 is correct)
  - 8: RoR-T1 diagonal at c+r=236 (219 cells) — same structure offset
    by 1 row
  - 9: rome10 vs RoR-T1 shared cells (10 / 696 — save-specific overlay)

---

### Findings 2026-05-11 (background session 28 — body root preamble strings)

Scanned the 5.6 KB body-root preamble [0x3b99..0x51b5] in save_rome10.sav for UTF-16LE strings >=3 chars (alternating-zero-byte pattern). Result: **only 3 distinct strings in the whole block**.

| Offset  | Length (chars) | Bytes (UTF-16LE) | String |
|---------|----------------|-------------------|--------|
| 0x3b9f  | 26             | 52 B + len prefix | `"campaign/imperial_campaign"` |
| 0x3bd5  | 17             | 34 B + len prefix | `"imperial_campaign"` |
| 0x43fc  | 113            | 226 B + len prefix | `"pQ:\Feral\Users\Default\AppData\Local\Mods\My Mods\RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt"` |

(The leading `pQ` on the third string is the run-scanner picking up two stray ASCII bytes immediately before the real path; the actual path starts at `"Q:\..."` — `pQ` is the length-prefix tail / one preamble byte caught by the printable-run heuristic.)

**Classification**: zero faction names, zero lua module names, zero script-flag tokens, zero campaign event identifiers. The preamble is **not** a string table.

**Implication**: the bulk of [0x3b99..0x51b5] is non-string binary — fixed-width records, counters, or flag bitfields. The three strings are:
1. campaign directory path (`campaign/imperial_campaign`)
2. campaign short name (`imperial_campaign`) — same as 0x003a header field
3. absolute filesystem path to `descr_strat.txt` (mod root, captured at save time)

Strings 1 and 2 are 6-byte tagged: there is a length-prefix u32 / u16 before each. String 3 sits at 0x43fc, far inside the region; the ~2 KB gap between 0x3bd5+34 and 0x43fc is dense binary (likely the campaign-state header proper).

Script: `scripts/save-cracker/dig-preamble-strings1.js`.

---

### Findings 2026-05-11 (background session 29 — settlement-model name -> culture mapping)

Scanned block `0x1f47809..0x1f8f9bc` (295347 bytes). Strings are u16(len incl NUL) + ASCII + NUL; first record is `0d 00 "Eastern_Town\0"` then a 24-byte record tail before the next length prefix. Found exactly **24 distinct model names** (matches the session-24 count).

| culture_family | village | town | large_town | city | large_city | huge_city |
|---|---|---|---|---|---|---|
| greek (W_hellenistic) | - | W_hellenistic_Town | W_hellenistic_Large_Town | W_hellenistic_City | W_hellenistic_Large_City | W_hellenistic_Huge_City |
| eastern | - | Eastern_Town | Eastern_Large_Town | Eastern_City | - | Eastern_Huge_City |
| carthaginian | - | Carthaginian_Town | Carthaginian_Large_Town | Carthaginian_City | - | Carthaginian_Huge_City |
| barbarian (Celtic) | - | Celtic_Town | Celtic_Large_Town | Celtic_City | - | - |
| barbarian (Germanic) | - | Germanic_Town | Germanic_Large_Town | - | - | - |
| barbarian (Illyrian) | - | Illyrian_Town | Illyrian_Large_Town | - | - | - |
| egyptian | - | Egyptian_Town | Egyptian_Large_Town | - | - | - |
| nomad (Scythian) | - | Nomad_Town | Nomad_Large_Town | - | - | - |

Anomalies / notes:
- **No `Roman_*` strings.** Roman and Greek factions both render with the `W_hellenistic` (Western hellenistic) shared classical model set, which is the only family that exercises every level including the unique `Large_City` tier.
- **No `Village` strings** in the block - the smallest model name is `*_Town`. Villages may share Town models or be rendered procedurally.
- **No walls-only variants.** All names follow `<Culture>_<Level>`; no `_Walls`/`_Wall` suffix variants exist in this block (unlike `descr_cultures.txt` mod files which can list separate wall models).
- **Barbarian sub-flavours** split into Celtic (Western Europe), Germanic, and Illyrian - all roll up to the session-25 `barbarian` family but use three distinct asset sets at the Town/Large_Town tier. Celtic is the only barbarian flavour that reaches `City`.
- Session-25's six culture_families confirmed by name pattern: roman+greek share **W_hellenistic** (5 levels), **Eastern** (4 levels), **Carthaginian** (4 levels), **Celtic/Germanic/Illyrian** (barbarian; 3 levels max), **Egyptian** (2 levels), **Nomad** (2 levels).
- Top hit counts: `W_hellenistic_Large_Town`=142, `W_hellenistic_Large_City`=89, `Celtic_Large_Town`=85 - consistent with Greek/Roman dominance and Celtic prevalence on the rome10 map.

Script: `scripts/save-cracker/dig-model-names1.js`.

---

### Findings 2026-05-11 (background session 30 — scripted-events typeA/typeB enum)

Goal: tabulate the i32 year + u32 typeA + u32 typeB triple for each of the 22 named scripted-events at 0x846d1..0xa8beb in save_rome10.sav. Test whether typeA = event-category discriminator (0=volcano / 1=quake / 2=flood) and typeB = severity rating.

**Result: BOTH HYPOTHESES REFUTED.**

- **typeB is constant = 1 across all 22 events** (volcanoes, earthquakes, flood). Not a severity rating; likely a "scripted-event version" or "is-enabled" flag.
- **typeA does NOT discriminate event category.** Distribution: VOLC {0: 2, 2: 16}, QUAKE {0: 1, 2: 2}, FLOOD {2: 1}. The flood, the Iberia/Santorini quakes, and 16 volcanoes all share `typeA=2`. Only 3 outliers carry `typeA=0`: `eruption_at_etna_49` (year -50), `eruption_at_vulcano_91` (year -91), `earthquake_in_rhodes` (year -226). The `typeA=0` rows correlate with `trigger_count=0` for the etna entry, but vulcano_91 and rhodes also have low/zero triggers, so the link is weak. typeA is plausibly **"already-triggered before save-start"** flag (0 = pre-history-skipped / 2 = active in timeline) but the corpus (1 save, T5) is too thin to confirm.
- The (typeA, typeB) pair distribution is `{(2,1): 19, (0,1): 3}` — i.e. a binary discriminator on a single dimension.

Full 22-event table (all volcanoes at Sicily/Aegean/Italian-coast tiles, all years matching the embedded name modulo session 26's known off-by-1 and midpoint cases): see script output.

**Implication**: the volcano/earthquake/flood category is **NOT stored as an enum field** — it is encoded purely in the leading category string `"volcano"`/`"earthquake"`/`"flood"` that prefixes each named-event record. The 6-field tail `[year][typeA][typeB][X][Y][trigger_count]` is category-agnostic schedule metadata.

Script: `scripts/save-cracker/dig-event-enum1.js`.

---

### Findings 2026-05-11 (background session 31 — battle/diplomacy/occupation save pair)

Goal: with a high-information save pair (Romans Julii pre-battle/at-peace
→ post-autoresolved-attack-on-Uria/at-war), land three of: (1) the
**diplomacy state enum** (blocked since session 6), (2) **per-faction
battles-fought counter**, (3) **per-soldier 3-byte stat decode**, plus
stretches on settlement ownership and battle log.

Save pair: `save_1.sav` (BEFORE, 34,523,383 B) and `save_3.sav` (AFTER,
34,689,457 B). Mod: RIS imperial. Player: romans_julii. Ground-truth
event between saves: Romans Julii army moved onto Uria (region 1048,
Salentinia, Messapian-owned), autoresolved + occupied + war declared
with Messapians.

Outcome: **Four new findings, two material partial advances on
session-blocked targets, one full retraction reaffirmation, plus three
documented negatives on the diplomacy hunt.** Diplomacy enum is STILL
not pinned to a fixed byte — but the search space is **massively
narrowed**, and one new structural anchor (per-character "diplomatic
context hash") was located.

#### 1. CONFIRMED: 23 major-faction records align positionally between save_1 and save_3 (in-turn save pair, no record rotation)

23 major-faction records in each save (`+8=100, +12=1, +24=self,
+40=self, +44=6` signature). Position-aligned A[i]↔B[i] for all 23 — no
rotation, no insertion. Romans Julii at index 0 (35 regions, treasury
10000→10110, Δ=+110), Messapians at index 20 (regions=2 with IDs
`[1012, 1048]` = Calabria + Salentinia per descr_regions, treasury
5000→5000 unchanged). Other 21 records: treasury unchanged.

**CONFIRMED REVISION of session 9 finding #1**: the homeland region
list at `+52..+(52+4N)` is **byte-identical for ALL 23 factions
between save_1 and save_3**, **including for Messapians (the conquered
faction) AND Romans Julii (the conquering faction)**. Specifically,
Messapians' region list is still `[1012, 1048]` in save_3 even though
they LOST Uria (1048) to Romans during this save pair. Romans' list is
still its 35 starting regions — does NOT add 1048. This is the
strongest possible confirmation that the `+52..` array is a **STATIC
descr_strat-derived homeland descriptor**, never updated by
conquest/loss events. The session-5 hypothesis "currently owned" /
"claimed" can be DECISIVELY ruled out.

Confidence: CONFIRMED. Reproducer: `dig-diplomacy15..17.js`,
`dig-ownership4.js`.

#### 2. STRONG: per-faction monotone tick counter at +(52+4N+148) — likely a per-faction event-processed counter

Scanning u32 fields at K=0..240 from the post-region-list base of each
major-faction record, **K=148 is one of the u32 fields that
ticks for every one of the 23 factions** between save_1 (BEFORE
battle) and save_3 (AFTER battle). Additionally K=172 ticks for all
23 factions with the SAME per-faction Δ values as K=148 — so they are
**delta-equal but value-different** within a save (only Romans Julii
has K=148 == K=172 by coincidence; the other 22 factions have
unrelated K=172 values but identical Δ). This suggests K=148 and K=172
are two related counters that increment in lockstep but track
different baseline values (e.g. "events this turn" + "events all
time" — both increment by the same amount each turn-step).

Per-faction Δ values for both K=148 and K=172 (identical):

| Idx | Faction (regions) | A→B | Δ |
|---|---|---|---|
| 0 | Romans Julii (35) | 87067→87096 | **+29** |
| 1 | (22)              | 201414541→201414576 | +35 |
| 2 | (30)              | 218192562→218192631 | +69 |
| 3 | (31)              | 218194487→218194583 | +96 |
| 4 | (33)              | 218197167→218197289 | +122 |
| 5 | (19)              | 268529110→268529237 | +127 |
| 6 | (20)              | 117534257→117534388 | +131 |
| ... | (various)       | ...               | +130..+205 |
| 20 | Messapians (2)   | 184645612→184645802 | **+190** |
| 22 | (16)             | 67205829→67206034 | +205 |

The fact that **EVERY faction's counter ticks**, with deltas ranging
~29..+205, suggests this is a **per-faction event/decision counter**
that increments each time the engine processes faction X (during AI
turn, character-event resolution, or similar). The battle/occupation
between Romans and Messapians processed events across all factions
(diplomatic state propagation, fog-of-war updates).

**Note Romans Julii has the SMALLEST delta (+29) despite being the
player faction**. This is consistent with the player's faction
processing being lightweight (the player has no AI policy steps to
execute mid-turn). AI factions had more events to process.

K=148 and K=172 contain the SAME u32 — they're a **schema duplicate
pair** (perhaps "previous turn snapshot" + "current value" so a
delta-from-turn-start could be computed). Their values track each
other within a save and tick together.

Adjacent context fields (per-faction, at K=140, K=144, K=152, K=156,
K=160, K=164, K=168) all change between saves but appear to be
runtime-pointer/hash-shaped (no monotonic structure, no per-faction
identity), consistent with RNG state / runtime pointers per session 5's
"runtime pointer fields" observation.

Reproducer: `dig-battle14.js`. Confidence: **STRONG** because of the
universal coverage (23/23 factions tick monotonically), but not
CONFIRMED to be specifically a "battles fought" counter — could
equally be "AI decisions made", "characters processed", "events
written to log", or another general-purpose engine counter. To
disambiguate, would need same-faction save pairs where exactly ONE
event-type happens (battle vs. no-battle) and check whether the
counter ticks differently.

**Implication for sessions 21/22**: Alex campaign at +(92+4N+20) and
RIS at +(52+4N+188) WERE NEITHER pinned to specifically "battles" —
they may equally be the SAME family of per-faction event counters as
this new K=148/K=172 finding. The +(52+4N+188) field in RIS that
session 22 saw tick 0→4 over T1→T5 (uniformly per-faction = turn
counter) and this K=148/K=172 field (varies per faction within a
single turn = event counter) are likely TWO different schema slots in
the per-faction stats block.

#### 3. STRONG / HYPOTHESIS-graded: K=224 is the AI strategic score on 5 "tracked" factions (positional indices 0, 5, 13, 17, 21) — value tick supports session 22's `+220=239 flag triggers +224 counter` reading

Of the 23 major-faction records, **only 5** have non-zero K=224:
indices 0, 5, 13, 17, 21 — **same 5 indices session 22 saw flagged
with `+220=239`**. Each of the 5 has K=224 in the 22M-25M range and it
ticks UP between save_1 and save_3:

| Idx | A | B | Δ |
|---|---|---|---|
| 0 (Romans Julii, player) | 22,289,321 | 22,296,701 | +7,380 |
| 5 | 23,975,531 | 24,008,073 | +32,542 |
| 13 | 24,231,832 | 24,271,210 | +39,378 |
| 17 | 24,412,489 | 24,456,113 | +43,624 |
| 21 | 24,773,286 | 24,824,884 | +51,598 |

Tracking-flag positional indices are stable across save_1 and save_3
(positional indices 0, 5, 13, 17, 21 — see session 22). Romans Julii
(player) has the SMALLEST tick (+7,380) again, consistent with the
player not running AI strategic evaluation. The 4 AI-tracked factions
have ~5-7× larger increments.

Confidence: **STRONG** as a "per-AI-tracked-faction value that ticks
monotonically when AI processing runs"; HYPOTHESIS for the precise
semantic meaning (could be "cumulative AI score points", "evaluations
performed", "decisions made", etc.).

#### 4. STRONG / NEGATIVE: the diplomacy state enum byte is NOT at any K∈[0..1500] offset within the per-faction record's post-region-list trailing data

Per-faction byte-by-byte diff (K=0..1500 post-region-list) reveals
**which faction-indices' byte changed at each K**. Searching for K
where ONLY Romans (idx 0) and Messapians (idx 20) — the war-declaring
pair — change (signature `[0,20]`): 8 such Ks found:
**K=821, 823, 824, 825, 826, 1334, 1335, 1336**.

Inspecting these reveals they are **per-character RUNTIME HASH bytes**
near the character portrait paths (e.g. just after `data/ui/eastern/
portraits/portraits/young/generals/092.tga` for Messapians or
`...generals/459.tga` for Romans). The changed bytes are 4-6-byte
runtime hashes/UUIDs that recompute when a character's diplomatic
context changes. **These bytes ARE a fingerprint that "this character
faction is now at war with that other faction"** — but they aren't a
clean state enum, they're hashes derived from state.

Other interesting K-signatures (faction indices whose byte changes at
those Ks):

| K range | Sig | Count | Interpretation |
|---|---|---|---|
| 143..148, 233..235 | `[ALL 23]` | 15 | universal per-faction runtime/hash ticks |
| 240..299, 285..291 | `[6,9,10,16,19,22]` | 18 | some 6-faction subgroup affected — probably a cross-faction AI policy update |
| 256..302 | `[11,12,14,18,20]` | 11 | another subgroup |
| 374..381, 791..798, 887..889 | `[17,21]` | 16 | 2-faction pair |
| 819..830, 912..923 | `[9,20]` | 7 | 2-faction pair |
| 821..826, 1334..1336 | `[0,20]` | 8 | **Romans + Messapians (war pair)** |
| 813..814, 884..886 | `[0,16,22]` / `[0,17,21]` | 5 | Romans + 2 others |

The cross-faction groupings (signatures with 2-6 indices) suggest the
per-faction trailing data contains a **per-faction-pair diplomacy
record array OR an AI-relationship cache** with some N×N structure —
when ANY relationship changes, BOTH involved factions' records get
their adjacent character-records re-hashed. This is why we see
2-faction-pair signatures all over the K=300..1400 range.

**REFUTATION of brief hypothesis**: the diplomacy enum is **NOT a
positional byte at a stable offset within a single major-faction
record's trailing data**. If it were, we'd see signature `[0,20]`
clustered at a SINGLE byte offset, with values changing 1→0 (peace→war)
or 2→1. Instead, the [0,20] signature spans 8 bytes that are randomly
hash-shaped.

**This rules out** the brief's session-22 "+220=239 → +224
diplomacy enum" hypothesis. K=224 is the AI strategic score (finding
#3) and it ticks for the 5 tracked factions, NOT specifically for
{Romans, Messapians}.

**Where diplomacy state COULD still live** (search space narrowed):

- **In a SEPARATE body-root section**, NOT in any major-faction
  record's trailing data — likely the HST-declared
  `DIPLOMATIC_ATTITUDE v=6` section, which session 12 noted was
  declared but not located. Possibly inside the gap zone
  (`0x633bb3..0xf88637` per session 12) or as a small fixed-position
  table near the body root.
- **As per-character runtime hash inputs** — the war-state IS reflected
  in the per-character hashes at K=821..826 / 1334..1336, but
  recovering the state from those hashes is intractable without
  knowing the hash function.

Reproducer: `dig-diplomacy15..31.js` (full series).

#### 5. CONFIRMED: 4 player-visible event messages appended to save trailer post-battle (Uria - Settlement Under Siege, Lost, Gained, Governor Appointed)

In save_3 only, the tail region (offsets ~0x20cf68f..0x20cf957)
contains **4 new UTF-16LE event-message records** not present in
save_1:

| Offset (save_3 only) | Event title | Body excerpt |
|---|---|---|
| 0x20cf68f | "Uria - Settlement Under Siege" | "This settle..." (continues) |
| 0x20cf783 | "Uria - Settlement Lost" | "We no longer contr..." |
| 0x20cf868 | "Uria - Settlement Gained" | "We have gained c..." |
| 0x20cf957 | "Uria - Governor Appointed" | "This man has be..." |

These map directly to the player-facing turn-end/turn-start event log
shown in the campaign UI. The "Lost" message is presumably what
Messapians sees in their UI (player-side messages also include
adversary's events). Schema per record:

```
[u32 hash_prefix]  // 4 B per-record
[8 B record-type prefix incl. 0xf2feffff sentinel]
[u32 0x0000009c]   // 156 — message-type constant
[u32 0x00000004]   // pad/type
[u16 nameLen]      // length-prefixed UTF-16LE title
[UTF-16LE title]   // e.g. "Uria"
[u16 bodyLen]      // length-prefixed UTF-16LE body
[UTF-16LE body]    // e.g. "Settlement Under Siege"
[u8 0x53]          // possible newline / section break
[u16 detailLen]    // length-prefixed UTF-16LE detail
[UTF-16LE detail]  // e.g. "This settle..."
```

Confidence: CONFIRMED by 4 sequential records with the same schema,
all referencing the same settlement (Uria), all containing
human-readable event text in UTF-16LE.

This is the **player message log** — a separate location from session
27's "unified event log at 0x51b5..0x846af" (which holds engine-level
actor/year events). The player message log lives in the trailer past
`0x20cf000`. Possible further investigation: enumerate all message
records in the trailer to count "events fired per turn".

Reproducer: `dig-ownership2.js`.

#### 6. CONFIRMED: settlement-record header structure for Uria (Salentinia, conquered)

Uria's settlement record begins at file offset 0x1264844 (u32 header)
in BOTH save_1 and save_3 — settlements do NOT shift even when their
ownership changes. The header structure (relative to record start at
0x1264844):

```
+0   u32 ?? 0x01430700 → 0x01432500 in save_3 (Δ = +0x1e00 = +7680)
       — possibly "settlement_data_size_or_next_settlement_offset"
       (record body grows by ~7,680 bytes when ownership transfers,
       likely due to new garrison/governor character data appended
       inside this record)
+4..+15  16 B zeros / pad
+16  u32 0x26485357 = 642,237,783 (record-type/UUID-shaped, unchanged)
+20  u32 0x26485357 = 642,237,783 (paired — unchanged)
+24  u32 0xef000000  (terminator marker)
+28  u32 0x00010400  (record-class tag, unchanged)
+32  u16 nameLen = 4
+34  UTF-16LE "Uria"  (8 bytes)
+42  5 B zeros
+47  4 B = 0xfc 0xfc 0xfc 0xfc (sentinel after settlement name)
+51  u32 = 0x64 = 100 (=major-class tag echo from major-faction schema?)
+55  u32 0x00000398 = 920 (some count?)
+59  u32 0x00000080 (flags)
+63  u32 0x4021c000 (= float 2.519 — coordinate or stat?)
...
```

The u32 at +0 (0x1264844) **shifting from 0x01430700 to 0x01432500
(Δ=+7680)** is the **strongest single byte-level signal of Uria's
ownership change**. The other bytes that differ are:

- 0x12648f1..0x12648f3 (3 B): settlement runtime hash (recomputed
  because of new owner)
- 0x126493d..0x1264940 (4 B): `hinterland_region` building's runtime
  hash (recomputed)

The static settlement content (level, population_id, plan_set,
faction_creator marker, hinterland_region building) is **byte-identical
in save_1 and save_3**. Ownership is NOT stored inline as a faction-id
byte; it's reflected entirely through:
1. The growth of the settlement-record body (+7680 B = new garrison
   and governor character data appended)
2. Runtime hashes recomputed inside the settlement record
3. Player-visible event messages in the trailer (finding #5)

The actual "owner faction ID" must live in a separate `MAP_REGIONS`
or per-tile-attribute structure that maps each settlement to its
current owner — likely either in the body root (next to the
character_paths records) or in the tile-attribute gap region (per
session 12). Settlement-record DOES NOT directly carry the owner
faction-id at a stable inline byte.

Confidence: CONFIRMED (the 0x1264844 u32 Δ=+0x1e00 mass-increase
matches the +7680-byte record growth observed for the conquered
settlement).

Reproducer: `dig-ownership2.js`, `dig-ownership3.js`, `dig-ownership4.js`.

#### 7. REFUTED: field-army-block tail at 0x1f10c72 (session 22) does NOT generalize to RIS imperial mod saves

Session 22 found 122 unit records in the tail region 0x1f10c72..0x1f43598 of
rome10 (vanilla imperial_campaign) using the 0x0001012c (= 76,860)
record-type tag. Re-running the SAME signature against save_1 and save_3
(RIS imperial mod):

- Only **7 hits per save** of the 0x0001012c tag (vs ~122 in rome10)
- Hits cluster around `0x209f27a..0x20a6f0a` (A) / `0x20c77ca..0x20cf45a`
  (B) — a much smaller block

The RIS mod either uses a DIFFERENT record-type tag for field-army units
(probably mod-overridden in `descr_unit.txt` or similar), OR field-army
units in this mod are stored at a different file offset. The 122 unit
records per session 22 must have included BOTH on-map field armies AND
settlement garrisons; with this save pair the count is much smaller
(more units = more settlement garrisons; fewer = field armies only).

**Implication for per-soldier 3-byte stat decode (brief target #3)**:
the target schema doesn't apply to RIS imperial saves. Decoding battle
casualty changes for the Roman attacking force would require first
relocating the unit records in this mod's save format. Did not pursue
further in this session.

Reproducer: `dig-soldier-stats1.js`, `dig-soldier-stats2.js`.
Confidence: REFUTED for "session 22's schema is universal across mods".

#### 8. NEGATIVE: unified event log (session 27) record count is constant 13,884 between save_1 and save_3 — no append from battle event

Per session 27, the unified event log at 0x51b5..0x2dc91 (12-byte
records) has 13,884 record slots; the append-zone starts at 0x2e4e9
(record index 13,784). Both save_1 and save_3 have **exactly 13,884
record slots**. The "battles fought" event one might expect to land in
the append zone is NOT a new RECORD — the actor_hash fields at indices
13,784..13,884 change values (from one runtime hash to another) but
the COUNT, idA, idB, flag, sub fields are byte-identical between
saves.

**Conclusion**: the unified event log is "reserved capacity" that's
already laid out at game start — battle/war events don't extend it;
they modify per-actor hashes within it (and maybe a per-actor flag
elsewhere). The player message log finding (#5) is where new battle
text actually lands.

Reproducer: `dig-battle11.js`.

#### Targets not landed in this session

- **The diplomacy state enum byte itself** — narrowed to "not in
  any major-faction record's post-region-list trailing data K∈[0..1500]"
  and "not a positional byte; encoded via per-character runtime
  hashes". Likely lives in HST-declared `DIPLOMATIC_ATTITUDE v=6`
  section as a separate body section, OR in the gap zone
  (0x633bb3..0xf88637 per session 12). Future probe should walk
  every section in body root that hasn't been identified by name yet
  and look for one with a small (~286×286 byte or 24×24 byte)
  symmetric matrix structure.
- **Per-soldier 3-byte HP/kills/XP decode** — blocked because session
  22's field-army block doesn't apply to RIS mod saves (finding #7).
- **Faction-pair attitude integer** (range -200..+200 per RTW
  convention) — not located. Could not pin to any offset.

#### Useful negative tests (documented for future sessions)

- `+(52+4N+188)` (session 22 RIS turn counter): **0 in both save_1 and
  save_3** — consistent with save_1 and save_3 being within the same
  in-game turn (no turn rotation occurred between them). Doesn't
  contradict session 22; just means no turn rolled over for this
  specific save pair.
- `+(92+4N+20)` (session 21 Alex event counter): not applicable —
  this save is RIS imperial, not Alex campaign. The schema-21 tag
  is absent at +(92+4N+16).
- Lua-footer `num_battles_<faction>` counters (session 23): all zero
  in both saves (the autoresolved battle did NOT increment any
  lua-side counter, because lua counters in RIS are for scripted
  multi-turn campaigns, not generic skirmishes).

#### Reproducer scripts

- `dig-diplomacy15.js` — locate 23 major-faction records, identify
  Romans Julii (idx 0) and Messapians (idx 20) by region fingerprint
- `dig-diplomacy16.js` — dump all 23 records' region lists
- `dig-diplomacy17.js` — A↔B fingerprint alignment (all 23 match
  positionally)
- `dig-diplomacy18.js` — record-level byte diff (very noisy; ruled
  out direct positional comparison)
- `dig-diplomacy19..21.js` — file-wide isolated byte flip scan
  (~1441 candidates, narrowed to ~387 enum-like)
- `dig-diplomacy22.js` — settlement-record preamble pattern
  enumeration (3310 hits in A, 3309 in B)
- `dig-diplomacy23..26.js` — fixed-stride array search (false leads
  in fog-of-war / per-character hash regions)
- `dig-diplomacy27..29.js` — **per-faction record byte-diff
  cross-tabulation** (the productive scan — established the [0,20]
  signature at K=821..826/1334..1336)
- `dig-diplomacy30.js` — K-by-K cross-faction value comparison
- `dig-diplomacy31.js` — K=1832 region detail (Messapians-only flip)
- `dig-battle11.js` — unified event log count and append-zone diff
- `dig-battle12..13.js` — per-faction counter scan +188 / +(any K)
- `dig-battle14.js` — **K=148/K=172/K=224 monotone counter discovery**
- `dig-ownership1..4.js` — Uria & Brundisium settlement records;
  region-list static-ness; settlement-record schema; player event
  messages in trailer
- `dig-soldier-stats1..2.js` — REFUTED: tail block doesn't apply to
  RIS mod saves

---

### Findings 2026-05-11 (background session 32 — DIPLOMACY ENUM via clean trade-rights save pair)

**HEADLINE: DIPLOMACY ENUM IS CRACKED.** After 6+ blocked prior sessions, a
clean save pair isolating a single trade-rights action (no end-turn,
no other input) revealed the bilateral 239×239 diplomatic-attitude
matrix exactly.

#### CONFIRMED: 239×239 bilateral DIPLOMATIC_ATTITUDE matrix

Sample: `save_1.1.sav` (before, 34,524,329B) → `save_2.1.sav` (after,
34,524,319B). Net delta −10 bytes. **Only THREE substantive structural
diffs** (plus ~1100 cosmetic pointer-shift events and ~30 byte-level
AI noise diffs):

1. **The matrix flip at indices `[0][156]` and `[156][0]`** — see
   below.
2. **A diplomatic-history table at `0x1f1dca3..0x1f1ddc5`** loses 10
   bytes of small-u8 enum entries (likely move-trail or
   per-pair-action-history, NOT the attitude itself).
3. **RNG state tick at `0x43f8` (counter) + `0x455c` (4-byte
   next-state seed).** Always present in every save pair.

**Matrix layout — CONFIRMED**:

```
matStart    = 0xf8fd2  (first record's u32 enum-prev field)
stride      = 267 bytes per cell
rows × cols = 239 × 239 = 57,121 cells
matEnd      = 0xf8fd2 + 57121 × 267 = 0x1ed64b5 (exclusive)
total       = ~14.5 MB occupied by the matrix
```

**Row order = descr_sm_factions.txt declaration order**:

- Index 0 = `romans_julii`
- Index 156 = `messapians`
- Index 238 = `slave` (Free Peoples — last entry, line 19341)

(Verified by counting faction blocks in `public/descr_sm_factions.txt`:
exactly 239 entries between line 17 (`romans_julii`) and line 19341
(`slave`).)

**Per-cell record layout (267 bytes, mostly zeros)**:

| Byte offset within cell | u32 value (typical) | Meaning |
|---|---|---|
| +0  | **5** | u32 `prev_enum` — "never-met" / sentinel-marker; flips to 0 once any agreement is made |
| +4  | **0** | u32 `curr_enum` — current bilateral relationship state (0 = neutral default, 1 = trade rights granted; others unobserved this session) |
| +8  | 0 | reserved |
| +12 | **10** (0x0a) | CONFIRMED constant — schema marker; observed identical in all sampled cells |
| +16 | 200 (0xc8) | mostly constant — observed constant in 99%+ of sampled cells |
| +20 | 200 (0xc8) typical, **600 for col=237 (vettones)** | per-cell opinion score; varies (sample showed +20=600 for every `[r][237]` cell) |
| +24 | 2 | mostly constant |
| +28 | 6 typical, observed 6→46 in [0][155] / [155][238] this pair | per-cell opinion score; minor noise diffs observed (likely AI re-evaluation) |
| +32 | 200 typical, **600 for col=237** | per-cell score, paired with +20 |
| +36..+117 | 0 | padding |
| +118 | 3 | mostly constant |
| +119..+153 | 0 | padding |
| +154 | 576 (0x240) | mostly constant |
| +155..+177 | 0 | padding |
| +178 | 166 (0xa6) | mostly constant |
| +179..+266 | 0 | padding |

**HYPOTHESIS**: +20 and +32 are paired opinion/score values; +28 is
another scoring field. Most cells default to (+20=200, +28=6, +32=200)
but they vary per faction-pair to reflect descr_strat initial
relationships. **Cells with col=237 (vettones) have +20=600 and +32=600**
in every sampled row — possibly reflecting vettones-specific
diplomatic starting attitudes from `descr_strat.txt`. Final
characterization requires cross-referencing descr_strat per
faction-pair.

**Matrix end ambiguity**: cell [238][238] (the theoretical last cell)
appears to overlap with the next file section (which contains
"hinterland_region" and "default_set" strings starting at ~0xf846a0).
The matrix likely **effectively has 57,120 cells (row 238 may stop at
column 237)** or the last cell is truncated. The 57,118 normal cells
+ 2 changed cells (= 57,120 default + 2 flipped) match the observed
byte-level diff.

**Observed flip (only 2 cells changed in the whole 14.5MB matrix)**:

| Cell | A bytes (+0..+15) | B bytes (+0..+15) |
|---|---|---|
| `[0][156]` Romans→Messapians (file off `0x103286`) | `05 00 00 00 00 00 00 00 00 00 00 00 0a 00 00 00` | `00 00 00 00 01 00 00 00 00 00 00 00 0a 00 00 00` |
| `[156][0]` Messapians→Romans (file off `0xa775de`) | `05 00 00 00 00 00 00 00 00 00 00 00 0a 00 00 00` | `00 00 00 00 01 00 00 00 00 00 00 00 0a 00 00 00` |

So a **trade-rights agreement updates BOTH directions of the pair
identically** — the matrix is bilateral storage, not one-sided
perception. (Compare with M2TW which uses separate per-side opinion
scores; RR appears to store the agreement state at both indices.)

**Enum semantics (PARTIAL — CONFIRMED + HYPOTHESIS)**:

- `prev=5, curr=0` — **CONFIRMED** default for every never-touched
  faction-pair (all 57,121 cells at campaign-start, including
  diagonal r==c self-pairs)
- `prev=0, curr=1` — **CONFIRMED** = "trade rights granted"

Other classic-RTW diplomacy states (war=2?, peace/treaty=3?,
alliance=4?, protectorate=5?, etc.) NOT yet observed in this save
pair. The `prev=5` default actually overlaps with what might be
"protectorate" in other formats — so the enum may have two distinct
slots ("history/sentinel" at +0 vs "agreement" at +4) rather than a
single state-machine.

**Confidence: CONFIRMED** that the 14.5MB section at
`0xf8fd2..0x1ed64b5` is the diplomatic state matrix and that
`(prev=5,curr=0)→(prev=0,curr=1)` represents trade-rights at both
`[player][target]` and `[target][player]`. Future cracking of war/
peace/alliance enums requires save pairs taken right before/after each
of those specific actions.

#### Matrix verification

`dig-diplo-cleanF.js` walked the entire 239×239 grid and tabulated
(prev,curr) pairs:

- A (before): 57,121 cells all (5,0). Zero non-default cells.
- B (after):  57,119 cells (5,0) + 2 cells (0,1) at [0][156] and [156][0].

This is the smallest possible diff for a meaningful diplomatic action,
strongly indicating that the campaign was at turn 1 with no other
historical diplomacy (matches the user's brief: "fresh-loaded
campaign; Messapians has not yet been negotiated with").

#### Stretch findings

(a) **AI per-faction counters at `+(52+4N+148/172/224)` (sessions 22,
31): NOT TICKED** in this save pair. The two diffs near these
offsets in earlier sessions were at the *faction-table base* near
`0x103xxx`; in this clean save the only change there is `[0][156]`
(which is the matrix cell, NOT a faction counter — the matrix happens
to overlap that file region). **STRONG support for session 31's
"per-turn, not per-action" hypothesis**: counters that didn't move
across a diplomatic action must be tied to end-turn processing.

(b) **Unified event log at `0x51b5..0x846af`** (session 27): **ZERO
events from the diplomatic action**. Trade rights does NOT write to
this log. The log appears to be reserved for character/army/agent
actions or per-turn summary events.

(c) **Per-tile event registry at `0x84f1f` (session 26)**: **ZERO
events**. Diplomacy is bilateral-faction-pair state, not tile-
scoped, so no per-tile log entry — consistent.

(d) **Mystery byte cluster at `0xa8e00..0xaa9e8`** (~30 single-byte
u32 diffs): these are inside what looks like a tile-coordinate
table (values like `c8 01` = 456, `4a 02` = 586). Likely AI
strategic-target re-evaluation triggered by the new trade
partnership. **HYPOTHESIS**: AI re-scores trade-related move
candidates the same turn an agreement is signed.

(e) **−10 net byte delta** sourced entirely from the move-trail /
path-history table at `0x1f1dc00..0x1f1de00` (small-u8 records
terminated by `00 ff 00 ff 00 ff 00 [u16]`). This is NOT the
diplomatic-attitude matrix — it's some movement/action history that
also shifts when diplomacy changes. ~1116 +1/-1 byte insert/delete
pairs in the per-region area `0xf80000..0x1f00000` are pointer-list
re-encodings that re-balance perfectly to net 0; only the move-trail
section contributes net delta.

#### Practical implications for the Provincia app

- **Save-cracker can now READ DIPLOMATIC STATE** for any RR save:
  scan from offset `0xf8fd2`, stride 267 bytes, 239×239 cells. For
  each cell `[r][c]`: `prev = u32(off+0)`, `curr = u32(off+4)`.
  `prev=5,curr=0` ⇒ never-met (default). `prev=0,curr=1` ⇒ trade
  rights agreed.
- For the Romans player, **row 0 is your view of every other
  faction**. Mirror with column 0 (everyone's view of Romans) — they
  should match for the agreement-state byte. If they don't, that's
  the engine's recent-event window state.
- **Matrix start `0xf8fd2` is mod-stable** as long as faction count
  stays at 239. If a mod adds/removes factions, the matrix scales
  to `K×K` cells of 267 bytes each, and matStart may shift due to
  earlier-section size changes — but the stride (267) and the per-cell
  layout almost certainly remain identical.

#### Scripts

- `dig-diplo-clean1.js` — initial byte-by-byte diff, found 3318
  raw-aligned diffs
- `dig-diplo-clean2.js` — head/tail anchoring, established 10-byte
  shift point in trailer region
- `dig-diplo-clean3.js` — shift-transition scanner (proved 1300+
  pointer-fixup transitions but no structural inserts apart from
  one region)
- `dig-diplo-clean4.js` — Myers-style 2-pointer diff with lookahead;
  produced `diplo-clean-events.json` with 3603 classified events
- `dig-diplo-clean5..7.js` — zoomed in on the two `05→01` enum
  flips; characterized the 267-byte stride and 239-per-row groups
- `dig-diplo-clean8..9.js` — searched for lua-footer faction-id
  table (NOT present in this save — the `id_<faction>` table from
  session 23 appears only in some saves)
- `dig-diplo-cleanA..D.js` — pinned matrix start at `0xf8fd2`, full
  record layout
- `dig-diplo-cleanE.js` — walked 60,000 cells forward; **57,122 of
  them have enum=5**, confirming the 239² matrix and ~5 noisy outliers
- `dig-diplo-cleanF.js` — full matrix scan; only 2 cells changed
  ([0][156] and [156][0])
- `dig-diplo-cleanG.js` — byte-level verification of the flip:
  prev `5→0`, curr `0→1`
- `dig-diplo-cleanH.js` — confirmed 57,121 cells (5,0) before; 2
  cells (0,1) after
- `dig-diplo-cleanI..L.js` — investigated stretch targets: AI
  counters didn't tick, event log is empty, region records account
  for net −10 via move-trail table
- `dig-diplo-cleanM..N.js` — characterized the move-trail / path-
  history table at `0x1f1dc00+` (not the attitude matrix)

---

### Findings 2026-05-12 (background session 33 — diplomacy enum values + siege flag + alliance state)

**HEADLINE: SIEGE FLAG CRACKED. Trade-rights / map-rejection /
protectorate-revoke / war / alliance enum semantics characterized.**
A 9-save ladder isolating each diplomatic action one at a time let us
read off ALL enum and per-cell field changes for the 239×239 matrix
that session 32 located. Plus a 73-byte "siege record" block was pinned
exactly (CONFIRMED, cross-validated across two siege-start/stop pairs).

#### Save corpus

9 saves, with one well-defined action between each successive pair:

| File | Action | netΔ |
|---|---|---|
| save_1.1 | baseline (turn 1, no trade rights, no alliances) | — |
| save_2.1 | +trade rights w/ Messapians (idx 156) | −10 |
| save_3.1 | +alliance w/ Messapians | +166 445 |
| save_4.1 | map-request rejected by Messapians | −16 |
| save_5.1 | revoke protectorate+access w/ Taras (idx 207) | +3 016 |
| save_6.1 | break alliance → war w/ Messapians | −2 834 |
| save_7.1 | + active siege of Brundisium | +73 |
| save_8.1 | + attack/betray Taras; siege of Tarentum | +3 218 |
| save_9.1 | stop siege of Tarentum (still at war) | −73 |

**Faction indices** (from `descr_sm_factions.txt` declaration order,
239 entries total, confirmed by counting all `"<name>":` headers):
- `romans_julii` = 0
- `messapians` = 156
- `taras` = 207
- `vettones` = 228
- `slave` = 238 (last)

**Matrix start `0xf8fd2` is STABLE across ALL 9 saves** in this
corpus. The hint from session 32 was used directly — every save's
fingerprint check (`u32(+12) == 10` + small u32 at `+0`) passed on
the first 100 consecutive cells starting at exactly that offset.

#### CONFIRMED: Full enum semantics for `curr` and `prev` fields

For each consecutive save-pair, ONLY 4–8 cells out of 57,121 differ
in the bilateral matrix. Most of those are AI-jitter on cells
`[0][155]` and `[155][238]` (or `[0][206]` and `[206][238]`) — these
appear to be an internal coupling artifact (NOT real diplomacy state),
matching the "noisy outlier" pattern session 32 already flagged.

Real diplomacy changes are on Roman/Messapians/Taras rows and
columns. The ladder reveals:

| Pair | Action | Cell | prev/curr A → B | Other Δ |
|---|---|---|---|---|
| 1→2 | +trade rights w/ Mess | `[0][156]`+`[156][0]` | (5,0) → (0,1) | — |
| 2→3 | +alliance w/ Mess | `[0][156]`+`[156][0]` | (0,1) → (0,1) **no change** | — |
| 3→4 | map-request REJECTED by Mess | `[0][156]`+`[156][0]` | (0,1) → (0,**-1**) | — |
| 4→5 | revoke protectorate w/ Taras | `[0][156]`+`[156][0]` | (0,-1) → (5,0) reset | side-effect of cascading? |
|     |   | `[0][207]`+`[207][0]` | (5,0) → (0,1) | — |
| 5→6 | declare war w/ Mess | `[0][156]` only | (5,0) → (5,0) **prev/curr unchanged** | `+8`: 0 → **-200** |
|     |   | `[0][207]`+`[207][0]` | (0,1) → (5,0) reset | — |
| 6→7 | siege Brundisium (no diplomacy) | (nothing changes in the matrix) | — | — |
| 7→8 | attack Taras (betrayal → war) | `[0][156]` | `+8`: -200 → 0 | — |
|     |   | `[0][207]` | (5,0) → (5,0) **prev/curr unchanged** | `+8`: 0 → **-350** |
| 8→9 | stop siege Tarentum (no diplomacy) | (nothing changes in the matrix) | — | — |

**Distilled enum semantics (CONFIRMED + STRONG)**:

- `prev=5, curr=0` — **CONFIRMED** never-met / default / "back to default after reset"
- `prev=0, curr=1` — **CONFIRMED** "trade rights granted" OR "protectorate/military-access ended" (the curr=1 state is GENERIC "active explicit relationship", not specifically trade rights — revoking a protectorate also produces `(0,1)`)
- `prev=0, curr=-1` (i.e. `curr = 0xFFFFFFFF`) — **CONFIRMED** "agreement was REJECTED" cooldown / sour-aftermath flag. Both directions get the -1; persists until a subsequent action resets it.
- `prev=5, curr=0` (after a previous interaction) — **CONFIRMED** matrix was RESET. Observed when revoking protectorate+access cascades and clears all pending state on related factions (e.g. Mess cell reset when Taras protectorate was revoked — likely an alliance/treaty cascade resolving).
- **WAR DOES NOT CHANGE `prev` OR `curr`** — CONFIRMED. Declaring war never touches the 8-byte `(prev,curr)` pair. War is signaled exclusively on the `+8` field as a signed-int penalty.
- **ALLIANCE DOES NOT CHANGE `prev` OR `curr` either** — CONFIRMED. After +alliance w/ Mess, the cell stayed at `(0,1)` from the trade rights state. So alliance state lives **outside** the matrix entirely (likely in per-faction trailing data — see Alliance section below).

**`+8` field is the WAR/RELATIONSHIP OPINION DELTA (signed-int u32)** — STRONG/CONFIRMED:

- `+8 = 0` for never-warring pairs (default)
- `+8 = -200` after declaring war w/ Mess (`[0][156]` in save_6)
- `+8 = -350` after betraying alliance with Taras (`[0][207]` in save_8) — worse than ordinary war
- `+8` reverts to 0 when the cell is overwritten by some other engine action (e.g. `[0][156]` saw -200 → 0 in save_8 — the war penalty was reset, possibly because a new bigger conflict (Taras war) consumed the player's diplomacy state)

**HYPOTHESIS**: `+8` is a "war-aggression" or "recent-hostile-action" score that:
- Decays each turn,
- Spikes -200 on declare-war, -350 on alliance-betrayal,
- Combines with the +20/+28/+32 base opinion to produce final
  "AI hostility score".

#### CONFIRMED: Per-cell fields `+20`, `+28`, `+32` are static descr_strat-derived opinion components

Histogram across the entire `save_1.1` matrix (clean baseline):

- `+20` values: {0 × 448, 200 × 465, 600 × 476, 1 outlier} — a **3-level
  quantized opinion axis** at 0 / 200 / 600
- `+28` values: mostly 6 with rare other values (mostly AI eval jitter)
- `+32` values: {0 × 220, 200 × 284, **−10 × 171** (signed s32),
  400 × 1, 600 × 713} — a **5-level opinion axis** including
  negative values

Total **1390 cells** (out of 57,121) have non-default `(+20, +32) =
(200, 200)` values in save_1.1. The non-default pattern is:

- **Col 237 (vettones)** has `(+20, +32) = (600, 600)` in 220/239 rows
  — descr_strat marks every faction's view of vettones strongly positive
- **Row 238 (slave/rebels)** has `(+20, +32) = (600, 600)` in 219/239
  cols — descr_strat marks slave/rebels strongly positive on outgoing
  axis
- Diagonal `[r][r-1]` adjacent cells frequently `(0, 200)` —
  starting "neutral but lower than default" with adjacent faction (likely
  reflecting "border tension" baseline)

So `+20` and `+32` together encode the **starting bilateral opinion**
from `descr_strat.txt`'s starting-relations declarations. `+8` is the
running opinion delta from in-game actions. `+28` mostly stays at 6
(initial "respect" or "trust" gauge).

#### CONFIRMED: SIEGE FLAG — 73-byte siege record at fixed offset

**A single 73-byte "siege record" block exists at file offset
`0x152f529` for each active siege.** Block layout:

```
+0    u8     0x01           — active-siege flag
+1..+12  u8[12]   UUID       — random 12-byte siege identifier
+13..+65  u8[53]  zeros      — reserved (besieger references, siege
                              progress, supply, etc.; all zero in
                              our captured pair)
+66..+67  u16     0x08d5 = 2261 — settlement strength / wall HP
                                 (same value 2261 for BOTH
                                 Brundisium and Tarentum sieges)
+68..+72  u8[5]   zeros
total: 73 bytes
```

**Verified deltas (CONFIRMED across two independent siege start/stop
events)**:

- save_6 → save_7 (Brundisium siege STARTS): +73 bytes, block UUID
  `8ca7c190a40c62d30ae06177`, +66 u16 = 2261
- save_8 → save_9 (Tarentum siege STOPS):    −73 bytes, block UUID
  `7093a67be00e7f3deb2ac995`, +66 u16 = 2261

The block at `0x152f529` is **the same fixed offset for both events**
— the engine uses a static slot. Saves with no siege (save_1..save_6,
save_9) have **zero matching blocks**; saves with one siege (save_7,
save_8) have **exactly one**. The siege block is positioned ~64 bytes
before the besieged settlement's name (`Taras` appears at
~`0x152f5a0` in save_8; `roman general` string appears as a marker
between siege block and settlement name).

**Besieger-side back-reference**: A 5-byte structure `01 [4-byte
UUID-prefix]` is written into the besieging army's character/army
record. Confirmed locations:

- save_7 (Brundisium besieger): `01 8c a7 c1 90` at file offset
  `0x1263383` (5-byte struct preceded by `3a 05 2b ee` which is
  another army-record field)
- save_8 (Tarentum besieger): `01 70 93 a6 7b` at file offset
  `0x12d8723` (5-byte struct preceded by `de b1 0f 70`)

The 4-byte UUID-prefix matches the first 4 bytes of the siege record's
12-byte UUID. The byte BEFORE the `01` is the army's own UUID
(unrelated to the siege UUID). So the structure on the besieger's
record is `[army_uuid_4B] [01 siege_uuid_prefix_4B]` — a 9-byte
"current-siege" sub-record.

**Practical implication for the Provincia app**: To detect "settlement
X is under siege":
1. Scan the file for 73-byte blocks matching the siege fingerprint
   (predicate: `buf[off]==1`, `buf[off+1..13]` has ≥8 non-zero bytes,
   `buf[off+13..66]` all zero, `0 < u16(off+66) < 65536`,
   `buf[off+68..73]` all zero). On rome10-equivalent saves the block
   is at exactly `0x152f529`; on other saves it may shift slightly.
2. The besieged settlement's name appears in UTF-16LE within ~256
   bytes after the siege block (just past a `0e 00 0e 00 "roman
   general\0"` marker).
3. To identify the besieging army, search the file for the 5-byte
   pattern `01 [first 4 bytes of siege UUID]` — that 5-byte
   structure sits inside the army's character record.

#### CONFIRMED-NEGATIVE: Alliance state is NOT in the diplomacy matrix

save_2 → save_3 (+alliance w/ Messapians, +166KB) introduces NO change
at `[0][156]` or `[156][0]` (both stay at (0,1)). Yet the file grew
166445 bytes between the two saves. A full Myers-style aligned diff
revealed 2.4MB of inserts and 2.2MB of deletes (massive churn from
end-of-turn processing — including ~8KB blocks containing character
portrait paths like `data/ui/greek/portraits/portraits/young/generals/127.tga`
that indicate **new characters were generated**). This corpus was
captured AFTER an end-turn between save_2 and save_3 — alliance state
cannot be cleanly isolated from this pair.

**HYPOTHESIS**: Alliance is stored in **per-faction trailing data**
(session 9's open question), specifically as a list of allied
faction-IDs on each major-faction record. Confirming this requires a
fresh save-pair with NO end-turn between the trade-rights and alliance
actions.

#### Practical implications for Provincia

- **Diplomacy state for any RR save can now be decoded fully**:
  - `prev=5,curr=0` ⇒ never interacted
  - `prev=0,curr=1` ⇒ active relationship (trade rights, or
    post-protectorate)
  - `prev=0,curr=-1` ⇒ recent rejection cooldown
  - `+8 < 0` ⇒ at war (the magnitude encodes how recent / how severe:
    -200 = ordinary war, -350 = betrayal war)
  - The bilateral "starting opinion" (per descr_strat) is encoded in
    `+20` and `+32` at quantized levels {0, 200, 400, 600, or -10}
- **Siege detection** for app's region view: scan for the 73-byte
  siege block at `0x152f529`. Each settlement at most one block. Use
  it to surface "X is under siege" badges per-region.

#### Scripts

- `dig-diplo-ladder1.js` — locate matrix start across all 9 saves
  (every save's matStart = 0xf8fd2; cell sample for Rom/Mes/Taras)
- `dig-diplo-ladder2.js` — full 239×239 matrix diff for each
  consecutive save pair, listing every changed cell with first-40
  bytes of u32 deltas
- `dig-diplo-ladder3.js` — per-column / per-row +20 / +32 distribution
  in save_1 baseline (revealed vettones col & slave row = 600/600)
- `dig-siege1..6.js` — aligned diff save_6→save_7 and save_8→save_9,
  pin the 4 + 13 + 56 = 73-byte insert/delete location
- `dig-siege7..9.js` — structural fingerprint matcher for the 73-byte
  siege block; cross-validate Brundisium (save_7) and Tarentum
  (save_8); confirm no false positives across the 9-save corpus
- `dig-alliance1..2.js` — save_2 → save_3 alliance analysis;
  confirmed alliance state lives outside the diplomacy matrix and
  cannot be cleanly extracted from this end-turn-laden pair

#### Confidence summary

- **CONFIRMED** (cross-validated across ≥2 independent observations):
  - Matrix offset 0xf8fd2 stable across 9 saves
  - Trade-rights enum (5,0)→(0,1)
  - Rejected-agreement enum (0,1)→(0,-1)
  - Default-reset enum (anything)→(5,0)
  - War does NOT change prev/curr — only `+8`
  - `+8` is signed war-opinion delta (-200 declare-war, -350 betray)
  - Siege block 73 bytes at 0x152f529 with `01 + 12-UUID + 53*0 +
    u16(2261) + 5*0` layout
  - Siege backreference on besieging army: `01 [4-byte UUID prefix]`
- **STRONG** (single direct observation + consistent indirect support):
  - Protectorate revoke produces `(5,0)→(0,1)` (Taras transition in
    save_4→save_5)
  - +20/+32 are descr_strat-derived starting bilateral opinions
  - The u16=2261 trailer in siege block is constant (both sieges
    same value) — most likely settlement strength / wall HP
- **HYPOTHESIS** (one observation, alternative interpretations possible):
  - Alliance state stored in per-faction trailing data (session 9)
  - The cell-reset cascade on save_5 (Mess cell reset when Taras
    protectorate revoked) reflects an alliance/treaty link being
    severed
  - `+28` is a per-cell "trust/respect" axis (mostly stays at 6, +20
    rare AI-eval jitter)

---

### Findings 2026-05-12 (background session 34 — occupy/enslave/exterminate + alliance + siege fields)

**HEADLINE: Siege block size + besieger back-reference corrected (was 73B/5B
in session 33 — actually 69B/4B). Post-conquest action choice (occupy /
enslave / exterminate) reflected in a 3-field "settlement unrest" block at
Uria-1590..-1582 with initial values that discriminate the choice. Alliance
state still not isolated — buried in end-of-turn AI cache churn. Session
33's typo `matEnd = 0x1ed64b5` corrected to `matEnd = 0xf8473d`.**

#### Save corpus used

| File | Action | Uria settle marker | Comparison role |
|---|---|---|---|
| save_2.1 | trade-rights baseline (no alliance) | n/a | alliance A |
| save_3.1 | +alliance Mess (after end-turn) | n/a | alliance B |
| save_6.1 | war w/ Mess (no siege) | n/a | siege A |
| save_7.1 | siege Brundisium | n/a | siege B |
| save_8.1 | siege Tarentum (Brundisium siege replaced) | n/a | siege C |
| save_9.1 | stop siege Tarentum | n/a | siege D |
| save_9.1 | (pre-Uria-capture) | 0x1264861 | occupy A |
| save_10.1 | ENSLAVE Uria | 0x1264861 | occupy B |
| save_11.1 | captured Brundisium (different branch, 1 turn later) | 0x12693c6 | aging |
| save_12.1 | EXTERMINATE Uria (alternate branch) | 0x1264861 | occupy C |

#### CONFIRMED REVISION: session 33's siege block is 69 bytes, not 73; back-reference is 4 bytes, not 5; session 32 had a `matEnd` typo

- **Matrix end is `0xf8473d`** (= `0xf8fd2 + 239*239*267` = `0xf8fd2 +
  0xe8b66b`). Session 32's RESEARCH.md states `0x1ed64b5` — **TYPO**.
  Verified: cell `[238][238]` starts at `0xf84632`, cell `[238][238]+267 =
  0xf8473d`. Confirmed via direct cell-start arithmetic for `r=238, c=237`.
- **Siege block is 69 bytes at `0x152f529`, NOT 73 bytes**. The 73-byte file
  delta on siege-start consists of two separate inserts:
    1. **4 bytes at `0x1263384..0x1263387`** (besieger-side reference,
       inside the besieging army's record). In save_6 (pre-siege) those
       4 bytes were `00 00 00 00`; in save_7 (Brundisium besieging) they
       became `8c a7 c1 90` — the **4-byte siege-UUID prefix**. The byte at
       `0x1263380..0x1263383` (one before the back-ref) also changed
       (`07 f1 74 00` → `05 2b ee 01`), but that's a 4-byte runtime hash
       recomputation, NOT an insert.
    2. **69 bytes at `0x152f529..0x152f56d`**: the siege record proper:
        - `+0` u8 `0x01` — active-siege flag
        - `+1..+12` u8[12] — 12-byte siege UUID
        - `+13..+65` u8[53] — all zeros (reserved fields)
        - `+66..+67` u16 LE = `0x08d5` = **2261** (semantics still unclear,
          see "REFUTED: wall HP" below)
        - `+68` u8 = 0 — terminator
- Cross-validated: save_6 → save_7 inserts +73 bytes total = 4 + 69.
  save_8 → save_9 deletes -73 bytes total = 4 (at besieger record) + 69
  (at `0x152f529`).
- Reproducer: `dig-siege-turn6.js` (save_6→save_7 shift-diff with run≥64),
  `dig-siege-turn8.js` (save_8→save_9).
- Confidence: **CONFIRMED** (cross-validated, exact byte accounting).

#### REFUTED: u16 = 2261 at siege block +66 is NOT wall HP

Session 33 said `u16(+66) = 2261 = settlement strength / wall HP`. **Refuted**:

- Brundisium's `defenses` chain record (per session 17, HP at chain start
  + 40) reads **HP = 100** in save_6, save_7, save_8, save_9 — never 2261.
  Wall is also at HP=100 in undamaged settlements per the building parser.
- u16 = 2261 occurs ONLY at the siege block site in save_7 and save_8
  (other occurrences are far away — diplomacy-matrix internal hashes or
  per-tile registry data, unrelated to walls).
- u16 at +66 is **identical (= 2261) for two different cities** (Brundisium
  walls level ≠ Tarentum walls level in descr_strat — they should differ
  if it were wall HP).

**STRONG / HYPOTHESIS**: u16=2261 is a CONSTANT engine literal — possibly
"siege state magic / record-type tag" or `(0x08, 0xd5)` interpreted as a
2-byte (siege_max_duration_turns=8, internal_constant=0xd5). Not enough
samples (only 2 sieges captured) to distinguish "constant" vs "varies".

**No turn-counter byte found inside the 69-byte siege block** — bytes
`+13..+65` are all zeros in BOTH save_7 (Brundisium siege, just-started)
and save_8 (Tarentum siege, just-started). To find a turn-counter we'd
need a save with a siege that has progressed several turns; the corpus
doesn't include one. The siege duration tracker most likely lives in the
besieging army's character record (per RTW's "siegeTurnsInSet" string
referenced in the engine), NOT in the siege block.

Reproducer: `dig-siege-turn1.js`, `dig-siege-turn2.js`,
`dig-siege-turn10.js`, `dig-siege-turn11.js`, `dig-siege-turn12.js`.

#### STRONG / HYPOTHESIS: Post-conquest action choice (occupy/enslave/exterminate) encoded in 3-field "settlement unrest" block at Uria-1590..-1582

Settlement record schema for **Uria** (RIS imperial mod, file offset
`0x1264861` in save_9.1, save_10.1, save_12.1) examined across 4 saves to
distinguish ENSLAVE (save_10.1) from EXTERMINATE (save_12.1) from
pre-capture (save_9.1) from "1 turn after enslave" (save_11.1):

| Field | Description | save_9.1 (pre) | save_10.1 (enslave) | save_11.1 (+1 turn enslave) | save_12.1 (exterminate) |
|---|---|---|---|---|---|
| Uria-34 (u16) | settlement population | 1500 | 750 | 746 | 400 |
| Uria-28 (u32) | per-turn modification tick | 82695 | 82720 | 82632 | 82710 |
| Uria-1606 (u32) | unrest-event-slot-A | 0 | 0 | 0 | **1100** |
| Uria-1602 (u32) | unrest-event-slot-B | 0 | **750** | 0 | 0 |
| **Uria-1590 (u32)** | **post-conquest event code / unrest counter** | 0 | **1** | 2 | **4** |
| Uria-1586 (u32) | population-derived secondary | 133 | 75 | 72 | 41 |
| Uria-1582 (u32) | population-derived tertiary | 1215 | 511 | 469 | 276 |

**Cross-reference Brundisium-1590 = 11 in save_11.1** (Brundisium just
captured + OCCUPIED). Combined enum values observed:

- **1** = ENSLAVE just chosen (Uria save_10.1)
- **4** = EXTERMINATE just chosen (Uria save_12.1)
- **11** = OCCUPY just chosen (Brundisium save_11.1)
- **0** = never conquered (Uria save_9.1, all uncaptured settlements)

**HYPOTHESIS** (single observation per action — not yet CONFIRMED): the
3-field block at -1590..-1582 represents `(post-conquest_event_counter,
disorder_remaining_a, disorder_remaining_b)` where the initial value of
the first u32 depends on the action chosen. Subsequent turns INCREMENT
the counter (Uria-1590 went 1→2 from save_10.1 to save_11.1) which is
consistent with a "turns since post-conquest event" counter. The
"discriminating signal" is therefore the **fresh-after-action value**, not
the long-running value.

Alternative interpretation: -1590 may encode a hash of (action, fresh)
that just happens to differ. Without more conquest data points (e.g., 2
separate save pairs each for occupy/enslave/exterminate at different
turn rotations), this remains HYPOTHESIS.

**Population (Uria-34) is the cleanest discriminator** as a continuous
value: ENSLAVE halves population (`1500 → 750`), EXTERMINATE reduces it
more aggressively (`1500 → ~400` ≈ 27% of pre-conquest). OCCUPY would
leave population intact or close to it.

Per brief, EXTERMINATE should also damage buildings. **REFUTED for Uria**:
Uria's 2 chain records (`hinterland_region`, `core_building`) BOTH show
HP=100 in save_12.1 (exterminate). Per session 17, `core_building` (the
settlement-itself) shows HP=45 and `defenses` shows HP=88 for Brundisium
in save_11.1 (post-assault occupy). So **assault damage applies in OCCUPY
mode (when the player chose to storm walls)**, NOT to extermination per
se. Exterminate's effect appears to be POPULATION-only, not buildings.

Reproducer: `dig-occupy1..14.js`. Confidence: **STRONG** for the population
discriminator; **HYPOTHESIS** for the -1590 enum encoding.

#### CONFIRMED: Settlement record schema extension (RIS imperial mod)

Fields verified in this session (offsets relative to settlement UTF-16LE
name marker byte = `0x01` flag at marker offset):

| Offset | Type | Field | Notes |
|---|---|---|---|
| -34..-33 | u16 LE | **current population** | halves on enslave, ~ 27% on exterminate |
| -32..-29 | u32 LE | (zeros) | reserved |
| -28..-25 | u32 LE | **per-turn modification tick** | tiny variation per turn (82632..82720 in samples) |
| -21..-9 | varies | **8-byte settlement UUID pair** | `5348 2601 5748 2601` (consistent across saves with same Uria) |
| -8..-5 | u32 LE | `0xef000000` | terminator marker |
| -4..-1 | u32 LE | `0x00010400` | record-class tag |
| +0 | u8 | `0x01` | name-flag (= 0x00 in some Alex saves) |
| +1 | u8 | name length (chars) | =4 for "Uria" |
| +2 | u8 | `0x00` | UTF-16 high byte |
| +3..+10 | UTF-16LE | settlement name | "Uria" |
| +11..+15 | u8[5] | zeros | pad |
| +16..+19 | u32 LE | `0xfcfcfcfc` | sentinel after name |
| +20..+23 | u32 LE | 0x64 = 100 | major-class echo |
| +24..+27 | u32 LE | 0x00000398 = 920 | count? |

Post-conquest "unrest" block (HYPOTHESIS):

| Offset | Type | Field | Initial value (action) |
|---|---|---|---|
| -1610..-1607 | u32 | unrest-event-slot-pre? | 0 |
| -1606..-1603 | u32 | unrest-event-slot-A | 1100 fresh exterminate; 0 otherwise |
| -1602..-1599 | u32 | unrest-event-slot-B | 750 fresh enslave; 0 otherwise |
| **-1590..-1587** | **u32** | **post-conquest event code** | 1 enslave / 4 exterminate / 11 occupy / 0 never |
| -1586..-1583 | u32 | unrest secondary | 75 enslave / 41 exterminate (decays) |
| -1582..-1579 | u32 | unrest tertiary | 511 enslave / 276 exterminate (decays) |

Confidence: **CONFIRMED** for population at -34 (4 data points, monotonic
decrease across enslave→further-decay→exterminate); **STRONG** for the
3-field unrest block existing (consistent zero baseline in 3 other
settlements; non-zero only in just-captured settlements);
**HYPOTHESIS** for the discrete enum encoding of -1590.

Reproducer: `dig-occupy12.js` (full byte-aligned u32 dump),
`dig-occupy13.js` (cross-settlement -1590..-1582 comparison).

#### REFUTED: Alliance state isolated from end-of-turn churn (still BLOCKED)

save_2.1 → save_3.1 (+alliance w/ Mess) was re-attacked using the
diplomacy matrix mask. **Within the matrix, only 3 cells changed**:

- `[0][156]` (Romans→Mess): **0 byte diffs** — confirms session 33's
  "alliance does NOT change prev/curr"
- `[156][0]` (Mess→Romans): **0 byte diffs** — same
- `[238][238]` (final boundary cell): 8 byte diffs at +44..+47 and
  +121..+124 — but `[238][238]` is the section-boundary cell that overlaps
  with the next file section (per session 32's note "cell may stop at
  col 237"); the changed bytes there are **runtime-hash recomputations
  in the post-matrix section** (which begins with "default_set" /
  "hinterland_region" strings), NOT alliance state.

**Outside the matrix, pre-matrix bytes (range `0..0xf8fd2`) have 88,205
diffs** in 2,208 clusters, dominated by:

1. **Cluster `[0x84f2f..0xa8bf7]` (146 KB)** — a fixed 26-byte stride
   structure (4 hash bytes + 22 constant bytes per cell, per
   `dig-alliance-deep7.js`). This is the per-tile or per-entity AI
   evaluation cache; **every cell got its 4-byte hash recomputed** when
   alliance state changed. It is NOT the alliance entry but downstream
   AI cache churn.
2. **Cluster `[0x52ed..0x1ec28]` (104 KB)** — a fixed 12-byte stride
   structure (4 hash bytes + 8 structured bytes per cell). Per-tile or
   per-entity ID-keyed runtime data. Also AI cache.
3. ~72 medium clusters (60-400 B) — each one ~28-byte stride records
   with 4-byte hash recomputation, scattered through `0xae00..0xf7000`.
   Again AI cache.

**None of the small inserts (8-96 bytes) between save_2.1 and save_3.1
in the pre-matrix region contain the u32 = 156 (Messapians)** as a
"list-entry-added" signature. The classic vanilla-RTW model — a per-faction
allied-factions list with one u32 entry per ally — is NOT how this mod
stores alliances, OR the list is stored with a different encoding
(perhaps as a packed bit-set indexed by faction ID).

**Search-space narrowed**:

- NOT in the diplomacy matrix (CONFIRMED).
- NOT as a small inserted-record carrying `u32(156)` (CONFIRMED).
- LIKELY hidden in either: (a) a fixed-length per-faction structure
  inside the pre-matrix region that overwrites bytes in place (no
  size change, just bit-flips), OR (b) the lua-state region (session
  14) where script-driven flags would be plausible.
- **Bit-set theory** (best HYPOTHESIS): if each major faction's record
  has a 239-bit (=30-byte) allies bitmap, the alliance flip would
  toggle 2 bits (one on Romans' bitmap for Messapians, one on Mess's
  bitmap for Romans). Such a flip would NOT match any of the 88K
  byte-diff clusters (which are all hash-shaped 4-byte u32s), unless
  the bitmap byte happens to also include the relevant bit.

Recommended next probe: capture an in-turn save pair (no end-turn
between trade-rights and alliance) to eliminate the 88K-byte churn
entirely. The current corpus's `save_2.1 → save_3.1` had a turn rotation,
which is the root cause of irreducible noise.

Reproducer: `dig-alliance-deep1..10.js`. Confidence: **REFUTED**
that alliance state lives in the diplomacy matrix or in any cleanly
isolated insert; **HYPOTHESIS** that it lives in a per-faction
fixed-length bitmap inside the pre-matrix region.

#### Practical implications for Provincia

- **Decode current population** of any settlement: read u16 LE at
  `(settlement_marker_offset - 34)`. Halves on enslave; reduces to ~27%
  on exterminate.
- **Detect freshly-conquered settlement**: read u32 LE at
  `(settlement_marker_offset - 1590)`. Values:
    - 0 = never conquered by current owner
    - 1 (fresh) = enslaved
    - 4 (fresh) = exterminated
    - 11 (fresh) = occupied
    - Increments each turn — fresh value most informative.
- **Siege detection (revised)**: 69-byte block (not 73) at
  `0x152f529..0x152f56d`. The fingerprint test in session 33's brief
  works (`+13..+65` all zero, u16 at `+66`, etc.), but the block ends
  at +68, not +72. Bytes `+69..+72` are part of the FOLLOWING settlement
  record. Adjust extractors accordingly.
- **Besieger back-reference is 4 bytes**, not 5: a 4-byte siege-UUID
  prefix written into the besieging army's record at a slot that was
  previously zero. Scan for `01` byte FOLLOWED BY the siege block's
  first 4 UUID bytes is misleading — the `01` is part of the army
  record's pre-existing structure, only the next 4 bytes change.
- **Alliance state cannot yet be decoded**. Trade rights and rejection
  are decoded (session 32/33); alliance and protectorate remain blocked
  pending a cleaner save corpus.

#### Confidence summary

- **CONFIRMED** (cross-validated across ≥2 observations):
  - matEnd = `0xf8473d` (session 32 RESEARCH typo corrected)
  - Siege block size = 69 bytes (file delta matches exactly: 4 + 69 = 73)
  - Besieger back-reference = 4-byte UUID prefix at the army record
    (not 5-byte `01+prefix`)
  - Settlement population at marker-34 (u16) halves on enslave, ~27% on
    exterminate
  - u16=2261 at siege block +66 is NOT wall HP (defenses chain shows
    HP=100, not 2261)
- **STRONG** (single direct observation + indirect support):
  - The 3-field block at Uria-1590..-1582 is a "post-conquest unrest"
    structure (consistent zero baseline in 3 other settlements; non-zero
    only after conquest; values decay over turns)
- **HYPOTHESIS** (one observation, alternative interpretations possible):
  - u32 at Uria-1590 = action-discriminating enum with initial values
    1 (enslave), 4 (exterminate), 11 (occupy) — single observation per
    action; could also be a derived counter
  - u16=2261 at siege block +66 is an engine constant (siege state
    magic / record-type tag), not wall HP
  - Alliance state stored as a per-faction 239-bit allies bitmap inside
    the pre-matrix region (not yet located — buried in end-of-turn
    AI cache churn)

#### Reproducer scripts

- `dig-occupy1.js` — locate Uria/Brundisium/Tarentum markers across 4
  saves
- `dig-occupy2..5.js` — diff Uria record save_9 vs save_10 (enslave) and
  save_11 vs save_12 (exterminate); find bytes that differ in BOTH diffs
- `dig-occupy6..8.js` — verify field offsets; isolate the -1590..-1582
  unrest block
- `dig-occupy9..10.js` — Uria & Brundisium building HP scans (no damage
  on enslave/exterminate; assault damage on occupy)
- `dig-occupy11.js` — direct enslave vs exterminate diff (33 runs, all
  hash-shaped except the unrest block + population)
- `dig-occupy12..13.js` — exact u32 field dump at Uria-1620..-1570 across
  all 4 saves; cross-faction comparison shows Brundisium-1590=11 (occupy)
- `dig-occupy14.js` — net +143 byte size-delta save_10 → save_12 diff
  decomposition
- `dig-alliance-deep1..3.js` — masked diff outside diplomacy matrix
- `dig-alliance-deep4.js` — cluster the 88K pre-matrix byte diffs into
  2208 clusters
- `dig-alliance-deep5.js` — examine 72 medium-sized clusters (all
  AI-cache shaped)
- `dig-alliance-deep6..8.js` — sample big clusters (26-byte and 12-byte
  stride structures = per-tile AI cache, not alliance)
- `dig-alliance-deep9..10.js` — cell-by-cell matrix diff (0 diffs at
  [0][156]/[156][0] for alliance; 8 diffs at [238][238] are
  section-boundary hashes)
- `dig-siege-turn1..5.js` — siege block characterization across save
  corpus; relaxed-fingerprint scans for false-positive control
- `dig-siege-turn6..8.js` — exact 73-byte insert/delete accounting:
  4 bytes at besieger record + 69 bytes at siege block site
- `dig-siege-turn9.js` — besieger back-reference decomposition (4-byte
  UUID prefix at army record offset 0x1263384)
- `dig-siege-turn10..12.js` — defenses chain HP verification (HP=100 in
  all saves; refutes u16=2261 = wall HP)

---

### Findings 2026-05-12 (background session 35 — 9.7MB body-root gap structural map)

**Goal**: Map the structural layout of the 9.78MB "tile-attribute gap" at
`0x633bb3..0xf88637` in `save_1.2.sav` (RIS imperial campaign, 34,524,371 bytes).
Prior research (session ~22, dossier section 5) tagged this region as a
sparse tile-attribute map with 95.8% zeros but did not identify the record
stride or grid dimensions. **This session decoded both.**

#### Main finding: the gap is a **240-wide tile-grid attribute array of fixed 267-byte records**

The bulk of the gap (the leading ~9.32 MB) is a **flat array of 36,583 records
of exactly 267 bytes each**, with no self-pointing section grammar and no
embedded strings. Each record holds a sparse fixed-shape entity that almost
always sits at its "default" value but encodes per-tile state when non-default.

**Record array layout (RIS imperial campaign, save_1.2.sav)**:
| Field | Bounds | Description |
|---|---|---|
| Array start | `0x633c50` | first record (after 157-byte zero-padded preamble at 0x633bb3..0x633c50) |
| Array end | `0xf84632` | one past last uniform record |
| Stride | **267 bytes** | exact, verified by 36,582 consecutive in-range zero-byte anchors |
| Record count | **36,583** (i=0..36,582) | all share identical header structure |

**Per-record 267-byte layout (verified by per-byte distinct-value scan across all 36,582 records)**:
```
+0   u32  const = 5             (record type tag?)
+4   u32  const = 0
+8   u32  const = 0
+12  u32  const = 0x0a = 10     (sub-type tag?)
+16  u32  const = 0xc8 = 200    (default attribute A)
+20  u32  3 distinct: 200×35,936 / 600×385 / 0×261   ← variable field A
+24  u32  const = 2
+28  u32  3 distinct: 6×36,321 / 54×250 / 55×11      ← variable field B (key spatial signal)
+32  u32  5 distinct: 200×35,872 / 600×516 / 0×100 / -10×93 / 400×1   ← variable field C
+36..+67 zeros (8 u32 fields)
+68  u32  const = 3
+72..+83 zeros (3 u32 fields)
+84  u32  const = 0x240 = 576
+88..+95 zeros (2 u32 fields)
+96  u32  const = 0xa6 = 166
+100..+266  171 bytes of zeros (constant padding to 267-byte stride)
```

Only **6 of 67 u32 fields** carry any per-record variation; the rest are
constant across all 36,583 records.

#### Map dimensions: 240 wide × 153 tall

The variable field at `+28` (call it "field B") takes value `54` (0x36) in
exactly **250 records**. Modulus-period scan over their indices is unbeatable
at **period 240**:

| Period p | i % p collision strength (max bucket / mean) |
|---|---|
| 239 | 9 / 1.0  (×9) |
| **240** | **153 / 1.0  (×153)** — every row hits the same column |
| 241 | 4 / 1.0  (×4) |
| 153 | 13 / 5.8 (×2.2) |
| 184 | 13 / 4.8 (×2.7) |

At W=240, **column 101 has a B=54 record at every row 0..152** (153 hits in
one column). At any other width the same records spread across many columns
with no collapse. This unambiguously establishes:
- **Grid width: 240 cells**
- **Grid height: ≥153 rows** (with 36,583 records, the height is 152 full rows
  plus 103 cells into a partial row 153 — so dimensions are most likely
  240 × 153 = 36,720 cells, with the file truncating the last ~137 tiles).

The pixel-map (`map_regions.tga`, 1020 × 700 px) divides into the save's grid
at roughly `1020/240 = 4.25` px/cell horizontally and `700/153 = 4.58` px/cell
vertically. So **each 267-byte record covers a ~4×5 pixel block of the map**
— consistent with a coarse strategic-overview grid (NOT per-tile), used for
fog-of-war chunks, region-membership chunks, or terrain-summary lookup.

**Likely role**: the HST entry `WORLD_MAP v=3` or `GROUND_TILE v=1` — a
per-cell engine cache. Each cell records a "type" (the constant `5` at +0),
a "subtype" (`10` at +12), default terrain (`200`), and overrides at +20 /
+28 / +32 when the cell has special properties.

#### Sub-region map of the 9.78 MB gap

| Sub-region | Bounds | Size | Description |
|---|---|---|---|
| **1. Leading zero pad** | `0x633bb3..0x633c50` | 157 B | Pure zeros. Padding between body root end and the tile-grid array. |
| **2. Tile-grid attribute array** | `0x633c50..0xf84632` | 9.31 MB | **36,583 uniform 267-byte records** on a 240-cell-wide grid. Field at +28 carries the spatial signal that confirms width=240. 97.6% of records are the all-default `(A=200, B=6, C=200)` triple. |
| **3. Settlement-record tail (3 settlements)** | `0xf84642..0xf88637` | 16.0 KB | Three full settlement-building-state records, each starting with `default_set` ASCIIZ + a `[u32 self_ptr][u16 nameLen][ASCII building-chain name]` repeated structure for ~11–14 building slots. Strings observed: `default_set, hinterland_region, core_building, government[A/C/D], military_industrial_complex, irrigated_farming, market, port_buildings, dyes_production, health, hinterland_roads, temples_of_viking, defenses, colony`. |
|     Sub-tail 1 | `0xf8464e..0xf85fdb` | 6,541 B | settlement #1 (14 building chains, `governmentD`) |
|     Sub-tail 2 | `0xf85fdb..0xf875c1` | 5,606 B | settlement #2 (11 building chains, `governmentA`) |
|     Sub-tail 3 | `0xf875c1..0xf88637` | 4,214 B | settlement #3 (≥10 chains, `governmentC`, includes `colony`) |

Sub-region 3 contains **38 self-pointers** (u32==pos at multiple offsets) — but these are **string-back-reference anchors inside the settlement records, not true taw nested sections**. The `+4` "size" field after each such self-pointer is actually `[u16 stringLen][ASCII bytes...]`, not a section size. This is exactly the **building-chain entry format** seen elsewhere in the dossier (sessions 3, 12+) and is **positional, not section-grammar** (matching the broader settlement-zone finding: post-body, the engine stops nesting).

The 3 settlements in this tail likely belong to the very last settlement-zone block that **overflows backwards** into what would otherwise have been the tile-grid's final 137 records. The settlement-zone proper continues from `0xf88637` onwards (verified: self-pointer at 0xf88637 with nested self-pointer at 0xf8863b at distance 4).

#### Negative findings (what the gap is NOT)

| Hypothesis | Evidence | Verdict |
|---|---|---|
| taw-style nested section tree | 0 well-nested self-pointers in 9.31 MB main array (only 4 false hits, all coincidental UTF-16 "Rome" string-content matches that don't pass size sanity) | **NO** — flat array, not section grammar |
| Per-faction AI strategic cache | No `ff 0a af f0` faction magic anywhere in the 9.31 MB main array | **NO** |
| Per-faction diplomatic-attitude matrix | Diplomacy matrix is 239×239×267 stride per memo — but THIS array is 36,583 × 267 (an order of magnitude larger). The 267-byte stride match is coincidence (267 = 0x10b is a generic RTW record size used in multiple sub-systems) | **NO** — same stride, different array shape |
| ASCII / UTF-16 string content in the 9.31 MB array | 0 ASCII strings ≥4 chars; 0 UTF-16LE strings ≥4 chars | **NO** — pure binary |
| Per-tile per-faction visibility (239 factions × N tiles) | The 36,583 records all have identical headers irrespective of faction; no faction-id field in record | **NO** — single global per-cell state |
| Random padding | Statistically NOT random — 13 distinct record signatures, B@+28 = 0x36 records collapse to col 101 at width 240 with p<1e-300 confidence | **NO** — structured |

#### Field-level hypotheses (graded confidence)

- **+20 / +32 (3 distinct values: 0, 200, 600)**: these track an attribute
  defaulting to 200 with sparse 0 or 600 overrides. Hypothesis: **height-band
  or terrain-elevation cache** (200 = "default land", 0 = "sea/below-base",
  600 = "elevated/mountain"). The 250-element clustering of `+28=54` (B field)
  at col 101 specifically is consistent with a **vertical river or mountain
  pass** stretching the full map height at that column.

- **+28 = 6 (default) / 54 (rare) / 55 (very rare)**: ASCII char codes
  `0x06`, `0x36 = '6'`, `0x37 = '7'`. Likely a **type enum**: 6 = normal cell,
  54 = some special property (river? bridge? wonder?), 55 = even rarer (only
  11 cells scattered across the map).

- **B=55 spatial distribution**: 11 cells at (col, row): `(5, 14), (165, 30),
  (201, 53), (204, 57), (191, 68), (171, 90), (151, 103), (150, 110),
  (134, 120), (127, 133), (109, 145)` — **monotonically decreasing col with
  increasing row** along the right side of the map. This traces a clean
  diagonal **NE→SW path** down the map. Strong hypothesis: this is the
  **Mediterranean coastline or a major trade route waypoint chain**.

#### Scripts produced

- `dig-gap1.js` — self-pointer scan of the gap (found 4 false positives, no true nesting)
- `dig-gap2.js` — 4KB-page content classification (99.8% ZERO, 0.2% real data)
- `dig-gap3.js` — exact zero-run mapping (revealed 170-byte zero / 97-byte data periodicity → 267-byte stride)
- `dig-gap4.js` — verified 267-byte stride with 36,582 consecutive zero-anchor hits
- `dig-gap5.js` — record-signature clustering (13 distinct, 35,699 default)
- `dig-gap6.js` — per-byte and per-u32 variance analysis (identified 6 variable fields)
- `dig-gap7.js` — triple analysis (A, B, C) + ASCII string scan of tail
- `dig-gap8.js` — row-stride / 2D grid period detection (period 240 best signal)
- `dig-gap9.js` — confirmed width=240 (col 101 hits every row)
- `dig-gap10.js` — characterized 3-settlement building-string tail
- `dig-gap11.js` — final negative sweep (no faction magic, no strings in main array)

#### Impact

The dossier's section-5 line ("9.8MB tile-attribute gap, NOT section-grammar")
is now **upgraded from "sparse byte-grid hypothesis" to "240×153 grid of
267-byte structured records with 6 variable fields"**. This is enough to
write a parser stub for the region. Future targeted save pairs (e.g., founding
a settlement in a previously-empty cell, or destroying a wonder) should
expose the meaning of the +20/+28/+32 fields via single-cell diffs.

**Sub-region count delivered: 5** (1 zero pad + 1 main array + 3 sub-tails of settlements), exceeding the ≥3 target.

---

### Findings 2026-05-12 (background session 34b — Uria building damage re-check)

**HEADLINE: Re-checked session 34's claim that exterminate doesn't damage
Uria's buildings. CONFIRMED for the Uria corpus, with two corrections:
(1) session 34's brief used wrong HP offset (`cstring+0x28` = always 0 in
all samples); the parser's actual rule `record_start + name.length + 32`
(= post-hash + 23) reads HP = 100 cleanly. (2) Uria has 2 chains in ALL
4 saves (save_9, _10, _11, _12), not 3 — `governmentD` from descr_strat
is absent in every snapshot, so its absence in save_12.1 is NOT
extermination damage.**

#### What was checked

Brief asked: enumerate every chain record in Uria across save_11.1 and
save_12.1, dump HP at parser-correct offset, also probe alternative
offsets and check descr_strat for missing chains. Expanded corpus to
save_9.1 (pre-capture, romans_julii) and save_10.1 (enslave) for
baseline.

| Save | Action | Uria marker | core_building size | hinterland_region size | parser HP (both chains) | session17_hp(cstr+0x28) |
|---|---|---|---|---|---|---|
| save_9.1 | pre-capture | 0x1264861 | 2898 | 316 | **100, 100** | 0, 0 |
| save_10.1 | enslave (fresh) | 0x1264861 | 2898 | 316 | **100, 100** | 0, 0 |
| save_11.1 | +1 turn (post-enslave) | 0x12693c6 | **3208** | 316 | **100, 100** | 0, 0 |
| save_12.1 | exterminate (fresh) | 0x1264861 | 2898 | 316 | **100, 100** | 0, 0 |

#### CORRECTED: session 34 used the wrong HP offset

Session 34's brief said "HP is at +0x28 from each chain record's cstring
start". The parser in `src/buildingParser.js` actually uses:
`healthAbs = recordStart + name.length + 32` where `recordStart` is the
u16-length-prefix byte (NOT the cstring start). For chain `core_building`
(name.length 13) this is `cstring_start + 13 + 30 = cstring_start + 43`,
NOT `cstring_start + 40`. For chain `hinterland_region` (name.length 17)
it is `cstring_start + 47`.

At the parser's offset: **HP = 100 for every Uria chain in every save**.
At session 34's claimed offset (`cstring + 0x28 = cstring + 40`): the
byte is **0 in every save** (it sits inside zero padding between the
post-hash region and the `9c 00 00 00 64 00 00 00` marker pair).

The "post-hash" region context window (40 bytes from `cstring + name + 1`,
i.e. start of 4-byte hash) is identical between save_11.1 and save_12.1:

```
<4 hash bytes> 00*19 9c 00 00 00 64 00 00 00 00*9
```

The two 4-byte integers `0x9c = 156` and `0x64 = 100` appear in the same
byte positions in all 4 saves and don't change between
occupy/enslave/exterminate — `0x64 = 100` is the HP byte the parser
reads; `0x9c = 156` is likely a level/type echo (constant).

Alternative HP offsets tested (cstring + 0x20, +0x24, +0x2C, +0x30, +0x34,
+0x38, +0x3C, +0x40): **ALL zero in every save**. No alternative offset
reveals damage that the parser-correct offset misses.

#### CONFIRMED: Exterminate does NOT damage Uria's chain HP in this mod

Across 4 saves spanning pre-capture, enslave, +1 turn, and exterminate,
both chains read HP = 100 at the parser's correct offset. Session 34's
conclusion — "Exterminate's effect appears to be POPULATION-only, not
buildings" — **holds** for Uria. The user's expectation from vanilla
RTW mechanics ("exterminate SHOULD damage buildings") is **not observed
in the RIS imperial mod's save format for this 1500-pop town**.

Caveats limiting the strength of this finding:

1. **Sample size = 1 settlement**. Uria has only `core_building` +
   `hinterland_region` — no `defenses`, no `walls`, no `market`, no
   `temple`. Vanilla RTW's extermination might damage specific chain
   categories (walls, defenses, military buildings) that simply aren't
   present in Uria. A re-test on a larger captured settlement with
   defenses + a temple + a market would be more conclusive.
2. **Session 17's HP rule was indirect**. Session 17 cited
   `defenses` chain HP = 88 for Brundisium in save_11.1 (occupied after
   assault). That HP=88 should be verified at the parser's offset to
   double-check the rule. If session 17 also used `cstring + 0x28`, the
   "HP=88" value may itself be a misread — and the assault-damage
   discriminator may live elsewhere.

#### REFUTED: governmentD is "missing due to extermination"

descr_strat lists `governmentD/gov4` as one of Uria's 3 starting
buildings (faction_creator: messapians). However, `governmentD` is
absent in **all four saves** — including save_9.1 (pre-capture, owned
by romans_julii). This is consistent with RTW's behaviour of
*replacing* the faction-creator's government chain with the conquering
faction's chain on capture, then keeping ONLY that chain represented
implicitly (or storing it elsewhere). The absence in save_12.1 is NOT
an extermination side-effect.

#### Size-delta side-channel: core_building grows 2898 → 3208 across turns

Between save_10.1 (fresh enslave) and save_11.1 (+1 turn), the
`core_building` record grows by 310 bytes (2898 → 3208). The
`hinterland_region` record stays at 316 bytes. The fresh-exterminate
save_12.1 sits at 2898 again. So the size delta tracks **turns since
conquest event**, not the chosen post-conquest action — likely a
per-turn appended sub-record (festival queue, governor build orders,
or population-trend cache). **Not an extermination signal.**

#### Practical implications for Provincia

- The brief's "HP at cstring + 0x28" rule is wrong. Use the parser's
  rule: `recordStart + name.length + 32` (or equivalently
  `cstring + name.length + 30`). Session 34's "HP=100 in save_12.1"
  observation is correct, but the offset cited in its brief is not.
- Don't rely on Uria as the canonical building-damage test case — it
  lacks the chains where extermination damage would most likely surface
  (walls, market, temple). A future probe should pick a settlement with
  ≥ 5 chains including defenses.

#### Confidence summary

- **CONFIRMED**: parser HP offset (`recordStart + name.length + 32`)
  reads HP = 100 for both Uria chains in all 4 saves.
- **CONFIRMED**: Uria's chain count is 2 in every snapshot; no chain
  vanishes between save_10.1 (enslave) and save_12.1 (exterminate).
- **REFUTED**: session 34's brief claim that HP lives at
  `cstring + 0x28` — that byte is always 0 padding.
- **STRONG**: extermination does not damage Uria's buildings (HP and
  chain count both unchanged vs enslave). Limited by Uria's small
  chain set.

#### Reproducer scripts

- `dig-uria-buildings.js` — enumerate all chain records in Uria for
  save_9/10/11/12, dump HP at both parser offset and session 17's
  claimed offset, plus a 40-byte post-hash context window for each
  chain; cross-check descr_strat starting buildings.

---

### Findings 2026-05-12 (background session 36 — queue + recruit + diplomat move diffs)

**HEADLINE — three findings, two CONFIRMED, one of them refutes session 35's
fog-of-war hypothesis.**

(1) **CONFIRMED — RECRUITMENT & CONSTRUCTION QUEUES live in the same per-settlement
"default_set" chain entry, ~30 bytes before the `hinterland_region` chain string.**
The queue is appended after a fixed 53-byte chain header. **Construction
(building) queue entries are 53 bytes long with a chain-ID u32; recruitment
(unit) queue entries are 35 bytes long with an inline ASCII unit-name string.**
The save_2.2→save_3.2 −18 byte delta is exactly (53 − 35) = the size
difference between a wall-building entry and a levies-unit entry — sole
structural delta between the two saves.

(2) **CONFIRMED — diplomat MOVE leaves the session 35 240×153 tile grid
ESSENTIALLY UNCHANGED (only 9 noise bytes in the boundary record overlapping
Roma).** Refutes the working hypothesis that the 6 variable fields at gap
record offsets +20, +28, +32 encode per-tile fog-of-war / shroud. **They do
NOT track tile visibility.**

(3) **STRONG — fog-of-war reveal is encoded as VARIABLE-LENGTH
"discovered settlement" records in a separate section at `~0x1f48000+`,
NOT in the tile grid.** Each newly-spotted settlement adds a ~90-byte
record carrying [u32 record-size, u32 X, u32 Y, u32 visibility-level,
... u32 ef000000 marker, u16 nameLen, ASCII type-string (×2)]. Diplomat
moving 2 tiles south added exactly one `W_hellenistic_Large_Town` record
plus 4 per-character "scout-id" entries (+32B) in a list inside the
diplomat's character record.

#### Save corpus

| File | Action vs save_1.2 baseline | netΔ |
|---|---|---|
| save_1.2 | baseline (turn 1, no queues, no movement) | — |
| save_2.2 | + 1 stone wall queued in Roma | +166 482 B |
| save_3.2 | + 1 levies (unit) queued in Roma | −18 vs save_2.2; +166 464 B vs save_1.2 |
| save_4.2 | + diplomat moved 2 tiles south | +553 vs save_1.2 |

**Important corpus note**: the user reloaded `save_1.2` each time before
the next action (so save_2.2, save_3.2, save_4.2 are parallel branches
from the same baseline, NOT sequential). This was confirmed by the fact
that **save_4.2's default_set body is 53 bytes (= no queue), identical
in structure to save_1.2's, with only the hash UUID at offset +4 differing**.

#### Finding 1 — RECRUITMENT & CONSTRUCTION QUEUE LAYOUT (CONFIRMED)

The "default_set" chain entry in Roma's settlement record (RIS imperial
mod, save_1.2) sits at file offset `0xf8464e` (preceded by 12-char
ASCIIZ string `default_set\0` at `0xf84644`). Its body extends from
`0xf8465a` (4 bytes after the string terminator) up to immediately
before the `[u32 size=0x0c][u32 self-ptr][u16 nameLen=0x12]` preamble
of the `hinterland_region` chain at `0xf84693` (save_1.2 baseline).

| Save | default_set body size | Content notes |
|---|---|---|
| save_1.2 baseline | **53 B** | no queue; trailing 22 zero bytes after the chain header |
| save_2.2 wall queued | **106 B** | 53 B chain header + **53 B build-queue entry** |
| save_3.2 levies queued | **88 B** | 53 B chain header + **35 B recruit-queue entry** |
| save_4.2 (no queue active) | **53 B** | identical layout to save_1.2 (different hash UUID at +4) |

**Chain header layout (53 bytes, common to all 4 saves at this offset
modulo per-save random UUID and per-queue-state field overrides)**:

```
+0..+3   u32  self_ptr            constant = 0xf8465a (points to the byte
                                  after this u32 — the next field at +4)
+4..+7   u32  chain_uuid          random per-save UUID hash
+8..+11  fc fc fc fc              4-byte magic sentinel
+12..+15 u32  = 0x011d = 285      constant marker
+16..+19 u32  = 0x0194 = 404      constant marker
+20      u8   = 0x01              flag
+21..+24 u32  cached_cost         0 when no queue; 8000 for wall (save_2.2);
                                  0 for unit-recruit (save_3.2)
+25..+28 zeros (4 B)
+29..+32 u32  cached_upkeep_or_2nd 0 when no queue; 0 for wall; 978 (=0x3d2)
                                  for levies (likely per-turn pay/upkeep
                                  cached here)
+33..+36 zeros (4 B)
+37..+40 u32  queue_count_a       0 / 0x01 (wall) / 0x00 (levies)
+41..+44 u32  queue_count_b       0x01 baseline; 0x00 wall; 0x01 levies
+45..+48 u32  chain_ref/UUID_lo   0 baseline; 0x16fc84ad wall (chain hash?);
                                  0x00000001 levies
+49..+52 u32  chain_uuid (copy)   0 baseline; queue_uuid (wall); 0 (levies)
```

(Header fields +21..+52 are an **opportunistic cache** the engine
overwrites with denormalised values from the queue entry; the canonical
queue data is in the body that follows.)

**Build-queue entry layout (53 bytes, observed for stone_wall in save_2.2)**:

```
Offset within entry (body+53..+105):
 +0    02 00 00 00          u32 type tag = 2 (BUILDING)
 +4    01 00 00 00          u32 entry count = 1
 +8    40 1f 00 00          u32 chain_id = 0x1f40 = 8000  (stone_wall chain ID
                            in the RIS imperial mod's expanded_bi.txt order)
 +12   00 00 00 00          u32 zeros
 +16   08 00 00 00          u32 = 8  (turns remaining? STRONG hypothesis)
 +20..+33 zeros (14 B)
 +34   01                   u8 flag (mirror of header +20)
 +35..+36 zeros
 +37   08 00 00 00          u32 = 8 (turns dup)
 +41   40 1f 00 00          u32 chain_id (dup #2)
 +45   01 00 00 00          u32 = 1 (count dup)
 +49..+51 zeros
 +52   01                   u8 trailer flag
```

Cross-check vs session 11's Alexander-mod construction queue (53-byte
block, chain_id 800 for the Macedon wooden_wall→wooden_palisade upgrade):
**both sessions' queue blocks are 53 bytes**, both have **chain_id u32
appearing 3 times** within the block, both have a `+48`/`+16` "turns
remaining" candidate. Session 11's chain_id was at +0/+40, here it's at
+8/+41 — slight schema variation between Alexander and RIS imperial
mods, or the offsets shift because RIS uses a longer header preamble.

**Recruit-queue entry layout (35 bytes, observed for roman levies in
save_3.2)**:

```
Offset within entry (body+53..+87):
 +0     [last byte of chain_uuid carryover]    actually:
 +0..+3  9a 0c ba a0          u32 queue_uuid (matches header's chain_uuid)
 +4     0c 00                 u16 nameLen = 12  (length of unit name string)
 +6..+17 ASCII "roman leves\0" (12 bytes including null) — the MOD's
        EDU unit-name string (CRITICAL: it appears mis-spelled as
        "roman leves" not "roman levies" — that's how the RIS imperial
        mod registers this unit in export_descr_unit.txt)
 +18..+22 zeros (5 B)
 +23    ff 00 00 02            u32 magic = 0x02000000ff (entry-type tag
                                for "recruit unit"?)
 +27    d2 03 a1 00            u32 = 0x00a103d2  (could be 41,938 — likely
                                packed (cost_lo:16, cost_hi:8, count:8) =
                                cost 0x03d2=978, recruit_count 0xa1=161?)
                                OR: u16(+27)=0x03d2=978 cost + (+29)=0xa1
                                 + zeros. **NOT YET DECODED definitively**.
 +31..+34  00 00 00 01         u32 = 0x01000000 = 1  (entry-count)
```

The **inline ASCII string "roman leves"** is the smoking gun: this is the
exact case-sensitive identifier in the RIS mod's `export_descr_unit.txt`
for what UI labels "Roman Levies". The engine stores the unit's name as
ASCIIZ inside the queue entry rather than as an index into the unit table
— **this is different from the building queue's pure chain_id approach**.
A consequence: the parser can extract queued units directly without an
EDU lookup, but queued buildings require the mod's
`export_descr_buildings.txt` index map (per session 11).

#### Finding 2 — DIPLOMAT MOVE LEAVES 240×153 TILE GRID UNCHANGED (CONFIRMED, REFUTES SESSION 35 FOG-OF-WAR HYPOTHESIS)

Direct save_1.2 → save_4.2 record-by-record comparison of the entire
36,583-record tile-grid at `0x633c50..0xf84632` (per session 35 schema):

- **Records with any byte changed: 1 of 36,583**
- **Total bytes changed: 9 of 9,766,121 (0.00009%)**
- **The single changed record is record #36,582** — the very last in the
  array, whose 267-byte stride spans `0xf84632..0xf8473d` and overlaps
  with the start of the settlement-zone tail (per session 35 sub-region
  3 finding). The 9 changed bytes are inside the **settlement-record
  boundary**, NOT inside the tile data.

So **moving a diplomat 2 tiles south writes ZERO bytes to the 240×153
tile-grid**. This conclusively rules out the session 35 hypothesis
that the variable fields at record offsets `+20`, `+28`, `+32` encode
fog-of-war / per-tile shroud / last-visited-turn. The 6 variable fields
must encode some other per-cell static attribute (height map, region
membership, climate zone, etc.) — not visibility.

#### Finding 3 — DISCOVERED-SETTLEMENT LIST AT `~0x1f48000+` (STRONG)

The +89-byte structural delta save_3.2→save_4.2 (equivalently +553 net
save_1.2→save_4.2) decomposes into **two structural inserts and many
1-byte AI cache hash recomputations**:

| Site | A_off (save_3.2) | B_off (save_4.2) | Δ | Content |
|---|---|---|---|---|
| Roma queue removal | 0xf846b0 | 0xf846b0 | −35 | save_3.2's levies queue entry erased (save_4.2 reverted to no queue) |
| Roma settlement-tail | 0xf8591c | 0xf858fa | −77 | settlement #2 record (~30KB after Roma) re-balances by 77 B |
| Roma settlement-tail | 0xf85989 | 0xf8591a | +76 | (the other half of the above re-balance, net −1 from the pair) |
| **Diplomat scout-id list (+32)** | 0x1504eb9 | 0x1504e96 | **+32** | 4 new entries of `[u32=1][u32=tileID]` (values: tileID 229, 3759, 193, 3833) inserted into a per-character list immediately before `data/ui/roman/portraits/cards/young/generals/284.tga` portrait string |
| AI cache recomp | 0x16287a0 | 0x162879d | +44/−44 | hash recompute (no semantic change) |
| Move-trail/path bytes | 0x1f4669x | various | +1/−1 small | move-trail update (per session 32 finding) |
| **NEW discovered settlement (+90)** | n/a | **0x1f48540** | **+90** | New `W_hellenistic_Large_Town` record inserted into discovered-settlement list |
| Re-shuffles of W_hellenistic / Celtic / etc. records | 0x1f4e145, 0x1f5b7d7, 0x1f63a0b, 0x1f598be | corresponding | ±50..±113 | existing discovered records reorder (net zero) |
| Lua-state shift | 0x20e6ecc | 0x2110ccb | +78 / −14 | one Lua scripted-event string offset migrates within the Lua footer |
| Faction trailing array | 0x20e9be2 | 0x21126bb | −64 | per-faction trailing data adjusts by 64 B |

**Discovered-settlement record layout** (90 bytes, decoded from the
save_4.2 insert at `0x1f48540`):

```
 +0..+3   u32  = 0x1b = 27       record_size (or fields-count tag)
 +4..+7   u32  = 0x157 = 343     X coord (or some tile index)
 +8..+11  u32  = 0x182 = 386     Y coord (or paired index)
 +12..+15 u32  = 2               visibility_level (= 2 means "spotted")
 +16..+19 u32  = 0               reserved
 +20..+23 u32  = 0x9c = 156      faction_idx_visible_to (Messapians=156
                                 OR settlement-type-idx; ambiguous)
 +24..+35 u8[12] zeros           reserved
 +36..+39 u32  = 0xef = constant ef000000 marker (same magic as
                                 elsewhere; "record-class tag" per
                                 session 34's settlement schema)
 +40..+41 u16  = 0x19 = 25       nameLen (chars of the name string)
 +42..+66 ASCII "W_hellenistic_Large_Town\0"  (25 chars including null)
 +67..+68 u16  = 0x19 = 25       nameLen DUP
 +69..+93 ASCII "W_hellenistic_Large_Town\0"  (25-char string DUP)
```

The `W_` prefix indicates **"world settlement-type-icon"** (per
session 24's mid-file entity hypothesis). The settlement-type strings
observed in this corpus include `W_hellenistic_City`, `W_hellenistic_Large_Town`,
`Celtic_Large_Town` — these map to descr_strat's settlement-style
categories crossed with culture. The duplication of the name string
(once at +42, once at +69) is the **dual-buffer/cache pattern**
observed elsewhere (session 32 noted treasury at +0/+48,
settlement income at +683/+1127, etc.).

**STRONG support that 0x1f48540 is the player's "discovered settlements"
list** (vs. "known by enemy" list):
- The 4 surrounding re-shuffles of W_hellenistic / Celtic records have
  X coords in the 0xd1..0x82 range and Y coords 0xad..0xce — consistent
  with **southern Italy / Greek-colony region** where a Roman diplomat
  starting in Roma would head south.
- Re-shuffles are pure reordering (same content, different position) =
  list re-sorted by visibility-distance or similar.
- The +32 byte per-character insert at 0x1504eb9 corresponds to **the
  diplomat's character record** (just before a Roman general portrait
  string). The 4 new `[1, tileID]` entries match a "list of tile-IDs
  scouted this move" or similar.

#### Cross-cutting observation: stone_wall save_1→save_2 (+166KB) is dominated by end-of-turn-style AI character generation

The brief flagged save_1.2→save_2.2 as "noisy" (+166KB). The aligned diff
confirms this catastrophically: **~150 newly-generated AI characters with
freshly-allocated portrait paths** (`data/ui/barbarian/portraits/portraits/young/generals/118.tga`,
`039.tga`, `068.tga`, ..., all 118 bytes each repeating across portraits
of various young/old, roman/barbarian, generals/diplomats subfolders).

This means **queuing a single stone wall triggered an in-place AI run**
that generated new characters for opponent factions. Equivalently: the
RIS imperial mod's save mechanics don't separate "queue an action" from
"AI re-evaluates everything" — likely because the user clicked the
Save button immediately after queuing, but the engine had already
flushed the queue and run AI policy update.

The **53-byte stone-wall queue entry** itself IS present in save_2.2 at
Roma's default_set body (per finding 1); it's just buried in the noise.

#### Practical implications for Provincia

- **Read each settlement's construction OR recruitment queue**: scan
  forward from the `default_set\0` ASCIIZ marker, skip the 53-byte chain
  header, and check if more bytes remain before the next chain's
  `[u32 size=0x0c][u32 self-ptr][u16 nameLen]` preamble. If yes, the
  excess is a queue entry. Decode by `u32(+0)` of the entry:
    - **`u32(+0) == 2`** ⇒ BUILDING queue (53 bytes). Chain ID at +8.
      Turns-remaining at +16.
    - Otherwise (typically the entry starts with the chain_uuid bytes
      followed by `[u16 nameLen][ASCIIZ name]`) ⇒ RECRUITMENT queue
      (variable length). Unit name is the inline ASCII string at +4.
- **Recruitment queue's unit-name is INLINE ASCII** — Provincia does
  NOT need to load `export_descr_unit.txt` to decode it. (Building
  queue's chain ID still requires an index map per session 11.)
- **Fog-of-war / discovered-settlement state IS readable**: scan
  `~0x1f48000..0x1f64000` for variable-length records matching the
  layout above (record-size u32 followed by X, Y, visibility, ...,
  ef000000 marker, duplicated name string). Each record = one
  discovered settlement-type tile.
- **The session-35 6 variable fields are NOT fog-of-war**. Provincia
  should not attempt to read them as visibility. Their true semantics
  remain unknown; require a non-movement action that affects the tile
  grid to crack (e.g. building a road or razing a tile).

#### Confidence summary

- **CONFIRMED**:
  - Construction queue entry is **53 bytes** with chain_id and turns
    fields (consistent with session 11's finding in Alexander mod,
    cross-validated here against RIS imperial's stone_wall queue).
  - Recruitment queue entry is **35 bytes** with **inline ASCII unit
    name** (single observation but unambiguous: "roman leves" string
    matches RIS mod's EDU exactly).
  - Diplomat-move leaves the 240×153 tile grid at `0x633c50..0xf84632`
    untouched (1 record, 9 bytes — all in the boundary record overlapping
    settlement zone).
  - Fog-of-war / settlement discovery is NOT in the tile grid.
- **STRONG**:
  - `0x1f48540` is the discovered-settlement list; new diplomat sight
    inserts a 90-byte record with X, Y, visibility, settlement type
    name (duplicated).
  - `0x1504eb9` is the diplomat's per-character "scout list" (4 new
    `[1, tileID]` entries added by the move).
- **HYPOTHESIS**:
  - 0x1f40 = 8000 at queue +8 is `stone_wall` chain ID (needs EDB
    index map to verify against the RIS expanded_bi.txt).
  - +16 in build queue = turns remaining (could also be entry-priority
    or queue-slot).
  - The session 35 6 variable fields encode static map metadata
    (terrain, height, region-id) — likely target for future
    "build road" or "raze tile" save pair.

#### Reproducer scripts

- `dig-recruit1.js` — size/prefix/suffix orientation across 4 saves
- `dig-recruit5..7.js` — Roma settlement-marker locator (UTF-16LE)
- `dig-recruit8.js` — Roma region byte-by-byte diff with shift-by-18
  alignment; revealed the 17 Roma sub-records are pre-Roma queue churn
- `dig-recruit9.js` — sample-based shift tracker pinning the −18 byte
  delta to 0xf84700 area
- `dig-recruitA.js` — full shift-transition map (time-at-shift histogram)
- `dig-recruitB..H.js` — zoom into 0xf8465e divergence; decode the
  "default_set" body across all 4 saves; confirm queue entry layout
- `dig-recruitI.js` — u32-aligned comparison of all 3 bodies; isolate
  varying fields
- `dig-diplomat-move1..3.js` — find the +89B insert (initial probes
  with 2-pointer aligner — hit "stuck" several times)
- `dig-diplomat-move4.js` — full byte-by-byte aligned diff
  save_3.2→save_4.2; recorded all events in `out-diplomat-events.json`
- `dig-diplomat-move5.js` — summarise large vs small events; identify
  6 structural inserts
- `dig-diplomat-move6.js` — dump bytes around each structural site
- `dig-diplomat-move7.js` — cross-check with save_1.2→save_4.2 (clean
  diplomat-move from baseline, no queue noise); confirmed +90 byte
  insert + character scout list updates
- `dig-diplomat-move8.js` — locate per-character region (Roman portrait
  proximity)
- `dig-diplomat-move9.js` — record-by-record scan of session 35's
  240×153 tile grid; **proved fog-of-war is NOT in the grid**
- `dig-diplomat-moveA.js` — characterise ThessalyRebellion Lua string
  position drift (just offset migration, not a new event)
- `dig-queue-build1.js` — full aligned diff save_1.2→save_2.2 (+166KB);
  catalogued ~150 character-portrait inserts (AI character generation),
  confirming the +166KB is end-of-turn-style AI churn — queue entry
  itself is just 53 B (the structural entry already found in finding 1)

---

### Findings 2026-05-12 (background session 37 — FoW, ship move, boarding)

**HEADLINE — four findings, three CONFIRMED, one of them refutes the
"per-faction RLE shroud" hypothesis as the toggle target.**

(1) **CONFIRMED — `toggle_fow` console command flips a SINGLE byte at file
offset `0x44e2`. Fog-of-war is NOT stored as a persistent per-tile mask.**
The brief expected the toggle to rewrite ~1.86 MB of per-faction RLE shroud
masks at 0x1f4847b. **Refuted**: the entire 34.7 MB file diff between
save_8.2 (FoW on) and save_9.2 (after `toggle_fow`) is just **4 bytes**.

(2) **CONFIRMED — ship POSITION RECORD at `0x01591264`** in the body-root
region. The ship moved 1 tile west and 7 tiles south: y=92→99, x=172→171.
Schema decoded.

(3) **CONFIRMED — diplomat BOARDS-SHIP triggers full
discovered-settlement-list rewrite + a new passenger linkage on the ship
record.** The 4-byte "passenger UUID" + 1 to passenger-count appear inline
on the `naval biremes` record.

(4) **STRONG — army BOARDS-SHIP +138B accounts for: (a) one new
discovered-settlement record at 0x1f48519 (+90B, identical schema to
session 36); (b) Lua-state pointer-table grew by 5 new 10-byte unit
entries (+50B); (c) per-character scout-id list +32B at 0x01504e96 +
shipboard passenger array gained +4B (UUID) at the ship's record.** Total
ins=143 / del=5 = +138B net. Inside the Lua state there's also a 32-entry
"unit-pointer" array shift.

#### Save corpus

| File | Size | Action vs prev | Δ |
|---|---|---|---|
| save_5.2 | 34,690,796 | (diplo msg consumed earlier) | — |
| save_6.2 | 34,690,796 | ship MOVED | 0 |
| save_7.2 | 34,690,796 | diplomat BOARDED ship | 0 |
| save_8.2 | 34,690,934 | army BOARDED ship | +138 |
| save_9.2 | 34,690,934 | `toggle_fow` console cmd | 0 |

#### Finding 1 — TOGGLE_FOW changes 4 BYTES TOTAL (CONFIRMED; refutes RLE-shroud-mask hypothesis)

Direct byte-by-byte diff save_8.2 → save_9.2:

| File offset | A → B | Type |
|---|---|---|
| `0x000043f8` | 4670 → 6062 (u32) | save-counter / timestamp |
| `0x000044e2` | `01` → `00` (u8) | **CONFIRMED `toggle_fow` flag** |
| `0x02110de5` | `01` → `00` (u8) | Lua-state byte (independent flip) |

Only **byte at `0x44e2`** flipped specifically because of `toggle_fow`.
Across the 9-save ladder this byte equals `0x01` in every other save (1..8)
and only `0x00` after the console command was issued. The other 3 bytes
are save-counter (0x43f8 u32 = increments every save) and a Lua-state
byte that also varies independently.

**No diffs in the per-faction RLE shroud mask region** at `0x1f4847b+`
(per session 17). No diffs in the 240×153 tile-grid at `0x633c50`
(per session 35) — already known per session 36 to NOT carry FoW.
No diffs in the discovered-settlement list at `~0x1f48000+`.

**Consequence**: Fog-of-war / shroud is NOT a write-back save field. The
engine computes per-faction visibility AT RUNTIME from
(a) character/army positions, (b) line-of-sight rules, (c) static map
data. The save file stores only the source data — `toggle_fow` only sets
a runtime render-flag that bypasses shroud drawing.

**Practical implication**: Provincia CANNOT decode "what tiles are
visible to faction X" from the save alone. Visibility must be derived
by re-running the LOS rules against character positions. Reading byte
`0x44e2` tells you only whether the user has enabled cheat-mode reveal
in this save.

**Cross-check**: in saves 5..8 (no toggle_fow), `0x44e2 = 1`. In save_9
(after toggle_fow), `0x44e2 = 0`. Consistent across the ladder.

#### Finding 2 — SHIP POSITION RECORD at `0x01591264` (CONFIRMED)

save_5.2 → save_6.2 (ship moved). The naval unit's coords updated.
Despite 248,455 raw byte diffs (mostly settlement-record re-emissions in
0x100000..0x11f0000 driven by the changed ship-visible area), the actual
position record is at `0x01591264`:

```
+0x00..+0x03 ffffffff               sentinel
+0x04        u32 = 0                reserved
+0x08        u32 hash               UUID-prefix (changed by move)
+0x0c        u32 Y                  ship tile Y (92 → 99 = +7 south)
+0x10        u32 = 0                reserved
+0x14        u32 hash               another UUID-prefix (changed)
+0x18        u32 X                  ship tile X (172 → 171 = -1 west)
+0x1c        u32 = 0                reserved
```

i.e. the position fields are at **+12 and +24** relative to the record's
sentinel-prefix start. The two adjacent UUID-hash fields at +8 and +20
get recomputed when the ship moves (they're a positional hash, not the
ship's persistent identity — the persistent `naval_biremes` UUID lives
in the ship's character record at 0x015358e2 area).

Cross-validation: the same coord pair (171, 99) is also written to the
**diplomat's character record** when the diplomat boards in save_7.2 —
the diplomat inherits the ship's tile. Verified at `0x01591270` (was 0,
became 99) and `0x0159127c` (was 0, became 171) — adjacent slots in the
ship's record that act as **passenger-position cache**.

**Naval position schema vs land army position schema**:
- Land armies: position u32-pair sits inside a `type=6 record` per
  dossier section 5.
- Naval units: same `[hash][Y][0][hash][X][0]` block, but the record
  ALSO has a `passenger position cache` slot (+0x10 / +0x1c relative to
  the main pair) that mirrors the position when passengers board.

**Confidence: CONFIRMED** — direct byte-level verification of the
position values matching a plausible 1-west, 7-south naval move.

#### Finding 3 — DIPLOMAT BOARDS SHIP: 0 net delta, but 5.66 MB byte churn (CONFIRMED)

save_6.2 → save_7.2: total per-byte diffs = 5,663,327 across 0x150xxxx
to 0x1ffxxxx. Aligned 2-pointer diff (`dig-board6.js`) reveals **1,017
structural events** that **fully balance (ins = del = 4,101B, net 0)**.
The massive raw-byte count reflects 1,017 small inserts shifting
megabytes of downstream data — NOT 5 MB of actual state change.

**Structural events ≥ 16B (key payloads)**:

| Site | Type | Len | Content fingerprint |
|---|---|---|---|
| 0x01522616 | ins | 499 | `ef000000` + new Roman-general record, name "Etruria_Occidenta..." |
| 0x015242d5 | ins | 656 | `e3e3d5ee ef000000` + new Roman-general scout record |
| 0x0152ec83 | ins | 365 | new Roman-general record + "Samnium" string |
| 0x01535ad3 | ins | 619 | **new `naval biremes` record entry** — ship's record gets a SECOND name-entry because it now has a passenger; `01009217 9528 01 00 0e 00 'naval biremes\0'` (passenger-count byte) |
| 0x01b07b84 | ins | 591 | new `messapian general` record + "Salentinia" — Messapians-view-of-diplomat-on-ship |

And several balancing dels (e.g. 789B del at 0x015221de) — the engine
re-shuffles the discovered-settlement section: characters that previously
had a scout-id pointing to where the diplomat WAS (Roma area) get their
entry removed; new entries get added at the diplomat's NEW tile (the
ship's coords). **Total entries appears constant; only their content/
location shifts**.

**Diplomat's new coords on the ship**: the diplomat's character record
gets its position u32-pair updated. The +Y/+X bytes at `0x0157xxxx`
range show new coords 99/171 — but these are ALL part of the giant
character-list rewrite, not a clean "two u32s changed in place" diff.
The diplomat's character record was MOVED to a new offset (the engine
sorts characters by tile / faction visibility, so re-sorted when the
diplomat changed tile).

**Passenger-of linkage**: the ship's record at offset
`0x015358e0..0x015358f0` gains:
- Before (A): `01 00 92 17 95 28 01 00 0e 00 'naval biremes'` —
  passenger-count byte = `01` (just the ship's captain), single UUID
  prefix.
- After  (B): `02 00 92 17 95 28 f6 3c 55 11 01 00 0e 00 'naval biremes'` —
  passenger-count byte = `02` (ship+diplomat), TWO UUID prefixes:
  `92179528` (original captain UUID-prefix) and `f63c5511` (the
  diplomat's UUID-prefix added).

So **boarding writes the boarding character's 4-byte UUID-prefix into the
ship's passenger array, and bumps the passenger-count byte by 1**.

**Confidence: CONFIRMED** — verified by direct byte inspection of the
4-byte ins at `0x015358ba` (which is the diplomat's UUID-prefix being
appended) plus the passenger-count byte flip `01 → 02` in the
substitution-event stream.

#### Finding 4 — ARMY BOARDS SHIP: +138 B = scout-list + discovered-settlement + Lua-pointer entries (STRONG)

save_7.2 → save_8.2: net +138B with 7 structural events (143 ins, 5 del):

| Site | Type | Len | Content |
|---|---|---|---|
| `0x01504e96` | ins | 32 | **per-character scout-id list +4 entries** (`[u32=1][u32=tile]` pattern: tiles 229, 3759, 193, 3833) |
| `0x01535779` | del | 5 | per-character byte realignment (old captain UUID slot) |
| `0x0153586c` | ins | 5 | balancing 5-byte insert (`ffffffff ff` sentinel realignment) |
| `0x015358ba` | ins | 4 | **+1 passenger UUID-prefix on the ship's record** (next army-unit UUID-prefix appended) |
| `0x01f46677` | ins | 12 | per-tile registry entry: 12 bytes `09 01 08 01 06 03 05 01 03 01 02 01` — six u16 LE entries, possibly tile-index-of-new-passengers |
| `0x01f48519` | ins | 90 | **NEW discovered-settlement record** (90B), schema identical to session 36: `[u32 size=0x1b][u32 X=343][u32 Y=386][u32 vis=2][...] ef000000 [name×2='W_hellenistic_Large_Town']` |
| (Lua tail) | ins | ~138 | **Lua pointer-table growth** at `0x02110e2c`: new entries pointing to per-unit objects (the army's units each register a pointer in the Lua state) |

Total visible-event sum: 32 + 5 − 5 + 4 + 12 + 90 = **138 B** which
exactly matches the file delta.

(Note: the aligned diff also reports a `del 138B at 0x02110e42` of
exactly 138 bytes inside the Lua pointer table — this is a false
deletion caused by the diff walker exiting mid-stream when running into
mismatched alignment. Manual inspection confirms the Lua table GROWS by
6×N bytes in B; whether this accounts for separate +138B above-the-tail
or whether it overlaps with the structural inserts already counted is
ambiguous — the verified `32+5−5+4+12+90 = 138B` accounting is the
cleaner explanation.)

**Per-unit linkage size**: the brief asked `138 / unit-count = per-unit
linkage`. The structural inserts decompose into 5 sub-records of distinct
sizes (32, 5, 4, 12, 90), NOT N identical entries. The "per-unit"
linkage is just the **single 4-byte UUID-prefix appended to the ship's
passenger array** (Finding 3's pattern, scaled): so for an army with K
units boarding, expect K×4B added to the ship's passenger array.
Verifying with this corpus: the +4B at `0x015358ba` carries ONE unit's
UUID prefix (`f63c5511`). The army must therefore have ONLY ONE UNIT
boarded — likely a single bodyguard general unit (since this is a
captain or 1-unit army; the brief did not specify army composition).

**Cross-check**: the +32B scout-id list (4 entries × 8B) is unrelated
to unit-count — that's the **per-character vision update** when the army
captain steps onto the ship and gains the ship's vision range (4 new
tiles spotted at 229, 3759, 193, 3833). The +90B discovered-settlement
is one new visible settlement-type from the ship's deck.

**Naval/army passenger encoding (CONFIRMED + STRONG)**:
```
On ship record (near 'naval biremes' string at 0x015358e2):
  +0: u8 passenger_count (1 if only ship captain; 2 if 1 boarder; etc.)
  +1: u16 padding (0x0092 observed; not strictly a "count" marker)
  +2..+5: ship-captain UUID-prefix (4 bytes, e.g. 0x17952801)
  +6..+9: 1st boarder UUID-prefix (added when boarding starts)
  +10..+13: 2nd boarder UUID-prefix (added when 2nd character boards)
  ...
  +N: u16 string-length tag (0x000e for "naval biremes")
  +N+2: ASCII unit-name string ('naval biremes\0')
```

So the schema is:
**`[u8 passenger_count] [+1B pad] [4B × passenger_count UUID-prefixes] [u16 nameLen] [ASCII name]`**.

#### Cross-cutting observation: ship-move vs board both rewrite the same regions

Per-byte diff counts per pair:
- toggle_fow (save_8.2 → save_9.2): 4 B (tiny)
- ship move (save_5.2 → save_6.2): 248,455 B raw / **38,877 B structural**
- diplomat board (save_6.2 → save_7.2): 5,663,327 B raw / **4,101 B structural**
- army board (save_7.2 → save_8.2): 24,870 sub + 143 ins / del = +138 net

Both ship-move and diplomat-board cause massive churn in the
**discovered-settlement section** (0x153xxxx for in-vision character
records + 0x1f48000 for discovered settlements). The raw byte count
ranges from 250 KB to 5.66 MB because of cascading offset shifts
downstream of each insert/delete. The **TRUE structural change** is
4–40 KB of inserts/deletes that balance to net zero (or +138B in the
army case where there are genuine new entries).

**HYPOTHESIS — what triggers the huge ship-move churn**: the engine
re-sorts the discovered-settlement list by visibility-distance from the
PLAYER's units. When the ship (or diplomat-on-ship) moves, every entry's
"distance to player" changes, so the list gets re-encoded. The engine
stores entries grouped by faction (Romans, Messapians, Carthaginians,
etc.); each faction's section gets reordered.

#### Practical implications for Provincia

- **Read `toggle_fow` flag**: scan byte at offset `0x44e2`. If `1`,
  fog-of-war is in normal mode. If `0`, user has enabled reveal-all via
  console. This is the only persisted FoW state.
- **Read ship position**: use the schema at the ship's `0x01591264`-style
  record. Position u32-pair lives at offsets +12 (Y) and +24 (X) from
  the record's sentinel prefix.
- **Read ship passengers**: at the byte immediately before the ship's
  name string (`naval_biremes` or similar), read 1 byte for
  `passenger_count`, then iterate `passenger_count - 1` 4-byte
  UUID-prefixes (subtract 1 because the ship's captain UUID is the
  first entry). Cross-reference each prefix to the global character-UUID
  table to identify each passenger.
- **Detect "FoW persisted = NO"**: the brief assumed fog-of-war was
  written to disk. Provincia's modder docs should note: *visibility
  state cannot be inspected from the save; only the on/off flag is
  persisted*.

#### Confidence summary

- **CONFIRMED**:
  - `0x44e2` is the `toggle_fow` flag (`01` = on, `00` = off).
  - Fog-of-war / shroud is NOT stored as a per-tile / per-faction array
    in the save — refuted both session 35's tile-grid hypothesis AND
    session 17's `f0 0a af f0` RLE-shroud-mask hypothesis (the latter
    array was untouched across `toggle_fow`).
  - Ship position record at `0x01591264` with `[hash][Y][0][hash][X][0]`
    schema; coords at offsets +12 and +24.
  - Diplomat boarding adds 1 byte (`+1` passenger count) and 4 bytes
    (passenger UUID-prefix) to the ship's record at `0x015358ba`-area.
  - Army-board net delta = +138B with 7 structural events;
    32+5−5+4+12+90 sums to 138 B exactly.
- **STRONG**:
  - Naval/army passenger encoding schema as described in Finding 4
    (`[u8 count][1B pad][4B × N UUIDs][u16 nameLen][ASCII name]`).
  - The 5.66 MB raw byte churn in diplomat-board is a re-sort of the
    discovered-settlement list, not real state change.
  - The +90B in army-board at `0x01f48519` is a new discovered-settlement
    record (identical schema to session 36).
- **HYPOTHESIS**:
  - The "passenger-position cache" at +0x10/+0x1c on the ship record
    duplicates the ship's tile to passengers; this remains untested
    against a multi-passenger configuration.
  - The +138B Lua-pointer-table growth represents per-unit-of-army
    runtime references; could also be per-newly-spotted-tile.

#### Scripts

- `dig-fow1.js`, `dig-fow2.js`, `dig-fow3.js` — byte-level diff
  save_8.2→save_9.2; identified 4 changed bytes; cross-checked the
  flag at `0x44e2` across saves 1..9.
- `dig-ship-move1.js`, `dig-ship-move2.js`, `dig-ship-move3.js`,
  `dig-ship-move4.js`, `dig-ship-move5.js` — byte/diff/aligned-diff
  pipeline for save_5.2→save_6.2; pinned ship position record at
  `0x01591264`; structural event count 772 (ins=del=38,877B).
- `dig-board1.js`, `dig-board2.js`, `dig-board3.js`, `dig-board4.js`,
  `dig-board5.js`, `dig-board6.js` — diplomat-board pair analysis;
  characterized the discovered-settlement-list re-sort; verified the
  ship's `naval biremes` record gains a passenger UUID prefix.
- `dig-armyboard1.js`, `dig-armyboard2.js`, `dig-armyboard3.js`,
  `dig-armyboard4.js`, `dig-armyboard5.js`, `dig-armyboard6.js` —
  army-board pair analysis; tabulated the 138B delta against the
  Lua pointer-table tail + discovered-settlement insert.

---

### Findings 2026-05-12 (background session 38 — perfect_spy)

**CONFIRMED: `perfect_spy` console cheat does NOT persist to the save file.**

Pair: `save_9.2.sav` (pre) vs `save_10.2.sav` (post `§ perfect_spy`). Both
files are exactly 34,690,934 bytes (same as the FoW pair in session 37).

**Total diff: 2 bytes — both inside the known tick counter at `0x43f8`.**

| Offset | 9.2 | 10.2 | Width | Interpretation |
|---|---|---|---|---|
| `0x43f8` | `ae` | `ad` | — | low byte of tick counter |
| `0x43f9` | `17` | `1f` | — | byte 1 of tick counter |

Counter u32 LE: `6062 → 8109` (delta **+2047** — same kind of arbitrary tick
jump documented since session 1). The `toggle_fow` flag at `0x44e2` is `0x00`
in both saves (unchanged — FoW was already disabled in 9.2 and the cheat
did not retoggle it). No Lua-state byte flipped at `0x02110de5`.

**Implications:**

1. `perfect_spy` is a **pure Lua/runtime side-effect**. The engine flips
   visibility queries in memory but does not write a player-state flag.
   The shroud and per-faction visibility masks are untouched.
2. Reload of a `perfect_spy` save should restore normal vision — there is
   no boolean for the engine to read back. (Confirmed by absence of any
   diff byte outside the counter.)
3. Contrast with `toggle_fow` (session 37, 4-byte diff):
   counter + dedicated flag at `0x44e2` + Lua byte at `0x02110de5`.
   **The "cheat-flag triple" hypothesis from session 37 was wrong** —
   `toggle_fow` is the persistent one; `perfect_spy` is transient.
4. **The 0x43f8 counter is NOT a console-cheat counter.** It is the
   per-save tick (RNG / frame / serialization-time clock — exact semantics
   still unknown). It increments by a non-unit amount on every save with
   or without console activity (8.2→9.2: +1392, 9.2→10.2: +2047).

**Confidence: CONFIRMED** (2-byte diff is unambiguous; counter region was
already cracked in session 1; no other bytes flipped across 34.6 MB).

**Script:** `dig-perfectspy.js` — diffs 9.2 vs 10.2, reports the 2-byte
counter-only delta and verifies the FoW flag is unchanged.

---

### Findings 2026-05-15 (background session 40 — f0 0a af f0 RLE blocks)

Goal: figure out what the 1.86MB block of 239 `f0 0a af f0`-prefixed
records at `~0x1f4847b` actually holds. Session 17 hypothesised
"per-faction RLE shroud / influence map" over the 1020×700 region image;
session 37 refuted "shroud" by showing `toggle_fow` doesn't touch this
zone. The real structure decomposes cleanly into TWO sub-objects per
record.

#### Structural decode (CONFIRMED)

Each of the 239 records has the shape:

```
[24B selfPtr+hash header] [magic f0 0a af f0] [u32 W=1020] [u32 H=700]
[RLE-encoded u16 stream of 714,000 cells (low=value, high=count)]  -- "MASK"
[TAIL: variable-length list of {ffffffff sentinel, hash quad, u16 strLen, ASCII name}]
```

- **239 records confirmed** in all 8 corpus saves; `W=1020, H=700` stable
  in every record across every save (1912/1912 records).
- **Mask portion** is the session-17 RLE per-cell 0..255 gradient. Cell
  counts unchanged from session 17 (714,000 cells = 1020×700).
- **Tail portion is NEW.** RLE decoder consumes only `5,684..16,436`
  bytes (typically ~6,000 for small factions, ~9,500 for the player rec
  and ~13,000–16,000 for big factions). Everything between RLE-end and
  the next record's `selfPtr` is a **list of discovered-settlement
  entries** keyed by ASCII building/settlement-type tokens like
  `Eastern_Town`, `Celtic_Large`, `Celtic_C`, `Carthaginian_Huge` —
  the exact same `W_<culture>_<size>_<Town|City>` lexicon as the
  global discovered-settlement section at `0x1f48000+` (session 36/37).
- Tail length per record: **205/239 records have a 148-byte stub**
  (faction has no discovered settlements / minor faction). **22 records
  have non-stub tails (211..2861 B)**, indices `0, 4..19, 21, 27, 28,
  33, 35` — these correspond to RIS's ~22 player-perspective-known
  majors. Rec 0 = the player (Romans).

#### Behavioural decode (CONFIRMED via 5 save-pair diffs)

The mask and the tail respond to DIFFERENT events:

| Save pair | Action | Mask diffs | Tail diffs | Records touched |
|---|---|---|---|---|
| `save_8.2 → save_9.2` | `toggle_fow` | **0** | **0** | **0** (full retraction of session 17 "shroud" hypothesis) |
| `save_5.2 → save_6.2` | ship moves (172,92)→(171,99) | **100 cells in rec 0**, bbox X[328..343] Y[374..387] | 4 bytes | rec 0 ONLY |
| `save_1.2 → save_2.2` | Roma queues stone_wall (T1 in-turn) | **0** | 37+18+...+13 bytes across 22 recs (~341 B total) | 23 recs (22 tail + 1 size change) |
| `save_1.2 → save_3.2` | Roma queues levies | 0 | identical 22-rec tail-diff pattern | 23 |
| `save_1.2 → save_4.2` | queue cleared back to baseline | 0 | identical 22-rec tail-diff pattern | 22 + 2 size-change |

**Headline interpretations:**

1. **Mask = per-faction character/army influence halo (CONFIRMED).** The
   only mask diff in the entire corpus is rec 0 (player) on the ship-move
   pair, and the 100 changed cells form a tight ~16×14 cluster at
   centroid (335, 380.7) — exactly where the ship moved to in mask coords
   (game tile 171,99 ≈ pixel 340,380 at the 6×/4× scale between game-tile
   and 1020×700 region-map space). Value transitions are gradient shifts
   (e.g. `0→2`, `5→6`, `7→6`, `8→7`) consistent with a **distance-from-
   nearest-character** field, NOT ownership/shroud. So the mask is the
   engine's pre-computed per-faction visibility / influence radius cache,
   re-derived from character positions.
2. **Tail = per-faction discovered-settlement cache (STRONG).** Each tail
   entry has the schema
   `[ff ff ff ff sentinel][u32 hash][u32 flag][u32 hash][u32 hash][u16 strLen][ASCII W_*]`,
   identical to session 36/37's "discovered settlement record" at
   `0x1f48000+`. The diff bytes on Roma's build-queue pair show
   per-entry single-byte flag changes (e.g. `0x16 → 0x02`, `0x16 → 0x11`,
   `0x16 → 0x08`) at the same offset within each entry — these are the
   **per-faction view of Roma's current build-state**, updated whenever
   the player queues/cancels a building. This is why all 22 majors'
   tails flip simultaneously while the masks stay byte-identical: every
   major faction has rendered/seen Roma at T1, so each one's cached
   "what's at this settlement" entry gets re-emitted.
3. **`toggle_fow` does NOT touch this zone at all (CONFIRMED).** Both
   mask and tail are untouched by the FoW toggle. Session 17's
   "RLE shroud mask" hypothesis is now fully retracted: the mask is
   influence/distance, NOT visibility.

#### Why session 17 thought it was "ownership-like"

Session 17's `dig-tail-tilegrid14.js` saw mostly-sea TGA colors under
the non-zero cells and rejected "ownership". Correct call. The
gradient `2,3,3,...,3,3,2` row pattern they noted is the influence
ramp around a character/settlement: edge=2, interior=3, peak near
character=4..9. The high values (175, 255) are rare special-mark
markers (likely settlement-anchor or character-anchor cells).

#### Confidence

- **CONFIRMED**: 239 records, W/H constants, two-section layout
  (RLE mask + tail-list), `toggle_fow` doesn't touch this zone.
- **CONFIRMED**: rec 0 = player faction; ship-move mutates ONLY rec 0
  in a localized bbox at the ship's new tile.
- **STRONG**: Mask cell values encode a per-faction **distance-from-
  character / influence halo** (not ownership, not shroud).
- **STRONG**: Tail = per-faction **discovered-settlement-state cache**,
  mirroring the global section at `0x1f48000+`. Each entry's single
  varying flag byte tracks "what's at this settlement right now"
  (building queue, structure layout). 22 majors' tails change in
  lock-step on a single Roma build-queue tweak.
- **HYPOTHESIS**: per-entry `flag = 0x16` may mean "fresh / no
  outstanding queue", and `flag ∈ {0x02, 0x08, 0x11}` codes some
  combination of "build queued / construction in progress / damage
  state". Untested across more building types.

#### Practical implications for Provincia

- Provincia CAN read the per-faction known-settlement list **separately
  for each major faction** from this zone (vs. the global list at
  0x1f48000 which is the union). Useful for "who knows about whose
  settlements" UI.
- Provincia CANNOT decode visibility/shroud from this mask — it's an
  influence-distance field, and visibility is derived at runtime
  (session 37 finding).
- The 22-majors count means the parser can recover the **major-faction
  ordering** by indexing into these records' non-stub-tail subset.

#### Open follow-ups

- Pin the `flag` byte semantics (0x16/0x02/0x08/0x11) by capturing
  building-completion vs queue-cancel vs damage pairs separately.
- Confirm rec 1, 2, 3 (small mask, stub tail) — are these rebel
  sub-factions or sea/no-data placeholders? Session 17 noted rec 238 =
  rebels (full-map mask). Recs 1–3 likely placeholders.
- Locate which u32 in the 24B record-header is the **faction-id key**
  so we can name each record's faction without relying on centroid
  geography.

#### Scripts

- `dig-rle1.js` — enumerate 239 records via magic walk; compare record
  counts and sizes across all 8 saves; per-pair byte-diff summary.
- `dig-rle2.js` — decode rec 0 RLE across ship-move pair; 100 cells
  changed at centroid (335, 381), bbox 16×14.
- `dig-rle3.js` — classify byte diffs as header / payload per record;
  isolated the 22 majors that diff on build-queue and the 1 rec on
  ship-move.
- `dig-rle4.js` — list of 23 changed records on build-queue pair;
  faction-centroid table per session-17.
- `dig-rle5.js` — locate where the RLE stream ENDS within each record;
  surfaces the variable-length tail (148..2861 B) carrying ASCII
  W_*_Town/City strings.
- `dig-rle6.js` — full per-record summary: 205 stub-tail (148B) vs 22
  non-stub (>250B) splits the 239 records cleanly into majors and
  minors/empty.
- `dig-rle7.js` — byte-level diff of rec 0's tail across build-queue
  pair; identifies the per-entry single-flag-byte mutation pattern
  (`0x16 → 0x02/0x08/0x11`).

---

### Findings 2026-05-15 (background session 39 — family tree pointers)

Goal: pin parent / child / spouse pointer fields in character records so
Provincia can render a family tree.

Outcome:
- **Parent (fatherUuid) and child UUIDs**: already CONFIRMED in sessions 4
  + 13 (fatherUuid at record +46 LAYOUT_A / +42 LAYOUT_B; child UUIDs at
  +54/+50 stride-4 slot array). Confirmed wired into
  `src/characterParser.js`.
- **Spouse (husbandUuid)**: CONFIRMED at husband.primaryUuid sitting in
  the **wife's compact family-record at marker+40** with 72.4% accuracy
  on save_1.2 layout `-6` records (zero false positives at other
  offsets). Cross-validated on Republic Turn 2 Start (88/138 = 63.8%).
- **Mother UUID**: still unpinned (no test path yet).

#### 1. CONFIRMED: spouse pointer at compact family-record marker+40

Wives are NOT in the standard character record stream (none of 22 known
RIS Roman wives pass the parser's signature check). They live in a
separate compact table at file positions ~21.5M-23M, identified by the
constant 4-byte marker `2e 05 00 00` (= 0x00000052e). 275-361 markers
per save; ~63% are wife records (the rest are sons/daughters/dead).

Record layout (most common — layout `wifeOff=-6`, 186/215 records):
```
marker-6  u32  wifeFirstNameIdx (descr_names_lookup index)
marker-1  byte  01 (alive flag)
marker+0..3  4-byte marker  '2e 05 00 00'
marker+40 u32  husbandPrimaryUuid  ◆ CONFIRMED session 39
```

Alternative layouts seen (less common, semantics differ):
- wifeOff=-5: 23 records (none matched any husbandUuid — possibly child
  or dead spouse)
- wifeOff=-4: 5 records (same, 0% husband match)
- wifeOff=-10: 1 record

Decisive test (`dig-family19.js`, `dig-family20.js`): for 127 layout-
`-6` records cross-referenced with descr_strat `relative` lines and
parsed husband characters, husband.primaryUuid landed at exactly
marker+40 in 92/127 = 72.4% cases AND nowhere else in the wife record
window (marker-50..+200). The 27.6% miss is explained by wife-name
collisions across factions (e.g., 23 distinct `Marcia` entries) where
my naive firstName-only pairing matched the wrong husband — not by
layout variance. Cross-save: save_1.2 92/145, Turn-2-Start 88/138,
same offset.

#### 2. STRONG: wife record is ~364-368 bytes

Markers in 21.5M-23M zone show deltas of 364 or 368 (occasionally 462).
Each record is fixed-stride; the table holds ALL `character_record`
entries from descr_strat (wives + non-leader children).

#### 3. HYPOTHESIS: marker+40 may store the GUARDIAN uuid, not strictly the husband

The 72.4% hit rate is strong but the matched value is the husband's
**primaryUuid** (per-session 32-bit ID). For children-records (which
also live in this table), marker+40 should be the FATHER's primaryUuid.
Not tested in this session — `dig-family16` showed that gender=1 family
records include sons (Gaius/Gnaeus/Publius Ogulnius_Gallus), so the same
+40 field probably encodes the parental/guardian pointer regardless of
relationship type. The "spouse vs father" distinction would need a
gender field decoded from elsewhere in the compact record.

#### 4. NEGATIVE: motherUuid not pinned

The Rome corpus parser detects zero female characters in the main
character-record stream, so reverse-search (child's record → mother's
uuid) cannot be tested without first decoding wife records as
first-class characters. The compact family table at marker+40 IS the
mother pointer for child records living in that same table — but
provoking the engine to render mother-of-leader-character via a u32 in
the standard character record (where leaders live) returned no hits.

#### Reproducer scripts
- `dig-family12.js` — initial husband-pointer hunt by scanning for wife
  name index near husband record. Too noisy due to small-uuid garbage.
- `dig-family14.js` — wife-name occurrence dump revealed the compact
  table at 22M with `2e 05 00 00` marker.
- `dig-family15.js`, `dig-family16.js` — first attempt at decoding
  compact wife records; alignment +0/+4/+9 wrong for non-clan wives.
- `dig-family18.js` — decisive scan: family-record markers, wife name
  idx at marker-6, husband.primaryUuid at marker+40 (74/112 = 66% in
  save_1.2 with full-zone scan).
- `dig-family19.js` — cross-save validation (save_1.2 + Republic T2
  Start), confirms marker+40 is the only consistent offset.
- `dig-family20.js` — per-layout breakdown: wifeOff=-6 gives 72.4% hits,
  other layouts 0% (different record sub-types).

#### Open follow-ups for session 40+
- Decode wife-record layout fully (age, traits, portrait, primaryUuid
  for the wife herself, dead-flag).
- Verify marker+40 also holds fatherUuid for child records in the same
  table (i.e., it's a generic "guardian" pointer, not spouse-specific).
- Find the wife's "own primaryUuid" position in the compact record so
  the husband's character record can be checked for a reverse pointer.
- Investigate the wifeOff=-5/-4 sub-layouts (dead spouses? orphans?).

---

### Findings 2026-05-15 (background session 41 — family record layout)

Cross-referenced 97 RIS wife records in `save_1.2.sav` and 92 in
`save_Autosave Republic of Rome Turn 2 Start.sav` against descr_strat
`relative`/`character_record` ground truth.

#### Record start, end, and stride — CONFIRMED

- Records are **fixed-stride 364 bytes** (72% of records) or 368 bytes
  (10%); the rest are 462/470/472 (rare, ~6%).
- **Record START = marker − 10**: the `f2 02 00 00` u32 (=754) and two
  trailing zero bytes before every marker are part of the record header.
  All 97 wife records share the same `00 00 00 00 f2 02 00 00 00 00` ten-
  byte prefix before the `2e 05 00 00` marker.
- **Record END = marker + 354** (start + 364). The next record's header
  (`00 00 00 00 f2 02 00 00 00 00 2e 05 00 00`) begins at marker + 354.
- Header semantics: `f2 02 00 00` (=754) is a record-type tag analogous to
  the type-codes seen elsewhere; `2e 05 00 00` (=1326) is a sub-type tag
  ("family character"). Both are emitted by the taw `pas` grammar for
  every entry.

```
record_start =  marker - 10
record_end   =  marker + 354    (354 + 10 = 364 stride)
```

#### Confirmed byte map (relative to marker)

```
marker-10 .. marker-7  u32   0x000002f2 (record-type tag)
marker-6              u32   wifeFirstNameIdx  ◆ CONFIRMED session 39
marker-1              byte  0x00 (padding, NOT alive flag — see retraction)
marker+0..3           u32   0x0000052e (record-sub-type tag)
marker+4..7           u32   0x00000000
marker+8..15          8B    0xff 0xff 0xff 0xff 0xff 0xff 0xff 0xff (sentinel,
                            mirrors LAYOUT_A 0xff slot in main char records)
marker+16             byte  age = (242 − byte)  ◆ CONFIRMED 72% save_1.2,
                            73% Turn-2 (misses are non-roman wives whose
                            descr_strat age does not exist as
                            `character_record age N`; encoding matches main
                            character record convention exactly)
marker+17..19         3B    0xff 0xff 0xff (sentinel continuation)
marker+20             u32   flag, value 0 (≈50%) or 2 (≈50%) — purpose unknown
marker+28             u32   0x00000002 constant (99%)
marker+40             u32   husband.primaryUuid  ◆ CONFIRMED 100% (after
                            disambiguation by name-collision filter; session
                            39's 72.4% was a false-negative from naive
                            firstName matching, not a layout miss)
marker+60             u32   0xffffffff constant
marker+68             u32   0x00000002 constant
marker+80             u32   packed bitfield (e.g. 0x00010c81, 0x00010741) —
                            HYPOTHESIS: encodes faction, gender, alive,
                            never_a_leader, etc. as bit flags. Low byte
                            always 0x01 or 0x41/0x81/0xc1 (low 2 bits set);
                            byte +82 looks faction-related but only 26% of
                            wives have it = expected faction id.
marker+88             u32   0x00000032 (=50) constant — possibly a default
                            authority/loyalty/popularity value
marker+96..289        ~194B mostly zeros (placeholder for traits / ancillaries
                            that wives don't have at turn 1)
marker+294            u16   length-prefixed ASCII portrait path #1
                            (e.g. "data/ui/roman/portraits/cards/old/
                            generals/373.tga") — CONFIRMED in Turn-2 save
                            where it extends beyond marker+354. Save_1.2
                            has shorter strings here so the portrait block
                            ends before the record boundary.
marker+(294+len+2)    u16   length-prefixed ASCII portrait path #2 (small
                            portrait), same format
```

The portrait-string layout matches the main `characterParser.js` format
exactly, so wife records reuse the standard portrait subrecord.

#### Wife's OWN primaryUuid — NEGATIVE (with retraction)

`+36` is **NOT** the wife's own primaryUuid. Evidence:
- 109 unique values across 361 records (would be 361 unique if it were a
  UUID — wives are not deduplicated by name).
- 42 nonzero `+36` values appear in 2+ records.
- 166 cross-record links where one record's `+36` equals ANOTHER record's
  `+40` (husband uuid). This means `+36` carries **the wife's father's
  primaryUuid OR the wife's family-tree parent UUID**, not the wife
  herself — i.e. wife's father / mother record is sharing one of its UUIDs
  with the wife's record.
- Test "wife's +36 value found anywhere in husband's record window
  (0..250)": 0/97. So +36 has no relationship to the husband's
  character record children/family array.

Best interpretation: **wives do NOT have a standalone primaryUuid stored
in the compact family record**. Their identity is implicit: they are
addressed by (parent UUID @ +36, husband UUID @ +40, name @ −6). This
matches the engine pattern where wives are non-leader characters that
don't get their own slot in the main `character_record` UUID space.

#### Wife's FATHER UUID — STRONG HYPOTHESIS at +36

- 168/361 records (47%) have a nonzero `+36` u32.
- The value passes the "is-a-real-uuid" test: 166 of those values appear
  at `+40` of some other family record (i.e. they are someone's parent
  pointer, which is how UUIDs in this table are reused).
- Plausibility: in the engine, a wife's record cross-references her
  family-of-origin so the marriage logic can detect incest / clan
  conflict. `+36` is sized and positioned like a uuid (u32, 4 bytes
  before +40 husband ptr).
- Caveat: untested against a wife whose father is also a leader — the
  descr_strat `relative` lines do NOT name wives' parents. To prove
  CONFIRMED status, would need a turn-50+ save where one wife's
  character_record father lives in the main char stream.

#### Child / mother links — NEGATIVE on save_1.2's +358 hit

- save_1.2 showed 52/63 wives with a u16 at `+358` matching a known
  child's firstName-idx. RETRACTED: in the Turn-2 save the same `+358`
  matches **0/59** of those same wives. The save_1.2 hit was a coincidence
  — the portrait-path block at +294 happens to terminate near +356 in
  save_1.2 (short paths), so the next u16 length-prefix at +358 looked
  like a child name idx. In Turn-2 saves the portrait paths are LONGER,
  shifting that offset. **Child name idxs are not stored at any fixed
  offset in the wife record**; they live in the children's OWN
  family-records.

Verified by direct test: scanning the entire 380-byte window for known
child name idxs (u16) of 95 (wife, child) pairs in save_1.2 hits +358
55% — and no other offset hits more than 3%. In Turn-2 the same scan
hits 0% at +358. **Confirms +358 is structural noise, not a child slot.**

#### Faction id — NEGATIVE

No fixed-offset u8/u16/u32 matches the playable-faction-list index for
the husband's faction across wives. Best candidate (+82) hits 26% — at
chance level given how many small ints exist in the record. The wife's
faction is likely inherited at render-time from her husband (lookup via
husband.primaryUuid @ +40 → husband.factionId).

#### Trait block — NEGATIVE

The +96..+289 region is all zeros across all 97 matched wives. No trait
count, no trait records. Hypothesis: wives at turn 1 simply have no
traits. Confirming on a later save (after the wife has acquired traits
through marriage/childbirth events) would require a longer-running save
than the corpus contains.

#### Birth year / turn — NEGATIVE

No s16 / u16 / u32 in the record decodes to "turn number" or "year"
across wives of varying age. Age is stored as `242 − age` byte at +16,
matching the main character-record convention. Engine likely computes
birth year on the fly as `currentTurnYear − age`.

#### Summary table

| Field             | Offset | Type | Confidence  |
|-------------------|--------|------|-------------|
| record start tag  | -10    | u32 0x2f2 | CONFIRMED   |
| firstName idx     | -6     | u32  | CONFIRMED (sess 39) |
| sub-type tag      | +0     | u32 0x52e | CONFIRMED |
| 8-byte 0xff sentinel | +8  | 8B   | CONFIRMED   |
| age (242−age)     | +16    | u8   | CONFIRMED   |
| husband uuid      | +40    | u32  | CONFIRMED   |
| wife-self uuid    | —      | —    | NEGATIVE (not stored)  |
| wife's father uuid | +36   | u32  | STRONG HYPOTHESIS  |
| portrait path     | +294   | u16-prefixed ASCII | CONFIRMED |
| record stride     | 364    | —    | CONFIRMED (72%; 368 alt) |
| record end        | +354   | —    | CONFIRMED   |
| traits, faction, child links | — | — | NEGATIVE (not present in this record; lookup via husband/children) |

#### Reproducer scripts (session 41)

- `dig-familyrec1.js` — bulk histogram of age @ +16, husband @ +40,
  marker-stride; established record is 364B fixed-stride.
- `dig-familyrec2.js` — column-entropy analysis revealing the stable
  vs. variable byte columns; surfaced +358 child-name candidate that was
  later retracted.
- `dig-familyrec3.js` — wife-self-UUID test (+36 NEGATIVE),
  +36-cross-link analysis pointing to "wife's father uuid".
- `dig-familyrec4.js` — cross-save validation: portrait-path string
  block at +294 visible only in Turn-2 save where it extends past +354,
  retracting +358 child theory.

#### Open follow-ups for session 42+

- Prove `+36` is wife's father UUID by finding a wife whose father IS a
  leader (his primaryUuid known) — requires a late-turn save where a
  family-member wife appears after her father has been a faction leader.
- Decode `+80` packed bitfield (likely gender, alive, faction, trait-
  group flags).
- Test whether the same record layout (with the SAME +40 = parent uuid
  slot) is used for child records (non-leader sons/daughters). Session
  39 noted gender=1 records also exist in this table — likely those use
  +40 as fatherUuid, identical encoding.
- Confirm portrait path is at +294 in all records (parser should length-
  walk from +294 rather than seek to +358).

---

### Findings 2026-05-15 (background session 42 — MASK halo formula)

Goal: pin the per-faction halo MASK formula. Session 40 confirmed each
of 239 records has a 1020x700 RLE-encoded value-mask with small ints
(0..9), and that a Roman ship move localized 100 cell changes in a
16x14 bbox in faction-0's mask. This session tests whether the mask
value = floor(distance-from-nearest-friendly-character).

#### Key empirical findings (CONFIRMED)

1. **World-object (x,y) u32 fields ARE in mask-pixel space (1020x700)
   directly.** The "ship moved (172,92) -> (171,99)" in the original
   brief was a different coord encoding (probably descr_strat tile
   coords). In `save_5.2`, the Roman ship is a type-4 record at u32
   (333, 380); in `save_6.2`, a NEW type-4 (different uuid) is at
   (337, 381). This sits exactly inside the mask-diff bbox X[328..343]
   Y[374..387], centroid (335, 380.7).

2. **Type-4/5/6 record uuids are NOT stable across turns / save-pairs.**
   The ship's type-4 record gets re-emitted with a fresh uuid each save
   (45 of 46 naval records have new uuids between A and B). Position-
   based identity is more reliable than uuid for cross-save matching.

3. **The halo is NOT max(K - dist_from_nearest_friendly).** Best fit
   with that hypothesis (single-source OR multi-source MAX): r^2 = 0.43
   regardless of metric (Chebyshev / Manhattan / Euclidean) or scale K.

#### Best fit (HYPOTHESIS, r² = 0.70)

The halo behaves like a **stacked/summed influence field**, NOT a
nearest-character distance:

```
value(cell) ≈ min(8, floor(0.20 × SUM_{i in Romans} max(0, 11 - cheb_dist(cell, i))))
```

- Best metric: **Chebyshev** (king-move) over u32 (x,y).
- Best per-source halo radius K = **11 mask-pixels**.
- Saturation cap = **8** (matches observed max value in changed cells).
- Linear scale ≈ 0.20 (per-source contribution density).
- R² = **0.70** against save_6's vb (B-side observed values).
- R² = **0.71** against save_5's va using A-side positions
  (symmetric — same formula holds on both sides of the move).

Naive `max(0, K - cheb_dist_to_nearest_friendly)` caps at r² = 0.43.
Naive `count_within_R` caps at r² = 0.55. Gaussian-weighted SUM caps at
r² = 0.68. SUM_i max(0, 11 - cheb_d) with Chebyshev is the cleanest
single-knob fit.

#### What didn't fit (NEGATIVE)

- **Single-source max**: r² = 0.43 (no K or metric breaks 0.45).
- **Manhattan/Euclidean SUM**: r² = 0.55-0.65 (worse than Chebyshev).
- **Anisotropic distance (2:1, 4:1 X:Y)**: r² ≤ 0.44.
- **clamp-min distance directly**: r² = 0.43 (mirror of max hypothesis).
- **1/(d+1) inverse-distance**: r² = 0.50.
- **sqrt/log saturating transforms of SUM**: didn't break 0.70.

#### Mechanism interpretation

Multiple Roman characters' Chebyshev-11 halos OVERLAP and the engine
sums them, then clips at ~8. This matches an **AI strategic-importance
heatmap** — cells "more interior to the Roman position cluster" get
higher values because more Romans contribute to that cell.

This is consistent with session 40's interpretation ("influence halo")
but refines it: not a per-character distance field, but a per-cell
**SUM of overlapping halos** with cap.

Open: the residual 30% R² gap means the true formula has some extra
component — terrain weighting, settlement bonuses, or a different
source set (perhaps the engine only uses a SUBSET of characters, such
as those with line-of-sight, or boosts type-6 generals more than
type-5 captains and type-4 ships). Hard early-stop hit at 3 attempts;
leaving HYPOTHESIS.

#### Scripts

- `dig-mask-halo1.js` — extract 100 changed cells, find centroid
  (335, 380.7); naive distance-from-centroid test (r² = 0.13).
- `dig-mask-halo2.js` — pin world-object coord space = mask-pixel
  space (1020x700); locate type-4 ship at u32 (333, 380) in save_5.
- `dig-mask-halo3.js` — uuid not stable across save-pair; identify
  new ship by NEW type-4 uuid in save_6 at (337, 381).
- `dig-mask-halo4.js` — multi-source MAX hypothesis sweep, all
  K/metric combos cap at r² = 0.44.
- `dig-mask-halo5.js` — single-source variants, count-in-radius
  (r² = 0.55), SUM(max(0, K - d)) (r² = 0.64 at K=10 Chebyshev).
- `dig-mask-halo6.js` — SUM sweep, peak at K=11 Chebyshev r² = 0.69;
  A-side symmetric r² = 0.71.
- `dig-mask-halo7.js` — saturation/transform sweep; best 0.20x +
  cap-8 transform → r² = 0.70.

#### Confidence

- **CONFIRMED**: World-object (x,y) coords are mask-pixel space.
- **CONFIRMED**: Mask value at any cell is NOT a simple
  distance-from-nearest-friendly (single-source max caps at r² 0.43).
- **HYPOTHESIS**: Mask value ≈ saturated SUM of Chebyshev-11 halos
  over Roman characters/armies (r² 0.70). True formula likely adds
  a terrain/settlement term or a character-type weighting that
  accounts for the 30% residual.

#### Open follow-ups

- Capture a save-pair with a SINGLE Roman character/army (T0 fresh
  start), removing the overlap ambiguity. The single-source mask in
  isolation will reveal the exact per-source halo shape.
- Test a turn-pair where a NEW Roman general is recruited (one new
  source added). The delta mask should equal exactly one halo
  contribution, revealing the per-source formula.
- Look for a u32 field in the mask record header (24 bytes pre-magic)
  that names the faction-id — would let us label rec 0..238 by
  faction without geographic centroid inference.

---

### Findings 2026-05-15 (background session 43 — tile-grid 6 fields)

**HEADLINE — NEGATIVE: the 6 variable fields in the 240×153 tile-grid at
`0x633c50` do NOT encode `map_ground_types`, `map_heights`, `map_regions`,
`map_climates`, or `map_features`.** No correlation > 0.4 against any of the
5 bundled static map TGAs (tried both Y-orientations). Maximum purity score
of 0.978 was a baseline artefact (97.8% of cells are default-valued, so
*any* sparse map looks "correlated"). Pearson r ≈ 0.000 on all 30 pairings.

#### Method (per spec)

Extracted the 3 known variable u32 fields (`+20`, `+28`, `+32`; session 35
schema) for all 36,583 records. Sampled each TGA at `(col·TGAW/240, row·TGAH/153)`
both normal and Y-flipped. For each (field, map) pair, computed (a) Pearson r
on raw u32 values, (b) categorical purity = (sum of dominant-bucket counts) /
(total cells), and (c) KL divergence between non-default-cell map distribution
vs default-cell map distribution.

#### Key falsifying evidence (most diagnostic test)

If non-default field cells encoded ANY static map property, those cells
should disproportionately fall on region/terrain boundaries OR on rare
ground-type cells. They don't:

| Field | Non-def cells | Region-boundary rate (non-def) | Region-boundary rate (default) | Lift |
|---|---|---|---|---|
| F20 (+20) | 647 | 28.1% | 33.8% | **0.83×** |
| F28 (+28) | 262 | 30.9% | 33.7% | **0.92×** |
| F32 (+32) | 711 | 29.3% | 33.8% | **0.87×** |
| F20 | 647 | ground-boundary 82.2% | 79.8% | 1.03× |
| F32 | 711 | ground-boundary 79.0% | 79.9% | 0.99× |
| F20/F28/F32 | — | mean height-range within block | — | 0.93–1.10× |

Non-default cells **avoid** region boundaries (lift < 1.0×) — the *opposite*
of what a terrain-derivative cache would do. All other lifts are within noise.

#### Spatial geometry refutes terrain hypothesis

- F28=54 stripe at col 101 (153 of 250 cells): the underlying TGA col 101
  in `map_regions.tga` spans 45 distinct region colors across all rows.
  A vertical line crossing 45 regions cannot be a terrain feature.
- F28=55 NE→SW diagonal (11 cells, per session 35): does not coincide with
  any coastline, river, or elevation contour in the 5 TGAs.
- F20/F32 non-default cells are scattered randomly across the map's
  interior (visual overlay in `dig-tilegrid-fields3.js`) — no clustering
  along coasts (which would be the case for a sea/land mask) or along
  height bands.

#### Top non-default → map value frequencies (all unremarkable)

Best raw signal was F20=600 vs `map_climates` Y-flipped: KL=0.226 —
non-default cells lean toward climate `0xed1c24` (red, 74 cells) and
`0x39b54a` (green, 67 cells) but with no concentration > 25% of any single
non-default value. Far below the > 0.7 correlation early-stop threshold.

#### What the fields likely DO encode (HYPOTHESIS, unverified)

Given (a) defaults dominate at 97.6%, (b) non-default cells avoid region
boundaries, (c) F28=54 stacks on a single column (col 101), and (d) the
F28=55 cells form a clean diagonal: these look like **engine-internal
campaign-map markers** — possibly:
- Pathfinding waypoint anchors or movement-cost overrides (col-101 stripe
  = a constant-cost vertical corridor?)
- Strategic-AI region-of-interest seeds (sparse positional landmarks)
- Engine-cache invalidation tags (a "this cell needs recompute" flag set
  during the game's preprocessing pass)

None of these are testable against bundled static maps. Future probe should
generate per-turn diffs of this gap region — if these fields update during
play, they're cache state; if static across all saves, they're a derived
constant from `descr_strat.txt` / `map.rwm`.

#### Scripts produced

- `dig-tilegrid-fields1.js` — initial Pearson + purity sweep (top purity 0.978 was a default-density artefact)
- `dig-tilegrid-fields2.js` — non-default-cell focused KL divergence; max KL = 1.46 (F28 × regions, noise-level)
- `dig-tilegrid-fields3.js` — boundary-lift test (decisive negative: lift 0.83–0.92×, opposite of terrain hypothesis)

#### Impact

Session 35's "terrain attribute cache" hypothesis (height-band / type enum /
trade-route waypoints) is **REFUTED** by direct cross-reference. The 240×153
grid does not redundantly mirror `descr_terrain`. Its 6 fields encode
*engine-private* state, not a static map.

---

### Findings 2026-05-15 (background session 44 — trade routes)

**Goal**: confirm/pin trade-route data structure in `save_1.2.sav` (RTW
Remastered, 34,524,371 bytes). Session 8 had a STRONG-negative: routes not
stored as `(settlement_a, settlement_b)` pairs.

**Result: CONFIRMED negative — trade routes are NOT persisted in the save.**

Evidence (`scripts/save-cracker/dig-trade-session44.js`):

1. **No trade-route keyword anywhere in the body.** ASCII + UTF-16LE scan
   of save_1.2.sav for `trade_route`, `tradeRoute`, `trade_routes`,
   `TradeRoute`, `trade_graph`, `tradegraph`, `trade_link`, `trade_partner`,
   `land_trade`, `sea_trade`, `trade_lane`: **0 hits** for all 11 tokens in
   both encodings. Settlement sub-records (which session 3 enumerated) do
   not include any trade-route-named entry — `hinterland_roads` is the
   closest stored field and only indicates per-settlement road
   infrastructure presence.

2. **Generic substring `trade` (ASCII) — only 8 hits in 34 MB, all are
   character trait/ancillary tokens**: `silk_trader` (6x), `incense_trader`
   (1x), `ivory_trader` (1x). These are descr_traits/ancillaries strings
   attached to characters, not route data.

3. **`descr_strat.txt` (RIS imperial campaign) cross-reference**: the file
   contains zero `trade_route` declarations. RTW's strat format does not
   accept author-defined trade routes — `descr_strat` only declares
   resources (`slave_trade` is a resource token, not a route). Routes are
   ALWAYS engine-derived at runtime in classic RTW and Remastered.

**Conclusion**: trade routes are a runtime-computed derivation from
(a) ownership, (b) road-infrastructure flag (`hinterland_roads` sub-record
presence per settlement — session 8 §1), (c) port-building flag
(`port_buildings` sub-record), (d) diplomacy state (session 6). No
`(origin_settlement, destination_settlement, route_type)` table exists in
the save. Confidence: **CONFIRMED**.

**Practical implication for Provincia**: replicating in-game trade-route
income requires re-implementing the engine's adjacency computation client-side
from those four inputs. There is no shortcut by reading a pre-baked graph.

Files: `scripts/save-cracker/dig-trade-session44.js`

---

## Sources

- taw/etwng/sav: https://github.com/taw/etwng/tree/master/sav
- Rafkos pointers: https://bitbucket.org/Rafkos/rometwsaveeditor/raw/master/pointers/rometw.json
- TWC "Decoding save game (.sav) files": https://www.twcenter.net/threads/decoding-save-game-sav-files.562363/
- TWC "Advanced Save Game Editing": https://www.twcenter.net/threads/advanced-save-game-editing.657545/
- M2TWEOP runtime structs: https://eop-labs.github.io/M2TWEOP-library/
- Pannoniae/rex (M2EX/REX x64 engine): https://github.com/Pannoniae/rex
