"""Exchange data for Indian stocks: filings/announcements, bulk & block deals, promoter holding trend, pledge, ASM/GSM.
Free official sources only, no keys. Writes data/x/<SYM>.json, keeps rolling stores in data/corp/.
Runs in daily batches (stalest first) within MAXSEC so the job stays well inside its time limit."""
import csv, io, json, os, re, sys, time, gzip, threading, http.cookiejar, urllib.request, concurrent.futures as cf, xml.etree.ElementTree as ET
sys.path.insert(0, os.path.dirname(__file__))
from build_data import surveillance, SURV, _latest
OUT = os.environ.get('DATA_DIR') or os.path.join(os.path.dirname(__file__), '..', 'data'); XD = os.path.join(OUT, 'x'); CD = os.path.join(OUT, 'corp')
MAXSEC = int(os.environ.get('MAXSEC', '1500')); STALE = 20 * 3600; T0 = time.time()
H = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
     'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', 'Referer': 'https://www.nseindia.com/'}
OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
STAT = {'nse_ok': 0, 'nse_err': 0}; LK = threading.Lock()
def get(u, tries=3, hdr=H):
    for i in range(tries):
        try:
            r = OP.open(urllib.request.Request(u, headers=hdr), timeout=30); b = r.read()
            return gzip.decompress(b) if r.headers.get('Content-Encoding') == 'gzip' else b
        except Exception as e:
            err = e
            if getattr(e, 'code', 0) == 404: break
            time.sleep(2 + 3 * i)
    raise err
def nse(path):
    try: j = json.loads(get('https://www.nseindia.com/api/' + path)); STAT['nse_ok'] += 1; return j
    except Exception: STAT['nse_err'] += 1; return None
def ld(p, dflt):
    try: return json.load(open(p))
    except Exception: return dflt
def dt(s, fmts=('%d-%b-%Y %H:%M:%S', '%d-%b-%Y', '%d-%m-%Y')):
    for f in fmts:
        try: return time.strftime('%Y-%m-%d', time.strptime(s.strip().title() if '%b' in f else s.strip(), f))
        except Exception: pass
    return ''
# filing categories (keyword rules on the exchange's own subject/description)
CATS = [('results', r'financial results?|\bresults? (for|of) (the )?(quarter|period|half|year|q\d)|audited|unaudited'),
        ('fundraise', r'preferential|rights issue|\bqip\b|qualified institution|fund.?rais|warrants?|allotment of (equity|shares|securities|warrants)|debentures?|\bncds?\b|bonus|split|buy.?back'),
        ('order', r'(?<!in )\borders?\b(?! to\b)(?! of\b)|contract|letter of (award|intent)|\bloa\b|work order|tender|bagg|awarded'),
        ('auditor', r'auditor'), ('pledge', r'pledge|encumbr'), ('mgmt', r'resign|cessation|appointment of (md|ceo|cfo|director|managing)|change in (directors|kmp)'),
        ('agm', r'annual general|\bagm\b|egm|postal ballot|board meeting')]
def cat(t):
    t = t.lower(); return [k for k, rx in CATS if re.search(rx, t)]
