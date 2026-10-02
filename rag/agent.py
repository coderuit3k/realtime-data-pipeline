"""RAG agent Lambda: a Bedrock Converse tool-calling loop over the pipeline's own data.

The model picks among knowledge-base search, live crypto/weather snapshots, read-only Athena SQL
and web search; answers are cached in DynamoDB so a repeated question skips the loop.
"""

import hashlib
import json
import logging
import math
import time
from datetime import datetime, timedelta, timezone
from io import BytesIO

import boto3
import numpy as np
import pandas as pd
import requests

from common import athena, config
from common.secrets import get_secret
from common.sql_guard import validate_read_only_select

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3_client = None
_bedrock_client = None
_dynamodb_resource = None

# Tool-calling turns before the agent is forced to answer with what it has.
MAX_ITERATIONS = 6

# Vietnamese answers tokenize heavily: a cap of 800 cut ~1 in 6 answers mid-sentence.
# Output tokens are billed only as generated, so the higher cap costs nothing unless used.
MAX_ANSWER_TOKENS = 2000
TRUNCATED_NOTICE = (
    "\n\n_(Câu trả lời bị cắt do giới hạn độ dài -- hãy hỏi lại hoặc chia nhỏ câu hỏi.)_"
)

# DynamoDB answer cache: a repeated question skips the tool-calling loop entirely.
# An empty table name disables it (get/store become no-ops).
RAG_MEMORY_TABLE = config.RAG_MEMORY_TABLE
RAG_MEMORY_TTL_SECONDS = config.RAG_MEMORY_TTL_SECONDS
# Once a question has been asked this many times its entry is stored without a TTL
# (permanent) instead of expiring like a one-off question's.
RAG_MEMORY_PROMOTE_AFTER_HITS = config.RAG_MEMORY_PROMOTE_AFTER_HITS

# Tool descriptions are model-facing: they steer which tool the model picks, so the
# Athena timestamp-format warning in query_athena's description is load-bearing.
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
                "from CoinGecko, refreshed every ~30 minutes -- covers "
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
                "refreshed every ~30 minutes -- covers exactly these 12 "
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
            "name": "query_athena",
            "description": (
                "Run a read-only SQL SELECT against this pipeline's own Athena "
                "tables for aggregate/analytical questions the other tools can't "
                "answer -- averages, counts, time windows, correlations across "
                "sources. Five tables, all in the curated database: "
                "hackernews_stories(story_id, title, text, author, score, "
                "num_comments, url, created_at, ingested_at, keywords), "
                "news_articles(article_id, provider, title, description, url, "
                "published_at, ingested_at, keywords), "
                "weather_observations(location, temperature_c, humidity_pct, "
                "precipitation_mm, wind_speed_kmh, observed_at), "
                "crypto_prices(coin_id, price_usd, market_cap_usd, "
                "volume_24h_usd, change_24h_pct, observed_at), "
                "github_repos(full_name, description, language, stars, forks, "
                "created_at, pushed_at, keywords). Every table is also "
                "partitioned by year/month/day (strings, e.g. year='2026', "
                "month='03', day='30') -- filter on these to avoid scanning the "
                "whole table. Only SELECT/WITH statements are allowed; no "
                "INSERT/UPDATE/DELETE/DDL. Prefer this over search_knowledge_base "
                "for anything requiring counting, averaging, or aggregating "
                "across many records. IMPORTANT: ingested_at/created_at/"
                "published_at/observed_at/pushed_at are plain strings with "
                "MICROSECOND precision (e.g. '2026-09-27T11:31:29.142944+00:00') "
                "-- CAST(... AS DATE/TIMESTAMP), DATE(...), date_trunc(...), and "
                "format_datetime(...) all fail on this exact format with "
                "INVALID_CAST_ARGUMENT or FUNCTION_NOT_FOUND. To group/filter by "
                "calendar day, use SUBSTR(column, 1, 10) directly (no cast) to "
                "get 'YYYY-MM-DD' as a string -- that works. Don't burn several "
                "tool calls rediscovering this."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "sql": {
                            "type": "string",
                            "description": "A single read-only SQL SELECT statement",
                        }
                    },
                    "required": ["sql"],
                }
            },
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
    "multiple parts that need separate searches. For questions asking to "
    "count, average, or otherwise aggregate across many records, use "
    "query_athena instead of search_knowledge_base.\n"
    "2. Only stop calling tools once you have enough grounded information, "
    "or you've tried the relevant tools and found nothing useful.\n"
    "3. Call at most one tool per turn, then look at its results before "
    "deciding the next step.\n"
    "4. This knowledge base only contains data from whenever this "
    "pipeline's ingestion started, not all of history -- a question "
    "implying a time range ('from the beginning of the month', 'this "
    "year', 'since last week') can come back empty or suspiciously low "
    "simply because the range starts before ingestion began, not because "
    "the topic was never covered. If a time-bounded count/search comes "
    "back empty or low, run `SELECT MIN(ingested_at) FROM <table>` via "
    "query_athena before concluding the topic wasn't discussed. If the "
    "requested range starts before that minimum date: say so explicitly "
    "and politely (e.g. note that this system's own ingested data only "
    "goes back that far), then use search_web to try answering the part "
    "of the question that falls before that date from the open web -- "
    "clearly label which numbers/facts came from this pipeline's own "
    "data (an exact, grounded count) versus from a general web search "
    "(not a count of anything this pipeline ingested). Never state or "
    "imply a specific earlier date/range you have not actually verified "
    "with a tool call.\n"
    "5. When you give your final answer (no more tool calls), cite sources "
    "by URL for every factual claim taken from a tool result. If no tool "
    "result was relevant, say so explicitly and answer from general "
    "knowledge, clearly flagged as ungrounded.\n"
    "6. If every attempt at a query_athena/search call for this question "
    "failed or errored (no tool call actually returned usable rows), you "
    "have NO grounded numbers to report. Do not state specific counts, "
    "tables, or statistics in that case -- say plainly that the query kept "
    "failing (briefly note why, e.g. a SQL error) and offer to try a "
    "different approach, rather than presenting any number as if it came "
    "from this pipeline's data.\n"
    "7. Write the final answer as a finished, standalone reply for the reader. "
    "Start directly with the substance: no opening filler or reactions ('Great!', "
    "'Now I have enough data', 'Tuyệt vời!', 'Không sao, ...'), and no narration "
    "of your own process or tool use (what you searched, what failed, what you "
    "are about to do). Mention a failed or empty lookup only when it changes what "
    "the reader can rely on. Reply in the language of the question."
)


