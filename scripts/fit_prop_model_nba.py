#!/usr/bin/env python3
"""
fit_prop_model_nba.py — the TDC Bet prop model (scripts/fit_prop_model.py) refit on NBA game logs.

Same recipe as college: per-minute rate (season so far, shrunk toward last season) x minutes, then
negative binomial (REB/AST/3PM) or normal with sd = k*sqrt(mean) + c*mean (PTS/PRA). Fit on 2024-25, tested on
2025-26 regular seasons from scripts/data/nba_box.jsonl (our ESPN scrape). Writes scripts/data/prop_model_nba.json.
"""
import json, os, datetime
import fit_prop_model as F

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")


def rows_for(season):
    out = []
    with open(os.path.join(DATA, "nba_box.jsonl")) as f:
        for line in f:
            r = json.loads(line)
            if r.get("season") != season or r.get("season_type") != "regular" or r.get("dnp") or r.get("min") is None:
                continue
            out.append({"espn_id": r["espn_id"], "date": r["date"], "game_id": r["game_id"], "min": r["min"],
                        "pts": r.get("pts") or 0, "reb": r.get("reb") or 0, "ast": r.get("ast") or 0, "tpm": r.get("fg3m") or 0})
    return out


def main():
    a, b = 2025, 2026
    by_a, by_b = F.player_games(rows_for(a)), F.player_games(rows_for(b))
    prior = F.season_rates(by_a)
    best = None
    for k in (150, 300, 600, 1000):
        ex = F.examples(by_b, prior, k, 6)
        e = [x for x in ex if x[0] == "pts"]
        mse = sum((mu - y) ** 2 for (_, mu, y, r, sd) in e) / len(e)
        print("k_prior %d: pts mse %.2f" % (k, mse))
        if best is None or mse < best[1]:
            best = (k, mse)
    k = best[0]
    ex = F.examples(by_b, prior, k, 6)
    out = {"built": datetime.date.today().isoformat(), "league": "nba", "fit_season": a, "test_season": b, "stats": {}}
    for s in F.STATS:
        e = [x for x in ex if x[0] == s]
        fit_part, test_part = e[::2], e[1::2]
        prm = F.fit_normal(fit_part, s) if s in F.NORMAL_STATS else {"alpha": F.fit_alpha(fit_part)}
        ev = F.evaluate(test_part, prm, s)
        out["stats"][s] = dict(prm, dist="normal" if s in F.NORMAL_STATS else "nb", k_prior=k, min_k=6, **ev)
        print("%s: %s · brier %.4f · n %d" % (s, prm, ev["brier"], ev["n"]))
        print("   calibration:", " ".join("%.2f→%.2f" % (c[0], c[1]) for c in ev["calib"]))
    json.dump(out, open(os.path.join(DATA, "prop_model_nba.json"), "w"), indent=1)
    print("wrote scripts/data/prop_model_nba.json")


if __name__ == "__main__":
    main()
