import threading
from unittest.mock import patch

from common import config
from ingestion import weather_ingestion
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


class _FakeResponse:
    status_code = 200
    headers: dict = {}

    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self._data


class _FakeWeatherSession:
    """Answers each location's request; waits on `barrier` (if given) so the
    test only passes when the requests run concurrently."""

    def __init__(self, barrier=None):
        self._barrier = barrier

    def get(self, url, params, timeout):
        if self._barrier:
            self._barrier.wait()
        return _FakeResponse({"current": {"time": f"t-{params['latitude']}", "temperature_2m": 30}})


def test_fetch_weather_requests_locations_concurrently_in_config_order(monkeypatch):
    locations = [
        {"name": "A", "latitude": 1, "longitude": 1},
        {"name": "B", "latitude": 2, "longitude": 2},
        {"name": "C", "latitude": 3, "longitude": 3},
    ]
    monkeypatch.setattr(config, "WEATHER_LOCATIONS", locations)
    session = _FakeWeatherSession(barrier=threading.Barrier(3, timeout=2))
    monkeypatch.setattr(weather_ingestion, "make_session", lambda pool_size: session)

    records = weather_ingestion.fetch_weather()

    assert [r["location"] for r in records] == ["A", "B", "C"]


def test_fetch_weather_reuses_one_session_for_every_location(monkeypatch):
    monkeypatch.setattr(
        config,
        "WEATHER_LOCATIONS",
        [{"name": n, "latitude": i, "longitude": i} for i, n in enumerate("ABCD")],
    )
    created = []

    def make_session(pool_size):
        created.append(pool_size)
        return _FakeWeatherSession()

    monkeypatch.setattr(weather_ingestion, "make_session", make_session)

    weather_ingestion.fetch_weather()

    assert len(created) == 1


class _Reply:
    def __init__(self, status, payload=None):
        self.status_code = status
        self._payload = payload or {}
        self.headers = {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise weather_ingestion.requests.HTTPError(str(self.status_code), response=self)

    def json(self):
        return self._payload


class _Session:
    def __init__(self, *script):
        self.script = list(script)
        self.calls = 0

    def get(self, url, **kwargs):
        self.calls += 1
        return self.script.pop(0)


LOCATION = {"name": "Can Tho", "latitude": 10.0, "longitude": 105.0}


def test_fetch_location_retries_a_rate_limited_request(monkeypatch):
    monkeypatch.setattr("common.http.time.sleep", lambda s: None)
    session = _Session(_Reply(429), _Reply(200, {"current": {"temperature_2m": 30.0}}))

    record = weather_ingestion.fetch_location(session, LOCATION)

    assert session.calls == 2
    assert record["temperature_c"] == 30.0


def test_fetch_location_still_fails_when_every_attempt_is_rate_limited(monkeypatch):
    monkeypatch.setattr("common.http.time.sleep", lambda s: None)
    session = _Session(_Reply(429), _Reply(429), _Reply(429))

    try:
        weather_ingestion.fetch_location(session, LOCATION)
    except weather_ingestion.requests.HTTPError:
        pass
    else:
        raise AssertionError("expected the final 429 to fail the run")
    assert session.calls == 3
