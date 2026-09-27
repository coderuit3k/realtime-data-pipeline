# Trend Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect keywords trending simultaneously across GitHub Trending, Hacker News, and News API, persist each detection as a "Trend Event," and show the resulting history on a new `/trends` page.

**Architecture:** A new daily-scheduled Lambda (`trends/trend_scan.py`) runs one fixed Athena query over today's UTC partition (three-way keyword join with distinct-id counts), writes qualifying keywords as Parquet rows to a new `trend_events` Glue table in the existing curated database. A new `/api/trends` route queries that table (bounded to the last 90 days) for a new `/trends` page. Along the way, `rag/agent.py`'s existing Athena start/poll/get-results loop is extracted into a shared `common/athena.py`, since this Lambda needs the identical loop.

**Tech Stack:** Python 3.12 (boto3, pandas/pyarrow via the existing Lambda layer), Terraform (AWS Lambda, EventBridge, Glue, IAM), Next.js/TypeScript (vitest, existing `web/lib/athena.ts` client helpers).

**Spec:** `docs/superpowers/specs/2026-09-27-trend-events-design.md`

## Global Constraints

- No new AWS service beyond what this project already uses (S3, Glue, Athena, EventBridge, Lambda) — no DynamoDB, no OpenSearch.
- Keyword matching uses exact tokens via `CROSS JOIN UNNEST(split(keywords, ','))`, never the substring-`POSITION()` style some existing Insights queries use.
- Counts are **distinct** story/article/repo ids per keyword per day, never raw row counts (ingestion runs ~48x/day, so raw counts inflate for any evergreen item).
- No dedup/idempotency guarantee across re-runs of `trend_scan` for the same day — accepted, matches the rest of the pipeline's existing behavior.
- v1 stores counts only per event — no representative example titles/URLs.
- `trend_scan.py` has no `DRY_RUN`-gated "run the whole Lambda locally" mode (there's no local substitute for the real Athena call) — but its Parquet-write step alone follows the same `DRY_RUN`-aware local-write convention `transform.write_parquet` already uses, purely so it's unit-testable without mocking S3.
- New IAM role `trend_scan_lambda`, not a shared/reused role — matches this project's existing "one IAM role per functional Lambda group" convention (`ingestion_lambda`, `transform_lambda`, `rag_lambda`).
- Web-facing errors are Vietnamese strings, matching every existing API route in `web/app/api/*/route.ts`.
- No `.test.tsx` files — this repo has zero component-level tests anywhere; `page.tsx` files stay untested, matching every other page in this project.

## Review Focus

- **Empty Athena result** (no keyword clears both thresholds that day): `write_trend_events` must handle an empty `rows` list without writing anything or crashing, returning `""`.
- **Athena's string-typed cells**: `GetQueryResults` returns every value as a string (`VarCharValue`) regardless of the underlying Glue column type — `write_trend_events` must convert counts to `int` before building the Parquet DataFrame, or the written column ends up as string/object instead of numeric.
- **The `query_athena` refactor changes no observable behavior**: after moving the poll loop into `common/athena.py`, `rag/agent.py`'s `query_athena` must still reject invalid SQL before ever touching Athena, and still return whatever `common/athena.py` returns for valid SQL — proven at both the extracted-module level and the thin-wrapper level.
- **Empty `trend_events` table** (before the first scheduled run ever completes): `/api/trends` and `/trends` must render a real, non-error empty state, not crash on an empty array.
- **Unbounded partition scan cost**: `buildTrendEventsQuery` must always include a partition-bounded `WHERE`, never an unfiltered `SELECT * FROM trend_events` (Athena's partition-projection config spans 2024–2035; an unbounded query would make it check every year in that range).

---

### Task 1: Extract shared Athena query helper (`common/athena.py`)

**Files:**
- Create: `common/athena.py`
- Create: `tests/test_athena.py`
- Modify: `rag/agent.py:1-26` (imports/globals), `rag/agent.py:176-180` (`_athena()`, delete), `rag/agent.py:256-298` (`query_athena`, replace body)
- Modify: `tests/test_rag_agent.py:1-5` (no import change needed), `tests/test_rag_agent.py:198-289` (delete `FakeAthena`/`_athena_results`/3 poll tests, replace the guard test, add a delegation test)

**Interfaces:**
- Produces: `common.athena.run_query(sql: str, max_rows: int = 25) -> tuple[list[dict], bool]` — runs `sql` against `config.ATHENA_WORKGROUP`/`config.ATHENA_DATABASE`, returns `(rows, truncated)`. Does **not** validate `sql` — callers with untrusted SQL must guard it themselves first. Raises `RuntimeError` on Athena failure/timeout.
- Produces: `common.athena._athena()` — lazy boto3 Athena client getter (monkeypatch target for tests).
- Consumes (Task 2): Task 2's `trends/trend_scan.py` calls `athena.run_query` directly (no guard needed — its SQL is Lambda-authored, not user/LLM-authored).

- [ ] **Step 1: Write the failing tests for `common/athena.py`**

Create `tests/test_athena.py`:

```python
import pytest

from common import athena


class FakeAthena:
    """Scripts a sequence of canned Athena API responses, keyed by call type."""

    def __init__(self, execution_states, results):
        self._execution_states = list(execution_states)
        self._results = results
        self.start_query_execution_calls = []

    def start_query_execution(self, **kwargs):
        self.start_query_execution_calls.append(kwargs)
        return {"QueryExecutionId": "qe1"}

    def get_query_execution(self, **kwargs):
        state = self._execution_states.pop(0)
        status = {"State": state}
        if state in ("FAILED", "CANCELLED"):
            status["StateChangeReason"] = "table not found"
        return {"QueryExecution": {"Status": status}}

    def get_query_results(self, **kwargs):
        max_results = kwargs.get("MaxResults")
        if max_results is None:
            return self._results
        # Real Athena counts the header row toward MaxResults.
        limited_rows = self._results["ResultSet"]["Rows"][:max_results]
        return {
            "ResultSet": {
                "ResultSetMetadata": self._results["ResultSet"]["ResultSetMetadata"],
                "Rows": limited_rows,
            }
        }


def _athena_results(columns: list[str], rows: list[list[str]]) -> dict:
    return {
        "ResultSet": {
            "ResultSetMetadata": {"ColumnInfo": [{"Name": c} for c in columns]},
            "Rows": [{"Data": [{"VarCharValue": c} for c in columns]}]
            + [{"Data": [{"VarCharValue": v} for v in row]} for row in rows],
        }
    }


def test_run_query_polls_until_succeeded_and_returns_rows(monkeypatch):
    fake = FakeAthena(
        execution_states=["RUNNING", "SUCCEEDED"],
        results=_athena_results(["coin_id", "avg_price"], [["bitcoin", "88420.5"]]),
    )
    monkeypatch.setattr(athena, "_athena", lambda: fake)
    monkeypatch.setattr(athena.time, "sleep", lambda seconds: None)

    rows, truncated = athena.run_query(
        "SELECT coin_id, AVG(price_usd) AS avg_price FROM crypto_prices"
    )

    assert rows == [{"coin_id": "bitcoin", "avg_price": "88420.5"}]
    assert truncated is False
    assert fake.start_query_execution_calls[0]["QueryString"].startswith("SELECT")


def test_run_query_raises_on_failed_query_state(monkeypatch):
    fake = FakeAthena(execution_states=["FAILED"], results=_athena_results([], []))
    monkeypatch.setattr(athena, "_athena", lambda: fake)
    monkeypatch.setattr(athena.time, "sleep", lambda seconds: None)

    with pytest.raises(RuntimeError, match="table not found"):
        athena.run_query("SELECT 1")


def test_run_query_marks_truncated_when_more_rows_than_max(monkeypatch):
    fake = FakeAthena(
        execution_states=["SUCCEEDED"],
        results=_athena_results(["n"], [["1"], ["2"], ["3"]]),
    )
    monkeypatch.setattr(athena, "_athena", lambda: fake)
    monkeypatch.setattr(athena.time, "sleep", lambda seconds: None)

    rows, truncated = athena.run_query("SELECT n FROM t", max_rows=2)

    assert rows == [{"n": "1"}, {"n": "2"}]
    assert truncated is True
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `source .venv/bin/activate && python -m pytest tests/test_athena.py -v`
Expected: FAIL/ERROR — `ModuleNotFoundError: No module named 'common.athena'`

- [ ] **Step 3: Create `common/athena.py`**

```python
import time

import boto3

from common import config

_athena_client = None

ATHENA_POLL_INTERVAL_SECONDS = 0.5
ATHENA_MAX_POLL_ATTEMPTS = 40  # ~20s cap per query


def _athena():
    global _athena_client
    if _athena_client is None:
        _athena_client = boto3.client("athena", region_name=config.AWS_REGION)
    return _athena_client


def run_query(sql: str, max_rows: int = 25) -> tuple[list[dict], bool]:
    """Runs sql against config.ATHENA_WORKGROUP/config.ATHENA_DATABASE.
    Returns (rows, truncated) -- rows as column-name-keyed dicts,
    truncated True if more rows existed than max_rows. Raises
    RuntimeError if the Athena query fails or times out. Does not
    validate sql -- callers passing untrusted SQL must guard it
    themselves first."""
    client = _athena()
    execution_id = client.start_query_execution(
        QueryString=sql,
        QueryExecutionContext={"Database": config.ATHENA_DATABASE},
        WorkGroup=config.ATHENA_WORKGROUP,
    )["QueryExecutionId"]

    for _ in range(ATHENA_MAX_POLL_ATTEMPTS):
        execution = client.get_query_execution(QueryExecutionId=execution_id)["QueryExecution"]
        status = execution["Status"]
        state = status["State"]
        if state == "SUCCEEDED":
            break
        if state in ("FAILED", "CANCELLED"):
            reason = status.get("StateChangeReason", "unknown reason")
            raise RuntimeError(f"Athena query {state.lower()}: {reason}")
        time.sleep(ATHENA_POLL_INTERVAL_SECONDS)
    else:
        raise RuntimeError("Athena query timed out waiting for SUCCEEDED state")

    # MaxResults counts the header row, so ask for max_rows+2 (header + up to
    # max_rows+1 data rows) -- seeing that extra (max_rows+1)-th data row is
    # what proves more data existed than max_rows allows through.
    results = client.get_query_results(QueryExecutionId=execution_id, MaxResults=max_rows + 2)
    result_set = results["ResultSet"]
    columns = [c["Name"] for c in result_set["ResultSetMetadata"]["ColumnInfo"]]
    data_rows = result_set["Rows"][1:]  # first row is the header
    truncated = len(data_rows) > max_rows
    data_rows = data_rows[:max_rows]
    rows = [
        {col: cell.get("VarCharValue") for col, cell in zip(columns, row["Data"])}
        for row in data_rows
    ]
    return rows, truncated
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `source .venv/bin/activate && python -m pytest tests/test_athena.py -v`
Expected: 3 passed

- [ ] **Step 5: Refactor `rag/agent.py` to delegate to `common/athena.py`**

In `rag/agent.py`, change the top imports/globals block from:

```python
import json
import logging
import math
import time
from datetime import datetime, timedelta, timezone
from io import BytesIO

import boto3
import numpy as np
import pandas as pd
import requests

from common import config
from common.secrets import get_secret
from common.sql_guard import validate_read_only_select

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3_client = None
_bedrock_client = None
_athena_client = None

MAX_ITERATIONS = 6
ATHENA_POLL_INTERVAL_SECONDS = 0.5
ATHENA_MAX_POLL_ATTEMPTS = 40  # ~20s cap per query
```

to:

```python
import json
import logging
import math
from datetime import datetime, timedelta, timezone
from io import BytesIO

import boto3
import numpy as np
import pandas as pd
import requests

from common import athena, config
from common.secrets import get_secret
from common.sql_guard import validate_read_only_select

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3_client = None
_bedrock_client = None

MAX_ITERATIONS = 6
```

(`time` is no longer used directly in this file once the poll loop moves out — removed from imports. `_athena_client`/`ATHENA_POLL_*` moved into `common/athena.py`.)

Delete the `_athena()` function entirely (currently at `rag/agent.py:176-180`):

```python
def _athena():
    global _athena_client
    if _athena_client is None:
        _athena_client = boto3.client("athena", region_name=config.AWS_REGION)
    return _athena_client
```

Replace the body of `query_athena` (currently `rag/agent.py:256-298`) from:

```python
def query_athena(sql: str, max_rows: int = 25) -> tuple[list[dict], bool]:
    """Runs a read-only SELECT against the curated Athena tables. Returns
    (rows, truncated) -- rows as column-name-keyed dicts, truncated True if
    more rows existed than max_rows. Raises ValueError for SQL the guard
    rejects, RuntimeError if the Athena query itself fails or times out."""
    ok, reason = validate_read_only_select(sql)
    if not ok:
        raise ValueError(reason)

    client = _athena()
    execution_id = client.start_query_execution(
        QueryString=sql,
        QueryExecutionContext={"Database": config.ATHENA_DATABASE},
        WorkGroup=config.ATHENA_WORKGROUP,
    )["QueryExecutionId"]

    for _ in range(ATHENA_MAX_POLL_ATTEMPTS):
        execution = client.get_query_execution(QueryExecutionId=execution_id)["QueryExecution"]
        status = execution["Status"]
        state = status["State"]
        if state == "SUCCEEDED":
            break
        if state in ("FAILED", "CANCELLED"):
            reason = status.get("StateChangeReason", "unknown reason")
            raise RuntimeError(f"Athena query {state.lower()}: {reason}")
        time.sleep(ATHENA_POLL_INTERVAL_SECONDS)
    else:
        raise RuntimeError("Athena query timed out waiting for SUCCEEDED state")

    # MaxResults counts the header row, so ask for max_rows+2 (header + up to
    # max_rows+1 data rows) -- seeing that extra (max_rows+1)-th data row is
    # what proves more data existed than max_rows allows through.
    results = client.get_query_results(QueryExecutionId=execution_id, MaxResults=max_rows + 2)
    result_set = results["ResultSet"]
    columns = [c["Name"] for c in result_set["ResultSetMetadata"]["ColumnInfo"]]
    data_rows = result_set["Rows"][1:]  # first row is the header
    truncated = len(data_rows) > max_rows
    data_rows = data_rows[:max_rows]
    rows = [
        {col: cell.get("VarCharValue") for col, cell in zip(columns, row["Data"])}
        for row in data_rows
    ]
    return rows, truncated
```

to:

```python
def query_athena(sql: str, max_rows: int = 25) -> tuple[list[dict], bool]:
    """Runs a read-only SELECT against the curated Athena tables via
    common/athena.py's shared run_query. Raises ValueError for SQL the
    guard rejects, RuntimeError if the Athena query itself fails or
    times out (propagated from common/athena.py)."""
    ok, reason = validate_read_only_select(sql)
    if not ok:
        raise ValueError(reason)
    return athena.run_query(sql, max_rows)
```

- [ ] **Step 6: Update `tests/test_rag_agent.py` to match the refactor**

Delete the `FakeAthena` class, `_athena_results` helper, and these three tests (currently `tests/test_rag_agent.py:198-289`, now covered by `tests/test_athena.py` instead):
- `test_query_athena_polls_until_succeeded_and_returns_rows`
- `test_query_athena_raises_on_failed_query_state`
- `test_query_athena_marks_truncated_when_more_rows_than_max`

Replace `test_query_athena_rejects_invalid_sql_without_calling_athena` (currently patches `agent._athena`, which no longer exists) from:

```python
def test_query_athena_rejects_invalid_sql_without_calling_athena(monkeypatch):
    def fail_if_called():
        raise AssertionError("should not reach Athena for invalid SQL")

    monkeypatch.setattr(agent, "_athena", fail_if_called)

    with pytest.raises(ValueError):
        agent.query_athena("DROP TABLE crypto_prices")
```

to:

```python
def test_query_athena_rejects_invalid_sql_without_calling_athena(monkeypatch):
    def fail_if_called(sql, max_rows=25):
        raise AssertionError("should not reach Athena for invalid SQL")

    monkeypatch.setattr(agent.athena, "run_query", fail_if_called)

    with pytest.raises(ValueError):
        agent.query_athena("DROP TABLE crypto_prices")


def test_query_athena_delegates_to_athena_run_query_when_sql_is_valid(monkeypatch):
    monkeypatch.setattr(
        agent.athena, "run_query", lambda sql, max_rows: ([{"coin_id": "bitcoin"}], False)
    )

    rows, truncated = agent.query_athena("SELECT * FROM crypto_prices", max_rows=10)

    assert rows == [{"coin_id": "bitcoin"}]
    assert truncated is False
```

Leave every other test in this file untouched — `test_run_tool_query_athena_*` and
`test_run_agent_calls_query_athena_tool_then_returns_final_answer` all monkeypatch
`agent.query_athena` itself (the wrapper), not its internals, so they're unaffected.

- [ ] **Step 7: Run the full test suite and lint**

Run: `source .venv/bin/activate && python -m pytest -q && ruff check .`
Expected: all tests pass, ruff clean (this confirms nothing else references the deleted `agent._athena`/`agent.ATHENA_POLL_*`/`agent.time`)

- [ ] **Step 8: Commit**

```bash
git add common/athena.py tests/test_athena.py rag/agent.py tests/test_rag_agent.py
git commit -m "refactor: extract shared Athena query helper into common/athena.py

query_athena's start/poll/get-results loop is about to get a second call
site (the trend-scan Lambda). Move it out of rag/agent.py so both share
one implementation instead of a second copy."
```

---

### Task 2: `trends/trend_scan.py` — detection query, storage, Lambda handler

**Files:**
- Create: `trends/__init__.py` (empty)
- Create: `trends/trend_scan.py`
- Create: `tests/test_trend_scan.py`
- Modify: `common/config.py` (append 3 new config vars)

**Interfaces:**
- Consumes: `common.athena.run_query(sql: str, max_rows: int = 25) -> tuple[list[dict], bool]` (Task 1).
- Produces: `trends.trend_scan.build_detection_query(year: str, month: str, day: str) -> str`, `trends.trend_scan.write_trend_events(rows: list[dict], event_date: str, now: datetime | None = None) -> str`, `trends.trend_scan.lambda_handler(event, context) -> dict` — all consumed by Task 3 (infra references the module path `trend_scan.lambda_handler` and `trends/trend_scan.py` as the Lambda source file).

- [ ] **Step 1: Add the three new config vars**

Append to `common/config.py` (after the existing `TAVILY_SECRET_NAME`/Athena section):

```python

# Trend Events (trends/trend_scan.py) -- daily cross-source keyword detection.
TREND_HN_MIN_STORIES = int(os.environ.get("TREND_HN_MIN_STORIES", "3"))
TREND_NEWS_MIN_ARTICLES = int(os.environ.get("TREND_NEWS_MIN_ARTICLES", "2"))
TREND_MAX_EVENTS_PER_DAY = int(os.environ.get("TREND_MAX_EVENTS_PER_DAY", "3"))
```

- [ ] **Step 2: Write the failing tests**

Create `trends/__init__.py` (empty file — matches `ingestion/__init__.py`/`rag/__init__.py`/`transform/__init__.py`, needed so `from trends import trend_scan` works).

Create `tests/test_trend_scan.py`:

```python
from datetime import datetime, timezone

import pandas as pd

from common import config
from trends import trend_scan


def test_build_detection_query_references_all_three_tables():
    sql = trend_scan.build_detection_query("2026", "09", "27")

    assert "github_repos" in sql
    assert "hackernews_stories" in sql
    assert "news_articles" in sql
    assert "day='27'" in sql
    assert "UNNEST" in sql
    assert "POSITION" not in sql


def test_build_detection_query_applies_configured_thresholds(monkeypatch):
    monkeypatch.setattr(config, "TREND_HN_MIN_STORIES", 5)
    monkeypatch.setattr(config, "TREND_NEWS_MIN_ARTICLES", 4)
    monkeypatch.setattr(config, "TREND_MAX_EVENTS_PER_DAY", 2)

    sql = trend_scan.build_detection_query("2026", "09", "27")

    assert "COUNT(DISTINCT hn.item_id) >= 5" in sql
    assert "COUNT(DISTINCT news.item_id) >= 4" in sql
    assert "LIMIT 2" in sql


def test_write_trend_events_dry_run_writes_readable_parquet(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DRY_RUN", True)
    monkeypatch.chdir(tmp_path)
    now = datetime(2026, 9, 27, 23, 0, 0, tzinfo=timezone.utc)

    rows = [{"keyword": "deepseek", "github_count": "2", "hn_count": "5", "news_count": "3"}]
    key = trend_scan.write_trend_events(rows, "2026-09-27", now)

    df = pd.read_parquet(tmp_path / "local_output_curated" / key)
    assert len(df) == 1
    assert df.loc[0, "event_id"] == "deepseek-2026-09-27"
    assert df.loc[0, "github_count"] == 2
    assert df.loc[0, "hn_count"] == 5
    assert df.loc[0, "news_count"] == 3


def test_write_trend_events_returns_empty_string_for_no_events(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DRY_RUN", True)
    monkeypatch.chdir(tmp_path)

    key = trend_scan.write_trend_events([], "2026-09-27")

    assert key == ""


def test_lambda_handler_writes_detected_events(monkeypatch):
    monkeypatch.setattr(
        trend_scan.athena, "run_query", lambda sql, max_rows: ([{"keyword": "rust"}], False)
    )
    monkeypatch.setattr(
        trend_scan, "write_trend_events", lambda rows, event_date, now=None: "some/key.parquet"
    )

    result = trend_scan.lambda_handler({}, None)

    assert result["events_detected"] == 1
    assert result["s3_key"] == "some/key.parquet"


def test_lambda_handler_handles_zero_events(monkeypatch):
    monkeypatch.setattr(trend_scan.athena, "run_query", lambda sql, max_rows: ([], False))
    monkeypatch.setattr(trend_scan, "write_trend_events", lambda rows, event_date, now=None: "")

    result = trend_scan.lambda_handler({}, None)

    assert result["events_detected"] == 0
    assert result["s3_key"] == ""
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `source .venv/bin/activate && python -m pytest tests/test_trend_scan.py -v`
Expected: FAIL/ERROR — `ModuleNotFoundError: No module named 'trends'`

- [ ] **Step 4: Implement `trends/trend_scan.py`**

```python
import logging
import os
import uuid
from datetime import datetime, timezone

import boto3
import pandas as pd

from common import athena, config

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3_client = None


def _s3():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=config.AWS_REGION)
    return _s3_client


def build_detection_query(year: str, month: str, day: str) -> str:
    """One fixed, Lambda-authored query -- not user/LLM input, so
    validate_read_only_select does not apply here. Exact keyword-token
    matching via UNNEST/split (not the substring-POSITION() style some
    existing Insights queries use), and distinct item ids per keyword
    (not raw row counts -- ingestion re-ingests the same story/article
    across its ~48 runs/day)."""
    where = f"year='{year}' AND month='{month}' AND day='{day}' AND k <> ''"
    return f"""WITH gh AS (
  SELECT DISTINCT repo_id AS item_id, k AS keyword
  FROM github_repos
  CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
  WHERE {where}
),
hn AS (
  SELECT DISTINCT story_id AS item_id, k AS keyword
  FROM hackernews_stories
  CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
  WHERE {where}
),
news AS (
  SELECT DISTINCT article_id AS item_id, k AS keyword
  FROM news_articles
  CROSS JOIN UNNEST(split(keywords, ',')) AS t(k)
  WHERE {where}
)
SELECT
  gh.keyword,
  COUNT(DISTINCT gh.item_id) AS github_count,
  COUNT(DISTINCT hn.item_id) AS hn_count,
  COUNT(DISTINCT news.item_id) AS news_count
FROM gh
JOIN hn ON gh.keyword = hn.keyword
JOIN news ON gh.keyword = news.keyword
GROUP BY gh.keyword
HAVING COUNT(DISTINCT hn.item_id) >= {config.TREND_HN_MIN_STORIES}
   AND COUNT(DISTINCT news.item_id) >= {config.TREND_NEWS_MIN_ARTICLES}
ORDER BY (COUNT(DISTINCT hn.item_id) + COUNT(DISTINCT news.item_id)) DESC
LIMIT {config.TREND_MAX_EVENTS_PER_DAY}"""


def build_curated_key(ts: datetime) -> str:
    return (
        f"source=trend_events/year={ts:%Y}/month={ts:%m}/day={ts:%d}/"
        f"{ts:%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:8]}.parquet"
    )


def write_trend_events(rows: list[dict], event_date: str, now: datetime | None = None) -> str:
    """Athena's GetQueryResults returns every cell as a string regardless
    of the underlying Glue column type -- github_count/hn_count/news_count
    must be cast to int before they reach the DataFrame, or the written
    Parquet column ends up string-typed instead of numeric."""
    if not rows:
        return ""

    now = now or datetime.now(timezone.utc)
    records = [
        {
            "event_id": f"{row['keyword']}-{event_date}",
            "keyword": row["keyword"],
            "event_date": event_date,
            "github_count": int(row["github_count"]),
            "hn_count": int(row["hn_count"]),
            "news_count": int(row["news_count"]),
            "detected_at": now.isoformat(),
        }
        for row in rows
    ]
    df = pd.DataFrame(records)

    key = build_curated_key(now)
    local_path = f"/tmp/{uuid.uuid4().hex}.parquet"
    df.to_parquet(local_path, engine="pyarrow", index=False)

    try:
        if config.DRY_RUN or not config.CURATED_BUCKET:
            dest = os.path.join("local_output_curated", key)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            os.replace(local_path, dest)
            return key

        _s3().upload_file(local_path, config.CURATED_BUCKET, key)
        return key
    finally:
        if os.path.exists(local_path):
            os.remove(local_path)


def lambda_handler(event, context):
    now = datetime.now(timezone.utc)
    event_date = now.strftime("%Y-%m-%d")
    sql = build_detection_query(now.strftime("%Y"), now.strftime("%m"), now.strftime("%d"))

    rows, _truncated = athena.run_query(sql, max_rows=config.TREND_MAX_EVENTS_PER_DAY)
    key = write_trend_events(rows, event_date, now)

    logger.info("Detected %d trend event(s) for %s -> %s", len(rows), event_date, key)
    return {"statusCode": 200, "events_detected": len(rows), "s3_key": key}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(lambda_handler({}, None))
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `source .venv/bin/activate && python -m pytest tests/test_trend_scan.py -v`
Expected: 6 passed

- [ ] **Step 6: Run the full test suite and lint**

Run: `source .venv/bin/activate && python -m pytest -q && ruff check .`
Expected: all tests pass, ruff clean

- [ ] **Step 7: Commit**

```bash
git add common/config.py trends/
git commit -m "feat: add trend_scan Lambda -- daily cross-source keyword detection"
```

---

### Task 3: Infra — Glue table, IAM role, Lambda, schedule

**Files:**
- Modify: `infra/glue.tf` (new `trend_events_columns` local + `aws_glue_catalog_table.trend_events`, inserted before `resource "aws_athena_workgroup" "main"`)
- Create: `infra/trends.tf`
- Modify: `infra/variables.tf` (4 new variables, appended)
- Modify: `infra/monitoring.tf` (add `trend_scan` to the `lambda_errors` alarm's `for_each` map)
- Modify: `scripts/build_lambdas.sh` (1 new `package_no_deps` line)

**Interfaces:**
- Consumes: `trends/trend_scan.py` (Task 2), specifically the module path `trend_scan.lambda_handler`.
- Produces: nothing consumed by later tasks — Tasks 4-6 (web) query the `trend_events` Glue table by name/columns only, which this task creates.

- [ ] **Step 1: Add the `trend_events` Glue table to `infra/glue.tf`**

Insert immediately before the existing `resource "aws_athena_workgroup" "main" {` block:

```hcl
locals {
  trend_events_columns = [
    { name = "event_id", type = "string", comment = "Synthetic id \"{keyword}-{event_date}\", unique per keyword per day (not guaranteed unique across a re-run of the same day -- see trends/trend_scan.py)." },
    { name = "keyword", type = "string", comment = "The qualifying keyword, lowercase." },
    { name = "event_date", type = "string", comment = "YYYY-MM-DD of the scanned UTC day (also encoded in the year/month/day partition keys, kept here too for easy display without date reassembly)." },
    { name = "github_count", type = "bigint", comment = "Distinct trending GitHub repos mentioning the keyword that day." },
    { name = "hn_count", type = "bigint", comment = "Distinct Hacker News stories mentioning the keyword that day." },
    { name = "news_count", type = "bigint", comment = "Distinct news articles mentioning the keyword that day." },
    { name = "detected_at", type = "string", comment = "ISO 8601 UTC timestamp of when trend_scan ran." },
  ]
}

resource "aws_glue_catalog_table" "trend_events" {
  name          = "trend_events"
  database_name = aws_glue_catalog_database.curated.name
  table_type    = "EXTERNAL_TABLE"

  parameters = merge(local.partition_projection_base, {
    "classification"            = "parquet"
    "storage.location.template" = "s3://${aws_s3_bucket.curated.bucket}/source=trend_events/year=$${year}/month=$${month}/day=$${day}/"
  })

  partition_keys {
    name    = "year"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (year=YYYY) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "month"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (month=MM, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }
  partition_keys {
    name    = "day"
    type    = "string"
    comment = "Partition key, derived from the S3 key path (day=DD, zero-padded) via Athena partition projection -- not a column stored in the file itself."
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.curated.bucket}/source=trend_events/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
    }

    dynamic "columns" {
      for_each = local.trend_events_columns
      content {
        name    = columns.value.name
        type    = columns.value.type
        comment = columns.value.comment
      }
    }
  }
}
```

- [ ] **Step 2: Add the 4 new Terraform variables**

Append to `infra/variables.tf`:

```hcl

variable "trend_scan_schedule" {
  description = "EventBridge schedule expression for the daily trend_scan Lambda"
  type        = string
  default     = "cron(0 23 * * ? *)"
}

variable "trend_hn_min_stories" {
  description = "Minimum distinct Hacker News stories mentioning a keyword in one day for it to qualify as a Trend Event"
  type        = number
  default     = 3
}

variable "trend_news_min_articles" {
  description = "Minimum distinct News API articles mentioning a keyword in one day for it to qualify as a Trend Event"
  type        = number
  default     = 2
}

variable "trend_max_events_per_day" {
  description = "Max number of Trend Events trend_scan will write in a single run"
  type        = number
  default     = 3
}
```

- [ ] **Step 3: Create `infra/trends.tf`**

```hcl
# Daily cross-source keyword-trend detection: trend_scan runs once/day,
# queries github_repos/hackernews_stories/news_articles for the current
# UTC day via common/athena.py's shared query helper, and writes any
# qualifying keywords as Trend Events to the curated zone. See
# docs/superpowers/specs/2026-09-27-trend-events-design.md.

resource "aws_iam_role" "trend_scan_lambda" {
  name               = "${local.name_prefix}-trend-scan-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "trend_scan_basic_logs" {
  role       = aws_iam_role.trend_scan_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "trend_scan_permissions" {
  statement {
    sid       = "RunAthenaQueries"
    actions   = ["athena:StartQueryExecution", "athena:GetQueryExecution", "athena:GetQueryResults"]
    resources = [aws_athena_workgroup.main.arn]
  }

  statement {
    sid     = "ReadGlueCuratedSchema"
    actions = ["glue:GetDatabase", "glue:GetTable", "glue:GetPartitions"]
    resources = [
      "arn:aws:glue:*:${data.aws_caller_identity.current.account_id}:catalog",
      aws_glue_catalog_database.curated.arn,
      "arn:aws:glue:*:${data.aws_caller_identity.current.account_id}:table/${aws_glue_catalog_database.curated.name}/*",
    ]
  }

  statement {
    sid       = "ReadCuratedZone"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.curated.arn}/*"]
  }

  statement {
    sid       = "ListCuratedZone"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.curated.arn]
  }

  statement {
    sid       = "WriteTrendEvents"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.curated.arn}/source=trend_events/*"]
  }

  statement {
    sid       = "WriteAthenaResults"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.curated.arn}/athena-results/*"]
  }

  statement {
    sid       = "AthenaResultsBucketLocation"
    actions   = ["s3:GetBucketLocation"]
    resources = [aws_s3_bucket.curated.arn]
  }
}

resource "aws_iam_role_policy" "trend_scan_permissions" {
  name   = "${local.name_prefix}-trend-scan-permissions"
  role   = aws_iam_role.trend_scan_lambda.id
  policy = data.aws_iam_policy_document.trend_scan_permissions.json
}

data "archive_file" "trend_scan" {
  type        = "zip"
  source_dir  = "${path.module}/build/trend_scan"
  output_path = "${path.module}/build/trend_scan.zip"
}

resource "aws_lambda_function" "trend_scan" {
  function_name    = "${local.name_prefix}-trend-scan"
  role             = aws_iam_role.trend_scan_lambda.arn
  handler          = "trend_scan.lambda_handler"
  runtime          = var.lambda_runtime
  timeout          = 60
  memory_size      = 512
  filename         = data.archive_file.trend_scan.output_path
  source_code_hash = data.archive_file.trend_scan.output_base64sha256
  layers           = [var.pandas_layer_arn]

  environment {
    variables = {
      CURATED_BUCKET           = aws_s3_bucket.curated.bucket
      ATHENA_WORKGROUP         = aws_athena_workgroup.main.name
      ATHENA_DATABASE          = aws_glue_catalog_database.curated.name
      TREND_HN_MIN_STORIES     = tostring(var.trend_hn_min_stories)
      TREND_NEWS_MIN_ARTICLES  = tostring(var.trend_news_min_articles)
      TREND_MAX_EVENTS_PER_DAY = tostring(var.trend_max_events_per_day)
    }
  }
}

resource "aws_cloudwatch_log_group" "trend_scan" {
  name              = "/aws/lambda/${aws_lambda_function.trend_scan.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_event_rule" "trend_scan_schedule" {
  name                = "${local.name_prefix}-trend-scan-schedule"
  schedule_expression = var.trend_scan_schedule
  state               = var.enable_ingestion_schedule ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "trend_scan" {
  rule = aws_cloudwatch_event_rule.trend_scan_schedule.name
  arn  = aws_lambda_function.trend_scan.arn
}

resource "aws_lambda_permission" "allow_eventbridge_trend_scan" {
  statement_id  = "AllowEventBridgeInvokeTrendScan"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.trend_scan.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.trend_scan_schedule.arn
}
```

- [ ] **Step 4: Add `trend_scan` to the existing error alarm**

In `infra/monitoring.tf`, change the `aws_cloudwatch_metric_alarm.lambda_errors` `for_each` map from:

```hcl
  for_each = {
    hackernews_ingestion      = aws_lambda_function.hackernews_ingestion.function_name
    news_ingestion            = aws_lambda_function.news_ingestion.function_name
    weather_ingestion         = aws_lambda_function.weather_ingestion.function_name
    crypto_ingestion          = aws_lambda_function.crypto_ingestion.function_name
    github_trending_ingestion = aws_lambda_function.github_trending_ingestion.function_name
    gmail_ingestion           = aws_lambda_function.gmail_ingestion.function_name
    transform                 = aws_lambda_function.transform.function_name
  }
```

to:

```hcl
  for_each = {
    hackernews_ingestion      = aws_lambda_function.hackernews_ingestion.function_name
    news_ingestion            = aws_lambda_function.news_ingestion.function_name
    weather_ingestion         = aws_lambda_function.weather_ingestion.function_name
    crypto_ingestion          = aws_lambda_function.crypto_ingestion.function_name
    github_trending_ingestion = aws_lambda_function.github_trending_ingestion.function_name
    gmail_ingestion           = aws_lambda_function.gmail_ingestion.function_name
    transform                 = aws_lambda_function.transform.function_name
    trend_scan                = aws_lambda_function.trend_scan.function_name
  }
```

- [ ] **Step 5: Add the build step**

In `scripts/build_lambdas.sh`, add this line after `package_no_deps rag_build_index rag/build_index.py` and before `package_with_requests rag_agent rag/agent.py`:

```bash
package_no_deps trend_scan trends/trend_scan.py
```

(`package_no_deps`, not `package_with_requests` — `trend_scan.py` only imports `boto3`/`pandas`, both already provided by the Lambda runtime/pandas layer, same as `transform`/`rag_build_index`.)

- [ ] **Step 6: Validate Terraform**

Run:
```bash
cd infra && terraform fmt -diff . && terraform validate
```
Expected: `terraform fmt -diff` shows no diff (or apply it if it does, then re-run), `terraform validate` reports `Success! The configuration is valid.`

- [ ] **Step 7: Build the Lambda packages locally to confirm the build script works**

Run: `./scripts/build_lambdas.sh`
Expected: completes without error; `infra/build/trend_scan/` exists and contains `trend_scan.py` and `common/`.

- [ ] **Step 8: Commit**

```bash
git add infra/glue.tf infra/trends.tf infra/variables.tf infra/monitoring.tf scripts/build_lambdas.sh
git commit -m "feat: add trend_scan Lambda infra (Glue table, IAM role, schedule)"
```

---

### Task 4: Web query builder (`web/lib/trendsQueries.ts`)

**Files:**
- Create: `web/lib/trendsQueries.ts`
- Create: `web/lib/trendsQueries.test.ts`

**Interfaces:**
- Consumes: `web/lib/athena.ts`'s existing `partitionPredicateAny(partsList: TodayParts[], alias?: string): string` and `TodayParts` type.
- Produces: `buildTrendEventsQuery(partsList: TodayParts[]): string` — consumed by Task 5's route.

- [ ] **Step 1: Write the failing tests**

Create `web/lib/trendsQueries.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildTrendEventsQuery } from "./trendsQueries";

const PARTS_TODAY = [{ year: "2026", month: "09", day: "27" }];
const PARTS_MULTI = [
  { year: "2026", month: "09", day: "27" },
  { year: "2026", month: "09", day: "26" },
];

describe("buildTrendEventsQuery", () => {
  it("references the trend_events table, is partition-bounded, and orders newest first", () => {
    const sql = buildTrendEventsQuery(PARTS_TODAY);
    expect(sql).toContain("FROM trend_events");
    expect(sql).toContain("WHERE");
    expect(sql).toContain("day='27'");
    expect(sql).toContain("ORDER BY event_date DESC");
  });

  it("references every day in a multi-day range", () => {
    const sql = buildTrendEventsQuery(PARTS_MULTI);
    expect(sql).toContain("day='27'");
    expect(sql).toContain("day='26'");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run lib/trendsQueries.test.ts`
Expected: FAIL — `Failed to load url ./trendsQueries`

- [ ] **Step 3: Implement `web/lib/trendsQueries.ts`**

```typescript
import { partitionPredicateAny, type TodayParts } from "./athena";

export function buildTrendEventsQuery(partsList: TodayParts[]): string {
  const where = partitionPredicateAny(partsList);
  return `SELECT event_id, keyword, event_date, github_count, hn_count, news_count
FROM trend_events
WHERE ${where}
ORDER BY event_date DESC, (hn_count + news_count) DESC`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run lib/trendsQueries.test.ts`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add web/lib/trendsQueries.ts web/lib/trendsQueries.test.ts
git commit -m "feat: add buildTrendEventsQuery"
```

---

### Task 5: Types + `/api/trends` route

**Files:**
- Modify: `web/lib/types.ts` (append `TrendEvent`/`TrendsResponse`)
- Create: `web/app/api/trends/route.ts`
- Create: `web/app/api/trends/route.test.ts`

**Interfaces:**
- Consumes: Task 4's `buildTrendEventsQuery`; existing `web/lib/aws.ts`'s `getAthenaClient()`; existing `web/lib/athena.ts`'s `runAthenaQuery`/`parseAthenaRows`; existing `web/lib/dateRange.ts`'s `lastNDaysUtcParts(n: number): TodayParts[]`.
- Produces: `GET /api/trends` returning `{ events: TrendEvent[] }` — consumed by Task 6's page.

- [ ] **Step 1: Add the types**

Append to `web/lib/types.ts`:

```typescript
export type TrendEvent = {
  eventId: string;
  keyword: string;
  eventDate: string;
  githubCount: number;
  hnCount: number;
  newsCount: number;
};

export type TrendsResponse = { events: TrendEvent[] };
```

- [ ] **Step 2: Write the failing route tests**

Create `web/app/api/trends/route.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/aws", () => ({ getAthenaClient: vi.fn(() => ({})) }));
vi.mock("@/lib/athena", async () => {
  const actual = await vi.importActual<typeof import("@/lib/athena")>("@/lib/athena");
  return { ...actual, runAthenaQuery: vi.fn() };
});

import { runAthenaQuery } from "@/lib/athena";
import { GET } from "./route";

const mockedRun = vi.mocked(runAthenaQuery);

function rows(header: string[], data: string[][]) {
  return [
    { Data: header.map((h) => ({ VarCharValue: h })) },
    ...data.map((row) => ({ Data: row.map((v) => ({ VarCharValue: v })) })),
  ];
}

const COLUMNS = ["event_id", "keyword", "event_date", "github_count", "hn_count", "news_count"];

beforeEach(() => {
  mockedRun.mockReset();
});

describe("GET /api/trends", () => {
  it("returns parsed trend events", async () => {
    mockedRun.mockResolvedValueOnce(
      rows(COLUMNS, [["deepseek-2026-09-27", "deepseek", "2026-09-27", "2", "5", "3"]])
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.events).toEqual([
      {
        eventId: "deepseek-2026-09-27",
        keyword: "deepseek",
        eventDate: "2026-09-27",
        githubCount: 2,
        hnCount: 5,
        newsCount: 3,
      },
    ]);
  });

  it("returns an empty list when there are no trend events yet", async () => {
    mockedRun.mockResolvedValueOnce(rows(COLUMNS, []));

    const response = await GET();
    const body = await response.json();

    expect(body.events).toEqual([]);
  });

  it("returns 500 with a safe message when Athena fails", async () => {
    mockedRun.mockRejectedValueOnce(new Error("Athena query failed: table not found"));

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được Trends, thử lại sau.");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run app/api/trends/route.test.ts`
Expected: FAIL — `Failed to load url ./route` (the route file doesn't exist yet)

- [ ] **Step 4: Implement `web/app/api/trends/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { getAthenaClient } from "@/lib/aws";
import { runAthenaQuery, parseAthenaRows } from "@/lib/athena";
import { lastNDaysUtcParts } from "@/lib/dateRange";
import { buildTrendEventsQuery } from "@/lib/trendsQueries";
import type { TrendsResponse } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  try {
    const partsList = lastNDaysUtcParts(90);
    const athena = getAthenaClient();

    const rows = await runAthenaQuery(athena, buildTrendEventsQuery(partsList));

    const response: TrendsResponse = {
      events: parseAthenaRows(rows, (cols) => ({
        eventId: cols[0] ?? "",
        keyword: cols[1] ?? "",
        eventDate: cols[2] ?? "",
        githubCount: Number(cols[3] ?? 0),
        hnCount: Number(cols[4] ?? 0),
        newsCount: Number(cols[5] ?? 0),
      })),
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Trends API failed", error);
    return NextResponse.json({ error: "Không tải được Trends, thử lại sau." }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run app/api/trends/route.test.ts`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add web/lib/types.ts web/app/api/trends/
git commit -m "feat: add GET /api/trends"
```

---

### Task 6: `/trends` page + sidebar entry

**Files:**
- Create: `web/app/trends/page.tsx`
- Modify: `web/components/Sidebar.tsx` (`LEGACY_LINKS`)

**Interfaces:**
- Consumes: `GET /api/trends` (Task 5), `TrendsResponse`/`TrendEvent` types (Task 5).
- Produces: nothing consumed by later tasks (final task in this plan).

- [ ] **Step 1: Implement `web/app/trends/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { TrendsResponse } from "@/lib/types";

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export default function TrendsPage() {
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/trends");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không tải được Trends.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được Trends.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return (
      <div className="p-9 flex flex-col gap-4">
        <p className="text-error text-sm">{error}</p>
        <button
          onClick={() => load()}
          className="w-fit rounded-lg border border-border px-4 py-2 text-sm text-textPrimary"
        >
          Thử lại
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-9 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-lg border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-9 flex flex-col gap-5">
      <h1 className="font-heading text-2xl font-semibold text-textPrimary">Trend Events</h1>

      {data.events.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-8 text-center">
          <span className="text-[13px] text-textMuted">
            Chưa có sự kiện xu hướng nào -- sẽ xuất hiện sau lần quét hằng ngày đầu tiên.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {data.events.map((event) => (
            <div
              key={event.eventId}
              className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex items-center justify-between gap-4"
            >
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11px] text-textMuted">{event.eventDate}</span>
                <span className="text-[15px] font-semibold text-textPrimary">{event.keyword}</span>
              </div>
              <span className="font-mono tabular-nums text-[11px] text-textMuted text-right">
                GitHub: {event.githubCount} {pluralize(event.githubCount, "repo", "repos")} · HN:{" "}
                {event.hnCount} {pluralize(event.hnCount, "story", "stories")} · News:{" "}
                {event.newsCount} {pluralize(event.newsCount, "article", "articles")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the sidebar entry**

In `web/components/Sidebar.tsx`, add a new entry to `LEGACY_LINKS`, right after the `/insights` entry:

```tsx
  {
    href: "/trends",
    label: "Trend Events",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="20" x2="6" y2="14" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="18" y1="20" x2="18" y2="10" />
      </svg>
    ),
  },
```

- [ ] **Step 3: Typecheck and build**

Run: `cd web && npx tsc --noEmit && npx vitest run && npm run build`
Expected: all clean, `/trends` appears in the build's route list.

- [ ] **Step 4: Commit**

```bash
git add web/app/trends/ web/components/Sidebar.tsx
git commit -m "feat: add /trends page and sidebar entry"
```

- [ ] **Step 5: Manual live-verification checklist (post-deploy, not part of this commit)**

After `terraform apply` deploys the new Lambda/schedule/Glue table:
- Load `/trends` before the first scheduled run — confirm the empty state renders, not an error.
- Manually invoke the Lambda: `aws lambda invoke --function-name <prefix>-trend-scan --cli-read-timeout 90 /tmp/out.json && cat /tmp/out.json`.
- If any keyword qualified that day, confirm a new Parquet file exists under `s3://<curated-bucket>/source=trend_events/`, and reload `/trends` to confirm it now shows that event.

---

### Task 7: Document the new pipeline stage in `README.md`

**Files:**
- Modify: `README.md` (architecture diagram, file list, new short section)

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing (final task in this plan).

- [ ] **Step 1: Add `trend_scan` to the architecture diagram**

In `README.md`, change the mermaid diagram from:

```
    G --> K[Lambda: rag_build_index<br/>hackernews/news/github only]
    K -->|Titan embeddings| L[S3 rag-index/index.json]

    Q[Question] --> AG[Lambda: rag_agent<br/>tool-calling loop]
    L --> AG
    AG -->|LLM decides tools/retries| R2[Answer + sources]
```

to:

```
    G --> K[Lambda: rag_build_index<br/>hackernews/news/github only]
    K -->|Titan embeddings| L[S3 rag-index/index.json]

    Q[Question] --> AG[Lambda: rag_agent<br/>tool-calling loop]
    L --> AG
    AG -->|LLM decides tools/retries| R2[Answer + sources]

    T[EventBridge Scheduler<br/>daily] --> TS[Lambda: trend_scan]
    I -->|3-way keyword join| TS
    TS --> TE[S3 trend_events<br/>Parquet]
    TE --> H
```

(`TS` reads via Athena, same as `AG`/`rag_agent` does for `query_athena` — drawn as `I -->|...| TS` since it queries through the same Athena workgroup `AG` already connects to. `TE --> H` because the new Parquet output is registered back into the same Glue Catalog as every other curated table.)

- [ ] **Step 2: Add a `trends/` bullet to the file list**

In `README.md`'s bullet list (after the `rag/` bullet, before `common/`), add:

```markdown
- `trends/` -- `trend_scan.py` (Lambda `<project>-trend-scan`, daily EventBridge
  schedule): detects keywords trending simultaneously across GitHub Trending,
  Hacker News, and News API for the current UTC day (distinct story/article/repo
  counts per keyword, not raw mention counts -- see the module docstring),
  writes qualifying keywords as Trend Events to the curated zone. Surfaced on
  the web app's `/trends` page.
```

- [ ] **Step 3: Manually verify the mermaid diagram renders**

Open `README.md` in a Markdown previewer that renders mermaid (e.g. GitHub's own
preview once pushed, or a local Markdown editor with mermaid support) and
confirm the new `T`/`TS`/`TE` nodes and edges render without syntax errors.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document the trend_scan Lambda and /trends page"
```
