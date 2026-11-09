"""Exchange data for Indian stocks: filings/announcements, bulk & block deals, promoter holding trend, pledge, ASM/GSM.
Free official sources only, no keys. Writes data/x/<SYM>.json, keeps rolling stores in data/corp/.
Runs in daily batches (stalest first) within MAXSEC so the job stays well inside its time limit."""
import csv, io, json, os, re, sys, time, gzip, threading, http.cookiejar, urllib.request, concurrent.futures as cf, xml.etree.ElementTree as ET
sys.path.insert(0, os.path.dirname(__file__))
from build_data import surveillance, SURV, _latest
OUT = os.environ.get('DATA_DIR') or os.path.join(os.path.dirname(__file__), '..', 'data'); XD = os.path.join(OUT, 'x'); CD = os.path.join(OUT, 'corp')
MAXSEC = int(os.environ.get('MAXSEC', '1500')); STALE = 20 * 3600; T0 = time.time()
RV = 5   # reader version: bump when the pledge / FII parsing changes, so every company is re-read on the next run
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
# ---- promoter pledge (NSE corporate-pledgedata). The reply's shape is recorded (keys only) so a format change is visible
PDIAG = {'shapes': {}, 'rows': 0, 'empty': 0, 'unreadable': 0, 'keys': None}
def pledge_rows(pl):
    if isinstance(pl, list): return pl
    if isinstance(pl, dict):
        for k in ('data', 'Data', 'rows'):
            if isinstance(pl.get(k), list): return pl[k]
    return None
def _num(v):
    try: return float(str(v).replace(',', '').strip())
    except (TypeError, ValueError): return None
def pledge_parse(pl):
    """-> {'pp','pt','ph','shp','bd'} | {'none':1} (NSE says no pledge rows) | {'unk':1} (reply missing or not readable)"""
    shape = type(pl).__name__ + (':' + ','.join(sorted(pl.keys()))[:120] if isinstance(pl, dict) else '')
    rows = pledge_rows(pl)
    with LK:
        PDIAG['shapes'][shape] = PDIAG['shapes'].get(shape, 0) + 1
        if rows: PDIAG['rows'] += 1; PDIAG['keys'] = PDIAG['keys'] or sorted(rows[0].keys())[:40] if isinstance(rows[0], dict) else PDIAG['keys']
        elif rows == []: PDIAG['empty'] += 1
        else: PDIAG['unreadable'] += 1
    if rows == []: return {'none': 1}
    if not rows or not isinstance(rows[0], dict): return {'unk': 1}
    r = max(rows, key=lambda x: dt(x.get('broadcastDt') or x.get('shp') or '') or '')
    # NSE gives the pledge directly: percPromoterShares = % of promoter shares pledged (Screener's "Pledged %"),
    # percTotShares = pledged shares as % of all shares. Older replies only had share counts.
    pps, pts_ = _num(r.get('percPromoterShares')), _num(r.get('percTotShares'))
    tp, npl = _num(r.get('totPromoterShares') or r.get('totPromoterHolding')), _num(r.get('numSharesPledged'))
    pt, ph = _num(r.get('percSharesPledged')), _num(r.get('percPromoterHolding'))
    pp = pps if pps is not None else (round(100 * npl / tp, 2) if tp and npl is not None and tp > 100 else (0.0 if npl == 0 else None))
    if pp is None and pt is None and pts_ is None: return {'unk': 1}
    return {'pp': round(pp, 2) if pp is not None else None, 'pt': pts_ if pts_ is not None else (pt or 0.0), 'ph': ph or 0.0, 'shp': r.get('shp'), 'bd': dt(r.get('broadcastDt') or '')}
