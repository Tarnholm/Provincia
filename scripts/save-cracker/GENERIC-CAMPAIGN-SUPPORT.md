# Generic Campaign Support — Provincia Save Parser Design

Per user directive (2026-05-17): Provincia must work with **vanilla, BI, Alexander, and any mod**. The save format is shared across all RTW campaigns/mods — only the data dictionaries differ.

## What the cracker decoded is universal

These findings apply to **any** RTW Remastered save file regardless of campaign or mod:

| Field | Location | Meaning |
|---|---|---|
| Magic | `0x00..0x04` | `0a 07 00 00` (Feral Remastered) |
| Campaign path | UTF-16 pstr16 near `0xdf3` | e.g. `"campaign/imperial_campaign"`, `"campaign/alexander"`, mod path |
| Year | `0x514` (vanilla) | i32 negative for BC |
| Section type registry | `0x500..0xde0` | 106 type names + counts |
| Settlement-owner table | `0x1190..0x14a0` | 12-byte records, static config |
| Diplomatic relations | `0xcff0..0x1943f` | 380 records × 115 bytes (vanilla) |
| Settlement records | starts ~0x19500 | walked via `default_set` markers |
| Unit records | starts ~0x37000+ | type ASCII + region pstr16 + 1000+ bytes state |
| Player faction array | `0xe80, 0xed8` | 21 u32 flags, player has 0 |

### Settlement record structure (universal)
```
[stats block 583 bytes]
[name pstr16 UTF-16]
[N-byte gap]               ← VARIES per campaign (18=vanilla, 19=Alexander, unknown for BI/mods)
[pstr16_asciiz "default_set"]
[61-byte header: u32 self-ptr, u32 uuid, fc canary, u32 X, u32 Y, ...]
[building list: N × (pstr16_name + 78 bytes)]
[trailer with 0xff bytes]
```

### Stats block fields (universal offsets within the 583-byte block)
```
+0   owner faction-id (live ownership)
+12  settlement level (1-6)
+148 public order (0-100)
+456 income per turn
+548 population
```

### Per-building 78-byte data (universal)
```
+0..3  hash/UUID
+4     tier within category (0-N depending on EDB)
+25    settlement sequence index (file-position-related)
+33    0x64 constant (=100)
+50    section tag (0x15)
+76    cultural-origin flag (1=matched, 2=neutral, 3=foreign, 255=N/A)
```

## What VARIES per campaign/mod (load from data files)

### From `descr_strat.txt`
- Faction list (and their order = faction-index mapping)
- Starting denari per faction
- Starting settlements per faction
- Starting buildings per settlement
- Starting characters/armies
- Faction_creator (revolt-to-faction) per region
- Starting diplomatic relations

### From `descr_regions.txt`
- Region → settlement_name mapping
- Region triangle coordinates / boundaries

### From `export_descr_buildings.txt` (EDB)
- Per-category building level chain (e.g. `core_building` has 5 tiers in vanilla EDB but might be 6 in a mod)
- Per-building requirements, costs, capabilities
- Building category names (mods can add new categories like Alexander's `despotic_law`, `academic`)

### From `descr_sm_factions.txt`
- Culture per faction
- Faction display name
- Faction color, symbol, etc.

### Format variations
- **Vanilla**: 18-byte gap between name pstr16 and `default_set`
- **Alexander**: 19-byte gap
- **BI**: unknown — likely 19 or 20
- **Mods (RIS)**: previously seen 18-byte gap

The robust approach: try gap sizes 18-25 and pick the one that produces a valid name pstr16.

## Detection algorithm for Provincia

```javascript
function loadCampaignData(saveBuf) {
  // 1. Read campaign path from save header
  const campaignPath = readCampaignPath(saveBuf);
  // e.g. "campaign/imperial_campaign", "campaign/alexander",
  // "campaign/barbarian_invasion", "campaign/ris_imperial"

  // 2. Resolve to game data folder
  const dataRoot = resolveGameDataRoot(campaignPath);
  // for mods: data root might be different (e.g. RIS uses mod folder)
  // For vanilla: <RTW>/Contents/Resources/Data/data/world/maps/campaign/imperial_campaign/
  // For Alex:   <RTW>/Contents/Resources/Data/alexander/data/.../campaign/alexander/
  // For BI:     <RTW>/Contents/Resources/Data/bi/data/.../campaign/barbarian_invasion/
  // For RIS mod: typically inside a mod folder

  // 3. Load required files (with fallback to base data if mod doesn't override)
  return {
    descr_strat: parseDescrStrat(dataRoot + '/descr_strat.txt'),
    descr_regions: parseDescrRegions(dataRoot + '/../base/descr_regions.txt'),
    edb: parseEDB(dataRoot + '/../export_descr_buildings.txt'),
    descr_sm_factions: parseSMFactions(dataRoot + '/../descr_sm_factions.txt'),
  };
}
```

## What Provincia main.js needs to do

1. **Detect campaign type** from the save's campaign-path string
2. **Locate the campaign's data files** (vanilla / alexander / bi / mod-specific)
3. **Parse the data files** to get:
   - faction-index → faction name (e.g. `18 → "spain"` in vanilla, but different in BI/Alex/mods)
   - building category + tier → building name
   - region → settlement name
4. **Use generic cracker logic** for binary parsing (no hardcoded faction-ids or building names)
5. **Display campaign-appropriate UI**:
   - vanilla shows Roman factions
   - Alexander shows Macedon/Persians
   - BI shows late-Roman factions
   - mods show whatever the mod defines

## Code pattern: avoid hardcoded campaign-specific knowledge

❌ Bad (hardcoded to vanilla):
```javascript
const FACTION_NAMES = { 18: 'spain', 7: 'carthage', ... };
if (factionId === 18) showSpainUI();
```

✅ Good (data-driven):
```javascript
const factionIndex = readFactionIndex(saveBuf, settlementOffset);
const factionName = campaignData.factions[factionIndex].name;
showFactionUI(factionName);
```

## Status

The cracker findings are GENERIC. The Provincia parser code (in `main.js`) needs to:
1. Load campaign-specific data files dynamically
2. Use those for naming/display only
3. Use cracker findings for binary parsing universally

See [[feedback_no_hardcoded_factions]] memory and `feedback_no_hardcoded_factions.md`
for the user directive on this from 2026-05-16.
