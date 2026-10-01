from concurrent.futures import ThreadPoolExecutor

import requests
from requests.adapters import HTTPAdapter


def make_session(pool_size: int) -> requests.Session:
    """One Session reuses TCP/TLS connections across requests (a bare
    requests.get opens a fresh connection each time). The pool is sized to the
    worker count so concurrent threads don't wait on, or discard, connections."""
    session = requests.Session()
    adapter = HTTPAdapter(pool_connections=pool_size, pool_maxsize=pool_size)
    session.mount("https://", adapter)
    return session


def map_concurrently(fn, items, max_workers: int) -> list:
    """Like [fn(i) for i in items] but concurrent: results keep input order and
    the first failure is re-raised, matching the sequential loop it replaces."""
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        return list(pool.map(fn, items))
