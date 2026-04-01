import json
import math
from pathlib import Path

RADIUS_M = 1000  # metres — fixed radius for all localities

def circle_polygon(lat, lon, radius_m=RADIUS_M, num_points=64):
    """Return a GeoJSON Polygon approximating a circle."""
    lat_r = math.radians(lat)
    d_lat = radius_m / 111_000
    d_lon = radius_m / (111_000 * math.cos(lat_r))
    ring = [
        [
            round(lon + d_lon * math.cos(2 * math.pi * i / num_points), 6),
            round(lat + d_lat * math.sin(2 * math.pi * i / num_points), 6),
        ]
        for i in range(num_points)
    ]
    ring.append(ring[0])  # close the ring
    return {"type": "Polygon", "coordinates": [ring]}

with open("data/raw/localities.geojson") as f:
    localities = json.load(f)["features"]

with open("data/raw/weather.json") as f:
    weather_data = {d["name"]: d for d in json.load(f)}

with open("data/raw/amenities.json") as f:
    amenity_data = {d["name"]: d for d in json.load(f)}

WEIGHTS = {
    "air_quality":   0.15,  # reduced — amenities/metro matter more for livability
    "amenities":     0.45,
    "metro":         0.25,
    "restaurants":   0.15,
}

def normalise(value, min_val, max_val, invert=False):
    if max_val == min_val:
        return 5.0
    score = (value - min_val) / (max_val - min_val) * 10
    return round(10 - score if invert else score, 2)

def aqi_to_score(aqi):
    """Absolute US AQI → 0-10. Non-hazardous levels (<=150) always score >= 5.
    AQI 0-100 (Good/Moderate) stays >= 7 as long as its below hazardous."""
    if not aqi:          return 5.0   # missing data → neutral
    if aqi <= 50:        return 10.0  # Good
    if aqi <= 100:       return round(10.0 - (aqi - 50)  / 50  * 3, 1)  # 10→7
    if aqi <= 150:       return round(7.0  - (aqi - 100) / 50  * 2, 1)  # 7→5
    if aqi <= 200:       return round(5.0  - (aqi - 150) / 50  * 2, 1)  # 5→3  Unhealthy
    if aqi <= 300:       return round(3.0  - (aqi - 200) / 100 * 2, 1)  # 3→1  Very Unhealthy
    return 0.0                                                            # Hazardous

all_names = [f["properties"]["name"] for f in localities]

aqi_values   = [weather_data.get(n, {}).get("us_aqi") or 0 for n in all_names]
amen_values  = [
    sum([
        amenity_data.get(n, {}).get("hospitals", 0),
        amenity_data.get(n, {}).get("schools", 0),
        amenity_data.get(n, {}).get("supermarkets", 0),
        amenity_data.get(n, {}).get("pharmacies", 0),
        amenity_data.get(n, {}).get("gyms", 0),
    ]) for n in all_names
]
metro_values = [amenity_data.get(n, {}).get("metro_stations", 0) for n in all_names]
rest_values  = [amenity_data.get(n, {}).get("restaurants", 0) for n in all_names]

scored = []
for i, feature in enumerate(localities):
    name = all_names[i]
    w    = weather_data.get(name, {})
    a    = amenity_data.get(name, {})

    air_score   = aqi_to_score(aqi_values[i])
    amen_score  = normalise(amen_values[i], min(amen_values),  max(amen_values))
    metro_score = normalise(metro_values[i],min(metro_values), max(metro_values))
    rest_score  = normalise(rest_values[i], min(rest_values),  max(rest_values))

    composite = round(
        air_score   * WEIGHTS["air_quality"] +
        amen_score  * WEIGHTS["amenities"] +
        metro_score * WEIGHTS["metro"] +
        rest_score  * WEIGHTS["restaurants"],
        1
    )

    scored.append({
        "name": name,
        "lat": feature["properties"]["lat"],
        "lon": feature["properties"]["lon"],
        "overall_score": composite,
        "factors": {
            "air_quality":  air_score,
            "amenities":    amen_score,
            "metro_access": metro_score,
            "restaurants":  rest_score,
        },
        "raw": {
            "aqi":           w.get("us_aqi"),
            "temperature_c": w.get("temperature_c"),
            "hospitals":     a.get("hospitals", 0),
            "schools":       a.get("schools", 0),
            "supermarkets":  a.get("supermarkets", 0),
            "restaurants":   a.get("restaurants", 0),
            "metro_stations":a.get("metro_stations", 0),
        }
    })

scored.sort(key=lambda x: x["overall_score"], reverse=True)

print("\n🏆 Bengaluru Neighborhood Rankings\n")
print(f"{'Rank':<5} {'Locality':<22} {'Score':<8} {'Air':<8} {'Amenities':<12} {'Metro':<8} {'Restaurants'}")
print("-" * 75)
for i, s in enumerate(scored):
    f = s["factors"]
    print(f"{i+1:<5} {s['name']:<22} {s['overall_score']:<8} {f['air_quality']:<8} {f['amenities']:<12} {f['metro_access']:<8} {f['restaurants']}")

geojson_features = []
for s in scored:
    geojson_features.append({
        "type": "Feature",
        "properties": {**s},
        "geometry": circle_polygon(s["lat"], s["lon"])
    })

output = {"type": "FeatureCollection", "features": geojson_features}

with open("data/raw/localities_scored.geojson", "w") as f:
    json.dump(output, f, indent=2)

print(f"\nSaved scored GeoJSON to data/raw/localities_scored.geojson")