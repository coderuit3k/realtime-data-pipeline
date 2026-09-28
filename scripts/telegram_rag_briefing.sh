#!/usr/bin/env bash
# End-of-day agentic RAG briefing: invokes the deployed rag_agent Lambda with
# a fixed analytical question, then pushes the answer + cited sources to
# Telegram. Cost note: each run is a normal rag_agent invocation (same
# Bedrock Claude Haiku call path the FinOps digest already tracks, bounded
# by MAX_ITERATIONS=6) -- scheduled once/day, not more often.
set -euo pipefail

FUNCTION_NAME="realtime-data-pipeline-dev-rag-agent"
QUESTION="${RAG_BRIEFING_QUESTION:-Tóm tắt những xu hướng/chủ đề công nghệ nổi bật nhất hôm nay dựa trên Hacker News và tin tức đã thu thập.}"
TELEGRAM_TARGET="${TELEGRAM_TARGET:?Set TELEGRAM_TARGET to the destination chat id}"
OPENCLAW="${OPENCLAW_BIN:-/home/thanh/.openclaw/bin/openclaw}"

TMP_OUT=$(mktemp)
trap 'rm -f "$TMP_OUT"' EXIT

payload=$(python3 -c "import json,sys; print(json.dumps({'question': sys.argv[1]}))" "$QUESTION")

aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --cli-binary-format raw-in-base64-out \
  --payload "$payload" \
  "$TMP_OUT" > /dev/null

message=$(python3 -c "
import json
with open('$TMP_OUT') as f:
    result = json.load(f)

if result.get('statusCode') != 200:
    print(f\"RAG briefing lỗi: {result.get('error', result)}\", file=__import__('sys').stderr)
    raise SystemExit(1)

answer = result.get('answer', '').strip()
sources = result.get('sources', [])

lines = ['🧠 RAG Briefing cuối ngày', '', answer]
if sources:
    lines.append('')
    lines.append('Nguồn:')
    seen = set()
    for s in sources:
        url = s.get('url', '')
        if not url or url in seen:
            continue
        seen.add(url)
        title = s.get('title') or url
        lines.append(f'• {title} — {url}')
print('\n'.join(lines))
")

"$OPENCLAW" message send --channel telegram --target "$TELEGRAM_TARGET" --message "$message"
