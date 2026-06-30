#!/usr/bin/env python3
"""
grade_v4.py — faithful Python port of the pillar grading engine
(scripts/player-grades.mjs, the user's algorithm) + an adapter that feeds it our
bbref data and calibrates against the hand-ranked Virginia roster.

  python3 grade_v4.py [season]        # default 2026 (=2025-26); calibration only, no DB writes

The port preserves the engine exactly: 7 pillars -> weighted z-blend, re-standardized,
composite -> standardize -> (reliability x, size +) -> logistic map to 25-99.
"""
import json, math, sys
from pathlib import Path
DATA = Path(__file__).parent / "data"

# ============================================================ CONFIG (verbatim)
CONFIG = {
    "mode": "value",            # 'value' | 'upside'
    "standardize": "all",       # 'all' | 'position'
    "logistic": {"k": 1.6, "center": 0.0, "floor": 25, "span": 74},
    "reliability": {"fullGames": 28, "floor": 0.82, "minMpgForRates": 10},
    "size": {"weight": 0.15},
}
PILLAR_WEIGHTS = {
    "value":  {"impact":0.23,"offense":0.19,"efficiency":0.15,"defense":0.15,"creation":0.11,"usage":0.09,"scalability":0.08},
    "upside": {"offense":0.20,"efficiency":0.17,"impact":0.16,"creation":0.13,"defense":0.13,"usage":0.11,"scalability":0.10},
}
PILLARS = {
    "offense":    [{"key":"ppg"},{"key":"fgaToFgPct"},{"key":"fta"},{"key":"ppg40"},{"key":"obpm"},{"key":"ows"}],
    "efficiency": [{"key":"tsPct","w":0.60},{"key":"tpPct","w":0.133},{"key":"fgPct","w":0.133},{"key":"ftPct","w":0.133}],
    "creation":   [{"key":"ast"},{"key":"astPct"},{"key":"pprod"},{"key":"orb"},{"key":"to","neg":True},{"key":"tovPct","neg":True}],
    "usage":      [{"key":"usgPct"},{"key":"per"},{"key":"apg40"},{"key":"mpg"}],
    "impact":     [{"key":"wa","w":0.18},{"key":"ws","w":0.18},{"key":"bpm","w":0.18},
                   {"key":"glsT1","w":0.18},{"key":"glsT2","w":0.12},{"key":"glsT3","w":0.09},{"key":"glsT4","w":0.07}],
    "defense":    [{"key":"stl"},{"key":"blk"},{"key":"drb"},{"key":"pf","neg":True}],
    "scalability":[{"key":"fga40","rate":True},{"key":"fta40","rate":True},{"key":"pf40","rate":True,"neg":True},{"key":"to40","rate":True,"neg":True}],
}
SIZE = {"heightVsPos":"heightVsPos","height":"height"}

# ============================================================ engine
def num(v):
    return v if isinstance(v,(int,float)) and math.isfinite(v) else None

def mean_sd(values):
    xs=[v for v in values if v is not None]
    if not xs: return {"mean":0.0,"sd":0.0}
    m=sum(xs)/len(xs); var=sum((x-m)**2 for x in xs)/len(xs)
    return {"mean":m,"sd":math.sqrt(var)}

def z(x,n):
    return 0.0 if (n["sd"]==0 or x is None) else (x-n["mean"])/n["sd"]

def effective_stat(p,stat):
    v=num(p.get(stat["key"]))
    if v is None: return None
    if stat.get("rate") and num(p.get("mpg")) is not None and p["mpg"]<CONFIG["reliability"]["minMpgForRates"]:
        return None
    return v

def group_key(p):
    return (p.get("pos") or "NA") if CONFIG["standardize"]=="position" else "ALL"

def compute_stat_norms(players):
    groups={}
    for p in players: groups.setdefault(group_key(p),[]).append(p)
    norms={}
    for g,pool in groups.items():
        norms[g]={}
        for stats in PILLARS.values():
            for stat in stats:
                if stat["key"] in norms[g]: continue
                norms[g][stat["key"]]=mean_sd([effective_stat(p,stat) for p in pool])
        for k in SIZE.values():
            norms[g][k]=mean_sd([num(p.get(k)) for p in pool])
    return norms

