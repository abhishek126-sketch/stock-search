#!/usr/bin/env python3
"""Builds static JSON snapshots (data/) from Yahoo Finance public endpoints.
Runs server-side in GitHub Actions (no browser CORS). No API keys or secrets."""
import http.cookiejar, csv, io, json, os, subprocess, sys, time, urllib.request, urllib.parse, concurrent.futures as cf
UA = {'User-Agent': 'Mozilla/5.0', 'Accept': '*/*'}
OUT = os.path.join(os.path.dirname(__file__), '..', 'data')
EXTRA_IN = ['RELIANCE','TCS','ITC','HDFCBANK','INFY','SBIN']
EXTRA_US = ['AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','BRK-B','NFLX','AMD']
TYPES = ('quarterlyTotalRevenue,quarterlyNetIncome,quarterlyDilutedEPS,trailingPeRatio,trailingPbRatio,'
         'trailingMarketCap,annualStockholdersEquity,annualTotalDebt,annualEBIT,annualTotalAssets,'
         'annualCurrentLiabilities,annualNetIncome,annualTotalRevenue,annualOperatingCashFlow,annualFreeCashFlow,'
         'annualInterestExpense,annualAccountsReceivable,annualInventory,annualDilutedEPS,annualDilutedAverageShares,'
         'annualOperatingIncome,annualCashAndCashEquivalents,annualGrossProfit,quarterlyOperatingIncome,annualCurrentAssets,annualResearchAndDevelopment,annualCapitalExpenditure')

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(2 * (i + 1))

CJ = http.cookiejar.CookieJar()
OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CJ)); OP.addheaders = list(UA.items())
CRUMB = None
PROFILE = {}
def crumb():
    global CRUMB
    if CRUMB is None:
        try:
            try: OP.open('https://fc.yahoo.com', timeout=15)
            except Exception: pass
            CRUMB = OP.open('https://query2.finance.yahoo.com/v1/test/getcrumb', timeout=15).read().decode().strip()
        except Exception as e: print('crumb fail', e); CRUMB = ''
    return CRUMB

def analysts(q):
    c = crumb()
    if not c: return None
    for i in range(5):
        try:
            r = json.loads(OP.open(f'https://query2.finance.yahoo.com/v10/finance/quoteSummary/{q}?modules=recommendationTrend,financialData,assetProfile,defaultKeyStatistics,summaryDetail,calendarEvents&crumb={urllib.parse.quote(c)}', timeout=25).read())
            break
        except Exception as e:
            if i == 4: print('analyst fail', q, e); return None
            time.sleep(3 * (i + 1))
    res = (r.get('quoteSummary') or {}).get('result') or []
    if not res: return None
    fd = res[0].get('financialData') or {}; tr = ((res[0].get('recommendationTrend') or {}).get('trend') or [])
    raw = lambda k: (fd.get(k) or {}).get('raw') if isinstance(fd.get(k), dict) else None
    a = {'key': fd.get('recommendationKey') if fd.get('recommendationKey') not in (None, 'none') else None,
         'mean': raw('recommendationMean'), 'n': raw('numberOfAnalystOpinions'),
         'tMean': raw('targetMeanPrice'), 'tHigh': raw('targetHighPrice'), 'tLow': raw('targetLowPrice'), 'tMed': raw('targetMedianPrice'),
         'currency': fd.get('financialCurrency'), 'asOf': int(time.time())}
    ap = res[0].get('assetProfile') or {}; ks = res[0].get('defaultKeyStatistics') or {}
    rk = lambda k: (ks.get(k) or {}).get('raw') if isinstance(ks.get(k), dict) else None
    PROFILE[q] = {'industry': ap.get('industry'), 'sector': ap.get('sector'), 'insiders': rk('heldPercentInsiders'),
                  'institutions': rk('heldPercentInstitutions'), 'shares': rk('sharesOutstanding'), 'bookValue': rk('bookValue'),
                  'ocfTTM': raw('operatingCashflow'), 'fcfTTM': raw('freeCashflow'), 'cash': raw('totalCash'), 'debt': raw('totalDebt'),
                  'opMargins': raw('operatingMargins'), 'profitMargins': raw('profitMargins'),
                  'beta': rk('beta') if rk('beta') is not None else ((res[0].get('summaryDetail') or {}).get('beta') or {}).get('raw'),
                  'currentRatio': raw('currentRatio'), 'revGrowth': raw('revenueGrowth'), 'earnGrowth': raw('earningsGrowth'),
                  'fwdEps': rk('forwardEps'), 'peg': rk('pegRatio'), 'grossMargins': raw('grossMargins'),
                  'summary': (ap.get('longBusinessSummary') or '')[:700] or None, 'employees': ap.get('fullTimeEmployees'),
                  'earnDates': [x.get('raw') for x in (((res[0].get('calendarEvents') or {}).get('earnings') or {}).get('earningsDate') or []) if isinstance(x, dict)],
                  'exDiv': (((res[0].get('calendarEvents') or {}).get('exDividendDate')) or {}).get('raw') if isinstance((res[0].get('calendarEvents') or {}).get('exDividendDate'), dict) else None,
                  'asOf': int(time.time())}
    t0 = next((t for t in tr if t.get('period') == '0m'), None)
    if t0 and sum(t0.get(k) or 0 for k in ('strongBuy','buy','hold','sell','strongSell')) > 0:
        a['trend'] = {k: t0.get(k) or 0 for k in ('strongBuy','buy','hold','sell','strongSell')}
    if not any(a.get(k) is not None for k in ('key','mean','n','tMean')) and 'trend' not in a: return None
    return a

LISTS = os.path.join(os.path.dirname(__file__), 'lists')
CAPS_IN = [('Large', 'ind_nifty100list.csv'), ('Mid', 'ind_niftymidcap150list.csv'),
           ('Small', 'ind_niftysmallcap250list.csv'), ('Micro', 'ind_niftymicrocap250_list.csv')]
def nse_list(fn):
    """Official NSE index constituents CSV (live; falls back to the copy committed in scripts/lists)."""
    try:
        rows = list(csv.DictReader(io.StringIO(get('https://nsearchives.nseindia.com/content/indices/' + fn).decode('utf-8-sig'))))
        if len(rows) < 50: raise ValueError('short list %d' % len(rows))
        with open(os.path.join(LISTS, fn), 'w') as fh:  # keep local copy fresh (not committed by the Action)
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    except Exception as e:
        print('nse list live fail, using committed copy', fn, e)
        rows = list(csv.DictReader(open(os.path.join(LISTS, fn), encoding='utf-8-sig')))
    return [(r['Symbol'].strip(), r['Company Name'].strip(), r['Industry'].strip()) for r in rows if (r.get('Symbol') or '').strip() and not r['Symbol'].strip().upper().startswith('DUMMY')]  # NSE placeholder rows

CAP, ETFMETA = {}, {}

# ---- Penny stocks: every NSE/BSE equity under Rs 50 that traded on the latest session (official bhavcopies) ----
PENNY, SURV = {}, {}   # sym -> {'src','series','isin','close'}; sym/ISIN -> surveillance label
NSE_PS, BSE_GRP = ('EQ', 'BE', 'BZ', 'SM', 'ST'), ('A', 'B', 'T', 'X', 'XT', 'Z', 'M', 'MT', 'MS')
def _latest(urlf, minsize=50000):
    for i in range(8):
        dt = time.gmtime(time.time() + 19800 - 86400 * i)
        try:
            raw = get(urlf(dt), tries=2)
            if len(raw) > minsize: return raw.decode('utf-8', 'ignore'), time.strftime('%Y-%m-%d', dt)
        except Exception: pass
    raise RuntimeError('no bhavcopy found')
def surveillance():
    for fn, lab in (('Long_Term_ASM.csv', 'ASM (long-term)'), ('Short_Term_ASM.csv', 'ASM (short-term)'), ('GSM.csv', 'GSM')):
        try:
            txt = get('https://nsearchives.nseindia.com/invest/content/' + fn).decode('utf-8-sig', 'ignore').replace('\r', '')
            rows = list(csv.reader(io.StringIO(txt)))
            hi = next(i for i, r in enumerate(rows) if any('SYMBOL' in c.upper() for c in r))
            hdr = [c.strip().upper() for c in rows[hi]]
            cs, ci = next(i for i, c in enumerate(hdr) if c.startswith('SYMBOL')), next((i for i, c in enumerate(hdr) if c.startswith('ISIN')), None)
            cg = next((i for i, c in enumerate(hdr) if 'STAGE' in c), None)
            n = 0
            for r in rows[hi + 1:]:
                if len(r) <= cs or not r[cs].strip() or r[cs].startswith('-'): continue
                st = r[cg].strip() if cg is not None and len(r) > cg else ''
                l = lab + (' ' + st if st else ''); n += 1
                for k in filter(None, (r[cs].strip() + '.NS', r[ci].strip() if ci is not None and len(r) > ci else '')):
                    SURV[k] = SURV[k] + ' + ' + l if k in SURV and l not in SURV[k] else l
            print('surveillance', fn, n)
        except Exception as e: print('surveillance fail', fn, str(e)[:80])
