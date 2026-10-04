import threading
import time

import pytest

from common import config, qdrant_store
from rag import build_index
from rag.build_index import build_document, dedup_documents, partition_changed


def test_build_document_hackernews_maps_fields():
    record = {
        "story_id": "s1",
        "title": "Some story",
        "text": "some body",
        "url": "https://example.com",
        "permalink": "https://news.ycombinator.com/item?id=s1",
    }

    doc = build_document(record, "hackernews")

    assert doc["id"] == "s1"
    assert doc["source"] == "hackernews"
    assert doc["url"] == "https://example.com"
    assert doc["text"] == "Some story some body"


def test_build_document_hackernews_falls_back_to_permalink():
    record = {"story_id": "s1", "title": "Ask HN", "text": "", "url": ""}

    doc = build_document(record, "hackernews")

    assert doc["url"] == ""


def test_build_document_news_maps_fields():
    record = {
        "article_id": "a1",
        "title": "Some article",
        "description": "some description",
        "url": "https://example.com/a",
    }

    doc = build_document(record, "news")

    assert doc["id"] == "a1"
    assert doc["source"] == "news"
    assert doc["text"] == "Some article some description"


def test_build_document_github_maps_fields():
    record = {
        "repo_id": "123",
        "full_name": "org/repo",
        "description": "a fast tool",
        "url": "https://github.com/org/repo",
    }

    doc = build_document(record, "github")

    assert doc["id"] == "123"
    assert doc["source"] == "github"
    assert doc["title"] == "org/repo"
    assert doc["text"] == "org/repo a fast tool"


def test_dedup_documents_keeps_first_occurrence():
    docs = [
        {"id": "1", "source": "news", "v": "a"},
        {"id": "2", "source": "news", "v": "b"},
        {"id": "1", "source": "news", "v": "c"},
    ]

    result = dedup_documents(docs)

    assert [d["v"] for d in result] == ["a", "b"]


def test_build_documents_reads_parquet_files_concurrently_and_keeps_order(monkeypatch):
    keys = {
        "source=hackernews/": ["hn/1.parquet", "hn/2.parquet", "hn/3.parquet", "hn/4.parquet"],
        "source=news/": [],
        "source=github/": [],
    }
    active = {"now": 0, "max": 0}
    lock = threading.Lock()

    def fake_read(bucket, key):
        with lock:
            active["now"] += 1
            active["max"] = max(active["max"], active["now"])
        time.sleep(0.05)
        with lock:
            active["now"] -= 1
        return [{"story_id": key, "title": f"title {key}", "text": "", "url": "u"}]

    monkeypatch.setattr(build_index, "list_parquet_keys", lambda bucket, prefix: keys[prefix])
    monkeypatch.setattr(build_index, "read_parquet_records", fake_read)

    docs = build_index.build_documents()

    assert [d["id"] for d in docs] == [
        "hn/1.parquet", "hn/2.parquet", "hn/3.parquet", "hn/4.parquet"
    ]
    assert active["max"] > 1


def test_build_documents_propagates_a_read_failure(monkeypatch):
    def fake_read(bucket, key):
        raise RuntimeError("S3 read failed")

    monkeypatch.setattr(build_index, "list_parquet_keys", lambda bucket, prefix: ["a.parquet"])
    monkeypatch.setattr(build_index, "read_parquet_records", fake_read)

    with pytest.raises(RuntimeError, match="S3 read failed"):
        build_index.build_documents()


def stored(doc):
    return {
        qdrant_store.point_id(doc["source"], doc["id"]): {
            "text_hash": qdrant_store.text_hash(doc["text"]),
            "embed_model": config.BEDROCK_EMBED_MODEL_ID,
        }
    }


def test_partition_changed_skips_unchanged_text_and_model():
    doc = {"id": "1", "source": "news", "text": "same text"}

    unchanged, needs_embedding = partition_changed([doc], stored(doc))

    assert unchanged == [doc]
    assert needs_embedding == []


def test_partition_changed_re_embeds_when_the_text_changed():
    old = {"id": "1", "source": "news", "text": "old text"}
    new = {"id": "1", "source": "news", "text": "new text"}

    unchanged, needs_embedding = partition_changed([new], stored(old))

    assert unchanged == []
    assert needs_embedding == [new]


def test_partition_changed_re_embeds_when_the_embedding_model_changed(monkeypatch):
    doc = {"id": "1", "source": "news", "text": "same text"}
    existing = stored(doc)
    monkeypatch.setattr(config, "BEDROCK_EMBED_MODEL_ID", "some.other-model")

    unchanged, needs_embedding = partition_changed([doc], existing)

    assert unchanged == []
    assert needs_embedding == [doc]


def test_partition_changed_treats_an_unseen_document_as_new():
    doc = {"id": "new", "source": "github", "text": "brand new"}

    unchanged, needs_embedding = partition_changed([doc], existing={})

    assert unchanged == []
    assert needs_embedding == [doc]