def raw_pillar_score(p,pillar_stats,stat_norms):
    w_sum=0.0; acc=0.0
    for stat in pillar_stats:
        v=effective_stat(p,stat)
        if v is None: continue
        w=stat.get("w",1)
        zi=z(v,stat_norms[stat["key"]])
        if stat.get("neg"): zi=-zi
        acc+=zi*w; w_sum+=w
    return 0.0 if w_sum==0 else acc/w_sum

def reliability(p):
    full=CONFIG["reliability"]["fullGames"]; floor=CONFIG["reliability"]["floor"]
    g=num(p.get("gamesPlayed"))
    if g is None: return 1.0
    return min(floor+(1-floor)*min(g/full,1),1.0)

def size_nudge(p,stat_norms):
    z_pos=z(num(p.get("heightVsPos")),stat_norms["heightVsPos"])
    z_raw=z(num(p.get("height")),stat_norms["height"])
    return CONFIG["size"]["weight"]*(0.8*z_pos+0.2*z_raw)

def to_score(C):
    lg=CONFIG["logistic"]; k,c,fl,sp=lg["k"],lg["center"],lg["floor"],lg["span"]
    s=fl+sp/(1+math.exp(-k*(C-c)))
    return round(max(fl,min(fl+sp,s)))

def grade_players(players):
    if not players: return []
    weights=PILLAR_WEIGHTS[CONFIG["mode"]]; pkeys=list(weights.keys())
    norms_by_group=compute_stat_norms(players)
    raw_pillars=[]
    for p in players:
        ng=norms_by_group[group_key(p)]
        raw_pillars.append({k:raw_pillar_score(p,PILLARS[k],ng) for k in pkeys})
    pillar_norms={k:mean_sd([rp[k] for rp in raw_pillars]) for k in pkeys}
    composites=[]
    for rp in raw_pillars:
        C=0.0; std={}
        for k in pkeys:
            std[k]=z(rp[k],pillar_norms[k]); C+=std[k]*weights[k]
        composites.append({"C":C,"std":std})
    comp_norm=mean_sd([c["C"] for c in composites])
    out=[]
    for i,p in enumerate(players):
        ng=norms_by_group[group_key(p)]
        C=z(composites[i]["C"],comp_norm)
        rel=reliability(p); size=size_nudge(p,ng)
        C=C*rel+size
        q=dict(p); q["grade"]=to_score(C)
        q["_debug"]={"compositeStd":C,"reliability":rel,"sizeNudge":size,"pillars":composites[i]["std"]}
        out.append(q)
    return out

# ============================================================ data adapter
def f(v):
    if v in (None,""): return None
    try: return float(v)
    except (TypeError,ValueError): return None
def ht_in(h):
    import re; m=re.match(r"^(\d)-(\d{1,2})$",str(h or "")); return int(m.group(1))*12+int(m.group(2)) if m else None
def pos_grp(pos):
    p=str(pos or "").upper().replace("/","-").split("-")[0]
    if p in ("PG","SG","G","CG"): return "G"
    if p in ("C","PF","FC"): return "B"
    return "W"

# conference-translation scale targets: volume/counting + advanced composites that
# inflate in weaker conferences (applied per-row before z-scoring)
_SCALE_STATS = ("ppg","ppg40","fta","fta40","ast","apg40","orb","stl","blk","drb","pprod","fga40",
                "wa","ws","ows","bpm","obpm","per")

