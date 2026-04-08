# Bengaluru Neighbourhood Explorer — Full Codebase Guide

> **Purpose of this doc:** Give any LLM (or a human) a complete mental model of what this project does, how the code is structured, and where everything lives. Read top to bottom before touching any code.

---

## 1. What Is This?

A map-based web app for people moving to or within Bengaluru. It lets you explore ~100 neighbourhoods (localities) and compare them by a **livability score** made up of 4 factors:

| Factor | Weight (default) | Data source |
|---|---|---|
| Air quality (AQI) | 15% | OpenWeatherMap API |
| Amenities (hospitals, schools, supermarkets) | 45% | OpenStreetMap Overpass API |
| Transit access (metro + rail stations + bus stops) | 25% | OpenStreetMap Overpass API |
| Restaurants | 15% | OpenStreetMap Overpass API |

Users can **drag sliders** to change those weights in real time — the scores and map colours update instantly without reloading.

Additionally, when you click a locality, you can toggle on **rental listings** pulled from NoBroker.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER                           │
│                                                                 │
│  Next.js page (page.tsx) — one single-page app                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  MapLibre GL map (renders GeoJSON polygons + colours)    │  │
│  │  Left sidebar: weight sliders, filter chips, search bar  │  │
│  │  Right panel (drawer): locality detail sheet             │  │
│  │    └─ scores, raw data, sentiment, rental listings       │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────────────┘
                     │  fetch() calls
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                   NEXT.JS API ROUTES (server)                   │
│                                                                 │
│  /api/listings    → reads rental rows from Supabase            │
│  /api/route-time  → proxies OSRM for driving/walking time      │
│  /api/signup      → stores email in Supabase (anon insert)     │
└──────────┬──────────────────────────────────────────────────────┘
           │  Supabase JS SDK                 │  fetch to OSRM
           ▼                                  ▼
┌─────────────────────┐          ┌────────────────────────────┐
│  Supabase (Postgres) │         │  router.project-osrm.org   │
│  tables:             │         │  (public demo server)      │
│    listings          │         └────────────────────────────┘
│    signups           │
└─────────────────────┘
           ▲
           │  weekly Python cron job (runs on your Mac)
           │
┌─────────────────────────────────────────────────────────────────┐
│                    DATA PIPELINE (Python)                       │
│                                                                 │
│  scrape_listings.py                                             │
│  └─ Playwright (headless Chromium)                              │
│     ├─ NoBroker HTML pages → parses embedded JSON              │
│     └─ upserts rows into Supabase listings table               │
└─────────────────────────────────────────────────────────────────┘
```

### What loads from where (static vs dynamic)

```
Static (bundled with the app — zero API calls):
  localities_scored.geojson   ← all 100 locality polygons + scores
  sentiment.json              ← Reddit sentiment per locality
  localities_small.geojson    ← simplified version for mobile

Dynamic (API calls at runtime):
  /api/listings               ← rental listings (reads Supabase)
  /api/route-time             ← commute time calculator (OSRM)
  /api/signup                 ← email gate
  MapTiler CDN                ← basemap tiles (Carto Positron style)
