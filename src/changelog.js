/**
 * Changelog entries, newest first.
 * Each entry: { version, date, items: [{ type, text }] }
 * Types: "feature", "fix", "improvement", "change"
 *
 * Display versions only — the 4th segment in package.json (e.g. "0.9.2.10") is a
 * silent iteration counter for test builds and is stripped before gating/display.
 */
const CHANGELOG = [
  {
    version: "0.9.116",
    date: "2026-04-24",
    items: [
      { type: "fix", text: "Map-mode pill (top-left) no longer overlaps the Resources panel. Removed minWidth:64 per button, tightened padding to 3×8 and font to 0.76rem, dropped the 'Map:' label, widened the wrap budget. All 9 mode buttons fit on one row at 1920px." },
      { type: "improvement", text: "Region-info bottom bar uses a fixed 2×10 (=20 slot) buildings column — the real max a settlement can hold — and flexes Recruitable + Garrison to fill the remaining width. Grid: 240px info | 860px buildings | 1fr recruitable | 1fr garrison." },
      { type: "fix", text: "Resources panel width 250px, 2-column grid, max-height capped to map height, scrollbar hidden (scrollbar-width:none + ::-webkit-scrollbar display:none). Text no longer truncates for 'livestock', 'olive oil', 'wild animals', etc." },
      { type: "fix", text: "Building icon resolver for chains with no shipped art now falls through to `ui/generic/generic_building.tga` (78×62 card) and `generic_constructed_building.tga` (360×160 banner) — matches what the in-game UI shows for Weavery, Local Garrisons, Perfume Maker." },
    ],
  },
  {
    version: "0.9.112",
    date: "2026-04-24",
    items: [
      { type: "improvement", text: "Icon resolver now parses `data/descr_ui_buildings.txt` — the authoritative file RTW itself uses. Applies the mod-declared per-culture fallback order (e.g., roman → eastern → greek → egyptian) and level-name aliases (e.g., temple_of_battle_shrine → shrine, greek_polis → native_greek, recruitment_center1 → recruitment_center). 22 cultures, 177 aliases on RIS. Replaces my hardcoded fallback list; matches the game's own resolution exactly." },
    ],
  },
  {
    version: "0.9.111",
    date: "2026-04-24",
    items: [
      { type: "fix", text: "Sparta-owns-45-cities bug: faction legend was aggregating by `regions[].faction` (descr_regions line 3 = rebel-default), not descr_strat ownership. Now counts regions per `factionRegionsMap` and rolls unassigned regions into a single 'slave' rebels entry — matches the map coloring." },
      { type: "fix", text: "Campaign-aware faction display names. RIS classic submod now shows 'The House of Claudii' for romans_julii (from ALTERNATE_CAMPAIGN_*_TITLE in campaign_descriptions.txt) instead of the generic expanded_bi.txt label. Mapping: classic → ALTERNATE_CAMPAIGN prefix; imperial → IMPERIAL_CAMPAIGN prefix." },
      { type: "improvement", text: "Building icon resolver rewritten with proper pass order: per-culture per-level → roman per-level → per-culture chain → roman chain → wide `_constructed` banners → cross-culture level/chain → generic fallback. Reproduces the game's own lookup order so the right icon wins over stretched banners or pixelated thumbnails." },
      { type: "fix", text: "Skip vanilla 2567-byte placeholder TGAs under ui/<non-roman>/plugins/ (identical MD5 for paved_roads/mines/treasury/roads/etc). These aren't real art — the game uses the roman equivalent. Now the resolver passes through to the proper 77KB #roman_paved_roads.tga and similar." },
      { type: "fix", text: "Skip per-culture 78×62 in-progress-construction thumbnails in favor of proper 156×124 card icons from roman/. Fixes Local Market, Shipwright, Minor Stone Walls, Governor's Palace etc. showing tiny/stretched icons." },
      { type: "improvement", text: "Cross-culture icon fallback. When neither per-culture nor roman ships art for a chain/level (e.g. Client Kingdom `gov1`), search greek/e_hellenistic/w_hellenistic/etc. for the art. Many chains exist as art only under specific cultures." },
      { type: "fix", text: "Generic building fallback: chains with ZERO per-culture art anywhere (Weavery, Local Garrisons, Perfume Maker — textiles_production / garrison / perfumes_industry) now use `ui/generic/generic_building.tga` (78×62) for the card and `generic_constructed_building.tga` (360×160) for the right-click banner — matches what the game itself shows." },
      { type: "improvement", text: "Building icon dirs extended per culture: ui/<c>/buildings, /buildings/construction, /plugins, /construction. Roman dirs similarly. Finds the real art wherever the mod/game ships it." },
    ],
  },
  {
    version: "0.9.100",
    date: "2026-04-24",
    items: [
      { type: "fix", text: "Added ui/<culture>/construction/ (peer of buildings/, not the nested construction subdir) to the icon scan list. Some per-culture icons live there — e.g. #greek_market.tga. Still the same culture's own art, not a cross-culture fallback." },
    ],
  },
  {
    version: "0.9.99",
    date: "2026-04-24",
    items: [
      { type: "change", text: "No icon fallbacks of any kind. Dropped the cross-culture 'roman' fallback and the generic chain-category fallback. Buildings without a culture-specific TGA render blank, and the log prints 'MISSING ICON: <culture> / <chain> / <level>' for each unresolved case so the real file can be located deliberately rather than masked by an incorrect default." },
    ],
  },
  {
    version: "0.9.98",
    date: "2026-04-24",
    items: [
      { type: "fix", text: "Restore the chain-category icon fallback (0.9.97 over-removed it). Paved Roads, Mines, and every other building relying on the generic 'roads'/'mining'/'farming'/etc. category icon went blank. Category list unchanged — just the 0.9.96-era additions (treasury/waystation/garrison) stay out." },
    ],
  },
  {
    version: "0.9.97",
    date: "2026-04-24",
    items: [
      { type: "change", text: "Removed the chain-category building-icon fallback. Buildings without a real culture-specific TGA now render blank instead of showing a generic placeholder — so genuinely-missing icons are visible and fixable rather than hidden behind a default." },
      { type: "improvement", text: "Building icons are now displayed at 70×56 (matching RTW's 156×124 aspect ratio) instead of 52×52 square. Uses object-fit: contain so nothing is cropped. Card width unchanged — the extra space was already there inside the 82px card padding." },
    ],
  },
  {
    version: "0.9.96",
    date: "2026-04-24",
    items: [
      { type: "improvement", text: "Building icon cards now use object-fit: cover instead of contain, so the icon fills the 52×52 frame instead of being letterboxed inside it. RTW icons are 156×124, so the card art is ~25% visually bigger with only a sliver of side-crop. Card size is unchanged." },
      { type: "fix", text: "Treasury-tier buildings now resolve their icons. RTW stores some building icons in ui/<culture>/plugins/ (treasury, aqueducts, shrines, etc.) instead of ui/<culture>/buildings/. The resolver now scans plugins/ as a secondary directory before falling back to the generic category." },
      { type: "fix", text: "Waystation and garrison buildings now fall back to the generic category icon (waystation→roads, garrison→defense). Treasury also now maps to the 'trade' category as a second-line fallback." },
    ],
  },
  {
    version: "0.9.95",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Tier requirements (mic_tier_N / gov_tier_N / colony_tier_N etc.) are now actually evaluated against the city's built buildings instead of blanket-dropping every recruit that mentions one. EDB parser now also captures `alias <name> { requires building_present_min_level <chain> <level> }` definitions; the recruit filter expands each tier token into its building requirement and checks the chain's current level meets it. Athenian General (mic_tier_2) shows again when the city has military_industrial_complex at mic_2 or higher; still hidden when it doesn't." },
    ],
  },
  {
    version: "0.9.94",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Recruitable list now drops units gated by conditions the app can't evaluate from a static save: major_event (player-triggered reforms — 'athenian tarentine cavalry' needs athens_reforms_2), hidden_resource (region-specific tags), and tier hidden-resources (mic_tier_N / gov_tier_N / colony_tier_N / culture_tier_N — RIS uses these to lock units behind specific other buildings). Also respects 'not factions { ... }' negative filters. Conservative: under-show rather than over-show to match the in-game recruit panel." },
    ],
  },
  {
    version: "0.9.93",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Recruitable list no longer leaks vanilla recruits through mod overrides. Mods like RIS strip peasants from governors_villa by redefining the level with no recruit lines — but my parser only ran last-wins when the mod source actually had recruit lines, so vanilla's 'greek peasant' etc. survived. Now any (chain, level) the mod source defines (even with zero recruits) replaces vanilla's entry. Athens-on-RIS won't show greek peasant anymore." },
    ],
  },
  {
    version: "0.9.92",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Recruitable units now include lower-tier units from the same chain. RTW chains are cumulative — owning army_barracks lets you recruit hastati/principes/triarii because the militia/city tiers are implicitly satisfied. The panel previously only listed recruits from the EXACT current level, so e.g. Athens with a city-tier barracks would show only the city-tier units, missing the militia recruits. Walks every level up to and including the current one in each built chain. Updates live as buildings upgrade in the save (already wired through getBuildings)." },
    ],
  },
  {
    version: "0.9.91",
    date: "2026-04-23",
    items: [
      { type: "feature", text: "Right-click a unit card → the popup now shows the unit's actual stats from EDU below the card art: soldiers, HP, attack (primary/secondary with weapon type), charge bonus, defense breakdown (armour · skill · shield), morale + discipline, charge distance, recruitment cost / turns / upkeep, replenishment per turn, and category/class. Pulled from export_descr_unit.txt (mod last-wins so RIS overrides vanilla)." },
      { type: "fix", text: "Bundled vanilla armies JSON (armies_classic.json / armies_large.json) is now bottom-up like every other coord source — bundler no longer pre-flips. Means non-imported users on Alexander/imperial campaigns won't see armies upside-down." },
    ],
  },
  {
    version: "0.9.90",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Render y-flip restored. 0.9.88 dropped it because the bundled JSON was pre-flipped; but once you dev-import, armiesData is replaced with raw bottom-up descr_strat data from parseDescrStratArmies, and so are the live-mode armies from the save parser. Flipping at render time is right for every fresh data path. RIS imperial armies should now sit on land." },
    ],
  },
  {
    version: "0.9.89",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "RIS descr_strat armies now parse. Mods like RIS use 'character,<tab>Name, role, age, x, y' with a comma after 'character'; the parser's regex required plain whitespace after the keyword and silently ignored every such line. Result: 0 armies parsed and the Region Info panel's Garrison / Field Army sections stayed empty on imperial imports. Accepting comma-or-whitespace separator fixes both — RIS's descr_strat now yields 906 starting armies through the import pipeline, which feed the settlement-bucketed starting_armies JSON." },
    ],
  },
  {
    version: "0.9.88",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Armies were rendered upside-down on the RIS imperial map. The render was applying a y-flip meant for raw descr_strat coords, but all the data feeding into it (bundled JSON, dev-imported JSON, cityPixels) is actually already top-down. Dropped the render flip so armies sit at their data's y directly." },
    ],
  },
  {
    version: "0.9.87",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Revert 0.9.84/0.9.86 y-flip 'fixes' — they produced 0 armies because the y convention in the wild is more varied than I assumed. Back to the old behavior (sea-side armies in RIS) until I have a reliable way to detect bottom-up vs top-down per data source." },
    ],
  },
  {
    version: "0.9.86",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Dev-import path now produces armies with the same top-down y convention as the bundled JSON. parseDescrStratArmies returns raw bottom-up y (straight from descr_strat); the bundler pre-flips to top-down; the renderer's un-flip assumed top-down. A fresh import (RIS) fed bottom-up armies into a code path tuned for top-down, double-un-flipping them. Now the import flips before saving/setting state so both paths agree." },
    ],
  },
  {
    version: "0.9.85",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Building icons for governor tiers (gov1-gov4) and similar chain-less levels now fall back to the generic chain-category icon. The preload bridge was dropping the chainName argument when calling resolveBuildingIcon, so the category fallback (government, infantry, trade, etc.) never ran — buildings with no culture-specific TGA showed as blank. Also extended the category matcher so bare 'govN' level names map to 'government'." },
    ],
  },
  {
    version: "0.9.84",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Non-live armies were being rendered with their y axis inverted — the bundled armies JSON was pre-flipped to top-down coords by the bundle step, and the canvas renderer then applied its own flip meant for raw bottom-up data from the save. Net effect: armies placed on sea tiles. Now the memo un-flips bundled entries (and the descr_strat fallback path) so both non-live and live armies share the same bottom-up convention before the single render flip." },
    ],
  },
  {
    version: "0.9.83",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "RIS (and other mods with a large faction list) now get their culture/display info through. Two IPC calls in the renderer — getFactionCultures and getFactionDisplayNames — were dropping the modDataDir argument, so the main process fell back to parsing only vanilla+BI+Alexander (~41 factions, ~51 display names). RIS's 239 factions including greeks/paphlagonia now load, so the 'NO CULTURE for X' warnings and the generic building icons on modded factions should be gone." },
    ],
  },
  {
    version: "0.9.82",
    date: "2026-04-23",
    items: [
      { type: "change", text: "Garrison header layout matches the field-army sections: 'Garrison:' then a small character line underneath ('Vaumisa of Tagae — Persia') rather than parentheses on the header. Consistent with 'Region owners armies' / 'Other faction armies'." },
    ],
  },
  {
    version: "0.9.81",
    date: "2026-04-23",
    items: [
      { type: "feature", text: "Stack-end detection. The save has two marker flavors: [ffffffff][0x15][uuid] opens a new stack, and [ffffffff][0x15][0] ends the previous one (garrison defenders follow). Previously only the opening form was recognised, so commander-less units trailing Alexander's 16-unit stack kept inheriting his uuid and never showed up as the actual city garrison. Now Pella's 2 trailing hoplites land in the garrison bucket as expected." },
      { type: "improvement", text: "Garrison header now names the governor when one commands the stack (e.g. 'Garrison (Vaumisa of Tagae):' instead of just 'Garrison:'). Builds off the existing settlement-tile rule." },
      { type: "fix", text: "Faction labels in Region info now use the display name from the campaign's expanded_bi.txt (parsed, not hardcoded), so the Alexander campaign's 'parthia → Persia' remap comes through — 'Memnon of Rhodes — Persia' instead of 'parthia'." },
    ],
  },
  {
    version: "0.9.80",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Army faction labels. Stacks now inherit the commander's actual faction (from the save's character record) instead of being guessed from unit ownership. Parmenion's hoplites can be recruited by greek_cities too, but Parmenion himself is macedon — label now says 'Parmenion — macedon' rather than 'greek cities'. Same for Persian/parthia armies." },
      { type: "fix", text: "Unit icons for macedon-faction armies should now resolve correctly since the faction used for the icon lookup is macedon (matching the folder name ui/units/macedon/) rather than greek_cities." },
      { type: "fix", text: "Governor detection. A commander standing exactly on the settlement tile is a governor and his stack IS the garrison. Vaumisa at Halicarnassus now groups with the garrison instead of appearing as a separate field army. Alexander at Pella is NOT on the settlement tile, so he stays a field army as expected." },
    ],
  },
  {
    version: "0.9.79",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Ordering bug: 0.9.76 added inferredCmd to the unitsByRegion payload, but the code that SETS inferredCmd (the sequential-grouping pass) ran AFTER the unitsByRegion serialization — so every unit shipped to the UI with inferredCmd=null. Moved the serialization to after the grouping pass. Self-verified on turn-1 save: Parmenion gets 9 units, Memnon 19, Vaumisa 9; Lydia garrison now empty instead of 37. Should be the end of 'all units bundled as garrison while generals stand alone'." },
    ],
  },
  {
    version: "0.9.78",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Live mode: 0.9.77 found stack markers but the v2-to-charactersByRegion merge still resolved each commander's region by raw unit.commanderUuid — which is null for captain-stack units — so captain commanders never reached the RegionInfo's uuid-to-character lookup. The garrison filter then kept every un-looked-up unit as 'garrison' because their commander uuid was unknown to the UI. The region lookup now uses the same stack-marker pre-pass to find each commander's region, so captains actually land in charByUuid and their units classify as field armies. Adymos's stack should now appear as a separate field army under 'Region owners armies' at Pella." },
    ],
  },
  {
    version: "0.9.77",
    date: "2026-04-23",
    items: [
      { type: "feature", text: "Stack-header marker detection. Each stack in the save (both named-general and captain-led) is preceded by a small marker record of shape [ffffffff][filler=0x15][commander uuid]. Scanning for these — 24 found in the turn-1 Alexander save — gives an authoritative unit-to-stack linkage even for captain armies whose own unit records have no commanderUuid. Adymos's 6-unit captain stack at Pella now shows as a separate field army with his units attached, rather than vanishing into the garbage 'garrison' bucket." },
      { type: "fix", text: "Alexander's army is no longer misclassified as a garrison when he's standing on (or near) the settlement tile. The garrison bucket is now strictly units with no resolvable commander; any stack with an identified general or captain is a field army regardless of position." },
    ],
  },
  {
    version: "0.9.76",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Region panel's Garrison section was swallowing units that belonged to separate stacks in the same region. In the save, most unit records have commanderUuid=null — only the bodyguard of each army carries the real uuid — and the panel was grouping by that raw field, so every non-bodyguard unit fell into the cmd=0 garrison bucket regardless of which stack it was in. main.js already ran a sequential-grouping pass to propagate each stack's commander uuid to its trailing units, but the result wasn't exposed. Now each unit in unitsByRegion carries an inferredCmd field, and the garrison/field-army classification uses it instead of the raw uuid. Alexander's stack shows under Garrison at Pella, Adymos's captain stack shows under Region owners armies as a field army — the two no longer merge." },
    ],
  },
  {
    version: "0.9.75",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Crash fix: RegionInfo's character-list rendering called c.lastName.replace(...) unconditionally. After 0.9.68 merged v2 characters into the region-character list, surnameless leaders (Alexander, Parmenion) carried lastName=null and crashed the renderer. Same class of null-guard bug as 0.9.69 but in a different render path." },
    ],
  },
  {
    version: "0.9.74",
    date: "2026-04-23",
    items: [
      { type: "improvement", text: "Unit cards now show the soldier count as a small overlay at the bottom (was hover-only). Strength bar bumped from 2px to 3px so it's actually visible. Field-army cards in 'Region owners armies' / 'Other faction armies' now also show counts and strength bars (previously only garrison cards did)." },
    ],
  },
  {
    version: "0.9.73",
    date: "2026-04-23",
    items: [
      { type: "feature", text: "Captains and admirals now get their LIVE position straight from the save (no descr_strat fallback needed). The save has three world-object record types each carrying one army's position keyed by commander uuid: type-6 for general bodyguards, type-5 for captain land armies, type-4 for naval armies. Previously only type-6 was used. Diagnostic on turn-1 alexander save: position-match accuracy jumped from 21/57 to 39/57; captains needing descr_strat fallback dropped from 19 to 0. Position now stays correct after captains move (was stuck at descr_strat coords)." },
    ],
  },
  {
    version: "0.9.72",
    date: "2026-04-23",
    items: [
      { type: "improvement", text: "Captain armies now show their unit list. After 0.9.71 placed captains at descr_strat coords, the tooltip still showed 0 units because the save's character record has no units linked. The map composer now borrows the descr_strat unit list onto a save-side army that has no units of its own (turn-1 accurate; later turns get refreshed by save-state updates)." },
      { type: "fix", text: "Restored 1 broken test in src/parsers.test.js — the test was written for an older parseDescrStratArmies API (named armies, character-after-army order). Rewrote with the real descr_strat format (character-then-army, no army name)." },
    ],
  },
  {
    version: "0.9.71",
    date: "2026-04-23",
    items: [
      { type: "fix", text: "Soldier counts now match in-game UI. The save stores only rank-and-file count; in-game totals include any officer/standard/musician defined in EDU. Now those are added — Hypaspists shows 241 (=240+1 standard), Phalangists +1 standard, etc. Cavalry/skirmisher units that have no officer in EDU stay at the rank-and-file count." },
      { type: "improvement", text: "Captains (characters whose own commanderUuid doesn't resolve to a position record) now get filled in from descr_strat by name+faction. At turn 1 this puts every captain on the correct tile (19/19 in the vanilla Alexander campaign) instead of dropping them off the map. The save's positions are still trusted whenever they exist; descr_strat is only a fallback." },
      { type: "improvement", text: "descr_strat parsing in the main process now handles both imperial_campaign and alexander campaign paths, and properly extracts character coordinates (the previous regex was anchored on a comma after 'character' but the file uses a tab — it had been silently parsing nothing for a while)." },
    ],
  },
  {
    version: "0.9.69",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Crash fix: 0.9.68 introduced v2 characters into the region panel's commander lookup, but characters with no surname (Alexander, Parmenion) carry lastName=null — and the army-name builder called .replace on it unconditionally, white-screening the renderer. Now the builder uses only firstName when no surname is present." },
    ],
  },
  {
    version: "0.9.68",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Other faction armies in the region panel now identify their commander. The lookup table fed to RegionInfo only contained v1-parser characters; v2-parser characters (like Parmenion) were missing, so their stacks rendered as '(unidentified army)'. The v2 chars are now merged into the table under their commanderUuid, so named generals from any faction get labeled properly." },
      { type: "change", text: "Renamed 'Your field armies:' to 'Region owners armies:' in the region panel — clearer when reviewing other factions' regions." },
    ],
  },
  {
    version: "0.9.67",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Generic general-bodyguard units (e.g. 'greek general's guard cavalry early') were rejected by the unit parser because its name-char whitelist didn't include the apostrophe. As a result Parmenion's stack showed no units in the hover tooltip — the bodyguard record that carried his commanderUuid was silently thrown away. Apostrophe is now allowed; Parmenion's units (and every other general-bodyguard unit across all factions) now show up." },
      { type: "fix", text: "Unit parser now recognises a second post-region record layout (uuid at +4 instead of +0, soldier counts at +16/+20) used by some bodyguard-style units. Previously those reads picked up a sentinel value and reported commanderUuid=0 with zeroed soldier counts." },
    ],
  },
  {
    version: "0.9.66",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Character records with a lastName (e.g. Thuxra, Darayavahu) were sometimes rejected because one trait entry had an out-of-range level byte. Parser now skips malformed trait entries instead of throwing away the whole record — 4 more characters recovered at turn 1." },
      { type: "fix", text: "Named characters without a surname (Alexander, Parmenion) no longer get a bogus lastName like 'Priska' tacked on. Parser now honours the has-lastName flag byte at +12 before reading the lastName field." },
      { type: "feature", text: "descr_strat armies whose position isn't covered by the save parser (e.g. the captain-led garrisons at Pella and Sparta that the save stores as unnamed unit groups) are now added to the map as synthetic entries tagged descrStratOnly. Armies at initial spawn positions no longer disappear in the live view just because the save didn't preserve their original descr_strat names." },
    ],
  },
  {
    version: "0.9.65",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Save-parser no longer places characters at their neighbor's tile. Previously, when a character's own commanderUuid didn't resolve to a world-object position, a fallback scanned nearby bytes for any type-6 uuid and grabbed the next character's identity uuid instead — producing phantom dots (e.g. Adymos stacked on Alexander's tile at turn 1). The scan now stops 12 bytes before the next record's header and ignores any uuid that belongs to another character. Characters with no resolvable army position now show at no position instead of a wrong one." },
    ],
  },
  {
    version: "0.9.64",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Build pipeline: the dist:win script was only invoking electron-builder, which repackages whatever is already in build/ — meaning several recent installers shipped a stale React bundle and their UI fixes never reached the app. Scripts now chain vite build first. This is also the actual fix for the Armies-toggle bug claimed in 0.9.63 — the source fix was correct but never made it into the installer." },
    ],
  },
  {
    version: "0.9.63",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Toggling the Armies button off and on would sometimes leave the map stuck (armies invisible even with the button lit). The canvas-draw effect was missing showArmies from its React dependency list, so the redraw wouldn't fire on the toggle click — it only happened incidentally when some other state changed. Now the toggle redraws reliably." },
    ],
  },
  {
    version: "0.9.62",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "A garrison that leaves its settlement (per live log) is now re-classified as a field army (was stuck as garrison until the next save). Field armies still upgrade to garrisons when they enter settlements, as before. Navies keep their role-based classification." },
    ],
  },
  {
    version: "0.9.61",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Tooltip now shows a small green (live) tag on save characters whose position has been upgraded from the live log (vs. the older (log-tracked) blue tag which is still used for log-only characters the save parser didn't cover). Quick visual confirmation of whether the dot you're looking at is pixel-accurate or still at the save-time coordinates." },
    ],
  },
  {
    version: "0.9.60",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Save characters now carry their primaryUuid, so save↔log matching can do a direct uuid lookup before any name-based fuzzy fallback. Fixes same-name generals across factions, renamed captains, and cases where save and log spell a lastName differently — the wrong character no longer steals another's position just because their firstName matched first." },
    ],
  },
  {
    version: "0.9.59",
    date: "2026-04-22",
    items: [
      { type: "feature", text: "Live event feed now shows riots and disasters (e.g. 'Suza: riot (968 dead)') and autoresolved-battle outcomes ('Alexander defeated Darius'). Previously the log parsed these but nothing surfaced them to the UI." },
    ],
  },
  {
    version: "0.9.58",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Loading an older save no longer shows future log positions on the map. Events from turns after the save's turn counter are filtered out of the live-override path (exact, log-only, and fallback match lookups). The live-override toggle still works as before — this turn-filter runs underneath it so 'save review' mode is correct by default without you having to disable the override." },
    ],
  },
  {
    version: "0.9.57",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Backfill now handles FLEEING and 'character ptr deleted' events that the incremental poll already recognized. Fewer stale dots for routed characters and for chars the engine cleans up between turns. Live tracking stores charUuid per character so uuid-only deletion events can drop the right map entry even without a name." },
    ],
  },
  {
    version: "0.9.56",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Live-position cache now resets when the log watcher starts (new campaign or game restart). Previously stale dots from an earlier session could linger on the map until overwritten by a fresh move event." },
    ],
  },
  {
    version: "0.9.55",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Every log event now tagged with the turn it happened in (counted via end-round markers). Foundation for the upcoming turn slider — will let you scrub back to 'where was Alexander at turn 50?' without reloading an older save." },
    ],
  },
  {
    version: "0.9.54",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Army markers now have a faction-colored border (was black). Dot fill still indicates class (garrison/field/navy); ring color shows which faction owns the stack — you can see at a glance which of the overlapping armies is yours vs. an enemy." },
    ],
  },
  {
    version: "0.9.53",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Army Types legend now shows live counts per class (Garrisons: N, Armies: M, Navies: K). UI toggle 'Live-log override' added — dim it OFF to view save-only positions when reviewing older saves." },
    ],
  },
  {
    version: "0.9.52",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Hover tooltip shows key traits (Factionleader, GoodCommander, NaturalMilitarySkill, etc.) for scripted characters. Quick visual cue for which stack is commanded by a real general vs. a random captain." },
    ],
  },
  {
    version: "0.9.51",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "More death patterns recognized. Log events of form 'Name(faction:role)(uuid):death_type(DET_XXX)' and 'Name:DYING:start...:death_type(DET_XXX)' now remove the character from the live map. Covers battle-kills, natural death, and disaster death (riots, diseases) — previously only 'army is dead' events triggered removal." },
    ],
  },
  {
    version: "0.9.50",
    date: "2026-04-22",
    items: [
      { type: "feature", text: "User toggle: 'Use live-log positions'. When ON (default), message-log moves override save positions for pixel accuracy during live play. Turn OFF when reviewing older saves to see the save-time positions only (log may contain events from later turns)." },
    ],
  },
  {
    version: "0.9.49",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Hover tooltip shows passenger characters ('with Parmenion, Leocharis') and a '(log-tracked)' badge for armies whose position came from the message log rather than the save file." },
    ],
  },
  {
    version: "0.9.48",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Admirals correctly classified as navy on the map using their log role. Both save-based armies (when a matching log event has role=admiral) and log-only armies (prefix 'Admiral X') now show as blue anchor markers instead of red field dots." },
    ],
  },
  {
    version: "0.9.47",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Log-only armies dedupe by position: when multiple captains are stacked at the same tile, they show as ONE marker with passengers listed on hover (instead of overlapping dots)." },
    ],
  },
  {
    version: "0.9.46",
    date: "2026-04-22",
    items: [
      { type: "feature", text: "Generated captains now appear on the map. The save parser only finds scripted characters (faction leaders + heirs), so generated captains like 'Captain Phranaces' used to be invisible. Now the app synthesizes an army for every character the log tracks that has no save-record counterpart — they appear as 'log-only' armies at their real log-reported positions." },
      { type: "fix", text: "Live-position de-duplication: stored under canonical (firstName|lastNameStub|faction) key only, with runtime fallbacks to same-firstName entries for the lookup. Prevents duplicate dots on the map for the same character." },
    ],
  },
  {
    version: "0.9.45",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Live position lookup robustness: coord bounds validation (ignore bogus log values outside map range), and fallback to first-name-only lookup when save-parser faction is 'unknown'." },
    ],
  },
  {
    version: "0.9.44",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Live position lookup now keys by (firstName, lastName stub, faction) with fallback to just (firstName, faction). Better disambiguates characters with the same first name, e.g. the scripted Waradsin of Pella vs a generated Waradsin captain." },
    ],
  },
  {
    version: "0.9.43",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Dead characters removed from live position overlay. When the log emits an 'army dead' event, the corresponding character's live-tracked position is cleared so stale markers don't linger on the map." },
    ],
  },
  {
    version: "0.9.42",
    date: "2026-04-22",
    items: [
      { type: "feature", text: "Pixel-accurate live positions via message-log tailing. The engine emits a character_move event on every in-game movement; the app now reads those events in real time and overrides the save-parser's heuristic position. When you play turn N, the map shows exactly where each character moved to. On app start, the log is back-filled so positions are correct immediately." },
    ],
  },
  {
    version: "0.9.41",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Accurate character positions. Previously the parser picked the FIRST type-6 uuid found in a character's record region — often wrong (e.g. picking Pella's settlement uuid for Parmenion when his real army was in Lydia). Now uses commanderUuid (at record_start-8) as PRIMARY source — verified via diff experiment showing Alex's (11,49)→(16,55) move maps to his commanderUuid's type-6 record. Parmenion now correctly at (17,44) with Leocharis as passenger (was wrongly at Pella)." },
    ],
  },
  {
    version: "0.9.40",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Army composition better balanced. Instead of stopping at first region-mismatch, the parser now SKIPS non-matching-region units and continues scanning — so Alexander's stack includes all his Macedon-region units (not just the first contiguous block). Turn 13 Alex now 9 units (was 3/12/115)." },
    ],
  },
  {
    version: "0.9.39",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Every bodyguard in the save becomes an army (was missing 3 of 37 before). Armies without a matched character are tagged 'unknown commander' but still appear on the map at the correct position." },
    ],
  },
  {
    version: "0.9.38",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Army composition filtered by region. Within a faction's unit block the save stores multiple armies sequentially — now each bodyguard's region establishes the army boundary, so units in a different region belong to a different army/garrison. Memnon at Turn 13 now shows his correct 20-unit Lydia army (was 43 incl. Bactria + Parapamisadale forces)." },
    ],
  },
  {
    version: "0.9.37",
    date: "2026-04-22",
    items: [
      { type: "improvement", text: "Army size closer to reality. Instead of arbitrary 20-unit cap, armies now end at either the next commander's bodyguard OR a large file-offset gap (>10K bytes = faction boundary). Alex at Turn 13 now shows 12 units (was 115 raw / 20 capped). Matches his 16-unit starting army minus 4 combat losses." },
    ],
  },
  {
    version: "0.9.36",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Army unit count capped at 20 (RTW's stack limit). Previously field armies and their settlement's garrison were being merged into one 100+ unit super-army because they share the same commander-UUID in the save. Now each army shows its real-sized stack." },
    ],
  },
  {
    version: "0.9.35",
    date: "2026-04-22",
    items: [
      { type: "fix", text: "Live armies: characters are now grouped by their army's commander-UUID OR position, so stacked characters appear as one army on the map with the real general as leader and others as passengers (e.g. Alexander at Pella with Parmenion as passenger)." },
      { type: "fix", text: "Leader priority: Factionleader > Factionheir > most-traits > file-order. Prevents trait-less false-positive characters from displacing the real general." },
      { type: "improvement", text: "Position fallback via commanderUuid: faction leaders stationed at their capital (like Alexander at Pella) now resolve to the settlement's coords even when their record doesn't directly contain a position-record UUID." },
    ],
  },
  {
    version: "0.9.34",
    date: "2026-04-22",
    items: [
      { type: "feature", text: "Live armies on the map! Save-parsed armies now replace the descr_strat starting state when viewing a save. Each army shows commander, faction, age, and full unit composition on hover." },
      { type: "improvement", text: "Armies classified per-save: navy (all units are naval_*), garrison (at a settlement tile), field (elsewhere). Previously the Live overlay incorrectly reused starting-state classifications." },
      { type: "improvement", text: "Units grouped by commander via sequential linking — each commander's bodyguard opens the army block, subsequent commander-less units belong to it. Fixes the 'one unit per army' bug where Live mode showed only bodyguards." },
      { type: "fix", text: "Save character parser: discovered pre-record commanderUuid at record_start-8 that matches unit.commanderUuid (was using the wrong uuid field previously)." },
    ],
  },
  {
    version: "0.9.33",
    date: "2026-04-22",
    items: [
      { type: "feature", text: "Save character parser rewritten (v2) after decoding the RTW character-record layout. Finds 36-143 characters per save (vs. 5-6 false positives before), with correct names, birth year, age, traits, portraits, and x/y positions." },
      { type: "improvement", text: "Current in-game year and turn number now read directly from the save header (offsets 3968/3972). Ages computed as current_year - birth_year — verified against descr_strat ground truth (Alex age 26 at Turn 13 ✓)." },
      { type: "improvement", text: "Character gender heuristic: males have traits, females (wives/daughters) have none. Parser now tags both and includes females (wives/daughters) that were previously invisible." },
      { type: "improvement", text: "Added messageLogParser that reads VFS/Local/Rome/logs/message_log.txt for live events (trait gains, battles, army moves) — parses 7235 events across 17 event types." },
    ],
  },
  {
    version: "0.9.7",
    date: "2026-04-20",
    items: [
      { type: "feature", text: "Buildings are now live-accurate in Live Mode. The settlement parser was rewritten after a user demolish experiment revealed that chain records come BEFORE the settlement name in the save (inverted from prior assumption) — each settlement's actual built buildings are now correctly identified." },
      { type: "improvement", text: "When you demolish a building in-game, the hover panel's Buildings list updates to match (the chain record is removed from the save)." },
      { type: "fix", text: "Player faction detection re-runs every save, not just once. Starting a new campaign as a different faction is now picked up automatically instead of sticking on the previous faction." },
    ],
  },
  {
    version: "0.9.6",
    date: "2026-04-19",
    items: [
      { type: "feature", text: "Live mode region hover panel now lists characters present in each region with their ages, leader/heir status, and alive/dead state — decoded directly from the save file" },
      { type: "improvement", text: "New save-file parsers reverse-engineered from scratch: characters (names, traits, family tree, portraits, region assignment via bodyguard unit) and units (soldier counts, region, commander linkage). See calibration/ for the research notes." },
      { type: "improvement", text: "Character data is faction-aware: faction leaders and heirs are marked with 👑 and ★ based on their in-save Factionleader/Factionheir traits, not heuristics" },
    ],
  },
  {
    version: "0.9.5",
    date: "2026-04-17",
    items: [
      { type: "feature", text: "Live mode region hover panel now shows 'In Construction' — the building chain currently being built in that city, read directly from the save" },
      { type: "improvement", text: "Save parser rewritten after reverse-engineering the save format: construction queue extraction is now reliable for new chains (no more false positives for existing chains like irrigation or market)" },
      { type: "change", text: "Disabled the heuristic 'recently completed buildings' merge until the chain-hash-to-name mapping is in place — starting-state buildings come from mod data as before" },
    ],
  },
  {
    version: "0.9.4",
    date: "2026-04-17",
    items: [
      { type: "fix", text: "Live mode no longer replays historical log entries — activation is a clean slate and only forward-going turns get tracked. Fixes the 'ghost turns' that appeared for fresh installs on machines with existing Rome Remastered logs." },
      { type: "fix", text: "Hover panel no longer overrides starting buildings with save-file data until you've actually ended a turn — prevents false positives from the heuristic save parser on fresh campaigns" },
      { type: "feature", text: "Live mode now detects or asks for your faction (auto-fills from the autosave filename when possible, falls back to a faction picker). Shows 'As: <faction>' next to the Live button, click to change" },
      { type: "feature", text: "Region hover panel shows the live garrison/army (unit names, soldier counts, chevrons) when live mode is active" },
      { type: "improvement", text: "Save-file parser extracts unit experience chevrons + weapon/armor upgrades in addition to soldier counts" },
      { type: "improvement", text: "Live mode activation now surfaces a toast with the detected log folder path so it's obvious what's being tracked" },
    ],
  },
  {
    version: "0.9.3",
    date: "2026-04-17",
    items: [
      { type: "improvement", text: "Faster launch: the Vite build system replaces the old bundler — 10× faster dev iteration and a smaller install footprint" },
      { type: "improvement", text: "Cleaner internals: the UI code is split into smaller modules (mute button, update banner, toasts now live on their own)" },
      { type: "fix", text: "Dropped 31 npm dependency vulnerabilities carried over from the old build system" },
    ],
  },
  {
    // The 4th segment is a silent "edition" counter — bump it to force the
    // changelog to reappear once after adding new items to an existing version.
    // The UI strips it (users see "v0.9.2"), and gating uses it for comparison.
    version: "0.9.2.1",
    date: "2026-04-17",
    items: [
      { type: "feature", text: "Auto-updates: checks for new releases on startup and installs them on restart" },
      { type: "feature", text: "Non-fatal errors now surface as dismissable toasts instead of failing silently" },
      { type: "feature", text: "Mute toggle for the startup sound — speaker icon in the bottom-right, muting silences but doesn't interrupt the track" },
      { type: "feature", text: "Bundled faction icons so the first launch has visuals before any mod is imported" },
      { type: "improvement", text: "Duplicate faction colours in the legend now show a warning icon listing which factions share a colour" },
      { type: "improvement", text: "TGA map decoding moved to a Web Worker — no more brief UI freeze on campaign switch" },
      { type: "improvement", text: "Mod-file parsers consolidated into a shared module with unit tests" },
      { type: "improvement", text: "Upgraded Electron to 41.2.1 and electron-builder to 26.8.1" },
      { type: "improvement", text: "Build now auto-bundles the latest RIS mod files from C:\\RIS" },
      { type: "fix", text: "First-run onboarding cards show correctly after reinstalling over a previous version" },
      { type: "fix", text: "Changelog no longer re-appears every time you switch campaigns" },
      { type: "fix", text: "Auto-updater 404/offline errors no longer pop as toasts (only real failures do)" },
    ],
  },
  {
    version: "0.9.1",
    date: "2026-04-16",
    items: [
      { type: "fix", text: "Imported faction colours now survive an app restart (previously reverted to bundled colours)" },
    ],
  },
  {
    version: "0.8.7",
    date: "2026-04-15",
    items: [
      { type: "feature", text: "First-launch walkthrough and version changelog screen" },
      { type: "feature", text: "Onboarding highlights relevant UI elements as you step through" },
      { type: "fix", text: "Faction colours now always load from the latest imported data" },
    ],
  },
  {
    version: "0.8.4",
    date: "2026-04-14",
    items: [
      { type: "feature", text: "Added Armies map mode showing garrisons, field armies, and navies" },
      { type: "improvement", text: "Campaign import now auto-detects faction icons directory" },
    ],
  },
  {
    version: "0.8.3",
    date: "2026-04-12",
    items: [
      { type: "feature", text: "Resource map mode with category filtering" },
      { type: "feature", text: "Pin regions for quick access" },
      { type: "improvement", text: "Screenshot export now includes colour mode in filename" },
    ],
  },
];

export default CHANGELOG;
