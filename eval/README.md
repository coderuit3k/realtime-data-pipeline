# RAGAS evaluation

Offline evaluation of the `rag_agent` pipeline (the Bedrock Converse
tool-calling agent) with [RAGAS](https://github.com/explodinggradients/ragas)
metrics, judged by Bedrock (Claude Haiku + Titan Embed) instead of OpenAI.

**Dev-only, never deployed to Lambda.** `ragas` pulls in `langchain` and
several provider packages, which are far too heavy for a Lambda zip.

## Setup

`requirements-eval.txt` pins the exact combination verified end to end:
`ragas==0.4.3` with its matching `langchain-*` generation. Do **not** install
it in one shot — `requirements.txt` pins `boto3==1.36.1` while
`langchain-aws==0.2.35` requires `boto3>=1.39.7`, so a single-file install
fails with `ResolutionImpossible`. Install in two steps and let pip upgrade
boto3 (harmless: eval never deploys):

```bash
pip install -r requirements-dev.txt
pip install "ragas==0.4.3" "langchain-core==0.3.86" "langchain-community==0.3.27" "langchain-openai==0.3.35" "langchain-aws==0.2.35"
```

## Run

```bash
python eval/run_ragas.py
```

To run with query expansion enabled:

```bash
RAG_QUERY_EXPANSION=true python eval/run_ragas.py
```

The variable must actually reach the Python process: write it as a prefix on
the same command (as above) or `export RAG_QUERY_EXPANSION=true` first. The
chained form `RAG_QUERY_EXPANSION=true && python eval/run_ragas.py` silently
does nothing -- the shell sets a variable it never exports, so the eval runs
with expansion off and the scores look like a baseline. (The 2026-10-20
control run below was produced exactly this way and only recognised as a
control after the command lines were compared.)

For each question it runs the real agent (imported from
`rag/agent.py`, not a mock) and scores the question / answer / retrieved
context with:

- **Faithfulness**: does the answer avoid claims the retrieved context doesn't support?
- **Response relevancy**: does the answer address the question?
- **Context precision**: how much of what was retrieved was relevant?

Scores print to the terminal and are written per question to
`eval/results.csv` (gitignored, it is a run artifact). Besides the scores it has a
`grounded` column and a `tool_calls` column (JSON: each tool the agent ran, its input,
how many sources it returned and whether it failed).

The retrieved contexts the judge sees are the cited passages **plus the rows that
`query_athena`, `get_crypto_prices` and `get_weather` returned** (capped at 6,000
characters each). Those tools return rows, not passages, so before this the judge had no
evidence for an answer built from them and scored its faithfulness low. Runs from before
that change are not comparable with later ones.

## Reading the results

`questions.json` has 100 questions, each with a `category` (only `question` is read by
the script):

| category | count | what it checks |
|---|---|---|
| `kb` | 30 | topics from Hacker News and the news (semantic search + rerank) |
| `athena` | 18 | counts, averages, rankings and time windows over the curated tables |
| `weather` | 8 | the 12 Southern Vietnam locations (current and a 3-day average) |
| `crypto` | 7 | Bitcoin, Ethereum, Solana (and Dogecoin, which has no tool) |
| `cross` | 8 | questions that need more than one source |
| `vi` | 8 | Vietnamese questions of the kinds above |
| `ood` | 12 | out of domain: a recipe, a sports result, other cities and coins (web fallback) |
| `edge` | 9 | private mail (no tool), destructive SQL, prompt injection, vague or made-up topics |

The agent picks a tool, or none, from the tool descriptions alone and falls back to
`search_web` (Tavily). A healthy run has high faithfulness and relevancy on both kinds, and
`grounded: true` on almost every question, because the web fallback means there is nearly
always something to cite. The `edge` questions are expected to be refused or answered with
"I can't": judge them by reading the answers, not by the scores.

### Comparing runs: the query-expansion A/B

Only compare runs of the **same code** where the flag is the only difference.
Rows in the history table from different days are not comparable with each
other: the code changed between them and the corpus grows every day, so both
the retrieved evidence and the judge's inputs drift.

The clean comparison (100 questions, identical code -- including the
`<retrieved_document>` injection guardrail -- in both arms):

| run | faithfulness | answer relevancy | context precision |
|---|---|---|---|
| expansion OFF, 2026-10-20 (control) | 0.6016 | 0.6758 | 0.5680 |
| expansion ON, 2026-10-19 | 0.6572 | 0.6927 | 0.6132 |
| expansion ON, 2026-10-20 | 0.6300 | 0.6988 | 0.5572 |

- **Faithfulness**: higher in both ON runs (+0.056, +0.028) -- a consistent gain.
- **Answer relevancy**: higher in both ON runs (+0.017, +0.023) -- small, consistent.
- **Context precision**: inconclusive. The two ON runs differ from each other
  by 0.056, more than either ON-OFF gap, and one ON run scores *below* the
  control. At n=100 the LLM judge's run-to-run variance is larger than the
  effect, so no precision claim either way. Resolving it would take several
  replicate runs at ~2 hours each; the keep/drop call was made on faithfulness
  instead.

Verdict: expansion earns its cost (one extra LLM call plus one embedding and
search per variant on every `search_knowledge_base` call) through
faithfulness. Do not expect a context-precision improvement from it.

## Evaluation

| timestamp | added | faithfulness | answer relevancy | context precision | finished_time |
|---|---|---|---|---|---|
| `13-10-2026` | `recency boost` and `sources/days_back` filters to `search_knowledge_base` | 0.5852 | 0.6699 | 0.5944 | 52 mins |
| `14-10-2026` | `guard the SQL injection`, `use few shot examples for each tool` and `adjust system prompt` | 0.5977 | 0.6592 | 0.6017 | 49 mins |
| `14-10-2026` | `increase timeout for web_search from 10 to 60`, `fix another errors from query_athena` | 0.6407 | 0.6950 | 0.6225 | 53 mins |
| `19-10-2026` | `query expansion` ON, run 1 (same code as the 20-10 control) | 0.6572 | 0.6927 | 0.6132 | - |
| `20-10-2026` | control for the expansion A/B: same code, expansion OFF | 0.6016 | 0.6758 | 0.5680 | - |
| `20-10-2026` | `query expansion` ON, run 2 | 0.6300 | 0.6988 | 0.5572 | - |

Set `ATHENA_WORKGROUP`, `ATHENA_DATABASE` and `CURATED_BUCKET` before running
(the bucket comes from `aws lambda get-function-configuration --function-name
realtime-data-pipeline-dev-rag-build-index --query 'Environment.Variables.CURATED_BUCKET'
--output text`; the other two are in the real-agent command in the root `CLAUDE.md`).
Without the Athena pair every `query_athena` call fails and the agent has to work around
it; without the bucket the crypto and weather tools crash the run. The script stops at
once if any is empty.

**Cost and time:** each metric makes several Bedrock calls per question
(faithfulness splits the answer into statements and checks each). The full 100
questions took about 2 hours end to end (52 minutes for the scoring step alone),
plus the Bedrock and Tavily calls. Don't run it on every commit. Runs with
query expansion on cost noticeably more on the agent side (one extra LLM call
plus one embedding and search per variant for every `search_knowledge_base`
call) and take longer for the same reason.

## Why `RunConfig(max_workers=2)`

With ragas's default of 16 workers, 11 of 18 jobs hit `TimeoutError`: Bedrock
on-demand throttles concurrent calls, and ragas's retries ran past its own
timeout. 2 workers and a 300 s timeout fixed it on the same 6 questions.
