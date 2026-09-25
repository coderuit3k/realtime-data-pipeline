from unittest.mock import MagicMock, patch

from ingestion.news_ingestion import fetch_articles, lambda_handler, normalize_article


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


@patch("ingestion.news_ingestion.write_records")
@patch("ingestion.news_ingestion.fetch_articles")
def test_lambda_handler_writes_records_keyed_by_article_id(mock_fetch_articles, mock_write_records):
    # NewsAPI's /v2/everything has been observed returning the same article
    # twice in one response -- write_records dedupes by key_field, so this
    # module must pass its real unique id field ("article_id") through.
    mock_fetch_articles.return_value = [{"article_id": "https://example.com/a"}]
    mock_write_records.return_value = "some/key.json"

    lambda_handler({}, None)

    mock_write_records.assert_called_once_with(
        "news", [{"article_id": "https://example.com/a"}], "article_id"
    )


@patch("ingestion.news_ingestion.requests.get")
@patch("ingestion.news_ingestion.get_secret")
def test_fetch_articles_sends_api_key_as_a_header_not_a_query_param(mock_get_secret, mock_get):
    # A leaked query string (e.g. in an exception message, an access log, or
    # -- as happened before this test -- a CloudWatch log line surfaced on
    # the public landing page) exposes the real key. NewsAPI supports the
    # same auth via the X-Api-Key header, which never appears in a URL.
    mock_get_secret.return_value = {"api_key": "real-secret-key"}
    mock_response = MagicMock()
    mock_response.json.return_value = {"articles": []}
    mock_get.return_value = mock_response

    fetch_articles()

    _, kwargs = mock_get.call_args
    assert kwargs["headers"]["X-Api-Key"] == "real-secret-key"
    assert "apiKey" not in kwargs["params"]
