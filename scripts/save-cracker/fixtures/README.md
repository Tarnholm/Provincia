# Save fixtures

Naming convention (per user 2026-05-05):

- `save_1turnstart.sav` — **the baseline.** No actions taken. Reused for every variant.
- `save_1turnchange.sav` — first variant (legacy name kept for the first save already created)
- `save_2.sav`, `save_3.sav`, `save_4.sav`, … — additional variants

**Workflow**: load `save_1turnstart.sav`, take exactly ONE controlled action, save under the next variant name. Reload `save_1turnstart.sav` for the next experiment so every diff is single-variable.

The user keeps the saves at:
```
C:\Users\vtarn\AppData\Local\Feral Interactive\Total War ROME REMASTERED\VFS\Local\Rome\saves\
```

Run the batch analysis directly against that folder:
```sh
node scripts/save-cracker/index.js --batch "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/"
```

## Manifest

Drop a `manifest.json` next to the saves describing what each variant changed. Example:

```json
{
  "1": "moved Blasio 1 tile east",
  "2": "recruited 1 hastati in Rome",
  "3": "raised Rome tax to very_high",
  "4": "queued temple_complex_italic at Capua",
  "5": "disbanded Hannibal's last unit",
  "6": "declared war on Carthage",
  "7": "exchanged 200 denarii with Antigonid"
}
```

Without a manifest, the report just says "(no manifest entry)" but everything else still works.

## What the batch produces

For each variant pair (baseline → variant N):
- bounded-shift diff (insert/delete-aware, doesn't false-positive on record-size shifts)
- top 20 change-runs annotated with the nearest oracle-known token

Aggregated across all pairs:
- bucket 0× = bytes that never change → engine scaffolding, structural constants
- bucket N× = bytes that change in every variant → engine noise (FoW recompute, AI memory, RNG seed advance)
- bucket 1× = bytes changing in exactly ONE variant → **action-specific signal for that variant** (this is the gold)

Output: `scripts/save-cracker/out/batch.json` plus console summary.

## Recommended action set (8 isolations)

Each variant should be a single, minimal, observable action:

1. Move one general 1 tile (locates character x/y + movement points)
2. Recruit one unit in one settlement (locates recruitment queue + settlement record)
3. Change tax rate in one settlement (locates per-settlement tax field)
4. Queue one building in one settlement (locates building queue)
5. Disband one unit (locates army composition)
6. Adopt or marry a character (locates family-tree section)
7. Declare war on one faction (locates DIPLOMATIC_ATTITUDE matrix)
8. Trade money with one faction (locates per-faction-pair diplomacy state)

After 5+ of these land we should have confident field offsets for movement, recruitment, treasury per faction, settlement tax, and at least the diplomatic-attitude matrix.
