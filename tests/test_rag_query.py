from rag.query import (
    build_grading_prompt,
    build_prompt,
    choose_answer_source,
    classify_matches,
    cosine_similarity,
    parse_grades,
    top_matches,
)


def test_cosine_similarity_identical_vectors_is_one():
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == 1.0


def test_cosine_similarity_orthogonal_vectors_is_zero():
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0


def test_cosine_similarity_zero_vector_is_zero_not_nan():
    assert cosine_similarity([0.0, 0.0], [1.0, 0.0]) == 0.0


def test_top_matches_orders_by_score_and_truncates():
    question_embedding = [1.0, 0.0]
    documents = [
        {"id": "low", "embedding": [0.0, 1.0]},
        {"id": "high", "embedding": [1.0, 0.0]},
        {"id": "mid", "embedding": [0.7, 0.7]},
    ]

    result = top_matches(question_embedding, documents, top_k=2)

    assert [d["id"] for d in result] == ["high", "mid"]
    assert result[0]["score"] > result[1]["score"]


def test_build_prompt_includes_question_and_sources():
    matches = [
        {"source": "hackernews", "title": "Some story", "text": "body text", "url": "https://example.com"},
    ]

    prompt = build_prompt("What is happening?", matches)

    assert "What is happening?" in prompt
    assert "Some story" in prompt
    assert "https://example.com" in prompt
    assert "[1]" in prompt


def test_build_grading_prompt_includes_question_and_contexts():
    matches = [{"title": "Some story", "text": "body text"}]

    prompt = build_grading_prompt("What is happening?", matches)

    assert "What is happening?" in prompt
    assert "[1] Some story" in prompt


def test_parse_grades_parses_plain_json_array():
    result = parse_grades('["relevant", "irrelevant"]', expected_count=2)
    assert result == ["relevant", "irrelevant"]


def test_parse_grades_strips_markdown_code_fence():
    result = parse_grades('```json\n["ambiguous"]\n```', expected_count=1)
    assert result == ["ambiguous"]


def test_parse_grades_rejects_wrong_count():
    try:
        parse_grades('["relevant"]', expected_count=2)
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_parse_grades_rejects_invalid_grade_value():
    try:
        parse_grades('["totally_relevant"]', expected_count=1)
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_classify_matches_splits_used_vs_discarded():
    matches = [{"title": "a"}, {"title": "b"}, {"title": "c"}]
    grades = ["relevant", "ambiguous", "irrelevant"]

    used, discarded = classify_matches(matches, grades)

    assert [m["title"] for m in used] == ["a", "b"]
    assert [m["title"] for m in discarded] == ["c"]
    assert used[0]["grade"] == "relevant"
    assert discarded[0]["grade"] == "irrelevant"


def test_classify_matches_all_irrelevant_yields_empty_used():
    matches = [{"title": "a"}]
    grades = ["irrelevant"]

    used, discarded = classify_matches(matches, grades)

    assert used == []
    assert len(discarded) == 1


def test_choose_answer_source_prefers_local_knowledge_base():
    result = choose_answer_source(used=[{"title": "a"}], web_results=[{"title": "b"}])
    assert result == "local_knowledge_base"


def test_choose_answer_source_falls_back_to_web_search():
    assert choose_answer_source(used=[], web_results=[{"title": "b"}]) == "web_search"


def test_choose_answer_source_falls_back_to_model_knowledge():
    assert choose_answer_source(used=[], web_results=[]) == "model_knowledge"
