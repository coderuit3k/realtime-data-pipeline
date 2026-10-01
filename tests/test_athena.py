import pytest

from common import athena


class FakeAthena:
    """Scripts a sequence of canned Athena API responses, keyed by call type."""

    def __init__(self, execution_states, results, events=None):
        self._execution_states = list(execution_states)
        self._results = results
        self._events = events if events is not None else []
        self.start_query_execution_calls = []

    def start_query_execution(self, **kwargs):
        self.start_query_execution_calls.append(kwargs)
        return {"QueryExecutionId": "qe1"}

    def get_query_execution(self, **kwargs):
        state = self._execution_states.pop(0)
        status = {"State": state}
        if state in ("FAILED", "CANCELLED"):
            status["StateChangeReason"] = "table not found"
        return {
            "QueryExecution": {
                "Status": status,
                "ResultConfiguration": {
                    "OutputLocation": "s3://athena-bucket/athena-results/qe1.csv"
                },
            }
        }

    def get_query_results(self, **kwargs):
        self._events.append("get_query_results")
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


class FakeS3:
    def __init__(self, events=None, fail_delete=False):
        self.delete_object_calls = []
        self._events = events if events is not None else []
        self._fail_delete = fail_delete

    def delete_object(self, **kwargs):
        self._events.append("delete_object")
        if self._fail_delete:
            raise RuntimeError("AccessDenied")
        self.delete_object_calls.append(kwargs)


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
    fake_s3 = FakeS3()
    monkeypatch.setattr(athena, "_athena", lambda: fake)
    monkeypatch.setattr(athena, "_s3", lambda: fake_s3)
    monkeypatch.setattr(athena.time, "sleep", lambda seconds: None)

    rows, truncated = athena.run_query(
        "SELECT coin_id, AVG(price_usd) AS avg_price FROM crypto_prices"
    )

    assert rows == [{"coin_id": "bitcoin", "avg_price": "88420.5"}]
    assert truncated is False
    assert fake.start_query_execution_calls[0]["QueryString"].startswith("SELECT")


def test_run_query_deletes_the_csv_metadata_file_left_by_athena(monkeypatch):
    fake = FakeAthena(execution_states=["SUCCEEDED"], results=_athena_results(["n"], [["1"]]))
    fake_s3 = FakeS3()
    monkeypatch.setattr(athena, "_athena", lambda: fake)
    monkeypatch.setattr(athena, "_s3", lambda: fake_s3)
    monkeypatch.setattr(athena.time, "sleep", lambda seconds: None)

    athena.run_query("SELECT n FROM t")

    assert fake_s3.delete_object_calls == [
        {"Bucket": "athena-bucket", "Key": "athena-results/qe1.csv.metadata"}
    ]


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
    monkeypatch.setattr(athena, "_s3", lambda: FakeS3())
    monkeypatch.setattr(athena.time, "sleep", lambda seconds: None)

    rows, truncated = athena.run_query("SELECT n FROM t", max_rows=2)

    assert rows == [{"n": "1"}, {"n": "2"}]
    assert truncated is True


def test_run_query_fetches_results_before_deleting_the_metadata_file(monkeypatch):
    # GetQueryResults reads the .metadata file (column info) -- deleting it
    # first makes Athena answer "Could not find results".
    events = []
    fake = FakeAthena(
        execution_states=["SUCCEEDED"], results=_athena_results(["n"], [["1"]]), events=events
    )
    monkeypatch.setattr(athena, "_athena", lambda: fake)
    monkeypatch.setattr(athena, "_s3", lambda: FakeS3(events=events))
    monkeypatch.setattr(athena.time, "sleep", lambda seconds: None)

    athena.run_query("SELECT n FROM t")

    assert events == ["get_query_results", "delete_object"]


def test_run_query_still_returns_rows_when_metadata_cleanup_fails(monkeypatch):
    fake = FakeAthena(execution_states=["SUCCEEDED"], results=_athena_results(["n"], [["1"]]))
    monkeypatch.setattr(athena, "_athena", lambda: fake)
    monkeypatch.setattr(athena, "_s3", lambda: FakeS3(fail_delete=True))
    monkeypatch.setattr(athena.time, "sleep", lambda seconds: None)

    rows, _truncated = athena.run_query("SELECT n FROM t")

    assert rows == [{"n": "1"}]
