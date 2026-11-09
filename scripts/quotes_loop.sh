#!/usr/bin/env bash
# One long-running job refreshes quotes every ~5 min while a market is open (GitHub's 5-min cron is unreliable).
# India: 03:45-10:05 UTC (09:15-15:35 IST); US: 13:30-21:05 UTC (covers both DST seasons). Mon-Fri.
# Outside market hours it refreshes once and exits. Stops before the job time limit; the next cron trigger continues.
set -uo pipefail
MAXSEC=${MAXSEC:-20700}   # 5h45m, under the 6h GitHub job limit
START=$(date +%s)
# minutes until the next market window opens (0 if open now)
towin() { local dow=$(date -u +%u) m=$((10#$(date -u +%H) * 60 + 10#$(date -u +%M)))
  [ "$dow" -gt 5 ] && { echo 9999; return; }
  if [ $m -lt 225 ]; then echo $((225 - m)); elif [ $m -lt 605 ]; then echo 0; elif [ $m -lt 810 ]; then echo $((810 - m)); elif [ $m -lt 1265 ]; then echo 0; else echo 9999; fi; }
WAITMAX=${WAITMAX:-270}  # GitHub often starts scheduled runs late or drops them: an early run waits for the open instead of exiting
# (was 150: on 9 Nov 2026 the 06:28 IST run was 167 min before the open, exited, and every later cron was dropped -> no quotes all session)
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
  if ! inwin; then w=$(towin)
    if [ "$w" -le "$WAITMAX" ] && [ $(( $(date +%s) + w * 60 + 600 - START )) -lt "$MAXSEC" ]; then echo "market opens in ${w} min - waiting"; sleep $((w * 60 + 30)); continue; fi
    echo 'market closed - done'; break; fi
  next=$((t0 + 300)); if [ $((next + 120 - START)) -gt "$MAXSEC" ]; then echo 'time limit reached - starting a follow-on run'
    gh workflow run quotes.yml --ref main || echo 'self-dispatch failed (cron backups continue)'; break; fi
  s=$((next - $(date +%s))); [ $s -gt 0 ] && sleep $s
done
