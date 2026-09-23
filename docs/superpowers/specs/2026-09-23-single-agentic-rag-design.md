# Single Agentic RAG Pipeline (retire CRAG) — Design Spec

## Context

This project currently runs **two parallel RAG pipelines** over the same
S3-backed embeddings index, both invocable from the web app's `/assistant`
page via a mode toggle:

- `rag/query.py` (Lambda `rag_query`) — a **fixed pipeline**: embed the
  question, retrieve top-K by cosine similarity, grade each match
  `relevant`/`ambiguous`/`irrelevant` with one batched Claude Haiku call
  (CRAG), keep the survivors, and fall back through three hardcoded tiers
  (local knowledge base → Tavily web search → raw model knowledge) if
  nothing survives grading.
- `rag/agent.py` (Lambda `rag_agent`) — a **tool-calling agent**: the model
  itself decides, via Bedrock's Converse API tool use, whether/when to call
  `search_knowledge_base` (the same index) or `search_web` (Tavily), how to
  reformulate a query, and when it has enough to answer.

This was originally built to demonstrate two distinct GenAI techniques for
a Data Engineer Intern application (the target JD lists both "GenAI" and
"Agentic AI" as pluses). During this session, the user asked to extend
`eval/run_ragas.py` (a dev-only RAGAS evaluation harness already in the
repo) to score both pipelines side by side. That run produced real,
verified numbers:

| Metric | CRAG (`rag_query`) | Agent (`rag_agent`) |
|---|---|---|
| Faithfulness | 0.5474 | 0.8052 |
| Answer relevancy | 0.5925 | 0.9156 |
| Context precision (known metric limitation — see `eval/README.md`, likely not meaningful for either pipeline's abstractive answers) | 0.0000 | 0.5275 |
| Grounded rate on the 3 out-of-domain test questions | 0/3 (by design — CRAG has no fallback path that both grades *and* keeps something to cite) | 3/3 (agent freely calls `search_web` when the knowledge base has nothing) |

Seeing this, the user asked directly: since `rag_agent` already has both a
knowledge-base retrieval tool *and* a web-search fallback tool, what is
`rag_query`/CRAG actually adding? After discussion (recorded verbatim
below because it drove the decision), the user confirmed: **retire CRAG
entirely, keep the agent as the single RAG pipeline** — accepting the loss
of a dedicated "CRAG technique" demonstration in exchange for a simpler
system that still demonstrates Agentic RAG end-to-end, still grounds
answers in this project's own ingested data (`search_knowledge_base` reads
the same index built from the 5 real ingested sources), and — per this
session's real RAGAS numbers above — actually performs better on every
measured axis.

**One conceptual point clarified during this discussion, worth stating
explicitly since it shapes the design below:** "Agentic AI" is not an
alternative to RAG — it is a *way of doing* RAG (the agent decides when/how
to retrieve, instead of a fixed retrieve-then-generate pipeline). The
`search_knowledge_base` tool is what keeps the Assistant feature connected
to this project's actual data-engineering work (5 ingested sources → S3 →
embeddings index); removing it — not just removing CRAG — would sever that
connection and was never on the table. This spec removes the *fixed
pipeline*, not retrieval itself.

## Goal

Collapse the app's two RAG pipelines into one: `rag/agent.py` (Agentic RAG,
both tools) becomes the only way any part of this system answers a
question. Remove `rag/query.py`, its Lambda, its infrastructure, its web-app
mode-selection UI, and rewrite every piece of documentation/copy that
currently describes "two pipelines" to describe the one that remains —
without losing the real, verified, specific claims already made about the
agent's behavior (the two live-verified example runs in `README.md`, the
real RAGAS numbers above, etc.).

## Non-Goals

- Not changing `rag/agent.py`'s own logic, tools, or prompt in any way —
  this spec is a *removal* of the sibling pipeline, not a redesign of the
  one that survives.
- Not changing `rag/build_index.py` — both pipelines read the same index;
  it's unaffected by which pipeline(s) consume it.
- Not touching `/settings`, `/weather`, `/cicd`, `/explorer`, `/insights`,
  or any other web app page unrelated to the Assistant feature.
- Not designing the eventual "RAG Comparison Studio" Stitch sub-project's
  replacement content — that page's premise (compare two pipelines
  side-by-side) is invalidated by this change, but redesigning it is a
  separate, future brainstorming session when that sub-project comes up.
  This spec only ensures nothing *currently shipped* keeps advertising a
  comparison that no longer exists.
