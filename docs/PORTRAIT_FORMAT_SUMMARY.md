# Portrait Crack — 2026-05-18

## TL;DR

**Cracked.** 103/109 greek generals in `save_macedon t0.sav` resolved to unique portrait paths.

## How

Each character has a 354-byte "extended record" in the save (starts at `0x171301b`, stride `354`). At offset **+280** is a u32 **portrait UUID**. The portrait pool entries are u32-prefixed with this same UUID, followed by the pstr16 portrait path 72-74 bytes later.

```
character.extended_record:
  +0   own_uuid
  +280 portrait_uuid  ← THIS

portrait pool entry:
  ...other character data...
  pstr16 cards/young/generals/149.tga
  pstr16 portraits/young/generals/149.tga
  u32 portrait_uuid ← matches character's +280
  ...
```

To resolve a character → portrait path:
1. Find extended record (first u32 occurrence of own_uuid in `[0x1500000, role_string_pos)`)
2. Read u32 at `extRecord + 280` → portrait_uuid
3. Find that u32 elsewhere in the save
4. The pstr16 portrait path is 72-74 bytes before the match

## Sample output

```
Akarnania       age=60  +280=b2b48bfc  → young/generals/149.tga
Acheloos        age=56  +280=326d31cf  → old/generals/089.tga
Akarnania       age=24  +280=98ef4716  → young/generals/162.tga
Leukas          age=24  +280=ac59b8a8  → young/generals/102.tga
Akragas         age=60  +280=908229c0  → old/generals/104.tga
...
```

103/109 matched, 95 unique portraits, 8 reused (pool of 188 with 109 chars → expected). 6 unresolved likely = captains or different record format.

## Next

1. Plumb `portrait_uuid + path` per character via `saveCrackerExtras.js` → `characterExtras` → `FamilyTree`.
2. When a save is loaded, FamilyTree uses save's path directly (bypasses DJB2 hash fallback).
3. Drop the captains-and-stuff fallback to hash (only 6 chars in this sample).

Working extractor: `scripts/save-cracker/dig-portrait-CRACKED.js`