# ---- FII / DII holding from the quarterly shareholding-pattern XBRL (link in NSE's shareholding list, file on nsearchives)
IDIAG = {'parsed': 0, 'fail': 0, 'noFii': 0, 'members': [], 'errs': []}
_CTX = re.compile(r'<(?:\w+:)?context\b[^>]*\bid="([^"]+)"[^>]*>(.*?)</(?:\w+:)?context>', re.S)
_MEM = re.compile(r'explicitMember[^>]*>\s*([^<\s]+)\s*<')
_PCT = re.compile(r'<[\w-]+:ShareholdingAsAPercentageOfTotalNumberOfShares\b[^>]*contextRef="([^"]+)"[^>]*>\s*([-0-9.Ee]+)\s*<')
# exact category names (anchored): "OtherInstitutionsForeignMember" / "OtherInstitutionsDomesticMember" are small sub-rows,
# not the totals — matching them gave Reliance / TCS a false FII of 0 (checked against Screener, 9 Nov 2026)
FII_TOTAL = re.compile(r'^(InstitutionsForeign|ForeignInstitutions?)Member$', re.I)
FPI_TOTAL = re.compile(r'^(Institutions)?ForeignPortfolioInvestors?Member$', re.I)
FPI_PART = re.compile(r'^(Institutions)?ForeignPortfolioInvestors?Cat\w*Member$|^ForeignInstitutionalInvestors?Member$', re.I)   # "Catergory" typo exists in filings
DII_TOTAL = re.compile(r'^(InstitutionsDomestic|DomesticInstitutions?)Member$', re.I)
DEPOSITORY = re.compile(r'^(Institutions)?OverseasDepositor(y|ies)Member$', re.I)
DIAG_SYMS = ('RELIANCE.NS', 'LT.NS', 'SUZLON.NS', 'TCS.NS', 'BEL.NS')   # dump their foreign/institution figures for checking
def shp_inst(url, sym=''):
    """-> (fii %, dii %) from one shareholding-pattern XBRL (None where not found)."""
    x = get(url, tries=2, hdr={**H, 'Accept': '*/*'}).decode('utf-8', 'ignore')
    if sym in DIAG_SYMS:
        with LK:
            dd = IDIAG.setdefault('dump', {}).setdefault(sym, {})
            if not dd:
                tags = sorted(set(re.findall(r'<([\w-]+:\w*[Ss]hareholding\w*)\b', x)))[:15]
                rows = []
                for cid, body in _CTX.findall(x):
                    mem = [s.split(':')[-1] for s in _MEM.findall(body)]
                    if any(re.search(r'foreign|portfolio|institution', m_, re.I) for m_ in mem):
                        vals_ = re.findall(r'<([\w-]+:\w+)\b[^>]*contextRef="%s"[^>]*>\s*([-0-9.Ee]+)\s*<' % re.escape(cid), x)
                        pct = [v for t, v in vals_ if 'Percentage' in t]
                        rows.append('/'.join(mem)[:110] + ('|typed' if 'typedMember' in body else '') + ' = ' + ','.join(pct[:3]))
                dd.update({'url': url[-60:], 'tags': tags, 'rows': rows[:40]})
    ctx = {}
    for cid, body in _CTX.findall(x):
        if 'typedMember' in body: continue                       # individual shareholder rows
        m = [s.split(':')[-1] for s in _MEM.findall(body)]
        if m: ctx[cid] = m
    vals, valsM = {}, {}                                         # single-category contexts first; multi-member as fallback
    for cid, v in _PCT.findall(x):
        if cid not in ctx: continue
        try: fv = float(v)
        except ValueError: continue
        if len(ctx[cid]) == 1: vals.setdefault(ctx[cid][0], fv)
        else:
            for m_ in ctx[cid]: valsM.setdefault(m_, fv)
    if not vals and not valsM: raise ValueError('no shareholding % facts')
    allv = list(vals.values()) or list(valsM.values())
    scale = 100.0 if max(allv) <= 1.0001 else 1.0               # filings store either fractions or percentages
    with LK:
        if len(IDIAG['members']) < 60:
            for k in list(vals) + ['(multi) ' + k for k in valsM if k not in vals]:
                if re.search(r'foreign|institution|portfolio|fii|fpi', k, re.I) and k not in IDIAG['members']: IDIAG['members'].append(k)
    pick = lambda rx: [v for k, v in vals.items() if rx.search(k)] or [v for k, v in valsM.items() if rx.search(k)]
    f = pick(FII_TOTAL) or pick(FPI_TOTAL) or ([sum(pick(FPI_PART))] if pick(FPI_PART) else [])
    # ADR/GDR holders ("Overseas Depositories") sit inside the foreign-institutions total; Screener leaves them out
    # (ICICIBANK Sep 2026: 50.44 total - 15.76 ADR = 34.68 = Screener), so do the same
    if f and pick(FII_TOTAL): f = [max(0.0, f[0] - sum(pick(DEPOSITORY)))]
    dii = pick(DII_TOTAL)
    # 0% only when the filing has no foreign category at all; otherwise leave it unknown rather than show a false 0
    if not f and dii and not any(re.search(r'foreign|portfolio', k, re.I) for k in list(vals) + list(valsM)): f = [0.0]
    return (round(f[0] * scale, 2) if f else None, round(dii[0] * scale, 2) if dii else None)
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
        ('agm', r'annual general|\bagm\b|egm|postal ballot|board meeting'),
        # growth: expansion / capex / new capacity / acquisitions / JVs / new products or markets
        ('expansion', r'expan|capex|guidance|invest(ment)? (of|in|worth) (rs|inr|₹|\$|usd)|\bplans? (to|inr|rs|₹)|capital expenditure|new (plant|unit|facility|factory|capacity|product|line)|greenfield|brownfield|capacity (addition|enhancement|augment)|commercial production|commission(ing|ed)? of|acqui(re|sition)|amalgamat|(?<!de)merger|joint venture|\bjv\b|memorandum of understanding|\bmou\b|strategic (partnership|alliance|tie.?up)|foray|launch(es|ed|ing)? (of )?(a |its |new |the )?(new )?(product|brand|service|plant|range|model|vehicle|drug|medicine|platform|facility|variant)|set(ting)? up (a |an |its |new )?(plant|unit|facility|factory|manufactur)|incorporation of (a )?(wholly owned )?subsidiar|diversif'),
        # orders / projects delivered or completed
        ('done', r'(complet|execut|deliver|handed over|handover|commission)\w*.{0,40}\b(order|project|contract|work|plant|supply)|(order|project|contract|work)s?.{0,40}\b(complet|execut|deliver|handed over|commissioned)'),
        # court cases, litigation, regulatory / tax actions
        ('legal', r'litigation|court|pronouncement of order|order dated|judg(e)?ment|verdict|\bdisputes?\b|\brulings?\b|stay order|contempt|quash|summons|charge.?sheet|tribunal|\bnclt\b|\bnclat\b|arbitra|lawsuit|\bsuit\b|petition|writ\b|show.?cause|penalt|\bfine[ds]?\b|action\(?s?\)? initiated|orders? passed|adjudicat|demand (order|notice)|tax demand|\bgst\b.{0,30}(demand|notice|order)|income.?tax.{0,30}(search|survey|demand|notice)|enforcement directorate|\bcbi\b|\bfir\b|insolvency|\bcirp\b|winding.?up|\bsebi\b.{0,40}(order|notice|penalt|settle)|settlement order|regulatory action|search and seizure|raid')]
