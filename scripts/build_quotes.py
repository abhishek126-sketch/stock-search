#!/usr/bin/env python3
"""Fast quotes-only refresh: price, previous close, time for every symbol in data/index.json
(Yahoo Finance batch quote endpoint, ~20 requests). Writes data/quotes.json and data/meta.json. No secrets."""
import json, os, sys, time, urllib.request, urllib.parse, http.cookiejar
OUT = os.path.join(os.path.dirname(__file__), '..', 'data')
CJ = http.cookiejar.CookieJar(); OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CJ)); OP.addheaders = [('User-Agent', 'Mozilla/5.0')]
try: OP.open('https://fc.yahoo.com', timeout=10)
except Exception: pass
crumb = ''
for _t in range(5):  # Yahoo sometimes rate-limits the crumb call (HTTP 429) - retry with backoff
    try: crumb = OP.open('https://query2.finance.yahoo.com/v1/test/getcrumb', timeout=15).read().decode().strip(); break
    except Exception as e: print('crumb retry', _t, e); time.sleep(5 * (_t + 1))
if not crumb: sys.exit('no Yahoo crumb')
syms = [r[0] for r in json.load(open(os.path.join(OUT, 'index.json')))['symbols']] + ['^NSEI', '^GSPC']
q = {}
from concurrent.futures import ThreadPoolExecutor
def batch(i):  # ~1,300 symbols -> ~27 batches of 50, fetched 6 at a time
    part = ','.join(syms[i:i + 50])
    for t in range(3):
        try:
            d = json.loads(OP.open('https://query2.finance.yahoo.com/v7/finance/quote?' + urllib.parse.urlencode({'symbols': part, 'fields': 'regularMarketPrice,regularMarketPreviousClose,regularMarketTime,marketState', 'crumb': crumb}), timeout=20).read())
            return {r['symbol']: [r['regularMarketPrice'], r.get('regularMarketPreviousClose'), r.get('regularMarketTime'), r.get('marketState')]
                    for r in d['quoteResponse']['result'] if r.get('regularMarketPrice') is not None}
        except Exception as e:
            print('batch fail', i, e); time.sleep(2 * (t + 1))
    return {}
with ThreadPoolExecutor(6) as ex:
    for r in ex.map(batch, range(0, len(syms), 50)): q.update(r)
now = int(time.time())
# Yahoo sometimes returns a frozen quote months old (TGL.NS on 9 Nov 2026: ₹472.10 dated Jul vs ~₹10 actual).
# Drop quotes older than 20 days (longer than any market holiday); the app then uses the stock file's daily close.
stale = sorted(s for s, v in q.items() if v[2] and now - v[2] > 20 * 86400)
for s in stale: del q[s]
if stale: print('dropped', len(stale), 'stale quotes (> 20 days old):', stale[:20])
# Yahoo sometimes sends a wild quote (NV20.NS ETF on 13 Nov 2026: 12,353.60 vs NSE close 14.55). Indian prices move at most
# ~20% a day (circuit limits), so a quote outside 0.45x-2.2x of the last full refresh's price is dropped (the app then uses
# the stock file's close) - except a fall by a split / bonus factor (2, 3, 4, 5, 10 ...), which is a real ex-date price.
try: REF = {r['s']: r['p'] for r in json.load(open(os.path.join(OUT, 'summary.json')))['rows'] if isinstance(r.get('p'), (int, float)) and r['p'] > 0}
except Exception: REF = {}
SPLIT = (2, 3, 4, 5, 6, 10, 20, 25, 50, 100)
def wild_wide(s, p):
    ref = REF.get(s)
    if not ref or not s.endswith(('.NS', '.BO')) or not isinstance(p, (int, float)) or p <= 0: return False
    r = p / ref
    return not 0.45 < r < 2.2 and not any(abs(r * f - 1) < 0.15 for f in SPLIT)
# Price bands (audit 24 Nov 2026): the 0.45x-2.2x range above let a quote 40% off through (then shown as the live price, used
# for P&L and price alerts). NSE's daily security list (data/bands.json, scripts/nsedaily.js) gives each stock's circuit limit
# for the session: 2 / 5 / 10 / 20%, or 'No Band' (F&O stocks and ETFs, whose limits flex - 35% used, beyond any real day).
# A quote further from the last official close than the limit allows (+1% slack, compounded over the sessions since that
# close) can't be a real trade and is dropped. BSE-only stocks: 20% (BSE's widest equity band). A bonus / split going ex
# within 3 days (data/ca.json) scales the reference first. Any error here falls back to the wide check for that quote.
def jload(f, d):
    try: return json.load(open(os.path.join(OUT, f)))
    except Exception: return d
