# Infra (Terraform)

Provisions the S3 raw and curated buckets, Secrets Manager secrets (NewsAPI,
Tavily), IAM roles, the pipeline Lambdas plus the two on-demand RAG Lambdas
(see the root README's "Agentic RAG"), EventBridge schedules (news runs on a
slower one because NewsAPI's free tier allows 100 requests/day), the S3 ->
transform trigger, the Glue database/tables and Athena workgroup, and
CloudWatch log retention and error alarms.

## Deploy

```bash
./scripts/build_lambdas.sh          # 1. package the Lambdas (from repo root)

cd infra
cp terraform.tfvars.example terraform.tfvars   # 2. set aws_region, alarm_email, pandas_layer_arn

terraform init && terraform plan && terraform apply   # 3. provision
```

To update Lambda code, re-run `./scripts/build_lambdas.sh` then `terraform apply`;
only functions whose zip hash changed are redeployed.

## Set API credentials (after the first apply)

Terraform does not manage secret values (see `secrets.tf`). Set them once
(Hacker News, Open-Meteo, CoinGecko and GitHub Search need no key):

```bash
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw news_secret_name)" \
  --secret-string '{"api_key":"..."}'

# Tavily (free tier) powers the agent's search_web tool
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw tavily_secret_name)" \
  --secret-string '{"api_key":"..."}'
```

Qdrant Cloud (free cluster, cloud.qdrant.io) holds the RAG vectors and Jina
reranks the results:

```bash
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw qdrant_secret_name)" \
  --secret-string '{"url":"https://<cluster>.<region>.aws.cloud.qdrant.io:6333","api_key":"..."}'

aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw jina_secret_name)" \
  --secret-string '{"api_key":"..."}'
```

## Web app IAM user (manual, not in Terraform)

The `web/` app needs its own read-only AWS credentials (Athena, Glue, S3,
CloudWatch, EventBridge, Logs, Cost Explorer, plus `lambda:InvokeFunction` on
`rag_agent` only). The user is created by hand because the GitHub Actions
deploy role may manage IAM *roles* only (see `infra-bootstrap/oidc.tf`); a
compromised CI run can therefore never mint long-lived credentials.

Before running the script:

- **Cost Explorer** must be enabled once in the Billing console (Billing and
  Cost Management -> Cost Explorer -> Enable). It cannot be done by Terraform,
  and until then `ce:GetCostAndUsage` may fail or return nothing.
- **Vercel env vars `RAW_BUCKET` and `CURATED_BUCKET`** are needed for the Ops
  page's S3 size metrics. Get the values with
  `terraform output raw_bucket_name` / `curated_bucket_name`. No extra IAM
  permission is needed (`cloudwatch:GetMetricData` is already allowed).
- **User already exists?** Re-run from the variable assignments through
  `aws iam put-user-policy` (a full replace, safe to repeat when a grant is
  added). Skip `create-user` and `create-access-key`; the latter mints an
  extra long-lived key every time.

```bash
cd infra
USER_NAME="realtime-data-pipeline-dev-web-app"  # matches local.name_prefix-web-app; adjust if your project_name/environment differ
aws iam create-user --user-name "$USER_NAME"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=us-east-1
WORKGROUP_ARN="arn:aws:athena:${REGION}:${ACCOUNT_ID}:workgroup/$(terraform output -raw athena_workgroup_name)"
DATABASE="$(terraform output -raw glue_database_name)"
CURATED_BUCKET_ARN="arn:aws:s3:::$(terraform output -raw curated_bucket_name)"
RAG_AGENT_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:$(terraform output -raw rag_agent_function_name)"

# Ops page (real CloudWatch metrics/schedule/logs) -- pipeline Lambda names
# come from real terraform outputs, not string-guessed from $USER_NAME.
HACKERNEWS_FN="$(terraform output -raw hackernews_ingestion_function_name)"
NEWS_FN="$(terraform output -raw news_ingestion_function_name)"
WEATHER_FN="$(terraform output -raw weather_ingestion_function_name)"
CRYPTO_FN="$(terraform output -raw crypto_ingestion_function_name)"
GITHUB_FN="$(terraform output -raw github_trending_ingestion_function_name)"
TRANSFORM_FN="$(terraform output -raw transform_function_name)"
INGESTION_SCHEDULE_ARN="arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/$(terraform output -raw ingestion_schedule_rule_name)"
NEWS_INGESTION_SCHEDULE_ARN="arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/$(terraform output -raw news_ingestion_schedule_rule_name)"
NEWS_SECRET_ARN="$(terraform output -raw news_secret_arn)"
TAVILY_SECRET_ARN="$(terraform output -raw tavily_secret_arn)"

cat > /tmp/web-app-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AthenaQuery",
      "Effect": "Allow",
      "Action": ["athena:StartQueryExecution", "athena:GetQueryExecution", "athena:GetQueryResults", "athena:StopQueryExecution", "athena:GetWorkGroup"],
      "Resource": "${WORKGROUP_ARN}"
    },
    {
      "Sid": "GlueReadCuratedDatabase",
      "Effect": "Allow",
      "Action": ["glue:GetTable", "glue:GetTables", "glue:GetDatabase", "glue:GetPartitions"],
      "Resource": [
        "arn:aws:glue:${REGION}:${ACCOUNT_ID}:catalog",
        "arn:aws:glue:${REGION}:${ACCOUNT_ID}:database/${DATABASE}",
        "arn:aws:glue:${REGION}:${ACCOUNT_ID}:table/${DATABASE}/*"
      ]
    },
    {
      "Sid": "S3ReadCuratedData",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["${CURATED_BUCKET_ARN}", "${CURATED_BUCKET_ARN}/*"]
    },
    {
      "Sid": "S3AthenaResults",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "${CURATED_BUCKET_ARN}/athena-results/*"
    },
    {
      "Sid": "CloudWatchAlarmsReadOnly",
      "Effect": "Allow",
      "Action": ["cloudwatch:DescribeAlarms"],
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchMetricsReadOnly",
      "Effect": "Allow",
      "Action": ["cloudwatch:GetMetricData"],
      "Resource": "*"
    },
    {
      "Sid": "EventBridgeReadSchedule",
      "Effect": "Allow",
      "Action": ["events:DescribeRule"],
      "Resource": ["${INGESTION_SCHEDULE_ARN}", "${NEWS_INGESTION_SCHEDULE_ARN}"]
    },
    {
      "Sid": "LogsInsightsReadOnly",
      "Effect": "Allow",
      "Action": ["logs:StartQuery", "logs:GetQueryResults", "logs:StopQuery"],
      "Resource": [
        "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/lambda/${HACKERNEWS_FN}:*",
        "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/lambda/${NEWS_FN}:*",
        "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/lambda/${WEATHER_FN}:*",
        "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/lambda/${CRYPTO_FN}:*",
        "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/lambda/${GITHUB_FN}:*",
        "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/lambda/${TRANSFORM_FN}:*"
      ]
    },
    {
      "Sid": "InvokeRagLambdas",
      "Effect": "Allow",
      "Action": ["lambda:InvokeFunction"],
      "Resource": ["${RAG_AGENT_ARN}"]
    },
    {
      "Sid": "SecretsManagerDescribeOnly",
      "Effect": "Allow",
      "Action": ["secretsmanager:DescribeSecret"],
      "Resource": ["${NEWS_SECRET_ARN}", "${TAVILY_SECRET_ARN}"]
    },
    {
      "Sid": "CostExplorerReadOnly",
      "Effect": "Allow",
      "Action": ["ce:GetCostAndUsage"],
      "Resource": "*"
    }
  ]
}
EOF

aws iam put-user-policy \
  --user-name "$USER_NAME" \
  --policy-name "${USER_NAME}-policy" \
  --policy-document file:///tmp/web-app-policy.json

aws iam create-access-key --user-name "$USER_NAME"
# Copy the AccessKeyId/SecretAccessKey straight into Vercel's project env
# vars (never commit them, never put them in GitHub Actions secrets --
# this user is for the Vercel-hosted app only).
rm /tmp/web-app-policy.json
```

Rotate keys: run `aws iam create-access-key` again (max 2 per user), update
Vercel, then `aws iam delete-access-key --access-key-id <old-id>`. To retire
the user: `delete-user-policy`, `delete-access-key` for each key, `delete-user`.

### Web app environment variables

Set these in Vercel (placeholders and comments in `web/.env.example`):

| Variable | Value |
|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Keys of the web-app IAM user above |
| `AWS_REGION` | Region of the pipeline |
| `ATHENA_WORKGROUP`, `ATHENA_DATABASE` | Athena workgroup and Glue database the dashboard queries |
| `ALARM_NAME_PREFIX` | Must be exactly `local.name_prefix`: used for CloudWatch alarms and to build Lambda, log-group and EventBridge rule names |
| `RAG_AGENT_FUNCTION_NAME` | Name of the `rag_agent` Lambda |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis, for assistant rate limiting |
| `NEWS_SECRET_NAME`, `TAVILY_SECRET_NAME` | Secret names, for the Settings page's metadata-only "configured" check |
| `DEPLOY_ENVIRONMENT` | Terraform `environment` (e.g. `dev`), shown in the sidebar footer |
| `RAW_BUCKET`, `CURATED_BUCKET` | Bucket names, for the Ops page |

## Cost & teardown

| Resource | Ongoing cost |
| --- | --- |
| Lambda (6 functions, ~every 30 min) | ~$0 (free tier) |
| S3 (raw + curated), CloudWatch Logs (14-day retention), Athena (per query) | Pennies/month |
| Secrets Manager (NewsAPI, Tavily) | ~$0.80/month |
| CloudWatch alarms (6) | ~$0.60/month |
| Cost Explorer API (~1-2 calls/day via a 24h cache, $0.01/call) | ~$0.30/month |
| CloudWatch GetMetricData + Logs Insights (Ops page, 60s edge cache) | Pennies/month |
| Glue Data Catalog (5 tables) | Free |
| RAG Lambdas + Bedrock (no schedule) | $0 idle; pennies per build/query |
| Tavily (free tier) | $0 up to 1,000 searches/month |

Leaving it running costs roughly **$1/month**.

**Pause ingestion** (keeps data and Athena queryable, stops new writes):

```bash
terraform apply -var="enable_ingestion_schedule=false"   # re-enable with =true (the default)
```

**Full teardown** (also deletes S3 data; buckets use `force_destroy = true`):

```bash
terraform destroy
```

To redeploy later: `./scripts/build_lambdas.sh && terraform apply`, then set the
NewsAPI secret again (destroying the secret destroys its value).
