"""Offline RAGAS evaluation of the rag_query pipeline (including its CRAG
correction step). Dev-only: run locally with `aws configure` credentials,
never deployed to Lambda -- see eval/README.md for why (dependency weight)
and how to run this.
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
from rag.query import (  # noqa: E402
    classify_matches,
    embed_text,
    generate_answer,
    generate_ungrounded_answer,
    grade_matches,
    load_index,
    top_matches,
)


def load_questions() -> list[dict]:
    return json.loads((Path(__file__).parent / "questions.json").read_text())


def run_rag_query(question: str) -> dict:
    """Runs the exact same retrieve -> CRAG grade -> generate pipeline as the
    deployed rag_query Lambda, so the eval measures real behavior."""
    documents = load_index()
    question_embedding = embed_text(question)
    matches = top_matches(question_embedding, documents, config.RAG_TOP_K)

    try:
        grades = grade_matches(question, matches)
    except Exception:
        grades = ["relevant"] * len(matches)

    used, _discarded = classify_matches(matches, grades)
    grounded = bool(used)
    answer = generate_answer(question, used) if grounded else generate_ungrounded_answer(question)

    return {
        "answer": answer,
        "contexts": [m["text"] for m in used] or ["(no relevant context -- answered ungrounded)"],
        "grounded": grounded,
    }


def build_dataset(questions: list[dict]) -> tuple[EvaluationDataset, list[bool]]:
    rows = []
    grounded_flags = []
    for q in questions:
        result = run_rag_query(q["question"])
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
    print(f"Running {len(questions)} questions through rag_query (retrieve -> CRAG -> generate)...")
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
