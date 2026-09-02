# Odds Feed — Setup & Runbook

Everything needed to turn on real sportsbook data for the **Betting Lab**. There are
two one-time things you do (subscribe + backfill history) and one switch you flip
(add a repo secret) that makes live in-season odds flow on their own.

The provider is **the-odds-api** (v4, `basketball_ncaab`). Your API key is private —
it goes in an env var / repo secret and is **never committed**. Claude cannot do the
subscription or run the paid calls (they spend your money on your account); these
steps are yours. Everything on the code side is already built.

---

## TL;DR

1. **Subscribe** at the-odds-api.com → copy your key.
2. **Backfill 5 years of history** (one-time, ~$59 tier for a month):
   ```bash
   export ODDS_API_KEY=your_key_here
   python3 scripts/build_odds_history.py --api --seasons 2022,2023,2024,2025,2026 --markets spreads,totals,h2h --dry-run   # check cost
   python3 scripts/build_odds_history.py --api --seasons 2022,2023,2024,2025,2026 --markets spreads,totals,h2h            # run for real
   git add scripts/data/bet_trends_teams.json && git commit -m "Betting: backfill 5yr real closing lines" && git push
   ```
3. **Turn on live in-season odds**: add a repo secret named `ODDS_API_KEY`
   (GitHub → repo **Settings → Secrets and variables → Actions → New repository
   secret**). Done — the daily action archives the board and the Live Edge Board
   lights up in-season.

The rest of this doc is the detail behind each step.

---

## Step 1 — Subscribe to the-odds-api

1. Go to **https://the-odds-api.com**, create an account, and choose a plan **with
   historical access** (the free tier does NOT include history).
2. Copy your API key from the dashboard.

**Credit math (measured from a real dry-run):**

| Backfill | Credits |
|---|---|
| 1 season (spreads + totals) | ~5,900 |
| All 5 seasons (spreads + totals) | ~29,000 |
| All 5 seasons (+ moneyline `h2h`) | ~44,000 |

Their tiers are roughly **$30/mo = 20K credits** and **$59/mo = 100K credits**
(confirm current pricing on their site).

**Recommended:** buy the **$59 / 100K tier for a single month**, run all 5 seasons of
`spreads,totals,h2h` at once (~44K, comfortably under 100K), commit the data, then
**downgrade or cancel**. The historical pull is a one-time cost. Live in-season odds
(Step 3) use the cheap regular endpoint — a few credits a day — so a small plan (even
the free 500/mo tier can cover a light schedule) is plenty once history is loaded.

If you use the **$30 / 20K** tier instead, split the backfill across two billing
cycles: `--seasons 2024,2025,2026` (~18K) one month, `--seasons 2022,2023` the next.

---

## Step 2 — Backfill historical lines (Phase B, one-time)

This fills the **ATS% / O-U** columns already stubbed in the Team Trends table and
gives the model a real-line backtest to measure against.

From the repo root:

```bash
export ODDS_API_KEY=your_key_here      # no quotes needed; this stays in your shell only
```

**Always dry-run first** — it prints the exact credit cost and makes zero API calls:

```bash
python3 scripts/build_odds_history.py --api --seasons 2022,2023,2024,2025,2026 --markets spreads,totals,h2h --dry-run
```

Then run for real (drop `--dry-run`):

```bash
python3 scripts/build_odds_history.py --api --seasons 2022,2023,2024,2025,2026 --markets spreads,totals,h2h
```

The script snapshots each game-day twice (a day-line + a near-tip line), keeps each
game's latest pre-tip median-across-books number, matches it to our own results in
`games.jsonl` (±1 day tolerant), and merges a `history` block into
`scripts/data/bet_trends_teams.json`. It sets `meta.hasHistory = true`.

Commit the result — this is what reveals the real-line columns on the site:

```bash
git add scripts/data/bet_trends_teams.json
git commit -m "Betting: backfill 5yr real closing lines (ATS/O-U)"
git push
```

Vercel redeploys and the **ATS% / O-U** columns appear in the Betting Lab.

---

## Step 3 — Turn on live in-season odds (Phase C)

This is the switch that makes today's board flow automatically all season.

### 3a. Add the repo secret (the only required action)

GitHub → your repo → **Settings → Secrets and variables → Actions → New repository
secret**:

- **Name:** `ODDS_API_KEY`
- **Value:** your the-odds-api key

That's it. The workflow `.github/workflows/archive-odds.yml` is already committed and
runs on a schedule. Until the secret exists it **no-ops safely**, so nothing breaks in
the meantime.

### 3b. What it does

Twice a day (~11:00 ET for opening lines, ~18:30 ET for near-tip closing lines) the
action runs `scripts/archive_live_odds.py`, which:

- pulls the current NCAAB board (main markets, US region — the **cheap** endpoint:
  ~3 credits per snapshot, ~180 credits/month),
- takes a consensus (median-across-books) spread / total / moneyline per game,
- **overwrites** `scripts/data/odds_live.json` — the feed the site's **Live Edge
  Board** reads (our model line vs the book number, biggest gaps first),
- **appends** to `scripts/data/odds_archive.jsonl` — our own growing open→close
  archive (nobody sells years of this cheaply, so we own it by capturing it daily),
- commits both, which triggers a deploy so the board refreshes on its own.

Off-season the board comes back empty; the script writes an empty live file, appends
nothing, and exits cleanly — so it's safe to leave scheduled year-round.

### 3c. Test it immediately (optional)

You don't have to wait for the schedule:

- **From the terminal:**
  ```bash
  export ODDS_API_KEY=your_key_here
  python3 scripts/archive_live_odds.py --dry-run     # fetches the board, prints it, writes nothing
  python3 scripts/archive_live_odds.py               # writes odds_live.json + appends archive
  ```
- **From GitHub:** Actions tab → **Archive live odds** → **Run workflow**
  (`workflow_dispatch`). During the off-season the board is empty (that's expected);
  in-season it will populate and commit.

---

## What lights up on the site

- **Team Trends** → real **ATS% / O-U** columns (after Step 2).
- **Live Edge Board** (new section on `betting.html`) → in-season only; ranks games by
  how far our model line sits from the market, with a side + O/U lean (after Step 3, once
  there are games).
- Next builds once data exists (Claude can do these): **Closing Line Value** in the
  Model Line card, a full **Best Bets** ranking, and **real prop-line edge** on the
  player/team Betting tabs.

---

## Costs at a glance

| Item | When | Cost |
|---|---|---|
| Historical backfill (5 yr) | one-time | ~29K–44K credits (~one month of the $59 tier) |
| Live in-season archive | daily, in-season | ~180 credits/month (cheap/free-tier friendly) |

## Troubleshooting

- **`ERROR: ODDS_API_KEY not set`** — run `export ODDS_API_KEY=...` in the same shell
  first, or (for a plumbing check) add `--dry-run`.
- **HTTP 401 / 422 on the historical run** — the key is wrong or the plan has no
  historical access; the script stops rather than burning credits.
- **Columns still hidden after backfill** — confirm the commit landed and
  `bet_trends_teams.json` has `meta.hasHistory: true`; hard-refresh (the service
  worker caches).
- **Action commits nothing in-season** — that's normal off-season or on a no-game day
  (empty board). Check the run log under the Actions tab.
- **Never commit your key.** It only ever lives in your shell env or the repo secret.
