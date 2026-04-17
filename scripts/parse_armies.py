"""
Parse character/army positions from descr_strat.txt files.
Outputs armies_classic.json and armies_large.json to public/.

armyClass:
  "garrison" - character's strat coordinates are within their faction's territory
  "field"    - in the field (;outside X / no comment / on foreign/sea territory)
  "navy"     - admiral or ;Port of X

Classification uses coordinate-based pixel detection on the regions map:
  sample the 7x7 pixel area at the strat (x, y) position, find the dominant
  faction by color. If it matches the character's faction → garrison.

Comment-based filters (navy, field qualifiers) are applied first.
"""
import re, json, struct
from pathlib import Path
from PIL import Image

STRATS = [
    {
        "path":      Path("for claude/classic files/descr_strat.txt"),
        "out":       Path("public/armies_classic.json"),
        "img_h":     350,
        "map_img":   Path("public/map_regions_classic.tga"),
        "regions":   Path("public/regions_classic.json"),
        "tga":       True,
    },
    {
        "path":      Path("for claude/descr_strat.txt"),
        "out":       Path("public/armies_large.json"),
        "img_h":     700,
        "map_img":   Path("public/map_regions_large.tga"),
        "regions":   Path("public/regions_large.json"),
        "tga":       True,
    },
]

CHAR_RE  = re.compile(r'^character,?\s+(.+)')
COORD_RE = re.compile(r'x\s+(\d+),\s*y\s+(\d+)')
UNIT_RE  = re.compile(r'^unit\s+(.+?)(?:\s+exp\s|$)')


def is_sea(r, g, b):
    return r < 60 and 120 <= g <= 160 and b >= 200


def load_pixel_reader(cfg):
    """Return get_pixel(sx, sy) -> (r,g,b)|None."""
    img_h = cfg["img_h"]

    if not cfg["tga"]:
        # PNG: PIL loads with y=0 at top; strat y=0 is bottom → flip
        img = Image.open(cfg["map_img"]).convert("RGBA")
        pix = img.load()
        W, H = img.width, img.height
        def get_pixel(sx, sy):
            ix, iy = sx, img_h - 1 - sy
            if 0 <= ix < W and 0 <= iy < H:
                r, g, b, *_ = pix[ix, iy]
                return (r, g, b)
            return None
    else:
        # TGA: bottom-left origin → row 0 = strat_y=0 → no flip
        data = cfg["map_img"].read_bytes()
        id_len = data[0]
        w = struct.unpack_from("<H", data, 12)[0]
        h = struct.unpack_from("<H", data, 14)[0]
        bpp = data[16]
        raw = data[18 + id_len:]
        stride = bpp // 8
        def get_pixel(sx, sy):
            ix, iy = sx, sy  # no flip
            if 0 <= ix < w and 0 <= iy < h:
                idx = (iy * w + ix) * stride
                b2, g2, r2 = raw[idx], raw[idx + 1], raw[idx + 2]
                return (r2, g2, b2)
            return None

    return get_pixel



def find_city_pixel(sx, sy, get_pixel, radius=3):
    """Return (x, y) of the nearest black (city-tile) pixel within Euclidean radius,
    or None if no such pixel exists."""
    best = None
    best_d2 = radius * radius + 1
    r = int(radius)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            d2 = dx * dx + dy * dy
            if d2 > radius * radius:
                continue
            p = get_pixel(sx + dx, sy + dy)
            if p == (0, 0, 0) and d2 < best_d2:
                best_d2 = d2
                best = (sx + dx, sy + dy)
    return best


