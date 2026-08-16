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

## Where to get the data

- **the-odds-api historical** (paid tier, NCAAB back to ~late 2020) — clean, reliable.
- A **Kaggle export** or purchased dump — reshape to the columns above.
- The build script can also call the-odds-api historical directly later via an
  `ODDS_API_KEY` (Phase C) instead of files.

CSV files in this folder are **git-ignored** (they can be large / licensed); only this
README is tracked.
