# DataPulse
AWS data pipeline (Lambda ingestion -> S3 -> Athena, RAG agent on Bedrock) + Next.js app in web/.

## Commands
```bash
.venv/bin/ruff check .        # CI enforces line length 100 (E501); run before every push
.venv/bin/python -m pytest -q
python eval/run_ragas.py      # RAGAS eval (needs requirements-eval.txt, AWS creds)
```

## Workflow rules
- Terraform changes: run `terraform apply` locally FIRST and wait for "No changes", THEN commit and push.
- Commit/push only when the user says so.
- Every before/after measurement goes into README.md: one table, a one-line conclusion, a plain explanation. Get metrics approved before measuring.
- Don't suggest downgrading the model to save tokens.
- Don't run `terraform apply -auto-approve`, `-target`, or `force-unlock`: the user applies in their own terminal; Claude only runs `plan` and reports.

## Gotchas
- Athena GetQueryResults needs the `.csv.metadata` file. Delete it only after fetching results.
- Bedrock Converse requires `toolConfig` whenever the history contains toolUse/toolResult, including on the forced final answer.
- Lambda Python can't stream natively (needs Web Adapter + Function URL).
- Local machine -> AWS is slow; avoid downloading the RAG index from S3 repeatedly.
- `eval/results.csv` is gitignored.
- Lambda zip hashes must match local vs CI (else `terraform plan` shows a no-op redeploy of all Lambdas): `scripts/build_lambdas.sh` strips `__pycache__`, uses `pip --no-compile` and `chmod -R go-w` (zip stores file modes, which follow umask). Don't remove those steps.
- "state data in S3 does not have the expected content": an interrupted apply left the DynamoDB digest stale. Table `realtime-data-pipeline-tfstate-lock`, item `LockID=<bucket>/infra/terraform.tfstate-md5`; the user fixes it by put-item with the "Calculated checksum".

## Layout
common/ ingestion/ transform/ rag/ trends/ (Python Lambdas) · infra/ (Terraform) · infra-bootstrap/ · web/ (Next.js) · eval/ · tests/
