"""Context and trace helpers for eval/run_ragas.py.

Kept free of ragas/langchain imports so they run in CI's plain pytest (see
tests/test_eval_contexts.py). Nothing here is deployed.
"""

import json

# Tools whose results are rows, not passages: they carry no source text of their own, so what the
# model was shown is the only evidence the judge can check the answer against.
STRUCTURED_TOOLS = ("query_athena", "get_crypto_prices", "get_weather")
NO_CONTEXT = "(no relevant context -- answered ungrounded)"
# Bounds the judge's input: Athena can return 25 wide rows.
MAX_STRUCTURED_CONTEXT_CHARS = 6000


# Settings the agent's tools read from the environment. Without them a tool fails (Athena) or
# crashes the run (S3 snapshots) partway through ten minutes of scoring.
REQUIRED_SETTINGS = ("ATHENA_WORKGROUP", "ATHENA_DATABASE", "CURATED_BUCKET")


def missing_settings(settings: dict) -> list[str]:
    """Names of the settings that are empty, so the run can stop before spending anything."""
    return [name for name, value in settings.items() if not value]


def _is_error(summary: list) -> bool:
    return len(summary) == 1 and isinstance(summary[0], dict) and "error" in summary[0]


class ToolRecorder:
    """Records every tool call the agent makes, with the summary the model saw.

    rag.agent.run_agent calls run_tool through its module namespace, so wrapping that one
    function captures the calls without changing the (deployed) agent code.
    """

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def wrap(self, run_tool):
        def recording(name, tool_input):
            summary, raw = run_tool(name, tool_input)
            self.calls.append(
                {
                    "tool": name,
                    "input": tool_input,
                    "summary": summary,
                    "result_count": len(raw),
                }
            )
            return summary, raw

        return recording


def _structured_context(call: dict) -> str | None:
    """The rows a structured tool returned, as one judge-readable string; None if no evidence."""
    summary = call["summary"]
    if call["tool"] not in STRUCTURED_TOOLS or not summary or _is_error(summary):
        return None
    sql = call["input"].get("sql") if isinstance(call["input"], dict) else None
    head = f"{call['tool']} ({sql})" if sql else call["tool"]
    return f"{head} returned: {json.dumps(summary, default=str)}"[:MAX_STRUCTURED_CONTEXT_CHARS]


def build_contexts(sources: list[dict], calls: list[dict]) -> list[str]:
    """Retrieved contexts for RAGAS: the passages cited, then the rows structured tools returned."""
    contexts: list[str] = []
    for text in [s.get("text") for s in sources] + [_structured_context(c) for c in calls]:
        if text and text not in contexts:
            contexts.append(text)
    return contexts or [NO_CONTEXT]


def tool_calls_column(calls: list[dict]) -> str:
    """The `tool_calls` results.csv cell: tools run, their input, and whether each failed."""
    return json.dumps(
        [
            {
                "tool": c["tool"],
                "input": c["input"],
                "result_count": c["result_count"],
                "error": _is_error(c["summary"]),
            }
            for c in calls
        ],
        ensure_ascii=False,
    )
