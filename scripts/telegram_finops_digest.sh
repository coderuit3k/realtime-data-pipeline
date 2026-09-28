#!/usr/bin/env bash
# Daily FinOps check: compares yesterday's AWS cost against the trailing
# 7-day average (the 7 days before yesterday) and pushes a Telegram alert
# only when yesterday is a real anomaly (>SPIKE_MULTIPLIER x baseline).
# Silent on ordinary days -- this is meant to catch a bug/runaway-loop
# spike, not to be a daily cost report (baseline usage already runs well
# above the project's original ~$1/month target, so an absolute threshold
# would fire constantly and be useless).
set -euo pipefail

TELEGRAM_TARGET="${TELEGRAM_TARGET:?Set TELEGRAM_TARGET to the destination chat id}"
OPENCLAW="${OPENCLAW_BIN:-/home/thanh/.openclaw/bin/openclaw}"
SPIKE_MULTIPLIER="${SPIKE_MULTIPLIER:-1.5}"
MIN_BASELINE_USD="${MIN_BASELINE_USD:-0.10}"  # floor so near-zero baselines don't trigger on noise

START=$(date -u -d "8 days ago" +%Y-%m-%d)
END=$(date -u +%Y-%m-%d)

daily_json=$(aws ce get-cost-and-usage \
  --time-period "Start=${START},End=${END}" \
  --granularity DAILY \
  --metrics UnblendedCost \
  --output json)

read -r yesterday_cost yesterday_date baseline_avg is_spike <<< "$(echo "$daily_json" | python3 -c "
import json, sys
d = json.load(sys.stdin)
results = d['ResultsByTime']
if len(results) < 2:
    print('0 - 0 0')
    raise SystemExit
amounts = [float(r['Total']['UnblendedCost']['Amount']) for r in results]
dates = [r['TimePeriod']['Start'] for r in results]
yesterday_cost = amounts[-1]
yesterday_date = dates[-1]
baseline = amounts[:-1]
baseline_avg = sum(baseline) / len(baseline) if baseline else 0.0
is_spike = 1 if (baseline_avg >= ${MIN_BASELINE_USD} and yesterday_cost > baseline_avg * ${SPIKE_MULTIPLIER}) else 0
print(f'{yesterday_cost:.4f} {yesterday_date} {baseline_avg:.4f} {is_spike}')
")"

if [ "$is_spike" != "1" ]; then
  echo "No spike: yesterday ($yesterday_date) = \$${yesterday_cost}, 7d baseline avg = \$${baseline_avg}. Nothing to send."
  exit 0
fi

breakdown_json=$(aws ce get-cost-and-usage \
  --time-period "Start=${yesterday_date},End=${END}" \
  --granularity DAILY \
  --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --output json)

message=$(echo "$breakdown_json" | YESTERDAY_DATE="$yesterday_date" YESTERDAY_COST="$yesterday_cost" BASELINE_AVG="$baseline_avg" python3 -c "
import json, os, sys
d = json.load(sys.stdin)
groups = d['ResultsByTime'][0]['Groups'] if d['ResultsByTime'] else []
rows = sorted(((g['Keys'][0], float(g['Metrics']['UnblendedCost']['Amount'])) for g in groups), key=lambda x: -x[1])
yesterday_date = os.environ['YESTERDAY_DATE']
yesterday_cost = float(os.environ['YESTERDAY_COST'])
baseline_avg = float(os.environ['BASELINE_AVG'])
lines = [
    f'🚨 FinOps: chi phí AWS hôm qua ({yesterday_date}) tăng đột biến',
    f'  \${yesterday_cost:.2f} — gấp {yesterday_cost / baseline_avg:.1f}x trung bình 7 ngày trước (\${baseline_avg:.2f})',
    '',
    'Breakdown:',
]
for name, amt in rows[:6]:
    if amt > 0.001:
        lines.append(f'  • {name}: \${amt:.2f}')
print('\n'.join(lines))
")

"$OPENCLAW" message send --channel telegram --target "$TELEGRAM_TARGET" --message "$message"
