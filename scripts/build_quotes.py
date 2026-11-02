#!/usr/bin/env python3
"""Fast quotes-only refresh: price, previous close, time for every symbol in data/index.json
(Yahoo Finance batch quote endpoint, ~20 requests). Writes data/quotes.json and data/meta.json. No secrets."""
import json, os, sys, time, urllib.request, urllib.parse, http.cookiejar
OUT = os.path.join(os.path.dirname(__file__), '..', 'data')
CJ = http.cookiejar.CookieJar(); OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CJ)); OP.addheaders = [('User-Agent', 'Mozilla/5.0')]
try: OP.open('https://fc.yahoo.com', timeout=10)
except Exception: pass
crumb = OP.open('https://query2.finance.yahoo.com/v1/test/getcrumb', timeout=15).read().decode().strip()
syms = [r[0] for r in json.load(open(os.path.join(OUT, 'index.json')))['symbols']] + ['^NSEI', '^GSPC']
q = {}
for i in range(0, len(syms), 50):
    part = ','.join(syms[i:i + 50])
    for t in range(3):
        try:
            d = json.loads(OP.open('https://query2.finance.yahoo.com/v7/finance/quote?' + urllib.parse.urlencode({'symbols': part, 'fields': 'regularMarketPrice,regularMarketPreviousClose,regularMarketTime,marketState', 'crumb': crumb}), timeout=20).read())
            for r in d['quoteResponse']['result']:
                if r.get('regularMarketPrice') is not None:
                    q[r['symbol']] = [r['regularMarketPrice'], r.get('regularMarketPreviousClose'), r.get('regularMarketTime'), r.get('marketState')]
            break
        except Exception as e:
            print('batch fail', i, e); time.sleep(2 * (t + 1))
now = int(time.time())
json.dump({'built': now, 'q': q}, open(os.path.join(OUT, 'quotes.json'), 'w'), separators=(',', ':'))
mp = os.path.join(OUT, 'meta.json'); meta = json.load(open(mp)) if os.path.exists(mp) else {}
meta.update({'quotes': now, 'nQuotes': len(q)}); json.dump(meta, open(mp, 'w'))
print('quotes', len(q), 'of', len(syms))
if len(q) < 0.5 * len(syms): sys.exit(1)

# ---------- intraday (1D @5m, 1W @30m) -> data/i/<SYM>.json, only for symbols with a newer quote ----------
from concurrent.futures import ThreadPoolExecutor
IDIR = os.path.join(OUT, 'i'); os.makedirs(IDIR, exist_ok=True)
ip = os.path.join(IDIR, '_idx.json'); IDX = json.load(open(ip)) if os.path.exists(ip) else {}
T0 = time.time(); BUDGET = float(os.environ.get('INTRADAY_BUDGET', '70'))
def intraday(s):
    if time.time() - T0 > BUDGET: return s, None
    for t in range(2):
        try:
            d = json.loads(OP.open('https://query1.finance.yahoo.com/v8/finance/chart/' + urllib.parse.quote(s) + '?range=5d&interval=5m&includePrePost=false', timeout=12).read())['chart']['result'][0]
            m, ts, cl = d['meta'], d.get('timestamp') or [], d['indicators']['quote'][0].get('close') or []
            bars = [(a, round(b, 4)) for a, b in zip(ts, cl) if b is not None]
            if not bars: return s, None
            off = m.get('gmtoffset', 0); day = lambda a: (a + off) // 86400
            lastday = day(bars[-1][0]); d1 = [[a, b] for a, b in bars if day(a) == lastday]
            w = {}  # earlier days: last close per 30-min slot
            for a, b in bars:
                if day(a) != lastday: w[a - (a + off) % 1800] = b
            reg = (m.get('currentTradingPeriod') or {}).get('regular') or {}
            ss = [reg.get('start'), reg.get('end')] if reg.get('start') and day(reg['start']) == lastday else None
            qq = q.get(s); pc = qq[1] if qq and qq[2] and day(qq[2]) == lastday else None
            if pc is None:  # fall back to previous session's last bar
                prev = [b for a, b in bars if day(a) < lastday]; pc = prev[-1] if prev else m.get('chartPreviousClose')
            return s, {'tz': m.get('exchangeTimezoneName'), 'off': off, 'pc': pc, 'ses': ss, 'd1': d1, 'w': sorted([[a, b] for a, b in w.items()]) + d1[::6] + ([d1[-1]] if (len(d1) - 1) % 6 else []), 'asOf': int(time.time())}
        except Exception as e:
            if t: print('intraday fail', s, str(e)[:80])
            time.sleep(1)
    return s, None
todo = [s for s in syms if s in q and q[s][2] and q[s][2] > IDX.get(s, 0)]
print('intraday to fetch', len(todo))
n = 0
with ThreadPoolExecutor(24) as ex:
    for s, r in ex.map(intraday, todo):
        if r: json.dump(r, open(os.path.join(IDIR, s + '.json'), 'w'), separators=(',', ':')); IDX[s] = r['d1'][-1][0]; n += 1
json.dump(IDX, open(ip, 'w'), separators=(',', ':'))
print('intraday written', n, 'in', round(time.time() - T0, 1), 's')
