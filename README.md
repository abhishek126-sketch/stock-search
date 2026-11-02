# Stock Search (India & US) — installable PWA

Live: https://abhishek126-sketch.github.io/stock-search/

Search NSE (NIFTY 500) and US (S&P 500) stocks: price & day change, interactive 1M/6M/1Y/5Y chart with 50/200-DMA,
key ratios (market cap, P/E, P/B, EPS, dividend yield, 52-week range, ROE, ROCE, debt/equity), recent quarterly results
with QoQ/YoY growth, and an automated rule-based "Expert analysis" scorecard. Missing data is shown as "not available" — never estimated.

**Educational tool only — not personal investment advice.**

## How data works (no keys, no secrets)
* Browsers cannot call Yahoo Finance directly (no CORS headers) and free public CORS proxies proved unreliable.
* So a GitHub Action (`.github/workflows/data.yml`, `scripts/build_data.py`) fetches Yahoo Finance's public chart and
  fundamentals-timeseries endpoints server-side several times each weekday and force-pushes JSON snapshots to the orphan
  `data` branch. The app reads them from `raw.githubusercontent.com` (CORS-enabled).
* Optional: paste your own free **Alpha Vantage** key in Settings (https://www.alphavantage.co/support/#api-key) for a live price
  refresh and to search stocks outside the built-in list (BSE codes like `500325.BSE`, any US ticker). Stored only in your browser.

## Limitations
* Snapshot prices can be delayed up to a few hours.
* Yahoo's free fundamentals give ~5 recent quarters (sometimes with gaps) and 4 fiscal years.
* Alpha Vantage free tier: ~25 requests/day; fundamentals mainly for US companies; BSE gives price only.

## Sections (v3)
Peer comparison & sector analysis (Yahoo industry/sector within the built-in list), news buckets (Google News RSS headlines, last 90 days,
keyword-tagged into orders / plans / negative — automated and unverified), numeric red flags, intrinsic value (DCF, Graham number,
Graham revised formula, sector P/E multiple, EPV, dividend discount, justified P/B; editable assumptions), and a mechanised CANSLIM check,
plus CANSLIM-leaders and sector browsing lists on the home screen. Promoter pledge and auditor data are not available from free sources.
