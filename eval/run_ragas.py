"""Offline RAGAS evaluation of the rag_agent tool-calling loop.

Dev-only: runs locally with your AWS credentials and is never deployed (ragas
is too heavy for Lambda). See eval/README.md for how to run it.
"""

import json
import sys
import warnings
from pathlib import Path
from unittest import mock

warnings.filterwarnings("ignore", category=DeprecationWarning, module="ragas")
# Make the repo root importable (common/, rag/) when run as `python eval/run_ragas.py`.
sys.path.insert(0, str(Path(__file__).parent.parent))

from eval_contexts import (  # noqa: E402
    REQUIRED_SETTINGS,
    ToolRecorder,
    build_contexts,
    missing_settings,
    tool_calls_column,
)
from langchain_aws import BedrockEmbeddings, ChatBedrockConverse  # noqa: E402
from ragas import EvaluationDataset, evaluate  # noqa: E402
from ragas.embeddings import LangchainEmbeddingsWrapper  # noqa: E402
from ragas.llms import LangchainLLMWrapper  # noqa: E402
from ragas.metrics import (  # noqa: E402
    Faithfulness,
    LLMContextPrecisionWithoutReference,
    ResponseRelevancy,
)
from ragas.run_config import RunConfig  # noqa: E402

from common import config  # noqa: E402
from rag import agent  # noqa: E402


def load_questions() -> list[dict]:
    """Load the fixed question set from eval/questions.json."""
    return json.loads((Path(__file__).parent / "questions.json").read_text())


def run_rag_agent(question: str) -> dict:
    """Answer one question with the deployed agent loop (rag.agent.run_agent).

    Every tool call is recorded so the contexts can include what query_athena, get_crypto_prices
    and get_weather returned (they have no source text) and results.csv can list the tools used.
    """
    recorder = ToolRecorder()
    with mock.patch.object(agent, "run_tool", recorder.wrap(agent.run_tool)):
        result = agent.run_agent(question)

    return {
        "answer": result["answer"],
        "contexts": build_contexts(result["sources"], recorder.calls),
        # Same definition as the Lambda: grounded means at least one cited source.
        "grounded": bool(result["sources"]),
        "tool_calls": tool_calls_column(recorder.calls),
    }


def build_dataset(questions: list[dict]) -> tuple[EvaluationDataset, list[dict]]:
    """Run every question and return the RAGAS dataset plus per-question extra columns.

    The extras (grounded flag, tool_calls) are not RAGAS fields; main() adds them to the results.
    """
    rows = []
    extras = []
    for q in questions:
        result = run_rag_agent(q["question"])
        rows.append(
            {
                "user_input": q["question"],
                "response": result["answer"],
                "retrieved_contexts": result["contexts"],
            }
        )
        extras.append({"grounded": result["grounded"], "tool_calls": result["tool_calls"]})
        tools = ", ".join(c["tool"] for c in json.loads(result["tool_calls"])) or "no tools"
        print(f"  [{'grounded' if result['grounded'] else 'UNGROUNDED'}] {q['question']} ({tools})")
    return EvaluationDataset.from_list(rows), extras


def main():
    """Run the agent over every question, score with RAGAS, write eval/results.csv."""
    missing = missing_settings({name: getattr(config, name) for name in REQUIRED_SETTINGS})
    if missing:
        sys.exit(
            f"Set {', '.join(missing)} first (see eval/README.md); "
            "otherwise tools fail or crash the run partway through."
        )
    questions = load_questions()
    print(f"Running {len(questions)} questions through rag_agent (tool-calling loop)...")
    dataset, extras = build_dataset(questions)

    judge_llm = LangchainLLMWrapper(
        ChatBedrockConverse(model=config.BEDROCK_TEXT_MODEL_ID, region_name=config.AWS_REGION)
    )
    judge_embeddings = LangchainEmbeddingsWrapper(
        BedrockEmbeddings(model_id=config.BEDROCK_EMBED_MODEL_ID, region_name=config.AWS_REGION)
    )

    metrics = [
        Faithfulness(llm=judge_llm),
        ResponseRelevancy(llm=judge_llm, embeddings=judge_embeddings),
        LLMContextPrecisionWithoutReference(llm=judge_llm),
    ]

    print("\nScoring with RAGAS (calls Bedrock several times per question -- can take minutes)...")
    # Low concurrency on purpose: Bedrock on-demand throttles concurrent calls,
    # and ragas's default max_workers=16 caused widespread TimeoutErrors.
    run_config = RunConfig(timeout=300, max_workers=2)
    result = evaluate(dataset=dataset, metrics=metrics, run_config=run_config)

    df = result.to_pandas()
    df["grounded"] = [e["grounded"] for e in extras]
    df["tool_calls"] = [e["tool_calls"] for e in extras]
    out_path = Path(__file__).parent / "results.csv"
    df.to_csv(out_path, index=False)

    print(f"\n{result}\n")
    print(f"Per-question results written to {out_path}")


if __name__ == "__main__":
    main()
