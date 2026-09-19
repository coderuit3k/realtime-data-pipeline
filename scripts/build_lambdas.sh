#!/usr/bin/env bash
# Stages the deployment package for each Lambda under infra/build/<name>/,
# which infra/lambda.tf then zips via `archive_file`. Run this before
# `terraform apply` (and again whenever ingestion/transform/common code changes).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/infra/build"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# boto3 ships with the Lambda runtime already; only third-party deps are packaged.
package_with_requests() {
  local target_name="$1"
  local source_file="$2"
  local target="$BUILD_DIR/$target_name"
  mkdir -p "$target"
  pip install --quiet --platform manylinux2014_x86_64 --python-version 3.12 \
    --only-binary=:all: --target "$target" requests==2.32.3
  cp -r "$ROOT_DIR/common" "$target/common"
  cp "$ROOT_DIR/$source_file" "$target/"
}

# No pip installs: pandas/pyarrow/numpy/boto3 all come from the AWS SDK for
# pandas Lambda layer (see variables.tf) -- too large to ship in a plain zip,
# and numpy in particular needs a platform-matched wheel the layer already has.
package_no_deps() {
  local target_name="$1"
  local source_file="$2"
  local target="$BUILD_DIR/$target_name"
  mkdir -p "$target"
  cp -r "$ROOT_DIR/common" "$target/common"
  cp "$ROOT_DIR/$source_file" "$target/"
}

package_with_requests hackernews_ingestion ingestion/hackernews_ingestion.py
package_with_requests news_ingestion ingestion/news_ingestion.py
package_with_requests weather_ingestion ingestion/weather_ingestion.py
package_with_requests crypto_ingestion ingestion/crypto_ingestion.py
package_with_requests github_trending_ingestion ingestion/github_trending_ingestion.py
package_no_deps transform transform/transform.py
package_no_deps rag_build_index rag/build_index.py
# rag_query needs `requests` too now (Tavily web search fallback for CRAG).
package_with_requests rag_query rag/query.py
package_with_requests rag_agent rag/agent.py

echo "Lambda build artifacts ready under $BUILD_DIR"
