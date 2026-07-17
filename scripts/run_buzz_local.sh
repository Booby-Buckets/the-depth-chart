#!/usr/bin/env bash
# Local one-command runner for the Reddit Buzz fetcher.
# Reads credentials from scripts/.env.buzz (gitignored) so no secrets on the
# command line. Usage:
#   ./scripts/run_buzz_local.sh            # top 50 (grade>=80) — quick quality check
#   ./scripts/run_buzz_local.sh 80 500     # min_grade  limit   — full run
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HERE/.env.buzz"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  echo "  cp scripts/.env.buzz.example scripts/.env.buzz   then paste your Reddit client_id/secret."
  exit 1
fi

set -a; source "$ENV_FILE"; set +a

if [[ -z "${REDDIT_CLIENT_ID:-}" || "${REDDIT_CLIENT_ID}" == paste_* ]]; then
  echo "REDDIT_CLIENT_ID not set in $ENV_FILE — fill in your real app credentials."
  exit 1
fi

MIN_GRADE="${1:-80}"
LIMIT="${2:-50}"
echo "Fetching Reddit buzz (grade>=$MIN_GRADE, up to $LIMIT players)…"
python3 "$HERE/build_player_buzz.py" "$MIN_GRADE" "$LIMIT"
echo
echo "Wrote scripts/data/player_buzz.json — open a top player's Buzz tab to eyeball quality."
echo "Happy with it?  git add scripts/data/player_buzz.json && git commit && git push"
