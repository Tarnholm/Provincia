"""master_processor.py — single-entry consolidated processor.

Currently a hybrid:
  * Inlined rules (see "INLINED RULES" section): the rule logic for these
    scripts has been migrated INTO this file. The original .py files are
    kept untouched as reference but are not invoked.
  * Imported rules: scripts whose logic still lives in their own .py file
    and is invoked through the import-and-call orchestrator.

After every step, a per-building allowlist is applied as a final post-filter
that strips any `type <chain> <level>` line not allowed by the user.

Reads:
  config/descr_strat.txt
  config/descr_regions.txt
  config/export_descr_buildings.txt
  config/descr_sm_factions.txt
  config/building_allowlist.json   (optional — default = allow all)
  config/map_regions.tga           (only needed by slave_placer step)

Writes:
  processed_output/master_run_<ts>/{01_..., 02_..., final/}
  processed_output/descr_strat.txt   (flat, for "Save to Mod")
  processed_output/descr_regions.txt
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

sys.dont_write_bytecode = True

BASE_DIR = Path(__file__).parent
CONFIG_DIR = BASE_DIR / "config"
OUTPUT_DIR = BASE_DIR / "processed_output"
ALLOWLIST_FILE = CONFIG_DIR / "building_allowlist.json"
REGIONS_FILE = CONFIG_DIR / "descr_regions.txt"
MAP_REGIONS_FILE = CONFIG_DIR / "map_regions.tga"


# ── INLINED RULES ────────────────────────────────────────────────────────
# Rule logic migrated from individual scripts. Each `_step_xxx` function is
# the entry point for one pipeline step; behaviour matches the original .py.

# ── 10_slave_placer (inlined from slave_placer.py) ─────────────────────

def _slave_parse_descr_regions(file_path):
    regions_by_color = {}
    colors_by_region = {}
    region = None
    with open(file_path, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith(";"):
                continue
            if not line[:1].isspace():
                region = s
                continue
            if region is not None:
                m = re.match(r"^(\d+)\s+(\d+)\s+(\d+)$", s)
                if m:
                    rgb = tuple(map(int, m.groups()))
                    regions_by_color[rgb] = region
                    colors_by_region[region] = rgb
                    region = None
    return regions_by_color, colors_by_region


def _slave_get_region_pixels(map_path, regions_by_color):
    from PIL import Image  # imported lazily — only needed for this step
    region_pixels = defaultdict(set)
    with Image.open(map_path) as img:
        img = img.convert("RGB")
        width, height = img.size
        for y in range(height):
            for x in range(width):
                color = img.getpixel((x, y))
                region = regions_by_color.get(color)
                if region:
                    region_pixels[region].add((x, y))
    return region_pixels, width, height


def _slave_parse_existing_resources(strat_text):
    used_coords = defaultdict(set)
    regions_with_slaves = set()
    pat = re.compile(r"^resource\s+(\S+),\s*\d+,\s*(\d+),\s*(\d+)\s*;\s*(.+)", re.IGNORECASE)
    for line in strat_text.splitlines():
        s = line.strip()
        if not s or s.startswith(";"):
            continue
        m = pat.match(s)
        if m:
            res_type = m.group(1).rstrip(",")
            x = int(m.group(2)); y = int(m.group(3))
            region = m.group(4).strip()
            used_coords[region].add((x, y))
            if res_type == "slaves":
                regions_with_slaves.add(region)
    return used_coords, regions_with_slaves


def _step_slave_placer(run_strat, run_out):
    """Inlined replacement for slave_placer.run()."""
    _strat = Path(run_strat)
    _out = Path(run_out)
    if not _strat.exists():
        print(f"ERROR: {_strat} not found", flush=True); sys.exit(1)
    if not MAP_REGIONS_FILE.exists():
        print(f"ERROR: {MAP_REGIONS_FILE} not found — copy map_regions.tga into config/", flush=True)
        sys.exit(1)

    regions_by_color, colors_by_region = _slave_parse_descr_regions(REGIONS_FILE)
    region_pixels, _w, image_height = _slave_get_region_pixels(MAP_REGIONS_FILE, regions_by_color)

    strat_text = _strat.read_text(encoding="utf-8")
    used_coords, regions_with_slaves = _slave_parse_existing_resources(strat_text)

    print(f"  Regions in map: {len(colors_by_region)}", flush=True)
    print(f"  Existing resource placements: {sum(len(v) for v in used_coords.values())}", flush=True)
    print(f"  Regions already with slaves: {len(regions_with_slaves)}", flush=True)

    new_lines = []
    skipped = []
    changelog = []

    for region in sorted(colors_by_region.keys()):
        if region in regions_with_slaves:
            continue
        region_pixel_set = region_pixels.get(region, set())
        if not region_pixel_set:
            skipped.append(f"{region}: no pixels in map_regions"); continue

        used_image_pixels = set()
        for (gx, gy) in used_coords.get(region, set()):
            used_image_pixels.add((gx, image_height - gy - 1))  # ingame → image y-flip

        available = [p for p in region_pixel_set if p not in used_image_pixels]
        if not available:
            skipped.append(f"{region}: no free pixels"); continue

        chosen = available[0]
        ingame_x, ingame_y = chosen[0], image_height - chosen[1] - 1  # image → ingame y-flip
        new_lines.append(f"resource\tslaves,\t1,\t{ingame_x},\t{ingame_y}\t;{region}")
        changelog.append(f"Added slaves to {region} at ({ingame_x}, {ingame_y})")

    lines = strat_text.splitlines(keepends=True)
    last_res_idx = -1
    for i, line in enumerate(lines):
        if line.strip().startswith("resource"):
            last_res_idx = i

    if last_res_idx >= 0 and new_lines:
        block = "\n;slaves (auto-placed)\n" + "\n".join(new_lines) + "\n"
        if not lines[last_res_idx].endswith("\n"):
            lines[last_res_idx] += "\n"
        lines.insert(last_res_idx + 1, block)
    elif new_lines:
        lines.append("\n;slaves (auto-placed)\n" + "\n".join(new_lines) + "\n")

    _out.mkdir(parents=True, exist_ok=True)
    (_out / "descr_strat.txt").write_text("".join(lines), encoding="utf-8")

    changelog_text = "\n".join(changelog) if changelog else \
        "No new slaves placed (all regions already had slaves)."
    if skipped:
        changelog_text += "\n\n; Skipped:\n" + "\n".join(f";  {s}" for s in skipped)
    (_out / "changelog.txt").write_text(changelog_text, encoding="utf-8")

    print(f"  Placed slaves in {len(new_lines)} new regions.", flush=True)
    if skipped:
        print(f"  Skipped {len(skipped)} regions (no pixels).", flush=True)


# ── 03_sanitation_healers (inlined from sanitation_healers.py) ──────────

_SAN_NAME_MAP = {
    "health":    {1: "cisterns", 2: "sewers", 3: "baths", 4: "aqueduct", 5: "city_plumbing"},
    "hospitals": {1: "hospital_1", 2: "hospital_2", 3: "hospital_3", 4: "hospital_3", 5: "hospital_3"},
}
_SAN_SCRUB = ["health", "cisterns", "sewers", "baths", "aqueduct", "city_plumbing",
              "hospitals", "hospital_1", "hospital_2", "hospital_3"]
_SAN_LEVEL_TO_TIER = {"village": 0, "town": 1, "large_town": 2, "minor_city": 3,
                      "city": 3, "large_city": 4, "huge_city": 5}


def _san_first_group(pattern, text, default=""):
    m = re.search(pattern, text, flags=re.IGNORECASE)
    return m.group(1) if m and m.lastindex else default


def _san_load_resources(strat_text):
    region_map = {}
    if not REGIONS_FILE.exists():
        return region_map
    content = REGIONS_FILE.read_text(encoding="utf-8")
    cur = None
    for line in content.splitlines():
        if ";" in line:
            line = line.split(";")[0]
        line = line.rstrip()
        if not line:
            continue
        if not line.startswith(("\t", " ")):
            cur = line.strip()
            region_map[cur] = set()
        elif cur:
            for r in line.strip().split(","):
                region_map[cur].add(r.strip().lower())

    for res, reg in re.findall(r"resource\s+([\w_-]+),\s*[\d\s,]+;\s*([\w_&-]+)", strat_text, flags=re.IGNORECASE):
        reg = reg.strip()
        if reg in region_map:
            region_map[reg].add(res.lower().strip())
    return region_map


def _find_settlement_blocks_text(text):
    """Return list of (start, end) byte offsets for `settlement { ... }` blocks."""
    blocks = []
    idx = 0
    while True:
        m = re.search(r"settlement\s*\{", text[idx:], flags=re.IGNORECASE)
        if not m:
            break
        start = idx + m.start()
        depth = 0
        j = start + text[start:].find("{")
        while j < len(text):
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
                if depth == 0:
                    blocks.append((start, j + 1))
                    idx = j + 1
                    break
            j += 1
        else:
            break
    return blocks


def _san_reconstruct_settlement(block_text, region_map, changelog, decisions):
    inner = block_text[block_text.find("{") + 1: block_text.rfind("}")]
    reg = _san_first_group(r"region\s+([\w_&-]+)", inner, "Unknown")
    lvl_str = _san_first_group(r"level\s+([\w_]+)", inner, "village").lower()

    lvl_val = _SAN_LEVEL_TO_TIER.get(lvl_str, 0)
    if lvl_val <= 1:
        target_tier = lvl_val
    else:
        target_tier = lvl_val - 1

    existing_buildings, original_sanitation, good_headers = [], [], []
    for line in inner.splitlines():
        clean = line.strip()
        if not clean or clean.lower() in ["building", "{", "}"]:
            continue
        if clean.startswith(";"):
            continue
        if any(s in clean.lower() for s in _SAN_SCRUB):
            san_match = re.search(r"type\s+([\w\s_]+)", clean, re.I)
            if san_match:
                original_sanitation.append(san_match.group(1).strip().lower())
            continue
        if "type " in clean.lower():
            existing_buildings.append(clean.replace("type ", "").replace("type", "").strip())
        else:
            good_headers.append(line)

    res = region_map.get(reg, set())
    has_trader = any("trader" in b.lower() for b in existing_buildings)
    med_boosters = {"pitch", "sulphur", "fruits", "honey"}
    water_res = {"lead", "irrigation_river"}  # irrigation_lake/springs removed — fewer pre-built cisterns/wells

    chain, reason = None, "No valid resources found"
    if ("perfumes" in res) and (res & med_boosters):
        chain, reason = "hospitals", f"Perfumes + Medicinal ({', '.join(res & med_boosters)})"
    elif res & water_res:
        chain, reason = "health", f"Water/Infrastructure ({', '.join(res & water_res)})"
    elif "perfumes" in res:
        chain, reason = "hospitals", "Basic Perfumes"

    new_sanitation_type = ""
    if target_tier > 0 and chain:
        if lvl_str == "town" and not has_trader:
            reason = "Town missing trader"
        else:
            b_name = _SAN_NAME_MAP[chain].get(target_tier, "cisterns")
            new_sanitation_type = f"{chain} {b_name}".lower()
    elif target_tier == 0:
        reason = "Village level (Tier 0)"

    orig = original_sanitation[0] if original_sanitation else None
    if orig and not new_sanitation_type:
        changelog.append(f"{reg:25} | REMOVED : {orig:25} | REASON: {reason}")
    elif orig and new_sanitation_type and orig != new_sanitation_type:
        changelog.append(f"{reg:25} | REPLACED: {orig:25} -> {new_sanitation_type:15} | REASON: {reason}")
    elif not orig and new_sanitation_type:
        changelog.append(f"{reg:25} | ADDED    : {new_sanitation_type:25} | REASON: {reason}")

    output = "\n\t".join(h.strip() for h in good_headers)
    for b in existing_buildings:
        output += f"\n\tbuilding\n\t{{\n\t\ttype {b}\n\t}}"
    if new_sanitation_type:
        output += f"\n\tbuilding\n\t{{\n\t\ttype {new_sanitation_type}\n\t}}"

    decisions.append(
        f"REGION: {reg:20} | LVL: {lvl_str:12} | RESULT: "
        f"{new_sanitation_type if new_sanitation_type else 'NONE':15} | WHY: {reason}"
    )
    return f"settlement\n{{\n\t{output.strip()}\n}}"


def _step_sanitation_healers(run_strat, run_out):
    _strat = Path(run_strat); _out = Path(run_out)
    if not _strat.exists():
        return
    content = _strat.read_text(encoding="utf-8")
    region_map = _san_load_resources(content)
    blocks = _find_settlement_blocks_text(content)

    changelog, decisions = [], []
    rebuilt, last_end = [], 0
    for start, end in blocks:
        rebuilt.append(content[last_end:start])
        rebuilt.append(_san_reconstruct_settlement(content[start:end], region_map, changelog, decisions))
        last_end = end
    rebuilt.append(content[last_end:])

    _out.mkdir(parents=True, exist_ok=True)
    (_out / "descr_strat.txt").write_text("".join(rebuilt), encoding="utf-8")
    (_out / "changelog.txt").write_text("\n".join(changelog), encoding="utf-8")
    (_out / "decisions.txt").write_text("\n".join(decisions), encoding="utf-8")
    print(f"DONE. {len(changelog)} changes.", flush=True)


# ── 02_heavy_industry (inlined from heavy_industry.py) ─────────────────

EDB_FILE = CONFIG_DIR / "export_descr_buildings.txt"

_HI_LEVEL_TO_TIER = {"village": 0, "town": 1, "large_town": 2, "minor_city": 3,
                     "city": 3, "large_city": 4, "huge_city": 5}
_HI_SETTLEMENT_LEVEL_ORDER = ["town", "large_town", "city", "large_city", "huge_city"]
# Per-building resource weights (mirror of heavy_industry.py). Building score =
# max over its resources of (amount × weight); resources are the dict keys.
_HI_BUILDING_RESOURCE_WEIGHTS = {
    "smith":                {"iron": 7, "copper": 4, "coal": 6, "livestock": 3, "flax": 3, "timber": 1},
    "mines":                {"gold": 9, "silver": 8, "copper": 6, "lead": 4, "tin": 6, "iron": 5, "slave_trade": 2},
    "purple_dye_production": {"purple_dye": 8},
    "marble_production":     {"marble": 7, "slave_trade": 2},
    "jewelry":              {"gold": 8, "silver": 7, "gemstones": 8, "elephants": 3, "glass": 3, "amber": 4},
    "artisans":             {"copper": 6, "iron": 5, "tin": 6, "lead": 5, "timber": 1},
    "stone_quarry":         {"stone": 5, "slave_trade": 2},
    "sulphur_industry":     {"sulphur": 5, "slave_trade": 2, "grain": 1},
    "pitch_gathering":      {"pitch": 6, "hemp": 1, "timber": 1},
    "salt_production":      {"salt": 6, "slave_trade": 2, "fish": 2, "livestock": 1},
}
_HI_BUILDINGS = set(_HI_BUILDING_RESOURCE_WEIGHTS)
_HI_ENABLING_RESOURCES = {
    "smith":                {"iron", "copper", "coal", "flax", "livestock"},
    "mines":                {"gold", "silver", "copper", "lead", "tin", "iron", "coal"},
    "purple_dye_production": {"purple_dye"},
    "marble_production":     {"marble"},
    "jewelry":              {"gold", "silver", "gemstones"},
    "artisans":             {"copper", "iron", "tin", "lead"},
    "stone_quarry":         {"stone"},
    "sulphur_industry":     {"sulphur"},
    "pitch_gathering":      {"pitch"},
    "salt_production":      {"salt"},
}
_HI_TIE_BREAKER_ORDER = [
    "smith", "mines", "purple_dye_production", "marble_production",
    "artisans", "salt_production", "stone_quarry", "pitch_gathering",
]
_HI_LUXURY_RESOURCES = ("glass", "amber", "elephants")
_HI_JEWELRY_OVER_MINING = {"mines"}


def _hi_get_block(text, start_offset):
    try:
        first_brace = text.index("{", start_offset)
    except ValueError:
        return None, -1
    depth = 1
    for i in range(first_brace + 1, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        if depth == 0:
            return text[first_brace + 1:i], i + 1
    return None, -1


def _hi_bump_settlement_level(level):
    if level not in _HI_SETTLEMENT_LEVEL_ORDER:
        return level
    idx = _HI_SETTLEMENT_LEVEL_ORDER.index(level)
    return _HI_SETTLEMENT_LEVEL_ORDER[min(idx + 1, len(_HI_SETTLEMENT_LEVEL_ORDER) - 1)]


def _hi_parse_edb_levels():
    if not EDB_FILE.exists():
        return {}
    full = EDB_FILE.read_text(encoding="utf-8", errors="ignore")
    chains = {}
    start_marker = ";================= EXPLOITATION BUILDINGS ==================="
    start_pos = full.find(start_marker)
    body = full[start_pos:] if start_pos != -1 else full

    for m in re.finditer(r"^\s*building\s+(\w+)", body, re.MULTILINE):
        b_name = m.group(1)
        txt, _ = _hi_get_block(body, m.end())
        if not txt:
            continue
        levels_m = re.search(r"levels\s+([\w\s+]+)", txt)
        if not levels_m:
            continue
        l_names = levels_m.group(1).strip().split()
        l_block, _ = _hi_get_block(txt, levels_m.end())
        if not l_block:
            continue
        levels_info = []
        last_min = None
        for l_name in l_names:
            chunk = re.search(r"(?m)^\s*" + re.escape(l_name) + r"\s+requires", l_block)
            if not chunk:
                continue
            s_match = re.search(r"settlement_min\s+(\w+)", l_block[chunk.start():])
            edb_min = s_match.group(1) if s_match else last_min
            if not edb_min:
                break
            last_min = edb_min
            s_min = _hi_bump_settlement_level(edb_min) if b_name in _HI_BUILDINGS else edb_min
            levels_info.append({"level": l_name, "settlement_min": s_min})
        if levels_info:
            chains[b_name] = levels_info
    return chains


def _hi_load_regions_data():
    region_to_city = {}
    if not REGIONS_FILE.exists():
        return region_to_city
    content = REGIONS_FILE.read_text(encoding="utf-8")
    cur = None
    region_capital_seen = {}
    for line in content.splitlines():
        line = line.split(";")[0].strip()
        if not line:
            continue
        if not line.startswith(("\t", " ")):
            cur = line
            region_capital_seen[cur] = False
        elif cur and not region_capital_seen[cur]:
            region_to_city[cur] = line
            region_capital_seen[cur] = True
    return region_to_city


def _hi_parse_resources_by_region(strat_text):
    out = {}
    pat = re.compile(r"resource\s+([\w_-]+),\s*([\d.]+),\s*\d+,\s*\d+\s*;\s*([\w_&-]+)", re.IGNORECASE)
    for m in pat.finditer(strat_text):
        res, amt, reg = m.groups()
        if reg not in out:
            out[reg] = {}
        out[reg][res.lower()] = out[reg].get(res.lower(), 0) + float(amt)
    return out


def _hi_select_building(res_dict, tier, chains):
    scores = {}
    for b, weights in _HI_BUILDING_RESOURCE_WEIGHTS.items():
        if not any(res_dict.get(r, 0) > 0 for r in _HI_ENABLING_RESOURCES.get(b, ())):
            continue  # no enabling resource -> building can't be built
        lvls = chains.get(b, [])
        if not lvls:
            continue
        if tier < min(_HI_LEVEL_TO_TIER.get(l["settlement_min"], 99) for l in lvls):
            continue
        val = max([res_dict.get(r, 0) * w for r, w in weights.items()] + [0])
        if val >= 10:
            scores[b] = val
    if not scores:
        return None, None, [], {}
    m_val = max(scores.values())
    tied = [b for b, v in scores.items() if v == m_val]
    best_b = next((b for b in _HI_TIE_BREAKER_ORDER if b in tied), tied[0])
    # Luxury override: glass/amber/elephants present -> jewelry beats raw mining.
    if (best_b in _HI_JEWELRY_OVER_MINING and any(res_dict.get(r, 0) > 0 for r in _HI_LUXURY_RESOURCES)
            and any(res_dict.get(r, 0) > 0 for r in _HI_ENABLING_RESOURCES["jewelry"])):
        jl = chains.get("jewelry", [])
        if jl and tier >= min(_HI_LEVEL_TO_TIER.get(l["settlement_min"], 99) for l in jl):
            best_b = "jewelry"
    allowed = [l["level"] for l in chains[best_b] if tier >= _HI_LEVEL_TO_TIER.get(l["settlement_min"], 99)]
    # Never select a '...supply' level — drop to the highest non-supply level.
    non_supply = [lv for lv in allowed if "supply" not in lv.lower()]
    chosen = non_supply[-1] if non_supply else None
    return best_b, chosen, tied, scores


def _step_heavy_industry(run_strat, run_out):
    _strat = Path(run_strat); _out = Path(run_out)
    if not _strat.exists():
        print(f"Error: {_strat} not found", flush=True)
        return
    content = _strat.read_text(encoding="utf-8")
    region_to_city = _hi_load_regions_data()
    resources_by_region = _hi_parse_resources_by_region(content)
    chains = _hi_parse_edb_levels()

    blocks = []
    idx = 0
    while True:
        m = re.search(r"settlement\s*\{", content[idx:], re.IGNORECASE)
        if not m:
            break
        s_pos = idx + m.start()
        bc = 0
        found = False
        for j in range(s_pos, len(content)):
            if content[j] == "{":
                bc += 1; found = True
            elif content[j] == "}":
                bc -= 1
            if found and bc == 0:
                blocks.append((s_pos, j + 1))
                idx = j + 1
                break
        else:
            break

    rebuilt = []
    settlements_heavy = {}
    changelog = []
    tie_log = []
    decision_log = []
    last_end = 0

    for start, end in blocks:
        rebuilt.append(content[last_end:start])
        lines = content[start:end].splitlines(keepends=True)
        reg, lvl = None, "town"
        for l in lines:
            s = l.strip()
            if s.startswith("region"):
                m_reg = re.match(r"region\s+([\w_&-]+)", s)
                if m_reg:
                    reg = m_reg.group(1)
            if s.startswith("level"):
                lvl = s.split()[1]

        if reg:
            city = region_to_city.get(reg, reg)
            r_dict = resources_by_region.get(reg, {})
            tier = _HI_LEVEL_TO_TIER.get(lvl, 0)
            best_b, best_l, tied, _scores = _hi_select_building(r_dict, tier, chains)

            log_entry = [f"--- Settlement: {city} ---", f"Level: {lvl}"]
            if best_b:
                settlements_heavy[city] = f"{best_b} {best_l}"
                log_entry.append(f"Assigned: {best_b} {best_l}")
                changelog.append(f"{city}: Assigned {best_b} {best_l}")
                if len(tied) > 1:
                    tie_log.append(f"{city}: Tied {tied}, chose {best_b}")
            decision_log.append("\n".join(log_entry))

            clean_lines = []
            in_b = False
            buf = []
            for l in lines:
                if l.strip().startswith("building"):
                    in_b = True
                    buf = [l]
                elif in_b:
                    buf.append(l)
                    if l.strip() == "}":
                        # drop existing heavy-industry building blocks
                        keeper = not any(
                            x.strip().startswith("type")
                            and x.strip().split()[1] in (_HI_BUILDINGS | {"mines"})
                            for x in buf
                        )
                        if keeper:
                            clean_lines.extend(buf)
                        in_b = False
                else:
                    clean_lines.append(l)

            if best_b and best_l:
                for i in range(len(clean_lines) - 1, -1, -1):
                    if clean_lines[i].strip() == "}":
                        ind = re.match(r"^(\s*)", clean_lines[i - 1]).group(1) if i > 0 else ""
                        insert = f"\n{ind}building\n{ind}{{\n{ind}\ttype {best_b} {best_l}\n{ind}}}\n"
                        clean_lines = clean_lines[:i] + [insert] + clean_lines[i:]
                        break
            rebuilt.append("".join(clean_lines))
        last_end = end

    rebuilt.append(content[last_end:])
    _out.mkdir(parents=True, exist_ok=True)
    (_out / "descr_strat.txt").write_text("".join(rebuilt), encoding="utf-8")

    all_possible = [f"{b} {l['level']}" for b, lvls in chains.items() if b in _HI_BUILDINGS for l in lvls]
    (_out / "heavy_industry_buildings.txt").write_text("\n".join(sorted(all_possible)), encoding="utf-8")
    (_out / "heavy_industry_settlements.txt").write_text(
        "\n".join(f"{c}: {b}" for c, b in sorted(settlements_heavy.items())), encoding="utf-8"
    )
    (_out / "heavy_industry_decisions.txt").write_text("\n\n".join(decision_log), encoding="utf-8")
    (_out / "heavy_industry_changelog.txt").write_text("\n".join(changelog), encoding="utf-8")
    (_out / "heavy_industry_debug.txt").write_text("", encoding="utf-8")
    if tie_log:
        (_out / "heavy_industry_ties.txt").write_text("\n".join(tie_log), encoding="utf-8")

    print(f"Success. {len(settlements_heavy)} settlements updated. Output in {_out}", flush=True)


# ── pipeline definition ─────────────────────────────────────────────────
# Imports left ONLY for rules that haven't been inlined yet.

import hidden_resources
import farms
import heavy_industry
import mics
import homelands
import port_authority
import settlement_processor
import temples
import civic
import grain_exports
import starting_treasury
import rural_exploits
import urban_exploits


PIPELINE = [
    ("01_farms",               lambda strat, out: farms.FarmExploitProcessor().run(run_strat=strat, run_out=out)),
    # standalone (single source) — the old inlined copy above went stale (kept
    # pre-v0.9.667 max() scoring, no bump exception); the .py is authoritative
    # and is what the rule editor edits.
    ("02_heavy_industry",      lambda strat, out: heavy_industry.HeavyIndustryProcessor().run(run_strat=strat, run_out=out)),
    ("03_sanitation_healers",  _step_sanitation_healers),     # inlined ✓
    ("04_mics",                lambda strat, out: mics.MilitaryBuildingProcessor().run(run_strat=strat, run_out=out)),
    ("05_homelands",           lambda strat, out: homelands.main(run_strat=strat, run_out=out)),
    ("06_rural_exploits",      lambda strat, out: rural_exploits.main(run_strat=strat, run_out=out)),   # standalone (single source)
    ("07_urban_exploits",      lambda strat, out: urban_exploits.main(run_strat=strat, run_out=out)),   # standalone (single source)
    ("08_port_authority",      lambda strat, out: port_authority.main(run_strat=strat, run_out=out)),
    ("09_settlement_processor",lambda strat, out: settlement_processor.SettlementProcessor(run_out=out).process_file(str(strat))),
    ("10_temples",             lambda strat, out: temples.StandardTempleProcessor().run(run_strat=strat, run_out=out)),
    ("11_slave_placer",        _step_slave_placer),           # inlined ✓
    ("12_civic",               lambda strat, out: civic.CivicBuildingProcessor().run(run_strat=strat, run_out=out)),
    ("13_grain_exports",       lambda strat, out: grain_exports.GrainExportProcessor().run(run_strat=strat, run_out=out)),
    ("14_starting_treasury",   lambda strat, out: starting_treasury.StartingTreasuryProcessor().run(run_strat=strat, run_out=out)),
]


# ── allowlist filter ────────────────────────────────────────────────────

def load_allowlist():
    if not ALLOWLIST_FILE.exists():
        return None  # None means "allow everything"
    try:
        return json.loads(ALLOWLIST_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"WARNING: failed to read allowlist ({e}); allowing all", flush=True)
        return None


def filter_strat(strat_text: str, allow: dict) -> tuple[str, dict]:
    """Strip `type <chain> <level>` lines that aren't allowed.

    `type` lines that appear inside a `building { ... }` block are dropped
    entirely *together with their enclosing block*, so we don't leave empty
    `building { }` shells in the output.
    """
    chains = (allow or {}).get("chains") or {}

    def is_allowed(chain: str, level: str) -> bool:
        ce = chains.get(chain)
        if not ce:
            return True  # unknown chain → allow (fail-open)
        if not ce.get("allowed", True):
            return False
        levels = ce.get("levels") or {}
        if level in levels:
            return bool(levels[level])
        return True

    lines = strat_text.splitlines(keepends=True)
    out = []
    i = 0
    n = len(lines)
    stats = {"dropped_blocks": 0, "kept_blocks": 0, "by_chain": {}}

    while i < n:
        line = lines[i]
        stripped = line.strip()
        if stripped == "building":
            # Look-ahead: gather the entire `building { ... }` block.
            block_start = i
            i += 1
            # skip leading whitespace/comments to the {
            while i < n and lines[i].strip() != "{":
                i += 1
            if i >= n:
                # malformed — emit what we had
                out.append(line)
                continue
            depth = 1
            block_lines = [lines[block_start], lines[i]]
            i += 1
            type_chain = type_level = None
            while i < n and depth > 0:
                block_lines.append(lines[i])
                t = lines[i].strip()
                if t.startswith("type "):
                    parts = t.split()
                    if len(parts) >= 3:
                        type_chain, type_level = parts[1], parts[2]
                if "{" in t:
                    depth += t.count("{")
                if "}" in t:
                    depth -= t.count("}")
                i += 1

            if type_chain and not is_allowed(type_chain, type_level or ""):
                stats["dropped_blocks"] += 1
                stats["by_chain"][type_chain] = stats["by_chain"].get(type_chain, 0) + 1
                # drop the entire block
                continue
            else:
                stats["kept_blocks"] += 1
                out.extend(block_lines)
        else:
            out.append(line)
            i += 1

    return "".join(out), stats


# ── main run ────────────────────────────────────────────────────────────

def run():
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = OUTPUT_DIR / f"master_run_{ts}"
    run_dir.mkdir(parents=True, exist_ok=True)

    regions_file = CONFIG_DIR / "descr_regions.txt"
    regions_csv = CONFIG_DIR / "hidden_resources.csv"
    strat_file = CONFIG_DIR / "descr_strat.txt"

    if not strat_file.exists():
        print(f"ERROR: missing {strat_file}", flush=True)
        sys.exit(1)

    print(f"=== master_processor: {run_dir.name} ===", flush=True)

    # Step 00: hidden resources (rewrites descr_regions.txt in place — backup first)
    regions_backup = regions_file.read_bytes() if regions_file.exists() else None
    hr_dir = run_dir / "00_hidden_resources"
    hr_dir.mkdir(parents=True, exist_ok=True)

    if regions_csv.exists() and regions_file.exists():
        print("[00_hidden_resources] running...", flush=True)
        try:
            hidden_resources.HiddenResourceProcessor().run(
                run_regions=regions_file, run_csv=regions_csv, run_out=hr_dir
            )
            updated = hr_dir / "descr_regions.txt"
            if updated.exists():
                shutil.copy2(updated, regions_file)
        except Exception as e:
            if regions_backup is not None:
                regions_file.write_bytes(regions_backup)
            print(f"ERROR in 00_hidden_resources: {e}", flush=True)
            import traceback; traceback.print_exc()
            sys.exit(1)
    else:
        (hr_dir / "changelog.txt").write_text(
            "Skipped — no hidden_resources.csv in config/\n", encoding="utf-8"
        )

    current_strat = strat_file
    try:
        for name, fn in PIPELINE:
            step_dir = run_dir / name
            step_dir.mkdir(parents=True, exist_ok=True)
            print(f"[{name}] running...", flush=True)
            try:
                fn(current_strat, step_dir)
            except Exception as e:
                print(f"ERROR in {name}: {e}", flush=True)
                import traceback; traceback.print_exc()
                sys.exit(1)
            next_strat = step_dir / "descr_strat.txt"
            if not next_strat.exists():
                print(f"ERROR: {name} did not produce descr_strat.txt", flush=True)
                sys.exit(1)
            current_strat = next_strat
            print(f"[{name}] ok", flush=True)

        # Final: apply per-building allowlist filter
        allowlist = load_allowlist()
        final_dir = run_dir / "final"
        final_dir.mkdir(parents=True, exist_ok=True)
        strat_text = current_strat.read_text(encoding="utf-8")
        if allowlist:
            print("[allowlist] applying filter...", flush=True)
            filtered, stats = filter_strat(strat_text, allowlist)
            print(f"[allowlist] kept {stats['kept_blocks']} buildings, "
                  f"dropped {stats['dropped_blocks']}", flush=True)
            if stats["dropped_blocks"]:
                top = sorted(stats["by_chain"].items(), key=lambda kv: -kv[1])[:10]
                for chain, n in top:
                    print(f"  - {chain}: {n}", flush=True)
            (final_dir / "filter_stats.json").write_text(
                json.dumps(stats, indent=2), encoding="utf-8"
            )
        else:
            filtered = strat_text
            print("[allowlist] none configured — passthrough", flush=True)

        final_strat = final_dir / "descr_strat.txt"
        final_strat.write_text(filtered, encoding="utf-8")

        # Mirror to run_dir root + flat processed_output for Save-to-Mod
        (run_dir / "descr_strat.txt").write_text(filtered, encoding="utf-8")
        (OUTPUT_DIR / "descr_strat.txt").write_text(filtered, encoding="utf-8")

        updated_regions = hr_dir / "descr_regions.txt"
        if updated_regions.exists():
            shutil.copy2(updated_regions, run_dir / "descr_regions.txt")
            shutil.copy2(updated_regions, OUTPUT_DIR / "descr_regions.txt")

        print(f"=== done: {run_dir} ===", flush=True)
    finally:
        # Restore original descr_regions.txt in config (the run dir keeps the updated copy)
        if regions_backup is not None:
            regions_file.write_bytes(regions_backup)


if __name__ == "__main__":
    run()