BSEX = {}
def penny(have):  # penny stocks + every other NSE mainboard (EQUITY_L) and active BSE-only equity not in the index lists
    out = []
    try:
        surveillance()
        eq = {}
        try:
            for r in csv.DictReader(io.StringIO(get('https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv').decode('utf-8-sig', 'ignore'))):
                r = {k.strip(): (v or '').strip() for k, v in r.items() if k}; eq[r.get('SYMBOL')] = (r.get('NAME OF COMPANY'), r.get('ISIN NUMBER'))
        except Exception as e: print('EQUITY_L fail', e)
        raw, dn = _latest(lambda t: 'https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_' + time.strftime('%d%m%Y', t) + '.csv')
        nse_isin, nn, no = {i for _, i in eq.values() if i}, 0, 0
        for r in csv.DictReader(io.StringIO(raw)):
            r = {k.strip(): (v or '').strip() for k, v in r.items() if k}
            nm, isin = eq.get(r['SYMBOL'], (None, None)); isin and nse_isin.add(isin)
            if r['SERIES'] not in NSE_PS: continue
            try: c, v = float(r['CLOSE_PRICE']), int(float(r['TTL_TRD_QNTY'] or 0))
            except ValueError: continue
            sym = r['SYMBOL'] + '.NS'
            if v <= 0 or sym in PENNY: continue
            if c >= 50 and r['SERIES'] not in ('EQ', 'BE', 'BZ'): continue  # SME boards only as penny (unchanged)
            if c >= 50:  # not an index member and not penny: still cover it (new IPOs, non-index stocks) as 'Other'
                if sym not in have: have.add(sym); CAP[sym] = 'Other'; out.append((sym, nm or r['SYMBOL'], '')); no += 1
                continue
            PENNY[sym] = {'src': 'NSE', 'series': r['SERIES'], 'isin': isin, 'close': c, 'date': dn}
            if sym not in have: have.add(sym); CAP[sym] = 'Penny'; out.append((sym, nm or r['SYMBOL'], '')); nn += 1
        raw, db = _latest(lambda t: 'https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_' + time.strftime('%Y%m%d', t) + '_F_0000.CSV')
        nb, nob = 0, 0
        for r in csv.DictReader(io.StringIO(raw)):
            if r.get('FinInstrmTp') != 'STK' or r.get('SctySrs') not in BSE_GRP or r.get('ISIN') in nse_isin: continue
            try: c, v = float(r['ClsPric']), int(float(r['TtlTradgVol'] or 0))
            except ValueError: continue
            sym = r['TckrSymb'].strip() + '.BO'
            if v <= 0 or sym in have: continue
            if c >= 50:
                have.add(sym); CAP[sym] = 'Other'; BSEX[sym] = {'isin': r['ISIN'], 'code': (r.get('FinInstrmId') or '').strip()}; out.append((sym, r['FinInstrmNm'].strip().title(), '')); nob += 1; continue
            have.add(sym); CAP[sym] = 'Penny'; PENNY[sym] = {'src': 'BSE', 'series': r['SctySrs'], 'isin': r['ISIN'], 'close': c, 'date': db, 'code': (r.get('FinInstrmId') or '').strip()}
            out.append((sym, r['FinInstrmNm'].strip().title(), '')); nb += 1
        # NSE mainboard listings (EQUITY_L) with no trade in the latest session (e.g. listed today): add so search finds them
        for sy, (nm, isin) in eq.items():
            if sy and sy + '.NS' not in have: have.add(sy + '.NS'); CAP[sy + '.NS'] = 'Other'; out.append((sy + '.NS', nm or sy, '')); no += 1
        print('other (non-index, >= Rs 50) NSE', no, 'BSE-only', nob)
        print('penny NSE', nn, 'BSE-only', nb, 'already covered', sum(1 for k in PENNY if CAP.get(k) != 'Penny'), 'bhav', dn, db)
    except Exception as e: print('penny fail', e)
    return out
def universe():
    u, have = [], set()
    for cap, fn in CAPS_IN:  # NIFTY 100 / Midcap 150 / Smallcap 250 (= NIFTY 500) + Microcap 250; first tag wins
        try: lst = nse_list(fn)
        except Exception as e: print('list fail', fn, e); continue
        for sym, name, ind in lst:
            s = sym + '.NS'
            if s in have: continue
            have.add(s); CAP[s] = cap; u.append((s, name, ind))
    print('IN by cap', {c: sum(1 for v in CAP.values() if v == c) for c, _ in CAPS_IN})
    try:  # anything else in NIFTY 500 not covered above (normally none)
        for sym, name, ind in nse_list('ind_nifty500list.csv'):
            if sym + '.NS' not in have: have.add(sym + '.NS'); u.append((sym + '.NS', name, ind))
    except Exception as e: print('nifty500 fail', e)
    try:
        rows = csv.DictReader(io.StringIO(get('https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv').decode()))
        for r in rows:
            s = r['Symbol'].strip().replace('.', '-')
            if s not in have: have.add(s); CAP[s] = 'US'; u.append((s, r['Security'].strip(), r['GICS Sector'].strip()))
    except Exception as e: print('sp500 fail', e)
    u += [(s + '.NS', s, '') for s in EXTRA_IN if s + '.NS' not in have]
    # ---- ETFs: all NSE-listed ETFs (official eq_etfseclist.csv) + curated major US ETFs ----
    try:
        try:
            raw = get('https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv').decode('utf-8-sig')
            if raw.count('\n') < 50: raise ValueError('short')
            open(os.path.join(LISTS, 'eq_etfseclist.csv'), 'w').write(raw)
        except Exception as e:
            print('etf list live fail, using committed copy', e); raw = open(os.path.join(LISTS, 'eq_etfseclist.csv'), encoding='utf-8-sig').read()
        for r in csv.DictReader(io.StringIO(raw)):
            r = {k.strip(): (v or '').strip() for k, v in r.items() if k}
            sym = r.get('Symbol', '') + '.NS'
            if sym == '.NS' or sym in have: continue
            have.add(sym); CAP[sym] = 'ETF-IN'
            ETFMETA[sym] = {'underlying': r.get('Underlying Key') or r.get('Underlying Asset'), 'assetClass': (r.get('ETF Underlying') or '').title(), 'isin': r.get('ISINNumber'), 'listed': r.get('DateofListing')}
            u.append((sym, r.get('Underlying Asset') or r['Symbol'], 'ETF'))
    except Exception as e: print('india etf fail', e)
    for t in open(os.path.join(LISTS, 'us_etfs.txt')).read().split('\n', 1)[1].split():
        if t not in have: have.add(t); CAP[t] = 'ETF-US'; u.append((t, t, 'ETF'))
    print('ETFs', sum(1 for v in CAP.values() if v == 'ETF-IN'), sum(1 for v in CAP.values() if v == 'ETF-US'))
    u += [(s, s, '') for s in EXTRA_US if s not in have]
    u += penny(have)
    if os.environ.get('LIMIT'): u = [x for x in u if x[0] in os.environ['LIMIT'].split(',')] or u[:int(os.environ['LIMIT'])]
    return u

import re, statistics, email.utils, xml.etree.ElementTree as ET
NEG = r"\b(fraud|probe[sd]?|sebi (order|notice|penal\w*|bans?|action)|show.?cause|downgrad\w*|default\w*|resign\w*|quits?|pledg\w*|raids?|penalt\w*|fined?|loss(es)?|plunges?|slump\w*|crash\w*|tumbl\w*|lawsuits?|sued|scam|insolven\w*|bankrupt\w*|investigat\w*|cbi|forensic|whistle.?blow\w*|recalls?|warning letter|layoffs?|strikes?|shutdown|delist\w*|qualified opinion|auditor resign\w*|misconduct|violations?|antitrust|bans?|slash\w*|cuts? (target|guidance|rating|forecast))\b"
ORD = r"\b(orders?|order (win|inflow)s?|bags?|bagged|wins? (contract|order|deal)s?|secures?|secured|contracts?|deal (worth|with)|awarded|letter of (award|intent)|loa|empanel\w*|tenders?|supply agreement|partnership|mou|acquires?|acquisition)\b"
# court cases / legal & regulatory matters in headlines (kept even when not otherwise tagged — see news())
LEGAL = r"\b(court|high court|supreme court|tribunal|nclt|nclat|arbitra\w*|litigation|lawsuits?|petitions?|writ|disputes?|demand notice|tax demand|gst (demand|notice)|show.?cause|penalt\w*|sebi (order|notice|probe)|enforcement directorate|cbi|fir|insolven\w*|verdict|judgm?ents?|rulings?|stay order|contempt|quash\w*|summons?|charge.?sheet\w*)\b"
PLAN = r"\b(expan\w*|capex|new plant|capacity|launch\w*|guidance|outlook|plans? to|to invest|invest\w* (rs|₹|\$|inr|usd)|ipo|demerger|fund.?rais\w*|qip|roadmap|strategy|greenfield|brownfield|foray\w*|ramp.?up|raises? (guidance|outlook|forecast)|new (product|facility|factory|unit)|enters?|entering)\b"
def clean_name(n):
    n = re.sub(r'\b(limited|ltd\.?|inc\.?|incorporated|corporation|corp\.?|company|co\.|plc|holdings?|\(the\))\s*', ' ', n, flags=re.I)
    return re.sub(r'[,.&]+$', '', re.sub(r'\s+', ' ', n)).strip()
