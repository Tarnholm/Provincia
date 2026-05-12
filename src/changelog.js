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
    version: "0.9.322",
    date: "2026-05-12",
    items: [
      { type: "feature", text: "Resources is now a toggleable view overlay — stack resource icons on top of any colorMode (Faction + Resources, Culture + Resources, Geography + Resources, etc.) instead of having to switch out of your current map mode. The dedicated 'Resources' colorMode is still there and unchanged; the new toggle button in the view-options bar shows the same icons without the side-panel/filter UI." },
    ],
  },
  {
    version: "0.9.321",
    date: "2026-05-12",
    items: [
      { type: "feature", text: "Borders button is now tri-state — cycles off → Faction Bdrs (thin per-region lines + thick faction-group outline) → Region Bdrs (per-region lines only, no faction outline). Mirrors the Labels button's cycle behaviour. State persists across sessions." },
    ],
  },
  {
    version: "0.9.320",
    date: "2026-05-12",
    items: [
      { type: "feature", text: "Terrain overlay toggle — Geography is now a layer you can stack on top of any colorMode (Faction + terrain, Culture + terrain, etc.) instead of only as a standalone mode. Translucent 55% tint so the underlying map mode still reads. Independent toggle button in the view-options bar; remembered across sessions. Same TGA + palette as the standalone Geography mode." },
    ],
  },
  {
    version: "0.9.319",
    date: "2026-05-12",
    items: [
      { type: "feature", text: "New Geography map mode — colours every tile by its actual ground type (Forest, Mountain, Swamp, Rocky, Sand, etc.) decoded from the mod's `map_ground_types.tga`. Forest = ambush spots, Mountain = impassable, Swamp = slow. 14 terrain types, full palette coverage verified across the Imperial campaign (no unknown colours). Bundled per-campaign and lazy-loaded the first time the mode is activated so boot stays fast (the TGA is ~8 MB)." },
    ],
  },
  {
    version: "0.9.318",
    date: "2026-05-12",
    items: [
      { type: "feature", text: "Recruitment queue surfaced in the region panel. Each settlement's `default_set` chain has an optional 35-byte recruit entry with the unit's name inline (e.g. \"roman leves\"); the recruitable card gets a green REC badge + outline when its unit is currently being trained there. Decoded from session 36 of the save cracker." },
      { type: "feature", text: "Construction queue surfaced in the region panel. 53-byte building queue entry decoded from the same `default_set` body — shows `Building: chain #N — K turns` above the Buildings grid. Chain-ID → name resolution still TBD (no crackable mapping yet); 'chain #8000' for now until a corpus pins it." },
      { type: "feature", text: "Boarded ships now visually distinct on the map. Naval markers gain a bright yellow inner dot when a fleet carries at least one boarded character or army unit (session 37 schema: each boarded UUID-prefix appended to the ship's passenger array, count u16 bumped). Hover tooltip reads `⚓ carrying N passengers`." },
      { type: "improvement", text: "queueParser scans defensively: tight body bound via the next chain's preamble + chainId duplication check kills false positives across all 1,310 settlements in a 35 MB save. Tested clean across save_1.2..save_4.2 (no queue, BUILDING queue, RECRUIT queue, queue cleared) — only the genuinely-queued settlement matches." },
    ],
  },
  {
    version: "0.9.317",
    date: "2026-05-12",
    items: [
      { type: "fix", text: "Found the actual root cause of the parser hang. Log showed `[ERROR] [save-watch] parse error: Cannot set properties of null (setting 'initialOwnerByCity')` — main.js was trying to assign `lastSaveData.initialOwnerByCity = ...` when `lastSaveData` was null (parseSaveData returned null on certain saves). The throw escaped, the finally cleared `_reparsing`, but subsequent state was corrupted in a way that hung future parses. Added null-checks before all three `lastSaveData.X = ...` assignments in the save-watch and characters-init flows." },
      { type: "improvement", text: "Watchdog timeout on `reparseLatestSave` — if a reparse hasn't completed in 120 seconds (which is >2x the longest legitimate parse we've observed), force-clear `_reparsing` and kick off the next queued reparse. So even if a new unhandled hang slips through in future, the queue self-recovers instead of locking forever." },
      { type: "improvement", text: "Reparse error log now includes the stack trace (was just `.message`), making future hangs easier to diagnose." },
    ],
  },
  {
    version: "0.9.316",
    date: "2026-05-12",
    items: [
      { type: "fix", text: "30-second timeout on the parallel character + building workers. User saw post-conquest saves (save_11.1, save_13.1, Turn 2 Start) sit forever in 'queued (reparse already in progress)' state because one of the workers stopped responding — without a timeout the `await charsP` blocked indefinitely and the renderer kept showing pre-conquest data. Now: if a worker doesn't return within 30s, fall back to null and let parseCharactersAndUnits run its synchronous path. Side benefit: also unblocks any save with a structural feature we haven't seen before that trips the worker." },
      { type: "note", text: "(0.9.315's tileToRegion hypothesis was wrong — Brundisium doesn't border Taras as I assumed. The real cause was the parser hang above, which left the renderer on pre-march data where Aulus was still at Tarentum. The 1-tile-city-neighbour check is harmless and still ships, but isn't load-bearing.)" },
    ],
  },
  {
    version: "0.9.315",
    date: "2026-05-12",
    items: [
      { type: "fix", text: "Conqueror's army now resolves to the conquered settlement's region, not the surrounding territory. Diagnosed from the user's save_Turn 2 Start: Aulus is at (342,386), 1 tile WEST of Brundisium's city pixel (343,386). The pixel at (342,386) is Taras-region territory (since Brundisium sits at the eastern edge of the Salentine peninsula), so tileToRegion's direct sample said 'Taras' — even though Aulus had just captured Brundisium. Reordered tileToRegion to check 1-tile city neighbours BEFORE the direct pixel sample: if you're standing next to a city pixel, you're at THAT city's region. Same applies to any 'just captured / just arrived at city' scenario." },
    ],
  },
  {
    version: "0.9.314",
    date: "2026-05-12",
    items: [
      { type: "fix", text: "Conquered settlements no longer show the dead-defender's marker. User report: after capturing Brundisium, the map still showed Titus (the original Messapian governor per descr_strat) as a separate Messapian army at the city tile, even though he died in the battle. Cause: the bundled-armies synthesis dedupes only by character NAME and exact coord — when the defender's character is gone from the save entirely, neither dedupe matches. Now: if any save-army of a DIFFERENT faction sits at or within 1 tile of the bundled army's coord, the bundled synth is skipped (the defender is gone, the conqueror is here). Verified against Brundisium where Aulus's live coord drifted 1 tile from Titus's exact city pixel." },
      { type: "fix", text: "Conqueror's army marker now becomes a garrison circle (yellow) when sitting on the captured settlement tile, instead of staying a field-army diamond (red). main.js's liveArmies build hard-codes armyClass=field for any non-navy army; the renderer now reclassifies to garrison post-hoc when the army's (x,y) is at or within 1 tile of a settlement tile. Same 1-tile tolerance for live-log coord shifts." },
      { type: "improvement", text: "Removed the temp Characters-row diagnostic (provincia.log [char-diag] lines) — issue was resolved in 0.9.311." },
    ],
  },
  {
    version: "0.9.313",
    date: "2026-05-11",
    items: [
      { type: "improvement", text: "Extended the temp Characters-in-Uria diagnostic to also dump what armiesToRender has for any Aulus-named entry (character / firstName / originalLastName / region / x,y). Click Uria after updating, then send me the [char-diag] line from provincia.log." },
    ],
  },
  {
    version: "0.9.312",
    date: "2026-05-11",
    items: [
      { type: "improvement", text: "Temp diagnostic: when you click Uria (or any Salentinia region) and the Characters row is still empty, the app now writes a one-line summary to provincia.log showing what the renderer actually sees (filtered count, incoming count, sample of save chars in Taras, sample of liveRegionByCharName keys for that region). Lets us pin down the remaining miss without more guess-and-ship cycles." },
    ],
  },
  {
    version: "0.9.311",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Characters row in a conquered region now actually populates. 0.9.310 added the inbound-character pass, but the live path bailed out with `return null` BEFORE the pass ran when the region's save-time char list was empty. After Aulus conquered Uria, the original Messapian governors were displaced — saveCharactersByRegion[Salentinia] was empty — so the function exited early and Aulus never got pulled in. Now treats an empty list as [] and falls through to the incoming pass." },
    ],
  },
  {
    version: "0.9.310",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Two follow-ups after the duplicate-marker fix. (1) The 'bodyguard currently at Taras' message in the garrison commander block was a lie: it was reading the stale unit-record region tag, which never updates on move. Now reads from liveUnitsByRegion (which re-buckets armies on settlement tiles per 0.9.305), so a governor whose bodyguard moved with him reports the correct region and the misleading sub-message disappears. (2) The Characters row now correctly lists characters who moved INTO this region. The renderer's inbound-character pass now also matches by birth name (originalLastName), propagated through to saveCharactersByRegion. So Aulus Messapivs the Wallbreaker (renamed from Aulus Gabinius via traits) shows up in Uria's Characters list after he conquered it." },
    ],
  },
  {
    version: "0.9.309",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "0.9.308 dedupe-by-birth-name still didn't fire because main.js's leader object didn't propagate `originalLastName` from the v1 character record. So saveLiveArmies entries shipped with `originalLastName: null` even when the parser set it correctly. The renderer's birth-name dedupe then fell back to the (trait-renamed) lastName — `Aulus Messapivs` vs the bundled `Aulus Gabinius` → no match → synthetic marker still added. main.js now propagates v1.originalLastName onto the armyMap leader object. Verified via standalone parse of save_3: Aulus Gabinius (uuid 0xa77c10f) carries `RomanConquerorMessapians:2` trait → renamed to Messapivs. Birth lastName `Gabinius` is now preserved end-to-end." },
    ],
  },
  {
    version: "0.9.308",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Dedupe by BIRTH name (originalLastName), not display name. After conquering Uria + gaining the RomanConquerorMessapians cognomen + Wallbreaker nickname, Aulus Gabinius's displayed name became `Aulus Messapivs the Wallbreaker`. The 0.9.306/307 dedupe matched display names, so `Aulus Gabinius` (bundled descr_strat) ≠ `Aulus Messapivs the Wallbreaker` (current save) → both got rendered as separate markers. Now the renderer keys saveLiveArmies entries under their birth lastName (preserved by main.js as `originalLastName` exactly for this case), so the bundled descr_strat synth correctly dedupes against the current save record even when the display name changed via traits." },
    ],
  },
  {
    version: "0.9.307",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "0.9.306 still showed the duplicate Aulus marker because the dedupe check looked at `d.character` but bundled `armiesData` entries write the name to `d.name` (the bundle script uses both forms inconsistently). The undefined check skipped the dedupe entirely, so the synthetic marker still got added. Now accepts either field — should be the last needed dedupe fix." },
    ],
  },
  {
    version: "0.9.306",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Generals no longer show duplicate markers on the map after moving away from their descr_strat starting tile. User report: after Aulus marched from Taras to Uria and occupied it, the map showed him at BOTH his current Uria position AND his original Taras spawn. Cause: the descr_strat synthesis loop in armiesToRender deduped only by coordinate, not by character name. Save_3 has Aulus at (340, 384), bundled JSON has him at (337, 385) — different coords, so a synthetic marker got added at the bundled position even though the save already had him at the new one. Now: dedupe by (character + faction) as well as coord, so a character present anywhere in saveLiveArmies skips the synth entirely." },
    ],
  },
  {
    version: "0.9.305",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Armies sitting on a captured settlement tile now correctly appear in that region's panel, not their pre-move region. User report: after Romans Julii conquered Uria, Aulus's units still appeared in Taras's region panel (his starting location). Cause: the engine doesn't update a unit-record's `region` field when its general moves — only the separate world-object position record updates. The map marker uses world-position (correct), but the region panel was using the stale unit-record region tag. The 0.9.282 fix prevented general-purpose region overrides because save coords can drift 1-3 tiles off settlement markers into adjacent regions, but settlement TILES specifically are unambiguous (exact pixel match). Now: when an army's (x, y) matches a known settlement-tile EXACTLY, the live-bucketing uses the army's resolved region instead of the stale unit-record tag. Live-log overrides still take precedence; non-settlement positions still keep their save region tag (no drift risk)." },
    ],
  },
  {
    version: "0.9.304",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Region owner now reflects the loaded mod's descr_strat, not the dev-bundled `regions_large.json`. User report: Uria showed `romans_julii` in the app even though the current RIS descr_strat puts it under messapians (Salentinia is a settlement they OWN, not a homeland claim). The bundled JSON was generated against an older mod state and never updated when the mod changed. Now: the renderer overlays `initialOwnerByCity` (parsed at runtime from the LOADED mod's descr_strat) onto each region's `faction` field. Any future descr_strat edit picks up automatically as soon as you reload the mod. First step toward the broader `nothing hardcoded` direction — the regions, factions, and ownership data are still bundled but the bundled JSON is now an override-able fallback, not the source of truth." },
    ],
  },
  {
    version: "0.9.303",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "Live tracking now resets when you click the Live button, not just when a save snapshot lands. Clearing passenger lists / unit-flow / char positions, re-anchoring the log watcher to current EOF — same logic as the auto-reset on save. So if you load Provincia mid-game, the live view starts clean instead of replaying old session state." },
      { type: "fix", text: "Characters-list filter now keeps trait epithets (`the Eagle`, `the Drunkard`, etc) when matching across armiesToRender ↔ saveCharactersByRegion. 0.9.302 stripped them on one side only, so any general with an epithet was invisible to the move filter and got stuck in their save-tagged region. Also registers the BIRTH name (pre-epithet) as a fallback when the army entry was constructed before the trait fired." },
      { type: "fix", text: "Merged army roster now sorts bodyguard units first. After Marcus merges into Aulus, both bodyguards (one for each general) lead the unit list instead of being scattered into file-order. Bodyguard = unit with a real `commanderUuid` (foot units have `commanderUuid: null` and inherit via `inferredCmd`). User report: 'one bodyguard at the start, one at the end — they should both be first'." },
    ],
  },
  {
    version: "0.9.302",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Characters list is now bidirectional with live moves: chars who left appear nowhere (already done in 0.9.297), AND chars who arrived show up in the destination region. After Marcus merges into Aulus's stack in Taras, Marcus's name should now appear in Taras's Characters row (with traits / ancillaries pulled from the save char record) — not stuck in Metapontion and not missing entirely. Applies to both the live path (saveCharactersByRegion) and the descr_strat starting fallback." },
    ],
  },
  {
    version: "0.9.301",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Critical: save parser was silently crashing with `ReferenceError: bodyguard is not defined` whenever a save snapshot was processed. The `bodyguard` const was declared inside one for-loop's scope but referenced from a separate later loop where it had no value. The try/catch wrapping the parser hid this — instead of erroring loudly it just bailed out and emitted '0 characters, 0 units'. Result for the user: saveCharactersByRegion / saveLiveArmies never populated, so every live feature added in the last few versions (merge re-bucketing, character move filtering, hover-tile merge, etc) appeared completely broken. Each commit was correct in isolation; nothing reached the renderer because the parser threw on every save. Fix: use the inner loop's own commanded units to grab the bodyguard. Apologies for the chase." },
    ],
  },
  {
    version: "0.9.300",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "Same-tile merge now uses the live log's `transferring general(X) ... to named general(Y)` event directly instead of relying on coord-equality. Verified against the user's actual message_log: Marcus's EXCHANGE move puts him at (337,385) — same tile as Aulus — and the transfer event names both generals explicitly. The renderer now builds a Map<donor_secondaryUuid → target_secondaryUuid> from the flow snapshot's `fromName` / `toName` fields (matched against saveCharactersByRegion by firstName+lastName), and the region panel's mergeByTile + the map hover tooltip both group entries by (faction, merge-target) when present. Coord-equality is kept as a fallback for cases the flow tracker didn't capture (mod reload mid-merge, etc). Result: Aulus + Marcus merged stack shows as one entry with 15 units in both the region panel and the hover tooltip, even when the engine's coord resolution is off by a tile." },
    ],
  },
  {
    version: "0.9.299",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Same-tile army merge logic is now lenient about exact pixel-coords. After a live-log merge (Marcus → Aulus), the engine can leave the two bodyguards 1-2 tiles apart visually even though they're one logical stack, so the strict (faction, x, y) match in 0.9.298 missed them. Now: exact-coord match runs first as before; then a second pass merges any remaining live-tracked entries of the same faction within the same region. The same fallback applies to both the map hover tooltip AND the region panel's 'Other faction armies' section. Result: Aulus + Marcus merged stack should now show as one combined entry with 15 units in both surfaces." },
    ],
  },
  {
    version: "0.9.298",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Map army hover tooltip now applies the same-tile merge that the region panel already does. RTW stacks can hold multiple generals + their bodyguards (Marcus + Aulus = one army of 15 in-game), but the save records each general's bodyguard as a separate cmd-grouped army. Previous tooltip showed only the hovered general's own army (e.g. Aulus 14 units), now it sums all same-faction same-coord armies and lists their combined commanders + unit roster (e.g. 'Aulus Gabinius + Marcus Livius Drusus — 15 units')." },
    ],
  },
  {
    version: "0.9.297",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Characters who've moved out of their save-tagged region (per the live log) no longer appear in the old region's Characters list. User report: 'Marcus Livius Drusus' still showed under Metapontion's Characters even though he'd merged into Aulus's stack at Taras. Now both the live path and the descr_strat starting fallback check armiesToRender's live-resolved region for each char — if it's different from the panel's region, the char is dropped. (Live-region info comes from the same source that already moves the map dot when a character moves.)" },
    ],
  },
  {
    version: "0.9.296",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Sidebar panel order is now consistent across all map modes: map-mode context panels (Factions / Culture / Religion legend, Settlement legend, Homeland, Resources) always at the top; Army Types always at the bottom. Previously in resource map mode the Resources panel rendered AFTER Army Types, so it appeared below the Army stack — inverted compared to every other map mode where the map-mode legend sat on top. Same panels visible, same toggles; just consistent ordering." },
    ],
  },
  {
    version: "0.9.295",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Settlement hover tooltip's Y coordinate now matches the in-game `show_cursorstat` console output. User report: Riusiava tooltip showed y=198 but in-game says pos 258, 501 — that's because the tooltip displayed the TGA-pixel (top-down) Y instead of the descr_strat-native (bottom-up) Y. Display now flips via `imgHeight - 1 - tga_y` (the same convention the save-cracker dossier records). Internal coord math is unchanged — only the displayed value in the tooltip flips, so live unit positioning stays accurate." },
    ],
  },
  {
    version: "0.9.294",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Resource map mode panel now joins the sidebar stack instead of overlapping the Factions legend. 0.9.292 missed the Resources panel because it lived in its own `renderResourceFilter()` function with its own absolute positioning, separate from the wrapper that already held Factions/Homeland/Army Types. Now it renders inside the same flex-column wrapper. Wrapper width bumped from 220px → 240px to match Resources panel's content needs." },
    ],
  },
  {
    version: "0.9.293",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Merge re-bucketing now works for the recipient even when they don't emit MOVING_NORMAL log events. 0.9.291's bridge required both donor and recipient to have a known faction (captured from MOVING_NORMAL); for a merge like Marcus → Aulus, only Marcus emits a move (Aulus stays put), so the recipient bridge always failed and no units flowed. Now: tier 1 still uses the strict (firstName, lastName, faction) match when faction is known; tier 2 falls back to (firstName, lastName) only IF that pair is unique across the entire save char list. Aulus Gabinius is unique by name in any RIS save, so the bridge resolves. The collision safeguard from 0.9.271 (no first-name-only fallback) still applies — only the LASTNAME-combined pair is accepted, not bare first names." },
    ],
  },
  {
    version: "0.9.292",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Right-side overlay panels (Factions legend, Homeland legend, Army Types) no longer overlap. All three (plus the settlement legend when shown) now stack vertically in a single sidebar container with hidden-scrollbar overflow, so multiple can fit on screen without overlapping. Each panel has its own collapse toggle (▶/▼ chevron next to the title) — click the title to minimize. Visibility is still map-mode-relevant: Homeland only shows in homeland mode, Army Types only shows when the Armies toggle is on AND there are armies, etc." },
    ],
  },
  {
    version: "0.9.291",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "Live log tracking is now SAVE-RELATIVE: every time a save snapshot lands, the log watcher re-anchors to the current end of message_log.txt and drops all live tracking state (passenger lists, unit-flow, char positions). Save state is authoritative for everything that's already happened; the log is only useful for events that happen AFTER this save. The previous backfill-from-EOF + accumulate forever pattern was reading old game-session entries when you loaded a save mid-Provincia-session and applying them on top of the new save's reality — which was wrong. User asked for this directly: 'it should only need logs for the states between saves; the rest should be parsed from the saves'. Spot-on architectural call." },
      { type: "feature", text: "New 'Reset' button next to Stats (only visible when Live is on) — manual override that re-anchors the log watcher to current EOF without needing to save in-game. Use after loading a save mid-session if for some reason auto-reset didn't fire (and tell me — that's a bug)." },
      { type: "feature", text: "Live unit-flow re-bucketing is BACK after being reverted in 0.9.272. When you merge Marcus's stack onto Aulus, the foot units should now visibly transfer to Aulus in the region panel without waiting for a save. Safer reattempt: main.js tracks the donor's full name on each transfer event (via the message_log's `transferring general(X)` line), and the renderer bridges runtime char uuids → save secondaryUuids ONLY via strict (firstName, lastName, faction) triple match. If either side can't bridge unambiguously, the flow is skipped — no first-name-only fallback that caused the Uria flood. Donor's foot pool is also region-guarded: only foot units in the donor's bodyguard region donate." },
    ],
  },
  {
    version: "0.9.290",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "When the save says a settlement has a governor but our v1 char pool can't decode that uuid (timing race during load, or an RIS-imperial auto-generated character whose record format v1 doesn't recognize), the Garrison commander line now falls back to the descr_strat starting commander's name + faction + age, instead of the unhelpful '(governor — character record not decoded)'. Accurate at turn 1, useful as a 'started here as' hint at later turns." },
    ],
  },
  {
    version: "0.9.289",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Region panel no longer goes empty during the save-parse gap right after clicking Live. Previously: user clicks Live → liveLogActive flips to true → the live data paths (garrison, fieldArmies, characters, garrisonCommander) gate on liveLogActive and bypass the non-live fallbacks → save takes 2-3s to parse → in the gap, all four panels return null. Now each of those props checks 'is the live data actually loaded yet?' separately, and falls back to descr_strat starting data when not. Once the save lands, live data takes over automatically. User reported this as 'units in Taras disappear after going live'." },
    ],
  },
  {
    version: "0.9.288",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "0.9.287 added a Characters row to non-live mode but it never showed up in regions like Tarentum because the runtime descr_strat coord-match filter rejected everything — bundled coords are TGA-snapped (e.g. Milon @ 336,384) while descr_strat raw coords are different (e.g. 168,191). Switched to a firstName+faction merge instead: bundled per-region structure stays as the index, runtime descr_strat trait data overrides per-character when present. Generals + traits now appear in non-live mode for Tarentum, Rome, every populated region. Right-click on a name to see the trait popup." },
      { type: "fix", text: "Garrison commander name now shows in non-live mode (e.g. 'Milon — taras' in Tarentum). Previously the Garrison Commander block was gated on liveLogActive and returned null without a save loaded, so the garrison-units list appeared with no commander attribution. Now pulls from the bundled starting_armies JSON's first garrison entry." },
      { type: "change", text: "Stats button moved next to the Live button at the top of the panel, and only renders when Live mode is active. Was previously next to Wealth in the bottom toolbar where it didn't belong — Wealth works without a save, Stats doesn't. Pairing it with Live makes the dependency obvious." },
    ],
  },
  {
    version: "0.9.287",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "Generals + their starting traits, ancillaries, age, and leader/heir tags now show in the region panel WITHOUT a save loaded. The Characters row labels itself '(starting)' instead of '(live)' to make the source clear, and right-click on a character still opens the trait popup (now reading from descr_strat instead of the save). Live-save data still takes precedence whenever it's available; descr_strat is the turn-0 fallback. First step in the broader 'live features should work in non-live mode' direction — more to follow." },
      { type: "improvement", text: "Starting-character data is now parsed at RUNTIME from the loaded mod's descr_strat, not baked in at build time. This means generals' traits will reflect whichever mod you've loaded — vanilla, RIS, a workshop download, or your own work-in-progress mod with edits to descr_strat. Nothing about character traits is hardcoded anymore. main.js's `loadModCharacterData` was extended to capture multi-line trait/ancillary records (the lines that follow each `character` header), and a new `get-starting-characters` IPC exposes them to the renderer; the bundled JSON remains as a fallback for the dev build's pre-shipped campaign." },
      { type: "fix", text: "Stats button no longer just grays out when no save is loaded — clicking it now opens a small popover explaining 'No save loaded — open Live to start monitoring your saves folder'. Reachable so the user knows the button exists, doesn't lie about being broken." },
    ],
  },
  {
    version: "0.9.286",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "New 'Stats' button next to Wealth — opens a Campaign Stats panel that surfaces the save's lua persistent-counter table (decoded by save-cracker session 23, rtw-sav-parser format `[u32 nameLen][UTF-16LE name][u32 value]` ~5300 bytes near EOF). RIS imperial has 115 counters; the panel groups them into Military (num_battles_*, num_mercs_recruited_*), Reform progress (per-faction Marian-style unlock counters), Rebellion state (script-driven regional revolt counters), Capital, Misc, and Campaign (turn_number + setup flags). 60 `id_<faction>` lookup-constant hashes are hidden by default — they're identity tags, not stats. Button is disabled until a save is loaded." },
    ],
  },
  {
    version: "0.9.285",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "Character popup now lists CHILDREN (resolved to names). Decoded by save-cracker session 13 CONFIRMED: children's primary UUIDs sit in a 4-slot array at character record +54..+66 (LAYOUT_A) / +50..+62 (LAYOUT_B). 218/218 parent-child hits verified in Rome T1, byte-identical reproduction across game sessions. Children's names are resolved via a global primaryUuid lookup built from saveCharactersByRegion. Slot order is by birth; dead children preserve their slot leaving garbage uuids, which are dropped from the displayed list (we only show children we can resolve to a parsed character)." },
    ],
  },
  {
    version: "0.9.284",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Settlement governor armies now show in their own city's panel. User report: Tarentum (Taras region) showed 'Garrison: (governor — character record not decoded) — Taras / No units stationed / Field armies: None' even though the save has 21 units in the region (Greek governor + 6 foot + Roman invasion stack). Root cause: the captain_card_<faction>.tga marker fallback misattributed Tarentum's Greek governor as `syracuse` faction (his bodyguard record sits inside a syracuse-marked block in the save file), so the panel's sameFaction(commander, regionOwner) check failed and his 7 units were filtered out. 0.9.258's re-attribution guard was protecting parked own-faction generals but accidentally skipping governors of mis-attributed factions. Now: when an army's commanderUuid matches a settlement-governor uuid, override the captain_card-derived faction with that settlement's actual owner. Applied to all three re-attribution call sites (reparseLatestSave, initial saveWatchStart, characters-init)." },
      { type: "feature", text: "Per-unit XP, weapon, and armour upgrades now read directly from the save (save-cracker session 10 CONFIRMED: u8 at unit-record regionEnd +20 / +17 / +16). Previously these were seeded from descr_strat turn-0 values by unit-name FIFO match within region — missed mid-campaign recruits, multi-unit name collisions, and just-fought chevron gains. Verified across the Macedon T13→T14 corpus: 3 phalangists units gained chevrons in the inter-turn AI rotation, picked up correctly by the parser. The descr_strat seed remains as a fallback for cases where the save value is 0/missing." },
    ],
  },
  {
    version: "0.9.283",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Building display-name lookup now tries the `chain_<token>_<tier>` ordering RIS imperial uses for the colony chain (e.g. `colony_italic_2`), in addition to the existing `<level>_<culture>` form government chains use (`gov2_roman`). Without this, the colony chain (RIS's Roman provincial governance system) was falling back to the bundled JSON's generic 'Large Colony' instead of the mod's localized 'Colony 2 - Italic'. User report: 'Provincia (direct rule) building not showing up in Venusia' — the building IS there as `colony_2` at level index 1, but the display label was wrong. Tries the resolved culture token first, then a fallback list of common RIS ethnicity tokens (italic, italiote, hellenic, celtic, iberian, germanic, ...). Note: Venusia at turn 1 has NO governmentA-D chain yet — the player still needs to construct one. The colony chain is what represents 'Roman provincial' status." },
    ],
  },
  {
    version: "0.9.282",
    date: "2026-05-11",
    items: [
      { type: "fix", text: "Stationary armies no longer drift into adjacent regions' panels. User report: Rome's panel showed 'Field armies: None' with only 2 units in Garrison, but Rome actually has 3 Roman generals + 12 foot units in the save. Cause: the live-region re-bucketing was overriding the save's unit-region tag with `tileToRegion(army.x, army.y)` for EVERY army in armiesToRender — including ones whose position came purely from the save's world-object record. Quintus Ogulnius_Gallus (governor of Rome) sits at (285, 404), 1-3 tiles off Rome's center pixel; the RGB at his exact coord resolves to a NEIGHBOURING region, so his 13 units bucketed out of Rome's panel even though their save region tag was `Roma`. Now the override only fires when the army's position came from a live-LOG event (`liveTracked=true`); save-only positions keep their original unit-region tag. Marcus/Aulus merge+split tracking still works (synthesized passenger moves are live-tracked)." },
    ],
  },
  {
    version: "0.9.281",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "Character popup now shows the clan-head / cognomen family link. Decoded by save-cracker session 8 (STRONG): u32 at character record +18 is a name-lookup index pointing to the character's Roman gens / patron family (verified Aulus Gabinius + Marcus Livius_Drusus both point to `Cornelius_Scapula` in save_rome6/7). Most characters have a 0xffffffff sentinel here; only those explicitly bound to a clan (via adoption, marriage, sworn loyalty, or specific trait gain) carry a real value. Subtitle also got fine-grained age precision (4-turns-per-year) when the engine's +86 u16 timer reads consistent with the integer age — 96.8% of chars match (the 3.2% with raw=0 fall back to integer years to stay safe)." },
    ],
  },
  {
    version: "0.9.280",
    date: "2026-05-11",
    items: [
      { type: "feature", text: "Army hover tooltips now show `· moved this turn` when the general has already issued a move action. Decoded in save-cracker session 4 (cross-validated in session 2): bit 7 of the byte at character-position record +9 flips from 0 to 1 on movement, resets at turn start. Lets you see at a glance which armies still have actions to spend." },
    ],
  },
  {
    version: "0.9.279",
    date: "2026-05-10",
    items: [
      { type: "feature", text: "Character right-click popup now shows ANCILLARIES alongside traits. Decoded by save-cracker session 6: ancillaries live inline in the character record between the trait block and the portrait paths, as zero or more `[u16=0, u16=ancId]` pairs followed by a `[u16=0]` sentinel. ID is the 0-based position of an `Ancillary <name>` line in the mod's `export_descr_ancillaries.txt` (1092 entries in RIS imperial). Cross-validated against rome1..rome10: lists are stable across saves and turn boundaries, change only when an ancillary is gained (Hanno's 51,55 → 51,55,170 at turn 5→6). Sample on save_rome10: Hannibal carries `prophet_carthage1` + `priest_of_Baal_Hammon` (thematic!), Hanno has `pontic_noble` + `hellene_wife`. 65 chars with ancillaries in save_rome10. Retracts session 4's 'terminator marker' interpretation — that was just the portrait length prefix overlapping with the last trait slot's flag bytes." },
    ],
  },
  {
    version: "0.9.278",
    date: "2026-05-10",
    items: [
      { type: "feature", text: "Faction Wealth panel now shows LIVE treasury per faction (denarii in coffers right now), not just the descr_strat starting wealth. Decoded by save-cracker session 5: the save contains a flat 23-record array of major factions with a unique structural signature (+8 == 100, +12 == 1, +24/+40 self-pointers). Treasury sits at +0 of each record. CONFIRMED across 14 saves in 4 campaigns: every Saka T1 starting denarii matches descr_strat byte-for-byte, Ptolemaic stable at 20000 mid-turn → jumps to 32083 at turn 6 boundary, the user's romans_julii went bankrupt (-3137) at rome7. Each row tooltips with the start-of-turn snapshot when available, letting the user see mid-turn net delta (income minus upkeep so far). Negative values render red. Gated to RIS imperial-campaign saves (the descr_strat major-faction order was only verified for that ruleset)." },
    ],
  },
  {
    version: "0.9.277",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Character death detection now reads the proper death-marker u32 instead of a single byte. Save-cracker session 4 confirmed bytes +30..+33 of every character record carry a sentinel that flips from 0 to 0xfffffef7 (=-265 i32) on death — witnessed on two independent same-turn deaths. The previous heuristic read byte +34 (LAYOUT_A) / +30 (LAYOUT_B) as 'dead if >= 0xf0', which happened to work for LAYOUT_B (byte 0 of the marker) but was reading an unrelated byte for LAYOUT_A. The full u32 check is layout-agnostic — dead characters now drop reliably from the panel for both Roman and Greek characters." },
    ],
  },
  {
    version: "0.9.276",
    date: "2026-05-10",
    items: [
      { type: "feature", text: "Region info panel now shows three new fields from the save: SIZE class (live, reflects upgrades — village / town / large_town / city / large_city / huge_city), per-turn INCOME in denarii (with cumulative total alongside), and the existing Population row. All read directly from the save via offsets decoded by the background save-cracker session 3 — pushed exhaustive coverage of the ~3728-byte settlement record from 4 known fields to 9+ identified, ~90% byte-classified overall. Sample on save_rome10: Capua (city) 400 d/turn, 2270 total; Brundisium (large_town) 266 d/turn; Uria (town, just captured) 133 d/turn. Income/size gated to player-owned settlements (the offset was only verified for those)." },
    ],
  },
  {
    version: "0.9.275",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Captured settlements no longer permanently hide their roster. The 0.9.267 wipe-filter (drop defenders from a settlement's panel during the live moment between SUCCESSFUL_ASSAULT and the next save snapshot) was sticky — once Taras was wiped earlier in the campaign, every subsequent unit at Taras region was filtered out forever, even after a save refresh, even when the user's own army moved in to occupy. User report: Aulus's 14-unit army at Taras showed 'No units stationed' in the panel despite the hover tooltip correctly listing all 14 units. Both the `liveAssaultWipedSettlements` Set and the `liveDeadCharUuids` Set now reset on every fresh save snapshot — those were stale-save guards that should expire as soon as the save catches up. Live captures + deaths still drop units in real time between events." },
      { type: "improvement", text: "Army hover tooltip now shows which region the marker resolves to (`in <region>`). Helps disambiguate when a marker visually sits near a boundary — the user can confirm which region's RegionInfo panel will show the army's roster." },
    ],
  },
  {
    version: "0.9.274",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Movement-points readout was getting set on EVERY variant-A unit (4161 of 4161 on Turn 2 Start), almost all reading as exactly 128.0 — the f32 at +4 is a common engine constant (0x43000000) for non-bodyguard records and the [0,1000] sanity clip was too loose. Now: only reads MP when commanderUuid looks like a real char uuid (non-zero, non-0xffffffff), and the accepted range is tightened to [10, 500]. Verified on save_rome10: only 793 units now have MP set (all bodyguard records labelled 'roman general' / etc.), values in the realistic 170-225 range." },
      { type: "feature", text: "Live settlement population shows in the region info panel — read directly from the save (u32 at settlement_name_offset-1494). Decoded by the save-cracker (session 2): 18/18 cross-validated against descr_strat starting pops, and diverges from start as turns advance (growth/decay events apply). Shows under the existing Pop Cap line, so you see both the cap (e.g. 'level 9, ~13,500') and the current live count (e.g. '9,000')." },
    ],
  },
  {
    version: "0.9.273",
    date: "2026-05-10",
    items: [
      { type: "feature", text: "Public order percentage now shows in the region info panel for player-owned settlements. The background save-cracker session decoded a settlement happiness f32 sitting at `settlement_name_offset - 30` in the save (triple-validated against the Sparta tax-triple — it's the only byte in any settlement record that changes between tax levels, scales -25 per level). Raw save value is roughly 100..200; mapped linearly to a 0-100% bar with a green/yellow/red traffic light at 60/30 cutoffs. Verified on save_rome10: Capua 205→100%, Volsinii 185→85%, Uria 135→35% (just captured, post-conquest unrest). Same player-faction gate as the tax row — only renders when the settlement belongs to the player." },
      { type: "feature", text: "Movement-points remaining now shows on the army hover tooltip. Decoded from a f32 at `bodyguard_unit.commanderUuid + 4` in the save (triple-validated: save_rome5→save_rome6 has one Roman general moving 1 tile and this float dropped by exactly -7.425; same value mirrored at character-position record +50). Sanity-clipped to [0, 1000] in the parser to reject false positives on non-bodyguard variant-A unit records (which have unrelated data at +4). Shown as 'MP remaining: 231.1' in green under the army header line." },
    ],
  },
  {
    version: "0.9.272",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Reverted 0.9.271's unit-flow override in the renderer — it caused 100+ units (across multiple unrelated factions) to flood into Uria's panel. Suspected combo of weak runtime→save char matching (first-name-only fallback for chars that never emitted a MOVING_NORMAL with a surname) plus Pass 2's pre-existing phantom-attribution (save_rome10 has a single 'greek general' record at cmd=266b0168 with 763 commander-less foot units file-order-attached to it — a known Pass 2 trade-off, but the override sat on top and amplified the misattributions). main.js's flow tracking + IPC plumbing is kept so we have the data ready for a more conservative reattempt: probably needs faction tagging on char records, Pass 2 region-aware attribution, and only flowing within explicitly-named character pairs. The 0.9.270 split-detection that breaks the passenger relationship is unaffected and still works." },
    ],
  },
  {
    version: "0.9.271",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Unit rosters now re-bucket live when units are transferred between armies — Marcus's split-off from the merged Marcus+Aulus stack now correctly shows Marcus with 14 units at Brundisium (his bg + 13 foot ex-Aulus) and Aulus with 1 unit at Uria (his bg only), instead of the save state's 1/14 distribution. Why the workaround: the engine's runtime memory uuid for a unit has no stable mapping to a save unit (save units are identified by file offset, no field matches the runtime pointer), so we can't say 'unit X moved from save-Aulus to save-Marcus' by identity. Instead main.js tracks the COUNT of units flowing between each pair of leaders (`unitFlowFromTo`) from every transfer event in the log, and the renderer applies it as a foot-unit pool donation: for each (from, to, count) entry, take N foot units (commanderUuid==null, attached via Pass 2 inferredCmd) from save-from-leader's roster and relabel them to save-to-leader. Bodyguards never donate — they stay with their general by identity. A per-donor cursor keeps multiple flows from the same source from double-donating. Renderer maps runtime char uuid → save secondaryUuid by name (via liveCharPositions, which has both runtime uuid and full name from MOVING_NORMAL events, joined to saveCharactersByRegion's stored names). Off-by-one is possible if a general-transfer drags an extra bodyguard count, but the visible delta is ±1 unit at most and a save flushes it." },
    ],
  },
  {
    version: "0.9.270",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Army splits now break the passenger relationship — when Marcus splits off the merged Marcus+Aulus stack to siege Brundisium, Aulus's marker should STAY at Uria with his lone bodyguard, not follow Marcus to Brundisium. Reading the user's message_log, the split sequence is: (1) Marcus's BESIEGE-to-Brundisium fires with a NEW army_uuid (926eb860) — different from the previously merged army's uuid (812f01b0); (2) THEN the `transferring general(Marcus:X) ... to named general(Marcus:X):army(NEW)` self-transfer line documents the split. So the new army_uuid is the FIRST signal of a split, and it appears on the move event itself — we can't wait for the self-transfer to fire because the move propagation already happened. main.js now tracks the last seen army_uuid per character and clears the passenger list on a mismatch BEFORE fanout. The transfer handler also updates the tracking on a merge so the next move with the merged army's uuid doesn't trip the split detector. Self-transfer in setPassenger is also guarded — without it Marcus would have been added as his own passenger." },
    ],
  },
  {
    version: "0.9.269",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Skip 'Turn N End' autosaves in auto-load. RTW writes both 'Turn N End' (end-of-player-turn snapshot) and 'Turn N+1 Start' (after AI moves resolve) for every turn transition. The Start version is freshly-written seconds later and supersedes the End version, so loading both means a redundant ~35MB reparse on every turn end. Three paths now filter End autosaves: findLatestSave (used by the post-write reparse), get-latest-save-mtime (used by renderer auto-detection), and the fs.watch save-dir callback (so the write itself doesn't trigger a debounced reparse). list-saves keeps showing End autosaves so they remain selectable from the picker if the user wants to inspect them manually." },
    ],
  },
  {
    version: "0.9.268",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Death-event name-match now uses BOTH first AND last name (user feedback on 0.9.267 first-name-only fallback: 'you need to check last names as well!'). The DYING log line emits only the first name (`Titus(uuid):DYING...`), but if the same character emitted a MOVING_NORMAL earlier in the session, liveCharPositions has them keyed under `first|lastStub|faction`. The death handler now recovers the lastStub by finding the live-pos entry with matching charUuid, then matches save chars on first AND last name (with the same underscore-strip normalization on both sides). Falls back to first-name-only when no live entry exists (stationary character that never emitted a move) — that path still over-filters across factions but it's the narrow tail case." },
    ],
  },
  {
    version: "0.9.267",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Garrison troops now disappear when their settlement is taken by successful assault — covers the live-log gap where the save hasn't refreshed yet. Verified from the user's message_log: `faction(messapians) surrenders Brundisium to faction(romans_julii). Reason - SUCCESSFUL_ASSAULT` fires, then `Titus(...):DYING...`, then `captures Brundisium`. The `captures` event itself always has `reason=CAPTURED` (uninformative); the SUCCESSFUL_ASSAULT signal lives on the preceding surrender line, which wasn't being parsed. Now parse it as a separate `surrender` event and on SUCCESSFUL_ASSAULT add the settlement to a `liveAssaultWipedSettlements` set. Three render paths consult this set: (1) liveUnitsByRegion drops units tagged region===<wiped settlement>, (2) the Characters panel drops chars whose bodyguard is inside a wiped settlement, (3) armiesToRender drops the army marker when the bodyguard's region is wiped. RTW rule the user reminded me of: 'when an attacker wins a siege all the garrison troops always die' — but defenders OUTSIDE the settlement walls (a separate region tag) can survive, so we only drop the in-settlement roster, not the surrounding region's armies." },
      { type: "fix", text: "Death events now also map the engine's runtime memory uuid back to the save's stored secondaryUuid via a name match against the live saveCharactersByRegion (kept current through a ref so the log handler doesn't read a stale closure capture). Without this, the existing dead-uuid filter in armiesToRender missed the dead general because the log's `Titus(14f47c40):DYING` uuid never matched Titus's save-time secondary uuid. Trade-off: matches only on first name, so two characters sharing a name in different factions get over-filtered — death events are rare enough that this is acceptable until we tag char records with faction." },
    ],
  },
  {
    version: "0.9.266",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Naval units no longer leak into land army/garrison rosters. User saw a `24` (naval bireme crew) and a `51` (probably naval boat) inside Aulus's garrison panel. main.js's Pass 2 file-order foot-attribution attaches commander-less units to the nearest preceding general WITHOUT a region check (deliberate trade-off documented in the comment — strict region match was dropping legitimate foot units whose region tag lagged after a mid-turn move). But that swept naval biremes into land armies too. Now Pass 2 skips any unit whose name starts with `naval` OR whose region is `the sea` — those are anonymous fleets, owned exclusively by the 0.9.264 navy-synthesis pass." },
    ],
  },
  {
    version: "0.9.265",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "0.9.263's region-color-on-capture fix didn't actually work — confirmed by reading the user's message_log: `attaching region Salentinia(818) to faction(romans_julii)` does fire when Uria/Brundisium is captured, but my city-name lookup loop was iterating the `regions` variable from `processLogEvents`'s closure. processLogEvents is wrapped in useCallback with deps `[replayToTurn]` (no `regions`), so the captured `regions` is the EMPTY initial map from first render and never updates. Lookup found nothing → cityName stayed null → currentOwnerByCity was never updated → map render kept reading the stale faction. Now the lookup is folded into the existing `setRegions(prev => ...)` updater, which gets the live regions map via `prev`. setCurrentOwnerByCity is chained from inside that updater — React batches the two state updates in the same render cycle." },
      { type: "fix", text: "When a defending general dies (DYING event), their units are now also dropped from the captured region's field-army panel. User report: 'I took over Brundisium and the Messapian army is still listed'. The Messapian Aulus died (DET_ALIVE — survived but army destroyed) when Marcus assaulted Uria, but the save still had his units tagged region=Uria with cmd=Aulus, and liveUnitsByRegion just fell back to unit.region for any cmd not in the live armies-to-render. Now liveUnitsByRegion checks liveDeadCharUuids and drops units whose commander is flagged dead. Caveat: only works when the runtime-memory uuid in the log matches the save's stored secondaryUuid (often does not — see save_rome10 Aulus where save uuid is cb79a1ae but log emits 2b0992e0). A name+faction-keyed dead lookup is the next step if the uuid path doesn't catch enough." },
    ],
  },
  {
    version: "0.9.264",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Navies now render on the map. The user pushed back that save_rome10 'def has a fleet', so I scanned the save bytes directly: 6+ occurrences of 'naval' / 'bireme' / 'liburn' ASCII strings — they're definitely there. Found TWO bugs preventing detection: (1) the unit-record region-name validator required an UPPERCASE first letter (filter against random noise), but RTW stores all naval units under region 'the sea' (lowercase) — every naval unit got dropped at the region scan. Validator now accepts lowercase too; the post-region 0xffffffff (or small+uuid) terminator is enough to keep noise out. (2) Once parsed, naval units have commanderUuid=0 (RTW stores fleets as anonymous, no character bound via the unit record) so they never enter `unitsByCommander` and never become navy-class liveArmies. Added anonymous-fleet synthesis: each naval unit's army_uuid sits at u32(i-20), maps 1:1 to a type-4 world-object position record. Multi-ship fleets only carry the uuid on the first ship; subsequent ships inherit via file-order. Save_rome10: 53 naval units → 46 fleets, all 46 with valid positions. Each becomes a navy-class liveArmies entry labelled '<faction> fleet'." },
    ],
  },
  {
    version: "0.9.263",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Region color now flips immediately when a settlement is captured live (the user reported siege won → live-event panel said 'Salentinia attached to romans_julii' but Uria stayed messapians-purple on the map). The region_attach handler was updating `regions[rgbKey].faction` and `factionRegionsMap` but NOT `currentOwnerByCity` — which is the live-ownership override the map render actually reads (App.js:3767). So the map kept showing the pre-capture color until the next save snapshot refreshed `currentOwnerByCity` from the save. Now the handler also flips `currentOwnerByCity[city]` to the new faction, mapping region name (e.g. 'Salentinia') back to the city name (e.g. 'Uria') via the regions dictionary." },
    ],
  },
  {
    version: "0.9.262",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "0.9.261's passenger-propagation fix didn't actually move Aulus's marker — backfill loop synth was emitting `faction: p.faction` (null at transfer time) where the poll loop was already using `p.faction || ev.faction`. So when the user re-attached log-watch and the backfill replayed the merge events, Aulus's synth move went out with faction=null. The renderer's keyFromName produced `aulus|gabinius|` (empty faction segment) and Tier 1 in armiesToRender looked for `aulus|gabinius|romans_julii` — miss. Backfill now uses the same `p.faction || ev.faction` fall-back as the poll loop. Verified by reading save_rome10.sav + the actual message_log.txt: confirmed transfer event fires for Marcus/Aulus uuids, fresh synth produces correct key now." },
    ],
  },
  {
    version: "0.9.261",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Aulus's marker now follows when Marcus moves the merged stack. Inspected save_rome10's actual message_log.txt: the engine emits `transferring general(Marcus...) unit(...) from army(...) to named general(Aulus...):army(...)` then Marcus emits BESIEGE/MOVING_NORMAL for the move to Uria — Aulus's uuid never appears in any movement event before OR after the merge (Aulus is the governor of Taras, stationary by role). So the MOVED general is the active mover and the receiving named-general is the passive passenger that needs synthetic position propagation. Main now parses the general-transfer event, tracks each leader's passenger list, and synthesizes a move event for every passenger when the leader moves. After 0.9.259's same-tile-merge UI logic kicks in on top, the combined stack displays as one block at the new tile." },
      { type: "investigation", text: "Navy regression diagnosed but NOT yet fixed. Inspected save_rome10 + T5 autosave directly. Findings: save_rome10 genuinely has 0 naval-prefix units across all factions (you lost them between T5 and rome1 — game state, not parser bug). The T5 autosave has 18 naval-prefix units, but ALL have `commanderUuid = 0` in their unit record — RTW stores fleets as anonymous, with no character bound via the unit record's commander field. The current pipeline filters commanderless units into the garrison bucket, so navies never get classified as navy-class armies. Fix needs a separate 'anonymous fleet' synthesis path that groups naval units by region+faction marker and pairs them with type-4 world-object position records. Flagged for a follow-up ship." },
    ],
  },
  {
    version: "0.9.260",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Character age now sits inline next to the name (`Aulus Gabinius · age 20`) instead of being right-aligned across the panel — easier to scan when the panel widens for big regions." },
      { type: "feature", text: "Right-click any character in the Characters panel to open a popup listing every trait they carry with its level. Trait names are humanized from the engine's CamelCase ids (e.g. `RomanConquerorMessapians` → `Roman Conqueror Messapians`); this won't match the in-game tooltip text exactly (that lives in `text/export_VnVs.txt` localization strings) but it's enough to see at a glance who the seasoned commanders / corrupt governors / drunkards are. Subtitle shows the role (Faction Leader / Heir / Princess / General) plus age." },
    ],
  },
  {
    version: "0.9.259",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Multi-general stacks now display as ONE merged army block instead of two separate panels. RTW armies hold up to 20 units with any number of general units inside, so when Marcus Livius Drusus moves onto Aulus Gabinius's tile to merge stacks, the in-game result is a single 15-unit army with two generals — not two armies sharing coords. The save still records each general's bodyguard under its own `cmd` field, so the byCmd grouping produced two separate entries. RegionInfo's field-army panel now post-passes mergedOwn/mergedOthers and combines any entries that share (faction, x, y) into one block titled `Aulus Gabinius + Marcus Livius Drusus the Eagle` with all 15 units listed together. Position comes from armiesToRender so live log moves are honored." },
    ],
  },
  {
    version: "0.9.258",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Own-faction generals parked in enemy territory no longer get reclassified as enemy. The army-faction re-attribution (added 0.9.222 to fix rebel captain_card misattribution) was unconditionally overwriting `army.faction` with whoever owns the region the bodyguard's parked in. So Aulus Gabinius (romans_julii) standing inside the `Taras` region got re-tagged as `taras` and showed up in Tarentum's garrison panel mixed with Milon's actual defenders. Re-attribution now skips identified v1 characters (those with parsed traits) and only fires for placeholder commanders where the captain_card_marker fallback can't be trusted. Same gate applied to all three load paths (initial save-watch, reparse, characters-init)." },
    ],
  },
  {
    version: "0.9.257",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Live tracking now works for characters who got a trait-driven cognomen (Marcus Livius_Drusus → Marcus Messapivs after capturing Brundisium, etc.). The 0.9.225 epithet override REPLACED `lastName` with the new cognomen for display, but the engine continues to emit MOVING_NORMAL events using the BIRTH name — so save key `marcus|messapivs|romans_julii` was matching against log key `marcus|liviusdrusus|romans_julii`, missed Tier 1, and the marker stayed put. Preserves the birth name as `originalLastName` and uses that for matching while keeping the epithet for display. Fixed in both the worker path and the synchronous fallback." },
    ],
  },
  {
    version: "0.9.256",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Captured-but-alive characters now disappear from the map immediately. The engine emits DYING events with `death_type(DET_ALIVE)` for characters who survived a battle but lost their army (typical of a settlement defender post-capture — Titus at Brundisium was the visible case). Main was filtering those events out via `!ev.alive`, so they never reached liveDeadCharUuids and the marker stayed glued to the old garrison tile until the next save snapshot caught up. Now we treat ALL DYING events as 'remove from map' regardless of death_type — the army is gone in either case, and the save will catch up to confirm. Also include charUuid in the death payload so the renderer can match by uuid as well as by name." },
    ],
  },
  {
    version: "0.9.255",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Fixed compound-surname key mismatch that was orphaning live moves for every Roman patrician. The engine writes log lines with surnames separated by SPACES — `Lucius Valerius Flaccus` — while save records use UNDERSCORES — `Valerius_Flaccus`. My keyFromName took only `parts[1]` as the lastName stub, producing log key `lucius|valerius|...` vs save key `lucius|valeriusflaccus|...`, so the match cascade's Tier 1 missed and the position update never reached the save army. Now: concatenate all parts after the firstName with underscores stripped, AND strip a trailing 'the X' trait-epithet phrase. Both sides produce `lucius|valeriusflaccus|...` — Tier 1 matches and Lucius's marker tracks every move event in real time." },
    ],
  },
  {
    version: "0.9.254",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Removed the spinner too — the loading pill is now just the shimmering text. Single sweeping gradient through 'Loading save… <stage>' carries the progress signal." },
    ],
  },
  {
    version: "0.9.253",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Save-loading pill: dropped the standalone progress stripe and put a shimmer animation on the stage-label text instead. A bright band sweeps left→right through the text continuously, signalling 'still working' the same way the stripe did but without the extra widget. Cleaner look, less screen real-estate." },
    ],
  },
  {
    version: "0.9.252",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "MOVING_NORMAL log lines with a trailing 'seige_scroll scroll closed' suffix now match. The engine appends that token (its typo for 'siege', kept verbatim) to character moves emitted while a siege scroll was open in-game — common for any move adjacent to a settlement currently under siege. The regex's `$` anchor rejected those lines, so every move logged during siege-active turns was silently dropped and the marker stayed frozen at the pre-siege tile until the next save snapshot caught up. Drop the anchor; trailing tokens are ignored. Verified against the user's message_log.txt line for Lucius Valerius Flaccus's E↔W shuffle outside Brundisium." },
    ],
  },
  {
    version: "0.9.251",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Save-loading indicator is now a compact pill in the top-right corner instead of a full-width banner. Less intrusive — keeps the rest of the toolbar usable while a parse runs in the background. Same content (spinner, stage label, animated stripe), just smaller and out of the way." },
    ],
  },
  {
    version: "0.9.250",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Save-reload progress bar now shows during in-game saves too. Earlier the loading banner only flipped on at the initial save-watch-start; reparses triggered by in-game saves emitted progress events but the banner was already gone, so the user saw a frozen UI for the duration of the parse. Now: any progress event from main re-shows the banner with the current stage label and the indeterminate stripe animation." },
      { type: "improvement", text: "Eliminated factions no longer clutter the icon grid. In Live mode, factions with zero regions in factionRegionsMap (which the capture-event handler updates the moment the last city falls) are filtered out of the sidebar. Slave/rebel factions stay visible since they're synthetic placeholders and may not list their occupied tiles in the map." },
      { type: "improvement", text: "Removed the '+14 −7 since turn 0' diff badge from the Garrison header. Cleaner panel layout — diff against turn 0 wasn't conveying useful info during play." },
    ],
  },
  {
    version: "0.9.249",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Character deaths now propagate live — no save snapshot required. The death-event handler already removed defeated characters from liveCharPositions, but the marker on the map (driven by saveLiveArmies) lingered until the next save reflected the death. Now: every DYING / death_type log event also adds the charUuid to a `liveDeadCharUuids` set, and armiesToRender filters out any save army whose commanderUuid or primaryUuid is in that set. Concrete case: defenders wiped during a siege resolution disappear from the map immediately instead of staying frozen at their settlement until autosave." },
    ],
  },
  {
    version: "0.9.248",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Buildings parser moved to a worker thread, running in parallel with the chars worker AND parseSaveData. Three CPU-bound passes now overlap on three cores: ~1-1.5s chars + ~1-1.5s parseSaveData + ~200-400ms buildings, total wall time ≈ max-of-three. Wired across all three load paths (initial, reparse, characters-init), each with sync fallback if worker spawn fails. The in-game save reload that was hanging the main thread should feel ~300-500ms shorter on top of 0.9.247's O(N+M) win." },
    ],
  },
  {
    version: "0.9.247",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Building→settlement linking is now O(N+M) instead of O(N×M). The original double loop was iterating ~30,000 buildings × ~1,300 settlements = ~39 million tight iterations on every save parse. Both arrays were already sorted by file offset (sequential byte-order scans produced them) so a two-pointer walk does the same work in ~31,300 iterations. Saves ~200-500ms per parse — particularly noticeable on the in-game save reload (when the file-watcher fires reparseLatestSave)." },
    ],
  },
  {
    version: "0.9.246",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Marker now follows live moves both ways. 0.9.244's proximity dedupe SKIPPED stale log entries instead of using them, which broke the 'move back to original tile' case: the save army stayed at the post-first-move position, and the matching log entry got dropped, leaving the marker frozen at the wrong tile. Replaced skip-with-update: when a same-faction same-firstName log entry is within 2 tiles of a save army (i.e. they're the same character whose match cascade missed), update the save army's (x, y) to the log entry's position. Marker now tracks each move event in real time." },
      { type: "fix", text: "Army-marker tooltip no longer spills outside the viewport. The combination of `whiteSpace: nowrap` and a long traits line let it overflow the right edge into the side info panel. Removed nowrap (now wraps via wordBreak), and clamped position: when the tooltip would overflow the right edge it flips to the left side of the marker, and bottom-edge overflow shifts up." },
    ],
  },
  {
    version: "0.9.245",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Worker-thread parallelism for the v1 character scan. The byte-by-byte scan over the full save (~1-1.5s on a 30MB file) now runs in a worker_threads worker, in parallel with the main thread's parseSaveData (which also scans the buffer for buildings/settlements/units). Total Live-load time drops from sum-of-scans to max-of-scans — ~1-1.5s saved on top of 0.9.244's redundant-read fixes. Worker also applies trait epithets so the main thread doesn't redo that pass. Falls back to synchronous parsing if worker spawn fails or mod data isn't loaded yet — zero risk of behavior change." },
    ],
  },
  {
    version: "0.9.244",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Skipped two redundant 30MB save-file reads on the initial-load path. parseSaveData now accepts a buffer instead of a path (saves ~150-300ms per call where the caller already holds the buffer); the save buffer is also cached at module level so characters-init reuses it instead of reading from disk again. Net: ~300-500ms shaved off Live mode startup with zero behavior change." },
      { type: "fix", text: "Duplicate 'log-tracked' marker after a 1-tile character move. The match cascade succeeded for the save army (its marker moved to the new tile correctly) but a leftover livePos entry whose key didn't match created a synthetic log-only marker right next to it. Added proximity dedupe: any log-only synthetic within 2 tiles of an existing save army of the same faction (and, when known, same firstName) is treated as the same character and skipped. Reproduced and fixed against Lucius Valerius_Flaccus the Defender after his eastward move." },
    ],
  },
  {
    version: "0.9.243",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Army-faction re-attribution now runs on ALL save-load paths (initial saveWatchStart, characters-init, reparseLatestSave). Previously it only fired in reparseLatestSave, so on the first save Provincia loaded each session, captain_card_<faction>.tga marker fallbacks misattributed factions and stuck. Concrete case (save_rome4): Titus's messapian general bodyguard sits at file offset 0x1ae4768; the most-recent captain_card marker BEFORE that offset is `captain_card_massalia.tga` (because messapians' own captain_card path appears later in the file or is missing). The marker fallback gave Titus's army faction='massalia', and the Garrison panel's faction-match check rejected him as foreign-faction in messapian-held Brundisium — leaving the panel showing Titus as the commander but 'No units stationed'. With re-attribution running on initial load, Titus's army gets faction='messapians' from currentOwnerByCity['Brundisium'] and his stack lands in the Garrison panel where it belongs." },
    ],
  },
  {
    version: "0.9.242",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Settlement-tile garrison classification was failing on a y-axis mismatch: cityPixels (built from canvas getImageData) is in TOP-DOWN visual coords, but army positions in the save (type-6 records) and descr_strat are BOTTOM-UP world coords. Compared as strings, they almost never matched — only ~10 of 857 commander-led armies were classified as garrison across the whole map, and Titus at Brundisium showed in 'Region owners armies' instead of Garrison even though he was sitting on his own city. All settlement-tile comparisons now flip cityPixels.y to world coords (`H-1-y`). Stations the messapian Titus's stack inside Brundisium's Garrison panel; should also flip the global garrison count from ~10 to several hundred, matching the actual number of governed cities on the map." },
    ],
  },
  {
    version: "0.9.241",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Damaged units now display the right way around. Unit-record bytes at regionEnd+8 hold MAX soldiers, +12 holds CURRENT — my parser had the labels swapped, so a damaged equites unit (real 94/120) rendered as '122/96' (max/current) instead of '96/122' (current/max). Full-strength units hid the bug because both fields are equal. Confirmed against the byte dump on save_rome4 (Marcus Livius_Drusus's damaged equites)." },
    ],
  },
  {
    version: "0.9.240",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Roman generals no longer drag each other across the map. The live-position match cascade had a Tier 2 (firstName + faction prefix) fallback that fired whenever the save's lastName didn't exactly match the log's — useful for renamed/cognomen cases, but in faction-heavy lines like the Roman Marcuses (heir + 2 active consuls + new generals all named Marcus) it grabbed the FIRST 'marcus|*|romans_julii' key in livePos and applied it to every save Marcus, dragging Marcus Ogulnius_Gallus and Marcus Atilius Regulus the Defender (both at Rome) onto Brundisium where Marcus Livius_Drusus was besieging. Now: Tier 2 only fires when the save army has a PLACEHOLDER firstName (e.g. 'romans_julii captain' for v1-undecoded commanders) AND there is exactly ONE candidate key in livePos. Same conservative rule for the unknown-faction Tier 3." },
    ],
  },
  {
    version: "0.9.239",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Foot units now follow their general by FILE ORDER, not save-region tag. Was: cmd=0 foot only attached to a preceding general if the general's region tag matched. That broke the army-merge case (user moves new general Marcus into Uria, grabs Aulus's army, moves merged stack to siege Brundisium): the 13 foot still carried their old Taras region tag while Marcus's bodyguard now tagged Metapontion, and the strict region match dropped them all — Marcus's army showed 1 unit. Now: foot attach to the immediately preceding cmd!=0 general regardless of region tag, since the save writes each army's units contiguously and the tags often lag mid-turn moves. Trade-off: if RTW ever stores a true settlement garrison right after an unrelated general's record, the garrison would mis-attribute — that ordering hasn't been observed in practice." },
    ],
  },
  {
    version: "0.9.238",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Garrison and 'Region owners armies' panels now require faction match for the settlement-tile rule. Without this, a foreign army standing on (or whose live position resolved to) the settlement tile got promoted into the city's garrison list — Marcus Ogulnius_Gallus's bodyguard appeared inside messapian-held Brundisium even though he's a Roman, and the actual Roman besieger (Marcus Livius_Drusus) was symmetrically pulled out of 'Region owners armies'. Now: only commanders whose faction matches the region owner are treated as garrison; everyone else stays in the field-armies panel where besiegers and through-passers belong. Same fix on both panels so nothing double-lists." },
    ],
  },
  {
    version: "0.9.237",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Character parser no longer misses characters whose +18..+25 'spouse uuid' slot is populated. The 0xff bytes there were a 'field unset' marker, not a structural anchor — a character who got married, gained certain traits (RomanConquerorMessapians, etc.), or otherwise had that slot filled was rejected. Aulus Gabinius post-conquest in save_rome3 was the first observed case (his record at 0x1504ae2 carried a Cornelius_Scapula name index there instead of 0xff). New anchor: traitCount + first trait record validity (real trait id, plausible level). Verified: Aulus now decoded correctly with all 28 traits." },
      { type: "fix", text: "App was hanging on busy saves. The 0.9.235 Tier 0.5 commanderUuid match in armiesToRender did O(armies × livePos) per memo run — combined with active log streaming on a multi-thousand-character save, that's millions of iterations per render. Now: build a charUuid → entry index ONCE per memo run, both Tier 0 and Tier 0.5 lookups are O(1)." },
    ],
  },
  {
    version: "0.9.236",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Stack standing on the city tile is the garrison, not a field army. After 0.9.235 fixed Aulus's units bucketing to Salentinia, the panel still listed them under 'Region owners armies' because the garrison filter only accepted commander-LESS units OR the appointed governor's units — and Aulus isn't decoded as a v1 character (his cmd uuid has no v1 record), so the governor lookup couldn't see him. New rule: any commander whose live position equals the settlement tile of the clicked region is treated as garrison, regardless of governor-resolution status. Mirrors RTW's own UI which shows everything on the city tile as defenders. Field-armies symmetrically excludes those uuids so nothing double-lists." },
      { type: "fix", text: "Removed the duplicate Aulus marker at his Taras spawn. The descr_strat fallback was still adding a synthetic army marker at every starting position from descr_strat, even when the actual character had moved off that tile in live play. So Aulus showed up TWICE on the map: once at his original (337, 385) Taras position (descr_strat synthetic) and once at Uria (save position updated by the log). Now: synthetic-marker creation is skipped when log-position events are flowing — save data + log positions become the single source of truth. The descr_strat unit-list borrowing for save armies at matching tiles is preserved." },
    ],
  },
  {
    version: "0.9.235",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Two related bugs that combined to leave Aulus duplicated on the map AND Salentinia/Uria's panel empty after he captured the city: (a) settlement tiles are black on the regions TGA (per RIS convention; ports are white) so the live-region lookup returned null for armies sitting in a city, leaving their units bucketed under the stale save region — fixed with a cityPixels fast path + 1-tile neighbourhood scan; (b) Aulus's bodyguard cmd uuid has no matching v1 character record (lesser-general / promoted-captain class, missed by both LAYOUT_A and LAYOUT_B), so the save army stored a placeholder firstName 'romans_julii captain' that didn't match the log's 'Aulus Gabinius', leaving the save entry stuck at its old position while the log entry created a separate marker — fixed by adding Tier 0.5 in armiesToRender's match cascade: when primaryUuid is null, fall back to commanderUuid → log charUuid (engine emits the same id for both). The live position now reaches the save army → marker moves AND units re-bucket to the destination region, no duplicate." },
    ],
  },
  {
    version: "0.9.234",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Governor resolution unified across all save-load paths. Three places ran governor lookup: (1) reparseLatestSave (correct — used full extras.characters with primaryUuid keying), (2) initial save-watch start (BUG: used a flattened charactersByRegion view that drops chars without a region and lacks primaryUuid keying), (3) characters-init after mod-data load (BUG: didn't re-resolve at all). Both bugs caused well-known leaders like Quintus Ogulnius_Gallus at Rome to show as '(governor — character record not decoded)' even though the v1 parser had decoded him fully — a stale unresolved entry from the pre-mod-data initial pass survived into the renderer. All three paths now use the same `extras.characters` + sec/primary uuid keying logic." },
    ],
  },
  {
    version: "0.9.233",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Garrison + Field-army panels now follow live commander moves. The map markers already shifted in real-time on each MOVING_NORMAL log event, but the side panels were still reading the save-time unit-record region — so an army that moved mid-turn would slide on the map yet still appear under the OLD region's panel until the next save snapshot. Now: armiesToRender carries each army's current region (resolved from its live (x,y) via the regions-map TGA pixel data), and a new liveUnitsByRegion memo re-buckets every save unit using its commander's current region. Garrison + Field-army panels read from this map. An army leaving its home tile drops out of that region's panel and appears in the destination's panel as soon as the log fires the move — same cadence as the marker." },
      { type: "improvement", text: "Note on the capture→colour-flip path: this was already wired (App.js:2258 since 0.9.213) — captures from message_log.txt update factionRegionsMap + regions[].faction immediately, so the BASE map layer flips colour the moment the engine logs the capture. The save-derived currentOwnerByCity override (which fires after the next save write) is the redundant secondary path. The lag the user saw earlier was the save-watch debounce (now 600ms in 0.9.231)." },
    ],
  },
  {
    version: "0.9.232",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Army markers on the map are now ON by default and persist across sessions. The 'Armies' map-mode button has been wired up since 0.9.217 (faction-coloured halos at every commander's position, garrisons / field armies / navies separable via sub-toggles), but it defaulted OFF — the user reported 'Provincia doesn't visualise army positions' because the toggle was buried. Now defaults ON, persisted to localStorage like other map toggles." },
      { type: "improvement", text: "Bumped marker size: floor 1.5px → 3px screen-pixels, with a thicker faction-coloured halo. The old size was readable only when zoomed all the way in, which is why the feature felt invisible. New size is spottable at full-map zoom without cluttering when zoomed out further." },
    ],
  },
  {
    version: "0.9.231",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Save-watch debounce 1500ms → 600ms. The user reported the map colour flipped to the new owner eventually after a mid-turn capture, just slowly. Most of the lag was sitting in the save-watch debounce, which was set conservatively to wait out RTW's multi-stage save burst. 600ms is short enough that the colour flip lands ~1s after pressing save (not ~3s) and still clears the burst — the reparse-lock + tail-coalescing already handles any straggling writes that arrive during the parse." },
      { type: "improvement", text: "Quieted the 0.9.230 map-render diagnostic. It now only logs when the override actually flipped a region's owner (i.e. on the conquest itself), not on every repaint. Easier to spot real ownership transitions in the console without scrolling through dev-mode toggles." },
    ],
  },
  {
    version: "0.9.230",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Diagnostic log on map repaint. The user reported a captured region (Salentinia → romans_julii) staying its old colour even though the events log showed the capture and the save's per-settlement uuid had updated. Direct save inspection confirmed the data is correct (Uria's marker-1944 uuid = Rome's, and the resolver maps it to romans_julii) but couldn't reproduce the stale render. Console.log now prints how many cities the live-ownership override touched on each repaint and a few samples of regions whose colour changed — so the next time it happens the dev console pinpoints whether the override is running, applying the right faction, or being ignored downstream by colour/canvas caching." },
    ],
  },
  {
    version: "0.9.229",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Removed the redundant '↳ Bodyguard: greek general (63/63)' sub-line under the governor name. That was a 0.9.224 workaround for when the bodyguard unit wasn't rendering anywhere; since 0.9.227 the whole governor stack now appears as unit cards in the Garrison panel directly, so the sub-line just duplicates info already on the cards. Kept a discreet '(bodyguard currently at <region>)' note for the rare case where the bodyguard's unit-record region differs from the settlement's region — that's still useful context the unit cards don't show." },
    ],
  },
  {
    version: "0.9.228",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Field-army panels now group armies by faction. 'Region owners armies' and 'Other faction armies' both render a faction sub-header (e.g. 'Romans:') above each group's stacks, so multiple armies from the same faction collapse under one heading instead of repeating the faction tag on every line. Same grouping applied to both panels for consistency." },
    ],
  },
  {
    version: "0.9.227",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Governor's stack now displays in the Garrison panel instead of 'Region owners armies'. After 0.9.226 attached foot units to their general, Milon's Tarentum garrison (1 bodyguard + 6 greek foot, all attributed to Milon) moved out of the empty Garrison panel and into 'Region owners armies'. The user expects the governor's stack to BE the garrison — that's how it's stationed in-game. Garrison filter now also accepts units commanded (or inferred-commanded) by the settlement's governor; fieldArmies symmetrically skips that uuid so nothing double-counts. 'Region owners armies' shrinks to truly external own-faction stacks (e.g. a separate field army passing through), which is what the section name implies." },
    ],
  },
  {
    version: "0.9.226",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Foot units now follow their general's stack instead of dumping into the destination region's garrison panel. Reproduced on save_rome1.sav (RoR turn 1): Aulus Gabinius's invading army at Taras (1 bodyguard + 13 roman foot) and Milon's Tarentine garrison (1 bodyguard + 6 greek foot) were both showing as 'garrison' because foot units carry commanderUuid=0 in the save and the previous grouping pass refused to attribute them. Restored the file-order foot-attribution rule, but with a region-equality guard so a Roma garrison stored after a Frentania field-army record doesn't get misattributed (the regression that made me drop the original sequential pass)." },
      { type: "fix", text: "Greek/single-name characters now decode. Milon of Tarentum, Leophron, Pyrrhos, and ~150 other faction leaders without family surnames were silently rejected by the v1 parser because their record format omits the lastName u32 — every in-record field shifts -4 (age at +22 instead of +26, traitCount at +298 instead of +302, etc.). Parser now anchors variant detection on the 8-byte 0xff sentinel position (LAYOUT_A: +18..+25, LAYOUT_B: +14..+21) and applies the right field offsets for each. The user's RoR T1 save: 61 chars → 2014 chars (148 leaders, all with sensible names + ages + traits). Greek-faction governors now show up by name in the garrison panel instead of '(governor — character record not decoded)'." },
    ],
  },
  {
    version: "0.9.225",
    date: "2026-05-10",
    items: [
      { type: "feature", text: "Trait-driven cognomen overrides. RTW changes a character's displayed surname when they earn certain traits — e.g. capturing Messapian territory grants `RomanConquerorMessapians`, whose Epithet text is 'Messapivs'; the in-game UI shows 'Aulus Messapivs' while the save still stores his birth surname 'Gabinius'. The app now parses `export_descr_character_traits.txt` for `Epithet` keys, resolves them against `text/export_vnvs.txt` (UTF-16), and overrides each character's lastName based on their highest-level epithet trait. Nicknames (\"the Drunkard\", \"the Pious\") are detected separately and appended after the surname rather than replacing it. 991 epithet-bearing traits parsed from RIS imperial — covers RomanConqueror*, Africanus, Magnus, etc. Confirmed against user's RoR T5 save: Aulus Gabinius (governor of Uria) now displays as 'Aulus Messapivs', matching the in-game UI." },
    ],
  },
  {
    version: "0.9.224",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Governor's bodyguard now appears under the governor line in the Garrison panel, even when the bodyguard's unit-record region differs from the settlement's region. 0.9.223 fixed the parser so the unit was found, but the garrison panel filter dropped it: garrison strictly = commander-LESS units, and field-armies filter by clicked region. Aulus Gabinius's bodyguard at Uria/Salentinia got attributed to the unit-record's region (Taras) and didn't show up in Salentinia's panel at all. Now: when a city has a governor whose uuid matches a bodyguard unit anywhere on the map, the bodyguard is rendered as a sub-line of the governor, with a 'currently at <region>' note when the bodyguard is parked elsewhere — e.g. 'Aulus Gabinius — romans_iulii ↳ Bodyguard: roman general (28/33) — currently at Taras'." },
    ],
  },
  {
    version: "0.9.223",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Unit parser was missing freshly-recruited general bodyguards. After a unit's region UTF-16 string the parser required a `ff ff ff ff` terminator, but recently-recruited bodyguards use a small u32 instead (e.g. `0d 00 00 00`). Aulus Gabinius's bodyguard at Taras (the governor the user installed at Salentinia/Uria) was being skipped — that's why the user's report 'a male character who is of age always has a bodyguard' showed an empty garrison. Parser now also accepts the small-u32 variant when the next 4 bytes look like a real commander UUID. Roman generals on the user's RoR T5 save: 35 → 36 records." },
    ],
  },
  {
    version: "0.9.222",
    date: "2026-05-10",
    items: [
      { type: "feature", text: "Decoded the per-settlement GOVERNOR field. Each settlement marker has the governor's character UUID at marker-1940 (4 bytes after the owner UUID at marker-1944). Cross-referenced against v1 characters to attach a name. Confirmed on user's RoR T5 save: Rome → Quintus Ogulnius_Gallus (player leader), Uria → Aulus Gabinius (the governor the user just installed after conquering Salentinia). The garrison panel now shows 'Governor: <name>' even when the character has no bodyguard army (= no unit record link), which was the case for the user's Salentinia/Uria report. Fall back to '(governor — character record not decoded)' when the uuid points to a character v1 doesn't recognize." },
      { type: "fix", text: "Army faction attribution: rebel-faction armies (Picentes, Salentinians, etc.) were getting tagged with the most-recent `captain_card_<faction>.tga` marker before their unit block. Rebel factions don't have captain_card markers, so a Picentine army at Asculum showed as 'pergamon captain'. Now: after currentOwnerByCity is resolved, every army's faction is overridden with the region's current owner (bridging through descr_regions' region→city map). Picentes army at Picenum now reads as Picentes." },
    ],
  },
  {
    version: "0.9.221",
    date: "2026-05-10",
    items: [
      { type: "fix", text: "Save-watch reparse lock now coalesces tail events instead of dropping them. The 0.9.213 lock prevented hangs from concurrent parses, but if a save fired during a parse the second event got silently discarded — the renderer kept showing stale data until the NEXT save. Now: in-flight parses set a pending flag; when they finish they immediately fire one more reparse. So the latest save always wins, no events lost, no overlapping parses." },
    ],
  },
  {
    version: "0.9.220",
    date: "2026-05-10",
    items: [
      { type: "improvement", text: "Right-click any faction tile in the Factions sidebar to open its card (large icon + display name + internal id). Same overlay the homeland-row icons use — single InfoPopup handles all faction-card sources." },
    ],
  },
  {
    version: "0.9.219",
    date: "2026-05-09",
    items: [
      { type: "improvement", text: "Wealth panel: live mode now shows current regions (from the save's owner UUIDs, ↑ green / ↓ amber arrows when changed from starting count) and live army count per faction (parsed from the save). Sort changed to current-regions descending. Treasury still shows starting denarii from descr_strat — live treasury values aren't decoded from the save yet (the engine stores them in a separate ECONOMICS_DATA section we've located but not field-mapped)." },
    ],
  },
  {
    version: "0.9.218",
    date: "2026-05-09",
    items: [
      { type: "feature", text: "Parser-stats badge in the Factions header (live mode). Shows total units · armies · conquests at a glance, with a hover tooltip listing every count: Units / Armies / Characters parsed / Settlements with owner / Conquests detected. Lights amber when any count looks suspicious (e.g. zero units in a populated save). Spot regressions instantly without diving into logs." },
      { type: "improvement", text: "Test coverage: added 11 new vitest cases covering unitParser (identical-pair determinism, RIS-imperial unit/region count sanity, long region names, naval-unit detection) and saveOwnershipParser (plurality-vote conquest recovery, uuid=0 → slave, identical-pair determinism). 26/26 passing." },
    ],
  },
  {
    version: "0.9.217",
    date: "2026-05-09",
    items: [
      { type: "improvement", text: "Every commander-led army now gets a faction attribution via the `captain_card_<faction>.tga` boundary markers in the save. On a turn-22 athens save: 1116 armies, 43 named (matched to v1 characters), and ALL 1116 tagged with a faction. Armies whose commander isn't decoded show as e.g. 'romans_julii captain' instead of '(unknown)' — at minimum you see whose army it is." },
    ],
  },
  {
    version: "0.9.216",
    date: "2026-05-09",
    items: [
      { type: "improvement", text: "Garrison and Field Armies panels are now non-overlapping. Garrison = the region's commander-less units (settlement defenders); every army with a commander shows up under Field Armies, named (when the parser identifies the commander) or aggregated by faction (when it doesn't). Previously a garrison army with a commander could appear in BOTH lists, or be hidden from both because the 'commander exactly on settlement tile' shortcut required pixel-perfect coords we don't always have." },
    ],
  },
  {
    version: "0.9.215",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "Field-army leader names + factions: on RIS imperial, every army on the map showed as '(unknown)' because the army-builder only consulted v2 scripted characters (which return zero on imperial). Now also indexes v1 characters by their secondaryUuid and reads `captain_card_<faction>.tga` boundary markers to attribute each army's faction by file offset. Roman armies show as Roman, Carthaginian armies as Carthaginian, etc. — even ones whose commanders aren't in the v2 scripted set." },
    ],
  },
  {
    version: "0.9.214",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "Army grouping rewrote: was sequential (file-offset-walk + region-match), is now region-based (group every unit by its own commanderUuid; commander-less units = settlement garrison). The old approach silently dropped 36% of units on RIS imperial because the file's storage order doesn't encode stack membership in a way that aligns with region — a Roman garrison in Roma sitting in the file after a Frentania field-army record got rejected as a 'region mismatch'. New approach trusts the unit record's own bytes: each unit goes exactly where the engine wrote it." },
      { type: "feature", text: "'Homeland of:' switched from comma-separated text names to a row of faction icons. Hover any icon for the display name; right-click opens a faction card overlay (large icon + display name). Saves space, more visual." },
      { type: "feature", text: "Faction-icon right-click → card view. Currently active in the Homeland-of row; the InfoPopup now handles type=faction so any future call site can light up the same overlay." },
    ],
  },
  {
    version: "0.9.213",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "App locked up when fs.watch fired bursts of save events. After making parseSaveData async (0.9.211), two debounced reparses could overlap — both running parsers in parallel, both writing lastSaveData, both flooding the renderer with IPC events. Added a single-flight lock (_reparsing flag): if a parse is already in progress, the next event is dropped. The 1.5s debounce already filters most bursts; the lock catches the residual." },
      { type: "fix", text: "Region info panel showed an empty unit list even when units were clearly stationed there (user reported a Roman governor in Salentinia with no units shown). The garrison filter required each unit's commander to (a) exist in the saveCharactersByRegion-derived UUID map AND (b) be positioned EXACTLY on the settlement tile. Both conditions fail commonly on RIS imperial: half the v1 chars have no resolvable position, governors stationed on the city tile but parsed to coords ±1 get rejected. Switched to: every unit the parser placed in this region is shown. The unit's parsed `region` field IS the right signal — the engine writes it from the army's current tile. Mixes governor's army into the garrison view, but that's better than empty." },
    ],
  },
  {
    version: "0.9.212",
    date: "2026-05-09",
    items: [
      { type: "improvement", text: "Removed the seconds counter from the live-mode loading banner — parses now finish in well under a second so the counter just sat on '0s' and looked broken. Stage label + sliding stripe is enough." },
    ],
  },
  {
    version: "0.9.211",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "Map STILL showed turn-0 borders even with conquests resolved. The faction-color renderer built rgbKey→owner from descr_strat's factionRegionsMap and never consulted currentOwnerByCity, so a conquered Salentinia stayed brown on the map even though the right-side panel correctly read 'Faction: Rome'. Added a live override pass: after building the descr_strat baseline, if a save is loaded and currentOwnerByCity has a different owner for that region's city, the rgbKey gets overwritten before the canvas is painted. Borders now follow the actual save state in real time." },
      { type: "improvement", text: "Loading banner shows finer-grained stage labels: parseSaveData was a single black box behind 'Parsing buildings & settlements' for several seconds; now it ticks through 'Scanning building records' → 'Scanning settlement markers' → 'Linking buildings to settlements' → 'Scanning unit records' → 'Grouping units by region' as it works. Each sub-stage yields to the event loop so the renderer's banner actually receives the update mid-parse instead of after the whole function returns." },
    ],
  },
  {
    version: "0.9.210",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "Conquests weren't showing on the map. The owner-UUID resolver required a 60% descr_strat-anchored majority before trusting a UUID→faction mapping. At mid-game (turn 22+) this rejects ~30% of UUIDs because conquering factions hold a mix of starting + conquered settlements that splits below 60% (e.g., Athens with 4 starting + 3 conquered = 57% rejected). Switched to plurality vote (top faction wins, alphabet tiebreak), since each UUID is unique to one faction and the plurality must be the conqueror's own descr_strat anchor. Also map uuid=0 settlements to the slave/rebel faction (~10 per save). Net effect on athens_t22mid: 936 → 1090 settlements resolved, 90 → 167 conquests detected." },
      { type: "improvement", text: "Live-mode loading banner overhauled. The 0.9.209 % bar appeared stuck at 15% the whole wait because parseSaveData is one big synchronous chunk between the 15%/50% emits — the bar lied. Replaced with an indeterminate animated stripe that always slides, plus an elapsed-seconds counter so users can see 'still working at 4s, 5s, 6s...' instead of a static %. The stage label still updates between phases (Reading save file → Parsing buildings → Parsing characters & armies → Resolving ownership → Done)." },
    ],
  },
  {
    version: "0.9.209",
    date: "2026-05-09",
    items: [
      { type: "feature", text: "Live mode loading banner. Clicking Live used to freeze the window for 5-30s on big mid/late game saves while the main process synchronously parsed everything; the app looked crashed. Now you get an immediate top-of-window banner with: spinner, stage label ('Parsing characters & armies' / 'Resolving settlement ownership' / etc.), progress bar, and a percentage. Implemented by emitting per-stage `save-progress` IPC events from main.js and yielding to the event loop between stages so the renderer's banner actually updates instead of waiting for the whole pipeline. Same banner runs on initial Live activation AND on every save-watch reparse (turn ends, manual saves)." },
    ],
  },
  {
    version: "0.9.208",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "Units / armies on the map were missing or in the wrong place — most badly on mid-to-late game saves. Three independent bugs ganging up: (1) Position record bounds were `x ≤ 200, y ≤ 150` (vanilla RTW map size). RIS imperial is 1020×700; the old bounds rejected 99.6% of legitimate (x,y) records (only 5 out of 1422 made it through on a turn-22 save). Raised to 1100×800 in main.js, characterParserV2.js, App.js (live-log moves filter). (2) Unit-record region-name length capped at 25 chars; 22 RIS regions are longer (Bracarensia_Septentrionalis, Memphites-Letopolites_Nomoi, etc up to 35 chars), so units in those regions were silently dropped. Raised to 50 chars + widened the post-name search window to 80 bytes. (3) v1 character position lookup read u32 at `offset-16`, which is correct for v2 layout but reads junk for v1 — half of v1 chars never got x/y. Switched to the proper v1 commander-UUID source (`secondaryUuid`) with primary/legacy fallbacks. Net effect on athens_t22mid: 5573 → 5626 units, 1188 → 1208 regions, 100% of unit-commander UUIDs resolve to positions (was 0.5%)." },
    ],
  },
  {
    version: "0.9.207",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "Live mode hung for 30+ seconds on initial save parse. Root cause: `findCharacterRegion()` was called once per character (~100 chars at mid-game), each call doing a full-buffer indexOf scan + nested 1000×3×100 inner-loop hunt for unit-name strings. O(N×M) where N=save bytes (~40 MB) and M=character count. Fix: pre-build a `commanderUuid → region` map ONCE from unit records, then each character lookup is O(1). Total parse time drops from ~33 s to ~1 s on a 40 MB save. The legacy `findCharacterRegion` code path is no longer invoked during live parsing (still exported for any caller that needs the slow scan)." },
    ],
  },
  {
    version: "0.9.206",
    date: "2026-05-09",
    items: [
      { type: "fix", text: "0.9.205 wouldn't open: 'Cannot find module ./src/factionRecordParser.js'. The new save-format parsers (factionRecordParser, luaCounterParser) were imported by main.js but missing from electron-builder's files allowlist in package.json — so they got stripped from the packaged asar. Added both to the allowlist; verified the asar now contains them. Apologies for the bricked build." },
    ],
  },
  {
    version: "0.9.205",
    date: "2026-05-09",
    items: [
      { type: "feature", text: "Two new save-format structures decoded and surfaced live. (1) Faction record array — every save contains 239 per-faction state records starting with magic `ff 0a af f0`. The array span is the dominant per-turn bloat source (~90 bytes/turn/faction; projects to ~8.6 MB by turn 400 at 239 factions). New blue badge in the Factions header shows record count + total KB; hover for details. (2) Lua persistent-counter table — 115 named entries near EOF storing every `declare_persistent_counter` value plus engine internals like `turn_number` and faction UUIDs (`id_sparta = 1330481`, `id_romans_julii = 1110011`, `id_athens = 1330201` for RIS imperial). New green badge shows count + the live `turn_number`; hover lists the first 12 counters. Both findings came from the new rtw-sav-parser cracker at C:\\dev\\rtw-sav-parser; round-trip-tested across 10 saves; cross-validated identical-pair determinism. Format details: faction record header is 16 bytes (magic1 + 2× self-pointer + magic2 `f0 0a af f0`) followed by variable per-faction state. Counter format: u32 length + UTF-16LE name + u32 value, contiguous chain. New tests (`factionRecordParser.test.js`, `luaCounterParser.test.js`) — 19/19 passing." },
    ],
  },
  {
    version: "0.9.204",
    date: "2026-05-05",
    items: [
      { type: "fix", text: "Defensive guards around the new tax parsing after a live-mode hang report. main.js: tax pass wrapped in try/catch and gated by header-detected campaign name (only runs on imperial_campaign or ris_classic; other campaigns silently skip). App.js: taxLevel IIFE wrapped in try/catch with relaxed gating — when playerFaction isn't yet known, still shows the parsed value rather than holding the prop. If the hang persists, it's not from the tax pass itself; please share what UI state you see when it happens." },
    ],
  },
  {
    version: "0.9.203",
    date: "2026-05-05",
    items: [
      { type: "feature", text: "Live mode now shows per-settlement tax level (low/normal/high/very_high) parsed from the save. Discovered tonight via differential analysis: setting all of Sparta's 3 settlements to high/very_high/low produced exactly 3 byte transitions per save with values 2/3/0 against baseline=1. The tax byte sits at a fixed offset (settlement_name_offset - 2269) in every settlement record. Enum: 0=low, 1=normal (default), 2=high, 3=very_high. Gated to player-owned settlements only — the byte at that offset isn't meaningful for other factions' settlements in the player's save view (always reads 0). New 'Tax:' row in RegionInfo, color-coded (green=low, grey=normal, orange=high, red=very_high). New scripts/save-cracker/ directory contains the full reverse-engineering pipeline + RESEARCH.md dossier with 15 confirmed format facts." },
    ],
  },
  {
    version: "0.9.202",
    date: "2026-05-05",
    items: [
      { type: "improvement", text: "Export now warns when descr_regions.txt was edited: 'delete map.rwm from the campaign folder so RTW rebuilds it from descr_regions.txt + map_regions.tga next campaign load.' RTW caches descr_regions parsing into map.rwm; without regen the edits silently don't take effect in-game. Alert fires after the export confirm, only when descr_regions.txt was in the dirty set." },
    ],
  },
  {
    version: "0.9.201",
    date: "2026-05-05",
    items: [
      { type: "fix", text: "'+ Add new hidden resource…' button did nothing — Electron's renderer returns null from window.prompt by default. Replaced with an inline input + Add/Cancel that pops in place of the button. Enter commits, Escape cancels; validation errors render in-line in orange. Pre-seeds with the current legend search if it's a valid token." },
    ],
  },
  {
    version: "0.9.200",
    date: "2026-05-05",
    items: [
      { type: "feature", text: "Province ownership changes in dev mode now export to descr_strat.txt. New factionOwnerChanges state tracks {regionName → targetFactionId} per right-click → change owner. patchDescrStrat gained a third pass — applyOwnershipMoves — that parses descr_strat into preface + per-faction blocks (header / settlements / tail), brace-counts each `settlement { ... }` to extract its region name, then physically moves the matched block from its current faction's settlements list to the target faction's. Idempotent (moving to the current owner is a no-op), so reverts collapse cleanly. Faction edits now mark BOTH descr_regions.txt (rebel default) AND descr_strat.txt (campaign owner) dirty; the dirty-set + factionOwnerChanges are both cleared after a successful export." },
    ],
  },
  {
    version: "0.9.199",
    date: "2026-05-05",
    items: [
      { type: "feature", text: "Dev mode: define a brand-new hidden_resource. Hidden Resource legend now shows a dashed '+ Add new hidden resource…' button (devMode only). Click → prompt validates a lowercase/digit/underscore token, sets it as the active selection, and renders an inline 'new — 0 regions' banner with a hint to right-click provinces. The existing right-click 'Add 'X'' menu already toggles arbitrary tokens onto r.tags, so the new HR shows up in hiddenResourcesList automatically once attached to its first region. Search box doubles as a fast-path: typing a non-existing valid token relabels the button to '+ Add \"<query>\"'." },
      { type: "fix", text: "Faction map mode in dev mode now recolors a province immediately when you right-click → change owner. Previously applyDevEdit only updated descr_regions' rebel-default field (r.faction); the canvas reads from factionRegionsMap (descr_strat-derived) for owned regions, so the visible color didn't budge. Now also moves the region between factions in factionRegionsMap, which triggers the coloredOffscreen useEffect via its existing dep on factionRegionsMap. Note: descr_strat ownership patching on export isn't implemented yet, so the change is in-session only — re-importing the campaign restores original ownership." },
    ],
  },
  {
    version: "0.9.198",
    date: "2026-05-04",
    items: [
      { type: "improvement", text: "Region info Religion row now lists every religion in the region with its share (e.g. 'Pagan 50%, Mithras 33%, Jupiter 17%'), sorted strongest first. Percentage = rel_X_N strength as a fraction of total strength across all rel_* tags. Replaces the prior 'top + also'-with-strength-numbers layout, which was redundant with the bar chart underneath." },
    ],
  },
  {
    version: "0.9.197",
    date: "2026-05-04",
    items: [
      { type: "fix", text: "View pill now wraps to multiple rows on narrow windows (matches Map Modes behaviour). Was stuck at width:fit-content + no flex-wrap, so it'd push past the right edge instead of breaking onto new lines." },
    ],
  },
  {
    version: "0.9.196",
    date: "2026-05-04",
    items: [
      { type: "fix", text: "Settlement info: relabel 'Culture:' → 'Rebels:' (descr_regions field 4 is the rebel sub-faction that spawns when the region rebels, not the cultural identity). Tooltip clarifies the meaning." },
    ],
  },
  {
    version: "0.9.195",
    date: "2026-05-03",
    items: [
      { type: "feature", text: "'Homeland of:' row in region info — surfaces RIS's homeland-unhappiness mechanic. Computed by intersecting the region's tag tokens with each faction's homelands.json HR list. Non-native owners catch a happiness penalty in those regions, this row now makes that visible upfront." },
      { type: "feature", text: "Validate Mod Data button (dev mode only). Cross-checks every recruit unit referenced in EDB against the EDU ownership map, flags chains with zero recruits as info, dumps everything to a console.group at console-log severity. Toast summarises errors+info counts so the modder doesn't have to keep DevTools open just to see the headline." },
      { type: "skip", text: "Skipped (would have been overscoped for one ship): trade-route map mode (needs a save-file trade-route parser we don't have); compare two saves diff (needs save-loading machinery); per-army strength heatmap (needs new render-pipeline mode); predict-next-reform panel (needs descr_events / campaign_script trigger parser); settlement income breakdown (needs save-file income parser). Open to scoping any of these as their own ship." },
    ],
  },
  {
    version: "0.9.194",
    date: "2026-05-03",
    items: [
      { type: "improvement", text: "Building popup capability lines now resolve through text/expanded_bi.txt. RIS uses the `dummy <key> bonus N requires ...` syntax — the engine ignores `dummy`, but the in-game building browser shows the human-readable string keyed by `<key>` in expanded_bi.txt. get-building-stats now parses each capability line, looks up dummy keys in expanded_bi, and returns { raw, resolved } per capability. Popup renders the resolved text when available (with the raw EDB line as the hover-title for verification); the humanizer is the fallback for fixed engine capabilities (happiness_bonus, wall_level, etc.)." },
    ],
  },
  {
    version: "0.9.193",
    date: "2026-05-03",
    items: [
      { type: "feature", text: "Building popup: tier ladder (current level highlighted), 'Adds at this level' recruit chips, and humanized capability lines (happiness_bonus bonus 2 → '+2 happiness', wall_level 1 → 'Wall level: 1', etc.). get-building-stats now also returns chainLadder/tierIndex/tierMax/recruits[]." },
      { type: "feature", text: "Reload mod data button. New IPC clear-mod-caches drops every parse cache (EDB, EDU, text dictionaries, building stats, faction cultures); the App.js useEffect that fetches mod data is now keyed on a modReloadTick state so the click triggers a re-parse. Lets modders iterate without restarting Provincia." },
      { type: "feature", text: "EDB/EDU mtime watcher. New IPC get-mod-file-mtimes polls export_descr_buildings.txt / export_descr_unit.txt / text/export_units.txt / text/export_buildings.txt / descr_sm_factions.txt / descr_regions.txt every 4s. When any mtime exceeds the last-seen, the Reload button switches to active state with the mac-active-pulse animation, signalling 'your edit is unseen, click me'." },
      { type: "feature", text: "Hidden-resource cross-link. Hover a hidden_resource chip in the Tags row → every recruit gated on that HR lights up. Recruitable items now carry hrGates: [hrName, ...] populated from positive `hidden_resource X` clauses across both passes (currently-buildable and upgrade-only)." },
      { type: "feature", text: "Region info: 'Religion' text row showing the dominant rel_<X>_<level> tag (highest level wins) and up to three secondary religions. Complements the ethnicities chart, which conveys ancestry not creed." },
    ],
  },
  {
    version: "0.9.192",
    date: "2026-05-03",
    items: [
      { type: "change", text: "All scrollbars hidden across the entire app per request. Global !important rule overrides the previously-skinned .panel / .factions-panel rails AND the runtime-injected scrollbarSkin.js styling AND the new InfoPopup description / capability scrollers. Scroll behaviour itself is preserved (mouse-wheel still works); only the rail and thumb are visually hidden." },
    ],
  },
  {
    version: "0.9.191",
    date: "2026-05-03",
    items: [
      { type: "feature", text: "Building right-click popup now shows stats. New IPC get-building-stats walks the chain block in EDB to the matching `<level> requires` header, then extracts the level body via brace-balance: cost (denarii), construction (turns), settlement_min, and every capability line except recruits (those go to the recruitable column already). Capabilities render in a monospace block — happiness_bonus, gdp_bonus, farming_level, archer_bonus, wall_level / tower_level / gate_strength, etc. — same wording as in EDB." },
    ],
  },
  {
    version: "0.9.190",
    date: "2026-05-03",
    items: [
      { type: "improvement", text: "'Restart and install' now installs silently — no NSIS wizard click-through. autoUpdater.quitAndInstall(true, true): isSilent=true makes electron-updater pass /S to the installer so the wizard never appears; isForceRunAfter=true relaunches Provincia automatically when the install finishes. First-time installs (downloaded by hand) still go through the wizard — only the auto-update path is silent." },
    ],
  },
  {
    version: "0.9.189",
    date: "2026-05-03",
    items: [
      { type: "fix", text: "Building right-click popup now actually shows the wide _constructed banner AND its description. Two bugs were stacked: (1) RegionInfo's buildingItems mapping was dropping b.level and b.culture, so the right-click payload arrived with name=undefined/culture=null — resolveBuildingBanner bails immediately on missing levelName, and the description IPC missed culture-specific keys. Fix: include level + culture in buildingItems. (2) The description IPC was using unit-style suffixes (_descr / _descr_short), but text/export_buildings.txt uses _desc / _desc_short and most entries are culture-specific (e.g. {governors_house_barbarian_desc}). Fix: try <level>_<culture> → <level> → <chain>_<culture> → <chain>, with the right suffixes." },
    ],
  },
  {
    version: "0.9.188",
    date: "2026-05-03",
    items: [
      { type: "fix", text: "Taskbar / Start-Menu pins should now survive updates. Provincia never called app.setAppUserModelId(), so the running Electron process registered under a default AppUserModelID while NSIS set the installed shortcut's AUMID from package.json's appId. Windows tracks pins by AUMID — mismatch meant the pin's anchor went stale every reinstall and the icon disappeared. Now we explicitly call app.setAppUserModelId('com.example.interactive-map') on Windows at startup so the running app and the installed shortcut share one identity. Note: this fix only takes effect from the NEXT update onwards (the current pin is already orphaned)." },
    ],
  },
  {
    version: "0.9.187",
    date: "2026-05-03",
    items: [
      { type: "feature", text: "Upgrade-only recruit cards now show a tooltip with the cheapest path to make the unit recruitable. Format: 'Upgrade <chain> → <levelName>' if the chain is already built but at a lower level, or 'Build <levelName> (<chain>)' if the chain doesn't exist yet. Computed by scoring every (chain, level) recruit option by gap from the current build state and picking the smallest." },
      { type: "feature", text: "Right-click info popup now shows the in-game long-form description for both units and buildings. New IPCs get-unit-description / get-building-description read text/export_units.txt and text/export_buildings.txt (UTF-16 LE BOM aware), parse the {key}content multi-line dictionary format, and merge mod + game sources (mod wins). For units the EDU `dictionary` key is resolved automatically; for buildings the level name is tried first, chain name as fallback." },
    ],
  },
  {
    version: "0.9.186",
    date: "2026-05-03",
    items: [
      { type: "fix", text: "Vanilla recruits no longer leak into mod data. get-building-recruits / get-unit-ownership / get-building-chain-levels / get-unit-stats were merging vanilla EDB+EDU FIRST, then mod files, with last-wins per (chain, level). RIS doesn't redefine every vanilla (chain, level) pair (vanilla 'barracks' levels are named differently), so vanilla `recruit \"hoplite\"` lines stayed visible — Syracuse and other Greek-faction cities showed the vanilla 'Hoplite' unit, which doesn't exist in RIS at all. New helper getEdbSourceFiles(modDataDir, relPath) returns mod-only sources when a mod data dir is provided AND contains the requested file; falls back to vanilla install roots otherwise." },
    ],
  },
  {
    version: "0.9.185",
    date: "2026-05-03",
    items: [
      { type: "change", text: "Show in EDB / EDU now opens Notepad++ (with line jump via -n<line>) when installed, falls back to plain Notepad. Was opening VS Code via vscode://file/ URL — switched per request. Notepad++ paths checked: 'C:\\\\Program Files\\\\Notepad++\\\\notepad++.exe' and the (x86) variant. Spawned detached so the child editor outlives Provincia." },
    ],
  },
  {
    version: "0.9.184",
    date: "2026-05-03",
    items: [
      { type: "feature", text: "Recruitable list now shows units that COULD be recruitable if buildings were upgraded — not just the currently-buildable ones. Two-pass evaluator: first pass walks the city's actual built chains (currently available); second pass walks every chain × level in EDB but skips the building-present / tier-alias filters (keeps faction / hidden_resource / EDU ownership / not_is_player / major_event). Currently-buildable units render at full opacity; upgrade-only units render at 0.45 opacity with a slight grayscale + dashed outline. Hover tooltip says 'needs building upgrade' for the faded ones. Sorted with available units first." },
    ],
  },
  {
    version: "0.9.183",
    date: "2026-05-03",
    items: [
      { type: "feature", text: "Faction Wealth panel — new 'Wealth' button in View options opens a sortable list of every faction with their starting treasury (from descr_strat) and region count, ordered richest→poorest. Click a row to zoom-fit that faction's territory and select it. Treasury colour-grades by amount. New parseDescrStratFactionWealth in parsers.js + bundle outputs faction_wealth_<suffix>.json so the panel reads bundled data with no runtime cost." },
      { type: "feature", text: "Show in EDB / EDU buttons in the InfoPopup (dev mode). Right-clicking a building or unit card opens the popup; new buttons there call find-edb-chain / find-edu-type IPCs to locate the line, then open-source-file launches VS Code via vscode://file/<path>:<line> if installed (or the OS default editor as fallback). Lets modders jump from the visual to the source instantly." },
    ],
  },
  {
    version: "0.9.182",
    date: "2026-05-03",
    items: [
      { type: "fix", text: "Settlement-tier badge no longer wraps below the settlement name when the name is long. Switched the row to flex with baseline align, name flex-shrinks with ellipsis, badge stays put with whiteSpace: nowrap." },
      { type: "feature", text: "Live-save turn/year badge flashes bright gold for ~700ms whenever a new save is loaded (turn or year changed). Catches your eye when the watcher pulls in a new snapshot." },
      { type: "feature", text: "Live-save 'loaded Xm ago' label sits next to the turn/year badge — refreshes every 30s. Goes amber and warns 'watcher may be stale' once it crosses 10 minutes, useful on long campaigns." },
      { type: "feature", text: "Pin Faction toggle in the View options pill. When on AND a faction is selected, regions outside that faction's territory get a heavy black overlay (alpha 200 vs 90) so the empire reads as the foreground. Sticky preference; lives in localStorage." },
      { type: "feature", text: "Recruit ↔ building cross-link on hover. Hovering a building card lights up the recruit units it gates (amber background + outline). Hovering a recruit card lights up the building chain that gates it. Driven by a per-unit gatedBy set produced by the recruit evaluator (handles tier aliases / multiple gating chains)." },
    ],
  },
  {
    version: "0.9.181",
    date: "2026-05-03",
    items: [
      { type: "fix", text: "Building cards no longer reflow as you hover between regions. Long labels (e.g. 'nomad communal herding (husbandry)') wrap to 4 lines while short labels are 1 line — the grid was sizing rows to whichever was tallest in that specific region, so cards jumped vertically when the cursor moved. Each card now has minHeight: 118px (icon 48 + 4-line label cap + padding) and the grid uses gridAutoRows: 118px, so every row across every region is the same height." },
    ],
  },
  {
    version: "0.9.180",
    date: "2026-05-02",
    items: [
      { type: "fix", text: "Search dropdown was clipped by the right-column container's overflow:hidden — appearing behind the Recent panel and inducing a system scrollbar as the column tried to grow. The dropdown now portals onto document.body with fixed positioning derived from the input's bounding rect, so it floats above every panel. Drop-shadow added for depth." },
    ],
  },
  {
    version: "0.9.179",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Dev RGB row now visualises the colour: a 12px swatch plus the hex value tinted in the actual region colour. Dim colours get lifted toward white so the hex stays legible against the panel; bright colours render as-is." },
    ],
  },
  {
    version: "0.9.178",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Mac-style animation system. Apple's typical spring easing curves (cubic-bezier(0.32, 0.72, 0, 1) and cubic-bezier(0.34, 1.56, 0.64, 1)) applied across the UI. Faction tiles cascade in with a staggered scale-up spring on first mount; map-mode buttons get smoother hover/transitions; the active map-mode button gets a slow amber glow pulse; toasts slide in from the right with a settle; search dropdown + dev right-click menu pop in from their anchor; the auto-update progress bar gets diagonal-stripe shimmer. All animations honour `prefers-reduced-motion: reduce`." },
    ],
  },
  {
    version: "0.9.177",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Recent settlements strip's horizontal scrollbar is now hidden, matching the rest of the panels. Used the existing .resource-panel-scroll class plus inline scrollbar-width:none for Firefox." },
    ],
  },
  {
    version: "0.9.176",
    date: "2026-05-02",
    items: [
      { type: "fix", text: "Rome (and any other Roman city) was showing only AOR-flavoured recruits — never the actual Roman early units (roman hastati early, leves, principes, etc.). The recruit filter dropped any line containing `major_event` regardless of polarity. RIS gates pre-Marian Roman troops with `not major_event \"marian_reforms\"` (i.e. available BEFORE reforms); we were treating that as a positive trigger and rejecting them. The check now uses a negative-lookbehind to drop only positive `major_event \"X\"` clauses; the `not major_event \"X\"` form passes through. Same fix applied to both the bottom-panel recruit evaluator and the recruitment-density map mode." },
    ],
  },
  {
    version: "0.9.175",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Pop Cap row reformatted: 'Pop Cap: level 11 · ~16,500' (was just 'Pop Level: 11') so the descr_regions 1-15 scale is paired with a count estimate." },
      { type: "improvement", text: "Settlement-tier badge colour-grades by tier — grey village, tan town, bronze large town, silver city, gold large city, bright gold huge city. Scan-by-colour for settlement size." },
      { type: "improvement", text: "Ethnicities row dropped the redundant coloured-dot legend below the bar; the bar's segment titles already convey ethnicity / percent on hover. Bar height bumped from 8px to 10px to compensate. Whole row also has a single hover title summarising all groups." },
      { type: "change", text: "Tag chip category 'Other' renamed to 'Hazards & Trade' (only fires for earthquake / rivertrade)." },
      { type: "feature", text: "Search dropdown shows '+N more — refine search' when matches exceed the visible 8." },
      { type: "improvement", text: "Recent regions strip is now single-line with horizontal scroll; new 'clear' link in the strip header. Doesn't push the search down on small screens any more." },
      { type: "feature", text: "Dev right-click menu has a new universal '📋 Copy descr_strat block' item — generates the settlement { … } block in descr_strat format (level, region, population, faction_creator, building list) and copies to clipboard. Useful for porting between mods or test branches." },
      { type: "improvement", text: "Hover throttling: setRegionInfo now skips re-renders when the cursor stays within the same region (uses an updater function that returns the previous reference unchanged). Mouse-move was firing per pixel and creating new objects 60+ times per second on continuous hover." },
    ],
  },
  {
    version: "0.9.174",
    date: "2026-05-02",
    items: [
      { type: "change", text: "Religion row dropped from the Tags chip block — the ethnicities chart already conveys the religious split per region, so surfacing rel_*_N as chips too was redundant noise. Tags now show: Terrain, Climate, Irrigation, Port, Fertility, Other, Hidden Resource." },
    ],
  },
  {
    version: "0.9.173",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Region info column re-ordered: Settlement / Faction / Culture / RGB / Fertility / Pop Level → Ethnicities chart (back to its original spot) → Resources → Tags → modeExtra. Dropped the ethnicities `minHeight: 58` reservation so when the chart is short the Resources/Tags sit close underneath instead of floating with empty space." },
    ],
  },
  {
    version: "0.9.172",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Tags moved up in the region info column — now sit right after Resources, above the ethnicities chart and modeExtra. Closes the gap between the Culture / Fertility / Pop info and the tag chips." },
      { type: "improvement", text: "Fertility number is now colour-tinted with the same red → yellow → green gradient as the Fertility map mode (val/14). 14 reads as super green, 1 as red, 7 as yellow." },
    ],
  },
  {
    version: "0.9.171",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Resources block in the region info bar moved up — now sits right after the Pop Level row, above the ethnicities bar / modeExtra / tag chips. More prominent in the visual hierarchy." },
      { type: "improvement", text: "Recruitable grid widened from 5 columns to 6, giving more breathing room when a city has a long unit list." },
    ],
  },
  {
    version: "0.9.170",
    date: "2026-05-02",
    items: [
      { type: "fix", text: "Resource icons now load eagerly. The preload effect was gated on `colorMode === 'resource'`, so the region info bar's resource chips appeared as text-only until the user had visited resource map mode at least once. Removed the gate — resourceImages populates whenever resourcesData is loaded, so chips always show their icons." },
    ],
  },
  {
    version: "0.9.169",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Region info bar now shows the region's resources — chips with the icon, name, and ×N count for duplicates. Pulled from the bundled resourcesData by region or settlement name. Icons appear when the resource map mode has been visited (resourceImages is loaded then); otherwise text-only chips render." },
      { type: "fix", text: "'Farm Level: 5' was the same on every region — descr_regions field 7 is a constant placeholder in RIS, the real fertility lives in the Farm## tag (Farm1..Farm14). The row now parses that tag and shows e.g. 'Fertility: 11 / 14'. Falls back to the raw field-7 value if no Farm## tag is present (other mods)." },
    ],
  },
  {
    version: "0.9.168",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Region info polish batch — (1) Settlement-tier badge: a small amber pill next to the Settlement name shows the descr_strat level (town / large town / large city / etc.). (2) 'Population Level' renamed to 'Pop Level' so it doesn't read like a population count. (3) Tags grouped into labelled, colour-tinted chip rows (Terrain / Climate / Irrigation / Port / Religion / Fertility / Other / Hidden Resource) instead of one flat blob. (4) Faction row now surfaces 'rebels → X' as an italic hint when the descr_strat owner differs from descr_regions' rebel-default — makes Corsica's corsi → romans_julii rebellion path visible at a glance." },
    ],
  },
  {
    version: "0.9.167",
    date: "2026-05-02",
    items: [
      { type: "change", text: "'City:' label renamed to 'Settlement:' in the region info bar — 'city' clashes with the descr_strat settlement-level value (village / town / large_town / city / large_city / huge_city). Search input placeholder and the double-click-copy tooltip updated to match." },
      { type: "improvement", text: "Faction row now runs raw faction ids through factionLabel(), so a region with no live save still shows the friendly display name (e.g. 'Romans Julii' instead of 'romans_julii') when descr_sm_factions provides one." },
      { type: "improvement", text: "Dev-mode RGB row now shows both decimal and hex (e.g. '200,14,15  #C80E0F') so colours are pickable in any image editor without conversion." },
    ],
  },
  {
    version: "0.9.166",
    date: "2026-05-02",
    items: [
      { type: "fix", text: "City row in the region info bar now matches the styling of Faction / Culture / Farm Level / etc. — bold label inline with the value, no `space-between` push to the far right. The 0.9.162 double-click-to-copy hook had switched the row to a flex layout with custom colours, which made it look out of place. Kept the double-click-copy gesture and tooltip; only the styling was reverted to the shared `row()` look." },
    ],
  },
  {
    version: "0.9.165",
    date: "2026-05-02",
    items: [
      { type: "fix", text: "Region info Faction line now shows the descr_strat owner, not descr_regions' rebel default. Corsica was displaying 'romans_julii' (rebel default) instead of 'corsi' (actual starting owner). The liveOwner prop's resolution chain (currentOwnerByCity → initialOwnerByCity → null) was gated on liveLogActive — but initialOwnerByCity is populated from the get-initial-ownership IPC at boot regardless of save state. Drop the gate so the strat owner overrides the rebel default whenever it's available. Same root cause as the recruitment fix in 0.9.140; this rounds out the display side." },
    ],
  },
  {
    version: "0.9.164",
    date: "2026-05-02",
    items: [
      { type: "improvement", text: "Hidden the Electron menu chrome (File / Edit / View / Window). Menu.setApplicationMenu(null) at app level + autoHideMenuBar:true on the window. Cleaner full-screen feel; menu is gone entirely (not Alt-toggleable)." },
      { type: "change", text: "Reverted the marble toggle from 0.9.163. Marble texture is back to always-on per the original design." },
    ],
  },
  {
    version: "0.9.163",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Marble toggle in the View options pill — turn off the parchment marble backdrop for a flat colour, cleaner for screenshots and streaming. Persisted across sessions in localStorage." },
    ],
  },
  {
    version: "0.9.162",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Keyboard shortcuts: Ctrl+F focuses the search box; Ctrl+1..9 switches map mode (Faction / Victory / Culture / Religion / Population / Fertility / Resources / Homeland / Government); Esc cascade closes overlays in order (info popup → dev context menu → legend filter → search → selection → lock); ',' / '.' steps through the recent-regions backstack." },
      { type: "feature", text: "Live save mode: turn / year badge in the right-column header (T123 · 247 BC), pulled straight from the loaded save's header so you always know what point in the campaign you're inspecting." },
      { type: "feature", text: "Double-click the region or city name in the bottom info bar to copy it to the clipboard. Cursor changes to a copy cursor on hover; tooltip explains the gesture." },
      { type: "improvement", text: "Search input placeholder now mentions the Ctrl+F shortcut." },
    ],
  },
  {
    version: "0.9.161",
    date: "2026-05-02",
    items: [
      { type: "change", text: "Removed Religion Mix map mode. Coloring branch, legend, and getModeExtra entry all dropped." },
    ],
  },
  {
    version: "0.9.160",
    date: "2026-05-02",
    items: [
      { type: "change", text: "Wealth, Pop Headroom, and Recruitment map modes moved from the main map-mode pill into the dev section. Religion Mix stays in the main pill." },
    ],
  },
  {
    version: "0.9.159",
    date: "2026-05-02",
    items: [
      { type: "fix", text: "Splash now waits for mod-folder faction icons too. The previous preload only fetched bundled TGAs; with a mod folder configured (RIS), each FactionIcon component lazy-loaded its mod-side icon AFTER splash dismissed — producing a visible pop-in as faction tiles streamed in. Added preloadModIcon() that fetches every active faction's mod-folder TGA up front and populates the same cache key FactionIcon uses on mount, so the first render hits cache. Splash gating dependency includes modIconsDir so the wait fires whenever the mod is active." },
    ],
  },
  {
    version: "0.9.158",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Auto-update download progress is now visible. The version label in the right-column header shows an amber underline that fills 0→100% while electron-updater downloads the new installer in the background, plus an inline percentage. The main process was already broadcasting `state: 'downloading', percent: N` events (since 0.9.x) but the renderer was ignoring that branch — added a state slot and a thin progress strip on the version chip. Tooltip also reflects the live percentage on hover." },
    ],
  },
  {
    version: "0.9.157",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Pre-export validation extended with two more checks: (1) regions owned by non-rebel factions that have ZERO recruitable units (almost always means a missing entry in EDU `ownership` lines), and (2) hidden_resources that EDB recruit lines reference but no region in descr_regions actually carries. Both fire only when buildingRecruits / unitOwnership are loaded so the validation is accurate." },
    ],
  },
  {
    version: "0.9.156",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Four new map modes: Religion Mix (homogeneous→diverse, surfaces unrest risk), Pop Headroom (empty→capped, surfaces growth potential), Wealth (poor→wealthy, sums resources + farm × 2 + port × 4 as a crude income proxy), Recruitment (count of unique units each region can train, runs the same EDB filter the bottom panel uses). Each mode has its own gradient legend and bottom-panel readout." },
    ],
  },
  {
    version: "0.9.155",
    date: "2026-05-02",
    items: [
      { type: "feature", text: "Search results now highlight the matched substring in amber so the eye locks onto it instantly." },
      { type: "feature", text: "Recently-viewed regions backstack: a small ↶ Recent strip in the right column with the last 5 cities you locked, so you can flip between two settlements without re-finding them on the map. Active region gets the amber outline." },
      { type: "feature", text: "Hover-state readout in the garrison panel header. Mousing over a unit card surfaces 'name · soldiers · chevrons · armour · weapon' inline next to 'Garrison:' (and the field-army header), making it readable without squinting at the OS tooltip floater." },
      { type: "feature", text: "Roster diff badge: when a save is loaded, the garrison header shows '+N / −M since turn 0' comparing the current unit-name multiset against the descr_strat starting garrison. Lets you see at a glance whether a city's been reinforced or stripped." },
    ],
  },
  {
    version: "0.9.154",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Live-mode garrison: chevrons / armour / weapon icons now also seed when the live-save data comes via the legacy `saveArmiesData` path (not just the new `saveUnitsByRegion` parser). Restructured so the seed-merge from starting_armies_*.json runs after normalisation, regardless of which save path produced it. Mid-campaign recruits without a matching turn-0 seed still default to 0; full binary extraction of exp/armour/weapon from the save format would be needed for those, requires diffing two known saves to identify offsets." },
    ],
  },
  {
    version: "0.9.153",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "ChevronStack SVG dropped from 9×(count×4+1)px to 6×(count×3+1)px so it sits more discreetly in the corner." },
    ],
  },
  {
    version: "0.9.152",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Chevron rendering switched from text glyph 'ˇ' to inline SVG. At the 7-8px sizes the unit cards demand, the text glyph rendered as a barely-visible dot in the corner — Rome's units showed nothing despite descr_strat exp 3. The new ChevronStack component draws stroke-based angular Vs (RTW-style) sized to the tier colour, with a black drop-shadow halo for legibility against bright unit portraits. 1-3 chevrons stack vertically in the top-left corner." },
    ],
  },
  {
    version: "0.9.151",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Chevron count corrected — exp value IS the chevron level directly, no -1 offset. exp 0 → no chevron, exp 1 → 1 bronze, exp 2 → 2 bronze, exp 3 → 3 bronze (Rome's garrison), exp 4 → 1 silver … exp 9 → 3 gold. The earlier -1 offset was based on a misreading of the Friniatia feedback." },
    ],
  },
  {
    version: "0.9.150",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Chevrons / shields / swords now show in live-save mode too. Rome's garrison ships exp 3 armour 1 in descr_strat (so 14 of 15 units should display 2 bronze chevrons + 1 bronze shield), but with a save loaded the live-save code path normalised units to {unit, soldiers, max} — the binary save format doesn't carry exp/armour/weapon, so those fields were dropped. Both garrison and field-army paths now seed from the bundled starting_armies_*.json by unit name (FIFO match within the region), preserving turn-0 chevrons/upgrades on save-loaded views." },
    ],
  },
  {
    version: "0.9.149",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "Chevrons moved from top-right to top-LEFT corner of each unit card. Bronze tier shifted to a clear reddish-brown #8a4f1f (was a tan #b6843a that read as gold/yellow at small sizes against bright unit cards). Removed the stroke + drop-shadow on shield/sword SVGs — at 8px the black blur dominated the fill and washed the colour. Solid fills now read true." },
    ],
  },
  {
    version: "0.9.148",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "Unit-card badges retuned. Shield + sword icons moved to bottom-left so they don't sit on top of the chevron position (chevrons stay top-right). Icons shrunk from 11px to 8px. Chevron font dropped from 0.55rem to 0.45rem. Bronze tier colour darkened from #d8b96b (read as gold/yellow on bright cards) to #b6843a — clearly distinct from gold #f5cd3a now. Sword icons render fine; you'll see them only on units with weapon_lvl ≥ 1 in descr_strat (e.g. Friniatia ships weapon_lvl 0 so its garrison shows just shields)." },
    ],
  },
  {
    version: "0.9.147",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Shield (⛨ U+26E8) and sword (⚔ U+2694) Unicode glyphs aren't in the default Windows fonts the renderer uses, so they showed as literal '\\u26E8' / '\\u2694' escape strings on user machines. Replaced with inline SVG shield + sword icons that always render regardless of font coverage. Tier colours apply via SVG `fill`. Drop shadow on the glyph for legibility against bright unit cards." },
    ],
  },
  {
    version: "0.9.146",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "Chevron / armour / weapon icons now use proper RTW tier colours (bronze / silver / gold). Chevrons stack 1-3 per tier (exp 2-4 → 1-3 bronze, 5-7 → 1-3 silver, 8-10 → 1-3 gold). Armour and weapon are colour-only progression with one icon (no stacking) — bronze at lvl 1, silver at 2, gold at 3. Upgrade icons moved to top-center of each unit card (matches RTW's in-game layout). Tooltip surfaces the tier name." },
    ],
  },
  {
    version: "0.9.145",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Chevron threshold corrected: descr_strat exp 1 now displays as 0 chevrons (matches in-game — RTW's first chevron appears at exp 2). Visible count = exp - 1." },
      { type: "improvement", text: "XP icon switched from ▲ triangle to a chevron-style ˇ glyph in monospace, stacked when count > 1." },
      { type: "feature", text: "Armour and weapon-upgrade icons now show on each unit. Bundle and dev-import parsers extract `armour N` and `weapon_lvl N` from each descr_strat unit line; renderer shows ⛨ shield (blue) per armour level and ⚔ sword (orange) per weapon level on the top-left of the card. Tooltip lists exact values. Friniatia's celtic swordsmen / spearmen ship with armour 0 / weapon_lvl 0 so they stay clean; upgraded garrisons now read at a glance." },
    ],
  },
  {
    version: "0.9.144",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Bundle script's army parser now captures `exp N` from each unit line (both garrisoned_army and character-tied army blocks). Previously it grabbed only the unit name and the JSON consumer hardcoded exp=0, so users on the bundled JSON saw no chevrons even though descr_strat carries `exp 1` (Friniatia's celtic swordsmen / spearmen, Rhegion's campanian stack, etc.). The dev-import path was already correct; this aligns the bundle path so users who don't re-import see the same chevrons as users who do." },
    ],
  },
  {
    version: "0.9.143",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Dev-import path now also captures garrisoned_army blocks. The renderer-side parseDescrStratArmies in src/parsers.js was a separate code path from the bundle script; it only handled character-tied army/navy blocks, so when you re-imported your mod the freshly-parsed result REPLACED the bundled garrisoned_army entries from 0.9.142 with nothing — and slave settlements went empty again. Parser now tracks settlement-block context, captures the bare unit lines under garrisoned_army, and tags each entry with its region. The dev-import classifier in App.js then pins these to the settlement tile via the same TGA pixel walk used for character-tied armies." },
      { type: "change", text: "Ship workflow: every release now re-runs `npm run bundle-data` first to pull the latest files for both Imperial and Classic campaigns, so team members who forget to re-import their mod data still get fresh JSONs in the shipped exe." },
    ],
  },
  {
    version: "0.9.142",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Slave / rebel garrisons now show the actual descr_strat units, not a guessed pool. The bundle armies parser only captured `character` blocks (named-general armies); it ignored `garrisoned_army` blocks defined per-settlement (no character, no coords — just bare `unit` lines under the settlement). RIS uses garrisoned_army for almost every slave settlement (Friniatia: 1 celtic swordsman + 1 celtic spearman, Rhegion: full campanian stack, etc.), so 497 of 499 slave settlements were rendering empty. Parser now snaps these to the settlement tile via the surrounding region context, and a new starting_armies_*.json is produced at bundle time so the renderer no longer needs a dev-import to see them." },
      { type: "fix", text: "Reverted 0.9.141's wrong rebel-pool fallback. descr_rebel_factions.txt's pool drives PROCEDURAL REVOLTS (peasant_revolt, brigands, gladiator_revolt, pirates), not turn-0 garrisons; the game doesn't spawn random units from it at game start." },
      { type: "fix", text: "EDB alias parser now captures bare 'building_present <chain>' (no level) branches — previously the `or building_present garrison` half of mic_tier_1 was silently dropped, so 167 settlements that start with a garrison chain weren't getting credit toward mic_tier_1 satisfaction. Recruit-requires evaluator also handles direct 'building_present X' clauses (with optional 'not' and skipping the 'queued' modifier we have no data for)." },
    ],
  },
  {
    version: "0.9.140",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Settlements where descr_regions' rebel-default faction disagrees with descr_strat's actual owner now show the correct faction's recruits without needing a save loaded. Previously initialOwnerByCity (descr_strat-derived) only flowed to the renderer via the save-watch path; without a save, recruit evaluation fell back to r.faction (the rebel default in regions_large.json), which for Corsica points to romans_julii while the actual starting owner is corsi — so the user saw Roman-only recruits instead of corsi/AOR units. Added a get-initial-ownership IPC the renderer pulls right after charactersInit so the ownership map is available from boot." },
    ],
  },
  {
    version: "0.9.139",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Cross-faction unit-card fallback. AOR units like 'aor roman rorarii' (dictionary roman_rorarii) have their icon under romans_julii/, not the recruiting faction's folder or mercs/. The resolver only checked those two, so 696 / 11 633 faction×unit combos (6.0%) rendered blank. Now after the strict lookup fails, both resolve-unit-card and resolve-unit-info fall through to scanning every faction subdir under ui/units/* and ui/unit_info/* for the filename. Audit drops missing rate to 0.3%; the remaining 39 cases are units the RIS mod author hasn't shipped icon files for at all (messenian_hoplites, iberian_cataphracts, dravidian_warriors) — nothing the resolver can do without source files." },
    ],
  },
  {
    version: "0.9.138",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "All panel text was rendering black in dark mode after 0.9.136. The light-mode contrast observer set inline colour to rgb(26,26,26); on dark-mode entry the luminance gate (>130) skipped those elements before reaching the restore branch, so they stayed black. Restored colours now restore unconditionally in dark mode, before the luminance check." },
    ],
  },
  {
    version: "0.9.137",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "Light-mode panels now show the marble texture through. Panel opacity dropped from 0.72 to 0.45 with a slightly warmer tint, plus a faint inset top-highlight (1px white at 25%) so panels still read as carved against the now-visible marble. Marble darkening unchanged. Text contrast handled by the JS observer from 0.9.136 — accents still pop, body text stays readable." },
    ],
  },
  {
    version: "0.9.136",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "AOR / mercenary unit cards now display. EDU stores 'type aor X Y' with 'dictionary X_Y'; the icon files use the dictionary name (e.g. mercs/#X_Y.tga), not the type-derived 'aor_X_Y'. The unit-ownership IPC now also captures dictionary per type, and resolve-unit-card / resolve-unit-info try the dictionary form first (then plural-stripped, then aor_/merc_ prefix-stripped). Affects ~hundreds of AOR recruit lines that were rendering blank." },
      { type: "fix", text: "Negated tier requirements ('gov_tier_1 and not gov_tier_3' etc.) were being treated as positive — i.e. a province with only gov_tier_1 was rejected because gov_tier_3 wasn't satisfied. Affected ~160 recruit lines, mostly mid-tier AOR variants. Now positives and negatives are evaluated separately." },
      { type: "fix", text: "Direct 'building_present_min_level <chain> <level>' clauses in recruit requires (with optional 'not') are now evaluated against the city's built buildings. ~398 recruit lines used these directly (port-gated naval AOR units etc.); previously they showed up regardless of whether the player had the building." },
      { type: "fix", text: "Light-mode text contrast actually works now. The previous CSS attribute selector approach didn't fire because Chromium normalises 'style=\"color: #eee\"' to 'color: rgb(238, 238, 238)' after React sets it. Replaced with a JS observer that walks .panel descendants on every mutation, detects greyish (low-saturation) inline colours above a luminance threshold, and overrides them to near-black in light mode while remembering the original so they restore on dark-mode switch. Saturated accents are gated out via a max-min channel-spread check." },
      { type: "improvement", text: "Toasts deduplicate now. Mashing the version number to check for updates no longer stacks identical toasts — instead the existing one stays put with an '×N' counter, and its expiry timer refreshes on each repeat." },
    ],
  },
  {
    version: "0.9.135",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "Light mode now keeps the warm parchment panels but force-overrides the inline pale text colours from the dark-mode-first styling. CSS attribute selectors catch the common pale values (#eee/#fff/#f6.../#e6.../#ddd/white/rgba whites, plus the grey range #888/#aaa/#bbb/#ccc/#999/#777) inside any .panel and remap them to dark equivalents — saturated accents like #dca64a / #e8a030 are deliberately left alone. Net: parchment panels back, text readable, accents intact." },
    ],
  },
  {
    version: "0.9.134",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "Light mode is now actually dimmer. Panels and welcome cards stay dark-glass in both modes — the app has 130+ inline white text colours inside panels that were unreadable on the previous parchment surface. Only the canvas / marble varies between modes (and the marble's light-mode darkening pushed from 12% → 25% so the texture itself stops feeling glaring). Net: white text stays readable, light mode no longer feels like a glare wall." },
    ],
  },
  {
    version: "0.9.133",
    date: "2026-05-01",
    items: [
      { type: "improvement", text: "Light mode toned down. Panels are now a warm parchment off-white at 72% opacity (was almost-pure-white at 85%), text shifted to a warmer dark brown to match. Onboarding / What's New cards got the same parchment treatment. The marble background also stops getting a +10% white wash in light mode — that was pushing the bright marble texture into glare; it now gets a small darkening instead, like dark mode does." },
    ],
  },
  {
    version: "0.9.132",
    date: "2026-05-01",
    items: [
      { type: "fix", text: "Seleucid (and other AOR-heavy factions) no longer show empty recruit lists. RIS uses 'factions { all, }' in EDB and 'ownership all' in EDU as a wildcard for AOR units (every faction passes; narrowing happens via hidden_resource and 'not factions { ... }'). Our recruitment filter didn't recognize 'all', so AOR recruits were dropped — most factions still had plenty of specific lines, but Seleucid leans on AOR (greek_aor / syrian / macedonian / judaean tags per province) and went mostly empty. Both filters now treat 'all' as a wildcard; the field-army owner classifier got the same treatment." },
      { type: "fix", text: "Welcome / changelog cards no longer show on every launch. WelcomeScreen had a defensive 'stale-saved-version' check meant for an old test-build numbering migration: if lastSeenVersion was higher than the topmost changelog entry, it forced onboarding back. Once the app version outpaced the newest changelog entry (0.9.130 > 0.9.128 in changelog.js) the check fired forever. Dropped the check — persisted state is now authoritative, so onboarding shows once and changelog only shows on the first launch after a real new entry." },
      { type: "change", text: "Removed the 'Checking for updates…' toast from the manual update check. The result toast (available / downloaded / on-latest / error) follows fast enough that two toasts is just noise." },
    ],
  },
  {
    version: "0.9.128",
    date: "2026-04-30",
    items: [
      { type: "feature", text: "Hidden-resource map mode is now editable. Right-click a region with a token picked in the legend → menu shows current state ('Currently has X' / 'Currently doesn't have X') and a single toggle ('Add X' / 'Remove X'). Adding appends the token to the region's tag list, removing strips it; legend counts and map coloring update live, and descr_regions.txt is marked dirty so the standard export carries the change." },
    ],
  },
  {
    version: "0.9.127",
    date: "2026-04-30",
    items: [
      { type: "fix", text: "0.9.126 launched to a black window — the new hiddenResourcesList useMemo referenced homelandsData ~400 lines before its useState declaration, hitting a TDZ on first render ('Cannot access To before initialization'). Moved the useMemo down to live right after the homelandsData useState so the references resolve in order." },
    ],
  },
  {
    version: "0.9.126",
    date: "2026-04-30",
    items: [
      { type: "improvement", text: "Hidden-resource list grouped into Faction / Ethnic / Settlement / Area of Recruitment / Mercenary / Other, with collapsible cultures-style group headers (count + region total per group). Classification is data-driven: Faction = homelands.json membership, Ethnic = region ethnicities, Settlement = matches a region.region or .city, AoR = _aor suffix, Mercenary = contains 'merc', else Other." },
      { type: "fix", text: "Hidden-resource picker click is fast now. Precomputed a per-region WeakMap once per selection so the 15M-pixel canvas pass is a Map lookup instead of a string split per pixel. Also skipped the dev border path for hidden_resource — its 15M-pixel scan was the rest of the click lag, and binary borders aren't visually useful for arbitrary tokens." },
    ],
  },
  {
    version: "0.9.125",
    date: "2026-04-30",
    items: [
      { type: "fix", text: "Hidden-resource picker now lives in the bottom-left legend panel itself (which was the 'outliner' meant) — every token in the campaign listed inline with swatch + name + count, search box reuses the shared legendSearch like other modes. Removed the separate sidebar component; right-column outliner is back to Selected Provinces / faction summary." },
    ],
  },
  {
    version: "0.9.124",
    date: "2026-04-30",
    items: [
      { type: "improvement", text: "Hidden-resource picker restyled to match the Culture/Religion legend: title with total token count, shared 'legend-search-input' search box, then a flat compact list where each row is a 10×10 swatch + capitalized name + (count). Active row gets the amber background and outline (cultures' selection treatment); other rows fade to 0.55 opacity when something is selected. Replaces the previous boxy button-list look." },
    ],
  },
  {
    version: "0.9.123",
    date: "2026-04-30",
    items: [
      { type: "improvement", text: "Hidden-resource picker moved from a top-left dropdown into the right sidebar — replaces the outliner panel (Selected Provinces / faction summary) while 'Hidden Res.' mode is active, and reverts on any other mode. Same scroll area, search box, and per-token region count, just with proper vertical room (no more 80-token clamp / 'refine search' message)." },
    ],
  },
  {
    version: "0.9.122",
    date: "2026-04-30",
    items: [
      { type: "feature", text: "New dev map mode: 'Hidden Res.'. Picks one hidden_resource token from a searchable list of every token found in descr_regions tags (296 in the Large campaign), then highlights the regions that carry it — green for match, dim brown for not. Tokens are everything in the tag list that isn't terrain/climate/irrigation/port_level/Farm##/rel_*_##/rivertrade/earthquake. Region info bottom bar shows the selected token's yes/no, or the full hidden-resource list when no token is picked." },
    ],
  },
  {
    version: "0.9.118",
    date: "2026-04-27",
    items: [
      { type: "improvement", text: "Building card layout: icon frame 70×56 → 60×48, padding 6×4 → 4×3, label clamp 3 → 4 lines, font 0.72rem → 0.7rem. Frees vertical room so 'Region Information', 'Governor's Palace', 'Local Barracks' fit without ellipsis at the 82px card width." },
      { type: "improvement", text: "Steam path is now auto-detected via libraryfolders.vdf (Steam library config) — works for users with Steam installed on a non-default drive (D:/SteamLibrary, E:/, etc.). Mac install path also recognized." },
      { type: "improvement", text: "Faction-display, faction-culture, ui-buildings, and building-display caches are now bounded LRUs (16 entries each). Previous unbounded Map would grow forever as users switched mods." },
      { type: "fix", text: "TGA decoder: malformed/0×0/oversized headers now return empty TGAs instead of throwing. Icon resolver expects null-on-failure; deep exceptions in decode were caught but logged noisily." },
      { type: "change", text: "Removed dead code: pickGenericCategory in main.js was unused after the descr_ui_buildings.txt-based resolver replaced it." },
    ],
  },
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
