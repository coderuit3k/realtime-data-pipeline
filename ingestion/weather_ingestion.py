import logging
from datetime import datetime, timezone

import requests

from common import config
from common.s3_writer import write_records

logger = logging.getLogger()
logger.setLevel(logging.INFO)

WEATHER_API_URL = "https://api.open-meteo.com/v1/forecast"
CURRENT_FIELDS = "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m"


def normalize_current(location: dict, payload: dict) -> dict:
    current = payload.get("current") or {}
    observed_at = current.get("time")
    return {
        # Open-Meteo has no stable reading id -- location + observed timestamp
        # together are unique per fetch.
        "weather_id": f"{location['name']}-{observed_at}",
        "source": "weather",
        "location": location["name"],
        "latitude": location["latitude"],
        "longitude": location["longitude"],
        "temperature_c": current.get("temperature_2m"),
        "humidity_pct": current.get("relative_humidity_2m"),
        "precipitation_mm": current.get("precipitation"),
        "weather_code": current.get("weather_code"),
        "wind_speed_kmh": current.get("wind_speed_10m"),
        "observed_at": observed_at,
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }


def fetch_weather() -> list[dict]:
    records = []
    for location in config.WEATHER_LOCATIONS:
        params = {
            "latitude": location["latitude"],
            "longitude": location["longitude"],
            "current": CURRENT_FIELDS,
            "timezone": "Asia/Bangkok",
        }
        response = requests.get(WEATHER_API_URL, params=params, timeout=10)
        response.raise_for_status()
        records.append(normalize_current(location, response.json()))
    return records


def lambda_handler(event, context):
    records = fetch_weather()
    key = write_records("weather", records)
    logger.info("Wrote %d records to %s", len(records), key)
    return {"statusCode": 200, "records_ingested": len(records), "s3_key": key}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
