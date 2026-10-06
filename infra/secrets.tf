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

# Gmail ingestion: one secret bundling the Gmail IMAP login (imap_user, imap_password = a Google
# app password, needs 2-step verification) AND the R2 credentials used to archive raw messages
# (r2_account_id, r2_access_key_id, r2_secret_access_key). Both are real values the user creates
# and sets via `aws secretsmanager put-secret-value`, never Terraform-managed.
resource "aws_secretsmanager_secret" "gmail_ingestion" {
  name = "${local.name_prefix}/gmail-ingestion"
}

# Qdrant Cloud (vector store for the RAG knowledge base, rag/build_index.py and rag/agent.py).
# JSON: {"url": "https://<cluster>.<region>.aws.cloud.qdrant.io:6333", "api_key": "..."}.
# Value set by hand with `aws secretsmanager put-secret-value`, never Terraform-managed.
resource "aws_secretsmanager_secret" "qdrant" {
  name = "${local.name_prefix}/qdrant"
}

# Jina AI (reranker API used by the agent's search_knowledge_base). JSON: {"api_key": "..."}.
resource "aws_secretsmanager_secret" "jina_api" {
  name = "${local.name_prefix}/jina-api"
}
