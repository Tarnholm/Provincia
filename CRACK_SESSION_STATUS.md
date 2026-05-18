# Long-running crack session — final status (extended)

## Versions shipped this session (17 total)

| Ver | What |
|---|---|
| 0.9.388 → 0.9.398 | Portrait crack (143/143 chars resolved) |
| 0.9.399 | parseFactionTreasuries factored out |
| 0.9.400 | Region-record walker (paired self-pointer signature) |
| 0.9.401 | RIS `dummies` hidden from family-tree dropdown |
| 0.9.402 | Per-faction diplomacy extraction (240+ relations) |
| 0.9.403 | Family tree uses save-derived age + region (current-turn) |
| 0.9.404 | Wired factionDiplomacy + factionTreasuries into App.js state |

## Cracks completed this session (chronological)

- **Portrait UUID linkage** — +280 in 354-byte extended record = portrait UUID. 143/143 chars resolved (100%).
- **Mac build via repackaged Electron zip** — bypassed cross-build restrictions.
- **Region-record walker** — paired self-pointer signature `u32(P)==P && u32(P+8)==P+8`. 426 candidates in Macedon T0.
- **Per-faction diplomacy extraction** — `05 00 24 39` marker at +(244+4×regionCount) of major-faction records. 240+ relations parsed, 100% tag-validated.
- **Save-derived age + region** — descr_strat (x, y) bridges to save's extended-record (extX, extY); MemberCard overlays current-turn age/region over T0 values when bridge hits.
- **Treasury parser refactor** — `parseFactionTreasuries()` reusable; exposed as `factionTreasuries` IPC field.
- **Section type registry** — confirmed at 0x3310 in vanilla T0 (RIS imperial = 0x500 per memory).
- **RIS dummies UX** — hidden from family-tree dropdown unless player is dummies.
- **Wife/child portrait** — confirmed engine uses single file (not crackable).
- **Memory correction** — "Spain T1 = 2500 at 0x2c5e1" was actually a settlement population threshold.

## Investigated but inconclusive

- **Per-character MP byte** — byte at N+9 is 0x7f at T0 for all 913 characters (constant sentinel, not MP).
- **Diplomatic relation owner-mapping** — 283 unique UUIDs, ZERO duplicates across faction records (mirror hypothesis refuted). Owner mapping needs ground truth.
- **Faction leader UUID** — found that rec body has char UUIDs at 354-byte stride, first char = likely leader. But rec 0 only matched rebel-region chars; rec 1 had Roman territory chars. Player identification may not be at idx 0 for all formats.
- **Faction ID in record** — lua counters have `id_FACTIONNAME = u32` for 60 factions, but those IDs don't appear in faction record bodies.
- **Section walker for arbitrary types** — simple `{u32 self_ptr, u32 size}` invariant doesn't apply.

## What's available in IPC but not yet UI-surfaced

- `factionDiplomacy` (per-faction relation counts + classes) — wired into App.js state, no panel yet
- `factionTreasuries` (full-shape records) — wired into App.js state; Wealth widget already uses subset via `treasuryByFaction`
- `religionByCity` — extracted, RegionInfo doesn't display
- `factionDiscovered` — bitmask of 240 factions, 65 discovered in Macedon T0 — no UI for bit→faction mapping yet

## When you're back

Tell me what direction to push and I'll continue. Most cracks need ground truth (e.g., diplomacy owner mapping, faction leader identification). UI integration of existing cracks would be the next visible gain.