def test_partition_changed_keeps_the_same_id_from_two_sources_apart():
    news = {"id": "7", "source": "news", "text": "t"}
    github = {"id": "7", "source": "github", "text": "t"}

    unchanged, needs_embedding = partition_changed([news, github], stored(news))

    assert unchanged == [news]
    assert needs_embedding == [github]


class FakeContext:
    def __init__(self, remaining_ms):
        self._remaining = list(remaining_ms)

    def get_remaining_time_in_millis(self):
        return self._remaining.pop(0)


def make_docs(count):
    return [
        {"id": str(i), "source": "news", "title": "t", "url": "u", "text": "x" * (i + 1)}
        for i in range(count)
    ]


def fake_store(monkeypatch, upserted):
    monkeypatch.setattr(qdrant_store, "ensure_collection", lambda: None)
    monkeypatch.setattr(qdrant_store, "existing_hashes", lambda: {})
    monkeypatch.setattr(qdrant_store, "upsert_documents", lambda docs: upserted.extend(docs))


def test_lambda_handler_embeds_and_upserts_new_documents(monkeypatch):
    upserted = []
    fake_store(monkeypatch, upserted)
    monkeypatch.setattr(build_index, "build_documents", lambda: make_docs(2))
    monkeypatch.setattr(build_index, "embed_text", lambda text: [float(len(text))])

    result = build_index.lambda_handler({}, None)

    assert [d["id"] for d in upserted] == ["0", "1"]
    assert [d["embedding"] for d in upserted] == [[1.0], [2.0]]
    assert result["newly_embedded"] == 2
    assert result["remaining"] == 0
    assert result["unchanged"] == 0


def test_lambda_handler_embeds_concurrently_and_keeps_each_vector_with_its_document(
    monkeypatch,
):
    upserted = []
    fake_store(monkeypatch, upserted)
    monkeypatch.setattr(build_index, "build_documents", lambda: make_docs(8))
    active = {"now": 0, "max": 0}
    lock = threading.Lock()

    def fake_embed(text):
        with lock:
            active["now"] += 1
            active["max"] = max(active["max"], active["now"])
        time.sleep(0.03)
        with lock:
            active["now"] -= 1
        return [float(len(text))]

    monkeypatch.setattr(build_index, "embed_text", fake_embed)

    build_index.lambda_handler({}, None)

    assert active["max"] > 1
    assert [d["id"] for d in upserted] == [str(i) for i in range(8)]
    assert [d["embedding"] for d in upserted] == [[float(i + 1)] for i in range(8)]


def test_lambda_handler_stops_between_chunks_when_time_runs_out(monkeypatch):
    upserted = []
    fake_store(monkeypatch, upserted)
    monkeypatch.setattr(build_index, "build_documents", lambda: make_docs(5))
    monkeypatch.setattr(build_index, "embed_text", lambda text: [0.1])
    monkeypatch.setattr(build_index, "UPSERT_BATCH", 1)  # chunks of 2 documents
    # Time left is checked before each chunk: plenty, then too little.
    context = FakeContext([120_000, 1_000])

    result = build_index.lambda_handler({}, context)

    assert [d["id"] for d in upserted] == ["0", "1"]
    assert result["newly_embedded"] == 2
    assert result["remaining"] == 3


def test_lambda_handler_propagates_an_embedding_failure(monkeypatch):
    upserted = []
    fake_store(monkeypatch, upserted)
    monkeypatch.setattr(build_index, "build_documents", lambda: make_docs(3))

    def boom(text):
        raise RuntimeError("Bedrock throttled")

    monkeypatch.setattr(build_index, "embed_text", boom)

    with pytest.raises(RuntimeError, match="Bedrock throttled"):
        build_index.lambda_handler({}, None)
    assert upserted == []


def test_lambda_handler_skips_documents_with_empty_text(monkeypatch):
    upserted = []
    fake_store(monkeypatch, upserted)
    empty = [{"id": "1", "source": "news", "title": "t", "url": "u", "text": ""}]
    monkeypatch.setattr(build_index, "build_documents", lambda: empty)
    monkeypatch.setattr(build_index, "embed_text", lambda text: [0.1])

    result = build_index.lambda_handler({}, None)

    assert upserted == []
    assert result["newly_embedded"] == 0


def test_bedrock_client_retries_adaptively_so_throttling_slows_the_run(monkeypatch):
    captured = {}
    monkeypatch.setattr(build_index, "_bedrock_client", None)
    monkeypatch.setattr(
        build_index.boto3, "client", lambda *args, **kwargs: captured.update(kwargs) or object()
    )

    build_index._bedrock()

    retries = captured["config"].retries
    assert retries["mode"] == "adaptive"
    assert retries["max_attempts"] >= 8


def test_dedup_documents_keeps_the_same_id_from_different_sources():
    docs = [
        {"id": "1", "source": "news", "v": "a"},
        {"id": "1", "source": "github", "v": "b"},
        {"id": "1", "source": "news", "v": "c"},
    ]

    result = dedup_documents(docs)

    assert [d["v"] for d in result] == ["a", "b"]
