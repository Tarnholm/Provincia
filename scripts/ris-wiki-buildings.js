// The team's own naming and ordering for the building chains.
//
// The chain names the game files produce are the first LEVEL's name, which is not what
// the chain is called: "Wooden Palisade chain" for what everyone calls Walls, "Small
// School (Civic) chain" for Academies. The order and the grouping are editorial too — a
// list sorted by level count tells a reader nothing about which chains belong together.
// Both come from ris_wiki_building_order.txt, supplied by the team; this file is that
// table, and every generator that names or lists a chain reads it from here so they
// cannot drift apart.

// token -> { name, subsection, order }
const CHAINS = {
  "core_building": { name: "Government (governor)", subsection: "Core", order: 0 },
  "hinterland_region": { name: "Region Information", subsection: "Core", order: 1 },
  "liberation": { name: "Government (liberation)", subsection: "Government", order: 2 },
  "governmenta": { name: "Government (dependency)", subsection: "Government", order: 3 },
  "governmentb": { name: "Government (indirect rule)", subsection: "Government", order: 4 },
  "governmentc": { name: "Government (direct rule)", subsection: "Government", order: 5 },
  "governmentd": { name: "Government (homeland)", subsection: "Government", order: 6 },
  "capital_treasury": { name: "Capital Treasury", subsection: "Government", order: 7 },
  "defenses": { name: "Walls", subsection: "Defences", order: 8 },
  "military_industrial_complex": { name: "Military Industrial Complex", subsection: "Military", order: 9 },
  "garrison": { name: "Garrison", subsection: "Military", order: 10 },
  "irrigated_farming": { name: "Irrigated Farming (crops)", subsection: "Farming", order: 11 },
  "rainfed_farming": { name: "Rainfed Farming (crops)", subsection: "Farming", order: 12 },
  "shifting_cultivation": { name: "Forest Clearance Farming (crops)", subsection: "Farming", order: 13 },
  "qanat_farming": { name: "Qanat Irrigated Farming (crops)", subsection: "Farming", order: 14 },
  "marsh_reclamation": { name: "Marshland Reclamation Farming (crops)", subsection: "Farming", order: 15 },
  "sedentary_animal_husbandry": { name: "Open Field Pasturing (husbandry)", subsection: "Farming", order: 16 },
  "highland_pastoralism": { name: "Highland Pastoralism (husbandry)", subsection: "Farming", order: 17 },
  "nomadic_pastoralism": { name: "Nomadic Pastoralism (husbandry)", subsection: "Farming", order: 18 },
  "forest_pastoralism": { name: "Forest Pastoralism (adaptive husbandry)", subsection: "Farming", order: 19 },
  "wetland_pastoralism": { name: "Wetland Pastoralism (adaptive husbandry)", subsection: "Farming", order: 20 },
  "food_storage": { name: "Granary", subsection: "Food trade", order: 21 },
  "grain_imports": { name: "Grain Imports", subsection: "Food trade", order: 22 },
  "market": { name: "Traders", subsection: "Traders", order: 23 },
  "harbour": { name: "Harbour Improvement", subsection: "Ports", order: 24 },
  "port_buildings": { name: "Ports", subsection: "Ports", order: 25 },
  "river_port": { name: "River Ports", subsection: "Ports", order: 26 },
  "wine_industry": { name: "Wine Production", subsection: "Rural Industries", order: 27 },
  "olive_cultivation": { name: "Olive Oil Production", subsection: "Rural Industries", order: 28 },
  "hemp_cultivation": { name: "Hemp Production", subsection: "Rural Industries", order: 29 },
  "dates_cultivation": { name: "Dates Cultivation", subsection: "Rural Industries", order: 30 },
  "agroforestry": { name: "Agroforestry", subsection: "Rural Industries", order: 31 },
  "papyrus_maker": { name: "Papyrus Exploitation", subsection: "Rural Industries", order: 32 },
  "honey_industry": { name: "Beekeepers", subsection: "Rural Industries", order: 33 },
  "hunters": { name: "Hunters", subsection: "Rural Industries", order: 34 },
  "horse_trainer": { name: "Horse Trainer", subsection: "Rural Industries", order: 35 },
  "camels_trade": { name: "Camel Herd", subsection: "Rural Industries", order: 36 },
  "timber_industry": { name: "Lumber Industry", subsection: "Rural Industries", order: 37 },
  "ivory_trade": { name: "Ivory Trade", subsection: "Rural Industries", order: 38 },
  "silk_trader": { name: "Silk Trade", subsection: "Urban Industries", order: 39 },
  "incense_trader": { name: "Incense Trader", subsection: "Urban Industries", order: 40 },
  "amber_trader": { name: "Amber Trader", subsection: "Urban Industries", order: 41 },
  "slave_market": { name: "Slave Market", subsection: "Urban Industries", order: 42 },
  "spices_trading": { name: "Spices Trader", subsection: "Urban Industries", order: 43 },
  "perfumes_industry": { name: "Medicinal Herbs & Perfumes", subsection: "Urban Industries", order: 44 },
  "salted_fish": { name: "Fish Salting Industry", subsection: "Urban Industries", order: 45 },
  "glass_production": { name: "Glass Industry", subsection: "Urban Industries", order: 46 },
  "dyes_production": { name: "Dye Industry", subsection: "Urban Industries", order: 47 },
  "textiles_production": { name: "Textile Production", subsection: "Urban Industries", order: 48 },
  "pottery_production": { name: "Pottery Production", subsection: "Urban Industries", order: 49 },
  "hides_industry": { name: "Hides Industry", subsection: "Urban Industries", order: 50 },
  "grain_industry": { name: "Grain Industry", subsection: "Urban Industries", order: 51 },
  "salt_production": { name: "Salt Extraction", subsection: "Heavy Industries", order: 52 },
  "pitch_gathering": { name: "Pitch Industry", subsection: "Heavy Industries", order: 53 },
  "purple_dye_production": { name: "Purple Dye Industry", subsection: "Heavy Industries", order: 54 },
  "sulphur_industry": { name: "Sulphur Industry", subsection: "Heavy Industries", order: 55 },
  "smith": { name: "Weaponsmiths", subsection: "Heavy Industries", order: 56 },
  "artisans": { name: "Metalworkers", subsection: "Heavy Industries", order: 57 },
  "jewelry": { name: "Jeweller Industry", subsection: "Heavy Industries", order: 58 },
  "marble_production": { name: "Marble Extraction", subsection: "Heavy Industries", order: 59 },
  "stone_quarry": { name: "Stone Quarry", subsection: "Heavy Industries", order: 60 },
  "mines": { name: "Mines", subsection: "Heavy Industries", order: 61 },
  "tin_industry": { name: "Tin Industry", subsection: "Special Exports", order: 62 },
  "copper_industry": { name: "Copper Industry", subsection: "Special Exports", order: 63 },
  "lead_industry": { name: "Lead Industry", subsection: "Special Exports", order: 64 },
  "iron_industry": { name: "Iron Industry", subsection: "Special Exports", order: 65 },
  "hinterland_roads": { name: "Roads", subsection: "Roads", order: 66 },
  "health": { name: "Sanitation", subsection: "Health", order: 67 },
  "hospitals": { name: "Healing", subsection: "Health", order: 68 },
  "colony": { name: "Colonies", subsection: "Colonies", order: 69 },
  "academic": { name: "Academies", subsection: "Civics", order: 70 },
  "autonomous_mint": { name: "Local Mint", subsection: "Civics", order: 71 },
  "centralized_mint": { name: "Centralized Mint", subsection: "Civics", order: 72 },
  "justice_court": { name: "Justice System", subsection: "Civics", order: 73 },
  "amphitheatres": { name: "Arena's", subsection: "Leisure", order: 74 },
  "racing_stadium": { name: "Racing & Athletics", subsection: "Leisure", order: 75 },
  "theatres": { name: "Theatre & Music", subsection: "Leisure", order: 76 },
  "taverns": { name: "Taverns", subsection: "Leisure", order: 77 },
  "temples_standard": { name: "Temples", subsection: "Temples", order: 78 },
  "temples_unique": { name: "Unique Buildings", subsection: "Unique Buildings", order: 79 },
};

