# Data Pipeline

Organized Python scripts for fetching and processing neighborhood data.

## Directory Structure

```
data/
├── pipelines/
│   ├── weather/       ← Temperature, humidity, air quality (Open-Meteo)
│   ├── amenities/     ← Schools, hospitals, parks, metro (Overpass API)
│   ├── localities/    ← Neighborhood boundaries from OSM
│   ├── listings/      ← Rental listings (NoBroker scraper)
│   ├── sentiment/     ← Reddit sentiment analysis
│   └── scoring/       ← Combine all data into livability scores
├── utils/
│   ├── loader.py      ← Load locality data
│   ├── api_client.py  ← API requests with retry logic
│   └── fileio.py      ← JSON file I/O helpers
├── raw/               ← Output data files (GeoJSON, JSON)
├── logs/              ← Execution logs
├── scripts/           ← Wrapper scripts (for backward compatibility)
└── requirements.txt   ← Python dependencies
```

## Running Pipelines

### Individual pipelines

```bash
# Weather + AQI data
python data/pipelines/weather/fetch.py

# Amenities (hospitals, schools, metro, etc.)
python data/pipelines/amenities/fetch.py

# Rental listings from NoBroker
python data/pipelines/listings/scrape.py --test  # Test mode (2 localities)
python data/pipelines/listings/scrape.py         # Production mode

# Reddit sentiment analysis
python data/pipelines/sentiment/fetch.py --names  # Update specific localities

# Neighborhood boundaries
python data/pipelines/localities/fetch.py

# Calculate livability scores
python data/pipelines/scoring/score.py
```

### Via wrapper scripts (for CI/CD)

Backward-compatible wrappers exist in `data/scripts/` that call the pipeline modules:

```bash
python data/scripts/fetch_weather.py
python data/scripts/scrape_listings.py --test
```

## Data Sources

| Pipeline | Source | API Rate Limit | Notes |
|----------|--------|---|---------|
| **weather** | Open-Meteo (free) | 10,000/day | No auth needed |
| **amenities** | Overpass API (free) | ~2 req/min | OSM data |
| **listings** | NoBroker (web scrape) | ~1 req/sec | Via Playwright |
| **sentiment** | Reddit API | PRAW limits | Requires credentials |
| **localities** | Hardcoded | N/A | Generated from coordinates |
| **scoring** | Local compute | N/A | Combines all data |

## Shared Utilities

### `utils/loader.py`
Load locality data from GeoJSON:
```python
from utils.loader import load_localities
localities = load_localities()  # Returns list of features
```

### `utils/fileio.py`
File I/O helpers:
```python
from utils.fileio import load_json, save_json, ensure_output_dir
data = load_json("data/raw/weather.json")
save_json(data, "data/raw/weather.json")
ensure_output_dir()  # Create data/raw/ if missing
```

### `utils/api_client.py`
HTTP requests with retry logic:
```python
from utils.api_client import request_with_retry, rate_limited_request
response = request_with_retry(url, method="POST", max_retries=3)
response = rate_limited_request(url, delay=1.0)
```

## Adding a New Data Source

1. Create a new pipeline directory:
   ```bash
   mkdir -p data/pipelines/mydata
   touch data/pipelines/mydata/__init__.py
   ```

2. Implement your pipeline:
   ```python
   # data/pipelines/mydata/fetch.py
   import sys
   from pathlib import Path
   
   sys.path.insert(0, str(Path(__file__).parent.parent.parent))
   from utils.fileio import ensure_output_dir, save_json
   from utils.loader import load_localities
   
   ensure_output_dir()
   localities = load_localities()
   
   # Your fetching logic here...
   
   save_json(results, "data/raw/mydata.json")
   ```

3. Add wrapper script (optional):
   ```bash
   cat > data/scripts/fetch_mydata.py << 'EOF'
   #!/usr/bin/env python3
   import subprocess, sys
   result = subprocess.run([sys.executable, "data/pipelines/mydata/fetch.py"], cwd=".")
   sys.exit(result.returncode)
   EOF
   ```

4. Integrate into scoring pipeline if needed (edit `scoring/score.py`)

## Testing

```bash
# Run specific tests
python -m pytest __tests__/unit/  # (future: once pytest is integrated)

# Scraper test mode
python data/pipelines/listings/scrape.py --test  # Tests on 2 localities

# Debug mode
python data/pipelines/listings/scrape.py --debug  # Saves screenshots
```

## Environment Variables

Create `.env` in the root for pipeline configuration:

```
# No environment variables required for open data sources
# (weather, amenities, localities, sentiment)

# For advanced usage:
OVERPASS_API_TIMEOUT=90      # Overpass timeout (seconds)
NBROKER_HEADLESS=true        # Playwright headless mode
```

## Maintenance

### Regular Runs

GitHub Actions run on schedule:
- **Weather**: Daily (GitHub Actions: `update-weather.yml`)
- **Listings**: Daily (GitHub Actions: `scrape-listings.yml`)
- **Sentiment**: Weekly (GitHub Actions: `update-sentiment.yml`)

### Manual Refresh

```bash
# Activate venv first
source .venv/bin/activate

# Full pipeline (in order)
python data/pipelines/localities/fetch.py
python data/pipelines/amenities/fetch.py
python data/pipelines/weather/fetch.py
python data/pipelines/sentiment/fetch.py
python data/pipelines/listings/scrape.py
python data/pipelines/scoring/score.py

# Copy scored data to web
cp data/raw/localities_scored.geojson web/public/
```

---

**Last updated:** April 18, 2026
