# Editing the rule scripts

For anyone tuning the Settlement Processor rules (farms, exploits, core
buildings, temples…) from the Scripts window in Provincia. No JavaScript
needed — the rules are the Python files the pipeline runs.

## Where your edits live

The Scripts window does not edit the copies inside the app. It works on a
project folder in your user profile:

```
%APPDATA%\Provincia\scripts-suite\project\
    farms.py, rural_exploits.py, …      the pipeline scripts you edit
    config\                              the mod files the pipeline reads
    rule_profiles\<name>\                saved snapshots of the scripts
    processed_output\                    what the last run produced
    _backups\                            copies of mod files taken before "save back to mod"
    _user_edits\<time>\                  edited scripts set aside at launch (see below)
```

## The one rule that surprises everybody

**Every pipeline script is refreshed to the app's own copy each time Provincia
starts.** That is deliberate — an old script running against a new app produces
wrong output with no error — but it means an edit made in the editor does **not**
survive a restart by itself.

To keep a rule change:

1. Make the change in the editor and save.
2. **Save it as a rule profile** (Profiles panel → Save). A profile is a snapshot
   of all the scripts.
3. After a restart, **load that profile** again before you run the pipeline.

If you forget, nothing is lost: at launch, any script that differs from what the
app last put there is copied to `_user_edits\<time>\` before it is refreshed, and
the Scripts window tells you so, with a button that opens the folder. The ten
most recent sets are kept.

`config\` is different — those files are **yours**. They are only copied in when
missing and are never overwritten by a launch.

## Sharing rules with the team

Profiles → **Export** writes one portable `.json` file; **Import…** reads one
back (a name that already exists gets a suffix rather than overwriting). Send
the file, not the scripts folder.

## When a script breaks

- Saving a `.py` runs a syntax check and tells you the line. The save still
  happens — your work is never held hostage — so fix the line and save again.
- **Reset to default** (editor toolbar) puts the pristine copy of the open
  script back without restarting. Restarting Provincia does the same for all of
  them.
- If the error names a line that looks fine, such as the closing half of a
  multi-line `if (...)`, the damage is in the lines *above* it.

## Things the simple editor depends on

The simple (form) editor finds values in the scripts by their exact text, so a
few shapes must stay as they are when you edit the Python by hand:

- **Sets are one-liners**: `FULL_TIER_LEVELS = {"town", "large_town", …}` — the
  editor reads from `NAME = {` to the closing brace on that line.
- **The bump rule** must contain the literal expression
  `settlement_tier >= (min_tier + 1)` exactly once. The no-bump branch is
  deliberately written without parentheses (`settlement_tier >= min_tier`).
- **`BUMP_EXCEPTIONS`** entries use the editor's own format:
  `    "chain": [{"resource": "x", "min": N}, {"fertility": N}],`
- A dropdown shows a value it does not know *as that value* and keeps it on
  save. If a dropdown shows something you did not expect, check the script
  before saving the panel.

## How the rules fit together

- A settlement must normally be **one tier above** a building's own minimum to
  receive it (the bump). `NO_BUMP_LEVELS`, the per-chain `BUMP_EXCEPTIONS` and
  the global `FERTILITY_SKIP_BUMP` waive that extra tier — never the building's
  own `settlement_min` from the building file.
- `FULL_TIER_LEVELS` / `BUMP_EXCEPTION_LEVELS` limit which settlement sizes the
  richer rule applies to. Removing a size from `BUMP_EXCEPTION_LEVELS` switches
  off **both** the per-chain exceptions and the fertility skip for that size.
- Region names may contain hyphens and `&` (`Qart-Khadasht`). Any new pattern
  that reads a region must allow them: `[\w&-]+`, not `\w+`.
- Most steps of the master run call the step's own script. Two —
  Sanitation and Slave Placer — are still carried inside `master_processor.py`,
  so a change to those has to be made in both places until they are unified.

## After a run

Check the run's changelog and decisions files in `processed_output\` before
using **Save back to mod**. That button copies the newest output over the mod's
`descr_strat` (a copy of each replaced file goes to `_backups\` first). After
retagging regions or resources, delete the mod's `map.rwm` so the game rebuilds
it.
