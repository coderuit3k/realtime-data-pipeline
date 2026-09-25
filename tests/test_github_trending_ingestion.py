from unittest.mock import patch

from ingestion.github_trending_ingestion import lambda_handler, normalize_repo


def test_normalize_repo_maps_fields():
    item = {
        "id": 1373655162,
        "full_name": "browser-use/jev-ultrafast",
        "description": "i. am. speed.",
        "html_url": "https://github.com/browser-use/jev-ultrafast",
        "language": "Python",
        "stargazers_count": 6699,
        "forks_count": 430,
        "created_at": "2026-09-16T21:30:12Z",
        "pushed_at": "2026-09-18T16:28:35Z",
    }

    result = normalize_repo(item)

    assert result["repo_id"] == "1373655162"
    assert result["source"] == "github"
    assert result["full_name"] == "browser-use/jev-ultrafast"
    assert result["description"] == "i. am. speed."
    assert result["url"] == "https://github.com/browser-use/jev-ultrafast"
    assert result["language"] == "Python"
    assert result["stars"] == 6699
    assert result["forks"] == 430
    assert "ingested_at" in result


def test_normalize_repo_handles_missing_description_and_language():
    item = {"id": 1, "full_name": "org/repo", "html_url": "https://github.com/org/repo"}

    result = normalize_repo(item)

    assert result["description"] == ""
    assert result["language"] == ""


@patch("ingestion.github_trending_ingestion.write_records")
@patch("ingestion.github_trending_ingestion.fetch_trending")
def test_lambda_handler_writes_records_keyed_by_repo_id(mock_fetch_trending, mock_write_records):
    mock_fetch_trending.return_value = [{"repo_id": "1373655162"}]
    mock_write_records.return_value = "some/key.json"

    lambda_handler({}, None)

    mock_write_records.assert_called_once_with("github", [{"repo_id": "1373655162"}], "repo_id")
