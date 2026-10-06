"""One-off: back up, then rewrite the curated Parquet history with normalized text.

    python scripts/normalize_curated.py backup                # copy originals aside
    python scripts/normalize_curated.py run                   # dry run: counts only
    python scripts/normalize_curated.py run --apply           # overwrite in place

Needs CURATED_BUCKET (terraform output -raw curated_bucket_name) and AWS credentials. Idempotent:
files the Lambda already wrote normalized are left alone. Delete the backup prefix only after the
result is confirmed.
"""

import argparse
import sys
from io import BytesIO
from pathlib import Path

import boto3
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from common import config  # noqa: E402
from common.http import map_concurrently  # noqa: E402
from common.text_normalize import normalize_text  # noqa: E402

BACKUP_PREFIX = "_backup_pre_normalization/"
# S3 round trips dominate (28 minutes sequentially for ~3,700 files), so files run in parallel.
WORKERS = 16
# Mirrors transform.NORMALIZED_COLUMNS; kept separate so this script never imports a Lambda module.
COLUMNS = {
    "hackernews": ("title", "text"),
    "news": ("title", "description"),
    "github": ("description",),
}


def backup_key(key: str) -> str:
    """Where the original of `key` is kept: outside every Glue table location (Athena skips it)."""
    return f"{BACKUP_PREFIX}{key}"


def _normalize_value(value):
    """A missing value stays missing: only real strings are normalized."""
    return value if pd.isna(value) else normalize_text(value)


def normalize_frame(df: pd.DataFrame, source: str) -> tuple[pd.DataFrame, int]:
    """Return (a copy with the source's text columns normalized, how many values changed)."""
    result = df.copy()
    changed = 0
    for column in COLUMNS.get(source, ()):
        if column not in result.columns:
            continue
        original = result[column]
        normalized = original.map(_normalize_value)
        changed += int(((normalized != original) & original.notna()).sum())
        result[column] = normalized
    return result, changed


def missing_backups(keys: list[str], backed_up: set[str]) -> list[str]:
    """The curated keys that have no copy under BACKUP_PREFIX yet."""
    return [key for key in keys if backup_key(key) not in backed_up]


def list_backups(s3, bucket: str) -> set[str]:
    backed_up = set()
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=BACKUP_PREFIX):
        backed_up.update(o["Key"] for o in page.get("Contents", []))
    return backed_up


def list_keys(s3, bucket: str, source: str) -> list[str]:
    keys = []
    pages = s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=f"source={source}/")
    for page in pages:
        keys += [o["Key"] for o in page.get("Contents", []) if o["Key"].endswith(".parquet")]
    return keys


def backup(s3, bucket: str, workers: int = WORKERS) -> None:
    """Copy every curated file aside; files that already have a copy are skipped, so a re-run
    only picks up what the Lambda wrote since (new files arrive every 30 minutes)."""
    backed_up = list_backups(s3, bucket)
    for source in COLUMNS:
        todo = missing_backups(list_keys(s3, bucket, source), backed_up)
        map_concurrently(
            lambda key: s3.copy_object(
                Bucket=bucket, Key=backup_key(key), CopySource={"Bucket": bucket, "Key": key}
            ),
            todo,
            workers,
        )
        print(f"{source}: backed up {len(todo)} new files to {BACKUP_PREFIX}")


def _process_file(s3, bucket: str, source: str, key: str, apply: bool) -> int:
    """Normalize one Parquet file (and write it back when `apply`); returns values changed."""
    df = pd.read_parquet(BytesIO(s3.get_object(Bucket=bucket, Key=key)["Body"].read()))
    result, changed = normalize_frame(df, source)
    if changed and apply:
        if len(result) != len(df) or list(result.columns) != list(df.columns):
            raise RuntimeError(f"{key}: row count or columns changed, not writing")
        buffer = BytesIO()
        result.to_parquet(buffer, engine="pyarrow", index=False)
        buffer.seek(0)
        s3.upload_fileobj(buffer, bucket, key)
    return changed


def run(s3, bucket: str, apply: bool, workers: int = WORKERS) -> None:
    keys_by_source = {source: list_keys(s3, bucket, source) for source in COLUMNS}
    if apply:
        # Normalizing is lossy: never overwrite a file whose original was not copied aside first.
        backed_up = list_backups(s3, bucket)
        missing = [k for keys in keys_by_source.values() for k in missing_backups(keys, backed_up)]
        if missing:
            raise RuntimeError(
                f"{len(missing)} curated files have no copy under {BACKUP_PREFIX}; "
                "run the backup command first. Nothing was written."
            )
    for source, keys in keys_by_source.items():
        counts = map_concurrently(
            lambda key: _process_file(s3, bucket, source, key, apply), keys, workers
        )
        verb = "rewrote" if apply else "would rewrite"
        files = sum(1 for c in counts if c)
        print(f"{source}: {verb} {files} files ({sum(counts)} values changed)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("backup", "run"):
        command = sub.add_parser(name)
        command.add_argument("--workers", type=int, default=WORKERS, help="parallel S3 requests")
        if name == "run":
            command.add_argument(
                "--apply", action="store_true", help="write changes (default: dry run)"
            )
    args = parser.parse_args()

    if not config.CURATED_BUCKET:
        sys.exit("Set CURATED_BUCKET first (terraform output -raw curated_bucket_name).")
    s3 = boto3.client("s3")
    if args.command == "backup":
        backup(s3, config.CURATED_BUCKET, args.workers)
    else:
        run(s3, config.CURATED_BUCKET, args.apply, args.workers)


if __name__ == "__main__":
    main()
