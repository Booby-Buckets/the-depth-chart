#!/usr/bin/env bash
# Scrape and load seasons 2012-2021 (2011-12 through 2020-21) into Supabase.
#
# Usage:
#   bash scripts/backfill_historical.sh            # full run
#   bash scripts/backfill_historical.sh --resume   # resume interrupted scrape
#
# The scraper saves one JSON file per season to scripts/data/players_YYYY.json.
# If a season file already exists and --resume is passed, completed teams are
# skipped so you can restart without re-scraping finished work.
#
# Total time estimate: ~2 hrs (362 teams × 10 seasons × 2 s/request)

set -euo pipefail
cd "$(dirname "$0")/.."

SEASONS="2012 2013 2014 2015 2016 2017 2018 2019 2020 2021"
RESUME_FLAG=""
if [[ "${1:-}" == "--resume" ]]; then
  RESUME_FLAG="--resume"
  echo "Resume mode — completed teams within each season will be skipped."
fi

echo "========================================"
echo "  Scraping seasons: $SEASONS"
echo "  Output: scripts/data/players_YYYY.json"
echo "========================================"
python3 scripts/scraper.py --seasons $SEASONS $RESUME_FLAG

echo ""
echo "========================================"
echo "  Uploading to Supabase"
echo "========================================"
python3 scripts/load_supabase.py --players --seasons $SEASONS

echo ""
echo "======================================== Done."
