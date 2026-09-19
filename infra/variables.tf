variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "project_name" {
  type    = string
  default = "realtime-data-pipeline"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "hn_feed" {
  description = "Hacker News feed to poll: newstories, topstories, or beststories"
  type        = string
  default     = "newstories"
}

variable "hn_story_limit" {
  description = "Max number of Hacker News stories fetched per ingestion run"
  type        = number
  default     = 50
}

variable "news_query" {
  description = "NewsAPI query string for the News ingestion Lambda"
  type        = string
  default     = "cryptocurrency OR technology"
}

variable "github_trending_days" {
  description = "Lookback window (days) for the GitHub Search API's created:> filter, used as a trending-repos proxy"
  type        = number
  default     = 7
}

variable "github_trending_limit" {
  description = "Max number of repos fetched per GitHub trending ingestion run"
  type        = number
  default     = 20
}

variable "ingestion_schedule" {
  description = "EventBridge schedule expression for the ingestion Lambdas"
  type        = string
  default     = "rate(10 minutes)"
}

variable "enable_ingestion_schedule" {
  description = "false disables the EventBridge rule (pauses ingestion) without destroying anything -- data already in S3/Glue/Athena stays queryable"
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the Lambda log groups"
  type        = number
  default     = 14
}

variable "lambda_runtime" {
  type    = string
  default = "python3.12"
}

variable "pandas_layer_arn" {
  description = <<-EOT
    ARN of the AWS-managed "AWS SDK for pandas" Lambda layer, used by the transform
    Lambda for pandas/pyarrow. This ARN is region-specific -- look up the current one
    for var.aws_region at https://aws-sdk-pandas.readthedocs.io/en/stable/layers.html
  EOT
  type        = string
  default     = "arn:aws:lambda:us-east-1:336392948345:layer:AWSSDKPandas-Python312:15"
}

variable "alarm_email" {
  description = "Optional email address to notify on Lambda errors; leave empty to skip alerting"
  type        = string
  default     = ""
}

variable "bedrock_embed_model_id" {
  description = "Bedrock embedding model ID used to build/query the RAG index"
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

variable "bedrock_text_model_id" {
  description = <<-EOT
    Bedrock model/inference-profile ID used to generate RAG answers. Newer Claude
    models require the region-prefixed inference profile ID (e.g. "us.anthropic...")
    rather than the bare model ID for on-demand invocation -- check
    `aws bedrock list-inference-profiles` if changing this.
  EOT
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "rag_top_k" {
  description = "Number of top-matching documents retrieved per RAG query"
  type        = number
  default     = 5
}
