import sys
import re

def get_block(lines, start):
    """
    Given a list of lines and starting index, returns the block between matching braces.
    Returns the block lines and the index of the closing brace.
    """
    brace_count = 0
    found_first_brace = False
    n = len(lines)
    for i in range(start, n):
        if '{' in lines[i]:
            found_first_brace = True
        if found_first_brace:
            brace_count += lines[i].count('{')
            brace_count -= lines[i].count('}')
        if found_first_brace and brace_count == 0:
            return lines[start:i+1], i
    return [], start

def extract_settlement_meta(block):
    """
    Extracts region, level, population, faction_creator and all buildings from a settlement block.
    Returns a dict with extracted info.
    """
    region = None
    level = "town"
    population = None
    faction_creator = None
    buildings = []
    in_building = False
    building_type = None
    building_level = None
    for line in block:
        s = line.strip()
        if s.startswith("region"):
            parts = s.split()
            if len(parts) >= 2:
                region = parts[1]
        elif s.startswith("level"):
            parts = s.split()
            if len(parts) >= 2:
                level = parts[1]
        elif s.startswith("population"):
            parts = s.split()
            if len(parts) >= 2:
                try:
                    population = int(parts[1])
                except ValueError:
                    population = None
        elif s.startswith("faction_creator"):
            parts = s.split()
            if len(parts) >= 2:
                faction_creator = parts[1]
        elif s.startswith("building"):
            in_building = True
            building_type = None
            building_level = None
        elif in_building and s.startswith("type"):
            parts = s.split()
            if len(parts) >= 3:
                building_type = parts[1]
                building_level = parts[2]
                buildings.append({"type": building_type, "level": building_level})
        elif in_building and "}" in s:
            in_building = False
    return {
        "region": region,
        "level": level,
        "population": population,
        "faction_creator": faction_creator,
        "buildings": buildings
    }

def parse_descr_strat_buildings(filename):
    with open(filename, encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()
    # Find the start of factions section
    start_idx = 0
    for idx, line in enumerate(lines):
        if "; >>>> start of factions section <<<<" in line:
            start_idx = idx + 1
            break
    i = start_idx
    n = len(lines)
    factions = []
    while i < n:
        line = lines[i].strip()
        faction_match = re.match(r"^faction\s+([^\s,]+)", line)
        if faction_match:
            faction_name = faction_match.group(1)
            settlements = []
            i += 1
            while i < n:
                line2 = lines[i].strip()
                if line2.startswith("faction") or line2.startswith("; >>>>"):
                    break
                if line2.startswith("settlement"):
                    block_lines, end_idx = get_block(lines, i)
                    meta = extract_settlement_meta(block_lines)
                    settlements.append(meta)
                    i = end_idx + 1
                else:
                    i += 1
            factions.append({
                "faction": faction_name,
                "settlements": settlements
            })
        else:
            i += 1
    return factions

if __name__ == "__main__":
    infile = sys.argv[1] if len(sys.argv) > 1 else "descr_strat.txt"
    outfile = sys.argv[2] if len(sys.argv) > 2 else "descr_strat_buildings.json"
    data = parse_descr_strat_buildings(infile)
    import json
    with open(outfile, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Output written to {outfile}")