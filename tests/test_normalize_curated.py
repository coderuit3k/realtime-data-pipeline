import sys
from pathlib import Path

import pandas as pd

# scripts/ is a script directory, not a package.
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import normalize_curated as nc  # noqa: E402


def _hn():
    return pd.DataFrame(
        {
            "story_id": ["s1", "s2"],
            "title": ["The <b>Rust</b> Compiler!", "rust tools"],
            "text": ["Fast &amp; safe", ""],
            "author": ["Ann", "Bob"],
            "score": [10, 20],
        }
    )


def test_normalize_frame_normalizes_only_the_text_columns_of_the_source():
    result, changed = nc.normalize_frame(_hn(), "hackernews")

    assert list(result["title"]) == ["rust compiler", "rust tools"]
    assert list(result["text"]) == ["fast safe", ""]
    assert list(result["author"]) == ["Ann", "Bob"]
    assert list(result["score"]) == [10, 20]
    assert changed == 2


def test_normalize_frame_is_idempotent_and_reports_zero_changes_the_second_time():
    once, _ = nc.normalize_frame(_hn(), "hackernews")

    twice, changed = nc.normalize_frame(once, "hackernews")

    assert changed == 0
    assert twice.equals(once)


def test_normalize_frame_keeps_row_count_columns_and_dtypes():
    frame = _hn()

    result, _ = nc.normalize_frame(frame, "hackernews")

    assert len(result) == len(frame)
    assert list(result.columns) == list(frame.columns)
    assert result.dtypes.equals(frame.dtypes)


def test_normalize_frame_leaves_github_full_name_alone():
    frame = pd.DataFrame(
        {"repo_id": ["1"], "full_name": ["Org/Repo"], "description": ["A Fast Tool"]}
    )

    result, _ = nc.normalize_frame(frame, "github")

    assert list(result["full_name"]) == ["Org/Repo"]
    assert list(result["description"]) == ["fast tool"]


def test_normalize_frame_keeps_missing_values_missing():
    frame = pd.DataFrame({"story_id": ["s1"], "title": [None], "text": [None]})

    result, changed = nc.normalize_frame(frame, "hackernews")

    assert result["title"].isna().all() and result["text"].isna().all()
    assert changed == 0


def test_normalize_frame_ignores_a_source_it_does_not_normalize():
    frame = pd.DataFrame({"message_id": ["m1"], "subject": ["The Plan"]})

    result, changed = nc.normalize_frame(frame, "gmail")

    assert list(result["subject"]) == ["The Plan"]
    assert changed == 0


def test_backup_key_sits_outside_every_source_partition():
    key = "source=hackernews/year=2026/month=10/day=05/x.parquet"

    backup = nc.backup_key(key)

    assert backup == f"_backup_pre_normalization/{key}"
    assert not backup.startswith("source=")


def test_missing_backups_lists_the_files_with_no_copy():
    keys = ["source=news/a.parquet", "source=news/b.parquet"]
    backed_up = {nc.backup_key("source=news/a.parquet")}

    assert nc.missing_backups(keys, backed_up) == ["source=news/b.parquet"]


def test_missing_backups_is_empty_when_every_file_is_backed_up():
    keys = ["source=news/a.parquet"]

    assert nc.missing_backups(keys, {nc.backup_key("source=news/a.parquet")}) == []


class _FakeS3:
    """Just enough of the boto3 client for run(): listings, and a record of writes."""

    def __init__(self, keys):
        self.keys = keys
        self.uploads = []

    def get_paginator(self, name):
        outer = self

        class Paginator:
            def paginate(self, Bucket, Prefix):
                matching = [k for k in outer.keys if k.startswith(Prefix)]
                return [{"Contents": [{"Key": k} for k in matching]}]

        return Paginator()

    def upload_file(self, *args, **kwargs):
        self.uploads.append(args)


def test_run_apply_refuses_to_write_when_a_file_has_no_backup():
    s3 = _FakeS3(["source=hackernews/year=2026/month=10/day=05/x.parquet"])

    try:
        nc.run(s3, "bucket", apply=True)
    except RuntimeError as error:
        assert "backup" in str(error)
    else:
        raise AssertionError("run --apply must refuse without a backup")

    assert s3.uploads == []