BANDS = (jload('bands.json', {}) or {}).get('b') or {}
CAX = (jload('ca.json', {}) or {}).get('by') or {}
META0 = jload('meta.json', {}) or {}
import re, datetime as dt
def ist_day(t): return dt.datetime.fromtimestamp(t, dt.timezone(dt.timedelta(hours=5, minutes=30))).date()
def sessions(a, b):  # weekdays after day a up to day b (holidays counted as sessions - errs on the lenient side)
    n, d = 0, a
    while d < b and n < 30:
        d += dt.timedelta(days=1)
        if d.weekday() < 5: n += 1
    return max(1, n)
def ca_factor(subj):  # same as build_data.py ca_factor: 'Bonus 1:1' -> 2, split Rs 10 -> Rs 2 -> 5 (both on one line multiply)
    s = (subj or '').upper()
    if 'NCRPS' in s or 'PREF' in s: return None
    f = 1.0
    b = re.search(r'BONUS\D{0,3}(\d+)\s*:\s*(\d+)', s)
    if b and int(b.group(2)): f *= (int(b.group(1)) + int(b.group(2))) / int(b.group(2))
    p = re.search(r'(?:SPLIT|SUB-?DIVISION).*?FROM\s+R[SE]\.?\s*([\d.]+).*?TO\s+R[SE]\.?\s*([\d.]+)', s, re.S)
    if p:
        try: x, y = float(p.group(1).rstrip('.')), float(p.group(2).rstrip('.'))
        except ValueError: x = y = 0
        if y and x > y: f *= x / y
    return f if f > 1.05 else None
def wild(s, p, t):
    if not BANDS: return wild_wide(s, p)
    try:
        ref = REF.get(s)
        if not ref or not s.endswith(('.NS', '.BO')) or not isinstance(p, (int, float)) or p <= 0: return False
        base, nse = s[:-3], s.endswith('.NS')
        day = ist_day(t if isinstance(t, (int, float)) and t > 0 else time.time())
        b = BANDS.get(base) if nse else 20
        lim = ((b if b and b > 0 else 35) + 1) / 100
        try: d0 = dt.date.fromisoformat(META0.get('nseDay' if nse else 'bseDay') or '')
        except (TypeError, ValueError): d0 = day
        k = sessions(d0, day)
        f = 1.0
        for r in (CAX.get(base) or []) if nse else []:
            try:
                if isinstance(r, list) and len(r) > 1 and abs((dt.date.fromisoformat(r[0]) - day).days) <= 3: f *= ca_factor(r[1]) or 1.0
            except ValueError: pass
        r = p / ref * f
        return not ((1 - lim) ** k <= r <= (1 + lim) ** k)
    except Exception as e:
        print('band check error', s, repr(e)[:80]); return wild_wide(s, p)
bad = sorted(s for s, v in q.items() if wild(s, v[0], v[2]))
for s in bad[:20]: print('dropped quote', s, q[s][0], 'vs last close', REF.get(s), 'band', BANDS.get(s[:-3]) if s.endswith('.NS') else 'BSE 20')
for s in bad: del q[s]
if bad: print('dropped', len(bad), 'quotes outside the price band' if BANDS else 'wild quotes (far from the last close)', bad[:20])
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
N429 = [0]
def intraday(s):
    if time.time() - T0 > BUDGET or N429[0] > 15: return s, None  # Yahoo is rate-limiting: stop, protect the quote call next cycle
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
            if getattr(e, 'code', 0) == 429: N429[0] += 1; return s, None
            if t: print('intraday fail', s, str(e)[:80])
            time.sleep(1)
    return s, None
try: PN = {r['s'] for r in json.load(open(os.path.join(OUT, 'summary.json')))['rows'] if r.get('pn') or r.get('cap') == 'Other'}
except Exception: PN = set()
# penny + non-index stocks (thinly traded): intraday chart at most every 15 min to stay under Yahoo's rate limit
todo = [s for s in syms if s in q and q[s][2] and q[s][2] > IDX.get(s, 0) and not (s in PN and q[s][2] - IDX.get(s, 0) < 900)]
print('intraday to fetch', len(todo))
n = 0
with ThreadPoolExecutor(10) as ex:
    for s, r in ex.map(intraday, todo):
        if r: json.dump(r, open(os.path.join(IDIR, s + '.json'), 'w'), separators=(',', ':')); IDX[s] = r['d1'][-1][0]; n += 1
json.dump(IDX, open(ip, 'w'), separators=(',', ':'))
print('intraday written', n, 'rate-limited', N429[0], 'in', round(time.time() - T0, 1), 's')
