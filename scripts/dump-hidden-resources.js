#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const MOD = 'C:/RIS/RIS';
const RESOURCES_FILE = path.join(MOD, 'data/descr_sm_resources.txt');
const REGIONS_FILE = path.join(MOD, 'data/world/maps/base/descr_regions.txt');
const EDB_FILE = path.join(MOD, 'data/export_descr_buildings.txt');
const SCRIPT_FILE = path.join(MOD, 'data/world/maps/campaign/imperial_campaign/RIS_Campaign_Script.txt');
const MERCS_FILE = path.join(MOD, 'data/world/maps/campaign/imperial_campaign/descr_mercenaries.txt');
const REBEL_FACTIONS_FILE = path.join(MOD, 'data/descr_rebel_factions.txt');
const SPAWN_DIR = path.join(MOD, 'data/world/maps/campaign/imperial_campaign/spawn_scripts');
const UNIT_VARIATION_FILE = path.join(MOD, 'data/descr_unit_variation.txt');
const OUT_FILE = path.join(MOD, 'hidden_resources_reference.txt');

const SAMPLE_LIMIT = 4;

function read(f) { return fs.readFileSync(f, 'utf8'); }

// 1. Extract every hidden_resource name from descr_sm_resources.txt.
function extractHiddenResources(src) {
  const names = [];
  const re = /"([A-Za-z0-9_\-]+)"\s*:\s*\{\s*"subtype"\s*:\s*"hidden"/g;
  let m;
  while ((m = re.exec(src)) !== null) names.push(m[1]);
  return names;
}

// 2. Parse descr_regions.txt -> { resource -> [region names] }
function parseRegionAssignments(src) {
  const map = new Map();
  const lines = src.split(/\r?\n/);
  let block = [];
  const blocks = [];
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, '').trimEnd();
    if (line.trim() === '') {
      if (block.length) { blocks.push(block); block = []; }
    } else {
      block.push(line);
    }
  }
  if (block.length) blocks.push(block);

  for (const b of blocks) {
    if (b.length < 6) continue;
    const regionName = b[0].trim();
    if (!/^[A-Z]/.test(regionName)) continue;
    const resourceLine = b[5];
    if (!resourceLine) continue;
    const tokens = resourceLine.split(',').map(t => t.trim()).filter(Boolean);
    for (const tok of tokens) {
      if (!map.has(tok)) map.set(tok, []);
      map.get(tok).push(regionName);
    }
  }
  return map;
}

// 3. Scan EDB for `hidden_resource <name>` usages.
function scanEdb(src) {
  const map = new Map(); // name -> [{line, text}]
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const re = /hidden_resource\s+([A-Za-z0-9_\-]+)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const name = m[1];
      if (!map.has(name)) map.set(name, []);
      map.get(name).push({ line: i + 1, text: line.trim() });
    }
  }
  return map;
}

// 4. Scan the campaign script for add_/remove_hidden_resource <scope> <name>.
function scanScript(src) {
  const map = new Map();
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*;/.test(line)) continue; // skip commented-out
    const re = /(add|remove)_hidden_resource\s+\S+\s+([A-Za-z0-9_\-]+)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const name = m[2];
      if (!map.has(name)) map.set(name, []);
      map.get(name).push({ line: i + 1, text: line.trim(), op: m[1] });
    }
  }
  return map;
}

// 5. Scan descr_mercenaries for `pool <name>`.
function scanMercs(src) {
  const map = new Map();
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*pool\s+([A-Za-z0-9_\-]+)/.exec(lines[i]);
    if (m) {
      const name = m[1];
      if (!map.has(name)) map.set(name, []);
      map.get(name).push({ line: i + 1, text: lines[i].trim() });
    }
  }
  return map;
}

// 6. Scan rebel factions for resource references.
function scanRebelFactions(src, hiddenSet) {
  const map = new Map();
  const lines = src.split(/\r?\n/);
  let currentFaction = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const facMatch = /^\s*faction\s+(\S+)/.exec(line);
    if (facMatch) currentFaction = facMatch[1];
    const reqMatch = /^\s*(resources|hidden_resource)\s+(.+)$/.exec(line);
    if (reqMatch) {
      const tokens = reqMatch[2].split(/[,\s]+/).filter(Boolean);
      for (const t of tokens) {
        if (hiddenSet.has(t)) {
          if (!map.has(t)) map.set(t, []);
          map.get(t).push({ line: i + 1, faction: currentFaction });
        }
      }
    }
  }
  return map;
}

// 7. Scan all spawn scripts.
function scanSpawnScripts(dir) {
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.txt'));
  for (const f of files) {
    const fp = path.join(dir, f);
    const lines = read(fp).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*;/.test(line)) continue;
      const re = /(add|remove)_hidden_resource\s+\S+\s+([A-Za-z0-9_\-]+)/g;
      let m;
      while ((m = re.exec(line)) !== null) {
        const name = m[2];
        if (!map.has(name)) map.set(name, []);
        map.get(name).push({ file: f, line: i + 1, text: line.trim(), op: m[1] });
      }
    }
  }
  return map;
}