def army_class(char_line, comment, sx, sy, get_pixel):
    """Return (armyClass, snapped_sx, snapped_sy).
    snapped coords point at the city-tile pixel for garrisons, else original coords."""
    cl = char_line.lower()
    co = comment.lower()

    # Navies
    if "admiral" in cl or co.startswith(";port of") or "(sea)" in co:
        return "navy", sx, sy

    # Explicit field hints in comment (prefix or parenthetical qualifier)
    if co.startswith(";outside") or co.startswith(";near") or co.startswith(";field"):
        return "field", sx, sy
    if "(field)" in co or "(outside)" in co:
        return "field", sx, sy

    # No ; comment → field
    if not comment.startswith(";"):
        return "field", sx, sy

    # Has a ;CityName comment: find nearest black (city-tile) pixel within 3px.
    # Snap coordinates to that pixel so the dot renders on the city square.
    center = get_pixel(sx, sy)
    if center is not None and is_sea(*center):
        return "field", sx, sy
    city = find_city_pixel(sx, sy, get_pixel, radius=3)
    if city:
        return "garrison", city[0], city[1]

    return "field", sx, sy


def char_type(line):
    l = line.lower()
    if "admiral"  in l: return "admiral"
    if "spy"      in l: return "spy"
    if "diplomat" in l: return "diplomat"
    if "merchant" in l: return "merchant"
    return "general"


def parse(cfg):
    get_pixel = load_pixel_reader(cfg)
    armies = []
    faction = None
    current = None
    in_army = False
    prev_comment = ""

    with open(cfg["path"], encoding="utf-8", errors="replace") as f:
        lines = f.readlines()

    for line in lines:
        s = line.rstrip()

        # Faction block header
        fm = re.match(r"^faction\s+(\w+)", s)
        if fm:
            if current and current["units"]:
                armies.append(current)
            faction = fm.group(1)
            current = None
            in_army = False
            prev_comment = ""
            continue

        # Track comment lines
        if s.strip().startswith(";") and not re.match(r"^character,", s):
            prev_comment = s.strip()

        # Character line
        cm = CHAR_RE.match(s)
        if cm:
            if current and current["units"]:
                armies.append(current)
            in_army = False
            rest = cm.group(1)
            coord = COORD_RE.search(rest)
            if not coord:
                current = None
                prev_comment = ""
                continue
            sx, sy = int(coord.group(1)), int(coord.group(2))
            name = rest.split(",")[0].strip().replace("_", " ")
            ac, snapped_sx, snapped_sy = army_class(rest, prev_comment, sx, sy, get_pixel)
            loc = prev_comment.lstrip(";").strip() if prev_comment.startswith(";") else ""
            current = {
                "name": name,
                "charType": char_type(rest),
                "armyClass": ac,
                "location": loc,
                "faction": faction,
                "x": snapped_sx,
                "y": cfg["img_h"] - 1 - snapped_sy,
                "units": [],
            }
            prev_comment = ""
            continue

        if s.strip() == "army":
            in_army = True
            continue

        if in_army and current is not None:
            um = UNIT_RE.match(s.strip())
            if um:
                current["units"].append(um.group(1).strip())
            elif s.strip() and not s[0].isspace() and s[0] != "\t":
                in_army = False

    if current and current["units"]:
        armies.append(current)

    return armies


for cfg in STRATS:
    print(f"Parsing {cfg['path']} ...")
    armies = parse(cfg)
    cfg["out"].write_text(json.dumps(armies, indent=2), encoding="utf-8")
    classes = {}
    for a in armies:
        classes[a["armyClass"]] = classes.get(a["armyClass"], 0) + 1
    print(f"  -> {len(armies)} armies: {classes}")

# Quick sanity checks
imp = json.loads(Path("public/armies_large.json").read_text())
hiero = [a for a in imp if "Hiero" in a["name"] and a["faction"] == "syracuse"]
for h in hiero:
    print(f"  Hiero check: {h['name']} armyClass={h['armyClass']} location={h['location']} (expect garrison)")
artemidoros = [a for a in imp if "Artemidoros" in a["name"] and a["faction"] == "syracuse"]
for a in artemidoros:
    print(f"  Artemidoros check: {a['name']} armyClass={a['armyClass']} location={a['location']} (expect field)")

print("Done.")