def build_system_prompt(now: datetime | None = None) -> str:
    """Prepend today's UTC date to SYSTEM_PROMPT.

    Without it the model has no ground truth for "this month" or "since yesterday" and was
    seen guessing a wrong month, which then silently picked the wrong Athena partitions.
    """
    now = now or datetime.now(timezone.utc)
    date_line = (
        f"Today's date is {now:%Y-%m-%d} (UTC). Resolve any relative time "
        'expression in the question ("this month", "last week", "since '
        'yesterday", "this year") into actual year/month/day values from '
        "this date -- never guess or assume one.\n\n"
    )
    return date_line + SYSTEM_PROMPT


def _s3():
    """Lazily create the S3 client so importing this module needs no AWS."""
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=config.AWS_REGION)
    return _s3_client


def _bedrock():
    """Lazily create the Bedrock runtime client."""
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = boto3.client("bedrock-runtime", region_name=config.AWS_REGION)
    return _bedrock_client


def _dynamodb():
    """Lazily create the DynamoDB resource used by the answer cache."""
    global _dynamodb_resource
    if _dynamodb_resource is None:
        _dynamodb_resource = boto3.resource("dynamodb", region_name=config.AWS_REGION)
    return _dynamodb_resource


def normalize_question(question: str) -> str:
    """Fold case and whitespace so trivially different phrasings share a cache entry."""
    return " ".join(question.strip().lower().split())


def question_hash(question: str) -> str:
    """Cache key: SHA-256 of the normalised question."""
    return hashlib.sha256(normalize_question(question).encode("utf-8")).hexdigest()


def get_cached_answer(question: str) -> dict | None:
    """Return the cached item (answer, sources, tool_calls, hit_count) or None on a miss."""
    if not RAG_MEMORY_TABLE:
        return None
    table = _dynamodb().Table(RAG_MEMORY_TABLE)
    response = table.get_item(Key={"question_hash": question_hash(question)})
    return response.get("Item")


def store_cached_answer(
    question: str, answer: str, sources: list[dict], tool_calls: list[dict], hit_count: int
) -> None:
    """Write the answer with a DynamoDB TTL, or without one once hit_count reaches the promote
    threshold.

    tool_calls is stored so a cache hit can still show what grounded the answer, rather than
    an empty trace that would make it look ungrounded.
    """
    if not RAG_MEMORY_TABLE:
        return
    table = _dynamodb().Table(RAG_MEMORY_TABLE)
    item = {
        "question_hash": question_hash(question),
        "question": question,
        "answer": answer,
        "sources": json.dumps(sources),
        "tool_calls": json.dumps(tool_calls),
        "hit_count": hit_count,
        "last_asked_at": datetime.now(timezone.utc).isoformat(),
    }
    if hit_count < RAG_MEMORY_PROMOTE_AFTER_HITS:
        item["ttl"] = int(time.time()) + RAG_MEMORY_TTL_SECONDS
    table.put_item(Item=item)


