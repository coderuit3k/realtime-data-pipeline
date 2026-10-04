# DataPulse
AWS data pipeline (Lambda ingestion -> S3 -> Athena, RAG agent on Bedrock) + Next.js app in web/.

## Commands
```bash
.venv/bin/ruff check .        # CI enforces line length 100 (E501); run before every push
.venv/bin/python -m pytest -q
python eval/run_ragas.py      # RAGAS eval (needs requirements-eval.txt, AWS creds)
ATHENA_WORKGROUP=realtime-data-pipeline-dev-analytics ATHENA_DATABASE=realtime_data_pipeline_dev_curated \
  .venv/bin/python -c "from rag.agent import run_agent; print(run_agent('<question>')['answer'])"  # real agent locally (Bedrock/Athena/Qdrant, AWS creds)
```

## Workflow rules
- Terraform changes: run `terraform apply` locally FIRST and wait for "No changes", THEN commit and push.
- Lambda code (`common/ rag/ transform/ trends/ ingestion/`) counts as a Terraform change: its zip hash changes. Run `bash scripts/build_lambdas.sh` then `terraform -chdir=infra plan -input=false -lock=false` (read-only, no state lock); the user applies. `common/` is zipped into every Lambda, so editing it updates all of them.
- Commit/push only when the user says so.
- Pushing to `main` runs CI and Deploy; Deploy's `apply` job waits for manual approval (environment `production`).
- Commit messages: lowercase conventional prefix (`fix:`, `feat:`, `docs:`, `infra:`, `chore:`) and a short why paragraph.
- `docs/superpowers/` (specs, plans) is gitignored: never commit it.
- Every before/after measurement goes into README.md: one table, a one-line conclusion, a plain explanation. Get metrics approved before measuring.
- Don't suggest downgrading the model to save tokens.
- Don't run `terraform apply -auto-approve`, `-target`, or `force-unlock`: the user applies in their own terminal; Claude only runs `plan` and reports.

## Gotchas
- Athena GetQueryResults needs the `.csv.metadata` file. Delete it only after fetching results.
- Bedrock Converse requires `toolConfig` whenever the history contains toolUse/toolResult, including on the forced final answer.
- Lambda Python can't stream natively (needs Web Adapter + Function URL).
- Qdrant Cloud free tier suspends after 1 week idle (deleted after 4); the nightly `rag_build_index` keeps it active, and the collection is rebuildable from curated Parquet.
- `eval/results.csv` is gitignored.
- GitHub/HN/news curated tables are append-only snapshots (a row per item per ingestion run): count with `COUNT(DISTINCT repo_id|story_id|article_id)`. `year/month/day` are string partitions, so a window spanning two months needs `concat(year, month, day) BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'`. The `query_athena` tool description in `rag/agent.py` is the model's only schema guide: keep it in sync with the Glue tables.
- Athena workgroup `realtime-data-pipeline-dev-analytics` caps each query at 1 GiB scanned.
- Lambda zip hashes must match local vs CI (else `terraform plan` shows a no-op redeploy of all Lambdas): `scripts/build_lambdas.sh` strips `__pycache__`, uses `pip --no-compile` and `chmod -R go-w` (zip stores file modes, which follow umask). Don't remove those steps.
- "state data in S3 does not have the expected content": an interrupted apply left the DynamoDB digest stale. Table `realtime-data-pipeline-tfstate-lock`, item `LockID=<bucket>/infra/terraform.tfstate-md5`; the user fixes it by put-item with the "Calculated checksum".

## Layout
common/ ingestion/ transform/ rag/ trends/ (Python Lambdas) · infra/ (Terraform) · infra-bootstrap/ · web/ (Next.js) · eval/ · tests/