```

---

## 3. Folder Structure

```
blr-neighborhood-explorer/
│
├── data/                         ← Python data pipeline
│   ├── raw/                      ← output files from pipeline scripts
│   │   ├── localities_scored.geojson   ← THE main data file (100 localities)
│   │   ├── localities_small.geojson    ← simplified for mobile
│   │   ├── amenities.json              ← OSM amenity counts per locality
│   │   ├── weather.json                ← AQI + temp per locality
│   │   └── sentiment.json              ← Reddit sentiment per locality
│   └── scripts/
│       ├── get_localities.py           ← fetch locality boundaries from OSM
│       ├── fetch_amenities.py          ← count amenities via Overpass API
│       ├── fetch_weather.py            ← fetch AQI + temp from OpenWeatherMap
│       ├── fetch_sentiment.py          ← scrape Reddit, VADER sentiment
│       ├── score_localities.py         ← combine all data → localities_scored.geojson
│       ├── scrape_listings.py          ← Playwright: scrape NoBroker → Supabase
│       ├── run_weekly_scrape.sh        ← shell wrapper for the cron job
│       └── com.blr-explorer.weekly-scrape.plist  ← macOS launchd config
│
├── web/                          ← Next.js app
│   ├── app/
│   │   ├── layout.tsx            ← root layout (fonts, analytics, metadata)
│   │   ├── page.tsx              ← THE ENTIRE FRONTEND (one big client component)
│   │   ├── globals.css           ← global CSS (Tailwind base + keyframes)
│   │   └── api/
│   │       ├── listings/route.ts     ← GET  /api/listings?locality=X
│   │       ├── route-time/route.ts   ← POST /api/route-time
│   │       └── signup/route.ts       ← POST /api/signup
│   ├── lib/
│   │   ├── supabase-server.ts    ← Supabase client (service_role, server-only)
│   │   ├── rate-limit.ts         ← in-process sliding window rate limiter
│   │   └── scrapers/
│   │       ├── types.ts          ← shared Listing type
│   │       ├── nobroker.ts       ← HTML scraper for NoBroker (not used yet in API)
│   │       └── housing.ts        ← Housing.com scraper (broken — site is CSR now)
│   ├── public/
│   │   ├── localities_scored.geojson   ← copy of data/raw/ — served statically
│   │   ├── localities_small.geojson    ← copy of data/raw/
│   │   └── sentiment.json              ← copy of data/raw/
│   ├── scripts/
│   │   ├── test-nobroker.mjs     ← smoke test for NoBroker scraper
│   │   └── test-scrapers.mjs     ← smoke test for both scrapers
│   ├── .env.local                ← secrets (never committed)
│   ├── next.config.ts            ← security headers, Next.js config
│   └── package.json
│
├── BACKLOG.md                    ← feature backlog
└── README.md
```

---

## 4. The Scoring System

The scoring pipeline lives entirely in Python and runs **offline** (not at runtime). You only re-run it when you want to refresh the data.

```
Step 1: get_localities.py
  → Queries Overpass API for Bengaluru locality boundaries
  → Outputs: data/raw/localities.geojson

Step 2: fetch_amenities.py
  → For each locality, counts hospitals, schools, supermarkets, restaurants
    via Overpass API radius searches
  → Outputs: data/raw/amenities.json

Step 3: fetch_weather.py
  → For each locality centroid, fetches AQI + temperature from OpenWeatherMap
  → Outputs: data/raw/weather.json

Step 4: fetch_sentiment.py
  → Scrapes Reddit posts mentioning each locality
  → Runs VADER sentiment analysis
  → Outputs: data/raw/sentiment.json

Step 5: score_localities.py
  → Combines all data above
  → Computes a weighted composite score (1.0–9.5 scale)
  → Outputs: data/raw/localities_scored.geojson
             (also copy to web/public/)
```

### Scoring formula

```
raw_score = (
  air_quality_score  × 0.15  +
  amenities_score    × 0.45  +
  metro_score        × 0.25  +
  restaurant_score   × 0.15
)

# Normalised to 1.0–9.5 range:
overall_score = 1.0 + (raw_score - RAW_MIN) / (RAW_MAX - RAW_MIN) × 8.5
```

When a user drags sliders in the UI, the browser **recomputes** the score on the fly using the same formula (no API call), using the same normalisation constants (`SCORE_RAW_MIN = 1.3`, `SCORE_RAW_MAX = 7.4`).

---

## 5. The Frontend (page.tsx)

The entire UI is one React client component. Key sections:

```
page.tsx
│
├── State variables
│   ├── weights          — current slider values (default 0.15/0.45/0.25/0.15)
│   ├── selectedLocality — which locality the user clicked
│   ├── scoreFilter      — "all" | "great" | "good" | "low"
│   ├── sentimentData    — loaded from /sentiment.json
│   └── emailGated       — whether user has passed the email gate
│
├── Map setup (useEffect)
│   ├── Loads MapLibre GL
│   ├── Adds Carto Positron basemap via MapTiler CDN
│   ├── Loads localities_scored.geojson as a GeoJSON source
│   ├── Paints polygons with colour based on overall_score
│   └── onClick → sets selectedLocality
│
├── Score recomputation (recomputeScore function)
│   └── Called every time weights change — recalculates all scores,
│       updates map polygon colours, updates sidebar list
│
├── ListingsPanel component
│   ├── Calls GET /api/listings?locality=X when user enables the toggle
│   ├── Shows price filter (any / <20k / <30k / <50k)
│   └── Renders listing cards with source badge (NoBroker green / Housing purple)
│
└── Email gate
    └── Shows modal before first use, POSTs to /api/signup
