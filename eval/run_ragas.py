"""Offline RAGAS evaluation of the rag_agent tool-calling loop.

Dev-only: runs locally with your AWS credentials and is never deployed (ragas
is too heavy for Lambda). See eval/README.md for how to run it.
"""

import json
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", category=DeprecationWarning, module="ragas")
# Make the repo root importable (common/, rag/) when run as `python eval/run_ragas.py`.
sys.path.insert(0, str(Path(__file__).parent.parent))

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
from rag.agent import run_agent  # noqa: E402


def load_questions() -> list[dict]:
    """Load the fixed question set from eval/questions.json."""
    return json.loads((Path(__file__).parent / "questions.json").read_text())


def run_rag_agent(question: str) -> dict:
    """Answer one question with the deployed agent loop (rag.agent.run_agent)."""
    result = run_agent(question)
    contexts = [s["text"] for s in result["sources"] if s.get("text")]
    grounded = bool(result["sources"])

    return {
        "answer": result["answer"],
        "contexts": contexts or ["(no relevant context -- answered ungrounded)"],
        "grounded": grounded,
    }


def build_dataset(questions: list[dict]) -> tuple[EvaluationDataset, list[bool]]:
    """Run every question and return the RAGAS dataset plus per-question grounded flags.

    The flags are returned separately; main() adds them as a results column.
    """
    rows = []
    grounded_flags = []
    for q in questions:
        result = run_rag_agent(q["question"])
        rows.append(
            {
                "user_input": q["question"],
                "response": result["answer"],
                "retrieved_contexts": result["contexts"],
            }
        )
        grounded_flags.append(result["grounded"])
        print(f"  [{'grounded' if result['grounded'] else 'UNGROUNDED'}] {q['question']}")
    return EvaluationDataset.from_list(rows), grounded_flags


def main():
    """Run the agent over every question, score with RAGAS, write eval/results.csv."""
    questions = load_questions()
    print(f"Running {len(questions)} questions through rag_agent (tool-calling loop)...")
    dataset, grounded_flags = build_dataset(questions)

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
    df["grounded"] = grounded_flags
    out_path = Path(__file__).parent / "results.csv"
    df.to_csv(out_path, index=False)

    print(f"\n{result}\n")
    print(f"Per-question results written to {out_path}")


if __name__ == "__main__":
    main()
