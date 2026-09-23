# Single Agentic RAG Pipeline (Retire CRAG) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `rag/query.py` (CRAG) pipeline entirely — its Lambda, its Terraform, its web-app mode-selection UI, and every piece of documentation/copy describing "two RAG pipelines" — leaving `rag/agent.py` (Agentic RAG: Bedrock Converse tool-calling over `search_knowledge_base` + `search_web`) as the app's only RAG pipeline.

**Architecture:** See the Architecture section of the spec below — one Lambda (`rag_agent`) behind `/api/assistant`, no mode selection anywhere in the request/response path.

**Tech Stack:** Python 3.14 (Lambda), Terraform, Next.js 15/TypeScript (Vitest, `environment: "node"`, no component-test infra), RAGAS/Bedrock (dev-only eval script).

**Spec:** `docs/superpowers/specs/2026-09-23-single-agentic-rag-design.md` — read it before starting; it records the real conversation and real RAGAS numbers (CRAG 0.5474/0.5925/0.0000 vs Agent 0.8052/0.9156/0.5275) that drove this decision, and the conceptual point that "Agentic RAG" is a way of doing RAG, not a replacement for it — `search_knowledge_base` (retrieval over this project's own ingested data) is being kept, not removed.

## Global Constraints

- This plan deletes a real, currently-deployed AWS Lambda (`rag_query`) via a Terraform diff. Applying it flows through this project's existing gated pipeline (SDD writes the `.tf` diff → push → GitHub Actions `plan` → the user manually approves `apply`) — exactly like every prior infra change this project has made. No new approval mechanism is needed or should be invented.
- `rag/build_index.py` is not touched by any task — both the old and new pipeline read the same index it produces.
- No task adds a new credential or a new write/destructive-capable code path.
- `web/app/dashboard`, `/ops`, `/cicd`, `/explorer`, `/insights`, `/settings`, `/weather` and their Sidebar entries are untouched by this plan.
- No component-rendering test infrastructure is added — `.tsx` file changes are verified by `tsc --noEmit` and `next build`, not new `.test.tsx` files.
- `eval/run_ragas.py`'s real-run numbers (Task 4) must come from an actual fresh execution of the simplified script — never copy this plan's or the spec's numbers into `eval/README.md` without having personally reproduced them in that task.
- `LAMBDA_COUNT` and `TEST_COUNT` (`web/lib/landingMeta.ts`) are recomputed from a fresh, real count in Task 5, last, after every other task's file changes exist — never carried over from an earlier snapshot (this project has hit this exact bug before).

---

### Task 1: Delete the CRAG backend (Python + Terraform)

**Files:**
- Delete: `rag/query.py`
- Delete: `tests/test_rag_query.py`
- Modify: `infra/rag.tf`
- Modify: `infra/outputs.tf`
- Modify: `scripts/build_lambdas.sh`
- Modify: `infra/README.md`
- Modify: `infra/secrets.tf`
- Modify: `common/config.py`
- Modify: `.env.example` (repo root)
- Modify: `web/.env.example`

**Interfaces:** None consumed from other tasks. Produces: nothing later tasks import (later tasks reference `RAG_AGENT_FUNCTION_NAME`, which already exists — this task removes `RAG_QUERY_FUNCTION_NAME`'s only producer, the Terraform output and the env var documentation, not a code interface).

- [ ] **Step 1: Delete the Python files**

```bash
git rm rag/query.py tests/test_rag_query.py
```

- [ ] **Step 2: Remove `rag_query`'s Terraform resources**

In `infra/rag.tf`, delete these three blocks in full (the `data.archive_file.rag_query` block, the `aws_lambda_function.rag_query` resource, and the `aws_cloudwatch_log_group.rag_query` resource):

```hcl
data "archive_file" "rag_query" {
  type        = "zip"
  source_dir  = "${path.module}/build/rag_query"
  output_path = "${path.module}/build/rag_query.zip"
}
```

```hcl
resource "aws_lambda_function" "rag_query" {
  function_name    = "${local.name_prefix}-rag-query"
  role             = aws_iam_role.rag_lambda.arn
  handler          = "query.lambda_handler"
  runtime          = var.lambda_runtime
  timeout          = 60
  memory_size      = 512
  filename         = data.archive_file.rag_query.output_path
  source_code_hash = data.archive_file.rag_query.output_base64sha256
  layers           = [var.pandas_layer_arn]

  environment {
    variables = {
      CURATED_BUCKET         = aws_s3_bucket.curated.bucket
      BEDROCK_EMBED_MODEL_ID = var.bedrock_embed_model_id
      BEDROCK_TEXT_MODEL_ID  = var.bedrock_text_model_id
      RAG_TOP_K              = tostring(var.rag_top_k)
      TAVILY_SECRET_NAME     = aws_secretsmanager_secret.tavily_api.name
    }
  }
}

resource "aws_cloudwatch_log_group" "rag_query" {
  name              = "/aws/lambda/${aws_lambda_function.rag_query.function_name}"
  retention_in_days = var.log_retention_days
}
```

Also update the comment block at the top of `infra/rag.tf` (currently describes both `build_index` and `query`) to describe `build_index` and `agent` instead. Replace:

```hcl
# Serverless RAG over the curated zone: build_index (on-demand) embeds every
# curated record via Bedrock Titan and writes a JSON index to S3; query (on-demand)
# embeds a question, does in-memory cosine similarity against that index, and asks
# Claude Haiku to answer citing sources. No EventBridge schedule and no vector
# database (e.g. OpenSearch Serverless) -- both would run 24/7 and cost real money
# even idle. At this dataset's size, Lambda-memory cosine search is plenty and
# costs $0 when not invoked.
```

with:

```hcl
# Serverless Agentic RAG over the curated zone: build_index (on-demand) embeds
# every curated record via Bedrock Titan and writes a JSON index to S3; agent
# (on-demand) is a Bedrock Converse tool-calling loop that decides for itself
# whether/when to query that index (search_knowledge_base) or fall back to a
# real web search (search_web, Tavily). No EventBridge schedule and no vector
# database (e.g. OpenSearch Serverless) -- both would run 24/7 and cost real
# money even idle. At this dataset's size, Lambda-memory cosine search is
# plenty and costs $0 when not invoked.
```

Also delete the now-orphaned comment directly above the agent resource that referenced the pipeline being replaced (it describes a comparison that no longer exists). Replace:

```hcl
# Agentic RAG: same index and IAM role as rag_query, but the model decides for
# itself (via Bedrock Converse tool use) whether/when to call
# search_knowledge_base and search_web and how many times, instead of the
# fixed retrieve -> grade -> fallback pipeline in query.py.
resource "aws_lambda_function" "rag_agent" {
```

with:

```hcl
resource "aws_lambda_function" "rag_agent" {
```

- [ ] **Step 3: Remove the Terraform output**

In `infra/outputs.tf`, delete:

```hcl
output "rag_query_function_name" {
  value = aws_lambda_function.rag_query.function_name
}
```

(Leave `rag_build_index_function_name` and `rag_agent_function_name` untouched.)

- [ ] **Step 4: Remove the build-packaging line**

In `scripts/build_lambdas.sh`, delete these two lines:

```bash
# rag_query needs `requests` too now (Tavily web search fallback for CRAG).
package_with_requests rag_query rag/query.py
```

(Leave the `rag_build_index`/`rag_agent` packaging lines around it untouched.)

- [ ] **Step 5: Update `infra/README.md`**

Replace (near the top of the file):

```markdown
Provisions: S3 raw + curated buckets, Secrets Manager secrets (NewsAPI key,
Tavily key), IAM roles, the 3 pipeline Lambda functions + 2 on-demand RAG
Lambdas (`rag_build_index`, `rag_query` -- see root README's "Agentic RAG
demo"), two EventBridge schedules for ingestion (news_ingestion runs on
```

with:

```markdown
Provisions: S3 raw + curated buckets, Secrets Manager secrets (NewsAPI key,
Tavily key), IAM roles, the 3 pipeline Lambda functions + 2 on-demand RAG
Lambdas (`rag_build_index`, `rag_agent` -- see root README's "Agentic RAG"
section), two EventBridge schedules for ingestion (news_ingestion runs on
```

Replace:

```markdown
# Only needed for CRAG's web-search fallback in rag_query (tavily.com, free tier)
```

with:

```markdown
# Only needed for the agent's search_web fallback tool (Tavily, tavily.com, free tier)
```

Replace:

```bash
RAG_QUERY_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:$(terraform output -raw rag_query_function_name)"
RAG_AGENT_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:$(terraform output -raw rag_agent_function_name)"
```

with:

```bash
RAG_AGENT_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:$(terraform output -raw rag_agent_function_name)"
```

Find the IAM policy JSON later in the same file containing:

```json
      "Resource": ["${RAG_QUERY_ARN}", "${RAG_AGENT_ARN}"]
```

and replace with:

```json
      "Resource": ["${RAG_AGENT_ARN}"]
```

Replace:

```markdown
- `RAG_QUERY_FUNCTION_NAME` -- name of the `rag_query` (CRAG) Lambda
- `RAG_AGENT_FUNCTION_NAME` -- name of the `rag_agent` Lambda
```

with:

```markdown
- `RAG_AGENT_FUNCTION_NAME` -- name of the `rag_agent` Lambda
```

Do not touch the separate, pre-existing "3 pipeline Lambda functions" count in the paragraph you edited above — that undercount predates this change and is unrelated to RAG.

- [ ] **Step 5b: Fix two more stale CRAG comments found by a full-repo grep**

In `infra/secrets.tf`, replace:

```hcl
# Tavily (web search fallback for CRAG's "incorrect" branch, in rag/query.py).
resource "aws_secretsmanager_secret" "tavily_api" {
```

with:

```hcl
# Tavily (web search fallback tool for the agent, in rag/agent.py).
resource "aws_secretsmanager_secret" "tavily_api" {
```

In `common/config.py`, replace:

```python
# Web search fallback for CRAG's "incorrect" branch (Tavily -- api.tavily.com).
TAVILY_SECRET_NAME = os.environ.get("TAVILY_SECRET_NAME", "data-pipeline/tavily-api")
```

with:

```python
# Web search tool for the agent (Tavily -- api.tavily.com), used when it
# decides the knowledge base has nothing relevant.
TAVILY_SECRET_NAME = os.environ.get("TAVILY_SECRET_NAME", "data-pipeline/tavily-api")
```

In the repo-root `.env.example`, replace:

```
# RAG / CRAG (Bedrock) -- needed for rag/build_index.py, rag/query.py, eval/run_ragas.py
BEDROCK_EMBED_MODEL_ID=amazon.titan-embed-text-v2:0
BEDROCK_TEXT_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0
RAG_TOP_K=5
RAG_INDEX_KEY=rag-index/index.json

# Tavily web search (CRAG fallback when nothing local is relevant; tavily.com, free tier)
TAVILY_SECRET_NAME=data-pipeline/tavily-api
```

with:

```
# Agentic RAG (Bedrock) -- needed for rag/build_index.py, rag/agent.py, eval/run_ragas.py
BEDROCK_EMBED_MODEL_ID=amazon.titan-embed-text-v2:0
BEDROCK_TEXT_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0
RAG_TOP_K=5
RAG_INDEX_KEY=rag-index/index.json

# Tavily web search (the agent's search_web tool, called when it decides the
# knowledge base has nothing relevant; tavily.com, free tier)
TAVILY_SECRET_NAME=data-pipeline/tavily-api
```

In `web/.env.example`, replace:

```
# Names of the two RAG Lambda functions invoked by the assistant API route.
RAG_QUERY_FUNCTION_NAME=realtime-data-pipeline-dev-rag-query
RAG_AGENT_FUNCTION_NAME=realtime-data-pipeline-dev-rag-agent
```

with:

```
# Name of the RAG agent Lambda function invoked by the assistant API route.
RAG_AGENT_FUNCTION_NAME=realtime-data-pipeline-dev-rag-agent
```

- [ ] **Step 6: Verify**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: passes, with no test referencing `rag.query` remaining (confirm via `grep -rn "rag.query\|rag/query" tests/ rag/ eval/` returning nothing outside this task's own diff).

Run (from `infra/`): `terraform validate`
Expected: succeeds. If your sandbox lacks a fully initialized backend/AWS credentials for `terraform init` to complete and `validate` cannot run, note this in your report — the CI pipeline's own `terraform validate` step (`.github/workflows/ci.yml`) is the authoritative gate and will catch any syntax error regardless.

- [ ] **Step 7: Commit**

```bash
git add rag/ tests/ infra/rag.tf infra/outputs.tf infra/secrets.tf scripts/build_lambdas.sh infra/README.md common/config.py .env.example web/.env.example
git commit -m "feat: remove CRAG pipeline (rag_query) and its Terraform, keep Agentic RAG only"
```

---

### Task 2: Simplify the web app's assistant flow (remove mode selection)

**Files:**
- Modify: `web/lib/assistant.ts`
- Modify: `web/lib/assistant.test.ts`
- Modify: `web/app/api/assistant/route.ts`
- Modify: `web/app/api/assistant/route.test.ts`
- Delete: `web/components/ModeToggle.tsx`
- Modify: `web/components/ToolTrace.tsx`
- Modify: `web/app/assistant/page.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 (independent file sets; both flow through the same overall goal).
- Produces: `AssistantResult` (no more `mode`/`cragDetail`/`agentDetail` — flattened to `toolCalls: unknown[]`) and `normalizeAssistantResult(raw: unknown): AssistantResult` (no more `mode` parameter). Nothing outside this task consumes these.

- [ ] **Step 1: Simplify `web/lib/assistant.ts`**

Replace the entire file with:

```ts
export type AssistantSource = {
  title: string;
  url: string;
  source: string;
  score?: number | null;
  grade?: string;
};

export type AssistantResult = {
  question: string;
  answer: string;
  grounded: boolean;
  sources: AssistantSource[];
  toolCalls: unknown[];
};

type RawAgentPayload = {
  question: string;
  answer: string;
  grounded: boolean;
  tool_calls: unknown[];
  sources: AssistantSource[];
};

export function normalizeAssistantResult(raw: unknown): AssistantResult {
  const payload = raw as RawAgentPayload;
  return {
    question: payload.question,
    answer: typeof payload.answer === "string" ? payload.answer : "",
    grounded: payload.grounded,
    sources: Array.isArray(payload.sources) ? payload.sources : [],
    toolCalls: Array.isArray(payload.tool_calls) ? payload.tool_calls : [],
  };
}
```

- [ ] **Step 2: Rewrite `web/lib/assistant.test.ts`**

This existing test file (found via `grep -rln "AssistantMode\|cragDetail\|agentDetail"` across `web/` — check that grep yourself against the current tree before this step, in case anything else has changed since this plan was written) currently tests `normalizeAssistantResult("crag" | "agent", raw)`'s two-mode behavior. Replace the entire file with:

```ts
import { describe, expect, it } from "vitest";
import { normalizeAssistantResult } from "./assistant";

describe("normalizeAssistantResult", () => {
  it("normalizes a rag_agent payload", () => {
    const raw = {
      statusCode: 200,
      question: "Xu hướng AI agent tuần này?",
      answer: "Agent tự tra cứu và trả lời.",
      grounded: true,
      tool_calls: [{ tool: "search_knowledge_base", input: { query: "AI agent" }, result_count: 4 }],
      sources: [{ title: "agent-loop-examples", url: "https://gh/1", source: "github" }],
    };

    const result = normalizeAssistantResult(raw);

    expect(result.question).toBe(raw.question);
    expect(result.answer).toBe(raw.answer);
    expect(result.grounded).toBe(true);
    expect(result.sources).toEqual(raw.sources);
    expect(result.toolCalls).toEqual(raw.tool_calls);
  });

  it("falls back to safe defaults when fields are missing or malformed", () => {
    const raw = {
      question: "Xu hướng AI agent tuần này?",
      answer: 123,
      // grounded, tool_calls, sources intentionally missing/malformed
    };

    const result = normalizeAssistantResult(raw);

    expect(result.sources).toEqual([]);
    expect(result.answer).toBe("");
    expect(result.toolCalls).toEqual([]);
  });
});
```

- [ ] **Step 3: Simplify `web/app/api/assistant/route.ts`**

Replace the entire file with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { getLambdaClient, requiredEnv } from "@/lib/aws";
import { checkRateLimit } from "@/lib/ratelimit";
import { normalizeAssistantResult } from "@/lib/assistant";
import { clientIp } from "@/lib/clientIp";

// rag_agent's own Lambda timeout is 90s (see infra/rag.tf); 60 is Vercel's ceiling
// on non-Pro plans, so this may still not be enough headroom on a Hobby plan.
export const maxDuration = 60;

const MAX_QUESTION_LENGTH = 500;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";

  if (!question) {
    return NextResponse.json({ error: "Thiếu 'question'." }, { status: 400 });
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { error: `Câu hỏi quá dài (tối đa ${MAX_QUESTION_LENGTH} ký tự).` },
      { status: 400 }
    );
  }

  const rateLimit = await checkRateLimit(clientIp(request));
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Đợi một chút rồi hỏi tiếp." }, { status: 429 });
  }

  try {
    const functionName = requiredEnv("RAG_AGENT_FUNCTION_NAME");
    const response = await getLambdaClient().send(
      new InvokeCommand({ FunctionName: functionName, Payload: Buffer.from(JSON.stringify({ question })) })
    );
    const payload = JSON.parse(Buffer.from(response.Payload ?? new Uint8Array()).toString("utf-8"));
    if (payload.statusCode !== 200) {
      return NextResponse.json({ error: payload.error ?? "Lambda trả lỗi." }, { status: 502 });
    }
    return NextResponse.json(normalizeAssistantResult(payload));
  } catch (error) {
    console.error("Assistant API failed", error);
    return NextResponse.json({ error: "Không gọi được RAG Lambda, thử lại sau." }, { status: 500 });
  }
}
```

- [ ] **Step 4: Rewrite `web/app/api/assistant/route.test.ts`**

Replace the entire file with:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/aws", () => ({
  getLambdaClient: vi.fn(),
  requiredEnv: vi.fn((name: string) => {
    if (name === "RAG_AGENT_FUNCTION_NAME") return "realtime-data-pipeline-dev-rag-agent";
    throw new Error(`unexpected requiredEnv(${name})`);
  }),
}));
vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: vi.fn() }));

