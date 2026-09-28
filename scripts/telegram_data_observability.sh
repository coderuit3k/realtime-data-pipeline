#!/usr/bin/env bash
# Daily data-observability check, complementary to the existing
# transform-data-quality CloudWatch alarm (which only compares raw vs
# cleaned record COUNTS per Lambda batch). This checks:
#   1. Abnormally high NULL/empty rate on a key field per source table.
#   2. Any of the 12 tracked weather locations missing from today's data
#      (a silent per-location API failure wouldn't otherwise be visible).
# Silent when nothing is wrong.
set -euo pipefail

WORKGROUP="realtime-data-pipeline-dev-analytics"
DATABASE="realtime_data_pipeline_dev_curated"
TELEGRAM_TARGET="${TELEGRAM_TARGET:?Set TELEGRAM_TARGET to the destination chat id}"
OPENCLAW="${OPENCLAW_BIN:-/home/thanh/.openclaw/bin/openclaw}"
NULL_RATE_THRESHOLD="${NULL_RATE_THRESHOLD:-0.2}"

# Must match common/config.py WEATHER_LOCATIONS exactly.
EXPECTED_LOCATIONS="Tay Ninh,Ho Chi Minh City,Thu Dau Mot (Binh Duong),Long Xuyen (An Giang),Bien Hoa (Dong Nai),Can Tho,My Tho (Tien Giang),Soc Trang,Vung Tau,Rach Gia (Kien Giang),Ca Mau,Da Lat"

TODAY_Y=$(date -u +%Y); TODAY_M=$(date -u +%m); TODAY_D=$(date -u +%d)
YDAY_Y=$(date -u -d "1 day ago" +%Y); YDAY_M=$(date -u -d "1 day ago" +%m); YDAY_D=$(date -u -d "1 day ago" +%d)
PARTITION_FILTER="((year='${TODAY_Y}' AND month='${TODAY_M}' AND day='${TODAY_D}') OR (year='${YDAY_Y}' AND month='${YDAY_M}' AND day='${YDAY_D}'))"

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

null_rate_json=$(run_query "
  SELECT 'hackernews_stories' AS tbl, COUNT(*) AS total,
         SUM(CASE WHEN title IS NULL OR title = '' THEN 1 ELSE 0 END) AS nulls
  FROM ${DATABASE}.hackernews_stories WHERE ${PARTITION_FILTER}
  UNION ALL
  SELECT 'news_articles', COUNT(*),
         SUM(CASE WHEN title IS NULL OR title = '' THEN 1 ELSE 0 END)
  FROM ${DATABASE}.news_articles WHERE ${PARTITION_FILTER}
  UNION ALL
  SELECT 'weather_observations', COUNT(*),
         SUM(CASE WHEN temperature_c IS NULL THEN 1 ELSE 0 END)
  FROM ${DATABASE}.weather_observations WHERE ${PARTITION_FILTER}
  UNION ALL
  SELECT 'crypto_prices', COUNT(*),
         SUM(CASE WHEN price_usd IS NULL THEN 1 ELSE 0 END)
  FROM ${DATABASE}.crypto_prices WHERE ${PARTITION_FILTER}
  UNION ALL
  SELECT 'github_repos', COUNT(*),
         SUM(CASE WHEN full_name IS NULL OR full_name = '' THEN 1 ELSE 0 END)
  FROM ${DATABASE}.github_repos WHERE ${PARTITION_FILTER}
")

locations_json=$(run_query "
  SELECT DISTINCT location FROM ${DATABASE}.weather_observations WHERE ${PARTITION_FILTER}
")

message=$(python3 -c "
import json, os

def rows_of(raw):
    return json.loads(raw)['ResultSet']['Rows'][1:]

issues = []

for r in rows_of('''$null_rate_json'''):
    d = r['Data']
    tbl = d[0].get('VarCharValue', '?')
    total = int(d[1].get('VarCharValue', '0') or 0)
    nulls = int(d[2].get('VarCharValue', '0') or 0)
    if total == 0:
        issues.append(f'⚠️ {tbl}: KHÔNG có dữ liệu nào trong 24h qua')
    else:
        rate = nulls / total
        if rate > ${NULL_RATE_THRESHOLD}:
            issues.append(f'⚠️ {tbl}: {nulls}/{total} record thiếu field quan trọng ({rate:.0%})')

expected = set('${EXPECTED_LOCATIONS}'.split(','))
seen = {r['Data'][0].get('VarCharValue', '') for r in rows_of('''$locations_json''')}
missing = expected - seen
if missing:
    issues.append('⚠️ Thiếu dữ liệu thời tiết từ: ' + ', '.join(sorted(missing)))

if not issues:
    raise SystemExit(0)

lines = ['🔍 Data Observability — phát hiện bất thường', ''] + issues
print('\n'.join(lines))
")

if [ -z "$message" ]; then
  echo "No data-quality anomalies found. Nothing to send."
  exit 0
fi

"$OPENCLAW" message send --channel telegram --target "$TELEGRAM_TARGET" --message "$message"