// Chains the team does not want shown. Both are legacy: export_descr_buildings.txt marks
// farms "remove this chain after removing prebuilts" in its own comment, and neither is
// built in any settlement at the campaign start.
const EXCLUDED = new Set(["farms", "despotic_law"]);

// Excluded chains are kept OUT OF THE INDEX but not out of the wiki: other pages state facts
// about them that are true and countable — a culture page says "5 building levels are written
// so that being Roman rules them out", and those five are farms levels. Suppressing the
// references would falsify that count. They only need a readable label, so they get their
// existing display name and nothing more.
const NAME_ONLY = {
  farms: "Farms",
  despotic_law: "Execution Square",
};

const SUBSECTIONS = ["Core", "Government", "Defences", "Military", "Farming", "Food trade", "Traders", "Ports", "Rural Industries", "Urban Industries", "Heavy Industries", "Special Exports", "Roads", "Health", "Colonies", "Civics", "Leisure", "Temples", "Unique Buildings"];

// Lookups are case-insensitive on purpose. The keys here come from page slugs, which are
// lowercased, while the chain tokens in export_descr_buildings.txt are not: governmentA
// through governmentD carry a capital. Matching on the raw token silently dropped those
// four into an "Other" heading still wearing their old names.
const key = (token) => String(token == null ? "" : token).toLowerCase();
const chainName = (token, fallback) =>
  (CHAINS[key(token)] ? CHAINS[key(token)].name : (NAME_ONLY[key(token)] || fallback || token));
const isExcluded = (token) => EXCLUDED.has(key(token));
const chainOrder = (token) => (CHAINS[key(token)] ? CHAINS[key(token)].order : Number.MAX_SAFE_INTEGER);
const chainSubsection = (token) => (CHAINS[key(token)] ? CHAINS[key(token)].subsection : null);

module.exports = { CHAINS, EXCLUDED, SUBSECTIONS, chainName, isExcluded, chainOrder, chainSubsection };
