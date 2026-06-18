=============================================================================
 PROVINCIA TRADE MODEL — HOW IT WORKS & CURRENT ACCURACY
 Last updated 2026-06-18 (v0.9.1167)
 All formulas cracked from controlled in-game experiments + live scroll
 captures (RIS mod, turn 1).
=============================================================================

A settlement's TRADE income = the sum, over all its trade routes, of each
route's value. Routes are ONE-DIRECTIONAL and PER-SETTLEMENT: a town EXPORTS
to some partners and IMPORTS from others. The same physical link appears on
BOTH towns' scrolls (one as an export row, the other as an import row).
There are three kinds: LAND, SEA, and RIVER.


-----------------------------------------------------------------------------
 1. LAND TRADE
-----------------------------------------------------------------------------

   land(X->Y) = (2 + 0.2*tradePct_X)
              * (exportCargo + 0.5*importCargo + const)
              * roadMult * rights

   - tradePct_X = exporter's trade-building level (market chain: trader 1
     ... curia 5).
   - exportCargo = sum of qty*value of X's goods that Y lacks;
     importCargo = the reverse (x0.5).
   - roadMult = road network bonus. NO distance penalty (road-based).
   - rights = x3 with trade rights, /3 without.
   - PARTNERS = settlements with a DIRECT road link = the GABRIEL GRAPH:
     X land-trades Y only if NO third settlement lies between them (inside the
     circle whose diameter is segment XY). A town in between breaks the link.
     (Live-cracked 2026-06-18 from Pontus: Amaseia does NOT trade Komana or
     Kimiata -- BLOCKED by Kabeira / Pimolisa sitting between them. Was raw
     region-border adjacency, which over-counted partners by up to +60% for
     compact inland factions. Border length and straight-line distance both
     FAILED to separate real from spurious; only the Gabriel rule does.)

   ACCURACY: GOOD. Rome routes exact (Cosa 153/150, Praeneste 112/111,
   Falerii 96/93, Reate 64/65, Camerinum 60/60); Amaseia scroll EXACT
   (117 with 3 partners); Pontus faction 362 vs PLAYER-save 349 (+3.7%,
   was +61% before the Gabriel fix).


-----------------------------------------------------------------------------
 2. SEA TRADE — VALUE (how much a route is worth)
-----------------------------------------------------------------------------

   sea(X->Y) = K * landRate_X * dist^-0.89
             * (exportCargo + 0.347*importCargo + const)
             * popX^0.13 * popY^0.06 * rights

   TERM           VALUE                       HOW IT WAS CRACKED
   -----------    ------------------------    -------------------------------
   K              13                          fit
   landRate_X     2 + 0.2*tradePct (LINEAR)   Carthage market great_forum->
                                              trader experiment (every route
                                              scaled x landRate^1.0)
   dist           depth-weighted WHITE-PORT   forced-corridor experiment
                  path: shallow x1, medium    (Issa walled to one corridor);
                  x2, deep impassable. Port   port = white pixel, town = black
                  = white pixel in map.
   dist exponent  -0.89                       same corridor (shallow 546 ->
                                              medium 294 = medium is 2.0x dist)
   cargo          export + 0.347*import       amber qty experiment (linear in
                  + const                     qty; return-cargo term)
   const          9.86                        amber dilution (Kyrene+Carthage)
   popX / popY    ^0.13 / ^0.06 (weak)        Arsinoe pop x4.74 experiment
   rights         1 (own/agreement) or 0.5    Quietus guide + Rome/Capua
                  (foreign) -- VALUE only

   ACCURACY:
   - OPEN-WATER crossings: EXCELLENT, ~1-2% (Carthage->Aspis +2%,
     ->Eryx ratio 1.01). CONFIRMED ON THE MAP: sea trade lines run STRAIGHT
     across gulfs (Volaterrae, Pisae, Ingaunum all checked), exactly what
     the white-port distance computes.
   - COASTAL / SHORT routes: FAIR, +/-10-16% (value-law noise -- small
     cargo/pop residuals, NOT rounding and NOT a pathing problem).


-----------------------------------------------------------------------------
 3. SEA TRADE — FORMATION (which routes a port forms)
-----------------------------------------------------------------------------

   - Each port fills slots_X = BUILT PORT CHAIN LEVEL (e.g. dockyard = 3)
     with its MOST PROFITABLE partners -- NOT its nearest.
   - Selection profit = dist^-0.89 * (cargo+const) * popY^0.06.
     RIGHTS ARE NOT APPLIED TO SELECTION (they only scale realized value).
   - A port also shows IMPORT rows for any partner whose own slot set
     includes it.

   ACCURACY: ROUTES EXACT. Carthage exports = {Aspis, Hippo Diarrhytus,
   Eryx} = game. Rome exports = {Fregellae, Capua} = game (Capua picked
   over the distant same-faction Neapolis).


-----------------------------------------------------------------------------
 4. RIVER TRADE (Nile, etc.)
-----------------------------------------------------------------------------

   - River bodies are thin sea bodies (the Nile is its own water colour).
   - VALUE uses the same SEA law, with the DISTANCE computed CONFINED TO THE
     RIVER BODY (the path follows the channel; it cannot shortcut across a
     delta via the coast, and cannot get blocked in a narrow channel).
     Previously a flat size-only law (every Nile route from a city showed
     the same number).
   - CONFIRMED ON THE MAP: Nile cities sit inland on the channels; trade runs
     east-west along the coast to each channel mouth, so Tanis (far east) is
     a longer haul than Sebennytos -- which the body-confined distance now
     captures.

   ACCURACY:
   - VALUE per route: GOOD where the source is well-connected --
     Alexandria total Nile trade 2253 vs game 2246 (+0.3%, EXACT).
   - FORMATION: STILL OVER. River lanes form "near-all-pairs" (every delta
     city pairs with every other), so an interior city like Tanis gets ~7
     partners where the game gives it 4 -> interior cities over-count
     (+50% to +170%). This is the main remaining river error and needs the
     same slot/range limiting the sea lanes use.


