#!/usr/bin/env python3
"""Price alerts stored as alerts.json on the 'alerts' branch (public).
Private mode (from 11 Nov 2026, when the repo secret ALERTS_KEY is set): the file holds only an AES-256-GCM box
{"v": 2, "iv", "ct"} made with that key (scripts/alertbox.js; the app does the same with WebCrypto), the ntfy topic is
derived from the key ('ss-' + SHA-256('ntfy-topic|' + key)[:32]) and never stored, the app sends its list encrypted,
nothing about alerts is printed to the (public) job logs, and every save replaces the branch with a single commit so no
readable history is kept. Before that the topic and the list were readable by anyone. Without ALERTS_KEY: old behaviour.
  alerts.py save   : merge the list sent by the app (env ALERTS_IN, via workflow_dispatch input) and push
  alerts.py check  : evaluate alerts against data/quotes.json (+ NSE cross-check), push ntfy.sh notifications,
                     mark triggered alerts (fire once until re-armed in the app) and push
Uses the job's GITHUB_TOKEN via the already-authenticated clone in ./al. Never fails the quotes job."""
import json, os, sys, time, subprocess, urllib.request, hashlib
AL = 'al'; F = os.path.join(AL, 'alerts.json'); now = int(time.time())
def git(*a, check=True): return subprocess.run(['git', '-C', AL, '-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', *a], check=check, capture_output=True, text=True)
KEY = os.environ.get('ALERTS_KEY', '').strip()
NTFY = os.environ.get('NTFY_BASE', 'https://ntfy.sh/')   # overridden only by the self-test (scripts/test_alerts.sh)
HERE = os.path.dirname(os.path.abspath(__file__))
def box(mode, obj):
    r = subprocess.run(['node', os.path.join(HERE, 'alertbox.js'), mode], input=json.dumps(obj), capture_output=True, text=True, env=os.environ)
    if r.returncode: sys.exit('alertbox ' + mode + ' failed: ' + r.stderr.strip()[:200])
    return json.loads(r.stdout)
def topic_of(cur): return ('ss-' + hashlib.sha256(('ntfy-topic|' + KEY).encode()).hexdigest()[:32]) if KEY else cur.get('topic')
def load():
    if not os.path.exists(F): return {'topic': None, 'alerts': []}
    j = json.load(open(F))
    if j.get('v') == 2:
        if not KEY: sys.exit('alerts.json is encrypted but the ALERTS_KEY secret is not set')
        j = box('dec', j); j.setdefault('alerts', [])
    return j
def same(a, b): return json.dumps(a.get('alerts', []), sort_keys=True) == json.dumps(b.get('alerts', []), sort_keys=True)
def merge_save(inc, cur):
    """App list wins for membership/edits; a server-side trigger is kept unless the app edited/re-armed the alert after it fired."""
    old = {a['id']: a for a in cur.get('alerts', [])}; out = []
    for a in inc.get('alerts', [])[:200]:
        o = old.get(a.get('id'))
        if o and o.get('trig') and (a.get('ver') or 0) <= o['trig']: a['trig'], a['trigP'] = o['trig'], o.get('trigP')
        out.append({k: a.get(k) for k in ('id', 's', 'type', 'v', 'note', 'ver', 'trig', 'trigP')})
    if KEY: return {'alerts': out, 'updated': now}                  # private mode: the topic comes from the key
    return {'topic': inc['topic'] if 'topic' in inc else cur.get('topic'), 'alerts': out, 'updated': now}
def publish(mutate, msg):
    if KEY: return publish_private(mutate, msg)
    for attempt in range(5):
        cur = load(); new = mutate(cur)
        if new is None: print('no changes'); return
        json.dump(new, open(F, 'w'), indent=1); git('add', 'alerts.json')
        if not git('diff', '--cached', '--quiet', check=False).returncode: print('no changes'); return
        git('commit', '-q', '-m', msg)
        if git('push', '-q', 'origin', 'HEAD:alerts', check=False).returncode == 0: print('pushed'); return
        time.sleep(2 * (attempt + 1)); git('fetch', '-q', 'origin', 'alerts'); git('reset', '-q', '--hard', 'FETCH_HEAD')
    sys.exit('push failed')

