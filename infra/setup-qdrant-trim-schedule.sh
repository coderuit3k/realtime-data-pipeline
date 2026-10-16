#!/usr/bin/env bash
# One-time setup: weekly Qdrant trim via EventBridge -> rag-build-index Lambda.
# Datapulse-rag sliding window (WINDOW_DAYS in common/qdrant_trim.py).
#
# Run once from the repo root:
#   bash infra/setup-qdrant-trim-schedule.sh
#
# Prerequisites before running:
#   1. common/qdrant_trim.py is included in the Lambda package
#   2. Handler has the dispatch branch: event.get("task") == "qdrant_trim"
#   3. Lambda has been redeployed with the new code
set -euo pipefail

REGION=$(aws configure get region)
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
FN=realtime-data-pipeline-dev-rag-build-index

aws events put-rule --name qdrant-weekly-trim \
  --schedule-expression "cron(0 2 ? * SUN *)" --state ENABLED

aws lambda add-permission --function-name "$FN" \
  --statement-id qdrant-trim-schedule \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:$REGION:$ACCOUNT:rule/qdrant-weekly-trim"

aws events put-targets --rule qdrant-weekly-trim --targets \
  "Id=1,Arn=arn:aws:lambda:$REGION:$ACCOUNT:function:$FN,Input={\"task\":\"qdrant_trim\"}"

echo "--- verify ---"
aws events list-targets-by-rule --rule qdrant-weekly-trim \
  --query "Targets[].Arn" --output text
