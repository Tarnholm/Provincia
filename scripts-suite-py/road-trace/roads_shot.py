"""Hand-traced road waypoints in screenshot space (002514.png) + verification render.

Topology: J1 = three-way junction south of the north town.
  A: north town -> J1
  B: J1 -> Cornus (the long west road)
  C: J1 -> NE town
  D: Cornus -> southeast (curls south, exits toward off-frame south towns)
  E: Cornus/south road -> SW town area (bottom-left)
"""
import numpy as np
from PIL import Image, ImageDraw

SHOT = r"C:\Users\vtarn\OneDrive\Skrivbord\images\Skärmbild 2026-07-19 002514.png"
OUT = r"C:\Users\vtarn\AppData\Local\Temp\claude\C--Users-vtarn-OneDrive-Skrivbord\6fd4885d-f016-48c8-bf38-a20b78536fc3\scratchpad"

ROADS = {
    "A_north_J1": [
        (535, 92), (520, 100), (508, 108), (498, 120), (488, 134),
        (478, 148), (468, 161), (459, 172), (452, 180),
    ],
    "B_J1_cornus": [
        (452, 180), (435, 186), (420, 189), (405, 191), (390, 210),
        (375, 217), (355, 222), (335, 228), (315, 233), (300, 239),
        (287, 245), (277, 253), (269, 263), (262, 276), (256, 289),
        (250, 301), (245, 313), (239, 326), (233, 339), (225, 352),
        (219, 368), (214, 385), (209, 402), (208, 418), (211, 432),
        (215, 448), (210, 462), (207, 472),
    ],
    "C_J1_neast": [
        (452, 180), (467, 182), (482, 184), (497, 187), (512, 185),
        (528, 182), (545, 180), (562, 178), (580, 175), (597, 172),
        (612, 169), (622, 165), (630, 158), (633, 150),
    ],
    "D_cornus_south": [
        (222, 505), (238, 494), (252, 483), (267, 475), (283, 469),
        (299, 465), (315, 459), (330, 453), (342, 461), (347, 476),
        (342, 491), (333, 505), (323, 518), (313, 532), (304, 545),
        (296, 559), (288, 572), (281, 585), (274, 598), (268, 610),
        (261, 622), (255, 635), (249, 648), (243, 660), (240, 668),
    ],
    "E_to_swest": [
        (205, 512), (196, 524), (188, 537), (179, 549), (170, 560),
        (160, 570), (150, 578), (142, 583),
    ],
}

img = Image.open(SHOT).convert("RGB")
d = ImageDraw.Draw(img)
COLS = {"A_north_J1": (255, 0, 0), "B_J1_cornus": (0, 100, 255), "C_J1_neast": (255, 160, 0),
        "D_cornus_south": (200, 0, 255), "E_to_swest": (0, 255, 120)}
for name, pts in ROADS.items():
    d.line(pts, fill=COLS[name], width=2)
    for p in pts:
        d.ellipse([p[0]-2, p[1]-2, p[0]+2, p[1]+2], outline=(255, 255, 0))
img.save(OUT + r"\overlay_waypoints.png")
print("saved overlay_waypoints.png")

if __name__ == "__main__":
    import json
    with open(OUT + r"\roads_shot.json", "w") as f:
        json.dump(ROADS, f)
