"""
dump_render_curve.py — read the game's ACTUAL drawn road curve from the
AERIAL_MAP_ROADS render structure (not the grid tile path). Each aerial ROAD
has a NODE array whose nodes carry the engine's own computed float positions
and tangents (the terrain-shaped, non-grid curve the game rasterises). We dump
node pos+tangent per road → Provincia rebuilds the exact cubic Bezier from them.

Structure (reverse-engineered from rtw.exe, aerial_map_roads.cpp):
  global @0x144E23488 -> AERIAL_MAP_INTERFACE; +0x7280 -> AERIAL_MAP_ROADS*
  AERIAL_MAP_ROADS: +0x10 region-array ptr, +0x18 region count
  REGION*  = qword[regionArray + regionId*8]
  REGION: +0x20 road-array ptr, +0x2C road count
  ROAD*    = qword[roadArray + i*8]
  ROAD: +0x28 NODE-array ptr, +0x34 node count
  NODE (0x24 bytes): +0x0 type(int) +0x4 tile.x +0x8 tile.z
                     +0xC pos.x(f) +0x10 pos.z(f) +0x14 tan.x(f) +0x18 tan.z(f)
World map (for W/H + pixel flip): global @0x145128748 -> +0x50 W, +0x54 H.
map_regions pixel = (pos.x, H - pos.z)  (pos already in tile units, +0.5 centred)

USAGE: campaign map open, then:  py C:\\dev\\_research\\dump_render_curve.py
Writes render_curve.json next to this script.
"""
import ctypes as C
from ctypes import wintypes as W
import json, sys, os, struct

IMAGE_BASE = 0x140000000
G_AMI = 0x144E23488
OFF_AMR = 0x7280
G_WORLD = 0x145128748
CANDIDATE = ["Total War ROME REMASTERED.exe", "rtw.exe"]

k32 = C.WinDLL("kernel32", use_last_error=True)
TH32_PROC, TH32_MOD, TH32_MOD32 = 0x2, 0x8, 0x10
class PE(C.Structure):
    _fields_ = [("dwSize", W.DWORD), ("cntUsage", W.DWORD), ("th32ProcessID", W.DWORD),
                ("th32DefaultHeapID", C.POINTER(C.c_ulong)), ("th32ModuleID", W.DWORD),
                ("cntThreads", W.DWORD), ("th32ParentProcessID", W.DWORD),
                ("pcPriClassBase", C.c_long), ("dwFlags", W.DWORD), ("szExeFile", C.c_char*260)]
class ME(C.Structure):
    _fields_ = [("dwSize", W.DWORD), ("th32ModuleID", W.DWORD), ("th32ProcessID", W.DWORD),
                ("GlblcntUsage", W.DWORD), ("ProccntUsage", W.DWORD), ("modBaseAddr", C.POINTER(C.c_byte)),
                ("modBaseSize", W.DWORD), ("hModule", W.HMODULE), ("szModule", C.c_char*256),
                ("szExePath", C.c_char*260)]

def find():
    snap = k32.CreateToolhelp32Snapshot(TH32_PROC, 0); pe = PE(); pe.dwSize = C.sizeof(pe)
    got = []
    if k32.Process32First(snap, C.byref(pe)):
        while True:
            got.append((pe.th32ProcessID, pe.szExeFile.decode(errors="ignore")))
            if not k32.Process32Next(snap, C.byref(pe)): break
    k32.CloseHandle(snap)
    for pid, nm in got:
        if nm.lower() in [c.lower() for c in CANDIDATE]: return pid, nm
    for pid, nm in got:
        if nm.lower().startswith("rome") or nm.lower().startswith("total war"): return pid, nm
    return None, None

def base(pid, nm):
    snap = k32.CreateToolhelp32Snapshot(TH32_MOD | TH32_MOD32, pid); me = ME(); me.dwSize = C.sizeof(me); b = None
    if k32.Module32First(snap, C.byref(me)):
        while True:
            if me.szModule.decode(errors="ignore").lower() == nm.lower():
                b = C.cast(me.modBaseAddr, C.c_void_p).value; break
            if not k32.Module32Next(snap, C.byref(me)): break
    k32.CloseHandle(snap); return b

pid, nm = find()
if not pid: print("game not running"); sys.exit(1)
B = base(pid, nm); print(f"{nm} pid={pid} base=0x{B:X}")
h = k32.OpenProcess(0x10 | 0x400, False, pid)
def rd(a, n):
    buf = (C.c_char*n)(); got = C.c_size_t(0)
    return buf.raw[:got.value] if k32.ReadProcessMemory(h, C.c_void_p(a), buf, n, C.byref(got)) else b""
def u64(a): d = rd(a,8); return int.from_bytes(d,"little") if len(d)==8 else 0
def u32(a): d = rd(a,4); return int.from_bytes(d,"little") if len(d)==4 else 0
def f32(a): d = rd(a,4); return struct.unpack("<f", d)[0] if len(d)==4 else 0.0

wm = u64(B + (G_WORLD - IMAGE_BASE)); Wd = u32(wm+0x50); Hd = u32(wm+0x54)
print("W,H =", Wd, Hd)
ami = u64(B + (G_AMI - IMAGE_BASE)); amr = u64(ami + OFF_AMR)
print(f"AMI=0x{ami:X} AMR=0x{amr:X}")
regArr = u64(amr + 0x10); regCnt = u32(amr + 0x18)
print("regions:", regCnt, "arr=0x%X" % regArr)
roads = []
for r in range(min(regCnt, 5000)):
    reg = u64(regArr + r*8)
    if not reg: continue
    roadArr = u64(reg + 0x20); roadCnt = u32(reg + 0x2C)
    if not roadArr or roadCnt > 200: continue
    for i in range(roadCnt):
        road = u64(roadArr + i*8)
        if not road: continue
        nArr = u64(road + 0x28); nCnt = u32(road + 0x34)
        if not nArr or not nCnt or nCnt > 5000: continue
        nodes = []
        raw = rd(nArr, nCnt * 0x24)
        for k in range(nCnt):
            o = k*0x24
            if o+0x1c > len(raw): break
            px, pz = struct.unpack_from("<ff", raw, o+0xc)
            tx, tz = struct.unpack_from("<ff", raw, o+0x14)
            nodes.append([round(px,3), round(pz,3), round(tx,3), round(tz,3)])
        if len(nodes) >= 2:
            roads.append(nodes)
print("aerial roads with nodes:", len(roads))
out = {"W": Wd, "H": Hd, "note": "node = [pos.x, pos.z, tan.x, tan.z] tile units; pixel=(pos.x, H-pos.z); rebuild cubic bezier arm 0.33",
       "roads": roads}
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "render_curve.json")
json.dump(out, open(dst, "w"))
print("wrote", dst)
for nd in roads[:3]:
    print("  road", len(nd), "nodes; first:", nd[:2])
