import json
import re

input_file = 'descr_regions.txt'
output_file = 'regions.json'

def is_rgb(line):
    # Checks if line is three numbers (RGB)
    return bool(re.match(r'^\d+\s+\d+\s+\d+$', line.strip()))

with open(input_file, encoding='utf-8') as f:
    lines = [line.rstrip('\n') for line in f]

regions = {}

i = 0
while i < len(lines):
    line = lines[i].strip()
    # Skip empty lines and comments
    if not line or line.startswith(';'):
        i += 1
        continue

    region = line
    city = lines[i + 1].strip() if i + 1 < len(lines) else ""
    faction = lines[i + 2].strip() if i + 2 < len(lines) else ""
    culture = lines[i + 3].strip() if i + 3 < len(lines) else ""
    rgb_line = lines[i + 4].strip() if i + 4 < len(lines) else ""

    if is_rgb(rgb_line):
        tags = lines[i + 5].strip() if i + 5 < len(lines) else ""
        farm_level = lines[i + 6].strip() if i + 6 < len(lines) else ""
        pop_level = lines[i + 7].strip() if i + 7 < len(lines) else ""
        ethnicities = lines[i + 8].strip() if i + 8 < len(lines) else ""

        rgb = ','.join(rgb_line.split())
        regions[rgb] = {
            "region": region,
            "city": city,
            "faction": faction,
            "culture": culture,
            "tags": tags,
            "farm_level": farm_level,
            "pop_level": pop_level,
            "ethnicities": ethnicities
        }
        i += 9
    else:
        i += 1

with open(output_file, 'w', encoding='utf-8') as out:
    json.dump(regions, out, ensure_ascii=False, indent=2)

print(f"Regions data written to {output_file}")