def cat(t):
    t = t.lower(); g = [k for k, rx in CATS if re.search(rx, t)]
    if 'legal' in g and 'order' in g and re.search(r'orders? passed|action\(?s?\)? (initiated|taken)|court|tribunal|demand order|penalt|pronouncement of order|order dated|judg(e)?ment', t): g.remove('order')   # "orders passed" by a court/regulator is not a business order
    return g
def keep_ann(items):
    """Filings to store (newest first): up to 15 of each category so orders, expansion, completions and legal matters
    are not crowded out by results/meeting notices; falls back to the 10 newest when nothing is categorised."""
    items = sorted(items, key=lambda x: x['d'], reverse=True); pick = []
    for k, _ in CATS:
        if k == 'agm': continue
        for x in [y for y in items if k in y['g']][:15]:
            if x not in pick: pick.append(x)
    return sorted(pick, key=lambda x: x['d'], reverse=True)[:80] or items[:10]
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
        rb = get('https://www.bseindia.com/data/xml/announcements.xml', hdr={'User-Agent': H['User-Agent'], 'Accept': '*/*'})
        root = ET.fromstring(rb); its = list(root.iter('item')); print('bse rss bytes', len(rb), 'items', len(its), rb[:80])
        for it in its:
            c = (it.findtext('scripcode') or '').strip()
            if c not in code2sym: continue
            e = [dt(it.findtext('pubDate') or ''), (it.findtext('description') or '').strip()[:300], (it.findtext('link') or '').strip()]
            L = bst.setdefault(c, [])
            if e not in L: L.append(e); nb += 1
        for c in bst: bst[c] = sorted(bst[c], key=lambda x: x[0], reverse=True)[:40]
        json.dump(bst, open(os.path.join(CD, 'bse_ann.json'), 'w'), separators=(',', ':'))
    except Exception as e: print('bse rss fail', e)
    print('bse ann new', nb, 'companies', len(bst))
    # --- outbound link slugs (URLs only; no third-party content is copied): Moneycontrol page via its ISIN search, Tickertape slug
    isin = {}
    try:
        for r in csv.DictReader(io.StringIO(get('https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv', hdr={**H, 'Accept': '*/*'}).decode('utf-8-sig', 'ignore'))):
            r = {k.strip(): (v or '').strip() for k, v in r.items() if k}; isin[r['SYMBOL'] + '.NS'] = r.get('ISIN NUMBER', '')
    except Exception as e: print('EQUITY_L fail', e)
    for s_, (c_, i_) in bse.items(): isin.setdefault(s_, i_)
    LKS = ld(os.path.join(CD, 'links.json'), {})
    def link(s_):
        if time.time() - T0 > 400: return
        o = dict(LKS.get(s_) or {}); i_ = isin.get(s_); base = s_[:-3]
        if 'mc' not in o and i_:
            try:
                j = json.loads(get('https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php?classic=true&type=1&format=json&query=' + i_, tries=2, hdr={'User-Agent': H['User-Agent']}))
                j = [x for x in j if i_ in (x.get('pdt_dis_nm') or '')]
                o['mc'] = j[0]['link_src'] if j and (j[0].get('link_src') or '').startswith('https://www.moneycontrol.com/') else ''
                m_ = re.search(r'\b(5\d{5})\b', (j[0].get('pdt_dis_nm') or '')) if j else None
                if m_: o['bc'] = m_.group(1)
            except Exception: pass
        if 'tt' not in o:
            try:
                j = json.loads(get('https://api.tickertape.in/search?types=stock&text=' + urllib.request.quote(base), tries=2, hdr={'User-Agent': H['User-Agent']}))
                st = [x for x in j['data']['stocks'] if x.get('ticker') == base and x.get('type') == 'stock']
                o['tt'] = 'https://www.tickertape.in' + st[0]['slug'] if st else ''
            except Exception: pass
        LKS[s_] = o
    with cf.ThreadPoolExecutor(4) as ex: list(ex.map(link, [s_ for s_ in syms if 'mc' not in (LKS.get(s_) or {}) or 'tt' not in (LKS.get(s_) or {})]))
    json.dump(LKS, open(os.path.join(CD, 'links.json'), 'w'), separators=(',', ':'))
    print('links mc', sum(1 for v in LKS.values() if v.get('mc')), 'tt', sum(1 for v in LKS.values() if v.get('tt')), 'bse code', sum(1 for v in LKS.values() if v.get('bc')), 'of', len(syms))
    deals_by = {}
    for x in dst['rows']: deals_by.setdefault(x[3], []).append(x)
    # --- per-stock NSE data, stalest first, within the time budget
    try: get('https://www.nseindia.com/', hdr={**H, 'Accept': 'text/html'})
    except Exception as e: print('nse home', e)
    prev = {s: ld(os.path.join(XD, s + '.json'), {}) for s in syms}
    # due = not refreshed for STALE hours, or never read with the FII/pledge reader yet (no 'inst' key) — new fields fill in at once
    due = lambda s: time.time() - prev[s].get('t', 0) > STALE or prev[s].get('rv') != RV
    todo = sorted([s for s in syms if s.endswith('.NS') and due(s)], key=lambda s: (s not in DIAG_SYMS, prev[s].get('rv') == RV, prev[s].get('t', 0)))
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
        if pledge_rows(pl) == []:                                  # SME-board companies' pledges are listed under index=sme
            ps = nse(f'corporate-pledgedata?index=sme&symbol={q}')
            if pledge_rows(ps): pl = ps
        if an is None and sh is None and pl is None: return
        d = dict(prev[s]); d['t'] = int(time.time()); d['rv'] = RV
        if prev[s].get('rv') != RV: d.pop('inst', None)          # re-read FII/DII with the current reader
        if an is not None:
            items = []
            for a in an:
                t = ((a.get('desc') or '') + ' — ' + (a.get('attchmntText') or '')).strip(' —')
                items.append({'d': dt(a.get('an_dt') or a.get('sort_date') or ''), 't': t[:300], 'u': a.get('attchmntFile') or '', 'g': cat(t)})
            items.sort(key=lambda x: x['d'], reverse=True)
            aud = [x for x in items if aud_chg(x['t'])]
            d['ann'] = keep_ann(items)
            d['annN'] = len(items); d['aud'] = aud[:3]; d['audBad'] = any(aud_bad(x['t']) for x in aud)
        if sh is not None:
            pts, xb = {}, {}
            for r in sh:
                try: pts[dt(r['date'])] = float(r['pr_and_prgrp'])
                except Exception: pass
                u = (r.get('xbrl') or '').strip() if isinstance(r, dict) else ''
                if u.startswith('http') and dt(r.get('date') or ''): xb[dt(r['date'])] = u
            d['prom'] = sorted(pts.items())[-8:]
            # FII / DII: newest 5 quarters; at most 2 new XBRL files per stock per run (fills in over a few runs)
            have = {q[0]: q for q in (d.get('inst') or [])}
            need = [q for q in sorted(xb)[-5:] if q not in have][-2:]
            for q in need:
                if time.time() - T0 > MAXSEC: break
                try:
                    fv, dv = shp_inst(xb[q], s); have[q] = [q, fv, dv]
                    with LK: IDIAG['parsed'] += 1; IDIAG['noFii'] += fv is None
                except Exception as e:
                    with LK:
                        IDIAG['fail'] += 1
                        if len(IDIAG['errs']) < 5: IDIAG['errs'].append(str(e)[:80])
            d['inst'] = sorted(have.values())[-5:]
        if pl is not None:
            try: d['pledge'] = pledge_parse(pl)
            except Exception: d['pledge'] = {'unk': 1}
        elif 'pledge' not in d: d['pledge'] = {'unk': 1}
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
            if c in bst: d['ann'] = keep_ann([{'d': a, 't': t, 'u': u, 'g': cat(t)} for a, t, u in bst[c]]); aud = [x for x in d['ann'] if aud_chg(x['t'])]; d['aud'] = aud[:3]; d['audBad'] = any(aud_bad(x['t']) for x in aud)
            d['bseSince'] = min((min(x[0] for x in v) for v in bst.values() if v), default=asof)
            d['surv'] = SURV.get(isin) if isin else None
        else: d['src'] = 'NSE'; d['surv'] = SURV.get(s)
        d['deals'] = [{'d': x[0], 'x': x[1], 'k': x[2], 'c': x[4], 's': x[5], 'q': x[6], 'p': x[7]} for x in sorted(deals_by.get(s, []), reverse=True)][:30]
        d['dealsSince'] = dst['since']; d['links'] = LKS.get(s) or {}
        json.dump(d, open(os.path.join(XD, s + '.json'), 'w'), separators=(',', ':'))
        n['files'] += 1; n['ann'] += bool(d.get('ann')); n['deals'] += bool(d['deals']); n['prom'] += bool(d.get('prom')); n['pledge'] += bool(d.get('pledge') and isinstance(d['pledge'].get('pp'), (int, float)) and d['pledge']['pp'] > 0); n['pledgeNone'] = n.get('pledgeNone', 0) + bool(d.get('pledge') and d['pledge'].get('none')); n['pledgeUnk'] = n.get('pledgeUnk', 0) + bool(d.get('pledge') and d['pledge'].get('unk')); n['surv'] += bool(d['surv'])
    cov = {'built': int(time.time()), **n, 'nseFresh': sum(1 for s in syms if s.endswith('.NS') and time.time() - prev[s].get('t', 0) < 2 * 86400), 'nse': sum(1 for s in syms if s.endswith('.NS')), 'bse': sum(1 for s in syms if s.endswith('.BO')), 'elapsed': int(time.time() - T0), 'pledgeDiag': PDIAG, 'instDiag': IDIAG,
           'fii': sum(1 for s in syms if any(q[1] is not None for q in (prev[s].get('inst') or [])))}
    json.dump(cov, open(os.path.join(CD, 'coverage.json'), 'w')); print('coverage', cov)
if __name__ == '__main__': main()
