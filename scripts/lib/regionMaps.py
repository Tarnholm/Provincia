"""
Region maps for the wiki: one picture per region, shown on both its region page and its
settlement page. Drawn the way Provincia's own map view draws the world:

  terrain   map_ground_types.tga through Provincia's GROUND_TYPE_PALETTE (App.js), at the
            TGA's native ~2x resolution
  relief    map_heights.tga red channel, 3x3 Sobel, north-west light, Z 3.5, soft-light
            blended over the terrain (App.js heights overlay)
  owners    each land region lightly tinted with its turn-0 owner's colour (the muted colour
            factionMap.js uses), so neighbours read as someone's
  borders   region boundaries from map_regions.tga, darkened lines
  subject   the page's region tinted and outlined in the faction-map red
  towns     every settlement in view as a dot with its name; the subject's larger and bold
  inset     the whole map in a corner with the view marked, so a close-up is never lost

The window is sized to the region (it fills about 40% of the width) with a floor so small
regions still show their neighbours, and is clamped inside the map.

    python regionMaps.py <input.json>

input.json (written by gen-ris-region-pages.js):
  { "ris": <data dir>, "out": <dir>, "regions": [ { "token", "rgb": [r,g,b], "settlement",
    "owner": [r,g,b] | null, "sx", "sy" } ] }
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT_W, OUT_H = 640, 440
ASP = OUT_W / OUT_H
FILL = 0.40          # the region's share of the window width (or height, whichever binds)
MIN_W = 64           # window floor in region-map pixels (~250 km): neighbours always show
MAX_W = 420
INSET_W = 150

PALETTE = {  # App.js GROUND_TYPE_PALETTE
    (0, 128, 128): (120, 190, 90), (96, 160, 64): (140, 200, 100), (101, 124, 0): (175, 190, 95),
    (0, 0, 0): (200, 190, 140), (196, 128, 128): (92, 84, 96), (98, 65, 65): (140, 122, 120),
    (128, 128, 64): (178, 150, 108), (0, 64, 0): (25, 95, 40), (0, 128, 0): (55, 150, 70),
    (0, 255, 128): (90, 150, 110), (64, 0, 0): (30, 70, 130), (128, 0, 0): (45, 100, 170),
    (196, 0, 0): (80, 160, 210), (255, 255, 255): (235, 225, 170),
}
SEA_FALLBACK = (45, 100, 170)
SUBJECT = np.array([214, 46, 38], float)
HALO = (255, 240, 205)
LABEL_FILL, LABEL_STROKE = (250, 244, 228), (28, 22, 16)
OWNER_MIX = 0.30
FONT_DIR = os.path.join(os.environ.get("WINDIR", "C:/Windows"), "Fonts")


def load(path):
    return np.asarray(Image.open(path).convert("RGB"))


def main(spec_path, only=None):
    spec = json.load(open(spec_path, encoding="utf-8"))
    base = os.path.join(spec["ris"], "world", "maps", "base")
    out_dir = spec["out"]
    os.makedirs(out_dir, exist_ok=True)

    reg = load(os.path.join(base, "map_regions.tga"))
    H, W = reg.shape[:2]
    key = (reg[..., 0].astype(np.int32) << 16) | (reg[..., 1].astype(np.int32) << 8) | reg[..., 2]
    regions = spec["regions"]
    keys = np.array([(r["rgb"][0] << 16) | (r["rgb"][1] << 8) | r["rgb"][2] for r in regions])
    order = np.argsort(keys)
    pos = np.searchsorted(keys[order], key.ravel()).clip(0, len(keys) - 1)
    hit = keys[order][pos] == key.ravel()
    idx = np.where(hit, order[pos], -1).reshape(H, W)       # region index, -1 = sea / not a region

    # Settlement pixels (black) belong to the region around them for borders and tints.
    black = (key == 0)
    if black.any():
        filled = idx.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sh = np.roll(np.roll(idx, dy, 0), dx, 1)
            filled = np.where(black & (filled < 0) & (sh >= 0), sh, filled)
        idx = filled

    # Dithered coastlines: a few regions (Latium Novum's shore) are painted as a checkerboard of
    # land and sea pixels, which drew as a grid of little squares. A land pixel with no same-
    # region neighbour beside it but one on a diagonal is such a pattern and is drawn as sea.
    # A real one-pixel island has no diagonal neighbour either, so it stays.
    for _ in range(2):
        pp = np.pad(idx, 1, constant_values=-2)
        cc = pp[1:-1, 1:-1]
        side = (pp[:-2, 1:-1] == cc) | (pp[2:, 1:-1] == cc) | (pp[1:-1, :-2] == cc) | (pp[1:-1, 2:] == cc)
        diag = (pp[:-2, :-2] == cc) | (pp[:-2, 2:] == cc) | (pp[2:, :-2] == cc) | (pp[2:, 2:] == cc)
        idx = np.where((cc >= 0) & ~side & diag, -1, idx)

    # ── the base picture at the terrain TGA's resolution ──
    gt = load(os.path.join(base, "map_ground_types.tga"))
    gH, gW = gt.shape[:2]
    gkey = (gt[..., 0].astype(np.int32) << 16) | (gt[..., 1].astype(np.int32) << 8) | gt[..., 2]
    terr = np.empty((gH, gW, 3), float)
    terr[:] = PALETTE[(0, 0, 0)]
    for (r, g, b), col in PALETTE.items():
        terr[gkey == ((r << 16) | (g << 8) | b)] = col

    # Region index and owner colour carried up to the terrain resolution (nearest).
    ys = np.minimum((np.arange(gH) * H / gH).astype(int), H - 1)
    xs = np.minimum((np.arange(gW) * W / gW).astype(int), W - 1)
    idx2 = idx[ys][:, xs]
    land2 = idx2 >= 0
    # The sea follows the REGION map's coastline, not the terrain map's (they disagree by a
    # pixel here and there, which left flecks of land out at sea). Its depth colours come in as
    # scattered single pixels, so they are blurred into one smooth field.
    SEA_TYPES = {(64, 0, 0), (128, 0, 0), (196, 0, 0)}
    is_sea_type = np.zeros(gkey.shape, bool)
    for (r, g, b) in SEA_TYPES:
        is_sea_type |= gkey == ((r << 16) | (g << 8) | b)
    sea = np.where(is_sea_type[..., None], terr, np.array(SEA_FALLBACK, float))
    sea_img = Image.fromarray(sea.astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))
    terr[~land2] = np.asarray(sea_img).astype(float)[~land2]
    # ...and land the terrain map calls sea gets the commonest land colour instead.
    terr[land2 & is_sea_type] = PALETTE[(0, 0, 0)]
    # The terrain types come in 2-pixel blocks that read as speckle when enlarged; a light blur
    # keeps each area's colour but loses the blockiness. The relief below stays sharp.
    terr = np.asarray(Image.fromarray(np.clip(terr, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.4))).astype(float)

    hts = load(os.path.join(base, "map_heights.tga"))[..., 0].astype(float)
    if hts.shape != (gH, gW):
        hts = np.asarray(Image.fromarray(hts.astype(np.uint8)).resize((gW, gH), Image.BILINEAR)).astype(float)
    p = np.pad(hts, 1, mode="edge")
    a, b_, c = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    d, f = p[1:-1, :-2], p[1:-1, 2:]
    g, h, i = p[2:, :-2], p[2:, 1:-1], p[2:, 2:]
    dx = (c + 2 * f + i) - (a + 2 * d + g)
    dy = (g + 2 * h + i) - (a + 2 * b_ + c)
    shade = np.clip(128 - (dx + dy) * 3.5, 0, 255)
    shade[~land2] = 128
    A, B = terr / 255.0, (shade / 255.0)[..., None]
    soft = np.where(B <= 0.5, 2 * A * B + A * A * (1 - 2 * B), 2 * A * (1 - B) + np.sqrt(A) * (2 * B - 1))
    img = soft * 255.0

    owner = np.array([r["owner"] if r.get("owner") else [-1, -1, -1] for r in regions], float)
    own2 = np.where(land2[..., None], owner[np.maximum(idx2, 0)], -1)
    has = own2[..., 0] >= 0
    img[has] = img[has] * (1 - OWNER_MIX) + own2[has] * OWNER_MIX
    base_img = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    sx2, sy2 = gW / W, gH / H

    # Inset: the whole map, small, once.
    inset_h = round(INSET_W * H / W)
    inset = base_img.resize((INSET_W, inset_h), Image.LANCZOS)

    font = ImageFont.truetype(os.path.join(FONT_DIR, "pala.ttf"), 14)
    font_b = ImageFont.truetype(os.path.join(FONT_DIR, "palab.ttf"), 18)

    towns = [(k, r["sx"], r["sy"], r["settlement"]) for k, r in enumerate(regions) if r.get("sx") is not None]
    written = 0
    for k, r in enumerate(regions):
        if only and r["token"] not in only:
            continue
        m = idx == k
        if not m.any():
            continue
        rows, cols = np.where(m)
        x0, x1, y0, y1 = cols.min(), cols.max() + 1, rows.min(), rows.max() + 1
        ww = min(MAX_W, max(MIN_W, (x1 - x0) / FILL, (y1 - y0) / FILL * ASP))
        wh = ww / ASP
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        wx = min(max(0, cx - ww / 2), W - ww)
        wy = min(max(0, cy - wh / 2), H - wh)
        scale = OUT_W / ww

        pic = base_img.resize((OUT_W, OUT_H), Image.LANCZOS,
                              box=(wx * sx2, wy * sy2, (wx + ww) * sx2, (wy + wh) * sy2))
        arr = np.asarray(pic).astype(float)

        # Region index at output resolution (nearest), for borders and the subject mask.
        oy = np.minimum((wy + (np.arange(OUT_H) + 0.5) / scale).astype(int), H - 1)
        ox = np.minimum((wx + (np.arange(OUT_W) + 0.5) / scale).astype(int), W - 1)
        win = idx[oy][:, ox]
        # Smooth the staircase: each map pixel is ~scale output pixels, so a mode filter of about
        # that size rounds the steps into lines while keeping every region where it is. The index
        # goes through an RGB image because that is what the filter takes (0 = sea).
        size = max(3, min(15, int(scale) | 1))
        v = win + 1
        enc = np.stack([(v >> 8) & 255, v & 255, np.zeros_like(v)], -1).astype(np.uint8)
        dec = np.asarray(Image.fromarray(enc).filter(ImageFilter.ModeFilter(size))).astype(np.int32)
        win = (dec[..., 0] << 8 | dec[..., 1]) - 1
        edge = np.zeros(win.shape, bool)
        edge[:, :-1] |= win[:, :-1] != win[:, 1:]
        edge[:-1, :] |= win[:-1, :] != win[1:, :]
        arr[edge] *= 0.45

        subj = win == k
        arr[subj] = arr[subj] * 0.58 + SUBJECT * 0.42
        # Outline: a 3-pixel red band just inside the subject, a 2-pixel pale ring just outside.
        def grown(mask, n):
            out = mask.copy()
            for _ in range(n):
                g = out.copy()
                for s in (1, -1):
                    g |= np.roll(out, s, 0) | np.roll(out, s, 1)
                out = g
            return out
        inner = ~grown(~subj, 3)
        arr[subj & ~inner] = SUBJECT
        arr[grown(subj, 2) & ~subj] = HALO

        pic = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        dr = ImageDraw.Draw(pic)

        # Settlements in view. Every dot is drawn and reserved first, so no label can cover a
        # town; then the labels are placed greedily, the subject's first, keeping clear of the
        # dots, of each other and of the inset corner.
        inset_box = (OUT_W - INSET_W - 12, OUT_H - inset_h - 12, OUT_W, OUT_H)
        taken = [inset_box]
        def place(text, px, py, fnt, rad):
            w = dr.textlength(text, font=fnt)
            hgt = fnt.size + 2
            for ax, ay in ((rad + 4, -hgt / 2), (-rad - 4 - w, -hgt / 2), (-w / 2, -rad - 3 - hgt), (-w / 2, rad + 2)):
                box = (px + ax - 2, py + ay - 1, px + ax + w + 2, py + ay + hgt)
                if box[0] < 2 or box[1] < 2 or box[2] > OUT_W - 2 or box[3] > OUT_H - 2:
                    continue
                if any(not (box[2] < t[0] or box[0] > t[2] or box[3] < t[1] or box[1] > t[3]) for t in taken):
                    continue
                taken.append(box)
                dr.text((px + ax, py + ay), text, font=fnt, fill=LABEL_FILL, stroke_width=2, stroke_fill=LABEL_STROKE)
                return True
            return False

        def at(tx, ty):
            return (tx + 0.5 - wx) * scale, (ty + 0.5 - wy) * scale
        def inside(px, py):
            return 4 <= px <= OUT_W - 4 and 4 <= py <= OUT_H - 4 and not (px >= inset_box[0] and py >= inset_box[1])
        me = [t for t in towns if t[0] == k]
        others = [(at(tx, ty), name) for kk, tx, ty, name in towns if kk != k and inside(*at(tx, ty))]
        for (px, py), _name in others:
            dr.ellipse((px - 3.5, py - 3.5, px + 3.5, py + 3.5), fill=LABEL_FILL, outline=LABEL_STROKE, width=2)
            taken.append((px - 4, py - 4, px + 4, py + 4))
        if me:
            px, py = at(me[0][1], me[0][2])
            dr.ellipse((px - 7, py - 7, px + 7, py + 7), fill=HALO, outline=tuple(int(v) for v in SUBJECT), width=3)
            dr.ellipse((px - 2.5, py - 2.5, px + 2.5, py + 2.5), fill=LABEL_STROKE)
            taken.append((px - 8, py - 8, px + 8, py + 8))
            if not place(me[0][3], px, py, font_b, 7):
                # The page's own settlement is always named: at the map's edge none of the four
                # spots fit, so the label goes beside it, pushed inside the frame.
                w = dr.textlength(me[0][3], font=font_b)
                lx = min(max(4, px + 11), OUT_W - w - 4)
                if lx < px + 11 and px - 11 - w >= 4:
                    lx = px - 11 - w
                ly = min(max(4, py - 10), OUT_H - 26)
                taken.append((lx - 2, ly - 1, lx + w + 2, ly + 21))
                dr.text((lx, ly), me[0][3], font=font_b, fill=LABEL_FILL, stroke_width=2, stroke_fill=LABEL_STROKE)
        for (px, py), name in others:
            place(name, px, py, font, 4)

        # Inset in the bottom-right corner, with the window drawn on it.
        ins = inset.copy()
        di = ImageDraw.Draw(ins)
        fx = INSET_W / W
        rx0, ry0, rx1, ry1 = wx * fx, wy * fx, (wx + ww) * fx, (wy + wh) * fx
        if rx1 - rx0 < 6:
            mx, my = (rx0 + rx1) / 2, (ry0 + ry1) / 2
            rx0, rx1, ry0, ry1 = mx - 3, mx + 3, my - 2, my + 2
        di.rectangle((rx0, ry0, rx1, ry1), outline=tuple(int(v) for v in SUBJECT), width=2)
        ox0, oy0 = OUT_W - INSET_W - 8, OUT_H - inset_h - 8
        dr.rectangle((ox0 - 2, oy0 - 2, ox0 + INSET_W + 1, oy0 + inset_h + 1), fill=LABEL_STROKE)
        pic.paste(ins, (ox0, oy0))

        pic.save(os.path.join(out_dir, r["token"] + ".webp"), "WEBP", quality=82, method=5)
        written += 1
    print(f"region maps: {written} written to {out_dir}")


if __name__ == "__main__":
    only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else None
    main(sys.argv[1], only)
