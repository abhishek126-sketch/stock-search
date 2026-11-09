#!/usr/bin/env python3
"""Second-source cross-check of data/quotes.json (Yahoo).
India: NSE live equity-stockIndices API (cookie session); if NSE blocks it, falls back to the official
NSE end-of-day bhavcopy CSV (nsearchives). US: Finnhub /quote for a rotating subset (free tier ~60 calls/min),
only when the FINNHUB_KEY env var (GitHub Actions secret) is set; the key is never printed or written.
Writes data/check.json. Never fails the job."""
import json, os, time, csv, io, gzip, zlib, datetime as dt, urllib.request, urllib.parse, urllib.error, http.cookiejar
OUT = os.path.join(os.path.dirname(__file__), '..', 'data'); TOL = 0.01
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
Q = json.load(open(os.path.join(OUT, 'quotes.json')))['q']
cp = os.path.join(OUT, 'check.json'); PREV = json.load(open(cp)) if os.path.exists(cp) else {}
S, now = {}, int(time.time())
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
rel = lambda a, b: abs(a / b - 1) if a and b else None
def put(sym, src, p, pc, t, mode, cmp_p):
    d = rel(cmp_p, p) if cmp_p is not None else None
    S[sym] = {'src': src, 'mode': mode, 'p': p, 'pc': pc, 'chg': (p / pc - 1) if p and pc else None, 't': t,
              'd': round(d, 5) if d is not None else None, 'st': None if d is None else ('ok' if d <= TOL else 'mm')}

# ---------------- NSE ----------------
nse = {'mode': 'failed'}
NSE = 'https://www.nseindia.com'
DIAG = {}  # what NSE actually answered (status codes, final URL, cookie NAMES only) -> published in check.json for troubleshooting

def nse_get(op, url, accept, referer):
    """GET like a browser tab would; returns (status, final_url, content_type, body_bytes). Never raises on HTTP errors."""
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': accept, 'Accept-Language': 'en-US,en;q=0.9',
                                               'Accept-Encoding': 'gzip, deflate', 'Referer': referer, 'Connection': 'keep-alive'})
    try:
        r = op.open(req, timeout=15); st, fu, ct, raw, enc = r.status, r.geturl(), r.headers.get('Content-Type', ''), r.read(), r.headers.get('Content-Encoding', '')
    except urllib.error.HTTPError as e:
        st, fu, ct, enc = e.code, e.geturl(), e.headers.get('Content-Type', '') if e.headers else '', e.headers.get('Content-Encoding', '') if e.headers else ''
        try: raw = e.read()
        except Exception: raw = b''
    if enc == 'gzip': raw = gzip.decompress(raw)
    elif enc == 'deflate': raw = zlib.decompress(raw)
    return st, fu, ct, raw

def nse_session():
    cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    html = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    warm = []
    for u in (NSE + '/', NSE + '/market-data/live-equity-market'):   # the 2nd page sets the API cookies (nsit / nseappid) on the current site
        try: st, fu, _, _ = nse_get(op, u, html, NSE + '/'); warm.append(st if fu.rstrip('/') == u.rstrip('/') else '%s->%s' % (st, urllib.parse.urlparse(fu).path))
        except Exception as e: warm.append(type(e).__name__)
        time.sleep(1)
    DIAG['warm'] = warm; DIAG['cookies'] = sorted({c.name for c in cj})
    return op

def nse_index(op, ix):
    url = NSE + '/api/equity-stockIndices?index=' + urllib.parse.quote(ix)
    st, fu, ct, raw = nse_get(op, url, 'application/json, text/plain, */*', NSE + '/market-data/live-equity-market')
    info = {'st': st, 'ct': ct.split(';')[0]}
    if fu != url: info['to'] = urllib.parse.urlparse(fu).path
    if st == 200 and raw.lstrip()[:1] in (b'{', b'['):
        DIAG.setdefault('ix', {})[ix] = info; return json.loads(raw)
    info['body'] = raw[:80].decode('utf-8', 'replace').replace('\n', ' ')
    DIAG.setdefault('ix', {})[ix] = info
    raise RuntimeError('%s HTTP %s%s' % (ix, st, ' -> ' + info['to'] if 'to' in info else ''))

try:
    op = nse_session()
    n, errs = 0, []
    # each index is tried on its own, so one renamed/blocked index no longer throws away the others
    for ix in ('NIFTY 500', 'NIFTY MICROCAP 250'):
        d = None
        for attempt in range(2):          # on a block, start a fresh cookie session once and retry
            try: d = nse_index(op, ix); break
            except Exception as e:
                err = str(e)[:80]
                if attempt == 0: time.sleep(2); op = nse_session()
        if d is None: errs.append(err); continue
        for r in d.get('data', []):
            s = (r.get('symbol') or '') + '.NS'; y = Q.get(s)
            if r.get('priority') or not r.get('lastPrice') or not y: continue
            put(s, 'NSE', float(r['lastPrice']), float(r.get('previousClose') or 0) or None, now, 'live', y[0]); n += 1
    if not n: raise RuntimeError('; '.join(errs) or 'no rows')
    nse = {'mode': 'live', 'n': n}
    if errs: nse['partialErr'] = '; '.join(errs)[:160]