- Not adding new tests beyond what's needed to keep coverage honest after
  deletion (no new features are being added here).

## Architecture After This Change

```
Question (web app /assistant, no mode selector)
    │
    ▼
POST /api/assistant  (no `mode` field — always invokes RAG_AGENT_FUNCTION_NAME)
    │
    ▼
Lambda: rag_agent  (unchanged: Bedrock Converse tool-calling loop,
                    search_knowledge_base + search_web, MAX_ITERATIONS=6)
    │
    ▼
Answer + sources + tool_calls trace
```

`rag_build_index` (unchanged) continues to be the only producer of the S3
index both `rag_agent` and (formerly) `rag_query` read.

## Scope of Removal

### Python / infra (real AWS resources — flows through the existing gated
Terraform pipeline, same as every other infra change this project has
made: SDD writes the `.tf` diff, push triggers `plan`, the user manually
approves `apply` in GitHub Actions, exactly as done for every prior
sub-project)

- Delete `rag/query.py`.
- Delete `tests/test_rag_query.py`.
- `infra/rag.tf`: delete `aws_lambda_function.rag_query`, its
  `data.archive_file.rag_query`, and `aws_cloudwatch_log_group.rag_query`.
  `aws_iam_role.rag_lambda` and its permissions document stay (shared by
  `rag_build_index` and `rag_agent`, no per-Lambda IAM to remove).
- `infra/outputs.tf`: delete the `rag_query_function_name` output.
- `scripts/build_lambdas.sh`: remove the `package_with_requests rag_query
  rag/query.py` line (and its now-stale "CRAG's web-search fallback"
  comment).
- `infra/README.md`: update the intro paragraph's Lambda list (2 on-demand
  RAG Lambdas become `rag_build_index` + `rag_agent`, not `rag_query`), the
  Tavily secret comment ("CRAG's web-search fallback" → the agent's
  `search_web` tool), the `RAG_QUERY_ARN` example command, and the
  `RAG_QUERY_FUNCTION_NAME` env var doc line. Do not touch the paragraph's
  separate, pre-existing "3 pipeline Lambda functions" undercount — that
  drift predates this change and is unrelated to RAG.

### Web app

- `web/app/api/assistant/route.ts`: remove the `mode` field entirely
  (request body becomes `{question}` only); the 400 validation no longer
  checks `mode`; always resolve `RAG_AGENT_FUNCTION_NAME` (the
  `mode === "crag" ? ... : ...` ternary goes away, along with the
  `RAG_QUERY_FUNCTION_NAME` env var it no longer needs).
- `web/lib/assistant.ts`: remove `AssistantMode`, `cragDetail`, and
  `RawCragPayload`; `normalizeAssistantResult` no longer takes a `mode`
  parameter (there's only one shape now) and returns the agent's fields
  unconditionally.
- Delete `web/components/ModeToggle.tsx`.
- `web/components/ToolTrace.tsx`: remove the `result.cragDetail` branch
  entirely; the component only ever renders the tool-call trace now.
- `web/app/assistant/page.tsx`: remove the `mode` state and the
  `<ModeToggle>` render; the fetch body drops `mode`.
- `web/app/api/assistant/route.test.ts`: remove CRAG-mode test cases,
  keep/adapt the agent-mode ones to the simplified request/response shape.

### Content (must stay accurate to what's real after the change — no
stale "two pipelines" claims anywhere)

