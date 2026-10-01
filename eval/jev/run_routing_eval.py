"""Router experiment harness (part A): runs the real `rag.agent.run_agent` on
eval/jev/routing_questions.json and records, per run, which tools were called,
wall time, Bedrock calls/tokens and tool timings. Bypasses the DynamoDB answer
cache (calls run_agent directly). Dev-only: needs AWS credentials and the same
environment variables as the rag_agent Lambda (CURATED_BUCKET, ATHENA_WORKGROUP,
ATHENA_DATABASE, AWS_REGION; optionally BEDROCK_TEXT_MODEL_ID, TAVILY_SECRET_NAME).

    python eval/jev/run_routing_eval.py --label baseline --passes 2 [--index-file index.json]
    python eval/jev/run_routing_eval.py --summarize eval/jev/results_baseline.json
"""

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from rag import agent  # noqa: E402

HERE = Path(__file__).parent
# Anthropic list price for Claude Haiku 4.5 (USD per million tokens); Bedrock bills separately.
HAIKU_INPUT_USD_PER_MTOK = 1.0
HAIKU_OUTPUT_USD_PER_MTOK = 5.0


class RecordingBedrock:
    def __init__(self, client, calls):
        self._client = client
        self._calls = calls

    def converse(self, **kwargs):
        start = time.perf_counter()
        response = self._client.converse(**kwargs)
        usage = response.get("usage") or {}
        self._calls.append(
            {
                "seconds": time.perf_counter() - start,
                "input_tokens": usage.get("inputTokens", 0),
                "output_tokens": usage.get("outputTokens", 0),
                "stop_reason": response.get("stopReason"),
            }
        )
        return response

    def __getattr__(self, name):
        return getattr(self._client, name)


def _trim_sources(sources):
    # Drop the embedding vectors (~22 KB each) and keep the first 300 characters of each
    # passage -- the part of it the agent actually shows the model.
    keep = ("title", "url", "source", "score")
    return [
        {**{k: src[k] for k in keep if k in src}, "text": (src.get("text") or "")[:300]}
        for src in sources or []
    ]


def run_one(question: str, documents: list[dict], real_bedrock, real_run_tool) -> dict:
    bedrock_calls: list[dict] = []
    tool_runs: list[dict] = []

    def timed_run_tool(name, tool_input, docs):
        start = time.perf_counter()
        summary, raw = real_run_tool(name, tool_input, docs)
        failed = any(isinstance(item, dict) and "error" in item for item in summary)
        tool_runs.append({"tool": name, "seconds": time.perf_counter() - start, "failed": failed})
        return summary, raw

    agent._bedrock = lambda: RecordingBedrock(real_bedrock(), bedrock_calls)
    agent.run_tool = timed_run_tool

    start = time.perf_counter()
    error = None
    result = {}
    try:
        result = agent.run_agent(question, documents)
    except Exception as exc:  # recorded as a failed run, not swallowed
        error = f"{type(exc).__name__}: {exc}"
    wall = time.perf_counter() - start

    return {
        "wall_seconds": wall,
        "error": error,
        "tools": [t["tool"] for t in tool_runs],
        "tool_runs": tool_runs,
        "bedrock_calls": bedrock_calls,
        "truncated": result.get("truncated"),
        "answer": result.get("answer"),
        "sources": _trim_sources(result.get("sources")),
    }


def _load_documents(index_file: Path | None) -> list[dict]:
    # A local copy of the RAG index avoids re-downloading ~26 MB from S3 on slow networks.
    if index_file:
        return json.loads(index_file.read_text())["documents"]
    return agent.load_index()


def _status(record: dict) -> str:
    if record["error"]:
        return "ERROR " + record["error"]
    return ",".join(record["tools"]) or "(no tool)"


def _run_question(q: dict, pass_no: int, documents: list[dict], real: tuple) -> dict:
    record = run_one(q["question"], documents, *real)
    record.update(id=q["id"], group=q["group"], pass_no=pass_no, expected_tools=q["expected_tools"])
    return record


def _load_questions() -> tuple[dict, str]:
    spec = json.loads((HERE / "routing_questions.json").read_text())
    return {q["id"]: q for q in spec["questions"]}, spec["as_of"]


