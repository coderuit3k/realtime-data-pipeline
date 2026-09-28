#!/usr/bin/env bash
# Daily "all-in-one" brief pushed to Telegram: latest weather per tracked
# location, latest BTC/ETH/SOL price + 24h change, and today's top 3 GitHub
# trending repos by stars. Reuses already-ingested curated-zone data --
# no extra calls to Open-Meteo/CoinGecko/GitHub.
set -euo pipefail

WORKGROUP="realtime-data-pipeline-dev-analytics"
DATABASE="realtime_data_pipeline_dev_curated"
TELEGRAM_TARGET="${TELEGRAM_TARGET:?Set TELEGRAM_TARGET to the destination chat id}"
OPENCLAW="${OPENCLAW_BIN:-/home/thanh/.openclaw/bin/openclaw}"

# Look at today's + yesterday's UTC partitions so the query never comes up
# empty right after the UTC day rolls over (ingestion runs every 30min, not
# aligned to :00).
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

weather_json=$(run_query "
  WITH latest AS (
    SELECT location, temperature_c, precipitation_mm,
           ROW_NUMBER() OVER (PARTITION BY location ORDER BY observed_at DESC) AS rn
    FROM ${DATABASE}.weather_observations
    WHERE ${PARTITION_FILTER}
  )
  SELECT location, temperature_c, precipitation_mm FROM latest WHERE rn = 1 ORDER BY location
")

crypto_json=$(run_query "
  WITH latest AS (
    SELECT coin_id, price_usd, change_24h_pct,
           ROW_NUMBER() OVER (PARTITION BY coin_id ORDER BY observed_at DESC) AS rn
    FROM ${DATABASE}.crypto_prices
    WHERE ${PARTITION_FILTER}
  )
  SELECT coin_id, price_usd, change_24h_pct FROM latest WHERE rn = 1 ORDER BY coin_id
")

github_json=$(run_query "
  WITH latest AS (
    SELECT full_name, stars, language,
           ROW_NUMBER() OVER (PARTITION BY full_name ORDER BY ingested_at DESC) AS rn
    FROM ${DATABASE}.github_repos
    WHERE ${PARTITION_FILTER}
  )
  SELECT full_name, stars, language FROM latest WHERE rn = 1 ORDER BY stars DESC LIMIT 3
")

message=$(python3 -c "
import json

def rows_of(raw):
    data = json.loads(raw)
    return data['ResultSet']['Rows'][1:]

def cell(row, i, default='0'):
    d = row['Data']
    return d[i].get('VarCharValue', default) if i < len(d) else default

lines = ['🌅 Daily Brief']

w_rows = rows_of('''$weather_json''')
if w_rows:
    lines.append('')
    lines.append('☁️ Thời tiết:')
    for r in w_rows:
        loc, temp, precip = cell(r, 0, '?'), cell(r, 1, '?'), cell(r, 2, '0')
        try:
            temp_s = f'{float(temp):.0f}°C'
        except ValueError:
            temp_s = f'{temp}°C'
        rain = f', mưa {float(precip):.1f}mm' if precip and float(precip) > 0 else ''
        lines.append(f'  • {loc}: {temp_s}{rain}')

c_rows = rows_of('''$crypto_json''')
if c_rows:
    lines.append('')
    lines.append('💰 Crypto:')
    label = {'bitcoin': 'BTC', 'ethereum': 'ETH', 'solana': 'SOL'}
    for r in c_rows:
        coin, price, chg = cell(r, 0, '?'), cell(r, 1, '0'), cell(r, 2, '0')
        try:
            price_s = f'\${float(price):,.2f}'
            chg_f = float(chg)
            chg_s = f'{chg_f:+.2f}%'
        except ValueError:
            price_s, chg_s = price, chg
        lines.append(f'  • {label.get(coin, coin)}: {price_s} ({chg_s} 24h)')

g_rows = rows_of('''$github_json''')
if g_rows:
    lines.append('')
    lines.append('⭐ Top GitHub trending:')
    for r in g_rows:
        name, stars, lang = cell(r, 0, '?'), cell(r, 1, '0'), cell(r, 2, '')
        lang_s = f' ({lang})' if lang else ''
        lines.append(f'  • {name}{lang_s} — {stars}⭐')

if len(lines) == 1:
    exit(0)
print('\n'.join(lines))
")

if [ -z "$message" ]; then
  echo "No fresh data in either partition window -- nothing to send."
  exit 0
fi

"$OPENCLAW" message send --channel telegram --target "$TELEGRAM_TARGET" --message "$message"
