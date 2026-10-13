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

Check with `pip show ragas` — it must report `0.4.3`.

Import the metrics old-style (`from ragas.metrics import ...`). Version 0.4.3
also ships `ragas.metrics.collections`, but those classes require a modern
`InstructorLLM` and reject the `LangchainLLMWrapper` this script uses —
importing `Faithfulness` from `collections` crashes the scoring step.

## Run

```bash
python eval/run_ragas.py
```

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

To run a subset — e.g. the 30 `kb` questions for a before/after comparison of a
retrieval change — point `load_questions` at a filtered copy such as
`eval/questions_kb.json`. Never reorder or edit the questions: subsets stay
comparable only if the questions are byte-identical.

The agent picks a tool, or none, from the tool descriptions alone and falls back to
`search_web` (Tavily). A healthy run has high faithfulness and relevancy on both kinds, and
`grounded: true` on almost every question, because the web fallback means there is nearly
always something to cite. The `edge` questions are expected to be refused or answered with
"I can't": judge them by reading the answers, not by the scores.

**Latest run (2026-10-13, 100 questions, AFTER adding recency boost and the
`sources`/`days_back` filters to `search_knowledge_base`):** faithfulness 0.5852,
answer relevancy 0.6699, context precision 0.5944 (300 scoring jobs, ~52 min for
scoring alone). The BEFORE run on the same 100 questions is still pending. Expect
the same ballpark, not identical values: the judge LLM and the agent's tool choices
both vary between runs. (This run predates the `sql_guard` column/dialect checks
added later the same day.)

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
plus the Bedrock and Tavily calls. Don't run it on every commit.

## Why `RunConfig(max_workers=2)`

With ragas's default of 16 workers, 11 of 18 jobs hit `TimeoutError`: Bedrock
on-demand throttles concurrent calls, and ragas's retries ran past its own
timeout. 2 workers and a 300 s timeout fixed it on the same 6 questions.
