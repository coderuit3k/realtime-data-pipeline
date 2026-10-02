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

## Gotchas
- Athena GetQueryResults needs the `.csv.metadata` file. Delete it only after fetching results.
- Bedrock Converse requires `toolConfig` whenever the history contains toolUse/toolResult, including on the forced final answer.
- Lambda Python can't stream natively (needs Web Adapter + Function URL).
- Local machine -> AWS is slow; avoid downloading the RAG index from S3 repeatedly.
- `eval/results.csv` is gitignored.

## Layout
common/ ingestion/ transform/ rag/ trends/ (Python Lambdas) · infra/ (Terraform) · infra-bootstrap/ · web/ (Next.js) · eval/ · tests/
