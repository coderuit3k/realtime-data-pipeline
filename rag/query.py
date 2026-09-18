import json
import logging
import re

import boto3
import numpy as np
import requests

from common import config
from common.secrets import get_secret

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3_client = None
_bedrock_client = None


def _s3():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=config.AWS_REGION)
    return _s3_client


def _bedrock():
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = boto3.client("bedrock-runtime", region_name=config.AWS_REGION)
    return _bedrock_client


def embed_text(text: str) -> list[float]:
    response = _bedrock().invoke_model(
        modelId=config.BEDROCK_EMBED_MODEL_ID,
        body=json.dumps({"inputText": text[:8000]}),
    )
    return json.loads(response["body"].read())["embedding"]


def load_index() -> list[dict]:
    response = _s3().get_object(Bucket=config.CURATED_BUCKET, Key=config.RAG_INDEX_KEY)
    return json.loads(response["Body"].read())["documents"]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    a_arr, b_arr = np.array(a, dtype=float), np.array(b, dtype=float)
    denom = np.linalg.norm(a_arr) * np.linalg.norm(b_arr)
    return float(np.dot(a_arr, b_arr) / denom) if denom else 0.0


def top_matches(question_embedding: list[float], documents: list[dict], top_k: int) -> list[dict]:
    scored = [
        {**doc, "score": cosine_similarity(question_embedding, doc["embedding"])}
        for doc in documents
    ]
    scored.sort(key=lambda d: d["score"], reverse=True)
    return scored[:top_k]


def build_prompt(question: str, matches: list[dict]) -> str:
    context = "\n\n".join(
        f"[{i + 1}] ({match['source']}) {match['title']}\n"
        f"{match['text'][:500]}\nURL: {match['url']}"
        for i, match in enumerate(matches)
    )
    return (
        "Answer the question using ONLY the context below. Cite sources by their "
        "[number]. If the context doesn't contain the answer, say so.\n\n"
        f"Context:\n{context}\n\nQuestion: {question}"
    )


def generate_answer(question: str, matches: list[dict]) -> str:
    prompt = build_prompt(question, matches)
    response = _bedrock().invoke_model(
        modelId=config.BEDROCK_TEXT_MODEL_ID,
        body=json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 500,
                "messages": [{"role": "user", "content": prompt}],
            }
        ),
    )
    body = json.loads(response["body"].read())
    return body["content"][0]["text"]


def generate_ungrounded_answer(question: str) -> str:
    """Last-resort branch: neither the local knowledge base nor web search had
    anything relevant, so answer from the model's own knowledge instead of
    forcing citations to bad context -- and say so, rather than silently
    hallucinating grounded-looking sources."""
    prompt = (
        "No relevant documents were found for this question, in the local "
        f"knowledge base or on the web: {question}\n\n"
        "Answer briefly from your own general knowledge, and explicitly say this "
        "answer is not grounded in any retrieved source."
    )
    response = _bedrock().invoke_model(
        modelId=config.BEDROCK_TEXT_MODEL_ID,
        body=json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 300,
                "messages": [{"role": "user", "content": prompt}],
            }
        ),
    )
    body = json.loads(response["body"].read())
    return body["content"][0]["text"]


def web_search(query: str, max_results: int = 5) -> list[dict]:
    """CRAG's "incorrect" branch, done properly: when nothing in the local
    knowledge base is relevant, search the web instead of only falling back
    to the model's own (possibly stale) parametric knowledge."""
    api_key = get_secret(config.TAVILY_SECRET_NAME)["api_key"]
    response = requests.post(
        "https://api.tavily.com/search",
        json={"api_key": api_key, "query": query, "max_results": max_results},
        timeout=10,
    )
    response.raise_for_status()
    return [
        {
            "title": r.get("title") or "",
            "url": r.get("url") or "",
            "text": r.get("content") or "",
            "source": "web",
        }
        for r in response.json().get("results", [])
    ]


