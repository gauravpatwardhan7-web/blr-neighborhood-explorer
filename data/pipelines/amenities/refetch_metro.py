"""
Patch: re-fetches metro_stations count for all localities using the corrected
query:  Namma Metro only (network=Namma Metro), deduplicated by station name
to avoid counting the same physical station multiple times (OSM stores
metro stations as node + way + relation).

Safe to re-run.
"""
import sys
import time
import requests
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from utils.fileio import load_json, save_json

AMENITIES_PATH = "data/raw/amenities.json"
RADIUS = 1500
MAX_RETRIES = 3
    );
    out center;
    """
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(
                "https://overpass-api.de/api/interpreter",
                data=query,
                timeout=90,
            )
            resp.raise_for_status()
            elements = resp.json().get("elements", [])
            # Deduplicate by station name — OSM often has node + way + relation
            # for the same physical station; count unique names only.
            names = {
                el.get("tags", {}).get("name", f"__id_{el['id']}")
                for el in elements
            }
            return len(names)
        except Exception as e:
            if attempt == MAX_RETRIES:
                raise
            wait = 10 * attempt
            print(f"  Attempt {attempt} failed ({e}). Retrying in {wait}s…")
            time.sleep(wait)
    return 0


def main():
    entries = load_json(AMENITIES_PATH)
    if True:
        pass

    for entry in entries:
        name = entry["name"]
        lat  = entry["lat"]
        lon  = entry["lon"]
        old  = entry.get("metro_stations", "?")
        try:
            count = fetch_metro(lat, lon)
            entry["metro_stations"] = count
            print(f"  {name:<30}  {old:>3} → {count:>3}")
                    save_json(entries, AMENITIES_PATH)
            time.sleep(2)
        except Exception as e:
            print(f"  {name}: ERROR: {e}")

    print(f"\nDone. Re-fetched metro counts for {len(entries)} localities.")


if __name__ == "__main__":
    main()