def _build_row(b, min_mpg, min_g):
    pg=b.get("pergame") or {}; adv=b.get("advanced") or {}; p4=b.get("per40") or {}
    mpg=f(pg.get("mp_per_g")); games=f(pg.get("games"))
    if mpg is None or mpg<min_mpg or (games is not None and games<min_g): return None
    ws=f(adv.get("ws")); mp=f(adv.get("mp"))
    return {
        "bbref_id":b.get("bbref_id"),"school_slug":b.get("school_slug"),"season_year":b.get("season"),
        "name":b.get("player"),"team":b.get("school"),"pos":b.get("pos"),"_grp":pos_grp(b.get("pos")),
        "gamesPlayed":games,"mpg":mpg,"height":ht_in(b.get("height")),
        "ppg":f(pg.get("pts_per_g")),"fta":f(pg.get("fta_per_g")),"ppg40":f(p4.get("pts_per_min")),
        "obpm":f(adv.get("obpm")),"ows":f(adv.get("ows")),
        "tsPct":f(adv.get("ts_pct")),"tpPct":f(pg.get("fg3_pct")),"fgPct":f(pg.get("fg_pct")),"ftPct":f(pg.get("ft_pct")),
        "ast":f(pg.get("ast_per_g")),"astPct":f(adv.get("ast_pct")),"pprod":f(adv.get("pprod")),"orb":f(pg.get("orb_per_g")),
        "to":f(pg.get("tov_per_g")),"tovPct":f(adv.get("tov_pct")),
        "usgPct":f(adv.get("usg_pct")),"per":f(adv.get("per")),"apg40":f(p4.get("ast_per_min")),
        "wa": round(ws-0.04*((mp or 0)/40),3) if ws is not None else None,"ws":ws,"bpm":f(adv.get("bpm")),
        "glsT1":None,"glsT2":None,"glsT3":None,"glsT4":None,
        "stl":f(pg.get("stl_per_g")),"blk":f(pg.get("blk_per_g")),"drb":f(pg.get("drb_per_g")),"pf":f(pg.get("pf_per_g")),
        "fga40":f(p4.get("fga_per_min")),"fta40":f(p4.get("fta_per_min")),"pf40":f(p4.get("pf_per_min")),"to40":f(p4.get("tov_per_min")),
    }

def _postprocess(rows):
    """Per-game normalization, conference translation, heightVsPos — all within this pool."""
    # Season-total stats → per-game so short seasons (e.g. injury) aren't double-penalized
    # (reliability formula already handles sample uncertainty)
    for r in rows:
        g = r.get("gamesPlayed") or 1
        for k in ("pprod", "wa", "ws", "ows"):
            if r.get(k) is not None:
                r[k] = round(r[k] / g, 5)
    # Conference translation: scale volume stats to tier-1 equivalent before z-scoring
    try:
        import grade_conf as _gc
        for r in rows:
            tf = _gc.TIER_TO_T1.get(_gc.tier(r.get("team") or ""), 1.0)
            r["_conf_factor"] = tf
            if tf < 1.0:
                for k in _SCALE_STATS:
                    if r.get(k) is not None:
                        r[k] = round(r[k] * tf, 5)
    except ImportError:
        pass
    # heightVsPos = height - mean height of position group
    gm={}; gc={}
    for r in rows:
        if r["height"] is not None: gm[r["_grp"]]=gm.get(r["_grp"],0)+r["height"]; gc[r["_grp"]]=gc.get(r["_grp"],0)+1
    for k in gm: gm[k]/=gc[k]
    for r in rows: r["heightVsPos"]=(r["height"]-gm[r["_grp"]]) if (r["height"] is not None and r["_grp"] in gm) else None
    return rows

def load(season, min_mpg=8, min_g=5):
    rows=[]
    for line in (DATA/"bbref.jsonl").read_text().splitlines():
        if not line.strip(): continue
        try: b=json.loads(line)
        except Exception: continue
        if b.get("season")!=season: continue
        r=_build_row(b,min_mpg,min_g)
        if r is not None: rows.append(r)
    return _postprocess(rows)