def embed_text(text: str) -> list[float]:
    """Embed text; must use the same model and truncation as rag/build_index.py."""
    response = _bedrock().invoke_model(
        modelId=config.BEDROCK_EMBED_MODEL_ID,
        body=json.dumps({"inputText": text[:8000]}),
    )
    return json.loads(response["body"].read())["embedding"]


def load_index() -> list[dict]:
    """Load the embedded documents written by rag/build_index.py."""
    response = _s3().get_object(Bucket=config.CURATED_BUCKET, Key=config.RAG_INDEX_KEY)
    return json.loads(response["Body"].read())["documents"]


def list_parquet_keys(bucket: str, prefix: str) -> list[str]:
    """List every .parquet key under prefix, following S3 pagination."""
    keys = []
    paginator = _s3().get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            if obj["Key"].endswith(".parquet"):
                keys.append(obj["Key"])
    return keys


def _sanitize_nan(records: list[dict]) -> list[dict]:
    """Replace NaN with None.

    Pandas reads a missing numeric value as NaN, which json.dumps emits as a bare `NaN` token
    that Converse rejects in a tool result, so one missing reading would fail the whole call.
    """
    return [
        {k: (None if isinstance(v, float) and math.isnan(v) else v) for k, v in record.items()}
        for record in records
    ]


def read_parquet_records(bucket: str, key: str) -> list[dict]:
    """Load one Parquet object from S3 as JSON-safe row dicts."""
    response = _s3().get_object(Bucket=bucket, Key=key)
    df = pd.read_parquet(BytesIO(response["Body"].read()))
    return _sanitize_nan(df.to_dict(orient="records"))


