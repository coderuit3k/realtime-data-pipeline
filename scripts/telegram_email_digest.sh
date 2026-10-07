#!/usr/bin/env bash
# Daily email digest pushed to Telegram: how many emails arrived, which need a reply, upcoming
# deadlines and urgent mail, from the classifier labels in the Gmail Athena database.
# Reads the private Gmail database with the caller's AWS credentials, so run it from your own
# machine (OpenClaw), never from the public web app. Prints nothing when there is no labelled mail.
set -euo pipefail

WORKGROUP="realtime-data-pipeline-dev-analytics"
DATABASE="realtime_data_pipeline_dev_gmail"
TELEGRAM_TARGET="${TELEGRAM_TARGET:?Set TELEGRAM_TARGET to the destination chat id}"
OPENCLAW="${OPENCLAW_BIN:-/home/thanh/.openclaw/bin/openclaw}"

TODAY=$(date -u +%Y-%m-%d)
YDAY=$(date -u -d "1 day ago" +%Y-%m-%d)
IN7=$(date -u -d "7 days" +%Y-%m-%d)
# Partitions are by ingestion day; look back a week so every email received recently is covered.
FROM_PART=$(date -u -d "7 days ago" +%Y%m%d)
# A deadline can sit in an email received weeks ago (its partition is old), so that query looks
# back further than the others.
DEADLINE_FROM_PART=$(date -u -d "60 days ago" +%Y%m%d)
TO_PART=$(date -u +%Y%m%d)

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

# One row per email: ingestion re-reads the newest emails every run, so the same message sits in
# many rows. Labels are the same on every row of a message (they are cached by message_id).
per_email_cte() {
  local from_part="$1"
  cat <<SQL
WITH per_email AS (
  SELECT message_id,
         max(from_address) AS sender,
         max(subject) AS subject,
         max(category) AS category,
         max(urgency) AS urgency,
         bool_or(needs_reply) AS needs_reply,
         max(deadline) AS deadline,
         min(received_at) AS received_at
  FROM ${DATABASE}.gmail_messages
  WHERE concat(year, month, day) BETWEEN '${from_part}' AND '${TO_PART}'
  GROUP BY message_id
)
SQL
}

counts_json=$(run_query "$(per_email_cte "${FROM_PART}")
  SELECT substr(received_at, 1, 10) AS day, coalesce(category, 'unclassified') AS category,
         count(*) AS n
  FROM per_email
  WHERE substr(received_at, 1, 10) IN ('${TODAY}', '${YDAY}')
  GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC")

reply_json=$(run_query "$(per_email_cte "${FROM_PART}")
  SELECT sender, subject, substr(received_at, 1, 10) AS day
  FROM per_email
  WHERE needs_reply AND substr(received_at, 1, 10) >= '${YDAY}'
  ORDER BY received_at DESC LIMIT 8")

deadline_json=$(run_query "$(per_email_cte "${DEADLINE_FROM_PART}")
  SELECT subject, deadline
  FROM per_email
  WHERE deadline IS NOT NULL AND deadline <> ''
    AND deadline BETWEEN '${TODAY}' AND '${IN7}'
  ORDER BY deadline LIMIT 8")

urgent_json=$(run_query "$(per_email_cte "${FROM_PART}")
  SELECT sender, subject
  FROM per_email
  WHERE urgency = 'high' AND substr(received_at, 1, 10) >= '${YDAY}'
  ORDER BY received_at DESC LIMIT 5")

# The Athena JSON goes in through the environment, not into the Python source: subjects are
# untrusted text and a quote or backslash in one must not be able to break the program.
message=$(TODAY="$TODAY" YDAY="$YDAY" COUNTS_JSON="$counts_json" REPLY_JSON="$reply_json" \
  DEADLINE_JSON="$deadline_json" URGENT_JSON="$urgent_json" python3 - <<'PY'
import json
import os


def rows_of(name):
    return json.loads(os.environ[name])['ResultSet']['Rows'][1:]


def cell(row, i, default=''):
    d = row['Data']
    return d[i].get('VarCharValue', default) if i < len(d) else default


def short(text, n=70):
    text = ' '.join(text.split())
    return text if len(text) <= n else text[: n - 1] + '…'


counts = rows_of('COUNTS_JSON')
if sum(int(cell(r, 2, '0')) for r in counts) == 0:
    raise SystemExit(0)

lines = ['📬 Email digest', '']
for day, label in ((os.environ['TODAY'], 'Hôm nay'), (os.environ['YDAY'], 'Hôm qua')):
    day_rows = [r for r in counts if cell(r, 0) == day]
    n = sum(int(cell(r, 2, '0')) for r in day_rows)
    detail = ', '.join(f'{cell(r, 1)} {cell(r, 2)}' for r in day_rows)
    lines.append(f'{label}: {n} email' + (f' ({detail})' if detail else ''))

reply = rows_of('REPLY_JSON')
if reply:
    lines += ['', '↩️ Cần trả lời:']
    lines += [f'  • {short(cell(r, 0), 30)} — {short(cell(r, 1))}' for r in reply]

deadlines = rows_of('DEADLINE_JSON')
if deadlines:
    lines += ['', '⏰ Hạn chót trong 7 ngày:']
    lines += [f'  • {cell(r, 1)} — {short(cell(r, 0))}' for r in deadlines]

urgent = rows_of('URGENT_JSON')
if urgent:
    lines += ['', '🔥 Khẩn:']
    lines += [f'  • {short(cell(r, 0), 30)} — {short(cell(r, 1))}' for r in urgent]

print('\n'.join(lines))
PY
)

if [ -z "$message" ]; then
  echo "No labelled emails today or yesterday -- nothing to send."
  exit 0
fi

"$OPENCLAW" message send --channel telegram --target "$TELEGRAM_TARGET" --message "$message"
