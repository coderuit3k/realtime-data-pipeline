from unittest.mock import patch

from ingestion.crypto_ingestion import lambda_handler, normalize_price


def test_normalize_price_maps_fields_and_forces_float():
    data = {
        "usd": 81314,  # CoinGecko returns whole-dollar prices as JSON ints
        "usd_market_cap": 1633315811852.574,
        "usd_24h_vol": 39269674653.5652,
        "usd_24h_change": 4.3266356509097745,
        "last_updated_at": 1789819820,
    }

    result = normalize_price("bitcoin", data)

    assert result["price_id"] == "bitcoin-1789819820"
    assert result["source"] == "crypto"
    assert result["coin_id"] == "bitcoin"
    assert result["price_usd"] == 81314.0
    assert isinstance(result["price_usd"], float)
    assert result["observed_at"] == "2026-09-19T12:10:20+00:00"
    assert "ingested_at" in result


def test_normalize_price_handles_missing_last_updated_at():
    result = normalize_price("solana", {"usd": 111.83})

    assert result["price_id"] == "solana-None"
    assert result["observed_at"] is None
    assert result["market_cap_usd"] is None


@patch("ingestion.crypto_ingestion.write_records")
@patch("ingestion.crypto_ingestion.fetch_prices")
def test_lambda_handler_writes_records_keyed_by_price_id(mock_fetch_prices, mock_write_records):
    mock_fetch_prices.return_value = [{"price_id": "bitcoin-1789819820"}]
    mock_write_records.return_value = "some/key.json"

    lambda_handler({}, None)

    mock_write_records.assert_called_once_with(
        "crypto", [{"price_id": "bitcoin-1789819820"}], "price_id"
    )