def read_latest_curated_snapshot(source: str, now: datetime | None = None) -> list[dict]:
    """Return the records of the newest curated Parquet file for source.

    Each crypto/weather run writes a full snapshot of every coin/location, so the newest file
    is the current reading. Falls back to yesterday's partition just after UTC midnight,
    before the day's first run.
    """
    now = now or datetime.now(timezone.utc)
    for day_offset in (0, 1):
        ts = now - timedelta(days=day_offset)
        prefix = f"source={source}/year={ts:%Y}/month={ts:%m}/day={ts:%d}/"
        keys = list_parquet_keys(config.CURATED_BUCKET, prefix)
        if keys:
            return read_parquet_records(config.CURATED_BUCKET, max(keys))
    return []


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Cosine similarity, defined as 0.0 for a zero vector."""
    a_arr, b_arr = np.array(a, dtype=float), np.array(b, dtype=float)
    denom = np.linalg.norm(a_arr) * np.linalg.norm(b_arr)
    return float(np.dot(a_arr, b_arr) / denom) if denom else 0.0


def search_knowledge_base(query: str, documents: list[dict], top_k: int) -> list[dict]:
    """Brute-force cosine ranking over the in-memory index; fine at this corpus size."""
    embedding = embed_text(query)
    scored = [{**doc, "score": cosine_similarity(embedding, doc["embedding"])} for doc in documents]
    scored.sort(key=lambda d: d["score"], reverse=True)
    return scored[:top_k]


def query_athena(sql: str, max_rows: int = 25) -> tuple[list[dict], bool]:
    """Run model-written SQL after the read-only guard; returns (rows, truncated).

    Raises ValueError if the guard rejects the SQL, RuntimeError if Athena fails or times out.
    """
    ok, reason = validate_read_only_select(sql)
    if not ok:
        raise ValueError(reason)
    return athena.run_query(sql, max_rows)


def get_crypto_prices() -> list[dict]:
    """Latest ingested price snapshot for the tracked coins."""
    return read_latest_curated_snapshot("crypto")


def get_weather() -> list[dict]:
    """Latest ingested weather snapshot for the tracked locations."""
    return read_latest_curated_snapshot("weather")


def search_web(query: str, max_results: int = 5) -> list[dict]:
    """Tavily web search, normalised to the same {title, url, text} shape as index documents."""
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
    """Run one tool call and return (summary for the model, records for source tracking).

    The summary is kept small (no embeddings, truncated text) to limit input tokens. Athena
    and web-search failures come back as error results so the model can retry or move on.
    """
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
        # One source for the whole batch: Open-Meteo has no per-location page to cite.
        weather_source = {
            "title": "Open-Meteo (dữ liệu thời tiết đã ingest)",
            "url": "https://open-meteo.com/",
            "source": "weather",
        }
        sources = [weather_source] if records else []
        return summary, sources

    if name == "query_athena":
        sql = (tool_input or {}).get("sql", "")
        try:
            rows, truncated = query_athena(sql)
        except Exception as e:
            logger.exception("query_athena tool failed")
            return [{"error": str(e)}], []
        summary = list(rows)
        if truncated:
            summary.append({"note": f"Results truncated to {len(rows)} rows."})
        return summary, []

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
    """Concatenate the text blocks of a Converse message, ignoring toolUse blocks."""
    return "".join(block["text"] for block in message["content"] if "text" in block)


def _final_result(response: dict, trace: list, sources_by_url: dict) -> dict:
    """Package the final answer, flagging and annotating it if it hit the token cap."""
    text = extract_text(response["output"]["message"])
    truncated = response["stopReason"] == "max_tokens"
    if truncated:
        text += TRUNCATED_NOTICE
    return {
        "answer": text,
        "trace": trace,
        "sources": list(sources_by_url.values()),
        "truncated": truncated,
    }


def run_agent(question: str, documents: list[dict]) -> dict:
    """Run the Converse tool loop until the model answers in text or MAX_ITERATIONS is hit."""
    messages = [{"role": "user", "content": [{"text": question}]}]
    trace = []
    sources_by_url: dict[str, dict] = {}
    system_prompt = build_system_prompt()

    for _ in range(MAX_ITERATIONS):
        response = _bedrock().converse(
            modelId=config.BEDROCK_TEXT_MODEL_ID,
            system=[{"text": system_prompt}],
            messages=messages,
            toolConfig={"tools": TOOLS},
            inferenceConfig={"maxTokens": MAX_ANSWER_TOKENS},
        )
        output_message = response["output"]["message"]
        messages.append(output_message)

        if response["stopReason"] != "tool_use":
            return _final_result(response, trace, sources_by_url)

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

    # Out of iterations: ask once more for an answer from what was gathered. toolConfig
    # must still be sent -- Converse raises ValidationException for a history containing
    # toolUse/toolResult blocks without it, and has no "no tools" tool choice.
    force_answer_system = system_prompt + "\n\nYou must give your final answer now, no more tools."
    response = _bedrock().converse(
        modelId=config.BEDROCK_TEXT_MODEL_ID,
        system=[{"text": force_answer_system}],
        messages=messages,
        toolConfig={"tools": TOOLS},
        inferenceConfig={"maxTokens": MAX_ANSWER_TOKENS},
    )
    return _final_result(response, trace, sources_by_url)


def lambda_handler(event, context):
    """Answer event["question"], serving from the DynamoDB cache when possible."""
    question = (event.get("question") or "").strip()
    if not question:
        return {"statusCode": 400, "error": "Missing 'question' in event"}

    cached = get_cached_answer(question)
    if cached is not None:
        sources = json.loads(cached["sources"])
        # Entries written before tool_calls was persisted lack the field.
        tool_calls = json.loads(cached.get("tool_calls") or "[]")
        # Re-store to bump hit_count, which promotes the entry to permanent once it
        # reaches RAG_MEMORY_PROMOTE_AFTER_HITS.
        hit_count = int(cached.get("hit_count", 1)) + 1
        store_cached_answer(question, cached["answer"], sources, tool_calls, hit_count)
        return {
            "statusCode": 200,
            "question": question,
            "answer": cached["answer"],
            "grounded": bool(sources),
            # The trace from when the answer was first computed; "cached" lets callers
            # label it as such.
            "tool_calls": tool_calls,
            "sources": sources,
            "cached": True,
        }

    documents = load_index()
    result = run_agent(question, documents)

    sources = [
        {"title": s.get("title", ""), "url": s.get("url", ""), "source": s.get("source", "")}
        for s in result["sources"]
    ]
    # Never cache a truncated answer: if the question recurs it is promoted to a
    # permanent entry and would serve the cut-off text forever.
    if not result["truncated"]:
        store_cached_answer(question, result["answer"], sources, result["trace"], hit_count=1)

    return {
        "statusCode": 200,
        "question": question,
        "answer": result["answer"],
        "grounded": bool(result["sources"]),
        "tool_calls": result["trace"],
        "sources": sources,
        "cached": False,
    }


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)
    q = sys.argv[1] if len(sys.argv) > 1 else "What is trending in tech today?"
    print(json.dumps(lambda_handler({"question": q}, None), indent=2))
