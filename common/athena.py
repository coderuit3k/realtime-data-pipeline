"""Synchronous Athena query helper for the RAG agent and the trend scan."""

import logging
import time
from urllib.parse import urlparse

import boto3

from common import config

logger = logging.getLogger(__name__)

_athena_client = None
_s3_client = None

ATHENA_POLL_INTERVAL_SECONDS = 0.5
ATHENA_MAX_POLL_ATTEMPTS = 40  # ~20s cap per query


def _athena():
    """Created on first use and reused across warm Lambda invocations."""
    global _athena_client
    if _athena_client is None:
        _athena_client = boto3.client("athena", region_name=config.AWS_REGION)
    return _athena_client


def _s3():
    """Created on first use and reused across warm Lambda invocations."""
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=config.AWS_REGION)
    return _s3_client


def _delete_result_metadata(output_location: str) -> None:
    """Delete the `.csv.metadata` file Athena always writes beside a result.

    Athena has no option to suppress it. Must run only AFTER get_query_results:
    GetQueryResults reads this file, and deleting it earlier makes Athena answer
    "Could not find results". Best effort -- a failed cleanup must never fail
    the query.
    """
    parsed = urlparse(output_location)
    try:
        _s3().delete_object(Bucket=parsed.netloc, Key=parsed.path.lstrip("/") + ".metadata")
    except Exception:
        logger.warning(
            "Could not delete Athena result metadata for %s", output_location, exc_info=True
        )


def run_query(sql: str, max_rows: int = 25) -> tuple[list[dict], bool]:
    """Run sql and return (rows, truncated), rows as column-name-keyed dicts.

    truncated is True when more than max_rows rows existed. Raises RuntimeError
    if the query fails or times out. Does NOT validate sql: callers passing
    untrusted SQL must run it through common.sql_guard first.
    """
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

    # MaxResults counts the header row: +1 for the header, +1 for a probe row
    # whose presence is the only way to know the result was truncated.
    results = client.get_query_results(QueryExecutionId=execution_id, MaxResults=max_rows + 2)
    _delete_result_metadata(execution["ResultConfiguration"]["OutputLocation"])
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
