"""Lambda: ingests current conditions from Open-Meteo for config.WEATHER_LOCATIONS.

Fault isolation: one location failing (after retries) no longer fails the
whole run. Successful locations are still written to S3; failures are logged
and returned in the response. The run only raises when *all* locations fail.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import requests

from common import config
from common.http import get_with_retry, make_session
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
    if not observed_at:
        # A 200 with no current block is an API-shape change, not data —
        # fail this location loudly instead of writing a "name-None" record.
        raise ValueError(f"Open-Meteo reply for {location['name']} has no current.time")
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


def fetch_weather() -> tuple[list[dict], list[dict]]:
    """Fetch every location concurrently, isolating per-location failures.

    Returns (records, failures). A location that still fails after retries is
    appended to `failures` instead of aborting the whole run, so one flaky
    location can no longer zero out an entire ingestion window. Records keep
    config order (futures are awaited in submission order).
    """
    session = make_session(config.INGESTION_FETCH_WORKERS)
    records: list[dict] = []
    failures: list[dict] = []
    with ThreadPoolExecutor(max_workers=config.INGESTION_FETCH_WORKERS) as pool:
        futures = [pool.submit(fetch_location, session, loc) for loc in config.WEATHER_LOCATIONS]
        for location, future in zip(config.WEATHER_LOCATIONS, futures):
            try:
                records.append(future.result())
            except Exception as exc:  # noqa: BLE001 - isolation boundary
                logger.warning("Weather fetch failed for %s: %r", location["name"], exc)
                failures.append({"location": location["name"], "error": repr(exc)})
    return records, failures


def lambda_handler(event, context):
    """Scheduled entry point: fetch weather and write it to the raw zone."""
    records, failures = fetch_weather()
    if not records:
        # Nothing to write at all — a real outage, raise so alarms fire.
        raise RuntimeError(
            f"Weather ingestion failed for all {len(failures)} locations: {failures}"
        )
    key = write_records("weather", records, "weather_id")
    logger.info("Wrote %d records to %s", len(records), key)
    if failures:
        logger.warning(
            "Partial weather ingestion: %d/%d locations failed: %s",
            len(failures),
            len(config.WEATHER_LOCATIONS),
            failures,
        )
    return {
        "statusCode": 200,
        "records_ingested": len(records),
        "failed_locations": failures,
        "s3_key": key,
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
