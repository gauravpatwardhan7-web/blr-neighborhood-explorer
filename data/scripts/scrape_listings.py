"""
Rental listings scraper using Playwright (real browser) to bypass bot detection.

Usage:
    python data/scripts/scrape_listings.py            # all localities
    python data/scripts/scrape_listings.py --test     # 2 localities only
"""

import base64
import json
import os
import re
import sys
import time
from pathlib import Path

# Load env from web/.env.local
env_path = Path(__file__).parent.parent.parent / "web" / ".env.local"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SECRET_KEY") or
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
)
if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("ERROR: Set SUPABASE_URL and SUPABASE_SECRET_KEY")

from supabase import create_client
from playwright.sync_api import sync_playwright

db = create_client(SUPABASE_URL, SUPABASE_KEY)

# Load locality list with centroids from GeoJSON
geojson_path = Path(__file__).parent.parent / "raw" / "localities_scored.geojson"
with open(geojson_path) as f:
    features = json.load(f)["features"]

def _centroid(feat):
    geom = feat["geometry"]
    if geom["type"] == "Point":
        return geom["coordinates"][1], geom["coordinates"][0]
    coords = geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return sum(lats)/len(lats), sum(lons)/len(lons)

LOCALITY_MAP = {}
for feat in features:
    name = feat["properties"]["name"]
    lat, lon = _centroid(feat)
    LOCALITY_MAP[name] = {"lat": lat, "lon": lon}

LOCALITIES = list(LOCALITY_MAP.keys())


def nobroker_url(locality):
    coords = LOCALITY_MAP.get(locality, {"lat": 12.9716, "lon": 77.5946})
    param = base64.b64encode(json.dumps([{
        "lat": round(coords["lat"], 7),
        "lon": round(coords["lon"], 7),
        "placeId": "",
        "placeName": locality,
    }]).encode()).decode()
    enc = locality.replace(" ", "%20")
    return (
        f"https://www.nobroker.in/property/rent/bangalore/{enc}"
        f"?searchParam={param}&radius=2.0&sharedAccomodation=0&city=bangalore&locality={enc}"
    )


def parse_price(text):
    text = text.replace(",", "").replace("₹", "").replace(" ", "").lower()
    m = re.search(r"([\d.]+)\s*([lk]?)", text)
    if not m:
        return None
    val = float(m.group(1))
    s = m.group(2)
    if s == "l": val *= 100_000
    elif s == "k": val *= 1_000
    return int(val) if val > 0 else None


def parse_bhk(text):
    m = re.search(r"(\d+)\s*(?:bhk|bed|bedroom)", text, re.IGNORECASE)
    return int(m.group(1)) if m else None


def parse_area(text):
    m = re.search(r"([\d,]+)\s*(?:sq\.?\s*ft|sqft)", text, re.IGNORECASE)
    return float(m.group(1).replace(",", "")) if m else None


def scrape_nobroker(page, locality):
    url = nobroker_url(locality)
    print(f"  URL: {url[:120]}")
    listings = []
    captured = []

    def handle_response(response):
        try:
            url_r = response.url
            if "nobroker.in" in url_r and response.status == 200 and (
                "property/list" in url_r or "search" in url_r or "propertyList" in url_r
            ):
                try:
                    data = response.json()
                    if isinstance(data, dict) and data:
                        captured.append(data)
                except Exception:
                    pass
        except Exception:
            pass

    page.on("response", handle_response)

    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        time.sleep(6)  # let XHR calls complete

        html = page.content()

        # NoBroker embeds listing data as SSR JSON in the HTML.
        # Field names discovered by probing: rent, deposit, propertySize,
        # type (BHK1/BHK2…), furnishingDesc, ownerId, localityTruncated
        rents     = re.findall(r'"rent"\s*:\s*(\d+)', html)
        deposits  = re.findall(r'"deposit"\s*:\s*(\d+)', html)
        sizes     = re.findall(r'"propertySize"\s*:\s*(\d+)', html)
        types     = re.findall(r'"type"\s*:\s*"(BHK\d+|RK)"', html)
        furns     = re.findall(r'"furnishingDesc"\s*:\s*"([^"]+)"', html)
        owner_ids = re.findall(r'"ownerId"\s*:\s*"([^"]+)"', html)
        lats      = re.findall(r'"latitude"\s*:\s*([\d.]+)', html)
        lons      = re.findall(r'"longitude"\s*:\s*([\d.]+)', html)

        print(f"  Found: {len(rents)} rents, {len(types)} types, {len(owner_ids)} ownerIds")

        for i, rent_str in enumerate(rents[:25]):
            price = int(rent_str)
            if price < 1000:
                continue
            bhk_raw = types[i] if i < len(types) else ""
            bhk_m = re.search(r"(\d+)", bhk_raw)
            bhk = int(bhk_m.group(1)) if bhk_m else None
            furn = furns[i].lower() if i < len(furns) else ""
            oid = owner_ids[i] if i < len(owner_ids) else f"nb-{locality}-{i}"
            listings.append({
                "locality": locality,
                "source": "nobroker",
                "source_id": oid,
                "source_url": f"https://www.nobroker.in/property/rent/bangalore/{locality.replace(' ', '%20')}",
                "title": f"{bhk or '?'}BHK in {locality}",
                "price": price,
                "deposit": int(deposits[i]) if i < len(deposits) else None,
                "area_sqft": float(sizes[i]) if i < len(sizes) else None,
                "bhk": bhk,
                "furnishing": (
                    "furnished" if "full" in furn
                    else "semi-furnished" if "semi" in furn
                    else "unfurnished" if furn
                    else None
                ),
                "lat": float(lats[i]) if i < len(lats) else None,
                "lon": float(lons[i]) if i < len(lons) else None,
            })

        # Fallback: scrape DOM cards if API interception got nothing
        if not listings:
            cards = page.query_selector_all("[data-postid]")
            print(f"  DOM fallback: {len(cards)} cards")
            for card in cards[:20]:
                try:
                    pid = card.get_attribute("data-postid") or ""
                    txt = card.inner_text()
                    price_el = card.query_selector("[class*='price'],[class*='Price']")
                    price = parse_price(price_el.inner_text()) if price_el else parse_price(txt)
                    if not price:
                        continue
                    listings.append({
                        "locality": locality,
                        "source": "nobroker",
                        "source_id": pid or f"nb-{locality}-{len(listings)}",
                        "source_url": f"https://www.nobroker.in/property/residential/rent/bangalore/?postId={pid}",
                        "title": f"{parse_bhk(txt) or '?'}BHK in {locality}",
                        "price": price,
                        "area_sqft": parse_area(txt),
                        "bhk": parse_bhk(txt),
                    })
                except Exception:
                    continue

    except Exception as e:
        print(f"  ERROR: {e}")
    finally:
        page.remove_listener("response", handle_response)

    print(f"  → {len(listings)} listings")
    return listings


