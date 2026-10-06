"""Shared HTTP helpers for the ingestion Lambdas that fetch many URLs per run."""

import random
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from requests.adapters import HTTPAdapter

RETRY_ATTEMPTS = 3
RETRY_STATUSES = {429, 500, 502, 503, 504}
RETRY_BASE_DELAY_SECONDS = 1.0
# Jitter keeps parallel workers that were rate limited together from retrying in lockstep.
RETRY_JITTER_SECONDS = 1.0
# 3 attempts x 10s timeout + two waits must stay well inside the Lambdas' 60s timeout, so a
# server's Retry-After is honoured only up to this cap.
MAX_RETRY_WAIT_SECONDS = 5.0


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


def _retry_wait(retry_number: int, reply) -> float:
    """Seconds to wait before retry `retry_number` (1, 2, ...): exponential, or Retry-After."""
    wait = RETRY_BASE_DELAY_SECONDS * 2 ** (retry_number - 1)
    retry_after = reply.headers.get("Retry-After") if reply is not None else None
    if retry_after and retry_after.isdigit():
        wait = max(wait, min(float(retry_after), MAX_RETRY_WAIT_SECONDS))
    return wait + random.uniform(0, RETRY_JITTER_SECONDS)


def get_with_retry(client, url, *, params, timeout, attempts=RETRY_ATTEMPTS, sleep=None):
    """client.get(...) again after a 429/5xx reply, a timeout or a dropped connection.

    `client` is a requests.Session (or the requests module). Returns the first reply that is not
    retryable, or the last reply once `attempts` run out, so the caller's raise_for_status()
    still reports the final failure; a network error on the last attempt is raised as is.
    Other 4xx replies are the caller's bug and are never retried.
    """
    for attempt in range(1, attempts + 1):
        try:
            reply = client.get(url, params=params, timeout=timeout)
        except (requests.Timeout, requests.ConnectionError):
            if attempt == attempts:
                raise
            reply = None
        else:
            if reply.status_code not in RETRY_STATUSES or attempt == attempts:
                return reply
        (sleep or time.sleep)(_retry_wait(attempt, reply))