GRADES = ("relevant", "ambiguous", "irrelevant")


def build_grading_prompt(question: str, matches: list[dict]) -> str:
    items = "\n".join(
        f"[{i + 1}] {match['title']}\n{match['text'][:300]}" for i, match in enumerate(matches)
    )
    return (
        "Grade how relevant each numbered context is to answering the question. "
        'Respond with ONLY a JSON array of grades, one per context, in the same '
        'order. Each grade must be exactly one of: "relevant", "ambiguous", '
        '"irrelevant".\n\n'
        f"Question: {question}\n\nContexts:\n{items}"
    )


def parse_grades(raw: str, expected_count: int) -> list[str]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\n|\n```$", "", cleaned)
    grades = json.loads(cleaned)
    if not isinstance(grades, list) or len(grades) != expected_count:
        raise ValueError(f"Expected {expected_count} grades, got: {grades!r}")
    normalized = [str(g).strip().lower() for g in grades]
    if not all(g in GRADES for g in normalized):
        raise ValueError(f"Invalid grade(s): {normalized!r}")
    return normalized


def grade_matches(question: str, matches: list[dict]) -> list[str]:
    if not matches:
        return []
    response = _bedrock().invoke_model(
        modelId=config.BEDROCK_TEXT_MODEL_ID,
        body=json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 200,
                "messages": [{"role": "user", "content": build_grading_prompt(question, matches)}],
            }
        ),
    )
    body = json.loads(response["body"].read())
    return parse_grades(body["content"][0]["text"], len(matches))


def classify_matches(matches: list[dict], grades: list[str]) -> tuple[list[dict], list[dict]]:
    """CRAG's corrective filter: "relevant"/"ambiguous" contexts get used for
    generation, "irrelevant" ones are dropped instead of feeding bad context
    to the generator."""
    used, discarded = [], []
    for match, grade in zip(matches, grades):
        graded = {**match, "grade": grade}
        (used if grade in ("relevant", "ambiguous") else discarded).append(graded)
    return used, discarded


def choose_answer_source(used: list[dict], web_results: list[dict]) -> str:
    if used:
        return "local_knowledge_base"
    if web_results:
        return "web_search"
    return "model_knowledge"


def lambda_handler(event, context):
    question = (event.get("question") or "").strip()
    if not question:
        return {"statusCode": 400, "error": "Missing 'question' in event"}

    documents = load_index()
    question_embedding = embed_text(question)
    matches = top_matches(question_embedding, documents, config.RAG_TOP_K)

    try:
        grades = grade_matches(question, matches)
    except Exception:
        logger.exception("CRAG grading failed, treating all matches as relevant")
        grades = ["relevant"] * len(matches)

    used, discarded = classify_matches(matches, grades)

    web_results = []
    if not used:
        try:
            web_results = web_search(question)
        except Exception:
            logger.exception("Web search failed, falling back to the model's own knowledge")

    answer_source = choose_answer_source(used, web_results)
    if answer_source == "local_knowledge_base":
        answer = generate_answer(question, used)
        sources = used
    elif answer_source == "web_search":
        answer = generate_answer(question, web_results)
        sources = web_results
    else:
        answer = generate_ungrounded_answer(question)
        sources = []

    return {
        "statusCode": 200,
        "question": question,
        "answer": answer,
        "grounded": answer_source == "local_knowledge_base",
        "answer_source": answer_source,
        "sources": [
            {
                "title": s["title"],
                "url": s["url"],
                "source": s["source"],
                "score": round(s["score"], 4) if "score" in s else None,
                "grade": s.get("grade", "n/a"),
            }
            for s in sources
        ],
        "discarded_low_relevance": [{"title": m["title"], "grade": m["grade"]} for m in discarded],
    }


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)
    q = sys.argv[1] if len(sys.argv) > 1 else "What is trending in tech today?"
    print(json.dumps(lambda_handler({"question": q}, None), indent=2))
