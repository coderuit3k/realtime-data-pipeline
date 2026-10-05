# RAGAS evaluation

Offline evaluation of the `rag_agent` pipeline (the Bedrock Converse
tool-calling agent) with [RAGAS](https://github.com/explodinggraphs/ragas)
metrics, judged by Bedrock (Claude Haiku + Titan Embed) instead of OpenAI.

**Dev-only, never deployed to Lambda.** `ragas` pulls in `langchain` and
several provider packages, which are far too heavy for a Lambda zip.

## Setup

```bash
pip install -r requirements-eval.txt
```

Keep the pins in `requirements-eval.txt`. `ragas==0.4.3` imports
`langchain_community` / `langchain_openai` internals that were removed in
later releases, so installing `ragas` and `langchain-aws` at their latest
versions fails with import errors. This exact combination is the one verified
end to end.

## Run

```bash
python eval/run_ragas.py
```

For each question in `questions.json` it runs the real agent (imported from
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

`questions.json` mixes in-domain questions with out-of-domain ones (a recipe,
a sports result, the weather in Paris, since `get_weather` only covers the
Vietnamese locations the pipeline ingests). The agent picks a tool, or none,
from the tool descriptions alone and falls back to `search_web` (Tavily). A
healthy run has high faithfulness and relevancy on both kinds, and
`grounded: true` on almost every question, because the web fallback means
there is nearly always something to cite.

**Latest run (2026-10-05, 12 questions):** faithfulness 0.6457, answer relevancy
0.7105, context precision 0.4083. Expect the same ballpark, not identical
values: the judge LLM and the agent's tool choices both vary, and two runs of the
same code differed by about 0.18 in faithfulness.

Set `ATHENA_WORKGROUP`, `ATHENA_DATABASE` and `CURATED_BUCKET` before running
(`terraform output -raw curated_bucket_name` gives the bucket; the other two are in
the real-agent command in the root `CLAUDE.md`). Without the Athena pair every
`query_athena` call fails and the agent has to work around it; without the bucket the
crypto and weather tools crash the run. The script now stops at once if any is empty.

**Cost and time:** each metric makes several Bedrock calls per question
(faithfulness splits the answer into statements and checks each). Budget about
10 minutes and a few cents for the default 6 questions. Keep the set small and
don't run it on every commit.

## Why `RunConfig(max_workers=2)`

With ragas's default of 16 workers, 11 of 18 jobs hit `TimeoutError`: Bedrock
on-demand throttles concurrent calls, and ragas's retries ran past its own
timeout. 2 workers and a 300 s timeout fixed it on the same 6 questions.