def news(sym, name):
    india = sym.endswith('.NS'); cn = clean_name(name)
    qq = f'"{cn}"' + ('' if india else ' stock') + ' when:90d'
    url = 'https://news.google.com/rss/search?' + urllib.parse.urlencode({'q': qq, 'hl': 'en-IN' if india else 'en-US', 'gl': 'IN' if india else 'US', 'ceid': 'IN:en' if india else 'US:en'})
    try: root = ET.fromstring(get(url, tries=3))
    except Exception as e: print('news fail', sym, e); return None
    items = []
    for it in root.findall('.//item'):
        t = (it.findtext('title') or '').strip(); src = it.findtext('source') or ''
        if src and t.endswith(' - ' + src): t = t[: -len(src) - 3]
        try: ts = int(email.utils.parsedate_to_datetime(it.findtext('pubDate')).timestamp())
        except Exception: continue
        lt = t.lower(); tags = [k for k, rx in (('neg', NEG), ('ord', ORD), ('plan', PLAN), ('legal', LEGAL)) if re.search(rx, lt)]
        items.append({'t': t, 's': src, 'd': ts, 'u': it.findtext('link'), 'g': tags})
    items.sort(key=lambda x: -x['d'])
    keep = [x for x in items if x['g']][:20]
    keep += [x for x in items if 'legal' in x['g'] and x not in keep][:8]     # court / legal headlines are never crowded out
    gen = [x for x in items if not x['g']][:8]
    return {'q': qq, 'items': sorted(keep + gen, key=lambda x: -x['d']), 'asOf': int(time.time()), 'source': 'Google News RSS'}

def series(f, k): return f.get(k) or []
def last(a): return a[-1] if a else None
def days(a, b): return abs((time.mktime(time.strptime(a, '%Y-%m-%d')) - time.mktime(time.strptime(b, '%Y-%m-%d'))) / 86400)
def sma(c, n): return sum(c[-n:]) / n if len(c) >= n else None   # same mean as indicators.js sma (index snapshots only)
def price_at(hist, t):
    p = None
    for ts, c in hist:
        if ts <= t: p = c
        else: break
    return p
def cagr(a):
    if len(a) < 2: return None
    x, y, n = a[0][1], a[-1][1], days(a[-1][0], a[0][0]) / 365.25
    return (y / x) ** (1 / n) - 1 if x > 0 and y > 0 and n >= 0.9 else None

def fix_stale_price(d):
    """Yahoo's chart 'regularMarketPrice' is sometimes frozen at an old value while the daily closes are current
    (e.g. TGL.NS on 9 Nov 2026: ₹472.10 dated Jul while the daily closes and NSE showed ~₹10). If the quote is more
    than 3 days older than the latest daily bar, use that bar instead. Returns 1 when it changed something."""
    h, pt = d.get('hist') or [], d.get('priceTime') or 0
    if not h or not isinstance(h[-1][1], (int, float)) or pt >= h[-1][0] - 3 * 86400: return 0
    print('stale price', d.get('symbol'), d.get('price'), '@', pt, '-> last close', h[-1][1], '@', h[-1][0])
    d['price'], d['priceTime'] = h[-1][1], h[-1][0]; d['staleFixed'] = True
    if len(h) >= 2: d['prevClose'] = h[-2][1]
    return 1

def nse_bhavcopy():
    """Latest official NSE end-of-day file (sec_bhavdata_full, published in the evening after the 15:30 close).
    Returns (date, {SYMBOL: (close, prev_close, open, high, low, volume)}) or (None, {}). Tries today, then up to 7
    earlier days. open / high / low / volume are None when missing."""
    import datetime as dt
    ist = dt.timezone(dt.timedelta(hours=5, minutes=30)); today = dt.datetime.now(ist).date()
    for back in range(8):
        day = today - dt.timedelta(days=back)
        try: raw = get('https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_%s.csv' % day.strftime('%d%m%Y'), tries=2).decode()
        except Exception: continue
        rows, td = {}, None
        for r in csv.DictReader(io.StringIO(raw), skipinitialspace=True):
            r = {k.strip(): (v or '').strip() for k, v in r.items() if k}
            if td is None: td = trade_date(r.get('DATE1'), '%d-%b-%Y')
            if r.get('SERIES') not in ('EQ', 'BE', 'BZ', 'SM', 'ST'): continue
            try: rows[r['SYMBOL']] = (float(r['CLOSE_PRICE']), float(r['PREV_CLOSE']), fnum(r.get('OPEN_PRICE')), fnum(r.get('HIGH_PRICE')), fnum(r.get('LOW_PRICE')), fnum(r.get('TTL_TRD_QNTY')))
            except (KeyError, ValueError): pass
        if len(rows) > 500: return td or day, rows
    return None, {}

def fnum(v):
    try: x = float(str(v).replace(',', '').strip()); return x if x == x else None
    except (TypeError, ValueError): return None

def trade_date(v, fmt):
    """The session date written inside an exchange end-of-day file. On a holiday NSE still publishes a file named for
    that day holding the previous session (sec_bhavdata_full_10112026.csv had DATE1 09-Nov-2026 on the Diwali
    Balipratipada holiday), so the file name must not be taken as the trading day."""
    import datetime as dt
    try: return dt.datetime.strptime((v or '').strip(), fmt).date()
    except ValueError: return None

def bse_bhavcopy():
    """Latest official BSE end-of-day file (UDiFF BhavCopy_BSE_CM, published in the evening).
    Returns (date, {TckrSymb: (close, prev_close)}) or (None, {}). Tries today, then up to 7 earlier days."""
    import datetime as dt
    ist = dt.timezone(dt.timedelta(hours=5, minutes=30)); today = dt.datetime.now(ist).date()
    for back in range(8):
        day = today - dt.timedelta(days=back)
        try: raw = get('https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_%s_F_0000.CSV' % day.strftime('%Y%m%d'), tries=2).decode('utf-8', 'ignore')
        except Exception: continue
        rows, td = {}, None
        for r in csv.DictReader(io.StringIO(raw)):
            if td is None: td = trade_date(r.get('TradDt'), '%Y-%m-%d')
            if (r.get('FinInstrmTp') or '').strip() != 'STK': continue
            try: rows[(r.get('TckrSymb') or '').strip()] = (float(r['ClsPric']), float(r.get('PrvsClsgPric') or 0) or None, fnum(r.get('OpnPric')), fnum(r.get('HghPric')), fnum(r.get('LwPric')), fnum(r.get('TtlTradgVol')))
            except (KeyError, ValueError, TypeError): pass
        if len(rows) > 500: return td or day, rows
    return None, {}

def apply_exchange_close(docs, ex):
    """After the close, every NSE stock (.NS) gets NSE's official closing price and every BSE-only stock (.BO) gets
    BSE's, before metrics and scores are computed. Only applied when the exchange file is for the same session as (or
    a later session than) Yahoo's latest daily bar, so a morning run never overwrites a newer Yahoo session."""
    import datetime as dt
    ist = dt.timezone(dt.timedelta(hours=5, minutes=30))
    day, B = nse_bhavcopy() if ex == 'NSE' else bse_bhavcopy()
    sfx = '.NS' if ex == 'NSE' else '.BO'
    if not day: print(ex, 'closing file not available - prices stay Yahoo'); return None, 0
    t_close = int(dt.datetime.combine(day, dt.time(15, 30), ist).timestamp()); t_bar = int(dt.datetime.combine(day, dt.time(9, 15), ist).timestamp())
    n = moved = 0
    for s, d in docs.items():
        # ETFs too (until 13 Nov 2026 they kept Yahoo's price: NV20.NS showed 12,353.60 vs NSE's 14.55)
        if not s.endswith(sfx) or s[:-3] not in B: continue
        close, pcl = B[s[:-3]][:2]; xo, xh, xl, xv = (list(B[s[:-3]][2:6]) + [None] * 4)[:4]; h = d.get('hist') or []
        if not close or close <= 0: continue
        lastday = dt.datetime.fromtimestamp(h[-1][0], ist).date() if h else None
        if lastday and lastday > day: continue                      # Yahoo already has a newer session
        if h and lastday == day: h[-1] = [h[-1][0], round(close, 2)]
        else: h.append([t_bar, round(close, 2)])
        oh = d.get('ohlc') or []                                        # keep the OHLC bars in step with the official close
        # the exchange file's own open / high / low / traded quantity: used when Yahoo has no candle for the session (or only
        # a flat placeholder). From GitHub, Yahoo's daily series lacked 11 Nov 2026 for ~4,400 stocks while the quote was
        # current; a flat zero-volume bar then broke ranges, volume ratios and swing / plan levels.
        exb = [t_bar, round(xo, 2), round(max(xh, close), 2), round(min(xl, close), 2), round(close, 2), int(xv)] if xo and xh and xl and xv is not None and 0 < xl <= xh else None
        if oh and dt.datetime.fromtimestamp(oh[-1][0], ist).date() == day:
            b = oh[-1]
            if exb and (not b[5] or b[2] == b[3]): oh[-1] = [b[0]] + exb[1:]; d.pop('ohlcPartial', None)
            else: oh[-1] = [b[0], b[1], round(max(b[2], close), 2), round(min(b[3], close), 2), round(close, 2), b[5]]
        elif oh and dt.datetime.fromtimestamp(oh[-1][0], ist).date() < day:
            if exb: oh.append(exb); d.pop('ohlcPartial', None)
            else: oh.append([t_bar, round(close, 2), round(close, 2), round(close, 2), round(close, 2), 0]); d['ohlcPartial'] = 1
        if isinstance(d.get('price'), (int, float)) and d['price'] and abs(d['price'] / close - 1) > 0.01: moved += 1
        d['price'], d['priceTime'] = close, t_close
        if pcl: d['prevClose'] = pcl
        e = d.get('etf')
        if isinstance(e, dict) and e.get('nav') and e.get('navDate') not in (None, 'Yahoo'):   # premium on the official close (same day as the NAV)
            try:
                if dt.datetime.strptime(e['navDate'], '%d-%b-%Y').date() == day: e['prem'] = close / e['nav'] - 1
            except Exception: pass
        d['exClose'] = {'ex': ex, 'day': day.isoformat()}; n += 1
    print(ex, 'official close applied to', n, 'stocks for', day, '-', moved, 'of them differed from Yahoo by > 1%')
    return day.isoformat(), n

