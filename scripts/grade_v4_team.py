#!/usr/bin/env python3
"""Grade an arbitrary roster with the v4 engine (each player vs their own
most-recent season), at the conservative tune, next to the current site OVR."""
import sys, grade_v4 as G

# Notre Dame 2025-26 — current site OVR from the roster screenshot (None = '—')
ROSTER = {
 'Braeden Shrewsberry':83,'Markus Burton':None,'Cole Certa':85,'Jalen Haralson':89,
 'Logan Imes':73,'Garrett Sundra':72,'Sir Mohammed':76,'Brady Koehler':78,
 'Kebba Njie':72,'Ryder Frost':73,'Mark Zackery IV':None,'Matthew MacLellan':None,'Brady Stevens':None,
}

def best_grades(logi, names):
    G.CONFIG["logistic"].update(logi)
    best={}
    for yr in range(2013,2027):
        rows=G.load(yr)
        if not rows: continue
        for p in G.grade_players(rows):
            n=p["name"]
            if n in names and (n not in best or yr>best[n][0]):
                best[n]=(yr,p["grade"],p["_debug"]["reliability"])
    return best

# compressed scale: floor 58, span 40 (=98 ceiling+1->99), gentle slope, slight down-shift
# so a rotation player (z~0) ~76, bench (z~-1.5) ~66, star (z~+2.5) ~92
names=set(ROSTER)
tuned=best_grades({"floor":58,"span":41,"k":0.6,"center":0.9},names)

print(f"  {'PLAYER':22} {'SZN':>7} {'V4':>4} {'NOW':>4}  rel")
order=sorted(ROSTER, key=lambda n: -(tuned[n][1] if n in tuned else -1))
for n in order:
    now=ROSTER[n]; nows='—' if now is None else str(now)
    if n in tuned:
        yr,g,rel=tuned[n]; szn=f"{yr-1}-{str(yr)[2:]}"
        flag=' (small sample)' if rel<0.95 else ''
        print(f"  {n:22} {szn:>7} {g:>4} {nows:>4}  {rel:.2f}{flag}")
    else:
        print(f"  {n:22} {'—':>7} {'—':>4} {nows:>4}   (sub-rotation: <8 mpg, not graded)")
