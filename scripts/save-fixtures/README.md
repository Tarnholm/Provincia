# Save fixtures

Real `.sav` files that drive the save-parser tests (units, ownership, faction
records, lua counters).

```sh
npm run fixtures              # copy them in from wherever saves live on this machine
npm run fixtures -- --force   # re-copy even if the checksums still match
```

Nothing here is committed: `.gitignore` excludes `*.sav`, and a save is 35-45 MB
against a public repo. Only `feral/manifest.json` is tracked. Without the
fixtures the tests **skip**, visibly — they are never reported as passed. (Until
2026-09-21 they returned early instead, so 25 tests read as green while doing
nothing.)

## The saves are older than the mod

They come from whatever RIS build was installed when they were played, so a
fixture must never be checked against today's `C:/RIS`. The manifest records what
each parser produced on the day the fixture was accepted, and the tests compare
against that, plus invariants that hold for any save (every unit sits in a
region; a ship has a crew; the same state parses the same way twice).

That drift is measured rather than assumed. `identical_A.sav` is a turn-1 save,
so nothing in it has been conquered yet: every difference from today's starting
position is the mod having moved. On 2026-09-22 that was 2 settlements of 1310,
with 7 more absent from the current map. `saveOwnershipParser.test.js` asserts
that floor, and the conquest thresholds sit far above it (250 at turn 17).

## The set

| Fixture | Save | Why |
|---|---|---|
| `identical_A.sav` | Bactria, turn 1 | No conquests: the determinism pair, and the drift baseline |
| `identical_B.sav` | Bactria, turn 1 (autosave) | **The same game state saved twice** — different bytes, identical parse. A byte-for-byte copy would pass the determinism tests trivially |
| `ror_t5s.sav` | Republic of Rome, turn 5 | Early end of the faction-record growth curve |
| `ror_t17s.sav` | Republic of Rome, turn 17 | Same campaign 12 turns on: conquests, long region names, a real navy |

## Replacing a fixture

Edit `FIXTURES` in `scripts/build-save-fixtures.js` and re-run. If a parser's
output on an existing fixture has moved, the build **fails** and prints what
changed rather than quietly rewriting the manifest — that is either a parser
regression to review or a different save than the one recorded. Accept it by
re-running once you have read the diff.

Tests elsewhere still skip because they need their own saves plus figures
verified against the in-game scrolls (economy calibration, the Cyrene ledger,
character stats). A substitute save cannot stand in for those.
