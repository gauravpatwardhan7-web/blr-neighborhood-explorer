import json
from pathlib import Path

Path("data/raw").mkdir(parents=True, exist_ok=True)

LOCALITIES = [
    {"name": "Indiranagar", "lat": 12.9784, "lon": 77.6408},
    {"name": "Koramangala", "lat": 12.9352, "lon": 77.6245},
    {"name": "Whitefield", "lat": 12.9698, "lon": 77.7500},
    {"name": "Jayanagar", "lat": 12.9308, "lon": 77.5838},
    {"name": "Banashankari", "lat": 12.9255, "lon": 77.5468},
    {"name": "HSR Layout", "lat": 12.9116, "lon": 77.6473},
    {"name": "Malleshwaram", "lat": 13.0035, "lon": 77.5710},
    {"name": "Hebbal", "lat": 13.0350, "lon": 77.5970},
    {"name": "Rajajinagar", "lat": 12.9922, "lon": 77.5555},
    {"name": "Basavanagudi", "lat": 12.9416, "lon": 77.5752},
    {"name": "JP Nagar", "lat": 12.9063, "lon": 77.5857},
    {"name": "Marathahalli", "lat": 12.9591, "lon": 77.6974},
    {"name": "BTM Layout", "lat": 12.9166, "lon": 77.6101},
    {"name": "Yelahanka", "lat": 13.1005, "lon": 77.5963},
    {"name": "Electronic City", "lat": 12.8399, "lon": 77.6770},
    {"name": "Bellandur", "lat": 12.9257, "lon": 77.6762},
    {"name": "Sarjapur", "lat": 12.8604, "lon": 77.7860},
    {"name": "Bannerghatta Road", "lat": 12.8933, "lon": 77.5975},
    {"name": "Vijayanagar", "lat": 12.9718, "lon": 77.5348},
    {"name": "RT Nagar", "lat": 13.0200, "lon": 77.5960},
    {"name": "Frazer Town", "lat": 12.9833, "lon": 77.6167},
    {"name": "Cox Town", "lat": 12.9930, "lon": 77.6190},
    {"name": "Sadashivanagar", "lat": 13.0050, "lon": 77.5800},
    {"name": "Dollars Colony", "lat": 13.0420, "lon": 77.5910},
    {"name": "Cunningham Road", "lat": 12.9833, "lon": 77.5933}
]

def make_box(lat, lon, size=0.018):
    return [[
        [lon - size, lat - size],
        [lon + size, lat - size],
        [lon + size, lat + size],
        [lon - size, lat + size],
        [lon - size, lat - size]
    ]]

features = []
for loc in LOCALITIES:
    feature = {
        "type": "Feature",
        "properties": {
            "name": loc["name"],
            "lat": loc["lat"],
            "lon": loc["lon"]
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": make_box(loc["lat"], loc["lon"])
        }
    }
    features.append(feature)
    print(f"  ✓ Added {loc['name']}")

geojson = {
    "type": "FeatureCollection",
    "features": features
}

output_path = "data/raw/localities.geojson"
with open(output_path, "w") as f:
    json.dump(geojson, f, indent=2)

print(f"\nDone! Saved {len(features)} localities to {output_path}")