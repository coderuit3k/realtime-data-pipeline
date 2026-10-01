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
