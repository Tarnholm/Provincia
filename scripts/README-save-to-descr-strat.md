## save-to-descr-strat — Continue Campaign as New Campaign

Turns an RTW save into a fresh `descr_strat.txt` so the user can start a
new campaign with the late-game state intact, sidestepping the 65,536
entity-cap that makes very long campaigns crash.

### What's extracted from a save

| Item | How |
|---|---|
| Settlement ownership per faction | `saveOwnershipParser.resolveCurrentOwners` |
| Per-settlement buildings + EDB-validated level names | `buildingParser.parseSettlements` + EDB parse |
| Settlement level (village..huge_city) | inferred from `core_building` level |
| Building queues >50% done | auto-completed to next level |
| Living characters (name, age, position, traits, role) | `characterParser.findCharacterRecords` + culture markers |
| Faction attribution per character | `captain_card_<faction>.tga` marker scan |
| Per-character army composition (units + xp + armour + weapon upgrades) | `unitParser.findUnitRecords` grouped by `commanderUuid` |
| Family relationships (parent/spouse/children) | spouse/child UUID cross-refs |
| Ancillaries with proper names | `export_descr_ancillaries.txt` lookup |
| Real current treasury per faction | `parseFactionTreasuries` mapped via `descr_sm_factions` order |
| Diplomatic relations (wars, alliances) | `parseDiplomacyMatrix` + relaxed locator for RIS imperial |
| Character position fallback (governors, leaderless factions) | leader → faction-mate → `map_regions.tga` settlement coords |
| Synthesized leaders for orphan factions | name token from `descr_names_lookup` + faction's first settlement coords |

### Documented limitations

| Item | Why it's not extracted |
|---|---|
| Female character names | `characterParser` only finds male generals reliably; `parseCharacterExtras` finds female records but they don't carry names |
| Per-settlement religion as `religion` lines | extracted as 6-byte arrays but emitting requires knowing the mod's religion-order list (not in bundled mod) |
| Diplomacy on non-RIS-imperial saves | relaxed matrix locator works for RIS but not earlier-format saves (Bactria T964, Dummies T900); falls back to "no diplomacy emitted" rather than false positives |
| In-progress building queues <50% | descr_strat format doesn't support partial-build state |
| Campaign script state (Lua counters) | scripts restart on a new campaign; introductory events may re-fire |

### Scripts

| Script | Purpose |
|---|---|
| `save-to-descr-strat.js` | the main extractor + emitter |
| `validate-descr-strat.js` | structural validator + cross-reference checker against bundled-mod EDB/EDU/EDCT |
| `deploy-descr-strat.js` | copy generated file into a campaign dir + auto-backup the original |

### Typical workflow

```sh
# 1. Generate descr_strat from a save
node scripts/save-to-descr-strat.js "C:/Users/vtarn/Downloads/save_item limit bug.sav"
# → derived/save_item limit bug.descr_strat.txt   (~2.8 MB)

# 2. Validate structurally
node scripts/validate-descr-strat.js "derived/save_item limit bug.descr_strat.txt"
# → 0 errors / 0 warnings expected

# 3. List candidate campaign folders to deploy to
node scripts/deploy-descr-strat.js --list-targets

# 4. Deploy into a target (backs up the original)
node scripts/deploy-descr-strat.js \
  "derived/save_item limit bug.descr_strat.txt" \
  "C:/Users/.../RIS beta/data/original_overrides/.../imperial_campaign"

# 5. Launch RTW, start NEW imperial_campaign, pick faction, play.

# 6. If anything breaks, rollback to original:
node scripts/deploy-descr-strat.js --rollback "<same target>"
```

### One-shot workflow

```sh
node scripts/save-to-descr-strat.js \
  "C:/Users/vtarn/Downloads/save_item limit bug.sav" \
  --deploy "C:/Users/.../RIS beta/.../imperial_campaign"
```

### Per-save stats (T1017 RIS imperial)

```
197 factions emitted (all have at least a leader, real or synthesized)
1232 settlements with buildings + inferred levels
2133 characters (1980 real + 153 synthesized for orphan factions)
1271 units across army blocks
227 factions with real current treasury
507 wars + 503 alliances as diplomatic_stance lines
27 family relationships + 4 character_record entries
709 ancillary lines (named via EDA)
0 validator errors / 0 warnings on 96k-line output
2.80 MB total
```

### Pre-generated outputs

`derived/` already contains generated descr_strats for:

* `save_item limit bug.descr_strat.txt` (T1017 — the bug-trigger save)
* `save_Autosave   Dummies   Turn 900 End.descr_strat.txt`
* `save_Autosave   Dummies   Turn 960 Start.descr_strat.txt`
* `save_Autosave   Dummies   Turn 1018 Start.descr_strat.txt`
* `save_Autosave   Bactria   Turn 964.descr_strat.txt`

Pick whichever save corresponds to the campaign you want to continue.
