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
# Safety net for dropped crons (10 Nov 2026: GitHub dropped the 19:00, 20:30 and 22:00 IST full refreshes and the 20:30
# exchange-data run): on weekdays (IST) start a full refresh / exchange-data run when the last one is too old and none is
# queued or running. Full refresh: > 30 h old (Monday: > 60 h, as none runs at weekends); exchange data: > 30 h.
# Checked on the first refresh of each run and then about once an hour. Never fails the loop.
watchdog() {
  local dow now full corp lim
  dow=$(TZ=Asia/Kolkata date +%u); [ "$dow" -gt 5 ] && return 0
  now=$(date +%s)
  full=$(python3 -c "import json;print(int(json.load(open('pub/data/meta.json')).get('full',0)))" 2>/dev/null || echo 0)
  corp=$(python3 -c "import json;print(int(json.load(open('pub/data/corp/coverage.json')).get('built',0)))" 2>/dev/null || echo 0)
  for wf in data.yml corp.yml; do
    if [ "$wf" = data.yml ]; then t=$full; lim=$([ "$dow" = 1 ] && echo 216000 || echo 108000); else t=$corp; lim=43200; fi   # exchange data: 12 h (evening results filings; GitHub often drops the 20:30 / 23:45 IST runs)
    { [ "$t" -gt 0 ] && [ $((now - t)) -gt "$lim" ]; } || continue
    busy=$(gh run list --workflow "$wf" --limit 5 --json status --jq '[.[] | select(.status != "completed")] | length' 2>/dev/null || echo 1)
    [ "$busy" = 0 ] || { echo "watchdog: $wf is $(( (now - t) / 3600 )) h old but a run is already queued"; continue; }
    echo "watchdog: $wf last ran $(( (now - t) / 3600 )) h ago - starting it"
    gh workflow run "$wf" --ref main || echo "watchdog: could not start $wf"
  done
  return 0
}
n=0
while :; do
  t0=$(date +%s); n=$((n + 1)); echo "== refresh $n at $(date -u +%FT%TZ)"
  once || echo "refresh $n failed (will retry next cycle)"
  [ $(( (n - 1) % 12 )) -eq 0 ] && { watchdog || true; }
  if ! inwin; then w=$(towin)
    if [ "$w" -le "$WAITMAX" ] && [ $(( $(date +%s) + w * 60 + 600 - START )) -lt "$MAXSEC" ]; then echo "market opens in ${w} min - waiting"; sleep $((w * 60 + 30)); continue; fi
    echo 'market closed - done'; break; fi
  next=$((t0 + 300)); if [ $((next + 120 - START)) -gt "$MAXSEC" ]; then echo 'time limit reached - starting a follow-on run'
    gh workflow run quotes.yml --ref main || echo 'self-dispatch failed (cron backups continue)'; break; fi
  s=$((next - $(date +%s))); [ $s -gt 0 ] && sleep $s
done
