# RAGAS evaluation

Offline evaluation of the `rag_query` pipeline (retrieval -> CRAG grading ->
generation) using [RAGAS](https://github.com/explodinggraphs/ragas) metrics,
judged by Bedrock (Claude Haiku + Titan Embed) instead of OpenAI.

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

For each question in `questions.json`, it runs the *real* `rag_query` logic
(imported directly from `rag/query.py` -- same retrieve -> CRAG-grade ->
generate path the deployed Lambda uses, not a mock), then scores the
question/answer/retrieved-context triples with:

- **Faithfulness** -- does the answer avoid claims unsupported by the
  retrieved context?
- **Response relevancy** -- does the answer actually address the question?
- **Context precision** -- how much of what was retrieved was relevant?

Results print to the terminal and get written per-question to
`eval/results.csv` (gitignored -- it's a run artifact, not code).

## Reading the results

`questions.json` deliberately mixes in-domain questions (should retrieve
relevant context, `grounded: true`) with out-of-domain ones like a recipe
or the weather (CRAG should grade everything retrieved as irrelevant and
fall back to an ungrounded answer). A healthy run looks like:

- High context precision + faithfulness on the in-domain questions.
- `grounded: false` on the out-of-domain ones, with context precision
  naturally low there too (there's nothing relevant to precisely retrieve).

**Cost/time note:** each metric makes multiple Bedrock calls per question
(faithfulness in particular decomposes the answer into statements and
checks each one) -- budget ~10 minutes and a few cents for the default
6-question set with `RunConfig(max_workers=2)` (see below for why it's
capped that low). Keep `questions.json` small; this isn't meant to run on
every commit.

## Known limitation: context precision reads near-zero here (verified, not a bug)

Two clean runs on the same 6 questions: `faithfulness: 0.44 / 0.44`,
`answer_relevancy: 0.60 / 0.61`, `llm_context_precision_without_reference:
0.00 / 0.17` (5 of 6 questions scored exactly 0 both times; one in-domain
question scored 1.0 on the second run and 0.0 on the first -- the judge
call has run-to-run noise). That near-zero pattern looks broken but isn't a
code bug; it's a real characteristic of this metric with a Claude Haiku
judge, confirmed by direct testing:

- A response that closely **paraphrases** a single retrieved context scores
  that context ~1.0.
- Our actual `rag_query` answers are **abstractive, multi-source syntheses**
  ("Regulatory approaches: ... [2]. International cooperation: ... [3].
  Technical solutions: ... [5]." -- a themed summary across 5 sources, not
  a near-quote of any one of them) -- every one of those same 5 sources
  scores 0 on this metric, even though they're genuinely the sources the
  answer draws from and CRAG graded them all `relevant`.
- Ruled out first: context length, context count (tested at 5 and 2), and
  citation brackets like `[2]` -- none of those changed the result.

In short: `LLMContextPrecisionWithoutReference` (this ragas version, Claude
Haiku judge) seems to require lexical closeness between the response and a
context to credit that context as "used," which penalizes exactly the kind
of good, synthesized RAG writing this project's prompt asks for. Faithfulness
and answer relevancy don't share this problem (they tracked CRAG's
grounded/ungrounded split correctly in the same run) -- treat this one
metric's score here as not meaningful, rather than assuming retrieval is
bad.

## Why `RunConfig(max_workers=2)`

The first run (ragas's default `max_workers=16`) threw `TimeoutError` on
11/18 jobs -- Bedrock on-demand throttles concurrent calls, and ragas's
retries under throttling ran past its own timeout. Dropping concurrency to
2 (and raising the timeout to 300s) fixed it with the same 6-question set.
