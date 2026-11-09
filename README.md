# Stock Search (India & US) — installable PWA

Live: https://abhishek126-sketch.github.io/stock-search/

Search NSE (NIFTY 500) and US (S&P 500) stocks: price & day change, interactive 1M/6M/1Y/5Y chart with 50/200-DMA,
key ratios (market cap, P/E, P/B, EPS, dividend yield, 52-week range, ROE, ROCE, debt/equity), recent quarterly results
with QoQ/YoY growth, and an automated rule-based "Expert analysis" scorecard. Missing data is shown as "not available" — never estimated.

**Educational tool only — not personal investment advice.**

## Install (PC / Android / iPhone)
* **PC (Edge/Chrome) and Android (Chrome):** open the live URL → tap **⬇ Install** in the header (or browser menu → *Install app*).
* **iPhone/iPad:** open in Safari → Share → **Add to Home Screen**.
* PNG icons (192, 512, maskable 512, 180 apple-touch) are included so the home-screen icon looks right on every platform.
* Settings (watchlist, API keys, token) are stored per browser; re-enter them once on each new device.

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

## Refresh schedule
* **Quotes job** (`quotes.yml`, ~30–60 s): every 5 min Mon–Fri 09:15–16:00 IST (NSE) and 19:00–02:30 IST (US, covers both DST states), every 3 h otherwise. Updates `quotes.json` + `meta.json` only.
* **Full job** (`data.yml`, ~4–5 min): 09:00, 15:45 and 03:00 IST on weekdays — fundamentals, analysts, news, CANSLIM, summaries.
* Separate concurrency groups (no cancelling; at most one queued run each); publishing uses force-with-lease and rebases on conflict so the two jobs never overwrite each other.
* **GitHub cron is best-effort**: scheduled runs are often delayed 5–30 min (sometimes more) at busy times and may occasionally be skipped; schedules in public repos also pause after 60 days without repository activity.
* The app checks `meta.json` every 60 s while visible and re-renders silently when newer data lands. **Update now** triggers `workflow_dispatch` with your own fine-grained token (this repo only, Actions: Read and write), stored only in your browser.

## 25-point research report (v7)
Each stock page has a numbered, collapsible 25-section report (executive summary → conflicts) with a jump bar, CANSLIM/Graham/Buffett/Fisher/Lynch scores out of 100 with "How calculated" expanders, model-generated 12-month scenarios, an editable CAGR calculator, a PDF download (vendored jsPDF, MIT), and tappable `?` glossary popovers (`glossary.js`, plus the `#glossary` page). Missing data is shown as NA and is never estimated. Educational only, not personal investment advice.
