'use strict';
// ===== Shared by the app (planui.js), the history test (scripts/backtest.js) and the forward tracker (scripts/track.js) =====
// 1. Indian delivery-trade costs  2. building the portfolio from the plan's buy list  3. managing a trade day by day.
// One copy of these rules, so the plan you see, the history test and the paper portfolio can't drift apart.
(function (root) {
  // ---- 1. costs of a delivery (CNC) trade, NSE, 2026 rates. brk = brokerage per executed order (₹0 at most discount
  //         brokers for delivery, ₹20 at some); dp = depository charge per stock per day you sell (₹13.5 + GST at Zerodha).
  const COSTS = { brk: 0, dp: 15.93, stt: 0.001, stamp: 0.00015, exch: 0.0000297, sebi: 0.000001, gst: 0.18 };
  function buyCost(value, c = COSTS) { const b = c.brk || 0, ex = value * (c.exch + c.sebi); return value * (c.stt + c.stamp) + ex + b + c.gst * (b + ex); }
  function sellCost(value, c = COSTS) { const b = c.brk || 0, ex = value * (c.exch + c.sebi); return value * c.stt + ex + b + c.gst * (b + ex) + (c.dp || 0); }
  // estimated round trip for sizing: buy q at E, sell half at T1 and half later near T1 (two selling days)
  function tripCost(q, E, T1, c = COSTS) { const h = Math.floor(q / 2); return buyCost(q * E, c) + (h ? sellCost(h * T1, c) + sellCost((q - h) * T1, c) : sellCost(q * T1, c)); }

  // ---- 2. portfolio from the buy list (best confidence first)
  const maxPositions = cap => cap < 50000 ? 3 : cap <= 200000 ? 5 : cap <= 1000000 ? 8 : 10;
  // buy: [{s, plan:{E,R,T1}, conf, theme}] · o: {capital, riskPct, maxRisk, posPct, exposure, open:[{s, theme, qty, entry, sl}], costs, maxCostR}
  function buildPortfolio(buy, o) {
    const cap = o.capital, riskAmt = cap * o.riskPct / 100, maxRiskAmt = cap * o.maxRisk / 100, expCap = cap * o.exposure / 100, posCap = cap * o.posPct / 100, nMax = maxPositions(cap);
    const open = o.open || [], held = new Set(open.map(t => t.s)), maxCostR = o.maxCostR ?? 0.15;
    let inv = open.reduce((s, t) => s + t.qty * t.entry, 0), risk = open.reduce((s, t) => s + Math.max(0, t.entry - t.sl) * t.qty, 0), n = open.length;
    const used = new Map(open.filter(t => t.theme).map(t => [t.theme, t.s])), picks = [], skipped = [];
    const openInv = inv, openRisk = risk;
    for (const b of buy) {
      const th = b.theme, E = b.plan.E, R = b.plan.R;
      if (held.has(b.s)) { skipped.push([b, 'already held']); continue; }
      if (th && used.has(th)) { skipped.push([b, `same sector as ${String(used.get(th)).replace(/\.(NS|BO)$/, '')} (${th}) — one bet, not two`]); continue; }
      if (n >= nMax) { skipped.push([b, `position limit reached (${nMax} for this capital)`]); continue; }
      const lim = [[riskAmt / R, 'risk per trade'], [posCap / E, `${o.posPct}% per-stock limit`], [(expCap - inv) / E, `${o.exposure}% exposure cap`], [(maxRiskAmt - risk) / R, `${o.maxRisk}% total-risk limit`]];
      const q = Math.floor(Math.min(...lim.map(x => x[0]))), bind = lim.reduce((a, x) => x[0] < a[0] ? x : a)[1];
      if (!(q >= 1)) { skipped.push([b, `no room left: ${bind}${E > posCap ? ` (one share costs ₹${Math.round(E).toLocaleString('en-IN')})` : ''}`]); continue; }
      if (q * R < 0.5 * riskAmt) { skipped.push([b, `only ${q} share${q === 1 ? '' : 's'} fit (₹${Math.round(q * E).toLocaleString('en-IN')}) under the ${bind} — too small to be worth it`]); continue; }
      const cost = tripCost(q, E, b.plan.T1, o.costs || COSTS), costR = cost / (q * R);
      if (costR > maxCostR) { skipped.push([b, `charges ≈ ₹${Math.round(cost)} would eat ${Math.round(costR * 100)}% of the ₹${Math.round(q * R)} at risk — position too small for the fixed costs`]); continue; }
      picks.push({ ...b, q, cost: q * E, risk: q * R, fees: cost, feesR: costR, bind }); inv += q * E; risk += q * R; n++; if (th) used.set(th, b.s);
    }
    return { cap, riskAmt, maxRiskAmt, expCap, posCap, nMax, picks, skipped, inv, risk, openInv, openRisk, nOpen: open.length };
  }

  // ---- 3. one trading day for one position, on that day's bar [t, o, h, l, c, v]. Orders are GTT-style:
  //   stop and T1 / T3 fire intraday (a gap through the stop fills at the open); breakeven, trailing and the time stop
  //   are decided on the close and act from the next open. Same bar touching stop and target → stop first (conservative).
  //   p: {s, entry, qty, rem, sl, R0, T1, T3, half, best, days, exitNext}; ind: {e20, lo5} after this close.
  //   Returns sells [{qty, px, why}].
  function manageDay(p, bar, ind) {
    const [, o, h, l, c] = bar, out = [];
    const sell = (q, px, why) => { q = Math.min(q, p.rem); if (q > 0) { out.push({ qty: q, px, why }); p.rem -= q; } };
    if (p.exitNext) { sell(p.rem, o, p.exitNext); return out; }
    p.days++;
    if (o <= p.sl) { sell(p.rem, o, p.sl >= p.entry ? 'stop (gap, breakeven/trail)' : 'stop (gap down)'); return out; }
    if (l <= p.sl) { sell(p.rem, p.sl, p.sl >= p.entry ? 'stop (breakeven/trail)' : 'stop'); return out; }
    if (!p.half && h >= p.T1) { const q = Math.max(1, Math.floor(p.qty / 2)); sell(q, Math.max(o, p.T1), 'T1 half'); p.half = true; }
    if (p.rem > 0 && h >= p.T3) { sell(p.rem, Math.max(o, p.T3), 'T3'); return out; }
    p.best = Math.max(p.best, c);
    if (p.rem > 0) {
      if (p.sl < p.entry && p.best >= p.entry + p.R0) p.sl = p.entry;                                   // breakeven
      if (p.half && ind && isFinite(ind.e20) && isFinite(ind.lo5)) { const tr = Math.max(ind.e20, ind.lo5); if (c < tr) p.exitNext = 'trail (close below 20 EMA / 5-day low)'; }
      if (!p.exitNext && p.days >= 15 && p.best < p.entry + p.R0) p.exitNext = 'time stop (15 sessions without +1R)';
      if (!p.exitNext && p.days >= 40) p.exitNext = 'max holding (8 weeks)';
    }
    return out;
  }
  // a GTT buy-stop placed for the next session: trigger E, limit E × (1 + slip). Filled at max(open, E) if the price
  // reaches E and the open is not above the limit (a gap above the limit = no fill, don't chase).
  function fillBuy(E, bar, slip = 0.005) { const [, o, h] = bar, lim = E * (1 + slip); if (h < E || o > lim) return null; return Math.max(o, E); }

  // ---- business themes for "one stock per sector": Yahoo's sectors are too broad to mean "moves together"
  //      (Consumer Cyclical = auto parts + online retail + hotels + textiles), so group by theme built from the industry
  const THEMES = [['Pharma & biotech', /Drug Manufacturers|Biotechnology|Pharmaceutical/], ['Hospitals & health services', /Medical|Health Information|Diagnostics|Healthcare Plans/],
    ['Auto & auto parts', /^Auto|Recreational Vehicles/], ['Textiles & apparel', /Textile|Apparel Manufacturing|Footwear/], ['Retail & e-commerce', /Retail|Department Stores/], ['Jewellery & luxury', /Luxury/],
    ['Hotels, travel & leisure', /Lodging|Resorts|Travel|Leisure|Restaurants|Gambling/], ['Media & entertainment', /Entertainment|Broadcasting|Publishing|Advertising|Electronic Gaming/],
    ['Metals & mining', /Steel|Copper|Aluminum|Industrial Metals|Gold|Silver|Precious Metals|Coal|Mining/], ['Chemicals & fertilisers', /Chemical|Agricultural Inputs/],
    ['Cement & building materials', /Building Materials|Building Products/], ['Paper & packaging', /Paper|Packaging|Lumber/], ['Oil, gas & fuels', /Oil & Gas/], ['Power & utilities', /^Utilities/],
    ['Banks', /^Banks/], ['NBFCs & lenders', /Credit Services|Mortgage Finance|Financial Conglomerates/], ['Brokers, AMCs & exchanges', /Capital Markets|Asset Management|Financial Data/], ['Insurance', /Insurance/],
    ['IT services & software', /Information Technology|Software/], ['Electronics & semiconductors', /Semiconductor|Electronic|Computer Hardware|Scientific & Technical|Communication Equipment/], ['Telecom', /Telecom/],
    ['Defence & aerospace', /Aerospace|Defense/], ['Capital goods & engineering', /Electrical Equipment|Industrial Machinery|Metal Fabrication|Farm & Heavy|Industrial Distribution|Tools|Pollution/],
    ['Construction & infrastructure', /Engineering & Construction|Infrastructure Operations|Construction/],
    ['Logistics & shipping', /Marine Shipping|Trucking|Freight|Railroads|Airlines|Airports|Logistics/], ['Real estate', /Real Estate|REIT/],
    ['FMCG & food', /Packaged Foods|Household|Personal Products|Beverages|Tobacco|Confectioners|Farm Products|Food Distribution|Grocery/]];
  const themeOf = (ind, sec) => { const t = THEMES.find(x => x[1].test(ind || '')); return t ? t[0] : (sec || ''); };

  const API = { COSTS, buyCost, sellCost, tripCost, maxPositions, buildPortfolio, manageDay, fillBuy, THEMES, themeOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.PlanPort = API;
})(typeof self !== 'undefined' ? self : this);
