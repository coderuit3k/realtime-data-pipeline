import threading
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from ingestion import hackernews_ingestion
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


class _FakeResponse:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self._data


class _FakeHnSession:
    """Serves the story-id feed plus items; item fetches wait on `barrier`
    (if given) so the test only passes when they run concurrently."""

    def __init__(self, ids, items, barrier=None):
        self._ids = ids
        self._items = items
        self._barrier = barrier

    def get(self, url, timeout):
        if url.endswith("newstories.json"):
            return _FakeResponse(self._ids)
        if self._barrier:
            self._barrier.wait()
        item = self._items[int(url.rsplit("/", 1)[1].removesuffix(".json"))]
        if isinstance(item, Exception):
            raise item
        return _FakeResponse(item)


def _patch_session(monkeypatch, session):
    created = []

    def make_session(pool_size):
        created.append(pool_size)
        return session

    monkeypatch.setattr(hackernews_ingestion, "make_session", make_session)
    return created


def test_fetch_new_stories_fetches_items_concurrently_in_feed_order(monkeypatch):
    items = {i: _fake_item(id=i, title=f"t{i}") for i in (3, 1, 2)}
    session = _FakeHnSession([3, 1, 2], items, barrier=threading.Barrier(3, timeout=2))
    _patch_session(monkeypatch, session)

    stories = hackernews_ingestion.fetch_new_stories(limit=3)

    assert [s["story_id"] for s in stories] == ["3", "1", "2"]


def test_fetch_new_stories_reuses_one_session_for_every_request(monkeypatch):
    items = {i: _fake_item(id=i) for i in (1, 2, 3, 4)}
    created = _patch_session(monkeypatch, _FakeHnSession([1, 2, 3, 4], items))

    hackernews_ingestion.fetch_new_stories(limit=4)

    assert len(created) == 1


def test_fetch_new_stories_skips_deleted_and_non_story_items(monkeypatch):
    items = {1: _fake_item(id=1), 2: None, 3: _fake_item(id=3, type="comment")}
    _patch_session(monkeypatch, _FakeHnSession([1, 2, 3], items))

    stories = hackernews_ingestion.fetch_new_stories(limit=3)

    assert [s["story_id"] for s in stories] == ["1"]


def test_fetch_new_stories_fails_the_run_when_an_item_request_fails(monkeypatch):
    items = {1: _fake_item(id=1), 2: RuntimeError("HN down")}
    _patch_session(monkeypatch, _FakeHnSession([1, 2], items))

    with pytest.raises(RuntimeError, match="HN down"):
        hackernews_ingestion.fetch_new_stories(limit=2)