import { getLambdaClient } from "@/lib/aws";
import { checkRateLimit } from "@/lib/ratelimit";
import { POST } from "./route";

const mockedGetLambdaClient = vi.mocked(getLambdaClient);
const mockedCheckRateLimit = vi.mocked(checkRateLimit);

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/assistant", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
  });
}

beforeEach(() => {
  mockedCheckRateLimit.mockReset();
  mockedGetLambdaClient.mockReset();
});

describe("POST /api/assistant", () => {
  it("returns 400 for a missing question", async () => {
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
  });

  it("returns 429 when rate limited", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const response = await POST(makeRequest({ question: "hi" }));
    expect(response.status).toBe(429);
    expect(mockedGetLambdaClient).not.toHaveBeenCalled();
  });

  it("returns the normalized result on success", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
    const payload = {
      statusCode: 200,
      question: "hi",
      answer: "answer text",
      grounded: true,
      tool_calls: [{ tool: "search_knowledge_base", input: { query: "hi" }, result_count: 3 }],
      sources: [],
    };
    mockedGetLambdaClient.mockReturnValue({
      send: vi.fn().mockResolvedValue({ Payload: Buffer.from(JSON.stringify(payload)) }),
    } as never);

    const response = await POST(makeRequest({ question: "hi" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answer).toBe("answer text");
    expect(body.toolCalls).toEqual([{ tool: "search_knowledge_base", input: { query: "hi" }, result_count: 3 }]);
  });

  it("returns 502 when the Lambda itself reports an error", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
    mockedGetLambdaClient.mockReturnValue({
      send: vi.fn().mockResolvedValue({
        Payload: Buffer.from(JSON.stringify({ statusCode: 400, error: "Missing 'question' in event" })),
      }),
    } as never);

    const response = await POST(makeRequest({ question: "hi" }));
    expect(response.status).toBe(502);
  });

  it("returns 400 when the question exceeds the max length", async () => {
    const response = await POST(makeRequest({ question: "x".repeat(501) }));
    expect(response.status).toBe(400);
    expect(mockedCheckRateLimit).not.toHaveBeenCalled();
  });

  it("uses the rightmost X-Forwarded-For hop as the rate limit identifier", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
    const payload = {
      statusCode: 200,
      question: "hi",
      answer: "answer text",
      grounded: true,
      tool_calls: [],
      sources: [],
    };
    mockedGetLambdaClient.mockReturnValue({
      send: vi.fn().mockResolvedValue({ Payload: Buffer.from(JSON.stringify(payload)) }),
    } as never);

    const request = new NextRequest("http://localhost/api/assistant", {
      method: "POST",
      body: JSON.stringify({ question: "hi" }),
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "1.2.3.4, 5.6.7.8",
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockedCheckRateLimit).toHaveBeenCalledWith("5.6.7.8");
  });

  it("returns 500 when a required environment variable is missing", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
    const { requiredEnv } = await import("@/lib/aws");
    vi.mocked(requiredEnv).mockImplementationOnce(() => {
      throw new Error("Environment variable RAG_AGENT_FUNCTION_NAME is required but was not set");
    });

    const response = await POST(makeRequest({ question: "hi" }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không gọi được RAG Lambda, thử lại sau.");
  });
});
```

- [ ] **Step 5: Delete `ModeToggle` and simplify `ToolTrace`**

```bash
git rm web/components/ModeToggle.tsx
```

Replace `web/components/ToolTrace.tsx` entirely with:

```tsx
import type { AssistantResult } from "@/lib/assistant";

