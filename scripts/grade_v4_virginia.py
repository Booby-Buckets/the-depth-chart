#!/usr/bin/env python3
"""Grade each Virginia player against their OWN most-recent season, default vs a
conservative tune, next to the user's hand ranking."""
import grade_v4 as G

COMPRESSED = {"floor":58,"span":41,"k":0.6,"center":0.9}

def best_grades(logi):
    G.CONFIG["logistic"].update(logi)
    best={}
    for yr in range(2013,2027):
        rows=G.load(yr)
        if not rows: continue
        for p in G.grade_players(rows):
            nm=p["name"]
            if nm in G.TARGET and (nm not in best or yr>best[nm][0]):
                best[nm]=(yr,p["grade"],p["_debug"])
    return best

dflt=best_grades({"floor":25,"span":74,"k":1.6,"center":0.0})
tuned=best_grades(COMPRESSED)

print(f"  {'PLAYER':20} {'SZN':>5} {'ENGINE':>7} {'TUNED':>6} {'YOU':>4} {'GAPd':>5} {'GAPt':>5}")
gd=[]; gt=[]
for n,t in sorted(G.TARGET.items(),key=lambda x:-x[1]):
    if n in dflt:
        yr,gdf,_=dflt[n]; gtu=tuned[n][1]
        szn=f"{yr-1}-{str(yr)[2:]}"
        gd.append(gdf-t); gt.append(gtu-t)
        print(f"  {n:20} {szn:>5} {gdf:>7} {gtu:>6} {t:>4} {gdf-t:>+5} {gtu-t:>+5}")
    else:
        print(f"  {n:20} {'—':>5} {'—':>7} {'—':>6} {t:>4}   (no college season — frosh/intl)")
if gd:
    print(f"\n  matched {len(gd)}/13")
    print(f"  DEFAULT: avg gap {sum(gd)/len(gd):+.1f} | MAE {sum(abs(x) for x in gd)/len(gd):.1f}")
    print(f"  TUNED (k=0.6 center=0.9 compressed): avg gap {sum(gt)/len(gt):+.1f} | MAE {sum(abs(x) for x in gt)/len(gt):.1f}")
