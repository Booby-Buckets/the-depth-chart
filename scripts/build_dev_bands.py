"""Development bands for Roster Development (roster-dev.html, "development cone", Oct 2026).

For every starting overall g (50-99) this records the distribution of next-season overall
changes for D-I players who started within 2 points of g, from scripts/data/stat_overall_history.json
(season -> espn_id -> overall; consecutive seasons by the same espn_id). Stored as 21 quantiles
(0th, 5th ... 100th percentile) so the page can draw the cone (25-75 dark, 10-90 light) and turn
any change into a growth percentile. Re-run after stat_overall_history.json is rebuilt.

    python3 scripts/build_dev_bands.py
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'data', 'stat_overall_history.json')
OUT = os.path.join(HERE, 'data', 'dev_bands.json')

def main():
    H = json.load(open(SRC))
    ys = sorted(H)
    ch = {}
    pairs = 0
    for a, b in zip(ys, ys[1:]):
        if int(b) != int(a) + 1:
            continue
        for e, g in H[a].items():
            if e in H[b]:
                ch.setdefault(int(round(g)), []).append(H[b][e] - g)
                pairs += 1
    bands = {}
    for g in range(50, 100):
        v = []
        for k in range(g - 2, g + 3):
            v += ch.get(k, [])
        if len(v) < 40:
            continue
        v.sort()
        q = [round(v[min(len(v) - 1, int(p / 100 * (len(v) - 1) + 0.5))], 1) for p in range(0, 101, 5)]
        bands[str(g)] = {'n': len(v), 'q': q}
    json.dump({'meta': {'source': 'stat_overall_history.json', 'seasons': [ys[0], ys[-1]], 'pairs': pairs,
                        'window': 2, 'quantiles': 'every 5th percentile, 0-100'},
               'bands': bands}, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT, len(bands), 'starting overalls,', pairs, 'season pairs')

if __name__ == '__main__':
    main()
