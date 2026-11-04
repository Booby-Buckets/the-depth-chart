#!/bin/sh
# Vercel "Ignored Build Step". Exit 0 = skip this deploy, anything else = deploy (so a failure here deploys).
# Data files are served by GitHub Pages (see "redirects" in vercel.json), which rebuilds on every push by itself, so data
# reaches the site without a Vercel deploy. Vercel only needs a billed deploy when the pages or API code changed.

# Vercel clones the last 10 commits. Compare against the last deploy if that's in the clone, else the oldest commit we have.
base="$VERCEL_GIT_PREVIOUS_SHA"
if [ -z "$base" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  base=$(git rev-list HEAD 2>/dev/null | tail -1)
fi
[ -n "$base" ] || { echo "Nothing to compare: deploy."; exit 1; }

changed=$(git diff --name-only "$base" HEAD 2>/dev/null) || { echo "Compare failed: deploy."; exit 1; }
site=$(printf '%s\n' "$changed" | grep -vE '^(scripts/data/|nba/|data/|nil-data\.json$|docs/|exports/|supabase/|\.github/|_mockups/)|^scripts/.*\.(py|sql|gs|sh|md)$' | grep -v '^$')

if [ -z "$site" ]; then echo "Only data or tooling changed: skipping."; exit 0; fi
echo "Site files changed: deploy."; printf '%s\n' "$site" | head -5
exit 1
