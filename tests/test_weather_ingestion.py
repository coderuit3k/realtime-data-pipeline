from unittest.mock import patch

from ingestion.weather_ingestion import lambda_handler, normalize_current


def test_normalize_current_maps_fields():
    location = {"name": "Ho Chi Minh City", "latitude": 10.7769, "longitude": 106.7009}
    payload = {
        "current": {
            "time": "2026-09-19T18:00",
            "temperature_2m": 29.3,
            "relative_humidity_2m": 70,
            "precipitation": 0.0,
            "weather_code": 3,
            "wind_speed_10m": 12.4,
        }
    }

    result = normalize_current(location, payload)

    assert result["weather_id"] == "Ho Chi Minh City-2026-09-19T18:00"
    assert result["source"] == "weather"
    assert result["location"] == "Ho Chi Minh City"
    assert result["latitude"] == 10.7769
    assert result["temperature_c"] == 29.3
    assert result["humidity_pct"] == 70
    assert result["weather_code"] == 3
    assert result["wind_speed_kmh"] == 12.4
    assert "ingested_at" in result


def test_normalize_current_handles_missing_current_block():
    location = {"name": "Da Lat", "latitude": 11.9404, "longitude": 108.4583}

    result = normalize_current(location, {})

    assert result["weather_id"] == "Da Lat-None"
    assert result["temperature_c"] is None


@patch("ingestion.weather_ingestion.write_records")
@patch("ingestion.weather_ingestion.fetch_weather")
def test_lambda_handler_writes_records_keyed_by_weather_id(mock_fetch_weather, mock_write_records):
    mock_fetch_weather.return_value = [{"weather_id": "Da Lat-2026-09-19T18:00"}]
    mock_write_records.return_value = "some/key.json"

    lambda_handler({}, None)

    mock_write_records.assert_called_once_with(
        "weather", [{"weather_id": "Da Lat-2026-09-19T18:00"}], "weather_id"
    )
