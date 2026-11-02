#!/usr/bin/env bash
# Publish ./data to the single-commit 'data' branch. Amend + force-with-lease => only changed files upload,
# no history growth, and a concurrent run can never be silently overwritten (we re-base onto it and retry).
# Usage: publish.sh all            (full refresh: replace every file)
#        publish.sh quotes         (quotes job: overlay only quotes.json + merge meta.json)
set -euo pipefail
MODE=${1:-all}
cd pub
G() { git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" "$@"; }
overlay() {
  if [ "$MODE" = all ]; then rm -rf data && cp -r ../data ./data
  else mkdir -p data && cp ../data/quotes.json data/quotes.json
    python3 - <<'PY'
import json, os
a = json.load(open('data/meta.json')) if os.path.exists('data/meta.json') else {}
b = json.load(open('../data/meta.json'))
a.update({k: b[k] for k in ('quotes', 'nQuotes') if k in b}); json.dump(a, open('data/meta.json', 'w'))
PY
  fi
}
for attempt in 1 2 3 4; do
  BASE=$(git rev-parse -q --verify HEAD || echo "")
  overlay; git add -A data
  if [ -n "$BASE" ] && git diff --cached --quiet; then echo "no changes"; exit 0; fi
  if [ -n "$BASE" ]; then G commit -q --amend -m "Data snapshot $(date -u +%FT%TZ)"; LEASE="--force-with-lease=data:$BASE"
  else G commit -q -m "Data snapshot $(date -u +%FT%TZ)"; LEASE="--force"; fi
  if git push -q $LEASE origin HEAD:data; then echo "published (attempt $attempt)"; exit 0; fi
  echo "data branch moved; rebasing onto latest and retrying"; sleep $((attempt * 3))
  git fetch -q --depth 1 origin data && git reset -q --hard FETCH_HEAD
done
exit 1
