import logging

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


def test_rerank_sends_model_query_top_n_auth_and_lets_jina_truncate_documents(post):
    post.response = FakeResponse({"results": [{"index": 0, "relevance_score": 1.0}]})
    docs = [{"title": "long", "text": "x" * 5000}]

    rerank.rerank("my query", docs, top_n=1)

    url, kwargs = post.calls[0]
    assert url == "https://api.jina.ai/v1/rerank"
    assert kwargs["headers"]["Authorization"] == "Bearer k"
    # A form-encoded body (data=) is rejected by Jina and would silently fall back to RRF order.
    assert "data" not in kwargs
    assert kwargs["json"]["query"] == "my query"
    assert kwargs["json"]["top_n"] == 1
    assert kwargs["json"]["model"] == rerank.config.JINA_RERANK_MODEL
    # Truncation is Jina's job (tokens, via max_doc_length), so the full text is sent.
    assert kwargs["json"]["documents"] == ["x" * 5000]
    assert kwargs["json"]["max_doc_length"] == rerank.MAX_DOC_TOKENS
    assert kwargs["json"]["return_documents"] is False
    assert kwargs["timeout"] == rerank.RERANK_TIMEOUT_SECONDS


def test_rerank_drops_results_below_the_minimum_score_and_keeps_the_order(post):
    post.response = FakeResponse(
        {
            "results": [
                {"index": 2, "relevance_score": rerank.RERANK_MIN_SCORE + 0.3},
                {"index": 0, "relevance_score": rerank.RERANK_MIN_SCORE + 0.1},
                {"index": 1, "relevance_score": rerank.RERANK_MIN_SCORE - 0.1},
            ]
        }
    )

    result = rerank.rerank("q", DOCS, top_n=3)

    assert [d["title"] for d in result] == ["c", "a"]


def test_rerank_keeps_a_result_exactly_at_the_minimum_score(post):
    at_threshold = {"index": 1, "relevance_score": rerank.RERANK_MIN_SCORE}
    post.response = FakeResponse({"results": [at_threshold]})

    result = rerank.rerank("q", DOCS, top_n=1)

    assert [d["title"] for d in result] == ["b"]


def test_rerank_returns_nothing_when_no_result_reaches_the_minimum_score(post):
    """Jina answered fine and nothing is relevant: do not fall back to the unranked RRF docs."""
    post.response = FakeResponse(
        {
            "results": [
                {"index": 0, "relevance_score": rerank.RERANK_MIN_SCORE - 0.05},
                {"index": 1, "relevance_score": -0.2},
            ]
        }
    )

    assert rerank.rerank("q", DOCS, top_n=2) == []


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


def test_rerank_logs_the_scores_the_kept_count_and_the_threshold(post, caplog):
    post.response = FakeResponse(
        {
            "results": [
                {"index": 2, "relevance_score": rerank.RERANK_MIN_SCORE + 0.25},
                {"index": 0, "relevance_score": rerank.RERANK_MIN_SCORE - 0.05},
            ]
        }
    )

    with caplog.at_level(logging.INFO, logger="common.rerank"):
        rerank.rerank("pho recipe", DOCS, top_n=2)

    line = " ".join(record.getMessage() for record in caplog.records)
    assert f"scores={[0.4, 0.1]}" in line
    assert "kept=1/2" in line
    assert f"min_score={rerank.RERANK_MIN_SCORE}" in line
    assert "pho recipe" in line


def test_rerank_logs_even_when_nothing_reaches_the_threshold(post, caplog):
    post.response = FakeResponse({"results": [{"index": 0, "relevance_score": -0.1}]})

    with caplog.at_level(logging.INFO, logger="common.rerank"):
        assert rerank.rerank("q", DOCS, top_n=1) == []

    assert "kept=0/1" in " ".join(record.getMessage() for record in caplog.records)
