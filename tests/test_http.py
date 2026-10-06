import threading

import pytest
import requests
from requests.adapters import HTTPAdapter

from common import http


def test_make_session_returns_a_session_whose_pool_fits_the_worker_count():
    session = http.make_session(pool_size=7)

    assert isinstance(session, requests.Session)
    adapter = session.get_adapter("https://example.com")
    assert isinstance(adapter, HTTPAdapter)
    assert adapter._pool_maxsize == 7


def test_map_concurrently_preserves_input_order():
    assert http.map_concurrently(lambda n: n * 2, [3, 1, 2], max_workers=3) == [6, 2, 4]


def test_map_concurrently_runs_calls_at_the_same_time():
    # Every call blocks until all 3 have started -- only possible if they overlap.
    barrier = threading.Barrier(3, timeout=2)

    def call(n):
        barrier.wait()
        return n

    assert http.map_concurrently(call, [1, 2, 3], max_workers=3) == [1, 2, 3]


def test_map_concurrently_propagates_a_failure():
    def call(n):
        if n == 2:
            raise ValueError("boom")
        return n

    with pytest.raises(ValueError, match="boom"):
        http.map_concurrently(call, [1, 2, 3], max_workers=3)


class _Reply:
    def __init__(self, status, headers=None):
        self.status_code = status
        self.headers = headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(str(self.status_code), response=self)


class _Client:
    """Plays back a script of replies (or exceptions) and records each call."""

    def __init__(self, *script):
        self.script = list(script)
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def test_get_with_retry_returns_the_first_good_reply_without_sleeping():
    client, naps = _Client(_Reply(200)), []

    reply = http.get_with_retry(client, "u", params={"a": 1}, timeout=10, sleep=naps.append)

    assert reply.status_code == 200
    assert client.calls == [("u", {"params": {"a": 1}, "timeout": 10})]
    assert naps == []


@pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
def test_get_with_retry_tries_again_after_a_rate_limit_or_server_error(status):
    client, naps = _Client(_Reply(status), _Reply(200)), []

    reply = http.get_with_retry(client, "u", params={}, timeout=10, sleep=naps.append)

    assert reply.status_code == 200
    assert len(client.calls) == 2
    assert len(naps) == 1


@pytest.mark.parametrize("error", [requests.Timeout("slow"), requests.ConnectionError("reset")])
def test_get_with_retry_tries_again_after_a_timeout_or_dropped_connection(error):
    client = _Client(error, _Reply(200))

    reply = http.get_with_retry(client, "u", params={}, timeout=10, sleep=lambda s: None)

    assert reply.status_code == 200


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_get_with_retry_does_not_retry_a_client_error(status):
    client = _Client(_Reply(status))

    reply = http.get_with_retry(client, "u", params={}, timeout=10, sleep=lambda s: None)

    assert reply.status_code == status
    assert len(client.calls) == 1


def test_get_with_retry_gives_up_after_the_attempts_and_returns_the_last_reply():
    client = _Client(_Reply(429), _Reply(429), _Reply(429))

    reply = http.get_with_retry(
        client, "u", params={}, timeout=10, attempts=3, sleep=lambda s: None
    )

    assert reply.status_code == 429
    assert len(client.calls) == 3
    with pytest.raises(requests.HTTPError):
        reply.raise_for_status()


def test_get_with_retry_raises_the_last_network_error_when_attempts_run_out():
    client = _Client(requests.Timeout("a"), requests.Timeout("b"))

    with pytest.raises(requests.Timeout, match="b"):
        http.get_with_retry(client, "u", params={}, timeout=10, attempts=2, sleep=lambda s: None)


def test_get_with_retry_does_not_swallow_other_errors():
    client = _Client(ValueError("bug"))

    with pytest.raises(ValueError):
        http.get_with_retry(client, "u", params={}, timeout=10, sleep=lambda s: None)


def test_get_with_retry_waits_longer_before_each_further_attempt():
    client, naps = _Client(_Reply(429), _Reply(429), _Reply(200)), []

    http.get_with_retry(client, "u", params={}, timeout=10, sleep=naps.append)

    assert len(naps) == 2
    assert naps[0] >= http.RETRY_BASE_DELAY_SECONDS
    assert naps[1] >= 2 * http.RETRY_BASE_DELAY_SECONDS


def test_get_with_retry_follows_retry_after_but_caps_it_to_fit_the_lambda_timeout():
    short, long = _Client(_Reply(429, {"Retry-After": "3"}), _Reply(200)), _Client(
        _Reply(429, {"Retry-After": "300"}), _Reply(200)
    )
    short_naps, long_naps = [], []

    http.get_with_retry(short, "u", params={}, timeout=10, sleep=short_naps.append)
    http.get_with_retry(long, "u", params={}, timeout=10, sleep=long_naps.append)

    assert short_naps[0] >= 3
    assert long_naps[0] <= http.MAX_RETRY_WAIT_SECONDS + http.RETRY_JITTER_SECONDS
