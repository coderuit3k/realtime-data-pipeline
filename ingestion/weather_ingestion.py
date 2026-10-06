"""Lambda: ingests current conditions from Open-Meteo for config.WEATHER_LOCATIONS."""

import logging
from datetime import datetime, timezone

import requests

from common import config
from common.http import get_with_retry, make_session, map_concurrently
from common.s3_writer import write_records

logger = logging.getLogger()
logger.setLevel(logging.INFO)

WEATHER_API_URL = "https://api.open-meteo.com/v1/forecast"
CURRENT_FIELDS = "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m"


def _as_float(value) -> float | None:
    """float() that passes None through (missing fields stay null)."""
    return None if value is None else float(value)


def normalize_current(location: dict, payload: dict) -> dict:
    """Map an Open-Meteo `current` block to the raw weather record."""
    current = payload.get("current") or {}
    observed_at = current.get("time")
    return {
        # Open-Meteo has no reading id; location + observed timestamp is unique.
        "weather_id": f"{location['name']}-{observed_at}",
        "source": "weather",
        "location": location["name"],
        "latitude": float(location["latitude"]),
        "longitude": float(location["longitude"]),
        # Force float: Open-Meteo sends humidity as a JSON int, and an all-int
        # batch makes pandas write INT64 Parquet, which Athena rejects against
        # the Glue "double" column (HIVE_BAD_DATA, seen on a live query).
        "temperature_c": _as_float(current.get("temperature_2m")),
        "humidity_pct": _as_float(current.get("relative_humidity_2m")),
        "precipitation_mm": _as_float(current.get("precipitation")),
        "weather_code": current.get("weather_code"),
        "wind_speed_kmh": _as_float(current.get("wind_speed_10m")),
        "observed_at": observed_at,
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }


def fetch_location(session: requests.Session, location: dict) -> dict:
    """Fetch and normalize current conditions for one location."""
    params = {
        "latitude": location["latitude"],
        "longitude": location["longitude"],
        "current": CURRENT_FIELDS,
        "timezone": "Asia/Bangkok",
    }
    response = get_with_retry(session, WEATHER_API_URL, params=params, timeout=10)
    response.raise_for_status()
    return normalize_current(location, response.json())


def fetch_weather() -> list[dict]:
    """Fetch every location concurrently; any single failure fails the run."""
    session = make_session(config.INGESTION_FETCH_WORKERS)
    return map_concurrently(
        lambda location: fetch_location(session, location),
        config.WEATHER_LOCATIONS,
        config.INGESTION_FETCH_WORKERS,
    )


def lambda_handler(event, context):
    """Scheduled entry point: fetch weather and write it to the raw zone."""
    records = fetch_weather()
    key = write_records("weather", records, "weather_id")
    logger.info("Wrote %d records to %s", len(records), key)
    return {"statusCode": 200, "records_ingested": len(records), "s3_key": key}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