```

### Map colour scale

```
Score ≥ 7   →  #22c55e  (dark green)  "Great"
Score 5–7   →  #86efac  (light green)
Score 4–5   →  #fde68a  (yellow)
Score 3–4   →  #fb923c  (orange)
Score < 3   →  #ef4444  (red)         "Low"
Hovered     →  +20% opacity on top
```

---

## 6. API Routes

### GET /api/listings?locality=Koramangala

```
1. Rate limit check (30 req/min per IP)
2. Validate locality param (alphanumeric + spaces/hyphens, max 80 chars)
3. If locality == "_test_" → return 5 deterministic mock listings (for UI testing)
4. Query Supabase:
   SELECT id, locality, source, source_id, source_url, title, price,
          deposit, area_sqft, bhk, property_type, furnishing,
          lat, lon, address, images, fetched_at
   FROM listings
   WHERE locality = $1
   ORDER BY price ASC
   LIMIT 60
5. Return JSON
```

Response shape:
```json
{
  "listings": [ { "id": "...", "price": 28000, "bhk": 2, "source": "nobroker", ... } ],
  "cached": true,
  "fetchedAt": "2026-04-06T03:00:00Z",
  "sources": []
}
```

### POST /api/route-time

```
Body: { originLat, originLon, destLat, destLon, profile: "driving"|"foot" }

1. Rate limit check (60 req/min per IP)
2. Validate all coords are finite numbers within Bengaluru bounding box
3. Proxy to OSRM public demo server (driving profile only)
4. For "foot", calculate walking time from road distance (÷ 5km/h)
5. Return { durationMin, distanceKm }
```

### POST /api/signup

```
Body: { email: "user@example.com" }

1. Rate limit check (5 attempts per IP per 10 min)
2. Validate email format (RFC compliant, max 254 chars)
3. If SUPABASE_ANON_KEY not set → silently succeed (email gate still works)
4. POST to Supabase REST API with "resolution=ignore-duplicates"
   (ON CONFLICT DO NOTHING — compatible with INSERT-only RLS)
```

---

## 7. Supabase Database

### Tables

**`listings`** — rental listings scraped from NoBroker

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | auto-generated |
| locality | text | matches GeoJSON locality name exactly |
| source | text | `"nobroker"` or `"housing"` |
| source_id | text | platform's own property ID |
| source_url | text | link to the original listing |
| title | text | e.g. "2BHK in Koramangala" |
| price | int | monthly rent in INR |
| deposit | int | security deposit in INR (nullable) |
| area_sqft | float | (nullable) |
| bhk | int | 1, 2, or 3 (nullable) |
| property_type | text | "apartment", "villa", etc. (nullable) |
| furnishing | text | "furnished" / "semi-furnished" / "unfurnished" (nullable) |
| lat | float | (nullable) |
| lon | float | (nullable) |
| address | text | (nullable) |
| images | text[] | array of image URLs (nullable) |
| fetched_at | timestamptz | when scraper ran |

Unique constraint: `(source, source_id)` — upsert deduplicates on this.

**`signups`** — email gate

| Column | Type |
|---|---|
| id | bigint (PK) |
| email | text (unique) |
| created_at | timestamptz |

RLS: anon key can INSERT only (no reads, no updates, no deletes).

### Supabase keys used

```
SUPABASE_URL          = https://xxxx.supabase.co
SUPABASE_SECRET_KEY   = service_role key → used by /api/listings (bypasses RLS)
SUPABASE_ANON_KEY     = anon key         → used by /api/signup (respects RLS)
```

The service_role key is **never** sent to the browser. It's only used in server-side API routes.

---

## 8. The Listings Pipeline (Data Flow)

```
                    ┌─────────────────────────────────────────┐
                    │         WEEKLY CRON (macOS launchd)     │
                    │         Every Sunday 03:00 AM           │
                    └──────────────┬──────────────────────────┘
                                   │  runs
                                   ▼
                    run_weekly_scrape.sh
                          │
                          │  calls python with --wipe flag
                          ▼
                    scrape_listings.py --wipe
                          │
                          ├─ Step 1: DELETE all rows from listings table
                          │
                          └─ Step 2: For each locality (100 total):
                               │
                               ├─ Open headless Chromium (Playwright)
                               ├─ Navigate to NoBroker locality page
                               ├─ Wait 6s for JS to hydrate
                               ├─ Parse embedded JSON from HTML
                               │   ("listPageProperties" array)
                               ├─ Extract: price, BHK, area, furnishing,
                               │           lat/lon, address, photos
                               └─ UPSERT into Supabase listings table
                                   (dedup on source + source_id)