-----------------------------------------------------------------------------
 5. GOVERNOR
-----------------------------------------------------------------------------

   The exporter's GOVERNOR TRADING TRAIT multiplies the EXPORT leg by
   (1 + 0.74*trading%). The import leg (partner's export back) is
   unaffected. (Captures should be gov-out for clean calibration; saves let
   us read the actual governor trait per settlement.)


-----------------------------------------------------------------------------
 ACCURACY AT A GLANCE
-----------------------------------------------------------------------------

   COMPONENT                         STATUS     TYPICAL ERROR
   -------------------------------   --------   --------------------------
   Land trade                        GOOD       ~3%
   Sea value -- open water           EXCELLENT  ~1-2%
   Sea value -- coastal/short        FAIR       +/-10-16%
   Sea formation (route picks)       EXACT      exact route set
   River value (well-connected)      GOOD       Alexandria +0.3%
   River formation (interior city)   POOR       +50% ... +170% (too many
                                                partners; near-all-pairs)
   Faction/settlement aggregates     GOOD/MIXED Kyrene -0.5%, Carthage -3%,
                                                Rome +9%, Alexandria +0.3%,
                                                Ptolemaic faction still over
                                                (river formation)


-----------------------------------------------------------------------------
 SAVE VALIDATION (the engine's own per-faction trade numbers)
-----------------------------------------------------------------------------

   A turn-1 .sav stores the engine's EXACT per-faction TRADE income (and each
   settlement's governor). Read from a Ptolemaic Turn-1 save (values are
   gov-IN, so the no-gov model should sit a few % UNDER; MODEL coming out
   OVER = a real over-count):

   FACTION         SAVE(engine)  MODEL    DIFF    RIVERS?
   -------------   -----------   ------   -----   -------------------
   ptolemaic          20867       23029    +10%   Nile
   carthage            7472        8104     +8%   no
   antigonid           9836        8528    -13%   no
   seleucid           22513       29985    +33%   Tigris/Euphrates
   bactria             3421        5185    +52%   Oxus
   pontus               387         625    +61%   Halys
   armenia              707         954    +35%   rivers
   getae                115          86    -25%   --

   VERDICT (updated): non-river factions land within ~+/-13% (mostly gov-in
   gap). The over-counting factions (Seleucid +33, Bactria +52, Pontus +61,
   Armenia +35) turned out NOT to be a river problem -- they have NO river
   lanes in the model, and changing the river code does not move them. So the
   save exposed TWO SEPARATE over-counts:
     A) PTOLEMAIC (Nile): genuine RIVER FORMATION over-count (near-all-pairs).
     B) SELEUCID/BACTRIA/PONTUS/ARMENIA: a NON-RIVER over-count -- RESOLVED
        2026-06-18. It was LAND trade (raw region-border adjacency counting
        partners through intervening towns); FIXED by the GABRIEL GRAPH (see
        section 1). Pontus +61%->+3.7% (player save); Seleucid +33%->-10%;
        Carthage +8%->-0%. Factions still reading UNDER (Bactria -35%, Armenia
        -41%) are the no-gov model vs gov-in save (missing governor bonus) --
        being confirmed with per-faction PLAYER saves, not a filter error.

   NOTE: a single global river-distance CUTOFF was tried and FAILED -- the
   delta needs different cutoffs per city (Alexandria keeps lanes out to ~40,
   Tanis must trim below ~36), which one threshold cannot do. The real fix is
   PER-EXPORTER slot-limiting (each city keeps its top-N partners by profit,
   exactly like sea lanes).


-----------------------------------------------------------------------------
 THE LAST MILE TO 0%
-----------------------------------------------------------------------------

   0. LAND TRADE OVER-COUNT -- FIXED 2026-06-18 by the Gabriel graph
      (section 1). Was the single biggest faction-level error for inland
      empires (+33..+61%).

   1. GOVERNOR MODELLING -- the model is NO-GOV; saves are gov-in, so factions
      with trading governors read UNDER. Reading each settlement's governor
      trait FROM the save (already stored) removes this confound and is the
      next precision step.

   2. RIVER FORMATION -- river lanes are "near-all-pairs"; interior delta
      cities form too many. A single distance cutoff FAILED; the fix is
      PER-EXPORTER slot-limiting (each city keeps its top-N by profit, like
      sea lanes). Ptolemaic-only (the Nile); aggregate ~+10% gov-in.

   3. COASTAL VALUE NOISE -- +/-10-16% on short sea routes; a cargo/pop
      fine-tune, not a structural problem.

   VALIDATION: a turn-1 SAVE stores the engine's exact PER-FACTION trade
   total directly, plus each settlement's actual GOVERNOR trait -- so it
   validates every faction at once instead of reading scrolls one by one.
   (Per-route values are recomputed each turn and are NOT in the save, so
   individual river-lane counts still need the occasional scroll.)

   Everything structural is cracked and shipped; the river FORMATION limit
   is the main remaining piece, then calibration/fine-tuning.
=============================================================================
