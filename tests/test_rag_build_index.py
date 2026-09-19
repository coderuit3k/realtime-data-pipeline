from rag.build_index import build_document, dedup_documents, partition_by_cache


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
    docs = [{"id": "1", "v": "a"}, {"id": "2", "v": "b"}, {"id": "1", "v": "c"}]

    result = dedup_documents(docs)

    assert result == [{"id": "1", "v": "a"}, {"id": "2", "v": "b"}]


def test_partition_by_cache_reuses_embedding_for_unchanged_text():
    documents = [{"id": "1", "text": "same text"}]
    existing = {"1": {"text": "same text", "embedding": [0.1, 0.2]}}

    cached, needs_embedding = partition_by_cache(documents, existing)

    assert needs_embedding == []
    assert cached[0]["embedding"] == [0.1, 0.2]


def test_partition_by_cache_re_embeds_when_text_changed():
    documents = [{"id": "1", "text": "new text"}]
    existing = {"1": {"text": "old text", "embedding": [0.1, 0.2]}}

    cached, needs_embedding = partition_by_cache(documents, existing)

    assert cached == []
    assert needs_embedding == [{"id": "1", "text": "new text"}]


def test_partition_by_cache_re_embeds_unseen_document():
    documents = [{"id": "new", "text": "brand new"}]

    cached, needs_embedding = partition_by_cache(documents, existing={})

    assert cached == []
    assert needs_embedding == [{"id": "new", "text": "brand new"}]


def test_partition_by_cache_handles_mixed_batch():
    documents = [
        {"id": "1", "text": "unchanged"},
        {"id": "2", "text": "new"},
    ]
    existing = {"1": {"text": "unchanged", "embedding": [0.5]}}

    cached, needs_embedding = partition_by_cache(documents, existing)

    assert [d["id"] for d in cached] == ["1"]
    assert [d["id"] for d in needs_embedding] == ["2"]