- `web/app/page.tsx` (landing): rewrite the hero paragraph (currently "...
  cộng 2 kiến trúc RAG song song trên Bedrock — một pipeline cố định (CRAG)
  và một agent tự quyết định gọi tool...") to describe the single Agentic
  RAG pipeline. Rewrite the architecture-flow box's `RAG: CRAG + Agent`
  label. Rewrite the `"RAG kép: CRAG + Agentic"` feature card's title and
  description.
- `README.md` (repo root): the `## RAG demos: fixed pipeline + tool-calling
  agent` section (lines ~116–244) currently documents both pipelines in
  depth, including real, live-verified example runs for each and a real
  RAGAS results snapshot. Restructure this into a single `## Agentic RAG`
  section: keep `rag/build_index.py`'s description as-is, keep
  `rag/agent.py`'s description and its two real verified example runs
  (in-domain multi-query retry; out-of-domain direct web-search skip)
  verbatim, drop the `rag/query.py`/CRAG paragraphs and its example runs,
  and update the RAGAS subsection to describe evaluating the single
  remaining pipeline (using this session's real agent numbers — 0.8052 /
  0.9156 / 0.5275 — as the new reference snapshot, replacing the old CRAG
  numbers). Update the architecture mermaid diagram: remove the
  `rag_query` node and its edges, keep the `rag_agent` node.
- Any other file that mentions "CRAG" or a two-pipeline comparison in
  passing (grep for `CRAG` and `mode.*crag` across the repo before
  considering this scope complete — the plan should not rely on this
  spec's own grep having found everything).

### `eval/run_ragas.py` / `eval/README.md`

This session's earlier work in the same conversation extended
`eval/run_ragas.py` to evaluate *both* pipelines side by side (the
`PIPELINES` dict, `evaluate_pipeline`, the `pipeline` column in
`results.csv`). That comparison capability is retired along with CRAG:

- `eval/run_ragas.py`: remove `run_rag_query` and everything CRAG-specific
  (the `rag.query` imports, the `PIPELINES` dict/multi-pipeline loop
  structure), keep `run_rag_agent` (rename back to a single, un-suffixed
  flow — no `PIPELINES` dict needed for one pipeline), keep the
  once-per-run index-load fix (that was a real bug fix independent of the
  CRAG-vs-agent question — do not reintroduce the per-question reload).
  `results.csv` no longer needs a `pipeline` column.
- `eval/README.md`: revert the "both pipelines side by side" framing back
  to describing evaluation of the single agent pipeline. The existing
  "known limitation: context precision reads near-zero" section was
  written against CRAG's specific numbers — update it to cite the agent's
  real context-precision score instead (0.5275, notably *not* near-zero,
  unlike CRAG's 0.0000) and reconsider whether the limitation-framing still
  applies at all now that the remaining pipeline's own real number doesn't
  show the near-zero pattern; state plainly whatever this session's real
  agent-only data actually shows once re-run, not the old CRAG framing.
  **This means re-running `eval/run_ragas.py` once after simplifying it**,
  since the already-collected agent numbers were produced by the two-
  pipeline version of the script and should be reproduced by the
  simplified single-pipeline version before being cited in a doc as "this
  is what the current script produces" (the underlying pipeline call is
  unchanged, so the numbers are expected to match, but the plan should
  verify this rather than assume it).

## Data / Counts That Must Be Recomputed (last, per this project's
established discipline — never carry a stale snapshot forward)

- `web/lib/landingMeta.ts`'s `LAMBDA_COUNT` (currently `9`, comment cites
  "3 in infra/rag.tf: rag_build_index, rag_query, rag_agent") becomes `8`
  (2 in infra/rag.tf after removal: rag_build_index, rag_agent).
- `web/lib/landingMeta.ts`'s `TEST_COUNT` (currently `252` — 74 pytest +
  178 vitest, per the last fix wave; re-verify the true current number
  before trusting this spec's, since more may have changed since it was
  written) — recompute AFTER every deletion above (fewer Python
  tests from `test_rag_query.py`'s removal, fewer/changed vitest tests
  from `route.test.ts`'s CRAG cases removal) — the plan must recompute
  this from a fresh run, last, exactly as this project has done in every
  prior sub-project.

## Testing

- Python: `pytest -q` must pass with `tests/test_rag_query.py` gone and no
  other test referencing `rag.query`.
- Web: `npx vitest run` must pass with the CRAG branches removed from
  `lib/assistant.ts`'s and `route.test.ts`'s coverage; `npx tsc --noEmit`
  and `npx next build` must be clean (removing `ModeToggle.tsx` and the
  `mode` prop threading must not leave dangling imports).
- `eval/run_ragas.py`: re-run once after simplification (real Bedrock
  calls, ~10 minutes, a few cents) to confirm the simplified script still
  produces the agent's real numbers, and use that confirmed run's numbers
  in `eval/README.md` and `README.md`'s RAGAS subsection — not the
  numbers from the pre-simplification two-pipeline run, even though they
  are expected to match (same underlying `run_agent` call).
- Manual: after deploy, ask a real in-domain and a real out-of-domain
  question via the live `/assistant` page and confirm both work with no
  mode selector visible and no reference to CRAG anywhere in the rendered
  page.

## Rollback Consideration

This deletes a real, currently-deployed Lambda (`rag_query`) via
Terraform. Once `terraform apply` runs, restoring it requires either a
`git revert` of the infra commit followed by another `apply`, or manually
re-creating the resource — there is no soft-delete. This is a deliberate,
user-confirmed decision (see Context above), not something to hedge by
leaving the Lambda deployed-but-unused; the whole point of this change is
removing the second pipeline, including its real running infrastructure.
