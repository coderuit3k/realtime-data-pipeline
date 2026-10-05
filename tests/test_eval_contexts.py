import json
import sys
from pathlib import Path

# eval/ is a script directory, not a package; its helpers avoid importing ragas so CI can run them.
sys.path.insert(0, str(Path(__file__).parent.parent / "eval"))

import eval_contexts as ec  # noqa: E402


def _call(tool, summary, tool_input=None, result_count=0):
    return {
        "tool": tool,
        "input": tool_input if tool_input is not None else {},
        "summary": summary,
        "result_count": result_count,
    }


def _fake_run_tool(results):
    """A stand-in for rag.agent.run_tool returning canned (summary, raw) by tool name."""

    def run_tool(name, tool_input):
        return results[name]

    return run_tool


def test_recorder_returns_the_tool_result_unchanged_and_records_the_call():
    recorder = ec.ToolRecorder()
    result = ([{"n": 1}], [{"url": "u"}])
    wrapped = recorder.wrap(_fake_run_tool({"query_athena": result}))

    assert wrapped("query_athena", {"sql": "SELECT 1"}) == result
    assert recorder.calls == [
        {
            "tool": "query_athena",
            "input": {"sql": "SELECT 1"},
            "summary": [{"n": 1}],
            "result_count": 1,
        }
    ]


def test_contexts_include_source_text_and_the_rows_an_athena_query_returned():
    calls = [
        {
            "tool": "query_athena",
            "input": {"sql": "SELECT author, COUNT(*) FROM hn GROUP BY 1"},
            "summary": [{"author": "pg", "n": 7}],
            "result_count": 0,
        }
    ]
    sources = [{"url": "u1", "text": "passage one"}]

    contexts = ec.build_contexts(sources, calls)

    assert contexts[0] == "passage one"
    assert "query_athena" in contexts[1]
    assert "SELECT author, COUNT(*) FROM hn GROUP BY 1" in contexts[1]
    assert '"author": "pg"' in contexts[1]


def test_contexts_include_crypto_and_weather_summaries_but_not_search_summaries():
    calls = [
        _call("get_crypto_prices", [{"coin_id": "bitcoin"}], result_count=1),
        _call("get_weather", [{"location": "Da Lat"}], result_count=1),
        _call("search_web", [{"snippet": "dup"}], {"query": "q"}, result_count=1),
    ]

    joined = " ".join(ec.build_contexts([], calls))

    assert "bitcoin" in joined and "Da Lat" in joined
    # Search results are already represented by the sources' own text.
    assert "dup" not in joined


def test_an_errored_tool_call_adds_no_evidence():
    calls = [
        _call("query_athena", [{"error": "boom"}], {"sql": "x"}),
        _call("query_athena", [], {"sql": "y"}),
    ]

    assert ec.build_contexts([], calls) == [ec.NO_CONTEXT]


def test_contexts_skip_sources_without_text_and_dedupe():
    sources = [
        {"url": "a", "text": "same"},
        {"url": "b", "text": "same"},
        {"url": "c", "text": ""},
    ]

    assert ec.build_contexts(sources, []) == ["same"]


def test_a_very_large_athena_result_is_capped():
    big = [{"v": "x" * 500} for _ in range(50)]
    calls = [_call("query_athena", big, {"sql": "s"})]

    (context,) = ec.build_contexts([], calls)

    assert len(context) <= ec.MAX_STRUCTURED_CONTEXT_CHARS


def test_tool_calls_column_is_json_without_the_bulky_summaries_and_flags_errors():
    calls = [
        _call("search_knowledge_base", [{"a": 1}], {"query": "q"}, result_count=3),
        _call("query_athena", [{"error": "boom"}], {"sql": "s"}),
    ]

    column = json.loads(ec.tool_calls_column(calls))

    kb, athena = column
    assert kb == {
        "tool": "search_knowledge_base",
        "input": {"query": "q"},
        "result_count": 3,
        "error": False,
    }
    assert athena == {
        "tool": "query_athena",
        "input": {"sql": "s"},
        "result_count": 0,
        "error": True,
    }


def test_tool_calls_column_for_an_answer_with_no_tool_calls_is_an_empty_list():
    assert ec.tool_calls_column([]) == "[]"


def test_missing_settings_names_every_empty_one():
    settings = {"ATHENA_WORKGROUP": "wg", "ATHENA_DATABASE": "", "CURATED_BUCKET": ""}

    assert ec.missing_settings(settings) == ["ATHENA_DATABASE", "CURATED_BUCKET"]


def test_missing_settings_is_empty_when_everything_is_set():
    assert ec.missing_settings({"ATHENA_WORKGROUP": "wg", "CURATED_BUCKET": "b"}) == []
