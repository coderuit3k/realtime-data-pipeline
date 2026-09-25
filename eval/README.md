# RAGAS evaluation

Offline evaluation of the `rag_agent` pipeline (Bedrock Converse
tool-calling agent: `search_knowledge_base`, `get_crypto_prices`,
`get_weather`, and `search_web`) using
[RAGAS](https://github.com/explodinggraphs/ragas) metrics, judged by
Bedrock (Claude Haiku + Titan Embed) instead of OpenAI.

**Dev-only, never deployed to Lambda.** `ragas` pulls in `langchain` +
several provider integrations -- fine for a one-off local/CI script, too
heavy to ship in a Lambda zip for no runtime benefit.

## Setup

```bash
pip install -r requirements-eval.txt
```

The pins in `requirements-eval.txt` matter: `ragas==0.4.3` hard-imports
`langchain_community`/`langchain_openai` internals that were removed in
their latest releases (a real packaging bug in ragas as of this writing --
it still assumes an older `langchain-core` generation). This exact
combination is the one actually verified end-to-end; installing `ragas` and
`langchain-aws` at their own latest versions will fail with import errors.

## Run

```bash
python eval/run_ragas.py
```

For each question in `questions.json`, it runs the *real* `rag_agent`
logic (imported directly from `rag/agent.py` -- the same tool-calling loop
the deployed Lambda uses, not a mock), then scores the
question/answer/retrieved-context triples with:

- **Faithfulness** -- does the answer avoid claims unsupported by the
  retrieved context?
- **Response relevancy** -- does the answer actually address the question?
- **Context precision** -- how much of what was retrieved was relevant?

Results print to the terminal and get written per-question to
`eval/results.csv` (gitignored -- it's a run artifact, not code).

## Reading the results

`questions.json` deliberately mixes in-domain questions (should retrieve
relevant context from the knowledge base) with out-of-domain ones like a
recipe, the weather in a city this pipeline doesn't track, or a sports
result -- Paris weather stays out-of-domain even for `get_weather`, which
only covers the 12 Vietnamese locations this pipeline actually ingests.
The agent has no separate grading step -- it decides per question, via the
tool descriptions alone, which tool (if any) is a fit, and falls back to
`search_web` (Tavily) when nothing else is or comes back empty. A healthy
run looks like:

- High faithfulness and relevancy across both in- and out-of-domain
  questions (the agent should ground itself in whichever tool actually had
  something relevant).
- `grounded: true` on nearly all questions, including out-of-domain ones --
  unlike a pipeline with only a knowledge-base retrieval step and no web
  fallback, the agent almost always has *something* to cite.

**Real run (2026-09-23):** `faithfulness: 0.7271`,
`answer_relevancy: 0.8870`,
`llm_context_precision_without_reference: 0.5511`. (For
reference only, not to be copied without reproducing it yourself: an
earlier run, from when this script still evaluated both the agent and the
now-retired CRAG pipeline side by side, measured the agent at
`faithfulness: 0.8052`, `answer_relevancy: 0.9156`,
`llm_context_precision_without_reference: 0.5275` -- see
[`README.md`](../README.md#agentic-rag) for that comparison. Expect a
similar ballpark run to run, not necessarily identical values, since the
judge LLM and the agent's own tool-use decisions both have real
variance.)

**Cost/time note:** each metric makes multiple Bedrock calls per question
(faithfulness in particular decomposes the answer into statements and
checks each one) -- budget ~10 minutes and a few cents for the default
6-question set with `RunConfig(max_workers=2)` (see below for why it's
capped that low). Keep `questions.json` small; this isn't meant to run on
every commit.

## Why `RunConfig(max_workers=2)`

The first run (ragas's default `max_workers=16`) threw `TimeoutError` on
11/18 jobs -- Bedrock on-demand throttles concurrent calls, and ragas's
retries under throttling ran past its own timeout. Dropping concurrency to
2 (and raising the timeout to 300s) fixed it with the same 6-question set.