def rerun_errors(results_path: Path, index_file: Path | None) -> Path:
    """Re-runs the runs that errored (e.g. a harness bug) and replaces them in place."""
    data = json.loads(results_path.read_text())
    questions, _ = _load_questions()
    real = (agent._bedrock, agent.run_tool)
    documents = _load_documents(index_file)
    for i, old in enumerate(data["runs"]):
        if not old["error"]:
            continue
        record = _run_question(questions[old["id"]], old["pass_no"], documents, real)
        data["runs"][i] = record
        results_path.write_text(json.dumps(data, ensure_ascii=False, indent=1))
        print(f"[rerun {old['id']} pass {old['pass_no']}] {record['wall_seconds']:6.1f}s "
              f"{_status(record)}", flush=True)
    return results_path


def run_all(label: str, passes: int, only: str | None, index_file: Path | None) -> Path:
    questions, as_of = _load_questions()
    selected = [q for q in questions.values() if not only or q["id"] == only]
    out_path = HERE / f"results_{label}.json"
    real = (agent._bedrock, agent.run_tool)
    documents = _load_documents(index_file)
    runs: list[dict] = []
    for pass_no in range(1, passes + 1):
        for q in selected:
            record = _run_question(q, pass_no, documents, real)
            runs.append(record)
            payload = {"label": label, "as_of": as_of, "runs": runs}
            out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1))
            print(f"[pass {pass_no}] {q['id']} {record['wall_seconds']:6.1f}s  "
                  f"{_status(record)}", flush=True)
    return out_path


def percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))]


def summarize(path: Path) -> dict:
    data = json.loads(path.read_text())
    runs = data["runs"]
    ok = [r for r in runs if not r["error"]]
    walls = [r["wall_seconds"] for r in ok]
    covered = exact = 0
    extra_calls = repeats = 0
    for r in ok:
        expected, chosen = set(r["expected_tools"]), set(r["tools"])
        covered += expected <= chosen
        exact += expected == chosen
        extra_calls += len(chosen - expected)
        repeats += len(r["tools"]) - len(chosen)
    calls = [len(r["tools"]) for r in ok]
    in_tok = [sum(c["input_tokens"] for c in r["bedrock_calls"]) for r in ok]
    out_tok = [sum(c["output_tokens"] for c in r["bedrock_calls"]) for r in ok]
    cost = (sum(in_tok) * HAIKU_INPUT_USD_PER_MTOK + sum(out_tok) * HAIKU_OUTPUT_USD_PER_MTOK) / 1e6
    return {
        "label": data["label"],
        "runs": len(runs),
        "failed_runs": len(runs) - len(ok),
        "A1_covers_expected_pct": 100 * covered / len(ok),
        "A1_exact_match_pct": 100 * exact / len(ok),
        "A1_wrong_tool_calls_per_run": extra_calls / len(ok),
        "A2_wall_p50_s": statistics.median(walls),
        "A2_wall_p95_s": percentile(walls, 0.95),
        "A2_wall_max_s": max(walls),
        "A3_tool_calls_mean": statistics.mean(calls),
        "A3_tool_calls_p95": percentile(calls, 0.95),
        "A3_repeat_calls_per_run": repeats / len(ok),
        "A3_bedrock_calls_mean": statistics.mean(len(r["bedrock_calls"]) for r in ok),
        "A4_input_tokens_mean": statistics.mean(in_tok),
        "A4_output_tokens_mean": statistics.mean(out_tok),
        "A4_usd_per_100_questions": 100 * cost / len(ok),
        "tool_failures": sum(t["failed"] for r in ok for t in r["tool_runs"]),
        "truncated_answers": sum(bool(r["truncated"]) for r in ok),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default="baseline")
    parser.add_argument("--passes", type=int, default=1)
    parser.add_argument("--only", help="run a single question id, e.g. q07")
    parser.add_argument("--index-file", type=Path, help="local copy of rag-index/index.json")
    parser.add_argument("--rerun-errors", type=Path, help="re-run errored runs of a results file")
    parser.add_argument("--summarize", type=Path, help="print the summary of a results file")
    args = parser.parse_args()
    if args.summarize:
        print(json.dumps(summarize(args.summarize), indent=2))
    elif args.rerun_errors:
        print(json.dumps(summarize(rerun_errors(args.rerun_errors, args.index_file)), indent=2))
    else:
        path = run_all(args.label, args.passes, args.only, args.index_file)
        print(json.dumps(summarize(path), indent=2))
