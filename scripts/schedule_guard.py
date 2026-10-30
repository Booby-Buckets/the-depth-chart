"""Nightly schedule refresh safety check (.github/workflows/schedule-refresh.yml).

Compares the freshly built scripts/data/schedule_2027.json with the committed one (git HEAD) and exits 1 when
the new file looks like a failed pull rather than real schedule news, so the job commits nothing:
  - fewer than 97% of the games, or
  - more than 12 D-I teams each lost 2+ games.
Real changes (a cancellation, a moved date, new tip times) are far smaller than either.
Prints a short summary of what changed either way.
"""
import json, subprocess, sys
from collections import Counter
from pathlib import Path

PATH = "scripts/data/schedule_2027.json"


def counts(d):
    T = d["teams"]; c = Counter()
    for g in d["games"]:
        c[T[g[2]]] += 1; c[T[g[3]]] += 1
    return c


def main():
    new = json.load(open(Path(__file__).resolve().parent.parent / PATH))
    try:
        old = json.loads(subprocess.check_output(["git", "show", f"HEAD:{PATH}"]))
    except Exception:
        print("no committed schedule to compare against — accepting"); return
    n0, n1 = len(old["games"]), len(new["games"])
    c0, c1 = counts(old), counts(new)
    lost = sorted(((t, c0[t] - c1.get(t, 0)) for t in c0 if c0[t] >= 20 and c0[t] - c1.get(t, 0) >= 2), key=lambda x: -x[1])
    timed0 = sum(1 for g in old["games"] if len(g) > 6 and g[6]); timed1 = sum(1 for g in new["games"] if len(g) > 6 and g[6])
    tv1 = sum(1 for g in new["games"] if len(g) > 7 and g[7])
    print(f"games {n0} → {n1} · with tip time {timed0} → {timed1} · with TV {tv1}")
    if lost: print("teams down 2+ games:", ", ".join(f"{t} −{k}" for t, k in lost[:15]))
    bad = []
    if n1 < 0.97 * n0: bad.append(f"only {n1}/{n0} games")
    if len(lost) > 12: bad.append(f"{len(lost)} teams lost 2+ games")
    if bad:
        print("::error::schedule refresh looks broken (" + "; ".join(bad) + ") — keeping the committed schedule")
        sys.exit(1)


if __name__ == "__main__":
    main()