except Exception as e:
    nse = {'mode': 'failed', 'liveErr': str(e)[:160]}
    print('NSE live API unavailable:', str(e)[:160], '-> bhavcopy fallback')
nse['diag'] = DIAG
print('NSE diag', json.dumps(DIAG))
if nse['mode'] != 'live':
    for back in range(0, 8):
        day = dt.datetime.now(IST).date() - dt.timedelta(days=back)
        try:
            raw = urllib.request.urlopen(urllib.request.Request('https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_%s.csv' % day.strftime('%d%m%Y'), headers={'User-Agent': UA}), timeout=20).read().decode()
        except Exception: continue
        n = 0
        for r in csv.DictReader(io.StringIO(raw), skipinitialspace=True):
            r = {k.strip(): (v or '').strip() for k, v in r.items() if k}
            if r.get('SERIES') not in ('EQ', 'BE', 'BZ', 'SM', 'ST'): continue
            s = r['SYMBOL'] + '.NS'; y = Q.get(s)
            if not y: continue
            close, pcl = float(r['CLOSE_PRICE']), float(r['PREV_CLOSE'])
            yd = dt.datetime.fromtimestamp(y[2], IST).date() if y[2] else None
            # compare like with like: same session -> Yahoo price vs NSE close; Yahoo already on a later session -> Yahoo prev close vs NSE close
            cmpv = y[0] if yd == day else (y[1] if yd and yd > day else None)
            put(s, 'NSE', close, pcl, int(dt.datetime.combine(day, dt.time(15, 30), IST).timestamp()), 'eod', cmpv); n += 1
        nse.update({'mode': 'eod', 'date': day.isoformat(), 'n': n}); break
print('NSE', nse)

# ---------------- Finnhub (US) ----------------
KEY = os.environ.get('FINNHUB_KEY', '').strip(); fh = {'mode': 'no-key'}; REC = dict(PREV.get('rec') or {})
for s, v in (PREV.get('s') or {}).items():  # keep earlier rotating-subset results (US) for up to 1 day
    if v.get('src') == 'Finnhub' and now - (v.get('chk') or 0) < 86400: S[s] = v
if KEY:
    us = sorted(s for s in Q if not s.endswith(('.NS', '.BO')) and not s.startswith('^'))
    NQ, NR = int(os.environ.get('FH_QUOTES', 40)), int(os.environ.get('FH_REC', 5)); slot = now // 300
    sub = [us[(slot * NQ + i) % len(us)] for i in range(min(NQ, len(us)))]
    rsub = [us[(slot * NR + i) % len(us)] for i in range(min(NR, len(us)))]
    def fget(path, **p):
        p['token'] = KEY
        for t in range(3):
            try: return json.loads(urllib.request.urlopen('https://finnhub.io/api/v1/' + path + '?' + urllib.parse.urlencode(p), timeout=12).read())
            except urllib.error.HTTPError as e:
                if e.code == 429: time.sleep(5); continue
                raise RuntimeError('HTTP %d' % e.code) from None  # message never contains the URL/token
            except Exception as e: raise RuntimeError(type(e).__name__) from None
    ok = err = 0
    try:
        for s in sub:
            t0 = time.time()
            try:
                r = fget('quote', symbol=s.replace('-', '.'))
                if r and r.get('c'):
                    y = Q[s]; put(s, 'Finnhub', r['c'], r.get('pc'), r.get('t'), 'live', y[0]); S[s]['chk'] = now; ok += 1
            except RuntimeError as e:
                err += 1; print('finnhub quote fail', s, e)
                if '401' in str(e) or '403' in str(e): raise
            time.sleep(max(0, 1.05 - (time.time() - t0)))  # <= ~57 calls/min
        for s in rsub:
            try:
                r = fget('stock/recommendation', symbol=s.replace('-', '.'))
                if r: x = r[0]; REC[s] = {k: x.get(k) for k in ('strongBuy', 'buy', 'hold', 'sell', 'strongSell', 'period')}
            except RuntimeError as e: print('finnhub rec fail', s, e)
            time.sleep(1.05)
        fh = {'mode': 'live', 'n': ok, 'err': err}
    except RuntimeError as e: fh = {'mode': 'error', 'err': str(e)}
print('Finnhub', fh)

mm = sorted([s for s, v in S.items() if v.get('st') == 'mm'], key=lambda s: -(S[s]['d'] or 0))
json.dump({'built': now, 'tol': TOL, 'nse': nse, 'fh': fh, 'nOk': sum(1 for v in S.values() if v.get('st') == 'ok'), 'mm': mm, 's': S, 'rec': REC},
          open(cp, 'w'), separators=(',', ':'))
print('checked', sum(1 for v in S.values() if v.get('st')), 'ok', sum(1 for v in S.values() if v.get('st') == 'ok'), 'mismatch', len(mm), mm[:15])
