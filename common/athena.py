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