def aud_bad(t): t = t.lower(); return 'auditor' in t and bool(re.search(r'resign|cessation|ceas|removal|casual vacancy', t))
def aud_chg(t): t = t.lower(); return 'auditor' in t and bool(re.search(r'resign|cessation|ceas|appoint|change|removal|casual vacancy', t)) and not re.search(r'internal auditor|secretarial auditor|cost auditor|scrutini', t)
def main():
    os.makedirs(XD, exist_ok=True); os.makedirs(CD, exist_ok=True)
    idx = ld(os.path.join(OUT, 'index.json'), {}).get('symbols', [])
    syms = [r[0] for r in idx if r[0].endswith(('.NS', '.BO')) and not str(r[3] if len(r) > 3 else '').startswith('ETF')]
    names = {r[0]: r[1] for r in idx}
    print('indian stocks', len(syms))
    surveillance()
    # --- BSE bhavcopy: ticker -> scrip code / ISIN (for BSE-only stocks)
    bse = {}
    try:
        raw, _ = _latest(lambda t: 'https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_' + time.strftime('%Y%m%d', t) + '_F_0000.CSV')
        for r in csv.DictReader(io.StringIO(raw)):
            if r.get('FinInstrmTp') == 'STK': bse[r['TckrSymb'].strip() + '.BO'] = (r['FinInstrmId'].strip(), r['ISIN'].strip())
    except Exception as e: print('bse bhav fail', e)
    # --- bulk & block deals: NSE daily archive files, accumulated into a rolling 1-year store
    dst = ld(os.path.join(CD, 'deals.json'), {'rows': []}); seen = {tuple(x) for x in dst['rows']}; nd = 0
    for kind in ('bulk', 'block'):
        try:
            txt = get('https://nsearchives.nseindia.com/content/equities/%s.csv' % kind, hdr={**H, 'Accept': '*/*'}).decode('utf-8-sig', 'ignore')
            for r in csv.reader(io.StringIO(txt)):
                if len(r) < 7 or r[0].strip().lower() == 'date': continue
                try: row = [dt(r[0]), 'NSE', kind, r[1].strip() + '.NS', r[3].strip(), r[4].strip().upper(), int(float(r[5])), float(r[6])]
                except ValueError: continue
                if tuple(row) not in seen: seen.add(tuple(row)); dst['rows'].append(row); nd += 1
        except Exception as e: print('deals fail', kind, e)
    cut = time.strftime('%Y-%m-%d', time.gmtime(time.time() - 366 * 86400)); dst['rows'] = [x for x in dst['rows'] if x[0] >= cut]
    dst.setdefault('since', time.strftime('%Y-%m-%d', time.gmtime(time.time() + 19800))); json.dump(dst, open(os.path.join(CD, 'deals.json'), 'w'), separators=(',', ':'))
    print('deals new', nd, 'stored', len(dst['rows']), 'since', dst['since'])
    # --- BSE announcements RSS (today's filings, every company), accumulated for BSE-only stocks
    code2sym = {bse[s][0]: s for s in syms if s.endswith('.BO') and s in bse}
    bst = ld(os.path.join(CD, 'bse_ann.json'), {}); nb = 0
    try:
        root = ET.fromstring(get('https://www.bseindia.com/data/xml/announcements.xml', hdr={**H, 'Accept': '*/*', 'Referer': 'https://www.bseindia.com/'}))
        for it in root.iter('item'):
            c = (it.findtext('scripcode') or '').strip()
            if c not in code2sym: continue
            e = [dt(it.findtext('pubDate') or ''), (it.findtext('description') or '').strip()[:300], (it.findtext('link') or '').strip()]
            L = bst.setdefault(c, [])
            if e not in L: L.append(e); nb += 1
        for c in bst: bst[c] = sorted(bst[c], key=lambda x: x[0], reverse=True)[:40]
        json.dump(bst, open(os.path.join(CD, 'bse_ann.json'), 'w'), separators=(',', ':'))
    except Exception as e: print('bse rss fail', e)
    print('bse ann new', nb, 'companies', len(bst))
    deals_by = {}
    for x in dst['rows']: deals_by.setdefault(x[3], []).append(x)
    # --- per-stock NSE data, stalest first, within the time budget
    try: get('https://www.nseindia.com/', hdr={**H, 'Accept': 'text/html'})
    except Exception as e: print('nse home', e)
    prev = {s: ld(os.path.join(XD, s + '.json'), {}) for s in syms}
    todo = sorted([s for s in syms if s.endswith('.NS') and time.time() - prev[s].get('t', 0) > STALE], key=lambda s: prev[s].get('t', 0))
    print('NSE due', len(todo))
    frm, to = time.strftime('%d-%m-%Y', time.gmtime(time.time() - 365 * 86400)), time.strftime('%d-%m-%Y', time.gmtime(time.time() + 19800))
    done = []
    def one(s):
        if time.time() - T0 > MAXSEC: return
        b = s[:-3]; q = urllib.request.quote(b)
        an = nse(f'corporate-announcements?index=equities&symbol={q}&from_date={frm}&to_date={to}')
        sh = nse(f'corporate-share-holdings-master?index=equities&symbol={q}')
        if an == [] and sh == []: an = nse(f'corporate-announcements?index=sme&symbol={q}&from_date={frm}&to_date={to}'); sh = nse(f'corporate-share-holdings-master?index=sme&symbol={q}')
        pl = nse(f'corporate-pledgedata?index=equities&symbol={q}')
        if an is None and sh is None and pl is None: return
        d = dict(prev[s]); d['t'] = int(time.time())
        if an is not None:
            items = []
            for a in an:
                t = ((a.get('desc') or '') + ' — ' + (a.get('attchmntText') or '')).strip(' —')
                items.append({'d': dt(a.get('an_dt') or a.get('sort_date') or ''), 't': t[:300], 'u': a.get('attchmntFile') or '', 'g': cat(t)})
            items.sort(key=lambda x: x['d'], reverse=True)
            aud = [x for x in items if aud_chg(x['t'])]
            d['ann'] = [x for x in items if x['g'] and x['g'] != ['agm']][:25] or items[:10]
            d['annN'] = len(items); d['aud'] = aud[:3]; d['audBad'] = any(aud_bad(x['t']) for x in aud)
        if sh is not None:
            pts = {}
            for r in sh:
                try: pts[dt(r['date'])] = float(r['pr_and_prgrp'])
                except Exception: pass
            d['prom'] = sorted(pts.items())[-8:]
        if pl is not None:
            r = (pl.get('data') or [None])[0] if isinstance(pl, dict) else None
            if r:
                try:
                    tp, npl = float(r.get('totPromoterHolding') or 0), float(r.get('numSharesPledged') or 0)
                    d['pledge'] = {'pp': round(100 * npl / tp, 2) if tp else 0.0, 'pt': float(r.get('percSharesPledged') or 0), 'ph': float((r.get('percPromoterHolding') or '0').strip() or 0), 'shp': r.get('shp'), 'bd': dt(r.get('broadcastDt') or '')}
                except Exception: pass
            else: d['pledge'] = {'none': 1}
        prev[s] = d
        with LK: done.append(s)
    with cf.ThreadPoolExecutor(3) as ex: list(ex.map(one, todo))
    print('NSE refreshed', len(done), 'calls ok', STAT['nse_ok'], 'err', STAT['nse_err'], 'elapsed', int(time.time() - T0))
    # --- write every Indian stock's file (deals, BSE filings and surveillance are cheap to refresh every run)
    asof = time.strftime('%Y-%m-%d', time.gmtime(time.time() + 19800)); n = {'files': 0, 'ann': 0, 'deals': 0, 'prom': 0, 'pledge': 0, 'surv': 0}
    for s in syms:
        d = dict(prev[s]); d['sym'] = s; d['asof'] = asof
        if s.endswith('.BO'):
            c, isin = bse.get(s, ('', ''))
            d['code'] = c; d['src'] = 'BSE'
            if c in bst: d['ann'] = [{'d': a, 't': t, 'u': u, 'g': cat(t)} for a, t, u in bst[c]][:25]; aud = [x for x in d['ann'] if aud_chg(x['t'])]; d['aud'] = aud[:3]; d['audBad'] = any(aud_bad(x['t']) for x in aud)
            d['bseSince'] = min((min(x[0] for x in v) for v in bst.values() if v), default=asof)
            d['surv'] = SURV.get(isin) if isin else None
        else: d['src'] = 'NSE'; d['surv'] = SURV.get(s)
        d['deals'] = [{'d': x[0], 'x': x[1], 'k': x[2], 'c': x[4], 's': x[5], 'q': x[6], 'p': x[7]} for x in sorted(deals_by.get(s, []), reverse=True)][:30]
        d['dealsSince'] = dst['since']
        json.dump(d, open(os.path.join(XD, s + '.json'), 'w'), separators=(',', ':'))
        n['files'] += 1; n['ann'] += bool(d.get('ann')); n['deals'] += bool(d['deals']); n['prom'] += bool(d.get('prom')); n['pledge'] += bool(d.get('pledge') and not d['pledge'].get('none')); n['surv'] += bool(d['surv'])
    cov = {'built': int(time.time()), **n, 'nseFresh': sum(1 for s in syms if s.endswith('.NS') and time.time() - prev[s].get('t', 0) < 2 * 86400), 'nse': sum(1 for s in syms if s.endswith('.NS')), 'bse': sum(1 for s in syms if s.endswith('.BO')), 'elapsed': int(time.time() - T0)}
    json.dump(cov, open(os.path.join(CD, 'coverage.json'), 'w')); print('coverage', cov)
if __name__ == '__main__': main()
