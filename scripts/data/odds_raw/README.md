# Historical betting lines — drop folder (Betting Lab, Phase B)

Drop one or more CSV files here (one per season, or a combined file). Then run:

```bash
python3 scripts/build_odds_history.py
```

It matches each line to our own game results (`games.jsonl`) by date + team name,
computes real ATS / O-U records + model-vs-market edge, and merges them into
`bet_trends_teams.json`. The Betting Lab page then reveals the **ATS%** and **O/U**
columns automatically. No line file = the page just keeps the model-only trends.

## Required CSV columns

```
date,home,away,spread,total,ml_home,ml_away
```

| column     | meaning                                                        |
|------------|---------------------------------------------------------------|
| `date`     | game date, `YYYY-MM-DD`                                        |
| `home`     | home team name (any reasonable form — matched fuzzily)         |
| `away`     | away team name                                                 |
| `spread`   | **home** closing spread — negative = home favored (e.g. `-6.5`)|
| `total`    | closing game total (points)                                   |
| `ml_home`  | home American moneyline (optional)                            |
| `ml_away`  | away American moneyline (optional)                            |

Rows that don't match a final game are reported and skipped, so a few name
mismatches are harmless (the script prints the match rate).

## Option A — pull straight from the-odds-api historical (recommended)

No CSV needed. The build script fetches historical closing lines directly.

1. Get a plan with **historical access** at the-odds-api.com and copy your key.
2. Export it (never commit it):
   ```bash
   export ODDS_API_KEY=your_key_here
   ```
3. Estimate credits first (no API calls):
   ```bash
   python3 scripts/build_odds_history.py --api --dry-run --markets spreads,totals
   ```
4. Run for real (one season at a time keeps credit use in check):
   ```bash
   python3 scripts/build_odds_history.py --api --season 2024 --markets spreads,totals
   ```

How it works: it snapshots only days that had games (from `games.jsonl`), at two
UTC times/day (~11:30am & ~6:30pm ET), and keeps each game's **latest pre-tip** line —
median across books. Then it matches to our results and merges ATS/O-U into the trends.

**Credit cost** (historical = 10 × markets × regions per call):
- 1 season, `spreads,totals` (2 markets): ~6,000 credits
- all 5 seasons, `spreads,totals`: ~29,000 credits
- add `h2h` (moneyline) → 3 markets → +50%

Rough plan fit: ~$30 Starter (20K/mo) does ~3 seasons/month; ~$59 tier (100K/mo) does
all 5 at once. Add `--snaps 16:30,20:00,23:30` for tighter closing lines (more credits).

## Option B — drop a CSV (Kaggle / purchased export)

Reshape any source to the columns above and drop it here, then run
`python3 scripts/build_odds_history.py` (no `--api`).

CSV files in this folder are **git-ignored** (large / licensed); only this README is tracked.
