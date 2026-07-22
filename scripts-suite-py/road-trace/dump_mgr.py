"""Dump ROAD_MANAGER waypoint paths (the game's COMPUTED road network, post
A* with corridor-merging) and analyze junction topology: which tiles are
shared by multiple roads (junctions) and whether any roads cross mid-segment.
This is the authoritative 'how the game does junctions' source.
ROAD_MANAGER = *[base+0x5128758]; road list DYNAMIC_ARRAY<ROAD*> @mgr+0x6A8
(ptr@+0, count@+0xc). ROAD: waypoints @+0(ptr)/+0xc(cnt) [& +0x10/+0x1c];
waypoint = (int32 sx, int32 sy); endpoint region ids @+0x20/+0x28.
map_regions pixel = (sx, H-1-sy)."""
import ctypes as C
from ctypes import wintypes as W
import json, os, struct

IMAGE_BASE=0x140000000; G_MGR=0x145128758; G_WORLD=0x145128748
CAND=["Total War ROME REMASTERED.exe","rtw.exe"]
k32=C.WinDLL("kernel32",use_last_error=True)
class PE(C.Structure):
    _fields_=[("dwSize",W.DWORD),("cntUsage",W.DWORD),("th32ProcessID",W.DWORD),("th32DefaultHeapID",C.POINTER(C.c_ulong)),("th32ModuleID",W.DWORD),("cntThreads",W.DWORD),("th32ParentProcessID",W.DWORD),("pcPriClassBase",C.c_long),("dwFlags",W.DWORD),("szExeFile",C.c_char*260)]
class ME(C.Structure):
    _fields_=[("dwSize",W.DWORD),("th32ModuleID",W.DWORD),("th32ProcessID",W.DWORD),("GlblcntUsage",W.DWORD),("ProccntUsage",W.DWORD),("modBaseAddr",C.POINTER(C.c_byte)),("modBaseSize",W.DWORD),("hModule",W.HMODULE),("szModule",C.c_char*256),("szExePath",C.c_char*260)]
def find():
    snap=k32.CreateToolhelp32Snapshot(0x2,0); pe=PE(); pe.dwSize=C.sizeof(pe); got=[]
    if k32.Process32First(snap,C.byref(pe)):
        while True:
            got.append((pe.th32ProcessID,pe.szExeFile.decode(errors="ignore")))
            if not k32.Process32Next(snap,C.byref(pe)): break
    k32.CloseHandle(snap)
    for pid,nm in got:
        if nm.lower() in [c.lower() for c in CAND]: return pid,nm
    return None,None
def bmod(pid,nm):
    snap=k32.CreateToolhelp32Snapshot(0x8|0x10,pid); me=ME(); me.dwSize=C.sizeof(me); b=None
    if k32.Module32First(snap,C.byref(me)):
        while True:
            if me.szModule.decode(errors="ignore").lower()==nm.lower(): b=C.cast(me.modBaseAddr,C.c_void_p).value; break
            if not k32.Module32Next(snap,C.byref(me)): break
    k32.CloseHandle(snap); return b
pid,nm=find()
if not pid: print("game not running"); raise SystemExit(1)
B=bmod(pid,nm); h=k32.OpenProcess(0x10|0x400,False,pid)
def rd(a,n):
    buf=(C.c_char*n)(); g=C.c_size_t(0)
    return buf.raw[:g.value] if k32.ReadProcessMemory(h,C.c_void_p(a),buf,n,C.byref(g)) else b""
def u64(a): d=rd(a,8); return int.from_bytes(d,"little") if len(d)==8 else 0
def u32(a): d=rd(a,4); return int.from_bytes(d,"little") if len(d)==4 else 0
def i32(a): d=rd(a,4); return struct.unpack("<i",d)[0] if len(d)==4 else 0

wm=u64(B+(G_WORLD-IMAGE_BASE)); Wd=u32(wm+0x50); Hd=u32(wm+0x54)
mgr=u64(B+(G_MGR-IMAGE_BASE))
arr=u64(mgr+0x6A8); cnt=u32(mgr+0x6A8+0xc)
print(f"ROAD_MANAGER @ {mgr:#x}  roads array @ {arr:#x} count={cnt}")
roads=[]
for i in range(min(cnt,5000)):
    ro=u64(arr+i*8)
    if not ro: continue
    wp=u64(ro+0); wc=u32(ro+0xc)
    if not wp or not (1<=wc<=5000): continue
    raw=rd(wp,wc*8); pts=[]
    for k in range(wc):
        sx,sy=struct.unpack_from("<ii",raw,k*8)
        pts.append([sx,sy])
    ra=i32(ro+0x20); rb=i32(ro+0x28)
    if len(pts)>=2: roads.append({"a":ra,"b":rb,"w":pts})
print(f"roads with waypoints: {len(roads)}")
dst=os.path.join(os.path.dirname(os.path.abspath(__file__)),"master_mgr.json")
json.dump({"W":Wd,"H":Hd,"roads":roads},open(dst,"w"))
print("wrote",dst)

# --- topology analysis on Sardinia (tile x 232-266, pixel y 296-348 -> sy)
def pix(sx,sy): return (sx, Hd-1-sy)
from collections import Counter
sard=[r for r in roads if any(232<=w[0]<=266 and 296<=Hd-1-w[1]<=348 for w in r["w"])]
print(f"Sardinia manager roads: {len(sard)}")
ep=Counter(); tilecount=Counter()
for r in sard:
    ep[tuple(r["w"][0])]+=1; ep[tuple(r["w"][-1])]+=1
    for w in r["w"]: tilecount[tuple(w)]+=1
print("endpoint hubs (>=3):", [(k,v) for k,v in ep.items() if v>=3])
print("shared-tile junctions (a tile used by >=3 roads, incl mid-path):",
      sum(1 for k,v in tilecount.items() if v>=3))
# do any two roads CROSS without sharing that tile? (they share a tile = junction)
# game rule: roads only meet at shared tiles; a mid-segment crossing w/o shared
# tile would be a bug. Check adjacency-diagonal crossings.
def seg_cross(a,b,c,d):
    def ccw(p,q,r): return (r[1]-p[1])*(q[0]-p[0])-(q[1]-p[1])*(r[0]-p[0])
    return (ccw(c,d,a)>0)!=(ccw(c,d,b)>0) and (ccw(a,b,c)>0)!=(ccw(a,b,d)>0)
shared=set(k for k,v in tilecount.items() if v>=2)
cross=0
for i in range(len(sard)):
    for j in range(i+1,len(sard)):
        A=sard[i]["w"]; Bw=sard[j]["w"]
        for x in range(len(A)-1):
            for y in range(len(Bw)-1):
                if seg_cross(A[x],A[x+1],Bw[y],Bw[y+1]):
                    # crossing point near a shared tile? if not -> true crossover
                    if not (tuple(A[x]) in shared or tuple(A[x+1]) in shared): cross+=1
print("manager-road mid-segment crossings NOT at a shared tile:", cross)