def nse_fin(d, s):
    """Official results for NSE stocks: replace Yahoo's quarterly / annual sales, net profit and EPS with the figures
    read from the company's own NSE results filings (scripts/results.js -> data/x/<SYM>.json 'pr'), so the quarterly
    table, EPS, P/E, growth, ROE and CANSLIM use them. Profit = attributable to shareholders, consolidated where filed;
    EPS restated for bonus issues / splits. Yahoo stays where NSE has fewer than 2 periods. Matched Screener on 18 test
    stocks (latest-quarter sales 16/18 within 1%, TTM EPS 17/18 within 5%; 10 Nov 2026)."""
    f = d.get('fund')
    if not s.endswith('.NS') or not isinstance(f, dict): return
    try: xd = json.load(open(os.path.join(OUT, 'x', s + '.json'))); pr = xd.get('pr') or {}
    except Exception: return
    # official share count from the latest shareholding-pattern filing (build_corp.py inst rows [q, fii, dii, shares]),
    # used for market cap in metrics() and for the EPS share check below; only when the filing is under ~7 months old
    shs = [r for r in (xd.get('inst') or []) if isinstance(r, list) and len(r) > 3 and isinstance(r[3], (int, float)) and r[3] > 0]
    if shs and time.time() - time.mktime(time.strptime(shs[-1][0], '%Y-%m-%d')) < 210 * 86400: d['sharesNSE'] = [shs[-1][0], shs[-1][3]]
    else: d.pop('sharesNSE', None)
    q = good_quarters([list(r) for r in (pr.get('q') or []) if isinstance(r, list) and len(r) >= 4])
    a = [list(r) for r in (pr.get('fy') or []) if isinstance(r, list) and len(r) >= 4][-4:]   # last 4 years, as Yahoo gives (growth = 3-year rate)
    # EPS on today's share count: a filing's EPS can be off from profit ÷ shares (bonus / split / new shares not yet in it,
    # or a unit slip — e.g. JNKINDIA ×2, CEATLTD ×4, JSWDULUX ×10 on 10 Nov 2026), which made the P/E far too low.
    # Shares now = Yahoo market cap ÷ the price on that date. When a period's filed EPS implies a share count more than
    # 25% away from it, EPS = profit ÷ shares now (P/E then equals market cap ÷ TTM profit, as Screener shows it).
    sh, mc = (d['sharesNSE'][1] if d.get('sharesNSE') else None), last(series(f, 'trailingMarketCap'))
    if not sh and mc and mc[1] and d.get('hist'):
        pa = price_at(d['hist'], time.mktime(time.strptime(mc[0], '%Y-%m-%d')) + 86400)
        if pa: sh = mc[1] / pa
    # Only when the latest quarter itself is off: older periods were already put on the latest filing's share count by
    # results.js, so a genuine share issue years ago is left as filed.
    nadj, off = 0, lambda r: isinstance(r[1], (int, float)) and r[1] != 0 and isinstance(r[3], (int, float)) and not (abs(r[3]) >= 0.05 and 0.8 <= (r[1] / r[3]) / sh <= 1.25)
    if sh and sh > 0 and q and off(q[-1]):
        for r in q + a:
            np_, e = r[1], r[3]
            if isinstance(np_, (int, float)) and isinstance(e, (int, float)) and np_ != 0:
                k = (np_ / e) / sh if abs(e) >= 0.05 else 0
                if not 0.8 <= k <= 1.25: r[3] = round(np_ / sh, 2); nadj += 1
    used = []
    for key, rows, i in (('quarterlyNetIncome', q, 1), ('quarterlyTotalRevenue', q, 2), ('quarterlyDilutedEPS', q, 3),
                         ('annualNetIncome', a, 1), ('annualTotalRevenue', a, 2), ('annualDilutedEPS', a, 3)):
        v = sorted([r[0], r[i]] for r in rows if isinstance(r[i], (int, float)))
        if len(v) >= 2: f[key] = v; used.append(key)
    # shareholders' equity from the filings' balance sheets (results.js pr.eq rows [date, eq], last 4 half-years):
    # replaces Yahoo's figure on the same year-end dates (ROE) - Yahoo's bank equity includes minority holders of
    # subsidiaries (HDFCBANK Mar-2026 8.17 lakh Cr vs 5.82 filed; ROE 8.9% vs Screener 13.6%) - and the latest one
    # gives book value for P/B in metrics(). Only dates Yahoo already has, so ROCE / D/E keep matching year-ends.
    eqr = [r for r in (pr.get('eq') or []) if isinstance(r, list) and len(r) == 2 and isinstance(r[1], (int, float)) and r[1] > 0]
    if eqr:
        d['eqNSE'] = eqr[-1]; fe = dict(eqr); ye = series(f, 'annualStockholdersEquity')
        if ye and any(t in fe for t, _ in ye): f['annualStockholdersEquity'] = [[t, fe.get(t, v)] for t, v in ye]; used.append('annualStockholdersEquity')
    else: d.pop('eqNSE', None)
    if used: d['fundNSE'] = {'b': pr.get('b'), 'qe': pr.get('qe'), 'keys': used, **({'epsSh': nadj} if nadj else {})}
    else: d.pop('fundNSE', None)

