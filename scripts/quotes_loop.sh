#!/usr/bin/env bash
# One long-running job refreshes quotes every ~5 min while a market is open (GitHub's 5-min cron is unreliable).
# India: 03:45-10:05 UTC (09:15-15:35 IST); US: 13:30-21:05 UTC (covers both DST seasons). Mon-Fri.
# Outside market hours it refreshes once and exits. Stops before the job time limit; the next cron trigger continues.
set -uo pipefail
MAXSEC=${MAXSEC:-20700}   # 5h45m, under the 6h GitHub job limit
START=$(date +%s)
inwin() { local dow=$(date -u +%u) m=$((10#$(date -u +%H) * 60 + 10#$(date -u +%M)))
  [ "$dow" -le 5 ] && { { [ $m -ge 225 ] && [ $m -lt 605 ]; } || { [ $m -ge 810 ] && [ $m -lt 1265 ]; }; }; }
once() {
  (cd pub && git fetch -q --depth 1 origin data && git reset -q --hard FETCH_HEAD) && rm -rf data && cp -r pub/data ./data || return 1
  python3 scripts/build_quotes.py || return 1
  python3 scripts/crosscheck.py || echo 'cross-check skipped'
  bash .github/workflows/publish.sh quotes || return 1
  if [ -d al ]; then (cd al && git fetch -q --depth 1 origin alerts && git reset -q --hard FETCH_HEAD) || true; else git clone -q --depth 1 --branch alerts "$REPO_URL" al || true; fi
  [ -d al ] && { python3 scripts/alerts.py check || echo 'alert check failed'; }
  return 0
}
n=0
while :; do
  t0=$(date +%s); n=$((n + 1)); echo "== refresh $n at $(date -u +%FT%TZ)"
  once || echo "refresh $n failed (will retry next cycle)"
  inwin || { echo 'market closed - done'; break; }
  next=$((t0 + 300)); [ $((next + 120 - START)) -gt "$MAXSEC" ] && { echo 'time limit reached - next trigger continues'; break; }
  s=$((next - $(date +%s))); [ $s -gt 0 ] && sleep $s
done
