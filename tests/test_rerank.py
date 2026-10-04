import pytest
import requests

from common import rerank


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code}")

    def json(self):
        return self._payload


@pytest.fixture
def post(monkeypatch):
    """Replace the Jina call; the test sets post.response (or post.error) and reads post.calls."""
    calls = []

    class Post:
        response = FakeResponse({"results": []})
        error = None

    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        if Post.error:
            raise Post.error
        return Post.response

    monkeypatch.setattr(rerank, "get_secret", lambda name: {"api_key": "k"})
    monkeypatch.setattr(rerank.requests, "post", fake_post)
    Post.calls = calls
    return Post


DOCS = [
    {"title": "a", "text": "text a", "score": 0.1},
    {"title": "b", "text": "text b", "score": 0.2},
    {"title": "c", "text": "text c", "score": 0.3},
]


def test_rerank_orders_by_relevance_and_replaces_the_score(post):
    post.response = FakeResponse(
        {
            "results": [
                {"index": 2, "relevance_score": 0.9},
                {"index": 0, "relevance_score": 0.4},
            ]
        }
    )

    result = rerank.rerank("q", DOCS, top_n=2)

    assert [d["title"] for d in result] == ["c", "a"]
    assert [d["score"] for d in result] == [0.9, 0.4]


def test_rerank_sends_model_query_top_n_auth_and_truncated_documents(post):
    post.response = FakeResponse({"results": [{"index": 0, "relevance_score": 1.0}]})
    docs = [{"title": "long", "text": "x" * 5000}]

    rerank.rerank("my query", docs, top_n=1)

    url, kwargs = post.calls[0]
    assert url == "https://api.jina.ai/v1/rerank"
    assert kwargs["headers"]["Authorization"] == "Bearer k"
    assert kwargs["json"]["query"] == "my query"
    assert kwargs["json"]["top_n"] == 1
    assert kwargs["json"]["model"] == rerank.config.JINA_RERANK_MODEL
    assert len(kwargs["json"]["documents"][0]) == rerank.MAX_DOC_CHARS
    assert kwargs["timeout"] == rerank.RERANK_TIMEOUT_SECONDS


def test_rerank_does_not_call_jina_for_an_empty_list(post):
    assert rerank.rerank("q", [], top_n=5) == []
    assert post.calls == []


def test_rerank_falls_back_to_input_order_on_an_http_error(post):
    post.response = FakeResponse({}, status=500)

    assert rerank.rerank("q", DOCS, top_n=2) == DOCS[:2]


def test_rerank_falls_back_on_a_timeout(post):
    post.error = requests.Timeout("slow")

    assert rerank.rerank("q", DOCS, top_n=2) == DOCS[:2]


def test_rerank_falls_back_when_jina_returns_no_results(post):
    post.response = FakeResponse({"results": []})

    assert rerank.rerank("q", DOCS, top_n=2) == DOCS[:2]


def test_rerank_falls_back_when_an_index_is_out_of_range(post):
    post.response = FakeResponse({"results": [{"index": 9, "relevance_score": 0.9}]})

    assert rerank.rerank("q", DOCS, top_n=2) == DOCS[:2]


def test_rerank_handles_documents_with_missing_text(post):
    post.response = FakeResponse({"results": [{"index": 0, "relevance_score": 0.5}]})
    docs = [{"title": "none", "text": None}, {"title": "absent"}]

    result = rerank.rerank("q", docs, top_n=1)

    assert post.calls[0][1]["json"]["documents"] == ["", ""]
    assert result[0]["title"] == "none"
