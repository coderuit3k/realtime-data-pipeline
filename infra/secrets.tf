# Secret VALUES are intentionally not managed here -- putting them in a .tf/.tfvars
# file would leak them into terraform.tfstate and (if committed) into git history.
# After apply, set them once via the AWS CLI, e.g.:
#   aws secretsmanager put-secret-value --secret-id <news_secret_name output> \
#     --secret-string '{"api_key":"..."}'
#
# Hacker News' API is public and needs no secret at all.

resource "aws_secretsmanager_secret" "news_api" {
  name = "${local.name_prefix}/news-api"
}

# Tavily (web search fallback tool for the agent, in rag/agent.py).
resource "aws_secretsmanager_secret" "tavily_api" {
  name = "${local.name_prefix}/tavily-api"
}

# Gmail ingestion: one secret bundling Gmail OAuth2 credentials AND the R2
# credentials used to archive raw messages (see infra/README.md's real
# setup steps -- both are real values the user creates and sets via
# `aws secretsmanager put-secret-value`, never Terraform-managed).
resource "aws_secretsmanager_secret" "gmail_ingestion" {
  name = "${local.name_prefix}/gmail-ingestion"
}
