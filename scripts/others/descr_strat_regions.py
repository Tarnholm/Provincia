import re
import json
import sys

def parse_strat_file(file_path):
    """
    Parses descr_strat.txt to get starting regions for each faction.
    Returns a dictionary: {faction_name: [region1, region2, ...]}
    Only factions with at least one region are included.
    """
    faction_regions = {}
    current_faction = None
    in_settlement_block = False

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        for line in lines:
            stripped_line = line.strip()

            # Skip comments and empty lines
            if not stripped_line or stripped_line.startswith(';'):
                continue

            # Detect faction block start
            faction_match = re.match(r'faction\s+(\w+)[,\s]', stripped_line)
            if faction_match:
                current_faction = faction_match.group(1).lower()
                if current_faction not in faction_regions:
                    faction_regions[current_faction] = []
                in_settlement_block = False
                continue

            # Detect settlement block start
            if stripped_line == "settlement":
                in_settlement_block = True
                continue

            # Detect settlement block end
            if stripped_line == "}" and in_settlement_block:
                in_settlement_block = False
                continue

            # Extract region name within a settlement block
            if in_settlement_block and stripped_line.startswith("region"):
                region_name = stripped_line.replace("region", "").strip()
                if current_faction and region_name:
                    faction_regions[current_faction].append(region_name)

    except FileNotFoundError:
        print(f"Error: {file_path} not found. Please ensure it's in the same directory.")

    # Only return factions with at least one region
    return {k: v for k, v in faction_regions.items() if v}

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python descr_strat_regions.py descr_strat.txt output.json")
        sys.exit(1)

    descr_strat_path = sys.argv[1]
    output_path = sys.argv[2]

    faction_regions = parse_strat_file(descr_strat_path)

    with open(output_path, "w", encoding="utf-8") as out:
        json.dump(faction_regions, out, indent=2)
    print(f"Done! Output saved to {output_path}")