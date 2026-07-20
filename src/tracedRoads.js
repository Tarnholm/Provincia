// Traced road geometry for the RIS campaign map (1020x700 map_regions space).
// Sardinia road network as it appears on the in-game campaign map, captured
// from a top-down campaign screenshot and georeferenced to map pixels
// (coastline + settlement anchored, endpoints snapped to settlement/port
// pixels). Cells are burned into the land-routing cost grid as a cheap
// 'trench' so settlement-to-settlement routes follow the game's actual
// road course where known, instead of a purely terrain-cost path.
// Guard: only applied when the map is 1020x700 AND the expected region
// color sits at the fingerprint pixel (avoids other 1020x700 mods).
export const TRACED_ROADS = {
  mapW: 1020,
  mapH: 700,
  // map px (244,313) must be Balaria's region color on this map
  fingerprint: { x: 244, y: 313, rgb: [117, 15, 80] },
  cells: [
  [239,324], [239,325], [240,317], [240,318], [240,319], [240,320], [240,321], [240,322], [240,323], [241,312], [241,313], [241,314],
  [241,315], [241,316], [241,318], [241,319], [242,310], [242,311], [242,318], [242,325], [242,326], [242,327], [242,328], [243,310],
  [243,319], [243,320], [243,321], [243,322], [243,323], [243,324], [244,309], [244,319], [244,320], [245,308], [245,309], [245,319],
  [246,307], [246,308], [246,319], [247,305], [247,306], [247,308], [247,319], [247,320], [248,304], [248,308], [248,320], [248,321],
  [249,307], [249,308], [249,321], [250,307], [250,321], [251,307], [251,321], [251,322], [252,322]
  ],
};