// 8. Scan descr_unit_variation for the cosmetic flags.
function scanUnitVariation(src, hiddenSet) {
  const map = new Map();
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const tokens = lines[i].split(/[\s,]+/).filter(Boolean);
    for (const t of tokens) {
      if (hiddenSet.has(t)) {
        if (!map.has(t)) map.set(t, 0);
        map.set(t, map.get(t) + 1);
      }
    }
  }
  return map;
}

// 9. Categorize a hidden_resource name.
const TERRAINS = new Set(['hills','mountain_valley','grassland','river_valley','mountains','desert','plateau','forest','floodplains_delta','small_islands_and_rocky_coast','wetlands','steppe','karst_terrain']);
const CLIMATES = new Set(['mediterranean','continental','oceanic','arid','cold_semi_arid','hot_semi_arid','dry_sub_tropical','humid_sub_tropical','temperate','monsoon','alpine','sub_artic','tropical']);
const DISASTERS = new Set(['earthquakes','floods','storms','volcano']);
const SHIELD_STYLES = new Set(['umbo','spine','mixed']);
const MERC_CENTERS = new Set(['merc_center','merc_center_no_port']);
const SETTLEMENT_AOR = new Set(['sparta','spartan','spartan_land','naupaktos','halikarnassos','mazaka','lissos','amaseia','hyrkania','damastion','sidon']);
const MISC = new Set(['rome','italy','egyptian_native','capital','sicily','trade_hub','barren','rivertrade','unbuildable','nobuild','island_settlement','noisland','cg_antibonus','caravan','rebel','slave','n_italy','c_italy','s_italy','crete','euzonoi','greece','silk_road','campaign_has_started']);

function categorize(name) {
  if (name.startsWith('rel_')) return 'Religion (level)';
  if (name.endsWith('_supply_built')) return 'Supply-chain flag (granted by trade building)';
  if (/^Farm\d+$/.test(name)) return 'Farm tier';
  if (name.endsWith('_has_revolted')) return 'Revolt event flag (set after revolt)';
  if (name.endsWith('_spawned')) return 'Revolt spawn flag (set when rebels appear)';
  if (name.endsWith('_reforms_available') || /_ref_\d+_available$/.test(name) || name.endsWith('_recruit_reform')) return 'Reform / event flag';
  if (name.startsWith('ai_')) return 'AI control flag';
  if (name.endsWith('_homeland') || name.endsWith('_home')) return 'Cultural homeland';
  if (name.endsWith('_land')) return 'Cultural recruiting zone';
  if (name.startsWith('irrigation_')) return 'Irrigation';
  if (name.startsWith('base_port_level_') || name === 'harbour_constructed') return 'Port / harbour';
  if (DISASTERS.has(name)) return 'Disaster';
  if (TERRAINS.has(name)) return 'Terrain';
  if (CLIMATES.has(name)) return 'Climate';
  if (SHIELD_STYLES.has(name)) return 'Shield style (cosmetic)';
  if (MERC_CENTERS.has(name)) return 'Mercenary center';
  if (SETTLEMENT_AOR.has(name)) return 'Settlement-named AOR';
  if (MISC.has(name)) return 'Misc gameplay tag';
  return 'Cultural / regional identity';
}

function fmtList(arr, max) {
  if (!arr || !arr.length) return '(none)';
  if (arr.length <= max) return arr.join(', ');
  return arr.slice(0, max).join(', ') + ', ...(' + (arr.length - max) + ' more)';
}

