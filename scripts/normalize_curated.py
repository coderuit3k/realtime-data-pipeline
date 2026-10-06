"""One-off: rewrite the curated Parquet history with normalized text.

    python scripts/normalize_curated.py                # dry run: counts only
    python scripts/normalize_curated.py --apply        # overwrite in place

Needs CURATED_BUCKET (terraform output -raw curated_bucket_name) and AWS credentials. Idempotent:
files the Lambda already wrote normalized are left alone. Normalizing is lossy, so keep a copy of
the curated bucket first if the originals still matter.
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

# S3 round trips dominate (28 minutes sequentially for ~3,700 files), so files run in parallel.
WORKERS = 16
# Mirrors transform.NORMALIZED_COLUMNS; kept separate so this script never imports a Lambda module.
COLUMNS = {
    "hackernews": ("title", "text"),
    "news": ("title", "description"),
    "github": ("description",),
}


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


def list_keys(s3, bucket: str, source: str) -> list[str]:
    keys = []
    pages = s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=f"source={source}/")
    for page in pages:
        keys += [o["Key"] for o in page.get("Contents", []) if o["Key"].endswith(".parquet")]
    return keys


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
    for source, keys in keys_by_source.items():
        counts = map_concurrently(
            lambda key: _process_file(s3, bucket, source, key, apply), keys, workers
        )
        verb = "rewrote" if apply else "would rewrite"
        files = sum(1 for c in counts if c)
        print(f"{source}: {verb} {files} files ({sum(counts)} values changed)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--workers", type=int, default=WORKERS, help="parallel S3 requests")
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    args = parser.parse_args()

    if not config.CURATED_BUCKET:
        sys.exit("Set CURATED_BUCKET first (terraform output -raw curated_bucket_name).")
    run(boto3.client("s3"), config.CURATED_BUCKET, args.apply, args.workers)


if __name__ == "__main__":
    main()