export function ToolTrace({ result }: { result: AssistantResult | null }) {
  if (!result) return null;

  return (
    <div className="rounded-lg border border-border bg-surface p-5 flex flex-col gap-3">
      <span className="text-xs font-semibold text-textPrimary">Tool trace (agent tự quyết định)</span>
      {result.toolCalls.map((call, i) => (
        <span key={i} className="font-mono text-xs text-textSecondary">
          {JSON.stringify(call)}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Simplify `web/app/assistant/page.tsx`**

Replace the entire file with:

```tsx
// web/app/assistant/page.tsx
"use client";

import { useState } from "react";
import { ChatThread } from "@/components/ChatThread";
import { ToolTrace } from "@/components/ToolTrace";
import type { AssistantResult } from "@/lib/assistant";

export default function AssistantPage() {
  const [input, setInput] = useState("");
  const [question, setQuestion] = useState<string | null>(null);
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setQuestion(trimmed);
    setResult(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = await res.json();
      if (res.status === 429) {
        setNotice(body.error ?? "Đợi một chút rồi hỏi tiếp.");
      } else if (!res.ok) {
        setNotice(body.error ?? "Không gọi được RAG Lambda.");
      } else {
        setResult(body as AssistantResult);
      }
    } catch {
      setNotice("Không gọi được RAG Lambda, thử lại sau.");
    } finally {
      setLoading(false);
      setInput("");
    }
  }

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">RAG Assistant</h1>
        <p className="mt-1.5 text-sm text-textSecondary">
          Agentic RAG — agent tự quyết định gọi tool truy xuất dữ liệu đã ingest hoặc tìm trên web.
        </p>
      </div>
      <div className="grid grid-cols-[1.5fr_1fr] gap-5">
        <div className="rounded-lg border border-border bg-surface p-6 flex flex-col gap-4">
          <ChatThread question={question} result={result} loading={loading} />
          {notice && <p className="text-xs text-warning">{notice}</p>}
          <div className="mt-auto flex gap-2 items-center border border-border rounded-xl px-3 py-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Đặt câu hỏi về dữ liệu đã ingest…"
              className="flex-grow bg-transparent text-sm text-textPrimary outline-none placeholder:text-textMuted"
              disabled={loading}
              maxLength={500}
            />
            <button
              onClick={submit}
              disabled={loading}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-bg disabled:opacity-50"
            >
              Gửi
            </button>
          </div>
        </div>
        <ToolTrace result={result} />
      </div>
    </div>
  );
}
```

Note: `web/components/ChatThread.tsx` is not modified by this task — it only ever read `result.answer`/`result.sources`/`result.question`, never `result.mode` or the removed detail fields, so it needs no change. Confirm this yourself by reading it before assuming so.

- [ ] **Step 7: Verify**

Run: `cd web && npx vitest run`
Expected: all pass, pristine output.

Run: `cd web && npx tsc --noEmit && npx next build`
Expected: both clean (no dangling `ModeToggle`/`AssistantMode`/`cragDetail`/`agentDetail` imports anywhere — grep the `web/` tree for `AssistantMode`, `ModeToggle`, `cragDetail`, `agentDetail` and confirm zero remaining references before considering this step done).

- [ ] **Step 8: Commit**

```bash
cd web && git add lib/assistant.ts lib/assistant.test.ts app/api/assistant/route.ts app/api/assistant/route.test.ts components/ModeToggle.tsx components/ToolTrace.tsx app/assistant/page.tsx
git commit -m "feat: remove mode selection from assistant flow, agent is the only pipeline"
```

---

### Task 3: Rewrite content (landing page, root README, remaining infra/README mentions)

**Files:**
- Modify: `web/app/page.tsx`
- Modify: `README.md`

**Interfaces:** None — pure content/copy changes, no types or functions produced or consumed.

- [ ] **Step 1: Rewrite the landing page's RAG copy**

In `web/app/page.tsx`, replace:

```tsx
          <p className="max-w-xl text-[14.5px] leading-relaxed text-textSecondary">
            {DATA_SOURCE_COUNT} nguồn dị chủng đổ về S3 → Glue/Athena, cộng 2 kiến trúc RAG song song trên Bedrock —
            một pipeline cố định (CRAG) và một agent tự quyết định gọi tool. Toàn bộ hạ tầng bằng Terraform, deploy
            qua GitHub Actions với gate phê duyệt production.
          </p>
```

with:

```tsx
          <p className="max-w-xl text-[14.5px] leading-relaxed text-textSecondary">
            {DATA_SOURCE_COUNT} nguồn dị chủng đổ về S3 → Glue/Athena, cộng một agent Agentic RAG thật trên Bedrock —
            tự quyết định gọi tool truy xuất dữ liệu đã ingest hoặc tìm trên web. Toàn bộ hạ tầng bằng Terraform,
            deploy qua GitHub Actions với gate phê duyệt production.
          </p>
```

Replace:

```tsx
            <div className="rounded-lg border border-accent bg-bg px-[18px] py-3.5 text-center w-[170px]">
              <span className="font-mono text-[11.5px] text-accent">RAG: CRAG + Agent</span>
            </div>
```

with:

```tsx
            <div className="rounded-lg border border-accent bg-bg px-[18px] py-3.5 text-center w-[170px]">
              <span className="font-mono text-[11.5px] text-accent">Agentic RAG</span>
            </div>
```

Replace:

```tsx
            title="RAG kép: CRAG + Agentic"
            description="So sánh trực tiếp pipeline CRAG cố định với một agent thật tự gọi tool qua Bedrock Converse API."
```

with:

```tsx
            title="Agentic RAG thật"
            description="Agent tự quyết định gọi tool search_knowledge_base hoặc search_web (Tavily) qua Bedrock Converse API, không phải pipeline retrieve → generate cố định."
```

- [ ] **Step 2: Update the architecture mermaid diagram**

In `README.md`, replace:

```
    G --> K[Lambda: rag_build_index<br/>hackernews/news/github only]
    K -->|Titan embeddings| L[S3 rag-index/index.json]

    Q[Question] --> N[Lambda: rag_query<br/>CRAG pipeline]
    L --> N
    N -->|grade + fallback| R1[Answer + sources]

    Q --> AG[Lambda: rag_agent<br/>tool-calling loop]
    L --> AG
    AG -->|LLM decides tools/retries| R2[Answer + sources]
```

with:

```
    G --> K[Lambda: rag_build_index<br/>hackernews/news/github only]
    K -->|Titan embeddings| L[S3 rag-index/index.json]

    Q[Question] --> AG[Lambda: rag_agent<br/>tool-calling loop]
    L --> AG
    AG -->|LLM decides tools/retries| R2[Answer + sources]
```

- [ ] **Step 3: Update the file-listing cross-reference**

Replace:

```markdown
- `rag/` -- on-demand serverless RAG over the curated zone (see
  [Agentic RAG demo](#agentic-rag-demo) below).
```

with:

```markdown
- `rag/` -- on-demand serverless Agentic RAG over the curated zone (see
  [Agentic RAG](#agentic-rag) below).
```

- [ ] **Step 4: Replace the entire "RAG demos" section with a single "Agentic RAG" section**

Replace the whole section starting at `## RAG demos: fixed pipeline + tool-calling agent` and ending at the end of the `### Evaluating it: RAGAS` subsection (i.e. everything from that heading through the paragraph ending "...for the evidence.") with:

```markdown
## Agentic RAG

`rag/` retrieves-and-generates over the curated zone using Amazon Bedrock --
no vector database (e.g. OpenSearch Serverless): at this dataset's size,
Lambda-memory cosine similarity is plenty, and it avoids a service that bills
24/7 even idle.

- `rag/build_index.py` (Lambda `<project>-rag-build-index`, on-demand): reads
  every curated Parquet record from the three text-bearing sources --
  `hackernews_stories`, `news_articles`, `github_repos` -- embeds each with
  Titan (`amazon.titan-embed-text-v2:0`), writes
  `s3://<curated-bucket>/rag-index/index.json`. `weather_observations` and
  `crypto_prices` are deliberately excluded: numeric telemetry with no
  natural-language text isn't a fit for semantic search. **Incremental**:
  caches by document id + text, so a re-run only embeds new/changed records
  (verified: a second run over the same 359 docs re-embedded 0, all served
  from cache).
- `rag/agent.py` (Lambda `<project>-rag-agent`, on-demand): a genuine
  **tool-calling agent** over Bedrock's **Converse API** -- the model gets
  two tools, `search_knowledge_base` (the local index above) and
  `search_web` (Tavily), and on each turn decides for itself whether to
  call one, which query to search with, whether to reformulate and search
  again, or to stop and answer. The loop runs until the model returns a
  plain text turn (no more tool calls) or `MAX_ITERATIONS` (6) is hit, at
  which point one final call asks for a best-effort answer with tools
  withdrawn. Every tool call is recorded in the response's `tool_calls`
  trace -- this isn't knowable in advance from the code; it's whatever the
  model chose to do for that specific question.

Verified live, two real runs against the same index:
- **In-domain** ("What is trending in AI safety and regulation right
  now?"): the agent called `search_knowledge_base` **three times** with
  three different reformulated queries before answering -- it wasn't told
  to retry, it decided the first results needed broadening. Answered with
  13 cited sources, all real URLs from the ingested corpus.
- **Out-of-domain** ("What's a good recipe for banh mi?"): the agent
  skipped the knowledge base entirely and called `search_web` directly on
  the first turn -- it inferred from the tool descriptions alone that this
  question wasn't a fit for the tech/news knowledge base, without any
  hardcoded domain check.

```bash
# 1. (Re)build the index after new data lands
aws lambda invoke --function-name realtime-data-pipeline-dev-rag-build-index \
  --cli-read-timeout 300 /tmp/out.json && cat /tmp/out.json

# 2. Ask a question
aws lambda invoke --function-name realtime-data-pipeline-dev-rag-agent \
  --cli-binary-format raw-in-base64-out \
  --payload '{"question": "What is trending in AI right now?"}' \
  --cli-read-timeout 90 \
  /tmp/agent-answer.json && cat /tmp/agent-answer.json
```

Anthropic models on Bedrock need one extra one-time step beyond enabling
"Model access": submitting the **use case details form** (Bedrock console ->
Model access/catalog -> the Anthropic model -> "Submit use case details").
Amazon's own models (Titan) don't need this. Allow up to ~15 minutes for it
to propagate before retrying.

### Evaluating it: RAGAS

`eval/run_ragas.py` scores the real agent pipeline (imported directly from
`rag/agent.py`, not mocked) on faithfulness, answer relevancy, and context
precision, judged by Bedrock. Dev-only tool (heavy `langchain`/`ragas`
deps, never deployed to Lambda) -- see [`eval/README.md`](eval/README.md)
for setup (the dependency pins matter -- `ragas`'s latest release has a
real import-compatibility bug) and how to read the results.

A real run over the 6 mixed in/out-of-domain questions: `faithfulness:
0.8052`, `answer_relevancy: 0.9156`, `llm_context_precision_without_reference:
0.5275`. An earlier version of this project ran a second, fixed
retrieve-then-generate pipeline (CRAG) alongside the agent for direct
comparison before retiring it in favor of the agent alone -- on the same 6
questions, CRAG scored 0.5474/0.5925/0.0000. The agent's own tool-use (it
can always fall back to a live web search when its knowledge base has
nothing relevant) means it almost always has something real to ground an
answer in, which the numbers above reflect.
```

- [ ] **Step 5: Verify**

Run: `cd web && npx tsc --noEmit && npx next build`
Expected: both clean.

Read the edited `README.md` section once, end to end, and confirm no leftover reference to `rag_query`, `CRAG`, or a mode toggle survives anywhere in the file (`grep -n "rag_query\|CRAG" README.md` should return nothing).

- [ ] **Step 6: Commit**

```bash
git add web/app/page.tsx README.md
git commit -m "docs: rewrite landing copy and root README for single Agentic RAG pipeline"
```

---

### Task 4: Simplify `eval/run_ragas.py`, re-run for real, update `eval/README.md`

**Files:**
- Modify: `eval/run_ragas.py`
- Modify: `eval/README.md`

**Interfaces:** None — this is a dev-only script, not imported by anything else in the repo.

- [ ] **Step 1: Simplify `eval/run_ragas.py` back to a single pipeline**

Replace the entire file with:

```python
"""Offline RAGAS evaluation of the rag_agent pipeline (Bedrock Converse
tool-calling agent: search_knowledge_base + search_web). Dev-only: run
locally with `aws configure` credentials, never deployed to Lambda -- see
eval/README.md for why (dependency weight) and how to run this.
"""

import json
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", category=DeprecationWarning, module="ragas")
sys.path.insert(0, str(Path(__file__).parent.parent))

from langchain_aws import BedrockEmbeddings, ChatBedrockConverse  # noqa: E402
from ragas import EvaluationDataset, evaluate  # noqa: E402
from ragas.embeddings import LangchainEmbeddingsWrapper  # noqa: E402
from ragas.llms import LangchainLLMWrapper  # noqa: E402
from ragas.metrics import (  # noqa: E402
    Faithfulness,
    LLMContextPrecisionWithoutReference,
    ResponseRelevancy,
)
from ragas.run_config import RunConfig  # noqa: E402

from common import config  # noqa: E402
from rag.agent import load_index, run_agent  # noqa: E402


def load_questions() -> list[dict]:
    return json.loads((Path(__file__).parent / "questions.json").read_text())


def run_rag_agent(question: str, documents: list[dict]) -> dict:
    """Runs the exact same tool-calling agent loop as the deployed rag_agent
    Lambda (rag.agent.run_agent), so the eval measures real behavior.
    `documents` is the RAG index, loaded once for the whole run by main()
    -- not re-fetched from S3 per question (the ~27MB index doesn't change
    between questions in one run, and re-downloading it per question was
    slow enough to trip a real S3 read timeout during testing)."""
    result = run_agent(question, documents)
    contexts = [s["text"] for s in result["sources"] if s.get("text")]
    grounded = bool(result["sources"])

    return {
        "answer": result["answer"],
        "contexts": contexts or ["(no relevant context -- answered ungrounded)"],
        "grounded": grounded,
    }


def build_dataset(questions: list[dict], documents: list[dict]) -> tuple[EvaluationDataset, list[bool]]:
    rows = []
    grounded_flags = []
    for q in questions:
        result = run_rag_agent(q["question"], documents)
        rows.append(
            {
                "user_input": q["question"],
                "response": result["answer"],
                "retrieved_contexts": result["contexts"],
            }
        )
        grounded_flags.append(result["grounded"])
        print(f"  [{'grounded' if result['grounded'] else 'UNGROUNDED'}] {q['question']}")
    return EvaluationDataset.from_list(rows), grounded_flags


def main():
    questions = load_questions()
    print("Loading RAG index from S3 (once for this run)...")
    documents = load_index()
    print(f"Running {len(questions)} questions through rag_agent (tool-calling loop)...")
    dataset, grounded_flags = build_dataset(questions, documents)

    judge_llm = LangchainLLMWrapper(
        ChatBedrockConverse(model=config.BEDROCK_TEXT_MODEL_ID, region_name=config.AWS_REGION)
    )
    judge_embeddings = LangchainEmbeddingsWrapper(
        BedrockEmbeddings(model_id=config.BEDROCK_EMBED_MODEL_ID, region_name=config.AWS_REGION)
    )

    metrics = [
        Faithfulness(llm=judge_llm),
        ResponseRelevancy(llm=judge_llm, embeddings=judge_embeddings),
        LLMContextPrecisionWithoutReference(llm=judge_llm),
    ]

    print("\nScoring with RAGAS (calls Bedrock several times per question -- can take minutes)...")
    # Low concurrency on purpose: Bedrock on-demand throttles concurrent calls,
    # and ragas's default max_workers=16 caused widespread TimeoutErrors here
    # (confirmed) -- a few slow calls beat many throttled/retried ones.
    run_config = RunConfig(timeout=300, max_workers=2)
    result = evaluate(dataset=dataset, metrics=metrics, run_config=run_config)

    df = result.to_pandas()
    df["grounded"] = grounded_flags
    out_path = Path(__file__).parent / "results.csv"
    df.to_csv(out_path, index=False)

    print(f"\n{result}\n")
    print(f"Per-question results written to {out_path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it for real**

This makes real Bedrock (and possibly Tavily) calls and costs a few cents. You need these environment variables exported (real values, not placeholders — get bucket names via `cd infra && terraform output -raw raw_bucket_name` / `terraform output -raw curated_bucket_name` if you don't already have them, or `aws s3 ls | grep realtime-data-pipeline`):

```bash
export AWS_REGION=us-east-1
export RAW_BUCKET=<real raw bucket name>
export CURATED_BUCKET=<real curated bucket name>
export BEDROCK_EMBED_MODEL_ID=amazon.titan-embed-text-v2:0
export BEDROCK_TEXT_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0
export RAG_TOP_K=5
export RAG_INDEX_KEY=rag-index/index.json
export TAVILY_SECRET_NAME=<real tavily secret name, e.g. realtime-data-pipeline-dev/tavily-api>

.venv/bin/python -u eval/run_ragas.py
```

Run this in the foreground and wait for it to finish (expect ~10 minutes; do not assume it hung if it takes a while with low CPU usage — it's network/Bedrock-throttling bound, not stuck, as long as it's still making progress). Capture the real printed result line, e.g. `{'faithfulness': ..., 'answer_relevancy': ..., 'llm_context_precision_without_reference': ...}` — you will use these exact numbers, not any number from this plan or the spec, in Step 3.

- [ ] **Step 3: Update `eval/README.md` with your real numbers**

Replace the entire file with (filling in the `[...]` markers with your own Step 2 run's real, printed numbers and today's date — do not copy the example numbers shown in the comment, they are only there to illustrate the expected format and rough ballpark, not values to reuse):

```markdown
# RAGAS evaluation

Offline evaluation of the `rag_agent` pipeline (Bedrock Converse
tool-calling agent: `search_knowledge_base` + `search_web`) using
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
recipe, the weather, or a sports result. The agent has no separate grading
step -- it decides per question, via the tool descriptions alone, whether
`search_knowledge_base` is a fit, and falls back to `search_web` (Tavily)
when it isn't or comes back empty. A healthy run looks like:

- High faithfulness and relevancy across both in- and out-of-domain
  questions (the agent should ground itself in whichever tool actually had
  something relevant).
- `grounded: true` on nearly all questions, including out-of-domain ones --
  unlike a pipeline with only a knowledge-base retrieval step and no web
  fallback, the agent almost always has *something* to cite.

**Real run ([today's date]):** `faithfulness: [your real number]`,
`answer_relevancy: [your real number]`,
`llm_context_precision_without_reference: [your real number]`. (For
reference only, not to be copied without reproducing it yourself: a run
during this script's single-pipeline simplification measured
`faithfulness: 0.8052`, `answer_relevancy: 0.9156`,
`llm_context_precision_without_reference: 0.5275` -- expect a similar
ballpark, not necessarily identical values, since the judge LLM and the
agent's own tool-use decisions both have real run-to-run variance.)

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
```

- [ ] **Step 4: Commit**

```bash
git add eval/run_ragas.py eval/README.md
git commit -m "feat: simplify eval/run_ragas.py to the single agent pipeline, re-run for real numbers"
```

---

### Task 5: Recompute `LAMBDA_COUNT` and `TEST_COUNT` (last)

**Files:**
- Modify: `web/lib/landingMeta.ts`

**Interfaces:** None.

- [ ] **Step 1: Recompute `LAMBDA_COUNT`**

Verify yourself: `grep -n '^resource "aws_lambda_function"' infra/*.tf` — should now show 6 in `infra/lambda.tf` + 2 in `infra/rag.tf` (`rag_build_index`, `rag_agent`) = 8.

In `web/lib/landingMeta.ts`, replace:

```ts
// Real count of aws_lambda_function resources across this project's
// Terraform, verified 2026-09-21 via:
//   grep -n '^resource "aws_lambda_function"' infra/*.tf
// 6 in infra/lambda.tf (hackernews/news/weather/crypto/github ingestion
// + transform) + 3 in infra/rag.tf (rag_build_index, rag_query,
// rag_agent) = 9.
export const LAMBDA_COUNT = 9;
```

with:

```ts
// Real count of aws_lambda_function resources across this project's
// Terraform, verified 2026-09-23 via:
//   grep -n '^resource "aws_lambda_function"' infra/*.tf
// 6 in infra/lambda.tf (hackernews/news/weather/crypto/github ingestion
// + transform) + 2 in infra/rag.tf (rag_build_index, rag_agent -- CRAG's
// rag_query was retired, see docs/superpowers/specs/2026-09-23-single-
// agentic-rag-design.md) = 8.
export const LAMBDA_COUNT = 8;
```

- [ ] **Step 2: Recompute `TEST_COUNT`**

Run both, from a completely fresh state (after Tasks 1-4's deletions/edits are all committed):

```bash
.venv/bin/python -m pytest tests/ --collect-only -q
cd web && npx vitest run
```

Sum the two real counts you get. Do not trust any number from this plan or from a prior conversation — this project has previously shipped a bug where `TEST_COUNT` was set before a change's own test-file deletions/edits were counted. Update the constant and its citing comment in `web/lib/landingMeta.ts` (same file, just below `LAMBDA_COUNT`) to state the exact two commands you ran, their real output, and the sum, following the existing comment's format exactly:

```ts
// Real combined automated test count, verified 2026-09-23 AFTER the
// single-Agentic-RAG plan's deletions (tests/test_rag_query.py removed,
// app/api/assistant/route.test.ts's CRAG-mode cases removed) --
// recomputed from a fresh run, not carried over from an earlier snapshot:
//   .venv/bin/python -m pytest tests/ --collect-only -q   -> [real number]
//   cd web && npx vitest run                              -> [real number] ([N] files)
// [sum] total. Both are real, currently-passing suites for this same
// project (Python pipeline + TypeScript web app).
export const TEST_COUNT = [real sum];
```

- [ ] **Step 3: Verify**

Run: `.venv/bin/python -m pytest tests/ -q && cd web && npx vitest run && npx tsc --noEmit && npx next build`
Expected: everything passes/builds clean, and the `TEST_COUNT` in the file matches the sum you just measured (re-run the two counting commands once more after committing to double check nothing drifted while you were editing).

- [ ] **Step 4: Commit**

```bash
git add web/lib/landingMeta.ts
git commit -m "fix: recompute LAMBDA_COUNT and TEST_COUNT after retiring CRAG"
```

---

## After all tasks: manual verification (part of this plan's final review, not a separate task)

- `.venv/bin/python -m pytest tests/ -q` and `cd web && npx vitest run` — both suites green.
- `cd web && npx tsc --noEmit && npx next build` — clean.
- `grep -rn "rag_query\|RAG_QUERY\|ModeToggle\|AssistantMode\|cragDetail\|agentDetail\|CRAG" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.tf" --include="*.md" .` (excluding `docs/superpowers/specs/` and `docs/superpowers/plans/`, which are historical records of the decision, not live code/docs) should return nothing.
- Deploy through the normal gated pipeline (this destroys the real `rag_query` Lambda — confirm the user has approved this before the Terraform `apply` step runs, same as every other infra change).
- Live-verify: ask a real in-domain question and a real out-of-domain question via `/assistant` on the deployed site, confirm both get grounded answers with a visible tool-call trace and no mode selector anywhere on the page.