class _MemoryS3:
    """An in-memory stand-in for the boto3 S3 client: listings, reads, copies and writes."""

    def __init__(self, objects):
        self.objects = dict(objects)
        self.writes = []
        self.copies = []

    def get_paginator(self, name):
        outer = self

        class Paginator:
            def paginate(self, Bucket, Prefix):
                keys = sorted(k for k in outer.objects if k.startswith(Prefix))
                return [{"Contents": [{"Key": k} for k in keys]}]

        return Paginator()

    def get_object(self, Bucket, Key):
        from io import BytesIO

        return {"Body": BytesIO(self.objects[Key])}

    def copy_object(self, Bucket, Key, CopySource):
        self.copies.append(Key)
        self.objects[Key] = self.objects[CopySource["Key"]]

    def upload_fileobj(self, Fileobj, Bucket, Key):
        self.writes.append(Key)
        self.objects[Key] = Fileobj.read()


def _parquet(frame):
    from io import BytesIO

    buffer = BytesIO()
    frame.to_parquet(buffer, engine="pyarrow", index=False)
    return buffer.getvalue()


def _read(s3, key):
    from io import BytesIO

    return pd.read_parquet(BytesIO(s3.objects[key]))


HN_KEYS = [f"source=hackernews/year=2026/month=10/day=0{i}/f.parquet" for i in range(1, 6)]
NEWS_KEY = "source=news/year=2026/month=10/day=01/n.parquet"


def _bucket():
    raw = pd.DataFrame(
        {"story_id": ["s"], "title": ["The Rust Compiler!"], "text": ["Fast &amp; safe"]}
    )
    clean = pd.DataFrame(
        {"article_id": ["a"], "title": ["fed cuts"], "description": ["rates fall"]}
    )
    objects = {key: _parquet(raw) for key in HN_KEYS}
    objects[NEWS_KEY] = _parquet(clean)
    return _MemoryS3(objects)


def test_backup_copies_every_curated_file_outside_the_source_partitions():
    s3 = _bucket()

    nc.backup(s3, "bucket", workers=4)

    for key in HN_KEYS + [NEWS_KEY]:
        assert s3.objects[nc.backup_key(key)] == s3.objects[key]


def test_run_dry_run_writes_nothing(capsys):
    s3 = _bucket()
    before = dict(s3.objects)

    nc.run(s3, "bucket", apply=False, workers=4)

    assert s3.objects == before
    assert "would rewrite 5 files" in capsys.readouterr().out


def test_run_apply_rewrites_only_files_that_change_and_keeps_the_schema(capsys):
    s3 = _bucket()
    nc.backup(s3, "bucket", workers=4)
    news_before = s3.objects[NEWS_KEY]

    nc.run(s3, "bucket", apply=True, workers=4)

    out = capsys.readouterr().out
    assert "hackernews: rewrote 5 files (10 values changed)" in out
    assert "news: rewrote 0 files" in out
    assert s3.objects[NEWS_KEY] == news_before
    assert sorted(s3.writes) == sorted(HN_KEYS)
    frame = _read(s3, HN_KEYS[0])
    assert list(frame["title"]) == ["rust compiler"]
    assert list(frame["text"]) == ["fast safe"]
    assert list(frame.columns) == ["story_id", "title", "text"]


def test_run_apply_is_idempotent(capsys):
    s3 = _bucket()
    nc.backup(s3, "bucket", workers=4)
    nc.run(s3, "bucket", apply=True, workers=4)
    capsys.readouterr()
    def live():
        return {k: v for k, v in s3.objects.items() if not k.startswith(nc.BACKUP_PREFIX)}

    after_first = live()

    nc.run(s3, "bucket", apply=True, workers=4)

    assert "rewrote 0 files" in capsys.readouterr().out
    assert live() == after_first


def test_run_gives_the_same_result_with_one_worker_or_many():
    one, many = _bucket(), _bucket()
    for s3, workers in ((one, 1), (many, 8)):
        nc.backup(s3, "bucket", workers=workers)
        nc.run(s3, "bucket", apply=True, workers=workers)

    assert one.objects == many.objects


def test_backup_skips_files_that_already_have_a_copy_so_it_is_cheap_to_re_run():
    s3 = _bucket()
    nc.backup(s3, "bucket", workers=4)
    first_round = len(s3.copies)

    nc.backup(s3, "bucket", workers=4)

    assert first_round == len(HN_KEYS) + 1
    assert len(s3.copies) == first_round


def test_backup_copies_a_file_added_after_the_first_backup():
    s3 = _bucket()
    nc.backup(s3, "bucket", workers=4)
    new_key = "source=hackernews/year=2026/month=10/day=06/new.parquet"
    s3.objects[new_key] = s3.objects[HN_KEYS[0]]

    nc.backup(s3, "bucket", workers=4)

    assert s3.copies[-1] == nc.backup_key(new_key)
    assert len(s3.copies) == len(HN_KEYS) + 2