def upsert_listings(listings):
    if not listings:
        return 0
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    # Deduplicate by source_id within this batch
    seen = {}
    for l in listings:
        if l.get("price") and l.get("source_id"):
            seen[l["source_id"]] = {**l, "fetched_at": now}
    rows = list(seen.values())
    if not rows:
        return 0
    db.table("listings").upsert(rows, on_conflict="source,source_id").execute()
    return len(rows)


def wipe_listings():
    """Delete ALL rows from the listings table before a fresh scrape."""
    import requests
    from datetime import datetime, timezone
    print(f"  Wiping listings table … ", end="", flush=True)
    # Use the REST API directly — the Python client can hang on large deletes.
    # fetched_at >= 2000-01-01 matches every real row (service_role bypasses RLS).
    res = requests.delete(
        f"{SUPABASE_URL}/rest/v1/listings",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "return=minimal",
        },
        params={"fetched_at": "gte.2000-01-01"},
        timeout=30,
    )
    if res.status_code not in (200, 204):
        print(f"WARNING: wipe returned HTTP {res.status_code}: {res.text[:200]}")
    else:
        print(f"done at {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")


def main():
    test_mode = "--test" in sys.argv
    save_mode = "--save" in sys.argv  # --test --save to upsert during test
    wipe_mode = "--wipe" in sys.argv  # delete all rows before scraping
    to_scrape = ["Koramangala", "Indiranagar", "HSR Layout"] if test_mode else LOCALITIES
    print(f"\n{'[TEST] ' if test_mode else ''}Scraping {len(to_scrape)} localities\n")

    if wipe_mode and not test_mode:
        wipe_listings()

    total = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900},
            locale="en-IN",
        )
        page = ctx.new_page()

        for i, locality in enumerate(to_scrape):
            print(f"\n[{i+1}/{len(to_scrape)}] {locality}")
            listings = scrape_nobroker(page, locality)

            if test_mode:
                for l in listings[:3]:
                    print(f"    ₹{l['price']:,}/mo | {l.get('bhk')}BHK | {l.get('area_sqft')} sqft | {l.get('furnishing')}")
                if save_mode:
                    saved = upsert_listings(listings)
                    total += saved
                    print(f"  → Upserted {saved} to Supabase")
            else:
                saved = upsert_listings(listings)
                total += saved
                print(f"  Saved {saved}")

            time.sleep(3)

        browser.close()

    print(f"\n{'Test' if test_mode else 'Done'}. Total upserted: {total}")


def debug_screenshot():
    """Run with --debug to take a screenshot and dump page info for one locality."""
    import base64 as b64
    api_calls = []

    def log_response(response):
        try:
            if "nobroker.in" in response.url and response.status == 200:
                api_calls.append((response.status, response.url))
        except Exception:
            pass

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900},
            locale="en-IN",
        )
        page = ctx.new_page()
        page.on("response", log_response)
        url = nobroker_url("Koramangala")
        print("Navigating to:", url[:100])
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        time.sleep(6)
        page.screenshot(path="/tmp/nobroker_debug.png")
        print("Title:", page.title())
        html = page.content()
        print("HTML length:", len(html))
        body = page.inner_text("body")
        print("Body (first 800 chars):\n", body[:800])
        # Check for any price/rent data
        import re as _re
        rents = _re.findall(r'"PROP_RENT"\s*:\s*([\d.]+)', html)
        print("PROP_RENT values:", rents[:5])
        # Dump for offline inspection
        with open("/tmp/nobroker_page.html", "w") as f:
            f.write(html)
        print("HTML dumped to /tmp/nobroker_page.html")
        # Search for price patterns
        price_patterns = _re.findall(r'50[,.]?000|13[,.]?000|"rent"\s*:\s*\d+|"price"\s*:\s*\d+', html)
        print("Price patterns found:", price_patterns[:5])
        # Check all nobroker API calls
        print(f"\nAll NoBroker API calls ({len(api_calls)}):")
        for status, u in api_calls:
            print(f"  [{status}] {u}")
        browser.close()
        print("\nScreenshot saved to /tmp/nobroker_debug.png")
        browser.close()
        print("\nScreenshot saved to /tmp/nobroker_debug.png")


if __name__ == "__main__":
    if "--debug" in sys.argv:
        debug_screenshot()
    else:
        main()
