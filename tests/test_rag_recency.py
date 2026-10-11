"""Tests for search_knowledge_base recency boost and metadata filters."""

from datetime import datetime, timezone
from types import SimpleNamespace

from qdrant_client import models

from common import config, qdrant_store
from rag import agent, build_index
from rag.build_index import _published_date, _published_ts, build_document


def _cand(title, score, ts):
    return {
        "title": title,
        "url": "",
        "text": "",
        "source": "news",
        "score": score,
        "published_date": "",
        "published_ts": ts,
    }


# --- build_search_filter -----------------------------------------------------


def test_build_search_filter_returns_none_for_no_valid_arguments():
    assert qdrant_store.build_search_filter() is None
    assert qdrant_store.build_search_filter(sources=["nope"], days_back=0) is None
    assert qdrant_store.build_search_filter(sources=[], days_back=-3) is None
    assert qdrant_store.build_search_filter(days_back=True) is None


def test_build_search_filter_combines_source_and_date():
    f = qdrant_store.build_search_filter(sources=["news", "github", "nope"], days_back=7)

    assert isinstance(f, models.Filter)
    by_key = {c.key: c for c in f.must}
    assert by_key["source"].match.any == ["news", "github"]
    now_ts = datetime.now(timezone.utc).timestamp()
    assert now_ts - 8 * 86400 < by_key["published_ts"].range.gte <= now_ts - 6 * 86400


def test_build_search_filter_with_only_sources():
    f = qdrant_store.build_search_filter(sources=["hackernews"])

    assert isinstance(f, models.Filter)
    assert [c.key for c in f.must] == ["source"]


# --- backfill_published_dates -------------------------------------------------


class _BackfillFakeClient:
    def __init__(self, pages):
        self._pages = list(pages)
        self.set_payload_calls = []

    def scroll(self, **kwargs):
        return self._pages.pop(0)

    def set_payload(self, **kwargs):
        self.set_payload_calls.append(kwargs)


def test_backfill_published_dates_sets_only_points_missing_a_date(monkeypatch):
    missing = SimpleNamespace(id="id-1", payload={})
    present = SimpleNamespace(id="id-2", payload={"published_date": "2026-01-01"})
    empty = SimpleNamespace(id="id-3", payload={"published_date": ""})
    unknown = SimpleNamespace(id="id-9", payload={})
    fake = _BackfillFakeClient([([missing, present, empty, unknown], None)])
    monkeypatch.setattr(qdrant_store, "_client", lambda: fake)

    updated = qdrant_store.backfill_published_dates(
        {"id-1": ("2026-10-10", 1791484800), "id-3": ("", 0)}
    )

    assert updated == 1
    (call,) = fake.set_payload_calls
    assert call["collection_name"] == config.QDRANT_COLLECTION
    assert call["points"] == ["id-1"]
    assert call["payload"] == {"published_date": "2026-10-10", "published_ts": 1791484800}


def test_backfill_published_dates_is_a_no_op_once_caught_up(monkeypatch):
    present = SimpleNamespace(id="id-1", payload={"published_date": "2026-10-10"})
    fake = _BackfillFakeClient([([present], None)])
    monkeypatch.setattr(qdrant_store, "_client", lambda: fake)

    assert qdrant_store.backfill_published_dates({"id-1": ("2026-10-10", 1791484800)}) == 0
    assert fake.set_payload_calls == []


# --- build_document dates ------------------------------------------------------


def test_build_document_hackernews_prefers_created_at():
    doc = build_document(
        {
            "story_id": "s",
            "title": "t",
            "text": "x",
            "created_at": "2026-10-05T08:00:00.123456+00:00",
            "ingested_at": "2026-10-06T08:00:00+00:00",
        },
        "hackernews",
    )

    assert doc["published_date"] == "2026-10-05"
    assert doc["published_ts"] == int(datetime(2026, 10, 5, tzinfo=timezone.utc).timestamp())


def test_build_document_news_falls_back_to_ingested_at():
    doc = build_document(
        {
            "article_id": "a",
            "title": "t",
            "description": "x",
            "ingested_at": "2026-09-01T00:00:00Z",
        },
        "news",
    )

    assert doc["published_date"] == "2026-09-01"


def test_build_document_github_prefers_pushed_at():
    doc = build_document(
        {
            "repo_id": "1",
            "full_name": "o/r",
            "pushed_at": "2026-10-02T00:00:00Z",
            "created_at": "2026-01-01T00:00:00Z",
        },
        "github",
    )

    assert doc["published_date"] == "2026-10-02"


def test_published_date_is_empty_for_missing_or_garbage_input():
    assert _published_date({}, "news") == ""
    assert _published_date({"published_at": None}, "news") == ""
    assert _published_date({"published_at": "not a date"}, "news") == ""
    assert _published_ts("") == 0
    assert _published_ts("not a date") == 0


