#!/usr/bin/env bash
# Publish ./data to the single-commit 'data' branch. Amend + force-with-lease => only changed files upload,
# no history growth, and a concurrent run can never be silently overwritten (we re-base onto it and retry).
# Usage: publish.sh all            (full refresh: replace every file)
#        publish.sh quotes         (quotes job: overlay only quotes.json + merge meta.json)
#        publish.sh corp           (exchange-data job: overlay only data/x and data/corp)
# data/x and data/corp belong to the corp job; 'all' keeps the branch's copy so the two jobs never overwrite each other.
set -euo pipefail
MODE=${1:-all}
cd pub
G() { git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" "$@"; }
overlay() {
  if [ "$MODE" = all ]; then mkdir -p data && rm -rf ../qkeep && mkdir ../qkeep && { cp data/quotes.json ../qkeep/ 2>/dev/null; cp data/check.json ../qkeep/ 2>/dev/null; cp -r data/i ../qkeep/ 2>/dev/null; true; }
    rsync -a --delete --exclude /x --exclude /corp ../data/ data/
    # never let a full refresh replace newer quotes published by the quotes loop meanwhile
    python3 - <<'PY'
import json, os, shutil
b = lambda p: (json.load(open(p)).get('built', 0) if os.path.exists(p) else 0)
if b('../qkeep/quotes.json') > b('data/quotes.json'):
    for f in ('quotes.json', 'check.json'):
        if os.path.exists('../qkeep/' + f): shutil.copy('../qkeep/' + f, 'data/' + f)
    if os.path.isdir('../qkeep/i'): shutil.rmtree('data/i', ignore_errors=True); shutil.copytree('../qkeep/i', 'data/i')
    m = json.load(open('data/meta.json')); m['quotes'] = b('data/quotes.json'); json.dump(m, open('data/meta.json', 'w')); print('kept newer quotes from the branch')
PY
  elif [ "$MODE" = corp ]; then mkdir -p data/x data/corp && rsync -a ../data/x/ data/x/ && rsync -a ../data/corp/ data/corp/ && { [ -f ../data/momentum.json ] && cp ../data/momentum.json data/momentum.json || true; }
  else mkdir -p data && cp ../data/quotes.json data/quotes.json && { [ -f ../data/check.json ] && cp ../data/check.json data/ || true; } && { [ -d ../data/i ] && mkdir -p data/i && cp ../data/i/* data/i/ || true; }
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
