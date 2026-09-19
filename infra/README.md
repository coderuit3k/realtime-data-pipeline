# Infra (Terraform)

Provisions: S3 raw + curated buckets, Secrets Manager secrets (NewsAPI key,
Tavily key), IAM roles, the 3 pipeline Lambda functions + 2 on-demand RAG
Lambdas (`rag_build_index`, `rag_query` -- see root README's "Agentic RAG
demo"), an EventBridge schedule for ingestion, an S3 -> Lambda trigger for
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

## Updating Lambda code

Re-run `./scripts/build_lambdas.sh` then `terraform apply` -- the zip hash
changes trigger a redeploy of just the affected function(s).

## Cost & teardown

What's actually running, at this project's low volume:

| Resource | Ongoing cost |
| --- | --- |
| Lambda (5 functions, ~every 10 min) | ~$0 (well within free tier) |
| S3 (raw + curated) | Pennies/month |
| Secrets Manager (2 secrets: NewsAPI, Tavily -- Open-Meteo and CoinGecko need no key) | ~$0.80/month |
| CloudWatch alarms (5) | ~$0.50/month |
| CloudWatch Logs (14-day retention) | Pennies/month |
| Glue Data Catalog (4 tables) | Free (first 1M objects/month free) |
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
