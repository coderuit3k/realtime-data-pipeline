import json
import logging
import math
from datetime import datetime, timedelta, timezone
from io import BytesIO

import boto3
import numpy as np
import pandas as pd
import requests

from common import config
from common.secrets import get_secret

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3_client = None
_bedrock_client = None

MAX_ITERATIONS = 6

TOOLS = [
    {
        "toolSpec": {
            "name": "search_knowledge_base",
            "description": (
                "Search this pipeline's own curated knowledge base -- Hacker News "
                "stories and news articles it has ingested. Best for questions "
                "about tech, AI, startups, or recent news topics the pipeline "
                "actually covers. Returns titles, URLs, snippets, and a "
                "similarity score per result."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {"query": {"type": "string", "description": "Search query"}},
                    "required": ["query"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "get_crypto_prices",
            "description": (
                "Get this pipeline's own real, live-ingested crypto prices "
                "from CoinGecko, refreshed every ~10 minutes -- covers "
                "exactly three coins: Bitcoin, Ethereum, Solana. Prefer this "
                "over search_web for the current price, market cap, or 24h "
                "change of these three specifically -- it's this pipeline's "
                "own current data, more reliable than a general web search "
                "for them. For any other coin, use search_web instead. "
                "Takes no arguments."
            ),
            "inputSchema": {"json": {"type": "object", "properties": {}, "required": []}},
        }
    },
    {
        "toolSpec": {
            "name": "get_weather",
            "description": (
                "Get this pipeline's own real, live-ingested weather readings "
                "(temperature, humidity, precipitation, wind) from Open-Meteo, "
                "refreshed every ~10 minutes -- covers exactly these 12 "
                "Southern Vietnam locations: Tay Ninh, Ho Chi Minh City, Thu "
                "Dau Mot (Binh Duong), Long Xuyen (An Giang), Bien Hoa (Dong "
                "Nai), Can Tho, My Tho (Tien Giang), Soc Trang, Vung Tau, "
                "Rach Gia (Kien Giang), Ca Mau, Da Lat. Prefer this over "
                "search_web for current weather in one of these specific "
                "locations. For any other location (e.g. Hanoi, Da Nang, or "
                "anywhere outside Vietnam), use search_web instead. Takes no "
                "arguments."
            ),
            "inputSchema": {"json": {"type": "object", "properties": {}, "required": []}},
        }
    },
    {
        "toolSpec": {
            "name": "search_web",
            "description": (
                "Search the public web. Use this when the knowledge base has "
                "nothing relevant, the question is about a coin other than "
                "Bitcoin/Ethereum/Solana or a location other than the 12 "
                "get_weather covers, or the question is otherwise outside "
                "this pipeline's domain."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {"query": {"type": "string", "description": "Search query"}},
                    "required": ["query"],
                }
            },
        }
    },
]

SYSTEM_PROMPT = (
    "You are a research agent that answers questions using tools, not "
    "unverified memory. For every question:\n"
    "1. Decide which tool(s) to call, and with what input. Reformulate and "
    "search again if the first results are weak, or the question has "
    "multiple parts that need separate searches.\n"
    "2. Only stop calling tools once you have enough grounded information, "
    "or you've tried the relevant tools and found nothing useful.\n"
    "3. Call at most one tool per turn, then look at its results before "
    "deciding the next step.\n"
    "4. When you give your final answer (no more tool calls), cite sources "
    "by URL for every factual claim taken from a tool result. If no tool "
    "result was relevant, say so explicitly and answer from general "
    "knowledge, clearly flagged as ungrounded."
)


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


def list_parquet_keys(bucket: str, prefix: str) -> list[str]:
    keys = []
    paginator = _s3().get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            if obj["Key"].endswith(".parquet"):
                keys.append(obj["Key"])
    return keys


def _sanitize_nan(records: list[dict]) -> list[dict]:
    """Pandas turns a missing value in a numeric column into NaN, which
    isn't valid JSON -- json.dumps(float('nan')) emits the literal `NaN`
    token, and Bedrock's Converse API rejects that in a tool-result
    payload. Convert every NaN to None so one missing reading (e.g. a
    single location's precipitation sensor down that run) can't crash the
    whole tool call."""
    return [
        {k: (None if isinstance(v, float) and math.isnan(v) else v) for k, v in record.items()}
        for record in records
    ]


def read_parquet_records(bucket: str, key: str) -> list[dict]:
    response = _s3().get_object(Bucket=bucket, Key=key)
    df = pd.read_parquet(BytesIO(response["Body"].read()))
    return _sanitize_nan(df.to_dict(orient="records"))


def read_latest_curated_snapshot(source: str, now: datetime | None = None) -> list[dict]:
    """Returns the records from the single most recent curated Parquet file
    for `source` (crypto/weather ingest every ~10 min and each run's file is
    a full snapshot of every tracked coin/location, so the newest file IS
    the latest reading -- no historical scan needed, unlike build_index.py's
    full-corpus RAG build). Checks today's UTC partition, falling back to
    yesterday's if today's is still empty (e.g. just after midnight, before
    the first run of the day)."""
    now = now or datetime.now(timezone.utc)
    for day_offset in (0, 1):
        ts = now - timedelta(days=day_offset)
        prefix = f"source={source}/year={ts:%Y}/month={ts:%m}/day={ts:%d}/"
        keys = list_parquet_keys(config.CURATED_BUCKET, prefix)
        if keys:
            return read_parquet_records(config.CURATED_BUCKET, max(keys))
    return []


def cosine_similarity(a: list[float], b: list[float]) -> float:
    a_arr, b_arr = np.array(a, dtype=float), np.array(b, dtype=float)
    denom = np.linalg.norm(a_arr) * np.linalg.norm(b_arr)
    return float(np.dot(a_arr, b_arr) / denom) if denom else 0.0


def search_knowledge_base(query: str, documents: list[dict], top_k: int) -> list[dict]:
    embedding = embed_text(query)
    scored = [{**doc, "score": cosine_similarity(embedding, doc["embedding"])} for doc in documents]
    scored.sort(key=lambda d: d["score"], reverse=True)
    return scored[:top_k]


def get_crypto_prices() -> list[dict]:
    return read_latest_curated_snapshot("crypto")


def get_weather() -> list[dict]:
    return read_latest_curated_snapshot("weather")


def search_web(query: str, max_results: int = 5) -> list[dict]:
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


def run_tool(name: str, tool_input: dict, documents: list[dict]) -> tuple[list[dict], list[dict]]:
    """Runs one agent-requested tool call. Returns (summary for the model,
    raw results for source tracking) -- the model only sees the summary
    (title/url/snippet/score), never the full embedding vectors."""
    query = (tool_input or {}).get("query", "")

    if name == "search_knowledge_base":
        matches = search_knowledge_base(query, documents, config.RAG_TOP_K)
        summary = [
            {
                "title": m["title"],
                "url": m["url"],
                "snippet": m["text"][:300],
                "score": round(m["score"], 4),
            }
            for m in matches
        ]
        return summary, matches

    if name == "get_crypto_prices":
        records = get_crypto_prices()
        summary = [
            {
                "coin_id": r.get("coin_id"),
                "price_usd": r.get("price_usd"),
                "change_24h_pct": r.get("change_24h_pct"),
                "market_cap_usd": r.get("market_cap_usd"),
                "observed_at": r.get("observed_at"),
            }
            for r in records
        ]
        sources = [
            {
                "title": f"CoinGecko: {r.get('coin_id')}",
                "url": f"https://www.coingecko.com/en/coins/{r.get('coin_id')}",
                "source": "crypto",
            }
            for r in records
        ]
        return summary, sources

    if name == "get_weather":
        records = get_weather()
        summary = [
            {
                "location": r.get("location"),
                "temperature_c": r.get("temperature_c"),
                "humidity_pct": r.get("humidity_pct"),
                "precipitation_mm": r.get("precipitation_mm"),
                "wind_speed_kmh": r.get("wind_speed_kmh"),
                "observed_at": r.get("observed_at"),
            }
            for r in records
        ]
        # One representative source for the whole batch, not one per
        # location -- Open-Meteo has no public per-location page to cite,
        # unlike CoinGecko's real per-coin URLs above.
        weather_source = {
            "title": "Open-Meteo (dữ liệu thời tiết đã ingest)",
            "url": "https://open-meteo.com/",
            "source": "weather",
        }
        sources = [weather_source] if records else []
        return summary, sources

    if name == "search_web":
        try:
            results = search_web(query)
        except Exception:
            logger.exception("search_web tool failed")
            return [{"error": "web search failed"}], []
        summary = [
            {"title": r["title"], "url": r["url"], "snippet": r["text"][:300]} for r in results
        ]
        return summary, results

    return [{"error": f"unknown tool: {name}"}], []


def extract_text(message: dict) -> str:
    return "".join(block["text"] for block in message["content"] if "text" in block)


def run_agent(question: str, documents: list[dict]) -> dict:
    messages = [{"role": "user", "content": [{"text": question}]}]
    trace = []
    sources_by_url: dict[str, dict] = {}

    for _ in range(MAX_ITERATIONS):
        response = _bedrock().converse(
            modelId=config.BEDROCK_TEXT_MODEL_ID,
            system=[{"text": SYSTEM_PROMPT}],
            messages=messages,
            toolConfig={"tools": TOOLS},
            inferenceConfig={"maxTokens": 800},
        )
        output_message = response["output"]["message"]
        messages.append(output_message)

        if response["stopReason"] != "tool_use":
            return {
                "answer": extract_text(output_message),
                "trace": trace,
                "sources": list(sources_by_url.values()),
            }

        tool_result_blocks = []
        for block in output_message["content"]:
            tool_use = block.get("toolUse")
            if not tool_use:
                continue
            name = tool_use["name"]
            tool_input = tool_use.get("input") or {}
            summary, raw_results = run_tool(name, tool_input, documents)
            trace.append({"tool": name, "input": tool_input, "result_count": len(raw_results)})
            for r in raw_results:
                if r.get("url"):
                    sources_by_url[r["url"]] = r
            tool_result_blocks.append(
                {
                    "toolResult": {
                        "toolUseId": tool_use["toolUseId"],
                        "content": [{"json": {"results": summary}}],
                    }
                }
            )
        messages.append({"role": "user", "content": tool_result_blocks})

    # Exhausted MAX_ITERATIONS without a final text turn (e.g. the model kept
    # calling tools) -- ask once more with tools withdrawn so it must answer
    # from whatever it already gathered, instead of erroring the invocation.
    force_answer_system = SYSTEM_PROMPT + "\n\nYou must give your final answer now, no more tools."
    response = _bedrock().converse(
        modelId=config.BEDROCK_TEXT_MODEL_ID,
        system=[{"text": force_answer_system}],
        messages=messages,
        inferenceConfig={"maxTokens": 800},
    )
    return {
        "answer": extract_text(response["output"]["message"]),
        "trace": trace,
        "sources": list(sources_by_url.values()),
    }


def lambda_handler(event, context):
    question = (event.get("question") or "").strip()
    if not question:
        return {"statusCode": 400, "error": "Missing 'question' in event"}

    documents = load_index()
    result = run_agent(question, documents)

    return {
        "statusCode": 200,
        "question": question,
        "answer": result["answer"],
        "grounded": bool(result["sources"]),
        "tool_calls": result["trace"],
        "sources": [
            {"title": s.get("title", ""), "url": s.get("url", ""), "source": s.get("source", "")}
            for s in result["sources"]
        ],
    }


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)
    q = sys.argv[1] if len(sys.argv) > 1 else "What is trending in tech today?"
    print(json.dumps(lambda_handler({"question": q}, None), indent=2))
