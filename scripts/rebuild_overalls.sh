#!/usr/bin/env bash
# rebuild_overalls.sh — regenerate every statistical-overall + team-analytics data
# file from the CURRENT roster, in dependency order. Run this after a roster resync
# so the site's overalls and team analytics reflect the new rosters.
#
# All builds are READ-ONLY against Supabase (anon key) and only write local JSON/CSV
# under scripts/data — nothing is written to the database. Nothing goes live until
# you commit + push the changed files (see the reminder at the end).
#
#   ./rebuild_overalls.sh           regenerate the data files, then print next steps
#   ./rebuild_overalls.sh --push    also git add / commit / push the changed files
#
set -euo pipefail
cd "$(dirname "$0")"                     # scripts/

run () {                                 # run() "label" script.py
  echo ""
  echo "── $1 ────────────────────────────────────────────────"
  python3 "$2"
}

echo "Rebuilding statistical overalls + team analytics from the current roster…"

# 0) RESTORE espn_ids the resync dropped. A stats resync can rebuild `players`
#    without espn_id, and NO espn_id = NO overall (grades go blank). This matches
#    (name, team) → espn_id from player_history and needs the service key. Skips
#    cleanly (with a warning) if the key isn't available — but then any dropped
#    returner stays blank, so set SUPABASE_SERVICE_KEY before a real resync.
echo ""
echo "── Restore espn_ids dropped by the resync ────────────────────────────"
python3 backfill_espn_ids.py || echo "⚠  espn_id backfill skipped/failed (set SUPABASE_SERVICE_KEY to restore dropped IDs) — continuing"

# 1) Demonstrated player overall (reads player_advanced → stat_overall.json + history)
run "Demonstrated overall"        build_stat_overall.py
# 2) Projected 2026-27 player overall (reads the roster → stat_overall_projected.json)
run "Projected overall"           build_stat_overall_projected.py
# 3) Projected team DNA (reads the roster → team_dna.json '2027')  ── must precede team_eff
run "Projected team DNA"          build_projected_dna.py
# 4) Slim team efficiency for the rankings table (reads team_dna.json → team_eff.json)
run "Team efficiency (slim)"      build_team_eff.py
# 5) Projected team box line (reads the roster → team_projected_box.json)
run "Projected team box stats"    build_team_projected_box.py

DATA_FILES=(
  data/stat_overall.json
  data/stat_overall_projected.json
  data/stat_overall_history.json
  data/stat_overall_history.csv
  data/team_dna.json
  data/team_eff.json
  data/team_projected_box.json
)

echo ""
echo "════════════════════════════════════════════════════════════"
echo "Done. Regenerated data files:"
( cd .. && git -c color.ui=always status --short -- $(printf 'scripts/%s ' "${DATA_FILES[@]}") ) || true

if [ "${1:-}" = "--push" ]; then
  echo ""
  echo "Committing + pushing…"
  cd ..
  git add $(printf 'scripts/%s ' "${DATA_FILES[@]}")
  if git diff --cached --quiet; then
    echo "No changes to commit."
  else
    git commit -q -m "Rebuild statistical overalls + team analytics from current roster"
    git push origin "$(git rev-parse --abbrev-ref HEAD)"
    echo "Pushed. Vercel will deploy."
  fi
else
  echo ""
  echo "Nothing is live yet. To ship:"
  echo "  cd .. && git add scripts/data/stat_overall*.{json,csv} scripts/data/team_dna.json scripts/data/team_eff.json scripts/data/team_projected_box.json"
  echo "  git commit -m 'Rebuild overalls from current roster' && git push"
fi

echo ""
echo "NOTE: the RANKINGS table (predictive_ratings) is a separate cache — after the"
echo "push, republish it from the owner console (owner.html) so the new ranks show."