def publish_private(mutate, msg):
    for attempt in range(5):
        raw = json.load(open(F)) if os.path.exists(F) else None
        cur = load(); before = json.loads(json.dumps(cur)); new = mutate(cur)   # mutate may change cur in place
        if new is None or (raw and raw.get('v') == 2 and same(new, before)): print('no changes'); return
        new = {'alerts': new.get('alerts', []), 'updated': new.get('updated') or now}
        base = git('rev-parse', '-q', '--verify', 'HEAD', check=False).stdout.strip()
        git('checkout', '-q', '--detach', check=False)
        git('checkout', '-q', '--orphan', 'tmp%d%d' % (now, attempt))
        git('rm', '-rq', '--cached', '.', check=False)
        json.dump(box('enc', new), open(F, 'w')); git('add', 'alerts.json'); git('commit', '-q', '-m', msg)
        lease = '--force-with-lease=alerts:' + base if base else '--force'
        if git('push', '-q', lease, 'origin', 'HEAD:alerts', check=False).returncode == 0: print('pushed (encrypted)'); return
        time.sleep(2 * (attempt + 1)); git('fetch', '-q', '--depth', '1', 'origin', 'alerts', check=False); git('reset', '-q', '--hard', 'FETCH_HEAD', check=False)
    sys.exit('push failed')

def price(sym, Q, C):
    q = Q.get(sym)
    if not q or q[0] is None: return None, None, 'Yahoo'
    p, pc, src = q[0], q[1], 'Yahoo'
    c = (C.get('s') or {}).get(sym)
    if c and c.get('src') == 'NSE' and c.get('st') == 'mm' and c.get('mode') == 'live': p, pc, src = c['p'], c.get('pc') or pc, 'NSE'
    return p, pc, src
def hit(a, p, pc):
    v = float(a['v']); chg = (p / pc - 1) * 100 if pc else None
    return {'above': p >= v, 'below': p <= v, 'chgUp': chg is not None and chg >= v, 'chgDn': chg is not None and chg <= -abs(v)}.get(a['type'], False), chg
DESC = {'above': 'rose above', 'below': 'fell below', 'chgUp': 'day change ≥ +', 'chgDn': 'day change ≤ −'}
def check():
    Q = json.load(open('data/quotes.json'))['q']
    C = json.load(open('data/check.json')) if os.path.exists('data/check.json') else {}
    def mutate(cur):
        topic, fired = topic_of(cur), 0
        for a in cur.get('alerts', []):
            if a.get('trig'): continue
            p, pc, src = price(a['s'], Q, C)
            if p is None: continue
            ok, chg = hit(a, p, pc)
            if not ok: continue
            name = a['s'].replace('.NS', '').replace('.BO', ''); ccy = '₹' if a['s'].endswith(('.NS', '.BO')) else '$'
            cond = f"{DESC[a['type']]}{a['v']}%" if a['type'].startswith('chg') else f"{DESC[a['type']]} {ccy}{a['v']}"
            body = f"{name} {cond}: now {ccy}{p:,.2f} ({chg:+.2f}% today, {src})" + (f" — {a['note']}" if a.get('note') else '')
            if topic:
                try:
                    urllib.request.urlopen(urllib.request.Request(NTFY + topic, data=body.encode(), headers={
                        'Title': f'Price alert: {name}', 'Tags': 'chart_with_upwards_trend' if a['type'] in ('above', 'chgUp') else 'chart_with_downwards_trend',
                        'Click': 'https://abhishek126-sketch.github.io/stock-search/#' + a['s'], 'Priority': 'high'}), timeout=15).read()
                except Exception as e: print('ntfy push failed:', type(e).__name__); continue  # retry next run
            a['trig'], a['trigP'] = now, round(p, 4); fired += 1
        if fired: print('alerts fired:', fired)   # no symbols / prices / notes: the job logs are public
        return cur if fired else None
    publish(mutate, 'Alerts triggered')
if __name__ == '__main__':
    if sys.argv[1] == 'save':
        inc = json.loads(os.environ['ALERTS_IN'])
        if inc.get('v') == 2:
            if not KEY: sys.exit('The app sent an encrypted list but the ALERTS_KEY secret is not set - add it in the repo settings')
            inc = box('dec', inc)
        publish(lambda cur: merge_save(inc, cur), 'Alerts updated from app')
    else:
        try: check()
        except SystemExit: raise
        except Exception as e: print('alert check error', e)
