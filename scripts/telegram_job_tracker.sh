#!/usr/bin/env bash
# Job-application tracker pushed to Telegram: the latest stage per company, from the recruiting
# emails the classifier labelled in the Gmail Athena database. Only emails labelled since the
# labels went live are covered (older rows have NULL labels). Run it from your own machine
# (OpenClaw); it reads the private Gmail database with the caller's AWS credentials.
# Prints nothing when there is no recruiting email.
set -euo pipefail

WORKGROUP="realtime-data-pipeline-dev-analytics"
DATABASE="realtime_data_pipeline_dev_gmail"
TELEGRAM_TARGET="${TELEGRAM_TARGET:?Set TELEGRAM_TARGET to the destination chat id}"
OPENCLAW="${OPENCLAW_BIN:-/home/thanh/.openclaw/bin/openclaw}"

FROM_PART=$(date -u -d "120 days ago" +%Y%m%d)
TO_PART=$(date -u +%Y%m%d)
STALE_BEFORE=$(date -u -d "7 days ago" +%Y-%m-%d)

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

# One row per email, then the newest email per company decides its stage.
jobs_json=$(run_query "
  WITH per_email AS (
    SELECT message_id,
           max(company) AS company,
           max(job_stage) AS job_stage,
           min(received_at) AS received_at
    FROM ${DATABASE}.gmail_messages
    WHERE category = 'recruiting' AND company IS NOT NULL AND company <> ''
      AND concat(year, month, day) BETWEEN '${FROM_PART}' AND '${TO_PART}'
    GROUP BY message_id
  ),
  ranked AS (
    SELECT company, job_stage, received_at,
           ROW_NUMBER() OVER (PARTITION BY lower(company) ORDER BY received_at DESC) AS rn
    FROM per_email
  )
  SELECT company, coalesce(nullif(job_stage, ''), 'unknown') AS stage,
         substr(received_at, 1, 10) AS last_date
  FROM ranked WHERE rn = 1
  ORDER BY last_date DESC")

# The Athena JSON goes in through the environment, not into the Python source (see
# telegram_email_digest.sh).
message=$(JOBS_JSON="$jobs_json" STALE_BEFORE="$STALE_BEFORE" python3 - <<'PY'
import json
import os

rows = json.loads(os.environ['JOBS_JSON'])['ResultSet']['Rows'][1:]
if not rows:
    raise SystemExit(0)


def cell(row, i):
    d = row['Data']
    return d[i].get('VarCharValue', '') if i < len(d) else ''


ORDER = ['offer', 'interview', 'acknowledged', 'applied', 'rejected', 'unknown']
TITLE = {'offer': '🎉 Offer', 'interview': '🗣️ Phỏng vấn', 'acknowledged': '📨 Đã được xác nhận',
         'applied': '📝 Đã nộp', 'rejected': '❌ Từ chối', 'unknown': '❔ Chưa rõ'}
by_stage = {}
for r in rows:
    by_stage.setdefault(cell(r, 1), []).append((cell(r, 0), cell(r, 2)))

lines = ['💼 Theo dõi hồ sơ xin việc']
for stage in ORDER:
    items = by_stage.get(stage)
    if items:
        lines += ['', f'{TITLE[stage]} ({len(items)}):']
        lines += [f'  • {company} — {date}' for company, date in items]

stale_before = os.environ['STALE_BEFORE']
stale = [c for stage in ('applied', 'acknowledged', 'interview')
         for c, d in by_stage.get(stage, []) if d < stale_before]
if stale:
    lines += ['', '⏳ Chưa có tin mới trên 7 ngày: ' + ', '.join(stale)]

print('\n'.join(lines))
PY
)

if [ -z "$message" ]; then
  echo "No recruiting emails found -- nothing to send."
  exit 0
fi

"$OPENCLAW" message send --channel telegram --target "$TELEGRAM_TARGET" --message "$message"
