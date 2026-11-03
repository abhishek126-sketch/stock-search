#!/usr/bin/env python3
"""Price alerts stored as alerts.json on the 'alerts' branch (public; contains no secrets — the ntfy topic is a
random unguessable name chosen by the app, not a credential).
  alerts.py save   : merge the list sent by the app (env ALERTS_IN, via workflow_dispatch input) and push
  alerts.py check  : evaluate alerts against data/quotes.json (+ NSE cross-check), push ntfy.sh notifications,
                     mark triggered alerts (fire once until re-armed in the app) and push
Uses the job's GITHUB_TOKEN via the already-authenticated clone in ./al. Never fails the quotes job."""
import json, os, sys, time, subprocess, urllib.request
AL = 'al'; F = os.path.join(AL, 'alerts.json'); now = int(time.time())
def git(*a, check=True): return subprocess.run(['git', '-C', AL, '-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', *a], check=check, capture_output=True, text=True)
def load(): return json.load(open(F)) if os.path.exists(F) else {'topic': None, 'alerts': []}
def merge_save(inc, cur):
    """App list wins for membership/edits; a server-side trigger is kept unless the app edited/re-armed the alert after it fired."""
    old = {a['id']: a for a in cur.get('alerts', [])}; out = []
    for a in inc.get('alerts', [])[:200]:
        o = old.get(a.get('id'))
        if o and o.get('trig') and (a.get('ver') or 0) <= o['trig']: a['trig'], a['trigP'] = o['trig'], o.get('trigP')
        out.append({k: a.get(k) for k in ('id', 's', 'type', 'v', 'note', 'ver', 'trig', 'trigP')})
    return {'topic': inc.get('topic') or cur.get('topic'), 'alerts': out, 'updated': now}
def publish(mutate, msg):
    for attempt in range(5):
        cur = load(); new = mutate(cur)
        if new is None: print('no changes'); return
        json.dump(new, open(F, 'w'), indent=1); git('add', 'alerts.json')
        if not git('diff', '--cached', '--quiet', check=False).returncode: print('no changes'); return
        git('commit', '-q', '-m', msg)
        if git('push', '-q', 'origin', 'HEAD:alerts', check=False).returncode == 0: print('pushed'); return
        time.sleep(2 * (attempt + 1)); git('fetch', '-q', 'origin', 'alerts'); git('reset', '-q', '--hard', 'FETCH_HEAD')
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
        topic, fired = cur.get('topic'), 0
        for a in cur.get('alerts', []):
            if a.get('trig'): continue
            p, pc, src = price(a['s'], Q, C)
            if p is None: continue
            ok, chg = hit(a, p, pc)
            if not ok: continue
            name = a['s'].replace('.NS', ''); ccy = '₹' if a['s'].endswith('.NS') else '$'
            cond = f"{DESC[a['type']]}{a['v']}%" if a['type'].startswith('chg') else f"{DESC[a['type']]} {ccy}{a['v']}"
            body = f"{name} {cond}: now {ccy}{p:,.2f} ({chg:+.2f}% today, {src})" + (f" — {a['note']}" if a.get('note') else '')
            if topic:
                try:
                    urllib.request.urlopen(urllib.request.Request('https://ntfy.sh/' + topic, data=body.encode(), headers={
                        'Title': f'Price alert: {name}', 'Tags': 'chart_with_upwards_trend' if a['type'] in ('above', 'chgUp') else 'chart_with_downwards_trend',
                        'Click': 'https://abhishek126-sketch.github.io/stock-search/#' + a['s'], 'Priority': 'high'}), timeout=15).read()
                except Exception as e: print('ntfy fail', a['s'], e); continue  # retry next run
            a['trig'], a['trigP'] = now, round(p, 4); fired += 1; print('ALERT', body)
        return cur if fired else None
    publish(mutate, 'Alerts triggered')
if __name__ == '__main__':
    if sys.argv[1] == 'save':
        inc = json.loads(os.environ['ALERTS_IN'])
        publish(lambda cur: merge_save(inc, cur), 'Alerts updated from app')
    else:
        try: check()
        except SystemExit: raise
        except Exception as e: print('alert check error', e)
