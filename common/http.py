"""Shared HTTP helpers for the ingestion Lambdas that fetch many URLs per run."""

from concurrent.futures import ThreadPoolExecutor

import requests
from requests.adapters import HTTPAdapter


def make_session(pool_size: int) -> requests.Session:
    """Return a Session whose connection pool matches the worker count.

    A Session reuses TCP/TLS connections (a bare requests.get opens a new one
    each time); a pool smaller than the worker count would make threads wait
    on, or discard, connections.
    """
    session = requests.Session()
    adapter = HTTPAdapter(pool_connections=pool_size, pool_maxsize=pool_size)
    session.mount("https://", adapter)
    return session


def map_concurrently(fn, items, max_workers: int) -> list:
    """Concurrent [fn(i) for i in items]: keeps input order, re-raises the first failure."""
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        return list(pool.map(fn, items))