# --- _apply_recency_boost -------------------------------------------------------


def test_apply_recency_boost_prefers_fresh_documents(monkeypatch):
    monkeypatch.setattr(agent.config, "RAG_RECENCY_WEIGHT", 1.0)
    monkeypatch.setattr(agent.config, "RAG_RECENCY_HALF_LIFE_DAYS", 14.0)
    now = datetime(2026, 10, 11, 12, tzinfo=timezone.utc)
    day = 86400
    now_ts = now.timestamp()
    cands = [
        _cand("old-but-relevant", 0.050, now_ts - 90 * day),
        _cand("fresh", 0.040, now_ts - 1 * day),
        _cand("dateless", 0.045, 0),
        _cand("future", 0.044, now_ts + 5 * day),
    ]

    result = agent._apply_recency_boost(cands, now=now)

    assert [c["title"] for c in result] == ["fresh", "old-but-relevant", "dateless", "future"]
    assert result[0]["score"] > 0.040  # the fresh doc was boosted
    assert result[2]["score"] == 0.045  # dateless docs keep their score
    assert result[3]["score"] == 0.044  # future-dated docs are not boosted


def test_apply_recency_boost_is_disabled_with_zero_weight(monkeypatch):
    monkeypatch.setattr(agent.config, "RAG_RECENCY_WEIGHT", 0.0)
    cands = [_cand("a", 0.05, 1000), _cand("b", 0.04, 2000)]

    result = agent._apply_recency_boost(cands)

    assert [c["title"] for c in result] == ["a", "b"]
    assert result[0]["score"] == 0.05


# --- search_knowledge_base wiring -------------------------------------------------


def test_search_knowledge_base_builds_and_passes_the_filter(monkeypatch):
    seen = {}
    candidates = [_cand("a", 0.5, 0)]

    def fake_hybrid(query, vector, n, query_filter=None):
        seen["filter"] = query_filter
        return candidates

    monkeypatch.setattr(agent, "embed_text", lambda text: [0.1])
    monkeypatch.setattr(agent.qdrant_store, "hybrid_search", fake_hybrid)
    monkeypatch.setattr(agent, "rerank", lambda q, docs, top_n: docs[:top_n])
    monkeypatch.setattr(agent.config, "RAG_CANDIDATES", 30)
    monkeypatch.setattr(agent.config, "RAG_RERANK", True)
    monkeypatch.setattr(agent.config, "RAG_RECENCY_WEIGHT", 0.0)

    agent.search_knowledge_base("q", top_k=5, sources=["news"], days_back=7)

    f = seen["filter"]
    assert isinstance(f, models.Filter)
    conds = {c.key: c for c in f.must}
    assert conds["source"].match.any == ["news"]
    assert conds["published_ts"].range.gte > 0


def test_run_tool_passes_sources_and_days_back_and_includes_date_in_summary(monkeypatch):
    seen = {}
    matches = [
        {"title": "t", "url": "u", "text": "x", "score": 0.9, "published_date": "2026-10-10"}
    ]

    def fake_search(query, top_k, sources=None, days_back=None, **kwargs):
        seen.update(query=query, top_k=top_k, sources=sources, days_back=days_back)
        return matches

    monkeypatch.setattr(agent, "search_knowledge_base", fake_search)

    summary, raw = agent.run_tool(
        "search_knowledge_base", {"query": "q", "sources": ["news"], "days_back": 7}
    )

    assert seen == {
        "query": "q",
        "top_k": agent.config.RAG_TOP_K,
        "sources": ["news"],
        "days_back": 7,
    }
    assert summary[0]["published_date"] == "2026-10-10"
    assert raw == matches


def test_lambda_handler_backfills_published_dates(monkeypatch):
    upserted, backfilled = [], []
    monkeypatch.setattr(qdrant_store, "ensure_collection", lambda: None)
    monkeypatch.setattr(qdrant_store, "existing_hashes", lambda: {})
    monkeypatch.setattr(qdrant_store, "upsert_documents", lambda docs: upserted.extend(docs))
    monkeypatch.setattr(
        qdrant_store, "backfill_published_dates", lambda dates: backfilled.append(dates) or 0
    )
    docs = [
        {
            "id": "1",
            "source": "news",
            "title": "t",
            "url": "u",
            "text": "x",
            "published_date": "2026-10-10",
            "published_ts": 1791484800,
        }
    ]
    monkeypatch.setattr(build_index, "build_documents", lambda: docs)
    monkeypatch.setattr(build_index, "embed_text", lambda text: [0.1])

    result = build_index.lambda_handler({}, None)

    assert result["backfilled_dates"] == 0
    (mapping,) = backfilled
    assert mapping[qdrant_store.point_id("news", "1")] == ("2026-10-10", 1791484800)
