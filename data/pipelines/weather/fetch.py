import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from utils.loader import load_localities
from utils.fileio import ensure_output_dir, save_json
from utils.api_client import rate_limited_request

ensure_output_dir()
localities = load_localities()


def get_weather(name, lat, lon):
    print(f"Fetching weather for {name}...")

    weather_url = "https://api.open-meteo.com/v1/forecast"
    weather_params = {
        "latitude": lat,
        "longitude": lon,
        "current": ["temperature_2m", "relative_humidity_2m", "precipitation"],
        "timezone": "Asia/Kolkata"
    }
    weather = rate_limited_request(weather_url, params=weather_params, timeout=15, delay=1.0)

    air_url = "https://air-quality-api.open-meteo.com/v1/air-quality"
    air_params = {
        "latitude": lat,
        "longitude": lon,
        "current": ["pm2_5", "pm10", "us_aqi"],
        "timezone": "Asia/Kolkata"
    }
    air = rate_limited_request(air_url, params=air_params, timeout=15, delay=0)

    return {
        "name": name,
        "lat": lat,
        "lon": lon,
        "temperature_c": weather.get("current", {}).get("temperature_2m"),
        "humidity_pct": weather.get("current", {}).get("relative_humidity_2m"),
        "precipitation_mm": weather.get("current", {}).get("precipitation"),
        "pm2_5": air.get("current", {}).get("pm2_5"),
        "pm10": air.get("current", {}).get("pm10"),
        "us_aqi": air.get("current", {}).get("us_aqi"),
    }


results = []
for feature in localities:
    name = feature["properties"]["name"]
    lat = feature["properties"]["lat"]
    lon = feature["properties"]["lon"]
    try:
        data = get_weather(name, lat, lon)
        results.append(data)
        print(f"  ✓ {name}: {data['temperature_c']}°C, AQI {data['us_aqi']}")
    except Exception as e:
        print(f"  ✗ Error for {name}: {e}")

output_path = "data/raw/weather.json"
save_json(results, output_path)
print(f"\nDone! Saved weather data for {len(results)} localities to {output_path}")