#!/bin/sh
# Vercel "Ignored Build Step". Exit 0 = skip this deploy, anything else = deploy (so a failure here deploys).
# Every deploy re-uploads the whole site (~440 MB) and is billed for build minutes and storage, and the data jobs commit
# all day. People's commits always deploy; "Auto:" commits wait until enough time has passed since the last deploy.
# Skipped data is not lost: the next deploy carries it, and the data jobs commit often enough that one comes along.
msg="${VERCEL_GIT_COMMIT_MESSAGE:-$(git log -1 --format=%s 2>/dev/null)}"
case "$msg" in
  Auto:*) ;;
  *) echo "Not an automated commit: deploy."; exit 1 ;;
esac

prev="$VERCEL_GIT_PREVIOUS_SHA"
[ -n "$prev" ] || { echo "No previous deploy known: deploy."; exit 1; }
# Vercel clones shallow (10 commits). Last deploy not in the clone = 10+ commits are waiting: deploy.
git cat-file -e "$prev^{commit}" 2>/dev/null || { echo "Last deploy is 10+ commits back: deploy."; exit 1; }
last=$(git log -1 --format=%ct "$prev" 2>/dev/null)
[ -n "$last" ] || exit 1

# Things people see (results, box scores, rankings, schedules): 30 minutes. Logs and snapshots: 3 hours.
gap=10800
if git log --format=%s "$prev..HEAD" 2>/dev/null | grep -qE 'game results|scrimmage box scores|rebuild projected|schedule refresh'; then gap=1800; fi

age=$(( $(date +%s) - last ))
if [ "$age" -ge "$gap" ]; then echo "Last deploy ${age}s ago (limit ${gap}s): deploy."; exit 1; fi
echo "Last deploy ${age}s ago (limit ${gap}s): skipping."
exit 0
