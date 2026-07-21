/**
 * Changelog entries, newest first.
 * Each entry: { version, date, items: [{ type, text }] }
 * Types: "feature", "fix", "improvement", "change"
 *
 * Display versions only — the 4th segment in package.json (e.g. "0.9.2.10") is a
 * silent iteration counter for test builds and is stripped before gating/display.
 *
 * CAP: keep only the last ~5 versions here. WelcomeScreen imports and parses
 * this whole module on every post-update launch, and it had grown to 827KB /
 * 8,623 lines (2026-07-16). When adding a new entry, move the oldest one to
 * docs/changelog-archive.js (npm run ship warns when this file grows past 8).
 */
const CHANGELOG = [
  {
    version: "0.9.1359",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Fixed missing road halves.** The game splits every road at the province border, and a road from a province with roads into one without is still drawn in full by the game — but Provincia was hiding the half lying in the roadless province. Roads are now filtered per link (drawn if either side has roads, exactly the game's rule), so roads run their full length again." },
      { type: "fix", text: "**Cleaned up tangled road clusters (southern Sardinia and elsewhere).** Neighbouring provinces each store their own copy of shared border roads, and drawing both near-identical copies as fine lines produced a tangled look. Same-route copies are now merged (275 across the map) while genuinely distinct alternative roads — like the route through a settlement versus around it — are kept." },
    ],
  },
  {
    version: "0.9.1358",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Fixed remaining road loops and dots.** Two causes: (1) very short roads (like a settlement's harbour link) could have both ends pulled into the same junction, turning them into small circles — junction merging now never collapses a road onto itself; (2) roads the game draws along land strips too narrow to exist at map resolution (e.g. coastal spits) were being squashed onto a single shore pixel — those are now omitted, since that water shows as blue in Provincia and roads never sit on blue." },
      { type: "fix", text: "**Restored roads that run through settlements (e.g. Olbia-Sardinia) and minor spurs (e.g. up to Pluvium).** The previous version's duplicate-removal was too aggressive: when two road pieces connected the same two junctions by different routes, it kept only the shorter one — but those are often two real roads (one through the settlement, one around it). Every road piece the game draws is now drawn." },
    ],
  },
  {
    version: "0.9.1357",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Fixed looping/tangled roads (e.g. Caralis ⇄ Neapolis-Sardinia).** The game stores some road links twice, along two slightly different routes; drawn together the pair made a loop or hook. Provincia now keeps only the single most-direct route for each connection, so roads read as one clean line between settlements. Removed ~750 duplicate route pieces across the map." },
    ],
  },
  {
    version: "0.9.1356",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Roads no longer cut off between regions.** The game builds each road as separate per-region pieces that meet at the province border, and those pieces stopped a pixel or two short of each other — invisible in-game under the thick road texture, but showing as a gap in Provincia's fine lines (e.g. the road from Uelis to Caralis). Road pieces that meet at a junction are now snapped together, so roads run unbroken from settlement to settlement." },
    ],
  },
  {
    version: "0.9.1355",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Settlement→port roads now show for every port, even where no roads are built.** A settlement with a harbour always has a short road down to its port — but these were being hidden in regions that had a port yet no built roads (e.g. Baliares_Maiores). Port connectors now draw wherever the region has a port, matching the game." },
    ],
  },
  {
    version: "0.9.1354",
    date: "2026-07-21",
    items: [
      { type: "improvement", text: "**Roads now cover every province, using the game's actual drawn curves.** The road network is no longer limited to the regions that happened to be captured — it now spans the whole map, from Iberia to the Near East and every island, with each road following the exact organic curve the game draws. Roads draw only where the loaded game actually has roads, so what you see matches your campaign. Single clean lines throughout, always on land." },
    ],
  },
  {
    version: "0.9.1353",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Fixed the doubled/parallel road lines.** Where the game's captured road ran alongside a reproduced fallback road, both were being drawn, showing as two parallel lines. The fallback is now suppressed wherever it overlaps a captured road, so each road draws once." },
    ],
  },
  {
    version: "0.9.1352",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Roads now use the game's actual drawn curve — read directly, not reproduced.** Instead of trying to recompute the game's road shape (which kept coming out stair-stepped or wobbly), Provincia now uses the road geometry the game itself draws, so the curves are exactly the game's organic flowing lines. Regions that couldn't be captured fall back to the smooth reproduction so nothing is missing." },
      { type: "fix", text: "**Roads can no longer sit on sea.** Every road point is now guaranteed to be on land — any point that would fall on a water pixel is pulled back to the nearest land. No more roads crossing into the blue." },
    ],
  },
  {
    version: "0.9.1351",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Roads now flow organically instead of hugging the tile grid.** The road routes were correct, but they were pinned to the square tile grid, so they came out stair-stepped/squarish — and a per-step jitter made them look wobbly rather than curved. Roads are now relaxed off the grid into a smooth flowing line and drawn as a continuous dirt road, so they curve naturally like the game's, not like a modern highway. Also fixed roads that strayed into the sea near the coast — stray points are pulled back onto land." },
    ],
  },
  {
    version: "0.9.1350",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Roads now draw as a solid dirt line, like the game — which finally makes the curve visible.** They were drawn dashed, and a dashed line chops a gentle curve into short straight ticks, so the road read as straight no matter how accurate the underlying path was. Roads are now a solid continuous line (tan with a subtle darker casing), so the exact route — the meander, the forks, the in-and-out — actually shows. Sea lanes stay dashed." },
    ],
  },
  {
    version: "0.9.1349",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**The exact road curve now actually shows — the previous update was being masked by a stale cache.** v0.9.1348 computed the game's real curved roads but the road cache key hadn't changed, so the app kept serving the older straight version. The cache key now busts correctly (and is tied to the road data so this can't recur), so the game-exact curving/meander is what you'll see." },
    ],
  },
  {
    version: "0.9.1348",
    date: "2026-07-21",
    items: [
      { type: "feature", text: "**Roads now render with the game's exact curve — including its natural wiggle.** Rather than approximating, this reproduces the game's own road-drawing spline exactly: a cubic Bézier through the road's tiles, with each point's direction set the way the game sets it — including the small, deterministic bend the game applies at every step (seeded from the terrain, so it never flickers and matches run to run). That's why even straight stretches gently meander, exactly as in-game. The result stays on land where the game's roads are, and no longer runs ruler-straight." },
    ],
  },
  {
    version: "0.9.1347",
    date: "2026-07-21",
    items: [
      { type: "fix", text: "**Reverted the road \"wiggle\" — it was pushing coastal roads into the sea.** The previous version nudged roads sideways to look hand-drawn, but that displacement ignored the coastline and shoved near-shore roads into the water, and looked worse overall. Roads now draw the captured in-game course faithfully with only corner-rounding, so they stay on land exactly where the game puts them." },
    ],
  },
  {
    version: "0.9.1346",
    date: "2026-07-21",
    items: [
      { type: "improvement", text: "**Exact roads now generalize to any Rome Remastered map, not just RIS.** The exact-road system was reworked to hold multiple maps' real road networks and match whichever map you have loaded automatically (by a map fingerprint), so additional maps/mods can be supported with their true in-game road layout. Any map without an exact network still uses the computed router." },
    ],
  },
  {
    version: "0.9.1345",
    date: "2026-07-21",
    items: [
      { type: "improvement", text: "**Roads now wiggle like the game's, not just at the bends.** The captured network gives each road's true course, but the game draws its roads as an organic, gently-meandering line even along straight open stretches. Roads now render with that same subtle wiggle (deterministic, so it never flickers, and tapered to stay pinned at settlements and junctions), so a long straight run reads like a real road instead of a ruler line." },
    ],
  },
  {
    version: "0.9.1344",
    date: "2026-07-21",
    items: [
      { type: "feature", text: "**Roads on the RIS grand campaign now match the game exactly.** Instead of computing an approximation of where roads run, Provincia now uses the game's own complete road network — every road across the whole map, exactly as the game itself lays them (the Y-forks, the coastal detours, the junctions, all of it). Trade Lanes on this map is now pixel-for-pixel the game's road layout. Other maps continue to use the computed router." },
    ],
  },
  {
    version: "0.9.1343",
    date: "2026-07-20",
    items: [
      { type: "fix", text: "**Roads now use the game's own road-building method.** Deep analysis of the game established exactly how it lays roads: it routes each settlement to each neighbouring settlement (and to its own harbour) along the cheapest path, staying within those two provinces' territory, and every road reuses the existing network where they meet — which is what forms the junctions and forks. Trade Lanes now reproduces that method directly instead of approximating it." },
      { type: "fix", text: "**Terrain is now read correctly — this was the big one.** The map's terrain data had been decoded with an inverted colour table: the shades that are actually shallow/deep sea were being treated as mountains, and the commonest inland type was mislabelled. Roads were therefore avoiding and following the wrong ground. Terrain is now identified from the game's own definitive table (fertile land, wilderness, hills, mountains, forest, swamp, sea depths, beach), so roads thread the passable ground and bend around real mountains and forest the way the game does." },
      { type: "improvement", text: "**Geography overlay labels fixed too.** The same terrain-table correction fixes the Geography map mode and hover tooltips, which previously mislabelled sea as mountains and vice-versa." },
    ],
  },
  {
    version: "0.9.1342",
    date: "2026-07-20",
    items: [
      { type: "fix", text: "**Road links now run settlement-to-settlement, like the game — the missing Y-fork is back.** Verified against the campaign-start map: a settlement with roads sends its road ALL THE WAY to each neighbouring settlement, even across a province that has no roads of its own. Previously the drawn road was cut at the roadless province's border, which removed exactly the fork the game shows on Sardinia (the west road splitting toward Pluvium and toward Olbia). Two roadless neighbours still get no link between them." },
      { type: "fix", text: "**Harbour roads follow the port building, not the roads building.** A settlement that has built a port gets its settlement→harbour road even with no roads built (this is how the game lays them — e.g. Sardinia's inland town at campaign start has only a port, and its long harbour road across the island is drawn). Port roads were previously gated on the roads building." },
      { type: "fix", text: "**Compatible with today's mod update's re-compressed map files.** The mod's latest update re-saved its campaign map images in a compressed format; one internal reader still assumed the uncompressed layout and silently mis-read the map. All map readers now handle both formats." },
    ],
  },
  {
    version: "0.9.1341",
    date: "2026-07-20",
    items: [
      { type: "fix", text: "**Roads built during your campaign now show.** Which provinces have roads was read from the campaign's STARTING setup, so any province that built its roads during play showed nothing — on Sardinia this cut away the entire northern Y-fork (the junction where the road splits toward Pluvium and Olbia) even though the game draws it. With a save loaded, road-having provinces now come from the save's own building lists, so the network matches what you actually built." },
      { type: "improvement", text: "**Roads draw as soft curves, like the game.** The drawn line now rounds every corner of the routed course (the course itself is unchanged), so roads meander organically instead of stepping in right angles. The hover highlight follows the same curve." },
    ],
  },
  {
    version: "0.9.1340",
    date: "2026-07-20",
    items: [
      { type: "fix", text: "**Harbour roads now draw for every port, not only trading ports.** A settlement's road to its harbour previously only appeared when a sea lane was actively using that port, so e.g. Sardinia's long road from the inland town across to its east-coast harbour never showed. Harbour roads now come from the map's port markers directly — every province with roads and a port shows the road to it, exactly as the game draws them." },
      { type: "improvement", text: "**Roads now read the height map.** Road routing folds elevation into its terrain costs — steep ground is more expensive, so roads prefer valley floors and passes over hill shoulders. Captured road courses (like Sardinia's) are unaffected; this refines routes everywhere else." },
    ],
  },
  {
    version: "0.9.1339",
    date: "2026-07-20",
    items: [
      { type: "feature", text: "**Sardinia roads now follow the game's actual road course.** The island's road layout — the long west road that runs north out of Cornus before turning inland, the three-way junction in the middle of the island, and the harbour road crossing to the east coast — was captured from the campaign map itself and georeferenced to map coordinates. Trade Lanes routes on Sardinia now follow that real course wherever it is known, instead of a computed best-guess path." },
      { type: "improvement", text: "**Harbour roads follow terrain and the road network.** The settlement→harbour connector is now routed like every other road — winding around hills and forest and merging onto existing roads — instead of being drawn as a straight line. An inland town's road to a far-coast harbour now crosses the island along the actual road course, like the game." },
    ],
  },
  {
    version: "0.9.1338",
    date: "2026-07-19",
    items: [
      { type: "feature", text: "**Roads are now one shared network, like the game.** Instead of drawing an independent straight road for every pair of towns, roads build a connected network — the shortest links form the backbone first and longer routes merge onto it, following the shared spine and reaching towns through junctions. This reproduces the game's road layout (routes that run along a backbone rather than cutting straight across) instead of a fan of separate direct lines." },
    ],
  },
  {
    version: "0.9.1337",
    date: "2026-07-19",
    items: [
      { type: "change", text: "**Roads use the game's exact terrain movement costs.** After deep analysis of the game's own data, road routing now uses the exact per-terrain costs from the game (grassland 10, forest 13, hills 14, mountains 15/20, beach 14, marsh 20, dense forest + high mountains impassable), producing the cheapest land route between settlements." },
    ],
  },
  {
    version: "0.9.1336",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads now thread the open grassland and detour around forest like the game.** Road placement now avoids woodland, hills and rough ground much more strongly, so a route will swing north up an open corridor and come across the top rather than cutting straight through a forest — matching how the game lays its roads out." },
    ],
  },
  {
    version: "0.9.1335",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads now wind through open ground around forest and hills, like the game.** Instead of a straight (or over-smoothed) line, the route is the raw per-pixel cheapest path — but road placement now treats woodland, hills and rough terrain as strong obstacles, so the road threads the open grassland and weaves around each wooded patch the way the game draws it." },
    ],
  },
  {
    version: "0.9.1334",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads are now drawn as smooth, winding curves instead of straight lines.** Each route is laid out as a flowing spline through waypoints, so roads sweep and bend the way the game draws them rather than reading as a dead-straight bird's-eye path." },
    ],
  },
  {
    version: "0.9.1333",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Sea lanes now respect water depth.** Shallow coastal water is cheapest, medium (deep) sea costs more, and the deepest open ocean is impassable — so trade lanes hug the coastline and thread between shallows instead of striking straight across the open sea, matching how the game routes them." },
    ],
  },
  {
    version: "0.9.1332",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads now follow the inland route the game draws, not the coast.** I recovered the game's exact terrain-type ordering: fertile grassland is the cheapest ground (so roads follow the interior), while beach and marsh are costly (roads stay off the coast and out of swamp), and high mountains and dense forest are impassable (routed around). Roads now curve through the fertile heart of the land the way the game places them." },
    ],
  },
  {
    version: "0.9.1331",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads now use the game's exact terrain movement costs.** The per-terrain costs are taken verbatim from the game's own cost table (grassland 10, hills 13, forest 13–14, low mountains 15, high mountains 20, marsh 8, beach 4.5), so roads weave through the landscape exactly as the game weights it — all land passable, sea excluded." },
    ],
  },
  {
    version: "0.9.1330",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads curve through the terrain again, without hugging the coast.** They now weave along the easier ground (plains and grassland), bend around forest and hills, and route around impassable high mountains — restoring the game-like curves that the previous straight-line version lost, while keeping them off the coastline." },
    ],
  },
  {
    version: "0.9.1329",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads now take the direct route the game draws.** They previously detoured along the coast and around terrain because they were weighted by movement cost; the game's road network instead connects settlements by the shortest path over passable land, only routing around genuinely impassable ground (sea and high mountains). Roads now do the same — straighter, inland routes that match the game." },
    ],
  },
  {
    version: "0.9.1328",
    date: "2026-07-19",
    items: [
      { type: "improvement", text: "**Trade Lanes now load from a cache — much faster.** The sea-lane and road geometry is cached (in memory for instant map-mode switching, and on disk so it stays fast across restarts). The cache rebuilds automatically whenever the mod or game data changes, so it's always up to date." },
    ],
  },
  {
    version: "0.9.1327",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Roads now follow terrain the way the game does.** The previous version biased routes downhill, sending some roads the wrong way. Roads now weight terrain by how rough/broken the ground is (symmetrically, using the exact per-terrain move costs and the roughness factor the game uses), so they thread smooth valleys and coastlines and bend around rugged ground without the downhill bias." },
    ],
  },
  {
    version: "0.9.1326",
    date: "2026-07-19",
    items: [
      { type: "improvement", text: "**Roads now follow the terrain instead of drawing straight lines.** Land routes are traced at full map resolution and weighted by elevation, so they bend around hills and thread along valleys and coasts the way the game's roads do — using the mod's own height data." },
    ],
  },
  {
    version: "0.9.1325",
    date: "2026-07-19",
    items: [
      { type: "feature", text: "**Trade Lanes now show money.** Hovering a sea lane lists the goods AND the denarii each direction earns, plus a lane total. The sidebar list is now ranked by value (most valuable trades first) and shows each lane's denarii." },
      { type: "feature", text: "**Roads are hoverable too.** Hovering a land road highlights it and shows the goods and denarii of the land trade between those two provinces — same inspector as sea lanes." },
    ],
  },
  {
    version: "0.9.1324",
    date: "2026-07-19",
    items: [
      { type: "change", text: "**Trade Lanes: all lines now drawn at a uniform thickness** — line width no longer scales with trade volume, so the map reads more cleanly." },
      { type: "feature", text: "**Hover a sea lane to see its cargo.** Moving the cursor over a trade lane highlights it and shows a tooltip listing the goods carried each way and their quantities (e.g. Caralis → Hippo Diarrhytus: copper ×2, grain ×2, olive oil ×2)." },
    ],
  },
  {
    version: "0.9.1323",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Trade Lanes: roads now clip at province borders.** When a province with roads borders one without, its road is drawn up to the shared border and stops — the road-less province shows nothing inside its own borders, instead of the whole connecting segment vanishing. Each road is clipped to exactly the road-having provinces it passes through." },
    ],
  },
  {
    version: "0.9.1322",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Trade Lanes: roads now only appear for settlements that actually have roads built.** Provinces with no road (e.g. Pluvium at campaign start) no longer show a road segment running through them — a land route is drawn only where both settlements it connects have roads, matching the game." },
      { type: "fix", text: "**Trade Lanes: every sea route audited and corrected — all 225 now draw.** Routes through narrow straits (Gibraltar, the Dardanelles, the Kerch strait, the Gulf of Corinth) that previously didn't appear now cross correctly, and small port-cities like Piraeus dock at their own harbour instead of a neighbour's. Verified end-to-end: no missing lanes, none over land, none docking at the wrong port." },
    ],
  },
  {
    version: "0.9.1321",
    date: "2026-07-19",
    items: [
      { type: "fix", text: "**Trade Lanes: sea routes now reach ports tucked in tight coastal pockets.** Some ports sit in a bay so narrow the router couldn't thread a path to the exact port cell, so the lane silently didn't draw (e.g. Caralis→Hippo Diarrhytus). Those lanes now route from the nearest open water while still drawing to the port marker — recovering 11 more sea lanes. Lanes that already drew are unchanged." },
    ],
  },
  {
    version: "0.9.1320",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Trade Lanes: sea routes now dock at each settlement's OWN port.** On crowded coastlines (Sardinia, southern Italy, the Aegean, North Africa) a lane was snapping to whichever port marker sat physically closest — often a neighbouring town's — which left the settlement's real port with no line drawn from it (e.g. Uselis/Iliensia showed no route to Rome even though the route existed). Each port marker is now matched to the town it belongs to, so 34 regions that were docking at a neighbour's port draw correctly from their own." },
    ],
  },
  {
    version: "0.9.1319",
    date: "2026-07-18",
    items: [
      { type: "feature", text: "**Trade Lanes now uses your live save's actual trade network.** With a save loaded, the overlay draws the real sea routes the game derived for that campaign (every port's actual trade partners) instead of the campaign-start estimate — so routes the start-of-game model didn't pick, like a Sardinian port trading with Rome, now appear. With no save loaded it still shows the campaign-start network." },
    ],
  },
  {
    version: "0.9.1318",
    date: "2026-07-18",
    items: [
      { type: "improvement", text: "**Sea lanes route at full map resolution now, so more of them connect.** The pathfinder was working on a half-resolution water map that pinched narrow straits and small bays shut, stranding island and coastal routes; it now uses the full map (kept fast with reusable pathfinding memory), so noticeably more lanes draw. Also logs each region's port binding for diagnosing any that still don't." },
    ],
  },
  {
    version: "0.9.1317",
    date: "2026-07-18",
    items: [
      { type: "improvement", text: "**Better diagnostics for missing sea lanes.** When a lane doesn't draw, the log now names the two settlements and the exact reason (no port found and how far the nearest one was, port on an enclosed bay, or no water route), so a missing connection can be pinned down instead of guessed at." },
    ],
  },
  {
    version: "0.9.1316",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**The straight lines cutting across land are gone.** A sea lane now only draws once its actual water route is computed — the temporary straight-across placeholder (drawn city-to-city while a route was still calculating or when none could be found) has been removed, so nothing is ever shown crossing land." },
    ],
  },
  {
    version: "0.9.1315",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Sea lanes no longer cross land (Sardinia, etc.).** The water map was treating any unrecognised map colour as sea, so lanes could path straight through a land region that wasn't in the loaded set. It now classifies water by the actual sea colour, and draws each route point at the cell centre so lanes sit cleanly on the water rather than a pixel onto the shore." },
    ],
  },
  {
    version: "0.9.1314",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Sea lanes no longer clip across land corners, and more coastal towns get their lane.** Diagonal steps that sliced across the tip of a headland (a route appearing to cross land near coasts, e.g. by Carthage) are blocked, and the port-matching reach is wider so settlements whose port tile sits a bit further off — like Uselis on Sardinia connecting to Rome — now draw their sea lane." },
    ],
  },
  {
    version: "0.9.1313",
    date: "2026-07-18",
    items: [
      { type: "improvement", text: "**Land roads now use the game's exact terrain movement costs.** Roads route on the same least-cost land paths the game does — coast and open ground cheap, forest and hills dearer, mountains dearest (about 4× the cost of flat ground, not an exaggerated wall) — so they curve through passes and along valleys the way the in-game roads do." },
    ],
  },
  {
    version: "0.9.1312",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Sea lanes dock at the ports again.** The previous change to route over the game's navigation map made some lanes stop reaching their ports; reverted that routing while keeping the port-to-port docking, so lanes connect to the port markers as before." },
    ],
  },
  {
    version: "0.9.1311",
    date: "2026-07-18",
    items: [
      { type: "improvement", text: "**Sea lanes now route over the game's own sea-navigation map.** Instead of treating every blue pixel as open water, lanes follow the actual navigable channels the game uses, so they hug the coasts and thread the straits the same way rather than cutting across open sea." },
    ],
  },
  {
    version: "0.9.1310",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Sea lanes now dock at the actual ports, not the city centres.** Each region's port is read straight from the map (the port markers), and every sea lane runs port-to-port, with a short road from the settlement out to its own port — so lanes no longer terminate on inland city markers. Regions with no nearby port don't get a sea lane." },
    ],
  },
  {
    version: "0.9.1309",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Sea lanes stay in the water and roads stay on land.** The water/land maps were counting a coastal cell as both, so some sea lanes cut across peninsulas and a few roads strayed into the sea. Each now uses the cell's centre, so lanes hug the coast and roads keep to land. A sea lane that genuinely can't be routed over water is now hidden rather than drawn straight across an island, and only truly coastal settlements get a line to a port." },
    ],
  },
  {
    version: "0.9.1308",
    date: "2026-07-18",
    items: [
      { type: "improvement", text: "**Trade routes now read like the game: settlement → road → port → sea lane → port → road → settlement.** Sea lanes connect port to port over the water, and land trade follows roads that thread through valleys and passes (avoiding mountains) between neighbouring settlements — plus a short road links each coastal settlement to its own port. Sea lanes are dashed light, roads dashed brown. Everything routes in the background when you open the mode." },
    ],
  },
  {
    version: "0.9.1307",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Sea lanes no longer cut straight across land.** Some lanes were skipping their ports because the water route couldn't be traced through a narrow strait or a tight bay; the sea map now keeps those channels open, and any lane that still can't find a full water route at least leaves each settlement through its coast instead of drawing a straight line over land." },
    ],
  },
  {
    version: "0.9.1306",
    date: "2026-07-18",
    items: [
      { type: "improvement", text: "**Sea lanes now follow the actual sea.** Instead of straight arcs, each lane is routed around the coastlines and between the islands — pathfinding over the water from port to port — and drawn as a dashed line like the in-game trade routes. Routes compute in the background the first moment you open the mode; a lane shows a light arc until its exact route is ready." },
    ],
  },
  {
    version: "0.9.1305",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Trade Lanes mode no longer stutters when panning.** It was rebuilding the whole lane-anchor map on every frame; that's now computed once and reused." },
    ],
  },
  {
    version: "0.9.1304",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Trade lanes now actually connect to the settlements.** The previous attempt mirrored the settlement positions vertically (a coordinate flip that shouldn't have been there), so lanes ran to the wrong points. Endpoints now sit on the settlement/port tiles." },
    ],
  },
  {
    version: "0.9.1303",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Geography, Terrain and Heights now read their map directly from the mod folder.** Instead of relying on a copy the importer was supposed to make into the app's data (which could be missing), all three now load map_ground_types.tga / map_heights.tga straight from your mod's world/maps/base — always current, no re-import needed. Geography should now paint real per-tile terrain (forest, hills, mountains…) instead of a flat colour per province." },
    ],
  },
  {
    version: "0.9.1302",
    date: "2026-07-18",
    items: [
      { type: "improvement", text: "**Trade Lanes now curve and connect to settlements.** Lanes anchor at each region's settlement/port tile (not the province centre) and draw as gentle arcs instead of straight lines — closer to how the game renders sea routes." },
    ],
  },
  {
    version: "0.9.1301",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Geography mode and the Terrain & Heights overlays work again on imported mods.** The folder importer had stopped copying map_ground_types.tga and map_heights.tga into the slot, so all three silently fell back to nothing (Geography just showed each region in a flat colour). The importer now brings both files along again — this self-heals on your next launch (the startup mod re-read re-imports them); if it doesn't, hit 🔄 Reload or re-import the mod folder once." },
    ],
  },
  {
    version: "0.9.1300",
    date: "2026-07-18",
    items: [
      { type: "fix", text: "**Trade Lanes are no longer pixelated.** The lanes were baked into the map image and upscaled with smoothing off, so they looked blocky. They're now drawn as true vector lines on top of the map — crisp at every zoom." },
      { type: "feature", text: "**Trade Lanes sidebar is now a lane inspector.** Every sea lane is listed ranked by trade flow; click one to highlight it (bright cyan) and its two ports on the map. Click again to clear." },
    ],
  },
  {
    version: "0.9.1299",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Build-Order Optimizer (🧰 Tools).** Select a settlement, and it ranks every structure you could build there by payback time — construction cost divided by the extra income per turn it would add (computed from the same cracked economy model as the income maps). Fastest-paying builds first; walls/happiness/recruitment-only buildings are flagged as non-income at the bottom. A toggle switches between the one settlement and the whole faction." },
    ],
  },
  {
    version: "0.9.1298",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Campaign Autopsy (🧰 Tools).** Point it at a scanned saves timeline and get a post-mortem: each faction's settlement/treasury/army arc over the campaign, when they peaked, when they started declining, when they were wiped out, and who won — with a sparkline and verdict badge per faction." },
      { type: "improvement", text: "**Unrest map mode: pick a faction, see its provinces.** The sidebar now starts as a faction picker (worst revolt risk first); selecting one lists that faction's provinces with their public order, worst first — click to highlight, double-click to jump. Use '‹ all factions' to go back." },
    ],
  },
  {
    version: "0.9.1297",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Trait Explorer (🧰 Tools).** Browse every character trait in the mod: filter by effect (tax, law, command, trading…), see each trait's levels, thresholds, and effects (color-coded + / −), and — with a save loaded — who currently carries each trait, grouped by faction." },
    ],
  },
  {
    version: "0.9.1296",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Trade Lanes map mode (Economy).** The cracked sea-trade network drawn on the map: every lane as a golden line between its two regions, thickness and brightness = trade flow, over a dimmed map. The last of the player map-mode series — nine modes total." },
    ],
  },
  {
    version: "0.9.1295",
    date: "2026-07-17",
    items: [
      { type: "fix", text: "**Unrest mode shows one faction at a time.** The map stays neutral until you pick a faction in the sidebar list (all factions listed, worst revolt risk first); only the picked faction's settlements color. Click again to deselect." },
    ],
  },
  {
    version: "0.9.1294",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Revolt risk by faction.** The Unrest map mode's sidebar now ranks factions by settlements at revolt risk (public order under 80 — the riot line is 70), worst first. Click a faction to focus the map on just their regions; click again to unfocus." },
    ],
  },
  {
    version: "0.9.1293",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Four model-powered map modes: Unrest, Income, Corruption, Growth.** *Unrest* (Government) colors every settlement by public-order risk, green stable → red riot line. In Economy: *Income* shows each settlement's real modeled net income in denarii, *Corruption* shows exactly where distance-to-capital corruption bleeds money, and *Growth* shows squalor-aware population growth — declining red, booming green. All four come from the cracked economy/growth/PO models (campaign-start values); the first activation computes every faction (a minute or two) and is then cached." },
    ],
  },
  {
    version: "0.9.1292",
    date: "2026-07-17",
    items: [
      { type: "fix", text: "**Mining 'Current' list tightened** — only settlements with a mine built AND earning appear (settlements whose income came from governor-building mining bonuses without an actual mine no longer slip in). Note: the first version of this filter shipped in 0.9.1291 — if Current looks unfiltered, restart the app to pick up the update." },
    ],
  },
  {
    version: "0.9.1291",
    date: "2026-07-17",
    items: [
      { type: "improvement", text: "**Mining mode, refined again per feedback.** The Current view lists only settlements with a mine actually built; clicking a settlement in the sidebar highlights its province on the map and double-clicking jumps you there (same flow as the region search); and hovering a region shows a small tooltip at the cursor with its current + potential mine income — without touching the region info panel." },
    ],
  },
  {
    version: "0.9.1290",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Two more player map modes: Threat and Reach (Military section).** *Threat* — your regions colored by border exposure: green interior, yellow foreign border, orange hostile neighbor, red at-war neighbor (war/hostile read from the loaded save's diplomacy). *Reach* — your regions colored by how far your nearest army is (green = garrisoned, red = 5+ regions away, purple = no land route) — the 'which frontier towns would die alone' view. Both use the selected faction as the perspective, falling back to the live player faction." },
    ],
  },
  {
    version: "0.9.1289",
    date: "2026-07-17",
    items: [
      { type: "improvement", text: "**Mining map mode reworked per feedback.** The sidebar now lists EVERY settlement with mineable deposits (scrollable, sorted by income) with a Current / Potential toggle that also switches what the map colors show — what mines earn today vs what they could earn at best level. The mode no longer injects anything into the region info panel, and the formula note is gone." },
    ],
  },
  {
    version: "0.9.1288",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**Two new player map modes (Military section).** *Armies* — regions heat-tinted by force size: blue = the owner's troops, red = a foreign army present, purple = both; hover for unit counts and factions. *War* (live mode) — battles and sieges from the game log glow by recency, so the active front is visible at a glance; hover a region for its recorded events. First two of the player-mode series — more coming." },
    ],
  },
  {
    version: "0.9.1287",
    date: "2026-07-17",
    items: [
      { type: "improvement", text: "**The Mining map mode got its sidebar.** Legend with the bronze→silver→gold income scale, a 'Richest deposits' top-5 list (✓ = mine already built), and hovering any region now shows its minerals and exact per-level income — no deposits says so." },
    ],
  },
  {
    version: "0.9.1286",
    date: "2026-07-17",
    items: [
      { type: "fix", text: "**The 🧰 Tools menu now opens upward.** It opened downward from the toolbar and ran off the bottom of the screen, hiding the entries. It also scrolls if it ever outgrows the screen." },
    ],
  },
  {
    version: "0.9.1285",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**The 🧰 Tools menu — fifteen new analysis and modding tools in one release.** A new Tools button in the toolbar collects everything below (the Mining map mode joins the Economy map modes). Every panel is crash-isolated: if one misbehaves it shows a notice, never takes down the app." },
      { type: "feature", text: "**Mod safety net:** *Submod Drift* scans a submod folder for stale overrides of the base mod — the exact 'Could not find string' failure a teammate hit this week — and *Mod Lint* checks EDB/EDU/strat/resources for undeclared hidden resources (the fatal boot-crash class), missing units and dead conditions in ~200ms." },
      { type: "feature", text: "**Balance workflow:** *Economy Baseline* snapshots all 239 factions' turn-1 economies and diffs after mod edits; the *What-If Sandbox* applies a hypothetical EDB/EDU tweak in a temp shadow copy and shows every faction's economy delta without touching the mod; the *Unit Comparator* puts up to 6 units side by side with cost-effectiveness ratios; the *Recruit Planner* shows what each next building upgrade unlocks in the selected settlement." },
      { type: "feature", text: "**Campaign analysis:** *Compare Saves* diffs two saves (ownership flips, treasury/army deltas, population); the *Timeline Player* animates region ownership turn by turn across a scanned saves folder; the *Battle Ledger* reconstructs every battle from the live game log with per-faction win/loss records; *Victory Progress* tracks each faction's win conditions; the *Diplomacy Heatmap* shows war blocs as a sortable NxN grid; *Population Projection* simulates every settlement's squalor-aware growth N seasons ahead with decline/stall/unrest flags." },
      { type: "feature", text: "**Everyday modding:** *Find Definition* locates any unit/building/region/string across all mod files with file+line and opens your editor there; the mining map mode colors regions bronze→silver→gold by predicted mine income; the region panel's income explainer itemizes where a settlement's tax/farm/mine/trade numbers come from." },
    ],
  },
  {
    version: "0.9.1284",
    date: "2026-07-17",
    items: [
      { type: "feature", text: "**The region panel now shows real mining income.** Regions with mineable deposits get a Mining row: the actual per-turn income a mine would earn there, per level, computed with the exact formula the game uses internally (deposit quantities × trade values × the mine's effective strength) — the number the in-game building card can't show. The currently built level is marked, and predictions match live settlement scrolls to the denarius. Appears a few seconds after launch (the first computation runs quietly in the background)." },
      { type: "improvement", text: "**One-line launch diagnostics.** The moment the splash lifts, the log gets a single [boot] line: total time, when each stage finished (map, overlay, building icons, unit cards) and how much was served from the disk cache. If a launch ever feels slow again, that one line is the whole bug report." },
      { type: "improvement", text: "**The icon cache cleans up after itself.** Importing a different mod into a slot now removes the replaced mod's cached icons from disk instead of keeping them forever. (Re-importing the same folder — the reload flow — keeps the cache warm.)" },
      { type: "fix", text: "**\"Clear mod caches\" and factory reset now truly clear the faction-name/culture caches.** A silently swallowed error meant those caches survived every reset since they were introduced, so a mod reload could keep serving stale faction display data until an app restart." },
      { type: "change", text: "**Internals: the launch warm-up logic is consolidated into one scheduler module with its pacing rules under test, and the main-process file slimmed by ~1,000 lines into five focused modules.** No behavior change intended — groundwork that makes future launch work safer." },
    ],
  },
  {
    version: "0.9.1283",
    date: "2026-07-16",
    items: [
      { type: "feature", text: "**Icons are now cached on disk — warm-up becomes near-instant from your second launch.** Every unit card, building icon, and commander portrait used to be re-decoded from the game's TGA/DDS art on every single launch. Decoded images are now saved as PNGs (per source file, auto-invalidated when the mod's file changes) and served directly on later launches: no decoding, no heavy transfers, just reading small files. First launch after this update builds the cache; from the second launch the splash and post-map warm-up should shrink dramatically." },
      { type: "fix", text: "**Fixed the huge hidden cost behind 0.9.1282's slowdown.** The warm-up requests the same card art under many faction keys, and each request shipped its own full copy of the file between processes — at 100,000 requests that was gigabytes of internal traffic. Each unique file now crosses once per batch and all keys share one image. The warm-up cap is gone entirely." },
      { type: "fix", text: "**Ships no longer flash in.** Fleets sit on sea tiles, so their unit cards were missed by the region-based warm-up — all rendered army markers, navies included, are now warmed." },
    ],
  },
  {
    version: "0.9.1282",
    date: "2026-07-16",
    items: [
      { type: "fix", text: "**Zero pop-in, as fast as possible.** 0.9.1281's warm-up still truncated at 20,000 cards on large mods (the log showed it), and the background passes ran deliberately slowly — so cards could pop in for tens of seconds after the map appeared. Three changes: each unique card file is now decoded once ever and shared across all faction keys (most of those 20,000+ were the same art), the cap is effectively gone (100,000), and every post-splash pass now runs at full pipelined speed with no redraw storms. Commander-portrait warming is quicker too. The whole map should be warm within a few seconds of reveal." },
    ],
  },






];

export default CHANGELOG;