```

**Why Playwright and not the TypeScript fetcher?**
The TypeScript `nobroker.ts` scraper works great for the simple listing page. But the Python script uses Playwright (real browser) which is more robust against JS-gated content and can handle Housing.com (which is now fully CSR). The TS scrapers exist for potential future on-demand fetching from the API route.

---

## 9. Security Model

```
┌─────────────────────────────────────────────────────────────────┐
│                     SECURITY LAYERS                             │
│                                                                 │
│  1. HTTP Security Headers (next.config.ts)                     │
│     X-Frame-Options: DENY                (no clickjacking)     │
│     X-Content-Type-Options: nosniff      (no MIME sniffing)    │
│     Strict-Transport-Security: 2yr       (force HTTPS)         │
│     Content-Security-Policy             (no inline JS from CDN)│
│     Permissions-Policy                  (disable camera/mic)   │
│                                                                 │
│  2. Rate Limiting  (lib/rate-limit.ts)                         │
│     /api/listings  → 30 req / 1 min / IP                       │
│     /api/route-time → 60 req / 1 min / IP                      │
│     /api/signup    → 5 req / 10 min / IP                       │
│                                                                 │
│  3. Input Validation                                            │
│     locality param → regex + length check                       │
│     coordinates → finite numbers, Bengaluru bounding box       │
│     email → RFC format, max 254 chars                          │
│                                                                 │
│  4. XSS Protection (page.tsx)                                   │
│     safeHref() → rejects javascript: URLs from listing DB      │
│     Only https: and http: schemes allowed as hrefs             │
│                                                                 │
│  5. Supabase RLS                                                │
│     listings table → service_role only (API route)             │
│     signups table  → anon insert-only (RLS policy)             │
│                                                                 │
│  6. Key separation                                              │
│     service_role key → server-side only (never in browser)     │
│     anon key → signup route only (RLS enforces limits)         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. Environment Variables (.env.local)

```bash
# Required for listings to show
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SECRET_KEY=eyJxxx...   # service_role key

# Required for email signups to be stored (optional — gate still works without it)
SUPABASE_ANON_KEY=eyJxxx...     # anon key

# Required for the map to render
NEXT_PUBLIC_MAPTILER_KEY=xxxx   # MapTiler API key (safe to be public)
```

---

## 11. Key Files Quick Reference

