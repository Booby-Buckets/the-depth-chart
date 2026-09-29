#!/usr/bin/env python3
"""build_logo_colors.py — every team's colours pulled from its LOGO (owner rule, Sept 2026).

ESPN's listed team colours are sometimes off-brand or missing (ECU/FAU synced as grey), so the two
colours the site uses per team now come from the logo image itself:
  c1 = the logo's dominant brand colour (most-used chromatic colour; black only when the logo has
       no real colour), c2 = the next clearly different colour in the logo (white if none).
White background, transparency and thin grey anti-aliasing are ignored.

Writes (local files only, no DB access):
  scripts/data/team_colors.json   c1/c2 replaced by the logo colours; ESPN's kept as espn_c1/espn_c2
  team-colors.js                  the TDC_TEAM_COLORS lookup patched to the same c1/c2 (resolver code untouched)
Run: python3 scripts/build_logo_colors.py   (logos cached in /tmp/tdc_logos)
"""
import colorsys, io, json, os, re, sys, urllib.request
from collections import Counter
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TC = os.path.join(ROOT, "scripts", "data", "team_colors.json")
JS = os.path.join(ROOT, "team-colors.js")
CACHE = "/tmp/tdc_logos"

def fetch(url):
    os.makedirs(CACHE, exist_ok=True)
    fn = os.path.join(CACHE, re.sub(r"[^0-9a-z.]", "_", url.split("/")[-1].lower()))
    if not os.path.exists(fn):
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r:
            open(fn, "wb").write(r.read())
    return Image.open(fn).convert("RGBA")

def hexc(rgb): return "#%02x%02x%02x" % tuple(int(round(v)) for v in rgb)
def dist(a, b): return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5
def hls(rgb): return colorsys.rgb_to_hls(*(v / 255.0 for v in rgb))

def logo_colors(img):
    img = img.resize((120, 120), Image.BOX)
    px = [p[:3] for p in img.getdata() if p[3] >= 250]
    if not px: return None, None
    bins = Counter((r // 16, g // 16, b // 16) for r, g, b in px)
    # merge neighbouring bins into colour clusters (largest first)
    clusters = []   # [count, sumR, sumG, sumB]
    for (br, bg, bb), n in bins.most_common():
        c = (br * 16 + 8, bg * 16 + 8, bb * 16 + 8)
        for cl in clusters:
            if dist(c, (cl[1] / cl[0], cl[2] / cl[0], cl[3] / cl[0])) < 56:
                cl[0] += n; cl[1] += c[0] * n; cl[2] += c[1] * n; cl[3] += c[2] * n; break
        else:
            clusters.append([n, c[0] * n, c[1] * n, c[2] * n])
    tot = sum(cl[0] for cl in clusters)
    cols = []
    for n, r, g, b in sorted(clusters, key=lambda x: -x[0]):
        rgb = (r / n, g / n, b / n); h, l, s = hls(rgb)
        # a dark navy/green is a real brand colour, only a near-neutral dark is "black"
        kind = "white" if l > 0.88 and s < 0.35 else "black" if (l < 0.09 or (l < 0.18 and s < 0.22)) else "grey" if s < 0.14 else "color"
        cols.append({"rgb": rgb, "share": n / tot, "kind": kind})
    chroma = [c for c in cols if c["kind"] == "color" and c["share"] >= 0.04]
    darks = [c for c in cols if c["kind"] in ("black", "grey") and c["share"] >= 0.06]
    c1 = chroma[0] if chroma else (darks[0] if darks else cols[0])
    # c2: the biggest remaining area that clearly differs from c1 (anti-aliased edge blends are
    # small and sit between the two, so they lose to the real second colour); grey only as a last resort
    # A clearly different HUE (ECU's gold beside its purple, Tulane's light blue beside its green)
    # beats a black outline even when the outline covers more of the logo.
    h1 = hls(c1["rgb"])[0]
    accent = [c for c in cols if c is not c1 and c["kind"] == "color" and c["share"] >= 0.03
              and hls(c["rgb"])[2] >= 0.3 and min(abs(hls(c["rgb"])[0] - h1), 1 - abs(hls(c["rgb"])[0] - h1)) >= 30 / 360]
    rest = [c for c in cols if c is not c1 and c["share"] >= 0.05 and dist(c["rgb"], c1["rgb"]) >= 80]
    pref = accent or [c for c in rest if c["kind"] in ("color", "black")] or rest
    c2 = pref[0] if pref else {"rgb": (255, 255, 255)}
    return hexc(c1["rgb"]), hexc(c2["rgb"])

def main():
    teams = json.load(open(TC))
    by_logo, done = {}, 0
    for t in teams:
        if not t.get("logo"): continue
        try:
            c1, c2 = logo_colors(fetch(t["logo"]))
        except Exception as e:
            print("  skip", t.get("display"), e, file=sys.stderr); continue
        if not c1: continue
        t.setdefault("espn_c1", t.get("c1")); t.setdefault("espn_c2", t.get("c2"))
        t["c1"], t["c2"] = c1, c2
        by_logo[t["logo"]] = (c1, c2); done += 1
    json.dump(teams, open(TC, "w"), indent=1)
    # patch the lookup in team-colors.js — every key that shares a logo gets that logo's colours
    js = open(JS).read()
    m = re.search(r"window\.TDC_TEAM_COLORS=(\{.*?\});\n", js, re.S)
    M = json.loads(m.group(1))
    for v in M.values():
        if v.get("logo") in by_logo: v["c1"], v["c2"] = by_logo[v["logo"]]
    js = js[:m.start(1)] + json.dumps(M, separators=(",", ":")) + js[m.end(1):]
    js = js.replace("ESPN team brand colors keyed by normalized name", "team colours pulled from each logo (build_logo_colors.py) keyed by normalized name", 1)
    open(JS, "w").write(js)
    print(f"logo colours for {done} teams; team-colors.js patched ({len(M)} keys)")

if __name__ == "__main__":
    main()
