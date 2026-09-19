import logging
from datetime import datetime, timezone

import requests

from common import config
from common.s3_writer import write_records

logger = logging.getLogger()
logger.setLevel(logging.INFO)

COINGECKO_API_URL = "https://api.coingecko.com/api/v3/simple/price"


def _as_float(value) -> float | None:
    return None if value is None else float(value)


def normalize_price(coin_id: str, data: dict) -> dict:
    last_updated_at = data.get("last_updated_at")
    observed_at = (
        datetime.fromtimestamp(last_updated_at, tz=timezone.utc).isoformat()
        if last_updated_at is not None
        else None
    )
    return {
        # CoinGecko has no stable reading id -- coin + observed timestamp
        # together are unique per fetch.
        "price_id": f"{coin_id}-{last_updated_at}",
        "source": "crypto",
        "coin_id": coin_id,
        # Explicit float() -- CoinGecko returns whole-dollar prices (e.g.
        # bitcoin at 81314) as a JSON int, and if every price in a batch
        # happens to be a whole number, pandas would infer int64 for the
        # column while the Glue table declares "double" (same class of bug
        # hit and fixed for weather_ingestion's humidity_pct -- Athena
        # rejects the Parquet file outright). Forcing float here up front
        # avoids repeating that.
        "price_usd": _as_float(data.get("usd")),
        "market_cap_usd": _as_float(data.get("usd_market_cap")),
        "volume_24h_usd": _as_float(data.get("usd_24h_vol")),
        "change_24h_pct": _as_float(data.get("usd_24h_change")),
        "observed_at": observed_at,
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }


def fetch_prices() -> list[dict]:
    params = {
        "ids": ",".join(config.CRYPTO_COIN_IDS),
        "vs_currencies": "usd",
        "include_market_cap": "true",
        "include_24hr_vol": "true",
        "include_24hr_change": "true",
        "include_last_updated_at": "true",
    }
    response = requests.get(COINGECKO_API_URL, params=params, timeout=10)
    response.raise_for_status()
    payload = response.json()
    return [
        normalize_price(coin_id, payload[coin_id])
        for coin_id in config.CRYPTO_COIN_IDS
        if coin_id in payload
    ]


def lambda_handler(event, context):
    records = fetch_prices()
    key = write_records("crypto", records)
    logger.info("Wrote %d records to %s", len(records), key)
    return {"statusCode": 200, "records_ingested": len(records), "s3_key": key}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
