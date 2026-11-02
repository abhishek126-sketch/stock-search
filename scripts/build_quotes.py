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
