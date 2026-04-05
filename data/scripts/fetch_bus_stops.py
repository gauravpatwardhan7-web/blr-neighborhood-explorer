"""
Patch script: adds bus_stops count to every entry in amenities.json.
Safe to re-run — skips localities that already have the field.
"""
import requests
import json
import time
from pathlib import Path

AMENITIES_PATH = Path("data/raw/amenities.json")
RADIUS = 1500
MAX_RETRIES = 3


def fetch_bus_stops(lat: float, lon: float) -> int:
    query = f"""
    [out:json][timeout:60];
    (
      nwr["highway"="bus_stop"](around:{RADIUS},{lat},{lon});
      nwr["public_transport"="stop_position"]["bus"="yes"](around:{RADIUS},{lat},{lon});
    );
    out count;
    """
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(
                "https://overpass-api.de/api/interpreter",
                data=query,
                timeout=90,
            )
            resp.raise_for_status()
            data = resp.json()
            # "out count" returns a single element with tag "total"
            total = data.get("elements", [{}])[0].get("tags", {}).get("total", 0)
            return int(total)
        except Exception as e:
            if attempt == MAX_RETRIES:
                raise
            wait = 10 * attempt
            print(f"  Attempt {attempt} failed ({e}). Retrying in {wait}s…")
            time.sleep(wait)
    return 0


def main():
    with open(AMENITIES_PATH) as f:
        entries = json.load(f)

    patched = 0
    for entry in entries:
        if "bus_stops" in entry:
            print(f"  skip {entry['name']} (already patched)")
            continue

        name = entry["name"]
        lat  = entry["lat"]
        lon  = entry["lon"]
        print(f"Fetching bus stops for {name}…", end=" ", flush=True)
        try:
            count = fetch_bus_stops(lat, lon)
            entry["bus_stops"] = count
            print(f"{count} stops")
            patched += 1
            # persist after every success so progress isn't lost
            with open(AMENITIES_PATH, "w") as f:
                json.dump(entries, f, indent=2)
            time.sleep(2)
        except Exception as e:
            print(f"ERROR: {e}")
            entry["bus_stops"] = 0

    with open(AMENITIES_PATH, "w") as f:
        json.dump(entries, f, indent=2)

    print(f"\nDone. Patched {patched} localities.")


if __name__ == "__main__":
    main()
