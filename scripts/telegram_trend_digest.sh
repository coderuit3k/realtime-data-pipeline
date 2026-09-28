#!/usr/bin/env bash
# Queries the latest trend_events partition in Athena and pushes a digest to
# Telegram via the OpenClaw CLI. Silent (no message sent) when there are no
# trend events yet for the latest scanned day -- avoids daily noise on days
# trend_scan found nothing crossing the keyword thresholds.
set -euo pipefail

WORKGROUP="realtime-data-pipeline-dev-analytics"
DATABASE="realtime_data_pipeline_dev_curated"
TELEGRAM_TARGET="${TELEGRAM_TARGET:?Set TELEGRAM_TARGET to the destination chat id}"
OPENCLAW="${OPENCLAW_BIN:-/home/thanh/.openclaw/bin/openclaw}"

run_query() {
  local sql="$1"
  local qid
  qid=$(aws athena start-query-execution \
    --query-string "$sql" \
    --work-group "$WORKGROUP" \
    --query-execution-context "Database=$DATABASE" \
    --query 'QueryExecutionId' --output text)

  local state
  for _ in $(seq 1 30); do
    state=$(aws athena get-query-execution --query-execution-id "$qid" \
      --query 'QueryExecution.Status.State' --output text)
    case "$state" in
      SUCCEEDED) break ;;
      FAILED|CANCELLED)
        echo "Athena query failed ($state): $sql" >&2
        aws athena get-query-execution --query-execution-id "$qid" \
          --query 'QueryExecution.Status.StateChangeReason' --output text >&2
        exit 1
        ;;
      *) sleep 2 ;;
    esac
  done
  if [ "$state" != "SUCCEEDED" ]; then
    echo "Athena query timed out: $sql" >&2
    exit 1
  fi
  aws athena get-query-results --query-execution-id "$qid" --output json
}

# 1. Find the most recent scanned day (avoids assuming an exact schedule offset).
latest_json=$(run_query "SELECT max(event_date) AS d FROM ${DATABASE}.trend_events")
latest_date=$(echo "$latest_json" | python3 -c "
import json, sys
rows = json.load(sys.stdin)['ResultSet']['Rows']
print(rows[1]['Data'][0].get('VarCharValue', '') if len(rows) > 1 else '')
")

if [ -z "$latest_date" ]; then
  echo "No trend_events found yet -- nothing to send."
  exit 0
fi

# 2. Pull that day's qualifying keywords, ranked by total cross-source mentions.
events_json=$(run_query "
  SELECT keyword, github_count, hn_count, news_count
  FROM ${DATABASE}.trend_events
  WHERE event_date = '${latest_date}'
  ORDER BY (github_count + hn_count + news_count) DESC
")

message=$(echo "$events_json" | python3 -c "
import json, sys
data = json.load(sys.stdin)
rows = data['ResultSet']['Rows'][1:]  # skip header row
if not rows:
    sys.exit(0)
lines = [f'📈 Trend Digest — {\"$latest_date\"}']
for r in rows:
    vals = [c.get('VarCharValue', '0') for c in r['Data']]
    keyword, gh, hn, news = vals[0], vals[1], vals[2], vals[3]
    lines.append(f'• {keyword} — GitHub {gh} · HN {hn} · News {news}')
print('\n'.join(lines))
")

if [ -z "$message" ]; then
  echo "Latest day ($latest_date) has zero qualifying trend events -- nothing to send."
  exit 0
fi

"$OPENCLAW" message send --channel telegram --target "$TELEGRAM_TARGET" --message "$message"
