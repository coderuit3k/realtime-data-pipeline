from ingestion.news_ingestion import normalize_article


def test_normalize_article_maps_fields():
    article = {
        "source": {"id": "cnn", "name": "CNN"},
        "title": "Some title",
        "description": "Some description",
        "url": "https://example.com/article",
        "publishedAt": "2026-09-18T12:00:00Z",
    }

    result = normalize_article(article)

    assert result["article_id"] == "https://example.com/article"
    assert result["source"] == "news"
    assert result["provider"] == "CNN"
    assert result["title"] == "Some title"
    assert result["description"] == "Some description"
    assert result["published_at"] == "2026-09-18T12:00:00Z"
    assert "ingested_at" in result


def test_normalize_article_handles_missing_source():
    article = {"title": "No source", "url": "https://example.com/x"}

    result = normalize_article(article)

    assert result["provider"] is None
