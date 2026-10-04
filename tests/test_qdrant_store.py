from types import SimpleNamespace

from qdrant_client import models

from common import config, qdrant_store


class FakeClient:
    def __init__(self, exists=True, scroll_pages=None, query_points=None):
        self.exists = exists
        self.created = []
        self.upserts = []
        self.scrolls = []
        self.queries = []
        self._scroll_pages = list(scroll_pages or [([], None)])
        self._query_result = query_points or SimpleNamespace(points=[])

    def collection_exists(self, name):
        return self.exists

    def create_collection(self, **kwargs):
        self.created.append(kwargs)

    def upsert(self, collection_name, points):
        self.upserts.append((collection_name, points))

    def scroll(self, **kwargs):
        self.scrolls.append(kwargs)
        return self._scroll_pages.pop(0)

    def query_points(self, **kwargs):
        self.queries.append(kwargs)
        return self._query_result


def use(monkeypatch, fake):
    monkeypatch.setattr(qdrant_store, "_client", lambda: fake)
    return fake


def doc(doc_id="1", source="news", text="some text"):
    return {
        "id": doc_id,
        "source": source,
        "title": "T",
        "url": "https://x",
        "text": text,
        "embedding": [0.1, 0.2],
    }


def test_point_id_is_stable_for_the_same_document():
    assert qdrant_store.point_id("news", "42") == qdrant_store.point_id("news", "42")


def test_point_id_differs_per_source():
    assert qdrant_store.point_id("news", "42") != qdrant_store.point_id("github", "42")


def test_text_hash_changes_with_the_text():
    assert qdrant_store.text_hash("a") == qdrant_store.text_hash("a")
    assert qdrant_store.text_hash("a") != qdrant_store.text_hash("b")


def test_ensure_collection_creates_dense_and_sparse_vectors_when_missing(monkeypatch):
    fake = use(monkeypatch, FakeClient(exists=False))

    qdrant_store.ensure_collection()

    created = fake.created[0]
    assert created["collection_name"] == config.QDRANT_COLLECTION
    dense = created["vectors_config"]["dense"]
    assert dense.size == 1024
    assert dense.distance == models.Distance.COSINE
    assert created["sparse_vectors_config"]["sparse"].modifier == models.Modifier.IDF


def test_ensure_collection_does_nothing_when_it_exists(monkeypatch):
    fake = use(monkeypatch, FakeClient(exists=True))

    qdrant_store.ensure_collection()

    assert fake.created == []


def test_existing_hashes_follows_pagination_and_skips_vectors(monkeypatch):
    page1 = [SimpleNamespace(id="p1", payload={"text_hash": "h1", "embed_model": "m"})]
    page2 = [SimpleNamespace(id="p2", payload={"text_hash": "h2", "embed_model": "m"})]
    fake = use(monkeypatch, FakeClient(scroll_pages=[(page1, "next"), (page2, None)]))

    result = qdrant_store.existing_hashes()

    assert result == {
        "p1": {"text_hash": "h1", "embed_model": "m"},
        "p2": {"text_hash": "h2", "embed_model": "m"},
    }
    assert fake.scrolls[0]["with_vectors"] is False
    assert fake.scrolls[1]["offset"] == "next"


def test_existing_hashes_returns_empty_for_an_empty_collection(monkeypatch):
    use(monkeypatch, FakeClient(scroll_pages=[([], None)]))

    assert qdrant_store.existing_hashes() == {}


def test_upsert_documents_sends_batches_with_dense_sparse_and_payload(monkeypatch):
    fake = use(monkeypatch, FakeClient())
    documents = [doc("1"), doc("2"), doc("3")]

    qdrant_store.upsert_documents(documents, batch_size=2)

    assert [len(points) for _, points in fake.upserts] == [2, 1]
    point = fake.upserts[0][1][0]
    assert point.id == qdrant_store.point_id("news", "1")
    assert point.vector["dense"] == [0.1, 0.2]
    assert isinstance(point.vector["sparse"], models.Document)
    assert point.vector["sparse"].model == "qdrant/bm25"
    assert point.vector["sparse"].text == "some text"
    assert point.payload["doc_id"] == "1"
    assert point.payload["source"] == "news"
    assert point.payload["text_hash"] == qdrant_store.text_hash("some text")
    assert point.payload["embed_model"] == config.BEDROCK_EMBED_MODEL_ID


def test_hybrid_search_builds_two_prefetches_fused_with_rrf(monkeypatch):
    point = SimpleNamespace(
        score=0.5,
        payload={"title": "T", "url": "https://x", "text": "body", "source": "github"},
    )
    fake = use(monkeypatch, FakeClient(query_points=SimpleNamespace(points=[point])))

    result = qdrant_store.hybrid_search("rust async", [0.3, 0.4], candidates=30)

    call = fake.queries[0]
    by_using = {p.using: p for p in call["prefetch"]}
    assert set(by_using) == {"dense", "sparse"}
    assert by_using["dense"].query == [0.3, 0.4]
    assert by_using["dense"].limit == 30
    assert by_using["sparse"].query.text == "rust async"
    assert by_using["sparse"].query.model == "qdrant/bm25"
    assert call["query"] == models.FusionQuery(fusion=models.Fusion.RRF)
    assert call["limit"] == 30
    assert result == [
        {"title": "T", "url": "https://x", "text": "body", "source": "github", "score": 0.5}
    ]


def test_hybrid_search_returns_empty_list_for_an_empty_collection(monkeypatch):
    use(monkeypatch, FakeClient())

    assert qdrant_store.hybrid_search("anything", [0.1], candidates=30) == []
