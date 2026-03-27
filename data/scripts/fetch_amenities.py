import requests
import json
import time
from pathlib import Path

Path("data/raw").mkdir(parents=True, exist_ok=True)

with open("data/raw/localities.geojson") as f:
    localities = json.load(f)["features"]

RADIUS = 1500

def count_amenities(name, lat, lon):
    query = f"""
    [out:json][timeout:25];
    (
      node["amenity"="hospital"](around:{RADIUS},{lat},{lon});
      node["amenity"="pharmacy"](around:{RADIUS},{lat},{lon});
      node["shop"="supermarket"](around:{RADIUS},{lat},{lon});
      node["leisure"="park"](around:{RADIUS},{lat},{lon});
      node["amenity"="school"](around:{RADIUS},{lat},{lon});
      node["amenity"="restaurant"](around:{RADIUS},{lat},{lon});
      node["leisure"="fitness_centre"](around:{RADIUS},{lat},{lon});
      node["amenity"="atm"](around:{RADIUS},{lat},{lon});
      node["railway"="station"](around:{RADIUS},{lat},{lon});
      node["station"="subway"](around:{RADIUS},{lat},{lon});
    );
    out body;
    """
    response = requests.post(
        "https://overpass-api.de/api/interpreter",
        data=query,
        timeout=30
    )
    data = response.json()
    elements = data.get("elements", [])

    counts = {
        "hospitals": 0, "pharmacies": 0, "supermarkets": 0,
        "parks": 0, "schools": 0, "restaurants": 0,
        "gyms": 0, "atms": 0, "metro_stations": 0
    }

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
        elif railway == "station" or station == "subway":
            counts["metro_stations"] += 1

    return counts

all_results = []
for feature in localities:
    name = feature["properties"]["name"]
    lat  = feature["properties"]["lat"]
    lon  = feature["properties"]["lon"]
    print(f"Fetching amenities for {name}...")
    try:
        counts = count_amenities(name, lat, lon)
        row = {"name": name, "lat": lat, "lon": lon, **counts}
        all_results.append(row)
        print(f"  ✓ {name}: {counts['hospitals']} hospitals, {counts['schools']} schools, {counts['supermarkets']} supermarkets, {counts['metro_stations']} metro")
        time.sleep(3)
    except Exception as e:
        print(f"  ✗ Error for {name}: {e}")
        time.sleep(5)

output_path = "data/raw/amenities.json"
with open(output_path, "w") as f:
    json.dump(all_results, f, indent=2)

print(f"\nDone! Saved amenity data for {len(all_results)} localities to {output_path}")