import requests
import json
import time
from pathlib import Path

Path("data/raw").mkdir(parents=True, exist_ok=True)

with open("data/raw/localities.geojson") as f:
    localities = json.load(f)["features"]

RADIUS = 1500
MAX_RETRIES = 3

def count_amenities(name, lat, lon):
    query = f"""
    [out:json][timeout:60];
    (
      nwr["amenity"="hospital"](around:{RADIUS},{lat},{lon});
      nwr["amenity"="pharmacy"](around:{RADIUS},{lat},{lon});
      nwr["shop"="supermarket"](around:{RADIUS},{lat},{lon});
      nwr["leisure"="park"](around:{RADIUS},{lat},{lon});
      nwr["amenity"="school"](around:{RADIUS},{lat},{lon});
      nwr["amenity"="restaurant"](around:{RADIUS},{lat},{lon});
      nwr["leisure"="fitness_centre"](around:{RADIUS},{lat},{lon});
      nwr["amenity"="atm"](around:{RADIUS},{lat},{lon});
      nwr["station"="subway"]["network"="Namma Metro"](around:{RADIUS},{lat},{lon});
      nwr["railway"="station"]["network"="Namma Metro"](around:{RADIUS},{lat},{lon});
    );
    out center;
    """
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.post(
                "https://overpass-api.de/api/interpreter",
                data=query,
                timeout=90
            )
            response.raise_for_status()
            data = response.json()
            if "elements" not in data:
                raise ValueError(f"Unexpected response: {data}")
            break
        except Exception as e:
            if attempt == MAX_RETRIES:
                raise
            wait = 10 * attempt
            print(f"    Attempt {attempt} failed ({e}). Retrying in {wait}s...")
            time.sleep(wait)
    elements = data.get("elements", [])

    counts = {
        "hospitals": 0, "pharmacies": 0, "supermarkets": 0,
        "parks": 0, "schools": 0, "restaurants": 0,
        "gyms": 0, "atms": 0, "metro_stations": 0
    }
    metro_names: set[str] = set()  # deduplicate by name (OSM has node+way+relation for same station)

    for el in elements:
        tags = el.get("tags", {})
        amenity = tags.get("amenity", "")
        shop    = tags.get("shop", "")
        leisure = tags.get("leisure", "")
        railway = tags.get("railway", "")
        station = tags.get("station", "")

        if amenity == "hospital":       counts["hospitals"] += 1
        elif amenity == "pharmacy":     counts["pharmacies"] += 1
        elif amenity == "school":       counts["schools"] += 1
        elif amenity == "restaurant":   counts["restaurants"] += 1
        elif amenity == "atm":          counts["atms"] += 1
        elif shop == "supermarket":     counts["supermarkets"] += 1
        elif leisure == "park":         counts["parks"] += 1
        elif leisure == "fitness_centre": counts["gyms"] += 1
        elif (station == "subway" or railway == "station") and tags.get("network") == "Namma Metro":
            metro_names.add(tags.get("name", f"__id_{el['id']}"))

    counts["metro_stations"] = len(metro_names)
    return counts

output_path = "data/raw/amenities.json"

# Resume: load already-fetched localities so we can skip them
if Path(output_path).exists():
    with open(output_path) as f:
        all_results = json.load(f)
else:
    all_results = []

already_fetched = {r["name"] for r in all_results}

for feature in localities:
    name = feature["properties"]["name"]
    lat  = feature["properties"]["lat"]
    lon  = feature["properties"]["lon"]

    if name in already_fetched:
        print(f"Skipping {name} (already fetched)")
        continue

    print(f"Fetching amenities for {name}...")
    try:
        counts = count_amenities(name, lat, lon)
        row = {"name": name, "lat": lat, "lon": lon, **counts}
        all_results.append(row)
        already_fetched.add(name)
        print(f"  ✓ {name}: {counts['hospitals']} hospitals, {counts['schools']} schools, {counts['supermarkets']} supermarkets, {counts['metro_stations']} metro")
        # Save after every successful fetch so progress isn't lost
        with open(output_path, "w") as f:
            json.dump(all_results, f, indent=2)
        time.sleep(3)
    except Exception as e:
        print(f"  ✗ Error for {name}: {e}")
        time.sleep(10)

print(f"\nDone! Saved amenity data for {len(all_results)} localities to {output_path}")