def load_all(min_mpg=8, min_g=5):
    """Single pass over the jsonl, bucketed by season, each pool post-processed independently."""
    buckets={}
    for line in (DATA/"bbref.jsonl").read_text().splitlines():
        if not line.strip(): continue
        try: b=json.loads(line)
        except Exception: continue
        r=_build_row(b,min_mpg,min_g)
        if r is None: continue
        buckets.setdefault(b.get("season"),[]).append(r)
    return {s:_postprocess(rows) for s,rows in buckets.items() if s}

TARGET={'Chance Mallory':83,'Jurian Dixon':79,'Sam Lewis':82,'Thijs De Ridder':92,'Johann Grunloh':83,
        'Jan Vide':78,'Christian Harmon':77,'Kalu Anya':71,'Elijah Gertrude':70,'Martin Carrere':69,
        'Favour Ibe':70,'Silas Barksdale':68,'Carter Lang':66}

def summary(grades):
    xs=sorted(grades); n=len(xs); m=sum(xs)/n
    sd=math.sqrt(sum((x-m)**2 for x in xs)/n)
    pct=lambda q: xs[min(n-1,int(q*n))]
    return dict(n=n,mean=m,sd=sd,mn=xs[0],mx=xs[-1],p10=pct(.10),p25=pct(.25),p50=pct(.50),
                p75=pct(.75),p90=pct(.90),p99=pct(.99),p90p=sum(1 for x in xs if x>=90)/n*100,
                blo35=sum(1 for x in xs if x<35)/n*100)

def main():
    season=int(sys.argv[1]) if len(sys.argv)>1 else 2026
    rows=load(season)
    print(f"pool: {len(rows)} qualified in {season-1}-{str(season)[2:]} | mode={CONFIG['mode']} standardize={CONFIG['standardize']} k={CONFIG['logistic']['k']} center={CONFIG['logistic']['center']}")
    graded=grade_players(rows); by={p['name']:p for p in graded}
    print("\n=== VIRGINIA — engine vs your ranking ===")
    print(f"  {'PLAYER':20} {'ENG':>4} {'YOU':>4} {'GAP':>4}")
    gaps=[]
    for n,t in sorted(TARGET.items(),key=lambda x:-x[1]):
        p=by.get(n)
        if p: g=p['grade']-t; gaps.append(g); print(f"  {n:20} {p['grade']:>4} {t:>4} {g:>+4}")
        else: print(f"  {n:20} {'—':>4} {t:>4}   (no season)")
    if gaps:
        print(f"\n  matched {len(gaps)} | avg gap {sum(gaps)/len(gaps):+.1f} | MAE {sum(abs(x) for x in gaps)/len(gaps):.1f}")
    s=summary([p['grade'] for p in graded])
    print(f"\n=== DISTRIBUTION (n={s['n']}) ===")
    print(f"  mean {s['mean']:.1f} | median {s['p50']} | sd {s['sd']:.1f} | min {s['mn']} | max {s['mx']}")
    print(f"  p10={s['p10']} p25={s['p25']} p50={s['p50']} p75={s['p75']} p90={s['p90']} p99={s['p99']}")
    print(f"  share 90+: {s['p90p']:.1f}%  share<35: {s['blo35']:.1f}%")
    # top / bottom 12
    sd2=sorted(graded,key=lambda p:-p['grade'])
    print("\n  TOP 12:", ", ".join(f"{p['name']} {p['grade']}" for p in sd2[:12]))
    # k / center sweep
    print("\n=== k / center SWEEP ===\n   k  center | mean  p50  %90+  %<35  spread(p90-p10)")
    orig=dict(CONFIG["logistic"])
    for k in (1.2,1.6,2.0,2.4):
        for c in (0.0,0.3):
            CONFIG["logistic"]["k"]=k; CONFIG["logistic"]["center"]=c
            ss=summary([p['grade'] for p in grade_players(rows)])
            print(f"  {k:.1f}  {c:.1f}   | {ss['mean']:>4.1f}  {ss['p50']:>3}  {ss['p90p']:>4.1f}  {ss['blo35']:>4.1f}  {ss['p90']-ss['p10']:>3}")
    CONFIG["logistic"].update(orig)

if __name__=="__main__":
    main()
