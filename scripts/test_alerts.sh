#!/usr/bin/env bash
# Self-test of private (encrypted) price alerts - scripts/alerts.py + scripts/alertbox.js - on a throwaway local git
# remote and a fake ntfy server. Never touches the real 'alerts' branch. Run by .github/workflows/check.yml.
set -euo pipefail
R=$(cd "$(dirname "$0")/.." && pwd); T=$(mktemp -d); trap 'kill $NP 2>/dev/null || true; rm -rf "$T"' EXIT
export ALERTS_KEY=ssk1_ci_self_test_key_0123456789abcdef
G() { git -c user.name=t -c user.email=t@example.invalid "$@"; }
fail() { echo "SELF-TEST FAILED: $*"; exit 1; }
cd "$T"
# a remote whose alerts branch holds the old plain-text file (topic + list) and some history
git init -q --bare remote.git; git clone -q remote.git seed 2>/dev/null; cd seed; git checkout -q -b alerts
echo '{"topic":"stocksearch-oldtopic","alerts":[{"id":"a1","s":"TCS.NS","type":"above","v":100,"note":"private note","ver":1,"trig":null,"trigP":null}],"updated":1}' > alerts.json
G add alerts.json; G commit -qm legacy; echo x > leftover.txt; G add leftover.txt; G commit -qm second; git push -q origin alerts; cd "$T"
git clone -q --branch alerts remote.git al
# 1) the app sends an encrypted list -> one encrypted commit, nothing readable, no topic, no old files/history
inc=$(echo '{"alerts":[{"id":"a1","s":"TCS.NS","type":"above","v":100,"note":"private note","ver":1},{"id":"a2","s":"INFY.NS","type":"below","v":5,"ver":2}]}' | node "$R/scripts/alertbox.js" enc)
ALERTS_IN="$inc" python3 "$R/scripts/alerts.py" save > out1.txt
git clone -q --branch alerts remote.git v1
[ "$(git -C v1 rev-list --count HEAD)" = 1 ] || fail "branch has more than one commit"
[ "$(ls v1 | tr '\n' ' ')" = "alerts.json " ] || fail "unexpected files: $(ls v1)"
grep -q 'TCS\|INFY\|private note\|oldtopic' v1/alerts.json && fail "plain text left in alerts.json"
node "$R/scripts/alertbox.js" dec < v1/alerts.json | python3 -c "
import json, sys; d = json.load(sys.stdin)
assert len(d['alerts']) == 2 and 'topic' not in d, d"
# 2) price check: TCS 200 >= 100 fires (INFY 1500 is not <= 5); the push goes to the topic derived from the key
mkdir -p data; echo '{"q":{"TCS.NS":[200,190],"INFY.NS":[1500,1490]}}' > data/quotes.json
python3 -c "
import http.server
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length', 0))); open('ntfy_paths.txt', 'a').write(self.path + '\n')
        self.send_response(200); self.end_headers(); self.wfile.write(b'{}')
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', 8799), H).serve_forever()" & NP=$!
sleep 1
NTFY_BASE=http://127.0.0.1:8799/ python3 "$R/scripts/alerts.py" check > out2.txt
want="/ss-$(printf '%s' "ntfy-topic|$ALERTS_KEY" | sha256sum | cut -c1-32)"
[ "$(cat ntfy_paths.txt)" = "$want" ] || fail "push went to '$(cat ntfy_paths.txt 2>/dev/null)', expected $want"
grep -q 'TCS\|INFY\|private note\|200' out1.txt out2.txt && fail "alert details printed to the log"
git clone -q --branch alerts remote.git v2
[ "$(git -C v2 rev-list --count HEAD)" = 1 ] || fail "branch has more than one commit after check"
node "$R/scripts/alertbox.js" dec < v2/alerts.json | python3 -c "
import json, sys; d = {a['id']: a for a in json.load(sys.stdin)['alerts']}
assert d['a1']['trig'] and d['a1']['trigP'] == 200 and not d['a2'].get('trig'), d"
# 3) nothing new -> no commit
head=$(git -C v2 rev-parse HEAD); (cd al && git fetch -q origin alerts && git reset -q --hard FETCH_HEAD)
NTFY_BASE=http://127.0.0.1:8799/ python3 "$R/scripts/alerts.py" check > out3.txt
[ "$(git ls-remote remote.git refs/heads/alerts | cut -f1)" = "$head" ] || fail "a check with nothing new made a commit"
# 4) wrong key -> refuses, file untouched
ALERTS_KEY=ssk1_wrong_key_wrong_key_wrong python3 "$R/scripts/alerts.py" check > out4.txt 2>&1 && fail "wrong key accepted"
[ "$(git ls-remote remote.git refs/heads/alerts | cut -f1)" = "$head" ] || fail "wrong key changed the branch"
echo "alerts self-test: all passed"
