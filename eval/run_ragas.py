"""Offline RAGAS evaluation of the rag_agent pipeline (Bedrock Converse
tool-calling agent: search_knowledge_base + search_web). Dev-only: run
locally with `aws configure` credentials, never deployed to Lambda -- see
eval/README.md for why (dependency weight) and how to run this.
"""

import json
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", category=DeprecationWarning, module="ragas")
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
from rag.agent import load_index, run_agent  # noqa: E402


def load_questions() -> list[dict]:
    return json.loads((Path(__file__).parent / "questions.json").read_text())


def run_rag_agent(question: str, documents: list[dict]) -> dict:
    """Runs the exact same tool-calling agent loop as the deployed rag_agent
    Lambda (rag.agent.run_agent), so the eval measures real behavior.
    `documents` is the RAG index, loaded once for the whole run by main()
    -- not re-fetched from S3 per question (the ~27MB index doesn't change
    between questions in one run, and re-downloading it per question was
    slow enough to trip a real S3 read timeout during testing)."""
    result = run_agent(question, documents)
    contexts = [s["text"] for s in result["sources"] if s.get("text")]
    grounded = bool(result["sources"])

    return {
        "answer": result["answer"],
        "contexts": contexts or ["(no relevant context -- answered ungrounded)"],
        "grounded": grounded,
    }


def build_dataset(
    questions: list[dict], documents: list[dict]
) -> tuple[EvaluationDataset, list[bool]]:
    rows = []
    grounded_flags = []
    for q in questions:
        result = run_rag_agent(q["question"], documents)
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
    questions = load_questions()
    print("Loading RAG index from S3 (once for this run)...")
    documents = load_index()
    print(f"Running {len(questions)} questions through rag_agent (tool-calling loop)...")
    dataset, grounded_flags = build_dataset(questions, documents)

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
    # and ragas's default max_workers=16 caused widespread TimeoutErrors here
    # (confirmed) -- a few slow calls beat many throttled/retried ones.
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