def good_quarters(q):
    """Drops quarters whose sales are far out of line with the company's other quarters — a misread filing (HATSUN
    Jun-2025 ₹46,599 Cr vs ~₹2,500 Cr; COROMANDEL Mar-2026 ₹60 Cr vs ~₹8,000 Cr). Rule: sales > 8x the median quarter,
    or (median ≥ ₹20 Cr) under 1/8 of it. Negative sales (investment companies) are left alone. Same rule in momentum.js."""
    rv = sorted(r[2] for r in q if isinstance(r[2], (int, float)) and r[2] > 0)
    if len(rv) < 4: return q
    m = rv[len(rv) // 2]
    return [r for r in q if not (isinstance(r[2], (int, float)) and r[2] > 0 and (r[2] > 8 * m or (m >= 2e8 and r[2] < m / 8)))]

def promoter_fields(s, pr):
    """Promoter holding & pledge for the summary row (Score filter), from data/x/<SYM>.json written by build_corp.py.
    pro = latest promoter % (NSE shareholding pattern), proCh = change vs ~1 year earlier (pts), proQ = quarter end;
    pp = % of promoter shares pledged, plz = 1 when NSE shows no pledge, plu = 1 when pledge unknown;
    proY = Yahoo 'insiders' % (approximation, used for BSE-only stocks or when NSE data is missing)."""
    o = {}
    if not s.endswith(('.NS', '.BO')): return o
    try: x = json.load(open(os.path.join(OUT, 'x', s + '.json')))
    except Exception: x = {}
    p = x.get('prom') or []
    if p:
        o['pro'] = round(p[-1][1], 2); o['proQ'] = p[-1][0]
        if len(p) >= 2: o['proCh'] = round(p[-1][1] - p[max(0, len(p) - 5)][1], 2)
    pl = x.get('pledge') or {}
    if isinstance(pl.get('pp'), (int, float)): o['pp'] = round(pl['pp'], 2)
    elif pl.get('none'): o['plz'] = 1
    else: o['plu'] = 1
    if 'pro' not in o and isinstance(pr.get('insiders'), (int, float)): o['proY'] = round(pr['insiders'] * 100, 2)
    # FII / DII from the shareholding-pattern XBRL: fii = latest %, fiiCh = change vs the earliest of up to 5 quarters (~1 year), fiiN = quarters
    for key, i in (('fii', 1), ('dii', 2)):
        q = [r for r in (x.get('inst') or []) if len(r) > i and isinstance(r[i], (int, float))]
        if q:
            o[key] = round(q[-1][i], 2); o[key + 'Q'] = q[-1][0]
            if len(q) >= 2: o[key + 'Ch'] = round(q[-1][i] - q[0][i], 2); o[key + 'N'] = len(q)
    return o

def metrics(d):
    f, price, hist = d['fund'], d['price'], d['hist']; now = hist[-1][0] if hist else time.time(); k = {}
    eps = series(f, 'quarterlyDilutedEPS')[-4:]
    # Yahoo-only stocks (no NSE results read yet): one quarter whose EPS is far off profit / shares while the other three
    # agree is a Yahoo slip -> profit / shares (MOBIKWIK Sep-2026 0.75 vs 1.52; TTM 2.80 vs Screener/Groww 3.54)
    if len(eps) == 4 and 'quarterlyDilutedEPS' not in ((d.get('fundNSE') or {}).get('keys') or []):
        ni, sh = dict(series(f, 'quarterlyNetIncome')), (d['sharesNSE'][1] if d.get('sharesNSE') else None)
        if not sh:
            mc = last(series(f, 'trailingMarketCap'))
            pa = price_at(hist, time.mktime(time.strptime(mc[0], '%Y-%m-%d')) + 86400) if mc and mc[1] and hist else None
            if pa: sh = mc[1] / pa
        if sh and sh > 0:
            ok = lambda e, n: isinstance(n, (int, float)) and abs(e) >= 0.05 and 0.8 <= (n / e) / sh <= 1.25
            good = [ok(e, ni.get(t)) for t, e in eps]
            if sum(good) == 3: eps = [[t, e] if g or not isinstance(ni.get(t), (int, float)) else [t, round(ni[t] / sh, 2)] for (t, e), g in zip(eps, good)]
    if len(eps) == 4 and all(75 < days(eps[i][0], eps[i-1][0]) < 105 for i in range(1, 4)): k['eps'] = sum(x[1] for x in eps)
    if k.get('eps') and k['eps'] > 0 and price: k['pe'] = price / k['eps']
    elif last(series(f, 'trailingPeRatio')): k['pe'] = last(series(f, 'trailingPeRatio'))[1]
    for key, src in (('pb', 'trailingPbRatio'), ('mcap', 'trailingMarketCap')):
        x = last(series(f, src))
        if x:
            pa = price_at(hist, time.mktime(time.strptime(x[0], '%Y-%m-%d')) + 86400)
            k[key] = x[1] * price / pa if pa and price else x[1]
    # official share count (NSE shareholding filing); a bonus / split after that quarter-end would make it stale, so it
    # is used only within 1.5x of Yahoo's figure (Yahoo kept otherwise)
    if d.get('sharesNSE') and price:
        m2 = price * d['sharesNSE'][1]
        if not k.get('mcap') or 0.67 < m2 / k['mcap'] < 1.5: k['mcap'] = m2
    # P/B on the latest balance sheet filed with NSE (half-year), as Screener / Groww show it; Yahoo's lags share issues
    # and IPOs (COFORGE equity 9,538 -> 22,362 Cr in Sep-2026: P/B 9.3 vs 4.06) and is off for banks (HDFCBANK 1.48 vs 2.04)
    eqn = d.get('eqNSE')
    if eqn and k.get('mcap') and time.time() - time.mktime(time.strptime(eqn[0], '%Y-%m-%d')) < 240 * 86400: k['pb'] = k['mcap'] / eqn[1]
    ni, eq, debt, ebit, ta, cl = (last(series(f, t)) for t in ('annualNetIncome', 'annualStockholdersEquity', 'annualTotalDebt', 'annualEBIT', 'annualTotalAssets', 'annualCurrentLiabilities'))
    eqs = series(f, 'annualStockholdersEquity')
    if ni and eq and eq[1] > 0:
        avg = (eq[1] + eqs[-2][1]) / 2 if len(eqs) > 1 and eqs[-2][1] > 0 else eq[1]; k['roe'] = ni[1] / avg
    # Yahoo omits debt for debt-free companies: no debt figures at all, or the latest year missing after a 0 year -> 0
    nodebt = not series(f, 'annualTotalDebt') or bool(debt and eq and debt[1] == 0 and debt[0] < eq[0])
    dbt = debt[1] if debt and eq and debt[0] == eq[0] else 0.0 if nodebt else None
    if ebit and eq and dbt is not None and ebit[0] == eq[0] and eq[1] + dbt > 0:
        # ROCE = EBIT / average capital employed, capital employed = shareholders' equity + borrowings (this and last year),
        # as Screener does. (The old total assets - current liabilities version left out short-term borrowings and
        # overstated companies like Titan 45% vs Screener 21%; checked on 23 stocks, 10 Nov 2026.) EBIT = PBT + interest.
        eqd, dbd = dict(eqs), dict(series(f, 'annualTotalDebt'))
        prv = sorted(d_ for d_ in eqd if d_ < eq[0] and (d_ in dbd or nodebt))
        ce = eq[1] + dbt
        if prv and eqd[prv[-1]] + dbd.get(prv[-1], 0.0) > 0: ce = (ce + eqd[prv[-1]] + dbd.get(prv[-1], 0.0)) / 2
        k['roce'] = ebit[1] / ce
    if debt and eq and eq[1] > 0 and debt[0] == eq[0]: k['de'] = debt[1] / eq[1]
    k['revG'] = cagr(series(f, 'annualTotalRevenue')); k['niG'] = cagr(series(f, 'annualNetIncome'))
    p1 = price_at(hist, now - 365 * 86400)
    if p1 and hist[0][0] < now - 360 * 86400: k['r1y'] = price / p1 - 1
    p6 = price_at(hist, now - 182 * 86400)
    if p6 and hist[0][0] < now - 180 * 86400: k['r6m'] = price / p6 - 1
    p3 = price_at(hist, now - 91 * 86400)
    if p3: k['r3m'] = price / p3 - 1
    return {a: (round(b, 4) if isinstance(b, float) else b) for a, b in k.items() if b is not None}

def idx_stats(sym):
    ch = json.loads(get(f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range=2y&interval=1d'))['chart']['result'][0]
    c = [x for x in ch['indicators']['quote'][0]['close'] if x is not None]; ts = [t for t, x in zip(ch['timestamp'], ch['indicators']['quote'][0]['close']) if x is not None]
    return {'symbol': sym, 'price': c[-1], 'dma50': sma(c, 50), 'dma200': sma(c, 200), 'r1y': c[-1] / price_at(list(zip(ts, c)), ts[-1] - 365 * 86400) - 1,
            'r6m': c[-1] / price_at(list(zip(ts, c)), ts[-1] - 182 * 86400) - 1, 'hist': [[t, round(x, 2)] for t, x in zip(ts, c)][-260:], 'asOf': ts[-1]}

def canslim(d, k, mkt, rsr):
    f, price, hist = d['fund'], d['price'], d['hist']; o = {}
    def g(a, b): return (a - b) / abs(b) if a is not None and b not in (None, 0) else None
    # C
    qe = series(f, 'quarterlyDilutedEPS')
    c = None
    if qe:
        lq = qe[-1]; py = next((x for x in qe[:-1] if 350 <= days(lq[0], x[0]) <= 380), None)
        if py and py[1] > 0: c = g(lq[1], py[1])
    o['C'] = {'s': 'na' if c is None else 'pass' if c >= 0.25 else 'fail', 'v': c, 'why': f'Latest quarter EPS YoY {c*100:+.0f}% (needs ≥ +25%)' if c is not None else 'Need latest quarter EPS and the same quarter a year earlier (positive) — not available'}
    # A
    ae = series(f, 'annualDilutedEPS'); a = cagr(ae[-4:]) if len(ae) >= 3 else None
    up = all(ae[i][1] > ae[i-1][1] for i in range(1, len(ae))) if len(ae) >= 3 else None
    o['A'] = {'s': 'na' if a is None else 'pass' if a >= 0.25 and up else 'fail', 'v': a, 'why': f'Annual EPS CAGR {a*100:+.0f}% over {len(ae)} fiscal years{", rising every year" if up else ", not rising every year"} (needs ≥ +25%/yr)' if a is not None else 'Need ≥3 years of positive annual EPS — not available'}
    # N
    yr = [x[1] for x in hist if x[0] >= hist[-1][0] - 365 * 86400] if hist else []
    if len(yr) > 150:
        hi = max(yr + ([d['hl52'][0]] if d.get('hl52') else [])); dist = price / hi - 1   # intraday 52-week high when known
        o['N'] = {'s': 'pass' if dist >= -0.15 else 'fail', 'v': dist, 'why': f'{-dist*100:.0f}% below 52-week high (needs within 15%; O\'Neil also wants a new product/catalyst — check news)'}
    else: o['N'] = {'s': 'na', 'why': 'Less than 1 year of price history'}
    # S
    vs = d.get('vol'); sh = series(f, 'annualDilutedAverageShares'); dil = g(sh[-1][1], sh[-2][1]) if len(sh) > 1 else None
    if vs and vs.get('udr') is not None:
        ok = vs['udr'] > 1 and (dil is None or dil <= 0.02)
        o['S'] = {'s': 'pass' if ok else 'fail', 'v': vs['udr'], 'why': f'50-day up/down volume ratio {vs["udr"]:.2f} (needs > 1 = accumulation)' + (f'; share count {dil*100:+.1f}% last FY' if dil is not None else '; share-count change n/a')}
    else: o['S'] = {'s': 'na', 'why': 'Volume data not available'}
    # L
    r = rsr.get(d['symbol'])
    o['L'] = {'s': 'na' if r is None else 'pass' if r >= 80 else 'fail', 'v': r, 'why': f'Relative-strength rank {r:.0f}/99 vs {"NIFTY 500" if d["symbol"].endswith(".NS") else "S&P 500"} stocks in this app (weighted 3/6/12-month return; needs ≥ 80)' if r is not None else 'Not enough price history'}
    # I
    pr = PROFILE.get(urllib.parse.quote(d['symbol'])) or {}; inst = pr.get('institutions')
    o['I'] = {'s': 'na' if inst is None else 'pass' if 0.2 <= inst <= 0.95 else 'fail', 'v': inst, 'why': f'Institutions hold {inst*100:.0f}% (Yahoo; wants meaningful sponsorship ≥ 20%)' if inst is not None else 'Institutional holding not available'}
    # M
    m = mkt.get('IN' if d['symbol'].endswith('.NS') else 'US')
    if m and m.get('dma50') and m.get('dma200'):
        a1, a2 = m['price'] > m['dma50'], m['dma50'] > m['dma200']
        o['M'] = {'s': 'pass' if a1 and a2 else 'fail', 'why': f'{"NIFTY 50" if m["symbol"] == "^NSEI" else "S&P 500"} {"above" if a1 else "below"} its 50-DMA, 50-DMA {"above" if a2 else "below"} 200-DMA ({"confirmed uptrend" if a1 and a2 else "uptrend under pressure/correction"})'}
    else: o['M'] = {'s': 'na', 'why': 'Index data not available'}
    sc = sum(1 for x in o.values() if x['s'] == 'pass'); av = sum(1 for x in o.values() if x['s'] != 'na')
    for x in o.values():
        if isinstance(x.get('v'), float): x['v'] = round(x['v'], 4)
    return {'L': o, 'score': sc, 'of': av}

FX = {}
def fx_rate(a, b):
    if (a, b) not in FX:
        try: FX[(a, b)] = json.loads(get(f'https://query1.finance.yahoo.com/v8/finance/chart/{a}{b}=X?range=5d&interval=1d'))['chart']['result'][0]['meta']['regularMarketPrice']
        except Exception as e: print('fx fail', a, b, e); FX[(a, b)] = None
    return FX[(a, b)]

def fetch(sym, name, sector, prev=None):
    q = urllib.parse.quote(sym)
    ch = json.loads(get(f'https://query1.finance.yahoo.com/v8/finance/chart/{q}?range=5y&interval=1d&events=div'))['chart']['result'][0]
    m = ch['meta']; ts = ch.get('timestamp') or []; qd = ch['indicators']['quote'][0]; cl = qd.get('close') or []; vo = qd.get('volume') or []
    hist = [[t, round(c, 2)] for t, c in zip(ts, cl) if c is not None]
    # last 80 daily bars with open/high/low/close/volume (for ATR and swing-trade levels; hist keeps closes only)
    o_, h_, l_ = qd.get('open') or [], qd.get('high') or [], qd.get('low') or []
    ohlc = [[t, round(o, 2), round(h, 2), round(l, 2), round(c, 2), int(v or 0)] for t, o, h, l, c, v in zip(ts, o_, h_, l_, cl, list(vo) + [0] * (len(ts) - len(vo)))
            if None not in (o, h, l, c)][-80:]
    # 52-week intraday high / low (as NSE, Groww and Screener show it - hist keeps closes only, ohlc only 80 bars).
    # A bar whose high / low is wildly off its own close (a bad tick: > 1.5x / < 0.5x) is left out. TMB 11 Nov 2026:
    # closes gave 942.45 / 493.80, intraday 954.20 / 491.50 (= Groww).
    t1 = (ts[-1] if ts else time.time()) - 365 * 86400
    hl = [(h, l) for t, h, l, c in zip(ts, h_, l_, cl) if t >= t1 and None not in (h, l, c) and c > 0 and 0 < l <= h and h <= 1.5 * c and l >= 0.5 * c]
    hl52 = [round(max(x[0] for x in hl), 2), round(min(x[1] for x in hl), 2)] if len(hl) > 150 else None
    divs = [[int(k), v['amount']] for k, v in (ch.get('events', {}).get('dividends') or {}).items()]
    cv = [(c, v) for c, v in zip(cl, vo) if c is not None and v is not None][-51:]
    vol = None
    if len(cv) > 20:
        upv = sum(v for (p0, _), (c, v) in zip(cv, cv[1:]) if c > p0); dnv = sum(v for (p0, _), (c, v) in zip(cv, cv[1:]) if c < p0)
        vol = {'avg50': round(sum(v for _, v in cv[1:]) / (len(cv) - 1)), 'last': cv[-1][1], 'udr': round(upv / dnv, 3) if dnv else None}
    now = int(time.time())
    if prev:  # light refresh: new prices/history, keep the day-old fundamentals, news and analysts
        prev.update({'price': m.get('regularMarketPrice'), 'priceTime': m.get('regularMarketTime'), 'hist': hist, 'ohlc': ohlc, 'hl52': hl52, 'divs': divs, 'vol': vol, 'cap': CAP.get(sym), 'quick': now})
        if len(hist) >= 2: prev['prevClose'] = hist[-2][1] if abs(hist[-1][1] - (prev['price'] or 0)) < 1e-6 else hist[-1][1]
        return prev
    fu = json.loads(get(f'https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{q}?type={TYPES}&period1={now-6*365*86400}&period2={now+86400}'))
    fund, fccy = {}, {}
    for r in fu['timeseries']['result']:
        t = r['meta']['type'][0]
        fund[t] = [[x['asOfDate'], x['reportedValue']['raw']] for x in (r.get(t) or []) if x and x.get('reportedValue')]
        for x in (r.get(t) or []):
            if x and x.get('currencyCode') and not t.startswith('trailing'): fccy[x['currencyCode']] = fccy.get(x['currencyCode'], 0) + 1
    fx = None; pc = m.get('currency'); fc = max(fccy, key=fccy.get) if fccy else None
    if fc and pc and fc != pc:
        rate = fx_rate(fc, pc)
        if rate:
            for t in fund:
                if not t.startswith('trailing'): fund[t] = [[a, b * rate] for a, b in fund[t]]
            fx = {'from': fc, 'to': pc, 'rate': round(rate, 4)}
        else:
            fund = {t: v for t, v in fund.items() if t.startswith('trailing')}; fx = {'from': fc, 'to': pc, 'rate': None}
    an = analysts(q); pr = PROFILE.get(q) or {}
    d = {'symbol': sym, 'name': m.get('longName') or m.get('shortName') or name, 'sector': pr.get('sector') or sector, 'industry': pr.get('industry'),
         'exchange': m.get('fullExchangeName'), 'currency': m.get('currency'),
         'price': m.get('regularMarketPrice'), 'prevClose': m.get('chartPreviousClose'),
         'priceTime': m.get('regularMarketTime'), 'hist': hist, 'ohlc': ohlc, 'hl52': hl52, 'divs': divs, 'fund': fund, 'vol': vol, 'fx': fx, 'profile': pr or None,
         'analyst': an, 'cap': CAP.get(sym), 'fetched': now, 'source': 'Yahoo Finance (public chart, fundamentals-timeseries & quoteSummary endpoints)'}
    if len(hist) >= 2: d['prevClose'] = hist[-2][1] if abs(hist[-1][1] - (d['price'] or 0)) < 1e-6 else hist[-1][1]
    d['news'] = news(sym, d['name'])
    return d

AMFI = None
import threading
AMFI_LOCK = threading.Lock()
def amfi_nav():
    """AMFI daily NAV file -> {ISIN: (nav, 'DD-Mon-YYYY')} (Indian ETFs; Yahoo has no fund data for them)."""
    global AMFI
    with AMFI_LOCK:
      if AMFI is None:
        A = {}
        try:
            for l in get('https://portal.amfiindia.com/spages/NAVAll.txt').decode('utf-8', 'ignore').splitlines():
                p = l.strip().split(';')
                if len(p) >= 8:
                    try: v = float(p[6])
                    except ValueError: continue
                    for i in (p[1], p[2]):
                        if i and i != '-': A[i] = (v, p[7])
        except Exception as e: print('amfi fail', e)
        AMFI = A
    return AMFI

ETF_FIX = []
def clean_etf_hist(hist, divs):
    """An ETF's daily closes never jump 1.8x / fall below 1/1.8 of the day before; when Yahoo's series does:
    - the new level holds for the next days -> a unit split Yahoo did not adjust for (NV20.NS 1:10 in
      Feb/Mar 2026: ~154 -> ~14.75 left in, so 6-month return showed +885%): earlier closes and dividends are divided by
      the nearest split factor;
    - it does not hold (or it is the last bar) -> a bad tick (NV20.NS 13 Nov 2026: 12,353.60 vs NSE close 14.55): dropped.
    Returns the list of fixes made."""
    rnd = lambda c: round(c, 4 if c < 20 else 2)
    # unit splits only (price falls by the factor); a rise is left alone - ETFs hardly ever consolidate, and PVTBANK.NS's
    # ₹10 zero-volume pre-listing bars (Jul 2026) would otherwise look like a 3:1 consolidation
    SPL = (2, 3, 4, 5, 10, 20, 25, 50, 100)
    fx, i = [], 1
    while i < len(hist):
        a, b = hist[i - 1][1], hist[i][1]
        r = a / b if a and b and a > 0 and b > 0 else 1
        if 1 / 1.8 < r < 1.8: i += 1; continue
        nxt = [x[1] for x in hist[i + 1:i + 6]]
        if nxt and all(v and abs(v / b - 1) < 0.25 for v in nxt):
            g = next((g for g in SPL if abs(r / g - 1) < 0.15), None)
            if g:
                t0 = hist[i][0]
                for x in hist[:i]: x[1] = rnd(x[1] / g)
                for x in divs:
                    if x[0] < t0: x[1] = x[1] / g
                fx.append(['split', t0, round(g, 4)])
            elif r >= 1.8: fx.append(['jump', hist[i][0], round(r, 3)])   # left for fix_etf_jumps() (peer check)
            i += 1
        else: fx.append(['tick', hist[i][0], b]); del hist[i]
    return fx

def fix_etf_jumps(docs):
    """A unit split on a day the underlying itself moved a lot is not a clean split factor: GROWWSLVR.NS 1:10 on 2 Feb 2026,
    the day silver fell ~23% -> 322.49 to 22.25 (14.5x), so clean_etf_hist() leaves it. Here the ETF is compared with
    sister ETFs on the same underlying (NSE list 'Underlying Key', e.g. SILVERBEES): its price relative to them (median of
    5 sessions before / after) changes by the split factor alone - GROWWSLVR/SILVERBEES ~1.04 -> 0.1025 = 10x."""
    ist = lambda t: time.strftime('%Y-%m-%d', time.gmtime(t + 19800))
    grp = {}
    for s, d in docs.items():
        e = d.get('etf') if isinstance(d, dict) else None
        if isinstance(e, dict) and e.get('underlying') and s.endswith('.NS'): grp.setdefault(e['underlying'].upper(), []).append(s)
    med = lambda v: sorted(v)[len(v) // 2]
    out = []
    for s, d in docs.items():
        jumps = d.pop('_jumps', None) if isinstance(d, dict) else None
        if not jumps: continue
        peers = [p for p in grp.get(((d.get('etf') or {}).get('underlying') or '').upper(), []) if p != s]
        for t0 in jumps:
            h = d['hist']; i = next((k for k, x in enumerate(h) if x[0] == t0), None)
            if not i: continue
            day = ist(t0); f = []
            for p in peers:
                ph = docs[p].get('hist') or []; pm = {ist(x[0]): x[1] for x in ph}
                j = next((k for k, x in enumerate(ph) if ist(x[0]) == day), None)
                if not j or not ph[j - 1][1] or not 1 / 1.8 < ph[j - 1][1] / ph[j][1] < 1.8: continue   # the peer must not jump itself
                bef = [x[1] / pm[ist(x[0])] for x in h[max(0, i - 5):i] if pm.get(ist(x[0]))]
                aft = [x[1] / pm[ist(x[0])] for x in h[i:i + 5] if pm.get(ist(x[0]))]
                if len(bef) >= 3 and len(aft) >= 3 and med(aft) > 0: f.append(med(bef) / med(aft))
            if not f: out.append([s, day, 'no peer']); continue
            r = med(f); g = next((g for g in (2, 3, 4, 5, 10, 20, 25, 50, 100) if abs(r / g - 1) < 0.1), None)
            if not g: out.append([s, day, 'peer ratio ' + str(round(r, 2))]); continue
            for x in h[:i]: x[1] = round(x[1] / g, 4 if x[1] / g < 20 else 2)
            for x in d.get('divs') or []:
                if x[0] < t0: x[1] = x[1] / g
            out.append([s, day, 'split', g, len(f)])
    print('ETF splits checked against sister ETFs:', json.dumps(out)[:1000])
    return out

def fetch_etf(sym, name, _):
    q = urllib.parse.quote(sym)
    ch = json.loads(get(f'https://query1.finance.yahoo.com/v8/finance/chart/{q}?range=5y&interval=1d&events=div'))['chart']['result'][0]
    m = ch['meta']; ts = ch.get('timestamp') or []; qd = ch['indicators']['quote'][0]; cl = qd.get('close') or []; vo = qd.get('volume') or []
    hist = [[t, round(c, 4 if (c or 0) < 20 else 2)] for t, c in zip(ts, cl) if c is not None]
    if len(hist) < 2: raise ValueError('no price history')
    divs = [[int(k), v['amount']] for k, v in (ch.get('events', {}).get('dividends') or {}).items()]
    fx = clean_etf_hist(hist, divs)
    if fx: ETF_FIX.append([sym] + fx)
    jumps = [x[1] for x in fx if x[0] == 'jump']
    if len(hist) < 2: raise ValueError('no price history after clean-up')
    # Yahoo's current price can be the same bad tick: then use the last good daily close (the official close goes on top later)
    if hist and isinstance(m.get('regularMarketPrice'), (int, float)) and m['regularMarketPrice'] > 0 and not 1 / 1.8 < m['regularMarketPrice'] / hist[-1][1] < 1.8:
        m['regularMarketPrice'], m['regularMarketTime'] = hist[-1][1], hist[-1][0]
    vv = [v for v in vo if v is not None][-50:]
    e = dict(ETFMETA.get(sym) or {}); raw = lambda o, k: (o.get(k) or {}).get('raw') if isinstance(o.get(k), dict) else None
    c = crumb()
    if c:
        try:
            r = json.loads(OP.open(f'https://query2.finance.yahoo.com/v10/finance/quoteSummary/{q}?modules=fundProfile,topHoldings,defaultKeyStatistics,summaryDetail,fundPerformance,quoteType&crumb={urllib.parse.quote(c)}', timeout=25).read())['quoteSummary']['result'][0]
            sd, ks, fp, th, pf = (r.get(x) or {} for x in ('summaryDetail', 'defaultKeyStatistics', 'fundProfile', 'topHoldings', 'fundPerformance'))
            tr = pf.get('trailingReturns') or {}
            e.update({k: v for k, v in {
                'aum': raw(sd, 'totalAssets') or raw(ks, 'totalAssets'), 'yield': raw(sd, 'yield'), 'nav': raw(sd, 'navPrice'),
                'er': raw(fp.get('feesExpensesInvestment') or {}, 'annualReportExpenseRatio') or raw(sd, 'expenseRatio'),
                'category': ks.get('category') or fp.get('categoryName'), 'family': ks.get('fundFamily') or fp.get('family'),
                'r1y': raw(tr, 'oneYear'), 'r3y': raw(tr, 'threeYear'), 'r5y': raw(tr, 'fiveYear'), 'ytd': raw(tr, 'ytd') or raw(ks, 'ytdReturn'),
                'holdings': [[h.get('symbol'), h.get('holdingName'), raw(h, 'holdingPercent')] for h in (th.get('holdings') or [])[:10]] or None,
                'sectors': sorted([[k, v.get('raw')] for x in (th.get('sectorWeightings') or []) for k, v in x.items() if isinstance(v, dict) and v.get('raw')], key=lambda z: -z[1])[:8] or None,
                'mix': {k: raw(th, k + 'Position') for k in ('stock', 'bond', 'cash', 'other') if raw(th, k + 'Position') is not None} or None,
            }.items() if v not in (None, [], {})})
            if e.get('nav') and m.get('regularMarketPrice'): e['navDate'] = 'Yahoo'
        except Exception as ex: print('etf summary fail', sym, str(ex)[:80])
    if e.get('isin'):
        a = amfi_nav().get(e['isin'])
        if a:
            e['nav'], e['navDate'] = a
            try:  # premium/discount: exchange close on the NAV date vs NAV
                t0 = time.mktime(time.strptime(a[1], '%d-%b-%Y')); px = None
                bars = [b for b in hist if t0 <= b[0] < t0 + 86400]
                if bars: px = bars[-1][1]
                elif m.get('regularMarketPrice') and t0 <= (m.get('regularMarketTime') or 0) < t0 + 86400: px = m['regularMarketPrice']
                if px and a[0]: e['prem'] = px / a[0] - 1  # only when the price is from the same day as the NAV
            except Exception: pass
    elif e.get('nav') and m.get('regularMarketPrice'): e['prem'] = m['regularMarketPrice'] / e['nav'] - 1
    def ret(yrs):  # price return from history when the fund data has none
        t0 = hist[-1][0] - yrs * 365.25 * 86400
        if hist[0][0] > t0 + 15 * 86400: return None
        p0 = price_at(hist, t0) or hist[0][1]; return (hist[-1][1] / p0) ** (1 / yrs) - 1 if p0 else None
    for k, y in (('r1y', 1), ('r3y', 3), ('r5y', 5)):
        if e.get(k) is None:
            v = ret(y)
            if v is not None: e[k] = v; e[k + 'Src'] = 'price'
    e['avgVol50'] = round(sum(vv) / len(vv)) if vv else None; e['asOf'] = int(time.time())
    nm = m.get('longName') or m.get('shortName') or name
    d = {'symbol': sym, 'type': 'ETF', 'name': nm, 'sector': 'ETF', 'industry': e.get('category') or e.get('underlying'), 'exchange': m.get('fullExchangeName'),
         'currency': m.get('currency'), 'price': m.get('regularMarketPrice'), 'prevClose': m.get('chartPreviousClose'), 'priceTime': m.get('regularMarketTime'),
         'hist': hist, 'divs': divs, 'fund': {}, 'vol': None, 'fx': None, 'profile': None, 'analyst': None, 'etf': e, 'cap': CAP.get(sym),
         'fetched': int(time.time()), 'source': 'Yahoo Finance (chart & fund profile)' + (', AMFI NAV' if sym.endswith('.NS') else '') + ', NSE ETF list'}
    d['prevClose'] = hist[-2][1] if abs(hist[-1][1] - (d['price'] or 0)) < 1e-6 else hist[-1][1]
    if jumps: d['_jumps'] = jumps   # checked against sister ETFs in fix_etf_jumps(), then removed
    return d

KEPT = []
def keep_newer_bars(d, ob):
    """Yahoo's daily candles can lag a session: at 00:38 IST on 12 Nov 2026 the 11 Nov candle was missing for ~4,400
    stocks, so apply_exchange_close() added the official close as a flat zero-volume bar and the real candle (open, high,
    low, volume) from the 19:00 run was lost - wrong ranges, volume ratios and swing levels. Keep the newer real candles
    and closes from the previous file instead; the official close is then applied on top of them as usual."""
    if not isinstance(d, dict) or not ob: return 0
    po, ph = ob
    oh = d.get('ohlc') or []; last = oh[-1][0] if oh else 0
    add = [b for b in po if isinstance(b, list) and len(b) > 5 and b[0] > last + 43200 and b[5] and b[2] > b[3]]
    if oh and add: d['ohlc'] = (oh + add)[-80:]
    h = d.get('hist') or []; lh = h[-1][0] if h else 0
    addh = [x for x in ph if isinstance(x, list) and len(x) > 1 and x[0] > lh + 43200]
    if h and addh: d['hist'] = h + addh
    return len(add)

def main():
    os.makedirs(os.path.join(OUT, 's'), exist_ok=True)
    print('crumb', bool(crumb()))
    mkt = {}
    for key, s in (('IN', '^NSEI'), ('US', '^GSPC')):
        try: mkt[key] = idx_stats(s)
        except Exception as e: print('index fail', s, e)
    u = universe(); print('universe', len(u)); now0 = time.time()
    docs, fails = {}, []
    def job(x):
        try:
            pf = os.path.join(OUT, 's', x[0] + '.json'); prev = None
            try: prev = json.load(open(pf)) if os.path.exists(pf) else None
            except Exception: prev = None
            ob = (list(prev.get('ohlc') or []), list(prev.get('hist') or [])) if isinstance(prev, dict) else None   # before fetch() replaces them
            if CAP.get(x[0]) in ('Penny', 'Other'):  # penny / non-index: full fundamentals at most once a day, otherwise price history only
                docs[x[0]] = fetch(*x, prev=prev if prev and prev.get('fund') is not None and now0 - prev.get('fetched', 0) < 20 * 3600 else None)
            else: docs[x[0]] = (fetch_etf if CAP.get(x[0], '').startswith('ETF') else fetch)(*x)
            if keep_newer_bars(docs[x[0]], ob): KEPT.append(x[0])
        except Exception as e: fails.append(x[0]); print('fail', x[0], e)
    with cf.ThreadPoolExecutor(6) as ex: list(ex.map(job, u))
    print('newer daily bars kept from the previous run (Yahoo lagging a session):', len(KEPT), KEPT[:10])
    print('ETF price history fixed (unadjusted split / bad tick):', len(ETF_FIX), json.dumps(ETF_FIX[:15])[:1500])
    try: fix_etf_jumps(docs)
    except Exception as e:
        print('ETF peer split check failed:', repr(e)[:160])
        for d in docs.values(): d.pop('_jumps', None) if isinstance(d, dict) else None
    nfix = sum(fix_stale_price(d) for d in docs.values()); print('stale Yahoo prices replaced by latest daily close:', nfix)
    try: nse_day, nse_n = apply_exchange_close(docs, 'NSE')
    except Exception as e: nse_day, nse_n = None, 0; print('NSE close step failed (prices stay Yahoo):', e)
    try: bse_day, bse_n = apply_exchange_close(docs, 'BSE')
    except Exception as e: bse_day, bse_n = None, 0; print('BSE close step failed (prices stay Yahoo):', e)
    nfin = 0
    for s, d in docs.items():
        try: nse_fin(d, s); nfin += 'fundNSE' in d
        except Exception as e: print('nse_fin', s, e)
    print('financials from NSE results filings:', nfin)
    # one stock's odd data must never stop the whole refresh: its metrics are left empty and the error is logged
    K, mfail = {}, []
    for s, d in docs.items():
        try: K[s] = metrics(d)
        except Exception as e: K[s] = {}; mfail.append(s); print('metrics', s, repr(e)[:160])
    if mfail: print('metrics failed for', len(mfail), 'stocks:', ' '.join(mfail[:20]))
    # relative strength rank: same formula as indicators.js rsRanks (3/6/12-month weights, rank 1–99 per market)
    rs_in = [{'s': s, 'r3m': k['r3m'], 'r6m': k.get('r6m'), 'r1y': k.get('r1y'), 'market': 'IN' if s.endswith(('.NS', '.BO')) else 'US'}
             for s, k in K.items() if 'r3m' in k and not docs[s].get('etf')]
    rsr = json.loads(subprocess.run(['node', os.path.join(os.path.dirname(__file__), 'rs_rank.js')], input=json.dumps(rs_in), capture_output=True, text=True, check=True).stdout)
    rows = []
    for s, d in docs.items():
        et = d.get('etf')
        if et:  # ETFs: no CANSLIM/fundamentals; AUM stands in for market cap in lists
            d['canslim'] = {'score': None, 'of': 0}; d['metrics'] = K[s] = {k2: v for k2, v in K[s].items() if k2 in ('r1y', 'r6m', 'r3m')}
            if et.get('aum'): K[s]['mcap'] = et['aum']
            K[s].update({'er': et.get('er'), 'prem': et.get('prem')})
        else: d['canslim'] = canslim(d, K[s], mkt, rsr); d['metrics'] = K[s]
        pm = PENNY.get(s) or ({} if not (s.endswith(('.NS', '.BO')) and isinstance(d.get('price'), (int, float)) and d['price'] < 50 and not et) else {'src': 'NSE' if s.endswith('.NS') else 'BSE'})
        d['penny'] = {**pm, 'surv': SURV.get(s) or SURV.get(pm.get('isin') or '-')} if pm else None
        if s in BSEX: d['bse'] = BSEX[s]
        with open(os.path.join(OUT, 's', s + '.json'), 'w') as fh: json.dump(d, fh, separators=(',', ':'))
        k = K[s]; nw = d.get('news') or {}; pr = d.get('profile') or {}
        if not et: k = {**k, 'gm': pr.get('grossMargins'), 'om': pr.get('opMargins'), **promoter_fields(s, pr)}
        rows.append({'s': s, 'n': d['name'], 'x': d['exchange'] or '', 'sec': '' if et else (d['sector'] or ''), 'ind': d.get('industry') or '', 'p': d['price'], 'pc': d.get('prevClose'), 'c': d['currency'], 'cap': CAP.get(s),
                     **k, 'cs': d['canslim']['score'], 'co': d['canslim']['of'], 'rs': rsr.get(s), 'an': 1 if d.get('analyst') else 0,
                     'nn': len(nw.get('items', [])), 'neg': sum(1 for i in nw.get('items', []) if 'neg' in i['g']),
                     **({'pn': 1, 'sv': (d['penny'].get('surv') or '')[:40]} if d.get('penny') else {})})
    idxf = os.path.join(OUT, 'index.json'); prev = {}
    if os.path.exists(idxf): prev = {r[0]: r for r in json.load(open(idxf)).get('symbols', [])}
    secl = lambda r: r['sec'] or (('ETF · ' + r['ind']) if r['ind'] else 'ETF') if (r.get('cap') or '').startswith('ETF') else r['sec']
    index = [[r['s'], r['n'], r['x'], secl(r)] + ([1] if r['an'] else []) for r in rows]
    for s in fails:
        if s in prev and os.path.exists(os.path.join(OUT, 's', s + '.json')): index.append(prev[s])
    index.sort(key=lambda r: r[0]); rows.sort(key=lambda r: r['s'])
    built = int(time.time())
    json.dump({'built': built, 'symbols': index}, open(idxf, 'w'), separators=(',', ':'))
    json.dump({'built': built, 'rows': rows}, open(os.path.join(OUT, 'summary.json'), 'w'), separators=(',', ':'))
    json.dump({'built': built, **mkt}, open(os.path.join(OUT, 'market.json'), 'w'), separators=(',', ':'))
    mp = os.path.join(OUT, 'meta.json'); meta = json.load(open(mp)) if os.path.exists(mp) else {}
    meta.update({'full': built, 'quotes': built, 'nseDay': nse_day, 'nseN': nse_n, 'bseDay': bse_day, 'bseN': bse_n}); json.dump(meta, open(mp, 'w'))
    print('ok', len(index), 'fail', len(fails), 'news', sum(1 for d in docs.values() if d.get('news')), 'profile', len(PROFILE))
    if len(index) < 0.5 * len(u): sys.exit(1)
if __name__ == '__main__': main()