function main() {
  console.log('Reading mod files...');
  const resourcesSrc = read(RESOURCES_FILE);
  const regionsSrc = read(REGIONS_FILE);
  const edbSrc = read(EDB_FILE);
  const scriptSrc = read(SCRIPT_FILE);
  const mercSrc = read(MERCS_FILE);
  const rebelSrc = read(REBEL_FACTIONS_FILE);
  const variationSrc = fs.existsSync(UNIT_VARIATION_FILE) ? read(UNIT_VARIATION_FILE) : '';

  const names = extractHiddenResources(resourcesSrc);
  const hiddenSet = new Set(names);
  console.log('Found ' + names.length + ' hidden_resources.');

  const regionMap = parseRegionAssignments(regionsSrc);
  const edbMap = scanEdb(edbSrc);
  const scriptMap = scanScript(scriptSrc);
  const mercMap = scanMercs(mercSrc);
  const rebelMap = scanRebelFactions(rebelSrc, hiddenSet);
  const spawnMap = scanSpawnScripts(SPAWN_DIR);
  const variationMap = scanUnitVariation(variationSrc, hiddenSet);

  // Group by category for easier reading
  const byCategory = new Map();
  for (const name of names) {
    const cat = categorize(name);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(name);
  }
  for (const arr of byCategory.values()) arr.sort();

  const out = [];
  out.push('HIDDEN_RESOURCES REFERENCE — ' + path.basename(MOD));
  out.push('Generated ' + new Date().toISOString());
  out.push('Total hidden_resources declared: ' + names.length);
  out.push('');
  out.push('Source: ' + path.relative(MOD, RESOURCES_FILE));
  out.push('Consumers scanned:');
  out.push('  - ' + path.relative(MOD, REGIONS_FILE) + ' (region assignments)');
  out.push('  - ' + path.relative(MOD, EDB_FILE) + ' (building / recruitment requirements)');
  out.push('  - ' + path.relative(MOD, SCRIPT_FILE) + ' (add_/remove_hidden_resource)');
  out.push('  - ' + path.relative(MOD, MERCS_FILE) + ' (mercenary pools)');
  out.push('  - ' + path.relative(MOD, REBEL_FACTIONS_FILE) + ' (rebel faction blocks)');
  out.push('  - ' + path.relative(MOD, SPAWN_DIR) + '/*.txt');
  out.push('  - ' + path.relative(MOD, UNIT_VARIATION_FILE));
  out.push('');
  out.push('FORMAT PER RESOURCE:');
  out.push('  Each entry shows the inferred category, the consumer counts, and the');
  out.push('  regions that assign it. Up to ' + SAMPLE_LIMIT + ' sample lines are quoted from each');
  out.push('  consumer file. "Regions" lists every region that includes this');
  out.push('  resource on its descr_regions.txt resource line.');
  out.push('');
  out.push('=' .repeat(78));
  out.push('TABLE OF CONTENTS');
  out.push('=' .repeat(78));
  const cats = Array.from(byCategory.keys()).sort();
  for (const c of cats) out.push('  ' + c + ' — ' + byCategory.get(c).length);
  out.push('');

  for (const cat of cats) {
    out.push('');
    out.push('#'.repeat(78));
    out.push('# CATEGORY: ' + cat + ' (' + byCategory.get(cat).length + ')');
    out.push('#'.repeat(78));
    for (const name of byCategory.get(cat)) {
      const regions = regionMap.get(name) || [];
      const edb = edbMap.get(name) || [];
      const script = scriptMap.get(name) || [];
      const mercs = mercMap.get(name) || [];
      const rebels = rebelMap.get(name) || [];
      const spawns = spawnMap.get(name) || [];
      const variation = variationMap.get(name) || 0;

      out.push('');
      out.push('=== ' + name + ' ===');
      out.push('Category: ' + cat);
      out.push('Counts: regions=' + regions.length + '  edb=' + edb.length + '  script=' + script.length + '  mercs=' + mercs.length + '  rebel=' + rebels.length + '  spawnScripts=' + spawns.length + '  unitVariation=' + variation);
      out.push('Regions (' + regions.length + '): ' + (regions.length ? regions.join(', ') : '(none)'));

      if (edb.length) {
        out.push('EDB usages (' + edb.length + '):');
        for (const u of edb.slice(0, SAMPLE_LIMIT)) {
          const t = u.text.length > 200 ? u.text.slice(0, 200) + '...' : u.text;
          out.push('  L' + u.line + ': ' + t);
        }
        if (edb.length > SAMPLE_LIMIT) out.push('  (+' + (edb.length - SAMPLE_LIMIT) + ' more in EDB)');
      }
      if (script.length) {
        out.push('Campaign script (' + script.length + '):');
        for (const u of script.slice(0, SAMPLE_LIMIT)) {
          out.push('  L' + u.line + ' [' + u.op + ']: ' + u.text);
        }
        if (script.length > SAMPLE_LIMIT) out.push('  (+' + (script.length - SAMPLE_LIMIT) + ' more)');
      }
      if (mercs.length) {
        out.push('Mercenary pools (' + mercs.length + '):');
        for (const u of mercs) out.push('  L' + u.line + ': ' + u.text);
      }
      if (rebels.length) {
        const facs = Array.from(new Set(rebels.map(r => r.faction)));
        out.push('Rebel factions: ' + facs.join(', '));
      }
      if (spawns.length) {
        const grouped = {};
        for (const u of spawns) {
          if (!grouped[u.file]) grouped[u.file] = [];
          grouped[u.file].push(u);
        }
        out.push('Spawn scripts (' + spawns.length + '):');
        for (const f of Object.keys(grouped)) {
          out.push('  ' + f + ': ' + grouped[f].map(u => 'L' + u.line + '[' + u.op + ']').join(' '));
        }
      }
      if (variation) out.push('descr_unit_variation.txt: ' + variation + ' tokens');
    }
  }

  fs.writeFileSync(OUT_FILE, out.join('\n'), 'utf8');
  console.log('Wrote ' + OUT_FILE + ' (' + out.length + ' lines)');
}

main();
