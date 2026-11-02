#!/usr/bin/env python3
"""Builds static JSON snapshots (data/) from Yahoo Finance public endpoints.
Runs server-side in GitHub Actions (no browser CORS). No API keys or secrets."""
import csv, io, json, os, sys, time, urllib.request, urllib.parse, concurrent.futures as cf
UA = {'User-Agent': 'Mozilla/5.0', 'Accept': '*/*'}
OUT = os.path.join(os.path.dirname(__file__), '..', 'data')
EXTRA_IN = ['RELIANCE','TCS','ITC','HDFCBANK','INFY','SBIN']
EXTRA_US = ['AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','BRK-B','NFLX','AMD']
TYPES = ('quarterlyTotalRevenue,quarterlyNetIncome,quarterlyDilutedEPS,trailingPeRatio,trailingPbRatio,'
         'trailingMarketCap,annualStockholdersEquity,annualTotalDebt,annualEBIT,annualTotalAssets,'
         'annualCurrentLiabilities,annualNetIncome,annualTotalRevenue')

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(2 * (i + 1))

def universe():
    u = []
    try:
        rows = csv.DictReader(io.StringIO(get('https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv').decode()))
        u += [(r['Symbol'].strip() + '.NS', r['Company Name'].strip(), r['Industry'].strip()) for r in rows]
    except Exception as e: print('nifty500 fail', e)
    try:
        rows = csv.DictReader(io.StringIO(get('https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv').decode()))
        u += [(r['Symbol'].strip().replace('.', '-'), r['Security'].strip(), r['GICS Sector'].strip()) for r in rows]
    except Exception as e: print('sp500 fail', e)
    have = {s for s, _, _ in u}
    u += [(s + '.NS', s, '') for s in EXTRA_IN if s + '.NS' not in have]
    u += [(s, s, '') for s in EXTRA_US if s not in have]
    if os.environ.get('LIMIT'): u = [x for x in u if x[0] in os.environ['LIMIT'].split(',')] or u[:int(os.environ['LIMIT'])]
    return u

def fetch(sym, name, sector):
    q = urllib.parse.quote(sym)
    ch = json.loads(get(f'https://query1.finance.yahoo.com/v8/finance/chart/{q}?range=5y&interval=1d&events=div'))['chart']['result'][0]
    m = ch['meta']; ts = ch.get('timestamp') or []; cl = ch['indicators']['quote'][0].get('close') or []
    hist = [[t, round(c, 2)] for t, c in zip(ts, cl) if c is not None]
    divs = [[int(k), v['amount']] for k, v in (ch.get('events', {}).get('dividends') or {}).items()]
    now = int(time.time())
    fu = json.loads(get(f'https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{q}?type={TYPES}&period1={now-6*365*86400}&period2={now+86400}'))
    fund = {}
    for r in fu['timeseries']['result']:
        t = r['meta']['type'][0]
        fund[t] = [[x['asOfDate'], x['reportedValue']['raw']] for x in (r.get(t) or []) if x and x.get('reportedValue')]
    d = {'symbol': sym, 'name': m.get('longName') or m.get('shortName') or name, 'sector': sector,
         'exchange': m.get('fullExchangeName'), 'currency': m.get('currency'),
         'price': m.get('regularMarketPrice'), 'prevClose': m.get('chartPreviousClose'),
         'priceTime': m.get('regularMarketTime'), 'hist': hist, 'divs': divs, 'fund': fund,
         'fetched': now, 'source': 'Yahoo Finance (public chart & fundamentals-timeseries endpoints)'}
    # day change from last two daily closes when available
    if len(hist) >= 2: d['prevClose'] = hist[-2][1] if abs(hist[-1][1] - (d['price'] or 0)) < 1e-6 else hist[-1][1]
    return d

def main():
    os.makedirs(os.path.join(OUT, 's'), exist_ok=True)
    u = universe(); print('universe', len(u))
    index, fails = [], []
    def job(x):
        try:
            d = fetch(*x)
            with open(os.path.join(OUT, 's', x[0] + '.json'), 'w') as f: json.dump(d, f, separators=(',', ':'))
            return [x[0], d['name'], d['exchange'] or '', x[2]]
        except Exception as e:
            fails.append(x[0]); print('fail', x[0], e); return None
    with cf.ThreadPoolExecutor(6) as ex:
        for r in ex.map(job, u):
            if r: index.append(r)
    # keep previously built symbols that failed this run
    old = os.path.join(OUT, 'index.json')
    if os.path.exists(old):
        prev = {r[0]: r for r in json.load(open(old)).get('symbols', [])}
        for s in fails:
            if s in prev and os.path.exists(os.path.join(OUT, 's', s + '.json')): index.append(prev[s])
    index.sort(key=lambda r: r[0])
    json.dump({'built': int(time.time()), 'symbols': index}, open(old, 'w'), separators=(',', ':'))
    print('ok', len(index), 'fail', len(fails))
    if len(index) < 0.5 * len(u): sys.exit(1)
main()
