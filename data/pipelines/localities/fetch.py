import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from utils.fileio import ensure_output_dir, save_json

ensure_output_dir()

LOCALITIES = [
    # --- original 25 (3 coordinates corrected) ---
    {"name": "Indiranagar",       "lat": 12.9784, "lon": 77.6408},
    {"name": "Koramangala",       "lat": 12.9352, "lon": 77.6245},
    {"name": "Whitefield",        "lat": 12.9742, "lon": 77.7424},  # corrected
    {"name": "Jayanagar",         "lat": 12.9308, "lon": 77.5838},
    {"name": "Banashankari",      "lat": 12.9255, "lon": 77.5468},
    {"name": "HSR Layout",        "lat": 12.9116, "lon": 77.6473},
    {"name": "Malleshwaram",      "lat": 13.0035, "lon": 77.5710},
    {"name": "Hebbal",            "lat": 13.0350, "lon": 77.5970},
    {"name": "Rajajinagar",       "lat": 12.9922, "lon": 77.5555},
    {"name": "Basavanagudi",      "lat": 12.9416, "lon": 77.5752},
    {"name": "JP Nagar",          "lat": 12.9063, "lon": 77.5857},
    {"name": "Marathahalli",      "lat": 12.9591, "lon": 77.6974},
    {"name": "BTM Layout",        "lat": 12.9166, "lon": 77.6101},
    {"name": "Yelahanka",         "lat": 13.1005, "lon": 77.5963},
    {"name": "Electronic City",   "lat": 12.8468, "lon": 77.6680},  # corrected
    {"name": "Bellandur",         "lat": 12.9257, "lon": 77.6762},
    {"name": "Sarjapur",          "lat": 12.8855, "lon": 77.7420},  # corrected
    {"name": "Bannerghatta Road", "lat": 12.8933, "lon": 77.5975},
    {"name": "Vijayanagar",       "lat": 12.9718, "lon": 77.5348},
    {"name": "RT Nagar",          "lat": 13.0200, "lon": 77.5960},
    {"name": "Frazer Town",       "lat": 12.9833, "lon": 77.6167},
    {"name": "Cox Town",          "lat": 12.9930, "lon": 77.6190},
    {"name": "Sadashivanagar",    "lat": 13.0050, "lon": 77.5800},
    {"name": "Dollars Colony",    "lat": 13.0420, "lon": 77.5910},
    {"name": "Cunningham Road",   "lat": 12.9833, "lon": 77.5933},
    # --- 20 new localities ---
    {"name": "KR Puram",          "lat": 13.0067, "lon": 77.6928},
    {"name": "Mahadevapura",      "lat": 12.9940, "lon": 77.7127},
    {"name": "Hennur",            "lat": 13.0420, "lon": 77.6380},
    {"name": "Nagavara",          "lat": 13.0494, "lon": 77.6236},
    {"name": "Banaswadi",         "lat": 13.0013, "lon": 77.6456},
    {"name": "Domlur",            "lat": 12.9621, "lon": 77.6384},
    {"name": "Ramamurthy Nagar",  "lat": 13.0142, "lon": 77.6608},
    {"name": "Brookefield",       "lat": 12.9783, "lon": 77.7277},
    {"name": "Varthur",           "lat": 12.9388, "lon": 77.7472},
    {"name": "Shivajinagar",      "lat": 12.9894, "lon": 77.6012},
    {"name": "Yeshwantpur",       "lat": 13.0247, "lon": 77.5479},
    {"name": "Peenya",            "lat": 13.0290, "lon": 77.5150},
    {"name": "Nagarbhavi",        "lat": 12.9625, "lon": 77.5140},
    {"name": "Kengeri",           "lat": 12.9143, "lon": 77.4829},
    {"name": "Uttarahalli",       "lat": 12.8914, "lon": 77.5519},
    {"name": "Bommanahalli",      "lat": 12.8932, "lon": 77.6198},
    {"name": "Begur",             "lat": 12.8668, "lon": 77.6241},
    {"name": "Jakkur",            "lat": 13.0742, "lon": 77.6010},
    {"name": "Padmanabhanagar",   "lat": 12.9243, "lon": 77.5494},
    {"name": "Old Madras Road",   "lat": 13.0050, "lon": 77.6650},
    {"name": "Doddakannalli",     "lat": 12.9058, "lon": 77.6934},
    {"name": "Kasavanahalli",     "lat": 12.9042, "lon": 77.6765},
    {"name": "Haralur",           "lat": 12.9173, "lon": 77.6830},
    # --- 15 West Bangalore localities ---
    {"name": "RR Nagar",          "lat": 12.9235, "lon": 77.5149},
    {"name": "Jalahalli",         "lat": 13.0527, "lon": 77.5430},
    {"name": "Dasarahalli",       "lat": 13.0480, "lon": 77.5170},
    {"name": "Mahalakshmi Layout","lat": 13.0180, "lon": 77.5480},
    {"name": "Nandini Layout",    "lat": 13.0080, "lon": 77.5320},
    {"name": "Kamakshipalya",     "lat": 12.9820, "lon": 77.5380},
    {"name": "Chandra Layout",    "lat": 12.9760, "lon": 77.5270},
    {"name": "Herohalli",         "lat": 13.0150, "lon": 77.5100},
    {"name": "Mathikere",         "lat": 13.0280, "lon": 77.5630},
    {"name": "Bhattarahalli",     "lat": 12.9010, "lon": 77.4980},
    {"name": "Basaveshwara Nagar","lat": 13.0060, "lon": 77.5350},
    {"name": "BEL Layout",        "lat": 13.0280, "lon": 77.5390},
    {"name": "Girinagar",         "lat": 12.9380, "lon": 77.5490},
    {"name": "Hegganahalli",      "lat": 12.9860, "lon": 77.5180},
    {"name": "Chord Road",        "lat": 12.9950, "lon": 77.5460},
    # --- 15 South Bangalore localities ---
    {"name": "Arekere",           "lat": 12.8853, "lon": 77.6096},
    {"name": "Hulimavu",          "lat": 12.8741, "lon": 77.6052},
    {"name": "Gottigere",         "lat": 12.8540, "lon": 77.5870},
    {"name": "Akshayanagar",      "lat": 12.8685, "lon": 77.6240},
    {"name": "Hongasandra",       "lat": 12.8972, "lon": 77.6132},
    {"name": "Subramanyapura",    "lat": 12.9068, "lon": 77.5361},
    {"name": "Vasanthapura",      "lat": 12.9042, "lon": 77.5193},
    {"name": "Konanakunte",       "lat": 12.8936, "lon": 77.5546},
    {"name": "Talaghattapura",    "lat": 12.8677, "lon": 77.5274},
    {"name": "Sarakki",           "lat": 12.9154, "lon": 77.5657},
    {"name": "Puttenahalli",      "lat": 12.8990, "lon": 77.5707},
    {"name": "Chikkalasandra",    "lat": 12.9135, "lon": 77.5552},
    {"name": "Raghuvanahalli",    "lat": 12.8790, "lon": 77.5485},
    {"name": "Singasandra",       "lat": 12.8938, "lon": 77.6299},
    {"name": "Chandapura",        "lat": 12.8278, "lon": 77.6531},
    # --- 10 Central Bangalore localities ---
    {"name": "MG Road",           "lat": 12.9753, "lon": 77.6076},
    {"name": "Richmond Town",     "lat": 12.9600, "lon": 77.5990},
    {"name": "Langford Town",     "lat": 12.9545, "lon": 77.5968},
    {"name": "Ulsoor",            "lat": 12.9839, "lon": 77.6280},
    {"name": "Vasanth Nagar",     "lat": 12.9972, "lon": 77.5932},
    {"name": "Victoria Layout",   "lat": 12.9677, "lon": 77.6176},
    {"name": "CV Raman Nagar",    "lat": 12.9913, "lon": 77.6595},
    {"name": "Horamavu",          "lat": 13.0055, "lon": 77.6648},
    {"name": "HAL",               "lat": 12.9553, "lon": 77.6698},
    {"name": "Kodigehalli",       "lat": 13.0491, "lon": 77.6131},
    # --- 14 East Bangalore localities ---
    {"name": "Kaggadasapura",     "lat": 12.9974, "lon": 77.6735},
    {"name": "Hoodi",             "lat": 13.0002, "lon": 77.7224},
    {"name": "Kundalahalli",      "lat": 12.9718, "lon": 77.7157},
    {"name": "Kadugodi",          "lat": 13.0016, "lon": 77.7580},
    {"name": "Panathur",          "lat": 12.9319, "lon": 77.6865},
    {"name": "Munnekolala",       "lat": 12.9484, "lon": 77.7100},
    {"name": "Nallurhalli",       "lat": 12.9540, "lon": 77.7310},
    {"name": "Vibhutipura",       "lat": 12.9655, "lon": 77.6640},
    {"name": "Carmelaram",        "lat": 12.8904, "lon": 77.7098},
    {"name": "Dommasandra",       "lat": 12.8616, "lon": 77.7433},
    {"name": "Devarabeesanahalli","lat": 12.9705, "lon": 77.7070},
    {"name": "Garudacharpalya",   "lat": 12.9848, "lon": 77.6836},
    {"name": "Hagadur",           "lat": 12.9757, "lon": 77.7600},
    {"name": "Thubarahalli",      "lat": 12.9626, "lon": 77.7198},
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
save_json(geojson, output_path)

print(f"\nDone! Saved {len(features)} localities to {output_path}")