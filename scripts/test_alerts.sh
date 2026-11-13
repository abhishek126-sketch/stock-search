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
# 5) 💎 value alerts (data/value.json: [fairValue, methods, quality, overall, strong]): a per-stock alert at fair value
#    − 10% and a scan over strong stocks at − 20%. SBIN 700 <= 1000 × 0.9 fires; COAL 850 > 1000 × 0.8 is not in the
#    scan zone, PFC 300 <= 500 × 0.8 is (one push); SBIN and WEAK are not strong (left out of the scan even though cheap;
#    a per-stock alert still fires for a stock that is not on the strong list).
(cd al && git fetch -q origin alerts && git reset -q --hard FETCH_HEAD)
inc=$(echo '{"alerts":[{"id":"v1","s":"SBIN.NS","type":"value","v":10,"ver":5},{"id":"v2","s":"*","type":"valueScan","v":20,"ver":5}]}' | node "$R/scripts/alertbox.js" enc)
ALERTS_IN="$inc" python3 "$R/scripts/alerts.py" save > out5.txt
(cd al && git fetch -q origin alerts && git reset -q --hard FETCH_HEAD)
echo '{"q":{"SBIN.NS":[700,710],"COAL.NS":[850,840],"PFC.NS":[300,310],"WEAK.NS":[10,11]}}' > data/quotes.json
echo '{"built":1,"s":{"SBIN.NS":[1000,6,60,50,0],"COAL.NS":[1000,6,90,70,1],"PFC.NS":[500,5,85,75,1],"WEAK.NS":[100,4,40,30,0]}}' > data/value.json
: > ntfy_paths.txt
NTFY_BASE=http://127.0.0.1:8799/ python3 "$R/scripts/alerts.py" check > out6.txt
[ "$(wc -l < ntfy_paths.txt)" = 2 ] || fail "value check sent $(wc -l < ntfy_paths.txt) pushes, expected 2 (SBIN value + scan)"
git clone -q --branch alerts remote.git v3
node "$R/scripts/alertbox.js" dec < v3/alerts.json | python3 -c "
import json, sys; d = {a['id']: a for a in json.load(sys.stdin)['alerts']}
assert d['v1']['trig'] and d['v1']['trigP'] == 700, d['v1']
assert d['v2']['zone'] == ['PFC.NS'] and not d['v2'].get('trig'), d['v2']" || { echo '--- save output'; cat out5.txt; echo '--- check output'; cat out6.txt; echo '--- remote log'; git -C v3 log --oneline -3; fail "value alert state not saved after the check"; }
# 6) next check: PFC still in the zone, COAL now drops in -> one push (only COAL is new); PFC at 410 (> 400 but within 3%) stays in
(cd al && git fetch -q origin alerts && git reset -q --hard FETCH_HEAD)
echo '{"q":{"SBIN.NS":[690,700],"COAL.NS":[790,800],"PFC.NS":[410,400],"WEAK.NS":[10,11]}}' > data/quotes.json
: > ntfy_paths.txt
NTFY_BASE=http://127.0.0.1:8799/ python3 "$R/scripts/alerts.py" check > out7.txt
[ "$(wc -l < ntfy_paths.txt)" = 1 ] || fail "second scan sent $(wc -l < ntfy_paths.txt) pushes, expected 1 (COAL only)"
git clone -q --branch alerts remote.git v4
node "$R/scripts/alertbox.js" dec < v4/alerts.json | python3 -c "
import json, sys; d = {a['id']: a for a in json.load(sys.stdin)['alerts']}
assert d['v2']['zone'] == ['COAL.NS', 'PFC.NS'], d['v2']"
# 7) the app re-saves its list (unchanged alert versions) -> the scan zone survives the merge
(cd al && git fetch -q origin alerts && git reset -q --hard FETCH_HEAD)
ALERTS_IN="$inc" python3 "$R/scripts/alerts.py" save > out8.txt
git clone -q --branch alerts remote.git v5
node "$R/scripts/alertbox.js" dec < v5/alerts.json | python3 -c "
import json, sys; d = {a['id']: a for a in json.load(sys.stdin)['alerts']}
assert d['v2']['zone'] == ['COAL.NS', 'PFC.NS'] and d['v1']['trig'], d"
grep -q 'SBIN\|PFC\|COAL' out5.txt out6.txt out7.txt out8.txt && fail "value-alert details printed to the log"
echo "alerts self-test: all passed"
