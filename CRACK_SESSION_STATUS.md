# Long-running crack session — status

(Updated periodically. Latest update at the top.)

## Current pass — 2026-05-18 evening

### ✅ Completed earlier in session

- **Portrait byte cracked & shipped (143/143 chars resolved)**
  - +280 in 354-byte extended record = portrait UUID
  - Match against u32-prefixed portrait pool entries
  - Seed-modulo fallback for procedural chars
  - UI integration via coord (x,y) bridge — descr_strat char x/y ↔ save's extX/extY at extended-record +288/+292
  - Shipped 0.9.388 → 0.9.398

- **Movement-points field** — was already shipped (cracker session 4). Provincia displays "· moved this turn" on army cards.

- **Per-settlement building queue** — was already shipped via `src/queueParser.js` (session 36).

### 🚧 In-progress / blocked tonight

- **Treasury across all turns** — partial
  - Section type registry IS at 0x3310 in vanilla T0 (was 0x500 for RIS — version difference)
  - FACTION_ECONOMICS confirmed id=91 count=36/20 in registry
  - But 0x2c5e1 = 2500 (the value memory called "Spain T1 treasury") may actually be a SETTLEMENT POPULATION THRESHOLD — bytes around it look like cascading float tiers (16.0, 3.0, 2.0, 1.0), classic level-up triggers.
  - The dig-faction-treasury-final.js script's signature (+8=100, +12=1, +24=self_ptr, +44=6) finds zero records in this vanilla T1 save — that script was written for RIS imperial.
  - Need a vanilla-specific faction-record signature.

- **Diplomatic relations** — partial
  - Marker `05 00 24 39` at offset `+(244 + 4×regionCount)` of each major-faction record
  - Entries 16 bytes each: `<u32 uuid><u32 class><u32 attitude><u32 tag>`
  - BLOCKED: the OTHER faction in each relationship isn't in the 16-byte entry — needs ground-truth from an in-game diplomacy screen to back-derive owner-zone → faction mapping.

- **Section walker** — simple `{u32 self_ptr, u32 size}` invariant doesn't apply on this save format. Need different grammar.

- **Wife/child portrait crack** — vanilla `data/ui/<culture>/portraits/family/` only has wife.tga / son.tga / daughter.tga (one each). The engine likely uses these as-is for all wives/kids; the in-game "unique faces" the user thought they saw may have been misperception or RIS-specific.

### What's ready to ship next

- Coord (x,y) bridge fix: if descr_strat char coords don't match save's extX/extY exactly (later turns when chars moved), fall back to (faction, age, age-bucket) match.

### Long-term targets

- Section walker for treasury (any turn)
- Diplomatic-relation owner mapping
- Religion percentages (memory: located but not surfaced)
- Adoption events / new family members in saves
