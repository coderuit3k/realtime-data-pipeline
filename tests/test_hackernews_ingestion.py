from datetime import datetime, timezone
from unittest.mock import patch

from ingestion.hackernews_ingestion import lambda_handler, normalize_story


def _fake_item(**overrides):
    defaults = {
        "id": 123,
        "type": "story",
        "title": "Some title",
        "text": "some body",
        "by": "some_user",
        "score": 42,
        "descendants": 7,
        "url": "https://example.com",
        "time": 1700000000,
    }
    defaults.update(overrides)
    return defaults


def test_normalize_story_maps_fields():
    result = normalize_story(_fake_item())

    assert result["story_id"] == "123"
    assert result["source"] == "hackernews"
    assert result["title"] == "Some title"
    assert result["text"] == "some body"
    assert result["author"] == "some_user"
    assert result["score"] == 42
    assert result["num_comments"] == 7
    assert result["url"] == "https://example.com"
    assert result["permalink"] == "https://news.ycombinator.com/item?id=123"
    assert result["created_at"] == datetime.fromtimestamp(1700000000, tz=timezone.utc).isoformat()
    assert "ingested_at" in result


def test_normalize_story_handles_ask_hn_without_url():
    result = normalize_story(_fake_item(url=None))

    assert result["url"] == ""


def test_normalize_story_handles_missing_text():
    item = _fake_item()
    del item["text"]

    result = normalize_story(item)

    assert result["text"] == ""


@patch("ingestion.hackernews_ingestion.write_records")
@patch("ingestion.hackernews_ingestion.fetch_new_stories")
def test_lambda_handler_writes_records_keyed_by_story_id(
    mock_fetch_new_stories, mock_write_records
):
    mock_fetch_new_stories.return_value = [{"story_id": "123"}]
    mock_write_records.return_value = "some/key.json"

    lambda_handler({}, None)

    mock_write_records.assert_called_once_with("hackernews", [{"story_id": "123"}], "story_id")
