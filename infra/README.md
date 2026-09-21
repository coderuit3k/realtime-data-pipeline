# Infra (Terraform)

Provisions: S3 raw + curated buckets, Secrets Manager secrets (NewsAPI key,
Tavily key), IAM roles, the 3 pipeline Lambda functions + 2 on-demand RAG
Lambdas (`rag_build_index`, `rag_query` -- see root README's "Agentic RAG
demo"), two EventBridge schedules for ingestion (news_ingestion runs on
its own slower schedule -- NewsAPI's free tier caps at 100 requests/day),
an S3 -> Lambda trigger for
transform, a Glue Catalog database/tables + Athena workgroup over the
curated zone, and CloudWatch log retention + error alarms.

## Deploy

```bash
# 1. Package the Lambdas (from repo root)
./scripts/build_lambdas.sh

# 2. Configure variables
cd infra
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: aws_region, alarm_email, pandas_layer_arn for your region

# 3. Provision
terraform init
terraform plan
terraform apply
```

## Set API credentials (after the first apply)

Secret values are not managed by Terraform (see `secrets.tf` for why). Set
them once via the AWS CLI, using the secret names from `terraform output`
(Hacker News needs no credentials at all):

```bash
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw news_secret_name)" \
  --secret-string '{"api_key":"..."}'

# Only needed for CRAG's web-search fallback in rag_query (tavily.com, free tier)
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw tavily_secret_name)" \
  --secret-string '{"api_key":"..."}'
```

## Web app IAM user (manual -- not managed by Terraform)

The `web/` Next.js app (dashboard, RAG assistant, data catalog, data
explorer, insights, ops, CI/CD, weather, settings) needs its own AWS
credentials, scoped read-only
to Athena/Glue/S3/CloudWatch/EventBridge/CloudWatch Logs plus
`lambda:InvokeFunction` on just the two RAG Lambdas. This user is created
**manually via the AWS CLI**, not by `terraform apply` -- the GitHub Actions
deploy role is deliberately scoped to manage IAM *roles* only (see
`infra-bootstrap/oidc.tf`), not IAM *users* or access keys, so a compromised
CI run can never mint its own long-lived credentials. Run this once, with
your own AWS credentials, after `infra`'s first apply:

> **Already created the user?** Re-run only from the variable
> assignments through `aws iam put-user-policy` (that command is a full
> policy replace, safe to re-run any time a new grant is added below) —
> skip `aws iam create-user` (harmless if re-run, but noise) and `aws
> iam create-access-key` (re-running this mints an extra, unrotated
> long-lived credential every time).

```bash
cd infra
USER_NAME="realtime-data-pipeline-dev-web-app"  # matches local.name_prefix-web-app; adjust if your project_name/environment differ
aws iam create-user --user-name "$USER_NAME"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=us-east-1
WORKGROUP_ARN="arn:aws:athena:${REGION}:${ACCOUNT_ID}:workgroup/$(terraform output -raw athena_workgroup_name)"
DATABASE="$(terraform output -raw glue_database_name)"
CURATED_BUCKET_ARN="arn:aws:s3:::$(terraform output -raw curated_bucket_name)"
RAG_QUERY_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:$(terraform output -raw rag_query_function_name)"
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
      "Resource": ["${RAG_QUERY_ARN}", "${RAG_AGENT_ARN}"]
    },
    {
      "Sid": "SecretsManagerDescribeOnly",
      "Effect": "Allow",
      "Action": ["secretsmanager:DescribeSecret"],
      "Resource": ["${NEWS_SECRET_ARN}", "${TAVILY_SECRET_ARN}"]
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

Rotate by running `aws iam create-access-key` again (an IAM user may hold up
to 2 keys) then `aws iam delete-access-key --access-key-id <old-id>` once
Vercel's env var is updated; delete the user entirely with
`aws iam delete-user-policy` + `aws iam delete-access-key` (for each key) +
`aws iam delete-user` if the web app is retired.

### Web app environment variables

These get set as Vercel project environment variables (see `web/.env.example`
for placeholder values and one-line comments):

- `AWS_ACCESS_KEY_ID` -- access key for the web-app IAM user above
- `AWS_SECRET_ACCESS_KEY` -- secret key for the web-app IAM user above
- `AWS_REGION` -- region the pipeline's resources live in
- `ATHENA_WORKGROUP` -- Athena workgroup the dashboard queries against
- `ATHENA_DATABASE` -- Glue/Athena database the dashboard queries against
- `ALARM_NAME_PREFIX` -- CloudWatch alarm name prefix (dashboard) AND the exact pipeline name prefix (`local.name_prefix`) used to build Lambda/log-group/EventBridge-rule names for the Ops page -- must be exactly `local.name_prefix`, not just any valid alarm-matching prefix
- `RAG_QUERY_FUNCTION_NAME` -- name of the `rag_query` (CRAG) Lambda
- `RAG_AGENT_FUNCTION_NAME` -- name of the `rag_agent` Lambda
- `UPSTASH_REDIS_REST_URL` -- Upstash Redis REST URL for assistant rate limiting
- `UPSTASH_REDIS_REST_TOKEN` -- Upstash Redis REST token for assistant rate limiting
- `NEWS_SECRET_NAME` -- name of the News API secret (Settings page's real, metadata-only "configured" check)
- `TAVILY_SECRET_NAME` -- name of the Tavily secret (same check)
- `DEPLOY_ENVIRONMENT` -- real deployment environment name (matches Terraform's `environment` variable, e.g. `dev`); backs the sidebar's status footer

## Updating Lambda code

Re-run `./scripts/build_lambdas.sh` then `terraform apply` -- the zip hash
changes trigger a redeploy of just the affected function(s).

## Cost & teardown

What's actually running, at this project's low volume:

| Resource | Ongoing cost |
| --- | --- |
| Lambda (6 functions, ~every 10 min) | ~$0 (well within free tier) |
| S3 (raw + curated) | Pennies/month |
| Secrets Manager (2 secrets: NewsAPI, Tavily -- Open-Meteo, CoinGecko, GitHub Search need no key) | ~$0.80/month |
| CloudWatch alarms (6) | ~$0.60/month |
| CloudWatch Logs (14-day retention) | Pennies/month |
| Glue Data Catalog (5 tables) | Free (first 1M objects/month free) |
| Athena (pay per query, tiny dataset) | Pennies per query |
| RAG Lambdas + Bedrock (on-demand only, no schedule) | $0 when not invoked; pennies per build/query when it is |
| Tavily web search (CRAG fallback, free tier) | $0 up to 1,000 searches/month |

So leaving it running costs roughly **$1/month**, not zero. Two ways to cut
that further:

**Pause ingestion** (keeps all data + Glue/Athena queryable, stops new writes
and most of the Lambda/CloudWatch activity):

```bash
terraform apply -var="enable_ingestion_schedule=false"
```

Re-enable with `-var="enable_ingestion_schedule=true"` (or just omit the
flag, since `true` is the default).

**Full teardown** (removes everything, including the S3 data -- buckets have
`force_destroy = true` specifically so this works without emptying them
first):

```bash
terraform destroy
```

Redeploying later is just `./scripts/build_lambdas.sh && terraform apply`
again -- the NewsAPI secret value will need to be set again since destroying
the secret destroys its value too.