| File | What it does |
|---|---|
| `web/app/page.tsx` | Entire frontend — map, sidebar, listings, email gate |
| `web/app/api/listings/route.ts` | Serves rental listings from Supabase |
| `web/app/api/route-time/route.ts` | Commute time calculator (proxies OSRM) |
| `web/app/api/signup/route.ts` | Email capture with RLS |
| `web/lib/supabase-server.ts` | Supabase client singleton (service_role) |
| `web/lib/rate-limit.ts` | In-process sliding window rate limiter |
| `web/lib/scrapers/nobroker.ts` | NoBroker HTML scraper (TS, not yet wired to API) |
| `web/lib/scrapers/housing.ts` | Housing.com scraper (broken — site went CSR) |
| `web/lib/scrapers/types.ts` | `Listing` type shared by all scrapers + API |
| `web/next.config.ts` | Security headers, React compiler |
| `web/public/localities_scored.geojson` | Static: all locality polygons + scores |
| `web/public/sentiment.json` | Static: Reddit sentiment per locality |
| `data/scripts/scrape_listings.py` | Python Playwright scraper → Supabase |
| `data/scripts/run_weekly_scrape.sh` | Shell wrapper: wipe + scrape |
| `data/scripts/com.blr-explorer.weekly-scrape.plist` | macOS launchd cron (every Sunday 3AM) |
| `data/scripts/score_localities.py` | Scoring pipeline → localities_scored.geojson |
| `BACKLOG.md` | Feature backlog |

---

## 12. How to Run Things

### First-time setup

```bash
# Install Python deps
cd /Users/gauravpatwardhan/blr-neighborhood-explorer
python -m venv .venv
source .venv/bin/activate
pip install playwright supabase requests praw vaderSentiment
playwright install chromium

# Install Node deps
cd web
npm install
```

### Start the web app locally

```bash
cd web
npm run dev
# Open http://localhost:3000
```

### Test rental listings UI (no Supabase needed)

In the browser, pick a locality and manually set the locality to `_test_` in the API call, or click any locality — if Supabase is seeded you'll see results.

### Seed Supabase with listings (first run)

```bash
cd /Users/gauravpatwardhan/blr-neighborhood-explorer
source .venv/bin/activate
python data/scripts/scrape_listings.py --wipe
# Takes ~10-15 mins for all 100 localities
```

### Install the weekly cron (one-time)

```bash
cp data/scripts/com.blr-explorer.weekly-scrape.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.blr-explorer.weekly-scrape.plist
# Verify it's registered:
launchctl list | grep blr-explorer
```

### Re-run the scoring pipeline (when data is stale)

```bash
cd /Users/gauravpatwardhan/blr-neighborhood-explorer
source .venv/bin/activate
python data/scripts/fetch_amenities.py
python data/scripts/fetch_weather.py
python data/scripts/fetch_sentiment.py
python data/scripts/score_localities.py
# Then copy outputs to web/public/
cp data/raw/localities_scored.geojson web/public/
cp data/raw/sentiment.json web/public/
```

---

## 13. Known Issues / Limitations

| Issue | Status |
|---|---|
| Housing.com is now CSR (no `__NEXT_DATA__`) | `housing.ts` broken — use Python+Playwright for it instead |
| NoBroker TS scraper not wired to API route | BACKLOG — live on-demand fetch |
| Rate limiter is in-process | Resets on every serverless cold start; for multi-server deploys, replace with Redis/Upstash |
| OSRM is a public demo server | May be slow/unreliable; replace with self-hosted OSRM or Google Routes API for production |
| `SUPABASE_ANON_KEY` not set | Signup emails are silently dropped (email gate still works to block access) |

---

## 14. Data Flow Summary

```
USER ACTION                   WHAT HAPPENS
─────────────────────────────────────────────────────────────────
Open the app                  Loads localities_scored.geojson + sentiment.json
                              from /public/ (static, instant)

Drag a weight slider          React recalculates scores in-browser
                              Updates map polygon colours (no API call)

Click a locality              Shows detail drawer with scores + raw data
                              Fetches sentiment from already-loaded JSON

Enable listings toggle        GET /api/listings?locality=X
                              → reads pre-scraped rows from Supabase
                              → shows rental cards

Use commute calculator        POST /api/route-time with two coord pairs
                              → proxies to OSRM → returns drive/walk time

First visit (email gate)      POST /api/signup → stores email in Supabase
                              → sets localStorage flag → never shows again

Weekly Sunday 3AM             launchd triggers run_weekly_scrape.sh
                              → Python + Playwright → DELETE all listings
                              → scrape NoBroker for 100 localities
                              → UPSERT into Supabase
```
